# PRD — Step 1: Schema Refactor for Canonical Analytes (Preparation Phase)

## 🎯 Goal
Modify the existing HealthUp PostgreSQL schema so it can store canonical analyte information in the future.  
The app must continue functioning *exactly* as it does now — uploading, parsing, and saving lab results — but the DB will now include the new canonical structure (`analytes`, `analyte_aliases`, etc.) and an optional reference from `lab_results`.

---

## 🧩 Scope
### In-Scope
- Add **new tables**:  
  - `analytes` — canonical dictionary of analytes.  
  - `analyte_aliases` — mapping of variant labels to analytes.  
  - `pending_analytes` — queue for new proposed analytes (for later use).  
  - `match_reviews` — queue for low-confidence matches (for later use).
- Add **new nullable column** `analyte_id` to `lab_results`.
- Add **required indexes** and **pg_trgm extension** to support fuzzy alias search.
- Keep all existing tables (`patients`, `patient_reports`, `lab_results`, `sql_generation_logs`) untouched in behavior.

### Out-of-Scope
- Any logic writing to these new tables.  
- Any UI or LLM integration.  
- Any data migration of existing rows.

---

## ⚙️ Functional Requirements

### 1️⃣ Create canonical analytes table
```sql
CREATE TABLE IF NOT EXISTS analytes (
  analyte_id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,           -- short key like FER, HDL
  name TEXT NOT NULL,                  -- canonical display name
  unit_canonical TEXT,                 -- preferred unit
  category TEXT,                       -- optional grouping
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 2️⃣ Create analyte_aliases table
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS analyte_aliases (
  analyte_id INT NOT NULL
    REFERENCES analytes(analyte_id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  lang TEXT,
  confidence REAL DEFAULT 1.0,
  source TEXT DEFAULT 'seed',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (analyte_id, alias)
);

CREATE INDEX IF NOT EXISTS idx_alias_lower ON analyte_aliases (LOWER(alias));
-- Only create the trigram index if pg_trgm was installed successfully (see Implementation Notes).
CREATE INDEX IF NOT EXISTS idx_alias_trgm ON analyte_aliases USING gin (alias gin_trgm_ops);
```

### 3️⃣ Add analyte_id to lab_results
```sql
ALTER TABLE lab_results
  ADD COLUMN IF NOT EXISTS analyte_id INT REFERENCES analytes(analyte_id);

CREATE INDEX IF NOT EXISTS idx_lab_results_analyte_id
  ON lab_results (analyte_id);
```
- Column must be **nullable** so existing inserts succeed.
- No change to existing queries or constraints.

### 4️⃣ Add future-use helper tables
**pending_analytes**
```sql
CREATE TABLE IF NOT EXISTS pending_analytes (
  pending_id BIGSERIAL PRIMARY KEY,
  proposed_code TEXT NOT NULL,
  proposed_name TEXT NOT NULL,
  unit_canonical TEXT,
  category TEXT,
  aliases JSONB,
  evidence JSONB,
  confidence REAL,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**match_reviews**
```sql
CREATE TABLE IF NOT EXISTS match_reviews (
  review_id BIGSERIAL PRIMARY KEY,
  result_id UUID NOT NULL REFERENCES lab_results(id) ON DELETE CASCADE,
  suggested_analyte_id INT REFERENCES analytes(analyte_id),
  suggested_code TEXT,    -- optional snapshot for UI/debug; analyte_id is source of truth
  confidence REAL,
  rationale TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 5️⃣ Optional view for future (no dependency)
```sql
CREATE OR REPLACE VIEW v_measurements AS
SELECT
  lr.id AS result_id,
  pr.patient_id,
  a.code AS analyte_code,
  a.name AS analyte_name,
  lr.numeric_result AS value_num,
  lr.result_value AS value_text,
  lr.unit AS units,
  COALESCE(pr.test_date_text::date, pr.recognized_at::date) AS date_eff,
  lr.report_id
FROM lab_results lr
JOIN patient_reports pr ON pr.id = lr.report_id
LEFT JOIN analytes a ON a.analyte_id = lr.analyte_id;
```

---

## 🧪 QA / Validation

| Test | Expected result |
|------|-----------------|
| Run `ensureSchema()` | All new tables created, no errors. |
| Upload + parse PDF | Works exactly as before. |
| Query `\d lab_results` | Column `analyte_id` exists (nullable). |
| Insert manual analyte + alias | Allowed; foreign key integrity enforced. |
| Drop + recreate schema | Idempotent (uses `IF NOT EXISTS`). |
| Simulate missing pg_trgm | With `REQUIRE_PG_TRGM` unset, logs warning but continues. |
| Verify trigram index skipped when pg_trgm unavailable | Warning emitted; `idx_alias_trgm` absent but other statements applied. |

---

## ✅ Acceptance Criteria
- [ ] Running `ensureSchema()` creates all new tables and indexes idempotently.  
- [ ] `lab_results` keeps its original behavior; all inserts still succeed.  
- [ ] Existing logic does not depend on new fields.  
- [ ] `pg_trgm` extension is installed.  
- [ ] `idx_lab_results_analyte_id` exists for future joins.  
- [ ] Schema is ready for later mapping logic.

---

## 🧱 Implementation Notes for Coding Agent
- Execute `CREATE EXTENSION IF NOT EXISTS pg_trgm;` before starting the transactional batch (or via a dedicated `await pool.query()`), wrap it in try/catch, and honor a `REQUIRE_PG_TRGM` flag: warn and continue on failure by default, but abort `ensureSchema()` when the flag is set. If the extension remains unavailable, skip creating the trigram index and log that downgrade.  
- Modify `/server/db/schema.js` to append these new SQL statements to `schemaStatements` **after** existing lab_results/index statements.  
- Ensure `pg_trgm` extension creation precedes tables using it.  
- Keep all statements idempotent (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`).  
- No migration scripts required — dropping the DB and running `ensureSchema()` should rebuild everything cleanly.

---

## ⚠️ Risks & Mitigation
| Risk | Mitigation |
|------|-------------|
| Extension creation fails (no superuser) | Catch error, log warning, continue if already installed. |
| Nullable FK may be misused later | Phase 2 will enforce stricter integrity. |
| Backward compatibility issues | None — existing inserts ignore new column. |

---

✅ **Summary**
> This PRD covers only schema preparation: add canonical analyte infrastructure and `analyte_id` field without changing any functional logic.  
> The app remains 100% operational with current features, but the DB is now ready for analyte mapping, review, and future querying layers.
