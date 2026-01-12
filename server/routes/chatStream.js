// server/routes/chatStream.js
// Server-Sent Events (SSE) endpoint for conversational SQL assistant
// PRD: docs/PRD_v3_2_conversational_sql_assistant.md
//
// KNOWN LIMITATIONS (MVP):
// 1. SSE response stored in session object - not serializable, potential memory leak
//    TODO: Refactor to event emitter pattern or response registry
// 2. No timeout watchdog - relies on OpenAI's 10-minute default
//    TODO: Add Promise.race() timeout wrapper in production
// 3. No automatic reconnection on network failure
//    TODO: Implement exponential backoff reconnection in Phase 3
// 4. No rate limiting on /stream endpoint
//    TODO: Add per-IP session limits before production
//
// SAFETY MECHANISMS:
// - Iteration counter: MAX_CONVERSATION_ITERATIONS (50) prevents infinite loops
// - Atomic processing lock: tryAcquireLock() prevents race conditions
// - Session validation: checks session exists before recursive calls

import express from 'express';
import OpenAI from 'openai';
import crypto from 'crypto';
import { pool, queryWithUser, queryAsAdmin } from '../db/index.js';
import sessionManager from '../utils/sessionManager.js';
import { requireAuth } from '../middleware/auth.js';
import * as agenticCore from '../services/agenticCore.js';
import { TOOL_DEFINITIONS } from '../services/agenticTools.js';
import { getSchemaSnapshot } from '../services/schemaSnapshot.js';
import { buildSchemaSection } from '../services/promptBuilder.js';
import {
  preprocessData,
  deriveThumbnail,
  deriveEmptyThumbnail,
  validateThumbnailConfig,
  normalizeRowsForFrontend,
  ensureOutOfRangeField
} from '../utils/thumbnailDerivation.js';
// Note: validateSQL no longer needed here - display tools receive pre-fetched data (PRD v4.2.2)

const router = express.Router();

const NODE_ENV = process.env.NODE_ENV || 'development';

// Simple console logger (replacing pino for full visibility)
const logger = {
  info: (msgOrObj, msg) => {
    if (typeof msgOrObj === 'string') {
      console.log(`[INFO] ${msgOrObj}`, msg !== undefined ? JSON.stringify(msg, null, 2) : '');
    } else {
      console.log(`[INFO] ${msg}`, JSON.stringify(msgOrObj, null, 2));
    }
  },
  warn: (msgOrObj, msg) => {
    if (typeof msgOrObj === 'string') {
      console.warn(`[WARN] ${msgOrObj}`, msg !== undefined ? JSON.stringify(msg, null, 2) : '');
    } else {
      console.warn(`[WARN] ${msg}`, JSON.stringify(msgOrObj, null, 2));
    }
  },
  error: (msgOrObj, msg) => {
    if (typeof msgOrObj === 'string') {
      console.error(`[ERROR] ${msgOrObj}`, msg !== undefined ? JSON.stringify(msg, null, 2) : '');
    } else {
      console.error(`[ERROR] ${msg}`, JSON.stringify(msgOrObj, null, 2));
    }
  },
  debug: (msgOrObj, msg) => {
    if (typeof msgOrObj === 'string') {
      console.log(`[DEBUG] ${msgOrObj}`, msg !== undefined ? JSON.stringify(msg, null, 2) : '');
    } else {
      console.log(`[DEBUG] ${msg}`, JSON.stringify(msgOrObj, null, 2));
    }
  }
};

// Configuration
const CHAT_MODEL = process.env.CHAT_MODEL || process.env.SQL_GENERATOR_MODEL || 'gpt-4o-mini'; // Conversational chat model (defaults to SQL_GENERATOR_MODEL)
const MAX_CONVERSATION_ITERATIONS = 50; // Safety limit to prevent infinite loops
const MAX_TOKEN_THRESHOLD = parseInt(process.env.CHAT_MAX_TOKEN_THRESHOLD, 10) || 50000; // Token limit for conversation history pruning
const KEEP_RECENT_MESSAGES = parseInt(process.env.CHAT_KEEP_RECENT_MESSAGES, 10) || 20; // Number of messages to keep when pruning

// SQL Query Limits (from validator config)
const MAX_PLOT_ROWS = parseInt(process.env.SQL_VALIDATOR_PLOT_LIMIT, 10) || 10000;
const MAX_TABLE_ROWS = parseInt(process.env.SQL_VALIDATOR_TABLE_LIMIT, 10) || 50;

// ============================================================================
// SSE Registry (PRD v4.3)
// ============================================================================
// Stores SSE response objects keyed by sessionId
// Separate from sessionManager to allow clean reconnection (last-writer-wins)
const sseConnections = new Map(); // sessionId -> { res, session }

/**
 * Attach SSE connection to a session
 * PRD v4.3: Last-writer-wins policy for reconnection
 */
function attachSSE(sessionId, res, session) {
  const existing = sseConnections.get(sessionId);
  if (existing && existing.res && !existing.res.writableEnded) {
    // Close previous connection (last-writer-wins)
    logger.info('[chatStream] Closing previous SSE connection:', { session_id: sessionId });
    try {
      existing.res.end();
    } catch (e) {
      logger.warn('[chatStream] Error closing previous SSE:', { error: e.message });
    }
  }

  sseConnections.set(sessionId, { res, session });
  logger.info('[chatStream] SSE attached:', { session_id: sessionId });
}

/**
 * Get SSE connection for a session
 */
function getSSEConnection(sessionId) {
  return sseConnections.get(sessionId);
}

/**
 * Close and remove SSE connection for a session
 * PRD v4.3: Called by sessionManager.onSessionExpired hook
 */
function closeSSEConnection(sessionId) {
  const connection = sseConnections.get(sessionId);
  if (connection && connection.res) {
    try {
      if (!connection.res.writableEnded && !connection.res.destroyed) {
        // Send session_expired event before closing
        connection.res.write(`data: ${JSON.stringify({ type: 'session_expired', reason: 'Session timed out' })}\n\n`);
        connection.res.end();
      }
    } catch (e) {
      logger.warn('[chatStream] Error closing SSE on expiry:', { error: e.message });
    }
  }
  sseConnections.delete(sessionId);
  logger.info('[chatStream] SSE connection closed:', { session_id: sessionId });
}

// Export closeSSEConnection for app.js to wire cleanup hook
export { closeSSEConnection };

let openAiClient;

/**
 * Get OpenAI client
 */
const getOpenAiClient = () => {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OpenAI API key is not configured');
  }

  if (!openAiClient) {
    openAiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 120000,
    });
  }

  return openAiClient;
};

/**
 * Send SSE event
 * PRD v4.3: Changed signature from streamEvent(res, data) to streamEvent(sessionId, data)
 * Uses SSE registry to lookup response object
 */
function streamEvent(sessionId, data) {
  const connection = sseConnections.get(sessionId);
  if (!connection) {
    logger.warn('[chatStream] No SSE connection for session:', { session_id: sessionId });
    return;
  }

  const { res, session } = connection;

  // Guard 1: Drop events with message_id if message already ended
  if (data.message_id && session && !session.currentMessageId) {
    logger.warn('[chatStream] Dropping event after message_end:', {
      type: data.type,
      message_id: data.message_id,
      session_id: session.id
    });
    return;
  }

  // Guard 2: Don't write to closed/destroyed response (prevents "write after end" errors)
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

// PRD v4.3: extractPatientId() function REMOVED
// Patient selection now happens before chat starts via POST /api/chat/sessions

/**
 * POST /api/chat/sessions
 * PRD v4.3: Create session with selected patient ID
 * PRD v4.4.3: Add requireAuth and store userId for session ownership
 * PRD v5.0: Add initial_context for onboarding
 */
router.post('/sessions', requireAuth, async (req, res) => {
  const { selectedPatientId, initial_context } = req.body;

  // Validate patient ID format if provided
  if (selectedPatientId) {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(selectedPatientId)) {
      return res.status(400).json({
        error: 'Invalid patient ID format',
        code: 'INVALID_PATIENT_ID'
      });
    }

    // PRD v4.4.6: Use conditional query function based on admin status
    // Admin users can access any patient; regular users are RLS-filtered
    const queryFn = req.user.is_admin
      ? (sql, params) => queryAsAdmin(sql, params)
      : (sql, params) => queryWithUser(sql, params, req.user.id);

    try {
      const result = await queryFn(
        'SELECT id FROM patients WHERE id = $1',
        [selectedPatientId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({
          error: 'Patient not found',
          code: 'PATIENT_NOT_FOUND'
        });
      }
    } catch (error) {
      logger.error('[chatStream] Error verifying patient:', { error: error.message });
      return res.status(500).json({
        error: 'Failed to verify patient',
        code: 'DATABASE_ERROR'
      });
    }
  }

  // Create session
  const session = sessionManager.createSession();

  // PRD v4.4.3: Store user ID for session ownership validation
  session.userId = req.user.id;

  // PRD v4.4.6: Store admin status for tool executions
  session.isAdmin = req.user.is_admin || false;

  // Set selected patient
  if (selectedPatientId) {
    session.selectedPatientId = selectedPatientId;
  }

  // PRD v5.0: Store initial_context for onboarding (NOT in messages array yet)
  // This will be injected AFTER initializeSystemPrompt() runs
  if (initial_context) {
    session.initialContext = initial_context;
    logger.info({ userId: req.user.id, event: 'onboarding_context_stored' });
  }

  logger.info('[chatStream] Session created:', {
    session_id: session.id,
    user_id: req.user.id,
    is_admin: session.isAdmin,
    selected_patient_id: selectedPatientId || null
  });

  res.json({
    sessionId: session.id,
    selectedPatientId: selectedPatientId || null
  });
});

/**
 * HEAD /api/chat/sessions/:sessionId/validate
 * PRD v4.3: Preflight validation before SSE connection
 * PRD v4.4.3: Add requireAuth and session ownership check
 * Uses peekSession() to avoid extending TTL
 */
router.head('/sessions/:sessionId/validate', requireAuth, (req, res) => {
  const { sessionId } = req.params;

  const session = sessionManager.peekSession(sessionId);
  if (!session) {
    return res.status(404).end();
  }

  // PRD v4.4.3: Verify session ownership
  if (session.userId !== req.user.id) {
    return res.status(404).end(); // 404 to prevent enumeration
  }

  res.status(200).end();
});

/**
 * GET /api/chat/stream
 * Open SSE connection to existing session
 * PRD v4.3: Requires sessionId query parameter (session created via POST /sessions)
 * PRD v4.4.3: Add requireAuth and session ownership check
 */
router.get('/stream', requireAuth, (req, res) => {
  const { sessionId } = req.query;

  // Validate sessionId parameter
  if (!sessionId) {
    return res.status(400).json({
      error: 'sessionId query parameter is required',
      code: 'INVALID_REQUEST'
    });
  }

  // Get existing session
  const session = sessionManager.getSession(sessionId);
  if (!session) {
    return res.status(404).json({
      error: 'Session not found',
      code: 'SESSION_NOT_FOUND'
    });
  }

  // PRD v4.4.3: Verify session ownership
  if (session.userId !== req.user.id) {
    return res.status(404).json({
      error: 'Session not found',
      code: 'SESSION_NOT_FOUND'
    });
  }

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no' // Disable nginx buffering
  });

  // PRD v4.3: Use SSE registry instead of storing in session
  attachSSE(sessionId, res, session);

  // Send session_start event (confirms SSE attachment to existing session)
  streamEvent(sessionId, {
    type: 'session_start',
    sessionId: session.id,
    selectedPatientId: session.selectedPatientId
  });

  logger.info('[chatStream] SSE connection established:', {
    session_id: session.id,
    selected_patient_id: session.selectedPatientId
  });

  // Handle client disconnect
  req.on('close', () => {
    // PRD v4.3: Clean up SSE registry
    sseConnections.delete(sessionId);
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

/**
 * POST /api/chat/messages
 * Submit user message to session
 * PRD v4.4.3: Add requireAuth and session ownership check
 */
router.post('/messages', requireAuth, async (req, res) => {
  const { sessionId, message } = req.body;

  if (!sessionId || !message) {
    return res.status(400).json({
      error: 'sessionId and message are required',
      code: 'INVALID_REQUEST'
    });
  }

  // Get session
  const session = sessionManager.getSession(sessionId);
  if (!session) {
    return res.status(404).json({
      error: 'Session not found',
      code: 'SESSION_NOT_FOUND'
    });
  }

  // PRD v4.4.3: Verify session ownership
  if (session.userId !== req.user.id) {
    return res.status(404).json({
      error: 'Session not found',
      code: 'SESSION_NOT_FOUND'
    });
  }

  // Atomic check-and-set for processing lock (prevents race conditions)
  if (!sessionManager.tryAcquireLock(sessionId)) {
    return res.status(409).json({
      error: 'Session is currently processing a message',
      code: 'SESSION_BUSY'
    });
  }

  // Acknowledge message received
  res.json({ ok: true });

  // Process message asynchronously
  setImmediate(async () => {
    await processMessage(sessionId, message);
  });
});

/**
 * DELETE /api/chat/sessions/:sessionId
 * Manually clear conversation
 * PRD v4.3: Idempotent - returns 200 OK even if session doesn't exist
 * PRD v4.4.3: Add requireAuth and session ownership check
 */
router.delete('/sessions/:sessionId', requireAuth, (req, res) => {
  const { sessionId } = req.params;

  // PRD v4.4.3: Verify session ownership before deletion
  const session = sessionManager.peekSession(sessionId);
  if (session && session.userId !== req.user.id) {
    // Session exists but doesn't belong to user - return idempotent success
    // This prevents enumeration while maintaining idempotent behavior
    return res.json({
      ok: true,
      message: 'Session not found (already cleared)'
    });
  }

  // PRD v4.3: Also clean up SSE connection
  closeSSEConnection(sessionId);

  const existed = sessionManager.deleteSession(sessionId);

  // PRD v4.3: Idempotent - always return success
  res.json({
    ok: true,
    message: existed ? 'Session cleared' : 'Session not found (already cleared)'
  });
});

/**
 * Process user message and stream response
 */
async function processMessage(sessionId, userMessage) {
  const session = sessionManager.getSession(sessionId);
  if (!session) {
    logger.error('[chatStream] Session not found during processing:', { session_id: sessionId });
    return;
  }

  try {
    // PRD v4.4.6: Use conditional query function based on admin status stored in session
    const isAdmin = session.isAdmin || false;
    const queryFn = isAdmin
      ? (sql, params) => queryAsAdmin(sql, params)
      : (sql, params) => queryWithUser(sql, params, session.userId);

    // PRD v4.3: Recompute patient count per-message (NOT cached in session)
    // Security: Prevents data leak if patient is added after session creation
    const countResult = await queryFn(
      'SELECT COUNT(*) as count FROM patients',
      []
    );
    const currentPatientCount = parseInt(countResult.rows[0].count, 10);

    // PRD v4.3: Verify selected patient still exists (409 handling)
    if (session.selectedPatientId) {
      const patientExists = await queryFn(
        'SELECT 1 FROM patients WHERE id = $1',
        [session.selectedPatientId]
      );

      if (patientExists.rows.length === 0) {
        logger.warn('[chatStream] Selected patient no longer exists:', {
          session_id: sessionId,
          patient_id: session.selectedPatientId
        });

        // Emit patient_unavailable SSE event
        streamEvent(session.id, {
          type: 'patient_unavailable',
          sessionId: session.id,
          selectedPatientId: session.selectedPatientId,
          message: 'Selected patient is no longer available. Start a new chat.'
        });

        // Close SSE and delete session
        closeSSEConnection(session.id);
        sessionManager.deleteSession(session.id);

        // Note: 409 response is handled by POST /messages endpoint, not here
        // This function is called async, so we just return after cleanup
        return;
      }
    }

    // Add user message to conversation
    sessionManager.addMessage(sessionId, 'user', userMessage);

    // Initialize system prompt on first message
    if (session.messages.length === 1) {
      // PRD v5.0: Extract onboarding context for injection
      const onboardingContext = session.initialContext || null;
      if (onboardingContext) {
        logger.info({ sessionId: session.id, event: 'onboarding_context_will_be_injected' });
      }

      await initializeSystemPrompt(session, { onboardingContext });

      // Delete context AFTER successful initialization (prevents loss on retry if init fails)
      if (onboardingContext) {
        delete session.initialContext;
      }
    }

    // PRD v4.3: Patient selection now happens before chat starts (via POST /api/chat/sessions)
    // No need for runtime patient selection parsing

    // Create message_id for this assistant turn
    // NOTE: Set unconditionally (even if sseResponse is null) to maintain state consistency
    // Clearing is also unconditional in all exit paths (normal, error, session deletion)
    session.currentMessageId = crypto.randomUUID();

    // Emit message_start (PRD v4.3: streamEvent handles missing connections)
    streamEvent(session.id, {
      type: 'message_start',
      message_id: session.currentMessageId
    });

    // Start LLM streaming (may recurse, but reuses same message_id)
    // PRD v4.3: Pass currentPatientCount for tool-level scope enforcement
    await streamLLMResponse(session, currentPatientCount);

  } catch (error) {
    // Full error logging for debugging
    console.error('[chatStream] FULL ERROR DETAILS:');
    console.error(error);

    logger.error('[chatStream] Error processing message:', {
      session_id: sessionId,
      error: error.message,
      stack: error.stack
    });

    // Send error to client (PRD v4.3: streamEvent handles missing connections)
    // Error event with message_id for correlation
    streamEvent(session.id, {
      type: 'error',
      message_id: session.currentMessageId || null,
      code: 'PROCESSING_ERROR',
      message: 'Failed to process message. Please try again.',
      debug: NODE_ENV === 'development' ? error.message : undefined
    });

    // Always finalize the turn after error (if message was started)
    if (session.currentMessageId) {
      streamEvent(session.id, {
        type: 'message_end',
        message_id: session.currentMessageId
      });
    }

    // CRITICAL: Always clear message ID unconditionally
    // This prevents state leakage even when:
    // - SSE connection is lost
    // - Error occurs before message_start was emitted
    // - Session is deleted or invalidated mid-turn
    session.currentMessageId = null;

  } finally {
    // Release processing lock
    if (sessionManager.getSession(sessionId)) {
      sessionManager.releaseLock(sessionId);
    }
  }
}

/**
 * Initialize system prompt with schema and patient context
 * PRD v4.3: Uses chat mode with pre-selected patient ID
 * PRD v4.4.3: Pass userId for RLS context
 * PRD v4.4.6: Pass isAdmin for admin mode support
 * PRD v5.0: Accepts optional onboardingContext to merge into primary system prompt
 * @param {object} session - Session object
 * @param {object} options - Optional parameters
 * @param {object|null} options.onboardingContext - Onboarding context object { insight, report_ids, patient_name }
 */
async function initializeSystemPrompt(session, { onboardingContext = null } = {}) {
  // Get schema snapshot and format it
  const { manifest } = await getSchemaSnapshot();
  const schemaContext = buildSchemaSection(manifest, ''); // Empty question = include all tables

  // PRD v4.3: Use chat mode with selectedPatientId (set by POST /api/chat/sessions)
  // PRD v4.4.3: Pass userId for RLS context
  // PRD v4.4.6: Pass isAdmin for admin mode
  const { prompt } = await agenticCore.buildSystemPrompt(
    schemaContext,
    20, // maxIterations
    'chat', // mode
    session.selectedPatientId, // Pre-selected patient ID (can be null for schema-only queries)
    session.userId, // PRD v4.4.3: User ID for RLS context
    session.isAdmin || false // PRD v4.4.6: Admin mode flag
  );

  // PRD v5.0: Prepend onboarding context to system prompt if provided
  // This ensures the context survives conversation pruning (only first system message is preserved)
  // NOTE: onboardingContext is an object { insight, report_ids, patient_name, lab_data }
  let finalPrompt = prompt;
  if (onboardingContext && onboardingContext.insight) {
    // Format lab data as markdown table for LLM readability
    let labDataSection = '';
    if (onboardingContext.lab_data && Array.isArray(onboardingContext.lab_data) && onboardingContext.lab_data.length > 0) {
      // Helper to escape pipe characters that would break markdown table
      const escapeTableCell = (val) => val != null ? String(val).replace(/\|/g, '\\|') : '-';

      const tableRows = onboardingContext.lab_data.map(p => {
        const status = p.is_value_out_of_range ? '⚠️ OUT OF RANGE' : 'Normal';
        // Use ?? for result (preserves 0), || for strings (empty string → '-')
        const name = escapeTableCell(p.parameter_name || null);
        const result = escapeTableCell(p.result ?? null);
        const unit = escapeTableCell(p.unit || null);
        const ref = escapeTableCell(p.reference_interval || null);
        return `| ${name} | ${result} | ${unit} | ${ref} | ${status} |`;
      }).join('\n');

      labDataSection = `

### Pre-loaded Lab Results

| Parameter | Value | Unit | Reference | Status |
|-----------|-------|------|-----------|--------|
${tableRows}
`;
    }

    const onboardingPrefix = `## Onboarding Context

The user just completed their first upload and received this personalized insight:

${onboardingContext.insight}
${labDataSection}
They are now asking a follow-up question. You have the lab data above - use it to answer specific questions about values without needing to execute SQL. For complex queries, trend analysis, or data not shown above, you may still use SQL tools.

---

`;
    finalPrompt = onboardingPrefix + prompt;
    logger.info({
      sessionId: session.id,
      event: 'onboarding_context_merged_into_system_prompt',
      lab_data_count: onboardingContext.lab_data?.length || 0
    });
  }

  // Add system message (single system message, survives pruning)
  session.messages.unshift({
    role: 'system',
    content: finalPrompt
  });

  logger.info('[chatStream] System prompt initialized:', {
    session_id: session.id,
    selected_patient_id: session.selectedPatientId,
    has_onboarding_context: !!onboardingContext
  });
}

/**
 * Stream LLM response with tool calling
 * @param {object} session - Session object with conversation state
 * @param {number} patientCount - PRD v4.3: Current patient count for scope enforcement
 */
async function streamLLMResponse(session, patientCount = 0) {
  // Safety check: verify session still exists (could be deleted by timeout/disconnect)
  if (!sessionManager.getSession(session.id)) {
    logger.warn('[chatStream] Session deleted during processing:', {
      session_id: session.id
    });

    // PRD v4.3: Emit terminal events (streamEvent handles missing connections)
    // Error event (if message was started)
    if (session.currentMessageId) {
      streamEvent(session.id, {
        type: 'error',
        message_id: session.currentMessageId,
        code: 'SESSION_EXPIRED',
        message: 'Session expired. Please refresh and try again.',
        debug: NODE_ENV === 'development' ? 'Session deleted mid-turn' : undefined
      });

      // Finalize the turn
      streamEvent(session.id, {
        type: 'message_end',
        message_id: session.currentMessageId
      });
    }

    // Always clear message ID
    session.currentMessageId = null;
    return;
  }

  // Safety limit: prevent infinite tool-calling loops
  session.iterationCount = (session.iterationCount || 0) + 1;
  if (session.iterationCount > MAX_CONVERSATION_ITERATIONS) {
    logger.error('[chatStream] Iteration limit exceeded:', {
      session_id: session.id,
      iteration_count: session.iterationCount,
      max_iterations: MAX_CONVERSATION_ITERATIONS
    });

    // PRD v4.3: streamEvent handles missing connections
    // Error event with message_id
    streamEvent(session.id, {
      type: 'error',
      message_id: session.currentMessageId || null,
      code: 'ITERATION_LIMIT_EXCEEDED',
      message: 'Conversation became too complex. Please start a new conversation.',
      debug: NODE_ENV === 'development' ? `Exceeded ${MAX_CONVERSATION_ITERATIONS} iterations` : undefined
    });

    // Emit message_end if message was started
    if (session.currentMessageId) {
      streamEvent(session.id, {
        type: 'message_end',
        message_id: session.currentMessageId
      });
    }

    // CRITICAL: Always clear message ID (unconditional)
    session.currentMessageId = null;

    // Close SSE connection before deleting session to avoid dangling connection
    closeSSEConnection(session.id);
    sessionManager.deleteSession(session.id);
    return;
  }

  const client = getOpenAiClient();

  // IMPORTANT: Prune conversation before making API call
  pruneConversationIfNeeded(session);

  // Send status: preparing to call LLM (PRD v4.3: streamEvent handles missing connections)
  streamEvent(session.id, {
    type: 'status',
    status: 'thinking',
    message: 'Thinking...'
  });

  try {
    const stream = await client.chat.completions.create({
      model: CHAT_MODEL,
      messages: session.messages,
      tools: TOOL_DEFINITIONS,
      tool_choice: 'auto',
      stream: true,
    });

    let assistantMessage = '';
    let toolCalls = [];
    let currentToolCall = null;

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;

      if (!delta) continue;

      // Handle text content
      if (delta.content) {
        assistantMessage += delta.content;
        // Stream text to client (PRD v4.3: streamEvent handles missing connections)
        streamEvent(session.id, {
          type: 'text',
          message_id: session.currentMessageId,
          content: delta.content
        });
      }

      // Handle tool calls
      if (delta.tool_calls) {
        for (const toolCallDelta of delta.tool_calls) {
          const index = toolCallDelta.index;

          if (!toolCalls[index]) {
            toolCalls[index] = {
              id: toolCallDelta.id || '',
              type: 'function',
              function: {
                name: toolCallDelta.function?.name || '',
                arguments: toolCallDelta.function?.arguments || ''
              }
            };
            currentToolCall = toolCalls[index];
          } else {
            // Append to existing tool call
            if (toolCallDelta.function?.arguments) {
              toolCalls[index].function.arguments += toolCallDelta.function.arguments;
            }
          }
        }
      }
    }

    // Add assistant message to conversation
    if (assistantMessage || toolCalls.length > 0) {
      const message = {
        role: 'assistant',
        content: assistantMessage || null
      };

      if (toolCalls.length > 0) {
        message.tool_calls = toolCalls;
      }

      // Log assistant message content for debugging markdown
      if (assistantMessage) {
        logger.info('[chatStream] Assistant message:', {
          session_id: session.id,
          content_length: assistantMessage.length,
          content_preview: assistantMessage.substring(0, 500),
          has_bold: assistantMessage.includes('**'),
          has_italic: assistantMessage.includes('_') || assistantMessage.includes('*'),
          has_list: assistantMessage.includes('\n- ') || assistantMessage.includes('\n* ')
        });
      }

      session.messages.push(message);
    }

    // Execute tool calls
    if (toolCalls.length > 0) {
      // PRD v4.3: Pass patientCount for scope enforcement
      await executeToolCalls(session, toolCalls, patientCount);
      // Note: executeToolCalls will call streamLLMResponse recursively
      // The recursive call will eventually hit toolCalls.length === 0
    } else {
      // === Turn complete - ALWAYS emit message_end ===
      // PRD v4.3: streamEvent handles missing connections
      if (session.currentMessageId) {
        streamEvent(session.id, {
          type: 'message_end',
          message_id: session.currentMessageId
        });
      }

      // CRITICAL: Always clear messageId, even if SSE unavailable
      // Keeps session state clean for next turn and prevents double emission
      session.currentMessageId = null;
    }

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
}

/**
 * Execute tool calls and continue conversation
 * @param {number} patientCount - PRD v4.3: Current patient count for scope enforcement
 */
async function executeToolCalls(session, toolCalls, patientCount = 0) {
  for (const toolCall of toolCalls) {
    const toolName = toolCall.function.name;
    const toolCallId = toolCall.id;

    let params;
    try {
      params = JSON.parse(toolCall.function.arguments);
    } catch (error) {
      logger.error('[chatStream] Failed to parse tool arguments:', {
        session_id: session.id,
        tool_name: toolName,
        error: error.message,
        stack: error.stack
      });

      session.messages.push({
        role: 'tool',
        tool_call_id: toolCallId,
        content: JSON.stringify({ error: 'Invalid tool arguments format' })
      });
      continue;
    }

    logger.info('[chatStream] Executing tool:', {
      session_id: session.id,
      tool_name: toolName,
      params
    });

    // Send tool_start event (PRD v4.3: streamEvent handles missing connections)
    streamEvent(session.id, {
      type: 'tool_start',
      message_id: session.currentMessageId,
      tool: toolName,
      params
    });

    const toolStartTime = Date.now();

    // Handle display tools (show_plot, show_table) - don't end conversation
    if (toolName === 'show_plot') {
      await handleShowPlot(session, params, toolCallId);
      // Send tool_complete event
      streamEvent(session.id, {
        type: 'tool_complete',
        message_id: session.currentMessageId,
        tool: toolName,
        duration_ms: Date.now() - toolStartTime
      });
      continue; // Continue to next tool or LLM response
    }

    if (toolName === 'show_table') {
      await handleShowTable(session, params, toolCallId);
      // Send tool_complete event
      streamEvent(session.id, {
        type: 'tool_complete',
        message_id: session.currentMessageId,
        tool: toolName,
        duration_ms: Date.now() - toolStartTime
      });
      continue; // Continue to next tool or LLM response
    }

    // Execute other tools (fuzzy search, exploratory SQL)
    try {
      // PRD v4.4.3: Pass userId for RLS context
      // PRD v4.4.6: Pass isAdmin for admin mode support
      const result = await agenticCore.executeToolCall(toolName, params, {
        schemaSnapshotId: null, // TODO: track schema snapshot in session
        // PRD v4.3: Pass patient context for scope enforcement (patientCount from parameter, not session)
        selectedPatientId: session.selectedPatientId || null,
        patientCount: patientCount,
        userId: session.userId, // PRD v4.4.3: User ID for RLS context
        isAdmin: session.isAdmin || false // PRD v4.4.6: Admin mode flag
      });

      const toolDuration = Date.now() - toolStartTime;

      // Send tool_complete event (PRD v4.3: streamEvent handles missing connections)
      streamEvent(session.id, {
        type: 'tool_complete',
        message_id: session.currentMessageId,
        tool: toolName,
        duration_ms: toolDuration
      });

      // Add tool result to conversation
      session.messages.push({
        role: 'tool',
        tool_call_id: toolCallId,
        content: JSON.stringify(result)
      });

      // Cache last execute_sql result for display tool fallbacks
      if (toolName === 'execute_sql' && result && Array.isArray(result.rows)) {
        session.lastExecuteSqlResult = result;
      }

    } catch (error) {
      logger.error('[chatStream] Tool execution failed:', {
        session_id: session.id,
        tool_name: toolName,
        error: error.message,
        stack: error.stack
      });

      // Send tool_complete with error (PRD v4.3: streamEvent handles missing connections)
      streamEvent(session.id, {
        type: 'tool_complete',
        message_id: session.currentMessageId,
        tool: toolName,
        duration_ms: Date.now() - toolStartTime,
        error: error.message,
        debug: NODE_ENV === 'development' ? error.stack : undefined
      });

      session.messages.push({
        role: 'tool',
        tool_call_id: toolCallId,
        content: JSON.stringify({ error: error.message })
      });
    }
  }

  // Continue conversation (make another LLM call)
  // Safety check: verify session still exists before recursion
  if (!sessionManager.getSession(session.id)) {
    logger.warn('[chatStream] Session deleted during tool execution:', {
      session_id: session.id
    });

    // PRD v4.3: Emit terminal events (streamEvent handles missing connections)
    // Error event (if message was started)
    if (session.currentMessageId) {
      streamEvent(session.id, {
        type: 'error',
        message_id: session.currentMessageId,
        code: 'SESSION_EXPIRED',
        message: 'Session expired. Please refresh and try again.',
        debug: NODE_ENV === 'development' ? 'Session deleted mid-turn' : undefined
      });

      // Finalize the turn
      streamEvent(session.id, {
        type: 'message_end',
        message_id: session.currentMessageId
      });
    }

    // Always clear message ID
    session.currentMessageId = null;
    return;
  }

  // PRD v4.3: Pass patientCount to recursive call
  await streamLLMResponse(session, patientCount);
}

/**
 * Remove previous display results (plot/table) from session messages
 * Keeps all other tool messages (fuzzy_search, etc.) to maintain conversation integrity
 * CRITICAL: Also removes assistant messages with orphaned tool_calls to prevent OpenAI API errors
 * @param {Object} session - Session object with messages array
 * @returns {number} Number of messages removed
 */
function removeDisplayResults(session) {
  const beforeCount = session.messages.length;
  const beforeRoles = session.messages.map(m => `${m.role}${m.tool_calls ? '[tc]' : ''}${m.tool_call_id ? `[${m.tool_call_id.slice(0, 8)}]` : ''}`);

  // Step 1: Find tool_call_ids of display results we want to remove
  const removedToolCallIds = new Set();
  session.messages.forEach(msg => {
    if (msg.role === 'tool' && msg.tool_call_id) {
      try {
        const content = JSON.parse(msg.content);
        if (content.display_type === 'plot' || content.display_type === 'table') {
          removedToolCallIds.add(msg.tool_call_id);
        }
      } catch {
        // Keep malformed messages
      }
    }
  });

  // Step 2: Filter out display tool messages AND assistant messages with orphaned tool_calls
  session.messages = session.messages.filter(msg => {
    // Remove tool messages with display_type
    if (msg.role === 'tool') {
      try {
        const content = JSON.parse(msg.content);
        if (!content.display_type) return true; // Keep non-display tools
        return content.display_type !== 'plot' && content.display_type !== 'table';
      } catch {
        return true; // Keep malformed
      }
    }

    // Remove assistant messages that have tool_calls pointing to removed tool responses
    if (msg.role === 'assistant' && msg.tool_calls) {
      // If ALL tool_calls in this message are being removed, remove the entire message
      const allToolCallsRemoved = msg.tool_calls.every(tc => removedToolCallIds.has(tc.id));
      if (allToolCallsRemoved) {
        return false; // Remove this assistant message
      }
    }

    return true; // Keep all other messages
  });

  const afterRoles = session.messages.map(m => `${m.role}${m.tool_calls ? '[tc]' : ''}${m.tool_call_id ? `[${m.tool_call_id.slice(0, 8)}]` : ''}`);

  console.log('[chatStream] BEFORE FILTER:', beforeRoles);
  console.log('[chatStream] AFTER FILTER:', afterRoles);
  console.log('[chatStream] REMOVED:', beforeCount - session.messages.length, 'messages');

  return beforeCount - session.messages.length;
}

/**
 * Handle show_plot tool call
 * PRD v4.2.2: Receives pre-fetched data from LLM (no SQL execution here)
 * Unified tool: handles both plot display and optional thumbnail derivation
 * Does NOT end conversation
 */
async function handleShowPlot(session, params, toolCallId) {
  const { data, plot_title, replace_previous = false, thumbnail: thumbnailConfig } = params;
  const fallbackRows = Array.isArray(session?.lastExecuteSqlResult?.rows)
    ? session.lastExecuteSqlResult.rows
    : [];
  const effectiveData = Array.isArray(data) && data.length > 0
    ? data
    : fallbackRows;
  // PRD v4.3: Using session.id for streamEvent calls (SSE registry pattern)

  // Guard against missing plot_title
  if (!plot_title || typeof plot_title !== 'string' || plot_title.trim() === '') {
    logger.warn('[handleShowPlot] Missing or invalid plot_title:', {
      session_id: session.id,
      plot_title,
      plot_title_type: typeof plot_title
    });

    // Emit user-visible error (LLM typically retries with correct parameters)
    streamEvent(session.id, {
      type: 'error',
      message_id: session.currentMessageId || null,
      code: 'INVALID_TOOL_PARAMS',
      message: 'Plot generation failed due to missing title. Retrying...',
      debug: NODE_ENV === 'development' ? 'plot_title is required' : undefined
    });

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

  // Step 1: Guard against invalid data type (defensive against schema validation failures)
  if (!Array.isArray(effectiveData)) {
    logger.warn('[handleShowPlot] Invalid data type:', {
      session_id: session.id,
      plot_title,
      data_type: typeof effectiveData,
      data_is_null: effectiveData === null
    });

    // PRD v4.3: streamEvent handles missing connections
    streamEvent(session.id, {
      type: 'plot_result',
      message_id: session.currentMessageId,
      plot_title,
      rows: [],
      replace_previous: true
    });

    if (thumbnailConfig) {
      streamEvent(session.id, {
        type: 'thumbnail_update',
        message_id: session.currentMessageId,
        plot_title,
        result_id: crypto.randomUUID(),
        thumbnail: deriveEmptyThumbnail(plot_title)
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
  const preprocessed = preprocessData(effectiveData);

  // Step 3: Normalize timestamps to epoch ms
  const normalizedRows = normalizeRowsForFrontend(preprocessed);

  // Step 4: Compute is_out_of_range/is_value_out_of_range if missing (backward compat)
  const rowsWithOutOfRange = ensureOutOfRangeField(normalizedRows);

  // Step 5: Emit plot_result (always, even if data is empty after filtering)
  // PRD v4.3: streamEvent handles missing connections
  streamEvent(session.id, {
    type: 'plot_result',
    message_id: session.currentMessageId,
    plot_title,
    rows: rowsWithOutOfRange,
    replace_previous: replace_previous || false
  });

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

    if (result) {
      logger.info('[handleShowPlot] Emitting thumbnail_update:', {
        plot_title,
        result_id: result.resultId,
        thumbnail: result.thumbnail
      });

      // PRD v4.3: streamEvent handles missing connections
      streamEvent(session.id, {
        type: 'thumbnail_update',
        message_id: session.currentMessageId,
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

  logger.info('[handleShowPlot] completed:', {
    session_id: session.id,
    plot_title,
    raw_count: effectiveData.length,
    preprocessed_count: preprocessed.length,
    has_thumbnail: !!thumbnailConfig
  });
}

/**
 * Handle show_table tool call
 * PRD v4.2.2: Receives pre-fetched data from LLM (no SQL execution here)
 * Sends data to frontend for display, adds to conversation history
 * Does NOT end conversation
 */
async function handleShowTable(session, params, toolCallId) {
  const { data, table_title, replace_previous = false } = params;
  const startTime = Date.now();
  const fallbackRows = Array.isArray(session?.lastExecuteSqlResult?.rows)
    ? session.lastExecuteSqlResult.rows
    : [];
  const effectiveData = Array.isArray(data) && data.length > 0
    ? data
    : fallbackRows;

  logger.info('[chatStream] show_table called:', {
    session_id: session.id,
    table_title,
    replace_previous,
    data_count: effectiveData?.length || 0
  });

  try {
    // Validate data array
    if (!effectiveData || !Array.isArray(effectiveData)) {
      session.messages.push({
        role: 'tool',
        tool_call_id: toolCallId,
        content: JSON.stringify({
          success: false,
          error: 'data parameter is required and must be an array'
        })
      });
      return;
    }

    if (effectiveData.length === 0) {
      session.messages.push({
        role: 'tool',
        tool_call_id: toolCallId,
        content: JSON.stringify({
          success: false,
          error: 'data array is empty - no data to display'
        })
      });
      return;
    }

    // Send data to frontend via SSE (PRD v4.3: streamEvent handles missing connections)
    streamEvent(session.id, {
      type: 'table_result',
      message_id: session.currentMessageId,
      table_title,
      rows: effectiveData,
      replace_previous
    });

    // Add result to conversation (confirm success to LLM)
    session.messages.push({
      role: 'tool',
      tool_call_id: toolCallId,
      content: JSON.stringify({
        success: true,
        display_type: 'table',
        table_title,
        row_count: effectiveData.length
      })
    });

    // Log success
    logger.info('[chatStream] show_table completed:', {
      session_id: session.id,
      table_title,
      row_count: effectiveData.length,
      duration_ms: Date.now() - startTime
    });

  } catch (error) {
    logger.error('[chatStream] show_table error:', {
      error: error.message,
      stack: error.stack,
      session_id: session.id,
      duration_ms: Date.now() - startTime
    });
    session.messages.push({
      role: 'tool',
      tool_call_id: toolCallId,
      content: JSON.stringify({ success: false, error: error.message })
    });
  }
}

/**
 * Enforce patient scope on SQL query (SECURITY: Defense in depth)
 * Validates that multi-patient queries include proper patient filtering
 * CRITICAL: Checks both PRESENCE and VALUE of patient_id to prevent cross-patient access
 */
function enforcePatientScope(sql, patientId) {
  const sqlLower = sql.toLowerCase();

  // Step 1: Check if patient_id is referenced in the query
  // SECURITY FIX: Handle case-insensitive variants, quoted identifiers, and table-qualified names
  const patientIdPatterns = [
    /\bpatient_id\s*=/i,           // Standard: patient_id =
    /\b"patient_id"\s*=/i,         // Quoted: "patient_id" =
    /\.\s*patient_id\s*=/i,        // Table-qualified: p.patient_id =
    /\.\s*"patient_id"\s*=/i,      // Quoted + qualified: p."patient_id" =
    /join.*patients.*on.*id\s*=/i // JOIN patients ON id =
  ];

  const hasPatientIdFilter = patientIdPatterns.some(pattern => pattern.test(sql));

  if (!hasPatientIdFilter) {
    throw new Error(
      'SECURITY: Query must include patient_id filter for multi-patient databases. ' +
      'Expected WHERE clause filtering by patient_id or join to patients table.'
    );
  }

  // Step 2: CRITICAL - Validate the actual UUID value
  // This prevents queries that reference patient_id but use wrong UUID
  if (!sql.includes(patientId)) {
    throw new Error(
      `SECURITY: Query must filter by current patient: ${patientId}. ` +
      'Found patient_id column but UUID value does not match session context.'
    );
  }

  // Step 2a: SECURITY FIX - Detect SQL comment injection near patient_id filter
  // Attackers could use: WHERE patient_id = 'uuid' -- */ OR '1'='1' /*
  const sqlCommentPatterns = [
    /patient_id.*?--/i,                    // Single-line comment after patient_id
    /patient_id.*?\/\*/i,                  // Multi-line comment start after patient_id
    /--.*?patient_id/i,                    // Comment before patient_id
    /\/\*.*?patient_id.*?\*\//i            // patient_id inside multi-line comment
  ];

  for (const pattern of sqlCommentPatterns) {
    if (pattern.test(sql)) {
      throw new Error(
        'SECURITY: SQL comments near patient_id filter are not allowed. ' +
        'This could be an attempt to bypass patient data access controls. ' +
        `Detected pattern: ${pattern.source}`
      );
    }
  }

  // Step 2b: CRITICAL - Detect negation operators that would invert the filter
  // Attackers could use: WHERE patient_id != 'X' to get ALL OTHER patients
  const sqlAroundPatientId = sql.toLowerCase();
  const dangerousPatterns = [
    /patient_id\s*(!=|<>)/i,           // patient_id != or patient_id <>
    /patient_id\s+not\s+in/i,          // patient_id NOT IN
    /patient_id\s+not\s*=/i,           // patient_id NOT =
    /not\s+patient_id\s*=/i,           // NOT patient_id =
    /patient_id\s+is\s+not/i           // patient_id IS NOT
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(sqlAroundPatientId)) {
      throw new Error(
        'SECURITY: Query uses negation operator on patient_id filter. ' +
        'Only equality filters (=, IN) are allowed to prevent cross-patient data access. ' +
        `Detected pattern: ${pattern.source}`
      );
    }
  }

  // Step 3: Validate no other patient UUIDs present (prevent cross-patient joins)
  // UUID format: 8-4-4-4-12 hex digits
  const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  const foundUuids = sql.match(uuidRegex) || [];
  const wrongUuids = foundUuids.filter(uuid => uuid.toLowerCase() !== patientId.toLowerCase());

  if (wrongUuids.length > 0) {
    throw new Error(
      `SECURITY: Query contains unauthorized patient UUID(s): ${wrongUuids.join(', ')}. ` +
      `Only current patient ${patientId} is allowed.`
    );
  }

  // All validations passed
  logger.info('[chatStream] Patient scope validated:', {
    patient_id: patientId,
    has_filter: true,
    uuid_validated: true
  });

  return sql;
}

/**
 * Ensure SQL has appropriate LIMIT clause
 */
function ensureLimit(sql, maxLimit) {
  const limitMatch = sql.match(/\bLIMIT\s+(\d+)\s*;?\s*$/i);

  if (limitMatch) {
    const existingLimit = parseInt(limitMatch[1], 10);
    if (existingLimit > maxLimit) {
      return sql.replace(/\bLIMIT\s+\d+\s*;?\s*$/i, `LIMIT ${maxLimit}`);
    }
    return sql;
  }

  // No limit found - add one
  const hasSemicolon = /;\s*$/.test(sql);
  if (hasSemicolon) {
    return sql.replace(/;\s*$/, ` LIMIT ${maxLimit};`);
  }
  return `${sql.trim()} LIMIT ${maxLimit}`;
}

/**
 * Prune conversation history when approaching token limits
 * Called before each LLM API call in streamLLMResponse()
 * Strategy: Keep system prompt + last N messages when over threshold
 */
function pruneConversationIfNeeded(session) {
  // Step 1: Estimate current token count (rough heuristic: 4 chars = 1 token)
  const totalChars = session.messages.reduce((sum, msg) => {
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    return sum + content.length;
  }, 0);

  const estimatedTokens = Math.ceil(totalChars / 4);

  logger.debug('[chatStream] Token estimate:', {
    session_id: session.id,
    total_chars: totalChars,
    estimated_tokens: estimatedTokens,
    message_count: session.messages.length
  });

  // Step 2: Check if pruning needed
  if (estimatedTokens < MAX_TOKEN_THRESHOLD) {
    return; // Below threshold, no pruning needed
  }

  logger.info('[chatStream] Pruning conversation:', {
    session_id: session.id,
    before_count: session.messages.length,
    estimated_tokens: estimatedTokens
  });

  // Step 3: Separate system prompt from conversation messages
  const systemPrompt = session.messages.find(msg => msg.role === 'system');
  const conversationMessages = session.messages.filter(msg => msg.role !== 'system');

  // Step 4: Keep only recent messages, but ensure tool call/response pairs are preserved
  let recentMessages = conversationMessages.slice(-KEEP_RECENT_MESSAGES);

  // Step 4a: CRITICAL FIX - If first message after pruning is a tool response,
  // we need to include the preceding assistant message with tool_calls
  if (recentMessages.length > 0 && recentMessages[0].role === 'tool') {
    // Find the index of this tool message in the original conversation
    const firstToolIndex = conversationMessages.indexOf(recentMessages[0]);

    // Walk backwards to find the assistant message with tool_calls
    for (let i = firstToolIndex - 1; i >= 0; i--) {
      const msg = conversationMessages[i];
      if (msg.role === 'assistant' && msg.tool_calls) {
        // Found the assistant message - include all messages from here onwards
        recentMessages = conversationMessages.slice(i);
        logger.info('[chatStream] Extended pruning window to include tool_call ancestor:', {
          session_id: session.id,
          added_messages: i - (conversationMessages.length - KEEP_RECENT_MESSAGES)
        });
        break;
      }
      // If we hit a user message, something is wrong - stop looking
      if (msg.role === 'user') {
        logger.warn('[chatStream] Could not find tool_calls ancestor - conversation may be corrupted');
        break;
      }
    }
  }

  // Step 4b: CRITICAL FIX - If last message is assistant with tool_calls but we pruned the responses,
  // remove that assistant message to prevent orphaned tool_calls
  if (recentMessages.length > 0) {
    const lastMsg = recentMessages[recentMessages.length - 1];
    if (lastMsg.role === 'assistant' && lastMsg.tool_calls && lastMsg.tool_calls.length > 0) {
      // Check if ALL tool responses are present
      const toolCallIds = lastMsg.tool_calls.map(tc => tc.id);
      const hasAllResponses = toolCallIds.every(id =>
        recentMessages.some(msg => msg.role === 'tool' && msg.tool_call_id === id)
      );

      if (!hasAllResponses) {
        logger.warn('[chatStream] Removing orphaned assistant message with tool_calls:', {
          session_id: session.id,
          tool_call_ids: toolCallIds
        });
        recentMessages = recentMessages.slice(0, -1);
      }
    }
  }

  // Step 5: Rebuild messages array
  session.messages = systemPrompt ? [systemPrompt, ...recentMessages] : recentMessages;

  logger.info('[chatStream] Conversation pruned:', {
    session_id: session.id,
    after_count: session.messages.length,
    kept_messages: KEEP_RECENT_MESSAGES
  });
}

export default router;
