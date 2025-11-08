# PRD v3.0: Unified Upload and Ingestion

**Status:** Draft
**Created:** 2025-11-08
**Author:** Claude (with user collaboration)
**Target Release:** v3.0

---

## Overview

### Problem Statement

HealthUp currently has two completely separate implementations for uploading and processing lab reports:

1. **Manual Upload Flow** (`index.html`):
   - Single file upload only
   - Linear progress bar with step badges
   - Inline results display that disappears on page refresh
   - Simple but limited UX

2. **Gmail Integration Flow** (`gmail-dev.html` → `gmail-results.html`):
   - Multi-file batch processing
   - Table-based progress with per-file status tracking
   - Persistent results page with "View Report" buttons
   - Superior UX but completely separate codebase

**Issues:**
- Code duplication: Two upload UIs, two progress renderers, two result displays
- Inconsistent UX: Same action (analyzing a lab report) has completely different user experiences
- Maintenance burden: Changes to OCR logic require updating multiple UI paths
- Limited manual upload: No support for multi-file uploads outside of Gmail
- Results persistence gap: Manual upload results disappear after refresh

### Goals

1. **Unify the user experience**: Single, consistent upload flow for both manual and Gmail sources
2. **Enable multi-file manual uploads**: Support drag & drop and batch processing
3. **Improve progress visibility**: Adopt table-based progress for all uploads
4. **Simplify codebase**: Remove duplicate code, consolidate UI components
5. **Maintain Gmail features**: Preserve OAuth, email classification, and duplicate detection

### Non-Goals (Out of Scope)

- Reports Library / History page (separate future PRD)
- Batch naming or user-defined labels
- Editing queue before processing (no remove functionality)
- In-page batch restart (full page refresh required)
- Backward compatibility with old single-file endpoint (will be replaced)

---

## Current State Analysis

### Manual Upload Flow (`index.html` + `app.js`)

**UI Components:**
- File input (single file only, line 19-26)
- Linear progress bar with 6 step badges (lines 32-35)
- Inline parameter table (lines 36, 233-524)
- Upload button triggers immediate processing (line 676)

**Backend:**
- `POST /api/analyze-labs` → returns `job_id` (202 Accepted)
- Client polls `GET /api/analyze-labs/jobs/:jobId` every 4s
- Progress updates via numeric percentage (0-100)
- Result displayed inline on success

**Limitations:**
- No multi-file support
- Results not persistent (disappear on refresh)
- Progress UI doesn't scale to multiple files
- No batch tracking

### Gmail Integration Flow (`gmail-dev.html` + `gmail-dev.js`)

**UI Components:**
- Connection status section (lines 22-42)
- Job progress bar for fetch/classify (lines 48-54)
- Step-1/Step-2 classification summary (lines 65-86)
- Results table with accepted emails (lines 89-104)
- Attachment selection table (Step 3, lines 172-189)
- Per-attachment progress table (lines 829-878)
- Completion modal with redirect (lines 882-923)

**Backend:**
- `POST /api/dev-gmail/fetch` → Step 1 & 2 classification
- User selects attachments in UI
- `POST /api/dev-gmail/ingest` → Step 3 download & OCR
- `GET /api/dev-gmail/jobs/summary?batchId=xxx` → batch status
- Redirects to `gmail-results.html` on completion

**Strengths:**
- Excellent progress visibility (table-based, per-file status)
- Handles batch operations gracefully
- Persistent results with batch tracking
- Duplicate detection across batches

**Shared Infrastructure:**
Both flows ultimately call `labReportProcessor.processLabReport()`, so core OCR logic is already unified.

---

## Proposed Solution

### Design Principles

1. **Two separate but equal paths**: Manual upload and Gmail import are distinct procedures with different preliminary steps, but converge on the same progress/results UI
2. **Everything on one page**: No redirects, all state transitions happen on `index.html`
3. **Progressive disclosure**: Show only relevant UI sections based on current step
4. **Table-based progress**: Scalable UI that works for 1 file or 100 files
5. **Minimal friction**: Manual upload path should be as simple as "select → start → view"

### High-Level Flow

```
                 ┌─────────────────────┐
                 │   index.html        │
                 │  (Main Page)        │
                 └──────────┬──────────┘
                            │
              ┌─────────────┴─────────────┐
              │                           │
    ┌─────────▼────────┐      ┌──────────▼──────────┐
    │ Manual Upload    │      │ Gmail Import        │
    │                  │      │                     │
    │ 1. Select files  │      │ 1. OAuth check      │
    │ 2. Queue table   │      │ 2. Fetch progress   │
    │ 3. Start btn     │      │ 3. Select attchs    │
    └─────────┬────────┘      └──────────┬──────────┘
              │                           │
              └─────────────┬─────────────┘
                            │
                  ┌─────────▼──────────┐
                  │ Unified Progress   │
                  │ Table              │
                  └─────────┬──────────┘
                            │
                  ┌─────────▼──────────┐
                  │ Results Table      │
                  │ (on same page)     │
                  └─────────┬──────────┘
                            │
                  ┌─────────▼──────────┐
                  │ View Report        │
                  │ (?reportId=xxx)    │
                  └────────────────────┘
```

---

## Detailed User Flows

### Path 1: Manual Upload

#### Step 1: File Selection

**Initial State:**
```
┌─────────────────────────────────────────────────────┐
│  Upload Lab Reports                                  │
│                                                      │
│  ┌──────────────────────┐  ┌──────────────────────┐ │
│  │ 📁 Upload Files      │  │ 📧 Import from Gmail │ │
│  └──────────────────────┘  └──────────────────────┘ │
│                                                      │
│  Drag & drop files or click above                    │
│  Supported: PDF, PNG, JPEG, HEIC, TIFF (max 10MB)    │
└─────────────────────────────────────────────────────┘
```

**User Actions:**
- Click "Upload Files" button → file picker opens (multi-select enabled)
- OR drag & drop files onto designated area

**Validation:**
- Check file types (PDF, PNG, JPEG, HEIC, TIFF)
- Check file sizes (max 10MB each)
- Reject invalid files with toast notification

#### Step 2: Upload Queue

**After file selection, queue table appears:**
```
┌─────────────────────────────────────────────────────┐
│  Selected Files                                      │
│                                                      │
│  ┌──────────────────┬──────────┬────────┐          │
│  │ Filename         │ Size     │ Type   │          │
│  ├──────────────────┼──────────┼────────┤          │
│  │ lab_jan_2024.pdf │ 2.3 MB   │ PDF    │          │
│  │ blood_test.jpg   │ 1.1 MB   │ Image  │          │
│  │ results.pdf      │ 892 KB   │ PDF    │          │
│  └──────────────────┴──────────┴────────┘          │
│                                                      │
│  [Start Processing (3 files)]                       │
└─────────────────────────────────────────────────────┘
```

**Notes:**
- No remove functionality in MVP (user must refresh page to reset)
- Button shows file count
- Table is simple: filename, size, type

#### Step 3: Processing

**User clicks "Start Processing" → Queue table transforms into progress table:**
```
┌─────────────────────────────────────────────────────────────┐
│  Processing Files                                            │
│                                                              │
│  ┌──────────────────┬──────────┬────────┬─────────────────┐ │
│  │ Filename         │ Status   │ Progress│ Details         │ │
│  ├──────────────────┼──────────┼────────┼─────────────────┤ │
│  │ lab_jan_2024.pdf │ ✅ Done  │ ████████│ Completed       │ │
│  │ blood_test.jpg   │ 🧠 Proc. │ ████▓▓▓▓│ Analyzing with… │ │
│  │ results.pdf      │ ⏳ Pend. │ ▓▓▓▓▓▓▓▓│ File uploaded   │ │
│  └──────────────────┴──────────┴────────┴─────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**Status Icons:**
- ⏳ Pending
- 🧠 Processing
- ✅ Done
- ❌ Error

**Progress Bar:**
- Visual progress bar per file (0-100%)
- Updates from job polling

**Details Column:**
- Displays `progressMessage` from job status
- Examples: "File uploaded", "Analyzing with OPENAI", "Mapping analytes", "Completed"
- Updated in real-time during processing

**Backend Flow:**
- Frontend sends all files to `POST /api/analyze-labs/batch`
- Backend returns `batchId` and array of `jobId`s
- Backend processes files with throttled concurrency (max 3 concurrent)
- Frontend polls `GET /api/analyze-labs/batches/:batchId` for unified batch status
- Update all rows from single batch response

#### Step 4: Results

**When all jobs complete, progress table transforms into results table:**
```
┌─────────────────────────────────────────────────────┐
│  Processing Complete                                 │
│                                                      │
│  ✅ Succeeded: 2    ❌ Failed: 1                     │
│                                                      │
│  ┌──────────────────┬──────────┬────────┐           │
│  │ Filename         │ Status   │ Action │           │
│  ├──────────────────┼──────────┼────────┤           │
│  │ lab_jan_2024.pdf │ ✅ Done  │ [View] │           │
│  │ blood_test.jpg   │ ✅ Done  │ [View] │           │
│  │ results.pdf      │ ❌ Error │ [Log]  │           │
│  └──────────────────┴──────────┴────────┘           │
│                                                      │
│  To upload more files, refresh this page            │
└─────────────────────────────────────────────────────┘
```

**Notes:**
- Manual uploads do NOT show duplicate count (no duplicate detection for manual path)
- No "Patient" column (data not available without additional API calls)

**User Actions:**
- Click "View" on any successful row → opens `/?reportId=xxx` in **new tab**
- Report parameter table loads in new tab, batch results remain visible in original tab
- Click "Log" on failed row → show error details in toast/alert

---

### Path 2: Gmail Import

#### Step 1: Authentication Check

**User clicks "Import from Gmail" → Dedicated section slides in below buttons:**

**Case A: Not Authenticated**
```
┌─────────────────────────────────────────────────────┐
│  Import from Gmail                                   │
│                                                      │
│  ⚠️ Gmail not connected                             │
│                                                      │
│  [Connect Gmail Account]                            │
└─────────────────────────────────────────────────────┘
```

**User clicks "Connect Gmail Account":**
- OAuth popup opens (existing `gmailConnector.getAuthUrl()` flow)
- On success, popup closes and section updates

**Case B: Already Authenticated**
```
┌─────────────────────────────────────────────────────┐
│  Import from Gmail                                   │
│                                                      │
│  ✅ Connected: user@gmail.com                       │
│                                                      │
│  [Fetch Emails]                                     │
└─────────────────────────────────────────────────────┘
```

#### Step 2: Email Fetch & Classification

**User clicks "Fetch Emails" → Section shows 2-step progress:**
```
┌─────────────────────────────────────────────────────┐
│  Fetching Lab Tests from Gmail                       │
│                                                      │
│  [==============================    ] 75%           │
│                                                      │
│  ✅ Step 1: Fetching & classifying metadata         │
│     (200 emails → 45 candidates)                    │
│                                                      │
│  🔄 Step 2: Analyzing email bodies... (30/45)       │
│                                                      │
│  Estimated time: ~30 seconds                        │
└─────────────────────────────────────────────────────┘
```

**Backend Flow:**
- `POST /api/dev-gmail/fetch` starts async job
- Returns `job_id`
- Client polls `GET /api/dev-gmail/jobs/:jobId`
- Job returns progress object with step-by-step breakdown

**Progress Mapping (matches backend implementation):**
- 0-50%: Step 1 (fetch metadata + classify subjects)
- 50-90%: Step 2 (fetch full emails + classify bodies)
- 90-100%: Final processing (duplicate detection, results assembly)

#### Step 3: Attachment Selection

**When fetch completes, section transforms into selection table:**
```
┌─────────────────────────────────────────────────────┐
│  Select Attachments to Process                       │
│                                                      │
│  ✅ Found 12 lab result emails with attachments     │
│                                                      │
│  [Select All] [Deselect All]                        │
│  [Download & Recognize Selected (0)]  ← disabled    │
│                                                      │
│  ┌─┬───────────────────┬───────────┬──────┬─────┐  │
│  │☐│ Email Details     │ Filename  │ Size │ Dup │  │
│  ├─┼───────────────────┼───────────┼──────┼─────┤  │
│  │☑│ From: Lab Corp    │ result.pdf│ 2 MB │ -   │  │
│  │☐│ Subject: Results  │           │      │     │  │
│  │☐│ Date: 2024-10-15  │           │      │     │  │
│  ├─┼───────────────────┼───────────┼──────┼─────┤  │
│  │☑│ From: Quest       │ test.pdf  │ 1 MB │ ⚠️  │  │
│  │☐│ Subject: Lab Test │           │      │     │  │
│  │☐│ Date: 2024-10-12  │           │      │     │  │
│  └─┴───────────────────┴───────────┴──────┴─────┘  │
│                                                      │
│  ⚠️ = Possible duplicate (same filename+size)       │
└─────────────────────────────────────────────────────┘
```

**User Actions:**
- Check/uncheck attachments
- "Select All" / "Deselect All" buttons
- "Download & Recognize Selected (N)" button enables when N > 0

**Validation:**
- Auto-disable invalid files (wrong MIME type, too large, inline attachments)
- Show duplicate warnings but allow selection

#### Step 4: Download & Recognize

**User clicks "Download & Recognize Selected (8)" → Section transforms into progress table:**
```
┌─────────────────────────────────────────────────────┐
│  Processing Attachments                              │
│                                                      │
│  ┌──────────────────┬──────────┬────────┬─────────┐ │
│  │ Filename         │ Status   │ Progress│ Details │ │
│  ├──────────────────┼──────────┼────────┼─────────┤ │
│  │ result.pdf       │ 🧠 AI... │ ████▓▓▓▓│ Analyz..│ │
│  │ test.pdf         │ ⬇️ Down  │ ██▓▓▓▓▓▓│ Downloa │ │
│  │ blood_work.pdf   │ ⏳ Queue │ ▓▓▓▓▓▓▓▓│ Waiting │ │
│  └──────────────────┴──────────┴────────┴─────────┘ │
└─────────────────────────────────────────────────────┘
```

**Status Progression for Each File:**
1. ⏳ Queued
2. ⬇️ Downloading (from Gmail API)
3. 🧠 AI Processing (OCR via `labReportProcessor`)
4. ✅ Completed / 🔄 Duplicate / ❌ Failed

**Backend Flow:**
- `POST /api/dev-gmail/ingest` with `selections` array
- Returns `batchId`
- Backend orchestrates concurrent downloads (respects `GMAIL_DOWNLOAD_CONCURRENCY`)
- Each attachment → `labReportProcessor.processLabReport()`
- Client polls `GET /api/dev-gmail/jobs/summary?batchId=xxx`

#### Step 5: Results

**When all downloads/processing complete, table transforms into results table:**

(Same structure as manual upload results table - see Step 4 of Path 1)

**Duplicate Handling:**
- Status shows 🔄 Duplicate
- "View" button still enabled (opens existing `reportId` in new tab)
- Details column explains: "Already processed (existing report)"

---

## UI Components Specification

### Component 1: Upload Source Buttons

**Location:** Top of main page (`index.html`)

**HTML Structure:**
```html
<div class="upload-source-selector">
  <button id="manual-upload-btn" class="upload-source-button">
    <span class="icon">📁</span>
    <span class="label">Upload Files</span>
  </button>
  <button id="gmail-import-btn" class="upload-source-button">
    <span class="icon">📧</span>
    <span class="label">Import from Gmail</span>
  </button>
</div>
<p class="help-text">
  Drag & drop files or click above<br>
  Supported: PDF, PNG, JPEG, HEIC, TIFF (max 10MB each)
</p>
```

**Behavior:**
- Manual Upload button: Opens file picker (multi-select)
- Gmail Import button: Shows/slides in Gmail section below
- Drag & drop zone covers entire area

**Gmail Feature Flag Handling:**
- On page load, check Gmail availability: `GET /api/dev-gmail/status`
- If disabled (`GMAIL_INTEGRATION_ENABLED !== 'true'` or production): Hide Gmail button entirely
- If enabled: Show Gmail button and enable OAuth flow
- No tooltips/warnings needed (feature simply doesn't appear when disabled)

**States:**
- Default: Manual button enabled, Gmail button shown only if feature enabled
- During processing: Both buttons disabled
- During results view: Both buttons disabled (require page refresh)

---

### Component 2: Upload Queue Table

**Visibility:** Shows after manual file selection, before processing starts

**HTML Structure:**
```html
<section id="upload-queue-section" class="queue-section" hidden>
  <h3>Selected Files</h3>
  <table class="queue-table">
    <thead>
      <tr>
        <th>Filename</th>
        <th>Size</th>
        <th>Type</th>
      </tr>
    </thead>
    <tbody id="queue-tbody">
      <!-- Populated dynamically -->
    </tbody>
  </table>
  <button id="start-processing-btn" class="primary-button">
    Start Processing (<span id="file-count">0</span> files)
  </button>
</section>
```

**Behavior:**
- Populated when user selects files
- Shows filename, formatted file size, MIME type
- Button click triggers transition to progress table
- No remove/edit functionality in MVP

---

### Component 3: Gmail Section

**Visibility:** Slides in below upload buttons when "Import from Gmail" clicked

**HTML Structure:**
```html
<section id="gmail-section" class="gmail-section" hidden>
  <!-- Step 1: Auth Status -->
  <div id="gmail-auth-status" class="gmail-subsection">
    <h3>Import from Gmail</h3>
    <div id="auth-status-message"></div>
    <button id="gmail-action-btn" class="primary-button"></button>
  </div>

  <!-- Step 2: Fetch Progress -->
  <div id="gmail-fetch-progress" class="gmail-subsection" hidden>
    <h3>Fetching Lab Tests from Gmail</h3>
    <progress id="gmail-progress-bar" max="100" value="0"></progress>
    <ul id="gmail-step-list" class="step-list">
      <!-- 2 steps populated here (metadata classification + body analysis) -->
    </ul>
    <p id="gmail-time-estimate"></p>
  </div>

  <!-- Step 3: Attachment Selection -->
  <div id="gmail-selection" class="gmail-subsection" hidden>
    <h3>Select Attachments to Process</h3>
    <div id="gmail-selection-summary"></div>
    <div class="selection-actions">
      <button id="select-all-btn" class="secondary-button">Select All</button>
      <button id="deselect-all-btn" class="secondary-button">Deselect All</button>
      <button id="download-recognize-btn" class="primary-button" disabled>
        Download & Recognize Selected (<span id="selected-count">0</span>)
      </button>
    </div>
    <table id="attachment-selection-table" class="selection-table">
      <!-- Populated with checkboxes -->
    </table>
  </div>
</section>
```

**Subsection Transitions:**
1. `gmail-auth-status` shows first
2. After auth → button changes from "Connect Gmail" to "Fetch Emails"
3. On fetch start → hide auth, show `gmail-fetch-progress`
4. On fetch complete → hide progress, show `gmail-selection`
5. On "Download & Recognize" → hide entire `gmail-section`, show progress table

---

### Component 4: Unified Progress Table

**Visibility:** Shows during processing for BOTH manual and Gmail paths

**HTML Structure:**
```html
<section id="progress-section" class="progress-section" hidden>
  <h3>Processing Files</h3>
  <table class="progress-table">
    <thead>
      <tr>
        <th>Filename</th>
        <th>Status</th>
        <th>Progress</th>
        <th>Details</th>
      </tr>
    </thead>
    <tbody id="progress-tbody">
      <!-- Rows populated dynamically, updated via polling -->
    </tbody>
  </table>
</section>
```

**Row Structure:**
```html
<tr data-job-id="job_123" data-report-id="">
  <td class="filename">lab_jan_2024.pdf</td>
  <td class="status"><span class="status-icon">🧠</span> AI Processing</td>
  <td class="progress">
    <div class="progress-bar-wrapper">
      <div class="progress-bar-fill" style="width: 65%"></div>
    </div>
    <span class="progress-percent">65%</span>
  </td>
  <td class="details">Analyzing with AI...</td>
</tr>
```

**Status Icons & Labels:**

**Manual Uploads (maps to job manager statuses):**
- ⏳ Pending → Backend: `pending`
- 🧠 Processing → Backend: `processing` (use progress message for detail: "Uploading...", "Analyzing...", etc.)
- ✅ Done → Backend: `completed`
- ❌ Error → Backend: `failed`

**Gmail Batches (richer status from gmailAttachmentIngest):**
- ⏳ Queued → Backend: `queued`
- ⬇️ Downloading → Backend: `downloading`
- 🧠 Processing → Backend: `processing`
- ✅ Done → Backend: `completed`
- 🔄 Updated → Backend: `updated` (reprocessed existing report with new data)
- 🔄 Duplicate → Backend: `duplicate` (skipped, links to existing report)
- ❌ Error → Backend: `failed`

**Note:** Manual uploads have simpler status vocabulary because the backend job manager only exposes `pending`, `processing`, `completed`, `failed`. Gmail batches track more granular states in `gmailAttachmentIngest`.

**Polling Logic:**
- Track array of `{ jobId, filename, status, progress, reportId }`
- Poll all jobs every 2 seconds
- Update row when job status changes
- When all jobs complete → transform to results table

---

### Component 5: Results Table

**Visibility:** Replaces progress table when all processing complete

**HTML Structure:**
```html
<section id="results-section" class="results-section" hidden>
  <h3>Processing Complete</h3>
  <div class="results-summary">
    <span class="summary-stat">✅ Succeeded: <strong id="success-count">0</strong></span>
    <span class="summary-stat" id="duplicate-stat" hidden>🔄 Duplicates: <strong id="duplicate-count">0</strong></span>
    <span class="summary-stat">❌ Failed: <strong id="failed-count">0</strong></span>
  </div>
  <table class="results-table">
    <thead>
      <tr>
        <th>Filename</th>
        <th>Status</th>
        <th>Action</th>
      </tr>
    </thead>
    <tbody id="results-tbody">
      <!-- Populated with results -->
    </tbody>
  </table>
  <p class="help-text">To upload more files, refresh this page</p>
</section>
```

**Row Structure:**
```html
<tr data-report-id="rpt_abc123">
  <td>lab_jan_2024.pdf</td>
  <td><span class="status-badge status-completed">✅ Done</span></td>
  <td>
    <a href="/?reportId=rpt_abc123" target="_blank" class="view-button">View</a>
  </td>
</tr>
```

**Action Buttons:**
- **View**: Opens `/?reportId=xxx` in new tab (batch results remain visible in original tab)
- **Log** (for failures): Show error details in toast/modal

**Summary Stats:**
- Count by status: succeeded, failed
- **Duplicates:** Only shown for Gmail batches (hidden for manual uploads)
- **Updated:** Gmail batches may show "updated" status (reprocessed reports) - count toward "Succeeded"
- Patient data removed (not available without N additional API calls)

**New Tab Behavior:**
- All "View" buttons open reports in new tabs (`target="_blank"`)
- Batch results remain visible in original tab (no page reload)
- Users can review multiple reports simultaneously in separate tabs
- To upload more files: refresh the original tab (batch results tab)

**Status Badge Mapping:**
- `completed` → ✅ Done (green badge)
- `updated` → 🔄 Updated (orange badge) - Gmail only
- `duplicate` → 🔄 Duplicate (blue badge) - Gmail only
- `failed` → ❌ Error (red badge)

---

## Technical Implementation

### Frontend Changes

#### Files to Modify

**`public/index.html`:**
- Remove single-file upload form (lines 17-29)
- Remove old progress bar (lines 32-35)
- Add new upload source buttons
- Add upload queue section
- Add Gmail section (collapsed by default)
- Add unified progress table section
- Add results table section
- Keep existing parameter table section (for report detail view)

**`public/js/app.js`:**
- Remove old single-file upload handler
- Add multi-file drag & drop support
- Add file validation (type, size)
- Add queue table renderer
- Add "Start Processing" button handler
- Add unified progress table renderer
- Add progress polling logic (supports multiple concurrent jobs)
- Add results table renderer
- Add Gmail section toggle handler
- Keep existing SQL generator and plot logic

**`public/js/gmail-dev.js` → Merge into `app.js`:**
- Extract OAuth status check logic
- Extract 2-step fetch progress renderer (updated from 5 steps)
- Extract attachment selection table logic
- Merge download & recognize button handler
- **Note:** Both manual and Gmail now use unified batch polling strategy (see "Unified Batch Polling Strategy" section)

**`public/css/style.css`:**
- Add styles for upload source buttons
- Add styles for queue table
- Add styles for Gmail section (collapsible)
- Add styles for unified progress table
- Add styles for results table
- Ensure responsive design for tables

#### Files to Create

**`public/js/batch-tracker.js`** (optional, for better code organization):
```javascript
class BatchTracker {
  constructor(batchId) {
    this.batchId = batchId;
    this.jobs = new Map(); // jobId → { filename, status, progress, reportId }
  }

  addJob(jobId, filename) { ... }
  updateJob(jobId, status, progress, reportId) { ... }
  isComplete() { ... }
  getStats() { return { succeeded, duplicates, failed }; }
}
```

This encapsulates batch state management.

#### Files to Delete (Phase 4 Only - After Production Verification)

**Do NOT delete during Phase 2 implementation:**
- `public/gmail-dev.html` (keep for rollback)
- `public/gmail-results.html` (keep for rollback)
- `public/js/gmail-dev.js` (keep until fully merged and verified)

**Delete in Phase 4 (after production verification):**
- `public/gmail-dev.html` → Functionality merged into `index.html`
- `public/gmail-results.html` → Results shown on `index.html`
- `public/js/gmail-dev.js` → **Merge into `app.js`** (single file for MVP)

**Gmail Dev JS Consolidation:**
The PRD mandates merging `gmail-dev.js` into `app.js` (not keeping as separate module). This simplifies the codebase for MVP since both flows live on the same page. Extract to modules later if `app.js` grows too large.

#### Unified Batch Polling Strategy

**Both manual and Gmail uploads now use batch polling:**

**Manual Upload Polling:**
- Poll `GET /api/analyze-labs/batches/:batchId` once per batch
- Returns: `{ batch_id, total_count, completed_count, all_complete, jobs: [{ job_id, filename, status, progress, report_id, error }] }`
- Frontend updates all rows from single response
- Poll interval: 2 seconds

**Gmail Batch Polling:**
- Poll `GET /api/dev-gmail/jobs/summary?batchId=xxx` once per batch
- Returns: `{ attachments: [{ filename, status, progress, reportId, ... }], allComplete, ... }`
- Frontend updates all rows from single response
- Poll interval: 2 seconds

**Implementation Note:**
Frontend should have two polling functions (similar structure):
```javascript
function pollManualBatch(batchId) {
  const response = await fetch(`/api/analyze-labs/batches/${batchId}`);
  const batch = await response.json();
  updateProgressTable(batch.jobs);
  return batch.all_complete;
}

function pollGmailBatch(batchId) {
  const response = await fetch(`/api/dev-gmail/jobs/summary?batchId=${batchId}`);
  const summary = await response.json();
  updateProgressTable(summary.attachments);
  return summary.allComplete;
}
```

---

### Backend Changes

#### Required Backend Changes

Unlike the Gmail flow which already has batch tracking, the manual upload path needs new batch support to enable unified progress tracking and results display.

**Endpoint Migration:**
- **Replace** `POST /api/analyze-labs` (single file) with `POST /api/analyze-labs/batch` (multi-file)
- New unified UI calls only the batch endpoint (even for single files)
- Old endpoint can be removed (no backward compatibility needed for MVP)

**File Type Standardization:**
- **Manual uploads** (`analyzeLabReport.js` `ALLOWED_MIME_TYPES`): PDF, PNG, JPEG, HEIC, TIFF
- **Gmail ingestion** (`.env` `GMAIL_ALLOWED_MIME`): PDF, PNG, JPEG, HEIC, TIFF
- **Rationale:** TIFF is common for scanned/faxed lab results and already has fallback handling in Gmail ingestion
- Remove from both: WebP, GIF (web formats rarely used for lab reports)

**New Batch Endpoints Required:**

**1. Batch Upload Endpoint**

`POST /api/analyze-labs/batch`

**Request Format:** `multipart/form-data` (following existing upload pattern)

Files uploaded via express-fileupload middleware:
- Field name: `analysisFile` (same as existing single-file endpoint)
- Frontend uses `<input type="file" name="analysisFile" multiple>` for multi-file selection
- Express-fileupload automatically converts to array when multiple files submitted
- Backend checks: `Array.isArray(req.files.analysisFile) ? req.files.analysisFile : [req.files.analysisFile]`
- Each file contains: `data` (buffer), `mimetype`, `name`, `size`

**Response (202 Accepted):**
```json
{
  "batch_id": "batch_1730900000000",
  "jobs": [
    { "job_id": "job_123", "filename": "lab1.pdf", "status": "pending" },
    { "job_id": "job_456", "filename": "test.jpg", "status": "pending" }
  ],
  "total_count": 2,
  "message": "Batch processing started. Poll /api/analyze-labs/batches/{batch_id} for status."
}
```

**Backend Implementation:**
- Generate unique `batch_id` (e.g., `batch_${Date.now()}`)
- Validate each file: check MIME type (PDF, PNG, JPEG, HEIC, TIFF) and size (max 10MB)
- Enforce batch limits: max 20 files per batch, 100MB aggregate size
- For each file: call existing `processLabReport()` logic, create individual `job_id`
- Store batch metadata in job manager: `{ batchId, jobs: [{ jobId, filename }], createdAt }`
- Process files with **throttled concurrency** (max 3 concurrent uploads to backend)
- Return immediately (don't wait for processing)

**2. Batch Status Endpoint**

`GET /api/analyze-labs/batches/:batchId`

**Response:**
```json
{
  "batch_id": "batch_1730900000000",
  "total_count": 2,
  "completed_count": 1,
  "all_complete": false,
  "jobs": [
    {
      "job_id": "job_123",
      "filename": "lab1.pdf",
      "status": "completed",
      "progress": 100,
      "progress_message": "Completed",
      "report_id": "rpt_abc123",
      "error": null
    },
    {
      "job_id": "job_456",
      "filename": "test.jpg",
      "status": "processing",
      "progress": 65,
      "progress_message": "Analyzing with OPENAI",
      "report_id": null,
      "error": null
    }
  ]
}
```

**Backend Implementation:**
- Look up batch by `batchId` in job manager
- Aggregate status from all individual jobs
- Return array of job statuses with filenames
- Similar structure to `GET /api/dev-gmail/jobs/summary?batchId=xxx`

**3. Job Manager Extensions**

Extend `server/utils/jobManager.js`:

```javascript
// New batch tracking structure
const batches = new Map(); // batchId → { batchId, jobs: [...], createdAt }

function createBatch(userId, files) {
  const batchId = `batch_${Date.now()}`;
  const jobs = files.map(file => ({
    jobId: createJob(userId, { filename: file.filename, batchId }),
    filename: file.filename,
    status: 'pending'
  }));

  batches.set(batchId, {
    batchId,
    userId,
    jobs,
    createdAt: Date.now()
  });

  return { batchId, jobs };
}

function getBatchStatus(batchId) {
  const batch = batches.get(batchId);
  if (!batch) return null;

  const jobsWithStatus = batch.jobs.map(({ jobId, filename }) => {
    const job = getJobStatus(jobId);
    return {
      job_id: jobId,
      filename,
      status: job.status,
      progress: job.progress,
      progress_message: job.progressMessage || '',
      report_id: job.result?.report_id || null,
      error: job.error
    };
  });

  return {
    batch_id: batchId,
    total_count: batch.jobs.length,
    completed_count: jobsWithStatus.filter(j => j.status === 'completed').length,
    all_complete: jobsWithStatus.every(j => j.status === 'completed' || j.status === 'failed'),
    jobs: jobsWithStatus
  };
}
```

**4. Upload Concurrency Control**

Frontend will send all files to `POST /api/analyze-labs/batch`, but backend should process with throttled concurrency:

```javascript
// In batch upload handler
async function processBatchFiles(files, batchId) {
  const CONCURRENCY = 3; // Process 3 files at a time

  const queue = [...files];
  const active = new Set();

  while (queue.length || active.size) {
    // Start new jobs up to concurrency limit
    while (active.size < CONCURRENCY && queue.length) {
      const file = queue.shift();
      const promise = processLabReport({
        jobId: file.jobId,
        fileBuffer: file.data, // Already a buffer from express-fileupload
        mimetype: file.mimetype,
        filename: file.name,
        fileSize: file.size
      }).finally(() => active.delete(promise));

      active.add(promise);
    }

    // Wait for at least one to complete
    if (active.size) {
      await Promise.race(active);
    }
  }
}
```

**5. Batch Size Limits & Memory Management**

**Constraints:**
- **Maximum files per batch:** 20 files
- **Maximum file size:** 10MB each
- **Maximum aggregate size:** 100MB per batch (across all files)
- **Memory consideration:** Currently `useTempFiles: false` stores all buffers in memory

**Validation:**
- Reject batches exceeding 20 files with clear error message
- Reject individual files > 10MB
- Calculate total size and reject if aggregate > 100MB
- Return 400 Bad Request with details: `{ error: 'Batch exceeds limits', limit: 'max_files|max_size|aggregate_size', ... }`

**Future Optimization:**
- Consider enabling `useTempFiles: true` for batch endpoint to reduce memory pressure
- Would require cleanup of temp files after processing
- Trade-off: disk I/O vs memory consumption

**Gmail Endpoints:**

**New Status Check Endpoint:**
- `GET /api/dev-gmail/status` - Check if Gmail integration is available
  - Returns: `{ enabled: true/false, reason?: string }`
  - Logic: `enabled = (GMAIL_INTEGRATION_ENABLED === 'true' && NODE_ENV !== 'production')`
  - Frontend uses this on page load to show/hide Gmail button
  - Does NOT require feature flag guard (allows checking status)

**Existing Gmail Endpoints (unchanged):**
- `POST /api/dev-gmail/fetch` (email classification)
- `GET /api/dev-gmail/jobs/:jobId` (fetch job polling)
- `POST /api/dev-gmail/ingest` (attachment download & process)
- `GET /api/dev-gmail/jobs/summary?batchId=xxx` (batch summary)

---

### Database Changes

#### Optional: Batch Tracking Table

Currently, only Gmail batches are tracked via `gmail_report_provenance`. To support batch history for manual uploads, consider adding:

```sql
CREATE TABLE IF NOT EXISTS report_batches (
  batch_id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  source_type TEXT NOT NULL, -- 'manual' or 'gmail'
  total_count INTEGER NOT NULL,
  success_count INTEGER DEFAULT 0,
  duplicate_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  completed_at TIMESTAMPTZ,
  metadata JSONB -- store additional context
);

CREATE TABLE IF NOT EXISTS batch_reports (
  id SERIAL PRIMARY KEY,
  batch_id TEXT REFERENCES report_batches(batch_id),
  report_id TEXT REFERENCES patient_reports(id),
  status TEXT NOT NULL, -- 'completed', 'duplicate', 'failed'
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Benefit:** Enables future Reports Library feature.

**For MVP:** Optional. Can track batches in-memory for the session and add persistence later.

---

## Acceptance Criteria

### Manual Upload Path

- [ ] User can select multiple files via file picker (multi-select enabled)
- [ ] User can drag & drop multiple files onto upload area
- [ ] Only accepts: PDF, PNG, JPEG, HEIC, TIFF (max 10MB each)
- [ ] Enforces batch limits: max 20 files, 100MB aggregate size
- [ ] Invalid files (wrong type, too large) are rejected with toast notification
- [ ] Batch exceeding limits shows clear error message
- [ ] Selected files appear in queue table with filename, size, type
- [ ] "Start Processing" button shows correct file count
- [ ] Clicking "Start Processing" sends batch to `POST /api/analyze-labs/batch`
- [ ] Backend processes files with throttled concurrency (max 3 concurrent)
- [ ] Queue table transitions to progress table
- [ ] Progress table shows per-file status icons: ⏳ Pending, 🧠 Processing, ✅ Done, ❌ Error
- [ ] Progress updates in real-time via batch polling (`GET /api/analyze-labs/batches/:batchId` every 2 seconds)
- [ ] When all jobs complete, progress table transforms to results table
- [ ] Results table shows summary stats: **succeeded and failed only** (NO duplicate count, NO updated count)
- [ ] Results table has 3 columns: Filename, Status, Action (NO Patient column)
- [ ] Clicking "View" on a result opens `/?reportId=xxx` in **new tab** (batch results remain visible)
- [ ] View buttons use `target="_blank"` attribute
- [ ] Clicking "Log" on a failed result shows error details

### Gmail Import Path

- [ ] On page load, frontend checks `GET /api/dev-gmail/status`
- [ ] If Gmail disabled: Gmail button hidden entirely (no tooltip/warning)
- [ ] If Gmail enabled: Gmail button visible and functional
- [ ] User clicks "Import from Gmail" → dedicated section slides in below buttons
- [ ] If not authenticated, "Connect Gmail" button shown
- [ ] Clicking "Connect Gmail" opens OAuth popup
- [ ] On successful auth, button changes to "Fetch Emails"
- [ ] Clicking "Fetch Emails" shows **2-step progress** with percentage bar (NOT 5 steps)
- [ ] Progress updates reflect backend job status: 0-50% (Step 1), 50-90% (Step 2)
- [ ] When fetch completes, attachment selection table appears
- [ ] Selection table shows email details, filename, size, duplicate warning
- [ ] Invalid attachments (wrong MIME, too large) are disabled
- [ ] "Select All" / "Deselect All" buttons work correctly
- [ ] "Download & Recognize" button shows selected count and enables when count > 0
- [ ] Clicking "Download & Recognize" hides Gmail section and shows progress table
- [ ] Gmail files show download status (⬇️) before OCR processing
- [ ] Progress polling uses batch summary endpoint (`GET /api/dev-gmail/jobs/summary?batchId=xxx`)
- [ ] When all downloads/processing complete, progress table transforms to results table
- [ ] Results table shows summary stats: **succeeded, duplicates, and failed** (duplicates only for Gmail)
- [ ] Results table handles "updated" status (🔄 Updated badge, counts toward succeeded)
- [ ] Results table has 3 columns: Filename, Status, Action (NO Patient column)
- [ ] Duplicate detection works (shows 🔄 Duplicate status, links to existing report)
- [ ] Updated reports work (shows 🔄 Updated status, links to reprocessed report)

### Shared Requirements

- [ ] Both paths use identical progress table structure (same columns, same styling)
- [ ] Both paths use same results table structure (3 columns: Filename, Status, Action)
- [ ] Results table differences: Gmail shows duplicate/updated counts, manual uploads show only succeeded/failed
- [ ] No "source" column in progress or results tables
- [ ] No "patient" column in results tables (data not available)
- [ ] All "View" buttons open reports in new tab (`target="_blank"`), batch results remain visible
- [ ] Users can open multiple reports in separate tabs for parallel review
- [ ] Upload source buttons disabled during processing
- [ ] Page refresh resets state and shows initial upload buttons
- [ ] No console errors during any flow
- [ ] Responsive design works on mobile/tablet
- [ ] Batch polling implemented for both paths (manual: `/api/analyze-labs/batches/:batchId`, Gmail: `/api/dev-gmail/jobs/summary?batchId=xxx`)
- [ ] Backend throttles manual uploads to 3 concurrent processing jobs
- [ ] Batch status endpoint includes `progress_message` field for Details column rendering

### Code Quality

- [ ] `gmail-dev.html` and `gmail-results.html` deleted (Phase 4 only, after production verification)
- [ ] `gmail-dev.js` merged into `app.js` (Phase 4 only)
- [ ] No duplicate progress rendering logic (unified in `app.js`)
- [ ] Code is well-commented for future maintainers
- [ ] Error handling for network failures, API errors, etc.
- [ ] Loading states for all async operations
- [ ] Backend batch endpoints fully tested and documented

---

## Migration Plan

### Phase 1: Build New Backend (Backend Changes)

1. **Implement Gmail status endpoint:**
   - Add `GET /api/dev-gmail/status` endpoint (does NOT require feature flag guard)
   - Returns `{ enabled: boolean, reason?: string }`
   - Logic: `enabled = (process.env.GMAIL_INTEGRATION_ENABLED === 'true' && process.env.NODE_ENV !== 'production')`
2. **Standardize file type support:**
   - Update `analyzeLabReport.js` `ALLOWED_MIME_TYPES` to: PDF, PNG, JPEG, HEIC, TIFF
   - Update `.env` `GMAIL_ALLOWED_MIME` to: `application/pdf,image/png,image/jpeg,image/heic,image/tiff`
   - Keep TIFF (common for scanned/faxed lab results)
   - Remove: WebP, GIF (web formats rarely used for lab reports)
3. **Implement batch endpoints** in backend:
   - `POST /api/analyze-labs/batch` (accepts multiple files, returns batch_id)
   - `GET /api/analyze-labs/batches/:batchId` (batch status polling)
   - Extend `server/utils/jobManager.js` with batch tracking
   - Implement throttled concurrency (3 concurrent uploads)
4. **Test backend thoroughly:**
   - Upload multiple files via new batch endpoint
   - Verify throttled processing (max 3 concurrent)
   - Check batch status polling returns correct data
   - Verify file type validation (accepts PDF/PNG/JPEG/HEIC/TIFF, rejects others)
   - Test batch limits: reject batches > 20 files or > 100MB aggregate
   - Test field name: `analysisFile` with multiple files

### Phase 2: Build New UI (No Breaking Changes Yet)

1. **Keep old files intact** for rollback safety:
   - `index.html` (old single-file form remains)
   - `gmail-dev.html` and `gmail-results.html` remain
2. **Add new sections to `index.html`** (feature-flagged or hidden):
   - Upload source buttons (manual + Gmail)
   - Upload queue table
   - Gmail section (OAuth, fetch progress, selection)
   - Unified progress table
   - Results table
3. **Merge `gmail-dev.js` into `app.js`:**
   - Extract OAuth logic
   - Extract fetch/classify UI
   - Extract attachment selection
   - Add batch upload logic for manual files
   - Add unified progress polling
4. **Test new UI thoroughly:**
   - Manual multi-file upload → batch processing → results
   - Gmail OAuth → fetch → select → ingest → results
   - Verify both use unified progress/results tables

### Phase 3: Deploy and Verify

1. **Deploy to staging/production**
2. **Monitor for issues** (1-2 weeks)
3. **Verify user feedback**

### Phase 4: Remove Old Code (After Verification)

1. **Delete old UI files:**
   - `public/gmail-dev.html`
   - `public/gmail-results.html`
   - `public/js/gmail-dev.js` (if fully merged into `app.js`)
2. **Remove old code from `index.html`:**
   - Old single-file upload form
   - Old linear progress bar
   - Old inline results display
3. **Remove old backend endpoint:**
   - Delete/replace `POST /api/analyze-labs` (single file) route
   - Keep only `POST /api/analyze-labs/batch` (multi-file) route
4. **Clean up unused CSS**
5. **Update CLAUDE.md** with new architecture
6. **Update any screenshots/documentation**

**Important:** Do NOT delete old files in Phase 2. Keep them for rollback until new flow is verified in production.

---

## Future Enhancements (Post-v3.0)

### Reports Library Page (Separate PRD)

- View all past batches and reports
- Filter by date, patient, source
- Search functionality
- Batch naming/labeling

### Backend Consolidation

- Unified `/api/reports/ingest` endpoint
- Single job manager for all upload types
- Batch persistence in database

### Queue Improvements

- Remove files from queue before processing
- Reorder queue
- Save draft queues

### Better Duplicate Handling

- Show duplicate details before processing
- Option to update existing report vs. skip
- Cross-batch duplicate detection for manual uploads

### Batch Resume

- Resume incomplete batches after page refresh
- Persistent batch tracking in local storage or database

---

## Open Questions

1. **Should we persist batch metadata to database now or later?**
   - Later = simpler MVP, batches tracked in-memory only
   - Now = enables future Reports Library more easily

2. **Error handling for partial batch failures:**
   - Should we show a "Retry Failed" button in results table?
   - Or require user to manually re-upload failed files?

3. **Gmail token expiration during long batches:**
   - What happens if OAuth token expires mid-batch?
   - Auto-refresh implemented in `gmailConnector`, but should UI show warning?

4. **Progress polling performance:**
   - Polling 100+ jobs every 2 seconds = lots of requests
   - Should we batch poll requests? (e.g., `GET /jobs?ids=job1,job2,job3`)

5. **Mobile UX:**
   - Drag & drop not available on mobile
   - Gmail import might be primary path for mobile users
   - Should we optimize mobile UI differently?

---

## Success Metrics

- **Code reduction:** 30%+ reduction in upload-related LOC (lines of code)
- **User satisfaction:** Positive feedback on multi-file upload capability
- **Bug reduction:** Fewer upload-related issues reported
- **Maintenance time:** Faster implementation of OCR improvements (no dual UI updates)
- **Feature parity:** All existing functionality preserved (OAuth, classification, duplicate detection)

---

## Appendix: Wireframes

### Main Page - Initial State
```
┌────────────────────────────────────────────────────┐
│  HealthUp - Upload Analysis                         │
├────────────────────────────────────────────────────┤
│                                                     │
│  Upload Lab Reports                                 │
│                                                     │
│  ┌────────────────────┐  ┌─────────────────────┐  │
│  │  📁 Upload Files   │  │ 📧 Import from Gmail│  │
│  └────────────────────┘  └─────────────────────┘  │
│                                                     │
│  Drag & drop files or click above                  │
│  Supported: PDF, PNG, JPEG, HEIC, TIFF (max 10MB)  │
│                                                     │
│  ─────────────────────────────────────────────────  │
│                                                     │
│  Ask the Database                                   │
│  [SQL Generator section - unchanged]               │
│                                                     │
└────────────────────────────────────────────────────┘
```

### Manual Upload - Queue State
```
┌────────────────────────────────────────────────────┐
│  HealthUp - Upload Analysis                         │
├────────────────────────────────────────────────────┤
│                                                     │
│  Upload Lab Reports                                 │
│                                                     │
│  ┌────────────────────┐  ┌─────────────────────┐  │
│  │  📁 Upload Files   │  │ 📧 Import from Gmail│  │
│  └────────────────────┘  └─────────────────────┘  │
│                                                     │
│  ┌──────────────────────────────────────────────┐ │
│  │  Selected Files (3)                          │ │
│  │                                              │ │
│  │  Filename           Size      Type           │ │
│  │  ─────────────────  ────────  ─────────────  │ │
│  │  lab_jan_2024.pdf   2.3 MB    PDF            │ │
│  │  blood_test.jpg     1.1 MB    Image          │ │
│  │  results.pdf        892 KB    PDF            │ │
│  │                                              │ │
│  │  [Start Processing (3 files)]               │ │
│  └──────────────────────────────────────────────┘ │
│                                                     │
└────────────────────────────────────────────────────┘
```

### Gmail Import - Fetch Progress
```
┌────────────────────────────────────────────────────┐
│  HealthUp - Upload Analysis                         │
├────────────────────────────────────────────────────┤
│                                                     │
│  Upload Lab Reports                                 │
│                                                     │
│  ┌────────────────────┐  ┌─────────────────────┐  │
│  │  📁 Upload Files   │  │ 📧 Import from Gmail│  │
│  └────────────────────┘  └─────────────────────┘  │
│                                                     │
│  ┌──────────────────────────────────────────────┐ │
│  │  Fetching Lab Tests from Gmail               │ │
│  │                                              │ │
│  │  [====================          ] 60%        │ │
│  │                                              │ │
│  │  ✅ Step 1: Fetching & classifying metadata │ │
│  │     (200 emails → 45 candidates)            │ │
│  │                                              │ │
│  │  🔄 Step 2: Analyzing email bodies...       │ │
│  │     (27/45 completed)                       │ │
│  │                                              │ │
│  │  Estimated time: ~40 seconds                │ │
│  └──────────────────────────────────────────────┘ │
│                                                     │
└────────────────────────────────────────────────────┘
```

### Unified Progress Table
```
┌────────────────────────────────────────────────────┐
│  HealthUp - Upload Analysis                         │
├────────────────────────────────────────────────────┤
│                                                     │
│  Processing Files                                   │
│                                                     │
│  Filename          Status     Progress   Details   │
│  ───────────────── ─────────  ────────   ────────  │
│  lab_jan_2024.pdf  ✅ Done    ████████   12 param  │
│  blood_test.jpg    🧠 AI...   ████▓▓▓▓   Analyz... │
│  results.pdf       ⏳ Queue   ▓▓▓▓▓▓▓▓   Waiting   │
│  test_report.pdf   ⬇️ Down    ██▓▓▓▓▓▓   Download  │
│                                                     │
└────────────────────────────────────────────────────┘
```

### Results Table (Manual Upload)
```
┌────────────────────────────────────────────────────┐
│  HealthUp - Upload Analysis                         │
├────────────────────────────────────────────────────┤
│                                                     │
│  Processing Complete                                │
│                                                     │
│  ✅ Succeeded: 3    ❌ Failed: 1                    │
│                                                     │
│  Filename              Status       Action          │
│  ────────────────────  ──────────   ──────          │
│  lab_jan_2024.pdf      ✅ Done      [View]          │
│  blood_test.jpg        ✅ Done      [View]          │
│  results.pdf           ✅ Done      [View]          │
│  corrupted.pdf         ❌ Error     [Log]           │
│                                                     │
│  To upload more files, refresh this page            │
│                                                     │
└────────────────────────────────────────────────────┘
```

### Results Table (Gmail Import)
```
┌────────────────────────────────────────────────────┐
│  HealthUp - Upload Analysis                         │
├────────────────────────────────────────────────────┤
│                                                     │
│  Processing Complete                                │
│                                                     │
│  ✅ Succeeded: 3   🔄 Duplicates: 1   ❌ Failed: 0  │
│                                                     │
│  Filename              Status       Action          │
│  ────────────────────  ──────────   ──────          │
│  lab_jan_2024.pdf      ✅ Done      [View]          │
│  blood_test.jpg        ✅ Done      [View]          │
│  results.pdf           🔄 Duplicate [View]          │
│  test_report.pdf       ✅ Done      [View]          │
│                                                     │
│  To upload more files, refresh this page            │
│                                                     │
└────────────────────────────────────────────────────┘
```

---

**End of PRD v3.0**
