-- Migration 005: Add columns for mapping write mode (PRD v2.4)
-- Adds tracking columns for analyte mapping confidence, source, and timing

-- 1. Add columns to lab_results for mapping metadata
ALTER TABLE lab_results
ADD COLUMN IF NOT EXISTS mapping_confidence REAL,
ADD COLUMN IF NOT EXISTS mapped_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS mapping_source TEXT;

CREATE INDEX IF NOT EXISTS idx_lab_results_mapping_source
  ON lab_results (mapping_source);

CREATE INDEX IF NOT EXISTS idx_lab_results_analyte_id
  ON lab_results (analyte_id) WHERE analyte_id IS NOT NULL;

COMMENT ON COLUMN lab_results.mapping_confidence IS 'Confidence score (0-1) of the analyte mapping';
COMMENT ON COLUMN lab_results.mapped_at IS 'Timestamp when analyte_id was set';
COMMENT ON COLUMN lab_results.mapping_source IS 'Source of mapping: auto_exact, auto_fuzzy, auto_llm, manual_resolved, manual';

-- 2. Add columns to analyte_aliases for display forms
ALTER TABLE analyte_aliases
ADD COLUMN IF NOT EXISTS alias_display TEXT;

COMMENT ON COLUMN analyte_aliases.alias IS 'Normalized lowercase form for matching (e.g., "интерлейкин 6")';
COMMENT ON COLUMN analyte_aliases.alias_display IS 'Original display form with proper casing and punctuation';

-- 3. Add columns to pending_analytes for variations and approval tracking
ALTER TABLE pending_analytes
ADD COLUMN IF NOT EXISTS parameter_variations JSONB,
ADD COLUMN IF NOT EXISTS discarded_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS discarded_reason TEXT,
ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS approved_analyte_id INT REFERENCES analytes(analyte_id);

CREATE INDEX IF NOT EXISTS idx_pending_analytes_status
  ON pending_analytes (status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_analytes_proposed_code
  ON pending_analytes (proposed_code);

COMMENT ON COLUMN pending_analytes.parameter_variations IS 'Array of raw parameter name variations with language and occurrence count';
COMMENT ON COLUMN pending_analytes.discarded_reason IS 'Reason for discarding (prevents re-proposing)';

-- 4. Enhance match_reviews table for ambiguous matches
ALTER TABLE match_reviews
ADD COLUMN IF NOT EXISTS candidates JSONB,
ADD COLUMN IF NOT EXISTS suggested_analyte_id INT REFERENCES analytes(analyte_id);

CREATE INDEX IF NOT EXISTS idx_match_reviews_status
  ON match_reviews (status);

CREATE INDEX IF NOT EXISTS idx_match_reviews_result_id
  ON match_reviews (result_id);

COMMENT ON COLUMN match_reviews.candidates IS 'Array of candidate matches with similarity scores';

-- 5. Create admin audit log table
CREATE TABLE IF NOT EXISTS admin_actions (
  action_id BIGSERIAL PRIMARY KEY,
  action_type TEXT NOT NULL,  -- 'approve_analyte', 'discard_analyte', 'resolve_match', 'edit_alias', 'manual_map'
  entity_type TEXT,           -- 'pending_analyte', 'analyte', 'alias', 'lab_result'
  entity_id BIGINT,
  admin_user TEXT,            -- Future: link to users table
  changes JSONB,              -- Before/after state
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_actions_created_at
  ON admin_actions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_actions_action_type
  ON admin_actions (action_type);

COMMENT ON TABLE admin_actions IS 'Audit trail for all admin actions in the mapping write mode system';
