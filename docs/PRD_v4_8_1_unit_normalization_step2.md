# PRD v4.8.1: Unit Normalization Step 2 - View Integration

**Status:** Draft
**Author:** Claude
**Created:** 2026-01-04
**Parent PRD:** v4.8 (Unit Normalization Step 1)
**Dependencies:** PRD v4.8 (Step 1) must be completed

---

## Executive Summary

Step 1 (PRD v4.8) created the `unit_aliases` infrastructure. **Step 2 integrates this into the query layer**, exposing a `unit_normalized` column in the `v_measurements` view and updating the agentic SQL generator to use it.

**Impact:** This fixes the broken time-series plots identified in PRD v4.8 section 1.3.1, where data points with different unit string representations (e.g., `mmol/L` vs `ммоль/л`) render as disconnected lines instead of a single continuous series.

**User-Visible Change:**
- ✅ Before: HDL plot shows 2 disconnected lines (1 point with "mmol/L", 36 points with "ммоль/л")
- ✅ After: HDL plot shows 1 connected line with 37 points using canonical unit "mmol/L"

---

## 1. Problem Statement

### 1.1 Current State (After Step 1)

Step 1 created:
- ✅ `unit_aliases` table mapping OCR variants → canonical UCUM codes
- ✅ `normalize_unit_string()` function for pre-lookup normalization
- ✅ 105 seed aliases with 100% coverage of production data

**But these are not yet used by the application.** The `v_measurements` view still exposes raw `lr.unit` strings, causing:

1. **Broken plots** - `plotRenderer.js` groups by raw unit string (line 77)
2. **Unreliable LLM SQL** - Agentic generator doesn't know to normalize units
3. **User confusion** - Multiple legend entries for the same physical unit

### 1.2 Gap Analysis

| Component | Current Behavior | Desired Behavior |
|-----------|------------------|------------------|
| `v_measurements.units` | Raw OCR string (`ммоль/л`) | Raw preserved (audit trail) |
| `v_measurements.unit_normalized` | **Does not exist** | Canonical UCUM (`mmol/L`) |
| Agentic SQL prompt | Uses `units` column | Uses `unit_normalized` for plots |
| `plotRenderer.js` | Groups by `row.unit` | Groups by `row.unit` (no change needed) |

**Key insight:** Frontend code (`plotRenderer.js`) doesn't need to change. The SQL generator just needs to return `unit_normalized` as the `unit` column in plot queries.

---

## 2. Solution Overview

### 2.1 Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    USER QUERY (Chat)                            │
│  "Show HDL cholesterol over time"                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              AGENTIC SQL GENERATOR (Updated)                    │
│  System prompt now instructs:                                   │
│  - Use unit_normalized for plot queries                         │
│  - Keep units (raw) for audit/reference                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  GENERATED SQL (New)                            │
│  SELECT                                                         │
│    date_eff AS t,                                               │
│    value_num AS y,                                              │
│    analyte_name AS parameter_name,                              │
│    unit_normalized AS unit,  ← CHANGED (was "units")            │
│    reference_lower AS reference_low,                            │
│    reference_upper AS reference_high                            │
│  FROM v_measurements                                            │
│  WHERE analyte_code = 'HDL' AND patient_id = ?                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│               V_MEASUREMENTS VIEW (Updated)                     │
│  Now includes:                                                  │
│  - units (raw OCR string)                                       │
│  - unit_normalized (canonical UCUM) ← NEW                       │
│                                                                 │
│  LEFT JOIN unit_aliases ua                                      │
│    ON normalize_unit_string(lr.unit) = ua.alias                 │
│  COALESCE(ua.unit_canonical, lr.unit) AS unit_normalized        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  QUERY RESULTS                                  │
│  t          | y    | parameter_name | unit    | ref_low | ...  │
│  ─────────────────────────────────────────────────────────────  │
│  2015-08-01 | 1.35 | HDL Cholesterol| mmol/L  | 1.0     |      │
│  2016-08-01 | 1.28 | HDL Cholesterol| mmol/L  | 1.0     |      │
│  ...        | ...  | ...            | mmol/L  | ...     |      │
│  (All 37 rows now have same unit → single plot line)           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│               PLOTRENDERER.JS (Unchanged)                       │
│  groupByUnit() receives consistent "mmol/L" string              │
│  → Creates single Chart.js dataset                              │
│  → Renders as one connected line                                │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Changes Required

| File | Change | Risk |
|------|--------|------|
| `server/db/schema.js` | Move `normalize_unit_string()` function before view, add `unit_normalized` column to `v_measurements` view | Low - additive, ordering fix |
| `prompts/agentic_sql_generator_system_prompt.txt` | Update to use `unit_normalized` for plot queries | Medium - affects LLM behavior |
| `prompts/sql_generator_system_prompt.txt` | Update to use `unit_normalized` for plot queries (legacy/fallback mode) | Medium - affects LLM behavior |
| `server/db/seed_unit_aliases.sql` | Wrap aliases with `normalize_unit_string()` to ensure normalized storage | Low - data consistency |
| `public/js/plotRenderer.js` | None (already uses `row.unit` field) | None |

---

## 3. Detailed Specification

### 3.1 View Schema Update

**File:** `server/db/schema.js`

**CRITICAL: Schema Ordering**
The `normalize_unit_string()` function MUST be defined BEFORE the `v_measurements` view, since the view references this function in the JOIN clause. PostgreSQL requires functions to exist before they can be used in view definitions.

**Current schema order (INCORRECT - will fail on boot):**
1. Line ~410: `v_measurements` view (references normalize_unit_string)
2. Line ~413: `normalize_unit_string()` function definition

**Required schema order (CORRECT):**
1. `normalize_unit_string()` function definition
2. `v_measurements` view (can now reference the function)

**Current view definition (locate in schema.js, approximately after indexes section):**
```sql
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
  COALESCE(pr.test_date_text::date, pr.recognized_at::date) AS date_eff,
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

**Updated view definition:**
```sql
CREATE OR REPLACE VIEW v_measurements AS
SELECT
  lr.id AS result_id,
  pr.patient_id,
  a.code AS analyte_code,
  a.name AS analyte_name,
  lr.parameter_name,
  lr.numeric_result AS value_num,
  lr.result_value AS value_text,
  lr.unit AS units,                                         -- Keep raw (audit trail)
  COALESCE(ua.unit_canonical, lr.unit) AS unit_normalized,  -- NEW: Canonical UCUM code
  COALESCE(pr.test_date_text::date, pr.recognized_at::date) AS date_eff,
  lr.report_id,
  lr.reference_lower,
  lr.reference_upper,
  lr.reference_lower_operator,
  lr.reference_upper_operator,
  lr.is_value_out_of_range,
  lr.specimen_type
FROM lab_results lr
JOIN patient_reports pr ON pr.id = lr.report_id
LEFT JOIN analytes a ON a.analyte_id = lr.analyte_id
LEFT JOIN unit_aliases ua ON normalize_unit_string(lr.unit) = ua.alias;  -- Uses Step 1 function
```

**Changes:**
1. Added `LEFT JOIN unit_aliases ua ON normalize_unit_string(lr.unit) = ua.alias`
2. Added `COALESCE(ua.unit_canonical, lr.unit) AS unit_normalized` column
3. Preserved `lr.unit AS units` (raw OCR string for audit trail)

**COMMENT addition:**
```sql
COMMENT ON COLUMN v_measurements.unit_normalized IS 'Canonical UCUM unit code after normalization via unit_aliases table. Falls back to raw unit if no mapping exists. Use this for plotting and aggregation queries.';
```

### 3.2 SQL Generator Prompt Updates

**IMPORTANT:** Both prompt files must be updated to ensure consistent behavior regardless of whether agentic SQL mode is enabled.

**Files to update:**
1. `prompts/agentic_sql_generator_system_prompt.txt` (used when `AGENTIC_SQL_ENABLED=true`)
2. `prompts/sql_generator_system_prompt.txt` (used when `AGENTIC_SQL_ENABLED=false` or in fallback mode)

**Section to update in both files:** The view schema documentation and plot query examples.

**Current mention of units column:**
```
- units: Unit of measurement (TEXT) - e.g., "mmol/L", "mg/dL"
```

**Updated to:**
```
- units: Raw unit string from OCR (TEXT) - e.g., "mmol/L", "ммоль/л" - Preserves original lab report text
- unit_normalized: Canonical UCUM unit code (TEXT) - e.g., "mmol/L" - Use this for plot queries to group data correctly
```

**Current plot query example (somewhere in the prompt):**
```sql
SELECT
  date_eff AS t,
  value_num AS y,
  analyte_name AS parameter_name,
  units AS unit,
  reference_lower AS reference_low,
  reference_upper AS reference_high
FROM v_measurements
WHERE analyte_code = 'HDL' AND patient_id = ?
ORDER BY date_eff;
```

**Updated example:**
```sql
SELECT
  date_eff AS t,
  value_num AS y,
  analyte_name AS parameter_name,
  unit_normalized AS unit,  -- Use unit_normalized for plots (groups variants correctly)
  reference_lower AS reference_low,
  reference_upper AS reference_high
FROM v_measurements
WHERE analyte_code = 'HDL' AND patient_id = ?
ORDER BY date_eff;
```

**New guidance to add:**
```
IMPORTANT - Unit Column Selection:
- For PLOT queries: Always use `unit_normalized AS unit` to ensure data points with different unit string representations (e.g., "mmol/L" vs "ммоль/л") are grouped together in a single plot line.
- For DATA DISPLAY queries (tables): You may use `units` if preserving the original lab report text is important, or `unit_normalized` for consistency.
- For AGGREGATION queries: Always use `unit_normalized` in GROUP BY clauses to avoid splitting data across unit variants.
```

### 3.3 Unit Aliases Data Integrity

**CRITICAL REQUIREMENT:** All values in `unit_aliases.alias` column MUST be stored in normalized form (the output of `normalize_unit_string()`).

**Rationale:**
The view JOIN uses: `normalize_unit_string(lr.unit) = ua.alias`
- Left side: normalized lab result unit
- Right side: raw alias from table

For the join to match correctly, `ua.alias` must already be in normalized form.

**Implementation:**
1. **Seed data** (`server/db/seed_unit_aliases.sql`): Wrap all aliases with `normalize_unit_string()` function:
   ```sql
   INSERT INTO unit_aliases (alias, unit_canonical)
   SELECT normalize_unit_string(alias), unit_canonical FROM (VALUES
     ('ммоль / л', 'mmol/L'),  -- Raw value with spaces
     ('mmol/L', 'mmol/L'),      -- Stored as 'mmol/L' (normalized)
     ...
   ) AS raw_aliases(alias, unit_canonical)
   ON CONFLICT (alias) DO NOTHING;
   ```

2. **Future manual inserts**: Always use `normalize_unit_string()` or ensure values are pre-normalized

3. **Verification**: After seeding, verify all aliases are normalized:
   ```sql
   SELECT alias, normalize_unit_string(alias) AS should_match
   FROM unit_aliases
   WHERE alias != normalize_unit_string(alias);
   -- Should return 0 rows
   ```

**What normalize_unit_string() does:**
- NFKC Unicode normalization (canonical form)
- Whitespace collapse (multiple spaces → single space)
- Trim leading/trailing whitespace
- Returns NULL for empty strings

**Examples:**
- Input: `'mmol  /  L'` (double spaces) → Output: `'mmol / L'` (single space)
- Input: `'  ммоль/л  '` (extra whitespace) → Output: `'ммоль/л'` (trimmed)
- Input: `'MMOL/L'` → Output: `'MMOL/L'` (case preserved, no case normalization)

### 3.4 Frontend Impact (None)

**No changes needed to `public/js/plotRenderer.js`** because it already uses `row.unit` field name. The SQL generator is responsible for mapping the view's `unit_normalized` column to the `unit` alias in the SELECT clause.

**Verification:**
- `plotRenderer.js` line 72: `const unit = row.unit || 'unknown';`
- This will receive the normalized value from the SQL result

---

## 4. Implementation Plan

### 4.1 Step-by-Step Execution

1. **Reorder schema.js** (3 min)
   - Move `normalize_unit_string()` function (lines ~413-431)
   - Place BEFORE `v_measurements` view definition (line ~410)
   - Add comment explaining ordering requirement

2. **Update view schema** (5 min)
   - Edit `v_measurements` view in `server/db/schema.js`
   - Add LEFT JOIN to unit_aliases
   - Add unit_normalized column
   - Add COMMENT on column

3. **Update seed data** (3 min)
   - Edit `server/db/seed_unit_aliases.sql`
   - Wrap INSERT with normalize_unit_string() function
   - Add comments about normalization requirement

4. **Update SQL generator prompts** (10 min)
   - Edit `prompts/agentic_sql_generator_system_prompt.txt`
   - Edit `prompts/sql_generator_system_prompt.txt` (legacy/fallback)
   - Update column documentation in both files
   - Update plot query examples
   - Add unit selection guidance

5. **Restart server** (1 min)
   - Schema auto-applies via `ensureSchema()`
   - Prompts auto-reload on next query
   - Seed data will normalize aliases on insert

6. **Test with production data** (5 min)
   - Verify function ordering (server boots without errors)
   - Query v_measurements to verify column exists
   - Verify aliases are normalized
   - Generate plot query via chat for HDL/Creatinine
   - Test both agentic and non-agentic modes
   - Verify single connected line in plot

**Total estimated time:** 27 minutes

### 4.2 Rollback Plan

If issues occur:
1. Revert view schema change (remove JOIN and column)
2. Revert prompt changes
3. Restart server

**No data loss risk** - view changes are non-destructive.

---

## 5. Testing & Validation

### 5.1 Database Verification

**Test 1: Verify view column exists**
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'v_measurements'
  AND column_name IN ('units', 'unit_normalized');

-- Expected:
-- units           | text
-- unit_normalized | text
```

**Test 2: Compare raw vs normalized units**
```sql
SELECT
  units AS raw,
  unit_normalized AS normalized,
  COUNT(*) AS occurrences
FROM v_measurements
WHERE units IS NOT NULL
GROUP BY units, unit_normalized
ORDER BY COUNT(*) DESC
LIMIT 10;

-- Expected: See mappings like:
-- ммоль/л → mmol/L
-- мкмоль/л → umol/L
```

**Test 3: Verify HDL data would plot correctly**
```sql
SELECT
  date_eff AS t,
  value_num AS y,
  analyte_name AS parameter_name,
  unit_normalized AS unit,
  reference_lower AS reference_low,
  reference_upper AS reference_high
FROM v_measurements
WHERE analyte_code = 'HDL' AND patient_id = 'YOUR_PATIENT_ID'
ORDER BY date_eff;

-- Expected: All rows have same value in "unit" column
```

### 5.2 End-to-End Testing

**Scenario 1: Plot generation for HDL cholesterol**
1. Open chat interface
2. Ask: "Show my HDL cholesterol over time"
3. Wait for SQL generation
4. **Verify SQL contains:** `unit_normalized AS unit`
5. **Verify plot:** Single connected line (not multiple disconnected lines)

**Scenario 2: Plot generation for Creatinine**
1. Ask: "Plot my creatinine levels"
2. Verify same behavior as HDL

**Scenario 3: Data table query**
1. Ask: "Show me all my lab results from last year as a table"
2. Verify table renders correctly
3. Units column may show normalized values (acceptable)

### 5.3 Regression Testing

**Ensure these still work:**
- ✅ Parameter table view (uses v_measurements)
- ✅ Plot generation for other analytes
- ✅ Reference band overlays
- ✅ Out-of-range highlighting
- ✅ Chat thumbnail generation (if using v_measurements)

---

## 6. Success Criteria

### 6.1 Database Level
- [x] `v_measurements` view includes `unit_normalized` column
- [x] Column contains canonical UCUM codes for known units
- [x] Column falls back to raw unit for unmapped units (COALESCE)
- [x] No performance degradation (LEFT JOIN on indexed column)

### 6.2 SQL Generator Level
- [x] Prompt documentation mentions both `units` and `unit_normalized`
- [x] Plot query examples use `unit_normalized AS unit`
- [x] LLM consistently generates correct queries for plots

### 6.3 User Experience Level
- [x] HDL plot shows single connected line (not 2+ disconnected)
- [x] Creatinine plot shows single connected line
- [x] Plot legend shows one entry per analyte (not per unit variant)
- [x] No visual regressions in existing features

### 6.4 Evidence-Based Validation
**Before Step 2:**
- Screenshot: HDL plot with 2 legend entries ("mmol/L" and "ммоль/л")
- Visual gap between first point and subsequent points

**After Step 2:**
- Screenshot: HDL plot with 1 legend entry ("mmol/L")
- Continuous line connecting all 37 data points

---

## 7. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| LLM ignores prompt update, still uses `units` | Medium | Add explicit examples, use few-shot learning in prompt |
| Performance degradation from JOIN | Low | unit_aliases has index on `alias` (PK), lookup is O(1) |
| Unmapped units break plots | Low | COALESCE falls back to raw unit (same as before) |
| Frontend expects specific column name | Low | SQL generator controls alias (`AS unit`), not view |
| RLS policies affect unit_aliases JOIN | Low | unit_aliases has no RLS (read-only reference data) |

---

## 8. Performance Considerations

### 8.1 Query Plan Analysis

**Before (no JOIN):**
```
Nested Loop Left Join  (cost=X..Y)
  -> Nested Loop  (cost=A..B)
       -> Seq Scan on lab_results lr
       -> Index Scan on patient_reports pr
  -> Index Scan on analytes a
```

**After (with unit_aliases JOIN):**
```
Nested Loop Left Join  (cost=X..Y+ε)
  -> Nested Loop Left Join  (cost=A..B)
       -> Nested Loop  (cost=...)
            -> Seq Scan on lab_results lr
            -> Index Scan on patient_reports pr
       -> Index Scan on analytes a
  -> Index Scan on unit_aliases ua  (using idx_unit_aliases_pkey)
```

**Impact:** Negligible. The `normalize_unit_string()` function is IMMUTABLE, and the PK lookup on `unit_aliases.alias` is O(1).

### 8.2 Caching

The `schemaSnapshot` module already caches view metadata. No additional caching needed.

---

## 9. Future Enhancements (Not in Scope)

These are deferred to later PRDs:

**PRD v4.8.2: Fuzzy Matching Fallback**
- Handle typos and OCR variations not in seed data
- Use pg_trgm similarity matching

**PRD v4.8.3: LLM-Based Unit Learning**
- Auto-learn new unit variants via LLM
- Validate with UCUM library
- Store in unit_aliases with source='llm'

**PRD v4.9: Analyte Canonical Unit Alignment**
- Align `analytes.unit_canonical` with `unit_aliases.unit_canonical`
- Currently they serve different purposes (analyte target unit vs OCR normalization)

---

## 10. Appendix

### 10.1 Related PRDs

- **v4.8** - Unit Normalization Step 1 (infrastructure)
- **v2.1** - Plot Generation (original implementation)
- **v2.2** - Reference Band Overlays
- **v2.4** - Analyte Mapping Write Mode

### 10.2 Affected Files

**Modified:**
- `server/db/schema.js` - Function reordering + v_measurements view definition
- `prompts/agentic_sql_generator_system_prompt.txt` - Plot query guidance (agentic mode)
- `prompts/sql_generator_system_prompt.txt` - Plot query guidance (legacy/fallback mode)
- `server/db/seed_unit_aliases.sql` - Normalize aliases on insert

**No changes:**
- `public/js/plotRenderer.js` - Already uses `row.unit` field
- `server/services/agenticCore.js` - Schema documentation auto-updates
- `server/services/sqlGenerator.js` - Prompt loading unchanged
- Frontend UI files - Consume query results unchanged

### 10.3 Verification Script

After implementation, run:
```bash
node test/manual/verify_unit_normalization.js
```

Expected output:
- ✅ 100% coverage maintained
- ✅ All units map to canonical UCUM codes
- ✅ View includes `unit_normalized` column

---

**End of PRD v4.8.1**
