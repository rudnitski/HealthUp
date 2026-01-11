# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
# Start development server (auto-applies schema on boot)
npm run dev

# Clean restart (kills existing server on port 3000 first, then starts dev server)
lsof -ti:3000 | xargs kill -9 && npm run dev

# Run all tests
npm test

# Run specific test file
npm test path/to/test.js

# Manual agentic SQL regression testing
node test/manual/test_agentic_sql.js

# Test job manager terminal state guards
node test/manual/test_job_terminal_state_guard.js

# Verify analyte mapping setup (checks tables/indexes/config)
node scripts/verify_mapping_setup.js

# Backfill analyte mappings for existing lab results
node scripts/backfill_analyte_mappings.js

# Database setup with proper UTF-8 locale
./scripts/setup_db.sh
```

## Architecture Overview

HealthUp is a Node.js/Express monolith that ingests lab reports (PDF/image), extracts structured data via configurable OCR providers (OpenAI or Anthropic), persists to PostgreSQL, and provides natural-language SQL analytics with time-series visualization.

**Core Flow:**
```
Upload (Manual/Gmail) → Batch Processing → Async Jobs → Vision OCR → Persistence → Auto-mapping → SQL Generation → Plotting
```

**Unified Upload System (v3.0):**
- Single UI on `index.html` for both manual multi-file uploads and Gmail import
- Manual uploads: Multi-file selection (max 20 files, 100MB aggregate), drag & drop support
- Gmail import: OAuth → Email classification → Attachment selection → Batch ingestion
- Both paths converge on unified progress/results tables
- Results open in new tabs, batch view persists in original tab

### Key Services

- **`server/services/labReportProcessor.js`**: Async job-based OCR pipeline. Returns 202 Accepted with `job_id`, client polls `/api/analyze-labs/jobs/:jobId`. Sends PDFs directly to vision providers via native PDF APIs (Anthropic always, OpenAI when `OPENAI_USE_NATIVE_PDF=true`). Falls back to `pdftoppm` conversion for OpenAI legacy mode. Persists to DB, triggers auto-mapping.

- **`server/services/vision/VisionProviderFactory.js`**: Selects OCR backend (`OCR_PROVIDER=openai|anthropic`). OpenAI supports native PDF via `OPENAI_USE_NATIVE_PDF=true`. Anthropic uses Claude Sonnet vision with native PDF support.

- **`server/services/MappingApplier.js`**: Tiered analyte mapping (exact alias → fuzzy trigram → LLM suggestions). Auto-writes high-confidence matches (≥`MAPPING_AUTO_ACCEPT`), queues medium confidence to `match_reviews`, proposes new analytes to `pending_analytes`.

- **`server/services/agenticCore.js`**: Tool-calling loop for SQL generation when `AGENTIC_SQL_ENABLED=true`. Provides fuzzy search tools (`fuzzy_search_parameter_names`, `fuzzy_search_analyte_names`), exploratory SQL execution, and final query generation with plot metadata. Used by both legacy single-shot endpoint (`/api/sql-generator`) and conversational chat endpoint (`/api/chat/stream`).

- **`server/routes/chatStream.js`**: Server-Sent Events (SSE) endpoint for conversational SQL assistant (v3.2). Manages multi-turn dialogue with streaming responses, clarifying questions, and session-scoped conversation history until query execution.

- **`server/utils/sessionManager.js`**: In-memory session store for conversational chat with 1-hour TTL, atomic locking, and automatic cleanup. Tracks conversation history, pending queries, and execution state across multiple turns.

- **`server/services/gmailConnector.js`**: OAuth2 flow for Gmail API (dev-only, `GMAIL_INTEGRATION_ENABLED=true`). Persists tokens to `server/config/gmail-token.json`. Fetches email metadata with concurrency controls.

- **`server/services/gmailAttachmentIngest.js`**: Step 3 of Gmail integration. Downloads attachments, computes SHA-256 checksums, runs OCR via `labReportProcessor`, tracks provenance in `gmail_report_provenance` table.

- **`server/services/fileStorage.js`**: Filesystem-based storage for uploaded lab reports (PRD v3.4). Organizes files by patient ID with structure `{patient_id}/{report_id}.ext`. Stores relative paths in database (`patient_reports.file_path`). Configurable via `FILE_STORAGE_PATH` env variable (defaults to `./storage/lab_reports`).

### Critical Configuration

**File Storage (PRD v3.4):**
- Files stored in filesystem at path specified by `FILE_STORAGE_PATH` environment variable
- Default location: `{project_root}/storage/lab_reports`
- Organized structure: `{storage_base}/{patient_id}/{report_id}.ext`
- Database stores relative file paths, not binary data
- **Localhost**: Use default or specify local path (e.g., `./storage/lab_reports`)
- **VPS/Production**: Set absolute path with sufficient storage (e.g., `/home/healthup/storage/lab_reports`)
- Directory auto-created on first upload
- Supports up to 100MB per file (configurable in `fileStorage.js`)


**Database Locale Requirement:**
- PostgreSQL database **MUST** use UTF-8 locale (`LC_COLLATE` and `LC_CTYPE` = `en_US.UTF-8` or similar).
- C locale breaks `LOWER()`/`UPPER()` for Cyrillic, breaks `pg_trgm` fuzzy search, breaks agentic SQL tools.
- Create database with: `CREATE DATABASE healthup ENCODING 'UTF8' LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8' TEMPLATE template0;`
- Verify with: `SELECT datcollate, datctype FROM pg_database WHERE datname = 'healthup';`

**Required Extensions:**
- `pg_trgm` for fuzzy search (auto-created on boot; set `REQUIRE_PG_TRGM=true` to enforce)

**Vision Providers:**
- OpenAI (default): Requires `OPENAI_API_KEY`, `OPENAI_VISION_MODEL`
- Anthropic (opt-in): Requires `ANTHROPIC_API_KEY`, `ANTHROPIC_VISION_MODEL`, set `OCR_PROVIDER=anthropic`

**LLM Model Configuration:**
- `CHAT_MODEL`: Conversational chat interface (PRD v3.2, defaults to `SQL_GENERATOR_MODEL`)
- `SQL_GENERATOR_MODEL`: Agentic SQL generation and legacy endpoint (defaults to `gpt-4o-mini`)
- `EMAIL_CLASSIFIER_MODEL`: Gmail integration email classification (defaults to `SQL_GENERATOR_MODEL`)
- `ANALYTE_MAPPING_MODEL`: Tier C analyte name matching (defaults to `SQL_GENERATOR_MODEL`)
- `OPENAI_VISION_MODEL`: OCR extraction from lab reports (OpenAI provider)
- `ANTHROPIC_VISION_MODEL`: OCR extraction from lab reports (Anthropic provider)

**Agentic SQL:**
- Enable with `AGENTIC_SQL_ENABLED=true`
- Uses tool-calling loop with fuzzy trigram search and exploratory SQL execution
- Falls back to single-shot mode if disabled
- Requires `ADMIN_API_KEY` for cache busting endpoint

## Module System

HealthUp uses ESM (ECMAScript Modules) for all server-side code (migrated from CommonJS in v3.5).

**Import Patterns:**
```javascript
// Named imports
import { query } from './db/index.js';

// Default imports
import express from 'express';

// Path resolution for __dirname equivalent
import { getDirname } from './utils/path-helpers.js';
const __dirname = getDirname(import.meta.url);
```

**Important ESM Requirements:**
- All relative imports **MUST** include `.js` extension (e.g., `'./db/index.js'`, not `'./db'`)
- Use `import.meta.url` instead of `__dirname`/`__filename`
- Use `getDirname(import.meta.url)` helper for path resolution
- JSON imports: use `fs.readFileSync()` + `JSON.parse()` for dynamic reloading
- No `require.cache` manipulation (ESM modules are immutable by design)

**Migration Context:**
- Migrated from CommonJS to ESM in PRD v3.5 (big-bang migration, all 37 files)
- Zero circular dependencies (verified with madge)
- All `require()` → `import`, all `module.exports` → `export`
- Jest 30.2.0 with experimental ESM support (`--experimental-vm-modules`)

## Route Organization

Express routes must follow specific ordering for correct matching:

**CRITICAL Route Ordering Rules:**
1. `/api/dev-gmail/status` MUST come BEFORE `featureFlagGuard` middleware (allows frontend to check if feature is enabled)
2. `/api/dev-gmail/jobs/summary` MUST come BEFORE `/api/dev-gmail/jobs/:jobId`
3. `/api/analyze-labs/batches/:batchId` MUST come BEFORE any catch-all routes

Express matches routes in order. The generic `/jobs/:jobId` route will catch `/jobs/summary` if it's defined first, treating "summary" as a jobId parameter. Always define specific routes before parameterized routes.

Example:
```javascript
// CORRECT order
router.get('/status', ...);        // Status check BEFORE guard
router.use(featureFlagGuard);      // Guard applies to routes below
router.get('/jobs/summary', ...);  // Specific route first
router.get('/jobs/:jobId', ...);   // Generic route second

// WRONG order - will break /jobs/summary and /status
router.use(featureFlagGuard);      // Guard blocks status check
router.get('/status', ...);        // Never reached when disabled
router.get('/jobs/:jobId', ...);   // Generic catches everything
router.get('/jobs/summary', ...);  // Never reached
```

## Async Job Pattern

All long-running operations (lab report processing, Gmail classification, attachment ingestion) use the async job pattern:

1. **Endpoint returns 202 Accepted** with `job_id`
2. **Processing happens in background** via `setImmediate()`
3. **Client polls** `GET /jobs/:jobId` every 2 seconds
4. **Job manager** (`server/utils/jobManager.js`) tracks in-memory state with 1-hour TTL

Pattern prevents Cloudflare 524 timeouts for 20-60+ second operations.

## Batch Processing (v3.0)

**Manual Multi-File Upload:**
- `POST /api/analyze-labs/batch` - Upload multiple files (max 20 files, 10MB each, 100MB aggregate)
- `GET /api/analyze-labs/batches/:batchId` - Poll batch status (returns all job statuses)
- Field name: `analysisFile` (express-fileupload auto-converts to array for multiple files)
- Throttled concurrency: Max 3 files processed simultaneously
- Supported types: PDF, PNG, JPEG, HEIC

**Batch Job Manager:**
- Extended `jobManager.js` with `createBatch()`, `getBatchStatus()`, `getBatch()`
- Tracks batches in-memory (1-hour TTL, same as individual jobs)
- Each batch contains multiple jobs, each job processes one file
- Backend queues processing via `setImmediate()`, returns 202 Accepted immediately
- Frontend polls single batch endpoint instead of N individual job endpoints (more efficient)

**Gmail Batch Integration:**
- Gmail attachment ingestion also uses batch pattern (existing functionality)
- `POST /api/dev-gmail/ingest` → returns `batchId`
- `GET /api/dev-gmail/jobs/summary?batchId=xxx` → batch summary
- Richer status vocabulary: `queued`, `downloading`, `processing`, `completed`, `updated`, `duplicate`, `failed`

## Gmail Integration (Steps 1-3)

Three-stage pipeline for ingesting lab reports from Gmail:

**Step 1** (`/api/dev-gmail/fetch`): Metadata classification
- Fetches up to `GMAIL_MAX_EMAILS` (default 200) via Gmail API
- LLM scores each email: `is_lab_likely`, confidence, reason
- Returns candidates for Step 2

**Step 2** (same endpoint, sequential): Body refinement
- Fetches full content for Step 1 candidates
- LLM analyzes body + attachment metadata
- Applies `GMAIL_BODY_ACCEPT_THRESHOLD` (default 0.70)
- Returns accepted emails with attachments for Step 3

**Step 3** (`/api/dev-gmail/ingest`): Attachment ingestion
- User selects attachments from Step 2 results
- Downloads with controlled concurrency (`GMAIL_DOWNLOAD_CONCURRENCY=5`)
- Checks `gmail_report_provenance` for cross-batch duplicates
- Computes SHA-256 checksums for duplicate detection
- Runs through same OCR pipeline as manual uploads
- Saves provenance: message ID, sender, subject, attachment hash
- Returns batch summary via `/api/dev-gmail/jobs/summary?batchId=...`

**OAuth Token Management:**
- Tokens stored in `server/config/gmail-token.json` (configurable via `GMAIL_TOKEN_PATH`)
- Auto-refresh listener preserves `refresh_token` across refreshes
- Feature gated by `GMAIL_INTEGRATION_ENABLED=true` AND `NODE_ENV !== 'production'`

**Streaming Classification Pipeline (v3.7):**
- Gmail metadata fetch and LLM classification run **in parallel** (not sequentially)
- `fetchEmailMetadata()` accepts optional `onBatchReady` callback that fires after each 100-email batch
- `StreamingClassifier` class queues classification immediately as batches arrive (non-blocking)
- Concurrency control: Max 3 concurrent `classifyEmails()` invocations (9 concurrent LLM requests)
- Performance: ~25-30% faster for large email counts (e.g., 3500 emails: 450s → 320s estimated)
- Backward compatible: Old code calling `fetchEmailMetadata()` without callback works unchanged

**How Streaming Works:**
```
Gmail API (batches of 100) → Immediately feed to LLM Classifier (non-blocking)
                           ↓
Gmail continues fetching while LLM processes earlier batches (PARALLEL)
                           ↓
Total time = max(Gmail fetch time, LLM classification time) + overhead
```

**Implementation Details:**
- `StreamingClassifier` uses `pLimit(3)` to cap concurrent classifications
- Progress tracking aggregates across all concurrent batches (0-100% global progress)
- Error handling preserved: 3-attempt retry with exponential backoff per batch
- Results aggregated via `finalize()` which awaits all pending classifications
- **Terminal state protection**: `updateJob()` and `updateProgress()` guard against overwriting FAILED/COMPLETED states. This prevents race conditions where background classification callbacks fire after job errors are set. Verified by `test/manual/test_job_terminal_state_guard.js`.

## Schema Management

**Declarative schema via `server/db/schema.js`:**
- Single source of truth for all tables, indexes, constraints
- Auto-applied on boot using `CREATE TABLE IF NOT EXISTS`
- No migration files during MVP (acceptable data loss)

**Database Operations:**
- Quick reset: Admin Panel → Reset Database (drops tables, reseeds analytes)
- Full recreation: Drop DB → Recreate with UTF-8 locale → `npm run dev`
- Mapping backfill: `node scripts/backfill_analyte_mappings.js` (uses advisory lock)

**Key Tables:**
- `patients`: Master records keyed by UUID
- `patient_reports`: Lab reports with checksums for deduplication
- `lab_results`: Parameter rows with `analyte_id` mapping
- `analytes`: Canonical analyte catalog
- `analyte_aliases`: Fuzzy-searchable aliases (requires `pg_trgm`)
- `pending_analytes`: LLM-proposed new analytes (admin review)
- `match_reviews`: Ambiguous matches (admin disambiguation)
- `gmail_report_provenance`: Audit trail for Gmail-ingested reports
- `sql_generation_logs`: Agentic SQL audit records
- `v_measurements`: Convenience view for analytics

## Frontend Architecture

Static UI (`public/`) with async polling for long operations:

**Main App (`index.html`, `js/app.js`, `js/unified-upload.js`, `js/chat.js`):**
- **Unified upload UI (v3.0):** Single interface for manual multi-file uploads and Gmail import
  - Upload source buttons (📁 Upload Files, 📧 Import from Gmail)
  - Multi-file selection with drag & drop support
  - File validation (type, size, batch limits)
  - Upload queue table (filename, size, type)
  - Gmail OAuth flow and email classification (2-step progress)
  - Gmail attachment selection with duplicate warnings
  - Unified progress table (works for both manual and Gmail batches)
  - Results table with status badges (✅ Done, 🔄 Duplicate, ❌ Error)
  - "View" buttons open reports in new tabs (batch results persist in original tab)
  - Automatic duplicate file detection (filename+size+lastModified)
  - Unique composite keys for Gmail attachments (messageId-attachmentId)
- **Conversational SQL Assistant (v3.2):** Streaming chat interface with SSE
  - Real-time character-by-character response rendering via EventSource API
  - Multi-turn dialogue: LLM asks clarifying questions (patient selection, date ranges, format preference)
  - Session-scoped conversation history until results shown or page refresh
  - Tool call indicators show when LLM is searching schema or executing SQL
  - Automatic plot generation for time-series queries
  - Legacy single-shot SQL generator still available (polls agentic iterations, copies SQL)
- Plot renderer (`js/plotRenderer.js`) with Chart.js + zoom/datalabels
- Parameter table view with out-of-range highlighting (red outline)

**Admin Panel (`admin.html`, `js/admin.js`):**
- Pending analytes review (approve/discard with rationale)
- Ambiguous matches resolution (select correct analyte)
- All actions logged to `admin_actions` audit trail

## Plot Generation Contract

Time-series plots require specific SQL output format:

**Required columns:**
- `t`: Timestamp (ISO or epoch)
- `y`: Numeric value
- `parameter_name`: Display label
- `unit`: Measurement unit

**Optional columns:**
- `reference_low`: Lower bound for reference band
- `reference_high`: Upper bound for reference band

SQL validator enforces these aliases for `plot_query` responses. Missing aliases fail validation to prevent UI regressions.

## Logging & Observability

- **`pino`** structured logging (pretty-printed in dev, JSON in prod)
- Agentic SQL emits per-iteration logs + persists to `sql_generation_logs`
- Mapping Applier emits per-row structured events (tier, confidence, outcome)
- Database health: `GET /health/db`

## Testing Strategy

**Automated:**
- `npm test` (Jest unit tests)
- `node test/manual/test_agentic_sql.js` (agentic SQL regression)
- `node test/manual/test_job_terminal_state_guard.js` (job manager race condition guards)

**Manual QA Checklists:**
- Lab report upload: progress timeline, duplicate detection, mapping outcomes
- SQL generation: agentic tool calls, validation errors, plot rendering
- Parameter table: out-of-range highlighting, radio button sync, reference intervals
- Gmail integration: OAuth flow, three-stage classification, attachment ingestion, provenance tracking

## Product Requirements Documents

Feature specs live in `docs/PRD_*.md`:
- v2.0: Agentic SQL generation MVP
- v2.1: Plot generation
- v2.2: Reference band overlays
- v2.3: Single analyte plot UI
- v2.4: Analyte mapping write mode
- v2.5: Schema consolidation
- v2.6: Parameter table view
- v2.7: Multi-provider OCR
- v2.8: Gmail Integration (Steps 1-3)
- v3.0: Unified Upload and Ingestion (multi-file manual uploads + Gmail import on single page)
- v3.1: Auto-execute data queries
- v3.2: Conversational SQL assistant (streaming chat with multi-turn dialogue)
- v3.7: Streaming Gmail Classification Pipeline (parallel Gmail fetch + LLM classification)
- v4.2: Chat Plot Thumbnails (MVP specification)
- v4.2.1: LLM Thumbnail & Separated Data Flow (execute_sql → show_plot + show_thumbnail)
- v4.2.2: Thumbnail Contract Expansion + Backend Derivation (unified show_plot, backend derives sparkline/deltas)
- v4.2.3: Thumbnail UI Infrastructure (message anchoring with UUIDs, contract finalization)

Consult these when drafting new PRDs or understanding feature history. Prompt templates in `prompts/` define OCR extraction schema and SQL generation instructions.

## Critical Gotchas

1. **Route ordering matters**: Specific routes before parameterized routes (e.g., `/jobs/summary` before `/jobs/:jobId`)
2. **Database locale**: MUST be UTF-8, not C locale (breaks Cyrillic, fuzzy search, agentic tools). PostgreSQL C locale breaks case folding (`LOWER()`/`UPPER()`), `pg_trgm` fuzzy search, and agentic SQL fuzzy search tools.
3. **Vision provider config**: Validate at startup (`VisionProviderFactory` throws on missing keys)
4. **Async jobs**: Long operations MUST use job pattern (prevents 524 timeouts). OCR and Gmail operations run 20-60+ seconds; Cloudflare/proxy timeouts occur at 100s.
5. **SSE for chat streaming**: WebSocket is overkill for server→client streaming. SSE (Server-Sent Events) provides built-in reconnection, simpler HTTP GET protocol, and EventSource API in browsers for uni-directional streaming (sufficient for LLM responses).
6. **Gmail tokens**: Auto-refresh preserves `refresh_token`; never commit `gmail-token.json`
7. **Plot SQL contract**: Validator enforces required aliases (`t`, `y`, `parameter_name`, `unit`)
8. **Mapping confidence**: Auto-accept threshold must be higher than queue threshold
9. **pg_trgm extension**: Required for fuzzy search and agentic SQL tools (auto-created on boot; set `REQUIRE_PG_TRGM=true` to enforce)
10. **Session management**: Conversational chat uses in-memory sessions with 1-hour TTL. Sessions are NOT persisted across server restarts.
11. **OpenAI Responses API for structured outputs**: ALWAYS use `client.responses.parse()` (Responses API) instead of `client.chat.completions.create()` (Chat Completions API) for structured JSON outputs. Responses API is significantly faster (5-10x) for batch classification tasks. Use payload structure: `{model, input: [{role, content: [{type: 'input_text', text}]}], text: {format: {type: 'json_schema', name, strict: true, schema}}}`. See Step 1/Step 2/Step 2.5 in `gmailDev.js` for reference implementation.
12. **OpenAI model names**: User has access to latest OpenAI models including `gpt-5-mini` and potentially others beyond Claude's knowledge cutoff. NEVER assume a model doesn't exist or change model names in .env without explicit user approval. When encountering unfamiliar model names, trust the user's configuration and investigate the actual API error instead of assuming the model is invalid.
13. **Pino logger limitations**: The project uses Pino for structured logging. Pino may not display complex nested objects passed as second parameter to logger methods (e.g., `logger.info('message', {complexObject})`). For debugging payloads or detailed object inspection, use `console.log()` with `JSON.stringify(obj, null, 2)` instead of Pino logger methods. Pino is designed for production performance, not development debugging of complex data structures.
14. **Background process environment pollution**: When running multiple background processes (e.g., via Claude Code bash sessions), environment variables can persist in old processes and cause unexpected behavior. Old `npm run dev` processes running in background will keep their environment variables (like `GMAIL_MAX_EMAILS=5000`) even after .env is changed. Solution: Manually kill all node processes with `lsof -ti:3000 | xargs kill -9` before restarting, or use the clean restart command from Development Commands section.
15. **Job manager terminal state protection**: `updateJob()` and `updateProgress()` in `jobManager.js` guard against overwriting FAILED/COMPLETED states with non-terminal states (PENDING/PROCESSING). This prevents race conditions where background tasks (e.g., StreamingClassifier callbacks) update job status after the job has already failed. Critical for async operations with concurrent background tasks. Verified by `test/manual/test_job_terminal_state_guard.js`.
16. **PRD maintenance**: When updating PRDs after peer review, do not keep review history or comments in the PRD document. PRDs must contain only data for development of the feature, not the history of PRD improvement or review discussions.
17. **Environment file sync**: When making changes to `.env` file, make sure you update `.env.example` as well to keep documentation in sync.
18. **Row Level Security (RLS)**: Several tables (`lab_results`, `patient_reports`, `patients`) have RLS policies enabled. When writing server-side queries that need to access data without user context (e.g., background jobs, batch processing, post-OCR normalization), use `adminPool` instead of `pool`. The `adminPool` connection has `BYPASSRLS` privilege. Symptom of RLS issue: query returns 0 rows even though data exists in the table. Example: `await adminPool.query('SELECT * FROM lab_results WHERE report_id = $1', [reportId])`.
19. **Schema aliases sync**: When modifying database schema (adding/removing columns or tables), update `config/schema_aliases.json` to match. This file teaches the LLM which tables are relevant for specific keywords. Incorrect mappings cause the LLM to hallucinate non-existent columns. Example bug: `"unit": ["lab_results", "analytes"]` caused LLM to generate `a.unit_canonical` because it assumed `analytes` has unit columns (it doesn't - only `unit_aliases` does). Always verify aliases point to tables that actually have relevant columns.