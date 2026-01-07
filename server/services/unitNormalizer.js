/**
 * PRD v4.8.2: Unit Normalization Step 3 - LLM Fallback
 *
 * Two-tiered unit normalization:
 * - Tier A: Exact match against unit_aliases table (fast, free)
 * - Tier B: LLM normalization with auto-learning (smart, accurate)
 *
 * Key features:
 * - Connection pool safety: No DB connection held during LLM calls
 * - Auto-learning: High-confidence LLM matches become exact matches
 * - Admin review queue: Problematic units queued for human review
 * - Conflict detection: Prevents overwriting existing aliases
 */

import { pool } from '../db/index.js';
import OpenAI from 'openai';
import logger from '../utils/logger.js';
import pLimit from 'p-limit';
import ucumPkg from '@lhncbc/ucum-lhc';

// Configuration
const LLM_AUTO_LEARN_ENABLED = process.env.LLM_AUTO_LEARN_ENABLED !== 'false';
const LLM_AUTO_LEARN_CONFIDENCE = process.env.LLM_AUTO_LEARN_CONFIDENCE || 'high';

// Confidence level comparison (low < medium < high)
const CONFIDENCE_LEVELS = ['low', 'medium', 'high'];
function confidenceMeetsThreshold(confidence, threshold) {
  const confIdx = CONFIDENCE_LEVELS.indexOf(confidence);
  const threshIdx = CONFIDENCE_LEVELS.indexOf(threshold);
  // If either is unknown, treat as not meeting threshold
  if (confIdx === -1 || threshIdx === -1) return false;
  return confIdx >= threshIdx;
}
const UNIT_NORMALIZATION_MODEL =
  process.env.UNIT_NORMALIZATION_MODEL ||
  process.env.SQL_GENERATOR_MODEL ||
  'gpt-4o-mini';
const MAX_RETRIES = parseInt(process.env.UNIT_NORMALIZATION_MAX_RETRIES || '3', 10);
const BACKOFF_MS = [1000, 2000, 4000]; // Exponential backoff

// Global concurrency limiter (optional, for production safety)
// Shared across ALL reports to prevent exceeding provider rate limits
const GLOBAL_CONCURRENCY = process.env.UNIT_NORMALIZATION_GLOBAL_CONCURRENCY
  ? parseInt(process.env.UNIT_NORMALIZATION_GLOBAL_CONCURRENCY, 10)
  : null;
const globalLimiter = GLOBAL_CONCURRENCY ? pLimit(GLOBAL_CONCURRENCY) : null;

// PRD v4.8.3: UCUM Validation Configuration
const UCUM_VALIDATION_ENABLED = process.env.UCUM_VALIDATION_ENABLED !== 'false';
const UCUM_VALIDATION_STRICT = process.env.UCUM_VALIDATION_STRICT === 'true';

// UCUM library singleton (lazy initialization)
let ucumUtils = null;
let ucumInitError = null;

/**
 * Get UCUM utils instance (lazy initialization)
 * Returns null if library failed to initialize
 */
function getUcumUtils() {
  if (ucumInitError) {
    return null; // Already failed, don't retry
  }

  if (!ucumUtils) {
    try {
      ucumUtils = ucumPkg.UcumLhcUtils.getInstance();
      logger.info('[unitNormalizer] UCUM library initialized successfully');
    } catch (error) {
      ucumInitError = error;
      logger.error({ error: error.message }, '[unitNormalizer] Failed to initialize UCUM library');
      return null;
    }
  }
  return ucumUtils;
}

/**
 * Optional: Eager initialization at server startup
 * Call from server/index.js after database connection
 */
export function initializeUcumValidator() {
  return getUcumUtils() !== null;
}

/**
 * Validate a unit string against UCUM specification
 * Uses UCUM library's auto-correction for common issues (e.g., IU/mL → [IU]/mL)
 *
 * @param {string} unit - Unit string to validate
 * @returns {{isValid: boolean, ucumCode: string|null, messages: string[], corrected: boolean, suggestions: string[]}}
 */
function validateUcum(unit) {
  // Handle missing UCUM library gracefully
  const utils = getUcumUtils();
  if (!utils) {
    logger.warn('[unitNormalizer] UCUM library not available, skipping validation');
    return { isValid: true, ucumCode: unit, messages: ['UCUM library unavailable'], corrected: false, suggestions: [] };
  }

  if (!unit || typeof unit !== 'string') {
    return { isValid: false, ucumCode: null, messages: ['Empty or invalid input'], corrected: false, suggestions: [] };
  }

  const result = utils.validateUnitString(unit, true); // true = suggest corrections

  // Case 1: Valid as-is
  if (result.status === 'valid') {
    const hasWarnings = result.msg && result.msg.some(m => m.toLowerCase().includes('warning'));
    const isValid = !UCUM_VALIDATION_STRICT || !hasWarnings;
    return {
      isValid,
      ucumCode: result.ucumCode || unit,
      messages: result.msg || [],
      corrected: false,
      suggestions: []
    };
  }

  // Case 2: Invalid but UCUM provided auto-correction (e.g., IU/mL → [IU]/mL)
  if (result.status === 'invalid' && result.ucumCode) {
    logger.info({
      original: unit,
      corrected: result.ucumCode,
      suggestion: result.msg?.[0]
    }, '[unitNormalizer] UCUM auto-corrected unit');
    return {
      isValid: true,
      ucumCode: result.ucumCode,
      messages: result.msg || [],
      corrected: true,
      suggestions: []
    };
  }

  // Case 3: Invalid - extract suggestions from UCUM for LLM retry
  const suggestionCodes = [];
  if (result.suggestions?.length > 0) {
    for (const s of result.suggestions) {
      if (s.units) {
        for (const u of s.units) {
          if (u[0]) suggestionCodes.push(u[0]); // u[0] is the UCUM code
        }
      }
    }
  }

  return {
    isValid: false,
    ucumCode: null,
    messages: result.msg || [],
    corrected: false,
    suggestions: suggestionCodes.slice(0, 5) // Limit to 5 suggestions
  };
}

/**
 * Two-tiered unit normalization:
 * Tier A: Exact match (fast path, pooled query)
 * Tier B: LLM normalization (no connection held, with retry logic)
 *
 * @param {string} rawUnit - Raw unit string from OCR
 * @param {string} resultId - UUID of lab_results row (for admin review queue)
 * @param {string} [parameterName] - Optional parameter name for LLM context
 * @returns {Promise<{canonical: string, tier: string, confidence: string|null}>}
 *
 * Output contract:
 * - canonical: Always a string (raw input if no match, empty string if invalid input)
 * - tier: 'exact' | 'llm' | 'raw'
 * - confidence: 'high' | 'medium' | 'low' (for LLM tier) or null (for exact/raw)
 */
export async function normalizeUnit(rawUnit, resultId, parameterName = null) {
  logger.debug({ rawUnit, resultId, parameterName }, '[unitNormalizer] normalizeUnit called');

  // Empty input: return empty string (not null) to maintain string contract
  if (!rawUnit || typeof rawUnit !== 'string' || rawUnit.trim().length === 0) {
    return { canonical: '', tier: 'raw', confidence: null };
  }

  // Step 0: Normalize input (whitespace, NFKC, trim)
  // Use pooled query (auto-releases connection)
  const { rows: [{ result: normalized }] } = await pool.query(
    'SELECT normalize_unit_string($1) AS result',
    [rawUnit]
  );

  // Handle NULL from DB function (empty/whitespace after normalization)
  if (!normalized || normalized.trim().length === 0) {
    return { canonical: '', tier: 'raw', confidence: null };
  }

  // TIER A: Exact match (pooled query - auto-releases connection)
  const exactMatch = await pool.query(
    'SELECT unit_canonical FROM unit_aliases WHERE alias = $1',
    [normalized]
  );

  if (exactMatch.rows.length > 0) {
    return {
      canonical: exactMatch.rows[0].unit_canonical,
      tier: 'exact',
      confidence: null
    };
  }

  // TIER B: LLM normalization (NO CONNECTION HELD)
  try {
    const llmResult = await normalizeWithLLM(normalized, parameterName);

    // PRD v4.8.3: UCUM Validation before auto-learning
    // preprocessUcumOutput already applied in normalizeWithLLM()
    let finalCanonical = llmResult.canonical;

    if (llmResult.canonical && UCUM_VALIDATION_ENABLED) {
      const ucumValidation = validateUcum(llmResult.canonical);

      if (!ucumValidation.isValid) {
        // PRD v4.8.4: Try LLM retry with UCUM suggestions if available
        if (ucumValidation.suggestions?.length > 0) {
          logger.info({
            raw_unit: rawUnit,
            llm_canonical: llmResult.canonical,
            suggestions: ucumValidation.suggestions
          }, '[unitNormalizer] UCUM invalid, trying retry with suggestions');

          try {
            const retryResult = await retryWithUcumSuggestions(
              normalized, parameterName, ucumValidation.suggestions
            );

            if (retryResult?.selected && retryResult.selected !== 'NONE') {
              // Validate the selected suggestion
              const retryValidation = validateUcum(retryResult.selected);
              if (retryValidation.isValid) {
                logger.info({
                  original: llmResult.canonical,
                  retry_selected: retryResult.selected,
                  confidence: retryResult.confidence
                }, '[unitNormalizer] LLM retry with UCUM suggestions succeeded');

                finalCanonical = retryValidation.ucumCode || retryResult.selected;
                llmResult.confidence = retryResult.confidence; // Update confidence
                // Continue to auto-learn logic below
              } else {
                logger.warn({
                  retry_selected: retryResult.selected,
                  validation_errors: retryValidation.messages
                }, '[unitNormalizer] UCUM suggestion retry selected invalid code');
              }
            }
          } catch (retryError) {
            logger.warn({ error: retryError.message }, '[unitNormalizer] UCUM suggestion retry failed');
          }
        }

        // If still no valid result after retry, queue for admin review
        if (!finalCanonical || finalCanonical === llmResult.canonical) {
          await queueForAdminReview(resultId, rawUnit, normalized, llmResult, 'ucum_invalid', {
            message: 'LLM returned invalid UCUM code',
            llm_suggestion: llmResult.canonical,
            ucum_suggestions: ucumValidation.suggestions,
            ucum_errors: ucumValidation.messages
          });

          logger.warn({
            raw_unit: rawUnit,
            llm_canonical: llmResult.canonical,
            ucum_errors: ucumValidation.messages
          }, '[unitNormalizer] LLM result failed UCUM validation');

          return { canonical: rawUnit, tier: 'raw', confidence: null };
        }
      } else {
        // Use UCUM-normalized form (library may normalize case, etc.)
        finalCanonical = ucumValidation.ucumCode || llmResult.canonical;
      }
    }

    // Auto-learn if confidence meets configured threshold (LLM_AUTO_LEARN_CONFIDENCE)
    const shouldAutoLearn = LLM_AUTO_LEARN_ENABLED &&
      confidenceMeetsThreshold(llmResult.confidence, LLM_AUTO_LEARN_CONFIDENCE);

    if (finalCanonical && shouldAutoLearn) {
      // Auto-learn with conflict detection (pooled query - auto-releases)
      const conflict = await autoLearnAliasPooled(normalized, finalCanonical, 'llm');

      if (conflict.conflict) {
        // Conflict detected - queue for admin review
        await queueForAdminReview(resultId, rawUnit, normalized, llmResult, 'alias_conflict', {
          message: 'Existing alias maps to different canonical unit',
          existing_canonical: conflict.existing_canonical
        });

        logger.warn({
          raw_unit: rawUnit,
          normalized,
          llm_canonical: finalCanonical,
          existing_canonical: conflict.existing_canonical
        }, '[unitNormalizer] Alias conflict detected, queued for admin review');

        // Use raw unit until admin resolves
        return { canonical: rawUnit, tier: 'raw', confidence: null };
      }

      logger.info({
        raw_unit: rawUnit,
        normalized,
        canonical: finalCanonical,
        confidence: llmResult.confidence,
        model: llmResult.model,
        tier: 'llm_learned'
      }, '[unitNormalizer] LLM normalization auto-learned');

      return {
        canonical: finalCanonical,
        tier: 'llm',
        confidence: llmResult.confidence
      };
    } else if (finalCanonical) {
      // Medium/low confidence - queue for admin review
      await queueForAdminReview(resultId, rawUnit, normalized, llmResult, 'low_confidence', {
        message: `LLM confidence '${llmResult.confidence}' below auto-learn threshold '${LLM_AUTO_LEARN_CONFIDENCE}'`
      });

      logger.info({
        raw_unit: rawUnit,
        normalized,
        canonical: finalCanonical,
        confidence: llmResult.confidence,
        tier: 'needs_review',
        reason: 'low_confidence'
      }, '[unitNormalizer] LLM normalization queued for admin review');

      // Use raw unit until admin reviews
      return { canonical: rawUnit, tier: 'raw', confidence: null };
    }
  } catch (error) {
    // Distinguish sanitization errors from LLM API errors
    const isSanitizationError = error.message === 'Unit rejected by sanitization';
    const issueType = isSanitizationError ? 'sanitization_rejected' : 'llm_error';
    const issueMessage = isSanitizationError
      ? 'Unit contains unsafe characters and was rejected'
      : 'LLM API call failed after retries';

    logger.error({ error, raw_unit: rawUnit, issue_type: issueType }, '[unitNormalizer] LLM normalization failed');

    // Queue for admin review with appropriate error details
    await queueForAdminReview(resultId, rawUnit, normalized, null, issueType, {
      message: issueMessage,
      error: error.message
    });
  }

  // No match found - return raw unit (never null)
  logger.warn({
    raw_unit: rawUnit,
    normalized
  }, '[unitNormalizer] No match found, using raw unit');

  return {
    canonical: rawUnit,
    tier: 'raw',
    confidence: null
  };
}

/**
 * Normalize units for multiple results with deduplication and concurrency control
 *
 * @param {Array<{unit: string, resultId: string, parameterName?: string}>} units - Array of units from lab results
 * @returns {Promise<Map<string, object>>} Map of unit → normalization result
 */
export async function normalizeUnitsBatch(units) {
  logger.info({ input_count: units?.length }, '[unitNormalizer] normalizeUnitsBatch called');

  // Deduplicate by raw unit string (within single report)
  // Keep first occurrence's metadata (resultId, parameterName) for context
  const uniqueUnitsMap = new Map();
  for (const u of units) {
    if (u.unit && !uniqueUnitsMap.has(u.unit)) {
      uniqueUnitsMap.set(u.unit, { resultId: u.resultId, parameterName: u.parameterName });
    }
  }
  const uniqueUnits = [...uniqueUnitsMap.keys()];

  logger.info({ unique_count: uniqueUnits.length, units: uniqueUnits.slice(0, 5) }, '[unitNormalizer] Unique units to normalize');

  // Create per-report concurrency limiter
  const MAX_CONCURRENCY = parseInt(process.env.UNIT_NORMALIZATION_MAX_CONCURRENCY || '5', 10);
  const perReportLimit = pLimit(MAX_CONCURRENCY);

  // Build cache with concurrent LLM calls (limited)
  const normalizationCache = new Map();
  let errorCount = 0;

  await Promise.all(
    uniqueUnits.map(unit => {
      // Wrap in per-report limiter first
      const task = async () => {
        // Get metadata for this unit (resultId for admin queue, parameterName for LLM context)
        const metadata = uniqueUnitsMap.get(unit);
        try {
          const result = await normalizeUnit(unit, metadata?.resultId, metadata?.parameterName);
          normalizationCache.set(unit, result);
        } catch (error) {
          // Per-unit error isolation: log and continue with other units
          errorCount++;
          logger.error({ unit, error: error.message }, '[unitNormalizer] Single unit normalization failed');
          // Store raw unit as fallback
          normalizationCache.set(unit, { canonical: unit, tier: 'raw', confidence: null });
        }
      };

      // If global limiter exists, use both limiters (nested)
      // Otherwise, just use per-report limiter
      return globalLimiter
        ? globalLimiter(() => perReportLimit(task))
        : perReportLimit(task);
    })
  );

  if (errorCount > 0) {
    logger.warn({ errorCount, totalUnits: uniqueUnits.length }, '[unitNormalizer] Some units failed normalization');
  }

  return normalizationCache;
}

/**
 * Auto-learn alias using a dedicated connection for advisory lock safety
 * - Advisory locks are session-bound; pooled queries use different connections
 * - Must acquire connection, hold it for lock+queries, then release
 *
 * @param {string} alias - Normalized unit string
 * @param {string} canonical - Canonical UCUM unit
 * @param {string} source - Source of the alias ('llm', 'admin_approved')
 * @returns {Promise<{conflict: boolean, existing_canonical?: string}|null>}
 */
async function autoLearnAliasPooled(alias, canonical, source) {
  // CRITICAL: Get dedicated connection - advisory locks are session-bound
  const client = await pool.connect();

  try {
    // Advisory lock key: hash of alias string (prevents concurrent inserts)
    const lockKey = hashStringToInt32(alias);

    // Acquire session-level advisory lock (same connection used throughout)
    await client.query('SELECT pg_advisory_lock($1)', [lockKey]);

    try {
      // Check for existing alias with different canonical (conflict detection)
      const existing = await client.query(
        'SELECT unit_canonical FROM unit_aliases WHERE alias = $1',
        [alias]
      );

      if (existing.rows.length > 0 && existing.rows[0].unit_canonical !== canonical) {
        // Conflict detected - don't update
        logger.warn({
          alias,
          existing_canonical: existing.rows[0].unit_canonical,
          attempted_canonical: canonical
        }, '[unitNormalizer] Alias conflict detected during auto-learn');

        return {
          conflict: true,
          existing_canonical: existing.rows[0].unit_canonical
        };
      }

      // Insert with conflict handling (only increment if canonical matches)
      // NOTE: unit_aliases has 'alias TEXT PRIMARY KEY', no 'id' column
      const result = await client.query(`
        INSERT INTO unit_aliases (alias, unit_canonical, source, learn_count, last_used_at)
        VALUES ($1, $2, $3, 1, NOW())
        ON CONFLICT (alias) DO UPDATE SET
          learn_count = CASE
            WHEN unit_aliases.unit_canonical = EXCLUDED.unit_canonical
            THEN unit_aliases.learn_count + 1
            ELSE unit_aliases.learn_count
          END,
          last_used_at = NOW()
        RETURNING alias, learn_count, (xmax = 0) AS inserted
      `, [alias, canonical, source]);

      if (result.rows[0].inserted) {
        logger.info({ alias, canonical, source }, '[unitNormalizer] New alias auto-learned');
      } else {
        logger.debug({
          alias,
          canonical,
          learn_count: result.rows[0].learn_count
        }, '[unitNormalizer] Alias already exists, incremented learn_count');
      }

      return { conflict: false };
    } finally {
      // Release session-level lock (same connection)
      await client.query('SELECT pg_advisory_unlock($1)', [lockKey]);
    }
  } catch (error) {
    logger.error({ error, alias, canonical, source }, '[unitNormalizer] Failed to auto-learn alias');
    return { conflict: false }; // Don't throw - let main flow continue
  } finally {
    // CRITICAL: Always release connection back to pool
    client.release();
  }
}

/**
 * Queue problematic unit for admin review
 *
 * @param {string} resultId - UUID of lab_results row
 * @param {string} rawUnit - Original unit from OCR
 * @param {string} normalized - After normalize_unit_string()
 * @param {object} llmResult - LLM response (can be null if LLM failed)
 * @param {string} issueType - Type of issue
 * @param {object} issueDetails - Additional context
 */
async function queueForAdminReview(resultId, rawUnit, normalized, llmResult, issueType, issueDetails) {
  if (!resultId) {
    logger.warn({ rawUnit }, '[unitNormalizer] Cannot queue for review: missing resultId');
    return { queued: false, reason: 'missing_result_id' };
  }

  try {
    // PRD v4.8.3: Check if pending review already exists for same raw_unit
    // Prevents duplicate entries when same invalid unit appears in multiple uploads
    const existing = await pool.query(`
      SELECT review_id FROM unit_reviews
      WHERE raw_unit = $1 AND status = 'pending'
      LIMIT 1
    `, [rawUnit]);

    if (existing.rows.length > 0) {
      logger.debug({ rawUnit }, '[unitNormalizer] Pending review already exists, skipping');
      return { queued: false, reason: 'already_pending' };
    }

    await pool.query(`
      INSERT INTO unit_reviews (
        result_id,
        raw_unit,
        normalized_input,
        llm_suggestion,
        llm_confidence,
        llm_model,
        issue_type,
        issue_details,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
      ON CONFLICT (result_id) DO UPDATE SET
        raw_unit = EXCLUDED.raw_unit,
        normalized_input = EXCLUDED.normalized_input,
        llm_suggestion = EXCLUDED.llm_suggestion,
        llm_confidence = EXCLUDED.llm_confidence,
        llm_model = EXCLUDED.llm_model,
        issue_type = EXCLUDED.issue_type,
        issue_details = EXCLUDED.issue_details,
        status = 'pending',
        updated_at = NOW()
    `, [
      resultId,
      rawUnit,
      normalized,
      llmResult?.canonical || null,
      llmResult?.confidence || null,
      llmResult?.model || null,
      issueType,
      JSON.stringify(issueDetails)
    ]);

    logger.info({
      result_id: resultId,
      raw_unit: rawUnit,
      issue_type: issueType
    }, '[unitNormalizer] Queued unit for admin review');

    return { queued: true };
  } catch (error) {
    logger.error({ error, resultId, rawUnit }, '[unitNormalizer] Failed to queue for admin review');
    // Don't throw - queue failure shouldn't block ingestion
    return { queued: false, reason: 'error', error: error.message };
  }
}

/**
 * Simple hash function to convert string to int32 for advisory locks
 */
function hashStringToInt32(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash;
}

/**
 * Normalize unit using LLM with structured output (Responses API)
 * Includes retry logic with exponential backoff
 *
 * @param {string} unit - Normalized unit string
 * @param {string} [parameterName] - Optional parameter name for context
 * @returns {Promise<{canonical: string, confidence: string, model: string}>}
 */
async function normalizeWithLLM(unit, parameterName = null) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // INPUT SANITIZATION: Prevent prompt injection
  const sanitizedUnit = sanitizeUnitInput(unit);
  if (!sanitizedUnit) {
    logger.warn({ raw_unit: unit }, '[unitNormalizer] Unit rejected by sanitization');
    throw new Error('Unit rejected by sanitization');
  }

  // Build context string if parameter name is available (HINT ONLY)
  const contextLine = parameterName
    ? `\nParameter context (HINT ONLY): "${parameterName}"`
    : '';

  // Retry logic for transient errors
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // LLM call with Responses API for structured output
      const response = await client.responses.parse({
        model: UNIT_NORMALIZATION_MODEL,
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: `Convert this medical lab unit to its canonical UCUM code.

Unit: "${sanitizedUnit}"${contextLine}

CRITICAL RULES:
1. The UNIT STRING is authoritative - translate what the unit literally means
2. Standard units ALWAYS map to their obvious UCUM forms regardless of parameter:
   - "г/л" → "g/L" (grams per liter)
   - "мг/дл" → "mg/dL" (milligrams per deciliter)
   - "ммоль/л" → "mmol/L" (millimoles per liter)
   - "%" → "%" (percent)
3. Parameter name is ONLY a hint for truly ambiguous units like:
   - "Индекс" (Index) → use "1" or "{index}" based on parameter
   - "Ед" (Units) alone → check if enzyme units "U" or dimensionless "1"
4. If you recognize an OCR error, return the correct canonical form
5. For dimensionless values, use "1" or UCUM annotations like "{ratio}", "{index}"
6. Return confidence: "high" (certain), "medium" (likely), "low" (guessing)

Examples:
- "ммоль/л" → canonical: "mmol/L", confidence: "high"
- "г/л" (any parameter) → canonical: "g/L", confidence: "high"
- "10^9/л" → canonical: "10*9/L", confidence: "high"
- "МЕ/мл" → canonical: "IU/mL", confidence: "high"
- "Индекс" (for "Atherogenic Index") → canonical: "1", confidence: "high"
- "в п/зр." (per field of view) → canonical: "/[HPF]", confidence: "high"
- "unknown123" → canonical: "unknown123", confidence: "low"`
              }
            ]
          }
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'ucum_normalization',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                canonical: {
                  type: 'string',
                  description: 'Canonical UCUM unit code (ASCII only, max 50 chars)'
                },
                confidence: {
                  type: 'string',
                  enum: ['high', 'medium', 'low'],
                  description: 'Confidence level in the normalization'
                }
              },
              required: ['canonical', 'confidence'],
              additionalProperties: false
            }
          }
        }
      }, {
        timeout: 30000
      });

      // Validate response structure
      if (!response.output_parsed || typeof response.output_parsed !== 'object') {
        throw new Error('Invalid LLM response: missing output_parsed');
      }

      if (!response.output_parsed.canonical || typeof response.output_parsed.canonical !== 'string') {
        throw new Error('Invalid LLM response: missing canonical field');
      }

      if (!response.output_parsed.confidence || !['high', 'medium', 'low'].includes(response.output_parsed.confidence)) {
        throw new Error('Invalid LLM response: invalid confidence field');
      }

      const rawOutput = response.output_parsed.canonical;
      const confidence = response.output_parsed.confidence;

      // OUTPUT PREPROCESSING: Convert Unicode to ASCII equivalents
      // Note: Full UCUM validation will be added via ucum-lhc library in future PRD
      const canonical = preprocessUcumOutput(rawOutput);

      return {
        canonical: canonical || rawOutput, // Fallback to raw if preprocessing fails
        confidence,
        model: response.model
      };
    } catch (error) {
      const isRetryable = isRetryableError(error);
      const isLastAttempt = attempt === MAX_RETRIES - 1;

      if (isRetryable && !isLastAttempt) {
        const backoff = BACKOFF_MS[attempt] || BACKOFF_MS[BACKOFF_MS.length - 1];
        logger.warn({
          error: error.message,
          unit: sanitizedUnit,
          attempt: attempt + 1,
          max_retries: MAX_RETRIES,
          backoff_ms: backoff
        }, '[unitNormalizer] LLM call failed, retrying...');

        await sleep(backoff);
        continue;
      }

      // Non-retryable error or last attempt - throw
      logger.error({
        error: error.message,
        unit: sanitizedUnit,
        attempts: attempt + 1
      }, '[unitNormalizer] LLM API call failed');
      throw error;
    }
  }

  // Explicit throw if loop completes without returning
  // This should never happen (loop always returns or throws), but TypeScript/safety requires it
  throw new Error('LLM normalization failed: retry loop completed without result');
}

/**
 * Check if error is retryable (rate limits, timeouts, transient failures)
 */
function isRetryableError(error) {
  const message = error.message?.toLowerCase() || '';
  const status = error.status || error.response?.status;

  // Rate limit errors
  if (status === 429) return true;
  if (message.includes('rate limit')) return true;

  // Transient server errors
  if (status >= 500 && status < 600) return true;
  if (message.includes('timeout')) return true;
  if (message.includes('econnreset')) return true;
  if (message.includes('network')) return true;

  return false;
}

/**
 * Sleep helper for retry backoff
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Sanitize unit input to prevent prompt injection
 *
 * Character whitelist rationale:
 * - \p{L} allows ALL Unicode letters (Cyrillic, Greek, etc.) because medical units
 *   use diverse scripts (ммоль/л, μg/L, etc.)
 * - Parentheses/brackets needed for complex units like "mg/(kg·h)"
 * - Security relies on: (1) structured output schema, (2) output validation,
 *   (3) Responses API (not raw completion), (4) max length limit
 */
function sanitizeUnitInput(unit) {
  if (!unit || typeof unit !== 'string') {
    return null;
  }

  // Max length check (prevent abuse)
  if (unit.length > 100) {
    logger.warn({ unit_length: unit.length }, '[unitNormalizer] Unit too long, truncating');
    unit = unit.substring(0, 100);
  }

  // Character whitelist: Allow only safe characters for units
  // Includes: letters (all Unicode scripts), numbers, spaces, common unit symbols
  // Note: ^ is required for exponent notation (e.g., 10^9/L for cell counts)
  const allowedPattern = /^[\p{L}\p{N}\s\/\.\-\*\^\(\)\[\]%°²³⁴μΩ]+$/u;

  if (!allowedPattern.test(unit)) {
    logger.warn({ unit }, '[unitNormalizer] Unit contains unsafe characters');
    // Strip unsafe characters instead of rejecting entirely
    unit = unit.replace(/[^\p{L}\p{N}\s\/\.\-\*\^\(\)\[\]%°²³⁴μΩ]/gu, '');
  }

  // Reject if sanitization left nothing
  if (unit.trim().length === 0) {
    return null;
  }

  return unit.trim();
}

/**
 * Pre-process LLM output for UCUM compatibility
 * Converts Unicode characters to ASCII equivalents (required for UCUM standard)
 *
 * FUTURE ENHANCEMENT: Full UCUM grammar validation will be added via ucum-lhc
 * library integration in a follow-up PRD.
 *
 * @param {string} output - Raw LLM output
 * @returns {string|null} Preprocessed output or null if invalid
 */
function preprocessUcumOutput(output) {
  if (!output || output.length > 50) {
    return null;
  }

  // Convert Unicode to ASCII equivalents (required for UCUM compatibility)
  // This step will remain necessary even after ucum-lhc integration
  return output
    .replace(/μ/g, 'u')     // Greek mu → u
    .replace(/µ/g, 'u')     // Micro sign (U+00B5) → u
    .replace(/Ω/g, 'Ohm')   // Omega → Ohm
    .replace(/°/g, 'deg');  // Degree → deg
}

/**
 * PRD v4.8.4: Retry LLM with UCUM suggestions when initial validation fails
 *
 * When UCUM library provides suggestions for an invalid unit, we pass these
 * suggestions to LLM for informed selection rather than blind retry.
 *
 * @param {string} unit - Original unit string
 * @param {string} parameterName - Optional parameter context
 * @param {string[]} suggestions - Valid UCUM codes suggested by library
 * @returns {Promise<{selected: string, confidence: string}|null>}
 */
async function retryWithUcumSuggestions(unit, parameterName, suggestions) {
  if (!suggestions || suggestions.length === 0) {
    return null;
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const response = await client.responses.parse({
      model: UNIT_NORMALIZATION_MODEL,
      input: [{
        role: 'user',
        content: [{
          type: 'input_text',
          text: `Your previous UCUM code was invalid. Pick the best match from these UCUM suggestions.

Original unit: "${unit}"${parameterName ? `\nParameter: "${parameterName}"` : ''}

Valid UCUM suggestions from library:
${suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Pick the most appropriate UCUM code from the list above.
If none fit the original unit at all, return "NONE".`
        }]
      }],
      text: {
        format: {
          type: 'json_schema',
          name: 'ucum_suggestion_pick',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              selected: {
                type: 'string',
                description: 'Selected UCUM code from suggestions, or "NONE" if no match'
              },
              confidence: {
                type: 'string',
                enum: ['high', 'medium', 'low'],
                description: 'Confidence in the selection'
              }
            },
            required: ['selected', 'confidence'],
            additionalProperties: false
          }
        }
      }
    }, { timeout: 30000 });

    if (!response.output_parsed || !response.output_parsed.selected) {
      return null;
    }

    return {
      selected: response.output_parsed.selected,
      confidence: response.output_parsed.confidence || 'low'
    };
  } catch (error) {
    logger.warn({ error: error.message, unit }, '[unitNormalizer] UCUM suggestion retry failed');
    return null;
  }
}
