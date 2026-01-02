// server/services/fileDownload.js
// PRD v4.4.6: Shared file download logic for user and admin endpoints
// Single source of truth for file download security measures

import { adminPool, queryWithUser } from '../db/index.js';
import { readFile } from './fileStorage.js';
import { isUuid } from './reportQueries.js';

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
 * @param {string} filename - Original filename
 * @param {string} disposition - 'inline' or 'attachment'
 * @returns {string} Content-Disposition header value
 */
function buildContentDispositionHeader(filename, disposition = 'inline') {
  const sanitized = sanitizeFilenameForHeader(filename);
  // ASCII-only fallback to avoid "Invalid character in header" errors
  const asciiFallback = sanitized.replace(/[^\x20-\x7E]/g, '_') || 'lab_report';
  const encodedUtf8 = encodeURIComponent(sanitized);
  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encodedUtf8}`;
}

/**
 * Stream original file for a report
 * PRD v4.4.6: Shared helper for user and admin endpoints
 *
 * @param {string} reportId - Report UUID
 * @param {object} executionOptions - Execution mode options
 * @param {string} executionOptions.mode - 'user' | 'admin'
 * @param {string} [executionOptions.userId] - Required when mode='user'
 * @param {object} res - Express response object
 * @returns {Promise<void>}
 */
async function streamOriginalFile(reportId, executionOptions, res) {
  const { mode, userId } = executionOptions;

  // Validate UUID format
  if (!isUuid(reportId)) {
    return res.status(400).json({ error: 'Invalid report id' });
  }

  try {
    // Query report based on execution mode
    let result;
    const query = `
      SELECT file_path, source_filename, file_mimetype, recognized_at
      FROM patient_reports
      WHERE id = $1
    `;

    if (mode === 'admin') {
      // Admin mode: Use adminPool (BYPASSRLS)
      result = await adminPool.query(query, [reportId]);
    } else {
      // User mode: Use queryWithUser (RLS enforced)
      result = await queryWithUser(query, [reportId], userId);
    }

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Report not found',
        report_id: reportId
      });
    }

    const { file_path, source_filename, file_mimetype, recognized_at } = result.rows[0];

    // Check if file path exists (report may predate file storage)
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
    console.error('[fileDownload] File retrieval error:', error);
    return res.status(500).json({ error: 'Failed to retrieve file' });
  }
}

export {
  sanitizeFilenameForHeader,
  buildContentDispositionHeader,
  streamOriginalFile
};
