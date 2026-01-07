/**
 * PRD v4.8.3: Seed Unit Aliases UCUM Validation
 *
 * Validates all canonical units in seed_unit_aliases.sql against UCUM specification.
 * Run this BEFORE deploying UCUM validation to ensure seed data is valid.
 *
 * Usage:
 *   node test/manual/test_seed_unit_aliases_ucum.js
 */

import ucumPkg from '@lhncbc/ucum-lhc';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ucum = ucumPkg.UcumLhcUtils.getInstance();

// Read seed file
const seedPath = path.join(__dirname, '../../server/db/seed_unit_aliases.sql');

if (!fs.existsSync(seedPath)) {
  console.error('❌ Seed file not found:', seedPath);
  process.exit(1);
}

const seedSQL = fs.readFileSync(seedPath, 'utf8');

// Extract canonical units from INSERT statements
// Pattern matches: ('alias', 'canonical')
const insertPattern = /\('([^']+)',\s*'([^']+)'\)/g;
const canonicalUnits = new Set();

let match;
while ((match = insertPattern.exec(seedSQL)) !== null) {
  // match[2] is the canonical unit (second value in the tuple)
  canonicalUnits.add(match[2]);
}

console.log('UCUM Validation for Seed Unit Aliases');
console.log('='.repeat(60));
console.log(`Found ${canonicalUnits.size} unique canonical units in seed file`);
console.log();

let valid = 0;
let invalid = 0;
let warnings = 0;

const sortedUnits = [...canonicalUnits].sort();

sortedUnits.forEach(unit => {
  const result = ucum.validateUnitString(unit, true);
  const hasWarnings = result.msg?.some(m => m.toLowerCase().includes('warning'));

  if (result.status !== 'valid') {
    console.log(`✗ INVALID: "${unit}"`);
    console.log(`  Messages: ${JSON.stringify(result.msg)}`);
    invalid++;
  } else if (hasWarnings) {
    console.log(`⚠ WARNING: "${unit}"`);
    console.log(`  Messages: ${JSON.stringify(result.msg)}`);
    warnings++;
  } else {
    console.log(`✓ "${unit}"`);
    valid++;
  }
});

console.log();
console.log('='.repeat(60));
console.log(`Results: ${valid} valid, ${warnings} warnings, ${invalid} invalid`);

if (invalid > 0) {
  console.log('\n❌ SEED DATA CONTAINS INVALID UCUM CODES - FIX BEFORE PRODUCTION');
  console.log('Action: Update canonical values in server/db/seed_unit_aliases.sql');
  process.exit(1);
}

if (warnings > 0) {
  console.log('\n⚠️  Some units have warnings - review if UCUM_VALIDATION_STRICT=true is planned');
}

console.log('\n✅ All canonical units in seed file are valid UCUM codes!');
