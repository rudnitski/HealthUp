// server/db/index.js (ESM)
// PRD v4.4.2: Authentication infrastructure support
import { Pool } from 'pg';

// =============================================================================
// Environment Validation (Fail-Fast)
// =============================================================================

// GOOGLE_CLIENT_ID is required for Google OAuth authentication
if (!process.env.GOOGLE_CLIENT_ID) {
  console.error('═══════════════════════════════════════════════════════════════');
  console.error('FATAL: GOOGLE_CLIENT_ID environment variable is required');
  console.error('═══════════════════════════════════════════════════════════════');
  console.error('Google OAuth authentication requires a valid client ID from Google Cloud Console.');
  console.error('');
  console.error('To configure:');
  console.error('  1. Go to https://console.cloud.google.com/apis/credentials');
  console.error('  2. Create or select an OAuth 2.0 Client ID');
  console.error('  3. Add GOOGLE_CLIENT_ID to your .env file');
  console.error('═══════════════════════════════════════════════════════════════');
  process.exit(1);
}

// ADMIN_DATABASE_URL is required for auth middleware, logout, and audit logging
if (!process.env.ADMIN_DATABASE_URL) {
  console.error('═══════════════════════════════════════════════════════════════');
  console.error('FATAL: ADMIN_DATABASE_URL environment variable is required');
  console.error('═══════════════════════════════════════════════════════════════');
  console.error('Auth middleware, session management, and audit logging require a BYPASSRLS role.');
  console.error('');
  console.error('To configure:');
  console.error('  1. Create healthup_admin role with BYPASSRLS privilege');
  console.error('  2. Set ADMIN_DATABASE_URL=postgresql://healthup_admin:password@localhost:5432/healthup');
  console.error('');
  console.error('See PRD v4.4.2 Section 6.2 for setup instructions.');
  console.error('═══════════════════════════════════════════════════════════════');
  process.exit(1);
}

// =============================================================================
// Database Pools
// =============================================================================

// Primary application pool (uses DATABASE_URL - healthup_owner or healthup_app)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // If you later move to a managed DB requiring TLS, enable:
  // ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 15_000,
  query_timeout: 20_000,
});

// Admin pool (bypasses RLS for session/audit operations)
// REQUIRED: Must connect with role having BYPASSRLS privilege (e.g., healthup_admin)
const adminPool = new Pool({
  connectionString: process.env.ADMIN_DATABASE_URL,
  max: 5, // Fewer connections needed for admin operations
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 15_000,
  query_timeout: 20_000,
});

// Log and exit if pools encounter unexpected errors
pool.on('error', (err) => {
  console.error('[db] Unexpected error on idle client', err);
  process.exit(1);
});

adminPool.on('error', (err) => {
  console.error('[db:admin] Unexpected error on idle client', err);
  process.exit(1);
});

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * healthcheck - Verify primary pool connectivity
 */
async function healthcheck() {
  const { rows } = await pool.query('select 1 as ok');
  return rows[0]?.ok === 1;
}

/**
 * validateAdminPool - Startup check for BYPASSRLS privilege
 * Called during app initialization to fail fast if adminPool is misconfigured.
 *
 * CRITICAL: Without BYPASSRLS, auth middleware, logout, and audit logging will fail
 * at runtime with cryptic "permission denied" errors instead of a clear startup error.
 *
 * NOTE: We query pg_roles directly instead of testing against an RLS-protected table
 * because RLS policies filter rows (returning empty results) rather than throwing errors.
 * A LIMIT 0 query would succeed regardless of BYPASSRLS status.
 */
async function validateAdminPool() {
  try {
    // Query pg_roles system catalog to check if current role has BYPASSRLS privilege
    const result = await adminPool.query(`
      SELECT rolbypassrls
      FROM pg_roles
      WHERE rolname = current_user
    `);

    if (result.rows.length === 0) {
      console.error('═══════════════════════════════════════════════════════════════');
      console.error('FATAL: Could not determine adminPool role privileges');
      console.error('═══════════════════════════════════════════════════════════════');
      console.error('Unable to find current role in pg_roles.');
      console.error('═══════════════════════════════════════════════════════════════');
      process.exit(1);
    }

    if (!result.rows[0].rolbypassrls) {
      console.error('═══════════════════════════════════════════════════════════════');
      console.error('FATAL: adminPool role does not have BYPASSRLS privilege');
      console.error('═══════════════════════════════════════════════════════════════');
      console.error('Auth middleware, logout, and audit logging will fail.');
      console.error('');
      console.error('Fix: Ensure ADMIN_DATABASE_URL points to a role with BYPASSRLS.');
      console.error('Example: postgresql://healthup_admin:password@localhost:5432/healthup');
      console.error('');
      console.error('To grant BYPASSRLS, run as superuser:');
      console.error('  ALTER ROLE healthup_admin BYPASSRLS;');
      console.error('═══════════════════════════════════════════════════════════════');
      process.exit(1);
    }

    console.log('[db:admin] adminPool validated: BYPASSRLS privilege confirmed');
  } catch (error) {
    console.error('[db:admin] Failed to validate adminPool:', error.message);
    throw error;
  }
}

/**
 * queryWithUser - Execute single query with RLS context set
 *
 * @param {string} text - SQL query
 * @param {array} params - Query parameters
 * @param {string} userId - User ID for RLS context
 * @param {number|null} statementTimeoutMs - Optional statement timeout in milliseconds
 * @returns {Promise<QueryResult>}
 *
 * IMPORTANT: Wraps set_config + query in explicit transaction.
 * Without BEGIN/COMMIT, set_config(..., true) creates one implicit transaction,
 * then the data query creates a separate transaction where the config is lost.
 */
async function queryWithUser(text, params, userId, statementTimeoutMs = null) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Set RLS context (local to this transaction)
    await client.query(
      "SELECT set_config('app.current_user_id', $1, true)",
      [userId]
    );

    // Set statement timeout if provided (for agentic SQL queries)
    // NOTE: SET LOCAL cannot use $1 bind parameter - PostgreSQL requires literal values
    // We validate as integer to prevent SQL injection
    if (statementTimeoutMs !== null && statementTimeoutMs > 0) {
      const timeoutValue = parseInt(statementTimeoutMs, 10);
      if (!Number.isFinite(timeoutValue) || timeoutValue <= 0) {
        throw new Error('statementTimeoutMs must be a positive integer');
      }
      await client.query(`SET LOCAL statement_timeout = ${timeoutValue}`);
    }

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
 * withUserTransaction - Execute multiple queries with RLS context in single transaction
 *
 * @param {string} userId - User ID for RLS context
 * @param {Function} callback - async (client) => { ... } function
 * @returns {Promise<any>} Result from callback
 *
 * Use this for multi-query operations like:
 * - Report retrieval (patient + reports in one transaction)
 * - Any business logic requiring multiple queries
 * - Operations needing atomicity across queries
 *
 * IMPORTANT: Do NOT nest these helpers. If already inside withUserTransaction(),
 * use client.query() directly (RLS context is already set).
 */
async function withUserTransaction(userId, callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Set RLS context (local to this transaction)
    await client.query(
      "SELECT set_config('app.current_user_id', $1, true)",
      [userId]
    );

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

/**
 * queryAsAdmin - Execute query bypassing RLS (admin panel only)
 *
 * @param {string} text - SQL query
 * @param {array} params - Query parameters
 * @returns {Promise<QueryResult>}
 */
async function queryAsAdmin(text, params) {
  return adminPool.query(text, params);
}

export { pool, adminPool, healthcheck, validateAdminPool, queryWithUser, withUserTransaction, queryAsAdmin };
