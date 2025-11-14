const express = require('express');
const { handleGeneration, SqlGeneratorError } = require('../services/sqlGenerator');
const { bustCache, reloadSchemaAliases } = require('../services/schemaSnapshot');
const { reloadSchemaAliases: reloadPromptAliases } = require('../services/promptBuilder');
const { createJob, getJobStatus, updateJob, setJobResult, setJobError, JobStatus } = require('../utils/jobManager');
const { validateSQL } = require('../services/sqlValidator');
const { pool } = require('../db');
const logger = console;

const router = express.Router();

/**
 * Execute a data query (already validated SQL with LIMIT)
 * @param {string} sqlWithLimit - Validated SQL with LIMIT clause already enforced
 * @param {string} userIdentifier - User identifier for logging
 * @returns {Promise<{rows: Array, rowCount: number, fields: Array}>}
 */
async function executeDataQuery(sqlWithLimit, userIdentifier) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL statement_timeout = 30000'); // Scoped to this transaction only

    // Execute query (SQL already validated and has LIMIT)
    const result = await client.query(sqlWithLimit);

    await client.query('COMMIT');

    return {
      rows: result.rows,
      rowCount: result.rowCount,
      fields: result.fields
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Count total rows available (before LIMIT) for pagination info
 * @param {string} sqlWithLimit - Validated SQL with LIMIT clause already enforced
 * @param {string} userIdentifier - User identifier for logging
 * @returns {Promise<number|null>} Total row count or null if count fails
 */
async function countTotalRows(sqlWithLimit, userIdentifier) {
  // Strip LIMIT clause from validated SQL to count total available rows
  // IMPORTANT: This SQL has already been validated by validateSQL(), so it's safe to manipulate

  let sqlWithoutLimit = sqlWithLimit
    .replace(/;?\s*$/i, '')       // Remove trailing semicolons and whitespace
    .replace(/--[^\n]*$/gm, '')   // Remove trailing line comments
    .trim();

  // Remove LIMIT clause (handles LIMIT N and LIMIT N OFFSET M)
  sqlWithoutLimit = sqlWithoutLimit.replace(/\s+LIMIT\s+\d+(?:\s+OFFSET\s+\d+)?\s*$/i, '');

  // Wrap in COUNT query
  const countSql = `SELECT COUNT(*) as total FROM (${sqlWithoutLimit}) as subq`;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL statement_timeout = 5000');

    const result = await client.query(countSql);
    const total = parseInt(result.rows[0]?.total || 0, 10);

    await client.query('COMMIT');

    return total;
  } catch (err) {
    await client.query('ROLLBACK');
    // Count query failed (may timeout on complex queries)
    // Return null so frontend can use rowCount instead
    console.warn(`[countTotalRows] Failed to count total rows:`, err.message);
    return null;
  } finally {
    client.release();
  }
}

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

// GET /api/sql-generator/config - Get feature flags
// PRD v3.2: Frontend checks this to determine if conversational mode is enabled
router.get('/config', (req, res) => {
  const conversationalMode = process.env.CONVERSATIONAL_SQL_ENABLED === 'true';

  res.json({
    conversationalMode
  });
});

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

      const sqlGenerationResult = await handleGeneration({
        question,
        userIdentifier,
        model,
      });

      // Check if generation failed
      if (!sqlGenerationResult || sqlGenerationResult.ok === false) {
        console.warn(`[sqlGenerator:${requestId}] SQL generation validation failed for job ${jobId}`, sqlGenerationResult?.error);
        setJobResult(jobId, sqlGenerationResult); // Return validation failure
        return;
      }

      console.log(`[sqlGenerator:${requestId}] SQL generation completed successfully for job ${jobId}`);

      // Strip SQL out of the payload before further processing
      const {
        sql: rawSql,
        ...resultWithoutSql
      } = sqlGenerationResult || {};

      // Determine query type (handle missing field for single-shot mode)
      const queryType = sqlGenerationResult?.query_type || 'data_query';

      if (queryType !== 'data_query') {
        // Plot queries: behavior unchanged (SQL still required for plot renderer)
        setJobResult(jobId, sqlGenerationResult);
        return;
      }

      // NEW: Auto-execute data_query SQL
      console.log(`[sqlGenerator:${requestId}] Auto-executing data query for job ${jobId}`);

      if (!rawSql) {
        console.error(`[sqlGenerator:${requestId}] Missing SQL for data query job ${jobId}`);
        setJobError(jobId, 'No SQL was generated for this question.');
        return;
      }

      logger.info({
        requestId,
        jobId,
        sql_preview: rawSql.substring(0, 200)
      }, '[sqlGenerator] Data query SQL generated (server-log only)');

      // Validate SQL (already validated in handleGeneration, but check query_type-specific constraints)
      const validation = await validateSQL(rawSql, {
        schemaSnapshotId: sqlGenerationResult.metadata?.schema_snapshot_id,
        queryType: 'data_query'
      });

      if (!validation.valid) {
        // Validation failed (shouldn't happen, but handle gracefully)
        console.error(`[sqlGenerator:${requestId}] Data query re-validation failed`, validation.violations);
        setJobError(jobId, 'Query validation failed during execution');
        return;
      }

      // Execute validated SQL and count total rows
      const [executionResult, totalRowCount] = await Promise.all([
        executeDataQuery(validation.sqlWithLimit, userIdentifier),
        countTotalRows(validation.sqlWithLimit, userIdentifier)
      ]);

      // Combine non-SQL metadata + execution results
      const result = {
        ...resultWithoutSql,
        execution: {
          rows: executionResult.rows,
          rowCount: executionResult.rowCount,
          totalRowCount: totalRowCount, // Total available (before LIMIT)
          fields: executionResult.fields
        }
      };

      setJobResult(jobId, result);
      console.log(`[sqlGenerator:${requestId}] Data query executed: ${executionResult.rowCount} rows returned, ${totalRowCount || 'unknown'} total available`);

    } catch (error) {
      console.error(`[sqlGenerator:${requestId}] Background SQL generation failed for job ${jobId}:`, {
        error: error.message,
        stack: error.stack
      });

      if (error instanceof SqlGeneratorError) {
        setJobError(jobId, error.message);
      } else {
        setJobError(jobId, error.message || 'Unexpected error during query execution');
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
