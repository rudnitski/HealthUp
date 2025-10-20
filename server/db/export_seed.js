#!/usr/bin/env node
/**
 * Export current database state to seed_analytes.sql
 * Run this after processing all PDFs and approving pending analytes
 * to create a fresh seed file with all your organic growth data
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

if (process.env.NODE_ENV !== 'production') {
  try {
    require('dotenv').config({ path: path.join(__dirname, '../../.env') });
  } catch (_) {}
}

async function exportSeed() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });
  const client = await pool.connect();

  try {
    console.log('[export] Starting seed export...');

    // Get all analytes with category grouping
    const { rows: analytes } = await client.query(`
      SELECT code, name, unit_canonical, category
      FROM analytes
      ORDER BY
        CASE category
          WHEN 'hematology' THEN 1
          WHEN 'liver' THEN 2
          WHEN 'kidney' THEN 3
          WHEN 'lipid' THEN 4
          WHEN 'glucose' THEN 5
          WHEN 'thyroid' THEN 6
          WHEN 'electrolyte' THEN 7
          WHEN 'vitamin' THEN 8
          WHEN 'iron' THEN 9
          WHEN 'cardiac' THEN 10
          WHEN 'inflammation' THEN 11
          WHEN 'enzyme' THEN 12
          WHEN 'tumor_marker' THEN 13
          ELSE 99
        END,
        code
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

INSERT INTO analytes (code, name, unit_canonical, category) VALUES\n`;

    // Group analytes by category
    const categories = {
      hematology: [],
      liver: [],
      kidney: [],
      lipid: [],
      glucose: [],
      thyroid: [],
      electrolyte: [],
      vitamin: [],
      iron: [],
      cardiac: [],
      inflammation: [],
      enzyme: [],
      tumor_marker: [],
      other: []
    };

    analytes.forEach(a => {
      const cat = a.category || 'other';
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(a);
    });

    const lines = [];
    const categoryLabels = {
      hematology: 'Hematology',
      liver: 'Liver Function',
      kidney: 'Kidney Function',
      lipid: 'Lipids',
      glucose: 'Glucose & Diabetes',
      thyroid: 'Thyroid',
      electrolyte: 'Electrolytes',
      vitamin: 'Vitamins & Minerals',
      iron: 'Iron Studies',
      cardiac: 'Cardiac',
      inflammation: 'Inflammation',
      enzyme: 'Enzymes',
      tumor_marker: 'Tumor Markers',
      other: 'Other'
    };

    for (const [cat, items] of Object.entries(categories)) {
      if (items.length === 0) continue;

      lines.push(`  -- ${categoryLabels[cat]}`);
      items.forEach((a, i) => {
        const comma = (cat === 'other' && i === items.length - 1) &&
                      Object.entries(categories).every(([c, its]) => c <= cat || its.length === 0) ? '' : ',';
        lines.push(`  ('${a.code}', '${a.name.replace(/'/g, "''")}', '${a.unit_canonical || ''}', '${a.category || 'uncategorized'}')${comma}`);
      });
      lines.push('');
    }

    sql += lines.join('\n');
    sql += `ON CONFLICT (code) DO NOTHING;\n\n`;

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
