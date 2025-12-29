# PRD v4.4.3: Authentication - Part 3: RLS-Scoped Data Access

**Status:** Ready for Implementation
**Created:** 2025-12-27
**Author:** System (Claude Code)
**Target Release:** v4.4.3
**Part:** 3 of 4
**Depends On:** Part 1 (Schema), Part 2 (Auth Core)

---

## 1. Overview

### Purpose

Part 3 enforces **data isolation** by migrating all patient data access to use RLS context:

1. Update patient/report routes to use `queryWithUser()`
2. Update lab ingestion pipeline to set RLS context in transactions
3. Update agentic SQL/chat to execute queries with user scoping
4. **Apply `FORCE ROW LEVEL SECURITY`** on all patient tables (enables enforcement)
5. Remove `user_id IS NULL` escape hatches from RLS policies

### Development Context

**No Production Data Assumption**: This PRD assumes no production users or data exist. All existing development data will be cleared when FORCE RLS is applied. If production data exists, a migration plan must be added to backfill `user_id` values before enabling FORCE RLS.

### Key Constraint

**Deploy with Part 4**: Part 3 adds `requireAuth` middleware which will return 401s for unauthenticated requests. Deploy Part 3 and Part 4 together in development to maintain functionality. The UI will be temporarily inaccessible between Part 3 and Part 4 deployment.

### Success Criteria

✅ All patient routes use `queryWithUser()` or transaction-scoped `set_config`
✅ Lab ingestion sets RLS context for all three tables (patients, patient_reports, lab_results)
✅ Agentic SQL generates queries that respect RLS automatically
✅ `FORCE ROW LEVEL SECURITY` enabled on all patient tables
✅ Data isolation tests pass (two users can't see each other's data)
✅ Existing functionality intact for authenticated users

---

## 2. Critical Security Requirement

**Principle**: Every database operation that accesses patient data MUST set RLS context via `queryWithUser()` or `setUserContext()`. PostgreSQL Row-Level Security policies automatically filter results to the current user's data—explicit `WHERE user_id = $1` filters are optional (defense-in-depth) but not required.

**Why RLS is Primary Security:**
- Even if LLM generates `SELECT * FROM patients` (no user filter), database returns only current user's data
- SQL injection cannot bypass database-level policies
- No complex SQL rewriting required
- Single enforcement point (database, not application layer)

---

## 3. Data Model Changes

### 3.1 Fix Patient Uniqueness Constraint

**Problem**: Current schema has `full_name_normalized TEXT UNIQUE` (global uniqueness). This will cause conflicts when User A and User B both have patients named "John Smith".

**Solution**: Change to composite unique constraint scoped by user.

```sql
-- Drop global unique constraint
ALTER TABLE patients DROP CONSTRAINT IF EXISTS patients_full_name_normalized_key;

-- Add composite unique constraint (user-scoped)
ALTER TABLE patients ADD CONSTRAINT patients_user_name_unique
  UNIQUE (user_id, full_name_normalized);
```

**Update to schema.js:**

```javascript
// File: server/db/schema.js
// Replace line 14 from:
//   full_name_normalized TEXT UNIQUE,
// To:
//   full_name_normalized TEXT,

// Add after patients table definition:
// CRITICAL: Use a full unique constraint (not a partial index) to ensure ON CONFLICT clause works reliably.
// PostgreSQL's ON CONFLICT inference does not work with partial indexes (WHERE clauses).
`
ALTER TABLE patients DROP CONSTRAINT IF EXISTS patients_full_name_normalized_key;
`,
`
ALTER TABLE patients ADD CONSTRAINT IF NOT EXISTS patients_user_name_unique
  UNIQUE (user_id, full_name_normalized);
`,
```

**Impact on upsertPatient():**

```javascript
// File: server/services/reportPersistence.js
// Update conflict target in upsertPatient (line ~98):

async function upsertPatient(client, { fullName, dateOfBirth, gender, recognizedAt }) {
  const normalized = normalizePatientName(fullName);
  const patientId = randomUUID();

  // Must set user_id from RLS context (set earlier in transaction)
  const result = await client.query(
    `
    INSERT INTO patients (
      id,
      full_name,
      full_name_normalized,
      date_of_birth,
      gender,
      user_id,
      last_seen_report_at
    )
    VALUES ($1, $2, $3, $4, $5, current_setting('app.current_user_id', true)::uuid, NOW())
    ON CONFLICT (user_id, full_name_normalized) DO UPDATE  -- ⬅️ CHANGED: composite key
      SET
        full_name = COALESCE(EXCLUDED.full_name, patients.full_name),
        date_of_birth = COALESCE(EXCLUDED.date_of_birth, patients.date_of_birth),
        gender = COALESCE(EXCLUDED.gender, patients.gender),
        updated_at = NOW(),
        last_seen_report_at = NOW()
    RETURNING id;
    `,
    [
      patientId,
      fullName ?? null,
      normalized,
      dateOfBirth ?? null,
      gender ?? null,
    ],
  );

  return result.rows[0].id;
}
```

**Critical**: The `user_id` column is set from `current_setting('app.current_user_id')`, which is the RLS context variable. This ensures patients are always associated with the authenticated user who uploaded the report.

---

## 4. Enable FORCE ROW LEVEL SECURITY

### 4.1 Schema Migration Ordering

**CRITICAL**: These schema updates must be added to the END of the `schemaStatements` array in `server/db/schema.js`. They will execute on EVERY boot due to `IF EXISTS` clauses, ensuring idempotency.

**Execution Order** (append to schemaStatements array):
1. Drop old constraints (from Section 3.1)
2. Add new user-scoped unique constraint (from Section 3.1)
3. Drop old RLS policies (below)
4. Create new RLS policies without NULL escape hatch (below)
5. Apply FORCE ROW LEVEL SECURITY (below)

This ordering ensures clean migration from Part 1 schema to Part 3 enforcement.

### 4.2 Update RLS Policies (Remove NULL Escape Hatch)

**Part 1 policies allowed `user_id IS NULL`** for transition. Part 3 removes this and forces enforcement.

```sql
-- Drop old policies
DROP POLICY IF EXISTS user_isolation_patients ON patients;
DROP POLICY IF EXISTS user_isolation_reports ON patient_reports;
DROP POLICY IF EXISTS user_isolation_lab_results ON lab_results;

-- Recreate WITHOUT NULL escape hatch
CREATE POLICY user_isolation_patients ON patients
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY user_isolation_reports ON patient_reports
  FOR ALL
  USING (
    patient_id IN (
      SELECT id FROM patients
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
    )
  );

CREATE POLICY user_isolation_lab_results ON lab_results
  FOR ALL
  USING (
    report_id IN (
      SELECT pr.id FROM patient_reports pr
      JOIN patients p ON pr.patient_id = p.id
      WHERE p.user_id = current_setting('app.current_user_id', true)::uuid
    )
  );

-- Apply FORCE (even table owners must respect RLS)
ALTER TABLE patients FORCE ROW LEVEL SECURITY;
ALTER TABLE patient_reports FORCE ROW LEVEL SECURITY;
ALTER TABLE lab_results FORCE ROW LEVEL SECURITY;
```

**Add to `server/db/schema.js`** as described in Section 4.1 (append to schemaStatements array).

**Verification:**
```sql
-- Check FORCE is applied
SELECT relname, relforcerowsecurity
FROM pg_class
WHERE relname IN ('patients', 'patient_reports', 'lab_results');
-- All should show relforcerowsecurity = true
```

---

## 5. RLS Helper Functions

Before migrating routes, we need helper functions for different RLS patterns.

### 5.1 Single-Query Helper (Enhanced)

**Update existing implementation** to support optional statement timeout:

```javascript
// File: server/db/index.js
// Update existing queryWithUser to support optional timeout

/**
 * Execute single query with RLS context
 * @param {string} sql - SQL query
 * @param {array} params - Query parameters
 * @param {string} userId - User ID for RLS context
 * @param {number|null} statementTimeoutMs - Optional statement timeout in milliseconds
 * @returns {Promise<QueryResult>}
 */
export async function queryWithUser(sql, params, userId, statementTimeoutMs = null) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);

    // Set statement timeout if provided
    if (statementTimeoutMs !== null && statementTimeoutMs > 0) {
      await client.query('SET LOCAL statement_timeout = $1', [statementTimeoutMs]);
    }

    const result = await client.query(sql, params);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
```

### 5.2 Multi-Query Transaction Helper (NEW)

**Required for**: `reportRetrieval.js` functions that execute multiple queries on same client.

```javascript
// File: server/db/index.js
// Add this new helper

/**
 * Execute multiple queries with RLS context in single transaction
 * @param {string} userId - User ID for RLS context
 * @param {Function} callback - async (client) => { ... } function
 * @returns {Promise<any>} Result from callback
 */
export async function withUserTransaction(userId, callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
```

### 5.3 Transaction Boundary Guidelines

**When to use each helper:**

- **`queryWithUser(sql, params, userId, timeout?)`**: Single-query operations
  - Execute SQL endpoint (`/api/execute-sql`)
  - Agentic SQL tool calls (`execute_sql`)
  - SQL generator count queries
  - Any standalone query with no transaction context

- **`withUserTransaction(userId, callback)`**: Multi-query operations
  - Report retrieval (patient + reports in one transaction)
  - Any business logic requiring multiple queries
  - Operations needing atomicity across queries

**Important**: Do NOT nest these helpers. If already inside `withUserTransaction()`, use `client.query()` directly (RLS context is already set). Attempting to call `queryWithUser()` inside another transaction will cause nested transaction errors.

**SSE Streaming Queries**: For Server-Sent Events endpoints (e.g., `/api/chat/stream`), each tool execution is independent. Use `queryWithUser()` for each tool call—they are separate transactions that complete before the next iteration.

---

## 6. Report Routes Migration

**ACTUAL ROUTES**: The codebase uses `/api/reports/*` and `/api/patients/:patientId/reports` (NOT standalone `/api/patients`). These routes delegate to `reportRetrieval.js` service.

### 6.1 Update reports.js Routes

```javascript
// File: server/routes/reports.js
// Add requireAuth to all routes

import express from 'express';
import { requireAuth } from '../middleware/auth.js';  // ⬅️ ADD
import { getPatientReports, getReportDetail } from '../services/reportRetrieval.js';

const router = express.Router();

// Line 78: Add requireAuth
router.get('/patients/:patientId/reports', requireAuth, async (req, res) => {
  const { patientId } = req.params;

  if (!isUuid(patientId)) {
    return res.status(400).json({ error: 'Invalid patient id' });
  }

  try {
    // Pass userId to reportRetrieval service
    const result = await getPatientReports(patientId, {
      limit: req.query.limit,
      offset: req.query.offset,
    }, req.user.id);  // ⬅️ ADD userId parameter

    if (!result) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    return res.json(result);
  } catch (error) {
    console.error('[reports] Failed to fetch patient reports', error);
    return res.status(500).json({ error: 'Unable to fetch patient reports' });
  }
});

// Similar changes for other routes:
// - GET /reports (line ~105)
// - GET /reports/patients (line ~197)
// - GET /reports/:reportId (line ~232)
// - GET /reports/:reportId/original-file (line ~254)
```

### 6.2 Update reportRetrieval.js Service

```javascript
// File: server/services/reportRetrieval.js
// Update to use withUserTransaction for multi-query operations

import { pool, withUserTransaction } from '../db/index.js';  // ⬅️ ADD withUserTransaction

async function getPatientReports(patientId, options = {}, userId) {  // ⬅️ ADD userId param
  const limit = coerceLimit(options.limit);
  const offset = coerceOffset(options.offset);

  // Use withUserTransaction for multi-query flow
  return await withUserTransaction(userId, async (client) => {
    // Query 1: Check patient exists and belongs to user (RLS auto-filters)
    const patientResult = await client.query(
      `SELECT id, full_name, date_of_birth, gender, last_seen_report_at, created_at, updated_at
       FROM patients
       WHERE id = $1`,
      [patientId],
    );

    if (patientResult.rowCount === 0) {
      return null;  // Patient doesn't exist OR doesn't belong to user
    }

    // Query 2: Fetch reports (RLS auto-filters)
    const reportsResult = await client.query(
      `SELECT id, source_filename, checksum, parser_version, status,
              recognized_at, processed_at, test_date_text, created_at, updated_at
       FROM patient_reports
       WHERE patient_id = $1
       ORDER BY recognized_at DESC, created_at DESC
       LIMIT $2 OFFSET $3`,
      [patientId, limit, offset],
    );

    return {
      patient: patientResult.rows[0],
      reports: reportsResult.rows,
      pagination: { limit, offset, total: reportsResult.rowCount }
    };
  });
}

// Similar updates for:
// - getReportDetail(reportId, userId)
// - getAllReports(filters, userId)
// - getReportsByPatient(patientId, userId)
```

**Security:** RLS policies filter all queries automatically. Even if attacker guesses valid UUID, RLS returns empty results if patient/report doesn't belong to their user account.

---

## 7. Execute SQL Endpoint

**CRITICAL**: The `/api/execute-sql` endpoint is used by frontend to render plots. It currently uses `pool.query` without RLS context.

### 7.1 Update executeSql.js

```javascript
// File: server/routes/executeSql.js

import express from 'express';
import { requireAuth } from '../middleware/auth.js';  // ⬅️ ADD
import { queryWithUser } from '../db/index.js';  // ⬅️ ADD
import logger from '../utils/logger.js';

const router = express.Router();

router.post('/', requireAuth, async (req, res) => {  // ⬅️ ADD requireAuth
  const startTime = Date.now();

  try {
    const { sql } = req.body;

    // ... existing validation (SELECT/WITH check, LIMIT check) ...

    logger.info({
      path: req.path,
      sql_preview: trimmedSql.substring(0, 100)
    }, '[executeSql] Executing SQL query');

    // CHANGE: Use queryWithUser instead of pool.query
    const result = await queryWithUser(trimmedSql, [], req.user.id);  // ⬅️ CHANGED

    const durationMs = Date.now() - startTime;

    logger.info({
      path: req.path,
      row_count: result.rowCount,
      duration_ms: durationMs
    }, '[executeSql] Query executed successfully');

    return res.status(200).json({
      ok: true,
      rows: result.rows,
      rowCount: result.rowCount,
      fields: result.fields ? result.fields.map(f => f.name) : [],
      metadata: { duration_ms: durationMs }
    });

  } catch (error) {
    // ... existing error handling ...
  }
});

export default router;
```

**Why Critical**: This endpoint executes LLM-generated SQL for plot rendering. Without RLS context, plots will show no data under FORCE RLS.

---

## 8. Lab Report Processing Pipeline with Async Jobs

**CRITICAL**: Lab ingestion is async (job pattern). userId must thread through: route → job creation → batch → processor → persistence.

### 8.1 Update analyzeLabReport.js Route (Job Creation)

```javascript
// File: server/routes/analyzeLabReport.js
// Capture userId when creating batch jobs

import { requireAuth } from '../middleware/auth.js';  // ⬅️ ADD

router.post('/batch', requireAuth, upload.array('analysisFile', 20), async (req, res) => {
  // ... existing file validation ...

  // Create batch with userId (matches jobManager.createBatch(userId, files) signature)
  const batch = jobManager.createBatch(req.user.id, files);

  // Extract jobs from batch (createBatch returns { batchId, jobs, files })
  const { jobs } = batch;

  // Process each job in background
  jobs.forEach(({ jobId, filename }) => {
    const file = files.find(f => f.name === filename);

    setImmediate(async () => {
      try {
        const result = await processLabReport(
          file.data,
          file.name,
          file.mimetype,
          req.user.id  // ⬅️ PASS userId to processor
        );
        jobManager.setJobResult(jobId, result);
      } catch (error) {
        jobManager.setJobError(jobId, error);
      }
    });
  });

  res.status(202).json({ batchId: batch.batchId });
});
```

### 8.2 Protect Job and Batch Status Endpoints (CRITICAL)

**SECURITY RISK**: Job and batch status endpoints currently allow any authenticated user to poll any job/batch by guessing IDs. This leaks processing results and metadata across user boundaries.

**Required changes** to `server/routes/analyzeLabReport.js`:

```javascript
// File: server/routes/analyzeLabReport.js
import { requireAuth } from '../middleware/auth.js';  // ⬅️ ADD

// Job polling endpoint - MUST check ownership
router.get('/jobs/:jobId', requireAuth, (req, res) => {  // ⬅️ ADD requireAuth
  const { jobId } = req.params;

  console.log(`[analyzeLabReport] Job status requested: ${jobId}`);

  const jobStatus = getJobStatus(jobId);

  if (!jobStatus) {
    return res.status(404).json({ error: 'Job not found' });
  }

  // ✅ CRITICAL: Verify job ownership
  // Use getJob() (not getJobStatus()) to access userId field
  const job = jobManager.getJob(jobId);
  if (job.userId !== req.user.id) {
    // Return 404 (not 403) to prevent job enumeration attacks
    return res.status(404).json({ error: 'Job not found' });
  }

  return res.status(200).json(jobStatus);
});

// Batch polling endpoint - MUST check ownership
router.get('/batches/:batchId', requireAuth, (req, res) => {  // ⬅️ ADD requireAuth
  const { batchId } = req.params;

  const batchStatus = getBatchStatus(batchId);

  if (!batchStatus) {
    return res.status(404).json({ error: 'Batch not found' });
  }

  // ✅ CRITICAL: Verify batch ownership
  const batch = jobManager.getBatch(batchId);
  if (batch.userId !== req.user.id) {
    return res.status(404).json({ error: 'Batch not found' });
  }

  return res.status(200).json(batchStatus);
});
```

**Why 404 instead of 403?**
- 403 confirms the job/batch exists (information leak)
- 404 is ambiguous (doesn't exist OR you don't own it)
- Prevents attackers from enumerating valid job IDs

**Security Impact:**
- Without this, User A can view User B's job results containing patient data
- Job metadata includes filenames, processing errors, and report IDs
- This violates data isolation guarantees

### 8.3 Update labReportProcessor.js (Pass userId to persistence)

```javascript
// File: server/services/labReportProcessor.js
// Update processLabReport to accept and pass userId

async function processLabReport(fileBuffer, filename, mimetype, userId) {  // ⬅️ ADD userId param
  // ... OCR extraction logic (unchanged) ...

  // Pass userId to persistence layer
  const result = await persistLabReport({
    fileBuffer,
    filename,
    mimetype,
    parserVersion: 'v1.0',
    processedAt: new Date(),
    coreResult: extractedData,
    userId  // ⬅️ ADD userId
  });

  return result;
}
```

### 8.4 Update reportPersistence.js (Use RLS context)

**CRITICAL CHANGE**: Add `userId` parameter and set RLS context in transaction.

```javascript
// File: server/services/reportPersistence.js

async function persistLabReport({
  fileBuffer,
  filename,
  mimetype,
  parserVersion,
  processedAt,
  coreResult,
  userId,  // ⬅️ ADD userId parameter
}) {
  // ... existing validation ...

  const client = await pool.connect();
  const reportId = randomUUID();
  let patientId;
  // ... existing variable declarations ...

  try {
    await client.query('BEGIN');

    // ✅ ADD THIS: Set RLS context for entire transaction
    await client.query(
      "SELECT set_config('app.current_user_id', $1, true)",
      [userId]
    );

    // Existing code continues...
    patientId = await upsertPatient(client, {
      fullName: patientName,
      dateOfBirth: patientDateOfBirth,
      gender: patientGender,
      recognizedAt,
    });

    // ... rest of existing implementation (file save, INSERT patient_reports, INSERT lab_results) ...
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
```

**Note**: `upsertPatient()` must also be updated per Section 3.1 to include `user_id` column and use composite conflict target.

### 8.5 Gmail Integration (Same Pipeline)

**CRITICAL**: Gmail ingestion uses same `labReportProcessor` → `persistLabReport` pipeline, so it inherits userId threading requirements.

```javascript
// File: server/routes/gmailDev.js

router.post('/ingest', requireAuth, async (req, res) => {  // ⬅️ Ensure requireAuth
  // ... Gmail attachment download logic ...

  // Create batch with correct signature: createBatch(userId, files)
  const batch = jobManager.createBatch(req.user.id, attachments);
  const { jobs } = batch;

  // Process each attachment
  jobs.forEach(({ jobId, filename }) => {
    const att = attachments.find(a => a.filename === filename);

    setImmediate(async () => {
      const result = await processLabReport(
        att.buffer,
        att.filename,
        att.mimetype,
        req.user.id  // ⬅️ Thread through to persistence
      );
      jobManager.setJobResult(jobId, result);
    });
  });

  res.status(202).json({ batchId: batch.batchId });
});
```

**Security**: Gmail-ingested reports associate with the authenticated user who initiated the import, NOT the email sender.

### 8.6 Update Legacy SQL Generator Route (CRITICAL)

**CRITICAL**: The `/api/sql-generator` endpoint executes final SQL queries and count queries via `pool.query()` without RLS context. This will either fail under FORCE RLS or return all users' data.

**Required changes** to `server/routes/sqlGenerator.js`:

```javascript
// File: server/routes/sqlGenerator.js
import { requireAuth } from '../middleware/auth.js';  // ⬅️ ADD
import { queryWithUser } from '../db/index.js';  // ⬅️ ADD

/**
 * Execute a data query with RLS context and timeout
 * @param {string} sqlWithLimit - Validated SQL with LIMIT clause
 * @param {string} userId - User ID for RLS context
 * @param {number} timeoutMs - Statement timeout in milliseconds
 */
async function executeDataQuery(sqlWithLimit, userId, timeoutMs = 30000) {  // ⬅️ ADD userId param
  // Use queryWithUser() instead of pool.query()
  return await queryWithUser(sqlWithLimit, [], userId, timeoutMs);  // ⬅️ CHANGED
}

/**
 * Count total rows with RLS context
 * @param {string} sqlWithLimit - Validated SQL with LIMIT clause
 * @param {string} userId - User ID for RLS context
 */
async function countTotalRows(sqlWithLimit, userId) {  // ⬅️ ADD userId param
  // Strip LIMIT and wrap in COUNT query (existing logic)
  let sqlWithoutLimit = sqlWithLimit
    .replace(/;?\s*$/i, '')
    .replace(/--[^\n]*$/gm, '')
    .trim()
    .replace(/\s+LIMIT\s+\d+(?:\s+OFFSET\s+\d+)?\s*$/i, '');

  const countSql = `SELECT COUNT(*) as total FROM (${sqlWithoutLimit}) as subq`;

  try {
    // Use queryWithUser() with 5s timeout
    const result = await queryWithUser(countSql, [], userId, 5000);  // ⬅️ CHANGED
    return parseInt(result.rows[0]?.total || 0, 10);
  } catch (err) {
    console.warn(`[countTotalRows] Failed to count total rows:`, err.message);
    return null;
  }
}

// Main SQL generator endpoint
router.post('/', requireAuth, async (req, res) => {  // ⬅️ ADD requireAuth
  const userIdentifier = getUserIdentifier(req);  // Falls back to req.user.id

  try {
    // ... existing validation and SQL generation logic ...

    // Execute data query with RLS context
    const queryResult = await executeDataQuery(
      validatedSql,
      req.user.id,  // ⬅️ PASS userId
      30000  // 30s timeout
    );

    // Count total rows with RLS context
    const totalRows = await countTotalRows(validatedSql, req.user.id);  // ⬅️ PASS userId

    // ... rest of response handling ...

  } catch (error) {
    // ... existing error handling ...
  }
});
```

**Why Critical:**
- This endpoint is used by both legacy SQL generator UI and as fallback for agentic SQL
- Without RLS context, queries will:
  - Return empty results (if FORCE RLS is enabled without context)
  - Return all users' data (security breach)
- Frontend plot rendering depends on this endpoint

**Testing:**
```bash
# After Part 3 deployment, verify RLS scoping:
curl -X POST http://localhost:3000/api/sql-generator \
  -H 'Content-Type: application/json' \
  -H 'Cookie: session=<user1_session>' \
  -d '{"question": "show all patients"}'

# Should return only User 1's patients, not all users' patients
```

---

## 9. Agentic SQL & Chat Endpoints (CRITICAL)

### 9.1 Problem

**Agentic SQL has TWO execution paths that need RLS:**
1. **Tool calls** during iteration (`execute_sql`, `fuzzy_search_*` tools)
2. **Final query** execution sent to frontend

Both must use RLS context, otherwise:
- Tools return empty results (prompt building fails)
- Final query returns all users' data (security breach)

### 9.2 Update Tool Execution Pipeline (CRITICAL)

**ARCHITECTURE**: Agentic SQL has a call chain: **Route → Orchestrator → executeToolCall() → Tool Functions → Database**. userId must flow through entire chain.

#### 9.2.1 Update Tool Functions (agenticTools.js)

```javascript
// File: server/services/agenticTools.js

import { queryWithUser } from '../db/index.js';  // ⬅️ ADD

/**
 * Execute exploratory SQL with RLS context
 * @param {string} sql - SQL query to execute
 * @param {string} reasoning - LLM's reasoning for this query
 * @param {object} options - Options including userId and query_type
 */
async function executeExploratorySql(sql, reasoning, options = {}) {
  const { userId, query_type = 'explore' } = options;  // ⬅️ EXTRACT userId from options

  // ... existing validation and LIMIT enforcement logic ...

  // ⬅️ CHANGE: Use queryWithUser instead of pool.query
  const result = await queryWithUser(safeSql, [], userId);  // ⬅️ PASS userId (line ~333)

  return {
    rows: result.rows,
    row_count: result.rowCount,
    reasoning,
    query_type,
    query_executed: safeSql,
    fields: result.fields?.map(f => f.name) || []
  };
}

// Export for use by orchestrator
export {
  fuzzySearchParameterNames,
  fuzzySearchAnalyteNames,
  executeExploratorySql,
  TOOL_DEFINITIONS
};
```

**Note**: Fuzzy search tools (`fuzzySearchParameterNames`, `fuzzySearchAnalyteNames`) query `analytes` and `analyte_aliases` tables, which are NOT patient data—no RLS needed.

#### 9.2.2 Update Tool Orchestrator (agenticCore.js)

```javascript
// File: server/services/agenticCore.js

/**
 * Execute a tool call by name
 * @param {string} toolName - Name of tool to execute
 * @param {object} params - Tool parameters from LLM
 * @param {object} options - Options including userId
 */
async function executeToolCall(toolName, params, options = {}) {
  const { userId } = options;  // ⬅️ EXTRACT userId from options

  switch (toolName) {
    case 'fuzzy_search_parameter_names':
      return await fuzzySearchParameterNames(params.search_term, params.limit);

    case 'fuzzy_search_analyte_names':
      return await fuzzySearchAnalyteNames(params.search_term, params.limit);

    case 'execute_sql':
      // ⬅️ PASS userId in options
      return await executeExploratorySql(params.sql, params.reasoning, {
        ...options,
        userId,  // ⬅️ CRITICAL: Thread userId to tool
        query_type: params.query_type || 'explore'
      });

    // Backward compatibility
    case 'execute_exploratory_sql':
      return await executeExploratorySql(params.sql, params.reasoning, { ...options, userId });

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

export {
  buildSystemPrompt,
  executeToolCall,  // Exported for use by routes
  handleFinalQuery,
  logSqlGeneration,
};
```

#### 9.2.3 Update Route Handlers (Pass userId to Orchestrator)

**All routes that invoke agentic SQL** must pass `userId` through `executeToolCall()`:

```javascript
// File: server/routes/chatStream.js (SSE endpoint)
router.get('/stream', requireAuth, async (req, res) => {
  const session = sessionManager.getSession(sessionId);

  // ... SSE setup ...

  // When LLM calls tools during iteration:
  for (const toolCall of llmResponse.tool_calls) {
    const toolResult = await executeToolCall(
      toolCall.name,
      toolCall.parameters,
      { userId: session.userId }  // ⬅️ PASS userId from session
    );

    // ... send tool result to LLM ...
  }
});
```

```javascript
// File: server/routes/sqlGenerator.js (legacy endpoint)
router.post('/', requireAuth, async (req, res) => {
  // ... existing setup ...

  // When agentic orchestrator calls tools:
  const toolResult = await executeToolCall(
    toolName,
    toolParams,
    { userId: req.user.id }  // ⬅️ PASS userId from request
  );
});
```

**Call Chain Summary**:
```
HTTP Request (req.user.id)
  ↓
Route Handler extracts req.user.id
  ↓
executeToolCall(toolName, params, { userId })
  ↓
executeExploratorySql(sql, reasoning, { userId })
  ↓
queryWithUser(sql, params, userId)
  ↓
PostgreSQL with RLS context
```

### 9.3 Update agenticCore.js (Prompt Building Queries)

**CRITICAL**: `agenticCore.js` queries `patients` table for prompt building (lines 98, 151) without RLS context. These will fail or leak data under FORCE RLS.

**Required changes** to `server/services/agenticCore.js`:

```javascript
// File: server/services/agenticCore.js
import { queryWithUser } from '../db/index.js';  // ⬅️ ADD

/**
 * Build system prompt with optional patient context
 * @param {string} userId - User ID for RLS context (⬅️ ADD parameter)
 */
async function buildSystemPrompt({
  schemaContext,
  maxIterations,
  mode,
  selectedPatientId,
  userId  // ⬅️ ADD to function signature
}) {
  let prompt = agenticSystemPromptTemplate
    .replace(/\{\{MAX_ITERATIONS\}\}/g, maxIterations)
    .replace(/\{\{SCHEMA_CONTEXT\}\}/g, schemaContext);

  if (mode === 'chat') {
    // Chat mode - inject selected patient demographics
    if (selectedPatientId) {
      // ⬅️ CHANGE: Use queryWithUser() instead of pool.query()
      const patientResult = await queryWithUser(`
        SELECT
          full_name,
          gender,
          date_of_birth,
          CASE
            WHEN date_of_birth IS NOT NULL AND date_of_birth ~ '^\\d{4}-\\d{2}-\\d{2}$'
            THEN EXTRACT(YEAR FROM AGE(CURRENT_DATE, date_of_birth::date))::int
            WHEN date_of_birth IS NOT NULL AND date_of_birth ~ '^\\d{2}/\\d{2}/\\d{4}$'
            THEN EXTRACT(YEAR FROM AGE(CURRENT_DATE, TO_DATE(date_of_birth, 'DD/MM/YYYY')))::int
            ELSE NULL
          END AS age
        FROM patients
        WHERE id = $1
      `, [selectedPatientId], userId);  // ⬅️ PASS userId

      const patient = patientResult.rows[0] || {};
      // ... rest of patient context injection ...
    }
  } else {
    // ⬅️ CHANGE: Legacy mode - load patient list with RLS context
    const patientsResult = await queryWithUser(`
      SELECT
        id,
        full_name,
        CASE
          WHEN full_name IS NOT NULL AND full_name != '' THEN full_name
          ELSE 'Patient (' || SUBSTRING(id::text FROM 1 FOR 6) || '...)'
        END AS display_name,
        gender,
        date_of_birth
      FROM patients
      ORDER BY last_seen_report_at DESC NULLS LAST
      LIMIT 100
    `, [], userId);  // ⬅️ PASS userId

    // ... rest of legacy mode prompt building ...
  }

  return { prompt, /* ... */ };
}
```

**Update all callers** of `buildSystemPrompt()` to pass `userId`:

```javascript
// In agenticSqlGenerator.js or wherever buildSystemPrompt is called:
const { prompt } = await buildSystemPrompt({
  schemaContext,
  maxIterations: 10,
  mode: 'chat',
  selectedPatientId: req.body.patientId,
  userId: req.user.id  // ⬅️ ADD
});
```

**Line 242 Analysis**: This line logs to `sql_generation_logs` (audit table, not patient data). No RLS needed for audit logs.

---

### 9.4 Update chatStream.js (All Endpoints)

**CRITICAL**: All chat endpoints need auth + session-user binding.

#### 9.4.1 POST /api/chat/sessions (Create Session)

```javascript
// File: server/routes/chatStream.js

router.post('/sessions', requireAuth, async (req, res) => {  // ⬅️ ADD requireAuth
  const session = sessionManager.createSession();

  // ✅ Bind session to user immediately
  session.userId = req.user.id;

  res.json({
    sessionId: session.id,
    createdAt: session.createdAt
  });
});
```

#### 9.4.2 GET /api/chat/stream (SSE Endpoint)

```javascript
router.get('/stream', requireAuth, async (req, res) => {  // ⬅️ ADD requireAuth (line 279)
  const { sessionId } = req.query;

  // Get session
  const session = sessionManager.getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // ✅ CRITICAL: Validate session ownership
  // Return 404 (not 403) to prevent session enumeration (consistent with job/batch ownership checks)
  if (session.userId !== req.user.id) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // SSE setup...

  // When executing SQL (via tools or final query), use session.userId
  const results = await queryWithUser(llmGeneratedSQL, [], session.userId);

  // ... stream results ...
});
```

#### 9.4.3 POST /api/chat/messages

```javascript
router.post('/messages', requireAuth, async (req, res) => {  // ⬅️ ADD requireAuth (line 349)
  const { sessionId, message } = req.body;

  const session = sessionManager.getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // ✅ Validate ownership (404 to prevent enumeration)
  if (session.userId !== req.user.id) {
    return res.status(404).json({ error: 'Session not found' });
  }

  session.messages.push({ role: 'user', content: message });
  res.json({ ok: true });
});
```

#### 9.4.4 DELETE /api/chat/sessions/:sessionId

```javascript
router.delete('/sessions/:sessionId', requireAuth, (req, res) => {  // ⬅️ ADD requireAuth (line 390)
  const { sessionId } = req.params;

  const session = sessionManager.getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // ✅ Validate ownership before deletion (404 to prevent enumeration)
  if (session.userId !== req.user.id) {
    return res.status(404).json({ error: 'Session not found' });
  }

  sessionManager.deleteSession(sessionId);
  res.json({ ok: true });
});
```

### 9.5 Update sessionManager.js

```javascript
// File: server/utils/sessionManager.js

createSession() {
  const session = {
    id: crypto.randomUUID(),
    messages: [],
    createdAt: new Date(),
    lastActivity: new Date(),
    userId: null,  // ⬅️ ADD: Will be set by route handler
    selectedPatientId: null,
    isProcessing: false,
    iterationCount: 0,
    currentMessageId: null
  };

  this.sessions.set(session.id, session);
  return session;
}
```

**Security Benefits:**
- Prevents session hijacking (User A can't access User B's session)
- Session validation on every request (not just creation)
- Consistent 404 Not Found response (prevents session enumeration, same as job/batch endpoints)
- Combined with RLS for defense-in-depth

---

## 10. Gmail Integration Endpoints

Gmail integration endpoints already authenticated and scoped correctly—no changes needed for Part 3 beyond adding `requireAuth` and threading userId through job pipeline (covered in Section 8.4):

```javascript
// File: server/routes/gmailDev.js

import { requireAuth } from '../middleware/auth.js';

router.post('/api/dev-gmail/fetch', requireAuth, async (req, res) => {
  // Gmail OAuth flow uses req.user.id for provenance tracking
  // Lab ingestion pipeline already handles RLS context (Section 8)
});
```

**Security:** Gmail-ingested reports associate with current user via lab processing pipeline.

---

## 11. Code Touchpoints

**Files requiring changes** (with specific locations):

| File | Change Required | Key Details |
|------|----------------|-------------|
| `server/db/schema.js` | 1. Drop `full_name_normalized UNIQUE` constraint<br>2. Add composite `UNIQUE (user_id, full_name_normalized)` index<br>3. Update RLS policies (remove NULL escape hatch)<br>4. Enable FORCE RLS on patient tables | Section 3, 4 |
| `server/db/index.js` | 1. Add `statementTimeoutMs` parameter to `queryWithUser()`<br>2. Add `withUserTransaction(userId, callback)` helper | Section 5.1, 5.2 |
| `server/services/reportPersistence.js` | 1. Add `userId` to function signature<br>2. Set RLS context after BEGIN<br>3. Update `upsertPatient()` to include `user_id` column<br>4. Change conflict target to `(user_id, full_name_normalized)` | Section 3.1, 8.4 |
| `server/services/labReportProcessor.js` | Add `userId` parameter, pass to persistLabReport | Section 8.3 |
| `server/routes/analyzeLabReport.js` | 1. Add `requireAuth` middleware to upload endpoints<br>2. Fix `createBatch()` signature to match codebase<br>3. **ADD OWNERSHIP CHECKS** to `/jobs/:jobId` and `/batches/:batchId` | Section 8.1, 8.2 |
| `server/routes/reports.js` | 1. Add `requireAuth` to all routes<br>2. Pass `userId` to reportRetrieval functions | Section 6.1 |
| `server/services/reportRetrieval.js` | 1. Add `userId` parameter to all functions<br>2. Use `withUserTransaction()` for multi-query flows | Section 6.2 |
| `server/routes/executeSql.js` | 1. Add `requireAuth` middleware<br>2. Replace `pool.query` with `queryWithUser()` | Section 7.1 |
| `server/routes/sqlGenerator.js` | 1. **ADD `requireAuth` middleware**<br>2. Update `executeDataQuery()` to use `queryWithUser()` with timeout<br>3. Update `countTotalRows()` to use `queryWithUser()` | Section 8.6 |
| `server/services/agenticTools.js` | Update `executeExploratorySql()` to extract `userId` from options and use `queryWithUser()` | Section 9.2.1 |
| `server/services/agenticCore.js` | 1. Update `executeToolCall()` to pass `userId` in options<br>2. Update `buildSystemPrompt()` to accept `userId` and use `queryWithUser()` for lines 98, 151 | Section 9.2.2, 9.3 |
| `server/routes/chatStream.js` | 1. Add `requireAuth` to all 4 endpoints<br>2. Add session-user binding validation<br>3. Pass `userId` to `executeToolCall()` | Section 9.4 |
| `server/utils/sessionManager.js` | Add `userId: null` field to session object | Section 9.5 |
| `server/routes/gmailDev.js` | 1. Add `requireAuth`<br>2. Fix `createBatch()` signature<br>3. Thread `userId` through to lab processor | Section 8.5, 10 |

---

## 12. Summary: Endpoints Requiring User Scoping

### Protected with RLS-scoped queries:

| Endpoint | Method | File | RLS Scoping Method |
|----------|--------|------|--------------------|
| `/api/patients/:patientId/reports` | GET | `routes/reports.js` | `withUserTransaction()` (via reportRetrieval) |
| `/api/reports` | GET | `routes/reports.js` | `withUserTransaction()` (via reportRetrieval) |
| `/api/reports/patients` | GET | `routes/reports.js` | `withUserTransaction()` (via reportRetrieval) |
| `/api/reports/:reportId` | GET | `routes/reports.js` | `withUserTransaction()` (via reportRetrieval) |
| `/api/reports/:reportId/original-file` | GET | `routes/reports.js` | `withUserTransaction()` (via reportRetrieval) |
| `/api/analyze-labs` | POST | `routes/analyzeLabReport.js` | Transaction `set_config` (via reportPersistence) |
| `/api/analyze-labs/batch` | POST | `routes/analyzeLabReport.js` | Transaction `set_config` (via reportPersistence) |
| **`/api/analyze-labs/jobs/:jobId`** | **GET** | **`routes/analyzeLabReport.js`** | **Ownership check: `job.userId === req.user.id`** |
| **`/api/analyze-labs/batches/:batchId`** | **GET** | **`routes/analyzeLabReport.js`** | **Ownership check: `batch.userId === req.user.id`** |
| `/api/execute-sql` | POST | `routes/executeSql.js` | `queryWithUser()` |
| `/api/sql-generator` | POST | `routes/sqlGenerator.js` | `queryWithUser()` with timeout (executeDataQuery + countTotalRows) |
| `/api/chat/sessions` | POST | `routes/chatStream.js` | Session bound to `req.user.id` |
| `/api/chat/stream` | GET (SSE) | `routes/chatStream.js` | `queryWithUser()` via tool execution + session validation |
| `/api/chat/messages` | POST | `routes/chatStream.js` | Session validation |
| `/api/chat/sessions/:sessionId` | DELETE | `routes/chatStream.js` | Session validation |
| `/api/dev-gmail/fetch` | POST | `routes/gmailDev.js` | Transaction `set_config` (via lab pipeline) |
| `/api/dev-gmail/ingest` | POST | `routes/gmailDev.js` | Transaction `set_config` (via lab pipeline) |

**Note:** All report-related endpoints (`/api/reports*`) are used by the UI for:
- Reports browser (filter/list view)
- Patient selector dropdown
- Report detail view
- Original file download

### Bypass RLS (Admin Only):

| Endpoint | Method | Uses `queryAsAdmin()` |
|----------|--------|----------------------|
| `/api/admin/pending-analytes` | GET | Yes |
| `/api/admin/ambiguous-matches` | GET | Yes |
| `/api/admin/*` | All | Yes |

### Unauthenticated Endpoints (No requireAuth):

These endpoints remain accessible without authentication to support health checks, monitoring, and static assets:

| Endpoint | Purpose | Notes |
|----------|---------|-------|
| `/health` | Health check | Used by monitoring/Docker health checks |
| `/health/db` | Database health check | Used by monitoring |
| `/public/*` | Static assets | CSS, JS, images (Express static middleware) |
| `/api/dev-gmail/status` | Feature flag check | Allows frontend to check if Gmail integration is enabled (comes before `featureFlagGuard`) |

**Part 4 Note**: Part 4 will add `/login.html` and auth endpoints (`/api/auth/*`) as unauthenticated.

---

## 13. Testing Strategy

**Note on Test Examples**: The test code below uses helper functions (`createTestUser`, `loginAsUser`, `createPatientAsUser`, `createReportForPatient`) that **do not yet exist** in the codebase. These are pseudo-code examples showing the testing approach. Before implementing these tests:

1. Create auth test helpers in `test/helpers/auth.js`:
   - `createTestUser(email)` - Register user and return user object
   - `loginAsUser(email)` - Authenticate and return session cookie
2. Create data test helpers in `test/helpers/data.js`:
   - `createPatientAsUser(userId, fullName)` - Create patient with RLS context
   - `createReportForPatient(patientId)` - Upload test report

Alternatively, for MVP testing in dev mode, perform manual QA instead of automated tests.

**Note on Line Numbers**: Line numbers referenced in code samples (e.g., "line ~98") are approximate and may differ in actual implementation.

### 13.1 Data Isolation Tests

**Critical:** Verify users cannot see each other's data.

```javascript
describe('RLS Data Isolation', () => {
  let user1, user2, user1Session, user2Session;

  beforeAll(async () => {
    // Create two users
    user1 = await createTestUser('user1@example.com');
    user2 = await createTestUser('user2@example.com');

    // Login both
    user1Session = await loginAsUser(user1.email);
    user2Session = await loginAsUser(user2.email);
  });

  test('user1 cannot see user2 reports', async () => {
    // Create patient with report for user2
    const patient2 = await createPatientAsUser(user2.id, 'User2 Patient');
    const report2 = await createReportForPatient(patient2.id);

    // User1 tries to fetch all reports
    const res = await request(app)
      .get('/api/reports')
      .set('Cookie', user1Session);

    expect(res.status).toBe(200);
    expect(res.body.find(r => r.id === report2.id)).toBeUndefined();
  });

  test('user1 cannot access user2 patient reports by ID', async () => {
    const patient2 = await createPatientAsUser(user2.id, 'User2 Patient');

    const res = await request(app)
      .get(`/api/patients/${patient2.id}/reports`)
      .set('Cookie', user1Session);

    expect(res.status).toBe(404); // RLS makes this look like it doesn't exist
    expect(res.body.error).toBe('Patient not found');
  });

  test('agentic SQL respects RLS', async () => {
    await createPatientAsUser(user1.id, 'User1 Patient');
    await createPatientAsUser(user2.id, 'User2 Patient');

    // User1 asks "show all patients"
    const res = await request(app)
      .post('/api/sql-generator')
      .set('Cookie', user1Session)
      .send({ question: 'show all patients' });

    expect(res.status).toBe(200);
    // Should only return User1's patient
    expect(res.body.results.length).toBe(1);
    expect(res.body.results[0].full_name).toBe('User1 Patient');
  });
});
```

---

### 13.2 Lab Ingestion with RLS

```javascript
describe('Lab ingestion with RLS context', () => {
  test('creates patient/report/results with correct user_id', async () => {
    const user = await createTestUser('test@example.com');
    const session = await loginAsUser(user.email);

    const res = await request(app)
      .post('/api/analyze-labs')
      .set('Cookie', session)
      .attach('analysisFile', './test/fixtures/lab_report.pdf');

    expect(res.status).toBe(200);

    // Verify patient has correct user_id
    const patient = await pool.query(
      'SELECT user_id FROM patients WHERE id = $1',
      [res.body.patientId]
    );

    expect(patient.rows[0].user_id).toBe(user.id);
  });

  test('ingestion fails if RLS context not set', async () => {
    // Simulate missing context (should not happen in production)
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // DON'T set context

      await expect(
        client.query(
          `INSERT INTO patients (full_name, date_of_birth, gender, user_id)
           VALUES ($1, $2, $3, $4)`,
          ['Test', '1990-01-01', 'M', randomUserId]
        )
      ).rejects.toThrow(); // RLS WITH CHECK fails

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
```

---

### 13.3 Behavioral Regression Tests

```javascript
describe('Part 3: No functional regressions', () => {
  test('authenticated users can still upload reports', async () => {
    const session = await loginAsTestUser();

    const res = await request(app)
      .post('/api/analyze-labs')
      .set('Cookie', session)
      .attach('analysisFile', './test/fixtures/lab_report.pdf');

    expect(res.status).toBe(200);
  });

  test('authenticated users can still query via chat', async () => {
    const session = await loginAsTestUser();

    const res = await request(app)
      .post('/api/sql-generator')
      .set('Cookie', session)
      .send({ question: 'show my cholesterol trends' });

    expect(res.status).toBe(200);
    expect(res.body.sql).toBeDefined();
    expect(res.body.results).toBeDefined();
  });
});
```

---

## 14. Deployment Checklist

### Pre-Deployment

- [ ] **CLEAR DEVELOPMENT DATABASE**: All existing dev data will be inaccessible after FORCE RLS
  - Option A: Drop and recreate database: `./scripts/setup_db.sh`
  - Option B: Admin panel → Reset Database
- [ ] Review all code touchpoints (Section 8)
- [ ] Update `server/db/schema.js` with FORCE RLS policies
- [ ] Run full test suite (`npm test`)
- [ ] Prepare rollback plan (remove FORCE, restore NULL escape hatch)

### Deployment Steps

1. **Clear database** (dev context - no data preservation needed)
2. **Deploy code changes**: Updated routes, persistence layer, SQL execution, session management
3. **Apply schema update**: Run `npm run dev` (auto-applies FORCE RLS)
4. **Verify RLS enforcement**:
   ```sql
   SELECT relname, relforcerowsecurity
   FROM pg_class
   WHERE relname IN ('patients', 'patient_reports', 'lab_results');
   ```
5. **Run data isolation tests**: Verify users can't see each other's data
6. **Monitor logs**: Check for RLS policy violations (should be none)

### Post-Deployment Validation

- [ ] Two test users cannot see each other's patients
- [ ] Lab report upload still works (with authentication)
- [ ] Agentic SQL queries return only current user's data
- [ ] Admin endpoints still work (using `queryAsAdmin()`)
- [ ] No RLS policy violation errors in logs

---

## 15. Rollback Plan

If Part 3 causes issues:

```sql
-- Remove FORCE (allow owners to bypass RLS temporarily)
ALTER TABLE patients DISABLE ROW LEVEL SECURITY;
ALTER TABLE patient_reports DISABLE ROW LEVEL SECURITY;
ALTER TABLE lab_results DISABLE ROW LEVEL SECURITY;

-- Restore NULL escape hatch policies
DROP POLICY user_isolation_patients ON patients;
CREATE POLICY user_isolation_patients ON patients
  FOR ALL
  USING (
    user_id IS NULL
    OR user_id = current_setting('app.current_user_id', true)::uuid
  );
-- (Repeat for other tables)
```

Then redeploy previous code version.

---

## 16. What's Next?

**Part 4 (Frontend Auth UI + Route Protection)** will:
- Add login page (`login.html`)
- Add auth client library (`public/js/auth.js`)
- Add user header component (logout button, avatar)
- Redirect unauthenticated users to login page
- Handle SSE 401s in chat (reconnect after login)
- Protect HTML routes (redirect to `/login.html` if not authenticated)

**Part 3 output**: Fully secured backend with database-level data isolation. Ready for login UI in Part 4.
