# HealthUp — PRD v2.3: Single-Analyte Plot UI

**Version:** 2.3
**Status:** Draft - Refinement Phase (Updated with Technical Review Fixes)
**Dependencies:** PRD v2.2 (Lab Plot with Reference Band)
**Related:** PRD v2.1 (Plot Generation), PRD v2.0 (Agentic SQL)

---

## Technical Review Findings (Addressed in This Version)

### Critical Issues Fixed

1. **✅ LIMIT Clause Enforcement** (HIGH)
   - **Issue:** System prompt instructs "Use LIMIT 5000" but PRD specified 10,000. Validator only clamps DOWN, so LLM-generated LIMIT 5000 passes through unchanged, causing multi-parameter truncation.
   - **Fix:** Updated system prompt text (line 66) AND example SQL (line 112) to LIMIT 10000.

2. **✅ Missing `parameter_name` Validation** (HIGH)
   - **Issue:** Validator doesn't check for `parameter_name` column in plot queries. If LLM omits it, frontend selector breaks silently.
   - **Fix:** Added `validatePlotQueryColumns()` function using EXPLAIN to detect missing columns. Returns validation error with specific message listing missing columns.

3. **✅ Redundant Implementation Note** (MEDIUM)
   - **Issue:** PRD instructed updating `enforceLimitClause(cleanedSQL, queryType)` call, but this already exists in codebase.
   - **Fix:** Removed redundant instruction, added NOTE clarifying it's already implemented.

4. **✅ CSS Selector Mismatch** (MEDIUM)
   - **Issue:** PRD used `.parameter-selector-item input[type="radio"]:checked + label` but markup has radio INSIDE label (no sibling selector match).
   - **Fix:** Changed to `.parameter-selector-item:has(input[type="radio"]:checked)` with fallback for older browsers.

5. **✅ HTML Structure Preservation** (MEDIUM)
   - **Issue:** PRD showed simplified HTML ignoring existing `plot-toolbar` and CSS classes.
   - **Fix:** Updated to wrap existing `plot-container` structure, preserving all current classes and toolbar elements.

### Design Clarifications Added

6. **✅ Mixed Units Edge Case**
   - **Question:** When same `parameter_name` has multiple `unit` values (e.g., "Vitamin D" in both nmol/L and ng/mL), what UX?
   - **Decision:** Use existing `groupByUnit()` behavior (create sub-series per unit). Show visual distinction with different colors/markers. Future: add unit selector or server-side conversion.

---

## Overview
This feature introduces a parameter selector UI that enables users to view one laboratory analyte at a time from multi-parameter query results.

**Current Behavior (v2.2):**
When a user asks "Show me my cholesterol over time", the agentic LLM SQL generator creates a fuzzy search query (`WHERE parameter_name % 'холестерин'`) that returns ALL matching parameters (Total Cholesterol, LDL, HDL, Apo(a), ApoB, etc.). The [plotRenderer.js](../public/js/plotRenderer.js) `groupByUnit()` function creates multiple colored series on a single chart, grouped by measurement unit.

**Problem:**
- Crowded visualization with 5-10+ parameters overlaid
- Reference bands become unreliable when multiple analytes share the same unit
- Difficult to interpret individual parameter trends
- Current grouping is by `unit` only, not `parameter_name + unit`, causing parameters with the same unit (e.g., LDL and HDL both in mmol/L) to be merged incorrectly

**Proposed Solution:**
Display a parameter selector (left of the plot) that lists all parameters returned by the SQL query. Users select one parameter at a time. The plot updates to show only that parameter's time series with its reference band.

---

## Goals
1. Improve readability — users can focus on a single parameter’s evolution over time.  
2. Enable accurate reference band rendering — shaded healthy ranges visible per parameter.  
3. Preserve continuity with LLM workflow — when the LLM generates SQL queries returning multiple parameters, all of them become selectable in the UI.  
4. Simplify comparison across time — users can easily switch between parameters using a clean control panel.  
5. Support future logic — reference ranges that change by age, sex, or laboratory should display correctly.

---

## User Flow
1. **Query initiation**
   - User asks: "Show me my cholesterol over time"
   - Agentic LLM SQL generator creates query with fuzzy search: `WHERE lr.parameter_name % 'холестерин'`
   - SQL executes and returns ALL matching parameters (LDL, HDL, Total Cholesterol, Apo(a), ApoB, etc.)
   - Response includes full dataset: `{t, y, unit, parameter_name, reference_lower, reference_upper, ...}`

2. **Parameter discovery (Client-Side, Option A)**
   - Frontend receives complete SQL result set containing all parameters
   - JavaScript extracts unique `parameter_name` values by scanning all rows
   - Example: `['LDL-cholesterol', 'HDL-cholesterol', 'Total Cholesterol', 'Apo(a)', 'ApoB']`

3. **UI rendering**
   - **Left panel:** Parameter selector with radio buttons or list
     - Located to the left of the plot container
     - Shows all discovered parameter names
     - Displays count of measurements per parameter (optional)
   - **Right panel:** Chart canvas (existing `plot-container` element)

4. **Default selection**
   - **Alphabetically first parameter** is selected by default
   - Plot renders immediately with filtered data for that parameter
   - Example: If parameters are `['ApoB', 'HDL-cholesterol', 'LDL-cholesterol']`, select `'ApoB'`

5. **Parameter switching**
   - User clicks different parameter in selector
   - Frontend filters cached SQL results to rows matching selected `parameter_name`
   - Plot re-renders using [plotRenderer.js](../public/js/plotRenderer.js) `renderPlot()` with filtered data
   - **No network request** — all data already in memory (client-side filtering)

6. **Plot rendering**
   - Displays single parameter's time series
   - Shows reference band (from PRD v2.2 implementation)
   - Supports one-sided and two-sided ranges
   - Highlights out-of-range points
   - Units shown in Y-axis label and legend

7. **Edge cases**
   - **Single parameter returned:** Selector still shown (list of 1 item)
   - **Mixed units within one parameter:** Show warning or split into sub-series
   - **No reference data:** Plot line only, legend shows "Reference range unavailable"
   - **Empty selection:** Show "No data points for this parameter"

8. **Interactivity**
   - Hover tooltips: value, date, reference range
   - Zoom/pan: preserved from v2.2
   - **No URL state sharing** (removed from scope)

---

## Non-Goals (Out of Scope for v2.3)
- Multi-analyte overlay mode (may return as separate feature)
- URL state sharing or session persistence of selected parameter
- Adaptive reference range transitions within a single plot (deferred to future iteration)
- Per-patient filtering (already deferred in PRD v2.1)
- Unit normalization or conversion
- Category grouping (Lipid panel, Liver function, etc.)
- Database schema changes

---

## Technical Architecture

### SQL Query Contract (Extended from PRD v2.2)

**Required Changes:**
Plot queries MUST return `parameter_name` column in addition to existing columns.

**Updated SQL Output Schema:**
```sql
SELECT
  EXTRACT(EPOCH FROM test_date)::bigint * 1000 AS t,           -- Unix ms timestamp
  NULLIF(sanitized_value, '')::numeric AS y,                   -- Numeric value
  lr.parameter_name,                                            -- *** NEW: REQUIRED ***
  lr.unit,                                                      -- Measurement unit
  lr.reference_lower,                                           -- Lower reference bound
  lr.reference_lower_operator,                                  -- Operator: >, >=
  lr.reference_upper,                                           -- Upper reference bound
  lr.reference_upper_operator,                                  -- Operator: <, <=
  lr.is_value_out_of_range                                      -- Boolean flag
FROM ...
WHERE lr.parameter_name % 'search_term'  -- Fuzzy search returns multiple params
ORDER BY t ASC
LIMIT 10000;  -- Increased from 5000 (see Performance section)
```

**Why `parameter_name` is critical:**
- Frontend cannot distinguish "LDL-cholesterol" from "HDL-cholesterol" without it
- Current `groupByUnit()` function groups by `unit` only, merging different parameters with same unit
- Client-side filtering requires explicit parameter identification

---

### Data Flow Architecture

#### Backend (Agentic SQL Generator)
1. **LLM receives user query:** "Show me my cholesterol over time"
2. **Fuzzy search tool:** `fuzzy_search_parameter_names('холестерин')` returns matching parameter names
3. **SQL generation:** LLM creates query using fuzzy match operator (`%`), which returns ALL matching parameters
4. **Validation:** [sqlValidator.js](../server/services/sqlValidator.js) validates SQL (with updated LIMIT rules)
5. **Execution:** `/api/execute-sql` endpoint runs query, returns full dataset

#### Frontend (Client-Side Filtering - Option A)
1. **Receive complete dataset:** All parameters, all data points, all reference ranges in single response
2. **Extract parameter list:**
   ```javascript
   const uniqueParameters = [...new Set(rows.map(row => row.parameter_name))].sort();
   ```
3. **Build selector UI:** Render radio buttons/list with alphabetically sorted parameters
4. **Select default:** First parameter alphabetically
5. **Filter data client-side:**
   ```javascript
   const filteredRows = allRows.filter(row => row.parameter_name === selectedParameter);
   ```
6. **Render plot:** Call `plotRenderer.renderPlot(canvasId, filteredRows, options)`
7. **On selection change:** Re-filter and re-render (no network request)

---

### UI Layout

**Modified HTML Structure:**
```html
<div id="plot-visualization-container" style="display: flex; gap: 20px;">
  <!-- NEW: Left panel for parameter selector -->
  <div id="parameter-selector-panel" style="width: 200px; flex-shrink: 0;">
    <h4>Parameters</h4>
    <div id="parameter-list">
      <!-- Dynamically populated radio buttons or list items -->
    </div>
  </div>

  <!-- Existing: Right panel for plot -->
  <div id="plot-container" style="flex-grow: 1;">
    <canvas id="plot-canvas"></canvas>
    <button id="plot-reset-btn">Reset Zoom</button>
  </div>
</div>
```

**Selector UI Specifications:**
- **Component:** Radio button list (single selection)
- **Styling:** Clean, minimal, vertically stacked
- **Item format:** `[•] Parameter Name (n measurements)` — count is optional
- **Behavior:**
  - On click: filter data and re-render plot
  - Show loading state during re-render (brief)
  - Highlight selected parameter visually
- **Always visible:** Even when only 1 parameter (consistent UX)

---

### Performance Considerations

#### LIMIT Clause Adjustment
**Current State (PRD v2.2):**
- Data queries: LIMIT 50
- Plot queries: LIMIT 5000

**Problem with Multi-Parameter Queries:**
- Query returns 10 parameters × 500 points each = 5000 total rows
- Some parameters get truncated if LIMIT is reached
- User switches to parameter that has incomplete data

**Solution (v2.3):**
- **Increase plot query LIMIT to 10,000 rows**
- Rationale: Supports ~10 parameters × 1000 points each
- Frontend filters client-side, so all parameters get complete datasets
- Chart.js handles 10k points efficiently (tested in v2.2)

**Implementation:**
Update [sqlValidator.js](../server/services/sqlValidator.js) `enforceLimitClause()`:
```javascript
function enforceLimitClause(sql, queryType = 'data_query') {
  const maxLimit = queryType === 'plot_query' ? 10000 : 50;  // Was 5000
  // ... rest of logic
}
```

#### Client-Side Performance
- **Filtering:** O(n) scan through 10k rows — negligible (< 10ms)
- **Chart.js rendering:** Already tested with 5000 points in v2.2, handles 10k fine
- **Memory:** ~1-2 MB for 10k rows with all columns — acceptable for modern browsers

---

### Reference Range Rendering

**No changes to plotRenderer.js reference band logic (from PRD v2.2).**

Single-parameter filtering naturally solves the multi-parameter reference band problem:
- Each parameter gets its own isolated plot
- Reference bands computed per-parameter using existing logic
- Most frequent reference range within selected parameter's data used for band
- Out-of-range points highlighted correctly

**Edge Case (deferred to future):**
Adaptive reference ranges that transition mid-timeline still use "most frequent range" approach (PRD v2.2 behavior). Full per-point range transitions deferred to future iteration (per your clarification #7).

---

## Implementation Requirements

### Backend Changes

#### 1. SQL Validator (sqlValidator.js)
**File:** `server/services/sqlValidator.js`

**Change 1: Update LIMIT enforcement**
```javascript
function enforceLimitClause(sql, queryType = 'data_query') {
  const maxLimit = queryType === 'plot_query' ? 10000 : 50;  // Changed from 5000
  // ... existing logic
}
```

**Change 2: Add plot query column validation**

Add new validation function after existing `validatePlotQuery()`:
```javascript
/**
 * Validate required columns for plot queries using EXPLAIN
 * @param {string} sql - SQL query to validate
 * @param {string} queryType - 'data_query' or 'plot_query'
 * @returns {Promise<{valid: boolean, violations: Array, columns: Array}>}
 */
async function validatePlotQueryColumns(sql, queryType) {
  if (queryType !== 'plot_query') {
    return { valid: true, violations: [], columns: [] };
  }

  try {
    // Use EXPLAIN (FORMAT JSON, VERBOSE) to get output columns
    const explainResult = await pool.query(
      `EXPLAIN (FORMAT JSON, VERBOSE) ${sql}`
    );

    const plan = explainResult.rows[0]['QUERY PLAN'][0];
    const outputColumns = plan?.Plan?.Output || [];

    // Required columns for plot queries
    const requiredColumns = ['t', 'y', 'parameter_name', 'unit'];
    const missingColumns = requiredColumns.filter(
      col => !outputColumns.includes(col)
    );

    if (missingColumns.length > 0) {
      return {
        valid: false,
        violations: [{
          code: 'PLOT_MISSING_REQUIRED_COLUMNS',
          message: `Plot query missing required columns: ${missingColumns.join(', ')}. ` +
                   `Required: t (bigint timestamp), y (numeric value), parameter_name (text), unit (text).`,
          missingColumns
        }],
        columns: outputColumns
      };
    }

    // Check for recommended columns (warn but don't fail)
    const recommendedColumns = [
      'reference_lower',
      'reference_upper',
      'reference_lower_operator',
      'reference_upper_operator',
      'is_out_of_range'
    ];
    const missingRecommended = recommendedColumns.filter(
      col => !outputColumns.includes(col)
    );

    if (missingRecommended.length > 0) {
      logger.warn({
        missingColumns: missingRecommended
      }, '[validator] Plot query missing recommended reference columns');
    }

    return {
      valid: true,
      violations: [],
      columns: outputColumns,
      missingRecommended
    };
  } catch (error) {
    logger.error({
      error: error.message,
      sql
    }, '[validator] Failed to validate plot query columns');

    // Don't fail validation if EXPLAIN fails - let query execute
    return { valid: true, violations: [], columns: [] };
  }
}
```

**Change 3: Integrate column validation into validateSQL()**

Add after existing plot query validation (around line 480):
```javascript
// Existing code...
const plotValidation = validatePlotQuery(cleanedSQL, queryType);
if (!plotValidation.valid) {
  return {
    valid: false,
    violations: plotValidation.violations,
    sqlWithLimit: null
  };
}

// NEW: Validate plot query columns
const columnValidation = await validatePlotQueryColumns(sqlWithLimit, queryType);
if (!columnValidation.valid) {
  return {
    valid: false,
    violations: columnValidation.violations,
    sqlWithLimit: null,
    detectedColumns: columnValidation.columns
  };
}

// Continue with existing validation...
```

**NOTE:** `enforceLimitClause(cleanedSQL, queryType)` already exists in the codebase and correctly passes `queryType`. No changes needed to that call site.

#### 2. Agentic SQL Generator System Prompt (agentic_sql_generator_system_prompt.txt)
**File:** `prompts/agentic_sql_generator_system_prompt.txt`

**Change 1: Update LIMIT instruction (line 66)**
```diff
-- Use LIMIT 5000 for plot queries (not 50)
++ Use LIMIT 10000 for plot queries (not 50)
```

**Change 2: Update example SQL template (lines 70-112)**

Add `lr.parameter_name` to the sanitization CTE and SELECT list:
```sql
Value Sanitization Pattern with Reference Bands (handles "< 2", "0.04 R", "25,3", "22*", negative values):
WITH sanitized AS (
  SELECT
    COALESCE(pr.test_date_text::timestamp, pr.recognized_at) AS test_date,
+   lr.parameter_name,  -- ADD THIS
    lr.unit,
    lr.reference_lower,
    lr.reference_lower_operator,
    lr.reference_upper,
    lr.reference_upper_operator,
    lr.is_value_out_of_range,
    pr.patient_age_snapshot,
    pr.patient_gender_snapshot,
    regexp_replace(lr.result_value, '^[<>≤≥]\\s*', '', 'g') AS cleaned
  FROM lab_results lr
  JOIN patient_reports pr ON pr.id = lr.report_id
  WHERE lr.parameter_name % 'search_term'
)
SELECT
  EXTRACT(EPOCH FROM test_date)::bigint * 1000 AS t,
  NULLIF(
    regexp_replace(
      regexp_replace(cleaned, ',', '.', 'g'),
      '[^0-9.\\-]', '', 'g'
    ),
    ''
  )::numeric AS y,
+ parameter_name,  -- ADD THIS
  unit,
  reference_lower,
  reference_lower_operator,
  reference_upper,
  reference_upper_operator,
  is_value_out_of_range AS is_out_of_range,
  patient_age_snapshot,
  patient_gender_snapshot
FROM sanitized
WHERE NULLIF(
  regexp_replace(
    regexp_replace(cleaned, ',', '.', 'g'),
    '[^0-9.\\-]', '', 'g'
  ),
  ''
) IS NOT NULL AND cleaned ~ '^-?[0-9]'
ORDER BY t ASC
- LIMIT 5000;
+ LIMIT 10000;
```

**Change 3: Add explicit requirement text (after line 66)**

Add new section:
```
REQUIRED COLUMNS FOR PLOT QUERIES:
- MUST include: t (bigint), y (numeric), parameter_name (text), unit (text)
- SHOULD include: reference_lower, reference_upper, reference_*_operator, is_value_out_of_range
- Missing parameter_name will cause frontend selector to fail
```

---

### Frontend Changes

#### 1. Plot Data Preservation (app.js)
**File:** `public/js/app.js`

**Change: Update data mapping (line ~867-890)**

Add `parameter_name` to preserved fields:
```javascript
const validRows = rows.filter(row => {
  const hasT = row.t !== null && row.t !== undefined;
  const hasY = row.y !== null && row.y !== undefined && !isNaN(parseFloat(row.y));
  return hasT && hasY;
}).map(row => ({
  // Core required fields
  t: row.t,
  y: row.y,
  parameter_name: row.parameter_name,  // *** ADD THIS ***
  unit: row.unit || 'unknown',
  // Reference range fields
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

#### 2. Parameter Selector UI (app.js)
**File:** `public/js/app.js`

**New function: Extract and render parameter selector**
```javascript
/**
 * Build parameter selector UI from plot data
 * @param {Array} rows - Full dataset with parameter_name field
 * @param {string} containerId - ID of selector container element
 * @returns {string|null} - Selected parameter name (default: first alphabetically)
 */
function renderParameterSelector(rows, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return null;

  // Extract unique parameters, sorted alphabetically
  const paramCounts = {};
  rows.forEach(row => {
    const param = row.parameter_name;
    if (param) {
      paramCounts[param] = (paramCounts[param] || 0) + 1;
    }
  });

  const parameters = Object.keys(paramCounts).sort();
  if (parameters.length === 0) return null;

  // Build radio button list
  const fragment = document.createDocumentFragment();
  parameters.forEach((param, index) => {
    const label = document.createElement('label');
    label.className = 'parameter-selector-item';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'parameter';
    radio.value = param;
    radio.checked = index === 0; // Default: first alphabetically

    const text = document.createTextNode(` ${param} (${paramCounts[param]})`);

    label.appendChild(radio);
    label.appendChild(text);
    fragment.appendChild(label);
  });

  container.replaceChildren(fragment);

  return parameters[0]; // Return default selection
}
```

**Integration with existing plot rendering:**
```javascript
// Inside renderPlotVisualization() after data validation
if (validRows.length) {
  // Show parameter selector
  const selectedParameter = renderParameterSelector(validRows, 'parameter-list');

  // Filter to selected parameter
  let filteredRows = validRows;
  if (selectedParameter) {
    filteredRows = validRows.filter(row => row.parameter_name === selectedParameter);
  }

  // Render plot with filtered data
  currentChart = window.plotRenderer.renderPlot('plot-canvas', filteredRows, options);

  // Attach event listener for parameter switching
  attachParameterSelectorListener(validRows);
}
```

**Event handler for parameter switching:**
```javascript
function attachParameterSelectorListener(allRows) {
  const container = document.getElementById('parameter-list');
  if (!container) return;

  container.addEventListener('change', (event) => {
    if (event.target.type === 'radio' && event.target.name === 'parameter') {
      const selectedParameter = event.target.value;

      // Filter data client-side
      const filteredRows = allRows.filter(row => row.parameter_name === selectedParameter);

      // Destroy existing chart
      if (currentChart && window.plotRenderer) {
        window.plotRenderer.destroyChart(currentChart);
      }

      // Re-render with filtered data
      currentChart = window.plotRenderer.renderPlot('plot-canvas', filteredRows, {
        title: selectedParameter,
        xAxisLabel: 'Date',
        yAxisLabel: 'Value',
        timeUnit: 'day'
      });
    }
  });
}
```

#### 3. HTML Structure (index.html)
**File:** `public/index.html`

**Change: Add parameter selector panel before existing plot-container**

**Current structure** (lines 82-88):
```html
<!-- Plot visualization container -->
<div id="plot-container" class="plot-container" hidden>
  <div class="plot-toolbar">
    <span class="plot-toolbar__hint">Scroll to zoom. Shift + drag to pan.</span>
    <button id="plot-reset-btn" class="plot-toolbar__button" type="button" hidden>Reset zoom</button>
  </div>
  <canvas id="plot-canvas" aria-label="Lab results time-series plot"></canvas>
</div>
```

**New structure:**
```html
<!-- Plot visualization with parameter selector (v2.3) -->
<div id="plot-visualization-container" class="plot-visualization-container" hidden>
  <!-- Left panel: Parameter selector -->
  <div id="parameter-selector-panel" class="parameter-selector-panel">
    <h4 class="parameter-selector-panel__title">Select Parameter</h4>
    <div id="parameter-list" class="parameter-selector-list">
      <!-- Dynamically populated by app.js -->
    </div>
  </div>

  <!-- Right panel: Plot (existing structure preserved) -->
  <div id="plot-container" class="plot-container">
    <div class="plot-toolbar">
      <span class="plot-toolbar__hint">Scroll to zoom. Shift + drag to pan.</span>
      <button id="plot-reset-btn" class="plot-toolbar__button" type="button" hidden>Reset zoom</button>
    </div>
    <canvas id="plot-canvas" aria-label="Lab results time-series plot"></canvas>
  </div>
</div>
```

**Show/hide logic in app.js:**
```javascript
// When plot is rendered, show wrapper container
document.getElementById('plot-visualization-container').hidden = false;

// When no plot data, hide wrapper
document.getElementById('plot-visualization-container').hidden = true;
```

**Note:** Preserves existing `plot-container`, `plot-toolbar`, and related classes/structure to maintain compatibility with [css/style.css](../public/css/style.css).

#### 4. CSS Styling (style.css)
**File:** `public/css/style.css`

**Add new styles for parameter selector and wrapper:**
```css
/* Plot visualization container with parameter selector (v2.3) */
.plot-visualization-container {
  display: flex;
  gap: 20px;
  margin-top: 20px;
}

/* Parameter selector panel (left side) */
.parameter-selector-panel {
  width: 200px;
  min-width: 180px;
  flex-shrink: 0;
  background: #f8f9fa;
  padding: 15px;
  border-radius: 8px;
  border: 1px solid #dee2e6;
}

.parameter-selector-panel__title {
  font-size: 14px;
  font-weight: 600;
  color: #495057;
  margin-top: 0;
  margin-bottom: 12px;
}

.parameter-selector-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* Parameter selector item (label wrapping radio button) */
.parameter-selector-item {
  display: flex;
  align-items: center;
  padding: 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  transition: background-color 0.2s;
}

.parameter-selector-item:hover {
  background-color: #e9ecef;
}

.parameter-selector-item input[type="radio"] {
  margin-right: 8px;
  cursor: pointer;
}

/* Highlight selected parameter (correct selector for radio inside label) */
.parameter-selector-item:has(input[type="radio"]:checked) {
  background-color: #e9ecef;
  font-weight: 600;
}

/* Fallback for browsers without :has() support (older browsers) */
.parameter-selector-item input[type="radio"]:checked {
  accent-color: #007bff;
}

/* Plot container adapts to flex layout */
.plot-container {
  flex-grow: 1;
  min-width: 0; /* Allow canvas to shrink below intrinsic size */
}
```

**Note on CSS selector:**
- Original PRD used `.parameter-selector-item input[type="radio"]:checked + label` which doesn't match the HTML structure where radio is INSIDE label
- Fixed selector uses `:has()` pseudo-class (modern browsers, Chrome 105+, Firefox 121+, Safari 15.4+)
- Added fallback styling for older browsers using `accent-color` on checked radio

---

## Error and Empty States

| State | Trigger | UI Behavior |
|-------|---------|-------------|
| **No parameters found** | SQL returns 0 rows or all rows missing `parameter_name` | Hide parameter selector panel, show "No data available for plotting" |
| **Single parameter, no data points** | After filtering, selected parameter has 0 valid (t, y) pairs | Show parameter selector, plot area displays "No measurements for this parameter" |
| **Missing reference ranges** | Selected parameter has no `reference_lower`/`reference_upper` values | Plot line renders normally, legend shows "Reference range unavailable" instead of healthy band |
| **SQL execution fails** | Backend returns error response | Hide both panels, show standard error message in status area |
| **Mixed units within parameter** | Same `parameter_name` has multiple `unit` values (e.g., "Vitamin D" in nmol/L and ng/mL) | **MVP Behavior:** When filtering to a specific parameter, call `groupByUnit()` on the filtered data. This creates multiple colored series on the same plot, one per unit. Legend shows "Vitamin D (nmol/L)" and "Vitamin D (ng/mL)" as separate entries.<br>**Pros:** Uses existing code, shows all data.<br>**Cons:** Y-axis scaling may be confusing if units differ significantly.<br>**Future:** Add unit selector dropdown or server-side conversion. |

---

## Testing Scenarios

### Functional Testing
1. **Single parameter query**
   - Input: "Show me vitamin D over time"
   - Expected: 1 parameter in selector, plot renders immediately

2. **Multi-parameter query (lipid panel)**
   - Input: "Show me my cholesterol"
   - Expected: 5-10 parameters listed alphabetically, first selected by default

3. **Parameter switching**
   - Action: Click different parameter radio button
   - Expected: Plot updates < 100ms, no network request, chart destroys/recreates cleanly

4. **Reference band display**
   - Verify: Each parameter shows correct reference band
   - Verify: Out-of-range points highlighted
   - Verify: Tooltip shows parameter-specific ranges

5. **Edge cases**
   - Empty results (0 rows)
   - Missing `parameter_name` in some rows (skip them)
   - Very long parameter names (truncate with ellipsis)
   - 50+ parameters (scrollable selector)

### Performance Testing
1. **10,000 row dataset**
   - 10 parameters × 1000 points each
   - Client-side filtering < 10ms
   - Chart.js render < 500ms

2. **Parameter switching speed**
   - Measure time from click to chart render complete
   - Target: < 100ms for 1000 points, < 300ms for 5000 points

3. **Memory usage**
   - Monitor browser memory with 10k rows cached
   - Target: < 5 MB additional memory

---

## Success Criteria

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Feature completeness** | All parameters selectable | Manual testing with lipid panel query |
| **UI responsiveness** | Parameter switch < 100ms | Performance.now() timing |
| **Data accuracy** | Reference bands match parameter | Visual inspection + unit tests |
| **UX clarity** | Users understand single-parameter view | User feedback survey (80%+ positive) |
| **Backwards compatibility** | No breaking changes to existing plot queries | Regression testing |
| **Performance** | 10k rows handled smoothly | Load test with synthetic data |

---

## Migration Strategy

**v2.3 is a breaking change for plot UI but NOT for API contracts.**

### What Changes for Users
- **Before (v2.2):** User asks "cholesterol" → sees multi-parameter overlay plot immediately
- **After (v2.3):** User asks "cholesterol" → sees parameter selector + first parameter plotted, can switch

### Rollout Plan
1. **Phase 1 (MVP stage):** Direct deployment, no feature flag
   - Since we're in MVP, replace v2.2 behavior entirely
   - Document change in user-facing release notes

2. **Phase 2 (If needed):** Gather user feedback
   - Monitor for requests to restore multi-overlay view
   - If significant demand, implement as toggle option

### Rollback Plan
- If critical issues found, revert commits to v2.2 state
- Key files to revert: `app.js`, `index.html`, `sqlValidator.js`, `agenticSqlGenerator.js`
- No database migrations required (no schema changes)

---

## Future Extensions (Post-v2.3)

### High Priority
1. **Multi-analyte overlay toggle**
   - Add checkbox "Compare multiple parameters"
   - When checked, allow multi-select from parameter list
   - Render overlaid plot with v2.2 logic

2. **Adaptive reference range transitions**
   - Per-point reference band rendering (not most-frequent)
   - Visual transition indicators when range changes
   - Requires plotRenderer.js refactor

### Medium Priority
3. **Category grouping**
   - Group parameters: "Lipid Panel", "Liver Function", "Vitamins"
   - Collapsible sections in parameter selector
   - Requires analyte categorization data

4. **Smart parameter suggestions**
   - Highlight parameters trending out of range
   - "⚠" icon next to problematic parameters
   - Requires client-side range analysis

### Low Priority
5. **User preferences**
   - Remember last-selected parameter per category
   - Bookmark favorite parameters
   - Requires localStorage or backend persistence

6. **URL state sharing**
   - Query parameter: `?parameter=LDL-cholesterol`
   - Deep-linking to specific parameter view
   - Requires URL routing logic

---

## Appendix: Design Decisions

### Why Client-Side Filtering (Option A)?
**Pros:**
- Instant parameter switching (no network latency)
- Simpler backend (no new endpoints)
- Works with existing agentic SQL flow
- Easier to implement for MVP

**Cons:**
- Larger initial payload (all parameters at once)
- Memory overhead for 10k+ rows
- Limited scalability for 100+ parameters

**Decision:** Acceptable tradeoffs for MVP. Can optimize later if needed.

### Why Alphabetical Default Selection?
**Alternatives considered:**
- **Most frequent parameter:** Unpredictable, may not match user intent
- **LLM-suggested parameter:** Requires LLM to emit preference metadata (complex)
- **Most recent results:** Could be obsolete parameter

**Decision:** Alphabetical is predictable, consistent, easy to implement.

### Why 10,000 Row LIMIT?
**Calculation:**
- Typical lipid panel: 8-10 parameters
- Average patient history: 500-1000 measurements per parameter
- 10 params × 1000 points = 10,000 rows
- Headroom for larger panels or long patient histories

**Alternative:** Dynamic LIMIT based on parameter count (complex, deferred).

---

## Summary of Changes from v2.2

| Component | v2.2 Behavior | v2.3 Behavior |
|-----------|---------------|---------------|
| **Plot rendering** | All parameters overlaid on one chart | Single parameter at a time, user-selectable |
| **UI layout** | Plot only | Parameter selector (left) + plot (right) |
| **SQL contract** | `{t, y, unit, reference_*}` | `{t, y, parameter_name, unit, reference_*}` ← Added field |
| **LIMIT clause** | 5000 rows | 10,000 rows |
| **Reference bands** | Unreliable with multi-parameter | Accurate per-parameter |
| **User interaction** | None (static plot) | Click to switch parameters |
