import OpenAI from 'openai';
import crypto from 'crypto';
import { pool } from '../db/index.js';
import { getSchemaSnapshot, updateMRU } from './schemaSnapshot.js';
import { validateSQL } from './sqlValidator.js';
import { buildSchemaSection, buildPrompt } from './promptBuilder.js';
import { generateSqlWithAgenticLoop } from './agenticSqlGenerator.js';
import logger from '../utils/logger.js';

// Configuration
const SQL_GENERATION_ENABLED = process.env.SQL_GENERATION_ENABLED !== 'false';
const AGENTIC_SQL_ENABLED = process.env.AGENTIC_SQL_ENABLED === 'true';
const DEFAULT_MODEL = process.env.SQL_GENERATOR_MODEL || 'gpt-5-mini';
const ALLOW_MODEL_OVERRIDE = process.env.ALLOW_MODEL_OVERRIDE === 'true';
const QUESTION_MAX_LENGTH = 500;
const RUSSIAN_CHAR_PATTERN = /[А-Яа-яЁё]/;

let openAiClient;

class SqlGeneratorError extends Error {
  constructor(message, { status = 500, code } = {}) {
    super(message);
    this.name = 'SqlGeneratorError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Get OpenAI client
 */
const getOpenAiClient = () => {
  if (!process.env.OPENAI_API_KEY) {
    throw new SqlGeneratorError('OpenAI API key is not configured', { status: 500, code: 'MISSING_API_KEY' });
  }

  if (!openAiClient) {
    openAiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
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
 * Normalize question
 */
const normalizeQuestion = (input) => {
  if (typeof input !== 'string') return '';
  return input.replace(/\s+/g, ' ').trim();
};

/**
 * Detect language
 */
const detectLanguage = (question) => (RUSSIAN_CHAR_PATTERN.test(question) ? 'ru' : 'en');

/**
 * Audit log SQL generation
 */
async function auditLog({ userHash, requestId, question, sql, sqlHash, validationOutcome, schemaSnapshotId, metadata }) {
  const logEntry = {
    event_type: 'sql_generation',
    timestamp: new Date().toISOString(),
    request_id: requestId,
    user_hash: userHash,
    question,
    sql_hash: sqlHash,
    validation_outcome: validationOutcome,
    schema_snapshot_id: schemaSnapshotId,
    metadata,
  };

  logger.info(logEntry, '[sqlGenerator] SQL generation audit log');

  // TODO: Optionally write to security.audit.jsonl file
}

/**
 * Generate SQL query
 */
const generateSqlQuery = async ({ question, userIdentifier, model }) => {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const normalizedQuestion = normalizeQuestion(question);

  // Check feature flag
  if (!SQL_GENERATION_ENABLED) {
    throw new SqlGeneratorError('SQL generation is currently disabled', { status: 503, code: 'FEATURE_DISABLED' });
  }

  // Validate input
  if (!normalizedQuestion) {
    throw new SqlGeneratorError('Question is required', { status: 400, code: 'BAD_REQUEST' });
  }

  if (normalizedQuestion.length > QUESTION_MAX_LENGTH) {
    throw new SqlGeneratorError(`Question exceeds ${QUESTION_MAX_LENGTH} characters`, {
      status: 400,
      code: 'BAD_REQUEST',
    });
  }

  const language = detectLanguage(normalizedQuestion);

  // Get schema snapshot
  const { manifest, snapshotId: schemaSnapshotId } = await getSchemaSnapshot();

  // Build schema section with table ranking
  const schemaSummary = buildSchemaSection(manifest, normalizedQuestion);

  // NEW: Check if agentic mode is enabled
  if (AGENTIC_SQL_ENABLED) {
    logger.info({ request_id: requestId, mode: 'agentic' }, '[sqlGenerator] Using agentic mode');

    return await generateSqlWithAgenticLoop({
      question: normalizedQuestion,
      userIdentifier,
      model: ALLOW_MODEL_OVERRIDE && model ? model : DEFAULT_MODEL,
      schemaContext: schemaSummary,
      schemaSnapshotId,
    });
  }

  // Existing single-shot generation
  logger.info({ request_id: requestId, mode: 'single-shot' }, '[sqlGenerator] Using single-shot mode');

  // Build prompt
  const { systemPrompt, userPrompt } = buildPrompt({
    question: normalizedQuestion,
    schemaSummary,
    language,
  });

  // Call OpenAI
  const client = getOpenAiClient();
  const requestPayload = {
    model: ALLOW_MODEL_OVERRIDE && model ? model : DEFAULT_MODEL,
    input: [
      {
        role: 'system',
        content: [{ type: 'input_text', text: systemPrompt }],
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: userPrompt }],
      },
    ],
    reasoning: {
      effort: 'medium',
    },
    text: {
      format: {
        type: 'json_schema',
        name: 'healthup_sql_generation',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            sql: { type: 'string' },
            explanation: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          },
          required: ['sql', 'explanation'],
        },
      },
    },
    metadata: {
      source: 'sql-generator',
      language,
      request_id: requestId,
    },
  };

  // Log the full LLM request
  logger.info({
    request_id: requestId,
    model: requestPayload.model,
    system_prompt: systemPrompt,
    user_prompt: userPrompt,
    schema_snapshot_id: schemaSnapshotId,
  }, '[sqlGenerator] LLM Request');

  let response;
  try {
    response = await client.responses.parse(requestPayload);

    // Log the LLM response
    logger.info({
      request_id: requestId,
      model: response?.model,
      response: response?.output_parsed,
    }, '[sqlGenerator] LLM Response');
  } catch (error) {
    logger.error({ request_id: requestId, error: error.message }, '[sqlGenerator] LLM Request Failed');

    if (error instanceof SyntaxError) {
      response = await client.responses.create(requestPayload);
    } else {
      throw error;
    }
  }

  const parsed = response?.output_parsed;
  const rawSql = typeof parsed?.sql === 'string' ? parsed.sql.trim() : '';
  const explanation = typeof parsed?.explanation === 'string' ? parsed.explanation.trim() : null;

  if (!rawSql) {
    throw new SqlGeneratorError('The model did not return a SQL query', { status: 502, code: 'EMPTY_QUERY' });
  }

  // Log generated SQL for debugging
  logger.debug({ rawSql, question: normalizedQuestion }, '[sqlGenerator] Generated SQL before validation');

  // Validate SQL
  const validationResult = await validateSQL(rawSql, { schemaSnapshotId });

  if (!validationResult.valid) {
    const durationMs = Date.now() - startedAt;
    const userHash = createHash(userIdentifier || 'anonymous');
    const sqlHash = createHash(rawSql);

    // Audit log validation failure
    await auditLog({
      userHash,
      requestId,
      question: normalizedQuestion,
      sql: rawSql,
      sqlHash,
      validationOutcome: 'rejected',
      schemaSnapshotId,
      metadata: {
        violations: validationResult.violations,
        rule_version: validationResult.validator.ruleVersion,
      },
    });

    // Return 422 with structured error
    const hint = validationResult.violations.some((v) => v.code === 'FORBIDDEN_KEYWORD')
      ? 'Rephrase your question without administrative keywords.'
      : 'Try simplifying your question or breaking it into smaller parts.';

    return {
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Only single read-only SELECT statements are allowed.',
      },
      details: {
        violations: validationResult.violations,
        rule_version: validationResult.validator.ruleVersion,
        hint,
      },
      metadata: {
        model: response?.model || DEFAULT_MODEL,
        tokens: {
          prompt: 0, // TODO: Extract from response if available
          completion: 0,
          total: 0,
        },
        duration_ms: durationMs,
        schema_snapshot_id: schemaSnapshotId,
      },
    };
  }

  // SQL is valid
  const safeSql = validationResult.sqlWithLimit;
  const durationMs = Date.now() - startedAt;
  const userHash = createHash(userIdentifier || 'anonymous');
  const sqlHash = createHash(safeSql);

  // Audit log success
  await auditLog({
    userHash,
    requestId,
    question: normalizedQuestion,
    sql: safeSql,
    sqlHash,
    validationOutcome: 'accepted',
    schemaSnapshotId,
    metadata: {
      model: response?.model || DEFAULT_MODEL,
      explanation,
    },
  });

  // Update MRU cache with tables mentioned in the query
  // Extract table names from SQL (simple regex match)
  const tablePattern = /FROM\s+([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?)/gi;
  let match;
  while ((match = tablePattern.exec(safeSql)) !== null) {
    updateMRU(match[1]);
  }

  return {
    ok: true,
    sql: safeSql,
    explanation: explanation || null,
    metadata: {
      model: response?.model || DEFAULT_MODEL,
      tokens: {
        prompt: 0, // TODO: Extract from response if available
        completion: 0,
        total: 0,
      },
      duration_ms: durationMs,
      schema_snapshot_id: schemaSnapshotId,
      validator: validationResult.validator,
    },
  };
};

/**
 * Handle SQL generation with error handling
 */
const handleGeneration = async (params) => {
  try {
    return await generateSqlQuery(params);
  } catch (error) {
    if (error instanceof SqlGeneratorError) {
      throw error;
    }

    logger.error({ error }, '[sqlGenerator] Unexpected error during SQL generation');
    throw new SqlGeneratorError('Unexpected error generating SQL', { status: 500, code: 'UNEXPECTED_ERROR' });
  }
};

export {
  handleGeneration,
  SqlGeneratorError,
};
