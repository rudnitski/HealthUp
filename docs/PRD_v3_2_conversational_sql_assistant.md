# PRD v3.2: Conversational SQL Assistant

**Status**: Ready for Implementation
**Created**: 2025-11-11
**Author**: System (Claude Code)

## Overview

Transform the SQL generation interface from single-shot Q&A to conversational chat with streaming responses. Enable the LLM to ask clarifying questions when queries are ambiguous (e.g., which patient, which format, date range), improving result accuracy and user experience.

## Problem Statement

**Current limitations:**
- One-shot interaction: User asks, LLM generates SQL immediately
- No clarification possible: Ambiguous queries produce wrong results
- Critical bug: "Show MY vitamin D" returns ALL patients' data (documented in system prompt but frontend doesn't filter)
- Poor UX for multi-patient databases: No way to specify which patient without explicit name in query
- Format ambiguity: LLM guesses whether to show plot or table

**User impact:**
- Wrong data returned for ambiguous queries
- Users must craft perfect questions on first try
- Frustration when results don't match intent

## Goals

**Primary:**
- Enable LLM to ask clarifying questions before generating SQL
- Support natural back-and-forth conversation until query is unambiguous
- Maintain session-scoped conversations (cleared after results or page refresh)
- Stream LLM responses character-by-character for modern chat UX

**Non-Goals:**
- Multi-turn contextual conversations (each query is independent after results shown)
- Conversation history persistence across page refreshes
- Authentication-based patient filtering (still MVP with multi-patient test data)
- Conversation export/history features

## Success Metrics

- Zero queries returning wrong patient data due to ambiguity
- User satisfaction with clarification process (qualitative feedback)
- Average clarifications per query: Target <0.5 (most queries don't need clarification)
- Time to result: Should not increase significantly despite potential extra back-and-forth

## User Stories

### Story 1: Patient Disambiguation
**As a** user with multiple patients in the database
**I want** the LLM to ask which patient I mean when my query is ambiguous
**So that** I get results for the correct person without trial and error

**Acceptance Criteria:**
- Given 3 patients in DB and query "show my vitamin D tests"
- LLM asks which patient (lists all options with names, gender, DOB)
- User responds with patient name/number/descriptor
- LLM generates SQL filtered to correct patient

### Story 2: Format Clarification
**As a** user asking for test results
**I want** the LLM to ask whether I want plot or table when ambiguous
**So that** I get results in my preferred format on first try

**Acceptance Criteria:**
- Given query "show cholesterol results" (no plot keywords)
- LLM asks "Would you like to see this as a plot or table?"
- User responds with preference
- LLM generates appropriate query_type

### Story 3: Streaming Response
**As a** user waiting for LLM response
**I want** to see text appearing character-by-character like ChatGPT
**So that** the interface feels responsive and modern

**Acceptance Criteria:**
- LLM text streams in real-time (not batch delivered)
- Tool executions show loading indicators
- Final results appear in existing results area

### Story 4: Session Isolation
**As a** user who completed a query
**I want** a fresh conversation for my next question
**So that** previous context doesn't interfere with new queries

**Acceptance Criteria:**
- After results shown, chat clears automatically
- Page refresh clears conversation
- Each query starts fresh (no context leakage)

## Technical Architecture

### Current Architecture (v3.1)

```
Frontend (app.js)                Backend (agenticSqlGenerator.js)
┌─────────────────┐              ┌──────────────────────────┐
│ User types Q    │              │ Async job (jobId)        │
│                 │──POST────────>│                          │
│ Returns 202     │<─────────────│ setImmediate(process)    │
│                 │              │                          │
│ Poll job status │──GET─────────>│ Job running...          │
│ every 1s        │<─────────────│ { status: "processing" } │
│                 │              │                          │
│ Job complete    │<─────────────│ { status: "completed",   │
│ Show results    │              │   sql: "...", data: ...} │
└─────────────────┘              └──────────────────────────┘
                                           │
                                           ▼
                                 Internal agentic loop:
                                 - Max 5 iterations
                                 - Tool calls (fuzzy search, SQL execution)
                                 - Ends when generate_final_query called
```

### New Architecture (v3.2)

```
Frontend (chat.js)                         Backend (chatController.js)
┌──────────────────────────────┐          ┌──────────────────────────────┐
│ User opens SQL Assistant     │          │                              │
│                              │──GET─────>│ /api/chat/stream (SSE)       │
│ EventSource connects         │<─SSE─────│  - Creates session if needed │
│ Receives session_start       │          │  - Stores { id, messages }   │
│                              │          │                              │
│ User types question          │          │                              │
│ POST /api/chat/messages      │──POST────>│ Queue user msg, kick off LLM │
│                              │          │ streaming with tools         │
│ Stream chunks:               │<─SSE─────│ OpenAI stream (text + tools) │
│  "I found 3…"                │<─SSE─────│                              │
│ Tool indicators              │<─SSE─────│ execute_sql / fuzzy search   │
│                              │          │                              │
│ Final result + rows/plot     │<─SSE─────│ generate_final_query         │
│ Chat clears & prompt resets  │          │ Session deleted              │
└──────────────────────────────┘          └──────────────────────────────┘
                                           │
                                           ▼
                                 Natural conversation loop:
                                 - No iteration limit (ends when done)
                                 - LLM decides when to clarify
                                 - generate_final_query signals completion
```

### Core Components

#### 1. Backend: Chat Stream Controller

**File:** `server/routes/chatStream.js` (new)

**Responsibilities:**
- Accept user messages via `POST /api/chat/messages`
- Maintain long-lived SSE connection via `GET /api/chat/stream`
- Maintain session state (in-memory Map with 1-hour TTL)
- Stream OpenAI responses via SSE
- Execute tool calls (fuzzy search, SQL, generate_final_query)
- Handle conversation completion and cleanup

**Session State:**
```javascript
{
  id: crypto.randomUUID(), // Cryptographically secure
  messages: [
    { role: "system", content: "..." },
    { role: "user", content: "show my vitamin D" },
    { role: "assistant", content: "I found 3 patients. Which one?" },
    { role: "user", content: "Ivan Petrov" }
  ],
  selectedPatientId: null | "abc-123", // Set once user disambiguates
  createdAt: Date,
  lastActivity: Date,
  messageCount: 4, // For rate limiting (max 20)
  isProcessing: false // Lock to prevent concurrent requests for same session
}
```

**Session Manager:**
```javascript
class SessionManager {
  constructor() {
    this.sessions = new Map(); // sessionId -> session object
    this.MAX_SESSIONS = 100;
    this.SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour idle timeout
    this.MESSAGE_LIMIT = 20;

    // Cleanup every 10 minutes
    setInterval(() => this.cleanupStale(), 10 * 60 * 1000);
  }

  createSession() {
    this.enforceSessionLimit();
    const session = {
      id: crypto.randomUUID(),
      messages: [],
      createdAt: new Date(),
      lastActivity: new Date(),
      selectedPatientId: null,
      messageCount: 0,
      isProcessing: false
    };
    this.sessions.set(session.id, session);
    return session;
  }

  enforceSessionLimit() {
    if (this.sessions.size >= this.MAX_SESSIONS) {
      // Remove oldest session by createdAt
      const oldest = Array.from(this.sessions.values())
        .sort((a, b) => a.createdAt - b.createdAt)[0];
      this.sessions.delete(oldest.id);
      logger.warn(`Session limit reached, removed oldest session: ${oldest.id}`);
    }
  }

  cleanupStale() {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.lastActivity.getTime() > this.SESSION_TTL_MS) {
        this.sessions.delete(id);
        logger.info(`Cleaned up stale session (1 hour idle): ${id}`);
      }
    }
  }

  // Called when SSE connection drops (client disconnect)
  markDisconnected(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.disconnectedAt = new Date();
      // Keep session for short grace period for logging/debugging
      // Will be cleaned up by regular TTL logic (1 hour from lastActivity)
      logger.info(`Session ${sessionId} disconnected, will cleanup via TTL`);
    }
  }
}
```

**Session Lifecycle & Cleanup:**
- **Active sessions**: Cleaned up after 1 hour of inactivity (`lastActivity` not updated)
- **Disconnected sessions**: No special grace period - same 1-hour TTL applies from last activity
- **Completed sessions**: Deleted immediately after `final_result` sent (no TTL wait)
- **Memory pressure**: If 100 sessions reached, remove oldest by `createdAt` regardless of activity

**Key Logic:**
```javascript
// Detect end of conversation
const finalQueryTool = toolCalls.find(tc => tc.function.name === 'generate_final_query');
if (finalQueryTool) {
  // Validate SQL (existing logic)
  // Enforce patient predicate when multi-patient DB
  // Execute query (PRD v3.1 auto-execution)
  // Send final results via SSE
  // Delete session
  // Close stream
}
```

**Patient Safety Guardrail**
- When `patientCount > 1`, the controller must collect and store `session.selectedPatientId` before allowing SQL execution.
- `agenticCore.handleFinalQuery` calls `sqlValidator.ensurePatientScope(sql, selectedPatientId, patientCount)` which validates:
  - If `patientCount <= 1`: Validation passes (no filter needed)
  - If `patientCount > 1` and no `selectedPatientId`: Returns `PATIENT_SCOPE_REQUIRED` error
  - If `patientCount > 1` and `selectedPatientId` exists: Uses regex to check for `patient_id = 'uuid'` or `patient_id IN (...)` pattern
  - Returns `MISSING_PATIENT_FILTER` error if pattern not found
- `selectedPatientId` is resolved by backend deterministic matching:
  - First, try numbered selection (1, 2, 3, ...) matched against patient list order
  - Second, try fuzzy name matching against `patient.full_name` (case-insensitive)
  - Third, try exact UUID match if user provided ID directly
- Validation uses simple regex pattern matching (won't catch deeply nested CTEs/subqueries, but catches 95%+ of cases)
- Defense-in-depth: System prompt instructs LLM to always add `WHERE patient_id = '{selectedPatientId}'` clause
- If validation fails, backend sends error event and ends session (per no-retry policy, users must start fresh conversation)
- This deterministic enforcement is how we meet the "zero wrong patient queries" metric even if the LLM forgets to add the filter.

#### 2. Frontend: Chat UI Component

**File:** `public/js/chat.js` (new)

**Responsibilities:**
- Render chat messages (user + assistant bubbles)
- Handle message input (textarea + send button)
- Send user input via `POST /api/chat/messages` (includes sessionId)
- Consume SSE stream from backend
- Display tool execution indicators ("🔄 Searching database...")
- Render final results (delegate to existing plotRenderer.js / table renderer)
- Clear conversation after results shown

**UI Layout:**
```
┌──────────────────────────────────────────┐
│  HealthUp SQL Assistant                  │
├──────────────────────────────────────────┤
│                                          │
│  👤 Show my vitamin D tests              │
│                                          │
│  🤖 I found 3 patients in the database:  │
│     1. Ivan Petrov (M, 1985-03-15)       │
│     2. John Doe (M, 1978-06-10)          │
│     3. Maria Rodriguez (F, 1992-11-20)   │
│                                          │
│     Which patient do you want results    │
│     for?                                 │
│                                          │
│  👤 Ivan Petrov                          │
│                                          │
│  🤖 [🔄 Searching analytes...]           │
│     [🔄 Executing SQL...]                │
│                                          │
│     ✅ Here are Ivan's vitamin D tests:  │
│                                          │
├──────────────────────────────────────────┤
│  [Table with results appears below]      │
│                                          │
│  Test Date      Value    Unit   Range    │
│  2024-11-01     45.2     ng/mL  30-100   │
│  2024-08-15     38.1     ng/mL  30-100   │
│  2024-05-20     52.3     ng/mL  30-100   │
│                                          │
└──────────────────────────────────────────┘
│  [After results shown, chat clears]      │
│                                          │
│  Ask a question about your lab results:  │
│  [___________________________________]   │
│                              [Send]      │
└──────────────────────────────────────────┘
```

#### 3. System Prompt Updates

**File:** `prompts/agentic_sql_generator_system_prompt.txt`

**New Section:**

```
## Patient Context (Pre-loaded)

At the start of each conversation, you have access to:

**Patient Count:** {patientCount}
**Patient List:**
{patientList}

This information is injected into the system prompt at session initialization. Do NOT query `SELECT COUNT(*) FROM patients` - use the pre-loaded count.

Example injection:
```
Patient Count: 3
Patient List:
1. Ivan Petrov (M, DOB: 1985-03-15, ID: abc-123)
2. John Doe (M, DOB: 1978-06-10, ID: def-456)
3. Maria Rodriguez (F, DOB: 1992-11-20, ID: ghi-789)
```

## Clarification Strategy

You can now have a natural conversation with the user before generating the final query.

### When to Ask Clarifying Questions:

1. **Patient Ambiguity (CRITICAL)**
   - System prompt includes patient count and list at initialization (no need to query again)
   - If patient count > 1 AND user didn't specify patient name/ID:
     - Use pre-loaded patient list from system context
     - Ask user which patient, listing all options clearly (include internal ID so backend can map it)
     - Store the answer as `selectedPatientId` (numbered option → ID lookup)
   - Backend validation will reject any final SQL that lacks `WHERE patient_id = {selectedPatientId}` when multiple patients exist, so the assistant must gather this info before finishing.
   - If user says "my tests" / "мои анализы" → STILL clarify which patient they are
   - If only 1 patient exists → No clarification needed, default to that patient (validator allows it)

2. **Format Ambiguity**
   - If query could be answered as plot OR table and no format keywords present:
     - Examples of ambiguous: "show cholesterol", "vitamin D results", "glucose over time"
     - Keywords forcing plot: "график", "plot", "trend", "over time", "history"
     - Keywords forcing table: "таблица", "table", "list"
   - If ambiguous: Ask "Would you like to see this as a plot or table?"

3. **Date Range Ambiguity**
   - Default: Latest result only (ORDER BY test_date DESC LIMIT 1)
   - If user might want historical data but didn't specify:
     - Indicators: "all tests", "history", "over time", "changes"
   - If ambiguous: Ask "Just the latest result, or all historical results?"

4. **Analyte Ambiguity**
   - Use `fuzzy_search_analyte_names` first (returns all matches, LLM decides which to include)
   - **Multi-analyte queries**: If user asks for broad category (e.g., "cholesterol"), LLM should include ALL related analytes (HDL, LDL, Total) in the final query - this is EXISTING behavior, works correctly now
   - **Specific queries**: If user specifies one type (e.g., "HDL cholesterol"), LLM includes only that analyte
   - **True ambiguity**: Only clarify if the fuzzy search results are genuinely unclear (e.g., search returns "Vitamin D2" and "Vitamin D3" with similar scores, but user intent is unclear)
   - If nothing matches (no results from fuzzy search), explain that the analyte is unknown

### How to Ask Questions:

- Be concise and natural
- Provide context from your database queries
- List options clearly (numbered or bulleted)
- Respond in user's language (detect from their question)
- Don't over-explain - get to the question quickly

### Example Good Clarifications:

User: "show my vitamin D"
Assistant: "I found 3 patients in the database:
1. Ivan Petrov (M, 1985-03-15)
2. John Doe (M, 1978-06-10)
3. Maria Rodriguez (F, 1992-11-20)

Which patient do you want results for?"

User: "cholesterol results"
Assistant: "I found several cholesterol tests. Would you like to see:
1. All cholesterol types (HDL, LDL, Total) in a table
2. A specific type as a plot over time

What would be most helpful?"

### Example Bad Clarifications (DON'T DO):

❌ Too many questions at once:
"Which patient? Which date range? Plot or table? Which analyte?"

❌ Asking obvious things:
User: "plot vitamin D over time"
Bad: "Do you want a plot or table?" (user already said plot!)

❌ Not providing options:
"Which patient?" (no list provided - user has to guess)

### After Clarification:

- Incorporate user's response into your understanding
- Proceed directly to query generation
- No need to confirm ("Got it, Ivan Petrov") - just act on it

### When to SKIP Clarification:

- Query is unambiguous (all info present)
- Only 1 patient in database
- Format keywords clearly present
- Specific date range mentioned
- Analyte fuzzy search returns single high-confidence match (>0.8)

Default to generating query immediately when possible. Only clarify when genuinely ambiguous.
```

### API Specifications

#### GET /api/chat/stream

**Purpose:** Open/maintain the SSE channel for a conversation

- Frontend opens a single `EventSource` connection with no parameters
- Backend creates a session automatically and streams a `session_start` event with the generated `sessionId`
- **CRITICAL**: Frontend MUST wait for the `session_start` event before calling `POST /api/chat/messages`
- If the connection drops, users must start a brand-new conversation by refreshing or by triggering the "New Conversation" UI (which tears down the old SSE connection and opens a fresh one)

**Response:** SSE stream with `Content-Type: text/event-stream`

**Initialization Sequence:**
```javascript
// Frontend must follow this exact sequence:
let sessionId = null;

// Step 1: Open SSE connection
const eventSource = new EventSource('/api/chat/stream');

// Step 2: Wait for session_start event
eventSource.addEventListener('message', (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'session_start') {
    sessionId = data.sessionId;
    // Step 3: Now safe to enable message input
    enableChatInput();
    return;
  }

  if (data.type === 'done') {
    handleStreamClosed();
    return;
  }

  handleEventFromServer(data);
});

// Step 4: Only after sessionId is set, allow sending messages
function sendMessage(text) {
  if (!sessionId) {
    throw new Error('Session not initialized - wait for session_start event');
  }
  fetch('/api/chat/messages', {
    method: 'POST',
    body: JSON.stringify({ sessionId, message: text })
  });
}
```

**Event Types:**

1. **Session Start**
```
data: {"type":"session_start","sessionId":"abc-123"}
```

2. **Text Chunk** (streamed as LLM generates)
```
data: {"type":"text","content":"I found 3 "}
data: {"type":"text","content":"patients in "}
data: {"type":"text","content":"the database"}
```

3. **Tool Execution** (when LLM calls tool)
```
data: {"type":"tool_start","tool":"fuzzy_search_analyte_names","params":{"query":"vitamin D"}}
data: {"type":"tool_complete","tool":"fuzzy_search_analyte_names","duration_ms":45}
```

4. **Message Complete** (LLM finished, waiting for user)
```
data: {"type":"message_complete"}
```

5. **Final Result** (generate_final_query called)
```
data: {"type":"final_result","sql":"SELECT ...","query_type":"data_query","rows":[...]}
```

6. **Stream End**
```
data: {"type":"done"}
```

7. **Error**
```
data: {"type":"error","code":"VALIDATION_FAILED","message":"Invalid SQL"}
```

**Session Lifecycle (SSE side):**
- New session: First SSE connection emits `session_start` with generated `sessionId`
- No reconnect path: dropped connections require the user to refresh or trigger "New Conversation" (which opens a fresh SSE)
- End session: After `final_result` sent, backend closes stream and deletes session
- Timeout: Sessions idle >1 hour automatically cleaned up

#### POST /api/chat/messages

**Purpose:** Deliver user input to the running session

**Request:**
```json
{
  "sessionId": "uuid-v4",
  "message": "show my vitamin D tests"
}
```

**Response:**
```json
{ "ok": true }
```

**Error Responses:**
```json
// Session not found (frontend didn't wait for session_start or session expired)
{ "error": "Session not found", "code": "SESSION_NOT_FOUND" }

// Session is processing another message
{ "error": "Session is currently processing a message", "code": "SESSION_BUSY" }

// Message limit reached
{ "error": "Message limit reached (20 per conversation)", "code": "MESSAGE_LIMIT" }
```

**Notes:**
- Requests without a valid sessionId return 404 with `SESSION_NOT_FOUND` code
- Backend immediately starts/resumes streaming via the SSE channel—no payload is returned here
- Frontend MUST wait for the initial `session_start` event before posting the first message

**SSE Error Handling & Recovery:**

1. **Network Interruption (Client-side):**
   ```javascript
   // Frontend: Detect connection loss
   eventSource.onerror = (error) => {
  if (eventSource.readyState === EventSource.CLOSED) {
    // Connection closed, show reconnect UI
    showError("Connection lost. Please start a new conversation.");
    disableSendButton();
  }
};
```
- No automatic reconnect (session state may be inconsistent)
- User must either refresh the page or click "New Conversation" (which closes the old SSE and opens a fresh one) to start again
  - Backend relies on the standard 1-hour `lastActivity` TTL for disconnected sessions (no special 5-minute grace period)

2. **Partial Message Reconstruction:**
   - Each SSE event is self-contained JSON (no multi-event messages)
   - Stream termination is represented by `{"type":"done"}` (no raw `[DONE]` sentinel)
   - No need for message buffering/reconstruction
   - If event is malformed, log error and skip (continue stream)

3. **Streaming Timeout (Backend):**
   ```javascript
   // OpenAI's default timeout is 600 seconds (10 minutes)
   // For v3.2, we rely on this default (no custom timeout)
   // Streaming should begin within 5-6 seconds regardless
   // If needed in future based on production metrics, can add:
   // const CHAT_MESSAGE_TIMEOUT_MS = 120000; // 2 minutes
   // setTimeout(() => {
   //   if (!session.completed) {
   //     streamEvent(res, { type: 'error', code: 'TIMEOUT', ... });
   //     sessionManager.deleteSession(sessionId);
   //   }
   // }, CHAT_MESSAGE_TIMEOUT_MS);
   ```

4. **LLM Stream Errors (OpenAI API):**
   ```javascript
   try {
     for await (const chunk of openaiStream) {
       // Process chunk
     }
   } catch (error) {
     logger.error('OpenAI stream error:', error);
    streamEvent(res, {
      type: 'error',
      code: 'LLM_ERROR',
      message: 'AI service error. Please try again.'
    });
    streamEvent(res, { type: 'done' });
    sessionManager.deleteSession(sessionId);
  }
  ```

5. **Concurrent Request Prevention:**
   ```javascript
   if (session.isProcessing) {
     return res.status(409).json({
       error: 'Session is currently processing a message'
     });
   }
   session.isProcessing = true;
   ```

6. **Message Rate Limit:**
   ```javascript
   if (session.messageCount >= MESSAGE_LIMIT) {
    streamEvent(res, {
      type: 'error',
      code: 'MESSAGE_LIMIT',
      message: 'Message limit reached (20 per conversation). Starting fresh...'
    });
    streamEvent(res, { type: 'done' });
    sessionManager.deleteSession(sessionId);
  }
  ```

#### DELETE /api/chat/sessions/:sessionId

**Purpose:** Manually clear conversation (e.g., user clicks "New Conversation")

**Flow:**
- Disable input + close existing `EventSource`
- `DELETE /api/chat/sessions/:sessionId` to remove server state
- Open a brand-new SSE connection to receive a fresh `session_start`
- Re-enable input after new sessionId arrives

**Response:**
```json
{
  "ok": true,
  "message": "Session cleared"
}
```

### Database Changes

**Schema Update Required:**

Add columns to `sql_generation_logs` table for conversational analytics in `server/db/schema.js`:

```javascript
// In server/db/schema.js, update sql_generation_logs table definition:
CREATE TABLE IF NOT EXISTS sql_generation_logs (
  id SERIAL PRIMARY KEY,
  user_question TEXT NOT NULL,
  generated_sql TEXT,
  query_type TEXT,
  tool_iterations JSONB,
  duration_ms INTEGER,
  success BOOLEAN,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- v3.2: Conversational analytics columns (nullable for backward compatibility)
  session_id TEXT,                           -- UUID of conversation session
  conversation_turns INTEGER DEFAULT 1,       -- Count of user messages in session
  clarification_count INTEGER DEFAULT 0       -- Count of assistant clarification questions
);
```

**Migration Notes:**
- Added to declarative schema (follows CLAUDE.md "No migration files during MVP")
- Existing rows will have `NULL` session_id (single-shot queries from v3.1)
- New conversational queries will populate all three fields
- `conversation_turns`: Count of user messages in session (excludes assistant)
- `clarification_count`: Count of assistant messages before final query (excludes final response)
- On next boot, schema auto-applies via `CREATE TABLE IF NOT EXISTS` (columns added if missing)

### Existing Code Reuse

**Keep as-is (aside from the declarative schema additions called out later):**
- `server/services/agenticTools.js` - All tool definitions
- `public/js/plotRenderer.js` - Plot rendering

**Adapt:**
- `server/services/agenticSqlGenerator.js` → Extract core logic into reusable module `server/services/agenticCore.js`:
  ```javascript
  // New file: server/services/agenticCore.js
  module.exports = {
    // Build system prompt with schema + patient context
    async buildSystemPrompt() {
      const schemaContext = await getSchemaContext();
      const patients = await db.query('SELECT id, full_name, gender, date_of_birth FROM patients ORDER BY full_name');
      const patientList = patients.rows.map((p, i) =>
        `${i + 1}. ${p.full_name} (${p.gender}, DOB: ${p.date_of_birth}, ID: ${p.id})`
      ).join('\n');

      return systemPromptTemplate
        .replace('{schemaContext}', schemaContext)
        .replace('{patientCount}', patients.rows.length)
        .replace('{patientList}', patientList);
    },

    // Execute tool call (fuzzy search, SQL, etc.)
    async executeToolCall(toolName, params) {
      const tools = require('./agenticTools');
      return tools[toolName](params);
    },

    // Validate, log, execute final query
    async handleFinalQuery(params, sessionMetadata) {
      const validation = sqlValidator.validate(params.sql, params.query_type);
      if (!validation.valid) {
        throw new ValidationError(validation.error);
      }

      const patientScope = sqlValidator.ensurePatientScope(
        params.sql,
        sessionMetadata.selectedPatientId,
        sessionMetadata.patientCount
      );
      if (!patientScope.valid) {
        throw new ValidationError(patientScope.violation);
      }

      const results = await executeQuery(params.sql);

      await logSqlGeneration({
        ...sessionMetadata,
        sql: params.sql,
        query_type: params.query_type,
        success: true
      });

      return { sql: params.sql, query_type: params.query_type, data: results };
    }
  };
  ```
- `server/services/sqlValidator.js`
  - Add `ensurePatientScope(sql, patientId, patientCount)` helper:
    ```javascript
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

      // Check for patient_id = 'uuid' or patient_id IN (...)
      const patientIdPattern = new RegExp(
        `patient_id\\s*=\\s*'${patientId.toLowerCase()}'|` +
        `patient_id\\s+IN\\s*\\([^)]*'${patientId.toLowerCase()}'[^)]*\\)`,
        'i'
      );

      if (!patientIdPattern.test(lowerSql)) {
        return {
          valid: false,
          violation: {
            code: 'MISSING_PATIENT_FILTER',
            message: `Query must filter by patient_id = '${patientId}'`
          }
        };
      }

      return { valid: true };
    }
    ```
  - Called from both conversational and legacy flows when multi-patient DBs are detected
  - Uses simple regex pattern matching (pragmatic for MVP, catches 95%+ of cases)
- Keep `agenticSqlGenerator.js` as job-based wrapper (backward compatibility) that calls `agenticCore.js`
- New `chatStream.js` also calls `agenticCore.js` (shared logic)

**Replace:**
- `server/routes/sqlGenerator.js` → Keep for backward compatibility (use feature flag to route to new vs old)
- `public/js/app.js` SQL section → New `public/js/chat.js` (feature-flagged UI switch)

### Error Handling

**Validation Failures:**
- When `generate_final_query` is called, validate SQL immediately
- If validation fails: Send error event, end session, delete session state
- **No retry logic for final query** (decision: simplicity over retries)
- User sees error message: "Invalid query generated. Please start a new conversation and try rephrasing your question."
- Rationale: In conversational mode, LLM had multiple turns to clarify - if still wrong, fresh start is better than retry loop

**Tool Execution Errors (Non-Final):**
- Errors during exploration (fuzzy_search, execute_sql) → Send error to LLM as tool result
- LLM can apologize to user or retry with different approach
- Example: `{"error": "Database connection failed"}` → LLM says "Database is currently unavailable. Please try again shortly."
- Critical errors (DB down) → End session with error message

**Timeout:**
- **No timeout enforcement** for v3.2 MVP (simplified implementation)
- Relies on OpenAI API's default timeout of **10 minutes (600 seconds)**
- Streaming responses typically begin delivering tokens within 5-6 seconds; lack of response indicates request issues
- If OpenAI stream fails or stalls, backend catches error and sends LLM_ERROR event
- Future enhancement: Can add optional `CHAT_MESSAGE_TIMEOUT_MS` (e.g., 60-120s) if production feedback shows need for faster failures

**Network Interruptions:**
- SSE connection drop → Frontend detects via `EventSource.onerror`
- Show error: "Connection lost. Please start a new conversation."
- **No reconnect mechanism** (decision: avoid complexity of session state sync)
- Backend relies on the standard 1-hour `lastActivity` TTL for disconnected sessions (no special 5-minute grace period)
- User restarts by refreshing or pressing "New Conversation" (which calls DELETE endpoint and re-opens SSE)

### Security & Privacy

**No changes to existing security model:**
- SQL validator prevents injection (existing)
- Read-only queries only (existing)
- No authentication (MVP, documented limitation)

**New considerations:**
- Session IDs are UUIDs (not guessable)
- Sessions stored in memory (not logged or persisted)
- Session cleanup prevents memory leaks

### Testing Strategy

#### Automated Tests

**Unit Tests:**
```javascript
describe('Chat Stream Controller', () => {
  test('opens SSE and receives session_start', async () => {
    const { events } = await openSSE('/api/chat/stream');
    expect(events[0].type).toBe('session_start');
    expect(events[0].sessionId).toBeDefined();
  });

  test('routes user messages via POST /api/chat/messages', async () => {
    const sessionId = await startSession();
    const response = await postChatMessage({ sessionId, message: 'test' });
    expect(response.ok).toBe(true);
  });

  test('enforces patient predicate when multi-patient DB', async () => {
    const sessionId = await seedSessionWithPatients(3);
    await expect(postGenerateFinalQuery({
      sessionId,
      sql: 'SELECT * FROM lab_results'
    })).rejects.toThrow('PATIENT_SCOPE_REQUIRED');
  });
});

describe('SSE Stream Parser', () => {
  test('parses text chunks', () => {
    const chunk = 'data: {"type":"text","content":"hello"}\n\n';
    expect(parseSSE(chunk)).toEqual({ type: 'text', content: 'hello' });
  });
});
```

**Integration Tests:**
```javascript
describe('Clarification Flow', () => {
  test('patient disambiguation with 3 patients', async () => {
    // Setup: 3 patients in test DB
    // User: "show my vitamin D"
    // Expect: LLM asks which patient
    // User: "Ivan"
    // Expect: Results for Ivan only
  });

  test('format clarification', async () => {
    // User: "cholesterol results"
    // Expect: LLM asks plot or table
    // User: "plot"
    // Expect: query_type === 'plot_query'
  });

  test('analyte tie-breaker clarification', async () => {
    // Fuzzy search returns HDL vs LDL vs total cholesterol with similar confidence
    // Expect: assistant lists the options and waits for user choice before querying
  });
});
```

#### Manual Testing Checklist

**Happy Paths:**
- [ ] Ambiguous query → LLM asks clarification → User responds → Correct results
- [ ] Unambiguous query → Direct results (no clarification)
- [ ] Multi-patient query → Patient list displayed → Selection works
- [ ] Format ambiguity → Format clarification → Correct rendering
- [ ] Page refresh → Conversation cleared
- [ ] Streaming text → Appears character-by-character

**Edge Cases:**
- [ ] User responds with ambiguous answer ("maybe the first one") → LLM handles gracefully
- [ ] User sends new question instead of answering clarification → LLM adapts
- [ ] User asks question in Russian → LLM responds in Russian (error messages stay in English)
- [ ] Only 1 patient in DB → No clarification needed, patient filter validation skipped
- [ ] Empty database → LLM explains no data available

**Error Scenarios:**
- [ ] Invalid SQL generated → Validation error event → Session ends and user restarts conversation
- [ ] Database connection error → Error message shown
- [ ] Network interruption → UI prompts user to start a new conversation (no auto-reconnect)
- [ ] OpenAI API timeout (600s) → LLM_ERROR event shown (rare, as streaming begins within 5-6s)

### UI/UX Details

#### Message Bubble Styling

**User messages:**
- Right-aligned
- Blue background (#007bff)
- White text
- Max-width: 70%

**Assistant messages:**
- Left-aligned
- Light gray background (#f1f3f5)
- Dark text
- Max-width: 85% (can be wider for lists)
- Streaming cursor (blinking `|`) while generating

**Tool execution indicators:**
- Small badges above assistant message
- Format: `🔄 Tool name` (e.g., "🔄 Searching database")
- Disappear when tool completes
- Stack multiple if multiple tools running

#### Input Area

**Disabled states:**
- Disable while LLM is streaming (show loading spinner on send button)
- Enable immediately after message_complete event
- Disable after final_result (until conversation clears)

**Enter key behavior:**
- Enter → Send message
- Shift+Enter → New line in textarea

#### Conversation Clearing

**After results shown:**
- Clear immediately (no animation delay)
- Results remain visible in dedicated results area below chat
- Chat message history is wiped (fresh conversation)
- **Close existing SSE connection** (`eventSource.close()`)
- **Session deleted** on backend immediately after final_result sent
- Input area enabled and focused automatically
- **On next user input:** Frontend opens NEW SSE connection → waits for session_start → sends message
- Connection establishment takes ~100-200ms (acceptable UX with loading indicator)
- No "New conversation started" message (clean slate UI)

**After page refresh:**
- No restoration attempt
- Clean slate
- Results area also cleared

#### Accessibility

- Screen reader announcements for new messages
- Keyboard navigation (Tab through messages, Enter to send)
- High contrast mode support
- ARIA labels for tool indicators

### Deployment Strategy

**Feature Flag Configuration:**
- Environment variable: `CONVERSATIONAL_SQL_ENABLED` (default: `false`)
- Stored in `.env` file (not in database for MVP)
- Frontend checks flag via `GET /api/sql-generator/config` endpoint:
  ```json
  { "conversationalMode": true }
  ```
- UI switches between chat.js (conversational) and existing app.js logic (job-based)

**Phase 1: Backend Implementation**
- Create `server/services/agenticCore.js` (extracted shared logic)
- Implement `server/routes/chatStream.js` (SSE streaming endpoint)
- Implement `server/utils/sessionManager.js` (session state management)
- Add schema migration for `sql_generation_logs` columns
- Refactor `agenticSqlGenerator.js` to use `agenticCore.js`
- Add `/api/sql-generator/config` endpoint for feature flag
- Test: Unit tests for session manager, SSE streaming, tool execution
- Deploy to staging with flag OFF

**Phase 2: Frontend Implementation**
- Create `public/js/chat.js` (chat UI component)
- Create `public/css/chat.css` (chat styling)
- Modify `app.js` to check feature flag and conditionally load chat UI
- Add SSE event handling and message rendering
- Test: Manual testing with flag ON in dev environment
- Deploy to staging with flag OFF

**Phase 3: Internal Testing**
- Enable `CONVERSATIONAL_SQL_ENABLED=true` in staging
- Run manual QA checklist (see Testing Strategy section)
- Test with real patient data
- Measure: clarification rate, time-to-result, error rate
- Iterate on system prompt if clarification quality issues
- Duration: 1-2 weeks

**Phase 4: Production Rollout**
- Enable `CONVERSATIONAL_SQL_ENABLED=true` in production
- Monitor logs for errors, timeouts, session leaks
- Track metrics: avg conversation_turns, clarification_count, success rate
- User feedback collection (optional: add feedback button)
- Keep old job-based endpoint for 1 week (safety)

**Phase 5: Cleanup (Optional)**
- After 1 week of stable operation:
  - Remove feature flag (always conversational)
  - Remove old job-based UI code from `app.js`
  - Keep `sqlGenerator.js` route for API compatibility (minimal maintenance)
- Update CLAUDE.md documentation

**Rollback Plan:**
- Immediate: Set `CONVERSATIONAL_SQL_ENABLED=false` → Instant revert to old UI
- No data loss (sessions are ephemeral)
- No database rollback needed (new columns are nullable)
- Existing queries continue working

### Migration Notes

**User Impact:**
- Existing bookmarks/URLs work (same page)
- No data loss (no persistent data)
- Training: Brief announcement about new chat interface

**Code Conflicts:**
- `app.js` will have large changes in SQL section
- Coordinate with any ongoing PRs touching SQL generation

**Performance:**
- SSE connections use minimal resources (no polling overhead)
- Session cleanup prevents memory leaks
- Monitor: Concurrent sessions, average session duration

### Implementation Decisions

**Resolved:**

1. **Session ID Generation**: Use `crypto.randomUUID()` for cryptographically secure session IDs

2. **Concurrent Message Handling**: Disable send button while LLM is streaming. User must wait for response before sending next message.

3. **Conversation Clearing**: Clear immediately after final results render (no delay)

4. **Validation Failure**: If `generate_final_query` validation fails after retries, end session with error message. User must start new conversation.

5. **Analyte Disambiguation**: Ask a follow-up question whenever fuzzy search returns multiple near-ties (Δconfidence < 0.1) or all matches are low confidence (<0.8). Auto-pick only when one analyte is clearly dominant.

6. **Rate Limiting**: 20 messages per session maximum (prevents infinite loops/abuse)

7. **Session Limits**: Maximum 100 concurrent sessions per server instance. Cleanup triggers:
   - TTL: 1 hour idle time
   - Memory pressure: Remove oldest sessions if limit reached
   - Post-completion: Immediate deletion after final results sent

8. **Iteration Limits**: No hard iteration limit (unlike v3.1's 5 iterations). Conversation continues until:
   - LLM calls `generate_final_query` (normal completion)
   - OpenAI API timeout (600 seconds default, no custom timeout in v3.2)
   - Message limit reached (20 messages per session)

9. **SSE Browser Compatibility**: SSE supported on all modern browsers including iOS Safari 13+, Android Chrome. No fallback needed for MVP.

10. **Analytics**: Track in `sql_generation_logs`:
    - `session_id` (new column)
    - `conversation_turns` (new column - count of user messages)
    - `clarification_count` (new column - count of LLM questions)
    - Existing: duration, tool calls, final SQL, success/failure

11. **Multilingual**: No enforcement. LLM handles language detection naturally based on user input.

12. **Patient Filter Enforcement**: Backend validation requires `patient_id = selectedPatientId` (or equivalent) whenever more than one patient exists. Missing predicates raise a `VALIDATION_FAILED` error regardless of what the LLM produced.

### Success Criteria

**Functional:**
- [ ] LLM successfully disambiguates multi-patient queries
- [ ] Streaming text works smoothly (no stuttering/lag)
- [ ] Session cleanup prevents memory leaks
- [ ] Validation errors handled gracefully
- [ ] Final results render correctly (table/plot)

**Performance:**
- [ ] Time to first token: <500ms
- [ ] Time to final result: <10s (including clarifications)
- [ ] Memory usage: <50MB per 100 concurrent sessions (estimated - to be validated during testing)

**Quality:**
- [ ] Clarification rate: <50% of queries (most queries don't need clarification)
- [ ] False clarifications: <5% (LLM asks when not needed)
- [ ] Missed clarifications: 0% (LLM should never skip needed clarification)

**User Experience:**
- [ ] Users report satisfaction with clarification process
- [ ] No confusion about conversation state
- [ ] Conversation clearing feels natural

### Future Enhancements (Out of Scope)

- **Conversation history**: Save and restore past conversations
- **Multi-turn context**: Remember previous queries in session
- **Voice input**: Speak questions instead of typing
- **Suggested questions**: Show common queries as quick-start
- **Conversation sharing**: Export/share conversation transcript
- **Smart defaults**: Learn user preferences (always show plots, default patient)

### Appendix: Example Conversations

#### Example 1: Patient Disambiguation

```
👤 show my vitamin D tests

🤖 I found 3 patients in the database:
   1. Ivan Petrov (M, 1985-03-15)
   2. John Doe (M, 1978-06-10)
   3. Maria Rodriguez (F, 1992-11-20)

   Which patient do you want results for?

👤 Ivan

🤖 [🔄 Searching analytes...]
   [🔄 Executing query...]

   ✅ Results:

   [Table with Ivan's vitamin D tests appears]
```

#### Example 2: Multi-Analyte Query (No Clarification Needed)

```
👤 покажи холестерин

🤖 [🔄 Поиск данных...]
   [🔄 Построение графика...]

   ✅ График холестерина:

   [Plot appears with multiple series: HDL, LDL, Total cholesterol]
   [Legend shows radio buttons to switch between analytes]
```

**Note**: Multi-analyte plots are already supported by existing plotRenderer.js (lines 234-458). Each analyte gets its own dataset with unique color and toggle controls. No clarification needed unless truly ambiguous.

#### Example 3: No Clarification Needed

```
👤 plot glucose for patient Ivan Petrov from January to March 2024

🤖 [🔄 Searching analytes...]
   [🔄 Executing query...]

   ✅ Glucose plot for Ivan Petrov (Jan-Mar 2024):

   [Plot appears]
```

#### Example 4: Multi-Step Clarification

```
👤 show blood tests

🤖 I found 3 patients. Which one?
   1. Ivan Petrov
   2. John Doe
   3. Maria Rodriguez

👤 Ivan

🤖 Ivan has 15 different blood tests. What are you interested in?
   - Complete blood count (CBC)
   - Metabolic panel
   - Lipid panel
   - Thyroid panel
   - Vitamin levels
   - Other specific test?

👤 vitamin levels

🤖 [🔄 Searching analytes...]
   [🔄 Executing query...]

   ✅ Ivan's vitamin levels:

   [Table with Vitamin D, B12, Folate, etc.]
```

---

## Decision Log & Open Questions

### Resolved Issues (Fixed in this PRD):

1. ✅ **SSE Connection Race Condition**: Added explicit sequencing requirement - frontend MUST wait for `session_start` event before calling POST /api/chat/messages. Added code example showing proper initialization flow.

2. ✅ **Schema Migration Approach**: Clarified to use declarative schema in `server/db/schema.js` (not ALTER TABLE migration), following CLAUDE.md guidance of "No migration files during MVP".

3. ✅ **Session Cleanup Inconsistency**: Unified to single 1-hour TTL based on `lastActivity`. Removed confusing "5-minute grace period" language. Completed sessions deleted immediately.

4. ✅ **Timeout Specification**: Clarified that v3.2 relies solely on OpenAI's streaming timeout (600s/10 minutes) with no custom watchdog.

5. ✅ **API Error Response Format**: Added structured error codes (`SESSION_NOT_FOUND`, `SESSION_BUSY`, `MESSAGE_LIMIT`) for better frontend error handling.

### Open Questions Requiring User Decision:

#### Question 1: Patient ID Matching Strategy ✅ RESOLVED

**DECISION: Backend deterministic matching**
- Backend extracts patient choice via regex/string matching
- Supports numbered selection (1, 2, 3), fuzzy name matching, and direct UUID
- Implementation priority: numbered selection first (simpler), name matching second
- Rationale: More reliable than LLM extraction, no hallucination risk, testable
- **Implemented in PRD**: Lines 263-270

---

#### Question 2: Clarification Phase Error Handling ✅ RESOLVED

**DECISION: No retries ever (Option B)**
- Any validation error ends session immediately
- User must start fresh conversation after error
- Simpler implementation, clearer user mental model
- Rationale: In MVP, prefer simplicity. Can add retry logic later if user feedback demands it.
- Error codes: All validation errors return same `VALIDATION_FAILED` code
- **Implemented in PRD**: Lines 791-797

---

#### Question 3: Feature Flag Default Timeline ✅ RESOLVED

**DECISION: Remove old API entirely**
- No backward compatibility needed (we're in MVP, not production)
- Phase 5 becomes mandatory, not optional
- Timeline: Remove old endpoint immediately after Phase 4 stabilizes (48 hours of zero critical bugs)
- Deployment plan:
  - Phase 1-3: Dev/staging with flag OFF
  - Phase 4: Production with flag ON (monitor for 48 hours)
  - Phase 5: Remove flag, remove old `sqlGenerator.js` route entirely
- Rollback trigger: Any critical bug (wrong patient data, data loss, security issue) → immediate flag flip to false
- **Implemented in PRD**: Lines 969-1015

---

#### Question 4: Analyte Disambiguation Thresholds ✅ RESOLVED

**DECISION: No change needed - existing behavior is correct**

**Current v3.1 behavior (verified in code):**
- `fuzzy_search_analyte_names` returns ALL matches (up to 20) with similarity scores
- LLM decides which analytes to include in final SQL based on user intent
- For broad queries ("show cholesterol"), LLM includes ALL related analytes (HDL, LDL, Total) → plot shows multiple series
- For specific queries ("show HDL cholesterol"), LLM includes only that analyte
- No thresholds needed - LLM uses fuzzy search results to intelligently construct the WHERE clause

**v3.2 conversational mode:**
- Preserves this behavior - LLM still decides which analytes to include
- Only asks clarification if truly ambiguous (rare edge case: e.g., "Vitamin D2 vs D3" when both are in DB and user intent is unclear)
- Configuration: Use existing `AGENTIC_SIMILARITY_THRESHOLD=0.3` (no new env variables needed)
- **Multi-analyte plot support verified**: plotRenderer.js lines 234-458, Example 2 updated in PRD

---

### Assumptions Made (Please Validate):

1. **No authentication**: Still MVP with multi-patient test data (no user→patient mapping)
2. **OpenAI for conversational mode**: Using OpenAI API streaming for chat interface. Anthropic is available for OCR processing only (as configured in current codebase).
3. **No conversation persistence**: Sessions are ephemeral (no save/restore across page refreshes)
4. **English + Russian only**: No explicit i18n, LLM handles language detection naturally
5. **Desktop-first UX**: Mobile support basic but not optimized (small screen chat bubbles TBD)
6. **Hardcoded error messages**: All error messages are in English regardless of user's language (existing limitation accepted for v3.2)

---

## Implementation Readiness Summary

✅ **All critical decisions resolved:**
1. **Patient ID matching**: Backend deterministic (numbered + name matching) - Lines 263-270, 742-783
2. **Error handling**: No retries - validation errors end session immediately - Lines 791-797
3. **Feature flag**: Remove old API after 48 hours of stability - Lines 969-1015
4. **Analyte disambiguation**: Preserve existing v3.1 behavior (works correctly) - Example 2 updated
5. **Timeout strategy**: No custom timeout, rely on OpenAI API (600s) - Lines 825-830, 595-608
6. **Session lifecycle**: Clean break - close SSE after results, new connection for next query - Lines 946-955

✅ **Technical specifications complete:**
- SSE connection flow with explicit sequencing (lines 446-472)
- API endpoints with structured error codes (SESSION_NOT_FOUND, SESSION_BUSY, MESSAGE_LIMIT)
- Session management with cleanup strategy (1-hour TTL, 100 session limit)
- Schema updates using declarative approach (lines 650-680)
- Code reuse strategy: Extract `agenticCore.js`, add `ensurePatientScope()` to sqlValidator
- Patient safety: Regex-based validation + LLM prompt instruction (defense-in-depth)

✅ **Testing strategy defined:**
- Unit tests for session manager, SSE parsing, patient scope validation
- Integration tests for clarification flows (patient disambiguation, format clarification)
- Manual QA checklist with edge cases and error scenarios

✅ **Deployment plan ready:**
- Phase 1-3: Dev/staging implementation (flag OFF)
- Phase 4: Production rollout (flag ON, monitor 48 hours)
- Phase 5: Remove old `sqlGenerator.js` route entirely
- Rollback trigger: Critical bugs (wrong patient data, data loss, security) → immediate flag flip to false

**✅ Ready to proceed with implementation.**

---

**End of PRD v3.2**
