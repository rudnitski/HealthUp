// server/routes/auth.js
// PRD v4.4.2: Authentication API endpoints

import express from 'express';
import { OAuth2Client } from 'google-auth-library';
import { pool, adminPool } from '../db/index.js';
import { sessionCache, invalidateSession } from '../utils/sessionCache.js';
import { logAuditEvent } from '../utils/auditLog.js';
import { requireAuth } from '../middleware/auth.js';

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
      console.error('[auth] Token verification failed:', verifyError.message);

      // Classify token error: TOKEN_EXPIRED vs INVALID_TOKEN
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
      maxAge: sessionTTL, // Express cookie maxAge is in milliseconds
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
    console.error('[auth] Login error:', error.message);

    // Check for unique constraint violation on primary_email (future-proofing for multi-provider)
    if (error.code === '23505' && error.constraint === 'users_primary_email_key') {
      return res.status(409).json({
        error: 'Email already registered with different provider',
        code: 'EMAIL_CONFLICT',
        message: 'This email is already associated with another account. Please use account linking (coming in Part 4).'
      });
    }

    // Check if Google API error
    if (error.message && error.message.toLowerCase().includes('google')) {
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
  const sessionId = req.cookies?.healthup_session;

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
    console.error('[auth] Logout error:', error.message);
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
router.get('/me', requireAuth, async (req, res) => {
  // requireAuth already validated session and attached req.user

  // Fetch additional user details
  // Note: users table doesn't have RLS (yet), but using pool is fine here
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
