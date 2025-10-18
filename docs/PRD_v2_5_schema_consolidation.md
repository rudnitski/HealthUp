# PRD v2.5: Schema Consolidation & Database Reset

**Status:** Approved (Revised)
**Priority:** P0 (Blocking - fixes critical bugs)
**Effort:** ~45 minutes
**Target:** MVP cleanup before production launch
**Date:** 2025-10-18
**Revision:** Added missing code updates (MappingApplier, admin routes)

---

## 1. Overview

### Problem Statement
During MVP development, schema evolved through migrations creating **two critical bugs**, code mismatches, and technical debt:
1. 🔴 **Bug**: Code references `pending_analytes.updated_at` column that doesn't exist
2. 🔴 **Bug**: Code uses `ON CONFLICT (result_id)` without unique constraint on `match_reviews.result_id`
3. 🔴 **Code Mismatch**: Admin routes still use old `match_reviews.suggested_analyte_id` column
4. 🔴 **Code Mismatch**: Timestamp columns added but never populated (updated_at, resolved_at)
5. 🟡 **Tech Debt**: Fragmented schema definitions (CREATE + ALTER TABLE)
6. 🟡 **Tech Debt**: Unused columns in `match_reviews` from old design
7. 🟢 **Missing**: Proper NOT NULL constraints and documentation

Since we're at **MVP stage with no production data**, we can drop the database and recreate from a clean, consolidated schema.

### Success Criteria
- ✅ All runtime bugs fixed (updated_at, UNIQUE constraint)
- ✅ Single-file consolidated schema (no migrations folder)
- ✅ Proper constraints, indexes, and documentation
- ✅ User re-uploads lab reports to test OCR pipeline
- ✅ All features work identically to before

---

## 2. Current State Analysis

### Critical Bugs

**Bug #1: Missing `updated_at` column**
```javascript
// server/services/MappingApplier.js:871
ON CONFLICT (proposed_code) DO UPDATE SET
  updated_at = NOW()  // ❌ Column doesn't exist!
```

**Bug #2: Missing unique constraint**
```javascript
// server/services/MappingApplier.js:933
ON CONFLICT (result_id) DO UPDATE SET  // ❌ No unique index!
  candidates = EXCLUDED.candidates
```

### Schema Fragmentation Example

```javascript
// Current schema.js approach
CREATE TABLE pending_analytes (pending_id BIGSERIAL PRIMARY KEY, ...);

// 50 lines later...
ALTER TABLE pending_analytes
  ADD COLUMN IF NOT EXISTS parameter_variations JSONB,
  ADD COLUMN IF NOT EXISTS discarded_at TIMESTAMPTZ;
```

**Problem**: Hard to see full table structure at a glance.

---

## 3. Proposed Solution

### 3.1 Consolidate Schema Definitions

**Before** (Fragmented):
```sql
CREATE TABLE pending_analytes (...minimal columns...);
ALTER TABLE pending_analytes ADD COLUMN parameter_variations JSONB;
ALTER TABLE pending_analytes ADD COLUMN discarded_at TIMESTAMPTZ;
```

**After** (Consolidated):
```sql
CREATE TABLE pending_analytes (
  pending_id BIGSERIAL PRIMARY KEY,
  proposed_code TEXT UNIQUE NOT NULL,
  proposed_name TEXT NOT NULL,
  unit_canonical TEXT,
  category TEXT,

  -- Evidence (JSONB)
  evidence JSONB,
  parameter_variations JSONB,

  -- Metadata
  confidence REAL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'discarded')),

  -- Approval tracking
  approved_at TIMESTAMPTZ,
  approved_analyte_id INT REFERENCES analytes(analyte_id),
  discarded_at TIMESTAMPTZ,
  discarded_reason TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()  -- ← FIX BUG #1
);

CREATE INDEX idx_pending_analytes_status
  ON pending_analytes(status);
```

### 3.2 Fix `match_reviews` Table

**Before** (Broken + Tech Debt):
```sql
CREATE TABLE match_reviews (
  review_id BIGSERIAL PRIMARY KEY,
  result_id UUID NOT NULL REFERENCES lab_results(id),  -- ❌ Not unique!
  suggested_analyte_id INT,  -- Unused (old design)
  suggested_code TEXT,       -- Unused (old design)
  confidence REAL,           -- Unused (old design)
  rationale TEXT,            -- Unused (old design)
  candidates JSONB,          -- ✅ Actually used
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**After** (Fixed + Clean):
```sql
CREATE TABLE match_reviews (
  review_id BIGSERIAL PRIMARY KEY,
  result_id UUID UNIQUE NOT NULL REFERENCES lab_results(id) ON DELETE CASCADE,  -- ← FIX BUG #2

  -- New design: JSONB candidates array
  candidates JSONB NOT NULL,  -- ← Add NOT NULL

  -- Metadata
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'resolved', 'skipped')),
  resolved_at TIMESTAMPTZ,  -- ← Add for audit trail

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()  -- ← Add for consistency
);

CREATE INDEX idx_match_reviews_status ON match_reviews(status);
CREATE INDEX idx_match_reviews_result_id ON match_reviews(result_id);
```

### 3.3 Add Missing Indexes

```sql
-- For admin audit trail queries
CREATE INDEX idx_admin_actions_entity
  ON admin_actions(entity_type, entity_id);

-- For language-specific alias searches
CREATE INDEX idx_analyte_aliases_lang
  ON analyte_aliases(lang);
```

### 3.4 Improve JSONB Documentation

```sql
COMMENT ON COLUMN pending_analytes.evidence IS
  'Evidence structure: {report_id: UUID, result_id: UUID, parameter_name: string, unit: string, llm_comment: string, first_seen: ISO8601, last_seen: ISO8601, occurrence_count: int}';

COMMENT ON COLUMN match_reviews.candidates IS
  'Array of candidate matches: [{analyte_id: int, analyte_code: string, analyte_name: string, similarity: float, source: string}]';

COMMENT ON COLUMN pending_analytes.parameter_variations IS
  'Array of parameter name variations: [{raw: string, normalized: string, lang: string, count: int}]';
```

### 3.5 Add CHECK Constraints for Status Enums

```sql
-- pending_analytes
ALTER TABLE pending_analytes
  ADD CONSTRAINT pending_analytes_status_check
  CHECK (status IN ('pending', 'approved', 'discarded'));

-- match_reviews
ALTER TABLE match_reviews
  ADD CONSTRAINT match_reviews_status_check
  CHECK (status IN ('pending', 'resolved', 'skipped'));
```

### 3.6 Remove Unused Columns

**From `pending_analytes`:**
- Drop `aliases` column (unused, replaced by `parameter_variations`)

**From `match_reviews`:**
- Drop `suggested_analyte_id` (old design)
- Drop `suggested_code` (old design)
- Drop `confidence` (old design)
- Drop `rationale` (old design)

---

## 4. Implementation Plan

### Phase 1: Update Application Code (10 min)

**Update server/services/MappingApplier.js:**

1. **Line ~937** (queueForReview ON CONFLICT):
```javascript
// ADD updated_at to upsert
ON CONFLICT (result_id) DO UPDATE SET
  candidates = EXCLUDED.candidates,
  status = 'pending',
  updated_at = NOW()  // ← ADD THIS
```

**Update server/routes/admin.js:**

2. **POST /api/admin/resolve-match** (~line 372-378):
```javascript
// Replace suggested_analyte_id logic with new design
UPDATE match_reviews SET
  status = 'resolved',
  resolved_at = NOW(),     // ← ADD THIS
  updated_at = NOW()       // ← ADD THIS
WHERE review_id = $1
```

3. **POST /api/admin/approve-analyte** (~line 170-178):
```javascript
// Add updated_at when approving
UPDATE pending_analytes
SET status = 'approved',
    approved_at = NOW(),
    approved_analyte_id = $1,
    updated_at = NOW()    // ← ADD THIS
WHERE pending_id = $2
```

4. **POST /api/admin/discard-analyte**:
```javascript
// Add updated_at when discarding
UPDATE pending_analytes
SET status = 'discarded',
    discarded_at = NOW(),
    discarded_reason = $1,
    updated_at = NOW()    // ← ADD THIS
WHERE pending_id = $2
```

5. **GET /api/admin/ambiguous-matches** (~line 283-292):
```javascript
// Remove suggested_analyte_id from SELECT (will be dropped from schema)
// Use only: review_id, result_id, candidates, status, created_at
```

### Phase 2: Update Schema.js (15 min)

**Tasks:**
1. **Consolidate all table definitions**:
   - Move column definitions from ALTER TABLE (lines ~161-166) into CREATE TABLE blocks
   - **KEEP** all CREATE INDEX statements (lines ~167-192)
   - **KEEP** all COMMENT statements (lines ~193-214)
   - Delete only the ALTER TABLE ADD COLUMN lines
2. **Add missing columns:**
   - `pending_analytes.updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
   - `match_reviews.updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
   - `match_reviews.resolved_at TIMESTAMPTZ`
3. **Add unique constraint:** `match_reviews.result_id UNIQUE`
4. **Remove unused columns:**
   - `pending_analytes.aliases`
   - `match_reviews.suggested_analyte_id`
   - `match_reviews.suggested_code`
   - `match_reviews.confidence`
   - `match_reviews.rationale`
5. **Add NOT NULL constraints:**
   - `analytes.name NOT NULL`
   - `pending_analytes.status NOT NULL`
   - `match_reviews.status NOT NULL`
   - `match_reviews.candidates NOT NULL`
6. **Add CHECK constraints:**
   - `pending_analytes.status CHECK (status IN ('pending', 'approved', 'discarded'))`
   - `match_reviews.status CHECK (status IN ('pending', 'resolved', 'skipped'))`
7. **Add missing indexes:**
   - `idx_admin_actions_entity ON admin_actions(entity_type, entity_id)`
   - `idx_analyte_aliases_lang ON analyte_aliases(lang)`
8. **Add JSONB structure comments** (as shown in 3.4)

### Phase 3: Database Reset (2 min)

```bash
# Drop existing database
dropdb -U healthup_user healthup

# Recreate empty database
createdb -U healthup_user healthup

# Run schema.js (happens automatically on server start)
npm run dev
```

**Note:** No data preservation needed - user will re-upload lab reports.

### Phase 4: Cleanup (1 min)

```bash
# Delete migrations folder (no longer needed)
rm -rf migrations/

# Update README
echo "" >> README.md
echo "## Database Schema" >> README.md
echo "Schema is managed in \`server/db/schema.js\` (no migrations for MVP)." >> README.md
echo "After production launch, use migrations for schema changes." >> README.md
```

### Phase 5: Testing & Validation (15 min)

**Test Plan:**

1. **OCR Pipeline Test**
   - User re-uploads all lab reports (PDF files)
   - Verify OCR extraction works correctly with updated prompt (categorical ranges)
   - **Success Criteria:** All reports parsed, lab_results populated with correct reference ranges

2. **Analyte Mapping Test**
   - Check auto-mapping (exact, fuzzy, LLM)
   - Verify `pending_analytes` gets populated with NEW proposals
   - Verify `match_reviews` gets ambiguous/medium-confidence matches
   - **Success Criteria:** No runtime errors on `updated_at` or `ON CONFLICT`

3. **Admin UI Test**
   - Approve pending analytes → check backfill works
   - Resolve ambiguous matches → check `resolved_at` populated
   - Discard pending analytes → check status update
   - **Success Criteria:** Admin actions logged, lab_results updated correctly

4. **SQL Generation Test**
   - Query: "покажи мне все мои анализы холестерина"
   - Verify canonical analyte grouping works
   - Verify LEFT JOIN includes unmapped results
   - **Success Criteria:** OCR variations grouped, all results returned

5. **Plot Rendering Test**
   - Generate plot for cholesterol over time
   - Verify healthy range bands display correctly
   - **Success Criteria:** Canonical names shown, reference ranges from desirable category (not borderline)

6. **Language Detection Test**
   - Upload reports with mixed-script names ("Витамин D", "IL-6 интерлейкин")
   - Verify dominant character set detection works
   - **Success Criteria:** Aliases tagged with correct language

---

## 5. Full Schema Changes

### Tables to Consolidate

#### `analytes`
```sql
CREATE TABLE IF NOT EXISTS analytes (
  analyte_id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,  -- ← ADD NOT NULL
  unit_canonical TEXT,
  category TEXT,
  reference_low REAL,
  reference_high REAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE analytes IS 'Canonical analyte definitions with standardized codes';
COMMENT ON COLUMN analytes.code IS 'Unique analyte code (e.g., CHOL, HDL, VITD)';
COMMENT ON COLUMN analytes.name IS 'Canonical English name for display';
```

#### `pending_analytes`
```sql
CREATE TABLE IF NOT EXISTS pending_analytes (
  pending_id BIGSERIAL PRIMARY KEY,
  proposed_code TEXT UNIQUE NOT NULL,
  proposed_name TEXT NOT NULL,
  unit_canonical TEXT,
  category TEXT,

  -- Evidence (JSONB)
  evidence JSONB,
  parameter_variations JSONB,

  -- Metadata
  confidence REAL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'discarded')),

  -- Approval tracking
  approved_at TIMESTAMPTZ,
  approved_analyte_id INT REFERENCES analytes(analyte_id),
  discarded_at TIMESTAMPTZ,
  discarded_reason TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()  -- ← ADD THIS
);

CREATE INDEX idx_pending_analytes_status ON pending_analytes(status);

COMMENT ON TABLE pending_analytes IS 'LLM-proposed NEW analytes awaiting admin review';
COMMENT ON COLUMN pending_analytes.evidence IS
  'Evidence structure: {report_id: UUID, result_id: UUID, parameter_name: string, unit: string, llm_comment: string, first_seen: ISO8601, last_seen: ISO8601, occurrence_count: int}';
COMMENT ON COLUMN pending_analytes.parameter_variations IS
  'Array of parameter variations: [{raw: string, normalized: string, lang: string, count: int}]';
COMMENT ON COLUMN pending_analytes.discarded_reason IS
  'Reason for discarding (e.g., "duplicate of CHOL", "not a lab analyte")';
```

#### `match_reviews`
```sql
CREATE TABLE IF NOT EXISTS match_reviews (
  review_id BIGSERIAL PRIMARY KEY,
  result_id UUID UNIQUE NOT NULL REFERENCES lab_results(id) ON DELETE CASCADE,  -- ← ADD UNIQUE

  -- New design: JSONB candidates array
  candidates JSONB NOT NULL,  -- ← ADD NOT NULL

  -- Metadata
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'resolved', 'skipped')),
  resolved_at TIMESTAMPTZ,  -- ← ADD for audit trail

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()  -- ← ADD for consistency
);

CREATE INDEX idx_match_reviews_status ON match_reviews(status);
CREATE INDEX idx_match_reviews_result_id ON match_reviews(result_id);

COMMENT ON TABLE match_reviews IS 'Ambiguous/medium-confidence matches awaiting admin disambiguation';
COMMENT ON COLUMN match_reviews.candidates IS
  'Array of candidate matches: [{analyte_id: int, analyte_code: string, analyte_name: string, similarity: float, source: string}]';
COMMENT ON COLUMN match_reviews.resolved_at IS
  'Timestamp when admin resolved this ambiguous match';
```

### New Indexes to Add

```sql
-- Admin audit queries (e.g., "show all actions on pending_analyte #123")
CREATE INDEX idx_admin_actions_entity
  ON admin_actions(entity_type, entity_id);

-- Language-specific alias searches (e.g., "show all Russian aliases")
CREATE INDEX idx_analyte_aliases_lang
  ON analyte_aliases(lang);
```

---

## 6. Risk Assessment

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Data loss | 100% | Low | User re-uploads (good test opportunity) |
| Schema migration error | Low | High | Schema.js already used on fresh installs |
| Code breaks after reset | Low | Medium | All fixes already in code, just enabling them |
| User effort to re-upload | 100% | Low | Only ~5 PDF files, takes 2 minutes |
| OCR regressions | Low | Medium | Updated prompt tested, user will validate |

### Rollback Plan

If something breaks after reset:
1. User has original PDF files (can re-upload anytime)
2. Can revert `schema.js` to old version from git
3. Drop DB and recreate with old schema
4. Total rollback time: < 5 minutes

---

## 7. Success Metrics

### Must Have (P0)
- ✅ No runtime errors on `updated_at = NOW()`
- ✅ No runtime errors on `ON CONFLICT (result_id)`
- ✅ All OCR uploads succeed
- ✅ Analyte mapping works (auto + admin review)
- ✅ SQL generation works (canonical grouping + LEFT JOIN)
- ✅ Plot rendering works (healthy ranges from desirable category)

### Nice to Have (P1)
- ✅ Schema is self-documenting (JSONB comments, table comments)
- ✅ All indexes in place for performance
- ✅ NOT NULL constraints prevent bad data
- ✅ CHECK constraints prevent status typos
- ✅ Language detection robust for mixed scripts

---

## 8. Timeline

**Total Estimated Time: 45 minutes**

| Phase | Task | Time |
|-------|------|------|
| 1 | Update application code (MappingApplier, admin routes) | 10 min |
| 2 | Update schema.js | 15 min |
| 3 | Drop & recreate DB | 2 min |
| 4 | Delete migrations folder | 1 min |
| 5 | Testing & validation | 15 min |

---

## 9. Decisions Made (Open Questions → Resolved)

### Q1: Do we need to keep `pending_analytes.aliases` column?
**Decision:** ✅ **DROP IT**
- Appears unused in current code
- `parameter_variations` serves same purpose
- Reduces confusion

### Q2: Should we add `resolved_at` to `match_reviews`?
**Decision:** ✅ **ADD IT**
- Useful for tracking when admin resolved ambiguous match
- Complements `created_at` for audit trail
- Minimal cost, high value

### Q3: Do we want to enforce status enums via CHECK constraints?
**Decision:** ✅ **YES**
- Prevents typos ("Pending" vs "pending")
- Self-documenting (shows allowed values)
- Better than application-level validation alone

**Status values:**
- `pending_analytes.status`: `pending`, `approved`, `discarded`
- `match_reviews.status`: `pending`, `resolved`, `skipped`

### Q4: Should `updated_at` be maintained automatically (trigger) or manually?
**Decision:** ✅ **MANUAL UPDATES**
- More explicit and easier to debug
- No hidden database triggers to maintain
- Postgres best practice for MVP
- Update paths:
  - `MappingApplier.queueForReview()` - Add `updated_at = NOW()` to ON CONFLICT
  - `admin.js resolve-match` - Add `resolved_at = NOW()`, `updated_at = NOW()`
  - `admin.js approve/discard` - Add `updated_at = NOW()` to pending_analytes

---

## 10. Files to Modify

### Modified Files
1. **server/db/schema.js** - Consolidate all schema changes
2. **server/services/MappingApplier.js** - Add `updated_at` to queueForReview upsert
3. **server/routes/admin.js** - Update resolve/approve/discard to populate timestamps
4. **README.md** - Add note about schema management

### Deleted Files
1. **migrations/005_add_mapping_write_mode_columns.sql**
2. **migrations/add_trigram_index.sql**
3. **migrations/** (entire folder)

---

## 11. Acceptance Criteria

**Definition of Done:**
- [ ] **Code updates complete:**
  - [ ] MappingApplier.js: `updated_at` added to queueForReview upsert
  - [ ] admin.js: resolve-match populates `resolved_at` and `updated_at`
  - [ ] admin.js: approve-analyte populates `updated_at`
  - [ ] admin.js: discard-analyte populates `updated_at`
- [ ] **Schema updates complete:**
  - [ ] Schema.js consolidated (no ALTER TABLE)
  - [ ] All missing columns added
  - [ ] Unused columns removed
  - [ ] Indexes and constraints in place
- [ ] **Database reset complete:**
  - [ ] Database dropped and recreated
  - [ ] Migrations folder deleted
  - [ ] README updated with schema management note
- [ ] **Testing complete:**
  - [ ] User re-uploads all lab reports successfully
  - [ ] No runtime errors during upload/mapping/query
  - [ ] Admin UI works (approve, discard, resolve)
  - [ ] Timestamps populate correctly (updated_at, resolved_at)
  - [ ] Plots render correctly with canonical names
  - [ ] Reference ranges show desirable category (not borderline)
  - [ ] Language detection works for mixed-script names

**Approved by:** User
**Implemented by:** Claude
**Target Date:** 2025-10-18

---

## 12. Appendix: Before/After Comparison

### Before (Current Schema Issues)

```sql
-- Fragmented definition
CREATE TABLE pending_analytes (pending_id BIGSERIAL PRIMARY KEY, ...);
ALTER TABLE pending_analytes ADD COLUMN parameter_variations JSONB;
ALTER TABLE pending_analytes ADD COLUMN updated_at TIMESTAMPTZ;  -- ❌ Missing!

-- Broken constraint
CREATE TABLE match_reviews (
  result_id UUID NOT NULL,  -- ❌ Not unique, ON CONFLICT fails!
  suggested_analyte_id INT,  -- Unused
  suggested_code TEXT,       -- Unused
  confidence REAL,           -- Unused
  rationale TEXT             -- Unused
);
```

### After (Clean Consolidated Schema)

```sql
-- Consolidated definition
CREATE TABLE pending_analytes (
  pending_id BIGSERIAL PRIMARY KEY,
  proposed_code TEXT UNIQUE NOT NULL,
  -- ... all columns in one place ...
  parameter_variations JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- ✅ Fixed!
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'discarded'))  -- ✅ Validated!
);

-- Fixed constraint + cleaned columns
CREATE TABLE match_reviews (
  result_id UUID UNIQUE NOT NULL,  -- ✅ Fixed! ON CONFLICT works
  candidates JSONB NOT NULL,       -- ✅ Only what's used
  resolved_at TIMESTAMPTZ,         -- ✅ Added for audit
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'resolved', 'skipped'))  -- ✅ Validated!
);
```

---

## 13. Post-Implementation Notes

**After completion, add notes here:**
- Actual time taken: _[TBD]_
- Issues encountered: _[TBD]_
- Number of PDFs re-uploaded: _[TBD]_
- OCR success rate: _[TBD]_

---

**End of PRD v2.5**
