#!/usr/bin/env node
// scripts/backfill_analyte_mappings.js
// PRD v2.4: Backfill script to populate analyte_id for existing lab_results rows

// Load environment variables before other imports
import '../server/config/loadEnv.js';

import { pool, queryAsAdmin } from '../server/db/index.js';
import { wetRun } from '../server/services/MappingApplier.js';

/**
 * Main backfill function
 */
async function backfillMappings() {
  console.log('[backfill] Starting analyte mapping backfill...');

  // Acquire advisory lock to prevent concurrent backfill runs
  const lockId = 123456; // Arbitrary lock ID for backfill
  const { rows: lockResult } = await pool.query(
    'SELECT pg_try_advisory_lock($1) AS acquired',
    [lockId]
  );

  if (!lockResult[0].acquired) {
    console.error('[backfill] ERROR: Another backfill process is already running. Exiting.');
    process.exit(1);
  }

  console.log('[backfill] Advisory lock acquired');

  try {
    // Fetch all unmapped lab_results grouped by report_id
    // Use queryAsAdmin to bypass RLS - backfill is an admin operation
    // user_id is on patients table, not patient_reports
    const { rows: reports } = await queryAsAdmin(
      `SELECT DISTINCT ON (lr.report_id) lr.report_id, pr.patient_id, p.user_id, pr.created_at
       FROM lab_results lr
       JOIN patient_reports pr ON lr.report_id = pr.id
       JOIN patients p ON pr.patient_id = p.id
       WHERE lr.analyte_id IS NULL
       ORDER BY lr.report_id, pr.created_at DESC`
    );

    console.log(`[backfill] Found ${reports.length} reports with unmapped lab results`);

    if (reports.length === 0) {
      console.log('[backfill] ✅ All lab results are already mapped. Nothing to do.');
      return;
    }

    // Count total unmapped rows before backfill
    const { rows: beforeCount } = await queryAsAdmin(
      'SELECT COUNT(*) as count FROM lab_results WHERE analyte_id IS NULL'
    );
    console.log(`[backfill] Total unmapped rows: ${beforeCount[0].count}`);

    // Summary counters
    const globalCounters = {
      total_reports: reports.length,
      total_written: 0,
      total_queued_for_review: 0,
      total_new_queued: 0,
      total_skipped: 0,
      total_already_mapped: 0,
    };

    // Process each report
    for (let i = 0; i < reports.length; i++) {
      const report = reports[i];
      const reportNum = i + 1;

      console.log(`\n[backfill] Processing report ${reportNum}/${reports.length}: ${report.report_id}`);

      try {
        const result = await wetRun({
          reportId: report.report_id,
          patientId: report.patient_id,
          userId: report.user_id,
        });

        // Update global counters
        globalCounters.total_written += result.summary.written;
        globalCounters.total_queued_for_review += result.summary.queued_for_review;
        globalCounters.total_new_queued += result.summary.new_queued;
        globalCounters.total_skipped += result.summary.skipped;
        globalCounters.total_already_mapped += result.summary.already_mapped;

        console.log(`[backfill] Report ${reportNum}/${reports.length}: ` +
          `${result.summary.written} matched, ` +
          `${result.summary.new_queued} NEW, ` +
          `${result.summary.queued_for_review} review, ` +
          `${result.summary.skipped} unmapped`);
      } catch (error) {
        console.error(`[backfill] ERROR processing report ${report.report_id}:`, error.message);
        // Continue to next report on error
      }
    }

    // Count total unmapped rows after backfill
    const { rows: afterCount } = await queryAsAdmin(
      'SELECT COUNT(*) as count FROM lab_results WHERE analyte_id IS NULL'
    );

    console.log('\n[backfill] ✅ Backfill complete!');
    console.log('========================================');
    console.log(`Reports processed: ${globalCounters.total_reports}`);
    console.log(`Rows mapped: ${globalCounters.total_written}`);
    console.log(`NEW analytes queued: ${globalCounters.total_new_queued}`);
    console.log(`Ambiguous matches queued: ${globalCounters.total_queued_for_review}`);
    console.log(`Rows skipped (unmapped): ${globalCounters.total_skipped}`);
    console.log(`Rows already mapped: ${globalCounters.total_already_mapped}`);
    console.log(`Unmapped rows before: ${beforeCount[0].count}`);
    console.log(`Unmapped rows after: ${afterCount[0].count}`);
    console.log(`Unmapped rows reduced by: ${beforeCount[0].count - afterCount[0].count}`);
    console.log('========================================');
  } catch (error) {
    console.error('[backfill] FATAL ERROR:', error);
    throw error;
  } finally {
    // Release advisory lock
    await pool.query('SELECT pg_advisory_unlock($1)', [lockId]);
    console.log('[backfill] Advisory lock released');
  }
}

// Run backfill
backfillMappings()
  .then(() => {
    console.log('[backfill] Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('[backfill] Script failed:', error);
    process.exit(1);
  });
