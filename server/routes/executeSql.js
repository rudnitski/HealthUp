/**
 * Execute SQL endpoint for plot rendering
 * PRD: docs/PRD_v2_1_plot_generation.md
 *
 * This endpoint executes validated SQL queries and returns results
 * Used by the frontend to execute plot queries and render visualizations
 */

import express from 'express';
import { pool } from '../db/index.js';
import logger from '../utils/logger.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

const NODE_ENV = process.env.NODE_ENV || 'development';

/**
 * POST /api/execute-sql
 * Execute a validated SQL query and return results
 *
 * Request body:
 * {
 *   "sql": "SELECT ... FROM ... LIMIT 50"
 * }
 *
 * Response:
 * {
 *   "ok": true,
 *   "rows": [...],
 *   "rowCount": 123,
 *   "fields": ["col1", "col2"]
 * }
 */
// PRD v4.4.3: Add requireAuth for user-scoped data
router.post('/', requireAuth, async (req, res) => {
  const startTime = Date.now();

  try {
    const { sql } = req.body;

    // Validate input
    if (!sql || typeof sql !== 'string' || sql.trim().length === 0) {
      logger.warn({ path: req.path }, '[executeSql] Missing or invalid SQL query');
      return res.status(400).json({
        ok: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'SQL query is required'
        }
      });
    }

    // Security check: SQL should already be validated by the SQL generator
    // Additional safety check: ensure query is read-only (starts with SELECT or WITH)
    const trimmedSql = sql.trim();
    if (!/^(SELECT|WITH)\b/i.test(trimmedSql)) {
      logger.warn({
        path: req.path,
        sql: trimmedSql.substring(0, 100)
      }, '[executeSql] Non-SELECT query rejected');

      return res.status(403).json({
        ok: false,
        error: {
          code: 'FORBIDDEN_QUERY_TYPE',
          message: 'Only SELECT and WITH queries are allowed'
        }
      });
    }

    // Safety check: ensure query has LIMIT clause (should be added by validator)
    if (!/\bLIMIT\s+\d+/i.test(trimmedSql)) {
      logger.warn({
        path: req.path,
        sql: trimmedSql.substring(0, 100)
      }, '[executeSql] Query without LIMIT rejected');

      return res.status(403).json({
        ok: false,
        error: {
          code: 'MISSING_LIMIT',
          message: 'Query must include a LIMIT clause'
        }
      });
    }

    logger.info({
      path: req.path,
      sql_preview: trimmedSql.substring(0, 100)
    }, '[executeSql] Executing SQL query');

    // Execute query with timeout in a transaction for RLS context
    const client = await pool.connect();
    try {
      // PRD v4.4.3: Begin transaction for RLS context and SET LOCAL
      await client.query('BEGIN');

      // PRD v4.4.3: Set RLS context for user-scoped data access
      await client.query(
        "SELECT set_config('app.current_user_id', $1, true)",
        [req.user.id]
      );

      // Set statement timeout to 30 seconds (requires transaction for SET LOCAL)
      await client.query('SET LOCAL statement_timeout = 30000');

      // Execute the query
      const result = await client.query(trimmedSql);

      // Commit the read-only transaction
      await client.query('COMMIT');

      const durationMs = Date.now() - startTime;

      logger.info({
        path: req.path,
        row_count: result.rowCount,
        duration_ms: durationMs
      }, '[executeSql] Query executed successfully');

      // Return results
      return res.status(200).json({
        ok: true,
        rows: result.rows,
        rowCount: result.rowCount,
        fields: result.fields ? result.fields.map(f => f.name) : [],
        metadata: {
          duration_ms: durationMs
        }
      });

    } catch (txError) {
      // Rollback on any error within the transaction
      await client.query('ROLLBACK').catch(() => {});
      throw txError;
    } finally {
      client.release();
    }

  } catch (error) {
    const durationMs = Date.now() - startTime;

    logger.error({
      path: req.path,
      error: error.message,
      duration_ms: durationMs
    }, '[executeSql] Query execution failed');

    // Check for specific error types
    if (error.message && error.message.includes('timeout')) {
      return res.status(408).json({
        ok: false,
        error: {
          code: 'QUERY_TIMEOUT',
          message: 'Query execution timed out after 30 seconds'
        }
      });
    }

    if (error.code === '42P01') {
      // Table/relation does not exist
      return res.status(400).json({
        ok: false,
        error: {
          code: 'INVALID_QUERY',
          message: 'Referenced table or view does not exist'
        }
      });
    }

    if (error.code === '42703') {
      // Column does not exist
      return res.status(400).json({
        ok: false,
        error: {
          code: 'INVALID_QUERY',
          message: 'Referenced column does not exist'
        }
      });
    }

    // Generic database error
    return res.status(500).json({
      ok: false,
      error: {
        code: 'QUERY_EXECUTION_FAILED',
        message: 'Failed to execute query',
        details: NODE_ENV === 'development' ? error.message : undefined
      }
    });
  }
});

export default router;
