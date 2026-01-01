# PRD v4.5: Remove Category Field from Analytes

**Status:** Draft
**Created:** 2025-12-28
**Target:** v4.5

---

## Overview

Remove the `category` field from the analytes data model.

**Rationale:**
- **Category field has no functional use**: Not used for filtering, business logic, or user-facing features
- **70% of analytes are uncategorized**: Field is largely unpopulated and unmaintainable
- **LLM has semantic understanding**: Chat agent doesn't need category metadata to group related tests
- **Maintenance burden**: Every new analyte requires categorization with unclear ROI

**Philosophy:** Keep the database schema simple and maintain only what provides clear value. Let LLM semantic understanding handle test grouping instead of maintaining a category taxonomy.

**Development Mode Simplification:**
- **No production users**: Application is in active development with test data only
- **No migration complexity**: Drop and recreate database instead of careful schema migrations
- **All changes in version control**: Schema changes go into `schema.js`, `seed_analytes.sql`, and setup scripts
- **Fresh start approach**: After implementation, run `./scripts/recreate_auth_db.sh && npm run dev` to get clean database
- **Zero downtime concern**: Can afford to reset database at any time during development

---

## Goals

1. **Remove category field** from database schema, code, and UI
2. **Clean up all code references** to category

---

## Current State Analysis

### Category Field Usage
```
Location                         | Usage
---------------------------------|----------------------------------------
analytes.category                | Database column (210 analytes)
pending_analytes.category        | Database column
MappingApplier.js:1136           | Defaults to 'uncategorized' (LLM doesn't provide)
admin.js:213,416                 | UI display (category badge)
admin.css:134                    | Styling for category badge
export_seed.js:104,134           | Groups analytes by category
routes/admin.js:125              | Passes category when approving analytes
```

**Distribution:**
- Categorized: 60 analytes (cardiac, liver, kidney, etc.)
- Uncategorized: 147 analytes (70%)
- Lab results: 63% mapped to uncategorized analytes

---

## Scope

### In Scope

1. **Database Schema Changes**
   - Drop `category` column from `analytes` table
   - Drop `category` column from `pending_analytes` table

2. **Code Changes - Remove Category References**
   - `server/services/MappingApplier.js`:
     - Remove `llm.category || 'uncategorized'` logic in `queueNewAnalyte()`
     - Remove `category` from SELECT in `getAnalyteSchema()` (approved analytes query)
     - Remove `category` from SELECT in `getAnalyteSchema()` (pending analytes query)
     - **Update JSDoc** for `getAnalyteSchema()` to remove `category` from `@returns` type
   - `public/admin.html`: Remove Category `<th>` header from pending analytes table
   - `public/js/admin.js`: Remove category badge rendering and category `<td>` column
   - `public/css/admin.css`: Remove `.category-badge` styles
   - `server/routes/admin.js`:
     - Remove category handling in approval flow
     - Remove `category` from SELECT in `/api/admin/pending-analytes` endpoint
   - `server/db/export_seed.js`: Remove category grouping logic
   - `server/db/schema.js`: Remove category column from table definitions

3. **Seed File Update**
   - Remove `category` column from all INSERT statements in `server/db/seed_analytes.sql`

### Out of Scope

- Unit normalization (separate PRD v4.6)
- UI changes beyond removing category badges
- Category-based filtering features

---

## Technical Design

### 1. Database Schema Changes

**File:** `server/db/schema.js`

**Changes:**
```javascript
// BEFORE
CREATE TABLE IF NOT EXISTS analytes (
  analyte_id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  unit_canonical TEXT,
  category TEXT,  // ← REMOVE
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pending_analytes (
  pending_id BIGSERIAL PRIMARY KEY,
  proposed_code TEXT UNIQUE NOT NULL,
  proposed_name TEXT NOT NULL,
  unit_canonical TEXT,
  category TEXT,  // ← REMOVE
  ...
);

// AFTER
CREATE TABLE IF NOT EXISTS analytes (
  analyte_id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  unit_canonical TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pending_analytes (
  pending_id BIGSERIAL PRIMARY KEY,
  proposed_code TEXT UNIQUE NOT NULL,
  proposed_name TEXT NOT NULL,
  unit_canonical TEXT,
  ...
);
```

### 2. Code Changes

#### A. MappingApplier.js

**Remove category handling in queueNewAnalyte() (Line ~1108-1140):**
```javascript
// BEFORE
await pool.query(
  `INSERT INTO pending_analytes
     (proposed_code, proposed_name, unit_canonical, category, ...)
   VALUES ($1, $2, $3, $4, ...)`,
  [
    llm.code,
    llm.name,
    unit,
    llm.category || 'uncategorized',  // ← REMOVE
    ...
  ]
);

// AFTER
await pool.query(
  `INSERT INTO pending_analytes
     (proposed_code, proposed_name, unit_canonical, ...)
   VALUES ($1, $2, $3, ...)`,
  [
    llm.code,
    llm.name,
    unit,
    ...
  ]
);
```

**Remove category from getAnalyteSchema() (Line ~260-280):**
```javascript
// BEFORE
const { rows: approved } = await pool.query(
  `SELECT code, name, category, 'approved' as status, NULL as pending_id
   FROM analytes ORDER BY code`
);
const { rows: pending } = await pool.query(
  `SELECT proposed_code AS code, proposed_name AS name, category, 'pending' as status, pending_id
   FROM pending_analytes WHERE status = 'pending' ORDER BY proposed_code`
);

// AFTER
const { rows: approved } = await pool.query(
  `SELECT code, name, 'approved' as status, NULL as pending_id
   FROM analytes ORDER BY code`
);
const { rows: pending } = await pool.query(
  `SELECT proposed_code AS code, proposed_name AS name, 'pending' as status, pending_id
   FROM pending_analytes WHERE status = 'pending' ORDER BY proposed_code`
);
```

#### B. Admin UI (admin.js)

**Remove category references in TWO locations:**

1. **Table row (Line ~213):** Remove category badge column
2. **Details modal (Line ~416):** Remove category from metadata section

```javascript
// BEFORE - Table row
<td><span class="category-badge">${escapeHtml(analyte.category || 'uncategorized')}</span></td>

// AFTER
// Remove entire <td> column
```

**Update table headers:**
```javascript
// BEFORE
<th>Proposed Code</th><th>Name</th><th>Category</th><th>Unit</th>

// AFTER
<th>Proposed Code</th><th>Name</th><th>Unit</th>
```

#### C. Admin Routes (routes/admin.js)

**Remove category from pending-analytes endpoint SELECT (~Line 51):**
```javascript
// BEFORE
const { rows } = await pool.query(
  `SELECT pending_id, proposed_code, proposed_name, unit_canonical, category, ...`
);

// AFTER
const { rows } = await pool.query(
  `SELECT pending_id, proposed_code, proposed_name, unit_canonical, ...`
);
```

**Remove category from approval flow (~Line 118-125):**
```javascript
// BEFORE
const { rows: newAnalyteRows } = await client.query(
  `INSERT INTO analytes (code, name, unit_canonical, category)
   VALUES ($1, $2, $3, $4) RETURNING analyte_id`,
  [pending.proposed_code, pending.proposed_name, pending.unit_canonical, pending.category || 'uncategorized']
);

// AFTER
const { rows: newAnalyteRows } = await client.query(
  `INSERT INTO analytes (code, name, unit_canonical)
   VALUES ($1, $2, $3) RETURNING analyte_id`,
  [pending.proposed_code, pending.proposed_name, pending.unit_canonical]
);
```

#### D. Seed Export (db/export_seed.js)

**Remove category grouping (~Line 104, 134):**
```javascript
// BEFORE
const cat = a.category || 'other';
// ... grouping logic by category

// AFTER
// Flat list, no grouping
const lines = [];
allAnalytes.forEach((a, i) => {
  const comma = (i < allAnalytes.length - 1) ? ',' : ';';
  lines.push(`  ('${a.code}', '${a.name}', '${a.unit_canonical || ''}')${comma}`);
});
```

### 3. Seed File Update

**File:** `server/db/seed_analytes.sql`

```sql
-- BEFORE
INSERT INTO analytes (code, name, unit_canonical, category) VALUES
  ('HCT', 'Hematocrit', '%', 'hematology'),
  ('ADRENALINE', 'Adrenaline (Epinephrine)', 'пг/мл', 'uncategorized'),
  ...

-- AFTER (no category column)
INSERT INTO analytes (code, name, unit_canonical) VALUES
  ('HCT', 'Hematocrit', '%'),
  ('ADRENALINE', 'Adrenaline (Epinephrine)', 'пг/мл'),
  ...
```

---

## Testing & Validation

### Manual QA Checklist

1. **Database Schema**
   - [ ] `category` column dropped from `analytes`
   - [ ] `category` column dropped from `pending_analytes`
   - [ ] Existing analytes still queryable

2. **Seed File**
   - [ ] No category column in INSERT statements
   - [ ] File loads without SQL errors

3. **Admin UI**
   - [ ] Pending analytes table shows code, name, unit (no category badge)
   - [ ] Approval flow works without category field

4. **No Regressions**
   - [ ] Lab report processing still works
   - [ ] Analyte mapping (exact/fuzzy/LLM) still works
   - [ ] Chat SQL generation still works

---

## Acceptance Criteria

1. ✅ `category` column removed from `analytes` and `pending_analytes` tables
2. ✅ All code references to `category` removed:
   - `MappingApplier.js`: `queueNewAnalyte()` and `getAnalyteSchema()` (including JSDoc update)
   - `admin.html`: Category `<th>` header removed from pending analytes table
   - `admin.js`: category badge and `<td>` column rendering removed
   - `routes/admin.js`: pending-analytes SELECT and approval INSERT
   - `export_seed.js`: grouping logic
3. ✅ Seed file updated to remove category column
4. ✅ Admin UI displays pending analytes without category badges
5. ✅ No regressions in lab report processing, mapping, or chat functionality

---

## Rollout Plan

### Phase 1: Update Schema & Code Files

1. **Update `server/db/schema.js`**
   - Remove `category` column from `analytes` table definition
   - Remove `category` column from `pending_analytes` table definition

2. **Update `server/db/seed_analytes.sql`**
   - Remove `category` from INSERT statements

3. **Update Code**
   - `server/services/MappingApplier.js`: Remove category handling
   - `public/js/admin.js`: Remove category badge rendering
   - `public/css/admin.css`: Remove `.category-badge` styles
   - `server/routes/admin.js`: Remove category from queries
   - `server/db/export_seed.js`: Remove category grouping

### Phase 2: Database Recreation

```bash
# Stop application
lsof -ti:3000 | xargs kill -9

# Drop and recreate database with new schema
./scripts/recreate_auth_db.sh

# Start application
npm run dev
```

### Phase 3: Validation

1. **Verify Schema**
   ```sql
   \d analytes  -- Should NOT have category column
   \d pending_analytes  -- Should NOT have category column
   ```

2. **Manual QA**
   - [ ] Admin panel shows pending analytes without category
   - [ ] Approve pending analyte successfully
   - [ ] All core workflows work (upload, mapping, chat)

---

## Risks & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking admin UI | Cannot approve new analytes | Test approval flow before committing |
| Lost test data | Need to re-upload lab reports | Acceptable - dev mode only |

---

## References

- PRD v2.4: Analyte Mapping Write Mode
- PRD v4.6: Normalize Canonical Units (separate document)
