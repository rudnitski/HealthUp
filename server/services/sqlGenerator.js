import crypto from 'crypto';
import { getSchemaSnapshot, updateMRU } from './schemaSnapshot.js';
import { buildSchemaSection } from './promptBuilder.js';
import { generateSqlWithAgenticLoop } from './agenticSqlGenerator.js';
import logger from '../utils/logger.js';

// Configuration
const SQL_GENERATION_ENABLED = process.env.SQL_GENERATION_ENABLED !== 'false';
const DEFAULT_MODEL = process.env.SQL_GENERATOR_MODEL || 'gpt-5-mini';
const ALLOW_MODEL_OVERRIDE = process.env.ALLOW_MODEL_OVERRIDE === 'true';
const QUESTION_MAX_LENGTH = 500;
const RUSSIAN_CHAR_PATTERN = /[А-Яа-яЁё]/;

class SqlGeneratorError extends Error {
  constructor(message, { status = 500, code } = {}) {
    super(message);
    this.name = 'SqlGeneratorError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Normalize question
 */
const normalizeQuestion = (input) => {
  if (typeof input !== 'string') return '';
  return input.replace(/\s+/g, ' ').trim();
};

/**
 * Generate SQL query using agentic loop
 * PRD v4.4.3: Added userId parameter for RLS context
 */
const generateSqlQuery = async (params) => {
  const { question, userIdentifier, model, userId } = params;
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

  // Get schema snapshot
  const { manifest, snapshotId: schemaSnapshotId } = await getSchemaSnapshot();

  // Build schema section with table ranking
  const schemaSummary = buildSchemaSection(manifest, normalizedQuestion);

  logger.info({ request_id: requestId, mode: 'agentic' }, '[sqlGenerator] Using agentic mode');

  // Always use agentic loop (legacy single-shot path removed)
  return await generateSqlWithAgenticLoop({
    question: normalizedQuestion,
    userIdentifier,
    model: ALLOW_MODEL_OVERRIDE && model ? model : DEFAULT_MODEL,
    schemaContext: schemaSummary,
    schemaSnapshotId,
    userId,
  });
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
