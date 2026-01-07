/**
 * Validate all canonical UCUM units from seed_unit_aliases.sql
 */
import ucumPkg from '@lhncbc/ucum-lhc';

const utils = ucumPkg.UcumLhcUtils.getInstance();

// All canonical units from seed file
const canonicalUnits = [
  'mmol/L',
  'umol/L',
  'nmol/L',
  'pmol/L',
  'mg/dL',
  'g/L',
  'g/dL',
  'mg/L',
  'ug/L',
  'ug/dL',
  'ng/mL',
  'pg/mL',
  'U/L',
  '[IU]/L',
  'm[IU]/L',
  'u[IU]/mL',
  '10*9/L',
  '10*12/L',
  'fL',
  'pg',
  '%',
  '[ppth]',
  'mm/h',
  'mosm/kg',
  's',
  'U',
  '{index}',
  '/[HPF]'
];

console.log('Validating all canonical UCUM units from seed file:\n');
console.log('Unit'.padEnd(15) + '| Valid | Messages');
console.log('-'.repeat(70));

let invalidCount = 0;
for (const unit of canonicalUnits) {
  const result = utils.validateUnitString(unit, true);
  const isValid = result.status === 'valid';
  if (!isValid) invalidCount++;

  const messages = result.msg?.join('; ') || '';
  const status = isValid ? '✅' : '❌';
  console.log(unit.padEnd(15) + '| ' + status + '    | ' + messages.substring(0, 50));
}

console.log('\n' + '-'.repeat(70));
console.log(`Total: ${canonicalUnits.length} units, ${invalidCount} invalid`);

if (invalidCount > 0) {
  console.log('\n⚠️  Some units are invalid UCUM codes!');
  process.exit(1);
} else {
  console.log('\n✅ All units are valid UCUM codes!');
}
