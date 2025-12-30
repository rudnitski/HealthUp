import express from 'express';
import { handleGeneration, SqlGeneratorError } from '../services/sqlGenerator.js';
import { bustCache } from '../services/schemaSnapshot.js';
import { reloadSchemaAliases } from '../services/promptBuilder.js';
import { createJob, getJob, getJobStatus, updateJob, setJobResult, setJobError, JobStatus } from '../utils/jobManager.js';
import { validateSQL } from '../services/sqlValidator.js';
import { pool } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
const logger = console;

const router = express.Router();

/**
 * Execute a data query (already validated SQL with LIMIT)
 * PRD v4.4.3: Added userId parameter for RLS context
 * @param {string} sqlWithLimit - Validated SQL with LIMIT clause already enforced
 * @param {string} userIdentifier - User identifier for logging
 * @param {string} userId - User ID for RLS context
 * @returns {Promise<{rows: Array, rowCount: number, fields: Array}>}
 */
async function executeDataQuery(sqlWithLimit, userIdentifier, userId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // PRD v4.4.3: Set RLS context for user-scoped data access
    await client.query(
      "SELECT set_config('app.current_user_id', $1, true)",
      [userId]
    );

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
 * PRD v4.4.3: Added userId parameter for RLS context
 * @param {string} sqlWithLimit - Validated SQL with LIMIT clause already enforced
 * @param {string} userIdentifier - User identifier for logging
 * @param {string} userId - User ID for RLS context
 * @returns {Promise<number|null>} Total row count or null if count fails
 */
async function countTotalRows(sqlWithLimit, userIdentifier, userId) {
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

    // PRD v4.4.3: Set RLS context for user-scoped data access
    await client.query(
      "SELECT set_config('app.current_user_id', $1, true)",
      [userId]
    );

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

// GET /api/sql-generator/jobs/:jobId - Get job status
// PRD v4.4.3: Add requireAuth and ownership check
router.get('/jobs/:jobId', requireAuth, (req, res) => {
  const { jobId } = req.params;

  console.log(`[sqlGenerator] Job status requested: ${jobId}`);

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

// POST /api/sql-generator - Generate SQL (async job-based)
// PRD v4.4.3: Add requireAuth for user-scoped data
router.post('/', requireAuth, async (req, res) => {
  const question = req?.body?.question;
  const model = req?.body?.model; // Optional model override
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const userIdentifier = getUserIdentifier(req);
  const userId = req.user.id; // PRD v4.4.3: Get authenticated user ID

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

  // PRD v4.4.3: Create job with authenticated user ID
  const jobId = createJob(userId, {
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

      // PRD v4.4.3: Pass userId for RLS context in agentic SQL
      const sqlGenerationResult = await handleGeneration({
        question,
        userIdentifier,
        model,
        userId,
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
      // PRD v4.4.3: Pass userId for RLS context
      const [executionResult, totalRowCount] = await Promise.all([
        executeDataQuery(validation.sqlWithLimit, userIdentifier, userId),
        countTotalRows(validation.sqlWithLimit, userIdentifier, userId)
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

export default router;
