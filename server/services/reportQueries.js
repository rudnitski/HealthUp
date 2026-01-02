// server/services/reportQueries.js
// PRD v4.4.6: Shared SQL expressions and helpers for report queries
// Single source of truth for date parsing logic used by both user and admin endpoints

/**
 * SQL expression to parse multiple date formats into YYYY-MM-DD
 * Supports:
 * - ISO format: YYYY-MM-DD, YYYY-MM-DDTHH:mm:ss
 * - European format: DD/MM/YYYY, DD.MM.YYYY
 * - Fallback: recognized_at timestamp
 *
 * Used in: GET /api/reports, GET /api/admin/reports
 * Must use `pr.` prefix for patient_reports table alias
 */
export const EFFECTIVE_DATE_EXPR = `
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

/**
 * UUID validation regex (RFC 4122 compliant)
 */
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validate if a string is a valid UUID
 * @param {string} value - Value to validate
 * @returns {boolean} True if valid UUID
 */
export function isUuid(value) {
  return UUID_REGEX.test(value);
}

/**
 * ISO date format regex (YYYY-MM-DD)
 */
export const ISO_DATE_REGEX = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;

/**
 * Validate if a string is a valid ISO date format
 * @param {string} value - Value to validate
 * @returns {boolean} True if valid ISO date
 */
export function isIsoDate(value) {
  return ISO_DATE_REGEX.test(value);
}
