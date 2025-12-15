# PRD v4.2 — Chat Result Thumbnails for Plot Outputs

## Status
Draft → Ready for implementation

## Motivation

HealthUp currently renders plots and tables outside the conversational context, which creates:
- weak causality between chat and results
- high cognitive load (full chart + full table immediately)
- limited scalability for multi-result conversations

PRD v4.2 introduces **chat-level result thumbnails** that:
- summarize analytical outputs inline with the conversation
- provide immediate value without opening full plots
- establish a stable, recognizable visual language for “chart results”
- preserve existing full plot rendering unchanged (non-breaking)

This PRD intentionally does **not** refactor the existing plot/table UI. Thumbnails coexist with current plots and act as a preparatory layer for future UX refactors.

---

## Goals

### Primary
- Add deterministic, high-value thumbnails to chat messages when a plot result is generated.
- Ensure thumbnails work consistently for:
  - single-analyte plots
  - multi-analyte (panel) plots
  - sparse and dense datasets

### Secondary
- Preserve LLM flexibility in deciding *what analytical result to show*.
- Avoid UI chaos by strictly prescribing *how thumbnails are rendered*.
- Create a foundation for future “thumbnail → full view” refactors.

---

## Non-Goals

- Replacing existing plot rendering
- Removing tables from plot pages
- Reworking chart interaction (zoom, analyte switching)
- Perfect handling of unknown edge cases (handled via fallback)

---

## Core Principle

**LLM decides content. UI decides presentation.**

- The LLM may generate arbitrary SQL and analytical logic.
- The UI renders thumbnails using a strict, deterministic layout.
- The UI must not “interpret meaning” from raw plot data beyond what is explicitly provided in the Thumbnail Spec.

---

## High-Level Flow

User prompt  
→ LLM generates SQL + plot result  
→ LLM emits a **Thumbnail Spec** via **Structured Outputs**  
→ Chat renders explanation + thumbnails  
→ Existing plot UI renders unchanged

---

## Supported Result Types

- `timeseries` — line / trend plots
- `comparison` — multi-analyte or before/after plots
- `distribution` — histograms, percentiles
- `table` — tabular or abnormal summaries

This PRD focuses on `timeseries` and `comparison`, but the contract must be extensible to all types.

---

## Thumbnail Spec Contract

### Why this exists
Thumbnails must be:
- **consistent** (user recognizes “this = chart result”)
- **robust** (UI never breaks on novel queries)
- **cheap** to render (no Chart.js in thumbnail)

To achieve this, the LLM provides a compact **Thumbnail Spec**, and the UI renders it deterministically.

### Metadata (required)

```json
{
  "result_type": "timeseries | comparison | distribution | table",
  "title": "Vitamin D (25-OH)",
  "time_range": {
    "start": "2018-08-29",
    "end": "2025-01-07"
  }
}
```

Rules:
- `title` max 40 characters (UI truncates if longer)
- `time_range` may be `null` if not applicable

### Key Insight Line (required)

```json
{
  "key_value": 40.6,
  "unit": "ng/ml",
  "status": "normal | high | low | mixed | unknown",
  "delta_text": "↓ -12% over 2y"
}
```

Rules:
- At least one of `key_value` or `delta_text` must be present
- `delta_text` max 24 characters
- `status` drives a small badge/dot (never full-card background)

### Preview Payload (type-specific)

#### Timeseries

```json
{
  "preview": {
    "type": "sparkline",
    "series": [32, 35, 41, 38, 36, 40, 39]
  }
}
```

Rules:
- max 48 points
- no axes, labels, legends
- UI renders as inline SVG

#### Comparison / Multi-analyte

```json
{
  "preview": {
    "type": "sparkline",
    "focus_analyte": "LDL Cholesterol",
    "series": [3.1, 3.4, 3.8, 3.6]
  }
}
```

Rules:
- exactly **one** series used for preview
- `focus_analyte` is selected by the LLM (not UI heuristics)
- full plot still allows analyte switching as it does today

### Flags (optional but standardized)

```json
{
  "flags": ["SPARSE_DATA", "MIXED_UNITS"]
}
```

Allowed flags (initial set):
- `SPARSE_DATA` (n < 3)
- `MIXED_UNITS`
- `LARGE_GAPS`
- `OUTLIERS_PRESENT`
- `REFERENCE_RANGE_MISSING`
- `AGGREGATED`

UI behavior:
- show up to 2 flags as chips
- remaining flags collapsed as “+N”

---

## Structured Outputs Requirement (OpenAI)

### Requirement
The Thumbnail Spec MUST be produced using **OpenAI Structured Outputs** (schema-enforced output), so the backend receives a validated object rather than “best-effort JSON”.

### Implementation approach
- Use the OpenAI Responses API structured output mechanism (schema or equivalent) to obtain a **typed** `thumbnail_spec` object.
- If the model fails schema validation, the backend MUST treat the thumbnail as invalid and use the fallback thumbnail.

### Why this is essential
- prevents drift in field names/types
- keeps UI deterministic even as prompts evolve
- makes thumbnail rendering safe to deploy

### Transport & Persistence (plots only)
- Backend buffers plot rows after `show_plot` executes; it does not emit SSE immediately.
- LLM responds in the same turn with `thumbnail_spec` (structured output).
- Backend validates `thumbnail_spec`, then emits a single atomic SSE: `{ type: "plot_result", plot_title, rows, replace_previous, thumbnail_spec }`. If spec is invalid or missing by turn end/timeout, emit with `thumbnail_spec: null` (frontend renders fallback).
- The compact tool message stored in `session.messages` (`display_type: "plot"`) also carries the validated `thumbnail_spec` (or `thumbnail_spec: null` with `thumbnail_validation_error` for telemetry).
- No new SSE event types; table thumbnails are out of scope for v4.2.

### JSON Schema (thumbnail_spec)
```json
{
  "type": "object",
  "required": ["result_type", "title", "key_line", "preview"],
  "properties": {
    "result_type": { "type": "string", "enum": ["timeseries", "comparison"] },
    "title": { "type": "string", "maxLength": 40 },
    "time_range": {
      "type": ["object", "null"],
      "required": ["start", "end"],
      "properties": {
        "start": { "type": "string", "format": "date" },
        "end":   { "type": "string", "format": "date" }
      },
      "additionalProperties": false
    },
    "key_line": {
      "type": "object",
      "required": ["status"],
      "properties": {
        "key_value": { "type": ["number", "null"] },
        "unit": { "type": ["string", "null"], "maxLength": 24 },
        "status": { "type": "string", "enum": ["normal", "high", "low", "mixed", "unknown"] },
        "delta_text": { "type": ["string", "null"], "maxLength": 24 }
      },
      "additionalProperties": false
    },
    "preview": {
      "type": "object",
      "required": ["type", "series"],
      "properties": {
        "type": { "type": "string", "const": "sparkline" },
        "series": {
          "type": "array",
          "items": { "type": "number" },
          "minItems": 1,
          "maxItems": 48
        },
        "focus_analyte": { "type": ["string", "null"], "maxLength": 40 }
      },
      "additionalProperties": false
    },
    "flags": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": [
          "SPARSE_DATA",
          "MIXED_UNITS",
          "LARGE_GAPS",
          "OUTLIERS_PRESENT",
          "REFERENCE_RANGE_MISSING",
          "AGGREGATED"
        ]
      },
      "uniqueItems": true,
      "maxItems": 6
    }
  },
  "additionalProperties": false
}
```

Additional validation rules (enforced in backend if schema engine cannot express them):
- If `result_type === "comparison"`, `preview.focus_analyte` must be non-null/non-empty.
- At least one of `key_value` or `delta_text` must be non-null.

---

## LLM Instruction Contract (Mandatory)

The LLM must follow these rules when generating a Thumbnail Spec:

### Hard constraints (must)
- Must output a Thumbnail Spec that passes Structured Output validation.
- Must not exceed text limits:
  - `title` ≤ 40 chars (truncate meaningfully, drop extra qualifiers)
  - `delta_text` ≤ 24 chars (prefer compact formats: “↓ -12% (2y)”)
- Must set `result_type` correctly to match the returned result.
- Must provide `preview.series` for chart results whenever possible.
- Must provide `key_value` + `unit` when a “latest” value exists.

### Focus selection for multi-analyte (`comparison`)
The model must choose a single **focus analyte** for the thumbnail preview and set `preview.focus_analyte`.

Selection guidance (LLM-driven, not hard-coded in UI):
- Prefer analyte that matches the user’s phrasing (e.g. user asked “LDL”)
- Otherwise prefer analyte with notable status (high/low) or notable change
- Otherwise choose the most representative analyte for the panel and be consistent

### Output must be “typesetting-friendly”
- No markdown in any fields
- No units embedded inside `title`
- Avoid medical paragraphs; thumbnails are tiny

### Prompt wiring (plots only)
- Keep `show_plot` tool for SQL execution. Add a second structured-output call in the same turn to emit `thumbnail_spec` using the schema above.
- Remind the model: set `result_type` to `timeseries` for single-analyte trend plots, `comparison` for multi-analyte/panel plots. Provide `focus_analyte` only for `comparison`.
- Obey text limits (`title` ≤ 40 chars, `delta_text` ≤ 24 chars), no markdown, no units in `title`.
- Provide `preview.series` (≤ 48 numbers). For `comparison`, pick ONE analyte for `focus_analyte` and use that analyte’s series.
- Set `key_value`/`unit` to the latest value when available; include `delta_text` when change is clear; use `status` from the clinical interpretation (normal/high/low/mixed/unknown).
- If the model cannot populate a valid spec, emit `null` so the backend can fallback.
- Backend must flush any buffered plot rows at turn end with `thumbnail_spec: null` if no valid spec arrives (ensures plot always renders).

---

## Thumbnail Spec Validation (Backend)

Even with Structured Outputs, the backend must enforce safe behavior:

### Validation timing
- Validate `thumbnail_spec` immediately after receiving the model response and before sending it to the client.

### Failure behavior (deterministic)
If invalid or missing:
- render generic chart thumbnail (see Fallback Rules)
- log validation error (for future prompt/contract tuning)
- do not block the main answer/plot rendering

### Validation mapping to fallback
- If schema validation fails OR cross-field rules fail (e.g., missing `focus_analyte` for comparison, both `key_value` and `delta_text` null) → set `thumbnail_spec = null` and render the generic chart thumbnail.
- If `preview.series` is missing/empty but other fields are valid → render title + insight line only (no sparkline).
- Unknown `result_type` (not in enum) → generic chart thumbnail.
- Transport/persist only validated specs; invalid specs are null with optional `thumbnail_validation_error` code.

### Flags ownership (plots)
- Backend sets flags deterministically from returned plot rows; LLM does not guess flags.
  - `SPARSE_DATA`: fewer than 3 points
  - `MIXED_UNITS`: more than one distinct unit in the result set
  - `LARGE_GAPS`: max gap between consecutive timestamps > 180 days (tunable)
  - `OUTLIERS_PRESENT`: any row has `is_out_of_range = true`
  - `REFERENCE_RANGE_MISSING`: any row missing both reference_lower and reference_upper
  - `AGGREGATED`: rows are aggregated (e.g., GROUP BY detected or any `agg_` field present)

---

## Frontend Rendering Contract (Clarification)

This section prevents “UI heuristics creep” and keeps the product’s AI value intact.

### Ownership
- A single component (e.g. `ChatResultThumbnail`) is responsible for rendering thumbnails.
- Other UI components must not reinterpret raw plot/table data to create thumbnails.

### Inputs
- The thumbnail renderer consumes **only** `thumbnail_spec`.
- It must not read the raw plot dataset to infer trends/deltas/flags.

### Non-responsibilities (explicit)
UI must NOT:
- decide dominant analyte
- compute deltas
- normalize units
- infer “importance” from raw values
- render multiple series in a thumbnail

### Rendering rules
- Fixed slot layout (see next section)
- Deterministic truncation
- Deterministic flag display limits
- Deterministic fallback rendering
- Render locations: `plot_result` drives BOTH (a) full plot in `#sqlResults` (existing behavior) and (b) chat-stream thumbnail in `.chat-messages` immediately after the assistant’s explanation text.

### Visual tokens (plots)
- Typography: title 14px/600; key line 16px/600; delta 12px/500; flags 11px/500.
- Colors: text neutral-900 (title), neutral-700 (meta/delta), neutral-600 (flags); status dot/badge colors — normal: neutral-500; high: red-500; low: blue-500; mixed: amber-500; unknown: neutral-400; flags chip bg: neutral-100 with text neutral-600; icon: neutral-500; sparkline stroke: neutral-700.
- Spacing: card padding 12px; row gaps 4–6px; sparkline height 18px, stroke 1.5px; border radius 10px; subtle shadow on hover.
- Truncation: title ellipsis at 40 chars; delta at 24 chars; show up to 2 flag chips then “+N”.

---

## Thumbnail Rendering Rules (Deterministic)

Layout (fixed):

```
ICON  Title                              Time Range
Key value + unit                  ● Status
Delta text (optional)
Sparkline (or mini preview)
Flags (optional)
```

Visual:
- sparkline height: 16–24px
- stroke width: 1.5px
- neutral palette; only badges use semantic color
- no axes/labels/tooltips in thumbnail

Interaction:
- hover: subtle elevation + “Open” affordance (visual only)
- click: **no behavior change** in v4.2 (future PRD will coalesce)

---

## Multi-Analyte Behavior

- Thumbnails never render multiple series.
- LLM explicitly selects `focus_analyte` for the preview.
- Thumbnail represents panel summary via one analyte.

---

## Fallback Rules (Robustness)

If thumbnail spec is incomplete or invalid, UI renders a generic fallback:

```
📈 Chart result
N measurements (if known)
Open to view
```

Fallback ladder:
1. Missing preview → render title + insight line only
2. Invalid spec → generic chart thumbnail
3. Unknown result type → table-style summary thumbnail

UI must never fail rendering.

---

## Implementation Notes (guidance for engineers)

- Backend buffering and flush:
  - `handleShowPlot` must stop streaming immediately; store `{ rows, plot_title, replace_previous }` in `session.pendingPlot`.
  - `handleEmitThumbnailSpec` retrieves `pendingPlot`, validates `thumbnail_spec`, emits one atomic SSE `{ type: "plot_result", plot_title, rows, replace_previous, thumbnail_spec }`, then clears `pendingPlot`.
  - If `pendingPlot` is missing when `emit_thumbnail_spec` is called, log a warning and return an error to the LLM (do not crash).
  - Add a turn-end safety valve (e.g., finalizeTurn/finally) to emit any leftover `pendingPlot` with `thumbnail_spec: null` if no valid spec arrives by turn end/timeout.

- Tool definition:
  - Define `emit_thumbnail_spec` as a tool (like `show_plot`) with the JSON schema above in the tools registry (e.g., `agenticTools.js`), so the LLM calls it explicitly after `show_plot`.

- Tool message history:
  - When `emit_thumbnail_spec` succeeds, update the most recent `show_plot` tool message in `session.messages` to include the validated `thumbnail_spec` (or `thumbnail_spec: null` with error) so history reloads have the spec attached.

- Frontend dual render:
  - `handlePlotResult` continues to render the full plot in `#sqlResults`.
  - It must also append a `ChatResultThumbnail` element into `.chat-messages`, immediately after the assistant’s explanation bubble, using `thumbnail_spec` (or fallback UI when null).

- Turn continuity:
  - Ensure the agent loop does not halt after `show_plot`; `emit_thumbnail_spec` must occur in the same conversation turn. Tool definitions/iteration logic should reflect that `show_plot` does not end the turn.

---

## Backward Compatibility

- Existing plot rendering remains unchanged.
- Thumbnail system is additive only.
- No changes to existing SQL generation or plot validation required.

---

## Success Metrics

- Users understand plot meaning **before** opening full chart.
- Reduced immediate scrolling after assistant response.
- Consistent visual recognition of “chart results” in chat.
- Zero regressions in existing plot UI.

---

## Future Work (Out of Scope)

- Thumbnail → full plot coalescing (split view driven by chat thumbnails)
- Thumbnail updates when user switches analytes
- Persistent pinned thumbnails as “analysis memory”
- Hover peek interactions
