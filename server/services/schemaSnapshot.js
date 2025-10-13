const crypto = require('crypto');
const { pool } = require('../db');

// Configuration
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_DEV = NODE_ENV === 'development';
const SCHEMA_CACHE_TTL_MS = Number.isFinite(Number(process.env.SQL_SCHEMA_CACHE_TTL_MS))
  ? Number(process.env.SQL_SCHEMA_CACHE_TTL_MS)
  : IS_DEV
    ? 60 * 1000 // 1 minute in dev
    : 5 * 60 * 1000; // 5 minutes in production

const SCHEMA_WHITELIST = process.env.SCHEMA_WHITELIST
  ? process.env.SCHEMA_WHITELIST.split(',').map((s) => s.trim()).filter(Boolean)
  : ['public'];

// In-memory cache
let cachedSchema = null;
let schemaSnapshotId = null;
let cacheTimestamp = null;
let listenClient = null;

// MRU (Most Recently Used) cache for table ranking
const MRU_MAX_SIZE = 50;
const mruTables = []; // Array of table names, most recent at the end

/**
 * Compute SHA-256 hash of schema manifest
 */
function computeSnapshotId(manifest) {
  const serialized = JSON.stringify(manifest);
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

/**
 * Fetch schema from database including foreign key relationships
 */
async function fetchSchemaFromDatabase() {
  const client = await pool.connect();
  try {
    // Fetch columns
    const { rows: columnRows } = await client.query(
      `
      SELECT
        c.table_schema,
        c.table_name,
        c.column_name,
        c.data_type,
        c.is_nullable
      FROM information_schema.columns c
      WHERE c.table_schema = ANY($1::text[])
      ORDER BY c.table_schema, c.table_name, c.ordinal_position
      `,
      [SCHEMA_WHITELIST],
    );

    // Fetch foreign key relationships
    const { rows: fkRows } = await client.query(
      `
      SELECT
        tc.table_schema,
        tc.table_name,
        kcu.column_name,
        ccu.table_schema AS foreign_table_schema,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = ANY($1::text[])
      `,
      [SCHEMA_WHITELIST],
    );

    // Build schema manifest
    const tables = {};
    columnRows.forEach((row) => {
      const fullTableName = `${row.table_schema}.${row.table_name}`;
      if (!tables[fullTableName]) {
        tables[fullTableName] = {
          schema: row.table_schema,
          name: row.table_name,
          columns: [],
          foreignKeys: [],
        };
      }

      tables[fullTableName].columns.push({
        name: row.column_name,
        type: row.data_type,
        nullable: row.is_nullable === 'YES',
      });
    });

    // Add foreign key relationships
    fkRows.forEach((row) => {
      const fullTableName = `${row.table_schema}.${row.table_name}`;
      if (tables[fullTableName]) {
        tables[fullTableName].foreignKeys.push({
          column: row.column_name,
          referencesTable: `${row.foreign_table_schema}.${row.foreign_table_name}`,
          referencesColumn: row.foreign_column_name,
        });
      }
    });

    const manifest = {
      tables: Object.values(tables),
      fetchedAt: new Date().toISOString(),
    };

    return manifest;
  } finally {
    client.release();
  }
}

/**
 * Refresh the schema cache
 */
async function refreshSchemaCache() {
  try {
    const manifest = await fetchSchemaFromDatabase();
    const newSnapshotId = computeSnapshotId(manifest);

    // If schema changed, reset MRU cache
    if (schemaSnapshotId && schemaSnapshotId !== newSnapshotId) {
      mruTables.length = 0;
      console.info('[schemaSnapshot] Schema changed, MRU cache reset');
    }

    cachedSchema = manifest;
    schemaSnapshotId = newSnapshotId;
    cacheTimestamp = Date.now();

    console.info(`[schemaSnapshot] Schema cache refreshed: ${schemaSnapshotId.substring(0, 8)}...`);
    return manifest;
  } catch (error) {
    console.error('[schemaSnapshot] Failed to refresh schema cache:', error);
    throw error;
  }
}

/**
 * Get cached schema or refresh if stale
 */
async function getSchemaSnapshot() {
  const now = Date.now();

  // Check if cache is still valid
  if (cachedSchema && cacheTimestamp && (now - cacheTimestamp < SCHEMA_CACHE_TTL_MS)) {
    return {
      manifest: cachedSchema,
      snapshotId: schemaSnapshotId,
      fromCache: true,
    };
  }

  // Cache is stale or doesn't exist, refresh it
  const manifest = await refreshSchemaCache();
  return {
    manifest,
    snapshotId: schemaSnapshotId,
    fromCache: false,
  };
}

/**
 * Manually bust the cache (for admin endpoint)
 */
async function bustCache() {
  console.info('[schemaSnapshot] Manual cache bust triggered');
  const manifest = await refreshSchemaCache();

  // Notify other instances via PostgreSQL NOTIFY
  try {
    await pool.query("NOTIFY invalidate_schema, 'bust'");
    console.info('[schemaSnapshot] Sent NOTIFY invalidate_schema to other instances');
  } catch (notifyError) {
    console.warn('[schemaSnapshot] Failed to send NOTIFY (single-instance invalidation only):', notifyError.message);
  }

  return {
    manifest,
    snapshotId: schemaSnapshotId,
  };
}

/**
 * Update MRU cache with recently used table
 */
function updateMRU(tableName) {
  // Remove if already exists
  const index = mruTables.indexOf(tableName);
  if (index !== -1) {
    mruTables.splice(index, 1);
  }

  // Add to end (most recent)
  mruTables.push(tableName);

  // Trim if over size
  if (mruTables.length > MRU_MAX_SIZE) {
    mruTables.shift();
  }
}

/**
 * Get MRU score for a table (higher = more recently used)
 */
function getMRUScore(tableName) {
  const index = mruTables.indexOf(tableName);
  if (index === -1) return 0;
  return index + 1; // 1-based score
}

/**
 * Get all MRU tables
 */
function getMRUTables() {
  return [...mruTables];
}

/**
 * Set up PostgreSQL LISTEN for distributed cache invalidation
 */
async function setupCacheInvalidationListener() {
  if (listenClient) return;

  try {
    const client = await pool.connect();
    listenClient = client;

    client.on('notification', async (msg) => {
      if (msg.channel === 'invalidate_schema') {
        console.info('[schemaSnapshot] Received cache invalidation notification');
        try {
          await refreshSchemaCache();
        } catch (error) {
          console.error('[schemaSnapshot] Failed to refresh cache after notification:', error);
        }
      }
    });

    await client.query('LISTEN invalidate_schema');
    console.info('[schemaSnapshot] Listening for cache invalidation notifications');

    // Keep connection alive (don't release it)
    client.on('error', (err) => {
      console.error('[schemaSnapshot] LISTEN client error:', err);
      listenClient = null;
    });
  } catch (error) {
    listenClient = null;
    console.warn('[schemaSnapshot] Failed to set up LISTEN (single-instance mode):', error.message);
  }
}

/**
 * Initialize schema cache on startup
 */
async function warmupCache() {
  console.info('[schemaSnapshot] Warming up schema cache...');
  try {
    await refreshSchemaCache();
    console.info('[schemaSnapshot] Cache warmup completed');
  } catch (error) {
    console.error('[schemaSnapshot] Cache warmup failed:', error);
  }
}

/**
 * Tear down schema snapshot resources (LISTEN client, etc.)
 */
async function shutdownSchemaSnapshot() {
  if (!listenClient) return;

  try {
    listenClient.removeAllListeners('notification');
    listenClient.removeAllListeners('error');
    await listenClient.query('UNLISTEN invalidate_schema');
  } catch (error) {
    console.warn('[schemaSnapshot] Failed to UNLISTEN during shutdown:', error.message);
  } finally {
    try {
      listenClient.release();
    } catch (releaseError) {
      console.warn('[schemaSnapshot] Failed to release LISTEN client during shutdown:', releaseError.message);
    }
    listenClient = null;
  }
}

// Warm up cache on module load (non-blocking)
warmupCache().catch((err) => console.error('[schemaSnapshot] Warmup error:', err));

// Set up LISTEN for cache invalidation (non-blocking)
setupCacheInvalidationListener().catch((err) => console.error('[schemaSnapshot] LISTEN setup error:', err));

module.exports = {
  getSchemaSnapshot,
  bustCache,
  updateMRU,
  getMRUScore,
  getMRUTables,
  computeSnapshotId,
  shutdownSchemaSnapshot,
};
