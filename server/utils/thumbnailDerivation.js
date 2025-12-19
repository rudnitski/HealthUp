// server/utils/thumbnailDerivation.js
// Thumbnail Derivation Module - PRD v4.2.2
// Pure functions for deriving thumbnail data from plot rows

import crypto from 'crypto';

/**
 * Parse timestamp to epoch milliseconds
 * @param {string|number} t - ISO 8601 string, epoch seconds, epoch ms, or numeric string
 * @returns {number|null} - Epoch ms or null if invalid
 */
function parseTimestamp(t) {
  if (typeof t === 'number') {
    // Heuristic: values < 10^12 are seconds, >= 10^12 are milliseconds
    // 10^12 ms = Sept 2001, all realistic lab data falls clearly into one category
    return t < 1e12 ? t * 1000 : t;
  }
  if (typeof t === 'string') {
    // First, check if it's a numeric string (epoch ms or seconds)
    // This handles cases where DB returns bigint timestamps as strings
    if (/^\d+$/.test(t)) {
      const numericValue = parseInt(t, 10);
      // Apply same heuristic as number case
      return numericValue < 1e12 ? numericValue * 1000 : numericValue;
    }

    // Parse ISO 8601; assume timestamps include offset or are already UTC.
    // If no offset is present, append 'Z' (backend treats them as UTC).
    let timeStr = t;
    if (!/Z$|[+-]\d{2}:?\d{2}$/.test(timeStr)) {
      timeStr += 'Z';
    }
    const parsed = Date.parse(timeStr);
    if (isNaN(parsed)) return null;
    return parsed;
  }
  return null;
}

/**
 * Filter out rows with invalid data
 * @param {Array} data - Raw data array
 * @returns {Array} - Filtered valid rows
 */
function filterValidRows(data) {
  return data.filter(row => {
    const t = parseTimestamp(row.t);
    const y = row.y;

    // Must have valid timestamp
    if (t === null) return false;

    // Must have finite numeric y value
    if (typeof y !== 'number' || !Number.isFinite(y)) return false;

    // Must have required string fields (schema enforces these, but defensive)
    if (typeof row.parameter_name !== 'string' || !row.parameter_name) return false;
    if (typeof row.unit !== 'string') return false;  // Allow empty string

    return true;
  });
}

/**
 * Sort rows by timestamp ascending
 * @param {Array} data - Array of rows
 * @returns {Array} - Sorted copy of rows
 */
function sortByTimestamp(data) {
  return data.slice().sort((a, b) => {
    return parseTimestamp(a.t) - parseTimestamp(b.t);
  });
}

/**
 * Preprocess data: filter invalid rows and sort by timestamp
 * @param {Array} data - Raw data array
 * @returns {Array} - Preprocessed rows
 */
function preprocessData(data) {
  const filtered = filterValidRows(data);
  const sorted = sortByTimestamp(filtered);
  return sorted;
}

/**
 * Get focus series based on LLM hint or alphabetical fallback
 * @param {Array} data - Preprocessed data
 * @param {string|null} focusAnalyteName - LLM-provided focus analyte name
 * @returns {Object} - { name, rows }
 */
function getFocusSeries(data, focusAnalyteName) {
  const seriesNames = [...new Set(data.map(r => r.parameter_name))].sort();

  const focusName = (focusAnalyteName && seriesNames.includes(focusAnalyteName))
    ? focusAnalyteName
    : seriesNames[0];

  return {
    name: focusName || null,
    rows: data.filter(r => r.parameter_name === focusName)
  };
}

/**
 * Normalize unit string for comparison
 * @param {string|null|undefined} unit - Unit string
 * @returns {string} - Normalized lowercase trimmed string
 */
function normalizeUnit(unit) {
  if (unit === null || unit === undefined || unit === '') {
    return '';
  }
  return String(unit).trim().toLowerCase();
}

/**
 * Get unit info from focus series rows
 * @param {Array} focusRows - Rows for focus series
 * @returns {Object} - { unit_raw, unit_display, isMixed }
 */
function getUnitInfo(focusRows) {
  const units = focusRows.map(r => r.unit);
  const normalizedUnits = new Set(units.map(normalizeUnit));

  const isMixed = normalizedUnits.size > 1;
  const latestUnit = focusRows.length > 0
    ? focusRows[focusRows.length - 1].unit
    : null;

  return {
    unit_raw: latestUnit,
    unit_display: latestUnit,
    isMixed
  };
}

/**
 * Derive status with LLM-guided, backend-validated approach
 *
 * Priority:
 * 1. Mixed units -> "unknown" (data quality failure, backend override)
 * 2. LLM confident (status != "unknown") -> trust LLM clinical judgment
 * 3. LLM uncertain + bounds available -> compute from reference ranges
 * 4. Otherwise -> "unknown"
 *
 * @param {string} llmStatus - Status from LLM config
 * @param {number|null} latestValue - Latest y value
 * @param {Array} focusRows - Rows for focus series
 * @param {boolean} isMixedUnits - Whether units are mixed
 * @returns {string} - Derived status
 */
function deriveStatus(llmStatus, latestValue, focusRows, isMixedUnits) {
  // Priority 1: Mixed units force unknown (backend override - data quality)
  if (isMixedUnits) return 'unknown';

  // Priority 2: LLM is confident -> trust clinical judgment
  if (llmStatus !== 'unknown') return llmStatus;

  // Priority 3: LLM said unknown, backend computes from reference bounds
  const latestRow = focusRows[focusRows.length - 1];
  if (!latestRow) return 'unknown';

  const { reference_lower, reference_upper } = latestRow;

  // Need at least one bound to compute
  if (reference_upper !== undefined && latestValue > reference_upper) return 'high';
  if (reference_lower !== undefined && latestValue < reference_lower) return 'low';
  if (reference_upper !== undefined || reference_lower !== undefined) return 'normal';

  // Priority 4: No bounds available
  return 'unknown';
}

/**
 * Derive percentage change from first to last value
 * @param {Array} focusRows - Rows for focus series
 * @param {boolean} isMixedUnits - Whether units are mixed
 * @returns {number|null} - Percentage change or null
 */
function deriveDeltaPct(focusRows, isMixedUnits) {
  if (isMixedUnits) return null;
  if (focusRows.length < 2) return null;

  const firstValue = focusRows[0].y;
  const lastValue = focusRows[focusRows.length - 1].y;

  if (firstValue === 0) return null;

  return Math.round(((lastValue - firstValue) / Math.abs(firstValue)) * 100);
}

/**
 * Derive delta direction from percentage
 * @param {number|null} deltaPct - Percentage change
 * @returns {string|null} - "up", "down", "stable", or null
 */
function deriveDeltaDirection(deltaPct) {
  if (deltaPct === null) return null;
  if (deltaPct > 1) return 'up';
  if (deltaPct < -1) return 'down';
  return 'stable';
}

/**
 * Derive human-readable time period
 * @param {Array} focusRows - Rows for focus series
 * @param {boolean} isMixedUnits - Whether units are mixed
 * @returns {string|null} - Period string like "2y", "3m", "1w", "5d"
 */
function deriveDeltaPeriod(focusRows, isMixedUnits) {
  if (isMixedUnits) return null;
  if (focusRows.length < 2) return null;

  const firstT = parseTimestamp(focusRows[0].t);
  const lastT = parseTimestamp(focusRows[focusRows.length - 1].t);

  const days = (lastT - firstT) / (1000 * 60 * 60 * 24);

  if (days >= 365) return `${Math.round(days / 365)}y`;
  if (days >= 30) return `${Math.round(days / 30)}m`;
  if (days >= 7) return `${Math.round(days / 7)}w`;
  return `${Math.round(days)}d`;
}

/**
 * Downsample values array to max points
 * @param {Array} values - Numeric values array
 * @param {number} maxPoints - Maximum points to return
 * @returns {Array} - Downsampled values
 */
function downsample(values, maxPoints = 30) {
  const n = values.length;
  if (n === 0) return [0]; // Empty data fallback
  if (n <= maxPoints) return values;

  const result = [values[0]]; // Always include first

  const middleSlots = maxPoints - 2;
  const middleValues = values.slice(1, -1);
  const stride = middleValues.length / middleSlots;

  for (let i = 0; i < middleSlots; i++) {
    result.push(middleValues[Math.floor(i * stride)]);
  }

  result.push(values[n - 1]); // Always include last
  return result;
}

/**
 * Validate thumbnail config from LLM
 * @param {Object} thumbnail - Thumbnail config object
 * @returns {Object} - { valid, errors }
 */
function validateThumbnailConfig(thumbnail) {
  const errors = [];

  // Status is optional in schema - validate enum if present
  const validStatuses = ['normal', 'high', 'low', 'unknown'];
  if (thumbnail.status !== undefined && !validStatuses.includes(thumbnail.status)) {
    errors.push(`status must be one of: ${validStatuses.join(', ')}`);
  }

  if (thumbnail.focus_analyte_name !== undefined &&
      typeof thumbnail.focus_analyte_name !== 'string') {
    errors.push('focus_analyte_name must be a string if provided');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Create empty thumbnail for when there's no data
 * @param {string} plotTitle - Plot title
 * @returns {Object} - Empty thumbnail object
 */
function deriveEmptyThumbnail(plotTitle) {
  return {
    plot_title: plotTitle,
    focus_analyte_name: null,
    point_count: 0,
    series_count: 0,
    latest_value: null,
    unit_raw: null,
    unit_display: null,
    status: 'unknown',
    delta_pct: null,
    delta_direction: null,
    delta_period: null,
    sparkline: { series: [0] }
  };
}

/**
 * Create fallback thumbnail when validation fails
 * @param {string} plotTitle - Plot title
 * @param {Array} data - Raw data array
 * @returns {Object} - Fallback thumbnail object
 */
function deriveFallbackThumbnail(plotTitle, data) {
  const preprocessed = preprocessData(data);
  const focusSeries = getFocusSeries(preprocessed, null);
  const unitInfo = getUnitInfo(focusSeries.rows);

  return {
    plot_title: plotTitle,
    focus_analyte_name: focusSeries.name,
    point_count: focusSeries.rows.length,
    series_count: new Set(preprocessed.map(r => r.parameter_name)).size,
    latest_value: focusSeries.rows.length > 0
      ? focusSeries.rows[focusSeries.rows.length - 1].y
      : null,
    unit_raw: unitInfo.unit_raw,
    unit_display: unitInfo.unit_display,
    status: 'unknown',
    delta_pct: null,
    delta_direction: null,
    delta_period: null,
    sparkline: { series: downsample(focusSeries.rows.map(r => r.y)) }
  };
}

/**
 * Main entry point: derive complete thumbnail from sanitized plot rows and LLM config
 * @param {Object} params - { plot_title, thumbnail, rows }
 * @returns {{ thumbnail: Object, resultId: string } | null}
 */
function deriveThumbnail(params) {
  const { rows, plot_title, thumbnail: thumbnailConfig } = params;

  // If config omitted, return null (intentional omission by LLM)
  if (!thumbnailConfig) {
    return null;
  }

  // Generate ephemeral result_id (no replacement support yet)
  const resultId = crypto.randomUUID();

  // Validate config
  const validationResult = validateThumbnailConfig(thumbnailConfig);
  if (!validationResult.valid) {
    return {
      thumbnail: deriveFallbackThumbnail(plot_title, rows || []),
      resultId
    };
  }

  // Handle empty data
  if (!rows || rows.length === 0) {
    return {
      thumbnail: deriveEmptyThumbnail(plot_title),
      resultId
    };
  }

  // rows are already sanitized (preprocess + normalize + ensureOutOfRange)
  const focusAnalyteName = thumbnailConfig?.focus_analyte_name || null;
  const focusSeries = getFocusSeries(rows, focusAnalyteName);

  // Check for mixed units
  const unitInfo = getUnitInfo(focusSeries.rows);
  const isMixedUnits = unitInfo.isMixed;

  // Derive all fields
  const latestValue = focusSeries.rows.length > 0
    ? focusSeries.rows[focusSeries.rows.length - 1].y
    : null;

  const llmStatus = thumbnailConfig?.status || 'unknown';
  const status = deriveStatus(llmStatus, latestValue, focusSeries.rows, isMixedUnits);
  const deltaPct = deriveDeltaPct(focusSeries.rows, isMixedUnits);
  const deltaDirection = deriveDeltaDirection(deltaPct);
  const deltaPeriod = deriveDeltaPeriod(focusSeries.rows, isMixedUnits);
  const sparkline = { series: downsample(focusSeries.rows.map(r => r.y)) };

  // Assemble thumbnail
  const thumbnail = {
    plot_title,
    focus_analyte_name: focusSeries.name,
    point_count: focusSeries.rows.length,
    series_count: new Set(rows.map(r => r.parameter_name)).size,
    latest_value: latestValue,
    unit_raw: unitInfo.unit_raw,
    unit_display: unitInfo.unit_display,
    status,
    delta_pct: deltaPct,
    delta_direction: deltaDirection,
    delta_period: deltaPeriod,
    sparkline
  };

  return {
    thumbnail,
    resultId
  };
}

/**
 * Normalize timestamps for frontend plot rendering
 * Frontend uses parseInt(row.t, 10) which fails on ISO strings
 * @param {Array} rows - Preprocessed rows
 * @returns {Array} - Rows with t as epoch ms
 */
function normalizeRowsForFrontend(rows) {
  return rows.map(row => ({
    ...row,
    t: parseTimestamp(row.t)
  }));
}

/**
 * Compute is_out_of_range for backward compatibility
 * Frontend relies on is_out_of_range field for red highlighting
 * Legacy field is_value_out_of_range must be mirrored bidirectionally
 * @param {Array} rows - Rows to process
 * @returns {Array} - Rows with both is_out_of_range and is_value_out_of_range fields
 */
function ensureOutOfRangeField(rows) {
  return rows.map(row => {
    // If both fields already present, preserve as-is
    if (row.is_out_of_range !== undefined && row.is_value_out_of_range !== undefined) {
      return row;
    }

    // If only is_out_of_range present, mirror to legacy field
    if (row.is_out_of_range !== undefined && row.is_value_out_of_range === undefined) {
      return { ...row, is_value_out_of_range: row.is_out_of_range };
    }

    // If only legacy field present, mirror to is_out_of_range
    if (row.is_value_out_of_range !== undefined && row.is_out_of_range === undefined) {
      return { ...row, is_out_of_range: row.is_value_out_of_range };
    }

    // Neither field present - compute from reference bounds if available
    const { reference_lower, reference_upper, y } = row;

    if ((reference_lower === undefined && reference_upper === undefined) ||
        typeof y !== 'number' || !Number.isFinite(y)) {
      return row;
    }

    let isOutOfRange = false;
    if (reference_upper !== undefined && y > reference_upper) {
      isOutOfRange = true;
    } else if (reference_lower !== undefined && y < reference_lower) {
      isOutOfRange = true;
    }

    return {
      ...row,
      is_out_of_range: isOutOfRange,
      is_value_out_of_range: isOutOfRange
    };
  });
}

export {
  parseTimestamp,
  filterValidRows,
  sortByTimestamp,
  preprocessData,
  getFocusSeries,
  getUnitInfo,
  normalizeUnit,
  deriveStatus,
  deriveDeltaPct,
  deriveDeltaDirection,
  deriveDeltaPeriod,
  downsample,
  deriveEmptyThumbnail,
  deriveFallbackThumbnail,
  validateThumbnailConfig,
  deriveThumbnail,
  normalizeRowsForFrontend,
  ensureOutOfRangeField
};
