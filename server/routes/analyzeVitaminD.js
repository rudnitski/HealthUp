const express = require('express');
const OpenAI = require('openai');
const pdfParse = require('pdf-parse');
const os = require('os');
const fs = require('fs/promises');
const path = require('path');
const { promisify } = require('util');
const { execFile } = require('child_process');

const router = express.Router();

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_PDF_PAGES = 5;
const FILE_FIELD_NAME = 'analysisFile';
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
]);
const DEFAULT_MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini';

const systemPrompt = 'You are a medical document analyzer. Extract only the Vitamin D (25(OH)D) measurement from the uploaded lab report. Return JSON only.';
const userPrompt = 'Find the Vitamin D (25(OH)D) lab result if present. Return JSON only with fields: `vitamin_d_found` (boolean), `value` (number or null), and `unit` (string or null). If the document provides a unit (e.g., "ng/mL", "nmol/L", "µg/mL", "IU/mL") you MUST copy it exactly (case-insensitive is fine). Only set `unit` to null when no unit is visible. Do not fabricate or replace units, and do not emit placeholder characters.';

const structuredOutputFormat = {
  type: 'json_schema',
  name: 'vitamin_d_response',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      vitamin_d_found: { type: 'boolean' },
      value: { anyOf: [{ type: 'number' }, { type: 'null' }] },
      unit: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    },
    required: ['vitamin_d_found', 'value', 'unit'],
  },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const shouldRetry = (error) => {
  if (!error || !error.response) {
    return false;
  }

  const status = error.response.status;
  return status === 429 || status >= 500;
};

const withRetry = async (fn, { attempts = 3, baseDelay = 500 } = {}) => {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === attempts || !shouldRetry(error)) {
        break;
      }

      const backoff = baseDelay * (2 ** (attempt - 1));
      await sleep(backoff);
    }
  }

  throw lastError;
};

const sanitizeUnit = (unit) => {
  if (typeof unit !== 'string') {
    return null;
  }

  const trimmed = unit.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  // Allow alphanumeric characters, slashes, and whitespace; strip everything else.
  const cleaned = trimmed
    .replace(/[.,](?=\d)/g, (match) => (match === ',' ? '' : match))
    .replace(/[^a-z0-9а-яё/.%\s-]/g, '');
  if (!cleaned) {
    return null;
  }

  // Drop values that do not contain any alphabetical characters (e.g., stray punctuation).
  if (!/[a-zа-яё]/.test(cleaned)) {
    return null;
  }

  return cleaned;
};

const detectUnitFromText = (text) => {
  if (typeof text !== 'string') {
    return null;
  }

  const lowered = text.toLowerCase();
  const condensed = lowered.replace(/\s+/g, '');

  const explicitMatches = [
    'ng/ml',
    'ng/dl',
    'nmol/l',
    'µg/ml',
    'ug/ml',
    'mcg/ml',
    'pg/ml',
    'pmol/l',
    'mmol/l',
    'iu/ml',
  ];

  const explicit = explicitMatches.find((unitToken) => condensed.includes(unitToken));
  if (explicit) {
    return normalizeUnitToken(explicit);
  }

  const pattern = /(iu|µg|ug|mcg|ng|nmol|pmol|pg|mmol)\s*\/\s*(ml|dl|l)/;
  const match = lowered.match(pattern);

  if (match && match[1] && match[2]) {
    const numerator = normalizeUnitToken(match[1].trim());
    const denominator = match[2].trim();
    return `${numerator}/${denominator}`;
  }

  return null;
};

const buildImageContent = (fileBuffer, mimetype) => ({
  type: 'input_image',
  image_url: `data:${mimetype};base64,${fileBuffer.toString('base64')}`,
});

const execFileAsync = promisify(execFile);
const PDFTOPPM_BIN = process.env.PDFTOPPM_PATH || 'pdftoppm';

const coerceJsonObject = (rawOutput) => {
  if (rawOutput && typeof rawOutput === 'object') {
    return rawOutput;
  }

  if (typeof rawOutput !== 'string') {
    return null;
  }

  const trimmed = rawOutput.trim();

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (nestedError) {
        return null;
      }
    }

    return null;
  }
};

const parseVisionResponse = (rawOutput, fallbackText = '') => {
  const parsed = coerceJsonObject(rawOutput);
  const fallbackString = typeof fallbackText === 'string' && fallbackText.trim()
    ? fallbackText.trim()
    : typeof rawOutput === 'string'
      ? rawOutput
      : JSON.stringify(rawOutput ?? {});

  if (!parsed) {
    return { vitamin_d_found: false, raw_model_output: fallbackString };
  }

  try {
    const vitaminDFound = Boolean(parsed.vitamin_d_found);
    let value = null;

    if (typeof parsed.value === 'number') {
      value = Number.isFinite(parsed.value) ? parsed.value : null;
    } else if (typeof parsed.value === 'string') {
      const numericValue = Number(parsed.value);
      value = Number.isFinite(numericValue) ? numericValue : null;
    }

    let unit = sanitizeUnit(parsed.unit);

    if (!unit) {
      unit = sanitizeUnit(detectUnitFromText(parsed.unit))
        || sanitizeUnit(detectUnitFromText(fallbackString));
    }

    return vitaminDFound
      ? {
          vitamin_d_found: true,
          value,
          unit,
          raw_model_output: fallbackString,
        }
      : {
          vitamin_d_found: false,
          raw_model_output: fallbackString,
        };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[analyzeVitaminD] Unable to parse model output as JSON. Falling back to not found.');
    return { vitamin_d_found: false, raw_model_output: fallbackString };
  }
};

const extractOutputText = (response) => {
  if (!response) {
    return '';
  }

  const { output_text: outputText } = response;

  if (typeof outputText === 'string') {
    return outputText;
  }

  if (Array.isArray(outputText)) {
    return outputText.join('\n');
  }

  if (Array.isArray(response.output)) {
    const textParts = response.output
      .flatMap((item) => item?.content || [])
      .filter((contentItem) => contentItem?.type === 'output_text')
      .map((contentItem) => contentItem?.text)
      .filter(Boolean);

    return textParts.join('\n');
  }

  return '';
};

const ensurePdfWithinPageLimit = async (buffer) => {
  try {
    const meta = await pdfParse(buffer);
    const totalPages = Number(meta?.numpages) || 0;

    if (totalPages > MAX_PDF_PAGES) {
      const error = new Error(`PDF exceeds ${MAX_PDF_PAGES} page limit.`);
      error.statusCode = 400;
      throw error;
    }

    if (totalPages <= 0) {
      const error = new Error('Unable to detect any pages in the PDF.');
      error.statusCode = 422;
      throw error;
    }

    return totalPages;
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }

    const wrapped = new Error('Unable to inspect PDF.');
    wrapped.statusCode = 422;
    throw wrapped;
  }
};

const convertPdfToImageDataUrls = async (buffer, pageCount, filenameHint = 'upload.pdf') => {
  const tempDirPrefix = path.join(os.tmpdir(), 'vitamin-d-');
  const workingDir = await fs.mkdtemp(tempDirPrefix);
  const baseName = filenameHint.toLowerCase().endsWith('.pdf') ? filenameHint : `${filenameHint}.pdf`;
  const pdfPath = path.join(workingDir, baseName);
  const outPrefixBase = path.join(workingDir, `vitamind-${Date.now()}`);

  await fs.writeFile(pdfPath, buffer);

  const maxPage = Math.min(pageCount, MAX_PDF_PAGES);
  const imageDataUrls = [];

  try {
    await execFileAsync(PDFTOPPM_BIN, [
      '-png',
      '-scale-to', '1024',
      '-f', '1',
      '-l', String(maxPage),
      pdfPath,
      outPrefixBase,
    ]);

    for (let page = 1; page <= maxPage; page += 1) {
      const imagePath = `${outPrefixBase}-${page}.png`;

      try {
        await fs.access(imagePath);
      } catch (accessError) {
        throw new Error('Converted PDF image not found.');
      }

      const imageBuffer = await fs.readFile(imagePath);
      await fs.unlink(imagePath).catch(() => {});

      imageDataUrls.push(`data:image/png;base64,${imageBuffer.toString('base64')}`);
    }
  } finally {
    await fs.rm(workingDir, { recursive: true, force: true }).catch(() => {});
  }

  if (!imageDataUrls.length) {
    throw new Error('No PDF pages were converted.');
  }

  return imageDataUrls;
};

router.post('/', async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'Vision API error' });
  }

  const uploadedFile = req?.files?.[FILE_FIELD_NAME] || Object.values(req?.files || {})[0];

  if (!uploadedFile || Array.isArray(uploadedFile)) {
    return res.status(400).json({ error: 'A single file is required.' });
  }

  const { data: fileBuffer, mimetype, name, size } = uploadedFile;

  if (!ALLOWED_MIME_TYPES.has(mimetype)) {
    return res.status(400).json({ error: 'Unsupported file type. Please upload an image or PDF.' });
  }

  if (size > MAX_FILE_SIZE_BYTES) {
    return res.status(413).json({ error: 'File is too large. Maximum size is 10MB.' });
  }

  const sanitizedFilename = typeof name === 'string' && name ? name.slice(0, 64) : 'upload';

  let pdfPageCount = 0;

  if (mimetype === 'application/pdf') {
    try {
      pdfPageCount = await ensurePdfWithinPageLimit(fileBuffer);
    } catch (error) {
      const status = error.statusCode || 400;
      return res.status(status).json({ error: error.message });
    }
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const userContent = [{ type: 'input_text', text: userPrompt }];

  if (mimetype === 'application/pdf') {
    try {
      const pdfFilename = sanitizedFilename.toLowerCase().endsWith('.pdf')
        ? sanitizedFilename
        : `${sanitizedFilename}.pdf`;

      const imageDataUrls = await convertPdfToImageDataUrls(fileBuffer, pdfPageCount, pdfFilename);

      imageDataUrls.forEach((imageUrl) => {
        userContent.push({ type: 'input_image', image_url: imageUrl });
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[analyzeVitaminD] Unable to convert PDF to images:', {
        message: error?.message,
      });

      if (error?.code === 'ENOENT') {
        return res.status(500).json({
          error: 'PDF conversion tool not found. Install Poppler (pdftoppm) to analyze PDFs.',
        });
      }

      return res.status(502).json({ error: 'Unable to convert PDF for analysis. Try again later or upload an image.' });
    }
  } else {
    userContent.push(buildImageContent(fileBuffer, mimetype));
  }

  const requestPayload = {
    model: DEFAULT_MODEL,
    input: [
      {
        role: 'system',
        content: [{ type: 'input_text', text: systemPrompt }],
      },
      {
        role: 'user',
        content: userContent,
      },
    ],
    text: {
      format: structuredOutputFormat,
    },
    metadata: {
      source: 'vitamin-d-extraction',
      filename: sanitizedFilename,
    },
  };

  const callVision = async () => {
    try {
      return await client.responses.parse(requestPayload);
    } catch (error) {
      if (error instanceof SyntaxError) {
        // Fall back to the raw response if parsing fails client-side.
        return client.responses.create(requestPayload);
      }

      throw error;
    }
  };

  let openAiResponse;

  try {
    openAiResponse = await withRetry(callVision);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[analyzeVitaminD] Vision API request failed:', {
      message: error?.message,
      status: error?.response?.status,
    });

    return res.status(502).json({ error: 'Vision API error' });
  }

  const parsedPayload = openAiResponse?.output_parsed;
  const outputText = extractOutputText(openAiResponse);

  const result = parsedPayload
    ? parseVisionResponse(parsedPayload, outputText)
    : parseVisionResponse(outputText, outputText);

  return res.json(result);
});

module.exports = router;
