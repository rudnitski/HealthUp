# PRD v4.4.2: Authentication - Part 2: Auth Core Backend

**Status:** Ready for Implementation
**Created:** 2025-12-27
**Author:** System (Claude Code)
**Target Release:** v4.4.2
**Part:** 2 of 4
**Depends On:** Part 1 (Schema + RLS Groundwork)

---

## 1. Overview

### Purpose

Part 2 builds the **authentication infrastructure** (backend only, minimal UI impact):

1. `/api/auth/*` routes: login, logout, session check, config
2. Auth middleware: `requireAuth`, `optionalAuth`
3. Database helpers: `queryWithUser()`, `queryAsAdmin()`
4. Session cleanup job (automatic expiry pruning)
5. **Session caching** (in-memory LRU cache with 5-min TTL)
6. **Audit logging** (console-based, LOGIN_SUCCESS/FAILED/LOGOUT/SESSION_EXPIRED)
7. Cookie parser + helmet middleware integration
8. Admin endpoint protection (as proof-of-concept)

### Key Constraints

- **Minimal UI impact**: No login page yet (Part 4), but `/api/auth/*` endpoints functional
- **Admin endpoints first**: Start with low-risk protection (admin panel, not main app)
- **Deployable**: Can coexist with unprotected routes (transition period)
- **Single-instance deployment**: MVP requires single Node.js process due to in-memory session cache (multi-instance deployments would experience up to 5-minute cache inconsistency on logout/expiry)
- **No compliance requirements**: General-purpose app, no HIPAA/GDPR/SOC2 enforcement

### Success Criteria

✅ `adminPool` exported from `server/db/index.js` and connected to `ADMIN_DATABASE_URL`
✅ `cookie-parser` middleware installed and applied in `server/app.js`
✅ `/api/auth/google`, `/api/auth/logout`, `/api/auth/me` functional
✅ Session creation, validation, and deletion working
✅ Session caching reduces DB load for auth checks
✅ `requireAuth` middleware blocks unauthenticated requests (returns 401)
✅ `requireAdmin` middleware blocks non-admin users from admin endpoints
✅ Admin endpoints use `queryAsAdmin()` with `ADMIN_DATABASE_URL`
✅ Session cleanup job removes expired sessions on startup + hourly
✅ Audit logging captures LOGIN_SUCCESS, LOGIN_FAILED, LOGOUT, SESSION_EXPIRED
✅ Helmet middleware adds security headers
✅ Tests pass: login flow, logout, session expiry, cookie flags, cache invalidation, admin authorization

---

## 2. Authentication Flow (Google OAuth)

### 2.1 High-Level Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  1. User clicks "Continue with Google" (frontend)              │
│     - Google Sign-In dialog appears (Google Identity Services) │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. Frontend receives Google ID token (JWT)                     │
│     POST /api/auth/google { credential: "eyJhbGc..." }         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. Backend verifies token with Google                         │
│     - Validates signature using Google's public keys           │
│     - Extracts claims: sub, email, name, picture, etc.         │
│     - No retry on failure (fast-fail)                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. Resolve or create user (transaction)                       │
│     - Lookup user_identities(provider='google', subject=sub)   │
│     - If exists: Update profile data, last_used_at,            │
│       last_login_at (sync with Google on every login)          │
│     - If new: CREATE user + identity                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. Create session + set HttpOnly cookie                       │
│     - INSERT INTO sessions (14-day absolute expiry)            │
│     - Set-Cookie: healthup_session={uuid}; HttpOnly; Secure;   │
│       SameSite=Lax                                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  6. Write audit log + return user data                         │
│     - Console log: LOGIN_SUCCESS                               │
│     - Write to audit_logs table                                │
│     - 200 OK { success: true, user: {...} }                    │
└─────────────────────────────────────────────────────────────────┘
```

**Email Conflict Handling:**

Part 2 implements **Google-only authentication**, which means email conflicts cannot occur (no other signup methods exist). The flow matches users by `user_identities(provider='google', provider_subject=sub)`, ensuring each Google account creates exactly one user.

**Future Consideration (Part 4 - Multi-Provider Auth):**
- If email/password or other OAuth providers are added, the unique constraint on `users.primary_email` could trigger conflicts
- Resolution strategy: Email-based account linking (link new identity to existing user if emails match)
- Implementation: Catch unique constraint violations, return 409 EMAIL_CONFLICT with linking instructions
- For now, the catch block in Section 10.1 includes basic conflict detection to future-proof the implementation

### 2.2 Token Verification (Google ID Token)

```javascript
import { OAuth2Client } from 'google-auth-library';

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

async function verifyGoogleToken(credential) {
  // No retry - fast-fail on Google API errors
  // Google already handles rate limiting on their end
  const ticket = await googleClient.verifyIdToken({
    idToken: credential,
    audience: process.env.GOOGLE_CLIENT_ID,
  });

  const payload = ticket.getPayload();

  // Security validations
  if (!payload.email_verified) {
    throw new Error('Email not verified by Google');
  }

  if (payload.aud !== process.env.GOOGLE_CLIENT_ID) {
    throw new Error('Invalid audience');
  }

  return {
    sub: payload.sub,              // Google user ID (unique, immutable)
    email: payload.email,           // User's email
    email_verified: payload.email_verified,
    name: payload.name,             // Full name
    picture: payload.picture,       // Avatar URL
    locale: payload.locale,         // e.g., "en"
    hd: payload.hd,                 // Hosted domain (Google Workspace)
  };
}
```

**Security checks performed:**
- ✅ Token signature verified using Google's public keys
- ✅ `aud` (audience) matches `GOOGLE_CLIENT_ID`
- ✅ `iss` (issuer) is `https://accounts.google.com`
- ✅ `exp` (expiration) checked by library
- ✅ `email_verified` is true (reject unverified emails)

**Error Handling:**
- **Token validation failures** (invalid signature, expired, wrong audience) → 401 INVALID_TOKEN or 401 TOKEN_EXPIRED
- **Email not verified by Google** → 403 EMAIL_UNVERIFIED
- **Google verification service unavailable** (API down, network error) → 503 SERVICE_UNAVAILABLE (no retry - fast-fail)
- Google handles rate limiting on their verification API
- Cloudflare provides edge-level DDoS protection

---

## 3. API Specifications

### 3.1 POST /api/auth/google

**Purpose:** Authenticate user with Google ID token

**Request:**
```json
{
  "credential": "eyJhbGciOiJSUzI1NiIsImtpZCI6IjYxZD..."
}
```

**Success Response (200 OK):**
```json
{
  "success": true,
  "user": {
    "id": "a3f7c8e2-1b4d-4c3a-9e5f-8b2d1a3c4e5f",
    "display_name": "Ivan Petrov",
    "email": "ivan.petrov@gmail.com",
    "avatar_url": "https://lh3.googleusercontent.com/a/..."
  }
}
```

**Cookie Set:**
```
Set-Cookie: healthup_session=a3f7c8e2-1b4d-4c3a-9e5f-8b2d1a3c4e5f;
            HttpOnly;
            Secure;
            SameSite=Lax;
            Max-Age=1209600;
            Path=/
```

**Notes:**
- Changed from `SameSite=Strict` to `SameSite=Lax` to support OAuth redirects when users click email links to HealthUp.
- `Secure` flag is conditional on `NODE_ENV === 'production'` in implementation (see Section 10.1). Omitted in development to support HTTP localhost.

**Error Responses:**

| Status | Code | Description |
|--------|------|-------------|
| 400 | `MISSING_CREDENTIAL` | Request body missing `credential` field |
| 401 | `INVALID_TOKEN` | Token signature verification failed |
| 401 | `TOKEN_EXPIRED` | Token past expiration time |
| 403 | `EMAIL_UNVERIFIED` | Google email not verified |
| 409 | `EMAIL_CONFLICT` | Email already registered with different provider (future: multi-provider support) |
| 500 | `INTERNAL_ERROR` | Database or server error |
| 503 | `SERVICE_UNAVAILABLE` | Google verification service down (no retry) |

**Rate Limiting:**
- **None** at application level (rely on Google + Cloudflare)
- Google API rate-limits token verification on their end
- Cloudflare provides edge-level protection against volumetric attacks

---

### 3.2 POST /api/auth/logout

**Purpose:** Invalidate current session and clear cookie

**Request:** No body (session from cookie)

**Success Response (200 OK):**
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

**Cookie Cleared:**
```
Set-Cookie: healthup_session=;
            HttpOnly;
            Secure;
            SameSite=Lax;
            Max-Age=0;
            Path=/
```

**Database Operation:**
```sql
-- Hard delete (no revoked_at soft delete)
DELETE FROM sessions WHERE id = $1
```

**Cache Operation:**
```javascript
// Also clear from session cache
sessionCache.delete(sessionId);
```

**Audit Logging:**
```javascript
console.log(`LOGOUT: user_id=${userId} session_id=${sessionId}`);
// Also write to audit_logs table
```

**Error Responses:**

| Status | Code | Description |
|--------|------|-------------|
| 401 | `NOT_AUTHENTICATED` | No session cookie present |
| 500 | `INTERNAL_ERROR` | Failed to delete session |

---

### 3.3 GET /api/auth/me

**Purpose:** Get current user info (check auth status)

**Request:** No body (session from cookie)

**Success Response (200 OK):**
```json
{
  "user": {
    "id": "a3f7c8e2-1b4d-4c3a-9e5f-8b2d1a3c4e5f",
    "display_name": "Ivan Petrov",
    "email": "ivan.petrov@gmail.com",
    "avatar_url": "https://lh3.googleusercontent.com/a/...",
    "created_at": "2025-12-01T10:30:00Z",
    "last_login_at": "2025-12-27T14:22:00Z"
  }
}
```

**Error Responses:**

| Status | Code | Description |
|--------|------|-------------|
| 401 | `NOT_AUTHENTICATED` | No session cookie |
| 401 | `SESSION_EXPIRED` | Session past expiration |
| 401 | `SESSION_NOT_FOUND` | Session deleted/revoked |

**Performance:**
- Lightweight join query
- **Cached** via in-memory LRU cache (5-min TTL)
- No rate limiting (used on every page load)

---

### 3.4 GET /api/auth/config

**Purpose:** Get public auth configuration for frontend

**Request:** No authentication required

**Response (200 OK):**
```json
{
  "googleClientId": "123456789-abc123.apps.googleusercontent.com",
  "providers": ["google"],
  "sessionMaxAge": 1209600
}
```

**Note:** `sessionMaxAge` is in **seconds** (14 days = 1209600 seconds). This matches the cookie `Max-Age` attribute format for frontend convenience.

**Usage:** Frontend uses `googleClientId` to initialize Google Identity Services.

---

## 4. Middleware Implementation

### 4.1 File: `server/middleware/auth.js`

```javascript
import { adminPool } from '../db/index.js';
import { sessionCache } from '../utils/sessionCache.js';

/**
 * requireAuth - Authentication middleware
 * Validates session via cache (5-min TTL) or DB, attaches user to req.user
 *
 * IMPORTANT: Uses adminPool (BYPASSRLS) because:
 * - Sessions table has RLS enabled with user_id isolation policy
 * - During session lookup, we don't yet know the user_id (chicken-and-egg)
 * - adminPool bypasses RLS to perform initial session validation
 */
export async function requireAuth(req, res, next) {
  const sessionId = req.cookies.healthup_session;

  if (!sessionId) {
    return res.status(401).json({
      error: 'Not authenticated',
      code: 'NOT_AUTHENTICATED'
    });
  }

  try {
    // Check cache first (5-min TTL)
    let sessionData = sessionCache.get(sessionId);

    if (sessionData) {
      // Cache hit - validate expiry
      if (new Date(sessionData.expires_at) < new Date()) {
        // Expired session in cache - invalidate and treat as miss
        sessionCache.delete(sessionId);
        sessionData = null;
      }
    }

    if (!sessionData) {
      // Cache miss - fetch from DB using adminPool (bypasses RLS)
      const result = await adminPool.query(
        `SELECT
           s.id as session_id,
           s.user_id,
           s.expires_at,
           u.id,
           u.display_name,
           u.primary_email,
           u.avatar_url
         FROM sessions s
         JOIN users u ON s.user_id = u.id
         WHERE s.id = $1`,
        [sessionId]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({
          error: 'Session not found',
          code: 'SESSION_NOT_FOUND'
        });
      }

      const session = result.rows[0];

      // Check if expired
      if (new Date(session.expires_at) < new Date()) {
        // Log session expiry
        console.error(`SESSION_EXPIRED: session_id=${sessionId} user_id=${session.user_id}`);

        // Write to audit_logs table using adminPool (bypasses RLS)
        await adminPool.query(
          `INSERT INTO audit_logs (user_id, action, metadata)
           VALUES ($1, 'SESSION_EXPIRED', $2)`,
          [session.user_id, JSON.stringify({ session_id: sessionId })]
        ).catch(err => console.error('Failed to write SESSION_EXPIRED audit log:', err));

        return res.status(401).json({
          error: 'Session expired',
          code: 'SESSION_EXPIRED',
          message: 'Please sign in again'
        });
      }

      // Store in cache (5-min TTL) - MUST include expires_at for cache-hit validation
      sessionData = {
        user_id: session.user_id,
        display_name: session.display_name,
        email: session.primary_email,
        avatar_url: session.avatar_url,
        expires_at: session.expires_at, // Required for expiry check on cache hit
        last_activity_update: Date.now() // Track last DB update time
      };

      sessionCache.set(sessionId, sessionData);
    }

    // Update last_activity_at (throttled to 5-min intervals)
    const now = Date.now();
    const timeSinceLastUpdate = now - (sessionData.last_activity_update || 0);
    const FIVE_MINUTES_MS = 5 * 60 * 1000;

    if (timeSinceLastUpdate > FIVE_MINUTES_MS) {
      // Fire-and-forget DB update using adminPool
      adminPool.query(
        'UPDATE sessions SET last_activity_at = NOW() WHERE id = $1',
        [sessionId]
      ).catch(err => console.error('Failed to update session activity:', err));

      // Update cache timestamp
      sessionData.last_activity_update = now;
      sessionCache.set(sessionId, sessionData);
    }

    // Attach user to request
    req.user = {
      id: sessionData.user_id,
      display_name: sessionData.display_name,
      email: sessionData.email,
      avatar_url: sessionData.avatar_url
    };

    next();

  } catch (error) {
    console.error('Auth middleware error:', error.message, { sessionId });
    return res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
}

/**
 * optionalAuth - Attaches user if authenticated, continues if not
 * Use for public endpoints that behave differently for logged-in users
 */
export async function optionalAuth(req, res, next) {
  const sessionId = req.cookies.healthup_session;

  if (!sessionId) {
    req.user = null;
    return next();
  }

  try {
    // Check cache first
    let sessionData = sessionCache.get(sessionId);

    if (sessionData) {
      // Cache hit - validate expiry
      if (new Date(sessionData.expires_at) < new Date()) {
        sessionCache.delete(sessionId);
        sessionData = null;
      }
    }

    if (!sessionData) {
      // Cache miss - fetch from DB using adminPool
      const result = await adminPool.query(
        `SELECT s.user_id, s.expires_at, u.display_name, u.primary_email, u.avatar_url
         FROM sessions s
         JOIN users u ON s.user_id = u.id
         WHERE s.id = $1 AND s.expires_at > NOW()`,
        [sessionId]
      );

      if (result.rows.length > 0) {
        sessionData = {
          user_id: result.rows[0].user_id,
          display_name: result.rows[0].display_name,
          email: result.rows[0].primary_email,
          avatar_url: result.rows[0].avatar_url,
          expires_at: result.rows[0].expires_at,
          last_activity_update: Date.now()
        };
        sessionCache.set(sessionId, sessionData);
      }
    }

    if (sessionData) {
      req.user = {
        id: sessionData.user_id,
        display_name: sessionData.display_name,
        email: sessionData.email,
        avatar_url: sessionData.avatar_url
      };
    } else {
      req.user = null;
    }

  } catch (error) {
    console.error('Optional auth error:', error.message);
    req.user = null;
  }

  next();
}

/**
 * requireAdmin - Admin authorization middleware
 * Validates user is authenticated AND authorized as admin
 *
 * Admin users are determined by ADMIN_EMAIL_ALLOWLIST environment variable.
 * Must be used AFTER requireAuth (relies on req.user being populated).
 *
 * Example: app.get('/api/admin/users', requireAuth, requireAdmin, handler)
 */
export async function requireAdmin(req, res, next) {
  // Ensure user is authenticated (should be guaranteed by requireAuth)
  if (!req.user || !req.user.email) {
    return res.status(401).json({
      error: 'Not authenticated',
      code: 'NOT_AUTHENTICATED'
    });
  }

  // Check admin allowlist
  const adminEmails = (process.env.ADMIN_EMAIL_ALLOWLIST || '')
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(email => email.length > 0);

  if (adminEmails.length === 0) {
    console.error('ADMIN_EMAIL_ALLOWLIST not configured - denying admin access');
    return res.status(403).json({
      error: 'Admin access not configured',
      code: 'ADMIN_NOT_CONFIGURED'
    });
  }

  const userEmail = req.user.email.toLowerCase();

  if (!adminEmails.includes(userEmail)) {
    console.warn(`Unauthorized admin access attempt: ${userEmail}`);
    return res.status(403).json({
      error: 'Forbidden - admin access required',
      code: 'FORBIDDEN'
    });
  }

  // User is authorized admin
  next();
}
```

**Design Decisions:**
- **Environment-based allowlist**: Simpler than database column for MVP, easy to update without migrations
- **Comma-separated emails**: `ADMIN_EMAIL_ALLOWLIST=admin@example.com,owner@healthup.com`
- **Case-insensitive matching**: Prevents issues with email case variations
- **Fail-safe when unconfigured**: Returns 403 if ADMIN_EMAIL_ALLOWLIST is empty
- **Audit trail**: Logs unauthorized access attempts
- **Composable**: Use `requireAuth, requireAdmin` chain in route definitions
- **Future-proof**: Can migrate to database-backed role system in Part 4 without changing route code

---

## 5. Session Caching

### 5.1 File: `server/utils/sessionCache.js`

```javascript
import { LRUCache } from 'lru-cache';

/**
 * In-memory LRU cache for session data
 * Reduces DB load by caching session lookups for 5 minutes
 */
const cacheMax = parseInt(process.env.SESSION_CACHE_MAX) || 10000;

export const sessionCache = new LRUCache({
  max: cacheMax, // Configurable via SESSION_CACHE_MAX (default: 10k sessions)
  ttl: 5 * 60 * 1000, // 5-minute TTL (300,000 ms)
  updateAgeOnGet: false, // Don't extend TTL on cache hit
  updateAgeOnHas: false,
});

/**
 * Invalidate session from cache (call on logout)
 */
export function invalidateSession(sessionId) {
  sessionCache.delete(sessionId);
}
```

**Design Decisions:**
- **5-minute TTL**: Balances performance with freshness (high cache hit rate for active users)
- **LRU eviction**: Automatically removes least-recently-used sessions when cache full
- **No TTL extension on access**: Session cache entry expires 5min after creation, regardless of access
- **Configurable max entries**: Default 10k sessions (configurable via `SESSION_CACHE_MAX`). Heuristic: ~10 sessions/user over 5min window, so 10k supports ~1000 concurrent users
- **Logout invalidation**: Hard delete from DB + cache ensures immediate logout effect
- **expires_at validation**: Cache entries include `expires_at` timestamp; middleware validates on cache hits to prevent accepting expired sessions during cache TTL window

**Performance Impact:**
- **Cache hit**: ~0.1ms (in-memory lookup + expiry check)
- **Cache miss**: ~5-10ms (DB query + cache population)
- **Expected hit rate**: High for active users (5-min TTL covers typical page navigation patterns)
- **DB load reduction**: Significant reduction in queries to sessions table

---

## 6. Database Helper Functions

### 6.1 File: `server/db/index.js` (additions)

**CRITICAL IMPLEMENTATION NOTE**: This section adds the `adminPool` export to `server/db/index.js`. Without `adminPool`, all auth operations will fail because:
1. `sessions` table has RLS enabled, but we need to query it before knowing the user_id (chicken-and-egg)
2. `audit_logs` table has `USING (false)` RLS policy, blocking all non-admin access
3. Auth middleware, logout endpoint, and audit logger all require BYPASSRLS privilege

**Modules that MUST use `adminPool`:**
- `server/middleware/auth.js` - Session validation (requireAuth, optionalAuth)
- `server/routes/auth.js` - Logout endpoint (session deletion)
- `server/utils/auditLog.js` - Audit event writes

```javascript
import pg from 'pg';
const { Pool } = pg;

// Existing pool (will use healthup_owner or current role in Part 2)
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// Google OAuth Client ID validation
// REQUIRED: Must be set for Google authentication to work
if (!process.env.GOOGLE_CLIENT_ID) {
  console.error('FATAL: GOOGLE_CLIENT_ID environment variable is required');
  console.error('Google OAuth authentication requires a valid client ID from Google Cloud Console.');
  process.exit(1);
}

// Admin pool (bypasses RLS for session/audit operations)
// REQUIRED: Must connect with role having BYPASSRLS privilege (e.g., healthup_admin)
// NOTE: No fallback to DATABASE_URL - explicit configuration required
if (!process.env.ADMIN_DATABASE_URL) {
  console.error('FATAL: ADMIN_DATABASE_URL environment variable is required');
  console.error('Auth middleware, session management, and audit logging require a BYPASSRLS role.');
  process.exit(1);
}

export const adminPool = new Pool({
  connectionString: process.env.ADMIN_DATABASE_URL
});

/**
 * queryWithUser - Execute query with RLS context set
 *
 * @param {string} text - SQL query
 * @param {array} params - Query parameters
 * @param {string} userId - User ID for RLS context
 * @returns {Promise<QueryResult>}
 *
 * IMPORTANT: Wraps set_config + query in explicit transaction.
 * Without BEGIN/COMMIT, set_config(..., true) creates one implicit transaction,
 * then the data query creates a separate transaction where the config is lost.
 */
export async function queryWithUser(text, params, userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Set RLS context (local to this transaction)
    await client.query(
      "SELECT set_config('app.current_user_id', $1, true)",
      [userId]
    );

    // Execute query (RLS policies automatically filter based on app.current_user_id)
    const result = await client.query(text, params);

    await client.query('COMMIT');
    return result;

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * queryAsAdmin - Execute query bypassing RLS (admin panel only)
 *
 * @param {string} text - SQL query
 * @param {array} params - Query parameters
 * @returns {Promise<QueryResult>}
 */
export async function queryAsAdmin(text, params) {
  return adminPool.query(text, params);
}

/**
 * validateAdminPool - Startup check for BYPASSRLS privilege
 * Called during app initialization to fail fast if adminPool is misconfigured.
 *
 * CRITICAL: Without BYPASSRLS, auth middleware, logout, and audit logging will fail
 * at runtime with cryptic "permission denied" errors instead of a clear startup error.
 */
export async function validateAdminPool() {
  try {
    // Test BYPASSRLS by querying sessions table (which has RLS enabled)
    // If the role lacks BYPASSRLS, this will throw a permission error
    await adminPool.query('SELECT 1 FROM sessions LIMIT 0');
    console.log('adminPool validated: BYPASSRLS privilege confirmed');
  } catch (error) {
    // Check for RLS permission denial
    if (error.message?.includes('permission denied') || error.code === '42501') {
      console.error('═══════════════════════════════════════════════════════════════');
      console.error('FATAL: adminPool does not have BYPASSRLS privilege');
      console.error('═══════════════════════════════════════════════════════════════');
      console.error('Auth middleware, logout, and audit logging will fail.');
      console.error('');
      console.error('Fix: Ensure ADMIN_DATABASE_URL points to a role with BYPASSRLS.');
      console.error('Example: postgresql://healthup_admin:password@localhost:5432/healthup');
      console.error('');
      console.error('To create the role, run as superuser:');
      console.error('  CREATE ROLE healthup_admin WITH LOGIN PASSWORD \'...\';');
      console.error('  ALTER ROLE healthup_admin BYPASSRLS;');
      console.error('═══════════════════════════════════════════════════════════════');
      process.exit(1);
    }

    // For other errors (network, table doesn't exist yet), log warning but continue
    // Table may not exist on first boot before schema is applied
    if (error.code === '42P01') { // undefined_table
      console.warn('adminPool validation skipped: sessions table does not exist yet');
      return;
    }

    // Re-throw unexpected errors
    throw error;
  }
}
```

**Design Decisions:**
- **`queryWithUser()` uses explicit transactions**: `BEGIN` + `set_config` + query + `COMMIT` ensures RLS context persists for the data query
- **`queryAsAdmin()` uses separate connection pool**: `ADMIN_DATABASE_URL` points to role with BYPASSRLS privilege (e.g., `healthup_admin`)
- **Auth middleware uses `adminPool`**: Session lookups require BYPASSRLS because sessions table has RLS enabled but we don't know user_id yet (chicken-and-egg)
- **Part 2 database role**: `DATABASE_URL` should use `healthup_owner` or `healthup_app` during Part 2 (both can read/write, but `healthup_app` will have RLS enforced in Part 3)
- **Part 3 migration**: All patient/report routes will migrate to use `queryWithUser()` for user-scoped data access

---

### 6.2 Admin Role Setup (Required for Part 2)

**CRITICAL PREREQUISITE**: The `adminPool` connection requires a PostgreSQL role with `BYPASSRLS` privilege. Without this, auth middleware, logout, and audit logging will fail at runtime.

**Create Admin Role:**
```sql
-- Connect as superuser (postgres) or database owner
-- Create role with BYPASSRLS privilege
CREATE ROLE healthup_admin WITH LOGIN PASSWORD 'your_secure_password_here';

-- Grant BYPASSRLS privilege (required to query sessions/audit_logs with RLS enabled)
ALTER ROLE healthup_admin BYPASSRLS;

-- Grant necessary permissions
GRANT CONNECT ON DATABASE healthup TO healthup_admin;
GRANT USAGE ON SCHEMA public TO healthup_admin;

-- Grant access to tables used by adminPool
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions TO healthup_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON audit_logs TO healthup_admin;
GRANT SELECT ON users TO healthup_admin;
GRANT SELECT ON user_identities TO healthup_admin;

-- Grant sequence permissions (for audit_logs.id)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO healthup_admin;
```

**Configure Environment:**
```bash
# .env
ADMIN_DATABASE_URL=postgresql://healthup_admin:your_secure_password_here@localhost:5432/healthup
```

**Verify Setup:**
```sql
-- Connect with healthup_admin role
-- Verify BYPASSRLS privilege
SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = 'healthup_admin';
-- Expected: rolbypassrls = true

-- Test session query (should succeed even with RLS enabled)
SELECT COUNT(*) FROM sessions;

-- Test audit log insert (should succeed)
INSERT INTO audit_logs (user_id, action, metadata)
VALUES (NULL, 'TEST', '{"test": true}');
```

**Security Notes:**
- Use a strong password for `healthup_admin` (minimum 16 characters)
- Store credentials securely (environment variables, secret management)
- Never commit `ADMIN_DATABASE_URL` to version control
- In production, use connection pooling with connection limits to prevent resource exhaustion

**Troubleshooting:**
- If auth middleware returns "Internal server error", check that `ADMIN_DATABASE_URL` is set and the role has BYPASSRLS
- If "permission denied" on sessions/audit_logs, verify the GRANT statements above
- If connection fails, verify the role exists: `\du healthup_admin` in psql

---

## 7. Session Cleanup Job

### 7.1 File: `server/jobs/sessionCleanup.js`

```javascript
import { adminPool } from '../db/index.js';

/**
 * Delete expired sessions
 * Exported for direct invocation in tests
 *
 * RLS NOTE: Uses adminPool (BYPASSRLS) because:
 * - sessions table has RLS policy requiring app.current_user_id
 * - Cleanup job runs without user context (system process)
 * - Without BYPASSRLS, DELETE would match zero rows
 */
export async function cleanup() {
  try {
    // Hard delete expired sessions using adminPool (bypasses RLS)
    const result = await adminPool.query(`
      DELETE FROM sessions
      WHERE expires_at < NOW()
    `);

    console.log(`Session cleanup completed: ${result.rowCount} sessions deleted`);

    // Also log total active sessions for monitoring
    const activeResult = await adminPool.query(`
      SELECT COUNT(*) as count FROM sessions WHERE expires_at > NOW()
    `);

    console.log(`Active sessions: ${activeResult.rows[0].count}`);

  } catch (error) {
    console.error('Session cleanup failed:', error.message);
  }
}

/**
 * Start periodic session cleanup job
 * Runs on startup + every hour via setInterval
 */
export function startSessionCleanup() {
  const intervalMs = parseInt(process.env.SESSION_CLEANUP_INTERVAL_MS) || 3600000; // Default: 1 hour

  // Run immediately on startup
  cleanup();

  // Then run periodically
  setInterval(cleanup, intervalMs);

  console.log(`Session cleanup job started (interval: ${intervalMs}ms)`);
}
```

**Cleanup Rules:**
- Delete sessions where `expires_at < NOW()` (expired)
- **Hard delete**: `DELETE FROM sessions` (not soft delete via `revoked_at`)
- **Design rationale**: Hard deletes are simpler for MVP and sufficient given no compliance requirements. The `revoked_at` column and indexes exist in the schema (from Part 1) to support future migration to soft deletes if security audits require session history. For now, hard deletes keep the implementation simple and reduce storage/query overhead.
- **No transaction**: Simple DELETE query (eventual consistency acceptable for cleanup)
- **Run on startup + hourly**: Ensures stale sessions removed quickly after restarts
- **Cache invalidation**: Cleanup job doesn't explicitly invalidate cache (cache TTL handles this within 5 minutes)

**Logging:**
- Log deleted count on every cleanup run
- Log total active session count for capacity planning
- Use console.log for session cleanup (consistent with other job logs)
- Note: Auth/audit modules use console.log for simplicity; production logging via `server/utils/logger.js` (Pino) remains available for other modules

**Call from** `server/app.js`:
```javascript
import { startSessionCleanup } from './jobs/sessionCleanup.js';
import { validateAdminPool } from './db/index.js';

// During app startup (before listening)
await validateAdminPool(); // Fail fast if BYPASSRLS not configured

// After app setup
startSessionCleanup();
```

---

## 8. Audit Logging

### 8.1 File: `server/utils/auditLog.js`

```javascript
import { adminPool } from '../db/index.js';

/**
 * Write audit log entry
 * Logs to console + database audit_logs table
 *
 * IMPORTANT: Uses adminPool (BYPASSRLS) because audit_logs table has
 * RLS policy USING (false) which blocks all access without BYPASSRLS.
 *
 * Audit logging pattern: BEST-EFFORT (fire-and-forget)
 * - Console log always succeeds (synchronous)
 * - Database write is fire-and-forget (doesn't fail requests on DB errors)
 * - Rationale: Prioritize application availability over audit completeness for MVP
 * - Future: For compliance scenarios (HIPAA/SOC2), upgrade to fail-fast pattern
 */
export async function logAuditEvent(event) {
  const {
    userId = null,
    action,
    resourceType = null,
    resourceId = null,
    ipAddress = null,
    userAgent = null,
    metadata = {}
  } = event;

  // Console logging (structured format, always succeeds)
  console.log(`AUDIT: ${action}`, {
    user_id: userId,
    resource_type: resourceType,
    resource_id: resourceId,
    ip: ipAddress,
    ...metadata
  });

  // Database logging (fire-and-forget, uses adminPool to bypass RLS)
  adminPool.query(
    `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, ip_address, user_agent, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [userId, action, resourceType, resourceId, ipAddress, userAgent, JSON.stringify(metadata)]
  ).catch(err => console.error('Failed to write audit log:', err));
}
```

### 8.2 Audit Events to Log

**LOGIN_SUCCESS:**
```javascript
logAuditEvent({
  userId: user.id,
  action: 'LOGIN_SUCCESS',
  ipAddress: req.ip,
  userAgent: req.headers['user-agent'],
  metadata: { provider: 'google' }
});
```

**LOGIN_FAILED:**
```javascript
logAuditEvent({
  userId: null, // No user ID for failed login
  action: 'LOGIN_FAILED',
  ipAddress: req.ip,
  userAgent: req.headers['user-agent'],
  metadata: { reason: 'INVALID_TOKEN', provider: 'google' }
});
```

**LOGOUT:**
```javascript
logAuditEvent({
  userId: req.user.id,
  action: 'LOGOUT',
  ipAddress: req.ip,
  userAgent: req.headers['user-agent'],
  metadata: { session_id: sessionId }
});
```

**SESSION_EXPIRED:**
```javascript
// Already implemented in requireAuth middleware (see Section 4.1)
```

---

## 9. Integration with `server/app.js`

### 9.1 Add Cookie Parser + Helmet

**CRITICAL**: `cookie-parser` middleware is required for authentication to work. Without it, `req.cookies` will be `undefined` and all auth operations will fail with `NOT_AUTHENTICATED` errors.

**Installation order:**
1. Install dependency: `npm install cookie-parser helmet`
2. Import middleware (before route registrations)
3. Apply middleware **before** `/api/auth` routes

```javascript
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

// Trust proxy for accurate client IPs (required behind Cloudflare, nginx, etc.)
// Set to 1 if one proxy, or true for all proxies in chain
// IMPORTANT: Only enable in production behind a trusted proxy
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Security headers (helmet)
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP for now (configure in Part 4)
  crossOriginEmbedderPolicy: false // Allow external resources
}));

// Cookie parsing - REQUIRED for req.cookies to be populated
// Must be applied BEFORE auth routes
app.use(cookieParser());
```

**Helmet Configuration:**
- Adds security headers: X-Frame-Options, X-Content-Type-Options, etc.
- CSP disabled for now (will configure in Part 4 with frontend)
- COEP disabled to allow Google Sign-In SDK

**Cookie Parser:**
- Parses `Cookie` header and populates `req.cookies`
- Required for session cookie (`healthup_session`) to be read by auth middleware
- Without this, `requireAuth` will reject all requests as unauthenticated

### 9.2 Register Auth Routes

```javascript
import authRoutes from './routes/auth.js';

app.use('/api/auth', authRoutes);
```

### 9.3 Protect Admin Endpoints (Proof-of-Concept)

**Integration with `server/routes/admin.js`:**

Part 2 protects existing admin routes using router-wide middleware. This ensures all admin endpoints are consistently protected without per-route duplication.

```javascript
// server/routes/admin.js
import express from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { queryAsAdmin } from '../db/index.js';

const router = express.Router();

// Apply authentication + authorization to ALL admin routes
router.use(requireAuth, requireAdmin);

// All routes below are automatically protected
router.get('/pending-analytes', async (req, res) => {
  // Use queryAsAdmin to bypass RLS (admin sees all data)
  const result = await queryAsAdmin(
    'SELECT * FROM pending_analytes ORDER BY created_at DESC'
  );
  res.json(result.rows);
});

router.post('/pending-analytes/:id/approve', async (req, res) => {
  const { id } = req.params;
  const { rationale } = req.body;

  // Handler has access to req.user (populated by requireAuth)
  // Use queryAsAdmin for RLS bypass
  await queryAsAdmin(
    `INSERT INTO admin_actions (user_id, action, resource_type, resource_id, metadata)
     VALUES ($1, 'APPROVE_ANALYTE', 'pending_analyte', $2, $3)`,
    [req.user.id, id, JSON.stringify({ rationale })]
  );

  res.json({ success: true });
});

// ... other admin routes

export default router;
```

**Register admin router in `server/app.js`:**
```javascript
import adminRoutes from './routes/admin.js';

app.use('/api/admin', adminRoutes);
```

**Authorization Chain:**
1. `requireAuth` - Validates session cookie, attaches `req.user`
2. `requireAdmin` - Checks `req.user.email` against `ADMIN_EMAIL_ALLOWLIST`
3. Handler - Uses `queryAsAdmin` to bypass RLS (admin sees all data)

**When to Use Per-Route Protection:**

Use `router.use(requireAuth, requireAdmin)` for routers where **all routes require admin access** (recommended for `/api/admin/*`).

For mixed public/protected routes, apply middleware per-route:
```javascript
// Mixed router with public + protected routes
router.get('/status', publicHandler); // No auth required
router.get('/users', requireAuth, requireAdmin, adminHandler); // Protected
```

**Note:** Part 2 protects **only admin endpoints** as low-risk proof-of-concept. Part 3 will protect patient data routes.

---

## 10. Auth Routes Implementation

### 10.1 File: `server/routes/auth.js`

```javascript
import express from 'express';
import { OAuth2Client } from 'google-auth-library';
import { pool, adminPool } from '../db/index.js';
import { sessionCache, invalidateSession } from '../utils/sessionCache.js';
import { logAuditEvent } from '../utils/auditLog.js';

const router = express.Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/**
 * GET /api/auth/config
 * Public endpoint - returns Google Client ID for frontend
 */
router.get('/config', (req, res) => {
  const sessionTTLMs = parseInt(process.env.SESSION_TTL_MS) || 1209600000; // 14 days in ms
  const sessionMaxAgeSeconds = Math.floor(sessionTTLMs / 1000); // Convert to seconds

  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    providers: ['google'],
    sessionMaxAge: sessionMaxAgeSeconds // In seconds (matches cookie Max-Age format)
  });
});

/**
 * POST /api/auth/google
 * Authenticate with Google ID token
 *
 * RLS NOTE: This endpoint uses adminPool for session creation because:
 * - sessions table has RLS policy requiring app.current_user_id to match user_id
 * - At login time, we're creating the session, so no user context exists yet
 * - adminPool (BYPASSRLS) allows session INSERT without RLS restrictions
 */
router.post('/google', async (req, res) => {
  const { credential } = req.body;

  if (!credential) {
    return res.status(400).json({
      error: 'Missing credential',
      code: 'MISSING_CREDENTIAL'
    });
  }

  // Use adminPool for session creation (bypasses RLS)
  const client = await adminPool.connect();

  try {
    // Verify Google token (no retry - fast-fail)
    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch (verifyError) {
      console.error('Token verification failed:', verifyError.message);

      // Classify token error: TOKEN_EXPIRED vs INVALID_TOKEN
      // Use multiple patterns to handle potential variations in Google's error messages
      // Fallback is always INVALID_TOKEN (safe default for any unrecognized error)
      const errorMsg = verifyError.message?.toLowerCase() || '';
      const isExpiredToken = errorMsg.includes('token used too late')
        || errorMsg.includes('token expired')
        || errorMsg.includes('token has expired')
        || (errorMsg.includes('exp') && errorMsg.includes('claim'));

      const errorCode = isExpiredToken ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN';

      // Log failed login attempt
      logAuditEvent({
        userId: null,
        action: 'LOGIN_FAILED',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        metadata: {
          reason: errorCode,
          provider: 'google',
          error: verifyError.message
        }
      });

      if (isExpiredToken) {
        return res.status(401).json({
          error: 'Token expired',
          code: 'TOKEN_EXPIRED'
        });
      }

      return res.status(401).json({
        error: 'Invalid token',
        code: 'INVALID_TOKEN'
      });
    }

    // Validate email verified
    if (!payload.email_verified) {
      logAuditEvent({
        userId: null,
        action: 'LOGIN_FAILED',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        metadata: {
          reason: 'EMAIL_UNVERIFIED',
          provider: 'google',
          email: payload.email
        }
      });

      return res.status(403).json({
        error: 'Email not verified',
        code: 'EMAIL_UNVERIFIED'
      });
    }

    await client.query('BEGIN');

    // Find or create user identity
    const identityResult = await client.query(
      `SELECT user_id FROM user_identities
       WHERE provider = 'google' AND provider_subject = $1`,
      [payload.sub]
    );

    let userId;

    if (identityResult.rows.length > 0) {
      // Existing user - update profile data on every login
      userId = identityResult.rows[0].user_id;

      await client.query(
        `UPDATE users
         SET display_name = $1,
             primary_email = $2,
             avatar_url = $3,
             last_login_at = NOW(),
             updated_at = NOW()
         WHERE id = $4`,
        [payload.name, payload.email.toLowerCase(), payload.picture, userId]
      );

      await client.query(
        `UPDATE user_identities
         SET last_used_at = NOW(),
             email = $1,
             profile_data = $2
         WHERE provider = 'google' AND provider_subject = $3`,
        [payload.email, JSON.stringify(payload), payload.sub]
      );

    } else {
      // New user - create user + identity
      const userResult = await client.query(
        `INSERT INTO users (display_name, primary_email, avatar_url, last_login_at)
         VALUES ($1, $2, $3, NOW())
         RETURNING id`,
        [payload.name, payload.email.toLowerCase(), payload.picture]
      );

      userId = userResult.rows[0].id;

      await client.query(
        `INSERT INTO user_identities (user_id, provider, provider_subject, email, email_verified, profile_data)
         VALUES ($1, 'google', $2, $3, $4, $5)`,
        [userId, payload.sub, payload.email, payload.email_verified, JSON.stringify(payload)]
      );
    }

    // Create session (14-day absolute expiration)
    const sessionTTL = parseInt(process.env.SESSION_TTL_MS) || 1209600000; // 14 days
    const expiresAt = new Date(Date.now() + sessionTTL);

    const sessionResult = await client.query(
      `INSERT INTO sessions (user_id, expires_at, ip_address, user_agent)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [userId, expiresAt, req.ip, req.headers['user-agent']]
    );

    const sessionId = sessionResult.rows[0].id;

    await client.query('COMMIT');

    // Set HttpOnly cookie (SameSite=Lax for OAuth compatibility)
    res.cookie('healthup_session', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', // Changed from 'strict' for OAuth redirects
      maxAge: sessionTTL, // Express cookie maxAge is in milliseconds (matches SESSION_TTL_MS)
      path: '/'
    });

    // Get user data for response
    const userResult = await pool.query(
      `SELECT id, display_name, primary_email as email, avatar_url
       FROM users WHERE id = $1`,
      [userId]
    );

    const user = userResult.rows[0];

    // Log successful login
    logAuditEvent({
      userId: user.id,
      action: 'LOGIN_SUCCESS',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: {
        provider: 'google',
        session_id: sessionId
      }
    });

    res.json({
      success: true,
      user
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Login error:', error.message);

    // Check for unique constraint violation on primary_email (future-proofing for multi-provider)
    if (error.code === '23505' && error.constraint === 'users_primary_email_key') {
      return res.status(409).json({
        error: 'Email already registered with different provider',
        code: 'EMAIL_CONFLICT',
        message: 'This email is already associated with another account. Please use account linking (coming in Part 4).'
      });
    }

    // Check if Google API error
    if (error.message && error.message.includes('google')) {
      return res.status(503).json({
        error: 'Authentication service temporarily unavailable',
        code: 'SERVICE_UNAVAILABLE'
      });
    }

    return res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });

  } finally {
    client.release();
  }
});

/**
 * POST /api/auth/logout
 * Logout current user (hard delete session)
 *
 * RLS NOTE: Uses adminPool for session deletion because:
 * - We need to DELETE the session before the user context is cleared
 * - Sessions table RLS would block deletion without BYPASSRLS
 */
router.post('/logout', async (req, res) => {
  const sessionId = req.cookies.healthup_session;

  if (!sessionId) {
    return res.status(401).json({
      error: 'Not authenticated',
      code: 'NOT_AUTHENTICATED'
    });
  }

  try {
    // Get user ID before deleting session (for audit log) - uses adminPool to bypass RLS
    const sessionResult = await adminPool.query(
      'SELECT user_id FROM sessions WHERE id = $1',
      [sessionId]
    );

    if (sessionResult.rows.length > 0) {
      const userId = sessionResult.rows[0].user_id;

      // Hard delete session from DB using adminPool
      await adminPool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);

      // Clear from cache
      invalidateSession(sessionId);

      // Log logout
      logAuditEvent({
        userId,
        action: 'LOGOUT',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        metadata: { session_id: sessionId }
      });
    }

    // Clear cookie (maxAge: 0 expires immediately)
    res.cookie('healthup_session', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0, // 0 = expire immediately
      path: '/'
    });

    res.json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    console.error('Logout error:', error.message);
    return res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * GET /api/auth/me
 * Get current user (uses requireAuth middleware)
 */
import { requireAuth } from '../middleware/auth.js';

router.get('/me', requireAuth, async (req, res) => {
  // requireAuth already validated session and attached req.user

  // Fetch additional user details
  // Note: users table doesn't have RLS (yet), but using pool is fine here
  // If users table gets RLS in future, switch to adminPool or queryWithUser
  const result = await pool.query(
    `SELECT id, display_name, primary_email as email, avatar_url, created_at, last_login_at
     FROM users WHERE id = $1`,
    [req.user.id]
  );

  if (result.rows.length === 0) {
    return res.status(401).json({
      error: 'User not found',
      code: 'USER_NOT_FOUND'
    });
  }

  res.json({ user: result.rows[0] });
});

export default router;
```

---

## 11. Environment Variables

```bash
# .env additions for Part 2

# Google OAuth (REQUIRED)
GOOGLE_CLIENT_ID=123456789-abc123.apps.googleusercontent.com

# Session settings
SESSION_TTL_MS=1209600000  # 14 days in ms (absolute expiration, non-rolling)
SESSION_CLEANUP_INTERVAL_MS=3600000  # 1 hour (default)
SESSION_CACHE_MAX=10000  # Max cached sessions (default: 10000)

# Admin authorization (comma-separated email allowlist)
ADMIN_EMAIL_ALLOWLIST=admin@example.com,owner@healthup.com

# Admin database - REQUIRED (bypasses RLS)
# Must point to a role with BYPASSRLS privilege (e.g., healthup_admin)
# App will exit on startup if this is missing or misconfigured
ADMIN_DATABASE_URL=postgresql://healthup_admin:admin_secure_password@localhost:5432/healthup
```

**Security:**
- Never commit `ADMIN_DATABASE_URL` credential. Use environment-specific secrets.
- `ADMIN_EMAIL_ALLOWLIST` determines who can access admin endpoints. Update this list carefully.
- **`ADMIN_DATABASE_URL` is REQUIRED** - the app will fail fast on startup if not configured or if the role lacks BYPASSRLS privilege. This is intentional to prevent silent auth failures at runtime.
- **`GOOGLE_CLIENT_ID` is REQUIRED** - the app will fail fast on startup if not configured.

**Deployment Notes:**
- Cookie `SameSite=Lax` assumes frontend and backend are same-site (same domain/subdomain)
- For cross-origin deployments (frontend on different domain), update to `SameSite=None` with `Secure: true` (requires HTTPS)
- `trust proxy` is enabled in production for accurate client IPs behind reverse proxies (Cloudflare, nginx)

**Update `.env.example`:**
```bash
# Add to .env.example
GOOGLE_CLIENT_ID=your_google_client_id_here
SESSION_TTL_MS=1209600000
SESSION_CLEANUP_INTERVAL_MS=3600000
ADMIN_EMAIL_ALLOWLIST=admin@example.com
ADMIN_DATABASE_URL=postgresql://healthup_admin:password@localhost:5432/healthup
```

---

## 12. Dependencies

**Install new packages:**
```bash
npm install cookie-parser google-auth-library helmet lru-cache
```

**Package versions (recommended):**
- `cookie-parser`: ^1.4.6
- `google-auth-library`: ^9.0.0
- `helmet`: ^7.1.0
- `lru-cache`: ^10.0.0

---

## 13. Testing Strategy

### 13.1 Auth Route Tests

**Testing Approach:**
- **Unit tests**: Mock `googleClient.verifyIdToken()` for fast, deterministic tests (CI-friendly)
- **Integration tests**: Optional manual testing with real Google OAuth for end-to-end validation

**Test Helper Functions (to be implemented in `test/helpers/auth.js`):**
- `loginAsTestUser()` - Mocks Google verification and creates test session
- `loginWithGoogle(mockToken)` - Sends POST to /api/auth/google with mock token
- `extractSessionIdFromCookie(setCookieHeader)` - Parses session ID from Set-Cookie header
- `createTestSession(userId, options)` - Directly inserts session for testing edge cases

**Mock Setup:**
```javascript
// test/routes/auth.test.js
import { jest } from '@jest/globals';

// Mock Google Auth Library
const mockVerifyIdToken = jest.fn();
jest.unstable_mockModule('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: mockVerifyIdToken
  }))
}));

// Mock payload for successful verification
const mockGooglePayload = {
  sub: 'google-user-123',
  email: 'test@example.com',
  email_verified: true,
  name: 'Test User',
  picture: 'https://example.com/avatar.jpg',
  aud: process.env.GOOGLE_CLIENT_ID,
  iss: 'https://accounts.google.com',
  locale: 'en'
};
```

```javascript
describe('POST /api/auth/google', () => {
  beforeEach(() => {
    mockVerifyIdToken.mockClear();
  });

  test('returns 400 if credential missing', async () => {
    const res = await request(app)
      .post('/api/auth/google')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_CREDENTIAL');
  });

  test('sets HttpOnly cookie on success', async () => {
    // Mock successful token verification
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => mockGooglePayload
    });

    const res = await request(app)
      .post('/api/auth/google')
      .send({ credential: 'mock-google-token' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.headers['set-cookie'][0]).toContain('healthup_session=');
    expect(res.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(res.headers['set-cookie'][0]).toContain('Secure');
    expect(res.headers['set-cookie'][0]).toContain('SameSite=Lax');
  });

  test('updates profile data on subsequent login', async () => {
    // First login
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => mockGooglePayload
    });

    const res1 = await request(app)
      .post('/api/auth/google')
      .send({ credential: 'mock-token-1' });

    const userId = res1.body.user.id;

    // Second login with updated profile
    const updatedPayload = { ...mockGooglePayload, name: 'Updated Name' };
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => updatedPayload
    });

    const res2 = await request(app)
      .post('/api/auth/google')
      .send({ credential: 'mock-token-2' });

    expect(res2.body.user.id).toBe(userId); // Same user
    expect(res2.body.user.display_name).toBe('Updated Name'); // Profile updated
  });

  test('returns 401 for invalid token', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('Invalid token'));

    const res = await request(app)
      .post('/api/auth/google')
      .send({ credential: 'invalid-token' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_TOKEN');
  });

  test('returns 401 for expired token', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('Token used too late'));

    const res = await request(app)
      .post('/api/auth/google')
      .send({ credential: 'expired-token' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('TOKEN_EXPIRED');
  });

  test('returns 403 for unverified email', async () => {
    const unverifiedPayload = { ...mockGooglePayload, email_verified: false };
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => unverifiedPayload
    });

    const res = await request(app)
      .post('/api/auth/google')
      .send({ credential: 'unverified-token' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('EMAIL_UNVERIFIED');
  });
});

describe('POST /api/auth/logout', () => {
  test('returns 401 if not authenticated', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(401);
  });

  test('deletes session and clears cookie', async () => {
    const loginRes = await loginAsTestUser();
    const cookie = loginRes.headers['set-cookie'][0];

    const logoutRes = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookie);

    expect(logoutRes.status).toBe(200);
    expect(logoutRes.headers['set-cookie'][0]).toContain('Max-Age=0');

    // Verify session deleted from DB
    const session = await pool.query(
      'SELECT * FROM sessions WHERE id = $1',
      [extractSessionIdFromCookie(cookie)]
    );
    expect(session.rows.length).toBe(0);
  });

  test('invalidates session cache on logout', async () => {
    const loginRes = await loginAsTestUser();
    const cookie = loginRes.headers['set-cookie'][0];
    const sessionId = extractSessionIdFromCookie(cookie);

    // Make a request through requireAuth to populate cache
    // (login handler doesn't seed cache - cache is populated on first auth check)
    await request(app).get('/api/auth/me').set('Cookie', cookie);

    // Session should now be in cache
    expect(sessionCache.get(sessionId)).toBeDefined();

    await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookie);

    // Session should be cleared from cache
    expect(sessionCache.get(sessionId)).toBeUndefined();
  });
});

describe('GET /api/auth/me', () => {
  test('returns user data when authenticated', async () => {
    const loginRes = await loginAsTestUser();
    const cookie = loginRes.headers['set-cookie'][0];

    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBeDefined();
    expect(res.body.user.email).toBe('test@example.com');
  });

  test('returns 401 when session expired', async () => {
    // Create expired session
    const sessionId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO sessions (id, user_id, expires_at)
       VALUES ($1, $2, NOW() - INTERVAL '1 day')`,
      [sessionId, testUserId]
    );

    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `healthup_session=${sessionId}`);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('SESSION_EXPIRED');
  });

  test('uses session cache (no DB query on cache hit)', async () => {
    const loginRes = await loginAsTestUser();
    const cookie = loginRes.headers['set-cookie'][0];

    // First request populates cache
    await request(app).get('/api/auth/me').set('Cookie', cookie);

    // Mock adminPool.query to verify no DB call on second request
    const querySpy = jest.spyOn(adminPool, 'query');

    // Second request should hit cache
    await request(app).get('/api/auth/me').set('Cookie', cookie);

    // Verify no session query (adminPool not called)
    expect(querySpy).not.toHaveBeenCalled();

    querySpy.mockRestore();
  });

  test('validates session expiry on cache hit', async () => {
    const sessionId = crypto.randomUUID();
    const userId = testUserId;

    // Create session that expires in 1 second
    await adminPool.query(
      `INSERT INTO sessions (id, user_id, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '1 second')`,
      [sessionId, userId]
    );

    // First request populates cache
    const res1 = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `healthup_session=${sessionId}`);

    expect(res1.status).toBe(200);

    // Wait for session to expire
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Second request flow:
    // 1. Cache hit with expired expires_at → delete from cache
    // 2. DB query finds session row (session exists but expired)
    // 3. Expiry check in middleware → SESSION_EXPIRED
    const res2 = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `healthup_session=${sessionId}`);

    expect(res2.status).toBe(401);
    expect(res2.body.code).toBe('SESSION_EXPIRED'); // DB lookup finds expired session
  });
});
```

---

### 13.2 Middleware Tests

```javascript
describe('requireAuth middleware', () => {
  test('blocks request when no cookie', async () => {
    const res = await request(app).get('/api/protected-endpoint');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('NOT_AUTHENTICATED');
  });

  test('attaches req.user when valid session', async () => {
    const loginRes = await loginAsTestUser();
    const cookie = loginRes.headers['set-cookie'][0];

    const res = await request(app)
      .get('/api/protected-endpoint')
      .set('Cookie', cookie);

    expect(res.body.user.id).toBeDefined();
  });

  test('throttles last_activity_at updates to 5-min intervals', async () => {
    const loginRes = await loginAsTestUser();
    const cookie = loginRes.headers['set-cookie'][0];
    const sessionId = extractSessionIdFromCookie(cookie);

    // First request updates last_activity_at
    await request(app).get('/api/auth/me').set('Cookie', cookie);

    const activity1 = await pool.query(
      'SELECT last_activity_at FROM sessions WHERE id = $1',
      [sessionId]
    );

    // Second request immediately after (< 5 min) should NOT update
    await request(app).get('/api/auth/me').set('Cookie', cookie);

    const activity2 = await pool.query(
      'SELECT last_activity_at FROM sessions WHERE id = $1',
      [sessionId]
    );

    expect(activity1.rows[0].last_activity_at).toEqual(activity2.rows[0].last_activity_at);
  });
});

describe('requireAdmin middleware', () => {
  test('blocks request when ADMIN_EMAIL_ALLOWLIST not configured', async () => {
    // Temporarily clear allowlist
    const originalAllowlist = process.env.ADMIN_EMAIL_ALLOWLIST;
    delete process.env.ADMIN_EMAIL_ALLOWLIST;

    const loginRes = await loginAsTestUser();
    const cookie = loginRes.headers['set-cookie'][0];

    const res = await request(app)
      .get('/api/admin/pending-analytes')
      .set('Cookie', cookie);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ADMIN_NOT_CONFIGURED');

    // Restore
    process.env.ADMIN_EMAIL_ALLOWLIST = originalAllowlist;
  });

  test('blocks non-admin user', async () => {
    process.env.ADMIN_EMAIL_ALLOWLIST = 'admin@example.com';

    // Login as regular user (different email)
    const loginRes = await loginWithGoogle(TEST_USER_TOKEN); // email: test@example.com
    const cookie = loginRes.headers['set-cookie'][0];

    const res = await request(app)
      .get('/api/admin/pending-analytes')
      .set('Cookie', cookie);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  test('allows admin user from allowlist', async () => {
    process.env.ADMIN_EMAIL_ALLOWLIST = 'admin@example.com,test@example.com';

    const loginRes = await loginWithGoogle(TEST_USER_TOKEN); // email: test@example.com
    const cookie = loginRes.headers['set-cookie'][0];

    const res = await request(app)
      .get('/api/admin/pending-analytes')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('handles case-insensitive email matching', async () => {
    process.env.ADMIN_EMAIL_ALLOWLIST = 'Admin@Example.com';

    // Login with lowercase email
    const loginRes = await loginWithGoogle(TEST_USER_TOKEN); // email: admin@example.com
    const cookie = loginRes.headers['set-cookie'][0];

    const res = await request(app)
      .get('/api/admin/pending-analytes')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
  });
});
```

---

### 13.3 Session Cleanup Tests

```javascript
describe('Session cleanup job', () => {
  test('deletes expired sessions', async () => {
    // Create expired session
    await pool.query(
      `INSERT INTO sessions (id, user_id, expires_at)
       VALUES ($1, $2, NOW() - INTERVAL '1 day')`,
      ['expired-session', testUserId]
    );

    // Import cleanup function
    const { cleanup } = await import('../server/jobs/sessionCleanup.js');
    await cleanup();

    // Verify deleted
    const result = await pool.query(
      'SELECT * FROM sessions WHERE id = $1',
      ['expired-session']
    );

    expect(result.rows.length).toBe(0);
  });

  test('keeps active sessions', async () => {
    const sessionId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO sessions (id, user_id, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
      [sessionId, testUserId]
    );

    const { cleanup } = await import('../server/jobs/sessionCleanup.js');
    await cleanup();

    const result = await pool.query(
      'SELECT * FROM sessions WHERE id = $1',
      [sessionId]
    );

    expect(result.rows.length).toBe(1);
  });

  test('runs on startup and hourly', async () => {
    // Verify cleanup called immediately
    const { startSessionCleanup } = await import('../server/jobs/sessionCleanup.js');
    const cleanupSpy = jest.spyOn(global, 'setInterval');

    startSessionCleanup();

    expect(cleanupSpy).toHaveBeenCalledWith(expect.any(Function), 3600000);
    cleanupSpy.mockRestore();
  });
});
```

---

### 13.4 Audit Logging Tests

```javascript
describe('Audit logging', () => {
  test('logs successful login to audit_logs table', async () => {
    const res = await loginWithGoogle(VALID_TEST_TOKEN);
    const userId = res.body.user.id;

    const logs = await pool.query(
      `SELECT * FROM audit_logs WHERE user_id = $1 AND action = 'LOGIN_SUCCESS'
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );

    expect(logs.rows.length).toBe(1);
    expect(logs.rows[0].metadata).toHaveProperty('provider', 'google');
  });

  test('logs failed login attempts', async () => {
    await request(app)
      .post('/api/auth/google')
      .send({ credential: 'invalid-token' });

    const logs = await pool.query(
      `SELECT * FROM audit_logs WHERE action = 'LOGIN_FAILED'
       ORDER BY created_at DESC LIMIT 1`
    );

    expect(logs.rows.length).toBe(1);
    expect(logs.rows[0].metadata).toHaveProperty('reason', 'INVALID_TOKEN');
  });

  test('logs session expiry', async () => {
    // Create expired session
    const sessionId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO sessions (id, user_id, expires_at)
       VALUES ($1, $2, NOW() - INTERVAL '1 day')`,
      [sessionId, testUserId]
    );

    // Trigger expiry check
    await request(app)
      .get('/api/auth/me')
      .set('Cookie', `healthup_session=${sessionId}`);

    const logs = await pool.query(
      `SELECT * FROM audit_logs WHERE action = 'SESSION_EXPIRED'
       AND user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [testUserId]
    );

    expect(logs.rows.length).toBe(1);
  });
});
```

---

## 14. Deployment Checklist

### Pre-Deployment

**CRITICAL - Infrastructure Requirements:**
- [ ] `adminPool` and `validateAdminPool` exported from `server/db/index.js` (see Section 6.1)
- [ ] `validateAdminPool()` called during app startup in `server/app.js` (see Section 7.1)
- [ ] `ADMIN_DATABASE_URL` configured (must point to role with BYPASSRLS privilege, e.g., `healthup_admin`)
- [ ] `cookie-parser` middleware applied in `server/app.js` BEFORE auth routes (see Section 9.1)
- [ ] Dependencies installed: `npm install cookie-parser google-auth-library helmet lru-cache`

**Configuration:**
- [ ] `GOOGLE_CLIENT_ID` added to `.env`
- [ ] `ADMIN_EMAIL_ALLOWLIST` configured with admin email addresses
- [ ] `SESSION_TTL_MS` set (default: 1209600000 = 14 days)
- [ ] `.env.example` updated with new variables

### Deployment Steps

1. **Install dependencies**: `npm install`
2. **Boot application**: `npm run dev`
3. **Verify endpoints**:
   - `GET /api/auth/config` returns Google Client ID
   - Admin endpoints return 401 without auth
4. **Run tests**: `npm test`

### Post-Deployment Validation

**Critical Infrastructure Checks:**
- [ ] `validateAdminPool()` passes on startup (look for "adminPool validated: BYPASSRLS privilege confirmed" in logs)
- [ ] Server fails fast with clear error if BYPASSRLS is missing (test by misconfiguring ADMIN_DATABASE_URL)
- [ ] `cookie-parser` middleware is active (test: curl with Cookie header, verify `req.cookies` is populated)
- [ ] Verify `server/db/index.js` exports both `pool` and `adminPool`
- [ ] Verify `server/app.js` contains `app.use(cookieParser())` before auth routes

**Functional Validation:**
- [ ] `/api/auth/config` returns correct `googleClientId` and `sessionMaxAge` in seconds
- [ ] `/api/auth/me` returns 401 with code `NOT_AUTHENTICATED` (no session yet, not undefined error)
- [ ] Admin endpoints require authentication AND admin authorization
- [ ] Non-admin authenticated users blocked from admin endpoints (403 Forbidden)
- [ ] Session cleanup job running (check console logs for "Session cleanup job started")
- [ ] Session cache functional (after login, check logs for cache hits on subsequent requests)
- [ ] Session cache validates `expires_at` on cache hits
- [ ] Audit logs being written to database (check `audit_logs` table after login/logout)
- [ ] Helmet security headers present (check response headers for `X-Frame-Options`, etc.)
- [ ] No errors in application logs related to auth operations

---

## 15. What's Next?

**Part 3 (RLS-Scoped Data Access)** will:
- Migrate patient/report routes to use `queryWithUser()`
- Update lab ingestion pipeline to set RLS context in transactions
- Switch agentic SQL to use `executeUserScopedSQL()`
- Apply `FORCE ROW LEVEL SECURITY` on all patient tables
- Test data isolation across multiple users

**Future Enhancements (Post-MVP):**
- Redis-backed session cache for multi-instance deployments (eliminates 5-minute inconsistency window)
- Rate limiting on auth endpoints (prevent brute force attacks)
- Session fingerprinting (IP + User-Agent validation)
- Refresh token rotation for enhanced security

**Part 2 output**: Fully functional auth backend, ready to protect routes in Part 3.
