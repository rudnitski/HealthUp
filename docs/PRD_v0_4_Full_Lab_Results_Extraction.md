# PRD v0.4 — Full Lab Results Extraction

## Purpose
Expand the HealthUp lab ingestion flow from single-parameter extraction (Vitamin D) to complete lab panel extraction so members receive a structured, comprehensible dataset for every uploaded report.

## Background
- Current experience extracts only a single parameter, forcing users to review raw PDFs for the remainder of their results.
- Users have requested a consolidated, comparable view across all biomarkers to support trending and insights.
- The team already operates an OCR + parsing pipeline for Vitamin D. This PRD extends the extraction logic, normalization, and UI payloads to all measurable parameters in the report.

## Goals & Non-Goals
- **Goals**
  - Capture every measurable laboratory parameter available in the uploaded report, including repeats across pages.
  - Normalize terminology (e.g., "HDL Cholesterol" vs. "HDL") and units so downstream components can chart or compare values.
  - Preserve contextual information (reference interval, flags, specimen metadata) required for interpretation.
  - Detect and surface out-of-range indicators when they can be determined from the report.
  - Provide a deterministic, documented output contract that product and data teams can rely on.
- **Non-Goals**
  - Creating medical advice, trending, or insights beyond flagging out-of-range values.
  - Editing the original document or correcting laboratory errors.
  - Building clinician-facing tooling or workflows.
  - Persisting structured results to Postgres (tracked for a later milestone).

## Personas & Primary Use Cases
- **HealthUp Member (consumer)** wants a consolidated view of all biomarkers from their lab paperwork without retyping values.
- **HealthUp Coach / Support** needs a quick way to confirm values the member references during a session.

Primary use cases:
1. Comprehensive metabolic panel PDF with multiple tables across several pages.
2. Focused report containing only one or two biomarkers (e.g., follow-up Vitamin D test).
3. Report where some biomarkers are presented as text paragraphs rather than tables.

## User Stories
- As a member, I want to upload a lab report and receive all parameters with values, units, reference intervals, and flags so I can understand the full results in one place.
- As a coach, I want to see the structured output in the HealthUp console so I can reference client labs during calls without reading the PDF.

## Scope
- **Input file types**: PDF (digital or scanned), PNG, JPG. Multi-page documents up to 10 pages / 10 MB. Reports may be in any language; text is preserved in the original language with no automatic translation.
- **Output**: Structured payload containing every detected parameter entry with normalized naming, value, unit, reference interval, temporal metadata, and status indicators.
- **In scope**
  - Support for table-based layouts, mixed single/multi-column text, and multi-page reports.
  - Extraction of qualitative results (e.g., "Positive", "Negative") as parameter values.
  - Capturing metadata when available (e.g., specimen type, collection date, lab-provided flags).
  - Explicit notation when data points (unit, reference interval, value) are missing.
  - Maintaining parameter names and contextual text in the language of the source document.
  - Capturing the date the lab test was performed and, if missing, substituting the closest available lab-provided date (e.g., result ready, processing completed).
- **Out of scope**
  - Translating non-English reports.
  - External lookups of reference intervals when absent from the report.
  - Automatically correcting OCR errors beyond standard spell-check heuristics already in the pipeline.

## Workflow Overview
1. Member uploads a report via mobile or web.
2. File is routed to the existing ingestion service (OCR, layout analysis, entity extraction).
3. Extraction module identifies parameter rows/phrases, canonicalizes names, and parses values, units, intervals, and lab dates.
4. Post-processing normalizes units, interprets interval comparisons, and flags out-of-range results.
5. Structured payload is returned to the frontend/coach console; persistence will follow once the Postgres store is introduced.
6. Member sees the results in the Lab Results UI alongside the original document.

## Functional Requirements
### Input Handling
- Reject unsupported file types with actionable messaging.
- Detect unreadable scans (e.g., empty OCR output, low confidence) and request a re-upload.
- Associate uploads with user, collection date (if present), and source lab metadata.

### Extraction & Normalization
- Identify each parameter name, handling synonyms, abbreviations, and split labels (e.g., line breaks within a cell).
- Parse numeric values, ranges, inequality markers (`<`, `>`), ratios, and qualitative strings.
- Capture units exactly as written while mapping to a canonical unit code list when possible.
- Capture reference intervals including separate male/female or age-specific ranges if presented.
- Preserve any lab-provided abnormality flags (e.g., `H`, `L`, `Critical`).
- Allow multiple entries for the same parameter when the report provides different specimens or time points.
- Retain original-language text even when canonical codes exist, so downstream UIs can display localized copy.

### Lab Date Capture & Normalization
- Extract the date the test was performed (collection or draw date) whenever present; store as the primary lab date.
- When the test date is absent, use the closest available lab-generated date (e.g., "results ready", "tests processed") and record the source used for traceability.
- Capture additional dates when available (e.g., result release, specimen received) to support auditing and analytics.
- Normalize all captured dates to ISO 8601 format with timezone when provided; otherwise default to the facility’s reported timezone or UTC with a noted assumption.

### Interpretation & Flagging
- Mark each parameter as `out_of_range` when both a value and reference interval/flag enable that determination.
- Include interpretation notes describing how the flag was computed (e.g., "Value above upper bound").
- If interval data is missing, mark `out_of_range` as `unknown` rather than assuming normal.

### Output & Delivery
- Provide a machine-readable JSON payload with stable field names for downstream services.
- Include provenance metadata: page number, table identifier, or textual position when available.
- Surface summary statistics to the UI (e.g., count of parameters, number flagged) for quick validation.

### Error Handling & Reporting
- When extraction confidence falls below a defined threshold, return a `needs_review` status and attach the partial payload.
- Log parsing failures with enough context (file ID, page, OCR text snippet) for debugging.

## Output Contract
Every extraction returns a JSON object:

```json
{
  "report_id": "uuid",
  "user_id": "uuid",
  "processed_at": "2024-07-21T18:30:00Z",
  "status": "success | needs_review | failed",
  "lab_dates": {
    "primary_test_date": "2024-07-15",
    "primary_test_date_source": "collection_date",
    "secondary_dates": [
      {
        "type": "results_ready",
        "value": "2024-07-17",
        "source_text": "Results ready: 07/17/2024"
      }
    ]
  },
  "summary": {
    "parameters_total": 18,
    "parameters_flagged": 2
  },
  "parameters": [
    {
      "parameter_name": "Vitamin D, 25-Hydroxy",
      "canonical_code": "LOINC-1989-3",
      "value": 22.5,
      "value_text": null,
      "unit": "ng/mL",
      "reference_interval": {
        "lower": 30,
        "upper": 100,
        "text": "30-100 ng/mL"
      },
      "lab_flag": "L",
      "out_of_range": "below",
      "specimen": "Serum",
      "page": 2,
      "notes": "Flagged because value below lower bound"
    }
  ],
  "missing_data": [
    {
      "parameter_name": "Calcium",
      "missing_fields": ["unit"]
    }
  ]
}
```

- `canonical_code` references HealthUp's mapping (e.g., LOINC) when available; null otherwise.
- `value` is numeric when parseable; `value_text` captures qualitative results (e.g., "Positive").
- `out_of_range` values: `above`, `below`, `flagged_by_lab`, `within`, `unknown`.
- `missing_data` section highlights where the extraction could not find required details.
- `lab_dates.primary_test_date` represents the date the user actually took the test whenever available; when a fallback is used, `primary_test_date_source` reflects the chosen field.

## Edge Cases & Examples
- Reports using inequality markers (`<5`, `>200`) for limits.
- Separate reference ranges by gender/age presented in stacked rows.
- Parameters listed without units; units referenced in column headers only.
- Qualitative microbiology results (e.g., "No growth").
- Panels spanning multiple pages where header rows repeat or are omitted.
- Reports where the same parameter appears multiple times with different specimens.
- Scanned documents with skewed text or handwritten amendments.
- Non-English reports where parameter names remain in the source language but are still mapped to canonical codes when possible.
- Reports that omit the collection date but include a "results ready" date, requiring fallback logic.

## Non-Functional Requirements
- **Accuracy & Coverage**: ≥95% parameter recall on high-quality (>=300 DPI) reports in the validation set; false flag rate <5% when reference intervals are present.
- **Performance**: End-to-end processing <30 seconds for a 5-page PDF under typical load.
- **Reliability**: 99% of requests succeed without manual retry across rolling 7-day period.
- **Security & Compliance**: All processing occurs within HIPAA-compliant infrastructure; PHI is encrypted in transit and at rest; access is audited.
- **Observability**: Instrument extraction confidence, failure types, time-to-process, and lab-date source selections for monitoring dashboards.

## Dependencies & Assumptions
- Updated canonical parameter dictionary and unit mappings maintained by the data team, including multilingual aliases where available.
- OCR service (Tesseract + layout analyzer) continues to meet current accuracy benchmarks across supported languages.
- Postgres-backed persistence will be addressed in a follow-on milestone; v0.4 focuses on accurate extraction.
- QA dataset of at least 100 annotated lab reports will be available for validation.
- HealthUp relies solely on data present in the lab report for reference intervals; no enrichment from external knowledge bases.
- Reports may contain multiple temporal fields; ingestion must prioritize the actual test date when provided and document any fallback used.

## Decisions
- Reference intervals are trusted as provided in the source document; missing intervals remain missing and are flagged as such.
- Reports are ingested and displayed in their original language; no translation layer is introduced in v0.4.
- Lab date extraction prioritizes the actual test/collection date and falls back to the nearest available lab-reported date when required.

## Acceptance Criteria
- Every supported report returns a structured payload with all detected parameters, even when some fields are missing.
- Parameter name, value (numeric or text), and unit are present whenever they appear in the source document.
- Reference intervals and lab flags are captured when provided; missing intervals are explicitly marked.
- `out_of_range` status is populated based on reference data or lab-provided flag; `unknown` is used when insufficient information exists.
- Lab date metadata includes the primary test date and identified source; fallback usage is recorded when necessary.
- JSON payload validates against the documented schema and passes automated contract tests.
- Confidence, processing metrics, and lab-date source selections are logged for each extraction event.

## Test Scenarios
1. Multi-panel PDF combining tables and free text → ensure every parameter is captured with correct context.
2. Report with missing units for some parameters → units marked as missing; other fields still populated.
3. Report with gender-specific reference intervals → correct pairing of values to appropriate interval.
4. Report containing inequality values (`<5`) → parsed as numeric limit with correct flag determination.
5. Report with qualitative microbiology results → values stored in `value_text` and flagged as non-numeric.
6. Report where the same parameter appears twice for different specimens → both entries captured with specimen metadata.
7. Low-quality scan with OCR confidence below threshold → output marked `needs_review`, partial data retained.
8. Single-parameter report → still returns structured payload with one entry and summary counts=1.
9. Report missing reference intervals entirely → `out_of_range` marked `unknown`, missing intervals listed in `missing_data`.
10. Report containing out-of-range lab-provided flags → flags reflected in payload and summary counts.
11. Non-English report (e.g., Spanish) → parameter names retained in Spanish while still mapped to canonical codes and flagged correctly.
12. Report lacking collection date but including a "results ready" date → fallback populates `primary_test_date` with source marked `results_ready`.

## Open Questions
_None._
