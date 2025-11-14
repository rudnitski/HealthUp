// server/services/agenticCore.js
// Core logic for agentic SQL generation - shared between job-based and streaming modes
// PRD: docs/PRD_v3_2_conversational_sql_assistant.md

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { pool } = require('../db');
const { validateSQL } = require('./sqlValidator');
const { updateMRU } = require('./schemaSnapshot');
const {
  fuzzySearchParameterNames,
  fuzzySearchAnalyteNames,
  executeExploratorySql,
} = require('./agenticTools');

const NODE_ENV = process.env.NODE_ENV || 'development';

// Logger
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

// Load agentic system prompt template from file
const PROMPTS_DIR = path.join(__dirname, '../../prompts');
const AGENTIC_SYSTEM_PROMPT_PATH = path.join(PROMPTS_DIR, 'agentic_sql_generator_system_prompt.txt');

let agenticSystemPromptTemplate = null;

try {
  agenticSystemPromptTemplate = fs.readFileSync(AGENTIC_SYSTEM_PROMPT_PATH, 'utf8');
  logger.info('[agenticCore] Loaded agentic system prompt template');
} catch (error) {
  logger.warn('[agenticCore] Failed to load agentic system prompt template:', error.message);
}

/**
 * Create hash
 */
const createHash = (value) => {
  if (!value) return null;
  return crypto.createHash('sha256').update(String(value)).digest('hex');
};

/**
 * Build system prompt with schema context and patient information
 * PRD v3.2: Pre-loads patient count and list to avoid runtime queries
 */
async function buildSystemPrompt(schemaContext, maxIterations) {
  if (!agenticSystemPromptTemplate) {
    throw new Error('Agentic system prompt template not loaded. Check prompts/agentic_sql_generator_system_prompt.txt');
  }

  // Load patient information from database
  const patientsResult = await pool.query(
    'SELECT id, full_name, gender, date_of_birth FROM patients ORDER BY full_name'
  );

  const patientCount = patientsResult.rows.length;
  const patientList = patientsResult.rows.map((p, i) =>
    `${i + 1}. ${p.full_name} (${p.gender || 'Unknown'}, DOB: ${p.date_of_birth || 'Unknown'}, ID: ${p.id})`
  ).join('\n');

  // Replace placeholders in template
  let prompt = agenticSystemPromptTemplate
    .replace(/\{\{MAX_ITERATIONS\}\}/g, maxIterations)
    .replace(/\{\{SCHEMA_CONTEXT\}\}/g, schemaContext);

  // Add patient context section (v3.2)
  const patientContextSection = `

## Patient Context (Pre-loaded)

At the start of each conversation, you have access to:

**Patient Count:** ${patientCount}
**Patient List:**
${patientList || 'No patients in database'}

This information is pre-loaded. Do NOT query \`SELECT COUNT(*) FROM patients\` - use the pre-loaded count above.
`;

  // Insert patient context section after the schema context
  prompt = prompt + patientContextSection;

  return {
    prompt,
    patientCount,
    patients: patientsResult.rows
  };
}

/**
 * Execute a tool call by name
 */
async function executeToolCall(toolName, params, options = {}) {
  switch (toolName) {
    case 'fuzzy_search_parameter_names':
      return await fuzzySearchParameterNames(params.search_term, params.limit);

    case 'fuzzy_search_analyte_names':
      return await fuzzySearchAnalyteNames(params.search_term, params.limit);

    case 'execute_exploratory_sql':
      return await executeExploratorySql(params.sql, params.reasoning, options);

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
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
    metadata,
    // v3.2: Conversational fields
    sessionId = null,
    conversationTurns = 1,
    clarificationCount = 0,
  } = data;

  try {
    // Insert with v3.2 conversational columns
    await pool.query(
      `INSERT INTO sql_generation_logs
       (id, status, user_id_hash, prompt, generated_sql, metadata, created_at,
        session_id, conversation_turns, clarification_count)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW(), $6, $7, $8)`,
      [
        status,
        userHash,
        question,
        sql,
        JSON.stringify(metadata),
        sessionId,
        conversationTurns,
        clarificationCount,
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
      session_id: sessionId,
      conversation_turns: conversationTurns,
      clarification_count: clarificationCount,
      metadata
    }, '[agenticCore] SQL generation audit log');
  } catch (error) {
    logger.error({
      error: error.message,
      request_id: requestId,
    }, '[agenticCore] Failed to log SQL generation');
  }
}

/**
 * Handle final query with validation
 * PRD v3.2: Includes patient scope validation when multiple patients exist
 */
async function handleFinalQuery(
  params,
  sessionMetadata,
  startTime
) {
  let { sql, explanation, confidence, query_type, plot_metadata, plot_title } = params;
  const {
    userIdentifier,
    requestId,
    question,
    schemaSnapshotId,
    selectedPatientId = null,
    patientCount = 0,
    sessionId = null,
    conversationTurns = 1,
    clarificationCount = 0,
    iterationLog = []
  } = sessionMetadata;

  // Extract plot_title from plot_metadata if nested there
  if (!plot_title && plot_metadata && plot_metadata.plot_title) {
    plot_title = plot_metadata.plot_title;
    delete plot_metadata.plot_title;
  }

  // Default query_type to 'data_query' if not specified
  query_type = query_type || 'data_query';

  // Apply plot_metadata defaults if missing (safety net)
  if (query_type === 'plot_query' && !plot_metadata) {
    logger.info({
      request_id: requestId,
      message: 'Applying default plot_metadata'
    }, '[agenticCore] Using fallback plot metadata');

    plot_metadata = {
      x_axis: 't',
      y_axis: 'y',
      series_by: 'unit'
    };
  }

  // Strip trailing comments
  if (sql) {
    const lastSemicolon = sql.lastIndexOf(';');
    if (lastSemicolon !== -1) {
      const afterSemicolon = sql.substring(lastSemicolon + 1).trim();
      if (afterSemicolon && /^--/.test(afterSemicolon)) {
        sql = sql.substring(0, lastSemicolon + 1);
        logger.debug({}, '[agenticCore] Stripped trailing comments from SQL');
      }
    }
  }

  logger.debug({
    sql_preview: sql?.substring(0, 100),
    confidence,
    query_type,
  }, '[agenticCore] Handling final query');

  // Validate SQL
  const validation = await validateSQL(sql, { schemaSnapshotId, queryType: query_type });

  if (!validation.valid) {
    logger.warn({
      violations: validation.violations,
    }, '[agenticCore] Final query validation failed');

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
      sessionId,
      conversationTurns,
      clarificationCount,
      metadata: {
        agentic_mode: true,
        iterations: iterationLog,
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

  // PRD v3.2: Validate patient scope when multiple patients exist
  const sqlValidator = require('./sqlValidator');
  const patientScope = sqlValidator.ensurePatientScope ?
    sqlValidator.ensurePatientScope(validation.sqlWithLimit, selectedPatientId, patientCount) :
    { valid: true }; // Fallback if method doesn't exist yet

  if (!patientScope.valid) {
    logger.warn({
      violation: patientScope.violation,
      selected_patient_id: selectedPatientId,
      patient_count: patientCount,
    }, '[agenticCore] Patient scope validation failed');

    const durationMs = Date.now() - startTime;
    const userHash = createHash(userIdentifier);
    const sqlHash = createHash(validation.sqlWithLimit);

    await logSqlGeneration({
      status: 'failed',
      userHash,
      requestId,
      question,
      sql: validation.sqlWithLimit,
      sqlHash,
      validationOutcome: 'rejected',
      schemaSnapshotId,
      sessionId,
      conversationTurns,
      clarificationCount,
      metadata: {
        agentic_mode: true,
        iterations: iterationLog,
        patient_scope_violation: patientScope.violation,
        confidence,
        total_duration_ms: durationMs,
      }
    });

    return {
      ok: false,
      error: {
        code: patientScope.violation.code,
        message: patientScope.violation.message
      },
      metadata: {
        total_iterations: iterationLog.length,
        duration_ms: durationMs,
        schema_snapshot_id: schemaSnapshotId
      }
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

  // Log success
  await logSqlGeneration({
    status: 'success',
    userHash,
    requestId,
    question,
    sql: safeSql,
    sqlHash,
    validationOutcome: 'accepted',
    schemaSnapshotId,
    sessionId,
    conversationTurns,
    clarificationCount,
    metadata: {
      agentic_mode: true,
      iterations: iterationLog,
      confidence,
      total_iterations: iterationLog.length,
      total_duration_ms: durationMs,
    }
  });

  // Build response object
  const response = {
    ok: true,
    sql: safeSql,
    explanation: explanation || null,
    metadata: {
      tokens: { prompt: 0, completion: 0, total: 0 },
      duration_ms: durationMs,
      schema_snapshot_id: schemaSnapshotId,
      validator: validation.validator,
      agentic: {
        iterations: iterationLog.length,
      }
    }
  };

  // Add query_type and plot_metadata for plot queries
  if (query_type === 'plot_query') {
    response.query_type = 'plot_query';
    response.plot_metadata = plot_metadata;
    if (plot_title) {
      response.plot_title = plot_title;
    }
  } else {
    response.query_type = 'data_query';
  }

  return response;
}

module.exports = {
  buildSystemPrompt,
  executeToolCall,
  handleFinalQuery,
  logSqlGeneration,
};
