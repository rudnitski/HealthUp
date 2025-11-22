const express = require('express');
const { getPatientReports, getReportDetail } = require('../services/reportRetrieval');
const { pool } = require('../db');

const router = express.Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isUuid = (value) => UUID_REGEX.test(value);

router.get('/patients/:patientId/reports', async (req, res) => {
  const { patientId } = req.params;

  if (!isUuid(patientId)) {
    return res.status(400).json({ error: 'Invalid patient id' });
  }

  try {
    const result = await getPatientReports(patientId, {
      limit: req.query.limit,
      offset: req.query.offset,
    });

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

router.get('/reports/:reportId', async (req, res) => {
  const { reportId } = req.params;

  if (!isUuid(reportId)) {
    return res.status(400).json({ error: 'Invalid report id' });
  }

  try {
    const result = await getReportDetail(reportId);

    if (!result) {
      return res.status(404).json({ error: 'Report not found' });
    }

    return res.json(result);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[reports] Failed to fetch report detail', error);
    return res.status(500).json({ error: 'Unable to fetch report detail' });
  }
});

router.get('/reports/:reportId/original-file', async (req, res) => {
  const { reportId } = req.params;

  if (!isUuid(reportId)) {
    return res.status(400).json({ error: 'Invalid report id' });
  }

  // Phase 1: No auth checks (single-user development mode)
  // TODO: Add authentication + authorization before production deployment

  try {
    const result = await pool.query(
      `SELECT file_data, source_filename, file_mimetype, recognized_at
       FROM patient_reports
       WHERE id = $1`,
      [reportId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Report not found',
        report_id: reportId
      });
    }

    const { file_data, source_filename, file_mimetype, recognized_at } = result.rows[0];

    if (!file_data) {
      return res.status(410).json({
        error: 'Original file not available',
        reason: 'report_predates_file_storage',
        report_id: reportId,
        recognized_at: recognized_at
      });
    }

    // Use stored mimetype (already normalized during persistence)
    // Fallback only for legacy NULL records
    const contentType = file_mimetype || 'application/octet-stream';

    // PHI protection: prevent browser caching of medical records
    res.set('Content-Type', contentType);
    res.set('Content-Disposition', `inline; filename="${source_filename || 'lab_report'}"`);
    res.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    return res.send(file_data);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[reports] File retrieval error:', error);
    return res.status(500).json({ error: 'Failed to retrieve file' });
  }
});

module.exports = router;
