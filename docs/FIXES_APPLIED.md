# Fixes Applied Based on User Feedback

## Issues Identified and Fixed

### ❌ Issue 1: Hardcoded UUID in Generated SQL
**Problem**: LLM generated SQL with placeholder UUID `'00000000-0000-0000-0000-000000000000'`:
```sql
WHERE p.id = '00000000-0000-0000-0000-000000000000'
```

**Root Cause**: System prompt didn't explicitly forbid hardcoded UUIDs and didn't clarify how to handle "my" queries.

**Fix Applied** ([server/services/promptBuilder.js](../server/services/promptBuilder.js:303-306)):
```javascript
Safety rules:
- NEVER use placeholders like :param, $1, or ? - queries must be executable as-is
- NEVER hardcode UUIDs like '00000000-0000-0000-0000-000000000000'
- For patient-specific queries, generate queries that work for ALL patients (no WHERE patient.id = ...)
- When user says "my" or "мои", generate a query for ALL patients (frontend will filter)
```

**User Prompt Updated**:
```
IMPORTANT: Do NOT filter by specific patient ID. Generate queries that work for ALL patients.
```

**Expected Result**: Queries now return all patients, allowing frontend to filter by authenticated user.

---

### ❌ Issue 2: Analyte Codes Not Properly Indexed
**Problem**: Schema aliases didn't include `analyte_aliases` table and analyte `code` column for better matching.

**Fix Applied** ([config/schema_aliases.json](../config/schema_aliases.json)):
```json
{
  "vitamin d": ["analytes.name", "analytes.code", "analyte_aliases.alias", "lab_results"],
  "витамин д": ["analytes.name", "analytes.code", "analyte_aliases.alias", "lab_results"],
  "analyte": ["analytes", "analyte_aliases"]
}
```

**Impact**:
- Now properly includes `analyte_aliases` table in ranking
- Includes `analytes.code` for code-based matching (e.g., VITD)
- Better Russian language support

---

### ❌ Issue 3: Cannot See LLM Request/Response in Logs
**Problem**: Pino logger was not configured for pretty-printing in development, and LLM requests weren't logged.

**Fix 1: Pino Pretty Printing** ([server/services/sqlGenerator.js](../server/services/sqlGenerator.js:17-27)):
```javascript
const logger = pino({
  transport: NODE_ENV === 'development' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss',
      ignore: 'pid,hostname',
    },
  } : undefined,
});
```

**Fix 2: Log LLM Request** ([server/services/sqlGenerator.js](../server/services/sqlGenerator.js:175-181)):
```javascript
logger.info({
  request_id: requestId,
  model: requestPayload.model,
  system_prompt: systemPrompt,
  user_prompt: userPrompt,
  schema_snapshot_id: schemaSnapshotId,
}, '[sqlGenerator] LLM Request');
```

**Fix 3: Log LLM Response** ([server/services/sqlGenerator.js](../server/services/sqlGenerator.js:188-192)):
```javascript
logger.info({
  request_id: requestId,
  model: response?.model,
  response: response?.output_parsed,
}, '[sqlGenerator] LLM Response');
```

**Expected Output in Logs**:
```
[HH:MM:ss] INFO: [sqlGenerator] LLM Request
    request_id: "cd31f75c..."
    model: "gpt-5-mini-2025-08-07"
    system_prompt: "You are a PostgreSQL query generator..."
    user_prompt: "Question (Russian): покажи мне все мои анализы витамина Д\n\nDatabase Schema:..."
    schema_snapshot_id: "93d394b0..."

[HH:MM:ss] INFO: [sqlGenerator] LLM Response
    request_id: "cd31f75c..."
    model: "gpt-5-mini-2025-08-07"
    response: {
      sql: "SELECT ...",
      explanation: "..."
    }
```

---

## Additional Improvements Made

### 1. Better Error Messages for Placeholders
Added detection for all placeholder types:
- `:param` (named placeholders)
- `$1`, `$2` (positional placeholders)
- `?` (question mark placeholders)

Returns structured error:
```json
{
  "code": "PLACEHOLDER_SYNTAX",
  "pattern": ":placeholder"
}
```

### 2. Enhanced Schema Aliases
Added Russian language support and more comprehensive mappings:
```json
{
  "test date": ["lab_results", "patient_reports"],
  "unit": ["lab_results", "analytes"]
}
```

---

## How to Test

### Test 1: No Hardcoded UUIDs
```bash
curl -X POST http://localhost:3000/api/sql-generator \
  -H 'Content-Type: application/json' \
  -d '{"question": "покажи мне все мои анализы витамина Д"}'
```

**Expected**: SQL should NOT contain `WHERE p.id = '00000000-...'`

### Test 2: Pretty Logs in Development
```bash
npm run dev
```

**Expected**: Colored, formatted logs with timestamps:
```
[12:45:02] INFO: [sqlGenerator] LLM Request
    request_id: "..."
    system_prompt: "..."
```

### Test 3: Analyte Matching
```bash
curl -X POST http://localhost:3000/api/sql-generator \
  -H 'Content-Type: application/json' \
  -d '{"question": "Show vitamin D tests"}'
```

**Expected**: SQL should include:
- JOIN with `analytes` table
- JOIN with `analyte_aliases` table
- Checks on `a.code`, `a.name`, `aa.alias`

---

## Files Modified

1. **server/services/promptBuilder.js**
   - Updated system prompt to forbid UUIDs and placeholders
   - Updated user prompt with explicit instructions
   - Lines 303-320

2. **config/schema_aliases.json**
   - Added Russian language aliases
   - Added `analyte_aliases` table references
   - Added `analytes.code` column references
   - Lines 2-3, 10, 20, 23

3. **server/services/sqlGenerator.js**
   - Configured Pino with pretty-printing in development
   - Added LLM request logging
   - Added LLM response logging
   - Lines 15-27, 175-200

---

## Summary

✅ **All 3 issues fixed:**
1. No more hardcoded UUIDs - queries work for all patients
2. Better analyte matching with codes and aliases
3. Beautiful, readable logs with full LLM request/response visibility

**Status**: Ready for testing
