#!/usr/bin/env node
/**
 * Backfill script for PRD v4.0: Normalize test_date column
 *
 * Usage:
 *   node scripts/backfill_test_dates.js --dry-run  # Preview changes
 *   node scripts/backfill_test_dates.js            # Apply changes
 *
 * Note: For large-scale deployments (10K+ reports), consider using
 * cursor-based pagination instead of loading all rows into memory.
 * Current implementation is suitable for typical deployments (<5K reports).
 */

// Load environment variables before other imports
import '../server/config/loadEnv.js';

import { adminPool } from '../server/db/index.js';
import { normalizeTestDate } from '../server/utils/dateParser.js';

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 100;

async function backfillTestDates() {
  console.log(DRY_RUN ? '=== DRY RUN MODE ===' : '=== LIVE MODE ===');
  console.log('');

  // Get all reports with test_date_text but NULL test_date
  // Note: For very large datasets, use LIMIT/OFFSET or cursor-based pagination
  const { rows: reports } = await adminPool.query(`
    SELECT id, test_date_text
    FROM patient_reports
    WHERE test_date_text IS NOT NULL
      AND test_date IS NULL
    ORDER BY recognized_at DESC
  `);

  console.log(`Found ${reports.length} reports to process\n`);

  if (reports.length > 5000) {
    console.warn('WARNING: Large dataset detected. Consider cursor-based pagination for production use.\n');
  }

  let updated = 0;
  let skippedAmbiguous = 0;
  let failed = 0;
  const unparseable = [];
  const ambiguous = [];

  for (let i = 0; i < reports.length; i++) {
    const report = reports[i];
    const normalized = normalizeTestDate(report.test_date_text);

    if (normalized) {
      if (!DRY_RUN) {
        await adminPool.query(
          'UPDATE patient_reports SET test_date = $1 WHERE id = $2',
          [normalized, report.id]
        );
      }
      updated++;

      // Show first few conversions
      if (updated <= 10) {
        console.log(`  "${report.test_date_text}" -> ${normalized}`);
      }
    } else {
      // Check if it's ambiguous (matches European pattern but day <= 12)
      // Note: This duplicates dateParser.js ambiguity logic intentionally.
      // We need to distinguish "ambiguous" from "unparseable" for reporting,
      // while normalizeTestDate() returns null for both cases.
      // Must trim to match dateParser.js behavior (handles " 06/07/2021 " correctly)
      const trimmedText = report.test_date_text.trim();
      const euroMatch = trimmedText.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
      if (euroMatch) {
        const day = parseInt(euroMatch[1], 10);
        const month = parseInt(euroMatch[2], 10);
        if (day <= 12 && month <= 12) {
          skippedAmbiguous++;
          if (!ambiguous.includes(report.test_date_text)) {
            ambiguous.push(report.test_date_text);
          }
          continue;
        }
      }

      failed++;
      if (!unparseable.includes(report.test_date_text)) {
        unparseable.push(report.test_date_text);
      }
    }

    // Progress every BATCH_SIZE
    if ((i + 1) % BATCH_SIZE === 0) {
      const pct = Math.round(((i + 1) / reports.length) * 100);
      console.log(`Progress: ${i + 1}/${reports.length} (${pct}%)`);
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Total processed: ${reports.length}`);
  console.log(`Successfully normalized: ${updated}`);
  console.log(`Skipped (ambiguous): ${skippedAmbiguous}`);
  console.log(`Unparseable: ${failed}`);

  if (ambiguous.length > 0) {
    console.log(`\nAmbiguous dates skipped (${ambiguous.length}):`);
    ambiguous.slice(0, 10).forEach(fmt => console.log(`  - "${fmt}" (could be DD/MM or MM/DD)`));
    if (ambiguous.length > 10) {
      console.log(`  ... and ${ambiguous.length - 10} more`);
    }
    console.log('\nNote: Ambiguous dates will use recognized_at as fallback.');
  }

  if (unparseable.length > 0) {
    console.log(`\nUnparseable formats (${unparseable.length}):`);
    unparseable.slice(0, 20).forEach(fmt => console.log(`  - "${fmt}"`));
    if (unparseable.length > 20) {
      console.log(`  ... and ${unparseable.length - 20} more`);
    }
  }

  if (DRY_RUN) {
    console.log('\n=== DRY RUN - No changes made ===');
  }
}

backfillTestDates()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
