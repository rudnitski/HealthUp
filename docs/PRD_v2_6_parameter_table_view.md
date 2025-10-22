# PRD v2.6 — Parameter Table Below Plot
**Feature:** “Parameter Table View for Plotted Analyte”  
**Owner:** HealthUp  
**Date:** 2025-10-22  
**Status:** Draft  

---

## 1. Summary
Extend the analytics surface by displaying a **data table** below the existing **time-series plot** that shows lab trends for the selected parameter (e.g., Vitamin D).  
The table provides an **accurate, static view** of the same data driving the plot — allowing users to verify values, compare exact numbers, and reference report dates — while keeping focus on a single parameter at a time.

This closes the loop between *visual trend exploration* (chart) and *data inspection* (tabular).

---

## 2. Goals
- Present the plotted parameter’s data points in a tabular form directly below the chart.
- Keep chart and table **synchronized** with the user’s parameter selection.
- Maintain the table’s **structure and style** consistent with the existing “lab report results table” used post-ingestion.
- Avoid backend or schema changes; reuse the SQL plot response already available in the client.
- Preserve the lightweight, static architecture (no new dependencies or data endpoints).

---

## 3. Non-Goals
- Displaying multiple parameters simultaneously in table form.
- Introducing new filtering, pagination, or sort controls.
- CSV export functionality (deferred to future enhancements).
- Mobile-specific layout optimizations (will inherit responsive table wrapper).
- Backend modifications to `/api/execute-sql` or database schema changes.

---

## 4. User Story
> As a HealthUp user viewing lab trends,  
> I want to see the **exact values** and reference ranges for the parameter I’m currently plotting,  
> so I can confirm specific results and interpret the chart with greater accuracy.

---

## 5. User Experience Overview
- When a parameter (e.g., *Vitamin D*) is selected in the left-side selector, the chart updates as today.
- Directly **below the chart**, a compact table appears with 4 columns:
  - **Date** (converted from Unix timestamp `t` to readable format, e.g., "Jan 15, 2024")
  - **Value** (the numeric measurement `y`, with **red outline** when out of range)
  - **Unit** (e.g., "ng/mL")
  - **Reference Interval** (formatted string, e.g., "30 - 100" or "≥ 30" or "Unavailable")
- Out-of-range values are visually highlighted with a **red outline** around the Value cell (matching lab upload table styling).
- Table renders **immediately on first load** alongside the default parameter selection.
- Table hides automatically when:
  - No parameter is selected.
  - No rows exist for that parameter.
  - Chart is in an error or loading state.
- The table uses the same visual language (typography, borders, color codes) as the ingestion results table for design continuity.

---

## 6. Functional Requirements

### 6.1 Data Source
- Input data comes from the **same payload** returned by `/api/execute-sql` and rendered in the plot.
- Required columns (already available in `plot_query` results):
  - `t` (timestamp in milliseconds) — **REQUIRED**
  - `y` (numeric value) — **REQUIRED**
  - `parameter_name` — **REQUIRED**
  - `unit` — **REQUIRED**
- Optional columns (preserved when present):
  - `reference_lower`, `reference_upper` *(for reference interval display)*
  - `reference_lower_operator`, `reference_upper_operator` *(support one-sided bounds: >, >=, <, <=)*
  - `is_value_out_of_range` *(boolean flag from database; can be used as primary source for status)*
- All fields are already available in the current `/api/execute-sql` response for plot queries; no backend changes needed.

### 6.2 Behavior
| Event | Expected Outcome |
|-------|------------------|
| Parameter selected | Table renders rows for that parameter and displays beneath chart. |
| Parameter changed | Chart updates; table re-renders with matching dataset. |
| Parameter deselected / no data | Table hides automatically. |
| Page reload with last query | Table initializes alongside chart if data present. |
| Chart error | Table hides or shows “No data available.” |

### 6.3 Table Rendering
- Implemented client-side in `app.js` as new function: `renderParameterTable(rows, parameterName)`.
- Table content generated dynamically based on filtered rows (same filtering applied to chart).
- Each row represents one lab measurement instance.
- **Date Formatting:** Convert `t` (Unix milliseconds) to readable format, e.g., "Jan 15, 2024"
- **Reference Interval Formatting:** Reuse existing `buildReferenceIntervalDisplay()` function from `app.js` (lines 162-227):
  - Two-sided: "30 - 100"
  - One-sided lower: "≥ 30"
  - One-sided upper: "≤ 100"
  - Missing bounds: Helper returns empty string `''`; **table renderer must substitute "Unavailable"** when result is empty/falsy
  - **Note:** Plot data uses prefixed field names (`reference_lower`), while the helper expects unprefixed names (`lower`). Implementation must handle this mapping.
- **Out-of-Range Highlighting:**
  - Match the visual treatment used in lab report upload table
  - Apply **red outline** (`data-out-of-range='true'`) to the **Value cell** when result is out of range
  - Use `is_value_out_of_range` boolean field from database when available as primary indicator
  - Fallback: compute client-side if field missing: `y < reference_lower || y > reference_upper`
  - Do **not** add a separate "Status" column (Low/High/OK) — the red outline is sufficient visual indicator
- **Table Columns (4 total):**
  1. **Date** — formatted from `t` timestamp
  2. **Value** — `y` with optional red outline when out-of-range
  3. **Unit** — from `unit` field
  4. **Reference Interval** — formatted using `buildReferenceIntervalDisplay()` helper

### 6.4 UI / Layout
- **HTML Structure:** Add new table container below the plot canvas in `index.html`:
  ```html
  <div id="plot-visualization-container" class="plot-visualization-container">
    <div id="parameter-selector-panel">...</div>
    <div id="plot-container">...</div>
    <div id="parameter-table-container" class="parameter-table-container">
      <!-- Table dynamically rendered here -->
    </div>
  </div>
  ```
- **CSS Layout Change:** Update `.plot-visualization-container` from flexbox to CSS Grid to allow table to span full width below selector and chart:
  ```css
  /* BEFORE: Flexbox layout (current) */
  .plot-visualization-container {
    display: flex;
    gap: 20px;
  }

  /* AFTER: Grid layout (new) */
  .plot-visualization-container {
    display: grid;
    grid-template-columns: 200px 1fr;
    grid-template-rows: auto auto;
    gap: 20px;
  }

  .parameter-selector-panel {
    /* No changes needed - implicitly grid-column: 1 / 2, grid-row: 1 */
  }

  .plot-container {
    /* No changes needed - implicitly grid-column: 2 / 3, grid-row: 1 */
    /* Keep existing properties: flex-grow: 1, min-width: 0 */
  }

  .parameter-table-container {
    grid-column: 1 / -1;  /* Span both columns */
    grid-row: 2;
    margin-top: 1.5rem;
  }
  ```
  **Note:** `.plot-container` existing styles (`flex-grow: 1`, `min-width: 0`) remain compatible with grid layout and should be preserved.

- **Table Styling:** Reuse existing `.parameters-table` and `.parameters-table-wrapper` classes from lab report results (no new styles needed).
- **Table Caption:** Use `<caption>` element or `aria-labelledby` to reflect current parameter name and unit (e.g., "Vitamin D (ng/mL) Measurements").

### 6.5 Accessibility
- Table caption or `aria-labelledby` references the same label as the selected parameter.
- Keyboard or screen-reader navigation through parameter radios updates both chart and table.

---

## 7. Technical Overview

### 7.1 Affected Frontend Modules
| Module | Changes Required |
|---------|------------------|
| `public/index.html` | Add `<div id="parameter-table-container">` below `plot-container` (5 lines). |
| `public/css/style.css` | Change `.plot-visualization-container` from `display: flex` to `display: grid`; add `.parameter-table-container` grid placement rules (~10 lines). |
| `public/js/app.js` | Add `renderParameterTable(rows, parameterName)` function (~60-80 lines); call on initial load after first chart render (~1 line); hook into `attachParameterSelectorListener()` change handler (~1 line). |

**No changes needed:**
- `server/routes/executeSql.js` — API response already includes all required fields
- `server/services/sqlValidator.js` — Plot query validation already correct
- `public/js/plotRenderer.js` — Chart rendering unchanged

### 7.2 Data Flow & Implementation Pattern
```
1. User submits question → /api/sql-generator returns plot SQL
2. app.js calls /api/execute-sql → receives plotResponse.rows[] (all parameters)
3. app.js renders parameter selector with allRows captured in closure
4. INITIAL RENDER (first load):
   a. Filter allRows by default selected parameter → filteredRows
   b. Call plotRenderer.renderPlot(filteredRows) → initial chart
   c. Call renderParameterTable(filteredRows, selectedParameter) → initial table
5. On parameter selection CHANGE:
   a. Filter allRows by new selected parameter_name → filteredRows
   b. Call plotRenderer.renderPlot(filteredRows) → chart updates
   c. Call renderParameterTable(filteredRows, selectedParameter) → table updates
```

**Key Integration Points:**

**1. Initial render** (`app.js` line ~1027, after `renderParameterSelector()` call):
- After rendering initial chart with default parameter
- **CRITICAL:** Must call `renderParameterTable(filteredRows, selectedParameter)`
- Table must render on first page load, not just on parameter changes

**2. Change handler** (`attachParameterSelectorListener()` in `app.js` line 837-868):
- When parameter radio button changes
- After re-rendering chart with newly selected parameter
- Call `renderParameterTable(filteredRows, selectedParameter)` with same filtered data used for chart

### 7.3 Implementation Considerations

**Data Field Mapping:**
- Plot query data uses prefixed field names: `reference_lower`, `reference_upper`, `reference_lower_operator`, `reference_upper_operator`
- Existing `buildReferenceIntervalDisplay()` helper (app.js lines 162-227) expects unprefixed names: `lower`, `upper`, `lower_operator`, `upper_operator`
- Implementation must map between these naming conventions when reusing the helper

**Table Rendering Requirements:**
- Create new function `renderParameterTable(rows, parameterName)` in app.js
- Clear and rebuild table body on each render (handle both initial load and parameter changes)
- Apply `data-out-of-range='true'` attribute to Value cell when appropriate
- **Reference Interval fallback:** When `buildReferenceIntervalDisplay()` returns empty/falsy value, display "Unavailable" in table cell
- Use semantic HTML (`<thead>`, `<tbody>`, `<th scope="col">`)
- Reuse existing `.parameters-table` and `.parameters-table-wrapper` CSS classes

### 7.4 Dependencies
- None new.
- Chart.js data already includes all required fields.
- Reuses existing helper: `buildReferenceIntervalDisplay()` from app.js

---

## 8. Metrics / Success Criteria
- Table renders in < 100 ms after parameter change.
- No visual lag between chart update and table display.
- No additional API calls.
- No layout shift or regression in plot interactions.
- QA verifies numeric equivalence between chart tooltip values and table cells.

---

## 9. Risks & Mitigations
| Risk | Mitigation |
|------|-------------|
| Missing reference bounds | Reference Interval column shows "Unavailable"; Value cell remains unhighlighted (no red outline). |
| Large datasets (1000+ rows) | SQL validator already enforces `LIMIT 10000` for plot queries. Simple `<tbody>` rendering acceptable for MVP; monitor performance in QA. |
| Chart and table becoming out of sync | Use same `filteredRows` array for both chart and table rendering within single event handler. |
| Layout shift when table appears | Use CSS Grid layout with fixed gap spacing; table container always allocated in DOM (hidden when empty). |

---

## 10. QA & Testing Plan
### Functional Testing
- ✅ **CRITICAL:** Verify table renders **on first page load** with default parameter (before any user interaction)
- ✅ Verify table updates when switching parameters via radio buttons
- ✅ Verify table hides when no data available
- ✅ Validate numeric values match chart tooltips exactly
- ✅ Verify table columns are: Date | Value | Unit | Reference Interval (4 columns, no Status column)

### Edge Cases
- ✅ Test with missing reference ranges (both bounds null) — verify Reference Interval shows "Unavailable", not blank
- ✅ Test with one-sided ranges (only lower OR only upper bound)
- ✅ Test with custom operators (>, >=, <, <=)
- ✅ Test with parameters that have only 1 data point
- ✅ Test with large datasets (500+ rows)

### Styling & Layout
- ✅ **CRITICAL:** Verify out-of-range **Value cells** have red outline (match lab upload table: `data-out-of-range='true'`)
- ✅ Verify red outline applies to Value cell only, not entire row
- ✅ Verify striped row backgrounds render correctly
- ✅ Verify table caption reflects current parameter
- ✅ Test horizontal scroll on narrow viewports (table-wrapper overflow-x)
- ✅ Verify no layout shift when table appears/disappears
- ✅ Verify grid layout preserves parameter selector and plot container positioning

### Accessibility
- ✅ Keyboard navigation through parameter selector updates both chart and table
- ✅ Screen reader announces table caption correctly
- ✅ Semantic HTML structure (`<th scope="col">`, proper table markup)

### Regression Testing
- ✅ Chart zoom/pan still works after table addition
- ✅ Parameter selector radio buttons still function correctly
- ✅ No console errors in browser dev tools
- ✅ No performance degradation in chart rendering

---

## 11. Future Enhancements
- **CSV Export:** Client-side CSV generation with download trigger (deferred from MVP).
- **Report Metadata:** Include `report_id` and `report_date` fields (requires SQL generator template update).
- **Mobile Toggle:** Collapsible "Show Data Table" button for mobile viewports (deferred from MVP).
- **Date Range Filter:** Inline filter to show subset of dates.
- **Multi-Parameter View:** Side-by-side comparison of two parameters in table.
- **Column Sorting:** Click column headers to sort by date/value.
- **Report Deep Links:** Per-row link to open original lab report PDF viewer.

---

## 12. Release Notes (Draft)
**v2.6 — Parameter Table View**  
Users can now see an exact, tabular list of lab results directly below the plotted trend for the currently selected analyte. The table mirrors the plotted data and highlights out-of-range values, improving both trust and interpretability of time-series analytics.
