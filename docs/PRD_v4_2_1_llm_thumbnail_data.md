# PRD v4.2.1 — LLM Thumbnail & Separated Data Flow

## Status
**Implemented** — reflects current production code

---

## Parent PRD
Supersedes the original PRD v4.2.1 draft. Implements PRD v4.2 (Chat Plot Thumbnails) with a simplified, LLM-driven architecture.

---

## Motivation

The original PRD v4.2 specified backend-computed thumbnails. During implementation, we refactored to a cleaner architecture that:

1. **Separates concerns**: Data fetching vs. display are separate operations
2. **Enables parallelism**: `show_plot` and `show_thumbnail` can execute simultaneously
3. **Gives LLM full control**: LLM sees data first, then decides how to present it
4. **Improves UX**: Thumbnail and plot appear together, not sequentially

---

## Architecture

### Before (original design)
```
show_plot(sql) → executes SQL → sends to frontend → returns data to LLM
                                                   → LLM calls update_thumbnail (sequential)
```

### After (implemented)
```
execute_sql(sql, query_type="plot") → returns data to LLM
                                    ↓
             LLM can call BOTH in parallel:
             ├── show_plot(data) → sends plot to frontend
             └── show_thumbnail(...) → sends thumbnail to chat
```

---

## Tool Changes

| Tool | Before | After |
|------|--------|-------|
| `execute_exploratory_sql` | 20 rows only | Renamed to `execute_sql` with `query_type`: `explore` (20), `plot` (200), `table` (50) |
| `show_plot` | Receives SQL, executes it | Receives `data` array, just displays |
| `show_table` | Receives SQL, executes it | Receives `data` array, just displays |
| `update_thumbnail` | Called sequentially after `show_plot` | Renamed to `show_thumbnail`, callable in parallel |

---

## Non-Goals (Explicit)

- ~~Backend fallback derivation~~ (removed — LLM is solely responsible)
- Sparkline series data (no `series` array in thumbnail)
- `thumbnailDerivation.js` utility (not implemented)

---

## Thumbnail Contract

The LLM calls `show_thumbnail` as a **separate tool** (not embedded in `show_plot`).

```ts
// show_thumbnail parameters
{
  plot_title: string,            // required - matches associated plot
  latest_value?: number | null,  // most recent value
  unit?: string | null,          // unit of measurement
  status: "normal" | "high" | "low" | "unknown",  // required
  delta_pct?: number | null,     // percentage change (e.g., -12)
  delta_direction?: "up" | "down" | "stable" | null,
  delta_period?: string | null   // human-readable (e.g., "2y", "6m")
}
```

### Required Fields
- `plot_title`
- `status`

All other fields are optional and may be `null`.

---

## SSE Events

Two separate events are emitted:

### 1. `plot_result` (from `show_plot`)
```json
{
  "type": "plot_result",
  "plot_title": "Vitamin D",
  "rows": [...],
  "replace_previous": false
}
```

### 2. `thumbnail_update` (from `show_thumbnail`)
```json
{
  "type": "thumbnail_update",
  "plot_title": "Vitamin D",
  "thumbnail": {
    "title": "Vitamin D",
    "latest_value": 42.5,
    "unit": "ng/ml",
    "status": "normal",
    "delta_pct": -15,
    "delta_direction": "down",
    "delta_period": "2y"
  }
}
```

---

## LLM Workflow

The system prompt instructs the LLM to:

### Step 1: Search (if needed)
```
fuzzy_search_analyte_names(search_term="холестерин")
```

### Step 2: Fetch data
```
execute_sql(
  sql="SELECT ... FROM lab_results ... ORDER BY t ASC",
  reasoning="Get cholesterol history for plot",
  query_type="plot"
)
```

### Step 3: Display (IN PARALLEL)
```
// LLM analyzes data from Step 2, then calls BOTH:
show_plot(data=[...], plot_title="Холестерин")
show_thumbnail(
  plot_title="Холестерин",
  latest_value=5.2,
  unit="ммоль/л",
  status="normal",
  delta_pct=-15,
  delta_direction="down",
  delta_period="2y"
)
```

---

## Thumbnail Derivation (LLM Responsibility)

The LLM derives thumbnail fields from the `execute_sql` result:

| Field | Derivation |
|-------|-----------|
| `plot_title` | Short name for parameter (max 30 chars) |
| `latest_value` | Row with highest `t` (timestamp), use its `y` value |
| `unit` | From data |
| `status` | Compare `latest_value` to `reference_lower`/`reference_upper`: `high` if above, `low` if below, `normal` if in range, `unknown` if no reference |
| `delta_pct` | `round(((newest_y - oldest_y) / abs(oldest_y)) * 100)`, `null` if 1 point or oldest=0 |
| `delta_direction` | `up` if delta > 1%, `down` if delta < -1%, `stable` otherwise |
| `delta_period` | Time span: `2y`, `6m`, `3w`, `5d` |

### Multi-Series
If data contains multiple `parameter_name` values, compute thumbnail for the **first alphabetically** or the most clinically relevant.

---

## Fallback Behavior

If LLM omits `show_thumbnail` call:
- **No thumbnail is displayed** (no backend fallback)
- Plot renders normally
- This is acceptable — thumbnail is an enhancement, not critical

---

## Implementation Files

| File | Changes |
|------|---------|
| `prompts/agentic_sql_generator_system_prompt.txt` | New workflow: `execute_sql` → display tools |
| `server/services/agenticTools.js` | New `execute_sql`, `show_thumbnail` tools; updated `show_plot`/`show_table` |
| `server/routes/chatStream.js` | New `handleShowThumbnail()`, updated handlers to receive data |
| `server/services/agenticCore.js` | Routes `execute_sql` tool |
| `server/services/agenticSqlGenerator.js` | Supports both `execute_sql` and legacy `execute_exploratory_sql` |

---

## Success Criteria

- [x] `execute_sql` tool replaces `execute_exploratory_sql` with `query_type` parameter
- [x] `show_plot` and `show_table` receive pre-fetched data arrays
- [x] `show_thumbnail` tool sends thumbnail via separate SSE event
- [x] LLM can call `show_plot` and `show_thumbnail` in parallel
- [x] System prompt documents the new workflow
- [x] No regressions in existing plot/table generation

---

## Explicit Future Work (PRD v4.2.2)

- Frontend `ChatPlotThumbnail` component rendering
- Sparkline visualization (requires `series` array)
- Thumbnail ↔ plot visual linking
- Click/hover interactions
