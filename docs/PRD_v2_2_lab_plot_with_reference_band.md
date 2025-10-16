# PRD: Historical Lab Plots with Adaptive Reference Band (Schema-Aware, v2.4)

## Goal
When a user asks for a graph of a lab test over time (e.g., “покажи, как менялся витамин D”), the system should display a time-series plot of their results with a **reference range band** derived directly from the lab data already stored in the database.  
The band may be two-sided (lower & upper limits) or one-sided (only lower or upper). Out-of-range values are visually highlighted.

---

## Scope
### In Scope (MVP)
- Automatic intent detection between **plot** vs **table** requests.  
- Time-series visualization for a **single test/analyte** over time.  
- Reference band rendered using per-row lab range fields already stored in the DB.  
- Support for **one-sided** and **two-sided** ranges.  
- Highlighting of out-of-range points based on stored flags.  
- Unit handling at display level (no conversions).  
- Use of existing patient age/gender snapshots without recalculation.

### Out of Scope (for later)
- Canonical analyte IDs or global reference tables.  
- Unit normalization or conversion.  
- Global “healthy male” standards.  
- Multi-analyte overlays or comparative plots.  
- Interactive clarification for ambiguous queries.  
- Caching, aggregation, or optimization beyond the MVP.

---

## Data Sources (existing schema)

| Table | Key Fields | Purpose |
|--------|-------------|----------|
| `lab_results` | `numeric_result`, `unit`, `reference_lower`, `reference_lower_operator`, `reference_upper`, `reference_upper_operator`, `reference_text`, `reference_full_text`, `is_value_out_of_range` | Measurement value, unit, range boundaries with comparison operators |
| `patient_reports` | `recognized_at`, `test_date_text`, `patient_age_snapshot`, `patient_gender_snapshot` | Date (X-axis), optional age/gender context |
| `patients` | `full_name`, `date_of_birth`, `gender` | Patient context (not recalculated) |

---

## Implementation Architecture

### SQL Generation Approach
The system uses an **agentic LLM-powered SQL generator** (when `AGENTIC_SQL_ENABLED='true'`) that:
- Receives the user's natural language question in any supported language (English, Russian, etc.)
- Iteratively explores the database schema using specialized tools:
  - `fuzzy_search_parameter_names` — finds lab parameter names using PostgreSQL trigram similarity
  - `fuzzy_search_analyte_names` — searches canonical analyte codes
  - `execute_exploratory_sql` — runs limited read-only exploration queries
  - `generate_final_query` — produces the final validated SQL with intent metadata
- Automatically detects plot intent and generates time-series SQL with proper column structure
- Returns `query_type`, `plot_metadata`, and the executable SQL query

### SQL Validation
All generated SQL passes through validation checks:
- Read-only enforcement (SELECT/WITH only)
- Forbidden keyword blocking
- Plot-specific validation: requires `t` and `y` columns, `ORDER BY t`, proper type casting
- EXPLAIN plan analysis for safety
- LIMIT clause enforcement (max 5000 rows)

### Query Execution
The validated SQL is executed via `/api/execute-sql` endpoint:
- 30-second query timeout
- Connection pooling with proper resource management
- Returns rows, field metadata, and execution duration

### Data Sources
Queries directly join `lab_results` and `patient_reports` tables rather than using the `v_measurements` view, because:
- Direct queries provide access to reference range fields not included in the view
- LLM can customize timestamp handling (`test_date_text` vs `recognized_at`)
- More flexibility for value sanitization patterns

---

## Behavior

### 1. Intent Decision
- The LLM-powered agentic SQL generator automatically detects whether the user is requesting a **graph** or **table** based on natural language understanding.
- Plot intent is triggered by keywords and semantic analysis: "график", "динамика", "изменение", "trend", "plot", "over time", "как менялся", "покажи график", "chart".
- When plot intent is detected, the LLM sets `query_type='plot_query'` in the final query response.
- Default to `data_query` (table) when unclear.
- No interactive clarification in MVP.

### 2. Plot Composition
For the selected test:
- **Result line** — chronological numeric measurements.  
- **Reference band** — shaded area between the per-point lower and upper reference bounds (from lab data).  
- **Out-of-range points** — highlighted using stored `is_value_out_of_range`.  
- **Unit handling** — separate visual series if units differ; no conversions.  
- **Tooltips** — show date, value, unit, and the range applicable to that test date. Optionally display the stored age/gender snapshot.  
- **Ordering** — always by test date ascending.

### 3. One-Sided Range Logic
Some tests have only one limit (e.g., "> 30 nmol/L" or "< 200 mg/dL"). The `reference_lower_operator` and `reference_upper_operator` fields store comparison operators (e.g., `>`, `>=`, `<`, `<=`, `=`) which affect range interpretation. Display rules:

| Range Type | Visualization | Out-of-Range Condition | Tooltip Example |
|-------------|---------------|------------------------|-----------------|
| **Only lower bound** | Shaded band extending upward from lower limit. Operator affects boundary inclusivity. | `value < lower` (or `<=` if operator is `>`) | "Healthy ≥ 30 nmol/L" |
| **Only upper bound** | Shaded band extending downward from upper limit. Operator affects boundary inclusivity. | `value > upper` (or `>=` if operator is `<`) | "Healthy ≤ 200 mg/dL" |
| **Both bounds** | Standard shaded band between lower and upper limits. | Outside range | "Healthy 50–125 nmol/L" |
| **No bounds** | No band; display result line only; show "no reference range" note. | — | — |

Mixed availability over time → render the band per-point as data allows (no interpolation).

### 4. Patient Scope
- For MVP, queries return all patient data from the database without per-patient filtering.
- The system displays all lab results across all patients in the database.
- Future improvement: context-based filtering or row-level security (RLS) for multi-tenant deployments.

---

## UX & Display Guidelines
- The band should be **subtle**, low-contrast (approximately 25% opacity).
- The result line remains visually dominant.
- Out-of-range points are distinct via color and size.
- Tooltips always show the numeric range plus unit.
- Mobile-friendly layout with adaptive scaling of Y-axis to include all data and bands.
- Legend includes "Healthy range (lab)" and "Your results".
- Accessibility: use both color and shape cues for outliers to meet accessibility standards.

---

## Error & Edge Handling
- **No data points:** display "No results found for this test."
- **Missing one or both bounds:** follow one-sided rules or hide the band.
- **Mixed units:** render separate lines per unit.
- **Extreme values:** always visible (no clipping).
- **Non-numeric results:** skip them for plotting; still visible in data table view.
- **SQL generation errors:** return error message to user with explanation.

---

## Data Validity Rules
- Include only results with numeric values in `numeric_result`.
- Exclude or flag rows where both reference bounds are null.
- Never infer or interpolate missing bounds.
- If both bounds present but reversed (upper less than lower), ignore the band for that point.

---

## SQL Query Output Contract
For plot-type requests, the LLM-generated SQL query must return structured data with these columns:

**Required columns:**
- `t` — Unix timestamp in milliseconds (bigint) from `EXTRACT(EPOCH FROM timestamp)::bigint * 1000`
- `y` — numeric measurement value (numeric), sanitized from `result_value`
- `unit` — measurement unit (text)

**Optional columns for reference bands:**
- `reference_lower` — lower reference bound (numeric, nullable)
- `reference_lower_operator` — comparison operator for lower bound (text, nullable)
- `reference_upper` — upper reference bound (numeric, nullable)
- `reference_upper_operator` — comparison operator for upper bound (text, nullable)
- `is_out_of_range` — pre-computed out-of-range flag (boolean, nullable)

**Context columns (optional):**
- `patient_age_snapshot` — age at test time (text, nullable)
- `patient_gender_snapshot` — gender at test time (text, nullable)

The SQL must include:
- `ORDER BY t ASC` for chronological ordering
- Filtering of non-numeric values using regex patterns
- LIMIT clause (max 5000 points for performance)

Response metadata includes `query_type='plot_query'` and `plot_metadata` with axis mappings.

### Example SQL Query for Plot with Reference Bands

```sql
WITH sanitized AS (
  SELECT
    COALESCE(pr.test_date_text::timestamp, pr.recognized_at) AS test_date,
    lr.unit,
    lr.reference_lower,
    lr.reference_lower_operator,
    lr.reference_upper,
    lr.reference_upper_operator,
    lr.is_value_out_of_range,
    regexp_replace(lr.result_value, '^[<>≤≥]\s*', '', 'g') AS cleaned
  FROM lab_results lr
  JOIN patient_reports pr ON pr.id = lr.report_id
  WHERE lr.parameter_name % 'витамин D'
)
SELECT
  EXTRACT(EPOCH FROM test_date)::bigint * 1000 AS t,
  NULLIF(
    regexp_replace(
      regexp_replace(cleaned, ',', '.', 'g'),
      '\s*[A-Za-zА-Яа-я/*+_-]+$', '', 'g'
    ),
    ''
  )::numeric AS y,
  unit,
  reference_lower,
  reference_lower_operator,
  reference_upper,
  reference_upper_operator,
  is_value_out_of_range
FROM sanitized
WHERE NULLIF(
  regexp_replace(
    regexp_replace(cleaned, ',', '.', 'g'),
    '\s*[A-Za-zА-Яа-я/*+_-]+$', '', 'g'
  ),
  ''
) IS NOT NULL AND cleaned ~ '^-?[0-9]'
ORDER BY t ASC
LIMIT 5000;
```

This query:
- Uses fuzzy text matching (`%` operator) to find parameter names
- Sanitizes values that contain comparison operators, Russian decimal commas, and trailing text
- Extracts Unix timestamps in milliseconds for the X-axis
- Returns reference bounds and operators for band rendering
- Filters out non-numeric values
- Orders chronologically with performance limit

---

## UX Behavior Summary

| Scenario | Expected Visualization |
|-----------|------------------------|
| Normal two-sided range | Shaded band between lower/upper bounds + result line |
| Only lower bound | Shaded band extending upward from lower limit + result line |
| Only upper bound | Shaded band extending downward from upper limit + result line |
| No bounds | Only result line, notice "no reference range" |
| Mixed per test | Each segment shows whatever bounds are available |

---

## Performance Targets
- End-to-end response: less than 15 seconds for typical user query.
- Rendering: maintain smooth performance for up to 5,000 data points.
- Only one database query per plot (all values plus bounds returned together).
- SQL generation with agentic loop: typically completes within 5-10 seconds.

---

## Success Criteria
| Metric | Target |
|--------|---------|
| Accurate visualization of lab range per test | 98% or higher |
| Tooltip correctness (value plus range) | 95% or higher |
| Average latency (data plus plot render) | Less than 15 seconds |
| User clarity ("understand if within range") | 80% or higher positive feedback |

---

## Implementation Requirements

### Critical Issues to Address

#### 1. Reference Band Rendering [HIGH PRIORITY]
**Current State:** plotRenderer.js only renders measurement datasets without reference bands. The renderer explicitly disables fills (`fill: false`) and creates single dataset per unit.

**Required Implementation:**

**File:** `public/js/plotRenderer.js`

1. **Update `groupByUnit()` function** to parse and group reference range data:
   - Input: rows with `{t, y, unit, reference_lower, reference_upper, reference_lower_operator, reference_upper_operator, is_value_out_of_range}`
   - Output: `{unit, measurements: [], referenceBand: [], outOfRangePoints: []}`
   - Validate ranges: ignore reversed ranges (lower > upper)
   - Track out-of-range points separately

2. **Create multiple Chart.js datasets per unit:**
   - **Dataset A (Lower Band):** Points at reference_lower values (or -Infinity if only upper bound exists)
   - **Dataset B (Upper Band):** Points at reference_upper values (or Infinity if only lower bound exists)
   - Use Chart.js `fill: '+1'` to create shaded area between datasets
   - **Dataset C (Measurements):** Regular measurement line with points
   - **Dataset D (Out-of-Range):** Highlighted points with different shape/color

3. **Visual specifications:**
   - Band color: Light green with 25% opacity (`rgba(144, 238, 144, 0.25)`)
   - Out-of-range points: Pink triangular markers, larger size
   - Render order: bands (back) → measurements (middle) → outliers (front)
   - Legend: "Healthy range (unit)", "Your results (unit)", "Out of range (unit)"
   - Hide internal upper band dataset from legend (prefix with `_`)

4. **Tooltip enhancement:**
   - Show measurement value with unit
   - Include reference range for that specific point
   - Format: "value (Healthy: lower-upper unit)" or "value (Healthy: ≥ lower unit)"
   - Use operators from `reference_*_operator` fields

#### 2. Data Filtering in app.js [HIGH PRIORITY]
**Current State:** app.js filters rows to only `{t, y, unit}` at line ~867, discarding reference columns.

**Required Implementation:**

**File:** `public/js/app.js`

Update the data validation section to preserve all reference fields:
```javascript
const validRows = rows.filter(row => {
  const hasT = row.t !== null && row.t !== undefined;
  const hasY = row.y !== null && row.y !== undefined && !isNaN(parseFloat(row.y));
  return hasT && hasY;
}).map(row => ({
  // Core required fields
  t: row.t,
  y: row.y,
  unit: row.unit || 'unknown',
  // Reference range fields (preserve for band rendering)
  reference_lower: row.reference_lower,
  reference_lower_operator: row.reference_lower_operator,
  reference_upper: row.reference_upper,
  reference_upper_operator: row.reference_upper_operator,
  is_value_out_of_range: row.is_value_out_of_range,
  // Optional context
  patient_age_snapshot: row.patient_age_snapshot,
  patient_gender_snapshot: row.patient_gender_snapshot
}));
```

Add logging to verify reference bands are present in data.

#### 3. LIMIT Clause Validation [MEDIUM PRIORITY]
**Current State:** `sqlValidator.js` function `enforceLimitClause()` clamps all queries to 50 rows (line ~269), contradicting the 5000-point budget for plots.

**Required Implementation:**

**File:** `server/services/sqlValidator.js`

1. **Update `enforceLimitClause()` signature:**
   ```javascript
   function enforceLimitClause(sql, queryType = 'data_query') {
     const maxLimit = queryType === 'plot_query' ? 5000 : 50;
     // ... rest of logic using maxLimit
   }
   ```

2. **Update call site** (line ~483):
   ```javascript
   const sqlWithLimit = enforceLimitClause(cleanedSQL, queryType);
   ```

#### 4. SQL Contract Enforcement [HIGH PRIORITY]
**Current State:** No enforcement mechanism ensures LLM generates SQL with required columns. System relies entirely on LLM following prompt instructions.

**Required Implementation:**

**File:** `server/services/sqlValidator.js`

1. **Add column validation function using EXPLAIN:**
   ```javascript
   async function validatePlotQueryColumns(sql, queryType) {
     if (queryType !== 'plot_query') return { valid: true, columns: [] };

     // Use EXPLAIN (FORMAT JSON, VERBOSE) to get output columns
     // Extract column names from Plan.Output
     // Verify required columns: t, y, unit
     // Warn if missing recommended: reference_lower, reference_upper, etc.
     // Return {valid, violations, columns, hasReferenceBands}
   }
   ```

2. **Integrate into validation pipeline** after basic checks and LIMIT enforcement

3. **Enhanced validation for plot queries:**
   - Required columns: `t` (bigint timestamp), `y` (numeric), `unit` (text)
   - Recommended columns: `reference_lower`, `reference_upper`, `reference_lower_operator`, `reference_upper_operator`, `is_value_out_of_range`
   - Verify ORDER BY t, numeric casting, EXTRACT(EPOCH) pattern

**File:** `server/services/agenticSqlGenerator.js`

4. **Enhance LLM retry feedback** (line ~733):
   - Detect plot column validation failures
   - Provide specific error message: "PLOT QUERY VALIDATION FAILED: Your query must output exact columns required by plotRenderer.js..."
   - Include list of detected vs. required columns
   - Reference example query from system prompt

#### 5. LLM System Prompt Enhancement [MEDIUM PRIORITY]
**Current State:** Example query in system prompt doesn't include reference range columns.

**Required Implementation:**

**File:** `server/services/agenticSqlGenerator.js`

Update example SQL pattern (line ~128) to include reference fields:
```sql
WITH sanitized AS (
  SELECT
    COALESCE(pr.test_date_text::timestamp, pr.recognized_at) AS test_date,
    lr.unit,
    lr.reference_lower,
    lr.reference_lower_operator,
    lr.reference_upper,
    lr.reference_upper_operator,
    lr.is_value_out_of_range,
    regexp_replace(lr.result_value, '^[<>≤≥]\s*', '', 'g') AS cleaned
  FROM lab_results lr
  JOIN patient_reports pr ON pr.id = lr.report_id
  WHERE lr.parameter_name % 'search_term'
)
SELECT
  EXTRACT(EPOCH FROM test_date)::bigint * 1000 AS t,
  NULLIF(regexp_replace(regexp_replace(cleaned, ',', '.', 'g'),
    '\s*[A-Za-zА-Яа-я/*+_-]+$', '', 'g'), '')::numeric AS y,
  unit,
  reference_lower,
  reference_lower_operator,
  reference_upper,
  reference_upper_operator,
  is_value_out_of_range
FROM sanitized
WHERE ... ORDER BY t ASC LIMIT 5000;
```

Add explicit list of required/recommended columns in plot query instructions.

---

## Implementation Testing Checklist

### Before Implementation:
- [ ] Review all current files to understand existing patterns
- [ ] Verify Chart.js version supports `fill: '+1'` syntax
- [ ] Check if EXPLAIN (VERBOSE) is available in PostgreSQL version

### During Implementation:
- [ ] Test with queries that have two-sided ranges
- [ ] Test with queries that have only lower bound
- [ ] Test with queries that have only upper bound
- [ ] Test with queries that have no reference ranges
- [ ] Test with mixed units (multiple series)
- [ ] Test with out-of-range values
- [ ] Verify band renders behind measurements
- [ ] Verify tooltips show ranges correctly
- [ ] Verify legend shows correct labels
- [ ] Test LIMIT enforcement: data queries capped at 50, plot queries at 5000
- [ ] Test LLM retry mechanism with intentionally broken SQL
- [ ] Verify EXPLAIN-based column validation catches missing columns
- [ ] Test with 5000+ data points for performance

### After Implementation:
- [ ] Verify reference bands render in all scenarios
- [ ] Verify tooltips display ranges with correct operators
- [ ] Verify legends match PRD specifications
- [ ] Verify LIMIT clause enforcement works for both query types
- [ ] Verify SQL contract validation catches all violations
- [ ] Verify LLM retry feedback is specific and helpful
- [ ] Performance test with large datasets (5000 points)
- [ ] Browser compatibility testing

---

## Open Questions (post-MVP)
1. Add canonical reference ranges by age/sex independent of lab?
2. Should unit normalization allow merging mixed-unit series?
3. Enable clarifying dialogue for ambiguous "show" requests?
4. Implement context-aware patient filtering or multi-patient graphs?  
