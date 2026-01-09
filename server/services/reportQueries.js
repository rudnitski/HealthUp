// server/services/reportQueries.js
// PRD v4.4.6: Shared SQL expressions and helpers for report queries
// Single source of truth for date parsing logic used by both user and admin endpoints

/**
 * SQL expression for effective report date
 * Uses pre-parsed test_date column with recognized_at fallback
 *
 * PRD v4.0: Simplified from complex regex parsing to use normalized test_date column
 * Returns DATE type (not TEXT) for proper index usage and type semantics
 *
 * Used in: GET /api/reports, GET /api/admin/reports
 * Must use `pr.` prefix for patient_reports table alias
 */
export const EFFECTIVE_DATE_EXPR = `
  COALESCE(pr.test_date, pr.recognized_at::date)
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
