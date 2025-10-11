# Mapping Applier Setup Guide (PRD v0.9)

This guide walks you through setting up and using the Mapping Applier dry-run mode.

## Prerequisites

✅ All prerequisites from PRD v0.9 are implemented:

- Schema ready (analytes, analyte_aliases, lab_results with analyte_id column)
- pg_trgm extension support (graceful fallback if unavailable)
- Pino structured logger configured
- Environment variables added

## Setup Steps

### 1. Install Dependencies

Dependencies are already installed:
- `pino` - Structured JSON logging
- `pino-pretty` - Pretty formatter for development

### 2. Run Seed Data

The seed script contains:
- **58 canonical analytes** across multiple categories (hematology, liver, kidney, lipids, etc.)
- **350+ multilingual aliases** (English, Russian, Ukrainian)
- Common typos and abbreviations

To load the seed data:

```bash
psql $DATABASE_URL -f server/db/seed_analytes.sql
```

Expected output:
```
============================================
Seed Data Summary
============================================
Total Analytes: 58
Total Aliases: 350+
Average Aliases per Analyte: 6.0
============================================
```

### 3. Configure Environment Variables

Update your `.env` file:

```bash
# Enable dry-run mode
ENABLE_MAPPING_DRY_RUN=true

# Thresholds (defaults shown)
MAPPING_AUTO_ACCEPT=0.80              # Confidence threshold for auto-accept
MAPPING_QUEUE_LOWER=0.60              # Lower bound for review queue
BACKFILL_SIMILARITY_THRESHOLD=0.70    # Minimum fuzzy similarity to accept

# Optional: Enable pretty logging in development
NODE_ENV=development
LOG_LEVEL=info
```

### 4. Verify pg_trgm Extension

Check if pg_trgm is installed:

```sql
SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_trgm') AS enabled;
```

If not installed, try:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

**Note:** The Mapping Applier gracefully handles missing pg_trgm by skipping Tier B (fuzzy matching).

## Usage

### Running Dry-Run Mode

Once `ENABLE_MAPPING_DRY_RUN=true` is set, the Mapping Applier automatically runs after each lab report is processed.

Upload a lab report via the API:

```bash
curl -X POST http://localhost:3000/api/analyze \
  -F "analysisFile=@path/to/lab_report.pdf"
```

### Understanding the Logs

#### Per-Row Log (`mapping.row`)

Each lab result row generates a structured log:

```json
{
  "event": "mapping.row",
  "report_id": "uuid",
  "result_id": "uuid",
  "label_raw": "Феретинн",
  "label_norm": "феретинн",
  "unit": "нг/мл",
  "numeric_result": 42.1,
  "tiers": {
    "deterministic": { "matched": false },
    "fuzzy": {
      "matched": true,
      "alias": "ферритин",
      "analyte_id": 12,
      "similarity": 0.82
    }
  },
  "final_decision": "MATCH_FUZZY",
  "final_analyte": {
    "analyte_id": 12,
    "code": "FER",
    "name": "Ferritin",
    "source": "fuzzy"
  },
  "confidence": 0.82,
  "duration_ms": 12
}
```

#### Summary Log (`mapping.summary`)

One summary per report:

```json
{
  "event": "mapping.summary",
  "report_id": "uuid",
  "counts": {
    "total_rows": 38,
    "deterministic_matches": 9,
    "fuzzy_matches": 17,
    "unmapped": 12
  },
  "estimated_auto_accept": 21,
  "estimated_queue": 5,
  "performance": {
    "total_duration_ms": 146,
    "avg_row_latency_ms": 3.8
  },
  "data_quality": {
    "rows_with_unit": 36,
    "rows_with_numeric_result": 32
  }
}
```

### Decision Types

| Decision | Meaning |
|----------|---------|
| `MATCH_EXACT` | Tier A: Exact alias match (confidence = 1.0) |
| `MATCH_FUZZY` | Tier B: Fuzzy match above threshold |
| `AMBIGUOUS_FUZZY` | Multiple fuzzy matches too close to distinguish |
| `UNMAPPED` | No matches found in any tier |

## Expected Initial Behavior

### Without Seed Data
- **100% `UNMAPPED`** on first runs (normal)
- All tiers will report `matched: false`

### With Seed Data (58 analytes, 350+ aliases)
- **Target: 50-70% coverage** on typical lab reports
- English reports: Higher exact match rate
- Russian/Ukrainian reports: More fuzzy matches
- Use logs to identify which aliases to add next

## Analyzing Results

### Find Top Unmapped Labels

After processing several reports, analyze which labels need aliases:

```sql
-- Extract unmapped labels from logs (if stored in DB)
-- Or parse JSON logs from file/stdout
```

### Measure Fuzzy Threshold Accuracy

Check similarity distribution:

```bash
# Parse logs and group by similarity bucket
cat logs.json | grep "MATCH_FUZZY" | jq '.confidence' | sort -n
```

### Performance Check

Verify latency targets:

```bash
# Extract avg_row_latency_ms from summary logs
cat logs.json | grep "mapping.summary" | jq '.performance.avg_row_latency_ms'
```

**Targets (PRD v0.9):**
- Per-report total: <200ms (P50), <500ms (P95) for ~30 parameters
- Per-row processing: <10ms avg, <20ms (P95)

## Troubleshooting

### No Logs Appearing

Check:
1. `ENABLE_MAPPING_DRY_RUN=true` in `.env`
2. `LOG_LEVEL=info` (or `debug` for more detail)
3. Restart server after changing `.env`

### All Rows Show `UNMAPPED`

Likely causes:
1. Seed data not loaded → Run `seed_analytes.sql`
2. Database connection issue
3. Parameter names don't match any aliases → Expected behavior, add aliases

### Fuzzy Matching Disabled

Check logs for:
```json
{
  "tiers": {
    "fuzzy": {
      "skipped": true,
      "reason": "pg_trgm unavailable"
    }
  }
}
```

**Solution:** Install pg_trgm extension or set `REQUIRE_PG_TRGM=false` to suppress warnings.

### Poor Match Quality

If fuzzy matches seem incorrect:
1. Adjust `BACKFILL_SIMILARITY_THRESHOLD` (try 0.75 or 0.80)
2. Add more exact aliases for common variations
3. Review ambiguous matches and add clarifying aliases

## Next Steps (v1.0+)

Future enhancements:
1. **LLM Integration (Tier C)**: Propose new analytes for unmapped labels
2. **Auto-Accept Writes**: Commit mappings with confidence ≥ 0.80
3. **Review Queue UI**: Human review for ambiguous matches
4. **Backfill Job**: Apply mappings to historical reports

## Files Modified/Created

### New Files
- `server/services/MappingApplier.js` - Main service
- `server/db/seed_analytes.sql` - Seed data (58 analytes, 350+ aliases)
- `server/services/__tests__/MappingApplier.test.js` - Unit tests
- `docs/MAPPING_SETUP.md` - This file

### Modified Files
- `.env.example` - Added mapping configuration
- `package.json` - Added pino dependencies
- `server/routes/analyzeLabReport.js` - Integrated dry-run hook

## Support

For issues or questions:
1. Check PRD v0.9 for detailed algorithm and edge cases
2. Review structured logs for specific failures
3. Verify seed data was loaded correctly
