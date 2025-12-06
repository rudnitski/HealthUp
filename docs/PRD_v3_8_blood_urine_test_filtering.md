# PRD v3.8: Blood and Urine Test Filtering

**Status:** Ready for Implementation
**Created:** 2025-12-06
**Author:** Claude (with user collaboration)
**Target Release:** v3.8
**Dependencies:** PRD v2.7 (Multi-Provider OCR), PRD v3.4 (Storing Original Lab Files)

---

## Overview

### Problem Statement

HealthUp currently extracts and stores **all laboratory parameters** from uploaded documents regardless of test type. This includes:

- **Blood tests**: CBC, metabolic panels, lipid profiles, liver enzymes, hormones
- **Urine tests**: Urinalysis, urine culture, urine protein
- **Other tests**: MRI results, X-rays, cytology, tissue biopsies, stool analysis, CSF analysis

All parameters land in the same `lab_results` table, creating several problems:

1. **Data noise**: SQL queries for blood test trends may return unrelated MRI or cytology data
2. **LLM confusion**: Agentic SQL assistant may conflate different test types when answering user queries
3. **Ambiguous analytes**: Some analytes (creatinine, protein, glucose) appear in both blood and urine tests with different clinical meanings - without specimen type, queries mix them together
4. **Scope creep**: MVP should focus on the most common and well-structured test types (blood/urine) before expanding

**Real-world example:**
```
User uploads: "Complete Health Checkup Report.pdf"
Contains:
  - CBC (14 parameters) - BLOOD
  - Lipid Panel (5 parameters) - BLOOD
  - Liver Function (8 parameters) - BLOOD
  - Urinalysis (12 parameters) - URINE
  - Cervical Cytology (3 parameters) - TISSUE
  - Chest X-Ray findings (2 parameters) - IMAGING

Current behavior: All 44 parameters saved to lab_results, no specimen distinction
Desired behavior: 39 blood/urine parameters saved with specimen_type, 5 others skipped
```

### Goals

1. **Focus on blood and urine tests**: Extract and persist only blood and urine test parameters to `lab_results` table
2. **Track specimen type**: Store `specimen_type` ('blood' or 'urine') for each parameter to distinguish overlapping analytes
3. **Preserve original files**: Continue storing original uploaded files regardless of content (already implemented in PRD v3.4)
4. **LLM-side filtering**: Instruct the vision model to only extract blood/urine tests, simplifying the persistence layer
5. **Future extensibility**: Design allows adding more specimen types later without re-processing existing data

### Non-Goals (Out of Scope)

- Storing filtered/skipped parameters in a separate table
- Tracking count of skipped parameters (user can view original file if curious)
- Admin UI to view skipped parameters
- Retroactive filtering of already-processed reports
- User configuration of which test types to include

---

## Solution Design

### Approach: LLM-Side Filtering with Specimen Type

We instruct the LLM to **only extract blood and urine tests** during OCR, and to identify the specimen type for each parameter. This approach:

- **Reduces complexity**: No filtering logic in persistence layer
- **Reduces tokens**: Smaller response payload (only relevant data)
- **Leverages LLM context**: Model sees entire document and can make informed decisions about test types
- **Preserves original**: Full document stored as file, raw model output stored in `patient_reports.raw_model_output`
- **Enables proper queries**: `specimen_type` allows distinguishing blood creatinine from urine creatinine

### Known Limitation: LLM Trust

Filtering is delegated entirely to the LLM with no server-side validation against a whitelist. If the LLM misclassifies a non-blood/non-urine test (e.g., includes an MRI finding), it will be saved.

**Why this is acceptable for MVP:**
- Building a comprehensive whitelist for multilingual analyte names (English, Russian, Ukrainian) is complex
- The analyte mapping system provides a secondary check - misclassified parameters likely won't map to known analytes
- Original files are always preserved for manual review
- LLM accuracy is expected to be high (>95%) given explicit instructions

### What Gets Extracted

**Blood tests (specimen_type = 'blood'):**
- Complete Blood Count (CBC): WBC, RBC, hemoglobin, hematocrit, platelets, etc.
- Metabolic panels: glucose, electrolytes, BUN, creatinine, etc.
- Lipid profiles: cholesterol, HDL, LDL, triglycerides
- Liver function: ALT, AST, ALP, bilirubin, albumin
- Kidney function: creatinine, BUN, eGFR, uric acid
- Thyroid: TSH, T3, T4, free T4
- Hormones: testosterone, estrogen, cortisol, insulin
- Vitamins/minerals: vitamin D, B12, iron, ferritin
- Inflammatory markers: CRP, ESR
- Coagulation: PT, INR, aPTT
- Cardiac markers: troponin, BNP
- Tumor markers: PSA, CA-125, CEA (when from blood draw)

**Urine tests (specimen_type = 'urine'):**
- Urinalysis: pH, specific gravity, protein, glucose, ketones, blood, leukocytes
- Urine culture results
- Microalbumin/creatinine ratio
- 24-hour urine collections
- Drug screening (urine-based)

### What Gets Skipped

**Imaging/radiology:**
- MRI findings
- CT scan results
- X-ray interpretations
- Ultrasound reports

**Tissue-based tests:**
- Cytology (cervical, bronchial, etc.)
- Histopathology/biopsy results
- Pap smear findings

**Other specimen types:**
- Stool analysis
- CSF (cerebrospinal fluid) analysis
- Sputum culture
- Swab cultures (throat, wound, etc.)
- Semen analysis

---

## Technical Implementation

### 1. Database Schema Changes

**File:** `server/db/schema.js`

Add `specimen_type` column to `lab_results` table:

```sql
-- Add to lab_results table definition
specimen_type TEXT  -- 'blood' or 'urine'
```

**MVP Note:** Since we're pre-production with no live data, the migration approach is:
1. Drop existing database
2. Run `npm run dev` (auto-applies schema with new column)
3. No ALTER TABLE or migration files needed

Update the CREATE TABLE statement:

```javascript
CREATE TABLE IF NOT EXISTS lab_results (
  id UUID PRIMARY KEY,
  report_id UUID NOT NULL REFERENCES patient_reports(id) ON DELETE CASCADE,
  position INT,
  parameter_name TEXT,
  result_value TEXT,
  unit TEXT,
  reference_lower NUMERIC,
  reference_lower_operator TEXT,
  reference_upper NUMERIC,
  reference_upper_operator TEXT,
  reference_text TEXT,
  reference_full_text TEXT,
  is_value_out_of_range BOOLEAN,
  numeric_result NUMERIC,
  specimen_type TEXT,  -- NEW: 'blood' or 'urine'
  analyte_id INT REFERENCES analytes(analyte_id),
  mapping_confidence REAL,
  mapped_at TIMESTAMPTZ,
  mapping_source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 2. OCR Prompt Changes

**File:** `prompts/lab_user_prompt.txt`

Add filtering instructions at the beginning of the prompt:

```
IMPORTANT: Extract ONLY laboratory parameters from BLOOD tests and URINE tests.

INCLUDE (blood tests - set specimen_type to "blood"):
- Complete Blood Count (CBC): WBC, RBC, hemoglobin, hematocrit, platelets, MCV, MCH, MCHC
- Metabolic panels: glucose, electrolytes (Na, K, Cl, CO2), BUN, creatinine, calcium
- Lipid profiles: total cholesterol, HDL, LDL, triglycerides, VLDL
- Liver function: ALT, AST, ALP, GGT, bilirubin, albumin, total protein
- Kidney function: creatinine, BUN, eGFR, uric acid, cystatin C
- Thyroid: TSH, T3, T4, free T3, free T4
- Hormones: cortisol, insulin, testosterone, estrogen, progesterone, FSH, LH
- Vitamins/minerals: vitamin D, vitamin B12, folate, iron, ferritin, TIBC
- Inflammatory markers: CRP, ESR, procalcitonin
- Coagulation: PT, INR, aPTT, fibrinogen, D-dimer
- Cardiac markers: troponin, BNP, NT-proBNP, CK-MB
- Immunology from blood: antibodies, immunoglobulins (IgA, IgG, IgM)

INCLUDE (urine tests - set specimen_type to "urine"):
- Urinalysis: pH, specific gravity, protein, glucose, ketones, blood, bilirubin, urobilinogen, nitrites, leukocyte esterase
- Urine microscopy: RBC, WBC, bacteria, casts, crystals
- Urine culture: organism identification, colony counts
- Urine protein: microalbumin, albumin/creatinine ratio, total protein
- 24-hour urine: creatinine clearance, protein excretion, electrolytes

SKIP (do not extract at all):
- MRI, CT, X-ray, ultrasound findings or interpretations
- Cytology results (cervical, bronchial, etc.)
- Histopathology, biopsy, or tissue analysis
- Stool/fecal tests
- CSF (cerebrospinal fluid) analysis
- Sputum or respiratory cultures
- Wound, throat, or other swab cultures
- Genetic/DNA test results
- Semen analysis

If a document contains ONLY non-blood/non-urine tests, return an empty parameters array.
```

Add to the parameters field description:

```
Each entry in parameters must include:
- parameter_name (string or null; copy the label as written in the report)
- result (string or null; capture the numeric or qualitative value without repeating the unit when the unit is known)
- unit (string or null; preserve symbols such as mg/dL)
- reference_interval (object with lower, upper, lower_operator, upper_operator, text, full_text)
- specimen_type (string: "blood" or "urine"; identify from document context - section headers, test groupings, reference ranges)
```

### 3. OCR Schema Changes

**File:** `server/services/labReportProcessor.js`

Add `specimen_type` to the parameter schema:

```javascript
const structuredOutputFormat = {
  type: 'json_schema',
  name: 'full_lab_extraction',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      patient_name: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      patient_age: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }] },
      patient_date_of_birth: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      patient_gender: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      test_date: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      parameters: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            parameter_name: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            result: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            unit: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            reference_interval: {
              type: 'object',
              additionalProperties: false,
              properties: {
                lower: { anyOf: [{ type: 'number' }, { type: 'null' }] },
                lower_operator: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                upper: { anyOf: [{ type: 'number' }, { type: 'null' }] },
                upper_operator: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                text: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                full_text: { anyOf: [{ type: 'string' }, { type: 'null' }] },
              },
              required: ['lower', 'lower_operator', 'upper', 'upper_operator', 'text', 'full_text'],
            },
            is_value_out_of_range: { type: 'boolean' },
            numeric_result: { anyOf: [{ type: 'number' }, { type: 'null' }] },
            specimen_type: { anyOf: [{ type: 'string' }, { type: 'null' }] },  // NEW
          },
          required: [
            'parameter_name',
            'result',
            'unit',
            'reference_interval',
            'is_value_out_of_range',
            'numeric_result',
            'specimen_type',  // NEW
          ],
        },
      },
      missing_data: {
        type: 'array',
        items: {
          // ... existing missing_data schema unchanged ...
        },
      },
    },
    required: ['patient_name', 'patient_age', 'patient_date_of_birth', 'patient_gender', 'test_date', 'parameters', 'missing_data'],
  },
};
```

### 4. Sanitization Updates

**File:** `server/services/labReportProcessor.js`

Add sanitization for `specimen_type` in `sanitizeParameterEntry()`:

```javascript
const VALID_SPECIMEN_TYPES = new Set(['blood', 'urine']);

const sanitizeSpecimenType = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.toLowerCase().trim();
  return VALID_SPECIMEN_TYPES.has(normalized) ? normalized : null;
};

const sanitizeParameterEntry = (entry) => {
  // ... existing logic ...

  return {
    parameter_name: parameterName,
    result,
    unit,
    reference_interval: referenceInterval,
    is_value_out_of_range: !isWithinRange,
    numeric_result: numericResult,
    specimen_type: sanitizeSpecimenType(entry.specimen_type),  // NEW
  };
};
```

### 5. Persistence Layer Updates

**File:** `server/services/reportPersistence.js`

Update `buildLabResultTuples()` to include `specimen_type`:

```javascript
const buildLabResultTuples = (reportId, parameters) => {
  if (!Array.isArray(parameters) || parameters.length === 0) {
    return { text: null, values: [] };
  }

  const values = [];
  const valuePlaceholders = [];

  parameters.forEach((parameter, index) => {
    const rowId = randomUUID();
    const baseIndex = index * 15;  // Changed from 14 to 15

    values.push(
      rowId,
      reportId,
      index + 1,
      parameter.parameter_name ?? null,
      parameter.result ?? null,
      parameter.unit ?? null,
      parameter.reference_interval?.lower ?? null,
      parameter.reference_interval?.lower_operator ?? null,
      parameter.reference_interval?.upper ?? null,
      parameter.reference_interval?.upper_operator ?? null,
      parameter.reference_interval?.text ?? null,
      parameter.reference_interval?.full_text ?? null,
      parameter.is_value_out_of_range ?? null,
      parameter.numeric_result ?? null,
      parameter.specimen_type ?? null,  // NEW
    );

    const placeholders = Array.from({ length: 15 }, (_unused, offset) => `$${baseIndex + offset + 1}`);
    valuePlaceholders.push(`(${placeholders.join(', ')})`);
  });

  return {
    text: `
      INSERT INTO lab_results (
        id,
        report_id,
        position,
        parameter_name,
        result_value,
        unit,
        reference_lower,
        reference_lower_operator,
        reference_upper,
        reference_upper_operator,
        reference_text,
        reference_full_text,
        is_value_out_of_range,
        numeric_result,
        specimen_type
      )
      VALUES ${valuePlaceholders.join(', ')}
    `,
    values,
  };
};
```

### 6. Frontend UI Changes

**File:** `public/js/unified-upload.js`

Update `showResults()` function to display result count:

```javascript
function showResults(jobs, source) {
  // ... existing code ...

  jobs.forEach(job => {
    const row = document.createElement('tr');
    row.dataset.reportId = job.report_id || '';

    // Determine status and label
    let statusClass, statusLabel;
    if (job.status === 'completed') {
      statusClass = 'status-completed';
      const paramCount = job.parameters?.length ?? 0;
      statusLabel = `✅ ${paramCount} results`;
    } else {
      statusClass = 'status-failed';
      statusLabel = '❌ Error';
    }

    // ... rest of row building unchanged ...
  });
}
```

**Visual example:**
```
┌──────────────────────────┬─────────────────┬──────────────────┐
│ Filename                 │ Status          │ Action           │
├──────────────────────────┼─────────────────┼──────────────────┤
│ health_checkup.pdf       │ ✅ 39 results   │ View | View Orig │
│ blood_test.pdf           │ ✅ 14 results   │ View | View Orig │
│ mri_report.pdf           │ ✅ 0 results    │ View | View Orig │
│ corrupted.pdf            │ ❌ Error        │ Log              │
└──────────────────────────┴─────────────────┴──────────────────┘
```

### 7. Report Viewer Updates

**File:** `public/js/app.js` (or relevant viewer component)

Handle zero-result reports gracefully. The current viewer may already have empty-state handling (e.g., "No parameters detected"). Update the existing empty-state logic to:

1. Change message to: "No blood or urine test results found in this document."
2. Add a link to view original file: `/api/reports/${reportId}/original-file`
3. Ensure the "View Original" button remains visible/functional

Check current `app.js` implementation for exact DOM structure and update accordingly.

### 8. API Contract Update

The report detail endpoint (`GET /api/reports/:id` or equivalent) returns `lab_results` rows. Include `specimen_type` in the response so the UI can display it if needed (e.g., "(blood)" or "(urine)" badge next to parameters).

No separate API change required - just ensure the existing query includes the new column.

---

## Edge Cases

### 1. Document with Only Non-Blood/Non-Urine Tests

**Scenario:** User uploads an MRI report or cytology result with no blood/urine tests.

**Behavior:**
- `parameters` array is empty
- Report is still saved to `patient_reports` (file preserved)
- `lab_results` table has no rows for this report
- UI shows: "✅ 0 results"
- Report viewer shows: "No blood or urine test results found in this document."

**User can still:**
- View original file via "View Original" button
- See the report in their report list

### 2. Mixed Document with Ambiguous Tests

**Scenario:** Some tests could be from blood OR urine (e.g., creatinine appears in both).

**Behavior:** LLM uses document context to determine specimen type:
- Section headers: "Blood Chemistry" vs "Urine Analysis"
- Surrounding parameters: If grouped with hemoglobin → blood; if grouped with specific gravity → urine
- Reference ranges: Blood creatinine ~0.7-1.3 mg/dL vs urine creatinine varies widely

**Result:** Each parameter gets appropriate `specimen_type`, enabling correct trend queries.

### 3. Document with No Extractable Content

**Scenario:** Uploaded file is unreadable, encrypted, or contains only images without text.

**Behavior:**
- Existing error handling applies
- Job status: `failed`
- Error message preserved for UI

### 4. Partially Readable Document

**Scenario:** Some pages are clear, others are blurry or cut off.

**Behavior:**
- Extract what's readable (blood/urine parameters)
- `missing_data` array captures parameters with incomplete fields
- `specimen_type` set based on readable context

---

## Testing Strategy

### Manual Testing Checklist

**Test Case 1: Blood-Only Document**
- [ ] Upload a CBC + metabolic panel PDF
- [ ] Verify all parameters extracted with `specimen_type = 'blood'`
- [ ] UI shows "✅ N results"

**Test Case 2: Urine-Only Document**
- [ ] Upload a urinalysis report
- [ ] Verify all parameters extracted with `specimen_type = 'urine'`

**Test Case 3: Mixed Blood/Urine Document**
- [ ] Upload a comprehensive health checkup with blood + urine sections
- [ ] Verify blood parameters have `specimen_type = 'blood'`
- [ ] Verify urine parameters have `specimen_type = 'urine'`
- [ ] Verify no cytology/imaging mixed in

**Test Case 4: Non-Blood/Non-Urine Only**
- [ ] Upload a pure MRI or cytology report
- [ ] Verify `parameters` array is empty
- [ ] UI shows "✅ 0 results"
- [ ] Report viewer shows appropriate message
- [ ] Original file still accessible via "View Original"

**Test Case 5: Overlapping Analyte (Creatinine)**
- [ ] Upload document with both blood and urine creatinine
- [ ] Verify blood creatinine has `specimen_type = 'blood'`
- [ ] Verify urine creatinine has `specimen_type = 'urine'`
- [ ] SQL query can distinguish them: `WHERE specimen_type = 'blood'`

**Test Case 6: Gmail Integration**
- [ ] Import lab report email with blood test attachment
- [ ] Verify filtering and specimen_type work same as manual upload

---

## Rollout Plan

### Phase 1: Implementation
1. Add `specimen_type` column to database schema
2. Update OCR prompt with filtering instructions and specimen_type requirement
3. Update OCR schema to include `specimen_type` per parameter
4. Update sanitization to validate specimen_type values
5. Update persistence to store specimen_type
6. Update frontend to show result count and handle zero-result reports

### Phase 2: Testing
1. Manual testing with various document types
2. Verify existing blood/urine reports still extract correctly
3. Test overlapping analytes (creatinine, protein)
4. Test edge cases (MRI-only, mixed documents)

### Phase 3: Deployment (MVP)

**Pre-production approach (no live data):**
1. Drop existing database
2. Deploy all code changes
3. Start server (`npm run dev` auto-creates schema with new column)
4. Process fresh documents
5. Verify queries can filter by specimen_type

**Note:** No migration sequencing needed since we're dropping the DB. For future production deployments, proper ALTER TABLE migrations would be required.

---

## Future Considerations

### Expanding Test Types

If users request additional specimen types (e.g., stool, CSF), the changes would be:

1. Update OCR prompt to include new types
2. Update `VALID_SPECIMEN_TYPES` set in sanitization
3. No database schema changes needed (column already supports any string)

### Agentic SQL Awareness

Update SQL generation prompts to be aware of `specimen_type`:

```
When querying lab_results, be aware of the specimen_type column:
- 'blood': Parameters from blood tests (CBC, metabolic panels, etc.)
- 'urine': Parameters from urine tests (urinalysis, urine culture, etc.)

For analytes that can appear in both (creatinine, protein, glucose),
always clarify with the user or filter by specimen_type to avoid mixing.
```

---

## Appendix: File Changes Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `server/db/schema.js` | Modify | Add `specimen_type TEXT` column to lab_results |
| `prompts/lab_user_prompt.txt` | Modify | Add filtering instructions + specimen_type field |
| `server/services/labReportProcessor.js` | Modify | Add specimen_type to schema, add sanitization |
| `server/services/reportPersistence.js` | Modify | Store specimen_type in INSERT |
| `public/js/unified-upload.js` | Modify | Display result count in status |
| `public/js/app.js` | Modify | Handle zero-result reports in viewer |

**Estimated LOC:** ~80-100 lines changed/added

---

## Success Metrics

1. **Blood/urine focus**: 100% of extracted parameters are from blood or urine specimens
2. **Specimen tracking**: >95% of parameters have valid `specimen_type` value ('blood' or 'urine'). NULL acceptable only when LLM fails to classify (edge case).
3. **No data loss**: Original files always preserved regardless of content
4. **LLM accuracy**: <5% false negatives (blood/urine tests incorrectly skipped)
5. **Clean SQL queries**: Agentic SQL queries can filter by specimen_type for overlapping analytes
