# PRD v4.5: Remove Categories & Normalize Canonical Units

**Status:** Draft
**Created:** 2025-12-28
**Target:** v4.5

---

## Overview

Remove the `category` field from the analytes data model and normalize all canonical units to English/Latin using LOINC (Logical Observation Identifiers Names and Codes) as the authoritative reference.

**Rationale:**
- **Category field has no functional use**: Not used for filtering, business logic, or user-facing features
- **63% of lab results are uncategorized**: Field is largely unpopulated and unmaintainable
- **LLM has semantic understanding**: Chat agent doesn't need category metadata to group related tests
- **Cyrillic units cause inconsistency**: 79 analytes have Russian units, breaking international standards
- **Maintenance burden**: Every new analyte requires categorization with unclear ROI

**Philosophy:** Keep the database schema simple and maintain only what provides clear value. Let LLM semantic understanding handle test grouping instead of maintaining a category taxonomy.

**Development Mode Simplification:**
- **No production users**: Application is in active development with test data only
- **No migration complexity**: Drop and recreate database instead of careful schema migrations
- **All changes in version control**: Schema changes go into `schema.js`, `seed_analytes.sql`, and setup scripts
- **Fresh start approach**: After implementation, run `./scripts/recreate_auth_db.sh && npm run dev` to get clean database with corrected schema and normalized units
- **Zero downtime concern**: Can afford to reset database at any time during development

This eliminates migration scripts, backup procedures, and gradual rollout complexity. Implementation is: fix schema files → drop DB → recreate → done.

---

## Goals

1. **Remove category field** from database schema, code, and UI
2. **Normalize all canonical units** to English/Latin notation using LOINC
3. **Update LLM prompt** to propose English units for NEW analytes
4. **Add validation** to reject non-Latin units in new proposals

---

## Current State Analysis

### Category Field Usage
```
Location                         | Usage
---------------------------------|----------------------------------------
analytes.category                | Database column (210 analytes)
pending_analytes.category        | Database column
MappingApplier.js:1136           | Defaults to 'uncategorized' (LLM doesn't provide)
admin.js:213,416                 | UI display (category badge)
admin.css:134                    | Styling for category badge
export_seed.js:104,134           | Groups analytes by category
routes/admin.js:125              | Passes category when approving analytes
```

**Distribution:**
- Categorized: 60 analytes (cardiac, liver, kidney, etc.)
- Uncategorized: 147 analytes (70%)
- Lab results: 63% mapped to uncategorized analytes

### Unit Format Issues

**Query:**
```sql
SELECT
  COUNT(*) FILTER (WHERE unit_canonical ~ '[а-яА-Я]') as cyrillic_units,
  COUNT(*) FILTER (WHERE unit_canonical ~ '^[A-Za-z0-9%°µμ /.\-\(\)]+$') as latin_units,
  COUNT(*) as total
FROM analytes;
```

**Result:**
- 79 analytes with Cyrillic units (e.g., `пг/мл`, `г/л`, `нг/мл`)
- Units from Russian lab reports stored verbatim in `unit_canonical`
- Breaks international standards (UCUM, LOINC)

**Examples:**
```
Code         | Current Unit      | LOINC Standard
-------------|-------------------|----------------
ADRENALINE   | пг/мл             | pg/mL
APOA1        | г/л               | g/L
C_PEPTIDE    | нг/мл             | ng/mL
BASO         | 10^9 клеток/л     | 10*9/L
CA_ION       | ммоль/л           | mmol/L
```

---

## Scope

### In Scope

1. **Database Schema Changes**
   - Drop `category` column from `analytes` table
   - Drop `category` column from `pending_analytes` table
   - Migration: No data backup needed (field provides no value)

2. **Code Changes - Remove Category References**
   - `server/services/MappingApplier.js`:
     - Remove `llm.category || 'uncategorized'` logic in `queueNewAnalyte()`
     - Remove `category` from SELECT in `getAnalyteSchema()` (approved analytes query)
     - Remove `category` from SELECT in `getAnalyteSchema()` (pending analytes query)
     - **Update JSDoc** for `getAnalyteSchema()` to remove `category` from `@returns` type
   - `public/admin.html`: Remove Category `<th>` header from pending analytes table (line ~111)
   - `public/js/admin.js`: Remove category badge rendering and category `<td>` column
   - `public/css/admin.css`: Remove `.category-badge` styles
   - `server/routes/admin.js`:
     - Remove category handling in approval flow
     - Remove `category` from SELECT in `/api/admin/pending-analytes` endpoint
   - `server/db/export_seed.js`: Remove category grouping logic
   - `server/db/schema.js`: Remove category column from table definitions

3. **LLM Prompt Updates**
   - `prompts/analyte_mapping_system_prompt.txt`: Add `unit_canonical` field to output schema
   - Instruct LLM to propose English/Latin units for NEW analytes
   - Provide unit conversion examples (Russian → English)

4. **Validation & Guardrails**
   - `MappingApplier.js`: Add positive allowlist validation for units (UCUM-aligned regex)
   - **Greek mu normalization**: `μ` (U+03BC) → `µ` (U+00B5) before validation
   - Invalid units (Cyrillic, spaces, non-standard chars) are still queued but flagged with `needs_unit_correction: true`
   - `queueNewAnalyte()` returns status object for accurate counter tracking in `wetRun()`
   - **ON CONFLICT preserves flag**: `needs_unit_correction` uses OR logic so it remains true if ANY insertion had invalid unit
   - OCR fallback units are also validated (not just LLM-proposed units)
   - No silent data loss: all NEW analytes are queued, admin sees invalid units for correction

5. **Invalid Unit Correction Workflow (MVP)**
   - **Find flagged entries:**
     ```sql
     SELECT pending_id, proposed_code, proposed_name, unit_canonical,
            evidence->>'needs_unit_correction' as needs_correction
     FROM pending_analytes
     WHERE (evidence->>'needs_unit_correction')::boolean = true
       AND status = 'pending';
     ```
   - **Approval endpoint blocking**: `POST /api/admin/approve-analyte` MUST check `evidence.needs_unit_correction` and return HTTP 400 if flag is true (admin must fix unit AND clear flag first)
   - **NULL/missing handling for backward compatibility:**
     - If `evidence` is NULL: treat as `needs_unit_correction = false` (approve allowed)
     - If `evidence->>'needs_unit_correction'` is NULL or missing: treat as `false`
     - Only block when explicitly `pending.evidence?.needs_unit_correction === true`
     - Implementation pattern:
       ```javascript
       const needsCorrection = pending.evidence?.needs_unit_correction === true;
       if (needsCorrection) {
         return res.status(400).json({...});
       }
       ```
   - **Error response payload:**
     ```json
     {
       "error": "unit_correction_required",
       "message": "Cannot approve analyte with invalid unit. Correct unit_canonical and clear needs_unit_correction flag via SQL first.",
       "pending_id": 123,
       "current_unit": "пг/мл",
       "proposed_code": "EXAMPLE_CODE"
     }
     ```
   - **Admin UI handling:** Display error message from response; current toast will show: "Cannot approve analyte with invalid unit..."
   - **MVP approach: Manual DB correction (update unit AND clear flag)**
     ```sql
     -- Update unit AND clear the flag before approval
     UPDATE pending_analytes
     SET unit_canonical = 'corrected_unit',
         evidence = jsonb_set(evidence, '{needs_unit_correction}', 'false'::jsonb)
     WHERE pending_id = <id>;
     ```
   - After correction, admin approves via existing UI (flag cleared, no HTTP 400)
   - **Future enhancement (out of scope):** Add edit form in admin UI with dedicated endpoint

6. **Seed File Normalization (LOINC-based)**
   - Review all 210 analytes in `server/db/seed_analytes.sql`
   - Convert Cyrillic units to English/Latin using LOINC as reference
   - Remove `category` column from INSERT statements
   - Document conversions in commit message with LOINC codes

### Out of Scope

- ✗ Backfilling existing lab results (units stored in `lab_results.unit` remain as-is from OCR)
- ✗ UI changes beyond removing category badges
- ✗ Unit conversion/normalization at query time
- ✗ Category-based filtering features
- ✗ Admin UI for editing pending analyte units (MVP uses manual DB correction)

---

## Technical Design

### 1. Database Schema Changes (No Migration Needed)

**File:** `server/db/schema.js`

**Changes:**
```javascript
// BEFORE
CREATE TABLE IF NOT EXISTS analytes (
  analyte_id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  unit_canonical TEXT,
  category TEXT,  // ← REMOVE
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pending_analytes (
  pending_id BIGSERIAL PRIMARY KEY,
  proposed_code TEXT UNIQUE NOT NULL,
  proposed_name TEXT NOT NULL,
  unit_canonical TEXT,
  category TEXT,  // ← REMOVE
  ...
);

// AFTER
CREATE TABLE IF NOT EXISTS analytes (
  analyte_id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  unit_canonical TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pending_analytes (
  pending_id BIGSERIAL PRIMARY KEY,
  proposed_code TEXT UNIQUE NOT NULL,
  proposed_name TEXT NOT NULL,
  unit_canonical TEXT,
  ...
);
```

**Schema Documentation:**
Add COMMENT for evidence JSON column to document expected shape:
```sql
COMMENT ON COLUMN pending_analytes.evidence IS
  'JSON object with fields: report_id, result_id, parameter_name, unit, llm_comment, first_seen, last_seen, occurrence_count, needs_unit_correction (boolean - true if unit failed validation)';
```

**Migration Strategy:**
```bash
# Development mode - no migration scripts needed
# Just drop and recreate database with updated schema

./scripts/recreate_auth_db.sh  # Drops and recreates DB
npm run dev                     # Applies new schema.js and seeds analytes
```

**Rationale:**
- No production users → no data to preserve
- All test data can be regenerated
- Cleaner than ALTER TABLE migrations
- Ensures fresh start with corrected schema and LOINC-normalized units

### 2. Code Changes

#### A. MappingApplier.js

**A.1 Persist `unit_canonical` in LLM tier merge logic (Line ~836-844):**

The LLM response includes `unit_canonical` for NEW decisions, but the current tier merge logic doesn't capture it. Add `unit_canonical` to the stored LLM tier data:

```javascript
// BEFORE (dryRun() - LLM tier merge block)
rowLog.tiers.llm = {
  present: true,
  decision: llmResult.decision,
  code: llmResult.code,
  name: llmResult.name,
  confidence: llmResult.confidence,
  comment: llmResult.comment
};

// AFTER
rowLog.tiers.llm = {
  present: true,
  decision: llmResult.decision,
  code: llmResult.code,
  name: llmResult.name,
  unit_canonical: llmResult.unit_canonical,  // ← ADD: Persist LLM-proposed unit
  confidence: llmResult.confidence,
  comment: llmResult.comment
};
```

**A.2 Remove category handling and use LLM unit (Line ~1108-1140):**
```javascript
// BEFORE
await pool.query(
  `INSERT INTO pending_analytes
     (proposed_code, proposed_name, unit_canonical, category, ...)
   VALUES ($1, $2, $3, $4, ...)`,
  [
    llm.code,
    llm.name,
    unit,                             // ← OCR unit (may be Cyrillic)
    llm.category || 'uncategorized',  // ← REMOVE
    ...
  ]
);

// AFTER
await pool.query(
  `INSERT INTO pending_analytes
     (proposed_code, proposed_name, unit_canonical, ...)
   VALUES ($1, $2, $3, ...)`,
  [
    llm.code,
    llm.name,
    llm.unit_canonical || unit,  // ← Use LLM-proposed unit, fallback to OCR
    ...
  ]
);
```

**Remove category from getAnalyteSchema() (Line ~260-280):**
```javascript
// BEFORE
const { rows: approved } = await pool.query(
  `SELECT code, name, category, 'approved' as status, NULL as pending_id
   FROM analytes ORDER BY code`
);
const { rows: pending } = await pool.query(
  `SELECT proposed_code AS code, proposed_name AS name, category, 'pending' as status, pending_id
   FROM pending_analytes WHERE status = 'pending' ORDER BY proposed_code`
);

// AFTER
const { rows: approved } = await pool.query(
  `SELECT code, name, 'approved' as status, NULL as pending_id
   FROM analytes ORDER BY code`
);
const { rows: pending } = await pool.query(
  `SELECT proposed_code AS code, proposed_name AS name, 'pending' as status, pending_id
   FROM pending_analytes WHERE status = 'pending' ORDER BY proposed_code`
);
```

**A.3 Add unit validation with fallback logic (queueNewAnalyte):**

**Unit Normalization (CRITICAL):**

Units from LLM and OCR may contain:
- Greek mu `μ` (U+03BC) instead of micro sign `µ` (U+00B5)
- Spaces around operators: `mg / dL` instead of `mg/dL`
- Method suffixes: `ng/mL DDU`, `IU/L ELISA`
- Unicode multiplication: `×10^9/L` instead of `*10^9/L`
- "cells" text: `10^9 cells/L` instead of `10^9/L`

The `normalizeUnit()` function (defined in queueNewAnalyte code below) handles all these common OCR/LLM artifacts BEFORE validation. This prevents excessive false positives that would require manual SQL corrections.

**Seed file requirement:** Replace all Greek mu `μ` with micro sign `µ` in `seed_analytes.sql`.

**Unit Validation Regex (positive allowlist - UCUM-aligned):**
```javascript
const VALID_UNIT_REGEX = /^[A-Za-z0-9%°µ/.\-\(\)\*\^]+$/;
```

**Important:** Only `µ` (U+00B5) is allowed. Greek `μ` (U+03BC) must be normalized first.

**Decision table for unit_canonical handling:**
| LLM provides | Passes allowlist? | OCR unit passes? | Action |
|--------------|-------------------|------------------|--------|
| `unit_canonical` | Yes | N/A | Use `llm.unit_canonical` |
| `unit_canonical` | No | N/A | Queue for admin review with `needs_unit_correction` flag |
| Missing/null | N/A | Yes | Use OCR unit with info log |
| Missing/null | N/A | No | Queue for admin review with `needs_unit_correction` flag |
| Missing/null | N/A | Missing/null | Queue with `needs_unit_correction: true` (unit required) |

**Updated `queueNewAnalyte()` with return status pattern:**

```javascript
/**
 * Queue NEW analyte to pending_analytes table
 * Returns status object for proper counter tracking in wetRun()
 *
 * @param {Object} rowResult - Row decision object from dryRun
 * @returns {Promise<{queued: boolean, reason: string}>}
 */
async function queueNewAnalyte(rowResult) {
  const { tiers, label_raw, unit, report_id, result_id } = rowResult;
  const llm = tiers.llm;

  // Unit validation regex (UCUM-aligned positive allowlist)
  const VALID_UNIT_REGEX = /^[A-Za-z0-9%°µ/.\-\(\)\*\^]+$/;

  if (!llm.code || !llm.name) {
    logger.warn({ result_id }, 'Cannot queue NEW analyte: missing code or name');
    return { queued: false, reason: 'missing_code_or_name' };
  }

  // CRITICAL VALIDATION: Check if the proposed code already exists
  const { rows: existingAnalytes } = await pool.query(
    'SELECT analyte_id, code, name FROM analytes WHERE code = $1',
    [llm.code]
  );

  if (existingAnalytes.length > 0) {
    logger.warn({
      result_id,
      proposed_code: llm.code,
      existing_analyte: existingAnalytes[0],
    }, 'LLM returned NEW but code already exists - skipping queue');
    return { queued: false, reason: 'code_exists' };
  }

  // Full unit normalization (handles common OCR artifacts before validation)
  // See "Canonical Unit Normalization Rules" section for details
  function normalizeUnit(unit) {
    if (!unit) return unit;
    return unit
      // Remove method annotations (DDU, FEU, ELISA, etc.)
      .replace(/\s+(DDU|FEU|ELISA|EIA|RIA|CLIA|ECLIA)$/i, '')
      // Remove prefix annotations
      .replace(/^(DDU|FEU)\s+/i, '')
      // Normalize "cells" in counts
      .replace(/\bcells?\b/i, '')
      // Remove spaces around operators
      .replace(/\s*\/\s*/g, '/')
      // Convert × (multiplication sign U+00D7) to * (asterisk)
      .replace(/×/g, '*')
      // Normalize arbitrary units
      .replace(/arb'?U/i, 'AU')
      // Normalize Greek mu to Micro sign (U+03BC → U+00B5)
      .replace(/μ/g, 'µ')
      // Trim whitespace
      .trim();
  }

  // Determine unit to store with validation
  let unitToStore = null;
  let invalidUnit = false;

  if (llm.unit_canonical) {
    // Apply full normalization (spaces, method suffixes, µ) then validate
    const normalizedUnit = normalizeUnit(llm.unit_canonical);
    if (VALID_UNIT_REGEX.test(normalizedUnit)) {
      unitToStore = normalizedUnit;
    } else {
      logger.warn({
        result_id,
        proposed_code: llm.code,
        unit: llm.unit_canonical
      }, '[queueNewAnalyte] LLM proposed invalid unit - flagging for admin review');
      unitToStore = normalizedUnit;  // Store normalized version for admin to see
      invalidUnit = true;
    }
  } else if (unit) {
    // Fallback to OCR unit - apply full normalization then validate
    const normalizedOcrUnit = normalizeUnit(unit);
    if (VALID_UNIT_REGEX.test(normalizedOcrUnit)) {
      unitToStore = normalizedOcrUnit;
      logger.info({
        result_id,
        proposed_code: llm.code,
        ocr_unit: unit
      }, '[queueNewAnalyte] LLM did not provide unit_canonical - using valid OCR unit');
    } else {
      logger.warn({
        result_id,
        proposed_code: llm.code,
        ocr_unit: unit
      }, '[queueNewAnalyte] OCR unit invalid - flagging for admin review');
      unitToStore = normalizedOcrUnit;  // Store normalized version for admin to see
      invalidUnit = true;
    }
  }

  // Build evidence object (include invalidUnit flag for admin UI)
  const evidence = {
    report_id: report_id,
    result_id: result_id,  // ← CRITICAL: Include for ON CONFLICT merge
    parameter_name: label_raw,
    unit: unit,
    llm_comment: llm.comment,
    first_seen: new Date().toISOString(),
    occurrence_count: 1,
    needs_unit_correction: invalidUnit  // ← Flag for admin UI
  };

  // ... rest of INSERT query using unitToStore ...
  // (existing INSERT logic, but now using unitToStore)

  try {
    // CRITICAL: ON CONFLICT must preserve needs_unit_correction flag
    // If ANY insertion had an invalid unit, the flag must remain true
    await pool.query(
      `INSERT INTO pending_analytes
         (proposed_code, proposed_name, unit_canonical, confidence, evidence, status, parameter_variations)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6)
       ON CONFLICT (proposed_code) DO UPDATE SET
         confidence = GREATEST(pending_analytes.confidence, EXCLUDED.confidence),
         evidence = CASE
           WHEN pending_analytes.evidence IS NULL THEN EXCLUDED.evidence
           ELSE jsonb_build_object(
             'report_id', EXCLUDED.evidence->>'report_id',
             'result_id', EXCLUDED.evidence->>'result_id',
             'parameter_name', EXCLUDED.evidence->>'parameter_name',
             'unit', EXCLUDED.evidence->>'unit',
             'llm_comment', EXCLUDED.evidence->>'llm_comment',
             'first_seen', pending_analytes.evidence->>'first_seen',
             'last_seen', EXCLUDED.evidence->>'first_seen',
             'occurrence_count', (COALESCE((pending_analytes.evidence->>'occurrence_count')::int, 0) + 1),
             'needs_unit_correction', (
               COALESCE((pending_analytes.evidence->>'needs_unit_correction')::boolean, false)
               OR
               COALESCE((EXCLUDED.evidence->>'needs_unit_correction')::boolean, false)
             )
           )
         END,
         parameter_variations = CASE
           WHEN pending_analytes.parameter_variations IS NULL THEN EXCLUDED.parameter_variations
           ELSE pending_analytes.parameter_variations || EXCLUDED.parameter_variations
         END,
         updated_at = NOW()`,
      [llm.code, llm.name, unitToStore, llm.confidence, JSON.stringify(evidence), JSON.stringify(parameterVariations)]
    );

    logger.info({
      result_id,
      proposed_code: llm.code,
      proposed_name: llm.name,
      needs_unit_correction: invalidUnit
    }, '[queueNewAnalyte] NEW analyte queued');

    return { queued: true, reason: invalidUnit ? 'queued_with_invalid_unit' : 'queued' };
  } catch (error) {
    logger.error({ error: error.message, result_id }, 'Failed to queue NEW analyte');
    return { queued: false, reason: 'db_error' };
  }
}
```

**A.4 Update `wetRun()` to use return status (Line ~1586-1589):**

```javascript
// BEFORE
else if (final_decision === 'NEW_LLM') {
  await queueNewAnalyte(row);
  counters.new_queued++;
}

// AFTER
else if (final_decision === 'NEW_LLM') {
  const result = await queueNewAnalyte(row);
  if (result.queued) {
    counters.new_queued++;
    if (result.reason === 'queued_with_invalid_unit') {
      counters.new_needs_unit_correction = (counters.new_needs_unit_correction || 0) + 1;
    }
  } else {
    counters.new_rejected = (counters.new_rejected || 0) + 1;
    logger.info({ result_id: row.result_id, reason: result.reason }, '[wetRun] NEW analyte not queued');
  }
}
```

#### B. Admin UI (admin.js)

**Remove category references in TWO locations:**

1. **Table row (Line ~213):** Remove category badge column
2. **Details modal (Line ~416):** Remove category from metadata section

```javascript
// BEFORE - Table row (Line ~213)
<td><span class="category-badge">${escapeHtml(analyte.category || 'uncategorized')}</span></td>

// AFTER
// Remove entire <td> column
```

**Update table headers:**
```javascript
// BEFORE
<th>Proposed Code</th><th>Name</th><th>Category</th><th>Unit</th>

// AFTER
<th>Proposed Code</th><th>Name</th><th>Unit</th>
```

**Remove category from details modal metadata (Line ~416):**
```javascript
// BEFORE - showAnalyteDetails() modal body
<p><strong>Category:</strong> ${escapeHtml(analyte.category || 'uncategorized')}</p>

// AFTER
// Remove this <p> element entirely
```

#### C. Admin Routes (routes/admin.js)

**Remove category from pending-analytes endpoint SELECT (~Line 51):**
```javascript
// BEFORE
const { rows } = await pool.query(
  `SELECT pending_id, proposed_code, proposed_name, unit_canonical, category, ...`
);

// AFTER
const { rows } = await pool.query(
  `SELECT pending_id, proposed_code, proposed_name, unit_canonical, ...`  // category removed
);
```

**Remove category from approval flow (~Line 118-125):**
```javascript
// BEFORE
const { rows: newAnalyteRows } = await client.query(
  `INSERT INTO analytes (code, name, unit_canonical, category)
   VALUES ($1, $2, $3, $4) RETURNING analyte_id`,
  [pending.proposed_code, pending.proposed_name, pending.unit_canonical, pending.category || 'uncategorized']
);

// AFTER
const { rows: newAnalyteRows } = await client.query(
  `INSERT INTO analytes (code, name, unit_canonical)
   VALUES ($1, $2, $3) RETURNING analyte_id`,
  [pending.proposed_code, pending.proposed_name, pending.unit_canonical]
);
```

#### D. Seed Export (db/export_seed.js)

**Remove category grouping (~Line 104, 134):**
```javascript
// BEFORE
const cat = a.category || 'other';
// ... grouping logic by category

// AFTER
// Flat list, no grouping
const lines = [];
allAnalytes.forEach((a, i) => {
  const comma = (i < allAnalytes.length - 1) ? ',' : ';';
  lines.push(`  ('${a.code}', '${a.name}', '${a.unit_canonical || ''}')${comma}`);
});
```

### 3. LLM Prompt Updates

**File:** `prompts/analyte_mapping_system_prompt.txt`

**API Format Decision:** The current `MappingApplier.js` uses `json_object` format (not `json_schema`). While `json_schema` provides stricter enforcement, the current approach is acceptable because:
1. The decision table (section A.3) explicitly handles missing `unit_canonical` with OCR fallback
2. Missing units are flagged with `needs_unit_correction` for admin review
3. Upgrading to `json_schema` is optional but recommended for future robustness

**Add unit_canonical field to output schema:**
```json
{
  "results": [
    {
      "label": "parameter name",
      "decision": "MATCH" | "NEW" | "ABSTAIN",
      "code": "string or null",
      "name": "string or null (only for NEW)",
      "unit_canonical": "string or null (only for NEW, MUST use English/Latin notation)",
      "confidence": 0.95,
      "comment": "brief reason"
    }
  ]
}
```

**Add instructions for NEW decision:**
```
For NEW analytes, you MUST provide:
- code: Uppercase with underscores (e.g., HSV1_IGG, VITB_12)
- name: Clear English name
- unit_canonical: Standard English/Latin unit notation (e.g., µmol/L, mg/dL, pg/mL, IU/mL)

CRITICAL - Unit Canonical Requirements:
- Use ONLY English/Latin characters (no Cyrillic: пг/мл → pg/mL, г/л → g/L)
- Follow UCUM standard notation where possible
- Common conversions:
  * пг/мл → pg/mL
  * нг/мл → ng/mL
  * мкг/мл → µg/mL (or mcg/mL)
  * мкмоль/л → µmol/L (or umol/L)
  * ммоль/л → mmol/L
  * г/л → g/L
  * МЕ/мл → IU/mL
  * клеток/л → cells/L
  * сек → sec
```

**Allowed Unit Character Set (UCUM-aligned):**

Units MUST match this positive allowlist regex:
```
^[A-Za-z0-9%°µ/.\-\(\)\*\^]+$
```

Allowed characters:
- `A-Z`, `a-z` - Latin letters
- `0-9` - Digits
- `%` - Percentage
- `°` - Degree symbol (U+00B0)
- `µ` - Micro sign (U+00B5) - preferred over `mcg`
- `/` - Division (e.g., `mg/dL`)
- `.` - Decimal point
- `-` - Minus/hyphen
- `()` - Parentheses for grouping
- `*` - Multiplication in exponents (UCUM standard: `10*9/L`)
- `^` - Exponent notation (acceptable alternative: `10^9/L`)

**Exponent notation standardization:** Use `10*9/L` (UCUM) or `10^9/L` interchangeably; both are acceptable.

**NOT allowed:** Cyrillic characters (`а-яА-Я`), spaces in units, non-standard symbols.

**Canonical Unit Normalization Rules:**

Real-world lab units often contain annotations, qualifiers, or method indicators. These must be normalized:

| Pattern | Example | Canonical Form | Notes |
|---------|---------|----------------|-------|
| Method annotations | `ng/mL DDU`, `IU/L ELISA` | `ng/mL`, `IU/L` | Strip method suffix |
| Qualifier prefixes | `FEU ng/mL` | `ng/mL` | Strip FEU/DDU prefixes |
| Per-field counts | `per HPF`, `/HPF` | `/HPF` | Normalize to slash form |
| Cell counts | `cells/L`, `10^9 cells/L` | `10^9/L` | Drop "cells" text |
| Titer ratios | `1:128`, `<1:10` | `titer` | Store as `titer` unit, actual ratio in value |
| Positive/Negative | `positive`, `negative` | `qualitative` | Qualitative results |
| Arbitrary units | `AU/mL`, `arb'U/mL` | `AU/mL` | Standardize to AU |
| Spaces in units | `mg / dL` | `mg/dL` | Remove spaces around operators |

**Normalization Implementation:**
```javascript
function normalizeUnit(unit) {
  if (!unit) return unit;

  let normalized = unit
    // Remove method annotations (DDU, FEU, ELISA, etc.)
    .replace(/\s+(DDU|FEU|ELISA|EIA|RIA|CLIA|ECLIA)$/i, '')
    // Remove prefix annotations
    .replace(/^(DDU|FEU)\s+/i, '')
    // Normalize "cells" in counts
    .replace(/\bcells?\b/i, '')
    // Remove spaces around operators
    .replace(/\s*\/\s*/g, '/')
    // Normalize arbitrary units
    .replace(/arb'?U/i, 'AU')
    // Trim whitespace
    .trim();

  return normalized;
}
```

**Note:** If a unit cannot be normalized to pass the allowlist, set `needs_unit_correction: true` and store the original (normalized for display) for admin correction.

### 4. Seed File Normalization (LOINC-Based)

**Scope:** 79 analytes with Cyrillic units (not all 210 analytes).

**Owner:** Feature owner (user) will provide the LOINC mapping file.

**Process:**
1. Developer exports Cyrillic-unit analytes: `SELECT code, name, unit_canonical FROM analytes WHERE unit_canonical ~ '[а-яА-Я]' ORDER BY code;`
2. **Developer asks feature owner for LOINC mapping file** (CSV with `code,loinc_unit` columns)
3. Developer updates `server/db/seed_analytes.sql` with provided mappings
4. Document conversions in commit message

**LOINC Mapping File Format:**

File location: `docs/loinc_unit_mappings.csv` (provided by feature owner)

```csv
code,current_unit,loinc_code,loinc_unit
ADRENALINE,пг/мл,2230-9,pg/mL
APOA1,г/л,1869-7,g/L
C_PEPTIDE,нг/мл,1986-9,ng/mL
...
```

**Note:** Implementation can proceed with all schema/code changes. Seed file update is a final step that only requires find-replace once the mapping CSV arrives. Developer should NOT block on this file.

**LOINC Lookup Resources (for reference):**
- LOINC Search: https://loinc.org/search/
- LOINC Table Download: https://loinc.org/downloads/
- RELMA (LOINC mapping tool)

**Example Conversions with LOINC Verification:**

| Code | Current Unit | LOINC Code | LOINC Unit | Updated Unit |
|------|--------------|------------|------------|--------------|
| ADRENALINE | пг/мл | 2230-9 | pg/mL | pg/mL |
| APOA1 | г/л | 1869-7 | g/L | g/L |
| C_PEPTIDE | нг/мл | 1986-9 | ng/mL | ng/mL |
| BASO | 10^9 клеток/л | 705-2 | 10*9/L | 10^9/L |
| CA_ION | ммоль/л | 1994-3 | mmol/L | mmol/L |

**Seed File Structure Change:**
```sql
-- BEFORE
INSERT INTO analytes (code, name, unit_canonical, category) VALUES
  ('HCT', 'Hematocrit', '%', 'hematology'),
  ('ADRENALINE', 'Adrenaline (Epinephrine)', 'пг/мл', 'uncategorized'),
  ...

-- AFTER (no category column)
INSERT INTO analytes (code, name, unit_canonical) VALUES
  ('HCT', 'Hematocrit', '%'),
  ('ADRENALINE', 'Adrenaline (Epinephrine)', 'pg/mL'),
  ...
```

**Implementation Steps:**
1. Developer runs: `SELECT code, name, unit_canonical FROM analytes WHERE unit_canonical ~ '[а-яА-Я]' ORDER BY code;`
2. Developer asks feature owner: "Please provide LOINC mapping file for these 79 analytes"
3. Feature owner provides CSV with LOINC-verified units
4. Developer updates seed file with provided mappings
5. Developer removes `category` column from all INSERT statements

---

## Data Sources & References

**LOINC (Primary Reference):**
- Website: https://loinc.org
- Purpose: Universal standard for lab test identification
- Contains: 94,000+ lab tests with canonical units
- License: Free for use (LOINC license)

**UCUM (Unit Standard):**
- Website: https://ucum.org
- Purpose: Unified Code for Units of Measure
- Used by: LOINC, HL7 FHIR, ISO standards

**ISO 15189:**
- Medical laboratory quality standard
- Mandates use of SI units and LOINC where applicable

---

## Testing & Validation

### Unit Tests

**Test Approach:** Use integration DB pattern (same as existing `test/db/*.test.js`). Use real `pool` for database interactions, mock only external dependencies (LLM API calls via jest.mock). Tests require running PostgreSQL instance.

- `test/db/schema.test.js`: Update to remove category assertions (if assertions exist)
- **NEW FILE:** `test/services/MappingApplier.test.js` - Create new test file with:
  - Test: Valid unit_canonical passes allowlist → `queued: true`
  - Test: Invalid unit_canonical (Cyrillic) → `queued: true, reason: 'queued_with_invalid_unit'`
  - Test: Missing unit_canonical with valid OCR unit → uses OCR unit, `queued: true`
  - Test: Missing unit_canonical with invalid OCR unit → `queued: true, reason: 'queued_with_invalid_unit'`
  - Test: Return status used correctly in wetRun() counter tracking
  - Test: `needs_unit_correction` flag set correctly in evidence object
  - **Test: Greek mu (μ, U+03BC) normalized to micro sign (µ, U+00B5)** → passes validation after normalization
  - **Test: Spaces around operators normalized** → `mg / dL` → `mg/dL` → passes validation
  - **Test: Method suffixes removed** → `ng/mL DDU` → `ng/mL` → passes validation
  - **Test: Unicode multiplication sign normalized** → `×10^9/L` → `*10^9/L` → passes validation
  - Test: ON CONFLICT preserves `needs_unit_correction` flag (OR logic)

### Manual QA Checklist
1. **Database Migration**
   - [ ] `category` column dropped from `analytes`
   - [ ] `category` column dropped from `pending_analytes`
   - [ ] Existing analytes still queryable

2. **Seed File**
   - [ ] All units in English/Latin (no Cyrillic: `grep -E '[а-яА-Я]' seed_analytes.sql` returns nothing)
   - [ ] No Greek mu: `grep -P 'μ' seed_analytes.sql` returns nothing (only micro sign `µ` allowed)
   - [ ] No category column in INSERT statements
   - [ ] File loads without SQL errors

3. **LLM Behavior**
   - [ ] Upload Russian lab report with new analyte
   - [ ] LLM proposes NEW with English unit (e.g., `µmol/L` not `мкмоль/л`)
   - [ ] If LLM proposes Cyrillic unit, analyte is still queued with `needs_unit_correction` flag
   - [ ] Verify `evidence.needs_unit_correction` is true for invalid units:
     ```sql
     SELECT pending_id, proposed_code, unit_canonical, evidence->>'needs_unit_correction'
     FROM pending_analytes WHERE (evidence->>'needs_unit_correction')::boolean = true;
     ```
   - [ ] Verify logs show accurate counters (`new_queued`, `new_needs_unit_correction`)

4. **Admin UI**
   - [ ] Pending analytes table shows code, name, unit (no category badge)
   - [ ] Approval flow works without category field

5. **No Regressions**
   - [ ] Lab report processing still works
   - [ ] Analyte mapping (exact/fuzzy/LLM) still works
   - [ ] Chat SQL generation still works

---

## Acceptance Criteria

1. ✅ `category` column removed from `analytes` and `pending_analytes` tables
2. ✅ All code references to `category` removed:
   - `MappingApplier.js`: `queueNewAnalyte()` and `getAnalyteSchema()` (including JSDoc update)
   - `admin.html`: Category `<th>` header removed from pending analytes table
   - `admin.js`: category badge and `<td>` column rendering removed
   - `routes/admin.js`: pending-analytes SELECT and approval INSERT
   - `export_seed.js`: grouping logic
3. ✅ All 79 Cyrillic-unit analytes converted once `docs/loinc_unit_mappings.csv` is provided by feature owner (external dependency)
4. ✅ LLM prompt requires `unit_canonical` for NEW analytes with allowed character set spec
5. ✅ LLM tier merge logic persists `unit_canonical` from LLM response (line ~836-844)
6. ✅ `queueNewAnalyte()` uses `llm.unit_canonical` with fallback to OCR unit
7. ✅ Unit validation uses positive allowlist regex (not Cyrillic-only check)
8. ✅ **Full unit normalization**: `normalizeUnit()` handles Greek mu, spaces, method suffixes, Unicode multiplication before validation
9. ✅ Invalid units are queued with `needs_unit_correction` flag (no silent data loss)
10. ✅ **ON CONFLICT preserves flag**: `needs_unit_correction` uses OR logic so it remains true if ANY insertion had invalid unit
11. ✅ `queueNewAnalyte()` returns status object; `wetRun()` uses it for accurate counter tracking
12. ✅ Seed file loads without errors and creates analytes correctly
13. ✅ **Seed file uses consistent micro sign**: All `μ` replaced with `µ` in unit_canonical
14. ✅ Admin UI displays pending analytes without category badges
15. ✅ No regressions in lab report processing, mapping, or chat functionality
16. ✅ **Approval endpoint blocking**: Returns HTTP 400 when `evidence.needs_unit_correction` is true (admin must clear flag via DB update first)
17. ✅ **Approval endpoint NULL handling**: Treats NULL/missing `evidence.needs_unit_correction` as false (backward compatible with existing rows)
18. ✅ **Schema documentation**: COMMENT added to `pending_analytes.evidence` column documenting JSON shape including `needs_unit_correction`

---

## Rollout Plan (Simplified - Dev Mode)

**Approach:** Since we're in development with no production users, we'll make all changes to schema files, then drop and recreate the database. No migration scripts, no data preservation, no gradual rollout.

### Phase 1: Update Schema & Code Files
1. **Update `server/db/schema.js`**
   - Remove `category` column from `analytes` table definition
   - Remove `category` column from `pending_analytes` table definition

2. **Update `server/db/seed_analytes.sql`**
   - Export Cyrillic units: `SELECT code, name, unit_canonical FROM analytes WHERE unit_canonical ~ '[а-яА-Я]' ORDER BY code;`
   - **Ask feature owner for LOINC mapping file** (CSV with code → LOINC unit mappings)
   - Update all units to English/Latin notation using provided mappings
   - Remove `category` from INSERT statements (both analytes and aliases)
   - Document conversions in commit message

3. **Update Code**
   - `server/services/MappingApplier.js`:
     - Add `unit_canonical` to LLM tier merge logic (~line 836-844)
     - Remove category handling in `queueNewAnalyte()`
     - Use `llm.unit_canonical` with positive allowlist validation
     - Change `queueNewAnalyte()` to return status object `{queued, reason}`
     - Update `wetRun()` to use return status for accurate counter tracking
     - Remove `category` from `getAnalyteSchema()` SELECTs
     - Update `getAnalyteSchema()` JSDoc to remove `category` from `@returns`
   - `public/js/admin.js`: Remove category badge rendering
   - `public/css/admin.css`: Remove `.category-badge` styles
   - `server/routes/admin.js`:
     - Remove category from pending-analytes SELECT
     - Remove category from approval flow INSERT
   - `server/db/export_seed.js`: Remove category grouping

4. **Update LLM Prompt**
   - `prompts/analyte_mapping_system_prompt.txt`:
     - Add `unit_canonical` field to output schema
     - Add unit format requirements and allowlist
     - Remove category references

5. **Update Tests**
   - Remove category assertions from `test/db/schema.test.js` (if any exist)
   - Create `test/services/MappingApplier.test.js` with unit validation tests

### Phase 2: Database Recreation
```bash
# Stop application
lsof -ti:3000 | xargs kill -9

# Drop and recreate database with new schema
./scripts/recreate_auth_db.sh

# Start application (applies new schema.js and seed_analytes.sql)
npm run dev
```

### Phase 3: Validation
1. **Verify Schema**
   ```sql
   \d analytes  -- Should NOT have category column
   \d pending_analytes  -- Should NOT have category column
   ```

2. **Verify Seed Data**
   ```sql
   -- Should return 0 rows (no Cyrillic units)
   SELECT code, unit_canonical
   FROM analytes
   WHERE unit_canonical ~ '[а-яА-Я]';
   ```

3. **Manual QA Checklist**
   - [ ] Upload Russian lab report with new analyte
   - [ ] Verify LLM proposes English unit (not Cyrillic)
   - [ ] Admin panel shows pending analyte without category badge
   - [ ] Approve pending analyte successfully
   - [ ] All core workflows work (upload, mapping, chat)

4. **Monitor Logs**
   - Watch for Cyrillic unit rejection warnings
   - Verify no schema errors on boot

**Total Time:** ~1-2 hours (LOINC mapping provided by feature owner, not manual lookup)

---

## Risks & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| LOINC mapping file not ready | Blocks seed file update | Developer asks for file early; feature owner commits to providing it |
| Errors in provided LOINC mapping | Incorrect units in seed file | Developer validates all units match allowed character set regex |
| Breaking admin UI | Cannot approve new analytes | Test approval flow in dev before committing, ensure no category references remain |
| LLM still proposes Cyrillic | Analyte queued with `needs_unit_correction` flag | Admin sees flagged entries; no data loss; can correct unit in admin panel |
| LLM omits unit_canonical | Falls back to OCR unit; if invalid, flagged | Both paths validated; admin notified via `needs_unit_correction` flag |
| Seed file SQL errors | Schema apply fails on boot | Test seed file on fresh DB in local dev before merge, validate SQL syntax |
| Lost test data | Need to re-upload lab reports | Acceptable - dev mode only, no production data exists |
| Counter mismatch in wetRun() | Misleading metrics in logs | `queueNewAnalyte()` returns status; `wetRun()` uses it for accurate tracking |

---

## Future Enhancements (Out of Scope)

1. **Admin Edit UI for Pending Analytes**
   - Add edit form in `public/js/admin.js` for modifying `unit_canonical` before approval
   - Add `POST /api/admin/update-pending-analyte` endpoint
   - Add visual indicator (⚠️ badge) for entries with `needs_unit_correction: true`

2. **Unit Conversion at Query Time**
   - Store all results in canonical units
   - Convert on display (e.g., mg/dL ↔ mmol/L for glucose)

3. **LOINC Code Storage**
   - Add `loinc_code` column to analytes table
   - Enable direct LOINC integration

4. **Backfill Lab Results Units**
   - Normalize `lab_results.unit` to match canonical units
   - Enables better plotting/comparison

---

## Success Metrics

- ✅ Zero analytes with Cyrillic units in seed file (79 converted using feature owner's LOINC mapping)
- ✅ All NEW analytes queued (no silent data loss from validation)
- ✅ Invalid units flagged with `needs_unit_correction` for admin review
- ✅ `queueNewAnalyte()` returns accurate status; counters reflect actual outcomes
- ✅ LLM-proposed unit_canonical used for NEW analytes (with OCR fallback logged)
- ✅ Admin approval flow works without category field
- ✅ No regressions in core workflows (upload, mapping, chat)

---

## References

- LOINC Database: https://loinc.org
- UCUM Specification: https://ucum.org
- ISO 15189 Standard (Medical Laboratory Quality)
- PRD v2.4: Analyte Mapping Write Mode
- PRD v4.4.1: Authentication Schema (database role precedent)
