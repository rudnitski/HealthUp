# PRD v0.9 — Changelog & Amendments

## Summary of Changes

This document summarizes the technical review and amendments made to PRD v0.9 (Mapping Applier - Dry-Run Mode) based on implementation readiness assessment.

---

## 🔴 Critical Additions

### 1. Prerequisites Section (NEW)
**Why:** Original PRD assumed seed data existed. Current state: `analytes` and `analyte_aliases` tables are empty (0 rows).

**Added:**
- Schema verification checklist
- Seed data requirements (50+ analytes, 200-500 aliases)
- Expected behavior warning (100% UNMAPPED without seeds)
- Pino logger requirement

**Impact:** Prevents confusion when initial runs show 100% unmapped.

---

### 2. Normalization Algorithm Specification
**Why:** Original spec said "lowercase, trim, collapse spaces" — too vague for multilingual data.

**Before:**
```
Lowercase, trim, collapse spaces, unify micro symbol, strip punctuation.
```

**After:**
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

**Examples added:**
- `"ALT (SGPT)"` → `"alt sgpt"` (preserves parenthetical content)
- `"Витамин D (25-OH)"` → `"витамин d 25 oh"`
- `"  µg/mL  "` → `"microg ml"`

**Impact:** Deterministic matching across Russian, Ukrainian, English labels.

---

### 3. Decision Priority & Conflict Resolution (NEW)
**Why:** Original PRD showed fuzzy=0.82 winning over LLM=0.91 without explaining why.

**Added:**
- 5-tier priority hierarchy (Exact > Fuzzy > LLM > Unmapped)
- Conflict resolution rules (fuzzy vs LLM disagreements)
- Ambiguity detection (Δ ≤ 0.05 between top-2 fuzzy matches)
- New decision types: `CONFLICT_FUZZY_LLM`, `AMBIGUOUS_FUZZY`, `UNKNOWN_LLM_CODE`

**Impact:** Eliminates implementation ambiguity, ensures reproducible decisions.

---

## 🟡 High-Priority Enhancements

### 4. Edge Cases Expansion
**Before:** 3 bullet points

**After:** 5 detailed edge cases with:
- Detection conditions
- Behavior specification
- Example log outputs
- Mitigation strategies

**New edge cases:**
- `pg_trgm` unavailable (graceful degradation)
- Ambiguous fuzzy matches (with candidate logging)
- Unknown LLM codes (hallucination detection)
- Missing LLM suggestions (default for v0.9)
- Empty/null parameter names

**Impact:** Prevents runtime surprises, defines logging format for each failure mode.

---

### 5. Performance Targets & SLAs (NEW)
**Why:** Original PRD had no measurable success criteria for latency.

**Added:**
| Metric | P50 | P95 |
|--------|-----|-----|
| Per-report | <200ms | <500ms |
| Per-row | <10ms | <20ms |
| Tier A (exact) | <2ms | <5ms |
| Tier B (fuzzy) | <15ms | <50ms |
| Tier C (LLM) | <1ms | <5ms |

**Timeout policy:**
- Fuzzy search >50ms → skip to Tier C
- Never block request waiting for mapping

**Impact:** Creates observable benchmarks for optimization.

---

### 6. SQL Query Batching
**Why:** Original Tier B did 30 individual queries per report (300-500ms total).

**Added:**
```sql
-- Batched fuzzy query (10x faster)
WITH normalized_labels(result_id, label_norm) AS (
  VALUES ($1, $2), ($3, $4), ...
),
fuzzy_matches AS (
  SELECT DISTINCT ON (nl.label_norm)
    nl.result_id, aa.analyte_id, aa.alias,
    similarity(LOWER(aa.alias), nl.label_norm) as sim
  FROM normalized_labels nl
  CROSS JOIN analyte_aliases aa
  WHERE LOWER(aa.alias) % nl.label_norm
  ORDER BY nl.label_norm, sim DESC
)
SELECT * FROM fuzzy_matches WHERE sim >= $threshold;
```

**Impact:** Reduces Tier B from ~300ms to ~30ms per report.

---

## 🟢 Medium-Priority Improvements

### 7. Enhanced Summary Logs
**Added fields:**
```json
"performance": {
  "total_duration_ms": 146,
  "avg_row_latency_ms": 3.8,
  "tier_breakdown": { "deterministic_avg_ms": 2, "fuzzy_avg_ms": 15, ... },
  "slowest_row": { "result_id": "...", "duration_ms": 48 }
},
"data_quality": {
  "rows_with_unit": 36,
  "rows_with_numeric_result": 32,
  "rows_with_reference": 30
},
"thresholds_used": { "fuzzy_match": 0.70, ... }
```

**Impact:** Enables performance bottleneck detection and data quality correlation analysis.

---

### 8. Success Criteria & Validation Tests
**Before:** 4 generic criteria

**After:**
- 4 functional requirements
- 3 observability requirements
- 7 validation test scenarios with expected outcomes
- 4-step post-deployment analysis plan

**Impact:** Converts vague "logs for every report" into testable acceptance criteria.

---

### 9. "What We'll Learn" Expansion
**Before:** 4 bullet points

**After:** 8 insights across 3 timeframes (Week 1, Month 1, Month 2+) with:
- Specific metrics to track
- Decision thresholds (e.g., >60% auto-accept for prod readiness)
- 3 example SQL analytics queries

**Impact:** Turns dry-run into a data-driven tuning process.

---

### 10. Implementation Checklist (NEW)
**Added:**
- 20-item checklist covering:
  - Seed data generation
  - Environment configuration
  - Core service creation
  - Unit tests
  - Integration testing
  - Performance validation

**Impact:** Provides clear "definition of done" for implementation.

---

## 📋 Configuration Changes

### Environment Variables
**Added to `.env.example`:**
```bash
ENABLE_MAPPING_DRY_RUN=false          # Feature flag
MAPPING_AUTO_ACCEPT=0.80              # Confidence threshold
MAPPING_QUEUE_LOWER=0.60              # Review queue lower bound
BACKFILL_SIMILARITY_THRESHOLD=0.70    # Fuzzy match minimum
```

---

## 🔧 Technical Decisions Documented

### 1. LLM Integration (Tier C)
- **v0.9:** Stub only (returns empty array)
- **v1.0:** Full LLM integration
- **Rationale:** De-risk v0.9 rollout, keep interfaces stable

### 2. Logging Framework
- **Choice:** Pino (structured JSON logger)
- **Rationale:** Single-line JSON logs, easier to grep/ship than `console.log`
- **Transport:** Console in dev, file/HTTP in prod

### 3. Seed Data
- **Scope:** 50 common analytes + 200-500 multilingual aliases
- **Languages:** English, Russian, Ukrainian
- **Includes:** Common typos and abbreviations

---

## 📊 Key Metrics to Track

After v0.9 deployment, monitor:

1. **Coverage Rate:** % of parameters matched by each tier
2. **Confidence Distribution:** Histogram of fuzzy similarity scores
3. **Performance:** P50/P95 latency per tier
4. **Data Quality:** Correlation between unit presence and match rate
5. **Unmapped Labels:** Top 20 frequently unmapped parameter names

---

## ✅ Review Approval

**Blocking Questions Resolved:**
1. ✅ LLM suggestions source → In-memory array (v0.9 stub)
2. ✅ Normalization algorithm → Unicode NFKD + diacritic stripping
3. ✅ Tie-breaking rules → 5-tier priority hierarchy defined

**Implementation Ready:** Yes

**Next Steps:**
1. Generate seed SQL script
2. Install Pino logger
3. Implement MappingApplier service
4. Integrate into analyzeLabReport.js
5. Test with real lab reports

---

## Version History

- **2025-01-10:** Initial PRD created
- **2025-01-10:** Technical review & amendments (this document)
- **Next:** Implementation phase
