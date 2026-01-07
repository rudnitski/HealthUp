/**
 * PRD v4.8.3: UCUM Library Behavior Verification
 *
 * This script tests the @lhncbc/ucum-lhc library to verify behavior before implementation.
 * Run this BEFORE implementing UCUM validation to ensure assumptions are correct.
 *
 * Usage:
 *   node test/manual/test_ucum_library_behavior.js
 */

import ucumPkg from '@lhncbc/ucum-lhc';

const ucum = ucumPkg.UcumLhcUtils.getInstance();

const testCases = [
  // Expected VALID - Standard medical units
  { unit: 'mmol/L', expectValid: true, note: 'Standard molar concentration' },
  { unit: '10*9/L', expectValid: true, note: 'UCUM exponentiation syntax (cell counts)' },
  { unit: 'mg/dL', expectValid: true, note: 'Mass concentration' },
  { unit: 'ug/L', expectValid: true, note: 'Microgram ASCII (u = micro)' },
  { unit: 'U/L', expectValid: true, note: 'Enzyme unit' },
  { unit: '[IU]/L', expectValid: true, note: 'International unit (UCUM requires brackets)' },
  { unit: '%', expectValid: true, note: 'Percent' },
  { unit: 'fL', expectValid: true, note: 'Femtoliter' },
  { unit: 'pg', expectValid: true, note: 'Picogram' },
  { unit: 'mm[Hg]', expectValid: true, note: 'Blood pressure (millimeters of mercury)' },
  { unit: 'm[IU]/mL', expectValid: true, note: 'Milli-international units per mL (UCUM brackets)' },
  { unit: 'ng/mL', expectValid: true, note: 'Nanogram per milliliter' },
  { unit: 'g/L', expectValid: true, note: 'Gram per liter' },
  { unit: 'mol/L', expectValid: true, note: 'Molar concentration' },
  { unit: 'umol/L', expectValid: true, note: 'Micromolar concentration' },
  { unit: 's', expectValid: true, note: 'Seconds' },
  { unit: 'min', expectValid: true, note: 'Minutes' },
  { unit: 'h', expectValid: true, note: 'Hours' },
  { unit: 'mm/h', expectValid: true, note: 'ESR units (mm per hour)' },
  { unit: 'g/dL', expectValid: true, note: 'Gram per deciliter' },
  { unit: '10*12/L', expectValid: true, note: 'RBC count units' },
  { unit: 'mg/L', expectValid: true, note: 'Milligram per liter' },
  { unit: 'uU/mL', expectValid: true, note: 'Micro-units per mL (insulin)' },

  // NOTE: UCUM library accepts ^ notation (contrary to strict UCUM spec)
  // These are valid according to the library, though 10*9 is the canonical form
  { unit: '10^9/L', expectValid: true, note: 'Caret notation accepted by library (10*9 is canonical)' },
  { unit: '10^12/L', expectValid: true, note: 'Caret notation accepted by library (10*12 is canonical)' },

  // Expected INVALID - Common mistakes
  { unit: 'millimoles per liter', expectValid: false, note: 'Natural language not UCUM' },
  { unit: 'mmol/litre', expectValid: false, note: 'Non-UCUM spelling' },
  { unit: 'xyz123', expectValid: false, note: 'Nonsense input' },

  // Edge cases - Verify behavior
  { unit: 'cells/uL', expectValid: null, note: 'Check if cells recognized as annotation' },
  { unit: 'copies/mL', expectValid: null, note: 'Check if copies recognized (viral load)' },
  { unit: '{index}', expectValid: null, note: 'UCUM annotation syntax' },
  { unit: '[IU]/L', expectValid: null, note: 'Alternative IU notation' },
  { unit: 'mmol/l', expectValid: null, note: 'Lowercase L - check normalization' },
  { unit: 'MMOL/L', expectValid: null, note: 'Uppercase - check case sensitivity' },
  { unit: '', expectValid: false, note: 'Empty string' },
  { unit: ' ', expectValid: false, note: 'Whitespace only' },

  // Unicode variants (should be preprocessed before validation)
  { unit: 'μg/L', expectValid: null, note: 'Greek mu - may or may not be valid directly' },
];

console.log('UCUM Library Behavior Verification');
console.log('='.repeat(60));
console.log();

let passed = 0;
let failed = 0;
let unknown = 0;

testCases.forEach(({ unit, expectValid, note }) => {
  try {
    const result = ucum.validateUnitString(unit, true);
    const isValid = result.status === 'valid';
    const hasWarnings = result.msg?.some(m => m.toLowerCase().includes('warning'));

    let symbol;
    if (expectValid === null) {
      symbol = '?';
      unknown++;
    } else if (isValid === expectValid) {
      symbol = '✓';
      passed++;
    } else {
      symbol = '✗';
      failed++;
    }

    console.log(`${symbol} "${unit}"`);
    console.log(`  Status: ${result.status}`);
    console.log(`  UCUM Code: ${result.ucumCode || 'N/A'}`);
    if (result.msg && result.msg.length > 0) {
      console.log(`  Messages: ${JSON.stringify(result.msg)}`);
    }
    if (hasWarnings) {
      console.log(`  Has Warnings: YES`);
    }
    console.log(`  Note: ${note}`);
    console.log();
  } catch (error) {
    console.log(`✗ "${unit}" - ERROR: ${error.message}`);
    console.log(`  Note: ${note}`);
    console.log();
    failed++;
  }
});

console.log('='.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed, ${unknown} unknown (to verify)`);

if (failed > 0) {
  console.log('\n⚠️  Some expected validations failed. Review the assumptions in PRD v4.8.3.');
  process.exit(1);
}

console.log('\n✅ All expected validations passed!');
console.log('Review the unknown (?) cases before proceeding with implementation.');
