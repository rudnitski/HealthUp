// server/services/agenticCore.js
// Core logic for agentic SQL generation - shared between job-based and streaming modes
// PRD: docs/PRD_v3_2_conversational_sql_assistant.md

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { pool, queryWithUser } from '../db/index.js';
import { validateSQL, ensurePatientScope } from './sqlValidator.js';
import { updateMRU } from './schemaSnapshot.js';
import {
  fuzzySearchParameterNames,
  fuzzySearchAnalyteNames,
  executeExploratorySql,
} from './agenticTools.js';
import { getDirname } from '../utils/path-helpers.js';

const __dirname = getDirname(import.meta.url);

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
 * PRD v4.3: Added mode parameter for chat vs legacy behavior
 * PRD v4.4.3: Added userId parameter for RLS context
 *
 * @param {string} schemaContext - Schema snapshot formatted as markdown
 * @param {number} maxIterations - Maximum iteration limit for agentic loop
 * @param {string} mode - 'chat' (pre-selected patient) or 'legacy' (full patient list)
 * @param {string|null} selectedPatientId - Patient ID for chat mode (required if mode='chat')
 * @param {string|null} userId - User ID for RLS context
 * @returns {object} { prompt, patientCount, patients }
 */
async function buildSystemPrompt(schemaContext, maxIterations, mode = 'legacy', selectedPatientId = null, userId = null) {
  if (!agenticSystemPromptTemplate) {
    throw new Error('Agentic system prompt template not loaded. Check prompts/agentic_sql_generator_system_prompt.txt');
  }

  // Replace placeholders in template
  let prompt = agenticSystemPromptTemplate
    .replace(/\{\{MAX_ITERATIONS\}\}/g, maxIterations)
    .replace(/\{\{SCHEMA_CONTEXT\}\}/g, schemaContext);

  if (mode === 'chat') {
    // PRD v4.3: Chat mode - inject selected patient with demographics
    if (selectedPatientId) {
      // PRD v4.4.3: Use queryWithUser for RLS-scoped access
      const patientQuery = `
        SELECT
          full_name,
          gender,
          date_of_birth,
          CASE
            WHEN date_of_birth IS NOT NULL AND date_of_birth ~ '^\\d{4}-\\d{2}-\\d{2}$'
            THEN EXTRACT(YEAR FROM AGE(CURRENT_DATE, date_of_birth::date))::int
            WHEN date_of_birth IS NOT NULL AND date_of_birth ~ '^\\d{2}/\\d{2}/\\d{4}$'
            THEN EXTRACT(YEAR FROM AGE(CURRENT_DATE, TO_DATE(date_of_birth, 'DD/MM/YYYY')))::int
            ELSE NULL
          END AS age
        FROM patients
        WHERE id = $1
      `;
      const patientResult = userId
        ? await queryWithUser(patientQuery, [selectedPatientId], userId)
        : await pool.query(patientQuery, [selectedPatientId]);

      const patient = patientResult.rows[0] || {};
      const ageDisplay = patient.age ? `${patient.age} years` : 'Unknown';

      const patientContextSection = `

## Patient Context (Selected)

Selected Patient: ${patient.full_name || 'Unknown'}
- **Patient ID**: ${selectedPatientId}
- **Gender**: ${patient.gender || 'Unknown'}
- **Date of Birth**: ${patient.date_of_birth || 'Unknown'}
- **Age**: ${ageDisplay}

**CRITICAL**: Use ONLY this patient ID in all queries. Do NOT ask which patient to use.
All queries MUST filter by patient_id using either \`WHERE patient_id = '${selectedPatientId}'\` or \`WHERE patient_id IN ('${selectedPatientId}')\` syntax.

**IMPORTANT**: You already have the patient's gender and age above. Do NOT ask the user for this information - use what is provided.
When interpreting reference ranges that vary by age or gender, use the demographics above.
`;
      prompt = prompt + patientContextSection;
    } else {
      // No patient selected (schema-only queries when no patients exist)
      const noPatientSection = `

## Patient Context

No patient is currently selected. You can only answer questions about the database schema.
If the user asks about lab results or patient data, inform them they need to upload lab reports first.
`;
      prompt = prompt + noPatientSection;
    }

    // Return minimal context (patientCount/patients not needed for chat)
    return { prompt, patientCount: null, patients: [] };

  } else {
    // Legacy mode: load full patient list (original behavior)
    // PRD v4.4.3: Use queryWithUser for RLS-scoped access
    const patientsQuery = `
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
    `;
    const patientsResult = userId
      ? await queryWithUser(patientsQuery, [], userId)
      : await pool.query(patientsQuery);

    const patientCount = patientsResult.rows.length;
    // Use display_name to handle NULL full_name properly
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

    return {
      prompt,
      patientCount,
      patients: patientsResult.rows
    };
  }
}

/**
 * Execute a tool call by name
 * PRD v4.2.2: execute_sql replaces execute_exploratory_sql with query_type parameter
 * PRD v4.4.3: Added userId in options for RLS context
 */
async function executeToolCall(toolName, params, options = {}) {
  // PRD v4.4.3: Extract userId for RLS context
  const { userId } = options;

  switch (toolName) {
    case 'fuzzy_search_parameter_names':
      // PRD v4.4.3: Pass userId for RLS context (lab_results has RLS)
      return await fuzzySearchParameterNames(params.search_term, params.limit, userId);

    case 'fuzzy_search_analyte_names':
      // Note: analyte_aliases is a shared catalog, no RLS needed
      return await fuzzySearchAnalyteNames(params.search_term, params.limit);

    // PRD v4.2.2: New unified execute_sql tool with query_type parameter
    case 'execute_sql':
      return await executeExploratorySql(params.sql, params.reasoning, {
        ...options,
        query_type: params.query_type || 'explore'
      });

    // Backward compatibility: support old tool name
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
    // v3.2: Conversational session tracking
    sessionId = null,
  } = data;

  try {
    // Insert with v3.2 session_id
    await pool.query(
      `INSERT INTO sql_generation_logs
       (id, status, user_id_hash, prompt, generated_sql, metadata, created_at, session_id)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW(), $6)`,
      [
        status,
        userHash,
        question,
        sql,
        JSON.stringify(metadata),
        sessionId,
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
  const patientScope = ensurePatientScope ?
    ensurePatientScope(validation.sqlWithLimit, selectedPatientId, patientCount) :
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

export {
  buildSystemPrompt,
  executeToolCall,
  handleFinalQuery,
  logSqlGeneration,
};
