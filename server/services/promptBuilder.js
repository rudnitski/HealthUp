import { encoding_for_model } from 'tiktoken';
import fs from 'fs';
import path from 'path';
import { getDirname } from '../utils/path-helpers.js';
import { getMRUScore } from './schemaSnapshot.js';

const __dirname = getDirname(import.meta.url);

// Configuration
const SCHEMA_TOKEN_BUDGET = 8000; // Increased from 6000 to accommodate column descriptions
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
      .map((col) => {
        let colStr = `${col.name} (${col.type})${col.nullable ? ' nullable' : ''}`;
        // Include description if present (helps LLM understand column usage)
        if (col.description) {
          colStr += ` -- ${col.description}`;
        }
        return colStr;
      })
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

export {
  buildSchemaSection,
  extractEntities,
  rankTables,
  countTokens,
};
