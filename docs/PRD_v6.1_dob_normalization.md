# PRD v6.1: Patient Date of Birth Normalization

## Problem Statement

Patient `date_of_birth` is stored as a `text` field without normalization. Different lab reports use different date formats (e.g., `07/12/1985` vs `1987-08-04`), leading to:

1. **Inconsistent data**: Same patient can have DOB in different formats across records
2. **Query difficulties**: Cannot use date comparisons, sorting, or age calculations
3. **Pattern inconsistency**: Lab test dates already use dual-column pattern (`test_date_text` + `test_date`), but patient DOB does not

## Current State

**Patient DOB (problematic):**
```sql
date_of_birth  | text  -- raw OCR output, inconsistent formats
```

**Lab test dates (working pattern):**
```sql
test_date_text | text  -- raw OCR output
test_date      | date  -- normalized, nullable for ambiguous dates
```

## Solution

Apply the same dual-column pattern to patient DOB, reusing existing date parsing infrastructure.

### Schema Changes

**Boot-time migration** (add to `server/db/schema.js` schemaStatements array):

**Critical ordering and placement**:
1. Place these statements immediately AFTER the `CREATE TABLE IF NOT EXISTS patients` statement and its table comment
2. The `ALTER TABLE` statement MUST come BEFORE the `CREATE INDEX` statement
3. If index creation runs before the column exists, boot will fail on existing databases

```sql
-- Statement 1: Add new column (MUST come first)
ALTER TABLE patients ADD COLUMN IF NOT EXISTS date_of_birth_normalized DATE;

-- Statement 2: Create index (MUST come after column exists)
CREATE INDEX IF NOT EXISTS idx_patients_dob_normalized ON patients(date_of_birth_normalized);

-- Statement 3: Add column comment documenting NULL semantics
COMMENT ON COLUMN patients.date_of_birth_normalized IS
  'Normalized DATE from OCR. NULL indicates: (1) ambiguous date where day <= 12 AND month <= 12, (2) unparseable/invalid format, or (3) labeled text like "DOB: ..." that the parser could not extract.';
```

Also update the `CREATE TABLE IF NOT EXISTS patients` statement to include the new column for fresh database creation:

```sql
CREATE TABLE IF NOT EXISTS patients (
  ...
  date_of_birth TEXT,
  date_of_birth_normalized DATE,  -- NEW: Parsed date for queries
  ...
);
```

**Column semantics:**
- `date_of_birth` (existing): Raw text from OCR, preserved as-is
- `date_of_birth_normalized` (new): Parsed `DATE` type, `NULL` for ambiguous/unparseable dates

**Note**: The `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` ensures existing deployed databases receive the new column on boot, while `CREATE TABLE IF NOT EXISTS` handles fresh installations.

### Reuse Existing Code

The date parsing logic already exists in `server/utils/dateParser.js`. Currently exports `parseTestDate` and `normalizeTestDate`, but these are generic and work for any date string.

**Expected input format**: The parser expects clean date strings (e.g., `1987-08-04`, `15/03/1987`), NOT labeled text like `"DOB: 07/12/1985"` or `"Дата рождения 07.12.1985"`. This is the expected format because:
- DOB comes from OCR structured JSON output (`patient_date_of_birth` field)
- The OCR prompt instructs the LLM to extract and format dates, not return raw label text
- Current production data confirms clean date strings (e.g., `1987-08-04`, `07/12/1985`)

If labeled text is encountered, the parser will return `null` (regex anchors require date at string start). **QA expectation**: In such cases, the raw text is preserved in `date_of_birth` for display, but `date_of_birth_normalized` will be `NULL` and age calculations will show "Unknown". This is acceptable for MVP as the OCR pipeline already produces clean dates.

**Ambiguity handling** (already implemented):
- Dates where day > 12 (e.g., `15/03/1987`): Auto-normalized to `1987-03-15`
- Dates where day ≤ 12 AND month ≤ 12 (e.g., `01/02/1987`): Returns `null` (ambiguous)
- ISO format (e.g., `1987-08-04`): Passed through as-is

### Implementation Changes

#### 1. Rename Functions in `server/utils/dateParser.js`

Rename functions to reflect their generic purpose, with backward compatibility aliases:

```javascript
// Before (current):
export function parseTestDate(dateStr) { ... }
export function normalizeTestDate(dateStr) { ... }

// After:
export function parseDate(dateStr) { ... }
export function normalizeDate(dateStr) {
  return formatDateForDb(parseDate(dateStr));
}

// Backward compatibility aliases
export const parseTestDate = parseDate;
export const normalizeTestDate = normalizeDate;
```

Also update the file header comment:
```javascript
// Before:
/**
 * Date parsing utility for lab report date normalization
 * ...
 */

// After:
/**
 * Date parsing utility for normalizing dates from OCR (test dates, DOB, etc.)
 * ...
 */
```

#### 2. Schema Update (`server/db/schema.js`)

Add `date_of_birth_normalized DATE` column to patients table definition.

#### 3. Patient Creation/Update (`server/services/reportPersistence.js`)

When creating or updating a patient, normalize the DOB.

**Required import** (add to top of reportPersistence.js):
```javascript
import { normalizeDate } from '../utils/dateParser.js';
```

**Implementation in upsertPatient function**:
```javascript
// In findOrCreatePatient or equivalent:
const dobNormalized = normalizeDate(patientDateOfBirth);

// INSERT with both columns
INSERT INTO patients (full_name, date_of_birth, date_of_birth_normalized, ...)
VALUES ($1, $2, $3, ...)
```

**Upsert semantics** (critical for data consistency):

```sql
ON CONFLICT (user_id, full_name_normalized) DO UPDATE SET
  date_of_birth = COALESCE(EXCLUDED.date_of_birth, patients.date_of_birth),
  -- Always recalculate normalized when raw DOB changes
  date_of_birth_normalized = CASE
    WHEN EXCLUDED.date_of_birth IS NOT NULL
    THEN EXCLUDED.date_of_birth_normalized  -- Use new normalized value (may be NULL for ambiguous)
    ELSE patients.date_of_birth_normalized  -- Preserve existing if no new DOB provided
  END,
  ...
```

**Key rule**: When `date_of_birth` (raw) is updated, always recalculate `date_of_birth_normalized` from the new raw value. Do NOT preserve a stale normalized value from a previous DOB. If the new DOB is ambiguous, `date_of_birth_normalized` should become `NULL`.

**fallbackPatientId behavior** (PRD v6.0 edge case): When OCR fails to extract patient name and a `fallbackPatientId` is provided, the current code path in `reportPersistence.js` only updates `last_seen_report_at` and does NOT update DOB or other demographics. This is intentional: if OCR failed to extract the patient name, other extracted fields (including DOB) may also be unreliable. DOB normalization follows this existing behavior - no DOB updates occur when using fallback patient.

#### 4. Backfill Script (`scripts/backfill_dob_normalization.js`)

One-time migration for existing patients.

**MVP approach**: Use Option A (per-row updates) for datasets under 1,000 patients. Current production has ~4 patients, so Option A is appropriate. Use Option B for future deployments with larger datasets.

**Option A: Per-row updates** (required for MVP):

```javascript
#!/usr/bin/env node
/**
 * Backfill script for PRD v6.1: Normalize patient date_of_birth
 *
 * Usage:
 *   node scripts/backfill_dob_normalization.js --dry-run  # Preview changes
 *   node scripts/backfill_dob_normalization.js            # Apply changes
 */

// Load environment variables before other imports (required for DB connection)
import '../server/config/loadEnv.js';

import { normalizeDate } from '../server/utils/dateParser.js';
import { adminPool } from '../server/db/index.js';

const DRY_RUN = process.argv.includes('--dry-run');

async function backfillDobNormalization() {
  console.log(DRY_RUN ? '=== DRY RUN MODE ===' : '=== LIVE MODE ===');
  console.log('');

  const { rows } = await adminPool.query(
    'SELECT id, date_of_birth FROM patients WHERE date_of_birth IS NOT NULL AND date_of_birth_normalized IS NULL'
  );

  console.log(`Found ${rows.length} patients to process\n`);

  let normalized = 0;
  let skipped = 0;

  for (const row of rows) {
    const result = normalizeDate(row.date_of_birth);

    if (DRY_RUN) {
      console.log(`[DRY RUN] ${row.id}: "${row.date_of_birth}" -> ${result || 'NULL (ambiguous/unparseable)'}`);
    } else {
      await adminPool.query(
        'UPDATE patients SET date_of_birth_normalized = $1 WHERE id = $2',
        [result, row.id]
      );
    }

    if (result) {
      normalized++;
    } else {
      skipped++;
    }
  }

  console.log(`\nSummary: ${normalized} normalized, ${skipped} skipped (ambiguous/unparseable)`);
}

// Main execution wrapper (required to prevent script from hanging)
async function main() {
  try {
    await backfillDobNormalization();
    console.log('\nBackfill complete');
  } catch (error) {
    console.error('Backfill failed:', error);
    process.exitCode = 1;
  } finally {
    await adminPool.end();
  }
}

main();
```

**Option B: Batched updates** (recommended for larger datasets to avoid timeouts/lock contention):

```javascript
#!/usr/bin/env node
// Load environment variables before other imports (required for DB connection)
import '../server/config/loadEnv.js';

import { normalizeDate } from '../server/utils/dateParser.js';
import { adminPool } from '../server/db/index.js';

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 100;

async function backfillDobNormalizationBatched() {
  const { rows } = await adminPool.query(
    'SELECT id, date_of_birth FROM patients WHERE date_of_birth IS NOT NULL AND date_of_birth_normalized IS NULL'
  );

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const updates = batch.map(row => ({
      id: row.id,
      normalized: normalizeDate(row.date_of_birth)
    }));

    // Batch update using unnest
    await adminPool.query(`
      UPDATE patients p
      SET date_of_birth_normalized = u.normalized::date
      FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::text[]) AS normalized) u
      WHERE p.id = u.id
    `, [
      updates.map(u => u.id),
      updates.map(u => u.normalized)
    ]);

    console.log(`Processed ${Math.min(i + BATCH_SIZE, rows.length)} / ${rows.length}`);
  }
}
```

**Note**: For production deployments with large patient tables, run backfill during off-peak hours. Option B should also include the main() wrapper pattern shown in Option A.

**Idempotency**: Both options include `AND date_of_birth_normalized IS NULL` in the WHERE clause, so the script can be safely rerun without reprocessing already-normalized rows.

#### 5. Schema Aliases Update (`config/schema_aliases.json`)

Verify existing aliases and add the "birth" alias (required for MVP):

```json
{
  "date of birth": ["patients"],  // Already exists
  "dob": ["patients"],            // Already exists
  "age": ["patients"],            // Already exists
  "birth": ["patients"]           // ADD THIS - required for MVP
}
```

**Required action**: Add `"birth": ["patients"]` to `config/schema_aliases.json` if not already present. This ensures LLM queries using "birth" keyword discover the patients table.

**Note**: These aliases map keywords to the `patients` table, not specific columns. The LLM guidance in the system prompt (see below) handles column selection.

**LLM guidance for SQL generation** (required): The schema aliases map keywords to tables, not specific columns. To guide the LLM to prefer `date_of_birth_normalized` for date arithmetic, update `prompts/agentic_sql_generator_system_prompt.txt`.

**Insertion location**: Add at the end of section "11. PATIENT SCOPING (SECURITY)" (around line 674, after the example), before section 12:

```
## Patient Date of Birth Handling
When querying patient age or date of birth:
- Use `patients.date_of_birth_normalized` (DATE type) for age calculations, date comparisons, and sorting
- Use `patients.date_of_birth` (TEXT) only for display purposes
- Note: `date_of_birth_normalized` may be NULL for ambiguous dates (both day and month ≤ 12)
```

This prompt update is mandatory to ensure consistent SQL generation behavior.

#### 6. Age Calculation Update (`server/services/agenticCore.js`)

The current age calculation uses brittle regex-based parsing of the text `date_of_birth` column.

**Required changes to the patient context query** (around line 103):

```sql
-- Current SELECT:
SELECT
  full_name,
  gender,
  date_of_birth,
  CASE
    WHEN date_of_birth ~ '^\d{4}-\d{2}-\d{2}$'
    THEN EXTRACT(YEAR FROM AGE(CURRENT_DATE, date_of_birth::date))::int
    WHEN date_of_birth ~ '^\d{2}/\d{2}/\d{4}$'
    THEN EXTRACT(YEAR FROM AGE(CURRENT_DATE, TO_DATE(date_of_birth, 'DD/MM/YYYY')))::int
    ELSE NULL
  END AS age
FROM patients WHERE id = $1

-- New SELECT (must add date_of_birth_normalized to SELECT list):
SELECT
  full_name,
  gender,
  date_of_birth,
  date_of_birth_normalized,  -- ADD THIS COLUMN
  CASE
    WHEN date_of_birth_normalized IS NOT NULL
    THEN EXTRACT(YEAR FROM AGE(CURRENT_DATE, date_of_birth_normalized))::int
    ELSE NULL
  END AS age
FROM patients WHERE id = $1
```

**Important**: The `date_of_birth_normalized` column MUST be added to the SELECT clause for the CASE expression to reference it. Keep `date_of_birth` (raw text) for display purposes in the patient context string.

This eliminates format guessing and provides consistent age calculation for all patients with unambiguous DOBs.

## API Exposure

**Internal-only for MVP**: The `date_of_birth_normalized` column is for backend queries (age calculation, sorting, date comparisons). API responses in `server/services/reportRetrieval.js` will continue returning only `date_of_birth` (raw text) for display purposes.

**Future enhancement** (out of scope): Expose `date_of_birth_normalized` in API responses for clients that need reliable date parsing.

## Ambiguous Date Handling

For ambiguous dates (returns `null`), the system behavior is:

1. **Raw text preserved**: `date_of_birth` column keeps original OCR output
2. **Normalized column null**: `date_of_birth_normalized` = `NULL`
3. **No user intervention required**: Ambiguous dates remain queryable as text
4. **Future enhancement** (out of scope): Admin UI to manually resolve ambiguous DOBs

## Testing

### Unit Tests

1. Verify `normalizeDate` handles DOB formats correctly (already covered by existing tests for `normalizeTestDate`)
2. Verify patient creation stores both raw and normalized DOB
3. Verify backfill script processes existing records

### Manual QA

1. Upload lab report with unambiguous DOB (e.g., `15/03/1987`) → verify normalized to `1987-03-15`
2. Upload lab report with ambiguous DOB (e.g., `01/02/1987`) → verify `date_of_birth_normalized` is `NULL`
3. Upload lab report with ISO DOB (e.g., `1987-08-04`) → verify normalized correctly
4. Run backfill script on existing data → verify existing patients updated

## Rollout Plan

**Critical deployment order** to avoid "Unknown" ages for existing patients:

1. **Schema migration**: Add column (non-breaking, nullable)
2. **Backfill FIRST**: Run backfill script for existing patients BEFORE deploying agenticCore.js changes
3. **Code update**: Deploy patient creation changes to populate both columns on new records
4. **Age calculation update**: Deploy agenticCore.js changes (safe now that backfill is complete)
5. **Verification**: Check normalization coverage

**Warning**: If step 4 is deployed before step 2 completes, existing patients will show "Unknown" age until backfill runs. This degrades UX but is not a data integrity issue.

**Pre-deployment verification** (run before step 4):
```sql
-- Check backfill coverage: should show 0 rows if backfill is complete
SELECT COUNT(*) AS unprocessed
FROM patients
WHERE date_of_birth IS NOT NULL
  AND date_of_birth_normalized IS NULL;
```
If this returns > 0, do NOT deploy step 4 until backfill completes.

## Success Metrics

- All new patients have `date_of_birth_normalized` populated (when unambiguous)
- Existing patients backfilled
- Date-based queries possible (e.g., age calculation, DOB sorting)

## Out of Scope

- Admin UI for resolving ambiguous DOBs
- Retroactive OCR re-processing to get better date formats
- Changing OCR prompts to prefer ISO format for DOB
