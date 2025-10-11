# PRD v0.9.1 – LLM Mapping (Dry-Run Mode)

## 🎯 Goal
Add Tier C (LLM-based) mapping to the lab analyte mapping pipeline. The feature enhances coverage by proposing canonical analyte codes for unmapped or ambiguous parameters detected after deterministic and fuzzy tiers.

For now, the LLM operates in **dry-run mode** – i.e., it does **not modify the database**, only logs suggestions.

---

## 🧠 Context
The current mapping pipeline performs:
1. **Tier A – Deterministic mapping:** direct alias match from `analyte_aliases`.
2. **Tier B – Fuzzy mapping:** trigram similarity search via `pg_trgm`.
3. **Tier C – LLM mapping (new):** semantic reasoning for unmapped or ambiguous labels.

This feature will handle all `UNMAPPED` and `AMBIGUOUS_FUZZY` rows, generating intelligent mapping suggestions.

---

## 🧩 Requirements

### Implementation Decisions

| # | Topic | Decision | Rationale |
|---|-------|----------|-----------|
| 1 | **Batching** | Once per report | More context, lower cost (~5-15 unmapped rows fits in one call) |
| 2 | **category_context** | Mapped rows only | Provides semantic grouping hints (e.g., lipid panel detection) |
| 3 | **Schema size** | Send full list (58 analytes) | Simple and clear (~1100 tokens) |
| 4 | **"NEW" handling** | Include proposed code + name | Easier future seeding and human review |
| 5 | **Retry logic** | No retry (log only) | Keep simple for dry-run; add in v1.0 |
| 6 | **Model** | gpt-5-mini | Cost-effective for v0.9.1 evaluation |
| 7 | **API** | Responses API | Modern stateful API with better cache utilization |

### Input
Each record passed to Tier C should include:
```json
{
  "result_id": "uuid",
  "label_raw": "string",
  "label_norm": "string",
  "unit": "string | null",
  "numeric_result": "string | null",
  "reference_hint": "string | null",
  "category_context": ["HDL", "LDL", "Triglycerides", ...]
}
```

### LLM Prompt Template
```
System: You are a medical LIMS (Laboratory Information Management System) specialist.
Given a lab parameter label and context, propose a canonical analyte code from the HealthUp database.

Available analytes (code | name | category):
HGB | Hemoglobin | Hematology
WBC | White Blood Cells | Hematology
ALT | Alanine Aminotransferase | Liver
...

Rules:
- Use ONLY codes from the list above
- decision "MATCH": code exists in schema
- decision "NEW": parameter is valid but code missing (propose new code)
- decision "ABSTAIN": cannot determine mapping
- confidence: 0.0-1.0 (your certainty level)

Return JSON strictly in this format:
{
  "decision": "MATCH" | "NEW" | "ABSTAIN",
  "code": "string | null",
  "confidence": 0.95,
  "comment": "brief explanation"
}

User: Map this lab parameter:
Label: "{label_raw}"
Unit: "{unit}"
Reference: "{reference_hint}"
Context: Other parameters in this report include {category_context}
```

**Response validation schema:**
```js
const LLMResponseSchema = {
  decision: z.enum(['MATCH', 'NEW', 'ABSTAIN']),
  code: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  comment: z.string()
};
```

### Output (logged)
```json
{
  "event": "mapping.row.llm",
  "result_id": "uuid",
  "label_raw": "Аполипопротеин A1",
  "tiers": {
    "llm": {
      "present": true,
      "decision": "MATCH",
      "code": "APOA1",
      "confidence": 0.91,
      "comment": "Apolipoprotein A1 is part of lipid panel."
    }
  },
  "final_decision": "MATCH_LLM"
}
```

### Integration
Inside `MappingApplier.dryRun()`:
1. Collect all rows with `final_decision` ∈ {`UNMAPPED`, `AMBIGUOUS_FUZZY`}.
2. For `AMBIGUOUS_FUZZY` rows, include the fuzzy candidates in the prompt:
   ```
   Fuzzy matches found:
   - FER (Ferritin) - similarity: 0.82
   - FERTN (Ferritin) - similarity: 0.78
   Please pick the best match or propose a different code.
   ```
3. Pass them to `proposeAnalytesWithLLM()`.
4. Append the LLM suggestions into the dry-run log.
5. Do not modify `lab_results` or related tables.

### New helper
`server/services/MappingApplier.js` (add function to existing file)

**Strategy: Batch per report** (all unmapped rows in one API call)

```js
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Call LLM to map unmapped/ambiguous parameters
 * @param {Array} unmappedRows - Rows with UNMAPPED or AMBIGUOUS_FUZZY decisions
 * @param {Array} mappedRows - Already-mapped rows for context
 * @param {Array} analyteSchema - All available analytes from DB
 * @returns {Promise<Array>} - Array of LLM suggestions per row
 */
async function proposeAnalytesWithLLM(unmappedRows, mappedRows, analyteSchema) {
  if (!unmappedRows || unmappedRows.length === 0) {
    return [];
  }

  // Build category context from already-mapped rows
  const categoryContext = mappedRows
    .map(r => r.final_analyte?.code)
    .filter(Boolean);

  // Build analyte schema string
  const schemaText = analyteSchema
    .map(a => `${a.code} (${a.name})`)
    .join('\n');

  // Build batch prompt
  const inputPrompt = buildBatchPrompt(unmappedRows, categoryContext, schemaText);

  try {
    const response = await openai.responses.create({
      model: 'gpt-5-mini',
      input: inputPrompt,
      max_output_tokens: 1000,
      text: {
        format: { type: 'json_object' }  // Responses API format structure
      }
    });

    return parseLLMBatchOutput(response.output_text, unmappedRows);
  } catch (error) {
    logger.error({ error: error.message }, 'LLM API call failed');
    // Return error placeholders for all rows
    return unmappedRows.map(row => ({
      result_id: row.result_id,
      decision: null,
      error: classifyError(error),
      code: null,
      confidence: 0
    }));
  }
}

function buildBatchPrompt(unmappedRows, categoryContext, schemaText) {
  return `You are a medical LIMS specialist. Map lab parameters to canonical analyte codes.

Available analytes:
${schemaText}

Context: This report already contains: ${categoryContext.join(', ') || 'none'}

Rules:
- decision "MATCH": code exists in schema above
- decision "NEW": valid analyte but not in schema (propose new code + name)
- decision "ABSTAIN": cannot determine mapping
- For AMBIGUOUS rows, pick the best match from candidates provided

Return JSON array with one object per parameter:
{
  "results": [
    {
      "label": "parameter name",
      "decision": "MATCH" | "NEW" | "ABSTAIN",
      "code": "string or null",
      "name": "string or null (only for NEW)",
      "confidence": 0.95,
      "comment": "brief reason"
    }
  ]
}

Parameters to map:
${unmappedRows.map((row, i) => `
${i + 1}. Label: "${row.label_raw}"
   Unit: ${row.unit || 'none'}
   Reference: ${row.reference_hint || 'none'}
   ${row.tiers?.fuzzy?.candidates ?
     `Ambiguous matches: ${row.tiers.fuzzy.candidates.map(c =>
       `${c.analyte_id} (sim: ${c.similarity})`).join(', ')}` : ''}
`).join('\n')}`;
}

function parseLLMBatchOutput(outputText, unmappedRows) {
  try {
    const parsed = JSON.parse(outputText);
    if (!parsed.results || !Array.isArray(parsed.results)) {
      throw new Error('Invalid JSON structure: missing results array');
    }
    return parsed.results;
  } catch (error) {
    logger.error({ error: error.message, outputText }, 'Failed to parse LLM output');
    return unmappedRows.map(row => ({
      result_id: row.result_id,
      decision: null,
      error: 'INVALID_JSON',
      code: null,
      confidence: 0
    }));
  }
}

function classifyError(error) {
  if (error.message?.includes('timeout')) return 'API_TIMEOUT';
  if (error.status === 429) return 'RATE_LIMIT';
  if (error.status === 401) return 'AUTH_ERROR';
  return 'API_ERROR';
}
```

### Logging additions
In `mapping.summary`, extend JSON with:
```json
"llm": {
  "matches": 0,
  "new": 0,
  "abstain": 0,
  "errors": 0,
  "unknown_code": 0,
  "avg_confidence": 0.0,
  "total_cost_usd": 0.0,
  "total_tokens": {
    "prompt": 0,
    "completion": 0
  }
}
```

### Error Handling
If OpenAI API fails (timeout, rate limit, invalid JSON), log the error and continue:

```json
{
  "event": "mapping.row",
  "result_id": "uuid",
  "label_raw": "Vitamin D",
  "tiers": {
    "deterministic": { "matched": false },
    "fuzzy": { "matched": false },
    "llm": {
      "present": true,
      "error": "OpenAI API timeout after 10000ms",
      "decision": null
    }
  },
  "final_decision": "UNMAPPED"
}
```

**Error categories:**
- `API_TIMEOUT`: Request exceeded timeout (default: 10s)
- `RATE_LIMIT`: OpenAI rate limit reached
- `INVALID_JSON`: LLM returned malformed JSON
- `UNKNOWN_CODE`: LLM proposed a code not in `analytes` table
- `API_ERROR`: Generic OpenAI API error

---

## ⚙️ Acceptance Criteria
- ✅ `proposeAnalytesWithLLM()` is called once per report (batching all unmapped rows).
- ✅ Logs show LLM decisions merged into `event: mapping.row` entries.
- ✅ Dry-run mode does **not modify DB**.
- ✅ Summary includes `llm` section with match/new/abstain/error counts.
- ✅ Latency target: <1000ms total for LLM call (typical: 300-800ms).
- ✅ Cost tracking: Log input/output tokens and estimated cost per report.
- ✅ Error handling: API failures log error type, continue processing.
- ✅ "NEW" decisions include proposed `code` and `name` fields.
- ✅ AMBIGUOUS_FUZZY rows include fuzzy candidates in prompt.

---

## 🚀 Future Work (v1.0)
- Store LLM suggestions in `analyte_suggestions` or `match_reviews` table.
- Allow user review/approval of new analytes.
- Auto-seed approved analytes into `analyte_aliases`.
- Add prompt optimization for multilingual matching.

---

## 🧾 Example Outcome (Expected Log)
```json
{
  "label_raw": "Апо A1",
  "tiers": {
    "llm": {
      "present": true,
      "decision": "MATCH",
      "code": "APOA1",
      "confidence": 0.93,
      "comment": "Likely Apolipoprotein A1 from lipid panel"
    }
  },
  "final_decision": "MATCH_LLM"
}
```