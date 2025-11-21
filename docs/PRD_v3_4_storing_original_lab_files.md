# PRD v3.4 — Persistent Storage of Original Lab Result Files

**Status:** Ready for Implementation
**Target:** Phase 1 (Fresh Database)
**Effort Estimate:** 1 day (middle SE)
**Dependencies:** PRD v3.0 (Unified Upload), PRD v2.8 (Gmail Integration)

---

## Overview

### Problem Statement

Currently, HealthUp discards original uploaded files (PDFs, images) immediately after OCR extraction completes. Only the extracted structured data (patient demographics, lab parameters) is persisted to the database. This creates several issues:

1. **No re-analysis capability:** If OCR quality improves or new models are deployed, we cannot re-process historical files
2. **No original file viewing:** Users cannot view the original lab report document to verify OCR accuracy
3. **Audit trail incomplete:** For medical records compliance, original source documents should be retained
4. **Debugging difficulty:** When OCR extracts incorrect data, engineers cannot inspect the original file

### Solution

Store the original uploaded file binary data in the `patient_reports` table using PostgreSQL's `BYTEA` column type. Files will be stored alongside their extracted metadata, maintaining the existing deduplication logic (per-patient checksum).

### Goals

- ✅ Persist original uploaded files (PDF, JPEG, PNG, HEIC) in the database
- ✅ Enable future file retrieval via REST API
- ✅ Maintain existing deduplication behavior (same file uploaded twice = single stored copy)
- ✅ Support both manual uploads and Gmail-ingested attachments
- ✅ Minimal performance impact (<10% increase in upload time)

### Non-Goals (Deferred to Future Phases)

- ❌ Re-processing historical reports (no backfill for pre-v3.4 data)
- ❌ File compression or optimization (store as-is)
- ❌ External object storage (S3, Azure Blob) - PostgreSQL only for Phase 1
- ❌ File deletion or retention policies (keep forever for Phase 1)
- ❌ Access control or multi-tenant security (fresh DB = single user context)

---

## User Stories

### US1: Admin Reviews OCR Accuracy
**As an** administrator
**I want to** view the original uploaded lab report file
**So that** I can verify OCR extraction accuracy when reviewing mapping errors

**Acceptance Criteria:**
- Admin clicks "View Original" button on results page → browser opens original PDF/image in new tab
- File displays with correct Content-Type (PDF renders in browser, images display inline)
- If file not available (legacy report), shows clear error message

### US2: System Retains Audit Trail
**As a** healthcare application
**I need to** store original source documents alongside extracted data
**So that** medical records compliance requirements are met

**Acceptance Criteria:**
- Every uploaded file stored in database with original filename and mimetype
- Deduplication prevents storage waste (duplicate files = single copy)
- Files retained indefinitely (same lifecycle as patient report record)

---

## Technical Design

### Database Schema Changes

**Table:** `patient_reports`
**New Columns:**

```sql
-- Add to server/db/schema.js
file_data BYTEA
file_mimetype TEXT
```

**Column Properties:**

**`file_data`:**
- **Type:** `BYTEA` (binary data, supports up to 1GB per PostgreSQL spec)
- **Nullable:** `NULL` allowed (legacy reports pre-v3.4 won't have files)
- **Indexed:** No (BYTEA cannot be indexed; retrieval uses existing `id` primary key)
- **TOAST:** Automatically enabled by PostgreSQL for values >2KB (stores in separate table)

**`file_mimetype`:**
- **Type:** `TEXT`
- **Nullable:** `NULL` allowed (legacy reports pre-v3.4 won't have mimetype)
- **Purpose:** Store original upload MIME type for accurate Content-Type header in retrieval API
- **Examples:** `application/pdf`, `image/jpeg`, `image/png`, `image/heic`

**Column Documentation:**
```sql
COMMENT ON COLUMN patient_reports.file_data IS
  'Original uploaded file (PDF/image) stored as binary data. NULL for reports uploaded before v3.4.';

COMMENT ON COLUMN patient_reports.file_mimetype IS
  'MIME type of uploaded file (e.g., application/pdf, image/jpeg). Used for Content-Type header in retrieval API. NULL for legacy reports.';
```

**Updated Schema Definition:**
```sql
CREATE TABLE IF NOT EXISTS patient_reports (
  id UUID PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  source_filename TEXT,
  checksum TEXT NOT NULL,
  parser_version TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  recognized_at TIMESTAMPTZ NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL,
  test_date_text TEXT,
  patient_name_snapshot TEXT,
  patient_age_snapshot TEXT,
  patient_gender_snapshot TEXT,
  patient_date_of_birth_snapshot TEXT,
  raw_model_output TEXT,
  missing_data JSONB,
  file_data BYTEA,        -- NEW COLUMN
  file_mimetype TEXT,     -- NEW COLUMN
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (patient_id, checksum)
);
```

### Persistence Logic Changes

**File:** `server/services/reportPersistence.js`

**Current INSERT (Line ~197-236):**
```sql
INSERT INTO patient_reports (
  id, patient_id, source_filename, checksum, parser_version,
  status, recognized_at, processed_at, test_date_text,
  patient_name_snapshot, patient_age_snapshot, patient_gender_snapshot,
  patient_date_of_birth_snapshot, raw_model_output, missing_data,
  created_at, updated_at
)
VALUES ($1, $2, $3, $4, $5, 'completed', $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, NOW(), NOW())
```

**Updated INSERT:**
```sql
INSERT INTO patient_reports (
  id, patient_id, source_filename, checksum, parser_version,
  status, recognized_at, processed_at, test_date_text,
  patient_name_snapshot, patient_age_snapshot, patient_gender_snapshot,
  patient_date_of_birth_snapshot, raw_model_output, missing_data,
  file_data, file_mimetype,  -- NEW PARAMETERS
  created_at, updated_at
)
VALUES (
  $1, $2, $3, $4, $5, 'completed', $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb,
  $15, $16,  -- NEW: fileBuffer, mimetype parameters
  NOW(), NOW()
)
```

**Function Signature Update:**
```javascript
// persistLabReport.js:153
async function persistLabReport({
  fileBuffer,  // Already passed in, now will be persisted
  filename,
  mimetype,    // NEW: Must be added to function signature
  parserVersion,
  processedAt,
  coreResult,
}) {
  // ... existing validation ...

  const reportResult = await client.query(
    `INSERT INTO patient_reports (..., file_data, file_mimetype, ...) VALUES (..., $15, $16, ...)`,
    [
      reportId,
      patientId,
      filename ?? null,
      checksum,
      parserVersion ?? null,
      recognizedAt,
      processedTimestamp,
      safeCoreResult.test_date ?? null,
      patientName,
      safeCoreResult.patient_age ?? null,
      patientGender,
      patientDateOfBirth,
      safeCoreResult.raw_model_output ?? null,
      missingDataJson,
      fileBuffer,  // NEW: Add as parameter $15
      mimetype,    // NEW: Add as parameter $16
    ],
  );
}
```

**Caller Update (labReportProcessor.js):**

The `mimetype` parameter is available in `labReportProcessor.js` at line 571 but is NOT currently passed to `persistLabReport`. You must update the function call around line 698-704:

```javascript
// BEFORE (current code - line ~698-704)
persistenceResult = await persistLabReport({
  fileBuffer,
  filename: sanitizedFilename,
  parserVersion: `${OCR_PROVIDER}:${provider.model}`,
  processedAt,
  coreResult,
});

// AFTER (required change)
persistenceResult = await persistLabReport({
  fileBuffer,
  filename: sanitizedFilename,
  mimetype,  // ADD THIS LINE - available at line 571
  parserVersion: `${OCR_PROVIDER}:${provider.model}`,
  processedAt,
  coreResult,
});
```

### MIME Type Normalization

**Problem:** Email systems (especially Gmail) often provide generic MIME types like `application/octet-stream` for attachments, even when the actual file type is known from the extension.

**Solution:** Normalize MIME type before storing in database, using extension-based inference as fallback.

**Normalization Logic:**

```javascript
// reportPersistence.js - Add before INSERT
function normalizeMimetype(mimetype, filename) {
  // If generic/missing mimetype, infer from extension
  if (!mimetype || mimetype === 'application/octet-stream' || mimetype === 'binary/octet-stream') {
    const ext = filename?.split('.').pop()?.toLowerCase();
    const mimetypeMap = {
      'pdf': 'application/pdf',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'heic': 'image/heic',
      'webp': 'image/webp',
      'gif': 'image/gif',
    };
    return mimetypeMap[ext] || mimetype || 'application/octet-stream';
  }
  return mimetype;
}

// In persistLabReport function (before INSERT):
const normalizedMimetype = normalizeMimetype(mimetype, filename);

// Use normalizedMimetype in INSERT query (parameter $16)
```

**Filename Truncation Handling (REQUIRED FIX):**

The `labReportProcessor.js` truncates filenames to 64 characters (line 586: `filename.slice(0, 64)`). If a long filename loses its extension during truncation, MIME normalization cannot infer the type.

**Problem Example:**
- Original: `very_long_laboratory_blood_test_results_from_hospital_emergency.pdf` (66 chars)
- Truncated: `very_long_laboratory_blood_test_results_from_hospital_emerg` (no `.pdf`)
- Mimetype from Gmail: `application/octet-stream`
- Normalized result: `application/octet-stream` (can't infer from missing extension)
- User downloads file with generic mimetype → shows as binary, not PDF

**Required Solution:**

Modify `reportPersistence.js` to preserve the original extension before normalization:

```javascript
// reportPersistence.js - Update normalizeMimetype function
function normalizeMimetype(mimetype, filename) {
  // If generic/missing mimetype, infer from extension
  if (!mimetype || mimetype === 'application/octet-stream' || mimetype === 'binary/octet-stream') {
    // Extract extension - works even if filename is truncated without extension
    const ext = filename?.split('.').pop()?.toLowerCase();

    // Handle case where truncation removed the extension
    // Extension should still be in the string unless filename had no extension to begin with
    const hasExtension = filename?.includes('.');

    const mimetypeMap = {
      'pdf': 'application/pdf',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'heic': 'image/heic',
      'webp': 'image/webp',
      'gif': 'image/gif',
    };

    // If we found a valid extension, use it
    if (hasExtension && ext && mimetypeMap[ext]) {
      return mimetypeMap[ext];
    }

    // Otherwise return original mimetype or fallback
    return mimetype || 'application/octet-stream';
  }
  return mimetype;
}

// BEFORE calling normalizeMimetype, pass the ORIGINAL filename (before truncation)
// This is available in the function signature - don't pass sanitizedFilename to persistence
```

**Implementation Note:**

The `filename` parameter passed to `persistLabReport` should be the **original filename** before truncation, not the sanitized version. This ensures extension detection works even for long filenames.

**Alternative Solution (If Above Doesn't Work):**

Pass the original `mimetype` parameter to `persistLabReport` and trust it over extension inference when available. The normalization function already does this - it only infers from extension when mimetype is octet-stream or missing.

**Test Case:**
1. Upload file with 70-char name ending in `.pdf` via Gmail (mimetype: `application/octet-stream`)
2. Verify `file_mimetype` stored as `application/pdf` (not `application/octet-stream`)
3. Verify file downloads/renders as PDF in browser

**Behavior:**
- `application/octet-stream` + `report.pdf` → stores as `application/pdf`
- `application/pdf` + `report.pdf` → stores as `application/pdf` (trusted mimetype)
- `application/octet-stream` + `report` (no extension) → stores as `application/octet-stream`

**Rationale:**
- ✅ Gmail attachments often have incorrect generic mimetypes
- ✅ Extension-based inference is reliable for known file types
- ✅ Retrieval API no longer needs fallback logic (simpler)
- ✅ Audit trail preserved: stores best-effort correct mimetype

---

### Deduplication Behavior (Conflict Resolution)

**Current Behavior:** When duplicate file is uploaded (same `patient_id` + `checksum`), system executes `ON CONFLICT DO UPDATE` to refresh metadata.

**Phase 1 Behavior:** Update extracted data and timestamps, preserving first uploaded file binary.

**Product Decision:** When duplicate file is uploaded (same checksum), system will:
1. Preserve the original `file_data` and `file_mimetype` (no need to re-store identical bytes)
2. **Re-run full OCR extraction** and update all extracted fields (`patient_reports` metadata AND `lab_results` table)
3. **Delete and reinsert `lab_results` rows** (current implementation at reportPersistence.js:258-267)

**Rationale:**
- ✅ Allows improved OCR models to fix extraction errors on re-upload
- ✅ Identical file binary = same source of truth (no need to overwrite BLOB)
- ✅ Extracted data can improve over time (model upgrades, prompt improvements)
- ✅ Saves storage (no duplicate 3MB BLOBs)
- ✅ Medical best practice: Allow correction of data extraction errors while preserving original document

**Note on Consistency:** The `raw_model_output` field in `patient_reports` will be updated to match the latest OCR run, while `lab_results` rows are deleted/reinserted. This means both are consistent with the latest extraction.

**Product Decision - `recognized_at` Field Semantics:**

The existing codebase (reportPersistence.js:225) currently updates `recognized_at = EXCLUDED.recognized_at` on duplicates.

**Phase 1 Decision:** CHANGE this behavior - preserve `recognized_at` from first upload.

**Rationale:**
- Field name `recognized_at` implies "when first recognized/seen", not "last processed"
- Audit best practice: original timestamps should be immutable
- `processed_at` field already tracks "last processing time"
- `created_at` and `recognized_at` should both represent the original upload event
- Updating `recognized_at` on duplicates creates confusing semantics (was it recognized now or earlier?)

**Implementation:** The ON CONFLICT clause below omits `recognized_at` from the update list, which preserves the value from the first INSERT (correct behavior).

**Timestamp Field Usage Guide:**

For queries and sorting, use the appropriate timestamp field:

| Use Case | Field to Use | Behavior on Duplicate |
|----------|--------------|----------------------|
| "When was this report first uploaded?" | `created_at` | Never updated (immutable) |
| "When was this file first recognized by OCR?" | `recognized_at` | Preserved from first upload |
| "When was this report last processed?" | `processed_at` | Updated on every re-upload |
| "When did patient last submit any report?" | `patients.last_seen_report_at` | Updated on every upload (patient table) |

**Important:** After this change, sorting by `recognized_at` shows "first upload date" not "most recent re-upload". Use `processed_at` for "recently processed" queries.

**Updated Conflict Clause:**
```sql
ON CONFLICT (patient_id, checksum) DO UPDATE SET
  -- Update all extracted metadata (allow OCR improvements)
  parser_version = EXCLUDED.parser_version,
  processed_at = EXCLUDED.processed_at,
  status = EXCLUDED.status,
  test_date_text = EXCLUDED.test_date_text,
  patient_name_snapshot = EXCLUDED.patient_name_snapshot,
  patient_age_snapshot = EXCLUDED.patient_age_snapshot,
  patient_gender_snapshot = EXCLUDED.patient_gender_snapshot,
  patient_date_of_birth_snapshot = EXCLUDED.patient_date_of_birth_snapshot,
  raw_model_output = EXCLUDED.raw_model_output,
  missing_data = EXCLUDED.missing_data,
  updated_at = NOW()

  -- Preserve original from first upload (no need to re-store identical data)
  -- file_data, file_mimetype, source_filename intentionally omitted
```

**What Updates on Duplicate:**
- ✅ All OCR-extracted fields (`test_date_text`, `_snapshot` fields, `raw_model_output`)
- ✅ `parser_version` - Track OCR model used for latest extraction
- ✅ `processed_at` - Timestamp of latest processing attempt
- ✅ `status` - Always 'completed' currently
- ✅ `lab_results` table - Deleted and reinserted with latest extraction (separate transaction step)

**What Preserves from First Upload:**
- ✅ `file_data` - Original file bytes (identical to re-uploaded file)
- ✅ `file_mimetype` - Original MIME type from first upload
- ✅ `source_filename` - Original filename (see "Filename Handling on Duplicates" below)

### Filename Handling on Duplicates

**Scenario:** User uploads "report.pdf", then later uploads the identical file renamed as "report_v2.pdf"

**Behavior:** `source_filename` preserves the **FIRST** upload's name ("report.pdf")

**Rationale:**
- Identical checksum = identical file → filename change is cosmetic
- "View Original" feature displays the *original* upload (name matches content)
- Avoids confusion: retrieved file has consistent naming with stored `file_data`
- Maintains audit trail: original filename preserved as historical record

**User Experience:**
- When duplicate detected, user sees "🔄 Duplicate" status
- Results page shows original filename, not the renamed version
- "View Original" button serves file with original name in Content-Disposition header

---

## File Retrieval API (Phase 1)

### Endpoint Specification

**Purpose:** Retrieve original uploaded file for viewing/download

**Router Decision:** Extend existing `server/routes/reports.js` instead of creating new router.

**Rationale:**
- Existing router already handles `/api/reports/:reportId` (report metadata)
- File download is a sub-resource of the report entity (RESTful pattern)
- Keeps all report-related endpoints in one router (simpler middleware/logging)
- Consistent URL structure: `/api/reports/:id` and `/api/reports/:id/original-file`

```
GET /api/reports/:reportId/original-file
```

**Parameters:**
- `reportId` (path) - UUID of patient report

**Success Response (200 OK):**
```http
HTTP/1.1 200 OK
Content-Type: application/pdf  /* or image/jpeg, image/png, etc. */
Content-Disposition: inline; filename="lab_report_2024-03-15.pdf"
Content-Length: 2847291

[Binary file data]
```

**Error Responses:**

**404 Not Found** - Report ID doesn't exist
```json
{
  "error": "Report not found",
  "report_id": "123e4567-e89b-12d3-a456-426614174000"
}
```

**410 Gone** - Report exists but file not stored
```json
{
  "error": "Original file not available",
  "reason": "report_predates_file_storage",
  "report_id": "123e4567-e89b-12d3-a456-426614174000",
  "recognized_at": "2024-01-15T10:30:00Z"
}
```

### Security & Access Control

**Phase 1 Assumption:** Single-user mode with no authentication.

**Current State:**
- No auth middleware on application
- All endpoints accessible without credentials
- Fresh database with test data only (no PHI in production)

**Implementation for Phase 1:**
- ✅ No additional access control required for `/api/reports/:reportId/original-file`
- ✅ Consistent with existing `/api/reports/:reportId` endpoint (also unprotected)
- ✅ Acceptable for development/testing environment

**Future Enhancement (Out of Scope):**

When authentication is added to the application, file retrieval endpoint MUST implement:

1. **Authentication check** - Verify user is logged in
2. **Authorization check** - Verify user owns the report being requested:
   ```javascript
   // Pseudocode for future auth implementation
   const userId = req.user.id; // from auth middleware

   // Check that report belongs to user's patient record
   const authCheck = await pool.query(`
     SELECT 1 FROM patient_reports pr
     JOIN patients p ON p.id = pr.patient_id
     WHERE pr.id = $1 AND p.user_id = $2
   `, [reportId, userId]);

   if (authCheck.rowCount === 0) {
     return res.status(403).json({ error: 'Access denied' });
   }
   ```

3. **Audit logging** - Log all PHI file access for HIPAA compliance

**Risk Assessment:** Phase 1 operates in development mode with no production PHI. Security controls required before deploying with real patient data.

### Implementation Outline

**File:** `server/routes/reports.js` (extend existing router)

Add this route handler to the existing router:

```javascript
// Add to existing server/routes/reports.js file
// (already has router, pool imports, and UUID validation)

router.get('/reports/:reportId/original-file', async (req, res) => {
  const { reportId } = req.params;

  // Phase 1: No auth checks (single-user development mode)
  // TODO: Add authentication + authorization before production deployment

  try {
    const result = await pool.query(
      `SELECT file_data, source_filename, file_mimetype, recognized_at
       FROM patient_reports
       WHERE id = $1`,
      [reportId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Report not found',
        report_id: reportId
      });
    }

    const { file_data, source_filename, file_mimetype, recognized_at } = result.rows[0];

    if (!file_data) {
      return res.status(410).json({
        error: 'Original file not available',
        reason: 'report_predates_file_storage',
        report_id: reportId,
        recognized_at: recognized_at
      });
    }

    // Use stored mimetype (already normalized during persistence)
    // Fallback only for legacy NULL records
    const contentType = file_mimetype || 'application/octet-stream';

    // PHI protection: prevent browser caching of medical records
    res.set('Content-Type', contentType);
    res.set('Content-Disposition', `inline; filename="${source_filename || 'lab_report'}"`);
    res.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.send(file_data);
  } catch (error) {
    console.error('[patientReports] File retrieval error:', error);
    res.status(500).json({ error: 'Failed to retrieve file' });
  }
});

module.exports = router;
```

**No registration needed** - the existing reports router is already registered in `server/app.js`.

---

## Frontend Changes

### UI Placement

**Location:** Results page (opened after clicking "View" button in upload progress table)

**Current Flow:**
1. User uploads file → sees progress table
2. Status changes to "✅ Done"
3. User clicks "View" button → opens results page in new tab
4. Results page shows OCR extraction (patient info, parameters table, etc.)

**New Addition:** Add "View Original" button on results page, next to existing "View" button location.

### Button Implementation

**File:** `public/index.html` (results page loads here with `?reportId=` param)

**Note:** The results UI uses `reportId` (camelCase) as the URL parameter, not `report_id` (underscore). Example: `http://localhost:3000/?reportId=abc-123`

```html
<!-- Add near top of results page, after patient info section -->
<div class="action-buttons">
  <button
    id="viewOriginalBtn"
    class="btn btn-secondary"
    onclick="viewOriginalFile()"
  >
    📄 View Original File
  </button>
</div>

<script>
// Extract reportId in outer scope so it's available everywhere
// NOTE: Parameter is reportId (camelCase), matches existing app.js:10 pattern
const reportId = new URLSearchParams(window.location.search).get('reportId');

function viewOriginalFile() {
  if (!reportId) {
    alert('Report ID not found');
    return;
  }

  // Open file in new tab
  // Server returns 410 Gone JSON if file not available (legacy reports)
  const url = `/api/reports/${reportId}/original-file`;
  window.open(url, '_blank');
}
</script>
```

**Styling Suggestion:**
```css
.action-buttons {
  margin: 1rem 0;
  display: flex;
  gap: 0.5rem;
}

.btn-secondary {
  background-color: #6c757d;
  color: white;
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

---

## Storage Considerations

### Size Estimates

**Typical File Sizes:**
| File Type | Typical Size | Notes |
|-----------|--------------|-------|
| Lab PDF (single page) | 200-500 KB | Text-based, simple layout |
| Lab PDF (multi-page) | 1-3 MB | Includes letterhead, signatures |
| Scanned PDF | 3-8 MB | Scanned at 300 DPI |
| HEIC photo | 500 KB - 2 MB | iPhone default, efficient compression |
| JPEG photo | 2-5 MB | Typical smartphone photo |

**Average:** ~2.5 MB per file (mix of PDFs and photos)

**Projected Growth:**
| Upload Volume | Monthly Storage | Annual Storage |
|---------------|-----------------|----------------|
| 10 reports/month | 25 MB | 300 MB |
| 50 reports/month | 125 MB | 1.5 GB |
| 100 reports/month | 250 MB | 3 GB |
| 500 reports/month | 1.25 GB | 15 GB |

**PostgreSQL Capacity:**
- ✅ **<100 GB:** PostgreSQL handles BYTEA storage efficiently with TOAST
- ⚠️ **>100 GB:** Consider migrating to object storage (S3, Azure Blob) in future phase

### Monitoring Query

```sql
-- Check total storage usage
SELECT
  pg_size_pretty(pg_total_relation_size('patient_reports')) as total_table_size,
  pg_size_pretty(SUM(octet_length(file_data))) as file_data_size,
  COUNT(*) as total_reports,
  COUNT(file_data) as reports_with_files,
  pg_size_pretty(AVG(octet_length(file_data))) as avg_file_size
FROM patient_reports;

-- Output example:
--  total_table_size | file_data_size | total_reports | reports_with_files | avg_file_size
-- ------------------+----------------+---------------+--------------------+---------------
--  45 MB            | 42 MB          | 150           | 150                | 2867 kB
```

### Retention Policy

**Phase 1 Approach:** Keep files indefinitely (same lifecycle as `patient_reports` record)

**Rationale:**
- Medical records typically require 7-10 year retention (legal compliance)
- Storage costs are low (<$10/month for 100GB on cloud databases)
- Risk of premature deletion outweighs storage cost
- Deletion only when patient explicitly requests data removal (GDPR "right to erasure")

**Future Consideration:** If storage costs become significant, implement retention policy in separate phase (e.g., archive files after 7 years, keep metadata).

---

## Gmail Integration

### Current Behavior

Gmail attachment ingestion (PRD v2.8) already uses the same code path as manual uploads:

```javascript
// server/services/gmailAttachmentIngest.js
await processLabReport({
  jobId,
  fileBuffer,  // Downloaded from Gmail API
  mimetype,
  filename,
  fileSize
});
```

### Phase 1 Behavior

**No code changes required.** Gmail-ingested attachments will automatically be stored in `file_data` column.

**Provenance Tracking:**
- Original email metadata stored in `gmail_report_provenance` table (message ID, sender, subject)
- File checksum stored in both `patient_reports.checksum` AND `gmail_report_provenance.attachment_checksum`
- This is **intentional duplication** - provenance table stores audit metadata, `patient_reports` stores the actual file

**Deduplication Behavior (IMPORTANT DIFFERENCE):**

Gmail duplicate handling differs from manual upload deduplication:

**Manual Upload Duplicates:**
- File reaches `reportPersistence.js`
- Hits ON CONFLICT clause in database
- Re-runs full OCR extraction
- Updates all metadata fields (`processed_at`, `raw_model_output`, `lab_results` table)
- Preserves `file_data`, `file_mimetype`, `source_filename` from first upload

**Gmail Upload Duplicates:**
- `gmailAttachmentIngest.js` checks checksum BEFORE calling `processLabReport` (line 180-186)
- If checksum exists, returns immediately with status "duplicate"
- **Does NOT call processLabReport** - no OCR, no metadata updates
- Existing behavior preserved to avoid redundant Gmail API calls and OCR processing

**Rationale for Different Behavior:**
- Gmail: Attachment checksums are stable - same email will always have same attachment
- Manual: User may intentionally re-upload to trigger re-processing with improved OCR models
- Gmail duplicate detection happens at ingestion layer (efficiency), manual detection at persistence layer (flexibility)

**User Impact:** Gmail re-importing the same email/attachment will show "duplicate" status and skip processing. To re-process a Gmail attachment, download it and upload manually.

---

## Breaking Changes

### Report List Ordering Change

**Current Behavior (Pre-v3.4):**
- `getPatientReports` API sorts by `recognized_at DESC, created_at DESC` (reportRetrieval.js:80)
- When duplicate file re-uploaded, `recognized_at` updates to current timestamp
- Re-uploaded report bubbles to top of list (shown as "most recent")

**New Behavior (v3.4):**
- `recognized_at` preserved from first upload (immutable after initial insert)
- Re-uploaded duplicate stays at original position in list
- `processed_at` updates to current timestamp on re-upload

**Impact:**
- Users who re-upload duplicate files will NOT see them at top of report list
- Report list shows "first seen" order, not "most recently processed" order

**Recommended Fix (Out of Scope for Phase 1):**

Update `server/services/reportRetrieval.js:80` to sort by `processed_at` instead:

```javascript
// CURRENT (Line 80)
ORDER BY recognized_at DESC, created_at DESC

// RECOMMENDED (Future Enhancement)
ORDER BY processed_at DESC, created_at DESC
```

This would restore "most recently processed" sorting behavior while preserving `recognized_at` as immutable audit field.

**Phase 1 Decision:** Accept the breaking change. Document that report lists show "first upload" order. Users can view `processed_at` field in report detail to see latest processing timestamp.

**Alternative Workaround:** Users who want reports to bubble to top on re-upload should delete the old report before uploading again (not recommended for audit trail reasons).

---

## Error Handling

### Transaction Safety

File storage occurs within the same database transaction as OCR results persistence:

```javascript
// reportPersistence.js:183-290
await client.query('BEGIN');
  // 1. Upsert patient
  // 2. Insert patient_reports (includes file_data)
  // 3. Insert lab_results
await client.query('COMMIT');

// On any error: ROLLBACK (no partial data)
```

**Guarantees:**
- ✅ Atomic persistence: File and OCR results saved together or not at all
- ✅ No orphaned files: If OCR parsing fails, file not stored
- ✅ No orphaned metadata: If file storage fails, OCR results rolled back

**User Impact:** Standard "Processing failed" error on upload, user can retry. No data corruption.

### Validation

**Upstream Validation (Already Implemented):**
1. `express-fileupload` validates buffer exists
2. `analyzeLabReport.js` validates mimetype and size (10MB limit)
3. `labReportProcessor.js` validates ALLOWED_MIME_TYPES before OCR
4. `reportPersistence.js` validates `Buffer.isBuffer()` before INSERT

**Phase 1 Approach:** Trust upstream validation (no additional checks in persistence layer)

**Rationale:**
- ✅ Current validation chain is robust (4 layers)
- ✅ Re-hashing file for validation wastes CPU (already hashed for checksum)
- ✅ No evidence of buffer corruption in production

### Database Constraints

**PostgreSQL Limits:**
- Max BYTEA size: 1 GB (theoretical limit)
- Max row size: 400 GB (with TOAST)
- Practical limit: ~100 MB before performance degrades

**System Enforces:**
- Max single file: 10 MB (`MAX_FILE_SIZE_BYTES` in `analyzeLabReport.js:7`)
- Max batch aggregate: 100 MB (`MAX_AGGREGATE_SIZE_BYTES` in `analyzeLabReport.js:9`)

**Phase 1 Assumption:** 10 MB limit is enforced upstream, no additional validation needed in persistence layer.

---

## Implementation Steps

### 1. Update Database Schema

**File:** `server/db/schema.js`

**Action:** Add `file_data` column to `patient_reports` CREATE TABLE statement (around line 22).

```javascript
// schema.js - patient_reports table definition
`
CREATE TABLE IF NOT EXISTS patient_reports (
  id UUID PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  source_filename TEXT,
  checksum TEXT NOT NULL,
  parser_version TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  recognized_at TIMESTAMPTZ NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL,
  test_date_text TEXT,
  patient_name_snapshot TEXT,
  patient_age_snapshot TEXT,
  patient_gender_snapshot TEXT,
  patient_date_of_birth_snapshot TEXT,
  raw_model_output TEXT,
  missing_data JSONB,
  file_data BYTEA,        -- ADD THIS LINE
  file_mimetype TEXT,     -- ADD THIS LINE
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (patient_id, checksum)
);
`,
```

**Action:** Add column comments after table creation statements (around line 44).

```javascript
`
COMMENT ON COLUMN patient_reports.file_data IS
  'Original uploaded file (PDF/image) stored as binary data. NULL for reports uploaded before v3.4.';
`,
`
COMMENT ON COLUMN patient_reports.file_mimetype IS
  'MIME type of uploaded file (e.g., application/pdf, image/jpeg). Used for Content-Type header in retrieval API. NULL for legacy reports.';
`,
```

### 2. Update Persistence Logic

**File:** `server/services/reportPersistence.js`

**Action 1:** Add MIME normalization helper function at the top of the file (after imports).

```javascript
// Add after imports, before persistLabReport function
function normalizeMimetype(mimetype, filename) {
  // If generic/missing mimetype, infer from extension
  if (!mimetype || mimetype === 'application/octet-stream' || mimetype === 'binary/octet-stream') {
    const ext = filename?.split('.').pop()?.toLowerCase();
    const mimetypeMap = {
      'pdf': 'application/pdf',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'heic': 'image/heic',
      'webp': 'image/webp',
      'gif': 'image/gif',
    };
    return mimetypeMap[ext] || mimetype || 'application/octet-stream';
  }
  return mimetype;
}
```

**Action 2:** Add `file_data` and `file_mimetype` to INSERT statement (line ~197).

**Before:**
```javascript
const reportResult = await client.query(
  `
  INSERT INTO patient_reports (
    id, patient_id, source_filename, checksum, parser_version,
    status, recognized_at, processed_at, test_date_text,
    patient_name_snapshot, patient_age_snapshot, patient_gender_snapshot,
    patient_date_of_birth_snapshot, raw_model_output, missing_data,
    created_at, updated_at
  )
  VALUES (
    $1, $2, $3, $4, $5, 'completed', $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, NOW(), NOW()
  )
  ON CONFLICT (patient_id, checksum) DO UPDATE SET
    parser_version = EXCLUDED.parser_version,
    status = EXCLUDED.status,
    recognized_at = EXCLUDED.recognized_at,
    processed_at = EXCLUDED.processed_at,
    test_date_text = EXCLUDED.test_date_text,
    patient_name_snapshot = EXCLUDED.patient_name_snapshot,
    patient_age_snapshot = EXCLUDED.patient_age_snapshot,
    patient_gender_snapshot = EXCLUDED.patient_gender_snapshot,
    patient_date_of_birth_snapshot = EXCLUDED.patient_date_of_birth_snapshot,
    raw_model_output = EXCLUDED.raw_model_output,
    missing_data = EXCLUDED.missing_data,
    source_filename = EXCLUDED.source_filename,
    updated_at = NOW()
  RETURNING id;
  `,
  [
    reportId, patientId, filename ?? null, checksum, parserVersion ?? null,
    recognizedAt, processedTimestamp, safeCoreResult.test_date ?? null,
    patientName, safeCoreResult.patient_age ?? null, patientGender,
    patientDateOfBirth, safeCoreResult.raw_model_output ?? null, missingDataJson,
  ],
);
```

**After:**
```javascript
// Normalize mimetype before storing (handles Gmail's application/octet-stream)
const normalizedMimetype = normalizeMimetype(mimetype, filename);

const reportResult = await client.query(
  `
  INSERT INTO patient_reports (
    id, patient_id, source_filename, checksum, parser_version,
    status, recognized_at, processed_at, test_date_text,
    patient_name_snapshot, patient_age_snapshot, patient_gender_snapshot,
    patient_date_of_birth_snapshot, raw_model_output, missing_data,
    file_data, file_mimetype,  -- ADD THESE
    created_at, updated_at
  )
  VALUES (
    $1, $2, $3, $4, $5, 'completed', $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb,
    $15, $16,  -- ADD THESE
    NOW(), NOW()
  )
  ON CONFLICT (patient_id, checksum) DO UPDATE SET
    -- Update all extracted metadata (allow OCR improvements)
    parser_version = EXCLUDED.parser_version,
    processed_at = EXCLUDED.processed_at,
    status = EXCLUDED.status,
    test_date_text = EXCLUDED.test_date_text,
    patient_name_snapshot = EXCLUDED.patient_name_snapshot,
    patient_age_snapshot = EXCLUDED.patient_age_snapshot,
    patient_gender_snapshot = EXCLUDED.patient_gender_snapshot,
    patient_date_of_birth_snapshot = EXCLUDED.patient_date_of_birth_snapshot,
    raw_model_output = EXCLUDED.raw_model_output,
    missing_data = EXCLUDED.missing_data,
    updated_at = NOW()
    -- Preserve file_data, file_mimetype, source_filename (original from first upload)
  RETURNING id;
  `,
  [
    reportId, patientId, filename ?? null, checksum, parserVersion ?? null,
    recognizedAt, processedTimestamp, safeCoreResult.test_date ?? null,
    patientName, safeCoreResult.patient_age ?? null, patientGender,
    patientDateOfBirth, safeCoreResult.raw_model_output ?? null, missingDataJson,
    fileBuffer,           -- ADD THIS as parameter $15
    normalizedMimetype,   -- ADD THIS as parameter $16 (NORMALIZED)
  ],
);
```

### 3. Add File Retrieval Endpoint

**File:** `server/routes/reports.js` (extend existing router)

Add the route handler from "File Retrieval API" section to the existing reports router.

**No additional registration needed** - router already mounted at `/api` in `server/app.js`.

### 4. Update Frontend (Results Page)

**File:** `public/index.html`

**Location:** Inside the `#report-view-ui` div (around line 163)

**Action:** Add "View Original" button after the `#analysis-result` message element and before the progress section.

```html
<!-- Inside #report-view-ui div, after line 165 -->
<p id="analysis-result" class="message" aria-live="polite" hidden></p>

<!-- ADD THIS BUTTON HERE -->
<div class="action-buttons" style="margin: 1rem 0;">
  <button
    id="viewOriginalBtn"
    class="btn btn-secondary"
    onclick="viewOriginalFile()"
  >
    📄 View Original File
  </button>
</div>

<section class="progress" aria-live="polite" hidden>
```

**File:** `public/js/app.js`

Add the `viewOriginalFile()` function implementation from "Frontend Changes" section above (after existing reportId extraction code).

### 5. Reset Database (REQUIRED)

**IMPORTANT: Phase 1 requires full database reset. All existing data will be lost.**

**Rationale:** The schema uses `CREATE TABLE IF NOT EXISTS`, which does NOT add columns to existing tables. Since we're adding `file_data` and `file_mimetype` columns, the existing schema must be dropped and recreated. Phase 1 operates on fresh database with test data only.

**Choose one reset method:**

**Option A: Admin Panel**
1. Open admin panel in browser
2. Click "Reset Database" button
3. Confirm reset
4. Schema automatically applied with new columns

**Option B: Command Line (Drop + Recreate)**
```bash
# Drop existing database and recreate with new schema
psql postgres -c "DROP DATABASE healthup;"
psql postgres -c "CREATE DATABASE healthup ENCODING 'UTF8' LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8' TEMPLATE template0;"
npm run dev  # Schema auto-applies on boot with new columns
```

**Do NOT attempt to restart server without dropping database** - the new INSERT statements will fail with "column file_data does not exist" errors.

### 6. Verify Schema

**Check columns exist:**
```sql
\d+ patient_reports

-- Should show:
-- Column        | Type    | Nullable | Description
-- --------------+---------+----------+-------------------------------------
-- file_data     | bytea   | YES      | Original uploaded file (PDF/image)...
-- file_mimetype | text    | YES      | MIME type of uploaded file...
```

### 7. Audit and Update Existing Queries (CRITICAL)

**Search for queries that will now pull BLOBs unnecessarily:**

```bash
# Find all SELECT * queries on patient_reports
grep -rn "SELECT \* FROM patient_reports" server/
grep -rn "SELECT pr\.\*" server/

# Common files to check:
# - server/services/reportRetrieval.js
# - server/routes/reports.js
# - server/services/admin*.js
```

**Priority 1: Fix `getReportDetail` in reportRetrieval.js (Line ~165-176)**

This is the MOST CRITICAL query to fix - it's used on every report detail page load.

```javascript
// BEFORE (server/services/reportRetrieval.js:165-176)
// Uses SELECT pr.* which will now load entire BLOB per request
const reportResult = await pool.query(
  `SELECT pr.* FROM patient_reports pr WHERE pr.id = $1`,
  [reportId]
);

// AFTER (explicit columns, exclude file_data)
const reportResult = await pool.query(
  `SELECT pr.id, pr.patient_id, pr.source_filename, pr.file_mimetype,
          pr.checksum, pr.parser_version, pr.status, pr.recognized_at,
          pr.processed_at, pr.test_date_text, pr.patient_name_snapshot,
          pr.patient_age_snapshot, pr.patient_gender_snapshot,
          pr.patient_date_of_birth_snapshot, pr.raw_model_output,
          pr.missing_data, pr.created_at, pr.updated_at
   FROM patient_reports pr
   WHERE pr.id = $1`,
  [reportId]
);
```

**Update each query to explicitly exclude `file_data`:**

```javascript
// GENERIC PATTERN BEFORE (pulls 10MB BLOB per row)
SELECT * FROM patient_reports WHERE patient_id = $1

// GENERIC PATTERN AFTER (explicit columns, exclude file_data)
SELECT id, patient_id, source_filename, file_mimetype, checksum,
       parser_version, status, recognized_at, processed_at,
       test_date_text, patient_name_snapshot, patient_age_snapshot,
       patient_gender_snapshot, patient_date_of_birth_snapshot,
       raw_model_output, missing_data, created_at, updated_at
FROM patient_reports
WHERE patient_id = $1
```

**Why Critical:** Without this step, existing endpoints will load multi-megabyte BLOBs into memory on every request, causing:
- High memory usage (OOM errors)
- Slow response times
- Network overhead (if returning JSON)

**Files Requiring Updates:**
- **`server/services/reportRetrieval.js:165-176`** (HIGH PRIORITY - getReportDetail function)
- Any other files found by grep commands above

---

## Testing & Validation

### Quick Storage Verification

After uploading a file, verify storage with this query:

```sql
SELECT
  id,
  source_filename,
  file_mimetype,
  octet_length(file_data) as file_size_bytes,
  pg_size_pretty(octet_length(file_data)) as file_size_human
FROM patient_reports
WHERE file_data IS NOT NULL
LIMIT 5;

-- Expected output:
--  id                                   | source_filename    | file_mimetype    | file_size_bytes | file_size_human
-- --------------------------------------+--------------------+------------------+-----------------+-----------------
--  123e4567-e89b-12d3-a456-426614174000 | lab_report.pdf     | application/pdf  | 2847291         | 2771 kB
```

### Acceptance Criteria

#### Functional Requirements
- [ ] **Manual Upload (PDF):** Single PDF uploaded → `file_data` and `file_mimetype` populated with binary content and 'application/pdf'
- [ ] **Manual Upload (Image):** JPEG/HEIC photo uploaded → `file_data` and `file_mimetype` populated correctly
- [ ] **Batch Upload:** 5 files uploaded → all 5 have `file_data` and `file_mimetype` populated
- [ ] **Gmail Integration:** Attachment ingested → `file_data` and `file_mimetype` populated AND `gmail_report_provenance` created
- [ ] **Gmail MIME Normalization:** Gmail PDF with `application/octet-stream` → stored as `application/pdf` (normalized by extension)
- [ ] **Deduplication (Binary):** Same file uploaded twice → single record, `file_data` and `file_mimetype` from first upload preserved
- [ ] **Deduplication (Extracted Data):** Same file uploaded twice → `patient_reports` metadata AND `lab_results` updated with latest OCR extraction
- [ ] **File Retrieval (Success):** GET `/api/reports/:id/original-file` → returns correct file with correct Content-Type header from `file_mimetype`
- [ ] **File Retrieval (Not Found):** Invalid report ID → returns 404 JSON error
- [ ] **File Retrieval (No File):** Legacy report (NULL file_data) → returns 410 Gone JSON error
- [ ] **PHI Protection:** Response includes `Cache-Control: private, no-store` headers to prevent browser caching of medical records
- [ ] **MIME Normalization:** File with generic mimetype (application/octet-stream) AND valid extension → stored with correct mimetype inferred from extension
- [ ] **MIME Fallback:** File with no mimetype AND no extension → stored as application/octet-stream (acceptable fallback for edge case)
- [ ] **Long Filename MIME:** File with >64 char filename ending in `.pdf` + octet-stream mimetype → stored as `application/pdf` (handles truncation edge case)

#### Database Schema
- [ ] **Columns exist:** `\d patient_reports` shows `file_data BYTEA` and `file_mimetype TEXT`
- [ ] **Columns commented:** `\d+ patient_reports` shows description text for both columns
- [ ] **No broken constraints:** All existing tests pass (`npm test`)
- [ ] **TOAST working:** Large files (>2KB) automatically stored in TOAST table

#### Error Handling
- [ ] **Upload fails:** Transaction rolled back (no orphaned `file_data` without OCR results)
- [ ] **Retrieval error:** Returns 500 with clear JSON error (not database exception)
- [ ] **Invalid buffer:** Clear error message in logs (not silent failure)

#### Non-Functional
- [ ] **Performance:** Upload time increases <10% compared to pre-v3.4 (measure with 5MB PDF)
- [ ] **Storage:** Query confirms files stored: `SELECT COUNT(*) FROM patient_reports WHERE file_data IS NOT NULL;`
- [ ] **Monitoring:** Can measure total storage: `SELECT pg_size_pretty(SUM(octet_length(file_data))) FROM patient_reports;`
- [ ] **Query Audit:** All `SELECT *` queries updated to exclude `file_data` column
- [ ] **Memory Usage:** Existing endpoints (list/detail) don't load BLOBs (monitor with heap snapshots)

#### UI/UX
- [ ] **Button placement:** "View Original" button visible on results page, next to existing content
- [ ] **Button click:** Opens file in new browser tab
- [ ] **PDF rendering:** Browser displays PDF inline (not download prompt)
- [ ] **Image display:** Browser displays JPEG/PNG inline
- [ ] **HEIC handling:** HEIC files either display (Safari) or download (Chrome) - both acceptable
- [ ] **Error handling (legacy):** If file not available, server returns 410 Gone with JSON body (new tab shows error message, acceptable for Phase 1)
- [ ] **Performance:** No HEAD preflight - single GET request loads file directly (avoids double BLOB read from database)

### Test Scenarios

#### Scenario 1: Happy Path (Manual Upload)
1. Upload single PDF (3 MB) via main upload form
2. Wait for "✅ Done" status
3. Click "View" button → results page opens
4. Click "View Original" button → PDF opens in new tab
5. Verify PDF content matches uploaded file
6. Check database: `SELECT octet_length(file_data) FROM patient_reports WHERE source_filename = 'test.pdf';`
   - Expected: ~3000000 bytes

#### Scenario 2: Batch Upload
1. Select 3 files (2 PDFs, 1 JPEG)
2. Upload batch
3. Wait for all 3 to show "✅ Done"
4. Click "View" for each → verify "View Original" button works for all 3
5. Check database: `SELECT COUNT(*) FROM patient_reports WHERE file_data IS NOT NULL;`
   - Expected: 3

#### Scenario 3: Deduplication
1. Upload file "lab_results.pdf"
2. Wait for completion, note report_id and check extracted values (e.g., a specific lab parameter value)
3. Upload same file "lab_results.pdf" again
4. Wait for completion, should show "🔄 Duplicate" status
5. Check database: `SELECT COUNT(*) FROM patient_reports WHERE source_filename = 'lab_results.pdf';`
   - Expected: 1 (not 2)
6. Verify `processed_at` updated and `file_data` unchanged:
   ```sql
   SELECT processed_at, octet_length(file_data), raw_model_output
   FROM patient_reports
   WHERE id = '<report-id>';
   ```
   - `processed_at` should be recent (2nd upload timestamp)
   - `file_data` size should remain identical
   - `raw_model_output` updated to latest OCR run
7. Verify `lab_results` rows were re-extracted (values may differ if OCR improved)

#### Scenario 4: Gmail Integration
1. Run Gmail import (PRD v2.8 flow)
2. Select email with attachment
3. Ingest attachment
4. Verify `gmail_report_provenance` record created
5. Verify `patient_reports.file_data` populated
6. Click "View Original" → attachment displays

#### Scenario 5: Gmail MIME Normalization
1. Run Gmail import (PRD v2.8 flow)
2. Select email with PDF attachment
3. Verify Gmail API returns `application/octet-stream` (common behavior)
4. Ingest attachment
5. Check database: `SELECT file_mimetype FROM patient_reports WHERE id = '<report-id>';`
   - Expected: `application/pdf` (NOT `application/octet-stream`)
6. Click "View Original" → PDF renders in browser (not download as binary)

#### Scenario 6: Error Handling (410 Gone)
1. Manually set `file_data = NULL` for existing report:
   ```sql
   UPDATE patient_reports SET file_data = NULL WHERE id = '<some-uuid>';
   ```
2. Navigate to results page for that report
3. Click "View Original" button → opens new tab
4. Verify 410 Gone JSON error displays in browser (not 500 or silent failure)
5. Verify error response body contains clear message: "Original file not available"

### Performance Benchmarks

**Baseline (Pre-v3.4):**
- Single 5MB PDF upload: ~8 seconds (OCR + persistence)
- Batch 10 files: ~35 seconds (throttled concurrency = 3)

**Target (Post-v3.4):**
- Single 5MB PDF upload: <9 seconds (<12% increase)
- Batch 10 files: <40 seconds (<15% increase)

**Measurement Method:**
```javascript
// Add timing logs to labReportProcessor.js
console.time('persistence');
await persistLabReport({ ... });
console.timeEnd('persistence');
// Expected: 50-150ms (includes file storage)
```

---

## Deployment Checklist

### Pre-Deployment
- [ ] Code reviewed and approved
- [ ] All acceptance criteria tests pass
- [ ] Database backup created (if not fresh DB)
- [ ] Schema changes reviewed by DBA (if applicable)
- [ ] Frontend tested in Chrome, Safari, Firefox

### Deployment Steps
1. [ ] Merge feature branch to `main`
2. [ ] Pull latest code on server: `git pull origin main`
3. [ ] Install dependencies (if any): `npm install`
4. [ ] Reset database:
   - Admin Panel → "Reset Database"
   - OR CLI: `npm run dev` (schema auto-applies)
5. [ ] Restart application: `npm run dev` or `pm2 restart healthup`
6. [ ] Verify schema applied: `psql healthup -c "\d+ patient_reports"`
7. [ ] Run smoke tests:
   - Upload single PDF → verify storage
   - Click "View Original" → verify retrieval

### Post-Deployment
- [ ] Monitor error logs for 24 hours
- [ ] Check storage growth: Run monitoring query daily for 1 week
- [ ] Verify no performance degradation (upload times)
- [ ] User acceptance testing (if applicable)

### Rollback Plan

**Phase 1:** Fresh database with test data only.

**If Issues Arise:**
1. Stop application
2. Revert code: `git revert <commit-hash>`
3. Reset database via Admin Panel
4. Restart application

---

## Performance Considerations

### Database Operations

**No New Indexes Required:**
- File retrieval uses existing primary key index on `patient_reports.id`
- Analytics queries (storage summaries) acceptable as sequential scans (infrequent)
- BYTEA columns cannot be indexed (PostgreSQL limitation)

**TOAST (The Oversized-Attribute Storage Technique):**
- Automatically enabled for `file_data` column
- Values >2KB stored in separate `pg_toast.pg_toast_XXXXX` table
- Transparent to application code (PostgreSQL handles internally)
- Benefits: Main table stays small, reduces I/O for queries without `file_data`

### Query Optimization (CRITICAL)

**Problem:** Adding BYTEA column affects ALL existing queries using `SELECT *` or `SELECT pr.*`

**BAD - Pulls entire BLOB into memory unnecessarily:**
```javascript
// Existing pattern that will break with large BLOBs
const result = await pool.query(
  'SELECT * FROM patient_reports WHERE patient_id = $1',
  [patientId]
);
// Now loads 10MB+ per row into Node.js memory!
```

**GOOD - Explicit column list excludes BLOB:**
```javascript
// Updated pattern - explicitly exclude file_data
const result = await pool.query(
  `SELECT id, patient_id, source_filename, file_mimetype,
          checksum, parser_version, status, recognized_at,
          processed_at, test_date_text, patient_name_snapshot,
          patient_age_snapshot, patient_gender_snapshot,
          patient_date_of_birth_snapshot, raw_model_output,
          missing_data, created_at, updated_at
   FROM patient_reports
   WHERE patient_id = $1`,
  [patientId]
);
// file_data excluded - no BLOB in memory
```

**Action Required:**
- **Audit:** Search codebase for `SELECT * FROM patient_reports` and `SELECT pr.*`
- **Update:** Replace with explicit column lists that exclude `file_data`
- **Review:** Check any ORM/query builders that might auto-select all columns

**Common Locations to Check:**
- `server/services/reportRetrieval.js` - Report detail queries
- `server/routes/reports.js` - List/search endpoints
- `server/services/admin*.js` - Admin panel queries
- Any analytics/reporting queries

**Only include `file_data` when:**
- Serving the original file via `/api/patient-reports/:reportId/original-file`
- Never for list/search/detail JSON responses

### Upload Flow

**Current Flow (Pre-v3.4):**
1. User selects file → browser uploads (~2-5 seconds for 5MB)
2. Server returns 202 Accepted with `job_id` (~50ms)
3. Background OCR processing (~5-10 seconds)
4. Database persistence (~20ms for metadata only)

**New Flow (Post-v3.4):**
1. User selects file → browser uploads (~2-5 seconds, unchanged)
2. Server returns 202 Accepted with `job_id` (~50ms, unchanged)
3. Background OCR processing (~5-10 seconds, unchanged)
4. Database persistence (~50ms for metadata + file binary)

**Impact:** +30ms per upload (BYTEA INSERT overhead), imperceptible to user.

### No UI Progress Changes Needed

File storage happens during database transaction (part of "Saving results" phase in progress UI). Existing job polling covers entire flow including file persistence. No additional progress indicators needed.

---

## Future Considerations (Out of Scope for Phase 1)

### Potential Phase 2 Features

**File Re-Processing:**
- Endpoint to trigger re-analysis of stored file with newer OCR model
- `POST /api/patient-reports/:reportId/reprocess`
- Updates OCR results, preserves original `file_data`

**External Object Storage Migration:**
- When database exceeds 100GB, migrate files to S3/Azure Blob
- Store object URL in new `file_storage_url` column
- Keep deduplication logic, change retrieval to proxy from S3

**Compression:**
- Compress PDFs before storage (can reduce size 20-40%)
- Trade-off: CPU cost vs. storage savings
- HEIC already compressed (don't re-compress)

**Retention Policies:**
- Archive files after 7 years (move to cold storage)
- Delete files after 10 years (keep metadata)
- `file_data_archived_at TIMESTAMPTZ` column

**Access Control:**
- Multi-tenant support (check patient ownership)
- Role-based access (admin vs. patient vs. doctor)
- Audit log for file access (HIPAA compliance)

**Advanced Retrieval:**
- HTTP Range requests (stream large files)
- Thumbnail generation (preview without downloading)
- CDN caching headers (reduce database load)

### Migration to Live Systems (Phase 2)

**Out of scope for Phase 1.** Separate PRD required for production migration with existing data.

---

## Success Metrics

**Week 1:**
- 100% of uploads have `file_data` populated
- Zero file retrieval errors
- Upload performance within 15% of baseline

**Month 1:**
- Storage growth matches projections (±20%)
- Zero data loss incidents

---

## Appendix

### Related PRDs
- PRD v2.8: Gmail Integration
- PRD v3.0: Unified Upload and Ingestion
- PRD v2.4: Analyte Mapping Write Mode

### Technical Reference
- **BYTEA:** PostgreSQL binary data type, max 1GB
- **TOAST:** PostgreSQL auto-compression for values >2KB
- **Deduplication:** SHA-256 checksum-based (64 hex chars)
- **Constraints:** 10MB per file, 100MB per batch

### SQL Helper Queries

**Find largest files:**
```sql
SELECT
  id,
  source_filename,
  pg_size_pretty(octet_length(file_data)) as file_size,
  recognized_at
FROM patient_reports
WHERE file_data IS NOT NULL
ORDER BY octet_length(file_data) DESC
LIMIT 10;
```

**Storage by file type:**
```sql
SELECT
  CASE
    WHEN source_filename LIKE '%.pdf' THEN 'PDF'
    WHEN source_filename LIKE '%.jpg' OR source_filename LIKE '%.jpeg' THEN 'JPEG'
    WHEN source_filename LIKE '%.png' THEN 'PNG'
    WHEN source_filename LIKE '%.heic' THEN 'HEIC'
    ELSE 'Other'
  END as file_type,
  COUNT(*) as count,
  pg_size_pretty(SUM(octet_length(file_data))) as total_size,
  pg_size_pretty(AVG(octet_length(file_data))) as avg_size
FROM patient_reports
WHERE file_data IS NOT NULL
GROUP BY file_type
ORDER BY SUM(octet_length(file_data)) DESC;
```

**Daily upload volume:**
```sql
SELECT
  DATE(recognized_at) as upload_date,
  COUNT(*) as uploads,
  pg_size_pretty(SUM(octet_length(file_data))) as total_size
FROM patient_reports
WHERE file_data IS NOT NULL
GROUP BY DATE(recognized_at)
ORDER BY upload_date DESC
LIMIT 30;
```

---

---

**Status:** ✅ Ready for Implementation
**Effort:** 1 day (middle SE)
