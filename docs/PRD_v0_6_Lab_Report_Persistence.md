# HealthUp Lab Report Persistence PRD

## Goal
Persist each recognized lab report—patient metadata plus extracted tests—so the application can retrieve historical results per patient later.

## Success Metrics
- 100% of recognized reports stored with structured data in PostgreSQL.
- Patient/report/test retrieval completes in under one second.
- No data loss between recognition and storage stages.

## Scope
- Save parsed patient details and all extracted tests per recognition event.
- Allow multiple reports per patient and maintain associations between them.
- Provide read APIs/services for later retrieval of patient reports and detailed results.
- Enforce data integrity across patients, reports, and tests.

### Out of Scope
- Raw file storage.
- Authentication, authorization, or broader compliance tooling.
- UI for browsing patient histories.
- Manual editing of stored records.
- External export or sharing workflows.
- Parser reprocessing features.

## Functional Requirements
- The `analyzeLabReport` flow writes patient, report, and test data in one transaction and surfaces failures in logs and responses.
- Report metadata captured: `report_id`, `patient_id`, source filename, checksum, parser version, timestamps (`recognized_at`, `created_at`, `updated_at`), and parsing status.
- Patient data persisted or updated using current identifiers (full name for now) plus demographic fields such as DOB and sex.
- Each lab test row stored with test name/code, value, units, reference range, interpretation flag, `collected_at`, notes, and a foreign key to the report.
- Support many reports per patient; preserve chronological ordering via `recognized_at`.
- Retrieval endpoints/services:
  - list patient reports with summary metadata;
  - fetch a single report with all associated tests.
- Prevent duplicates via checksum + patient constraints; disallow orphaned lab results.
- Provide SQL migrations/scripts for schema changes.

## Non-Functional Requirements
- Reliability: transactional writes, retry/background queue if persistence fails, structured logging/monitoring.
- Performance: writes complete within two seconds; read endpoints respond within one second and support pagination.
- Maintainability: separate modules for parsing, persistence, and retrieval; support parser versioning.

## Data Model Changes
- `patients`: ensure stable identifier (full name for now) and include DOB/sex fields if missing.
- `patient_reports`: fields include `id`, `patient_id` (FK), `source_filename`, `checksum`, `parser_version`, `recognized_at`, `created_at`, `updated_at`, `status`.
- `lab_results`: fields include `id`, `report_id` (FK), `test_code`, `test_name`, `value`, `unit`, `reference_range`, `interpretation_flag`, `collected_at`, `analyzer_notes`.
- Indexes: `(patient_id, recognized_at)` on `patient_reports`; `report_id` on `lab_results`; unique checksum constraint per patient.

## System Workflows
- **Recognition:** upload → parser extracts data → persistence module upserts patient, creates report, bulk inserts tests → emit success/failure.
- **Retrieval:** client/service requests patient history → service returns reports (metadata only) → client fetches detailed report as needed.
- **Parser Versioning:** store `parser_version` to allow future comparison if reprocessing becomes necessary.

## Dependencies
- Existing `analyzeLabReport` route and parsing services.
- PostgreSQL database and migration tooling in the backend stack.
- Logging infrastructure for monitoring persistence outcomes.

## Assumptions
- Database migrations can be applied without downtime.
- Patient records are keyed by full name for now; stronger deduplication may be required later.
- Typical report contains ≤100 lab results, but implementation should not hard-limit the count.
- No background reprocessing or manual triggers in this phase.

## Risks and Mitigations
- Duplicate patient records → implement matching heuristics and plan for manual reconciliation.
- Partial writes → use transactions and retries with logging.
- Schema drift → versioned migrations with backward-compatible API responses.
- Large test payloads → prefer batch inserts and paged reads.

## Validation and Testing
- Unit tests for persistence and retrieval modules.
- Integration tests covering the full flow from sample report upload to database verification.
- Concurrency/load tests for multiple simultaneous uploads.
- QA checklist covering duplicate detection, multiple report ordering, and error logging.

## Open Questions
- Do we need any additional patient identifiers beyond full name before release?
- Which migration tool (e.g., Knex, Sequelize) should own the schema changes?
- Are there reporting/analytics hooks that should subscribe to new data events?

## Milestones
1. Requirements sign-off and schema design.
2. Database migrations and ORM model updates.
3. Persistence service implementation and integration with analyzer flow.
4. Retrieval endpoints/service layer.
5. Automated tests and QA validation.
6. Deployment with monitoring updates.
