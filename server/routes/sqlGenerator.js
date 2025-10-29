const express = require('express');
const { handleGeneration, SqlGeneratorError } = require('../services/sqlGenerator');
const { bustCache, reloadSchemaAliases } = require('../services/schemaSnapshot');
const { reloadSchemaAliases: reloadPromptAliases } = require('../services/promptBuilder');
const { createJob, getJobStatus, updateJob, setJobResult, setJobError, JobStatus } = require('../utils/jobManager');

const router = express.Router();

const getUserIdentifier = (req) => {
  if (req?.user?.id) {
    return req.user.id;
  }

  if (typeof req?.headers?.['x-user-id'] === 'string' && req.headers['x-user-id'].trim()) {
    return req.headers['x-user-id'].trim();
  }

  if (typeof req?.ip === 'string' && req.ip) {
    return req.ip;
  }

  return 'anonymous';
};

// GET /api/sql-generator/jobs/:jobId - Get job status
router.get('/jobs/:jobId', (req, res) => {
  const { jobId } = req.params;

  console.log(`[sqlGenerator] Job status requested: ${jobId}`);

  const jobStatus = getJobStatus(jobId);

  if (!jobStatus) {
    return res.status(404).json({ error: 'Job not found' });
  }

  return res.status(200).json(jobStatus);
});

// POST /api/sql-generator - Generate SQL (async job-based)
router.post('/', async (req, res) => {
  const question = req?.body?.question;
  const model = req?.body?.model; // Optional model override
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const userIdentifier = getUserIdentifier(req);

  // Guard log to handle non-string questions gracefully
  const questionPreview = typeof question === 'string'
    ? question.substring(0, 50)
    : JSON.stringify(question);
  console.log(`[sqlGenerator:${requestId}] Request started for question: ${questionPreview}...`);

  // Validate question immediately
  if (!question || typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({
      ok: false,
      error: {
        code: 'BAD_REQUEST',
        message: 'Question is required'
      }
    });
  }

  // Create job
  const jobId = createJob(userIdentifier, {
    question,
    model,
    requestId
  });

  console.log(`[sqlGenerator:${requestId}] Job created: ${jobId}`);

  // Start processing in background (don't await)
  setImmediate(async () => {
    try {
      console.log(`[sqlGenerator:${requestId}] Starting background SQL generation for job ${jobId}`);

      // Update job to processing
      updateJob(jobId, JobStatus.PROCESSING);

      const result = await handleGeneration({
        question,
        userIdentifier,
        model,
      });

      // Store result regardless of validation outcome
      // Validation failures (ok: false) still contain structured error details (hint, violations)
      // that the frontend needs to display to the user
      if (result.ok === false) {
        console.warn(`[sqlGenerator:${requestId}] SQL generation validation failed for job ${jobId}`, result.error);
      } else {
        console.log(`[sqlGenerator:${requestId}] SQL generation completed successfully for job ${jobId}`);
      }

      setJobResult(jobId, result);

    } catch (error) {
      console.error(`[sqlGenerator:${requestId}] Background SQL generation failed for job ${jobId}:`, {
        error: error.message,
        stack: error.stack
      });

      if (error instanceof SqlGeneratorError) {
        setJobError(jobId, error.message);
      } else {
        setJobError(jobId, 'Unexpected error generating SQL');
      }
    }
  });

  // Return job ID immediately
  return res.status(202).json({
    jobId,
    status: 'pending',
    message: 'SQL generation started. Poll /api/sql-generator/jobs/:jobId for status.'
  });
});

// POST /api/sql-generator/admin/cache/bust - Bust schema cache (admin only)
router.post('/admin/cache/bust', async (req, res) => {
  // TODO: Add proper admin authentication middleware
  // For now, check for a simple API key
  const apiKey = req.headers['x-admin-api-key'];
  if (!apiKey || apiKey !== process.env.ADMIN_API_KEY) {
    return res.status(403).json({
      ok: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Admin authentication required',
      },
    });
  }

  try {
    const { manifest, snapshotId } = await bustCache();

    // Reload schema aliases
    reloadPromptAliases();

    return res.json({
      ok: true,
      message: 'Schema cache busted successfully',
      schema_snapshot_id: snapshotId,
      tables_count: manifest.tables.length,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[sqlGenerator] Failed to bust cache:', error);
    return res.status(500).json({
      ok: false,
      error: {
        code: 'CACHE_BUST_FAILED',
        message: 'Failed to bust schema cache',
      },
    });
  }
});

module.exports = router;
