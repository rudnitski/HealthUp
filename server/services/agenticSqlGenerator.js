// server/services/agenticSqlGenerator.js
// Agentic SQL Generation - Main Orchestration Loop
// PRD: docs/PRD_v2_0_agentic_sql_generation_mvp.md

const OpenAI = require('openai');
const crypto = require('crypto');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const { pool } = require('../db');
const { validateSQL } = require('./sqlValidator');
const { updateMRU } = require('./schemaSnapshot');
const {
  fuzzySearchParameterNames,
  fuzzySearchAnalyteNames,
  executeExploratorySql,
  TOOL_DEFINITIONS,
} = require('./agenticTools');

const NODE_ENV = process.env.NODE_ENV || 'development';

// Logger with pretty printing in development
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
const AGENTIC_MAX_ITERATIONS = parseInt(process.env.AGENTIC_MAX_ITERATIONS) || 5;
const AGENTIC_TIMEOUT_MS = parseInt(process.env.AGENTIC_TIMEOUT_MS) || 120000; // 2 minutes default
const DEFAULT_MODEL = process.env.SQL_GENERATOR_MODEL || 'gpt-5-mini';

let openAiClient;

// Load agentic system prompt template from file
const PROMPTS_DIR = path.join(__dirname, '../../prompts');
const AGENTIC_SYSTEM_PROMPT_PATH = path.join(PROMPTS_DIR, 'agentic_sql_generator_system_prompt.txt');

let agenticSystemPromptTemplate = null;

try {
  agenticSystemPromptTemplate = fs.readFileSync(AGENTIC_SYSTEM_PROMPT_PATH, 'utf8');
  logger.info('[agenticSqlGenerator] Loaded agentic system prompt template');
} catch (error) {
  logger.warn('[agenticSqlGenerator] Failed to load agentic system prompt template:', error.message);
}

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
      timeout: 30000, // 30 second timeout for all API calls
    });
  }

  return openAiClient;
};

/**
 * Create hash
 */
const createHash = (value) => {
  if (!value) return null;
  return crypto.createHash('sha256').update(String(value)).digest('hex');
};

/**
 * Build system prompt for agentic mode
 */
function buildAgenticSystemPrompt(schemaContext, maxIterations) {
  if (!agenticSystemPromptTemplate) {
    throw new Error('Agentic system prompt template not loaded. Check prompts/agentic_sql_generator_system_prompt.txt');
  }

  // Replace placeholders in template
  return agenticSystemPromptTemplate
    .replace(/\{\{MAX_ITERATIONS\}\}/g, maxIterations)
    .replace(/\{\{SCHEMA_CONTEXT\}\}/g, schemaContext);
}

/**
 * Log SQL generation to database
 */
async function logSqlGeneration(data) {
  const {
    status,
    userHash,
    requestId,
    question,
    sql,
    sqlHash,
    validationOutcome,
    schemaSnapshotId,
    metadata
  } = data;

  try {
    // Log to database (assuming sql_generation_logs table exists)
    await pool.query(
      `INSERT INTO sql_generation_logs
       (id, status, user_id_hash, prompt, generated_sql, metadata, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW())`,
      [
        status,
        userHash,
        question,
        sql,
        JSON.stringify(metadata)
      ]
    );

    // Also log to console in dev
    logger.info({
      event_type: 'sql_generation',
      request_id: requestId,
      user_hash: userHash,
      question,
      sql_hash: sqlHash,
      validation_outcome: validationOutcome,
      schema_snapshot_id: schemaSnapshotId,
      metadata
    }, '[agenticSql] SQL generation audit log');
  } catch (error) {
    logger.error({
      error: error.message,
      request_id: requestId,
    }, '[agenticSql] Failed to log SQL generation');
  }
}

/**
 * Handle final query with validation and retry logic
 */
async function handleFinalQuery(
  params,
  conversationHistory,
  iterationLog,
  retryCount,
  schemaSnapshotId,
  userIdentifier,
  requestId,
  question,
  startTime,
  forcedCompletion = false
) {
  let { sql, explanation, confidence, query_type, plot_metadata, plot_title } = params;

  // Extract plot_title from plot_metadata if nested there (LLM sometimes puts it there)
  if (!plot_title && plot_metadata && plot_metadata.plot_title) {
    plot_title = plot_metadata.plot_title;
    // Remove from metadata to avoid duplication
    delete plot_metadata.plot_title;
  }

  // Default query_type to 'data_query' if not specified (backward compatibility)
  query_type = query_type || 'data_query';

  // Validate plot_metadata presence (first attempt only, then apply defaults)
  if (query_type === 'plot_query' && !plot_metadata && retryCount === 0) {
    logger.warn({
      request_id: requestId,
      message: 'plot_metadata missing, requesting retry'
    }, '[agenticSql] Plot metadata validation failed');

    return {
      retry: true,
      retryCount: retryCount + 1,
      validationError: [{
        code: 'PLOT_METADATA_MISSING',
        message: 'plot_metadata is required when query_type is plot_query. Please include: { x_axis: "t", y_axis: "y", series_by: "unit" }'
      }]
    };
  }

  // Apply defaults if still missing after retry (safety net)
  if (query_type === 'plot_query' && !plot_metadata) {
    logger.info({
      request_id: requestId,
      message: 'Applying default plot_metadata after retry'
    }, '[agenticSql] Using fallback plot metadata');

    plot_metadata = {
      x_axis: 't',
      y_axis: 'y',
      series_by: 'unit'
    };
  }

  // Strip trailing comments (safety measure)
  // Comments after the final semicolon break LIMIT injection
  if (sql) {
    // Find the last semicolon
    const lastSemicolon = sql.lastIndexOf(';');
    if (lastSemicolon !== -1) {
      // Check if there's only whitespace and comments after it
      const afterSemicolon = sql.substring(lastSemicolon + 1).trim();
      if (afterSemicolon && /^--/.test(afterSemicolon)) {
        // Strip everything after the semicolon
        sql = sql.substring(0, lastSemicolon + 1);
        logger.debug({}, '[agenticSql] Stripped trailing comments from SQL');
      }
    }
  }

  logger.debug({
    sql_preview: sql?.substring(0, 100),
    confidence,
    query_type,
    forced_completion: forcedCompletion,
  }, '[agenticSql] Handling final query');

  // Validate SQL (pass queryType for plot-specific validation)
  const validation = await validateSQL(sql, { schemaSnapshotId, queryType: query_type });

  if (!validation.valid) {
    // Validation failed
    logger.warn({
      violations: validation.violations,
      retry_count: retryCount,
    }, '[agenticSql] Final query validation failed');

    if (retryCount >= 1) {
      // Already retried once - fail
      const durationMs = Date.now() - startTime;
      const userHash = createHash(userIdentifier);
      const sqlHash = createHash(sql);

      await logSqlGeneration({
        status: 'failed',
        userHash,
        requestId,
        question,
        sql,
        sqlHash,
        validationOutcome: 'rejected',
        schemaSnapshotId,
        metadata: {
          agentic_mode: true,
          iterations: iterationLog,
          forced_completion: forcedCompletion,
          validation_violations: validation.violations,
          confidence,
          total_duration_ms: durationMs,
        }
      });

      return {
        ok: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Only single read-only SELECT statements are allowed.'
        },
        details: { violations: validation.violations },
        metadata: {
          total_iterations: iterationLog.length,
          duration_ms: durationMs,
          schema_snapshot_id: schemaSnapshotId
        }
      };
    }

    // First validation failure - signal retry needed
    return {
      retry: true,
      retryCount: retryCount + 1,
      validationError: validation.violations
    };
  }

  // Validation passed - success!
  const safeSql = validation.sqlWithLimit;
  const durationMs = Date.now() - startTime;
  const userHash = createHash(userIdentifier);
  const sqlHash = createHash(safeSql);

  // Update MRU cache with tables used in query
  const tablePattern = /FROM\s+([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?)/gi;
  let match;
  while ((match = tablePattern.exec(safeSql)) !== null) {
    updateMRU(match[1]);
  }

  // Log success to sql_generation_logs
  await logSqlGeneration({
    status: 'success',
    userHash,
    requestId,
    question,
    sql: safeSql,
    sqlHash,
    validationOutcome: 'accepted',
    schemaSnapshotId,
    metadata: {
      agentic_mode: true,
      iterations: iterationLog,
      forced_completion: forcedCompletion,
      confidence, // Store internally but don't surface to client
      total_iterations: iterationLog.length,
      total_duration_ms: durationMs,
      model: DEFAULT_MODEL
    }
  });

  // Build response object
  const response = {
    ok: true,
    sql: safeSql,
    explanation: explanation || null,
    metadata: {
      model: DEFAULT_MODEL,
      tokens: { prompt: 0, completion: 0, total: 0 }, // TODO: extract from OpenAI response
      duration_ms: durationMs,
      schema_snapshot_id: schemaSnapshotId,
      validator: validation.validator,
      // Note: confidence NOT included in client-facing response (logged only)
      agentic: {
        iterations: iterationLog.length,
        forced_completion: forcedCompletion,
      }
    }
  };

  // Add query_type and plot_metadata for plot queries
  if (query_type === 'plot_query') {
    response.query_type = 'plot_query';
    response.plot_metadata = plot_metadata;
    // Include plot_title if provided
    if (plot_title) {
      response.plot_title = plot_title;
    }
  } else {
    // Optional: Include query_type for backward compatibility tracking
    response.query_type = 'data_query';
  }

  return response;
}

/**
 * Format error response
 */
function formatErrorResponse(errorCode, iterationLog, iterationsCompleted, startTime) {
  const messages = {
    TIMEOUT: 'Query generation timed out. Please simplify your question.',
    NO_FINAL_QUERY: 'Unable to generate query. Please rephrase your question.',
    MAX_ITERATIONS: 'Unable to generate query within iteration limit. Please rephrase your question.'
  };

  return {
    ok: false,
    error: {
      code: errorCode,
      message: messages[errorCode] || 'Query generation failed.'
    },
    metadata: {
      timeout: errorCode === 'TIMEOUT',
      iterations_completed: iterationsCompleted,
      duration_ms: Date.now() - startTime,
      iteration_log: iterationLog // For debugging
    }
  };
}

/**
 * Main agentic SQL generation loop
 */
async function generateSqlWithAgenticLoop({
  question,
  userIdentifier,
  model,
  schemaContext,
  schemaSnapshotId,
  maxIterations = AGENTIC_MAX_ITERATIONS
}) {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();
  const conversationHistory = [];
  const iterationLog = [];
  let retryCount = 0;

  logger.info({
    request_id: requestId,
    question,
    max_iterations: maxIterations,
  }, '[agenticSql] Starting agentic loop');

  // Step 1: Initialize conversation
  const systemPrompt = buildAgenticSystemPrompt(schemaContext, maxIterations);

  conversationHistory.push({
    role: 'system',
    content: systemPrompt
  });

  conversationHistory.push({
    role: 'user',
    content: `Question: ${question}`
  });

  // Step 2: Get OpenAI client
  const client = getOpenAiClient();

  // Step 3: Iteration loop
  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    // 3a. Check timeout
    if (Date.now() - startTime > AGENTIC_TIMEOUT_MS) {
      logger.warn({
        request_id: requestId,
        iterations_completed: iteration - 1,
      }, '[agenticSql] Timeout reached');

      return formatErrorResponse('TIMEOUT', iterationLog, iteration - 1, startTime);
    }

    logger.debug({
      request_id: requestId,
      iteration,
      conversation_length: conversationHistory.length,
    }, '[agenticSql] Starting iteration');

    // 3b. Call OpenAI with function calling
    let response;
    const llmCallStart = Date.now();
    try {
      response = await client.chat.completions.create({
        model: model || DEFAULT_MODEL,
        messages: conversationHistory,
        tools: TOOL_DEFINITIONS,
        tool_choice: 'auto',
        // Note: temperature not supported with gpt-5-mini in function calling mode
      });

      const llmCallDuration = Date.now() - llmCallStart;
      logger.info({
        request_id: requestId,
        iteration,
        llm_call_duration_ms: llmCallDuration,
      }, '[agenticSql] OpenAI API call completed');

      // Warn if LLM call is slow
      if (llmCallDuration > 10000) {
        logger.warn({
          request_id: requestId,
          iteration,
          llm_call_duration_ms: llmCallDuration,
        }, '[agenticSql] Slow OpenAI API call detected (>10s)');
      }
    } catch (error) {
      const llmCallDuration = Date.now() - llmCallStart;
      logger.error({
        request_id: requestId,
        iteration,
        error: error.message,
        llm_call_duration_ms: llmCallDuration,
      }, '[agenticSql] OpenAI API call failed');

      return formatErrorResponse('API_ERROR', iterationLog, iteration, startTime);
    }

    const assistantMessage = response.choices?.[0]?.message;

    if (!assistantMessage) {
      logger.error({
        request_id: requestId,
        iteration,
      }, '[agenticSql] No assistant message in response');

      return formatErrorResponse('NO_RESPONSE', iterationLog, iteration, startTime);
    }

    // Add assistant message to conversation
    conversationHistory.push(assistantMessage);

    const toolCalls = assistantMessage.tool_calls || [];

    logger.debug({
      request_id: requestId,
      iteration,
      tool_calls_count: toolCalls.length,
      tool_names: toolCalls.map(tc => tc.function.name),
      assistant_content: assistantMessage.content,
    }, '[agenticSql] Received assistant response');

    // 3d. Execute each tool call
    for (const toolCall of toolCalls) {
      const { name: toolName, arguments: argsJson } = toolCall.function;
      const toolCallId = toolCall.id;

      let params;
      try {
        params = JSON.parse(argsJson);
      } catch (error) {
        logger.error({
          request_id: requestId,
          tool_name: toolName,
          error: error.message,
        }, '[agenticSql] Failed to parse tool arguments');

        conversationHistory.push({
          role: 'tool',
          tool_call_id: toolCallId,
          content: JSON.stringify({ error: 'Invalid tool arguments format' })
        });
        continue;
      }

      logger.info({
        request_id: requestId,
        iteration,
        tool_name: toolName,
        params,
      }, '[agenticSql] Executing tool');

      const toolCallStart = Date.now();
      try {
        let result;

        // Execute tool based on name
        if (toolName === 'fuzzy_search_parameter_names') {
          result = await fuzzySearchParameterNames(params.search_term, params.limit);
          const toolDuration = Date.now() - toolCallStart;

          iterationLog.push({
            iteration,
            tool: toolName,
            params,
            results_count: result.matches_found,
            results_preview: result.matches?.slice(0, 3),
            duration_ms: toolDuration,
            timestamp: new Date().toISOString()
          });

          logger.info({
            request_id: requestId,
            iteration,
            tool_name: toolName,
            duration_ms: toolDuration,
            results_count: result.matches_found,
          }, '[agenticSql] Tool execution completed');

          if (toolDuration > 5000) {
            logger.warn({
              request_id: requestId,
              iteration,
              tool_name: toolName,
              duration_ms: toolDuration,
            }, '[agenticSql] Slow tool execution detected (>5s)');
          }

        } else if (toolName === 'fuzzy_search_analyte_names') {
          result = await fuzzySearchAnalyteNames(params.search_term, params.limit);
          const toolDuration = Date.now() - toolCallStart;

          iterationLog.push({
            iteration,
            tool: toolName,
            params,
            results_count: result.matches_found,
            results_preview: result.matches?.slice(0, 3),
            duration_ms: toolDuration,
            timestamp: new Date().toISOString()
          });

          logger.info({
            request_id: requestId,
            iteration,
            tool_name: toolName,
            duration_ms: toolDuration,
            results_count: result.matches_found,
          }, '[agenticSql] Tool execution completed');

          if (toolDuration > 5000) {
            logger.warn({
              request_id: requestId,
              iteration,
              tool_name: toolName,
              duration_ms: toolDuration,
            }, '[agenticSql] Slow tool execution detected (>5s)');
          }

        } else if (toolName === 'execute_exploratory_sql') {
          result = await executeExploratorySql(params.sql, params.reasoning, { schemaSnapshotId });
          const toolDuration = Date.now() - toolCallStart;

          iterationLog.push({
            iteration,
            tool: toolName,
            params: { sql_preview: params.sql?.substring(0, 100), reasoning: params.reasoning },
            results_count: result.row_count,
            results_preview: result.rows?.slice(0, 3),
            duration_ms: toolDuration,
            timestamp: new Date().toISOString()
          });

          logger.info({
            request_id: requestId,
            iteration,
            tool_name: toolName,
            duration_ms: toolDuration,
            results_count: result.row_count,
          }, '[agenticSql] Tool execution completed');

          if (toolDuration > 5000) {
            logger.warn({
              request_id: requestId,
              iteration,
              tool_name: toolName,
              duration_ms: toolDuration,
            }, '[agenticSql] Slow tool execution detected (>5s)');
          }

        } else if (toolName === 'generate_final_query') {
          // Final query - handle with validation
          const finalResult = await handleFinalQuery(
            params,
            conversationHistory,
            iterationLog,
            retryCount,
            schemaSnapshotId,
            userIdentifier,
            requestId,
            question,
            startTime,
            false // not forced
          );

          // Check if retry is needed
          if (finalResult.retry) {
            retryCount = finalResult.retryCount;

            // Give LLM feedback about validation failure
            conversationHistory.push({
              role: 'tool',
              tool_call_id: toolCallId,
              content: JSON.stringify({
                error: 'Validation failed',
                violations: finalResult.validationError,
                message: 'Please fix the SQL query to comply with validation rules and try again.'
              })
            });

            iterationLog.push({
              iteration,
              tool: toolName,
              validation_failed: true,
              violations: finalResult.validationError,
              retry_count: retryCount,
              timestamp: new Date().toISOString()
            });

            // Continue to next iteration for retry
            break;
          }

          // Success or final failure - return result
          return finalResult;

        } else {
          // Unknown tool
          result = { error: `Unknown tool: ${toolName}` };
        }

        // Append tool result to conversation
        conversationHistory.push({
          role: 'tool',
          tool_call_id: toolCallId,
          content: JSON.stringify(result)
        });

      } catch (error) {
        // Tool execution error - give LLM error feedback
        const toolDuration = Date.now() - toolCallStart;
        logger.error({
          request_id: requestId,
          iteration,
          tool_name: toolName,
          error: error.message,
          duration_ms: toolDuration,
        }, '[agenticSql] Tool execution failed');

        iterationLog.push({
          iteration,
          tool: toolName,
          error: error.message,
          duration_ms: toolDuration,
          timestamp: new Date().toISOString()
        });

        conversationHistory.push({
          role: 'tool',
          tool_call_id: toolCallId,
          content: JSON.stringify({ error: error.message })
        });
      }
    }

    // 3e. If no tool calls and no final query, prompt LLM to use tools
    if (toolCalls.length === 0 && iteration < maxIterations) {
      logger.debug({
        request_id: requestId,
        iteration,
      }, '[agenticSql] No tool calls, prompting LLM');

      conversationHistory.push({
        role: 'user',
        content: 'Please use one of the available tools to explore the database or generate your final answer.'
      });
    }
  }

  // Step 4: Max iterations reached without final query - force completion
  logger.warn({
    request_id: requestId,
    max_iterations: maxIterations,
  }, '[agenticSql] Max iterations reached, forcing completion');

  conversationHistory.push({
    role: 'user',
    content: 'Maximum iterations reached. You must now generate your best answer using the generate_final_query tool.'
  });

  // One more attempt to get final query
  try {
    const finalResponse = await client.chat.completions.create({
      model: model || DEFAULT_MODEL,
      messages: conversationHistory,
      tools: TOOL_DEFINITIONS,
      tool_choice: { type: 'function', function: { name: 'generate_final_query' } }, // Force final query
      // Note: temperature not supported with gpt-5-mini in function calling mode
    });

    const finalMessage = finalResponse.choices?.[0]?.message;
    const finalToolCalls = finalMessage?.tool_calls || [];
    const finalQueryCall = finalToolCalls.find(tc => tc.function.name === 'generate_final_query');

    if (finalQueryCall) {
      const params = JSON.parse(finalQueryCall.function.arguments);

      return await handleFinalQuery(
        params,
        conversationHistory,
        iterationLog,
        retryCount,
        schemaSnapshotId,
        userIdentifier,
        requestId,
        question,
        startTime,
        true // forcedCompletion = true
      );
    }
  } catch (error) {
    logger.error({
      request_id: requestId,
      error: error.message,
    }, '[agenticSql] Forced completion failed');
  }

  // No final query even after forcing - return error
  return formatErrorResponse('NO_FINAL_QUERY', iterationLog, maxIterations, startTime);
}

module.exports = {
  generateSqlWithAgenticLoop,
};
