const { pool } = require('./index');

const requirePgTrgm = String(process.env.REQUIRE_PG_TRGM || '').toLowerCase() === 'true';

const schemaStatements = [
  `
  CREATE TABLE IF NOT EXISTS patients (
    id UUID PRIMARY KEY,
    full_name TEXT,
    full_name_normalized TEXT UNIQUE,
    date_of_birth TEXT,
    gender TEXT,
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (patient_id, checksum)
  );
  `,
  `
  COMMENT ON TABLE patient_reports IS 'Lab report documents parsed from PDFs';
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
    analyte_id INT REFERENCES analytes(analyte_id),
    mapping_confidence REAL,
    mapped_at TIMESTAMPTZ,
    mapping_source TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  `,
  `
  COMMENT ON TABLE sql_generation_logs IS 'LLM-based SQL generation audit trail';
  `,
  // Indexes
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
  // Views
  `
  CREATE OR REPLACE VIEW v_measurements AS
  SELECT
    lr.id AS result_id,
    pr.patient_id,
    a.code AS analyte_code,
    a.name AS analyte_name,
    lr.numeric_result AS value_num,
    lr.result_value AS value_text,
    lr.unit AS units,
    COALESCE(pr.test_date_text::date, pr.recognized_at::date) AS date_eff,
    lr.report_id,
    lr.reference_lower,
    lr.reference_upper,
    lr.reference_lower_operator,
    lr.reference_upper_operator,
    lr.is_value_out_of_range
  FROM lab_results lr
  JOIN patient_reports pr ON pr.id = lr.report_id
  LEFT JOIN analytes a ON a.analyte_id = lr.analyte_id;
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
    await client.query('DROP TABLE IF EXISTS admin_actions CASCADE');
    await client.query('DROP TABLE IF EXISTS sql_generation_logs CASCADE');
    await client.query('DROP TABLE IF EXISTS match_reviews CASCADE');
    await client.query('DROP TABLE IF EXISTS pending_analytes CASCADE');
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
    const fs = require('fs');
    const path = require('path');
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

module.exports = { ensureSchema, resetDatabase };
