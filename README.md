# HealthUp

HealthUp transforms raw lab reports into structured longitudinal data and provides a guided analytics surface for the product team. The platform ingests PDFs and images, extracts normalized measurements with OpenAI, persists them to Postgres, and exposes a natural-language SQL interface (with optional charting) to explore the warehouse safely.

## Core Capabilities
- Full lab report ingestion pipeline (PDF/image → OpenAI Vision → normalized payload).
- Patient/report persistence with deduplication and re-processing safeguards.
- Lab result retrieval APIs for downstream tooling.
- Agentic natural-language SQL generation with schema-aware tooling, validation, and audit logging.
- Automatic analyte mapping pipeline that aligns extracted parameters to canonical analytes with multi-tier matching (exact, fuzzy, LLM).
- Plot-ready SQL responses and client-side visualization (with parameter selector) for multi-parameter time-series lab trends.
- Parameter table view displaying exact measurement values alongside time-series plots with out-of-range highlighting.

## Architecture Overview

HealthUp is a Node.js/Express monolith with a static front-end. Most business logic lives in `server/services` and is orchestrated by API routes.

```
Browser UI (public/index.html, admin.html, js/app.js, js/admin.js, js/plotRenderer.js)
  ↕︎ HTTPS /api/*
Express App (server/app.js)
  ├─ /api/analyze-labs → routes/analyzeLabReport.js → services/reportPersistence.js, MappingApplier.js
  ├─ /api/sql-generator → routes/sqlGenerator.js → services/sqlGenerator.js → agenticSqlGenerator.js / promptBuilder.js / sqlValidator.js
  ├─ /api/execute-sql → routes/executeSql.js
  ├─ /api/admin/* → routes/admin.js (pending-analytes, ambiguous-matches, approve, discard, resolve)
  └─ /api/patients/:id/reports, /api/reports/:id → routes/reports.js → services/reportRetrieval.js
PostgreSQL (patients, patient_reports, lab_results, analytes, analyte_aliases, pending_analytes, match_reviews, admin_actions, sql_generation_logs, view v_measurements)
OpenAI APIs (Vision for extraction, Text for SQL & mapping)
```

## Backend Modules

### Express Application (`server/app.js`)
- Bootstraps `.env` in non-production and verifies database connectivity via `ensureSchema()` and `healthcheck()`.
- Serves static assets from `public/` and attaches JSON + multipart middleware (`express-fileupload` with a 10 MB cap).
- Mounts feature routers (`/api/analyze-labs`, `/api/sql-generator`, `/api/execute-sql`, `/api/...` for reports) and exposes `/health/db`.
- Coordinates graceful shutdown (closes HTTP listener, schema snapshot listener, and PG pool).

### Lab Report Analysis (`server/routes/analyzeLabReport.js`, `server/services/labReportProcessor.js`)

**Async Job Processing Architecture**: Lab report analysis uses async job processing with polling to handle long-running requests (20-60+ seconds) that would otherwise trigger Cloudflare 524 timeouts. The upload returns immediately (202 Accepted), processing happens in the background, and the client polls for completion.

**API Flow**:
1. `POST /api/analyze-labs` → Validates uploads (`analysisFile`, 10 MB, PDF or image), creates job via `jobManager.createJob()`, starts background processing with `labReportProcessor.processLabReport()`, and returns **202 Accepted** with `job_id`.
2. `GET /api/analyze-labs/jobs/:jobId` → Returns job status (`pending`, `processing`, `completed`, `failed`) with progress (0-100%), optional `progressMessage`, and final `result` when complete.

**Processing Pipeline** (`labReportProcessor.processLabReport()`):
1. Validates uploads and updates job progress (5% - File uploaded).
2. For PDFs, limits to 10 pages and converts pages to PNG via `pdftoppm` (configurable with `PDFTOPPM_PATH`). Progress: 10-35%.
3. Calls OpenAI Vision (`OpenAI Responses API`) with prompts from `prompts/lab_system_prompt.txt` and `prompts/lab_user_prompt.txt`, requesting a strict JSON schema. Progress: 40-70%.
4. Parses and sanitizes the model output (normalizes strings, units, reference intervals, numeric values). Progress: 75%.
5. Persists the report through `services/reportPersistence.js` (progress: 80-85%), which:
   - Upserts patients keyed by normalized full name.
   - De-duplicates reports by (patient, SHA-256 checksum) and overwrites `lab_results` atomically.
   - Writes metadata snapshots, missing fields, and raw model output.
6. Automatically invokes the Mapping Applier (progress: 90-95%) to map extracted parameters to canonical analytes.
7. Sets job status to `completed` (progress: 100%) with final result, or `failed` with error message.

**Job Management** (`server/utils/jobManager.js`):
- In-memory job tracking with automatic cleanup after 1 hour.
- Thread-safe Map-based storage supporting concurrent uploads.
- Progress tracking with optional status messages shown in UI.
- Jobs survive across multiple client polling requests during processing.

**Frontend** (`public/js/app.js`):
- Polls job status every 2 seconds (max 4 minutes = 120 attempts).
- Updates UI with progress messages: "Analyzing with AI", "Mapping analytes", etc.
- Displays results when job completes or shows error on failure/timeout.
- Backwards compatible with synchronous responses (200 OK) if needed.

Failures in the mapping phase are logged but do not fail ingestion. All persistence errors are wrapped in `PersistLabReportError` with debugging context. The async architecture prevents Cloudflare 524 timeouts by decoupling upload acknowledgment from processing completion.

### Mapping Applier (`server/services/MappingApplier.js`)
- Runs an ordered tiered strategy to align extracted `lab_results` to canonical analytes:
  - Tier A: exact alias lookup on `analyte_aliases`.
  - Tier B: trigram-similarity fuzzy match (requires `pg_trgm`).
  - Tier C: OpenAI-assisted suggestions when deterministic tiers fail.
- Automatically writes high-confidence matches (≥ `MAPPING_AUTO_ACCEPT` threshold) directly to `lab_results.analyte_id`.
- Queues medium-confidence matches (≥ `MAPPING_QUEUE_LOWER`) to `match_reviews` for human review.
- Queues new analyte proposals to `pending_analytes` for admin approval.
- Produces structured `pino` logs per row (`MATCH_EXACT`, `MATCH_FUZZY`, `AMBIGUOUS_FUZZY`, etc.) summarizing confidence scores and thresholds (configurable via `BACKFILL_SIMILARITY_THRESHOLD`, `MAPPING_AUTO_ACCEPT`, `MAPPING_QUEUE_LOWER`).
- Utilities include analyte schema exporters and normalization helpers shared across tiers.

### Report Retrieval (`server/services/reportRetrieval.js`)
- `getPatientReports(patientId, { limit, offset })` returns paginated summaries with patient metadata.
- `getReportDetail(reportId)` returns the denormalized view used by the UI, including sanitized `lab_results` and missing-data hints.
- Both endpoints surface ISO timestamps and coerce numbers/JSON for consistent client handling.

### Schema Snapshot & Prompt Builder
- `server/services/schemaSnapshot.js` keeps an in-memory manifest of whitelisted database schemas (`SCHEMA_WHITELIST`, default `public`) and listens for Postgres `NOTIFY` events to invalidate the cache.
- Produces a deterministic `schemaSnapshotId` (SHA-256) that is logged with every SQL generation event; also maintains an MRU list of tables to bias prompt ranking.
- `server/services/promptBuilder.js` scores tables and columns against the user question, folds in alias mappings from `config/schema_aliases.json`, and enforces token budgets when building prompt context.

### SQL Generation (`server/services/sqlGenerator.js`)
- Guards feature access via `SQL_GENERATION_ENABLED` and caps question length at 500 characters.
- Supports two execution modes:
  - **Agentic loop** (`AGENTIC_SQL_ENABLED === 'true'`): orchestrated by `agenticSqlGenerator.js`.
    - Loads a specialized system prompt (`prompts/agentic_sql_generator_system_prompt.txt`).
    - Iterates up to `AGENTIC_MAX_ITERATIONS` (default 5) with a global timeout (`AGENTIC_TIMEOUT_MS`, default 120 s).
    - Exposes tool calls defined in `agenticTools.js`:
      - `fuzzy_search_parameter_names` (privileged trigram search on `lab_results`).
      - `fuzzy_search_analyte_names` (trigram search on `analytes`).
      - `execute_exploratory_sql` (validator-enforced read-only queries with limit & timeout).
      - `generate_final_query` (emits final SQL plus explanation, query_type, and plot metadata).
    - On success, validates with `sqlValidator.js`, injects `LIMIT` safeguards, updates MRU table scores, and logs to `sql_generation_logs`.
    - On repeated validation failure or timeout, returns structured error payloads suitable for the UI.
  - **Single-shot** (fallback): builds classic system/user prompts (`prompts/sql_generator_*.txt`) and requests JSON output (`{ sql, explanation }`).
- Every attempt is audit-logged (hashed user id/question/sql for privacy) using `pino` and persisted via `logSqlGeneration()` when agentic mode is active.

### SQL Validation (`server/services/sqlValidator.js`)
- Normalizes and checks SQL statements before execution.
- Rejects multi-statement payloads, write operations, disallowed functions (`pg_sleep`, `pg_read_file`, etc.), and placeholder syntax.
- Enforces configurable ceilings: `SQLGEN_MAX_JOINS` (default 5), `SQLGEN_MAX_SUBQUERIES` (default 2), `SQLGEN_MAX_AGG_FUNCS` (default 10).
- Automatically appends a `LIMIT` clause if the model omitted it (cap: `LIMIT 10000` for `plot_query`, `LIMIT 50` otherwise) so `/api/execute-sql` only runs bounded queries.
- For `plot_query` responses, rejects SQL missing the required aliases `t`, `y`, `parameter_name`, or `unit`, preventing UI regressions when multiple analytes are returned.

### SQL Execution (`server/routes/executeSql.js`)
- Executes validated SQL emitted by the generator and returns `{ rows, rowCount, fields }`.
- Rejects any query that is not `SELECT`/`WITH` or that lacks a `LIMIT`.
- Applies a 30 s statement timeout and surfaces common Postgres error codes (`42P01`, `42703`) with user-friendly messages.

## Frontend Experience

The static UI (`public/`) provides both the ingestion workflow and analytics surface:

### Main Application (`index.html`, `js/app.js`, `js/plotRenderer.js`)
- `index.html` hosts the upload form, SQL generator, and the plot visualization wrapper with its dynamic parameter selector and table container. External dependencies (Chart.js, zoom/datalabels plugins) load via CDN.
- `css/style.css` styles the progress timeline, SQL panels, plot view, parameter selector panel, and the parameter table view using CSS Grid layout for responsive positioning.
- `js/app.js`
  - Manages file selection, drives `/api/analyze-labs`, and renders the progress timeline based on the server's `pipelineProgress`.
  - Fetches persisted report detail (`/api/reports/:id`) to render structured lab result cards and raw JSON.
  - Orchestrates the SQL generation panel: throttles requests, copies SQL to clipboard, tracks regeneration, wires plot payloads to the renderer, and filters plot data client-side when users switch parameters.
  - Renders the parameter table view (`renderParameterTable`) with formatted dates, values, units, and reference intervals. Highlights out-of-range values with red outline styling. Synchronizes table updates with parameter selector changes (PRD v2.6).
- `js/plotRenderer.js`
  - Registers Chart.js plugins (zoom, datalabels) when available.
  - Groups rows by unit, overlays reference bands, and highlights out-of-range points for time-series visualization (PRD v2.1/v2.2).
  - Exposes a `renderPlot` helper that expects the SQL response format produced by agentic `plot_query` results.

### Admin Panel (`admin.html`, `js/admin.js`)
- Provides review interfaces for analyte mapping outputs (PRD v2.4):
  - **Pending Analytes**: Review LLM-proposed new analytes with evidence and parameter variations. Approve or discard with rationale.
  - **Ambiguous Matches**: Resolve medium-confidence matches by selecting the correct canonical analyte from candidate list.
- Displays match evidence, confidence scores, and parameter context for informed decision-making.
- All actions are logged to `admin_actions` audit trail with timestamps and rationale.

## Data Model

`server/db/schema.js` provisions the relational schema at boot. Key entities (consolidated in PRD v2.5):

| Table / View | Purpose |
| --- | --- |
| `patients` | Master patient records keyed by UUID with normalized name, DOB, gender, and last-seen timestamp. Includes `created_at`, `updated_at`. |
| `patient_reports` | Individual ingested lab reports (unique per patient+checksum) with parser metadata, raw model output, and missing-field hints. Includes `created_at`, `updated_at`. |
| `lab_results` | Parsed parameter rows per report with position ordering, normalized units, reference ranges, numeric coercions, and mapping metadata (`analyte_id`, `mapping_confidence`, `mapped_at`, `mapping_source`). Includes `created_at`. |
| `analytes` | Canonical analyte catalog (code, name, optional category) used for mapping. Includes `created_at`, `updated_at`. |
| `analyte_aliases` | Locale-aware alias table with both normalized (`alias`) and display forms (`alias_display`). Requires `pg_trgm` for fuzzy search, indexed on `LOWER(alias)`. Includes `created_at`. |
| `pending_analytes` | LLM-proposed NEW analytes awaiting admin review with evidence, parameter variations, and status tracking (`pending`, `approved`, `discarded`). Includes `created_at`, `updated_at`, `approved_at`, `discarded_at`. |
| `match_reviews` | Ambiguous/medium-confidence matches awaiting admin disambiguation with candidate array and resolution tracking. Includes `created_at`, `updated_at`, `resolved_at`. |
| `admin_actions` | Audit trail for all admin actions (approve/discard analytes, resolve matches). Includes `created_at`. |
| `sql_generation_logs` | Audit records for agentic SQL generations (status, prompt, model metadata). Includes `created_at`. |
| `v_measurements` | Convenience view joining `lab_results`, `patient_reports`, and `analytes` for downstream analytics. |

Supporting assets:
- `server/db/seed_analytes.sql` helps bootstrap analyte vocabulary.
- `config/schema_aliases.json` maps search phrases to schemas/tables for prompt enrichment.

## Configuration & Feature Flags

Create a `.env` in the repo root with the required secrets. Notable variables:

| Variable | Default | Description |
| --- | --- | --- |
| `DATABASE_URL` | – | Postgres connection string (must allow `CREATE EXTENSION pg_trgm`). |
| `OPENAI_API_KEY` | – | Required for both Vision ingestion and SQL/mapping LLM calls. |
| `OPENAI_VISION_MODEL` | `gpt-5-mini` | Vision model used to parse lab reports. |
| `SQL_GENERATOR_MODEL` | `gpt-5-mini` | Text model for SQL generation (single-shot & agentic). |
| `SQL_GENERATION_ENABLED` | `true` | Set to `false` to disable the `/api/sql-generator` endpoint. |
| `AGENTIC_SQL_ENABLED` | `false` | Enable to activate the agentic tool loop; otherwise single-shot mode is used. |
| `ALLOW_MODEL_OVERRIDE` | `false` | Allow clients to pass `model` in the SQL request body. |
| `AGENTIC_MAX_ITERATIONS` | `5` | Max reasoning steps for agentic SQL generation. |
| `AGENTIC_TIMEOUT_MS` | `120000` | Hard timeout for agentic sessions. |
| `AGENTIC_FUZZY_SEARCH_LIMIT` | `20` | Max results returned by trigram search tools. |
| `AGENTIC_EXPLORATORY_SQL_LIMIT` | `20` | Row cap enforced when the agent runs exploratory queries. |
| `AGENTIC_SIMILARITY_THRESHOLD` | `0.3` | Trigram similarity threshold for fuzzy tools. |
| `SQLGEN_MAX_JOINS` | `5` | Validation guardrail for generated SQL complexity. |
| `SQLGEN_MAX_SUBQUERIES` | `2` | Validation guardrail for nested subqueries. |
| `SQLGEN_MAX_AGG_FUNCS` | `10` | Validation guardrail for aggregate usage. |
| `SQL_VALIDATION_BYPASS` | `false` | **Do not use in production**; skips validator safeguards. |
| `SQL_SCHEMA_CACHE_TTL_MS` | 60 000 (dev) / 300 000 (prod) | TTL for schema snapshot cache. |
| `SCHEMA_WHITELIST` | `public` | Comma-separated schemas exposed to the SQL generator. |
| `ADMIN_API_KEY` | – | Required to call `/api/sql-generator/admin/cache/bust`. |
| `PDFTOPPM_PATH` | `pdftoppm` | Override when Poppler tools are installed outside `PATH`. |
| `REQUIRE_PG_TRGM` | `false` | If `true`, boot fails when `pg_trgm` cannot be created. |
| `BACKFILL_SIMILARITY_THRESHOLD` | `0.70` | Tier-B minimum fuzzy similarity score. |
| `MAPPING_AUTO_ACCEPT` | `0.80` | Confidence required to auto-write matches to database. |
| `MAPPING_QUEUE_LOWER` | `0.60` | Confidence at which matches are queued for review. |
| `LOG_LEVEL` | `info` | Pino logger level for mapping runs. |
| `PORT` | `3000` | HTTP port. |

## Local Development

1. **Install prerequisites**
   - Node.js 18+ and npm.
   - PostgreSQL 14+ with the `pg_trgm` extension (required for fuzzy search and agentic tools).
   - Poppler utilities (`pdftoppm`) for PDF page rasterization.
2. **Create database with UTF-8 locale**
   ```sh
   # Create PostgreSQL user (if not exists)
   psql postgres -c "CREATE USER healthup_user WITH PASSWORD 'healthup_pass';"

   # Create database with proper UTF-8 locale (CRITICAL for multilingual support)
   psql postgres -c "CREATE DATABASE healthup OWNER healthup_user ENCODING 'UTF8' LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8' TEMPLATE template0;"
   ```
   **Note:** If you're using macOS and `en_US.UTF-8` is not available, you can use `en_US.UTF-8` or check available locales with `locale -a`.
3. **Install dependencies**
   ```sh
   npm install
   ```
4. **Configure environment**
   - Create `.env` with at least `DATABASE_URL` and `OPENAI_API_KEY`.
   - Analyte mapping runs automatically after each lab report upload.
5. **Start the application**
   ```sh
   npm run dev
   ```
   Boot logs will confirm schema creation (`ensureSchema()`), trigram availability, and HTTP bind.
6. **Verify analyte mapping readiness**
   ```sh
   node scripts/verify_mapping_setup.js
   ```
   This script confirms required tables/indexes exist and surfaces configuration thresholds.

**Schema Management (PRD v2.5):** This project uses declarative schema management via `server/db/schema.js`. All table definitions, indexes, and constraints are consolidated in a single source of truth. The schema is automatically applied on boot using `CREATE TABLE IF NOT EXISTS` statements. During MVP, schema changes are handled by dropping and recreating the database (data loss is acceptable). Migration files are not used.

**Database Operations:**
- **Quick data reset** (preserves locale): Use Admin Panel → Reset Database button. Drops tables only, reseeds analytes.
- **Full database recreation** (changes locale): Drop and recreate database. MUST specify UTF-8 locale explicitly with `TEMPLATE template0`:
```sh
psql postgres -c "DROP DATABASE IF EXISTS healthup;"
psql postgres -c "CREATE DATABASE healthup OWNER healthup_user ENCODING 'UTF8' LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8' TEMPLATE template0;"
npm run dev  # Recreates schema
```

**CRITICAL:** The database MUST be created with UTF-8 locale (`LC_COLLATE` and `LC_CTYPE` set to `en_US.UTF-8` or similar). The C locale will break:
- `LOWER()`/`UPPER()` functions for Cyrillic and other non-ASCII text
- `pg_trgm` fuzzy search for Russian/Hebrew analyte names
- Agentic SQL search tools that rely on trigram similarity

To set up a new database with proper locale, use `./scripts/setup_db.sh` or follow the manual instructions above.

**Locale Diagnostics:** If fuzzy search returns no results for non-ASCII text, check your database locale:
```sql
SELECT datcollate, datctype FROM pg_database WHERE datname = 'healthup';
-- Should return 'en_US.UTF-8', not 'C'

-- Test Cyrillic support:
SELECT LOWER('АБВГД') = 'абвгд';  -- Should return 't' (true)
SELECT similarity('холестерин', 'холестерин');  -- Should return 1.0
```
If locale is wrong, you must drop and recreate the database with proper locale (see Database Operations above).

For large analyte datasets, run `psql -f server/db/seed_analytes.sql` before enabling mapping.

## Testing & QA

- Automated unit tests (Jest): `npm test`.
- Manual agentic SQL regression: `node test/manual/test_agentic_sql.js` (prints active feature flags and exercises representative questions).
- Frontend flows rely on manual QA (progress timeline, copy-to-clipboard, plot rendering, parameter table synchronization). Use seeded lab reports for deterministic runs.
- Parameter table QA checklist (PRD v2.6):
  - Verify table renders on first load with default parameter selection
  - Confirm table updates when switching parameters via radio buttons
  - Check out-of-range values display red outline in Value cells
  - Validate table hides during loading states and error conditions
  - Test reference interval display for one-sided and two-sided bounds

## Logging & Observability

- `pino` provides structured logs across services. In development, logs are pretty-printed; in production they are JSON.
- Agentic SQL emits detailed iteration logs (`logger.debug`/`logger.info`) and persists final outcomes in `sql_generation_logs`.
- Mapping Applier emits per-row structured events for ingestion into tracing/BI pipelines.
- Database health is exposed at `GET /health/db`.

## Supporting Artifacts

Key specifications and history live under `docs/`:

- PRDs for each milestone (`PRD_v0_4_Full_Lab_Results_Extraction.md`, `PRD_v0_9_Mapping_Applier_Dry_Run.md`, `PRD_v2_0_agentic_sql_generation_mvp.md`, `PRD_v2_1_plot_generation.md`, `PRD_v2_2_lab_plot_with_reference_band.md`, `PRD_v2_3_single_analyte_plot_UI.md`, `PRD_v2_4_analyte_mapping_write_mode.md`, `PRD_v2_5_schema_consolidation.md`, `PRD_v2_6_parameter_table_view.md`).
- Implementation notes (`IMPLEMENTATION_PLAN_agentic_sql.md`, `IMPLEMENTATION_SUMMARY_v0_9_2.md`, `AGENTIC_SQL_QUICKSTART.md`) capture operational guidance.
- `CRITICAL_GAPS_ADDRESSED.md` and `FINAL_STATUS.md` summarize the current release baseline.

Consult these documents when drafting new PRDs; each PRD references the corresponding modules described above.

## Repository Layout

```
.
├── public/                # Static UI (HTML/CSS/JS + Chart.js integrations)
├── server/
│   ├── app.js             # Express bootstrap & shutdown hooks
│   ├── routes/            # API endpoints (analyze labs, SQL generator, SQL exec, reports)
│   ├── services/          # Business logic (agentic SQL, mapping, persistence, schema cache, validation)
│   ├── db/                # Pool config, schema management, seed SQL
│   └── utils/             # Shared helpers (prompt loader)
├── config/schema_aliases.json
├── prompts/               # LLM prompt templates (vision + SQL generation)
├── docs/                  # PRDs, implementation summaries, quickstarts
├── scripts/               # Operational scripts (verify mapping setup)
├── test/                  # Manual & automated tests
├── package.json
└── README.md
```

## Known Limitations & Next Steps

- Ingestion currently blocks on OpenAI; consider queueing for batch processing when latency becomes an issue.
- Mapping Applier automatically writes high-confidence matches; medium-confidence matches and new analyte proposals require admin review interfaces.
- Agentic SQL relies on curated prompts and schema aliases—update `config/schema_aliases.json` whenever new tables are introduced.
- Plot generation expects time-series columns (`t`, `y`, `parameter_name`, `unit`, reference bands). Ensure new plot-focused PRDs conform to this contract.
- Parameter table view currently performs client-side calculation of out-of-range status when backend field is missing; consider populating `is_value_out_of_range` in the database for consistency.
- Future enhancements for parameter table: CSV export, mobile-responsive toggle, date range filtering, multi-parameter comparison, and report deep links (see PRD v2.6 section 11).
