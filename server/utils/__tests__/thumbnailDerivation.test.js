// server/utils/__tests__/thumbnailDerivation.test.js
// Unit tests for Thumbnail Derivation Module (PRD v4.2.2)

import {
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
} from '../thumbnailDerivation.js';

describe('thumbnailDerivation', () => {
  describe('parseTimestamp', () => {
    it('should parse ISO 8601 with timezone', () => {
      const result = parseTimestamp('2024-01-15T10:30:00Z');
      expect(result).toBe(Date.parse('2024-01-15T10:30:00Z'));
    });

    it('should parse ISO 8601 without timezone (assumes UTC)', () => {
      const result = parseTimestamp('2024-01-15T10:30:00');
      expect(result).toBe(Date.parse('2024-01-15T10:30:00Z'));
    });

    it('should parse epoch milliseconds (>= 10^12)', () => {
      const epochMs = 1705319400000; // 2024-01-15T10:30:00Z
      expect(parseTimestamp(epochMs)).toBe(epochMs);
    });

    it('should parse epoch seconds (< 10^12) and multiply by 1000', () => {
      const epochSec = 1705319400;
      expect(parseTimestamp(epochSec)).toBe(1705319400000);
    });

    it('should parse numeric string (epoch ms)', () => {
      const result = parseTimestamp('1705319400000');
      expect(result).toBe(1705319400000);
    });

    it('should parse numeric string (epoch seconds) and multiply by 1000', () => {
      const result = parseTimestamp('1705319400');
      expect(result).toBe(1705319400000);
    });

    it('should return null for invalid string', () => {
      expect(parseTimestamp('not a date')).toBeNull();
    });

    it('should return null for undefined/null', () => {
      expect(parseTimestamp(undefined)).toBeNull();
      expect(parseTimestamp(null)).toBeNull();
    });
  });

  describe('filterValidRows', () => {
    const validRow = {
      t: 1705319400000,
      y: 42.5,
      parameter_name: 'Vitamin D',
      unit: 'ng/mL'
    };

    it('should pass through valid rows', () => {
      const result = filterValidRows([validRow]);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(validRow);
    });

    it('should filter out rows with NaN y values', () => {
      const result = filterValidRows([
        validRow,
        { ...validRow, y: NaN }
      ]);
      expect(result).toHaveLength(1);
    });

    it('should filter out rows with Infinity y values', () => {
      const result = filterValidRows([
        validRow,
        { ...validRow, y: Infinity },
        { ...validRow, y: -Infinity }
      ]);
      expect(result).toHaveLength(1);
    });

    it('should filter out rows with null y values', () => {
      const result = filterValidRows([
        validRow,
        { ...validRow, y: null }
      ]);
      expect(result).toHaveLength(1);
    });

    it('should filter out rows with unparseable timestamps', () => {
      const result = filterValidRows([
        validRow,
        { ...validRow, t: 'invalid date' }
      ]);
      expect(result).toHaveLength(1);
    });

    it('should filter out rows with missing parameter_name', () => {
      const result = filterValidRows([
        validRow,
        { ...validRow, parameter_name: '' },
        { ...validRow, parameter_name: null }
      ]);
      expect(result).toHaveLength(1);
    });

    it('should allow empty string unit', () => {
      const result = filterValidRows([
        { ...validRow, unit: '' }
      ]);
      expect(result).toHaveLength(1);
    });
  });

  describe('sortByTimestamp', () => {
    it('should sort rows by timestamp ascending', () => {
      const rows = [
        { t: 1705319400000, y: 30 },
        { t: 1705000000000, y: 20 },
        { t: 1706000000000, y: 40 }
      ];
      const sorted = sortByTimestamp(rows);
      expect(sorted[0].y).toBe(20);
      expect(sorted[1].y).toBe(30);
      expect(sorted[2].y).toBe(40);
    });

    it('should not modify original array', () => {
      const rows = [
        { t: 1705319400000, y: 30 },
        { t: 1705000000000, y: 20 }
      ];
      sortByTimestamp(rows);
      expect(rows[0].y).toBe(30); // Original unchanged
    });
  });

  describe('preprocessData', () => {
    it('should filter invalid rows and sort by timestamp', () => {
      const rows = [
        { t: 1706000000000, y: 40, parameter_name: 'A', unit: 'x' },
        { t: 1705000000000, y: NaN, parameter_name: 'A', unit: 'x' },
        { t: 1705319400000, y: 30, parameter_name: 'A', unit: 'x' }
      ];
      const result = preprocessData(rows);
      expect(result).toHaveLength(2);
      expect(result[0].y).toBe(30);
      expect(result[1].y).toBe(40);
    });
  });

  describe('getFocusSeries', () => {
    const rows = [
      { parameter_name: 'B', y: 20 },
      { parameter_name: 'A', y: 10 },
      { parameter_name: 'A', y: 15 },
      { parameter_name: 'B', y: 25 }
    ];

    it('should use provided focus analyte name', () => {
      const result = getFocusSeries(rows, 'B');
      expect(result.name).toBe('B');
      expect(result.rows).toHaveLength(2);
    });

    it('should default to first alphabetically', () => {
      const result = getFocusSeries(rows, null);
      expect(result.name).toBe('A');
      expect(result.rows).toHaveLength(2);
    });

    it('should default to first alphabetically if focus name not found', () => {
      const result = getFocusSeries(rows, 'Z');
      expect(result.name).toBe('A');
    });

    it('should return null name for empty data', () => {
      const result = getFocusSeries([], null);
      expect(result.name).toBeNull();
      expect(result.rows).toHaveLength(0);
    });
  });

  describe('normalizeUnit', () => {
    it('should normalize to lowercase trimmed', () => {
      expect(normalizeUnit(' Mg/dL ')).toBe('mg/dl');
    });

    it('should handle null/undefined/empty', () => {
      expect(normalizeUnit(null)).toBe('');
      expect(normalizeUnit(undefined)).toBe('');
      expect(normalizeUnit('')).toBe('');
    });
  });

  describe('getUnitInfo', () => {
    it('should detect single unit', () => {
      const rows = [
        { unit: 'mg/dL' },
        { unit: 'mg/dL' }
      ];
      const result = getUnitInfo(rows);
      expect(result.isMixed).toBe(false);
      expect(result.unit_raw).toBe('mg/dL');
    });

    it('should detect mixed units (case-insensitive)', () => {
      const rows = [
        { unit: 'mg/dL' },
        { unit: 'mmol/L' }
      ];
      const result = getUnitInfo(rows);
      expect(result.isMixed).toBe(true);
    });

    it('should treat case variations as same unit', () => {
      const rows = [
        { unit: 'mg/dL' },
        { unit: 'MG/DL' }
      ];
      const result = getUnitInfo(rows);
      expect(result.isMixed).toBe(false);
    });

    it('should treat null/empty as equivalent', () => {
      const rows = [
        { unit: null },
        { unit: '' }
      ];
      const result = getUnitInfo(rows);
      expect(result.isMixed).toBe(false);
    });
  });

  describe('deriveStatus', () => {
    const makeRows = (latestLower, latestUpper) => [{
      reference_lower: latestLower,
      reference_upper: latestUpper
    }];

    it('should return unknown for mixed units (override)', () => {
      const result = deriveStatus('normal', 50, makeRows(30, 70), true);
      expect(result).toBe('unknown');
    });

    it('should trust LLM when confident', () => {
      expect(deriveStatus('high', 50, makeRows(30, 70), false)).toBe('high');
      expect(deriveStatus('low', 50, makeRows(30, 70), false)).toBe('low');
      expect(deriveStatus('normal', 50, makeRows(30, 70), false)).toBe('normal');
    });

    it('should compute from bounds when LLM says unknown', () => {
      expect(deriveStatus('unknown', 80, makeRows(30, 70), false)).toBe('high');
      expect(deriveStatus('unknown', 20, makeRows(30, 70), false)).toBe('low');
      expect(deriveStatus('unknown', 50, makeRows(30, 70), false)).toBe('normal');
    });

    it('should return unknown if no bounds available', () => {
      expect(deriveStatus('unknown', 50, [{}], false)).toBe('unknown');
    });
  });

  describe('deriveDeltaPct', () => {
    it('should calculate percentage change', () => {
      const rows = [
        { y: 100 },
        { y: 120 }
      ];
      expect(deriveDeltaPct(rows, false)).toBe(20);
    });

    it('should handle negative change', () => {
      const rows = [
        { y: 100 },
        { y: 80 }
      ];
      expect(deriveDeltaPct(rows, false)).toBe(-20);
    });

    it('should return null for mixed units', () => {
      expect(deriveDeltaPct([{ y: 100 }, { y: 120 }], true)).toBeNull();
    });

    it('should return null for single point', () => {
      expect(deriveDeltaPct([{ y: 100 }], false)).toBeNull();
    });

    it('should return null if first value is zero', () => {
      expect(deriveDeltaPct([{ y: 0 }, { y: 50 }], false)).toBeNull();
    });
  });

  describe('deriveDeltaDirection', () => {
    it('should return up for > 1%', () => {
      expect(deriveDeltaDirection(5)).toBe('up');
      expect(deriveDeltaDirection(2)).toBe('up');
    });

    it('should return down for < -1%', () => {
      expect(deriveDeltaDirection(-5)).toBe('down');
      expect(deriveDeltaDirection(-2)).toBe('down');
    });

    it('should return stable for -1% to 1%', () => {
      expect(deriveDeltaDirection(0)).toBe('stable');
      expect(deriveDeltaDirection(1)).toBe('stable');
      expect(deriveDeltaDirection(-1)).toBe('stable');
    });

    it('should return null for null input', () => {
      expect(deriveDeltaDirection(null)).toBeNull();
    });
  });

  describe('deriveDeltaPeriod', () => {
    const makeRows = (daysDiff) => {
      const firstT = 1705319400000;
      const lastT = firstT + daysDiff * 24 * 60 * 60 * 1000;
      return [
        { t: firstT },
        { t: lastT }
      ];
    };

    it('should return years for >= 365 days', () => {
      expect(deriveDeltaPeriod(makeRows(730), false)).toBe('2y');
      expect(deriveDeltaPeriod(makeRows(365), false)).toBe('1y');
    });

    it('should return months for >= 30 days', () => {
      expect(deriveDeltaPeriod(makeRows(90), false)).toBe('3m');
      expect(deriveDeltaPeriod(makeRows(30), false)).toBe('1m');
    });

    it('should return weeks for >= 7 days', () => {
      expect(deriveDeltaPeriod(makeRows(14), false)).toBe('2w');
      expect(deriveDeltaPeriod(makeRows(7), false)).toBe('1w');
    });

    it('should return days for < 7 days', () => {
      expect(deriveDeltaPeriod(makeRows(5), false)).toBe('5d');
    });

    it('should return null for mixed units', () => {
      expect(deriveDeltaPeriod(makeRows(30), true)).toBeNull();
    });

    it('should return null for single point', () => {
      expect(deriveDeltaPeriod([{ t: 1705319400000 }], false)).toBeNull();
    });
  });

  describe('downsample', () => {
    it('should return [0] for empty array', () => {
      expect(downsample([])).toEqual([0]);
    });

    it('should return unchanged for <= maxPoints', () => {
      const values = [1, 2, 3];
      expect(downsample(values, 30)).toEqual([1, 2, 3]);
    });

    it('should downsample to maxPoints', () => {
      const values = Array.from({ length: 100 }, (_, i) => i);
      const result = downsample(values, 30);
      expect(result).toHaveLength(30);
    });

    it('should preserve first and last values', () => {
      const values = Array.from({ length: 100 }, (_, i) => i);
      const result = downsample(values, 30);
      expect(result[0]).toBe(0);
      expect(result[result.length - 1]).toBe(99);
    });
  });

  describe('validateThumbnailConfig', () => {
    it('should pass valid config', () => {
      const result = validateThumbnailConfig({
        status: 'normal',
        focus_analyte_name: 'Vitamin D'
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should pass config with missing optional status', () => {
      const result = validateThumbnailConfig({
        focus_analyte_name: 'Vitamin D'
      });
      expect(result.valid).toBe(true);
    });

    it('should fail on invalid status enum', () => {
      const result = validateThumbnailConfig({
        status: 'invalid'
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('status must be one of');
    });

    it('should fail on non-string focus_analyte_name', () => {
      const result = validateThumbnailConfig({
        focus_analyte_name: 123
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('deriveEmptyThumbnail', () => {
    it('should return valid empty thumbnail structure', () => {
      const result = deriveEmptyThumbnail('Test Plot');
      expect(result.plot_title).toBe('Test Plot');
      expect(result.point_count).toBe(0);
      expect(result.series_count).toBe(0);
      expect(result.latest_value).toBeNull();
      expect(result.status).toBe('unknown');
      expect(result.sparkline.series).toEqual([0]);
    });
  });

  describe('deriveFallbackThumbnail', () => {
    it('should derive thumbnail with unknown status', () => {
      const data = [
        { t: 1705319400000, y: 42, parameter_name: 'A', unit: 'x' }
      ];
      const result = deriveFallbackThumbnail('Test', data);
      expect(result.status).toBe('unknown');
      expect(result.point_count).toBe(1);
      expect(result.latest_value).toBe(42);
    });
  });

  describe('deriveThumbnail', () => {
    const validRows = [
      { t: 1705000000000, y: 30, parameter_name: 'Vitamin D', unit: 'ng/mL', reference_lower: 30, reference_upper: 100 },
      { t: 1706000000000, y: 45, parameter_name: 'Vitamin D', unit: 'ng/mL', reference_lower: 30, reference_upper: 100 }
    ];

    it('should return null if no config provided', () => {
      const result = deriveThumbnail({
        plot_title: 'Test',
        thumbnail: null,
        rows: validRows
      });
      expect(result).toBeNull();
    });

    it('should return empty thumbnail for empty data', () => {
      const result = deriveThumbnail({
        plot_title: 'Test',
        thumbnail: { status: 'normal' },
        rows: []
      });
      expect(result.thumbnail.point_count).toBe(0);
      expect(result.thumbnail.sparkline.series).toEqual([0]);
    });

    it('should derive complete thumbnail', () => {
      const result = deriveThumbnail({
        plot_title: 'Vitamin D Trend',
        thumbnail: { status: 'normal', focus_analyte_name: 'Vitamin D' },
        rows: validRows
      });

      expect(result.thumbnail.plot_title).toBe('Vitamin D Trend');
      expect(result.thumbnail.focus_analyte_name).toBe('Vitamin D');
      expect(result.thumbnail.point_count).toBe(2);
      expect(result.thumbnail.series_count).toBe(1);
      expect(result.thumbnail.latest_value).toBe(45);
      expect(result.thumbnail.status).toBe('normal');
      expect(result.thumbnail.delta_pct).toBe(50); // (45-30)/30 * 100
      expect(result.thumbnail.delta_direction).toBe('up');
      expect(result.thumbnail.sparkline.series).toEqual([30, 45]);
      expect(result.resultId).toBeDefined();
    });

    it('should return fallback thumbnail on invalid config', () => {
      const result = deriveThumbnail({
        plot_title: 'Test',
        thumbnail: { status: 'invalid_status' },
        rows: validRows
      });
      expect(result.thumbnail.status).toBe('unknown');
    });

    it('should override status for mixed units', () => {
      const mixedRows = [
        { t: 1705000000000, y: 30, parameter_name: 'A', unit: 'mg/dL' },
        { t: 1706000000000, y: 45, parameter_name: 'A', unit: 'mmol/L' }
      ];
      const result = deriveThumbnail({
        plot_title: 'Test',
        thumbnail: { status: 'normal' },
        rows: mixedRows
      });
      expect(result.thumbnail.status).toBe('unknown');
      expect(result.thumbnail.delta_pct).toBeNull();
    });
  });

  describe('normalizeRowsForFrontend', () => {
    it('should convert timestamps to epoch ms', () => {
      const rows = [
        { t: '2024-01-15T10:30:00Z', y: 42 },
        { t: 1705319400, y: 43 } // epoch seconds
      ];
      const result = normalizeRowsForFrontend(rows);
      expect(typeof result[0].t).toBe('number');
      expect(typeof result[1].t).toBe('number');
      expect(result[1].t).toBe(1705319400000);
    });

    it('should preserve other fields', () => {
      const rows = [
        { t: 1705319400000, y: 42, parameter_name: 'A', unit: 'x', extra: 'field' }
      ];
      const result = normalizeRowsForFrontend(rows);
      expect(result[0].extra).toBe('field');
    });
  });

  describe('ensureOutOfRangeField', () => {
    it('should preserve both fields when both present', () => {
      const rows = [{ y: 50, is_out_of_range: true, is_value_out_of_range: true }];
      const result = ensureOutOfRangeField(rows);
      expect(result[0].is_out_of_range).toBe(true);
      expect(result[0].is_value_out_of_range).toBe(true);
    });

    it('should mirror is_out_of_range to legacy field when only is_out_of_range present', () => {
      const rows = [{ y: 50, is_out_of_range: true }];
      const result = ensureOutOfRangeField(rows);
      expect(result[0].is_out_of_range).toBe(true);
      expect(result[0].is_value_out_of_range).toBe(true);
    });

    it('should mirror legacy field to is_out_of_range when only is_value_out_of_range present', () => {
      const rows = [{ y: 50, is_value_out_of_range: true }];
      const result = ensureOutOfRangeField(rows);
      expect(result[0].is_out_of_range).toBe(true);
      expect(result[0].is_value_out_of_range).toBe(true);
    });

    it('should mirror false values correctly from legacy field', () => {
      const rows = [{ y: 50, is_value_out_of_range: false }];
      const result = ensureOutOfRangeField(rows);
      expect(result[0].is_out_of_range).toBe(false);
      expect(result[0].is_value_out_of_range).toBe(false);
    });

    it('should compute is_out_of_range when above upper bound', () => {
      const rows = [{ y: 100, reference_upper: 70 }];
      const result = ensureOutOfRangeField(rows);
      expect(result[0].is_out_of_range).toBe(true);
      expect(result[0].is_value_out_of_range).toBe(true);
    });

    it('should compute is_out_of_range when below lower bound', () => {
      const rows = [{ y: 20, reference_lower: 30 }];
      const result = ensureOutOfRangeField(rows);
      expect(result[0].is_out_of_range).toBe(true);
      expect(result[0].is_value_out_of_range).toBe(true);
    });

    it('should set is_out_of_range false when in range', () => {
      const rows = [{ y: 50, reference_lower: 30, reference_upper: 70 }];
      const result = ensureOutOfRangeField(rows);
      expect(result[0].is_out_of_range).toBe(false);
      expect(result[0].is_value_out_of_range).toBe(false);
    });

    it('should not add field when no bounds available', () => {
      const rows = [{ y: 50 }];
      const result = ensureOutOfRangeField(rows);
      expect(result[0].is_out_of_range).toBeUndefined();
      expect(result[0].is_value_out_of_range).toBeUndefined();
    });
  });
});
