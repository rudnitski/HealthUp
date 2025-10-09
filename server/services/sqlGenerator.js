const OpenAI = require('openai');
const crypto = require('crypto');
const { pool } = require('../db');

const DEFAULT_MODEL = process.env.SQL_GENERATOR_MODEL || 'gpt-5-mini';
const SCHEMA_CACHE_TTL_MS = Number.isFinite(Number(process.env.SQL_SCHEMA_CACHE_TTL_MS))
  ? Number(process.env.SQL_SCHEMA_CACHE_TTL_MS)
  : 24 * 60 * 60 * 1000; // 24 hours
const QUESTION_MAX_LENGTH = 500;
const DISALLOWED_KEYWORD_PATTERN = /\b(insert|update|delete|drop|alter|truncate|grant|revoke)\b/i;
const RUSSIAN_CHAR_PATTERN = /[А-Яа-яЁё]/;

let openAiClient;
let cachedSchemaSummary = null;

class SqlGeneratorError extends Error {
  constructor(message, { status = 500, code } = {}) {
    super(message);
    this.name = 'SqlGeneratorError';
    this.status = status;
    this.code = code;
  }
}

const getOpenAiClient = () => {
  if (!process.env.OPENAI_API_KEY) {
    throw new SqlGeneratorError('OpenAI API key is not configured', { status: 500, code: 'missing_api_key' });
  }

  if (!openAiClient) {
    openAiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  return openAiClient;
};

const createHash = (value) => {
  if (!value) {
    return null;
  }

  return crypto.createHash('sha256').update(String(value)).digest('hex');
};

const normalizeQuestion = (input) => {
  if (typeof input !== 'string') {
    return '';
  }

  return input.replace(/\s+/g, ' ').trim();
};

const detectLanguage = (question) => (RUSSIAN_CHAR_PATTERN.test(question) ? 'ru' : 'en');

const fetchSchemaFromDb = async () => {
  const { rows } = await pool.query(
    `
    SELECT
      table_name,
      column_name,
      data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
    `,
  );

  const tables = rows.reduce((acc, row) => {
    const tableName = row.table_name;
    if (!acc[tableName]) {
      acc[tableName] = [];
    }

    acc[tableName].push({ column: row.column_name, type: row.data_type });
    return acc;
  }, {});

  const formatted = Object.entries(tables)
    .sort(([tableA], [tableB]) => tableA.localeCompare(tableB))
    .map(([tableName, columns]) => {
      const columnDescriptions = columns
        .slice(0, 24)
        .map((entry) => `${entry.column} (${entry.type})`)
        .join(', ');

      const extraColumns = columns.length > 24 ? ` … +${columns.length - 24} more` : '';
      return `- ${tableName}: ${columnDescriptions}${extraColumns}`;
    })
    .join('\n');

  return {
    summary: formatted || 'No schema information available.',
    fetchedAt: Date.now(),
  };
};

const getSchemaSummary = async () => {
  const now = Date.now();

  if (cachedSchemaSummary && now - cachedSchemaSummary.fetchedAt < SCHEMA_CACHE_TTL_MS) {
    return cachedSchemaSummary.summary;
  }

  try {
    cachedSchemaSummary = await fetchSchemaFromDb();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[sqlGenerator] Failed to fetch schema metadata:', error);
    cachedSchemaSummary = {
      summary: 'Schema metadata is temporarily unavailable.',
      fetchedAt: now,
    };
  }

  return cachedSchemaSummary.summary;
};

const structuredOutputFormat = {
  type: 'json_schema',
  name: 'healthup_sql_generation',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      query: { type: 'string' },
      confidence: { anyOf: [{ type: 'number' }, { type: 'null' }] },
      notes: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      warnings: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['query', 'confidence', 'notes', 'warnings'],
  },
};

const systemPrompt = [
  'You are a senior analytics engineer for HealthUp.',
  'Generate safe, read-only PostgreSQL queries that analysts can copy and run later.',
  'Never produce statements that modify data (`INSERT`, `UPDATE`, `DELETE`, DDL, etc.).',
  'If the request cannot be answered, return an empty string for query and explain why in notes.',
  'Prefer explicit column selection over `SELECT *` when feasible.',
  'If no LIMIT is provided, add `LIMIT 200` as a safeguard unless aggregation makes it unnecessary.',
  'Ensure temporal phrases use CURRENT_DATE and appropriate intervals.',
  'Assume all tables live in the public schema.',
].join(' ');

const buildUserPrompt = ({ question, language, schemaSummary }) => {
  const languageLabel = language === 'ru' ? 'Russian' : 'English';
  return [
    `User question (${languageLabel}):`,
    question,
    '',
    'Available tables and columns:',
    schemaSummary,
    '',
    'Return JSON with fields:',
    '- query: the SQL statement (string)',
    '- confidence: optional number between 0 and 1 (use null if unsure)',
    '- notes: optional short explanation or caveats',
    '- warnings: optional array of cautionary strings',
    '',
    'Always respond in JSON adhering to the requested schema.',
    language === 'ru'
      ? 'Use Russian comments only when necessary for clarity; SQL keywords remain in English.'
      : 'Use English for SQL keywords.',
  ].join('\n');
};

const logGeneration = async ({
  status,
  userHash,
  question,
  language,
  sql,
  model,
  confidence,
  latencyMs,
  error,
  metadata,
}) => {
  const id = crypto.randomUUID();
  const payload = [
    'INSERT INTO sql_generation_logs (id, status, user_id_hash, prompt, prompt_language, generated_sql, model, confidence, latency_ms, error, metadata)',
    'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
  ].join(' ');

  try {
    await pool.query(payload, [
      id,
      status,
      userHash,
      question,
      language,
      sql,
      model,
      confidence,
      latencyMs,
      error,
      metadata ? JSON.stringify(metadata) : null,
    ]);
  } catch (loggingError) {
    // eslint-disable-next-line no-console
    console.error('[sqlGenerator] Failed to log generation:', loggingError);
  }
};

const ensureQueryIsSafe = (sql) => {
  if (!sql) {
    throw new SqlGeneratorError('The model did not return a SQL query', { status: 502, code: 'empty_query' });
  }

  if (DISALLOWED_KEYWORD_PATTERN.test(sql)) {
    throw new SqlGeneratorError('Generated SQL contains disallowed operations', { status: 502, code: 'unsafe_sql' });
  }

  if (!/^\s*(select|with)\b/i.test(sql)) {
    throw new SqlGeneratorError('Generated SQL must start with SELECT or WITH', { status: 502, code: 'invalid_sql' });
  }

  if (sql.includes(';')) {
    throw new SqlGeneratorError('Generated SQL must not contain semicolons', { status: 502, code: 'multi_statement' });
  }
};

const stripTrailingSemicolons = (sql) => {
  if (typeof sql !== 'string') {
    return '';
  }

  return sql.replace(/;+(\s*)$/, '$1').trim();
};

const generateSqlQuery = async ({ question, userIdentifier }) => {
  const startedAt = Date.now();
  const normalizedQuestion = normalizeQuestion(question);

  if (!normalizedQuestion) {
    throw new SqlGeneratorError('Question is required', { status: 400, code: 'missing_question' });
  }

  if (normalizedQuestion.length > QUESTION_MAX_LENGTH) {
    throw new SqlGeneratorError(`Question exceeds ${QUESTION_MAX_LENGTH} characters`, {
      status: 400,
      code: 'question_too_long',
    });
  }

  if (DISALLOWED_KEYWORD_PATTERN.test(normalizedQuestion)) {
    throw new SqlGeneratorError('Only read-only queries are supported', { status: 400, code: 'disallowed_keywords' });
  }

  const language = detectLanguage(normalizedQuestion);
  const schemaSummary = await getSchemaSummary();
  const client = getOpenAiClient();

  const requestPayload = {
    model: DEFAULT_MODEL,
    input: [
      {
        role: 'system',
        content: [{ type: 'input_text', text: systemPrompt }],
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: buildUserPrompt({ question: normalizedQuestion, language, schemaSummary }) }],
      },
    ],
    text: {
      format: structuredOutputFormat,
    },
    metadata: {
      source: 'sql-generator',
      language,
    },
  };

  let response;

  try {
    response = await client.responses.parse(requestPayload);
  } catch (error) {
    if (error instanceof SyntaxError) {
      response = await client.responses.create(requestPayload);
    } else {
      throw error;
    }
  }

  const parsed = response?.output_parsed;
  const rawQuery = typeof parsed?.query === 'string' ? parsed.query.trim() : '';
  const confidence = Number.isFinite(parsed?.confidence) ? parsed.confidence : null;
  const notes = typeof parsed?.notes === 'string' ? parsed.notes.trim() : null;
  const warnings = Array.isArray(parsed?.warnings)
    ? parsed.warnings.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
    : [];

  const sanitizedQuery = stripTrailingSemicolons(rawQuery);

  ensureQueryIsSafe(sanitizedQuery);

  const latencyMs = Date.now() - startedAt;

  const metadata = warnings.length ? { warnings } : null;
  const userHash = createHash(userIdentifier || 'anonymous');

  await logGeneration({
    status: 'success',
    userHash,
    question: normalizedQuestion,
    language,
    sql: rawQuery,
    model: response?.model || DEFAULT_MODEL,
    confidence,
    latencyMs,
    error: null,
    metadata,
  });

  return {
    question: normalizedQuestion,
    language,
    sql: sanitizedQuery,
    confidence,
    notes: notes || null,
    warnings,
    model: response?.model || DEFAULT_MODEL,
    latency_ms: latencyMs,
    generated_at: new Date().toISOString(),
  };
};

const handleGeneration = async (params) => {
  try {
    return await generateSqlQuery(params);
  } catch (error) {
    const latencyMs = Date.now() - (params.startedAt || Date.now());
    const userHash = createHash(params.userIdentifier || 'anonymous');
    const normalizedQuestion = normalizeQuestion(params.question);

    await logGeneration({
      status: 'error',
      userHash,
      question: normalizedQuestion,
      language: normalizedQuestion ? detectLanguage(normalizedQuestion) : 'unknown',
      sql: null,
      model: DEFAULT_MODEL,
      confidence: null,
      latencyMs,
      error: error?.message || 'Unknown error',
      metadata: null,
    });

    if (error instanceof SqlGeneratorError) {
      throw error;
    }

    // eslint-disable-next-line no-console
    console.error('[sqlGenerator] Unexpected error during SQL generation:', error);
    throw new SqlGeneratorError('Unable to generate SQL at this time', { status: 502, code: 'generation_failed' });
  }
};

module.exports = {
  handleGeneration,
  SqlGeneratorError,
};
