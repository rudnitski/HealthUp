/**
 * Date parsing utility for lab report date normalization
 *
 * Supported formats:
 * - ISO: YYYY-MM-DD, YYYY-MM-DDTHH:mm:ss (zero-padded only)
 * - European (unambiguous): DD/MM/YYYY, DD.MM.YYYY, DD-MM-YYYY where day > 12
 * - Two-digit years: DD/MM/YY (assumes 20xx for YY < 50, 19xx otherwise)
 *
 * NOT supported (by design):
 * - Non-zero-padded ISO (e.g., 2021-4-1) - LLM should output padded format
 * - Ambiguous dates where day <= 12 AND month <= 12 - returns null
 * - US format MM/DD/YYYY - this is a Russian health app
 */

/**
 * Parse various date formats into a normalized Date object
 * @param {string} dateStr - Raw date string from OCR
 * @returns {Date|null} - Parsed date or null if unparseable/ambiguous
 */
export function parseTestDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;

  const trimmed = dateStr.trim();
  if (!trimmed) return null;

  let year, month, day;

  // Pattern 1: ISO format - YYYY-MM-DD (zero-padded, with optional time suffix)
  // Note: Non-padded ISO (2021-4-1) is intentionally unsupported - LLM should output padded
  // Note: Regex is not end-anchored to allow time suffixes like "2021-04-14T20:15:00"
  const isoMatch = trimmed.match(/^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])/);
  if (isoMatch) {
    year = parseInt(isoMatch[1], 10);
    month = parseInt(isoMatch[2], 10);
    day = parseInt(isoMatch[3], 10);
  } else {
    // Pattern 2: European - DD/MM/YYYY, DD.MM.YYYY, or DD-MM-YYYY (with optional time)
    const euroMatch = trimmed.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
    if (euroMatch) {
      day = parseInt(euroMatch[1], 10);
      month = parseInt(euroMatch[2], 10);
      year = parseInt(euroMatch[3], 10);

      // Handle two-digit years: 00-49 -> 2000-2049, 50-99 -> 1950-1999
      if (year < 100) {
        year = year < 50 ? 2000 + year : 1900 + year;
      }

      // AMBIGUOUS DATE CHECK: If both day and month could be valid as either,
      // we cannot determine the format without context. Return null.
      // The LLM is responsible for converting these using report context.
      if (day <= 12 && month <= 12) {
        return null; // Ambiguous - could be DD/MM or MM/DD
      }
    }
  }

  // No pattern matched
  if (year === undefined) return null;

  // Basic bounds check
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  // Year sanity check (lab reports from 1950-2100)
  if (year < 1950 || year > 2100) return null;

  // Create date and validate via round-trip
  // This catches invalid dates like Feb 31 where JS Date would roll over
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null; // Date rolled over (e.g., Feb 31 -> Mar 3), reject as invalid
  }

  return date;
}

/**
 * Format Date object to YYYY-MM-DD string for database storage
 *
 * IMPORTANT: Uses local date components to avoid timezone shift.
 * Do NOT use toISOString() as it converts to UTC, which can shift
 * the date by one day depending on local timezone.
 *
 * @param {Date} date - Date object to format
 * @returns {string|null} - Formatted date string or null
 */
export function formatDateForDb(date) {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
    return null;
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parse and format in one step (convenience function)
 * @param {string} dateStr - Raw date string from OCR
 * @returns {string|null} - ISO formatted date string or null
 */
export function normalizeTestDate(dateStr) {
  return formatDateForDb(parseTestDate(dateStr));
}
