# PRD v4.6: Normalize Canonical Units

**Status:** Draft
**Created:** 2025-12-28
**Target:** v4.6
**Depends on:** PRD v4.5 (Remove Categories)

---

## Overview

Normalize all canonical units to English/Latin notation. Currently, 79 analytes have Russian/Cyrillic units which breaks international standards.

**Rationale:**
- **Cyrillic units cause inconsistency**: 79 analytes have Russian units (e.g., `пг/мл`, `г/л`, `нг/мл`)
- **Breaks international standards**: UCUM and medical standards expect Latin notation
- **Display inconsistency**: Mixed Russian/English units in UI

**Development Mode Simplification:**
- **No production users**: Application is in active development with test data only
- **Fresh start approach**: After implementation, run `./scripts/recreate_auth_db.sh && npm run dev`

---

## Goals

1. **Convert all Cyrillic units** in seed file to English/Latin equivalents
2. **Update LLM prompt** to propose English units for NEW analytes
3. **Add validation** to reject non-Latin units in new proposals

---

## Current State Analysis

### Unit Format Issues

**Query:**
```sql
SELECT
  COUNT(*) FILTER (WHERE unit_canonical ~ '[а-яА-Я]') as cyrillic_units,
  COUNT(*) FILTER (WHERE unit_canonical ~ '^[A-Za-z0-9%°µμ /.\\-\\(\\)]+$') as latin_units,
  COUNT(*) as total
FROM analytes;
```

**Result:**
- 79 analytes with Cyrillic units
- Units from Russian lab reports stored verbatim in `unit_canonical`

**Common Cyrillic → English Conversions:**
```
Cyrillic          | English
------------------|----------------
пг/мл             | pg/mL
нг/мл             | ng/mL
мкг/мл            | µg/mL
мкмоль/л          | µmol/L
ммоль/л           | mmol/L
г/л               | g/L
МЕ/мл             | IU/mL
10^9 клеток/л     | 10^9/L
сек               | sec
```

---

## Scope

### In Scope

1. **Seed File Normalization**
   - Convert all 79 Cyrillic-unit analytes to English/Latin notation
   - Manual conversion using the mapping table above

2. **LLM Prompt Updates**
   - `prompts/analyte_mapping_system_prompt.txt`: Add `unit_canonical` field to output schema
   - Instruct LLM to propose English/Latin units for NEW analytes
   - Provide unit conversion examples (Russian → English)

3. **Validation & Guardrails**
   - `MappingApplier.js`: Add positive allowlist validation for units
   - **Greek mu normalization**: `μ` (U+03BC) → `µ` (U+00B5) before validation
   - Invalid units (Cyrillic, spaces, non-standard chars) are still queued but flagged with `needs_unit_correction: true`
   - `queueNewAnalyte()` returns status object for accurate counter tracking in `wetRun()`
   - **ON CONFLICT preserves flag**: `needs_unit_correction` uses OR logic so it remains true if ANY insertion had invalid unit
   - OCR fallback units are also validated (not just LLM-proposed units)
   - No silent data loss: all NEW analytes are queued, admin sees invalid units for correction

4. **Invalid Unit Correction Workflow (MVP)**
   - **Find flagged entries:**
     ```sql
     SELECT pending_id, proposed_code, proposed_name, unit_canonical,
            evidence->>'needs_unit_correction' as needs_correction
     FROM pending_analytes
     WHERE (evidence->>'needs_unit_correction')::boolean = true
       AND status = 'pending';
     ```
   - **Approval endpoint blocking**: `POST /api/admin/approve-analyte` MUST check `evidence.needs_unit_correction` and return HTTP 400 if flag is true
   - **NULL/missing handling for backward compatibility:**
     - If `evidence` is NULL: treat as `needs_unit_correction = false` (approve allowed)
     - If `evidence->>'needs_unit_correction'` is NULL or missing: treat as `false`
     - Only block when explicitly `pending.evidence?.needs_unit_correction === true`
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
   - **MVP approach: Manual DB correction**
     ```sql
     UPDATE pending_analytes
     SET unit_canonical = 'corrected_unit',
         evidence = jsonb_set(evidence, '{needs_unit_correction}', 'false'::jsonb)
     WHERE pending_id = <id>;
     ```

### Out of Scope

- Backfilling existing lab results (units stored in `lab_results.unit` remain as-is from OCR)
- Unit conversion/normalization at query time
- Admin UI for editing pending analyte units (MVP uses manual DB correction)

---

## Technical Design

### 1. Seed File Normalization

**File:** `server/db/seed_analytes.sql`

**Process:**
1. Export Cyrillic-unit analytes:
   ```sql
   SELECT code, name, unit_canonical
   FROM analytes
   WHERE unit_canonical ~ '[а-яА-Я]'
   ORDER BY code;
   ```
2. Manually convert each unit using the conversion table
3. Update seed file with English units
4. Replace all Greek mu `μ` (U+03BC) with micro sign `µ` (U+00B5)

**Example Changes:**
```sql
-- BEFORE
('ADRENALINE', 'Adrenaline (Epinephrine)', 'пг/мл'),
('APOA1', 'Apolipoprotein A1', 'г/л'),
('C_PEPTIDE', 'C-Peptide', 'нг/мл'),
('BASO', 'Basophils', '10^9 клеток/л'),

-- AFTER
('ADRENALINE', 'Adrenaline (Epinephrine)', 'pg/mL'),
('APOA1', 'Apolipoprotein A1', 'g/L'),
('C_PEPTIDE', 'C-Peptide', 'ng/mL'),
('BASO', 'Basophils', '10^9/L'),
```

### 2. LLM Prompt Updates

**File:** `prompts/analyte_mapping_system_prompt.txt`

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
  * клеток/л → /L (drop "cells" text)
  * сек → sec
```

**Allowed Unit Character Set:**
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

### 3. MappingApplier.js Changes

#### A. Persist `unit_canonical` in LLM tier merge logic (Line ~836-844):

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
  unit_canonical: llmResult.unit_canonical,  // ← ADD
  confidence: llmResult.confidence,
  comment: llmResult.comment
};
```

#### B. Add unit validation with `normalizeUnit()` function:

**Unit Normalization (handles common OCR/LLM artifacts):**
```javascript
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
```

#### C. Update `queueNewAnalyte()` with validation:

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

  // Unit validation regex (positive allowlist)
  const VALID_UNIT_REGEX = /^[A-Za-z0-9%°µ/.\-\(\)\*\^]+$/;

  if (!llm.code || !llm.name) {
    logger.warn({ result_id }, 'Cannot queue NEW analyte: missing code or name');
    return { queued: false, reason: 'missing_code_or_name' };
  }

  // Determine unit to store with validation
  let unitToStore = null;
  let invalidUnit = false;

  if (llm.unit_canonical) {
    const normalizedUnit = normalizeUnit(llm.unit_canonical);
    if (VALID_UNIT_REGEX.test(normalizedUnit)) {
      unitToStore = normalizedUnit;
    } else {
      logger.warn({
        result_id,
        proposed_code: llm.code,
        unit: llm.unit_canonical
      }, '[queueNewAnalyte] LLM proposed invalid unit - flagging for admin review');
      unitToStore = normalizedUnit;
      invalidUnit = true;
    }
  } else if (unit) {
    // Fallback to OCR unit
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
      unitToStore = normalizedOcrUnit;
      invalidUnit = true;
    }
  }

  // Build evidence object with invalidUnit flag
  const evidence = {
    report_id: report_id,
    result_id: result_id,
    parameter_name: label_raw,
    unit: unit,
    llm_comment: llm.comment,
    first_seen: new Date().toISOString(),
    occurrence_count: 1,
    needs_unit_correction: invalidUnit
  };

  // ... INSERT with ON CONFLICT preserving needs_unit_correction flag via OR logic

  return { queued: true, reason: invalidUnit ? 'queued_with_invalid_unit' : 'queued' };
}
```

#### D. Update `wetRun()` to use return status:

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
  }
}
```

### 4. Admin Approval Blocking

**File:** `server/routes/admin.js`

Add check in approval endpoint:
```javascript
// In POST /api/admin/approve-analyte
const needsCorrection = pending.evidence?.needs_unit_correction === true;
if (needsCorrection) {
  return res.status(400).json({
    error: 'unit_correction_required',
    message: 'Cannot approve analyte with invalid unit. Correct unit_canonical and clear needs_unit_correction flag via SQL first.',
    pending_id: pending.pending_id,
    current_unit: pending.unit_canonical,
    proposed_code: pending.proposed_code
  });
}
```

### 5. Schema Documentation

**File:** `server/db/schema.js`

Add COMMENT for evidence JSON column:
```sql
COMMENT ON COLUMN pending_analytes.evidence IS
  'JSON object with fields: report_id, result_id, parameter_name, unit, llm_comment, first_seen, last_seen, occurrence_count, needs_unit_correction (boolean - true if unit failed validation)';
```

---

## Unit Conversion Reference

Complete mapping for seed file conversion:

| Cyrillic | English | Notes |
|----------|---------|-------|
| пг/мл | pg/mL | picograms per milliliter |
| нг/мл | ng/mL | nanograms per milliliter |
| мкг/мл | µg/mL | micrograms per milliliter |
| мкмоль/л | µmol/L | micromoles per liter |
| ммоль/л | mmol/L | millimoles per liter |
| г/л | g/L | grams per liter |
| мг/л | mg/L | milligrams per liter |
| мг/дл | mg/dL | milligrams per deciliter |
| МЕ/мл | IU/mL | international units per milliliter |
| МЕ/л | IU/L | international units per liter |
| Ед/л | U/L | units per liter |
| 10^9/л | 10^9/L | billions per liter |
| 10^9 клеток/л | 10^9/L | drop "cells" text |
| 10^12/л | 10^12/L | trillions per liter |
| % | % | percentage (unchanged) |
| сек | sec | seconds |
| фл | fL | femtoliters |
| пмоль/л | pmol/L | picomoles per liter |
| нмоль/л | nmol/L | nanomoles per liter |

---

## Testing & Validation

### Unit Tests

**NEW FILE:** `test/services/MappingApplier.test.js`
- Test: Valid unit_canonical passes allowlist → `queued: true`
- Test: Invalid unit_canonical (Cyrillic) → `queued: true, reason: 'queued_with_invalid_unit'`
- Test: Missing unit_canonical with valid OCR unit → uses OCR unit
- Test: Missing unit_canonical with invalid OCR unit → flagged
- Test: Greek mu (μ, U+03BC) normalized to micro sign (µ, U+00B5)
- Test: Spaces around operators normalized → `mg / dL` → `mg/dL`
- Test: Method suffixes removed → `ng/mL DDU` → `ng/mL`
- Test: ON CONFLICT preserves `needs_unit_correction` flag (OR logic)

### Manual QA Checklist

1. **Seed File**
   - [ ] All units in English/Latin: `grep -E '[а-яА-Я]' seed_analytes.sql` returns nothing
   - [ ] No Greek mu: `grep -P 'μ' seed_analytes.sql` returns nothing (only `µ` allowed)
   - [ ] File loads without SQL errors

2. **LLM Behavior**
   - [ ] Upload Russian lab report with new analyte
   - [ ] LLM proposes NEW with English unit (e.g., `µmol/L` not `мкмоль/л`)
   - [ ] If LLM proposes Cyrillic unit, analyte is queued with `needs_unit_correction` flag
   - [ ] Verify flag in database:
     ```sql
     SELECT pending_id, proposed_code, unit_canonical, evidence->>'needs_unit_correction'
     FROM pending_analytes WHERE (evidence->>'needs_unit_correction')::boolean = true;
     ```

3. **Approval Blocking**
   - [ ] Try to approve analyte with `needs_unit_correction: true` → HTTP 400
   - [ ] Correct unit via SQL, clear flag → approval succeeds

4. **No Regressions**
   - [ ] Lab report processing still works
   - [ ] Analyte mapping still works
   - [ ] Chat SQL generation still works

---

## Acceptance Criteria

1. ✅ All 79 Cyrillic-unit analytes converted to English in seed file
2. ✅ Seed file uses consistent micro sign `µ` (U+00B5), not Greek mu `μ`
3. ✅ LLM prompt requires `unit_canonical` for NEW analytes with English notation
4. ✅ LLM tier merge logic persists `unit_canonical` from LLM response
5. ✅ `queueNewAnalyte()` uses `llm.unit_canonical` with fallback to OCR unit
6. ✅ Unit validation uses positive allowlist regex
7. ✅ Full unit normalization via `normalizeUnit()` function
8. ✅ Invalid units queued with `needs_unit_correction` flag (no silent data loss)
9. ✅ ON CONFLICT preserves flag via OR logic
10. ✅ `queueNewAnalyte()` returns status object; `wetRun()` uses it for counters
11. ✅ Approval endpoint blocks when `needs_unit_correction` is true
12. ✅ Approval endpoint handles NULL/missing evidence correctly
13. ✅ Schema documentation added for evidence JSON column
14. ✅ No regressions in core workflows

---

## Rollout Plan

### Phase 1: Update Seed File
1. Run query to get all Cyrillic-unit analytes
2. Convert each unit using the conversion reference table
3. Replace Greek mu with micro sign throughout

### Phase 2: Update Code
1. Update LLM prompt with unit_canonical requirements
2. Update MappingApplier.js with validation logic
3. Update admin routes with approval blocking

### Phase 3: Database Recreation
```bash
lsof -ti:3000 | xargs kill -9
./scripts/recreate_auth_db.sh
npm run dev
```

### Phase 4: Validation
```sql
-- Should return 0 rows (no Cyrillic units)
SELECT code, unit_canonical
FROM analytes
WHERE unit_canonical ~ '[а-яА-Я]';
```

---

## Risks & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Incorrect unit conversion | Wrong units in seed file | Review conversion table carefully; test with medical reference |
| LLM still proposes Cyrillic | Analyte flagged | `needs_unit_correction` flag ensures admin review |
| LLM omits unit_canonical | Falls back to OCR unit | Both paths validated; admin notified via flag |

---

## Future Enhancements (Out of Scope)

1. **Admin Edit UI for Pending Analytes**
   - Add edit form for modifying `unit_canonical` before approval
   - Visual indicator (⚠️ badge) for entries with `needs_unit_correction: true`

2. **Unit Conversion at Query Time**
   - Store all results in canonical units
   - Convert on display (e.g., mg/dL ↔ mmol/L for glucose)

3. **Backfill Lab Results Units**
   - Normalize `lab_results.unit` to match canonical units

---

## References

- UCUM Specification: https://ucum.org
- PRD v4.5: Remove Category Field (prerequisite)
