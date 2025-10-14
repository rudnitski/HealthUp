-- Migration: Add trigram index for fuzzy search on lab_results.parameter_name
-- Purpose: Enable fast similarity searches for agentic SQL generation
-- PRD: docs/PRD_v2_0_agentic_sql_generation_mvp.md
-- Date: 2025-01-13

-- Verify pg_trgm extension is installed
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create GIN index for trigram similarity on parameter_name
-- CONCURRENTLY allows this to run without locking the table (safe for production)
-- IF NOT EXISTS prevents errors if index already exists
CREATE INDEX CONCURRENTLY IF NOT EXISTS lab_results_parameter_name_trgm_idx
ON lab_results USING gin (parameter_name gin_trgm_ops);

-- Fix sql_generation_logs table: add UUID default if not already set
-- This ensures INSERT statements without explicit id work correctly
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attrdef
    WHERE adrelid = 'sql_generation_logs'::regclass
    AND adnum = (SELECT attnum FROM pg_attribute WHERE attrelid = 'sql_generation_logs'::regclass AND attname = 'id')
  ) THEN
    ALTER TABLE sql_generation_logs ALTER COLUMN id SET DEFAULT gen_random_uuid();
    RAISE NOTICE 'Added UUID default to sql_generation_logs.id';
  END IF;
END $$;

-- Optional: Set similarity threshold (0.3 is default, lower = more matches)
-- This is session-level, so you may want to set it per-query or globally
-- SET pg_trgm.similarity_threshold = 0.3;

-- Verify index was created
\echo 'Verifying index creation...'
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'lab_results'
  AND indexname = 'lab_results_parameter_name_trgm_idx';

-- Test fuzzy search performance
\echo 'Testing fuzzy search...'
EXPLAIN ANALYZE
SELECT DISTINCT parameter_name, similarity(parameter_name, 'витамин д') as score
FROM lab_results
WHERE parameter_name % 'витамин д'
ORDER BY score DESC
LIMIT 20;

\echo 'Migration complete! ✅'
