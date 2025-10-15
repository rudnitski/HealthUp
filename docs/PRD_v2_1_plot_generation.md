# PRD: Plot Generation for Historical Lab Trends (v2.1 MVP)

## Goal
Enable the AI agent to detect when a user requests **visualization of lab results over time** (e.g., "Покажи, как у меня менялся витамин D") and automatically produce a **validated SQL query** returning time-series data suitable for plotting, along with metadata for frontend visualization.

The system should still handle normal analytical questions (as before), but intelligently decide when a plot is more appropriate.

---

## Summary
Currently, the LLM always produces a SQL query that answers a question textually (e.g., table output).
Now it must:

1. **Detect intent** — whether the user is asking for a *plot/time-series view* or a *data table/query*.
2. **If plot-intent detected** — generate SQL shaped for plotting (`t`, `y`, `unit`) and return metadata.
3. **If ambiguous (MVP)** — treat as `data_query` (table output). No interactive clarification in this version.
4. **Otherwise** — continue normal SQL generation.

---

## Architecture Overview

### 1. Decision Layer (LLM-Based Intent Detection)

**The LLM decides intent autonomously** based on the user's question. No keyword heuristics or pre-filtering.

**Strategy:**
- The agentic loop uses the extended system prompt to understand when to generate plot vs data queries
- LLM considers context, phrasing, and user intent
- If ambiguous (MVP): default to `data_query`

| Intent | Example user query | Desired behavior |
|---------|--------------------|------------------|
| `plot_query` | "Покажи график изменения витамина D." | Generate time-series SQL for plotting. |
| `plot_query` | "Как менялся витамин D во времени?" | LLM detects temporal/trend intent → plot |
| `data_query` | "Покажи мой уровень витамина D." | Generate normal SQL (tabular results). |
| `ambiguous` | "Витамин D результаты" | **MVP:** LLM defaults to `data_query` |

---

### 2. Patient Context (MVP Decision)

**🔴 CRITICAL SECURITY CONSIDERATION:**

The current agentic system generates **complete, executable queries without placeholders** (no `$1`, `:param`, etc.).

**MVP Approach:**
- Queries **do not filter by specific patient_id**
- SQL returns **ALL visible rows from the database** (all patients)
- Example: `WHERE lr.parameter_name % 'витамин D'` (no patient filter)

**⚠️ SECURITY IMPLICATION:**
- **This means the frontend receives data for ALL patients, not just the logged-in user**
- **Frontend MUST implement client-side filtering or session-based RLS**
- **Alternative: Do NOT deploy this feature until server-side filtering is implemented**

**Rationale:**
- Aligns with current system prompt: "DO NOT use parameters like :param, :patient_id, or placeholders"
- Simplifies MVP implementation
- User questions like "покажи МОИ анализы" currently mean: return ALL vitamin D results from the database

**Future Options (REQUIRED before production):**
- **Option A (Recommended):** Server-side context injection during validation:
  ```javascript
  // In sqlValidator.js
  const userPatientId = req.session.patientId;
  safeSql = safeSql.replace(/LIMIT \d+/, `WHERE patient_id = ${userPatientId} LIMIT 50`);
  ```
- **Option B:** Row-level security (RLS) on database:
  ```sql
  ALTER TABLE lab_results ENABLE ROW LEVEL SECURITY;
  CREATE POLICY user_lab_results ON lab_results
    FOR SELECT USING (patient_id = current_setting('app.current_patient_id')::integer);
  ```
- **Option C:** Session-based patient context passed to validator and injected safely

**Decision Required:**
- [ ] Accept MVP risk (frontend filtering only)
- [ ] Implement Option A/B/C before feature deployment
- [ ] Limit feature to demo/admin users only until filtering is in place

---

### 3. Plot SQL Shape Contract

If intent = `plot_query`, the **final SQL** must:
- Return exactly these columns:
  - `t` → **Unix timestamp in milliseconds** (bigint) - CRITICAL for Chart.js performance
  - `y` → `numeric` (from `result_value`, **must be castable to numeric**)
  - `unit` → `text` (optional, for multi-unit series)
- Be ordered by time ascending (`ORDER BY t ASC`)
- Include `LIMIT` guard (≤ 5000)
- Use fuzzy parameter match for analyte name (`parameter_name % 'term'`)
- Join `lab_results` → `patient_reports` as usual
- **Exclude non-numeric values** using `NULLIF` and filtering

**Why Unix Timestamp (milliseconds)?**
- Chart.js performs best with numeric timestamps (milliseconds since epoch)
- No string parsing overhead on data values (timestamps are already numeric)
- Adapter only needed for axis label formatting, not data parsing
- Official Chart.js recommendation: "use timestamps for best performance"

**Note on Date Adapter:**
- Chart.js `type: 'time'` **requires** a date adapter (e.g., `chartjs-adapter-date-fns`)
- Adapter is used for formatting axis labels (e.g., "Jan 15, 2024"), not parsing data
- Using numeric timestamps (vs ISO strings) minimizes adapter overhead
- Total bundle impact: ~10KB for adapter + date-fns (unavoidable for time scale)

**Numeric Enforcement Pattern:**
```sql
-- Handle non-numeric values and normalize formats
-- Common patterns in Russian labs: "< 2", "0.04 R", "15/+-", "не обнаружен"
-- Note: Some labs use comma as decimal separator (25,3) - normalize to dot
WITH sanitized AS (
  SELECT
    pr.recognized_at,
    lr.unit,
    -- Step 1: Remove comparison operators and text suffixes
    regexp_replace(lr.result_value, '^[<>≤≥]\s*', '', 'g') AS cleaned,
    lr.result_value AS original
  FROM lab_results lr
  JOIN patient_reports pr ON pr.id = lr.report_id
  WHERE lr.parameter_name % 'витамин D'
)
SELECT
  EXTRACT(EPOCH FROM recognized_at)::bigint * 1000 AS t,
  -- Step 2: Normalize comma to dot, remove trailing text, keep minus sign
  NULLIF(
    regexp_replace(
      regexp_replace(cleaned, ',', '.', 'g'),  -- Comma → dot
      '\s*[A-Za-zА-Яа-я/*+_-]+$', '', 'g'     -- Remove trailing text/symbols
    ),
    ''
  )::numeric AS y,
  unit
FROM sanitized
WHERE NULLIF(
  regexp_replace(
    regexp_replace(cleaned, ',', '.', 'g'),
    '\s*[A-Za-zА-Яа-я/*+_-]+$', '', 'g'
  ),
  ''
) IS NOT NULL
  AND cleaned ~ '^-?[0-9]'  -- Must start with digit or minus+digit
ORDER BY t ASC
LIMIT 5000;
```

**Sanitization Rules:**
1. Strip comparison operators: `< 2` → `2`, `> 0.5` → `0.5`
2. Normalize decimals: `25,3` → `25.3` (Russian format)
3. Remove trailing non-numeric text: `0.04 R` → `0.04`, `15/+-` → `15`, `12.3 (normal)` → `12.3`
4. Preserve negative sign: `-0.8` stays `-0.8`
5. Reject text values: `не обнаружен`, `отрицательный` → NULL

**Regex Pattern Explanation:**
- `^[<>≤≥]\s*` - Strips leading comparison operators
- `',', '.'` - Normalizes Russian decimal comma to dot
- `\s*[A-Za-zА-Яа-я/*+_-]+$` - Removes trailing text/symbols (including Cyrillic)
- `^-?[0-9]` - Validates result starts with optional minus + digit

**Known Edge Cases:**
- Parenthetical notes: `12.3 (normal)` - **Current regex does NOT handle this**
- Ranges: `5.0-7.0` - Would become `5.0` (keeps first number)
- Multiple numbers: `120/80` - Would become `120` (keeps first)
- Scientific notation: `1.2e-5` - Would fail (`e` stripped)

**Note:** Current database has NO parentheses or scientific notation. Regex is optimized for observed patterns. If these appear in future, use this improved pattern:

**Alternative Robust Regex (handles all edge cases):**
```sql
-- More defensive: removes everything after first non-numeric character
NULLIF(
  regexp_replace(
    regexp_replace(
      regexp_replace(lr.result_value, '^[<>≤≥]\s*', '', 'g'),  -- Remove operators
      ',', '.', 'g'  -- Normalize decimal
    ),
    '\s*[^0-9.-].*$', '', 'g'  -- Remove EVERYTHING after first non-digit/dot/minus
  ),
  ''
)::numeric

-- This handles: "12.3 (normal)" → "12.3", "1.2e-5" → "1.2", "120/80" → "120"
```

**Multi-Unit Handling (MVP):**
- Return `unit` column as-is
- Frontend splits series by `unit` (e.g., "μg/L" vs "ng/mL")
- **Future:** Normalize to most common unit or allow user selection

**Example A: Plot Query**
```sql
WITH sanitized AS (
  SELECT
    pr.recognized_at,
    lr.unit,
    regexp_replace(lr.result_value, '^[<>≤≥]\s*', '', 'g') AS cleaned
  FROM lab_results lr
  JOIN patient_reports pr ON pr.id = lr.report_id
  WHERE lr.parameter_name % 'витамин D'
)
SELECT
  EXTRACT(EPOCH FROM recognized_at)::bigint * 1000 AS t,
  NULLIF(
    regexp_replace(
      regexp_replace(cleaned, ',', '.', 'g'),
      '\s*[A-Za-zА-Яа-я/*+_-]+$', '', 'g'
    ),
    ''
  )::numeric AS y,
  unit
FROM sanitized
WHERE NULLIF(
  regexp_replace(
    regexp_replace(cleaned, ',', '.', 'g'),
    '\s*[A-Za-zА-Яа-я/*+_-]+$', '', 'g'
  ),
  ''
) IS NOT NULL
  AND cleaned ~ '^-?[0-9]'
ORDER BY t ASC
LIMIT 5000;
```

**Example B: Data Query (Normal Table)**
```sql
SELECT
  lr.parameter_name,
  lr.result_value,
  lr.unit,
  pr.recognized_at
FROM lab_results lr
JOIN patient_reports pr ON pr.id = lr.report_id
WHERE lr.parameter_name % 'холестерин'
ORDER BY pr.recognized_at DESC
LIMIT 50;
```

---

### 4. Response Schema (Aligned with Current Orchestrator)

The response follows the existing `{ ok: true }` envelope from `agenticSqlGenerator.js`:

**Plot Query Response:**
```json
{
  "ok": true,
  "sql": "SELECT EXTRACT(EPOCH FROM pr.recognized_at)::bigint * 1000 AS t, ...",
  "explanation": "График показывает, как уровень витамина D менялся со временем.",
  "query_type": "plot_query",
  "plot_metadata": {
    "x_axis": "t",
    "y_axis": "y",
    "series_by": "unit"
  },
  "metadata": {
    "model": "gpt-5-mini",
    "duration_ms": 4523,
    "schema_snapshot_id": "abc123",
    "validator": "v1",
    "agentic": {
      "iterations": 2,
      "forced_completion": false
    }
  }
}
```

**Data Query Response (Unchanged):**
```json
{
  "ok": true,
  "sql": "SELECT lr.parameter_name, lr.result_value, ...",
  "explanation": "Таблица показывает все анализы на холестерин.",
  "query_type": "data_query",
  "metadata": { ... }
}
```

**Fields:**
- `query_type` → `"plot_query"` | `"data_query"` (new, optional for backward compatibility)
- `plot_metadata` → Only present when `query_type = "plot_query"`

---

### 5. Tool Definition Updates

**No new tool.** Instead, extend the existing `generate_final_query` tool parameters:

```javascript
{
  type: "function",
  function: {
    name: "generate_final_query",
    description: "Generate the final SQL query to answer the user's question. Specify query_type='plot_query' if generating time-series data for visualization.",
    parameters: {
      type: "object",
      properties: {
        sql: {
          type: "string",
          description: "The final SQL query"
        },
        explanation: {
          type: "string",
          description: "Brief explanation in user's language"
        },
        confidence: {
          type: "string",
          enum: ["high", "medium", "low"]
        },
        query_type: {
          type: "string",
          enum: ["data_query", "plot_query"],
          description: "Type of query: data_query for tables, plot_query for time-series visualization"
        },
        plot_metadata: {
          type: "object",
          description: "Required if query_type='plot_query'. Specifies column mapping for plotting.",
          properties: {
            x_axis: { type: "string", default: "t" },
            y_axis: { type: "string", default: "y" },
            series_by: { type: "string", default: "unit" }
          }
        }
      },
      required: ["sql", "explanation", "confidence"],
      // Conditional requirement: plot_metadata required when query_type='plot_query'
      // Note: OpenAI function calling doesn't support JSON Schema conditionals,
      // so this must be validated in handleFinalQuery() backend code
    }
  }
}
```

**Backend Validation Flow:**

The validation happens in `handleFinalQuery()` with a **retry-then-fallback** strategy:

```javascript
// Step 1: Validate plot_metadata presence (first attempt only)
if (params.query_type === 'plot_query' && !params.plot_metadata && retryCount === 0) {
  logger.warn({
    request_id: requestId,
    message: 'plot_metadata missing, requesting retry'
  }, '[agenticSql] Plot metadata validation failed');

  return {
    retry: true,
    retryCount: retryCount + 1,
    validationError: [{
      code: 'PLOT_METADATA_MISSING',
      message: 'plot_metadata is required when query_type is plot_query. Please include: { x_axis: "t", y_axis: "y", series_by: "unit" }'
    }]
  };
}

// Step 2: Apply defaults if still missing after retry (safety net)
if (params.query_type === 'plot_query' && !params.plot_metadata) {
  logger.info({
    request_id: requestId,
    message: 'Applying default plot_metadata after retry'
  }, '[agenticSql] Using fallback plot metadata');

  params.plot_metadata = {
    x_axis: 't',
    y_axis: 'y',
    series_by: 'unit'
  };
}

// Continue with SQL validation...
```

**Flow Summary:**
1. **First attempt:** LLM generates `query_type='plot_query'` but omits `plot_metadata`
2. **→ Retry:** Backend returns validation error, LLM tries again with metadata
3. **If retry succeeds:** Proceed normally ✅
4. **If retry fails/times out:** Apply default metadata as safety net ✅
5. **Continue:** Validate SQL and return response

**Backward Compatibility & Defaults:**
- `query_type` is optional (defaults to `data_query` if omitted)
- `plot_metadata` triggers retry once, then falls back to defaults
- System prompt emphasizes including `plot_metadata` to avoid retry overhead

---

### 6. Validation Enhancements

Extend `sqlValidator.js` with lightweight plot-specific checks:

**Plot Query Validation Rules:**
1. Must include columns named `t` and `y` (case-insensitive)
2. Must have `ORDER BY t` (ascending or descending)
3. Column `t` should be bigint (Unix timestamp in milliseconds)
4. Column `y` must be `::numeric`
5. Must exclude `NULL` values in `WHERE` clause (detect `IS NOT NULL` pattern)

**Implementation Suggestion:**
```javascript
// In sqlValidator.js
function validatePlotQuery(sql, metadata) {
  if (metadata.query_type !== 'plot_query') return { valid: true };

  const lowerSql = sql.toLowerCase();

  // Check for required columns
  if (!lowerSql.includes(' as t') || !lowerSql.includes(' as y')) {
    return {
      valid: false,
      violations: [{ code: 'PLOT_MISSING_COLUMNS', message: 'Plot queries must include columns named t and y' }]
    };
  }

  // Check for ORDER BY t
  if (!lowerSql.includes('order by t')) {
    return {
      valid: false,
      violations: [{ code: 'PLOT_MISSING_ORDER', message: 'Plot queries must include ORDER BY t' }]
    };
  }

  // Check for numeric casting
  if (!lowerSql.includes('::numeric')) {
    return {
      valid: false,
      violations: [{ code: 'PLOT_MISSING_CAST', message: 'y column must be cast to numeric' }]
    };
  }

  return { valid: true };
}
```

---

### 7. Frontend Integration

**Plotting Library:** [Chart.js](https://www.chartjs.org/) (vanilla JavaScript)

**Installation:**
```bash
npm install chart.js chartjs-adapter-date-fns date-fns
```

**Why date-fns Adapter?**
- Required for Chart.js `type: 'time'` axis (even with numeric timestamps)
- Smallest adapter option (~10KB gzipped with date-fns)
- Handles date formatting and localization for axis labels
- SQL returns numeric timestamps (ms) → adapter formats display labels only

**Behavior:**
- If `response.query_type === "plot_query"`:
  1. Execute SQL via existing backend endpoint
  2. Parse rows as `{ t: number, y: number, unit: string }[]` (t is already numeric!)
  3. Group by `unit` to create multiple datasets (series)
  4. Render using Chart.js `line` chart

**Chart Configuration:**
```javascript
import Chart from 'chart.js/auto';
import 'chartjs-adapter-date-fns';  // REQUIRED for time scale

// Group data by unit
function groupByUnit(rows) {
  const groups = {};
  rows.forEach(row => {
    const unit = row.unit || 'unknown';
    if (!groups[unit]) {
      groups[unit] = [];
    }
    groups[unit].push({ x: row.t, y: parseFloat(row.y) });  // x is numeric timestamp!
  });
  return Object.entries(groups).map(([unit, points]) => ({ unit, points }));
}

// Create chart
const canvas = document.getElementById('plotCanvas');
const ctx = canvas.getContext('2d');

const COLORS = ['#4BC0C0', '#FF6384', '#36A2EB', '#FFCE56', '#9966FF'];

const datasets = groupByUnit(rows).map((series, i) => ({
  label: series.unit,
  data: series.points,  // Already in { x: number, y: number } format
  borderColor: COLORS[i % COLORS.length],
  backgroundColor: COLORS[i % COLORS.length] + '33', // 20% opacity
  tension: 0.1
}));

const chart = new Chart(ctx, {
  type: 'line',
  data: { datasets },
  options: {
    scales: {
      x: {
        type: 'time',  // Chart.js converts ms timestamps to dates automatically
        time: {
          unit: 'day',
          displayFormats: {
            day: 'MMM dd, yyyy'
          }
        },
        title: { display: true, text: 'Date' }
      },
      y: {
        beginAtZero: false,
        title: { display: true, text: 'Value' }
      }
    },
    plugins: {
      tooltip: {
        callbacks: {
          label: (ctx) => `${ctx.parsed.y} ${ctx.dataset.label}`
        }
      },
      legend: {
        display: true,
        position: 'top'
      }
    }
  }
});
```

**Multi-Unit Handling:**
- Each unique `unit` value becomes a separate colored line
- Tooltip shows: date, value, unit
- Legend shows unit labels

**Fallback:**
- If plot rendering fails → fall back to table display
- If SQL returns 0 rows → show "No data available for plotting"

---

## Design Principles
- **Autonomous decision-making:** LLM decides when plotting is meaningful based on user intent.
- **Explainable behavior:** Agent must always include an explanation string.
- **Safety parity:** Plotting queries go through the same validation pipeline + plot-specific checks.
- **Seamless fallback:** If plotting fails, revert to textual results.
- **Performance first:** Total end-to-end < 15s.

---

## Performance Requirements

| Stage | Target | Strategy |
|-------|--------|----------|
| SQL generation (incl. intent) | < 10s | Existing agentic loop (with 120s timeout buffer) |
| SQL execution | < 2s | Use existing indexes (trigram on `parameter_name`) |
| Chart rendering | < 1s | Frontend Chart.js render |
| **Total end-to-end** | **< 15s** | From user request to visible chart |

---

## Out of Scope (Future)
- Multi-analyte comparison on one chart
- Dynamic unit normalization (auto-convert μg/L → ng/mL)
- Aggregation (weekly/monthly averages)
- Caching of time-series data
- Interactive clarification (`request_clarification` tool)
- Per-patient filtering (session-based context)

---

## Success Criteria
| Metric | Target |
|--------|---------|
| Intent classification accuracy | ≥ 90% on test set |
| Plot SQL validation success | ≥ 95% |
| Average iterations | ≤ 3 |
| Plot render time (end-to-end) | **< 15s** |
| User satisfaction (plot relevance) | ≥ 80% positive feedback |

---

## Deliverables
1. **Backend:**
   - Updated `agenticSqlGenerator.js` with intent detection logic
   - Extended `generate_final_query` tool with `query_type` and `plot_metadata` parameters
   - Updated system prompt to include plot query guidance
   - Extended `sqlValidator.js` with plot-specific validation rules

2. **Frontend:**
   - Chart.js integration (vanilla JavaScript + chartjs-adapter-date-fns)
   - Response handler for `query_type === "plot_query"`
   - Multi-unit series rendering with color-coded datasets
   - Fallback to table view on error

3. **Documentation:**
   - Updated API docs with new response schema
   - Example queries for both plot and data modes
   - Frontend integration guide

---

## Implementation Notes

### System Prompt Update
Add to the existing system prompt in `agenticSqlGenerator.js`:

```
Plot Query Detection:
- Detect if user is asking about trends, changes over time, or visualization
- Examples: "график", "динамика", "изменение", "trend", "over time", "как менялся"
- When detected, generate time-series SQL and set query_type='plot_query'
- Plot queries MUST return columns: t (bigint ms timestamp), y (numeric), unit (text)
- Use EXTRACT(EPOCH FROM timestamp)::bigint * 1000 for t column
- Use multi-step sanitization for y column (see example below)
- Always ORDER BY t ASC
- IMPORTANT: Always include plot_metadata when query_type='plot_query'

Value Sanitization (handles "< 2", "0.04 R", "25,3", negative values):
WITH sanitized AS (
  SELECT
    pr.recognized_at,
    lr.unit,
    regexp_replace(lr.result_value, '^[<>≤≥]\s*', '', 'g') AS cleaned
  FROM lab_results lr
  JOIN patient_reports pr ON pr.id = lr.report_id
  WHERE lr.parameter_name % 'витамин D'
)
SELECT
  EXTRACT(EPOCH FROM recognized_at)::bigint * 1000 AS t,
  NULLIF(
    regexp_replace(
      regexp_replace(cleaned, ',', '.', 'g'),
      '\s*[A-Za-zА-Яа-я/*+_-]+$', '', 'g'
    ),
    ''
  )::numeric AS y,
  unit
FROM sanitized
WHERE NULLIF(...) IS NOT NULL AND cleaned ~ '^-?[0-9]'
ORDER BY t ASC LIMIT 5000;

When calling generate_final_query, include:
{
  "query_type": "plot_query",
  "plot_metadata": {
    "x_axis": "t",
    "y_axis": "y",
    "series_by": "unit"
  }
}
```

### Intent Detection Implementation
Intent detection is handled entirely by the LLM within the agentic loop. No pre-processing or keyword matching needed - the system prompt instructs the LLM to recognize plot-intent queries and set `query_type` accordingly.

---

## Appendix: Real Lab Data Patterns

**Non-Numeric Value Patterns Found in Database** (ordered by frequency):
1. `не обнаружены` (not detected) - 4 occurrences
2. `не обнаружен` (not detected, different form) - 3 occurrences
3. `отрицательный` (negative) - 2 occurrences
4. `< 2` (below threshold) - 1 occurrence
5. `0.04 R`, `0.21 R`, `0.677 R` (numeric + reference flag) - 3 occurrences
6. `1.04*` (numeric + asterisk flag) - 1 occurrence
7. `15/+-` (numeric + uncertainty) - 1 occurrence
8. `желтый` (color description) - 1 occurrence
9. `прозрачная/-` (appearance description) - 1 occurrence

**Key Insights:**
- No comma decimal separators found in current dataset (Russian format `25,3` not present yet)
- Text values (не обнаружены, отрицательный) are most common non-numeric pattern
- Comparison operators rare (only `< 2`)
- Reference flags (`R`, `*`, `/+-`) appear as suffixes
- All numeric values use dot (`.`) as decimal separator
- No negative numeric values found (only text "отрицательный")

**Sanitization Must Handle:**
1. ✅ Text values → NULL (не обнаружены, отрицательный, желтый)
2. ✅ Comparison operators → strip (`< 2` → `2`)
3. ✅ Trailing flags → strip (`0.04 R` → `0.04`)
4. ✅ Future-proof for comma decimals (even if not present yet)
5. ✅ Preserve negative sign for future numeric negatives  
