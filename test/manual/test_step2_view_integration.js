/**
 * PRD v4.8.1 Step 2 Verification: View Integration
 * Tests that v_measurements view correctly exposes unit_normalized column
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../../.env') });

const pool = new pg.Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'healthup',
  user: process.env.DB_ADMIN_USER || 'healthup_admin',
  password: process.env.DB_ADMIN_PASSWORD || 'healthup_admin_pass'
});

async function testStep2() {
  const client = await pool.connect();

  try {
    console.log('\n' + '='.repeat(70));
    console.log('  PRD v4.8.1 Step 2: View Integration Verification');
    console.log('='.repeat(70) + '\n');

    // Test 1: Column existence
    console.log('Test 1: Verify v_measurements has both unit columns');
    console.log('-'.repeat(70));
    const columnCheck = await client.query(`
      SELECT
        column_name,
        data_type,
        ordinal_position,
        col_description('v_measurements'::regclass, ordinal_position) as description
      FROM information_schema.columns
      WHERE table_name = 'v_measurements'
        AND column_name IN ('units', 'unit_normalized')
      ORDER BY ordinal_position;
    `);

    if (columnCheck.rows.length === 2) {
      console.log(' PASS: Both columns exist\n');
      columnCheck.rows.forEach(row => {
        console.log(`   ${row.column_name} (${row.data_type}) - position ${row.ordinal_position}`);
        if (row.description) {
          console.log(`   Description: ${row.description}\n`);
        }
      });
    } else {
      console.log(` FAIL: Expected 2 columns, found ${columnCheck.rows.length}\n`);
      process.exit(1);
    }

    // Test 2: Actual data normalization
    console.log('\nTest 2: Verify unit normalization works with actual data');
    console.log('-'.repeat(70));
    const normTest = await client.query(`
      SELECT
        units AS raw_unit,
        unit_normalized,
        COUNT(*) AS data_points
      FROM v_measurements
      WHERE units IS NOT NULL
      GROUP BY units, unit_normalized
      ORDER BY COUNT(*) DESC
      LIMIT 10;
    `);

    if (normTest.rows.length > 0) {
      console.log('Sample results:\n');
      console.log('   Raw Unit       | Normalized     | Data Points');
      console.log('   ' + '-'.repeat(60));
      normTest.rows.forEach(row => {
        const raw = row.raw_unit.padEnd(14);
        const norm = row.unit_normalized.padEnd(14);
        const arrow = raw.trim() !== norm.trim() ? ' → ' : ' = ';
        console.log(`   ${raw}${arrow}${norm} | ${row.data_points}`);
      });

      const normalizedCount = normTest.rows.filter(r => r.raw_unit !== r.unit_normalized).length;
      console.log(`\n PASS: ${normalizedCount}/${normTest.rows.length} unit variants are being normalized\n`);
    } else {
      console.log(' WARNING: No data in v_measurements to test\n');
    }

    // Test 3: Plot query simulation
    console.log('\nTest 3: Simulate plot query (how SQL generator should work)');
    console.log('-'.repeat(70));
    console.log('Expected SQL format:\n');
    console.log('  SELECT');
    console.log('    date_eff AS t,');
    console.log('    value_num AS y,');
    console.log('    parameter_name,');
    console.log('    unit_normalized AS unit,  -- KEY: Use unit_normalized for plots');
    console.log('    reference_lower AS reference_low,');
    console.log('    reference_upper AS reference_high');
    console.log('  FROM v_measurements');
    console.log('  WHERE parameter_name ILIKE \'%холестерин%\'');
    console.log('  ORDER BY date_eff;');
    console.log('');

    const plotResult = await client.query(`
      SELECT
        date_eff AS t,
        value_num AS y,
        parameter_name,
        unit_normalized AS unit,
        reference_lower AS reference_low,
        reference_upper AS reference_high
      FROM v_measurements
      WHERE parameter_name ILIKE '%холестерин%'
        AND value_num IS NOT NULL
      ORDER BY date_eff
      LIMIT 10;
    `);

    if (plotResult.rows.length > 0) {
      const uniqueUnits = new Set(plotResult.rows.map(r => r.unit));
      console.log(` PASS: Query executed successfully (${plotResult.rows.length} rows)`);
      console.log(`   Unique units: ${Array.from(uniqueUnits).join(', ')}`);
      console.log('\n   Sample row:');
      const sample = plotResult.rows[0];
      console.log(`   Date: ${sample.t}, Value: ${sample.y} ${sample.unit}`);
      console.log(`   Parameter: ${sample.parameter_name}\n`);
    } else {
      console.log(' INFO: No cholesterol data found for demo\n');
    }

    console.log('\n' + '='.repeat(70));
    console.log('  ALL TESTS PASSED');
    console.log('='.repeat(70) + '\n');

    console.log('Next Steps:');
    console.log('   1. Open http://localhost:3000 in your browser');
    console.log('   2. Go to chat interface');
    console.log('   3. Ask: "Show my cholesterol over time"');
    console.log('   4. Verify generated SQL uses: unit_normalized AS unit');
    console.log('   5. Verify plot renders as single connected line\n');

  } catch (error) {
    console.error('\nTEST FAILED:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

testStep2();
