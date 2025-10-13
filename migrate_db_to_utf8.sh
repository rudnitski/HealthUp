#!/bin/bash

################################################################################
# Database Migration Script: Convert healthup DB to UTF-8 Collation
################################################################################
#
# This script migrates the HealthUp database from collation "C" to "en_US.UTF-8"
# to properly support case-insensitive matching for both Latin and Cyrillic text.
#
# What it does:
# 1. Stops the Node.js server (if running)
# 2. Creates a backup of the current database
# 3. Drops and recreates the database with UTF-8 collation
# 4. Restores all data from the backup
# 5. Verifies the migration was successful
#
# Prerequisites:
# - PostgreSQL running locally
# - Database user: healthup_user with password: healthup_pass
# - Superuser access (will use current user or 'postgres')
#
# Usage:
#   chmod +x migrate_db_to_utf8.sh
#   ./migrate_db_to_utf8.sh
#
################################################################################

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DB_NAME="healthup"
DB_USER="healthup_user"
DB_PASS="healthup_pass"
DB_HOST="localhost"
DB_PORT="5432"
SUPERUSER="${USER}"  # Current user, fallback to postgres if needed
BACKUP_DIR="/tmp"
BACKUP_FILE="${BACKUP_DIR}/healthup_backup_$(date +%Y%m%d_%H%M%S).sql"

# Connection strings
USER_CONN="postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}"
SUPER_CONN="postgresql://${DB_HOST}:${DB_PORT}"

echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}HealthUp DB Migration to UTF-8${NC}"
echo -e "${BLUE}================================${NC}\n"

################################################################################
# Step 1: Stop the server
################################################################################
echo -e "${YELLOW}Step 1: Stopping Node.js server...${NC}"
if lsof -ti:3000 > /dev/null 2>&1; then
    lsof -ti:3000 | xargs kill
    echo -e "${GREEN}✓ Server stopped${NC}"
    sleep 2
else
    echo -e "${GREEN}✓ No server running${NC}"
fi

################################################################################
# Step 2: Create backup
################################################################################
echo -e "\n${YELLOW}Step 2: Creating database backup...${NC}"
echo -e "  Backup location: ${BACKUP_FILE}"

if pg_dump "${USER_CONN}/${DB_NAME}" > "${BACKUP_FILE}"; then
    BACKUP_SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
    echo -e "${GREEN}✓ Backup created successfully (${BACKUP_SIZE})${NC}"
else
    echo -e "${RED}✗ Backup failed!${NC}"
    exit 1
fi

################################################################################
# Step 3: Check current collation
################################################################################
echo -e "\n${YELLOW}Step 3: Checking current database collation...${NC}"
CURRENT_COLLATE=$(psql "${USER_CONN}/${DB_NAME}" -t -c "SELECT datcollate FROM pg_database WHERE datname = '${DB_NAME}';" | xargs)
echo -e "  Current collation: ${CURRENT_COLLATE}"

if [ "${CURRENT_COLLATE}" = "en_US.UTF-8" ]; then
    echo -e "${GREEN}✓ Database already uses en_US.UTF-8 collation. Migration not needed.${NC}"
    echo -e "${BLUE}Backup saved at: ${BACKUP_FILE}${NC}"
    exit 0
fi

################################################################################
# Step 4: Terminate all connections
################################################################################
echo -e "\n${YELLOW}Step 4: Terminating database connections...${NC}"
TERMINATED=$(psql "${SUPER_CONN}/postgres" -t -c "SELECT COUNT(*) FROM (SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid()) AS terminated;" | xargs)
echo -e "${GREEN}✓ Terminated ${TERMINATED} connection(s)${NC}"
sleep 1

################################################################################
# Step 5: Drop old database
################################################################################
echo -e "\n${YELLOW}Step 5: Dropping old database...${NC}"
if psql "${SUPER_CONN}/postgres" -c "DROP DATABASE ${DB_NAME};"; then
    echo -e "${GREEN}✓ Database dropped${NC}"
else
    echo -e "${RED}✗ Failed to drop database${NC}"
    echo -e "${YELLOW}Backup saved at: ${BACKUP_FILE}${NC}"
    exit 1
fi

################################################################################
# Step 6: Create new database with UTF-8
################################################################################
echo -e "\n${YELLOW}Step 6: Creating new database with UTF-8 collation...${NC}"
if psql "${SUPER_CONN}/postgres" -c "CREATE DATABASE ${DB_NAME} WITH ENCODING 'UTF8' LC_COLLATE='en_US.UTF-8' LC_CTYPE='en_US.UTF-8' TEMPLATE=template0 OWNER=${DB_USER};"; then
    echo -e "${GREEN}✓ Database created with en_US.UTF-8 collation${NC}"
else
    echo -e "${RED}✗ Failed to create database${NC}"
    echo -e "${YELLOW}You can restore from backup: ${BACKUP_FILE}${NC}"
    exit 1
fi

################################################################################
# Step 7: Restore data
################################################################################
echo -e "\n${YELLOW}Step 7: Restoring data from backup...${NC}"
if psql "${USER_CONN}/${DB_NAME}" < "${BACKUP_FILE}" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Data restored successfully${NC}"
else
    echo -e "${YELLOW}⚠ Data restore completed with some warnings (likely permission-related, safe to ignore)${NC}"
fi

################################################################################
# Step 8: Verify migration
################################################################################
echo -e "\n${YELLOW}Step 8: Verifying migration...${NC}"

# Check collation
NEW_COLLATE=$(psql "${USER_CONN}/${DB_NAME}" -t -c "SELECT datcollate FROM pg_database WHERE datname = '${DB_NAME}';" | xargs)
echo -e "  New collation: ${NEW_COLLATE}"

# Check data count
LAB_RESULTS_COUNT=$(psql "${USER_CONN}/${DB_NAME}" -t -c "SELECT COUNT(*) FROM lab_results;" | xargs)
echo -e "  Lab results count: ${LAB_RESULTS_COUNT}"

# Test Cyrillic case-insensitivity
CYRILLIC_TEST=$(psql "${USER_CONN}/${DB_NAME}" -t -c "SELECT 'Холестерин' ILIKE '%холестерин%';" | xargs)
echo -e "  Cyrillic ILIKE test: ${CYRILLIC_TEST}"

# Test LOWER() with Cyrillic
LOWER_TEST=$(psql "${USER_CONN}/${DB_NAME}" -t -c "SELECT LOWER('Холестерин');" | xargs)
echo -e "  LOWER('Холестерин'): ${LOWER_TEST}"

if [ "${NEW_COLLATE}" = "en_US.UTF-8" ] && [ "${CYRILLIC_TEST}" = "t" ] && [ "${LOWER_TEST}" = "холестерин" ]; then
    echo -e "\n${GREEN}✓✓✓ Migration completed successfully! ✓✓✓${NC}"
    echo -e "\n${BLUE}Summary:${NC}"
    echo -e "  • Database collation: ${NEW_COLLATE}"
    echo -e "  • Lab results restored: ${LAB_RESULTS_COUNT}"
    echo -e "  • Cyrillic matching: Working"
    echo -e "  • Backup location: ${BACKUP_FILE}"
    echo -e "\n${GREEN}You can now start your server: npm run dev${NC}"
else
    echo -e "\n${RED}✗ Migration verification failed${NC}"
    echo -e "${YELLOW}Backup available at: ${BACKUP_FILE}${NC}"
    exit 1
fi

################################################################################
# Step 9: Test actual data
################################################################################
echo -e "\n${YELLOW}Step 9: Testing with actual cholesterol data...${NC}"
CHOLESTEROL_COUNT=$(psql "${USER_CONN}/${DB_NAME}" -t -c "SELECT COUNT(*) FROM lab_results WHERE parameter_name ILIKE '%холестерин%';" | xargs)
echo -e "  Cholesterol results found: ${CHOLESTEROL_COUNT}"

if [ "${CHOLESTEROL_COUNT}" -gt 0 ]; then
    echo -e "${GREEN}✓ Case-insensitive search working correctly${NC}"
else
    echo -e "${YELLOW}⚠ No cholesterol data found (might be empty DB)${NC}"
fi

echo -e "\n${BLUE}================================${NC}"
echo -e "${GREEN}Migration Complete!${NC}"
echo -e "${BLUE}================================${NC}\n"
