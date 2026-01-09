// test/utils/dateParser.test.js
import { parseTestDate, formatDateForDb, normalizeTestDate } from '../../server/utils/dateParser.js';

describe('dateParser', () => {
  describe('parseTestDate', () => {
    // ISO format tests
    describe('ISO format (YYYY-MM-DD)', () => {
      test('parses standard ISO date', () => {
        const result = parseTestDate('2021-04-14');
        expect(result).toBeInstanceOf(Date);
        expect(result.getFullYear()).toBe(2021);
        expect(result.getMonth()).toBe(3); // April = 3 (0-indexed)
        expect(result.getDate()).toBe(14);
      });

      test('parses ISO date with time suffix', () => {
        const result = parseTestDate('2021-04-14T20:15:00');
        expect(result).toBeInstanceOf(Date);
        expect(result.getFullYear()).toBe(2021);
        expect(result.getMonth()).toBe(3);
        expect(result.getDate()).toBe(14);
      });

      test('returns null for non-padded ISO (e.g., 2021-4-14)', () => {
        expect(parseTestDate('2021-4-14')).toBeNull();
      });
    });

    // European format tests (unambiguous: day > 12)
    describe('European format (unambiguous)', () => {
      test('parses DD.MM.YYYY when day > 12', () => {
        const result = parseTestDate('15.10.2025');
        expect(result).toBeInstanceOf(Date);
        expect(result.getFullYear()).toBe(2025);
        expect(result.getMonth()).toBe(9); // October = 9
        expect(result.getDate()).toBe(15);
      });

      test('parses DD/MM/YYYY when day > 12', () => {
        const result = parseTestDate('27/08/2021');
        expect(result).toBeInstanceOf(Date);
        expect(result.getFullYear()).toBe(2021);
        expect(result.getMonth()).toBe(7); // August = 7
        expect(result.getDate()).toBe(27);
      });

      test('parses DD-MM-YYYY when day > 12', () => {
        const result = parseTestDate('13-02-2024');
        expect(result).toBeInstanceOf(Date);
        expect(result.getFullYear()).toBe(2024);
        expect(result.getMonth()).toBe(1); // February = 1
        expect(result.getDate()).toBe(13);
      });
    });

    // Ambiguous date tests (day <= 12 AND month <= 12)
    describe('Ambiguous dates (day <= 12 AND month <= 12)', () => {
      test('returns null for 03.03.2017 (ambiguous)', () => {
        expect(parseTestDate('03.03.2017')).toBeNull();
      });

      test('returns null for 06/07/2021 (ambiguous)', () => {
        expect(parseTestDate('06/07/2021')).toBeNull();
      });

      test('returns null for 08/08/2023 8:06 (ambiguous with time)', () => {
        expect(parseTestDate('08/08/2023 8:06')).toBeNull();
      });

      test('returns null for 05/03/23 (ambiguous two-digit year)', () => {
        expect(parseTestDate('05/03/23')).toBeNull();
      });
    });

    // Two-digit year tests
    describe('Two-digit years', () => {
      test('parses YY >= 50 as 19xx (unambiguous day)', () => {
        const result = parseTestDate('15/03/95');
        expect(result).toBeInstanceOf(Date);
        expect(result.getFullYear()).toBe(1995);
        expect(result.getMonth()).toBe(2); // March = 2
        expect(result.getDate()).toBe(15);
      });

      test('parses YY < 50 as 20xx (unambiguous day)', () => {
        const result = parseTestDate('15/03/23');
        expect(result).toBeInstanceOf(Date);
        expect(result.getFullYear()).toBe(2023);
        expect(result.getMonth()).toBe(2); // March = 2
        expect(result.getDate()).toBe(15);
      });
    });

    // Whitespace handling
    describe('Whitespace handling', () => {
      test('trims leading/trailing whitespace', () => {
        const result = parseTestDate('  2021-04-14  ');
        expect(result).toBeInstanceOf(Date);
        expect(result.getFullYear()).toBe(2021);
      });
    });

    // Invalid input tests
    describe('Invalid inputs', () => {
      test('returns null for empty string', () => {
        expect(parseTestDate('')).toBeNull();
      });

      test('returns null for null input', () => {
        expect(parseTestDate(null)).toBeNull();
      });

      test('returns null for undefined input', () => {
        expect(parseTestDate(undefined)).toBeNull();
      });

      test('returns null for non-string input', () => {
        expect(parseTestDate(12345)).toBeNull();
      });

      test('returns null for unparseable text', () => {
        expect(parseTestDate('invalid')).toBeNull();
      });

      test('returns null for invalid day/month (32/13/2021)', () => {
        expect(parseTestDate('32/13/2021')).toBeNull();
      });

      test('returns null for Feb 31 (invalid date)', () => {
        expect(parseTestDate('31/02/2023')).toBeNull();
      });
    });

    // Leap year tests
    describe('Leap year handling', () => {
      test('parses Feb 29 in leap year (unambiguous: day > 12)', () => {
        const result = parseTestDate('29/02/2024');
        expect(result).toBeInstanceOf(Date);
        expect(result.getFullYear()).toBe(2024);
        expect(result.getMonth()).toBe(1); // February = 1
        expect(result.getDate()).toBe(29);
      });

      test('returns null for Feb 29 in non-leap year', () => {
        expect(parseTestDate('29/02/2023')).toBeNull();
      });
    });

    // Year range tests
    describe('Year range validation', () => {
      test('rejects year before 1950', () => {
        expect(parseTestDate('2021-04-14'.replace('2021', '1900'))).toBeNull();
      });

      test('rejects year after 2100', () => {
        expect(parseTestDate('2150-04-14')).toBeNull();
      });
    });
  });

  describe('formatDateForDb', () => {
    test('formats Date to YYYY-MM-DD string', () => {
      const date = new Date(2021, 3, 14); // April 14, 2021
      expect(formatDateForDb(date)).toBe('2021-04-14');
    });

    test('zero-pads single digit month and day', () => {
      const date = new Date(2021, 0, 5); // January 5, 2021
      expect(formatDateForDb(date)).toBe('2021-01-05');
    });

    test('returns null for null input', () => {
      expect(formatDateForDb(null)).toBeNull();
    });

    test('returns null for invalid Date', () => {
      expect(formatDateForDb(new Date('invalid'))).toBeNull();
    });

    test('returns null for non-Date input', () => {
      expect(formatDateForDb('2021-04-14')).toBeNull();
    });
  });

  describe('normalizeTestDate', () => {
    test('parses and formats in one step', () => {
      expect(normalizeTestDate('15.10.2025')).toBe('2025-10-15');
    });

    test('returns null for ambiguous dates', () => {
      expect(normalizeTestDate('06/07/2021')).toBeNull();
    });

    test('returns null for invalid input', () => {
      expect(normalizeTestDate('invalid')).toBeNull();
    });

    test('parses ISO format correctly', () => {
      expect(normalizeTestDate('2021-04-14')).toBe('2021-04-14');
    });

    test('parses ISO with time suffix', () => {
      expect(normalizeTestDate('2021-04-14T20:15:00')).toBe('2021-04-14');
    });
  });
});
