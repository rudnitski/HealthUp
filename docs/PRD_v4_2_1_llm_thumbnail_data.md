# PRD v4.2.1 — LLM-Generated Thumbnail Data

## Status
Draft — pending approval

---

## Parent PRD
This is Step 1 of PRD v4.2 (Chat Plot Thumbnails). It focuses solely on having the LLM return thumbnail metadata alongside plot queries.

---

## Motivation

PRD v4.2 defines a complete thumbnail system with backend derivation, SSE transport, and frontend rendering. This is too complex for one-shot implementation.

This sub-PRD extracts the minimal first step: **get the LLM to return structured thumbnail data** when generating a plot query, with **backend fallback** to ensure accuracy. No UI changes.

---

## Goals

1. Extend agentic SQL to return thumbnail metadata with plot queries
2. Add backend fallback derivation from actual query results (hybrid approach)
3. Pass thumbnail through existing SSE for future frontend use
4. Log thumbnail data for inspection (no rendering yet)

---

## Non-Goals (Explicit)

- Frontend thumbnail rendering (PRD v4.2.2)
- New SSE event types or `anchor_msg_id` linking (PRD v4.2.2)
- Sparkline series data (simplified for v4.2.1)
- Aligning plot UI series selection with thumbnail (PRD v4.2.2)

---

## Thumbnail Contract (Simplified)

The LLM SHOULD return a `thumbnail` object when calling the `show_plot` tool. If the LLM omits it or provides incomplete data, the backend computes a fallback from actual query results.

```ts
thumbnail: {
  title: string,              // plot title (same as plot_title)
  latest_value: number | null,
  unit: string | null,
  status: "normal" | "high" | "low" | "unknown",
  delta_pct: number | null,   // percentage change (e.g., -12 for -12%)
  delta_direction: "up" | "down" | "stable" | null,
  delta_period: string | null // human-readable (e.g., "2y", "6m")
}
```

**Note:** The `_source` field is internal/debug-only and MUST NOT be included in SSE payloads or the contract.

### Multi-Series Rule

For queries returning multiple `parameter_name` values, the **backend** generates thumbnail for the **first series alphabetically** by `parameter_name`.

**Important:** This sorting is applied only for thumbnail derivation. The current plot UI renders series in backend return order and may select a different default series. Aligning the plot UI's default series selection with thumbnail is **out of scope** for v4.2.1 and will be addressed in PRD v4.2.2 if needed.

---

## Implementation

### 1. Update Agentic SQL Prompt

Extend `prompts/agentic_sql_generator_system_prompt.txt` to include thumbnail generation when calling `show_plot`.

**Anchor text:** Search for the exact line:
```
1. **show_plot** - Display time-series visualization
```

**Add the following block immediately after the show_plot bullet point description (after "you will receive the full dataset in the tool result"):**

```
   **Thumbnail Data (Recommended for show_plot):**

   When calling show_plot, you SHOULD include a "thumbnail" object in your tool call.
   The thumbnail provides a quick summary for the chat interface.

   If you have executed exploratory SQL and know the data values, include:

   thumbnail: {
     title: string,              // same as plot_title (max 30 chars)
     latest_value: number | null,
     unit: string | null,
     status: "normal" | "high" | "low" | "unknown",
     delta_pct: number | null,   // integer percentage change (e.g., -12)
     delta_direction: "up" | "down" | "stable" | null,
     delta_period: string | null // human-readable duration (e.g., "2y", "6m")
   }

   **How to derive thumbnail fields:**

   If you ran execute_exploratory_sql before show_plot, use those results:

   - title: Same as plot_title (parameter name only, max 30 chars)
   - latest_value: Most recent numeric value from the data
   - unit: Unit of measurement from the data
   - status: Compare latest_value to reference ranges:
     * "high" if latest_value > reference_upper
     * "low" if latest_value < reference_lower
     * "normal" if within range
     * "unknown" if no reference data available
   - delta_pct: Percentage change from oldest to newest value
     * Formula: round(((latest - oldest) / abs(oldest)) * 100)
     * Set to null if only 1 data point or oldest = 0
   - delta_direction:
     * "up" if delta_pct > 1
     * "down" if delta_pct < -1
     * "stable" if -1 <= delta_pct <= 1
     * null if delta_pct is null
   - delta_period: Human-readable time span between oldest and newest
     * Examples: "2y" (2 years), "6m" (6 months), "3w" (3 weeks)
     * null if only 1 data point

   **Multi-series queries:** If multiple parameter_name values exist, compute
   thumbnail for the first one alphabetically.

   **If you don't have the data yet:** You may omit thumbnail or provide partial
   data (title + status:"unknown"). The backend will compute accurate values
   from actual query results.

   **Example show_plot call with thumbnail:**

   {
     "sql": "SELECT ... FROM ...",
     "plot_title": "Vitamin D",
     "replace_previous": false,
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

### 2. Update show_plot Tool Schema

**File:** `server/services/agenticTools.js`

Add `thumbnail` as an optional parameter to the `show_plot` tool definition:

```js
{
  type: "function",
  function: {
    name: "show_plot",
    description: "Display time-series plot... (existing description)",
    parameters: {
      type: "object",
      properties: {
        sql: { type: "string", description: "..." },
        plot_title: { type: "string", description: "..." },
        replace_previous: { type: "boolean", description: "..." },
        reasoning: { type: "string", description: "..." },
        // NEW: thumbnail object (optional - backend computes fallback)
        thumbnail: {
          type: "object",
          description: "Summary data for chat thumbnail. Optional - backend computes from results if omitted.",
          properties: {
            title: { type: "string" },
            latest_value: { type: "number", nullable: true },
            unit: { type: "string", nullable: true },
            status: { type: "string", enum: ["normal", "high", "low", "unknown"] },
            delta_pct: { type: "number", nullable: true },
            delta_direction: { type: "string", enum: ["up", "down", "stable"], nullable: true },
            delta_period: { type: "string", nullable: true }
          },
          required: ["title", "status"]
        }
      },
      required: ["sql", "plot_title"]
      // NOTE: thumbnail is NOT required - backend fallback handles missing
    }
  }
}
```

### 3. Add Backend Thumbnail Derivation

**File:** `server/utils/thumbnailDerivation.js` (NEW FILE)

Create a separate utility module for testability. Route files should not export helpers directly.

**Type Coercion & Null-Handling Rules:**
- Postgres returns `t` (bigint) and numeric columns as strings in node-pg
- Rows may have `null` for `parameter_name`, `y`, `unit`, or reference columns
- Filter out rows with null/undefined `parameter_name` or non-numeric `y`
- Use `Number()` for timestamp, `parseFloat()` for numeric values
- Guard against `NaN` results from math operations

```js
// server/utils/thumbnailDerivation.js

/**
 * Derive thumbnail from plot query results (backend fallback)
 * Used when LLM omits thumbnail or provides incomplete data
 *
 * @param {Array} rows - Query result rows from Postgres
 * @param {string} plotTitle - Title for the thumbnail
 * @returns {Object} Thumbnail object matching contract
 */
export function deriveThumbnailFromRows(rows, plotTitle) {
  const EMPTY_THUMBNAIL = {
    title: plotTitle,
    latest_value: null,
    unit: null,
    status: 'unknown',
    delta_pct: null,
    delta_direction: null,
    delta_period: null
  };

  if (!rows || rows.length === 0) {
    return EMPTY_THUMBNAIL;
  }

  // Step 1: Filter valid rows (must have parameter_name and numeric y)
  const validRows = rows.filter(r => {
    if (!r.parameter_name || r.parameter_name === '') return false;
    const yVal = parseFloat(r.y);
    return !isNaN(yVal) && isFinite(yVal);
  });

  if (validRows.length === 0) {
    return EMPTY_THUMBNAIL;
  }

  // Step 2: Sort by timestamp ascending (coerce bigint string to number)
  const sorted = [...validRows].sort((a, b) => Number(a.t) - Number(b.t));

  // Step 3: For multi-series, pick first alphabetically by parameter_name
  const uniqueParams = [...new Set(sorted.map(r => r.parameter_name))].sort();
  const focusParam = uniqueParams[0];
  const focusRows = sorted.filter(r => r.parameter_name === focusParam);

  if (focusRows.length === 0) {
    return EMPTY_THUMBNAIL;
  }

  const oldest = focusRows[0];
  const latest = focusRows[focusRows.length - 1];

  // Step 4: Parse numeric values
  const latestY = parseFloat(latest.y);
  const oldestY = parseFloat(oldest.y);
  const refLower = latest.reference_lower != null ? parseFloat(latest.reference_lower) : null;
  const refUpper = latest.reference_upper != null ? parseFloat(latest.reference_upper) : null;

  // Step 5: Derive status from reference ranges
  let status = 'unknown';
  if (refLower !== null || refUpper !== null) {
    if (refUpper !== null && !isNaN(refUpper) && latestY > refUpper) {
      status = 'high';
    } else if (refLower !== null && !isNaN(refLower) && latestY < refLower) {
      status = 'low';
    } else {
      status = 'normal';
    }
  }

  // Step 6: Derive delta (guard against division by zero and NaN)
  let delta_pct = null;
  let delta_direction = null;
  let delta_period = null;

  if (focusRows.length >= 2 && oldestY !== 0 && !isNaN(oldestY) && !isNaN(latestY)) {
    const rawDelta = ((latestY - oldestY) / Math.abs(oldestY)) * 100;
    if (isFinite(rawDelta)) {
      delta_pct = Math.round(rawDelta);
      delta_direction = delta_pct > 1 ? 'up' : delta_pct < -1 ? 'down' : 'stable';

      // Compute period from timestamps
      const msSpan = Number(latest.t) - Number(oldest.t);
      const days = msSpan / (1000 * 60 * 60 * 24);
      if (days >= 365) {
        delta_period = `${Math.round(days / 365)}y`;
      } else if (days >= 30) {
        delta_period = `${Math.round(days / 30)}m`;
      } else if (days >= 7) {
        delta_period = `${Math.round(days / 7)}w`;
      } else {
        delta_period = `${Math.round(days)}d`;
      }
    }
  }

  return {
    title: plotTitle,
    latest_value: isNaN(latestY) ? null : latestY,
    unit: latest.unit || null,
    status,
    delta_pct,
    delta_direction,
    delta_period
  };
}

/**
 * Empty thumbnail constant for fallback scenarios
 */
export function createEmptyThumbnail(plotTitle) {
  return {
    title: plotTitle,
    latest_value: null,
    unit: null,
    status: 'unknown',
    delta_pct: null,
    delta_direction: null,
    delta_period: null
  };
}
```

### 4. Modify handleShowPlot() Function

**File:** `server/routes/chatStream.js`

**Step 4a:** Add import at top of file:
```js
import { deriveThumbnailFromRows, createEmptyThumbnail } from '../utils/thumbnailDerivation.js';
```

**Step 4b:** Modify `handleShowPlot()` function (starts at line 747)
**Insert point:** After `queryResult` is obtained (after the `pool.query()` call, around line 800)

Update the handler to:
1. Extract LLM-provided thumbnail from params
2. After query execution, compute backend thumbnail
3. Merge using precedence rules (see below)
4. Log thumbnail source (internal only)
5. Include thumbnail in SSE and session messages (without `_source`)

**Merge Precedence Rules:**

| Backend Result | LLM Provided | Winner | Rationale |
|---------------|--------------|--------|-----------|
| Has data (status ≠ unknown OR latest_value ≠ null) | Any | Backend | Backend derived from actual query results = most accurate |
| Empty/unknown | Has data | LLM | LLM may have data from prior exploratory SQL |
| Empty/unknown | Empty/unknown | Backend | Return unknown state |

**Why OR logic (not AND)?** If backend successfully extracted `latest_value` from query results, that value is accurate even if reference ranges are missing (status = 'unknown'). The LLM might have guessed or used stale exploratory data. Value accuracy > status completeness.

```js
// In handleShowPlot(), after queryResult is obtained:

async function handleShowPlot(session, params, toolCallId) {
  const { sql, plot_title, replace_previous, reasoning, thumbnail: llmThumbnail } = params;

  // ... existing validation and query execution ...
  // const queryResult = await pool.query(safeSql);  // existing line ~800

  // === NEW: Thumbnail derivation (insert after queryResult) ===

  // Step 1: Compute backend thumbnail from actual results
  let backendThumbnail;
  try {
    backendThumbnail = deriveThumbnailFromRows(queryResult.rows, plot_title);
  } catch (err) {
    logger.warn({ event: 'thumbnail_derivation_failed', error: err.message, plot_title });
    backendThumbnail = createEmptyThumbnail(plot_title);
  }

  // Step 2: Merge with precedence rules
  // Backend wins when it has data (value OR status); LLM wins when backend is empty
  const backendHasData = backendThumbnail.status !== 'unknown' || backendThumbnail.latest_value !== null;
  const llmHasData = llmThumbnail && (llmThumbnail.status !== 'unknown' || llmThumbnail.latest_value != null);

  let finalThumbnail;
  let thumbnailSource;  // For logging only, not sent to client

  if (backendHasData) {
    // Backend has data - use it (most accurate)
    finalThumbnail = backendThumbnail;
    thumbnailSource = llmThumbnail ? 'backend_override' : 'backend_only';
  } else if (llmHasData) {
    // Backend empty but LLM has data - use LLM (from prior exploratory SQL)
    finalThumbnail = {
      title: plot_title,
      latest_value: llmThumbnail.latest_value ?? null,
      unit: llmThumbnail.unit ?? null,
      status: llmThumbnail.status || 'unknown',
      delta_pct: llmThumbnail.delta_pct ?? null,
      delta_direction: llmThumbnail.delta_direction ?? null,
      delta_period: llmThumbnail.delta_period ?? null
    };
    thumbnailSource = 'llm_fallback';
  } else {
    // Both empty - use backend unknown
    finalThumbnail = backendThumbnail;
    thumbnailSource = 'both_empty';
  }

  // Step 3: Log thumbnail for debugging (source NOT sent to client)
  logger.info({
    event: 'thumbnail_computed',
    source: thumbnailSource,
    llm_provided: !!llmThumbnail,
    backend_has_data: backendHasData,
    title: finalThumbnail.title,
    latest_value: finalThumbnail.latest_value,
    status: finalThumbnail.status,
    delta_pct: finalThumbnail.delta_pct
  });

  // Step 4: Send to frontend via SSE (NO _source field)
  // NOTE: Frontend currently ignores `thumbnail` field (v4.2.1).
  // Frontend handler in public/js/chat.js destructures only {plot_title, rows, replace_previous}.
  // Thumbnail rendering will be implemented in PRD v4.2.2.
  if (session.sseResponse) {
    streamEvent(session.sseResponse, {
      type: 'plot_result',
      plot_title,
      rows: queryResult.rows,
      replace_previous,
      thumbnail: finalThumbnail  // Contract-compliant, no _source
    });
  }

  // Step 5: Add to session messages with compact thumbnail
  const compactRows = queryResult.rows.map(row => ({
    t: row.t,
    y: row.y,
    p: row.parameter_name,
    u: row.unit,
    ...(row.reference_lower != null && { rl: row.reference_lower }),
    ...(row.reference_upper != null && { ru: row.reference_upper }),
    ...(row.is_out_of_range != null && { oor: row.is_out_of_range })
  }));

  session.messages.push({
    role: 'tool',
    tool_call_id: toolCallId,
    content: JSON.stringify({
      success: true,
      display_type: 'plot',
      plot_title,
      rows: compactRows,
      row_count: compactRows.length,
      thumbnail: {  // Compact thumbnail for conversation history (saves tokens)
        title: finalThumbnail.title,
        latest: finalThumbnail.latest_value,
        status: finalThumbnail.status,
        delta: finalThumbnail.delta_pct
        // delta_direction and delta_period omitted intentionally for compactness
      }
    })
  });

  // ... rest of existing handler (logging, etc.) ...
}
```

### 5. Failure Behavior

When thumbnail processing fails:
- **LLM omits thumbnail**: Backend computes from results (normal path)
- **LLM provides invalid thumbnail**: Log warning, use backend fallback
- **Backend derivation throws**: Catch error, use minimal fallback `{ title, status: 'unknown' }`
- **Empty query results**: Return minimal fallback
- **All rows have null y values**: Return minimal fallback
- **Never block plot rendering**: Thumbnail failures are non-fatal

---

## Frontend Impact (v4.2.1)

**No frontend changes required in v4.2.1.**

The current frontend handler in `public/js/chat.js` (line 398-413):
```js
handlePlotResult(data) {
  const { plot_title, rows, replace_previous } = data;
  // ... renders plot ...
}
```

The `thumbnail` field in the SSE payload will be **silently ignored** by destructuring. This is intentional - frontend rendering is deferred to PRD v4.2.2.

**PRD v4.2.2 will:**
- Update `handlePlotResult()` to extract `thumbnail`
- Add `ChatPlotThumbnail` component
- Update any TypeScript types if applicable

---

## Testing

### Manual Verification

1. Ask a time-series question: "Show my vitamin D over time"
2. Check server logs for `thumbnail_computed` event
3. Verify `source` field in logs shows correct precedence
4. Verify thumbnail fields are populated correctly from actual data
5. Verify SSE payload contains `thumbnail` without `_source`
6. Verify plot still renders normally (no regressions)

### Edge Cases to Test

| Case | Expected Behavior |
|------|-------------------|
| Single data point | `delta_pct`, `delta_direction`, `delta_period` = null |
| No reference ranges | `status` = "unknown", but `latest_value` populated |
| Multi-analyte query | Thumbnail for first `parameter_name` alphabetically |
| LLM omits thumbnail | Backend computes full thumbnail |
| LLM provides thumbnail, backend has data | Backend wins |
| LLM provides thumbnail, backend empty | LLM wins |
| Backend has value but no refs | Backend wins (OR logic: value is accurate) |
| Empty query results | Minimal fallback thumbnail |
| All rows have null `y` | Minimal fallback thumbnail |
| Query execution fails | No thumbnail (plot also fails) |
| Postgres returns strings for numbers | Correctly coerced via `parseFloat()`/`Number()` |

### Unit Test Expectations

**File:** `test/unit/thumbnailDerivation.test.js` (new file)

```js
import { deriveThumbnailFromRows, createEmptyThumbnail } from '../../server/utils/thumbnailDerivation.js';

describe('deriveThumbnailFromRows', () => {
  test('returns unknown for empty rows', () => {
    const result = deriveThumbnailFromRows([], 'Test');
    expect(result.status).toBe('unknown');
    expect(result.latest_value).toBeNull();
  });

  test('handles string numbers from Postgres', () => {
    const rows = [
      { t: '1700000000000', y: '42.5', parameter_name: 'Vitamin D', unit: 'ng/ml' }
    ];
    const result = deriveThumbnailFromRows(rows, 'Vitamin D');
    expect(result.latest_value).toBe(42.5);
    expect(typeof result.latest_value).toBe('number');
  });

  test('picks first parameter alphabetically for multi-series', () => {
    const rows = [
      { t: '1700000000000', y: '100', parameter_name: 'Zebra', unit: 'mg' },
      { t: '1700000000000', y: '50', parameter_name: 'Alpha', unit: 'mg' }
    ];
    const result = deriveThumbnailFromRows(rows, 'Multi');
    expect(result.latest_value).toBe(50); // Alpha's value
  });

  test('computes delta correctly', () => {
    const rows = [
      { t: '1609459200000', y: '100', parameter_name: 'Test', unit: 'mg' }, // Jan 2021
      { t: '1640995200000', y: '120', parameter_name: 'Test', unit: 'mg' }  // Jan 2022
    ];
    const result = deriveThumbnailFromRows(rows, 'Test');
    expect(result.delta_pct).toBe(20);
    expect(result.delta_direction).toBe('up');
    expect(result.delta_period).toBe('1y');
  });

  test('returns null delta for single point', () => {
    const rows = [
      { t: '1700000000000', y: '42.5', parameter_name: 'Test', unit: 'mg' }
    ];
    const result = deriveThumbnailFromRows(rows, 'Test');
    expect(result.delta_pct).toBeNull();
    expect(result.delta_direction).toBeNull();
  });

  test('filters rows with null parameter_name', () => {
    const rows = [
      { t: '1700000000000', y: '42.5', parameter_name: null, unit: 'mg' },
      { t: '1700000000000', y: '50', parameter_name: 'Valid', unit: 'mg' }
    ];
    const result = deriveThumbnailFromRows(rows, 'Test');
    expect(result.latest_value).toBe(50);
  });

  test('filters rows with non-numeric y', () => {
    const rows = [
      { t: '1700000000000', y: 'N/A', parameter_name: 'Test', unit: 'mg' },
      { t: '1700000000000', y: '50', parameter_name: 'Test', unit: 'mg' }
    ];
    const result = deriveThumbnailFromRows(rows, 'Test');
    expect(result.latest_value).toBe(50);
  });

  test('derives status from reference ranges', () => {
    const rows = [
      { t: '1700000000000', y: '150', parameter_name: 'Test', unit: 'mg', reference_upper: '100' }
    ];
    const result = deriveThumbnailFromRows(rows, 'Test');
    expect(result.status).toBe('high');
  });

  test('returns unknown status but valid value when no reference ranges', () => {
    const rows = [
      { t: '1700000000000', y: '42.5', parameter_name: 'Test', unit: 'mg' }
    ];
    const result = deriveThumbnailFromRows(rows, 'Test');
    expect(result.status).toBe('unknown');
    expect(result.latest_value).toBe(42.5);  // Value still extracted
  });
});

describe('createEmptyThumbnail', () => {
  test('creates thumbnail with all null fields except title', () => {
    const result = createEmptyThumbnail('My Title');
    expect(result.title).toBe('My Title');
    expect(result.status).toBe('unknown');
    expect(result.latest_value).toBeNull();
  });
});
```

### Integration Test (SSE Payload Shape)

Verify SSE `plot_result` event contains valid thumbnail:

```js
// In existing chat integration tests
test('plot_result SSE includes thumbnail without _source', async () => {
  // ... setup SSE connection, send plot query ...

  const plotEvent = events.find(e => e.type === 'plot_result');
  expect(plotEvent.thumbnail).toBeDefined();
  expect(plotEvent.thumbnail.title).toBeDefined();
  expect(plotEvent.thumbnail.status).toMatch(/^(normal|high|low|unknown)$/);
  expect(plotEvent.thumbnail._source).toBeUndefined(); // Must NOT be present
});
```

---

## Success Criteria

- [ ] `show_plot` tool schema includes optional `thumbnail` parameter
- [ ] `server/utils/thumbnailDerivation.js` created with exported functions
- [ ] Backend `deriveThumbnailFromRows()` handles type coercion and null filtering
- [ ] Merge precedence: backend wins when has data (OR logic), LLM wins when backend empty
- [ ] Server logs show `thumbnail_computed` events with source info
- [ ] SSE `plot_result` includes `thumbnail` field WITHOUT `_source`
- [ ] Frontend silently ignores `thumbnail` (no errors, no rendering)
- [ ] Unit tests pass for derivation edge cases
- [ ] No regressions in existing plot generation
- [ ] Thumbnail failures never block plot rendering

---

## Next Step

PRD v4.2.2 will cover:
- Frontend `ChatPlotThumbnail` component
- Update `handlePlotResult()` to extract and render thumbnail
- Styling and layout specifications
- (Optional) Align plot UI default series selection with thumbnail
