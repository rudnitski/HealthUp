# PRD v4.0: Normalized Test Date Column

**Status:** Ready for Implementation
**Created:** 2025-12-14
**Updated:** 2026-01-09
**Author:** Claude (with user collaboration)
**Target Release:** v4.0
**Dependencies:** Self-contained (schema migration and backfill script included)

---

## Overview

### Problem Statement

The `patient_reports` table stores lab test dates in a freeform text column (`test_date_text`) that contains various formats extracted by OCR:
- ISO format: `2021-04-14`, `2021-04-14T20:15:00`
- European format (DD.MM.YYYY): `15.10.2025`, `03.03.2017`
- European format (DD/MM/YYYY): `06/07/2021`, `27/08/2021`
- With time suffix: `08/08/2023 8:06`, `27/09/2022 9:11`

**Current behavior:**
1. The `v_measurements` view casts `test_date_text::date` at query time
2. PostgreSQL's default date parsing fails on European formats (interprets as MDY)
3. Queries fail with: `date/time field value out of range: "15.10.2025"`
4. The LLM sees this error and reports "date format error in data"

**Root cause (two issues):**
1. **OCR prompt is too conservative**: Says "copy exact text if ambiguous" but `15.10.2025` is NOT ambiguous (15 can't be a month)
2. **No normalization layer**: Even when LLM makes mistakes, there's no safety net to parse/normalize dates

**Impact:**
- SQL queries fail when accessing reports with European-format dates
- Users see confusing error messages about "date format errors"
- Chat assistant cannot retrieve data for affected reports

### Goals

1. **Improve OCR prompt**: LLM must convert dates to ISO using report context
2. **Add normalized date column**: New `test_date DATE` column on `patient_reports`
3. **Normalize at ingestion**: Parse dates during OCR pipeline, not at query time
4. **Update view**: Fix `v_measurements` to use new column
5. **Backfill existing data**: Migration script to fix existing reports

### Non-Goals (Out of Scope)

- Removing `test_date_text` column (keep for audit/debugging)
- Timezone handling (dates stored as local date, no timezone)
- Supporting US date format MM/DD/YYYY (this is a Russian health app)

### Internal Usage Audit

Before implementation, an audit was performed to identify all internal code that relies on `test_date_text` or `test_date` semantics:

| Location | Usage | PRD Section |
|----------|-------|-------------|
| `server/db/schema.js:548` | `v_measurements` view: `test_date_text::date` cast | Section 4.3 |
| `server/services/reportQueries.js:17-26` | `EFFECTIVE_DATE_EXPR`: regex parsing of `test_date_text` | Section 4.4 |
| `server/routes/reports.js:64,77,83,96` | Consumes `EFFECTIVE_DATE_EXPR` in SELECT, WHERE, ORDER BY | Section 4.4 |
| `server/routes/admin.js:940,953,959,971` | Consumes `EFFECTIVE_DATE_EXPR` in SELECT, WHERE, ORDER BY | Section 4.4 |
| `server/services/reportRetrieval.js:283` | API response: `test_date: details.test_date_text` | Section 4.5 |
| `server/services/reportPersistence.js:260,282` | INSERT/UPDATE of `test_date_text` column | Section 4.2 |
| `public/js/app.js:405` | Frontend display of `payload.test_date` | **Display format changes**: normalized dates show as ISO (e.g., "2025-10-15" instead of "15.10.2025"); ambiguous dates preserve original format via fallback |

**Verification Step**: During implementation, re-run these searches to confirm no new usages have been added:
```bash
grep -r "test_date_text::date" server/
grep -r "test_date_text" server/ --include="*.js"
grep -rE "\.test_date[^_]" server/ public/ --include="*.js"
```

### Design Decisions

**Ambiguous Date Handling (day ≤ 12 AND month ≤ 12):**

Dates like `01/02/2023` are ambiguous - could be Jan 2 or Feb 1. Our approach:

1. **LLM is responsible**: The OCR prompt instructs the LLM to use report context (language, lab country) to determine the correct format and output ISO when possible. When context is insufficient to disambiguate, the LLM outputs raw text as a fallback.

2. **Parser does NOT guess**: The `dateParser.js` safety net returns `NULL` for ambiguous dates rather than assuming any format. This prevents silent data corruption.

3. **Graceful fallback**: When `test_date` is NULL, queries fall back to `recognized_at` (the OCR processing timestamp).

This design ensures we never incorrectly interpret a date - we either get it right (via LLM context) or explicitly mark it as unparseable.

---

## Solution Design

### 1. OCR Prompt Improvement

**File:** `prompts/lab_user_prompt.txt`

**Current (Rules section):**
```
- Use ISO-8601 (YYYY-MM-DD) when a date is unambiguous; otherwise copy the exact text.
- For test_date, prefer specimen collection or draw dates; if unavailable, fall back to order, validation, or print dates in that order.
```

**Updated:**
```
- Convert dates to ISO-8601 format (YYYY-MM-DD, always zero-padded: use 04 not 4). Use report context (language, lab name, country) to interpret the source format:
  - If day > 12: format is unambiguously DD/MM/YYYY or DD.MM.YYYY (e.g., 15.10.2025 -> 2025-10-15)
  - If day <= 12: use context clues (Russian text typically means European DD/MM format)
  - If ambiguous AND context is insufficient to determine the format, output the raw text as-is (do not guess)
- For test_date, prefer specimen collection or draw dates; if unavailable, fall back to order, validation, or print dates in that order.

**Note (Future Enhancement):** The current prompt relies on LLM judgment for context-based disambiguation. Future iterations could provide explicit fallback heuristics (e.g., "if report language is Russian/Cyrillic, assume DD/MM" or "if lab country detected, use that country's standard format"). For MVP, the conservative approach (raw text for ambiguous) prevents silent data corruption.
```

### 2. Schema Change

**File:** `server/db/schema.js`

#### 2.1 Update CREATE TABLE (for new environments)

Add `test_date` column after `test_date_text` in the `patient_reports` CREATE TABLE statement:

```sql
CREATE TABLE IF NOT EXISTS patient_reports (
  id UUID PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  source_filename TEXT,
  checksum TEXT NOT NULL,
  parser_version TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  recognized_at TIMESTAMPTZ NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL,
  test_date_text TEXT,
  test_date DATE,                    -- NEW: normalized date column
  patient_name_snapshot TEXT,
  patient_age_snapshot TEXT,
  patient_gender_snapshot TEXT,
  patient_date_of_birth_snapshot TEXT,
  raw_model_output TEXT,
  missing_data JSONB,
  file_path TEXT,
  file_mimetype TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (patient_id, checksum)
);
```

#### 2.2 Add ALTER TABLE (for existing environments)

Add to schema statements array (idempotent):

```sql
-- Add normalized date column (idempotent for existing environments)
ALTER TABLE patient_reports
ADD COLUMN IF NOT EXISTS test_date DATE;
```

```sql
-- Comment on the new column
COMMENT ON COLUMN patient_reports.test_date IS
  'Normalized DATE parsed from test_date_text. NULL if parsing failed or ambiguous. Use for queries; fall back to recognized_at if NULL.';
```

```sql
-- Index for date range queries
CREATE INDEX IF NOT EXISTS idx_patient_reports_test_date
ON patient_reports (test_date DESC NULLS LAST);
```

```sql
-- Composite index for patient + date queries
CREATE INDEX IF NOT EXISTS idx_patient_reports_patient_test_date
ON patient_reports (patient_id, test_date DESC NULLS LAST);
```

**Note on index creation:** These indexes are optional for MVP (small dataset). They provide performance benefits for date-range filtering on larger datasets. For the current scale (<1000 reports), queries perform well without dedicated indexes. The indexes are created inside the schema transaction (schema.js uses `BEGIN`/`COMMIT`), so `CREATE INDEX CONCURRENTLY` cannot be used. Non-concurrent index creation completes in milliseconds for small datasets with negligible lock time.

**CRITICAL - Schema Ordering:** The ALTER TABLE statement adding `test_date` column **MUST appear BEFORE** the `v_measurements` view definition in the schema statements array. The view references `pr.test_date`, so the column must exist when the view is created. Failure to order correctly will cause schema apply to fail on fresh databases.

### 3. Date Parsing Utility

**New file:** `server/utils/dateParser.js`

```javascript
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
```

### 4. Integration Points

#### 4.1 OCR Pipeline (`server/services/labReportProcessor.js`)

In the `parseVisionResponse()` function, add date normalization after extracting `test_date`.

**Add import at top of file:**
```javascript
import { normalizeTestDate } from '../utils/dateParser.js';
```

**Update return statement in `parseVisionResponse()` function:**
```javascript
// After: test_date: sanitizeDateField(rawTestDate),
// Add:   test_date_normalized: normalizeTestDate(rawTestDate),

return {
  patient_name: sanitizeTextField(parsed.patient_name, { maxLength: 160 }),
  patient_age: sanitizeAgeField(rawAge),
  patient_date_of_birth: sanitizeDateField(rawDob),
  patient_gender: sanitizeTextField(rawGender, { maxLength: 24 }),
  test_date: sanitizeDateField(rawTestDate),
  test_date_normalized: normalizeTestDate(rawTestDate), // NEW
  parameters,
  missing_data: sanitizeMissingData(parsed.missing_data),
  raw_model_output: fallbackString,
};
```

**Note on input sources:** Both `sanitizeDateField()` and `normalizeTestDate()` intentionally use `rawTestDate` (before sanitization):
- `sanitizeDateField()` trims whitespace and limits to 48 chars → stored in `test_date_text` for display/audit
- `normalizeTestDate()` parses the raw text to extract a valid date → stored in `test_date` for queries

Using raw text for normalization ensures no truncation issues (though unlikely at 48 chars). The `dateParser.js` already trims internally.

**Data Flow:**
```
parseVisionResponse() returns { ..., test_date_normalized }
         ↓
coreResult = parseVisionResponse(...)  [in processLabReport()]
         ↓
persistLabReport({ ..., coreResult })
         ↓
safeCoreResult = coreResult || {}      [in persistLabReport()]
         ↓
safeCoreResult.test_date_normalized    [used in INSERT params]
```

Note: `safeCoreResult` is a null-safe wrapper (`coreResult || {}`), not a whitelist. All fields from `parseVisionResponse()` are accessible, including the new `test_date_normalized` field.

#### 4.2 Database Persistence (`server/services/reportPersistence.js`)

Update the INSERT statement in `persistLabReport()` function to include `test_date` column.

**Current column/placeholder mapping:**
| # | Column | Placeholder | Value |
|---|--------|-------------|-------|
| 1 | id | $1 | reportId |
| 2 | patient_id | $2 | patientId |
| 3 | source_filename | $3 | filename |
| 4 | checksum | $4 | checksum |
| 5 | parser_version | $5 | parserVersion |
| 6 | recognized_at | $6 | recognizedAt |
| 7 | processed_at | $7 | processedTimestamp |
| 8 | test_date_text | $8 | safeCoreResult.test_date |
| 9 | patient_name_snapshot | $9 | patientName |
| 10 | patient_age_snapshot | $10 | safeCoreResult.patient_age |
| 11 | patient_gender_snapshot | $11 | patientGender |
| 12 | patient_date_of_birth_snapshot | $12 | patientDateOfBirth |
| 13 | raw_model_output | $13 | safeCoreResult.raw_model_output |
| 14 | missing_data | $14 | missingDataJson |
| 15 | file_path | $15 | savedFilePath |
| 16 | file_mimetype | $16 | normalizedMimetype |

**Updated column/placeholder mapping (insert `test_date` at position 9, shift rest):**
| # | Column | Placeholder | Value |
|---|--------|-------------|-------|
| 1 | id | $1 | reportId |
| 2 | patient_id | $2 | patientId |
| 3 | source_filename | $3 | filename |
| 4 | checksum | $4 | checksum |
| 5 | parser_version | $5 | parserVersion |
| 6 | recognized_at | $6 | recognizedAt |
| 7 | processed_at | $7 | processedTimestamp |
| 8 | test_date_text | $8 | safeCoreResult.test_date |
| 9 | **test_date** | **$9** | **safeCoreResult.test_date_normalized** |
| 10 | patient_name_snapshot | $10 | patientName |
| 11 | patient_age_snapshot | $11 | safeCoreResult.patient_age |
| 12 | patient_gender_snapshot | $12 | patientGender |
| 13 | patient_date_of_birth_snapshot | $13 | patientDateOfBirth |
| 14 | raw_model_output | $14 | safeCoreResult.raw_model_output |
| 15 | missing_data | $15 | missingDataJson |
| 16 | file_path | $16 | savedFilePath |
| 17 | file_mimetype | $17 | normalizedMimetype |

**Updated INSERT statement:**
```sql
INSERT INTO patient_reports (
  id,
  patient_id,
  source_filename,
  checksum,
  parser_version,
  status,
  recognized_at,
  processed_at,
  test_date_text,
  test_date,                           -- NEW column
  patient_name_snapshot,
  patient_age_snapshot,
  patient_gender_snapshot,
  patient_date_of_birth_snapshot,
  raw_model_output,
  missing_data,
  file_path,
  file_mimetype,
  created_at,
  updated_at
)
VALUES (
  $1, $2, $3, $4, $5, 'completed', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb,
  $16, $17,
  NOW(), NOW()
)
```

**Updated parameter array:**
```javascript
[
  reportId,                                    // $1
  patientId,                                   // $2
  filename ?? null,                            // $3
  checksum,                                    // $4
  parserVersion ?? null,                       // $5
  recognizedAt,                                // $6
  processedTimestamp,                          // $7
  safeCoreResult.test_date ?? null,            // $8  -> test_date_text
  safeCoreResult.test_date_normalized ?? null, // $9  -> test_date (NEW)
  patientName,                                 // $10
  safeCoreResult.patient_age ?? null,          // $11
  patientGender,                               // $12
  patientDateOfBirth,                          // $13
  safeCoreResult.raw_model_output ?? null,     // $14
  missingDataJson,                             // $15
  savedFilePath,                               // $16
  normalizedMimetype,                          // $17
]
```

**Also update ON CONFLICT clause to include test_date:**
```sql
ON CONFLICT (patient_id, checksum)
DO UPDATE SET
  parser_version = EXCLUDED.parser_version,
  status = EXCLUDED.status,
  processed_at = EXCLUDED.processed_at,
  test_date_text = EXCLUDED.test_date_text,
  test_date = EXCLUDED.test_date,              -- NEW
  patient_name_snapshot = EXCLUDED.patient_name_snapshot,
  ...
```

#### 4.3 Update `v_measurements` View (`server/db/schema.js`)

In the view definition, change `date_eff` to use the new `test_date` column:

**Current:**
```sql
COALESCE(pr.test_date_text::date, pr.recognized_at::date) AS date_eff,
```

**Updated:**
```sql
COALESCE(pr.test_date, pr.recognized_at::date) AS date_eff,
```

This change:
- Uses the pre-parsed `test_date DATE` column (no runtime parsing)
- Falls back to `recognized_at` only when `test_date` is NULL
- Eliminates the failing `::date` cast on text with European formats

#### 4.4 Update Report List Query Helper (`server/services/reportQueries.js`)

The `EFFECTIVE_DATE_EXPR` constant currently parses `test_date_text` using regex, including ambiguous DD/MM formats. Update to use the new `test_date` column.

**Current:**
```javascript
export const EFFECTIVE_DATE_EXPR = `
  CASE
    WHEN pr.test_date_text ~ '^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])'
    THEN SUBSTRING(pr.test_date_text FROM 1 FOR 10)
    WHEN pr.test_date_text ~ '^\\d{1,2}[/.]\\d{1,2}[/.]\\d{4}'
    THEN CONCAT(...)
    ELSE to_char(pr.recognized_at, 'YYYY-MM-DD')
  END
`;
```

**Updated:**
```javascript
export const EFFECTIVE_DATE_EXPR = `
  COALESCE(pr.test_date, pr.recognized_at::date)
`;
```

This change:
- Eliminates runtime regex parsing of `test_date_text`
- Uses pre-parsed `test_date` column with `recognized_at` fallback
- **Returns DATE type** (not TEXT) to preserve index usage and type semantics for filtering/sorting
- Consistent with `v_measurements` view logic

**Usage by Consumer Location:**

| Location | Usage | Change Required |
|----------|-------|-----------------|
| SELECT clause | `${EFFECTIVE_DATE_EXPR} AS effective_date` | Wrap with `to_char(..., 'YYYY-MM-DD')` for string output |
| WHERE clause | `${EFFECTIVE_DATE_EXPR} >= $1` | None - DATE works with string comparison (PostgreSQL auto-casts) |
| ORDER BY clause | `ORDER BY ${EFFECTIVE_DATE_EXPR} DESC` | None - DATE ordering works correctly |

**API Boundary Formatting (report list endpoints):**

The `node-postgres` driver returns DATE columns as JavaScript Date objects, which `JSON.stringify()` serializes to ISO strings. For explicit control, update the SELECT in report list endpoints:

```sql
-- Use explicit formatting for string output in SELECT only
to_char(${EFFECTIVE_DATE_EXPR}, 'YYYY-MM-DD') AS effective_date
```

**Use `to_char()` formatting** in SELECT clauses of all list endpoints to ensure consistent string output. WHERE and ORDER BY clauses do not require modification - PostgreSQL handles DATE-to-string comparison automatically.

**Design Note (List vs Detail Views):**
- **List endpoints** return normalized dates only (ISO format or `recognized_at` fallback). Ambiguous dates that couldn't be parsed show the recognized_at date, not the raw text. This is intentional for consistent sorting/filtering.
- **Detail endpoints** expose both `test_date` (normalized) and `test_date_text` (raw) so users can see the original OCR output for audit/debugging.

#### 4.5 Update Report Retrieval APIs (`server/services/reportRetrieval.js`)

Add `test_date` column to SELECT queries and expose normalized date in API responses.

**SELECT changes** (in `executeReportDetailQueries` and other query functions):
```sql
-- Add to SELECT list:
pr.test_date,
pr.test_date_text,
```

**Response mapping changes:**
```javascript
import { formatDateForDb } from '../utils/dateParser.js';

// Current:
test_date: details.test_date_text,

// Updated:
// Note: pg returns DATE columns as JS Date objects. Format to string for JSON response.
// Falls back to raw text to preserve display for ambiguous dates (e.g., "06/07/2021")
// IMPORTANT: Use formatDateForDb() with local date components. Do NOT use toISOString()
// as it converts to UTC, which can shift the date by one day depending on timezone.
test_date: details.test_date
  ? formatDateForDb(details.test_date)  // Date object → "YYYY-MM-DD" (local)
  : (details.test_date_text || null),
test_date_text: details.test_date_text,           // Raw OCR text (for debugging)
```

**Note on pg DATE handling:** The `node-postgres` driver returns DATE columns as JavaScript Date objects (not strings). Use `formatDateForDb()` from `dateParser.js` to format consistently. This uses local date components (`getFullYear()`, `getMonth()`, `getDate()`) to avoid timezone-related date shifts. Do NOT use `toISOString()` as it converts to UTC.

**API Contract:**
- `test_date`: ISO-8601 date string (YYYY-MM-DD) when normalized successfully, OR raw OCR text when ambiguous/unparseable. This preserves UI display for ambiguous dates while improving queryability when normalization succeeds.
- `test_date_text`: Sanitized text as extracted by OCR (whitespace normalized, max 48 chars). The full raw OCR output is preserved in `raw_model_output` for complete audit trail.

#### 4.6 Update Schema Comments (`server/db/schema.js`)

Update existing column comments to reflect new date hierarchy:

```sql
-- Update test_date_text comment:
COMMENT ON COLUMN patient_reports.test_date_text IS
  'Raw test date text extracted by OCR. Preserved for audit/debugging. Use test_date column for queries.';

-- Update recognized_at comment:
COMMENT ON COLUMN patient_reports.recognized_at IS
  'Timestamp when the lab report was processed by OCR. Used as fallback when test_date is NULL.';
```

### 5. Migration Script

**New file:** `scripts/backfill_test_dates.js`

```javascript
#!/usr/bin/env node
/**
 * Backfill script for PRD v4.0: Normalize test_date column
 *
 * Usage:
 *   node scripts/backfill_test_dates.js --dry-run  # Preview changes
 *   node scripts/backfill_test_dates.js            # Apply changes
 *
 * Note: For large-scale deployments (10K+ reports), consider using
 * cursor-based pagination instead of loading all rows into memory.
 * Current implementation is suitable for typical deployments (<5K reports).
 */

import { adminPool } from '../server/db/index.js';
import { normalizeTestDate } from '../server/utils/dateParser.js';

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 100;

async function backfillTestDates() {
  console.log(DRY_RUN ? '=== DRY RUN MODE ===' : '=== LIVE MODE ===');
  console.log('');

  // Get all reports with test_date_text but NULL test_date
  // Note: For very large datasets, use LIMIT/OFFSET or cursor-based pagination
  const { rows: reports } = await adminPool.query(`
    SELECT id, test_date_text
    FROM patient_reports
    WHERE test_date_text IS NOT NULL
      AND test_date IS NULL
    ORDER BY recognized_at DESC
  `);

  console.log(`Found ${reports.length} reports to process\n`);

  if (reports.length > 5000) {
    console.warn('WARNING: Large dataset detected. Consider cursor-based pagination for production use.\n');
  }

  let updated = 0;
  let skippedAmbiguous = 0;
  let failed = 0;
  const unparseable = [];
  const ambiguous = [];

  for (let i = 0; i < reports.length; i++) {
    const report = reports[i];
    const normalized = normalizeTestDate(report.test_date_text);

    if (normalized) {
      if (!DRY_RUN) {
        await adminPool.query(
          'UPDATE patient_reports SET test_date = $1 WHERE id = $2',
          [normalized, report.id]
        );
      }
      updated++;

      // Show first few conversions
      if (updated <= 10) {
        console.log(`  "${report.test_date_text}" -> ${normalized}`);
      }
    } else {
      // Check if it's ambiguous (matches European pattern but day <= 12)
      // Note: This duplicates dateParser.js ambiguity logic intentionally.
      // We need to distinguish "ambiguous" from "unparseable" for reporting,
      // while normalizeTestDate() returns null for both cases.
      // Must trim to match dateParser.js behavior (handles " 06/07/2021 " correctly)
      const trimmedText = report.test_date_text.trim();
      const euroMatch = trimmedText.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
      if (euroMatch) {
        const day = parseInt(euroMatch[1], 10);
        const month = parseInt(euroMatch[2], 10);
        if (day <= 12 && month <= 12) {
          skippedAmbiguous++;
          if (!ambiguous.includes(report.test_date_text)) {
            ambiguous.push(report.test_date_text);
          }
          continue;
        }
      }

      failed++;
      if (!unparseable.includes(report.test_date_text)) {
        unparseable.push(report.test_date_text);
      }
    }

    // Progress every BATCH_SIZE
    if ((i + 1) % BATCH_SIZE === 0) {
      const pct = Math.round(((i + 1) / reports.length) * 100);
      console.log(`Progress: ${i + 1}/${reports.length} (${pct}%)`);
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Total processed: ${reports.length}`);
  console.log(`Successfully normalized: ${updated}`);
  console.log(`Skipped (ambiguous): ${skippedAmbiguous}`);
  console.log(`Unparseable: ${failed}`);

  if (ambiguous.length > 0) {
    console.log(`\nAmbiguous dates skipped (${ambiguous.length}):`);
    ambiguous.slice(0, 10).forEach(fmt => console.log(`  - "${fmt}" (could be DD/MM or MM/DD)`));
    if (ambiguous.length > 10) {
      console.log(`  ... and ${ambiguous.length - 10} more`);
    }
    console.log('\nNote: Ambiguous dates will use recognized_at as fallback.');
  }

  if (unparseable.length > 0) {
    console.log(`\nUnparseable formats (${unparseable.length}):`);
    unparseable.slice(0, 20).forEach(fmt => console.log(`  - "${fmt}"`));
    if (unparseable.length > 20) {
      console.log(`  ... and ${unparseable.length - 20} more`);
    }
  }

  if (DRY_RUN) {
    console.log('\n=== DRY RUN - No changes made ===');
  }
}

backfillTestDates()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
```

---

## Implementation Plan

### Phase 1: Foundation
1. Create `server/utils/dateParser.js` with parsing functions
2. Add unit tests for dateParser
3. Update schema in `server/db/schema.js`:
   - Add `test_date DATE` column to CREATE TABLE
   - Add ALTER TABLE statement for existing environments
   - Add indexes
   - Update `v_measurements` view

### Phase 2: Ingestion Pipeline
1. Update `server/services/labReportProcessor.js`:
   - Import dateParser
   - Add `test_date_normalized` to parsed result
2. Update `server/services/reportPersistence.js`:
   - Add `test_date` column to INSERT (renumber all placeholders)
   - Update ON CONFLICT clause
3. Update OCR prompt `prompts/lab_user_prompt.txt`
4. Update `server/services/reportQueries.js`:
   - Replace `EFFECTIVE_DATE_EXPR` regex parsing with `COALESCE(test_date, recognized_at)` logic
5. Update `server/services/reportRetrieval.js`:
   - Add `test_date` to SELECT queries
   - Expose both `test_date` (normalized) and `test_date_text` (raw) in API responses
6. Update schema comments in `server/db/schema.js`:
   - Update `test_date_text` comment to note it's for audit/debugging
   - Update `recognized_at` comment to reference `test_date` fallback

### Phase 3: Data Migration (Optional for MVP)

**Note:** This phase is optional. The system gracefully handles NULL `test_date` values via `COALESCE(test_date, recognized_at::date)`. Without backfill:
- New uploads will have `test_date` populated automatically
- Existing reports will use `recognized_at` as fallback (acceptable for non-prod)

If you want normalized dates for existing reports, run the backfill:

1. Create `scripts/backfill_test_dates.js`
2. Run dry-run to verify: `node scripts/backfill_test_dates.js --dry-run`
3. Run actual backfill: `node scripts/backfill_test_dates.js`
4. Verify with: `SELECT COUNT(*) FROM patient_reports WHERE test_date IS NULL AND test_date_text IS NOT NULL`

### Phase 4: Verification
1. Test new report uploads with various date formats
2. Verify v_measurements returns correct dates
3. Test chat queries that previously failed
4. Run: `npm test`

---

## Testing Checklist

### Date Parser Unit Tests

| Input | Expected Output | Notes |
|-------|-----------------|-------|
| `"2021-04-14"` | `2021-04-14` | ISO format (zero-padded) |
| `"2021-04-14T20:15:00"` | `2021-04-14` | ISO with time |
| `"2021-4-14"` | `null` | Non-padded ISO - intentionally unsupported |
| `"15.10.2025"` | `2025-10-15` | European DD.MM.YYYY (unambiguous: day > 12) |
| `"27/08/2021"` | `2021-08-27` | European DD/MM/YYYY (unambiguous: day > 12) |
| `"03.03.2017"` | `null` | Ambiguous (day=3, month=3, both <= 12) |
| `"06/07/2021"` | `null` | Ambiguous (day=6, month=7, both <= 12) |
| `"08/08/2023 8:06"` | `null` | Ambiguous with time suffix |
| `"15/03/95"` | `1995-03-15` | Two-digit year (>= 50), unambiguous |
| `"15/03/23"` | `2023-03-15` | Two-digit year (< 50), unambiguous |
| `"05/03/23"` | `null` | Ambiguous two-digit year |
| `"  2021-04-14  "` | `2021-04-14` | Whitespace trimming |
| `""` | `null` | Empty string |
| `null` | `null` | Null input |
| `"invalid"` | `null` | Unparseable |
| `"32/13/2021"` | `null` | Invalid day/month |
| `"31/02/2023"` | `null` | Feb 31 doesn't exist |
| `"29/02/2024"` | `2024-02-29` | Unambiguous (day=29 > 12), valid leap year |
| `"29/02/2023"` | `null` | Unambiguous (day=29 > 12), but Feb 29 invalid in non-leap year |
| `"13/02/2024"` | `2024-02-13` | Unambiguous (day=13 > 12) |

### Integration Tests

- [ ] Re-run usage audit commands (see "Internal Usage Audit" section) to verify no new usages added
- [ ] New reports with ISO dates get `test_date` populated
- [ ] New reports with unambiguous DD.MM.YYYY dates (day > 12) get `test_date` populated
- [ ] Ambiguous dates result in `test_date = NULL` (graceful degradation)
- [ ] `v_measurements.date_eff` returns correct dates after migration
- [ ] `v_measurements.date_eff` falls back to `recognized_at` for NULL `test_date`
- [ ] Chat queries work for reports that previously failed
- [ ] Backfill script dry-run shows correct conversions
- [ ] Backfill script correctly identifies ambiguous dates
- [ ] Backfill script updates existing records correctly

---

## Rollback Plan

If issues arise:
1. Queries automatically fall back to `recognized_at` when `test_date` is NULL
2. `test_date` column can be set to NULL without data loss
3. Original `test_date_text` preserved for re-parsing
4. View can be reverted to use `test_date_text::date` (but will fail on European formats)

---

## Future Considerations

1. **Admin UI for Ambiguous Dates**: Allow manual date selection for ambiguous formats (show both DD/MM and MM/DD interpretations)
2. **Extended Format Support**: Add support for written dates like "15 октября 2025"
3. **Cursor-based Backfill**: For deployments with 10K+ reports, implement cursor-based pagination in the backfill script to reduce memory usage
