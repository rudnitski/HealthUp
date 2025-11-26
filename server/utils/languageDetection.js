/**
 * Language Detection Utility
 *
 * Robust language detection based on dominant character set analysis.
 * Handles mixed-script text common in medical data (e.g., "Витамин D", "IL-6 интерлейкин").
 */

/**
 * Detect language based on dominant character set
 *
 * @param {string} text - Text to analyze
 * @returns {string} - ISO 639-1 language code (ru, he, ar, zh, en)
 *
 * @example
 * detectLanguage("Витамин D")       // 'ru' (Cyrillic dominant)
 * detectLanguage("IL-6 интерлейкин") // 'ru' (Cyrillic dominant)
 * detectLanguage("Cholesterol")     // 'en' (Latin only)
 * detectLanguage("25-OH vitamin D")  // 'en' (Latin dominant)
 */
function detectLanguage(text) {
  if (!text || typeof text !== 'string') {
    return 'en';
  }

  // Count characters by script
  const cyrillicChars = (text.match(/[\u0400-\u04FF]/g) || []).length;
  const hebrewChars = (text.match(/[\u0590-\u05FF]/g) || []).length;
  const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
  const chineseChars = (text.match(/[\u4E00-\u9FFF]/g) || []).length;
  const latinChars = (text.match(/[a-zA-Z]/g) || []).length;

  // Find dominant script (in order of priority for medical data)
  const scriptCounts = [
    { lang: 'ru', count: cyrillicChars },
    { lang: 'zh', count: chineseChars },
    { lang: 'ar', count: arabicChars },
    { lang: 'he', count: hebrewChars },
    { lang: 'en', count: latinChars }
  ];

  // Sort by count descending
  scriptCounts.sort((a, b) => b.count - a.count);

  // Return language with most characters, default to 'en' if all zero
  return scriptCounts[0].count > 0 ? scriptCounts[0].lang : 'en';
}

export {
  detectLanguage
};
