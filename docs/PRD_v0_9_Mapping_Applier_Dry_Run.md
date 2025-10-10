# PRD — Mapping Applier (Dry-Run Mode)

## Objective
For each parsed `lab_results` row in a report, compute a canonical mapping decision **without mutating the DB** and emit structured logs so we can analyze and tune prompts or thresholds.

---

## Prerequisites

Before enabling dry-run mode, ensure:

### 1. Schema Ready ✅
- `analytes` table exists (from PRD v0.8)
- `analyte_aliases` table exists with indexes
- `lab_results.analyte_id` column present
- `pg_trgm` extension installed

### 2. Seed Data ⚠️
- `analytes` table seeded with ≥50 canonical tests
  - Example: FER (Ferritin), HDL, ALT, AST, GLU (Glucose), TSH, HBA1C, etc.
- `analyte_aliases` populated with 200-500 multilingual aliases
  - English, Russian, Ukrainian variants
  - Common typos and abbreviations

### 3. Expected Initial Behavior
- **Without seed data**: Expect 100% `UNMAPPED` on first runs (normal)
- **With seed data**: Target 50-70% coverage on typical lab reports
- Use logs to identify which aliases to add next

### 4. Configuration
- Set `ENABLE_MAPPING_DRY_RUN=true` in `.env`
- Configure thresholds (defaults usually sufficient for v0.9)
- Install structured logger (Pino)

---

## Placement in Pipeline
- Runs **after** Vision extraction & persistence of raw rows.
- Runs **before** any future writeback steps.
- Triggered only if `ENABLE_MAPPING_DRY_RUN=true`.

---

## Inputs
- `report_id` (UUID), `patient_id` (UUID)
- Parsed parameters for that report: `parameter_name`, `unit`, `numeric_result`, `result_value`, `reference_full_text`
- Optional `analyte_suggestions[]` from the mapping LLM step if available.

---

## Outputs (No DB Writes)
- Structured JSON logs per report and per row (via Pino logger).
- Summary log per report with counters and timings.

---

## Algorithm (Read-Only)

### 1. Normalize Label

Apply Unicode-safe normalization to handle multilingual lab reports:

```javascript
function normalizeLabel(raw) {
  if (!raw || typeof raw !== 'string') return null;

  return raw
    .toLowerCase()
    .normalize('NFKD')                    // Unicode decomposition
    .replace(/[\u0300-\u036f]/g, '')      // Strip diacritics (é→e)
    .replace(/μ/g, 'micro')               // Unify micro symbol
    .replace(/[^\p{L}\p{N}\s]/gu, '')     // Keep letters, numbers, spaces
    .replace(/\s+/g, ' ')                 // Collapse whitespace
    .trim();
}
```

**Examples:**
- `"ALT (SGPT)"` → `"alt sgpt"` (keeps both tokens)
- `"Витамин D (25-OH)"` → `"витамин d 25 oh"`
- `"Fer ritin  "` → `"fer ritin"` (collapses spaces)
- `"  µg/mL  "` → `"microg ml"`

**Design Notes:**
- Parenthetical clarifications are preserved as separate words (not dropped)
- Cyrillic variants (Гемоглобін vs Гемоглобин) require exact alias matches in v0.9
- Future: Add transliteration layer for cross-language fuzzy matching

### 2. Tier A — Exact Alias Match

```sql
SELECT analyte_id, alias
FROM analyte_aliases
WHERE LOWER(alias) = $1
LIMIT 1;
```

### 3. Tier B — Fuzzy Alias Match (pg_trgm)

**Single-row query:**
```sql
SELECT analyte_id, alias, similarity(LOWER(alias), $1) AS sim
FROM analyte_aliases
WHERE LOWER(alias) % $1
ORDER BY sim DESC
LIMIT 2;  -- Fetch top-2 to detect ambiguity
```

**Batched query (preferred):**
```sql
WITH normalized_labels(result_id, label_norm) AS (
  VALUES
    ($1, $2),
    ($3, $4),
    ...
),
fuzzy_matches AS (
  SELECT DISTINCT ON (nl.label_norm)
    nl.result_id,
    nl.label_norm,
    aa.analyte_id,
    aa.alias,
    similarity(LOWER(aa.alias), nl.label_norm) as sim
  FROM normalized_labels nl
  CROSS JOIN analyte_aliases aa
  WHERE LOWER(aa.alias) % nl.label_norm
  ORDER BY nl.label_norm, sim DESC
)
SELECT * FROM fuzzy_matches WHERE sim >= $threshold;
```

**Logic:**
- Use if `pg_trgm` available and Tier A not matched.
- Accept if `sim ≥ BACKFILL_SIMILARITY_THRESHOLD` (default 0.70).
- If top-2 results within Δ ≤ 0.05, treat as ambiguous (see edge cases).

### 4. Tier C — Consume LLM Suggestions

**v0.9 Implementation:** Stub only (returns empty array).

```javascript
async function proposeAnalytesWithLLM(parameters) {
  // Stub for v0.9 - LLM integration deferred to v1.0
  return [];
}
```

**v1.0+ Behavior:**
- If suggestion exists for `parameter_name`:
  - `MATCH` + known code → lookup `analyte_id`, emit `MATCH_LLM`
  - `MATCH` + unknown code → emit `UNKNOWN_LLM_CODE`
  - `NEW` → `NEW_LLM`
  - `ABSTAIN` → `ABSTAIN_LLM`

### 5. Otherwise
- `decision = UNMAPPED`, `confidence = 0`.

> **Important:** Dry-run never writes to DB. Only logs what it would do.

---

## Decision Priority & Conflict Resolution

When multiple tiers match, apply these rules in order:

### Priority Hierarchy

1. **Tier A (Exact) always wins**
   - `final_decision = "MATCH_EXACT"`
   - `confidence = 1.0`
   - Skip other tiers

2. **Tier B (Fuzzy) with high similarity**
   - If `sim ≥ AUTO_ACCEPT` (0.80) AND no ambiguity:
     - Check if Tier C (LLM) agrees on same `analyte_id`
       - **Agrees:** `final_decision = "MATCH_FUZZY"`, `confidence = max(sim, llm_conf)`
       - **Disagrees:** `final_decision = "CONFLICT_FUZZY_LLM"`, prefer fuzzy if `sim > llm_conf`, else prefer LLM
     - If LLM not present: `final_decision = "MATCH_FUZZY"`, `confidence = sim`

3. **Tier B (Fuzzy) with ambiguity**
   - If top-2 results have Δ ≤ 0.05:
     - `final_decision = "AMBIGUOUS_FUZZY"`
     - Log both candidates (see edge cases)
     - Do NOT auto-accept (even if sim > 0.80)

4. **Tier C (LLM) standalone**
   - If Tier A and B failed, use LLM suggestion:
     - `MATCH` → Lookup `analyte_id` by code
       - **Found:** `final_decision = "MATCH_LLM"`, `confidence = llm_conf`
       - **Not found:** `final_decision = "UNKNOWN_LLM_CODE"` (see edge cases)
     - `NEW` → `final_decision = "NEW_LLM"`
     - `ABSTAIN` → `final_decision = "ABSTAIN_LLM"`

5. **No matches**
   - `final_decision = "UNMAPPED"`
   - `confidence = 0`

### Logging Conflicts

When fuzzy and LLM disagree (rare), log:
```json
{
  "final_decision": "CONFLICT_FUZZY_LLM",
  "final_analyte": { "analyte_id": 12, "source": "fuzzy" },
  "confidence": 0.82,
  "conflict_detail": {
    "fuzzy_suggested": 12,
    "llm_suggested": 45,
    "resolved_by": "higher_confidence"
  }
}
```

---

## Logging Format

### Per-Row Log (`mapping.row`)
```json
{
  "event": "mapping.row",
  "report_id": "<uuid>",
  "patient_id": "<uuid>",
  "result_id": "<uuid>",
  "position": 17,
  "label_raw": "Феретинн",
  "label_norm": "феретинн",
  "unit": "нг/мл",
  "numeric_result": 42.1,
  "reference_hint": "20–250",
  "tiers": {
    "deterministic": { "matched": false },
    "fuzzy": { "matched": true, "alias": "ферритин", "analyte_id": 12, "similarity": 0.82 },
    "llm": { "present": false }
  },
  "final_decision": "MATCH_FUZZY",
  "final_analyte": {
    "analyte_id": 12,
    "code": "FER",
    "name": "Ferritin",
    "source": "fuzzy"
  },
  "confidence": 0.82,
  "thresholds": {
    "fuzzy_match": 0.70,
    "auto_accept": 0.80,
    "queue_lower": 0.60
  },
  "dry_run": true,
  "duration_ms": 12
}
```

### Per-Report Summary Log (`mapping.summary`)
```json
{
  "event": "mapping.summary",
  "report_id": "<uuid>",
  "patient_id": "<uuid>",
  "counts": {
    "total_rows": 38,
    "deterministic_matches": 9,
    "fuzzy_matches": 17,
    "llm_matches": 0,
    "new_llm": 0,
    "abstain_llm": 0,
    "unmapped": 12,
    "ambiguous_fuzzy": 0,
    "conflict_fuzzy_llm": 0
  },
  "estimated_auto_accept": 21,
  "estimated_queue": 5,
  "estimated_new": 0,
  "performance": {
    "total_duration_ms": 146,
    "avg_row_latency_ms": 3.8,
    "tier_breakdown": {
      "deterministic_avg_ms": 2,
      "fuzzy_avg_ms": 15,
      "llm_avg_ms": 0
    },
    "slowest_row": {
      "result_id": "<uuid>",
      "label": "редкий параметр",
      "duration_ms": 48
    }
  },
  "data_quality": {
    "rows_with_unit": 36,
    "rows_with_numeric_result": 32,
    "rows_with_reference": 30,
    "rows_with_all_fields": 28
  },
  "thresholds_used": {
    "fuzzy_match": 0.70,
    "auto_accept": 0.80,
    "queue_lower": 0.60
  }
}
```

---

## Configuration (Env)

Add to `.env.example`:
```bash
# Mapping Applier (Dry-Run Mode)
ENABLE_MAPPING_DRY_RUN=false          # Set true to enable logging
MAPPING_AUTO_ACCEPT=0.80              # Confidence threshold for auto-accept
MAPPING_QUEUE_LOWER=0.60              # Lower bound for review queue
BACKFILL_SIMILARITY_THRESHOLD=0.70    # Minimum fuzzy similarity to accept
```

---

## Edge Cases

### 1. `pg_trgm` Extension Unavailable
- **Detection:** Check `SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_trgm')`
- **Behavior:** Skip Tier B entirely
- **Logging:**
  ```json
  "tiers": {
    "fuzzy": { "matched": false, "skipped": true, "reason": "pg_trgm unavailable" }
  }
  ```
- **Mitigation:** Fall back to Tier A and C only

### 2. Ambiguous Fuzzy Match
- **Condition:** Top-2 results within similarity Δ ≤ 0.05
- **Example:**
  - `ферритин` → sim 0.82 (analyte_id=12)
  - `ферритин с` → sim 0.81 (analyte_id=45)
- **Behavior:** Treat as unmapped, log both candidates
- **Logging:**
  ```json
  "tiers": {
    "fuzzy": {
      "matched": false,
      "ambiguous": true,
      "candidates": [
        {"analyte_id": 12, "alias": "ферритин", "similarity": 0.82},
        {"analyte_id": 45, "alias": "ферритин с", "similarity": 0.81}
      ]
    }
  },
  "final_decision": "AMBIGUOUS_FUZZY"
  ```
- **Mitigation:** Requires human review or more context (unit/range)

### 3. Unknown LLM Code
- **Condition:** LLM returns `MATCH` with `code="XYZ"`, but `XYZ` not in `analytes` table
- **Behavior:** Do not trust the match
- **Logging:**
  ```json
  "tiers": {
    "llm": {
      "present": true,
      "decision": "MATCH",
      "code": "XYZ",
      "confidence": 0.88,
      "unknown_code": true
    }
  },
  "final_decision": "UNKNOWN_LLM_CODE"
  ```
- **Mitigation:** Log for LLM prompt tuning

### 4. LLM Suggestions Not Present
- **Condition:** No `analyte_suggestions[]` passed to dry-run (v0.9 default)
- **Behavior:** Skip Tier C silently
- **Logging:**
  ```json
  "tiers": {
    "llm": { "present": false }
  }
  ```
- **Note:** Tier C is optional in v0.9. Future PRDs will integrate LLM mapping step.

### 5. Empty/Null Parameter Name
- **Condition:** `parameter_name` is null or empty string after normalization
- **Behavior:** Skip mapping, log as unmapped
- **Logging:**
  ```json
  "label_raw": null,
  "label_norm": null,
  "final_decision": "UNMAPPED",
  "note": "empty_label"
  ```

---

## Performance Targets

| Metric | Target (P50) | Target (P95) | Notes |
|--------|--------------|--------------|-------|
| **Per-report total** | <200ms | <500ms | For ~30 parameters |
| **Per-row processing** | <10ms avg | <20ms | Includes all 3 tiers |
| **Tier A (exact lookup)** | <2ms | <5ms | Indexed query |
| **Tier B (fuzzy search)** | <15ms | <50ms | Trigram GIN scan |
| **Tier C (LLM lookup)** | <1ms | <5ms | In-memory array join |

### Timeout Policy
- If Tier B takes >50ms for a single parameter, log warning and skip to Tier C
- Never block the entire request waiting for mapping

### Caching Strategy (Future)
- Maintain in-memory LRU cache of `normalized_label → analyte_id` (size: 1000 entries)
- Expected hit rate: 60-80% for repeat lab tests
- v0.9: No cache (log data to inform v1.0 cache design)

---

## Integration Points

### Location
- **File:** `server/routes/analyzeLabReport.js`
- **Hook:** After `persistLabReport()` succeeds, before sending HTTP response
- **Condition:** Only if `process.env.ENABLE_MAPPING_DRY_RUN === 'true'`

### Implementation Pattern

```javascript
// In analyzeLabReport.js, after line 801
if (process.env.ENABLE_MAPPING_DRY_RUN === 'true') {
  const { MappingApplier } = require('../services/MappingApplier');

  const { summary, rows } = await MappingApplier.dryRun({
    report_id: persistenceResult.reportId,
    patient_id: persistenceResult.patientId,
    // Optional: pass LLM suggestions if available (v1.0+)
    analyte_suggestions: null
  });

  // Logs are emitted via Pino logger (structured JSON)
  // No need to log manually - MappingApplier handles it
}
```

### Data Flow

1. `persistLabReport()` inserts rows into `lab_results` with `analyte_id=NULL`
2. `MappingApplier.dryRun()` reads those rows:
   ```sql
   SELECT id, position, parameter_name, unit, numeric_result,
          reference_full_text, result_value
   FROM lab_results
   WHERE report_id = $1
   ORDER BY position;
   ```
3. For each row:
   - Normalize `parameter_name`
   - Query Tier A (exact match)
   - Query Tier B (fuzzy match) - **batched if possible**
   - Check Tier C (in-memory lookup)
   - Log decision via Pino

4. Return summary + row logs (not persisted to DB in v0.9)

### Return Value (Debug Only)

```javascript
{
  summary: { /* mapping.summary log */ },
  rows: [ /* array of mapping.row logs */ ]
}
```

- **Do not** include in HTTP response (too verbose)
- **Do** log to console/file for analytics
- Future: Send to observability backend (Datadog, CloudWatch, etc.)

---

## Success Criteria

### Functional Requirements
- ✅ Logs emitted for every parsed report when `ENABLE_MAPPING_DRY_RUN=true`
- ✅ Zero DB mutations (verified by checking `analyte_id` remains `NULL` in `lab_results`)
- ✅ All three tiers execute correctly (when dependencies present)
- ✅ Edge cases handled gracefully (ambiguous fuzzy, unknown LLM codes, etc.)

### Observability Requirements
- ✅ Coverage metrics visible in summary logs:
  - Auto-accept % (sim ≥ 0.80)
  - Queue % (0.60 ≤ sim < 0.80)
  - Unmapped % (no matches)
- ✅ Performance metrics within SLA (P95 <500ms per report)
- ✅ Data quality correlation visible (unit/reference presence vs mapping success)

### Validation Tests

| Test Scenario | Expected Outcome |
|---------------|------------------|
| Report with 0 seeded analytes | All rows `UNMAPPED`, `"tiers.deterministic.matched": false` |
| Report with exact alias matches | Tier A matches, `confidence = 1.0` |
| Report with typo (Феретинн vs Ферритин) | Tier B fuzzy match if sim ≥ 0.70 |
| Report with ambiguous fuzzy | `"final_decision": "AMBIGUOUS_FUZZY"`, both candidates logged |
| Report with `pg_trgm` disabled | Tier B skipped, `"tiers.fuzzy.skipped": true` |
| Report processed twice | Identical logs (deterministic behavior) |
| Performance under load | 100 reports in <20 seconds (avg 200ms/report) |

### Post-Deployment Analysis

After 1 week of dry-run logs:
1. **Identify top 20 unmapped labels** → add to `analyte_aliases`
2. **Measure fuzzy threshold accuracy** → tune `BACKFILL_SIMILARITY_THRESHOLD` if needed
3. **Analyze conflict rate** (fuzzy vs LLM disagreements) → improve LLM prompt
4. **Check performance outliers** → optimize slow queries

---

## What We'll Learn

### Immediate Insights (Week 1)
1. **Alias Coverage Quality**
   - What % of real-world labels match existing aliases?
   - Which language variants are missing (Russian vs Ukrainian)?
   - Are abbreviations/typos common?

2. **Optimal Fuzzy Threshold**
   - Does 0.70 capture true positives without false positives?
   - How often do we get ambiguous matches (Δ ≤ 0.05)?
   - Should we adjust `AUTO_ACCEPT` threshold (currently 0.80)?

3. **LLM Suggestion Precision** *(when Tier C is enabled)*
   - Do LLM suggestions agree with fuzzy matches?
   - How often does LLM return unknown codes?
   - Are `NEW` suggestions legitimate or hallucinations?

4. **Unmapped Labels to Expand Dictionary**
   - Export top 100 unmapped `label_norm` values
   - Identify systematic gaps (e.g., all hormone tests missing)
   - Prioritize which aliases to add next

### Medium-Term Tuning (Month 1)
5. **Performance Characteristics**
   - Is fuzzy search the bottleneck? (if yes, add caching)
   - Do reports with more parameters take linearly longer?
   - Are there pathological cases causing timeouts?

6. **Data Quality Correlation**
   - Do parameters with units map better than those without?
   - Does reference range presence improve LLM accuracy?
   - Should we require minimum data completeness before mapping?

### Strategic Decisions (Month 2+)
7. **Readiness for Production Writes**
   - What % of parameters can we auto-accept (target: >60%)?
   - What % need human review queue (target: <30%)?
   - What % are truly novel tests (target: <10%)?

8. **LLM Integration ROI**
   - Does LLM add >10% coverage over fuzzy alone?
   - Is LLM cost justified by accuracy gains?
   - Should we pre-generate LLM suggestions for common labs?

### Example Analytics Queries

```sql
-- Top 20 unmapped labels
SELECT
  logs->>'label_norm' as label,
  COUNT(*) as frequency
FROM (
  SELECT jsonb_array_elements(summary_log->'rows') as logs
  FROM mapping_dry_run_logs
) t
WHERE logs->>'final_decision' = 'UNMAPPED'
GROUP BY label
ORDER BY frequency DESC
LIMIT 20;

-- Fuzzy similarity distribution
SELECT
  width_bucket((logs->'tiers'->'fuzzy'->>'similarity')::numeric, 0.5, 1.0, 10) * 0.05 + 0.5 as sim_bucket,
  COUNT(*) as count
FROM (
  SELECT jsonb_array_elements(summary_log->'rows') as logs
  FROM mapping_dry_run_logs
) t
WHERE logs->'tiers'->'fuzzy'->>'matched' = 'true'
GROUP BY sim_bucket
ORDER BY sim_bucket;

-- Performance analysis
SELECT
  report_id,
  (logs->>'total_duration_ms')::int as duration_ms,
  (logs->'counts'->>'total_rows')::int as row_count,
  (logs->>'total_duration_ms')::float / (logs->'counts'->>'total_rows')::float as avg_per_row
FROM mapping_dry_run_logs
ORDER BY duration_ms DESC
LIMIT 10;
```

---

## Implementation Checklist

- [ ] Generate seed SQL script (50+ analytes, 200-500 aliases)
- [ ] Add env vars to `.env.example`
- [ ] Install and configure Pino structured logger
- [ ] Create `server/services/MappingApplier.js`:
  - [ ] `normalizeLabel()` function
  - [ ] Tier A: Exact match query
  - [ ] Tier B: Fuzzy match with batching
  - [ ] Tier C: LLM stub (returns empty array)
  - [ ] Edge case handling
  - [ ] Pino logger integration
- [ ] Integrate into `server/routes/analyzeLabReport.js`
- [ ] Add unit tests for:
  - [ ] Label normalization (multilingual cases)
  - [ ] Exact match logic
  - [ ] Fuzzy match ambiguity detection
  - [ ] Edge cases (null labels, pg_trgm unavailable, etc.)
- [ ] Manual testing with real lab report PDF
- [ ] Verify logs are structured JSON (parseable)
- [ ] Performance testing (100 reports under 20s)

---

## Version History

- **v0.9** (Current): Dry-run mode with Tier A + B active, Tier C stub
- **v1.0** (Planned): LLM integration, auto-accept writes to DB
- **v1.1** (Future): Backfill job, review queue UI
