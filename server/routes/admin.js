// server/routes/admin.js
// PRD v2.4: Admin API endpoints for pending analytes and ambiguous matches
// PRD v4.4.2: Protected by authentication + admin authorization middleware
// PRD v4.4.6: Admin read access endpoints for patients/reports

import express from 'express';
import { adminPool, queryAsAdmin } from '../db/index.js';
import { detectLanguage } from '../utils/languageDetection.js';
import logger from '../utils/logger.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { getPatientReports, getReportDetail } from '../services/reportRetrieval.js';
import { EFFECTIVE_DATE_EXPR, isUuid, isIsoDate } from '../services/reportQueries.js';
import { streamOriginalFile } from '../services/fileDownload.js';

const router = express.Router();

// PRD v4.4.2: Apply authentication + authorization to ALL admin routes
router.use(requireAuth, requireAdmin);

// Helper function to log admin actions
// PRD v4.4.2: Now includes admin_user from authenticated user
async function logAdminAction(actionType, entityType, entityId, changes, req) {
  try {
    // Use queryAsAdmin to bypass RLS for admin_actions table
    await queryAsAdmin(
      `INSERT INTO admin_actions
         (action_type, entity_type, entity_id, changes, ip_address, user_agent, admin_user)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        actionType,
        entityType,
        entityId,
        JSON.stringify(changes),
        req.ip || req.connection.remoteAddress,
        req.get('user-agent'),
        req.user?.email || null // PRD v4.4.2: Include authenticated user email
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

    const { rows } = await queryAsAdmin(
      `SELECT
         pending_id,
         proposed_code,
         proposed_name,
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
  const client = await adminPool.connect();

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
      `INSERT INTO analytes (code, name)
       VALUES ($1, $2)
       RETURNING analyte_id`,
      [
        pending.proposed_code,
        pending.proposed_name
      ]
    );

    const newAnalyteId = newAnalyteRows[0].analyte_id;

    // Insert aliases from parameter variations (batch INSERT to avoid N+1 queries)
    let aliasesCreated = 0;
    if (pending.parameter_variations && Array.isArray(pending.parameter_variations)) {
      const values = [];
      const placeholders = [];

      pending.parameter_variations.forEach((variation, idx) => {
        const lang = variation.lang || detectLanguage(variation.raw);
        const baseIdx = idx * 4;  // 4 params per row

        placeholders.push(
          `($${baseIdx + 1}, $${baseIdx + 2}, $${baseIdx + 3}, $${baseIdx + 4}, 1.0, 'evidence_auto')`
        );

        values.push(
          newAnalyteId,
          variation.normalized || variation.raw.toLowerCase(),
          variation.raw,
          lang
        );
      });

      if (placeholders.length > 0) {
        await client.query(
          `INSERT INTO analyte_aliases (analyte_id, alias, alias_display, lang, confidence, source)
           VALUES ${placeholders.join(', ')}
           ON CONFLICT (analyte_id, alias) DO NOTHING`,
          values
        );
        aliasesCreated = pending.parameter_variations.length;
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

    // NEW: Link lab results from match_reviews (pending analyte matches)
    // Find all match_reviews that reference this pending code
    const { rows: matchReviews } = await client.query(
      `SELECT review_id, result_id, candidates
       FROM match_reviews
       WHERE candidates @> $1::jsonb
         AND status = 'pending'`,
      [JSON.stringify([{ code: pending.proposed_code }])]
    );

    let linkedFromMatches = 0;
    for (const review of matchReviews) {
      const candidate = review.candidates.find(c => c.code === pending.proposed_code);
      const confidence = candidate?.confidence || 0.90;

      // Try to update lab_result (may already be set by alias backfill)
      const { rowCount } = await client.query(
        `UPDATE lab_results
         SET analyte_id = $1,
             mapping_source = 'pending_approved',
             mapping_confidence = $2,
             mapped_at = NOW()
         WHERE id = $3 AND analyte_id IS NULL`,
        [newAnalyteId, confidence, review.result_id]
      );

      if (rowCount > 0) {
        linkedFromMatches++;
      }

      // CRITICAL: Always mark review as resolved, even if alias backfill already linked the result
      // The match_reviews entry served its purpose (tracking pending match) and should be cleaned up
      await client.query(
        `UPDATE match_reviews
         SET status = 'resolved', resolved_at = NOW()
         WHERE review_id = $1`,
        [review.review_id]
      );
    }

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
      backfilled_rows: backfilledRows,
      linked_from_matches: linkedFromMatches
    }, req);

    logger.info({
      pending_id,
      analyte_id: newAnalyteId,
      backfilled_rows: backfilledRows,
      linked_from_matches: linkedFromMatches
    }, 'Analyte approved');

    const totalLinked = backfilledRows + linkedFromMatches;
    res.json({
      success: true,
      analyte_id: newAnalyteId,
      backfilled_rows: backfilledRows,
      linked_from_matches: linkedFromMatches,
      total_linked: totalLinked,
      message: `Analyte '${pending.proposed_code}' approved and ${totalLinked} lab results linked (${backfilledRows} fuzzy + ${linkedFromMatches} pending matches)`
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

    const { rows } = await queryAsAdmin(
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

    const { rows } = await queryAsAdmin(
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
  const client = await adminPool.connect();

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
    const { rows: analyteRows } = await queryAsAdmin(
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

    const { rows } = await queryAsAdmin(
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
 * GET /api/admin/pending-analytes/:pendingId/matches
 * Get lab results that matched this pending analyte (awaiting approval)
 */
router.get('/pending-analytes/:pendingId/matches', async (req, res) => {
  try {
    const { pendingId } = req.params;

    // Get pending analyte
    const { rows: pending } = await queryAsAdmin(
      'SELECT pending_id, proposed_code, proposed_name FROM pending_analytes WHERE pending_id = $1',
      [pendingId]
    );

    if (pending.length === 0) {
      return res.status(404).json({ error: 'Pending analyte not found' });
    }

    const code = pending[0].proposed_code;

    // Find all match_reviews referencing this pending code
    const { rows: matches } = await queryAsAdmin(
      `SELECT
         mr.review_id,
         mr.result_id,
         lr.parameter_name,
         lr.result_value,
         lr.unit,
         pr.report_date,
         p.name as patient_name,
         mr.candidates,
         mr.created_at
       FROM match_reviews mr
       JOIN lab_results lr ON lr.id = mr.result_id
       JOIN patient_reports pr ON pr.id = lr.report_id
       JOIN patients p ON p.id = pr.patient_id
       WHERE mr.candidates @> $1::jsonb
         AND mr.status = 'pending'
       ORDER BY mr.created_at DESC`,
      [JSON.stringify([{ code }])]
    );

    res.json({
      pending_analyte: pending[0],
      match_count: matches.length,
      matches
    });
  } catch (error) {
    logger.error({ error: error.message, pendingId: req.params.pendingId }, 'Failed to fetch pending analyte matches');
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
    await logAdminAction('reset_database', 'database', null, {
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

// ========================================================================
// PRD v4.8.2: Unit Normalization Admin Review Endpoints
// ========================================================================

/**
 * GET /api/admin/unit-reviews
 * Fetch pending unit normalization issues
 */
router.get('/unit-reviews', async (req, res) => {
  try {
    const status = req.query.status || 'pending';

    let whereClause = '';
    if (status !== 'all') {
      whereClause = 'WHERE ur.status = $1';
    }

    const { rows } = await queryAsAdmin(
      `SELECT
         ur.review_id,
         ur.result_id,
         ur.raw_unit,
         ur.normalized_input,
         ur.llm_suggestion,
         ur.llm_confidence,
         ur.llm_model,
         ur.issue_type,
         ur.issue_details,
         ur.status,
         ur.created_at,
         lr.parameter_name,
         lr.result_value,
         lr.unit as result_unit
       FROM unit_reviews ur
       LEFT JOIN lab_results lr ON ur.result_id = lr.id
       ${whereClause}
       ORDER BY ur.created_at DESC`,
      status !== 'all' ? [status] : []
    );

    res.json({ reviews: rows });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to fetch unit reviews');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/admin/approve-unit-normalization
 * Approve LLM suggestion and create alias
 */
router.post('/approve-unit-normalization', async (req, res) => {
  const client = await adminPool.connect();

  try {
    const { review_id, create_alias = true } = req.body;

    if (!review_id) {
      return res.status(400).json({ error: 'review_id is required' });
    }

    await client.query('BEGIN');

    // Fetch review details
    const { rows: reviewRows } = await client.query(
      'SELECT * FROM unit_reviews WHERE review_id = $1',
      [review_id]
    );

    if (reviewRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Unit review not found' });
    }

    const review = reviewRows[0];

    if (!review.llm_suggestion) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No LLM suggestion to approve' });
    }

    // Create alias if requested
    let aliasCreated = false;
    if (create_alias) {
      await client.query(
        `INSERT INTO unit_aliases (alias, unit_canonical, source, learn_count, last_used_at)
         VALUES ($1, $2, 'admin_approved', 1, NOW())
         ON CONFLICT (alias) DO UPDATE SET
           unit_canonical = EXCLUDED.unit_canonical,
           source = EXCLUDED.source,
           learn_count = unit_aliases.learn_count + 1,
           last_used_at = NOW()`,
        [review.normalized_input, review.llm_suggestion]
      );
      aliasCreated = true;
    }

    // Mark review as resolved
    await client.query(
      `UPDATE unit_reviews
       SET status = 'resolved',
           resolved_at = NOW(),
           resolved_by = $1,
           resolved_action = 'approved',
           updated_at = NOW()
       WHERE review_id = $2`,
      [req.user?.email || 'admin', review_id]
    );

    await client.query('COMMIT');

    // Log admin action
    await logAdminAction('approve_unit_normalization', 'unit_review', review_id, {
      raw_unit: review.raw_unit,
      llm_suggestion: review.llm_suggestion,
      alias_created: aliasCreated
    }, req);

    logger.info({ review_id, alias_created: aliasCreated }, 'Unit normalization approved');

    res.json({
      success: true,
      canonical: review.llm_suggestion,
      alias_created: aliasCreated
    });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error: error.message }, 'Failed to approve unit normalization');
    res.status(500).json({ error: 'Internal server error', message: error.message });
  } finally {
    client.release();
  }
});

/**
 * POST /api/admin/reject-unit-normalization
 * Reject LLM suggestion, keep raw unit
 */
router.post('/reject-unit-normalization', async (req, res) => {
  try {
    const { review_id, reason } = req.body;

    if (!review_id) {
      return res.status(400).json({ error: 'review_id is required' });
    }

    const { rows } = await queryAsAdmin(
      `UPDATE unit_reviews
       SET status = 'resolved',
           resolved_at = NOW(),
           resolved_by = $1,
           resolved_action = 'rejected',
           updated_at = NOW()
       WHERE review_id = $2
       RETURNING raw_unit`,
      [req.user?.email || 'admin', review_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Unit review not found' });
    }

    // Log admin action
    await logAdminAction('reject_unit_normalization', 'unit_review', review_id, {
      raw_unit: rows[0].raw_unit,
      reason: reason || 'No reason provided'
    }, req);

    logger.info({ review_id, reason }, 'Unit normalization rejected');

    res.json({
      success: true,
      message: 'LLM suggestion rejected, raw unit will be used'
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to reject unit normalization');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/admin/override-unit-normalization
 * Admin manually enters canonical unit
 */
router.post('/override-unit-normalization', async (req, res) => {
  const client = await adminPool.connect();

  try {
    const { review_id, canonical_override } = req.body;

    if (!review_id || !canonical_override) {
      return res.status(400).json({
        error: 'review_id and canonical_override are required'
      });
    }

    await client.query('BEGIN');

    // Fetch review
    const { rows: reviewRows } = await client.query(
      'SELECT * FROM unit_reviews WHERE review_id = $1',
      [review_id]
    );

    if (reviewRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Unit review not found' });
    }

    const review = reviewRows[0];

    // Create alias with admin override
    await client.query(
      `INSERT INTO unit_aliases (alias, unit_canonical, source, learn_count, last_used_at)
       VALUES ($1, $2, 'admin_approved', 1, NOW())
       ON CONFLICT (alias) DO UPDATE SET
         unit_canonical = EXCLUDED.unit_canonical,
         learn_count = unit_aliases.learn_count + 1,
         last_used_at = NOW()`,
      [review.normalized_input, canonical_override]
    );

    // Mark review as resolved
    await client.query(
      `UPDATE unit_reviews
       SET status = 'resolved',
           resolved_at = NOW(),
           resolved_by = $1,
           resolved_action = 'manual_override',
           updated_at = NOW()
       WHERE review_id = $2`,
      [req.user?.email || 'admin', review_id]
    );

    await client.query('COMMIT');

    // Log admin action
    await logAdminAction('override_unit_normalization', 'unit_review', review_id, {
      raw_unit: review.raw_unit,
      llm_suggestion: review.llm_suggestion,
      admin_override: canonical_override
    }, req);

    logger.info({
      review_id,
      canonical_override
    }, 'Unit normalization overridden by admin');

    res.json({
      success: true,
      canonical: canonical_override
    });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error: error.message }, 'Failed to override unit normalization');
    res.status(500).json({ error: 'Internal server error', message: error.message });
  } finally {
    client.release();
  }
});

// ========================================================================
// PRD v4.4.6: Admin Read Access Endpoints
// All endpoints below use BYPASSRLS to allow admin access to all patients
// ========================================================================

/**
 * GET /api/admin/patients
 * List all patients (bypasses RLS)
 * Query params: ?sort=recent
 */
router.get('/patients', async (req, res) => {
  try {
    const { sort } = req.query;

    // PRD v4.4.6: Same ordering as /api/reports/patients
    let orderBy;
    if (sort === 'recent') {
      // Primary: last_seen_report_at DESC, tie-breakers: full_name ASC, created_at DESC
      orderBy = 'last_seen_report_at DESC NULLS LAST, full_name ASC NULLS LAST, created_at DESC';
    } else {
      // Default: alphabetical by full_name
      orderBy = 'full_name ASC NULLS LAST, created_at DESC';
    }

    const { rows } = await queryAsAdmin(`
      SELECT
        id,
        full_name,
        CASE
          WHEN full_name IS NOT NULL AND full_name != '' THEN full_name
          ELSE 'Patient (' || SUBSTRING(id::text FROM 1 FOR 6) || '...)'
        END AS display_name,
        last_seen_report_at
      FROM patients
      ORDER BY ${orderBy}
    `);

    res.json({ patients: rows });
  } catch (error) {
    logger.error({ error: error.message }, '[admin] Failed to list patients');
    res.status(500).json({ error: 'Failed to fetch patients' });
  }
});

/**
 * GET /api/admin/reports
 * List all reports with optional filters (bypasses RLS)
 * Query params: ?fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD&patientId=uuid
 */
router.get('/reports', async (req, res) => {
  const { fromDate, toDate, patientId } = req.query;

  // Validate date parameters
  if (fromDate && !isIsoDate(fromDate)) {
    return res.status(400).json({ error: 'fromDate must be valid YYYY-MM-DD format' });
  }
  if (toDate && !isIsoDate(toDate)) {
    return res.status(400).json({ error: 'toDate must be valid YYYY-MM-DD format' });
  }
  if (patientId && !isUuid(patientId)) {
    return res.status(400).json({ error: 'patientId must be valid UUID' });
  }

  try {
    // PRD v4.4.6: Same query structure as /api/reports
    // PRD v4.0: Use to_char() for consistent string output in SELECT
    let query = `
      SELECT
        pr.id AS report_id,
        to_char(${EFFECTIVE_DATE_EXPR}, 'YYYY-MM-DD') AS effective_date,
        p.id AS patient_id,
        COALESCE(pr.patient_name_snapshot, p.full_name, 'Unnamed Patient') AS patient_name,
        (pr.file_path IS NOT NULL) AS has_file
      FROM patient_reports pr
      JOIN patients p ON pr.patient_id = p.id
      WHERE pr.status = 'completed'
    `;

    const params = [];
    let paramIndex = 1;

    if (fromDate) {
      query += ` AND ${EFFECTIVE_DATE_EXPR} >= $${paramIndex}`;
      params.push(fromDate);
      paramIndex++;
    }

    if (toDate) {
      query += ` AND ${EFFECTIVE_DATE_EXPR} <= $${paramIndex}`;
      params.push(toDate);
      paramIndex++;
    }

    if (patientId) {
      query += ` AND pr.patient_id = $${paramIndex}`;
      params.push(patientId);
      paramIndex++;
    }

    query += `
      ORDER BY ${EFFECTIVE_DATE_EXPR} DESC,
        pr.recognized_at DESC,
        pr.id DESC
    `;

    const result = await queryAsAdmin(query, params);

    res.json({
      reports: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    logger.error({ error: error.message }, '[admin] Failed to list reports');
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

/**
 * GET /api/admin/reports/:reportId
 * Get detailed report with lab results (bypasses RLS)
 */
router.get('/reports/:reportId', async (req, res) => {
  const { reportId } = req.params;

  if (!isUuid(reportId)) {
    return res.status(400).json({ error: 'Invalid report id' });
  }

  try {
    const result = await getReportDetail(reportId, { mode: 'admin' });

    if (!result) {
      return res.status(404).json({ error: 'Report not found', report_id: reportId });
    }

    return res.json(result);
  } catch (error) {
    logger.error({ error: error.message }, '[admin] Failed to fetch report detail');
    return res.status(500).json({ error: 'Unable to fetch report detail' });
  }
});

/**
 * GET /api/admin/patients/:patientId/reports
 * Get patient with their reports (bypasses RLS)
 * No status filter - returns all reports regardless of status
 */
router.get('/patients/:patientId/reports', async (req, res) => {
  const { patientId } = req.params;

  if (!isUuid(patientId)) {
    return res.status(400).json({ error: 'Invalid patient id' });
  }

  try {
    const result = await getPatientReports(patientId, {
      limit: req.query.limit,
      offset: req.query.offset,
    }, { mode: 'admin' });

    if (!result) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    return res.json(result);
  } catch (error) {
    logger.error({ error: error.message }, '[admin] Failed to fetch patient reports');
    return res.status(500).json({ error: 'Unable to fetch patient reports' });
  }
});

/**
 * GET /api/admin/reports/:reportId/original-file
 * Download original lab report file (bypasses RLS)
 */
router.get('/reports/:reportId/original-file', async (req, res) => {
  const { reportId } = req.params;
  return streamOriginalFile(reportId, { mode: 'admin' }, res);
});

export default router;
