/**
 * PRD v4.8 Unit Aliases Validation Tests
 * Runs the test queries from section 3.4 of the PRD
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root
dotenv.config({ path: join(__dirname, '../../.env') });

const pool = new pg.Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'healthup',
  user: process.env.DB_ADMIN_USER || 'healthup_admin',
  password: process.env.DB_ADMIN_PASSWORD || 'healthup_admin_pass'
});

async function runTests() {
  const client = await pool.connect();

  try {
    console.log('\n=== PRD v4.8 Unit Aliases Validation Tests ===\n');

    // Test 1: Verify alias table populated
    console.log('Test 1: Verify alias table populated');
    const test1 = await client.query(`
      SELECT COUNT(*) as total_aliases,
             COUNT(DISTINCT unit_canonical) as unique_canonical
      FROM unit_aliases;
    `);
    console.log('Result:', test1.rows[0]);
    console.log('✅ Expected: total_aliases > 100, unique_canonical > 20\n');

    // Test 2: Verify normalization function works
    console.log('Test 2: Verify normalization function works');
    const test2 = await client.query(`
      SELECT
        normalize_unit_string('  mmol / L  ') AS spaces_trimmed,
        normalize_unit_string('μmol/L') AS greek_mu,
        normalize_unit_string('') AS empty_string,
        normalize_unit_string(NULL) AS null_input;
    `);
    console.log('Result:', test2.rows[0]);
    console.log('Expected:');
    console.log('  - spaces_trimmed: "mmol / L"');
    console.log('  - greek_mu: "μmol/L" (NFKC normalized)');
    console.log('  - empty_string: NULL');
    console.log('  - null_input: NULL\n');

    // Test 3: Check HDL data normalization
    console.log('Test 3: Check HDL data normalization');
    const test3 = await client.query(`
      SELECT
        lr.parameter_name,
        pr.test_date_text,
        lr.numeric_result,
        lr.unit AS unit_raw,
        COALESCE(ua.unit_canonical, lr.unit) AS unit_normalized,
        CASE WHEN ua.unit_canonical IS NOT NULL THEN 'mapped' ELSE 'UNMAPPED' END AS status
      FROM lab_results lr
      JOIN patient_reports pr ON pr.id = lr.report_id
      LEFT JOIN analytes a ON lr.analyte_id = a.analyte_id
      LEFT JOIN unit_aliases ua ON normalize_unit_string(lr.unit) = ua.alias
      WHERE a.code = 'HDL'
      ORDER BY pr.test_date_text
      LIMIT 10;
    `);
    console.log(`Found ${test3.rows.length} HDL records`);
    if (test3.rows.length > 0) {
      console.log('Sample records:');
      test3.rows.forEach(row => {
        console.log(`  ${row.test_date_text}: ${row.numeric_result} ${row.unit_raw} → ${row.unit_normalized} (${row.status})`);
      });
      const allMapped = test3.rows.every(row => row.status === 'mapped');
      const sameUnit = new Set(test3.rows.map(row => row.unit_normalized)).size === 1;
      console.log(allMapped ? '✅ All records mapped' : '⚠️  Some records unmapped');
      console.log(sameUnit ? '✅ All normalized to same unit' : '⚠️  Multiple normalized units');
    }
    console.log();

    // Test 4: Check Creatinine data normalization
    console.log('Test 4: Check Creatinine data normalization');
    const test4 = await client.query(`
      SELECT
        lr.parameter_name,
        pr.test_date_text,
        lr.numeric_result,
        lr.unit AS unit_raw,
        COALESCE(ua.unit_canonical, lr.unit) AS unit_normalized,
        CASE WHEN ua.unit_canonical IS NOT NULL THEN 'mapped' ELSE 'UNMAPPED' END AS status
      FROM lab_results lr
      JOIN patient_reports pr ON pr.id = lr.report_id
      LEFT JOIN analytes a ON lr.analyte_id = a.analyte_id
      LEFT JOIN unit_aliases ua ON normalize_unit_string(lr.unit) = ua.alias
      WHERE a.code = 'CREA'
      ORDER BY pr.test_date_text
      LIMIT 10;
    `);
    console.log(`Found ${test4.rows.length} Creatinine records`);
    if (test4.rows.length > 0) {
      console.log('Sample records:');
      test4.rows.forEach(row => {
        console.log(`  ${row.test_date_text}: ${row.numeric_result} ${row.unit_raw} → ${row.unit_normalized} (${row.status})`);
      });
      const allMapped = test4.rows.every(row => row.status === 'mapped');
      const sameUnit = new Set(test4.rows.map(row => row.unit_normalized)).size === 1;
      console.log(allMapped ? '✅ All records mapped' : '⚠️  Some records unmapped');
      console.log(sameUnit ? '✅ All normalized to same unit' : '⚠️  Multiple normalized units');
    }
    console.log();

    // Test 5: Find unmapped units (gaps in coverage)
    console.log('Test 5: Find unmapped units (gaps in coverage)');
    const test5 = await client.query(`
      SELECT
        lr.unit,
        normalize_unit_string(lr.unit) AS unit_normalized,
        COUNT(*) as occurrences
      FROM lab_results lr
      LEFT JOIN unit_aliases ua ON normalize_unit_string(lr.unit) = ua.alias
      WHERE ua.alias IS NULL
        AND lr.unit IS NOT NULL
        AND lr.unit != ''
      GROUP BY lr.unit
      ORDER BY occurrences DESC
      LIMIT 20;
    `);
    console.log(`Found ${test5.rows.length} unmapped unit variations`);
    if (test5.rows.length > 0) {
      console.log('Top unmapped units:');
      test5.rows.forEach(row => {
        console.log(`  ${row.unit} (normalized: ${row.unit_normalized}): ${row.occurrences} occurrences`);
      });
    } else {
      console.log('✅ No unmapped units found!');
    }
    console.log();

    // Test 6: Overall mapping coverage
    console.log('Test 6: Overall mapping coverage');
    const test6 = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE ua.alias IS NOT NULL) AS mapped_rows,
        COUNT(*) AS total_rows,
        ROUND(100.0 * COUNT(*) FILTER (WHERE ua.alias IS NOT NULL) / NULLIF(COUNT(*),0), 2) AS mapped_pct
      FROM lab_results lr
      LEFT JOIN unit_aliases ua ON normalize_unit_string(lr.unit) = ua.alias
      WHERE lr.unit IS NOT NULL AND lr.unit <> '';
    `);
    console.log('Coverage:', test6.rows[0]);
    const coverage = parseFloat(test6.rows[0].mapped_pct);
    if (coverage >= 95) {
      console.log(`✅ Coverage target met: ${coverage}% (target: 95%)`);
    } else {
      console.log(`⚠️  Coverage below target: ${coverage}% (target: 95%)`);
    }
    console.log();

    console.log('=== All tests completed ===\n');

  } catch (error) {
    console.error('Test execution failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
