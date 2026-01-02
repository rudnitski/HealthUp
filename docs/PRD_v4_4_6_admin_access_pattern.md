# PRD v4.4.6: Admin Access Pattern (Read-All Patients)

**Status:** Ready for Implementation  
**Created:** 2026-01-02  
**Author:** System (Codex)  
**Target Release:** v4.4.6  
**Depends On:** v4.4.2 Auth Core Backend, v4.4.4 Frontend Auth UI

---

## 1. Overview

### Purpose

Introduce a clear, industry-standard admin access boundary that allows an approved admin to view **all patients** in the UI while keeping RLS strictly enforced for non-admin users.

### Why This Pattern

- **Security boundary:** `/api/*` remains RLS-enforced; `/api/admin/*` explicitly bypasses RLS.
- **Auditability:** admin actions (read/write) are easy to log and review.
- **Maintainability:** admin code is isolated and harder to misuse accidentally.
- **Scalability:** future write actions can be added to the admin surface without touching user endpoints.

---

## 2. Goals

1. Admin users can view all patients in the standard UI (no extra fields).
2. Regular users continue to see only their own patients (RLS enforced).
3. Admin endpoints require explicit authentication and admin authorization.
4. Admin read access audit logging is deferred from MVP.

## 3. Non-Goals

- Admin role management UI.
- Multi-role permission system.
- Tenant-level scoping beyond current RLS model.

---

## 4. Access Model

**MVP Implementation:**

- Admins are defined via `ADMIN_EMAIL_ALLOWLIST` in `.env`.
- Server computes `user.is_admin` and `user.admin_configured` in `/api/auth/me`.
- UI uses only `user.is_admin` to show admin controls.
- Admin-only UI links (e.g., Review Queue in Management) must be hidden for non-admin users.

---

## 5. API Design

### New Endpoint

**`GET /api/admin/patients`**

- **Auth:** `requireAuth` + `requireAdmin`
- **DB:** `queryAsAdmin()` (BYPASSRLS)
- **Returns:** Same fields as `/api/reports/patients` (no admin-only fields)
- **Supports:** `?sort=recent` with the **exact ordering rules** used by `/api/reports/patients` (including tie-breakers).
- **Default ordering** (when `?sort` is omitted): Alphabetical by `full_name ASC NULLS LAST, created_at DESC` (matches user endpoint default behavior from `server/routes/reports.js:214`).

**SQL Example (?sort=recent):**
```sql
SELECT
  p.id,
  p.full_name,
  CASE
    WHEN p.full_name IS NOT NULL AND p.full_name != '' THEN p.full_name
    ELSE 'Patient (' || SUBSTRING(p.id::text FROM 1 FOR 6) || '...)'
  END AS display_name,
  p.last_seen_report_at
FROM patients p
ORDER BY p.last_seen_report_at DESC NULLS LAST,
         p.full_name ASC NULLS LAST,
         p.created_at DESC;
```
**Note**: The tie-breaker ordering (`full_name ASC NULLS LAST, created_at DESC`) ensures deterministic ordering when multiple patients have the same `last_seen_report_at` value (especially NULL).

**SQL Example (default, alphabetical):**
```sql
SELECT
  p.id,
  p.full_name,
  CASE
    WHEN p.full_name IS NOT NULL AND p.full_name != '' THEN p.full_name
    ELSE 'Patient (' || SUBSTRING(p.id::text FROM 1 FOR 6) || '...)'
  END AS display_name,
  p.last_seen_report_at
FROM patients p
ORDER BY p.full_name ASC NULLS LAST,
         p.created_at DESC;
```

**MVP Scope:**
- Returns **all patients** (no pagination)
- Designed for datasets <1,000 patients
- Pagination deferred to future release if needed at scale

### Admin Read Endpoints (Required for MVP)

Admins must be able to access report data for any patient. Add admin read equivalents for report data:

- `GET /api/admin/reports` (equivalent to `/api/reports`)
- `GET /api/admin/reports/:reportId` (equivalent to `/api/reports/:reportId`)
- `GET /api/admin/patients/:patientId/reports` (equivalent to `/api/reports/patients/:patientId/reports`)
- `GET /api/admin/reports/:reportId/original-file` (equivalent to `/api/reports/:reportId/original-file`)

**File Download Parity Requirement:**
The admin original-file endpoint (`GET /api/admin/reports/:reportId/original-file`) MUST reuse the same file download logic as the user endpoint.

**CRITICAL - Refactor-Only Scope**: The current user endpoint (`GET /api/reports/:reportId/original-file` in `server/routes/reports.js`) ALREADY implements all required security measures:
1. UUID validation via `isUuid(reportId)` check
2. Filename sanitization via `buildContentDispositionHeader()`
3. PHI protection headers: Cache-Control, Pragma, Expires
4. MIME type handling from database with fallback
5. Error handling for missing files with specific reason codes

This is a **refactoring task**, NOT a new security feature. Extract EXISTING logic into `server/services/fileDownload.js` helper that accepts execution mode parameter (similar to report retrieval pattern in Section 5.1). This helper becomes the **single source of truth** for file download operations:
- Both user endpoint and admin endpoint MUST use this helper
- User endpoint should be refactored to use the helper to ensure parity is maintained
- Helper should accept `executionOptions` parameter with `mode` ('user' | 'admin') and optional `userId`
- All filename sanitization logic must exist only in this helper (via `buildContentDispositionHeader()`)
- All PHI protection headers (Cache-Control, Pragma, Expires) must be set only in this helper
- This prevents divergence in security-critical headers and filename handling

**No new validation requirements** - all security measures already exist and must be preserved during refactoring.

These admin endpoints must use `requireAuth` + `requireAdmin` and `queryAsAdmin()`/`adminPool`.
To avoid code duplication and ensure parity, report retrieval helpers must support both modes:
1) **User mode** uses `withUserTransaction()` (RLS enforced).
2) **Admin mode** uses `adminPool` / `queryAsAdmin()` (BYPASSRLS).

**Status Filtering (MVP):**
Admin report endpoints MUST match current user endpoint behavior:

1. **List endpoints** (`GET /api/admin/reports`):
   - MUST filter `WHERE pr.status = 'completed'`
   - Matches current user endpoint at `server/routes/reports.js:155`

2. **Patient-scoped endpoints** (`GET /api/admin/patients/:patientId/reports`):
   - MUST NOT filter by status (returns all reports regardless of status)
   - Matches current `getPatientReports()` behavior in `server/services/reportRetrieval.js:41-89`
   - This difference is intentional: list views show only completed reports, patient detail views show all reports

**CRITICAL**: This is a behavior difference between endpoints, NOT an ambiguity. Changing either filter requires updating both user and admin endpoints together to maintain consistency.

**Shared Retrieval Helper Contract** (see Section 5.1):
The existing helpers in `server/services/reportRetrieval.js` (`getPatientReports`, `getReportDetail`) currently hardcode `withUserTransaction()` and must be refactored to support both user and admin modes while maintaining identical SQL and response shaping logic.

**`GET /api/admin/reports` parity requirements:**
- Must support `?fromDate`, `?toDate`, `?patientId` with the same validation rules.
- Must return the same response shape and fields as `/api/reports`, including `effective_date`, `has_file`, and `total`.
- **CRITICAL - Shared Date Expression**: The `effectiveDateExpr` SQL expression (currently at `server/routes/reports.js:129-142`) MUST be extracted into a shared constant or helper function to prevent drift. This 14-line expression handles `YYYY-MM-DD`, `YYYY-MM-DDTHH:mm:ss`, `DD/MM/YYYY`, and `DD.MM.YYYY` formats with fallback to `recognized_at`. **Required location**: `server/services/reportQueries.js` as exported constant `EFFECTIVE_DATE_EXPR` or helper function `buildEffectiveDateExpr()`. Both user and admin endpoints MUST import from this single source. Code review must verify no duplication exists.
- Must use the same status filter as current `/api/reports` implementation: `WHERE pr.status = 'completed'` (see `server/routes/reports.js:155`).

**Admin Report Endpoints Parity Checklist:**

All admin report endpoints must maintain exact parity with their user endpoint counterparts to ensure consistent behavior:

1. **UUID Validation** (applies to `GET /api/admin/reports/:reportId` and `GET /api/admin/reports/:reportId/original-file`):
   - Use `isUuid()` validation for reportId parameter
   - Return 400 with `{"error": "Invalid report id"}` for malformed UUIDs

2. **404 Response Shape** (missing report):
   - Must match user endpoint payload: `{"error": "Report not found", "report_id": reportId}`
   - Applies to: `GET /api/admin/reports/:reportId`, `GET /api/admin/reports/:reportId/original-file`

3. **410 Response Shape** (file unavailable):
   - Must match user endpoint payload including reason codes
   - Example: `{"error": "Original file not available", "reason": "report_predates_file_storage", "report_id": reportId, "recognized_at": timestamp}`
   - Applies to: `GET /api/admin/reports/:reportId/original-file`

4. **404 Response Shape** (file missing from disk):
   - Must match user endpoint payload: `{"error": "File not found on disk", "reason": "file_missing_from_storage", "report_id": reportId, "file_path": path}`
   - Applies to: `GET /api/admin/reports/:reportId/original-file`

5. **`has_file` Behavior**:
   - Must use same logic as user endpoint: `(pr.file_path IS NOT NULL) AS has_file`
   - Applies to: `GET /api/admin/reports`, `GET /api/admin/patients/:patientId/reports`

6. **`effective_date` Parsing**:
   - Must use extracted `effectiveDateExpr` shared constant/helper (see "CRITICAL - Shared Date Expression" requirement above)
   - Both user and admin endpoints must import from same source to prevent divergence
   - Applies to: `GET /api/admin/reports`, `GET /api/admin/patients/:patientId/reports`

### Existing Endpoint (Unchanged)

**`GET /api/reports/patients`** remains RLS enforced via `queryWithUser()`.

---

## 5.1. Shared Retrieval Helper Refactoring

**Problem**: Current helpers in `server/services/reportRetrieval.js` are tightly coupled to RLS context:
- `getPatientReports()` function uses `withUserTransaction(userId, ...)`
- `getReportDetail()` function uses `withUserTransaction(userId, ...)`

**Solution**: Refactor helpers to accept execution mode object and update all call sites:

```javascript
/**
 * @param {object} executionOptions - Execution mode options
 * @param {string} executionOptions.mode - 'user' | 'admin'
 * @param {string} [executionOptions.userId] - Required when mode='user'
 */
async function getPatientReports(patientId, paginationOptions, executionOptions) {
  if (executionOptions.mode === 'admin') {
    // Use adminPool.connect() directly (BYPASSRLS)
    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      // ... existing SQL queries ...
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } else {
    // Use withUserTransaction (RLS enforced)
    return await withUserTransaction(executionOptions.userId, async (client) => {
      // ... existing SQL queries ...
    });
  }
}
```

**Call site updates required:**
- User endpoints: Change `getPatientReports(id, opts, userId)` → `getPatientReports(id, opts, {mode: 'user', userId})`
- Admin endpoints: Use `getPatientReports(id, opts, {mode: 'admin'})`
- Update all call sites in `server/routes/reports.js` to use new signature

**Critical Requirement**: SQL queries and response shaping MUST be identical in both branches. Extract query logic into shared functions if needed to prevent divergence.

---

## 5.2. Chat and Agentic SQL Admin Access

**Problem**: The conversational SQL assistant and agentic SQL tools currently use `queryWithUser()` for RLS-scoped access. This means admin users selecting a patient they don't own will get empty results or "not found" errors, breaking the "standard UI" goal.

**Solution**: Add admin execution mode support to chat and agentic SQL.

### 5.2.1. Critical Blocker - Session Creation Patient Validation

**CRITICAL BLOCKER**: The POST endpoint (`server/routes/chatStream.js POST /api/chat/sessions`, lines 225-229) validates patient ownership using `queryWithUser()` BEFORE session creation. This is the PRIMARY blocking issue - admin users cannot even create sessions for patients they don't own. The session fails with 404 before any admin context is established.

**Required fix for POST /api/chat/sessions**:
1. Use conditional query function based on `req.user.is_admin`:
   ```javascript
   // Determine query function based on admin status
   const queryFn = req.user.is_admin
     ? (sql, params) => queryAsAdmin(sql, params)
     : (sql, params) => queryWithUser(sql, params, req.user.id);

   // Validate patient exists (bypasses RLS for admins)
   const result = await queryFn(
     'SELECT id FROM patients WHERE id = $1',
     [selectedPatientId]
   );
   ```
2. **Store admin context on session** (required for multi-turn conversations):
   ```javascript
   session.userId = req.user.id;
   session.isAdmin = req.user.is_admin || false; // NEW: Required for processMessage()
   ```
   Without storing `isAdmin` on the session, tool executions in later turns will not have access to admin context (since `req.user` is not available in SSE stream callbacks).

### 5.2.2. Stream Endpoint Patient Validation

**Location**: `server/routes/chatStream.js GET /api/chat/stream` and `processMessage()` function (lines 465-479)

**CRITICAL**: The `processMessage()` function recomputes patient count and validates patient existence on every message. These queries currently use `queryWithUser()` which will return 0/404 for admin users.

**Required fixes**:
1. Read admin context from session in `processMessage()`: `const isAdmin = session.isAdmin || false`
2. Update patient count query (line 465-469) to use conditional query function
3. Update patient existence check (line 475-479) to use conditional query function
4. Pass admin context to `initializeSystemPrompt()` and tool executions
5. Thread `isAdmin` through all tool executions via tool options

### 5.2.3. System Prompt Initialization

**Location**: `server/routes/chatStream.js` - `initializeSystemPrompt()` function (lines 580-593)

**CRITICAL**: The `initializeSystemPrompt()` function is called on the first message (line 510) and loads patient data into the system prompt by calling `buildSystemPrompt()`. This is the actual integration point that needs updating.

**Required fixes**:
1. Update `initializeSystemPrompt()` to read `session.isAdmin` and pass it to `buildSystemPrompt()`
2. Update `buildSystemPrompt()` signature in `agenticCore.js` to accept `isAdmin` parameter
3. When `isAdmin === true`, `buildSystemPrompt()` must use `queryAsAdmin()` for patient context queries instead of `queryWithUser()`

**Agentic Core (`server/services/agenticCore.js`):**
1. Add `isAdmin` parameter to `buildSystemPrompt()` function signature (after `userId` parameter)
2. When `isAdmin === true`, use `queryAsAdmin()` for patient context queries instead of `queryWithUser()`
3. Pass admin context through to tool executions

**Agentic Tools (`server/services/agenticTools.js`):**
1. Add `isAdmin` parameter to tool function signatures:
   - `fuzzySearchParameterNames(searchTerm, limit, userId, isAdmin = false)`
   - `fuzzySearchAnalyteNames(searchTerm, limit, userId, isAdmin = false)`
   - `executeExploratorySql(sql, reasoning, options)` where `options.isAdmin` is passed
2. **CRITICAL**: Fix `executeExploratorySql()` fallback pattern:
   - Current code: `if (userId) { queryWithUser() } else { pool.query() }`
   - This fallback breaks for admin users - `pool.query()` runs without RLS context and returns zero rows
   - Must change to: `if (isAdmin) { queryAsAdmin() } else if (userId) { queryWithUser() } else { throw error }`
   - **Fallback removal impact**: The current `pool.query()` fallback is used when `userId` is not provided. Investigation required to confirm whether any tests, scripts, or other non-request call sites rely on this fallback. If such call sites exist, they must be updated to pass explicit `userId` or `isAdmin` flag. If no such call sites exist, the fallback is dead code and safe to remove with the error-throwing pattern above.
3. When `isAdmin === true`, MUST use `queryAsAdmin()` to bypass RLS (NOT `pool.query()` which runs without RLS context and returns empty results)
4. Do NOT use conditional `set_config()` pattern - admin and user modes require different execution paths

**Example Refactoring (fuzzySearchParameterNames):**
```javascript
async function fuzzySearchParameterNames(searchTerm, limit, userId, isAdmin = false) {
  // ... validation ...

  // CRITICAL: Both admin and user modes require transactions for SET LOCAL pg_trgm.similarity_threshold
  // Using queryAsAdmin() one-off query will silently revert threshold to default

  if (isAdmin) {
    // Admin mode: Use adminPool with transaction (BYPASSRLS)
    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      // Set similarity threshold (requires transaction context)
      await client.query("SELECT set_config('pg_trgm.similarity_threshold', '0.3', true)");

      const sql = `
        SELECT DISTINCT parameter_name, similarity(parameter_name, $1) as score
        FROM lab_results
        WHERE parameter_name % $1
        ORDER BY score DESC
        LIMIT $2
      `;
      const result = await client.query(sql, [searchTerm, limit]);

      await client.query('COMMIT');
      return { matches: result.rows };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // User mode: Set RLS context and execute with user scope
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
    await client.query("SELECT set_config('pg_trgm.similarity_threshold', '0.3', true)");

    const sql = `
      SELECT DISTINCT parameter_name, similarity(parameter_name, $1) as score
      FROM lab_results
      WHERE parameter_name % $1
      ORDER BY score DESC
      LIMIT $2
    `;
    const result = await client.query(sql, [searchTerm, limit]);

    await client.query('COMMIT');
    return { matches: result.rows };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
```

**Chat Endpoint Integration:**
```javascript
// server/routes/chatStream.js GET /api/chat/stream
router.get('/stream', requireAuth, async (req, res) => {
  // ... session validation ...

  // Read admin context from session (NOT from req.user, which is unavailable in SSE callbacks)
  const userId = session.userId;
  const isAdmin = session.isAdmin || false;

  // CRITICAL: Admin patient validation queries
  // Replace queryWithUser() with conditional logic
  const queryFn = isAdmin
    ? (sql, params) => queryAsAdmin(sql, params)
    : (sql, params) => queryWithUser(sql, params, userId);

  // Patient count validation
  const countResult = await queryFn(
    'SELECT COUNT(*) as count FROM patients',
    []
  );

  // Patient existence check
  if (session.selectedPatientId) {
    const patientExists = await queryFn(
      'SELECT 1 FROM patients WHERE id = $1',
      [session.selectedPatientId]
    );
    // ... rest of validation
  }

  // Pass admin context to system prompt builder
  const systemPrompt = await buildSystemPrompt(
    schemaContext,
    MAX_CONVERSATION_ITERATIONS,
    'chat',
    selectedPatientId,
    isAdmin ? null : userId,  // Skip userId for admin
    isAdmin                    // New parameter
  );

  // Pass admin context to tool executions
  const toolOptions = {
    userId: isAdmin ? null : userId,
    isAdmin: isAdmin,
    // ... other options
  };
});
```

**Admin Context Threading (Complete Call Chain):**

The `isAdmin` flag must flow through the entire agentic SQL execution stack:

```
chatStream.js POST /stream (has req.user.is_admin)
  │
  ├─→ Patient validation queries (queryAsAdmin vs queryWithUser)
  │
  ├─→ initializeSystemPrompt(session)
  │     └─→ buildSystemPrompt(schema, maxIter, mode, patientId, userId, isAdmin)
  │           └─→ Patient context queries (queryAsAdmin vs queryWithUser)
  │
  └─→ Tool execution dispatch loop
        │
        ├─→ executeToolCall('fuzzy_search_parameter_names', args, { userId, isAdmin })
        │     └─→ fuzzySearchParameterNames(term, limit, userId, isAdmin)
        │           └─→ adminPool.connect() + transaction + SET LOCAL pg_trgm.similarity_threshold
        │
        ├─→ executeToolCall('fuzzy_search_analyte_names', args, { userId, isAdmin })
        │     └─→ fuzzySearchAnalyteNames(term, limit, userId, isAdmin)
        │           └─→ adminPool.connect() + transaction + SET LOCAL pg_trgm.similarity_threshold
        │
        └─→ executeToolCall('execute_sql', args, { userId, isAdmin })
              └─→ executeExploratorySql(sql, reasoning, { userId, isAdmin })
                    └─→ queryAsAdmin(sql) vs queryWithUser(sql, userId)
```

**Implementation checklist:**
1. ✅ `chatStream.js POST /sessions` - Detect `req.user.is_admin`, create `queryFn` helper for patient validation (lines 225-229)
2. ✅ `chatStream.js POST /sessions` - Store `session.isAdmin = req.user.is_admin || false`
3. ✅ `chatStream.js processMessage()` - Read `session.isAdmin`, create `queryFn` helper for patient queries (lines 465-479)
4. ✅ `chatStream.js initializeSystemPrompt()` - Read `session.isAdmin` and pass to `buildSystemPrompt()` (lines 580-593)
5. ✅ `agenticCore.js` - Add `isAdmin` parameter to `buildSystemPrompt()` function signature
6. ✅ `agenticCore.js` - Use `queryAsAdmin()` for patient queries when `isAdmin === true`
7. ✅ `agenticCore.js` - Pass `isAdmin` to tool execution via `executeToolCall()`
8. ✅ `agenticTools.js` - Add `isAdmin` parameter to `fuzzySearchParameterNames()`
9. ✅ `agenticTools.js` - Add `isAdmin` parameter to `fuzzySearchAnalyteNames()`
10. ✅ `agenticTools.js` - Add `isAdmin` to `executeExploratorySql()` options
11. ✅ `agenticTools.js` - Use adminPool with transaction for fuzzy search when `isAdmin === true`
12. ✅ `agenticTools.js` - Use `queryAsAdmin()` vs `queryWithUser()` based on `isAdmin` in executeExploratorySql()

**Critical Requirements:**
1. Admin mode MUST bypass RLS completely (no `set_config('app.current_user_id', ...)`)
2. SQL queries and validation logic MUST be identical for admin and user modes
3. Chat endpoint uses `requireAuth` (not `requireAdmin`) - admin mode is activated automatically based on `req.user.is_admin`
4. Frontend chat interface must detect admin status via `/api/auth/me` and handle patient selection accordingly
5. The `isAdmin` flag must be threaded through EVERY tool execution - missing it will cause silent failures

**MVP Scope:**
- Admin users can use chat interface with any patient visible in `/api/admin/patients`
- Agentic SQL tools work correctly for admin users across all patients
- No additional chat-specific admin UI (uses standard chat interface)

**Non-Goals (MVP):**
- Chat-specific audit logging (deferred with other admin read logging in Section 7)
- Admin-only chat features or UI differences
- Cross-patient queries in chat: Admin users must still select a specific patient before querying (same patient selection requirement as regular users). Multi-patient analytics queries (e.g., "show me all patients with high cholesterol") are deferred to future release. Chat interface enforces single-patient scoping regardless of admin status.

---

## 6. Frontend Changes

1. On app init, call `/api/auth/me`.
2. If `user.is_admin === true`, the UI remains the same but uses admin data sources for all report reads:
   - Patient lists: `/api/admin/patients` instead of `/api/reports/patients`
   - Reports list: `/api/admin/reports` instead of `/api/reports`
   - Report detail: `/api/admin/reports/:reportId` instead of `/api/reports/:reportId`
   - Patient reports: `/api/admin/patients/:patientId/reports` instead of `/api/reports/patients/:patientId/reports`
   - Original file: `/api/admin/reports/:reportId/original-file` instead of `/api/reports/:reportId/original-file`

### 6.1. Implementation Scope

**Frontend modules requiring updates:**
- `public/js/app.js` - Main app (patient list, reports browser)
- `public/js/chat.js` - Chat interface (patient selector, SQL results)
- `public/js/unified-upload.js` - Upload results and report viewing
- `public/js/reports-browser.js` - Reports browser UI (patient list, reports list, original file download)

**Recommended approach:** Create `public/js/api-helpers.js` with endpoint resolver:

**CRITICAL**: The frontend currently uses global scripts (NOT ES modules). The helper MUST use `window.` global pattern:

```javascript
// public/js/api-helpers.js
// NOTE: Uses global pattern (window.*) because frontend scripts are loaded WITHOUT type="module"
window.getReportsEndpoint = function(user, path) {
  if (!user?.is_admin) {
    return `/api/reports${path}`;
  }

  // Explicit mapping for admin endpoints
  const patterns = [
    { pattern: /^\/patients$/, admin: '/api/admin/patients' },
    { pattern: /^\/patients\/([^/]+)\/reports$/, admin: '/api/admin/patients/$1/reports' },
    { pattern: /^\/([^/]+)$/, admin: '/api/admin/reports/$1' }, // :reportId
    { pattern: /^\/([^/]+)\/original-file$/, admin: '/api/admin/reports/$1/original-file' },
    { pattern: /^\/?$/, admin: '/api/admin/reports' } // default list
  ];

  for (const { pattern, admin } of patterns) {
    const match = path.match(pattern);
    if (match) {
      return admin.replace(/\$(\d+)/g, (_, i) => match[i]);
    }
  }

  // Fallback - should not reach here with valid paths
  console.warn(`Unknown admin path: ${path}, falling back to /api/admin/reports${path}`);
  return `/api/admin/reports${path}`;
};

// Usage in other scripts (no import needed, global access):
// window.getReportsEndpoint(user, '/patients') → '/api/admin/patients' (admin) or '/api/reports/patients' (user)
// window.getReportsEndpoint(user, '/abc123') → '/api/admin/reports/abc123' (admin) or '/api/reports/abc123' (user)
// window.getReportsEndpoint(user, '/patients/abc123/reports') → '/api/admin/patients/abc123/reports'
// window.getReportsEndpoint(user, '/abc123/original-file') → '/api/admin/reports/abc123/original-file'
// window.getReportsEndpoint(user, '/') → '/api/admin/reports' (admin) or '/api/reports/' (user)
```

**Script Loading Order**: `public/js/api-helpers.js` must be loaded BEFORE `app.js`, `chat.js`, `reports-browser.js`, and `unified-upload.js` in `public/index.html`:

```html
<script src="js/auth.js" defer></script>
<script src="js/api-helpers.js" defer></script>  <!-- NEW: Load before other modules -->
<script src="js/plotRenderer.js" defer></script>
<script src="js/unified-upload.js" defer></script>
<script src="js/chat.js" defer></script>
<script src="js/reports-browser.js" defer></script>
<script src="js/app.js" defer></script>
```

**CRITICAL - Mandatory Helper Usage**: All hardcoded `/api/reports/...` references MUST be replaced with `window.getReportsEndpoint(user, path)` calls. This includes:
- All `fetch()` calls with `/api/reports/` URLs
- All `window.open()` calls with `/api/reports/` URLs
- Any string concatenation building report endpoint URLs

After implementation, run `grep -r "'/api/reports/" public/js/` to verify complete migration. Any remaining hardcoded references will break admin functionality.

**Testing checklist:**
- [ ] Admin can view all patients (not just their own)
- [ ] Regular user still sees only their own patients
- [ ] Admin can click into any patient's reports
- [ ] Admin can view report details for any patient
- [ ] Admin can download original files for any report
- [ ] Chat interface patient selector shows all patients for admin
- [ ] Upload results page works for admin users

**Important:** UI must not hardcode admin emails.

---

## 7. Audit Logging (Deferred)

Audit logging for admin read actions is deferred from MVP. This can be added later using the existing `logAdminAction()` helper in `server/routes/admin.js`.

**Future logging fields** (when implemented):
- `action_type`: 'view_patient' | 'view_report' | 'view_patient_reports' | 'download_report_file'
- `entity_type`: 'patient' | 'report'
- `entity_id`: Patient ID or Report ID
- `admin_user`: Admin email from `req.user.email`
- `ip_address`, `user_agent`: Standard audit metadata

This ensures admin read access is auditable without affecting MVP delivery.

---

## 8. Security Requirements

1. All `/api/admin/*` routes must be guarded by `requireAuth` and `requireAdmin`.
2. All admin routes must use `queryAsAdmin()` or `adminPool`.
3. Regular endpoints must never use `queryAsAdmin()`.
4. If `ADMIN_EMAIL_ALLOWLIST` is empty, admin access must be denied.
5. Admin endpoints must return the same HTTP status codes as user endpoints for equivalent error conditions (404 for missing resources, 400 for validation errors, 410 for deleted resources).

---

## 9. Acceptance Criteria

- Admin users can view all patients via `/api/admin/patients` with the same fields as `/api/reports/patients`.
- Non-admin users receive `403` from `/api/admin/patients`.
- Normal patient list is unchanged and still RLS-scoped.
- Admin UI remains visually identical to the normal patient UI, except admin users can access Review Queue in the Management section.
- Admin access audit logging is deferred from MVP.

---

## 10. Implementation Notes

- Add new route to existing `server/routes/admin.js` (do not create a parallel admin router).
- Keep route ordering consistent with existing admin route patterns.
- **Route ordering**: `server/routes/admin.js` applies `requireAuth` + `requireAdmin` middleware at router level. Any future admin endpoints that need to bypass auth (e.g., feature flag status checks) must be defined BEFORE the middleware declaration, similar to the dev-gmail pattern in `server/routes/gmailDev.js`.
- Do not include PRD review history or comments in this file.
