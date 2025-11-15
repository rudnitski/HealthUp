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
// - Message limit: 20 messages per conversation (enforced in sessionManager)

const express = require('express');
const OpenAI = require('openai');
const pino = require('pino');
const { pool } = require('../db');
const sessionManager = require('../utils/sessionManager');
const agenticCore = require('../services/agenticCore');
const { TOOL_DEFINITIONS } = require('../services/agenticTools');
const { getSchemaSnapshot } = require('../services/schemaSnapshot');
const { buildSchemaSection } = require('../services/promptBuilder');

const router = express.Router();

const NODE_ENV = process.env.NODE_ENV || 'development';

const logger = pino({
  transport: NODE_ENV === 'development' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss',
      ignore: 'pid,hostname',
    },
  } : undefined,
});

// Configuration
const SQL_GENERATOR_MODEL = process.env.SQL_GENERATOR_MODEL || 'gpt-4o-mini'; // Fixed: was 'gpt-5-mini' (invalid model)
const MAX_CONVERSATION_ITERATIONS = 50; // Safety limit to prevent infinite loops

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
  const lowerResponse = textToMatch.toLowerCase();
  for (const patient of patients) {
    const lowerName = (patient.full_name || '').toLowerCase();
    if (lowerName.includes(lowerResponse) || lowerResponse.includes(lowerName)) {
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

  // Check message limit
  if (sessionManager.isMessageLimitReached(sessionId)) {
    return res.status(429).json({
      error: 'Message limit reached (20 per conversation)',
      code: 'MESSAGE_LIMIT'
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

  try {
    const stream = await client.chat.completions.create({
      model: SQL_GENERATOR_MODEL,
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
        error: error.message
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

    // Handle generate_final_query specially
    if (toolName === 'generate_final_query') {
      await handleFinalQuery(session, params, toolCallId);
      return; // End conversation
    }

    // Execute other tools
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
        error: error.message
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
      error: error.message
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

module.exports = router;
