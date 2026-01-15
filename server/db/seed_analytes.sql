-- Seed analytes and aliases (auto-generated from database)
-- Generated: 2026-01-15T17:24:26.652Z
-- Total analytes: 250

-- ============================================================================
-- ANALYTES (Canonical Tests)
-- ============================================================================

INSERT INTO analytes (code, name) VALUES
  ('ACTH', 'Adrenocorticotropic Hormone (ACTH)'),
  ('ADRENALINE', 'Adrenaline (Epinephrine)'),
  ('AFP', 'Alpha-Fetoprotein (AFP)'),
  ('AI', 'Atherogenic Index (Atherogenicity Index)'),
  ('ALB', 'Albumin'),
  ('ALP', 'Alkaline Phosphatase'),
  ('ALPHA1_GLOBULINS', 'Alpha-1 Globulins'),
  ('ALPHA2_GLOBULINS', 'Alpha-2 Globulins'),
  ('ALT', 'Alanine Aminotransferase'),
  ('AMY', 'Amylase'),
  ('ANTI_MULLERIAN_HORMONE', 'Anti-Müllerian Hormone (AMH)'),
  ('ANTITHROMBIN_III', 'Antithrombin III activity (%)'),
  ('APOA1', 'Apolipoprotein A1'),
  ('APOB', 'Apolipoprotein B'),
  ('APOB_APOA1', 'Apolipoprotein B / Apolipoprotein A1 Ratio'),
  ('APTT', 'Activated Partial Thromboplastin Time (APTT)'),
  ('APTT_RATIO', 'APTT Ratio'),
  ('ASLO', 'Antistreptolysin O (ASO) / Antistreptolysin O titer'),
  ('AST', 'Aspartate Aminotransferase'),
  ('B1', 'B1-lymphocytes (CD19+CD5+) (absolute, 10^9/L)'),
  ('B1_PRCT', 'B1-lymphocytes (CD19+CD5+) (%)'),
  ('BASO', 'Basophils (absolute)'),
  ('BASO_PRCT', 'Basophils (%)'),
  ('BETA_GLOBULINS', 'Beta Globulins'),
  ('B_MEMORY', 'Memory B-cells (absolute, 10^9/L)'),
  ('B_MEMORY_PRCT', 'Memory B-cells (%)'),
  ('BNP', 'B-type Natriuretic Peptide'),
  ('BUN', 'Blood Urea Nitrogen'),
  ('C3', 'Complement C3'),
  ('C4', 'Complement C4'),
  ('CA', 'Calcium'),
  ('CA125', 'Cancer Antigen 125 (CA 125)'),
  ('CA15_3', 'Cancer Antigen 15-3 (CA 15-3)'),
  ('CA19_9', 'Cancer Antigen 19-9 (CA 19-9)'),
  ('CA72_4', 'Cancer Antigen 72-4 (CA 72-4)'),
  ('CA_ION', 'Ionized Calcium'),
  ('CALCITONIN', 'Calcitonin'),
  ('CANDIDA_SPP', 'Candida species (fungi) (culture/microbiology identification)'),
  ('CD19', 'CD19+ B-lymphocytes (absolute, 10^9/L)'),
  ('CD19_PRCT', 'CD19+ B-lymphocytes (%)'),
  ('CD3', 'CD3+ T-lymphocytes (absolute, 10^9/L)'),
  ('CD3_HLA_DR', 'CD3+ HLA-DR+ T-lymphocytes (absolute, 10^9/L)'),
  ('CD3_HLA_DR_PRCT', 'CD3+ HLA-DR+ T-lymphocytes (%)'),
  ('CD3_PRCT', 'CD3+ T-lymphocytes (%)'),
  ('CD4', 'CD3+CD4+ T-helpers (absolute, 10^9/L)'),
  ('CD4_CD8_RATIO', 'CD4+/CD8+ Lymphocyte Ratio'),
  ('CD4_PRCT', 'CD3+CD4+ T-helpers (%)'),
  ('CD8', 'CD3+CD8+ Cytotoxic T-lymphocytes (absolute, 10^9/L)'),
  ('CD8_PRCT', 'CD3+CD8+ Cytotoxic T-lymphocytes (%)'),
  ('CEA', 'Carcinoembryonic Antigen (CEA)'),
  ('CHOL', 'Total Cholesterol'),
  ('CHOLINESTERASE', 'Cholinesterase (Butyrylcholinesterase) Activity'),
  ('CK', 'Creatine Kinase'),
  ('CKMB', 'CK-MB'),
  ('CL', 'Chloride'),
  ('CL_ION', 'Ionized Chloride'),
  ('CMV_IGG', 'Cytomegalovirus IgG Antibody'),
  ('CMV_IGM', 'Cytomegalovirus IgM Antibody'),
  ('COAG_END', 'Clotting time - end / coagulation end'),
  ('COAG_START', 'Clotting time - start / coagulation start'),
  ('CORT', 'Cortisol'),
  ('C_PEPTIDE', 'C-Peptide'),
  ('CREA', 'Creatinine'),
  ('CRP', 'C-Reactive Protein'),
  ('DBIL', 'Direct Bilirubin'),
  ('D_DIMER', 'D-dimer'),
  ('DHEA_SULFATE', 'Dehydroepiandrosterone Sulfate (DHEA-S / DHEA-SO4)'),
  ('DOPAMINE', 'Dopamine'),
  ('EBV_NA_IGG', 'Epstein-Barr Virus Nuclear Antigen (EBV-NA) IgG Antibody'),
  ('EBV_VCA_IGA', 'Epstein-Barr Virus VCA IgA Antibody'),
  ('EBV_VCA_IGG', 'Epstein-Barr Virus VCA IgG Antibody'),
  ('EBV_VCA_IGM', 'Epstein-Barr Virus VCA IgM Antibody'),
  ('EGFR', 'Estimated Glomerular Filtration Rate'),
  ('ENTEROBACTERIACEAE', 'Enterobacteriaceae (Enterobacteria) (culture/microbiology identification)'),
  ('ENTEROCOCCUS_SPP', 'Enterococcus species (culture/microbiology identification)'),
  ('EO', 'Eosinophils (absolute)'),
  ('EO_PRCT', 'Eosinophils (%)'),
  ('ESR', 'Erythrocyte Sedimentation Rate'),
  ('ESTRADIOL', 'Estradiol (E2)'),
  ('FE', 'Iron'),
  ('FER', 'Ferritin'),
  ('FIBRINOGEN', 'Fibrinogen'),
  ('FOL', 'Folate'),
  ('FRUC', 'Fructosamine'),
  ('FSH', 'Follicle-Stimulating Hormone (FSH)'),
  ('FT3', 'Free T3'),
  ('FT4', 'Free T4'),
  ('GAMMA_GLOBULINS', 'Gamma Globulins'),
  ('GGT', 'Gamma-Glutamyl Transferase'),
  ('GLIADIN_IGA', 'Gliadin Antibodies IgA (deamidated / native gliadin)'),
  ('GLIADIN_IGG', 'Gliadin Antibodies IgG (deamidated / native gliadin)'),
  ('GLU', 'Glucose'),
  ('HBA1C', 'Hemoglobin A1c'),
  ('HBsAG', 'Hepatitis B surface antigen (HBsAg), qualitative'),
  ('HCT', 'Hematocrit'),
  ('HCV_IGG', 'Hepatitis C Virus Antibodies (Anti-HCV), qualitative'),
  ('HDL', 'HDL Cholesterol'),
  ('HE4', 'Human Epididymis Protein 4 (HE4)'),
  ('HGB', 'Hemoglobin'),
  ('HIV_ANTIBODY', 'HIV Antibodies (screening), qualitative'),
  ('HOMA_IR', 'HOMA-IR (Homeostatic Model Assessment of Insulin Resistance)'),
  ('HOMOCYSTEINE', 'Homocysteine'),
  ('HSV1_IGG', 'Herpes Simplex Virus Type 1 IgG Antibody'),
  ('HSV2_IGG', 'Herpes Simplex Virus Type 2 IgG Antibody'),
  ('IBIL', 'Indirect Bilirubin (Unconjugated Bilirubin)'),
  ('IG_A', 'Immunoglobulin A (IgA)'),
  ('IG_E', 'Total Immunoglobulin E (IgE)'),
  ('IG_G', 'Immunoglobulin G (IgG)'),
  ('IG_M', 'Immunoglobulin M (IgM)'),
  ('INR', 'International Normalized Ratio (INR)'),
  ('INSULIN', 'Insulin'),
  ('K', 'Potassium'),
  ('K_ION', 'Ionized Potassium'),
  ('LDH', 'Lactate Dehydrogenase'),
  ('LDL', 'LDL Cholesterol'),
  ('LH', 'Luteinizing Hormone (LH)'),
  ('LIP', 'Lipase'),
  ('LPA', 'Lipoprotein(a)'),
  ('LUC', 'Large Unstained Cells (absolute)'),
  ('LUC_PRCT', 'Large Unstained Cells (%)'),
  ('LYMPH', 'Lymphocytes (absolute)'),
  ('LYMPH_PRCT', 'Lymphocytes (%)'),
  ('MACROPROLACTIN', 'Macroprolactin (concentration)'),
  ('MACROPROLACTIN_PRCT', 'Macroprolactin (%)'),
  ('MANUAL_DIFF_TOTAL', 'Total Cells Count in Manual Differential (leukocyte formula)'),
  ('MCH', 'Mean Corpuscular Hemoglobin'),
  ('MCHC', 'Mean Corpuscular Hemoglobin Concentration'),
  ('MCV', 'Mean Corpuscular Volume'),
  ('MG', 'Magnesium'),
  ('MICROFLORA_GROWTH', 'Microflora growth (culture result: growth of flora)'),
  ('MONO', 'Monocytes (absolute)'),
  ('MONO_PRCT', 'Monocytes (%)'),
  ('MPV', 'Mean Platelet Volume'),
  ('NA', 'Sodium'),
  ('NA_ION', 'Ionized Sodium'),
  ('NEISSERIA_SUBFLAVA', 'Neisseria subflava (microbial identification)'),
  ('NEUT', 'Neutrophils (absolute)'),
  ('NEUT_BAND', 'Band Neutrophils (absolute)'),
  ('NEUT_BAND_PRCT', 'Band Neutrophils (%)'),
  ('NEUT_PRCT', 'Neutrophils (%)'),
  ('NK', 'NK cells (CD3-CD16+CD56+) (absolute, 10^9/L)'),
  ('NK_PRCT', 'NK cells (CD3-CD16+CD56+) (%)'),
  ('NKT', 'NKT cells (CD3+CD16+CD56+) (absolute, 10^9/L)'),
  ('NKT_PRCT', 'NKT cells (CD3+CD16+CD56+) (%)'),
  ('NONFERMENTING_GRAM_NEG', 'Non-fermenting Gram-negative bacteria (culture/microbiology identification)'),
  ('NON_HDL', 'Non-HDL Cholesterol'),
  ('NOREPINEPHRINE', 'Norepinephrine (Noradrenaline)'),
  ('NSE', 'Neuron-Specific Enolase (NSE)'),
  ('OH17_PROGESTERONE', '17-Hydroxyprogesterone'),
  ('PCT', 'Plateletcrit (PCT)'),
  ('PCTN', 'Procalcitonin'),
  ('PDW', 'Platelet Distribution Width (PDW)'),
  ('PHOS', 'Phosphorus'),
  ('P_LCR', 'Platelet Large Cell Ratio (P-LCR)'),
  ('PLT', 'Platelet Count'),
  ('PROGESTERONE', 'Progesterone'),
  ('PROLACTIN', 'Prolactin'),
  ('PROLACTIN_MONOMER', 'Monomeric Prolactin (concentration)'),
  ('PROLACTIN_MONOMER_PRCT', 'Monomeric Prolactin (%)'),
  ('PROTHROMBIN_ACTIVITY', 'Prothrombin activity (% by Quick method)'),
  ('PSA', 'Prostate Specific Antigen'),
  ('PT', 'Prothrombin Time (PT)'),
  ('RBC', 'Red Blood Cell Count'),
  ('RDW', 'Red Cell Distribution Width'),
  ('RDW_SD', 'Red Cell Distribution Width (SD)'),
  ('RETIC_PRCT', 'Reticulocytes (%)'),
  ('RF_PROD_SPONT', 'Rheumatoid Factor Production (spontaneous) (%)'),
  ('RF_PROD_STIM_FMA', 'Rheumatoid Factor Production (stimulated, FMA) (%)'),
  ('RHEUMATOID_FACTOR', 'Rheumatoid Factor'),
  ('ROMA_POSTMENOPAUSE', 'ROMA Index (postmenopausal)'),
  ('ROMA_PREMENOPAUSE', 'ROMA Index (premenopausal)'),
  ('SARS2_IGG', 'SARS-CoV-2 IgG Antibody'),
  ('SARS2_IGG_N', 'SARS-CoV-2 Nucleocapsid IgG Antibody (semiquantitative, ELISA)'),
  ('SARS2_IGG_S', 'SARS-CoV-2 Spike (S) Protein IgG Antibody (semiquantitative, ELISA)'),
  ('SARS2_IGM', 'SARS-CoV-2 IgM Antibody'),
  ('SHBG', 'Sex Hormone-Binding Globulin (SHBG)'),
  ('STAPHYLOCOCCUS_SPP', 'Staphylococcus species (culture/microbiology identification)'),
  ('STREPTOCOCCUS_AGALACTIAE', 'Streptococcus agalactiae (Group B) (culture/microbiology identification)'),
  ('SYPH_IGG', 'Treponema pallidum Antibodies (syphilis), qualitative (ELISA)'),
  ('T3', 'Triiodothyronine'),
  ('T4', 'Thyroxine'),
  ('TBIL', 'Total Bilirubin'),
  ('TCD28', 'T-lymphocytes (CD28+) (absolute, 10^9/L)'),
  ('TCD28_PRCT', 'T-lymphocytes (CD28+) (%)'),
  ('TESTOSTERONE_FREE', 'Free Testosterone'),
  ('TESTOSTERONE_TOTAL', 'Total Testosterone'),
  ('TG', 'Thyroglobulin (TG)'),
  ('TG2_IGA', 'Tissue Transglutaminase (tTG, neoepitope) IgA Antibodies'),
  ('TG2_IGG', 'Tissue Transglutaminase (tTG, neoepitope) IgG Antibodies'),
  ('THROMBIN_TIME', 'Thrombin Time (TT)'),
  ('THROMBIN_TIME_RATIO', 'Thrombin Time Ratio'),
  ('TIBC', 'Total Iron Binding Capacity'),
  ('TOXO_IGG', 'Toxoplasma gondii IgG Antibody'),
  ('TOXO_IGM', 'Toxoplasma gondii IgM Antibody'),
  ('TP', 'Total Protein'),
  ('TPO_AB', 'Thyroid Peroxidase Antibodies (TPO Ab)'),
  ('TRANSFERRIN', 'Transferrin'),
  ('TREG', 'T-regulatory cells (CD4+CD25hiCD127-) (absolute, 10^9/L)'),
  ('TREG_PRCT', 'T-regulatory cells (CD4+CD25hiCD127-) (%)'),
  ('TRIG', 'Triglycerides'),
  ('TROP', 'Troponin I'),
  ('TSAT', 'Transferrin Saturation'),
  ('TSH', 'Thyroid Stimulating Hormone'),
  ('UA', 'Uric Acid'),
  ('URINE_AMMONIUM_BIURATE', 'Urine Ammonium Biurate Crystals'),
  ('URINE_BACTERIA', 'Urine Bacteria (microscopy)'),
  ('URINE_BIL', 'Urine Bilirubin'),
  ('URINE_CALCIUM_PHOSPHATE_CRYSTALS', 'Urine Calcium Phosphate Crystals'),
  ('URINE_CASTS', 'Urine Casts (cylinders)'),
  ('URINE_CASTS_HYALINE', 'Hyaline casts (urine)'),
  ('URINE_CASTS_NON_HYALINE', 'Non-hyaline Urine Casts'),
  ('URINE_COLOR', 'Urine Color'),
  ('URINE_CRYSTALS', 'Urine Crystals / Salts'),
  ('URINE_CRYSTALS_OXALATE', 'Urine Calcium Oxalate Crystals'),
  ('URINE_CULTURE_AB_SENS', 'Urine Bacterial Culture with Antibiotic Sensitivity'),
  ('URINE_EPIT', 'Urine Epithelial Cells (sediment)'),
  ('URINE_EPIT_NONPLAT', 'Urine Non-squamous Epithelial Cells (sediment)'),
  ('URINE_EPIT_PLAT', 'Urine Squamous Epithelial Cells (sediment)'),
  ('URINE_EPIT_RENAL', 'Urine Renal (Renal Tubular) Epithelial Cells (sediment)'),
  ('URINE_EPIT_TRANS', 'Urine Transitional Epithelial Cells (sediment)'),
  ('URINE_GLUC', 'Urine Glucose'),
  ('URINE_HGB', 'Urine Hemoglobin'),
  ('URINE_INTACT_RBC', 'Urine Intact (Non-lysed) Red Blood Cells'),
  ('URINE_KET', 'Urine Ketones'),
  ('URINE_LEUKOCYTE_ESTERASE', 'Urine Leukocyte Esterase'),
  ('URINE_MUCUS', 'Urine Mucus (sediment)'),
  ('URINE_MUCUS_SED', 'Mucus (urine sediment)'),
  ('URINE_NIT', 'Urine Nitrites'),
  ('URINE_NORMAL_FLORA', 'Normal Flora (urine culture/microscopy)'),
  ('URINE_PH', 'Urine pH'),
  ('URINE_PROT', 'Urine Protein'),
  ('URINE_RBC', 'Urine Red Blood Cells'),
  ('URINE_RBC_HGB', 'Urine Red Blood Cells and Hemoglobin (urine haematuria/hemoglobin)'),
  ('URINE_SED_RBC', 'Urine Sediment Erythrocytes'),
  ('URINE_SED_WBC', 'Urine Sediment Leukocytes'),
  ('URINE_SG', 'Urine Specific Gravity'),
  ('URINE_SPERM', 'Spermatozoa in Urine (sediment)'),
  ('URINE_TRIPLE_PHOSPHATE_CRYSTALS', 'Urine Triple Phosphate (Struvite) Crystals'),
  ('URINE_TURBIDITY', 'Urine Transparency/Turbidity'),
  ('URINE_UBG', 'Urine Urobilinogen'),
  ('URINE_URATES', 'Urine Urate Crystals'),
  ('URINE_URIC_ACID_CRYSTALS', 'Urine Uric Acid Crystals'),
  ('URINE_UROBILIN', 'Urine Urobilin'),
  ('URINE_WBC', 'Urine Leukocytes (WBC)'),
  ('URINE_WBC_CLUSTERS', 'Urine Leukocyte Aggregates / WBC Clusters (urine sediment)'),
  ('URINE_YEAST', 'Urine Yeast (fungi, microscopy)'),
  ('VITB12', 'Vitamin B12'),
  ('VITD', 'Vitamin D (25-OH)'),
  ('VLDL', 'VLDL Cholesterol'),
  ('WBC', 'White Blood Cell Count')
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- ANALYTE ALIASES (Multilingual: English, Russian, Ukrainian + variants)
-- ============================================================================

INSERT INTO analyte_aliases (analyte_id, alias, lang, confidence, source) VALUES
  -- Adrenocorticotropic Hormone (ACTH) (ACTH)
  ((SELECT analyte_id FROM analytes WHERE code = 'ACTH'), 'адренокортикотропный гормон (актг)', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ACTH'), 'adrenocorticotropic hormone (acth)', 'en', 1, 'seed'),

  -- Adrenaline (Epinephrine) (ADRENALINE)
  ((SELECT analyte_id FROM analytes WHERE code = 'ADRENALINE'), 'адреналин', 'ru', 1, 'seed'),

  -- Alpha-Fetoprotein (AFP) (AFP)
  ((SELECT analyte_id FROM analytes WHERE code = 'AFP'), 'альфа фетопротеин afp', 'ru', 1, 'seed'),

  -- Atherogenic Index (Atherogenicity Index) (AI)
  ((SELECT analyte_id FROM analytes WHERE code = 'AI'), 'индекс атерогенности', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'AI'), 'индекс атерогенности atherogenity index', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'AI'), 'ка', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'AI'), 'коэффициент атерогенности', 'ru', 1, 'llm_semantic_match'),

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

  -- Alpha-1 Globulins (ALPHA1_GLOBULINS)
  ((SELECT analyte_id FROM analytes WHERE code = 'ALPHA1_GLOBULINS'), 'альфа-1-глобулины', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ALPHA1_GLOBULINS'), 'alpha-1 globulins', 'en', 1, 'seed'),

  -- Alpha-2 Globulins (ALPHA2_GLOBULINS)
  ((SELECT analyte_id FROM analytes WHERE code = 'ALPHA2_GLOBULINS'), 'альфа-2-глобулины', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ALPHA2_GLOBULINS'), 'alpha-2 globulins', 'en', 1, 'seed'),

  -- Alanine Aminotransferase (ALT)
  ((SELECT analyte_id FROM analytes WHERE code = 'ALT'), 'alanine aminotransferase', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ALT'), 'alt', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ALT'), 'alt sgpt', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ALT'), 'sgpt', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ALT'), 'аланинаминотрансфераза', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ALT'), 'алт', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ALT'), 'алт gрт', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ALT'), 'аланін амінотрансфераза', 'uk', 1, 'seed'),

  -- Amylase (AMY)
  ((SELECT analyte_id FROM analytes WHERE code = 'AMY'), 'amy', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'AMY'), 'amylase', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'AMY'), 'альфа амилаза', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'AMY'), 'альфа амилаза a amylase', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'AMY'), 'амилаза', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'AMY'), 'панкреатическая амилаза', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'AMY'), 'аміла за', 'uk', 1, 'seed'),

  -- Anti-Müllerian Hormone (AMH) (ANTI_MULLERIAN_HORMONE)
  ((SELECT analyte_id FROM analytes WHERE code = 'ANTI_MULLERIAN_HORMONE'), 'антимюллеров гормон', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ANTI_MULLERIAN_HORMONE'), 'анти-мюллеров гормон (амг)', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ANTI_MULLERIAN_HORMONE'), 'anti-müllerian hormone (amh)', 'en', 1, 'seed'),

  -- Antithrombin III activity (%) (ANTITHROMBIN_III)
  ((SELECT analyte_id FROM analytes WHERE code = 'ANTITHROMBIN_III'), 'антитромбин iii', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ANTITHROMBIN_III'), 'антитромбин iii (antitrombin)', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ANTITHROMBIN_III'), 'антитромбин iii, % активности', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ANTITHROMBIN_III'), 'antithrombin iii activity (%)', 'en', 1, 'seed'),

  -- Apolipoprotein A1 (APOA1)
  ((SELECT analyte_id FROM analytes WHERE code = 'APOA1'), 'аполипопротеин a1', 'ru', 1, 'seed'),

  -- Apolipoprotein B (APOB)
  ((SELECT analyte_id FROM analytes WHERE code = 'APOB'), 'аполипопротеин b', 'ru', 1, 'seed'),

  -- Apolipoprotein B / Apolipoprotein A1 Ratio (APOB_APOA1)
  ((SELECT analyte_id FROM analytes WHERE code = 'APOB_APOA1'), 'апо в апо а1', 'ru', 1, 'seed'),

  -- Activated Partial Thromboplastin Time (APTT) (APTT)
  ((SELECT analyte_id FROM analytes WHERE code = 'APTT'), 'активированное частичное тромбопластиновое время ачтв', 'ru', 1, 'seed'),

  -- APTT Ratio (APTT_RATIO)
  ((SELECT analyte_id FROM analytes WHERE code = 'APTT_RATIO'), 'ачтв ratio', 'ru', 1, 'seed'),

  -- Antistreptolysin O (ASO) / Antistreptolysin O titer (ASLO)
  ((SELECT analyte_id FROM analytes WHERE code = 'ASLO'), 'асл о', 'ru', 1, 'seed'),

  -- Aspartate Aminotransferase (AST)
  ((SELECT analyte_id FROM analytes WHERE code = 'AST'), 'aspartate aminotransferase', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'AST'), 'ast', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'AST'), 'ast sgot', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'AST'), 'sgot', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'AST'), 'аспартатаминотрансфераза', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'AST'), 'аст', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'AST'), 'аст got', 'ru', 1, 'llm_semantic_match'),

  -- B1-lymphocytes (CD19+CD5+) (absolute, 10^9/L) (B1)
  ((SELECT analyte_id FROM analytes WHERE code = 'B1'), 'b1-lymphocytes (cd19+cd5+) (absolute, 10^9/l)', 'en', 1, 'seed'),

  -- B1-lymphocytes (CD19+CD5+) (%) (B1_PRCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'B1_PRCT'), 'b1-lymphocytes (cd19+cd5+) (%)', 'en', 1, 'seed'),

  -- Basophils (absolute) (BASO)
  ((SELECT analyte_id FROM analytes WHERE code = 'BASO'), 'базофилы baso', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'BASO'), 'базофилы абс', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'BASO'), 'базофилы х10⁹ л', 'ru', 1, 'llm_semantic_match'),

  -- Basophils (%) (BASO_PRCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'BASO_PRCT'), 'базофилы', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'BASO_PRCT'), 'базофилы baso', 'ru', 1, 'seed'),

  -- Beta Globulins (BETA_GLOBULINS)
  ((SELECT analyte_id FROM analytes WHERE code = 'BETA_GLOBULINS'), 'бета-глобулины', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'BETA_GLOBULINS'), 'beta globulins', 'en', 1, 'seed'),

  -- Memory B-cells (absolute, 10^9/L) (B_MEMORY)
  ((SELECT analyte_id FROM analytes WHERE code = 'B_MEMORY'), 'в клетки памяти,*10^9/л', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'B_MEMORY'), 'memory b-cells (absolute, 10^9/l)', 'en', 1, 'seed'),

  -- Memory B-cells (%) (B_MEMORY_PRCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'B_MEMORY_PRCT'), 'в-клетки памяти, %', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'B_MEMORY_PRCT'), 'memory b-cells (%)', 'en', 1, 'seed'),

  -- B-type Natriuretic Peptide (BNP)
  ((SELECT analyte_id FROM analytes WHERE code = 'BNP'), 'bnp', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'BNP'), 'b type natriuretic peptide', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'BNP'), 'натрийуретический пептид', 'ru', 1, 'seed'),

  -- Blood Urea Nitrogen (BUN)
  ((SELECT analyte_id FROM analytes WHERE code = 'BUN'), 'blood urea nitrogen', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'BUN'), 'bun', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'BUN'), 'urea', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'BUN'), 'мочевина', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'BUN'), 'мочевина urea', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'BUN'), 'сечовина', 'uk', 1, 'seed'),

  -- Complement C3 (C3)
  ((SELECT analyte_id FROM analytes WHERE code = 'C3'), 'комплемент с3с', 'ru', 1, 'seed'),

  -- Complement C4 (C4)
  ((SELECT analyte_id FROM analytes WHERE code = 'C4'), 'комплемент с4', 'ru', 1, 'seed'),

  -- Calcium (CA)
  ((SELECT analyte_id FROM analytes WHERE code = 'CA'), 'ca', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CA'), 'calcium', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CA'), 'кальций', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CA'), 'кальций общий', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CA'), 'общий кальций total calcium', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CA'), 'кальцій', 'uk', 1, 'seed'),

  -- Cancer Antigen 125 (CA 125) (CA125)
  ((SELECT analyte_id FROM analytes WHERE code = 'CA125'), 'ca 125', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CA125'), 'са 125', 'ru', 1, 'llm_semantic_match'),

  -- Cancer Antigen 15-3 (CA 15-3) (CA15_3)
  ((SELECT analyte_id FROM analytes WHERE code = 'CA15_3'), 'онкомаркер молочной железы (са 15-3)', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CA15_3'), 'cancer antigen 15-3 (ca 15-3)', 'en', 1, 'seed'),

  -- Cancer Antigen 19-9 (CA 19-9) (CA19_9)
  ((SELECT analyte_id FROM analytes WHERE code = 'CA19_9'), 'ca 19 9', 'en', 1, 'seed'),

  -- Cancer Antigen 72-4 (CA 72-4) (CA72_4)
  ((SELECT analyte_id FROM analytes WHERE code = 'CA72_4'), 'ра 72 4 ca 72 4', 'ru', 1, 'seed'),

  -- Ionized Calcium (CA_ION)
  ((SELECT analyte_id FROM analytes WHERE code = 'CA_ION'), 'кальций ионизированный', 'ru', 1, 'seed'),

  -- Calcitonin (CALCITONIN)
  ((SELECT analyte_id FROM analytes WHERE code = 'CALCITONIN'), 'кальцитонин calcitonin', 'ru', 1, 'seed'),

  -- Candida species (fungi) (culture/microbiology identification) (CANDIDA_SPP)
  ((SELECT analyte_id FROM analytes WHERE code = 'CANDIDA_SPP'), 'грибы рода candida', 'ru', 1, 'seed'),

  -- CD19+ B-lymphocytes (absolute, 10^9/L) (CD19)
  ((SELECT analyte_id FROM analytes WHERE code = 'CD19'), 'в лимфоциты cd19 10 9 л', 'ru', 1, 'seed'),

  -- CD19+ B-lymphocytes (%) (CD19_PRCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'CD19_PRCT'), 'в лимфоциты cd19', 'ru', 1, 'seed'),

  -- CD3+ T-lymphocytes (absolute, 10^9/L) (CD3)
  ((SELECT analyte_id FROM analytes WHERE code = 'CD3'), 'т лимфоциты cd3 10 9 л', 'ru', 1, 'seed'),

  -- CD3+ HLA-DR+ T-lymphocytes (absolute, 10^9/L) (CD3_HLA_DR)
  ((SELECT analyte_id FROM analytes WHERE code = 'CD3_HLA_DR'), 'cd3 hla dr t лимфоциты 10 9 л', 'ru', 1, 'seed'),

  -- CD3+ HLA-DR+ T-lymphocytes (%) (CD3_HLA_DR_PRCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'CD3_HLA_DR_PRCT'), 'cd3 hla dr t лимфоциты', 'ru', 1, 'seed'),

  -- CD3+ T-lymphocytes (%) (CD3_PRCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'CD3_PRCT'), 'т лимфоциты cd3', 'ru', 1, 'seed'),

  -- CD3+CD4+ T-helpers (absolute, 10^9/L) (CD4)
  ((SELECT analyte_id FROM analytes WHERE code = 'CD4'), 'т хелперы cd3 cd4 10 9 л', 'ru', 1, 'seed'),

  -- CD4+/CD8+ Lymphocyte Ratio (CD4_CD8_RATIO)
  ((SELECT analyte_id FROM analytes WHERE code = 'CD4_CD8_RATIO'), 'соотношение лимфоцитов cd4 cd8', 'ru', 1, 'seed'),

  -- CD3+CD4+ T-helpers (%) (CD4_PRCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'CD4_PRCT'), 'т хелперы cd3 cd4', 'ru', 1, 'seed'),

  -- CD3+CD8+ Cytotoxic T-lymphocytes (absolute, 10^9/L) (CD8)
  ((SELECT analyte_id FROM analytes WHERE code = 'CD8'), 'цитототоксические т лимфоциты сd3 сd8 10 9 л', 'ru', 1, 'seed'),

  -- CD3+CD8+ Cytotoxic T-lymphocytes (%) (CD8_PRCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'CD8_PRCT'), 'цитототоксические т лимфоциты сd3 сd8', 'ru', 1, 'seed'),

  -- Carcinoembryonic Antigen (CEA) (CEA)
  ((SELECT analyte_id FROM analytes WHERE code = 'CEA'), 'рэа cea', 'ru', 1, 'seed'),

  -- Total Cholesterol (CHOL)
  ((SELECT analyte_id FROM analytes WHERE code = 'CHOL'), 'chol', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CHOL'), 'cholesterol', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CHOL'), 'total cholesterol', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CHOL'), 'общий холестерин', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CHOL'), 'холестерин', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CHOL'), 'холестерин cholesterol', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CHOL'), 'загальний холестерин', 'uk', 1, 'seed'),

  -- Cholinesterase (Butyrylcholinesterase) Activity (CHOLINESTERASE)
  ((SELECT analyte_id FROM analytes WHERE code = 'CHOLINESTERASE'), 'холинэстераза', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CHOLINESTERASE'), 'cholinesterase (butyrylcholinesterase) activity', 'en', 1, 'seed'),

  -- Creatine Kinase (CK)
  ((SELECT analyte_id FROM analytes WHERE code = 'CK'), 'ck', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CK'), 'cpk', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CK'), 'creatine kinase', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CK'), 'креатинкиназа', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CK'), 'креатинкиназа total ck', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CK'), 'креатинфосфокиназа кфк', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CK'), 'кфк', 'ru', 1, 'seed'),

  -- CK-MB (CKMB)
  ((SELECT analyte_id FROM analytes WHERE code = 'CKMB'), 'ck mb', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CKMB'), 'ckmb', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CKMB'), 'creatine kinase mb', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CKMB'), 'кфк мв', 'ru', 1, 'seed'),

  -- Chloride (CL)
  ((SELECT analyte_id FROM analytes WHERE code = 'CL'), 'chloride', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CL'), 'cl', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CL'), 'хлор', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CL'), 'хлор chlorine', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CL'), 'хлориды', 'ru', 1, 'seed'),

  -- Ionized Chloride (CL_ION)
  ((SELECT analyte_id FROM analytes WHERE code = 'CL_ION'), 'хлор ионизированный', 'ru', 1, 'seed'),

  -- Cytomegalovirus IgG Antibody (CMV_IGG)
  ((SELECT analyte_id FROM analytes WHERE code = 'CMV_IGG'), 'цитомегаловирус igg', 'ru', 1, 'seed'),

  -- Cytomegalovirus IgM Antibody (CMV_IGM)
  ((SELECT analyte_id FROM analytes WHERE code = 'CMV_IGM'), 'цитомегаловирус igm', 'ru', 1, 'seed'),

  -- Clotting time - end / coagulation end (COAG_END)
  ((SELECT analyte_id FROM analytes WHERE code = 'COAG_END'), 'свертываемость крови конец', 'ru', 1, 'seed'),

  -- Clotting time - start / coagulation start (COAG_START)
  ((SELECT analyte_id FROM analytes WHERE code = 'COAG_START'), 'свертываемость крови начало', 'ru', 1, 'seed'),

  -- Cortisol (CORT)
  ((SELECT analyte_id FROM analytes WHERE code = 'CORT'), 'кортизол', 'ru', 1, 'seed'),

  -- C-Peptide (C_PEPTIDE)
  ((SELECT analyte_id FROM analytes WHERE code = 'C_PEPTIDE'), 'с пептид', 'ru', 1, 'seed'),

  -- Creatinine (CREA)
  ((SELECT analyte_id FROM analytes WHERE code = 'CREA'), 'cr', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CREA'), 'crea', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CREA'), 'creatinine', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CREA'), 'креатинин', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CREA'), 'креатинин creatinine', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CREA'), 'креатінін', 'uk', 1, 'seed'),

  -- C-Reactive Protein (CRP)
  ((SELECT analyte_id FROM analytes WHERE code = 'CRP'), 'c reactive protein', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CRP'), 'crp', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CRP'), 'c реактивный белок высокочувствительный hs crp', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CRP'), 'срб', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CRP'), 'срб crp', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CRP'), 'с реактивный белок', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'CRP'), 'с реактивний білок', 'uk', 1, 'seed'),

  -- Direct Bilirubin (DBIL)
  ((SELECT analyte_id FROM analytes WHERE code = 'DBIL'), 'bilirubin direct', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'DBIL'), 'dbil', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'DBIL'), 'direct bilirubin', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'DBIL'), 'билирубин прямой', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'DBIL'), 'билирубин прямой direct bilirubin', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'DBIL'), 'прямой билирубин', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'DBIL'), 'прямий білірубін', 'uk', 1, 'seed'),

  -- D-dimer (D_DIMER)
  ((SELECT analyte_id FROM analytes WHERE code = 'D_DIMER'), 'd димер', 'ru', 1, 'seed'),

  -- Dehydroepiandrosterone Sulfate (DHEA-S / DHEA-SO4) (DHEA_SULFATE)
  ((SELECT analyte_id FROM analytes WHERE code = 'DHEA_SULFATE'), 'дэа - so4', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'DHEA_SULFATE'), 'dehydroepiandrosterone sulfate (dhea-s / dhea-so4)', 'en', 1, 'seed'),

  -- Dopamine (DOPAMINE)
  ((SELECT analyte_id FROM analytes WHERE code = 'DOPAMINE'), 'дофамин', 'ru', 1, 'seed'),

  -- Epstein-Barr Virus Nuclear Antigen (EBV-NA) IgG Antibody (EBV_NA_IGG)
  ((SELECT analyte_id FROM analytes WHERE code = 'EBV_NA_IGG'), 'ат к ядерному антигену вируса эпштейн барр igg anti ebv na igg i125', 'ru', 1, 'seed'),

  -- Epstein-Barr Virus VCA IgA Antibody (EBV_VCA_IGA)
  ((SELECT analyte_id FROM analytes WHERE code = 'EBV_VCA_IGA'), 'вирус эпштейна барр капсидный антиген vca iga', 'ru', 1, 'seed'),

  -- Epstein-Barr Virus VCA IgG Antibody (EBV_VCA_IGG)
  ((SELECT analyte_id FROM analytes WHERE code = 'EBV_VCA_IGG'), 'вирус эпштейна барр капсидный антиген vca igg', 'ru', 1, 'seed'),

  -- Epstein-Barr Virus VCA IgM Antibody (EBV_VCA_IGM)
  ((SELECT analyte_id FROM analytes WHERE code = 'EBV_VCA_IGM'), 'вирус эпштейна барр капсидный антиген vca igm', 'ru', 1, 'seed'),

  -- Estimated Glomerular Filtration Rate (EGFR)
  ((SELECT analyte_id FROM analytes WHERE code = 'EGFR'), 'egfr', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'EGFR'), 'gfr', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'EGFR'), 'glomerular filtration rate', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'EGFR'), 'скф', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'EGFR'), 'рсфк', 'uk', 1, 'seed'),

  -- Enterobacteriaceae (Enterobacteria) (culture/microbiology identification) (ENTEROBACTERIACEAE)
  ((SELECT analyte_id FROM analytes WHERE code = 'ENTEROBACTERIACEAE'), 'энтеробактерии', 'ru', 1, 'seed'),

  -- Enterococcus species (culture/microbiology identification) (ENTEROCOCCUS_SPP)
  ((SELECT analyte_id FROM analytes WHERE code = 'ENTEROCOCCUS_SPP'), 'enterococcus spp', 'en', 1, 'seed'),

  -- Eosinophils (absolute) (EO)
  ((SELECT analyte_id FROM analytes WHERE code = 'EO'), 'эозинофилы eo', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'EO'), 'эозинофилы абс', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'EO'), 'эозинофилы х10⁹ л', 'ru', 1, 'llm_semantic_match'),

  -- Eosinophils (%) (EO_PRCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'EO_PRCT'), 'эозинофилы eo', 'ru', 1, 'seed'),

  -- Erythrocyte Sedimentation Rate (ESR)
  ((SELECT analyte_id FROM analytes WHERE code = 'ESR'), 'erythrocyte sedimentation rate', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ESR'), 'esr', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ESR'), 'sed rate', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ESR'), 'скорость оседания эритроцитов', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ESR'), 'скорость оседания эритроцитов соэ метод вестергрена', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ESR'), 'скорость оседания эритроцитов соэ метод измерения кинетики агрегации эритроцитов', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ESR'), 'скорость оседания эритроцитов соэ метод панченкова', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ESR'), 'соэ', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ESR'), 'соэ метод кинетики агрегации эритроцитов', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ESR'), 'швидкість осідання еритроцитів', 'uk', 1, 'seed'),

  -- Estradiol (E2) (ESTRADIOL)
  ((SELECT analyte_id FROM analytes WHERE code = 'ESTRADIOL'), 'эстрадиол', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ESTRADIOL'), 'estradiol (e2)', 'en', 1, 'seed'),

  -- Iron (FE)
  ((SELECT analyte_id FROM analytes WHERE code = 'FE'), 'fe', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FE'), 'iron', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FE'), 'serum iron', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FE'), 'железо', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FE'), 'железо сыворотки', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FE'), 'железо сывороточное', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FE'), 'сывороточное железо serum iron', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FE'), 'залізо', 'uk', 1, 'seed'),

  -- Ferritin (FER)
  ((SELECT analyte_id FROM analytes WHERE code = 'FER'), 'fer', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FER'), 'ferritin', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FER'), 'феретинн', 'ru', 0.8, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FER'), 'феритин', 'ru', 0.85, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FER'), 'ферритин', 'ru', 1, 'seed'),

  -- Fibrinogen (FIBRINOGEN)
  ((SELECT analyte_id FROM analytes WHERE code = 'FIBRINOGEN'), 'фибриноген', 'ru', 1, 'seed'),

  -- Folate (FOL)
  ((SELECT analyte_id FROM analytes WHERE code = 'FOL'), 'folate', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FOL'), 'folic acid', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FOL'), 'фолаты', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FOL'), 'фолиевая кислота', 'ru', 1, 'seed'),

  -- Fructosamine (FRUC)
  ((SELECT analyte_id FROM analytes WHERE code = 'FRUC'), 'fructosamine', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FRUC'), 'фруктозамин', 'ru', 1, 'seed'),

  -- Follicle-Stimulating Hormone (FSH) (FSH)
  ((SELECT analyte_id FROM analytes WHERE code = 'FSH'), 'фолликулостимулирующий гормон (фсг)', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FSH'), 'фсг', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FSH'), 'follicle-stimulating hormone (fsh)', 'en', 1, 'seed'),

  -- Free T3 (FT3)
  ((SELECT analyte_id FROM analytes WHERE code = 'FT3'), 'free t3', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FT3'), 'free triiodothyronine', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FT3'), 'ft3', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FT3'), 'свободный т3', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FT3'), 'трийодтиронин свободный т3 св', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FT3'), 'вільний т3', 'uk', 1, 'seed'),

  -- Free T4 (FT4)
  ((SELECT analyte_id FROM analytes WHERE code = 'FT4'), 'free t4', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FT4'), 'free thyroxine', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FT4'), 'ft4', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FT4'), 'свободный т4', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FT4'), 'тироксин свободный т4 св', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'FT4'), 'вільний т4', 'uk', 1, 'seed'),

  -- Gamma Globulins (GAMMA_GLOBULINS)
  ((SELECT analyte_id FROM analytes WHERE code = 'GAMMA_GLOBULINS'), 'гамма-глобулины', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'GAMMA_GLOBULINS'), 'gamma globulins', 'en', 1, 'seed'),

  -- Gamma-Glutamyl Transferase (GGT)
  ((SELECT analyte_id FROM analytes WHERE code = 'GGT'), 'gamma glutamyl transferase', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'GGT'), 'ggt', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'GGT'), 'ggtp', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'GGT'), 'гамма глутаматтрансфераза ггт', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'GGT'), 'гамма глутамилтрансфераза', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'GGT'), 'ггт', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'GGT'), 'ггт ggt', 'ru', 1, 'llm_semantic_match'),

  -- Gliadin Antibodies IgA (deamidated / native gliadin) (GLIADIN_IGA)
  ((SELECT analyte_id FROM analytes WHERE code = 'GLIADIN_IGA'), 'глиадин, антитела igа', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'GLIADIN_IGA'), 'gliadin antibodies iga (deamidated / native gliadin)', 'en', 1, 'seed'),

  -- Gliadin Antibodies IgG (deamidated / native gliadin) (GLIADIN_IGG)
  ((SELECT analyte_id FROM analytes WHERE code = 'GLIADIN_IGG'), 'глиадин, антитела igg', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'GLIADIN_IGG'), 'gliadin antibodies igg (deamidated / native gliadin)', 'en', 1, 'seed'),

  -- Glucose (GLU)
  ((SELECT analyte_id FROM analytes WHERE code = 'GLU'), 'blood glucose', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'GLU'), 'glu', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'GLU'), 'glucose', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'GLU'), 'глюкоза', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'GLU'), 'глюкоза из венозной крови', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'GLU'), 'глюкоза из капиллярной крови', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'GLU'), 'глюкоза крови', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'GLU'), 'глюкоза (кровь)', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'GLU'), 'глюкоза сыворотка', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'GLU'), 'глюкоза крові', 'uk', 1, 'seed'),

  -- Hemoglobin A1c (HBA1C)
  ((SELECT analyte_id FROM analytes WHERE code = 'HBA1C'), 'a1c', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HBA1C'), 'glycated hemoglobin', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HBA1C'), 'hba1c', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HBA1C'), 'hemoglobin a1c', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HBA1C'), 'hba1c гликированный hb', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HBA1C'), 'гликированный гемоглобин', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HBA1C'), 'Гликированный гемоглобин', 'ru', 1, 'manual'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HBA1C'), 'гликогемоглобин', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HBA1C'), 'гликозилированный гемоглобин hba1c', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HBA1C'), 'глікований гемоглобін', 'uk', 1, 'seed'),

  -- Hepatitis B surface antigen (HBsAg), qualitative (HBsAG)
  ((SELECT analyte_id FROM analytes WHERE code = 'HBsAG'), 'hbsag австралийский антиген', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HBsAG'), 'hbsag австралийский антиген поверхностный качеств', 'ru', 1, 'seed'),

  -- Hematocrit (HCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'HCT'), 'hct', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HCT'), 'hematocrit', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HCT'), 'гематокрит', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HCT'), 'гематокрит (hct)', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HCT'), 'гематокріт', 'uk', 1, 'seed'),

  -- Hepatitis C Virus Antibodies (Anti-HCV), qualitative (HCV_IGG)
  ((SELECT analyte_id FROM analytes WHERE code = 'HCV_IGG'), 'антитела к гепатиту с', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HCV_IGG'), 'вирус гепатита с anti hcv антитела качеств', 'ru', 1, 'seed'),

  -- HDL Cholesterol (HDL)
  ((SELECT analyte_id FROM analytes WHERE code = 'HDL'), 'hdl', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HDL'), 'hdl c', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HDL'), 'hdl cholesterol', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HDL'), 'лпвп', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HDL'), 'холестерин липопротеинов высокой плотности hdl chol esterol', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HDL'), 'холестерин липопротеинов высокой плотности лпвп', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HDL'), 'холестерин лпвп', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HDL'), 'хс лпвп', 'ru', 1, 'seed'),

  -- Human Epididymis Protein 4 (HE4) (HE4)
  ((SELECT analyte_id FROM analytes WHERE code = 'HE4'), 'hе4', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HE4'), 'he4', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HE4'), 'human epididymis protein 4 (he4)', 'en', 1, 'seed'),

  -- Hemoglobin (HGB)
  ((SELECT analyte_id FROM analytes WHERE code = 'HGB'), 'hb', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HGB'), 'hemoglobin', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HGB'), 'hgb', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HGB'), 'гемоглоб', 'ru', 0.9, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HGB'), 'гемоглобин', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HGB'), 'гемоглобин hb г л', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HGB'), 'гемоглобин (hgb)', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HGB'), 'гемоглобін', 'uk', 1, 'seed'),

  -- HIV Antibodies (screening), qualitative (HIV_ANTIBODY)
  ((SELECT analyte_id FROM analytes WHERE code = 'HIV_ANTIBODY'), 'исследование клинического материала на вич спид', 'ru', 1, 'seed'),

  -- HOMA-IR (Homeostatic Model Assessment of Insulin Resistance) (HOMA_IR)
  ((SELECT analyte_id FROM analytes WHERE code = 'HOMA_IR'), 'индекс homa ir', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HOMA_IR'), 'индекс нома ir', 'ru', 1, 'llm_semantic_match'),

  -- Homocysteine (HOMOCYSTEINE)
  ((SELECT analyte_id FROM analytes WHERE code = 'HOMOCYSTEINE'), 'hcy', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HOMOCYSTEINE'), 'homocysteine', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HOMOCYSTEINE'), 'гомоцистеин', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'HOMOCYSTEINE'), 'гомоцистеин 06 016', 'ru', 1, 'llm_semantic_match'),

  -- Herpes Simplex Virus Type 1 IgG Antibody (HSV1_IGG)
  ((SELECT analyte_id FROM analytes WHERE code = 'HSV1_IGG'), 'вирус простого герпеса 1 типа igg', 'ru', 1, 'seed'),

  -- Herpes Simplex Virus Type 2 IgG Antibody (HSV2_IGG)
  ((SELECT analyte_id FROM analytes WHERE code = 'HSV2_IGG'), 'вирус простого герпеса 2 типа igg', 'ru', 1, 'seed'),

  -- Indirect Bilirubin (Unconjugated Bilirubin) (IBIL)
  ((SELECT analyte_id FROM analytes WHERE code = 'IBIL'), 'билирубин непрямой', 'ru', 1, 'seed'),

  -- Immunoglobulin A (IgA) (IG_A)
  ((SELECT analyte_id FROM analytes WHERE code = 'IG_A'), 'иммуноглобулин a', 'ru', 1, 'seed'),

  -- Total Immunoglobulin E (IgE) (IG_E)
  ((SELECT analyte_id FROM analytes WHERE code = 'IG_E'), 'общий иммуноглобулин e', 'ru', 1, 'seed'),

  -- Immunoglobulin G (IgG) (IG_G)
  ((SELECT analyte_id FROM analytes WHERE code = 'IG_G'), 'иммуноглобулин g', 'ru', 1, 'seed'),

  -- Immunoglobulin M (IgM) (IG_M)
  ((SELECT analyte_id FROM analytes WHERE code = 'IG_M'), 'иммуноглобулин m', 'ru', 1, 'seed'),

  -- International Normalized Ratio (INR) (INR)
  ((SELECT analyte_id FROM analytes WHERE code = 'INR'), 'мно', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'INR'), 'мно inr', 'ru', 1, 'seed'),

  -- Insulin (INSULIN)
  ((SELECT analyte_id FROM analytes WHERE code = 'INSULIN'), 'инсулин', 'ru', 1, 'seed'),

  -- Potassium (K)
  ((SELECT analyte_id FROM analytes WHERE code = 'K'), 'k', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'K'), 'potassium', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'K'), 'калий', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'K'), 'калий potassium', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'K'), 'калій', 'uk', 1, 'seed'),

  -- Ionized Potassium (K_ION)
  ((SELECT analyte_id FROM analytes WHERE code = 'K_ION'), 'калий ионизированный', 'ru', 1, 'seed'),

  -- Lactate Dehydrogenase (LDH)
  ((SELECT analyte_id FROM analytes WHERE code = 'LDH'), 'lactate dehydrogenase', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'LDH'), 'ldh', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'LDH'), 'лактатдегидрогеназа', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'LDH'), 'лдг', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'LDH'), 'лдг ldh', 'ru', 1, 'llm_semantic_match'),

  -- LDL Cholesterol (LDL)
  ((SELECT analyte_id FROM analytes WHERE code = 'LDL'), 'ldl', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'LDL'), 'ldl c', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'LDL'), 'ldl cholesterol', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'LDL'), 'лпнп', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'LDL'), 'холестерин липопротеинов низкой плотности ldl chole sterol', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'LDL'), 'холестерин липопротеинов низкой плотности лпнп', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'LDL'), 'холестерин лпнп', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'LDL'), 'холестерин лпнп по фридвальду', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'LDL'), 'хс лпнп', 'ru', 1, 'seed'),

  -- Luteinizing Hormone (LH) (LH)
  ((SELECT analyte_id FROM analytes WHERE code = 'LH'), 'лг', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'LH'), 'лютеинизирующий гормон (лг)', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'LH'), 'лютеонизирующий гормон (лг)', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'LH'), 'luteinizing hormone (lh)', 'en', 1, 'seed'),

  -- Lipase (LIP)
  ((SELECT analyte_id FROM analytes WHERE code = 'LIP'), 'lip', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'LIP'), 'lipase', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'LIP'), 'липаза', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'LIP'), 'ліпаза', 'uk', 1, 'seed'),

  -- Lipoprotein(a) (LPA)
  ((SELECT analyte_id FROM analytes WHERE code = 'LPA'), 'липопротеин а', 'ru', 1, 'seed'),

  -- Large Unstained Cells (absolute) (LUC)
  ((SELECT analyte_id FROM analytes WHERE code = 'LUC'), 'luc большие неокрашенные клетки', 'ru', 1, 'seed'),

  -- Large Unstained Cells (%) (LUC_PRCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'LUC_PRCT'), 'luc большие неокрашенные клетки', 'ru', 1, 'seed'),

  -- Lymphocytes (absolute) (LYMPH)
  ((SELECT analyte_id FROM analytes WHERE code = 'LYMPH'), 'лимфоциты lymph', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'LYMPH'), 'лимфоциты абс', 'ru', 1, 'llm_semantic_match'),

  -- Lymphocytes (%) (LYMPH_PRCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'LYMPH_PRCT'), 'лимфоциты lymph', 'ru', 1, 'seed'),

  -- Macroprolactin (concentration) (MACROPROLACTIN)
  ((SELECT analyte_id FROM analytes WHERE code = 'MACROPROLACTIN'), 'макропролактин', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MACROPROLACTIN'), 'macroprolactin (concentration)', 'en', 1, 'seed'),

  -- Macroprolactin (%) (MACROPROLACTIN_PRCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'MACROPROLACTIN_PRCT'), 'макропролактин, %', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MACROPROLACTIN_PRCT'), 'macroprolactin (%)', 'en', 1, 'seed'),

  -- Mean Corpuscular Hemoglobin (MCH)
  ((SELECT analyte_id FROM analytes WHERE code = 'MCH'), 'mch', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MCH'), 'mean corpuscular hemoglobin', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MCH'), 'среднее содержание гемоглобина', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MCH'), 'среднее содержание гемоглобина в эритроците мсн', 'ru', 1, 'llm_semantic_match'),

  -- Mean Corpuscular Hemoglobin Concentration (MCHC)
  ((SELECT analyte_id FROM analytes WHERE code = 'MCHC'), 'mchc', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MCHC'), 'mean corpuscular hemoglobin concentration', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MCHC'), 'средняя концентрация гемоглобина', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MCHC'), 'средняя концентрация гемоглобина в эритроците мснс', 'ru', 1, 'llm_semantic_match'),

  -- Mean Corpuscular Volume (MCV)
  ((SELECT analyte_id FROM analytes WHERE code = 'MCV'), 'mcv', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MCV'), 'mean corpuscular volume', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MCV'), 'mcv ср объем эритр', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MCV'), 'средний объем эритроцита', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MCV'), 'средний объем эритроцита (mcv)', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MCV'), 'середній обєм еритроцита', 'uk', 1, 'seed'),

  -- Magnesium (MG)
  ((SELECT analyte_id FROM analytes WHERE code = 'MG'), 'magnesium', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MG'), 'mg', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MG'), 'магний', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MG'), 'магній', 'uk', 1, 'seed'),

  -- Microflora growth (culture result: growth of flora) (MICROFLORA_GROWTH)
  ((SELECT analyte_id FROM analytes WHERE code = 'MICROFLORA_GROWTH'), 'роста микрофлоры', 'ru', 1, 'seed'),

  -- Monocytes (absolute) (MONO)
  ((SELECT analyte_id FROM analytes WHERE code = 'MONO'), 'моноциты 10⁹ л', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MONO'), 'моноциты mono', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MONO'), 'моноциты абс', 'ru', 1, 'llm_semantic_match'),

  -- Monocytes (%) (MONO_PRCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'MONO_PRCT'), 'моноциты', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MONO_PRCT'), 'моноциты mono', 'ru', 1, 'seed'),

  -- Mean Platelet Volume (MPV)
  ((SELECT analyte_id FROM analytes WHERE code = 'MPV'), 'mean platelet volume', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MPV'), 'mpv', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MPV'), 'средний объем тромбоцитов', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'MPV'), 'средний объем тромбоцитов (mpv)', 'ru', 1, 'seed'),

  -- Sodium (NA)
  ((SELECT analyte_id FROM analytes WHERE code = 'NA'), 'na', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'NA'), 'sodium', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'NA'), 'натрий', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'NA'), 'натрий sodium', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'NA'), 'натрій', 'uk', 1, 'seed'),

  -- Ionized Sodium (NA_ION)
  ((SELECT analyte_id FROM analytes WHERE code = 'NA_ION'), 'натрий ионизированный', 'ru', 1, 'seed'),

  -- Neisseria subflava (microbial identification) (NEISSERIA_SUBFLAVA)
  ((SELECT analyte_id FROM analytes WHERE code = 'NEISSERIA_SUBFLAVA'), 'neisseria subflava', 'en', 1, 'seed'),

  -- Neutrophils (absolute) (NEUT)
  ((SELECT analyte_id FROM analytes WHERE code = 'NEUT'), 'нейтрофильные гранулоциты neut', 'ru', 1, 'seed'),

  -- Band Neutrophils (absolute) (NEUT_BAND)
  ((SELECT analyte_id FROM analytes WHERE code = 'NEUT_BAND'), 'band neutrophils', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'NEUT_BAND'), 'band neutrophils absolute', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'NEUT_BAND'), 'neut bands abs', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'NEUT_BAND'), 'нейтрофилы палочк абс', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'NEUT_BAND'), 'нейтрофилы палочкоядерные', 'ru', 1, 'seed'),

  -- Band Neutrophils (%) (NEUT_BAND_PRCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'NEUT_BAND_PRCT'), 'палочкоядерные нейтрофилы neut r', 'ru', 1, 'seed'),

  -- Neutrophils (%) (NEUT_PRCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'NEUT_PRCT'), 'нейтрофильные гранулоциты neut', 'ru', 1, 'seed'),

  -- NK cells (CD3-CD16+CD56+) (absolute, 10^9/L) (NK)
  ((SELECT analyte_id FROM analytes WHERE code = 'NK'), 'nk клетки cd3 cd16 cd56 10 9 л', 'ru', 1, 'seed'),

  -- NK cells (CD3-CD16+CD56+) (%) (NK_PRCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'NK_PRCT'), 'nk клетки cd3 cd16 cd56', 'ru', 1, 'seed'),

  -- NKT cells (CD3+CD16+CD56+) (absolute, 10^9/L) (NKT)
  ((SELECT analyte_id FROM analytes WHERE code = 'NKT'), 'nkt клетки cd3 cd16 cd56 10 9 л', 'ru', 1, 'seed'),

  -- NKT cells (CD3+CD16+CD56+) (%) (NKT_PRCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'NKT_PRCT'), 'nkt клетки cd3 cd16 cd56', 'ru', 1, 'seed'),

  -- Non-fermenting Gram-negative bacteria (culture/microbiology identification) (NONFERMENTING_GRAM_NEG)
  ((SELECT analyte_id FROM analytes WHERE code = 'NONFERMENTING_GRAM_NEG'), 'неферментирующие грамотрицательные бактерии', 'ru', 1, 'seed'),

  -- Non-HDL Cholesterol (NON_HDL)
  ((SELECT analyte_id FROM analytes WHERE code = 'NON_HDL'), 'non hdl', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'NON_HDL'), 'non-hdl', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'NON_HDL'), 'nonhdl', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'NON_HDL'), 'non hdl cholesterol', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'NON_HDL'), 'non-hdl cholesterol', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'NON_HDL'), 'не лпвп', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'NON_HDL'), 'не-лпвп', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'NON_HDL'), 'холестерин не лпвп', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'NON_HDL'), 'холестерин не-лпвп', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'NON_HDL'), 'хс не-лпвп', 'ru', 1, 'seed'),

  -- Norepinephrine (Noradrenaline) (NOREPINEPHRINE)
  ((SELECT analyte_id FROM analytes WHERE code = 'NOREPINEPHRINE'), 'норадреналин', 'ru', 1, 'seed'),

  -- Neuron-Specific Enolase (NSE) (NSE)
  ((SELECT analyte_id FROM analytes WHERE code = 'NSE'), 'нейрон специфическая энолаза nse', 'ru', 1, 'seed'),

  -- 17-Hydroxyprogesterone (OH17_PROGESTERONE)
  ((SELECT analyte_id FROM analytes WHERE code = 'OH17_PROGESTERONE'), '17-oh-прогестерон', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'OH17_PROGESTERONE'), '17-hydroxyprogesterone', 'en', 1, 'seed'),

  -- Plateletcrit (PCT) (PCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'PCT'), 'тромбокрит pct', 'ru', 1, 'seed'),

  -- Procalcitonin (PCTN)
  ((SELECT analyte_id FROM analytes WHERE code = 'PCTN'), 'прокальцитонин', 'ru', 1, 'seed'),

  -- Platelet Distribution Width (PDW) (PDW)
  ((SELECT analyte_id FROM analytes WHERE code = 'PDW'), 'ширина распределения тромбоцитов по объемам pdw', 'ru', 1, 'seed'),

  -- Phosphorus (PHOS)
  ((SELECT analyte_id FROM analytes WHERE code = 'PHOS'), 'phos', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'PHOS'), 'phosphate', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'PHOS'), 'phosphorus', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'PHOS'), 'фосфаты', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'PHOS'), 'фосфор', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'PHOS'), 'фосфор неорганический', 'ru', 1, 'llm_semantic_match'),

  -- Platelet Large Cell Ratio (P-LCR) (P_LCR)
  ((SELECT analyte_id FROM analytes WHERE code = 'P_LCR'), 'коэффициент больших тромбоцитов p lcr', 'ru', 1, 'seed'),

  -- Platelet Count (PLT)
  ((SELECT analyte_id FROM analytes WHERE code = 'PLT'), 'platelets', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'PLT'), 'plt', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'PLT'), 'тромбоциты', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'PLT'), 'тромбоциты (plt)', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'PLT'), 'тромбоцити', 'uk', 1, 'seed'),

  -- Progesterone (PROGESTERONE)
  ((SELECT analyte_id FROM analytes WHERE code = 'PROGESTERONE'), 'прогестерон', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'PROGESTERONE'), 'progesterone', 'en', 1, 'seed'),

  -- Prolactin (PROLACTIN)
  ((SELECT analyte_id FROM analytes WHERE code = 'PROLACTIN'), 'пролактин', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'PROLACTIN'), 'prolactin', 'en', 1, 'seed'),

  -- Monomeric Prolactin (concentration) (PROLACTIN_MONOMER)
  ((SELECT analyte_id FROM analytes WHERE code = 'PROLACTIN_MONOMER'), 'пролактин мономерный', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'PROLACTIN_MONOMER'), 'monomeric prolactin (concentration)', 'en', 1, 'seed'),

  -- Monomeric Prolactin (%) (PROLACTIN_MONOMER_PRCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'PROLACTIN_MONOMER_PRCT'), 'пролактин мономерный, %', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'PROLACTIN_MONOMER_PRCT'), 'monomeric prolactin (%)', 'en', 1, 'seed'),

  -- Prothrombin activity (% by Quick method) (PROTHROMBIN_ACTIVITY)
  ((SELECT analyte_id FROM analytes WHERE code = 'PROTHROMBIN_ACTIVITY'), 'протромбин по квику', 'ru', 1, 'seed'),

  -- Prostate Specific Antigen (PSA)
  ((SELECT analyte_id FROM analytes WHERE code = 'PSA'), 'prostate specific antigen', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'PSA'), 'psa', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'PSA'), 'простатспецифический антиген', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'PSA'), 'простат специфический антиген общий пса общ', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'PSA'), 'пса', 'ru', 1, 'seed'),

  -- Prothrombin Time (PT) (PT)
  ((SELECT analyte_id FROM analytes WHERE code = 'PT'), 'протромбиновое время', 'ru', 1, 'seed'),

  -- Red Blood Cell Count (RBC)
  ((SELECT analyte_id FROM analytes WHERE code = 'RBC'), 'erythrocytes', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'RBC'), 'rbc', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'RBC'), 'red blood cells', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'RBC'), 'эритроциты', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'RBC'), 'эритроциты (rbc)', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'RBC'), 'еритроцити', 'uk', 1, 'seed'),

  -- Red Cell Distribution Width (RDW)
  ((SELECT analyte_id FROM analytes WHERE code = 'RDW'), 'rdw', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'RDW'), 'rdw cv', 'en', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'RDW'), 'red cell distribution width', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'RDW'), 'rdw шир распред эритр', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'RDW'), 'ширина распределения эритроцитов', 'ru', 1, 'seed'),

  -- Red Cell Distribution Width (SD) (RDW_SD)
  ((SELECT analyte_id FROM analytes WHERE code = 'RDW_SD'), 'rdw sd', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'RDW_SD'), 'rdw-sd', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'RDW_SD'), 'ширина распределения эритроцитов rdw sd', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'RDW_SD'), 'ширина распределения эритроцитов sd', 'ru', 1, 'seed'),

  -- Rheumatoid Factor Production (spontaneous) (%) (RF_PROD_SPONT)
  ((SELECT analyte_id FROM analytes WHERE code = 'RF_PROD_SPONT'), 'продукция рфк (спонтанная)', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'RF_PROD_SPONT'), 'rheumatoid factor production (spontaneous) (%)', 'en', 1, 'seed'),

  -- Rheumatoid Factor Production (stimulated, FMA) (%) (RF_PROD_STIM_FMA)
  ((SELECT analyte_id FROM analytes WHERE code = 'RF_PROD_STIM_FMA'), 'продукция рфк (стимулированная фма)', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'RF_PROD_STIM_FMA'), 'rheumatoid factor production (stimulated, fma) (%)', 'en', 1, 'seed'),

  -- Rheumatoid Factor (RHEUMATOID_FACTOR)
  ((SELECT analyte_id FROM analytes WHERE code = 'RHEUMATOID_FACTOR'), 'ревматоидный фактор', 'ru', 1, 'seed'),

  -- ROMA Index (postmenopausal) (ROMA_POSTMENOPAUSE)
  ((SELECT analyte_id FROM analytes WHERE code = 'ROMA_POSTMENOPAUSE'), 'индекс roma (постменопауза)', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ROMA_POSTMENOPAUSE'), 'roma index (postmenopausal)', 'en', 1, 'seed'),

  -- ROMA Index (premenopausal) (ROMA_PREMENOPAUSE)
  ((SELECT analyte_id FROM analytes WHERE code = 'ROMA_PREMENOPAUSE'), 'roma-1 (расчет до менопаузы)', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ROMA_PREMENOPAUSE'), 'индекс roma (пременопауза)', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ROMA_PREMENOPAUSE'), 'roma index (premenopausal)', 'en', 1, 'seed'),

  -- SARS-CoV-2 IgG Antibody (SARS2_IGG)
  ((SELECT analyte_id FROM analytes WHERE code = 'SARS2_IGG'), 'sars cov 2 igg', 'en', 1, 'seed'),

  -- SARS-CoV-2 Nucleocapsid IgG Antibody (semiquantitative, ELISA) (SARS2_IGG_N)
  ((SELECT analyte_id FROM analytes WHERE code = 'SARS2_IGG_N'), 'ифа sars cov 2 антитела igg к n белку нуклеокапсидному полукол опред', 'ru', 1, 'seed'),

  -- SARS-CoV-2 Spike (S) Protein IgG Antibody (semiquantitative, ELISA) (SARS2_IGG_S)
  ((SELECT analyte_id FROM analytes WHERE code = 'SARS2_IGG_S'), 'sars cov 2 антитела igg к s белку rbd рецептору колич опред abbott', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'SARS2_IGG_S'), 'ифа sars cov 2 антитела igg к s белку полукол опред', 'ru', 1, 'seed'),

  -- SARS-CoV-2 IgM Antibody (SARS2_IGM)
  ((SELECT analyte_id FROM analytes WHERE code = 'SARS2_IGM'), 'sars cov 2 igm', 'en', 1, 'seed'),

  -- Sex Hormone-Binding Globulin (SHBG) (SHBG)
  ((SELECT analyte_id FROM analytes WHERE code = 'SHBG'), 'гспг', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'SHBG'), 'sex hormone-binding globulin (shbg)', 'en', 1, 'seed'),

  -- Staphylococcus species (culture/microbiology identification) (STAPHYLOCOCCUS_SPP)
  ((SELECT analyte_id FROM analytes WHERE code = 'STAPHYLOCOCCUS_SPP'), 'staphylococcus spp', 'en', 1, 'seed'),

  -- Streptococcus agalactiae (Group B) (culture/microbiology identification) (STREPTOCOCCUS_AGALACTIAE)
  ((SELECT analyte_id FROM analytes WHERE code = 'STREPTOCOCCUS_AGALACTIAE'), 'streptococcus agalactiae группа b', 'ru', 1, 'seed'),

  -- Treponema pallidum Antibodies (syphilis), qualitative (ELISA) (SYPH_IGG)
  ((SELECT analyte_id FROM analytes WHERE code = 'SYPH_IGG'), 'сифилис суммарные антитела к treponema pallidum ифа качеств опр', 'ru', 1, 'seed'),

  -- Triiodothyronine (T3)
  ((SELECT analyte_id FROM analytes WHERE code = 'T3'), 't3', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'T3'), 'triiodothyronine', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'T3'), 'т3', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'T3'), 'трийодтиронин', 'ru', 1, 'seed'),

  -- Thyroxine (T4)
  ((SELECT analyte_id FROM analytes WHERE code = 'T4'), 't4', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'T4'), 'thyroxine', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'T4'), 'т4', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'T4'), 'тироксин', 'ru', 1, 'seed'),

  -- Total Bilirubin (TBIL)
  ((SELECT analyte_id FROM analytes WHERE code = 'TBIL'), 'bilirubin total', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TBIL'), 'tbil', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TBIL'), 'total bilirubin', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TBIL'), 'билирубин общий', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TBIL'), 'билирубин общий total bilirubin', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TBIL'), 'общий билирубин', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TBIL'), 'загальний білірубін', 'uk', 1, 'seed'),

  -- T-lymphocytes (CD28+) (absolute, 10^9/L) (TCD28)
  ((SELECT analyte_id FROM analytes WHERE code = 'TCD28'), 't-lymphocytes (cd28+) (absolute, 10^9/l)', 'en', 1, 'seed'),

  -- T-lymphocytes (CD28+) (%) (TCD28_PRCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'TCD28_PRCT'), 't-lymphocytes (cd28+) (%)', 'en', 1, 'seed'),

  -- Free Testosterone (TESTOSTERONE_FREE)
  ((SELECT analyte_id FROM analytes WHERE code = 'TESTOSTERONE_FREE'), 'свободный тестостерон', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TESTOSTERONE_FREE'), 'free testosterone', 'en', 1, 'seed'),

  -- Total Testosterone (TESTOSTERONE_TOTAL)
  ((SELECT analyte_id FROM analytes WHERE code = 'TESTOSTERONE_TOTAL'), 'тестостерон общий', 'ru', 1, 'seed'),

  -- Thyroglobulin (TG) (TG)
  ((SELECT analyte_id FROM analytes WHERE code = 'TG'), 'тиреоглобулин tg', 'ru', 1, 'seed'),

  -- Tissue Transglutaminase (tTG, neoepitope) IgA Antibodies (TG2_IGA)
  ((SELECT analyte_id FROM analytes WHERE code = 'TG2_IGA'), 'тканевая трансглютаминаза (неоэпитоп), антитела igа', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TG2_IGA'), 'tissue transglutaminase (ttg, neoepitope) iga antibodies', 'en', 1, 'seed'),

  -- Tissue Transglutaminase (tTG, neoepitope) IgG Antibodies (TG2_IGG)
  ((SELECT analyte_id FROM analytes WHERE code = 'TG2_IGG'), 'тканевая трансглютаминаза (неоэпитоп), антитела igg', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TG2_IGG'), 'tissue transglutaminase (ttg, neoepitope) igg antibodies', 'en', 1, 'seed'),

  -- Thrombin Time (TT) (THROMBIN_TIME)
  ((SELECT analyte_id FROM analytes WHERE code = 'THROMBIN_TIME'), 'тромбиновое время', 'ru', 1, 'seed'),

  -- Thrombin Time Ratio (THROMBIN_TIME_RATIO)
  ((SELECT analyte_id FROM analytes WHERE code = 'THROMBIN_TIME_RATIO'), 'тромбиновое время ratio', 'ru', 1, 'seed'),

  -- Total Iron Binding Capacity (TIBC)
  ((SELECT analyte_id FROM analytes WHERE code = 'TIBC'), 'tibc', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TIBC'), 'total iron binding capacity', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TIBC'), 'общая железосвязывающая способность', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TIBC'), 'ожсс', 'ru', 1, 'seed'),

  -- Toxoplasma gondii IgG Antibody (TOXO_IGG)
  ((SELECT analyte_id FROM analytes WHERE code = 'TOXO_IGG'), 'токсоплазма toxoplasma gondii igg', 'ru', 1, 'seed'),

  -- Toxoplasma gondii IgM Antibody (TOXO_IGM)
  ((SELECT analyte_id FROM analytes WHERE code = 'TOXO_IGM'), 'токсоплазма toxoplasma gondii igm', 'ru', 1, 'seed'),

  -- Total Protein (TP)
  ((SELECT analyte_id FROM analytes WHERE code = 'TP'), 'protein total', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TP'), 'total protein', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TP'), 'tp', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TP'), 'белок общий', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TP'), 'общий белок', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TP'), 'общийбелок', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TP'), 'общий белок total protein', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TP'), 'загальний білок', 'uk', 1, 'seed'),

  -- Thyroid Peroxidase Antibodies (TPO Ab) (TPO_AB)
  ((SELECT analyte_id FROM analytes WHERE code = 'TPO_AB'), 'переоксидаза щитовидной железы аутоантитела атпо', 'ru', 1, 'seed'),

  -- Transferrin (TRANSFERRIN)
  ((SELECT analyte_id FROM analytes WHERE code = 'TRANSFERRIN'), 'трансферрин', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TRANSFERRIN'), 'transferrin', 'en', 1, 'seed'),

  -- T-regulatory cells (CD4+CD25hiCD127-) (absolute, 10^9/L) (TREG)
  ((SELECT analyte_id FROM analytes WHERE code = 'TREG'), 'т-регуляторные клетки(cd4+cd25hicd127-), *10^9/л', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TREG'), 't-regulatory cells (cd4+cd25hicd127-) (absolute, 10^9/l)', 'en', 1, 'seed'),

  -- T-regulatory cells (CD4+CD25hiCD127-) (%) (TREG_PRCT)
  ((SELECT analyte_id FROM analytes WHERE code = 'TREG_PRCT'), 'т-регуляторные клетки(cd4+cd25hicd127-), %', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TREG_PRCT'), 't-regulatory cells (cd4+cd25hicd127-) (%)', 'en', 1, 'seed'),

  -- Triglycerides (TRIG)
  ((SELECT analyte_id FROM analytes WHERE code = 'TRIG'), 'tg', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TRIG'), 'trig', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TRIG'), 'triglycerides', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TRIG'), 'триглицериды', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TRIG'), 'Триглицериды', 'ru', 1, 'manual'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TRIG'), 'триглицериды triglyceride', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TRIG'), 'тригліцериди', 'uk', 1, 'seed'),

  -- Troponin I (TROP)
  ((SELECT analyte_id FROM analytes WHERE code = 'TROP'), 'trop i', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TROP'), 'troponin', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TROP'), 'troponin i', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TROP'), 'тропонин', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TROP'), 'тропонін', 'uk', 1, 'seed'),

  -- Transferrin Saturation (TSAT)
  ((SELECT analyte_id FROM analytes WHERE code = 'TSAT'), 'transferrin saturation', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TSAT'), 'tsat', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TSAT'), 'насыщение трансферрина', 'ru', 1, 'seed'),

  -- Thyroid Stimulating Hormone (TSH)
  ((SELECT analyte_id FROM analytes WHERE code = 'TSH'), 'thyroid stimulating hormone', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TSH'), 'thyrotropin', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TSH'), 'tsh', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TSH'), 'тиреотропный гормон', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TSH'), 'тиреотропный гормон тиреотропин ттг', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TSH'), 'ттг', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TSH'), 'ттг tsh', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'TSH'), 'тиреотропний гормон', 'uk', 1, 'seed'),

  -- Uric Acid (UA)
  ((SELECT analyte_id FROM analytes WHERE code = 'UA'), 'ua', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'UA'), 'urate', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'UA'), 'uric acid', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'UA'), 'мочевая кислота', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'UA'), 'мочевая кислота uric acid', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'UA'), 'сечова кислота', 'uk', 1, 'seed'),

  -- Urine Ammonium Biurate Crystals (URINE_AMMONIUM_BIURATE)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_AMMONIUM_BIURATE'), 'urine ammonium urate crystals', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_AMMONIUM_BIURATE'), 'кр кисл мочекислого аммония', 'ru', 1, 'seed'),

  -- Urine Bacteria (microscopy) (URINE_BACTERIA)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_BACTERIA'), 'бактерии', 'ru', 1, 'seed'),

  -- Urine Bilirubin (URINE_BIL)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_BIL'), 'билирубин', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_BIL'), 'билирубин в моче', 'ru', 1, 'seed'),

  -- Urine Calcium Phosphate Crystals (URINE_CALCIUM_PHOSPHATE_CRYSTALS)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_CALCIUM_PHOSPHATE_CRYSTALS'), 'крист фосфорнокисл кальция', 'ru', 1, 'seed'),

  -- Urine Casts (cylinders) (URINE_CASTS)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_CASTS'), 'цилиндры', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_CASTS'), 'цилиндры в п з', 'ru', 1, 'llm_semantic_match'),

  -- Urine Color (URINE_COLOR)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_COLOR'), 'цвет', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_COLOR'), 'цвет мочи', 'ru', 1, 'seed'),

  -- Urine Crystals / Salts (URINE_CRYSTALS)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_CRYSTALS'), 'соли', 'ru', 1, 'seed'),

  -- Urine Calcium Oxalate Crystals (URINE_CRYSTALS_OXALATE)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_CRYSTALS_OXALATE'), 'calcium oxalate crystals', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_CRYSTALS_OXALATE'), 'oxalate crystals', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_CRYSTALS_OXALATE'), 'кристаллы оксалата кальция', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_CRYSTALS_OXALATE'), 'кристаллы оксалаты', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_CRYSTALS_OXALATE'), 'оксалатные кристаллы', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_CRYSTALS_OXALATE'), 'оксалаты', 'ru', 1, 'llm_semantic_match'),

  -- Urine Bacterial Culture with Antibiotic Sensitivity (URINE_CULTURE_AB_SENS)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_CULTURE_AB_SENS'), 'бак посев чувств к аб моча', 'ru', 1, 'seed'),

  -- Urine Epithelial Cells (sediment) (URINE_EPIT)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_EPIT'), 'эпителиальные клетки осадок', 'ru', 1, 'seed'),

  -- Urine Non-squamous Epithelial Cells (sediment) (URINE_EPIT_NONPLAT)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_EPIT_NONPLAT'), 'клетки неплоского эпителия', 'ru', 1, 'seed'),

  -- Urine Squamous Epithelial Cells (sediment) (URINE_EPIT_PLAT)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_EPIT_PLAT'), 'эпителий плоский', 'ru', 1, 'seed'),

  -- Urine Renal (Renal Tubular) Epithelial Cells (sediment) (URINE_EPIT_RENAL)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_EPIT_RENAL'), 'эпителиальные клетки почечных канальцев', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_EPIT_RENAL'), 'эпителий почечный', 'ru', 1, 'seed'),

  -- Urine Transitional Epithelial Cells (sediment) (URINE_EPIT_TRANS)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_EPIT_TRANS'), 'клетки переходного эпителия', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_EPIT_TRANS'), 'эпителий переходный', 'ru', 1, 'seed'),

  -- Urine Glucose (URINE_GLUC)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_GLUC'), 'глюкоза мочи', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_GLUC'), 'глюкоза сахар', 'ru', 1, 'llm_semantic_match'),

  -- Urine Intact (Non-lysed) Red Blood Cells (URINE_INTACT_RBC)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_INTACT_RBC'), 'нелизированные эритроциты', 'ru', 1, 'seed'),

  -- Urine Ketones (URINE_KET)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_KET'), 'кетоновые тела', 'ru', 1, 'seed'),

  -- Urine Leukocyte Esterase (URINE_LEUKOCYTE_ESTERASE)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_LEUKOCYTE_ESTERASE'), 'leukocyte esterase', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_LEUKOCYTE_ESTERASE'), 'лейкоцитарная эстераза', 'ru', 1, 'seed'),

  -- Urine Mucus (sediment) (URINE_MUCUS)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_MUCUS'), 'слизь осадок', 'ru', 1, 'seed'),

  -- Mucus (urine sediment) (URINE_MUCUS_SED)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_MUCUS_SED'), 'слизь', 'ru', 1, 'seed'),

  -- Urine Nitrites (URINE_NIT)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_NIT'), 'нитриты', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_NIT'), 'нитриты nit', 'ru', 1, 'llm_semantic_match'),

  -- Normal Flora (urine culture/microscopy) (URINE_NORMAL_FLORA)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_NORMAL_FLORA'), 'normal flora', 'en', 1, 'seed'),

  -- Urine pH (URINE_PH)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_PH'), 'реакция ph', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_PH'), 'реакция мочи', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_PH'), 'рн', 'ru', 1, 'seed'),

  -- Urine Protein (URINE_PROT)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_PROT'), 'белок', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_PROT'), 'белок pro ur', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_PROT'), 'белок качеств', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_PROT'), 'белок мочи', 'ru', 1, 'seed'),

  -- Urine Red Blood Cells (URINE_RBC)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_RBC'), 'эритроциты в моче', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_RBC'), 'эритроциты в моче дипстик', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_RBC'), 'эритроциты в п з', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_RBC'), 'эритроциты моча', 'ru', 1, 'seed'),

  -- Urine Red Blood Cells and Hemoglobin (urine haematuria/hemoglobin) (URINE_RBC_HGB)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_RBC_HGB'), 'гемоглобин в моче', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_RBC_HGB'), 'эритроциты гемоглобин в моче', 'ru', 1, 'seed'),

  -- Urine Sediment Erythrocytes (URINE_SED_RBC)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_SED_RBC'), 'эритроциты осадок', 'ru', 1, 'seed'),

  -- Urine Sediment Leukocytes (URINE_SED_WBC)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_SED_WBC'), 'лейкоциты осадок', 'ru', 1, 'seed'),

  -- Urine Specific Gravity (URINE_SG)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_SG'), 'удельный вес', 'ru', 1, 'seed'),

  -- Urine Transparency/Turbidity (URINE_TURBIDITY)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_TURBIDITY'), 'прозрачность', 'ru', 1, 'seed'),

  -- Urine Urobilinogen (URINE_UBG)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_UBG'), 'уробилин', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_UBG'), 'уробилиноген', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_UBG'), 'уробилиноген в моче', 'ru', 1, 'seed'),

  -- Urine Urate Crystals (URINE_URATES)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_URATES'), 'ураты', 'ru', 1, 'seed'),

  -- Urine Uric Acid Crystals (URINE_URIC_ACID_CRYSTALS)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_URIC_ACID_CRYSTALS'), 'крист мочевой кислоты', 'ru', 1, 'seed'),

  -- Urine Leukocytes (WBC) (URINE_WBC)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_WBC'), 'лейкоциты в моче', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_WBC'), 'лейкоциты в п з', 'ru', 1, 'llm_semantic_match'),

  -- Urine Leukocyte Aggregates / WBC Clusters (urine sediment) (URINE_WBC_CLUSTERS)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_WBC_CLUSTERS'), 'скопления лейкоцитов', 'ru', 1, 'seed'),

  -- Urine Yeast (fungi, microscopy) (URINE_YEAST)
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_YEAST'), 'дрожжевидные клетки', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_YEAST'), 'дрожжевые грибки', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_YEAST'), 'дрожжевые грибы', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'URINE_YEAST'), 'дрожжи', 'ru', 1, 'seed'),

  -- Vitamin B12 (VITB12)
  ((SELECT analyte_id FROM analytes WHERE code = 'VITB12'), 'b12', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VITB12'), 'cobalamin', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VITB12'), 'vitamin b12', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VITB12'), 'витамин b12', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VITB12'), 'витамин в12 цианокобаламин', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VITB12'), 'кобаламин', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VITB12'), 'вітамін b12', 'uk', 1, 'seed'),

  -- Vitamin D (25-OH) (VITD)
  ((SELECT analyte_id FROM analytes WHERE code = 'VITD'), '25 hydroxy vitamin d', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VITD'), '25 oh d', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VITD'), 'vitamin d', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VITD'), 'vitd', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VITD'), '25 oh витамин d', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VITD'), 'витамин d', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VITD'), 'общий витамин d 25 он витамин d', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VITD'), 'общий витамин д', 'ru', 1, 'llm_semantic_match'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VITD'), 'вітамін d', 'uk', 1, 'seed'),

  -- VLDL Cholesterol (VLDL)
  ((SELECT analyte_id FROM analytes WHERE code = 'VLDL'), 'vldl', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VLDL'), 'vldl cholesterol', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VLDL'), 'лпонп', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'VLDL'), 'холестерин лпонп', 'ru', 1, 'seed'),

  -- White Blood Cell Count (WBC)
  ((SELECT analyte_id FROM analytes WHERE code = 'WBC'), 'leukocytes', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'WBC'), 'wbc', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'WBC'), 'white blood cells', 'en', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'WBC'), 'лейкоциты', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'WBC'), 'лейкоциты wbc', 'ru', 1, 'seed'),
  ((SELECT analyte_id FROM analytes WHERE code = 'WBC'), 'лейкоцити', 'uk', 1, 'seed')
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
