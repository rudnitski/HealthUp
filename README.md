# HealthUp

HealthUp converts raw lab PDFs/images into structured longitudinal data and exposes a guarded self-serve analytics surface. The Express monolith handles OCR with OpenAI/Anthropic, deduplicates and persists reports in Postgres, maps analytes to a canonical vocabulary, and layers on agentic SQL, chart-ready responses, and Gmail-based ingestion tooling.

## Product Surface
- **Lab ingestion UI (`public/index.html`)** – async job pipeline (single + batch) with progress polling, PDF-to-image conversion via `pdftoppm`, strict JSON extraction, and persistence safeguards (patient/report dedupe, checksum-based retries).
- **Analyte mapping & admin review (`public/admin.html`)** – automatic tiered mapping (`server/services/MappingApplier.js`) feeds pending queues; admins approve/discard matches and drive backfills directly against `lab_results`.
- **Warehouse exploration (SQL + charts)** – `/api/sql-generator` turns natural language into validated SQL with agentic tooling, audit logging, and optional auto-execution/plotting in `public/js/plotRenderer.js`.
- **Patient context views** – `/api/reports/*` serves persisted payloads to render longitudinal parameter tables, reference bands, and out-of-range badges.
- **Gmail dev harness (`public/gmail-dev.html`)** – OAuth flow, inbox triage, attachment ingestion, body classification, and duplicate detection so the same OCR pipeline can run headlessly.

## System Architecture
```
Browser (index.html, admin.html, gmail-dev.html)
   │
   ▼
Express app (server/app.js)
   ├─ /api/analyze-labs → routes/analyzeLabReport.js → jobManager → labReportProcessor → MappingApplier → Postgres
   ├─ /api/sql-generator & /api/execute-sql → SQL generator, validator, agentic tools, schema snapshot cache
   ├─ /api/admin → admin queue actions, analyte CRUD, audit logging
   ├─ /api/dev-gmail → gmailConnector, bodyClassifier, gmailAttachmentIngest
   └─ /api/reports → reportRetrieval service for UI detail views
PostgreSQL (patients, patient_reports, lab_results, analytes*, aliases*, pending queues, admin_actions, sql_generation_logs, gmail_report_provenance, view v_measurements)
LLM providers (OpenAI, Anthropic) + Google APIs (Gmail OAuth+metadata)
```

## Key Modules & Directories
- `server/app.js` – bootstraps schema (`server/db/schema.js`), file uploads, route wiring, graceful shutdown.
- `server/services/labReportProcessor.js` – orchestrates OCR, structured output enforcement, sanitization, persistence (`reportPersistence.js`), and progress reporting.
- `server/services/MappingApplier.js` – multi-tier analyte matching (exact, pg_trgm fuzzy, LLM) with configurable thresholds and logging.
- `server/services/sqlGenerator.js` + `agenticSqlGenerator.js` + `sqlValidator.js` – schema-aware NL → SQL conversion with guardrails (`config/schema_aliases.json`, schema snapshot cache, validation limits).
- `server/routes/gmailDev.js` + `services/gmailAttachmentIngest.js` – Gmail OAuth, inbox metadata fetch, attachment batching, duplicate prevention via `gmail_report_provenance`.
- `public/js/*.js` – upload UI, admin dashboard, Gmail control plane, and plot renderer.
- `scripts/` – operational helpers (`verify_mapping_setup`, `backfill_analyte_mappings`, `setup_db`).

## Data Model Highlights
- **patients / patient_reports / lab_results** – normalized hierarchy; reports enforce `(patient_id, checksum)` uniqueness to avoid duplicate ingestion.
- **analytes / analyte_aliases / pending_analytes / match_reviews** – canonical vocabulary, multilingual aliasing, LLM-proposed additions, and admin review queues.
- **sql_generation_logs** – audit every NL → SQL request with prompt metadata and validation outcome.
- **gmail_report_provenance** – attachment-level lineage for Gmail ingest batches.
- **v_measurements** – convenience view powering charting + parameter tables.

## Local Development
1. **Install prerequisites**
   - Node.js 18+ and npm
   - PostgreSQL 14+ with `pg_trgm` + `pgcrypto` extensions enabled
   - Poppler (`pdftoppm`) for PDF rasterization
2. **Create database (UTF-8 locale is required)**
   ```sh
   psql postgres -c "CREATE USER healthup_user WITH PASSWORD 'healthup_pass' LOGIN;"
   psql postgres -c "CREATE DATABASE healthup OWNER healthup_user ENCODING 'UTF8' LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8' TEMPLATE template0;"
   ```
3. **Configure environment**
   - Copy `.env.example` (or create `.env`) with the variables in the table below.
   - The app loads `.env` automatically in non-production.
4. **Install dependencies & run**
   ```sh
   npm install
   npm run dev
   ```
   Server boots on `http://localhost:3000`, runs `ensureSchema()`, validates OCR config, and serves static assets from `public/`.
5. **Verify analyte mapping readiness**
   ```sh
   node scripts/verify_mapping_setup.js
   ```
6. **Optional: Gmail dev harness**
   - Create Google OAuth credentials (web app) and set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GMAIL_OAUTH_REDIRECT_URI`.
   - Set `GMAIL_INTEGRATION_ENABLED=true` (dev only) and restart the server.
   - Visit `/gmail-dev.html` to authenticate, triage, and ingest attachments.

## Configuration
| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | ✅ | Postgres connection string used by `server/db/index.js`. |
| `OPENAI_API_KEY` | ✅ | Required for OCR (OpenAI provider), agentic SQL, mapping Tier C, and classifiers. |
| `OCR_PROVIDER` | optional | `openai` (default) or `anthropic`; determines which `VisionProvider` runs. |
| `OPENAI_VISION_MODEL` / `ANTHROPIC_API_KEY` | optional | Needed when overriding the default OCR model or using Anthropic, respectively. |
| `SQL_GENERATION_ENABLED`, `AGENTIC_SQL_ENABLED`, `SQL_GENERATOR_MODEL`, `ALLOW_MODEL_OVERRIDE` | optional | Toggle NL→SQL mode and model selection; see `server/services/sqlGenerator.js`. |
| `ADMIN_API_KEY` | optional | Required to bust schema cache via `/api/sql-generator/admin/cache/bust`. |
| `BACKFILL_SIMILARITY_THRESHOLD`, `MAPPING_AUTO_ACCEPT`, `MAPPING_QUEUE_LOWER`, `LOG_LEVEL` | optional | Tune Mapping Applier thresholds/logging. |
| `GMAIL_INTEGRATION_ENABLED`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GMAIL_OAUTH_REDIRECT_URI`, `GMAIL_TOKEN_PATH`, `GMAIL_MAX_EMAILS`, `GMAIL_MAX_ATTACHMENT_MB` | optional | Enable dev-only Gmail ingestion and control rate/size limits. |
| `PORT` | optional | HTTP port (defaults to `3000`). |

Other guardrails (e.g., `AGENTIC_MAX_ITERATIONS`, `SQLGEN_MAX_JOINS`, `SQL_VALIDATION_BYPASS`, `SCHEMA_WHITELIST`, `REQUIRE_PG_TRGM`) are documented inline in their respective modules—search for `process.env` to discover the full list when tuning production.

## Tooling & Scripts
- `npm run dev` – start the Express server (loads schema + static UI).
- `npm test` – runs Jest; currently houses manual harnesses under `test/manual`.
- `node scripts/verify_mapping_setup.js` – confirms indexes, extensions, and thresholds before ingesting.
- `node scripts/backfill_analyte_mappings.js` – replays auto-mapping against historical `lab_results` (advisory-lock guarded).
- `node scripts/setup_db.sh` – convenience bootstrap for new environments.

## Docs & Specs
- Product requirement docs live under `docs/` (e.g., agentic SQL, analyte mapping write mode, Gmail integration, unified ingest).
- Prompt templates live in `prompts/` and inform OCR + SQL behavior.
- Schema aliases for user-facing names live in `config/schema_aliases.json`; keep this file in sync with schema additions.

## Known Constraints & Next Steps
- OCR and mapping rely on OpenAI unless Anthropic keys are configured; lack of keys disables ingestion but keeps SQL/admin online.
- Mapping auto-accept thresholds are conservative; medium-confidence matches still require manual adjudication.
- Gmail harness is dev-only; production ingest should run via a background scheduler once rate-limit and duplicate-handling hardening lands.
- Parameter table calculates “out of range” client-side when backend values are missing; consider persisting `is_value_out_of_range` consistently.

Reading this README plus the inline comments referenced above should give new contributors enough context to ingest lab data, review mappings, experiment with SQL, and extend the ingestion surface confidently.
