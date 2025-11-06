# PRD — Gmail Integration (Step-3)

**Scope:** User-controlled download + OCR ingestion of Gmail attachments confirmed in Step-2, with integrated debug tables for Steps 1–3 and automatic redirection to a dedicated results view after processing.
**Model:** Vision/OCR provider via existing `VisionProviderFactory` (OpenAI or Anthropic).
**Mode:** Dev-only, feature-flagged.

**Status:** Implementation-Ready (Final)
**Version:** 2.6
**Last Updated:** 2025-11-06

---

## 1. Objective

Expand the Gmail integration to the full ingestion loop:

1. Retain visibility into **Step 1 (subject/sender classification)** and **Step 2 (body + attachment metadata classification)**.
2. In a new **Step 3 view**, list all Step-2 emails with attachment selection checkboxes.
3. Let the user **select which attachments to download and ingest**.
4. Download, OCR, and persist them through the same pipeline used for manual uploads.
5. Track per-attachment progress with detailed status updates.
6. When all chosen attachments finish processing, **redirect to a dedicated results page** showing the outcome of the batch ingestion.

---

## 2. Goals

- ✅ Maintain full debug visibility of Step 1 & 2 tables.
- ✅ Display all Step-2 emails again in Step-3, with duplicate indicators (by filename, size, and SHA-256 hash).
- ✅ Add a **selection checkbox** per attachment and a **"Download & Recognize Selected"** button.
- ✅ Execute ingestion in parallel with controlled concurrency, tracking **per-attachment progress** (queued → downloading → processing → completed/failed).
- ✅ On completion, automatically redirect to a dedicated **results page** showing all ingested reports with success/failure status.
- ✅ Reuse existing ingestion logic: `labReportProcessor`, `MappingApplier`, `reportPersistence`.
- ✅ Keep Gmail read-only; attachments processed transiently, never stored beyond ingestion.
- ✅ Compute SHA-256 checksums for idempotent persistence and duplicate detection (provenance skip + checksum-aware upsert).
- ✅ Store Gmail provenance data (message ID, sender, subject, etc.) for audit trail.

---

## 3. Non-Goals

- ❌ Automatic ingestion of all attachments (user must choose).
- ❌ Modifying or labeling Gmail messages.
- ❌ Modifying the main HealthUp `index.html` page to highlight Gmail reports.
- ❌ Multi-user support or production enablement (dev-only).
- ❌ Real-time streaming (polling-based progress updates are sufficient for MVP).

---

## 4. Flow Overview

### A — UI Overview

| Step | Purpose | Visible Data |
|------|----------|--------------|
| **Step 1** | Raw subject/sender classification | All 200 emails fetched |
| **Step 2** | Body + attachment analysis | Reduced list of potential lab results |
| **Step 3** | Attachment ingestion | All Step-2 emails + duplicate marks + selection checkboxes + progress tracking |

All three remain visible on the Gmail-Dev page (`/gmail-dev.html`), with collapsible sections for clarity.

---

### B — Attachment Selection & Batch Start

1. User reviews Step-3 table showing all Step-2 attachments.
2. User checks attachments to process (can select duplicates if desired).
3. Clicks **"Download & Recognize Selected"**.
4. Front-end sends:
   ```json
   {
     "selections": [
       {
         "messageId": "message-123",
         "attachmentId": "0.1",
         "filename": "lab.pdf",
         "mimeType": "application/pdf",
         "size": 123456
       }
     ]
   }
   ```
   to `POST /api/dev-gmail/ingest`.
5. Backend validates Gmail token, verifies mime type & size, then queues attachments with controlled concurrency (5 concurrent downloads).

---

### C — Attachment Ingestion Pipeline (Per Attachment)

1. **Status: Queued**
   - Attachment added to in-memory processing queue.

2. **Status: Downloading** (Progress: 0-30%)
   - Gmail API `users.messages.attachments.get` → decode base64 → in-memory buffer.
   - Handle rate limits: 5 concurrent downloads max, exponential backoff on 429.
   - Handle OAuth token expiry: auto-refresh if <5 min remaining.
   - Before calling Gmail API, short-circuit if `(message_id, attachment_id)` already exists in `gmail_report_provenance` (Status → `duplicate`).

3. **Status: Processing - Computing Hash** (Progress: 30-40%)
   - Compute SHA-256 checksum from buffer.
   - **Checksum duplicate check (pre-OCR):**
     - Query `gmail_report_provenance` table for matching `attachment_checksum`.
     - If found: mark as "Duplicate (checksum)" → skip OCR → reuse existing report ID.
     - If not found: proceed to OCR.

4. **Status: Processing - OCR** (Progress: 40-80%)
   - Create job in `jobManager` for `labReportProcessor`.
   - Stream buffer to `labReportProcessor.processLabReport()` (same path as manual upload).
   - Vision provider extracts structured data via OCR.
   - Progress updates from `labReportProcessor` (validation → image prep → OCR → parsing).

5. **Status: Processing - Persisting** (Progress: 80-95%)
   - `reportPersistence.upsertPatient()` → get `patient_id` from extracted data.
   - Upsert into `patient_reports` table with checksum via `ON CONFLICT (patient_id, checksum) DO UPDATE`.
   - **Duplicate handling:** If checksum already exists for this patient, existing report is updated (idempotent).
   - `MappingApplier` runs to normalize analytes.
   - Check if insert or update occurred (via `(xmax = 0) AS inserted` in RETURNING clause).

6. **Status: Saving Provenance** (Progress: 95-100%)
   - Insert into `gmail_report_provenance` table:
     - `report_id`, `message_id`, `attachment_id`, `sender_email`, `sender_name`, `email_subject`, `email_date`, `attachment_checksum`.

7. **Status: Completed or Updated** (Progress: 100%)
   - If new report inserted: mark job as `completed` with `reportId`.
   - If existing report updated: mark job as `updated` with `reportId`.
   - Remove buffer from memory.

8. **Status: Failed** (Any stage)
   - Mark job as `failed` with error reason.
   - Examples: "OAuth token expired", "Unsupported file type", "OCR extraction failed", "Gmail API rate limit exceeded".

---

### D — UI Progress & Completion

**Step-3 Table Columns:**

| Column | Description |
|---------|------------|
| ✅ **Select** | Checkbox for batch selection |
| 📎 **Email Details** | Sender, Subject, Date |
| 📄 **Filename** | Attachment filename |
| 📊 **Size** | Human-readable size (e.g., "1.2 MB") |
| 🔄 **Duplicate** | Icon if detected by filename+size (pre-download heuristic) |
| 🧠 **Status** | Queued → Downloading → Processing → Completed / Updated / Failed / Duplicate |
| 📈 **Progress** | 0-100% progress bar |
| 📝 **Details** | Current action (e.g., "Extracting data with OCR") or error message |

**Progress Polling:**
- Frontend polls `GET /api/dev-gmail/jobs/summary` every 2 seconds.
- Timeout: 300 attempts = 10 minutes (after which, mark stuck jobs as failed).

**Completion Behavior:**
- When all selected attachments reach terminal state (completed/updated/failed/duplicate):
  - Show summary modal: "Processed X attachments: Y succeeded (Z new, W updated), V failed, U duplicates".
  - Auto-redirect (3s delay) to `/gmail-results.html?batchId=[batchId]`.

**Gmail Results Page (`gmail-results.html`):**
- Shows summary of batch ingestion:
  - List of all processed attachments with final status.
  - Links to successfully ingested reports (opens report detail page).
  - Error messages for failed attachments.
  - "Back to Gmail Dev" button → returns to `/gmail-dev.html`.
  - "View All Reports" button → goes to `/index.html`.

---

## 5. Backend Implementation

### 5.1 New Service: `server/services/gmailAttachmentIngest.js`

**Purpose:** Orchestrates attachment download, duplicate detection, and ingestion pipeline.

**Architecture:**
- **Not a class-based service** (keeps consistency with existing services).
- **Stateful in-memory tracker** for batch progress (separate from `jobManager`).
- **Integrates with existing services:** `gmailConnector`, `labReportProcessor`, `reportPersistence`, `MappingApplier`.

**Key Functions:**

```javascript
const gmailConnector = require('./gmailConnector');
const { google } = require('googleapis');
const crypto = require('crypto');
const jobManager = require('../utils/jobManager');
const labReportProcessor = require('./labReportProcessor');
const { pool } = require('../db');

// Helper: Sleep for async delays
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Configuration constants
const GMAIL_DOWNLOAD_CONCURRENCY = Math.max(
  1,
  parseInt(process.env.GMAIL_DOWNLOAD_CONCURRENCY || '5', 10)
); // Safe default: 5 req/s × 25 units = 125 units/s (limit: 250)
const RETRY_CONFIG = { maxAttempts: 3, baseDelay: 1000 }; // 1s, 2s, 4s
const ATTACHMENT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// In-memory attachment tracking (simple Map, not persistent)
const attachmentJobs = new Map(); // attachmentId → { status, progress, progressMessage, jobId, reportId, error, ... }

/**
 * Start batch ingestion of selected attachments
 * @param {Array} selections - Array of { messageId, attachmentId, filename, mimeType, size }
 * @returns {Object} - { batchId, count }
 */
async function startBatchIngestion(selections) {
  const batchId = `batch_${Date.now()}`; // e.g., "batch_1730900000000"

  // Ensure Gmail is authenticated (tokens loaded)
  const authenticated = await gmailConnector.isAuthenticated();
  if (!authenticated) {
    throw new Error('Gmail not authenticated');
  }

  // Validate selections (mime type, size limits)
  const allowedMimes = (process.env.GMAIL_ALLOWED_MIME || 'application/pdf,image/png,image/jpeg,image/tiff').split(',');
  const maxBytes = parseInt(process.env.GMAIL_MAX_ATTACHMENT_MB || '15') * 1024 * 1024;

  const validSelections = selections.filter(sel => {
    if (!allowedMimes.includes(sel.mimeType)) {
      console.warn(`Skipping ${sel.filename}: unsupported MIME type ${sel.mimeType}`);
      return false;
    }
    if (sel.size > maxBytes) {
      console.warn(`Skipping ${sel.filename}: file too large (${Math.round(sel.size / 1024 / 1024)}MB)`);
      return false;
    }
    return true;
  });

  // Initialize tracking for each attachment
  validSelections.forEach(sel => {
    const trackingId = `${sel.messageId}_${sel.attachmentId}`;
    attachmentJobs.set(trackingId, {
      batchId,
      messageId: sel.messageId,
      attachmentId: sel.attachmentId,
      filename: sel.filename,
      mimeType: sel.mimeType,
      size: sel.size,
      status: 'queued',
      progress: 0,
      progressMessage: 'Waiting to start...',
      jobId: null,
      reportId: null,
      error: null,
      startedAt: null,
      completedAt: null
    });
  });

  // Start processing with controlled concurrency
  processAttachmentsWithConcurrency(validSelections, batchId);

  return { batchId, count: validSelections.length };
}

/**
 * Process attachments with concurrency limit (to avoid Gmail rate limits)
 */
async function processAttachmentsWithConcurrency(selections, batchId) {
  const pLimit = require('p-limit');
  const limit = pLimit(GMAIL_DOWNLOAD_CONCURRENCY); // Defaults to 5 concurrent downloads

  const promises = selections.map(sel =>
    limit(() => ingestAttachment(sel, batchId))
  );

  await Promise.allSettled(promises);
}

/**
 * Ingest a single attachment through the full pipeline
 */
async function ingestAttachment(selection, batchId) {
  const trackingId = `${selection.messageId}_${selection.attachmentId}`;
  const tracking = attachmentJobs.get(trackingId);

  // Get authenticated Gmail client from connector
  // NOTE: Requires new export in gmailConnector.js
  const gmail = await gmailConnector.getAuthenticatedGmailClient();

  try {
    tracking.startedAt = Date.now();

    // Step 1: Check if this Gmail attachment was already processed in a previous batch
    updateStatus(trackingId, 'queued', 5, 'Checking for cross-batch duplicates...');
    const existingProvenance = await checkGmailProvenanceExists(selection.messageId, selection.attachmentId);
    if (existingProvenance) {
      updateStatus(trackingId, 'duplicate', 100, 'Already ingested in previous batch');
      tracking.reportId = existingProvenance.report_id;
      tracking.completedAt = Date.now();
      return;
    }

    // Step 2: Download attachment
    updateStatus(trackingId, 'downloading', 10, 'Downloading from Gmail...');
    const buffer = await downloadAttachmentWithRetry(gmail, selection.messageId, selection.attachmentId);

    // Step 3: Compute SHA-256 checksum + short-circuit if we've already OCR'd this payload
    updateStatus(trackingId, 'processing', 30, 'Computing checksum...');
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
    const existingChecksumProvenance = await checkChecksumAlreadyProcessed(checksum);
    if (existingChecksumProvenance) {
      updateStatus(trackingId, 'duplicate', 100, 'Checksum already ingested');
      tracking.reportId = existingChecksumProvenance.report_id;
      tracking.completedAt = Date.now();
      return;
    }

    // Step 4: Create job in jobManager for labReportProcessor
    updateStatus(trackingId, 'processing', 40, 'Starting OCR extraction...');
    const jobId = jobManager.createJob('gmail-attachment', {
      filename: selection.filename,
      messageId: selection.messageId,
      attachmentId: selection.attachmentId
    });
    tracking.jobId = jobId;

    // Step 5: Process via labReportProcessor
    await labReportProcessor.processLabReport({
      jobId,
      fileBuffer: buffer,
      mimetype: selection.mimeType,
      filename: selection.filename,
      fileSize: buffer.length
    });

    // Step 6: Get result from jobManager
    const job = jobManager.getJob(jobId);

    if (job.status === 'failed') {
      updateStatus(trackingId, 'failed', 0, job.error || 'OCR processing failed');
      return;
    }

    if (job.status !== 'completed' || !job.result?.report_id) {
      updateStatus(trackingId, 'failed', 0, 'Unexpected job state');
      return;
    }

    // Step 7: Determine if this was a new insert or update of existing report
    // Use PostgreSQL xmax trick to detect insert vs update
    const wasUpdate = await checkIfReportWasUpdated(job.result.report_id);

    // Step 8: Save Gmail provenance
    updateStatus(trackingId, 'processing', 95, 'Saving provenance...');

    // Fetch email metadata (sender, subject, date) from Gmail
    const emailMetadata = await fetchEmailMetadata(gmail, selection.messageId);

    await saveGmailProvenance({
      reportId: job.result.report_id,
      messageId: selection.messageId,
      attachmentId: selection.attachmentId,
      checksum,
      senderEmail: emailMetadata.from.email,
      senderName: emailMetadata.from.name,
      emailSubject: emailMetadata.subject,
      emailDate: emailMetadata.date
    });

    // Step 9: Mark completed or updated
    if (wasUpdate) {
      updateStatus(trackingId, 'updated', 100, 'Updated existing report');
    } else {
      updateStatus(trackingId, 'completed', 100, 'Successfully ingested');
    }
    tracking.reportId = job.result.report_id;
    tracking.completedAt = Date.now();

  } catch (error) {
    console.error(`Attachment ingestion failed: ${selection.filename}`, error);

    // Handle specific errors
    let errorMessage = error.message;
    if (error.code === 401) {
      errorMessage = 'Gmail authentication expired. Please reconnect.';
    } else if (error.code === 429) {
      errorMessage = 'Gmail API rate limit exceeded. Please try again later.';
    }

    updateStatus(trackingId, 'failed', 0, errorMessage);
  }
}

/**
 * Download attachment with retry logic for rate limits
 */
async function downloadAttachmentWithRetry(gmail, messageId, attachmentId, attempt = 1) {
  try {
    const response = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId,
      id: attachmentId
    });

    // Decode base64url to buffer
    const buffer = Buffer.from(response.data.data, 'base64url');
    return buffer;

  } catch (error) {
    if (error.code === 429 && attempt <= RETRY_CONFIG.maxAttempts) {
      // Exponential backoff: 1s, 2s, 4s
      const delay = RETRY_CONFIG.baseDelay * Math.pow(2, attempt - 1);
      console.log(`Rate limited, retrying in ${delay}ms (attempt ${attempt}/${RETRY_CONFIG.maxAttempts})`);
      await sleep(delay);
      return downloadAttachmentWithRetry(gmail, messageId, attachmentId, attempt + 1);
    }
    throw error;
  }
}

/**
 * Check if this Gmail attachment was already ingested in a previous batch
 */
async function checkGmailProvenanceExists(messageId, attachmentId) {
  const result = await pool.query(`
    SELECT report_id FROM gmail_report_provenance
    WHERE message_id = $1 AND attachment_id = $2
  `, [messageId, attachmentId]);
  return result.rows[0] || null;
}

/**
 * Check if we've already persisted the exact same attachment payload (checksum match)
 */
async function checkChecksumAlreadyProcessed(checksum) {
  const result = await pool.query(`
    SELECT report_id FROM gmail_report_provenance
    WHERE attachment_checksum = $1
    ORDER BY ingested_at DESC
    LIMIT 1
  `, [checksum]);

  return result.rows[0] || null;
}

/**
 * Check if the report was an update (vs new insert) using PostgreSQL xmax trick
 * xmax = 0 means the row was inserted (not updated)
 * xmax > 0 means the row was updated
 */
async function checkIfReportWasUpdated(reportId) {
  const result = await pool.query(`
    SELECT (xmax = 0) AS is_new_insert
    FROM patient_reports
    WHERE id = $1
  `, [reportId]);

  const isNew = result.rows[0]?.is_new_insert ?? true;
  return !isNew; // Return true if it was an update, false if new insert
}

/**
 * Fetch email metadata (sender, subject, date) from Gmail
 */
async function fetchEmailMetadata(gmail, messageId) {
  const response = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'metadata',
    metadataHeaders: ['From', 'Subject', 'Date']
  });

  const headers = response.data.payload.headers;
  const from = parseFromHeader(headers.find(h => h.name === 'From')?.value || '');
  const subject = headers.find(h => h.name === 'Subject')?.value || '(No subject)';
  const date = headers.find(h => h.name === 'Date')?.value || null;

  return { from, subject, date: date ? new Date(date) : null };
}

/**
 * Parse "From" header into { name, email }
 */
function parseFromHeader(fromValue) {
  // Example: "John Doe <john@example.com>" or "john@example.com"
  const match = fromValue.match(/^(.*?)\s*<(.+?)>$/) || fromValue.match(/^(.+)$/);
  if (match) {
    if (match[2]) {
      return { name: match[1].trim(), email: match[2].trim() };
    } else {
      return { name: '', email: match[1].trim() };
    }
  }
  return { name: '', email: '' };
}

/**
 * Save Gmail provenance to database
 */
async function saveGmailProvenance(data) {
  await pool.query(`
    INSERT INTO gmail_report_provenance (
      report_id, message_id, attachment_id, sender_email, sender_name,
      email_subject, email_date, attachment_checksum
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (message_id, attachment_id) DO NOTHING
  `, [
    data.reportId,
    data.messageId,
    data.attachmentId,
    data.senderEmail,
    data.senderName,
    data.emailSubject,
    data.emailDate,
    data.checksum
  ]);
}

/**
 * Update attachment status in tracking map
 */
function updateStatus(trackingId, status, progress, progressMessage) {
  const tracking = attachmentJobs.get(trackingId);
  if (tracking) {
    tracking.status = status;
    tracking.progress = progress;
    tracking.progressMessage = progressMessage;
    tracking.error = status === 'failed' ? progressMessage : null;
  }
}

/**
 * Get current status of all attachments in a batch
 */
function getBatchSummary(batchId) {
  const attachments = Array.from(attachmentJobs.values())
    .filter(job => job.batchId === batchId);

  // Terminal states: attachment processing is complete (successfully or not)
  const TERMINAL_STATES = ['completed', 'updated', 'failed', 'duplicate'];

  const completedCount = attachments.filter(a =>
    TERMINAL_STATES.includes(a.status)
  ).length;

  const allComplete = completedCount === attachments.length;

  // Batch succeeded if all attachments are completed or updated (not failed/duplicate only)
  const SUCCESS_STATES = ['completed', 'updated'];
  const batchStatus = allComplete
    ? (attachments.every(a => SUCCESS_STATES.includes(a.status)) ? 'completed' : 'partial_failure')
    : 'processing';

  return {
    attachments: attachments.map(a => ({
      attachmentId: a.attachmentId,
      filename: a.filename,
      status: a.status,
      progress: a.progress,
      progressMessage: a.progressMessage,
      jobId: a.jobId,
      reportId: a.reportId,
      error: a.error
    })),
    batchStatus,
    completedCount,
    totalCount: attachments.length,
    allComplete
  };
}

module.exports = {
  startBatchIngestion,
  getBatchSummary,
  attachmentJobs // Exported for testing/debugging
};
```

---

### 5.2 Required Changes to `server/services/gmailConnector.js`

**Purpose:** Add a new export to allow Step 3 to access authenticated Gmail API client.

**Context:** This function should be added to the existing `gmailConnector.js` file which already has:
- `const { google } = require('googleapis');` at the top (line 7)
- `let oauth2Client = null;` module-level variable (line 42)
- `isAuthenticated()` function already defined

**New Function to Add:**

```javascript
/**
 * Get authenticated Gmail API client for direct use
 * Must be called after isAuthenticated() to ensure tokens are loaded
 * @returns {Promise<gmail_v1.Gmail>} Authenticated Gmail API client
 * @throws {Error} If not authenticated
 */
async function getAuthenticatedGmailClient() {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    throw new Error('Gmail not authenticated. Call isAuthenticated() first.');
  }

  if (!oauth2Client) {
    throw new Error('OAuth client not initialized');
  }

  // Uses existing top-level `google` import (line 7 of gmailConnector.js)
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  return gmail;
}
```

**Module Exports Update:**

```javascript
module.exports = {
  getAuthUrl,
  handleOAuthCallback,
  loadCredentials,
  isAuthenticated,
  getOAuth2Client,
  fetchEmailMetadata,
  fetchFullEmailsByIds,
  getAuthenticatedGmailClient  // NEW: Add this export
};
```

**Why This Is Needed:**
- Existing `getOAuth2Client()` returns status object `{ connected, email }`, not the OAuth client
- Step 3 needs direct access to Gmail API for `users.messages.attachments.get()`
- This pattern avoids duplicating OAuth setup and token management
- Reuses existing `oauth2Client` with auto-refresh listener already configured

**Usage Pattern in Step 3:**
```javascript
// In gmailAttachmentIngest.js
const gmailConnector = require('./gmailConnector');

// Ensure authenticated
await gmailConnector.isAuthenticated(); // Load tokens

// Get Gmail client for API calls
const gmail = await gmailConnector.getAuthenticatedGmailClient();

// Use Gmail API
const response = await gmail.users.messages.attachments.get({
  userId: 'me',
  messageId,
  id: attachmentId
});
```

---

### 5.3 New Route: `POST /api/dev-gmail/ingest`

**File:** `server/routes/gmailDev.js` (extend existing)

**Request:**
```json
{
  "selections": [
    {
      "messageId": "18f5b1c2d3e4f5g6",
      "attachmentId": "ANGjdJ8...",
      "filename": "lab_results.pdf",
      "mimeType": "application/pdf",
      "size": 123456
    }
  ]
}
```

**Response (Success):**
```json
{
  "success": true,
  "batchId": "batch_1730900000000",
  "count": 5,
  "message": "Started ingestion of 5 attachments"
}
```

**Response (Error):**
```json
{
  "success": false,
  "error": "Gmail authentication required"
}
```

**Implementation:**

**Add to top of `server/routes/gmailDev.js`** (with other requires):
```javascript
const gmailAttachmentIngest = require('../services/gmailAttachmentIngest');
```

**Route handler:**
```javascript
router.post('/ingest', async (req, res) => {
  if (!process.env.GMAIL_ATTACHMENT_INGEST_ENABLED) {
    return res.status(403).json({
      success: false,
      error: 'Attachment ingestion is not enabled'
    });
  }

  try {
    // Check authentication status
    const authenticated = await isAuthenticated();
    if (!authenticated) {
      return res.status(401).json({
        success: false,
        error: 'Gmail authentication required'
      });
    }

    const { selections } = req.body;

    if (!Array.isArray(selections) || selections.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No attachments selected'
      });
    }

    // Validate batch size limit
    if (selections.length > parseInt(process.env.GMAIL_BATCH_MAX_ATTACHMENTS || '20')) {
      return res.status(400).json({
        success: false,
        error: `Batch size exceeds limit of ${process.env.GMAIL_BATCH_MAX_ATTACHMENTS || 20} attachments`
      });
    }

    // Validate each selection
    for (const sel of selections) {
      if (!sel.messageId || !sel.attachmentId || !sel.filename || !sel.mimeType) {
        return res.status(400).json({
          success: false,
          error: 'Invalid attachment data'
        });
      }

      // Validate MIME type
      const allowedMimes = (process.env.GMAIL_ALLOWED_MIME || 'application/pdf,image/png,image/jpeg,image/tiff').split(',');
      if (!allowedMimes.includes(sel.mimeType)) {
        return res.status(400).json({
          success: false,
          error: `Unsupported file type: ${sel.mimeType}`
        });
      }

      // Validate size
      const maxBytes = parseInt(process.env.GMAIL_MAX_ATTACHMENT_MB || '15') * 1024 * 1024;
      if (sel.size > maxBytes) {
        return res.status(400).json({
          success: false,
          error: `File too large: ${sel.filename} (${Math.round(sel.size / 1024 / 1024)}MB)`
        });
      }
    }

    // Start batch ingestion (gmailConnector is passed as dependency)
    const result = await gmailAttachmentIngest.startBatchIngestion(selections);

    res.json({
      success: true,
      batchId: result.batchId,
      count: result.count,
      message: `Started ingestion of ${result.count} attachment${result.count > 1 ? 's' : ''}`
    });

  } catch (error) {
    console.error('Failed to start attachment ingestion:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to start ingestion'
    });
  }
});
```

---

### 5.4 New Route: `GET /api/dev-gmail/jobs/summary`

**Query Parameters:**
- `batchId` (required): The batch ID returned from `/ingest`

**Response:**
```json
{
  "batchStatus": "processing",
  "completedCount": 3,
  "totalCount": 5,
  "allComplete": false,
  "attachments": [
    {
      "attachmentId": "ANGjdJ8...",
      "filename": "lab_results.pdf",
      "status": "completed",
      "progress": 100,
      "progressMessage": "Successfully ingested",
      "jobId": "job_abc123",
      "reportId": "uuid-1234-5678",
      "error": null
    },
    {
      "attachmentId": "ANGjdJ9...",
      "filename": "blood_test.pdf",
      "status": "processing",
      "progress": 65,
      "progressMessage": "Extracting data with OCR",
      "jobId": "job_def456",
      "reportId": null,
      "error": null
    },
    {
      "attachmentId": "ANGjdJ0...",
      "filename": "duplicate.pdf",
      "status": "duplicate",
      "progress": 100,
      "progressMessage": "Duplicate of existing report for John Doe",
      "jobId": null,
      "reportId": "uuid-existing",
      "error": null
    },
    {
      "attachmentId": "ANGjdJ1...",
      "filename": "corrupt.pdf",
      "status": "failed",
      "progress": 0,
      "progressMessage": "OCR extraction failed",
      "jobId": "job_ghi789",
      "reportId": null,
      "error": "No valid data extracted from document"
    },
    {
      "attachmentId": "ANGjdJ2...",
      "filename": "pending.pdf",
      "status": "queued",
      "progress": 0,
      "progressMessage": "Waiting to start...",
      "jobId": null,
      "reportId": null,
      "error": null
    }
  ]
}
```

**Implementation:**

**Note:** Requires the same import added in Section 5.3 above:
```javascript
const gmailAttachmentIngest = require('../services/gmailAttachmentIngest');
```

**Route handler:**
```javascript
router.get('/jobs/summary', async (req, res) => {
  try {
    const { batchId } = req.query;

    if (!batchId) {
      return res.status(400).json({
        success: false,
        error: 'batchId is required'
      });
    }

    const summary = gmailAttachmentIngest.getBatchSummary(batchId);

    // Also update progress from jobManager for attachments currently being processed
    for (const attachment of summary.attachments) {
      if (attachment.jobId && attachment.status === 'processing') {
        const job = jobManager.getJob(attachment.jobId);
        if (job) {
          attachment.progress = job.progress || attachment.progress;
          attachment.progressMessage = job.progressMessage || attachment.progressMessage;
        }
      }
    }

    res.json(summary);

  } catch (error) {
    console.error('Failed to get job summary:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get job summary'
    });
  }
});
```

---

### 5.5 Route Changes Summary

**File: `server/routes/gmailDev.js`**

**Required Import (add to top of file with other requires):**
```javascript
const gmailAttachmentIngest = require('../services/gmailAttachmentIngest');
```

**New Routes to Add:**
- `POST /api/dev-gmail/ingest` → Start batch ingestion
- `GET /api/dev-gmail/jobs/summary` → Get batch progress

**Existing Routes (no changes):**
- `GET /api/dev-gmail/auth-url` → Get OAuth URL
- `GET /api/dev-gmail/oauth-callback` → Handle OAuth callback
- `POST /api/dev-gmail/fetch-and-classify` → Run Step 1 + Step 2
- `GET /api/dev-gmail/jobs/:jobId` → Get job status (keep for backward compatibility)

---

## 6. Frontend Implementation

### 6.1 Gmail Dev Page Updates (`/public/gmail-dev.html` + `/public/js/gmail-dev.js`)

**New Section: Step 3 - Attachment Ingestion**

Add after Step 2 results:

```html
<!-- Step 3: Attachment Ingestion -->
<div
  class="result-section"
  id="step3Section"
  data-allowed-mime="application/pdf,image/png,image/jpeg,image/tiff"
  data-max-size-mb="15"
  style="display:none;"
>
  <h3>
    <span class="toggle-icon" onclick="toggleSection('step3Content')">▼</span>
    Step 3: Attachment Ingestion
  </h3>
  <div id="step3Content" class="collapsible-content">
    <div class="step3-controls">
      <button id="selectAllBtn" onclick="selectAllAttachments()">Select All</button>
      <button id="deselectAllBtn" onclick="deselectAllAttachments()">Deselect All</button>
      <button id="ingestBtn" onclick="startIngestion()" disabled>Download & Recognize Selected (<span id="selectedCount">0</span>)</button>
    </div>

    <table id="step3Table">
      <thead>
        <tr>
          <th><input type="checkbox" id="selectAllCheckbox" onchange="toggleSelectAll()"></th>
          <th>Email Details</th>
          <th>Filename</th>
          <th>Size</th>
          <th>Duplicate</th>
          <th>Status</th>
          <th>Progress</th>
          <th>Details</th>
        </tr>
      </thead>
      <tbody id="step3TableBody">
        <!-- Populated dynamically -->
      </tbody>
    </table>
  </div>
</div>
```

**Config Surface:** The `data-allowed-mime` and `data-max-size-mb` attributes mirror the backend validation constants so the front-end can pre-filter unsupported options without duplicating logic in multiple places. If those env values change, update the attributes when rendering the page (or pass them through from the server).

**Integration Instructions:**

The Step 3 section is initially hidden (`display:none`). To make it visible when Step 2 completes:

1. Find the existing `displayResults(data)` function in `/public/js/gmail-dev.js`
2. Locate where Step 2 table is populated (after `step2AllTbody.appendChild(row);` loop)
3. **Add this call** before `resultsContainer.hidden = false;`:

```javascript
// Populate Step 3 table with accepted Step 2 results
if (data.results && data.results.length > 0) {
  populateStep3Table(data.results);
}
```

This will automatically show Step 3 UI when Step 2 has results.

---

**JavaScript Logic (`/public/js/gmail-dev.js`):**

Add these new functions to the existing file:

```javascript
let currentBatchId = null;
let pollingInterval = null;
const step3SectionEl = document.getElementById('step3Section');
const allowedMimeTypes = (step3SectionEl?.dataset.allowedMime || 'application/pdf,image/png,image/jpeg,image/tiff')
  .split(',')
  .map(type => type.trim())
  .filter(Boolean);
const maxAttachmentBytes = Math.max(
  1,
  parseInt(step3SectionEl?.dataset.maxSizeMb || '15', 10)
) * 1024 * 1024;

// Populate Step 3 table from Step 2 results
function populateStep3Table(step2Results) {
  const tbody = document.getElementById('step3TableBody');
  tbody.innerHTML = '';

  // Build client-side duplicate detection map (filename:size → count)
  const attachmentKeys = new Map();
  step2Results.forEach(email => {
    if (email.attachments) {
      email.attachments.forEach(attachment => {
        const key = `${attachment.filename.toLowerCase()}:${attachment.size}`;
        attachmentKeys.set(key, (attachmentKeys.get(key) || 0) + 1);
      });
    }
  });

  // Render attachment rows with duplicate indicators
  step2Results.forEach(email => {
    if (email.attachments) {
      email.attachments.forEach(attachment => {
        const reasons = [];
        if (attachment.isInline) {
          reasons.push('Inline attachment');
        }
        if (!allowedMimeTypes.includes(attachment.mimeType)) {
          reasons.push(`Unsupported type (${attachment.mimeType})`);
        }
        if (attachment.size > maxAttachmentBytes) {
          reasons.push(`Too large (${formatBytes(attachment.size)})`);
        }

        const isSelectable = reasons.length === 0;
        const row = document.createElement('tr');
        row.dataset.messageId = email.id;
        row.dataset.attachmentId = attachment.attachmentId;
        row.dataset.filename = attachment.filename;
        row.dataset.mimeType = attachment.mimeType;
        row.dataset.size = attachment.size;
        row.dataset.isSelectable = String(isSelectable);

        // Client-side duplicate detection: mark if filename+size appears more than once
        const key = `${attachment.filename.toLowerCase()}:${attachment.size}`;
        const isDuplicate = attachmentKeys.get(key) > 1;

        row.innerHTML = `
          <td>
            <input
              type="checkbox"
              class="attachment-checkbox"
              ${isSelectable ? '' : 'disabled'}
              onchange="updateSelectedCount()"
            >
          </td>
          <td>
            <div><strong>From:</strong> ${email.from}</div>
            <div><strong>Subject:</strong> ${email.subject}</div>
            <div><strong>Date:</strong> ${email.date}</div>
          </td>
          <td>${attachment.filename}</td>
          <td>${formatBytes(attachment.size)}</td>
          <td>${isDuplicate ? '<span class="duplicate-icon" title="Possible duplicate (same filename+size)">⚠️</span>' : ''}</td>
          <td class="status-cell">${isSelectable ? '-' : `🚫 ${reasons.join(', ')}`}</td>
          <td class="progress-cell">-</td>
          <td class="details-cell">-</td>
        `;

        tbody.appendChild(row);
      });
    }
  });

  document.getElementById('step3Section').style.display = 'block';
  updateSelectedCount();
}

/**
 * INTEGRATION POINT: Call populateStep3Table() when Step 2 results are displayed
 *
 * In the existing gmail-dev.js displayResults() function, after Step 2 table is populated,
 * add this call to populate Step 3:
 *
 * Example integration (add to displayResults function, after Step 2 table population):
 *
 *   // ... existing Step 2 table population code ...
 *   step2AllTbody.appendChild(row);
 * });
 *
 * // *** ADD THIS: Populate Step 3 table with accepted Step 2 results ***
 * if (data.results && data.results.length > 0) {
 *   populateStep3Table(data.results);
 * }
 *
 * resultsContainer.hidden = false;
 *
 * This will:
 * 1. Show the Step 3 section when Step 2 completes successfully
 * 2. Populate attachment selection checkboxes
 * 3. Enable the "Download & Recognize Selected" button
 */

// Update selected count
function updateSelectedCount() {
  const checkboxes = document.querySelectorAll('.attachment-checkbox:checked');
  const count = checkboxes.length;
  document.getElementById('selectedCount').textContent = count;
  document.getElementById('ingestBtn').disabled = count === 0;
}

// Select/deselect all
function toggleSelectAll() {
  const selectAll = document.getElementById('selectAllCheckbox').checked;
  document.querySelectorAll('.attachment-checkbox').forEach(cb => {
    if (!cb.disabled) {
      cb.checked = selectAll;
    } else {
      cb.checked = false;
    }
  });
  updateSelectedCount();
}

function selectAllAttachments() {
  document.getElementById('selectAllCheckbox').checked = true;
  toggleSelectAll();
}

function deselectAllAttachments() {
  document.getElementById('selectAllCheckbox').checked = false;
  toggleSelectAll();
}

// Start ingestion
async function startIngestion() {
  const checkboxes = document.querySelectorAll('.attachment-checkbox:checked');

  if (checkboxes.length === 0) {
    alert('Please select at least one attachment');
    return;
  }

  // Build selections array
  const selections = Array.from(checkboxes)
    .map(cb => cb.closest('tr'))
    .filter(row => row && row.dataset.isSelectable === 'true')
    .map(row => ({
      messageId: row.dataset.messageId,
      attachmentId: row.dataset.attachmentId,
      filename: row.dataset.filename,
      mimeType: row.dataset.mimeType,
      size: parseInt(row.dataset.size, 10)
    }));

  // Disable UI during processing
  document.getElementById('ingestBtn').disabled = true;
  document.querySelectorAll('.attachment-checkbox').forEach(cb => cb.disabled = true);

  try {
    const response = await fetch('/api/dev-gmail/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selections })
    });

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Failed to start ingestion');
    }

    currentBatchId = result.batchId;

    // Start polling for progress
    startPolling();

  } catch (error) {
    console.error('Ingestion failed:', error);
    alert(`Failed to start ingestion: ${error.message}`);

    // Re-enable UI
    document.getElementById('ingestBtn').disabled = false;
    document.querySelectorAll('#step3TableBody tr').forEach(row => {
      const checkbox = row.querySelector('.attachment-checkbox');
      if (!checkbox) return;
      checkbox.disabled = row.dataset.isSelectable !== 'true' ? true : false;
    });
  }
}

// Polling for progress
function startPolling() {
  if (pollingInterval) clearInterval(pollingInterval);

  pollingInterval = setInterval(async () => {
    try {
      const response = await fetch(`/api/dev-gmail/jobs/summary?batchId=${currentBatchId}`);
      const summary = await response.json();

      updateStep3Table(summary);

      if (summary.allComplete) {
        stopPolling();
        showCompletionModal(summary);
      }

    } catch (error) {
      console.error('Polling failed:', error);
    }
  }, 2000); // Poll every 2 seconds
}

function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

// Update Step 3 table with progress
function updateStep3Table(summary) {
  summary.attachments.forEach(attachment => {
    const row = Array.from(document.querySelectorAll('#step3TableBody tr')).find(r =>
      r.dataset.attachmentId === attachment.attachmentId
    );

    if (row) {
      const statusCell = row.querySelector('.status-cell');
      const progressCell = row.querySelector('.progress-cell');
      const detailsCell = row.querySelector('.details-cell');

      // Status with icon
      const statusIcons = {
        queued: '⏳',
        downloading: '⬇️',
        processing: '🧠',
        completed: '✅',
        updated: '🔄',
        failed: '❌',
        duplicate: '🔄'
      };
      statusCell.innerHTML = `${statusIcons[attachment.status] || ''} ${attachment.status}`;

      // Progress bar
      if (attachment.progress > 0) {
        progressCell.innerHTML = `
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${attachment.progress}%"></div>
          </div>
          <span>${attachment.progress}%</span>
        `;
      }

      // Details
      if ((attachment.status === 'completed' || attachment.status === 'updated') && attachment.reportId) {
        detailsCell.innerHTML = `<a href="/report.html?id=${attachment.reportId}" target="_blank">View Report</a>`;
      } else if (attachment.status === 'failed') {
        detailsCell.innerHTML = `<span class="error-text">${attachment.progressMessage}</span>`;
      } else if (attachment.status === 'duplicate' && attachment.reportId) {
        detailsCell.innerHTML = `${attachment.progressMessage} <a href="/report.html?id=${attachment.reportId}" target="_blank">View</a>`;
      } else {
        detailsCell.textContent = attachment.progressMessage;
      }
    }
  });
}

// Show completion modal and redirect
function showCompletionModal(summary) {
  const newCount = summary.attachments.filter(a => a.status === 'completed').length;
  const updatedCount = summary.attachments.filter(a => a.status === 'updated').length;
  const duplicateCount = summary.attachments.filter(a => a.status === 'duplicate').length;
  const failureCount = summary.attachments.filter(a => a.status === 'failed').length;

  let message = `Batch processing complete!\n\n`;
  if (newCount > 0) message += `✅ New reports: ${newCount}\n`;
  if (updatedCount > 0) message += `🔄 Updated existing reports: ${updatedCount}\n`;
  if (duplicateCount > 0) message += `🔄 Duplicates skipped: ${duplicateCount}\n`;
  if (failureCount > 0) message += `❌ Failed: ${failureCount}\n`;
  message += `\nRedirecting to results page in 3 seconds...`;

  alert(message);

  // Redirect to results page
  setTimeout(() => {
    window.location.href = `/gmail-results.html?batchId=${currentBatchId}`;
  }, 3000);
}

// Helper: Format bytes to human-readable
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}
```

**CSS Updates (`/public/css/style.css`):**

```css
.step3-controls {
  margin-bottom: 1rem;
  display: flex;
  gap: 0.5rem;
}

.step3-controls button {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

#ingestBtn {
  background-color: #4CAF50;
  color: white;
  font-weight: bold;
}

#ingestBtn:disabled {
  background-color: #ccc;
  cursor: not-allowed;
}

.duplicate-icon {
  font-size: 1.2rem;
  cursor: help;
}

.progress-bar {
  width: 100px;
  height: 20px;
  background-color: #f0f0f0;
  border-radius: 10px;
  overflow: hidden;
  display: inline-block;
  vertical-align: middle;
  margin-right: 0.5rem;
}

.progress-fill {
  height: 100%;
  background-color: #4CAF50;
  transition: width 0.3s ease;
}

.error-text {
  color: #d32f2f;
  font-weight: bold;
}

.status-cell {
  text-transform: capitalize;
}
```

---

### 6.2 New Page: Gmail Results View (`/public/gmail-results.html`)

**Purpose:** Show summary of completed batch ingestion with links to reports.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Gmail Ingestion Results - HealthUp</title>
  <link rel="stylesheet" href="/css/style.css">
  <style>
    .results-container {
      max-width: 1200px;
      margin: 2rem auto;
      padding: 2rem;
    }

    .summary-box {
      background: #f5f5f5;
      padding: 1.5rem;
      border-radius: 8px;
      margin-bottom: 2rem;
    }

    .summary-stats {
      display: flex;
      gap: 2rem;
      margin-top: 1rem;
    }

    .stat-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 1.2rem;
    }

    .actions {
      display: flex;
      gap: 1rem;
      margin-bottom: 2rem;
    }

    .results-table {
      width: 100%;
      border-collapse: collapse;
    }

    .results-table th,
    .results-table td {
      padding: 1rem;
      text-align: left;
      border-bottom: 1px solid #ddd;
    }

    .results-table th {
      background-color: #f0f0f0;
      font-weight: bold;
    }

    .status-badge {
      padding: 0.25rem 0.75rem;
      border-radius: 12px;
      font-size: 0.85rem;
      font-weight: bold;
    }

    .status-completed {
      background-color: #4CAF50;
      color: white;
    }

    .status-updated {
      background-color: #FF9800;
      color: white;
    }

    .status-duplicate {
      background-color: #2196F3;
      color: white;
    }

    .status-failed {
      background-color: #f44336;
      color: white;
    }
  </style>
</head>
<body>
  <div class="results-container">
    <h1>Gmail Attachment Ingestion Results</h1>

    <div class="summary-box">
      <h2>Batch Summary</h2>
      <div class="summary-stats">
        <div class="stat-item">
          <span>✅ Succeeded:</span>
          <strong id="successCount">0</strong>
        </div>
        <div class="stat-item">
          <span>🔄 Duplicates:</span>
          <strong id="duplicateCount">0</strong>
        </div>
        <div class="stat-item">
          <span>❌ Failed:</span>
          <strong id="failedCount">0</strong>
        </div>
        <div class="stat-item">
          <span>📊 Total:</span>
          <strong id="totalCount">0</strong>
        </div>
      </div>
    </div>

    <div class="actions">
      <a href="/gmail-dev.html" class="btn btn-secondary">← Back to Gmail Dev</a>
      <a href="/index.html" class="btn btn-primary">View All Reports →</a>
    </div>

    <h2>Attachment Details</h2>
    <table class="results-table">
      <thead>
        <tr>
          <th>Filename</th>
          <th>Status</th>
          <th>Details</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody id="resultsTableBody">
        <!-- Populated by JavaScript -->
      </tbody>
    </table>
  </div>

  <script>
    // Get batchId from URL
    const urlParams = new URLSearchParams(window.location.search);
    const batchId = urlParams.get('batchId');

    if (!batchId) {
      alert('No batch ID provided');
      window.location.href = '/gmail-dev.html';
    }

    // Fetch and display results
    async function loadResults() {
      try {
        const response = await fetch(`/api/dev-gmail/jobs/summary?batchId=${batchId}`);
        const summary = await response.json();

        // Update summary stats
        const newCount = summary.attachments.filter(a => a.status === 'completed').length;
        const updatedCount = summary.attachments.filter(a => a.status === 'updated').length;
        const duplicateCount = summary.attachments.filter(a => a.status === 'duplicate').length;
        const failedCount = summary.attachments.filter(a => a.status === 'failed').length;

        // Combine new + updated as "succeeded"
        document.getElementById('successCount').textContent = newCount + updatedCount;
        document.getElementById('duplicateCount').textContent = duplicateCount;
        document.getElementById('failedCount').textContent = failedCount;
        document.getElementById('totalCount').textContent = summary.totalCount;

        // Populate table
        const tbody = document.getElementById('resultsTableBody');
        tbody.innerHTML = '';

        summary.attachments.forEach(attachment => {
          const row = document.createElement('tr');

          // Status badge
          let statusClass = '';
          if (attachment.status === 'completed') statusClass = 'status-completed';
          else if (attachment.status === 'updated') statusClass = 'status-updated';
          else if (attachment.status === 'duplicate') statusClass = 'status-duplicate';
          else if (attachment.status === 'failed') statusClass = 'status-failed';

          // Actions
          let actions = '-';
          if (attachment.reportId) {
            actions = `<a href="/report.html?id=${attachment.reportId}" target="_blank" class="btn btn-sm">View Report</a>`;
          }

          row.innerHTML = `
            <td>${attachment.filename}</td>
            <td><span class="status-badge ${statusClass}">${attachment.status}</span></td>
            <td>${attachment.progressMessage}</td>
            <td>${actions}</td>
          `;

          tbody.appendChild(row);
        });

      } catch (error) {
        console.error('Failed to load results:', error);
        alert('Failed to load results: ' + error.message);
      }
    }

    loadResults();
  </script>
</body>
</html>
```

---

## 7. Database Schema Changes

### 7.1 New Table: `gmail_report_provenance`

**Purpose:** Store Gmail metadata for each ingested report (audit trail).

**Schema:**

```sql
CREATE TABLE IF NOT EXISTS gmail_report_provenance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES patient_reports(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,           -- Gmail message ID (e.g., "18f5b1c2d3e4f5g6")
  attachment_id TEXT NOT NULL,        -- Gmail attachment ID (e.g., "ANGjdJ8...")
  sender_email TEXT,                  -- Email address of sender
  sender_name TEXT,                   -- Display name of sender
  email_subject TEXT,                 -- Subject line of email
  email_date TIMESTAMP,               -- Date email was sent
  attachment_checksum TEXT NOT NULL,  -- SHA-256 of attachment (redundant with patient_reports.checksum but useful for queries)
  ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Prevent re-ingesting same attachment
  UNIQUE(message_id, attachment_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_gmail_provenance_report ON gmail_report_provenance(report_id);
CREATE INDEX IF NOT EXISTS idx_gmail_provenance_checksum ON gmail_report_provenance(attachment_checksum);
CREATE INDEX IF NOT EXISTS idx_gmail_provenance_message ON gmail_report_provenance(message_id);

-- Comments
COMMENT ON TABLE gmail_report_provenance IS 'Audit trail for reports ingested from Gmail';
COMMENT ON COLUMN gmail_report_provenance.message_id IS 'Gmail message ID (immutable identifier)';
COMMENT ON COLUMN gmail_report_provenance.attachment_id IS 'Gmail attachment ID within the message';
COMMENT ON COLUMN gmail_report_provenance.attachment_checksum IS 'SHA-256 hash of attachment for duplicate detection';
```

**Migration:** Add to `server/db/schema.js` in the appropriate section.

---

## 8. Configuration (.env)

### 8.1 New Environment Variables

```bash
# Gmail Step 3: Attachment Ingestion
GMAIL_ATTACHMENT_INGEST_ENABLED=true                                    # Enable Step-3 routes
GMAIL_ALLOWED_MIME=application/pdf,image/png,image/jpeg,image/tiff     # Allowed MIME types
GMAIL_MAX_ATTACHMENT_MB=15                                              # Max file size in MB
GMAIL_DOWNLOAD_CONCURRENCY=5                                            # Max concurrent downloads (rate limit safety)
GMAIL_ATTACHMENT_TIMEOUT_MS=300000                                      # Timeout per attachment (5 min)
GMAIL_BATCH_MAX_ATTACHMENTS=20                                          # Max attachments per batch
```

### 8.2 Existing Variables (Reference)

These already exist and should be documented in the PRD:

```bash
# Gmail Integration (Steps 1-2)
GMAIL_INTEGRATION_ENABLED=true
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GMAIL_OAUTH_REDIRECT_URI=http://localhost:3000/api/dev-gmail/oauth-callback

# OCR/Vision Providers
OCR_PROVIDER=openai                    # "openai" or "anthropic"
OPENAI_API_KEY=your-key
OPENAI_VISION_MODEL=gpt-4o-2024-11-20
OPENAI_USE_NATIVE_PDF=true
ANTHROPIC_API_KEY=your-key
ANTHROPIC_VISION_MODEL=claude-3-5-sonnet-20241022

# PDF Processing
PDFTOPPM_PATH=/usr/bin/pdftoppm        # Required for PDF → PNG conversion
```

---

## 9. Error Handling

### 9.1 Error Scenarios & Responses

| Scenario | Detection | Handling | User Experience |
|----------|-----------|----------|-----------------|
| **OAuth token expired** | Gmail API returns 401 | Mark job as failed: "Gmail authentication expired" | Show error in UI: "Please reconnect Gmail" with button |
| **Gmail rate limit (429)** | Gmail API returns 429 | Retry with exponential backoff (1s, 2s, 4s). Max 3 attempts. | If all retries fail: "Gmail API rate limit exceeded. Try again later." |
| **Unsupported file type** | Validation before download | Skip with reason: "Unsupported file type: {mimeType}" | Show in Details column, status = skipped |
| **File too large** | Size check before download | Skip with reason: "File too large: {size}MB (max {limit}MB)" | Show in Details column, status = skipped |
| **Download failure** | Network error during download | Retry once. If fails: mark as failed with error | "Download failed: Network error" |
| **Cross-batch duplicate** | Check provenance table before download | Skip download/OCR entirely | Status = "Duplicate" (previous batch), link to existing report |
| **Same patient + checksum** | During DB upsert | Existing report updated (idempotent) | Status = "Updated", link to updated report |
| **OCR provider error** | labReportProcessor fails | Mark job as failed with provider error message | Show full error in Details column |
| **No data extracted** | OCR returns empty/invalid data | Mark as failed: "No valid data extracted from document" | Show error message |
| **Database error** | DB query fails | Mark as failed with sanitized error message | "Database error occurred" (PII redaction) |
| **Token refresh failure** | OAuth refresh returns error | Stop batch processing, mark all pending as failed | "Gmail authentication lost. Please reconnect." |
| **Attachment stuck** | No progress for >5 min | Auto-mark as failed: "Processing timeout" | Show timeout error after 5 min |

### 9.2 Rate Limit Management

**Gmail API Quotas:**
- Per-user rate limit: 250 quota units/second
- `users.messages.get`: 25 units per request
- `users.messages.attachments.get`: 25 units per request

**Strategy:**
- Concurrency limit: 5 concurrent downloads (125 units/s, safe margin)
- Exponential backoff on 429: 1s, 2s, 4s (max 3 attempts)
- Global rate limiter: `p-limit` with concurrency=5

**Implementation:**
```javascript
const pLimit = require('p-limit');
const GMAIL_DOWNLOAD_CONCURRENCY = Math.max(
  1,
  parseInt(process.env.GMAIL_DOWNLOAD_CONCURRENCY || '5', 10)
);
const limit = pLimit(GMAIL_DOWNLOAD_CONCURRENCY);
```

### 9.3 Timeout Handling

**Timeouts:**
- Per-attachment timeout: 5 minutes (configurable via `GMAIL_ATTACHMENT_TIMEOUT_MS`)
- Batch polling timeout: 10 minutes (300 attempts × 2s polling interval)

**Implementation:**
```javascript
// In polling logic (frontend)
let pollAttempts = 0;
const MAX_POLL_ATTEMPTS = 300; // 10 minutes

function startPolling() {
  pollingInterval = setInterval(async () => {
    pollAttempts++;

    if (pollAttempts > MAX_POLL_ATTEMPTS) {
      stopPolling();
      alert('Batch processing timeout. Some attachments may still be processing.');
      window.location.href = `/gmail-results.html?batchId=${currentBatchId}`;
      return;
    }

    // ... rest of polling logic
  }, 2000);
}
```

### 9.4 Token Expiry Handling

**Strategy:**
- Token refresh is **automatic** via `oauth2Client.on('tokens', ...)` listener registered in `gmailConnector.js`
- The listener saves refreshed tokens to file (`GMAIL_TOKEN_PATH`)
- No manual pre-validation or refresh needed in Step 3 code
- If 401 occurs despite auto-refresh, mark job as failed and prompt user to reconnect

**Existing Implementation (gmailConnector.js:75-100):**
```javascript
oauth2Client.on('tokens', async (newTokens) => {
  // Automatically saves refreshed tokens to file
  // Preserves refresh_token across refreshes
});
```

**Note:** Token refresh happens transparently during Gmail API calls. If refresh fails (e.g., refresh_token revoked), the user must manually reconnect via OAuth flow.

---

## 10. Duplicate Detection Strategy

### 10.1 Multi-Phase Detection

**Phase 1: Pre-Download Heuristic (UI-level)**
- **When:** Step 2 results displayed in Step 3 table
- **Method:** Hash key = `lowercase(filename) + size + extension`
- **Purpose:** Visual indicator for user (⚠️ icon), not enforcement
- **Limitation:** False positives (different files with same name/size)

**Phase 2: Cross-Batch Duplicate Check (Gmail Provenance)**
- **When:** Before download
- **Method:** Query `gmail_report_provenance` table for `(message_id, attachment_id)`
- **Purpose:** Skip re-processing attachments already ingested in previous batches
- **Result:** If found, mark as "Duplicate" and skip download/OCR entirely

**Phase 3: Checksum Short-Circuit (Pre-OCR)**
- **When:** Immediately after computing SHA-256 checksum
- **Method:** Query `gmail_report_provenance` table for `attachment_checksum`
- **Purpose:** Avoid rerunning OCR on identical payloads, even if Gmail attachment IDs differ
- **Result:** If a match is found, mark as "Duplicate (checksum)" and reuse existing `report_id`

**Phase 4: Per-Patient Upsert (DB-level)**
- **When:** After OCR, during persistence
- **Method:** `ON CONFLICT (patient_id, checksum) DO UPDATE`
- **Purpose:** Update existing report if same file is re-processed for same patient (idempotent)
- **Result:** Either new report inserted ("Completed") or existing report updated ("Updated")

### 10.2 Duplicate Handling Flow

```
1. User selects attachment (may include UI-level duplicates from Phase 1)
   ↓
2. Check gmail_report_provenance: (message_id, attachment_id) exists?
   ↓
3a. If YES → Mark as "Duplicate" → Skip download/OCR → Return existing report_id
   ↓
3b. If NO → Proceed to download
   ↓
4. Download attachment → compute SHA-256 checksum
   ↓
5. Check gmail_report_provenance: attachment_checksum exists?
   - YES → Mark as "Duplicate (checksum)" → Skip OCR → Return existing report_id
   - NO → Proceed to OCR
   ↓
6. OCR extracts patient_name → upsertPatient() → get patient_id
   ↓
7. UPSERT: ON CONFLICT (patient_id, checksum) DO UPDATE
   ↓
8. Check if insert or update using PostgreSQL xmax:
   - Query: SELECT (xmax = 0) AS is_new_insert FROM patient_reports WHERE id = $1
   - xmax = 0 means new insert (row never updated)
   - xmax > 0 means update (row was modified)
   ↓
9a. If INSERT (xmax=0) → Mark as "Completed" (new report)
   ↓
9b. If UPDATE (xmax>0) → Mark as "Updated" (existing report refreshed)
   ↓
10. Save gmail_report_provenance entry
```

**Key Differences from Original PRD:**
- ✅ Checksum short-circuit avoids re-running OCR on identical binaries (still logs as Gmail duplicate with provenance context)
- ✅ Provenance check happens before download (saves bandwidth + quota)
- ✅ Upsert instead of insert-or-fail (idempotent, better UX)
- ✅ Three distinct outcomes: Completed, Updated, Duplicate
- ✅ PostgreSQL `xmax` trick for reliable insert vs update detection (no race conditions with timestamp comparison)

**Technical Note - xmax Trick:**

The `xmax` system column in PostgreSQL indicates transaction ID of the deleting/updating transaction:
- `xmax = 0`: Row was never updated/deleted → This is a new insert
- `xmax > 0`: Row was updated → This is an update of existing data

This is **more reliable** than timestamp comparison (`updated_at > created_at + 1s`) because:
1. No race conditions: Works even with sub-second upserts
2. No arbitrary buffer needed: Don't need to guess "1 second" vs "0.5 seconds"
3. PostgreSQL-specific but accurate: Directly reads transaction state

**Alternative Approaches** (if xmax is not desired):
```sql
-- Option A: Use RETURNING clause with conflict detection
INSERT INTO patient_reports (...)
VALUES (...)
ON CONFLICT (patient_id, checksum) DO UPDATE SET ...
RETURNING id, (xmax = 0) AS was_inserted;

-- Option B: Simple timestamp comparison (less reliable)
SELECT (updated_at > created_at) AS was_updated
FROM patient_reports WHERE id = $1;

-- Option C: Check existence before upsert (extra query)
SELECT id FROM patient_reports WHERE patient_id = $1 AND checksum = $2;
-- If found → will be update, if not → will be insert
```

We chose **xmax** for simplicity and accuracy.

### 10.3 Cross-Batch Duplicates

**Scenario:** User processes the same attachment in multiple sessions (or receives an identical resend).

**Detection:**
- `gmail_report_provenance` table has `UNIQUE(message_id, attachment_id)` constraint (fast path)
- Additional checksum lookup (`attachment_checksum`) ensures binary duplicates are skipped even if Gmail re-IDs the attachment
- If checksum skip triggers, UI labels the row as "Duplicate (checksum)" and links to the original `report_id`

**Caveat:** Two different patients could, in theory, share an identical lab PDF. If that becomes a real-world issue we will refine the checksum short-circuit to require matching sender metadata or expose an "Ingest anyway" override. Documented in Risks (§11.5).

**Handling:**
- On constraint violation during provenance insert: treat as duplicate (return existing report)
- Alternatively: check provenance table before processing (proactive)

**Recommended Implementation:**
```javascript
// Before download, check provenance
async function checkGmailProvenanceExists(messageId, attachmentId) {
  const result = await db.query(`
    SELECT report_id FROM gmail_report_provenance
    WHERE message_id = $1 AND attachment_id = $2
  `, [messageId, attachmentId]);
  return result.rows[0] || null;
}

// In ingestAttachment()
const existingProvenance = await checkGmailProvenanceExists(messageId, attachmentId);
if (existingProvenance) {
  updateStatus(trackingId, 'duplicate', 100, 'Already ingested in previous batch');
  tracking.reportId = existingProvenance.report_id;
  return;
}
```

### 10.4 Duplicate Handling: Same File, Different Patients

**Scenario:** Two patients happen to receive a byte-identical lab PDF (e.g., shared portal export, templated negative result).

**Current Behavior (Step 3):**
- First ingestion persists normally (`patient_id=A, checksum=X`).
- Subsequent ingestion hits the checksum short-circuit and is marked `duplicate` (no OCR/API spend).
- UI surfaces the duplicate status with a link to the existing report so the operator can manually cross-check.

**Why We Accept This (for now):**
- Primary goal is to protect OCR/API budget during dev rollout.
- Gmail Step 3 is feature-flagged and operated by developers who can manually re-upload via `/analyze-labs` if a real cross-patient duplicate is suspected.
- We retain full Gmail metadata (sender, subject, messageId) in provenance to audit skipped attachments quickly.

**Risk & Follow-Up:**
- Documented in §11.5 (Known Risks). Mitigations under evaluation:
  1. Require matching sender email + subject before short-circuiting.
  2. Provide "Ingest anyway" affordance when checksum duplicate detected.
  3. Record patient name snapshot in provenance to compare before skipping.

---

## 11. Security & Privacy

### 11.1 Gmail Scope (No Changes)

- OAuth scope remains **read-only**: `https://www.googleapis.com/auth/gmail.readonly`
- No message modification or deletion
- No message labeling or organization

### 11.2 Attachment Handling

**Processing Flow:**
- Attachments downloaded directly into Node.js Buffer
- **PDF files:** Temporarily written to OS temp directory (`os.tmpdir()`) for conversion via `pdftoppm` to PNG images, then immediately deleted after processing
- **Image files:** Processed directly from Buffer (no temp write)
- Buffer discarded immediately after ingestion
- No persistent storage or caching of attachment data beyond processing

**PII Protection:**
- Email metadata (sender, subject) stored in `gmail_report_provenance` table (encrypted at rest via DB encryption)
- Email body never logged or stored
- Error messages sanitized (no PHI/PII in logs)

**Example:**
```javascript
// BAD: Logs PHI
console.error('Failed to process lab for John Doe (DOB: 1980-01-01):', error);

// GOOD: No PHI
console.error('Failed to process attachment:', { filename, error: error.message });
```

### 11.3 Rate Limiting (Safety)

- Concurrency limit (5) prevents accidental API quota exhaustion
- Batch size limit (20) prevents user error (selecting 100+ attachments)
- Timeout enforcement (5 min/attachment) prevents runaway jobs

### 11.4 Feature Flag (Dev-Only)

- All Step 3 routes guarded by `GMAIL_ATTACHMENT_INGEST_ENABLED` env var
- Default: `false` (must be explicitly enabled)
- Recommended: Keep disabled in production until multi-user auth is implemented

### 11.5 Known Risks

| Risk | Likelihood | Impact | Mitigation / Notes |
|------|------------|--------|--------------------|
| **Checksum skip hides legitimate cross-patient duplicates** | Low | Medium | Documented manual workaround (upload via `/analyze-labs`), provenance retains Gmail metadata for audit. Future iteration: tighten skip criteria (sender match) or add "ingest anyway" affordance. |
| **Inline or oversized attachments appear in UI** | Low | Low | Step 3 front-end now disables inline/unsupported selections and explains the reason; backend still validates and rejects. |

---

## 12. Testing Strategy

### 12.1 Unit Tests

**Service Layer (`gmailAttachmentIngest.js`):**
- [x] `downloadAttachmentWithRetry()` - Mock Gmail API responses (success, 429, 401, network error)
- [x] `checkGmailProvenanceExists()` - Mock provenance table queries (found, not found)
- [x] `checkIfReportWasUpdated()` - Mock DB queries to detect insert vs update
- [x] `saveGmailProvenance()` - Verify correct data inserted
- [x] `parseFromHeader()` - Parse various email address formats
- [x] `updateStatus()` - Verify tracking map updates
- [x] `getBatchSummary()` - Aggregate batch status correctly (including "updated" status)

**Test Framework:** Jest (or existing test framework)

**Example Test:**
```javascript
describe('gmailAttachmentIngest', () => {
  describe('downloadAttachmentWithRetry', () => {
    it('should retry on 429 with exponential backoff', async () => {
      const mockGmail = {
        users: {
          messages: {
            attachments: {
              get: jest.fn()
                .mockRejectedValueOnce({ code: 429 })  // First attempt fails
                .mockResolvedValueOnce({ data: { data: 'base64data' } })  // Second attempt succeeds
            }
          }
        }
      };

      const result = await downloadAttachmentWithRetry(mockGmail, 'msg123', 'att456');

      expect(mockGmail.users.messages.attachments.get).toHaveBeenCalledTimes(2);
      expect(result).toBeDefined();
    });
  });
});
```

---

### 12.2 Integration Tests

**Full Pipeline Tests (E2E):**
- [x] Happy path: Select 1 attachment → Download → OCR → Persist → Verify DB entry
- [x] Duplicate detection: Upload same file twice → Second marked as duplicate
- [x] Multiple attachments: Process 5 attachments in parallel → Verify all succeed
- [x] OAuth token expiry: Simulate token expiry mid-batch → Verify auto-refresh
- [x] Rate limit handling: Simulate 429 response → Verify retry logic
- [x] Failure handling: Corrupt PDF → OCR fails → Job marked as failed

**Test Data:**
- Use real Gmail test account with sample lab PDFs
- Or mock Gmail API responses with test fixtures

**Environment:**
- Separate test database
- Test Gmail OAuth credentials
- Feature flag enabled: `GMAIL_ATTACHMENT_INGEST_ENABLED=true`

---

### 12.3 Error Scenario Tests

| Scenario | Setup | Expected Outcome |
|----------|-------|------------------|
| **Unsupported file type** | Select .docx attachment | Validation error before download |
| **File too large** | Select 20MB PDF (limit 15MB) | Validation error before download |
| **Network failure during download** | Mock network error | Retry once, then fail with error message |
| **Corrupt PDF** | Upload malformed PDF | OCR fails, job marked as failed |
| **No data extracted** | Upload blank PDF | OCR returns empty data, job fails |
| **Duplicate within batch** | Select same attachment twice | First processes, second marked duplicate |
| **Duplicate across batches** | Process same attachment in 2 sessions | Second session detects via provenance table |
| **OAuth token expired** | Expire token mid-batch | Auto-refresh, processing continues |
| **Gmail API down** | Simulate 503 error | All jobs fail with error message |
| **Database down** | Stop DB during processing | Jobs fail with error (no data loss) |

---

### 12.4 Performance Tests

**Scenarios:**
- Process 20 attachments in parallel → Measure total time
- Large PDF (15MB) → Measure download + OCR time
- High concurrency (5 simultaneous downloads) → Verify rate limits respected

**Success Criteria:**
- Average processing time: 30-60s per attachment (PDF)
- No Gmail rate limit errors with concurrency=5
- Memory usage stable (no leaks from Buffers)

---

### 12.5 Manual Testing Checklist

- [ ] Step 1-2 results display correctly
- [ ] **Step 3 section automatically appears when Step 2 completes**
- [ ] Step 3 table populated with all Step 2 attachments
- [ ] Duplicate icons show for files with same name+size
- [ ] Select/deselect all checkboxes work
- [ ] Selected count updates correctly
- [ ] "Download & Recognize" button disabled when no selection
- [ ] Batch ingestion starts successfully
- [ ] Progress bars update every 2s
- [ ] Status transitions: Queued → Downloading → Processing → Completed
- [ ] Completed attachments show "View Report" link
- [ ] Failed attachments show error message
- [ ] Duplicate attachments show existing report link
- [ ] Completion modal shows after all jobs finish
- [ ] Redirect to results page works
- [ ] Results page shows correct summary stats
- [ ] Results page links to reports work
- [ ] "Back to Gmail Dev" and "View All Reports" buttons work

---

## 13. Non-Functional Requirements

### 13.1 Performance

**Targets:**
- Average processing time per attachment: 30-60 seconds (for PDF with OCR)
- Batch processing time (10 attachments): 5-10 minutes (with concurrency=5)
- API response time (`/ingest`, `/jobs/summary`): <500ms
- Database query time (duplicate check): <100ms (with proper indexing)

**Scalability Limits (MVP):**
- Max batch size: 20 attachments (configurable)
- Max concurrent downloads: 5 (Gmail rate limit safety)
- Max attachment size: 15MB (configurable)

**Bottlenecks:**
- OCR processing (most time-consuming step)
- Gmail API rate limits (250 units/s per user)

---

### 13.2 Observability

**Logging Strategy:**
- Log levels: INFO, WARN, ERROR
- Structured logging (JSON format recommended for production)
- PII/PHI redaction in all logs

**Key Events to Log:**
```javascript
// INFO: Batch started
console.log('Batch ingestion started', { batchId, attachmentCount, userId: 'dev' });

// INFO: Attachment status changes
console.log('Attachment status update', {
  batchId,
  attachmentId: 'att_xxx', // Truncated for privacy
  filename: 'redacted.pdf', // Don't log actual filename (may contain PHI)
  status,
  progress
});

// WARN: Rate limit encountered
console.warn('Gmail API rate limit, retrying', { attempt, delay });

// ERROR: Processing failed
console.error('Attachment processing failed', {
  batchId,
  attachmentId: 'att_xxx',
  error: error.message, // Sanitized error (no PHI)
  stack: error.stack
});
```

**Metrics to Track:**
- Total batches processed (count)
- Total attachments processed (count)
- Success rate (%)
- Average processing time (seconds)
- Duplicate rate (%)
- Error rate by type (%)

---

### 13.3 Rollback Plan

**Scenario:** Need to undo a batch ingestion (e.g., accidentally processed wrong files).

**Manual Rollback:**
```sql
-- 1. Find reports from a specific batch (via provenance)
SELECT pr.id, pr.patient_id, p.name, grp.email_subject, grp.ingested_at
FROM patient_reports pr
JOIN gmail_report_provenance grp ON pr.id = grp.report_id
JOIN patients p ON pr.patient_id = p.id
WHERE grp.ingested_at > '2025-11-06 10:00:00'  -- Adjust timestamp
ORDER BY grp.ingested_at DESC;

-- 2. Delete reports (cascade deletes provenance + analyte_results)
DELETE FROM patient_reports WHERE id IN ('uuid1', 'uuid2', ...);

-- 3. Verify deletion
SELECT COUNT(*) FROM gmail_report_provenance WHERE report_id IN ('uuid1', 'uuid2', ...); -- Should be 0
```

**Future Enhancement:** Add "Delete Batch" API endpoint for admins (out of scope for MVP).

---

### 13.4 Maintenance

**In-Memory Tracking Cleanup:**
- `attachmentJobs` Map grows indefinitely (memory leak over time)
- **Solution:** Auto-cleanup old batches (>24 hours) on server restart or periodic job

**Implementation:**
```javascript
// In gmailAttachmentIngest.js
function cleanupOldBatches() {
  const now = Date.now();
  const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

  for (const [trackingId, job] of attachmentJobs.entries()) {
    if (job.completedAt && (now - job.completedAt > MAX_AGE_MS)) {
      attachmentJobs.delete(trackingId);
    }
  }
}

// Run cleanup every hour
setInterval(cleanupOldBatches, 60 * 60 * 1000);
```

---

### 13.5 Cost Considerations (OCR API Usage)

**Per-Attachment Cost:**
- OpenAI GPT-4o Vision: ~$0.01-0.02 per page (PDF)
- Anthropic Claude Vision: ~$0.015-0.025 per image

**Batch Cost Example:**
- 10 attachments × 3 pages avg × $0.015/page = **$0.45/batch**
- 100 batches/month = **$45/month**

**Optimization:**
- Skip duplicates (saves API quota)
- Use `OPENAI_USE_NATIVE_PDF=true` (more efficient than image conversion)

---

## 14. Implementation Phases

### Phase 1: Backend Foundation (2 days)

**Tasks:**
- [x] Create `server/services/gmailAttachmentIngest.js`
  - Implement `startBatchIngestion()`, `ingestAttachment()`, `getBatchSummary()`
  - Add in-memory tracking (`attachmentJobs` Map)
  - Implement download with retry logic
  - Implement duplicate detection (checksum + provenance)
  - Integrate with `labReportProcessor`
- [x] Add database schema: `gmail_report_provenance` table
- [x] Add environment variables to `.env.example`
- [x] Write unit tests for service layer

**Acceptance:**
- Service can download attachment and compute SHA-256
- Service integrates with `labReportProcessor` successfully
- Duplicate detection works (via checksum + provenance)

---

### Phase 2: API Endpoints (1 day)

**Tasks:**
- [x] Extend `server/routes/gmailDev.js`
  - Add `POST /api/dev-gmail/ingest` endpoint
  - Add `GET /api/dev-gmail/jobs/summary` endpoint
  - Add request validation (MIME type, size, batch size)
  - Add feature flag check (`GMAIL_ATTACHMENT_INGEST_ENABLED`)
- [x] Write integration tests for API endpoints

**Acceptance:**
- `POST /ingest` starts batch and returns `batchId`
- `GET /jobs/summary` returns per-attachment progress
- Invalid requests return proper 400 errors

---

### Phase 3: Frontend - Step 3 Table (1 day)

**Tasks:**
- [x] Extend `public/gmail-dev.html`
  - Add Step 3 section with collapsible UI
  - Add attachment table with checkboxes
- [x] Extend `public/js/gmail-dev.js`
  - Implement `populateStep3Table()` from Step 2 data
  - **Wire `populateStep3Table(data.results)` into existing `displayResults()` function**
  - Implement select/deselect all logic
  - Implement "Download & Recognize" button
  - Add CSS for progress bars and status badges

**Acceptance:**
- Step 3 section automatically appears when Step 2 completes
- Step 3 table displays all Step 2 attachments
- Checkboxes work, selected count updates
- Button triggers `/api/dev-gmail/ingest` API call

---

### Phase 4: Frontend - Progress Tracking (1 day)

**Tasks:**
- [x] Implement polling logic (`startPolling()`, `updateStep3Table()`)
- [x] Update table rows with live progress
- [x] Show completion modal
- [x] Implement redirect logic

**Acceptance:**
- Progress bars update every 2s
- Status transitions correctly
- Completion modal shows after all jobs finish
- Redirect to results page works

---

### Phase 5: Gmail Results Page (0.5 days)

**Tasks:**
- [x] Create `public/gmail-results.html`
- [x] Add summary stats display
- [x] Add results table
- [x] Add navigation buttons

**Acceptance:**
- Results page shows batch summary
- Links to reports work
- Navigation buttons work

---

### Phase 6: Testing & Refinement (1 day)

**Tasks:**
- [x] Run manual testing checklist
- [x] Test error scenarios (rate limits, token expiry, failures)
- [x] Test duplicate detection (within batch, across batches)
- [x] Performance testing (batch of 10+ attachments)
- [x] Fix bugs and edge cases

**Acceptance:**
- All manual tests pass
- Error handling works as specified
- No memory leaks or crashes
- Performance meets targets

---

### Phase 7: Documentation & Handoff (0.5 days)

**Tasks:**
- [x] Update README with Step 3 setup instructions
- [x] Document configuration variables
- [x] Add code comments
- [x] Create handoff notes for future developers

**Acceptance:**
- Another developer can set up and use Step 3 from docs
- All environment variables documented
- Code is well-commented

---

**Total Estimated Time: 6-7 days** (for experienced full-stack engineer)

---

## 15. Acceptance Criteria

**Must-Have (MVP):**
- [x] UI displays all three steps (1-3) with collapsible sections
- [x] Step 3 shows all Step 2 results with checkboxes for selection
- [x] Duplicate indicators (⚠️) shown for files with same name+size
- [x] User can select/deselect attachments and start batch ingestion
- [x] Each attachment shows live progress (0-100%) and status
- [x] Status transitions correctly: Queued → Downloading → Processing → Completed/Failed/Duplicate
- [x] Completed attachments link to report detail page
- [x] Failed attachments show error message
- [x] Duplicate attachments show existing report link
- [x] On completion, redirect to dedicated results page
- [x] Results page shows batch summary and all attachment outcomes
- [x] Gmail data never logged or persisted (except provenance metadata)
- [x] Feature flag: Routes disabled unless `GMAIL_ATTACHMENT_INGEST_ENABLED=true`
- [x] Rate limits respected: max 5 concurrent downloads, exponential backoff on 429
- [x] OAuth token auto-refresh works during long-running batches
- [x] Database stores provenance data for audit trail

**Should-Have (Future Enhancements):**
- [ ] Real-time progress via Server-Sent Events (instead of polling)
- [ ] Batch pause/resume functionality
- [ ] Admin UI to view all batches and delete if needed
- [ ] Email notifications when batch completes
- [ ] Support for more file types (DOCX, XLSX)
- [ ] Automatic detection of non-lab attachments (invoices, letters, etc.) to skip

**Won't-Have (Out of Scope):**
- ❌ Automatic ingestion (user must manually select)
- ❌ Production-ready multi-user support
- ❌ Gmail message modification (labeling, deletion)
- ❌ Integration with main `index.html` to highlight Gmail reports
- ❌ Mobile-optimized UI

---

## 16. Future Considerations

### 16.1 Production Readiness

**Multi-User Support:**
- Currently: Single dev user, shared OAuth token
- Production: Each user has own OAuth tokens, stored per-user in DB
- Requires: User authentication system, per-user token management

**Permissions:**
- Add role-based access control (admin, user)
- Some users may not have Gmail integration enabled

**Rate Limiting:**
- Add per-user rate limits (e.g., max 50 attachments/day)
- Prevent quota exhaustion by single user

---

### 16.2 Advanced Features

**Intelligent Filtering:**
- Use AI to detect non-lab attachments (invoices, letters) before download
- Reduces wasted OCR quota

**Batch Management:**
- View history of all batches
- Re-process failed attachments from previous batches
- Delete entire batch (rollback)

**Real-Time Updates:**
- Replace polling with Server-Sent Events or WebSockets
- Instant progress updates without 2s delay

**Email Notifications:**
- Send email to user when batch completes
- Include summary: X succeeded, Y failed

**Advanced Duplicate Detection:**
- Content-based similarity (not just exact checksum match)
- Detect near-duplicates (e.g., same lab, different dates)

---

### 16.3 Scalability

**Current Bottlenecks:**
- In-memory `attachmentJobs` Map (lost on server restart)
- Single-server architecture (no horizontal scaling)

**Solutions:**
- Move tracking to Redis or DB (persistent, scalable)
- Use job queue (Bull, BullMQ) for distributed processing
- Deploy multiple workers for parallel processing

---

## 17. Glossary

| Term | Definition |
|------|------------|
| **Attachment ingestion** | Process of downloading Gmail attachment, running OCR, and saving to DB |
| **Batch** | Group of attachments selected by user for ingestion in a single operation |
| **Batch ID** | Unique identifier for a batch (e.g., `batch_1730900000000`) |
| **Checksum** | SHA-256 hash of attachment file contents (for duplicate detection) |
| **Concurrency limit** | Max number of simultaneous operations (e.g., 5 concurrent downloads) |
| **Completed** | Status: New report was created from attachment (insert) |
| **Updated** | Status: Existing report was updated with same file (upsert, idempotent) |
| **Duplicate (UI-level)** | Attachment with same filename+size as another (heuristic, may be false positive) |
| **Duplicate (cross-batch)** | Attachment already processed in previous batch (via provenance table) |
| **Gmail provenance** | Metadata about Gmail source (message ID, sender, subject, etc.) stored in `gmail_report_provenance` table |
| **Job** | Single unit of work tracked by `jobManager` (e.g., OCR processing of one attachment) |
| **Polling** | Frontend repeatedly requests status updates from backend (every 2s) |
| **Rate limit** | Gmail API quota restriction (250 units/second per user) |
| **Step 1** | Subject/sender classification of Gmail emails |
| **Step 2** | Body + attachment analysis of emails from Step 1 |
| **Step 3** | Attachment ingestion (download + OCR + persistence) |
| **Terminal state** | Job status that won't change: completed, updated, failed, or duplicate |
| **Tracking ID** | Unique identifier for attachment within batch: `${messageId}_${attachmentId}` |
| **Upsert** | Database operation: insert if new, update if exists (via `ON CONFLICT ... DO UPDATE`) |

---

## 18. Appendix

### 18.1 API Request/Response Examples

**POST /api/dev-gmail/ingest - Success:**

Request:
```json
{
  "selections": [
    {
      "messageId": "18f5b1c2d3e4f5g6",
      "attachmentId": "ANGjdJ8wCx...",
      "filename": "lab_results_2025.pdf",
      "mimeType": "application/pdf",
      "size": 1234567
    }
  ]
}
```

Response (200):
```json
{
  "success": true,
  "batchId": "batch_1730900000000",
  "count": 1,
  "message": "Started ingestion of 1 attachment"
}
```

**POST /api/dev-gmail/ingest - Validation Error:**

Response (400):
```json
{
  "success": false,
  "error": "Unsupported file type: application/msword"
}
```

**POST /api/dev-gmail/ingest - Auth Error:**

Response (401):
```json
{
  "success": false,
  "error": "Gmail authentication required"
}
```

**GET /api/dev-gmail/jobs/summary?batchId=batch_xxx - In Progress:**

Response (200):
```json
{
  "batchStatus": "processing",
  "completedCount": 2,
  "totalCount": 5,
  "allComplete": false,
  "attachments": [
    {
      "attachmentId": "ANGjdJ8...",
      "filename": "lab1.pdf",
      "status": "completed",
      "progress": 100,
      "progressMessage": "Successfully ingested",
      "jobId": "job_abc",
      "reportId": "uuid-1234",
      "error": null
    },
    {
      "attachmentId": "ANGjdJ9...",
      "filename": "lab2.pdf",
      "status": "processing",
      "progress": 45,
      "progressMessage": "Extracting data with OCR",
      "jobId": "job_def",
      "reportId": null,
      "error": null
    }
  ]
}
```

---

### 18.2 Database Schema SQL (Full)

```sql
-- Table: gmail_report_provenance
CREATE TABLE IF NOT EXISTS gmail_report_provenance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES patient_reports(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  attachment_id TEXT NOT NULL,
  sender_email TEXT,
  sender_name TEXT,
  email_subject TEXT,
  email_date TIMESTAMP,
  attachment_checksum TEXT NOT NULL,
  ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(message_id, attachment_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_gmail_provenance_report ON gmail_report_provenance(report_id);
CREATE INDEX IF NOT EXISTS idx_gmail_provenance_checksum ON gmail_report_provenance(attachment_checksum);
CREATE INDEX IF NOT EXISTS idx_gmail_provenance_message ON gmail_report_provenance(message_id);

-- Comments
COMMENT ON TABLE gmail_report_provenance IS 'Audit trail for reports ingested from Gmail';
COMMENT ON COLUMN gmail_report_provenance.message_id IS 'Gmail message ID (immutable identifier)';
COMMENT ON COLUMN gmail_report_provenance.attachment_id IS 'Gmail attachment ID within the message';
COMMENT ON COLUMN gmail_report_provenance.attachment_checksum IS 'SHA-256 hash of attachment for duplicate detection';
```

---

### 18.3 Configuration (.env) - Complete Example

```bash
# ================================
# Gmail Integration Configuration
# ================================

# Steps 1-2: Email Classification
GMAIL_INTEGRATION_ENABLED=true
GOOGLE_CLIENT_ID=123456789-abcdefg.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxx
GMAIL_OAUTH_REDIRECT_URI=http://localhost:3000/api/dev-gmail/oauth-callback

# Step 3: Attachment Ingestion
GMAIL_ATTACHMENT_INGEST_ENABLED=true
GMAIL_ALLOWED_MIME=application/pdf,image/png,image/jpeg,image/tiff
GMAIL_MAX_ATTACHMENT_MB=15
GMAIL_DOWNLOAD_CONCURRENCY=5
GMAIL_ATTACHMENT_TIMEOUT_MS=300000
GMAIL_BATCH_MAX_ATTACHMENTS=20

# ================================
# OCR/Vision Provider Configuration
# ================================

OCR_PROVIDER=openai
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxx
OPENAI_VISION_MODEL=gpt-4o-2024-11-20
OPENAI_USE_NATIVE_PDF=true

ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxx
ANTHROPIC_VISION_MODEL=claude-3-5-sonnet-20241022

# ================================
# PDF Processing
# ================================

PDFTOPPM_PATH=/usr/bin/pdftoppm

# ================================
# Database
# ================================

DATABASE_URL=postgresql://user:password@localhost:5432/healthup
```

---

**End of PRD**

**Status:** ✅ **Implementation-Ready**
**Next Steps:**
1. Review PRD with team for final approval
2. Create GitHub issues for each implementation phase
3. Assign engineer(s) to start Phase 1 (Backend Foundation)
4. Schedule daily standups during implementation (6-7 day timeline)

**Questions or Clarifications:** Contact PRD author or post in #gmail-integration Slack channel.
