const express = require('express');
const OpenAI = require('openai');
const pdfParse = require('pdf-parse');
const os = require('os');
const fs = require('fs/promises');
const path = require('path');
const { promisify } = require('util');
const { execFile } = require('child_process');
const { randomUUID } = require('crypto');

const router = express.Router();

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_PDF_PAGES = 10;
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

const PIPELINE_STEPS = [
  { id: 'uploaded', label: 'Upload received' },
  { id: 'pdf_processing', label: 'Processing document' },
  { id: 'openai_request', label: 'Analyzing with AI' },
  { id: 'parsing', label: 'Parsing results' },
  { id: 'completed', label: 'Completed' },
];

const systemPrompt = [
  'You are a medical document analyzer for HealthUp.',
  'Extract every laboratory parameter, relevant metadata, and reference information from the provided lab report.',
  'Return JSON that strictly conforms to the supplied schema. Do not include commentary.',
].join(' ');

const userPrompt = [
  'You will receive either images or PDF pages of a laboratory report.',
  'Return JSON with the following top-level fields:',
  '- patient_name (string or null)',
  '- date_of_birth (string or null)',
  '- status (string; choose one of: success, needs_review, failed)',
  '- lab_dates (object with: primary_test_date, primary_test_date_source, secondary_dates)',
  '- summary (object with: parameters_total, parameters_flagged)',
  '- parameters (array of laboratory parameters)',
  '- missing_data (array describing missing fields per parameter)',
  '',
  'lab_dates:',
  '- primary_test_date: string or null. Prefer the specimen collection or draw date.',
  '- primary_test_date_source: string or null describing the field name used (e.g., "collection_date", "results_ready").',
  '- secondary_dates: array of objects with fields type, value, source_text (strings or null) capturing other lab-provided dates such as received, processed, released.',
  '',
  'Each entry in parameters must include:',
  '- parameter_name (string or null; copy the label as written in the report)',
  '- canonical_code (string or null; use LOINC or lab code when present)',
  '- value (number or null for numeric measurements)',
  '- value_text (string or null for qualitative results)',
  '- unit (string or null)',
  '- reference_interval (object with lower, upper, text; numbers or null for bounds, string or null for text)',
  '- lab_flag (string or null; include flags like H, L, High, Low, Critical)',
  '- out_of_range (string or null; allowed values: above, below, within, flagged_by_lab, unknown)',
  '- specimen (string or null)',
  '- page (integer or null; page numbers start at 1)',
  '- notes (string or null; add interpretive comments if present)',
  '',
  'missing_data is an array. Each item has:',
  '- parameter_name (string or null)',
  '- missing_fields (array of strings indicating absent details such as "unit", "reference_interval", "value")',
  '',
  'Rules:',
  '- Only output JSON.',
  '- Include every parameter even if fields are missing.',
  '- Preserve the source language and casing for text.',
  '- Use ISO-8601 (YYYY-MM-DD) when a date is unambiguous; otherwise copy the exact text.',
  '- Set numeric fields to null when a number is not provided.',
  '- When a result is qualitative, set value to null and store the phrase in value_text.',
  '- If you cannot determine out_of_range, use "unknown".',
  '- When multiple reference intervals exist, choose the one matching the reported result when possible; otherwise copy the interval text.',
].join('\n');

const structuredOutputFormat = {
  type: 'json_schema',
  name: 'full_lab_extraction',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      patient_name: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      date_of_birth: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      status: {
        type: 'string',
        enum: ['success', 'needs_review', 'failed'],
      },
      lab_dates: {
        type: 'object',
        additionalProperties: false,
        properties: {
          primary_test_date: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          primary_test_date_source: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          secondary_dates: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                type: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                value: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                source_text: { anyOf: [{ type: 'string' }, { type: 'null' }] },
              },
              required: ['type', 'value', 'source_text'],
            },
          },
        },
        required: ['primary_test_date', 'primary_test_date_source', 'secondary_dates'],
      },
      summary: {
        type: 'object',
        additionalProperties: false,
        properties: {
          parameters_total: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
          parameters_flagged: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
        },
        required: ['parameters_total', 'parameters_flagged'],
      },
      parameters: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            parameter_name: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            canonical_code: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            value: { anyOf: [{ type: 'number' }, { type: 'null' }] },
            value_text: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            unit: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            reference_interval: {
              type: 'object',
              additionalProperties: false,
              properties: {
                lower: { anyOf: [{ type: 'number' }, { type: 'null' }] },
                upper: { anyOf: [{ type: 'number' }, { type: 'null' }] },
                text: { anyOf: [{ type: 'string' }, { type: 'null' }] },
              },
              required: ['lower', 'upper', 'text'],
            },
            lab_flag: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            out_of_range: {
              anyOf: [
                { type: 'null' },
                {
                  type: 'string',
                  enum: ['above', 'below', 'within', 'flagged_by_lab', 'unknown'],
                },
              ],
            },
            specimen: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            page: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
            notes: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          },
          required: [
            'parameter_name',
            'canonical_code',
            'value',
            'value_text',
            'unit',
            'reference_interval',
            'lab_flag',
            'out_of_range',
            'specimen',
            'page',
            'notes',
          ],
        },
      },
      missing_data: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            parameter_name: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            missing_fields: {
              type: 'array',
              items: { type: 'string' },
            },
          },
          required: ['parameter_name', 'missing_fields'],
        },
      },
    },
    required: ['patient_name', 'date_of_birth', 'status', 'lab_dates', 'summary', 'parameters', 'missing_data'],
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

const sanitizeTextField = (value, { maxLength = 160 } = {}) => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return null;
  }

  return normalized.slice(0, maxLength);
};

const sanitizeDateField = (value) => sanitizeTextField(value, { maxLength: 48 });

const sanitizeShortCode = (value, { maxLength = 40 } = {}) => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, maxLength);
};

const sanitizeUnit = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const cleaned = trimmed.replace(/[^a-zA-Z0-9/%().,\-\s]/g, '');
  if (!cleaned.trim()) {
    return null;
  }

  return cleaned.slice(0, 32);
};

const sanitizeLabFlag = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, 24);
};

const ALLOWED_OUT_OF_RANGE = new Set(['above', 'below', 'within', 'flagged_by_lab', 'unknown']);

const sanitizeOutOfRange = (value) => {
  if (typeof value !== 'string') {
    return 'unknown';
  }

  const trimmed = value.trim().toLowerCase();
  if (ALLOWED_OUT_OF_RANGE.has(trimmed)) {
    return trimmed;
  }

  return 'unknown';
};

const toFiniteNumber = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }

  return null;
};

const toInteger = (value) => {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const numeric = Number.parseInt(value, 10);
    if (Number.isInteger(numeric)) {
      return numeric;
    }
  }

  return null;
};

const sanitizeReferenceInterval = (value) => {
  if (!value || typeof value !== 'object') {
    return { lower: null, upper: null, text: null };
  }

  const lower = toFiniteNumber(value.lower);
  const upper = toFiniteNumber(value.upper);
  const text = sanitizeTextField(value.text, { maxLength: 120 });

  return {
    lower,
    upper,
    text,
  };
};

const sanitizeSecondaryDates = (items) => {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }

      const type = sanitizeShortCode(entry.type, { maxLength: 48 });
      const value = sanitizeDateField(entry.value);
      const sourceText = sanitizeTextField(entry.source_text, { maxLength: 120 });

      if (!type && !value && !sourceText) {
        return null;
      }

      return {
        type: type || null,
        value: value || null,
        source_text: sourceText || null,
      };
    })
    .filter(Boolean);
};

const sanitizeLabDates = (value) => {
  const labDates = value && typeof value === 'object' ? value : {};

  const primary = sanitizeDateField(labDates.primary_test_date);
  const source = sanitizeShortCode(labDates.primary_test_date_source, { maxLength: 48 });
  const secondary = sanitizeSecondaryDates(labDates.secondary_dates);

  return {
    primary_test_date: primary || null,
    primary_test_date_source: source || null,
    secondary_dates: secondary,
  };
};

const sanitizeParameterEntry = (entry) => {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const parameterName = sanitizeTextField(entry.parameter_name, { maxLength: 120 });
  const canonicalCode = sanitizeShortCode(entry.canonical_code, { maxLength: 64 });
  const value = toFiniteNumber(entry.value);
  const valueText = sanitizeTextField(entry.value_text, { maxLength: 120 });
  const unit = sanitizeUnit(entry.unit);
  const referenceInterval = sanitizeReferenceInterval(entry.reference_interval);
  const labFlag = sanitizeLabFlag(entry.lab_flag);
  const outOfRangeRaw = entry.out_of_range === null ? null : sanitizeOutOfRange(entry.out_of_range);
  const specimen = sanitizeTextField(entry.specimen, { maxLength: 120 });
  const page = toInteger(entry.page);
  const notes = sanitizeTextField(entry.notes, { maxLength: 200 });

  const hasContent =
    parameterName !== null
    || canonicalCode !== null
    || value !== null
    || valueText !== null
    || unit !== null
    || referenceInterval.lower !== null
    || referenceInterval.upper !== null
    || referenceInterval.text !== null
    || labFlag !== null
    || specimen !== null
    || page !== null
    || notes !== null;

  if (!hasContent) {
    return null;
  }

  return {
    parameter_name: parameterName,
    canonical_code: canonicalCode,
    value,
    value_text: valueText,
    unit,
    reference_interval: referenceInterval,
    lab_flag: labFlag,
    out_of_range: outOfRangeRaw,
    specimen,
    page,
    notes,
  };
};

const sanitizeParameters = (items) => {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map(sanitizeParameterEntry)
    .filter(Boolean);
};

const sanitizeSummary = (value, parameters) => {
  const total = Array.isArray(parameters) ? parameters.length : 0;
  const flagged = Array.isArray(parameters)
    ? parameters.filter((item) => ['above', 'below', 'flagged_by_lab'].includes(item.out_of_range)).length
    : 0;

  const summary = value && typeof value === 'object' ? value : {};
  const providedTotal = toInteger(summary.parameters_total);
  const providedFlagged = toInteger(summary.parameters_flagged);

  return {
    parameters_total: providedTotal ?? total,
    parameters_flagged: providedFlagged ?? flagged,
  };
};

const sanitizeMissingData = (items) => {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }

      const parameterName = sanitizeTextField(entry.parameter_name, { maxLength: 120 });
      const missingFields = Array.isArray(entry.missing_fields)
        ? entry.missing_fields
            .map((field) => (typeof field === 'string' ? field.trim() : ''))
            .filter(Boolean)
            .slice(0, 10)
        : [];

      if (!parameterName && missingFields.length === 0) {
        return null;
      }

      return {
        parameter_name: parameterName,
        missing_fields: missingFields,
      };
    })
    .filter(Boolean);
};

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
    status: 'needs_review',
    lab_dates: {
      primary_test_date: null,
      primary_test_date_source: null,
      secondary_dates: [],
    },
    summary: {
      parameters_total: 0,
      parameters_flagged: 0,
    },
    parameters: [],
    missing_data: [],
    raw_model_output: fallbackString,
  };

  if (!parsed) {
    return baseResult;
  }

  try {
    const parameters = sanitizeParameters(parsed.parameters);
    const summary = sanitizeSummary(parsed.summary, parameters);

    return {
      patient_name: sanitizeTextField(parsed.patient_name, { maxLength: 160 }),
      date_of_birth: sanitizeDateField(parsed.date_of_birth),
      status: ['success', 'needs_review', 'failed'].includes(parsed.status) ? parsed.status : 'needs_review',
      lab_dates: sanitizeLabDates(parsed.lab_dates),
      summary,
      parameters,
      missing_data: sanitizeMissingData(parsed.missing_data),
      raw_model_output: fallbackString,
    };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[analyzeLabReport] Unable to parse model output as JSON. Falling back to defaults.');
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

const execFileAsync = promisify(execFile);
const PDFTOPPM_BIN = process.env.PDFTOPPM_PATH || 'pdftoppm';

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

const buildImageContent = (fileBuffer, mimetype) => ({
  type: 'input_image',
  image_url: `data:${mimetype};base64,${fileBuffer.toString('base64')}`,
});

const convertPdfToImageDataUrls = async (buffer, pageCount, filenameHint = 'upload.pdf') => {
  const tempDirPrefix = path.join(os.tmpdir(), 'lab-report-');
  const workingDir = await fs.mkdtemp(tempDirPrefix);
  const baseName = filenameHint.toLowerCase().endsWith('.pdf') ? filenameHint : `${filenameHint}.pdf`;
  const pdfPath = path.join(workingDir, baseName);
  const outPrefixBase = path.join(workingDir, `lab-${Date.now()}`);

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

  const pipelineProgress = [];
  const markStep = (id, status = 'completed', message = null) => {
    const meta = PIPELINE_STEPS.find((step) => step.id === id);
    pipelineProgress.push({
      id,
      label: meta ? meta.label : id,
      status,
      message,
      timestamp: new Date().toISOString(),
    });
  };

  markStep('uploaded');

  const uploadedFile = req?.files?.[FILE_FIELD_NAME] || Object.values(req?.files || {})[0];

  if (!uploadedFile || Array.isArray(uploadedFile)) {
    markStep('completed', 'failed', 'No file provided');
    return res.status(400).json({ error: 'A single file is required.', progress: pipelineProgress });
  }

  const { data: fileBuffer, mimetype, name, size } = uploadedFile;

  if (!ALLOWED_MIME_TYPES.has(mimetype)) {
    markStep('completed', 'failed', 'Unsupported file type');
    return res.status(400).json({ error: 'Unsupported file type. Please upload an image or PDF.', progress: pipelineProgress });
  }

  if (size > MAX_FILE_SIZE_BYTES) {
    markStep('completed', 'failed', 'File exceeds size limit');
    return res.status(413).json({ error: 'File is too large. Maximum size is 10MB.', progress: pipelineProgress });
  }

  const sanitizedFilename = typeof name === 'string' && name ? name.slice(0, 64) : 'upload';

  let pdfPageCount = 0;

  if (mimetype === 'application/pdf') {
    try {
      markStep('pdf_processing', 'in_progress');
      pdfPageCount = await ensurePdfWithinPageLimit(fileBuffer);
    } catch (error) {
      const status = error.statusCode || 400;
      markStep('pdf_processing', 'failed', error.message);
      markStep('completed', 'failed', error.message);
      return res.status(status).json({ error: error.message, progress: pipelineProgress });
    }
  } else {
    markStep('pdf_processing', 'completed', 'Skipped for image input');
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const userContent = [{ type: 'input_text', text: userPrompt }];

  if (mimetype === 'application/pdf') {
    try {
      const pdfFilename = sanitizedFilename.toLowerCase().endsWith('.pdf')
        ? sanitizedFilename
        : `${sanitizedFilename}.pdf`;

      const imageDataUrls = await convertPdfToImageDataUrls(fileBuffer, pdfPageCount, pdfFilename);
      markStep('pdf_processing', 'completed');

      imageDataUrls.forEach((imageUrl) => {
        userContent.push({ type: 'input_image', image_url: imageUrl });
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[analyzeLabReport] Unable to convert PDF to images:', {
        message: error?.message,
      });

      markStep('pdf_processing', 'failed', error?.message || 'Unable to convert PDF');
      markStep('completed', 'failed', error?.message || 'Unable to convert PDF');

      if (error?.code === 'ENOENT') {
        const guidance = [
          'PDF conversion tool not found (pdftoppm).',
          'Install Poppler and ensure `pdftoppm` is on your PATH or set PDFTOPPM_PATH in .env.',
          'On macOS with Homebrew: `brew install poppler`',
          'On Debian/Ubuntu: `sudo apt-get install poppler-utils`',
        ].join(' ');
        return res.status(500).json({ error: guidance, progress: pipelineProgress });
      }

      return res.status(502).json({ error: 'Unable to convert PDF for analysis. Try again later or upload an image.', progress: pipelineProgress });
    }
  } else {
    userContent.push(buildImageContent(fileBuffer, mimetype));
  }

  markStep('openai_request', 'in_progress');

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
      source: 'full-lab-extraction',
      filename: sanitizedFilename,
    },
  };

  const callVision = async () => {
    try {
      return await client.responses.parse(requestPayload);
    } catch (error) {
      if (error instanceof SyntaxError) {
        return client.responses.create(requestPayload);
      }

      throw error;
    }
  };

  let openAiResponse;

  try {
    openAiResponse = await withRetry(callVision);
    markStep('openai_request', 'completed');
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[analyzeLabReport] Vision API request failed:', {
      message: error?.message,
      status: error?.response?.status,
    });

    markStep('openai_request', 'failed', error?.message || 'Vision API error');
    markStep('completed', 'failed', 'Vision API error');
    return res.status(502).json({ error: 'Vision API error', progress: pipelineProgress });
  }

  markStep('parsing', 'in_progress');
  const parsedPayload = openAiResponse?.output_parsed;
  const outputText = extractOutputText(openAiResponse);

  const coreResult = parsedPayload
    ? parseVisionResponse(parsedPayload, outputText)
    : parseVisionResponse(outputText, outputText);
  markStep('parsing', 'completed');
  markStep('completed');

  const responsePayload = {
    report_id: randomUUID(),
    user_id: null,
    processed_at: new Date().toISOString(),
    ...coreResult,
    progress: pipelineProgress,
  };

  return res.json(responsePayload);
});

module.exports = router;
