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
import { pool } from '../db/index.js';
import sessionManager from '../utils/sessionManager.js';
import * as agenticCore from '../services/agenticCore.js';
import { TOOL_DEFINITIONS } from '../services/agenticTools.js';
import { getSchemaSnapshot } from '../services/schemaSnapshot.js';
import { buildSchemaSection } from '../services/promptBuilder.js';
import { validateSQL } from '../services/sqlValidator.js';

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
 */
function streamEvent(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * Extract patient ID from user response
 * Supports: numbered selection (1, 2, 3), name matching (including in parentheses), or direct UUID
 */
async function extractPatientId(userResponse, patients) {
  const trimmed = userResponse.trim();

  // Extract text in parentheses first (e.g., "show my results (юра)" -> "юра")
  const parenthesesMatch = trimmed.match(/\(([^)]+)\)/);
  const textToMatch = parenthesesMatch ? parenthesesMatch[1].trim() : trimmed;

  // Try numbered selection first (1, 2, 3, etc.)
  const numberMatch = textToMatch.match(/^\d+$/);
  if (numberMatch) {
    const index = parseInt(numberMatch[0], 10) - 1; // Convert to 0-based index
    if (index >= 0 && index < patients.length) {
      logger.info('[chatStream] Matched patient by number:', {
        user_input: trimmed,
        extracted_text: textToMatch,
        selected_index: index,
        patient_id: patients[index].id
      });
      return patients[index].id;
    }
  }

  // Try fuzzy name matching (case-insensitive)
  // Only match if BOTH user input and patient name are non-empty and meaningful
  const lowerResponse = textToMatch.toLowerCase();
  for (const patient of patients) {
    const lowerName = (patient.full_name || '').toLowerCase().trim();
    // Skip patients with empty names - prevents false matches on empty string
    if (!lowerName || lowerName.length < 2) {
      continue;
    }
    // Require minimum 2 characters match to avoid false positives
    if (lowerResponse.length >= 2 && (lowerName.includes(lowerResponse) || lowerResponse.includes(lowerName))) {
      logger.info('[chatStream] Matched patient by name:', {
        user_input: trimmed,
        extracted_text: textToMatch,
        patient_name: patient.full_name,
        patient_id: patient.id
      });
      return patient.id;
    }
  }

  // Try exact UUID match
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidPattern.test(trimmed)) {
    const patient = patients.find(p => p.id.toLowerCase() === trimmed.toLowerCase());
    if (patient) {
      logger.info('[chatStream] Matched patient by UUID:', {
        user_input: trimmed,
        patient_id: patient.id
      });
      return patient.id;
    }
  }

  // No match found
  logger.warn('[chatStream] Could not match patient:', {
    user_input: trimmed,
    available_patients: patients.length
  });
  return null;
}

/**
 * GET /api/chat/stream
 * Open SSE connection and create session
 */
router.get('/stream', (req, res) => {
  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no' // Disable nginx buffering
  });

  // Create session
  const session = sessionManager.createSession();

  // Store SSE response object in session for streaming
  session.sseResponse = res;

  // Send session_start event
  streamEvent(res, {
    type: 'session_start',
    sessionId: session.id
  });

  logger.info('[chatStream] SSE connection established:', {
    session_id: session.id
  });

  // Handle client disconnect
  req.on('close', () => {
    sessionManager.markDisconnected(session.id);
    logger.info('[chatStream] SSE connection closed:', {
      session_id: session.id
    });
  });

  // Keep connection alive (send comment every 30 seconds)
  const keepAliveInterval = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(keepAliveInterval);
  });
});

/**
 * POST /api/chat/messages
 * Submit user message to session
 */
router.post('/messages', async (req, res) => {
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
 */
router.delete('/sessions/:sessionId', (req, res) => {
  const { sessionId } = req.params;

  const existed = sessionManager.deleteSession(sessionId);

  if (existed) {
    res.json({
      ok: true,
      message: 'Session cleared'
    });
  } else {
    res.status(404).json({
      error: 'Session not found',
      code: 'SESSION_NOT_FOUND'
    });
  }
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
    // Add user message to conversation
    sessionManager.addMessage(sessionId, 'user', userMessage);

    // Initialize system prompt on first message
    if (session.messages.length === 1) {
      await initializeSystemPrompt(session);
    }

    // Check if this looks like a patient selection response
    if (session.awaitingPatientSelection && !session.selectedPatientId) {
      const patientId = await extractPatientId(userMessage, session.patients || []);
      if (patientId) {
        sessionManager.setSelectedPatient(sessionId, patientId);
        session.awaitingPatientSelection = false;
        logger.info('[chatStream] Patient selected:', {
          session_id: sessionId,
          patient_id: patientId
        });
      }
    }

    // Start LLM streaming
    await streamLLMResponse(session);

  } catch (error) {
    // Full error logging for debugging
    console.error('[chatStream] FULL ERROR DETAILS:');
    console.error(error);

    logger.error('[chatStream] Error processing message:', {
      session_id: sessionId,
      error: error.message,
      stack: error.stack
    });

    // Send error to client if SSE stream is available
    if (session.sseResponse) {
      streamEvent(session.sseResponse, {
        type: 'error',
        code: 'PROCESSING_ERROR',
        message: 'Failed to process message. Please try again.',
        debug: NODE_ENV === 'development' ? error.message : undefined
      });
    }

  } finally {
    // Release processing lock
    if (sessionManager.getSession(sessionId)) {
      sessionManager.releaseLock(sessionId);
    }
  }
}

/**
 * Initialize system prompt with schema and patient context
 */
async function initializeSystemPrompt(session) {
  // Get schema snapshot and format it
  const { manifest } = await getSchemaSnapshot();
  const schemaContext = buildSchemaSection(manifest, ''); // Empty question = include all tables

  const { prompt, patientCount, patients } = await agenticCore.buildSystemPrompt(schemaContext, 20); // No iteration limit for conversational mode

  // Store patient info in session
  session.patientCount = patientCount;
  session.patients = patients;
  if (patientCount === 1 && patients.length === 1) {
    sessionManager.setSelectedPatient(session.id, patients[0].id);
    session.awaitingPatientSelection = false;
  } else if (patientCount > 1 && patients.length > 1) {
    session.awaitingPatientSelection = true;
  } else {
    session.awaitingPatientSelection = false;
  }

  // Add system message
  session.messages.unshift({
    role: 'system',
    content: prompt
  });

  logger.info('[chatStream] System prompt initialized:', {
    session_id: session.id,
    patient_count: patientCount,
    patients_count: patients.length
  });
}

/**
 * Stream LLM response with tool calling
 * @param {object} session - Session object with conversation state
 */
async function streamLLMResponse(session) {
  // Safety check: verify session still exists (could be deleted by timeout/disconnect)
  if (!sessionManager.getSession(session.id)) {
    logger.warn('[chatStream] Session deleted during processing:', {
      session_id: session.id
    });
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

    if (session.sseResponse) {
      streamEvent(session.sseResponse, {
        type: 'error',
        code: 'ITERATION_LIMIT_EXCEEDED',
        message: 'Conversation became too complex. Please start a new conversation.',
        debug: NODE_ENV === 'development' ? `Exceeded ${MAX_CONVERSATION_ITERATIONS} iterations` : undefined
      });

      streamEvent(session.sseResponse, {
        type: 'done'
      });
    }

    sessionManager.deleteSession(session.id);
    return;
  }

  const client = getOpenAiClient();

  // IMPORTANT: Prune conversation before making API call
  pruneConversationIfNeeded(session);

  // Send status: preparing to call LLM
  if (session.sseResponse) {
    streamEvent(session.sseResponse, {
      type: 'status',
      status: 'thinking',
      message: 'Thinking...'
    });
  }

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
        // Stream text to client
        if (session.sseResponse) {
          streamEvent(session.sseResponse, {
            type: 'text',
            content: delta.content
          });
        }
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
      await executeToolCalls(session, toolCalls);
    } else {
      // No tool calls - assistant finished speaking, waiting for user
      if (session.sseResponse && assistantMessage) {
        streamEvent(session.sseResponse, {
          type: 'message_complete'
        });
      }
    }

  } catch (error) {
    logger.error('[chatStream] LLM streaming error:', {
      session_id: session.id,
      error: error.message,
      stack: error.stack,
      error_code: error.code,
      error_type: error.type
    });

    // Send error event with debug info in development
    if (session.sseResponse) {
      streamEvent(session.sseResponse, {
        type: 'error',
        code: error.code || 'LLM_ERROR',
        message: 'AI service error. Please try again.',
        debug: NODE_ENV === 'development' ? error.message : undefined
      });
    }

    throw error;
  }
}

/**
 * Execute tool calls and continue conversation
 */
async function executeToolCalls(session, toolCalls) {
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

    // Send tool_start event
    if (session.sseResponse) {
      streamEvent(session.sseResponse, {
        type: 'tool_start',
        tool: toolName,
        params
      });
    }

    const toolStartTime = Date.now();

    // Handle display tools (show_plot, show_table) - don't end conversation
    if (toolName === 'show_plot') {
      await handleShowPlot(session, params, toolCallId);
      // Send tool_complete event
      if (session.sseResponse) {
        streamEvent(session.sseResponse, {
          type: 'tool_complete',
          tool: toolName,
          duration_ms: Date.now() - toolStartTime
        });
      }
      continue; // Continue to next tool or LLM response
    }

    if (toolName === 'show_table') {
      await handleShowTable(session, params, toolCallId);
      // Send tool_complete event
      if (session.sseResponse) {
        streamEvent(session.sseResponse, {
          type: 'tool_complete',
          tool: toolName,
          duration_ms: Date.now() - toolStartTime
        });
      }
      continue; // Continue to next tool or LLM response
    }

    // Execute other tools (fuzzy search, exploratory SQL)
    try {
      const result = await agenticCore.executeToolCall(toolName, params, {
        schemaSnapshotId: null // TODO: track schema snapshot in session
      });

      const toolDuration = Date.now() - toolStartTime;

      // Send tool_complete event
      if (session.sseResponse) {
        streamEvent(session.sseResponse, {
          type: 'tool_complete',
          tool: toolName,
          duration_ms: toolDuration
        });
      }

      // Add tool result to conversation
      session.messages.push({
        role: 'tool',
        tool_call_id: toolCallId,
        content: JSON.stringify(result)
      });

    } catch (error) {
      logger.error('[chatStream] Tool execution failed:', {
        session_id: session.id,
        tool_name: toolName,
        error: error.message,
        stack: error.stack
      });

      // Send tool_complete with error
      if (session.sseResponse) {
        streamEvent(session.sseResponse, {
          type: 'tool_complete',
          tool: toolName,
          duration_ms: Date.now() - toolStartTime,
          error: error.message,
          debug: NODE_ENV === 'development' ? error.stack : undefined
        });
      }

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
    return;
  }

  await streamLLMResponse(session);
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
  const beforeRoles = session.messages.map(m => `${m.role}${m.tool_calls ? '[tc]' : ''}${m.tool_call_id ? `[${m.tool_call_id.slice(0,8)}]` : ''}`);

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

  const afterRoles = session.messages.map(m => `${m.role}${m.tool_calls ? '[tc]' : ''}${m.tool_call_id ? `[${m.tool_call_id.slice(0,8)}]` : ''}`);

  console.log('[chatStream] BEFORE FILTER:', beforeRoles);
  console.log('[chatStream] AFTER FILTER:', afterRoles);
  console.log('[chatStream] REMOVED:', beforeCount - session.messages.length, 'messages');

  return beforeCount - session.messages.length;
}

/**
 * Handle show_plot tool call
 * Executes SQL, sends plot to frontend, adds compact data to conversation
 * Does NOT end conversation
 */
async function handleShowPlot(session, params, toolCallId) {
  const { sql, plot_title, replace_previous = false, reasoning } = params;
  const startTime = Date.now();

  logger.info('[chatStream] show_plot called:', {
    session_id: session.id,
    plot_title,
    replace_previous,
    reasoning
  });

  try {
    // Step 1: Validate SQL (reuse existing validation)
    const validation = await validateSQL(sql, { schemaSnapshotId: null, queryType: 'plot_query' });

    if (!validation.valid) {
      logger.warn('[chatStream] Plot validation failed', {
        sql_preview: sql.substring(0, 100),
        violations: validation.violations
      });
      session.messages.push({
        role: 'tool',
        tool_call_id: toolCallId,
        content: JSON.stringify({
          success: false,
          error: 'SQL validation failed',
          violations: validation.violations.map(v => v.message || v.code),
          attempted_sql: sql.substring(0, 200) + (sql.length > 200 ? '...' : '')
        })
      });
      return;
    }

    // Step 2: Enforce row limit (from env config)
    let safeSql = ensureLimit(validation.sqlWithLimit, MAX_PLOT_ROWS);

    // Step 2b: SECURITY - Enforce patient scope (defense in depth)
    if (session.selectedPatientId && session.patientCount > 1) {
      safeSql = enforcePatientScope(safeSql, session.selectedPatientId);
    }

    // DEBUG: Log the actual SQL being executed
    logger.debug('[chatStream] Executing show_plot SQL:', {
      sql_length: safeSql.length,
      sql_last_100_chars: safeSql.slice(-100)
    });

    // Step 3: Execute query with 5-second timeout
    const queryResult = await Promise.race([
      pool.query(safeSql),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Query timeout after 5 seconds')), 5000)
      )
    ]);

    // Step 4: Send FULL data to frontend
    if (session.sseResponse) {
      streamEvent(session.sseResponse, {
        type: 'plot_result',
        plot_title,
        rows: queryResult.rows,
        replace_previous
      });
    }

    // Step 5: Create COMPACT data for conversation history
    const compactRows = queryResult.rows.map(row => ({
      t: row.t,
      y: row.y,
      p: row.parameter_name,
      u: row.unit,
      ...(row.reference_lower != null && { rl: row.reference_lower }),
      ...(row.reference_upper != null && { ru: row.reference_upper }),
      ...(row.is_out_of_range != null && { oor: row.is_out_of_range })
    }));

    // Step 6: Clear previous display results if replacing
    // REMOVED: This prevented LLM from comparing multiple plots/tables
    // Keeping all display results in context allows LLM to:
    // - Compare trends across different parameters (cholesterol vs glucose)
    // - Reference previous data in multi-step analysis
    // - Avoid re-querying data that was recently shown
    // Automatic token pruning (50k threshold) handles context overflow
    // if (replace_previous) {
    //   const beforeCount = session.messages.length;
    //   const removedCount = removeDisplayResults(session);
    //   logger.info('[chatStream] Replaced previous display in show_plot:', {
    //     session_id: session.id,
    //     before_count: beforeCount,
    //     after_count: session.messages.length,
    //     removed_count: removedCount
    //   });
    // }

    // Step 7: Add compact result to conversation
    session.messages.push({
      role: 'tool',
      tool_call_id: toolCallId,
      content: JSON.stringify({
        success: true,
        display_type: 'plot',
        plot_title,
        rows: compactRows,
        row_count: compactRows.length
      })
    });

    // Log success with execution time
    logger.info('[chatStream] show_plot completed:', {
      session_id: session.id,
      plot_title,
      row_count: compactRows.length,
      duration_ms: Date.now() - startTime
    });

  } catch (error) {
    logger.error('[chatStream] show_plot error:', {
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
 * Handle show_table tool call
 * Executes SQL, sends table to frontend, adds compact data to conversation
 * Does NOT end conversation
 */
async function handleShowTable(session, params, toolCallId) {
  const { sql, table_title, replace_previous = false, reasoning } = params;
  const startTime = Date.now();

  logger.info('[chatStream] show_table called:', {
    session_id: session.id,
    table_title,
    replace_previous,
    reasoning,
    sql_preview: sql.substring(0, 200)
  });

  try {
    // 1. Validate SQL
    const validation = await validateSQL(sql, { schemaSnapshotId: null, queryType: 'data_query' });
    if (!validation.valid) {
      logger.warn('[chatStream] Table validation failed', {
        sql_preview: sql.substring(0, 100),
        violations: validation.violations
      });
      session.messages.push({
        role: 'tool',
        tool_call_id: toolCallId,
        content: JSON.stringify({
          success: false,
          error: 'SQL validation failed',
          violations: validation.violations.map(v => v.message || v.code),
          attempted_sql: sql.substring(0, 200) + (sql.length > 200 ? '...' : '')
        })
      });
      return;
    }

    // 2. Enforce table row limit (from env config)
    let safeSql = ensureLimit(validation.sqlWithLimit, MAX_TABLE_ROWS);

    // 2b. SECURITY - Enforce patient scope (same check as plot)
    if (session.selectedPatientId && session.patientCount > 1) {
      safeSql = enforcePatientScope(safeSql, session.selectedPatientId);
    }

    // 3. Execute query with 5-second timeout
    const queryResult = await Promise.race([
      pool.query(safeSql),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Query timeout after 5 seconds')), 5000)
      )
    ]);

    // 4. Send to frontend
    if (session.sseResponse) {
      streamEvent(session.sseResponse, {
        type: 'table_result',
        table_title,
        rows: queryResult.rows,
        replace_previous
      });
    }

    // 5. Compact format (simplified for tables)
    const compactRows = queryResult.rows.map(row => ({
      p: row.parameter_name,
      v: row.value,
      u: row.unit,
      d: row.date,
      ri: row.reference_interval,
      oor: row.is_out_of_range
    }));

    // 6. Clear previous display results if replace_previous=true
    // REMOVED: This prevented LLM from comparing multiple plots/tables
    // Keeping all display results in context allows LLM to:
    // - Compare data across different parameters
    // - Reference previous tables in multi-step analysis
    // - Avoid re-querying data that was recently shown
    // Automatic token pruning (50k threshold) handles context overflow
    // if (replace_previous) {
    //   const beforeCount = session.messages.length;
    //   const removedCount = removeDisplayResults(session);
    //   logger.info('[chatStream] Replaced previous display in show_table:', {
    //     session_id: session.id,
    //     before_count: beforeCount,
    //     after_count: session.messages.length,
    //     removed_count: removedCount
    //   });
    // }

    // 7. Add to conversation
    session.messages.push({
      role: 'tool',
      tool_call_id: toolCallId,
      content: JSON.stringify({
        success: true,
        display_type: 'table',
        table_title,
        rows: compactRows,
        row_count: compactRows.length
      })
    });

    // Log success with execution time
    logger.info('[chatStream] show_table completed:', {
      session_id: session.id,
      table_title,
      row_count: compactRows.length,
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
 * Handle final query generation
 */
async function handleFinalQuery(session, params, toolCallId) {
  const startTime = Date.now();

  // Extract patient_id from LLM response if provided (PRD v3.2)
  if (params.patient_id) {
    session.selectedPatientId = params.patient_id;
    logger.info('[chatStream] LLM identified patient:', {
      session_id: session.id,
      patient_id: params.patient_id
    });
  }

  // Build session metadata for agenticCore
  const sessionMetadata = {
    userIdentifier: 'anonymous', // TODO: Add user identification
    requestId: session.id,
    question: session.messages.find(m => m.role === 'user')?.content || '',
    schemaSnapshotId: null, // TODO: Track schema snapshot
    selectedPatientId: session.selectedPatientId,
    patientCount: session.patientCount || 0,
    sessionId: session.id,
    iterationLog: [] // Not applicable in conversational mode
  };

  try {
    const result = await agenticCore.handleFinalQuery(params, sessionMetadata, startTime);

    if (!result.ok) {
      // Validation failed - send error but keep session for clarification
      logger.warn('[chatStream] Final query validation failed:', {
        session_id: session.id,
        error: result.error
      });

      // Send error event to client
      if (session.sseResponse) {
        streamEvent(session.sseResponse, {
          type: 'error',
          code: result.error.code,
          message: result.error.message
        });

        // Send done event
        streamEvent(session.sseResponse, {
          type: 'done'
        });
      }

      // Keep session alive for user to fix error (PRD v3.2)
      sessionManager.releaseLock(session.id);
      return;
    }

    // Success! Execute query and return results
    const { sql, query_type, plot_metadata, plot_title } = result;

    logger.info('[chatStream] About to execute query:', {
      session_id: session.id,
      query_type,
      has_plot_metadata: !!plot_metadata,
      has_plot_title: !!plot_title,
      sql_preview: sql?.substring(0, 100)
    });

    // Execute query
    const queryResult = await pool.query(sql);

    logger.info('[chatStream] Final query successful:', {
      session_id: session.id,
      query_type,
      row_count: queryResult.rowCount,
      has_rows: queryResult.rows?.length > 0,
      first_row_keys: queryResult.rows?.[0] ? Object.keys(queryResult.rows[0]) : []
    });

    // Send final result event
    if (session.sseResponse) {
      logger.info('[chatStream] Sending final_result event:', {
        session_id: session.id,
        query_type,
        row_count: queryResult.rows?.length,
        has_plot_metadata: !!plot_metadata,
        plot_title
      });

      streamEvent(session.sseResponse, {
        type: 'final_result',
        sql,
        query_type,
        rows: queryResult.rows,
        plot_metadata,
        plot_title
      });

      // Send done event
      streamEvent(session.sseResponse, {
        type: 'done'
      });
    }

    // Keep session alive for follow-up questions (PRD v3.2)
    // Session will expire via TTL (1 hour idle timeout) in sessionManager
    sessionManager.releaseLock(session.id);

  } catch (error) {
    logger.error('[chatStream] Final query error:', {
      session_id: session.id,
      error: error.message,
      stack: error.stack
    });

    // Send error event
    if (session.sseResponse) {
      streamEvent(session.sseResponse, {
        type: 'error',
        code: 'INTERNAL_ERROR',
        message: error.message
      });

      streamEvent(session.sseResponse, {
        type: 'done'
      });
    }

    // Keep session alive so user can retry (PRD v3.2)
    sessionManager.releaseLock(session.id);
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
