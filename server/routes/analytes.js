/**
 * Analytes API Routes
 * PRD v7.0: Provides analyte translations for i18n support
 */

import express from 'express';
import { adminPool } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * GET /api/analytes/translations
 * Returns analyte translations for a specific locale
 *
 * Query params:
 *   - locale: ISO 639-1 language code (e.g., 'en', 'ru')
 *
 * Response:
 *   {
 *     locale: 'ru',
 *     translations: {
 *       'CHOL': 'Холестерин',
 *       'HDL': 'ЛПВП',
 *       ...
 *     }
 *   }
 */
router.get('/translations', requireAuth, async (req, res) => {
  try {
    const { locale } = req.query;

    if (!locale) {
      return res.status(400).json({ error: 'Missing required parameter: locale' });
    }

    // Validate locale format (2-letter ISO code)
    if (!/^[a-z]{2}$/.test(locale)) {
      return res.status(400).json({ error: 'Invalid locale format. Use ISO 639-1 (e.g., "en", "ru")' });
    }

    // Fetch translations from database
    // Uses adminPool since this is a global catalog (no RLS)
    const result = await adminPool.query(`
      SELECT
        a.code AS analyte_code,
        at.display_name
      FROM analyte_translations at
      JOIN analytes a ON a.analyte_id = at.analyte_id
      WHERE at.locale = $1
    `, [locale]);

    // Transform to key-value map
    const translations = {};
    for (const row of result.rows) {
      translations[row.analyte_code] = row.display_name;
    }

    logger.info({
      event: 'analyte_translations_fetched',
      locale,
      count: result.rows.length
    });

    res.json({
      locale,
      translations
    });
  } catch (error) {
    logger.error({ event: 'analyte_translations_error', error: error.message });
    res.status(500).json({ error: 'Failed to fetch translations' });
  }
});

/**
 * GET /api/analytes
 * Returns list of all analytes with their codes and names
 *
 * Response:
 *   {
 *     analytes: [
 *       { analyte_id: 1, code: 'CHOL', name: 'Cholesterol' },
 *       ...
 *     ]
 *   }
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await adminPool.query(`
      SELECT analyte_id, code, name
      FROM analytes
      ORDER BY name
    `);

    res.json({ analytes: result.rows });
  } catch (error) {
    logger.error({ event: 'analytes_list_error', error: error.message });
    res.status(500).json({ error: 'Failed to fetch analytes' });
  }
});

export default router;
