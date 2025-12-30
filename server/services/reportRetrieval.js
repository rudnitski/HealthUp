import { pool, withUserTransaction } from '../db/index.js';

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

/**
 * Get patient with their reports
 * PRD v4.4.3: Added userId parameter for RLS context
 * @param {string} patientId - Patient UUID
 * @param {object} options - Pagination options (limit, offset)
 * @param {string} userId - User ID for RLS context
 */
async function getPatientReports(patientId, options = {}, userId) {
  const limit = coerceLimit(options.limit);
  const offset = coerceOffset(options.offset);

  // PRD v4.4.3: Use withUserTransaction for multi-query flow with RLS context
  return await withUserTransaction(userId, async (client) => {
    // Query 1: Check patient exists and belongs to user (RLS auto-filters)
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
      return null; // Patient doesn't exist OR doesn't belong to user
    }

    // Query 2: Fetch reports (RLS auto-filters)
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

    // Query 3: Count total reports
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
  });
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

/**
 * Get detailed report with lab results
 * PRD v4.4.3: Added userId parameter for RLS context
 * @param {string} reportId - Report UUID
 * @param {string} userId - User ID for RLS context
 */
async function getReportDetail(reportId, userId) {
  // PRD v4.4.3: Use withUserTransaction for multi-query flow with RLS context
  return await withUserTransaction(userId, async (client) => {
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
      return null; // Report doesn't exist OR doesn't belong to user
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
        specimen_type,
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
        specimen_type: row.specimen_type,
      })),
    };
  });
}

export {
  getPatientReports,
  getReportDetail,
};
