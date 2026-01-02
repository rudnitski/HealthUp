// server/services/agenticTools.js
// Agentic SQL Generation - Tool Implementations
// PRD: docs/PRD_v2_0_agentic_sql_generation_mvp.md

import { pool, adminPool, queryWithUser, queryAsAdmin } from '../db/index.js';
import { validateSQL, ensurePatientScope } from './sqlValidator.js';

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

// Configuration from environment
const AGENTIC_FUZZY_SEARCH_LIMIT = parseInt(process.env.AGENTIC_FUZZY_SEARCH_LIMIT) || 20;
const AGENTIC_EXPLORATORY_SQL_LIMIT = parseInt(process.env.AGENTIC_EXPLORATORY_SQL_LIMIT) || 20;
const AGENTIC_SIMILARITY_THRESHOLD = parseFloat(process.env.AGENTIC_SIMILARITY_THRESHOLD) || 0.3;

// Query type limits (PRD v4.2.2 - separation of concerns)
const QUERY_TYPE_LIMITS = {
  explore: parseInt(process.env.AGENTIC_EXPLORATORY_SQL_LIMIT) || 20,
  plot: parseInt(process.env.SQL_VALIDATOR_PLOT_LIMIT) || 200,
  table: parseInt(process.env.SQL_VALIDATOR_TABLE_LIMIT) || 50
};

/**
 * Fuzzy search on lab_results.parameter_name using PostgreSQL trigram similarity
 *
 * This is a PRIVILEGED tool - uses parameterized queries, bypasses validator
 * Handles multilingual queries, typos, abbreviations, and mixed scripts automatically
 *
 * PRD v4.4.3: Added userId parameter for RLS context (lab_results has RLS)
 * PRD v4.4.6: Added isAdmin parameter for admin mode (bypasses RLS)
 *
 * @param {string} searchTerm - Term to search for (any language, any script)
 * @param {number} limit - Maximum number of results (default from env)
 * @param {string} userId - User ID for RLS context
 * @param {boolean} isAdmin - Whether to use admin mode (bypasses RLS)
 * @returns {Object} Search results with similarity scores
 */
async function fuzzySearchParameterNames(searchTerm, limit = AGENTIC_FUZZY_SEARCH_LIMIT, userId = null, isAdmin = false) {
  if (!searchTerm || typeof searchTerm !== 'string') {
    throw new Error('search_term is required and must be a string');
  }

  const effectiveLimit = Math.min(limit || AGENTIC_FUZZY_SEARCH_LIMIT, 50); // Cap at 50
  const similarityThreshold = AGENTIC_SIMILARITY_THRESHOLD;

  logger.debug({
    search_term: searchTerm,
    limit: effectiveLimit,
    similarity_threshold: similarityThreshold,
    is_admin: isAdmin,
  }, '[agenticTools] fuzzy_search_parameter_names');

  // PRD v4.4.6: Use adminPool for admin mode (BYPASSRLS), pool for user mode
  const poolToUse = isAdmin ? adminPool : pool;
  const client = await poolToUse.connect();

  try {
    // Begin transaction - required for SET LOCAL
    await client.query('BEGIN');

    // PRD v4.4.3: Set RLS context for user-scoped data access (skip for admin mode)
    if (!isAdmin && userId) {
      await client.query(
        "SELECT set_config('app.current_user_id', $1, true)",
        [userId]
      );
    }

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
 * Fuzzy search on analyte_aliases with canonical analyte names
 * PRD v2.4: Searches aliases (multilingual) and returns canonical analyte names
 * This is the RECOMMENDED search for finding analytes - searches all language variants
 *
 * PRD v4.4.6: Added isAdmin parameter for admin mode (uses adminPool for SET LOCAL)
 * Note: analyte_aliases is a shared catalog (no RLS), but SET LOCAL requires transaction
 *
 * @param {string} searchTerm - Term to search for (any language)
 * @param {number} limit - Maximum number of results
 * @param {boolean} isAdmin - Whether to use admin mode (uses adminPool)
 * @returns {Object} Search results with canonical names and codes
 */
async function fuzzySearchAnalyteNames(searchTerm, limit = AGENTIC_FUZZY_SEARCH_LIMIT, isAdmin = false) {
  if (!searchTerm || typeof searchTerm !== 'string') {
    throw new Error('search_term is required and must be a string');
  }

  const effectiveLimit = Math.min(limit || AGENTIC_FUZZY_SEARCH_LIMIT, 50);
  const similarityThreshold = AGENTIC_SIMILARITY_THRESHOLD;

  logger.debug({
    search_term: searchTerm,
    limit: effectiveLimit,
    similarity_threshold: similarityThreshold,
    is_admin: isAdmin,
  }, '[agenticTools] fuzzy_search_analyte_names');

  // PRD v4.4.6: Use adminPool for admin mode (consistent with other tools), pool for user mode
  const poolToUse = isAdmin ? adminPool : pool;
  const client = await poolToUse.connect();

  try {
    // Begin transaction - required for SET LOCAL
    await client.query('BEGIN');

    // Set similarity threshold within transaction
    await client.query(`SET LOCAL pg_trgm.similarity_threshold = ${similarityThreshold}`);

    // Execute fuzzy search query on aliases with analyte join
    const sql = `
      SELECT DISTINCT
        a.code as analyte_code,
        a.name as analyte_name,
        aa.alias as matched_alias,
        aa.alias_display,
        aa.lang,
        similarity(aa.alias, $1) as similarity_score
      FROM analyte_aliases aa
      JOIN analytes a ON aa.analyte_id = a.analyte_id
      WHERE aa.alias % $1
      ORDER BY similarity_score DESC, a.code
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
        analyte_code: row.analyte_code,
        analyte_name: row.analyte_name,
        matched_alias: row.matched_alias,
        alias_display: row.alias_display,
        language: row.lang,
        similarity: Math.round(row.similarity_score * 100) + '%'
      }))
    };

    logger.info({
      search_term: searchTerm,
      matches_found: result.rows.length,
      top_match: result.rows[0]?.analyte_name,
      top_code: result.rows[0]?.analyte_code,
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
 * Execute SQL with validation and limit enforcement
 *
 * This is a VALIDATED tool - all SQL goes through existing validator
 * Used for data exploration AND data retrieval for display tools
 *
 * PRD v4.2.2: Separation of concerns - this tool FETCHES data, display tools SHOW data
 * PRD v4.4.3: Added userId in options for RLS context
 * PRD v4.4.6: Added isAdmin in options for admin mode (bypasses RLS)
 *
 * @param {string} sql - Read-only SELECT query
 * @param {string} reasoning - Why this query is needed (for logging)
 * @param {Object} options - Additional options (schemaSnapshotId, query_type, userId, isAdmin, etc.)
 * @returns {Object} Query results with metadata
 */
async function executeExploratorySql(sql, reasoning, options = {}) {
  // PRD v4.4.3: Extract userId for RLS context
  // PRD v4.4.6: Extract isAdmin for admin mode (bypasses RLS)
  const { userId, isAdmin } = options;
  if (!sql || typeof sql !== 'string') {
    throw new Error('sql is required and must be a string');
  }

  // Determine limit based on query_type (PRD v4.2.2)
  const queryType = options.query_type || 'explore';
  const maxLimit = QUERY_TYPE_LIMITS[queryType] || QUERY_TYPE_LIMITS.explore;

  logger.debug({
    sql_preview: sql.substring(0, 100),
    reasoning,
    query_type: queryType,
    max_limit: maxLimit
  }, '[agenticTools] execute_sql');

  try {
    // Step 1: Validate SQL safety (uses existing validator)
    // Map query_type to validator's queryType format (PRD v4.2.2 fix)
    const validatorQueryType = queryType === 'plot' ? 'plot_query' : 'data_query';
    const validation = await validateSQL(sql, { ...options, queryType: validatorQueryType });

    if (!validation.valid) {
      const errorMsg = `SQL validation failed: ${validation.violations.map(v => `${v.code}: ${v.pattern || v.keyword || ''}`).join(', ')}`;

      logger.warn({
        sql,
        violations: validation.violations,
      }, '[agenticTools] execute_sql validation failed');

      throw new Error(errorMsg);
    }

    // Step 2: Enforce patient scope for data-fetching queries (plot, table)
    // SECURITY: Prevents cross-patient data leakage in multi-patient sessions
    // Skip for 'explore' queries which need broader access for schema discovery
    if ((queryType === 'plot' || queryType === 'table') && options.patientCount > 1) {
      const patientScope = ensurePatientScope(
        validation.sqlWithLimit,
        options.selectedPatientId,
        options.patientCount
      );

      if (!patientScope.valid) {
        const errorMsg = `Patient scope validation failed: ${patientScope.violation?.message || 'Unknown error'}`;

        logger.warn({
          sql,
          query_type: queryType,
          patient_count: options.patientCount,
          selected_patient_id: options.selectedPatientId,
          violation: patientScope.violation,
        }, '[agenticTools] execute_sql patient scope validation failed');

        throw new Error(errorMsg);
      }

      logger.debug({
        query_type: queryType,
        patient_id: options.selectedPatientId,
      }, '[agenticTools] Patient scope validated');
    }

    // Step 3: Enforce limit based on query_type
    let safeSql = validation.sqlWithLimit;

    // Find the last (outermost) LIMIT clause (handles semicolons and whitespace)
    const limitMatch = safeSql.match(/\bLIMIT\s+(\d+)\s*;?\s*$/i);

    if (limitMatch) {
      const existingLimit = parseInt(limitMatch[1], 10);

      // Only replace if existing limit is HIGHER than our max limit
      if (existingLimit > maxLimit) {
        const hasSemicolon = /;\s*$/.test(safeSql);
        safeSql = safeSql.replace(/\bLIMIT\s+\d+\s*;?\s*$/i, `LIMIT ${maxLimit}${hasSemicolon ? ';' : ''}`);

        logger.debug({
          original_limit: existingLimit,
          clamped_to: maxLimit,
        }, '[agenticTools] Clamped SQL limit');
      }
    } else {
      // Safety: if no LIMIT found (shouldn't happen after validator), add it
      const hasSemicolon = /;\s*$/.test(safeSql);
      if (hasSemicolon) {
        safeSql = safeSql.replace(/;\s*$/, ` LIMIT ${maxLimit};`);
      } else {
        safeSql = `${safeSql.trim()} LIMIT ${maxLimit}`;
      }
    }

    // Step 4: Execute query
    // PRD v4.4.3: Use RLS context if userId is provided
    // PRD v4.4.6: Use queryAsAdmin for admin mode (bypasses RLS)
    let result;
    if (isAdmin) {
      result = await queryAsAdmin(safeSql, []);
    } else if (userId) {
      result = await queryWithUser(safeSql, [], userId);
    } else {
      throw new Error('Either userId or isAdmin must be provided for query execution');
    }

    const response = {
      rows: result.rows,
      row_count: result.rowCount,
      reasoning,
      query_type: queryType,
      query_executed: safeSql,
      fields: result.fields?.map(f => f.name) || []
    };

    logger.info({
      row_count: result.rowCount,
      reasoning,
      query_type: queryType
    }, '[agenticTools] execute_sql completed');

    return response;
  } catch (error) {
    logger.error({
      error: error.message,
      sql,
      reasoning,
      query_type: queryType
    }, '[agenticTools] execute_sql failed');

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
      description: "RECOMMENDED: Search for canonical analyte names using multilingual aliases. Searches analyte_aliases table (which includes Russian, English, Hebrew, etc.) and returns standardized analyte codes and names. Use this FIRST instead of fuzzy_search_parameter_names when searching for lab tests - it searches all language variants and returns canonical names that group together different OCR variations (e.g., 'ЛПВП-холестерин' and 'Холестерин-ЛПВП' both return 'HDL'). When querying data, use the returned analyte_code in your WHERE clause joined via lab_results.analyte_id to group related tests together.",
      parameters: {
        type: "object",
        properties: {
          search_term: {
            type: "string",
            description: "The analyte name to search for (any language: Russian, English, Hebrew, etc.)"
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
      name: "execute_sql",
      description: "Execute a read-only SELECT query and return data. Use query_type to specify the purpose: 'explore' for data discovery (20 rows), 'plot' for plot data (200 rows), 'table' for table data (50 rows). This tool FETCHES data - use show_plot/show_table to DISPLAY it.",
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
          },
          query_type: {
            type: "string",
            enum: ["explore", "plot", "table"],
            description: "Purpose of query: 'explore' for discovery (20 rows max), 'plot' for time-series data (200 rows max), 'table' for tabular display (50 rows max). Default: 'explore'",
            default: "explore"
          }
        },
        required: ["sql", "reasoning"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "show_plot",
      description: "Display pre-fetched data as a time-series plot in the UI. Optionally include thumbnail config to show a compact summary in chat. Call execute_sql with query_type='plot' first to get the data, then pass that data here.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          data: {
            type: "array",
            description: "Array of data points from execute_sql. Each object MUST have: t (timestamp), y (numeric), parameter_name, unit. SHOULD have: reference_lower, reference_upper, is_out_of_range.",
            items: {
              type: "object",
              // NOTE: No additionalProperties: false on items to allow DB schema evolution
              properties: {
                t: {
                  oneOf: [
                    { type: "string", description: "ISO 8601 timestamp" },
                    { type: "number", description: "Epoch seconds or milliseconds" }
                  ]
                },
                y: { type: "number", description: "Numeric value" },
                parameter_name: { type: "string", description: "Parameter name" },
                unit: { type: "string", description: "Unit of measurement" },
                reference_lower: { type: "number", description: "Lower reference bound (optional)" },
                reference_upper: { type: "number", description: "Upper reference bound (optional)" },
                is_out_of_range: { type: "boolean", description: "Whether value is out of range (optional)" }
              },
              required: ["t", "y", "parameter_name", "unit"]
            }
          },
          plot_title: {
            type: "string",
            description: "Short title for the plot (max 30 chars). Use only the parameter name. Examples: 'Vitamin D', 'Холестерин', 'Glucose'."
          },
          replace_previous: {
            type: "boolean",
            description: "If true, replace the current plot/table. Default: false.",
            default: false
          },
          thumbnail: {
            type: "object",
            description: "Optional thumbnail config to show a compact summary in chat stream.",
            properties: {
              focus_analyte_name: {
                type: "string",
                description: "For multi-analyte plots, specifies which series to feature in thumbnail. If omitted, defaults to first alphabetically."
              },
              status: {
                type: "string",
                enum: ["normal", "high", "low", "unknown"],
                description: "Value status based on latest value vs reference ranges. Use 'unknown' if uncertain."
              }
            }
            // NOTE: status is optional - backend defaults to 'unknown' if omitted
          }
        },
        required: ["data", "plot_title"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "show_table",
      description: "Display pre-fetched data as a table in the UI. Call execute_sql with query_type='table' first to get the data, then pass that data here.",
      parameters: {
        type: "object",
        properties: {
          data: {
            type: "array",
            description: "Array of row objects from execute_sql. Typically includes: parameter_name, value, unit, date, reference_interval.",
            items: {
              type: "object"
            }
          },
          table_title: {
            type: "string",
            description: "Descriptive title for the table. Example: 'Latest Lipid Panel', 'Vitamin D History'."
          },
          replace_previous: {
            type: "boolean",
            description: "If true, replace current table/plot. Default: false.",
            default: false
          }
        },
        required: ["data", "table_title"]
      }
    }
  },
];

export {
  fuzzySearchParameterNames,
  fuzzySearchAnalyteNames,
  executeExploratorySql,
  TOOL_DEFINITIONS,
};
