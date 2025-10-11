// server/services/MappingApplier.js
// PRD v0.9 + v0.9.1: Mapping Applier (Dry-Run Mode)
// Performs read-only analyte mapping with structured logging
// v0.9.1: Adds Tier C (LLM-based mapping)

const pino = require('pino');
const { pool } = require('../db');
const OpenAI = require('openai');

// Configure Pino logger
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  // In development, use pretty print; in production, use JSON
  transport: process.env.NODE_ENV === 'development' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss',
      ignore: 'pid,hostname',
    },
  } : undefined,
});

// Initialize OpenAI client (only if API key is provided)
let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
} else {
  logger.warn('OPENAI_API_KEY not set; Tier C (LLM mapping) will be skipped');
}

// Configuration thresholds
const CONFIG = {
  FUZZY_MATCH_THRESHOLD: parseFloat(process.env.BACKFILL_SIMILARITY_THRESHOLD || '0.70'),
  AUTO_ACCEPT_THRESHOLD: parseFloat(process.env.MAPPING_AUTO_ACCEPT || '0.80'),
  QUEUE_LOWER_THRESHOLD: parseFloat(process.env.MAPPING_QUEUE_LOWER || '0.60'),
  AMBIGUITY_DELTA: 0.05,
};

/**
 * Normalize a parameter name for matching
 * Handles multilingual lab reports (English, Russian, Ukrainian)
 *
 * @param {string} raw - Raw parameter name from lab report
 * @returns {string|null} - Normalized lowercase string
 */
function normalizeLabel(raw) {
  if (!raw || typeof raw !== 'string') return null;

  const normalized = raw
    .toLowerCase()
    .normalize('NFKD')                    // Unicode decomposition
    .replace(/[\u0300-\u036f]/g, '')      // Strip diacritics (é→e)
    .replace(/μ/g, 'micro')               // Unify micro symbol
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')    // Replace punctuation with spaces
    .replace(/\s+/g, ' ')                 // Collapse whitespace
    .trim();

  return normalized || null;              // Return null for empty/whitespace-only
}

/**
 * Check if pg_trgm extension is available
 *
 * @returns {Promise<boolean>}
 */
async function checkPgTrgrm() {
  try {
    const { rows } = await pool.query(
      "SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_trgm') AS enabled"
    );
    return rows?.[0]?.enabled === true;
  } catch (error) {
    logger.warn({ error: error.message }, 'Unable to check pg_trgm availability');
    return false;
  }
}

/**
 * Tier A: Exact alias match (deterministic)
 *
 * @param {string} labelNorm - Normalized label
 * @returns {Promise<Object|null>} - { analyte_id, alias } or null
 */
async function findExactMatch(labelNorm) {
  if (!labelNorm) return null;

  const { rows } = await pool.query(
    `SELECT analyte_id, alias
     FROM analyte_aliases
     WHERE LOWER(alias) = $1
     LIMIT 1`,
    [labelNorm]
  );

  return rows.length > 0 ? rows[0] : null;
}

/**
 * Tier B: Fuzzy alias match using pg_trgm similarity
 *
 * @param {string} labelNorm - Normalized label
 * @returns {Promise<Object>} - { matched, ambiguous, candidates, topMatch }
 */
async function findFuzzyMatch(labelNorm) {
  if (!labelNorm) {
    return { matched: false, ambiguous: false, candidates: [] };
  }

  const { rows } = await pool.query(
    `SELECT analyte_id, alias, similarity(LOWER(alias), $1) AS sim
     FROM analyte_aliases
     WHERE LOWER(alias) % $1
     ORDER BY sim DESC
     LIMIT 2`,
    [labelNorm]
  );

  if (rows.length === 0) {
    return { matched: false, ambiguous: false, candidates: [] };
  }

  const topMatch = rows[0];

  // Check if similarity meets threshold
  if (topMatch.sim < CONFIG.FUZZY_MATCH_THRESHOLD) {
    return { matched: false, ambiguous: false, candidates: rows };
  }

  // Check for ambiguity: top-2 results within delta
  if (rows.length === 2) {
    const delta = topMatch.sim - rows[1].sim;
    if (delta <= CONFIG.AMBIGUITY_DELTA) {
      return {
        matched: false,
        ambiguous: true,
        candidates: rows.map(r => ({
          analyte_id: r.analyte_id,
          alias: r.alias,
          similarity: r.sim,
        })),
      };
    }
  }

  return {
    matched: true,
    ambiguous: false,
    topMatch: {
      analyte_id: topMatch.analyte_id,
      alias: topMatch.alias,
      similarity: topMatch.sim,
    },
    candidates: rows,
  };
}

/**
 * Tier C: LLM suggestions (stub for v0.9)
 *
 * @param {Array} analyteSuggestions - Optional LLM suggestions
 * @param {string} parameterName - Parameter name to match
 * @returns {Promise<Object>} - { present, decision, code, confidence }
 */
async function findLLMMatch(analyteSuggestions, parameterName) {
  // v0.9: Stub only
  // v1.0+: Will integrate LLM mapping step
  return { present: false };
}

/**
 * Fetch analyte details by ID
 *
 * @param {number} analyteId
 * @returns {Promise<Object|null>} - { analyte_id, code, name }
 */
async function getAnalyteById(analyteId) {
  const { rows } = await pool.query(
    `SELECT analyte_id, code, name FROM analytes WHERE analyte_id = $1`,
    [analyteId]
  );
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Fetch all analytes from database for LLM schema
 *
 * @returns {Promise<Array>} - Array of { code, name, category }
 */
async function getAnalyteSchema() {
  const { rows } = await pool.query(
    `SELECT code, name, category FROM analytes ORDER BY code`
  );
  return rows;
}

/**
 * Classify OpenAI API errors into categories
 *
 * @param {Error} error - OpenAI API error
 * @returns {string} - Error category
 */
function classifyError(error) {
  if (error.message?.includes('timeout')) return 'API_TIMEOUT';
  if (error.status === 429) return 'RATE_LIMIT';
  if (error.status === 401 || error.status === 403) return 'AUTH_ERROR';
  return 'API_ERROR';
}

/**
 * Build batch prompt for LLM mapping
 *
 * @param {Array} unmappedRows - Rows to map
 * @param {Array} categoryContext - Already-mapped analyte codes
 * @param {string} schemaText - Formatted analyte schema
 * @returns {string} - Formatted prompt
 */
function buildBatchPrompt(unmappedRows, categoryContext, schemaText) {
  return `You are a medical LIMS specialist. Map lab parameters to canonical analyte codes.

Available analytes:
${schemaText}

Context: This report already contains: ${categoryContext.join(', ') || 'none'}

Rules:
- decision "MATCH": code exists in schema above
- decision "NEW": valid analyte but not in schema (propose new code + name)
- decision "ABSTAIN": cannot determine mapping
- For AMBIGUOUS rows, pick the best match from candidates provided

Return JSON array with one object per parameter:
{
  "results": [
    {
      "label": "parameter name",
      "decision": "MATCH" | "NEW" | "ABSTAIN",
      "code": "string or null",
      "name": "string or null (only for NEW)",
      "confidence": 0.95,
      "comment": "brief reason"
    }
  ]
}

Parameters to map:
${unmappedRows.map((row, i) => `
${i + 1}. Label: "${row.label_raw}"
   Unit: ${row.unit || 'none'}
   Reference: ${row.reference_hint || 'none'}
   ${row.tiers?.fuzzy?.candidates ?
     `Ambiguous matches: ${row.tiers.fuzzy.candidates.map(c =>
       `${c.analyte_id} (sim: ${c.similarity})`).join(', ')}` : ''}
`).join('\n')}`;
}

/**
 * Parse LLM batch output and map to rows
 *
 * @param {string} outputText - Raw LLM JSON output
 * @param {Array} unmappedRows - Original unmapped rows
 * @returns {Array} - Parsed results
 */
function parseLLMBatchOutput(outputText, unmappedRows) {
  try {
    const parsed = JSON.parse(outputText);
    if (!parsed.results || !Array.isArray(parsed.results)) {
      throw new Error('Invalid JSON structure: missing results array');
    }
    return parsed.results;
  } catch (error) {
    logger.error({ error: error.message, outputText }, 'Failed to parse LLM output');
    return unmappedRows.map(row => ({
      result_id: row.result_id,
      label: row.label_raw,
      decision: null,
      error: 'INVALID_JSON',
      code: null,
      confidence: 0,
      comment: 'Failed to parse LLM response'
    }));
  }
}

/**
 * Call LLM to map unmapped/ambiguous parameters (Tier C)
 * PRD v0.9.1 - Batch processing strategy
 *
 * @param {Array} unmappedRows - Rows with UNMAPPED or AMBIGUOUS_FUZZY decisions
 * @param {Array} mappedRows - Already-mapped rows for context
 * @param {Array} analyteSchema - All available analytes from DB
 * @returns {Promise<Array>} - Array of LLM suggestions per row
 */
async function proposeAnalytesWithLLM(unmappedRows, mappedRows, analyteSchema) {
  if (!unmappedRows || unmappedRows.length === 0) {
    return [];
  }

  if (!openai) {
    logger.warn('OpenAI client not initialized; skipping LLM mapping');
    return unmappedRows.map(row => ({
      result_id: row.result_id,
      label: row.label_raw,
      decision: null,
      error: 'NO_API_KEY',
      code: null,
      confidence: 0,
      comment: 'OPENAI_API_KEY not configured'
    }));
  }

  // Build category context from already-mapped rows
  const categoryContext = mappedRows
    .map(r => r.final_analyte?.code)
    .filter(Boolean);

  // Build analyte schema string
  const schemaText = analyteSchema
    .map(a => `${a.code} (${a.name})`)
    .join('\n');

  // Build batch prompt
  const inputPrompt = buildBatchPrompt(unmappedRows, categoryContext, schemaText);

  try {
    // Log full input prompt for debugging
    logger.info({
      model: 'gpt-5-mini',
      unmapped_count: unmappedRows.length,
      prompt_length: inputPrompt.length,
      full_prompt: inputPrompt
    }, 'Calling LLM API with full prompt');

    const response = await openai.responses.create({
      model: 'gpt-5-mini',
      input: inputPrompt,
      max_output_tokens: 2000,
      reasoning: {
        effort: 'minimal'  // Limit reasoning tokens to force structured output
      },
      text: {
        format: { type: 'json_object' }  // Responses API format structure
      }
    });

    // Log the full response structure for debugging
    logger.info({
      response_keys: Object.keys(response),
      response_type: typeof response,
      full_response: JSON.stringify(response, null, 2),
      output_text_value: response.output_text,
      output_text_length: response.output_text?.length || 0
    }, 'LLM full response received');

    // Try different property names for the output
    const outputText = response.output_text || response.text || response.output ||
                       (response.choices && response.choices[0]?.message?.content) ||
                       (response.choices && response.choices[0]?.text);

    // Check if we got any output
    if (!outputText || outputText.trim() === '') {
      logger.warn({
        response,
        attempted_properties: ['output_text', 'text', 'output', 'choices[0].message.content', 'choices[0].text']
      }, 'LLM returned empty output - no valid output property found');
      throw new Error('LLM returned empty response');
    }

    return parseLLMBatchOutput(outputText, unmappedRows);
  } catch (error) {
    logger.error({ error: error.message }, 'LLM API call failed');
    // Return error placeholders for all rows
    return unmappedRows.map(row => ({
      result_id: row.result_id,
      label: row.label_raw,
      decision: null,
      error: classifyError(error),
      code: null,
      confidence: 0,
      comment: error.message
    }));
  }
}

/**
 * Process a single lab result row and determine mapping decision
 *
 * @param {Object} row - Lab result row
 * @param {boolean} hasPgTrgm - Whether pg_trgm is available
 * @param {Array} analyteSuggestions - Optional LLM suggestions
 * @returns {Promise<Object>} - Mapping decision with tiers and confidence
 */
async function processRow(row, hasPgTrgm, analyteSuggestions) {
  const startTime = Date.now();

  const labelRaw = row.parameter_name;
  const labelNorm = normalizeLabel(labelRaw);

  // Initialize result structure
  const result = {
    event: 'mapping.row',
    report_id: row.report_id,
    patient_id: row.patient_id,
    result_id: row.id,
    position: row.position,
    label_raw: labelRaw,
    label_norm: labelNorm,
    unit: row.unit,
    numeric_result: row.numeric_result,
    reference_hint: row.reference_text,
    tiers: {
      deterministic: { matched: false },
      fuzzy: { matched: false },
      llm: { present: false },
    },
    final_decision: 'UNMAPPED',
    final_analyte: null,
    confidence: 0,
    thresholds: {
      fuzzy_match: CONFIG.FUZZY_MATCH_THRESHOLD,
      auto_accept: CONFIG.AUTO_ACCEPT_THRESHOLD,
      queue_lower: CONFIG.QUEUE_LOWER_THRESHOLD,
    },
    dry_run: true,
    duration_ms: 0,
  };

  // Handle empty/null parameter name
  if (!labelNorm) {
    result.note = 'empty_label';
    result.duration_ms = Date.now() - startTime;
    return result;
  }

  // Tier A: Exact match
  const exactMatch = await findExactMatch(labelNorm);
  if (exactMatch) {
    const analyte = await getAnalyteById(exactMatch.analyte_id);
    result.tiers.deterministic = {
      matched: true,
      alias: exactMatch.alias,
      analyte_id: exactMatch.analyte_id,
    };
    result.final_decision = 'MATCH_EXACT';
    result.final_analyte = {
      analyte_id: analyte.analyte_id,
      code: analyte.code,
      name: analyte.name,
      source: 'deterministic',
    };
    result.confidence = 1.0;
    result.duration_ms = Date.now() - startTime;
    return result;
  }

  // Tier B: Fuzzy match (if pg_trgm available)
  if (hasPgTrgm) {
    const fuzzyMatch = await findFuzzyMatch(labelNorm);

    if (fuzzyMatch.ambiguous) {
      result.tiers.fuzzy = {
        matched: false,
        ambiguous: true,
        candidates: fuzzyMatch.candidates,
      };
      result.final_decision = 'AMBIGUOUS_FUZZY';
      result.duration_ms = Date.now() - startTime;
      return result;
    }

    if (fuzzyMatch.matched) {
      const analyte = await getAnalyteById(fuzzyMatch.topMatch.analyte_id);
      result.tiers.fuzzy = {
        matched: true,
        alias: fuzzyMatch.topMatch.alias,
        analyte_id: fuzzyMatch.topMatch.analyte_id,
        similarity: fuzzyMatch.topMatch.similarity,
      };
      result.final_decision = 'MATCH_FUZZY';
      result.final_analyte = {
        analyte_id: analyte.analyte_id,
        code: analyte.code,
        name: analyte.name,
        source: 'fuzzy',
      };
      result.confidence = fuzzyMatch.topMatch.similarity;
      result.duration_ms = Date.now() - startTime;
      return result;
    }
  } else {
    result.tiers.fuzzy = {
      matched: false,
      skipped: true,
      reason: 'pg_trgm unavailable',
    };
  }

  // Tier C: LLM suggestions
  // Note: LLM is called in batch mode after all rows are processed
  // This placeholder will be updated in dryRun()
  result.tiers.llm = { present: false };

  // No matches found
  result.duration_ms = Date.now() - startTime;
  return result;
}

/**
 * Run dry-run mapping for all lab results in a report
 *
 * @param {Object} options - { report_id, patient_id, analyte_suggestions }
 * @returns {Promise<Object>} - { summary, rows }
 */
async function dryRun({ report_id, patient_id, analyte_suggestions = null }) {
  const startTime = Date.now();

  // Check pg_trgm availability
  const hasPgTrgm = await checkPgTrgrm();
  if (!hasPgTrgm) {
    logger.warn({ report_id }, 'pg_trgm extension not available; fuzzy matching disabled');
  }

  // Fetch all lab results for this report
  const { rows: labResults } = await pool.query(
    `SELECT id, report_id, position, parameter_name, unit, numeric_result,
            result_value, reference_text
     FROM lab_results
     WHERE report_id = $1
     ORDER BY position`,
    [report_id]
  );

  // Add patient_id to each row
  const rowsWithPatientId = labResults.map(row => ({ ...row, patient_id }));

  // Process each row
  const rowLogs = [];
  const counters = {
    total_rows: labResults.length,
    deterministic_matches: 0,
    fuzzy_matches: 0,
    llm_matches: 0,
    new_llm: 0,
    abstain_llm: 0,
    unmapped: 0,
    ambiguous_fuzzy: 0,
    conflict_fuzzy_llm: 0,
  };

  const durations = {
    deterministic: [],
    fuzzy: [],
    llm: [],
  };

  let slowestRow = null;
  let maxDuration = 0;

  for (const row of rowsWithPatientId) {
    const rowResult = await processRow(row, hasPgTrgm, analyte_suggestions);
    rowLogs.push(rowResult);

    // Update counters
    switch (rowResult.final_decision) {
      case 'MATCH_EXACT':
        counters.deterministic_matches += 1;
        durations.deterministic.push(rowResult.duration_ms);
        break;
      case 'MATCH_FUZZY':
        counters.fuzzy_matches += 1;
        durations.fuzzy.push(rowResult.duration_ms);
        break;
      case 'MATCH_LLM':
        counters.llm_matches += 1;
        durations.llm.push(rowResult.duration_ms);
        break;
      case 'NEW_LLM':
        counters.new_llm += 1;
        break;
      case 'ABSTAIN_LLM':
        counters.abstain_llm += 1;
        break;
      case 'AMBIGUOUS_FUZZY':
        counters.ambiguous_fuzzy += 1;
        break;
      case 'CONFLICT_FUZZY_LLM':
        counters.conflict_fuzzy_llm += 1;
        break;
      case 'UNMAPPED':
        counters.unmapped += 1;
        break;
    }

    // Track slowest row
    if (rowResult.duration_ms > maxDuration) {
      maxDuration = rowResult.duration_ms;
      slowestRow = {
        result_id: rowResult.result_id,
        label: rowResult.label_raw,
        duration_ms: rowResult.duration_ms,
      };
    }

    // Don't log yet - we'll log after LLM tier
  }

  // Tier C: LLM Mapping (v0.9.1) - Batch processing
  const llmStartTime = Date.now();
  let llmMetrics = {
    total_tokens: { prompt: 0, completion: 0 },
    total_cost_usd: 0,
    duration_ms: 0,
    errors: 0
  };

  // Collect unmapped and ambiguous rows
  const unmappedRows = rowLogs.filter(r =>
    r.final_decision === 'UNMAPPED' || r.final_decision === 'AMBIGUOUS_FUZZY'
  );

  const mappedRows = rowLogs.filter(r =>
    r.final_decision === 'MATCH_EXACT' || r.final_decision === 'MATCH_FUZZY'
  );

  if (unmappedRows.length > 0) {
    try {
      // Fetch analyte schema
      const analyteSchema = await getAnalyteSchema();

      // Call LLM
      const llmResults = await proposeAnalytesWithLLM(unmappedRows, mappedRows, analyteSchema);

      // Merge LLM results back into rowLogs
      llmResults.forEach((llmResult, idx) => {
        const originalRow = unmappedRows[idx];
        const rowLogIndex = rowLogs.findIndex(r => r.result_id === originalRow.result_id);

        if (rowLogIndex !== -1) {
          const rowLog = rowLogs[rowLogIndex];

          // Update LLM tier
          if (llmResult.error) {
            rowLog.tiers.llm = {
              present: true,
              error: llmResult.error,
              decision: null,
              comment: llmResult.comment
            };
            llmMetrics.errors += 1;
          } else {
            rowLog.tiers.llm = {
              present: true,
              decision: llmResult.decision,
              code: llmResult.code,
              name: llmResult.name,
              confidence: llmResult.confidence,
              comment: llmResult.comment
            };

            // Update final decision if LLM provided a match
            if (llmResult.decision === 'MATCH' && llmResult.code) {
              rowLog.final_decision = 'MATCH_LLM';
              rowLog.confidence = llmResult.confidence;
              // Note: We don't fetch full analyte details in dry-run
              rowLog.final_analyte = {
                code: llmResult.code,
                source: 'llm'
              };
              counters.llm_matches += 1;
            } else if (llmResult.decision === 'NEW') {
              rowLog.final_decision = 'NEW_LLM';
              rowLog.confidence = llmResult.confidence;
              counters.new_llm += 1;
            } else if (llmResult.decision === 'ABSTAIN') {
              rowLog.final_decision = 'ABSTAIN_LLM';
              counters.abstain_llm += 1;
            }
          }
        }
      });

      llmMetrics.duration_ms = Date.now() - llmStartTime;
    } catch (error) {
      logger.error({ error: error.message, report_id }, 'LLM tier failed');
      llmMetrics.errors = unmappedRows.length;
      llmMetrics.duration_ms = Date.now() - llmStartTime;
    }
  }

  // Now log individual rows (after LLM processing)
  rowLogs.forEach(rowResult => logger.info(rowResult));

  // Calculate summary statistics
  const totalDuration = Date.now() - startTime;
  const avgRowLatency = labResults.length > 0
    ? totalDuration / labResults.length
    : 0;

  const avgDuration = (arr) => arr.length > 0
    ? arr.reduce((a, b) => a + b, 0) / arr.length
    : 0;

  // Estimate auto-accept and queue counts
  // Note: Deterministic matches have confidence = 1.0, so they're already included
  const estimatedAutoAccept = rowLogs.filter(r =>
    r.confidence >= CONFIG.AUTO_ACCEPT_THRESHOLD
  ).length;

  const estimatedQueue = rowLogs.filter(r =>
    r.confidence >= CONFIG.QUEUE_LOWER_THRESHOLD &&
    r.confidence < CONFIG.AUTO_ACCEPT_THRESHOLD
  ).length;

  // Data quality metrics
  const dataQuality = {
    rows_with_unit: rowLogs.filter(r => r.unit).length,
    rows_with_numeric_result: rowLogs.filter(r => r.numeric_result !== null).length,
    rows_with_reference: rowLogs.filter(r => r.reference_hint).length,
    rows_with_all_fields: rowLogs.filter(r =>
      r.unit && r.numeric_result !== null && r.reference_hint
    ).length,
  };

  // Build summary log
  const summary = {
    event: 'mapping.summary',
    report_id,
    patient_id,
    counts: counters,
    estimated_auto_accept: estimatedAutoAccept,
    estimated_queue: estimatedQueue,
    estimated_new: counters.new_llm,
    performance: {
      total_duration_ms: totalDuration,
      avg_row_latency_ms: parseFloat(avgRowLatency.toFixed(1)),
      tier_breakdown: {
        deterministic_avg_ms: parseFloat(avgDuration(durations.deterministic).toFixed(1)),
        fuzzy_avg_ms: parseFloat(avgDuration(durations.fuzzy).toFixed(1)),
        llm_avg_ms: parseFloat(avgDuration(durations.llm).toFixed(1)),
      },
      slowest_row: slowestRow,
    },
    llm: {
      matches: counters.llm_matches,
      new: counters.new_llm,
      abstain: counters.abstain_llm,
      errors: llmMetrics.errors,
      avg_confidence: counters.llm_matches > 0
        ? rowLogs.filter(r => r.final_decision === 'MATCH_LLM')
            .reduce((sum, r) => sum + (r.confidence || 0), 0) / counters.llm_matches
        : 0,
      total_cost_usd: llmMetrics.total_cost_usd,
      total_tokens: llmMetrics.total_tokens,
      duration_ms: llmMetrics.duration_ms
    },
    data_quality: dataQuality,
    thresholds_used: {
      fuzzy_match: CONFIG.FUZZY_MATCH_THRESHOLD,
      auto_accept: CONFIG.AUTO_ACCEPT_THRESHOLD,
      queue_lower: CONFIG.QUEUE_LOWER_THRESHOLD,
    },
  };

  // Log summary
  logger.info(summary);

  return { summary, rows: rowLogs };
}

module.exports = {
  dryRun,
  normalizeLabel,
  // Export for testing
  _internal: {
    findExactMatch,
    findFuzzyMatch,
    processRow,
  },
};
