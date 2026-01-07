# AGENTS.md

Guidance for AI coding agents working in the HealthUp repository.

## Build/Test Commands

```bash
# Development
npm run dev              # Start server (auto-applies schema on boot)
npm run dev:clean        # Kill existing server on port 3000, then start fresh

# Testing
npm test                 # Run all Jest tests
npm test -- --testPathPattern="schema"           # Run single test file by name
npm test -- --testNamePattern="users table"      # Run tests matching name pattern
npm test -- test/db/schema.test.js               # Run specific test file

# Manual testing
node test/manual/test_agentic_sql.js             # Agentic SQL regression
node test/manual/test_job_terminal_state_guard.js # Job manager race conditions

# Utilities
node scripts/verify_mapping_setup.js    # Verify analyte mapping tables
node scripts/backfill_analyte_mappings.js # Backfill mappings for existing data
./scripts/setup_db.sh                   # Database setup with UTF-8 locale
```

## Code Style Guidelines

### Module System (ESM)

The project uses ES Modules exclusively. Key requirements:

```javascript
// All relative imports MUST include .js extension
import { query } from './db/index.js';       // Correct
import { query } from './db';                // WRONG - will fail

// Use import.meta.url for path resolution
import { getDirname } from './utils/path-helpers.js';
const __dirname = getDirname(import.meta.url);

// JSON files: use fs.readFileSync + JSON.parse (not import)
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
```

### Import Organization

Order imports consistently:
1. Node.js built-ins (`crypto`, `fs`, `path`)
2. External packages (`express`, `pg`, `openai`)
3. Internal modules (relative paths)

```javascript
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import express from 'express';
import { Pool } from 'pg';
import { pool, queryAsAdmin } from '../db/index.js';
import logger from '../utils/logger.js';
```

### Naming Conventions

- **Files**: `camelCase.js` for services/utils, `kebab-case.js` for config
- **Functions**: `camelCase` - verbs for actions (`createJob`, `fetchPatients`)
- **Classes**: `PascalCase` (`VisionProvider`, `StreamingClassifier`)
- **Constants**: `SCREAMING_SNAKE_CASE` for true constants
- **Database columns**: `snake_case` (`created_at`, `patient_id`)

### Error Handling

Use structured logging with pino, try-catch at route boundaries:

```javascript
router.get('/endpoint', async (req, res) => {
  try {
    const result = await someOperation();
    res.json({ data: result });
  } catch (error) {
    logger.error({ error: error.message }, 'Operation failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

For complex debugging, use `console.log()` with `JSON.stringify(obj, null, 2)` - pino doesn't display nested objects well.

### Async Patterns

Long-running operations use the job pattern to avoid timeouts:

```javascript
// 1. Return 202 Accepted with job_id immediately
const jobId = createJob(userId, { filename });
res.status(202).json({ jobId });

// 2. Process in background
setImmediate(async () => {
  try {
    updateJob(jobId, JobStatus.PROCESSING);
    const result = await processFile(file);
    updateJob(jobId, JobStatus.COMPLETED, { result });
  } catch (error) {
    updateJob(jobId, JobStatus.FAILED, { error: error.message });
  }
});

// 3. Client polls GET /jobs/:jobId
```

### Route Organization

Express route order matters - specific routes BEFORE parameterized:

```javascript
// CORRECT
router.get('/jobs/summary', ...);  // Specific first
router.get('/jobs/:jobId', ...);   // Generic second

// WRONG - '/jobs/summary' never reached
router.get('/jobs/:jobId', ...);   // Catches 'summary' as jobId
router.get('/jobs/summary', ...);
```

### Database Queries

Use RLS-aware query functions:

```javascript
// Standard queries (respects RLS)
import { query, queryWithUser } from '../db/index.js';
const result = await queryWithUser(userId, 'SELECT * FROM patients');

// Admin operations (bypasses RLS)
import { queryAsAdmin, adminPool } from '../db/index.js';
await queryAsAdmin('INSERT INTO admin_actions ...', [...]);
```

### Function Documentation

Use JSDoc for public APIs:

```javascript
/**
 * Build system prompt with schema context
 * @param {string} schemaContext - Schema snapshot as markdown
 * @param {number} maxIterations - Max agentic loop iterations
 * @param {string} mode - 'chat' or 'legacy'
 * @returns {Promise<{prompt: string, patientCount: number}>}
 */
async function buildSystemPrompt(schemaContext, maxIterations, mode = 'legacy') {
```

## Critical Gotchas

1. **Database locale**: PostgreSQL MUST use UTF-8 (`en_US.UTF-8`), not C locale. C locale breaks `LOWER()`/`UPPER()` for Cyrillic, `pg_trgm` fuzzy search, and agentic SQL tools.

2. **ESM extensions**: All relative imports require `.js` extension or module resolution fails.

3. **Background processes**: Old `npm run dev` processes keep stale env vars. Use `npm run dev:clean` or `lsof -ti:3000 | xargs kill -9`.

4. **Job terminal states**: Never overwrite FAILED/COMPLETED status with PENDING/PROCESSING - guards prevent race conditions.

5. **Environment files**: When modifying `.env`, also update `.env.example`.

6. **OpenAI models**: Trust user-configured model names. Don't assume models don't exist.

7. **Gmail tokens**: Never commit `gmail-token.json`. Auto-refresh preserves `refresh_token`.

## Key Architecture

```
Upload → Async Job → Vision OCR → Persistence → Auto-mapping → SQL Generation → Plotting
```

- **labReportProcessor.js**: OCR pipeline with PDF→PNG conversion
- **MappingApplier.js**: Tiered analyte mapping (exact → fuzzy → LLM)
- **agenticCore.js**: Tool-calling SQL generation loop
- **chatStream.js**: SSE endpoint for conversational SQL assistant
- **jobManager.js**: In-memory job tracking with 1-hour TTL

## Testing

Tests use Jest with ESM support. Test files live in:
- `test/**/*.test.js` - Integration tests
- `server/**/__tests__/*.test.js` - Unit tests co-located with source

```javascript
// Test structure
describe('Feature', () => {
  afterAll(async () => {
    await pool.end();  // Clean up DB connections
  });

  test('specific behavior', async () => {
    const result = await operation();
    expect(result).toMatchObject({ expected: 'shape' });
  });
});
```
