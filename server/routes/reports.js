// server/routes/reports.js
// PRD v4.4.6: Refactored to use shared helpers from reportQueries.js and fileDownload.js

import express from 'express';
import { getPatientReports, getReportDetail } from '../services/reportRetrieval.js';
import { queryWithUser } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { EFFECTIVE_DATE_EXPR, isUuid, isIsoDate } from '../services/reportQueries.js';
import { streamOriginalFile } from '../services/fileDownload.js';

const router = express.Router();

// PRD v4.4.3: Add requireAuth for user-scoped data
router.get('/patients/:patientId/reports', requireAuth, async (req, res) => {
  const { patientId } = req.params;

  if (!isUuid(patientId)) {
    return res.status(400).json({ error: 'Invalid patient id' });
  }

  try {
    // PRD v4.4.6: Use executionOptions pattern
    const result = await getPatientReports(patientId, {
      limit: req.query.limit,
      offset: req.query.offset,
    }, { mode: 'user', userId: req.user.id });

    if (!result) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    return res.json(result);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[reports] Failed to fetch patient reports', error);
    return res.status(500).json({ error: 'Unable to fetch patient reports' });
  }
});

// GET /api/reports - List all reports with optional filters
// Query params: ?fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD&patientId=uuid
// PRD v4.4.3: Add requireAuth for user-scoped data
router.get('/reports', requireAuth, async (req, res) => {
  const { fromDate, toDate, patientId } = req.query;

  // Validate date parameters (must be valid ISO format YYYY-MM-DD)
  if (fromDate && !isIsoDate(fromDate)) {
    return res.status(400).json({ error: 'fromDate must be valid YYYY-MM-DD format' });
  }
  if (toDate && !isIsoDate(toDate)) {
    return res.status(400).json({ error: 'toDate must be valid YYYY-MM-DD format' });
  }

  // Validate patientId is valid UUID if provided
  if (patientId && !isUuid(patientId)) {
    return res.status(400).json({ error: 'patientId must be valid UUID' });
  }

  try {
    // PRD v4.4.6: Use shared EFFECTIVE_DATE_EXPR from reportQueries.js
    let query = `
      SELECT
        pr.id AS report_id,
        ${EFFECTIVE_DATE_EXPR} AS effective_date,
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

    // Sort by effective date (parsed from multiple formats)
    query += `
      ORDER BY ${EFFECTIVE_DATE_EXPR} DESC,
        pr.recognized_at DESC,
        pr.id DESC
    `;

    // PRD v4.4.3: Use queryWithUser for RLS-scoped access
    const result = await queryWithUser(query, params, req.user.id);

    res.json({
      reports: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[reports] Failed to list reports:', error);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

// GET /api/reports/patients - List all patients for filter dropdown or chat selector
// PRD v4.3: Extended with ?sort=recent parameter and computed display_name field
// PRD v4.4.3: Add requireAuth for user-scoped data
router.get('/reports/patients', requireAuth, async (req, res) => {
  try {
    const { sort } = req.query;

    // PRD v4.3: Order by for different use cases
    // - Default (alpha): alphabetical by full_name for reports browser
    // - sort=recent: by last_seen_report_at for chat patient selector
    let orderBy;
    if (sort === 'recent') {
      orderBy = 'last_seen_report_at DESC NULLS LAST, full_name ASC NULLS LAST, created_at DESC';
    } else {
      orderBy = 'full_name ASC NULLS LAST, created_at DESC';
    }

    // PRD v4.4.3: Use queryWithUser for RLS-scoped access
    const result = await queryWithUser(`
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
    `, [], req.user.id);

    res.json({ patients: result.rows });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[reports] Failed to list patients:', error);
    res.status(500).json({ error: 'Failed to fetch patients' });
  }
});

// PRD v4.4.3: Add requireAuth for user-scoped data
router.get('/reports/:reportId', requireAuth, async (req, res) => {
  const { reportId } = req.params;

  if (!isUuid(reportId)) {
    return res.status(400).json({ error: 'Invalid report id' });
  }

  try {
    // PRD v4.4.6: Use executionOptions pattern
    const result = await getReportDetail(reportId, { mode: 'user', userId: req.user.id });

    if (!result) {
      return res.status(404).json({ error: 'Report not found', report_id: reportId });
    }

    return res.json(result);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[reports] Failed to fetch report detail', error);
    return res.status(500).json({ error: 'Unable to fetch report detail' });
  }
});

// PRD v4.4.6: Refactored to use shared streamOriginalFile helper
router.get('/reports/:reportId/original-file', requireAuth, async (req, res) => {
  const { reportId } = req.params;
  return streamOriginalFile(reportId, { mode: 'user', userId: req.user.id }, res);
});

export default router;
