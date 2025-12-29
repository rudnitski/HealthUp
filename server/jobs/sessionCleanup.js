// server/jobs/sessionCleanup.js
// PRD v4.4.2: Session cleanup job for expired session removal

import { adminPool } from '../db/index.js';

let cleanupIntervalId = null;

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

    console.log(`[sessionCleanup] Cleanup completed: ${result.rowCount} sessions deleted`);

    // Also log total active sessions for monitoring
    const activeResult = await adminPool.query(`
      SELECT COUNT(*) as count FROM sessions WHERE expires_at > NOW()
    `);

    console.log(`[sessionCleanup] Active sessions: ${activeResult.rows[0].count}`);

  } catch (error) {
    console.error('[sessionCleanup] Cleanup failed:', error.message);
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
  cleanupIntervalId = setInterval(cleanup, intervalMs);

  console.log(`[sessionCleanup] Session cleanup job started (interval: ${intervalMs}ms)`);
}

/**
 * Stop the cleanup job (for graceful shutdown)
 */
export function stopSessionCleanup() {
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
    console.log('[sessionCleanup] Session cleanup job stopped');
  }
}
