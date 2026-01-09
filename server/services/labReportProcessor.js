/**
 * Lab Report Processing Service
 *
 * Handles the actual processing of lab reports in the background.
 * Extracted from analyzeLabReport route to support async job processing.
 */

import OpenAI from 'openai';
import { PDFParse } from 'pdf-parse';
import os from 'os';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import { execFile } from 'child_process';
import { persistLabReport, PersistLabReportError } from './reportPersistence.js';
import { loadPrompt } from '../utils/promptLoader.js';
import { updateJob, updateProgress, setJobResult, setJobError, JobStatus } from '../utils/jobManager.js';
import VisionProviderFactory from './vision/VisionProviderFactory.js';
import { getDirname } from '../utils/path-helpers.js';
import { wetRun } from './MappingApplier.js';
import { normalizeUnitsBatch } from './unitNormalizer.js';
import { adminPool } from '../db/index.js';
import logger from '../utils/logger.js';
import { normalizeTestDate } from '../utils/dateParser.js';

const __dirname = getDirname(import.meta.url);

const MAX_PDF_PAGES = 10;
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
]);
const OCR_PROVIDER = process.env.OCR_PROVIDER || 'openai';

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
            specimen_type: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          },
          required: [
            'parameter_name',
            'result',
            'unit',
            'reference_interval',
            'is_value_out_of_range',
            'numeric_result',
            'specimen_type',
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

// Retry logic moved to VisionProvider base class

// Sanitization functions (copied from analyzeLabReport.js)
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

const VALID_SPECIMEN_TYPES = new Set(['blood', 'urine']);

const sanitizeSpecimenType = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.toLowerCase().trim();
  return VALID_SPECIMEN_TYPES.has(normalized) ? normalized : null;
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
      const strippedForNumeric = cleanedResult.replace(/[*]+/g, '').trim().replace(',', '.');
      if (strippedForNumeric && /\d/.test(strippedForNumeric)) {
        const numericCandidate = Number(strippedForNumeric);
        if (Number.isFinite(numericCandidate)) {
          numericResult = numericCandidate;
        }
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
    specimen_type: sanitizeSpecimenType(entry.specimen_type),
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
      test_date_normalized: normalizeTestDate(rawTestDate),
      parameters,
      missing_data: sanitizeMissingData(parsed.missing_data),
      raw_model_output: fallbackString,
    };
  } catch (error) {
    console.warn('[labReportProcessor] Unable to parse model output as JSON. Falling back to defaults.');
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
    // pdf-parse v2 uses class-based API
    const parser = new PDFParse({ data: buffer });
    const info = await parser.getInfo();
    const totalPages = Number(info?.total) || 0;

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

    // Log the actual error for debugging
    logger.error(`[labReportProcessor] PDF inspection failed: ${error.message}`, { stack: error.stack });

    const wrapped = new Error(`Unable to inspect PDF: ${error.message}`);
    wrapped.statusCode = 422;
    wrapped.originalError = error;
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
      '-scale-to', '2048', // Increased from 1024 to 2048 for better OCR accuracy
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

/**
 * Process a lab report file
 * @param {object} params - Processing parameters
 * @param {string} params.jobId - Job ID for tracking
 * @param {Buffer} params.fileBuffer - File data
 * @param {string} params.mimetype - File MIME type
 * @param {string} params.filename - Original filename
 * @param {number} params.fileSize - File size in bytes
 * @param {string} params.userId - User ID for RLS context (PRD v4.4.3)
 * @returns {Promise<object>} Processing result
 */
async function processLabReport({ jobId, fileBuffer, mimetype, filename, fileSize, userId }) {
  const logPrefix = `[labReportProcessor:${jobId}]`;

  try {
    console.log(`${logPrefix} Starting processing`);

    // Update job status to processing
    updateJob(jobId, JobStatus.PROCESSING);
    updateProgress(jobId, 5, 'File uploaded');

    // Validate file
    if (!ALLOWED_MIME_TYPES.has(mimetype)) {
      throw new Error('Unsupported file type. Please upload an image or PDF.');
    }

    const sanitizedFilename = typeof filename === 'string' && filename ? filename.slice(0, 64) : 'upload';
    let pdfPageCount = 0;

    // Process PDF
    if (mimetype === 'application/pdf') {
      updateProgress(jobId, 10, 'Processing PDF');

      try {
        pdfPageCount = await ensurePdfWithinPageLimit(fileBuffer);
        updateProgress(jobId, 20, `Processing ${pdfPageCount} page(s)`);
      } catch (error) {
        throw new Error(`PDF processing failed: ${error.message}`);
      }
    }

    // Initialize vision provider (with fallback support if enabled)
    updateProgress(jobId, 25, 'Preparing analysis');

    const provider = VisionProviderFactory.createWithFallback();
    provider.validateConfig();

    console.log(`${logPrefix} Using OCR provider: ${OCR_PROVIDER.toUpperCase()} (fallback: ${process.env.VISION_FALLBACK_ENABLED === 'true' ? 'enabled' : 'disabled'})`);

    // Prepare images for analysis (provider-specific handling)
    let imageDataUrls = [];
    let analysisOptions = {};

    // Check if native PDF input should be used
    // Anthropic: Always use native PDF
    // OpenAI: Only if OPENAI_USE_NATIVE_PDF=true (experimental for gpt-5-mini)
    const shouldUseNativePdf = mimetype === 'application/pdf' && (
      OCR_PROVIDER === 'anthropic' ||
      (OCR_PROVIDER === 'openai' && process.env.OPENAI_USE_NATIVE_PDF === 'true')
    );

    if (shouldUseNativePdf) {
      const providerName = OCR_PROVIDER.toUpperCase();
      const experimentalNote = OCR_PROVIDER === 'openai' ? ' (experimental)' : '';
      console.log(`${logPrefix} Using native PDF input for ${providerName}${experimentalNote} (full quality, no conversion)`);
      updateProgress(jobId, 30, 'Preparing PDF for analysis');

      // Pass PDF buffer directly to provider
      analysisOptions = {
        pdfBuffer: fileBuffer,
        mimetype: 'application/pdf',
        filename: sanitizedFilename,
      };

      updateProgress(jobId, 35, 'PDF ready for analysis');
    } else if (mimetype === 'application/pdf') {
      // Convert PDF to images (fallback or default for OpenAI)
      updateProgress(jobId, 30, 'Converting PDF to images');

      try {
        const pdfFilename = sanitizedFilename.toLowerCase().endsWith('.pdf')
          ? sanitizedFilename
          : `${sanitizedFilename}.pdf`;

        imageDataUrls = await convertPdfToImageDataUrls(fileBuffer, pdfPageCount, pdfFilename);

        updateProgress(jobId, 35, 'PDF converted to images');
      } catch (error) {
        if (error?.code === 'ENOENT') {
          throw new Error('PDF conversion tool not found (pdftoppm). Install Poppler utils.');
        }

        throw new Error(`Unable to convert PDF: ${error.message}`);
      }
    } else {
      // Native image file
      const imageContent = buildImageContent(fileBuffer, mimetype);
      imageDataUrls = [imageContent.image_url];
    }

    // Call Vision API via provider
    updateProgress(jobId, 40, `Analyzing with ${OCR_PROVIDER.toUpperCase()}`);

    let analysisResult;

    try {
      // Pass progress callback to provider for fallback UI updates
      const analysisOptionsWithProgress = {
        ...analysisOptions,
        onProgressUpdate: (percentage, message) => {
          updateProgress(jobId, percentage, message);
        },
      };

      analysisResult = await provider.analyze(
        imageDataUrls,
        systemPrompt,
        userPrompt,
        structuredOutputFormat.schema,
        analysisOptionsWithProgress
      );
      updateProgress(jobId, 70, 'AI analysis completed');
    } catch (error) {
      console.error(`${logPrefix} Vision API request failed:`, {
        message: error?.message,
        status: error?.response?.status || error?.status,
      });

      throw new Error(`Vision API error: ${error.message}`);
    }

    // Parse response
    updateProgress(jobId, 75, 'Parsing results');

    const coreResult = parseVisionResponse(
      analysisResult,
      JSON.stringify(analysisResult)
    );

    updateProgress(jobId, 80, 'Saving results');

    const processedAt = new Date();

    // Persist to database
    let persistenceResult;
    try {
      persistenceResult = await persistLabReport({
        fileBuffer,
        filename: sanitizedFilename,
        mimetype,
        parserVersion: `${OCR_PROVIDER}:${provider.model}`,
        processedAt,
        coreResult,
        userId, // PRD v4.4.3: Pass userId for RLS context
      });

      updateProgress(jobId, 85, 'Results saved');
    } catch (error) {
      console.error(`${logPrefix} Failed to persist lab report:`, {
        message: error.message,
        context: error.context,
        cause: error.cause?.message,
      });

      throw new Error(`Unable to save lab report: ${error.message}`);
    }

    // PRD v4.8.2: Post-persistence unit normalization (LLM fallback)
    updateProgress(jobId, 87, 'Normalizing units');

    try {
      // Fetch lab_results for this report (with auto-generated IDs)
      // Use adminPool to bypass RLS - we're querying our own just-persisted data
      const { rows: labResultRows } = await adminPool.query(
        `SELECT id, unit, parameter_name FROM lab_results
         WHERE report_id = $1
         AND unit IS NOT NULL
         AND unit <> ''`,
        [persistenceResult.reportId]
      );

      if (labResultRows.length > 0) {
        const unitsToNormalize = labResultRows.map(row => ({
          unit: row.unit,           // RAW OCR unit (stored in DB)
          resultId: row.id,         // Actual auto-generated UUID from lab_results
          parameterName: row.parameter_name  // Context for LLM normalization
        }));

        const normalizationCache = await normalizeUnitsBatch(unitsToNormalize);

        logger.info({
          report_id: persistenceResult.reportId,
          total_units: unitsToNormalize.length,
          unique_units: normalizationCache.size
        }, '[unitNormalizer] Unit normalization completed');
      }
    } catch (normalizationError) {
      // Non-fatal: units will use raw values until manually mapped
      logger.error({
        error: normalizationError.message,
        report_id: persistenceResult.reportId
      }, `${logPrefix} Unit normalization failed (non-fatal)`);
    }

    // Run automatic analyte mapping
    updateProgress(jobId, 90, 'Mapping analytes');

    try {
      console.log(`${logPrefix} Starting mapping for report:`, persistenceResult.reportId);

      const mappingResult = await wetRun({
        reportId: persistenceResult.reportId,
        patientId: persistenceResult.patientId,
        userId,
      });

      console.log(`${logPrefix} Mapping completed:`, {
        report_id: persistenceResult.reportId,
        written: mappingResult.summary.written,
        queued: mappingResult.summary.new_queued,
        queued_for_review: mappingResult.summary.queued_for_review,
      });

      updateProgress(jobId, 95, 'Analyte mapping completed');
    } catch (mappingError) {
      console.error(`${logPrefix} Mapping failed (non-fatal):`, {
        error: mappingError.message,
        stack: mappingError.stack,
        report_id: persistenceResult.reportId
      });
      // Continue - don't fail the job if mapping fails
    }

    // Prepare final result
    updateProgress(jobId, 100, 'Completed');

    const result = {
      report_id: persistenceResult.reportId,
      patient_id: persistenceResult.patientId,
      checksum: persistenceResult.checksum,
      user_id: userId, // PRD v4.4.3: Include userId in result
      processed_at: processedAt.toISOString(),
      ...coreResult,
    };

    console.log(`${logPrefix} Processing completed successfully`);

    setJobResult(jobId, result);

    return result;
  } catch (error) {
    console.error(`${logPrefix} Processing failed:`, {
      message: error.message,
      stack: error.stack,
    });

    setJobError(jobId, error);

    throw error;
  }
}

export {
  processLabReport,
};
