// server/db/index.js (ESM)
import { Pool } from 'pg';

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

// Log and exit if the pool encounters an unexpected error
pool.on('error', (err) => {
  console.error('[db] Unexpected error on idle client', err);
  process.exit(1);
});

async function healthcheck() {
  const { rows } = await pool.query('select 1 as ok');
  return rows[0]?.ok === 1;
}

export { pool, healthcheck };
