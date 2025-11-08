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
- Backend endpoint consolidation (keep existing APIs for now)
- Batch naming or user-defined labels
- Editing queue before processing (no remove functionality)
- In-page batch restart (full page refresh required)

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
│  Supported: PDF, PNG, JPEG, TIFF (max 10MB each)    │
└─────────────────────────────────────────────────────┘
```

**User Actions:**
- Click "Upload Files" button → file picker opens (multi-select enabled)
- OR drag & drop files onto designated area

**Validation:**
- Check file types (PDF, PNG, JPEG, TIFF)
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
┌─────────────────────────────────────────────────────┐
│  Processing Files                                    │
│                                                      │
│  ┌──────────────────┬──────────┬────────┬─────────┐ │
│  │ Filename         │ Status   │ Progress│ Details │ │
│  ├──────────────────┼──────────┼────────┼─────────┤ │
│  │ lab_jan_2024.pdf │ ✅ Done  │ ████████│ 12 parm │ │
│  │ blood_test.jpg   │ 🧠 AI... │ ████▓▓▓▓│ Analyz..│ │
│  │ results.pdf      │ ⏳ Queue │ ▓▓▓▓▓▓▓▓│ Waiting │ │
│  └──────────────────┴──────────┴────────┴─────────┘ │
└─────────────────────────────────────────────────────┘
```

**Status Icons:**
- ⏳ Queued
- ⬆️ Uploading
- 🧠 AI Processing
- ✅ Completed
- ❌ Failed
- 🔄 Duplicate

**Progress Bar:**
- Visual progress bar per file (0-100%)
- Updates from job polling

**Backend Flow:**
- Create batch with unique `batchId`
- For each file: call `POST /api/analyze-labs` → get `jobId`
- Poll each job independently
- Update row status as jobs progress

#### Step 4: Results

**When all jobs complete, progress table transforms into results table:**
```
┌─────────────────────────────────────────────────────┐
│  Processing Complete                                 │
│                                                      │
│  ✅ Succeeded: 2    🔄 Duplicates: 0    ❌ Failed: 1 │
│                                                      │
│  ┌──────────────────┬──────────┬─────────┬────────┐ │
│  │ Filename         │ Status   │ Patient │ Action │ │
│  ├──────────────────┼──────────┼─────────┼────────┤ │
│  │ lab_jan_2024.pdf │ ✅ Done  │ John D. │ [View] │ │
│  │ blood_test.jpg   │ ✅ Done  │ John D. │ [View] │ │
│  │ results.pdf      │ ❌ Error │ -       │ [Log]  │ │
│  └──────────────────┴──────────┴─────────┴────────┘ │
│                                                      │
│  To upload more files, refresh this page            │
└─────────────────────────────────────────────────────┘
```

**User Actions:**
- Click "View" on any successful row → navigate to `/?reportId=xxx`
- Report parameter table loads on same page
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

**User clicks "Fetch Emails" → Section shows 5-step progress:**
```
┌─────────────────────────────────────────────────────┐
│  Fetching Lab Tests from Gmail                       │
│                                                      │
│  [==============================    ] 75%           │
│                                                      │
│  ✅ Step 1: Fetched 200 emails                      │
│  ✅ Step 2: Classified subjects (45 candidates)     │
│  ✅ Step 3: Fetched full content (45 emails)        │
│  🔄 Step 4: Classifying bodies... (30/45)           │
│  ⏳ Step 5: Checking duplicates...                  │
│                                                      │
│  Estimated time: ~30 seconds                        │
└─────────────────────────────────────────────────────┘
```

**Backend Flow:**
- `POST /api/dev-gmail/fetch` starts async job
- Returns `job_id`
- Client polls `GET /api/dev-gmail/jobs/:jobId`
- Job returns progress object with step-by-step breakdown

**Progress Mapping:**
- 0-20%: Step 1 (fetch metadata)
- 20-40%: Step 2 (classify subjects)
- 40-60%: Step 3 (fetch full emails)
- 60-80%: Step 4 (classify bodies)
- 80-100%: Step 5 (duplicate detection)

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
- "View" button still enabled (links to existing `reportId`)
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
  Supported: PDF, PNG, JPEG, TIFF (max 10MB each)
</p>
```

**Behavior:**
- Manual Upload button: Opens file picker (multi-select)
- Gmail Import button: Shows/slides in Gmail section below
- Both buttons always visible at top
- Drag & drop zone covers entire area

**States:**
- Default: Both enabled
- During processing: Both disabled
- During results view: Both disabled (require page refresh)

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
      <!-- 5 steps populated here -->
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
- ⏳ Queued
- ⬆️ Uploading
- ⬇️ Downloading (Gmail only)
- 🧠 AI Processing
- ✅ Completed
- 🔄 Duplicate
- ❌ Failed

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
    <span class="summary-stat">🔄 Duplicates: <strong id="duplicate-count">0</strong></span>
    <span class="summary-stat">❌ Failed: <strong id="failed-count">0</strong></span>
  </div>
  <table class="results-table">
    <thead>
      <tr>
        <th>Filename</th>
        <th>Status</th>
        <th>Patient</th>
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
  <td>John Doe</td>
  <td>
    <a href="/?reportId=rpt_abc123" class="view-button">View</a>
  </td>
</tr>
```

**Action Buttons:**
- **View**: Navigate to `/?reportId=xxx` (loads report parameter table)
- **Log** (for failures): Show error details in toast/modal

**Summary Stats:**
- Count by status: succeeded, duplicates, failed
- Update dynamically as results come in

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
- Extract 5-step fetch progress renderer
- Extract attachment selection table logic
- Merge download & recognize button handler
- Unify progress polling (use same mechanism as manual upload)

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

#### Files to Delete

- `public/gmail-dev.html` (functionality merged into index.html)
- `public/gmail-results.html` (results now shown on index.html)
- Optionally consolidate `public/js/gmail-dev.js` into `app.js`

---

### Backend Changes

#### No Major Backend Changes Required

**Keep existing endpoints:**
- `POST /api/analyze-labs` (manual upload)
- `GET /api/analyze-labs/jobs/:jobId` (job polling)
- `POST /api/dev-gmail/fetch` (email classification)
- `GET /api/dev-gmail/jobs/:jobId` (fetch job polling)
- `POST /api/dev-gmail/ingest` (attachment download & process)
- `GET /api/dev-gmail/jobs/summary?batchId=xxx` (batch summary)

**Why no consolidation?**
- Different preliminary steps (Gmail requires fetch/classify, manual doesn't)
- Different job structures (Gmail has attachment metadata, manual has file buffer)
- Refactoring can be done in a future PRD after UI is stable

**Potential future optimization:**
Create unified `/api/reports/ingest` endpoint that accepts:
```json
{
  "sources": [
    { "type": "file", "data": "base64...", "filename": "test.pdf" },
    { "type": "gmail", "messageId": "...", "attachmentId": "..." }
  ]
}
```

But this is out of scope for v3.0.

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
- [ ] Invalid files (wrong type, too large) are rejected with toast notification
- [ ] Selected files appear in queue table with filename, size, type
- [ ] "Start Processing" button shows correct file count
- [ ] Clicking "Start Processing" transitions queue table to progress table
- [ ] Progress table shows per-file status icons and progress bars
- [ ] Progress updates in real-time via polling (every 2 seconds)
- [ ] When all jobs complete, progress table transforms to results table
- [ ] Results table shows summary stats (succeeded, duplicates, failed)
- [ ] Clicking "View" on a result navigates to `/?reportId=xxx` and loads report
- [ ] Clicking "Log" on a failed result shows error details

### Gmail Import Path

- [ ] User clicks "Import from Gmail" → dedicated section slides in below buttons
- [ ] If not authenticated, "Connect Gmail" button shown
- [ ] Clicking "Connect Gmail" opens OAuth popup
- [ ] On successful auth, button changes to "Fetch Emails"
- [ ] Clicking "Fetch Emails" shows 5-step progress with percentage bar
- [ ] Progress updates reflect backend job status (Step 1 → 5)
- [ ] When fetch completes, attachment selection table appears
- [ ] Selection table shows email details, filename, size, duplicate warning
- [ ] Invalid attachments (wrong MIME, too large) are disabled
- [ ] "Select All" / "Deselect All" buttons work correctly
- [ ] "Download & Recognize" button shows selected count and enables when count > 0
- [ ] Clicking "Download & Recognize" hides Gmail section and shows progress table
- [ ] Gmail files show download status (⬇️) before OCR processing
- [ ] When all downloads/processing complete, progress table transforms to results table
- [ ] Duplicate detection works (shows 🔄 status and links to existing report)

### Shared Requirements

- [ ] Both paths use identical progress table structure (same columns, same styling)
- [ ] Both paths use identical results table structure
- [ ] No "source" column in progress or results tables
- [ ] Upload source buttons disabled during processing
- [ ] Page refresh resets state and shows initial upload buttons
- [ ] No console errors during any flow
- [ ] Responsive design works on mobile/tablet

### Code Quality

- [ ] `gmail-dev.html` and `gmail-results.html` deleted
- [ ] No duplicate progress rendering logic (unified in `app.js`)
- [ ] Code is well-commented for future maintainers
- [ ] Error handling for network failures, API errors, etc.
- [ ] Loading states for all async operations

---

## Migration Plan

### Phase 1: Build New UI (No Breaking Changes)

1. Add new upload source buttons to `index.html`
2. Add new sections (queue, Gmail, progress, results) - all hidden by default
3. Implement new JavaScript logic in `app.js`
4. Test manual upload path thoroughly
5. Test Gmail import path thoroughly
6. Keep old UI hidden but functional (for rollback)

### Phase 2: Remove Old Code

1. Delete old single-file upload form from `index.html`
2. Delete old progress bar code
3. Delete old inline results display logic
4. Remove `gmail-dev.html` and `gmail-results.html`
5. Remove unused CSS

### Phase 3: Cleanup

1. Remove dead code from `app.js` (old upload handler)
2. Consolidate `gmail-dev.js` into `app.js` or separate module
3. Update README.md with new upload flow documentation
4. Update any screenshots/demos

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
│  Supported: PDF, PNG, JPEG, TIFF (max 10MB)        │
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
│  │  ✅ Step 1: Fetched 200 emails              │ │
│  │  ✅ Step 2: Classified subjects (45)        │ │
│  │  ✅ Step 3: Fetched full content (45)       │ │
│  │  🔄 Step 4: Classifying bodies... (27/45)   │ │
│  │  ⏳ Step 5: Checking duplicates...          │ │
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

### Results Table
```
┌────────────────────────────────────────────────────┐
│  HealthUp - Upload Analysis                         │
├────────────────────────────────────────────────────┤
│                                                     │
│  Processing Complete                                │
│                                                     │
│  ✅ Succeeded: 3    🔄 Duplicates: 0   ❌ Failed: 1 │
│                                                     │
│  Filename          Status    Patient    Action     │
│  ───────────────── ────────  ────────   ──────     │
│  lab_jan_2024.pdf  ✅ Done   John D.    [View]     │
│  blood_test.jpg    ✅ Done   John D.    [View]     │
│  results.pdf       ✅ Done   John D.    [View]     │
│  corrupted.pdf     ❌ Error  -          [Log]      │
│                                                     │
│  To upload more files, refresh this page            │
│                                                     │
└────────────────────────────────────────────────────┘
```

---

**End of PRD v3.0**
