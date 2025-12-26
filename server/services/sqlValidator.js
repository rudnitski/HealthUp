import { pool } from '../db/index.js';

// Configuration
const MAX_JOINS = Number(process.env.SQLGEN_MAX_JOINS) || 5;
const MAX_SUBQUERIES = Number(process.env.SQLGEN_MAX_SUBQUERIES) || 2;
const MAX_AGG_FUNCS = Number(process.env.SQLGEN_MAX_AGG_FUNCS) || 10;
const VALIDATION_BYPASS = process.env.SQL_VALIDATION_BYPASS === 'true';

// SQL Query Limits (configurable via env)
const SQL_VALIDATOR_PLOT_LIMIT = Number(process.env.SQL_VALIDATOR_PLOT_LIMIT) || 10000;
const SQL_VALIDATOR_TABLE_LIMIT = Number(process.env.SQL_VALIDATOR_TABLE_LIMIT) || 50;
const SQL_VALIDATOR_EXPLORATORY_LIMIT = Number(process.env.SQL_VALIDATOR_EXPLORATORY_LIMIT) || 20;

const VALIDATION_RULE_VERSION = 'v1.2.0';

// Forbidden keywords (case-insensitive, whole-word matching)
const FORBIDDEN_KEYWORDS = [
  'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'TRUNCATE',
  'ALTER', 'DROP', 'CREATE', 'REPLACE',
  'GRANT', 'REVOKE', 'COPY', 'CALL', 'DO',
  'VACUUM', 'ANALYZE', 'CLUSTER', 'REFRESH',
  'SET', 'RESET', 'SHOW', 'COMMENT',
  'SECURITY LABEL', 'LISTEN', 'UNLISTEN', 'NOTIFY',
];

// Forbidden clauses/patterns
const FORBIDDEN_PATTERNS = [
  'SELECT\\s+INTO',
  'LOCK',
  'FOR\\s+UPDATE',
  'FOR\\s+SHARE',
  'FOR\\s+NO\\s+KEY\\s+UPDATE',
  'FOR\\s+KEY\\s+SHARE',
  'pg_temp',
  'pg_toast',
];

// Volatile/unsafe functions
const FORBIDDEN_FUNCTIONS = [
  'pg_sleep', 'pg_read_file', 'pg_read_binary_file',
  'pg_ls_dir', 'pg_stat_file',
  'pg_write_', 'pg_log_',
  'lo_import', 'lo_export',
  'dblink', 'dblink_exec',
];

/**
 * Strip comments from SQL
 */
function stripComments(sql) {
  if (typeof sql !== 'string') return '';

  let cleaned = sql;

  // Remove block comments /* ... */
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, ' ');

  // Remove line comments --
  cleaned = cleaned.replace(/--[^\n]*$/gm, ' ');

  return cleaned;
}

/**
 * Detect and reject SQL with placeholders
 */
function checkForPlaceholders(sql) {
  const violations = [];

  // Check for named placeholders (:param, :1, :name)
  // BUT exclude PostgreSQL type casts (::text, ::integer, etc.)
  // Match :word but NOT ::word
  if (/(?<!:):[a-z_]\w*/i.test(sql)) {
    violations.push({
      code: 'PLACEHOLDER_SYNTAX',
      pattern: ':placeholder',
    });
  }

  // Check for positional placeholders ($1, $2, etc.)
  if (/\$\d+/.test(sql)) {
    violations.push({
      code: 'PLACEHOLDER_SYNTAX',
      pattern: '$N',
    });
  }

  // Check for question mark placeholders (?)
  // But ignore ? inside string literals (e.g., regex patterns like '^-?[0-9]')
  // Remove all string literals first, then check for standalone ?
  const withoutStrings = sql.replace(/'[^']*'/g, '""'); // Replace strings with empty quotes

  // Now check for ? outside of string literals
  // A standalone ? would be used as a placeholder, not inside a string
  if (/\?(?!\w)/.test(withoutStrings)) {
    violations.push({
      code: 'PLACEHOLDER_SYNTAX',
      pattern: '?',
    });
  }

  return violations;
}

/**
 * Check for forbidden keywords
 */
function checkForbiddenKeywords(sql) {
  const violations = [];

  FORBIDDEN_KEYWORDS.forEach((keyword) => {
    const pattern = new RegExp(`\\b${keyword}\\b`, 'i');
    if (pattern.test(sql)) {
      violations.push({
        code: 'FORBIDDEN_KEYWORD',
        keyword,
      });
    }
  });

  return violations;
}

/**
 * Check for forbidden patterns
 */
function checkForbiddenPatterns(sql) {
  const violations = [];

  FORBIDDEN_PATTERNS.forEach((pattern) => {
    const regex = new RegExp(pattern, 'i');
    if (regex.test(sql)) {
      violations.push({
        code: 'FORBIDDEN_PATTERN',
        pattern: pattern.replace(/\\s\+/g, ' ').replace(/\\/g, ''),
      });
    }
  });

  return violations;
}

/**
 * Check for forbidden functions
 */
function checkForbiddenFunctions(sql) {
  const violations = [];

  FORBIDDEN_FUNCTIONS.forEach((func) => {
    const pattern = new RegExp(`\\b${func.replace('_', '_?')}`, 'i');
    if (pattern.test(sql)) {
      violations.push({
        code: 'FORBIDDEN_FUNCTION',
        function: func,
      });
    }
  });

  return violations;
}

/**
 * Check for multiple statements
 */
function checkMultipleStatements(sql) {
  const trimmed = sql.trim();

  // Check for semicolons (excluding trailing semicolon)
  const withoutTrailing = trimmed.replace(/;+\s*$/, '');
  if (withoutTrailing.includes(';')) {
    return [{
      code: 'MULTI_STATEMENT_SEMICOLON',
    }];
  }

  return [];
}

/**
 * Count JOINs in SQL
 */
function countJoins(sql) {
  const joinPattern = /\bJOIN\b/gi;
  const matches = sql.match(joinPattern);
  return matches ? matches.length : 0;
}

/**
 * Count nested subquery depth
 */
function countSubqueryDepth(sql) {
  let maxDepth = 0;
  let currentDepth = 0;

  for (let i = 0; i < sql.length; i += 1) {
    if (sql[i] === '(') {
      // Check if this is a subquery (contains SELECT)
      const remaining = sql.substring(i);
      if (/\(\s*SELECT\b/i.test(remaining.substring(0, 100))) {
        currentDepth += 1;
        maxDepth = Math.max(maxDepth, currentDepth);
      }
    } else if (sql[i] === ')') {
      if (currentDepth > 0) {
        currentDepth -= 1;
      }
    }
  }

  return maxDepth;
}

/**
 * Count aggregate functions
 */
function countAggregateFunctions(sql) {
  const aggPattern = /\b(COUNT|SUM|AVG|MIN|MAX|STDDEV|VARIANCE|ARRAY_AGG|STRING_AGG)\s*\(/gi;
  const matches = sql.match(aggPattern);
  return matches ? matches.length : 0;
}

/**
 * Check query complexity guardrails
 */
function checkComplexity(sql) {
  const violations = [];

  const joinCount = countJoins(sql);
  if (joinCount > MAX_JOINS) {
    violations.push({
      code: 'TOO_MANY_JOINS',
      count: joinCount,
      max: MAX_JOINS,
    });
  }

  const subqueryDepth = countSubqueryDepth(sql);
  if (subqueryDepth > MAX_SUBQUERIES) {
    violations.push({
      code: 'SUBQUERY_TOO_DEEP',
      depth: subqueryDepth,
      max: MAX_SUBQUERIES,
    });
  }

  const aggCount = countAggregateFunctions(sql);
  if (aggCount > MAX_AGG_FUNCS) {
    violations.push({
      code: 'TOO_MANY_AGGREGATES',
      count: aggCount,
      max: MAX_AGG_FUNCS,
    });
  }

  return violations;
}

/**
 * Inject or clamp LIMIT clause
 * @param {string} sql - SQL query
 * @param {string} queryType - Query type ('plot_query' or 'data_query')
 * @returns {string} SQL with enforced LIMIT clause
 */
function enforceLimitClause(sql, queryType = 'data_query') {
  const trimmed = sql.trim();
  const hasTrailingSemicolon = /;+\s*$/.test(trimmed);
  const withoutTrailingSemicolon = trimmed.replace(/;+\s*$/, '');

  // Different limits for different query types (configurable via env)
  const maxLimit = queryType === 'plot_query' ? SQL_VALIDATOR_PLOT_LIMIT : SQL_VALIDATOR_TABLE_LIMIT;

  // Check if LIMIT exists
  const limitPattern = /\bLIMIT\s+(\d+)/i;
  const match = withoutTrailingSemicolon.match(limitPattern);

  let result;

  if (match) {
    const limitValue = parseInt(match[1], 10);
    if (limitValue > maxLimit) {
      // Clamp to max limit
      result = withoutTrailingSemicolon.replace(limitPattern, `LIMIT ${maxLimit}`);
    } else {
      result = withoutTrailingSemicolon;
    }
  } else {
    // No LIMIT, inject it
    result = `${withoutTrailingSemicolon} LIMIT ${maxLimit}`;
  }

  return hasTrailingSemicolon ? `${result};` : result;
}

/**
 * Validate plot query structure
 * Ensures plot queries meet the contract required by plotRenderer.js
 * PRD Reference: docs/PRD_v2_2_lab_plot_with_reference_band.md
 */
function validatePlotQuery(sql, queryType) {
  if (queryType !== 'plot_query') {
    return { valid: true };
  }

  const violations = [];
  const lowerSql = sql.toLowerCase();

  // Required columns validation
  const hasColumnT = lowerSql.includes(' as t') || lowerSql.includes(' as t,') || lowerSql.includes(' as t\n');
  const hasColumnY = lowerSql.includes(' as y') || lowerSql.includes(' as y,') || lowerSql.includes(' as y\n');

  if (!hasColumnT) {
    violations.push({
      code: 'PLOT_MISSING_COLUMN_T',
      message: 'Plot queries must include column "t" (Unix timestamp in milliseconds). Example: EXTRACT(EPOCH FROM timestamp)::bigint * 1000 AS t'
    });
  }

  if (!hasColumnY) {
    violations.push({
      code: 'PLOT_MISSING_COLUMN_Y',
      message: 'Plot queries must include column "y" (numeric measurement value). Example: value::numeric AS y'
    });
  }

  // Check for unit column (recommended)
  const hasUnit = lowerSql.includes(' unit') && (lowerSql.includes('as unit') || lowerSql.includes('unit,'));
  if (!hasUnit) {
    // Warning, not a hard failure
    console.warn('[sqlValidator] Plot query missing recommended "unit" column');
  }

  // Check for ORDER BY t
  if (!lowerSql.includes('order by t')) {
    violations.push({
      code: 'PLOT_MISSING_ORDER',
      message: 'Plot queries must include "ORDER BY t ASC" for chronological ordering'
    });
  }

  // Check for numeric casting (::numeric) - required for y column
  if (!lowerSql.includes('::numeric')) {
    violations.push({
      code: 'PLOT_MISSING_NUMERIC_CAST',
      message: 'Plot queries must cast y column to numeric type (::numeric)'
    });
  }

  // Check for EXTRACT(EPOCH...) pattern for timestamp conversion
  if (!lowerSql.includes('extract(epoch')) {
    violations.push({
      code: 'PLOT_MISSING_TIMESTAMP_CONVERSION',
      message: 'Plot queries must convert timestamp to Unix milliseconds using EXTRACT(EPOCH FROM ...)::bigint * 1000'
    });
  }

  // Check for reference range columns (recommended but not required)
  const hasReferenceLower = lowerSql.includes('reference_lower');
  const hasReferenceUpper = lowerSql.includes('reference_upper');

  if (!hasReferenceLower && !hasReferenceUpper) {
    // Log warning about missing reference bands
    console.warn('[sqlValidator] Plot query missing reference band columns (reference_lower, reference_upper). Plot will not show healthy range bands.');
  }

  return violations.length > 0 ? { valid: false, violations } : { valid: true };
}

/**
 * Validate required columns for plot queries by inspecting EXPLAIN output columns
 * @param {string} sql - SQL query to validate
 * @param {string} queryType - 'data_query' or 'plot_query'
 * @returns {Promise<{valid: boolean, violations: Array, detectedColumns: Array<string>}>}
 */
function extractFinalSelectClause(sql) {
  const lowerSql = sql.toLowerCase();
  const selectIndex = lowerSql.lastIndexOf('select');
  if (selectIndex === -1) {
    return '';
  }

  let clause = '';
  let depth = 0;
  let i = selectIndex + 'select'.length;

  while (i < lowerSql.length) {
    const char = lowerSql[i];

    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth = Math.max(depth - 1, 0);
    }

    if (
      depth === 0 &&
      lowerSql.startsWith('from', i) &&
      /\s/.test(lowerSql[i - 1] || ' ')
    ) {
      break;
    }

    clause += sql[i]; // keep original casing/layout for readability
    i += 1;
  }

  return clause;
}

function detectMissingPlotColumnsWithRegex(sql) {
  const selectClause = extractFinalSelectClause(sql);
  if (!selectClause) {
    return ['t', 'y', 'parameter_name', 'unit'];
  }

  const clauseLower = selectClause.toLowerCase().replace(/\s+/g, ' ');

  const aliasPatterns = {
    t: /\bas\s+t\b/,
    y: /\bas\s+y\b/,
    parameter_name: /\bas\s+parameter_name\b/,
    unit: /\bas\s+unit\b/,
  };

  const directColumnPatterns = {
    t: /(^|,)\s*(?:[\w".]+\.)?t\s*(?:,|$)/,
    y: /(^|,)\s*(?:[\w".]+\.)?y\s*(?:,|$)/,
    parameter_name: /(^|,)\s*(?:[\w".]+\.)?parameter_name\b/,
    unit: /(^|,)\s*(?:[\w".]+\.)?unit\b/,
  };

  return ['t', 'y', 'parameter_name', 'unit'].filter((column) => {
    const hasAlias = aliasPatterns[column].test(clauseLower);
    const hasDirect = directColumnPatterns[column].test(clauseLower);
    return !(hasAlias || hasDirect);
  });
}

async function validatePlotQueryColumns(sql, queryType) {
  if (queryType !== 'plot_query') {
    return { valid: true, violations: [], detectedColumns: [] };
  }

  const client = await pool.connect();
  try {
    await client.query('SET LOCAL statement_timeout = 1000');
    const { rows } = await client.query(`EXPLAIN (FORMAT JSON, VERBOSE) ${sql}`);
    const planNode = rows?.[0]?.['QUERY PLAN']?.[0];
    const planRoot = planNode?.Plan;
    const outputColumns = Array.isArray(planNode?.Output)
      ? planNode.Output
      : Array.isArray(planRoot?.Output)
        ? planRoot.Output
        : [];

    // Normalize column identifiers from EXPLAIN output
    const normalized = outputColumns
      .map((col) => {
        if (typeof col !== 'string') return '';
        let cleaned = col.toLowerCase();
        cleaned = cleaned.replace(/["']/g, '');
        if (cleaned.includes(' as ')) {
          cleaned = cleaned.split(' as ').pop();
        }
        if (cleaned.includes(':=')) {
          cleaned = cleaned.split(':= ').pop();
        }
        if (cleaned.includes('::')) {
          cleaned = cleaned.split('::')[0];
        }
        if (cleaned.includes('.')) {
          cleaned = cleaned.split('.').pop();
        }
        return cleaned.trim();
      })
      .filter(Boolean);

    // Fallback to regex detection if EXPLAIN did not surface output columns
    if (!normalized.length) {
      const missingViaRegex = detectMissingPlotColumnsWithRegex(sql);
      if (missingViaRegex.length > 0) {
        return {
          valid: false,
          violations: [{
            code: 'PLOT_MISSING_REQUIRED_COLUMNS',
            message: `Plot query missing required columns: ${missingViaRegex.join(', ')}. ` +
              `Required: t (bigint timestamp), y (numeric value), parameter_name (text), unit (text).`,
            missingColumns: missingViaRegex,
          }],
          detectedColumns: outputColumns,
        };
      }

      return {
        valid: true,
        violations: [],
        detectedColumns: outputColumns,
      };
    }

    const requiredColumns = ['t', 'y', 'parameter_name', 'unit'];
    const missingColumns = requiredColumns.filter(
      (col) => !normalized.includes(col)
    );

    if (missingColumns.length > 0) {
      const regexMissing = detectMissingPlotColumnsWithRegex(sql);
      const stillMissing = missingColumns.filter((col) => regexMissing.includes(col));
      if (stillMissing.length > 0) {
        return {
          valid: false,
          violations: [{
            code: 'PLOT_MISSING_REQUIRED_COLUMNS',
            message: `Plot query missing required columns: ${stillMissing.join(', ')}. ` +
              `Required: t (bigint timestamp), y (numeric value), parameter_name (text), unit (text).`,
            missingColumns: stillMissing,
            detectedColumns: outputColumns
          }],
          detectedColumns: outputColumns
        };
      }

      return {
        valid: true,
        violations: [],
        detectedColumns: outputColumns,
      };
    }

    return {
      valid: true,
      violations: [],
      detectedColumns: outputColumns
    };
  } catch (error) {
    console.error('[sqlValidator] Failed to inspect plot query columns via EXPLAIN:', error.message);

    // Attempt regex fallback before failing hard
    const missingViaRegex = detectMissingPlotColumnsWithRegex(sql);
    if (missingViaRegex.length > 0) {
      return {
        valid: false,
        violations: [{
          code: 'PLOT_MISSING_REQUIRED_COLUMNS',
          message: `Plot query missing required columns: ${missingViaRegex.join(', ')}. ` +
            `Required: t (bigint timestamp), y (numeric value), parameter_name (text), unit (text).`,
          missingColumns: missingViaRegex,
        }],
        detectedColumns: [],
      };
    }

    return {
      valid: true,
      violations: [],
      detectedColumns: [],
    };
  } finally {
    client.release();
  }
}

/**
 * Run EXPLAIN to validate query is read-only
 */
async function validateWithExplain(sql) {
  const client = await pool.connect();
  try {
    // Set statement timeout to 1 second
    await client.query('SET LOCAL statement_timeout = 1000');

    // Run EXPLAIN (FORMAT JSON)
    const { rows } = await client.query(`EXPLAIN (FORMAT JSON) ${sql}`);

    const plan = rows && rows[0] && rows[0]['QUERY PLAN'];
    if (!plan || !Array.isArray(plan) || plan.length === 0) {
      return {
        valid: false,
        error: 'EXPLAIN returned empty plan',
      };
    }

    // Check if plan contains only read operations
    const planNode = plan[0];
    const nodeType = planNode?.Plan?.['Node Type'];

    // Valid read-only operations
    const validNodeTypes = [
      'Seq Scan', 'Index Scan', 'Index Only Scan', 'Bitmap Heap Scan',
      'Nested Loop', 'Hash Join', 'Merge Join',
      'Aggregate', 'Sort', 'Limit',
      'Subquery Scan', 'CTE Scan', 'Group', 'Hash',
    ];

    if (!nodeType || !validNodeTypes.some((valid) => nodeType.includes(valid))) {
      return {
        valid: false,
        error: `Query plan contains non-read-only operation: ${nodeType || 'unknown'}`,
      };
    }

    return {
      valid: true,
    };
  } catch (error) {
    // Log the error and the SQL that caused it for debugging
    console.error('[sqlValidator] EXPLAIN validation error:', error.message, 'SQL:', sql.substring(0, 200));

    return {
      valid: false,
      error: error.message || 'EXPLAIN failed',
    };
  } finally {
    client.release();
  }
}

/**
 * Validate SQL query (Layer 1: Regex + Layer 2: EXPLAIN + Layer 3: Plot-specific)
 */
async function validateSQL(sql, { schemaSnapshotId, queryType } = {}) {
  if (VALIDATION_BYPASS) {
    const trimmed = typeof sql === 'string' ? sql.trim() : '';
    return {
      valid: true,
      violations: [],
      sql: trimmed,
      sqlWithLimit: trimmed,
      durationMs: 0,
      validator: {
        ruleVersion: 'bypass-local',
        strategy: 'bypass',
      },
      schemaSnapshotId: schemaSnapshotId || null,
    };
  }

  const startedAt = Date.now();
  let violations = [];

  // Layer 1: Enhanced Regex Validation
  const cleanedSQL = stripComments(sql);

  // Check if SQL starts with SELECT or WITH
  if (!/^\s*(SELECT|WITH)\b/i.test(cleanedSQL)) {
    violations.push({
      code: 'INVALID_STATEMENT_TYPE',
      message: 'Query must start with SELECT or WITH',
    });
  }

  // Check forbidden keywords
  violations = violations.concat(checkForbiddenKeywords(cleanedSQL));

  // Check forbidden patterns
  violations = violations.concat(checkForbiddenPatterns(cleanedSQL));

  // Check forbidden functions
  violations = violations.concat(checkForbiddenFunctions(cleanedSQL));

  // Check multiple statements
  violations = violations.concat(checkMultipleStatements(cleanedSQL));

  // Check for placeholders (they cause EXPLAIN to fail)
  violations = violations.concat(checkForPlaceholders(cleanedSQL));

  // Check complexity
  violations = violations.concat(checkComplexity(cleanedSQL));

  // If regex validation failed, return early
  if (violations.length > 0) {
    return {
      valid: false,
      violations,
      sql: cleanedSQL,
      sqlWithLimit: null,
      durationMs: Date.now() - startedAt,
      validator: {
        ruleVersion: VALIDATION_RULE_VERSION,
        strategy: 'regex+explain_ro+plot',
      },
      schemaSnapshotId: schemaSnapshotId || null,
    };
  }

  // Check plot-specific requirements (before LIMIT injection)
  const plotValidation = validatePlotQuery(cleanedSQL, queryType);
  if (!plotValidation.valid) {
    violations = violations.concat(plotValidation.violations);
    return {
      valid: false,
      violations,
      sql: cleanedSQL,
      sqlWithLimit: null,
      durationMs: Date.now() - startedAt,
      validator: {
        ruleVersion: VALIDATION_RULE_VERSION,
        strategy: 'regex+explain_ro+plot',
      },
      schemaSnapshotId: schemaSnapshotId || null,
    };
  }

  // Enforce LIMIT (pass queryType for correct limit)
  const sqlWithLimit = enforceLimitClause(cleanedSQL, queryType);

  // Validate plot query columns (inspect EXPLAIN output)
  const columnValidation = await validatePlotQueryColumns(sqlWithLimit, queryType);
  if (!columnValidation.valid) {
    return {
      valid: false,
      violations: columnValidation.violations,
      sql: cleanedSQL,
      sqlWithLimit: null,
      durationMs: Date.now() - startedAt,
      validator: {
        ruleVersion: VALIDATION_RULE_VERSION,
        strategy: 'regex+explain_ro+plot',
      },
      schemaSnapshotId: schemaSnapshotId || null
    };
  }

  // Layer 2: EXPLAIN Validation
  const explainResult = await validateWithExplain(sqlWithLimit);

  if (!explainResult.valid) {
    // If EXPLAIN fails due to syntax error, it's already caught by regex validation
    // Log the error but don't block if regex validation passed
    console.warn('[sqlValidator] EXPLAIN validation failed (may be false positive):', explainResult.error);

    violations.push({
      code: 'EXPLAIN_VALIDATION_FAILED',
      error: explainResult.error,
    });

    return {
      valid: false,
      violations,
      sql: cleanedSQL,
      sqlWithLimit,
      durationMs: Date.now() - startedAt,
      validator: {
        ruleVersion: VALIDATION_RULE_VERSION,
        strategy: 'regex+explain_ro+plot',
      },
      schemaSnapshotId: schemaSnapshotId || null,
    };
  }

  // All validations passed
  return {
    valid: true,
    violations: [],
    sql: cleanedSQL,
    sqlWithLimit,
    durationMs: Date.now() - startedAt,
    validator: {
      ruleVersion: VALIDATION_RULE_VERSION,
      strategy: 'regex+explain_ro+plot',
    },
    schemaSnapshotId: schemaSnapshotId || null,
  };
}

/**
 * Ensure SQL query includes patient scope filter when multiple patients exist
 * PRD v3.2: Patient safety guardrail for conversational mode
 * PRD v4.3: Enhanced with exclusivity check to prevent cross-patient data leaks
 *
 * KNOWN LIMITATIONS (acknowledged in PRD):
 * - Regex-based validation catches ~95% of cases, not 100%
 * - Won't detect filters in subqueries/CTEs (e.g., WHERE patient_id IN (SELECT ...))
 * - Could miss reversed predicates (e.g., WHERE 'uuid' = patient_id)
 * - Case-sensitive UUID comparison could fail if LLM uses uppercase
 * - Defense-in-depth: relies on LLM prompt to generate correct filters
 *
 * TODO (post-MVP): Consider lightweight SQL parser (e.g., node-sql-parser)
 * for more robust validation, but adds dependency and complexity.
 *
 * @param {string} sql - SQL query to validate
 * @param {string} patientId - Selected patient UUID
 * @param {number} patientCount - Total number of patients in database
 * @returns {{valid: boolean, violation?: {code: string, message: string}}}
 */
function ensurePatientScope(sql, patientId, patientCount) {
  // Skip check if only one patient exists
  if (patientCount <= 1) {
    return { valid: true };
  }

  if (!patientId) {
    return {
      valid: false,
      violation: {
        code: 'PATIENT_SCOPE_REQUIRED',
        message: 'Patient must be selected when multiple patients exist'
      }
    };
  }

  const lowerSql = sql.toLowerCase();
  const lowerPatientId = patientId.toLowerCase();

  // PRD v4.3: Check for set operations that could bypass scope
  const setOperationPatterns = [
    /\bUNION\b/i,
    /\bINTERSECT\b/i,
    /\bEXCEPT\b/i
  ];

  for (const pattern of setOperationPatterns) {
    if (pattern.test(sql)) {
      return {
        valid: false,
        violation: {
          code: 'SET_OPERATION_FORBIDDEN',
          message: `Set operations (UNION/INTERSECT/EXCEPT) are not allowed in patient-scoped queries`
        }
      };
    }
  }

  // PRD v4.3: Check for negation operators on patient_id (could leak other patients)
  const negationPatterns = [
    /patient_id\s*(!|<>)/i,           // patient_id != or patient_id <>
    /patient_id\s+NOT\s+IN/i,          // patient_id NOT IN
    /NOT\s+patient_id\s*=/i,           // NOT patient_id =
    /patient_id\s+IS\s+NOT/i           // patient_id IS NOT
  ];

  for (const pattern of negationPatterns) {
    if (pattern.test(sql)) {
      return {
        valid: false,
        violation: {
          code: 'NEGATION_FORBIDDEN',
          message: 'Negation operators (!=, NOT IN, <>) on patient_id are forbidden to prevent cross-patient data access'
        }
      };
    }
  }

  // PRD v4.3: Check for boolean tautologies that could bypass patient filters
  const tautologyPatterns = [
    /\bOR\s+1\s*=\s*1\b/i,             // OR 1=1
    /\bOR\s+TRUE\b/i,                  // OR TRUE
    /\bOR\s+'1'\s*=\s*'1'/i,           // OR '1'='1'
    /\bOR\s+1\s*<>\s*0\b/i,            // OR 1<>0
    /\bOR\s+0\s*=\s*0\b/i,             // OR 0=0
    /\bOR\s+NOT\s+FALSE\b/i,           // OR NOT FALSE
    /\bOR\s+1\s*!=\s*0\b/i,            // OR 1!=0
    /\bOR\s+''\s*=\s*''/i              // OR ''=''
  ];

  for (const pattern of tautologyPatterns) {
    if (pattern.test(sql)) {
      return {
        valid: false,
        violation: {
          code: 'TAUTOLOGY_FORBIDDEN',
          message: 'Boolean tautologies (e.g., OR 1=1) are forbidden to prevent bypassing patient filters'
        }
      };
    }
  }

  // Check for patient_id = 'uuid' or patient_id IN (...)
  // Use regex to match common patterns
  const patientIdPattern = new RegExp(
    `patient_id\\s*=\\s*'${lowerPatientId}'|` +
    `patient_id\\s+IN\\s*\\([^)]*'${lowerPatientId}'[^)]*\\)`,
    'i'
  );

  if (!patientIdPattern.test(lowerSql)) {
    return {
      valid: false,
      violation: {
        code: 'MISSING_PATIENT_FILTER',
        message: `Query must filter by patient_id = '${patientId}'`
      }
    };
  }

  // PRD v4.3: Exclusivity check - detect other patient UUIDs in patient_id predicates
  // Extract all UUIDs from the SQL
  const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  const foundUuids = sql.match(uuidRegex) || [];

  // Check if any UUID other than the selected patient appears in a patient_id context
  // Look for patient_id predicates and extract UUIDs from them
  const patientIdPredicatePattern = /patient_id\s*(?:=|IN\s*\()\s*'[^']*'/gi;
  const patientPredicates = sql.match(patientIdPredicatePattern) || [];

  for (const predicate of patientPredicates) {
    const uuidsInPredicate = predicate.match(uuidRegex) || [];
    const foreignUuids = uuidsInPredicate.filter(
      uuid => uuid.toLowerCase() !== lowerPatientId
    );

    if (foreignUuids.length > 0) {
      return {
        valid: false,
        violation: {
          code: 'CROSS_PATIENT_LEAK',
          message: `Query references unauthorized patient ID(s): ${foreignUuids.join(', ')}. Only ${patientId} is allowed.`
        }
      };
    }
  }

  return { valid: true };
}

export {
  validateSQL,
  stripComments,
  enforceLimitClause,
  ensurePatientScope,
  VALIDATION_RULE_VERSION,
};
