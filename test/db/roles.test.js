// test/db/roles.test.js
import pkg from 'pg';
const { Pool } = pkg;
import { describeIf } from '../helpers/conditional.js';
import { pool } from '../../server/db/index.js';

// Skip entire suite if role infrastructure not configured
const hasRoleInfrastructure =
  process.env.DATABASE_APP_URL && process.env.ADMIN_DATABASE_URL;

describeIf(hasRoleInfrastructure, 'Database Roles', () => {
  afterAll(async () => {
    await pool.end();
  });

  test('healthup_app can SELECT from patients', async () => {
    const appPool = new Pool({ connectionString: process.env.DATABASE_APP_URL });
    try {
      const result = await appPool.query('SELECT COUNT(*) FROM patients');
      expect(result.rows[0].count).toBeDefined();
    } finally {
      await appPool.end();
    }
  });

  test('healthup_app can INSERT into patients', async () => {
    const appPool = new Pool({ connectionString: process.env.DATABASE_APP_URL });
    try {
      const result = await appPool.query(`
        INSERT INTO patients (id, full_name, date_of_birth, gender)
        VALUES (gen_random_uuid(), 'Test Role Patient', '1990-01-01', 'M')
        RETURNING id
      `);
      expect(result.rows[0].id).toBeDefined();
    } finally {
      await appPool.end();
    }
  });

  test('healthup_admin has BYPASSRLS', async () => {
    const result = await pool.query(`
      SELECT rolname, rolbypassrls
      FROM pg_roles
      WHERE rolname = 'healthup_admin'
    `);

    expect(result.rows.length).toBe(1);
    expect(result.rows[0].rolbypassrls).toBe(true);
  });

  test('healthup_app does NOT have BYPASSRLS', async () => {
    const result = await pool.query(`
      SELECT rolname, rolbypassrls
      FROM pg_roles
      WHERE rolname = 'healthup_app'
    `);

    expect(result.rows.length).toBe(1);
    expect(result.rows[0].rolbypassrls).toBe(false);
  });

  test('healthup_owner exists and owns tables', async () => {
    const result = await pool.query(`
      SELECT t.tablename, pg_catalog.pg_get_userbyid(c.relowner) AS owner
      FROM pg_tables t
      JOIN pg_class c ON c.relname = t.tablename
      WHERE t.schemaname = 'public'
        AND t.tablename IN ('users', 'sessions', 'audit_logs', 'patients')
    `);

    expect(result.rows.length).toBeGreaterThan(0);
    result.rows.forEach(row => {
      expect(row.owner).toBe('healthup_owner');
    });
  });
});
