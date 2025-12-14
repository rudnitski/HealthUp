import express from 'express';
import { getPatientReports, getReportDetail } from '../services/reportRetrieval.js';
import { pool } from '../db/index.js';
import { readFile } from '../services/fileStorage.js';

const router = express.Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isUuid = (value) => UUID_REGEX.test(value);

// Timestamp normalization helper (matches reportRetrieval.js pattern)
const toIsoString = (value) => {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
};

/**
 * Sanitize filename for use in Content-Disposition header
 * Prevents HTTP header injection, response splitting, and other attacks
 * @param {string} filename - Original filename from user input
 * @returns {string} Sanitized filename safe for HTTP headers
 */
function sanitizeFilenameForHeader(filename) {
  if (!filename || typeof filename !== 'string') {
    return 'lab_report';
  }

  // Remove path separators and null bytes
  let safe = filename.replace(/[/\\:\x00]/g, '_');

  // Remove or replace control characters (including CR/LF for header injection prevention)
  safe = safe.replace(/[\x00-\x1f\x7f-\x9f]/g, '');

  // Escape quotes and backslashes for proper header quoting
  safe = safe.replace(/["\\]/g, '\\$&');

  // Remove leading/trailing whitespace and dots (security)
  safe = safe.trim().replace(/^\.+|\.+$/g, '');

  // Limit length to prevent header bloat
  if (safe.length > 200) {
    // Try to preserve extension
    const lastDot = safe.lastIndexOf('.');
    if (lastDot > 0 && lastDot > safe.length - 10) {
      const ext = safe.substring(lastDot);
      safe = safe.substring(0, 190 - ext.length) + ext;
    } else {
      safe = safe.substring(0, 200);
    }
  }

  // Fallback if sanitization removed everything
  return safe || 'lab_report';
}

/**
 * Build a safe Content-Disposition header value with RFC5987 encoding
 * Provides an ASCII fallback filename and a UTF-8 encoded filename* parameter
 */
function buildContentDispositionHeader(filename, disposition = 'inline') {
  const sanitized = sanitizeFilenameForHeader(filename);
  // ASCII-only fallback to avoid "Invalid character in header" errors
  const asciiFallback = sanitized.replace(/[^\x20-\x7E]/g, '_') || 'lab_report';
  const encodedUtf8 = encodeURIComponent(sanitized);
  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encodedUtf8}`;
}


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

// GET /api/reports - List all reports with optional filters
// Query params: ?fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD&patientId=uuid
router.get('/reports', async (req, res) => {
  const { fromDate, toDate, patientId } = req.query;

  // Validate date parameters (must be valid ISO format YYYY-MM-DD)
  const ISO_DATE_REGEX = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
  if (fromDate && !ISO_DATE_REGEX.test(fromDate)) {
    return res.status(400).json({ error: 'fromDate must be valid YYYY-MM-DD format' });
  }
  if (toDate && !ISO_DATE_REGEX.test(toDate)) {
    return res.status(400).json({ error: 'toDate must be valid YYYY-MM-DD format' });
  }

  // Validate patientId is valid UUID if provided
  if (patientId && !isUuid(patientId)) {
    return res.status(400).json({ error: 'patientId must be valid UUID' });
  }

  // SQL expression to parse multiple date formats into YYYY-MM-DD
  // Supports: ISO (YYYY-MM-DD, YYYY-MM-DDTHH:mm:ss), European (DD/MM/YYYY, DD.MM.YYYY)
  // Single source of truth - returned as effective_date column for frontend display
  const effectiveDateExpr = `
    CASE
      WHEN pr.test_date_text ~ '^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])'
      THEN SUBSTRING(pr.test_date_text FROM 1 FOR 10)
      WHEN pr.test_date_text ~ '^\\d{1,2}[/.]\\d{1,2}[/.]\\d{4}'
      THEN CONCAT(
        SUBSTRING(pr.test_date_text FROM '(\\d{4})'),
        '-',
        LPAD(SUBSTRING(pr.test_date_text FROM '^\\d{1,2}[/.](\\d{1,2})'), 2, '0'),
        '-',
        LPAD(SUBSTRING(pr.test_date_text FROM '^(\\d{1,2})'), 2, '0')
      )
      ELSE to_char(pr.recognized_at, 'YYYY-MM-DD')
    END
  `;

  try {
    let query = `
      SELECT
        pr.id AS report_id,
        ${effectiveDateExpr} AS effective_date,
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
      query += ` AND ${effectiveDateExpr} >= $${paramIndex}`;
      params.push(fromDate);
      paramIndex++;
    }

    if (toDate) {
      query += ` AND ${effectiveDateExpr} <= $${paramIndex}`;
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
      ORDER BY ${effectiveDateExpr} DESC,
        pr.recognized_at DESC,
        pr.id DESC
    `;

    const result = await pool.query(query, params);

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

// GET /api/reports/patients - List all patients for filter dropdown
router.get('/reports/patients', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, COALESCE(full_name, 'Unnamed Patient') AS full_name
      FROM patients
      ORDER BY full_name ASC
    `);

    res.json({ patients: result.rows });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[reports] Failed to list patients:', error);
    res.status(500).json({ error: 'Failed to fetch patients' });
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
      `SELECT file_path, source_filename, file_mimetype, recognized_at
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

    const { file_path, source_filename, file_mimetype, recognized_at } = result.rows[0];

    if (!file_path) {
      return res.status(410).json({
        error: 'Original file not available',
        reason: 'report_predates_file_storage',
        report_id: reportId,
        recognized_at: recognized_at
      });
    }

    // Read file from filesystem
    const fileBuffer = await readFile(file_path);

    if (!fileBuffer) {
      return res.status(404).json({
        error: 'File not found on disk',
        reason: 'file_missing_from_storage',
        report_id: reportId,
        file_path: file_path
      });
    }

    // Use stored mimetype (already normalized during persistence)
    // Fallback only for legacy NULL records
    const contentType = file_mimetype || 'application/octet-stream';

    // Sanitize filename to prevent header injection attacks
    const contentDisposition = buildContentDispositionHeader(source_filename);

    // PHI protection: prevent browser caching of medical records
    res.set('Content-Type', contentType);
    res.set('Content-Disposition', contentDisposition);
    res.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    return res.send(fileBuffer);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[reports] File retrieval error:', error);
    return res.status(500).json({ error: 'Failed to retrieve file' });
  }
});

export default router;
