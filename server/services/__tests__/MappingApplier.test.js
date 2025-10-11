// server/services/__tests__/MappingApplier.test.js
// Unit tests for Mapping Applier (PRD v0.9)

const { normalizeLabel } = require('../MappingApplier');

describe('MappingApplier', () => {
  describe('normalizeLabel', () => {
    it('should handle null and undefined', () => {
      expect(normalizeLabel(null)).toBeNull();
      expect(normalizeLabel(undefined)).toBeNull();
      expect(normalizeLabel('')).toBeNull();
      expect(normalizeLabel('   ')).toBeNull();
    });

    it('should convert to lowercase', () => {
      expect(normalizeLabel('ALT (SGPT)')).toBe('alt sgpt');
      expect(normalizeLabel('HDL Cholesterol')).toBe('hdl cholesterol');
    });

    it('should strip diacritics', () => {
      expect(normalizeLabel('café')).toBe('cafe');
      expect(normalizeLabel('naïve')).toBe('naive');
      // Note: Ukrainian 'і' is preserved (no transliteration to Russian 'и')
      expect(normalizeLabel('Вітамін')).toBe('вітамін');
    });

    it('should normalize micro symbol', () => {
      expect(normalizeLabel('μg/mL')).toBe('microg ml');
      expect(normalizeLabel('µmol/L')).toBe('micromol l');
    });

    it('should remove special characters but keep letters and numbers', () => {
      expect(normalizeLabel('ALT (SGPT)')).toBe('alt sgpt');
      expect(normalizeLabel('Vitamin D (25-OH)')).toBe('vitamin d 25 oh');
      expect(normalizeLabel('C-reactive protein')).toBe('c reactive protein');
    });

    it('should collapse multiple spaces', () => {
      expect(normalizeLabel('Fer  ritin   ')).toBe('fer ritin');
      expect(normalizeLabel('   ALT   ')).toBe('alt');
    });

    it('should handle multilingual input', () => {
      // Russian (и letter)
      expect(normalizeLabel('Гемоглобин')).toBe('гемоглобин');
      expect(normalizeLabel('ГЕМОГЛОБИН')).toBe('гемоглобин');

      // Ukrainian (і letter - no transliteration)
      expect(normalizeLabel('Гемоглобін')).toBe('гемоглобін');

      // Mixed
      expect(normalizeLabel('Вітамін D (25-OH)')).toBe('вітамін d 25 oh');
    });

    it('should preserve parenthetical clarifications', () => {
      expect(normalizeLabel('ALT (SGPT)')).toBe('alt sgpt');
      expect(normalizeLabel('T3 (free)')).toBe('t3 free');
    });

    it('should handle edge cases from PRD examples', () => {
      expect(normalizeLabel('ALT (SGPT)')).toBe('alt sgpt');
      expect(normalizeLabel('Vitamin D (25-OH)')).toBe('vitamin d 25 oh');
      expect(normalizeLabel('Fer ritin  ')).toBe('fer ritin');
      expect(normalizeLabel('  µg/mL  ')).toBe('microg ml');
    });

    it('should handle typos consistently', () => {
      expect(normalizeLabel('Феретинн')).toBe('феретинн');
      expect(normalizeLabel('феретинн')).toBe('феретинн');
      expect(normalizeLabel('Ферритин')).toBe('ферритин');
    });
  });

  describe('Integration scenarios', () => {
    it('should normalize labels that will match aliases', () => {
      // These should normalize to match our seed data
      const testCases = [
        { input: 'Hemoglobin', expected: 'hemoglobin' },
        { input: 'HGB', expected: 'hgb' },
        { input: 'Гемоглобин', expected: 'гемоглобин' },
        { input: 'ALT (SGPT)', expected: 'alt sgpt' },
        { input: 'HDL', expected: 'hdl' },
        { input: 'Ферритин', expected: 'ферритин' },
      ];

      testCases.forEach(({ input, expected }) => {
        expect(normalizeLabel(input)).toBe(expected);
      });
    });
  });
});
