// server/services/MappingApplier.js
// PRD v0.9 + v0.9.1: Mapping Applier (Dry-Run Mode)
// Performs read-only analyte mapping with structured logging
// v0.9.1: Adds Tier C (LLM-based mapping)

const pino = require('pino');
const { pool } = require('../db');
const OpenAI = require('openai');
const { detectLanguage } = require('../utils/languageDetection');

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
- decision "MATCH": code exists in schema above (confirm or reject fuzzy suggestions if provided)
- decision "NEW": valid analyte but not in schema (propose new code + name)
- decision "ABSTAIN": cannot determine mapping
- For rows with fuzzy match suggestions, evaluate if the suggestion is correct:
  * If correct → return "MATCH" with same code and confidence ≥0.80
  * If incorrect → return "NEW" or "ABSTAIN" or suggest different code from schema
- For ambiguous fuzzy matches, pick the most appropriate candidate or reject all

Return JSON array with one object per parameter:
{
  "results": [
    {
      "label": "parameter name",
      "decision": "MATCH" | "NEW" | "ABSTAIN",
      "code": "string or null",
      "name": "string or null (only for NEW)",
      "confidence": 0.95,
      "comment": "brief reason (mention if confirming/rejecting fuzzy match)"
    }
  ]
}

Parameters to map:
${unmappedRows.map((row, i) => {
  let contextText = '';

  // Add provisional fuzzy match context
  if (row.provisional_analyte) {
    const confidence = Number(row.provisional_analyte.confidence);
    const confStr = Number.isFinite(confidence) ? confidence.toFixed(2) : String(row.provisional_analyte.confidence);
    contextText = `   Fuzzy suggestion: ${row.provisional_analyte.code} - ${row.provisional_analyte.name} (confidence: ${confStr})`;
  }
  // Add ambiguous candidates context
  else if (row.tiers?.fuzzy?.candidates) {
    contextText = `   Ambiguous matches: ${row.tiers.fuzzy.candidates.map(c => {
      const sim = Number(c.similarity);
      const simStr = Number.isFinite(sim) ? sim.toFixed(2) : String(c.similarity);
      return `[${c.analyte_id}] sim: ${simStr}`;
    }).join(', ')}`;
  }

  return `
${i + 1}. Label: "${row.label_raw}"
   Unit: ${row.unit || 'none'}
   Reference: ${row.reference_hint || 'none'}${contextText ? '\n' + contextText : ''}`;
}).join('\n')}`;
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

    // Case 1: Ambiguous fuzzy match → store candidates, continue to LLM for resolution
    if (fuzzyMatch.ambiguous) {
      result.tiers.fuzzy = {
        matched: false,
        ambiguous: true,
        candidates: fuzzyMatch.candidates,
      };
      // Keep AMBIGUOUS_FUZZY decision for telemetry, but mark for LLM review
      result.final_decision = 'AMBIGUOUS_FUZZY';
      result.needs_llm_review = true; // Flag for LLM processing
      result.note = 'ambiguous_fuzzy_needs_llm';
    }
    // Case 2: High-confidence fuzzy match (≥0.80) → accept immediately
    else if (fuzzyMatch.matched && fuzzyMatch.topMatch.similarity >= CONFIG.AUTO_ACCEPT_THRESHOLD) {
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
    // Case 3: Medium-confidence fuzzy match (0.60-0.79) → store candidate, continue to LLM
    else if (fuzzyMatch.matched && fuzzyMatch.topMatch.similarity >= CONFIG.QUEUE_LOWER_THRESHOLD) {
      const analyte = await getAnalyteById(fuzzyMatch.topMatch.analyte_id);
      result.tiers.fuzzy = {
        matched: true,
        alias: fuzzyMatch.topMatch.alias,
        analyte_id: fuzzyMatch.topMatch.analyte_id,
        similarity: fuzzyMatch.topMatch.similarity,
      };
      // Store as provisional match but continue to LLM for confirmation
      result.provisional_analyte = {
        analyte_id: analyte.analyte_id,
        code: analyte.code,
        name: analyte.name,
        source: 'fuzzy',
        confidence: fuzzyMatch.topMatch.similarity,
      };
      result.final_decision = 'NEEDS_LLM_REVIEW';
      result.note = 'medium_confidence_fuzzy_needs_llm';
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

  // No matches found yet - will be updated after LLM tier
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
    fuzzy_confirmed_by_llm: 0,
    llm_matches: 0,
    new_llm: 0,
    abstain_llm: 0,
    unmapped: 0,
    ambiguous_fuzzy: 0,
    needs_llm_review: 0,
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
      case 'MATCH_FUZZY_CONFIRMED':
        counters.fuzzy_confirmed_by_llm += 1;
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
      case 'NEEDS_LLM_REVIEW':
        counters.needs_llm_review += 1;
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

  // Collect rows that need LLM review (unmapped, ambiguous, and medium-confidence fuzzy)
  const unmappedRows = rowLogs.filter(r =>
    r.final_decision === 'UNMAPPED' ||
    r.final_decision === 'AMBIGUOUS_FUZZY' ||
    r.final_decision === 'NEEDS_LLM_REVIEW'
  );

  const mappedRows = rowLogs.filter(r =>
    r.final_decision === 'MATCH_EXACT' || r.final_decision === 'MATCH_FUZZY'
  );

  // Capture pre-LLM counts for metrics (before counters get decremented during LLM processing)
  const preLlmCounts = {
    unmapped: counters.unmapped,
    ambiguous_fuzzy: counters.ambiguous_fuzzy,
    needs_llm_review: counters.needs_llm_review,
    total: unmappedRows.length
  };

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

          // CRITICAL: Capture initial decision BEFORE any mutations
          // (originalRow and rowLog share the same reference)
          const initialDecision = rowLog.final_decision;

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

            // Update final decision based on LLM result and fuzzy context
            if (llmResult.decision === 'MATCH' && llmResult.code) {
              // LLM confirmed a match (either new or confirming fuzzy)
              const llmConfidence = llmResult.confidence || 0;
              const fuzzyConfidence = rowLog.provisional_analyte?.confidence || 0;

              // Check if LLM is confirming the fuzzy match
              const confirmingFuzzy = rowLog.provisional_analyte &&
                rowLog.provisional_analyte.code === llmResult.code;

              if (confirmingFuzzy) {
                // LLM confirmed fuzzy match → boost confidence
                rowLog.final_decision = 'MATCH_FUZZY_CONFIRMED';
                rowLog.confidence = Math.max(llmConfidence, fuzzyConfidence, CONFIG.AUTO_ACCEPT_THRESHOLD);
                rowLog.final_analyte = {
                  analyte_id: rowLog.provisional_analyte.analyte_id,
                  code: rowLog.provisional_analyte.code,
                  name: rowLog.provisional_analyte.name,
                  source: 'fuzzy_confirmed_by_llm',
                };
                // Update counters: decrement initial state, increment fuzzy_confirmed
                if (initialDecision === 'NEEDS_LLM_REVIEW') counters.needs_llm_review -= 1;
                else if (initialDecision === 'UNMAPPED') counters.unmapped -= 1;
                else if (initialDecision === 'AMBIGUOUS_FUZZY') counters.ambiguous_fuzzy -= 1;
                counters.fuzzy_confirmed_by_llm += 1;
              } else if (llmConfidence > fuzzyConfidence) {
                // LLM found a better match than fuzzy
                rowLog.final_decision = 'MATCH_LLM';
                rowLog.confidence = llmConfidence;
                rowLog.final_analyte = {
                  code: llmResult.code,
                  source: 'llm',
                };
                if (rowLog.provisional_analyte) {
                  rowLog.note = 'llm_overrode_fuzzy';
                }
                // Update counters: decrement initial state, increment llm_matches
                if (initialDecision === 'NEEDS_LLM_REVIEW') counters.needs_llm_review -= 1;
                else if (initialDecision === 'UNMAPPED') counters.unmapped -= 1;
                else if (initialDecision === 'AMBIGUOUS_FUZZY') counters.ambiguous_fuzzy -= 1;
                counters.llm_matches += 1;
              } else {
                // Keep fuzzy match but note LLM disagreement
                rowLog.final_decision = 'CONFLICT_FUZZY_LLM';
                rowLog.confidence = fuzzyConfidence;
                rowLog.final_analyte = rowLog.provisional_analyte;
                rowLog.llm_alternative = {
                  code: llmResult.code,
                  confidence: llmConfidence,
                };
                // Update counters: decrement initial state, increment conflict
                if (initialDecision === 'NEEDS_LLM_REVIEW') counters.needs_llm_review -= 1;
                else if (initialDecision === 'AMBIGUOUS_FUZZY') counters.ambiguous_fuzzy -= 1;
                counters.conflict_fuzzy_llm += 1;
              }
            } else if (llmResult.decision === 'NEW') {
              // LLM proposes new analyte
              rowLog.final_decision = 'NEW_LLM';
              rowLog.confidence = llmResult.confidence;
              // Update counters: decrement initial state, increment new_llm
              if (initialDecision === 'NEEDS_LLM_REVIEW') counters.needs_llm_review -= 1;
              else if (initialDecision === 'UNMAPPED') counters.unmapped -= 1;
              else if (initialDecision === 'AMBIGUOUS_FUZZY') counters.ambiguous_fuzzy -= 1;
              counters.new_llm += 1;
            } else if (llmResult.decision === 'ABSTAIN') {
              // LLM couldn't determine - fall back to fuzzy if available
              if (rowLog.provisional_analyte) {
                rowLog.final_decision = 'MATCH_FUZZY';
                rowLog.confidence = rowLog.provisional_analyte.confidence;
                rowLog.final_analyte = rowLog.provisional_analyte;
                rowLog.note = 'llm_abstained_kept_fuzzy';
                // Update counters: decrement initial state, increment fuzzy_matches
                if (initialDecision === 'NEEDS_LLM_REVIEW') counters.needs_llm_review -= 1;
                else if (initialDecision === 'UNMAPPED') counters.unmapped -= 1;
                else if (initialDecision === 'AMBIGUOUS_FUZZY') counters.ambiguous_fuzzy -= 1;
                counters.fuzzy_matches += 1;
              } else {
                rowLog.final_decision = 'ABSTAIN_LLM';
                // Update counters: decrement initial state, increment abstain
                if (initialDecision === 'NEEDS_LLM_REVIEW') counters.needs_llm_review -= 1;
                else if (initialDecision === 'UNMAPPED') counters.unmapped -= 1;
                else if (initialDecision === 'AMBIGUOUS_FUZZY') counters.ambiguous_fuzzy -= 1;
                counters.abstain_llm += 1;
              }
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
      // Total rows sent to LLM tier (for capacity planning) - captured BEFORE counter decrements
      total_input_rows: preLlmCounts.total,
      // Breakdown by input type - captured BEFORE counter decrements
      input_breakdown: {
        unmapped: preLlmCounts.unmapped,
        ambiguous_fuzzy: preLlmCounts.ambiguous_fuzzy,
        medium_confidence_fuzzy: preLlmCounts.needs_llm_review,
      },
      // Output results (after LLM processing)
      matches: counters.llm_matches,
      fuzzy_confirmed: counters.fuzzy_confirmed_by_llm,
      new: counters.new_llm,
      abstain: counters.abstain_llm,
      errors: llmMetrics.errors,
      avg_confidence: (counters.llm_matches + counters.fuzzy_confirmed_by_llm) > 0
        ? rowLogs.filter(r => r.final_decision === 'MATCH_LLM' || r.final_decision === 'MATCH_FUZZY_CONFIRMED')
            .reduce((sum, r) => sum + (r.confidence || 0), 0) / (counters.llm_matches + counters.fuzzy_confirmed_by_llm)
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

/**
 * Write analyte_id to lab_results table
 *
 * @param {string} resultId - UUID of lab_result
 * @param {number} analyteId - ID of matched analyte
 * @param {number} confidence - Confidence score (0-1)
 * @param {string} source - Mapping source (auto_exact, auto_fuzzy, auto_llm)
 * @returns {Promise<number>} - Number of rows updated
 */
async function writeAnalyteId(resultId, analyteId, confidence, source) {
  const { rowCount } = await pool.query(
    `UPDATE lab_results
     SET analyte_id = $1,
         mapping_confidence = $2,
         mapping_source = $3,
         mapped_at = NOW()
     WHERE id = $4
       AND analyte_id IS NULL`,
    [analyteId, confidence, source, resultId]
  );
  return rowCount;
}

/**
 * Queue NEW analyte to pending_analytes table
 *
 * @param {Object} rowResult - Row decision object from dryRun
 * @returns {Promise<void>}
 */
async function queueNewAnalyte(rowResult) {
  const { tiers, label_raw, unit, report_id } = rowResult;
  const llm = tiers.llm;

  if (!llm.code || !llm.name) {
    logger.warn({ result_id: rowResult.result_id }, 'Cannot queue NEW analyte: missing code or name');
    return;
  }

  // Build evidence object
  const evidence = {
    report_id: report_id,
    parameter_name: label_raw,
    unit: unit,
    llm_comment: llm.comment,
    first_seen: new Date().toISOString(),
    occurrence_count: 1
  };

  // Build parameter variations array
  const normalized = normalizeLabel(label_raw);
  const lang = detectLanguage(label_raw);
  const parameterVariations = [{
    raw: label_raw,
    normalized: normalized,
    lang: lang,
    count: 1
  }];

  try {
    await pool.query(
      `INSERT INTO pending_analytes
         (proposed_code, proposed_name, unit_canonical, category, confidence, evidence, status, parameter_variations)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
       ON CONFLICT (proposed_code) DO UPDATE SET
         confidence = GREATEST(pending_analytes.confidence, EXCLUDED.confidence),
         evidence = CASE
           WHEN pending_analytes.evidence IS NULL THEN EXCLUDED.evidence
           ELSE jsonb_build_object(
             'report_id', EXCLUDED.evidence->>'report_id',
             'result_id', EXCLUDED.evidence->>'result_id',
             'parameter_name', EXCLUDED.evidence->>'parameter_name',
             'unit', EXCLUDED.evidence->>'unit',
             'llm_comment', EXCLUDED.evidence->>'llm_comment',
             'first_seen', pending_analytes.evidence->>'first_seen',
             'last_seen', EXCLUDED.evidence->>'first_seen',
             'occurrence_count', (COALESCE((pending_analytes.evidence->>'occurrence_count')::int, 0) + 1)
           )
         END,
         parameter_variations = CASE
           WHEN pending_analytes.parameter_variations IS NULL THEN EXCLUDED.parameter_variations
           ELSE pending_analytes.parameter_variations || EXCLUDED.parameter_variations
         END,
         updated_at = NOW()`,
      [
        llm.code,
        llm.name,
        unit,
        llm.category || 'uncategorized',
        llm.confidence,
        JSON.stringify(evidence),
        JSON.stringify(parameterVariations)
      ]
    );

    logger.info({
      result_id: rowResult.result_id,
      proposed_code: llm.code,
      proposed_name: llm.name
    }, '[wetRun] NEW analyte queued');
  } catch (error) {
    logger.error({ error: error.message, result_id: rowResult.result_id }, 'Failed to queue NEW analyte');
  }
}

/**
 * Hydrate fuzzy candidates with full analyte data (code, name)
 * @param {Array} fuzzyCandidates - Array of {analyte_id, alias, similarity}
 * @param {string} source - Source label for candidates
 * @returns {Promise<Array>} - Array of hydrated candidates with code/name
 */
async function hydrateFuzzyCandidates(fuzzyCandidates, source = 'fuzzy') {
  if (!fuzzyCandidates || fuzzyCandidates.length === 0) {
    return [];
  }

  const analyteIds = fuzzyCandidates.map(c => c.analyte_id).filter(Boolean);
  if (analyteIds.length === 0) {
    return [];
  }

  // Batch fetch all analyte details
  const { rows: analytes } = await pool.query(
    `SELECT analyte_id, code, name FROM analytes WHERE analyte_id = ANY($1)`,
    [analyteIds]
  );

  // Build lookup map
  const analyteMap = new Map(analytes.map(a => [a.analyte_id, a]));

  // Hydrate candidates
  return fuzzyCandidates.map(c => {
    const analyte = analyteMap.get(c.analyte_id);
    return {
      analyte_id: c.analyte_id,
      code: analyte?.code || null,        // Admin UI expects 'code'
      name: analyte?.name || null,        // Admin UI expects 'name'
      alias: c.alias || null,             // Preserve alias for reference
      similarity: c.similarity,
      source
    };
  }).filter(c => c.code); // Only include candidates with valid code
}

/**
 * Queue match for human review (ambiguous or medium-confidence)
 *
 * @param {Object} rowResult - Row decision object with match data
 * @returns {Promise<void>}
 */
async function queueForReview(rowResult) {
  const { result_id, tiers, final_decision, final_analyte, confidence, provisional_analyte, llm_alternative } = rowResult;

  let candidates = [];

  // Case 1: Ambiguous fuzzy match with multiple candidates
  if (final_decision === 'AMBIGUOUS_FUZZY' && tiers.fuzzy?.candidates) {
    candidates = await hydrateFuzzyCandidates(tiers.fuzzy.candidates, 'fuzzy');
  }
  // Case 2: Medium-confidence single fuzzy match (0.60-0.79)
  else if (final_decision === 'MATCH_FUZZY' && final_analyte?.analyte_id) {
    candidates = [{
      analyte_id: final_analyte.analyte_id,
      code: final_analyte.code,
      name: final_analyte.name,
      similarity: confidence,
      source: 'fuzzy'
    }];
  }
  // Case 3: Medium-confidence LLM match (0.60-0.79)
  else if (final_decision === 'MATCH_LLM' && final_analyte?.code) {
    // Look up analyte_id by code
    const { rows: analyteRows } = await pool.query(
      'SELECT analyte_id, code, name FROM analytes WHERE code = $1',
      [final_analyte.code]
    );

    if (analyteRows.length > 0) {
      candidates = [{
        analyte_id: analyteRows[0].analyte_id,
        code: analyteRows[0].code,
        name: analyteRows[0].name,
        similarity: confidence,
        source: 'llm'
      }];
    }
  }
  // Case 4: NEEDS_LLM_REVIEW - row had fuzzy candidates but LLM hasn't run yet (e.g., API key missing)
  else if (final_decision === 'NEEDS_LLM_REVIEW') {
    // Use provisional_analyte if available
    if (provisional_analyte) {
      candidates = [{
        analyte_id: provisional_analyte.analyte_id,
        code: provisional_analyte.code,
        name: provisional_analyte.name,
        similarity: provisional_analyte.confidence,
        source: 'fuzzy_provisional'
      }];
    }
    // Or use ambiguous fuzzy candidates
    else if (tiers.fuzzy?.candidates) {
      candidates = await hydrateFuzzyCandidates(tiers.fuzzy.candidates, 'fuzzy_ambiguous');
    }
  }
  // Case 5: CONFLICT_FUZZY_LLM - fuzzy and LLM disagree, queue both options
  else if (final_decision === 'CONFLICT_FUZZY_LLM') {
    // Add fuzzy match(es) as candidate(s)
    if (final_analyte?.analyte_id) {
      // Single fuzzy match case (medium-confidence that LLM disagreed with)
      candidates.push({
        analyte_id: final_analyte.analyte_id,
        code: final_analyte.code,
        name: final_analyte.name,
        similarity: confidence,
        source: 'fuzzy'
      });
    } else if (tiers.fuzzy?.candidates) {
      // Ambiguous fuzzy match case - add all original candidates
      // (this happens when AMBIGUOUS_FUZZY -> LLM picks one, but with low confidence)
      const fuzzyCandidates = await hydrateFuzzyCandidates(tiers.fuzzy.candidates, 'fuzzy_ambiguous');
      candidates.push(...fuzzyCandidates);
    }

    // Add LLM alternative as additional candidate
    if (llm_alternative?.code) {
      const { rows: analyteRows } = await pool.query(
        'SELECT analyte_id, code, name FROM analytes WHERE code = $1',
        [llm_alternative.code]
      );

      if (analyteRows.length > 0) {
        candidates.push({
          analyte_id: analyteRows[0].analyte_id,
          code: analyteRows[0].code,
          name: analyteRows[0].name,
          similarity: llm_alternative.confidence,
          source: 'llm_alternative'
        });
      }
    }
  }

  if (candidates.length === 0) {
    logger.warn({
      result_id,
      final_decision,
      has_provisional: !!provisional_analyte,
      has_fuzzy_candidates: !!tiers.fuzzy?.candidates,
      has_llm_alternative: !!llm_alternative
    }, 'Cannot queue for review: no candidates generated');
    return;
  }

  try {
    await pool.query(
      `INSERT INTO match_reviews
         (result_id, candidates, status, created_at)
       VALUES ($1, $2, 'pending', NOW())
       ON CONFLICT (result_id) DO UPDATE SET
         candidates = EXCLUDED.candidates,
         status = 'pending',
         updated_at = NOW()`,
      [
        result_id,
        JSON.stringify(candidates)
      ]
    );

    logger.info({
      result_id,
      candidates_count: candidates.length,
      decision: final_decision
    }, '[wetRun] Match queued for review');
  } catch (error) {
    logger.error({ error: error.message, result_id }, 'Failed to queue for review');
  }
}

/**
 * Apply analyte mapping with database writes (PRD v2.4)
 *
 * @param {Object} params
 * @param {string} params.reportId - UUID of patient_report
 * @param {string} params.patientId - UUID of patient
 * @param {Array} params.parameters - Lab result rows (optional, fetched if not provided)
 * @returns {Promise<Object>} - Mapping decisions + write results
 */
async function wetRun({ reportId, patientId, parameters }) {
  logger.info({ report_id: reportId }, '[wetRun] Starting write mode');

  // First, run dry-run to get mapping decisions
  const { summary, rows } = await dryRun({
    report_id: reportId,
    patient_id: patientId,
    analyte_suggestions: null
  });

  // Counters for summary
  const counters = {
    written: 0,
    queued_for_review: 0,
    new_queued: 0,
    skipped: 0,
    already_mapped: 0
  };

  // Process each row decision
  for (const row of rows) {
    const { final_decision, confidence, final_analyte, result_id } = row;

    // Skip if already mapped
    const { rows: existing } = await pool.query(
      'SELECT analyte_id FROM lab_results WHERE id = $1',
      [result_id]
    );

    if (existing[0]?.analyte_id) {
      counters.already_mapped++;
      continue;
    }

    // High confidence matches → Write immediately
    if (final_decision === 'MATCH_EXACT') {
      const rowsAffected = await writeAnalyteId(
        result_id,
        final_analyte.analyte_id,
        1.0,
        'auto_exact'
      );
      if (rowsAffected > 0) {
        counters.written++;
      }
    }
    // High-confidence fuzzy match (≥0.80)
    else if (final_decision === 'MATCH_FUZZY' && confidence >= CONFIG.AUTO_ACCEPT_THRESHOLD) {
      const rowsAffected = await writeAnalyteId(
        result_id,
        final_analyte.analyte_id,
        confidence,
        'auto_fuzzy'
      );
      if (rowsAffected > 0) {
        counters.written++;
      }
    }
    // Fuzzy match confirmed by LLM (boosted confidence)
    else if (final_decision === 'MATCH_FUZZY_CONFIRMED') {
      const rowsAffected = await writeAnalyteId(
        result_id,
        final_analyte.analyte_id,
        confidence,
        'auto_fuzzy_llm_confirmed'
      );
      if (rowsAffected > 0) {
        counters.written++;
      }
    }
    // High-confidence LLM match (≥0.80)
    else if (final_decision === 'MATCH_LLM' && confidence >= CONFIG.AUTO_ACCEPT_THRESHOLD) {
      // For MATCH_LLM, we need to look up the analyte_id by code
      const { rows: analyteRows } = await pool.query(
        'SELECT analyte_id FROM analytes WHERE code = $1',
        [final_analyte.code]
      );

      if (analyteRows.length > 0) {
        const rowsAffected = await writeAnalyteId(
          result_id,
          analyteRows[0].analyte_id,
          confidence,
          'auto_llm'
        );
        if (rowsAffected > 0) {
          counters.written++;
        }
      }
    }

    // Medium confidence → Queue for review
    else if (
      (final_decision === 'MATCH_FUZZY' && confidence >= CONFIG.QUEUE_LOWER_THRESHOLD) ||
      (final_decision === 'MATCH_LLM' && confidence >= CONFIG.QUEUE_LOWER_THRESHOLD) ||
      (final_decision === 'AMBIGUOUS_FUZZY') ||
      (final_decision === 'CONFLICT_FUZZY_LLM') ||
      (final_decision === 'NEEDS_LLM_REVIEW')
    ) {
      await queueForReview(row);
      counters.queued_for_review++;
    }

    // NEW analytes → Always queue
    else if (final_decision === 'NEW_LLM') {
      await queueNewAnalyte(row);
      counters.new_queued++;
    }

    // Low confidence or unmapped → Skip
    else {
      counters.skipped++;
    }
  }

  const result = {
    summary: counters,
    dry_run_summary: summary
  };

  logger.info({
    report_id: reportId,
    ...counters
  }, '[wetRun] Write mode completed');

  return result;
}

module.exports = {
  wetRun,
  dryRun,  // Public API - used by scripts, tests, and docs
  normalizeLabel,
  // Export for testing
  _internal: {
    findExactMatch,
    findFuzzyMatch,
    processRow,
    writeAnalyteId,
    queueNewAnalyte,
    queueForReview,
    detectLanguage,
    dryRun, // Also keep in _internal for backward compatibility with tests
  },
};
