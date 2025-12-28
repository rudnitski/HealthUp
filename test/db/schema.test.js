// test/db/schema.test.js
import { pool } from '../../server/db/index.js';

describe('Part 1: Schema + RLS Groundwork', () => {
  afterAll(async () => {
    await pool.end();
  });

  test('users table exists with correct columns', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'users'
      ORDER BY ordinal_position
    `);

    expect(result.rows).toMatchObject([
      { column_name: 'id', data_type: 'uuid', is_nullable: 'NO' },
      { column_name: 'display_name', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'primary_email', data_type: 'USER-DEFINED', is_nullable: 'YES' }, // CITEXT is USER-DEFINED
      { column_name: 'avatar_url', data_type: 'text', is_nullable: 'YES' },
      { column_name: 'created_at', data_type: 'timestamp with time zone', is_nullable: 'NO' },
      { column_name: 'updated_at', data_type: 'timestamp with time zone', is_nullable: 'NO' },
      { column_name: 'last_login_at', data_type: 'timestamp with time zone', is_nullable: 'YES' }
    ]);
  });

  test('user_identities table exists with correct columns', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'user_identities'
      ORDER BY ordinal_position
    `);

    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ column_name: 'id', data_type: 'uuid', is_nullable: 'NO' }),
      expect.objectContaining({ column_name: 'user_id', data_type: 'uuid', is_nullable: 'NO' }),
      expect.objectContaining({ column_name: 'provider', data_type: 'text', is_nullable: 'NO' }),
      expect.objectContaining({ column_name: 'provider_subject', data_type: 'text', is_nullable: 'NO' })
    ]));
  });

  test('sessions table exists with correct columns', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'sessions'
      ORDER BY ordinal_position
    `);

    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ column_name: 'id', data_type: 'uuid', is_nullable: 'NO' }),
      expect.objectContaining({ column_name: 'user_id', data_type: 'uuid', is_nullable: 'NO' }),
      expect.objectContaining({ column_name: 'expires_at', is_nullable: 'NO' }),
      expect.objectContaining({ column_name: 'revoked_at', is_nullable: 'YES' })
    ]));
  });

  test('audit_logs table exists with correct columns', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'audit_logs'
      ORDER BY ordinal_position
    `);

    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ column_name: 'id', is_nullable: 'NO' }),
      expect.objectContaining({ column_name: 'user_id', data_type: 'uuid', is_nullable: 'YES' }),
      expect.objectContaining({ column_name: 'action', data_type: 'text', is_nullable: 'NO' })
    ]));
  });

  test('patients.user_id column added', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'patients' AND column_name = 'user_id'
    `);

    expect(result.rows.length).toBe(1);
    expect(result.rows[0].data_type).toBe('uuid');
  });

  test('RLS policies created on all data tables', async () => {
    const result = await pool.query(`
      SELECT tablename, policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename IN ('patients', 'patient_reports', 'lab_results', 'audit_logs', 'sessions')
    `);

    expect(result.rows.length).toBe(5);
    expect(result.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ tablename: 'patients', policyname: 'user_isolation_patients' }),
      expect.objectContaining({ tablename: 'patient_reports', policyname: 'user_isolation_reports' }),
      expect.objectContaining({ tablename: 'lab_results', policyname: 'user_isolation_lab_results' }),
      expect.objectContaining({ tablename: 'audit_logs', policyname: 'audit_logs_admin_only' }),
      expect.objectContaining({ tablename: 'sessions', policyname: 'session_isolation' })
    ]));
  });

  test('RLS is enabled but not forced (yet)', async () => {
    const result = await pool.query(`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname IN ('patients', 'patient_reports', 'lab_results', 'audit_logs', 'sessions')
    `);

    result.rows.forEach(row => {
      expect(row.relrowsecurity).toBe(true);  // RLS enabled
      expect(row.relforcerowsecurity).toBe(false);  // NOT forced yet
    });
  });

  test('user deletion guard trigger exists', async () => {
    const result = await pool.query(`
      SELECT tgname FROM pg_trigger
      WHERE tgname = 'block_user_deletion'
    `);

    expect(result.rows.length).toBe(1);
  });

  test('prevent_user_deletion function exists', async () => {
    const result = await pool.query(`
      SELECT proname FROM pg_proc
      WHERE proname = 'prevent_user_deletion'
    `);

    expect(result.rows.length).toBe(1);
  });

  test('auth table indexes created', async () => {
    const result = await pool.query(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'idx_user_identities_user_id',
          'idx_sessions_user_id',
          'idx_sessions_expires_at',
          'idx_audit_logs_user_id',
          'idx_patients_user_id'
        )
    `);

    expect(result.rows.length).toBeGreaterThanOrEqual(5);
  });
});
