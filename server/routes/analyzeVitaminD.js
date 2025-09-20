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

const systemPrompt = [
  'You are a medical document analyzer.',
  'Extract patient identification details, specimen collection (check-up) date, all Vitamin D (25(OH)D) measurements, and each measurement\'s reference interval from lab reports.',
  'Return JSON only.',
].join(' ');

const userPrompt = [
  'Return JSON with the following top-level fields:',
  '- patient_name (string or null)',
  '- date_of_birth (string or null)',
  '- checkup_date (string or null; prefer the specimen collection date when available)',
  '- vitamin_d_found (boolean)',
  '- vitamin_d_results (array of objects)',
  '',
  'Each object in vitamin_d_results must include:',
  '- analyte_name (string or null; e.g., "Vitamin D Total", "Vitamin D2")',
  '- value (number or null)',
  '- unit (string or null)',
  '- reference_interval_found (boolean)',
  '- reference_interval_low (number or null)',
  '- reference_interval_low_operator (string or null; valid values: ">", ">=", "=", null)',
  '- reference_interval_high (number or null)',
  '- reference_interval_high_operator (string or null; valid values: "<", "<=", "=", null)',
  '- reference_interval_unit (string or null)',
  '',
  'Rules:',
  '- Only return JSON.',
  '- Preserve the original casing for names and dates. Trim whitespace.',
  '- Use ISO-8601 (YYYY-MM-DD) for dates when the format is unambiguous; otherwise copy the text exactly.',
  '- Set string fields to null when information is absent.',
  '- Set numeric fields to null when a numeric value is not explicitly provided.',
  '- Copy units exactly when present (case-insensitive is acceptable). Do not invent or substitute units.',
  '- Include every distinct Vitamin D measurement as its own item in vitamin_d_results.',
  '- When reference intervals include inequalities (e.g., "> 30"), populate the numeric bound and use the appropriate operator field.',
  '- Leave operator fields null when the bound is inclusive of the stated value.',
].join('\n');

const structuredOutputFormat = {
  type: 'json_schema',
  name: 'vitamin_d_response',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      patient_name: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      date_of_birth: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      checkup_date: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      vitamin_d_found: { type: 'boolean' },
      vitamin_d_results: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            analyte_name: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            value: { anyOf: [{ type: 'number' }, { type: 'null' }] },
            unit: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            reference_interval_found: { type: 'boolean' },
            reference_interval_low: { anyOf: [{ type: 'number' }, { type: 'null' }] },
            reference_interval_low_operator: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            reference_interval_high: { anyOf: [{ type: 'number' }, { type: 'null' }] },
            reference_interval_high_operator: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            reference_interval_unit: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          },
          required: [
            'analyte_name',
            'value',
            'unit',
            'reference_interval_found',
            'reference_interval_low',
            'reference_interval_low_operator',
            'reference_interval_high',
            'reference_interval_high_operator',
            'reference_interval_unit',
          ],
        },
      },
    },
    required: [
      'patient_name',
      'date_of_birth',
      'checkup_date',
      'vitamin_d_found',
      'vitamin_d_results',
    ],
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

const normalizeUnitToken = (token) => {
  if (typeof token !== 'string') {
    return '';
  }

  const normalized = token.trim().toLowerCase();
  const replacements = {
    ug: 'µg',
    mcg: 'µg',
  };

  if (normalized in replacements) {
    return replacements[normalized];
  }

  return normalized;
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

const sanitizeTextField = (value, { maxLength = 160 } = {}) => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return null;
  }

  if (normalized.length > maxLength) {
    return normalized.slice(0, maxLength);
  }

  return normalized;
};

const sanitizeDateField = (value) => sanitizeTextField(value, { maxLength: 48 });

const toFiniteNumber = (value) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
  }

  return null;
};

const sanitizeIntervalOperator = (value, allowed = ['>', '>=', '<', '<=', '=']) => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed
    .replace(/≥|=>/g, '>=')
    .replace(/≤|<=/g, '<=')
    .replace(/≧/g, '>=')
    .replace(/≦/g, '<=');

  if (allowed.includes(normalized)) {
    return normalized;
  }

  if (normalized === '>' || normalized === '<' || normalized === '=' || normalized === '>=') {
    return allowed.includes(normalized) ? normalized : null;
  }

  if (normalized === '<=') {
    return allowed.includes('<=') ? '<=' : null;
  }

  return null;
};

const deriveIntervalFromText = (text = '') => {
  if (typeof text !== 'string') {
    return {};
  }

  const cleaned = text.trim();
  if (!cleaned) {
    return {};
  }

  const numericPattern = /(-?\d+(?:[.,]\d+)?)/g;

  const rangeMatch = cleaned.match(/(-?\d+(?:[.,]\d+)?)\s*(?:-|to|–|—)\s*(-?\d+(?:[.,]\d+)?)/i);
  if (rangeMatch) {
    const lowRaw = rangeMatch[1].replace(',', '.');
    const highRaw = rangeMatch[2].replace(',', '.');
    const lowNum = Number.parseFloat(lowRaw);
    const highNum = Number.parseFloat(highRaw);

    if (Number.isFinite(lowNum) && Number.isFinite(highNum)) {
      const low = Math.min(lowNum, highNum);
      const high = Math.max(lowNum, highNum);
      return {
        reference_interval_low: low,
        reference_interval_high: high,
        reference_interval_low_operator: null,
        reference_interval_high_operator: null,
      };
    }
  }

  const greaterMatch = cleaned.match(/(>=|>|≧|≥)\s*(-?\d+(?:[.,]\d+)?)/);
  if (greaterMatch) {
    const op = sanitizeIntervalOperator(greaterMatch[1], ['>', '>=']);
    const value = Number.parseFloat(greaterMatch[2].replace(',', '.'));
    if (Number.isFinite(value)) {
      return {
        reference_interval_low: value,
        reference_interval_low_operator: op || '>=',
      };
    }
  }

  const lessMatch = cleaned.match(/(<=|<|≦|≤)\s*(-?\d+(?:[.,]\d+)?)/);
  if (lessMatch) {
    const op = sanitizeIntervalOperator(lessMatch[1], ['<', '<=']);
    const value = Number.parseFloat(lessMatch[2].replace(',', '.'));
    if (Number.isFinite(value)) {
      return {
        reference_interval_high: value,
        reference_interval_high_operator: op || '<=',
      };
    }
  }

  const numbers = cleaned.match(numericPattern);
  if (numbers && numbers.length === 1) {
    const single = Number.parseFloat(numbers[0].replace(',', '.'));
    if (Number.isFinite(single)) {
      return {
        reference_interval_low: single,
        reference_interval_low_operator: '>=',
      };
    }
  }

  return {};
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

  const baseResult = {
    patient_name: null,
    date_of_birth: null,
    checkup_date: null,
    vitamin_d_found: false,
    vitamin_d_results: [],
    raw_model_output: fallbackString,
  };

  if (!parsed) {
    return baseResult;
  }

  try {
    baseResult.patient_name = sanitizeTextField(parsed.patient_name, { maxLength: 120 });
    baseResult.date_of_birth = sanitizeDateField(parsed.date_of_birth);
    baseResult.checkup_date = sanitizeDateField(parsed.checkup_date);

    const rawResults = Array.isArray(parsed.vitamin_d_results)
      ? parsed.vitamin_d_results
      : [];

    const sanitizedResults = rawResults
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return null;
        }

        const analyteName = sanitizeTextField(entry.analyte_name, { maxLength: 120 });
        const value = toFiniteNumber(entry.value);

        let unit = sanitizeUnit(entry.unit);
        if (!unit) {
          unit = sanitizeUnit(detectUnitFromText(entry.unit))
            || sanitizeUnit(detectUnitFromText(entry.reference_interval_unit))
            || sanitizeUnit(detectUnitFromText(entry.reference_interval_text))
            || sanitizeUnit(detectUnitFromText(fallbackString));
        }

        let referenceIntervalLow = toFiniteNumber(entry.reference_interval_low);
        let referenceIntervalHigh = toFiniteNumber(entry.reference_interval_high);
        let referenceIntervalLowOperator = sanitizeIntervalOperator(
          entry.reference_interval_low_operator,
          ['>', '>=', '='],
        );
        let referenceIntervalHighOperator = sanitizeIntervalOperator(
          entry.reference_interval_high_operator,
          ['<', '<=', '='],
        );

        let referenceUnit = sanitizeUnit(entry.reference_interval_unit);
        if (!referenceUnit) {
          referenceUnit = sanitizeUnit(detectUnitFromText(entry.reference_interval_unit))
            || sanitizeUnit(detectUnitFromText(entry.reference_interval_text))
            || sanitizeUnit(detectUnitFromText(fallbackString));
        }

        const intervalFromText = deriveIntervalFromText(entry.reference_interval_text);
        if (referenceIntervalLow === null && typeof intervalFromText.reference_interval_low === 'number') {
          referenceIntervalLow = intervalFromText.reference_interval_low;
        }
        if (!referenceIntervalLowOperator && intervalFromText.reference_interval_low_operator) {
          referenceIntervalLowOperator = intervalFromText.reference_interval_low_operator;
        }
        if (referenceIntervalHigh === null && typeof intervalFromText.reference_interval_high === 'number') {
          referenceIntervalHigh = intervalFromText.reference_interval_high;
        }
        if (!referenceIntervalHighOperator && intervalFromText.reference_interval_high_operator) {
          referenceIntervalHighOperator = intervalFromText.reference_interval_high_operator;
        }

        if (
          typeof referenceIntervalLow === 'number'
          && typeof referenceIntervalHigh === 'number'
          && referenceIntervalLow > referenceIntervalHigh
        ) {
          const temp = referenceIntervalLow;
          referenceIntervalLow = referenceIntervalHigh;
          referenceIntervalHigh = temp;
          const tempOp = referenceIntervalLowOperator;
          referenceIntervalLowOperator = referenceIntervalHighOperator;
          referenceIntervalHighOperator = tempOp;
        }

        const referenceIntervalFound = typeof entry.reference_interval_found === 'boolean'
          ? entry.reference_interval_found
          : Boolean(
              referenceIntervalLow !== null
              || referenceIntervalHigh !== null
              || referenceIntervalLowOperator
              || referenceIntervalHighOperator
              || referenceUnit,
            );

        const hasContent =
          analyteName !== null
          || value !== null
          || unit
          || referenceIntervalLow !== null
          || referenceIntervalHigh !== null
          || referenceIntervalLowOperator
          || referenceIntervalHighOperator;

        if (!hasContent) {
          return null;
        }

        return {
          analyte_name: analyteName,
          value,
          unit,
          reference_interval_found: referenceIntervalFound,
          reference_interval_low: referenceIntervalLow,
          reference_interval_low_operator: referenceIntervalLowOperator,
          reference_interval_high: referenceIntervalHigh,
          reference_interval_high_operator: referenceIntervalHighOperator,
          reference_interval_unit: referenceUnit,
        };
      })
      .filter(Boolean);

    if (!sanitizedResults.length) {
      const legacyValue = toFiniteNumber(parsed.value);
      let legacyReferenceLow = toFiniteNumber(parsed.reference_interval_low);
      let legacyReferenceHigh = toFiniteNumber(parsed.reference_interval_high);
      let legacyReferenceLowOperator = sanitizeIntervalOperator(parsed.reference_interval_low_operator, ['>', '>=', '=']);
      let legacyReferenceHighOperator = sanitizeIntervalOperator(parsed.reference_interval_high_operator, ['<', '<=', '=']);

      let legacyUnit = sanitizeUnit(parsed.unit);
      if (!legacyUnit) {
        legacyUnit = sanitizeUnit(detectUnitFromText(parsed.unit))
          || sanitizeUnit(detectUnitFromText(parsed.reference_interval_unit))
          || sanitizeUnit(detectUnitFromText(parsed.reference_interval_text))
          || sanitizeUnit(detectUnitFromText(fallbackString));
      }

      let legacyReferenceUnit = sanitizeUnit(parsed.reference_interval_unit);
      if (!legacyReferenceUnit) {
        legacyReferenceUnit = sanitizeUnit(detectUnitFromText(parsed.reference_interval_unit))
          || sanitizeUnit(detectUnitFromText(parsed.reference_interval_text))
          || sanitizeUnit(detectUnitFromText(fallbackString));
      }

      const intervalFromText = deriveIntervalFromText(parsed.reference_interval_text);
      if (legacyReferenceLow === null && typeof intervalFromText.reference_interval_low === 'number') {
        legacyReferenceLow = intervalFromText.reference_interval_low;
      }
      if (!legacyReferenceLowOperator && intervalFromText.reference_interval_low_operator) {
        legacyReferenceLowOperator = intervalFromText.reference_interval_low_operator;
      }
      if (legacyReferenceHigh === null && typeof intervalFromText.reference_interval_high === 'number') {
        legacyReferenceHigh = intervalFromText.reference_interval_high;
      }
      if (!legacyReferenceHighOperator && intervalFromText.reference_interval_high_operator) {
        legacyReferenceHighOperator = intervalFromText.reference_interval_high_operator;
      }

      if (
        typeof legacyReferenceLow === 'number'
        && typeof legacyReferenceHigh === 'number'
        && legacyReferenceLow > legacyReferenceHigh
      ) {
        const temp = legacyReferenceLow;
        legacyReferenceLow = legacyReferenceHigh;
        legacyReferenceHigh = temp;
        const tempOp = legacyReferenceLowOperator;
        legacyReferenceLowOperator = legacyReferenceHighOperator;
        legacyReferenceHighOperator = tempOp;
      }

      const legacyHasContent =
        legacyValue !== null
        || legacyUnit
        || legacyReferenceLow !== null
        || legacyReferenceHigh !== null
        || legacyReferenceLowOperator
        || legacyReferenceHighOperator;

      if (legacyHasContent) {
        sanitizedResults.push({
          analyte_name: sanitizeTextField(parsed.analyte_name, { maxLength: 120 }),
          value: legacyValue,
          unit: legacyUnit,
          reference_interval_found: Boolean(parsed.reference_interval_found)
            || Boolean(
              legacyReferenceLow !== null
              || legacyReferenceHigh !== null
              || legacyReferenceLowOperator
              || legacyReferenceHighOperator
              || legacyReferenceUnit,
            ),
          reference_interval_low: legacyReferenceLow,
          reference_interval_low_operator: legacyReferenceLowOperator,
          reference_interval_high: legacyReferenceHigh,
          reference_interval_high_operator: legacyReferenceHighOperator,
          reference_interval_unit: legacyReferenceUnit,
        });
      }
    }

    baseResult.vitamin_d_results = sanitizedResults;

    const explicitVitaminFound = typeof parsed.vitamin_d_found === 'boolean'
      ? parsed.vitamin_d_found
      : null;

    baseResult.vitamin_d_found = explicitVitaminFound ?? sanitizedResults.length > 0;

    return baseResult;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[analyzeVitaminD] Unable to parse model output as JSON. Falling back to defaults.');
    return baseResult;
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
