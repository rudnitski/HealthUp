const express = require('express');
const OpenAI = require('openai');
const pdfParse = require('pdf-parse');
const os = require('os');
const fs = require('fs/promises');
const path = require('path');
const { promisify } = require('util');
const { execFile } = require('child_process');
const { persistLabReport, PersistLabReportError } = require('../services/reportPersistence');
const { loadPrompt } = require('../utils/promptLoader');

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
const DEFAULT_MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-5-mini';

const PIPELINE_STEPS = [
  { id: 'uploaded', label: 'Upload received' },
  { id: 'pdf_processing', label: 'Processing document' },
  { id: 'openai_request', label: 'Analyzing with AI' },
  { id: 'parsing', label: 'Parsing results' },
  { id: 'persistence', label: 'Saving results' },
  { id: 'completed', label: 'Completed' },
];

const systemPrompt = loadPrompt('lab_system_prompt.txt');
const userPrompt = loadPrompt('lab_user_prompt.txt');

const structuredOutputFormat = {
  type: 'json_schema',
  name: 'full_lab_extraction',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      patient_name: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      patient_age: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }] },
      patient_date_of_birth: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      patient_gender: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      test_date: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      parameters: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            parameter_name: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            result: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            unit: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            reference_interval: {
              type: 'object',
              additionalProperties: false,
              properties: {
                lower: { anyOf: [{ type: 'number' }, { type: 'null' }] },
                lower_operator: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                upper: { anyOf: [{ type: 'number' }, { type: 'null' }] },
                upper_operator: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                text: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                full_text: { anyOf: [{ type: 'string' }, { type: 'null' }] },
              },
              required: ['lower', 'lower_operator', 'upper', 'upper_operator', 'text', 'full_text'],
            },
            is_value_out_of_range: { type: 'boolean' },
            numeric_result: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          },
          required: [
            'parameter_name',
            'result',
            'unit',
            'reference_interval',
            'is_value_out_of_range',
            'numeric_result',
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
    required: ['patient_name', 'patient_age', 'patient_date_of_birth', 'patient_gender', 'test_date', 'parameters', 'missing_data'],
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

const sanitizeAgeField = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toString();
  }

  return sanitizeTextField(value, { maxLength: 32 });
};

const sanitizeUnit = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.normalize('NFKC').trim();
  if (!normalized) {
    return null;
  }

  const withoutControls = normalized.replace(/[\p{C}]/gu, '');
  const cleaned = withoutControls.replace(/[^\p{L}\p{N}\s%/().,\-·+*^_]/gu, '');
  const finalText = cleaned.trim();

  if (!finalText) {
    return null;
  }

  return finalText.slice(0, 32);
};

const sanitizeComparator = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const compact = value.replace(/\s+/g, '').toLowerCase();
  const mapping = {
    '>': '>',
    '>=': '>=',
    '≥': '>=',
    '=>': '>=',
    '<': '<',
    '<=': '<=',
    '≤': '<=',
    '=<': '<=',
    '=': '=',
  };

  return mapping[compact] || null;
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

const sanitizeReferenceInterval = (value) => {
  if (!value || typeof value !== 'object') {
    return { lower: null, upper: null, text: null, full_text: null };
  }

  const lower = toFiniteNumber(value.lower);
  const upper = toFiniteNumber(value.upper);
  const lowerOperator = sanitizeComparator(value.lower_operator);
  const upperOperator = sanitizeComparator(value.upper_operator);
  const text = sanitizeTextField(value.text, { maxLength: 160 });
  const fullText = sanitizeTextField(value.full_text, { maxLength: 280 });

  return {
    lower,
    lower_operator: lowerOperator,
    upper,
    upper_operator: upperOperator,
    text,
    full_text: fullText,
  };
};

const sanitizeParameterEntry = (entry) => {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const parameterName = sanitizeTextField(entry.parameter_name, { maxLength: 120 });
  const unit = sanitizeUnit(entry.unit);
  const referenceInterval = sanitizeReferenceInterval(entry.reference_interval);
  const numericValue = toFiniteNumber(entry.value);
  const valueText = sanitizeTextField(entry.value_text, { maxLength: 120 });

  let result = null;
  let numericResult = null;

  if (typeof entry.result === 'number' && Number.isFinite(entry.result)) {
    result = entry.result.toString();
    numericResult = entry.result;
  } else {
    const cleanedResult = sanitizeTextField(entry.result, { maxLength: 160 });
    if (cleanedResult) {
      result = cleanedResult;
      const numericCandidate = Number(cleanedResult.replace(',', '.'));
      if (Number.isFinite(numericCandidate)) {
        numericResult = numericCandidate;
      }
    }
  }

  if (!result) {
    const resultParts = [];
    if (numericValue !== null) {
      resultParts.push(numericValue.toString());
      numericResult = numericValue;
    }
    if (valueText) {
      resultParts.push(valueText);
    }

    if (resultParts.length) {
      result = resultParts.join(' ').trim() || null;
    }
  }

  const hasContent =
    parameterName !== null
    || result !== null
    || unit !== null
    || referenceInterval.lower !== null
    || referenceInterval.lower_operator !== null
    || referenceInterval.upper !== null
    || referenceInterval.upper_operator !== null
    || referenceInterval.text !== null
    || referenceInterval.full_text !== null;

  if (!hasContent) {
    return null;
  }

  const lowerOperator = referenceInterval.lower_operator;
  const upperOperator = referenceInterval.upper_operator;
  const lowerBound = referenceInterval.lower;
  const upperBound = referenceInterval.upper;

  const evaluateBound = (value, bound, operator, { fallback } = {}) => {
    if (value === null || bound === null) {
      return true;
    }

    const effectiveOperator = operator || (fallback === 'lower' ? '>=' : fallback === 'upper' ? '<=' : '=');

    switch (effectiveOperator) {
      case '>':
        return value > bound;
      case '>=':
        return value >= bound;
      case '<':
        return value < bound;
      case '<=':
        return value <= bound;
      case '=':
        return value === bound;
      default:
        return true;
    }
  };

  const isWithinLower = evaluateBound(numericResult, lowerBound, lowerOperator, { fallback: 'lower' });
  const isWithinUpper = evaluateBound(numericResult, upperBound, upperOperator, { fallback: 'upper' });
  const isWithinRange = numericResult === null ? true : (isWithinLower && isWithinUpper);

  return {
    parameter_name: parameterName,
    result,
    unit,
    reference_interval: referenceInterval,
    is_value_out_of_range: !isWithinRange,
    numeric_result: numericResult,
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
    patient_age: null,
    patient_date_of_birth: null,
    patient_gender: null,
    test_date: null,
    parameters: [],
    missing_data: [],
    raw_model_output: fallbackString,
  };

  if (!parsed) {
    return baseResult;
  }

  try {
    const parameters = sanitizeParameters(parsed.parameters);

    const rawDob = parsed.patient_date_of_birth ?? parsed.date_of_birth;
    const rawGender = parsed.patient_gender ?? parsed.gender;

    const ageCandidates = [
      parsed.patient_age,
      parsed.age,
      parsed.patient_age_years,
      parsed?.demographics?.age,
    ];
    const rawAge = ageCandidates.find((candidate) => {
      if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        return true;
      }
      return typeof candidate === 'string' && candidate.trim();
    });

    let rawTestDate = parsed.test_date;
    if (!rawTestDate && parsed.lab_dates && typeof parsed.lab_dates === 'object') {
      const primaryDate = parsed.lab_dates.primary_test_date;
      const secondaryDate = Array.isArray(parsed.lab_dates.secondary_dates)
        ? parsed.lab_dates.secondary_dates
            .map((entry) => (entry && typeof entry === 'object' ? entry.value : null))
            .find((value) => typeof value === 'string' && value.trim())
        : null;

      rawTestDate = primaryDate || secondaryDate || null;
    }

    return {
      patient_name: sanitizeTextField(parsed.patient_name, { maxLength: 160 }),
      patient_age: sanitizeAgeField(rawAge),
      patient_date_of_birth: sanitizeDateField(rawDob),
      patient_gender: sanitizeTextField(rawGender, { maxLength: 24 }),
      test_date: sanitizeDateField(rawTestDate),
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
  markStep('persistence', 'in_progress');

  const processedAt = new Date();

  try {
    const persistenceResult = await persistLabReport({
      fileBuffer,
      filename: sanitizedFilename,
      parserVersion: requestPayload.model,
      processedAt,
      coreResult,
    });

    markStep('persistence', 'completed');

    // Run dry-run mapping if enabled (PRD v0.9)
    if (process.env.ENABLE_MAPPING_DRY_RUN === 'true') {
      try {
        const { dryRun } = require('../services/MappingApplier');

        await dryRun({
          report_id: persistenceResult.reportId,
          patient_id: persistenceResult.patientId,
          // Optional: pass LLM suggestions if available (v1.0+)
          analyte_suggestions: null,
        });

        // Logs are emitted via Pino logger (structured JSON)
        // No need to include in HTTP response
      } catch (mappingError) {
        // eslint-disable-next-line no-console
        console.error('[analyzeLabReport] Mapping dry-run failed (non-fatal):', mappingError);
        // Continue - don't fail the request if mapping dry-run fails
      }
    }

    markStep('completed');

    const responsePayload = {
      report_id: persistenceResult.reportId,
      patient_id: persistenceResult.patientId,
      checksum: persistenceResult.checksum,
      user_id: null,
      processed_at: processedAt.toISOString(),
      ...coreResult,
      progress: pipelineProgress,
    };

    return res.json(responsePayload);
  } catch (error) {
    // eslint-disable-next-line no-console
    if (error instanceof PersistLabReportError) {
      console.error('[analyzeLabReport] Failed to persist lab report:', {
        message: error.message,
        context: error.context,
        cause: error.cause?.message,
      });
    } else {
      console.error('[analyzeLabReport] Failed to persist lab report:', error);
    }
    markStep('persistence', 'failed', 'Unable to save results');
    markStep('completed', 'failed', 'Unable to save results');
    return res.status(500).json({ error: 'Unable to save lab report results. Please try again.', progress: pipelineProgress });
  }
});

module.exports = router;
