-- Unit Aliases Seed Data (PRD v4.8)
-- Maps OCR unit string variations to canonical UCUM codes
-- Idempotent: Uses ON CONFLICT DO NOTHING for safe re-application
--
-- IMPORTANT: All aliases MUST be stored in normalized form (output of normalize_unit_string()).
-- The view JOIN uses: normalize_unit_string(lr.unit) = ua.alias
-- Therefore ua.alias must contain the normalized form, not raw OCR variations.
-- This seed file wraps all aliases with normalize_unit_string() to ensure consistency.

-- All 28 canonical units validated against UCUM library ✅
INSERT INTO unit_aliases (alias, unit_canonical)
SELECT normalize_unit_string(alias), unit_canonical FROM (VALUES
  -- Molar concentration (mmol/L)
  ('ммоль/л', 'mmol/L'),
  ('mmol/L', 'mmol/L'),
  ('mmol/l', 'mmol/L'),
  ('мМоль/л', 'mmol/L'),
  ('ммоль/литр', 'mmol/L'),
  ('ммоль / л', 'mmol/L'),
  ('mmol / L', 'mmol/L'),
  ('MMOL/L', 'mmol/L'),

  -- Micromolar (μmol/L)
  ('мкмоль/л', 'umol/L'),
  ('μmol/L', 'umol/L'),
  ('umol/L', 'umol/L'),
  ('umol/l', 'umol/L'),
  ('мкмоль/литр', 'umol/L'),

  -- Nanomolar (nmol/L)
  ('нмоль/л', 'nmol/L'),
  ('nmol/L', 'nmol/L'),
  ('nmol/l', 'nmol/L'),
  ('nmol / L', 'nmol/L'),

  -- Picomolar (pmol/L)
  ('пмоль/л', 'pmol/L'),
  ('pmol/L', 'pmol/L'),
  ('pmol/l', 'pmol/L'),
  ('pmol / L', 'pmol/L'),

  -- Mass concentration - mg/dL
  ('мг/дл', 'mg/dL'),
  ('mg/dL', 'mg/dL'),
  ('mg/dl', 'mg/dL'),
  ('mg / dL', 'mg/dL'),
  ('MG/DL', 'mg/dL'),

  -- Mass concentration - g/L
  ('г/л', 'g/L'),
  ('g/L', 'g/L'),
  ('g/l', 'g/L'),
  ('гр/л', 'g/L'),
  ('g / L', 'g/L'),

  -- Mass concentration - g/dL
  ('г/дл', 'g/dL'),
  ('g/dL', 'g/dL'),
  ('g/dl', 'g/dL'),
  ('g / dL', 'g/dL'),

  -- Mass concentration - mg/L
  ('мг/л', 'mg/L'),
  ('mg/L', 'mg/L'),
  ('mg/l', 'mg/L'),
  ('mg / L', 'mg/L'),

  -- Microgram per liter (μg/L)
  ('мкг/л', 'ug/L'),
  ('μg/L', 'ug/L'),
  ('ug/L', 'ug/L'),
  ('ug/l', 'ug/L'),

  -- Microgram per deciliter (ug/dL)
  ('мкг/дл', 'ug/dL'),
  ('ug/dL', 'ug/dL'),
  ('ug/dl', 'ug/dL'),

  -- Nanogram per milliliter (ng/mL)
  ('нг/мл', 'ng/mL'),
  ('ng/mL', 'ng/mL'),
  ('ng/ml', 'ng/mL'),

  -- Picogram per milliliter (pg/mL)
  ('пг/мл', 'pg/mL'),
  ('pg/mL', 'pg/mL'),
  ('pg/ml', 'pg/mL'),

  -- Enzyme units (U/L)
  ('Ед/л', 'U/L'),
  ('ед/л', 'U/L'),
  ('U/L', 'U/L'),
  ('u/l', 'U/L'),
  ('ЕД/л', 'U/L'),

  -- International units (UCUM uses brackets: [IU])
  ('МЕ/л', '[IU]/L'),
  ('IU/L', '[IU]/L'),
  ('ME/мл', '[IU]/mL'),  -- Latin ME (OCR variant of Cyrillic МЕ)
  ('МЕ/мл', '[IU]/mL'),
  ('мМЕ/л', 'm[IU]/L'),
  ('mIU/L', 'm[IU]/L'),
  ('мкМЕ/мл', 'u[IU]/mL'),
  ('uIU/mL', 'u[IU]/mL'),
  ('μIU/mL', 'u[IU]/mL'),

  -- Cell counts per liter (UCUM uses * not ^)
  ('10^9/л', '10*9/L'),
  ('×10^9/л', '10*9/L'),
  ('10*9/L', '10*9/L'),
  ('10^9/L', '10*9/L'),
  ('x10^9/л', '10*9/L'),
  ('х10^9/л', '10*9/L'),
  ('10^12/л', '10*12/L'),
  ('×10^12/л', '10*12/L'),
  ('10*12/L', '10*12/L'),
  ('10^12/L', '10*12/L'),
  ('x10^12/л', '10*12/L'),
  ('х10^12/л', '10*12/L'),

  -- Cell counts per microliter (preserve original /uL scale)
  ('тыс/мкл', '10*3/uL'),    -- thousands per microliter (WBC, platelets)
  ('млн/мкл', '10*6/uL'),    -- millions per microliter (RBC)

  -- Volume units
  ('фл', 'fL'),
  ('fL', 'fL'),
  ('fl', 'fL'),

  -- Mass units
  ('пг', 'pg'),
  ('pg', 'pg'),

  -- Percentage
  ('%', '%'),
  ('процент', '%'),
  ('проц.', '%'),

  -- Permille (UCUM: [ppth] = parts per thousand)
  ('%o', '[ppth]'),
  ('‰', '[ppth]'),
  ('промилле', '[ppth]'),

  -- Time-based
  ('мм/час', 'mm/h'),
  ('мм/ч', 'mm/h'),
  ('mm/h', 'mm/h'),
  ('mm/hr', 'mm/h'),

  -- Osmolality (UCUM: lowercase mosm)
  ('мОсм/кг', 'mosm/kg'),
  ('mOsm/kg', 'mosm/kg'),

  -- Urinalysis microscopy counts (per microliter)
  ('ед/мкл', '1/uL'),         -- units per microliter (bacteria, cells in urine)

  -- Cell counts per liter with "клеток" (cells) suffix
  ('10^9 клеток/л', '10*9/L'),
  ('10^12 клеток/л', '10*12/L'),
  ('10^9 клетокл', '10*9/L'),  -- OCR error variant (missing slash)
  ('10^12 клетокл', '10*12/L'), -- OCR error variant (missing slash)

  -- Time (seconds)
  ('сек', 's'),
  ('s', 's'),
  ('sec', 's'),

  -- Dimensionless units
  ('Ед', '1'),              -- dimensionless (atherogenic index, ratios)
  ('Индекс', '{index}'),

  -- Microscopy units (per high power field) - PRD v4.8.4
  ('в п/зр.', '/[HPF]'),
  ('в п.зр.', '/[HPF]'),
  ('в п/зр', '/[HPF]'),
  ('в поле зрения', '/[HPF]'),
  ('/HPF', '/[HPF]'),
  ('per HPF', '/[HPF]'),
  ('в п. зр.', '/[HPF]'),
  ('в п.з.', '/[HPF]'),

  -- Additional units from seed_analytes.sql (validated via LLM + UCUM)
  ('IU/mL', '[IU]/mL'),
  ('U/mL', 'U/mL'),
  ('ng/dL', 'ng/dL'),
  ('μg/dL', 'ug/dL'),         -- Greek mu → ASCII u
  ('µmol/L', 'umol/L'),       -- Micro sign (U+00B5) → ASCII u
  ('mL/min/1.73m2', 'mL/min/1.73.m2'),  -- eGFR (dot required before m2)
  ('Ед/мл', 'U/mL'),          -- Russian "units per mL"
  ('КП', '1'),                -- Коэффициент позитивности (positivity coefficient)
  ('R', '1{ratio}'),          -- Ratio (dimensionless)
  ('нг/мл DDU', 'ng/mL{DDU}'), -- D-dimer units

  -- LLM-learned and admin-approved aliases (2026-01-15)
  ('ОЕд/мл', '[arb''U]/mL'),   -- Relative/arbitrary units per mL (celiac antibodies)
  ('BAU/ml', '{BAU}/mL'),      -- Bioequivalent Allergy Units
  ('INR', '1{INR}'),           -- International Normalized Ratio
  ('мЕд/л', 'm[IU]/L'),        -- milli-international units per liter
  ('мкг/мл', 'ug/mL'),         -- microgram per milliliter
  ('мкЕд/мл', 'u[IU]/mL'),     -- micro-international units per mL
  ('мМЕд/мл', 'm[IU]/mL'),     -- milli-international units per mL (variant)
  ('мМЕ/мл', 'm[IU]/mL'),      -- milli-international units per mL
  ('рН', '{pH}')               -- pH (dimensionless, UCUM notation)
) AS raw_aliases(alias, unit_canonical)
ON CONFLICT (alias) DO NOTHING;
