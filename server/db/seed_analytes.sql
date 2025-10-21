-- Seed analytes and aliases (auto-generated from database)
-- Generated: 2025-10-21T06:27:39.471Z
-- Total analytes: 95

-- ============================================================================
-- ANALYTES (Canonical Tests)
-- ============================================================================

INSERT INTO analytes (code, name, unit_canonical, category) VALUES
  -- Hematology
  ('HCT', 'Hematocrit', '%', 'hematology'),
  ('HGB', 'Hemoglobin', 'g/dL', 'hematology'),
  ('MCH', 'Mean Corpuscular Hemoglobin', 'pg', 'hematology'),
  ('MCHC', 'Mean Corpuscular Hemoglobin Concentration', 'g/dL', 'hematology'),
  ('MCV', 'Mean Corpuscular Volume', 'fL', 'hematology'),
  ('MPV', 'Mean Platelet Volume', 'fL', 'hematology'),
  ('PLT', 'Platelet Count', '10^9/L', 'hematology'),
  ('RBC', 'Red Blood Cell Count', '10^12/L', 'hematology'),
  ('RDW', 'Red Cell Distribution Width', '%', 'hematology'),
  ('WBC', 'White Blood Cell Count', '10^9/L', 'hematology'),

  -- Liver Function
  ('ALB', 'Albumin', 'g/dL', 'liver'),
  ('ALP', 'Alkaline Phosphatase', 'U/L', 'liver'),
  ('ALT', 'Alanine Aminotransferase', 'U/L', 'liver'),
  ('AST', 'Aspartate Aminotransferase', 'U/L', 'liver'),
  ('DBIL', 'Direct Bilirubin', 'mg/dL', 'liver'),
  ('GGT', 'Gamma-Glutamyl Transferase', 'U/L', 'liver'),
  ('TBIL', 'Total Bilirubin', 'mg/dL', 'liver'),
  ('TP', 'Total Protein', 'g/dL', 'liver'),

  -- Kidney Function
  ('BUN', 'Blood Urea Nitrogen', 'mg/dL', 'kidney'),
  ('CREA', 'Creatinine', 'mg/dL', 'kidney'),
  ('EGFR', 'Estimated Glomerular Filtration Rate', 'mL/min/1.73m2', 'kidney'),
  ('UA', 'Uric Acid', 'mg/dL', 'kidney'),

  -- Lipids
  ('CHOL', 'Total Cholesterol', 'mg/dL', 'lipid'),
  ('HDL', 'HDL Cholesterol', 'mg/dL', 'lipid'),
  ('LDL', 'LDL Cholesterol', 'mg/dL', 'lipid'),
  ('TRIG', 'Triglycerides', 'mg/dL', 'lipid'),
  ('VLDL', 'VLDL Cholesterol', 'mg/dL', 'lipid'),

  -- Glucose & Diabetes
  ('FRUC', 'Fructosamine', 'μmol/L', 'glucose'),
  ('GLU', 'Glucose', 'mg/dL', 'glucose'),
  ('HBA1C', 'Hemoglobin A1c', '%', 'glucose'),

  -- Thyroid
  ('FT3', 'Free T3', 'pg/mL', 'thyroid'),
  ('FT4', 'Free T4', 'ng/dL', 'thyroid'),
  ('T3', 'Triiodothyronine', 'ng/dL', 'thyroid'),
  ('T4', 'Thyroxine', 'μg/dL', 'thyroid'),
  ('TSH', 'Thyroid Stimulating Hormone', 'μIU/mL', 'thyroid'),

  -- Electrolytes
  ('CA', 'Calcium', 'mg/dL', 'electrolyte'),
  ('CL', 'Chloride', 'mmol/L', 'electrolyte'),
  ('K', 'Potassium', 'mmol/L', 'electrolyte'),
  ('MG', 'Magnesium', 'mg/dL', 'electrolyte'),
  ('NA', 'Sodium', 'mmol/L', 'electrolyte'),
  ('PHOS', 'Phosphorus', 'mg/dL', 'electrolyte'),

  -- Vitamins & Minerals
  ('FOL', 'Folate', 'ng/mL', 'vitamin'),
  ('VITB12', 'Vitamin B12', 'pg/mL', 'vitamin'),
  ('VITD', 'Vitamin D (25-OH)', 'ng/mL', 'vitamin'),

  -- Iron Studies
  ('FE', 'Iron', 'μg/dL', 'iron'),
  ('FER', 'Ferritin', 'ng/mL', 'iron'),
  ('TIBC', 'Total Iron Binding Capacity', 'μg/dL', 'iron'),
  ('TSAT', 'Transferrin Saturation', '%', 'iron'),

  -- Cardiac
  ('BNP', 'B-type Natriuretic Peptide', 'pg/mL', 'cardiac'),
  ('CK', 'Creatine Kinase', 'U/L', 'cardiac'),
  ('CKMB', 'CK-MB', 'ng/mL', 'cardiac'),
  ('TROP', 'Troponin I', 'ng/mL', 'cardiac'),

  -- Inflammation
  ('CRP', 'C-Reactive Protein', 'mg/L', 'inflammation'),
  ('ESR', 'Erythrocyte Sedimentation Rate', 'mm/hr', 'inflammation'),

  -- Enzymes
  ('AMY', 'Amylase', 'U/L', 'enzyme'),
  ('LDH', 'Lactate Dehydrogenase', 'U/L', 'enzyme'),
  ('LIP', 'Lipase', 'U/L', 'enzyme'),

  -- Tumor Markers
  ('PSA', 'Prostate Specific Antigen', 'ng/mL', 'tumor_marker'),

  -- undefined
  ('AI', 'Atherogenic Index (Atherogenicity Index)', '', 'uncategorized'),
  ('APOA1', 'Apolipoprotein A1', 'г/л', 'uncategorized'),
  ('APOB', 'Apolipoprotein B', 'г/л', 'uncategorized'),
  ('APOB_APOA1', 'Apolipoprotein B / Apolipoprotein A1 Ratio', '', 'uncategorized'),
  ('BASO', 'Basophils (absolute)', '10^9 клеток/л', 'uncategorized'),
  ('BASO_PRCT', 'Basophils (%)', '%', 'uncategorized'),
  ('EO', 'Eosinophils (absolute)', '10^9 клеток/л', 'uncategorized'),
  ('EO_PRCT', 'Eosinophils (%)', '%', 'uncategorized'),
  ('IBIL', 'Indirect Bilirubin (Unconjugated Bilirubin)', 'мкмоль/л', 'uncategorized'),
  ('LUC', 'Large Unstained Cells (absolute)', '10^9 клеток/л', 'uncategorized'),
  ('LUC_PRCT', 'Large Unstained Cells (%)', '%', 'uncategorized'),
  ('LYMPH', 'Lymphocytes (absolute)', '10^9 клеток/л', 'uncategorized'),
  ('LYMPH_PRCT', 'Lymphocytes (%)', '%', 'uncategorized'),
  ('MONO', 'Monocytes (absolute)', '10^9 клеток/л', 'uncategorized'),
  ('MONO_PRCT', 'Monocytes (%)', '%', 'uncategorized'),
  ('NEUT', 'Neutrophils (absolute)', '10^9 клеток/л', 'uncategorized'),
  ('NEUT_BAND_PRCT', 'Band Neutrophils (%)', '%', 'uncategorized'),
  ('NEUT_PRCT', 'Neutrophils (%)', '%', 'uncategorized'),
  ('P_LCR', 'Platelet Large Cell Ratio (P-LCR)', '%', 'uncategorized'),
  ('PCT', 'Plateletcrit (PCT)', '%', 'uncategorized'),
  ('PDW', 'Platelet Distribution Width (PDW)', '%', 'uncategorized'),
  ('URINE_BIL', 'Urine Bilirubin', 'мг/дл', 'uncategorized'),
  ('URINE_COLOR', 'Urine Color', '', 'uncategorized'),
  ('URINE_EPIT', 'Urine Epithelial Cells (sediment)', '', 'uncategorized'),
  ('URINE_GLUC', 'Urine Glucose', 'мг/дл', 'uncategorized'),
  ('URINE_KET', 'Urine Ketones', 'мг/дл', 'uncategorized'),
  ('URINE_MUCUS', 'Urine Mucus (sediment)', '', 'uncategorized'),
  ('URINE_NIT', 'Urine Nitrites', '', 'uncategorized'),
  ('URINE_PH', 'Urine pH', '', 'uncategorized'),
  ('URINE_PROT', 'Urine Protein', 'мг/дл', 'uncategorized'),
  ('URINE_RBC', 'Urine Red Blood Cells', 'ед/мкл', 'uncategorized'),
  ('URINE_SED_RBC', 'Urine Sediment Erythrocytes', '', 'uncategorized'),
  ('URINE_SED_WBC', 'Urine Sediment Leukocytes', '', 'uncategorized'),
  ('URINE_SG', 'Urine Specific Gravity', '', 'uncategorized'),
  ('URINE_TURBIDITY', 'Urine Transparency/Turbidity', '', 'uncategorized'),
  ('URINE_UBG', 'Urine Urobilinogen', 'мг/дл', 'uncategorized'),
  ('URINE_WBC', 'Urine Leukocytes (WBC)', 'ед/мкл', 'uncategorized'),
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- ANALYTE ALIASES (Multilingual: English, Russian, Ukrainian + variants)
-- ============================================================================

INSERT INTO analyte_aliases (analyte_id, alias, lang, confidence, source) VALUES
  -- Hematocrit (HCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'HCT'), 'hct', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HCT'), 'hematocrit', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HCT'), 'гематокрит', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HCT'), 'гематокрит (hct)', 'ru', 1, 'manual_disambiguation'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HCT'), 'гематокріт', 'uk', 1, 'seed'),

  -- Hemoglobin (HGB)
  ((SELECT analyte_id FROM analytes WHERE code = 'HGB'), 'hb', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HGB'), 'hemoglobin', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HGB'), 'hgb', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HGB'), 'гемоглоб', 'ru', 0.9, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HGB'), 'гемоглобин', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HGB'), 'гемоглобин (hgb)', 'ru', 1, 'manual_disambiguation'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HGB'), 'гемоглобін', 'uk', 1, 'seed'),

  -- Mean Corpuscular Hemoglobin (MCH)
  ((SELECT analyte_id FROM analytes WHERE code = 'MCH'), 'mch', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MCH'), 'mean corpuscular hemoglobin', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MCH'), 'среднее содержание гемоглобина', 'ru', 1, 'seed'),

  -- Mean Corpuscular Hemoglobin Concentration (MCHC)
  ((SELECT analyte_id FROM analytes WHERE code = 'MCHC'), 'mchc', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MCHC'), 'mean corpuscular hemoglobin concentration', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MCHC'), 'средняя концентрация гемоглобина', 'ru', 1, 'seed'),

  -- Mean Corpuscular Volume (MCV)
  ((SELECT analyte_id FROM analytes WHERE code = 'MCV'), 'mcv', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MCV'), 'mean corpuscular volume', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MCV'), 'средний объем эритроцита', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MCV'), 'средний объем эритроцита (mcv)', 'ru', 1, 'manual_disambiguation'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MCV'), 'середній обєм еритроцита', 'uk', 1, 'seed'),

  -- Mean Platelet Volume (MPV)
  ((SELECT analyte_id FROM analytes WHERE code = 'MPV'), 'mean platelet volume', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MPV'), 'mpv', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MPV'), 'средний объем тромбоцитов', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MPV'), 'средний объем тромбоцитов (mpv)', 'ru', 1, 'manual_disambiguation'),

  -- Platelet Count (PLT)
  ((SELECT analyte_id FROM analytes WHERE code = 'PLT'), 'platelets', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'PLT'), 'plt', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'PLT'), 'тромбоциты', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'PLT'), 'тромбоциты (plt)', 'ru', 1, 'manual_disambiguation'),
  ((SELECT analyte_id FROM analytes WHERE code = 'PLT'), 'тромбоцити', 'uk', 1, 'seed'),

  -- Red Blood Cell Count (RBC)
  ((SELECT analyte_id FROM analytes WHERE code = 'RBC'), 'erythrocytes', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'RBC'), 'rbc', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'RBC'), 'red blood cells', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'RBC'), 'эритроциты', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'RBC'), 'эритроциты (rbc)', 'ru', 1, 'manual_disambiguation'),
  ((SELECT analyte_id FROM analytes WHERE code = 'RBC'), 'еритроцити', 'uk', 1, 'seed'),

  -- Red Cell Distribution Width (RDW)
  ((SELECT analyte_id FROM analytes WHERE code = 'RDW'), 'rdw', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'RDW'), 'red cell distribution width', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'RDW'), 'ширина распределения эритроцитов', 'ru', 1, 'seed'),

  -- White Blood Cell Count (WBC)
  ((SELECT analyte_id FROM analytes WHERE code = 'WBC'), 'leukocytes', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'WBC'), 'wbc', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'WBC'), 'white blood cells', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'WBC'), 'лейкоциты', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'WBC'), 'лейкоциты wbc', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'WBC'), 'лейкоцити', 'uk', 1, 'seed'),

  -- Albumin (ALB)
  ((SELECT analyte_id FROM analytes WHERE code = 'ALB'), 'alb', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ALB'), 'albumin', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ALB'), 'альбумин', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ALB'), 'альбумін', 'uk', 1, 'seed'),

  -- Alkaline Phosphatase (ALP)
  ((SELECT analyte_id FROM analytes WHERE code = 'ALP'), 'alkaline phosphatase', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ALP'), 'alkp', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ALP'), 'alp', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ALP'), 'щелочная фосфатаза', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ALP'), 'лужна фосфатаза', 'uk', 1, 'seed'),

  -- Alanine Aminotransferase (ALT)
  ((SELECT analyte_id FROM analytes WHERE code = 'ALT'), 'alanine aminotransferase', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ALT'), 'alt', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ALT'), 'alt sgpt', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ALT'), 'sgpt', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ALT'), 'аланинаминотрансфераза', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ALT'), 'алт', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ALT'), 'аланін амінотрансфераза', 'uk', 1, 'seed'),

  -- Aspartate Aminotransferase (AST)
  ((SELECT analyte_id FROM analytes WHERE code = 'AST'), 'aspartate aminotransferase', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'AST'), 'ast', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'AST'), 'ast sgot', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'AST'), 'sgot', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'AST'), 'аспартатаминотрансфераза', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'AST'), 'аст', 'ru', 1, 'seed'),

  -- Direct Bilirubin (DBIL)
  ((SELECT analyte_id FROM analytes WHERE code = 'DBIL'), 'bilirubin direct', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'DBIL'), 'dbil', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'DBIL'), 'direct bilirubin', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'DBIL'), 'билирубин прямой', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'DBIL'), 'прямой билирубин', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'DBIL'), 'прямий білірубін', 'uk', 1, 'seed'),

  -- Gamma-Glutamyl Transferase (GGT)
  ((SELECT analyte_id FROM analytes WHERE code = 'GGT'), 'gamma glutamyl transferase', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'GGT'), 'ggt', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'GGT'), 'ggtp', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'GGT'), 'ггт', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'GGT'), 'гамма глутамилтрансфераза', 'ru', 1, 'seed'),

  -- Total Bilirubin (TBIL)
  ((SELECT analyte_id FROM analytes WHERE code = 'TBIL'), 'bilirubin total', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TBIL'), 'tbil', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TBIL'), 'total bilirubin', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TBIL'), 'билирубин общий', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TBIL'), 'общий билирубин', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TBIL'), 'загальний білірубін', 'uk', 1, 'seed'),

  -- Total Protein (TP)
  ((SELECT analyte_id FROM analytes WHERE code = 'TP'), 'protein total', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TP'), 'total protein', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TP'), 'tp', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TP'), 'белок общий', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TP'), 'общий белок', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TP'), 'загальний білок', 'uk', 1, 'seed'),

  -- Blood Urea Nitrogen (BUN)
  ((SELECT analyte_id FROM analytes WHERE code = 'BUN'), 'blood urea nitrogen', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'BUN'), 'bun', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'BUN'), 'urea', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'BUN'), 'мочевина', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'BUN'), 'сечовина', 'uk', 1, 'seed'),

  -- Creatinine (CREA)
  ((SELECT analyte_id FROM analytes WHERE code = 'CREA'), 'cr', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CREA'), 'crea', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CREA'), 'creatinine', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CREA'), 'креатинин', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CREA'), 'креатінін', 'uk', 1, 'seed'),

  -- Estimated Glomerular Filtration Rate (EGFR)
  ((SELECT analyte_id FROM analytes WHERE code = 'EGFR'), 'egfr', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'EGFR'), 'gfr', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'EGFR'), 'glomerular filtration rate', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'EGFR'), 'скф', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'EGFR'), 'рсфк', 'uk', 1, 'seed'),

  -- Uric Acid (UA)
  ((SELECT analyte_id FROM analytes WHERE code = 'UA'), 'ua', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'UA'), 'urate', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'UA'), 'uric acid', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'UA'), 'мочевая кислота', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'UA'), 'сечова кислота', 'uk', 1, 'seed'),

  -- Total Cholesterol (CHOL)
  ((SELECT analyte_id FROM analytes WHERE code = 'CHOL'), 'chol', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CHOL'), 'cholesterol', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CHOL'), 'total cholesterol', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CHOL'), 'холестерин', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CHOL'), 'общий холестерин', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CHOL'), 'загальний холестерин', 'uk', 1, 'seed'),

  -- HDL Cholesterol (HDL)
  ((SELECT analyte_id FROM analytes WHERE code = 'HDL'), 'hdl', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HDL'), 'hdl c', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HDL'), 'hdl cholesterol', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HDL'), 'лпвп', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HDL'), 'холестерин лпвп', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HDL'), 'хс лпвп', 'ru', 1, 'seed'),

  -- LDL Cholesterol (LDL)
  ((SELECT analyte_id FROM analytes WHERE code = 'LDL'), 'ldl', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'LDL'), 'ldl c', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'LDL'), 'ldl cholesterol', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'LDL'), 'лпнп', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'LDL'), 'холестерин лпнп', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'LDL'), 'хс лпнп', 'ru', 1, 'seed'),

  -- Triglycerides (TRIG)
  ((SELECT analyte_id FROM analytes WHERE code = 'TRIG'), 'tg', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TRIG'), 'trig', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TRIG'), 'triglycerides', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TRIG'), 'триглицериды', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TRIG'), 'тригліцериди', 'uk', 1, 'seed'),

  -- VLDL Cholesterol (VLDL)
  ((SELECT analyte_id FROM analytes WHERE code = 'VLDL'), 'vldl', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VLDL'), 'vldl cholesterol', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VLDL'), 'лпонп', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VLDL'), 'холестерин лпонп', 'ru', 1, 'seed'),

  -- Fructosamine (FRUC)
  ((SELECT analyte_id FROM analytes WHERE code = 'FRUC'), 'fructosamine', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FRUC'), 'фруктозамин', 'ru', 1, 'seed'),

  -- Glucose (GLU)
  ((SELECT analyte_id FROM analytes WHERE code = 'GLU'), 'blood glucose', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'GLU'), 'glu', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'GLU'), 'glucose', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'GLU'), 'глюкоза', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'GLU'), 'глюкоза крови', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'GLU'), 'глюкоза (кровь)', 'ru', 1, 'manual_disambiguation'),
  ((SELECT analyte_id FROM analytes WHERE code = 'GLU'), 'глюкоза крові', 'uk', 1, 'seed'),

  -- Hemoglobin A1c (HBA1C)
  ((SELECT analyte_id FROM analytes WHERE code = 'HBA1C'), 'a1c', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HBA1C'), 'glycated hemoglobin', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HBA1C'), 'hba1c', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HBA1C'), 'hemoglobin a1c', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HBA1C'), 'гликогемоглобин', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HBA1C'), 'гликированный гемоглобин', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HBA1C'), 'глікований гемоглобін', 'uk', 1, 'seed'),

  -- Free T3 (FT3)
  ((SELECT analyte_id FROM analytes WHERE code = 'FT3'), 'free t3', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FT3'), 'free triiodothyronine', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FT3'), 'ft3', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FT3'), 'свободный т3', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FT3'), 'вільний т3', 'uk', 1, 'seed'),

  -- Free T4 (FT4)
  ((SELECT analyte_id FROM analytes WHERE code = 'FT4'), 'free t4', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FT4'), 'free thyroxine', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FT4'), 'ft4', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FT4'), 'свободный т4', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FT4'), 'вільний т4', 'uk', 1, 'seed'),

  -- Triiodothyronine (T3)
  ((SELECT analyte_id FROM analytes WHERE code = 'T3'), 't3', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'T3'), 'triiodothyronine', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'T3'), 'трийодтиронин', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'T3'), 'т3', 'ru', 1, 'seed'),

  -- Thyroxine (T4)
  ((SELECT analyte_id FROM analytes WHERE code = 'T4'), 't4', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'T4'), 'thyroxine', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'T4'), 'тироксин', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'T4'), 'т4', 'ru', 1, 'seed'),

  -- Thyroid Stimulating Hormone (TSH)
  ((SELECT analyte_id FROM analytes WHERE code = 'TSH'), 'thyroid stimulating hormone', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TSH'), 'thyrotropin', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TSH'), 'tsh', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TSH'), 'ттг', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TSH'), 'тиреотропный гормон', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TSH'), 'тиреотропный гормон тиреотропин ттг', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TSH'), 'тиреотропний гормон', 'uk', 1, 'seed'),

  -- Calcium (CA)
  ((SELECT analyte_id FROM analytes WHERE code = 'CA'), 'ca', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CA'), 'calcium', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CA'), 'кальций', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CA'), 'кальцій', 'uk', 1, 'seed'),

  -- Chloride (CL)
  ((SELECT analyte_id FROM analytes WHERE code = 'CL'), 'chloride', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CL'), 'cl', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CL'), 'хлор', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CL'), 'хлориды', 'ru', 1, 'seed'),

  -- Potassium (K)
  ((SELECT analyte_id FROM analytes WHERE code = 'K'), 'k', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'K'), 'potassium', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'K'), 'калий', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'K'), 'калій', 'uk', 1, 'seed'),

  -- Magnesium (MG)
  ((SELECT analyte_id FROM analytes WHERE code = 'MG'), 'magnesium', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MG'), 'mg', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MG'), 'магний', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MG'), 'магній', 'uk', 1, 'seed'),

  -- Sodium (NA)
  ((SELECT analyte_id FROM analytes WHERE code = 'NA'), 'na', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'NA'), 'sodium', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'NA'), 'натрий', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'NA'), 'натрій', 'uk', 1, 'seed'),

  -- Phosphorus (PHOS)
  ((SELECT analyte_id FROM analytes WHERE code = 'PHOS'), 'phos', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'PHOS'), 'phosphate', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'PHOS'), 'phosphorus', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'PHOS'), 'фосфаты', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'PHOS'), 'фосфор', 'ru', 1, 'seed'),

  -- Folate (FOL)
  ((SELECT analyte_id FROM analytes WHERE code = 'FOL'), 'folate', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FOL'), 'folic acid', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FOL'), 'фолаты', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FOL'), 'фолиевая кислота', 'ru', 1, 'seed'),

  -- Vitamin B12 (VITB12)
  ((SELECT analyte_id FROM analytes WHERE code = 'VITB12'), 'b12', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VITB12'), 'cobalamin', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VITB12'), 'vitamin b12', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VITB12'), 'кобаламин', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VITB12'), 'витамин b12', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VITB12'), 'вітамін b12', 'uk', 1, 'seed'),

  -- Vitamin D (25-OH) (VITD)
  ((SELECT analyte_id FROM analytes WHERE code = 'VITD'), '25 hydroxy vitamin d', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VITD'), '25 oh d', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VITD'), 'vitamin d', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VITD'), 'vitd', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VITD'), 'витамин d', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VITD'), '25 oh витамин d', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VITD'), 'вітамін d', 'uk', 1, 'seed'),

  -- Iron (FE)
  ((SELECT analyte_id FROM analytes WHERE code = 'FE'), 'fe', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FE'), 'iron', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FE'), 'serum iron', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FE'), 'железо', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FE'), 'железо сыворотки', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FE'), 'залізо', 'uk', 1, 'seed'),

  -- Ferritin (FER)
  ((SELECT analyte_id FROM analytes WHERE code = 'FER'), 'fer', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FER'), 'ferritin', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FER'), 'феретинн', 'ru', 0.8, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FER'), 'феритин', 'ru', 0.85, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FER'), 'ферритин', 'ru', 1, 'seed'),

  -- Total Iron Binding Capacity (TIBC)
  ((SELECT analyte_id FROM analytes WHERE code = 'TIBC'), 'tibc', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TIBC'), 'total iron binding capacity', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TIBC'), 'ожсс', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TIBC'), 'общая железосвязывающая способность', 'ru', 1, 'seed'),

  -- Transferrin Saturation (TSAT)
  ((SELECT analyte_id FROM analytes WHERE code = 'TSAT'), 'transferrin saturation', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TSAT'), 'tsat', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TSAT'), 'насыщение трансферрина', 'ru', 1, 'seed'),

  -- B-type Natriuretic Peptide (BNP)
  ((SELECT analyte_id FROM analytes WHERE code = 'BNP'), 'b type natriuretic peptide', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'BNP'), 'bnp', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'BNP'), 'натрийуретический пептид', 'ru', 1, 'seed'),

  -- Creatine Kinase (CK)
  ((SELECT analyte_id FROM analytes WHERE code = 'CK'), 'ck', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CK'), 'cpk', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CK'), 'creatine kinase', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CK'), 'креатинкиназа', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CK'), 'кфк', 'ru', 1, 'seed'),

  -- CK-MB (CKMB)
  ((SELECT analyte_id FROM analytes WHERE code = 'CKMB'), 'ck mb', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CKMB'), 'ckmb', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CKMB'), 'creatine kinase mb', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CKMB'), 'кфк мв', 'ru', 1, 'seed'),

  -- Troponin I (TROP)
  ((SELECT analyte_id FROM analytes WHERE code = 'TROP'), 'trop i', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TROP'), 'troponin', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TROP'), 'troponin i', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TROP'), 'тропонин', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TROP'), 'тропонін', 'uk', 1, 'seed'),

  -- C-Reactive Protein (CRP)
  ((SELECT analyte_id FROM analytes WHERE code = 'CRP'), 'c reactive protein', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CRP'), 'crp', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CRP'), 'срб', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CRP'), 'с реактивный белок', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CRP'), 'с реактивний білок', 'uk', 1, 'seed'),

  -- Erythrocyte Sedimentation Rate (ESR)
  ((SELECT analyte_id FROM analytes WHERE code = 'ESR'), 'erythrocyte sedimentation rate', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ESR'), 'esr', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ESR'), 'sed rate', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ESR'), 'соэ', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ESR'), 'скорость оседания эритроцитов', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ESR'), 'швидкість осідання еритроцитів', 'uk', 1, 'seed'),

  -- Amylase (AMY)
  ((SELECT analyte_id FROM analytes WHERE code = 'AMY'), 'amy', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'AMY'), 'amylase', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'AMY'), 'амилаза', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'AMY'), 'аміла за', 'uk', 1, 'seed'),

  -- Lactate Dehydrogenase (LDH)
  ((SELECT analyte_id FROM analytes WHERE code = 'LDH'), 'lactate dehydrogenase', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'LDH'), 'ldh', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'LDH'), 'лактатдегидрогеназа', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'LDH'), 'лдг', 'ru', 1, 'seed'),

  -- Lipase (LIP)
  ((SELECT analyte_id FROM analytes WHERE code = 'LIP'), 'lip', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'LIP'), 'lipase', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'LIP'), 'липаза', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'LIP'), 'ліпаза', 'uk', 1, 'seed'),

  -- Prostate Specific Antigen (PSA)
  ((SELECT analyte_id FROM analytes WHERE code = 'PSA'), 'prostate specific antigen', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'PSA'), 'psa', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'PSA'), 'пса', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'PSA'), 'простатспецифический антиген', 'ru', 1, 'seed'),

  -- Atherogenic Index (Atherogenicity Index) (AI)
  ((SELECT analyte_id FROM analytes WHERE code = 'AI'), 'индекс атерогенности', 'ru', 1, 'evidence_auto'),

  -- Apolipoprotein A1 (APOA1)
  ((SELECT analyte_id FROM analytes WHERE code = 'APOA1'), 'аполипопротеин a1', 'ru', 1, 'evidence_auto'),

  -- Apolipoprotein B (APOB)
  ((SELECT analyte_id FROM analytes WHERE code = 'APOB'), 'аполипопротеин b', 'ru', 1, 'evidence_auto'),

  -- Apolipoprotein B / Apolipoprotein A1 Ratio (APOB_APOA1)
  ((SELECT analyte_id FROM analytes WHERE code = 'APOB_APOA1'), 'апо в апо а1', 'ru', 1, 'evidence_auto'),

  -- Basophils (absolute) (BASO)
  ((SELECT analyte_id FROM analytes WHERE code = 'BASO'), 'базофилы baso', 'ru', 1, 'evidence_auto'),

  -- Basophils (%) (BASO_PRCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'BASO_PRCT'), 'базофилы baso', 'ru', 1, 'evidence_auto'),

  -- Eosinophils (absolute) (EO)
  ((SELECT analyte_id FROM analytes WHERE code = 'EO'), 'эозинофилы eo', 'ru', 1, 'evidence_auto'),

  -- Eosinophils (%) (EO_PRCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'EO_PRCT'), 'эозинофилы eo', 'ru', 1, 'evidence_auto'),

  -- Indirect Bilirubin (Unconjugated Bilirubin) (IBIL)
  ((SELECT analyte_id FROM analytes WHERE code = 'IBIL'), 'билирубин непрямой', 'ru', 1, 'evidence_auto'),

  -- Large Unstained Cells (absolute) (LUC)
  ((SELECT analyte_id FROM analytes WHERE code = 'LUC'), 'luc большие неокрашенные клетки', 'ru', 1, 'evidence_auto'),

  -- Large Unstained Cells (%) (LUC_PRCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'LUC_PRCT'), 'luc большие неокрашенные клетки', 'ru', 1, 'evidence_auto'),

  -- Lymphocytes (absolute) (LYMPH)
  ((SELECT analyte_id FROM analytes WHERE code = 'LYMPH'), 'лимфоциты lymph', 'ru', 1, 'evidence_auto'),

  -- Lymphocytes (%) (LYMPH_PRCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'LYMPH_PRCT'), 'лимфоциты lymph', 'ru', 1, 'evidence_auto'),

  -- Monocytes (absolute) (MONO)
  ((SELECT analyte_id FROM analytes WHERE code = 'MONO'), 'моноциты mono', 'ru', 1, 'evidence_auto'),

  -- Monocytes (%) (MONO_PRCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'MONO_PRCT'), 'моноциты mono', 'ru', 1, 'evidence_auto'),

  -- Neutrophils (absolute) (NEUT)
  ((SELECT analyte_id FROM analytes WHERE code = 'NEUT'), 'нейтрофильные гранулоциты neut', 'ru', 1, 'evidence_auto'),

  -- Band Neutrophils (%) (NEUT_BAND_PRCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'NEUT_BAND_PRCT'), 'палочкоядерные нейтрофилы neut r', 'ru', 1, 'evidence_auto'),

  -- Neutrophils (%) (NEUT_PRCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'NEUT_PRCT'), 'нейтрофильные гранулоциты neut', 'ru', 1, 'evidence_auto'),

  -- Platelet Large Cell Ratio (P-LCR) (P_LCR)
  ((SELECT analyte_id FROM analytes WHERE code = 'P_LCR'), 'коэффициент больших тромбоцитов p lcr', 'ru', 1, 'evidence_auto'),

  -- Plateletcrit (PCT) (PCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'PCT'), 'тромбокрит pct', 'ru', 1, 'evidence_auto'),

  -- Platelet Distribution Width (PDW) (PDW)
  ((SELECT analyte_id FROM analytes WHERE code = 'PDW'), 'ширина распределения тромбоцитов по объемам pdw', 'ru', 1, 'evidence_auto'),

  -- Urine Bilirubin (URINE_BIL)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_BIL'), 'билирубин в моче', 'ru', 1, 'evidence_auto'),

  -- Urine Color (URINE_COLOR)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_COLOR'), 'цвет мочи', 'ru', 1, 'evidence_auto'),

  -- Urine Epithelial Cells (sediment) (URINE_EPIT)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_EPIT'), 'эпителиальные клетки осадок', 'ru', 1, 'evidence_auto'),

  -- Urine Glucose (URINE_GLUC)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_GLUC'), 'глюкоза мочи', 'ru', 1, 'evidence_auto'),

  -- Urine Ketones (URINE_KET)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_KET'), 'кетоновые тела', 'ru', 1, 'evidence_auto'),

  -- Urine Mucus (sediment) (URINE_MUCUS)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_MUCUS'), 'слизь осадок', 'ru', 1, 'evidence_auto'),

  -- Urine Nitrites (URINE_NIT)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_NIT'), 'нитриты', 'ru', 1, 'evidence_auto'),

  -- Urine pH (URINE_PH)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_PH'), 'реакция мочи', 'ru', 1, 'evidence_auto'),

  -- Urine Protein (URINE_PROT)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_PROT'), 'белок мочи', 'ru', 1, 'evidence_auto'),

  -- Urine Red Blood Cells (URINE_RBC)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_RBC'), 'эритроциты в моче', 'ru', 1, 'evidence_auto'),

  -- Urine Sediment Erythrocytes (URINE_SED_RBC)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_SED_RBC'), 'эритроциты осадок', 'ru', 1, 'evidence_auto'),

  -- Urine Sediment Leukocytes (URINE_SED_WBC)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_SED_WBC'), 'лейкоциты осадок', 'ru', 1, 'evidence_auto'),

  -- Urine Specific Gravity (URINE_SG)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_SG'), 'удельный вес', 'ru', 1, 'evidence_auto'),

  -- Urine Transparency/Turbidity (URINE_TURBIDITY)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_TURBIDITY'), 'прозрачность', 'ru', 1, 'evidence_auto'),

  -- Urine Urobilinogen (URINE_UBG)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_UBG'), 'уробилиноген в моче', 'ru', 1, 'evidence_auto'),

  -- Urine Leukocytes (WBC) (URINE_WBC)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_WBC'), 'лейкоциты в моче', 'ru', 1, 'evidence_auto')
ON CONFLICT (analyte_id, alias) DO NOTHING;

-- ============================================================================
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
