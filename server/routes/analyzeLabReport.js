const express = require('express');
const { createJob, getJobStatus } = require('../utils/jobManager');
const { processLabReport } = require('../services/labReportProcessor');

const router = express.Router();

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
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

module.exports = router;
