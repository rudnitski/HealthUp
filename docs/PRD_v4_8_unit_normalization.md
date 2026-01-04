# PRD v4.8: Unit Normalization for Lab Results

**Status:** Draft
**Author:** Claude
**Created:** 2026-01-04
**Target Location:** `docs/PRD_v4_8_unit_normalization.md`
**Related PRDs:** v2.1 (Plot Generation), v2.4 (Analyte Mapping)

---

## Executive Summary

HealthUp ingests lab reports from multiple sources (different countries, labs, languages). The same measurement unit can have different string representations in OCR output (e.g., `mmol/L` vs `ммоль/л` for millimoles per liter). Currently, the system treats these as different units, causing **visual gaps in time-series plots** and **unreliable LLM calculations**.

This PRD introduces a **unit alias lookup table** that maps OCR unit variations to canonical UCUM (Unified Code for Units of Measure) codes, enabling consistent grouping and computation.

---

## 1. Problem Statement

### 1.1 Background: How Lab Data Flows

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Lab Report    │────▶│    OCR/Vision   │────▶│   lab_results   │
│   (PDF/Image)   │     │    Extraction   │     │     table       │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                        │
        Unit string preserved exactly as OCR'd          │
        e.g., "ммоль/л" from Russian lab               │
              "mmol/L" from English lab                 │
                                                        ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│    Frontend     │◀────│  SQL Generator  │◀────│  v_measurements │
│   Plot/Table    │     │   (Agentic)     │     │      view       │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │
        │  plotRenderer.js groups data by unit string
        │  Different strings = different series = GAPS
        ▼
┌─────────────────────────────────────────────────────────────────┐
│  Chart shows TWO disconnected lines:                            │
│  • "Results (mmol/L)" - 1 point                                 │
│  • "Results (ммоль/л)" - 36 points                              │
│  Instead of ONE connected line with 37 points                   │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Current Behavior

Lab reports from different sources use different string representations for the **same unit**:

| Source | Unit String | Meaning |
|--------|-------------|---------|
| Russian lab | `ммоль/л` | millimoles per liter |
| English lab | `mmol/L` | millimoles per liter |
| Case variation | `mmol/l` | millimoles per liter |
| Russian lab | `мкмоль/л` | micromoles per liter |
| English lab | `μmol/L` | micromoles per liter |

All of these represent the **same physical unit** but are stored as different strings.

### 1.3 Impact

#### 1.3.1 Broken Time-Series Plots

**File:** `public/js/plotRenderer.js`
**Function:** `groupByUnit()` (lines 68-164)

```javascript
// Line 77: Groups by EXACT string match
const unit = row.unit || 'unknown';

// Line 93: Each unique string becomes a separate group
if (!groups[unit]) {
  groups[unit] = { measurements: [], referenceBand: [], outOfRangePoints: [] };
}
```

**Result:** Data points with `mmol/L` and `ммоль/л` become separate Chart.js datasets, rendering as disconnected lines.

#### 1.3.2 Unreliable LLM Calculations

The agentic SQL assistant cannot safely aggregate or compare measurements when unit strings differ:

```sql
-- LLM generates this query for "average HDL cholesterol"
SELECT AVG(numeric_result), unit
FROM lab_results lr
JOIN analytes a ON lr.analyte_id = a.analyte_id
WHERE a.code = 'HDL'
GROUP BY unit;

-- Returns TWO rows instead of ONE:
--   1.35  | mmol/L    (1 measurement)
--   1.28  | ммоль/л   (36 measurements)
```

#### 1.3.3 User Confusion

Plot legend displays multiple entries for the same unit:
- "Results (mmol/L)"
- "Results (ммоль/л)"
- "Healthy range (mmol/L)"
- "Healthy range (ммоль/л)"

### 1.4 Evidence from Production

Screenshots from 2026-01-04 show:

**HDL Cholesterol:**
- First data point (Aug 2015): `mmol/L`
- All subsequent points (Aug 2016 - Nov 2025): `ммоль/л`
- Visual: Two separate colored lines with gap between first and second point

**Creatinine:**
- First data point (Aug 2015): `μmol/L`
- All subsequent points: `мкмоль/л`
- Visual: Same disconnection issue

### 1.5 Root Cause Analysis

| Component | Current Behavior | Problem |
|-----------|------------------|---------|
| `lab_results.unit` | Stores raw OCR string | By design (audit trail) - OK |
| `v_measurements` view | Exposes `lr.unit AS units` | No normalization |
| SQL generator prompt | Uses `unit` column directly | No normalization |
| `plotRenderer.js` | Groups by raw unit string | Treats variants as different |
| **Missing** | Unit normalization layer | No mapping exists |

### 1.6 Design Decision: Why Not Normalize at OCR Time?

We intentionally preserve raw OCR strings for:
1. **Audit trail** - See exactly what the lab report said
2. **Debugging** - Identify OCR errors
3. **Flexibility** - Can update normalization rules without re-processing

**Solution:** Add a normalization **lookup layer** that maps raw → canonical at query time.

---

## 2. Solution Overview

### 2.1 Industry Standards

#### UCUM (Unified Code for Units of Measure)

UCUM is the healthcare industry standard for representing measurement units unambiguously. It provides:
- Canonical string representations (e.g., `mmol/L` not `mmol/l` or `mMol/L`)
- Dimensional analysis for unit conversion
- Validation of unit expressions

**Reference:** https://ucum.org/

#### Existing Tools We Can Leverage

| Tool | npm Package | Purpose |
|------|-------------|---------|
| UCUM-LHC | `@lhncbc/ucum-lhc` | Unit validation + conversion |
| LOINC Validator | `loinc-mapping-validator` | Has some unit alias mappings |
| PubChem API | REST | Molecular weights for mass↔molar conversion |

**Note:** None of these handle Cyrillic unit strings. We must build that mapping ourselves.

### 2.2 Approach: Dual Storage with Lookup Table

```
┌─────────────────────────────────────────────────────────────────┐
│                    DATA STORAGE (Unchanged)                     │
│  lab_results.unit = "ммоль/л"     ← Raw OCR (audit trail)       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    NORMALIZATION LAYER (New)                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   unit_aliases table                     │   │
│  │  alias (PK)          │  unit_canonical                   │   │
│  │  ─────────────────────────────────────────────────────── │   │
│  │  "ммоль/л"           │  "mmol/L"                         │   │
│  │  "mmol/L"            │  "mmol/L"                         │   │
│  │  "mmol/l"            │  "mmol/L"                         │   │
│  │  "мкмоль/л"          │  "μmol/L"                         │   │
│  │  ...                 │  ...                              │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    QUERY LAYER (Updated)                        │
│  v_measurements view joins unit_aliases:                        │
│  COALESCE(ua.unit_canonical, lr.unit) AS unit_normalized        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    FRONTEND (Unchanged)                         │
│  plotRenderer.js groups by unit_normalized                      │
│  → All points with same physical unit → ONE connected line      │
└─────────────────────────────────────────────────────────────────┘
```

### 2.3 Implementation Phases

This PRD covers **Step 1 only**. Future steps are documented for continuity.

| Phase | Scope | Risk | Effort | Dependencies |
|-------|-------|------|--------|--------------|
| **Step 1** | Alias table + seed data + test queries | None | 1 hour | None |
| Step 2 | Update v_measurements view + SQL prompt | Low | 30 min | Step 1 |
| Step 3 | Add fuzzy matching fallback (pg_trgm) | Low | 2 hours | Step 1 |
| Step 4 | Add LLM fallback for unknowns | Medium | 4 hours | Step 3, OpenAI |

### 2.4 Why This Phased Approach?

1. **Step 1 alone fixes 90%+ of issues** - Most unit variants are predictable Cyrillic/Latin pairs
2. **Zero risk** - Additive change, no existing code modified
3. **Immediately testable** - Simple SQL queries validate the mapping
4. **Incremental value** - Each step delivers independently

---

## 3. Step 1: Unit Alias Table (THIS PRD)

### 3.1 Scope

- Create `unit_aliases` table
- Seed with known Cyrillic ↔ UCUM mappings
- Validate with test queries
- **No changes to existing code/views**

### 3.2 Schema

```sql
CREATE TABLE IF NOT EXISTS unit_aliases (
  alias TEXT PRIMARY KEY,
  unit_canonical TEXT NOT NULL,
  source TEXT DEFAULT 'manual',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_unit_aliases_canonical ON unit_aliases(unit_canonical);

COMMENT ON TABLE unit_aliases IS 'Maps OCR unit string variations to canonical UCUM codes';
COMMENT ON COLUMN unit_aliases.alias IS 'Raw unit string from OCR (e.g., "ммоль/л")';
COMMENT ON COLUMN unit_aliases.unit_canonical IS 'Normalized UCUM code (e.g., "mmol/L")';
COMMENT ON COLUMN unit_aliases.source IS 'Origin: manual, fuzzy, llm';
```

### 3.3 Seed Data

Based on actual data in the system and common variations:

```sql
INSERT INTO unit_aliases (alias, unit_canonical) VALUES
  -- Molar concentration (mmol/L)
  ('ммоль/л', 'mmol/L'),
  ('mmol/L', 'mmol/L'),
  ('mmol/l', 'mmol/L'),
  ('мМоль/л', 'mmol/L'),
  ('ммоль/литр', 'mmol/L'),

  -- Micromolar (μmol/L)
  ('мкмоль/л', 'μmol/L'),
  ('μmol/L', 'μmol/L'),
  ('umol/L', 'μmol/L'),
  ('umol/l', 'μmol/L'),
  ('мкмоль/литр', 'μmol/L'),

  -- Nanomolar (nmol/L)
  ('нмоль/л', 'nmol/L'),
  ('nmol/L', 'nmol/L'),
  ('nmol/l', 'nmol/L'),

  -- Picomolar (pmol/L)
  ('пмоль/л', 'pmol/L'),
  ('pmol/L', 'pmol/L'),
  ('pmol/l', 'pmol/L'),

  -- Mass concentration - mg/dL
  ('мг/дл', 'mg/dL'),
  ('mg/dL', 'mg/dL'),
  ('mg/dl', 'mg/dL'),

  -- Mass concentration - g/L
  ('г/л', 'g/L'),
  ('g/L', 'g/L'),
  ('g/l', 'g/L'),
  ('гр/л', 'g/L'),

  -- Mass concentration - g/dL
  ('г/дл', 'g/dL'),
  ('g/dL', 'g/dL'),
  ('g/dl', 'g/dL'),

  -- Mass concentration - mg/L
  ('мг/л', 'mg/L'),
  ('mg/L', 'mg/L'),
  ('mg/l', 'mg/L'),

  -- Microgram per liter (μg/L)
  ('мкг/л', 'μg/L'),
  ('μg/L', 'μg/L'),
  ('ug/L', 'μg/L'),
  ('ug/l', 'μg/L'),
  ('мкг/дл', 'μg/dL'),

  -- Nanogram per milliliter (ng/mL)
  ('нг/мл', 'ng/mL'),
  ('ng/mL', 'ng/mL'),
  ('ng/ml', 'ng/mL'),

  -- Picogram per milliliter (pg/mL)
  ('пг/мл', 'pg/mL'),
  ('pg/mL', 'pg/mL'),
  ('pg/ml', 'pg/mL'),

  -- Enzyme units (U/L)
  ('Ед/л', 'U/L'),
  ('ед/л', 'U/L'),
  ('U/L', 'U/L'),
  ('u/l', 'U/L'),
  ('ЕД/л', 'U/L'),

  -- International units
  ('МЕ/л', 'IU/L'),
  ('IU/L', 'IU/L'),
  ('мМЕ/л', 'mIU/L'),
  ('mIU/L', 'mIU/L'),
  ('мкМЕ/мл', 'μIU/mL'),
  ('uIU/mL', 'μIU/mL'),
  ('μIU/mL', 'μIU/mL'),

  -- Cell counts
  ('10^9/л', '10^9/L'),
  ('×10^9/л', '10^9/L'),
  ('10*9/L', '10^9/L'),
  ('тыс/мкл', '10^9/L'),
  ('10^12/л', '10^12/L'),
  ('×10^12/л', '10^12/L'),
  ('10*12/L', '10^12/L'),
  ('млн/мкл', '10^12/L'),

  -- Volume units
  ('фл', 'fL'),
  ('fL', 'fL'),
  ('fl', 'fL'),

  -- Mass units
  ('пг', 'pg'),
  ('pg', 'pg'),

  -- Percentage
  ('%', '%'),
  ('процент', '%'),
  ('проц.', '%'),

  -- Permille
  ('‰', '‰'),
  ('промилле', '‰'),

  -- Time-based
  ('мм/час', 'mm/h'),
  ('мм/ч', 'mm/h'),
  ('mm/h', 'mm/h'),
  ('mm/hr', 'mm/h'),

  -- Osmolality
  ('мОсм/кг', 'mOsm/kg'),
  ('mOsm/kg', 'mOsm/kg')
ON CONFLICT (alias) DO NOTHING;
```

### 3.4 Test Queries

**Test 1: Verify alias table populated**
```sql
SELECT COUNT(*) as total_aliases,
       COUNT(DISTINCT unit_canonical) as unique_canonical
FROM unit_aliases;
```

**Test 2: Check HDL data normalization**
```sql
SELECT
  lr.parameter_name,
  pr.test_date_text,
  lr.numeric_result,
  lr.unit AS unit_raw,
  COALESCE(ua.unit_canonical, lr.unit) AS unit_normalized,
  CASE WHEN ua.unit_canonical IS NOT NULL THEN 'mapped' ELSE 'UNMAPPED' END AS status
FROM lab_results lr
JOIN patient_reports pr ON pr.id = lr.report_id
LEFT JOIN analytes a ON lr.analyte_id = a.analyte_id
LEFT JOIN unit_aliases ua ON lr.unit = ua.alias
WHERE a.code = 'HDL'
ORDER BY pr.test_date_text;
```

**Test 3: Check Creatinine data normalization**
```sql
SELECT
  lr.parameter_name,
  pr.test_date_text,
  lr.numeric_result,
  lr.unit AS unit_raw,
  COALESCE(ua.unit_canonical, lr.unit) AS unit_normalized,
  CASE WHEN ua.unit_canonical IS NOT NULL THEN 'mapped' ELSE 'UNMAPPED' END AS status
FROM lab_results lr
JOIN patient_reports pr ON pr.id = lr.report_id
LEFT JOIN analytes a ON lr.analyte_id = a.analyte_id
LEFT JOIN unit_aliases ua ON lr.unit = ua.alias
WHERE a.code = 'CREA'
ORDER BY pr.test_date_text;
```

**Test 4: Find unmapped units (gaps in coverage)**
```sql
SELECT
  lr.unit,
  COUNT(*) as occurrences
FROM lab_results lr
LEFT JOIN unit_aliases ua ON lr.unit = ua.alias
WHERE ua.alias IS NULL
  AND lr.unit IS NOT NULL
  AND lr.unit != ''
GROUP BY lr.unit
ORDER BY occurrences DESC;
```

### 3.5 Success Criteria

1. All HDL records show same `unit_normalized` value
2. All Creatinine records show same `unit_normalized` value
3. Test 4 returns few/no unmapped units for common analytes
4. No changes to existing application behavior

### 3.6 Files to Modify

| File | Change |
|------|--------|
| `server/db/schema.js` | Add `unit_aliases` table DDL |
| `server/db/seed_unit_aliases.sql` | New file with INSERT statements |

---

## 4. Future Steps (Reference)

These steps are documented here for continuity. Each will have its own PRD when implemented.

### Step 2: Update v_measurements View (PRD v4.8.1)

**Goal:** Expose `unit_normalized` in the view so SQL generator and LLM can use it.

**Scope:**
1. Modify `v_measurements` view to JOIN `unit_aliases`
2. Update SQL generator system prompt to use `unit_normalized` for plot queries
3. Verify plots show single connected line

**Schema Change:**
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
  lr.unit AS units,                                         -- Keep raw
  COALESCE(ua.unit_canonical, lr.unit) AS unit_normalized,  -- NEW
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
LEFT JOIN unit_aliases ua ON lr.unit = ua.alias;            -- NEW JOIN
```

**Prompt Update (prompts/agentic_sql_generator_system_prompt.txt):**
```
Change: "lr.unit" → "COALESCE(ua.unit_canonical, lr.unit) AS unit"
Or use: "unit_normalized" from v_measurements view
```

**Files to Modify:**
- `server/db/schema.js` - Update view DDL
- `prompts/agentic_sql_generator_system_prompt.txt` - Update SQL examples

---

### Step 3: Fuzzy Matching Fallback (PRD v4.8.2)

**Goal:** Handle typos and variations not in alias table automatically.

**Example:** User uploads lab with `ммоль / л` (spaces) - not exact match but clearly `mmol/L`.

**Implementation:**
```sql
-- Add trigram index for fuzzy matching
CREATE INDEX idx_unit_aliases_trgm ON unit_aliases
USING gin (alias gin_trgm_ops);

-- Fuzzy lookup function
CREATE OR REPLACE FUNCTION normalize_unit(raw_unit TEXT)
RETURNS TEXT AS $$
DECLARE
  result TEXT;
BEGIN
  -- Tier A: Exact match (fast path)
  SELECT unit_canonical INTO result
  FROM unit_aliases WHERE alias = raw_unit;
  IF result IS NOT NULL THEN RETURN result; END IF;

  -- Tier B: Fuzzy match (similarity threshold 0.6)
  SELECT unit_canonical INTO result
  FROM unit_aliases
  WHERE alias % raw_unit
  ORDER BY similarity(alias, raw_unit) DESC
  LIMIT 1;

  RETURN COALESCE(result, raw_unit);
END;
$$ LANGUAGE plpgsql STABLE;
```

**Files to Modify:**
- `server/db/schema.js` - Add function DDL
- Possibly update view to use function

---

### Step 4: LLM Fallback for Unknown Units (PRD v4.8.3)

**Goal:** Self-learning system - when new unit variant encountered, ask LLM to normalize it, then store the mapping for future use.

**Flow:**
```
New lab uploaded with unit "мкмоль на литр"
           │
           ▼
┌─────────────────────────────────────────┐
│ Tier A: Exact lookup                    │
│ SELECT FROM unit_aliases WHERE alias=?  │
│ Result: NOT FOUND                       │
└─────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────┐
│ Tier B: Fuzzy lookup (pg_trgm)          │
│ SELECT FROM unit_aliases WHERE alias %? │
│ Result: similarity < 0.6 - NOT FOUND    │
└─────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────┐
│ Tier C: LLM Normalization               │
│ Prompt: "Normalize 'мкмоль на литр'"    │
│ Response: "umol/L"                      │
│                                         │
│ Validate with UCUM library              │
│ If valid: INSERT INTO unit_aliases      │
└─────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────┐
│ LEARNED: Next time "мкмоль на литр"     │
│ appears, Tier A returns instantly       │
└─────────────────────────────────────────┘
```

**Implementation Sketch:**
```javascript
// server/services/UnitNormalizer.js

import ucumPkg from '@lhncbc/ucum-lhc';
const ucumUtils = ucumPkg.UcumLhcUtils.getInstance();

async function normalizeUnit(rawUnit, analyteCode = null) {
  // Tier A: Exact lookup
  const exact = await db.query(
    'SELECT unit_canonical FROM unit_aliases WHERE alias = $1',
    [rawUnit]
  );
  if (exact.rows[0]) return exact.rows[0].unit_canonical;

  // Tier B: Fuzzy lookup
  const fuzzy = await db.query(
    `SELECT unit_canonical, similarity(alias, $1) as sim
     FROM unit_aliases WHERE alias % $1
     ORDER BY sim DESC LIMIT 1`,
    [rawUnit]
  );
  if (fuzzy.rows[0]?.sim > 0.6) return fuzzy.rows[0].unit_canonical;

  // Tier C: LLM normalization
  const prompt = `Normalize this medical unit to UCUM standard.
Input: "${rawUnit}"
Context: ${analyteCode ? `Unit for ${analyteCode}` : 'Medical lab test unit'}
Return ONLY the UCUM code, nothing else.
Examples: "ммоль/л" → "mmol/L", "нг/мл" → "ng/mL", "мкмоль на литр" → "umol/L"`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 20,
    temperature: 0
  });

  const normalized = response.choices[0].message.content.trim();

  // Validate with UCUM library
  const validation = ucumUtils.validateUnitString(normalized);
  if (validation.status === 'valid') {
    // Learn: Add to alias table for future
    await db.query(
      `INSERT INTO unit_aliases (alias, unit_canonical, source)
       VALUES ($1, $2, 'llm') ON CONFLICT DO NOTHING`,
      [rawUnit, normalized]
    );
    logger.info({ rawUnit, normalized, source: 'llm' }, 'Learned new unit alias');
    return normalized;
  }

  // Fallback: return raw (will be flagged in monitoring)
  logger.warn({ rawUnit, llmSuggestion: normalized }, 'LLM unit normalization failed UCUM validation');
  return rawUnit;
}
```

**Dependencies:**
- `npm install @lhncbc/ucum-lhc` - UCUM validation
- OpenAI API access (already configured)

**Files to Create/Modify:**
- `server/services/UnitNormalizer.js` - New service
- `server/services/labReportProcessor.js` - Call normalizer during OCR processing
- `package.json` - Add ucum-lhc dependency

---

## 5. Dependencies

### Step 1 (This PRD)
- None - additive change only

### Future Steps
- Step 2: Requires Step 1
- Step 3: Requires `pg_trgm` extension (already enabled)
- Step 4: Requires `@lhncbc/ucum-lhc` npm package, OpenAI API

---

## 6. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Missing aliases | Test query 4 identifies gaps; add incrementally |
| Wrong canonical form | Use UCUM standard; validate with ucum-lhc |
| Performance impact | Index on alias column; JOIN is O(1) |
| Breaking existing queries | Step 1 is additive; no existing code changes |

---

## 7. Success Metrics

### Step 1
- [ ] `unit_aliases` table created
- [ ] All test queries pass
- [ ] <5 unmapped units for common analytes

### Overall (After Step 2)
- [ ] HDL plot shows single connected line
- [ ] Creatinine plot shows single connected line
- [ ] LLM can safely aggregate measurements
