# PRD v2.4 — Analyte Mapping Write Mode + Admin Review UI

## 🎯 Goal
Enable the Mapping Applier to **write `analyte_id`** to the database (instead of dry-run logging only) and provide an **admin UI** to review and approve LLM-proposed NEW analytes.

**User Story:**
> As a lab report uploader, I want my cholesterol test variations (`"ЛПВП-холестерин (HDL)"`, `"Холестерин-ЛПВП"`) to be automatically normalized to canonical analyte codes so that plot queries group them correctly without duplicates.

> As an admin, I want to review LLM-proposed NEW analytes (e.g., `"Интерлейкин-6"` → proposed code `"IL6"`) and approve/discard them so the system learns from real data.

---

## 📋 Prerequisites

### Schema Ready ✅
- `analytes` table with 60 canonical tests (from PRD v0.8)
- `analyte_aliases` table with 200+ multilingual aliases
- `lab_results.analyte_id` column (nullable)
- `pending_analytes` table for NEW analyte queue
- `pg_trgm` extension installed

### Current State
- **422 lab_results rows** with `analyte_id = NULL`
- **160 unique parameter names** in data
- **Mapping Applier in DRY-RUN mode** (`ENABLE_MAPPING_DRY_RUN=true`)
  - Logs decisions but **doesn't write to DB**
- **Challenge:** Plot queries show duplicates (e.g., `"ЛПВП-холестерин (HDL)"` and `"Холестерин-ЛПВП"` as separate items)

### Dependencies
- PRD v0.8 (Schema Refactor)
- PRD v0.9 (Mapping Applier Dry-Run)
- PRD v0.9.1 (LLM Tier C)
- PRD v2.3 (Single-Analyte Plot UI with parameter selector)

---

## 🧩 Scope

### In-Scope
1. **Backend: Enable Write Mode**
   - Add `wetRun()` function to MappingApplier
   - Write `analyte_id` for high-confidence matches (MATCH_EXACT, MATCH_FUZZY, MATCH_LLM)
   - Queue NEW analytes to `pending_analytes` table
   - Add configuration flag: `ENABLE_MAPPING_WRITE=true`

2. **Backend: Backfill Existing Data**
   - Script to populate `analyte_id` for existing 422 lab_results rows
   - Re-run mapping logic on historical data

3. **Frontend: Admin Review Page**
   - New page: `/admin/pending-analytes`
   - Link from main page (`/`) to admin page
   - Table showing pending analytes with metadata
   - Approve/Discard actions per row
   - Navigation back to main page

4. **Backend: Admin Actions API**
   - `POST /api/admin/approve-analyte` — Approve and promote to canonical
   - `POST /api/admin/discard-analyte` — Remove from queue
   - Approval triggers backfill for that analyte

### Out-of-Scope
- Authentication/authorization (admin access control) — assume open access for v2.4
- Bulk approve/discard operations
- Editing proposed analyte details before approval
- Audit log for admin actions (future PRD)
- Analytics dashboard for mapping coverage

---

## ⚙️ Functional Requirements

### 1️⃣ Backend: Enable Write Mode

#### 1.1 Add `wetRun()` Function

**Location:** `server/services/MappingApplier.js`

**Signature:**
```javascript
/**
 * Apply analyte mapping with database writes
 * @param {Object} params
 * @param {string} params.reportId - UUID of patient_report
 * @param {string} params.patientId - UUID of patient
 * @param {Array} params.parameters - Lab result rows
 * @returns {Promise<Object>} - Mapping decisions + write results
 */
async function wetRun({ reportId, patientId, parameters })
```

**Logic:**
1. Call existing `dryRun()` to get mapping decisions
2. For each row decision:
   - **MATCH_EXACT**, **MATCH_FUZZY**, **MATCH_LLM**:
     - Write `analyte_id` to `lab_results` table
     - Log success
   - **NEW_LLM**:
     - Insert to `pending_analytes` table (with `ON CONFLICT DO NOTHING`)
     - Log queued for review
   - **AMBIGUOUS_FUZZY**, **ABSTAIN_LLM**, **UNMAPPED**:
     - Leave `analyte_id = NULL`
     - Log skipped
3. Return summary with counters:
   - `written`: count of analyte_id writes
   - `queued`: count of NEW analytes queued
   - `skipped`: count of unmatched rows

**SQL for Write:**
```sql
UPDATE lab_results
SET analyte_id = $1,
    mapping_confidence = $2,
    mapped_at = NOW()
WHERE id = $3
  AND analyte_id IS NULL;  -- Only write if not already set (prevents overwriting curated data)
```

**Why the guard clause:**
- Prevents overwriting manually curated `analyte_id` values
- Prevents race conditions when backfill script runs concurrently with uploads
- Returns 0 rows if already mapped (which is expected and safe)

**SQL for Queue:**
```sql
INSERT INTO pending_analytes
  (proposed_code, proposed_name, unit_canonical, category, confidence, evidence, status, parameter_variations)
VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
ON CONFLICT (proposed_code) DO UPDATE SET
  confidence = GREATEST(pending_analytes.confidence, EXCLUDED.confidence),
  evidence = pending_analytes.evidence || EXCLUDED.evidence,  -- Merge evidence
  parameter_variations = pending_analytes.parameter_variations || EXCLUDED.parameter_variations;  -- Collect all variations
```

**Why merge on conflict:**
- Same analyte might be proposed multiple times with different variations
- Higher confidence score wins
- Collect all raw parameter name variations for alias seeding

**Evidence JSON format:**
```json
{
  "report_id": "uuid",
  "parameter_name": "Интерлейкин-6",
  "unit": "pg/mL",
  "llm_comment": "Cytokine marker, not in schema",
  "first_seen": "2025-10-17T14:00:00Z",
  "occurrence_count": 1
}
```

**Parameter Variations JSONB Array:**
```json
[
  {"raw": "Интерлейкин-6", "normalized": "интерлейкин 6", "lang": "ru", "count": 3},
  {"raw": "IL-6", "normalized": "il 6", "lang": "en", "count": 2},
  {"raw": "Interleukin-6", "normalized": "interleukin 6", "lang": "en", "count": 1}
]
```

#### 1.2 Confidence Thresholds

**Configuration:**
```bash
MAPPING_AUTO_ACCEPT=0.80      # Auto-write analyte_id if confidence ≥ 0.80
MAPPING_QUEUE_LOWER=0.60      # Queue for review if 0.60 ≤ confidence < 0.80
```

**Decision Matrix:**

| Decision Type | Confidence | Action | Rationale |
|---------------|------------|--------|-----------|
| MATCH_EXACT | 1.0 | ✅ Write immediately | Deterministic, no ambiguity |
| MATCH_FUZZY | ≥ 0.80 | ✅ Write immediately | High similarity, auto-accept |
| MATCH_FUZZY | 0.60-0.79 | ⏳ Queue for review | Medium confidence, needs human validation |
| MATCH_FUZZY | < 0.60 | ❌ Skip (leave NULL) | Too low, likely false positive |
| MATCH_LLM | ≥ 0.80 | ✅ Write immediately | LLM confident match |
| MATCH_LLM | 0.60-0.79 | ⏳ Queue for review | LLM uncertain, needs review |
| NEW_LLM | Any | ⏳ Always queue | Never auto-approve new analytes |
| AMBIGUOUS_FUZZY | Any | ⏳ Queue for review | Multiple candidates, human choice needed |
| UNMAPPED | 0.0 | ❌ Skip | No match found |

**Implementation:**
```javascript
async function wetRun({ reportId, patientId, parameters }) {
  const decisions = await dryRun({ reportId, patientId, parameters });

  for (const row of decisions.rows) {
    const { final_decision, confidence, final_analyte } = row;

    // High confidence matches → Write immediately
    if ((final_decision === 'MATCH_EXACT') ||
        (final_decision === 'MATCH_FUZZY' && confidence >= MAPPING_AUTO_ACCEPT) ||
        (final_decision === 'MATCH_LLM' && confidence >= MAPPING_AUTO_ACCEPT)) {
      await writeAnalyteId(row.row_id, final_analyte.analyte_id, confidence);
      counters.written++;
    }

    // Medium confidence → Queue for review
    else if ((final_decision === 'MATCH_FUZZY' && confidence >= MAPPING_QUEUE_LOWER) ||
             (final_decision === 'MATCH_LLM' && confidence >= MAPPING_QUEUE_LOWER) ||
             (final_decision === 'AMBIGUOUS_FUZZY')) {
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

  return { summary: counters };
}
```

#### 1.3 Update Route Integration

**Location:** `server/routes/analyzeLabReport.js`

**Change:**
```javascript
// OLD (line 766-770):
if (process.env.ENABLE_MAPPING_DRY_RUN === 'true') {
  const { dryRun } = require('../services/MappingApplier');
  await dryRun({ reportId, patientId, parameters });
}

// NEW:
if (process.env.ENABLE_MAPPING_WRITE === 'true') {
  const { wetRun } = require('../services/MappingApplier');
  const mappingResult = await wetRun({ reportId, patientId, parameters });
  logger.info({
    report_id: reportId,
    written: mappingResult.summary.written,
    queued: mappingResult.summary.queued
  }, '[mapping] Write mode completed');
}
```

#### 1.3 Environment Configuration

**Location:** `.env`

**Add:**
```bash
# Mapping Applier Write Mode (v2.4)
ENABLE_MAPPING_WRITE=true           # Enable database writes (replaces ENABLE_MAPPING_DRY_RUN)
MAPPING_AUTO_ACCEPT=0.80             # Confidence threshold for auto-write
```

**Migration note:** `ENABLE_MAPPING_DRY_RUN` is deprecated in v2.4.

---

### 2️⃣ Backend: Backfill Existing Data

#### 2.1 Backfill Script

**Location:** `scripts/backfill_analyte_mappings.js`

**Purpose:** Populate `analyte_id` for existing 422 lab_results rows

**Algorithm:**
1. Fetch all `lab_results` where `analyte_id IS NULL`
2. Group by `report_id`
3. For each report:
   - Extract `parameter_name`, `unit`, `reference_full_text` per row
   - Call `wetRun()` to get decisions
   - Write `analyte_id` for matched rows
   - Queue NEW analytes
4. Log summary:
   - Total rows processed
   - Matched count (analyte_id written)
   - Queued count (NEW analytes)
   - Unmapped count

**Usage:**
```bash
node scripts/backfill_analyte_mappings.js
```

**Output:**
```
[backfill] Processing 422 lab_results across 15 reports...
[backfill] Report 1/15: 28 rows → 25 matched, 2 NEW, 1 unmapped
[backfill] Report 2/15: 30 rows → 28 matched, 1 NEW, 1 unmapped
...
[backfill] ✅ Complete: 380 matched, 30 NEW, 12 unmapped
```

---

### 3️⃣ Frontend: Admin Review Page

#### 3.1 Page Structure

**Route:** `/admin/pending-analytes`

**HTML:** `public/admin.html` (new file)

**Layout:**
```
┌──────────────────────────────────────────────┐
│  HealthUp — Admin Review Panel               │
│  [← Back to Main]                            │
├──────────────────────────────────────────────┤
│  📋 Tab 1: New Analytes (3)                  │  ← Default tab
│  ❓ Tab 2: Ambiguous Matches (2)             │
│                                              │
│  ┌─── Tab 1: New Analytes ─────────────────┐│
│  │ Proposed Code │ Name        │ Actions   ││
│  ├────────────────────────────────────────┤ │
│  │ IL6           │ Interleukin-6│ ✅ ❌    ││
│  │ CRP_HS        │ hs-CRP       │ ✅ ❌    ││
│  │ D_DIMER       │ D-Dimer      │ ✅ ❌    ││
│  └────────────────────────────────────────┘ │
│                                              │
│  ┌─── Tab 2: Ambiguous Matches ────────────┐│
│  │ Parameter       │ Candidates  │ Actions ││
│  ├────────────────────────────────────────┤ │
│  │ Ферритин С      │ FER vs FER_S│ Choose ││
│  │ Glucose Fasting │ GLU vs GLU_F│ Choose ││
│  └────────────────────────────────────────┘ │
│                                              │
│  Expandable details: Confidence, Evidence    │
│                                              │
└──────────────────────────────────────────────┘
```

**Two-Tab Design:**
- **Tab 1:** Pending NEW Analytes (approve/discard)
- **Tab 2:** Ambiguous Matches (choose between existing analytes)

#### 3.2 Data Table

**Columns:**
1. **Proposed Code** (e.g., `IL6`)
2. **Proposed Name** (e.g., `Interleukin-6`)
3. **Category** (e.g., `inflammation`)
4. **Unit** (e.g., `pg/mL`)
5. **Confidence** (e.g., `0.95`)
6. **Variations** (count of unique raw parameter names)
7. **First Seen** (timestamp)
8. **Actions** (Approve / Discard buttons)

**Expandable Row Details:**
- **Parameter Variations:** List of all raw forms with language and occurrence count:
  - `Интерлейкин-6` (Russian, 3 occurrences)
  - `IL-6` (English, 2 occurrences)
  - `Interleukin-6` (English, 1 occurrence)
- **Evidence JSON:** Shows which reports contain this parameter
- **LLM Comment:** Reason for NEW proposal
- **Aliases that will be created:** Preview of normalized forms

**Empty State:**
```
✅ All caught up! No pending analytes to review.
```

#### 3.3 Navigation

**Main Page Link:**

**Location:** `public/index.html`

Add after `<h1>Upload Analysis</h1>`:
```html
<nav class="admin-nav">
  <a href="/admin/pending-analytes" class="admin-link">
    📋 Review Pending Analytes
  </a>
</nav>
```

**Admin Page Link Back:**

**Location:** `public/admin.html`

Add in header:
```html
<nav class="breadcrumb">
  <a href="/">← Back to Main</a>
</nav>
```

---

### 4️⃣ Backend: Admin Actions API

#### 4.1 Approve Analyte

**Endpoint:** `POST /api/admin/approve-analyte`

**Request Body:**
```json
{
  "pending_id": 123
}
```

**Logic:**
1. Fetch pending analyte by `pending_id`
2. **Transaction BEGIN:**
   - Insert into `analytes` table:
     ```sql
     INSERT INTO analytes (code, name, unit_canonical, category)
     VALUES (
       $proposed_code,
       $proposed_name,
       $unit_canonical,
       COALESCE($category, 'uncategorized')  -- ✅ Preserve LLM-suggested category
     )
     RETURNING analyte_id;
     ```
   - **Insert aliases from parameter variations:**
     ```sql
     -- For each variation in parameter_variations JSONB array:
     INSERT INTO analyte_aliases (analyte_id, alias, alias_display, lang, confidence, source)
     VALUES ($analyte_id, $normalized, $raw, $detected_lang, 1.0, 'evidence_auto');
     ```

     **Language Detection Helper:**
     ```javascript
     function detectLanguage(text) {
       if (/[\u0400-\u04FF]/.test(text)) return 'ru';  // Cyrillic
       if (/[\u0590-\u05FF]/.test(text)) return 'he';  // Hebrew
       if (/[\u0600-\u06FF]/.test(text)) return 'ar';  // Arabic
       if (/[\u4E00-\u9FFF]/.test(text)) return 'zh';  // Chinese
       return 'en';  // Default/Latin
     }
     ```

     **Example:** If `parameter_variations` contains:
     ```json
     [
       {"raw": "Интерлейкин-6", "normalized": "интерлейкин 6", "count": 3},
       {"raw": "IL-6", "normalized": "il 6", "count": 2}
     ]
     ```
     Create 2 aliases:
     - `alias="интерлейкин 6"`, `alias_display="Интерлейкин-6"`, `lang="ru"`
     - `alias="il 6"`, `alias_display="IL-6"`, `lang="en"`
   - Update `pending_analytes` status:
     ```sql
     UPDATE pending_analytes
     SET status = 'approved',
         approved_at = NOW(),
         approved_analyte_id = $analyte_id
     WHERE pending_id = $pending_id;
     ```
   - **Backfill:** Update matching lab_results using created aliases:
     ```sql
     -- Match any lab_results whose normalized parameter_name matches new aliases
     UPDATE lab_results lr
     SET analyte_id = $analyte_id,
         mapping_confidence = 0.95,
         mapped_at = NOW()
     WHERE lr.analyte_id IS NULL
       AND EXISTS (
         SELECT 1 FROM analyte_aliases aa
         WHERE aa.analyte_id = $analyte_id
           AND aa.alias = LOWER(TRIM(lr.parameter_name))
       );
     ```
     **Why this approach:**
     - Matches all variations captured in parameter_variations
     - Uses normalized form for matching
     - Only updates unmapped rows (respects manual curation)
3. **Transaction COMMIT**
4. Return success with affected row count

**Response:**
```json
{
  "success": true,
  "analyte_id": 61,
  "backfilled_rows": 3,
  "message": "Analyte 'IL6' approved and 3 lab results updated"
}
```

**Error Handling:**
- Duplicate code → 409 Conflict
- Database error → 500 Internal Server Error

#### 4.2 Discard Analyte

**Endpoint:** `POST /api/admin/discard-analyte`

**Request Body:**
```json
{
  "pending_id": 124,
  "reason": "Duplicate of existing analyte XYZ"  // Optional
}
```

**Logic:**
1. **Mark as discarded** (don't delete):
   ```sql
   UPDATE pending_analytes
   SET status = 'discarded',
       discarded_at = NOW(),
       discarded_reason = $reason
   WHERE pending_id = $pending_id
   RETURNING proposed_code;
   ```
2. Log discard action to audit table
3. Return success

**Why not delete:**
- ✅ Prevents infinite loop (same bad suggestion keeps coming back)
- ✅ Maintains audit trail for analysis
- ✅ Can analyze most-rejected analytes to improve LLM prompts
- ✅ Can later "un-discard" if admin changes mind

**Future query to prevent re-proposing:**
```sql
-- In wetRun(), check before queuing NEW:
SELECT status FROM pending_analytes
WHERE proposed_code = $code;

-- If status='discarded' → Don't queue again
```

**Response:**
```json
{
  "success": true,
  "message": "Proposed analyte 'CRP_HS' discarded"
}
```

#### 4.3 Resolve Ambiguous Match

**Endpoint:** `POST /api/admin/resolve-match`

**Request Body:**
```json
{
  "review_id": 789,
  "chosen_analyte_id": 12,
  "create_alias": true  // Optional: create alias to prevent future ambiguity
}
```

**Logic:**
1. Fetch match review by `review_id`
2. **Transaction BEGIN:**
   - Update lab_results:
     ```sql
     UPDATE lab_results
     SET analyte_id = $chosen_analyte_id,
         mapping_confidence = $candidate_similarity,
         mapping_source = 'manual_resolved',
         mapped_at = NOW()
     WHERE id = $result_id
       AND analyte_id IS NULL;  -- Guard clause
     ```
   - If `create_alias = true`:
     ```sql
     INSERT INTO analyte_aliases (analyte_id, alias, alias_display, lang, source)
     VALUES (
       $chosen_analyte_id,
       LOWER(TRIM($raw_parameter_name)),
       $raw_parameter_name,
       detectLanguage($raw_parameter_name),
       'manual_disambiguation'
     )
     ON CONFLICT (analyte_id, alias) DO NOTHING;
     ```
   - Update match_reviews status:
     ```sql
     UPDATE match_reviews
     SET status = 'resolved',
         resolved_at = NOW(),
         suggested_analyte_id = $chosen_analyte_id
     WHERE review_id = $review_id;
     ```
3. **Transaction COMMIT**
4. Log to audit table

**Response:**
```json
{
  "success": true,
  "result_id": "uuid",
  "chosen_analyte": {"id": 12, "code": "FER", "name": "Ferritin"},
  "alias_created": true
}
```

#### 4.4 Fetch Ambiguous Matches

**Endpoint:** `GET /api/admin/ambiguous-matches`

**Query Params:**
- `status` (optional): `pending` (default), `resolved`, `all`

**Response:**
```json
{
  "ambiguous": [
    {
      "review_id": 789,
      "result_id": "uuid",
      "raw_parameter_name": "Ферритин С",
      "unit": "ng/mL",
      "candidates": [
        {
          "analyte_id": 12,
          "code": "FER",
          "name": "Ferritin",
          "similarity": 0.82,
          "alias": "ферритин"
        },
        {
          "analyte_id": 45,
          "code": "FER_S",
          "name": "Ferritin Serum",
          "similarity": 0.81,
          "alias": "ферритин с"
        }
      ],
      "created_at": "2025-10-17T14:00:00Z"
    }
  ]
}
```

#### 4.5 Fetch Pending Analytes

**Endpoint:** `GET /api/admin/pending-analytes`

**Query Params:**
- `status` (optional): `pending` (default), `approved`, `discarded`, `all`

**Response:**
```json
{
  "pending": [
    {
      "pending_id": 123,
      "proposed_code": "IL6",
      "proposed_name": "Interleukin-6",
      "unit_canonical": "pg/mL",
      "category": "inflammation",
      "confidence": 0.95,
      "evidence": {
        "report_id": "uuid",
        "parameter_name": "Интерлейкин-6",
        "llm_comment": "Cytokine marker"
      },
      "parameter_variations": [
        {"raw": "Интерлейкин-6", "normalized": "интерлейкин 6", "lang": "ru", "count": 3},
        {"raw": "IL-6", "normalized": "il 6", "lang": "en", "count": 2}
      ],
      "created_at": "2025-10-17T14:00:00Z"
    }
  ]
}
```

---

### 5️⃣ Frontend: Admin Page Implementation

#### 5.1 HTML Structure

**File:** `public/admin.html`

**Key Elements:**
- Table container: `<div id="pending-table">`
- Empty state: `<div id="empty-state" hidden>`
- Loading state: `<div id="loading-state">`
- Toast notifications: `<div id="toast-container">`

#### 5.2 JavaScript Logic

**File:** `public/js/admin.js`

**Functions:**
1. `fetchPendingAnalytes()` — GET /api/admin/pending-analytes
2. `renderTable(data)` — Build table HTML
3. `handleApprove(pending_id)` — POST approve, refresh table
4. `handleDiscard(pending_id)` — POST discard, refresh table
5. `showToast(message, type)` — Success/error notifications

**Event Handlers:**
- Click "Approve" → Confirm dialog → API call → Refresh
- Click "Discard" → Confirm dialog → API call → Refresh

#### 5.3 Styling

**File:** `public/css/admin.css` (new file)

**Design:**
- Reuse existing `style.css` variables (colors, fonts)
- Table: Zebra striping, hover effects
- Buttons: Green for approve, red for discard
- Responsive: Mobile-friendly table (horizontal scroll)

---

## 🗄️ Schema Changes

### Required Migrations

#### 1. Add columns to `lab_results`
```sql
ALTER TABLE lab_results
ADD COLUMN IF NOT EXISTS mapping_confidence REAL,
ADD COLUMN IF NOT EXISTS mapped_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS mapping_source TEXT;  -- 'auto_exact', 'auto_fuzzy', 'auto_llm', 'manual'

CREATE INDEX IF NOT EXISTS idx_lab_results_mapping_source
  ON lab_results (mapping_source);
```

**Purpose:**
- Track confidence level of each mapping for future validation
- Know when mapping occurred (for debugging)
- Distinguish auto-mapped vs manually curated (protects manual work)

#### 2. Add columns to `analyte_aliases`
```sql
ALTER TABLE analyte_aliases
ADD COLUMN IF NOT EXISTS alias_display TEXT;  -- Original form: "Интерлейкин-6"

COMMENT ON COLUMN analyte_aliases.alias IS
  'Normalized lowercase form for matching (e.g., "интерлейкин 6")';
COMMENT ON COLUMN analyte_aliases.alias_display IS
  'Original display form with proper casing and punctuation';
```

**Purpose:**
- Preserve original form for UI display
- Normalized form for matching

#### 3. Add columns to `pending_analytes`
```sql
ALTER TABLE pending_analytes
ADD COLUMN IF NOT EXISTS parameter_variations JSONB,
ADD COLUMN IF NOT EXISTS discarded_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS discarded_reason TEXT,
ADD COLUMN IF NOT EXISTS approved_analyte_id INT REFERENCES analytes(analyte_id);

CREATE INDEX IF NOT EXISTS idx_pending_analytes_status
  ON pending_analytes (status);
```

**Purpose:**
- Store all raw parameter name variations for alias seeding
- Track discarded items to prevent re-proposing
- Link back to approved analyte for audit trail

#### 4. Enhance `match_reviews` table for ambiguous matches
```sql
-- Extend existing match_reviews table
ALTER TABLE match_reviews
ADD COLUMN IF NOT EXISTS candidates JSONB;  -- Array of candidate matches

-- Example candidates structure:
-- [
--   {"analyte_id": 12, "code": "FER", "name": "Ferritin", "similarity": 0.82, "alias": "ферритин"},
--   {"analyte_id": 45, "code": "FER_S", "name": "Ferritin Serum", "similarity": 0.81, "alias": "ферритин с"}
-- ]

CREATE INDEX IF NOT EXISTS idx_match_reviews_status
  ON match_reviews (status);
CREATE INDEX IF NOT EXISTS idx_match_reviews_result_id
  ON match_reviews (result_id);
```

**Purpose:**
- Queue AMBIGUOUS_FUZZY matches (choice between existing analytes)
- Store all candidates with their similarity scores
- Admin chooses the correct analyte
- Separate from `pending_analytes` (which is for NEW analytes only)

**Workflow for AMBIGUOUS_FUZZY:**
1. `wetRun()` detects ambiguous match
2. Insert to `match_reviews` with all candidates
3. Admin UI shows: "Choose correct match for 'Ферритин С'"
   - Option A: Ferritin (82% similar)
   - Option B: Ferritin Serum (81% similar)
4. Admin selects → UPDATE lab_results SET analyte_id = chosen
5. Optionally: Create new alias to resolve future ambiguity

#### 5. Create admin audit log table
```sql
CREATE TABLE IF NOT EXISTS admin_actions (
  action_id BIGSERIAL PRIMARY KEY,
  action_type TEXT NOT NULL,  -- 'approve_analyte', 'discard_analyte', 'edit_alias', 'manual_map'
  entity_type TEXT,           -- 'pending_analyte', 'analyte', 'alias', 'lab_result'
  entity_id BIGINT,
  admin_user TEXT,            -- Future: link to users table
  changes JSONB,              -- Before/after state
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_actions_created_at
  ON admin_actions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_actions_action_type
  ON admin_actions (action_type);
```

**Purpose:**
- Full audit trail for compliance
- Debug issues ("who approved this bad analyte?")
- Analytics (most common admin actions)

**Example audit log entry:**
```json
{
  "action_type": "approve_analyte",
  "entity_type": "pending_analyte",
  "entity_id": 123,
  "changes": {
    "pending_status": "pending → approved",
    "created_analyte": {
      "analyte_id": 61,
      "code": "IL6",
      "name": "Interleukin-6"
    },
    "created_aliases": 2,
    "backfilled_rows": 3
  },
  "admin_user": "admin@example.com",  // Future
  "ip_address": "192.168.1.1",
  "created_at": "2025-10-17T14:00:00Z"
}
```

---

## 🔒 Non-Functional Requirements

### Performance
- **Backfill script:** Process 422 rows in <10 seconds
- **Admin page load:** <500ms (small dataset)
- **Approve action:** <2 seconds (includes backfill)

### Data Integrity
- Use database transactions for approve action
- ON CONFLICT handling for duplicate codes
- Foreign key constraints preserved

### Logging
- Log all wetRun() operations (written, queued, skipped)
- Log all admin actions (approve, discard) with timestamp
- Use Pino structured logging

### Security
- **MVP Mode:** No authentication implemented for v2.4
- Admin pages are publicly accessible (assume trusted network or manual access control)
- Deferred to future PRD: authentication, authorization, rate limiting

---

## 📊 Success Metrics

### Before v2.4 (Current State)
- ❌ 422 lab_results with `analyte_id = NULL`
- ❌ Plot queries show 8 cholesterol variations as separate items
- ❌ 0 pending analytes queued

### After v2.4 (Target)
- ✅ ~90% of 422 lab_results have `analyte_id` populated
- ✅ Plot queries show 3 cholesterol groups (Total, HDL, LDL)
- ✅ ~10-20 NEW analytes queued for review
- ✅ Admin can approve/discard in <30 seconds

---

## 🧪 Testing Strategy

### Unit Tests
- `wetRun()` function:
  - ✅ Writes analyte_id for MATCH_EXACT
  - ✅ Queues NEW_LLM to pending_analytes
  - ✅ Skips UNMAPPED rows
- Approve API:
  - ✅ Creates analyte + alias
  - ✅ Backfills lab_results
  - ✅ Handles duplicate codes

### Integration Tests
- Upload new report → wetRun() → analyte_id written
- Backfill script → 422 rows processed
- Admin approve → analyte created → lab_results updated

### Manual Testing
1. Upload report with known parameter (`"Холестерин"`) → analyte_id = 23
2. Upload report with NEW parameter (`"Интерлейкин-6"`) → pending_analytes row created
3. Admin page → See pending IL6
4. Approve IL6 → analyte created, lab_results backfilled
5. Re-run plot query → cholesterol grouped correctly

---

## 📝 Implementation Checklist

### Phase 1: Backend Write Mode
- [ ] Implement `wetRun()` in MappingApplier.js
- [ ] Add `ENABLE_MAPPING_WRITE` env flag
- [ ] Update analyzeLabReport.js route
- [ ] Test with single upload (verify analyte_id written)

### Phase 2: Backfill Script
- [ ] Create `scripts/backfill_analyte_mappings.js`
- [ ] Test on dev database (422 rows)
- [ ] Run on production
- [ ] Verify plot queries group correctly

### Phase 3: Admin API
- [ ] Implement `GET /api/admin/pending-analytes`
- [ ] Implement `POST /api/admin/approve-analyte`
- [ ] Implement `POST /api/admin/discard-analyte`
- [ ] Test with mock data

### Phase 4: Admin UI
- [ ] Create `public/admin.html`
- [ ] Create `public/js/admin.js`
- [ ] Create `public/css/admin.css`
- [ ] Add navigation link from main page
- [ ] Test approve/discard flows

### Phase 5: Integration Testing
- [ ] Upload → mapping → admin review → approve → backfill (full flow)
- [ ] Verify plot UI shows grouped parameters
- [ ] Check logs for errors

---

## 🚀 Deployment Plan

### Step 1: Deploy Backend (No Breaking Changes)
- Add `wetRun()` function (not called yet)
- Add admin API routes
- **Safe:** Existing uploads still work

### Step 2: Deploy Frontend
- Add admin.html + admin.js + admin.css
- Add navigation link
- **Safe:** Main page unchanged

### Step 3: Enable Write Mode
- Set `ENABLE_MAPPING_WRITE=true`
- **Breaking:** New uploads now write analyte_id

### Step 4: Run Backfill
- Execute `node scripts/backfill_analyte_mappings.js`
- **Result:** Historical data normalized

### Step 5: Monitor
- Check logs for wetRun() success rate
- Review pending_analytes queue
- Test plot queries

---

## 🔮 Future Enhancements (Out of Scope for v2.4)

### PRD v2.5: Admin Authentication
- Add login/logout for admin page
- Role-based access control
- Audit log for approve/discard actions

### PRD v2.6: Bulk Operations
- Bulk approve similar analytes
- Bulk discard by category
- Import/export analyte catalog

### PRD v2.7: Smart Alias Generation
- When approving NEW analyte, LLM suggests 5-10 aliases
- Admin can edit before approval
- Multi-language alias coverage

### PRD v3.0: Auto-Approval for High Confidence
- If LLM confidence > 0.95, auto-approve NEW analytes
- Human review only for confidence 0.70-0.95
- Email digest of auto-approved analytes

---

## 📚 References

- **PRD v0.8:** Schema Refactor (analytes, analyte_aliases, pending_analytes tables)
- **PRD v0.9:** Mapping Applier Dry-Run (3-tier matching: exact, fuzzy, LLM)
- **PRD v0.9.1:** LLM Tier C (NEW analyte proposals)
- **PRD v2.3:** Single-Analyte Plot UI (parameter selector)
- **Database:** PostgreSQL with pg_trgm extension
- **LLM:** OpenAI GPT-5-mini for mapping

---

## ✅ Acceptance Criteria

### Definition of Done
1. ✅ New uploads write `analyte_id` for matched parameters
2. ✅ NEW analytes queued to `pending_analytes` table
3. ✅ Backfill script populates analyte_id for 422 existing rows
4. ✅ Admin page displays pending analytes
5. ✅ Admin can approve → analyte created + lab_results backfilled
6. ✅ Admin can discard → pending analyte removed
7. ✅ Plot queries group cholesterol variations correctly (3 groups instead of 8)
8. ✅ All tests pass
9. ✅ Documentation updated (README, API docs)

### User Validation
- Upload test report with known parameter → analyte_id written ✅
- Upload test report with NEW parameter → pending queue updated ✅
- Admin reviews pending → approves IL6 → lab_results updated ✅
- Plot query "show cholesterol" → 3 selectable parameters (not 8) ✅

---

## 📋 Review Findings & Resolutions

This section documents critical issues identified during technical review and their resolutions.

### 🔴 High Priority Issues (FIXED)

#### **Issue #1: Overwriting Curated Data**
**Problem:** `wetRun()` updates `analyte_id` without checking if already populated, risking overwrite of manually curated data.

**Resolution:**
```sql
-- Added guard clause:
UPDATE lab_results
SET analyte_id = $1
WHERE id = $2
  AND analyte_id IS NULL;  -- ✅ Only write if unmapped
```

**Additional safeguards:**
- Added `mapping_source` column to distinguish `'auto'` vs `'manual'`
- Added `mapping_confidence` to allow selective overrides based on confidence
- Transaction-level locking prevents race conditions

**Location:** Section 1.1, line 109-122

---

### 🟡 Medium Priority Issues (FIXED)

#### **Issue #2: Language Detection for Aliases**
**Problem:** Approval hardcodes `lang='en'` for all aliases, breaking multilingual support (e.g., Cyrillic "Интерлейкин-6" marked as English).

**Resolution:**
```javascript
function detectLanguage(text) {
  if (/[\u0400-\u04FF]/.test(text)) return 'ru';  // Cyrillic
  if (/[\u0590-\u05FF]/.test(text)) return 'he';  // Hebrew
  if (/[\u0600-\u06FF]/.test(text)) return 'ar';  // Arabic
  if (/[\u4E00-\u9FFF]/.test(text)) return 'zh';  // Chinese
  return 'en';  // Default/Latin
}
```

**Additional improvements:**
- Added `alias_display` column to preserve original casing/punctuation
- Auto-detect language for each variation
- Store both normalized (for matching) and display (for UI) forms

**Location:** Section 4.1, lines 413-433

---

#### **Issue #3: Category Loss**
**Problem:** Approval hardcodes `category='uncategorized'`, discarding LLM-suggested category from evidence.

**Resolution:**
```sql
INSERT INTO analytes (code, name, unit_canonical, category)
VALUES (
  $proposed_code,
  $proposed_name,
  $unit_canonical,
  COALESCE($category, 'uncategorized')  -- ✅ Preserve LLM suggestion
);
```

**Location:** Section 4.1, lines 397-405

---

#### **Issue #4: Discard Creates Infinite Loop**
**Problem:** Discarding deletes row, so same bad suggestion re-appears on next upload. No audit trail.

**Resolution:**
```sql
-- Changed from DELETE to UPDATE:
UPDATE pending_analytes
SET status = 'discarded',
    discarded_at = NOW(),
    discarded_reason = $reason
WHERE pending_id = $pending_id;

-- Prevent re-proposing in wetRun():
SELECT status FROM pending_analytes
WHERE proposed_code = $code AND status = 'discarded';
-- If found → Don't queue again
```

**Benefits:**
- ✅ Prevents loops
- ✅ Audit trail preserved
- ✅ Analytics on rejection reasons
- ✅ Can "un-discard" if needed

**Location:** Section 4.2, lines 477-515

---

### ❓ Questions Resolved

#### **Q1: MAPPING_AUTO_ACCEPT Threshold Behavior**
**Answer:** Added comprehensive decision matrix (Section 1.2, lines 161-221):

| Decision Type | Confidence | Action |
|---------------|------------|--------|
| MATCH_EXACT | 1.0 | ✅ Write immediately |
| MATCH_FUZZY | ≥ 0.80 | ✅ Write immediately |
| MATCH_FUZZY | 0.60-0.79 | ⏳ Queue for review |
| MATCH_LLM | ≥ 0.80 | ✅ Write immediately |
| NEW_LLM | Any | ⏳ Always queue |

**Implementation:** `wetRun()` now respects confidence thresholds before writing.

---

#### **Q2: Seed Aliases from Evidence**
**Answer:** YES! When approving, auto-create aliases for all parameter variations captured in evidence.

**Example:**
If evidence shows:
- `"Интерлейкин-6"` (3 occurrences)
- `"IL-6"` (2 occurrences)
- `"Interleukin-6"` (1 occurrence)

Approval creates 3 aliases:
```sql
INSERT INTO analyte_aliases (alias, alias_display, lang) VALUES
  ('интерлейкин 6', 'Интерлейкин-6', 'ru'),
  ('il 6', 'IL-6', 'en'),
  ('interleukin 6', 'Interleukin-6', 'en');
```

**Location:** Section 4.1, lines 406-433

---

### 💡 Additional Improvements

#### **Schema Changes**
Added 4 new tables/columns for robustness:
1. `lab_results.mapping_confidence` — Track confidence scores
2. `lab_results.mapping_source` — Distinguish auto vs manual
3. `analyte_aliases.alias_display` — Preserve original forms
4. `pending_analytes.parameter_variations` — Collect all variations
5. `pending_analytes.discarded_reason` — Audit discards
6. `admin_actions` table — Full audit trail

**Location:** Section "Schema Changes", lines 604-701

---

#### **Concurrent Upload Handling**

**❗ IMPORTANT CONCURRENCY CONSIDERATION:**

The PRD initially suggested `FOR UPDATE SKIP LOCKED`, which is sophisticated but has tradeoffs.

**Problem with SKIP LOCKED:**
```sql
-- Transaction A (backfill script):
FOR UPDATE SKIP LOCKED;  -- Locks rows 1-100

-- Transaction B (new upload):
FOR UPDATE SKIP LOCKED;  -- Skips rows 1-100, processes row 101

-- Result: Rows 1-100 processed by A, row 101 processed by B ✅
-- BUT: If A fails/rolls back, rows 1-100 are NOT retried!
```

**Revised Strategy:**

#### **Option A: Simple Blocking (RECOMMENDED for v2.4)**

```sql
UPDATE lab_results
SET analyte_id = $1,
    mapping_confidence = $2,
    mapped_at = NOW()
WHERE id = $3
  AND analyte_id IS NULL;  -- Guard clause
-- NO FOR UPDATE clause
```

**Why this works:**
- ✅ `WHERE analyte_id IS NULL` is **idempotent** (second UPDATE is no-op)
- ✅ Both transactions can execute; only first wins
- ✅ No deadlocks (single-row updates)
- ✅ Simple to reason about
- ✅ No "skipped row" problem

**Trade-off:**
- ⚠️ Slight performance penalty if backfill runs concurrently with uploads
- ⚠️ ~5-10% slower than SKIP LOCKED in high-concurrency scenarios

**When to use this:** Default for v2.4 (simple, safe, correct)

---

#### **Option B: SKIP LOCKED with Retry Queue (High Performance)**

```sql
-- Step 1: Try to update with SKIP LOCKED
UPDATE lab_results
SET analyte_id = $1
WHERE id = $2
  AND analyte_id IS NULL
FOR UPDATE SKIP LOCKED;

-- Step 2: If 0 rows affected, add to retry queue
INSERT INTO mapping_retry_queue (result_id, reason)
VALUES ($result_id, 'locked_by_concurrent_transaction');
```

**Pros:**
- ✅ Maximum throughput (no blocking)
- ✅ Handles skipped rows via retry mechanism

**Cons:**
- ❌ Requires new `mapping_retry_queue` table
- ❌ Requires background worker to process retries
- ❌ More complex (3 additional components)

**When to use this:** v3.0+ if uploads >100/sec

---

#### **Option C: Advisory Locks (Backfill-Only Guard)**

```sql
-- Only in backfill script:
SELECT pg_try_advisory_lock(123456);  -- Exclusive lock

-- If acquired:
--   Run backfill
--   Release lock: SELECT pg_advisory_unlock(123456);
-- If NOT acquired:
--   Exit with message "Backfill already running"
```

**Pros:**
- ✅ Prevents multiple backfill scripts running
- ✅ Doesn't block uploads (different code path)
- ✅ Simple mutex pattern

**When to use this:** Combine with Option A for safety

---

#### **Recommendation for v2.4:**

**Use Option A (Simple Guard Clause) + Option C (Advisory Lock for Backfill)**

```javascript
// wetRun() - No locking needed:
await pool.query(
  `UPDATE lab_results
   SET analyte_id = $1, mapping_confidence = $2
   WHERE id = $3 AND analyte_id IS NULL`,
  [analyteId, confidence, resultId]
);

// Backfill script - Use advisory lock:
const { rows } = await pool.query(`SELECT pg_try_advisory_lock(123456) AS acquired`);
if (!rows[0].acquired) {
  console.error('Backfill already running. Exiting.');
  process.exit(1);
}

try {
  // Run backfill...
} finally {
  await pool.query(`SELECT pg_advisory_unlock(123456)`);
}
```

**Why this is best for v2.4:**
- ✅ Correct (no lost updates)
- ✅ Simple (no retry queue)
- ✅ Safe (backfill mutex)
- ✅ Fast enough (idempotent updates)

---

#### **Audit Logging**
Added `admin_actions` table to track:
- Every approve/discard action
- Timestamp, admin user (future), IP address
- Before/after state (JSONB)
- Enables compliance and debugging

**Example query:**
```sql
-- Who approved the most analytes this month?
SELECT admin_user, COUNT(*) as approvals
FROM admin_actions
WHERE action_type = 'approve_analyte'
  AND created_at >= NOW() - INTERVAL '30 days'
GROUP BY admin_user
ORDER BY approvals DESC;
```

---

## ✅ All Review Findings Addressed

| Finding | Severity | Status | Section |
|---------|----------|--------|---------|
| Overwrite curated data | 🔴 High | ✅ Fixed | 1.1 |
| Language detection | 🟡 Medium | ✅ Fixed | 4.1 |
| Category loss | 🟡 Medium | ✅ Fixed | 4.1 |
| Discard infinite loop | 🟡 Medium | ✅ Fixed | 4.2 |
| Auto-accept threshold | ❓ Question | ✅ Clarified | 1.2 |
| Seed evidence aliases | ❓ Question | ✅ Implemented | 4.1 |
| Audit logging | 💡 Suggestion | ✅ Added | Schema Changes |
| Concurrent uploads | 💡 Suggestion | ✅ Documented | 1.1 |

---

## 📋 Additional Review Questions & Resolutions

### **Question 1: How to Handle AMBIGUOUS_FUZZY Matches?**

**Problem Identified:**
> "Ambiguous match between existing analytes (e.g., FER vs FER_S) - should this create pending_analyte entry? How does UI present choice?"

**Resolution: Separate Review Queue**

✅ **Added `match_reviews` table enhancement** (Section "Schema Changes #4")
- Stores ambiguous matches separately from NEW analytes
- `candidates` JSONB field holds all competing analytes
- Example:
  ```json
  {
    "candidates": [
      {"analyte_id": 12, "code": "FER", "similarity": 0.82},
      {"analyte_id": 45, "code": "FER_S", "similarity": 0.81}
    ]
  }
  ```

✅ **Added API endpoint** `POST /api/admin/resolve-match` (Section 4.3)
- Admin chooses correct analyte from candidates
- Optionally creates disambiguating alias
- Updates `lab_results.analyte_id` with chosen value

✅ **Added API endpoint** `GET /api/admin/ambiguous-matches` (Section 4.4)
- Fetches pending ambiguous matches
- Returns all candidates with similarity scores

✅ **Updated UI** to two-tab design (Section 3.1)
- **Tab 1:** New Analytes (approve/discard)
- **Tab 2:** Ambiguous Matches (choose between existing)

**Flow:**
```
Upload → wetRun() detects AMBIGUOUS_FUZZY
  ↓
INSERT INTO match_reviews (candidates=[FER, FER_S])
  ↓
Admin opens Tab 2 → Sees "Ферритин С" with 2 choices
  ↓
Admin clicks "FER" → UPDATE lab_results SET analyte_id=12
  ↓
Optionally creates alias "ферритин с" → FER for future
```

---

### **Question 2: Security of Admin Panel**

**Problem Identified:**
> "PRD states 'no authentication (admin page is public)' - is this secure?"

**Resolution: Deferred to Future PRD (MVP Mode)**

✅ **Decision: No authentication for v2.4 MVP**
- Admin pages are publicly accessible
- Assumes trusted network environment or manual access control (firewall, VPN)
- Focus on core functionality first
- Security will be added in PRD v2.5

**Deferred to v2.5:**
- Per-user accounts with authentication
- Role-based access control
- OAuth/SAML integration
- Rate limiting
- 2FA

---

### **Question 3: Concurrency Handling with SKIP LOCKED**

**Problem Identified:**
> "`FOR UPDATE SKIP LOCKED` is sophisticated but skipped rows won't be retried if transaction fails. Is this the right approach?"

**Resolution: Simpler Idempotent Updates**

❌ **Initial spec used SKIP LOCKED** (complex, can lose data)

✅ **Updated to simple guard clause** (Section "Concurrent Upload Handling")

**Revised strategy:**
```sql
-- Simple, idempotent, correct:
UPDATE lab_results
SET analyte_id = $1
WHERE id = $2
  AND analyte_id IS NULL;  -- Only update if unmapped
-- NO FOR UPDATE needed!
```

**Why this works:**
- Idempotent: Second UPDATE is no-op (0 rows affected)
- Safe: No race conditions (atomic UPDATE)
- Simple: No retry queue needed
- Fast enough: ~5-10% slower than SKIP LOCKED (acceptable)

**Additional safeguard for backfill:**
```sql
-- Prevent multiple backfill scripts:
SELECT pg_try_advisory_lock(123456);
-- If locked → exit with error
-- If acquired → run backfill → release lock
```

**Options documented:**
1. **Option A:** Simple guard clause (recommended)
2. **Option B:** SKIP LOCKED + retry queue (v3.0+ if >100 uploads/sec)
3. **Option C:** Advisory lock for backfill mutex

**Chosen for v2.4:** Option A + Option C
- Simple guard clause in `wetRun()`
- Advisory lock in backfill script
- No lost updates, no skipped rows

---

## ✅ All Questions Addressed

| Question | Category | Resolution | Section |
|----------|----------|------------|---------|
| AMBIGUOUS_FUZZY handling | Design Gap | Added `match_reviews` table + UI Tab 2 | Schema #4, UI 3.1, API 4.3-4.4 |
| Admin panel security | Security | Deferred to v2.5 (MVP has no auth) | Security |
| SKIP LOCKED concerns | Concurrency | Changed to simple guard clause | Concurrent Upload Handling |

---

**End of PRD v2.4 (Revised)**



