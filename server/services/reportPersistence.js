const { randomUUID, createHash } = require('crypto');
const { pool } = require('../db');

const normalizePatientName = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.toLowerCase();
};

const coerceTimestamp = (value) => {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
};

async function upsertPatient(client, payload) {
  const {
    fullName,
    dateOfBirth,
    gender,
    recognizedAt,
  } = payload;

  const normalized = normalizePatientName(fullName);
  const patientId = randomUUID();

  const result = await client.query(
    `
    INSERT INTO patients (
      id,
      full_name,
      full_name_normalized,
      date_of_birth,
      gender,
      created_at,
      updated_at,
      last_seen_report_at
    )
    VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), $6)
    ON CONFLICT (full_name_normalized) DO UPDATE
      SET
        full_name = COALESCE(EXCLUDED.full_name, patients.full_name),
        date_of_birth = COALESCE(EXCLUDED.date_of_birth, patients.date_of_birth),
        gender = COALESCE(EXCLUDED.gender, patients.gender),
        updated_at = NOW(),
        last_seen_report_at = CASE
          WHEN patients.last_seen_report_at IS NULL THEN EXCLUDED.last_seen_report_at
          WHEN EXCLUDED.last_seen_report_at IS NULL THEN patients.last_seen_report_at
          WHEN EXCLUDED.last_seen_report_at >= patients.last_seen_report_at THEN EXCLUDED.last_seen_report_at
          ELSE patients.last_seen_report_at
        END
    RETURNING id;
    `,
    [
      patientId,
      fullName ?? null,
      normalized,
      dateOfBirth ?? null,
      gender ?? null,
      recognizedAt,
    ],
  );

  return result.rows[0].id;
}

const buildLabResultTuples = (reportId, parameters) => {
  if (!Array.isArray(parameters) || parameters.length === 0) {
    return { text: null, values: [] };
  }

  const values = [];
  const valuePlaceholders = [];

  parameters.forEach((parameter, index) => {
    const rowId = randomUUID();
    const baseIndex = index * 14;

    values.push(
      rowId,
      reportId,
      index + 1,
      parameter.parameter_name ?? null,
      parameter.result ?? null,
      parameter.unit ?? null,
      parameter.reference_interval?.lower ?? null,
      parameter.reference_interval?.lower_operator ?? null,
      parameter.reference_interval?.upper ?? null,
      parameter.reference_interval?.upper_operator ?? null,
      parameter.reference_interval?.text ?? null,
      parameter.reference_interval?.full_text ?? null,
      parameter.is_value_out_of_range ?? null,
      parameter.numeric_result ?? null,
    );

    const placeholders = Array.from({ length: 14 }, (_unused, offset) => `$${baseIndex + offset + 1}`);
    valuePlaceholders.push(`(${placeholders.join(', ')})`);
  });

  return {
    text: `
      INSERT INTO lab_results (
        id,
        report_id,
        position,
        parameter_name,
        result_value,
        unit,
        reference_lower,
        reference_lower_operator,
        reference_upper,
        reference_upper_operator,
        reference_text,
        reference_full_text,
        is_value_out_of_range,
        numeric_result
      )
      VALUES ${valuePlaceholders.join(', ')}
    `,
    values,
  };
};

async function persistLabReport({
  fileBuffer,
  filename,
  parserVersion,
  processedAt,
  coreResult,
}) {
  if (!fileBuffer || !Buffer.isBuffer(fileBuffer)) {
    throw new Error('File buffer is required for persistence');
  }

  const checksum = createHash('sha256').update(fileBuffer).digest('hex');
  const processedTimestamp = coerceTimestamp(processedAt) || new Date();
  const recognizedAt = processedTimestamp;

  const safeCoreResult = coreResult || {};
  const patientName = safeCoreResult.patient_name ?? null;
  const patientDateOfBirth = safeCoreResult.patient_date_of_birth ?? null;
  const patientGender = safeCoreResult.patient_gender ?? null;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const patientId = await upsertPatient(client, {
      fullName: patientName,
      dateOfBirth: patientDateOfBirth,
      gender: patientGender,
      recognizedAt,
    });

    const reportId = randomUUID();

    const missingDataArray = Array.isArray(safeCoreResult.missing_data)
      ? safeCoreResult.missing_data
      : [];
    const missingDataJson = JSON.stringify(missingDataArray);

    const reportResult = await client.query(
      `
      INSERT INTO patient_reports (
        id,
        patient_id,
        source_filename,
        checksum,
        parser_version,
        status,
        recognized_at,
        processed_at,
        test_date_text,
        patient_name_snapshot,
        patient_age_snapshot,
        patient_gender_snapshot,
        patient_date_of_birth_snapshot,
        raw_model_output,
        missing_data,
        created_at,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, 'completed', $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, NOW(), NOW()
      )
      ON CONFLICT (patient_id, checksum)
      DO UPDATE SET
        parser_version = EXCLUDED.parser_version,
        status = EXCLUDED.status,
        recognized_at = EXCLUDED.recognized_at,
        processed_at = EXCLUDED.processed_at,
        test_date_text = EXCLUDED.test_date_text,
        patient_name_snapshot = EXCLUDED.patient_name_snapshot,
        patient_age_snapshot = EXCLUDED.patient_age_snapshot,
        patient_gender_snapshot = EXCLUDED.patient_gender_snapshot,
        patient_date_of_birth_snapshot = EXCLUDED.patient_date_of_birth_snapshot,
        raw_model_output = EXCLUDED.raw_model_output,
        missing_data = EXCLUDED.missing_data,
        source_filename = EXCLUDED.source_filename,
        updated_at = NOW()
      RETURNING id;
      `,
      [
        reportId,
        patientId,
        filename ?? null,
        checksum,
        parserVersion ?? null,
        recognizedAt,
        processedTimestamp,
        safeCoreResult.test_date ?? null,
        patientName,
        safeCoreResult.patient_age ?? null,
        patientGender,
        patientDateOfBirth,
        safeCoreResult.raw_model_output ?? null,
        missingDataJson,
      ],
    );

    const persistedReportId = reportResult.rows[0].id;

    await client.query('DELETE FROM lab_results WHERE report_id = $1', [persistedReportId]);

    const { text: insertLabResultsQuery, values: labResultValues } = buildLabResultTuples(
      persistedReportId,
      Array.isArray(safeCoreResult.parameters) ? safeCoreResult.parameters : [],
    );

    if (insertLabResultsQuery) {
      await client.query(insertLabResultsQuery, labResultValues);
    }

    await client.query('COMMIT');

    return {
      patientId,
      reportId: persistedReportId,
      checksum,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  persistLabReport,
};
