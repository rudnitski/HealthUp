# PRD v4.2.3 — Thumbnail UI Infrastructure (Message Anchoring & Contract Finalization)

## Status
**Planned** — prerequisite for v4.2.4 (Frontend Thumbnail Rendering)

## Parent PRDs
- Builds on **PRD v4.2.2 — Thumbnail Contract Expansion + Backend Derivation (Implemented)**
- Enables **PRD v4.2.4 — Frontend Thumbnail Rendering (Future)**

---

## Motivation

PRD v4.2.2 implemented backend thumbnail derivation and unified `show_plot` tool. However, peer review identified a critical gap:

**The frontend cannot reliably associate thumbnails with assistant messages.**

Current state:
- `thumbnail_update` SSE events include `plot_title` and `result_id`
- No way to deterministically link a thumbnail to a specific assistant message bubble
- Frontend must guess: "last assistant bubble" or "most recent plot"

This breaks when:
1. **Multiple plots in one response**: "Show me vitamin D and cholesterol trends" → two thumbnails, which goes where?

This PRD:
- Adds message lifecycle events with UUIDs for deterministic anchoring
- Finalizes thumbnail contract with required/optional field rules
- Defines fallback rendering behavior for missing/null fields

---

## Goals

### Primary
- Add `message_start` / `message_end` SSE events with `message_id` (UUID)
- Include `message_id` in all events within an assistant turn (`text`, `tool_start`, `tool_complete`, `plot_result`, `thumbnail_update`, `table_result`)
- Define and enforce minimal required thumbnail shape
- Document frontend fallback behavior for null/missing fields

### Secondary
- Keep implementation simple (no database persistence of message IDs)

---

## Non-Goals

- Persisting message IDs to database (in-memory only, per-session)
- Database migrations or schema changes (no data persistence needed)
- Thumbnail replacement logic (`replace_previous` for thumbnails deferred)
- Full frontend implementation (that's v4.2.4)
- Multi-session message correlation (messages are session-scoped)
- Backward compatibility with `message_complete` (not in production)

---

## Key Definitions

**Assistant Turn**: One user message triggers one assistant turn. An assistant turn includes:
- All LLM streaming responses
- All tool calls and their execution
- All recursive `streamLLMResponse()` calls until no more tool calls
- Ends when `toolCalls.length === 0` (LLM finished speaking)

**Message ID Scope**: A single `message_id` (UUID) is created once per user prompt in `processMessage()` and persists across all tool calls and recursive LLM calls until the turn completes.

**Single-Flight Constraint**: Sessions enforce single-flight processing via atomic locking (`tryAcquireLock()` in chatStream.js:251). When a user message arrives while the session is processing:
- Backend: Lock acquisition fails → returns 409 "Session is currently processing a message"
- Frontend: Client-side guard shows error "Please wait for the assistant to finish responding" and **drops** the message (no queueing/retry)
- This **guarantees** `session.currentMessageId` is never overwritten mid-turn
- No race conditions between rapid/overlapped prompts
- **Note**: Frontend could implement message queueing in future, but it's not required for the guarantee to hold

**Event Ordering Guarantee**: All events are emitted in a deterministic order guaranteed by **sequential await** execution (not parallelization or true synchronous execution). The order is guaranteed by sequential awaiting:

1. Tool execution is **sequentially awaited** in `executeToolCalls()`:
   - Each tool is awaited before the next (for-loop with await, chatStream.js:560)
   - `handleShowPlot()` (async) emits `plot_result`, then `thumbnail_update` (if non-null)
   - Control returns to caller only after tool handler's Promise resolves
   - `tool_complete` emitted after tool handler returns
2. **After all tools complete**, `streamLLMResponse()` is called recursively (line 691)
3. **Only when** `toolCalls.length === 0` does `message_end` fire
4. **Result**: Late events cannot arrive after `message_end` (no async gaps between tool results and finalization)

**CRITICAL - Ordering depends on sequential execution**: If any tool handler is made concurrent (e.g., `Promise.all()` for parallel tool execution), events could interleave and arrive after `message_end`, breaking the guarantee. All current tool handlers must remain sequentially awaited.

**Hard Requirement for Future Implementations**: Events with `message_id` **MUST NOT** be emitted after `message_end` is sent. Any async tool handlers or background jobs must complete before `message_end`, or be designed to not emit events. Violations will confuse frontend message anchoring.

**Defensive Guard**: Add this check to `streamEvent()` helper to drop late events:

First, attach session to response object in the SSE stream endpoint (currently line 184-214):

```javascript
router.get('/stream', (req, res) => {
  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  // Create session
  const session = sessionManager.createSession();

  // Store SSE response object in session for streaming
  session.sseResponse = res;

  // === NEW: Attach session to res.locals for streamEvent guard ===
  res.locals = res.locals || {};
  res.locals.session = session;

  // Send session_start event
  streamEvent(res, {
    type: 'session_start',
    sessionId: session.id
  });

  // Handle client disconnect
  req.on('close', () => {
    // CRITICAL: Null out sseResponse to prevent writes after disconnect
    session.sseResponse = null;
    sessionManager.markDisconnected(session.id);
    logger.info('[chatStream] SSE connection closed:', {
      session_id: session.id
    });
  });

  // Keep connection alive (send comment every 30 seconds)
  const keepAliveInterval = setInterval(() => {
    // Guard: don't write to closed/destroyed response
    if (!res.writableEnded && !res.destroyed) {
      res.write(': keepalive\n\n');
    }
  }, 30000);

  req.on('close', () => {
    clearInterval(keepAliveInterval);
  });
});
```

Then update `streamEvent()` helper (currently line 108-110) to include the guard:

```javascript
function streamEvent(res, event) {
  // REQUIRES: res.locals.session set by /stream endpoint (see implementation guide section 1)
  // IMPORTANT: This helper is NOT a generic SSE utility. It requires:
  //   1. res is the Express response from /stream endpoint (GET /api/chat/stream)
  //   2. res.locals.session was set in the endpoint (line 107-108)
  //   3. session.currentMessageId tracks the current turn
  // Do NOT reuse this function for other endpoints without ensuring these invariants.
  // If you need SSE elsewhere, create a separate helper or use res.write() directly.

  const session = res.locals?.session || null;

  // Guard 1: Drop events with message_id if message already ended
  if (event.message_id && session && !session.currentMessageId) {
    logger.warn('[chatStream] Dropping event after message_end:', {
      type: event.type,
      message_id: event.message_id,
      session_id: session.id
    });
    return;
  }

  // Guard 2: Don't write to closed/destroyed response (prevents "write after end" errors)
  if (res.writableEnded || res.destroyed) {
    logger.warn('[chatStream] Dropping event - response already closed:', {
      type: event.type,
      message_id: event.message_id || null,
      session_id: session?.id || null
    });
    return;
  }

  // Write SSE event
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}
```

**Why null check is sufficient** (no equality check needed):

Guard 1 only checks `!session.currentMessageId` (nullish), not equality (`event.message_id !== session.currentMessageId`), because:

1. **Architectural constraint**: All `streamEvent()` calls pass `session.currentMessageId` inline (never cached):
   ```javascript
   streamEvent(res, {
     type: 'text',
     message_id: session.currentMessageId,  // Always current, not stored separately
     content: delta.content
   });
   ```

2. **Single-flight lock**: The lock at chatStream.js:251 (`tryAcquireLock()`) prevents concurrent turns, so `currentMessageId` cannot change mid-turn

3. **Sequential execution**: All tool handlers are sequentially awaited (see Event Ordering Guarantee above); no async tasks can fire events after turn ends

**If these constraints are violated** (e.g., background thumbnail generation, parallel tool execution), the guard MUST be strengthened to:
```javascript
// Guard 1: Drop events with mismatched message_id
if (event.message_id && session) {
  if (!session.currentMessageId) {
    logger.warn('[chatStream] Dropping event after message_end');
    return;
  }
  if (event.message_id !== session.currentMessageId) {
    logger.warn('[chatStream] Dropping event with mismatched message_id:', {
      event_message_id: event.message_id,
      current_message_id: session.currentMessageId
    });
    return;
  }
}
```

This guard ensures robustness against future async tool implementations that might violate the ordering guarantee.

**Context**: The `res` parameter in `streamEvent(res, event)` is ALWAYS the Express response object created in the `/stream` endpoint (line 184). The `session.sseResponse` property stores this object (line 197), so `res.locals.session` is guaranteed to be available when the guard runs. This is NOT a generic stream - it's specifically the Express SSE response with attached session context.

**IMPORTANT for future implementations**: The `streamEvent()` helper is **NOT** a generic SSE utility. It requires:
1. `res` is the Express response from `/stream` endpoint (GET /api/chat/stream)
2. `res.locals.session` was set in the endpoint (line 107-108)
3. `session.currentMessageId` tracks the current turn

**Do not** reuse `streamEvent()` for other endpoints without ensuring these invariants. If you need SSE elsewhere, create a separate helper or use `res.write()` directly.

---

## Architecture Overview

### Before (v4.2.2)
```
User message → LLM streaming → text events → tool_start → tool_complete → plot_result → thumbnail_update → message_complete
                              ↑ no correlation between events ↑
```

### After (v4.2.3)
```
User message → message_start(message_id=UUID)
            → text(message_id)
            → tool_start(message_id)
            → tool_complete(message_id)
            → plot_result(message_id)
            → thumbnail_update(message_id)
            → [recursive LLM calls reuse same message_id]
            → message_end(message_id)
```

**Key insight**: All events within one assistant turn share the same `message_id`. Frontend creates bubble on `message_start`, appends content/thumbnails by matching `message_id`, finalizes on `message_end`.

---

## Implementation Guide

### 0. Update sessionManager.js — Add currentMessageId to Session Schema

**File**: `server/utils/sessionManager.js`

Add `currentMessageId` property to session object in `createSession()` (currently line 62-73):

```javascript
createSession() {
  this.enforceSessionLimit();

  const session = {
    id: crypto.randomUUID(),
    messages: [],
    createdAt: new Date(),
    lastActivity: new Date(),
    selectedPatientId: null,
    awaitingPatientSelection: false,
    patients: [],
    patientCount: 0,
    isProcessing: false,
    iterationCount: 0,
    currentMessageId: null  // === NEW: Track current assistant message ID ===
  };

  this.sessions.set(session.id, session);
  return session;
}
```

**Why explicit initialization**: While JavaScript allows ad-hoc property addition, explicitly declaring `currentMessageId` in the session schema:
- Makes the session structure self-documenting
- Prevents confusion about which properties exist
- Helps IDEs and linters catch typos

### 1. Update chatStream.js — Message Lifecycle Events

**File**: `server/routes/chatStream.js`

#### 1.1 Create Message ID in processMessage() (NOT streamLLMResponse)

**CRITICAL**: The `message_id` must be created once per user message, not per LLM call. Since `streamLLMResponse()` is called recursively after tool execution, creating the ID there would generate new UUIDs mid-turn.

```javascript
async function processMessage(sessionId, userMessage) {
  const session = sessionManager.getSession(sessionId);
  if (!session) {
    logger.error('[chatStream] Session not found during processing:', { session_id: sessionId });
    return;
  }

  try {
    // Add user message to conversation
    sessionManager.addMessage(sessionId, 'user', userMessage);

    // Initialize system prompt on first message
    if (session.messages.length === 1) {
      await initializeSystemPrompt(session);
    }

    // ... existing patient selection logic ...

    // === NEW: Create message_id for this assistant turn ===
    // NOTE: Set unconditionally (even if sseResponse is null) to maintain state consistency
    // Clearing is also unconditional in all exit paths (normal, error, session deletion)
    session.currentMessageId = crypto.randomUUID();

    // Emit message_start (conditional - only if SSE connected)
    if (session.sseResponse) {
      streamEvent(session.sseResponse, {
        type: 'message_start',
        message_id: session.currentMessageId
      });
    }

    // Start LLM streaming (may recurse, but reuses same message_id)
    await streamLLMResponse(session);

  } catch (error) {
    // ... existing error handling ...
  } finally {
    sessionManager.releaseLock(sessionId);
  }
}
```

#### 1.2 Include message_id in All Events

**streamLLMResponse()** — Do NOT generate new message_id here (it's already set in processMessage):

```javascript
async function streamLLMResponse(session) {
  // ... existing code ...

  // Text streaming (inside for-await loop):
  if (delta.content) {
    assistantMessage += delta.content;
    if (session.sseResponse) {
      streamEvent(session.sseResponse, {
        type: 'text',
        message_id: session.currentMessageId,  // ADD
        content: delta.content
      });
    }
  }

  // ... rest of streaming ...
}
```

**executeToolCalls()** — Add message_id to tool events:

```javascript
// Tool start
if (session.sseResponse) {
  streamEvent(session.sseResponse, {
    type: 'tool_start',
    message_id: session.currentMessageId,  // ADD
    tool: toolName,
    params
  });
}

// Tool complete (after execution)
if (session.sseResponse) {
  streamEvent(session.sseResponse, {
    type: 'tool_complete',
    message_id: session.currentMessageId,  // ADD
    tool: toolName,
    duration_ms: Date.now() - toolStartTime
  });
}
```

**handleShowPlot()** — Add message_id to plot and thumbnail events:

```javascript
// Happy path: Plot result
streamEvent(res, {
  type: 'plot_result',
  message_id: session.currentMessageId,  // ADD
  plot_title,
  rows: rowsWithOutOfRange,
  replace_previous: replace_previous || false
});

// Happy path: Thumbnail update (only emit if thumbnail exists - null means LLM intentionally omitted)
if (result.thumbnail !== null) {
  streamEvent(res, {
    type: 'thumbnail_update',
    message_id: session.currentMessageId,  // ADD
    plot_title,
    result_id: result.resultId,
    thumbnail: result.thumbnail
  });
}

// CRITICAL: Invalid-data branch (lines 773-790) - MUST also include message_id
// This branch emits SSE events to update UI when data validation fails
if (!Array.isArray(data)) {
  if (res) {
    streamEvent(res, {
      type: 'plot_result',
      message_id: session.currentMessageId,  // REQUIRED
      plot_title,
      rows: [],
      replace_previous: true
    });
  }

  if (thumbnailConfig && res) {
    streamEvent(res, {
      type: 'thumbnail_update',
      message_id: session.currentMessageId,  // REQUIRED
      plot_title,
      result_id: crypto.randomUUID(),
      thumbnail: deriveEmptyThumbnail(plot_title)
      // CRITICAL FIX: Remove existing `replace_previous: true` from line 788
      // The thumbnail_update contract does NOT include replace_previous field
    });
  }

  // Tool error response (no SSE emission, no message_id needed)
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
```

**handleShowTable()** — Add message_id to table events:

```javascript
streamEvent(session.sseResponse, {
  type: 'table_result',
  message_id: session.currentMessageId,  // ADD
  table_title,
  rows: data,
  replace_previous
});
```

**Note on Tool Error Branches**: Most error branches in tool handlers (`handleShowPlot`, `handleShowTable`) do **NOT** emit SSE events - they only push error messages to `session.messages` for LLM recovery, so no `message_id` needed.

**EXCEPTION**: The invalid-data branch in `handleShowPlot` (lines 765-803 in chatStream.js) **DOES** emit `plot_result` and `thumbnail_update` SSE events to update the UI with empty state. This branch **MUST** include `message_id` on all emitted events (shown in example above).

**Rule of thumb**: If the error branch calls `streamEvent()`, it needs `message_id`. If it only pushes to `session.messages`, it doesn't.

Example of error branch WITHOUT SSE emission (no message_id needed):
```javascript
// Error branch (no SSE emission, no message_id needed)
session.messages.push({
  role: 'tool',
  tool_call_id: toolCallId,
  content: JSON.stringify({ success: false, error: 'Invalid parameters' })
});
return;
```

#### 1.3 Emit message_end When Turn Completes

**CRITICAL**: `message_end` must fire exactly once per `message_start`, even if the assistant emits no text. The condition is `toolCalls.length === 0` (turn complete), NOT `assistantMessage` being non-empty.

In `streamLLMResponse()`, replace the existing `message_complete` logic:

```javascript
// Execute tool calls
if (toolCalls.length > 0) {
  await executeToolCalls(session, toolCalls);
  // Note: executeToolCalls will call streamLLMResponse recursively
  // The recursive call will eventually hit toolCalls.length === 0
} else {
  // === Turn complete - ALWAYS emit message_end ===
  if (session.sseResponse && session.currentMessageId) {
    streamEvent(session.sseResponse, {
      type: 'message_end',
      message_id: session.currentMessageId
    });
  }

  // CRITICAL: Always clear messageId, even if SSE unavailable
  // Keeps session state clean for next turn and prevents double emission
  session.currentMessageId = null;
}
```

**Idempotency guard**: Always check `session.currentMessageId` before emitting `message_end`, and **unconditionally** clear it after the turn completes. This ensures:
1. No double emission if error occurs later (e.g., during session cleanup)
2. No stale state if SSE connection fails mid-turn
3. Clean session state for the next user message

#### 1.4 Handle Errors and Finalize Turn

**CRITICAL**: The `message_end` event must fire exactly once per `message_start`, even on error paths. This ensures the frontend always receives a clean finalization signal.

**Error handling rule**: On any error, emit `error` event (with `message_id`), then emit `message_end`, then clear `currentMessageId`.

**In `processMessage()` catch block:**

```javascript
} catch (error) {
  logger.error('[chatStream] Error processing message:', {
    session_id: sessionId,
    error: error.message,
    stack: error.stack
  });

  // Send error to client if SSE stream is available
  if (session.sseResponse) {
    // Error event with message_id for correlation
    streamEvent(session.sseResponse, {
      type: 'error',
      message_id: session.currentMessageId || null,
      code: 'PROCESSING_ERROR',
      message: 'Failed to process message. Please try again.',
      debug: NODE_ENV === 'development' ? error.message : undefined
    });

    // Always finalize the turn after error (if message was started)
    if (session.sseResponse && session.currentMessageId) {
      streamEvent(session.sseResponse, {
        type: 'message_end',
        message_id: session.currentMessageId
      });
    }
  }

  // CRITICAL: Always clear message ID unconditionally
  // This prevents state leakage even when:
  // - SSE connection is lost (sseResponse is null)
  // - Error occurs before message_start was emitted
  // - Session is deleted or invalidated mid-turn
  session.currentMessageId = null;

} finally {
  // Release processing lock
  if (sessionManager.getSession(sessionId)) {
    sessionManager.releaseLock(sessionId);
  }
}
```

**In `streamLLMResponse()` catch block:**

The `streamLLMResponse()` catch logs and re-throws **without emitting an error event**. The `processMessage()` catch is the **single source of error emission** to avoid duplicates.

```javascript
} catch (error) {
  logger.error('[chatStream] LLM streaming error:', {
    session_id: session.id,
    error: error.message,
    error_code: error.code,
    error_type: error.type
  });

  // DO NOT emit error event here - processMessage() catch handles all error emission
  // This avoids duplicate error events when errors propagate up the call stack

  throw error;  // Re-throw to processMessage() for unified error handling
}
```

**CRITICAL - What to remove from existing code**:
In the existing `streamLLMResponse()` catch block (currently at lines 534-553), DELETE these lines:
```javascript
// DELETE THIS BLOCK (lines 544-551):
if (session.sseResponse) {
  streamEvent(session.sseResponse, {
    type: 'error',
    code: error.code || 'LLM_ERROR',
    message: 'AI service error. Please try again.',
    debug: NODE_ENV === 'development' ? error.message : undefined
  });
}
```

Only keep the logging and the re-throw. The `processMessage()` catch will handle ALL error emission to avoid duplicates.

**Error flow summary:**
1. Error occurs in `streamLLMResponse()` → logs → throws (no SSE emission)
2. `processMessage()` catches → emits `error` → emits `message_end` → clears `currentMessageId`
3. Frontend receives: exactly one `error` then one `message_end` (same `message_id`)

**Non-Exception Termination Paths:**

Some termination conditions are detected **before** exceptions occur (e.g., iteration limits). These paths must also emit `message_end` to finalize the turn.

**Iteration limit example** (in `streamLLMResponse()`):

```javascript
// Safety limit: prevent infinite tool-calling loops
session.iterationCount = (session.iterationCount || 0) + 1;
if (session.iterationCount > MAX_CONVERSATION_ITERATIONS) {
  logger.error('[chatStream] Iteration limit exceeded:', {
    session_id: session.id,
    iteration_count: session.iterationCount,
    max_iterations: MAX_CONVERSATION_ITERATIONS
  });

  if (session.sseResponse) {
    // Error event with message_id
    streamEvent(session.sseResponse, {
      type: 'error',
      message_id: session.currentMessageId || null,
      code: 'ITERATION_LIMIT_EXCEEDED',
      message: 'Conversation became too complex. Please start a new conversation.',
      debug: NODE_ENV === 'development' ? `Exceeded ${MAX_CONVERSATION_ITERATIONS} iterations` : undefined
    });

    // Emit message_end if message was started
    if (session.currentMessageId) {
      streamEvent(session.sseResponse, {
        type: 'message_end',
        message_id: session.currentMessageId
      });
    }
  }

  // CRITICAL: Always clear message ID (unconditional)
  session.currentMessageId = null;

  sessionManager.deleteSession(session.id);
  return;
}
```

**Rule**: Any code path that exits early (before natural `toolCalls.length === 0`) must:
1. Emit `error` (with `message_id` if available)
2. Emit `message_end` (if `currentMessageId` is set)
3. Clear `currentMessageId`
4. Then perform cleanup (delete session, etc.)

This applies to:
- Iteration limit checks
- Session invalidation mid-turn
- Any other early-exit conditions

**Note**: Token exhaustion is NOT an early-exit path in this codebase. The `pruneConversationIfNeeded()` function handles token limits proactively via preventive pruning, not as an error condition.

**Session deletion mid-turn example** (in `streamLLMResponse()`, currently at line 393-398):

```javascript
// Safety check: verify session still exists (could be deleted by timeout/disconnect)
if (!sessionManager.getSession(session.id)) {
  logger.warn('[chatStream] Session deleted during processing:', {
    session_id: session.id
  });

  // === FIX: Emit terminal events before returning ===
  if (session.sseResponse) {
    // Error event (if message was started)
    if (session.currentMessageId) {
      streamEvent(session.sseResponse, {
        type: 'error',
        message_id: session.currentMessageId,
        code: 'SESSION_EXPIRED',
        message: 'Session expired. Please refresh and try again.',
        debug: NODE_ENV === 'development' ? 'Session deleted mid-turn' : undefined
      });

      // Finalize the turn
      streamEvent(session.sseResponse, {
        type: 'message_end',
        message_id: session.currentMessageId
      });
    }
  }

  // Always clear message ID
  session.currentMessageId = null;
  return;
}
```

**Same pattern applies to** `executeToolCalls()` session check (currently at line 684-689).

#### 1.6 Remove Dead Code: handleFinalQuery in chatStream.js

**Context**: The `generate_final_query` tool was removed in PRD v3.3 (replaced by `show_plot`/`show_table`). The `handleFinalQuery()` function in `chatStream.js` is now dead code.

**CRITICAL - Scope of deletion**:
- **DELETE**: `handleFinalQuery()` function in `server/routes/chatStream.js` (lines 970-1096)
- **PRESERVE**: `handleFinalQuery()` in `server/services/agenticCore.js` and `server/services/agenticSqlGenerator.js` (active code for legacy `/api/sql-generator` endpoint)

**Verification before deletion**:
```bash
# Verify function is only called within itself (recursive call at line 995)
rg -n "handleFinalQuery" server/routes/chatStream.js
# Expected output: Only lines 970 (definition) and 995 (internal recursive call)

# Verify not used in tests or scripts
rg -n "handleFinalQuery" test/ scripts/ 2>/dev/null || echo "Not found in tests/scripts (expected)"
# Expected output: "Not found in tests/scripts (expected)" or no matches
```

**Why safe to delete**:
- No external callers in chatStream.js (verified by grep)
- `generate_final_query` tool removed from TOOL_DEFINITIONS in PRD v3.3
- Function has not been reachable since v3.3 deployment
- Emits deprecated `done` events that conflict with new `message_end`

**Delete entire function** (lines 970-1096) as part of this PRD's cleanup.

**Complete Checklist of Early-Exit Paths** (for mid-level implementers):

| Line | Location | Condition | Action Required |
|------|----------|-----------|-----------------|
| 296 | `processMessage()` | Session not found | **No change** - occurs before `currentMessageId` is set |
| 398 | `streamLLMResponse()` | Session deleted mid-turn | **Add**: Emit error + message_end (pattern shown in section 1.4) |
| 424 | `streamLLMResponse()` | Iteration limit exceeded | **Add**: Replace `done` with `message_end` (pattern shown in section 1.4) |
| 688 | `executeToolCalls()` | Session deleted mid-turn | **Add**: Emit error + message_end (same as line 398) |
| 802 | `pruneConversationIfNeeded()` | Early return (below threshold) | **No change** - helper function, not exit path |
| Error catch | `processMessage()` | Any processing error | **Add**: Error + message_end (section 1.4 shows pattern) |
| Error catch | `streamLLMResponse()` | LLM streaming error | **No change** - re-throws to processMessage (section 1.4) |
| 970-1096 | `handleFinalQuery()` | Dead code (entire function) | **Delete**: Remove entire function (section 1.6) |

**Rule**: If `currentMessageId` is set when exiting, emit `error` (if applicable) then `message_end`, then clear `currentMessageId`.

#### 1.5 Guard Against Missing plot_title in handleShowPlot

**Rationale**: The `show_plot` tool schema (agenticTools.js:497) already declares `plot_title` as required. However, OpenAI's structured output can occasionally omit required fields in edge cases (token limits, model errors). This guard provides defense-in-depth validation to catch violations and trigger LLM retry with a clear error message.

Add validation at the start of `handleShowPlot()` to reject tool calls with missing `plot_title`:

```javascript
async function handleShowPlot(session, params, toolCallId) {
  const { data, plot_title, replace_previous, thumbnail: thumbnailConfig } = params;
  const res = session.sseResponse;

  // === NEW: Guard against missing plot_title ===
  if (!plot_title || typeof plot_title !== 'string' || plot_title.trim() === '') {
    logger.warn('[handleShowPlot] Missing or invalid plot_title:', {
      session_id: session.id,
      plot_title,
      plot_title_type: typeof plot_title
    });

    // Emit user-visible error (LLM typically retries with correct parameters)
    if (session.sseResponse) {
      streamEvent(session.sseResponse, {
        type: 'error',
        message_id: session.currentMessageId || null,
        code: 'INVALID_TOOL_PARAMS',
        message: 'Plot generation failed due to missing title. Retrying...',
        debug: NODE_ENV === 'development' ? 'plot_title is required' : undefined
      });
    }

    // Send error to LLM for recovery
    session.messages.push({
      role: 'tool',
      tool_call_id: toolCallId,
      content: JSON.stringify({
        success: false,
        error: 'plot_title is required and must be a non-empty string'
      })
    });
    return;
  }

  // ... rest of existing logic ...
}
```

**UX Note**: When `plot_title` is missing, the backend emits a transient error to the user ("Retrying...") and a tool error to the LLM. The LLM typically recovers by calling the tool again with correct parameters. If the LLM cannot recover after multiple attempts, the iteration limit or other error handling will provide final user feedback.

---

### 2. Update SSE Event Schemas

#### 2.1 New Events

**`message_start`** — Emitted once at the beginning of each assistant turn (in `processMessage`)
```typescript
{
  type: "message_start",
  message_id: string  // UUID, unique per assistant turn within session
}
```

**`message_end`** — Emitted once when assistant turn is complete (when toolCalls.length === 0)
```typescript
{
  type: "message_end",
  message_id: string  // Same UUID as corresponding message_start
}
```

#### 2.2 Updated Events (add message_id)

**`text`**
```typescript
{
  type: "text",
  message_id: string,  // NEW
  content: string
}
```

**`tool_start`**
```typescript
{
  type: "tool_start",
  message_id: string,  // NEW
  tool: string,
  params: object
}
```

**`tool_complete`**
```typescript
{
  type: "tool_complete",
  message_id: string,  // NEW
  tool: string,
  duration_ms: number,
  error?: string,      // Optional: present on tool execution failure
  debug?: string       // Optional: present in development mode on failure
}
```

**`plot_result`**
```typescript
{
  type: "plot_result",
  message_id: string,  // NEW
  plot_title: string,
  rows: PlotRow[],
  replace_previous: boolean
}
```

**`thumbnail_update`** — Only emitted when thumbnail derivation succeeds (not emitted if LLM omits thumbnail parameter)
```typescript
{
  type: "thumbnail_update",
  message_id: string,  // NEW
  plot_title: string,
  result_id: string,
  thumbnail: Thumbnail  // Always non-null when event is emitted
  // NOTE: replace_previous is intentionally NOT part of this contract
  // Thumbnails are metadata decorations, not independent UI elements
  // Frontend anchors thumbnails to messages via message_id
}
```

**`table_result`** (matches actual implementation)
```typescript
{
  type: "table_result",
  message_id: string,  // NEW
  table_title: string,
  rows: object[],
  replace_previous: boolean
}
```

**`error`** (optional message_id)
```typescript
{
  type: "error",
  message_id: string | null,  // NEW (null if error before message started)
  code: string,
  message: string,
  debug?: string
}
```

#### 2.3 Deprecated / Transport Events

**`done`** — **DEPRECATED** in favor of `message_end`

Current implementation emits `done` in multiple places (iteration limits, error paths, session cleanup). This creates ambiguity with the new `message_end` event.

**IMPORTANT - Two separate cleanup tasks**:

1. **Live `done` emission** (line 419 in `streamLLMResponse()` iteration limit check):
   - This is **active code** that runs when conversation exceeds `MAX_CONVERSATION_ITERATIONS`
   - Currently emits `error` then `done` (lines 411-420)
   - **Must replace** `done` with `message_end` (use existing PRD pattern from section 1.4)
   - This path already has `currentMessageId` set, so standard `message_end` emission works

2. **Dead code `done` emissions** (lines 1014, 1066, 1090 in `handleFinalQuery()` function):
   - These are in **dead code** (function never called, `generate_final_query` tool removed in PRD v3.3)
   - Located in **chatStream.js ONLY** (lines 970-1096)
   - **CRITICAL**: Do NOT touch `handleFinalQuery()` in `server/services/agenticCore.js` or `server/services/agenticSqlGenerator.js` - those are ACTIVE code
   - Automatically removed when `handleFinalQuery()` function in chatStream.js (lines 970-1096) is deleted
   - No migration needed, code never runs

**Code cleanup (no data migrations)**:
- **Replace `done` with `message_end`** at line 419 (iteration limit path - active code)
- **Remove entire `handleFinalQuery()` function** (lines 970-1096) from chatStream.js ONLY as dead code cleanup:
  1. First, verify with scoped grep: `rg -n "handleFinalQuery" server/routes/chatStream.js`
  2. Expected: Only definition at line 970 and internal call at line 995 (both in dead function in chatStream.js)
  3. **CRITICAL**: Do NOT touch `handleFinalQuery()` in `server/services/agenticCore.js` or `server/services/agenticSqlGenerator.js` - those are ACTIVE CODE for the legacy `/api/sql-generator` endpoint
  4. Delete entire function in chatStream.js only (lines 970-1096)
- Remove `case 'done'` handler from `public/js/chat.js` (currently at line 135)
- Remove `case 'message_complete'` handler from `public/js/chat.js` (currently at line 111)
- Frontend uses `message_end` to finalize messages and re-enable input (replaces both)

**`status`** — **Keep as transport-level metadata** (no message_id)

The `status` event (e.g., "Thinking...") is **not part of assistant message content**. It provides global UI state signals.

**Behavior**:
- Does NOT receive `message_id` field
- Used for app-level indicators (e.g., thinking spinner in header, not in message bubble)
- Remains unchanged from current implementation
- Frontend handles independently of message lifecycle

**Example** (correct execution order):
```javascript
// 1. Message lifecycle begins (in processMessage)
streamEvent(session.sseResponse, {
  type: 'message_start',
  message_id: 'abc-123'
});

// 2. Status indicator appears (emitted from streamLLMResponse)
streamEvent(session.sseResponse, {
  type: 'status',
  status: 'thinking',
  message: 'Thinking...'
});
```

**Note**: `message_start` is emitted in `processMessage()` before calling `streamLLMResponse()`. The `status` event is emitted at the start of `streamLLMResponse()`, so it appears **after** `message_start` in the event stream.

**Future considerations**: If per-message status indicators are needed in the future (e.g., "Generating plot for message X..."), introduce a **new event type** (e.g., `message_status`) with `message_id`. **Do NOT** add `message_id` to `status` - it serves a different architectural role (global UI state vs. message-scoped content). The `status` event should remain global indefinitely.

---

### 3. Thumbnail Contract Finalization

#### 3.1 Required vs Optional Fields

Define which fields are **required** (must always be present) vs **optional** (can be null):

| Field | Required | Type | Notes |
|-------|----------|------|-------|
| `plot_title` | **Yes** | `string` | Must be non-empty |
| `status` | **Yes** | `enum` | `"normal"`, `"high"`, `"low"`, `"unknown"` |
| `sparkline.series` | **Yes** | `number[]` | 1-30 values, `[0]` for empty data |
| `point_count` | **Yes** | `number` | >= 0 |
| `series_count` | **Yes** | `number` | >= 0 |
| `focus_analyte_name` | No | `string \| null` | null for single-series or empty |
| `latest_value` | No | `number \| null` | null if no data |
| `unit_raw` | No | `string \| null` | null if no data |
| `unit_display` | No | `string \| null` | null if no data |
| `delta_pct` | No | `number \| null` | null if < 2 points or mixed units |
| `delta_direction` | No | `enum \| null` | `"up"`, `"down"`, `"stable"`, or null |
| `delta_period` | No | `string \| null` | e.g., `"2y"`, `"3m"`, or null |

#### 3.2 TypeScript Interface (for documentation)

```typescript
interface Thumbnail {
  // Required fields (always present, never null)
  plot_title: string;
  status: "normal" | "high" | "low" | "unknown";
  sparkline: {
    series: number[];  // 1-30 values
  };
  point_count: number;
  series_count: number;

  // Optional fields (may be null)
  focus_analyte_name: string | null;
  latest_value: number | null;
  unit_raw: string | null;
  unit_display: string | null;
  delta_pct: number | null;
  delta_direction: "up" | "down" | "stable" | null;
  delta_period: string | null;
}
```

#### 3.3 Add validateThumbnailOutput() to thumbnailDerivation.js

**File**: `server/utils/thumbnailDerivation.js`

Add a post-derivation validation function:

```javascript
/**
 * Validate that thumbnail meets required field contract
 * @param {object} thumbnail - Derived thumbnail object
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateThumbnailOutput(thumbnail) {
  const errors = [];

  // Required fields
  if (!thumbnail.plot_title || typeof thumbnail.plot_title !== 'string') {
    errors.push('plot_title is required and must be a non-empty string');
  }

  const validStatuses = ['normal', 'high', 'low', 'unknown'];
  if (!validStatuses.includes(thumbnail.status)) {
    errors.push(`status must be one of: ${validStatuses.join(', ')}`);
  }

  if (!thumbnail.sparkline?.series || !Array.isArray(thumbnail.sparkline.series)) {
    errors.push('sparkline.series is required and must be an array');
  } else if (thumbnail.sparkline.series.length < 1 || thumbnail.sparkline.series.length > 30) {
    errors.push('sparkline.series must have 1-30 values');
  } else if (!thumbnail.sparkline.series.every(v => typeof v === 'number' && Number.isFinite(v))) {
    errors.push('sparkline.series must contain only finite numbers');
  }

  if (typeof thumbnail.point_count !== 'number' || thumbnail.point_count < 0) {
    errors.push('point_count is required and must be >= 0');
  }

  if (typeof thumbnail.series_count !== 'number' || thumbnail.series_count < 0) {
    errors.push('series_count is required and must be >= 0');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
```

Update `deriveThumbnail()` to validate ALL code paths at the return boundary:

**CRITICAL**: Validation must occur at the return boundary to catch bugs in ALL code paths (main derivation, fallback, and empty). This includes `deriveEmptyThumbnail()` and `deriveFallbackThumbnail()` which are simpler but not immune to refactoring bugs.

```javascript
function deriveThumbnail(params) {
  const { rows, plot_title, thumbnail: thumbnailConfig } = params;

  // If config omitted, return null (intentional omission by LLM)
  if (!thumbnailConfig) {
    return null;
  }

  // Generate ephemeral result_id
  const resultId = crypto.randomUUID();
  let thumbnail;
  let codePath; // Track which path for debugging

  // Validate config
  const validationResult = validateThumbnailConfig(thumbnailConfig);
  if (!validationResult.valid) {
    // FALLBACK RATIONALE: LLM provided malformed thumbnail config (bad JSON, wrong types)
    // We still have valid rows data, so use deriveFallbackThumbnail() to extract sparkline
    // This gracefully recovers from LLM mistakes without losing user value
    thumbnail = deriveFallbackThumbnail(plot_title, rows || []);
    codePath = 'fallback';
  } else if (!rows || rows.length === 0) {
    // Handle empty data
    thumbnail = deriveEmptyThumbnail(plot_title);
    codePath = 'empty';
  } else {
    // ... existing derivation logic ...
    thumbnail = {
      plot_title,
      focus_analyte_name: focusSeries.name,
      // ... rest of fields ...
    };
    codePath = 'main';
  }

  // === CRITICAL: Validate output from ALL code paths ===
  // This catches bugs in main derivation, deriveFallbackThumbnail(), and deriveEmptyThumbnail()
  // Defensive programming: trust but verify, especially for cross-module contracts
  const outputValidation = validateThumbnailOutput(thumbnail);
  if (!outputValidation.valid) {
    logger.error('[deriveThumbnail] Output validation failed:', {
      plot_title,
      code_path: codePath,
      errors: outputValidation.errors
    });
    // FAIL-SAFE: Return null to skip thumbnail emission entirely
    // The `if (result.thumbnail !== null)` guard in chatStream.js:363 handles this
    // Better to show no thumbnail than crash frontend with malformed data
    return null;
  }

  return {
    thumbnail,
    resultId
  };
}
```

Add to exports:
```javascript
export {
  // ... existing exports ...
  validateThumbnailOutput
};
```

---

### 4. Frontend Updates

**File**: `public/js/chat.js`

Replace `message_complete` handling with `message_start` / `message_end`:

```javascript
case 'message_start':
  this.currentMessageId = data.message_id;
  console.log('[Chat] Message started:', data.message_id);
  break;

case 'message_end':
  this.currentMessageId = null;
  // Clear status indicator (prevents stale "Thinking..." on tool-only/error-only turns)
  this.hideStatusIndicator();
  // CRITICAL: Only finalize if we actually streamed text this turn
  // This guard prevents three failure modes:
  // 1. Double-finalization on error path (handleError() already calls finalizeAssistantMessage() at chat.js:899)
  // 2. Clobbering previous messages on tool-only turns (no currentAssistantMessage was created)
  // 3. Finalizing empty messages on error-only responses (error shown, but no assistant text)
  if (this.currentAssistantMessage) {
    this.finalizeAssistantMessage();
  }
  this.enableInput();
  this.isProcessing = false;
  break;
```

**Why the guard is necessary** (detailed explanation):

1. **Error path double-finalization**: The existing `handleError()` method (chat.js:899) already calls `finalizeAssistantMessage()` when errors occur. Without this guard, `message_end` would call it again, causing duplicate finalization.

2. **Tool-only turns**: When the assistant only calls tools without streaming text (e.g., just `execute_sql` + `show_plot`), `currentAssistantMessage` is never created. The guard prevents trying to finalize a non-existent message.

3. **Error-only responses**: When an error occurs before any text is streamed, `currentAssistantMessage` is empty. The guard makes finalization a no-op in this case.

The guard is safe in all cases - it's idempotent when finalization already happened or when there's no message to finalize.

```javascript
case 'thumbnail_update':
  console.log('[v4.2.3] thumbnail_update:', {
    message_id: data.message_id,
    plot_title: data.plot_title,
    thumbnail: data.thumbnail
  });
  // TODO v4.2.4: Actually render thumbnail into message bubble
  break;
```

Remove the `message_complete` case entirely (no backward compatibility needed).

Add `currentMessageId` property to ChatController constructor:

```javascript
constructor() {
  // ... existing code ...
  this.currentMessageId = null;  // Track current assistant message ID
}
```

---

## SSE Event Flow Example

User asks: "Show me my vitamin D and cholesterol trends"

```
→ message_start { message_id: "abc-123" }
→ text { message_id: "abc-123", content: "I'll show you both..." }
→ tool_start { message_id: "abc-123", tool: "execute_sql", params: {...} }
→ tool_complete { message_id: "abc-123", tool: "execute_sql", duration_ms: 150 }
→ tool_start { message_id: "abc-123", tool: "show_plot", params: {...} }
→ plot_result { message_id: "abc-123", plot_title: "Vitamin D", rows: [...] }
→ thumbnail_update { message_id: "abc-123", plot_title: "Vitamin D", thumbnail: {...} }
→ tool_complete { message_id: "abc-123", tool: "show_plot", duration_ms: 50 }
→ [LLM calls another tool - recursive streamLLMResponse, SAME message_id]
→ tool_start { message_id: "abc-123", tool: "show_plot", params: {...} }
→ plot_result { message_id: "abc-123", plot_title: "Cholesterol", rows: [...] }
→ thumbnail_update { message_id: "abc-123", plot_title: "Cholesterol", thumbnail: {...} }
→ tool_complete { message_id: "abc-123", tool: "show_plot", duration_ms: 45 }
→ [LLM finishes with no more tool calls]
→ text { message_id: "abc-123", content: "Here are your trends..." }
→ message_end { message_id: "abc-123" }
```

Frontend infrastructure enabled (v4.2.3 implements #1, v4.2.4 implements #2-4):
1. Track `message_id` via `currentMessageId` property (v4.2.3 - implemented this PRD)
2. Create bubble on `message_start` with `data-message-id="abc-123"` (v4.2.4 - deferred)
3. Append text, show tool indicators to the bubble with matching `message_id` (v4.2.4 - deferred)
4. Insert both thumbnails into the same bubble by matching `message_id` (v4.2.4 - deferred)
5. Finalize bubble on `message_end` (v4.2.4 - deferred)

**IMPORTANT**: v4.2.3 does NOT create message bubbles on `message_start`. Current behavior (bubbles created when first `text` event arrives) is unchanged. This means tool-only responses will not have visible message bubbles yet. This is acceptable because v4.2.3 is infrastructure-only; v4.2.4 will implement the full UI.

---

## Frontend Fallback Behavior (Contract for v4.2.4)

When rendering thumbnails, frontend must handle null/missing optional fields gracefully:

| Field | If null/missing | Render |
|-------|-----------------|--------|
| `latest_value` | Hide "Latest: X" line | Show only sparkline and status |
| `unit_display` | Show value without unit | "42" instead of "42 ng/ml" |
| `delta_pct` | Hide delta section | No "↑ +34%" shown |
| `delta_direction` | Hide delta arrow | Just show percentage if `delta_pct` present |
| `delta_period` | Hide period | No "(5y)" shown |
| `focus_analyte_name` | Use `plot_title` | Title doubles as analyte name |

**Required fields are guaranteed** by backend validation. Frontend can assume:
- `plot_title` is always non-empty string
- `status` is always valid enum
- `sparkline.series` is always 1-30 finite numbers
- `point_count` and `series_count` are always >= 0

---

## Implementation Clarifications for Mid-Level Engineers

### message_end Emission Invariant

**Rule**: `message_end` is emitted **if and only if** `message_start` was successfully emitted to an open SSE connection (both `sseResponse` and `currentMessageId` are non-null at emit time).

**Implementation**: All `message_end` emission sites check `if (session.sseResponse && session.currentMessageId)` before emitting.

**Note on "received" vs "emitted"**: The server cannot verify client receipt in SSE (no acknowledgment mechanism). The dual guard ensures the server's *intent* to send both events when the connection was open. If the connection dies between `message_start` and `message_end`, the client's SSE error handler is responsible for cleanup.

**Why this guarantees the invariant** (case-by-case analysis):

| Case | Timeline | `message_start` emitted? | `message_end` emitted? | Invariant held? |
|------|----------|--------------------------|------------------------|-----------------|
| **1. Normal flow** | `currentMessageId` set → `message_start` sent → ... → `message_end` sent | ✅ Yes | ✅ Yes | ✅ Valid (paired) |
| **2. Disconnect BEFORE start** | `sseResponse = null` → `currentMessageId` set → `if (sseResponse)` fails | ❌ No | ❌ No (dual guard fails) | ✅ Valid (neither sent) |
| **3. Error BEFORE start** | Session invalid → `currentMessageId` never set → error handler checks dual guard | ❌ No | ❌ No (dual guard fails) | ✅ Valid (neither sent) |
| **4. Disconnect AFTER start** | `message_start` sent → `sseResponse = null` → `message_end` dual guard fails | ✅ Yes | ❌ No | ⚠️ **See note below** |

**Case 4 clarification ("interrupted turn")**:

This appears to violate the invariant, but it's actually **correct behavior**:
- The SSE connection is dead - client won't receive `message_end` anyway
- **The invariant applies to events the client RECEIVES**, not internal state
- From client perspective: Receives `message_start` → connection dies → frontend's `close` handler cleans up
- Emitting `message_end` to a dead connection would be pointless (and cause "write after end" errors)

**What the dual guard prevents**: Orphaned `message_end` without `message_start` (Cases 2-3), which would confuse the frontend.

**What the dual guard allows**: Interrupted turns (Case 4), which are **correctly handled** by frontend SSE reconnection logic.

**Why the dual guard is sufficient** (no `messageStarted` flag needed):

JavaScript's single-threaded execution model provides atomicity:

```javascript
// Line 279-282 in processMessage() - these lines run atomically (same tick)
session.currentMessageId = crypto.randomUUID();  // Synchronous
if (session.sseResponse) {                        // Synchronous check
  streamEvent(session.sseResponse, { ... });      // Synchronous call (writes to buffer)
}
```

The SSE close handler runs **asynchronously** (different tick):
```javascript
// Line 118 in SSE endpoint - runs in response to 'close' event
req.on('close', () => {
  session.sseResponse = null;  // Cannot interrupt lines 279-282
});
```

**Event loop guarantee**: The close handler **cannot** run between line 279 and line 282 because JavaScript doesn't yield control until the current synchronous execution completes.

**Result**: Either `sseResponse` is non-null for the entire atomic block (both guards pass), OR it's null before the block starts (both guards fail). There is no in-between state.

Adding an explicit `session.messageStarted = true` flag would:
- **Be redundant**: Tracks the same state as `currentMessageId !== null`
- **Increase complexity**: Must be set/cleared in lockstep with `currentMessageId`
- **Introduce bugs**: If the two flags desync (one true, one false), errors arise
- **Provide no additional safety**: The dual guard already covers all cases

**Accepted patterns**:
1. ✅ Single-line guard: `if (session.sseResponse && session.currentMessageId)` (preferred)
2. ✅ Nested guards: `if (session.sseResponse) { if (session.currentMessageId) { ... } }` (acceptable)
3. ❌ **Invalid**: `if (session.currentMessageId)` alone (missing disconnect guard)

### SSE Disconnection Behavior

**Question**: What happens when SSE is disconnected?

**Answer**:
- `session.sseResponse` is set to `null` in the close handler (see implementation guide section 1)
- `currentMessageId` is **still set and cleared** normally (maintains session state consistency)
- Events are **NOT written to the response** (guarded by two mechanisms):
  1. `session.sseResponse` is null, so conditional checks like `if (session.sseResponse)` prevent emission
  2. `streamEvent()` checks `res.writableEnded || res.destroyed` and drops events to closed responses
- This dual-guard approach provides defense-in-depth against "write after end" errors
- **Do not** remove either guard - both are necessary for robustness

**Example**:
```javascript
// Setting is unconditional (in processMessage)
session.currentMessageId = crypto.randomUUID();

// Emission is double-guarded
if (session.sseResponse) {  // Guard 1: null after disconnect
  streamEvent(session.sseResponse, { type: 'message_start', ... });
  // Guard 2: streamEvent() checks res.writableEnded || res.destroyed
}

// Clearing is unconditional (in message_end handler)
session.currentMessageId = null;
```

### Tool-Only Turns Without Text

**Question**: `message_start` is emitted even if no text follows. Won't this confuse the UI?

**Answer**:
- Yes, `message_start` fires for tool-only turns (e.g., only `execute_sql` + `show_plot`, no LLM text)
- **This is intentional** - `message_id` is needed to correlate tool events even without text
- **UI will NOT create a bubble** until v4.2.4 (frontend only tracks `currentMessageId` in v4.2.3)
- Current behavior: Bubbles only created when first `text` event arrives (unchanged from before)
- **Do not** try to "fix" the perceived missing UI update - v4.2.4 will implement bubble creation

**Why defer to v4.2.4**: Creating empty bubbles for tool-only turns requires careful UX design (where to show them, how to style them). V4.2.3 is backend infrastructure only.

### Complete Checklist of Events That Must Carry message_id

To avoid partial implementation, here's the exhaustive list of SSE event types:

| Event Type | Includes `message_id`? | Notes |
|------------|------------------------|-------|
| `session_start` | ❌ No | Session-level, no message context |
| `message_start` | ✅ Yes | Initiates a turn |
| `text` | ✅ Yes | Streaming assistant response |
| `tool_start` | ✅ Yes | Tool execution indicator |
| `tool_complete` | ✅ Yes | Tool completion indicator |
| `plot_result` | ✅ Yes | Display result (happy path only) |
| `thumbnail_update` | ✅ Yes | Thumbnail data (happy path only) |
| `table_result` | ✅ Yes | Display result (happy path only) |
| `message_end` | ✅ Yes | Finalizes a turn |
| `error` | ✅ Yes (if available) | `message_id: session.currentMessageId \|\| null` |
| `status` | ❌ No | Transport-level metadata (e.g., "Thinking...") |

**Critical**: Error events use `message_id: session.currentMessageId || null` because errors can occur before `message_start` is emitted (e.g., session not found at line 296).

---

## Test Plan

### Unit Tests

**Thumbnail Output Validation**:
- [ ] `validateThumbnailOutput()` passes for valid thumbnail
- [ ] Fails for missing `plot_title`
- [ ] Fails for invalid `status` enum
- [ ] Fails for empty `sparkline.series`
- [ ] Fails for > 30 sparkline values
- [ ] Fails for NaN/Infinity in sparkline
- [ ] Fails for negative `point_count`
- [ ] Allows null optional fields
- [ ] **NEW**: `deriveEmptyThumbnail()` output passes validation (all required fields present)
- [ ] **NEW**: `deriveFallbackThumbnail()` output passes validation (all required fields present)
- [ ] **NEW**: Validation runs for all code paths (main, fallback, empty) at return boundary

### Integration Tests

**SSE Event Flow**:
- [ ] `message_start` emitted once per user message (in `processMessage`)
- [ ] All events within turn share same `message_id` (including after tool execution)
- [ ] Recursive `streamLLMResponse()` calls reuse the same `message_id`
- [ ] `message_end` emitted exactly once when `toolCalls.length === 0`
- [ ] `message_end` emitted even if `assistantMessage` is empty
- [ ] Error events include `message_id` if available

**Multiple Plots**:
- [ ] Two `plot_result` events have same `message_id`
- [ ] Two `thumbnail_update` events have same `message_id`
- [ ] Both thumbnails can be correctly correlated to the same message via `message_id`

**Edge Cases**:
- [ ] Tool-only response (no text) still emits `message_end`
- [ ] Missing `plot_title` rejects tool call with error
- [ ] Invalid thumbnail output returns `null` (no thumbnail emitted, fail-safe behavior)
- [ ] Validation logs `code_path` field to identify which derivation path failed (main/fallback/empty)

**Error Paths**:
- [ ] Error originating in `streamLLMResponse()` propagates to `processMessage()` which emits `error` then `message_end`
- [ ] Error originating in `processMessage()` (before `streamLLMResponse()`) emits `error` with `message_id`, then `message_end`
- [ ] `streamLLMResponse()` catch does NOT emit SSE events (only logs and re-throws)
- [ ] `currentMessageId` cleared after error (not left stale)
- [ ] Frontend receives exactly one `error` then one `message_end` with same `message_id`
- [ ] Error before `message_start` emits `error` with `message_id: null` (no `message_end`)

### Manual QA

- [ ] Single plot query: thumbnail appears, correct message association
- [ ] Multi-plot query: both thumbnails in same message bubble
- [ ] Rapid queries: second query properly rejected with 409, first completes normally without cross-contamination
- [ ] Error during processing: error message associated with correct bubble
- [ ] Empty data: empty thumbnail with sparkline `[0]` renders without crash

---

## Acceptance Criteria

### Backend (chatStream.js)
- [ ] `res.locals.session` set in SSE stream endpoint (for `streamEvent` guard)
- [ ] `streamEvent()` includes guard against late events (drops events when `currentMessageId` is null)
- [ ] `streamEvent()` includes inline comment warning about invariant requirements (not generic utility)
- [ ] `message_start` emitted once in `processMessage()` (not `streamLLMResponse()`)
- [ ] `session.currentMessageId` set in `processMessage()`, persists across recursive calls
- [ ] `message_end` emitted when `toolCalls.length === 0` (regardless of `assistantMessage` content)
- [ ] `message_end` only emitted if BOTH `session.sseResponse` AND `session.currentMessageId` are present (dual guard prevents orphaned message_end)
- [ ] `message_end` emitted after `error` event on all error paths
- [ ] Session deletion mid-turn emits `SESSION_EXPIRED` error + `message_end` before returning
- [ ] All events include `message_id`: `text`, `tool_start`, `tool_complete`, `plot_result`, `thumbnail_update`, `table_result`
- [ ] **CRITICAL**: Invalid-data branch in `handleShowPlot()` (search for `'Invalid data format - expected array'`) includes `message_id` in both `plot_result` and `thumbnail_update` events
- [ ] **CRITICAL**: Invalid-data branch REMOVES existing `replace_previous: true` from `thumbnail_update` event at line 788 (not in contract, see section 1.2 for fix)
- [ ] Error events include `message_id` when available (null otherwise)
- [ ] `session.currentMessageId` cleared unconditionally after `message_end` (including error/disconnect paths)
- [ ] `handleShowPlot()` rejects tool calls with missing/empty `plot_title`
- [ ] `message_complete` event removed entirely
- [ ] `done` event replaced with `message_end` in iteration limit path (search for `'ITERATION_LIMIT_EXCEEDED'` in `streamLLMResponse()`)
- [ ] **Dead code removed**: `handleFinalQuery()` function in chatStream.js deleted entirely (lines 970-1096, see section 1.6 for verification steps)
  - **CRITICAL**: Only delete from `server/routes/chatStream.js`. Preserve handleFinalQuery in `server/services/agenticCore.js` and `server/services/agenticSqlGenerator.js` (active code for legacy endpoint)
- [ ] Existing error emission in `streamLLMResponse()` catch block removed to prevent duplicate error events (search for `'LLM_ERROR'` in catch block)
- [ ] Close handler sets `session.sseResponse = null` to prevent writes after disconnect
- [ ] Keepalive interval guards writes with `!res.writableEnded && !res.destroyed` check
- [ ] `streamEvent()` includes `res.writableEnded || res.destroyed` guard to prevent "write after end" errors

### Thumbnail Contract (thumbnailDerivation.js)
- [ ] `validateThumbnailOutput()` function exported
- [ ] Validation enforces required fields: `plot_title`, `status`, `sparkline.series`, `point_count`, `series_count`
- [ ] **CRITICAL**: Validation runs at return boundary of `deriveThumbnail()` to catch ALL code paths (main, fallback, empty)
- [ ] `codePath` variable tracks which derivation path for debugging (logged on validation failure)
- [ ] Invalid thumbnails return `null` (fail-safe, skips thumbnail emission entirely)
- [ ] All derived thumbnails pass validation (no NaN, Infinity, missing required fields) - verified by tests for `deriveEmptyThumbnail()`, `deriveFallbackThumbnail()`, and main derivation
- [ ] Validation failure logged at ERROR level with `code_path` field

### Frontend (chat.js)
- [ ] `message_start` handler sets `this.currentMessageId`
- [ ] `message_end` handler clears `this.currentMessageId`
- [ ] `message_end` handler calls `hideStatusIndicator()` to prevent stale "Thinking..." on tool-only/error-only turns
- [ ] `message_end` handler includes guard: only calls `finalizeAssistantMessage()` if `currentAssistantMessage` is non-empty
- [ ] Guard prevents clobbering previous messages on tool-only turns or error-only responses
- [ ] `message_complete` handler removed
- [ ] `done` handler removed
- [ ] `thumbnail_update` logs `message_id` for debugging

---

## Deployment Notes

### Release Coupling Requirement

This PRD changes the SSE event contract by removing `message_complete` and `done` events in favor of `message_end`. **Backend and frontend MUST be deployed together** (atomic deployment).

**Risk if deployed separately**:
- **Backend-only deployment** → Frontend stuck in "processing" state (input never re-enabled)
  - Root cause: Frontend `chat.js` lines 111-115 and 135-139 rely on `message_complete`/`done` to call `enableInput()` and clear `isProcessing` flag
  - User impact: Cannot send follow-up messages, appears frozen
  - Severity: **CRITICAL** - breaks core chat functionality
- **Frontend-only deployment** → `message_end` handler runs but backend still emits `message_complete`/`done`
  - User impact: Benign (frontend ignores unknown events via switch-case default)
  - Severity: **LOW** - no user-visible impact

**Recommended deployment strategy**:
1. **Preferred**: Deploy backend + frontend together in single atomic release
2. **If separate deployments required**: Deploy frontend first (degrades gracefully), then backend
3. **NEVER**: Deploy backend alone before frontend (breaks chat input)

**Why this is acceptable**: The conversational chat interface (PRD v3.2) is not in production. This is a development-only feature with no backward compatibility burden. Once v4.2.3 is deployed, future PRDs (v4.2.4+) will not have this coupling issue.

---

## Deferred to v4.2.4

- **Message bubble creation on `message_start`** (v4.2.3 only tracks `message_id`, doesn't create DOM)
- Frontend `ChatPlotThumbnail` component
- Sparkline SVG rendering
- Thumbnail insertion into message bubbles by `message_id`
- Click/hover interactions
- Thumbnail styling and animations

---

## Next PRD (v4.2.4)

- Frontend thumbnail rendering implementation
- Bubble DOM structure with `data-message-id` attribute
- Sparkline SVG component
- Thumbnail click to expand full plot
- Responsive thumbnail sizing
