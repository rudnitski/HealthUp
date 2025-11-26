# HealthUp

HealthUp converts raw lab PDFs/images into structured longitudinal data and provides intelligent health analytics through conversational AI. The Express monolith handles OCR with OpenAI/Anthropic, deduplicates and persists reports in PostgreSQL, maps analytes to a canonical vocabulary, and exposes natural-language SQL generation with streaming chat, time-series visualization, and Gmail-based batch ingestion.

## Core Features

### Lab Report Ingestion (`public/index.html`)
- **Multi-file batch upload**: Drag & drop up to 20 files (100MB total), async processing with live progress tracking
- **Gmail integration**: OAuth flow → email classification → attachment selection → batch OCR pipeline
- **Smart deduplication**: Checksum-based detection prevents duplicate ingestion across all sources
- **Multi-provider OCR**: OpenAI GPT-4 Vision or Anthropic Claude Sonnet with structured output enforcement

### Conversational SQL Assistant (v3.2)
- **Streaming chat interface**: Real-time character-by-character responses with Server-Sent Events
- **Clarifying questions**: LLM asks for patient selection, format preference, or date ranges when queries are ambiguous
- **Multi-turn conversations**: Back-and-forth dialogue until query intent is clear, then executes SQL
- **Automatic plotting**: Detects time-series queries and generates interactive Chart.js visualizations
- **Session-scoped**: Conversations persist for follow-up questions until results shown or page refresh

### Analyte Mapping & Admin Review (`public/admin.html`)
- **Three-tier auto-mapping**: Exact alias match → fuzzy pg_trgm search → LLM-based suggestions
- **Confidence thresholds**: Auto-accept high-confidence (≥0.90), queue medium-confidence for review
- **Pending analytes**: LLM proposes new canonical analytes from unmapped lab parameters
- **Audit trail**: All admin actions logged to `admin_actions` table

### Patient Data Views
- **Longitudinal parameter tables**: Multi-report aggregation with out-of-range highlighting
- **Reference intervals**: Visualized as shaded bands on time-series plots
- **Report detail pages**: Full lab results with original OCR metadata and mapping outcomes

## System Architecture
```
Browser (index.html, admin.html)
   │
   ▼
Express app (server/app.js)
   ├─ /api/analyze-labs → Batch upload & job polling → labReportProcessor → MappingApplier → PostgreSQL
   ├─ /api/chat/stream → Conversational SQL (SSE) → agenticCore → Tool calling loop → Query execution
   ├─ /api/sql-generator → Legacy single-shot SQL generation with agentic tools
   ├─ /api/admin → Pending analytes, match reviews, audit logging
   ├─ /api/dev-gmail → OAuth flow, email classification, attachment batch ingestion
   └─ /api/reports → Patient report detail views with mapping outcomes

PostgreSQL
   ├─ Core: patients, patient_reports, lab_results
   ├─ Mapping: analytes, analyte_aliases, pending_analytes, match_reviews
   ├─ Audit: sql_generation_logs, admin_actions, gmail_report_provenance
   └─ Views: v_measurements (convenience view for analytics)

External APIs
   ├─ OpenAI GPT-4 Vision (OCR, SQL generation, mapping suggestions)
   ├─ Anthropic Claude Sonnet (optional OCR provider)
   └─ Google Gmail API (OAuth + metadata for inbox ingestion)
```

## Key Modules & Services

### Backend Services
- **`server/services/labReportProcessor.js`** - Async job-based OCR pipeline with PDF→PNG conversion, vision provider orchestration, structured output enforcement, and auto-mapping trigger
- **`server/services/vision/`** - OCR provider abstraction (`VisionProviderFactory`, `OpenAIProvider`, `AnthropicProvider`) with native PDF support
- **`server/services/agenticCore.js`** - Tool-calling loop for SQL generation with fuzzy search, exploratory SQL execution, and query validation
- **`server/routes/chatStream.js`** - SSE endpoint for conversational SQL with session management, streaming responses, and multi-turn clarification
- **`server/services/MappingApplier.js`** - Three-tier analyte matching (exact alias → fuzzy trigram → LLM suggestions) with confidence-based auto-accept
- **`server/services/gmailAttachmentIngest.js`** - Three-stage Gmail pipeline (classification → body refinement → attachment download) with provenance tracking
- **`server/utils/sessionManager.js`** - In-memory session store for conversational chat with 1-hour TTL and atomic locking

### Frontend Components
- **`public/js/unified-upload.js`** - Batch file upload, drag & drop, Gmail OAuth flow, attachment selection, progress polling
- **`public/js/chat.js`** - Conversational SQL UI with SSE event handling, streaming text rendering, tool indicators
- **`public/js/plotRenderer.js`** - Chart.js wrapper for time-series plots with reference bands, zoom, and data labels
- **`public/js/admin.js`** - Pending analyte review and ambiguous match resolution with rationale fields

### Database & Config
- **`server/db/schema.js`** - Declarative schema auto-applied on boot (no migrations during MVP)
- **`config/schema_aliases.json`** - User-facing table/column names for SQL generation prompts
- **`scripts/`** - Operational tools (`verify_mapping_setup.js`, `backfill_analyte_mappings.js`, `setup_db.sh`)

## Data Model Highlights
- **patients / patient_reports / lab_results** – normalized hierarchy; reports enforce `(patient_id, checksum)` uniqueness to avoid duplicate ingestion.
- **analytes / analyte_aliases / pending_analytes / match_reviews** – canonical vocabulary, multilingual aliasing, LLM-proposed additions, and admin review queues.
- **sql_generation_logs** – audit every NL → SQL request with prompt metadata and validation outcome.
- **gmail_report_provenance** – attachment-level lineage for Gmail ingest batches.
- **v_measurements** – convenience view powering charting + parameter tables.

## Local Development

### Prerequisites
- Node.js 20.16.0+ (or 22.3.0+) and npm
- PostgreSQL 14+ with `pg_trgm` + `pgcrypto` extensions
- Poppler (`pdftoppm`) for PDF rasterization
- OpenAI API key (required for OCR and SQL generation)

### Setup Steps

1. **Create database with UTF-8 locale** (critical for Cyrillic support and fuzzy search)
   ```sh
   psql postgres -c "CREATE USER healthup_user WITH PASSWORD 'healthup_pass' LOGIN;"
   psql postgres -c "CREATE DATABASE healthup OWNER healthup_user ENCODING 'UTF8' LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8' TEMPLATE template0;"
   ```

2. **Configure environment variables**
   Create `.env` file with required variables (see Configuration table below). Minimal setup:
   ```sh
   DATABASE_URL=postgresql://healthup_user:healthup_pass@localhost:5432/healthup
   OPENAI_API_KEY=sk-...
   ```

3. **Install and run**
   ```sh
   npm install
   npm run dev
   ```
   Server starts at `http://localhost:3000`, auto-applies schema, validates OCR provider, serves static UI.

4. **Verify mapping setup**
   ```sh
   node scripts/verify_mapping_setup.js  # Checks indexes, extensions, thresholds
   ```

5. **Optional: Enable Gmail integration**
   - Create Google OAuth credentials ([Console](https://console.cloud.google.com/apis/credentials))
   - Add to `.env`:
     ```sh
     GMAIL_INTEGRATION_ENABLED=true
     GOOGLE_CLIENT_ID=...
     GOOGLE_CLIENT_SECRET=...
     GMAIL_OAUTH_REDIRECT_URI=http://localhost:3000/api/dev-gmail/oauth/callback
     ```
   - Restart server, click "Import from Gmail" button on main page

## Configuration

### Core Settings
| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | *required* | PostgreSQL connection string |
| `OPENAI_API_KEY` | *required* | Powers OCR, SQL generation, and analyte mapping |
| `PORT` | `3000` | HTTP server port |

### OCR Provider
| Variable | Default | Purpose |
|----------|---------|---------|
| `OCR_PROVIDER` | `openai` | Vision provider: `openai` or `anthropic` |
| `OPENAI_VISION_MODEL` | `gpt-4o` | OpenAI vision model for OCR |
| `ANTHROPIC_API_KEY` | - | Required if `OCR_PROVIDER=anthropic` |
| `ANTHROPIC_VISION_MODEL` | `claude-sonnet-4` | Anthropic vision model |

### SQL Generation
| Variable | Default | Purpose |
|----------|---------|---------|
| `SQL_GENERATION_ENABLED` | `true` | Enable natural language SQL |
| `AGENTIC_SQL_ENABLED` | `true` | Use tool-calling loop (vs single-shot) |
| `SQL_GENERATOR_MODEL` | `gpt-4o-mini` | Model for SQL generation |
| `AGENTIC_MAX_ITERATIONS` | `20` | Max tool-calling iterations |

### Analyte Mapping
| Variable | Default | Purpose |
|----------|---------|---------|
| `MAPPING_AUTO_ACCEPT` | `0.90` | Auto-write threshold (high confidence) |
| `MAPPING_QUEUE_LOWER` | `0.65` | Queue threshold (medium confidence) |
| `BACKFILL_SIMILARITY_THRESHOLD` | `0.80` | Trigram similarity for backfill script |

### Gmail Integration (Dev Only)
| Variable | Default | Purpose |
|----------|---------|---------|
| `GMAIL_INTEGRATION_ENABLED` | `false` | Enable Gmail import (blocked in production) |
| `GOOGLE_CLIENT_ID` | - | OAuth client ID from Google Console |
| `GOOGLE_CLIENT_SECRET` | - | OAuth client secret |
| `GMAIL_OAUTH_REDIRECT_URI` | - | Callback URL (e.g., `http://localhost:3000/api/dev-gmail/oauth/callback`) |
| `GMAIL_MAX_EMAILS` | `200` | Max emails to fetch per request |

See `CLAUDE.md` for additional tuning options (`LOG_LEVEL`, `REQUIRE_PG_TRGM`, `ADMIN_API_KEY`, etc.).

## Development Commands

```bash
# Start development server (auto-applies schema on boot)
npm run dev

# Run tests
npm test

# Verify analyte mapping setup (checks tables/indexes/config)
node scripts/verify_mapping_setup.js

# Backfill analyte mappings for existing lab results
node scripts/backfill_analyte_mappings.js

# Database setup with proper UTF-8 locale
./scripts/setup_db.sh

# Manual agentic SQL regression testing
node test/manual/test_agentic_sql.js
```

## Project Structure

```
HealthUp/
├── server/
│   ├── app.js                    # Express bootstrap, schema init, route wiring
│   ├── routes/                   # API endpoints
│   │   ├── analyzeLabReport.js   # Batch upload & job polling
│   │   ├── chatStream.js         # Conversational SQL (SSE)
│   │   ├── gmailDev.js           # Gmail OAuth & ingestion
│   │   └── admin.js              # Pending queues & admin actions
│   ├── services/
│   │   ├── labReportProcessor.js # OCR pipeline orchestrator
│   │   ├── vision/               # Multi-provider OCR abstraction
│   │   ├── agenticCore.js        # SQL generation tool-calling loop
│   │   ├── MappingApplier.js     # Three-tier analyte matching
│   │   └── gmailAttachmentIngest.js # Gmail three-stage pipeline
│   ├── db/
│   │   ├── schema.js             # Declarative schema (auto-applied)
│   │   └── index.js              # PostgreSQL connection pool
│   └── utils/
│       ├── sessionManager.js     # Conversational chat sessions
│       └── jobManager.js         # Async job tracking
├── public/
│   ├── index.html                # Main UI (upload + chat + Gmail)
│   ├── admin.html                # Admin review panel
│   └── js/
│       ├── unified-upload.js     # Batch upload & Gmail integration
│       ├── chat.js               # Conversational SQL UI
│       ├── plotRenderer.js       # Chart.js wrapper
│       └── admin.js              # Admin queue management
├── docs/                         # Product requirement documents
├── prompts/                      # LLM prompt templates
├── config/
│   └── schema_aliases.json       # User-facing DB names for SQL
└── scripts/                      # Operational helpers
```

## Feature Documentation

See `docs/PRD_*.md` for detailed feature specifications:
- **v2.0** - Agentic SQL generation MVP
- **v2.1-v2.3** - Plot generation, reference bands, single analyte plots
- **v2.4** - Analyte mapping write mode
- **v2.6** - Parameter table view
- **v2.7** - Multi-provider OCR
- **v2.8** - Gmail integration (3-stage pipeline)
- **v3.0** - Unified upload and ingestion (multi-file batches)
- **v3.1** - Auto-execute data queries
- **v3.2** - Conversational SQL assistant (streaming chat)

Prompt templates in `prompts/` define OCR extraction schema and SQL generation instructions.

## Key Technical Decisions

### Why UTF-8 Locale?
PostgreSQL C locale breaks:
- Case folding for Cyrillic text (`LOWER()`/`UPPER()` fail)
- pg_trgm fuzzy search (required for analyte mapping)
- Agentic SQL tools (fuzzy search tools return empty results)

**Always create DB with**: `LC_COLLATE='en_US.UTF-8' LC_CTYPE='en_US.UTF-8'`

### Why Async Job Pattern?
Long operations (OCR, Gmail classification) run 20-60+ seconds. Cloudflare/proxy timeouts occur at 100s. Solution:
- Endpoint returns `202 Accepted` with `job_id`
- Processing happens via `setImmediate()` in background
- Client polls `GET /jobs/:jobId` every 2 seconds
- In-memory job manager with 1-hour TTL

### Why Server-Sent Events for Chat?
WebSocket overkill for server→client streaming. SSE provides:
- Built-in reconnection
- Simpler protocol (HTTP GET)
- EventSource API in browsers
- Uni-directional (sufficient for streaming LLM responses)

## Contributing

New engineers should:
1. Read this README for system overview
2. Review `CLAUDE.md` for development patterns and critical gotchas
3. Explore `docs/PRD_*.md` for feature context
4. Check `prompts/` to understand LLM interactions
5. Run `verify_mapping_setup.js` after schema changes

The codebase prioritizes:
- **Structured logging** (Pino) for observability
- **Declarative schema** over migrations (MVP trade-off)
- **Conservative auto-mapping** (high thresholds, human review for ambiguity)
- **Async job pattern** for all long operations
- **SSE for streaming** (chat, progress updates)
