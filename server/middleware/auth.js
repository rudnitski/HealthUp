// server/middleware/auth.js
// PRD v4.4.2: Authentication and authorization middleware

import { adminPool } from '../db/index.js';
import { sessionCache } from '../utils/sessionCache.js';
import { logAuditEvent } from '../utils/auditLog.js';

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
  const sessionId = req.cookies?.healthup_session;

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
        logAuditEvent({
          userId: session.user_id,
          action: 'SESSION_EXPIRED',
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          metadata: { session_id: sessionId }
        });

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
      ).catch(err => console.error('[auth] Failed to update session activity:', err.message));

      // Update cache timestamp
      sessionData.last_activity_update = now;
      sessionCache.set(sessionId, sessionData);
    }

    // Compute admin status from ADMIN_EMAIL_ALLOWLIST
    // PRD v4.4.6: Required for chat session admin context and all authenticated endpoints
    const adminEmails = (process.env.ADMIN_EMAIL_ALLOWLIST || '')
      .split(',')
      .map(email => email.trim().toLowerCase())
      .filter(email => email.length > 0);

    // Attach user to request
    req.user = {
      id: sessionData.user_id,
      display_name: sessionData.display_name,
      email: sessionData.email,
      avatar_url: sessionData.avatar_url,
      is_admin: adminEmails.includes(sessionData.email.toLowerCase())
    };

    next();

  } catch (error) {
    console.error('[auth] Auth middleware error:', error.message, { sessionId });
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
  const sessionId = req.cookies?.healthup_session;

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
      // Compute admin status from ADMIN_EMAIL_ALLOWLIST
      const adminEmails = (process.env.ADMIN_EMAIL_ALLOWLIST || '')
        .split(',')
        .map(email => email.trim().toLowerCase())
        .filter(email => email.length > 0);

      req.user = {
        id: sessionData.user_id,
        display_name: sessionData.display_name,
        email: sessionData.email,
        avatar_url: sessionData.avatar_url,
        is_admin: adminEmails.includes(sessionData.email.toLowerCase())
      };
    } else {
      req.user = null;
    }

  } catch (error) {
    console.error('[auth] Optional auth error:', error.message);
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
    console.error('[auth] ADMIN_EMAIL_ALLOWLIST not configured - denying admin access');
    return res.status(403).json({
      error: 'Admin access not configured',
      code: 'ADMIN_NOT_CONFIGURED'
    });
  }

  const userEmail = req.user.email.toLowerCase();

  if (!adminEmails.includes(userEmail)) {
    console.warn(`[auth] Unauthorized admin access attempt: ${userEmail}`);
    return res.status(403).json({
      error: 'Forbidden - admin access required',
      code: 'FORBIDDEN'
    });
  }

  // User is authorized admin
  next();
}
