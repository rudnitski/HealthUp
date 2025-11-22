const { pool } = require('../db');

const toIsoString = (value) => {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
};

const coerceLimit = (value, fallback = 50) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(Math.max(Math.trunc(numeric), 1), 200);
};

const coerceOffset = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.max(Math.trunc(numeric), 0);
};

async function getPatientReports(patientId, options = {}) {
  const limit = coerceLimit(options.limit);
  const offset = coerceOffset(options.offset);

  const client = await pool.connect();

  try {
    const patientResult = await client.query(
      `
      SELECT
        id,
        full_name,
        date_of_birth,
        gender,
        last_seen_report_at,
        created_at,
        updated_at
      FROM patients
      WHERE id = $1
      `,
      [patientId],
    );

    if (patientResult.rowCount === 0) {
      return null;
    }

    const reportsResult = await client.query(
      `
      SELECT
        id,
        source_filename,
        checksum,
        parser_version,
        status,
        recognized_at,
        processed_at,
        test_date_text,
        patient_age_snapshot,
        patient_gender_snapshot,
        patient_date_of_birth_snapshot,
        raw_model_output,
        created_at,
        updated_at
      FROM patient_reports
      WHERE patient_id = $1
      ORDER BY recognized_at DESC, created_at DESC
      LIMIT $2 OFFSET $3
      `,
      [patientId, limit, offset],
    );

    const countResult = await client.query(
      'SELECT COUNT(*)::INT AS total FROM patient_reports WHERE patient_id = $1',
      [patientId],
    );

    const patientRow = patientResult.rows[0];

    return {
      patient: {
        id: patientRow.id,
        full_name: patientRow.full_name,
        date_of_birth: patientRow.date_of_birth,
        gender: patientRow.gender,
        last_seen_report_at: toIsoString(patientRow.last_seen_report_at),
        created_at: toIsoString(patientRow.created_at),
        updated_at: toIsoString(patientRow.updated_at),
      },
      reports: reportsResult.rows.map((row) => ({
        id: row.id,
        source_filename: row.source_filename,
        checksum: row.checksum,
        parser_version: row.parser_version,
        status: row.status,
        recognized_at: toIsoString(row.recognized_at),
        processed_at: toIsoString(row.processed_at),
        test_date_text: row.test_date_text,
        patient_age_snapshot: row.patient_age_snapshot,
        patient_gender_snapshot: row.patient_gender_snapshot,
        patient_date_of_birth_snapshot: row.patient_date_of_birth_snapshot,
        raw_model_output: row.raw_model_output,
        created_at: toIsoString(row.created_at),
        updated_at: toIsoString(row.updated_at),
      })),
      pagination: {
        total: countResult.rows[0]?.total ?? 0,
        limit,
        offset,
      },
    };
  } finally {
    client.release();
  }
}

const toNumber = (value) => {
  if (value === null || value === undefined) {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const normalizeMissingData = (value) => {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === 'object') {
    return value;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      return [];
    }
  }

  return [];
};

async function getReportDetail(reportId) {
  const client = await pool.connect();

  try {
    const reportResult = await client.query(
      `
      SELECT
        pr.id,
        pr.patient_id,
        pr.source_filename,
        pr.file_mimetype,
        pr.checksum,
        pr.parser_version,
        pr.status,
        pr.recognized_at,
        pr.processed_at,
        pr.test_date_text,
        pr.patient_name_snapshot,
        pr.patient_age_snapshot,
        pr.patient_gender_snapshot,
        pr.patient_date_of_birth_snapshot,
        pr.raw_model_output,
        pr.missing_data,
        pr.created_at,
        pr.updated_at,
        p.full_name,
        p.date_of_birth,
        p.gender,
        p.last_seen_report_at,
        p.created_at AS patient_created_at,
        p.updated_at AS patient_updated_at
      FROM patient_reports pr
      JOIN patients p ON p.id = pr.patient_id
      WHERE pr.id = $1
      `,
      [reportId],
    );

    if (reportResult.rowCount === 0) {
      return null;
    }

    const details = reportResult.rows[0];

    const labResults = await client.query(
      `
      SELECT
        id,
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
        numeric_result,
        created_at
      FROM lab_results
      WHERE report_id = $1
      ORDER BY position ASC NULLS LAST, created_at ASC
      `,
      [reportId],
    );

    return {
      report_id: details.id,
      patient_id: details.patient_id,
      checksum: details.checksum,
      parser_version: details.parser_version,
      status: details.status,
      recognized_at: toIsoString(details.recognized_at),
      processed_at: toIsoString(details.processed_at),
      created_at: toIsoString(details.created_at),
      updated_at: toIsoString(details.updated_at),
      test_date: details.test_date_text,
      patient_name: details.patient_name_snapshot || details.full_name,
      patient_age: details.patient_age_snapshot,
      patient_gender: details.patient_gender_snapshot || details.gender,
      patient_date_of_birth: details.patient_date_of_birth_snapshot || details.date_of_birth,
      missing_data: normalizeMissingData(details.missing_data),
      raw_model_output: details.raw_model_output || '',
      parameters: labResults.rows.map((row) => ({
        parameter_name: row.parameter_name,
        result: row.result_value,
        unit: row.unit,
        reference_interval: {
          lower: toNumber(row.reference_lower),
          lower_operator: row.reference_lower_operator,
          upper: toNumber(row.reference_upper),
          upper_operator: row.reference_upper_operator,
          text: row.reference_text,
          full_text: row.reference_full_text,
        },
        is_value_out_of_range: row.is_value_out_of_range,
        numeric_result: toNumber(row.numeric_result),
      })),
    };
  } finally {
    client.release();
  }
}

module.exports = {
  getPatientReports,
  getReportDetail,
};
