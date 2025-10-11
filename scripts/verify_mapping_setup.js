#!/usr/bin/env node
// scripts/verify_mapping_setup.js
// Quick verification script for Mapping Applier setup

require('dotenv').config();
const { pool } = require('../server/db');

async function verifySetup() {
  console.log('🔍 Verifying Mapping Applier Setup...\n');

  const checks = {
    passed: [],
    failed: [],
    warnings: [],
  };

  try {
    // 1. Check database connection
    try {
      await pool.query('SELECT 1');
      checks.passed.push('✅ Database connection');
    } catch (error) {
      checks.failed.push(`❌ Database connection: ${error.message}`);
      throw error; // Can't continue without DB
    }

    // 2. Check tables exist
    const tables = ['analytes', 'analyte_aliases', 'lab_results'];
    for (const table of tables) {
      const { rows } = await pool.query(
        `SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = $1
        )`,
        [table]
      );
      if (rows[0].exists) {
        checks.passed.push(`✅ Table ${table} exists`);
      } else {
        checks.failed.push(`❌ Table ${table} missing`);
      }
    }

    // 3. Check pg_trgm extension
    const { rows: extRows } = await pool.query(
      "SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_trgm') AS enabled"
    );
    if (extRows[0].enabled) {
      checks.passed.push('✅ pg_trgm extension installed');
    } else {
      checks.warnings.push('⚠️  pg_trgm extension not available (fuzzy matching will be disabled)');
    }

    // 4. Check analyte_id column in lab_results
    const { rows: colRows } = await pool.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_name='lab_results' AND column_name='analyte_id'`
    );
    if (colRows.length > 0) {
      checks.passed.push('✅ lab_results.analyte_id column exists');
    } else {
      checks.failed.push('❌ lab_results.analyte_id column missing');
    }

    // 5. Check seed data
    const { rows: analyteRows } = await pool.query('SELECT COUNT(*) as count FROM analytes');
    const analyteCount = parseInt(analyteRows[0].count);

    const { rows: aliasRows } = await pool.query('SELECT COUNT(*) as count FROM analyte_aliases');
    const aliasCount = parseInt(aliasRows[0].count);

    if (analyteCount >= 50) {
      checks.passed.push(`✅ Seed data loaded: ${analyteCount} analytes, ${aliasCount} aliases`);
    } else if (analyteCount > 0) {
      checks.warnings.push(`⚠️  Partial seed data: ${analyteCount} analytes (target: ≥50), ${aliasCount} aliases`);
    } else {
      checks.warnings.push('⚠️  No seed data loaded (run server/db/seed_analytes.sql)');
    }

    // 6. Check environment variables
    if (process.env.ENABLE_MAPPING_DRY_RUN === 'true') {
      checks.passed.push('✅ ENABLE_MAPPING_DRY_RUN=true');
    } else {
      checks.warnings.push('⚠️  ENABLE_MAPPING_DRY_RUN not set to true (dry-run disabled)');
    }

    const thresholds = {
      MAPPING_AUTO_ACCEPT: parseFloat(process.env.MAPPING_AUTO_ACCEPT || '0.80'),
      MAPPING_QUEUE_LOWER: parseFloat(process.env.MAPPING_QUEUE_LOWER || '0.60'),
      BACKFILL_SIMILARITY_THRESHOLD: parseFloat(process.env.BACKFILL_SIMILARITY_THRESHOLD || '0.70'),
    };

    checks.passed.push(`✅ Thresholds configured: AUTO=${thresholds.MAPPING_AUTO_ACCEPT}, QUEUE=${thresholds.MAPPING_QUEUE_LOWER}, FUZZY=${thresholds.BACKFILL_SIMILARITY_THRESHOLD}`);

    // 7. Check indexes
    const { rows: indexRows } = await pool.query(
      `SELECT indexname FROM pg_indexes
       WHERE tablename = 'analyte_aliases'
       AND (indexname = 'idx_alias_lower' OR indexname = 'idx_alias_trgm')`
    );
    const hasLowerIndex = indexRows.some(r => r.indexname === 'idx_alias_lower');
    const hasTrgrIndex = indexRows.some(r => r.indexname === 'idx_alias_trgm');

    if (hasLowerIndex) {
      checks.passed.push('✅ Index idx_alias_lower exists');
    } else {
      checks.warnings.push('⚠️  Index idx_alias_lower missing (exact matches may be slow)');
    }

    if (hasTrgrIndex) {
      checks.passed.push('✅ Index idx_alias_trgm exists');
    } else if (extRows[0].enabled) {
      checks.warnings.push('⚠️  Index idx_alias_trgm missing (fuzzy matches may be slow)');
    }

  } catch (error) {
    console.error('❌ Verification failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }

  // Print results
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('VERIFICATION RESULTS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (checks.passed.length > 0) {
    console.log('✅ PASSED:\n');
    checks.passed.forEach(msg => console.log(`   ${msg}`));
    console.log();
  }

  if (checks.warnings.length > 0) {
    console.log('⚠️  WARNINGS:\n');
    checks.warnings.forEach(msg => console.log(`   ${msg}`));
    console.log();
  }

  if (checks.failed.length > 0) {
    console.log('❌ FAILED:\n');
    checks.failed.forEach(msg => console.log(`   ${msg}`));
    console.log();
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (checks.failed.length === 0) {
    console.log('✅ Setup verification complete!');
    if (checks.warnings.length > 0) {
      console.log('⚠️  Some warnings detected. Review above.');
    }
    console.log('\n📚 Next steps:');
    console.log('   1. Load seed data: psql $DATABASE_URL -f server/db/seed_analytes.sql');
    console.log('   2. Set ENABLE_MAPPING_DRY_RUN=true in .env');
    console.log('   3. Upload a lab report and check logs\n');
    process.exit(0);
  } else {
    console.log('❌ Setup incomplete. Fix failed checks above.');
    process.exit(1);
  }
}

verifySetup();
