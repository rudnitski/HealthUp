const { pool } = require('../db');

// Configuration
const MAX_JOINS = Number(process.env.SQLGEN_MAX_JOINS) || 5;
const MAX_SUBQUERIES = Number(process.env.SQLGEN_MAX_SUBQUERIES) || 2;
const MAX_AGG_FUNCS = Number(process.env.SQLGEN_MAX_AGG_FUNCS) || 10;
const VALIDATION_BYPASS = process.env.SQL_VALIDATION_BYPASS === 'true';

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

  // Different limits for different query types
  const maxLimit = queryType === 'plot_query' ? 5000 : 50;

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

module.exports = {
  validateSQL,
  stripComments,
  enforceLimitClause,
  VALIDATION_RULE_VERSION,
};
