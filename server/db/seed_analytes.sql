-- Seed analytes and aliases (auto-generated from database)
-- Generated: 2025-12-11T14:07:41.720Z
-- Total analytes: 205

-- ============================================================================
-- ANALYTES (Canonical Tests)
-- ============================================================================

INSERT INTO analytes (code, name, unit_canonical, category) VALUES
  -- Hematology
  ('HCT', 'Hematocrit', '%', 'hematology'),
  ('HGB', 'Hemoglobin', 'g/dL', 'hematology'),
  ('MANUAL_DIFF_TOTAL', 'Total Cells Count in Manual Differential (leukocyte formula)', '', 'hematology'),
  ('MCH', 'Mean Corpuscular Hemoglobin', 'pg', 'hematology'),
  ('MCHC', 'Mean Corpuscular Hemoglobin Concentration', 'g/dL', 'hematology'),
  ('MCV', 'Mean Corpuscular Volume', 'fL', 'hematology'),
  ('MPV', 'Mean Platelet Volume', 'fL', 'hematology'),
  ('NEUT_BAND', 'Band Neutrophils (absolute)', '10^9/L', 'hematology'),
  ('PLT', 'Platelet Count', '10^9/L', 'hematology'),
  ('RBC', 'Red Blood Cell Count', '10^12/L', 'hematology'),
  ('RDW', 'Red Cell Distribution Width', '%', 'hematology'),
  ('RDW_SD', 'Red Cell Distribution Width (SD)', 'fL', 'hematology'),
  ('RETIC_PRCT', 'Reticulocytes (%)', '%o', 'hematology'),
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
  ('NON_HDL', 'Non-HDL Cholesterol', 'mg/dL', 'lipid'),
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
  ('ADRENALINE', 'Adrenaline (Epinephrine)', 'пг/мл', 'uncategorized'),
  ('AFP', 'Alpha-Fetoprotein (AFP)', 'IU/mL', 'uncategorized'),
  ('AI', 'Atherogenic Index (Atherogenicity Index)', '', 'uncategorized'),
  ('APOA1', 'Apolipoprotein A1', 'г/л', 'uncategorized'),
  ('APOB', 'Apolipoprotein B', 'г/л', 'uncategorized'),
  ('APOB_APOA1', 'Apolipoprotein B / Apolipoprotein A1 Ratio', '', 'uncategorized'),
  ('APTT', 'Activated Partial Thromboplastin Time (APTT)', 'сек', 'uncategorized'),
  ('APTT_RATIO', 'APTT Ratio', '', 'uncategorized'),
  ('ASLO', 'Antistreptolysin O (ASO) / Antistreptolysin O titer', 'МЕ/мл', 'uncategorized'),
  ('BASO', 'Basophils (absolute)', '10^9 клеток/л', 'uncategorized'),
  ('BASO_PRCT', 'Basophils (%)', '%', 'uncategorized'),
  ('C_PEPTIDE', 'C-Peptide', 'нг/мл', 'uncategorized'),
  ('C3', 'Complement C3', 'г/л', 'uncategorized'),
  ('C4', 'Complement C4', 'г/л', 'uncategorized'),
  ('CA_ION', 'Ionized Calcium', 'ммоль/л', 'uncategorized'),
  ('CA125', 'Cancer Antigen 125 (CA 125)', 'U/mL', 'uncategorized'),
  ('CA19_9', 'Cancer Antigen 19-9 (CA 19-9)', 'U/mL', 'uncategorized'),
  ('CA72_4', 'Cancer Antigen 72-4 (CA 72-4)', 'U/mL', 'uncategorized'),
  ('CALCITONIN', 'Calcitonin', 'pg/ml', 'uncategorized'),
  ('CANDIDA_SPP', 'Candida species (fungi) (culture/microbiology identification)', '', 'uncategorized'),
  ('CD19', 'CD19+ B-lymphocytes (absolute, 10^9/L)', '10^9 клеток/л', 'uncategorized'),
  ('CD19_PRCT', 'CD19+ B-lymphocytes (%)', '%', 'uncategorized'),
  ('CD3', 'CD3+ T-lymphocytes (absolute, 10^9/L)', '10^9 клеток/л', 'uncategorized'),
  ('CD3_HLA_DR', 'CD3+ HLA-DR+ T-lymphocytes (absolute, 10^9/L)', '10^9 клеток/л', 'uncategorized'),
  ('CD3_HLA_DR_PRCT', 'CD3+ HLA-DR+ T-lymphocytes (%)', '%', 'uncategorized'),
  ('CD3_PRCT', 'CD3+ T-lymphocytes (%)', '%', 'uncategorized'),
  ('CD4', 'CD3+CD4+ T-helpers (absolute, 10^9/L)', '10^9 клеток/л', 'uncategorized'),
  ('CD4_CD8_RATIO', 'CD4+/CD8+ Lymphocyte Ratio', '', 'uncategorized'),
  ('CD4_PRCT', 'CD3+CD4+ T-helpers (%)', '%', 'uncategorized'),
  ('CD8', 'CD3+CD8+ Cytotoxic T-lymphocytes (absolute, 10^9/L)', '10^9 клеток/л', 'uncategorized'),
  ('CD8_PRCT', 'CD3+CD8+ Cytotoxic T-lymphocytes (%)', '%', 'uncategorized'),
  ('CEA', 'Carcinoembryonic Antigen (CEA)', 'ng/mL', 'uncategorized'),
  ('CL_ION', 'Ionized Chloride', 'ммоль/л', 'uncategorized'),
  ('CMV_IGG', 'Cytomegalovirus IgG Antibody', 'Ед/мл', 'uncategorized'),
  ('CMV_IGM', 'Cytomegalovirus IgM Antibody', 'Индекс', 'uncategorized'),
  ('COAG_END', 'Clotting time - end / coagulation end', '', 'uncategorized'),
  ('COAG_START', 'Clotting time - start / coagulation start', '', 'uncategorized'),
  ('CORT', 'Cortisol', 'нмоль/л', 'uncategorized'),
  ('D_DIMER', 'D-dimer', 'нг/мл DDU', 'uncategorized'),
  ('DOPAMINE', 'Dopamine', 'пг/мл', 'uncategorized'),
  ('ENTEROBACTERIACEAE', 'Enterobacteriaceae (Enterobacteria) (culture/microbiology identification)', '', 'uncategorized'),
  ('ENTEROCOCCUS_SPP', 'Enterococcus species (culture/microbiology identification)', '', 'uncategorized'),
  ('EO', 'Eosinophils (absolute)', '10^9 клеток/л', 'uncategorized'),
  ('EO_PRCT', 'Eosinophils (%)', '%', 'uncategorized'),
  ('FIBRINOGEN', 'Fibrinogen', 'г/л', 'uncategorized'),
  ('HBsAG', 'Hepatitis B surface antigen (HBsAg), qualitative', '', 'uncategorized'),
  ('HCV_IGG', 'Hepatitis C Virus Antibodies (Anti-HCV), qualitative', 'Индекс', 'uncategorized'),
  ('HIV_ANTIBODY', 'HIV Antibodies (screening), qualitative', '', 'uncategorized'),
  ('HOMA_IR', 'HOMA-IR (Homeostatic Model Assessment of Insulin Resistance)', '', 'uncategorized'),
  ('HSV1_IGG', 'Herpes Simplex Virus Type 1 IgG Antibody', 'Ед/мл', 'uncategorized'),
  ('HSV2_IGG', 'Herpes Simplex Virus Type 2 IgG Antibody', 'Ед/мл', 'uncategorized'),
  ('IBIL', 'Indirect Bilirubin (Unconjugated Bilirubin)', 'мкмоль/л', 'uncategorized'),
  ('IG_A', 'Immunoglobulin A (IgA)', 'г/л', 'uncategorized'),
  ('IG_E', 'Total Immunoglobulin E (IgE)', 'МЕ/мл', 'uncategorized'),
  ('IG_G', 'Immunoglobulin G (IgG)', 'г/л', 'uncategorized'),
  ('IG_M', 'Immunoglobulin M (IgM)', 'г/л', 'uncategorized'),
  ('INR', 'International Normalized Ratio (INR)', '', 'uncategorized'),
  ('INSULIN', 'Insulin', 'пмоль/л', 'uncategorized'),
  ('K_ION', 'Ionized Potassium', 'ммоль/л', 'uncategorized'),
  ('LPA', 'Lipoprotein(a)', 'г/л', 'uncategorized'),
  ('LUC', 'Large Unstained Cells (absolute)', '10^9 клеток/л', 'uncategorized'),
  ('LUC_PRCT', 'Large Unstained Cells (%)', '%', 'uncategorized'),
  ('LYMPH', 'Lymphocytes (absolute)', '10^9 клеток/л', 'uncategorized'),
  ('LYMPH_PRCT', 'Lymphocytes (%)', '%', 'uncategorized'),
  ('MICROFLORA_GROWTH', 'Microflora growth (culture result: growth of flora)', '', 'uncategorized'),
  ('MONO', 'Monocytes (absolute)', '10^9 клеток/л', 'uncategorized'),
  ('MONO_PRCT', 'Monocytes (%)', '%', 'uncategorized'),
  ('NA_ION', 'Ionized Sodium', 'ммоль/л', 'uncategorized'),
  ('NEISSERIA_SUBFLAVA', 'Neisseria subflava (microbial identification)', '', 'uncategorized'),
  ('NEUT', 'Neutrophils (absolute)', '10^9 клеток/л', 'uncategorized'),
  ('NEUT_BAND_PRCT', 'Band Neutrophils (%)', '%', 'uncategorized'),
  ('NEUT_PRCT', 'Neutrophils (%)', '%', 'uncategorized'),
  ('NK', 'NK cells (CD3-CD16+CD56+) (absolute, 10^9/L)', '10^9 клеток/л', 'uncategorized'),
  ('NK_PRCT', 'NK cells (CD3-CD16+CD56+) (%)', '%', 'uncategorized'),
  ('NKT', 'NKT cells (CD3+CD16+CD56+) (absolute, 10^9/L)', '10^9 клеток/л', 'uncategorized'),
  ('NKT_PRCT', 'NKT cells (CD3+CD16+CD56+) (%)', '%', 'uncategorized'),
  ('NONFERMENTING_GRAM_NEG', 'Non-fermenting Gram-negative bacteria (culture/microbiology identification)', '', 'uncategorized'),
  ('NOREPINEPHRINE', 'Norepinephrine (Noradrenaline)', 'пг/мл', 'uncategorized'),
  ('NSE', 'Neuron-Specific Enolase (NSE)', 'ng/mL', 'uncategorized'),
  ('P_LCR', 'Platelet Large Cell Ratio (P-LCR)', '%', 'uncategorized'),
  ('PCT', 'Plateletcrit (PCT)', '%', 'uncategorized'),
  ('PCTN', 'Procalcitonin', 'нг/мл', 'uncategorized'),
  ('PDW', 'Platelet Distribution Width (PDW)', '%', 'uncategorized'),
  ('PROTHROMBIN_ACTIVITY', 'Prothrombin activity (% by Quick method)', '%', 'uncategorized'),
  ('PT', 'Prothrombin Time (PT)', 'сек', 'uncategorized'),
  ('RHEUMATOID_FACTOR', 'Rheumatoid Factor', 'МЕ/мл', 'uncategorized'),
  ('SARS2_IGG', 'SARS-CoV-2 IgG Antibody', '', 'uncategorized'),
  ('SARS2_IGG_N', 'SARS-CoV-2 Nucleocapsid IgG Antibody (semiquantitative, ELISA)', 'КП', 'uncategorized'),
  ('SARS2_IGG_S', 'SARS-CoV-2 Spike (S) Protein IgG Antibody (semiquantitative, ELISA)', 'КП', 'uncategorized'),
  ('SARS2_IGM', 'SARS-CoV-2 IgM Antibody', '', 'uncategorized'),
  ('STAPHYLOCOCCUS_SPP', 'Staphylococcus species (culture/microbiology identification)', '', 'uncategorized'),
  ('STREPTOCOCCUS_AGALACTIAE', 'Streptococcus agalactiae (Group B) (culture/microbiology identification)', '', 'uncategorized'),
  ('SYPH_IGG', 'Treponema pallidum Antibodies (syphilis), qualitative (ELISA)', '', 'uncategorized'),
  ('TESTOSTERONE_TOTAL', 'Total Testosterone', 'нмоль/л', 'uncategorized'),
  ('TG', 'Thyroglobulin (TG)', 'ng/mL', 'uncategorized'),
  ('THROMBIN_TIME', 'Thrombin Time (TT)', 'сек', 'uncategorized'),
  ('THROMBIN_TIME_RATIO', 'Thrombin Time Ratio', '', 'uncategorized'),
  ('TOXO_IGG', 'Toxoplasma gondii IgG Antibody', 'МЕ/мл', 'uncategorized'),
  ('TOXO_IGM', 'Toxoplasma gondii IgM Antibody', 'Индекс', 'uncategorized'),
  ('TPO_AB', 'Thyroid Peroxidase Antibodies (TPO Ab)', 'МЕ/мл', 'uncategorized'),
  ('URINE_AMMONIUM_BIURATE', 'Urine Ammonium Biurate Crystals', '', 'uncategorized'),
  ('URINE_BACTERIA', 'Urine Bacteria (microscopy)', '', 'uncategorized'),
  ('URINE_BIL', 'Urine Bilirubin', 'мг/дл', 'uncategorized'),
  ('URINE_CALCIUM_PHOSPHATE_CRYSTALS', 'Urine Calcium Phosphate Crystals', '', 'uncategorized'),
  ('URINE_CASTS', 'Urine Casts (cylinders)', 'в п/зр.', 'uncategorized'),
  ('URINE_CASTS_HYALINE', 'Hyaline casts (urine)', 'ед/мкл', 'uncategorized'),
  ('URINE_CASTS_NON_HYALINE', 'Non-hyaline Urine Casts', 'ед/мкл', 'uncategorized'),
  ('URINE_COLOR', 'Urine Color', '', 'uncategorized'),
  ('URINE_CRYSTALS', 'Urine Crystals / Salts', '', 'uncategorized'),
  ('URINE_CRYSTALS_OXALATE', 'Urine Calcium Oxalate Crystals', 'ед/мкл', 'uncategorized'),
  ('URINE_CULTURE_AB_SENS', 'Urine Bacterial Culture with Antibiotic Sensitivity', '', 'uncategorized'),
  ('URINE_EPIT', 'Urine Epithelial Cells (sediment)', '', 'uncategorized'),
  ('URINE_EPIT_NONPLAT', 'Urine Non-squamous Epithelial Cells (sediment)', 'ед/мкл', 'uncategorized'),
  ('URINE_EPIT_PLAT', 'Urine Squamous Epithelial Cells (sediment)', 'в п/зр.', 'uncategorized'),
  ('URINE_EPIT_RENAL', 'Urine Renal (Renal Tubular) Epithelial Cells (sediment)', 'в п/зр.', 'uncategorized'),
  ('URINE_EPIT_TRANS', 'Urine Transitional Epithelial Cells (sediment)', 'в п/зр.', 'uncategorized'),
  ('URINE_GLUC', 'Urine Glucose', 'мг/дл', 'uncategorized'),
  ('URINE_HGB', 'Urine Hemoglobin', 'мг/дл', 'uncategorized'),
  ('URINE_INTACT_RBC', 'Urine Intact (Non-lysed) Red Blood Cells', 'ед/мкл', 'uncategorized'),
  ('URINE_KET', 'Urine Ketones', 'мг/дл', 'uncategorized'),
  ('URINE_LEUKOCYTE_ESTERASE', 'Urine Leukocyte Esterase', '', 'uncategorized'),
  ('URINE_MUCUS', 'Urine Mucus (sediment)', '', 'uncategorized'),
  ('URINE_MUCUS_SED', 'Mucus (urine sediment)', 'ед/мкл', 'uncategorized'),
  ('URINE_NIT', 'Urine Nitrites', '', 'uncategorized'),
  ('URINE_NORMAL_FLORA', 'Normal Flora (urine culture/microscopy)', '', 'uncategorized'),
  ('URINE_PH', 'Urine pH', '', 'uncategorized'),
  ('URINE_PROT', 'Urine Protein', 'мг/дл', 'uncategorized'),
  ('URINE_RBC', 'Urine Red Blood Cells', 'ед/мкл', 'uncategorized'),
  ('URINE_RBC_HGB', 'Urine Red Blood Cells and Hemoglobin (urine haematuria/hemoglobin)', 'мг/л', 'uncategorized'),
  ('URINE_SED_RBC', 'Urine Sediment Erythrocytes', '', 'uncategorized'),
  ('URINE_SED_WBC', 'Urine Sediment Leukocytes', '', 'uncategorized'),
  ('URINE_SG', 'Urine Specific Gravity', '', 'uncategorized'),
  ('URINE_SPERM', 'Spermatozoa in Urine (sediment)', 'ед/мкл', 'uncategorized'),
  ('URINE_TRIPLE_PHOSPHATE_CRYSTALS', 'Urine Triple Phosphate (Struvite) Crystals', '', 'uncategorized'),
  ('URINE_TURBIDITY', 'Urine Transparency/Turbidity', '', 'uncategorized'),
  ('URINE_UBG', 'Urine Urobilinogen', 'мг/дл', 'uncategorized'),
  ('URINE_URATES', 'Urine Urate Crystals', '', 'uncategorized'),
  ('URINE_URIC_ACID_CRYSTALS', 'Urine Uric Acid Crystals', '', 'uncategorized'),
  ('URINE_UROBILIN', 'Urine Urobilin', 'мкмоль/л', 'uncategorized'),
  ('URINE_WBC', 'Urine Leukocytes (WBC)', 'ед/мкл', 'uncategorized'),
  ('URINE_WBC_CLUSTERS', 'Urine Leukocyte Aggregates / WBC Clusters (urine sediment)', 'ед/мкл', 'uncategorized'),
  ('URINE_YEAST', 'Urine Yeast (fungi, microscopy)', 'ед/мкл', 'uncategorized')
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

  -- Band Neutrophils (absolute) (NEUT_BAND)
  ((SELECT analyte_id FROM analytes WHERE code = 'NEUT_BAND'), 'band neutrophils', 'en', 1, 'dedup'),
  ((SELECT analyte_id FROM analytes WHERE code = 'NEUT_BAND'), 'band neutrophils absolute', 'en', 1, 'dedup'),
  ((SELECT analyte_id FROM analytes WHERE code = 'NEUT_BAND'), 'neut bands abs', 'en', 1, 'dedup'),
  ((SELECT analyte_id FROM analytes WHERE code = 'NEUT_BAND'), 'нейтрофилы палочкоядерные', 'ru', 1, 'dedup'),
  ((SELECT analyte_id FROM analytes WHERE code = 'NEUT_BAND'), 'нейтрофилы палочк абс', 'ru', 1, 'dedup'),

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

  -- Non-HDL Cholesterol (NON_HDL)
  ((SELECT analyte_id FROM analytes WHERE code = 'NON_HDL'), 'non hdl', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'NON_HDL'), 'non hdl cholesterol', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'NON_HDL'), 'non-hdl', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'NON_HDL'), 'non-hdl cholesterol', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'NON_HDL'), 'nonhdl', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'NON_HDL'), 'не лпвп', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'NON_HDL'), 'холестерин не лпвп', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'NON_HDL'), 'холестерин не-лпвп', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'NON_HDL'), 'хс не-лпвп', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'NON_HDL'), 'не-лпвп', 'ru', 1, 'seed'),

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
  ((SELECT analyte_id FROM analytes WHERE code = 'AMY'), 'панкреатическая амилаза', 'ru', 1, 'manual_disambiguation'),
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

  -- Adrenaline (Epinephrine) (ADRENALINE)
  ((SELECT analyte_id FROM analytes WHERE code = 'ADRENALINE'), 'адреналин', 'ru', 1, 'evidence_auto'),

  -- Alpha-Fetoprotein (AFP) (AFP)
  ((SELECT analyte_id FROM analytes WHERE code = 'AFP'), 'альфа фетопротеин afp', 'ru', 1, 'evidence_auto'),

  -- Atherogenic Index (Atherogenicity Index) (AI)
  ((SELECT analyte_id FROM analytes WHERE code = 'AI'), 'индекс атерогенности', 'ru', 1, 'evidence_auto'),

  -- Apolipoprotein A1 (APOA1)
  ((SELECT analyte_id FROM analytes WHERE code = 'APOA1'), 'аполипопротеин a1', 'ru', 1, 'evidence_auto'),

  -- Apolipoprotein B (APOB)
  ((SELECT analyte_id FROM analytes WHERE code = 'APOB'), 'аполипопротеин b', 'ru', 1, 'evidence_auto'),

  -- Apolipoprotein B / Apolipoprotein A1 Ratio (APOB_APOA1)
  ((SELECT analyte_id FROM analytes WHERE code = 'APOB_APOA1'), 'апо в апо а1', 'ru', 1, 'evidence_auto'),

  -- Activated Partial Thromboplastin Time (APTT) (APTT)
  ((SELECT analyte_id FROM analytes WHERE code = 'APTT'), 'активированное частичное тромбопластиновое время ачтв', 'ru', 1, 'evidence_auto'),

  -- APTT Ratio (APTT_RATIO)
  ((SELECT analyte_id FROM analytes WHERE code = 'APTT_RATIO'), 'ачтв ratio', 'en', 1, 'evidence_auto'),

  -- Antistreptolysin O (ASO) / Antistreptolysin O titer (ASLO)
  ((SELECT analyte_id FROM analytes WHERE code = 'ASLO'), 'асл о', 'ru', 1, 'evidence_auto'),

  -- Basophils (absolute) (BASO)
  ((SELECT analyte_id FROM analytes WHERE code = 'BASO'), 'базофилы baso', 'ru', 1, 'evidence_auto'),

  -- Basophils (%) (BASO_PRCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'BASO_PRCT'), 'базофилы baso', 'ru', 1, 'evidence_auto'),

  -- C-Peptide (C_PEPTIDE)
  ((SELECT analyte_id FROM analytes WHERE code = 'C_PEPTIDE'), 'с пептид', 'ru', 1, 'evidence_auto'),

  -- Complement C3 (C3)
  ((SELECT analyte_id FROM analytes WHERE code = 'C3'), 'комплемент с3с', 'ru', 1, 'evidence_auto'),

  -- Complement C4 (C4)
  ((SELECT analyte_id FROM analytes WHERE code = 'C4'), 'комплемент с4', 'ru', 1, 'evidence_auto'),

  -- Ionized Calcium (CA_ION)
  ((SELECT analyte_id FROM analytes WHERE code = 'CA_ION'), 'кальций ионизированный', 'ru', 1, 'evidence_auto'),

  -- Cancer Antigen 125 (CA 125) (CA125)
  ((SELECT analyte_id FROM analytes WHERE code = 'CA125'), 'ca 125', 'en', 1, 'evidence_auto'),

  -- Cancer Antigen 19-9 (CA 19-9) (CA19_9)
  ((SELECT analyte_id FROM analytes WHERE code = 'CA19_9'), 'ca 19 9', 'en', 1, 'evidence_auto'),

  -- Cancer Antigen 72-4 (CA 72-4) (CA72_4)
  ((SELECT analyte_id FROM analytes WHERE code = 'CA72_4'), 'ра 72 4 ca 72 4', 'ru', 1, 'evidence_auto'),

  -- Calcitonin (CALCITONIN)
  ((SELECT analyte_id FROM analytes WHERE code = 'CALCITONIN'), 'кальцитонин calcitonin', 'ru', 1, 'evidence_auto'),

  -- Candida species (fungi) (culture/microbiology identification) (CANDIDA_SPP)
  ((SELECT analyte_id FROM analytes WHERE code = 'CANDIDA_SPP'), 'грибы рода candida', 'ru', 1, 'evidence_auto'),

  -- CD19+ B-lymphocytes (absolute, 10^9/L) (CD19)
  ((SELECT analyte_id FROM analytes WHERE code = 'CD19'), 'в лимфоциты cd19 10 9 л', 'ru', 1, 'evidence_auto'),

  -- CD19+ B-lymphocytes (%) (CD19_PRCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'CD19_PRCT'), 'в лимфоциты cd19', 'ru', 1, 'evidence_auto'),

  -- CD3+ T-lymphocytes (absolute, 10^9/L) (CD3)
  ((SELECT analyte_id FROM analytes WHERE code = 'CD3'), 'т лимфоциты cd3 10 9 л', 'ru', 1, 'evidence_auto'),

  -- CD3+ HLA-DR+ T-lymphocytes (absolute, 10^9/L) (CD3_HLA_DR)
  ((SELECT analyte_id FROM analytes WHERE code = 'CD3_HLA_DR'), 'cd3 hla dr t лимфоциты 10 9 л', 'ru', 1, 'evidence_auto'),

  -- CD3+ HLA-DR+ T-lymphocytes (%) (CD3_HLA_DR_PRCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'CD3_HLA_DR_PRCT'), 'cd3 hla dr t лимфоциты', 'ru', 1, 'evidence_auto'),

  -- CD3+ T-lymphocytes (%) (CD3_PRCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'CD3_PRCT'), 'т лимфоциты cd3', 'ru', 1, 'evidence_auto'),

  -- CD3+CD4+ T-helpers (absolute, 10^9/L) (CD4)
  ((SELECT analyte_id FROM analytes WHERE code = 'CD4'), 'т хелперы cd3 cd4 10 9 л', 'ru', 1, 'evidence_auto'),

  -- CD4+/CD8+ Lymphocyte Ratio (CD4_CD8_RATIO)
  ((SELECT analyte_id FROM analytes WHERE code = 'CD4_CD8_RATIO'), 'соотношение лимфоцитов cd4 cd8', 'ru', 1, 'evidence_auto'),

  -- CD3+CD4+ T-helpers (%) (CD4_PRCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'CD4_PRCT'), 'т хелперы cd3 cd4', 'ru', 1, 'evidence_auto'),

  -- CD3+CD8+ Cytotoxic T-lymphocytes (absolute, 10^9/L) (CD8)
  ((SELECT analyte_id FROM analytes WHERE code = 'CD8'), 'цитототоксические т лимфоциты сd3 сd8 10 9 л', 'ru', 1, 'evidence_auto'),

  -- CD3+CD8+ Cytotoxic T-lymphocytes (%) (CD8_PRCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'CD8_PRCT'), 'цитототоксические т лимфоциты сd3 сd8', 'ru', 1, 'evidence_auto'),

  -- Carcinoembryonic Antigen (CEA) (CEA)
  ((SELECT analyte_id FROM analytes WHERE code = 'CEA'), 'рэа cea', 'ru', 1, 'evidence_auto'),

  -- Ionized Chloride (CL_ION)
  ((SELECT analyte_id FROM analytes WHERE code = 'CL_ION'), 'хлор ионизированный', 'ru', 1, 'evidence_auto'),

  -- Cytomegalovirus IgG Antibody (CMV_IGG)
  ((SELECT analyte_id FROM analytes WHERE code = 'CMV_IGG'), 'цитомегаловирус igg', 'ru', 1, 'evidence_auto'),

  -- Cytomegalovirus IgM Antibody (CMV_IGM)
  ((SELECT analyte_id FROM analytes WHERE code = 'CMV_IGM'), 'цитомегаловирус igm', 'ru', 1, 'evidence_auto'),

  -- Clotting time - end / coagulation end (COAG_END)
  ((SELECT analyte_id FROM analytes WHERE code = 'COAG_END'), 'свертываемость крови конец', 'ru', 1, 'evidence_auto'),

  -- Clotting time - start / coagulation start (COAG_START)
  ((SELECT analyte_id FROM analytes WHERE code = 'COAG_START'), 'свертываемость крови начало', 'ru', 1, 'evidence_auto'),

  -- Cortisol (CORT)
  ((SELECT analyte_id FROM analytes WHERE code = 'CORT'), 'кортизол', 'ru', 1, 'evidence_auto'),

  -- D-dimer (D_DIMER)
  ((SELECT analyte_id FROM analytes WHERE code = 'D_DIMER'), 'd димер', 'ru', 1, 'evidence_auto'),

  -- Dopamine (DOPAMINE)
  ((SELECT analyte_id FROM analytes WHERE code = 'DOPAMINE'), 'дофамин', 'ru', 1, 'evidence_auto'),

  -- Enterobacteriaceae (Enterobacteria) (culture/microbiology identification) (ENTEROBACTERIACEAE)
  ((SELECT analyte_id FROM analytes WHERE code = 'ENTEROBACTERIACEAE'), 'энтеробактерии', 'ru', 1, 'evidence_auto'),

  -- Enterococcus species (culture/microbiology identification) (ENTEROCOCCUS_SPP)
  ((SELECT analyte_id FROM analytes WHERE code = 'ENTEROCOCCUS_SPP'), 'enterococcus spp', 'en', 1, 'evidence_auto'),

  -- Eosinophils (absolute) (EO)
  ((SELECT analyte_id FROM analytes WHERE code = 'EO'), 'эозинофилы eo', 'ru', 1, 'evidence_auto'),

  -- Eosinophils (%) (EO_PRCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'EO_PRCT'), 'эозинофилы eo', 'ru', 1, 'evidence_auto'),

  -- Fibrinogen (FIBRINOGEN)
  ((SELECT analyte_id FROM analytes WHERE code = 'FIBRINOGEN'), 'фибриноген', 'ru', 1, 'evidence_auto'),

  -- Hepatitis B surface antigen (HBsAg), qualitative (HBsAG)
  ((SELECT analyte_id FROM analytes WHERE code = 'HBsAG'), 'hbsag австралийский антиген поверхностный качеств', 'ru', 1, 'evidence_auto'),

  -- Hepatitis C Virus Antibodies (Anti-HCV), qualitative (HCV_IGG)
  ((SELECT analyte_id FROM analytes WHERE code = 'HCV_IGG'), 'вирус гепатита с anti hcv антитела качеств', 'ru', 1, 'evidence_auto'),

  -- HIV Antibodies (screening), qualitative (HIV_ANTIBODY)
  ((SELECT analyte_id FROM analytes WHERE code = 'HIV_ANTIBODY'), 'исследование клинического материала на вич спид', 'ru', 1, 'evidence_auto'),

  -- HOMA-IR (Homeostatic Model Assessment of Insulin Resistance) (HOMA_IR)
  ((SELECT analyte_id FROM analytes WHERE code = 'HOMA_IR'), 'индекс homa ir', 'ru', 1, 'evidence_auto'),

  -- Herpes Simplex Virus Type 1 IgG Antibody (HSV1_IGG)
  ((SELECT analyte_id FROM analytes WHERE code = 'HSV1_IGG'), 'вирус простого герпеса 1 типа igg', 'ru', 1, 'evidence_auto'),

  -- Herpes Simplex Virus Type 2 IgG Antibody (HSV2_IGG)
  ((SELECT analyte_id FROM analytes WHERE code = 'HSV2_IGG'), 'вирус простого герпеса 2 типа igg', 'ru', 1, 'evidence_auto'),

  -- Indirect Bilirubin (Unconjugated Bilirubin) (IBIL)
  ((SELECT analyte_id FROM analytes WHERE code = 'IBIL'), 'билирубин непрямой', 'ru', 1, 'evidence_auto'),

  -- Immunoglobulin A (IgA) (IG_A)
  ((SELECT analyte_id FROM analytes WHERE code = 'IG_A'), 'иммуноглобулин a', 'ru', 1, 'evidence_auto'),

  -- Total Immunoglobulin E (IgE) (IG_E)
  ((SELECT analyte_id FROM analytes WHERE code = 'IG_E'), 'общий иммуноглобулин e', 'ru', 1, 'evidence_auto'),

  -- Immunoglobulin G (IgG) (IG_G)
  ((SELECT analyte_id FROM analytes WHERE code = 'IG_G'), 'иммуноглобулин g', 'ru', 1, 'manual'),

  -- Immunoglobulin M (IgM) (IG_M)
  ((SELECT analyte_id FROM analytes WHERE code = 'IG_M'), 'иммуноглобулин m', 'ru', 1, 'evidence_auto'),

  -- International Normalized Ratio (INR) (INR)
  ((SELECT analyte_id FROM analytes WHERE code = 'INR'), 'мно inr', 'ru', 1, 'evidence_auto'),

  -- Insulin (INSULIN)
  ((SELECT analyte_id FROM analytes WHERE code = 'INSULIN'), 'инсулин', 'ru', 1, 'evidence_auto'),

  -- Ionized Potassium (K_ION)
  ((SELECT analyte_id FROM analytes WHERE code = 'K_ION'), 'калий ионизированный', 'ru', 1, 'evidence_auto'),

  -- Lipoprotein(a) (LPA)
  ((SELECT analyte_id FROM analytes WHERE code = 'LPA'), 'липопротеин а', 'ru', 1, 'evidence_auto'),

  -- Large Unstained Cells (absolute) (LUC)
  ((SELECT analyte_id FROM analytes WHERE code = 'LUC'), 'luc большие неокрашенные клетки', 'ru', 1, 'evidence_auto'),

  -- Large Unstained Cells (%) (LUC_PRCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'LUC_PRCT'), 'luc большие неокрашенные клетки', 'ru', 1, 'evidence_auto'),

  -- Lymphocytes (absolute) (LYMPH)
  ((SELECT analyte_id FROM analytes WHERE code = 'LYMPH'), 'лимфоциты lymph', 'ru', 1, 'evidence_auto'),

  -- Lymphocytes (%) (LYMPH_PRCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'LYMPH_PRCT'), 'лимфоциты lymph', 'ru', 1, 'evidence_auto'),

  -- Microflora growth (culture result: growth of flora) (MICROFLORA_GROWTH)
  ((SELECT analyte_id FROM analytes WHERE code = 'MICROFLORA_GROWTH'), 'роста микрофлоры', 'ru', 1, 'evidence_auto'),

  -- Monocytes (absolute) (MONO)
  ((SELECT analyte_id FROM analytes WHERE code = 'MONO'), 'моноциты mono', 'ru', 1, 'evidence_auto'),

  -- Monocytes (%) (MONO_PRCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'MONO_PRCT'), 'моноциты mono', 'ru', 1, 'evidence_auto'),

  -- Ionized Sodium (NA_ION)
  ((SELECT analyte_id FROM analytes WHERE code = 'NA_ION'), 'натрий ионизированный', 'ru', 1, 'evidence_auto'),

  -- Neisseria subflava (microbial identification) (NEISSERIA_SUBFLAVA)
  ((SELECT analyte_id FROM analytes WHERE code = 'NEISSERIA_SUBFLAVA'), 'neisseria subflava', 'en', 1, 'evidence_auto'),

  -- Neutrophils (absolute) (NEUT)
  ((SELECT analyte_id FROM analytes WHERE code = 'NEUT'), 'нейтрофильные гранулоциты neut', 'ru', 1, 'evidence_auto'),

  -- Band Neutrophils (%) (NEUT_BAND_PRCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'NEUT_BAND_PRCT'), 'палочкоядерные нейтрофилы neut r', 'ru', 1, 'evidence_auto'),

  -- Neutrophils (%) (NEUT_PRCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'NEUT_PRCT'), 'нейтрофильные гранулоциты neut', 'ru', 1, 'evidence_auto'),

  -- NK cells (CD3-CD16+CD56+) (absolute, 10^9/L) (NK)
  ((SELECT analyte_id FROM analytes WHERE code = 'NK'), 'nk клетки cd3 cd16 cd56 10 9 л', 'en', 1, 'evidence_auto'),

  -- NK cells (CD3-CD16+CD56+) (%) (NK_PRCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'NK_PRCT'), 'nk клетки cd3 cd16 cd56', 'en', 1, 'evidence_auto'),

  -- NKT cells (CD3+CD16+CD56+) (absolute, 10^9/L) (NKT)
  ((SELECT analyte_id FROM analytes WHERE code = 'NKT'), 'nkt клетки cd3 cd16 cd56 10 9 л', 'en', 1, 'evidence_auto'),

  -- NKT cells (CD3+CD16+CD56+) (%) (NKT_PRCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'NKT_PRCT'), 'nkt клетки cd3 cd16 cd56', 'en', 1, 'evidence_auto'),

  -- Non-fermenting Gram-negative bacteria (culture/microbiology identification) (NONFERMENTING_GRAM_NEG)
  ((SELECT analyte_id FROM analytes WHERE code = 'NONFERMENTING_GRAM_NEG'), 'неферментирующие грамотрицательные бактерии', 'ru', 1, 'evidence_auto'),

  -- Norepinephrine (Noradrenaline) (NOREPINEPHRINE)
  ((SELECT analyte_id FROM analytes WHERE code = 'NOREPINEPHRINE'), 'норадреналин', 'ru', 1, 'evidence_auto'),

  -- Neuron-Specific Enolase (NSE) (NSE)
  ((SELECT analyte_id FROM analytes WHERE code = 'NSE'), 'нейрон специфическая энолаза nse', 'ru', 1, 'evidence_auto'),

  -- Platelet Large Cell Ratio (P-LCR) (P_LCR)
  ((SELECT analyte_id FROM analytes WHERE code = 'P_LCR'), 'коэффициент больших тромбоцитов p lcr', 'ru', 1, 'evidence_auto'),

  -- Plateletcrit (PCT) (PCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'PCT'), 'тромбокрит pct', 'ru', 1, 'evidence_auto'),

  -- Procalcitonin (PCTN)
  ((SELECT analyte_id FROM analytes WHERE code = 'PCTN'), 'прокальцитонин', 'ru', 1, 'evidence_auto'),

  -- Platelet Distribution Width (PDW) (PDW)
  ((SELECT analyte_id FROM analytes WHERE code = 'PDW'), 'ширина распределения тромбоцитов по объемам pdw', 'ru', 1, 'evidence_auto'),

  -- Prothrombin activity (% by Quick method) (PROTHROMBIN_ACTIVITY)
  ((SELECT analyte_id FROM analytes WHERE code = 'PROTHROMBIN_ACTIVITY'), 'протромбин по квику', 'ru', 1, 'evidence_auto'),

  -- Prothrombin Time (PT) (PT)
  ((SELECT analyte_id FROM analytes WHERE code = 'PT'), 'протромбиновое время', 'ru', 1, 'evidence_auto'),

  -- Rheumatoid Factor (RHEUMATOID_FACTOR)
  ((SELECT analyte_id FROM analytes WHERE code = 'RHEUMATOID_FACTOR'), 'ревматоидный фактор', 'ru', 1, 'evidence_auto'),

  -- SARS-CoV-2 IgG Antibody (SARS2_IGG)
  ((SELECT analyte_id FROM analytes WHERE code = 'SARS2_IGG'), 'sars cov 2 igg', 'en', 1, 'evidence_auto'),

  -- SARS-CoV-2 Nucleocapsid IgG Antibody (semiquantitative, ELISA) (SARS2_IGG_N)
  ((SELECT analyte_id FROM analytes WHERE code = 'SARS2_IGG_N'), 'ифа sars cov 2 антитела igg к n белку нуклеокапсидному полукол опред', 'ru', 1, 'evidence_auto'),

  -- SARS-CoV-2 Spike (S) Protein IgG Antibody (semiquantitative, ELISA) (SARS2_IGG_S)
  ((SELECT analyte_id FROM analytes WHERE code = 'SARS2_IGG_S'), 'ифа sars cov 2 антитела igg к s белку полукол опред', 'ru', 1, 'evidence_auto'),

  -- SARS-CoV-2 IgM Antibody (SARS2_IGM)
  ((SELECT analyte_id FROM analytes WHERE code = 'SARS2_IGM'), 'sars cov 2 igm', 'en', 1, 'evidence_auto'),

  -- Staphylococcus species (culture/microbiology identification) (STAPHYLOCOCCUS_SPP)
  ((SELECT analyte_id FROM analytes WHERE code = 'STAPHYLOCOCCUS_SPP'), 'staphylococcus spp', 'en', 1, 'evidence_auto'),

  -- Streptococcus agalactiae (Group B) (culture/microbiology identification) (STREPTOCOCCUS_AGALACTIAE)
  ((SELECT analyte_id FROM analytes WHERE code = 'STREPTOCOCCUS_AGALACTIAE'), 'streptococcus agalactiae группа b', 'en', 1, 'evidence_auto'),

  -- Treponema pallidum Antibodies (syphilis), qualitative (ELISA) (SYPH_IGG)
  ((SELECT analyte_id FROM analytes WHERE code = 'SYPH_IGG'), 'сифилис суммарные антитела к treponema pallidum ифа качеств опр', 'ru', 1, 'evidence_auto'),

  -- Total Testosterone (TESTOSTERONE_TOTAL)
  ((SELECT analyte_id FROM analytes WHERE code = 'TESTOSTERONE_TOTAL'), 'тестостерон общий', 'ru', 1, 'evidence_auto'),

  -- Thyroglobulin (TG) (TG)
  ((SELECT analyte_id FROM analytes WHERE code = 'TG'), 'тиреоглобулин tg', 'ru', 1, 'evidence_auto'),

  -- Thrombin Time (TT) (THROMBIN_TIME)
  ((SELECT analyte_id FROM analytes WHERE code = 'THROMBIN_TIME'), 'тромбиновое время', 'ru', 1, 'evidence_auto'),

  -- Thrombin Time Ratio (THROMBIN_TIME_RATIO)
  ((SELECT analyte_id FROM analytes WHERE code = 'THROMBIN_TIME_RATIO'), 'тромбиновое время ratio', 'ru', 1, 'evidence_auto'),

  -- Toxoplasma gondii IgG Antibody (TOXO_IGG)
  ((SELECT analyte_id FROM analytes WHERE code = 'TOXO_IGG'), 'токсоплазма toxoplasma gondii igg', 'en', 1, 'evidence_auto'),

  -- Toxoplasma gondii IgM Antibody (TOXO_IGM)
  ((SELECT analyte_id FROM analytes WHERE code = 'TOXO_IGM'), 'токсоплазма toxoplasma gondii igm', 'en', 1, 'evidence_auto'),

  -- Thyroid Peroxidase Antibodies (TPO Ab) (TPO_AB)
  ((SELECT analyte_id FROM analytes WHERE code = 'TPO_AB'), 'переоксидаза щитовидной железы аутоантитела атпо', 'ru', 1, 'evidence_auto'),

  -- Urine Ammonium Biurate Crystals (URINE_AMMONIUM_BIURATE)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_AMMONIUM_BIURATE'), 'urine ammonium urate crystals', 'en', 1, 'dedup'),
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_AMMONIUM_BIURATE'), 'кр кисл мочекислого аммония', 'ru', 1, 'dedup'),

  -- Urine Bacteria (microscopy) (URINE_BACTERIA)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_BACTERIA'), 'бактерии', 'ru', 1, 'evidence_auto'),

  -- Urine Bilirubin (URINE_BIL)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_BIL'), 'билирубин в моче', 'ru', 1, 'evidence_auto'),

  -- Urine Calcium Phosphate Crystals (URINE_CALCIUM_PHOSPHATE_CRYSTALS)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_CALCIUM_PHOSPHATE_CRYSTALS'), 'крист фосфорнокисл кальция', 'ru', 1, 'evidence_auto'),

  -- Urine Casts (cylinders) (URINE_CASTS)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_CASTS'), 'цилиндры', 'ru', 1, 'evidence_auto'),

  -- Urine Color (URINE_COLOR)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_COLOR'), 'цвет мочи', 'ru', 1, 'evidence_auto'),

  -- Urine Crystals / Salts (URINE_CRYSTALS)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_CRYSTALS'), 'соли', 'ru', 1, 'evidence_auto'),

  -- Urine Calcium Oxalate Crystals (URINE_CRYSTALS_OXALATE)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_CRYSTALS_OXALATE'), 'calcium oxalate crystals', 'en', 1, 'dedup'),
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_CRYSTALS_OXALATE'), 'oxalate crystals', 'en', 1, 'dedup'),
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_CRYSTALS_OXALATE'), 'кристаллы оксалаты', 'ru', 1, 'evidence_auto'),
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_CRYSTALS_OXALATE'), 'оксалатные кристаллы', 'ru', 1, 'dedup'),
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_CRYSTALS_OXALATE'), 'кристаллы оксалата кальция', 'ru', 1, 'evidence_auto'),

  -- Urine Bacterial Culture with Antibiotic Sensitivity (URINE_CULTURE_AB_SENS)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_CULTURE_AB_SENS'), 'бак посев чувств к аб моча', 'ru', 1, 'evidence_auto'),

  -- Urine Epithelial Cells (sediment) (URINE_EPIT)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_EPIT'), 'эпителиальные клетки осадок', 'ru', 1, 'evidence_auto'),

  -- Urine Non-squamous Epithelial Cells (sediment) (URINE_EPIT_NONPLAT)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_EPIT_NONPLAT'), 'клетки неплоского эпителия', 'ru', 1, 'manual'),

  -- Urine Squamous Epithelial Cells (sediment) (URINE_EPIT_PLAT)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_EPIT_PLAT'), 'эпителий плоский', 'ru', 1, 'evidence_auto'),

  -- Urine Renal (Renal Tubular) Epithelial Cells (sediment) (URINE_EPIT_RENAL)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_EPIT_RENAL'), 'эпителий почечный', 'ru', 1, 'evidence_auto'),

  -- Urine Transitional Epithelial Cells (sediment) (URINE_EPIT_TRANS)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_EPIT_TRANS'), 'эпителий переходный', 'ru', 1, 'evidence_auto'),

  -- Urine Glucose (URINE_GLUC)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_GLUC'), 'глюкоза мочи', 'ru', 1, 'evidence_auto'),

  -- Urine Intact (Non-lysed) Red Blood Cells (URINE_INTACT_RBC)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_INTACT_RBC'), 'нелизированные эритроциты', 'ru', 1, 'manual'),

  -- Urine Ketones (URINE_KET)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_KET'), 'кетоновые тела', 'ru', 1, 'evidence_auto'),

  -- Urine Leukocyte Esterase (URINE_LEUKOCYTE_ESTERASE)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_LEUKOCYTE_ESTERASE'), 'leukocyte esterase', 'en', 1, 'dedup'),
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_LEUKOCYTE_ESTERASE'), 'лейкоцитарная эстераза', 'ru', 1, 'dedup'),

  -- Urine Mucus (sediment) (URINE_MUCUS)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_MUCUS'), 'слизь осадок', 'ru', 1, 'evidence_auto'),

  -- Mucus (urine sediment) (URINE_MUCUS_SED)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_MUCUS_SED'), 'слизь', 'ru', 1, 'evidence_auto'),

  -- Urine Nitrites (URINE_NIT)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_NIT'), 'нитриты', 'ru', 1, 'evidence_auto'),

  -- Normal Flora (urine culture/microscopy) (URINE_NORMAL_FLORA)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_NORMAL_FLORA'), 'normal flora', 'en', 1, 'evidence_auto'),

  -- Urine pH (URINE_PH)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_PH'), 'реакция мочи', 'ru', 1, 'evidence_auto'),

  -- Urine Protein (URINE_PROT)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_PROT'), 'белок мочи', 'ru', 1, 'evidence_auto'),

  -- Urine Red Blood Cells (URINE_RBC)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_RBC'), 'эритроциты в моче', 'ru', 1, 'evidence_auto'),

  -- Urine Red Blood Cells and Hemoglobin (urine haematuria/hemoglobin) (URINE_RBC_HGB)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_RBC_HGB'), 'эритроциты гемоглобин в моче', 'ru', 1, 'evidence_auto'),

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

  -- Urine Urate Crystals (URINE_URATES)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_URATES'), 'ураты', 'ru', 1, 'evidence_auto'),

  -- Urine Uric Acid Crystals (URINE_URIC_ACID_CRYSTALS)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_URIC_ACID_CRYSTALS'), 'крист мочевой кислоты', 'ru', 1, 'evidence_auto'),

  -- Urine Leukocytes (WBC) (URINE_WBC)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_WBC'), 'лейкоциты в моче', 'ru', 1, 'evidence_auto'),

  -- Urine Leukocyte Aggregates / WBC Clusters (urine sediment) (URINE_WBC_CLUSTERS)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_WBC_CLUSTERS'), 'скопления лейкоцитов', 'ru', 1, 'manual_disambiguation'),

  -- Urine Yeast (fungi, microscopy) (URINE_YEAST)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_YEAST'), 'дрожжевые грибки', 'ru', 1, 'evidence_auto'),
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_YEAST'), 'дрожжевые грибы', 'ru', 1, 'evidence_auto')
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
