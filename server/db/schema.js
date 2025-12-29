import { pool } from './index.js';
import fs from 'fs';
import path from 'path';
import { getDirname } from '../utils/path-helpers.js';

const __dirname = getDirname(import.meta.url);
const requirePgTrgm = String(process.env.REQUIRE_PG_TRGM || '').toLowerCase() === 'true';

const schemaStatements = [
  `
  CREATE TABLE IF NOT EXISTS patients (
    id UUID PRIMARY KEY,
    full_name TEXT,
    full_name_normalized TEXT UNIQUE,
    date_of_birth TEXT,
    gender TEXT,
    user_id UUID,  -- Added in Part 1: Associated user account (NULL for shared/unassigned patients)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_report_at TIMESTAMPTZ
  );
  `,
  `
  COMMENT ON TABLE patients IS 'Patient demographic information';
  `,
  `
  CREATE TABLE IF NOT EXISTS patient_reports (
    id UUID PRIMARY KEY,
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    source_filename TEXT,
    checksum TEXT NOT NULL,
    parser_version TEXT,
    status TEXT NOT NULL DEFAULT 'completed',
    recognized_at TIMESTAMPTZ NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL,
    test_date_text TEXT,
    patient_name_snapshot TEXT,
    patient_age_snapshot TEXT,
    patient_gender_snapshot TEXT,
    patient_date_of_birth_snapshot TEXT,
    raw_model_output TEXT,
    missing_data JSONB,
    file_path TEXT,
    file_mimetype TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (patient_id, checksum)
  );
  `,
  `
  COMMENT ON TABLE patient_reports IS 'Lab report documents parsed from PDFs';
  `,
  `
  COMMENT ON COLUMN patient_reports.test_date_text IS 'Test date as text extracted from lab report (e.g., "2024-03-15"). May be NULL if not found. Parse to timestamp for time-series queries.';
  `,
  `
  COMMENT ON COLUMN patient_reports.recognized_at IS 'Timestamp when the lab report was processed by OCR. Use as fallback date when test_date_text is NULL.';
  `,
  `
  COMMENT ON COLUMN patient_reports.file_path IS
    'Relative path to original uploaded file in filesystem (e.g., patient_uuid/report_uuid.pdf).';
  `,
  `
  COMMENT ON COLUMN patient_reports.file_mimetype IS
    'MIME type of uploaded file (e.g., application/pdf, image/jpeg). Used for Content-Type header in retrieval API.';
  `,
  `
  CREATE TABLE IF NOT EXISTS analytes (
    analyte_id SERIAL PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    unit_canonical TEXT,
    category TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  `,
  `
  COMMENT ON TABLE analytes IS 'Canonical analyte definitions with standardized codes';
  `,
  `
  COMMENT ON COLUMN analytes.code IS 'Unique analyte code (e.g., CHOL, HDL, VITD)';
  `,
  `
  COMMENT ON COLUMN analytes.name IS 'Canonical English name for display';
  `,
  `
  COMMENT ON COLUMN analytes.unit_canonical IS 'Standardized unit of measurement for this analyte. May differ from lab_results.unit which contains raw OCR values.';
  `,
  `
  CREATE TABLE IF NOT EXISTS analyte_aliases (
    analyte_id INT NOT NULL REFERENCES analytes(analyte_id) ON DELETE CASCADE,
    alias TEXT NOT NULL,
    alias_display TEXT,
    lang TEXT,
    confidence REAL DEFAULT 1.0,
    source TEXT DEFAULT 'seed',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (analyte_id, alias)
  );
  `,
  `
  COMMENT ON TABLE analyte_aliases IS 'Multilingual aliases for analyte matching';
  `,
  `
  COMMENT ON COLUMN analyte_aliases.alias IS 'Normalized lowercase form for matching (e.g., "интерлейкин 6")';
  `,
  `
  COMMENT ON COLUMN analyte_aliases.alias_display IS 'Original display form with proper casing and punctuation';
  `,
  `
  CREATE TABLE IF NOT EXISTS lab_results (
    id UUID PRIMARY KEY,
    report_id UUID NOT NULL REFERENCES patient_reports(id) ON DELETE CASCADE,
    position INT,
    parameter_name TEXT,
    result_value TEXT,
    unit TEXT,
    reference_lower NUMERIC,
    reference_lower_operator TEXT,
    reference_upper NUMERIC,
    reference_upper_operator TEXT,
    reference_text TEXT,
    reference_full_text TEXT,
    is_value_out_of_range BOOLEAN,
    numeric_result NUMERIC,
    specimen_type TEXT,
    analyte_id INT REFERENCES analytes(analyte_id),
    mapping_confidence REAL,
    mapped_at TIMESTAMPTZ,
    mapping_source TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  `,
  `
  COMMENT ON COLUMN lab_results.specimen_type IS 'Specimen type: blood or urine. Used to distinguish overlapping analytes (e.g., creatinine in blood vs urine).';
  `,
  `
  COMMENT ON TABLE lab_results IS 'Individual test results extracted from lab reports';
  `,
  `
  COMMENT ON COLUMN lab_results.mapping_confidence IS 'Confidence score (0-1) of the analyte mapping';
  `,
  `
  COMMENT ON COLUMN lab_results.mapped_at IS 'Timestamp when analyte_id was set';
  `,
  `
  COMMENT ON COLUMN lab_results.mapping_source IS 'Source of mapping: auto_exact, auto_fuzzy, auto_llm, manual_resolved, manual';
  `,
  `
  COMMENT ON COLUMN lab_results.result_value IS 'Raw result value from lab report. May contain: numeric values (e.g., "42.5", "120"), qualitative text (e.g., "Не обнаружено", "Положительный", "++"), reference ranges (e.g., "10-20"), or descriptive text. Use numeric_result for numeric queries.';
  `,
  `
  COMMENT ON COLUMN lab_results.numeric_result IS 'Pre-parsed numeric value extracted from result_value during OCR ingestion. Use this field for numeric filtering and sorting. NULL for text-only results.';
  `,
  `
  COMMENT ON COLUMN lab_results.parameter_name IS 'Original parameter name from lab report as recognized by OCR. May contain typos, variations, or non-standard naming. Use analyte_id for canonical mapping.';
  `,
  `
  COMMENT ON COLUMN lab_results.unit IS 'Unit of measurement as recognized from lab report (e.g., "нг/мл", "mmol/L"). May vary across labs. Use analyte.unit_canonical for standardized unit.';
  `,
  `
  COMMENT ON COLUMN lab_results.reference_lower IS 'Lower bound of reference range extracted from lab report. Use with reference_upper to determine normal range.';
  `,
  `
  COMMENT ON COLUMN lab_results.reference_upper IS 'Upper bound of reference range extracted from lab report. Use with reference_lower to determine normal range.';
  `,
  `
  COMMENT ON COLUMN lab_results.is_value_out_of_range IS 'Boolean flag indicating if the result is outside the reference range. Set during OCR ingestion based on lab report indicators.';
  `,
  `
  COMMENT ON COLUMN lab_results.analyte_id IS 'Foreign key to analytes table. NULL if parameter not yet mapped to canonical analyte. Use for joining with canonical analyte data.';
  `,
  `
  CREATE TABLE IF NOT EXISTS pending_analytes (
    pending_id BIGSERIAL PRIMARY KEY,
    proposed_code TEXT UNIQUE NOT NULL,
    proposed_name TEXT NOT NULL,
    unit_canonical TEXT,
    category TEXT,
    evidence JSONB,
    parameter_variations JSONB,
    confidence REAL,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'approved', 'discarded')),
    approved_at TIMESTAMPTZ,
    approved_analyte_id INT REFERENCES analytes(analyte_id),
    discarded_at TIMESTAMPTZ,
    discarded_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  `,
  `
  COMMENT ON TABLE pending_analytes IS 'LLM-proposed NEW analytes awaiting admin review';
  `,
  `
  COMMENT ON COLUMN pending_analytes.evidence IS 'Evidence structure: {report_id: UUID, result_id: UUID, parameter_name: string, unit: string, llm_comment: string, first_seen: ISO8601, last_seen: ISO8601, occurrence_count: int}';
  `,
  `
  COMMENT ON COLUMN pending_analytes.parameter_variations IS 'Array of parameter variations: [{raw: string, normalized: string, lang: string, count: int}]';
  `,
  `
  COMMENT ON COLUMN pending_analytes.discarded_reason IS 'Reason for discarding (e.g., "duplicate of CHOL", "not a lab analyte")';
  `,
  `
  CREATE TABLE IF NOT EXISTS match_reviews (
    review_id BIGSERIAL PRIMARY KEY,
    result_id UUID UNIQUE NOT NULL REFERENCES lab_results(id) ON DELETE CASCADE,
    candidates JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'resolved', 'skipped')),
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  `,
  `
  COMMENT ON TABLE match_reviews IS 'Ambiguous/medium-confidence matches awaiting admin disambiguation';
  `,
  `
  COMMENT ON COLUMN match_reviews.candidates IS 'Array of candidate matches: [{analyte_id: int, analyte_code: string, analyte_name: string, similarity: float, source: string}]';
  `,
  `
  COMMENT ON COLUMN match_reviews.resolved_at IS 'Timestamp when admin resolved this ambiguous match';
  `,
  `
  CREATE TABLE IF NOT EXISTS admin_actions (
    action_id BIGSERIAL PRIMARY KEY,
    action_type TEXT NOT NULL,
    entity_type TEXT,
    entity_id BIGINT,
    admin_user TEXT,
    changes JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  `,
  `
  COMMENT ON TABLE admin_actions IS 'Audit trail for all admin actions in the mapping write mode system';
  `,
  `
  CREATE TABLE IF NOT EXISTS sql_generation_logs (
    id UUID PRIMARY KEY,
    status TEXT NOT NULL,
    user_id_hash TEXT,
    prompt TEXT,
    prompt_language TEXT,
    generated_sql TEXT,
    model TEXT,
    confidence NUMERIC,
    latency_ms INT,
    error TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- v3.2: Conversational session tracking
    session_id TEXT
  );
  `,
  `
  COMMENT ON TABLE sql_generation_logs IS 'LLM-based SQL generation audit trail';
  `,
  // Gmail Integration Step 3: Attachment Provenance
  `
  CREATE TABLE IF NOT EXISTS gmail_report_provenance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL REFERENCES patient_reports(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL,
    attachment_id TEXT NOT NULL,
    sender_email TEXT,
    sender_name TEXT,
    email_subject TEXT,
    email_date TIMESTAMP,
    attachment_checksum TEXT NOT NULL,
    ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(message_id, attachment_id)
  );
  `,
  `
  COMMENT ON TABLE gmail_report_provenance IS 'Audit trail for reports ingested from Gmail';
  `,
  `
  COMMENT ON COLUMN gmail_report_provenance.message_id IS 'Gmail message ID (immutable identifier)';
  `,
  `
  COMMENT ON COLUMN gmail_report_provenance.attachment_id IS 'Gmail attachment ID within the message';
  `,
  `
  COMMENT ON COLUMN gmail_report_provenance.attachment_checksum IS 'SHA-256 hash of attachment for duplicate detection';
  `,
  // Indexes
  // PRD v4.3: Index for patient selector sorted by recent activity
  `
  CREATE INDEX IF NOT EXISTS idx_patients_last_seen_report_at
    ON patients (last_seen_report_at DESC NULLS LAST);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_patient_reports_patient_recognized
    ON patient_reports (patient_id, recognized_at DESC);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_lab_results_report
    ON lab_results (report_id);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_lab_results_analyte_id
    ON lab_results (analyte_id);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_lab_results_mapping_source
    ON lab_results (mapping_source);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_alias_lower
    ON analyte_aliases (LOWER(alias));
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_analyte_aliases_lang
    ON analyte_aliases(lang);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_pending_analytes_status
    ON pending_analytes (status);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_match_reviews_status
    ON match_reviews (status);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_match_reviews_result_id
    ON match_reviews (result_id);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_admin_actions_created_at
    ON admin_actions (created_at DESC);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_admin_actions_action_type
    ON admin_actions (action_type);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_admin_actions_entity
    ON admin_actions(entity_type, entity_id);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_sql_generation_logs_created_at
    ON sql_generation_logs (created_at DESC);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_gmail_provenance_report
    ON gmail_report_provenance(report_id);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_gmail_provenance_checksum
    ON gmail_report_provenance(attachment_checksum);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_gmail_provenance_message
    ON gmail_report_provenance(message_id);
  `,
  // Views
  `
  CREATE OR REPLACE VIEW v_measurements AS
  SELECT
    lr.id AS result_id,
    pr.patient_id,
    a.code AS analyte_code,
    a.name AS analyte_name,
    lr.parameter_name,
    lr.numeric_result AS value_num,
    lr.result_value AS value_text,
    lr.unit AS units,
    COALESCE(pr.test_date_text::date, pr.recognized_at::date) AS date_eff,
    lr.report_id,
    lr.reference_lower,
    lr.reference_upper,
    lr.reference_lower_operator,
    lr.reference_upper_operator,
    lr.is_value_out_of_range,
    lr.specimen_type
  FROM lab_results lr
  JOIN patient_reports pr ON pr.id = lr.report_id
  LEFT JOIN analytes a ON a.analyte_id = lr.analyte_id;
  `,
  // ============================================================
  // AUTHENTICATION TABLES (Part 1)
  // ============================================================
  `
  CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name TEXT NOT NULL,
    primary_email CITEXT UNIQUE,
    avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ
  );
  `,
  `
  COMMENT ON TABLE users IS 'User accounts (provider-agnostic)';
  `,
  `
  CREATE TABLE IF NOT EXISTS user_identities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('google', 'apple', 'email')),
    provider_subject TEXT NOT NULL,
    email TEXT,
    email_verified BOOLEAN DEFAULT FALSE,
    profile_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    UNIQUE(provider, provider_subject)
  );
  `,
  `
  COMMENT ON TABLE user_identities IS 'OAuth provider identities linked to user accounts';
  `,
  `
  CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    ip_address TEXT,
    user_agent TEXT
  );
  `,
  `
  COMMENT ON TABLE sessions IS 'Database-backed user sessions';
  `,
  `
  CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    resource_type TEXT,
    resource_id TEXT,
    ip_address TEXT,
    user_agent TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  `,
  `
  COMMENT ON TABLE audit_logs IS 'Security audit trail for user actions';
  `,
  `
  COMMENT ON COLUMN patients.user_id IS 'Associated user account. NULL for shared/unassigned patients.';
  `,
  // Add foreign key constraint for patients.user_id (column defined in CREATE TABLE)
  `
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'patients_user_id_fkey'
    ) THEN
      ALTER TABLE patients ADD CONSTRAINT patients_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
  END $$;
  `,
  // RLS Policies
  `
  ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
  `,
  `
  ALTER TABLE patient_reports ENABLE ROW LEVEL SECURITY;
  `,
  `
  ALTER TABLE lab_results ENABLE ROW LEVEL SECURITY;
  `,
  `
  DROP POLICY IF EXISTS user_isolation_patients ON patients;
  `,
  `
  DROP POLICY IF EXISTS user_isolation_reports ON patient_reports;
  `,
  `
  DROP POLICY IF EXISTS user_isolation_lab_results ON lab_results;
  `,
  `
  DROP POLICY IF EXISTS audit_logs_admin_only ON audit_logs;
  `,
  `
  DROP POLICY IF EXISTS session_isolation ON sessions;
  `,
  `
  -- RLS Policy Contract (app.current_user_id):
  -- App layer MUST set either:
  --   1. Valid UUID string via SET LOCAL app.current_user_id = '<uuid>'
  --   2. Empty string (default for unset context)
  -- Malformed UUIDs will error (fail-safe behavior).
  -- The NULLIF wrapper is defensive but app should validate before setting.
  COMMENT ON SCHEMA public IS 'RLS policies use app.current_user_id session variable';
  `,
  `
  CREATE POLICY user_isolation_patients ON patients
    FOR ALL
    USING (
      user_id IS NULL
      OR user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    );
  `,
  `
  CREATE POLICY user_isolation_reports ON patient_reports
    FOR ALL
    USING (
      patient_id IN (
        SELECT id FROM patients
        WHERE user_id IS NULL
          OR user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      )
    );
  `,
  `
  CREATE POLICY user_isolation_lab_results ON lab_results
    FOR ALL
    USING (
      report_id IN (
        SELECT pr.id FROM patient_reports pr
        JOIN patients p ON pr.patient_id = p.id
        WHERE p.user_id IS NULL
          OR p.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      )
    );
  `,
  `
  -- Lock down audit logs (admin-only access via BYPASSRLS role)
  ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
  `,
  `
  CREATE POLICY audit_logs_admin_only ON audit_logs
    FOR ALL
    USING (false);
  `,
  `
  COMMENT ON POLICY audit_logs_admin_only ON audit_logs IS 'Block all app access. Only healthup_admin (BYPASSRLS) can query audit logs.';
  `,
  `
  -- Lock down sessions (users can only see their own sessions)
  ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
  `,
  `
  CREATE POLICY session_isolation ON sessions
    FOR ALL
    USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
  `,
  `
  COMMENT ON POLICY session_isolation ON sessions IS 'Users can only access their own sessions. No NULL escape hatch (sessions always have user_id).';
  `,
  // Indexes for auth tables
  `
  CREATE INDEX IF NOT EXISTS idx_user_identities_user_id ON user_identities(user_id);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at) WHERE revoked_at IS NULL;
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_sessions_revoked_at ON sessions(revoked_at) WHERE revoked_at IS NOT NULL;
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_patients_user_id ON patients(user_id);
  `,
];

const trigramIndexStatements = [
  `
  CREATE INDEX IF NOT EXISTS idx_alias_trgm
    ON analyte_aliases USING gin (alias gin_trgm_ops);
  `,
];

async function ensureSchema() {
  const client = await pool.connect();

  let hasPgTrgm = false;
  let transactionStarted = false;

  try {
    await client.query("SET search_path TO public");

    // Check extension availability before transactional schema updates so missing pg_trgm doesn't roll back the batch.
    try {
      const { rows } = await client.query(
        "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') AS enabled;"
      );
      hasPgTrgm = rows?.[0]?.enabled === true;
    } catch (checkError) {
      console.warn('[db] Unable to verify pg_trgm extension state; will attempt creation.', checkError);
    }

    if (!hasPgTrgm) {
      try {
        await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm;');
        hasPgTrgm = true;
      } catch (extensionError) {
        if (requirePgTrgm) {
          const requiredError = new Error(
            `pg_trgm extension is required but could not be installed: ${extensionError.message}`
          );
          requiredError.cause = extensionError;
          throw requiredError;
        }
        console.warn(
          '[db] pg_trgm extension unavailable; trigram indexes will be skipped.',
          extensionError
        );
      }
    }

    // Enable pgcrypto for gen_random_uuid() used in SQL generation logging
    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
    } catch (extensionError) {
      console.warn(
        '[db] pgcrypto extension unavailable; gen_random_uuid() may not work.',
        extensionError
      );
    }

    // Enable citext for case-insensitive email uniqueness (Part 1 authentication)
    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS citext;');
    } catch (extensionError) {
      console.warn(
        '[db] citext extension unavailable; case-insensitive email uniqueness may not work.',
        extensionError
      );
    }

    await client.query('BEGIN');
    await client.query('SET LOCAL search_path TO public');
    transactionStarted = true;
    // eslint-disable-next-line no-restricted-syntax
    for (const statement of schemaStatements) {
      // eslint-disable-next-line no-await-in-loop
      await client.query(statement);
    }

    if (hasPgTrgm) {
      // eslint-disable-next-line no-restricted-syntax
      for (const statement of trigramIndexStatements) {
        // eslint-disable-next-line no-await-in-loop
        await client.query(statement);
      }
    } else {
      console.warn('[db] Skipping trigram index creation because pg_trgm is not available.');
    }

    await client.query('COMMIT');
  } catch (error) {
    if (transactionStarted) {
      await client.query('ROLLBACK');
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Drop all tables and recreate schema from scratch
 * WARNING: This will delete ALL data in the database!
 */
async function resetDatabase() {
  const client = await pool.connect();
  try {
    console.log('[db] Starting database reset...');

    // Drop all tables in dependency order (child tables first)
    // Part 1: Add auth tables to drop list
    await client.query('DROP TABLE IF EXISTS audit_logs CASCADE');
    await client.query('DROP TABLE IF EXISTS sessions CASCADE');
    await client.query('DROP TABLE IF EXISTS user_identities CASCADE');
    await client.query('DROP TABLE IF EXISTS users CASCADE');

    // Existing tables
    await client.query('DROP TABLE IF EXISTS admin_actions CASCADE');
    await client.query('DROP TABLE IF EXISTS sql_generation_logs CASCADE');
    await client.query('DROP TABLE IF EXISTS match_reviews CASCADE');
    await client.query('DROP TABLE IF EXISTS pending_analytes CASCADE');
    await client.query('DROP TABLE IF EXISTS gmail_report_provenance CASCADE');
    await client.query('DROP TABLE IF EXISTS lab_results CASCADE');
    await client.query('DROP TABLE IF EXISTS patient_reports CASCADE');
    await client.query('DROP TABLE IF EXISTS patients CASCADE');
    await client.query('DROP TABLE IF EXISTS analyte_aliases CASCADE');
    await client.query('DROP TABLE IF EXISTS analytes CASCADE');

    // Drop views
    await client.query('DROP VIEW IF EXISTS v_measurements CASCADE');

    console.log('[db] All tables dropped successfully');

    // Recreate schema
    await ensureSchema();

    // Re-seed analytes
    const seedPath = path.join(__dirname, 'seed_analytes.sql');

    if (fs.existsSync(seedPath)) {
      console.log('[db] Reseeding analytes...');
      const seedSQL = fs.readFileSync(seedPath, 'utf8');
      await client.query(seedSQL);
      console.log('[db] Analytes seeded successfully');
    } else {
      console.warn('[db] Seed file not found:', seedPath);
    }

    console.log('[db] ✅ Database reset complete!');

    return {
      success: true,
      message: 'Database reset successfully. All tables dropped and recreated with seed data.'
    };
  } catch (error) {
    console.error('[db] ❌ Database reset failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

export { ensureSchema, resetDatabase };
