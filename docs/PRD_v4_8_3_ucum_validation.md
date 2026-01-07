# PRD v4.8.3: UCUM Validation for LLM Unit Normalization

**Status:** Draft
**Author:** Claude
**Created:** 2026-01-05
**Target Location:** `docs/PRD_v4_8_3_ucum_validation.md`
**Related PRDs:** v4.8 (Unit Alias Table), v4.8.1 (Step 2 View Integration), v4.8.2 (LLM Fallback)
**Prerequisites:** v4.8.2 must be fully implemented (LLM fallback with auto-learning)

---

## Executive Summary

PRD v4.8.2 introduced LLM-based unit normalization with auto-learning. However, the LLM can return syntactically correct but semantically invalid UCUM codes (e.g., `mmol/mL` instead of `mmol/L`). This PRD adds **UCUM library validation** using `@lhncbc/ucum-lhc` to verify LLM responses before auto-learning, ensuring only valid units enter the alias table.

---

## 1. Problem Statement

### 1.1 Current Behavior

The current LLM normalization flow (v4.8.2):

```
Raw unit → LLM → { canonical, confidence } → Auto-learn (if high confidence)
```

**Issue:** No validation that `canonical` is a valid UCUM expression.

### 1.2 Failure Scenarios

| LLM Response | Valid UCUM? | Current Behavior | Correct Behavior |
|--------------|-------------|------------------|------------------|
| `mmol/L` | Yes | Auto-learned | Auto-learned |
| `mmol/mL` | Yes (but wrong) | Auto-learned | Auto-learned (semantic validation out of scope) |
| `mmol/litre` | No | Auto-learned | Reject, queue for review |
| `millimoles per liter` | No | Auto-learned | Reject, queue for review |
| `10^9/L` | No (should be `10*9/L`) | Auto-learned | Reject, queue for review |

### 1.3 Impact

Invalid UCUM codes in `unit_aliases`:
- Break future UCUM library operations (unit conversion, dimensional analysis)
- Pollute the alias table with garbage
- Cannot be validated downstream without re-checking every lookup

### 1.4 Root Cause

PRD v4.8.2 trusts LLM output without validation. The LLM prompt asks for UCUM but doesn't enforce it.

---

## 2. Solution Overview

### 2.1 UCUM Library Integration

Use `@lhncbc/ucum-lhc` (the official LOINC UCUM library) to validate LLM responses:

```javascript
import ucumPkg from '@lhncbc/ucum-lhc';
const ucumUtils = ucumPkg.UcumLhcUtils.getInstance();

// Validate a unit string
const result = ucumUtils.validateUnitString(unit);
// result.status: 'valid' | 'invalid'
// result.ucumCode: normalized UCUM code (if valid)
// result.msg: array of error/warning messages
```

### 2.2 Updated Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    CURRENT FLOW (v4.8.2)                         │
│                                                                  │
│  Raw unit → Tier A (exact) → Tier B (LLM) → Auto-learn          │
│                                    ↓                             │
│                              [No validation]                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    NEW FLOW (v4.8.3)                             │
│                                                                  │
│  Raw unit → Tier A (exact) → Tier B (LLM) → UCUM validate       │
│                                                   │              │
│                                    ┌──────────────┴──────────────┐
│                                    │                             │
│                              Valid UCUM?                         │
│                                    │                             │
│                         ┌──────────┴──────────┐                  │
│                         │                     │                  │
│                        YES                   NO                  │
│                         │                     │                  │
│                    Auto-learn           Queue for review         │
│                    (as before)          (issue_type: ucum_invalid)│
└─────────────────────────────────────────────────────────────────┘
```

### 2.3 Validation Logic

```javascript
async function validateAndProcessLLMResult(llmResult, rawUnit, normalized, resultId) {
  const { canonical, confidence } = llmResult;

  // Step 1: UCUM validation
  const validation = ucumUtils.validateUnitString(canonical);

  if (validation.status !== 'valid') {
    // Invalid UCUM - queue for admin review
    await queueForAdminReview(resultId, rawUnit, normalized, llmResult, 'ucum_invalid', {
      message: 'LLM returned invalid UCUM code',
      llm_suggestion: canonical,
      ucum_errors: validation.msg
    });

    return { canonical: rawUnit, tier: 'raw', confidence: null };
  }

  // Step 2: Use UCUM-normalized form (handles case normalization, etc.)
  const ucumNormalized = validation.ucumCode || canonical;

  // Step 3: Proceed with auto-learning (existing logic)
  if (confidence === 'high' && LLM_AUTO_LEARN_ENABLED) {
    await autoLearnAliasPooled(normalized, ucumNormalized, 'llm');
  }

  return { canonical: ucumNormalized, tier: 'llm', confidence };
}
```

---

## 3. Implementation Details

### 3.1 New Dependency

```bash
npm install @lhncbc/ucum-lhc
```

**Package Info:**
- Name: `@lhncbc/ucum-lhc`
- Maintainer: Lister Hill National Center for Biomedical Communications (NLM)
- Purpose: UCUM validation, conversion, and parsing
- Size: ~2MB (includes UCUM definitions)

### 3.2 UCUM Utils Initialization

The UCUM library is a singleton that loads definitions on first use.

**ESM Compatibility Note:**
The `@lhncbc/ucum-lhc` package uses CommonJS exports. In ESM projects, use default import:

```javascript
// server/services/unitNormalizer.js

// ESM import of CommonJS package (Node.js handles interop)
import ucumPkg from '@lhncbc/ucum-lhc';

// Lazy initialization with error handling
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
```

**Verification step before implementation:**
```bash
# Test ESM compatibility in project
node -e "import('@lhncbc/ucum-lhc').then(m => console.log('OK:', typeof m.default.UcumLhcUtils))"
```

### 3.3 Validation Function

```javascript
/**
 * Validate a unit string against UCUM specification
 *
 * @param {string} unit - Unit string to validate
 * @returns {{isValid: boolean, ucumCode: string|null, messages: string[]}}
 *
 * Return structure aligned with codebase conventions:
 * - isValid: boolean (consistent with other boolean flags)
 * - ucumCode: UCUM-normalized code if valid (matches library terminology)
 * - messages: array of error/warning messages (matches library terminology)
 */
function validateUcum(unit) {
  // Handle missing UCUM library gracefully
  const utils = getUcumUtils();
  if (!utils) {
    logger.warn('[unitNormalizer] UCUM library not available, skipping validation');
    return { isValid: true, ucumCode: unit, messages: ['UCUM library unavailable'] };
  }

  if (!unit || typeof unit !== 'string') {
    return { isValid: false, ucumCode: null, messages: ['Empty or invalid input'] };
  }

  const result = utils.validateUnitString(unit, true); // true = suggest corrections

  // Handle strict mode (reject warnings too)
  const UCUM_VALIDATION_STRICT = process.env.UCUM_VALIDATION_STRICT === 'true';
  const hasWarnings = result.msg && result.msg.some(m => m.toLowerCase().includes('warning'));
  const isValid = result.status === 'valid' && (!UCUM_VALIDATION_STRICT || !hasWarnings);

  return {
    isValid,
    ucumCode: result.status === 'valid' ? (result.ucumCode || unit) : null,
    messages: result.msg || []
  };
}
```

### 3.4 Known UCUM Edge Cases

| Input | `validateUnitString()` Result | Notes |
|-------|-------------------------------|-------|
| `mmol/L` | valid | Standard molar concentration |
| `10*9/L` | valid | UCUM uses `*` for exponentiation |
| `10^9/L` | **invalid** | Common but wrong (use `*` not `^`) |
| `ug/L` | valid | Microgram (ASCII representation) |
| `μg/L` | valid | Microgram (Unicode mu) |
| `U/L` | valid | Enzyme unit |
| `IU/L` | valid | International unit |
| `%` | valid | Percent |
| `fL` | valid | Femtoliter |
| `pg` | valid | Picogram |
| `mmol/l` | valid (normalizes to `mmol/L`) | Case-insensitive for SI prefixes |

### 3.5 Validation Philosophy: Preprocessing vs. Auto-Fixing

**Important distinction:**

1. **Preprocessing (KEEP):** Unicode→ASCII character normalization (`μ`→`u`, `Ω`→`Ohm`)
   - Required because UCUM standard uses ASCII
   - Runs AFTER LLM returns output, BEFORE validation
   - This is encoding normalization, not error correction

2. **Auto-Fixing (DON'T DO):** UCUM syntax corrections (`^`→`*`, `litre`→`L`)
   - If LLM returns `10^9/L` instead of `10*9/L`, this is an LLM error that should be flagged
   - Auto-fixing syntax would mask LLM quality issues and prevent prompt improvement
   - Admin review allows manual correction with full context

**Validation order:**
```
LLM output → preprocessUcumOutput() → validateUcum() → auto-learn or queue
              (Unicode→ASCII)         (UCUM check)
```

**What we DON'T do:**
```javascript
// ❌ WRONG - auto-fixing UCUM syntax masks LLM errors
function autoFixUcumSyntax(unit) {
  return unit.replace(/(\d+)\^(\d+)/g, '$1*$2'); // Don't do this
}
```

**What we DO:**
```javascript
// ✅ CORRECT - preprocess encoding, then validate, queue failures for review
const preprocessed = preprocessUcumOutput(llmResult.canonical); // μ→u only
const validation = validateUcum(preprocessed);
if (!validation.isValid) {
  await queueForAdminReview(..., 'ucum_invalid', {
    message: 'LLM returned invalid UCUM code',
    suggested_fix: 'Consider: 10*9/L instead of 10^9/L'  // Suggest fix, don't apply
  });
}
```

### 3.6 Integration Point in normalizeUnit()

**Location:** `server/services/unitNormalizer.js`, lines 84-143 (LLM result handling block)

**Current code structure (v4.8.2):**
```javascript
// Line ~95-100: After LLM call returns
if (llmResult.canonical) {
  // Line ~105-115: Confidence check and auto-learn
  if (llmResult.confidence === 'high' && LLM_AUTO_LEARN_ENABLED) {
    await autoLearnAliasPooled(normalized, llmResult.canonical, 'llm');
  }
  return { canonical: llmResult.canonical, tier: 'llm', confidence: llmResult.confidence };
}
```

**New code (v4.8.3) - insert UCUM validation BEFORE auto-learn:**
```javascript
// Line ~95-100: After LLM call returns
if (llmResult.canonical) {
  // ┌─────────────────────────────────────────────────────────────┐
  // │ NEW (v4.8.3): UCUM Validation - INSERT HERE                 │
  // └─────────────────────────────────────────────────────────────┘
  if (UCUM_VALIDATION_ENABLED) {
    const ucumValidation = validateUcum(llmResult.canonical);

    if (!ucumValidation.isValid) {
      // Invalid UCUM - queue for admin review, return raw unit
      await queueForAdminReview(resultId, rawUnit, normalized, llmResult, 'ucum_invalid', {
        message: 'LLM returned invalid UCUM code',
        llm_suggestion: llmResult.canonical,
        ucum_errors: ucumValidation.messages,
        suggested_fix: suggestUcumFix(llmResult.canonical)
      });

      logger.warn({
        raw_unit: rawUnit,
        llm_canonical: llmResult.canonical,
        ucum_errors: ucumValidation.messages
      }, '[unitNormalizer] LLM result failed UCUM validation');

      return { canonical: rawUnit, tier: 'raw', confidence: null };
    }

    // Use UCUM-normalized form (library may normalize case, etc.)
    const finalCanonical = ucumValidation.ucumCode || llmResult.canonical;
  }
  // ┌─────────────────────────────────────────────────────────────┐
  // │ END NEW (v4.8.3)                                            │
  // └─────────────────────────────────────────────────────────────┘

  // Existing: Confidence check and auto-learn (use finalCanonical if UCUM enabled)
  const canonicalToUse = UCUM_VALIDATION_ENABLED ? finalCanonical : llmResult.canonical;
  if (llmResult.confidence === 'high' && LLM_AUTO_LEARN_ENABLED) {
    await autoLearnAliasPooled(normalized, canonicalToUse, 'llm');
  }
  return { canonical: canonicalToUse, tier: 'llm', confidence: llmResult.confidence };
}
```

---

## 4. Admin Review Queue Updates

### 4.1 Database Schema Change (REQUIRED)

The `unit_reviews` table has a constraint limiting `issue_type` values. **This must be updated:**

```sql
-- In server/db/schema.js, update the unit_reviews table constraint:

-- OLD constraint (v4.8.2):
-- CONSTRAINT chk_issue_type CHECK (issue_type IN ('low_confidence', 'alias_conflict', 'llm_error', 'sanitization_rejected'))

-- NEW constraint (v4.8.3):
CONSTRAINT chk_issue_type CHECK (issue_type IN ('low_confidence', 'alias_conflict', 'llm_error', 'sanitization_rejected', 'ucum_invalid'))
```

**Migration for existing databases:**
```sql
ALTER TABLE unit_reviews DROP CONSTRAINT IF EXISTS chk_issue_type;
ALTER TABLE unit_reviews ADD CONSTRAINT chk_issue_type
  CHECK (issue_type IN ('low_confidence', 'alias_conflict', 'llm_error', 'sanitization_rejected', 'ucum_invalid'));
```

### 4.2 Duplicate Prevention

Before inserting a new `unit_reviews` entry, check if a pending review already exists for the same `raw_unit`. This prevents duplicate entries when the same invalid unit appears in multiple uploads before admin review.

**Add partial unique index:**
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_unit_reviews_pending_unique
  ON unit_reviews (raw_unit)
  WHERE status = 'pending';
```

**Check before insert in `queueForAdminReview()`:**
```javascript
async function queueForAdminReview(resultId, rawUnit, normalized, llmResult, issueType, issueDetails) {
  // Check if pending review already exists
  const existing = await query(`
    SELECT id FROM unit_reviews
    WHERE raw_unit = $1 AND status = 'pending'
    LIMIT 1
  `, [rawUnit]);

  if (existing.rows.length > 0) {
    logger.debug({ rawUnit }, '[unitNormalizer] Pending review already exists, skipping');
    return { queued: false, reason: 'already_pending' };
  }

  // Insert new review entry
  // ... existing insert logic ...
}
```

### 4.3 Issue Type Definitions

| issue_type | Description | Admin Action |
|------------|-------------|--------------|
| `low_confidence` | LLM confidence < high | Approve/reject suggestion |
| `alias_conflict` | Alias exists with different canonical | Choose correct mapping |
| `llm_error` | LLM API call failed | Manual entry |
| `sanitization_rejected` | Input contained unsafe chars | Manual entry |
| **`ucum_invalid`** | **LLM returned invalid UCUM** | **Fix and approve** |

### 4.4 Admin UI Enhancement

For `ucum_invalid` reviews, show:
- LLM suggestion (what it returned)
- UCUM errors (why it's invalid)
- Common fix suggestions (e.g., "Did you mean `10*9/L` instead of `10^9/L`?")

**Approach:** Use existing table-based UI with modal for UCUM details (consistent with current `admin.html` patterns).

**HTML changes (`public/admin.html`):**

No structural changes needed. The existing `details-modal` will be reused for UCUM error details.

**JavaScript changes (`public/js/admin.js`):**

```javascript
// Update getIssueTypeBadge() to include ucum_invalid:
function getIssueTypeBadge(issueType) {
  const badges = {
    'low_confidence': 'warning',
    'alias_conflict': 'danger',
    'llm_error': 'danger',
    'sanitization_rejected': 'danger',
    'ucum_invalid': 'danger'  // NEW
  };
  return badges[issueType] || 'secondary';
}

// In renderUnitReviews(), update the Details column to show UCUM-specific info:
// The issue_details JSONB will contain ucum_errors and suggested_fix for ucum_invalid type
function renderUnitReviews() {
  // ... existing code ...

  unitReviews.forEach(review => {
    const issueDetails = review.issue_details || {};

    // For ucum_invalid, show UCUM errors in details column
    let detailsText = issueDetails.message || '—';
    if (review.issue_type === 'ucum_invalid' && issueDetails.ucum_errors) {
      detailsText = issueDetails.ucum_errors.join('; ');
    }

    // ... rest of row rendering ...
  });
}

// Add UCUM details modal handler (reuses existing details-modal):
function showUcumDetails(reviewId) {
  const review = unitReviews.find(r => r.review_id == reviewId);
  if (!review) return;

  const issueDetails = review.issue_details || {};
  const modalTitle = document.getElementById('modal-title');
  const modalBody = document.getElementById('modal-body');

  modalTitle.textContent = `UCUM Validation Error: ${review.raw_unit}`;
  modalBody.innerHTML = `
    <h4>LLM Suggestion</h4>
    <p><code>${escapeHtml(review.llm_suggestion || 'N/A')}</code></p>

    <h4>UCUM Errors</h4>
    <ul>
      ${(issueDetails.ucum_errors || ['No error details']).map(e => `<li>${escapeHtml(e)}</li>`).join('')}
    </ul>

    ${issueDetails.suggested_fix ? `
      <h4>Suggested Fix</h4>
      <p><code>${escapeHtml(issueDetails.suggested_fix)}</code></p>
    ` : ''}
  `;

  detailsModal.hidden = false;
}
```

---

## 5. Configuration

### 5.1 New Environment Variables

```env
# UCUM Validation (PRD v4.8.3)
UCUM_VALIDATION_ENABLED=true              # Enable UCUM validation (default: true)
UCUM_VALIDATION_STRICT=false              # Strict mode: reject warnings too (default: false)
```

### 5.2 Feature Flag

UCUM validation can be disabled during rollout:

```javascript
const UCUM_VALIDATION_ENABLED = process.env.UCUM_VALIDATION_ENABLED !== 'false';

if (UCUM_VALIDATION_ENABLED) {
  const ucumValidation = validateUcum(preprocessed);
  // ... validation logic ...
} else {
  // Skip validation, proceed with auto-learn
}
```

---

## 6. Files to Modify

| File | Change |
|------|--------|
| `package.json` | Add `@lhncbc/ucum-lhc` dependency |
| `server/services/unitNormalizer.js` | Add UCUM validation logic, `validateUcum()`, `getUcumUtils()` |
| `server/services/unitNormalizer.js` | Update `normalizeUnit()` flow (insert validation before auto-learn) |
| `server/services/unitNormalizer.js` | Update `queueForAdminReview()` with duplicate check |
| `server/db/schema.js` | Update `chk_issue_type` constraint to include `ucum_invalid` |
| `server/db/schema.js` | Add `idx_unit_reviews_pending_unique` partial index |
| `.env.example` | Add UCUM config variables (see below) |
| `public/admin.html` | No changes (reuses existing modal) |
| `public/js/admin.js` | Handle `ucum_invalid` issue type in UI |
| `test/manual/test_ucum_library_behavior.js` | New file: Library behavior verification |

### 6.1 .env.example Additions

```bash
# ============================================================
# UCUM VALIDATION (PRD v4.8.3)
# ============================================================
# Enable UCUM validation for LLM unit normalization (default: true)
# UCUM_VALIDATION_ENABLED=true

# Strict mode: reject units with UCUM warnings, not just errors (default: false)
# UCUM_VALIDATION_STRICT=false
```

---

## 7. Testing

### 7.0 Phase 0: Library Behavior Verification (PREREQUISITE)

Before implementing, verify that `@lhncbc/ucum-lhc` behaves as expected:

```javascript
// test/manual/test_ucum_library_behavior.js

import ucumPkg from '@lhncbc/ucum-lhc';
const ucum = ucumPkg.UcumLhcUtils.getInstance();

const testCases = [
  // Expected VALID
  { unit: 'mmol/L', expectValid: true, note: 'Standard molar concentration' },
  { unit: '10*9/L', expectValid: true, note: 'UCUM exponentiation syntax' },
  { unit: 'mg/dL', expectValid: true, note: 'Mass concentration' },
  { unit: 'ug/L', expectValid: true, note: 'Microgram ASCII' },
  { unit: 'μg/L', expectValid: true, note: 'Microgram Unicode' },
  { unit: 'U/L', expectValid: true, note: 'Enzyme unit' },
  { unit: 'IU/L', expectValid: true, note: 'International unit' },
  { unit: '%', expectValid: true, note: 'Percent' },
  { unit: 'fL', expectValid: true, note: 'Femtoliter' },
  { unit: 'mm[Hg]', expectValid: true, note: 'Blood pressure' },
  { unit: 'mIU/mL', expectValid: true, note: 'Milli-international units' },

  // Expected INVALID
  { unit: '10^9/L', expectValid: false, note: 'Wrong exponentiation (^ not *)' },
  { unit: 'millimoles per liter', expectValid: false, note: 'Natural language' },
  { unit: 'mmol/litre', expectValid: false, note: 'Non-UCUM spelling' },
  { unit: 'xyz123', expectValid: false, note: 'Nonsense' },

  // Edge cases - verify behavior
  { unit: 'cells/uL', expectValid: null, note: 'Check if cells recognized' },
  { unit: 'copies/mL', expectValid: null, note: 'Check if copies recognized' },
];

console.log('UCUM Library Behavior Verification\n' + '='.repeat(50));

testCases.forEach(({ unit, expectValid, note }) => {
  const result = ucum.validateUnitString(unit, true);
  const isValid = result.status === 'valid';
  const match = expectValid === null ? '?' : (isValid === expectValid ? '✓' : '✗');

  console.log(`${match} "${unit}"`);
  console.log(`  Status: ${result.status}`);
  console.log(`  UCUM Code: ${result.ucumCode || 'N/A'}`);
  console.log(`  Messages: ${JSON.stringify(result.msg)}`);
  console.log(`  Note: ${note}\n`);
});
```

**Run before implementation:**
```bash
npm install @lhncbc/ucum-lhc
node test/manual/test_ucum_library_behavior.js
```

**Action items based on results:**
1. If any "Expected VALID" units fail, investigate UCUM library docs
2. If `10^9/L` passes (unexpected), our validation assumption is wrong
3. Document any edge cases with warnings (for STRICT mode decision)

### 7.0.1 Seed Data Validation (PREREQUISITE)

Validate all canonical units in `server/db/seed_unit_aliases.sql` before production use:

```javascript
// test/manual/test_seed_unit_aliases_ucum.js

import ucumPkg from '@lhncbc/ucum-lhc';
import fs from 'fs';

const ucum = ucumPkg.UcumLhcUtils.getInstance();

// Extract unique canonical units from seed file
const seedSQL = fs.readFileSync('server/db/seed_unit_aliases.sql', 'utf8');
const canonicalUnits = [...new Set(
  seedSQL.match(/'([^']+)',\s*'([^']+)'\)/g)
    ?.map(match => match.match(/'([^']+)'\)$/)?.[1])
    .filter(Boolean)
)];

console.log(`Validating ${canonicalUnits.length} unique canonical units from seed file\n`);
console.log('='.repeat(60));

let valid = 0, invalid = 0, warnings = 0;

canonicalUnits.forEach(unit => {
  const result = ucum.validateUnitString(unit, true);
  const hasWarnings = result.msg?.some(m => m.toLowerCase().includes('warning'));

  if (result.status !== 'valid') {
    console.log(`✗ INVALID: "${unit}"`);
    console.log(`  Messages: ${JSON.stringify(result.msg)}`);
    invalid++;
  } else if (hasWarnings) {
    console.log(`⚠ WARNING: "${unit}"`);
    console.log(`  Messages: ${JSON.stringify(result.msg)}`);
    warnings++;
  } else {
    console.log(`✓ "${unit}"`);
    valid++;
  }
});

console.log('\n' + '='.repeat(60));
console.log(`Results: ${valid} valid, ${warnings} warnings, ${invalid} invalid`);

if (invalid > 0) {
  console.log('\n❌ SEED DATA CONTAINS INVALID UCUM CODES - FIX BEFORE PRODUCTION');
  process.exit(1);
}

if (warnings > 0) {
  console.log('\n⚠️  Some units have warnings - review if UCUM_VALIDATION_STRICT=true is planned');
}
```

**Run after installing library:**
```bash
node test/manual/test_seed_unit_aliases_ucum.js
```

**Potential issues to watch for:**
- `{index}` - UCUM annotation syntax (may need `[index]` or similar)
- `%o` - permille (verify UCUM accepts this form)
- `uIU/mL` - micro-international units (verify accepted)

**Action if invalid units found:**
1. Fix the canonical value in `seed_unit_aliases.sql`
2. Re-run validation
3. All canonical units MUST pass before deploying UCUM validation

### 7.1 Unit Tests

```javascript
// test/unit/ucumValidation.test.js

import { validateUcum, getUcumUtils } from '../../server/services/unitNormalizer.js';

describe('UCUM Validation', () => {
  test('validates standard units', () => {
    expect(validateUcum('mmol/L').isValid).toBe(true);
    expect(validateUcum('ug/L').isValid).toBe(true);
    expect(validateUcum('10*9/L').isValid).toBe(true);
  });

  test('rejects invalid units', () => {
    expect(validateUcum('10^9/L').isValid).toBe(false); // ^ not valid in UCUM
    expect(validateUcum('millimoles per liter').isValid).toBe(false);
    expect(validateUcum('xyz123').isValid).toBe(false);
  });

  test('returns normalized UCUM code for valid units', () => {
    const result = validateUcum('mmol/l'); // lowercase L
    expect(result.isValid).toBe(true);
    expect(result.ucumCode).toBe('mmol/L'); // normalized to uppercase L
  });

  test('returns error messages for invalid units', () => {
    const result = validateUcum('10^9/L');
    expect(result.isValid).toBe(false);
    expect(result.messages.length).toBeGreaterThan(0);
  });

  test('handles empty input', () => {
    expect(validateUcum('').isValid).toBe(false);
    expect(validateUcum(null).isValid).toBe(false);
  });

  test('gracefully handles UCUM library unavailable', () => {
    // If library fails to load, validation should pass (fail-open)
    // This is tested by mocking getUcumUtils to return null
  });
});
```

### 7.2 Integration Test

```javascript
// Upload a lab report with unusual unit
// Verify:
// 1. LLM is called
// 2. UCUM validation runs
// 3. If invalid, queued for admin review with issue_type='ucum_invalid'
// 4. If valid, auto-learned and subsequent lookups return cached result
```

---

## 8. Rollout Plan

### Phase 1: Install and Test (Day 1)
1. `npm install @lhncbc/ucum-lhc`
2. Add validation functions with logging only (no behavior change)
3. Monitor logs for validation failures

### Phase 2: Enable Validation (Day 2-3)
1. Enable `UCUM_VALIDATION_ENABLED=true`
2. Monitor admin review queue for `ucum_invalid` entries
3. Adjust LLM prompt if many false negatives

### Phase 3: Strict Mode (Optional)
1. Enable `UCUM_VALIDATION_STRICT=true` if needed
2. This rejects units with UCUM warnings (not just errors)

---

## 9. Success Criteria

- [ ] `@lhncbc/ucum-lhc` installed and working
- [ ] UCUM validation prevents invalid units from auto-learning
- [ ] `ucum_invalid` reviews appear in admin queue with helpful error messages
- [ ] Valid LLM responses still auto-learn correctly
- [ ] No regression in existing unit normalization flow
- [ ] Test coverage for UCUM validation edge cases

---

## 10. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| UCUM library too strict | Use `UCUM_VALIDATION_STRICT=false` (default) |
| UCUM library not installed | Feature flag disables validation gracefully |
| Performance impact | UCUM validation is fast (~1ms), singleton pattern |
| LLM prompt needs adjustment | Iterate on prompt to produce more UCUM-compliant output |
| ESM/CommonJS compatibility | Verified with test command in Section 3.2 |
| Cold start latency | ~100ms on first call (acceptable, see 10.2) |

### 10.1 Package Size Impact

The `@lhncbc/ucum-lhc` package adds ~2MB to `node_modules`:
- **Docker image**: +2MB (negligible for typical Node.js images)
- **Memory footprint**: ~50MB when loaded (UCUM definitions in memory)
- **Cold start**: ~100ms initialization on first validation call

### 10.2 Cold Start Performance

The UCUM library takes ~100ms to initialize on first use (loads unit definitions). This happens once per server lifecycle.

**Context:**
- OCR operations take 20-60 seconds
- 100ms is <0.5% overhead on first request
- Subsequent validations take ~1ms

**Default behavior:** Lazy initialization on first validation call.

**Optional eager initialization:** For predictable performance, add to `server/index.js`:
```javascript
import { initializeUcumValidator } from './services/unitNormalizer.js';

// After database connection, before listening
if (process.env.UCUM_VALIDATION_ENABLED !== 'false') {
  initializeUcumValidator();
  logger.info('[startup] UCUM validator pre-initialized');
}
```

---

## 10.5 Rollback Plan

### Quick Disable
Set `UCUM_VALIDATION_ENABLED=false` in `.env` and restart server.

### Full Rollback
1. Set `UCUM_VALIDATION_ENABLED=false`
2. Remove `@lhncbc/ucum-lhc` from `package.json`
3. Run `npm install` to clean up
4. Revert `unitNormalizer.js` changes
5. (Optional) Remove `ucum_invalid` from constraint:
   ```sql
   ALTER TABLE unit_reviews DROP CONSTRAINT IF EXISTS chk_issue_type;
   ALTER TABLE unit_reviews ADD CONSTRAINT chk_issue_type
     CHECK (issue_type IN ('low_confidence', 'alias_conflict', 'llm_error', 'sanitization_rejected'));
   ```
6. (Optional) Resolve or delete any `ucum_invalid` review entries:
   ```sql
   DELETE FROM unit_reviews WHERE issue_type = 'ucum_invalid' AND status = 'pending';
   ```

---

## 11. Future Considerations

### 11.1 Unit Conversion (Future PRD)

With UCUM validation in place, we can add unit conversion:

```javascript
// Convert between compatible units
ucumUtils.convertUnitTo('mg/dL', 'mmol/L', 100, 'glucose');
// Returns: { value: 5.55, toUnit: 'mmol/L' }
```

### 11.2 Dimensional Analysis

UCUM enables checking if units are dimensionally compatible:

```javascript
// Are these units compatible for comparison?
ucumUtils.commensurableUnits('mmol/L', 'umol/L'); // true
ucumUtils.commensurableUnits('mmol/L', 'mg/dL'); // true (with conversion)
ucumUtils.commensurableUnits('mmol/L', 'mm/h'); // false
```

This could prevent nonsensical LLM normalizations (e.g., normalizing `mmol/L` to `mm/h`).

### 11.3 Semantic Unit Validation (Future)

**Out of scope for v4.8.3.** UCUM validates syntax only, not semantic correctness.

**Problem:** LLM could return `mmol/mL` for glucose (valid UCUM but wrong - glucose is measured in mmol/L or mg/dL, never mmol/mL). This would be off by 1000x.

**Future solution:** Build an analyte→valid_units mapping table:
```sql
CREATE TABLE analyte_valid_units (
  analyte_id INTEGER REFERENCES analytes(id),
  valid_ucum_code TEXT NOT NULL,  -- e.g., 'mmol/L'
  is_primary BOOLEAN DEFAULT false,
  PRIMARY KEY (analyte_id, valid_ucum_code)
);
```

Then validate LLM output against allowed units for the specific analyte. This requires:
1. Curating valid units for each analyte
2. Knowing which analyte is being measured (requires context from OCR)
3. More complex validation logic

Recommend as separate PRD after v4.8.x series is complete.
