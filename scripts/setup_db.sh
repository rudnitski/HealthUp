#!/bin/bash
# setup_db.sh
# Creates the HealthUp database with proper UTF-8 locale for multilingual support
# Run this script for fresh installations on new machines

set -e

echo "=================================================="
echo "HealthUp Database Setup"
echo "=================================================="
echo ""
echo "This script will create a new 'healthup' database"
echo "with en_US.UTF-8 locale for multilingual support."
echo ""
echo "IMPORTANT: UTF-8 locale is REQUIRED for:"
echo "  - Cyrillic/Hebrew text support in LOWER()/UPPER()"
echo "  - pg_trgm fuzzy search for Russian analyte names"
echo "  - Agentic SQL search tools"
echo ""
echo "If the database already exists, it will be dropped!"
echo ""

# Database connection parameters (can be overridden by env vars)
DB_USER="${DB_USER:-healthup_user}"
DB_PASS="${DB_PASS:-healthup_pass}"
DB_NAME="${DB_NAME:-healthup}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
SUPERUSER="${SUPERUSER:-postgres}"

# Detect available UTF-8 locale
echo "Detecting available UTF-8 locales..."
if locale -a 2>/dev/null | grep -q "en_US.utf8"; then
  LOCALE="en_US.UTF-8"
elif locale -a 2>/dev/null | grep -q "en_US.UTF-8"; then
  LOCALE="en_US.UTF-8"
elif locale -a 2>/dev/null | grep -q "C.UTF-8"; then
  LOCALE="C.UTF-8"
else
  echo "⚠️  WARNING: Could not find a UTF-8 locale on this system."
  echo "   Attempting to use en_US.UTF-8 anyway..."
  LOCALE="en_US.UTF-8"
fi

echo "Using locale: $LOCALE"
echo ""

read -p "Continue with database setup? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
  echo "Setup cancelled."
  exit 0
fi

export PGPASSWORD="$DB_PASS"

echo ""
echo "Step 1: Creating database user (if not exists)..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$SUPERUSER" -d postgres -c "
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$DB_USER') THEN
      CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';
      RAISE NOTICE 'User $DB_USER created';
    ELSE
      RAISE NOTICE 'User $DB_USER already exists';
    END IF;
  END
  \$\$;
" || {
  echo "❌ Failed to create user. You may need to run this script with a PostgreSQL superuser."
  echo "   Try: SUPERUSER=postgres ./setup_db.sh"
  exit 1
}

echo "✓ User ready"

echo ""
echo "Step 2: Dropping old database (if exists)..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$SUPERUSER" -d postgres -c "DROP DATABASE IF EXISTS $DB_NAME;" 2>/dev/null || true
echo "✓ Old database dropped (if existed)"

echo ""
echo "Step 3: Creating new database with UTF-8 locale..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$SUPERUSER" -d postgres -c "
  CREATE DATABASE $DB_NAME
  WITH OWNER = $DB_USER
  ENCODING = 'UTF8'
  LC_COLLATE = '$LOCALE'
  LC_CTYPE = '$LOCALE'
  TEMPLATE = template0;
"
echo "✓ Database created with UTF-8 locale"

echo ""
echo "Step 4: Enabling pg_trgm extension..."
export PGPASSWORD="$DB_PASS"
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
echo "✓ pg_trgm extension enabled"

echo ""
echo "Step 5: Verifying locale settings..."
VERIFY_RESULT=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "
  SELECT datcollate, datctype
  FROM pg_database
  WHERE datname = '$DB_NAME';
")
echo "Database locale: $VERIFY_RESULT"

echo ""
echo "Step 6: Testing pg_trgm with Cyrillic text..."
TRIGRAM_TEST=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "
  SELECT array_length(show_trgm('холестерин'), 1);
")

if [ "$TRIGRAM_TEST" -gt 0 ]; then
  echo "✓ pg_trgm is working correctly with Cyrillic text"
  echo "  Generated $TRIGRAM_TEST trigrams for 'холестерин'"
else
  echo "❌ WARNING: pg_trgm not generating trigrams for Cyrillic text"
  echo "  This indicates a locale configuration issue"
  echo "  Check that locale '$LOCALE' is properly installed on your system"
fi

echo ""
echo "Step 7: Testing LOWER() with Cyrillic text..."
LOWER_TEST=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "
  SELECT LOWER('АБВГД') = 'абвгд' AS works;
")

if echo "$LOWER_TEST" | grep -q "t"; then
  echo "✓ LOWER() is working correctly with Cyrillic text"
else
  echo "❌ WARNING: LOWER() not working with Cyrillic text"
  echo "  This indicates a locale configuration issue"
fi

echo ""
echo "=================================================="
echo "Database Setup Complete!"
echo "=================================================="
echo ""
echo "Connection details:"
echo "  Host: $DB_HOST:$DB_PORT"
echo "  Database: $DB_NAME"
echo "  User: $DB_USER"
echo "  Locale: $LOCALE"
echo ""
echo "Update your .env file with:"
echo "  DATABASE_URL=postgres://$DB_USER:$DB_PASS@$DB_HOST:$DB_PORT/$DB_NAME"
echo ""
echo "Next steps:"
echo "  1. npm install"
echo "  2. npm run dev (this will create tables automatically)"
echo "  3. psql -U $DB_USER -d $DB_NAME -f server/db/seed_analytes.sql (optional)"
echo ""

unset PGPASSWORD
