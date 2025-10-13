# Implementation Plan: Agentic SQL Generation MVP

**Status:** ✅ PRD Finalized + Reviewer Feedback Incorporated
**Target:** POC/MVP - Quality over speed
**Reference:** [PRD v2.0](./PRD_v2_0_agentic_sql_generation_mvp.md)

---

## Reviewer Feedback Addressed

**✅ Suggestion 1: Mirror OpenAI Responses API flow**
- Detailed implementation shows tool call parsing, retry logic, and conversation management
- See Phase 2: `generateSqlWithAgenticLoop()` function with step-by-step flow

**✅ Suggestion 2: MRU update + logging strategy**
- `handleFinalQuery()` extracts tables from SQL and calls `updateMRU()` (existing pattern)
- Uses existing `sql_generation_logs` table with extended JSONB metadata
- Logs include: iterations, tool calls, confidence, forced completion, etc.

**✅ Suggestion 3: Exploratory query LIMIT enforcement**
- `executeExploratorySql()` validates with existing `validateSQL()` first
- Then manually clamps LIMIT to `AGENTIC_EXPLORATORY_SQL_LIMIT` (default 20)
- Validator enforces max 50, exploratory tool enforces stricter 20

**✅ Suggestion 4: Similarity threshold mechanics**
- Documented in `fuzzySearchParameterNames()` implementation
- Configurable via `AGENTIC_SIMILARITY_THRESHOLD` env var (default 0.3)
- Explanation of threshold tradeoffs (lower = more matches, higher = stricter)

**✅ Suggestion 5: HTTP response mapping**
- `handleFinalQuery()` returns response matching existing format
- `confidence` stored in logs but NOT exposed to client (internal metric)
- Response structure: `{ ok, sql, explanation, metadata }` (backward compatible)

---

## Critical Gaps Fixed (Round 2)

**⚠️ Gap 1: LIMIT Override**
- **Problem:** Validator injects LIMIT 50, but exploratory needs 20
- **Fix:** `executeExploratorySql()` now **unconditionally replaces** validator's LIMIT with 20
- **Location:** Phase 1, lines 163-170

**⚠️ Gap 2: API Consistency**
- **Problem:** Forced completion used wrong API (chat.completions vs responses.parse)
- **Fix:** Updated to use `openai.responses.parse()` with `text.format.json_schema`
- **Location:** Phase 2, lines 344-367

**⚠️ Gap 3: Similarity Threshold Application**
- **Problem:** Env var defined but not applied to queries
- **Fix:** `fuzzySearchParameterNames()` now runs `SET LOCAL pg_trgm.similarity_threshold`
- **Location:** Phase 1, lines 125-126

**⚠️ Gap 4: DB Persistence**
- **Status:** Already implemented in `logSqlGeneration()` function
- **Location:** Phase 2, lines 404-431

**⚠️ Gap 5: MRU Refresh**
- **Status:** Already implemented in `handleFinalQuery()` function
- **Location:** Phase 2, lines 338-343

**⚠️ Gap 6: Confidence Field**
- **Status:** Already documented as logged-only (not exposed to client)
- **Location:** Phase 2, lines 359-379

See [CRITICAL_GAPS_ADDRESSED.md](./CRITICAL_GAPS_ADDRESSED.md) for detailed analysis.

---

## Quick Start (Setup)

### 1. Run Migration
```bash
psql healthup -f migrations/add_trigram_index.sql
```

This creates the trigram index for fuzzy search (~5 seconds).

### 2. Update Environment
Copy new variables from `.env.example` to `.env`:
```bash
AGENTIC_SQL_ENABLED=true
AGENTIC_MAX_ITERATIONS=5
AGENTIC_FUZZY_SEARCH_LIMIT=20
AGENTIC_EXPLORATORY_SQL_LIMIT=20
AGENTIC_SIMILARITY_THRESHOLD=0.3
AGENTIC_TIMEOUT_MS=15000
```

### 3. Restart Server
```bash
npm run dev
```

---

## Architecture Overview

```
User Question: "витамин д"
    ↓
[Existing Route] /api/sql/generate
    ↓
[Schema Context] (existing promptBuilder.js)
- schema_aliases.json: "vitamin" → prioritize analytes/lab_results tables
- Provides ranked schema to LLM (NO term matching)
    ↓
Check: AGENTIC_SQL_ENABLED?
    ├─ false → [Existing] Single-shot SQL generation
    └─ true → [NEW] Agentic loop
         ↓
    [Agentic Module]
    - Initialize conversation with schema
    - Loop (max 5 iterations):
         ├─ Call OpenAI with tools
         ├─ LLM: fuzzy_search("витамин д")
         ├─ DB: Returns "витамин D (25-OH)" (85% similarity)
         ├─ LLM: "Found it! Mixed script handled by fuzzy search"
         └─ LLM: generate_final_query with fuzzy pattern
    ↓
[Existing] SQL Validator
    ↓
Return: {sql, explanation, metadata}
```

**Key Innovation - Eliminating Manual Term Curation:**
- **OLD:** schema_aliases.json does term matching → rigid, requires maintenance
- **NEW:** Fuzzy search + LLM intelligence does term matching → zero maintenance
- **schema_aliases.json new role:** Only for generic table hints (optional optimization)

---

## Implementation Phases

### Phase 1: Tool Implementations (Core)
**Files to create:**
- `server/services/agenticTools.js` - Tool implementations

**Functions:**
```javascript
// Fuzzy search on parameter names
async function fuzzySearchParameterNames(searchTerm, limit = 20)

// Fuzzy search on analytes (optional for MVP)
async function fuzzySearchAnalyteNames(searchTerm, limit = 20)

// Execute exploratory SQL with validation
async function executeExploratorySql(sql, reasoning, options = {})
```

**Detailed Implementation:**

```javascript
// Fuzzy search with trigram similarity
async function fuzzySearchParameterNames(searchTerm, limit = 20) {
  const similarityThreshold = parseFloat(process.env.AGENTIC_SIMILARITY_THRESHOLD) || 0.3;

  // CRITICAL: Set session-level threshold BEFORE query so % operator uses it
  await pool.query(`SET LOCAL pg_trgm.similarity_threshold = ${similarityThreshold}`);

  // Parameterized query - bypasses validator (privileged tool)
  const sql = `
    SELECT DISTINCT
      parameter_name,
      similarity(parameter_name, $1) as similarity_score
    FROM lab_results
    WHERE parameter_name % $1  -- % operator uses threshold set above
    ORDER BY similarity_score DESC, parameter_name
    LIMIT $2
  `;

  const result = await pool.query(sql, [searchTerm, limit]);

  return {
    search_term: searchTerm,
    similarity_threshold: similarityThreshold,
    matches_found: result.rows.length,
    matches: result.rows.map(row => ({
      parameter_name: row.parameter_name,
      similarity: Math.round(row.similarity_score * 100) + '%'
    }))
  };
}

// Execute exploratory SQL with validation and limit enforcement
async function executeExploratorySql(sql, reasoning) {
  const exploratoryLimit = parseInt(process.env.AGENTIC_EXPLORATORY_SQL_LIMIT) || 20;

  // Step 1: Validate SQL safety (uses existing validator)
  const validation = await validateSQL(sql);

  if (!validation.valid) {
    throw new Error(`SQL validation failed: ${JSON.stringify(validation.violations)}`);
  }

  // Step 2: CRITICAL FIX - Force replace validator's LIMIT
  // The validator ALWAYS injects LIMIT 50 (sqlValidator.js:248-268)
  // We must unconditionally replace it with our stricter 20-row limit for exploration
  let safeSql = validation.sqlWithLimit;

  if (/LIMIT\s+\d+/i.test(safeSql)) {
    // Replace ANY limit (validator injected 50) with our stricter limit
    safeSql = safeSql.replace(/LIMIT\s+\d+/i, `LIMIT ${exploratoryLimit}`);
  } else {
    // Safety: if validator didn't add LIMIT (shouldn't happen), add it
    safeSql = `${safeSql.trim()} LIMIT ${exploratoryLimit}`;
  }

  // Step 3: Execute query
  const result = await pool.query(safeSql);

  return {
    rows: result.rows,
    row_count: result.rowCount,
    reasoning,
    query_executed: safeSql  // Log the actual SQL with LIMIT 20
  };
}

// Similarity threshold mechanics:
// - Set via AGENTIC_SIMILARITY_THRESHOLD env var (default 0.3)
// - Applies to % operator in fuzzy search
// - Lower threshold (e.g., 0.2) = more matches, may include less relevant results
// - Higher threshold (e.g., 0.5) = fewer matches, only very similar terms
// - 0.3 is a good balance for medical terminology with script variations
```

**Dependencies:**
- Existing `pool` from `db.js`
- Existing `validateSQL` from `sqlValidator.js`
- `pg_trgm` extension (already installed)

---

### Phase 2: Agentic Loop (Core)
**Files to create:**
- `server/services/agenticSqlGenerator.js` - Main orchestrator

**Key function:**
```javascript
async function generateSqlWithAgenticLoop({
  question,
  userIdentifier,
  model = 'gpt-5-mini',
  schemaContext,
  schemaSnapshotId,
  maxIterations = 5
})
```

**Detailed Flow (mirrors OpenAI Responses API):**

```javascript
async function generateSqlWithAgenticLoop(params) {
  const { question, userIdentifier, schemaContext, schemaSnapshotId } = params;
  const startTime = Date.now();
  const requestId = crypto.randomUUID();
  const conversationHistory = [];
  const iterationLog = [];
  let retryCount = 0;

  // Step 1: Initialize conversation
  conversationHistory.push({
    role: 'system',
    content: buildAgenticSystemPrompt(schemaContext, maxIterations)
  });
  conversationHistory.push({
    role: 'user',
    content: `Question: ${question}`
  });

  // Step 2: Define tools
  const tools = [/* tool definitions */];

  // Step 3: Iteration loop
  for (let iteration = 1; iteration <= maxIterations; iteration++) {

    // 3a. Check timeout
    if (Date.now() - startTime > AGENTIC_TIMEOUT_MS) {
      return formatErrorResponse('TIMEOUT', iterationLog, iteration);
    }

    // 3b. Call OpenAI Responses API with tools
    const response = await openai.responses.parse({
      model: model || 'gpt-5-mini',
      input: conversationHistory,
      tools,
      metadata: { request_id: requestId, iteration }
    });

    // 3c. Parse tool calls from response
    const toolCalls = response.output_parsed?.tool_calls || [];
    const assistantMessage = response.output_parsed?.message;

    // Log LLM reasoning
    conversationHistory.push({
      role: 'assistant',
      content: assistantMessage,
      tool_calls: toolCalls
    });

    // 3d. Execute each tool call
    for (const toolCall of toolCalls) {
      const { name, parameters } = toolCall;

      try {
        let result;

        // Execute tool
        if (name === 'fuzzy_search_parameter_names') {
          result = await fuzzySearchParameterNames(parameters.search_term, parameters.limit);
        } else if (name === 'execute_exploratory_sql') {
          result = await executeExploratorySql(parameters.sql, parameters.reasoning);
        } else if (name === 'generate_final_query') {
          // Final query validation with retry logic
          return await handleFinalQuery(
            parameters,
            conversationHistory,
            iterationLog,
            retryCount,
            schemaSnapshotId,
            userIdentifier,
            requestId
          );
        }

        // Log iteration
        iterationLog.push({
          iteration,
          tool: name,
          params: parameters,
          results_count: result.matches_found || result.rows?.length || 0,
          results_preview: result.matches?.slice(0, 3) || result.rows?.slice(0, 3),
          llm_reasoning: assistantMessage,
          timestamp: new Date().toISOString()
        });

        // Append tool result to conversation
        conversationHistory.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result)
        });

      } catch (error) {
        // Tool execution error - give LLM error feedback
        iterationLog.push({
          iteration,
          tool: name,
          error: error.message,
          timestamp: new Date().toISOString()
        });

        conversationHistory.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: error.message })
        });
      }
    }

    // 3e. If no tool calls and no final query, continue iterating
    if (toolCalls.length === 0 && iteration < maxIterations) {
      conversationHistory.push({
        role: 'user',
        content: 'Please use one of the available tools to explore or generate your answer.'
      });
    }
  }

  // Step 4: Max iterations reached without final query - force completion
  conversationHistory.push({
    role: 'user',
    content: 'Maximum iterations reached. Generate your best answer now with generate_final_query.'
  });

  // CRITICAL FIX: Use responses.parse (not chat.completions.create)
  // Must match existing API usage in sqlGenerator.js:138-169
  const finalResponse = await openai.responses.parse({
    model: model || 'gpt-5-mini',
    input: conversationHistory,  // Use 'input' not 'messages'
    tools,  // Still provide tools for generate_final_query
    text: {  // CRITICAL: Include structured output schema for parsing
      format: {
        type: 'json_schema',
        name: 'final_query_forced',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            sql: { type: 'string' },
            explanation: { type: 'string' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] }
          },
          required: ['sql', 'explanation', 'confidence']
        }
      }
    },
    metadata: { request_id: requestId, forced: true }
  });

  // Parse forced completion
  const forcedToolCalls = finalResponse.output_parsed?.tool_calls || [];
  const finalQueryCall = forcedToolCalls.find(tc => tc.name === 'generate_final_query');

  if (finalQueryCall) {
    return await handleFinalQuery(
      finalQueryCall.parameters,
      conversationHistory,
      iterationLog,
      retryCount,
      schemaSnapshotId,
      userIdentifier,
      requestId,
      true // forcedCompletion = true
    );
  }

  // No final query even after forcing - return error
  return formatErrorResponse('NO_FINAL_QUERY', iterationLog, maxIterations);
}
```

**Helper Functions:**

```javascript
// Handle final query with validation and retry logic
async function handleFinalQuery(
  params,
  conversationHistory,
  iterationLog,
  retryCount,
  schemaSnapshotId,
  userIdentifier,
  requestId,
  forcedCompletion = false
) {
  const { sql, explanation, confidence } = params;
  const startTime = conversationHistory[0].timestamp || Date.now();

  // Validate SQL
  const validation = await validateSQL(sql, { schemaSnapshotId });

  if (!validation.valid) {
    // Validation failed
    if (retryCount >= 1) {
      // Already retried once - fail
      await logSqlGeneration({
        status: 'failed',
        userHash: createHash(userIdentifier),
        requestId,
        question: conversationHistory[1].content,
        sql,
        sqlHash: createHash(sql),
        validationOutcome: 'rejected',
        schemaSnapshotId,
        metadata: {
          agentic_mode: true,
          iterations: iterationLog,
          forced_completion: forcedCompletion,
          validation_violations: validation.violations,
          confidence
        }
      });

      return {
        ok: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Only single read-only SELECT statements are allowed.'
        },
        details: { violations: validation.violations },
        metadata: {
          total_iterations: iterationLog.length,
          duration_ms: Date.now() - startTime,
          schema_snapshot_id: schemaSnapshotId
        }
      };
    }

    // First validation failure - give LLM one retry
    retryCount++;
    conversationHistory.push({
      role: 'user',
      content: `Validation failed: ${JSON.stringify(validation.violations)}. Please fix the query and try again with generate_final_query.`
    });

    // Continue loop (handled by caller)
    return { retry: true, retryCount };
  }

  // Validation passed - success!
  const safeSql = validation.sqlWithLimit;
  const durationMs = Date.now() - startTime;

  // Update MRU cache with tables used in query
  const tablePattern = /FROM\s+([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?)/gi;
  let match;
  while ((match = tablePattern.exec(safeSql)) !== null) {
    updateMRU(match[1]); // From schemaSnapshot.js
  }

  // Log success to sql_generation_logs
  await logSqlGeneration({
    status: 'success',
    userHash: createHash(userIdentifier),
    requestId,
    question: conversationHistory[1].content,
    sql: safeSql,
    sqlHash: createHash(safeSql),
    validationOutcome: 'accepted',
    schemaSnapshotId,
    metadata: {
      agentic_mode: true,
      iterations: iterationLog,
      forced_completion: forcedCompletion,
      confidence, // Store internally but don't surface to client
      total_iterations: iterationLog.length,
      total_duration_ms: durationMs,
      model: 'gpt-5-mini'
    }
  });

  // Return successful response (matches existing format)
  return {
    ok: true,
    sql: safeSql,
    explanation: explanation || null,
    metadata: {
      model: 'gpt-5-mini',
      tokens: { prompt: 0, completion: 0, total: 0 }, // TODO: extract from OpenAI response
      duration_ms: durationMs,
      schema_snapshot_id: schemaSnapshotId,
      validator: validation.validator,
      // Note: confidence NOT included in client-facing response (logged only)
    }
  };
}

// Format error response
function formatErrorResponse(errorCode, iterationLog, iterationsCompleted) {
  const messages = {
    TIMEOUT: 'Query generation timed out. Please simplify your question.',
    NO_FINAL_QUERY: 'Unable to generate query. Please rephrase your question.'
  };

  return {
    ok: false,
    error: {
      code: errorCode,
      message: messages[errorCode] || 'Query generation failed.'
    },
    metadata: {
      timeout: errorCode === 'TIMEOUT',
      iterations_completed: iterationsCompleted,
      iteration_log: iterationLog // For debugging
    }
  };
}

// Log to sql_generation_logs table
async function logSqlGeneration(data) {
  const { status, userHash, requestId, question, sql, sqlHash, validationOutcome, schemaSnapshotId, metadata } = data;

  await pool.query(
    `INSERT INTO sql_generation_logs
     (status, user_id_hash, prompt, generated_sql, metadata, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [
      status,
      userHash,
      question,
      sql,
      JSON.stringify(metadata)
    ]
  );

  // Also log to console in dev
  logger.info({
    event_type: 'sql_generation',
    request_id: requestId,
    user_hash: userHash,
    question,
    sql_hash: sqlHash,
    validation_outcome: validationOutcome,
    schema_snapshot_id: schemaSnapshotId,
    metadata
  }, '[agenticSql] SQL generation audit log');
}
```

**Key Design Decisions Implemented:**

1. **Retry Logic:** One bonus retry on validation failure (doesn't count toward max iterations)
2. **MRU Update:** Extracts tables from final SQL and updates MRU cache (existing pattern)
3. **Logging Strategy:** Uses existing `sql_generation_logs` table with extended metadata
4. **Confidence Handling:** Stored in logs but NOT surfaced to client (internal metric only)
5. **Response Format:** Matches existing HTTP response structure (backward compatible)

---

### Phase 3: Integration (Wiring)
**Files to modify:**
- `server/services/sqlGenerator.js` - Add agentic mode check
- `server/routes/sqlGenerator.js` - Pass through (no changes likely)

**Logic in `sqlGenerator.js`:**
```javascript
const generateSqlQuery = async ({ question, userIdentifier, model }) => {
  // Existing schema snapshot
  const { manifest, snapshotId } = await getSchemaSnapshot();
  const schemaSummary = buildSchemaSection(manifest, question);

  // NEW: Check if agentic mode enabled
  if (process.env.AGENTIC_SQL_ENABLED === 'true') {
    return await generateSqlWithAgenticLoop({
      question,
      userIdentifier,
      model,
      schemaContext: schemaSummary,
      snapshotId
    });
  }

  // Existing single-shot generation
  // ... (keep existing code)
}
```

---

### Phase 4: Logging & Observability
**Files to modify:**
- `server/services/sqlGenerator.js` - Extend audit log

**Metadata schema:**
```json
{
  "agentic_mode": true,
  "iterations": [
    {
      "iteration": 1,
      "tool": "fuzzy_search_parameter_names",
      "params": {"search_term": "витамин д", "limit": 20},
      "results_count": 3,
      "results_preview": [
        {"parameter_name": "Общий витамин D", "similarity": "85%"}
      ],
      "llm_reasoning": "User asks about vitamin D...",
      "timestamp": "2025-01-13T14:22:15Z"
    }
  ],
  "forced_completion": false,
  "timeout": false,
  "total_iterations": 2,
  "total_duration_ms": 4521
}
```

---

## Technical Specifications

### Tool Definitions (OpenAI Format)

```javascript
const tools = [
  {
    type: "function",
    function: {
      name: "fuzzy_search_parameter_names",
      description: "Search for lab test parameter names similar to a search term using PostgreSQL trigram similarity. Handles multilingual queries, typos, abbreviations, and mixed scripts automatically (e.g., finds 'витамин D' when searching for 'витамин д'). Use this FIRST for term searches like 'витамин д', 'холестерин', 'glucose', 'calcidiol'. Returns top matches with similarity scores.",
      parameters: {
        type: "object",
        properties: {
          search_term: {
            type: "string",
            description: "The term to search for (any language, any script)"
          },
          limit: {
            type: "integer",
            description: "Maximum number of results to return (default 20)",
            default: 20
          }
        },
        required: ["search_term"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "execute_exploratory_sql",
      description: "Execute a read-only SELECT query to explore data structure, patterns, or specific records. Use this when you need to understand how data is organized. Query will be validated for safety.",
      parameters: {
        type: "object",
        properties: {
          sql: {
            type: "string",
            description: "A read-only SELECT query (will be validated)"
          },
          reasoning: {
            type: "string",
            description: "Why you need this query (for logging)"
          }
        },
        required: ["sql", "reasoning"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "generate_final_query",
      description: "Generate the final SQL query to answer the user's question. Call this when you have enough information and are confident in your answer.",
      parameters: {
        type: "object",
        properties: {
          sql: {
            type: "string",
            description: "The final SQL query"
          },
          explanation: {
            type: "string",
            description: "Brief explanation in user's language"
          },
          confidence: {
            type: "string",
            enum: ["high", "medium", "low"],
            description: "Your confidence level"
          }
        },
        required: ["sql", "explanation", "confidence"]
      }
    }
  }
];
```

---

### System Prompt for Agentic Mode

```javascript
const AGENTIC_SYSTEM_PROMPT = `You are an intelligent SQL query generator with exploration tools.

Your goal: Generate a perfect SQL query to answer the user's question about their lab results.

Database: PostgreSQL health lab results database (international, multilingual)
Challenge: Labs from different countries use different naming conventions. Parameter names may mix scripts (e.g., "витамин D" uses Cyrillic + Latin).

Available tools:
1. fuzzy_search_parameter_names - Fuzzy text matching with trigram similarity
   - Automatically handles: typos, abbreviations, mixed scripts (Cyrillic+Latin)
   - Example: Search "витамин д" finds "витамин D (25-OH)" with 85% similarity
   - USE THIS FIRST for medical term searches
   - No need for manual synonyms - understands variations automatically

2. execute_exploratory_sql - General data exploration
   - Use when you need to understand data structure, patterns, or value distributions

3. generate_final_query - Submit your final answer
   - Use when confident you have enough information

Strategy:
- For medical terms ("витамин д", "холестерин", "glucose"): START with fuzzy_search
- For chemical names (e.g., "calcidiol" = vitamin D): fuzzy_search finds similar terms automatically
- If fuzzy_search returns matches with >60% similarity: generate query immediately (1-2 iterations)
- If uncertain about data structure: use exploratory_sql
- Only call generate_final_query when confident
- If you find no data, explain this clearly in your final query

Important: fuzzy_search replaces manual term matching - trust its similarity scores.

You have ${maxIterations} iterations maximum. Use them wisely.

Database schema:
${schemaContext}
`;
```

---

## Error Handling

### 1. Timeout (15 seconds)
```javascript
if (Date.now() - startTime > AGENTIC_TIMEOUT_MS) {
  return {
    ok: false,
    error: { code: 'TIMEOUT', message: 'Query generation timed out. Please simplify.' },
    metadata: { timeout: true, iterations_completed: iteration }
  };
}
```

### 2. Max Iterations Without Final Query
```javascript
if (iteration === maxIterations && !finalQueryReceived) {
  // Force completion
  conversationHistory.push({
    role: 'user',
    content: 'Maximum iterations reached. Generate your best answer now with generate_final_query.'
  });
  // One more call
  const finalAttempt = await client.chat.completions.create(...);
  // Log as forced_completion: true
}
```

### 3. Validation Failure
```javascript
const validation = await validateSQL(sql);
if (!validation.valid) {
  // Give LLM one retry
  conversationHistory.push({
    role: 'user',
    content: `Validation failed: ${validation.violations}. Please fix and try again.`
  });
  retryCount++;
  if (retryCount > 1) {
    return { ok: false, error: { code: 'VALIDATION_FAILED', ... } };
  }
  // Continue loop
}
```

### 4. Tool Execution Failure
```javascript
try {
  const result = await executeTool(toolName, params);
} catch (error) {
  // Log error, continue loop with error message to LLM
  conversationHistory.push({
    role: 'tool',
    tool_call_id: toolCallId,
    content: JSON.stringify({ error: error.message })
  });
}
```

---

## Testing Strategy

### Manual Testing (Phase 1)

Create test script: `test/manual/test_agentic_sql.js`

```javascript
const testQueries = [
  { question: "какой у меня витамин д?", expectedIterations: 1-2, expectedMatch: "витамин D" },
  { question: "холестерин", expectedIterations: 1-2 },
  { question: "какие анализы хуже нормы?", expectedIterations: 2-3 },
  { question: "мой гемоглобин за последний год", expectedIterations: 2-3 },
];

for (const test of testQueries) {
  console.log(`Testing: "${test.question}"`);
  const result = await generateSql({ question: test.question, ... });
  console.log(`✓ Iterations: ${result.metadata.total_iterations}`);
  console.log(`✓ SQL: ${result.sql.substring(0, 100)}...`);
  console.log('---');
}
```

### Success Criteria
- ✅ Simple term searches resolve in ≤2 iterations
- ✅ Fuzzy search finds "витамин D" when user asks "витамин д"
- ✅ All queries pass validation
- ✅ Logs show clear reasoning trace

---

## File Structure (New Files)

```
server/
  services/
    agenticTools.js          ← NEW: Tool implementations
    agenticSqlGenerator.js   ← NEW: Main orchestrator
    sqlGenerator.js          ← MODIFIED: Add agentic mode check

migrations/
  add_trigram_index.sql      ← NEW: Database migration

docs/
  PRD_v2_0_agentic_sql_generation_mvp.md    ← FINALIZED
  IMPLEMENTATION_PLAN_agentic_sql.md        ← THIS FILE

test/
  manual/
    test_agentic_sql.js      ← NEW: Manual test script
```

---

## Rollout Plan

### Step 1: Setup (5 min)
- Run migration script
- Update `.env` with new variables
- **No changes needed to `schema_aliases.json`** - it's now only used for table ranking hints, not term matching

### Step 2: Implementation (3-4 hours)
- Phase 1: Tools (1 hour)
- Phase 2: Agentic loop (1.5 hours)
- Phase 3: Integration (30 min)
- Phase 4: Logging (1 hour)

### Step 3: Testing (1 hour)
- Run manual test suite
- Check logs for reasoning traces
- Test edge cases (typos, rare tests, complex queries)

### Step 4: Deploy (POC mode)
- Keep `AGENTIC_SQL_ENABLED=true` in dev
- Monitor logs for first 50 queries
- Iterate based on findings

---

## Monitoring & Debugging

### Key Metrics to Track
```sql
-- Average iterations per query
SELECT AVG((metadata->'total_iterations')::int) FROM sql_generation_logs WHERE metadata->>'agentic_mode' = 'true';

-- Success rate
SELECT
  COUNT(*) FILTER (WHERE status = 'success') * 100.0 / COUNT(*) as success_rate
FROM sql_generation_logs
WHERE metadata->>'agentic_mode' = 'true';

-- Most used tools
SELECT
  jsonb_array_elements(metadata->'iterations')->>'tool' as tool,
  COUNT(*) as usage_count
FROM sql_generation_logs
WHERE metadata->>'agentic_mode' = 'true'
GROUP BY tool
ORDER BY usage_count DESC;

-- Timeout/forced completion rate
SELECT
  COUNT(*) FILTER (WHERE metadata->>'timeout' = 'true') as timeouts,
  COUNT(*) FILTER (WHERE metadata->>'forced_completion' = 'true') as forced
FROM sql_generation_logs
WHERE metadata->>'agentic_mode' = 'true';
```

### Debug Logging
In development, log each iteration:
```javascript
logger.info({
  iteration,
  tool_calls: toolCalls.map(t => ({ name: t.function.name, params: t.function.arguments })),
  results_count: results.length,
  llm_reasoning: responseMessage.content
}, '[agenticSql] Iteration complete');
```

---

## Next Steps (Post-MVP)

### Phase 2 Enhancements (Future)
- **Caching:** Cache fuzzy search results by search term
- **Confidence scoring:** Add user-facing confidence indicators
- **Progressive UI:** Show real-time iteration progress
- **Query refinement:** Allow user to refine based on LLM suggestions
- **Multi-language:** Test with non-Russian/English languages
- **Analyte matching:** Integrate with existing analyte matching system
- **Simplify schema_aliases.json:** Remove specific medical terms, keep only generic table hints or remove entirely

### Phase 3 Production (Future)
- **Security audit:** Review tool execution for edge cases
- **Performance optimization:** Reduce LLM call latency
- **Cost monitoring:** Track per-user costs
- **A/B testing:** Compare agentic vs single-shot quality

---

## Summary

**What we're building:**
- Agentic SQL generator that explores the database before answering
- Uses fuzzy search for multilingual/mixed-script matching
- 3 tools: fuzzy_search, exploratory_sql, generate_final_query
- Full audit trail of LLM reasoning

**Why it's better:**
- **Zero manual term curation:** Fuzzy search + LLM intelligence replaces `schema_aliases.json` term matching
- Handles "витамин д" → "витамин D" automatically (mixed scripts, typos, abbreviations)
- Understands medical terminology (LLM knows "calcidiol" = "vitamin D")
- Adapts to any lab naming convention (exploration)
- Self-correcting through iteration
- Transparent (logs show reasoning)
- Scales internationally without config changes

**How to start:**
1. Run migration: `psql healthup -f migrations/add_trigram_index.sql`
2. Update `.env` with new variables
3. Implement Phase 1 (tools) - start coding!

**Questions?** Review [PRD v2.0](./PRD_v2_0_agentic_sql_generation_mvp.md) for detailed decisions.
