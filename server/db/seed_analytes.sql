-- Seed analytes and aliases for mapping dry-run mode
-- PRD v0.9: 50+ canonical analytes, 200-500 multilingual aliases

-- ============================================================================
-- ANALYTES (Canonical Tests)
-- ============================================================================

INSERT INTO analytes (code, name, unit_canonical, category) VALUES
  -- Hematology
  ('HGB', 'Hemoglobin', 'g/dL', 'hematology'),
  ('HCT', 'Hematocrit', '%', 'hematology'),
  ('RBC', 'Red Blood Cell Count', '10^12/L', 'hematology'),
  ('WBC', 'White Blood Cell Count', '10^9/L', 'hematology'),
  ('PLT', 'Platelet Count', '10^9/L', 'hematology'),
  ('MCV', 'Mean Corpuscular Volume', 'fL', 'hematology'),
  ('MCH', 'Mean Corpuscular Hemoglobin', 'pg', 'hematology'),
  ('MCHC', 'Mean Corpuscular Hemoglobin Concentration', 'g/dL', 'hematology'),
  ('RDW', 'Red Cell Distribution Width', '%', 'hematology'),
  ('MPV', 'Mean Platelet Volume', 'fL', 'hematology'),

  -- Liver Function
  ('ALT', 'Alanine Aminotransferase', 'U/L', 'liver'),
  ('AST', 'Aspartate Aminotransferase', 'U/L', 'liver'),
  ('ALP', 'Alkaline Phosphatase', 'U/L', 'liver'),
  ('GGT', 'Gamma-Glutamyl Transferase', 'U/L', 'liver'),
  ('TBIL', 'Total Bilirubin', 'mg/dL', 'liver'),
  ('DBIL', 'Direct Bilirubin', 'mg/dL', 'liver'),
  ('ALB', 'Albumin', 'g/dL', 'liver'),
  ('TP', 'Total Protein', 'g/dL', 'liver'),

  -- Kidney Function
  ('CREA', 'Creatinine', 'mg/dL', 'kidney'),
  ('BUN', 'Blood Urea Nitrogen', 'mg/dL', 'kidney'),
  ('EGFR', 'Estimated Glomerular Filtration Rate', 'mL/min/1.73m2', 'kidney'),
  ('UA', 'Uric Acid', 'mg/dL', 'kidney'),

  -- Lipids
  ('CHOL', 'Total Cholesterol', 'mg/dL', 'lipid'),
  ('HDL', 'HDL Cholesterol', 'mg/dL', 'lipid'),
  ('LDL', 'LDL Cholesterol', 'mg/dL', 'lipid'),
  ('TRIG', 'Triglycerides', 'mg/dL', 'lipid'),
  ('VLDL', 'VLDL Cholesterol', 'mg/dL', 'lipid'),

  -- Glucose & Diabetes
  ('GLU', 'Glucose', 'mg/dL', 'glucose'),
  ('HBA1C', 'Hemoglobin A1c', '%', 'glucose'),
  ('FRUC', 'Fructosamine', 'μmol/L', 'glucose'),

  -- Thyroid
  ('TSH', 'Thyroid Stimulating Hormone', 'μIU/mL', 'thyroid'),
  ('T3', 'Triiodothyronine', 'ng/dL', 'thyroid'),
  ('T4', 'Thyroxine', 'μg/dL', 'thyroid'),
  ('FT3', 'Free T3', 'pg/mL', 'thyroid'),
  ('FT4', 'Free T4', 'ng/dL', 'thyroid'),

  -- Electrolytes
  ('NA', 'Sodium', 'mmol/L', 'electrolyte'),
  ('K', 'Potassium', 'mmol/L', 'electrolyte'),
  ('CL', 'Chloride', 'mmol/L', 'electrolyte'),
  ('CA', 'Calcium', 'mg/dL', 'electrolyte'),
  ('MG', 'Magnesium', 'mg/dL', 'electrolyte'),
  ('PHOS', 'Phosphorus', 'mg/dL', 'electrolyte'),

  -- Vitamins & Minerals
  ('VITD', 'Vitamin D (25-OH)', 'ng/mL', 'vitamin'),
  ('VITB12', 'Vitamin B12', 'pg/mL', 'vitamin'),
  ('FOL', 'Folate', 'ng/mL', 'vitamin'),
  ('FER', 'Ferritin', 'ng/mL', 'iron'),
  ('FE', 'Iron', 'μg/dL', 'iron'),
  ('TIBC', 'Total Iron Binding Capacity', 'μg/dL', 'iron'),
  ('TSAT', 'Transferrin Saturation', '%', 'iron'),

  -- Cardiac
  ('CK', 'Creatine Kinase', 'U/L', 'cardiac'),
  ('CKMB', 'CK-MB', 'ng/mL', 'cardiac'),
  ('TROP', 'Troponin I', 'ng/mL', 'cardiac'),
  ('BNP', 'B-type Natriuretic Peptide', 'pg/mL', 'cardiac'),

  -- Inflammation
  ('CRP', 'C-Reactive Protein', 'mg/L', 'inflammation'),
  ('ESR', 'Erythrocyte Sedimentation Rate', 'mm/hr', 'inflammation'),

  -- Other Common Tests
  ('LDH', 'Lactate Dehydrogenase', 'U/L', 'enzyme'),
  ('AMY', 'Amylase', 'U/L', 'enzyme'),
  ('LIP', 'Lipase', 'U/L', 'enzyme'),
  ('PSA', 'Prostate Specific Antigen', 'ng/mL', 'tumor_marker')
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- ANALYTE ALIASES (Multilingual: English, Russian, Ukrainian + variants)
-- ============================================================================

INSERT INTO analyte_aliases (analyte_id, alias, lang, confidence, source) VALUES
  -- Hemoglobin (HGB)
  ((SELECT analyte_id FROM analytes WHERE code = 'HGB'), 'hemoglobin', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HGB'), 'hgb', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HGB'), 'hb', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HGB'), 'гемоглобин', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HGB'), 'гемоглобін', 'uk', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HGB'), 'гемоглоб', 'ru', 0.9, 'seed'),

  -- Hematocrit (HCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'HCT'), 'hematocrit', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HCT'), 'hct', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HCT'), 'гематокрит', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HCT'), 'гематокріт', 'uk', 1.0, 'seed'),

  -- RBC
  ((SELECT analyte_id FROM analytes WHERE code = 'RBC'), 'red blood cells', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'RBC'), 'rbc', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'RBC'), 'erythrocytes', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'RBC'), 'эритроциты', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'RBC'), 'еритроцити', 'uk', 1.0, 'seed'),

  -- WBC
  ((SELECT analyte_id FROM analytes WHERE code = 'WBC'), 'white blood cells', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'WBC'), 'wbc', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'WBC'), 'leukocytes', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'WBC'), 'лейкоциты', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'WBC'), 'лейкоцити', 'uk', 1.0, 'seed'),

  -- Platelets (PLT)
  ((SELECT analyte_id FROM analytes WHERE code = 'PLT'), 'platelets', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'PLT'), 'plt', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'PLT'), 'тромбоциты', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'PLT'), 'тромбоцити', 'uk', 1.0, 'seed'),

  -- MCV
  ((SELECT analyte_id FROM analytes WHERE code = 'MCV'), 'mean corpuscular volume', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MCV'), 'mcv', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MCV'), 'средний объем эритроцита', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MCV'), 'середній обєм еритроцита', 'uk', 1.0, 'seed'),

  -- MCH
  ((SELECT analyte_id FROM analytes WHERE code = 'MCH'), 'mean corpuscular hemoglobin', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MCH'), 'mch', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MCH'), 'среднее содержание гемоглобина', 'ru', 1.0, 'seed'),

  -- MCHC
  ((SELECT analyte_id FROM analytes WHERE code = 'MCHC'), 'mean corpuscular hemoglobin concentration', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MCHC'), 'mchc', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MCHC'), 'средняя концентрация гемоглобина', 'ru', 1.0, 'seed'),

  -- RDW
  ((SELECT analyte_id FROM analytes WHERE code = 'RDW'), 'red cell distribution width', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'RDW'), 'rdw', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'RDW'), 'ширина распределения эритроцитов', 'ru', 1.0, 'seed'),

  -- MPV
  ((SELECT analyte_id FROM analytes WHERE code = 'MPV'), 'mean platelet volume', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MPV'), 'mpv', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MPV'), 'средний объем тромбоцитов', 'ru', 1.0, 'seed'),

  -- ALT
  ((SELECT analyte_id FROM analytes WHERE code = 'ALT'), 'alanine aminotransferase', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ALT'), 'alt', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ALT'), 'sgpt', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ALT'), 'alt sgpt', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ALT'), 'алт', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ALT'), 'аланинаминотрансфераза', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ALT'), 'аланін амінотрансфераза', 'uk', 1.0, 'seed'),

  -- AST
  ((SELECT analyte_id FROM analytes WHERE code = 'AST'), 'aspartate aminotransferase', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'AST'), 'ast', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'AST'), 'sgot', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'AST'), 'ast sgot', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'AST'), 'аст', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'AST'), 'аспартатаминотрансфераза', 'ru', 1.0, 'seed'),

  -- ALP
  ((SELECT analyte_id FROM analytes WHERE code = 'ALP'), 'alkaline phosphatase', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ALP'), 'alp', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ALP'), 'alkp', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ALP'), 'щелочная фосфатаза', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ALP'), 'лужна фосфатаза', 'uk', 1.0, 'seed'),

  -- GGT
  ((SELECT analyte_id FROM analytes WHERE code = 'GGT'), 'gamma glutamyl transferase', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'GGT'), 'ggt', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'GGT'), 'ggtp', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'GGT'), 'гамма глутамилтрансфераза', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'GGT'), 'ггт', 'ru', 1.0, 'seed'),

  -- Total Bilirubin
  ((SELECT analyte_id FROM analytes WHERE code = 'TBIL'), 'total bilirubin', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TBIL'), 'bilirubin total', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TBIL'), 'tbil', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TBIL'), 'общий билирубин', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TBIL'), 'билирубин общий', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TBIL'), 'загальний білірубін', 'uk', 1.0, 'seed'),

  -- Direct Bilirubin
  ((SELECT analyte_id FROM analytes WHERE code = 'DBIL'), 'direct bilirubin', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'DBIL'), 'bilirubin direct', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'DBIL'), 'dbil', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'DBIL'), 'прямой билирубин', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'DBIL'), 'билирубин прямой', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'DBIL'), 'прямий білірубін', 'uk', 1.0, 'seed'),

  -- Albumin
  ((SELECT analyte_id FROM analytes WHERE code = 'ALB'), 'albumin', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ALB'), 'alb', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ALB'), 'альбумин', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ALB'), 'альбумін', 'uk', 1.0, 'seed'),

  -- Total Protein
  ((SELECT analyte_id FROM analytes WHERE code = 'TP'), 'total protein', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TP'), 'protein total', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TP'), 'tp', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TP'), 'общий белок', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TP'), 'белок общий', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TP'), 'загальний білок', 'uk', 1.0, 'seed'),

  -- Creatinine
  ((SELECT analyte_id FROM analytes WHERE code = 'CREA'), 'creatinine', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CREA'), 'crea', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CREA'), 'cr', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CREA'), 'креатинин', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CREA'), 'креатінін', 'uk', 1.0, 'seed'),

  -- BUN
  ((SELECT analyte_id FROM analytes WHERE code = 'BUN'), 'blood urea nitrogen', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'BUN'), 'bun', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'BUN'), 'urea', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'BUN'), 'мочевина', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'BUN'), 'сечовина', 'uk', 1.0, 'seed'),

  -- eGFR
  ((SELECT analyte_id FROM analytes WHERE code = 'EGFR'), 'egfr', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'EGFR'), 'gfr', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'EGFR'), 'glomerular filtration rate', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'EGFR'), 'скф', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'EGFR'), 'рсфк', 'uk', 1.0, 'seed'),

  -- Uric Acid
  ((SELECT analyte_id FROM analytes WHERE code = 'UA'), 'uric acid', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'UA'), 'urate', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'UA'), 'ua', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'UA'), 'мочевая кислота', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'UA'), 'сечова кислота', 'uk', 1.0, 'seed'),

  -- Total Cholesterol
  ((SELECT analyte_id FROM analytes WHERE code = 'CHOL'), 'total cholesterol', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CHOL'), 'cholesterol', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CHOL'), 'chol', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CHOL'), 'общий холестерин', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CHOL'), 'холестерин', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CHOL'), 'загальний холестерин', 'uk', 1.0, 'seed'),

  -- HDL
  ((SELECT analyte_id FROM analytes WHERE code = 'HDL'), 'hdl cholesterol', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HDL'), 'hdl', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HDL'), 'hdl c', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HDL'), 'холестерин лпвп', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HDL'), 'лпвп', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HDL'), 'хс лпвп', 'ru', 1.0, 'seed'),

  -- LDL
  ((SELECT analyte_id FROM analytes WHERE code = 'LDL'), 'ldl cholesterol', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'LDL'), 'ldl', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'LDL'), 'ldl c', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'LDL'), 'холестерин лпнп', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'LDL'), 'лпнп', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'LDL'), 'хс лпнп', 'ru', 1.0, 'seed'),

  -- Triglycerides
  ((SELECT analyte_id FROM analytes WHERE code = 'TRIG'), 'triglycerides', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TRIG'), 'trig', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TRIG'), 'tg', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TRIG'), 'триглицериды', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TRIG'), 'тригліцериди', 'uk', 1.0, 'seed'),

  -- VLDL
  ((SELECT analyte_id FROM analytes WHERE code = 'VLDL'), 'vldl cholesterol', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VLDL'), 'vldl', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VLDL'), 'холестерин лпонп', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VLDL'), 'лпонп', 'ru', 1.0, 'seed'),

  -- Glucose
  ((SELECT analyte_id FROM analytes WHERE code = 'GLU'), 'glucose', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'GLU'), 'glu', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'GLU'), 'blood glucose', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'GLU'), 'глюкоза', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'GLU'), 'глюкоза крови', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'GLU'), 'глюкоза крові', 'uk', 1.0, 'seed'),

  -- HbA1c
  ((SELECT analyte_id FROM analytes WHERE code = 'HBA1C'), 'hemoglobin a1c', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HBA1C'), 'hba1c', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HBA1C'), 'a1c', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HBA1C'), 'glycated hemoglobin', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HBA1C'), 'гликированный гемоглобин', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HBA1C'), 'глікований гемоглобін', 'uk', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HBA1C'), 'гликогемоглобин', 'ru', 1.0, 'seed'),

  -- Fructosamine
  ((SELECT analyte_id FROM analytes WHERE code = 'FRUC'), 'fructosamine', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FRUC'), 'фруктозамин', 'ru', 1.0, 'seed'),

  -- TSH
  ((SELECT analyte_id FROM analytes WHERE code = 'TSH'), 'thyroid stimulating hormone', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TSH'), 'tsh', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TSH'), 'thyrotropin', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TSH'), 'ттг', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TSH'), 'тиреотропный гормон', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TSH'), 'тиреотропний гормон', 'uk', 1.0, 'seed'),

  -- T3
  ((SELECT analyte_id FROM analytes WHERE code = 'T3'), 'triiodothyronine', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'T3'), 't3', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'T3'), 'трийодтиронин', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'T3'), 'т3', 'ru', 1.0, 'seed'),

  -- T4
  ((SELECT analyte_id FROM analytes WHERE code = 'T4'), 'thyroxine', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'T4'), 't4', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'T4'), 'тироксин', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'T4'), 'т4', 'ru', 1.0, 'seed'),

  -- Free T3
  ((SELECT analyte_id FROM analytes WHERE code = 'FT3'), 'free t3', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FT3'), 'ft3', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FT3'), 'free triiodothyronine', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FT3'), 'свободный т3', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FT3'), 'вільний т3', 'uk', 1.0, 'seed'),

  -- Free T4
  ((SELECT analyte_id FROM analytes WHERE code = 'FT4'), 'free t4', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FT4'), 'ft4', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FT4'), 'free thyroxine', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FT4'), 'свободный т4', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FT4'), 'вільний т4', 'uk', 1.0, 'seed'),

  -- Sodium
  ((SELECT analyte_id FROM analytes WHERE code = 'NA'), 'sodium', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'NA'), 'na', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'NA'), 'натрий', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'NA'), 'натрій', 'uk', 1.0, 'seed'),

  -- Potassium
  ((SELECT analyte_id FROM analytes WHERE code = 'K'), 'potassium', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'K'), 'k', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'K'), 'калий', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'K'), 'калій', 'uk', 1.0, 'seed'),

  -- Chloride
  ((SELECT analyte_id FROM analytes WHERE code = 'CL'), 'chloride', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CL'), 'cl', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CL'), 'хлор', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CL'), 'хлориды', 'ru', 1.0, 'seed'),

  -- Calcium
  ((SELECT analyte_id FROM analytes WHERE code = 'CA'), 'calcium', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CA'), 'ca', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CA'), 'кальций', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CA'), 'кальцій', 'uk', 1.0, 'seed'),

  -- Magnesium
  ((SELECT analyte_id FROM analytes WHERE code = 'MG'), 'magnesium', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MG'), 'mg', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MG'), 'магний', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MG'), 'магній', 'uk', 1.0, 'seed'),

  -- Phosphorus
  ((SELECT analyte_id FROM analytes WHERE code = 'PHOS'), 'phosphorus', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'PHOS'), 'phosphate', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'PHOS'), 'phos', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'PHOS'), 'фосфор', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'PHOS'), 'фосфаты', 'ru', 1.0, 'seed'),

  -- Vitamin D
  ((SELECT analyte_id FROM analytes WHERE code = 'VITD'), 'vitamin d', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VITD'), 'vitd', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VITD'), '25 oh d', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VITD'), '25 hydroxy vitamin d', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VITD'), 'витамин d', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VITD'), 'вітамін d', 'uk', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VITD'), '25 oh витамин d', 'ru', 1.0, 'seed'),

  -- Vitamin B12
  ((SELECT analyte_id FROM analytes WHERE code = 'VITB12'), 'vitamin b12', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VITB12'), 'b12', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VITB12'), 'cobalamin', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VITB12'), 'витамин b12', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VITB12'), 'вітамін b12', 'uk', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VITB12'), 'кобаламин', 'ru', 1.0, 'seed'),

  -- Folate
  ((SELECT analyte_id FROM analytes WHERE code = 'FOL'), 'folate', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FOL'), 'folic acid', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FOL'), 'фолиевая кислота', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FOL'), 'фолаты', 'ru', 1.0, 'seed'),

  -- Ferritin
  ((SELECT analyte_id FROM analytes WHERE code = 'FER'), 'ferritin', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FER'), 'fer', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FER'), 'ферритин', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FER'), 'феретинн', 'ru', 0.8, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FER'), 'феритин', 'ru', 0.85, 'seed'),

  -- Iron
  ((SELECT analyte_id FROM analytes WHERE code = 'FE'), 'iron', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FE'), 'fe', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FE'), 'serum iron', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FE'), 'железо', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FE'), 'железо сыворотки', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FE'), 'залізо', 'uk', 1.0, 'seed'),

  -- TIBC
  ((SELECT analyte_id FROM analytes WHERE code = 'TIBC'), 'total iron binding capacity', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TIBC'), 'tibc', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TIBC'), 'ожсс', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TIBC'), 'общая железосвязывающая способность', 'ru', 1.0, 'seed'),

  -- Transferrin Saturation
  ((SELECT analyte_id FROM analytes WHERE code = 'TSAT'), 'transferrin saturation', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TSAT'), 'tsat', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TSAT'), 'насыщение трансферрина', 'ru', 1.0, 'seed'),

  -- Creatine Kinase
  ((SELECT analyte_id FROM analytes WHERE code = 'CK'), 'creatine kinase', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CK'), 'ck', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CK'), 'cpk', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CK'), 'креатинкиназа', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CK'), 'кфк', 'ru', 1.0, 'seed'),

  -- CK-MB
  ((SELECT analyte_id FROM analytes WHERE code = 'CKMB'), 'ck mb', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CKMB'), 'ckmb', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CKMB'), 'creatine kinase mb', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CKMB'), 'кфк мв', 'ru', 1.0, 'seed'),

  -- Troponin I
  ((SELECT analyte_id FROM analytes WHERE code = 'TROP'), 'troponin i', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TROP'), 'troponin', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TROP'), 'trop i', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TROP'), 'тропонин', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TROP'), 'тропонін', 'uk', 1.0, 'seed'),

  -- BNP
  ((SELECT analyte_id FROM analytes WHERE code = 'BNP'), 'bnp', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'BNP'), 'b type natriuretic peptide', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'BNP'), 'натрийуретический пептид', 'ru', 1.0, 'seed'),

  -- CRP
  ((SELECT analyte_id FROM analytes WHERE code = 'CRP'), 'c reactive protein', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CRP'), 'crp', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CRP'), 'срб', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CRP'), 'с реактивный белок', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CRP'), 'с реактивний білок', 'uk', 1.0, 'seed'),

  -- ESR
  ((SELECT analyte_id FROM analytes WHERE code = 'ESR'), 'esr', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ESR'), 'erythrocyte sedimentation rate', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ESR'), 'sed rate', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ESR'), 'соэ', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ESR'), 'скорость оседания эритроцитов', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ESR'), 'швидкість осідання еритроцитів', 'uk', 1.0, 'seed'),

  -- LDH
  ((SELECT analyte_id FROM analytes WHERE code = 'LDH'), 'lactate dehydrogenase', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'LDH'), 'ldh', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'LDH'), 'лдг', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'LDH'), 'лактатдегидрогеназа', 'ru', 1.0, 'seed'),

  -- Amylase
  ((SELECT analyte_id FROM analytes WHERE code = 'AMY'), 'amylase', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'AMY'), 'amy', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'AMY'), 'амилаза', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'AMY'), 'аміла за', 'uk', 1.0, 'seed'),

  -- Lipase
  ((SELECT analyte_id FROM analytes WHERE code = 'LIP'), 'lipase', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'LIP'), 'lip', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'LIP'), 'липаза', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'LIP'), 'ліпаза', 'uk', 1.0, 'seed'),

  -- PSA
  ((SELECT analyte_id FROM analytes WHERE code = 'PSA'), 'prostate specific antigen', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'PSA'), 'psa', 'en', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'PSA'), 'пса', 'ru', 1.0, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'PSA'), 'простатспецифический антиген', 'ru', 1.0, 'seed')
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
