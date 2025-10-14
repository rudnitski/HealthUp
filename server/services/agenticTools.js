// server/services/agenticTools.js
// Agentic SQL Generation - Tool Implementations
// PRD: docs/PRD_v2_0_agentic_sql_generation_mvp.md

const { pool } = require('../db');
const { validateSQL } = require('./sqlValidator');
const pino = require('pino');

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

// Configuration from environment
const AGENTIC_FUZZY_SEARCH_LIMIT = parseInt(process.env.AGENTIC_FUZZY_SEARCH_LIMIT) || 20;
const AGENTIC_EXPLORATORY_SQL_LIMIT = parseInt(process.env.AGENTIC_EXPLORATORY_SQL_LIMIT) || 20;
const AGENTIC_SIMILARITY_THRESHOLD = parseFloat(process.env.AGENTIC_SIMILARITY_THRESHOLD) || 0.3;

/**
 * Fuzzy search on lab_results.parameter_name using PostgreSQL trigram similarity
 *
 * This is a PRIVILEGED tool - uses parameterized queries, bypasses validator
 * Handles multilingual queries, typos, abbreviations, and mixed scripts automatically
 *
 * @param {string} searchTerm - Term to search for (any language, any script)
 * @param {number} limit - Maximum number of results (default from env)
 * @returns {Object} Search results with similarity scores
 */
async function fuzzySearchParameterNames(searchTerm, limit = AGENTIC_FUZZY_SEARCH_LIMIT) {
  if (!searchTerm || typeof searchTerm !== 'string') {
    throw new Error('search_term is required and must be a string');
  }

  const effectiveLimit = Math.min(limit || AGENTIC_FUZZY_SEARCH_LIMIT, 50); // Cap at 50
  const similarityThreshold = AGENTIC_SIMILARITY_THRESHOLD;

  logger.debug({
    search_term: searchTerm,
    limit: effectiveLimit,
    similarity_threshold: similarityThreshold,
  }, '[agenticTools] fuzzy_search_parameter_names');

  // Get a dedicated client for transaction
  const client = await pool.connect();

  try {
    // Begin transaction - required for SET LOCAL
    await client.query('BEGIN');

    // Set similarity threshold within transaction
    await client.query(`SET LOCAL pg_trgm.similarity_threshold = ${similarityThreshold}`);

    // Execute fuzzy search query
    const sql = `
      SELECT DISTINCT
        parameter_name,
        similarity(parameter_name, $1) as similarity_score
      FROM lab_results
      WHERE parameter_name % $1
      ORDER BY similarity_score DESC, parameter_name
      LIMIT $2
    `;

    const result = await client.query(sql, [searchTerm, effectiveLimit]);

    // Commit transaction
    await client.query('COMMIT');

    const response = {
      search_term: searchTerm,
      similarity_threshold: similarityThreshold,
      matches_found: result.rows.length,
      matches: result.rows.map(row => ({
        parameter_name: row.parameter_name,
        similarity: Math.round(row.similarity_score * 100) + '%'
      }))
    };

    logger.info({
      search_term: searchTerm,
      matches_found: result.rows.length,
      top_match: result.rows[0]?.parameter_name,
    }, '[agenticTools] fuzzy_search_parameter_names completed');

    return response;
  } catch (error) {
    // Rollback transaction on error
    await client.query('ROLLBACK').catch(() => {});

    logger.error({
      error: error.message,
      search_term: searchTerm,
    }, '[agenticTools] fuzzy_search_parameter_names failed');

    throw new Error(`Fuzzy search failed: ${error.message}`);
  } finally {
    // Always release client back to pool
    client.release();
  }
}

/**
 * Fuzzy search on analytes.name (optional for MVP)
 * Similar to parameter search but on analytes table
 *
 * @param {string} searchTerm - Term to search for
 * @param {number} limit - Maximum number of results
 * @returns {Object} Search results with similarity scores
 */
async function fuzzySearchAnalyteNames(searchTerm, limit = AGENTIC_FUZZY_SEARCH_LIMIT) {
  if (!searchTerm || typeof searchTerm !== 'string') {
    throw new Error('search_term is required and must be a string');
  }

  const effectiveLimit = Math.min(limit || AGENTIC_FUZZY_SEARCH_LIMIT, 50);
  const similarityThreshold = AGENTIC_SIMILARITY_THRESHOLD;

  logger.debug({
    search_term: searchTerm,
    limit: effectiveLimit,
    similarity_threshold: similarityThreshold,
  }, '[agenticTools] fuzzy_search_analyte_names');

  // Get a dedicated client for transaction
  const client = await pool.connect();

  try {
    // Begin transaction - required for SET LOCAL
    await client.query('BEGIN');

    // Set similarity threshold within transaction
    await client.query(`SET LOCAL pg_trgm.similarity_threshold = ${similarityThreshold}`);

    // Execute fuzzy search query
    const sql = `
      SELECT DISTINCT
        name as analyte_name,
        similarity(name, $1) as similarity_score
      FROM analytes
      WHERE name % $1
      ORDER BY similarity_score DESC, name
      LIMIT $2
    `;

    const result = await client.query(sql, [searchTerm, effectiveLimit]);

    // Commit transaction
    await client.query('COMMIT');

    const response = {
      search_term: searchTerm,
      similarity_threshold: similarityThreshold,
      matches_found: result.rows.length,
      matches: result.rows.map(row => ({
        analyte_name: row.analyte_name,
        similarity: Math.round(row.similarity_score * 100) + '%'
      }))
    };

    logger.info({
      search_term: searchTerm,
      matches_found: result.rows.length,
    }, '[agenticTools] fuzzy_search_analyte_names completed');

    return response;
  } catch (error) {
    // Rollback transaction on error
    await client.query('ROLLBACK').catch(() => {});

    logger.error({
      error: error.message,
      search_term: searchTerm,
    }, '[agenticTools] fuzzy_search_analyte_names failed');

    throw new Error(`Fuzzy search on analytes failed: ${error.message}`);
  } finally {
    // Always release client back to pool
    client.release();
  }
}

/**
 * Execute exploratory SQL with validation and limit enforcement
 *
 * This is a VALIDATED tool - all SQL goes through existing validator
 * Used for general data exploration when fuzzy search isn't enough
 *
 * @param {string} sql - Read-only SELECT query
 * @param {string} reasoning - Why this query is needed (for logging)
 * @param {Object} options - Additional options (schemaSnapshotId, etc.)
 * @returns {Object} Query results with metadata
 */
async function executeExploratorySql(sql, reasoning, options = {}) {
  if (!sql || typeof sql !== 'string') {
    throw new Error('sql is required and must be a string');
  }

  const exploratoryLimit = AGENTIC_EXPLORATORY_SQL_LIMIT;

  logger.debug({
    sql_preview: sql.substring(0, 100),
    reasoning,
  }, '[agenticTools] execute_exploratory_sql');

  try {
    // Step 1: Validate SQL safety (uses existing validator)
    const validation = await validateSQL(sql, options);

    if (!validation.valid) {
      const errorMsg = `SQL validation failed: ${validation.violations.map(v => `${v.code}: ${v.pattern || v.keyword || ''}`).join(', ')}`;

      logger.warn({
        sql,
        violations: validation.violations,
      }, '[agenticTools] execute_exploratory_sql validation failed');

      throw new Error(errorMsg);
    }

    // Step 2: Enforce exploratory limit (clamp to stricter limit if needed)
    // The validator injects LIMIT 50, but we want max 20 for exploratory queries
    // Only clamp DOWN if the existing limit is higher than our exploratory limit
    let safeSql = validation.sqlWithLimit;

    // Find the last (outermost) LIMIT clause (handles semicolons and whitespace)
    const limitMatch = safeSql.match(/\bLIMIT\s+(\d+)\s*;?\s*$/i);

    if (limitMatch) {
      const existingLimit = parseInt(limitMatch[1], 10);

      // Only replace if existing limit is HIGHER than our exploratory limit
      if (existingLimit > exploratoryLimit) {
        // Replace only the outermost/final LIMIT (at end of query)
        // Preserve semicolon if present
        const hasSemicolon = /;\s*$/.test(safeSql);
        safeSql = safeSql.replace(/\bLIMIT\s+\d+\s*;?\s*$/i, `LIMIT ${exploratoryLimit}${hasSemicolon ? ';' : ''}`);

        logger.debug({
          original_limit: existingLimit,
          clamped_to: exploratoryLimit,
        }, '[agenticTools] Clamped exploratory SQL limit');
      }
    } else {
      // Safety: if no LIMIT found (shouldn't happen after validator), add it
      const hasSemicolon = /;\s*$/.test(safeSql);
      if (hasSemicolon) {
        safeSql = safeSql.replace(/;\s*$/, ` LIMIT ${exploratoryLimit};`);
      } else {
        safeSql = `${safeSql.trim()} LIMIT ${exploratoryLimit}`;
      }
    }

    // Step 3: Execute query
    const result = await pool.query(safeSql);

    const response = {
      rows: result.rows,
      row_count: result.rowCount,
      reasoning,
      query_executed: safeSql,
      fields: result.fields?.map(f => f.name) || []
    };

    logger.info({
      row_count: result.rowCount,
      reasoning,
    }, '[agenticTools] execute_exploratory_sql completed');

    return response;
  } catch (error) {
    logger.error({
      error: error.message,
      sql,
      reasoning,
    }, '[agenticTools] execute_exploratory_sql failed');

    throw error;
  }
}

/**
 * Tool definitions for OpenAI function calling
 * These are used by the agentic orchestrator
 */
const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "fuzzy_search_parameter_names",
      description: "Search for lab test parameter names similar to a search term using PostgreSQL trigram similarity. Handles multilingual queries, typos, abbreviations, and mixed scripts automatically (e.g., finds 'витамин D' when searching for 'витамин д'). Use this FIRST for term searches like 'витамин д', 'холестерин', 'glucose', 'calcidiol'. Returns top matches with similarity scores.",
      parameters: {
        type: "object",
        properties: {
          search_term: {
            type: "string",
            description: "The term to search for (any language, any script)"
          },
          limit: {
            type: "integer",
            description: "Maximum number of results to return (default 20, max 50)",
            default: 20
          }
        },
        required: ["search_term"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "fuzzy_search_analyte_names",
      description: "Search for analyte names in the analytes table using fuzzy matching. Similar to parameter search but searches the canonical analyte names. Use when you need to find standardized analyte identifiers.",
      parameters: {
        type: "object",
        properties: {
          search_term: {
            type: "string",
            description: "The analyte name to search for"
          },
          limit: {
            type: "integer",
            description: "Maximum number of results to return (default 20, max 50)",
            default: 20
          }
        },
        required: ["search_term"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "execute_exploratory_sql",
      description: "Execute a read-only SELECT query to explore data structure, patterns, or specific records. Use this when you need to understand how data is organized, check value distributions, or explore relationships between tables. Query will be validated for safety and limited to 20 rows.",
      parameters: {
        type: "object",
        properties: {
          sql: {
            type: "string",
            description: "A read-only SELECT query (will be validated for safety)"
          },
          reasoning: {
            type: "string",
            description: "Brief explanation of why you need this query (for audit logging)"
          }
        },
        required: ["sql", "reasoning"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "generate_final_query",
      description: "Generate the final SQL query to answer the user's question. Call this when you have enough information and are confident in your answer. The query will be validated before being returned to the user.",
      parameters: {
        type: "object",
        properties: {
          sql: {
            type: "string",
            description: "The final SQL query to answer the user's question"
          },
          explanation: {
            type: "string",
            description: "Brief explanation in user's language of what the query does"
          },
          confidence: {
            type: "string",
            enum: ["high", "medium", "low"],
            description: "Your confidence level in this answer"
          }
        },
        required: ["sql", "explanation", "confidence"]
      }
    }
  }
];

module.exports = {
  fuzzySearchParameterNames,
  fuzzySearchAnalyteNames,
  executeExploratorySql,
  TOOL_DEFINITIONS,
};
