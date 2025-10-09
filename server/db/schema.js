const { pool } = require('./index');

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
];

async function ensureSchema() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    // eslint-disable-next-line no-restricted-syntax
    for (const statement of schemaStatements) {
      // eslint-disable-next-line no-await-in-loop
      await client.query(statement);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { ensureSchema };
