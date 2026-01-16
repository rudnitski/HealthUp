#!/usr/bin/env node
/**
 * PRD v6.1: Safe migration script for patient DOB normalization
 *
 * This script performs the complete migration in the correct order:
 * 1. Add date_of_birth_normalized column (if not exists)
 * 2. Create index on the new column
 * 3. Backfill existing patients
 * 4. Verify migration completed
 *
 * Run this BEFORE restarting the server (pm2 restart).
 *
 * Usage:
 *   node scripts/migrate_dob_normalization.js
 */

// Load environment variables before other imports
import '../server/config/loadEnv.js';

import { normalizeDate } from '../server/utils/dateParser.js';
import { adminPool } from '../server/db/index.js';

async function migrate() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  PRD v6.1: Patient DOB Normalization Migration             ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  const client = await adminPool.connect();

  try {
    // Step 1: Add column
    console.log('Step 1/4: Adding date_of_birth_normalized column...');
    await client.query(`
      ALTER TABLE patients
      ADD COLUMN IF NOT EXISTS date_of_birth_normalized DATE
    `);
    console.log('  ✓ Column added (or already exists)\n');

    // Step 2: Create index
    console.log('Step 2/4: Creating index on date_of_birth_normalized...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_patients_dob_normalized
      ON patients(date_of_birth_normalized)
    `);
    console.log('  ✓ Index created (or already exists)\n');

    // Step 3: Backfill existing patients
    console.log('Step 3/4: Backfilling existing patients...');

    const { rows } = await client.query(`
      SELECT id, date_of_birth
      FROM patients
      WHERE date_of_birth IS NOT NULL
        AND date_of_birth_normalized IS NULL
    `);

    console.log(`  Found ${rows.length} patients to process\n`);

    let normalized = 0;
    let skipped = 0;

    for (const row of rows) {
      const result = normalizeDate(row.date_of_birth);

      await client.query(
        'UPDATE patients SET date_of_birth_normalized = $1 WHERE id = $2',
        [result, row.id]
      );

      if (result) {
        console.log(`  ✓ ${row.id}: "${row.date_of_birth}" → ${result}`);
        normalized++;
      } else {
        console.log(`  ⚠ ${row.id}: "${row.date_of_birth}" → NULL (ambiguous/unparseable)`);
        skipped++;
      }
    }

    console.log(`\n  Summary: ${normalized} normalized, ${skipped} skipped\n`);

    // Step 4: Verify migration
    console.log('Step 4/4: Verifying migration...');

    const verifyResult = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE date_of_birth IS NOT NULL) AS total_with_dob,
        COUNT(*) FILTER (WHERE date_of_birth_normalized IS NOT NULL) AS normalized,
        COUNT(*) FILTER (WHERE date_of_birth IS NOT NULL AND date_of_birth_normalized IS NULL) AS pending
      FROM patients
    `);

    const stats = verifyResult.rows[0];
    console.log(`  Total patients with DOB: ${stats.total_with_dob}`);
    console.log(`  Successfully normalized: ${stats.normalized}`);
    console.log(`  Pending (ambiguous/unparseable): ${stats.pending}`);

    if (parseInt(stats.pending) === 0 || parseInt(stats.pending) === skipped) {
      console.log('\n╔════════════════════════════════════════════════════════════╗');
      console.log('║  ✅ Migration complete! Safe to restart server.            ║');
      console.log('║                                                            ║');
      console.log('║  Run: pm2 restart healthup                                 ║');
      console.log('╚════════════════════════════════════════════════════════════╝\n');
    } else {
      console.log('\n⚠️  Warning: Some patients may still need processing.');
      console.log('   This is OK if they have ambiguous dates (e.g., 01/02/1985).\n');
    }

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error(error);
    process.exitCode = 1;
  } finally {
    client.release();
    await adminPool.end();
  }
}

migrate();
