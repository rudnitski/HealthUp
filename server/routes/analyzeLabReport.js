import express from 'express';
import { createJob, getJobStatus, createBatch, getBatchStatus } from '../utils/jobManager.js';
import { processLabReport } from '../services/labReportProcessor.js';

const router = express.Router();

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_BATCH_SIZE = 20; // Maximum files per batch
const MAX_AGGREGATE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB aggregate
const FILE_FIELD_NAME = 'analysisFile';
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/heic'
]);

// Job polling endpoint - Get job status
router.get('/jobs/:jobId', (req, res) => {
  const { jobId } = req.params;

  console.log(`[analyzeLabReport] Job status requested: ${jobId}`);

  const jobStatus = getJobStatus(jobId);

  if (!jobStatus) {
    return res.status(404).json({ error: 'Job not found' });
  }

  return res.status(200).json(jobStatus);
});

// Main upload endpoint - Create async job
router.post('/', async (req, res) => {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  console.log(`[analyzeLabReport:${requestId}] Request started`);

  // Check for uploaded file
  console.log(`[analyzeLabReport:${requestId}] Checking uploaded file...`, {
    has_req_files: !!req.files,
    files_keys: req.files ? Object.keys(req.files) : [],
    expected_field: FILE_FIELD_NAME
  });

  const uploadedFile = req?.files?.[FILE_FIELD_NAME] || Object.values(req?.files || {})[0];

  if (!uploadedFile || Array.isArray(uploadedFile)) {
    console.error(`[analyzeLabReport:${requestId}] No valid file found`, {
      has_uploaded_file: !!uploadedFile,
      is_array: Array.isArray(uploadedFile)
    });
    return res.status(400).json({ error: 'A single file is required.' });
  }

  const { data: fileBuffer, mimetype, name, size } = uploadedFile;

  console.log(`[analyzeLabReport:${requestId}] File received:`, {
    name,
    mimetype,
    size,
    has_buffer: !!fileBuffer
  });

  // Validate file type
  if (!ALLOWED_MIME_TYPES.has(mimetype)) {
    return res.status(400).json({ error: 'Unsupported file type. Please upload an image or PDF.' });
  }

  // Validate file size
  if (size > MAX_FILE_SIZE_BYTES) {
    return res.status(413).json({ error: 'File is too large. Maximum size is 10MB.' });
  }

  // Create job
  const jobId = createJob('anonymous', {
    filename: name,
    mimetype,
    size,
    requestId
  });

  console.log(`[analyzeLabReport:${requestId}] Job created: ${jobId}`);

  // Start processing in background (don't await)
  setImmediate(async () => {
    try {
      await processLabReport({
        jobId,
        fileBuffer,
        mimetype,
        filename: name,
        fileSize: size
      });
    } catch (error) {
      console.error(`[analyzeLabReport:${requestId}] Background processing failed:`, {
        jobId,
        error: error.message,
        stack: error.stack
      });
    }
  });

  // Return job ID immediately (202 Accepted)
  return res.status(202).json({
    job_id: jobId,
    status: 'pending',
    message: 'Your lab report is being processed. Poll /api/analyze-labs/jobs/' + jobId + ' for status.'
  });
});

/**
 * Batch upload endpoint - Process multiple files
 * POST /api/analyze-labs/batch
 */
router.post('/batch', async (req, res) => {
  const requestId = `batch_req_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  console.log(`[analyzeLabReportBatch:${requestId}] Request started`);

  // Get uploaded files (express-fileupload automatically converts to array for multiple files)
  const uploadedFiles = req?.files?.[FILE_FIELD_NAME];

  if (!uploadedFiles) {
    console.error(`[analyzeLabReportBatch:${requestId}] No files uploaded`);
    return res.status(400).json({ error: 'At least one file is required.' });
  }

  // Normalize to array (single file will not be an array)
  const filesArray = Array.isArray(uploadedFiles) ? uploadedFiles : [uploadedFiles];

  console.log(`[analyzeLabReportBatch:${requestId}] Received ${filesArray.length} files`);

  // Validate batch size
  if (filesArray.length > MAX_BATCH_SIZE) {
    return res.status(400).json({
      error: `Batch size exceeds limit of ${MAX_BATCH_SIZE} files.`,
      limit: 'max_files',
      max_files: MAX_BATCH_SIZE,
      received: filesArray.length
    });
  }

  // Validate each file and calculate aggregate size
  let aggregateSize = 0;
  const validationErrors = [];

  for (let i = 0; i < filesArray.length; i++) {
    const file = filesArray[i];
    const { mimetype, name, size } = file;

    // Validate file type
    if (!ALLOWED_MIME_TYPES.has(mimetype)) {
      validationErrors.push(`File "${name}": Unsupported type (${mimetype})`);
    }

    // Validate file size
    if (size > MAX_FILE_SIZE_BYTES) {
      validationErrors.push(`File "${name}": Too large (${(size / 1024 / 1024).toFixed(1)}MB, max 10MB)`);
    }

    aggregateSize += size;
  }

  // Validate aggregate size
  if (aggregateSize > MAX_AGGREGATE_SIZE_BYTES) {
    return res.status(400).json({
      error: `Total batch size exceeds limit of 100MB.`,
      limit: 'aggregate_size',
      max_size_mb: 100,
      total_size_mb: (aggregateSize / 1024 / 1024).toFixed(1)
    });
  }

  // Return all validation errors if any
  if (validationErrors.length > 0) {
    return res.status(400).json({
      error: 'File validation failed',
      validation_errors: validationErrors
    });
  }

  // Create batch
  const { batchId, jobs, files: filesWithJobIds } = createBatch('anonymous', filesArray);

  console.log(`[analyzeLabReportBatch:${requestId}] Batch created: ${batchId} with ${jobs.length} jobs`);

  // Queue processing in background (don't await!)
  setImmediate(async () => {
    await processBatchFiles(filesWithJobIds, batchId, requestId);
  });

  // Return 202 immediately
  return res.status(202).json({
    batch_id: batchId,
    jobs: jobs.map(({ jobId, filename, status }) => ({ job_id: jobId, filename, status })),
    total_count: jobs.length,
    message: `Batch processing started. Poll /api/analyze-labs/batches/${batchId} for status.`
  });
});

/**
 * Background worker function to process batch files with throttled concurrency
 */
async function processBatchFiles(files, batchId, requestId) {
  const CONCURRENCY = 3; // Process 3 files at a time

  console.log(`[analyzeLabReportBatch:${requestId}] Starting batch processing for ${files.length} files (concurrency: ${CONCURRENCY})`);

  const queue = [...files];
  const active = new Set();

  while (queue.length || active.size) {
    // Start new jobs up to concurrency limit
    while (active.size < CONCURRENCY && queue.length) {
      const file = queue.shift();
      const { jobId, data: fileBuffer, mimetype, name, size } = file;

      console.log(`[analyzeLabReportBatch:${requestId}] Starting job ${jobId} for file: ${name}`);

      const promise = processLabReport({
        jobId,
        fileBuffer,
        mimetype,
        filename: name,
        fileSize: size
      })
        .then(() => {
          console.log(`[analyzeLabReportBatch:${requestId}] Job ${jobId} completed for file: ${name}`);
        })
        .catch(error => {
          console.error(`[analyzeLabReportBatch:${requestId}] Job ${jobId} failed for file: ${name}`, error.message);
        })
        .finally(() => active.delete(promise));

      active.add(promise);
    }

    // Wait for at least one to complete
    if (active.size) {
      await Promise.race(active);
    }
  }

  console.log(`[analyzeLabReportBatch:${requestId}] Batch processing completed for batchId: ${batchId}`);
}

/**
 * Batch status endpoint - Get batch progress
 * GET /api/analyze-labs/batches/:batchId
 */
router.get('/batches/:batchId', (req, res) => {
  const { batchId } = req.params;

  console.log(`[analyzeLabReportBatch] Batch status requested: ${batchId}`);

  const batchStatus = getBatchStatus(batchId);

  if (!batchStatus) {
    return res.status(404).json({ error: 'Batch not found' });
  }

  return res.status(200).json(batchStatus);
});

export default router;
