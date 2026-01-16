import express from 'express';
import { createJob, getJob, getJobStatus, createBatch, getBatch, getBatchStatus } from '../utils/jobManager.js';
import { processLabReport } from '../services/labReportProcessor.js';
import { requireAuth } from '../middleware/auth.js';
import { queryWithUser } from '../db/index.js';

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
// PRD v4.4.3: Add requireAuth and ownership check
router.get('/jobs/:jobId', requireAuth, (req, res) => {
  const { jobId } = req.params;

  console.log(`[analyzeLabReport] Job status requested: ${jobId}`);

  const jobStatus = getJobStatus(jobId);

  if (!jobStatus) {
    return res.status(404).json({ error: 'Job not found' });
  }

  // PRD v4.4.3: Verify job ownership
  // Return 404 (not 403) to prevent job enumeration attacks
  const job = getJob(jobId);
  if (job && job.userId !== req.user.id) {
    return res.status(404).json({ error: 'Job not found' });
  }

  return res.status(200).json(jobStatus);
});

// Main upload endpoint - Create async job
// PRD v4.4.3: Add requireAuth for user-scoped data
router.post('/', requireAuth, async (req, res) => {
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

  // PRD v4.4.3: Create job with authenticated user ID
  const jobId = createJob(req.user.id, {
    filename: name,
    mimetype,
    size,
    requestId
  });

  console.log(`[analyzeLabReport:${requestId}] Job created: ${jobId} for user: ${req.user.id}`);

  // Start processing in background (don't await)
  setImmediate(async () => {
    try {
      await processLabReport({
        jobId,
        fileBuffer,
        mimetype,
        filename: name,
        fileSize: size,
        userId: req.user.id, // PRD v4.4.3: Pass userId for RLS context
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
 * PRD v4.4.3: Add requireAuth for user-scoped data
 */
router.post('/batch', requireAuth, async (req, res) => {
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

  // PRD v6.0: Extract and validate optional fallbackPatientId from form data
  // Used by chat inline upload when OCR fails to extract patient name
  const fallbackPatientId = req.body?.fallbackPatientId || null;

  if (fallbackPatientId) {
    // UUID format validation to prevent PostgreSQL 500 errors
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (typeof fallbackPatientId !== 'string' || !uuidPattern.test(fallbackPatientId)) {
      return res.status(400).json({
        error: 'Invalid fallbackPatientId format - expected UUID'
      });
    }

    // SECURITY: Validate that fallbackPatientId belongs to current user via RLS
    const patientCheck = await queryWithUser(
      'SELECT id FROM patients WHERE id = $1',
      [fallbackPatientId],
      req.user.id
    );
    if (patientCheck.rows.length === 0) {
      return res.status(403).json({
        error: 'Invalid fallbackPatientId - patient not found or access denied'
      });
    }
    console.log(`[analyzeLabReportBatch:${requestId}] Using fallbackPatientId: ${fallbackPatientId}`);
  }

  // PRD v4.4.3: Create batch with authenticated user ID
  const { batchId, jobs, files: filesWithJobIds } = createBatch(req.user.id, filesArray);

  console.log(`[analyzeLabReportBatch:${requestId}] Batch created: ${batchId} with ${jobs.length} jobs for user: ${req.user.id}`);

  // Queue processing in background (don't await!)
  // PRD v6.0: Pass fallbackPatientId for chat inline upload
  setImmediate(async () => {
    await processBatchFiles(filesWithJobIds, batchId, requestId, req.user.id, fallbackPatientId);
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
 * PRD v4.4.3: Added userId parameter for RLS context
 * PRD v6.0: Added fallbackPatientId for chat inline upload
 */
async function processBatchFiles(files, batchId, requestId, userId, fallbackPatientId = null) {
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
        fileSize: size,
        userId, // PRD v4.4.3: Pass userId for RLS context
        fallbackPatientId, // PRD v6.0: For chat inline upload
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
 * PRD v4.4.3: Add requireAuth and ownership check
 */
router.get('/batches/:batchId', requireAuth, (req, res) => {
  const { batchId } = req.params;

  console.log(`[analyzeLabReportBatch] Batch status requested: ${batchId}`);

  const batchStatus = getBatchStatus(batchId);

  if (!batchStatus) {
    return res.status(404).json({ error: 'Batch not found' });
  }

  // PRD v4.4.3: Verify batch ownership
  // Return 404 (not 403) to prevent batch enumeration attacks
  const batch = getBatch(batchId);
  if (batch && batch.userId !== req.user.id) {
    return res.status(404).json({ error: 'Batch not found' });
  }

  // PRD v6.0: Compute allComplete flag for frontend polling
  const allComplete = batchStatus.jobs.every(
    job => job.status === 'completed' || job.status === 'failed'
  );

  return res.status(200).json({ ...batchStatus, allComplete });
});

export default router;
