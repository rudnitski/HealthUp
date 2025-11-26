// server/routes/admin.js
// PRD v2.4: Admin API endpoints for pending analytes and ambiguous matches

import express from 'express';
import { pool } from '../db/index.js';
import pino from 'pino';
import { detectLanguage } from '../utils/languageDetection.js';

const router = express.Router();

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

// Helper function to log admin actions
async function logAdminAction(actionType, entityType, entityId, changes, req) {
  try {
    await pool.query(
      `INSERT INTO admin_actions
         (action_type, entity_type, entity_id, changes, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        actionType,
        entityType,
        entityId,
        JSON.stringify(changes),
        req.ip || req.connection.remoteAddress,
        req.get('user-agent')
      ]
    );
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to log admin action');
  }
}

/**
 * GET /api/admin/pending-analytes
 * Fetch pending NEW analytes for review
 */
router.get('/pending-analytes', async (req, res) => {
  try {
    const status = req.query.status || 'pending';

    let whereClause = '';
    if (status !== 'all') {
      whereClause = 'WHERE status = $1';
    }

    const { rows } = await pool.query(
      `SELECT
         pending_id,
         proposed_code,
         proposed_name,
         unit_canonical,
         category,
         confidence,
         evidence,
         parameter_variations,
         status,
         created_at,
         approved_at,
         discarded_at,
         discarded_reason
       FROM pending_analytes
       ${whereClause}
       ORDER BY created_at DESC`,
      status !== 'all' ? [status] : []
    );

    res.json({ pending: rows });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to fetch pending analytes');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/admin/approve-analyte
 * Approve a pending analyte and promote to canonical
 */
router.post('/approve-analyte', async (req, res) => {
  const client = await pool.connect();

  try {
    const { pending_id } = req.body;

    if (!pending_id) {
      return res.status(400).json({ error: 'pending_id is required' });
    }

    await client.query('BEGIN');

    // Fetch pending analyte
    const { rows: pendingRows } = await client.query(
      `SELECT * FROM pending_analytes WHERE pending_id = $1`,
      [pending_id]
    );

    if (pendingRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Pending analyte not found' });
    }

    const pending = pendingRows[0];

    // Check if code already exists in analytes table
    const { rows: existingAnalytes } = await client.query(
      'SELECT analyte_id FROM analytes WHERE code = $1',
      [pending.proposed_code]
    );

    if (existingAnalytes.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Duplicate code',
        message: `Analyte with code '${pending.proposed_code}' already exists`
      });
    }

    // Insert into analytes table
    const { rows: newAnalyteRows } = await client.query(
      `INSERT INTO analytes (code, name, unit_canonical, category)
       VALUES ($1, $2, $3, $4)
       RETURNING analyte_id`,
      [
        pending.proposed_code,
        pending.proposed_name,
        pending.unit_canonical,
        pending.category || 'uncategorized'
      ]
    );

    const newAnalyteId = newAnalyteRows[0].analyte_id;

    // Insert aliases from parameter variations
    let aliasesCreated = 0;
    if (pending.parameter_variations && Array.isArray(pending.parameter_variations)) {
      for (const variation of pending.parameter_variations) {
        const lang = variation.lang || detectLanguage(variation.raw);

        await client.query(
          `INSERT INTO analyte_aliases (analyte_id, alias, alias_display, lang, confidence, source)
           VALUES ($1, $2, $3, $4, 1.0, 'evidence_auto')
           ON CONFLICT (analyte_id, alias) DO NOTHING`,
          [
            newAnalyteId,
            variation.normalized || variation.raw.toLowerCase(),
            variation.raw,
            lang
          ]
        );

        aliasesCreated++;
      }
    }

    // Update pending_analytes status
    await client.query(
      `UPDATE pending_analytes
       SET status = 'approved',
           approved_at = NOW(),
           approved_analyte_id = $1,
           updated_at = NOW()
       WHERE pending_id = $2`,
      [newAnalyteId, pending_id]
    );

    // Backfill: Update matching lab_results using fuzzy matching
    const { rowCount: backfilledRows } = await client.query(
      `UPDATE lab_results lr
       SET analyte_id = $1,
           mapping_confidence = 0.95,
           mapping_source = 'manual_approved',
           mapped_at = NOW()
       WHERE lr.analyte_id IS NULL
         AND EXISTS (
           SELECT 1 FROM analyte_aliases aa
           WHERE aa.analyte_id = $1
             AND aa.alias % LOWER(TRIM(lr.parameter_name))
             AND similarity(aa.alias, LOWER(TRIM(lr.parameter_name))) >= 0.70
         )`,
      [newAnalyteId]
    );

    await client.query('COMMIT');

    // Log admin action
    await logAdminAction('approve_analyte', 'pending_analyte', pending_id, {
      pending_status: 'pending → approved',
      created_analyte: {
        analyte_id: newAnalyteId,
        code: pending.proposed_code,
        name: pending.proposed_name
      },
      created_aliases: aliasesCreated,
      backfilled_rows: backfilledRows
    }, req);

    logger.info({
      pending_id,
      analyte_id: newAnalyteId,
      backfilled_rows: backfilledRows
    }, 'Analyte approved');

    res.json({
      success: true,
      analyte_id: newAnalyteId,
      backfilled_rows: backfilledRows,
      message: `Analyte '${pending.proposed_code}' approved and ${backfilledRows} lab results updated`
    });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error: error.message }, 'Failed to approve analyte');
    res.status(500).json({ error: 'Internal server error', message: error.message });
  } finally {
    client.release();
  }
});

/**
 * POST /api/admin/discard-analyte
 * Discard a pending analyte (mark as discarded, don't delete)
 */
router.post('/discard-analyte', async (req, res) => {
  try {
    const { pending_id, reason } = req.body;

    if (!pending_id) {
      return res.status(400).json({ error: 'pending_id is required' });
    }

    const { rows } = await pool.query(
      `UPDATE pending_analytes
       SET status = 'discarded',
           discarded_at = NOW(),
           discarded_reason = $1,
           updated_at = NOW()
       WHERE pending_id = $2
       RETURNING proposed_code`,
      [reason || null, pending_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Pending analyte not found' });
    }

    // Log admin action
    await logAdminAction('discard_analyte', 'pending_analyte', pending_id, {
      pending_status: 'pending → discarded',
      reason: reason || 'No reason provided',
      proposed_code: rows[0].proposed_code
    }, req);

    logger.info({ pending_id, reason }, 'Analyte discarded');

    res.json({
      success: true,
      message: `Proposed analyte '${rows[0].proposed_code}' discarded`
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to discard analyte');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/admin/ambiguous-matches
 * Fetch ambiguous matches for review
 */
router.get('/ambiguous-matches', async (req, res) => {
  try {
    const status = req.query.status || 'pending';

    let whereClause = '';
    if (status !== 'all') {
      whereClause = 'WHERE status = $1';
    }

    const { rows } = await pool.query(
      `SELECT
         mr.review_id,
         mr.result_id,
         lr.parameter_name as raw_parameter_name,
         lr.unit,
         mr.candidates,
         mr.status,
         mr.created_at
       FROM match_reviews mr
       LEFT JOIN lab_results lr ON mr.result_id = lr.id
       ${whereClause ? 'WHERE mr.status = $1' : ''}
       ORDER BY mr.created_at DESC`,
      status !== 'all' ? [status] : []
    );

    res.json({ ambiguous: rows });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to fetch ambiguous matches');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/admin/resolve-match
 * Resolve an ambiguous match by choosing the correct analyte
 */
router.post('/resolve-match', async (req, res) => {
  const client = await pool.connect();

  try {
    const { review_id, chosen_analyte_id, create_alias } = req.body;

    if (!review_id || !chosen_analyte_id) {
      return res.status(400).json({
        error: 'review_id and chosen_analyte_id are required'
      });
    }

    await client.query('BEGIN');

    // Fetch match review with lab result details
    const { rows: reviewRows } = await client.query(
      `SELECT mr.*, lr.parameter_name, lr.unit
       FROM match_reviews mr
       LEFT JOIN lab_results lr ON mr.result_id = lr.id
       WHERE mr.review_id = $1`,
      [review_id]
    );

    if (reviewRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Match review not found' });
    }

    const review = reviewRows[0];
    const candidates = review.candidates || [];

    // Find chosen candidate's similarity
    const chosenCandidate = candidates.find(c => c.analyte_id === chosen_analyte_id);
    const confidence = chosenCandidate?.similarity || 0.85;

    // Update lab_results
    const { rowCount } = await client.query(
      `UPDATE lab_results
       SET analyte_id = $1,
           mapping_confidence = $2,
           mapping_source = 'manual_resolved',
           mapped_at = NOW()
       WHERE id = $3
         AND analyte_id IS NULL`,
      [chosen_analyte_id, confidence, review.result_id]
    );

    // Create alias if requested
    let aliasCreated = false;
    if (create_alias && review.parameter_name) {
      const lang = detectLanguage(review.parameter_name);
      const normalized = review.parameter_name.toLowerCase().trim();

      await client.query(
        `INSERT INTO analyte_aliases (analyte_id, alias, alias_display, lang, source)
         VALUES ($1, $2, $3, $4, 'manual_disambiguation')
         ON CONFLICT (analyte_id, alias) DO NOTHING`,
        [chosen_analyte_id, normalized, review.parameter_name, lang]
      );

      aliasCreated = true;
    }

    // Update match_reviews status
    await client.query(
      `UPDATE match_reviews
       SET status = 'resolved',
           resolved_at = NOW(),
           updated_at = NOW()
       WHERE review_id = $1`,
      [review_id]
    );

    await client.query('COMMIT');

    // Fetch chosen analyte details
    const { rows: analyteRows } = await pool.query(
      'SELECT analyte_id, code, name FROM analytes WHERE analyte_id = $1',
      [chosen_analyte_id]
    );

    // Log admin action
    await logAdminAction('resolve_match', 'match_review', review_id, {
      result_id: review.result_id,
      chosen_analyte: analyteRows[0],
      rows_updated: rowCount,
      alias_created: aliasCreated
    }, req);

    logger.info({
      review_id,
      chosen_analyte_id,
      rows_updated: rowCount
    }, 'Ambiguous match resolved');

    res.json({
      success: true,
      result_id: review.result_id,
      chosen_analyte: analyteRows[0],
      alias_created: aliasCreated,
      rows_updated: rowCount
    });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error: error.message }, 'Failed to resolve match');
    res.status(500).json({ error: 'Internal server error', message: error.message });
  } finally {
    client.release();
  }
});

/**
 * POST /api/admin/discard-match
 * Discard an ambiguous match without resolving it
 */
router.post('/discard-match', async (req, res) => {
  try {
    const { review_id, reason } = req.body;

    if (!review_id) {
      return res.status(400).json({ error: 'review_id is required' });
    }

    const { rows } = await pool.query(
      `UPDATE match_reviews
       SET status = 'skipped',
           updated_at = NOW()
       WHERE review_id = $1
       RETURNING review_id`,
      [review_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Match review not found' });
    }

    // Log admin action
    await logAdminAction('discard_match', 'match_review', review_id, {
      status: 'pending → skipped',
      reason: reason || 'No reason provided'
    }, req);

    logger.info({ review_id, reason }, 'Ambiguous match discarded');

    res.json({
      success: true,
      message: 'Ambiguous match discarded'
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to discard match');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/admin/reset-database
 * Drop all tables and recreate schema with seed data
 * WARNING: This deletes ALL data in the database!
 */
router.post('/reset-database', async (req, res) => {
  try {
    logger.warn({ ip: req.ip }, '[admin] Database reset requested');

    // Import resetDatabase function
    const { resetDatabase } = await import('../db/schema.js');

    // Perform the reset
    const result = await resetDatabase();

    // Log the action
    await logAdminAction('reset_database', 'database', 'all', {
      timestamp: new Date().toISOString(),
      success: true
    }, req);

    logger.info('[admin] Database reset completed successfully');

    res.json({
      success: true,
      message: result.message,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error({ error: error.message }, '[admin] Database reset failed');
    res.status(500).json({
      success: false,
      error: 'Failed to reset database',
      message: error.message
    });
  }
});

export default router;
