# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
# Start development server (auto-applies schema on boot)
npm run dev

# Run tests
npm test

# Manual agentic SQL regression testing
node test/manual/test_agentic_sql.js

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

- **`server/services/labReportProcessor.js`**: Async job-based OCR pipeline. Returns 202 Accepted with `job_id`, client polls `/api/analyze-labs/jobs/:jobId`. Handles PDF→PNG conversion (via `pdftoppm`), calls vision providers, persists to DB, triggers auto-mapping.

- **`server/services/vision/VisionProviderFactory.js`**: Selects OCR backend (`OCR_PROVIDER=openai|anthropic`). OpenAI supports native PDF via `OPENAI_USE_NATIVE_PDF=true`. Anthropic uses Claude Sonnet vision with native PDF support.

- **`server/services/MappingApplier.js`**: Tiered analyte mapping (exact alias → fuzzy trigram → LLM suggestions). Auto-writes high-confidence matches (≥`MAPPING_AUTO_ACCEPT`), queues medium confidence to `match_reviews`, proposes new analytes to `pending_analytes`.

- **`server/services/agenticSqlGenerator.js`**: Tool-calling loop for SQL generation when `AGENTIC_SQL_ENABLED=true`. Provides fuzzy search tools (`fuzzy_search_parameter_names`, `fuzzy_search_analyte_names`), exploratory SQL execution, and final query generation with plot metadata.

- **`server/services/gmailConnector.js`**: OAuth2 flow for Gmail API (dev-only, `GMAIL_INTEGRATION_ENABLED=true`). Persists tokens to `server/config/gmail-token.json`. Fetches email metadata with concurrency controls.

- **`server/services/gmailAttachmentIngest.js`**: Step 3 of Gmail integration. Downloads attachments, computes SHA-256 checksums, runs OCR via `labReportProcessor`, tracks provenance in `gmail_report_provenance` table.

### Critical Configuration

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

**Agentic SQL:**
- Enable with `AGENTIC_SQL_ENABLED=true`
- Uses tool-calling loop with fuzzy trigram search and exploratory SQL execution
- Falls back to single-shot mode if disabled
- Requires `ADMIN_API_KEY` for cache busting endpoint

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
- Supported types: PDF, PNG, JPEG, HEIC, TIFF

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

**Main App (`index.html`, `js/app.js`, `js/unified-upload.js`):**
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
- SQL generator → polls agentic iterations → copies SQL
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

Consult these when drafting new PRDs or understanding feature history.

## Critical Gotchas

1. **Route ordering matters**: Specific routes before parameterized routes (e.g., `/jobs/summary` before `/jobs/:jobId`)
2. **Database locale**: MUST be UTF-8, not C locale (breaks Cyrillic, fuzzy search, agentic tools)
3. **Vision provider config**: Validate at startup (`VisionProviderFactory` throws on missing keys)
4. **Async jobs**: Long operations MUST use job pattern (prevents 524 timeouts)
5. **Gmail tokens**: Auto-refresh preserves `refresh_token`; never commit `gmail-token.json`
6. **Plot SQL contract**: Validator enforces required aliases (`t`, `y`, `parameter_name`, `unit`)
7. **Mapping confidence**: Auto-accept threshold must be higher than queue threshold
8. **pg_trgm extension**: Required for fuzzy search and agentic SQL tools
