#!/usr/bin/env node
/**
 * Export current database state to seed_analytes.sql
 * Run this after processing all PDFs and approving pending analytes
 * to create a fresh seed file with all your organic growth data
 *
 * Note: This file runs in ESM mode (package.json uses "type": "module").
 */

import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

if (process.env.NODE_ENV !== 'production') {
  try {
    // eslint-disable-next-line import/no-extraneous-dependencies
    const dotenv = await import('dotenv');
    dotenv.config({ path: path.join(__dirname, '../../.env') });
  } catch (_) {}
}

async function exportSeed() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });
  const client = await pool.connect();

  try {
    console.log('[export] Starting seed export...');

    // Get all analytes ordered by code
    const { rows: analytes } = await client.query(`
      SELECT code, name
      FROM analytes
      ORDER BY code
    `);

    // Get all aliases grouped by analyte
    const { rows: aliases } = await client.query(`
      SELECT
        a.code,
        aa.alias,
        aa.alias_display,
        aa.lang,
        aa.confidence,
        aa.source
      FROM analyte_aliases aa
      JOIN analytes a ON aa.analyte_id = a.analyte_id
      ORDER BY a.code, aa.lang, aa.alias
    `);

    // Build SQL file content
    let sql = `-- Seed analytes and aliases (auto-generated from database)
-- Generated: ${new Date().toISOString()}
-- Total analytes: ${analytes.length}

-- ============================================================================
-- ANALYTES (Canonical Tests)
-- ============================================================================

INSERT INTO analytes (code, name) VALUES\n`;

    // Build flat list of analytes
    const lines = analytes.map((a, i) => {
      const comma = i < analytes.length - 1 ? ',' : '';
      return `  ('${a.code}', '${a.name.replace(/'/g, "''")}')${comma}`;
    });

    sql += lines.join('\n');
    sql += `\nON CONFLICT (code) DO NOTHING;\n\n`;

    // Aliases section
    sql += `-- ============================================================================
-- ANALYTE ALIASES (Multilingual: English, Russian, Ukrainian + variants)
-- ============================================================================

INSERT INTO analyte_aliases (analyte_id, alias, lang, confidence, source) VALUES\n`;

    const aliasLines = [];
    const aliasesByCode = {};

    aliases.forEach(a => {
      if (!aliasesByCode[a.code]) aliasesByCode[a.code] = [];
      aliasesByCode[a.code].push(a);
    });

    const codes = Object.keys(aliasesByCode).sort((a, b) => {
      const aIdx = analytes.findIndex(an => an.code === a);
      const bIdx = analytes.findIndex(an => an.code === b);
      return aIdx - bIdx;
    });

    codes.forEach((code, codeIdx) => {
      const analyteName = analytes.find(a => a.code === code)?.name || code;
      aliasLines.push(`  -- ${analyteName} (${code})`);

      aliasesByCode[code].forEach((alias, aliasIdx) => {
        const isLast = codeIdx === codes.length - 1 && aliasIdx === aliasesByCode[code].length - 1;
        const comma = isLast ? '' : ',';
        const conf = alias.confidence || 1.0;
        const src = alias.source || 'seed';
        aliasLines.push(`  ((SELECT analyte_id FROM analytes WHERE code = '${code}'), '${alias.alias.replace(/'/g, "''")}', '${alias.lang || 'en'}', ${conf}, '${src}')${comma}`);
      });

      if (codeIdx < codes.length - 1) aliasLines.push('');
    });

    sql += aliasLines.join('\n');
    sql += `\nON CONFLICT (analyte_id, alias) DO NOTHING;\n\n`;

    // Summary statistics
    const totalAliases = aliases.length;
    const avgAliases = (totalAliases / analytes.length).toFixed(1);

    sql += `-- ============================================================================
-- Summary Statistics
-- ============================================================================

DO $$
DECLARE
  analyte_count INT;
  alias_count INT;
BEGIN
  SELECT COUNT(*) INTO analyte_count FROM analytes;
  SELECT COUNT(*) INTO alias_count FROM analyte_aliases;

  RAISE NOTICE '============================================';
  RAISE NOTICE 'Seed Data Summary';
  RAISE NOTICE '============================================';
  RAISE NOTICE 'Total Analytes: %', analyte_count;
  RAISE NOTICE 'Total Aliases: %', alias_count;
  RAISE NOTICE 'Average Aliases per Analyte: %', ROUND(alias_count::NUMERIC / NULLIF(analyte_count, 0), 1);
  RAISE NOTICE '============================================';
END $$;
`;

    // Write to file
    const outputPath = path.join(__dirname, 'seed_analytes.sql');
    fs.writeFileSync(outputPath, sql, 'utf8');

    console.log('[export] ✅ Seed file exported successfully!');
    console.log(`[export] Location: ${outputPath}`);
    console.log(`[export] Analytes: ${analytes.length}`);
    console.log(`[export] Aliases: ${totalAliases}`);
    console.log(`[export] Avg aliases/analyte: ${avgAliases}`);

  } catch (error) {
    console.error('[export] ❌ Export failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

exportSeed().catch(err => {
  console.error(err);
  process.exit(1);
});
