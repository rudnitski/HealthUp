// server/utils/auditLog.js
// PRD v4.4.2: Audit logging for authentication events
// Logs to console (synchronous) + database (fire-and-forget)

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
 *
 * @param {object} event - Audit event details
 * @param {string|null} event.userId - User ID (null for failed logins)
 * @param {string} event.action - Action type (LOGIN_SUCCESS, LOGIN_FAILED, LOGOUT, SESSION_EXPIRED)
 * @param {string|null} event.resourceType - Resource type being accessed
 * @param {string|null} event.resourceId - Resource ID being accessed
 * @param {string|null} event.ipAddress - Client IP address
 * @param {string|null} event.userAgent - Client user agent
 * @param {object} event.metadata - Additional metadata (provider, session_id, etc.)
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
  ).catch(err => console.error('[auditLog] Failed to write audit log:', err.message));
}
