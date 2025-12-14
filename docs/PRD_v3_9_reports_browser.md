# PRD v3.9: Reports Browser

**Status:** Draft
**Created:** 2025-12-13
**Author:** Claude (with user collaboration)
**Target Release:** v3.9
**Dependencies:** PRD v3.4 (Storing Original Lab Files)

---

## Overview

### Problem Statement

After uploading and processing lab reports via OCR, users can only view the extracted results immediately after processing. There is no way to revisit previously processed reports.

**Current behavior:**
1. User uploads lab report(s)
2. OCR extracts data, results displayed once
3. Results disappear after navigating away
4. User cannot view past reports without re-uploading

**Desired behavior:**
1. New "Reports" menu item in sidebar
2. Shows list of all **successfully processed** reports across all patients (status = 'completed')
3. User can filter by date range and patient
4. "View Data" opens extracted lab results in new tab (same UI as post-OCR)
5. "View Original" opens the original file in new tab

### Goals

1. **Browse all reports**: Single view showing all processed reports across all patients
2. **Filter reports**: Filter by date range and patient name
3. **View extracted data**: Re-open any report's extracted lab results in the same UI as post-OCR
4. **View original files**: Access the original uploaded PDF/image files
5. **Consistent UX**: Reuse existing UI patterns and components

### Non-Goals (Out of Scope)

- Pagination (load all reports for MVP - acceptable for <100 reports; see Performance Considerations below)
- Delete reports
- Re-process OCR
- Download original files (just view in browser)
- Search by parameter/analyte name
- Bulk operations
- Authentication/authorization (single-user personal health app - no multi-tenancy)

---

## Solution Design

### User Flow

```
Sidebar "Reports" → Reports List Table → Filter by date/patient → Click "View Data" OR "View Original"
                                                                         ↓                    ↓
                                                              New tab: Lab Results    New tab: PDF/Image
```

### UI Components

**1. Sidebar Menu Item**
- Label: "Reports"
- Icon: 📄
- Position: Under "Health Assistant" in Main section
- Behavior: Shows reports section, hides other sections

**2. Reports List View**
- Full-width table showing all reports
- Default sort: Most recent first (by `test_date_text`, falling back to `recognized_at`)
- Columns:
  - **Date**: Report date (`test_date_text` or `recognized_at` fallback)
  - **Patient**: Patient name from `patients.full_name`
  - **Actions**: Two buttons - "View Data" | "View Original"

**3. Filter Controls**
- **Date Range**: Two date inputs (from/to)
- **Patient**: Dropdown populated with all patients
- **Clear Filters**: Button to reset

**4. Report Detail View (existing)**
- Opens in new tab via `?reportId=xxx`
- Reuses existing `app.js` report rendering logic
- Shows patient demographics + parameters table
- **Navigation behavior**: When `reportId` parameter is present, existing navigation script forces Upload section display (see `public/index.html` line 374). This means:
  - Report detail renders correctly in main content area
  - Sidebar shows "Upload Reports" as active (not "Reports")
  - This is existing behavior, not a bug - report viewing is considered part of the upload workflow
  - Users should view reports in new tabs, keep original Reports Browser tab open for navigation

**5. Original File View (existing)**
- Opens in new tab via `/api/reports/:id/original-file`
- Browser displays PDF or image natively

### Wireframe

```
┌─────────────────────────────────────────────────────────────────────────┐
│ HealthUp                                                                │
├──────────┬──────────────────────────────────────────────────────────────┤
│ MAIN     │  Reports                                                     │
│          │  ─────────────────────────────────────────────────────────── │
│ 📤 Upload│                                                              │
│ 💬 Health│  Filters:                                                    │
│ 📄 Report│  ┌──────────────┐ ┌──────────────┐ ┌─────────────┐ ┌───────┐│
│          │  │ From Date    │ │ To Date      │ │ Patient ▼   │ │ Clear ││
│ MANAGE   │  └──────────────┘ └──────────────┘ └─────────────┘ └───────┘│
│ 📋 Review│                                                              │
│          │  ┌────────────┬─────────────────┬───────────────────────────┐│
│          │  │ Date       │ Patient         │ Actions                   ││
│          │  ├────────────┼─────────────────┼───────────────────────────┤│
│          │  │ 2025-12-10 │ John Doe        │ [View Data] [View Original││
│          │  │ 2025-12-08 │ Jane Smith      │ [View Data] [View Original││
│          │  │ 2025-12-05 │ John Doe        │ [View Data] [View Original││
│          │  │ 2025-12-01 │ Jane Smith      │ [View Data] [View Original││
│          │  └────────────┴─────────────────┴───────────────────────────┘│
│          │                                                              │
│          │  Showing 4 reports                                           │
└──────────┴──────────────────────────────────────────────────────────────┘
```

---

## Technical Implementation

### 1. New API Endpoint: List All Reports

**File:** `server/routes/reports.js`

**⚠️ CRITICAL: Route Ordering Requirement**

These new routes MUST be defined **BEFORE** the existing `GET /reports/:reportId` route (currently at line ~89).

**Why:** Express matches routes in definition order. If defined after the parameterized route, Express will treat "reports" and "patients" as UUID values for `:reportId`, causing 400 Bad Request errors before the correct handlers are reached.

**Correct order:**
```javascript
router.get('/reports', ...);              // NEW - must come first
router.get('/reports/patients', ...);     // NEW - must come second
router.get('/reports/:reportId', ...);    // EXISTING - must come after
```

See CLAUDE.md "Route Organization" section for more details on Express route ordering.

---

**Helper Functions**

Add timestamp normalization helper at top of file (matches existing service layer pattern):

```javascript
// Timestamp normalization helper (matches reportRetrieval.js pattern)
const toIsoString = (value) => {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
};
```

---

Add new endpoint to list all reports (uses existing `pool` import):

```javascript
// GET /api/reports
// Query params: ?fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD&patientId=uuid
router.get('/reports', async (req, res) => {
  const { fromDate, toDate, patientId } = req.query;

  // Validate date parameters (must be valid ISO format YYYY-MM-DD)
  // Regex validates: YYYY (any 4 digits), MM (01-12), DD (01-31)
  // Note: Still allows invalid combinations like 2025-02-31, but prevents
  // obvious malformed dates that would crash PostgreSQL date casting
  const ISO_DATE_REGEX = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
  if (fromDate && !ISO_DATE_REGEX.test(fromDate)) {
    return res.status(400).json({ error: 'fromDate must be valid YYYY-MM-DD format' });
  }
  if (toDate && !ISO_DATE_REGEX.test(toDate)) {
    return res.status(400).json({ error: 'toDate must be valid YYYY-MM-DD format' });
  }

  // Note: No validation for fromDate > toDate
  // If user enters inverted range (e.g., from=2025-12-01, to=2025-01-01),
  // the SQL query will return empty results (no reports match both conditions).
  // This is mathematically correct behavior - there are no dates that are both
  // >= 2025-12-01 AND <= 2025-01-01.
  // Post-MVP: Could add UI warning or auto-swap dates for better UX.

  // Validate patientId is valid UUID if provided (reuse existing isUuid helper)
  if (patientId && !isUuid(patientId)) {
    return res.status(400).json({ error: 'patientId must be valid UUID' });
  }

  try {
    let query = `
      SELECT
        pr.id AS report_id,
        pr.test_date_text,
        pr.recognized_at,
        p.id AS patient_id,
        COALESCE(pr.patient_name_snapshot, p.full_name, 'Unnamed Patient') AS patient_name,
        (pr.file_path IS NOT NULL) AS has_file
      FROM patient_reports pr
      JOIN patients p ON pr.patient_id = p.id
      WHERE pr.status = 'completed'
    `;

    const params = [];
    let paramIndex = 1;

    // Filter on effective_date: test_date_text if valid ISO, else recognized_at
    // This ensures reports with missing/invalid test_date_text still appear
    // when filtering by date range (using their upload date as fallback).
    //
    // NOTE: We prefer test_date_text because recognized_at is useless for
    // filtering - bulk Gmail imports give all reports the same timestamp.
    //
    // Regex validates format AND basic range validity (MM: 01-12, DD: 01-31)
    // to prevent PostgreSQL date casting errors from malformed OCR dates.

    if (fromDate) {
      query += `
        AND CASE
          WHEN pr.test_date_text ~ '^(\\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
          THEN pr.test_date_text
          ELSE to_char(pr.recognized_at, 'YYYY-MM-DD')
        END >= $${paramIndex}`;
      params.push(fromDate);
      paramIndex++;
    }

    if (toDate) {
      query += `
        AND CASE
          WHEN pr.test_date_text ~ '^(\\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
          THEN pr.test_date_text
          ELSE to_char(pr.recognized_at, 'YYYY-MM-DD')
        END <= $${paramIndex}`;
      params.push(toDate);
      paramIndex++;
    }

    if (patientId) {
      query += ` AND pr.patient_id = $${paramIndex}`;
      params.push(patientId);
      paramIndex++;
    }

    // Sort by effective date (test_date_text if valid ISO, else recognized_at)
    // Add tiebreakers for stable ordering when multiple reports have same date
    // Sort as TEXT instead of casting to DATE to prevent crashes on invalid dates
    // ISO 8601 dates (YYYY-MM-DD) sort correctly lexicographically
    query += `
      ORDER BY
        CASE
          WHEN pr.test_date_text ~ '^(\\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
          THEN pr.test_date_text
          ELSE to_char(pr.recognized_at, 'YYYY-MM-DD')
        END DESC,
        pr.recognized_at DESC,
        pr.id DESC
    `;

    const result = await pool.query(query, params);

    // Normalize timestamps to ISO strings (matches existing service layer pattern)
    const normalizedReports = result.rows.map(row => ({
      ...row,
      recognized_at: toIsoString(row.recognized_at)
    }));

    res.json({
      reports: normalizedReports,
      total: normalizedReports.length
    });
  } catch (error) {
    console.error('[reports] Failed to list reports:', error);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});
```

**Implementation Note:** This endpoint uses inline SQL rather than the service layer pattern (see `reportRetrieval.js`). This is acceptable because:
- The query is simple (single SELECT with optional filters)
- Service layer functions handle complex pagination and multi-query operations
- Avoiding premature abstraction for straightforward list operations
- See CLAUDE.md: "Service layer pattern (existing in codebase but not required for this MVP)"

**Data consistency:**
- Uses `patient_name_snapshot` (preserves historical patient names at report time)
- Uses `toIsoString()` helper for timestamp normalization (matches existing API patterns)
- Both align with existing `getReportDetail()` service function

**Status filtering:**
- Only returns reports with `status = 'completed'` (successfully processed)
- Excludes `pending` (queued for processing), `processing` (currently being OCR'd), `failed` (OCR errors)
- Rationale: Users only need to see successfully processed reports with extracted data
- Failed reports should be investigated via admin tools, not shown in user-facing browser

**Response Schema:**

Success (200 OK):
```json
{
  "reports": [
    {
      "report_id": "550e8400-e29b-41d4-a716-446655440000",
      "test_date_text": "2025-01-15",
      "recognized_at": "2025-01-16T08:30:00.000Z",
      "patient_id": "660e8400-e29b-41d4-a716-446655440001",
      "patient_name": "John Doe",
      "has_file": true
    },
    {
      "report_id": "770e8400-e29b-41d4-a716-446655440002",
      "test_date_text": null,
      "recognized_at": "2025-01-10T14:22:00.000Z",
      "patient_id": "660e8400-e29b-41d4-a716-446655440001",
      "patient_name": "John Doe",
      "has_file": false
    }
  ],
  "total": 2
}
```

Field types:
- `report_id`: UUID string
- `test_date_text`: String (YYYY-MM-DD format) or null
- `recognized_at`: ISO 8601 timestamp string
- `patient_id`: UUID string
- `patient_name`: String (never null, uses "Unnamed Patient" fallback)
- `has_file`: Boolean

Error responses:
- 400 Bad Request: `{"error": "fromDate must be valid YYYY-MM-DD format"}`
- 400 Bad Request: `{"error": "toDate must be valid YYYY-MM-DD format"}`
- 400 Bad Request: `{"error": "patientId must be valid UUID"}`
- 500 Internal Server Error: `{"error": "Failed to fetch reports"}`

**Date range validation:**
- API validates format only (YYYY-MM-DD with valid month/day ranges)
- No cross-field validation (fromDate vs toDate comparison)
- If `fromDate > toDate` (inverted range), query returns empty results
  - Example: `fromDate=2025-12-01&toDate=2025-01-01` → `{"reports": [], "total": 0}`
  - This is mathematically correct (no dates satisfy both conditions)
  - Not treated as an error - just returns no matches
- Post-MVP enhancement: UI could warn or auto-swap inverted dates for better UX

### 2. Patients List Endpoint

**File:** `server/routes/reports.js` (add to existing router)

Add endpoint to populate patient filter dropdown:

```javascript
// GET /api/reports/patients - List all patients for filter dropdown
router.get('/reports/patients', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, COALESCE(full_name, 'Unnamed Patient') AS full_name
      FROM patients
      ORDER BY full_name ASC
    `);

    res.json({ patients: result.rows });
  } catch (error) {
    console.error('[reports] Failed to list patients:', error);
    res.status(500).json({ error: 'Failed to fetch patients' });
  }
});
```

**Note:** Route is `/reports/patients` (not `/patients`) to avoid conflicts with future top-level patient management endpoints. Full path is `/api/reports/patients`.

**Response Schema:**

Success (200 OK):
```json
{
  "patients": [
    {
      "id": "660e8400-e29b-41d4-a716-446655440001",
      "full_name": "John Doe"
    },
    {
      "id": "770e8400-e29b-41d4-a716-446655440003",
      "full_name": "Jane Smith"
    },
    {
      "id": "880e8400-e29b-41d4-a716-446655440004",
      "full_name": "Unnamed Patient"
    }
  ]
}
```

Field types:
- `id`: UUID string
- `full_name`: String (never null, uses "Unnamed Patient" fallback)

Error responses:
- 500 Internal Server Error: `{"error": "Failed to fetch patients"}`

### 3. Sidebar Update

**File:** `public/index.html`

Add Reports menu item under Health Assistant:

```html
<nav class="sidebar-nav">
  <div class="nav-section">
    <div class="nav-section-title">Main</div>
    <a href="#upload" class="nav-item active" data-section="upload">
      <span class="nav-icon">📤</span>
      <span>Upload Reports</span>
    </a>
    <a href="#assistant" class="nav-item" data-section="assistant">
      <span class="nav-icon">💬</span>
      <span>Health Assistant</span>
    </a>
    <!-- NEW -->
    <a href="#reports" class="nav-item" data-section="reports">
      <span class="nav-icon">📄</span>
      <span>Reports</span>
    </a>
  </div>
  <!-- ... existing Management section ... -->
</nav>
```

### 4. Reports Section HTML

**File:** `public/index.html`

Add reports section in main content area (note: section ID follows existing `section-{name}` pattern):

```html
<!-- Reports Browser Section -->
<section id="section-reports" class="content-section" style="display: none;">
  <div class="reports-filters">
    <div class="filter-group">
      <label for="reports-from-date">From</label>
      <input type="date" id="reports-from-date">
    </div>
    <div class="filter-group">
      <label for="reports-to-date">To</label>
      <input type="date" id="reports-to-date">
    </div>
    <div class="filter-group">
      <label for="reports-patient-filter">Patient</label>
      <select id="reports-patient-filter">
        <option value="">All Patients</option>
      </select>
    </div>
    <button id="reports-clear-filters" class="btn btn-secondary">Clear</button>
  </div>

  <div class="table-wrapper">
    <table class="reports-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Patient</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody id="reports-table-body">
        <!-- Populated by JS -->
      </tbody>
    </table>
  </div>

  <div class="reports-summary">
    <span id="reports-count">0 reports</span>
  </div>
</section>
```

Also add the script tag for reports-browser.js:

```html
<!-- Our application scripts -->
<script src="js/plotRenderer.js"></script>
<script src="js/unified-upload.js"></script>
<script src="js/chat.js"></script>
<script src="js/reports-browser.js"></script>  <!-- NEW -->
<script src="js/app.js"></script>
```

### 5. Navigation Logic Update

**File:** `public/index.html` (inline script)

Extend existing `sectionTitles` map and `switchSection` logic:

```javascript
// Section titles - ADD 'reports' entry
const sectionTitles = {
  'upload': 'Upload Lab Reports',
  'assistant': 'Health Assistant',
  'reports': 'Reports'  // NEW
};

// In switchSection function, add Reports Browser initialization:
function switchSection(sectionId) {
  // ... existing logic ...

  // Initialize Reports Browser on first view
  if (sectionId === 'reports' && typeof ReportsBrowser !== 'undefined' && !ReportsBrowser.initialized) {
    ReportsBrowser.init();
    ReportsBrowser.initialized = true;
  }
}
```

### 6. Reports Browser JavaScript

**File:** `public/js/reports-browser.js` (new file)

```javascript
// Reports Browser Module
const ReportsBrowser = {
  initialized: false,

  async init() {
    this.bindEvents();
    await this.loadPatients();
    await this.loadReports();
  },

  bindEvents() {
    document.getElementById('reports-from-date').addEventListener('change', () => this.loadReports());
    document.getElementById('reports-to-date').addEventListener('change', () => this.loadReports());
    document.getElementById('reports-patient-filter').addEventListener('change', () => this.loadReports());
    document.getElementById('reports-clear-filters').addEventListener('click', () => this.clearFilters());
  },

  async loadPatients() {
    try {
      const response = await fetch('/api/reports/patients');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();

      const select = document.getElementById('reports-patient-filter');
      data.patients.forEach(patient => {
        const option = document.createElement('option');
        option.value = patient.id;
        option.textContent = patient.full_name || 'Unnamed Patient';
        select.appendChild(option);
      });
    } catch (error) {
      console.error('Failed to load patients:', error);
      // Show error to user
      const select = document.getElementById('reports-patient-filter');
      const errorOption = document.createElement('option');
      errorOption.textContent = 'Error loading patients';
      errorOption.disabled = true;
      select.appendChild(errorOption);
    }
  },

  async loadReports() {
    const fromDate = document.getElementById('reports-from-date').value;
    const toDate = document.getElementById('reports-to-date').value;
    const patientId = document.getElementById('reports-patient-filter').value;

    const params = new URLSearchParams();
    if (fromDate) params.append('fromDate', fromDate);
    if (toDate) params.append('toDate', toDate);
    if (patientId) params.append('patientId', patientId);

    try {
      const response = await fetch(`/api/reports?${params}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();

      this.renderReports(data.reports);
      document.getElementById('reports-count').textContent = `${data.total} reports`;
    } catch (error) {
      console.error('Failed to load reports:', error);
      // Show error to user
      this.renderError('Failed to load reports. Please try again.');
    }
  },

  renderError(message) {
    const tbody = document.getElementById('reports-table-body');
    tbody.innerHTML = '';

    const errorRow = document.createElement('tr');
    const errorCell = document.createElement('td');
    errorCell.colSpan = 3;
    errorCell.className = 'empty-state error-state';
    errorCell.textContent = message;
    errorRow.appendChild(errorCell);
    tbody.appendChild(errorRow);

    document.getElementById('reports-count').textContent = '0 reports';
  },

  renderReports(reports) {
    const tbody = document.getElementById('reports-table-body');
    tbody.innerHTML = '';

    if (reports.length === 0) {
      const emptyRow = document.createElement('tr');
      const emptyCell = document.createElement('td');
      emptyCell.colSpan = 3;
      emptyCell.className = 'empty-state';
      emptyCell.textContent = 'No reports found';
      emptyRow.appendChild(emptyCell);
      tbody.appendChild(emptyRow);
      return;
    }

    reports.forEach(report => {
      const row = document.createElement('tr');

      // Date cell - use same logic as backend (ISO format and range validation)
      const dateCell = document.createElement('td');
      // Match backend regex: validates YYYY-MM-DD with MM:01-12, DD:01-31
      const ISO_DATE_REGEX = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
      let displayDate;
      if (report.test_date_text && ISO_DATE_REGEX.test(report.test_date_text)) {
        displayDate = report.test_date_text;
      } else {
        // Use ISO format (YYYY-MM-DD) to match filter inputs
        displayDate = new Date(report.recognized_at).toISOString().split('T')[0];
      }
      dateCell.textContent = displayDate;
      row.appendChild(dateCell);

      // Patient name cell (use textContent to prevent XSS)
      const patientCell = document.createElement('td');
      patientCell.textContent = report.patient_name || 'Unnamed Patient';
      patientCell.title = report.patient_name || 'Unnamed Patient'; // Tooltip for long names
      row.appendChild(patientCell);

      // Actions cell
      const actionsCell = document.createElement('td');
      actionsCell.className = 'actions-cell';

      // View Data button
      const viewDataBtn = document.createElement('button');
      viewDataBtn.className = 'btn-small btn-primary';
      viewDataBtn.textContent = 'View Data';
      viewDataBtn.addEventListener('click', () => this.viewData(report.report_id));
      actionsCell.appendChild(viewDataBtn);

      // View Original button
      const viewOriginalBtn = document.createElement('button');
      viewOriginalBtn.className = 'btn-small btn-secondary';
      viewOriginalBtn.textContent = 'View Original';
      if (report.has_file) {
        viewOriginalBtn.addEventListener('click', () => this.viewOriginal(report.report_id));
      } else {
        viewOriginalBtn.disabled = true;
        viewOriginalBtn.title = 'Original file not available';
      }
      actionsCell.appendChild(viewOriginalBtn);

      row.appendChild(actionsCell);
      tbody.appendChild(row);
    });
  },

  viewData(reportId) {
    // Open in new tab - reuses existing report view
    window.open(`/?reportId=${reportId}`, '_blank');
  },

  viewOriginal(reportId) {
    // Open original file in new tab
    window.open(`/api/reports/${reportId}/original-file`, '_blank');
  },

  clearFilters() {
    document.getElementById('reports-from-date').value = '';
    document.getElementById('reports-to-date').value = '';
    document.getElementById('reports-patient-filter').value = '';
    this.loadReports();
  }
};
```

### 7. CSS Styles

**File:** `public/css/style.css`

Add styles for reports browser (using correct design system tokens):

```css
/* Reports Browser */
.reports-filters {
  display: flex;
  gap: 1rem;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
  align-items: flex-end;
}

.reports-filters .filter-group {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.reports-filters label {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.reports-filters input[type="date"],
.reports-filters select {
  padding: 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  min-width: 150px;
  font-family: var(--font-body);
  font-size: var(--text-sm);
  background: var(--color-surface-elevated);
  color: var(--color-text);
}

.reports-filters input[type="date"]:focus,
.reports-filters select:focus {
  outline: none;
  border-color: var(--color-accent);
}

.reports-table {
  width: 100%;
  border-collapse: collapse;
}

.reports-table th,
.reports-table td {
  padding: 0.75rem 1rem;
  text-align: left;
  border-bottom: 1px solid var(--color-border-light);
}

.reports-table th {
  background: var(--color-slate-50);
  font-weight: 600;
  color: var(--color-text-secondary);
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.reports-table tbody tr:hover {
  background: var(--color-slate-50);
}

.reports-table .actions-cell {
  display: flex;
  gap: 0.5rem;
}

.reports-table .empty-state {
  text-align: center;
  padding: 2rem;
  color: var(--color-text-muted);
}

.reports-table .error-state {
  color: var(--color-error);
}

.reports-table td {
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reports-summary {
  margin-top: 1rem;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.btn-small {
  padding: 0.375rem 0.75rem;
  font-size: var(--text-sm);
  border-radius: var(--radius-sm);
  cursor: pointer;
  border: none;
  font-family: var(--font-body);
  transition: background-color 0.15s ease;
}

.btn-small.btn-primary {
  background: var(--color-accent);
  color: white;
}

.btn-small.btn-primary:hover {
  background: var(--color-accent-hover);
}

.btn-small.btn-secondary {
  background: var(--color-slate-100);
  color: var(--color-text);
  border: 1px solid var(--color-border);
}

.btn-small.btn-secondary:hover {
  background: var(--color-slate-200);
}

.btn-small:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

---

## Performance Considerations

**Query scalability:**

The reports list query uses CASE expressions with regex validation on every row and returns all results without pagination. This is acceptable for MVP with expected dataset size (<100 reports for personal use), but has scalability limitations:

- **No index usage**: Regex and CASE expressions prevent index-based filtering
- **Full table scans**: Date range filters require regex evaluation on every patient_reports row
- **Linear growth**: Query time grows linearly with report count (O(n))
- **Memory**: All rows loaded into memory on both server and client

**Why regex validation is used:**
- `test_date_text` is TEXT column with OCR-extracted values (not guaranteed valid dates)
- Regex `^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$` validates:
  - Format: YYYY-MM-DD structure
  - Month range: 01-12 (prevents "2025-19-40" type garbage)
  - Day range: 01-31 (prevents "2025-01-99" type garbage)
  - Allows edge cases like "2025-02-31" (impossible date but valid format)
- Used for filtering/sorting logic, not for casting to DATE type
- Alternative would be separate boolean column or computed column (not worth complexity for MVP)

**Why TEXT sorting instead of DATE casting:**
- ISO 8601 dates (YYYY-MM-DD) are lexicographically sortable
- Alphabetical order = Chronological order for valid ISO dates
- Eliminates crash risk from invalid dates (no PostgreSQL type casting errors)
- Simpler and more defensive than complex date validation

**Future optimization options (post-MVP):**
1. **Pagination**: Add LIMIT/OFFSET with cursor-based pagination
2. **Computed column**: Add `effective_date DATE GENERATED ALWAYS AS (...) STORED` with index
3. **Materialized view**: Create indexed view with pre-computed effective dates
4. **Frontend optimization**: Virtual scrolling or infinite scroll for large result sets

**Estimated performance:**
- 10 reports: <50ms (negligible overhead)
- 100 reports: <200ms (acceptable for interactive UI)
- 500+ reports: Consider pagination and indexing
- 1000+ reports: Pagination becomes critical

---

## Known Limitations

### 1. Timezone Handling (Functional Bug for Fallback Dates)

**Impact:** Date filtering and display may be inconsistent for reports without valid `test_date_text`.

**Root cause:**
- Backend fallback uses server timezone: `to_char(recognized_at, 'YYYY-MM-DD')`
- Frontend fallback uses client UTC: `toISOString().split('T')[0]`
- Timezone mismatch persists if server is not in UTC timezone

**Example scenario (server in PST timezone):**
```
Server timezone: PST (UTC-8)
Client timezone: Doesn't matter (uses UTC via toISOString)
Report uploaded: 2025-01-01 08:30:00 UTC (= 2025-01-01 00:30:00 PST)

Backend filter uses: "2025-01-01" (server PST timezone via to_char)
Frontend displays:   "2025-01-01" (client UTC via toISOString)

Both show same date, filter works correctly.
```

**Example scenario (server in UTC, uploaded near midnight PST):**
```
Server timezone: UTC
Report uploaded: 2025-01-01 07:30:00 UTC (= 2024-12-31 23:30:00 PST)

Backend filter uses: "2025-01-01" (UTC)
Frontend displays:   "2025-01-01" (UTC)

User in PST mentally expects "Dec 31" but sees "Jan 1" - confusing but consistent.
```

**Note:** Frontend uses `toISOString().split('T')[0]` (client UTC), server uses `to_char(recognized_at, 'YYYY-MM-DD')` (server TZ). Mismatch only occurs when server timezone ≠ UTC.

**Severity:**
- **Only when server TZ ≠ UTC**: No issue if server runs in UTC timezone
- **Only affects fallback path**: Reports with valid `test_date_text` (99% of cases) unaffected
- **Display consistency**: Both backend and frontend use same date (but may not match user's mental timezone)
- **Filter mismatch**: Reports uploaded near midnight can appear in unexpected date when server TZ ≠ UTC

**Mitigation for MVP:**
- Single-user personal health app - user typically in same TZ as their own server
- Affects only reports where OCR failed to extract date (edge case)
- User can verify actual date by viewing original file

**Future fix options:**
- Option A: Return `effective_date` (ISO UTC string) and `effective_date_source` ("test_date_text" | "recognized_at") from API
  - Eliminates frontend regex duplication
  - Single source of truth for display and filtering
  - Recommended post-MVP enhancement
- Option B: Convert `recognized_at AT TIME ZONE 'UTC'` on backend (normalize server to UTC)
- Option C: Run server in UTC timezone (eliminates mismatch entirely)

### 2. Impossible Dates Treated as Valid

**Impact:** Dates like "2025-02-31" (Feb 31st doesn't exist) may sort/filter incorrectly.

**Root cause:**
- Regex validates format and basic ranges (MM:01-12, DD:01-31) but not calendar validity
- SQL treats these as valid TEXT strings without fallback to `recognized_at`

**Example:**
- OCR extracts "2025-02-31" (impossible - Feb has max 29 days)
- Regex passes (format correct: year-month-day, month in 01-12, day in 01-31)
- Sorting: "2025-02-31" sorts after "2025-02-28" alphabetically (incorrect chronologically)
- No error thrown, no fallback - just slightly wrong ordering

**Severity:**
- Extremely rare (LLM must hallucinate impossible date in correct format)
- Only affects sorting/filtering, doesn't crash query
- Original file always available for verification

**Mitigation for MVP:**
- Acceptable for personal use with <100 reports
- LLM prompt instructs ISO format with valid dates
- In practice, OCR errors are usually format errors ("March 15") not impossible dates

**Future fix:**
- Add PostgreSQL date validity function if this becomes a problem
- Or return `effective_date` from API (see Limitation #1, Option A) which could include proper date validation

---

## Date Filtering Design Rationale

**Why we prefer `test_date_text` over `recognized_at`:**

The `recognized_at` timestamp records when the report was uploaded and processed by OCR. This is **useless as a primary filter** because:

1. **Bulk imports**: When importing lab reports from Gmail, dozens or hundreds of reports get processed in a single session. All reports receive the same `recognized_at` timestamp, even though the actual tests span months or years.

2. **Clinical relevance**: Users care about *when the test was performed*, not when they happened to upload it. A blood test from January 2024 should appear in a January 2024 filter, regardless of when it was imported.

The `test_date_text` column contains the actual test date extracted by OCR from the lab report document. This is the clinically meaningful date.

**Fallback behavior:**

Reports where OCR failed to extract a valid date (`test_date_text` is NULL or non-ISO format) use `recognized_at` as fallback for both filtering and sorting. This ensures:
- Reports with missing dates still appear in results
- Date range filters don't silently exclude reports
- All reports have a deterministic sort order

**Safety considerations:**

- `test_date_text` is a TEXT column with OCR-extracted values
- The OCR prompt instructs the LLM to output ISO format (YYYY-MM-DD)
- **Sorting strategy**: Sort directly on TEXT column without casting to DATE
  - ISO 8601 dates (YYYY-MM-DD) are lexicographically sortable (alphabetical order = chronological order)
  - Eliminates PostgreSQL crash risk (no date type casting errors)
  - Example: "2025-01-15" < "2025-02-01" < "2025-12-31" (works correctly as text)
- **Filtering strategy**: Regex validation (`^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$`) validates basic validity:
  - Ensures month is 01-12 (prevents "2025-19-40" malformed dates)
  - Ensures day is 01-31 (prevents "2025-01-99" malformed dates)
  - **Does NOT validate calendar logic**: Allows impossible dates like "2025-02-31" (Feb 31st)
  - Malformed dates (fail regex) fall back to recognized_at
  - Impossible dates (pass regex) are used as-is, may sort/filter slightly wrong
- Users can always view the original file to verify dates
- See "Known Limitations" section for details on timezone handling and impossible dates

---

## Edge Cases

### 1. No Reports Exist

**Scenario:** User opens Reports section with no processed reports.

**Behavior:**
- Table shows empty state: "No reports found"
- Count shows: "0 reports"
- Filters remain functional

### 2. Report Without Original File

**Scenario:** Legacy report processed before file storage (PRD v3.4) was implemented.

**Behavior:**
- `has_file` boolean is false (derived from `pr.file_path IS NOT NULL`)
- "View Data" works normally
- "View Original" button disabled with tooltip: "Original file not available"
- **Existing API behavior**: `/api/reports/:reportId/original-file` already returns 410 Gone with JSON error response when `file_path` is NULL (see reports.js:138-145)

**Implementation notes:**
- No new error handling needed - existing endpoint already handles missing files
- Frontend only needs to disable button based on `has_file` boolean
- Existing API structure: `{error: 'Original file not available', reason: 'report_predates_file_storage', report_id, recognized_at}`

### 3. Patient Deleted

**Scenario:** Patient record deleted but reports remain (if cascade not set).

**Behavior:**
- Current schema uses `ON DELETE CASCADE`, so reports are deleted with patient
- No orphan reports possible

### 4. Filter Returns No Results

**Scenario:** User sets filters that match no reports.

**Behavior:**
- Table shows: "No reports found"
- Count shows: "0 reports"
- "Clear" button remains active

### 5. Very Long Patient Names

**Scenario:** Patient name exceeds typical column width (e.g., "Dr. Alexander Maximilian Schneider-Wellington III").

**Behavior:**
- CSS truncates with `text-overflow: ellipsis` at 300px max-width
- Full name visible on hover via `title` attribute
- Table cell uses `white-space: nowrap` to prevent wrapping

### 5a. Null/Empty Patient Names

**Scenario:** Patient record has NULL or empty `full_name`, or report has NULL `patient_name_snapshot`.

**Behavior:**
- **Reports list** (`/api/reports`): Returns "Unnamed Patient" via `COALESCE(pr.patient_name_snapshot, p.full_name, 'Unnamed Patient')`
  - Prefers historical snapshot (preserves name at report time)
  - Falls back to current patient name
  - Falls back to "Unnamed Patient" if both NULL
- **Patients dropdown** (`/api/reports/patients`): Returns "Unnamed Patient" via `COALESCE(p.full_name, 'Unnamed Patient')`
  - Shows current patient names for filtering
  - No snapshot needed (users filter by names they know today)
- Frontend also has fallback `|| 'Unnamed Patient'` for defensive coding
- All displays consistently show "Unnamed Patient" for NULL names

**Why use patient_name_snapshot?**
- Preserves historical accuracy - if a patient is renamed, old reports show the name as it was at report time
- Matches pattern used in `getReportDetail()` service function (reportRetrieval.js:240)
- Example: Patient "John Doe" renamed to "John Smith" → old reports still show "John Doe"

### 6. Non-ISO or Invalid Date Format in test_date_text

**Scenario 1: Malformed dates (fail regex)**
Examples: "March 15, 2024", "2025-19-40", "2025-01-99"

**Behavior:**
- Regex validation fails (month not 01-12 or day not 01-31)
- Falls back to `recognized_at` for filtering and sorting
- Frontend display also uses `recognized_at` (formatted as ISO date YYYY-MM-DD to match filter inputs)
- Report still appears in results (not silently excluded)
- Original file always available for manual verification

**Scenario 2: Impossible dates (pass regex but don't exist)**
Examples: "2025-02-31" (Feb has 28/29 days), "2025-04-31" (April has 30 days)

**Behavior:**
- Regex validation passes (format is correct: YYYY-MM-DD, month 01-12, day 01-31)
- **No fallback occurs** - the impossible date is used as-is
- Sorting: Treated as TEXT, may sort incorrectly (e.g., "2025-02-31" sorts after "2025-02-28")
- Filtering: String comparison, may include/exclude incorrectly
- **No PostgreSQL crash**: Never cast to DATE type, so no error thrown
- **Limitation**: These dates are treated as valid strings, not corrected

**Why no fallback for impossible dates:**
- Detecting calendar validity (leap years, days per month) requires complex logic or PostgreSQL casting
- Casting would reintroduce crash risk we eliminated with TEXT sorting
- These are extremely rare OCR errors (LLM must hallucinate impossible date in correct format)
- Acceptable for MVP - original file always available for verification
- Post-MVP: Could add PostgreSQL date validity function if this becomes a problem

### 7. API Fetch Failures

**Scenario:** Network error or server error when loading reports or patients list.

**Behavior:**
- Reports list: Shows error message "Failed to load reports. Please try again." in red
- Patients dropdown: Shows disabled option "Error loading patients"
- Errors logged to console for debugging
- User can retry by refreshing or changing filters

---

## Testing Strategy

### Automated Testing (Optional)

While this PRD focuses on manual QA, consider adding lightweight API integration tests:

**Recommended test coverage:**
- `/api/reports` filter combinations (fromDate, toDate, patientId)
- Edge cases: missing files, null names, invalid dates
- Route ordering verification (routes don't get shadowed)
- Status filtering (only 'completed' reports returned)

These can be implemented as Jest integration tests or simple curl scripts, at engineering team's discretion.

### Manual Testing Checklist

**Route Ordering:**
- [ ] New routes defined BEFORE `GET /reports/:reportId` in reports.js
- [ ] `GET /api/reports` returns reports list (not 400 Bad Request)
- [ ] `GET /api/reports/patients` returns patients list (not 400 Bad Request)
- [ ] Existing `GET /api/reports/:reportId` still works correctly

**Navigation:**
- [ ] "Reports" menu item appears under "Health Assistant"
- [ ] Clicking "Reports" shows reports section
- [ ] Section switching hides other sections correctly
- [ ] Active state on nav item updates correctly
- [ ] Direct navigation via `#reports` hash works
- [ ] Page refresh on `#reports` loads reports section

**Reports List:**
- [ ] All reports display in table
- [ ] Reports sorted by date (most recent first)
- [ ] Date column shows test date (or recognized date if missing)
- [ ] Patient name displays correctly
- [ ] Report count accurate

**Filters:**
- [ ] Date "From" filter works
- [ ] Date "To" filter works
- [ ] Date range filter works (both From and To)
- [ ] Patient dropdown populates with all patients
- [ ] Patient filter works
- [ ] Combining date and patient filters works
- [ ] "Clear" button resets all filters

**Actions:**
- [ ] "View Data" opens report in new tab
- [ ] New tab shows extracted lab results correctly
- [ ] New tab shows "Upload Reports" as active in sidebar (expected behavior with reportId param)
- [ ] Original Reports Browser tab remains navigable
- [ ] "View Original" opens original file in new tab
- [ ] PDF files display in browser
- [ ] Image files display in browser
- [ ] Disabled state for missing original files

**Edge Cases:**
- [ ] Empty state when no reports
- [ ] Empty state when filters match nothing
- [ ] Legacy reports without files handled gracefully
- [ ] Long patient names truncate with ellipsis and show full name on hover
- [ ] Null/empty patient names display as "Unnamed Patient"
- [ ] Reports with missing test_date_text appear in filtered results (using recognized_at fallback)
- [ ] Non-ISO test_date_text displays recognized_at fallback (consistent with backend logic)

**Error Handling:**
- [ ] Network failure shows error message in table
- [ ] API error shows error message in table
- [ ] Patient dropdown shows error option on load failure

**Security:**
- [ ] XSS attempt in patient name is escaped (displays as text, not executed)

---

## Rollout Plan

### Phase 1: Backend
1. **Add helper function to `server/routes/reports.js`** - Add `toIsoString()` helper at top of file (after imports)
2. **Add new routes to `server/routes/reports.js`** - CRITICAL: Insert BEFORE existing `GET /reports/:reportId` route (line ~89)
   - First: `GET /reports` (list all reports with filters, uses patient_name_snapshot and timestamp normalization)
   - Second: `GET /reports/patients` (patient dropdown)
   - Verify route order: specific routes before parameterized routes
3. Test endpoints manually:
   - `GET /api/reports` → should return reports list with normalized timestamps
   - `GET /api/reports/patients` → should return patients list
   - `GET /api/reports/:reportId` → should still work (not broken by new routes)
   - Verify patient names show historical snapshot, not current name (test with renamed patient)

### Phase 2: Frontend
1. Add sidebar menu item
2. Add reports section HTML with correct `section-reports` ID
3. Add `<script src="js/reports-browser.js">` tag
4. Create `reports-browser.js` module
5. Extend `sectionTitles` map with `'reports': 'Reports'`
6. Add Reports Browser init to `switchSection`
7. Add CSS styles

### Phase 3: Testing
1. Manual testing per checklist
2. Test with various report counts (0, 1, 10, 100)
3. Test filter combinations
4. Cross-browser testing (Chrome, Firefox, Safari)

---

## File Changes Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `server/routes/reports.js` | Modify | Add `toIsoString()` helper, `GET /api/reports`, and `GET /api/reports/patients` endpoints |
| `public/index.html` | Modify | Add sidebar item, reports section HTML, script tag, extend sectionTitles |
| `public/js/reports-browser.js` | New | Reports browser module (XSS-safe rendering) |
| `public/css/style.css` | Modify | Add reports browser styles (using design system tokens) |

**Estimated LOC:** ~250-300 lines added

---

## Success Metrics

1. **Accessibility**: Users can view any past report without re-uploading
2. **Filter accuracy**: Filters return correct subset of reports based on test date
3. **View success rate**: 100% of reports with files can view original
4. **Performance**: Reports list loads in <1 second for up to 100 reports
5. **Security**: No XSS vulnerabilities from user-controlled data
