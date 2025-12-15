# PRD v4.0: Normalized Test Date Column

**Status:** Draft
**Created:** 2025-12-14
**Author:** Claude (with user collaboration)
**Target Release:** v4.0
**Dependencies:** Self-contained (schema migration and backfill script included in this PRD)

---

## Overview

### Problem Statement

The `patient_reports` table stores lab test dates in a freeform text column (`test_date_text`) that contains various formats extracted by OCR:
- ISO format: `2021-04-14`, `2021-04-14T20:15:00`
- European format: `08/08/2023 8:06`, `27/09/2022 9:11`, `06/07/2021`
- Other variations from different labs

**Current behavior:**
1. Date parsing happens at query time using regex in SQL
2. Every query performs O(n) regex matching on all rows
3. No database index can be used for date filtering/sorting
4. Performance degrades linearly as reports table grows

**Impact:**
- At 100 reports: imperceptible (~10ms)
- At 1,000 reports: noticeable (~100ms)
- At 10,000 reports: slow (~1s)
- At 100,000 reports: unusable (~10s+)

### Goals

1. **Add indexed date column**: New `test_date` column (type `DATE`) on `patient_reports`
2. **Normalize at ingestion**: Parse and normalize date during OCR pipeline, not at query time
3. **Index for performance**: Create index on `test_date` for O(log n) retrieval
4. **Backfill existing data**: Migration script to populate `test_date` for existing reports
5. **Simplify queries**: Remove runtime regex parsing from SQL queries

### Non-Goals (Out of Scope)

- Changing the OCR prompt to output consistent ISO dates (separate improvement)
- Removing `test_date_text` column (keep for audit/debugging)
- Timezone handling (dates stored as local date, no timezone)

---

## Solution Design

### Schema Change

```sql
-- Add new column
ALTER TABLE patient_reports
ADD COLUMN test_date DATE;

-- Expression index for the COALESCE fallback pattern used in queries.
-- This allows PostgreSQL to use the index even when test_date is NULL
-- and falls back to recognized_at. Without this, COALESCE in WHERE/ORDER BY
-- would prevent index usage entirely.
--
-- IMPORTANT: We use (recognized_at AT TIME ZONE 'UTC')::date to make the
-- expression IMMUTABLE. Plain recognized_at::date is STABLE (depends on
-- session timezone) and would cause incorrect results if timezone changes.
-- All queries MUST use this exact expression for the index to be utilized.
CREATE INDEX IF NOT EXISTS idx_patient_reports_effective_date
ON patient_reports ((COALESCE(test_date, (recognized_at AT TIME ZONE 'UTC')::date)) DESC);

-- Optional: composite index for patient+date queries
CREATE INDEX IF NOT EXISTS idx_patient_reports_patient_date
ON patient_reports (patient_id, (COALESCE(test_date, (recognized_at AT TIME ZONE 'UTC')::date)) DESC);
```

**Note on transaction context**: These statements run inside `schema.js` which uses a transaction block (`BEGIN`/`COMMIT`). Therefore we do NOT use `CONCURRENTLY` (which PostgreSQL forbids inside transactions). For production migrations on large tables with write traffic, run index creation separately outside a transaction with `CONCURRENTLY`.

### Date Parsing Logic

Centralized in a new utility function `parseTestDate(text)`:

```javascript
// server/utils/dateParser.js

/**
 * Parse various date formats into a normalized Date object
 * Returns null if unable to parse
 *
 * Supported formats:
 * - ISO: YYYY-MM-DD, YYYY-MM-DDTHH:mm:ss
 * - European: DD/MM/YYYY, DD.MM.YYYY, DD-MM-YYYY (with optional time suffix)
 * - Two-digit years: DD/MM/YY (assumes 20xx for YY < 50, 19xx otherwise)
 *
 * NOT supported (by design):
 * - US format MM/DD/YYYY (ambiguous with European, and this is a Russian health app)
 *
 * ASSUMPTION: Two-digit year threshold
 * - YY < 50 → 20xx (e.g., 23 → 2023)
 * - YY >= 50 → 19xx (e.g., 95 → 1995)
 * This assumes lab records are from 1950-2049. For a health tracking app dealing
 * with contemporary lab reports, this is reasonable. Historical records from
 * before 1950 are extremely unlikely to be digitized and uploaded.
 */
export function parseTestDate(dateStr) {
  if (!dateStr) return null;

  // Trim whitespace from input
  const trimmed = dateStr.trim();

  let year, month, day;

  // Pattern 1: ISO format - YYYY-MM-DD (with optional time suffix)
  const isoMatch = trimmed.match(/^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])/);
  if (isoMatch) {
    year = parseInt(isoMatch[1], 10);
    month = parseInt(isoMatch[2], 10);
    day = parseInt(isoMatch[3], 10);
  } else {
    // Pattern 2: DD/MM/YYYY, DD.MM.YYYY, or DD-MM-YYYY (with optional time suffix)
    const euroMatch = trimmed.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
    if (euroMatch) {
      day = parseInt(euroMatch[1], 10);
      month = parseInt(euroMatch[2], 10);
      year = parseInt(euroMatch[3], 10);

      // Handle two-digit years: 00-49 → 2000-2049, 50-99 → 1950-1999
      if (year < 100) {
        year = year < 50 ? 2000 + year : 1900 + year;
      }
    }
  }

  // No pattern matched
  if (year === undefined) return null;

  // Basic bounds check
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  // Create date and validate via round-trip.
  // This catches invalid dates like Feb 31 where JS Date would silently
  // roll over to March 3. If the components don't match after construction,
  // the input was invalid.
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null; // Date rolled over (e.g., Feb 31 → Mar 3), reject as invalid
  }

  return date;
}

/**
 * Format Date object to YYYY-MM-DD string for database storage
 *
 * IMPORTANT: Uses local date components to avoid timezone shift.
 * Do NOT use toISOString() as it converts to UTC, which can shift
 * the date by one day depending on local timezone.
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
```

### Integration Points

**1. OCR Pipeline (`labReportProcessor.js`)**

After extracting `test_date` from OCR response:
```javascript
import { parseTestDate, formatDateForDb } from '../utils/dateParser.js';

// In processReport() after OCR extraction:
const testDateText = ocrResult.test_date; // Raw OCR output
const testDate = formatDateForDb(parseTestDate(testDateText)); // Normalized DATE
```

**2. Database Insert (`labResultRepository.js`)**

Add `test_date` to INSERT statement:
```javascript
INSERT INTO patient_reports (
  ...,
  test_date_text,
  test_date,  -- NEW
  ...
) VALUES (
  ...,
  $testDateText,
  $testDate,  -- NEW (can be NULL if parsing fails)
  ...
)
```

**3. Reports Browser Query (`reports.js`)**

Simplify to use indexed column:
```javascript
// BEFORE (O(n) regex on every row)
const effectiveDateExpr = `
  CASE
    WHEN pr.test_date_text ~ '^\\d{4}-(0[1-9]|1[0-2])...'
    ...
  END
`;

// AFTER (O(log n) indexed lookup)
// IMPORTANT: Expression MUST match index exactly, including AT TIME ZONE 'UTC'
const query = `
  SELECT
    pr.id AS report_id,
    COALESCE(pr.test_date, (pr.recognized_at AT TIME ZONE 'UTC')::date)::text AS effective_date,
    pr.test_date IS NULL AS date_is_fallback,  -- Flag for UI indicator
    ...
  FROM patient_reports pr
  WHERE pr.status = 'completed'
    AND ($1::date IS NULL OR COALESCE(pr.test_date, (pr.recognized_at AT TIME ZONE 'UTC')::date) >= $1)
    AND ($2::date IS NULL OR COALESCE(pr.test_date, (pr.recognized_at AT TIME ZONE 'UTC')::date) <= $2)
  ORDER BY COALESCE(pr.test_date, (pr.recognized_at AT TIME ZONE 'UTC')::date) DESC
`;
```

**4. Update `v_measurements` View (`schema.js`)**

The existing view uses runtime casting which won't benefit from the new index:
```sql
-- BEFORE (in schema.js)
COALESCE(pr.test_date_text::date, pr.recognized_at::date) AS date_eff

-- AFTER
CREATE OR REPLACE VIEW v_measurements AS
SELECT
  lr.id AS result_id,
  pr.patient_id,
  a.code AS analyte_code,
  a.name AS analyte_name,
  lr.parameter_name,
  lr.numeric_result AS value_num,
  lr.result_value AS value_text,
  lr.unit AS units,
  COALESCE(pr.test_date, (pr.recognized_at AT TIME ZONE 'UTC')::date) AS date_eff,  -- Uses new column + index
  lr.report_id,
  lr.reference_lower,
  lr.reference_upper,
  lr.reference_lower_operator,
  lr.reference_upper_operator,
  lr.is_value_out_of_range,
  lr.specimen_type
FROM lab_results lr
JOIN patient_reports pr ON pr.id = lr.report_id
LEFT JOIN analytes a ON a.analyte_id = lr.analyte_id;
```

**Fallback Behavior for Unparseable Dates:**

When `test_date` is NULL (date could not be parsed from OCR text), the query falls back to `recognized_at` (the timestamp when the report was ingested). This ensures reports are never excluded from results, but users should be aware:

- Reports with fallback dates may appear in unexpected date ranges (e.g., a test from Dec 2022 uploaded in Jan 2023 would appear in Jan 2023 range)
- The `date_is_fallback` column allows the UI to display a warning indicator (⚠️) on affected reports
- See "Future Considerations" for Phase 2 UI enhancement proposal

### Migration Script

```javascript
// scripts/backfill_test_dates.js

import { pool } from '../server/db/index.js';
import { parseTestDate, formatDateForDb } from '../server/utils/dateParser.js';

const DRY_RUN = process.argv.includes('--dry-run');
const MAX_RETRIES = 3;
const PROGRESS_INTERVAL = 100;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function updateWithRetry(id, testDate, attempt = 1) {
  try {
    await pool.query(
      'UPDATE patient_reports SET test_date = $1 WHERE id = $2',
      [testDate, id]
    );
    return true;
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      const backoff = Math.pow(2, attempt) * 100; // 200ms, 400ms, 800ms
      console.warn(`Retry ${attempt}/${MAX_RETRIES} for report ${id} after ${backoff}ms`);
      await sleep(backoff);
      return updateWithRetry(id, testDate, attempt + 1);
    }
    throw err;
  }
}

async function backfillTestDates() {
  if (DRY_RUN) {
    console.log('=== DRY RUN MODE - No changes will be made ===\n');
  }

  // Get all reports with test_date_text but no test_date
  const reports = await pool.query(`
    SELECT id, test_date_text
    FROM patient_reports
    WHERE test_date IS NULL AND test_date_text IS NOT NULL
  `);

  console.log(`Found ${reports.rows.length} reports to backfill\n`);

  let updated = 0;
  let failed = 0;
  let errors = 0;
  const unparseableFormats = []; // Track unique unparseable formats for analysis

  for (let i = 0; i < reports.rows.length; i++) {
    const report = reports.rows[i];
    const testDate = formatDateForDb(parseTestDate(report.test_date_text));

    if (testDate) {
      if (!DRY_RUN) {
        try {
          await updateWithRetry(report.id, testDate);
          updated++;
        } catch (err) {
          console.error(`Failed to update report ${report.id} after ${MAX_RETRIES} retries:`, err.message);
          errors++;
        }
      } else {
        updated++;
      }
    } else {
      failed++;
      // Log unparseable formats for analysis (deduplicated)
      if (!unparseableFormats.includes(report.test_date_text)) {
        unparseableFormats.push(report.test_date_text);
        console.warn(`Unparseable format: "${report.test_date_text}" (report ${report.id})`);
      }
    }

    // Progress logging
    if ((i + 1) % PROGRESS_INTERVAL === 0 || i === reports.rows.length - 1) {
      const pct = Math.round(((i + 1) / reports.rows.length) * 100);
      console.log(`Progress: ${i + 1}/${reports.rows.length} (${pct}%) - Updated: ${updated}, Unparseable: ${failed}, Errors: ${errors}`);
    }
  }

  console.log('\n=== Backfill Summary ===');
  console.log(`Total processed: ${reports.rows.length}`);
  console.log(`Successfully updated: ${updated}`);
  console.log(`Unparseable dates: ${failed}`);
  console.log(`Database errors: ${errors}`);
  console.log(`Unique unparseable formats: ${unparseableFormats.length}`);

  if (DRY_RUN) {
    console.log('\n=== DRY RUN COMPLETE - No changes were made ===');
  }
}

backfillTestDates()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
```

**Usage:**
```bash
# Dry run - see what would be updated without making changes
node scripts/backfill_test_dates.js --dry-run

# Actual run
node scripts/backfill_test_dates.js
```

---

## Implementation Plan

### Phase 1: Schema & Utility
1. Create `server/utils/dateParser.js` with parsing functions
2. Add schema migration in `server/db/schema.js`
3. Create backfill script `scripts/backfill_test_dates.js`

### Phase 2: Ingestion Pipeline
1. Update `labReportProcessor.js` to populate `test_date` on insert
2. Update `labResultRepository.js` INSERT statement

### Phase 3: Query Optimization
1. Update `server/routes/reports.js` to use indexed `test_date` column
2. Remove regex-based `effectiveDateExpr` SQL expression
3. Update `v_measurements` view in `schema.js` to use new column

### Phase 4: Verification
1. Run backfill script on existing data
2. Verify query performance improvement with EXPLAIN ANALYZE
3. Test Reports Browser with large dataset

---

## Testing Checklist

### Date Parser Unit Tests

| Input | Expected Output | Notes |
|-------|-----------------|-------|
| `"2021-04-14"` | `2021-04-14` | ISO format |
| `"2021-04-14T20:15:00"` | `2021-04-14` | ISO with time suffix |
| `"08/08/2023 8:06"` | `2023-08-08` | European DD/MM/YYYY with time |
| `"27/09/2022 9:11"` | `2022-09-27` | European DD/MM/YYYY with time |
| `"06.07.2021"` | `2021-07-06` | European with dots |
| `"08-08-2023"` | `2023-08-08` | European with dashes |
| `"8/8/23"` | `2023-08-08` | Two-digit year (< 50 → 20xx) |
| `"15/03/95"` | `1995-03-15` | Two-digit year (≥ 50 → 19xx) |
| `"  2021-04-14  "` | `2021-04-14` | Whitespace trimming |
| `""` | `null` | Empty string |
| `null` | `null` | Null input |
| `"invalid"` | `null` | Unparseable |
| `"32/13/2021"` | `null` | Invalid day/month |
| `"31/02/2023"` | `null` | Feb 31 doesn't exist (round-trip validation) |
| `"29/02/2023"` | `null` | Feb 29 in non-leap year |
| `"29/02/2024"` | `2024-02-29` | Feb 29 in leap year (valid) |

### Timezone Safety Test
- [ ] Date created at midnight in UTC-12 timezone formats correctly (no day shift)
- [ ] Date created at midnight in UTC+14 timezone formats correctly (no day shift)

### Integration Tests

- [ ] New reports get `test_date` populated correctly (ISO format input)
- [ ] New reports get `test_date` populated correctly (DD/MM/YYYY input)
- [ ] New reports get `test_date` populated correctly (DD-MM-YYYY input)
- [ ] Unparseable dates result in NULL `test_date` (graceful degradation)
- [ ] Backfill script dry-run mode works without making changes
- [ ] Backfill script processes existing reports correctly
- [ ] Backfill script retries failed updates
- [ ] Reports Browser displays correct dates after migration
- [ ] Date filtering works with indexed column
- [ ] Query performance improved (verify with EXPLAIN ANALYZE)
- [ ] Fallback to `recognized_at` works when `test_date` is NULL
- [ ] `date_is_fallback` flag correctly set in query results
- [ ] `v_measurements` view returns correct `date_eff` using new column

---

## Performance Expectations

| Dataset Size | Before (regex) | After (indexed) |
|-------------|----------------|-----------------|
| 100 reports | ~10ms | ~1ms |
| 1,000 reports | ~100ms | ~2ms |
| 10,000 reports | ~1s | ~5ms |
| 100,000 reports | ~10s | ~10ms |

---

## Rollback Plan

If issues arise:
1. Queries fall back to `recognized_at` when `test_date` is NULL
2. `test_date` column can be dropped without data loss
3. Original `test_date_text` preserved for re-parsing

---

## Future Considerations

1. **OCR Prompt Improvement**: Update vision prompt to request ISO date format, reducing need for multi-format parsing
2. **Timezone Support**: If needed later, migrate `test_date DATE` to `test_date TIMESTAMPTZ`
3. **Date Confidence Score**: Track parsing confidence to flag ambiguous dates (e.g., 01/02/2023 could be Jan 2 or Feb 1)
4. **Phase 2: Fallback Date UI Indicator**: Display a visual warning (⚠️) in Reports Browser for reports where `date_is_fallback = true`, with tooltip: "Date could not be parsed from report. Showing upload date instead." This helps users understand why a report may appear in an unexpected date range.
