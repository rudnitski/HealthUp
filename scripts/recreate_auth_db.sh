#!/bin/bash
# scripts/recreate_auth_db.sh
# Dev environment only - NOT for production use
#
# Note: This script uses hardcoded dev passwords:
#   healthup_owner: owner_dev_password
#   healthup_app: app_dev_password
#   healthup_admin: admin_dev_password
# Update your .env file to match these credentials after running this script.

set -e

echo "Dropping and recreating database with auth schema..."

# Terminate all connections to the database before dropping
psql -h localhost -U yuryrudnitski <<'SQL'
SELECT pg_terminate_backend(pg_stat_activity.pid)
FROM pg_stat_activity
WHERE pg_stat_activity.datname = 'healthup'
  AND pid <> pg_backend_pid();
SQL

# Drop database (connections now terminated)
psql -h localhost -U yuryrudnitski -c "DROP DATABASE IF EXISTS healthup;"

# Create roles (must happen before database creation to set owner)
# Note: CREATE ROLE does NOT support IF NOT EXISTS, use DO block with exception handling
psql -h localhost -U yuryrudnitski <<'SQL'
DO $$
BEGIN
  CREATE ROLE healthup_owner WITH LOGIN PASSWORD 'owner_dev_password';
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'Role healthup_owner already exists, skipping.';
END $$;

-- Ensure password is current even if role existed
ALTER ROLE healthup_owner WITH PASSWORD 'owner_dev_password';

DO $$
BEGIN
  CREATE ROLE healthup_app WITH LOGIN PASSWORD 'app_dev_password';
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'Role healthup_app already exists, skipping.';
END $$;

ALTER ROLE healthup_app WITH PASSWORD 'app_dev_password';

DO $$
BEGIN
  CREATE ROLE healthup_admin WITH LOGIN PASSWORD 'admin_dev_password' BYPASSRLS;
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'Role healthup_admin already exists, skipping.';
END $$;

ALTER ROLE healthup_admin WITH PASSWORD 'admin_dev_password';
SQL

# Create database owned by healthup_owner (CRITICAL for default privileges)
psql -h localhost -U yuryrudnitski -c "
  CREATE DATABASE healthup
  OWNER healthup_owner
  ENCODING 'UTF8'
  LC_COLLATE 'en_US.UTF-8'
  LC_CTYPE 'en_US.UTF-8'
  TEMPLATE template0;
"

# Create required extensions (must run as superuser BEFORE app connects)
# Note: pg_trgm, pgcrypto, and citext are "trusted" extensions on PostgreSQL 13+
# but explicit creation as superuser ensures compatibility with all environments
psql -h localhost -U yuryrudnitski -d healthup <<SQL
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
SQL

# Grant permissions (must connect to database as superuser first)
psql -h localhost -U yuryrudnitski -d healthup <<SQL
-- Grant permissions to app user (NOT table ownership)
GRANT USAGE ON SCHEMA public TO healthup_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO healthup_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO healthup_app;

-- Grant same to admin user
GRANT USAGE ON SCHEMA public TO healthup_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO healthup_admin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO healthup_admin;

-- Ensure future tables created by healthup_owner also get permissions
ALTER DEFAULT PRIVILEGES FOR USER healthup_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO healthup_app;
ALTER DEFAULT PRIVILEGES FOR USER healthup_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO healthup_admin;
ALTER DEFAULT PRIVILEGES FOR USER healthup_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO healthup_app;
ALTER DEFAULT PRIVILEGES FOR USER healthup_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO healthup_admin;
SQL

echo "Done. Update DATABASE_URL to use healthup_owner credentials, then run 'npm run dev' to apply schema."
