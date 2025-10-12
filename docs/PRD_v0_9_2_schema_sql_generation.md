# 🧩 PRD: Schema-Aware SQL Generation (Manual Execution Mode)

## Overview
Enable the system to generate **real, schema-aware SQL queries** from natural-language user questions, without executing them automatically.  
The generated SQL should reflect the actual PostgreSQL schema and be safely displayed in the existing SQL preview UI.  
This is a preparatory step toward full natural-language database querying.

---

## Goals
1. Provide the model with an up-to-date description of the database schema.  
2. Generate **safe, valid, SELECT-only** SQL statements aligned with the schema and user intent.  
3. Return the SQL string to the frontend for manual verification (developer can test it in `psql`).

---

## Scope

### In-Scope
- Backend logic that:
  - Builds and caches a **schema snapshot** from Postgres (`information_schema`).
  - Incorporates that snapshot into the LLM prompt inside `handleGeneration()`.
  - Requests the model to produce a **single, safe SQL query**.
  - Returns the SQL in the HTTP response for the existing SQL preview UI.

- Prompt must include:
  - User question.
  - Schema description.
  - Safety rules (`SELECT`-only, include `LIMIT 50`).
  - Focus on domain tables: `patients`, `lab_results`, `analytes`, etc.

- Reuse existing `/routes/sqlGenerator.js` endpoint — no UI redesign.

### Out-of-Scope
- Automatic SQL execution.
- New UI or schema editing tools.
- Prompt fine-tuning for accuracy.

---

## Functional Requirements

### 1. Schema Snapshot Service
- Query `information_schema.columns` for the `public` schema.
- Produce a compact manifest of tables and columns with data types and nullability (omit defaults, indexes, and comments).
- Cache strategy:
  - In production, store the manifest in memory per process; no shared file cache.
  - TTL: 5 minutes in production, 1 minute in development.
  - Warm-up: trigger a non-blocking refresh on process start.
  - Manual bust: expose `POST /admin/cache/schema/bust` (admin-authenticated via existing admin middleware/API key) to rebuild immediately and emit a new `schema_snapshot_id`.
  - Bust requests are propagated via PostgreSQL NOTIFY/LISTEN by default: publish an `invalidate:schema` event on POST; all subscribers rebuild their in-memory cache and rotate `schema_snapshot_id`. If `REDIS_URL` is configured, use Redis pub/sub instead for lower latency. If neither mechanism works (e.g., isolated local dev), perform the bust only on the receiving process and log a warning about partial invalidation.
  - CI/migration pipelines must call the bust endpoint after schema changes and alert on failures.
- Observability: compute `schema_snapshot_id = sha256(manifest)` and include it in logs and API responses.
- Developer convenience (optional): allow an opt-in file cache at `./cache/schema.json` in development only (disabled by default).
- Schema metadata:
  - Collect foreign key relationships via `information_schema.table_constraints` and `information_schema.key_column_usage` so prompt ranking can reason about joins.
  - Whitelist schemas through configuration (`SCHEMA_WHITELIST=public,analytics` in env or config file). Default remains `public`.

### 2. Prompt Builder Update
- Retrieve schema snapshot.
- Build LLM prompt with:
  - Schema section constrained to ≤6k tokens and capped at 25 tables / 60 columns per table.
  - Table ranking heuristics:
    1. Match table/column names to entities extracted from the user question.
    2. Prefer tables linked by foreign keys to the highest-ranked tables.
    3. Boost recently used tables from an MRU cache.
  - Entity extraction: perform deterministic keyword/alias matching using `config/schema_aliases.json` (reload on cache bust); do not rely on an additional model call. The aliases file should map natural language terms to table/column names, e.g., `{"vitamin d": ["analytes.name", "lab_results"], "patient": ["patients"], "test results": ["lab_results", "analytes"]}`.
  - Guarantee that tables explicitly referenced in the user question are included even if it requires dropping other candidates; log a warning whenever truncation happens.
  - Column lists include `name`, `pg_type`, and `nullable`. Trim least relevant columns using a TF-IDF style score: weight columns by token overlap with the question multiplied by inverse table frequency; remove the lowest-scoring columns first until under budget.
  - Exclude PII values, data previews, or non-whitelisted schemas (default whitelist: `public`).
  - MRU cache: maintain a per-instance MRU list (max 50 tables) shared across users; reset when the schema snapshot changes.
  - User question.
  - Safety rules (SELECT-only, enforce/inject `LIMIT 50`, validation criteria).
- Pass prompt into `handleGeneration()` → Responses API.

### 3. Response Structure
Return a JSON payload:
```json
{
  "ok": true,
  "sql": "SELECT ... LIMIT 50",
  "explanation": "Shows average Vitamin D per month using lab_results joins.",
  "metadata": {
    "model": "gpt-5-mini-2025-08-07",
    "tokens": { "prompt": 1180, "completion": 120, "total": 1300 },
    "duration_ms": 321,
    "schema_snapshot_id": "sha256:...",
    "validator": { "rule_version": "v1.2.0", "strategy": "regex+explain_ro" }
  }
}
```

### 4. Validation
Use a **multi-layered validation strategy** without introducing native dependencies:

**Layer 1: Enhanced Regex Validation** (fast rejection path)
- Strip all comments (block `/* ... */` and line `--` comments) before validation.
- Reject immediately when any of the following are detected (case-insensitive, whole-word matching):
  - Forbidden keywords: `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `TRUNCATE`, `ALTER`, `DROP`, `CREATE`, `REPLACE`, `GRANT`, `REVOKE`, `COPY`, `CALL`, `DO`, `VACUUM`, `ANALYZE`, `CLUSTER`, `REFRESH`, `SET`, `RESET`, `SHOW`, `COMMENT`, `SECURITY LABEL`, `LISTEN`, `UNLISTEN`, `NOTIFY`.
  - Forbidden clauses/patterns: `SELECT INTO`, `LOCK`, `FOR UPDATE`, `FOR SHARE`, `FOR NO KEY UPDATE`, `FOR KEY SHARE`, references to `pg_temp` or `pg_toast`.
  - Volatile/unsafe functions: Complete list includes `pg_sleep`, `pg_read_file`, `pg_read_binary_file`, `pg_ls_dir`, `pg_stat_file`, `pg_write_*`, `pg_log_*`, `lo_import`, `lo_export`, `dblink`, `dblink_exec`.
  - Multiple statements: detect semicolons after trimming trailing whitespace and reject if more than one statement is present.
- LIMIT enforcement: inject `LIMIT 50` when missing; clamp any existing `LIMIT` value above 50 down to 50.
- Query complexity guardrails: use regex/parsing to reject queries with more than 5 `JOIN` keywords, more than 2 nested subquery levels (count parentheses depth around `SELECT` keywords), or more than 10 aggregate function calls; log the violation code when triggered. Limits are configurable via `SQLGEN_MAX_JOINS`, `SQLGEN_MAX_SUBQUERIES`, and `SQLGEN_MAX_AGG_FUNCS` (defaults: 5/2/10).

**Layer 2: PostgreSQL EXPLAIN Validation** (comprehensive safety check)
- Execute `EXPLAIN (FORMAT JSON)` on a read-only connection with `statement_timeout=1000` to prevent hangs on pathological queries.
- Reject on any error or if the plan contains non-read-only operations.
- Ensure the connection uses a read-only role with `default_transaction_read_only = on`.

**Logging & Response**
- On rejection, respond with HTTP 422 and a structured error payload (see below). Log rule version, violations, and `schema_snapshot_id`.
- Log when cache warming completes on process start to aid debugging startup issues.

### 5. Error Handling & Failure Responses
- Validation failure (`HTTP 422`):
  ```json
  {
    "ok": false,
    "error": { "code": "VALIDATION_FAILED", "message": "Only single read-only SELECT statements are allowed." },
    "details": {
      "violations": [
        { "code": "FORBIDDEN_KEYWORD", "keyword": "DROP" },
        { "code": "MULTI_STATEMENT_SEMICOLON" }
      ],
      "rule_version": "v1.2.0",
      "hint": "Rephrase your question without administrative keywords."
    },
    "metadata": {
      "model": "gpt-5-mini-2025-08-07",
      "tokens": { "prompt": 1180, "completion": 0, "total": 1180 },
      "duration_ms": 210,
      "schema_snapshot_id": "sha256:..."
    }
  }
  ```
- Bad input (`HTTP 400`):
  ```json
  {
    "ok": false,
    "error": { "code": "BAD_REQUEST", "message": "question is required" }
  }
  ```
- Unexpected server error (`HTTP 500`):
  ```json
  {
    "ok": false,
    "error": { "code": "UNEXPECTED_ERROR", "message": "Unexpected error generating SQL" }
  }
  ```

---

### 6. Operational Controls & Observability
- Rate limiting: enforce 60 requests per minute per IP (configurable via `SQLGEN_RATE_LIMIT_PER_IP`, default 60) on `/routes/sqlGenerator`.
- Audit logging: capture every generated SQL statement with user identifier, request ID, validation outcome, `schema_snapshot_id`, `sql_hash`, and emit to the existing security logging stream (`security.audit.jsonl`) with `event_type="sql_generation"`.
- Metrics: emit the following standardized metrics:
  - `sql_generation.requests.total` - counter for all requests
  - `sql_generation.validation.failures` - counter with `violation_code` label
  - `sql_generation.cache.bust_events` - counter for cache invalidations
  - `sql_generation.guardrail.rejections` - counter with `guardrail_type` label (joins/subqueries/aggregates)
  - `sql_generation.tokens.prompt` - histogram for prompt token usage
  - `sql_generation.latency.p95` - gauge for p95 response time
- Alerts: page when validation failure rate >10% over 15 minutes, cache snapshot age exceeds `TTL × 2`, or p95 latency > 2 seconds for 5 minutes.
- Model configuration: default model set via `SQL_GENERATOR_MODEL` env (default `gpt-5-mini-2025-08-07`); allow per-request override only when a feature flag (`ALLOW_MODEL_OVERRIDE`) is enabled.

### 7. Testing Requirements
- Unit tests covering validation guards (keyword bans, complexity thresholds, LIMIT enforcement, safe path).
- Integration tests against a representative Postgres schema validating snapshot generation, prompt assembly, and read-only `EXPLAIN` behavior.
- Security regression tests injecting multi-statement payloads, unsafe functions, and other edge cases.
- Load tests to verify rate limiting and latency SLAs under peak traffic.

### 8. Deployment & Rollback
- Performance SLA: keep p95 latency for `/routes/sqlGenerator` responses < 2s under expected peak load.
- CI integration: post-migration jobs call the cache bust endpoint with up to 3 retries and exponential backoff; persistent failures block deployment and alert on-call.
- Rollback plan: guard the feature behind `SQL_GENERATION_ENABLED`; disable to revert instantly if impacts arise.
- Configuration: add all new environment variables to `.env.example` with documented defaults: `SCHEMA_WHITELIST`, `SQLGEN_MAX_JOINS`, `SQLGEN_MAX_SUBQUERIES`, `SQLGEN_MAX_AGG_FUNCS`, `SQLGEN_RATE_LIMIT_PER_IP`, `SQL_GENERATOR_MODEL`, `ALLOW_MODEL_OVERRIDE`, `SQL_GENERATION_ENABLED`, and optionally `REDIS_URL` for distributed cache invalidation.

### 9. Frontend Updates
While the PRD scopes this as "no UI redesign," the new API response format provides valuable metadata that should be surfaced:
- Update `public/js/app.js` to parse the new response structure (`ok`, `sql`, `explanation`, `metadata`).
- Display the `explanation` field prominently to provide context for the generated query.
- Show `schema_snapshot_id` in a debug/info section for developer verification.
- Handle structured error responses (HTTP 422) by displaying `violations` and `hint` to guide users.
- Continue displaying existing fields: model, tokens, duration.
- The current UI already has an SQL preview area; ensure it continues to display the `sql` field correctly.

---

## Acceptance Criteria

- [ ] A user question like *"Show average Vitamin D by month"* produces a valid SELECT query referencing real columns.
- [ ] SQL includes `LIMIT` or the system injects it automatically.
- [ ] Unsafe queries are rejected with a clear error message.
- [ ] Schema snapshot reflects latest DB structure.
- [ ] SQL preview UI displays returned SQL, explanation, and metadata correctly.
- [ ] Frontend gracefully handles structured error responses with violation details.
- [ ] All new environment variables are documented in `.env.example`.

---

## Implementation Phases

To manage complexity and reduce risk, implement in three phases:

### Phase 1: Core Safety & Quality (Week 1-2)
Focus: Generate better SQL safely
- ✅ Enhanced validation (regex + EXPLAIN with timeout)
- ✅ Query complexity guardrails (JOIN/subquery/aggregate limits)
- ✅ LIMIT enforcement
- ✅ New response format with explanation and metadata
- ✅ Improved schema caching (5min TTL, snapshot ID)
- ✅ Foreign key relationship capture
- ✅ Frontend updates to display new response format

### Phase 2: Intelligence & Observability (Week 3)
Focus: Smarter SQL generation and visibility
- ✅ Prompt engineering (table ranking, token budgeting)
- ✅ Entity extraction via `config/schema_aliases.json`
- ✅ Column trimming with TF-IDF scoring
- ✅ MRU cache for recently used tables
- ✅ Audit logging to `security.audit.jsonl`
- ✅ Basic metrics emission
- ✅ Structured error responses with hints

### Phase 3: Operations & Scale (Week 4)
Focus: Production hardening and distributed operations
- ✅ Admin cache bust endpoint (`POST /admin/cache/schema/bust`)
- ✅ Distributed cache invalidation (PostgreSQL NOTIFY/LISTEN, optional Redis)
- ✅ Rate limiting (60 req/min per IP)
- ✅ Comprehensive metrics with standardized naming
- ✅ Alert configuration and monitoring dashboards
- ✅ CI integration with retry logic
- ✅ Load testing and performance validation

---

## Future Extensions (not part of this task)
- Automatic SQL execution with result preview.
- Interactive error correction (LLM retry if invalid).
- Admin feedback on generated SQL quality.
- Enrich schema manifests with column descriptions and usage stats once token budget allows.

---

**Deliverable:** Updated backend that returns valid schema-aware SQL queries via `/routes/sqlGenerator.js`, ready for manual testing in `psql`.

---

## FAQ
- **How is the schema cache invalidated?**  
  Use both the TTL refresh (5 min prod / 1 min dev) and the authenticated `POST /admin/cache/schema/bust` endpoint, which should be called after migrations (CI hook) or when manual busting is required.
- **What structure should failure responses follow?**  
  Return the `HTTP 422` payload shown above for validation failures, keeping `HTTP 400` for malformed inputs and `HTTP 500` for unexpected errors.
- **Is the MRU cache per user?**  
  No. Maintain a shared per-instance MRU list (max 50 tables) that reflects aggregate usage and resets when the schema snapshot changes.
- **How are foreign keys captured?**  
  The snapshot includes FK relationships gathered from `information_schema.table_constraints` and `information_schema.key_column_usage` so ranking logic can reason about joins.
- **What happens if cache bust fails during deployment?**
  CI retries the bust call up to three times with exponential backoff; if it still fails, the deployment is aborted and alerts are sent for manual follow-up.
- **Why not use `pg_query/libpg_query` for AST parsing?**
  While AST parsing provides theoretical benefits, the combination of enhanced regex validation + PostgreSQL EXPLAIN on a read-only connection provides equivalent security without native module complexity. This reduces deployment friction and build requirements while maintaining comprehensive safety guarantees.
- **What cache invalidation mechanism should be used?**
  PostgreSQL NOTIFY/LISTEN by default (native to Postgres, zero dependencies). If `REDIS_URL` is configured, Redis pub/sub is used instead for lower latency. Both achieve distributed invalidation across multiple instances.
- **What if EXPLAIN hangs on a complex query?**
  The EXPLAIN statement executes with `statement_timeout=1000` (1 second) to prevent hangs on pathological queries. The query is rejected if EXPLAIN times out.
