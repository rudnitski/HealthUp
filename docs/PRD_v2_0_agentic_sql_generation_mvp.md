# PRD: Agentic SQL Generation with Fuzzy Search (MVP)

## Goal
Enable HealthUp to generate accurate SQL queries for multilingual, heterogeneous lab results data — without manual synonym rules — by giving the LLM controlled access to database exploration tools and fuzzy search capabilities.

---

## Summary
Users ask questions in natural language (any language, any lab naming).  
The AI agent interprets the question, explores the database using approved tools, and produces a safe, validated SQL query returning correct data.

The focus of this MVP is **correctness and flexibility**, not latency or cost.  
Caching, analyte matching, and security hardening are out of scope for now.

---

## Architecture Overview

### 1. Core Loop
Implement an **agentic reasoning loop** (max 4–5 iterations):
- The model reasons about the user question.
- Chooses which *tool* to call next.
- Receives results.
- Iterates until confident enough to produce a final query.

### 2. Available Tools
| Tool | Purpose | Returns | Safety |
|------|---------|---------|--------|
| `fuzzy_search_parameter_names` | Fuzzy search on `lab_results.parameter_name` using PostgreSQL trigram similarity. Used for term lookups like "витамин д", "холестерин". | Array of `{parameter_name, similarity_score}` up to `limit` (default 20) | **Privileged** - executed as parameterized query, bypasses validator |
| `execute_exploratory_sql` | Limited, read-only `SELECT` queries to understand data structure or value patterns. | Query result rows (up to LIMIT 20) | **Validated** - must pass existing `sqlValidator` checks |
| `generate_final_query` | Emits the final SQL + short human-readable explanation once confident. | Final SQL query + explanation | **Validated** - must pass existing `sqlValidator` + EXPLAIN checks |

**Tool Execution Model:**
- **Fuzzy search tools** use parameterized queries (`$1`, `$2`) executed directly via `pool.query()` - bypassing the validator since they're system-generated and safe.
- **Exploratory SQL** goes through the existing `validateSQL()` function to ensure safety.
- **Final query** gets full validation (regex + EXPLAIN) before returning to user.

### 3. Integration with Existing Systems

**Schema Context:**
- Reuse existing `schemaSnapshot.js` for table/column metadata.
- Reuse existing `promptBuilder.js` table ranking (MRU cache) to provide relevant schema context to the LLM.
- **schema_aliases.json role change:** Used ONLY for table ranking hints (e.g., "vitamin" → prioritize `analytes`, `lab_results` tables), NOT for term matching.
  - Term matching now handled by fuzzy search + LLM
  - No need to add specific medical terms like "витамин д", "cholesterol", etc.
  - Can be simplified or removed in future phases

**Validation:**
- Reuse existing `sqlValidator.js` for all exploratory and final SQL.
- No changes to validation rules (MAX_JOINS=8, MAX_SUBQUERIES=2, etc.).
- Fuzzy search tools bypass validation (privileged, parameterized).

**Audit:**
- Extend existing `sql_generation_logs` table metadata field (JSONB).
- No new tables needed for MVP.

---

## System Behavior

1. **Input:**  
   User natural-language question (any language).  
2. **Processing:**  
   Agent loop executes tools iteratively until it can build a validated SQL query.  
3. **Output:**  
   - Validated SQL query (single `SELECT` statement).  
   - Short explanation in the user’s language.  
   - Optional reasoning log for debugging/audit.  

---

## Design Principles
- **Quality > Cost.** Accuracy across languages and labs is the top priority.
- **LLM-driven exploration.** The model should discover table usage, relationships, and naming conventions through its own reasoning.
- **Zero manual curation.** No manual synonym lists or term mappings - fuzzy search + LLM intelligence replaces `schema_aliases.json` term matching.
- **Read-only safety.** All SQL must pass strict validation (no writes, no semicolons).
- **Transparency.** System should record tool calls and reasoning for later review.  

---

## Key Innovation: Eliminating Manual Term Curation

**Problem with previous approach (`schema_aliases.json`):**
- Required manual curation: Every medical term needed explicit mapping
- Couldn't handle variations: "vitamin d3", "25-hydroxyvitamin d", "calcidiol" all missing
- Script mixing failures: Database has "витамин D" (Cyrillic+Latin), user says "витамин д" (all Cyrillic) → no match
- Language explosion: Need entries for every language and every lab's naming convention
- Rigid: New labs or tests require config updates and redeployment

**How agentic approach solves this:**

1. **Fuzzy Search replaces exact matching:**
   - User: "витамин д" → Database: "витамин D (25-OH)" → Fuzzy match: 85% ✅
   - Handles typos, abbreviations, mixed scripts automatically
   - No manual synonym list needed

2. **LLM medical knowledge:**
   - Understands "calcidiol" = "25-hydroxyvitamin D" = "vitamin D"
   - No need to enumerate all chemical names
   - Works across all languages via translation understanding

3. **Dynamic adaptation:**
   - New lab uploads "Vitamin D, 25-Hydroxy, Total" → fuzzy search finds it automatically
   - No config changes needed
   - Scales internationally without manual translation lists

4. **schema_aliases.json new role:**
   - Kept ONLY for generic table hints ("vitamin" → check `analytes`, `lab_results`)
   - No specific medical terms needed
   - Can be simplified or removed post-MVP

**Result:** Zero-maintenance medical term matching across all languages and labs.

---

## Model & Configuration
Use **GPT-5-mini** for all iterations and query generation.

**New Environment Variables:**
```bash
# Agentic SQL Configuration
AGENTIC_SQL_ENABLED=true                  # Feature flag for agentic mode
AGENTIC_MAX_ITERATIONS=5                  # Maximum tool-calling iterations
AGENTIC_FUZZY_SEARCH_LIMIT=20             # Max results per fuzzy search
AGENTIC_EXPLORATORY_SQL_LIMIT=20          # Max rows for exploratory queries
AGENTIC_SIMILARITY_THRESHOLD=0.3          # pg_trgm similarity threshold
AGENTIC_TIMEOUT_MS=10000                  # Total timeout for agentic loop
```

**Fallback Behavior:**
- If `AGENTIC_SQL_ENABLED=false`, system uses existing single-shot SQL generation.
- This allows A/B testing and gradual rollout.

---

## Database Requirements
- PostgreSQL with `pg_trgm` extension (✅ already installed).
- **NEW:** Trigram GIN index on `lab_results.parameter_name` (see migration script in deliverables).
- Default similarity threshold: `0.3` (tunable via `SET pg_trgm.similarity_threshold`).
- Optional: Consider indices on `analytes.name` and `analyte_aliases.alias` for future expansion.  

---

## Out of Scope (for later phases)
- Caching or query memoization.
- Analyte/alias matching and canonicalization.
- Security/privacy enhancements beyond basic validation.
- Multi-model orchestration or confidence-based escalation.
- Removing/simplifying `schema_aliases.json` (kept for MVP as table ranking hint).  

---

## Success Criteria

### Functional
- **Correctness:** ≥ 85% of queries return correct results on internal test set (defined in Phase 4).
- **Efficiency:** Simple term searches ("витамин д", "холестерин") resolve in ≤ 2 iterations.
- **Fuzzy matching:** ≥ 85% top-1 match accuracy for known parameter names with script variations.

### Performance
- **Latency:** < 10s average end-to-end latency (local environment, GPT-5-mini).
- **Iteration budget:** 95% of queries complete within max iterations (4-5).

### Observability
- **Audit trail:** Every query attempt logs: iterations, tool calls, reasoning, final SQL.
- **Error tracking:** Failed queries log failure reason and which iteration failed.

### Test Set (to be defined in Phase 4)
- Minimum 50 questions covering:
  - Simple term searches (20 questions, multiple languages)
  - Aggregations and filters (15 questions)
  - Complex queries with JOINs (10 questions)
  - Edge cases: typos, mixed scripts, rare tests (5 questions)  

---

## Deliverables
- **Migration script:** SQL to create trigram index on `lab_results.parameter_name`.
- **Agentic SQL generation module:** Core iteration loop with tool orchestration.
- **Tool implementations:**
  - `fuzzySearchParameterNames(searchTerm, limit)`
  - `fuzzySearchAnalyteNames(searchTerm, limit)` (optional for MVP)
  - `executeExploratorySql(sql)` with safety validation
  - Tool result formatting and error handling
- **Integration:** Wire agentic module into existing `/api/sql/generate` endpoint.
- **Audit logging:** Extend existing `sql_generation_logs` metadata to include:
  - `iteration_count`
  - `tool_calls` array (tool name, parameters, results)
  - `reasoning_trace` (LLM's thought process per iteration)
- **Configuration:** Environment variables for max iterations, fuzzy search limits, similarity threshold.
- **Documentation:** Architecture decisions, tool usage examples, debugging guide.

---

## Architecture Decisions (FINALIZED)

### 1. Tool-Calling Mechanism ✅
**Decision:** OpenAI Native Function Calling with structured output for final query.

**Implementation:**
- Use OpenAI `tools` parameter for tool definitions
- LLM calls tools via native function calling mechanism
- Final `generate_final_query` returns structured output (sql + explanation)
- No additional dependencies required

---

### 2. Iteration Control Flow ✅

**Scenario A (0 results):** Trust LLM
- If fuzzy search returns 0 results, LLM can still call `generate_final_query`
- LLM should explain "no matching data found" in the response
- Log the empty results for debugging

**Scenario B (Max iterations without final query):** Force final answer
- On reaching max iterations (5), force LLM to generate best-effort query
- Append system message: "Max iterations reached. Generate your best answer now."
- Log as `forced_completion: true`

**Scenario C (Validation failure):** One bonus retry
- If validation fails, give LLM feedback and allow 1 retry (doesn't count toward max)
- If retry also fails, return validation error to user
- Log both attempts

---

### 3. User Experience ✅

**On Failure:** Simple error message
- "Unable to generate query. Please try rephrasing your question."
- Log detailed failure reason (for debugging)
- No suggestions or partial results in MVP

**On Success:** Return SQL + explanation only
- No progress indicators (silent mode)
- Clean, simple response

---

### 4. Confidence & Quality ✅

**Low similarity matches:** Trust LLM
- No minimum threshold enforcement
- LLM decides if 45% match is acceptable
- Log similarity scores for analysis

---

### 5. Rate Limiting & Cost ✅

**No special limits for MVP:**
- Use existing rate limit: 60 req/min per IP
- Accept cost: ~$10-30/day for 1000 questions
- No per-user quotas

---

### 6. Security & Access ✅

**Table access:** All tables in schema whitelist
- `execute_exploratory_sql` can query any table in `public.*`
- Existing validator enforces safety (read-only, no forbidden operations)
- Maximum flexibility for LLM exploration

---

### 7. Timeout Handling ✅

**Decision:** Return error after 15 seconds
- Total timeout: 15s (slightly higher than target 10s for edge cases)
- If timeout reached: Return error "Query generation timed out. Please simplify."
- Log: `timeout: true, iterations_completed: N`

**Rationale:** Clean failure better than partial results for POC.

---

### 8. Logging Strategy ✅

**Database only - detailed JSONB logs**
- Extend `sql_generation_logs.metadata` with:
  ```json
  {
    "agentic_mode": true,
    "iterations": [
      {
        "iteration": 1,
        "tool": "fuzzy_search_parameter_names",
        "params": {"search_term": "витамин д", "limit": 20},
        "results": [...],
        "llm_reasoning": "User asks about vitamin D..."
      }
    ],
    "forced_completion": false,
    "timeout": false
  }
  ```
- This gives full visibility into LLM's decision-making process

---

### 9. Database Migration ✅

**No formal migration framework needed (dev mode)**
- Provide SQL script: `migrations/add_trigram_index.sql`
- Developer runs manually during setup
- Or: Include in setup documentation with `psql` command

**Migration script:**
```sql
-- Create trigram index for fuzzy search
CREATE INDEX CONCURRENTLY IF NOT EXISTS lab_results_parameter_name_trgm_idx
ON lab_results USING gin (parameter_name gin_trgm_ops);

-- Verify index
\d lab_results
```
