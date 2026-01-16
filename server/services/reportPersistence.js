import { randomUUID, createHash } from 'crypto';
import { pool } from '../db/index.js';
import { saveFile, deleteFile } from './fileStorage.js';

class PersistLabReportError extends Error {
  constructor(message, {
    status = 500,
    code = 'persist_lab_report_failed',
    context = {},
    cause,
  } = {}) {
    super(message, { cause });
    this.name = 'PersistLabReportError';
    this.status = status;
    this.code = code;
    this.context = context;
  }
}

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

/**
 * Normalize MIME type using extension-based inference for generic types
 * @param {string} mimetype - Original MIME type from upload
 * @param {string} filename - Original filename
 * @returns {string} Normalized MIME type
 */
function normalizeMimetype(mimetype, filename) {
  // If generic/missing mimetype, infer from extension
  if (!mimetype || mimetype === 'application/octet-stream' || mimetype === 'binary/octet-stream') {
    const ext = filename?.split('.').pop()?.toLowerCase();
    const mimetypeMap = {
      'pdf': 'application/pdf',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'heic': 'image/heic',
      'webp': 'image/webp',
      'gif': 'image/gif',
    };
    return mimetypeMap[ext] || mimetype || 'application/octet-stream';
  }
  return mimetype;
}

async function upsertPatient(client, payload) {
  const {
    fullName,
    dateOfBirth,
    gender,
    // PRD v4.3: recognizedAt no longer used for last_seen_report_at
    // We use NOW() (ingestion time) instead for consistent sorting
  } = payload;

  const normalized = normalizePatientName(fullName);
  const patientId = randomUUID();

  // PRD v4.3: last_seen_report_at = NOW() (ingestion time)
  // This represents "when the system last processed a report for this patient"
  // Updated on both INSERT and ON CONFLICT (even for duplicate reports)
  //
  // PRD v4.4.3: user_id is set from RLS context (app.current_user_id session variable)
  // This ensures patients are always associated with the authenticated user who uploaded the report.
  // Conflict target changed to composite (user_id, full_name_normalized) for user-scoped uniqueness.
  const result = await client.query(
    `
    INSERT INTO patients (
      id,
      full_name,
      full_name_normalized,
      date_of_birth,
      gender,
      user_id,
      created_at,
      updated_at,
      last_seen_report_at
    )
    VALUES ($1, $2, $3, $4, $5, current_setting('app.current_user_id', true)::uuid, NOW(), NOW(), NOW())
    ON CONFLICT (user_id, full_name_normalized) DO UPDATE
      SET
        full_name = COALESCE(EXCLUDED.full_name, patients.full_name),
        date_of_birth = COALESCE(EXCLUDED.date_of_birth, patients.date_of_birth),
        gender = COALESCE(EXCLUDED.gender, patients.gender),
        updated_at = NOW(),
        last_seen_report_at = NOW()
    RETURNING id, (xmax = 0) AS is_new;
    `,
    [
      patientId,
      fullName ?? null,
      normalized,
      dateOfBirth ?? null,
      gender ?? null,
    ],
  );

  return { patientId: result.rows[0].id, isNew: result.rows[0].is_new };
}

const buildLabResultTuples = (reportId, parameters) => {
  if (!Array.isArray(parameters) || parameters.length === 0) {
    return { text: null, values: [] };
  }

  const values = [];
  const valuePlaceholders = [];

  parameters.forEach((parameter, index) => {
    const rowId = randomUUID();
    const baseIndex = index * 15;

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
      parameter.specimen_type ?? null,
    );

    const placeholders = Array.from({ length: 15 }, (_unused, offset) => `$${baseIndex + offset + 1}`);
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
        numeric_result,
        specimen_type
      )
      VALUES ${valuePlaceholders.join(', ')}
    `,
    values,
  };
};

async function persistLabReport({
  fileBuffer,
  filename,
  mimetype,
  parserVersion,
  processedAt,
  coreResult,
  userId, // PRD v4.4.3: Required for RLS context
  fallbackPatientId, // PRD v6.0: Optional fallback when OCR fails to extract patient name
}) {
  if (!fileBuffer || !Buffer.isBuffer(fileBuffer)) {
    throw new Error('File buffer is required for persistence');
  }

  // PRD v4.4.3: userId is required for RLS-scoped data access
  if (!userId) {
    throw new Error('userId is required for persistence (RLS context)');
  }

  const checksum = createHash('sha256').update(fileBuffer).digest('hex');
  const processedTimestamp = coerceTimestamp(processedAt) || new Date();
  const recognizedAt = processedTimestamp;

  const safeCoreResult = coreResult || {};
  const patientName = safeCoreResult.patient_name ?? null;
  const patientDateOfBirth = safeCoreResult.patient_date_of_birth ?? null;
  const patientGender = safeCoreResult.patient_gender ?? null;
  const parameters = Array.isArray(safeCoreResult.parameters)
    ? safeCoreResult.parameters
    : [];

  const client = await pool.connect();
  const reportId = randomUUID();
  let patientId;
  let isNewPatient = false; // PRD v6.0: Track if patient was newly created
  let persistedReportId;
  let savedFilePath = null; // NEW file we saved (may need cleanup)
  let shouldCleanupOnError = true; // Whether to delete savedFilePath on rollback
  const parameterCount = parameters.length;

  try {
    await client.query('BEGIN');

    // PRD v4.4.3: Set RLS context for entire transaction
    // This enables user-scoped data isolation for patients, reports, and lab_results
    await client.query(
      "SELECT set_config('app.current_user_id', $1, true)",
      [userId]
    );

    // PRD v6.0: Conditional patient handling based on fallbackPatientId
    // When OCR fails to extract patient name but we have a fallback, use it directly
    if (!patientName && fallbackPatientId) {
      // Use fallback patient - skip upsertPatient, just update last_seen_report_at
      patientId = fallbackPatientId;
      isNewPatient = false;
      await client.query(
        'UPDATE patients SET last_seen_report_at = NOW() WHERE id = $1',
        [fallbackPatientId]
      );
    } else {
      // Normal flow: upsert patient based on OCR-extracted name
      const upsertResult = await upsertPatient(client, {
        fullName: patientName,
        dateOfBirth: patientDateOfBirth,
        gender: patientGender,
        recognizedAt,
      });
      patientId = upsertResult.patientId;
      isNewPatient = upsertResult.isNew;
    }

    const missingDataArray = Array.isArray(safeCoreResult.missing_data)
      ? safeCoreResult.missing_data
      : [];
    const missingDataJson = JSON.stringify(missingDataArray);

    // Normalize mimetype before storing (handles Gmail's application/octet-stream)
    const normalizedMimetype = normalizeMimetype(mimetype, filename);

    // Save file to filesystem (before DB transaction)
    savedFilePath = await saveFile(fileBuffer, patientId, reportId, filename);

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
        test_date,
        patient_name_snapshot,
        patient_age_snapshot,
        patient_gender_snapshot,
        patient_date_of_birth_snapshot,
        raw_model_output,
        missing_data,
        file_path,
        file_mimetype,
        created_at,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, 'completed', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb,
        $16, $17,
        NOW(), NOW()
      )
      ON CONFLICT (patient_id, checksum)
      DO UPDATE SET
        parser_version = EXCLUDED.parser_version,
        status = EXCLUDED.status,
        processed_at = EXCLUDED.processed_at,
        test_date_text = EXCLUDED.test_date_text,
        test_date = COALESCE(EXCLUDED.test_date, patient_reports.test_date),
        patient_name_snapshot = EXCLUDED.patient_name_snapshot,
        patient_age_snapshot = EXCLUDED.patient_age_snapshot,
        patient_gender_snapshot = EXCLUDED.patient_gender_snapshot,
        patient_date_of_birth_snapshot = EXCLUDED.patient_date_of_birth_snapshot,
        raw_model_output = EXCLUDED.raw_model_output,
        missing_data = EXCLUDED.missing_data,
        file_path = COALESCE(patient_reports.file_path, EXCLUDED.file_path),
        file_mimetype = COALESCE(patient_reports.file_mimetype, EXCLUDED.file_mimetype),
        updated_at = NOW()
      RETURNING id, (xmax = 0) AS inserted;
      `,
      [
        reportId,                                    // $1
        patientId,                                   // $2
        filename ?? null,                            // $3
        checksum,                                    // $4
        parserVersion ?? null,                       // $5
        recognizedAt,                                // $6
        processedTimestamp,                          // $7
        safeCoreResult.test_date ?? null,            // $8 -> test_date_text
        safeCoreResult.test_date_normalized ?? null, // $9 -> test_date (NEW)
        patientName,                                 // $10
        safeCoreResult.patient_age ?? null,          // $11
        patientGender,                               // $12
        patientDateOfBirth,                          // $13
        safeCoreResult.raw_model_output ?? null,     // $14
        missingDataJson,                             // $15
        savedFilePath,                               // $16
        normalizedMimetype,                          // $17
      ],
    );

    persistedReportId = reportResult.rows[0].id;
    const wasInserted = reportResult.rows[0].inserted;

    // If this was an UPDATE (not INSERT) and we saved a new file, check if we need to clean it up
    if (!wasInserted) {
      // Fetch the actual file_path that was kept (might be old one via COALESCE)
      const checkResult = await client.query(
        'SELECT file_path FROM patient_reports WHERE id = $1',
        [persistedReportId]
      );
      const keptFilePath = checkResult.rows[0]?.file_path;

      // If the kept path is different from what we just saved, clean up the orphan
      if (keptFilePath && keptFilePath !== savedFilePath) {
        // Database kept the OLD file, our NEW file is orphaned
        try {
          await deleteFile(savedFilePath);
          console.log(`[reportPersistence] Cleaned up duplicate file on conflict: ${savedFilePath} (kept: ${keptFilePath})`);
          // Mark that we already cleaned up - don't delete again on rollback
          shouldCleanupOnError = false;
        } catch (cleanupError) {
          console.error(`[reportPersistence] Failed to clean up duplicate file ${savedFilePath}:`, cleanupError);
          // Still mark as cleaned up to avoid trying to delete the kept file on rollback
          shouldCleanupOnError = false;
        }
      } else if (!keptFilePath && savedFilePath) {
        // COALESCE backfilled NULL with our new file - this is good, keep it
        console.log(`[reportPersistence] Backfilled file_path for existing report: ${savedFilePath}`);
        // Keep cleanup flag true - if transaction fails, delete the backfill file
        shouldCleanupOnError = true;
      }
    }

    await client.query('DELETE FROM lab_results WHERE report_id = $1', [persistedReportId]);

    const { text: insertLabResultsQuery, values: labResultValues } = buildLabResultTuples(
      persistedReportId,
      parameters,
    );

    if (insertLabResultsQuery) {
      await client.query(insertLabResultsQuery, labResultValues);
    }

    await client.query('COMMIT');

    // PRD v6.0: Return additional fields for chat inline upload
    return {
      patientId,
      reportId: persistedReportId,
      checksum,
      isNewPatient,
      patientName,
      testDateNormalized: safeCoreResult.test_date_normalized ?? null,
      parameterCount,
    };
  } catch (error) {
    await client.query('ROLLBACK');

    // Clean up orphaned file on disk if transaction failed
    // Only delete if we haven't already cleaned it up (duplicate case)
    if (savedFilePath && shouldCleanupOnError) {
      try {
        await deleteFile(savedFilePath);
        console.log(`[reportPersistence] Cleaned up orphaned file after transaction failure: ${savedFilePath}`);
      } catch (cleanupError) {
        console.error(`[reportPersistence] Failed to clean up file ${savedFilePath}:`, cleanupError);
        // Don't throw - original error is more important
      }
    }

    throw new PersistLabReportError('Failed to persist lab report', {
      cause: error,
      context: {
        filename: filename ?? null,
        parserVersion: parserVersion ?? null,
        checksum,
        patientId,
        attemptedReportId: reportId,
        persistedReportId,
        parameterCount,
        orphanedFilePath: savedFilePath,
      },
    });
  } finally {
    client.release();
  }
}

export {
  persistLabReport,
  PersistLabReportError,
};
