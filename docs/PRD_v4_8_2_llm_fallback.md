# PRD v4.8.2: Unit Normalization Step 3 - LLM Fallback

**Status:** Ready for Implementation
**Author:** Claude
**Created:** 2026-01-05
**Updated:** 2026-01-05 (Post peer review #4 - simplified to post-persistence normalization, fixed filter/map index bug; full UCUM validation deferred to ucum-lhc integration)
**Parent PRD:** v4.8 (Unit Normalization Step 1), v4.8.1 (View Integration Step 2)
**Dependencies:** Steps 1 and 2 must be completed

---

## Executive Summary

Steps 1-2 provide 100% coverage for current production data through exact string matching. **Step 3 adds resilience for future OCR errors and new unit variations** by introducing LLM-powered normalization at ingestion-time:

1. **Tier A**: Exact match (existing - instant, free)
2. **Tier B**: LLM normalization (new - smart, accurate)

**Key Innovation**: System learns from high-confidence LLM matches, converting them to Tier A (exact) for future speed and zero cost. Problematic units go to admin review panel.

**Architecture**: Normalization happens **during PDF upload** (ingestion-time), so users never see broken plots.

**User Impact**: Lab reports with OCR errors or new unit variations are automatically normalized without manual intervention. Ambiguous cases get admin review.

**Future Enhancement (ucum-lhc Integration)**: This PRD uses basic Unicode→ASCII preprocessing only. Full UCUM grammar validation will be added via the ucum-lhc library in a follow-up PRD, which will:
- Validate UCUM grammar (reject malformed unit expressions)
- Enable unit conversion between commensurable units
- Provide semantic validation
- Replace the need for regex-based validation

The Unicode→ASCII preprocessing in this PRD will still be required after ucum-lhc integration (ucum-lhc expects ASCII input).

---

## 1. Problem Statement

### 1.1 Current State (After Step 2)

Step 2 delivers perfect normalization for known unit variants:

```sql
-- Exact match works perfectly
normalize_unit_string('ммоль/л') -- Found in unit_aliases → returns 'mmol/L'
normalize_unit_string('mmol/L')  -- Found in unit_aliases → returns 'mmol/L'
```

**Coverage**: 105 aliases covering 100% of current production data (52/52 lab results mapped).

### 1.2 Gap: Future OCR Errors Not Covered

**Scenario 1: OCR typos**
```
Lab report shows: "ммоль/л"
OCR extracts:     "ммопь/л"  (л→п OCR error)
normalize_unit_string('ммопь/л') = 'ммопь/л'  -- Not in alias table
Lookup fails → Falls back to raw unit → Plot broken
```

**Scenario 2: Spacing variations**
```
Lab report shows: "mmol/L"
OCR extracts:     "mmol  /  L"  (extra spaces)
normalize_unit_string('mmol  /  L') = 'mmol / L'  (normalized but still different)
Exact match fails → Even though semantically identical
```

**Scenario 3: New lab source**
```
User uploads from new clinic using: "ммоль на литр" (spelled out)
Not in seed data → Falls back to raw → Disconnected from existing "mmol/L" data
```

### 1.3 Why This Matters

**Current behavior (Steps 1-2 only):**
- OCR typo → Unmapped unit → Plot broken
- Admin must manually add alias → Next upload works
- Reactive approach, manual work

**Desired behavior (Step 3):**
- OCR typo → LLM normalizes → Auto-learns → **Current upload works!**
- Future uploads use exact match (instant, free)
- Ambiguous cases → Admin review panel
- Proactive, self-healing system
- Zero admin work for common typos

---

## 2. Solution Overview

### 2.1 Two-Tiered Architecture (Ingestion-Time)

```
┌──────────────────────────────────────────────────────────────────┐
│                     USER UPLOADS PDF                             │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                 OCR EXTRACTS UNIT STRING                         │
│  e.g., "µg/L" (micro symbol preserved)                           │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│   labReportProcessor.js CALLS normalizeUnit() ON RAW OCR OUTPUT │
│   BEFORE sanitizeUnit() (preserves semantic characters)         │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│             normalize_unit_string() PRE-PROCESSING               │
│  Whitespace collapse, NFKC normalization, trim                   │
│  "µg/L" → "µg/L" (micro preserved for LLM context)               │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│              TIER A: EXACT MATCH (POOLED QUERY)                  │
│  SELECT unit_canonical FROM unit_aliases                         │
│  WHERE alias = normalize_unit_string('µg/L');                    │
│  → NULL (not found) - CONNECTION RELEASED                        │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (if NULL)
┌──────────────────────────────────────────────────────────────────┐
│      TIER B: LLM NORMALIZATION (NO CONNECTION HELD)              │
│  Uses OpenAI Responses API with retry logic                     │
│                                                                  │
│  Input: "µg/L"                                                   │
│  LLM analyzes: Micro symbol unit                                 │
│  LLM Response: {"canonical": "ug/L", "confidence": "high"}       │
│                                                                  │
│  If high confidence → AUTO-LEARN (new pooled query):             │
│  INSERT INTO unit_aliases (alias, unit_canonical, source)        │
│  VALUES ('µg/L', 'ug/L', 'llm')                                  │
│  ON CONFLICT: Check canonical match, warn on mismatch            │
│                                                                  │
│  If low/medium confidence → ADMIN REVIEW QUEUE:                  │
│  INSERT INTO unit_reviews (raw_unit, llm_suggestion, ...)        │
│                                                                  │
│  Future uploads: Tier A finds it instantly! ✅                   │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│              STORE IN DATABASE (lab_results)                     │
│  unit = "µg/L" (raw OCR value preserved)                         │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│           USER QUERIES DATA (v_measurements view)                │
│  SELECT unit_normalized FROM v_measurements                      │
│  LEFT JOIN unit_aliases ON normalize_unit_string(unit) = alias   │
│  → Returns: "ug/L" (learned alias) ✅                            │
│                                                                  │
│  Plot works immediately!                                         │
└──────────────────────────────────────────────────────────────────┘
```

### 2.2 Why Two Tiers (Not Three)?

**Fuzzy matching removed because:**

1. **Medical units too similar**: "ммоль/л" (mmol/L) vs "мкмоль/л" (umol/L) differ by 1 letter but mean **completely different things** (1000x difference!)
2. **Risk of false positives**: Fuzzy search could match wrong unit → Dangerous medical errors
3. **LLM is smarter**: Understands semantic meaning, not just string similarity
4. **Speed doesn't matter**: Ingestion-time means we only call LLM once per PDF upload (~2 seconds is acceptable)
5. **Cost is low**: Only new unique units trigger LLM → Auto-learning converts to free exact matches
6. **Simpler code**: No `pg_trgm`, no `detect_script()`, no fuzzy logic

### 2.3 Configuration Parameters

| Parameter | Default | Purpose | Tuning Guidance |
|-----------|---------|---------|-----------------|
| `LLM_AUTO_LEARN_ENABLED` | true | Auto-INSERT high-confidence LLM results | Disable for manual review only |
| `LLM_AUTO_LEARN_CONFIDENCE` | high | Minimum LLM confidence to auto-learn | 'high' only (medium→admin review) |
| `UNIT_NORMALIZATION_MODEL` | SQL_GENERATOR_MODEL | Model for LLM normalization | Use fast model like gpt-4o-mini |
| `UNIT_NORMALIZATION_MAX_RETRIES` | 3 | Max retries for transient LLM errors | 1-5 range |
| `UNIT_NORMALIZATION_MAX_CONCURRENCY` | 5 | Max concurrent LLM calls per report | 3-10 range |
| `UNIT_NORMALIZATION_GLOBAL_CONCURRENCY` | unlimited | Global limit across all reports (optional) | Set to 10-20 for production safety |

### 2.4 Storage Contract (Raw vs Sanitized vs Normalized)

**CRITICAL ARCHITECTURE CLARIFICATION**: To ensure aliases always match stored units, we follow a single normalization pipeline:

**Pipeline Overview:**
```
OCR extracts unit → Security validation → Store RAW → Query-time normalization matches alias
     "μg/L"       → sanitizeInput()     → "μg/L"   → normalize_unit_string() = alias
```

**Detailed Flow:**

1. **Input Security** (`sanitizeUnitInput()` at normalization time):
   - Purpose: Prevent prompt injection attacks
   - Action: Strip dangerous characters, enforce max length
   - Timing: BEFORE LLM call
   - Output: Sanitized unit for LLM input only

2. **Storage** (database persistence):
   - Column: `lab_results.unit`
   - Value: RAW OCR output (preserved as-is)
   - Rationale: Audit trail, semantic characters preserved
   - Example: `"μg/L"` stored exactly as extracted

3. **Alias Creation** (auto-learning):
   - Key: `unit_aliases.alias = normalize_unit_string(raw_unit)`
   - Value: `unit_aliases.unit_canonical = llm_output`
   - Example: `alias='μg/L'` (after normalize_unit_string), `unit_canonical='ug/L'`

4. **Query-Time Matching** (`v_measurements` view):
   - JOIN condition: `normalize_unit_string(lab_results.unit) = unit_aliases.alias`
   - Both sides use the SAME function → guaranteed match
   - Example: `normalize_unit_string('μg/L')` matches `alias='μg/L'`

**What About `sanitizeUnit()`?**
- If it exists in current codebase: **REMOVE or REFACTOR**
- Replaced by: `sanitizeUnitInput()` (security) + `normalize_unit_string()` (matching)
- DO NOT use old sanitization for storage (breaks alias matching)

**Normalization Pipeline Order:**
```javascript
// CORRECT order (PRD v4.8.2):
rawUnit = ocrResponse.unit;           // "μg/L"
sanitized = sanitizeUnitInput(rawUnit); // Security check only
normalizedKey = normalize_unit_string(rawUnit); // "μg/L" (for alias lookup)
llmCanonical = normalizeWithLLM(sanitized); // "ug/L"
INSERT INTO unit_aliases (alias, unit_canonical) VALUES (normalizedKey, llmCanonical);
INSERT INTO lab_results (unit) VALUES (rawUnit); // Store original

// Later, in view:
SELECT * FROM v_measurements
  LEFT JOIN unit_aliases ON normalize_unit_string(lab_results.unit) = alias
  → Matches because both use same function
```

**Key Guarantees:**
- Alias key = `normalize_unit_string(stored_value)` → Always matches
- Raw units preserved → Audit trail intact
- Security enforced → Input sanitization before LLM
- Single source of truth → `normalize_unit_string()` used everywhere

### 2.5 Learning & Admin Review

**High-Confidence LLM Match (confidence='high'):**
```sql
-- Auto-promote to exact match (with conflict detection)
INSERT INTO unit_aliases (alias, unit_canonical, source, learn_count, last_used_at)
VALUES ('ммопь/л', 'mmol/L', 'llm', 1, NOW())
ON CONFLICT (alias) DO UPDATE SET
  learn_count = CASE
    WHEN unit_aliases.unit_canonical = EXCLUDED.unit_canonical
    THEN unit_aliases.learn_count + 1
    ELSE unit_aliases.learn_count  -- Don't increment on mismatch
  END,
  last_used_at = NOW()
RETURNING (unit_aliases.unit_canonical <> EXCLUDED.unit_canonical) AS has_conflict;

-- If has_conflict, log warning and queue for admin review
```

**Medium/Low-Confidence LLM Match OR Conflict:**
```sql
-- Queue for admin review (similar to ambiguous analytes)
INSERT INTO unit_reviews (
  result_id,
  raw_unit,
  normalized_input,
  llm_suggestion,
  llm_confidence,
  issue_type,  -- 'low_confidence' | 'alias_conflict' | 'llm_error' | 'sanitization_rejected' (no validation_failed - deferred to ucum-lhc)
  issue_details,
  status
) VALUES (
  result_uuid,
  'µg  /  L',
  'µg / L',
  'ug/L',
  'medium',
  'low_confidence',
  '{"message": "LLM confidence below auto-learn threshold"}',
  'pending'
);

-- Admin reviews in panel, can approve → creates alias with source='admin_approved'
```

---

## 3. Detailed Specification

### 3.1 Database Schema Changes

**1. Modify unit_aliases table in `schema.js`:**

**PEER REVIEW FIX #3 (Integration #6):** The codebase uses `CREATE TABLE IF NOT EXISTS` on boot (not migrations). Add columns directly to the existing CREATE TABLE statement:

```javascript
// In server/db/schema.js - update existing unit_aliases table definition:
CREATE TABLE IF NOT EXISTS unit_aliases (
    alias TEXT PRIMARY KEY,
    unit_canonical TEXT NOT NULL,
    source TEXT DEFAULT 'manual',
    -- NEW: Quality metric columns for auto-learning
    learn_count INTEGER DEFAULT 0,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Column documentation (add as comments in schema.js):**
- `learn_count`: Number of times this alias was auto-learned via concurrent calls to normalizeUnit(). Incremented on ON CONFLICT only if canonical matches. For seed/manual aliases, remains 0 (never auto-learned). Use for quality assessment and rollback decisions.
- `last_used_at`: Timestamp of most recent AUTO-LEARN event (not query usage). Tracks when normalizeUnit() last wrote/updated this row. NULL for seed/manual aliases (never auto-learned). Use to identify stale learned aliases for review.

**Initialization behavior for existing rows:**
- Existing seed aliases: `learn_count = 0` (never auto-learned, manually curated)
- Existing seed aliases: `last_used_at = NULL` (never auto-learned)
- These columns track **auto-learning events only**, not manual curation or query usage

**2. unit_reviews table (admin review queue - REQUIRED for MVP):**
```sql
CREATE TABLE IF NOT EXISTS unit_reviews (
  review_id BIGSERIAL PRIMARY KEY,
  -- PEER REVIEW FIX #3 (Critical #2): UNIQUE required for ON CONFLICT (result_id)
  result_id UUID NOT NULL UNIQUE REFERENCES lab_results(id) ON DELETE CASCADE,
  raw_unit TEXT NOT NULL,                -- Original unit from OCR
  normalized_input TEXT NOT NULL,        -- After normalize_unit_string()
  llm_suggestion TEXT,                   -- Canonical unit suggested by LLM (NULL if LLM failed)
  llm_confidence TEXT,                   -- 'high', 'medium', 'low', or NULL
  llm_model TEXT,                        -- Model used (e.g., 'gpt-4o-mini')
  issue_type TEXT NOT NULL,              -- Type of issue
  issue_details JSONB,                   -- Additional context about the issue
  status TEXT NOT NULL DEFAULT 'pending',
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolved_by TEXT,                      -- Admin email who resolved
  resolved_action TEXT,                  -- 'approved', 'rejected', 'manual_override'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT chk_confidence CHECK (llm_confidence IN ('high', 'medium', 'low') OR llm_confidence IS NULL),
  CONSTRAINT chk_status CHECK (status IN ('pending', 'resolved', 'skipped')),
  CONSTRAINT chk_issue_type CHECK (issue_type IN ('low_confidence', 'alias_conflict', 'llm_error', 'sanitization_rejected'))
);

CREATE INDEX idx_unit_reviews_status ON unit_reviews(status) WHERE status = 'pending';
CREATE INDEX idx_unit_reviews_result_id ON unit_reviews(result_id);
CREATE INDEX idx_unit_reviews_raw_unit ON unit_reviews(raw_unit);
CREATE INDEX idx_unit_reviews_created_at ON unit_reviews(created_at DESC);

COMMENT ON TABLE unit_reviews IS 'Admin review queue for problematic unit normalizations. Similar to match_reviews for ambiguous analytes, but for unit mapping issues.';

COMMENT ON COLUMN unit_reviews.issue_type IS 'Type of issue: low_confidence (LLM not confident), alias_conflict (existing alias maps to different canonical), llm_error (LLM API failed), sanitization_rejected (unsafe input)';

COMMENT ON COLUMN unit_reviews.issue_details IS 'Structured details: {message: string, existing_canonical?: string (for conflicts), error?: string (for failures), attempts?: int (for retries)}';

COMMENT ON COLUMN unit_reviews.resolved_action IS 'How admin resolved: approved (use LLM suggestion), rejected (keep raw unit), manual_override (admin entered custom canonical)';
```

**Also add to `resetDatabase()` function in schema.js:**
```javascript
await client.query('DROP TABLE IF EXISTS unit_reviews CASCADE');
```

### 3.2 Core Function: normalizeUnit()

**File:** `server/services/unitNormalizer.js` (new file)

**CRITICAL ARCHITECTURE CHANGE (Peer Review Fix #1):**
- **OLD**: Hold single DB connection across entire flow (can exhaust pool during LLM calls)
- **NEW**: Use pooled queries (auto-release) and NO connection during LLM network I/O

```javascript
import { pool } from '../db/index.js';
import OpenAI from 'openai';
import logger from '../utils/logger.js';
import pLimit from 'p-limit';

// Configuration
const LLM_AUTO_LEARN_ENABLED = process.env.LLM_AUTO_LEARN_ENABLED !== 'false';
const LLM_AUTO_LEARN_CONFIDENCE = process.env.LLM_AUTO_LEARN_CONFIDENCE || 'high'; // Only 'high' by default
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

/**
 * Two-tiered unit normalization:
 * Tier A: Exact match (fast path, pooled query)
 * Tier B: LLM normalization (no connection held, with retry logic)
 *
 * @param {string} rawUnit - Raw unit string from OCR
 * @param {string} resultId - UUID of lab_results row (for admin review queue)
 * @returns {Promise<{canonical: string, tier: string, confidence: string}>}
 *
 * Output contract:
 * - canonical: Always a string (raw input if no match, empty string if invalid input)
 * - tier: 'exact' | 'llm' | 'raw'
 * - confidence: 'high' | 'medium' | 'low' (for LLM tier) or null (for exact/raw)
 */
export async function normalizeUnit(rawUnit, resultId) {
  // Empty input: return empty string (not null) to maintain string contract
  if (!rawUnit || typeof rawUnit !== 'string' || rawUnit.trim().length === 0) {
    return { canonical: '', tier: 'raw', confidence: null };
  }

  // Step 0: Normalize input (whitespace, NFKC, trim)
  // PEER REVIEW FIX #2: Use pooled query (auto-releases connection)
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

  // TIER B: LLM normalization (NO CONNECTION HELD - peer review fix #1)
  try {
    const llmResult = await normalizeWithLLM(normalized);

    // Auto-learn if high confidence
    const shouldAutoLearn = LLM_AUTO_LEARN_ENABLED && llmResult.confidence === 'high';

    if (llmResult.canonical && shouldAutoLearn) {
      // PEER REVIEW FIX #4: Auto-learn with conflict detection (pooled query - auto-releases)
      const conflict = await autoLearnAliasPooled(normalized, llmResult.canonical, 'llm');

      if (conflict) {
        // Conflict detected - queue for admin review
        await queueForAdminReview(resultId, rawUnit, normalized, llmResult, 'alias_conflict', {
          message: 'Existing alias maps to different canonical unit',
          existing_canonical: conflict.existing_canonical
        });

        logger.warn({
          raw_unit: rawUnit,
          normalized,
          llm_canonical: llmResult.canonical,
          existing_canonical: conflict.existing_canonical
        }, '[unitNormalizer] Alias conflict detected, queued for admin review');

        // Use raw unit until admin resolves
        return { canonical: rawUnit, tier: 'raw', confidence: null };
      }

      logger.info({
        raw_unit: rawUnit,
        normalized,
        canonical: llmResult.canonical,
        confidence: llmResult.confidence,
        model: llmResult.model,
        tier: 'llm_learned'
      }, '[unitNormalizer] LLM normalization auto-learned');

      return {
        canonical: llmResult.canonical,
        tier: 'llm',
        confidence: llmResult.confidence
      };
    } else if (llmResult.canonical) {
      // Medium/low confidence - queue for admin review
      await queueForAdminReview(resultId, rawUnit, normalized, llmResult, 'low_confidence', {
        message: `LLM confidence '${llmResult.confidence}' below auto-learn threshold '${LLM_AUTO_LEARN_CONFIDENCE}'`
      });

      logger.info({
        raw_unit: rawUnit,
        normalized,
        canonical: llmResult.canonical,
        confidence: llmResult.confidence,
        tier: 'needs_review',
        reason: 'low_confidence'
      }, '[unitNormalizer] LLM normalization queued for admin review');

      // Use raw unit until admin reviews
      return { canonical: rawUnit, tier: 'raw', confidence: null };
    }
  } catch (error) {
    // PEER REVIEW FIX #3 (Bug #12): Distinguish sanitization errors from LLM API errors
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
 * PEER REVIEW FIX #3: Per-report deduplication and concurrency limiting
 * PEER REVIEW FIX #6: Optional global limiter across all reports
 *
 * PEER REVIEW NOTE #3 (Race #11): Cross-upload race condition
 * If TWO uploads happen simultaneously with the same NEW unit:
 * - Both miss Tier A (alias doesn't exist yet)
 * - Both call LLM (wasted cost, but harmless)
 * - Both try autoLearnAliasPooled()
 * - Advisory lock ensures only one inserts, other hits ON CONFLICT
 * - Result: Both succeed, second one just increments learn_count
 * This is acceptable behavior - no data corruption, just minor cost overhead.
 *
 * PEER REVIEW NOTE #3 (Edge #16): Units without resultId
 * If a unit has no resultId (e.g., undefined), queueForAdminReview() logs a warning
 * and skips insertion. The unit still gets normalized, just not queued for review.
 * This is acceptable - such cases should be rare and won't block ingestion.
 *
 * @param {Array<{unit: string, resultId: string}>} units - Array of units from lab results
 * @returns {Promise<Map<string, object>>} Map of unit → normalization result
 */
export async function normalizeUnitsBatch(units) {
  // Deduplicate by raw unit string (within single report)
  const uniqueUnits = [...new Set(units.map(u => u.unit).filter(Boolean))];

  // Create per-report concurrency limiter (peer review fix #3)
  const MAX_CONCURRENCY = parseInt(process.env.UNIT_NORMALIZATION_MAX_CONCURRENCY || '5', 10);
  const perReportLimit = pLimit(MAX_CONCURRENCY);

  // Build cache with concurrent LLM calls (limited)
  const normalizationCache = new Map();

  await Promise.all(
    uniqueUnits.map(unit => {
      // Wrap in per-report limiter first
      const task = async () => {
        // Find a resultId for this unit (for admin review queue)
        const resultId = units.find(u => u.unit === unit)?.resultId;
        const result = await normalizeUnit(unit, resultId);
        normalizationCache.set(unit, result);
      };

      // If global limiter exists, use both limiters (nested)
      // Otherwise, just use per-report limiter
      //
      // PEER REVIEW NOTE #3 (Performance #17): Nested limiters behavior
      // With GLOBAL_CONCURRENCY=10 and two reports each with 10 unique units:
      // - Report 1 may take all 10 global slots initially
      // - Report 2 waits until Report 1 releases slots
      // This is intentional: prevents overwhelming the LLM API.
      // For fair-share scheduling, set GLOBAL_CONCURRENCY higher or disable it.
      return globalLimiter
        ? globalLimiter(() => perReportLimit(task))
        : perReportLimit(task);
    })
  );

  return normalizationCache;
}

/**
 * Auto-learn alias using a dedicated connection for advisory lock safety
 * PEER REVIEW FIX #3 (Critical #1): Use single connection for advisory lock
 * - Advisory locks are session-bound; pooled queries use different connections
 * - Must acquire connection, hold it for lock+queries, then release
 * PEER REVIEW FIX #3 (Critical #13): Return 'alias' not 'id' (table has no id column)
 * PEER REVIEW FIX #3 (Bug #4): Include learn_count in RETURNING clause
 *
 * @param {string} alias - Normalized unit string
 * @param {string} canonical - Canonical UCUM unit
 * @param {string} source - Source of the alias ('llm', 'admin_approved')
 * @returns {Promise<{conflict: boolean, existing_canonical?: string}>}
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
    return;
  }

  try {
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
  } catch (error) {
    logger.error({ error, resultId, rawUnit }, '[unitNormalizer] Failed to queue for admin review');
    // Don't throw - queue failure shouldn't block ingestion
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
 * PEER REVIEW FIX #5: Added retry logic with exponential backoff
 *
 * @param {string} unit - Normalized unit string
 * @returns {Promise<{canonical: string, confidence: string, model: string}>}
 */
async function normalizeWithLLM(unit) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // INPUT SANITIZATION: Prevent prompt injection
  const sanitizedUnit = sanitizeUnitInput(unit);
  if (!sanitizedUnit) {
    logger.warn({ raw_unit: unit }, '[unitNormalizer] Unit rejected by sanitization');
    throw new Error('Unit rejected by sanitization');
  }

  // PEER REVIEW FIX #5: Retry logic for transient errors
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

Unit: "${sanitizedUnit}"

Instructions:
- Return the standard UCUM representation (ASCII only, no Unicode)
- If you recognize this as an OCR error or variation of a known unit, return the correct canonical form
- If uncertain about the exact unit, make your best judgment based on medical context
- Return confidence level: "high" (certain), "medium" (likely correct), or "low" (guessing)

Examples:
- "ммоль/л" → canonical: "mmol/L", confidence: "high"
- "ммопь/л" (OCR error) → canonical: "mmol/L", confidence: "high"
- "микромоль на литр" → canonical: "umol/L", confidence: "high"
- "10^9/л" → canonical: "10*9/L", confidence: "high"
- "μg/L" → canonical: "ug/L", confidence: "high"
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
        },
        timeout: 10000
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

  // PEER REVIEW FIX #3 (Bug #3): Explicit throw if loop completes without returning
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
 * PEER REVIEW NOTE #3 (Security #10): Character whitelist rationale
 * - \p{L} allows ALL Unicode letters (Cyrillic, Greek, etc.) because medical units
 *   use diverse scripts (ммоль/л, μg/L, etc.)
 * - Parentheses/brackets needed for complex units like "mg/(kg·h)"
 * - Security relies on: (1) structured output schema, (2) output validation,
 *   (3) Responses API (not raw completion), (4) max length limit
 * - Consider tightening if prompt injection becomes a concern
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
  const allowedPattern = /^[\p{L}\p{N}\s\/\.\-\*\(\)\[\]%°²³⁴μΩ]+$/u;

  if (!allowedPattern.test(unit)) {
    logger.warn({ unit }, '[unitNormalizer] Unit contains unsafe characters');
    // Strip unsafe characters instead of rejecting entirely
    unit = unit.replace(/[^\p{L}\p{N}\s\/\.\-\*\(\)\[\]%°²³⁴μΩ]/gu, '');
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
 * library integration in a follow-up PRD. The ucum-lhc library will:
 * - Validate UCUM grammar (is this a valid UCUM expression?)
 * - Enable unit conversion between commensurable units
 * - Provide semantic validation (is this a real unit?)
 *
 * This preprocessing step will STILL BE NEEDED after ucum-lhc integration
 * because ucum-lhc expects ASCII input and won't convert Unicode for you.
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
```

### 3.3 Integration Point: Ingestion-Time Normalization

**CRITICAL ARCHITECTURE DECISION (Peer Review Fix #2):**

Call `normalizeUnit()` on **RAW OCR output BEFORE** `sanitizeUnit()` runs. This preserves semantic characters (μ, Ω, °, brackets) that provide critical context for LLM normalization.

**File:** `server/services/labReportProcessor.js`

**Add import:**
```javascript
import { normalizeUnitsBatch } from './unitNormalizer.js';
```

**Modify OCR result processing (AFTER database insertion):**

**PEER REVIEW FIX #4 (Simplification):** Normalize AFTER persistence, not before. This approach:
1. Avoids modifying `buildLabResultTuples()`
2. Uses actual auto-generated `lab_results.id` values (no pre-generation needed)
3. Eliminates orphan `unit_reviews` rows (lab_results exist before normalization)
4. One extra query, but simpler and safer

```javascript
// In labReportProcessor.js - AFTER persistLabReport() completes:

import { normalizeUnitsBatch } from './unitNormalizer.js';

// Step 1: Persist lab report normally (generates lab_results.id automatically)
const persistenceResult = await persistLabReport({
  patientInfo,
  reportInfo,
  coreResult,
  // ... other fields
});

const reportId = persistenceResult.reportId;

// Step 2: Fetch lab_results for this report (with auto-generated IDs)
const { rows: labResultRows } = await pool.query(
  `SELECT id, unit FROM lab_results
   WHERE report_id = $1
   AND unit IS NOT NULL
   AND unit <> ''`,
  [reportId]
);

// Step 3: Normalize units with actual result IDs (post-persistence)
if (labResultRows.length > 0) {
  const unitsToNormalize = labResultRows.map(row => ({
    unit: row.unit,      // RAW OCR unit (stored in DB)
    resultId: row.id     // Actual auto-generated UUID from lab_results
  }));

  try {
    const normalizationCache = await normalizeUnitsBatch(unitsToNormalize);

    logger.info({
      report_id: reportId,
      total_units: unitsToNormalize.length,
      unique_units: normalizationCache.size
    }, '[labReportProcessor] Post-persistence unit normalization completed');
  } catch (error) {
    // Non-fatal: units will use raw values until manually mapped
    logger.error({
      error,
      report_id: reportId,
      unit_count: unitsToNormalize.length
    }, '[labReportProcessor] Unit normalization failed, units will use raw values');
  }
}

// Done! No changes to buildLabResultTuples() required.
// unit_reviews rows now have valid result_id references (lab_results already exist).
```

**Why this is better than pre-generation:**
1. **No orphans:** `unit_reviews` rows are created AFTER `lab_results` exist
2. **No code changes to persistence:** `buildLabResultTuples()` unchanged
3. **Simpler data flow:** No pre-generated UUID tracking through multiple layers
4. **Trade-off:** One extra SELECT query per report (negligible cost)

**No changes needed to `reportPersistence.js`** - the existing implementation works as-is.

**Why this works:**
1. OCR extracts unit: `"μg/L"` (raw, with micro symbol)
2. Stores raw in DB: `lab_results.unit = "μg/L"` (via normal persistence)
3. Post-persistence: Fetch `lab_results` rows with auto-generated UUIDs
4. `normalizeUnit()` called with actual `result_id` → LLM sees `"μg/L"` → Returns `"ug/L"` (high confidence)
5. Auto-learns: `INSERT INTO unit_aliases (alias='μg/L', canonical='ug/L')`
6. User queries `v_measurements` view → JOIN finds alias → Returns `"ug/L"` ✅
7. Plot works immediately!
8. Next upload with same unit → Tier A exact match (instant, free) ✅

**No changes needed to `v_measurements` view** - it already uses the JOIN pattern from Step 2.

---

## 4. Admin Review Panel (New Feature)

### 4.1 Admin Panel UI Updates

**File:** `public/admin.html`

Add new tab for unit reviews (similar to ambiguous matches):

```html
<!-- Tab Navigation -->
<div class="admin-tabs">
  <button id="tab-new-analytes" class="admin-tab active" data-tab="new-analytes">
    <span class="admin-tab-icon">📋</span>
    <span class="admin-tab-label">New Analytes</span>
    <span id="new-count" class="admin-tab-badge">0</span>
  </button>
  <button id="tab-ambiguous" class="admin-tab" data-tab="ambiguous">
    <span class="admin-tab-icon">❓</span>
    <span class="admin-tab-label">Ambiguous Matches</span>
    <span id="ambiguous-count" class="admin-tab-badge">0</span>
  </button>
  <!-- NEW TAB -->
  <button id="tab-unit-reviews" class="admin-tab" data-tab="unit-reviews">
    <span class="admin-tab-icon">🔧</span>
    <span class="admin-tab-label">Unit Issues</span>
    <span id="unit-reviews-count" class="admin-tab-badge">0</span>
  </button>
  <button id="tab-danger-zone" class="admin-tab admin-tab-danger" data-tab="danger-zone">
    <span class="admin-tab-icon">⚠️</span>
    <span class="admin-tab-label">Danger Zone</span>
  </button>
</div>

<!-- NEW TAB CONTENT: Unit Reviews -->
<section id="content-unit-reviews" class="tab-content" aria-live="polite" hidden>
  <div class="card">
    <div class="card-header">
      <h2 class="card-title">Unit Normalization Issues</h2>
      <p class="card-subtitle">Review and resolve problematic unit normalizations</p>
    </div>
    <div class="card-body">
      <div id="loading-unit-reviews" class="loading-state" hidden>
        <div class="loading-spinner"></div>
        <p>Loading unit reviews...</p>
      </div>

      <div id="empty-unit-reviews" class="empty-state" hidden>
        <div class="empty-state-icon">✅</div>
        <div class="empty-state-title">All caught up!</div>
        <p class="empty-state-desc">No unit issues to review.</p>
      </div>

      <div id="error-unit-reviews" class="error-state" hidden>
        <p class="error-message"></p>
      </div>

      <div class="table-wrapper" id="table-unit-reviews-wrapper" hidden>
        <table id="table-unit-reviews" class="admin-table">
          <thead>
            <tr>
              <th>Raw Unit</th>
              <th>LLM Suggestion</th>
              <th>Issue Type</th>
              <th>Confidence</th>
              <th>Details</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="tbody-unit-reviews">
          </tbody>
        </table>
      </div>
    </div>
  </div>
</section>
```

### 4.2 Admin API Endpoints

**File:** `server/routes/admin.js`

**PEER REVIEW NOTE #3 (Import #14):** No new imports needed. The file already has:
```javascript
import { adminPool, queryAsAdmin } from '../db/index.js';
```

Add endpoints for unit review management:

```javascript
/**
 * GET /api/admin/unit-reviews
 * Fetch pending unit normalization issues
 */
router.get('/unit-reviews', async (req, res) => {
  try {
    const status = req.query.status || 'pending';

    let whereClause = '';
    if (status !== 'all') {
      whereClause = 'WHERE ur.status = $1';
    }

    const { rows } = await queryAsAdmin(
      `SELECT
         ur.review_id,
         ur.result_id,
         ur.raw_unit,
         ur.normalized_input,
         ur.llm_suggestion,
         ur.llm_confidence,
         ur.llm_model,
         ur.issue_type,
         ur.issue_details,
         ur.status,
         ur.created_at,
         lr.parameter_name,
         lr.result_value,
         lr.unit as result_unit
       FROM unit_reviews ur
       LEFT JOIN lab_results lr ON ur.result_id = lr.id
       ${whereClause}
       ORDER BY ur.created_at DESC`,
      status !== 'all' ? [status] : []
    );

    res.json({ reviews: rows });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to fetch unit reviews');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/admin/approve-unit-normalization
 * Approve LLM suggestion and create alias
 */
router.post('/approve-unit-normalization', async (req, res) => {
  const client = await adminPool.connect();

  try {
    const { review_id, create_alias = true } = req.body;

    if (!review_id) {
      return res.status(400).json({ error: 'review_id is required' });
    }

    await client.query('BEGIN');

    // Fetch review details
    const { rows: reviewRows } = await client.query(
      'SELECT * FROM unit_reviews WHERE review_id = $1',
      [review_id]
    );

    if (reviewRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Unit review not found' });
    }

    const review = reviewRows[0];

    if (!review.llm_suggestion) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No LLM suggestion to approve' });
    }

    // Create alias if requested
    let aliasCreated = false;
    if (create_alias) {
      await client.query(
        `INSERT INTO unit_aliases (alias, unit_canonical, source, learn_count, last_used_at)
         VALUES ($1, $2, 'admin_approved', 1, NOW())
         ON CONFLICT (alias) DO UPDATE SET
           learn_count = unit_aliases.learn_count + 1,
           last_used_at = NOW()`,
        [review.normalized_input, review.llm_suggestion]
      );
      aliasCreated = true;
    }

    // Mark review as resolved
    await client.query(
      `UPDATE unit_reviews
       SET status = 'resolved',
           resolved_at = NOW(),
           resolved_by = $1,
           resolved_action = 'approved',
           updated_at = NOW()
       WHERE review_id = $2`,
      [req.user?.email || 'admin', review_id]
    );

    await client.query('COMMIT');

    // Log admin action
    await logAdminAction('approve_unit_normalization', 'unit_review', review_id, {
      raw_unit: review.raw_unit,
      llm_suggestion: review.llm_suggestion,
      alias_created: aliasCreated
    }, req);

    logger.info({ review_id, alias_created }, 'Unit normalization approved');

    res.json({
      success: true,
      canonical: review.llm_suggestion,
      alias_created: aliasCreated
    });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error: error.message }, 'Failed to approve unit normalization');
    res.status(500).json({ error: 'Internal server error', message: error.message });
  } finally {
    client.release();
  }
});

/**
 * POST /api/admin/reject-unit-normalization
 * Reject LLM suggestion, keep raw unit
 */
router.post('/reject-unit-normalization', async (req, res) => {
  try {
    const { review_id, reason } = req.body;

    if (!review_id) {
      return res.status(400).json({ error: 'review_id is required' });
    }

    const { rows } = await queryAsAdmin(
      `UPDATE unit_reviews
       SET status = 'resolved',
           resolved_at = NOW(),
           resolved_by = $1,
           resolved_action = 'rejected',
           updated_at = NOW()
       WHERE review_id = $2
       RETURNING raw_unit`,
      [req.user?.email || 'admin', review_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Unit review not found' });
    }

    // Log admin action
    await logAdminAction('reject_unit_normalization', 'unit_review', review_id, {
      raw_unit: rows[0].raw_unit,
      reason: reason || 'No reason provided'
    }, req);

    logger.info({ review_id, reason }, 'Unit normalization rejected');

    res.json({
      success: true,
      message: 'LLM suggestion rejected, raw unit will be used'
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to reject unit normalization');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/admin/override-unit-normalization
 * Admin manually enters canonical unit
 */
router.post('/override-unit-normalization', async (req, res) => {
  const client = await adminPool.connect();

  try {
    const { review_id, canonical_override } = req.body;

    if (!review_id || !canonical_override) {
      return res.status(400).json({
        error: 'review_id and canonical_override are required'
      });
    }

    await client.query('BEGIN');

    // Fetch review
    const { rows: reviewRows } = await client.query(
      'SELECT * FROM unit_reviews WHERE review_id = $1',
      [review_id]
    );

    if (reviewRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Unit review not found' });
    }

    const review = reviewRows[0];

    // Create alias with admin override
    await client.query(
      `INSERT INTO unit_aliases (alias, unit_canonical, source, learn_count, last_used_at)
       VALUES ($1, $2, 'admin_approved', 1, NOW())
       ON CONFLICT (alias) DO UPDATE SET
         unit_canonical = EXCLUDED.unit_canonical,
         learn_count = unit_aliases.learn_count + 1,
         last_used_at = NOW()`,
      [review.normalized_input, canonical_override]
    );

    // Mark review as resolved
    await client.query(
      `UPDATE unit_reviews
       SET status = 'resolved',
           resolved_at = NOW(),
           resolved_by = $1,
           resolved_action = 'manual_override',
           updated_at = NOW()
       WHERE review_id = $2`,
      [req.user?.email || 'admin', review_id]
    );

    await client.query('COMMIT');

    // Log admin action
    await logAdminAction('override_unit_normalization', 'unit_review', review_id, {
      raw_unit: review.raw_unit,
      llm_suggestion: review.llm_suggestion,
      admin_override: canonical_override
    }, req);

    logger.info({
      review_id,
      canonical_override
    }, 'Unit normalization overridden by admin');

    res.json({
      success: true,
      canonical: canonical_override
    });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error: error.message }, 'Failed to override unit normalization');
    res.status(500).json({ error: 'Internal server error', message: error.message });
  } finally {
    client.release();
  }
});
```

### 4.3 Frontend Integration Pattern

**PEER REVIEW FIX #6**: Explicit wiring for admin panel UI integration

**Badge Count Updates:**
- Use existing admin polling pattern (same as "New Analytes" and "Ambiguous Matches" tabs)
- Refresh interval: 10 seconds (matches current admin panel behavior)
- Endpoint: `GET /api/admin/unit-reviews?status=pending` (count `reviews.length`)

**Frontend JavaScript (`public/js/admin.js`):**

```javascript
// Add to existing tab initialization
async function loadUnitReviews() {
  const loadingEl = document.getElementById('loading-unit-reviews');
  const emptyEl = document.getElementById('empty-unit-reviews');
  const errorEl = document.getElementById('error-unit-reviews');
  const tableWrapper = document.getElementById('table-unit-reviews-wrapper');
  const tbody = document.getElementById('tbody-unit-reviews');

  try {
    loadingEl.hidden = false;
    emptyEl.hidden = true;
    errorEl.hidden = true;
    tableWrapper.hidden = true;

    const response = await fetch('/api/admin/unit-reviews?status=pending');
    const data = await response.json();

    loadingEl.hidden = true;

    if (data.reviews.length === 0) {
      emptyEl.hidden = false;
      return;
    }

    // Render reviews (follow pattern from renderAmbiguousMatches)
    tbody.innerHTML = data.reviews.map(review => `
      <tr data-review-id="${review.review_id}">
        <td>${escapeHtml(review.raw_unit)}</td>
        <td>${review.llm_suggestion || '<em>N/A</em>'}</td>
        <td><span class="badge badge-${getIssueTypeBadge(review.issue_type)}">${review.issue_type}</span></td>
        <td>${review.llm_confidence || 'N/A'}</td>
        <td>${escapeHtml(review.issue_details?.message || '')}</td>
        <td>${formatDate(review.created_at)}</td>
        <td>
          <button class="btn btn-sm btn-success" onclick="approveUnitNormalization(${review.review_id})">Approve</button>
          <button class="btn btn-sm btn-danger" onclick="rejectUnitNormalization(${review.review_id})">Reject</button>
          <button class="btn btn-sm btn-secondary" onclick="showOverrideModal(${review.review_id})">Override</button>
        </td>
      </tr>
    `).join('');

    tableWrapper.hidden = false;
  } catch (error) {
    loadingEl.hidden = true;
    errorEl.hidden = false;
    errorEl.querySelector('.error-message').textContent = error.message;
  }
}

// Add to existing badge update function
async function updateBadgeCounts() {
  // ... existing code for new-count and ambiguous-count ...

  // Unit reviews count
  try {
    const response = await fetch('/api/admin/unit-reviews?status=pending');
    const data = await response.json();
    document.getElementById('unit-reviews-count').textContent = data.reviews.length;
  } catch (error) {
    console.error('Failed to update unit reviews count:', error);
  }
}

// Approval/rejection handlers (follow pattern from analyte approval)
async function approveUnitNormalization(reviewId) {
  try {
    const response = await fetch('/api/admin/approve-unit-normalization', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ review_id: reviewId, create_alias: true })
    });

    if (response.ok) {
      showToast('Unit normalization approved', 'success');
      loadUnitReviews(); // Reload list
    }
  } catch (error) {
    showToast('Failed to approve: ' + error.message, 'error');
  }
}

// Helper functions
function getIssueTypeBadge(issueType) {
  const badges = {
    'low_confidence': 'warning',
    'alias_conflict': 'danger',
    'llm_error': 'danger',
    'sanitization_rejected': 'danger'
  };
  return badges[issueType] || 'secondary';
}
```

**Tab Switching:**
- Reuse existing tab switch handler
- Call `loadUnitReviews()` when "Unit Issues" tab is activated
- Follow same pattern as "New Analytes" and "Ambiguous Matches"

**Polling:**
- Use existing `setInterval` for badge updates (10 seconds)
- Auto-refresh active tab on interval (if "Unit Issues" is selected)

---

## 5. Implementation Plan

### 5.1 Phase 1: Database Setup (20 min)

1. Add quality metric columns to `unit_aliases` (learn_count, last_used_at) with comments
2. Add `unit_reviews` table for admin review queue
3. Add `unit_reviews` DROP to `resetDatabase()` function
4. Restart server, verify schema applies correctly

### 5.2 Phase 2: Core Service (2.5 hours)

1. Create `server/services/unitNormalizer.js`
2. Implement `normalizeUnit()` with pooled queries (no connection held during LLM)
3. Implement `normalizeUnitsBatch()` with deduplication and concurrency control
4. Implement `normalizeWithLLM()` using Responses API with retry logic
5. Implement `sanitizeUnitInput()` for input security
6. Implement `preprocessUcumOutput()` for Unicode→ASCII conversion (simple, no regex validation)
7. Implement `autoLearnAliasPooled()` with conflict detection
8. Implement `queueForAdminReview()` helper
9. Add environment variables to `.env` and `.env.example`
10. Write unit tests

### 5.3 Phase 3: Ingestion Integration (1 hour)

1. Import `normalizeUnitsBatch` in `labReportProcessor.js`
2. Call normalization **before** `sanitizeUnit()` (preserve semantic chars)
3. Use batch normalization with deduplication
4. Log normalization results (tier, confidence)
5. Test with intentional OCR errors
6. Verify auto-learning and admin review queue

### 5.4 Phase 4: Admin Panel (2 hours)

1. Add "Unit Issues" tab to `admin.html`
2. Implement fetch/render logic for unit reviews
3. Add approval/rejection/override UI
4. Add admin API endpoints in `server/routes/admin.js`
5. Test admin review workflow end-to-end

**Total MVP time:** ~5.5 hours

---

## 6. Testing & Validation

### 6.1 Core Functionality Tests

**Test 1: Connection Pool Safety (Peer Review Fix #1)**
```javascript
// Simulate concurrent batch upload with multiple LLM calls
const batchSize = 20; // Would exhaust 20-connection pool if held
const units = Array(batchSize).fill('new_unit_' + Math.random());

// Should NOT exhaust pool (connections released between queries)
const results = await Promise.all(
  units.map(u => normalizeUnit(u, 'test-result-id'))
);

// Verify all succeeded without pool timeout errors
assert(results.every(r => r.canonical));
```

**Test 2: Semantic Character Preservation (Peer Review Fix #2)**
```javascript
// Test that micro symbol is preserved for LLM context
const result = await normalizeUnit('μg/L', 'result-id');

// LLM should see 'μg/L', not 'g/L' (which sanitizeUnit would produce)
assert.equal(result.canonical, 'ug/L');
assert.equal(result.confidence, 'high');
```

**Test 3: Batch Deduplication (Peer Review Fix #3)**
```javascript
// Lab with 10 results, all same unit (common scenario)
const units = Array(10).fill({ unit: 'ммопь/л', resultId: 'test-id' });

const spy = sinon.spy(normalizeWithLLM);
await normalizeUnitsBatch(units);

// Should only call LLM once (deduplication)
assert.equal(spy.callCount, 1);
```

**Test 4: Conflict Detection (Peer Review Fix #4)**
```javascript
// Pre-create alias
await pool.query(
  "INSERT INTO unit_aliases (alias, unit_canonical, source) VALUES ('mmol/L', 'mmol/L', 'manual')"
);

// Try to auto-learn with different canonical
const result = await normalizeUnit('mmol/L', 'result-id');

// Should detect conflict and queue for review
const reviews = await pool.query(
  "SELECT * FROM unit_reviews WHERE issue_type = 'alias_conflict'"
);
assert.equal(reviews.rows.length, 1);
```

**Test 5: Retry Logic (Peer Review Fix #5)**
```javascript
// Mock OpenAI to fail with 429 twice, then succeed
let attempts = 0;
sinon.stub(openai.responses, 'parse').callsFake(() => {
  attempts++;
  if (attempts < 3) {
    const error = new Error('Rate limit exceeded');
    error.status = 429;
    throw error;
  }
  return { output_parsed: { canonical: 'mmol/L', confidence: 'high' } };
});

const result = await normalizeUnit('ммоль/л', 'result-id');

// Should succeed after retries
assert.equal(result.canonical, 'mmol/L');
assert.equal(attempts, 3); // 2 failures + 1 success
```

**Test 6: Admin Review Queue**
```javascript
// Mock LLM to return medium confidence
const result = await normalizeUnit('unknown_unit', 'result-id');

// Should queue for admin review
const reviews = await pool.query(
  "SELECT * FROM unit_reviews WHERE result_id = 'result-id'"
);
assert.equal(reviews.rows.length, 1);
assert.equal(reviews.rows[0].issue_type, 'low_confidence');
```

### 6.2 Integration Tests

See original PRD sections 5.2-5.3 (end-to-end testing, performance benchmarks)

---

## 7. Configuration Guide

```bash
# .env.example

# ============================================================
# UNIT NORMALIZATION (PRD v4.8.2)
# ============================================================

# LLM Auto-Learning Configuration
LLM_AUTO_LEARN_ENABLED=true              # Auto-INSERT high-confidence results
LLM_AUTO_LEARN_CONFIDENCE=high           # Only 'high' (medium→admin review)

# Model Configuration
UNIT_NORMALIZATION_MODEL=gpt-4o-mini     # Defaults to SQL_GENERATOR_MODEL

# Retry & Concurrency (Peer Review Enhancements)
UNIT_NORMALIZATION_MAX_RETRIES=3         # Max retries for transient errors
UNIT_NORMALIZATION_MAX_CONCURRENCY=5     # Max concurrent LLM calls per report
# UNIT_NORMALIZATION_GLOBAL_CONCURRENCY=10  # Optional: Global limit across all reports (uncomment for production)
```

---

## 8. Success Criteria

### 8.1 Functional Requirements

- [ ] Tier A (exact match) works unchanged (regression test)
- [ ] Tier B (LLM) handles OCR typos correctly
- [ ] High-confidence matches auto-promote to `unit_aliases`
- [ ] Medium/low-confidence matches go to admin review panel
- [ ] Alias conflicts detected and queued for review
- [ ] LLM failures with retry logic (3 attempts, exponential backoff)
- [ ] Batch normalization deduplicates units within report
- [ ] Connection pool not exhausted during concurrent LLM calls
- [ ] Normalization runs BEFORE sanitizeUnit() (preserves semantic chars)
- [ ] Admin can approve/reject/override unit normalizations
- [ ] Input sanitization prevents prompt injection
- [ ] Unicode→ASCII preprocessing converts μ/µ/Ω/° to ASCII equivalents

### 8.2 Performance Requirements

- [ ] Tier A: <1ms per normalization
- [ ] Tier B: <3s per normalization (with retries)
- [ ] Batch processing: Max 5 concurrent LLM calls per report
- [ ] No connection pool exhaustion during batch uploads
- [ ] Deduplication reduces LLM calls by ~80% in typical labs

### 8.3 Admin Review Requirements

- [ ] Unit reviews appear in admin panel with issue details
- [ ] Admin can see LLM suggestion and confidence
- [ ] Admin can approve (creates alias), reject (keeps raw), or override
- [ ] Admin actions logged to `admin_actions` audit trail
- [ ] Badge counts update in real-time

---

## 9. Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Connection pool exhaustion | Low (FIXED #1) | High | **FIXED**: Use pooled queries, no connection held during LLM calls |
| Advisory lock leak | None (FIXED PR#3) | Critical | **FIXED**: Use dedicated connection for advisory lock (not pooled queries) |
| Semantic char loss breaks LLM | Low (FIXED #2) | High | **FIXED**: Normalize before sanitizeUnit(), preserve μ/Ω/° for context |
| Alias conflicts cause drift | Low (FIXED #4) | Medium | **FIXED**: Conflict detection on auto-learn, queue for review |
| LLM rate limits block ingestion | Low (FIXED #5) | Medium | **FIXED**: Retry with exponential backoff (3 attempts) + optional global limiter |
| High cost from duplicate calls | Low (FIXED #3) | Low | **FIXED**: Per-report deduplication reduces calls by ~80% |
| Missing result_id for reviews | None (FIXED #4) | Critical | **FIXED**: Post-persistence normalization uses actual lab_results.id values (no pre-generation needed) |
| Storage contract ambiguity | None (FIXED #2/#3) | High | **FIXED**: Documented single normalization pipeline, raw storage, query-time matching |
| ON CONFLICT missing constraint | None (FIXED PR#3) | Critical | **FIXED**: Added UNIQUE constraint to unit_reviews.result_id |
| RETURNING non-existent column | None (FIXED PR#3) | High | **FIXED**: Return 'alias' and 'learn_count' instead of 'id' |
| Sanitization vs LLM error confusion | None (FIXED PR#3) | Medium | **FIXED**: Distinguish error types in catch block |
| Prompt injection attack | Medium | High | Input sanitization, Responses API, structured output schema |
| Invalid UCUM from LLM | Medium | Medium | **DEFERRED**: Full UCUM validation via ucum-lhc library in future PRD; human review catches issues |
| Admin review queue grows | Low | Low | Monitor queue size, adjust auto-learn threshold if needed |

---

## 10. Rollback Plan

### 10.1 Quick Disable (No Code Changes)

1. **Disable auto-learning**:
   ```bash
   # In .env:
   LLM_AUTO_LEARN_ENABLED=false
   ```
2. **Delete problematic aliases**:
   ```sql
   DELETE FROM unit_aliases
   WHERE source = 'llm'
     AND created_at > '2026-01-05';
   ```
3. System reverts to Step 2 behavior (only manual seed aliases used)

### 10.2 Data Safety

- **No data loss:** All raw units preserved in `lab_results.unit` column
- **View still works:** `v_measurements` falls back to raw unit when no alias exists
- **Manual aliases preserved:** Seed data unchanged
- **Admin review queue preserved:** Can review later

---

**End of PRD v4.8.2**
