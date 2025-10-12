const { encoding_for_model } = require('tiktoken');
const fs = require('fs');
const path = require('path');
const { getMRUScore } = require('./schemaSnapshot');

// Configuration
const SCHEMA_TOKEN_BUDGET = 6000;
const MAX_TABLES = 25;
const MAX_COLUMNS_PER_TABLE = 60;

// Load schema aliases
let schemaAliases = {};
try {
  const aliasPath = path.join(__dirname, '../../config/schema_aliases.json');
  schemaAliases = JSON.parse(fs.readFileSync(aliasPath, 'utf8'));
} catch (error) {
  console.warn('[promptBuilder] Failed to load schema_aliases.json:', error.message);
}

const PROMPTS_DIR = path.join(__dirname, '../../prompts');
const SYSTEM_PROMPT_PATH = path.join(PROMPTS_DIR, 'sql_generator_system_prompt.txt');
const USER_PROMPT_PATH = path.join(PROMPTS_DIR, 'sql_generator_user_prompt.txt');

let systemPromptTemplate = null;
let userPromptTemplate = null;

try {
  systemPromptTemplate = fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf8');
} catch (error) {
  console.warn('[promptBuilder] Failed to load system prompt template:', error.message);
}

try {
  userPromptTemplate = fs.readFileSync(USER_PROMPT_PATH, 'utf8');
} catch (error) {
  console.warn('[promptBuilder] Failed to load user prompt template:', error.message);
}

/**
 * Reload schema aliases (call after cache bust)
 */
function reloadSchemaAliases() {
  try {
    const aliasPath = path.join(__dirname, '../../config/schema_aliases.json');
    delete require.cache[require.resolve(aliasPath)];
    schemaAliases = JSON.parse(fs.readFileSync(aliasPath, 'utf8'));
    console.info('[promptBuilder] Schema aliases reloaded');
  } catch (error) {
    console.error('[promptBuilder] Failed to reload schema_aliases.json:', error.message);
  }
}

/**
 * Count tokens using tiktoken
 */
function countTokens(text, model = 'gpt-4') {
  try {
    const encoding = encoding_for_model(model);
    const tokens = encoding.encode(text);
    encoding.free();
    return tokens.length;
  } catch (error) {
    // Fallback: rough estimation (1 token ≈ 4 characters)
    return Math.ceil(text.length / 4);
  }
}

/**
 * Extract entities from user question using schema aliases
 */
function extractEntities(question) {
  const normalizedQuestion = question.toLowerCase();
  const matchedTables = new Set();

  Object.entries(schemaAliases).forEach(([phrase, tables]) => {
    if (normalizedQuestion.includes(phrase.toLowerCase())) {
      tables.forEach((table) => {
        // Extract table name (handle "schema.table" or just "table")
        const tableName = table.split('.')[0];
        matchedTables.add(tableName);
      });
    }
  });

  return Array.from(matchedTables);
}

/**
 * Check if tables are linked by foreign keys
 */
function getLinkedTables(tableName, manifest) {
  const linked = new Set();

  manifest.tables.forEach((table) => {
    const fullName = `${table.schema}.${table.name}`;

    // Check if this table has FK to tableName
    table.foreignKeys.forEach((fk) => {
      if (fk.referencesTable.includes(tableName) || fk.referencesTable.endsWith(`.${tableName}`)) {
        linked.add(fullName);
      }
    });

    // Check if tableName has FK to this table
    const targetTable = manifest.tables.find((t) => t.name === tableName);
    if (targetTable) {
      targetTable.foreignKeys.forEach((fk) => {
        if (fk.referencesTable === fullName || fk.referencesTable.endsWith(`.${table.name}`)) {
          linked.add(fullName);
        }
      });
    }
  });

  return Array.from(linked);
}

/**
 * Rank tables based on heuristics
 */
function rankTables(manifest, question) {
  const entities = extractEntities(question);
  const normalizedQuestion = question.toLowerCase();

  const rankings = manifest.tables.map((table) => {
    const fullName = `${table.schema}.${table.name}`;
    let score = 0;

    // 1. Exact match with extracted entities
    if (entities.includes(table.name)) {
      score += 100;
    }

    // 2. Table name appears in question
    if (normalizedQuestion.includes(table.name.toLowerCase())) {
      score += 80;
    }

    // 3. Column names match question words
    const questionWords = normalizedQuestion.split(/\s+/).filter((w) => w.length > 3);
    table.columns.forEach((col) => {
      questionWords.forEach((word) => {
        if (col.name.toLowerCase().includes(word) || word.includes(col.name.toLowerCase())) {
          score += 5;
        }
      });
    });

    // 4. Foreign key relationships to highly ranked tables
    if (entities.length > 0) {
      const linkedTables = getLinkedTables(table.name, manifest);
      linkedTables.forEach((linked) => {
        entities.forEach((entity) => {
          if (linked.includes(entity)) {
            score += 30;
          }
        });
      });
    }

    // 5. MRU cache boost
    const mruScore = getMRUScore(fullName);
    score += mruScore * 2;

    return {
      table,
      fullName,
      score,
    };
  });

  // Sort by score descending
  rankings.sort((a, b) => b.score - a.score);

  return rankings;
}

/**
 * Calculate TF-IDF style score for columns
 */
function scoreColumns(columns, question, totalTables) {
  const questionWords = question.toLowerCase().split(/\s+/).filter((w) => w.length > 2);

  return columns.map((col) => {
    let score = 0;

    // Term frequency: how many question words match this column
    questionWords.forEach((word) => {
      if (col.name.toLowerCase().includes(word) || word.includes(col.name.toLowerCase())) {
        score += 1;
      }
    });

    // Inverse document frequency: prefer unique column names
    // (simplified: columns with common names like "id", "created_at" get lower scores)
    const commonColumns = ['id', 'created_at', 'updated_at', 'deleted_at'];
    if (commonColumns.some((common) => col.name.toLowerCase().includes(common))) {
      score *= 0.5;
    }

    return {
      ...col,
      score,
    };
  });
}

/**
 * Trim columns to fit token budget
 */
function trimColumns(table, question, totalTables, tokenBudget) {
  const scoredColumns = scoreColumns(table.columns, question, totalTables);

  // Sort by score descending
  scoredColumns.sort((a, b) => b.score - a.score);

  // Keep up to MAX_COLUMNS_PER_TABLE or until we hit token budget
  const selected = [];
  let currentTokens = 0;

  for (let i = 0; i < scoredColumns.length && i < MAX_COLUMNS_PER_TABLE; i += 1) {
    const col = scoredColumns[i];
    const colText = `${col.name} (${col.type})${col.nullable ? ' nullable' : ''}`;
    const colTokens = countTokens(colText);

    if (currentTokens + colTokens <= tokenBudget) {
      selected.push(col);
      currentTokens += colTokens;
    } else {
      break;
    }
  }

  return selected;
}

/**
 * Build schema section for prompt
 */
function buildSchemaSection(manifest, question) {
  const rankedTables = rankTables(manifest, question);

  // Ensure explicitly mentioned tables are included
  const explicitlyMentioned = extractEntities(question);
  const mustInclude = new Set();

  rankedTables.forEach((item) => {
    if (explicitlyMentioned.some((entity) => item.fullName.includes(entity))) {
      mustInclude.add(item.fullName);
    }
  });

  const schemaLines = [];
  let totalTokens = 0;
  let includedTables = 0;
  let truncationOccurred = false;

  for (let i = 0; i < rankedTables.length; i += 1) {
    if (includedTables >= MAX_TABLES && !mustInclude.has(rankedTables[i].fullName)) {
      truncationOccurred = true;
      break;
    }

    const { table, fullName, score } = rankedTables[i];

    // Estimate tokens for this table
    const tableName = `${table.schema}.${table.name}`;
    const tableTokenBudget = Math.floor(SCHEMA_TOKEN_BUDGET / MAX_TABLES);

    const trimmedColumns = trimColumns(table, question, manifest.tables.length, tableTokenBudget);

    if (trimmedColumns.length === 0 && !mustInclude.has(fullName)) {
      continue;
    }

    const columnsList = trimmedColumns
      .map((col) => `${col.name} (${col.type})${col.nullable ? ' nullable' : ''}`)
      .join(', ');

    const fkInfo = table.foreignKeys.length > 0
      ? ` [FK: ${table.foreignKeys.map((fk) => `${fk.column} → ${fk.referencesTable}`).join(', ')}]`
      : '';

    const tableText = `- ${tableName}: ${columnsList}${fkInfo}`;
    const tableTokens = countTokens(tableText);

    if (totalTokens + tableTokens > SCHEMA_TOKEN_BUDGET && !mustInclude.has(fullName)) {
      truncationOccurred = true;
      break;
    }

    schemaLines.push(tableText);
    totalTokens += tableTokens;
    includedTables += 1;
  }

  if (truncationOccurred) {
    console.warn(`[promptBuilder] Schema truncated: included ${includedTables}/${rankedTables.length} tables`);
  }

  return schemaLines.join('\n');
}

/**
 * Build complete prompt for SQL generation
 */
function buildPrompt({ question, schemaSummary, language = 'en' }) {
  const languageLabel = language === 'ru' ? 'Russian' : 'English';
  const languageNote = language === 'ru'
    ? 'Use Russian for explanation only; SQL keywords remain in English.'
    : 'Use English for SQL keywords and explanation.';

  const systemTemplate = systemPromptTemplate || `You are a PostgreSQL query generator for a health lab results database.
Generate safe, read-only SELECT queries based on the schema provided.

Safety rules:
- ONLY generate SELECT statements (or WITH...SELECT)
- Include LIMIT 50 or less
- No INSERT, UPDATE, DELETE, or DDL operations
- No functions that modify data or system state
- Use proper JOINs based on foreign key relationships
- NEVER use placeholders like :param, $1, or ? - queries must be executable as-is
- NEVER hardcode UUIDs like '00000000-0000-0000-0000-000000000000'
- For patient-specific queries, generate queries that work for ALL patients (no WHERE patient.id = ...)
- When user says "my" or "мои", generate a query for ALL patients (frontend will filter)
- Prefer the simplest SELECT that answers the question; avoid DISTINCT ON or UNION unless clearly required.

Response format:
- sql: the complete SQL query (must be executable without modification)
- explanation: brief explanation in {{LANGUAGE_LABEL}}

{{LANGUAGE_NOTE}}`;

  const userTemplate = userPromptTemplate || `Question ({{LANGUAGE_LABEL}}): {{QUESTION}}

Database Schema:
{{SCHEMA_SUMMARY}}

Generate a safe SQL query to answer the question.
IMPORTANT: Do NOT filter by specific patient ID. Generate queries that work for ALL patients.`;

  const systemPrompt = systemTemplate
    .replace(/{{LANGUAGE_LABEL}}/g, languageLabel)
    .replace(/{{LANGUAGE_NOTE}}/g, languageNote);

  const userPrompt = userTemplate
    .replace(/{{LANGUAGE_LABEL}}/g, languageLabel)
    .replace(/{{QUESTION}}/g, question)
    .replace(/{{SCHEMA_SUMMARY}}/g, schemaSummary);

  return {
    systemPrompt,
    userPrompt,
    totalTokens: countTokens(systemPrompt) + countTokens(userPrompt),
  };
}

module.exports = {
  buildSchemaSection,
  buildPrompt,
  extractEntities,
  rankTables,
  countTokens,
  reloadSchemaAliases,
};
