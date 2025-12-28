// test/db/auth-behavior.test.js
import pkg from 'pg';
const { Pool } = pkg;
import { pool } from '../../server/db/index.js';

describe('Part 1: No Behavioral Changes', () => {
  test('existing patient queries still work', async () => {
    // Should work even without setting RLS context (NULL escape hatch)
    const result = await pool.query('SELECT * FROM patients');
    expect(result.rows).toBeDefined();
  });

  test('can still insert patients without user_id', async () => {
    const result = await pool.query(`
      INSERT INTO patients (id, full_name, date_of_birth, gender)
      VALUES (gen_random_uuid(), 'Test Patient', '1990-01-01', 'M')
      RETURNING id
    `);

    expect(result.rows[0].id).toBeDefined();
  });

  test('can query patient_reports without RLS context', async () => {
    const result = await pool.query('SELECT COUNT(*) FROM patient_reports');
    expect(result.rows[0].count).toBeDefined();
  });

  test('can query lab_results without RLS context', async () => {
    const result = await pool.query('SELECT COUNT(*) FROM lab_results');
    expect(result.rows[0].count).toBeDefined();
  });
});

describe('Part 1: Security Safeguards', () => {
  let testUserId;

  test('user deletion is blocked by trigger', async () => {
    // Create test user with unique email
    const uniqueEmail = `test-deletion-${Date.now()}@example.com`;
    const user = await pool.query(`
      INSERT INTO users (display_name, primary_email)
      VALUES ('Test User', $1)
      RETURNING id
    `, [uniqueEmail]);

    testUserId = user.rows[0].id;

    // Attempt deletion should fail
    await expect(
      pool.query('DELETE FROM users WHERE id = $1', [testUserId])
    ).rejects.toThrow(/User deletion is disabled during authentication migration/);

    // Verify user still exists
    const check = await pool.query('SELECT id FROM users WHERE id = $1', [testUserId]);
    expect(check.rows.length).toBe(1);
  });

  test('audit_logs are blocked for app role (admin-only)', async () => {
    if (!process.env.DATABASE_APP_URL) {
      console.warn('Skipping audit_logs test: DATABASE_APP_URL not configured');
      return;
    }

    const appPool = new Pool({ connectionString: process.env.DATABASE_APP_URL });

    try {
      // Insert audit log entry as owner
      await pool.query(`
        INSERT INTO audit_logs (action, metadata)
        VALUES ('TEST_ACTION', '{"test": true}')
      `);

      // App role should see no rows (USING false policy)
      const result = await appPool.query('SELECT * FROM audit_logs');
      expect(result.rows.length).toBe(0);
    } finally {
      await appPool.end();
    }
  });

  test('sessions are isolated by user_id', async () => {
    if (!process.env.DATABASE_APP_URL) {
      console.warn('Skipping sessions isolation test: DATABASE_APP_URL not configured');
      return;
    }

    // Create two test users with unique emails
    const timestamp = Date.now();
    const user1 = await pool.query(`
      INSERT INTO users (display_name, primary_email)
      VALUES ('User One', $1)
      RETURNING id
    `, [`user1-session-${timestamp}@example.com`]);
    const user2 = await pool.query(`
      INSERT INTO users (display_name, primary_email)
      VALUES ('User Two', $1)
      RETURNING id
    `, [`user2-session-${timestamp}@example.com`]);

    const userId1 = user1.rows[0].id;
    const userId2 = user2.rows[0].id;

    // Create sessions for both users
    await pool.query(`
      INSERT INTO sessions (user_id, expires_at)
      VALUES ($1, NOW() + INTERVAL '1 hour'), ($2, NOW() + INTERVAL '1 hour')
    `, [userId1, userId2]);

    const appPool = new Pool({ connectionString: process.env.DATABASE_APP_URL });

    try {
      const client = await appPool.connect();

      try {
        // Start transaction (required for SET LOCAL)
        await client.query('BEGIN');

        // Set context to user1
        // Note: SET LOCAL doesn't support parameter placeholders, must use string interpolation
        await client.query(`SET LOCAL app.current_user_id = '${userId1}'`);

        // Should only see user1's session
        const result = await client.query('SELECT user_id FROM sessions');
        expect(result.rows.length).toBe(1);
        expect(result.rows[0].user_id).toBe(userId1);

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } finally {
      await appPool.end();
    }
  });

  test('NULL user_id escape hatch works for patients', async () => {
    if (!process.env.DATABASE_APP_URL) {
      console.warn('Skipping NULL escape hatch test: DATABASE_APP_URL not configured');
      return;
    }

    // Create patient with NULL user_id
    const patient = await pool.query(`
      INSERT INTO patients (id, full_name, date_of_birth, gender, user_id)
      VALUES (gen_random_uuid(), 'Unassigned Patient', '1990-01-01', 'F', NULL)
      RETURNING id
    `);

    const appPool = new Pool({ connectionString: process.env.DATABASE_APP_URL });

    try {
      // Should be able to see NULL user_id patient (escape hatch)
      const result = await appPool.query('SELECT id FROM patients WHERE id = $1', [patient.rows[0].id]);
      expect(result.rows.length).toBe(1);
    } finally {
      await appPool.end();
    }
  });
});

// Close shared pool after all tests in this file complete
afterAll(async () => {
  await pool.end();
});
