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
5. Cookie parser integration
6. Admin endpoint protection (as proof-of-concept)

### Key Constraints

- **Minimal UI impact**: No login page yet (Part 4), but `/api/auth/*` endpoints functional
- **Admin endpoints first**: Start with low-risk protection (admin panel, not main app)
- **Deployable**: Can coexist with unprotected routes (transition period)

### Success Criteria

✅ `/api/auth/google`, `/api/auth/logout`, `/api/auth/me` functional
✅ Session creation, validation, and revocation working
✅ `requireAuth` middleware blocks unauthenticated requests (returns 401)
✅ Admin endpoints use `queryAsAdmin()` with `ADMIN_DATABASE_URL`
✅ Session cleanup job removes expired sessions every hour
✅ Tests pass: login flow, logout, session expiry, cookie flags

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
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. Resolve or create user (transaction)                       │
│     - Lookup user_identities(provider='google', subject=sub)   │
│     - If exists: Update last_used_at, last_login_at            │
│     - If new: CREATE user + identity, log USER_CREATED         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. Create session + set HttpOnly cookie                       │
│     - INSERT INTO sessions (14-day expiry by default)          │
│     - Set-Cookie: healthup_session={uuid}; HttpOnly; Secure    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  6. Return user data                                            │
│     200 OK { success: true, user: {...} }                      │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Token Verification (Google ID Token)

```javascript
import { OAuth2Client } from 'google-auth-library';

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

async function verifyGoogleToken(credential) {
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
            SameSite=Strict;
            Max-Age=1209600;
            Path=/
```

**Error Responses:**

| Status | Code | Description |
|--------|------|-------------|
| 400 | `MISSING_CREDENTIAL` | Request body missing `credential` field |
| 401 | `INVALID_TOKEN` | Token signature verification failed |
| 401 | `TOKEN_EXPIRED` | Token past expiration time |
| 403 | `EMAIL_UNVERIFIED` | Google email not verified |
| 429 | `RATE_LIMIT_EXCEEDED` | Too many login attempts from IP |
| 500 | `INTERNAL_ERROR` | Database or server error |
| 503 | `SERVICE_UNAVAILABLE` | Google verification service down |

**Rate Limiting:**
- 10 requests per IP per minute (configurable via `LOGIN_RATE_LIMIT_MAX`)
- Window: 60 seconds (configurable via `LOGIN_RATE_LIMIT_WINDOW_MS`)

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
            SameSite=Strict;
            Max-Age=0;
            Path=/
```

**Database Operation:**
```sql
UPDATE sessions
SET revoked_at = NOW()
WHERE id = $1
```

**Error Responses:**

| Status | Code | Description |
|--------|------|-------------|
| 401 | `NOT_AUTHENTICATED` | No session cookie present |
| 500 | `INTERNAL_ERROR` | Failed to revoke session |

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
| 401 | `SESSION_REVOKED` | User logged out |

**Performance:** Lightweight join query, no rate limiting (used on every page load).

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

**Usage:** Frontend uses `googleClientId` to initialize Google Identity Services.

---

## 4. Middleware Implementation

### 4.1 File: `server/middleware/auth.js`

```javascript
import { pool } from '../db/index.js';
import logger from '../utils/logger.js';

/**
 * requireAuth - Authentication middleware
 * Validates session and attaches user to req.user
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
    // Fetch session with user data (single query join)
    const result = await pool.query(
      `SELECT
         s.id as session_id,
         s.user_id,
         s.expires_at,
         s.revoked_at,
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

    // Check if revoked
    if (session.revoked_at) {
      return res.status(401).json({
        error: 'Session revoked',
        code: 'SESSION_REVOKED',
        message: 'You have been logged out'
      });
    }

    // Check if expired
    if (new Date(session.expires_at) < new Date()) {
      return res.status(401).json({
        error: 'Session expired',
        code: 'SESSION_EXPIRED',
        message: 'Please sign in again'
      });
    }

    // Update last_activity_at (fire-and-forget)
    pool.query(
      'UPDATE sessions SET last_activity_at = NOW() WHERE id = $1',
      [sessionId]
    ).catch(err => logger.error({ err }, 'Failed to update session activity'));

    // Attach user to request
    req.user = {
      id: session.user_id,
      display_name: session.display_name,
      email: session.primary_email,
      avatar_url: session.avatar_url
    };

    next();

  } catch (error) {
    logger.error({ error: error.message, sessionId }, 'Auth middleware error');
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
    const result = await pool.query(
      `SELECT s.user_id, u.display_name, u.primary_email, u.avatar_url
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.id = $1 AND s.expires_at > NOW() AND s.revoked_at IS NULL`,
      [sessionId]
    );

    if (result.rows.length > 0) {
      req.user = {
        id: result.rows[0].user_id,
        display_name: result.rows[0].display_name,
        email: result.rows[0].primary_email,
        avatar_url: result.rows[0].avatar_url
      };
    } else {
      req.user = null;
    }

  } catch (error) {
    logger.error({ error: error.message }, 'Optional auth error');
    req.user = null;
  }

  next();
}
```

---

## 5. Database Helper Functions

### 5.1 File: `server/db/index.js` (additions)

```javascript
import pg from 'pg';
const { Pool } = pg;

// Existing pool (will use healthup_owner or current role in Part 2)
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// Admin pool (bypasses RLS for admin panel)
export const adminPool = new Pool({
  connectionString: process.env.ADMIN_DATABASE_URL || process.env.DATABASE_URL
});

/**
 * queryWithUser - Execute query with RLS context set
 *
 * @param {string} text - SQL query
 * @param {array} params - Query parameters
 * @param {string} userId - User ID for RLS context
 * @returns {Promise<QueryResult>}
 */
export async function queryWithUser(text, params, userId) {
  const client = await pool.connect();
  try {
    // Set RLS context (transaction-scoped)
    await client.query(
      "SELECT set_config('app.current_user_id', $1, true)",
      [userId]
    );

    // Execute query (RLS policies automatically filter)
    const result = await client.query(text, params);
    return result;

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
```

**Design Decisions:**
- `queryWithUser()` uses transaction-scoped `set_config` (third parameter = `true`)
- `queryAsAdmin()` uses separate connection pool with BYPASSRLS role
- Part 3 will migrate all patient/report routes to use these helpers

---

## 6. Session Cleanup Job

### 6.1 File: `server/jobs/sessionCleanup.js`

```javascript
import { pool } from '../db/index.js';
import logger from '../utils/logger.js';

/**
 * Delete expired and old revoked sessions
 * Runs every hour via setInterval
 */
export function startSessionCleanup() {
  const intervalMs = parseInt(process.env.SESSION_CLEANUP_INTERVAL_MS) || 3600000; // Default: 1 hour

  async function cleanup() {
    try {
      const result = await pool.query(`
        DELETE FROM sessions
        WHERE expires_at < NOW()
           OR (revoked_at IS NOT NULL AND revoked_at < NOW() - INTERVAL '7 days')
      `);

      logger.info({ deletedCount: result.rowCount }, 'Session cleanup completed');
    } catch (error) {
      logger.error({ error: error.message }, 'Session cleanup failed');
    }
  }

  // Run immediately on startup
  cleanup();

  // Then run periodically
  setInterval(cleanup, intervalMs);

  logger.info({ intervalMs }, 'Session cleanup job started');
}
```

**Cleanup Rules:**
- Delete sessions where `expires_at < NOW()` (expired)
- Delete sessions where `revoked_at < NOW() - 7 days` (old logouts, keep recent for audit)

**Call from** `server/app.js`:
```javascript
import { startSessionCleanup } from './jobs/sessionCleanup.js';

// After app setup
startSessionCleanup();
```

---

## 7. Integration with `server/app.js`

### 7.1 Add Cookie Parser

```javascript
import cookieParser from 'cookie-parser';

app.use(cookieParser());
```

### 7.2 Register Auth Routes

```javascript
import authRoutes from './routes/auth.js';

app.use('/api/auth', authRoutes);
```

### 7.3 Protect Admin Endpoints (Proof-of-Concept)

```javascript
import { requireAuth } from './middleware/auth.js';
import { queryAsAdmin } from './db/index.js';

// Example: Protect admin panel endpoints
app.get('/api/admin/pending-analytes', requireAuth, async (req, res) => {
  // Use queryAsAdmin to bypass RLS (admin sees all data)
  const result = await queryAsAdmin(
    'SELECT * FROM pending_analytes ORDER BY created_at DESC'
  );
  res.json(result.rows);
});
```

**Note:** Part 2 protects **only admin endpoints** as low-risk proof-of-concept. Part 3 will protect patient data routes.

---

## 8. Environment Variables

```bash
# .env additions for Part 2

# Google OAuth
GOOGLE_CLIENT_ID=123456789-abc123.apps.googleusercontent.com

# Session settings
SESSION_TTL_MS=1209600000  # 14 days in ms (default)
SESSION_CLEANUP_INTERVAL_MS=3600000  # 1 hour (default)

# Rate limiting
LOGIN_RATE_LIMIT_MAX=10  # Max login attempts per IP per window
LOGIN_RATE_LIMIT_WINDOW_MS=60000  # 1 minute window

# Admin database (bypasses RLS)
ADMIN_DATABASE_URL=postgresql://healthup_admin:admin_secure_password@localhost:5432/healthup
```

**Security:** Never commit `ADMIN_DATABASE_URL` credential. Use environment-specific secrets.

---

## 9. Testing Strategy

### 9.1 Auth Route Tests

```javascript
// test/routes/auth.test.js

describe('POST /api/auth/google', () => {
  test('returns 400 if credential missing', async () => {
    const res = await request(app)
      .post('/api/auth/google')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_CREDENTIAL');
  });

  test('sets HttpOnly cookie on success', async () => {
    // Mock Google token verification
    jest.spyOn(googleClient, 'verifyIdToken').mockResolvedValue({
      getPayload: () => ({
        sub: 'google-user-123',
        email: 'test@example.com',
        email_verified: true,
        name: 'Test User',
        picture: 'https://example.com/avatar.jpg'
      })
    });

    const res = await request(app)
      .post('/api/auth/google')
      .send({ credential: 'mock-token' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.headers['set-cookie'][0]).toContain('healthup_session=');
    expect(res.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(res.headers['set-cookie'][0]).toContain('Secure');
  });
});

describe('POST /api/auth/logout', () => {
  test('returns 401 if not authenticated', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(401);
  });

  test('revokes session and clears cookie', async () => {
    // Create session first
    const loginRes = await loginAsTestUser();
    const cookie = loginRes.headers['set-cookie'][0];

    const logoutRes = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookie);

    expect(logoutRes.status).toBe(200);
    expect(logoutRes.headers['set-cookie'][0]).toContain('Max-Age=0');
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
});
```

---

### 9.2 Middleware Tests

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

    // req.user should be populated (test via endpoint that echoes it)
    expect(res.body.user.id).toBeDefined();
  });
});
```

---

### 9.3 Session Cleanup Tests

```javascript
describe('Session cleanup job', () => {
  test('deletes expired sessions', async () => {
    // Create expired session
    await pool.query(
      `INSERT INTO sessions (id, user_id, expires_at)
       VALUES ($1, $2, NOW() - INTERVAL '1 day')`,
      ['expired-session', testUserId]
    );

    // Run cleanup
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

    await cleanup();

    const result = await pool.query(
      'SELECT * FROM sessions WHERE id = $1',
      [sessionId]
    );

    expect(result.rows.length).toBe(1);
  });
});
```

---

## 10. Deployment Checklist

### Pre-Deployment

- [ ] `GOOGLE_CLIENT_ID` added to `.env`
- [ ] `ADMIN_DATABASE_URL` configured (keep secret)
- [ ] Cookie parser dependency installed (`npm install cookie-parser`)
- [ ] google-auth-library installed (`npm install google-auth-library`)

### Deployment Steps

1. **Install dependencies**: `npm install`
2. **Boot application**: `npm run dev`
3. **Verify endpoints**:
   - `GET /api/auth/config` returns Google Client ID
   - Admin endpoints return 401 without auth
4. **Run tests**: `npm test`

### Post-Deployment Validation

- [ ] `/api/auth/config` returns correct `googleClientId`
- [ ] `/api/auth/me` returns 401 (no session yet)
- [ ] Admin endpoints require authentication
- [ ] Session cleanup job running (check logs)
- [ ] No errors in application logs

---

## 11. What's Next?

**Part 3 (RLS-Scoped Data Access)** will:
- Migrate patient/report routes to use `queryWithUser()`
- Update lab ingestion pipeline to set RLS context in transactions
- Switch agentic SQL to use `executeUserScopedSQL()`
- Apply `FORCE ROW LEVEL SECURITY` on all patient tables
- Test data isolation across multiple users

**Part 2 output**: Fully functional auth backend, ready to protect routes in Part 3.
