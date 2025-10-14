# Agentic SQL Generation - Quick Start Guide

**For Developers:** Get agentic SQL generation running in 5 minutes.

---

## Prerequisites

- PostgreSQL with `pg_trgm` extension
- Node.js environment
- OpenAI API key
- Existing HealthUp database with lab results

---

## Setup (5 minutes)

### 1. Run Database Migration

```bash
psql healthup -f migrations/add_trigram_index.sql
```

**What it does:**
- Enables `pg_trgm` extension
- Creates trigram GIN index on `lab_results.parameter_name`
- Creates `sql_generation_logs` table (if not exists)

**Expected output:**
```
CREATE EXTENSION
CREATE INDEX
(shows verification query results)
Migration complete! ✅
```

### 2. Update .env File

Add these lines to your `.env`:

```bash
# SQL Generator Configuration (if not already present)
SQL_GENERATION_ENABLED=true
SQL_GENERATOR_MODEL=gpt-5-mini

# Agentic SQL Generation (v2.0)
AGENTIC_SQL_ENABLED=true
AGENTIC_MAX_ITERATIONS=5
AGENTIC_FUZZY_SEARCH_LIMIT=20
AGENTIC_EXPLORATORY_SQL_LIMIT=20
AGENTIC_SIMILARITY_THRESHOLD=0.3
AGENTIC_TIMEOUT_MS=45000
```

**Important:** Set `AGENTIC_TIMEOUT_MS=45000` (45 seconds) for development. Reduce to 15000-20000 for production after optimization.

### 3. Restart Your Server

```bash
npm run dev
```

**What to look for:**
```
[schemaSnapshot] Schema cache refreshed
[sqlGenerator] Using agentic mode
```

---

## Test It

### Quick Test (1 query)

```bash
node test/manual/test_agentic_sql.js 0
```

**Expected output:**
```
Test: Simple term search (Cyrillic)
Question: "какой у меня витамин д?"
✅ SUCCESS
Duration: ~30-45s
Iterations: 2-3
Generated SQL: SELECT ...
✓ Contains SELECT statement
✓ Contains expected term: "витамин"
```

### Full Test Suite (all 6 tests)

```bash
node test/manual/test_agentic_sql.js
```

**Takes:** ~5-10 minutes (with 2-second delays between tests)

---

## Verify It's Working

### 1. Check Logs

```bash
psql healthup -c "
SELECT
  id,
  status,
  prompt,
  metadata->>'total_iterations' as iterations,
  metadata->>'agentic_mode' as agentic,
  created_at
FROM sql_generation_logs
ORDER BY created_at DESC
LIMIT 5;
"
```

**Should show:**
- `agentic: true`
- `iterations: 2-3` for simple queries

### 2. Test Fuzzy Search Directly

```bash
node -e "
require('dotenv').config();
const { fuzzySearchParameterNames } = require('./server/services/agenticTools');

fuzzySearchParameterNames('витамин д', 10).then(result => {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
"
```

**Expected output:**
```json
{
  "search_term": "витамин д",
  "similarity_threshold": 0.3,
  "matches_found": 1,
  "matches": [
    {
      "parameter_name": "Общий витамин D (25-OH витамин D)",
      "similarity": "33%"
    }
  ]
}
```

---

## Usage via API

### Single-Shot Mode (existing)

```bash
curl -X POST http://localhost:3000/api/sql/generate \
  -H "Content-Type: application/json" \
  -d '{"question": "what is my vitamin d?"}'
```

### Agentic Mode (new)

Same endpoint! Just ensure `AGENTIC_SQL_ENABLED=true` in `.env`.

```bash
curl -X POST http://localhost:3000/api/sql/generate \
  -H "Content-Type: application/json" \
  -d '{"question": "какой у меня витамин д?"}'
```

**Response (success):**
```json
{
  "ok": true,
  "sql": "SELECT parameter_name, result_value, unit FROM lab_results WHERE ...",
  "explanation": "Запрос ищет результаты витамина D в вашей лаборатории...",
  "metadata": {
    "model": "gpt-5-mini",
    "duration_ms": 32145,
    "schema_snapshot_id": "abc123...",
    "agentic": {
      "iterations": 3,
      "forced_completion": false
    }
  }
}
```

**Response (failure):**
```json
{
  "ok": false,
  "error": {
    "code": "TIMEOUT",
    "message": "Query generation timed out. Please simplify your question."
  },
  "metadata": {
    "timeout": true,
    "iterations_completed": 3
  }
}
```

---

## Toggle Between Modes

### Enable Agentic Mode
```bash
export AGENTIC_SQL_ENABLED=true
npm run dev
```

### Disable (Fallback to Single-Shot)
```bash
export AGENTIC_SQL_ENABLED=false
npm run dev
```

**No code changes needed!** The system automatically routes to the correct mode.

---

## Monitoring & Debugging

### 1. Watch Logs in Real-Time

```bash
npm run dev | grep agenticSql
```

**You'll see:**
```
[agenticSql] Starting agentic loop
[agenticTools] fuzzy_search_parameter_names completed
[agenticSql] Executing tool
[agenticSql] SQL generation audit log
```

### 2. Check Success Rate

```bash
psql healthup -c "
SELECT
  COUNT(*) FILTER (WHERE status = 'success') * 100.0 / COUNT(*) as success_rate_pct,
  COUNT(*) FILTER (WHERE status = 'success') as successes,
  COUNT(*) FILTER (WHERE status = 'failed') as failures,
  COUNT(*) as total_queries
FROM sql_generation_logs
WHERE metadata->>'agentic_mode' = 'true'
  AND created_at > NOW() - INTERVAL '24 hours';
"
```

### 3. Analyze Iteration Counts

```bash
psql healthup -c "
SELECT
  (metadata->>'total_iterations')::int as iterations,
  COUNT(*) as query_count,
  AVG((metadata->>'total_duration_ms')::int) as avg_duration_ms
FROM sql_generation_logs
WHERE metadata->>'agentic_mode' = 'true'
GROUP BY iterations
ORDER BY iterations;
"
```

**Expected:**
- 1-2 iterations: Simple term searches (~10-15s)
- 3-4 iterations: Complex queries with JOINs (~20-30s)
- 5 iterations: Max reached, forced completion

---

## Troubleshooting

### Issue: "Table sql_generation_logs does not exist"

**Fix:**
```bash
psql healthup -c "
CREATE TABLE IF NOT EXISTS sql_generation_logs (
  id SERIAL PRIMARY KEY,
  status VARCHAR(50) NOT NULL,
  user_id_hash VARCHAR(64),
  prompt TEXT NOT NULL,
  generated_sql TEXT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
"
```

### Issue: "Fuzzy search returns 0 results"

**Check similarity threshold:**
```bash
psql healthup -c "
SELECT
  parameter_name,
  similarity(parameter_name, 'витамин') as score
FROM lab_results
WHERE parameter_name % 'витамин'
ORDER BY score DESC
LIMIT 5;
"
```

**Lower threshold if needed:**
```bash
# In .env
AGENTIC_SIMILARITY_THRESHOLD=0.2  # More permissive (default: 0.3)
```

### Issue: "Timeout after 15 seconds"

**Increase timeout for development:**
```bash
# In .env
AGENTIC_TIMEOUT_MS=45000  # 45 seconds for dev
```

**Note:** LLM reasoning takes time. 30-45s is normal for MVP. Optimize in Phase 2.

### Issue: "Temperature not supported" error

**Fixed:** We removed temperature parameter from API calls. gpt-5-mini doesn't support custom temperature in function calling mode.

---

## Common Test Queries

### English
```
"what is my vitamin d?"
"show me my cholesterol levels"
"hemoglobin results from last year"
```

### Russian (Cyrillic)
```
"какой у меня витамин д?"
"покажи мой холестерин"
"гемоглобин за последний год"
```

### Mixed Scripts (handled automatically!)
```
"витамин D"  → finds "Общий витамин D (25-OH витамин D)"
"vitamin д"  → also works
```

---

## Performance Tips

### For Development
- Use `AGENTIC_TIMEOUT_MS=45000` (gives LLM time to think)
- Enable verbose logging: `LOG_LEVEL=debug`

### For Production
- Reduce to `AGENTIC_TIMEOUT_MS=20000` (20 seconds)
- Consider caching fuzzy search results
- Monitor `sql_generation_logs` for slow queries

---

## Next Steps

1. **Test with real user queries** (build test set of 50 questions)
2. **Measure accuracy** (target: ≥85% correct results)
3. **Optimize latency** (target: <10s average)
4. **Add progress indicators** (show iteration progress to user)

---

## Need Help?

- **PRD:** [docs/PRD_v2_0_agentic_sql_generation_mvp.md](./PRD_v2_0_agentic_sql_generation_mvp.md)
- **Implementation Plan:** [docs/IMPLEMENTATION_PLAN_agentic_sql.md](./IMPLEMENTATION_PLAN_agentic_sql.md)
- **Implementation Summary:** [docs/IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md)
- **Logs:** Check `sql_generation_logs` table for debugging
- **Code:** [server/services/agenticSqlGenerator.js](../server/services/agenticSqlGenerator.js)

---

**Ready to go! 🚀**

The agentic SQL generation system is now running. It will automatically handle multilingual queries, fuzzy matching, and complex SQL generation through iterative exploration.
