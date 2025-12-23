# PRD v4.2.2 — Thumbnail Contract Expansion + Backend Derivation

## Status
**Planned** — next implementation step after v4.2.1 (non-prod; no production users)

## Parent PRDs
- Builds on **PRD v4.2 (MVP) — Chat Plot Thumbnails**
- Extends **PRD v4.2.1 — LLM Thumbnail & Separated Data Flow (Implemented)**

---

## Motivation

PRD v4.2.1 shipped a working split of concerns (`execute_sql` → LLM decides → `show_plot` + `show_thumbnail`). However:

1. **Dual tools create correlation problems**: Which plot data goes with which thumbnail?
2. **LLM-provided thumbnail data is insufficient**: Missing sparkline series, point counts, delta calculations
3. **Race conditions**: Parallel tool calls can emit out-of-order events

This PRD:
- Merges `show_thumbnail` into `show_plot` (unified tool, no correlation issues)
- Moves mechanical derivations to backend (sparkline, counts, deltas)
- LLM provides only high-level config (focus series, status)

---

## Goals

### Primary
- Unify `show_plot` and `show_thumbnail` into a single tool call
- Backend derives: sparkline series, point counts, delta calculations, unit handling
- LLM provides: status, focus analyte selection
- Eliminate tool correlation/ordering issues

### Secondary
- Keep scope MVP-friendly: no database normalization, no unit conversion

---

## Non-Goals

- Normalizing historical lab units across the database
- Merging/repairing mixed-unit timelines
- Building the chat UI rendering (that's v4.2.3)
- Changing how plots are rendered today
- Supporting thumbnail replacement (`replace_previous` for thumbnails deferred to future)
- Adding message lifecycle events (deferred until frontend needs anchoring)

---

## Architecture Change: Unified Tool

### Before (v4.2.1)
```
execute_sql(sql, query_type="plot") → returns data to LLM
                                    ↓
             LLM calls BOTH in parallel:
             ├── show_plot(data) → sends plot to frontend
             └── show_thumbnail(...) → sends thumbnail to chat
```

### After (v4.2.2)
```
execute_sql(sql, query_type="plot") → returns data to LLM
                                    ↓
             LLM calls ONE tool:
             └── show_plot(data, thumbnail_config?) → backend emits both plot + thumbnail
```

**Rationale:**
- Backend derives thumbnail fields from plot data (no correlation issue)
- Single tool call ensures data and config arrive together
- No race conditions from parallel tool execution

---

## Implementation Guide

### 1. Remove `show_thumbnail` Tool

**File**: `server/services/agenticTools.js`

Delete the entire `show_thumbnail` tool definition (currently lines ~510-580).

**File**: `server/routes/chatStream.js`

1. Delete dispatcher branch for `show_thumbnail` (in `executeToolCalls()`)
2. Delete `handleShowThumbnail()` function (currently lines ~950-1020)

**File**: `prompts/agentic_sql_generator_system_prompt.txt`

Remove all `show_thumbnail` references:
- Delete from display tools list
- Delete "Call in PARALLEL with show_thumbnail" instructions
- Delete entire `show_thumbnail` tool description section
- Update examples to show only `show_plot` with optional thumbnail config
- Add an explicit note that `show_plot` returning an empty array is SUCCESSFUL and the LLM should not retry; instead, narrate “no data” to the user.

Add guidance:
```
## show_plot Tool

Use `show_plot` to display time-series charts. You may optionally include
a `thumbnail` config to render a chart thumbnail in the chat stream.

Example with thumbnail:
show_plot({
  data: [...],  // from execute_sql with query_type="plot"
  plot_title: "Vitamin D Trend",
  thumbnail: {
    focus_analyte_name: "Vitamin D (25-OH)",  // for multi-analyte plots
    status: "normal"  // or "high", "low", "unknown"
  }
})

Example without thumbnail (full plot only):
show_plot({
  data: [...],
  plot_title: "Lipid Panel Overview"
})

Guidelines:
- Use unique, descriptive plot titles
- For multi-analyte plots, specify focus_analyte_name to highlight primary series
- Set status based on latest value vs reference ranges; use "unknown" if uncertain
- Omit thumbnail config if you only want to show the full plot panel
- If execute_sql returns an empty array, still call show_plot once; do not retry solely because the result is empty.
```

### 2. Update `show_plot` Tool Schema

**File**: `server/services/agenticTools.js`

```javascript
{
  name: 'show_plot',
  description: "Display pre-fetched data as a time-series plot in the UI. Optionally include thumbnail config to show a compact summary in chat. Call execute_sql with query_type='plot' first to get the data, then pass that data here.",
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      data: {
        type: 'array',
        items: {
          type: 'object',
          // NOTE: No additionalProperties: false on items to allow DB schema evolution
          // (e.g., reference_lower_operator, reference_upper_operator, is_value_out_of_range)
          properties: {
            t: {
              oneOf: [
                { type: 'string', description: 'ISO 8601 timestamp' },
                { type: 'number', description: 'Epoch seconds or milliseconds' }
              ]
            },
            y: { type: 'number' },
            parameter_name: { type: 'string' },
            unit: { type: 'string' },
            reference_lower: { type: 'number' },
            reference_upper: { type: 'number' },
            is_out_of_range: { type: 'boolean' }
          },
          required: ['t', 'y', 'parameter_name', 'unit']
        }
      },
      plot_title: { type: 'string' },
      replace_previous: { type: 'boolean' },
      thumbnail: {
        type: 'object',
        properties: {
          focus_analyte_name: { type: 'string' },
          status: {
            type: 'string',
            enum: ['normal', 'high', 'low', 'unknown']
          }
        }
        // NOTE: status is optional - backend defaults to 'unknown' if omitted
        // This allows graceful degradation if LLM forgets the field
      }
    },
    required: ['data', 'plot_title']
  }
}
```

**Field Notes**:
- **PlotRow additionalProperties**: NOT restricted to allow DB schema evolution (e.g., `reference_lower_operator`, `is_value_out_of_range` from SQL)
- `is_out_of_range`: Legacy field consumed by `plotRenderer.js` for red highlighting. Backend computes if missing.
- `thumbnail`: Optional config. If omitted, no thumbnail emitted.
- `thumbnail` allows extra hint fields from the LLM (e.g., confidence, rationale); backend ignores unknown fields.
- `thumbnail.status`: Optional. Backend defaults to 'unknown' if omitted (graceful degradation).
- `thumbnail.focus_analyte_name`: Optional. For multi-analyte plots, specifies which series to feature.

### 3. Update `handleShowPlot` in chatStream.js

**File**: `server/routes/chatStream.js`

#### 3.1 Add imports

```javascript
import crypto from 'crypto';
import {
  preprocessData,
  deriveThumbnail,
  deriveEmptyThumbnail,
  validateThumbnailConfig,
  normalizeRowsForFrontend,
  ensureOutOfRangeField
} from '../utils/thumbnailDerivation.js';
```

#### 3.2 Update handler signature (no context change needed)

The handler already receives `session`, `params`, `toolCallId`. No signature change needed.

#### 3.3 Update handler logic (runnable outline)

```javascript
async function handleShowPlot(session, params, toolCallId) {
  const { data, plot_title, replace_previous, thumbnail: thumbnailConfig } = params;
  const res = session.sseResponse;

  // Step 1: Guard against invalid data type (defensive against schema validation failures)
  if (!Array.isArray(data)) {
    logger.warn('[handleShowPlot] Invalid data type:', {
      session_id: session.id,
      plot_title,
      data_type: typeof data,
      data_is_null: data === null
    });

    if (res) {
      streamEvent(res, {
        type: 'plot_result',
        plot_title,
        rows: [],
        replace_previous: true
      });
    }

    if (thumbnailConfig && res) {
      streamEvent(res, {
        type: 'thumbnail_update',
        plot_title,
        result_id: crypto.randomUUID(),
        thumbnail: deriveEmptyThumbnail(plot_title),
        replace_previous: true
      });
    }

    session.messages.push({
      role: 'tool',
      tool_call_id: toolCallId,
      content: JSON.stringify({
        success: false,
        error: 'Invalid data format - expected array',
        display_type: 'plot',
        plot_title
      })
    });
    return;
  }

  // Step 2: Validate and preprocess data (filters invalid rows, sorts by timestamp)
  const preprocessed = preprocessData(data);

  // Step 3: Normalize timestamps to epoch ms
  const normalizedRows = normalizeRowsForFrontend(preprocessed);

  // Step 4: Compute is_out_of_range/is_value_out_of_range if missing (backward compat)
  const rowsWithOutOfRange = ensureOutOfRangeField(normalizedRows);

  // Step 5: Emit plot_result (always, even if data is empty after filtering)
  if (res) {
    streamEvent(res, {
      type: 'plot_result',
      plot_title,
      rows: rowsWithOutOfRange,
      replace_previous: replace_previous || false
    });
  }

  // Step 6: If thumbnail config provided, derive using the same sanitized rows
  if (thumbnailConfig) {
    const validation = validateThumbnailConfig(thumbnailConfig);
    if (!validation.valid) {
      logger.warn('[handleShowPlot] Invalid thumbnail config:', {
        session_id: session.id,
        plot_title,
        errors: validation.errors
      });
    }

    const result = deriveThumbnail({
      plot_title,
      thumbnail: thumbnailConfig,
      rows: rowsWithOutOfRange
    });

    if (result && res) {
      streamEvent(res, {
        type: 'thumbnail_update',
        plot_title,
        result_id: result.resultId,
        thumbnail: result.thumbnail
      });
    }
  }

  // Step 7: Push tool response to session.messages
  session.messages.push({
    role: 'tool',
    tool_call_id: toolCallId,
    content: JSON.stringify({
      success: true,
      display_type: 'plot',
      plot_title,
      row_count: preprocessed.length,
      message: preprocessed.length > 0 ? 'Plot displayed successfully' : 'Empty result displayed'
    })
  });
}
```

### 4. Create Thumbnail Derivation Module

**File**: `server/utils/thumbnailDerivation.js`

This module contains all thumbnail derivation logic (pure functions, no SSE emission).

#### 4.1 Exports

```javascript
import crypto from 'crypto';

export {
  parseTimestamp,
  filterValidRows,
  sortByTimestamp,
  preprocessData,
  getFocusSeries,
  getUnitInfo,
  normalizeUnit,
  deriveStatus,
  deriveDeltaPct,
  deriveDeltaDirection,
  deriveDeltaPeriod,
  downsample,
  deriveEmptyThumbnail,
  deriveFallbackThumbnail,
  validateThumbnailConfig,
  deriveThumbnail,
  normalizeRowsForFrontend,
  ensureOutOfRangeField
};
```

#### 4.2 Timestamp Parsing

```javascript
/**
 * Parse timestamp to epoch milliseconds
 * @param {string|number} t - ISO 8601 string, epoch seconds, or epoch ms
 * @returns {number|null} - Epoch ms or null if invalid
 */
function parseTimestamp(t) {
  if (typeof t === 'number') {
    // Heuristic: values < 10^12 are seconds, >= 10^12 are milliseconds
    // 10^12 ms = Sept 2001, all realistic lab data falls clearly into one category
    return t < 1e12 ? t * 1000 : t;
  }
  if (typeof t === 'string') {
    // Parse ISO 8601; assume timestamps include offset or are already UTC.
    // If no offset is present, append 'Z' (backend treats them as UTC).
    // If labs send local-time strings without offsets, upstream ingestion
    // must add timezone to avoid shifts.
    let timeStr = t;
    if (!/Z$|[+-]\\d{2}:?\\d{2}$/.test(timeStr)) {
      timeStr += 'Z';
    }
    const parsed = Date.parse(timeStr);
    if (isNaN(parsed)) return null;
    return parsed;
  }
  return null;
}
```

#### 4.3 Data Preprocessing

```javascript
function filterValidRows(data) {
  return data.filter(row => {
    const t = parseTimestamp(row.t);
    const y = row.y;

    // Must have valid timestamp
    if (t === null) return false;

    // Must have finite numeric y value
    if (typeof y !== 'number' || !Number.isFinite(y)) return false;

    // Must have required string fields (schema enforces these, but defensive)
    if (typeof row.parameter_name !== 'string' || !row.parameter_name) return false;
    if (typeof row.unit !== 'string') return false;  // Allow empty string

    return true;
  });
}

function sortByTimestamp(data) {
  return data.slice().sort((a, b) => {
    return parseTimestamp(a.t) - parseTimestamp(b.t);
  });
}

function preprocessData(data) {
  const filtered = filterValidRows(data);
  const sorted = sortByTimestamp(filtered);
  return sorted;
}
```

#### 4.4 Focus Series Selection

```javascript
function getFocusSeries(data, focusAnalyteName) {
  const seriesNames = [...new Set(data.map(r => r.parameter_name))].sort();

  const focusName = (focusAnalyteName && seriesNames.includes(focusAnalyteName))
    ? focusAnalyteName
    : seriesNames[0];

  return {
    name: focusName || null,
    rows: data.filter(r => r.parameter_name === focusName)
  };
}
```

#### 4.5 Unit Handling

```javascript
function normalizeUnit(unit) {
  if (unit === null || unit === undefined || unit === '') {
    return '';
  }
  return String(unit).trim().toLowerCase();
}

function getUnitInfo(focusRows) {
  const units = focusRows.map(r => r.unit);
  const normalizedUnits = new Set(units.map(normalizeUnit));

  const isMixed = normalizedUnits.size > 1;
  const latestUnit = focusRows.length > 0
    ? focusRows[focusRows.length - 1].unit
    : null;

  // unit_display includes leading space for frontend concatenation (PRD v4.2.4)
  // Frontend renders: formattedValue + unit_display (no additional space needed)
  const unitDisplay = latestUnit ? ' ' + latestUnit : null;

  return {
    unit_raw: latestUnit,
    unit_display: unitDisplay,
    isMixed
  };
}
```

#### 4.6 Status Derivation

```javascript
/**
 * Derive status with LLM-guided, backend-validated approach
 *
 * Priority:
 * 1. Mixed units → "unknown" (data quality failure, backend override)
 * 2. LLM confident (status ≠ "unknown") → trust LLM clinical judgment
 * 3. LLM uncertain + bounds available → compute from reference ranges
 * 4. Otherwise → "unknown"
 */
function deriveStatus(llmStatus, latestValue, focusRows, isMixedUnits) {
  // Priority 1: Mixed units force unknown (backend override - data quality)
  if (isMixedUnits) return "unknown";

  // Priority 2: LLM is confident → trust clinical judgment
  if (llmStatus !== "unknown") return llmStatus;

  // Priority 3: LLM said unknown, backend computes from reference bounds
  const latestRow = focusRows[focusRows.length - 1];
  if (!latestRow) return "unknown";

  const { reference_lower, reference_upper } = latestRow;

  // Need at least one bound to compute
  if (reference_upper !== undefined && latestValue > reference_upper) return "high";
  if (reference_lower !== undefined && latestValue < reference_lower) return "low";
  if (reference_upper !== undefined || reference_lower !== undefined) return "normal";

  // Priority 4: No bounds available
  return "unknown";
}
```

#### 4.7 Delta Calculations

```javascript
function deriveDeltaPct(focusRows, isMixedUnits) {
  if (isMixedUnits) return null;
  if (focusRows.length < 2) return null;

  const firstValue = focusRows[0].y;
  const lastValue = focusRows[focusRows.length - 1].y;

  if (firstValue === 0) return null;

  return Math.round(((lastValue - firstValue) / Math.abs(firstValue)) * 100);
}

function deriveDeltaDirection(deltaPct) {
  if (deltaPct === null) return null;
  if (deltaPct > 1) return "up";
  if (deltaPct < -1) return "down";
  return "stable";
}

function deriveDeltaPeriod(focusRows, isMixedUnits) {
  if (isMixedUnits) return null;
  if (focusRows.length < 2) return null;

  const firstT = parseTimestamp(focusRows[0].t);
  const lastT = parseTimestamp(focusRows[focusRows.length - 1].t);

  const days = (lastT - firstT) / (1000 * 60 * 60 * 24);

  if (days >= 365) return `${Math.round(days / 365)}y`;
  if (days >= 30)  return `${Math.round(days / 30)}m`;
  if (days >= 7)   return `${Math.round(days / 7)}w`;
  return `${Math.round(days)}d`;
}
```

#### 4.8 Sparkline Downsampling

```javascript
function downsample(values, maxPoints = 30) {
  const n = values.length;
  if (n === 0) return [0]; // Empty data fallback
  if (n <= maxPoints) return values;

  const result = [values[0]]; // Always include first

  const middleSlots = maxPoints - 2;
  const middleValues = values.slice(1, -1);
  const stride = middleValues.length / middleSlots;

  for (let i = 0; i < middleSlots; i++) {
    result.push(middleValues[Math.floor(i * stride)]);
  }

  result.push(values[n - 1]); // Always include last
  return result;
}
```

#### 4.9 Validation

```javascript
function validateThumbnailConfig(thumbnail) {
  const errors = [];

  // Status is optional in schema - validate enum if present
  const validStatuses = ['normal', 'high', 'low', 'unknown'];
  if (thumbnail.status !== undefined && !validStatuses.includes(thumbnail.status)) {
    errors.push(`status must be one of: ${validStatuses.join(', ')}`);
  }

  if (thumbnail.focus_analyte_name !== undefined &&
      typeof thumbnail.focus_analyte_name !== 'string') {
    errors.push('focus_analyte_name must be a string if provided');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
```

#### 4.10 Empty & Fallback Thumbnails

```javascript
function deriveEmptyThumbnail(plotTitle) {
  return {
    plot_title: plotTitle,
    focus_analyte_name: null,
    point_count: 0,
    series_count: 0,
    latest_value: null,
    unit_raw: null,
    unit_display: null,
    status: "unknown",
    delta_pct: null,
    delta_direction: null,
    delta_period: null,
    sparkline: { series: [0] }
  };
}

function deriveFallbackThumbnail(plotTitle, data) {
  const preprocessed = preprocessData(data);
  const focusSeries = getFocusSeries(preprocessed, null);
  const unitInfo = getUnitInfo(focusSeries.rows);

  return {
    plot_title: plotTitle,
    focus_analyte_name: focusSeries.name,
    point_count: focusSeries.rows.length,
    series_count: new Set(preprocessed.map(r => r.parameter_name)).size,
    latest_value: focusSeries.rows.length > 0
      ? focusSeries.rows[focusSeries.rows.length - 1].y
      : null,
    unit_raw: unitInfo.unit_raw,
    unit_display: unitInfo.unit_display,
    status: "unknown",
    delta_pct: null,
    delta_direction: null,
    delta_period: null,
    sparkline: { series: downsample(focusSeries.rows.map(r => r.y)) }
  };
}
```

#### 4.11 Main Orchestrator

```javascript
/**
 * Main entry point: derive complete thumbnail from sanitized plot rows and LLM config
 * @param {Object} params - { plot_title, thumbnail, rows }
 * @returns {{ thumbnail: Object, resultId: string } | null}
 */
function deriveThumbnail(params) {
  const { rows, plot_title, thumbnail: thumbnailConfig } = params;

  // If config omitted, return null (intentional omission by LLM)
  if (!thumbnailConfig) {
    return null;
  }

  // Generate ephemeral result_id (no replacement support yet)
  const resultId = crypto.randomUUID();

  // Validate config
  const validationResult = validateThumbnailConfig(thumbnailConfig);
  if (!validationResult.valid) {
    return {
      thumbnail: deriveFallbackThumbnail(plot_title, data),
      resultId
    };
  }

  // Handle empty data
  if (!rows || rows.length === 0) {
    return {
      thumbnail: deriveEmptyThumbnail(plot_title),
      resultId
    };
  }

  // rows are already sanitized (preprocess + normalize + ensureOutOfRange)
  const focusAnalyteName = thumbnailConfig?.focus_analyte_name || null;
  const focusSeries = getFocusSeries(rows, focusAnalyteName);

  // Check for mixed units
  const unitInfo = getUnitInfo(focusSeries.rows);
  const isMixedUnits = unitInfo.isMixed;

  // Derive all fields
  const latestValue = focusSeries.rows.length > 0
    ? focusSeries.rows[focusSeries.rows.length - 1].y
    : null;

  const llmStatus = thumbnailConfig?.status || 'unknown';
  const status = deriveStatus(llmStatus, latestValue, focusSeries.rows, isMixedUnits);
  const deltaPct = deriveDeltaPct(focusSeries.rows, isMixedUnits);
  const deltaDirection = deriveDeltaDirection(deltaPct);
  const deltaPeriod = deriveDeltaPeriod(focusSeries.rows, isMixedUnits);
  const sparkline = { series: downsample(focusSeries.rows.map(r => r.y)) };

  // Assemble thumbnail
  const thumbnail = {
    plot_title,
    focus_analyte_name: focusSeries.name,
    point_count: focusSeries.rows.length,
    series_count: new Set(rows.map(r => r.parameter_name)).size,
    latest_value: latestValue,
    unit_raw: unitInfo.unit_raw,
    unit_display: unitInfo.unit_display,
    status,
    delta_pct: deltaPct,
    delta_direction: deltaDirection,
    delta_period: deltaPeriod,
    sparkline
  };

  return {
    thumbnail,
    resultId
  };
}
```

**Usage note:** Derivation expects the sanitized rows you already emitted to the UI (post-preprocess/normalize/ensureOutOfRange). Do not pass raw `data` from the tool call; this keeps thumbnail counts/status aligned with the plot payload.

#### 4.12 Frontend Compatibility Helpers

```javascript
/**
 * Normalize timestamps for frontend plot rendering
 * Frontend uses parseInt(row.t, 10) which fails on ISO strings
 */
function normalizeRowsForFrontend(rows) {
  return rows.map(row => ({
    ...row,
    t: parseTimestamp(row.t)
  }));
}

/**
 * Compute is_out_of_range for backward compatibility
 * Frontend relies on this field for red highlighting
 */
function ensureOutOfRangeField(rows) {
  return rows.map(row => {
    // If field already present, preserve it
    if (row.is_out_of_range !== undefined || row.is_value_out_of_range !== undefined) {
      return row;
    }

    // Compute from reference bounds if available
    const { reference_lower, reference_upper, y } = row;

    if ((reference_lower === undefined && reference_upper === undefined) ||
        typeof y !== 'number' || !Number.isFinite(y)) {
      return row;
    }

    let isOutOfRange = false;
    if (reference_upper !== undefined && y > reference_upper) {
      isOutOfRange = true;
    } else if (reference_lower !== undefined && y < reference_lower) {
      isOutOfRange = true;
    }

    const withFlag = {
      ...row,
      is_out_of_range: isOutOfRange
    };

    // Populate legacy alias for UI components that still read is_value_out_of_range
    if (withFlag.is_value_out_of_range === undefined) {
      withFlag.is_value_out_of_range = isOutOfRange;
    }

    return withFlag;
  });
}

// Note: Populating the legacy alias is_value_out_of_range is optional for v4.2.2 (non-prod).
// Keep this helper to avoid surprises if older UI code paths are exercised during testing.
```

### 5. Frontend Updates

**Required (noise suppression only, no UI change):** Add a noop handler so `thumbnail_update` events don’t log warnings while thumbnails are not rendered in v4.2.2 (non-prod):

```javascript
// In SSE event handler switch in public/js/chat.js (the existing SSE message listener)
case 'thumbnail_update':
  // No UI yet; intentionally ignore to avoid console warnings
  break;
```

**Optional debugging aid**: If you want to verify that `thumbnail_update` events are being emitted during v4.2.2 implementation, you can temporarily add logging to `public/js/chat.js`:

```javascript
// In SSE event handler (around line 90-150)
case 'thumbnail_update':
  console.log('[v4.2.2 DEBUG] thumbnail_update:', data);
  break;
```

This is purely for development visibility and should be removed before v4.2.3 or guarded by a simple `if (window.DEBUG_THUMBNAILS)` flag.

---

## SSE Event Schemas

### `plot_result` (unchanged)

```typescript
{
  type: "plot_result",
  plot_title: string,
  rows: PlotRow[],
  replace_previous: boolean
}

// PlotRow schema
{
  t: number,                // epoch milliseconds (UTC)
  y: number,
  parameter_name: string,
  unit: string,
  reference_lower?: number,
  reference_upper?: number,
  is_out_of_range?: boolean
}
```

### `thumbnail_update` (new)

```typescript
{
  type: "thumbnail_update",
  plot_title: string,
  result_id: string,        // UUID - NEW on every emission (see note below)
  thumbnail: Thumbnail,
  replace_previous?: boolean // Optional; true only when handler is clearing bad input
}

// Thumbnail schema
{
  plot_title: string,
  focus_analyte_name: string | null,
  point_count: number,
  series_count: number,
  latest_value: number | null,
  unit_raw: string | null,
  unit_display: string | null,
  status: "normal"|"high"|"low"|"unknown",
  delta_pct: number | null,
  delta_direction: "up"|"down"|"stable"|null,
  delta_period: string | null,  // "2y", "3m", "1w", "5d", or null
  sparkline: { series: number[] }  // 1-30 values
}
```

**Important - result_id semantics**: In v4.2.2, `result_id` is a **fresh UUID on every `thumbnail_update` emission**. The frontend MUST NOT attempt to replace previous thumbnails by matching `result_id`. Each thumbnail is independent. Thumbnail replacement support is deferred to a future PRD.

**replace_previous semantics**: Only set `replace_previous: true` when the handler is clearing an invalid payload (e.g., non-array `data`). Normal emissions omit it or set `false`.

---

## Derivation Summary

| Field | Source | Fallback |
|-------|--------|----------|
| `plot_title` | `show_plot` param | required |
| `focus_analyte_name` | LLM input | first alphabetically, or null |
| `point_count` | count of focus series rows | 0 |
| `series_count` | count distinct parameter_name | 0 |
| `latest_value` | last point by timestamp | null |
| `unit_raw` | from focus series (latest, no spacing) | null |
| `unit_display` | unit_raw with leading space prepended | null |
| `status` | LLM input, backend validates/overrides | "unknown" |
| `delta_pct` | computed from first/last values | null |
| `delta_direction` | derived from delta_pct | null |
| `delta_period` | computed from timestamps | null |
| `sparkline.series` | downsampled from focus series | [0] |
| `result_id` | crypto.randomUUID() | required |

**Status Override Rules** (priority order):
1. Mixed units → `"unknown"` (backend override)
2. LLM confident (status ≠ "unknown") → use LLM value
3. LLM uncertain + bounds available → compute from reference ranges
4. Otherwise → `"unknown"`

**Mixed Units Effect**:
When focus series has mixed units (case-insensitive comparison):
- `status` → `"unknown"`
- `delta_pct` → `null`
- `delta_direction` → `null`
- `delta_period` → `null`

---

## Validation Failure Behavior

When `thumbnail` config fails validation (e.g., status has invalid enum value):
1. Log warning with validation errors
2. Emit `plot_result` normally
3. Emit `thumbnail_update` with fallback thumbnail
4. Return `success: true` tool response

**Missing status field**: If `thumbnail.status` is omitted, it defaults to `'unknown'` (no validation error). This allows graceful degradation if the LLM forgets the field.

**Design Decision**: Return success with fallback rather than error for validation failures.

**Empty data contract change (vs current handler)**: show_plot now returns `success: true` and emits an empty plot when `data` is an empty array (after filtering). The system prompt should reflect this to avoid encouraging retries for valid-but-empty results.

**Rationale**:
- Prevents LLM retry loops and latency
- Thumbnail rendering is non-critical (visual enhancement)
- Fallback thumbnails still provide value (sparkline, counts)
- System prompt guides LLM toward correct usage

**Note**: Invalid data type (non-array) returns `success: false` to allow retry - see Invalid Data Handling section.

---

## Invalid Data Handling

When `data` parameter is not an array (object, string, null, undefined):
1. Log warning with data type information
2. Emit empty `plot_result` with `rows: []` and `replace_previous: true` to clear stale UI
3. Emit empty `thumbnail_update` with `replace_previous: true` if config provided
4. Return `success: false` tool response with error message

**Rationale for failure response**:
- Non-array data indicates a bug in query generation or tool usage
- Returning `success: false` allows LLM to see the error and retry with corrected query
- User gets empty plot as visual feedback that something went wrong
- Different from validation failures (wrong enum) which are user-facing configuration issues

**Valid empty data**: If `data` is an array but all rows are filtered out (invalid timestamps, bad y values), this is NOT an error - return `success: true` with empty plot.

---

## Test Plan

### Unit Tests (`server/utils/__tests__/thumbnailDerivation.test.js`)

Use explicit fixtures for edge cases so mixed-unit and bad-timestamp scenarios are easy to cover:
- Mixed units: two rows same analyte, units `"mg/dL"` and `"mmol/L"`
- Local-time string without offset: `"2024-02-01T10:00:00"` (ensure ingestion adds TZ or expect UTC assumption)
- Non-array payload: `{ data: { foo: 1 } }`
- Invalid y values: `NaN`, `Infinity`, `null`

**Timestamp Parsing**:
- [ ] ISO 8601 with timezone → correct epoch ms
- [ ] ISO 8601 without timezone → UTC assumed
- [ ] Epoch ms (>= 10^12) → unchanged
- [ ] Epoch seconds (< 10^12) → multiplied by 1000
- [ ] Invalid string → null

**Row Filtering**:
- [ ] Valid rows pass through
- [ ] NaN/Infinity/null y-values filtered
- [ ] Unparseable timestamps filtered
- [ ] Missing/empty parameter_name filtered
- [ ] Missing unit filtered (empty string allowed)

**Unit Detection**:
- [ ] Single unit → `isMixed: false`
- [ ] Multiple units → `isMixed: true`
- [ ] Case-insensitive comparison
- [ ] Null/empty units treated as equivalent

**Status Derivation**:
- [ ] Mixed units → `"unknown"` (overrides LLM)
- [ ] LLM confident → returns LLM value
- [ ] LLM uncertain + bounds → computes from ranges
- [ ] No bounds → `"unknown"`
- [ ] Missing status field → defaults to `"unknown"` (no validation error)

**Downsampling**:
- [ ] Empty array → `[0]`
- [ ] Array ≤ 30 → unchanged
- [ ] Array > 30 → exactly 30 elements
- [ ] First and last always preserved

**Orchestrator**:
- [ ] Valid data + config → complete thumbnail
- [ ] Empty data → empty thumbnail
- [ ] Invalid config → fallback thumbnail
- [ ] Mixed units override status

### Integration Tests

**SSE Events**:
- [ ] `plot_result` emitted for all show_plot calls
- [ ] `plot_result` contains only valid rows (no null timestamps, all y values finite)
- [ ] `thumbnail_update` emitted when config provided
- [ ] `thumbnail_update` contains all required fields
- [ ] No NaN/Infinity in numeric fields
- [ ] `plot_result` and `thumbnail` use same validated dataset (data consistency)

**Empty Data**:
- [ ] Empty plot_result with empty rows (after filtering)
- [ ] Empty thumbnail with sparkline: [0]
- [ ] Tool response still success: true

**Invalid Data Handling**:
- [ ] Non-array data (object, string, null) emits empty plot_result and thumbnail with replace_previous: true
- [ ] Non-array data returns `success: false` (not true) to allow LLM retry
- [ ] Rows with invalid timestamps (null, NaN) filtered out before emission
- [ ] Rows with invalid y values (null, NaN, Infinity) filtered out before emission
- [ ] Rows with missing parameter_name or unit filtered out before emission
- [ ] Tool response row_count matches filtered data length
- [ ] Handler never crashes on invalid input (defensive programming)

**Regression Prevention (show_thumbnail Removal)**:
- [ ] Tool definitions array contains no "show_thumbnail" entry
- [ ] chatStream.js has no `case 'show_thumbnail':` branch
- [ ] chatStream.js has no `handleShowThumbnail` function
- [ ] System prompt file has no "show_thumbnail" text (grep -i verification)
- [ ] Calling show_thumbnail would fail with "unknown tool" error

---

## Acceptance Criteria

### Tool Changes
- [ ] `show_thumbnail` removed from agenticTools.js tool definitions array
- [ ] Verify: `JSON.stringify(tools)` does not contain "show_thumbnail" string
- [ ] `show_plot` schema updated with optional `thumbnail` config
- [ ] `show_plot` schema: `additionalProperties: false` on root only; thumbnail allows extra fields; PlotRow items stay open
- [ ] `show_plot` schema: thumbnail.status is optional (no required array)
- [ ] `handleShowThumbnail` function deleted from chatStream.js
- [ ] `show_thumbnail` dispatcher branch removed from executeToolCalls
- [ ] Verify: No `case 'show_thumbnail':` in chatStream.js
- [ ] System prompt updated to remove all show_thumbnail references (6+ locations)
- [ ] Verify: System prompt file contains no "show_thumbnail" text (case-insensitive grep)
- [ ] System prompt explicitly states that empty show_plot results are successful (no retry loops)

### Derivation Module
- [ ] `thumbnailDerivation.js` created with all helper functions
- [ ] Timestamp parsing handles ISO 8601, epoch seconds, epoch ms
- [ ] Data preprocessing filters invalid rows (t, y, parameter_name, unit) and sorts by timestamp
- [ ] Focus series selection honors LLM input or defaults to alphabetical
- [ ] Unit comparison case-insensitive, null/empty treated as equivalent
- [ ] Mixed units trigger status="unknown" and delta_*=null
- [ ] Status computed from bounds only when LLM says "unknown"
- [ ] Downsampling produces 1-30 points deterministically
- [ ] Empty data produces valid thumbnail with sparkline: [0]
- [ ] `deriveEmptyThumbnail` exported for handler use

### Handler Updates
- [ ] handleShowPlot guards against non-array data with Array.isArray check
- [ ] Non-array data emits empty plot_result/thumbnail with replace_previous: true (no crash)
- [ ] Non-array data returns `success: false` in tool response (allows LLM retry)
- [ ] Valid empty data (array with 0 rows) returns `success: true`
- [ ] handleShowPlot preprocesses data (filters invalid rows, sorts by timestamp) before any emission
- [ ] handleShowPlot normalizes timestamps to epoch ms
- [ ] handleShowPlot computes is_out_of_range if missing
- [ ] handleShowPlot emits plot_result with validated data (same dataset passed into thumbnail derivation; no double-processing divergence)
- [ ] handleShowPlot emits thumbnail_update when config provided
- [ ] handleShowPlot emits fallback thumbnail on validation failure (status omitted defaults to 'unknown')
- [ ] Tool response pushed to session.messages with appropriate success flag
- [ ] Tool response row_count reflects preprocessed data length

### Frontend
- [ ] No frontend code changes required (SSE handler ignores unknown events); add noop `thumbnail_update` case in `public/js/chat.js` SSE switch to suppress console noise during v4.2.2 testing
- [ ] (Optional) Debug console.log for thumbnail_update can be added temporarily

---

## Deferred to v4.2.3

- `message_start`/`message_end` events (not needed until frontend renders thumbnails in chat)
- `anchor_msg_id` infrastructure (frontend will use tool_call_id or add message tracking then)
- `replace_previous` for thumbnails (session state tracking deferred)
- Chat thumbnail rendering (full frontend implementation)
- Thumbnail click/hover interactions

---

## Next PRD (v4.2.3)

- Frontend ChatPlotThumbnail component rendering
- Sparkline SVG rendering
- Thumbnail placement in chat messages
- Click/hover interactions to expand thumbnail to full plot
- (Optional) Add message_start/anchor_msg_id if needed for DOM linking
