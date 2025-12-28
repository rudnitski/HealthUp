# PRD v4.4.1: Authentication - Part 1: Schema + RLS Groundwork

**Status:** Ready for Implementation
**Created:** 2025-12-27
**Author:** System (Claude Code)
**Target Release:** v4.4.1
**Part:** 1 of 4

---

## 1. Overview

### Purpose

Part 1 establishes the **database foundation** for authentication without changing application behavior. This includes:

1. New tables: `users`, `user_identities`, `sessions`, `audit_logs`
2. Schema update: Add `user_id` to `patients` table
3. PostgreSQL Row-Level Security (RLS) policies (created but not enforced yet)
4. Database role separation: `healthup_owner`, `healthup_app`, `healthup_admin`
5. New environment variable: `ADMIN_DATABASE_URL`

### Key Constraint

**No runtime behavior change.** The application continues to work exactly as before. RLS policies are created but not forcefully applied—this prevents breaking existing queries that don't set RLS context yet.

### Success Criteria

✅ All schema changes applied successfully (4 new tables + `patients.user_id` column)
✅ RLS policies created (not forced) for all data tables: patients, patient_reports, lab_results, audit_logs, sessions
✅ Audit logs locked down (admin-only access via BYPASSRLS)
✅ Sessions isolated (users can only see their own sessions, no NULL escape hatch)
✅ User deletion guard trigger active (blocks user deletion during Parts 1-3)
✅ Database roles configured (`healthup_owner`, `healthup_app`, `healthup_admin`)
✅ `resetDatabase()` updated with new table drop statements
✅ Existing application functionality unchanged
✅ Tests pass: schema validation, RLS policy checks, role permissions
✅ Known security gaps documented (v_measurements view, user deletion risk)

---

## 2. Database Schema Changes

### 2.1 New Table: `users`

Master table for user accounts (provider-agnostic).

```sql
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name TEXT NOT NULL,
  primary_email CITEXT UNIQUE,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);
```

**Design Decisions:**
- No password fields → OAuth only (Google for MVP)
- `primary_email` is nullable → Future-proofs for Apple Sign In with private relay
- `primary_email` uses CITEXT type → Case-insensitive uniqueness (prevents duplicate accounts like test@example.com vs Test@example.com)
- Application SHOULD normalize emails to lowercase for consistency, but database enforces case-insensitive constraint
- `display_name` from OAuth provider (Google: `name` claim)
- `avatar_url` from OAuth provider (Google: `picture` claim)
- No explicit index on `primary_email` → UNIQUE constraint automatically creates btree index

---

### 2.2 New Table: `user_identities`

Stores OAuth identities. One-to-many relationship: one user can link multiple providers (Google, Apple, etc.).

```sql
CREATE TABLE IF NOT EXISTS user_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'apple', 'email')),
  provider_subject TEXT NOT NULL,
  email TEXT,
  email_verified BOOLEAN DEFAULT FALSE,
  profile_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,

  UNIQUE(provider, provider_subject)
);

CREATE INDEX IF NOT EXISTS idx_user_identities_user_id ON user_identities(user_id);
```

**Design Decisions:**
- `UNIQUE(provider, provider_subject)` → Prevents duplicate OAuth accounts (automatically creates index, no explicit index needed)
- `profile_data` JSONB → Flexible storage for provider-specific metadata
- `ON DELETE CASCADE` → Deleting user deletes all their identities
- `provider` constrained to known values via CHECK constraint

---

### 2.3 New Table: `sessions`

Database-backed session storage (not JWT). Allows server-side revocation.

```sql
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  ip_address TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_revoked_at ON sessions(revoked_at) WHERE revoked_at IS NOT NULL;
```

**Design Decisions:**
- `expires_at` is absolute (not rolling) → Simpler implementation, encourages periodic re-authentication
- Partial indexes on `expires_at` and `revoked_at` → Optimizes cleanup queries
- Store `ip_address` and `user_agent` → Audit trail for security monitoring

---

### 2.4 New Table: `audit_logs`

Append-only audit trail for security events.

```sql
CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
```

**Audit Events (to be logged in future parts):**
- `LOGIN_SUCCESS`, `LOGIN_FAILED`, `LOGOUT`, `SESSION_EXPIRED`
- `PATIENT_VIEWED`, `REPORT_UPLOADED`, `REPORT_VIEWED`
- `ADMIN_ACTION` (for admin panel operations)

**Design Decisions:**
- `user_id` nullable → Log events before user creation (e.g., failed login attempts)
- `metadata` JSONB → Flexible storage for event-specific data
- `ON DELETE SET NULL` → Preserve audit trail even if user deleted

---

### 2.5 Schema Update: `patients.user_id`

Associate patients with users.

```sql
ALTER TABLE patients ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_patients_user_id ON patients(user_id);
```

**Migration Strategy:**
- **Development**: Since HealthUp is not in production, drop and recreate database cleanly
- **Alternative**: Keep existing data with `user_id = NULL`, assign manually later
- **Future**: All new patients will have `user_id` populated on creation

---

## 3. Row-Level Security (RLS) Policies

### 3.1 What is RLS?

PostgreSQL Row-Level Security enforces data isolation at the **database level**. Even if application code (or LLM-generated SQL) omits user filters, the database automatically restricts results to the current user's data.

**How it works:**
1. Application sets session context: `SET LOCAL app.current_user_id = 'user-uuid'`
2. Policies automatically filter all queries based on this context
3. Cannot be bypassed by SQL injection, application bugs, or LLM hallucinations

---

### 3.2 Create RLS Policies (Not Forced Yet)

**IMPORTANT**: Part 1 creates policies but does NOT force them yet. This prevents breaking existing queries that don't set RLS context.

```sql
-- Enable RLS on patient data tables (but don't FORCE yet)
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_results ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (idempotency for schema auto-apply on boot)
DROP POLICY IF EXISTS user_isolation_patients ON patients;
DROP POLICY IF EXISTS user_isolation_reports ON patient_reports;
DROP POLICY IF EXISTS user_isolation_lab_results ON lab_results;

-- RLS Policy Contract (app.current_user_id):
-- App layer MUST set either:
--   1. Valid UUID string via SET LOCAL app.current_user_id = '<uuid>'
--   2. Empty string (default for unset context)
-- Malformed UUIDs will error (fail-safe behavior).
-- The NULLIF wrapper is defensive but app should validate before setting.

-- Policy: users can only see their own patients
CREATE POLICY user_isolation_patients ON patients
  FOR ALL
  USING (
    user_id IS NULL  -- Allow NULL during transition (unauthenticated access)
    OR user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
  );

-- Policy: users can only see reports for their patients
CREATE POLICY user_isolation_reports ON patient_reports
  FOR ALL
  USING (
    patient_id IN (
      SELECT id FROM patients
      WHERE user_id IS NULL  -- Allow NULL during transition
        OR user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  );

-- Policy: users can only see lab results for their patients
CREATE POLICY user_isolation_lab_results ON lab_results
  FOR ALL
  USING (
    report_id IN (
      SELECT pr.id FROM patient_reports pr
      JOIN patients p ON pr.patient_id = p.id
      WHERE p.user_id IS NULL  -- Allow NULL during transition
        OR p.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  );
```

**Why not FORCE in Part 1?**
- `FORCE ROW LEVEL SECURITY` would block table owners from accessing data without setting context
- Existing app routes don't set `app.current_user_id` context yet (Part 3 adds this)
- Policies allow `user_id IS NULL` as escape hatch during transition
- Part 3 will remove NULL checks and apply FORCE after routes are updated

---

### 3.2.1 RLS Policies for Audit Logs and Sessions

**Security Gap Prevention**: Even though the app doesn't intentionally query `audit_logs` or `sessions` tables in Part 1, the `healthup_app` role receives SELECT permissions on all tables. This creates a risk: agentic SQL generation could accidentally expose global audit/session data.

**Solution**: Lock down these tables immediately with restrictive RLS policies.

```sql
-- Audit logs: Admin-only access
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_logs_admin_only ON audit_logs
  FOR ALL
  USING (false);
```

**Explanation**:
- `USING (false)` blocks all access for the `healthup_app` role
- Only `healthup_admin` (with BYPASSRLS privilege) can query audit logs
- Prevents LLM-generated SQL from accessing sensitive security data
- Can be relaxed in Part 3 if needed (e.g., users viewing their own audit trail)

```sql
-- Sessions: Users can only see their own sessions
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY session_isolation ON sessions
  FOR ALL
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
```

**Explanation**:
- Users can only access sessions where `user_id` matches their context
- **No NULL escape hatch**: Sessions always have `user_id` (required by foreign key)
- Stricter than patient data policies (which allow NULL during transition)
- Prevents session enumeration attacks via LLM-generated queries

---

### 3.3 The `current_setting` Function and NULLIF Hardening

```sql
NULLIF(current_setting('app.current_user_id', true), '')::uuid
```

**Function Breakdown:**
- **`current_setting('app.current_user_id', true)`**:
  - First parameter: Setting name (namespaced with `app.` prefix)
  - Second parameter (`true`): Return NULL instead of error if not set
- **`NULLIF(..., '')`**: Converts empty strings to NULL before UUID cast
  - Prevents `ERROR: invalid input syntax for type uuid: ""` if setting is set to empty string
  - Returns NULL if setting is unset OR empty
- **`::uuid`**: Safely casts to UUID only when value is NULL or valid UUID string

**Application Contract (Strict):**

The app layer **MUST** set `app.current_user_id` to one of two values:
1. **Valid UUID string**: `SET LOCAL app.current_user_id = '<valid-uuid>'`
2. **Unset** (uses default empty string): Don't set the variable, or use `RESET app.current_user_id`

**Invalid values will cause query failures:**
- Malformed UUIDs (e.g., "abc", "not-a-uuid") → `ERROR: invalid input syntax for type uuid`
- This is **intentional fail-safe behavior** - better to error than leak data
- The `NULLIF(..., '')::uuid` wrapper is defensive, but app MUST validate before setting

**Clearing context:**
- ✅ **Correct**: `RESET app.current_user_id` (resets to default empty string)
- ❌ **Wrong**: `SET app.current_user_id = ''` (works but unnecessary)
- ❌ **Never**: `SET app.current_user_id = 'null'` (literal string "null" is not valid UUID)

This strict contract ensures application-level bugs fail fast rather than silently bypass security.

---

### 3.4 Known RLS Gap: v_measurements View

**CRITICAL SECURITY CONCERN**: The existing `v_measurements` view (defined in `server/db/schema.js:378-399`) will bypass RLS policies once Part 3 switches the application to use the `healthup_app` role.

**Why this is a problem:**
- Views are owned by `healthup_owner` (the role that creates them)
- By default, PostgreSQL views execute with the permissions of the **view owner** (not the caller)
- When Part 3 switches the app to `healthup_app`, queries to `v_measurements` will run as `healthup_owner` and bypass RLS
- This creates an unintended data leak: users could access all patients' data through the view

**Mitigation Options (choose one for Part 3):**

**Option A: SECURITY INVOKER (PostgreSQL 15+)**
```sql
-- Part 3: Update view to use caller's permissions
CREATE OR REPLACE VIEW v_measurements
  WITH (security_invoker = true)
AS
  SELECT ... (existing view definition)
```

**Option B: Change View Ownership (PostgreSQL 14 and earlier)**
```sql
-- Part 3: Transfer view ownership to healthup_app
ALTER VIEW v_measurements OWNER TO healthup_app;
```

**Recommended Approach:**
- Use Option A (SECURITY INVOKER) if running PostgreSQL 15 or later (cleaner, more explicit)
- Use Option B if running PostgreSQL 14 or earlier
- Add test in Part 3 to verify view queries respect RLS when executed as `healthup_app`

**Part 1 Action**: No changes required. RLS is not enforced yet, so this gap doesn't affect Part 1. Document this as a known issue to be addressed in Part 3.

---

### 3.5 Known Risk: User Deletion During Transition

**DATA VISIBILITY WARNING**: The combination of `user_id IS NULL` escape hatch in RLS policies and `ON DELETE SET NULL` on `patients.user_id` creates a temporary security risk during Parts 1-3.

**The Problem:**
1. RLS policies intentionally allow `user_id IS NULL` to permit unauthenticated access during transition (see Section 3.2)
2. `patients.user_id` uses `ON DELETE SET NULL` (see Section 2.5)
3. If a user is deleted during Parts 1-2, their patients become orphaned with `user_id = NULL`
4. These orphaned patients then match the NULL escape hatch and become **globally readable**
5. This persists even after Part 3 enforces RLS (unless NULL checks are removed)

**Risk Scenario:**
```sql
-- Part 1-2: User creates patients
INSERT INTO users (...) VALUES (...) RETURNING id; -- user123
UPDATE patients SET user_id = 'user123' WHERE id = 'patient456';

-- User gets deleted (manually or via admin action)
DELETE FROM users WHERE id = 'user123';

-- Patient becomes orphaned (ON DELETE SET NULL triggers)
-- patients.user_id for patient456 is now NULL

-- RLS policy allows NULL → patient data is now globally visible!
SELECT * FROM patients WHERE id = 'patient456'; -- Anyone can see this
```

**Recommended Mitigation (Part 1):**

**Block user deletion entirely during transition period:**

Add to new `users` table creation:
```sql
-- Prevent user deletion during Parts 1-3 (remove in Part 4)
CREATE OR REPLACE FUNCTION prevent_user_deletion()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'User deletion is disabled during authentication migration (Parts 1-3). This restriction will be removed in Part 4.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER block_user_deletion
  BEFORE DELETE ON users
  FOR EACH ROW
  EXECUTE FUNCTION prevent_user_deletion();
```

**Alternative Mitigations (if deletion must be allowed):**
1. **Cascade delete**: Change `ON DELETE SET NULL` to `ON DELETE CASCADE` (deletes patients with user, data loss risk)
2. **Soft delete**: Add `deleted_at` column to users, never hard delete (recommended for production)
3. **Manual cleanup**: Accept orphaned data, clean up manually before Part 3 goes live

**Part 1 Implementation**: Include the `prevent_user_deletion()` trigger in schema. Part 4 will remove this trigger once proper user deletion logic is implemented.

---

## 4. Database Role Separation

### 4.1 Role Strategy

Three roles for separation of concerns:

| Role | Purpose | RLS Enforcement |
|------|---------|-----------------|
| `healthup_owner` | Schema owner, runs migrations | Bypasses RLS (owns tables) |
| `healthup_app` | Application role, handles requests | Subject to RLS |
| `healthup_admin` | Admin panel operations | Bypasses RLS (BYPASSRLS privilege) |

---

### 4.2 Role Setup (Run as superuser)

⚠️ **Production Security Note**: The examples below use hardcoded passwords for development convenience. For production deployments, use environment variables or password prompts to avoid leaking credentials into shell history:

```bash
# Production approach
read -s OWNER_PASSWORD
psql -c "CREATE ROLE healthup_owner WITH LOGIN PASSWORD '$OWNER_PASSWORD';"
```

```sql
-- 1. Create schema owner (runs migrations, owns tables)
-- Note: CREATE ROLE does NOT support IF NOT EXISTS
-- Use DO block with exception handling for idempotent role creation
DO $$
BEGIN
  CREATE ROLE healthup_owner WITH LOGIN PASSWORD 'owner_secure_password';
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'Role healthup_owner already exists, skipping.';
END $$;

-- 2. Create application user (used by running app, subject to RLS)
DO $$
BEGIN
  CREATE ROLE healthup_app WITH LOGIN PASSWORD 'app_secure_password';
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'Role healthup_app already exists, skipping.';
END $$;

-- 3. Create admin user (bypasses RLS for admin panel)
DO $$
BEGIN
  CREATE ROLE healthup_admin WITH LOGIN PASSWORD 'admin_secure_password' BYPASSRLS;
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'Role healthup_admin already exists, skipping.';
END $$;

-- 4. Grant permissions to app user (NOT table ownership)
GRANT USAGE ON SCHEMA public TO healthup_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO healthup_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO healthup_app;

-- 5. Grant same to admin user
GRANT USAGE ON SCHEMA public TO healthup_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO healthup_admin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO healthup_admin;

-- 6. Ensure future tables created by healthup_owner also get permissions
ALTER DEFAULT PRIVILEGES FOR USER healthup_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO healthup_app;
ALTER DEFAULT PRIVILEGES FOR USER healthup_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO healthup_admin;
ALTER DEFAULT PRIVILEGES FOR USER healthup_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO healthup_app;
ALTER DEFAULT PRIVILEGES FOR USER healthup_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO healthup_admin;
```

**Note**: Database must be owned by `healthup_owner` for default privileges to work. Use `CREATE DATABASE healthup OWNER healthup_owner ...` or run `ALTER DATABASE healthup OWNER TO healthup_owner` after creation.

---

### 4.3 Migrating Existing Databases (Ownership Transfer)

**IMPORTANT**: If you're applying Part 1 to an **existing database** with tables already created, the `ALTER DEFAULT PRIVILEGES` statements in Section 4.2 only affect **future objects**. Existing tables, views, and sequences may remain owned by `postgres` or another role, which will cause:
- Permission errors when `healthup_app` tries to access them
- RLS bypass issues (if objects are owned by roles other than `healthup_owner`)

**Required steps for existing databases:**

```sql
-- 1. Transfer ownership of all existing objects to healthup_owner
DO $$
DECLARE
  r RECORD;
BEGIN
  -- Transfer table ownership
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE 'ALTER TABLE public.' || quote_ident(r.tablename) || ' OWNER TO healthup_owner';
  END LOOP;

  -- Transfer view ownership
  FOR r IN SELECT viewname FROM pg_views WHERE schemaname = 'public'
  LOOP
    EXECUTE 'ALTER VIEW public.' || quote_ident(r.viewname) || ' OWNER TO healthup_owner';
  END LOOP;

  -- Transfer sequence ownership
  FOR r IN SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public'
  LOOP
    EXECUTE 'ALTER SEQUENCE public.' || quote_ident(r.sequence_name) || ' OWNER TO healthup_owner';
  END LOOP;
END $$;

-- 2. Explicitly grant permissions on existing objects (redundant with default privileges for new objects)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO healthup_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO healthup_admin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO healthup_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO healthup_admin;
```

**When to use this:**
- Applying Part 1 to a database that was created with `postgres` user or non-`healthup_owner` credentials
- Migrating from development to production environments
- Fixing permission errors after initial setup

---

### 4.4 Connection String Configuration

**Part 1**: Application uses `DATABASE_URL` with `healthup_owner` credentials for schema application and development operations.

**Future Parts**:
- Part 2 will add admin routes using `ADMIN_DATABASE_URL`
- Part 3 will switch main app to use `DATABASE_APP_URL` (healthup_app role)

---

## 5. Environment Variables

### 5.1 New Variable: `ADMIN_DATABASE_URL`

```bash
# .env
ADMIN_DATABASE_URL=postgresql://healthup_admin:admin_secure_password@localhost:5432/healthup
```

**Purpose**: Used by admin panel endpoints to bypass RLS (pending analytes, match reviews, etc.).

**Security**: Keep this credential restricted—only admin operations should use it.

---

### 5.2 New Variable: `DATABASE_APP_URL`

```bash
# .env
DATABASE_APP_URL=postgresql://healthup_app:app_secure_password@localhost:5432/healthup
```

**Purpose**: Will be used by the main application in Part 3 (RLS-enforced queries).

**Part 1 Note**: Not used by running app yet, but needed for role permission tests.

---

### 5.3 Update `.env.example`

**IMPORTANT**: Per repository guidelines (CLAUDE.md gotcha #17), when adding new environment variables to `.env`, you **must** also update `.env.example` to keep documentation in sync.

Add the following to `.env.example`:

```bash
# Authentication Database Roles (PRD v4.4.1)
# Part 1: DATABASE_URL should use healthup_owner credentials
# Part 3: Switch DATABASE_URL to healthup_app credentials, keeping DATABASE_APP_URL for reference
DATABASE_APP_URL=postgres://healthup_app:app_password@localhost:5432/healthup    # Application role (RLS-enforced)
ADMIN_DATABASE_URL=postgres://healthup_admin:admin_password@localhost:5432/healthup  # Admin role (bypasses RLS)
```

---

## 6. Schema Implementation

### 6.1 Update `server/db/schema.js`

**IMPORTANT**: The codebase uses a `schemaStatements` array pattern, NOT a single exported string. Add new statements to the existing array in `server/db/schema.js`.

**Extension Prerequisites:**
- **`pg_trgm`**, **`pgcrypto`**, and **`citext`** extensions are required
- `pg_trgm`: Fuzzy search for analyte mapping and agentic SQL
- `pgcrypto`: UUID generation (`gen_random_uuid()`)
- `citext`: Case-insensitive text type for email uniqueness (prevents duplicate accounts)
- These are created by `scripts/recreate_auth_db.sh` as superuser (Section 6.2)
- The existing `ensureSchema()` function in `server/db/schema.js` already attempts to create extensions on boot
- If extensions fail to create: Run the database recreation script or manually create them as superuser: `CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS citext;`

**File**: `server/db/schema.js`

Add the following statements to the `schemaStatements` array (around line 400, after existing tables):

```javascript
// Add to existing schemaStatements array in server/db/schema.js

const schemaStatements = [
  // ... existing table definitions ...

  // ============================================================
  // AUTHENTICATION TABLES (Part 1)
  // ============================================================
  `
  CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name TEXT NOT NULL,
    primary_email CITEXT UNIQUE,
    avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ
  );
  `,
  `
  COMMENT ON TABLE users IS 'User accounts (provider-agnostic)';
  `,
  `
  CREATE TABLE IF NOT EXISTS user_identities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('google', 'apple', 'email')),
    provider_subject TEXT NOT NULL,
    email TEXT,
    email_verified BOOLEAN DEFAULT FALSE,
    profile_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    UNIQUE(provider, provider_subject)
  );
  `,
  `
  COMMENT ON TABLE user_identities IS 'OAuth provider identities linked to user accounts';
  `,
  `
  CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    ip_address TEXT,
    user_agent TEXT
  );
  `,
  `
  COMMENT ON TABLE sessions IS 'Database-backed user sessions';
  `,
  `
  CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    resource_type TEXT,
    resource_id TEXT,
    ip_address TEXT,
    user_agent TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  `,
  `
  COMMENT ON TABLE audit_logs IS 'Security audit trail for user actions';
  `,
  // Add user_id to patients table
  `
  ALTER TABLE patients ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;
  `,
  `
  COMMENT ON COLUMN patients.user_id IS 'Associated user account. NULL for unauthenticated/legacy patients.';
  `,
  // RLS Policies (Part 1: created but not forced)
  `
  ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
  `,
  `
  ALTER TABLE patient_reports ENABLE ROW LEVEL SECURITY;
  `,
  `
  ALTER TABLE lab_results ENABLE ROW LEVEL SECURITY;
  `,
  `
  DROP POLICY IF EXISTS user_isolation_patients ON patients;
  `,
  `
  DROP POLICY IF EXISTS user_isolation_reports ON patient_reports;
  `,
  `
  DROP POLICY IF EXISTS user_isolation_lab_results ON lab_results;
  `,
  `
  DROP POLICY IF EXISTS audit_logs_admin_only ON audit_logs;
  `,
  `
  DROP POLICY IF EXISTS session_isolation ON sessions;
  `,
  `
  -- RLS Policy Contract (app.current_user_id):
  -- App layer MUST set either:
  --   1. Valid UUID string via SET LOCAL app.current_user_id = '<uuid>'
  --   2. Empty string (default for unset context)
  -- Malformed UUIDs will error (fail-safe behavior).
  -- The NULLIF wrapper is defensive but app should validate before setting.
  COMMENT ON SCHEMA public IS 'RLS policies use app.current_user_id session variable';
  `,
  `
  CREATE POLICY user_isolation_patients ON patients
    FOR ALL
    USING (
      user_id IS NULL
      OR user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    );
  `,
  `
  CREATE POLICY user_isolation_reports ON patient_reports
    FOR ALL
    USING (
      patient_id IN (
        SELECT id FROM patients
        WHERE user_id IS NULL
          OR user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      )
    );
  `,
  `
  CREATE POLICY user_isolation_lab_results ON lab_results
    FOR ALL
    USING (
      report_id IN (
        SELECT pr.id FROM patient_reports pr
        JOIN patients p ON pr.patient_id = p.id
        WHERE p.user_id IS NULL
          OR p.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      )
    );
  `,
  `
  -- Lock down audit logs (admin-only access via BYPASSRLS role)
  ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
  `,
  `
  CREATE POLICY audit_logs_admin_only ON audit_logs
    FOR ALL
    USING (false);
  `,
  `
  COMMENT ON POLICY audit_logs_admin_only ON audit_logs IS 'Block all app access. Only healthup_admin (BYPASSRLS) can query audit logs.';
  `,
  `
  -- Lock down sessions (users can only see their own sessions)
  ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
  `,
  `
  CREATE POLICY session_isolation ON sessions
    FOR ALL
    USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
  `,
  `
  COMMENT ON POLICY session_isolation ON sessions IS 'Users can only access their own sessions. No NULL escape hatch (sessions always have user_id).';
  `,
  // User deletion guard (Part 1-3 only, remove in Part 4)
  `
  CREATE OR REPLACE FUNCTION prevent_user_deletion()
  RETURNS TRIGGER AS $$
  BEGIN
    RAISE EXCEPTION 'User deletion is disabled during authentication migration (Parts 1-3). This restriction will be removed in Part 4.';
  END;
  $$ LANGUAGE plpgsql;
  `,
  `
  DROP TRIGGER IF EXISTS block_user_deletion ON users;
  `,
  `
  CREATE TRIGGER block_user_deletion
    BEFORE DELETE ON users
    FOR EACH ROW
    EXECUTE FUNCTION prevent_user_deletion();
  `,
  // Indexes for auth tables
  `
  CREATE INDEX IF NOT EXISTS idx_user_identities_user_id ON user_identities(user_id);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at) WHERE revoked_at IS NULL;
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_sessions_revoked_at ON sessions(revoked_at) WHERE revoked_at IS NOT NULL;
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_patients_user_id ON patients(user_id);
  `,
];
```

**Schema application**: Automatically happens on boot via `ensureSchema()` called from `server/app.js:40`. No code changes needed beyond adding the new statements to the array.

**Update `resetDatabase()` function**: Add new tables to the drop list to ensure clean resets work properly.

Find the `resetDatabase()` function in `server/db/schema.js` (around line 491) and update the drop statements:

```javascript
async function resetDatabase() {
  const client = await pool.connect();
  try {
    console.log('[db] Starting database reset...');

    // Drop all tables in dependency order (child tables first)
    // Part 1: Add auth tables to drop list
    await client.query('DROP TABLE IF EXISTS audit_logs CASCADE');
    await client.query('DROP TABLE IF EXISTS sessions CASCADE');
    await client.query('DROP TABLE IF EXISTS user_identities CASCADE');
    await client.query('DROP TABLE IF EXISTS users CASCADE');

    // Existing tables
    await client.query('DROP TABLE IF EXISTS admin_actions CASCADE');
    await client.query('DROP TABLE IF EXISTS sql_generation_logs CASCADE');
    await client.query('DROP TABLE IF EXISTS match_reviews CASCADE');
    await client.query('DROP TABLE IF EXISTS pending_analytes CASCADE');
    await client.query('DROP TABLE IF EXISTS gmail_report_provenance CASCADE');
    await client.query('DROP TABLE IF EXISTS lab_results CASCADE');
    await client.query('DROP TABLE IF EXISTS patient_reports CASCADE');
    await client.query('DROP TABLE IF EXISTS patients CASCADE');
    await client.query('DROP TABLE IF EXISTS analyte_aliases CASCADE');
    await client.query('DROP TABLE IF EXISTS analytes CASCADE');

    // Drop views
    await client.query('DROP VIEW IF EXISTS v_measurements CASCADE');

    // Drop functions (Part 1: user deletion guard)
    await client.query('DROP FUNCTION IF EXISTS prevent_user_deletion() CASCADE');

    console.log('[db] All tables dropped successfully');

    // ... rest of function unchanged
  }
}
```

**CRITICAL**: Ensure `DATABASE_URL` uses `healthup_owner` credentials during Part 1. This ensures tables are created with the correct owner, making default privileges work properly.

```bash
# .env
DATABASE_URL=postgresql://healthup_owner:owner_dev_password@localhost:5432/healthup
```

---

### 6.2 Database Recreation Script (Create as Part of Part 1)

**IMPORTANT**: This script does NOT exist in the repository yet. You must **create** `scripts/recreate_auth_db.sh` as part of Part 1 implementation and commit it to the repository.

Since HealthUp is not in production, this script provides a clean slate for development.

⚠️ **Production Security Note**: The script below uses hardcoded passwords for development convenience. For production deployments, modify the script to use environment variables or password prompts:

```bash
# Production approach
read -s OWNER_PASSWORD
read -s APP_PASSWORD
read -s ADMIN_PASSWORD
# Then use $OWNER_PASSWORD, $APP_PASSWORD, $ADMIN_PASSWORD in SQL
```

**Prerequisites:**
- PostgreSQL 10+ (PostgreSQL 13+ recommended for trusted extensions)
- Superuser access (postgres role)
- Extensions `pg_trgm`, `pgcrypto`, and `citext` available (typically installed with PostgreSQL)

**What this script does:**
1. Creates database roles with proper permissions
2. Creates database with UTF-8 locale and `healthup_owner` ownership
3. **Creates required extensions as superuser** (prevents permission errors)
4. Grants permissions to app and admin roles
5. Sets up default privileges for future tables

**Create this file:**

```bash
#!/bin/bash
# scripts/recreate_auth_db.sh
# Dev environment only - NOT for production use
#
# Note: This script uses hardcoded dev passwords:
#   healthup_owner: owner_dev_password
#   healthup_app: app_dev_password
#   healthup_admin: admin_dev_password
# Update your .env file to match these credentials after running this script.

set -e

echo "Dropping and recreating database with auth schema..."

# Terminate all connections to the database before dropping
psql -h localhost -U postgres <<'SQL'
SELECT pg_terminate_backend(pg_stat_activity.pid)
FROM pg_stat_activity
WHERE pg_stat_activity.datname = 'healthup'
  AND pid <> pg_backend_pid();
SQL

# Drop database (connections now terminated)
psql -h localhost -U postgres -c "DROP DATABASE IF EXISTS healthup;"

# Create roles (must happen before database creation to set owner)
# Note: CREATE ROLE does NOT support IF NOT EXISTS, use DO block with exception handling
psql -h localhost -U postgres <<'SQL'
DO $$
BEGIN
  CREATE ROLE healthup_owner WITH LOGIN PASSWORD 'owner_dev_password';
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'Role healthup_owner already exists, skipping.';
END $$;

-- Ensure password is current even if role existed
ALTER ROLE healthup_owner WITH PASSWORD 'owner_dev_password';

DO $$
BEGIN
  CREATE ROLE healthup_app WITH LOGIN PASSWORD 'app_dev_password';
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'Role healthup_app already exists, skipping.';
END $$;

ALTER ROLE healthup_app WITH PASSWORD 'app_dev_password';

DO $$
BEGIN
  CREATE ROLE healthup_admin WITH LOGIN PASSWORD 'admin_dev_password' BYPASSRLS;
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'Role healthup_admin already exists, skipping.';
END $$;

ALTER ROLE healthup_admin WITH PASSWORD 'admin_dev_password';
SQL

# Create database owned by healthup_owner (CRITICAL for default privileges)
psql -h localhost -U postgres -c "
  CREATE DATABASE healthup
  OWNER healthup_owner
  ENCODING 'UTF8'
  LC_COLLATE 'en_US.UTF-8'
  LC_CTYPE 'en_US.UTF-8'
  TEMPLATE template0;
"

# Create required extensions (must run as superuser BEFORE app connects)
# Note: pg_trgm, pgcrypto, and citext are "trusted" extensions on PostgreSQL 13+
# but explicit creation as superuser ensures compatibility with all environments
psql -h localhost -U postgres -d healthup <<SQL
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
SQL

# Grant permissions (must connect to database as superuser first)
psql -h localhost -U postgres -d healthup <<SQL
-- Grant permissions to app user (NOT table ownership)
GRANT USAGE ON SCHEMA public TO healthup_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO healthup_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO healthup_app;

-- Grant same to admin user
GRANT USAGE ON SCHEMA public TO healthup_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO healthup_admin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO healthup_admin;

-- Ensure future tables created by healthup_owner also get permissions
ALTER DEFAULT PRIVILEGES FOR USER healthup_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO healthup_app;
ALTER DEFAULT PRIVILEGES FOR USER healthup_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO healthup_admin;
ALTER DEFAULT PRIVILEGES FOR USER healthup_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO healthup_app;
ALTER DEFAULT PRIVILEGES FOR USER healthup_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO healthup_admin;
SQL

echo "Done. Update DATABASE_URL to use healthup_owner credentials, then run 'npm run dev' to apply schema."
```

---

## 7. Testing Strategy

### 7.0 Test Prerequisites

Before running tests, ensure the following setup is complete:

**1. Database roles must exist:**
- Run `./scripts/recreate_auth_db.sh` to create `healthup_owner`, `healthup_app`, and `healthup_admin` roles
- Or manually execute the role creation SQL from Section 4.2

**2. Environment variables must be configured:**
- `DATABASE_URL` - Must use `healthup_owner` credentials (for schema ownership)
- `DATABASE_APP_URL` - Must use `healthup_app` credentials (for role permission tests)
- `ADMIN_DATABASE_URL` - Must use `healthup_admin` credentials (for admin bypass tests)

**3. Database must be owned by `healthup_owner`:**
- Ensures default privileges apply correctly
- Verify with: `SELECT pg_catalog.pg_get_userbyid(datdba) FROM pg_database WHERE datname = 'healthup';`

**4. Schema must be applied:**
- Run `npm run dev` once to auto-apply schema, then stop the server
- Or manually execute schema from `server/db/schema.js`

**5. PostgreSQL requirements:**
- UTF-8 locale (`LC_COLLATE` and `LC_CTYPE` = `en_US.UTF-8`)
- `pg_trgm` and `pgcrypto` extensions installed

**Quick setup command:**
```bash
# Complete test setup
./scripts/recreate_auth_db.sh
# Update .env with DATABASE_URL=postgresql://healthup_owner:owner_dev_password@localhost:5432/healthup
npm run dev  # Let it boot to apply schema, then Ctrl+C
npm test     # Run tests
```

---

### 7.0.1 Conditional Test Execution (CI/Standard Dev Environments)

**Problem**: Role-based tests (Section 7.2) require database roles and specific connection strings (`DATABASE_APP_URL`, `ADMIN_DATABASE_URL`). Standard development environments or CI pipelines may not have these configured.

**Solution**: Implement conditional test execution that skips role tests when required infrastructure is missing.

**Option A: Conditional describe helper (Recommended)**

First, create a reusable helper for conditional test suites:

```javascript
// test/helpers/conditional.js

/**
 * Conditionally run or skip a test suite based on a condition
 * @param {boolean} condition - If true, run suite; if false, skip it
 * @param {string} name - Test suite name
 * @param {function} fn - Test suite function
 */
export const describeIf = (condition, name, fn) =>
  condition ? describe(name, fn) : describe.skip(name, fn);
```

Then use it in role tests:

```javascript
// test/db/roles.test.js
import { describeIf } from '../helpers/conditional.js';

// Skip if either DATABASE_APP_URL or ADMIN_DATABASE_URL is missing
const hasRoleInfrastructure =
  process.env.DATABASE_APP_URL && process.env.ADMIN_DATABASE_URL;

describeIf(hasRoleInfrastructure, 'Database Roles', () => {
  // All role permission tests here
  // Skipped if role infrastructure not configured
});
```

**Option B: Separate test command for integration tests**

```json
// package.json
{
  "scripts": {
    "test": "jest",
    "test:integration": "jest --testPathPattern=integration"
  }
}
```

Move role tests to `test/integration/roles.test.js`. Standard `npm test` runs unit tests only; `npm run test:integration` requires full database setup.

**Recommendation**: Use Option A for simplicity. Tests gracefully degrade when infrastructure is unavailable, preventing CI failures while preserving test coverage for full setups.

---

### 7.1 Schema Validation Tests

```javascript
// test/db/schema.test.js

describe('Part 1: Schema + RLS Groundwork', () => {
  test('users table exists with correct columns', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'users'
      ORDER BY ordinal_position
    `);

    expect(result.rows).toMatchObject([
      { column_name: 'id', data_type: 'uuid', is_nullable: 'NO' },
      { column_name: 'display_name', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'primary_email', data_type: 'text', is_nullable: 'YES' },
      // ... etc
    ]);
  });

  test('patients.user_id column added', async () => {
    const result = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'patients' AND column_name = 'user_id'
    `);

    expect(result.rows.length).toBe(1);
  });

  test('RLS policies created on all data tables', async () => {
    const result = await pool.query(`
      SELECT tablename, policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename IN ('patients', 'patient_reports', 'lab_results', 'audit_logs', 'sessions')
    `);

    expect(result.rows.length).toBe(5);
    expect(result.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ tablename: 'patients', policyname: 'user_isolation_patients' }),
      expect.objectContaining({ tablename: 'patient_reports', policyname: 'user_isolation_reports' }),
      expect.objectContaining({ tablename: 'lab_results', policyname: 'user_isolation_lab_results' }),
      expect.objectContaining({ tablename: 'audit_logs', policyname: 'audit_logs_admin_only' }),
      expect.objectContaining({ tablename: 'sessions', policyname: 'session_isolation' })
    ]));
  });

  test('RLS is enabled but not forced (yet)', async () => {
    const result = await pool.query(`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname IN ('patients', 'patient_reports', 'lab_results', 'audit_logs', 'sessions')
    `);

    result.rows.forEach(row => {
      expect(row.relrowsecurity).toBe(true);  // RLS enabled
      expect(row.relforcerowsecurity).toBe(false);  // NOT forced yet
    });
  });
});
```

---

### 7.2 Role Permission Tests

**Note**: These tests require `DATABASE_APP_URL` and `ADMIN_DATABASE_URL` environment variables. Use conditional execution (see Section 7.0.1) to skip when infrastructure is unavailable.

```javascript
// test/db/roles.test.js
import { Pool } from 'pg';
import { describeIf } from '../helpers/conditional.js';

// Skip entire suite if role infrastructure not configured
const hasRoleInfrastructure =
  process.env.DATABASE_APP_URL && process.env.ADMIN_DATABASE_URL;

describeIf(hasRoleInfrastructure, 'Database Roles', () => {
  test('healthup_app can SELECT from patients', async () => {
    const appPool = new Pool({ connectionString: process.env.DATABASE_APP_URL });
    const result = await appPool.query('SELECT COUNT(*) FROM patients');
    expect(result.rows[0].count).toBeDefined();
    await appPool.end();
  });

  test('healthup_admin has BYPASSRLS', async () => {
    const result = await pool.query(`
      SELECT rolname, rolbypassrls
      FROM pg_roles
      WHERE rolname = 'healthup_admin'
    `);

    expect(result.rows[0].rolbypassrls).toBe(true);
  });
});
```

---

### 7.3 Behavioral Invariant Tests

**Critical**: Ensure existing functionality unchanged.

```javascript
describe('Part 1: No Behavioral Changes', () => {
  test('existing patient queries still work', async () => {
    // Should work even without setting RLS context (NULL escape hatch)
    const result = await pool.query('SELECT * FROM patients');
    expect(result.rows).toBeDefined();
  });

  test('can still insert patients without user_id', async () => {
    const result = await pool.query(`
      INSERT INTO patients (full_name, date_of_birth, gender)
      VALUES ('Test Patient', '1990-01-01', 'M')
      RETURNING id
    `);

    expect(result.rows[0].id).toBeDefined();
  });
});
```

---

### 7.4 Security Safeguard Tests

**Verify temporary security measures are in place.**

```javascript
describe('Part 1: Security Safeguards', () => {
  test('user deletion is blocked by trigger', async () => {
    // Create test user
    const user = await pool.query(`
      INSERT INTO users (display_name, primary_email)
      VALUES ('Test User', 'test@example.com')
      RETURNING id
    `);

    const userId = user.rows[0].id;

    // Attempt deletion should fail
    await expect(
      pool.query('DELETE FROM users WHERE id = $1', [userId])
    ).rejects.toThrow(/User deletion is disabled during authentication migration/);

    // Verify user still exists
    const check = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
    expect(check.rows.length).toBe(1);
  });

  test('audit_logs are blocked for app role (admin-only)', async () => {
    const appPool = new Pool({ connectionString: process.env.DATABASE_APP_URL });

    // Insert audit log entry as owner
    await pool.query(`
      INSERT INTO audit_logs (action, metadata)
      VALUES ('TEST_ACTION', '{"test": true}')
    `);

    // App role should see no rows (USING false policy)
    const result = await appPool.query('SELECT * FROM audit_logs');
    expect(result.rows.length).toBe(0);

    await appPool.end();
  });

  test('sessions are isolated by user_id', async () => {
    // Create two test users
    const user1 = await pool.query(`
      INSERT INTO users (display_name, primary_email)
      VALUES ('User One', 'user1@example.com')
      RETURNING id
    `);
    const user2 = await pool.query(`
      INSERT INTO users (display_name, primary_email)
      VALUES ('User Two', 'user2@example.com')
      RETURNING id
    `);

    const userId1 = user1.rows[0].id;
    const userId2 = user2.rows[0].id;

    // Create sessions for both users
    await pool.query(`
      INSERT INTO sessions (user_id, expires_at)
      VALUES ($1, NOW() + INTERVAL '1 hour'), ($2, NOW() + INTERVAL '1 hour')
    `, [userId1, userId2]);

    const appPool = new Pool({ connectionString: process.env.DATABASE_APP_URL });

    // Set context to user1
    await appPool.query(`SET LOCAL app.current_user_id = $1`, [userId1]);

    // Should only see user1's session
    const result = await appPool.query('SELECT user_id FROM sessions');
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].user_id).toBe(userId1);

    await appPool.end();
  });
});
```

---

### 7.5 Manual Test: Database Reset

**IMPORTANT**: The `resetDatabase()` function is destructive and should NOT be included in automated test suites. It drops all tables and would break other tests.

**WARNING**: This script drops the ENTIRE database schema. Only run against a dedicated development database. Do not run while other tests or processes are connected to the same database.

Create a separate manual test script:

```javascript
// test/manual/test_reset_database.js

import { resetDatabase } from '../../server/db/schema.js';
import { pool } from '../../server/db/index.js';

async function testResetDatabase() {
  console.log('Testing resetDatabase() includes new auth tables...');

  try {
    // Create test data in auth tables
    await pool.query(`
      INSERT INTO users (display_name, primary_email)
      VALUES ('Reset Test', 'reset@example.com')
    `);

    console.log('Created test user');

    // Call resetDatabase
    await resetDatabase();

    console.log('resetDatabase() completed');

    // Verify auth tables are empty
    const userCount = await pool.query('SELECT COUNT(*) FROM users');
    const count = Number(userCount.rows[0].count);

    if (count === 0) {
      console.log('✅ SUCCESS: Auth tables properly reset');
    } else {
      console.error('❌ FAILURE: Found', count, 'users after reset');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ ERROR:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

testResetDatabase();
```

---

## 8. Deployment Checklist

### Pre-Deployment

- [ ] Backup current database (if preserving test data)
- [ ] Review all schema changes in `schema.js`
- [ ] Generate secure passwords for database roles
- [ ] Update `DATABASE_URL` to use `healthup_owner` credentials
- [ ] Add `DATABASE_APP_URL` to `.env` (for tests, not used by running app yet)
- [ ] Add `ADMIN_DATABASE_URL` to `.env` (keep all credentials uncommitted)
- [ ] Update `.env.example` with new database role variables (see Section 5.3)

### Deployment Steps

Choose **one** of the following paths:

**Option A: Automated Setup (Recommended for Development)**

1. **Create the database recreation script**: Follow instructions in Section 6.2 to create `scripts/recreate_auth_db.sh` (this script does NOT exist yet and must be created as part of Part 1)
2. **Run recreation script**: `./scripts/recreate_auth_db.sh`
   - Drops existing database
   - Creates roles (`healthup_owner`, `healthup_app`, `healthup_admin`)
   - Creates database owned by `healthup_owner`
   - Sets up default privileges
3. **Update `.env`**: Set `DATABASE_URL=postgresql://healthup_owner:owner_dev_password@localhost:5432/healthup`
4. **Boot application**: `npm run dev` (schema applies automatically)
5. **Run tests**: `npm test` (verify schema + RLS policies)
6. **Verify no behavioral changes**: Existing features work unchanged

**Option B: Manual Setup (For Production or Existing Databases)**

1. **Create database roles**: Run SQL from Section 4.2 as superuser
2. **Create database**: `CREATE DATABASE healthup OWNER healthup_owner ...` (see script in Section 6.2)
3. **Grant permissions**: Run GRANT statements from Section 4.2
4. **If migrating existing database**: Run ownership transfer SQL from Section 4.3 (CRITICAL for existing tables)
5. **Update `.env`**: Set `DATABASE_URL` to use `healthup_owner` credentials
6. **Boot application**: `npm run dev` (schema applies automatically)
7. **Run tests**: `npm test` (verify schema + RLS policies)
8. **Verify no behavioral changes**: Existing features work unchanged

### Post-Deployment Validation

- [ ] All schema tests pass (`npm test`)
- [ ] RLS policies created (not forced) on all 5 tables: patients, patient_reports, lab_results, audit_logs, sessions
- [ ] Audit logs blocked for app role (verify: app role SELECT returns 0 rows even when audit_logs has data)
- [ ] Sessions isolated by user_id (verify: app role with context set only sees matching user's sessions)
- [ ] User deletion guard trigger active (verify: `DELETE FROM users WHERE id = 'test-uuid'` should fail with error message)
- [ ] `resetDatabase()` drops all new tables (run manual test: `node test/manual/test_reset_database.js`)
- [ ] Database roles exist with correct permissions
- [ ] Extensions created: `pg_trgm`, `pgcrypto`, `citext` (verify: `SELECT * FROM pg_extension;`)
- [ ] Existing patient/report queries work
- [ ] No 500 errors in application logs
- [ ] v_measurements view still owned by healthup_owner (check with: `SELECT viewowner FROM pg_views WHERE viewname = 'v_measurements'`)

---

## 9. What's Next?

**Part 2 (Auth Core Backend)** will add:
- `/api/auth/*` routes (login, logout, session check)
- `requireAuth` middleware
- `queryWithUser()` / `queryAsAdmin()` helpers
- Session cleanup job

**Part 3 (RLS-Scoped Data Access)** will:
- Switch app to `healthup_app` role (RLS enforcement)
- Fix v_measurements view security gap (SECURITY INVOKER or ownership change)
- Remove NULL escape hatches from RLS policies
- Add explicit `WITH CHECK` clauses to RLS policies for write operations (INSERT/UPDATE)
- Apply `FORCE ROW LEVEL SECURITY`

**Note on WITH CHECK clauses**: Part 1 policies use `FOR ALL USING (...)` without explicit `WITH CHECK`. PostgreSQL implicitly uses the `USING` clause for write operations when `WITH CHECK` is omitted. However, Part 3 should add explicit `WITH CHECK` clauses for clarity and maintainability:

```sql
-- Part 3: Add explicit WITH CHECK for write operations
CREATE POLICY user_isolation_patients ON patients
  FOR ALL
  USING (
    user_id = current_setting('app.current_user_id', true)::uuid
  )
  WITH CHECK (
    user_id = current_setting('app.current_user_id', true)::uuid
  );
```

This makes the security model explicit: users can only read AND write their own data.

**Part 4 (Frontend Auth UI)** will:
- Remove user deletion guard trigger (replace with proper deletion logic)
- Implement OAuth UI flow
- Add user profile management
- Complete multi-user production readiness

**Part 1 output**: A database ready for authentication, with temporary safeguards in place and no impact on current functionality.
