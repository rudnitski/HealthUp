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

### Key Constraint

**Security improvement without UI changes.** Routes now require authentication (`requireAuth` middleware), but the UI behavior is unchanged—authenticated users see their data, unauthenticated users get 401s (Part 4 will add login UI to handle this gracefully).

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

## 3. Enable FORCE ROW LEVEL SECURITY

### 3.1 Update RLS Policies (Remove NULL Escape Hatch)

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

**Add to `server/db/schema.js`** alongside existing RLS definitions.

**Verification:**
```sql
-- Check FORCE is applied
SELECT relname, relforcerowsecurity
FROM pg_class
WHERE relname IN ('patients', 'patient_reports', 'lab_results');
-- All should show relforcerowsecurity = true
```

---

## 4. Patient Routes Migration

### 4.1 GET /api/patients

**Before (Part 2):**
```javascript
app.get('/api/patients', async (req, res) => {
  const result = await pool.query('SELECT * FROM patients');
  res.json(result.rows);
});
```

**After (Part 3):**
```javascript
import { requireAuth } from '../middleware/auth.js';
import { queryWithUser } from '../db/index.js';

app.get('/api/patients', requireAuth, async (req, res) => {
  // queryWithUser sets RLS context - database automatically filters
  const result = await queryWithUser(
    'SELECT id, full_name, date_of_birth, gender FROM patients ORDER BY full_name',
    [],
    req.user.id
  );

  res.json(result.rows);
});
```

**Security:** RLS policy ensures only current user's patients returned, even if query omits `WHERE user_id`.

---

### 4.2 GET /api/patients/:patientId/reports

**Before (Part 2):**
```javascript
app.get('/api/patients/:patientId/reports', async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM patient_reports WHERE patient_id = $1',
    [req.params.patientId]
  );
  res.json(result.rows);
});
```

**After (Part 3):**
```javascript
app.get('/api/patients/:patientId/reports', requireAuth, async (req, res) => {
  const { patientId } = req.params;

  // RLS automatically filters - if patient doesn't belong to user, query returns 0 rows
  const patientCheck = await queryWithUser(
    'SELECT id FROM patients WHERE id = $1',
    [patientId],
    req.user.id
  );

  if (patientCheck.rows.length === 0) {
    // Patient either doesn't exist OR doesn't belong to current user
    // RLS makes these indistinguishable (prevents information leakage)
    return res.status(404).json({
      error: 'Patient not found',
      code: 'PATIENT_NOT_FOUND'
    });
  }

  // Patient belongs to user - fetch reports (RLS also filters patient_reports)
  const reports = await queryWithUser(
    `SELECT id, patient_id, report_date, file_path, created_at
     FROM patient_reports
     WHERE patient_id = $1
     ORDER BY report_date DESC`,
    [patientId],
    req.user.id
  );

  res.json(reports.rows);
});
```

**Security Note:** Attempting to access another user's patient returns 404 (same as non-existent patient). This prevents attackers from probing for valid patient IDs.

---

## 5. Lab Report Processing Pipeline

### 5.1 Complete Pipeline with RLS Context

When processing lab reports, the pipeline inserts into three RLS-protected tables: `patients`, `patient_reports`, and `lab_results`. **RLS context must be set ONCE at the start of the transaction and applies to ALL subsequent operations.**

**CRITICAL**: The same `set_config` context is required for ALL database operations in the pipeline—not just patient creation. RLS policies on `patient_reports` and `lab_results` use `FOR ALL` which includes INSERT operations.

```javascript
// File: server/services/labReportProcessor.js

import { pool } from '../db/index.js';

/**
 * Helper to set RLS context within a transaction.
 * The third parameter (true) makes this transaction-scoped—
 * it persists until COMMIT/ROLLBACK and applies to ALL operations.
 */
async function setUserContext(client, userId) {
  await client.query(
    "SELECT set_config('app.current_user_id', $1, true)",
    [userId]
  );
}

/**
 * Complete lab report processing pipeline with RLS context.
 * Demonstrates that setUserContext must be called ONCE and covers:
 * 1. patients table (SELECT + INSERT)
 * 2. patient_reports table (INSERT)
 * 3. lab_results table (INSERT)
 */
async function processLabReport(extractedData, filePath, req) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ✅ CRITICAL: Set RLS context ONCE for entire transaction
    // This single call enables RLS access for ALL three tables below
    await setUserContext(client, req.user.id);

    // ─────────────────────────────────────────────────────────────
    // Step 1: Create or find patient (patients table - RLS applies)
    // ─────────────────────────────────────────────────────────────
    const existing = await client.query(
      `SELECT id FROM patients WHERE full_name = $1`,
      [extractedData.patientName]
    );

    let patientId;
    if (existing.rows.length > 0) {
      patientId = existing.rows[0].id;
    } else {
      // RLS WITH CHECK validates user_id matches current context
      const result = await client.query(
        `INSERT INTO patients (full_name, date_of_birth, gender, user_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [
          extractedData.patientName,
          extractedData.dateOfBirth,
          extractedData.gender,
          req.user.id  // Must match RLS context
        ]
      );
      patientId = result.rows[0].id;
    }

    // ─────────────────────────────────────────────────────────────
    // Step 2: Create patient report (patient_reports table - RLS applies)
    // ─────────────────────────────────────────────────────────────
    // RLS policy checks: patient_id must belong to current user
    // This works because we set context above and patient was just created/verified
    const reportResult = await client.query(
      `INSERT INTO patient_reports (patient_id, report_date, file_path, checksum)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [patientId, extractedData.reportDate, filePath, extractedData.checksum]
    );
    const reportId = reportResult.rows[0].id;

    // ─────────────────────────────────────────────────────────────
    // Step 3: Create lab results (lab_results table - RLS applies)
    // ─────────────────────────────────────────────────────────────
    // RLS policy checks: report_id must belong to a report owned by current user
    // This works because the report was just created in Step 2
    for (const param of extractedData.parameters) {
      await client.query(
        `INSERT INTO lab_results (report_id, parameter_name, value, unit, reference_low, reference_high)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [reportId, param.name, param.value, param.unit, param.refLow, param.refHigh]
      );
    }

    await client.query('COMMIT');
    return { patientId, reportId };

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
```

**Why set_config is required for ALL writes in the pipeline:**

| Table | RLS Policy Type | What RLS Checks on INSERT |
|-------|-----------------|---------------------------|
| `patients` | Direct `user_id` check | `user_id` matches `app.current_user_id` |
| `patient_reports` | FK chain via `patient_id` | `patient_id` belongs to a patient owned by current user |
| `lab_results` | FK chain via `report_id` | `report_id` belongs to a report whose patient is owned by current user |

**Key points:**
- `set_config(..., true)` is **transaction-scoped**—set it once after BEGIN
- Without context set, ALL three INSERT operations will fail with RLS policy violations
- The FK-chain policies on `patient_reports` and `lab_results` still require context to evaluate the ownership check
- RLS context does NOT automatically propagate from the `patients` INSERT—it must be explicitly set

---

### 5.2 Update Route Handler

```javascript
// File: server/routes/analyze.js

app.post('/api/analyze-labs', requireAuth, upload.single('analysisFile'), async (req, res) => {
  // Existing OCR extraction logic...

  // Process with RLS context (req.user populated by requireAuth)
  const result = await processLabReport(extractedData, filePath, req);

  res.json(result);
});
```

---

## 6. Agentic SQL & Chat (CRITICAL)

### 6.1 Problem

**Agentic SQL generates queries from natural language.** Users could ask "show all patients" and potentially see everyone's data if RLS isn't enforced.

### 6.2 Solution: RLS at Database Level

| Approach | Security | Complexity | LLM Safety |
|----------|----------|------------|------------|
| Prompt engineering | Weak (LLM can be tricked) | Low | Unsafe |
| Application SQL rewriting | Medium (bugs possible) | High | Partially safe |
| **PostgreSQL RLS** | **Strong (DB enforced)** | **Low** | **Fully safe** |

With RLS:
- Even if LLM generates `SELECT * FROM patients` (no filter), database returns only current user's patients
- Prompt injection attacks cannot bypass database-level security
- No complex SQL parsing/rewriting code to maintain
- Single point of security enforcement

---

### 6.3 Set Session Context Before SQL Execution

```javascript
// File: server/services/agenticCore.js (or SQL execution helper)

import { pool } from '../db/index.js';

/**
 * Execute user-scoped SQL (agentic SQL generation)
 * Sets RLS context before executing LLM-generated query
 */
export async function executeUserScopedSQL(sqlQuery, userId) {
  const client = await pool.connect();
  try {
    // Set RLS context
    await client.query(
      "SELECT set_config('app.current_user_id', $1, true)",
      [userId]
    );

    // Execute LLM-generated query
    // RLS policies automatically filter results to current user's data
    const result = await client.query(sqlQuery);

    return result.rows;

  } finally {
    client.release();
  }
}
```

---

### 6.4 Chat Streaming Endpoint

```javascript
// File: server/routes/chatStream.js

import { requireAuth } from '../middleware/auth.js';
import { executeUserScopedSQL } from '../services/agenticCore.js';

router.get('/api/chat/stream', requireAuth, async (req, res) => {
  const { sessionId } = req.query;

  // SSE setup...

  // When LLM generates SQL, execute with user scoping
  const results = await executeUserScopedSQL(llmGeneratedSQL, req.user.id);

  // Stream results back...
});
```

**Security:** LLM can generate any SQL, but RLS ensures only current user's data is returned.

---

### 6.5 Legacy SQL Generator Endpoint

```javascript
// File: server/routes/sqlGenerator.js

app.post('/api/sql-generator', requireAuth, async (req, res) => {
  const { question } = req.body;

  // Agentic SQL generation (with fuzzy search tools, etc.)
  const { sql, plotMetadata } = await generateSQL(question, req.user.id);

  // Execute with RLS context
  const results = await executeUserScopedSQL(sql, req.user.id);

  res.json({ sql, results, plotMetadata });
});
```

---

## 7. Gmail Integration Endpoints

Gmail integration endpoints already authenticated and scoped correctly—no changes needed for Part 3 beyond adding `requireAuth`:

```javascript
// File: server/routes/gmailDev.js

import { requireAuth } from '../middleware/auth.js';

router.post('/api/dev-gmail/fetch', requireAuth, async (req, res) => {
  // Gmail OAuth flow uses req.user.id for provenance tracking
  // Lab ingestion pipeline already handles RLS context (Section 5)
});
```

**Security:** Gmail-ingested reports associate with current user via lab processing pipeline.

---

## 8. Summary: Endpoints Requiring User Scoping

### Protected with `queryWithUser()` or `executeUserScopedSQL()`:

| Endpoint | Method | RLS Scoping Method |
|----------|--------|--------------------|
| `/api/patients` | GET | `queryWithUser()` |
| `/api/patients/:id` | GET | `queryWithUser()` |
| `/api/patients/:id/reports` | GET | `queryWithUser()` |
| `/api/analyze-labs` | POST | Transaction `set_config` |
| `/api/sql-generator` | POST | `executeUserScopedSQL()` |
| `/api/chat/stream` | GET (SSE) | `executeUserScopedSQL()` |
| `/api/dev-gmail/*` | POST/GET | Transaction `set_config` (via lab pipeline) |

### Bypass RLS (Admin Only):

| Endpoint | Method | Uses `queryAsAdmin()` |
|----------|--------|----------------------|
| `/api/admin/pending-analytes` | GET | Yes |
| `/api/admin/ambiguous-matches` | GET | Yes |
| `/api/admin/*` | All | Yes |

---

## 9. Testing Strategy

### 9.1 Data Isolation Tests

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

  test('user1 cannot see user2 patients', async () => {
    // Create patient for user2
    const patient2 = await createPatientAsUser(user2.id, 'User2 Patient');

    // User1 tries to fetch all patients
    const res = await request(app)
      .get('/api/patients')
      .set('Cookie', user1Session);

    expect(res.status).toBe(200);
    expect(res.body.find(p => p.id === patient2.id)).toBeUndefined();
  });

  test('user1 cannot access user2 patient by ID', async () => {
    const patient2 = await createPatientAsUser(user2.id, 'User2 Patient');

    const res = await request(app)
      .get(`/api/patients/${patient2.id}`)
      .set('Cookie', user1Session);

    expect(res.status).toBe(404); // RLS makes this look like it doesn't exist
    expect(res.body.code).toBe('PATIENT_NOT_FOUND');
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

### 9.2 Lab Ingestion with RLS

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

### 9.3 Behavioral Regression Tests

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

## 10. Deployment Checklist

### Pre-Deployment

- [ ] Review all route changes (patient, report, SQL generator, chat)
- [ ] Update `server/db/schema.js` with FORCE RLS policies
- [ ] Run full test suite (`npm test`)
- [ ] Prepare rollback plan (remove FORCE, restore NULL escape hatch)

### Deployment Steps

1. **Deploy code changes**: Updated routes, pipeline, SQL execution
2. **Apply schema update**: Run `npm run dev` (auto-applies FORCE RLS)
3. **Verify RLS enforcement**:
   ```sql
   SELECT relname, relforcerowsecurity
   FROM pg_class
   WHERE relname IN ('patients', 'patient_reports', 'lab_results');
   ```
4. **Run data isolation tests**: Verify users can't see each other's data
5. **Monitor logs**: Check for RLS policy violations (should be none)

### Post-Deployment Validation

- [ ] Two test users cannot see each other's patients
- [ ] Lab report upload still works (with authentication)
- [ ] Agentic SQL queries return only current user's data
- [ ] Admin endpoints still work (using `queryAsAdmin()`)
- [ ] No RLS policy violation errors in logs

---

## 11. Rollback Plan

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

## 12. What's Next?

**Part 4 (Frontend Auth UI + Route Protection)** will:
- Add login page (`login.html`)
- Add auth client library (`public/js/auth.js`)
- Add user header component (logout button, avatar)
- Redirect unauthenticated users to login page
- Handle SSE 401s in chat (reconnect after login)
- Protect HTML routes (redirect to `/login.html` if not authenticated)

**Part 3 output**: Fully secured backend with database-level data isolation. Ready for login UI in Part 4.
