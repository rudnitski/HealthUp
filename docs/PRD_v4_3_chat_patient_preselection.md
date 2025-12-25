# PRD v4.3: Pre-Chat Patient Selection and Cleanup

**Status:** Ready
**Created:** 2025-02-14
**Author:** Codex (with user collaboration)
**Target Release:** v4.3
**Dependencies:** PRD v3.2 (Conversational SQL Assistant)

> **Note:** This PRD is independent of PRD v4.1 (Chat UI Redesign). The patient selector can be implemented with the current UI. If v4.1 is implemented later, the selector row integrates naturally above the chat input.

---

## Overview

### Problem Statement

Today, when a user asks about lab results, the assistant pauses the flow to enumerate patients and ask which one to use. This creates friction and adds unnecessary back-and-forth. The current behavior also mixes patient selection logic between the LLM and backend, making it harder to reason about and maintain.

**Current behavior:**
1. User opens chat and asks a question.
2. LLM sees multiple patients and asks user to choose.
3. Backend parses user response to infer the selected patient.
4. LLM continues with the chosen patient.

**Desired behavior:**
1. User chooses a patient before the chat starts (UI selection).
2. The first patient is preselected by default.
3. Chat session is created with a locked `selectedPatientId`.
4. LLM never asks which patient to use; it uses the selected patient context automatically.
5. Switching patients always creates a new chat.

---

## Goals

1. **Zero extra turns**: Remove LLM-driven patient selection prompts.
2. **Explicit patient context**: UI selection sets the patient before the first message.
3. **Deterministic scope**: Backend always applies patient scope from session context.
4. **Clean refactor**: Remove unused patient-selection parsing and prompt logic.
5. **Clear empty state**: If there are no patients, prompt the user to scan/upload lab results.

## Non-Goals (Out of Scope)

- Manual patient creation or editing
- Multi-patient chat sessions or cross-patient comparisons
- Changes to report ingestion or patient extraction
- Authentication/authorization changes

---

## Success Metrics

- 0% of chats begin with the assistant asking for a patient selection
- <2 seconds from opening chat to typing the first question (no extra step beyond selection)
- 100% of final SQL queries in multi-patient databases include a patient scope filter
- 100% of tool call data queries in multi-patient databases include a patient scope filter (defense in depth)
- 0% of tool calls expose cross-patient data to LLM in multi-patient mode (verified via security testing)
- Removal of unused patient-selection code paths (no dead code)

---

## User Stories

### Story 1: Start a chat with a preselected patient
**As a** user with multiple patients
**I want** a clear patient selector before I type
**So that** I can immediately ask a question with the right context

**Acceptance Criteria:**
- A row of patient chips is visible above the chat input.
- The first patient is selected by default on page load.
- Session is created automatically after patient selector renders on page load (with selected patient already bound).
- Chat input is **disabled** until session initialization completes (POST /sessions succeeds AND SSE session_start event received).
- User can change patient selection freely before sending the first message.
- The assistant never asks which patient to use.

### Story 2: Switch to a different patient by starting a new chat
**As a** user
**I want** to switch patients
**So that** I can start a new discussion for a different person

**Acceptance Criteria:**
- Before first message: clicking a different patient chip switches selection (no confirmation needed).
- After first message: patient chips are locked; user must click "New Chat" button to start over.
- "New Chat" button is always visible once a conversation has started (unless patient list becomes empty after reset).
- Clicking "New Chat" clears messages, unlocks chips, destroys the current session, and re-fetches patient list.
- If patient list is empty after "New Chat": hide chips row and "New Chat" button, show empty state UI.
- The previous chat is not mutated or re-scoped (simply discarded).

### Story 3: No patients available
**As a** user
**I want** guidance when there are no patients
**So that** I understand how to proceed

**Acceptance Criteria:**
- If no patients exist, the chat input is disabled.
- Empty state prompts the user to scan/upload lab results.
- The primary CTA links to the existing upload/scan flow.

### Story 4: Patient removed during an active chat
**As a** user
**I want** the system to handle patient removal clearly
**So that** I do not unknowingly chat about the wrong person

**Acceptance Criteria:**
- If the selected patient is removed, the next message attempt returns a 409 and the chat becomes read-only.
- A banner explains that the patient is no longer available.
- A CTA lets the user start a new chat (with the first available patient preselected).

---

## UX Design

### Patient Selection Row
- Location: at the top of the chat container, above the `.chat-messages` container (not directly above the input).
- Presentation: horizontal row of pill-style chips (name only).
- Default: first patient preselected on page load.
- Selection locked after the first message is sent.

### Empty State
- Show when `patients.length === 0`.
- Primary CTA: "Scan lab results" (links to `#upload` in the existing upload flow).
- Secondary text: explains that patients are created from lab results.

### Wireframe (Chat Section)

**Before first message:**
```
[ John Doe ] [ Jane Smith ] [ Patient (a1b2c3...) ]
      ↑ selected (highlighted, clickable)

[ Empty state / example prompts ]

[ Ask a question about your lab results... ] [ Send ]
```

**After first message (conversation active):**
```
[ John Doe ] [ Jane Smith ] [ Patient (a1b2c3...) ]    [ 🔄 New Chat ]
      ↑ selected (highlighted, LOCKED)

[ Chat messages ... ]

[ Ask a question about your lab results... ] [ Send ]
```

> Note: Third chip shows unnamed patient format using first 6 chars of UUID.
> Note: "New Chat" button appears only after conversation starts.

### Interaction Rules
- **Before first message:** Patient chips are interactive. Clicking a different chip:
  1. **Disables chat input** (prevents message submission during switch)
  2. Closes existing SSE connection
  3. Calls `DELETE /api/chat/sessions/:sessionId`
  4. Creates new session with new patient
  5. Reconnects SSE
  6. **Re-enables chat input** when new `session_start` event received
- **After first message:** Patient chips are locked (visually dimmed, non-clickable). Lock happens when `message_end` SSE event is received for the first message. User must click "New Chat" to start over.
  - **Why message_end, not HTTP 200**: HTTP response may return before async processing completes. `message_end` SSE event guarantees the message was fully processed by the LLM.
  - **Fallback for failures**: If `message_end` is never received (error during processing), chips remain unlocked, allowing user to retry or switch patients.

### Input State Management (Initialization Lifecycle)

**Happy Path Timeline** (canonical sequence for normal initialization):

```
1. Page Load
   → GET /api/reports/patients?sort=recent
   → Render patient selector (first patient selected by default)
   → Input: DISABLED ("Initializing...")

2. Session Creation
   → POST /api/chat/sessions (with selectedPatientId)
   → Receive: {sessionId, selectedPatientId}
   → Input: DISABLED (session created, waiting for SSE)

3. SSE Connection
   → GET /api/chat/stream?sessionId=...
   → Receive: session_start event
   → Input: ENABLED ("Ask a question about your lab results...")

4. Ready for user input
```

**Mandatory Preflight Validation** (part of normal flow):
- `HEAD /api/chat/sessions/:id/validate` MUST be called BEFORE step 3 (SSE connection)
- This is part of the normal happy path for session initialization
- Validates session exists before attempting SSE connection
- Enables graceful error handling for expired sessions (see "Error Handling" section)

**Critical timing specification to prevent "Session not initialized" errors:**

1. **Initial page load**: Input DISABLED, placeholder shows "Initializing..."
2. **After GET /api/reports/patients?sort=recent completes**: Input remains DISABLED
3. **After POST /api/chat/sessions succeeds**: Input remains DISABLED (session created but SSE not connected)
4. **After SSE session_start event received**: Input ENABLED, placeholder shows "Ask a question about your lab results..."

**Exception - Zero patients**: If patient list returns empty array, skip steps 3-4 and show empty state UI (input remains permanently disabled with different placeholder: "Upload lab results to start chatting").

**Rationale**: Enabling input before SSE handshake completes allows users to send messages before the session is fully initialized, causing race conditions and "Session not found" errors. The session must be created AND SSE must be attached before accepting user input.

**SSE Event Handler Registration Order (Race Condition Prevention)**:
- Client MUST register all SSE event handlers (including `session_start`) in the same synchronous block BEFORE calling `new EventSource(url)`.
- **Why**: EventSource queues events internally until the first event loop tick after construction. If handlers are registered asynchronously or after construction, the `session_start` event may fire before handlers are attached.
- **Implementation pattern**:
  ```javascript
  // CORRECT: Define handlers first
  const handlers = {
    session_start: (data) => { enableInput(); },
    // ... other handlers
  };

  // Then create EventSource and attach handlers synchronously
  const eventSource = new EventSource(url);
  eventSource.addEventListener('message', (e) => {
    const data = JSON.parse(e.data);
    handlers[data.type]?.(data);
  });
  ```

**Timeout and Recovery**:
- If `session_start` event not received within 10 seconds after `POST /api/chat/sessions` succeeds:
  - Show error banner: "Unable to initialize chat. Please try again."
  - Show "Retry" button that retries SSE connection with the SAME sessionId (session was created successfully, only SSE attachment failed)
  - **CRITICAL**: Do NOT create a new session on retry. The existing session is valid - only SSE connection failed.
  - If SSE retry fails after 3 attempts (30 seconds total), THEN offer to recreate session:
    - Delete the orphaned session: `DELETE /api/chat/sessions/:sessionId`
    - Create new session: `POST /api/chat/sessions` with same patient
    - Retry SSE connection with new sessionId
  - Input remains disabled until successful initialization or user refreshes page
- Clear timeout timer when `session_start` event is received
- **Rationale**: Prevents indefinite "stuck" state if SSE connection fails. Retrying SSE first (instead of recreating session) avoids orphan session accumulation under the 100-session cap.

**Chip Locking Policy (Partial Failures and Retries)**:
- Chips lock ONLY after first **successful** message (`message_end` SSE event received)
- **Why message_end SSE event**: HTTP 200 may return before async LLM processing completes. The `message_end` SSE event is the definitive signal that a message was fully processed by the LLM. This prevents locking chips when the backend accepted the request but processing later failed.
- **Note on 202 responses**: If 202 is added in the future (queued processing), it should NOT lock chips. Only `message_end` SSE event triggers locking.
- If first message fails (400/409/500 HTTP response, or SSE error/timeout without `message_end`), chips remain **UNLOCKED**
- User can retry sending first message (chips still unlocked, patient switching still allowed)
- User can switch patients before first successful message (chips unlocked)
- Once `message_end` SSE event is received for ANY message, chips lock **permanently** for that session
- "New Chat" button appears when `message_end` is first received, not on HTTP response
- **Rationale**: Locked state must match backend session state (conversation started = at least one message fully processed). Failed or in-progress messages don't advance conversation state.
- **New Chat button:** Comprehensive reset sequence (idempotent, safe to call during message processing):
  1. **Close SSE connection**: `eventSource.close()` (drops in-flight SSE events)
  2. **Cache and delete session**: Store `oldSessionId = this.sessionId`, then call `DELETE /api/chat/sessions/:oldSessionId` (if oldSessionId was set)
  3. **Null session ID**: `this.sessionId = null` (prevents reuse during reconnection)
  4. **Clear all client-side state** (CRITICAL - prevents UI artifacts):
     - `messageBuffers.clear()` - Per-message text accumulators (Map<message_id, text>)
     - `activeTools.clear()` - Active tool execution indicators (Set)
     - `charts.forEach(chart => chart.destroy())` + `charts.clear()` - Destroy Chart.js instances and clear Map
     - Clear parameter selector listener (if exists in legacy code):
       ```javascript
       // Search for: parameterSelectorChangeHandler in public/js/chat.js or public/js/app.js
       // Pattern: addEventListener('change', parameterSelectorChangeHandler)
       // If found: element.removeEventListener('change', parameterSelectorChangeHandler)
       // If NOT found: This may be obsolete - skip this step
       ```
     - Reset processing flags: `isProcessing = false`, `isConversationStarted = false`
     - Reset plot counter: `this.plotCounter = 0` (starts fresh canvas IDs for new conversation)
  5. **Clear DOM**:
     - Remove all message elements from `.chat-messages` container
     - Show empty state / example prompts
     - Clear input textarea
  6. **Unlock patient chips**: Remove `.patient-chip-locked` class, enable buttons
  7. **Hide "New Chat" button**: `newChatBtn.hidden = true`
  8. **Re-fetch patient list**: `patients = await fetchPatients()` (handles case where patient was deleted)
  9. **Handle empty state**: If `patients.length === 0`:
     - **Hide patient chips row** (set `display: none` on `.chat-patient-selector`)
     - **Hide "New Chat" button** (already hidden in step 7, keep hidden)
     - Show empty state UI in `.chat-messages` container: "No patients found. Upload lab results to get started."
     - Disable input with placeholder: "Upload lab results to start chatting"
     - Add CTA button linking to upload flow
     - **Skip steps 10-12** (no session creation, no SSE connection)
     - **End reset sequence**
  10. **Preselect first patient**: Set first patient as selected (visual + state)
  11. **Create new session**: `POST /api/chat/sessions` with first patient's ID, store new `sessionId`
  12. **Reconnect SSE**: `GET /api/chat/stream?sessionId=...` with new sessionId

**New Chat During Message Processing**:
- "New Chat" button remains **enabled** even while a message is processing
- User can click "New Chat" at any time (no need to wait for message completion)
- Cleanup is idempotent and safe: SSE close drops in-flight events, DELETE invalidates session
- Backend may continue processing the old message briefly, but events are dropped (closed connection)
- No cancellation of in-flight LLM requests (acceptable - they time out naturally)

- The UI should clearly reflect selection (active styling) and locked state (dimmed styling).

### Single-Patient Behavior
When only one patient exists:
- Patient selector row is still visible with a single chip (preselected).
- The chip is non-interactive (no other options to choose).
- Provides visual confirmation of whose data is being queried.
- Tooltip on hover: "Only one patient in system".

### Unnamed Patient Display
When `full_name` is NULL or empty:
- Display as: `Patient (abc123...)` using first 6 characters of UUID.
- Ensure chip has sufficient width to display truncated ID.
- Full UUID shown in tooltip on hover.

### DOM Structure and CSS Classes

**Insertion Point**: Add patient selector row ABOVE the existing `.chat-messages` container in `public/index.html`.

**Current structure**:
```html
<div id="conversational-chat-container" class="chat-container">
  <div class="chat-messages" role="log" aria-live="polite">
    <!-- Existing messages -->
  </div>
  <!-- Chat input below -->
</div>
```

**New structure**:
```html
<div id="conversational-chat-container" class="chat-container">
  <!-- NEW: Patient Selector Row -->
  <div class="chat-patient-selector" id="chat-patient-selector">
    <div class="patient-chips" id="patient-chips" role="radiogroup" aria-label="Select patient">
      <!-- Dynamically populated via JavaScript:
      <button class="patient-chip patient-chip-selected" role="radio" aria-checked="true" data-patient-id="uuid-1">
        John Doe
      </button>
      <button class="patient-chip" role="radio" aria-checked="false" data-patient-id="uuid-2">
        Jane Smith
      </button>
      <button class="patient-chip" role="radio" aria-checked="false" data-patient-id="uuid-3" title="Full UUID: a1b2c3d4...">
        Patient (a1b2c3...)
      </button>
      -->
    </div>
    <button class="chat-new-chat-btn" id="new-chat-btn" hidden>
      <span class="icon">🔄</span>
      <span class="label">New Chat</span>
    </button>
  </div>

  <!-- Existing chat-messages container -->
  <div class="chat-messages" role="log" aria-live="polite" aria-label="Chat messages">
    <!-- Existing empty state and messages -->
  </div>

  <!-- Existing chat input -->
  <div class="chat-input">
    <textarea class="chat-input-textarea" placeholder="Ask a question about your lab results..."></textarea>
    <button class="chat-send-button">Send</button>
  </div>
</div>
```

**Keyboard Accessibility**:
- **Tab navigation**: Native `<button>` elements support Tab/Shift+Tab navigation between chips (no custom JS needed)
- **Focus ring**: `:focus-visible` styles provide visible focus indicator for keyboard users (see CSS below)
- **Arrow key navigation**: Standard `radiogroup` pattern expects left/right arrow keys to move between options. **Deferred to future enhancement** - Tab navigation is sufficient for MVP.
- **Enter/Space**: Native button behavior - activates the focused chip

**CSS Classes** (add to `public/css/chat.css`):

```css
/* Patient Selector Row */
.chat-patient-selector {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem;
  border-bottom: 1px solid #e5e7eb;
  background: #ffffff;
  gap: 1rem;
}

.patient-chips {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  flex: 1;
}

.patient-chip {
  padding: 0.5rem 1rem;
  border: 1px solid #d1d5db;
  border-radius: 9999px;
  background: #ffffff;
  color: #374151;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.patient-chip:hover:not(.patient-chip-locked) {
  background: #f3f4f6;
  border-color: #9ca3af;
}

.patient-chip-selected {
  background: #3b82f6;
  color: #ffffff;
  border-color: #3b82f6;
}

.patient-chip-locked {
  opacity: 0.6;
  cursor: not-allowed;
}

.patient-chip-single {
  cursor: default;
}

/* Accessibility: Focus ring for keyboard navigation */
.patient-chip:focus-visible {
  outline: 2px solid #3b82f6;
  outline-offset: 2px;
}

.chat-new-chat-btn:focus-visible {
  outline: 2px solid #3b82f6;
  outline-offset: 2px;
}

.chat-new-chat-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  background: #ffffff;
  color: #374151;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.chat-new-chat-btn:hover {
  background: #f3f4f6;
  border-color: #9ca3af;
}

/* Empty state when no patients */
.chat-patient-selector-empty {
  padding: 1rem;
  text-align: center;
  color: #6b7280;
  font-size: 0.875rem;
}
```

**JavaScript State Management**:

```javascript
// State hooks in chat.js
class ConversationalSQLChat {
  constructor() {
    // ... existing fields ...
    this.selectedPatientId = null;
    this.isConversationStarted = false; // Tracks if first message_end received
    this.patients = []; // Populated from GET /api/reports/patients?sort=recent
  }

  // Lock chips after first message_end SSE event
  // Called from SSE event handler when message_end is received
  lockPatientSelection() {
    if (this.isConversationStarted) return; // Already locked

    this.isConversationStarted = true;
    const chips = document.querySelectorAll('.patient-chip');
    chips.forEach(chip => {
      chip.classList.add('patient-chip-locked');
      chip.disabled = true;
    });
    document.getElementById('new-chat-btn').hidden = false;
  }

  // Unlock chips on new chat
  unlockPatientSelection() {
    this.isConversationStarted = false;
    const chips = document.querySelectorAll('.patient-chip');
    chips.forEach(chip => {
      chip.classList.remove('patient-chip-locked');
      chip.disabled = false;
    });
    document.getElementById('new-chat-btn').hidden = true;
  }

  // SSE event handler - call lockPatientSelection on message_end
  handleSSEEvent(event) {
    const data = JSON.parse(event.data);

    switch (data.type) {
      case 'message_end':
        // CRITICAL: Lock chips when message is fully processed
        this.lockPatientSelection();
        break;
      // ... other event handlers
    }
  }
}
```

---

## Technical Design

### Implementation Decisions

**1. Endpoint Consolidation**
- **Decision**: Extend existing `/api/reports/patients` with `?sort=recent` query parameter instead of creating new `/api/chat/patients`
- **Rationale**: Single source of truth, backward compatible, MVP has no real users (breaking changes acceptable)
- **Default behavior**: No query param = alphabetical sort (reports browser continues working)
- **Chat behavior**: `?sort=recent` = sorted by most recent report

**2. SSE Connection Management**
- **Decision**: Store active SSE connections in separate Map (`sessionId → res`) outside sessionManager
- **Rationale**: SSE response objects are non-serializable, can't be stored in session state
- **Behavior**: DELETE closes active SSE if exists, new SSE connection closes previous (last writer wins)

**3. Patient Scope Enforcement Strategy**
- **Decision**: Recompute patient count on EVERY message (not cached in session)
- **Rationale (Security)**: Cached `patientCount` creates data-leak vulnerability if a patient is added after session creation. Example attack:
  1. DB starts with 1 patient (Patient A)
  2. Session created with `patientCount=1` (cached)
  3. Admin uploads lab results for Patient B (DB now has 2 patients)
  4. User sends query: "Show all lab results"
  5. Scope enforcement sees cached `patientCount=1`, SKIPS patient filter
  6. Query returns data for BOTH patients (leak!)
- **Implementation**: Query `SELECT COUNT(*) FROM patients` in POST /api/chat/messages handler before calling `ensurePatientScope()`
- **Performance**: Negligible cost (one COUNT query per message) vs. security benefit
- **Frontend role**: Prevent session creation when zero patients exist (show empty state UI)
- **Backend role**: Validate `selectedPatientId` exists in database (return 404 if not found)

### API Contracts

**1) GET /api/reports/patients?sort=recent** (Extended Endpoint)
- Purpose: populate patient selector and reports browser dropdown
- Query Parameters:
  - `sort` (optional): Sort order for results
    - Omitted or `sort=alpha`: `ORDER BY full_name ASC NULLS LAST, created_at DESC` (alphabetical primary sort with newest-first tie-breaker for unnamed patients)
    - `sort=recent`: `ORDER BY last_seen_report_at DESC NULLS LAST, full_name ASC NULLS LAST, created_at DESC` (chat interface)
- Response:
```json
{
  "patients": [
    {
      "id": "a1b2c3d4-...",
      "full_name": "John Doe",
      "display_name": "John Doe",
      "last_seen_report_at": "2025-01-10T12:34:56Z"
    },
    {
      "id": "e5f6g7h8-...",
      "full_name": null,
      "display_name": "Patient (e5f6g7...)",
      "last_seen_report_at": null
    }
  ]
}
```
- `display_name`: Computed field. If `full_name` is null/empty, returns `Patient ({id.slice(0,6)}...)`.
- `last_seen_report_at`: Added field (existing consumers ignore extra fields, backward compatible)
- If no patients: return `{ "patients": [] }`.

**Field Semantics (Breaking Change from Current)**:
- **Current behavior**: `COALESCE(full_name, 'Unnamed Patient') AS full_name` (reports.js:199)
- **New behavior**:
  - `full_name`: Raw database value (NULL or actual name) - **no COALESCE**
  - `display_name`: Computed UI-friendly value (uses `full_name ?? "Patient (uuid...)"`)
- **Migration impact**: Reports browser currently expects `full_name` to never be NULL (uses COALESCE). After this change, reports browser should migrate to use `display_name` field instead.
- **Implementation**:
  ```sql
  SELECT
    id,
    full_name,  -- Raw value, can be NULL
    CASE
      WHEN full_name IS NOT NULL AND full_name != '' THEN full_name
      ELSE 'Patient (' || SUBSTRING(id::text FROM 1 FOR 6) || '...)'
    END AS display_name,
    last_seen_report_at
  FROM patients
  ORDER BY
    CASE
      WHEN $1 = 'recent' THEN last_seen_report_at
      ELSE NULL
    END DESC NULLS LAST,
    full_name ASC NULLS LAST,
    created_at DESC;
  ```

**Backward Compatibility**:
- Existing `/api/reports/patients` consumers get new fields (`display_name`, `last_seen_report_at`) - safe to ignore
- **Breaking**: `full_name` can now be NULL (was `COALESCE(full_name, 'Unnamed Patient')`)
- Default sort order modified: alphabetical by `full_name` with `created_at DESC` tie-breaker (improves UX for unnamed patients)

**Migration Required (Mandatory Verification)**:

**CRITICAL IMPLEMENTATION STEP**: Before deploying this change, implementer MUST:

1. **Re-run consumer audit**: `grep -r "reports/patients" public/js server/ --include="*.js"`
2. **Verify each consumer** handles `full_name === null` correctly
3. **Update all UI rendering** that uses `full_name` directly to use `display_name` instead
4. **Add defensive checks** in any code that directly accesses `patient.full_name` without null handling
5. **Test with NULL full_name**: Create test patient with NULL full_name and verify all UI renders correctly

**Consumer audit results** (update this table during implementation):

| File | Line | Type | Current Code | Required Change | Status |
|------|------|------|--------------|-----------------|--------|
| `public/js/reports-browser.js` | 30 | Consumer | `option.textContent = patient.full_name \|\| 'Unnamed Patient';` | `option.textContent = patient.display_name;` | MUST CHANGE |
| `public/js/chat.js` | N/A | Consumer (new) | N/A | Use `display_name` from start | NEW CODE |
| `server/routes/reports.js` | 196 | Provider | Endpoint definition | Update to return new fields | IMPLEMENTATION |
| *Add additional consumers found during audit* | | | | | |

**Consumer Details**:

1. **`public/js/reports-browser.js:30`** (MUST CHANGE):
   - **Current code**: `option.textContent = patient.full_name || 'Unnamed Patient';`
   - **New code**: `option.textContent = patient.display_name;`
   - **Rationale**: `display_name` is computed server-side and guaranteed non-null. Remove client-side fallback logic.

2. **`public/js/chat.js`** (NEW CODE - no migration needed):
   - Patient selector will use `display_name` field from the start
   - No backward compatibility concern (feature doesn't exist yet)

3. **`server/routes/reports.js:196`** (IMPLEMENTATION):
   - Endpoint definition - will be updated to return new fields per API contract
   - No consumer migration needed (this is the provider)

**2) POST /api/chat/sessions**
- Purpose: create a chat session with locked patient context
- Request:
```json
{
  "selectedPatientId": "uuid"
}
```
- Response:
```json
{
  "sessionId": "uuid",
  "selectedPatientId": "uuid"
}
```
- Validation:
  - 400 if `selectedPatientId` missing or invalid UUID format
  - 404 if patient not found in database
- Error shape (consistent with other chat endpoints):
  ```json
  { "error": "string", "code": "INVALID_REQUEST|PATIENT_NOT_FOUND" }
  ```

**Implementation**:
```javascript
// POST /api/chat/sessions handler
router.post('/sessions', async (req, res) => {
  const { selectedPatientId } = req.body;

  // Validation
  if (!selectedPatientId || !isValidUUID(selectedPatientId)) {
    return res.status(400).json({
      error: 'selectedPatientId is required and must be a valid UUID',
      code: 'INVALID_REQUEST'
    });
  }

  // Check patient exists
  const patientResult = await pool.query(
    'SELECT id FROM patients WHERE id = $1',
    [selectedPatientId]
  );

  if (patientResult.rows.length === 0) {
    return res.status(404).json({
      error: 'Patient not found',
      code: 'PATIENT_NOT_FOUND'
    });
  }

  // Create session
  const session = sessionManager.createSession();
  session.selectedPatientId = selectedPatientId;

  logger.info('[chatStream] Session created:', {
    session_id: session.id,
    selected_patient_id: selectedPatientId
  });

  res.json({
    sessionId: session.id,
    selectedPatientId: selectedPatientId
  });
});
```

**Patient Scope Enforcement (Per-Message, Not Cached)**:
- Patient count is **NOT** stored in session (security risk - see Implementation Decisions section)
- Instead, `POST /api/chat/messages` handler queries current count before validating SQL:
  ```javascript
  const countResult = await pool.query('SELECT COUNT(*) as count FROM patients');
  const currentPatientCount = parseInt(countResult.rows[0].count, 10);

  const scopeCheck = ensurePatientScope(sql, session.selectedPatientId, currentPatientCount);
  if (!scopeCheck.valid) {
    return res.status(400).json({
      error: scopeCheck.violation.message,
      code: scopeCheck.violation.code
    });
  }
  ```
- `ensurePatientScope()` returns `{ valid: boolean, violation?: { code, message } }`:
  - If `currentPatientCount <= 1`: Returns `{ valid: true }` (single-patient DB, no scope check)
  - If `currentPatientCount > 1`: Validates patient scope is present AND exclusive (multi-patient DB)
  - **Exclusivity requirement**: Query must ONLY reference the selected patient ID, no other patient IDs allowed
- **Why recompute**: Prevents data leak if patient count changes during session lifetime

**3) HEAD /api/chat/sessions/:sessionId/validate** (New endpoint for EventSource error handling)
- Purpose: Validate session exists before opening SSE connection
- Method: HEAD (no response body, only status code)
- Response codes:
  - 200 OK: Session exists and is valid
  - 404 Not Found: Session expired or never existed
  - 400 Bad Request: Invalid sessionId format
- **TTL Behavior**: Validation is **non-mutating** and does NOT refresh session TTL
  - Implementation MUST use a "peek" method (e.g., `sessionManager.peekSession(id)`) instead of `sessionManager.getSession(id)`
  - `peekSession()` directly accesses `sessions.get(id)` without updating `lastActivity`
  - **Rationale**: Prevents validation polling from keeping sessions alive indefinitely. Only user interactions (POST /messages, SSE events) should extend session lifetime.
- Rationale: EventSource API limitation workaround. Standard `EventSource.onerror` cannot distinguish between 404 (session expired), 500 (server error), and network timeouts. Preflight HEAD request enables graceful recovery from session expiry without switching to fetch + ReadableStream (which would require manual SSE parsing).

**TTL and Keepalive Semantics (Explicit Design Decision)**:
- **SSE keepalive pings do NOT refresh session TTL**. This is intentional.
- **GET /stream (SSE attach) does NOT refresh session TTL**. Implementation must use `peekSession()`.
- **HEAD /validate does NOT refresh session TTL**. Implementation must use `peekSession()`.
- Only user interactions (**POST /messages**, **POST /sessions**) refresh `lastActivity`.
- **Rationale**:
  1. Keepalives and SSE connections are background operations, not user activity.
  2. Zombie sessions (browser tab closed but connection persists) would never expire if keepalives/connections refreshed TTL.
  3. 1-hour TTL is generous enough for normal active use.
- **Edge case**: If a user reads chat for >1 hour without sending messages, session may expire. This is acceptable:
  - Frontend can detect expiry via preflight HEAD validation before next message.
  - Session recreation is fast and transparent to user.
  - Conversation history is lost (expected for in-memory session store).

**Client-Side Retry Strategy (Timeout and Backoff)**:

```javascript
// Configuration constants
const VALIDATION_TIMEOUT_MS = 5000;      // 5 second timeout per attempt
const VALIDATION_MAX_RETRIES = 2;        // Retry up to 2 times (3 total attempts)
const VALIDATION_RETRY_DELAY_MS = 1000;  // 1 second between retries

// Browser compatibility: AbortSignal.timeout() requires Chrome 103+, Safari 16+, Firefox 100+
// Fallback for older browsers:
function createTimeoutSignal(ms) {
  if (typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  // Manual timeout fallback for older browsers
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

async function validateSession(sessionId) {
  for (let attempt = 0; attempt <= VALIDATION_MAX_RETRIES; attempt++) {
    try {
      const validation = await fetch(`/api/chat/sessions/${sessionId}/validate`, {
        method: 'HEAD',
        signal: createTimeoutSignal(VALIDATION_TIMEOUT_MS)
      });

      if (validation.status === 404) {
        // Session expired - recreate immediately (no retry, this is expected state)
        console.log('[Chat] Session expired, recreating...');
        await recreateSession();
        return true;
      }

      if (validation.ok) {
        // Validation succeeded
        console.log('[Chat] Session validated successfully');
        return true;
      }

      // 5xx or other error - retry if attempts remaining
      console.warn(`[Chat] Validation failed with status ${validation.status}, attempt ${attempt + 1}/${VALIDATION_MAX_RETRIES + 1}`);
      if (attempt < VALIDATION_MAX_RETRIES) {
        await sleep(VALIDATION_RETRY_DELAY_MS);
        continue;
      }
    } catch (err) {
      // Network timeout or error - retry if attempts remaining
      console.warn(`[Chat] Validation error: ${err.message}, attempt ${attempt + 1}/${VALIDATION_MAX_RETRIES + 1}`);
      if (attempt < VALIDATION_MAX_RETRIES) {
        await sleep(VALIDATION_RETRY_DELAY_MS);
        continue;
      }
    }
  }

  // Max retries exceeded - show error to user
  console.error('[Chat] Session validation failed after max retries');
  showError('Unable to connect to chat service. Please refresh the page.');
  return false;
}

// Usage in SSE connection flow
async function connectSSE(sessionId) {
  // Step 1: Validate session exists (with retry logic)
  const isValid = await validateSession(sessionId);
  if (!isValid) {
    return; // Error already shown to user
  }

  // Step 2: Session valid - open EventSource
  this.eventSource = new EventSource(`/api/chat/stream?sessionId=${sessionId}`);
  // ... existing handlers
}
```

**Retry Behavior Summary**:
- **404 (session expired)**: No retry, immediate session recreation
- **5xx/network errors**: Retry up to 2 times with 1 second delay
- **Timeout (>5s)**: Retry up to 2 times with 1 second delay
- **Max retries exceeded**: Show error banner, do not open EventSource

**5) GET /api/chat/stream?sessionId=...**
- Purpose: open SSE stream for an existing session
- **Breaking change:** `sessionId` query parameter is now **required**
- Behavior:
  - If `sessionId` missing: return 400 Bad Request (not backward compatible)
  - If `sessionId` invalid/expired: return 404 (do not establish SSE stream)
  - If valid: attach to existing session, emit `session_start` event confirming attachment
  - If another SSE connection is already attached to the same session: **server closes the previous connection and clears any keepalive timers**, then attaches the new one (last writer wins)
- `session_start` event payload (unchanged structure):
  ```json
  { "type": "session_start", "sessionId": "uuid" }
  ```
  - Previously: signaled new session creation
  - Now: confirms attachment to pre-created session

**6) POST /api/chat/messages**
- Same as current but now requires session with `selectedPatientId` set
- **Patient Unavailable Flow (409 Conflict)**:

Server validation sequence (synchronous, before accepting request):
```javascript
// Step 1: Validate session exists
const session = sessionManager.getSession(sessionId);
if (!session) {
  return res.status(404).json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' });
}

// Step 2: Validate patient still exists (SYNCHRONOUS check)
const patientExists = await pool.query(
  'SELECT 1 FROM patients WHERE id = $1',
  [session.selectedPatientId]
);

if (patientExists.rows.length === 0) {
  // Step 3a: Send SSE event FIRST (while connection is still open)
  // CRITICAL: Must emit before deleteSession() which closes the connection
  streamEvent(sessionId, {
    type: 'patient_unavailable',
    sessionId: session.id,
    selectedPatientId: session.selectedPatientId,
    message: 'Selected patient is no longer available. Start a new chat.'
  });

  // Step 3b: Delete session (this also closes the SSE connection)
  sessionManager.deleteSession(sessionId);

  // Step 3c: Return 409 HTTP response (MANDATORY - source of truth)
  // NOTE: Frontend MUST handle this 409 response, not rely solely on SSE event
  res.status(409).json({
    error: 'Selected patient no longer exists',
    code: 'PATIENT_UNAVAILABLE'
  });

  return; // Do not process message
}

// Step 4: Patient valid, proceed with message processing
```

**Frontend Handling**:
```javascript
// POST /api/chat/messages response handler
const response = await fetch('/api/chat/messages', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sessionId, message })
});

if (response.status === 409) {
  const error = await response.json();
  if (error.code === 'PATIENT_UNAVAILABLE') {
    // Mandatory: Handle 409 response (SSE event may or may not arrive)
    setReadOnlyState(true);
    showBanner('Selected patient is no longer available.');
    showNewChatCTA();
    return;
  }
}

// SSE event handler (optional, may fire if SSE connected)
if (event.type === 'patient_unavailable') {
  // Same UI behavior as 409 handler (idempotent)
  setReadOnlyState(true);
  showBanner(event.message);
  showNewChatCTA();
}
```

**Key Points**:
- 409 HTTP response is **mandatory** and **synchronous** (source of truth)
- SSE `patient_unavailable` event is **optional** (best-effort, only if stream exists)
- Frontend MUST handle 409 response (cannot rely on SSE event alone)
- SSE event handler should be idempotent (safe to call multiple times)

**7) DELETE /api/chat/sessions/:sessionId**
- Purpose: destroy a session (used by re-selection and "New Chat" button)
- Response: `{ "ok": true, "message": "Session cleared" }`
- **If session not found: still return 200 OK** (DELETE is idempotent - desired state achieved)
- Rationale: Frontend calls DELETE liberally (patient switching, "New Chat", cleanup on unmount). Session may already be expired/deleted by concurrent operations or TTL cleanup. Idempotent behavior simplifies client code and avoids spurious error banners.
- Note: This endpoint already exists in current codebase (chatStream.js)
- Server closes any open SSE connection and clears keepalive timers; client should also close its EventSource before calling DELETE

**SSE Connection Registry (Detailed Specification)**:

**BREAKING CHANGE**: This refactor changes the `streamEvent` function signature and requires updating all call sites.

**Current implementation**:
- Stores `session.sseResponse = res` (non-serializable object in session state)
- `streamEvent(res, data)` signature - takes response object directly
- 25+ call sites in `chatStream.js` use `streamEvent(session.sseResponse, data)` or `streamEvent(res, data)`

**New implementation**:
- Separate `sseConnections` Map outside sessionManager
- `streamEvent(sessionId, data)` signature - takes session ID, looks up connection
- All call sites must change from `streamEvent(session.sseResponse, data)` to `streamEvent(sessionId, data)`

**Migration Requirements**:
1. Search pattern: `streamEvent(session.sseResponse,` → replace with `streamEvent(session.id,`
2. Search pattern: `streamEvent(res,` → replace with `streamEvent(sessionId,` (requires sessionId variable in scope)
3. **Critical**: Missing even one call site will cause runtime errors ("TypeError: Cannot read properties of undefined")
4. Estimated: 25+ call sites need updating across chatStream.js

```javascript
// Module-level state in server/routes/chatStream.js (NOT in sessionManager)

const sseConnections = new Map(); // sessionId → { res, keepAliveInterval, session }

// On GET /api/chat/stream?sessionId=...
function attachSSE(sessionId, res, req) {
  // 0. Validate session exists (use peekSession - SSE attach does NOT refresh TTL)
  const session = sessionManager.peekSession(sessionId);
  if (!session) {
    return res.status(404).json({
      error: 'Session not found or expired',
      code: 'SESSION_NOT_FOUND'
    });
  }

  // 1. Close previous connection if exists (last writer wins)
  const existing = sseConnections.get(sessionId);
  if (existing) {
    clearInterval(existing.keepAliveInterval);
    if (!existing.res.writableEnded) {
      existing.res.end();
    }
    console.log('[SSE] Closed previous connection for session:', sessionId);
  }

  // 2. Setup keepalive timer
  const keepAliveInterval = setInterval(() => {
    if (!res.writableEnded && !res.destroyed) {
      res.write(': keepalive\n\n');
    }
  }, 30000);

  // 3. Store connection + timer + session reference
  // Session reference stored in registry enables streamEvent to access session state
  // without passing res everywhere
  sseConnections.set(sessionId, { res, keepAliveInterval, session });

  // 4. Cleanup on natural disconnect
  req.on('close', () => {
    const conn = sseConnections.get(sessionId);
    if (conn && conn.res === res) { // Only clear if this is the current connection
      clearInterval(conn.keepAliveInterval);
      sseConnections.delete(sessionId);
      console.log('[SSE] Natural disconnect for session:', sessionId);
    }
  });
}

// On DELETE /api/chat/sessions/:sessionId
function deleteSession(sessionId) {
  // 1. Close SSE connection if exists
  const conn = sseConnections.get(sessionId);
  if (conn) {
    clearInterval(conn.keepAliveInterval);
    if (!conn.res.writableEnded) {
      conn.res.end();
    }
    sseConnections.delete(sessionId);
    console.log('[SSE] Explicit disconnect via DELETE for session:', sessionId);
  }

  // 2. Delete session from sessionManager
  sessionManager.deleteSession(sessionId);
}

// Helper: Get SSE connection for streaming events
function getSSEConnection(sessionId) {
  const conn = sseConnections.get(sessionId);
  return conn; // Returns { res, keepAliveInterval, session } or undefined
}

// Helper: streamEvent wrapper that works with registry
function streamEvent(sessionId, data) {
  const conn = getSSEConnection(sessionId);
  if (!conn) return;

  const { res, session } = conn;

  // Guard 1: Drop events with message_id if message already ended
  // Uses session reference from connection registry (stored in line 838)
  if (data.message_id && session && !session.currentMessageId) {
    logger.warn('[chatStream] Dropping event after message_end:', {
      type: data.type,
      message_id: data.message_id,
      session_id: session.id
    });
    return;
  }

  // Guard 2: Don't write to closed/destroyed response
  if (res.writableEnded || res.destroyed) {
    logger.warn('[chatStream] Dropping event - response already closed:', {
      type: data.type,
      message_id: data.message_id || null,
      session_id: session?.id || null
    });
    return;
  }

  // Write SSE event
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}
```

**Cleanup Contract**:
1. **Natural disconnect** (`req.on('close')`): Clear interval, delete from Map
2. **Explicit DELETE**: Clear interval, close response, delete from Map, delete session
3. **Reconnection** (same sessionId): Clear old interval, close old response, store new connection with updated session reference
4. **Session TTL expiry**: SessionManager cleanup triggers SSE cleanup via callback hook (see below)

**TTL Cleanup Hook (Wiring sessionManager to SSE registry)**:

Problem: `sessionManager.js` needs to close SSE connections when sessions expire, but SSE connections are stored in `chatStream.js` (separate modules, can't import each other without circular dependency).

Solution: Dependency injection pattern - pass cleanup callback to sessionManager.

```javascript
// server/utils/sessionManager.js
class SessionManager {
  constructor() {
    // ... existing fields ...
    this.onSessionExpired = null; // Cleanup callback set by chatStream.js
  }

  cleanupStale() {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [id, session] of this.sessions.entries()) {
      if (now - session.lastActivity.getTime() > this.SESSION_TTL_MS) {
        // NEW: Trigger SSE cleanup hook before deleting session
        if (this.onSessionExpired) {
          this.onSessionExpired(id);
        }

        this.sessions.delete(id);
        cleanedCount++;
      }
    }
    // ... existing logging ...
  }
}
```

```javascript
// server/routes/chatStream.js
// CRITICAL: Module initialization order matters for TTL cleanup hook

// STEP 1: Import dependencies
import express from 'express';
import sessionManager from '../utils/sessionManager.js';
import logger from '../config/logger.js';

// STEP 2: Define module-level state BEFORE defining routes
const sseConnections = new Map(); // sessionId → { res, keepAliveInterval, session }

// STEP 3: Define and export cleanup function
// This function will be imported and wired in server/app.js
export function closeSSEConnection(sessionId) {
  const conn = sseConnections.get(sessionId);
  if (conn) {
    clearInterval(conn.keepAliveInterval);
    if (!conn.res.writableEnded) {
      conn.res.end();
    }
    sseConnections.delete(sessionId);
    logger.info('[SSE] Cleanup via TTL expiry:', { session_id: sessionId });
  }
}

// STEP 4: Define routes
const router = express.Router();
router.get('/stream', ...);
// ... rest of routes
```

**Note**: The cleanup hook is NOT wired in this file. It is wired in `server/app.js` at application startup (see "Cleanup Interval Wiring" section below).

**MANDATORY: Lazy-Start Cleanup Interval**

The eager cleanup interval pattern (starting in constructor) is NOT acceptable for this implementation. SessionManager MUST defer cleanup interval start to ensure the SSE cleanup hook is wired before any cleanup runs.

**Migration from Current Implementation**:

The current `SessionManager` likely starts cleanup in the constructor:
```javascript
// CURRENT (server/utils/sessionManager.js):
class SessionManager {
  constructor() {
    this.sessions = new Map();
    this.cleanupInterval = setInterval(() => this.cleanupStale(), 60000); // REMOVE THIS LINE
  }
}
```

**Required changes**:

1. **REMOVE** the `setInterval()` call from constructor
2. **ADD** `cleanupInterval = null` initialization
3. **ADD** lazy-start `startCleanup()` method (shown below)
4. **CALL** `startCleanup()` exactly ONCE in `server/app.js` (app entrypoint, NOT in route modules)

**Why this matters**: If you add `startCleanup()` without removing the constructor interval, you'll have **DOUBLE TIMERS** running (memory leak + duplicate cleanup work).

**NEW IMPLEMENTATION**:

```javascript
// server/utils/sessionManager.js
class SessionManager {
  constructor() {
    this.sessions = new Map();
    this.onSessionExpired = null;
    this.cleanupInterval = null; // Don't start yet (lazy-start pattern)
  }

  startCleanup() {
    if (!this.cleanupInterval) {
      this.cleanupInterval = setInterval(() => this.cleanupStale(), 60000);
      logger.info('[SessionManager] Cleanup interval started');
    }
  }

  // Peek at session without updating lastActivity (for read-only operations)
  peekSession(id) {
    return this.sessions.get(id);
  }

  // Get session and update lastActivity (for user interactions)
  getSession(id) {
    const session = this.sessions.get(id);
    if (session) {
      session.lastActivity = new Date();
    }
    return session;
  }

  // ... rest of class
}

// Export singleton
const sessionManager = new SessionManager();
export default sessionManager;
```

**IMPORTANT: Cleanup Wiring Location (CANONICAL APPROACH)**

Cleanup hook and interval startup MUST be wired in `server/app.js` (app entrypoint), NOT in route modules. This ensures cleanup runs regardless of route mounting or feature flags.

**Standard mounting** (routes always loaded):
```javascript
// server/app.js
import sessionManager from './utils/sessionManager.js';
import chatRoutes, { closeSSEConnection } from './routes/chatStream.js';

// Wire SSE cleanup hook at app startup
sessionManager.onSessionExpired = closeSSEConnection;

// Start cleanup interval - guaranteed to run regardless of route mounting
sessionManager.startCleanup();

// Mount routes
app.use('/api/chat', chatRoutes);
```

**Conditional mounting** (if chat routes are behind a feature flag):
```javascript
// server/app.js
import sessionManager from './utils/sessionManager.js';

// ALWAYS start cleanup (session memory leak prevention)
sessionManager.startCleanup();

if (process.env.CHAT_ENABLED === 'true') {
  const { default: chatRoutes, closeSSEConnection } = await import('./routes/chatStream.js');
  sessionManager.onSessionExpired = closeSSEConnection;
  app.use('/api/chat', chatRoutes);
}
// Note: If chat disabled, sessions still expire but no SSE cleanup needed (no SSE connections exist)
```

3. **Test environment**: Tests that import `sessionManager` directly can:
   - Call `sessionManager.startCleanup()` explicitly if cleanup behavior needs testing
   - Skip cleanup if sessions are cleared between tests (acceptable - process exits anyway)
   - Mock `onSessionExpired` callback for isolation

**Why this matters**: If `chatStream.js` is not loaded (feature flag, conditional import, or test), `startCleanup()` is never called. Sessions accumulate in memory until server restart. Starting cleanup in `app.js` guarantees cleanup runs regardless of which routes are mounted.

### Session Creation Flow

Frontend-backend interaction sequence:

1. **Chat panel render**: Frontend calls `GET /api/reports/patients?sort=recent` to populate selector
2. **Guard: no patients**: If `patients.length === 0`, show empty state, disable chat input, **skip steps 3-6**
3. **Create session**: Frontend calls `POST /api/chat/sessions` with default (first) patient immediately after the selector is ready
4. **Server response**: Returns `sessionId` with bound patient context
5. **SSE connect**: Frontend opens `GET /api/chat/stream?sessionId=...`
   - Client must treat the `POST /api/chat/sessions` response as the source of truth for `sessionId`
   - `session_start` confirms attachment only; do not set `sessionId` from SSE
6. **Optional re-selection**: User clicks different patient chip → frontend closes existing SSE connection, calls `DELETE /api/chat/sessions/:sessionId`, then `POST /sessions` with new patient, reconnects SSE
7. **First message completed**: Session becomes immutable when `message_end` SSE event is received (chips locked, "New Chat" button appears). This guarantees the message was fully processed by the LLM, not just accepted by the HTTP endpoint.
8. **Cleanup**: On chat panel unmount or route change, frontend calls `DELETE /api/chat/sessions/:sessionId` to avoid leaked sessions. Server TTL remains as a fallback.

> **Key invariant:** `selectedPatientId` is bound at session creation. Changing selection before first message destroys and recreates the session. After first message, the session is immutable.

### Session Handshake Specification

**Breaking Change from v3.2**: Session creation moved from `GET /stream` to `POST /sessions`.

**Current behavior (v3.2)**:
1. Frontend calls `GET /api/chat/stream`
2. Backend creates session and returns `sessionId` via SSE `session_start` event
3. Frontend uses `sessionId` from SSE event

**New behavior (v4.3)**:
1. Frontend calls `POST /api/chat/sessions` with `selectedPatientId`
2. Backend creates session, returns `{sessionId, selectedPatientId}` in HTTP response
3. Frontend calls `GET /api/chat/stream?sessionId=...` to attach SSE
4. Backend validates session exists, returns 404 if not, attaches SSE if valid
5. Backend sends `session_start` SSE event (confirms attachment, NOT creation)

**`GET /api/chat/stream` Behavior (Breaking Change)**:

```javascript
// Endpoint: GET /api/chat/stream?sessionId=...
// Query parameter: sessionId (REQUIRED)

// Validation sequence:
1. Check if sessionId query param exists
   - If missing: return 400 Bad Request
     { "error": "sessionId query parameter required", "code": "MISSING_SESSION_ID" }

2. Check if session exists in sessionManager
   - If not found: return 404 Not Found
     { "error": "Session not found or expired", "code": "SESSION_NOT_FOUND" }

3. Check if session has selectedPatientId
   - If missing: return 400 Bad Request
     { "error": "Session missing patient context", "code": "INVALID_SESSION_STATE" }
   - Note: This should never happen if POST /sessions worked correctly, but defensive check

4. If another SSE connection exists for this sessionId:
   - Close previous connection (res.end())
   - Clear previous keepalive timer
   - Log: "SSE reconnection detected, closing previous stream"

5. Establish new SSE connection:
   - Set SSE headers
   - Store connection in sseConnections Map
   - Start keepalive timer
   - Send session_start event: { "type": "session_start", "sessionId": "..." }

6. Setup cleanup on disconnect:
   - On req.on('close'): clear keepalive, remove from Map
```

**Error Recovery**:
- If `GET /stream` returns 404 (session expired): Frontend should create new session via `POST /sessions` and retry
- If `GET /stream` returns 400 (missing sessionId): Frontend bug, should never happen
- If SSE disconnects naturally: Frontend should reconnect to same `sessionId` (session still valid for TTL period)

**Patient Selection Race Condition**:

Scenario: User clicks different patient chip before `POST /sessions` completes.

```javascript
// Solution: Cancel in-flight request and create new session

let sessionCreationController = new AbortController();

async function selectPatient(patientId) {
  // Cancel previous session creation if still pending
  sessionCreationController.abort();
  sessionCreationController = new AbortController();

  // Close existing SSE if connected
  if (eventSource) {
    eventSource.close();
  }

  // Delete old session if exists
  if (currentSessionId) {
    await fetch(`/api/chat/sessions/${currentSessionId}`, { method: 'DELETE' });
  }

  // Create new session
  const response = await fetch('/api/chat/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selectedPatientId: patientId }),
    signal: sessionCreationController.signal
  });

  // Handle 404: Patient was deleted between list fetch and session creation
  if (response.status === 404) {
    console.log('[Chat] Selected patient not found, refreshing patient list');
    const patients = await fetchPatients(); // Re-fetch list

    if (patients.length === 0) {
      // No patients remain - show empty state
      showEmptyState();
      return null;
    }

    // Select first available patient and retry (with recursion guard)
    const newPatientId = patients[0].id;
    renderPatientSelector(patients, newPatientId);
    return selectPatient(newPatientId); // Retry with new patient
  }

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to create session');
  }

  const { sessionId } = await response.json();
  currentSessionId = sessionId;

  // Connect SSE
  connectSSE(sessionId);
}
```

**404 Recovery Flow (Patient Deleted During Selection)**:

When `POST /api/chat/sessions` returns 404 (patient not found):
1. **Do NOT retry endlessly** with the same patient ID
2. **Re-fetch patient list** via `GET /api/reports/patients?sort=recent`
3. **If list is empty**: Show empty state UI, disable input
4. **If list has patients**: Select first patient, re-render selector, retry session creation
5. **Recursion guard**: The retry uses a different patient ID, so infinite loop is not possible (eventually list empties or succeeds)

**Aborted Request Behavior (Expected Edge Case)**:

When `AbortController.abort()` is called:
- **Client-side**: fetch() promise rejects with AbortError, response is ignored
- **Server-side**: Express continues processing, session may still be created
- **Result**: Orphaned session exists briefly (cleaned up by 1-hour TTL)

This is **expected behavior** and acceptable for MVP. The orphaned session:
- Does not leak resources (bounded by TTL)
- Does not affect correctness (session is never used)
- Will be cleaned up automatically within 1 hour

**Alternative (not recommended for MVP)**: Track aborted sessionIds and explicitly DELETE them. This adds complexity for minimal benefit - TTL cleanup is sufficient.

### Session Model Changes

**Current fields (server/utils/sessionManager.js):**
- `selectedPatientId`
- `awaitingPatientSelection`
- `patients`
- `patientCount`

**Proposed:**
- Keep `selectedPatientId` only
- Remove `awaitingPatientSelection`, `patients`, AND `patientCount` from session state
- **Security rationale**: `patientCount` must be recomputed per-message to prevent data leaks (see Implementation Decisions section)
- Frontend handles empty state (no patients) UI; backend validates patient exists during session creation

**New SessionManager method (for HEAD /validate endpoint):**
```javascript
/**
 * Peek at session without updating TTL
 * Used by validation endpoint to avoid extending session lifetime
 */
peekSession(sessionId) {
  return this.sessions.get(sessionId); // Direct access, no lastActivity update
}
```

**Existing getSession() behavior (unchanged):**
- Used by POST /messages and SSE stream handlers
- Updates `session.lastActivity` to extend TTL
- Only actual user interactions should call this method

### Prompt Changes

Update prompts to remove LLM-driven patient selection logic and force patient scope.

**Scope:** Changes apply to **chat flow only**. Legacy `/api/sql-generator` endpoint remains unchanged.

**Safe API Boundary Design**:

To prevent breaking the legacy endpoint, `buildSystemPrompt()` must support two distinct modes via explicit parameter:

```javascript
/**
 * Build system prompt with schema context and patient information
 * @param {string} schemaContext - Schema snapshot formatted as markdown
 * @param {number} maxIterations - Maximum iteration limit for agentic loop
 * @param {string} mode - 'chat' (pre-selected patient) or 'legacy' (full patient list)
 * @param {string|null} selectedPatientId - Patient ID for chat mode (required if mode='chat')
 * @returns {object} { prompt, patientCount, patients }
 */
async function buildSystemPrompt(schemaContext, maxIterations, mode = 'legacy', selectedPatientId = null) {
  if (!agenticSystemPromptTemplate) {
    throw new Error('Agentic system prompt template not loaded');
  }

  let prompt = agenticSystemPromptTemplate
    .replace(/\{\{MAX_ITERATIONS\}\}/g, maxIterations)
    .replace(/\{\{SCHEMA_CONTEXT\}\}/g, schemaContext);

  if (mode === 'chat') {
    // Chat mode: inject selected patient ID only
    if (!selectedPatientId) {
      throw new Error('selectedPatientId required for chat mode');
    }

    const patientContextSection = `

## Patient Context (Selected)

Selected Patient ID: ${selectedPatientId}

**CRITICAL**: Use ONLY this patient ID in all queries. Do NOT ask which patient to use.
All queries MUST filter by patient_id using either \`WHERE patient_id = '${selectedPatientId}'\` or \`WHERE patient_id IN ('${selectedPatientId}')\` syntax.
`;
    prompt = prompt + patientContextSection;

    // Return minimal context (patientCount/patients not needed for chat)
    return { prompt, patientCount: null, patients: [] };

  } else {
    // Legacy mode: load full patient list (original behavior)
    // NOTE: Query includes display_name to handle NULL full_name gracefully
    const patientsResult = await pool.query(`
      SELECT
        id,
        full_name,
        CASE
          WHEN full_name IS NOT NULL AND full_name != '' THEN full_name
          ELSE 'Patient (' || SUBSTRING(id::text FROM 1 FOR 6) || '...)'
        END AS display_name,
        gender,
        date_of_birth
      FROM patients
      ORDER BY full_name ASC NULLS LAST, created_at DESC
    `);

    const patientCount = patientsResult.rows.length;
    // Use display_name to ensure NULL full_name is handled properly in prompts
    const patientList = patientsResult.rows.map((p, i) =>
      `${i + 1}. ${p.display_name} (${p.gender || 'Unknown'}, DOB: ${p.date_of_birth || 'Unknown'}, ID: ${p.id})`
    ).join('\n');

    const patientContextSection = `

## Patient Context (Pre-loaded)

At the start of each conversation, you have access to:

**Patient Count:** ${patientCount}
**Patient List:**
${patientList || 'No patients in database'}

This information is pre-loaded. Do NOT query \`SELECT COUNT(*) FROM patients\` - use the pre-loaded count above.
`;
    prompt = prompt + patientContextSection;

    return { prompt, patientCount, patients: patientsResult.rows };
  }
}
```

**Caller Updates**:

- `server/routes/chatStream.js` (initializeSystemPrompt):
  ```javascript
  const { prompt, patientCount, patients } = await agenticCore.buildSystemPrompt(
    schemaContext,
    20, // maxIterations
    'chat', // mode
    session.selectedPatientId // must be set before calling
  );
  ```

- Legacy `/api/sql-generator` endpoint:
  ```javascript
  const { prompt, patientCount, patients } = await agenticCore.buildSystemPrompt(
    schemaContext,
    20, // maxIterations
    'legacy', // mode
    null // no selectedPatientId
  );
  ```

**Files NOT modified**:
- `prompts/agentic_sql_generator_system_prompt.txt` - Shared prompt template (unchanged)
- `server/services/promptBuilder.js` - Legacy single-shot SQL generator (unchanged)
- `prompts/sql_generator_system_prompt.txt` - Legacy single-shot prompt (unchanged)

### Backend Scope Enforcement

**CRITICAL SECURITY REQUIREMENT**: Patient scope enforcement must be applied at TWO levels:
1. **Final SQL validation** (POST /api/chat/messages handler) - enforces scope on query sent to user
2. **Tool-level validation** (agenticCore tool calls) - prevents cross-patient data leaks during LLM exploration

Both levels are mandatory to prevent data leaks. Tool calls that bypass scope can expose cross-patient data to the LLM, even if the final SQL is properly scoped.

**Scope Validation Design Decisions**:

1. **Exclusivity Requirement**:
   - Validator MUST check that `patient_id` predicates contain ONLY the selected patient ID, no other patient IDs
   - **Why**: Presence check alone (`patient_id IN ('selected', 'other')`) allows cross-patient leaks
   - **Implementation**: Extract `patient_id` predicates from SQL, scan for UUIDs within those predicates only, reject if any non-selected patient UUID found
   - **Scoped check**: Only UUIDs in `patient_id` predicates are validated. Other UUID columns (report_id, lab_results.id) are allowed to contain any UUID since they are entity identifiers, not access control boundaries.
   - **Current bug**: Existing `ensurePatientScope()` only checks presence, NOT exclusivity

2. **Enforcement Behavior**:
   - **Tool-level violations**: Return structured error object to LLM (code + message + hint)
   - **Final SQL violations**: Return 400 HTTP response to client
   - **NOT auto-rewrite**: Explicit rejection is safer and teaches LLM constraints
   - **NOT throw**: Return `{ valid, violation }` object for caller to handle

3. **Server-Controlled Query Classification**:
   - Query classification MUST happen server-side via `classifyQuery()` function
   - LLM-supplied `query_type` is treated as a **hint only**, never trusted
   - Server-side `classifyQuery()` **overrides** any LLM-supplied hint
   - **Why**: LLM could bypass scope checks by claiming `query_type: 'explore'` for data queries
   - Log mismatch between LLM hint and server classification for monitoring bypass attempts

4. **Contract Clarification**:
   - `ensurePatientScope()` returns `{ valid: boolean, violation?: { code, message } }`
   - **NOT a throwing function** - callers must check `scopeCheck.valid`
   - All PRD examples updated to match actual implementation

5. **Session Cleanup on 409**:
   - Delete session immediately when patient deleted (patient permanently gone)
   - No point keeping session alive for TTL duration
   - Frontend can create new session with different patient

6. **Aborted Session Creation**:
   - Orphaned sessions from AbortController are **expected behavior**
   - TTL cleanup is sufficient (1-hour max lifetime)
   - Explicit cleanup not required for MVP

#### Level 1: Final SQL Validation (POST /api/chat/messages)

**Implementation in POST /api/chat/messages**:
```javascript
// Step 1: Validate session exists
const session = sessionManager.getSession(sessionId);
if (!session) {
  return res.status(404).json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' });
}

// Step 2: Validate patient still exists
const patientExists = await pool.query(
  'SELECT 1 FROM patients WHERE id = $1',
  [session.selectedPatientId]
);
if (patientExists.rows.length === 0) {
  return res.status(409).json({
    error: 'Selected patient no longer exists',
    code: 'PATIENT_UNAVAILABLE'
  });
}

// Step 3: Recompute patient count (CRITICAL - do not cache in session)
const countResult = await pool.query('SELECT COUNT(*) as count FROM patients');
const currentPatientCount = parseInt(countResult.rows[0].count, 10);

// Step 4: Process message with agentic SQL generation
// CRITICAL: Pass currentPatientCount to enable tool-level scope enforcement
const { sql, plotMetadata } = await agenticCore.generateSQL(
  userMessage,
  session,
  currentPatientCount // NEW: Required for tool-level scope validation
);

// Step 5: Enforce patient scope before execution (final validation)
const scopeCheck = ensurePatientScope(sql, session.selectedPatientId, currentPatientCount);
if (!scopeCheck.valid) {
  // Return validation error to client
  return res.status(400).json({
    error: scopeCheck.violation.message,
    code: scopeCheck.violation.code
  });
}

// Step 6: Execute validated SQL
const results = await pool.query(sql);
```

**Key Points**:
- Patient count is **recomputed on every message** (not cached in session)
- Patient count is **passed to agenticCore.generateSQL()** to enable tool-level scope enforcement
- `ensurePatientScope()` returns `{ valid, violation }` object - **must check return value**, NOT treat as throwing
- `ensurePatientScope()` enforces **exclusivity**: query must contain ONLY selected patient ID, no others
- Enforcement behavior: **reject** with structured error (NOT auto-rewrite, NOT throw)
- If `selectedPatientId` missing in session, return 400 (should never happen after session creation validation)

#### Level 2: Tool-Level Scope Enforcement (agenticCore)

**Security Context**: The agentic SQL generation loop uses tool calls (`execute_sql`, `fuzzy_search_*`) to explore the database before generating the final query. Without scope enforcement at the tool level, these exploratory queries can leak cross-patient data to the LLM, even if the final SQL is properly scoped.

**Attack Scenario**:
1. Multi-patient database (Patient A, Patient B)
2. Session created with Patient A selected
3. LLM uses `execute_sql` tool to run: `SELECT * FROM lab_results LIMIT 10`
4. Tool executes query without patient scope, returns data from BOTH patients
5. LLM sees Patient B's data (cross-patient data leak to LLM context)
6. Final SQL is properly scoped, but LLM already has leaked data

/**
 * Tool Schema and Implementation (CURRENT vs. PROPOSED)
 *
 * NOTE: This PRD aligns with the current implementation which uses {sql, reasoning, query_type}
 * parameters and returns structured objects.
 *
 * CURRENT TOOL SCHEMA (server/services/agenticTools.js line 415-437):
 * DO NOT change without updating prompts across all PRDs.
 *
 * Parameters:
 * {
 *   sql: string,           // Required: SELECT query to execute
 *   reasoning: string,     // Required: Why this query is needed (for audit trail)
 *   query_type: string     // Required: 'explore' | 'plot' | 'table'
 * }
 *
 * CURRENT RETURN SHAPE - SUCCESS (agenticTools.js line 320-350):
 * {
 *   rows: Array<Object>,           // Query result rows
 *   row_count: number,             // Number of rows returned
 *   fields: Array<string>,         // Column names
 *   execution_time_ms: number,     // Query execution time
 *   query_type: string             // Echo of query_type parameter
 * }
 *
 * NEW RETURN SHAPE - ERROR (PRD v4.3 addition):
 * When patient scope validation fails in multi-patient mode:
 * {
 *   error: true,                   // Boolean flag to distinguish from success
 *   code: string,                  // Error code (e.g., 'MISSING_PATIENT_FILTER', 'SET_OPERATION_NOT_ALLOWED')
 *   message: string,               // Human-readable error message
 *   hint: string,                  // Suggestion for fixing the query
 *   query_rejected: string         // The SQL that was rejected
 * }
 *
 * IMPLEMENTATION LOCATION:
 * All changes go into server/services/agenticTools.js (existing file).
 * DO NOT create new tool handler in agenticCore.js.
 *
 * MIGRATION STEPS:
 *
 * 1. ADD classifyQuery() function to agenticTools.js (BEFORE executeExploratorySql):
 *
 * ```javascript
 * /**
 *  * Server-side query classification
 *  * CRITICAL: DO NOT trust LLM-supplied query_type parameter
 *  */
 * function classifyQuery(sql) {
 *   const lowerSql = sql.toLowerCase();
 *
 *   // Schema introspection: System catalogs and metadata tables
 *   const schemaPatterns = [
 *     /\binformation_schema\./,
 *     /\bpg_catalog\./,
 *     /\bpg_tables\b/,
 *     /\bpg_indexes\b/,
 *     /\bpg_views\b/,
 *   ];
 *
 *   for (const pattern of schemaPatterns) {
 *     if (pattern.test(lowerSql)) {
 *       return 'schema'; // No patient scope required
 *     }
 *   }
 *
 *   // Default: Classify as data query (requires patient scope in multi-patient mode)
 *   // Conservative approach: When in doubt, require scope
 *   return 'data';
 * }
 * ```
 *
 * 2. MODIFY executeExploratorySql() to use server-side classification:
 *
 * ```javascript
 * async function executeExploratorySql(sql, reasoning, options = {}) {
 *   // ... existing code up to validation ...
 *
 *   // NEW: Server-controlled classification
 *   const llmQueryTypeHint = options.query_type || queryType;
 *   const actualQueryType = classifyQuery(sql);
 *
 *   // Log mismatch (potential bypass attempt)
 *   if (llmQueryTypeHint !== actualQueryType) {
 *     logger.warn({
 *       llm_hint: llmQueryTypeHint,
 *       server_classification: actualQueryType,
 *       sql_preview: sql.substring(0, 100)
 *     }, '[agenticTools] Query type mismatch - using server classification');
 *   }
 *
 *   // NEW: Schema queries skip patient scope (regardless of patient count)
 *   if (actualQueryType === 'schema') {
 *     // Execute without scope - returns metadata only
 *     const result = await pool.query(validation.sqlWithLimit);
 *     return {
 *       rows: result.rows,
 *       row_count: result.rowCount,
 *       fields: result.fields?.map(f => f.name) || [],
 *       execution_time_ms: Date.now() - startTime,
 *       query_type: actualQueryType
 *     };
 *   }
 *
 *   // MODIFIED: Scope enforcement for data queries
 *   // OLD: if ((queryType === 'plot' || queryType === 'table') && options.patientCount > 1)
 *   // NEW: if (actualQueryType === 'data' && options.patientCount > 1)
 *   if (actualQueryType === 'data' && options.patientCount > 1) {
 *     const patientScope = ensurePatientScope(
 *       validation.sqlWithLimit,
 *       options.selectedPatientId,
 *       options.patientCount
 *     );
 *
 *     if (!patientScope.valid) {
 *       // CHANGED: Return error object instead of throwing
 *       return {
 *         error: true,
 *         code: patientScope.violation.code,
 *         message: patientScope.violation.message,
 *         hint: `All data queries must include: WHERE patient_id = '${options.selectedPatientId}'`,
 *         query_rejected: sql
 *       };
 *     }
 *   }
 *
 *   // ... rest of existing implementation (unchanged) ...
 * }
 * ```
 *
 * 3. UPDATE agentic loop in agenticCore.js to handle error objects:
 *
 * ```javascript
 * // In executeToolCall() function, after tool execution:
 * const result = await executeExploratorySql(params.sql, params.reasoning, {
 *   ...options,
 *   query_type: params.query_type || 'explore'
 * });
 *
 * // Check for error object (NEW)
 * if (result && typeof result === 'object' && result.error === true) {
 *   // Return error to LLM via tool result message
 *   // The agentic loop will pass this to LLM, which can retry with corrected query
 *   return {
 *     error: true,
 *     code: result.code,
 *     message: result.message,
 *     hint: result.hint,
 *     rejected_query: result.query_rejected
 *   };
 * }
 *
 * // Success - return structured object (unchanged behavior)
 * return result;
 * ```
 */

/**
 * IMPLEMENTATION NOTE: classifyQuery() function
 *
 * The classifyQuery() function is defined in the MIGRATION STEPS section above (Step 1).
 * DO NOT implement it twice. Use the version specified in the migration steps.
 */

/**
 * Ensure query only accesses the selected patient's data (exclusivity check)
 * @param {string} sql - SQL query to validate
 * @param {string} patientId - Selected patient ID (UUID)
 * @param {number} patientCount - Current patient count in database
 * @returns {{ valid: boolean, violation?: { code: string, message: string } }}
 */
function ensurePatientScope(sql, patientId, patientCount) {
  // Skip check if only one patient exists
  if (patientCount <= 1) {
    return { valid: true };
  }

  if (!patientId) {
    return {
      valid: false,
      violation: {
        code: 'PATIENT_SCOPE_REQUIRED',
        message: 'Patient must be selected when multiple patients exist'
      }
    };
  }

  const lowerSql = sql.toLowerCase();
  const lowerPatientId = patientId.toLowerCase();

  // Step 1: Reject set operations (UNION, EXCEPT, INTERSECT)
  // These can combine scoped and unscoped query branches, bypassing patient filters
  const setOperationPattern = /\b(UNION|EXCEPT|INTERSECT)\b/i;
  if (setOperationPattern.test(sql)) {
    return {
      valid: false,
      violation: {
        code: 'SET_OPERATION_NOT_ALLOWED',
        message: 'UNION, EXCEPT, and INTERSECT are not allowed in patient-scoped queries. Please use a single SELECT statement.'
      }
    };
  }

  // Step 2: Reject boolean tautologies (OR 1=1, OR TRUE, etc.)
  // These can negate WHERE filters, exposing all patient data
  const tautologyPatterns = [
    /\bOR\s+1\s*=\s*1\b/i,
    /\bOR\s+TRUE\b/i,
    /\bOR\s+'1'\s*=\s*'1'/i,
    /\bOR\s+1\s*<>\s*0\b/i,
    /\bOR\s+0\s*=\s*0\b/i,
    /\bOR\s+NOT\s+FALSE\b/i,
  ];

  for (const pattern of tautologyPatterns) {
    if (pattern.test(sql)) {
      return {
        valid: false,
        violation: {
          code: 'TAUTOLOGY_NOT_ALLOWED',
          message: 'Boolean tautologies (e.g., OR 1=1) are not allowed in patient-scoped queries.'
        }
      };
    }
  }

  // Step 3: Check for presence of patient_id filter with selected patient
  // Matches: patient_id = 'uuid', p.patient_id='uuid', patients.patient_id IN (...'uuid'...)
  // Supports optional table alias/prefix (alphanumeric + underscore)
  const presencePattern = new RegExp(
    `(?:[\\w]+\\.)?patient_id\\s*=\\s*'${lowerPatientId}'|` +
    `(?:[\\w]+\\.)?patient_id\\s+IN\\s*\\([^)]*'${lowerPatientId}'[^)]*\\)`,
    'i'
  );

  if (!presencePattern.test(lowerSql)) {
    return {
      valid: false,
      violation: {
        code: 'MISSING_PATIENT_FILTER',
        message: `Query must filter by patient_id = '${patientId}'`
      }
    };
  }

  // CRITICAL: Complete Implementation
  // Steps 1-3 above implement the core security layers.
  // Step 4 below adds exclusivity enforcement (only selected patient ID allowed).
  //
  // All four steps are required for complete protection:
  // ✅ Step 1: Set operation rejection (implemented above)
  // ✅ Step 2: Boolean tautology detection (implemented above)
  // ✅ Step 3: Presence check (implemented above)
  // 🔽 Step 4: Exclusivity check (implemented below)

  // Step 4: Exclusivity check - only scan UUIDs in patient_id predicates
  // IMPORTANT: We only check UUIDs that appear in patient_id contexts, NOT all UUIDs
  // This allows queries with report_id, lab_results.id, etc. to pass validation
  //
  // Patterns checked for exclusivity violations:
  //   patient_id = 'other-uuid' (not the selected patient)
  //   patient_id IN ('uuid1', 'other-uuid', ...) (contains non-selected patient)
  //   [table.]patient_id = 'uuid' (supports table aliases)
  //
  // Note: !=, <>, NOT IN operators are blocked by Step 3 presence check
  // (they would leak all patients except the excluded one)

  const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

  // Extract patient_id predicates and check UUIDs within them only
  // Pattern: [table.]patient_id followed by operator and value(s)
  // Supports optional table alias/prefix (alphanumeric + underscore)
  const patientIdPredicatePattern = /(?:[\w]+\.)?patient_id\s*(?:=|!=|<>|NOT\s+IN|IN)\s*(?:'[^']*'|\([^)]*\))/gi;
  const patientIdPredicates = lowerSql.match(patientIdPredicatePattern) || [];

  // Collect all UUIDs found in patient_id predicates
  const uuidsInPatientPredicates = [];
  for (const predicate of patientIdPredicates) {
    const uuidsInPredicate = predicate.match(uuidPattern) || [];
    uuidsInPatientPredicates.push(...uuidsInPredicate.map(u => u.toLowerCase()));
  }

  // Check if any UUID in patient_id predicates is NOT the selected patient
  const otherPatientUuids = uuidsInPatientPredicates.filter(uuid => uuid !== lowerPatientId);

  if (otherPatientUuids.length > 0) {
    return {
      valid: false,
      violation: {
        code: 'CROSS_PATIENT_LEAK',
        message: `Query references other patient IDs in patient_id predicates: ${[...new Set(otherPatientUuids)].join(', ')}. Only ${patientId} is allowed.`
      }
    };
  }

  return { valid: true };
}
```

**Implementation Location**: Add `ensurePatientScope()` to `server/services/sqlValidator.js` (existing file). This function is shared by:
1. Final SQL validation in `POST /api/chat/messages` handler
2. Tool-level validation in `agenticCore.js` → `execute_sql` tool handler

**Exclusivity Enforcement (CRITICAL Security Requirement)**:

The validator MUST check that:
1. ✅ Query contains the selected patient ID in a `patient_id` predicate (`patient_id = 'selected-id'`)
2. ✅ Query does NOT contain any other patient IDs in `patient_id` predicates (exclusivity)

**Why both checks are required**:
- **Presence check alone is INSUFFICIENT**: Query like `patient_id IN ('selected-id', 'other-id')` contains the selected ID but leaks cross-patient data
- **Exclusivity check required**: Scan for UUIDs in `patient_id` predicates only, reject if any patient UUID besides selected ID is found
- **Scoped to patient_id predicates**: UUIDs in other columns (report_id, lab_results.id) are NOT checked - they are entity identifiers, not access boundaries
- **Defense in depth**: Both final SQL and tool-level queries are validated with same exclusivity rules

**Example violations caught by exclusivity check**:
```sql
-- REJECTED: Contains other patient ID in IN clause (patient_id predicate)
WHERE patient_id IN ('selected-id', 'other-id')

-- REJECTED: Contains other patient ID in OR clause (patient_id predicate)
WHERE patient_id = 'selected-id' OR patient_id = 'other-id'

-- REJECTED: Contains other patient ID in subquery's patient_id predicate
WHERE patient_id = 'selected-id' AND lab_id IN (
  SELECT id FROM lab_results WHERE patient_id = 'other-id'
)

-- ACCEPTED: Only selected patient ID in patient_id predicates
WHERE patient_id = 'selected-id'

-- ACCEPTED: Other UUIDs in non-patient_id columns are allowed
WHERE patient_id = 'selected-id' AND report_id = 'some-report-uuid'

-- ACCEPTED: lab_results.id or other entity UUIDs are fine
WHERE patient_id = 'selected-id' AND id = 'some-lab-result-uuid'
```

**Why only patient_id predicates are checked**:
- Scanning ALL UUIDs in query would cause false positives for legitimate queries with `report_id`, `lab_results.id`, etc.

---

### Supported SQL Syntax for Patient Scoping (CRITICAL)

**REGEX VALIDATION LIMITATIONS**: The `ensurePatientScope()` function uses regex-based validation which has known limitations. To ensure queries pass validation, the LLM MUST generate SQL following these exact syntax rules.

**Supported patient_id patterns** (will pass validation):
```sql
✅ WHERE patient_id = 'uuid'
✅ WHERE patient_id IN ('uuid1', 'uuid2')
✅ WHERE p.patient_id = 'uuid'              -- Table alias/prefix supported
✅ WHERE patients.patient_id = 'uuid'       -- Table name prefix supported
✅ WHERE lr.patient_id IN ('uuid1', 'uuid2') -- Any alphanumeric alias supported
```

**NOT supported** (will be REJECTED by validator):
```sql
❌ WHERE patient_id != 'uuid'               -- SECURITY: Exclusion leaks all other patients
❌ WHERE patient_id <> 'uuid'               -- SECURITY: Exclusion leaks all other patients
❌ WHERE patient_id NOT IN ('uuid1', ...)   -- SECURITY: Exclusion leaks all other patients
❌ WHERE patient_id::uuid = 'uuid'          -- Type cast not supported
❌ WHERE patient_id::text = 'uuid'          -- Type cast not supported
❌ WHERE patient_id = ANY(ARRAY['uuid'])    -- ANY operator not supported
❌ WHERE patient_id = $1                    -- Parameterized queries not supported
❌ WHERE patient_id = "uuid"                -- Double quotes not supported (use single quotes)
❌ WHERE patient_id LIKE 'uuid%'            -- LIKE operator not supported
```

**LLM Prompt Contract Requirements**:

The agentic SQL prompt (`prompts/agentic_sql_generator_system_prompt.txt`) MUST include these constraints:

```
CRITICAL: Patient ID SQL Syntax Requirements

When generating queries that filter by patient_id, you MUST follow these exact syntax rules:

1. Use `patient_id` with optional table alias/prefix (p.patient_id, patients.patient_id, etc.)
2. ALWAYS use single-quoted UUID literals (no parameters, no variables)
3. NEVER use type casts (::uuid, ::text, etc.)
4. NEVER use ANY operator
5. ONLY use these operators: = or IN
6. NEVER use exclusion operators: !=, <>, NOT IN (security risk - would leak other patients)

Examples of VALID patient_id filters:
  WHERE patient_id = '123e4567-e89b-12d3-a456-426614174000'
  WHERE patient_id IN ('123e4567-...', '987f6543-...')
  WHERE p.patient_id = '123e4567-...'              ✅ table alias allowed
  WHERE patients.patient_id IN ('123e4567-...')    ✅ table name allowed

Examples of INVALID patient_id filters (will be rejected):
  WHERE patient_id != '...'            ❌ exclusion operator (security risk)
  WHERE patient_id NOT IN ('...')      ❌ exclusion operator (security risk)
  WHERE patient_id::uuid = '...'       ❌ type cast not supported
  WHERE patient_id = ANY(ARRAY['...']) ❌ ANY operator not supported

Queries that violate these rules will be rejected with one of these errors:
  - MISSING_PATIENT_FILTER: No patient_id filter found or wrong operator used
  - SET_OPERATION_NOT_ALLOWED: Query uses UNION/INTERSECT/EXCEPT
  - TAUTOLOGY_NOT_ALLOWED: Filter uses tautology like patient_id = patient_id
  - CROSS_PATIENT_LEAK: Filter references non-selected patient UUIDs
```

**Rationale for Limitations**:
- **MVP trade-off**: Regex-based validation is simple but inflexible
- **Post-MVP**: Migrate to parser-based validation (pg-query-parser) to support full SQL syntax
- **Security**: Conservative approach prevents bypasses at the cost of flexibility

**Implementation Requirement**:
- Update `prompts/agentic_sql_generator_system_prompt.txt` with the syntax constraints above
- Test that LLM generates compliant queries (no type casts, no exclusion operators)
- Document these limitations in user-facing error messages
- Only `patient_id` column determines data ownership and access scope
- Other UUID columns (report IDs, lab result IDs) are entity identifiers within the patient's data, not access control boundaries

**Exploratory Query Policy (Chat Mode)**:

| Query Type | Single-Patient Mode (`patientCount <= 1`) | Multi-Patient Mode (`patientCount > 1`) |
|------------|-------------------------------------------|------------------------------------------|
| **Schema introspection** (INFORMATION_SCHEMA, pg_catalog) | Execute without scope (no patient data) | Execute without scope (no patient data) |
| **Data queries** (SELECT from application tables) | Execute without scope (single patient) | **MUST include patient filter** or be rejected |

**Schema vs Data Classification Rules**:
- **Schema queries**: Target system catalogs (information_schema, pg_catalog), return metadata only, no patient data
- **Data queries**: Target application tables (patients, lab_results, etc.), return patient data, MUST be scoped in multi-patient mode

**Critical Implementation Notes**:
1. **Signature change**: `agenticCore.generateSQL()` now requires `patientCount` parameter (breaking change for chat mode only)
2. **Legacy endpoint unaffected**: `/api/sql-generator` continues passing `patientCount` via existing mechanism (no change)
3. **Tool context**: All tool handlers receive `toolContext` with `{selectedPatientId, patientCount, mode}`
4. **Defense in depth**: Tool-level scope + final SQL scope = two layers of protection
5. **Query classification**: Conservative approach - when in doubt, classify as 'data' and require scope

---

## Refactor and Cleanup (No Dead Code)

Remove or refactor the following:

- `extractPatientId()` and related parsing logic in `server/routes/chatStream.js`
- `session.awaitingPatientSelection` handling in `server/routes/chatStream.js`
- `session.patients` population in `server/routes/chatStream.js` and `server/services/agenticCore.js`
- Any prompt instructions that ask the user to choose a patient
- Any frontend logic that expects the assistant to ask for patient choice

---

## Schema Changes

### Column: patients.last_seen_report_at

**Status**: Column already exists in `server/db/schema.js` (line 19)

**Verification Checklist**:
1. ✅ Column exists: `last_seen_report_at TIMESTAMPTZ` already in schema
2. ⚠️ **Index required** (check if exists, add if missing):
   ```sql
   CREATE INDEX IF NOT EXISTS idx_patients_last_seen_report_at
   ON patients(last_seen_report_at DESC NULLS LAST);
   ```
3. ⚠️ **MANDATORY: Add ingestion update logic**

**Canonical Update Location**: The `last_seen_report_at` timestamp MUST be updated in a SINGLE canonical location to avoid conflicting updates with different semantics.

**Timestamp Source Decision**:
- **Use `NOW()` (ingestion time)**, NOT `recognizedAt` from OCR
- **Rationale**: `last_seen_report_at` represents "when the system last processed a report for this patient", which is the ingestion timestamp. This is simpler and more predictable than using OCR-extracted dates which may be unreliable.
- **CRITICAL**: Audit existing code for any other places that update `last_seen_report_at`. If `upsertPatient()` or any other function already updates this field (e.g., using `recognizedAt`), that update MUST be removed to avoid duplicate/conflicting updates.

**Duplicate Report Handling**:

When a user uploads a report that already exists (same checksum), the behavior is:
- **DO update `last_seen_report_at` to NOW()** even though no new row is created in `patient_reports`
- **Rationale**: The field represents "last system interaction" not "last new data added"
- **User activity**: User actively engaged with the system (even if file was duplicate)
- **UX benefit**: Keeps patient at top of recent list in chat UI (reflects user engagement)
- **Simpler logic**: Always update on ingestion, regardless of deduplication result

**Implementation approach**:
```javascript
// In server/services/reportPersistence.js, function persistLabReport() (around line 180):
async function persistLabReport({
  const checksum = computeChecksum(fileData);

  // Check for duplicate
  const existing = await pool.query(
    'SELECT id FROM patient_reports WHERE patient_id = $1 AND checksum = $2',
    [patientId, checksum]
  );

  // ALWAYS update last_seen_report_at (both duplicate and new report cases)
  await pool.query(
    'UPDATE patients SET last_seen_report_at = NOW() WHERE id = $1',
    [patientId]
  );

  if (existing.rows.length > 0) {
    return { status: 'duplicate', reportId: existing.rows[0].id };
  }

  // New report - persist it
  const report = await pool.query(
    'INSERT INTO patient_reports (...) VALUES (...) RETURNING id',
    [...]
  );

  return { status: 'created', reportId: report.rows[0].id };
}
```

**Pre-Implementation Audit Required**:
```bash
# Find all places that update last_seen_report_at
grep -rn "last_seen_report_at" server/ --include="*.js"
```

If multiple update locations are found, consolidate to the canonical persistence layer below and remove others.

**Implementation**: Update the existing `persistLabReport()` function in `server/services/reportPersistence.js` (around line 180):

```javascript
/**
 * Persist lab report and update patient's last_seen_report_at
 * Called by BOTH manual upload and Gmail ingestion paths
 *
 * IMPORTANT: This is the ONLY place that updates last_seen_report_at.
 * Do NOT update this field in upsertPatient() or any other location.
 */
async function persistLabReport(reportData, patientId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check for duplicate report by checksum
    const existingReport = await client.query(
      `SELECT id FROM patient_reports
       WHERE patient_id = $1 AND checksum = $2`,
      [patientId, reportData.checksum]
    );

    // ALWAYS update last_seen_report_at (both duplicate and new report cases)
    // Uses NOW() (ingestion time), NOT OCR-extracted recognizedAt
    await client.query(
      `UPDATE patients
       SET last_seen_report_at = NOW()
       WHERE id = $1`,
      [patientId]
    );

    if (existingReport.rows.length > 0) {
      // Duplicate found - no new data to insert
      await client.query('COMMIT');
      return {
        status: 'duplicate',
        reportId: existingReport.rows[0].id
      };
    }

    // New report - insert it
    const reportResult = await client.query(
      `INSERT INTO patient_reports (id, patient_id, file_path, checksum, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id`,
      [reportData.id, patientId, reportData.filePath, reportData.checksum]
    );

    // Insert lab results
    // ... existing lab_results insertion logic ...

    await client.query('COMMIT');
    return {
      status: 'created',
      reportId: reportResult.rows[0].id
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
```

**Coverage Verification**:
- ✅ Manual uploads: Called via `labReportProcessor.js` → `reportPersistence.persistLabReport()`
- ✅ Gmail ingestion: Called via `gmailAttachmentIngest.js` → `reportPersistence.persistLabReport()`
- Both paths MUST converge on `persistLabReport()` in `server/services/reportPersistence.js` to ensure timestamp updates

**If persistence logic is NOT currently shared** (different code paths for manual vs Gmail):
1. Refactor to create a shared `persistLabReport()` function
2. Update both ingestion paths to use the shared function
3. Add timestamp update to the shared function (single source of truth)

**One-Time Backfill** (if existing patients have NULL `last_seen_report_at`):
```sql
-- Backfill from existing reports (only for patients with NULL value)
UPDATE patients p
SET last_seen_report_at = (
  SELECT MAX(pr.created_at)
  FROM patient_reports pr
  WHERE pr.patient_id = p.id
)
WHERE last_seen_report_at IS NULL;
```

---

## Data and Sorting

- Patient list is derived from existing `patients` table and updated during lab ingestion.
  - **Requirement:** ingestion must update `patients.last_seen_report_at` when a report is successfully ingested for a patient.
  - **Timestamp source:** Use `NOW()` (ingestion time), NOT OCR-extracted `recognizedAt`. See "Schema Changes" section for rationale.
  - **Implementation:** See "Schema Changes > Column: patients.last_seen_report_at" section for canonical update location (shared persistence layer).
  - **CRITICAL:** Only ONE location should update this field. Audit for and remove any duplicate updates.
- Sort order (multi-level fallback):
  1. `last_seen_report_at` DESC (most recently scanned patient first)
  2. `full_name` ASC (alphabetical, for patients without recent reports)
  3. `created_at` DESC (newest patient first, for unnamed patients)
- SQL: `ORDER BY last_seen_report_at DESC NULLS LAST, full_name ASC NULLS LAST, created_at DESC`

---

## Error Handling

- **No patients:** disable chat input, show empty state CTA.
- **Invalid selectedPatientId:** show error banner and disable input.
- **Patient deleted mid-chat:** lock chat, show banner with CTA to start a new chat.

### Error State Matrix (Frontend)

| Scenario | Trigger | UI Response | Retry Action |
|---------|---------|-------------|--------------|
| Patient list fetch fails | `GET /api/reports/patients?sort=recent` returns 4xx/5xx | Show banner, disable input, show "Retry" button | Re-fetch patient list only |
| Session create fails | `POST /api/chat/sessions` returns 400/404 | Show banner, disable input, show "Retry" button | Re-create session with currently selected patient |
| Session validation fails (preflight) | `HEAD /api/chat/sessions/:id/validate` returns 404 | Recreate session with selected patient, then retry SSE connection | Automatic (no user retry button) |
| Stream attach fails | `GET /api/chat/stream` returns 404 (should be rare due to preflight) | Fallback error banner, show "Refresh page" CTA | Full page refresh |
| Patient unavailable | `POST /api/chat/messages` returns 409 or SSE `patient_unavailable` | Set read-only state, show "Start New Chat" CTA | Start new chat flow (steps 1-12 from "New Chat" sequence) |

**Note on Stream Attach Failures**: With the preflight validation endpoint (`HEAD /validate`), 404 errors during `GET /stream` should be extremely rare (only possible in race conditions where session expires between validation and connection). The preflight pattern enables graceful recovery without relying on EventSource error events.

### Read-Only State (Patient Unavailable)

Triggered by SSE event `type: "patient_unavailable"` from `POST /api/chat/messages`.

UI behavior:
- Disable input textarea and send button (read-only).
- Show a persistent banner in the chat area: "Selected patient is no longer available."
- Show a CTA button: "Start New Chat" (same action as "New Chat" button).
- Do not clear existing messages automatically.

---

## Analytics / Logging

- Log `selectedPatientId` on session creation (server-side only).
- Log patient removal errors with sessionId + selectedPatientId.
- Track "chat started" events with selected patient count (1 vs >1).

---

## Test Plan

### Backend
- Create session with valid patient -> success
- Create session with invalid patient -> 404
- Stream connection with missing/invalid sessionId -> error
- Post message with removed patient -> 409 and read-only state

### Frontend
- Patient chips render and preselect the first patient
- Switching patient before first message starts new chat
- Switching patient after chat started is disabled (or starts a new chat only via explicit action)
- No patients: empty state + disabled input

### Security (CRITICAL)

**Level 1: Final SQL Scope Enforcement**
- Multi-patient DB: Final SQL without patient_id filter MUST be rejected
- Single-patient DB: Final SQL without patient_id MUST be accepted (no scope needed)
- Selected patient context always included in LLM prompt

**Level 2: Tool Call Scope Enforcement**
- **Test case 1**: Multi-patient DB + data query tool call
  - LLM uses `execute_sql` with: `SELECT * FROM lab_results LIMIT 10`
  - Tool MUST reject with MISSING_PATIENT_FILTER error (no auto-injection)
  - Verify no cross-patient data returned to LLM
- **Test case 2**: Multi-patient DB + schema query tool call
  - LLM uses `execute_sql` with: `SELECT * FROM information_schema.columns WHERE table_name = 'lab_results'`
  - Tool MUST allow without scope (schema introspection)
  - Verify metadata returned (no patient data)
- **Test case 3**: Single-patient DB + data query tool call
  - LLM uses `execute_sql` with: `SELECT * FROM lab_results LIMIT 10`
  - Tool MUST allow without scope (single patient = no leak risk)
  - Verify data returned for the single patient
- **Test case 4**: Verify all agentic tools
  - Audit `fuzzy_search_parameter_names`, `fuzzy_search_analyte_names` tools
  - Confirm these tools only return metadata (no patient data)
  - Confirm no scope enforcement needed for metadata-only tools

**Data Leak Attack Scenarios (Must Prevent)**
- Scenario A: LLM crafts exploratory query to bypass final SQL scope
  - Setup: Patient A selected, Patient B exists
  - Attack: LLM runs `execute_sql("SELECT COUNT(*) FROM lab_results WHERE patient_id = '<Patient B ID>'")` during exploration
  - Expected: Tool rejects query with structured error (exclusivity violation detected)
  - Verify: LLM receives error object with `code: 'CROSS_PATIENT_LEAK'`, NOT Patient B's count
- Scenario B: LLM iterates through all patients via tool calls
  - Setup: Patient A selected, 10 other patients exist
  - Attack: LLM runs 10 exploratory queries with different patient IDs
  - Expected: All queries except Patient A's ID are rejected with structured errors
  - Verify: LLM only sees Patient A's data across all tool calls, receives errors for all others
- Scenario C: LLM crafts IN clause with multiple patients
  - Setup: Patient A selected, Patient B and C exist
  - Attack: LLM runs `execute_sql("SELECT * FROM lab_results WHERE patient_id IN ('A', 'B', 'C')")`
  - Expected: Tool rejects query (exclusivity check finds Patient B and C UUIDs in query)
  - Verify: LLM receives error with `code: 'CROSS_PATIENT_LEAK'` listing Patient B and C UUIDs

---

## Rollout Plan

1. **Backend API changes**:
   - Extend patient list endpoint (`GET /api/reports/patients`) with `?sort=recent` query parameter, add `display_name` and `last_seen_report_at` fields
   - Add session creation endpoint (`POST /api/chat/sessions`)
   - Add session validation endpoint (`HEAD /api/chat/sessions/:sessionId/validate`) for EventSource error handling
     - **CRITICAL**: Must use `sessionManager.peekSession(id)` instead of `getSession(id)` to avoid refreshing TTL
     - Add new `peekSession()` method to SessionManager (direct `sessions.get()` access, no `lastActivity` update)
   - Update `GET /api/chat/stream` to require `sessionId` parameter (breaking change)

2. **SSE registry refactor** (BREAKING CHANGE - affects 25+ call sites):
   - Extract `sseConnections` Map outside sessionManager (module-level state in chatStream.js)
   - Store `{ res, keepAliveInterval, session }` in registry (preserves res.locals.session for streamEvent guard)
   - **CRITICAL**: Change `streamEvent` signature from `streamEvent(res, data)` to `streamEvent(sessionId, data)`
   - **CRITICAL**: Update ALL 25+ call sites in chatStream.js:
     - `streamEvent(session.sseResponse, data)` → `streamEvent(session.id, data)`
     - `streamEvent(res, data)` → `streamEvent(sessionId, data)`
   - Update cleanup handlers to use registry instead of session.sseResponse
   - **Verification**: Search for `streamEvent(` to ensure no old-style calls remain (will cause runtime errors)

3. **Prompt API boundary**:
   - Add `mode` parameter to `buildSystemPrompt()` in agenticCore.js ('chat' vs 'legacy')
   - Update chatStream.js to call with `mode='chat', selectedPatientId=session.selectedPatientId`
   - Verify legacy `/api/sql-generator` continues calling with `mode='legacy', selectedPatientId=null`

4. **CRITICAL: Scope enforcement (Security)**:
   - **Update `ensurePatientScope()` in `server/services/sqlValidator.js`**:
     - Add exclusivity check: scan for UUIDs within `patient_id` predicates only, reject if any UUID besides selected ID found in patient_id contexts
     - UUIDs in other columns (report_id, lab_results.id, etc.) are NOT checked - they are entity identifiers, not access boundaries
     - Keep existing presence check: verify query contains `patient_id = 'selected-id'`
     - Return structured object: `{ valid: boolean, violation?: { code, message } }`
     - **CRITICAL**: Current implementation only checks presence, NOT exclusivity (security bug)
   - **Enforcement behavior (explicit decision)**:
     - Tool-level violations: Return structured error to LLM (NOT throw, NOT auto-rewrite)
     - Final SQL violations: Return 400 to client with violation details
     - Rationale: Explicit rejection teaches LLM constraints, safer than silent modification
   - **Level 1 - Final SQL**: Update POST /api/chat/messages:
     - Pass `currentPatientCount` to `agenticCore.generateSQL()`
     - Call `ensurePatientScope()` and check return value (NOT await as if it throws)
     - Return 400 if `scopeCheck.valid === false`
     - Delete session immediately on 409 patient unavailable (patient permanently gone)
   - **Level 2 - Tool calls**: Update `agenticCore.generateSQL()`:
     - Accept `patientCount` parameter (breaking change for chat mode)
     - Add `toolContext` with `{selectedPatientId, patientCount, mode}` to agentic loop
     - Implement `classifyQuery()` function (schema vs data queries)
     - Update `execute_sql` tool handler to enforce scope on data queries when `patientCount > 1`
     - Return structured error object to LLM when scope check fails (NOT throw)
   - **Testing**: Verify tool calls in multi-patient mode cannot access cross-patient data
   - **Verification**: Manual audit of agentic loop - ensure ALL data-returning tool calls check scope

5. **Schema changes**:
   - Add index on `patients.last_seen_report_at DESC NULLS LAST`
   - Verify or implement `last_seen_report_at` update in shared persistence layer
   - Run one-time backfill query for existing patients
   - **Verify coverage**: Confirm both manual upload AND Gmail ingestion update timestamp

6. **Frontend changes**:
   - Update chat UI: fetch patients → select patient → create session → **mandatory preflight validation** → connect SSE
   - Add **mandatory** preflight HEAD `/validate` call before opening EventSource (part of normal flow, not just error recovery)
   - Implement comprehensive "New Chat" reset (including sessionId nulling and plotCounter reset)
   - Migrate reports-browser.js to use `display_name` field (see Migration Required section)

7. **Cleanup**:
   - Remove LLM patient selection logic (extractPatientId, awaitingPatientSelection, session.patients)
   - Remove patient selection prompt instructions

8. **Validation**:
   - Test end-to-end with multi-patient data, session expiry scenarios, and patient deletion mid-chat
   - **Security testing**: Verify scope enforcement at both levels (final SQL + tool calls)
   - Test with NULL full_name patients (verify display_name fallback)

---

## Migration Notes (Breaking Changes)

**Frontend must be updated atomically with backend.** This PRD introduces breaking changes to the chat handshake and scope enforcement:

| Before (v3.2) | After (v4.3) |
|---------------|--------------|
| `GET /stream` creates session | `POST /sessions` creates session |
| `sessionId` returned via SSE event | `sessionId` returned via POST response |
| `GET /stream` works without params | `GET /stream?sessionId=...` required |
| Patient selected mid-conversation | Patient selected before first message |
| `agenticCore.generateSQL(userMessage, session)` | `agenticCore.generateSQL(userMessage, session, patientCount)` |
| Tool calls have no scope enforcement | Tool calls enforce patient scope in multi-patient mode |
| `full_name` never NULL (COALESCE) | `full_name` can be NULL, use `display_name` |

**No backward compatibility path.** The old flow (session created in SSE endpoint) will return 400 after this change. Deploy frontend and backend together.

**Breaking API Changes Summary**:
1. **Session handshake**: `POST /sessions` required before `GET /stream`
2. **agenticCore.generateSQL signature**: Third parameter `patientCount` is now required for chat mode
3. **Patient endpoint response**: `full_name` can now be NULL (breaking for consumers expecting COALESCE behavior)
4. **Tool execution**: `execute_sql` tool now enforces scope in multi-patient mode (may reject previously-allowed queries)
