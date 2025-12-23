# PRD v4.2.4 — Chat Thumbnail UI (Desktop, MVP)

## Status
Planned — UI rendering phase

## Position in v4.2 Series

This PRD is the **fourth and final MVP slice** of the single feature **“Chat Plot Thumbnails”**:

- **v4.2** — Product intent & UX problems
- **v4.2.1** — LLM thumbnail data emission
- **v4.2.2** — Thumbnail contract & backend derivation
- **v4.2.3** — UI infrastructure & message anchoring
- **v4.2.4 (this PRD)** — Desktop UI rendering rules

This document introduces **no new backend or LLM logic**. It strictly defines how already-produced thumbnail data is rendered in the chat UI.

---

## Purpose

Define a **deterministic, minimal, desktop-first UI** for rendering plot thumbnails inline inside assistant chat messages, using the thumbnail payload defined in **PRD v4.2.2** and anchored via **PRD v4.2.3**.

---

## Scope (Strict)

### In Scope
- Desktop-first UI (no dedicated mobile design work)
- Inline rendering inside assistant chat messages
- Time-series plot thumbnails only
- Multiple thumbnails per assistant message
- Read-only display
- Locale: Fixed `en-US` formatting for MVP (consistent with existing HealthUp UI)

### Explicitly Out of Scope
- Any backend or LLM changes
- Any change to thumbnail data shape
- Mobile UI
- Advanced interactions (tooltips, zoom, brushing)
- Replacing or refactoring existing plot UI

---

## Core UX Principle

**One plot result → one thumbnail → rendered inside the assistant message that produced it**

---

## Dependencies & References

- Thumbnail payload contract: **PRD v4.2.2 — Thumbnail Contract Expansion + Backend Derivation**
- Message anchoring + SSE events: **PRD v4.2.3 — Thumbnail UI Infrastructure (Message Anchoring & Contract Finalization)**

This PRD does **not** redefine the contract; it references those PRDs as the source of truth.

---

## Trigger & Lifecycle

- Triggered by thumbnail payload conforming to PRD v4.2.2
- Anchored to assistant message via PRD v4.2.3
- Append-only, deterministic ordering

### SSE Event Payload Structure

The `thumbnail_update` event from backend has the following structure:

```javascript
{
  type: 'thumbnail_update',
  message_id: string,        // UUID anchoring this thumbnail to assistant message
  result_id: string,         // Unique ID for this thumbnail (ephemeral identifier)
  plot_title: string,        // Canonical plot title (use this for rendering)
  thumbnail: {               // Thumbnail data contract from PRD v4.2.2
    plot_title: string,      // Same as top-level (backend passes through)
    focus_analyte_name: string | null,
    point_count: number,
    series_count: number,    // Always present, >= 0 (never null)
    latest_value: number | null,
    unit_raw: string | null,
    unit_display: string | null,
    status: 'normal' | 'high' | 'low' | 'unknown',
    delta_pct: number | null,  // SIGNED numeric percentage (-100 to +∞); negative = decrease, positive = increase
    delta_direction: 'up' | 'down' | 'stable' | null,
    delta_period: string | null,
    sparkline: {
      series: number[]       // 1-30 values
    }
  }
}
```

**Field Precedence:**
- Use top-level `plot_title` for rendering (it's the authoritative source)
- `thumbnail.plot_title` will always match top-level (backend guarantee)
- All other fields come from `thumbnail` object

### DOM Anchoring (Deterministic)

Render thumbnails **inside the assistant message bubble** in a dedicated, stable container so streaming markdown updates do not erase thumbnails.

- Each assistant message wrapper MUST be tagged with `data-message-id="{message_id}"`.
- Inside the assistant bubble, create two siblings:
  1. `.chat-bubble-content` — holds streaming markdown
  2. `.thumbnail-stack` — holds thumbnail cards (append-only)
- Do not render thumbnails directly into the markdown container.

**Selector Requirements (Critical for Multi-Turn Chat):**
- All streaming text updates MUST target the specific message's container using: `querySelector('[data-message-id="{message_id}"] .chat-bubble-content')`
- Never use generic selectors like `.chat-bubble-content:last-child` or `.chat-bubble-content` which break with concurrent/out-of-order events
- Thumbnail updates MUST also use `message_id`-based selection: `querySelector('[data-message-id="{message_id}"] .thumbnail-stack')`

**SSE Event Schema Reference:**
- **Transport stays the same as today**: a single SSE stream that emits JSON payloads with a `type` field (no named SSE events).
- **Text events** (defined in PRD v4.2.3): `data.type: "text"`, `data.message_id` (UUID), `data.content` (string chunk)
- **Thumbnail events** (defined in this PRD, section 3.2): `data.type: "thumbnail_update"`, `data.message_id`, `data.result_id`, `data.plot_title`, `data.thumbnail` (object), `data.replace_previous` (optional boolean)
- Both event types share the same `message_id` anchor for rendering into the correct message shell
- **`replace_previous` (from PRD v4.2.2)**: If `data.replace_previous === true`, clear the most recently rendered thumbnail for that `message_id` before rendering the new one. If no prior thumbnail exists, do nothing. This is a defensive cleanup path for invalid prior payloads.

**Streaming Text State Management:**
- Maintain per-message text accumulation using `message_id` as key (e.g., Map or object keyed by `message_id`)
- On `text` event: Append `data.content` to buffer for `data.message_id`, render accumulated text to `[data-message-id="{message_id}"] .chat-bubble-content`
- On `message_end` event: Finalize the message matching `data.message_id`, clear its buffer entry
- Never rely on `:last-child` selectors or single global `currentAssistantMessage` buffer (breaks with out-of-order SSE events or reconnection edge cases)
- **Migration requirement**: Replace `currentAssistantMessage`-based flow with per-message buffers and pass `message_id` through streaming and finalization paths (including any cursor handling and error/finalize paths).
- **Error events and buffers**: Error handling must not finalize or clear buffers for unrelated `message_id`s. If an error payload includes `message_id`, only that buffer and cursor should be finalized/cleared; otherwise, leave buffers intact and let normal `message_end` events clean up.
- Example pseudocode:
  ```javascript
  // State: Map<message_id, accumulated_text>
  const messageBuffers = new Map();

  // On text event
  const buffer = messageBuffers.get(data.message_id) || '';
  messageBuffers.set(data.message_id, buffer + data.content);
  const targetEl = document.querySelector(`[data-message-id="${data.message_id}"] .chat-bubble-content`);
  targetEl.innerHTML = sanitize(markdown(messageBuffers.get(data.message_id)));

  // On message_end event
  messageBuffers.delete(data.message_id);
  ```

**Cursor Handling (Per-Message):**
- Maintain at most one cursor element per message inside `[data-message-id="{message_id}"] .chat-bubble-content`.
- On each render, remove any existing cursor element for that message before appending a new cursor if the message is still streaming.
- On `message_end`, remove the cursor for that message only.

**Message Shell Creation (Critical):**
- **Deduplication required**: Before creating any new message shell, check if one already exists: `querySelector('[data-message-id="{message_id}"]')`
  - If shell exists → reuse it (skip creation)
  - If shell does not exist → create new shell with structure defined below
  - This check applies to **all events that render into the message** (`thumbnail_update` AND `text`)
- **On-demand creation**: Create shell only when first `text` or `thumbnail_update` event arrives for a given `message_id`
  - **Do NOT create shell on `message_start`** — wait for actual content
  - **`message_start` state**: `message_start` may initialize internal tracking but must not create a shell or mutate DOM. If no text/thumbnail arrives for that `message_id`, discard any optional internal state on `message_end`.
  - **Rationale**: Tool-only turns (no text, no thumbnails) should not render assistant bubbles
- **Tool-only/error-only turns**: If `message_end` fires with no shell ever created (no text and no thumbnails rendered), no assistant bubble appears in chat
  - **Expected behavior**: Background operations (tools, status indicators) remain invisible to user
  - **Error messages**: Handled via separate error event (renders error bubble), not via assistant message. Error bubbles are not anchored to `data-message-id`.
- **Edge case** (thumbnail or text arrives before `message_start`): Create shell immediately and append to `.chat-messages` container
  - **Ordering guarantee**: Out-of-order shells are acceptable in MVP (SSE events are ordered by design)
  - **Placement rule**: Append to end of `.chat-messages` container (deterministic fallback)
  - **Future enhancement**: If strict ordering is required, buffer events until `message_start` arrives
- Shell structure: outer wrapper with `data-message-id`, inner `.chat-bubble` containing `.chat-bubble-content` and `.thumbnail-stack`
- **Rationale**: On-demand creation ensures only user-visible content creates bubbles. Backend emits `message_start` before content events (PRD v4.2.3 contract), but frontend defers shell creation until content arrives. Deduplication prevents duplicate bubbles.

**Migration Requirements for Existing Chat UI:**

Current implementation (`public/js/chat.js`) requires refactoring:

1. **DOM Structure Change:**
   - Current: Markdown written directly to `.chat-bubble` (line 264, 280)
   - Required: Wrap markdown in `.chat-bubble-content` child element
   - Add sibling `.thumbnail-stack` container for thumbnails

2. **Selector Migration:**
   - Current: Uses `.chat-message-assistant:last-child .chat-bubble` (line 253, 296)
   - Required: Use `querySelector('[data-message-id="{message_id}"] .chat-bubble-content')` for text updates
   - Required: Use `querySelector('[data-message-id="{message_id}"] .thumbnail-stack')` for thumbnails

3. **Streaming Update Path:**
   - Current: `assistantMessageEl.innerHTML = cleanHtml` (line 280, 302)
   - Required: Target `.chat-bubble-content` specifically to avoid erasing `.thumbnail-stack`
   - **Cursor handling**: Append/remove the streaming cursor inside `.chat-bubble-content` only. Never mutate `.chat-bubble` `innerHTML`.

4. **CSS Migration:**
   - Add `.chat-bubble-content` class alongside existing `.markdown-content` (both classes on same element)
   - Existing `.markdown-content` styles continue to work (no migration required for MVP)
   - Future: Migrate to `.chat-bubble-content` as primary selector
5. **Dedicated Thumbnail Renderer:**
   - Implement a `renderThumbnail(message_id, payload)` helper that builds the thumbnail card DOM, appends to `[data-message-id="{message_id}"] .thumbnail-stack`, and never mutates `.chat-bubble` `innerHTML`.
   - All dynamic text uses `textContent`. SVG elements are created with `document.createElementNS()` only.

**Rationale:** Current implementation erases thumbnails on every streaming markdown update and breaks with concurrent messages. The new structure isolates markdown and thumbnails into stable sibling containers.

---

## Session Scope & Rehydration

**Thumbnails are session-scoped and ephemeral for MVP:**

- Thumbnails are rendered **only from live SSE events** during the current session
- On page refresh, SSE reconnect, or navigation back to chat, thumbnails are **not persisted or rehydrated**
- Users will see markdown text only for historical messages after reload
- Backend does NOT persist thumbnail payloads to database
- Backend does NOT provide an initial fetch endpoint for historical thumbnails

**Rationale:**
- Thumbnails are visual enhancements, not critical data (full plots remain accessible via "View" button)
- Session-scoped approach avoids MVP scope expansion for persistence/rehydration infrastructure
- Acceptable trade-off for MVP given low frequency of page refreshes during active chat sessions

**Future Enhancement (Out of MVP Scope):**
- Thumbnail payload persistence in database
- Rehydration endpoint for fetching historical thumbnails on page load
- SSE reconnection recovery with gap detection

---

## Thumbnail Card — Logical Structure

1. Header — plot title, optional focus analyte  
2. Primary value row — latest value, unit, status  
3. Delta row (optional) — direction, percent, period  
4. Sparkline — minimal time-series visualization  
5. Footer — point count, optional series count  

UI must not compute or infer domain values (i.e., no data derivation or business logic such as status, analyte selection, or derived metrics). UI-only formatting, parsing, and display mapping (e.g., number formatting, period expansion, sparkline coordinate mapping) are allowed and required.

### DOM Structure (Reference Implementation)

Use this structure and class naming to avoid ambiguity:

```
<div class="chat-message chat-message-assistant" data-message-id="{message_id}">
  <div class="chat-bubble chat-bubble-assistant">
    <div class="chat-bubble-content markdown-content"></div>
    <div class="thumbnail-stack">
      <div class="thumbnail-card" data-result-id="{result_id}">
        <div class="thumbnail-header">
          <div class="thumbnail-title">Plot Title</div>
          <div class="thumbnail-subtitle">Optional Focus Analyte</div>
        </div>
        <div class="thumbnail-primary">
          <div class="thumbnail-value">123.4 mg/dL</div>
          <div class="thumbnail-status status-normal">Normal</div>
        </div>
        <div class="thumbnail-delta">
          <span class="delta-icon delta-up">▲</span>
          <span class="delta-value">+12.3%</span>
          <span class="delta-period">over 3 months</span>
        </div>
        <div class="thumbnail-sparkline" aria-label="Trend for {plot_title}">
          <svg viewBox="0 0 100 24" preserveAspectRatio="none">
            <polyline points="..."/>
          </svg>
        </div>
        <div class="thumbnail-footer">
          <span class="thumbnail-meta">12 points</span>
          <span class="thumbnail-meta">2 series</span>
        </div>
      </div>
    </div>
  </div>
</div>
```

**Note on `data-result-id`**:
- Required attribute on each `.thumbnail-card` element
- Value must be unique per thumbnail (provided in backend payload from PRD v4.2.2)
- Purpose: debugging, future interactions, and deduplication logic
- Must be present even if no current functionality uses it

### Security Requirements (XSS Prevention)

**All dynamic text fields MUST be inserted via `textContent`, NOT `innerHTML`:**

- Fields requiring XSS protection: `plot_title`, `focus_analyte_name`, `delta_period`, `latest_value`, `unit_display`, `unit_raw`, status labels
- Never concatenate user-provided strings into `innerHTML` or template literals that become HTML
- SVG attributes (`aria-label`) must also escape dynamic values

**Examples:**
```javascript
// CORRECT
titleEl.textContent = plot_title;
subtitleEl.textContent = focus_analyte_name;
valueEl.textContent = formattedValue;

// WRONG - XSS vulnerability
titleEl.innerHTML = plot_title; // Allows script injection
subtitleEl.innerHTML = `<span>${focus_analyte_name}</span>`; // Template literal injection
```

**Rationale**: Thumbnail data originates from LLM-generated content, which could theoretically contain malicious payloads if LLM is compromised or prompt-injected. Defense-in-depth requires treating all dynamic content as untrusted.

---

## Data Mapping (From PRD v4.2.2)

All fields below are **read-only** and must be rendered as provided. Do not compute, infer, or re-derive values on the frontend.

**Required Fields** (thumbnail won't emit if missing):
- `plot_title` (top-level, authoritative) → Header title text
- `status` → Status label + color (enum: `normal`, `high`, `low`, `unknown`)
- `point_count` → Footer count (show even if `0`)
- `series_count` → Footer count (show if > 1, hide if 0 or 1; single series is implicit)
- `sparkline.series` → Sparkline values array (1-30 numbers)

Note: `thumbnail.plot_title` will always match top-level `plot_title` (backend guarantee, see lines 94-96).

**Primary Value Row** (always rendered, even with placeholder):
- `latest_value` + `unit_display` → Primary value display
- If `latest_value` is null/unparseable, render `—` placeholder (do NOT hide entire row)
- Unit is hidden when value is placeholder `—`
- Status badge always renders (required field)

**Optional Sections** (hide entirely if null/missing):
- `focus_analyte_name` → Header subtitle (hide subtitle line if null)
- `delta_pct` + `delta_direction` + `delta_period` → Delta row (all three required together, hide row if any missing)

**Backend Guarantee:** The backend validates required fields and returns `null` from `deriveThumbnail()` if validation fails (see `server/utils/thumbnailDerivation.js:validateThumbnailOutput()`). This means the frontend will **never receive** a `thumbnail_update` event with missing required fields. If required fields are missing at runtime, it indicates a contract violation — log error and skip rendering that thumbnail.

### Formatting Rules (Deterministic)

**Latest Value (`latest_value`) Formatting:**
- Type handling:
  - If number type → format directly
  - If string type → use strict parsing:
    - `const parsed = Number(latest_value);` (stricter than `parseFloat()`, rejects malformed strings like `"12abc"`)
    - Validate: `Number.isFinite(parsed)` (rejects `NaN`, `Infinity`, and invalid inputs)
    - Treat empty/whitespace-only strings as invalid (render `—`)
    - If valid → use `parsed`, else render `—` placeholder
  - If `null`, `undefined`, non-finite, or unparseable → render `—` and hide unit
  - **Backend assumption**: Backend should send numeric types when possible (avoid string-encoded numbers)
- Format valid numbers using `Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })` (automatically trims trailing zeros: `12.00` → `"12"`, `12.50` → `"12.5"`)
- Unit concatenation:
  - **Backend contract (PRD v4.2.2, `thumbnailDerivation.js:144`)**: `unit_display` **always includes leading space** when non-null (e.g., `" mg/dL"`)
  - Frontend renders: `formattedValue + unit_display` (no additional space needed)
  - If `unit_display` is null → omit unit entirely
  - **Do NOT use `unit_raw` for display** — it lacks proper spacing and is provided only for debugging/logging
  - Example: `latest_value=123.4`, `unit_display=" mg/dL"` → `"123.4 mg/dL"`
  - Edge case: If backend contract is violated (unit_display lacks leading space), UI will render incorrectly (`123.4mg/dL`). This indicates a backend bug.

**Delta Percentage (`delta_pct`) Formatting:**
- **Backend Contract**: `delta_pct` is a SIGNED numeric percentage (type: `number`, can be float or integer; PRD v4.2.2:843) where negative = decrease, positive = increase
- Frontend ALWAYS formats to 1 decimal place (e.g., `5.3%`, `-2.1%`), regardless of backend precision.
- Sign formatting depends on `delta_direction`:
  - If `delta_direction === "up"` → format as `"+X.X%"` (positive sign)
  - If `delta_direction === "down"` → format as `"-X.X%"` (negative sign)
  - If `delta_direction === "stable"` → format as `"<0.1%"` (no sign prefix)
- If `abs(delta_pct) <= 0.1`, backend must send `delta_direction: "stable"`; frontend renders `"<0.1%"` (no sign prefix).
- Otherwise format as `"+5.3%"`, `"-2.1%"`, etc.
- If any of `delta_pct`, `delta_direction`, or `delta_period` is missing, hide entire delta row.
- `delta_direction` mapping:
  - `up` → icon `▲`, class `delta-up`, optional text `Up`
  - `down` → icon `▼`, class `delta-down`, optional text `Down`
  - `stable` → icon `—`, class `delta-stable`, optional text `Stable`
- **Backend contract for near-zero values**: When `abs(delta_pct) <= 0.1`, backend must send `delta_direction: "stable"` (per validation logic). Frontend must never show signed value with stable icon (visual contradiction). If `abs(delta_pct) <= 0.1` and `delta_direction !== "stable"`, treat as contract violation and hide the delta row.
- `delta_period`: Parse shorthand or render as-is. **Strict format requirements:**
  - Expected format: `{digits}{unit}` where unit is lowercase single character (`y`, `m`, `w`, `d`)
  - Examples: `"3m"`, `"1y"`, `"14d"` (valid); `"3M"`, `" 3m "`, `"3 months"` (invalid, render as-is)
  - No whitespace trimming or case normalization (backend sends clean format)
  - Example implementation:
  ```javascript
  // Expected backend format (per PRD v4.2.2): "3m", "1y", "14d"
  // Strict pattern: digits + lowercase unit letter only
  const periodPattern = /^(\d+)(y|m|w|d)$/;
  const match = delta_period.match(periodPattern);
  if (match) {
    const [, num, unit] = match;
    const unitMap = { y: 'year', m: 'month', w: 'week', d: 'day' };
    const unitName = unitMap[unit];
    const plural = parseInt(num) !== 1 ? 's' : '';
    return `over ${num} ${unitName}${plural}`;
  }
  return delta_period; // Render as provided if not shorthand (backend fallback)
  ```
- **Delta Sign/Direction Consistency:**
  - **Backend Contract**: PRD v4.2.2 derivation (lines 201, 211-213) ensures `delta_pct` sign matches `delta_direction` (positive with "up", negative with "down", near-zero with "stable")
  - Frontend validation (defensive): If sign and direction disagree (e.g., `delta_pct: -5.3` with `delta_direction: "up"`), log console warning and hide entire delta row (treat as invalid data)
  - Rationale: Contradictory delta indicators confuse users; backend guarantees consistency, but frontend validates defensively
  - Sign/direction agreement check:
    ```javascript
    // Defensive validation against backend bugs or contract violations
    const pctSign = delta_pct >= 0 ? '+' : '-';
    const expectedDirection = Math.abs(delta_pct) <= 0.1 ? 'stable' : delta_pct > 0.1 ? 'up' : 'down';
    if (delta_direction !== expectedDirection) {
      console.warn(`[Thumbnail] Delta sign/direction mismatch: ${delta_pct} vs ${delta_direction}`);
      // Hide delta row (contract violation)
    }
    ```
- `status` label mapping (text): `normal` → `Normal`, `high` → `High`, `low` → `Low`, `unknown` → `Unknown`.
- `point_count`: Always show, with proper pluralization: `point_count === 1 ? "1 point" : "${n} points"`. Show even if `0` ("0 points").
- `series_count`: Show only if greater than 1. Format as `"${n} series"`. Hide if 0 or 1 (single series is implicit).

---

## Ordering Rules

Deterministic ordering within a single assistant message:

1. Render thumbnails in the exact order that `thumbnail_update` events are received for that message.
2. Do not sort by `result_id` (preserve arrival order for deterministic UI).
3. If out-of-order SSE events arrive for the same message, preserve arrival order to keep the UI append-only.
4. **No Deduplication by `result_id`**: Render every `thumbnail_update` as a new thumbnail card. Per PRD v4.2.2, `result_id` is a fresh UUID on every emission, so it is not suitable for replacement or deduplication. Treat each event as independent and append-only.
   - **Rationale**: Frontend reconciliation is out of MVP scope; backend explicitly emits fresh IDs per update.
   - **Defensive cleanup**: If `replace_previous === true`, remove the most recent thumbnail for that message before appending the new one (see SSE event handling above).

---

## Rendering Rules & Fallbacks

- Hide missing optional sections
- Invalid or missing sparkline → hide sparkline only
- Never block chat rendering

**Status Field Handling:**
- If `status` is a valid enum value (`normal`, `high`, `low`, `unknown`) → render with appropriate styling
- `status: "unknown"` (valid enum value) → render with neutral styling (no color indication, uses `--status-unknown`)
- If `status` is missing or not a recognized enum value → skip rendering that thumbnail (required field validation)

**Required Field Validation:**
- Backend guarantees required fields are present (validation occurs in `deriveThumbnail()`)
- If required fields are missing at runtime, log console error (contract violation) and skip rendering
- This defensive check prevents partial/broken thumbnails if backend contract changes unexpectedly

---

## Sparkline Rendering

Rendering approach: **inline SVG** (preferred for clarity, accessibility, and tiny footprint).

**Backend Contract:** `sparkline.series` is a **required field** — backend validation ensures it's always present and contains 1-30 finite numbers. Frontend defensive handling below addresses edge cases from potential backend bugs or contract violations.

- Input: `sparkline.series` array of 1–30 numeric values from backend
- If array is missing or empty → log error (contract violation), hide sparkline section
- If `sparkline.series.length > 30` → slice to first 30 values before processing (defensive, shouldn't happen)
- If array contains mixed valid/invalid values → filter to finite numbers only (defensive)
- If array length === 1 (after filtering), render a flat line at 50% height (see scaling rule #2 below)
- Render as a single polyline within a fixed-height viewBox (no axes, no labels)
- Use a single stroke color with subtle opacity; no fill

### Sparkline Scaling (Explicit)

Given series values `[v0..vn]`:

1. Filter only finite numbers; if none remain → hide sparkline.
2. Compute `min` and `max`. If `min === max` (including single-point arrays after filtering):
   - Render flat line at 50% height: `points="0,12 100,12"` (y=12 is center of viewBox height 24)
   - Skip steps 3-5 (formula would divide by zero)
3. Map each value to `y` in `[2, 22]` (padding 2px top/bottom) using:
   - `y = 22 - ((v - min) / (max - min)) * 20`
4. X positions are evenly spaced from `0` to `100` across all points.
5. Construct `points` string as `"x,y x,y ..."`.

**SVG DOM Construction (Security-Critical):**

Use `document.createElementNS()` and `setAttribute()` for all SVG elements. **Never use string-based construction, `innerHTML`, or template literals** that become HTML.

```javascript
// CORRECT - Safe SVG construction
const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
svg.setAttribute('viewBox', '0 0 100 24');
svg.setAttribute('preserveAspectRatio', 'none');

const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
polyline.setAttribute('points', pointsString);  // pointsString is safe (computed coordinates)
polyline.setAttribute('stroke', 'var(--thumbnail-sparkline)');
polyline.setAttribute('stroke-width', '1.5');
polyline.setAttribute('fill', 'none');
polyline.setAttribute('stroke-linecap', 'round');
polyline.setAttribute('stroke-linejoin', 'round');

svg.appendChild(polyline);
sparklineContainer.appendChild(svg);

// WRONG - XSS vulnerability
sparklineContainer.innerHTML = `<svg viewBox="0 0 100 24">...</svg>`;  // Avoid
const svgString = `<polyline points="${points}"/>`; // Avoid string templates
```

**SVG attributes:**
- `viewBox="0 0 100 24"`
- `preserveAspectRatio="none"`
- `stroke-linecap="round"`, `stroke-linejoin="round"`
- `fill="none"`

**Reasoning:** SVG provides deterministic layout and predictable rendering across browsers without dependencies. `createElementNS` prevents injection attacks even if `points` data is compromised.

---

## Styling Constraints

- Desktop-first
- CSS only; no third-party chart libs
- Calm, clinical visual tone
- Subtle semantic colors only

---

## Visual Tokens (Defaults)

Use these tokens unless overridden by existing system styles.

**Implementation Location:**
- Define tokens in `public/css/chat.css` scoped to `.thumbnail-card` selector
- Alternatively, add to `:root` if integrating with existing global theme system
- Tokens are defaults — adjust to match existing design system if present

- `--thumbnail-card-bg`: `#ffffff`
- `--thumbnail-card-border`: `#e6e8ec`
- `--thumbnail-card-radius`: `12px`
- `--thumbnail-card-padding`: `12px 14px`
- `--thumbnail-title`: `#1f2937`
- `--thumbnail-subtitle`: `#6b7280`
- `--thumbnail-value`: `#111827`
- `--thumbnail-muted`: `#9ca3af`
- `--thumbnail-sparkline`: `#1f2937` (opacity 0.45)
- `--status-normal`: `#059669`
- `--status-high`: `#b45309`
- `--status-low`: `#2563eb`
- `--status-unknown`: `#6b7280`

Typography:
- Title: 14px/1.3, weight 600
- Subtitle: 12px/1.3, weight 400
- Value: 20px/1.2, weight 600
- Meta (delta/footer): 12px/1.3, weight 400

Spacing:
- 8px vertical rhythm between sections
- 6px gap between value and status pill

---

## Component Styling Details

### Status Pill
- Border-radius: 4px
- Padding: 2px 8px
- Font: 11px/1.3, weight 500
- Background: status color at 10% opacity
- Text: status color at 100%
- Example: `.status-normal { background: rgba(5, 150, 105, 0.1); color: #059669; }`

### Thumbnail Stack Spacing
- Gap between thumbnail cards: 12px (apply via CSS gap or margin-bottom on `.thumbnail-card`)
- Margin-top from `.chat-bubble-content`: 12px (when markdown content is present)
- **Empty content evaluation timing:**
  - Check on `message_end` event only (after streaming completes and cursor is removed)
  - Use `.chat-bubble-content.textContent.trim() === ''` to detect empty content
  - If empty, apply `margin-top: 0` to `.thumbnail-stack` (e.g., via `.thumbnail-stack--no-text-above` class)
  - Do NOT re-evaluate during streaming (cursor node would cause false positives)
- **Fallback for missing `message_end` event:**
  - If `message_end` never fires (error/abort/reconnection), margin adjustment may be skipped
  - **Acceptable for MVP**: Worst case is 12px extra margin above thumbnails (cosmetic issue, not functional)
  - **Future enhancement**: Add timeout-based finalization (e.g., 30s after last text event) or check text content on every `thumbnail_update` event (less performant)
  - Backend contract (PRD v4.2.3) guarantees `message_end` for normal flows; this fallback handles exceptional cases only
- If only thumbnails present (tool-only turn), no top margin needed
- Container padding: 0 (individual cards handle their own margins)

### Sparkline SVG Attributes
```svg
<polyline
  points="..."
  stroke="var(--thumbnail-sparkline)"
  stroke-opacity="0.45"
  stroke-width="1.5"
  fill="none"
  stroke-linecap="round"
  stroke-linejoin="round"
/>
```

### Card Width Responsive Behavior

**Concrete CSS Implementation:**
```css
.thumbnail-card {
  width: 100%;
  max-width: 420px;
  min-width: 320px;
}

@media (max-width: 320px) {
  .thumbnail-card {
    min-width: 100%;
  }
}

.thumbnail-stack {
  padding: 0 12px; /* Prevents edge collision on narrow screens */
}
```

**Behavior:**
- Desktop default: Cards auto-size between 320-420px based on container width
- Narrow viewports (<320px): Cards shrink to 100% container width
- Responsive approach avoids horizontal scrolling on any screen size

**Mid-Size Viewport Handling (450-500px):**

At viewports where `70% width < 320px`, assistant bubbles containing thumbnails must override max-width to accommodate thumbnail min-width:

```css
/* Override bubble width for assistant messages with thumbnails */
.chat-message-assistant:has(.thumbnail-stack) .chat-bubble {
  max-width: 85%; /* Relaxes constraint to accommodate min-width: 320px */
}

/* Below 380px, allow cards to shrink fully */
@media (max-width: 380px) {
  .thumbnail-card {
    min-width: 100%;
  }

  .chat-message-assistant:has(.thumbnail-stack) .chat-bubble {
    max-width: 90%; /* Further relaxation for narrow screens */
  }
}
```

**Rationale**: Default chat bubble `max-width: 70%` conflicts with thumbnail `min-width: 320px` at viewports ~450px (70% of 450px = 315px < 320px). Using `:has()` selector allows surgical override only for messages with thumbnails, preserving existing chat bubble widths for text-only messages.

**Browser Compatibility:**
- Requires CSS `:has()` selector support (Chrome 105+, Safari 15.4+, Firefox 121+, Edge 105+)
- No fallback required for MVP (desktop-first, modern browser assumption)
- If broader support needed in future, use class-based approach instead of `:has()` selector (e.g., add `.has-thumbnails` class to `.chat-message-assistant` when thumbnails are rendered)

---

## Layout Rules

- Render thumbnails as vertical stack within the assistant message bubble.
- See "Component Styling Details" section above for card width, spacing, and responsive behavior.
- Do not create a grid; keep the layout linear and predictable.
- Streaming markdown updates MUST target `.chat-bubble-content` only; do not replace the full bubble `innerHTML` or thumbnails will be erased.

### Interaction Rules

- Thumbnails are read-only; no click/hover interactions.
- No tooltips, no zoom, no focus states beyond standard text selection.

---

## Accessibility

- Status must not rely on color only; include text label (`Normal`, `High`, `Low`, `Unknown`).
- Provide `aria-label` for sparkline: `Trend for {plot_title}`.
- Ensure text contrast ratios meet WCAG AA for body text.

---

## Failure Modes

- Missing/invalid optional fields should fail soft (hide section only).
- Missing/invalid required fields should skip rendering that thumbnail.
- Never throw errors that interrupt chat rendering.
- If the thumbnail payload is invalid at runtime, log a console error and skip rendering that thumbnail.

---

## Acceptance Criteria

- Deterministic rendering
- Correct message anchoring
- No frontend computation beyond UI-only formatting/mapping
- Existing plot UI unchanged
- Sparkline hidden on invalid input without breaking chat
- Status uses enum mapping only (`normal`, `high`, `low`, `unknown`)
- Thumbnails survive streaming markdown updates
- Tool-only turns render thumbnails without assistant text
- DOM structure matches section "DOM Structure (Reference Implementation)"
- Numeric formatting uses `en-US` locale (consistent with application default)
- Browser support: Modern desktop browsers with CSS `:has()` support (Chrome 105+, Safari 15.4+, Firefox 121+, Edge 105+)

---

## Summary

PRD v4.2.4 completes the MVP implementation of Chat Plot Thumbnails by defining a clean, deterministic desktop UI layer that consumes existing backend contracts without introducing new logic.
