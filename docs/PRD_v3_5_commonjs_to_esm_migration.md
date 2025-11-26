# PRD v3.5 — CommonJS to ESM Migration

**Status:** Ready for Implementation
**Target:** Infrastructure/Modernization
**Effort Estimate:** 3-5 days (senior SE)
**Dependencies:** Requires `madge` npm package for circular dependency verification (Step 1)
**Node.js Version:** 20.10+ (for JSON import attributes support; 22+ recommended)

---

## Overview

### Problem Statement

The HealthUp codebase currently uses CommonJS module system (`require()`/`module.exports`), the legacy Node.js module format. This creates several technical challenges:

1. **Modern JavaScript misalignment:** ESM (`import`/`export`) is the official ECMAScript standard and the future of JavaScript modules
2. **Limited tooling support:** Modern build tools and bundlers optimize better for ESM
3. **TypeScript friction:** TypeScript's native output is ESM; CommonJS requires additional configuration
4. **Ecosystem shift:** Most new npm packages now ship ESM-first, with CommonJS as secondary target (many dropping CJS entirely)
5. **Developer experience:** ESM provides better IDE autocomplete and static analysis

### Solution

Migrate the entire codebase from CommonJS to ESM (ECMAScript Modules) using the native Node.js ESM implementation. This involves:

- Adding `"type": "module"` to `package.json`
- Converting all `require()` → `import`
- Converting all `module.exports` → `export`/`export default`
- Replacing `__dirname`/`__filename` with ESM equivalents
- Removing the `require.cache` pattern in `promptBuilder.js`

### Goals

- ✅ Convert all 37 server-side JavaScript files to ESM syntax
- ✅ Maintain 100% functional equivalence (zero behavior changes)
- ✅ Preserve all existing APIs and endpoints
- ✅ Keep test suite passing with zero test modifications
- ✅ Align with 2025 JavaScript ecosystem standards (ESM-first npm packages)
- ✅ Enable future TypeScript migration path (ESM is TypeScript's native output)
- ✅ Improve IDE tooling and static analysis capabilities

### Non-Goals (Deferred to Future Phases)

- ❌ Frontend JavaScript migration (already uses native browser ESM via `<script type="module">`)
- ❌ TypeScript conversion (ESM is prerequisite, but TypeScript itself is separate PRD)
- ❌ Webpack/bundling (not currently used, not needed for Node.js backend)
- ❌ Dependency updates (only migrate module syntax, don't update package versions)
- ❌ Code refactoring beyond module syntax (no logic changes, no restructuring)

---

## User Stories

### US1: Developer Uses Modern Module Syntax
**As a** developer
**I want to** use standard ECMAScript `import`/`export` syntax
**So that** my code aligns with modern JavaScript best practices and official ECMAScript standards

**Acceptance Criteria:**
- All files use `import` instead of `require()`
- All files use `export` instead of `module.exports`
- IDE provides better autocomplete and static analysis
- Code is easier to understand for developers familiar with modern JavaScript

### US2: System Maintains Existing Functionality
**As a** user/administrator
**I want** the application to work exactly as before
**So that** the migration is invisible and causes zero disruption

**Acceptance Criteria:**
- All existing features work identically (lab upload, SQL generation, Gmail integration, admin panel)
- All API endpoints return identical responses
- All tests pass without modification
- No user-facing changes in UI or behavior

### US3: Future TypeScript Migration Enabled
**As a** tech lead
**I want** the codebase prepared for TypeScript adoption
**So that** we can incrementally add type safety in future phases

**Acceptance Criteria:**
- ESM syntax is compatible with TypeScript's native output
- No CommonJS-specific patterns that would block TypeScript migration
- Clear path to adding `.ts` files alongside `.js` files

---

## Technical Design

### Migration Strategy

**Approach:** Big-bang migration (all files at once)

**Rationale:**
- Codebase is small (37 files, 14,543 LOC)
- No circular dependencies found in manual code review (MUST verify with `madge` tool before migration - see Step 1)
- Mixed CommonJS/ESM causes compatibility issues (better to do all at once)
- Can be completed in single PR with atomic commit

**Alternative Rejected:** Incremental migration using `.mjs` extension
- ❌ Requires maintaining dual module systems during transition
- ❌ Confusing file extension mix (`.js` vs `.mjs`)
- ❌ More complex testing (need to verify both systems work)

### Phase 1: Package Configuration

**File:** `package.json`

**Changes:**
1. Add `"type": "module"` field (enables ESM by default for all `.js` files)
2. Update Jest configuration for ESM support

**Before:**
```json
{
  "name": "healthup-upload-form",
  "version": "0.1.0",
  "main": "server/app.js",
  "scripts": {
    "dev": "cross-env NODE_ENV=development node server/app.js",
    "test": "jest"
  }
}
```

**After:**
```json
{
  "name": "healthup-upload-form",
  "version": "0.1.0",
  "type": "module",
  "main": "server/app.js",
  "scripts": {
    "dev": "cross-env NODE_ENV=development node server/app.js",
    "test": "cross-env NODE_OPTIONS=--experimental-vm-modules jest"
  }
}
```

**Jest Configuration:**

Create `jest.config.js` in project root:

```javascript
export default {
  testEnvironment: 'node',
  transform: {},
  extensionsToTreatAsEsm: ['.js'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testMatch: ['**/test/**/*.js'],
};
```

**Note:** Jest 30.2.0 (current version) has experimental ESM support via `--experimental-vm-modules` flag. While the flag name says "experimental", Jest 30.x has significantly improved ESM handling and tests run successfully. The cross-env wrapper ensures cross-platform compatibility (Windows/Mac/Linux).

### Phase 2: Replace `require()` with `import`

**Pattern:** Convert all CommonJS imports to ESM imports

**Conversion Rules:**

**Rule 1: Default Import (module.exports = X)**
```javascript
// BEFORE (CommonJS)
const express = require('express');
const router = require('./routes/analyze');

// AFTER (ESM)
import express from 'express';
import router from './routes/analyze.js';
```

**Rule 2: Named Imports (module.exports = {a, b})**
```javascript
// BEFORE (CommonJS)
const { query } = require('./db');
const { v4: uuidv4 } = require('uuid');

// AFTER (ESM)
import { query } from './db/index.js';
import { v4 as uuidv4 } from 'uuid';
```

**Rule 3: Namespace Import (import everything)**
```javascript
// BEFORE (CommonJS)
const fs = require('fs');
const path = require('path');

// AFTER (ESM)
import fs from 'fs';
import path from 'path';
```

**Rule 4: JSON Imports**
```javascript
// BEFORE (CommonJS)
const config = require('./config.json');

// AFTER (ESM - Option A: Import attributes - Node.js 20.10+)
import config from './config.json' with { type: 'json' };

// AFTER (ESM - Option B: File read - RECOMMENDED for dynamic reloading)
import { readFileSync } from 'fs';
const config = JSON.parse(readFileSync('./config.json', 'utf8'));
```

**Note:** JSON import syntax changed from `assert` to `with` in Node.js 20.10+. Node.js 22+ requires `with` keyword. This PRD recommends Option B (`fs.readFileSync`) for better compatibility and dynamic reloading support.

**Important:** All relative imports MUST include file extension (`.js`)
```javascript
// WRONG (works in CommonJS, fails in ESM)
import router from './routes/analyze';

// CORRECT (required in ESM)
import router from './routes/analyze.js';
```

**Affected Files:** All 37 files (158 `require()` statements total)

### Phase 3: Replace `module.exports` with `export`

**Pattern:** Convert all CommonJS exports to ESM exports

**Conversion Rules:**

**Rule 1: Default Export (single export)**
```javascript
// BEFORE (CommonJS)
module.exports = router;
module.exports = class VisionProvider { ... };

// AFTER (ESM)
export default router;
export default class VisionProvider { ... }
```

**Rule 2: Named Exports (multiple exports)**
```javascript
// BEFORE (CommonJS)
module.exports = {
  persistLabReport,
  getReportById,
};

// AFTER (ESM)
export {
  persistLabReport,
  getReportById,
};

// OR (inline exports)
export function persistLabReport(...) { ... }
export function getReportById(...) { ... }
```

**Rule 3: Mixed Pattern (default + named)**
```javascript
// BEFORE (CommonJS)
function mainFunction() { ... }
function helperFunction() { ... }
module.exports = mainFunction;
module.exports.helper = helperFunction;

// AFTER (ESM)
export default function mainFunction() { ... }
export function helperFunction() { ... }
```

**Affected Files:** 34 files with `module.exports`

### Phase 4: Replace `__dirname` and `__filename`

**Problem:** ESM does not provide `__dirname` and `__filename` globals (CommonJS-specific)

**Solution:** Use `import.meta.url` + Node.js path utilities

**Standard Pattern:**
```javascript
// BEFORE (CommonJS)
const path = require('path');
const configPath = path.join(__dirname, '../../config/schema_aliases.json');

// AFTER (ESM)
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const configPath = join(__dirname, '../../config/schema_aliases.json');
```

**Utility Helper (Recommended):**

Create `server/utils/path-helpers.js`:

```javascript
import { fileURLToPath } from 'url';
import { dirname } from 'path';

export function getDirname(importMetaUrl) {
  return dirname(fileURLToPath(importMetaUrl));
}

export function getFilename(importMetaUrl) {
  return fileURLToPath(importMetaUrl);
}
```

**Usage:**
```javascript
import { getDirname } from './utils/path-helpers.js';
import { join } from 'path';

const __dirname = getDirname(import.meta.url);
const configPath = join(__dirname, '../../config/schema_aliases.json');
```

**Affected Files:** 13 files using `__dirname`
1. `server/services/gmailConnector.js:31`
2. `server/app.js:70,150,154`
3. `server/db/schema.js` (various)
4. `server/services/fileStorage.js:16`
5. `server/services/agenticCore.js:33-34`
6. `server/services/MappingApplier.js`
7. `server/services/promptBuilder.js:14,20,44`
8. `server/utils/promptLoader.js:4`
9. `server/db/export_seed.js`
10. `scripts/verify_mapping_setup.js`

### Phase 5: Remove `require.cache` Pattern

**Problem:** ESM does not expose module cache API (by design - ESM modules are immutable)

**Affected File:** `server/services/promptBuilder.js:42-51`

**Current Code:**
```javascript
function reloadSchemaAliases() {
  try {
    const aliasPath = path.join(__dirname, '../../config/schema_aliases.json');
    delete require.cache[require.resolve(aliasPath)];  // ← No ESM equivalent
    schemaAliases = JSON.parse(fs.readFileSync(aliasPath, 'utf8'));
    console.info('[promptBuilder] Schema aliases reloaded');
  } catch (error) {
    console.error('[promptBuilder] Failed to reload schema_aliases.json:', error.message);
  }
}
```

**Solution:** Remove cache-busting line (already re-reads from disk)

**Refactored Code:**
```javascript
import { readFileSync } from 'fs';
import { join } from 'path';
import { getDirname } from '../utils/path-helpers.js';

const __dirname = getDirname(import.meta.url);

function reloadSchemaAliases() {
  try {
    const aliasPath = join(__dirname, '../../config/schema_aliases.json');
    // No cache to clear - file is re-read from disk every time
    schemaAliases = JSON.parse(readFileSync(aliasPath, 'utf8'));
    console.info('[promptBuilder] Schema aliases reloaded');
  } catch (error) {
    console.error('[promptBuilder] Failed to reload schema_aliases.json:', error.message);
  }
}
```

**Behavior:**
- ✅ Functionally identical (already used `fs.readFileSync`, not `require()` for loading)
- ✅ Cache-busting was redundant (file read always gets fresh data)
- ✅ Simpler code (one less line)

**Admin Cache Busting Endpoint:**

`POST /api/admin/bust-cache` endpoint (server/routes/admin.js) currently calls `reloadSchemaAliases()`. This will continue to work - it re-reads the JSON file from disk.

**No API changes needed.**

---

## File-by-File Migration Guide

### Critical Files (Complex Patterns)

#### 1. `server/services/promptBuilder.js`
**Complexity:** High (has `require.cache` and multiple `__dirname` usages)

**Changes:**
- Add `__dirname` shim using `import.meta.url`
- Remove `require.cache` line
- Convert 4 `require()` statements → `import`
- Convert `module.exports` → `export`

#### 2. `server/app.js`
**Complexity:** Medium (entry point with many imports)

**Changes:**
- Convert 15+ `require()` statements → `import`
- Add `__dirname` shim for static file serving
- Update `express.static()` path resolution

#### 3. `server/services/vision/VisionProviderFactory.js`
**Complexity:** Medium (factory pattern with conditional imports)

**Changes:**
- Convert 3 `require()` statements → `import`
- No dynamic imports needed (provider selection happens at runtime, not import time)

#### 4. `server/utils/promptLoader.js`
**Complexity:** Low (simple utility)

**Changes:**
- Convert 2 `require()` statements → `import`
- Add `__dirname` shim

### Standard Files (Straightforward)

**Routes (7 files):**
- `server/routes/*.js` - Convert imports/exports only

**Services (15 files):**
- `server/services/*.js` - Convert imports/exports only

**Database (3 files):**
- `server/db/*.js` - Convert imports/exports only

**Utils (4 files):**
- `server/utils/*.js` - Convert imports/exports only

**Scripts (2 files):**
- `scripts/*.js` - Convert imports/exports, add `__dirname` shims

**Tests (1 file):**
- `test/manual/test_agentic_sql.js` - Convert imports/exports

---

## Dependency Compatibility

All dependencies support ESM (verified via package.json inspection and npm documentation):

| Package | Version | ESM Support | Notes |
|---------|---------|-------------|-------|
| express | ^4.19.2 | ✅ Full | Native ESM support since 4.17 |
| pg | ^8.16.3 | ✅ Full | Pure JavaScript, no native bindings |
| openai | ^4.58.1 | ✅ Full | Official SDK, ESM-first |
| @anthropic-ai/sdk | ^0.68.0 | ✅ Full | Native ESM implementation |
| pino | ^10.0.0 | ✅ Full | Dual CJS/ESM package |
| pino-pretty | ^13.1.2 | ✅ Full | Pure JavaScript |
| dotenv | ^16.4.5 | ✅ Full | ESM support via native import |
| googleapis | ^140.0.1 | ✅ Full | TypeScript-based, native ESM |
| express-fileupload | ^1.4.3 | ✅ Full | Pure JavaScript |
| pdf-parse | ^1.1.1 | ✅ Full | Pure JavaScript |
| tiktoken | ^1.0.22 | ✅ Full | Native binding with ESM support |
| chart.js | ^4.5.1 | ✅ Full | Frontend library (browser ESM) |
| marked | ^17.0.0 | ✅ Full | Pure JavaScript |
| dompurify | ^3.3.0 | ✅ Full | Pure JavaScript |
| p-limit | ^2.3.0 | ✅ Full | Pure JavaScript |
| cross-env | ^10.1.0 | ✅ Full | CLI tool, module system agnostic |
| jest | ^30.2.0 | ✅ Full | Experimental ESM support via `--experimental-vm-modules` |

**No blocking dependencies identified.**

---

## Testing Strategy

### Automated Testing

**Unit Tests:**
```bash
npm test
```

**Expected Result:** All existing tests pass without modification

**Note:** Jest ESM support requires `NODE_OPTIONS='--experimental-vm-modules'` flag (added to `package.json` script)

### Manual Testing Checklist

#### Core Functionality
- [ ] **Server starts:** `npm run dev` starts without errors
- [ ] **Lab upload:** Upload single PDF → OCR extraction completes
- [ ] **Batch upload:** Upload 3 files → all process successfully
- [ ] **SQL generation:** Generate SQL query → returns valid results
- [ ] **Plot rendering:** Time-series query → plot displays correctly
- [ ] **Gmail integration:** (if enabled) OAuth → email classification → attachment ingestion
- [ ] **Admin panel:** Load admin panel → pending analytes/match reviews display

#### API Endpoints (Smoke Test)
- [ ] `GET /health/db` → returns 200 with database status
- [ ] `POST /api/analyze-labs` → returns 202 with job_id
- [ ] `GET /api/analyze-labs/jobs/:jobId` → returns job status
- [ ] `POST /api/sql-generator` → returns SQL query
- [ ] `POST /api/chat/stream` → returns SSE stream
- [ ] `GET /api/reports/:reportId` → returns report metadata
- [ ] `GET /api/reports/:reportId/original-file` → returns file binary

#### Edge Cases
- [ ] **Deduplication:** Upload same file twice → shows "🔄 Duplicate" status
- [ ] **Error handling:** Upload invalid file → returns clear error
- [ ] **Mapping:** Upload report → auto-mapping runs → confidence tiers applied
- [ ] **Cache busting:** Call `/api/admin/bust-cache` → schema reloads from disk

### Performance Benchmarks

**Baseline (CommonJS):**
```bash
# Measure before migration
time node server/app.js &  # Note startup time
curl -X POST http://localhost:3000/api/analyze-labs  # Note response time
```

**Target (ESM):**
```bash
# Measure after migration
time node server/app.js &  # Expected: 10-20% slower startup (acceptable trade-off)
curl -X POST http://localhost:3000/api/analyze-labs  # Should be identical
```

**Expected Results:**
- **Startup time:** 10-20% slower (ESM module loading is currently slower than CommonJS in Node.js)
- **Runtime performance:** Identical (no code logic changes)
- **Memory usage:** Negligible difference (<5%)

### Regression Testing

**No behavior changes expected.** This is a syntax migration only.

**Verification Method:**
1. Run full manual test suite on `main` branch → document results
2. Run full manual test suite on `esm-migration` branch → compare results
3. Results must be identical (no functional changes)

---

## Implementation Steps

### Step 1: Verify No Circular Dependencies (BLOCKING)

**CRITICAL:** This step MUST be completed before proceeding with migration. Big-bang migration will fail if circular dependencies exist.

**Action:** Install and run circular dependency checker

```bash
# Install madge (circular dependency detection tool)
npm install --save-dev madge

# Check for circular dependencies in server code
npx madge --circular --extensions js server/

# Expected output: "No circular dependencies found!"
```

**If circular dependencies found:**
1. Document each cycle found
2. Refactor code to break cycles BEFORE starting ESM migration
3. Re-run madge until clean

**Only proceed to Step 2 when madge reports zero circular dependencies.**

**Commit Message:** `chore: verify no circular dependencies with madge`

### Step 2: Create Feature Branch
```bash
git checkout -b feat/esm-migration
```

### Step 3: Update Package Configuration

**Action:** Update `package.json` and create `jest.config.js`

**Files:**
- `package.json` - Add `"type": "module"`, update test script
- `jest.config.js` - Create new file with ESM configuration

**Commit Message:** `chore: configure package.json for ESM`

### Step 4: Create Path Helper Utility

**Action:** Create `server/utils/path-helpers.js`

**Content:**
```javascript
import { fileURLToPath } from 'url';
import { dirname } from 'path';

export function getDirname(importMetaUrl) {
  return dirname(fileURLToPath(importMetaUrl));
}

export function getFilename(importMetaUrl) {
  return fileURLToPath(importMetaUrl);
}
```

**Commit Message:** `feat: add ESM path helper utilities`

### Step 5: Convert Core Utilities First

**Order:** Start with leaf nodes (no dependencies), work up to root

**Recommended Order:**
1. `server/utils/path-helpers.js` (already done in Step 3)
2. `server/utils/promptLoader.js`
3. `server/utils/jobManager.js`
4. `server/utils/sessionManager.js`
5. `server/db/index.js`
6. `server/db/schema.js`

**Commit Message:** `refactor: convert utils and db modules to ESM`

### Step 6: Convert Services

**Files:** All files in `server/services/` (18 files)

**Special Attention:**
- `promptBuilder.js` - Remove `require.cache` pattern
- `VisionProviderFactory.js` - Factory pattern needs careful review

**Commit Message:** `refactor: convert services to ESM`

### Step 7: Convert Routes

**Files:** All files in `server/routes/` (7 files)

**Commit Message:** `refactor: convert routes to ESM`

### Step 8: Convert Entry Point

**Files:** `server/app.js`, `scripts/*.js`, `test/manual/*.js`

**Commit Message:** `refactor: convert app entry point and scripts to ESM`

### Step 9: Test and Verify

**Actions:**
1. Run `npm run dev` → verify server starts
2. Run `npm test` → verify all tests pass
3. Manual smoke tests → verify core features work
4. Performance benchmarks → verify no regression

**If issues found:** Fix and document in commit messages

### Step 10: Update CLAUDE.md

**File:** `CLAUDE.md`

**Add Section:**
```markdown
## Module System

HealthUp uses ESM (ECMAScript Modules) for all server-side code.

**Import Patterns:**
```javascript
// Named imports
import { query } from './db/index.js';

// Default imports
import express from 'express';

// Path resolution
import { getDirname } from './utils/path-helpers.js';
const __dirname = getDirname(import.meta.url);
```

**Important:**
- All relative imports MUST include `.js` extension
- Use `import.meta.url` instead of `__dirname`/`__filename`
- JSON imports: use `fs.readFileSync()` (recommended) or `with { type: 'json' }` (Node 20.10+)
```

**Commit Message:** `docs: update CLAUDE.md with ESM guidelines`

### Step 11: Create Pull Request

**PR Title:** `feat: migrate codebase from CommonJS to ESM`

**PR Description:**
```markdown
## Overview
Migrates entire codebase from CommonJS (`require`/`module.exports`) to ESM (`import`/`export`).

## Changes
- ✅ Added `"type": "module"` to package.json
- ✅ Converted 158 `require()` statements to `import`
- ✅ Converted 34 `module.exports` to `export`/`export default`
- ✅ Replaced `__dirname`/`__filename` with `import.meta.url` equivalents
- ✅ Removed `require.cache` pattern from promptBuilder.js
- ✅ Created ESM path helper utilities
- ✅ Updated Jest configuration for ESM support

## Testing
- ✅ All automated tests pass
- ✅ Manual smoke tests completed
- ✅ No functional changes (behavior identical)
- ✅ No circular dependencies (verified with madge)
- ✅ Startup time within acceptable range (10-20% slower is expected)

## Breaking Changes
None. This is a syntax migration with zero behavior changes.

## Rollback Plan
If issues arise: `git revert <merge-commit>` immediately restores CommonJS.
```

**Reviewers:** Request review from senior engineer

---

## Breaking Changes

**None.** This is a syntax-only migration with zero functional changes.

**API Compatibility:** All endpoints remain identical
**Database Schema:** No changes
**Frontend:** No changes (already uses browser-native ESM)
**Environment Variables:** No changes
**Configuration Files:** No changes (except package.json "type" field)

---

## Rollback Plan

**If Issues Arise:**

1. **Stop the server** (if running)
2. **Revert the merge commit:**
   ```bash
   git revert <merge-commit-hash> -m 1
   git push origin main
   ```
3. **Restart server:**
   ```bash
   npm run dev
   ```

**Recovery Time:** <5 minutes (single git revert)

**Data Loss:** None (database unaffected)

---

## Performance Considerations

### Realistic Performance Expectations

**IMPORTANT:** ESM startup is currently **slower** than CommonJS in Node.js, not faster. Setting accurate expectations:

**Module Loading:**
- CommonJS: Synchronous loading, optimized over 10+ years
- ESM: Asynchronous loading, still being optimized by V8 team
- **Reality:** ESM is 10-20% slower for startup time in Node.js 20.x

**Startup Time:**
- CommonJS baseline: ~0.15-0.20 seconds
- ESM after migration: ~0.18-0.25 seconds (slightly slower)
- **Acceptable trade-off:** Extra 30-50ms is imperceptible to users

**Runtime Performance:**
- No changes to application logic
- **Expected result:** Identical runtime performance once loaded

**Memory:**
- Both use similar module caching strategies
- **Expected result:** Negligible difference (<5%)

### Why Migrate If Slower?

The migration is **not about performance** - it's about ecosystem alignment:

1. **Ecosystem standard:** ESM is the official ECMAScript standard (2015+)
2. **Npm packages:** Many packages dropping CommonJS support in 2025
3. **TypeScript:** Native ESM output (no transpilation overhead)
4. **Tooling:** Better static analysis, tree-shaking, IDE autocomplete
5. **Future-proofing:** Node.js will continue optimizing ESM (CommonJS is legacy)

**The 30-50ms startup penalty is an acceptable cost for long-term maintainability.**

### Measurement

**Before Migration:**
```bash
time node server/app.js &
# Example output: real 0m0.180s
```

**After Migration:**
```bash
time node server/app.js &
# Expected output: real 0m0.220s (acceptable 10-20% increase)
```

---

## Risk Assessment

### Low Risk Items
- ✅ No dynamic `require()` with variables
- ✅ All dependencies ESM-compatible
- ✅ Automated test coverage
- ✅ Fast rollback via git revert

### Medium Risk Items
- ⚠️ **Circular dependencies:** Manual review found none, but MUST verify with `madge` tool (Step 1 is blocking)
  - **Mitigation:** Make Step 1 mandatory before proceeding
- ⚠️ **Jest ESM support:** Uses experimental flag (`--experimental-vm-modules`)
  - **Mitigation:** Jest 30.2.0 tests run successfully despite experimental status
- ⚠️ **File extension requirement:** All imports need `.js` extension
  - **Mitigation:** Linter can enforce (eslint-plugin-import)
- ⚠️ **Path resolution:** `__dirname` shim must be consistent
  - **Mitigation:** Use shared utility function (`getDirname()`)
- ⚠️ **Startup performance:** ESM is 10-20% slower than CommonJS
  - **Mitigation:** Acceptable trade-off for ecosystem alignment (30-50ms imperceptible)

### High Risk Items
None identified.

---

## Success Metrics

### Week 1 (Post-Merge)
- ✅ Zero production errors related to module resolution
- ✅ All features working identically to pre-migration
- ✅ Automated tests passing on every commit
- ✅ Startup time within 20% of baseline (acceptable given ESM is slower but provides ecosystem benefits)

### Month 1 (Post-Stabilization)
- ✅ Developer feedback: improved IDE autocomplete and linting
- ✅ Codebase ready for TypeScript incremental adoption
- ✅ New feature development velocity unchanged (no syntax friction)
- ✅ No npm dependency conflicts (packages require ESM)

---

## Future Enhancements (Out of Scope)

### Phase 2: TypeScript Migration
**Prerequisite:** ESM syntax (this PRD)

**Benefits:**
- Type safety for reduced runtime errors
- Better IDE autocomplete
- Self-documenting API contracts
- Easier refactoring

**Effort:** 10-15 days (incremental, file-by-file)

### Phase 3: Subpath Imports
**Enables:** Clean import paths without relative `../../`

**Example:**
```javascript
// Instead of
import { query } from '../../db/index.js';

// Use
import { query } from '#db';
```

**Configuration:** Add to package.json:
```json
{
  "imports": {
    "#db": "./server/db/index.js",
    "#services/*": "./server/services/*.js",
    "#utils/*": "./server/utils/*.js"
  }
}
```

**Effort:** 1 day (configuration + update imports)

---

## Appendix

### Related PRDs
- PRD v3.4: Storing Original Lab Files (file system operations, `__dirname` usage)
- Future: TypeScript Migration (ESM is prerequisite)

### Technical References

**Node.js ESM Documentation:**
- [ECMAScript Modules](https://nodejs.org/docs/latest-v20.x/api/esm.html)
- [import.meta.url](https://nodejs.org/docs/latest-v20.x/api/esm.html#importmetaurl)

**Jest ESM Support:**
- [ECMAScript Modules](https://jestjs.io/docs/ecmascript-modules)

**Migration Guides:**
- [Pure ESM Package Guide](https://gist.github.com/sindresorhus/a39789f98801d908bbc7ff3ecc99d99c)

### File Extension Handling

**ESM Requirement:** All relative imports MUST specify file extension

**Correct:**
```javascript
import router from './routes/analyze.js';  // ✅ Explicit .js
import { query } from './db/index.js';     // ✅ Explicit .js
```

**Incorrect (will fail):**
```javascript
import router from './routes/analyze';     // ❌ Missing .js
import { query } from './db';              // ❌ Missing .js
```

**Rationale:** ESM spec requires explicit specifiers for interoperability with browsers

### Common Pitfalls

**Pitfall 1: Forgetting file extensions**
```javascript
// WRONG
import router from './routes/analyze';

// CORRECT
import router from './routes/analyze.js';
```

**Pitfall 2: Using `__dirname` directly**
```javascript
// WRONG (undefined in ESM)
const configPath = path.join(__dirname, 'config.json');

// CORRECT
import { getDirname } from './utils/path-helpers.js';
const __dirname = getDirname(import.meta.url);
const configPath = path.join(__dirname, 'config.json');
```

**Pitfall 3: Dynamic imports in top-level**
```javascript
// WRONG (CommonJS allows this, ESM doesn't)
const provider = require(`./${providerName}.js`);

// CORRECT (ESM uses dynamic import())
const provider = await import(`./${providerName}.js`);
```

**Note:** HealthUp codebase has zero dynamic imports, so this pitfall doesn't apply.

---

## Acceptance Criteria

### Prerequisites (BLOCKING)
- [ ] **No circular dependencies:** `npx madge --circular --extensions js server/` reports "No circular dependencies found!"

### Functional Requirements
- [ ] **Server starts:** `npm run dev` starts without errors
- [ ] **Lab upload works:** Upload PDF → OCR extraction → database persistence
- [ ] **SQL generation works:** Generate query → returns results
- [ ] **Gmail integration works:** (if enabled) OAuth → classification → ingestion
- [ ] **Admin panel works:** Load panel → actions complete successfully
- [ ] **All tests pass:** `npm test` exits with 0

### Code Quality
- [ ] **All imports explicit:** Every relative import has `.js` extension
- [ ] **No `require()` remaining:** `grep -r "require(" server/` returns 0 results (except in comments)
- [ ] **No `module.exports` remaining:** `grep -r "module.exports" server/` returns 0 results
- [ ] **Consistent `__dirname` usage:** All files use `getDirname(import.meta.url)`
- [ ] **Cache busting removed:** `require.cache` pattern no longer exists

### Performance
- [ ] **Startup time:** Within 20% of baseline (10-20% slower is expected and acceptable)
- [ ] **Memory usage:** Within 10% of baseline (measured with Node.js `--inspect`)
- [ ] **Response times:** Identical to baseline (no regression)

### Documentation
- [ ] **CLAUDE.md updated:** ESM patterns documented
- [ ] **Code comments:** Complex patterns explained
- [ ] **PR description:** Clear summary of changes

---

**Status:** ✅ Ready for Implementation
**Effort:** 3-5 days (senior SE)
**Priority:** Medium (technical debt, enables future improvements)
