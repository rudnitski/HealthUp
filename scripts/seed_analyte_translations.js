#!/usr/bin/env node
// scripts/seed_analyte_translations.js
// PRD v7.0: Seed analyte_translations table with English and Russian display names

// Load environment variables before other imports
import '../server/config/loadEnv.js';

import { pool, queryAsAdmin } from '../server/db/index.js';

/**
 * Main seed function
 */
async function seedAnalyteTranslations() {
  console.log('[seed] Starting analyte translations seed...');

  // Acquire advisory lock to prevent concurrent runs
  const lockId = 789012; // Arbitrary lock ID for translations seed
  const { rows: lockResult } = await pool.query(
    'SELECT pg_try_advisory_lock($1) AS acquired',
    [lockId]
  );

  if (!lockResult[0].acquired) {
    console.error('[seed] ERROR: Another seed process is already running. Exiting.');
    process.exit(1);
  }

  console.log('[seed] Advisory lock acquired');

  try {
    // Step 1: Fetch all analytes
    const { rows: analytes } = await queryAsAdmin(
      'SELECT analyte_id, code, name FROM analytes ORDER BY code'
    );
    console.log(`[seed] Found ${analytes.length} analytes`);

    if (analytes.length === 0) {
      console.log('[seed] No analytes found. Run seed_analytes.sql first.');
      return;
    }

    // Step 2: Fetch Russian aliases (best match per analyte)
    // Get first Russian alias for each analyte (highest confidence)
    const { rows: russianAliases } = await queryAsAdmin(`
      SELECT DISTINCT ON (analyte_id)
        analyte_id,
        alias AS display_name
      FROM analyte_aliases
      WHERE lang = 'ru' AND confidence >= 0.9
      ORDER BY analyte_id, confidence DESC, created_at ASC
    `);

    // Create a map for quick lookup
    const russianMap = new Map();
    for (const row of russianAliases) {
      // Capitalize first letter for display
      const displayName = row.display_name.charAt(0).toUpperCase() + row.display_name.slice(1);
      russianMap.set(row.analyte_id, displayName);
    }
    console.log(`[seed] Found ${russianMap.size} Russian aliases`);

    // Step 3: Check existing translations
    const { rows: existingTranslations } = await queryAsAdmin(
      'SELECT analyte_id, locale FROM analyte_translations'
    );
    const existingSet = new Set(
      existingTranslations.map(t => `${t.analyte_id}:${t.locale}`)
    );
    console.log(`[seed] Found ${existingTranslations.length} existing translations`);

    // Step 4: Prepare translations to insert
    const translationsToInsert = [];

    for (const analyte of analytes) {
      // English: use analyte.name
      const enKey = `${analyte.analyte_id}:en`;
      if (!existingSet.has(enKey)) {
        translationsToInsert.push({
          analyte_id: analyte.analyte_id,
          locale: 'en',
          display_name: analyte.name
        });
      }

      // Russian: use alias if available
      const ruKey = `${analyte.analyte_id}:ru`;
      if (!existingSet.has(ruKey) && russianMap.has(analyte.analyte_id)) {
        translationsToInsert.push({
          analyte_id: analyte.analyte_id,
          locale: 'ru',
          display_name: russianMap.get(analyte.analyte_id)
        });
      }
    }

    console.log(`[seed] Will insert ${translationsToInsert.length} new translations`);

    if (translationsToInsert.length === 0) {
      console.log('[seed] ✅ All translations already exist. Nothing to do.');
      return;
    }

    // Step 5: Insert translations in batches
    const batchSize = 100;
    let inserted = 0;

    for (let i = 0; i < translationsToInsert.length; i += batchSize) {
      const batch = translationsToInsert.slice(i, i + batchSize);

      // Build parameterized insert query
      const values = [];
      const placeholders = [];
      let paramIndex = 1;

      for (const t of batch) {
        placeholders.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2})`);
        values.push(t.analyte_id, t.locale, t.display_name);
        paramIndex += 3;
      }

      await queryAsAdmin(
        `INSERT INTO analyte_translations (analyte_id, locale, display_name)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (analyte_id, locale) DO NOTHING`,
        values
      );

      inserted += batch.length;
      console.log(`[seed] Inserted batch: ${inserted}/${translationsToInsert.length}`);
    }

    // Step 6: Print summary
    const { rows: finalCount } = await queryAsAdmin(
      `SELECT locale, COUNT(*) as count
       FROM analyte_translations
       GROUP BY locale
       ORDER BY locale`
    );

    console.log('\n[seed] ✅ Seed complete!');
    console.log('[seed] Translation counts by locale:');
    for (const row of finalCount) {
      console.log(`  - ${row.locale}: ${row.count} translations`);
    }

    // Show analytes missing Russian translations
    const { rows: missingRu } = await queryAsAdmin(`
      SELECT a.code, a.name
      FROM analytes a
      LEFT JOIN analyte_translations at ON a.analyte_id = at.analyte_id AND at.locale = 'ru'
      WHERE at.analyte_id IS NULL
      ORDER BY a.code
      LIMIT 20
    `);

    if (missingRu.length > 0) {
      console.log(`\n[seed] ⚠️ Analytes missing Russian translations (showing first 20):`);
      for (const a of missingRu) {
        console.log(`  - ${a.code}: ${a.name}`);
      }
      console.log('[seed] Add Russian aliases to analyte_aliases table to populate these.');
    }

  } finally {
    // Release advisory lock
    await pool.query('SELECT pg_advisory_unlock($1)', [lockId]);
    console.log('\n[seed] Advisory lock released');

    // Close pool
    await pool.end();
  }
}

// Run the seed
seedAnalyteTranslations().catch(err => {
  console.error('[seed] Fatal error:', err);
  process.exit(1);
});
