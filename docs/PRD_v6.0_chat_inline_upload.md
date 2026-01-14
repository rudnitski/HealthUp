# PRD v6.0: Chat Inline Upload

## Overview

Move manual file upload capability into the chat interface, allowing users to upload lab reports without leaving the conversation. This eliminates context-switching between the Upload Reports page and Health Assistant.

## Goals

1. Enable file upload directly from chat input area
2. Display upload progress as a chat message card
3. Trigger LLM analysis automatically after upload completes
4. Maintain seamless patient context switching

## Non-Goals

- Gmail import (stays on Upload Reports page)
- State restoration after page refresh (defer to future PRD)
- Mobile camera capture (defer to future PRD)
- Clipboard paste upload (defer to future PRD)
- Shared toast component extraction (duplicate for MVP)

## User Experience

### Entry Points

**Attachment Button**
- Location: Left of chat input field (before text input)
- Icon: Paperclip (📎 emoji or SVG equivalent for consistency)
- Behavior: Single click opens OS file picker directly (no menu)
- File filtering: Only show supported types (PDF, PNG, JPEG, HEIC)

**File Limits** (same as batch upload):
- Max 20 files per upload
- Max 10MB per file
- Max 100MB aggregate size

**Drag and Drop**
- Drop zone: Entire chat content area
- Visual feedback: Semi-transparent overlay (rgba(0, 0, 0, 0.5)) with centered white text "Drop files to upload"
- Overlay disappears on drag-leave or drop
- **Browser default prevention**: Must call `e.preventDefault()` on both `dragover` and `drop` events to prevent browser from opening dropped files in a new tab
- File validation on drop: Filter to supported types (PDF, PNG, JPEG, HEIC)
- Invalid files: Show toast "Unsupported file type: [filename] (skipped)"
- Valid files proceed to upload

### Upload Card

When files are selected/dropped, an upload card appears in the chat as a user message:

**Single File - Processing:**
```
┌─────────────────────────────────────────────────┐
│ 📄 blood_test_jan2026.pdf                   [×] │
│ ███████░░░░░░░░░ Processing...                  │
└─────────────────────────────────────────────────┘
```

**Single File - Complete:**
```
┌─────────────────────────────────────────────────┐
│ 📄 blood_test_jan2026.pdf               ✓ Done  │
│ 47 parameters · Jan 10, 2026                    │
│ [View Report]                                   │
└─────────────────────────────────────────────────┘
```

**Multi-File - Processing:**
```
┌─────────────────────────────────────────────────┐
│ Uploading 3 files                           [×] │
│                                                 │
│ 📄 report_jan.pdf         ✓ 52 params          │
│ 📄 report_feb.pdf         ⏳ Processing...      │
│ 📄 report_mar.pdf         ○ Queued             │
│                                                 │
│ ████████░░░░░░░░░░ 2 of 3 complete              │
└─────────────────────────────────────────────────┘
```

**Multi-File - Complete:**
```
┌─────────────────────────────────────────────────┐
│ ✓ 3 reports uploaded                            │
│                                                 │
│ 📄 report_jan.pdf    52 params    [View Report] │
│ 📄 report_feb.pdf    47 params    [View Report] │
│ 📄 report_mar.pdf    43 params    [View Report] │
└─────────────────────────────────────────────────┘
```

**Upload Card Lifecycle:**
- Completed upload cards persist in chat history for the session (treated like user messages)
- Cards are cleared when:
  - User starts new chat session (manual clear or patient switch)
  - Page refresh (state not restored - per Out of Scope item 2)
- Cards are NOT automatically removed after a timeout
- This allows users to reference uploaded files and use [View Report] buttons throughout the conversation
- **Patient switch behavior**: When an upload triggers a patient switch, the upload card is intentionally cleared along with all other chat messages. This is correct behavior - the card represents UI state for the old session. Users can still access their uploaded reports via the Reports page.

### Progress States

Use simple labels without detailed OCR steps:
1. `Uploading...` - File transfer in progress (indeterminate spinner; Fetch API doesn't support upload progress)
2. `Processing...` - OCR/extraction running (progress bar updates from polling)
3. `✓ Done` / `✓ X params` - Complete with parameter count

**Status Mapping**: Backend status `pending` displays as "Queued" in UI.

### Error States

**OCR Failure:**
- Display: Error card shows briefly then auto-removes
- Duration: 5 seconds
- Text: "Could not extract data from [filename]"
- No retry button (auto-remove chosen for MVP simplicity)
- User can re-upload via attachment button if needed
- Retry button enhancement deferred to future iteration

**Partial Batch Failure** (multi-file upload where some succeed):
- Only failed file rows show error state and auto-remove after 5 seconds
- Successful files remain visible with [View Report] buttons
- Overall card persists showing successful files

**File Validation:**
- File picker uses `accept` attribute for supported types (note: HEIC filtering unreliable in some browsers)
- Additional JS validation after selection (accept attribute can be bypassed)
- Invalid files rejected with toast: "Invalid file type: [filename]. Supported: PDF, PNG, JPEG, HEIC"
- **HEIC fallback**: When browser doesn't filter HEIC in picker (Chrome/Firefox), user may select unsupported files. JS validation checks file extension and MIME type post-selection; unsupported files are rejected with toast before upload starts. HEIC files that pass validation are processed normally (backend supports HEIC via ImageMagick conversion).

### Cancel Behavior

- X button visible on upload card during processing
- Click immediately cancels (no confirmation dialog)
- Card removed from chat on cancel
- **Cancel suppresses LLM trigger and patient switch**: Frontend stops polling and ignores subsequent batch status updates
- Server-side job may continue and persist data to database (acceptable - data remains accessible via Reports page)
- No cleanup mechanism for cancelled jobs in MVP

### Input Blocking

During upload/processing:
- Chat input field: Disabled (greyed out)
- Send button: Disabled
- No placeholder text change (just visual disable)
- Attachment button: Disabled (prevent concurrent uploads)
- Drag-drop: Blocked (don't show overlay during upload)
- Also blocked during LLM streaming response (leverage existing `isProcessing` state in chat.js)
- Unblocks when: All files complete (success or error) AND no LLM streaming in progress

**State Model:**
- `isUploading`: New state for upload flow. Set `true` on upload start, `false` on batch complete (all jobs done).
- `isProcessing`: Existing state for LLM streaming. Unchanged behavior.
- **Input disabled when EITHER `isUploading` OR `isProcessing` is true.**
- `message_end` SSE event sets `isProcessing = false` but does NOT affect `isUploading`.
- Batch completion sets `isUploading = false` but does NOT affect `isProcessing`.

**Centralized Input State Helper (Required):**
All code paths MUST use a centralized `syncInputState()` method instead of calling `enableInput()` directly. This prevents race conditions where any code path (SSE handlers, error handlers, request failures) re-enables input while an upload is still in progress.

```javascript
syncInputState() {
  if (this.isUploading || this.isProcessing) {
    this.disableInput();
  } else {
    this.enableInput();
  }
}
```

Replace **ALL** existing `enableInput()` calls throughout `chat.js` with `this.syncInputState()`. This includes:
- SSE handlers (`session_start`, `message_end`, `plot_result`, `table_result`)
- Error handlers (`handleError()`)
- Request failure catch blocks (e.g., in `handleSendMessage()`)
- Initialization paths (e.g., `initWithExistingSession()`)

### LLM Response Trigger

After all files in batch complete (at least one success):
1. Frontend sends upload context via extended `POST /api/chat/messages` endpoint

**All-failed batch edge case**: If ALL jobs in a batch fail (zero successful files), do NOT send `uploadContext` or trigger LLM. The error cards auto-remove after 5 seconds and no LLM response is generated. This prevents sending empty/meaningless context to the LLM.
2. **Required API change**: Extend `POST /api/chat/messages` to accept optional `uploadContext` field:
   ```javascript
   {
     sessionId: string,
     message: string,  // Can be empty string when uploadContext is present
     uploadContext?: {  // Optional upload context for LLM
       filenames: string[],
       patientName: string,
       totalParameters: number,  // Sum from completed jobs only; failed jobs = 0
       reportDates: (string | null)[]  // ISO dates from test_date_normalized; null for missing dates
     }
   }
   ```
   **Ordering guarantee**: `filenames` and `reportDates` arrays use original file selection order, filtered to only include files belonging to the primary patient. Array indices correspond (filenames[i] matches reportDates[i]).
   **Null handling**: Keep `null` placeholders in `reportDates` to maintain index alignment with `filenames`. Example: if file 2 of 3 has no extracted date, `reportDates` should be `["2026-01-10", null, "2026-03-15"]`, NOT `["2026-01-10", "2026-03-15"]`.
3. **Validation change**: Allow empty `message` if `uploadContext` is present:
   ```javascript
   if (!sessionId || (!message && !uploadContext)) {
     return res.status(400).json({ error: 'sessionId and (message or uploadContext) required' });
   }
   ```
4. **Synthetic user message**: When `uploadContext` is present but `message` is empty, backend injects a synthetic user message for conversation history: `"I've uploaded lab reports: [filenames]"`. This ensures valid conversation structure for LLM.
5. **System prompt merge mechanism** (`server/routes/chatStream.js`):
   - Find existing system prompt in `session.messages` (role='system')
   - Append upload context block with delimiter: `\n\n--- UPLOAD CONTEXT ---\n`
   - Format: `User uploaded {count} file(s): {filenames}. Patient: {name}. Parameters: {count}. Dates: {dates}.`
   - Multiple uploads: Each appends a new block (accumulates up to 5 blocks; oldest removed when limit exceeded)
   - **Block parsing rules**: Each block starts with `--- UPLOAD CONTEXT ---` and ends at the next occurrence of this delimiter (or end of system prompt). When exceeding 5 blocks, find the first delimiter, then find the next delimiter, and remove everything between (inclusive of first delimiter). Use regex: `/\n\n--- UPLOAD CONTEXT ---\n[^]*?(?=\n\n--- UPLOAD CONTEXT ---|$)/` to match blocks.
   - **Onboarding content preservation**: The block deletion regex ONLY targets content between `--- UPLOAD CONTEXT ---` delimiters. Any onboarding prefix or other system prompt content that does not use this exact delimiter is preserved. The regex cannot match content that doesn't start with the upload context delimiter.
   - If no system prompt exists yet (first message), initialize it first then append
6. Context survives pruning: Part of system prompt (preserved during `pruneConversationIfNeeded()`)
7. Message format details:
   - Filenames: comma-separated (e.g., "report_jan.pdf, report_feb.pdf")
   - Dates: comma-separated ISO dates from `test_date_normalized` (e.g., "2026-01-10, 2026-02-15"); null values displayed as "unknown" in LLM prompt
   - If >5 files: truncate to "file1.pdf, file2.pdf, and 3 more"
   - reportDates source: `test_date_normalized` from OCR result; keep null placeholders for index alignment (see Null handling above)
8. First message detection: Frontend tracks locally if user has sent any messages in current session (client-side state)
   - Note: Page refresh clears this state. After refresh mid-conversation, LLM may give "first message" analysis. Acceptable for MVP.
9. LLM responds based on context:
   - First message in chat: Full analysis with insights and suggested follow-up questions (similar to onboarding)
   - Mid-conversation: LLM decides based on prior context (may acknowledge, offer comparison, or continue previous thread)

### Patient Context Handling

**Existing Patient Detected:**
- If OCR detects a patient different from currently selected
- Action: Auto-switch to detected patient
- Side effect: Start new chat session (clear conversation history)
- Notification: Toast message "Switched to Patient: [Name]"

**Patient Switch Mechanics** (for existing or new patient):
1. Unlock patient chips: `this.chipsLocked = false`
2. Delete current session: `DELETE /api/chat/sessions/:sessionId`
3. Close existing SSE connection: `this.eventSource.close()`
4. Clear UI message history: `this.messagesContainer.innerHTML = ''`
5. Create new session with new patient: `POST /api/chat/sessions` with `{ patientId }`
6. Reconnect SSE to new session
7. **Wait for `session_start` SSE event** before proceeding (prevents race condition where LLM trigger fires before SSE is ready)
8. Show toast notification
9. Trigger LLM with upload context (only after step 7 completes)

**Session Start Wait Implementation:**
Use a Promise-based pattern to wait for `session_start` before triggering LLM:
```javascript
// After connectSSE(sessionId), wait for session_start:
await this.waitForSessionStart();

// Implementation:
waitForSessionStart() {
  return new Promise((resolve) => {
    // If session already started, resolve immediately
    if (this.sessionId && this.eventSource?.readyState === EventSource.OPEN) {
      resolve();
      return;
    }
    // Otherwise, set callback for session_start handler to invoke
    this._onSessionStartResolve = resolve;
  });
}

// In handleSSEEvent, case 'session_start':
case 'session_start':
  this.sessionId = data.sessionId;
  this.syncInputState();
  // Resolve pending waitForSessionStart() Promise if any
  if (this._onSessionStartResolve) {
    this._onSessionStartResolve();
    this._onSessionStartResolve = null;
  }
  break;
```

**New Patient Detected:**
- If OCR detects a patient not in database
- Action: Auto-create patient record, switch to them (same mechanics as above)
- Side effect: Start new chat session
- Notification: Toast message "Created profile for: [Name]"

**Same Patient:**
- No context switch needed
- Conversation continues normally

**OCR Fails to Extract Patient Name:**
- Keep current patient context (no switch)
- Conversation continues with currently selected patient
- **Detection rule**: Frontend checks `patient_name` from batch status; if null or empty string, do NOT switch even if `patient_id` differs from current patient
- **Backend change required**: When uploading from chat with a selected patient context, pass `fallbackPatientId` to the batch upload endpoint. If OCR fails to extract `patient_name`, backend associates the report with `fallbackPatientId` instead of creating an anonymous patient record.
- **API change**: Extend `POST /api/analyze-labs/batch` to accept optional `fallbackPatientId` field. When present and OCR returns null `patient_name`, use this patient ID for the report (skip `upsertPatient()` call, use provided ID directly).
- **Patient name fallback rule for `uploadContext`**: When `patient_name` is null but `patient_id` is set (via `fallbackPatientId`), frontend uses the currently selected patient chip's `display_name` (already in `this.patients[]` memory) as `uploadContext.patientName`. No toast is shown since no patient switch occurred.
- This ensures uploaded reports are always queryable by the LLM in the current patient's context, even when OCR fails to extract patient information.

**Multi-Patient Batch:**
- If batch contains reports for different patients, context switches to the "primary patient"
- **Primary patient selection rule** (deterministic): Use the first file in user-selected order (original array index) that has a non-empty `patient_name`. Files with null/empty patient names are skipped for patient selection. The `patient_name` is used for selection because we need a displayable name for the toast notification.
- Since OCR jobs complete in non-deterministic order, frontend MUST wait for all jobs to complete, then iterate through jobs in original file order to find the primary patient.
- **File ordering stability**: The batch response `jobs[]` array is returned in the same order files were submitted. Frontend should map by `job_id` (not filename) to handle duplicate filenames. Store `job_id → originalIndex` mapping at batch creation time for reliable ordering.
- **All-null edge case**: If ALL files in batch have null/empty patient names, keep current patient context (no switch). Send uploadContext with current patient's name and include all uploaded files (since no patient filtering is possible).
- All reports are saved to their respective patients in the database
- **Upload context filtering rule**: Once the primary patient is identified, filter files for `uploadContext` by matching `patient_id` (NOT `patient_name`). This handles edge cases where: (1) multiple patients could share the same name, (2) `fallbackPatientId` was used and `patient_name` is null but `patient_id` is set. Files where `job.patient_id === primaryPatientId` are included; others are excluded.
- Reports for other patients are excluded from chat prompt to prevent cross-patient information leakage

**Patient Detection Responsibility:**
- Backend handles patient extraction (OCR pipeline in `labReportProcessor`)
- Patient matching: Uses exact normalized name matching (`full_name_normalized` in database)
- **Required API change**: Extend batch status response to include `patient_name`, `test_date`, `parameter_count`, and `is_new_patient` per job:
  ```javascript
  jobs: [{
    job_id, filename, status, progress, report_id,
    patient_id,
    patient_name,     // NEW: Display name for toast/system message (null if OCR failed to extract)
    test_date,        // NEW: ISO date string from test_date_normalized (null if not extracted)
    parameter_count,  // NEW: Integer count for upload card display (derived from parameters.length)
    is_new_patient    // NEW: Boolean - true if patient was created by this upload, false if existing
  }]
  ```
- `is_new_patient` is derived from `upsertPatient()` return value (INSERT vs ON CONFLICT UPDATE)
- **SQL implementation**: Modify `upsertPatient()` to use `RETURNING id, (xmax = 0) AS is_new` (PostgreSQL idiom where `xmax = 0` indicates INSERT, non-zero indicates UPDATE). Return `{ patientId, isNew }` object instead of just ID.
- Frontend uses `is_new_patient` to show correct toast: "Created profile for: [Name]" vs "Switched to Patient: [Name]"

**Toast Notification Styling:**
- Position: Top-center of viewport
- Duration: 3 seconds, auto-dismiss
- Implementation: Duplicate toast styling in `chat.css` (copy from `admin.css:219-255`)
- Note: Shared component extraction is out of scope for MVP
- Adjust position to top-center (existing admin toast uses top-right)

### View Report Action

- Button: [View Report] in completed upload card
- Behavior: Opens report in new browser tab
- Target: Main app with report view (`/?reportId={id}`)
- Multi-file: Each file row has its own [View Report] button

## Technical Implementation

### Frontend Changes

**File: `public/js/chat.js`**

1. Add attachment button to chat input area
2. Implement drag-drop handlers on chat container
3. Create upload card component with progress states
   - **DOM stability**: Use `job_id` (not filename) as the stable identifier for upload card rows (`data-job-id` attribute). This handles duplicate filenames correctly.
4. Handle file picker with type filtering
5. Implement cancel button functionality
6. Block/unblock input during upload
7. Track `batchId` from POST response for polling; clear on upload complete or cancel
8. Wait for `session_start` SSE event before triggering LLM (after patient switch)
9. Send upload context to backend (via extended `/api/chat/messages` endpoint)
10. Handle patient context switch (clear history, update pills, determine new vs existing patient)

**Validation helper reuse**: To avoid drift between Upload Reports page and chat uploads, extract common validation logic from `unified-upload.js` or import/reuse these helpers:
- `ALLOWED_EXTENSIONS` / `ALLOWED_MIME_TYPES` constants
- `validateFileType(file)` function
- `validateFileSize(file, maxBytes)` function
- `validateBatchSize(files, maxFiles, maxAggregateBytes)` function

If extraction is too invasive for MVP, duplicate the validation logic but add a `// TODO: extract to shared module` comment for future cleanup.

**File: `public/css/chat.css`** (add to existing file)

1. Attachment button styles
2. Upload card component styles
3. Drag-drop overlay styles
4. Progress bar styles
5. Disabled input state styles
6. Toast notification styles (duplicate from admin.css, adjust position to top-center)

**File: `public/index.html`** (modify existing file)

1. Add drag-drop overlay container inside `#section-assistant` (the chat section):
   ```html
   <div class="chat-drop-overlay" hidden>
     <span>Drop files to upload</span>
   </div>
   ```
2. Note: Attachment button and upload card DOM are created dynamically by `chat.js` (no HTML changes needed for those)

### Backend Changes

**Minimal API changes required:**

1. **Extend `POST /api/chat/messages`** (`server/routes/chatStream.js`):
   - Accept optional `uploadContext` field in request body
   - Update validation: `if (!sessionId || (!message && !uploadContext))` (allow empty message when uploadContext present)
   - **Signature change**: Modify `processMessage(sessionId, message)` to `processMessage(sessionId, message, uploadContext)` to pass context through
   - **Synthetic message requirement**: When `message` is empty and `uploadContext` is present, inject synthetic user message `"I've uploaded lab reports: [filenames]"` before calling `sessionManager.addMessage()`. This prevents empty user turns in conversation history.
   - When `uploadContext` present, append upload summary to system prompt (not as separate message)
   - Ensures context survives conversation pruning

2. **Extend batch status response** (`server/utils/jobManager.js`):
   - Add `patient_name`, `test_date`, `parameter_count`, and `is_new_patient` fields to job objects
   - **Field mapping**: `test_date` in response ← `job.result.test_date_normalized` (ISO string from OCR)
   - **Field mapping**: `parameter_count` ← `job.result.parameters?.length || 0`
   - **Field mapping**: `patient_name` ← `job.result.patient_name` (already in OCR result)
   - **Field mapping**: `is_new_patient` ← `job.result.is_new_patient` (requires upsertPatient change below)
   - Source from `job.result` (already contains patient data from OCR)
   - **Backward compatibility**: Keep existing `parameters` array in response for Upload Reports page; add `parameter_count` as new field for chat

   **`getBatchStatus()` implementation change** (in `jobManager.js:280-293`):
   ```javascript
   const jobsWithStatus = batch.jobs.map(({ jobId, filename }) => {
     const job = getJobStatus(jobId);
     return {
       job_id: jobId,
       filename,
       status: job?.status || 'pending',
       progress: job?.progress || 0,
       progress_message: job?.progressMessage || '',
       report_id: job?.result?.report_id || null,
       patient_id: job?.result?.patient_id || null,
       patient_name: job?.result?.patient_name || null,        // NEW
       test_date: job?.result?.test_date_normalized || null,   // NEW
       parameter_count: job?.result?.parameters?.length || 0,  // NEW
       is_new_patient: job?.result?.is_new_patient || false,   // NEW
       parameters: job?.result?.parameters || null,            // Keep for backward compat
       error: job?.error || null
     };
   });
   ```

   **`upsertPatient()` return value change** (in `reportPersistence.js:70-122`):
   - Current: `RETURNING id;` → returns just `id`
   - New: `RETURNING id, (xmax = 0) AS is_new;` → returns `{ id, is_new }`
   - PostgreSQL idiom: `xmax = 0` means INSERT (new row), non-zero means UPDATE (existing row)
   - Update function signature: `return { patientId: result.rows[0].id, isNew: result.rows[0].is_new };`
   - Update all callers to destructure: `const { patientId, isNew } = await upsertPatient(...)`
   - Pass `isNew` through to job result in `labReportProcessor.js`

3. **Extend `POST /api/analyze-labs/batch`** (`server/routes/analyzeLabReport.js`):
   - Accept optional `fallbackPatientId` as a **multipart form field** (same as files are submitted via multipart/form-data)
   - **SECURITY: Ownership validation required**: Before processing, validate that `fallbackPatientId` belongs to `req.user.id` via RLS-scoped query (`queryWithUser('SELECT id FROM patients WHERE id = $1', [fallbackPatientId], req.user.id)`). Return 403 if not found.
   - Pass to `labReportProcessor` for use when OCR fails to extract patient name
   - When `fallbackPatientId` is provided and OCR returns null `patient_name`, skip `upsertPatient()` and use provided ID directly
   - **Side effect preservation**: Still update `patients.last_seen_report_at` for the fallback patient (run `UPDATE patients SET last_seen_report_at = NOW() WHERE id = $1` after associating report)
   - This ensures chat uploads with missing patient names are associated with the currently selected patient and maintain correct chip ordering

   **`fallbackPatientId` data flow (explicit plumbing):**
   ```
   chat.js (frontend)
     ↓ multipart form field: fallbackPatientId = currentPatientId
   POST /api/analyze-labs/batch (server/routes/analyzeLabReport.js)
     ↓ SECURITY: Validate ownership first (queryWithUser)
     ↓ req.body.fallbackPatientId || null
   processLabReport({ ..., fallbackPatientId }) (server/services/labReportProcessor.js)
     ↓ pass to persistLabReport
   persistLabReport({ ..., fallbackPatientId }) (server/services/reportPersistence.js)
     ↓ conditional logic:
     IF coreResult.patient_name is null AND fallbackPatientId is provided:
       - Skip upsertPatient() call entirely
       - Use fallbackPatientId as patientId for report
       - Run: UPDATE patients SET last_seen_report_at = NOW() WHERE id = fallbackPatientId
     ELSE:
       - Normal flow: call upsertPatient() as before
   ```

**Reuse existing infrastructure:**
- `POST /api/analyze-labs/batch` - Existing batch upload endpoint (with `fallbackPatientId` extension)
- `GET /api/analyze-labs/batches/:batchId` - Existing polling endpoint (with extended response)

### Job Polling

Reuse existing pattern from `unified-upload.js`:
1. Submit files to batch endpoint
2. Poll batch status every 2 seconds
3. Update card UI based on job states
4. Trigger LLM message when all jobs complete

### Patient Detection

The existing OCR pipeline already extracts patient information. The auto-switch/auto-create logic needs to be added:

1. After batch completes, identify "primary patient" using deterministic rule (first file in order with valid patient_name)
2. Read `patient_id`, `patient_name`, and `is_new_patient` from primary patient's job in batch status
3. If `patient_name` is null/empty: keep current patient context (no switch)
4. If `patient_id` differs from currently selected patient:
   - Patient record already exists (OCR pipeline auto-creates via `upsertPatient`)
   - Switch UI to that patient using `patient_id`
5. If patient changed: clear chat session, show appropriate toast based on `is_new_patient` flag

Note: Patient matching uses exact normalized name (`full_name_normalized`), not fuzzy matching.

## Acceptance Criteria

### Upload Flow
- [ ] Attachment button appears left of chat input
- [ ] Click opens file picker filtered to PDF, PNG, JPEG, HEIC
- [ ] Selected files appear as upload card in chat
- [ ] Progress shows "Uploading..." then "Processing..."
- [ ] Completed card shows parameter count and [View Report] button
- [ ] Multi-file uploads show grouped card with per-file status

### Drag and Drop
- [ ] Dragging file over chat area shows overlay "Drop files to upload"
- [ ] Dropping files triggers upload (same as attachment button)
- [ ] Overlay disappears on drag-leave

### Input Blocking
- [ ] Input and send button disabled during upload
- [ ] Attachment button disabled during upload
- [ ] All re-enabled after completion

### Cancel
- [ ] X button visible on processing upload card
- [ ] Clicking X immediately removes card
- [ ] No confirmation dialog

### Errors
- [ ] OCR failures show error card for 5 seconds then auto-remove
- [ ] File picker uses `accept` attribute for supported types (note: HEIC filtering unreliable in some browsers)
- [ ] JS validation rejects unsupported files post-selection with toast notification

### LLM Response
- [ ] Upload context sent via extended `POST /api/chat/messages` endpoint
- [ ] Backend appends upload summary to system prompt
- [ ] LLM responds with analysis (first message) or contextual response (mid-chat)
- [ ] Upload context not visible as separate message in chat UI

### Patient Handling
- [ ] Different patient detected: auto-switch, clear chat, show toast "Switched to Patient: [Name]"
- [ ] New patient detected: auto-create, switch, show toast "Created profile for: [Name]"
- [ ] Same patient: continue conversation (no toast)
- [ ] Missing patient name (null/empty): keep current patient context (no switch)
- [ ] Multi-patient batch: switch to primary patient (first file with valid name in original order)
- [ ] LLM trigger waits for `session_start` SSE event after patient switch

### View Report
- [ ] [View Report] button opens report in new tab
- [ ] Multi-file cards have per-file view buttons

## Out of Scope

1. **Gmail Import** - Stays on Upload Reports page (complex multi-step wizard)
2. **State Restoration** - If user refreshes mid-upload, progress is lost (defer to future PRD)
3. **Mobile Camera Capture** - Standard file picker suffices for MVP
4. **Concurrent Uploads** - Must wait for current batch to complete before starting new one

## Migration Notes

- Upload Reports page remains unchanged
- Navigation item "Upload Reports" stays (Gmail import lives there)
- No database schema changes required
- No breaking changes to existing upload flow
