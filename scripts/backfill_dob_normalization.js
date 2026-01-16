#!/usr/bin/env node
/**
 * Backfill script for PRD v6.1: Normalize patient date_of_birth
 *
 * Usage:
 *   node scripts/backfill_dob_normalization.js --dry-run  # Preview changes
 *   node scripts/backfill_dob_normalization.js            # Apply changes
 *
 * Idempotent: Only processes rows where date_of_birth IS NOT NULL
 * AND date_of_birth_normalized IS NULL, so safe to rerun.
 */

// Load environment variables before other imports (required for DB connection)
import '../server/config/loadEnv.js';

import { normalizeDate } from '../server/utils/dateParser.js';
import { adminPool } from '../server/db/index.js';

const DRY_RUN = process.argv.includes('--dry-run');

async function backfillDobNormalization() {
  console.log(DRY_RUN ? '=== DRY RUN MODE ===' : '=== LIVE MODE ===');
  console.log('');

  const { rows } = await adminPool.query(
    'SELECT id, date_of_birth FROM patients WHERE date_of_birth IS NOT NULL AND date_of_birth_normalized IS NULL'
  );

  console.log(`Found ${rows.length} patients to process\n`);

  let normalized = 0;
  let skipped = 0;

  for (const row of rows) {
    const result = normalizeDate(row.date_of_birth);

    if (DRY_RUN) {
      console.log(`[DRY RUN] ${row.id}: "${row.date_of_birth}" -> ${result || 'NULL (ambiguous/unparseable)'}`);
    } else {
      await adminPool.query(
        'UPDATE patients SET date_of_birth_normalized = $1 WHERE id = $2',
        [result, row.id]
      );
    }

    if (result) {
      normalized++;
    } else {
      skipped++;
    }
  }

  console.log(`\nSummary: ${normalized} normalized, ${skipped} skipped (ambiguous/unparseable)`);
}

// Main execution wrapper (required to prevent script from hanging)
async function main() {
  try {
    await backfillDobNormalization();
    console.log('\nBackfill complete');
  } catch (error) {
    console.error('Backfill failed:', error);
    process.exitCode = 1;
  } finally {
    await adminPool.end();
  }
}

main();
