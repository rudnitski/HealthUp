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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS analytes (
    analyte_id SERIAL PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    unit_canonical TEXT,
    category TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS analyte_aliases (
    analyte_id INT NOT NULL REFERENCES analytes(analyte_id) ON DELETE CASCADE,
    alias TEXT NOT NULL,
    lang TEXT,
    confidence REAL DEFAULT 1.0,
    source TEXT DEFAULT 'seed',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (analyte_id, alias)
  );
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_alias_lower
    ON analyte_aliases (LOWER(alias));
  `,
  `
  CREATE TABLE IF NOT EXISTS pending_analytes (
    pending_id BIGSERIAL PRIMARY KEY,
    proposed_code TEXT NOT NULL,
    proposed_name TEXT NOT NULL,
    unit_canonical TEXT,
    category TEXT,
    aliases JSONB,
    evidence JSONB,
    confidence REAL,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS match_reviews (
    review_id BIGSERIAL PRIMARY KEY,
    result_id UUID NOT NULL REFERENCES lab_results(id) ON DELETE CASCADE,
    suggested_analyte_id INT REFERENCES analytes(analyte_id),
    suggested_code TEXT,
    confidence REAL,
    rationale TEXT,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
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
  ALTER TABLE lab_results
    ADD COLUMN IF NOT EXISTS position INT;
  `,
  `
  ALTER TABLE lab_results
    ADD COLUMN IF NOT EXISTS analyte_id INT REFERENCES analytes(analyte_id);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_lab_results_analyte_id
    ON lab_results (analyte_id);
  `,
  // PRD v2.4: Mapping write mode columns
  `
  ALTER TABLE lab_results
    ADD COLUMN IF NOT EXISTS mapping_confidence REAL,
    ADD COLUMN IF NOT EXISTS mapped_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS mapping_source TEXT;
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_lab_results_mapping_source
    ON lab_results (mapping_source);
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
  ALTER TABLE analyte_aliases
    ADD COLUMN IF NOT EXISTS alias_display TEXT;
  `,
  `
  COMMENT ON COLUMN analyte_aliases.alias IS 'Normalized lowercase form for matching (e.g., "интерлейкин 6")';
  `,
  `
  COMMENT ON COLUMN analyte_aliases.alias_display IS 'Original display form with proper casing and punctuation';
  `,
  `
  ALTER TABLE pending_analytes
    ADD COLUMN IF NOT EXISTS parameter_variations JSONB,
    ADD COLUMN IF NOT EXISTS discarded_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS discarded_reason TEXT,
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS approved_analyte_id INT REFERENCES analytes(analyte_id);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_pending_analytes_status
    ON pending_analytes (status);
  `,
  `
  CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_analytes_proposed_code
    ON pending_analytes (proposed_code);
  `,
  `
  COMMENT ON COLUMN pending_analytes.parameter_variations IS 'Array of raw parameter name variations with language and occurrence count';
  `,
  `
  COMMENT ON COLUMN pending_analytes.discarded_reason IS 'Reason for discarding (prevents re-proposing)';
  `,
  `
  ALTER TABLE match_reviews
    ADD COLUMN IF NOT EXISTS candidates JSONB;
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
  COMMENT ON COLUMN match_reviews.candidates IS 'Array of candidate matches with similarity scores';
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
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
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
  CREATE INDEX IF NOT EXISTS idx_sql_generation_logs_created_at
    ON sql_generation_logs (created_at DESC);
  `,
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
    lr.report_id
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

module.exports = { ensureSchema };
