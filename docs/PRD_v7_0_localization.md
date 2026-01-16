# PRD v7.0: Localization (i18n)

**Status**: Ready for Implementation
**Created**: 2026-01-16
**Updated**: 2026-01-16 (post-technical-review)
**Author**: System (Claude Code)

## Overview

Introduce internationalization (i18n) to HealthUp with English and Russian language support. The system will localize:
1. **Frontend UI** - All labels, buttons, messages, tooltips using i18next (CDN bundle)
2. **Analyte display names** - Via new `analyte_translations` table (source data remains untouched)
3. **Date/number formatting** - Via browser's `Intl` API
4. **LLM responses** - Auto-detect language from user's message (current behavior preserved)

**Design Principle**: Source data (OCR-extracted lab results) is NEVER modified. Localization is a display layer only.

---

## Goals

**Primary:**
- Support English (default) and Russian languages
- Allow users to switch language via dropdown in header
- Persist language preference in localStorage (browser-only)
- Localize all user-facing UI strings
- Display analyte names in user's language while preserving original data

**Non-Goals:**
- Server-side language persistence (no `locale` column in `users` table)
- Localizing OCR-extracted data (source of truth must remain unchanged)
- Full backend localization (errors return codes, frontend translates)
- Right-to-left (RTL) language support
- More than 2 languages at launch

---

## User Stories

### Story 1: Language Switcher
**As a** user
**I want** to change the app language from a dropdown in the header
**So that** I can use the app in my preferred language

**Acceptance Criteria:**
- Dropdown shows: "English" / "Русский"
- Selection persists in localStorage (`healthup_locale`)
- Page updates immediately without full reload
- Default: Browser language if supported (en/ru), otherwise English

### Story 2: Localized UI
**As a** Russian-speaking user
**I want** all buttons, labels, and messages in Russian
**So that** I can understand the interface easily

**Acceptance Criteria:**
- All static UI text is translated
- Form validation messages are in selected language
- Error messages from MVP routes (upload, chat, auth) show in selected language (see Error Handling MVP Scope)
- Non-MVP route errors may remain in English until future refactor
- Dates show in locale-appropriate format (DD.MM.YYYY for Russian)

### Story 3: Localized Analyte Names
**As a** user viewing lab results
**I want** to see analyte names in my language
**So that** I understand what each test measures

**Acceptance Criteria:**
- "Albumin" displays as "Альбумин" when Russian is selected
- Original OCR-extracted `parameter_name` remains unchanged in database
- Hover/detail view shows original name for reference
- Missing translations fall back to English canonical name

### Story 4: LLM Language Behavior (Unchanged)
**As a** user
**I want** the AI chat assistant to respond in the language I use
**So that** I can have natural conversations in my preferred language

**Acceptance Criteria:**
- General chat queries: LLM auto-detects language from user's message
- Post-upload responses: LLM uses language detected from lab data (Cyrillic → Russian)
- LLM naturally switches language based on context
- No forced UI locale override - language follows content context

**Language Authority (Clarification):**

The LLM response language is determined by **content context**, not UI locale:

| Context | Language Authority | Example |
|---------|-------------------|---------|
| Post-upload summary | Lab data language (Cyrillic detection in `chatStream.js`) | Russian lab → Russian response |
| General chat query | User message language | User types in English → English response |
| Mixed context | Lab data takes precedence | Russian labs + English question → Russian response |

**Rationale:** Users with Russian lab data expect Russian explanations of their results, even if they occasionally type in English. This matches the existing `chatStream.js` behavior (lines 1673-1676) which detects Cyrillic in parameter names.

**Note:** The language switcher affects UI strings only, not LLM responses. LLM language is autonomous based on content context.

---

## Technical Architecture

### 1. i18next Setup (Frontend)

**Technology Choice: i18next via CDN**

Chosen for:
- Industry standard with massive ecosystem
- Works on vanilla JS (no React/Vue required)
- Supports namespaces, pluralization (including Russian complex plurals), interpolation
- CDN UMD bundle - consistent with existing Chart.js, marked, DOMPurify pattern
- Built-in Russian plural rules (`_one`, `_few`, `_many` suffixes)

**CDN Scripts (add to HTML `<head>`):**

```html
<!-- i18next core + plugins (UMD bundles, same pattern as Chart.js) -->
<script src="https://cdn.jsdelivr.net/npm/i18next@23/i18next.min.js" defer></script>
<script src="https://cdn.jsdelivr.net/npm/i18next-http-backend@2/i18nextHttpBackend.min.js" defer></script>
<script src="https://cdn.jsdelivr.net/npm/i18next-browser-languagedetector@7/i18nextBrowserLanguageDetector.min.js" defer></script>
```

**File Structure:**
```
public/
├── locales/
│   ├── en/
│   │   ├── common.json      # Shared strings (buttons, labels)
│   │   ├── chat.json        # Chat-specific strings
│   │   ├── upload.json      # Upload flow strings
│   │   ├── errors.json      # Error messages
│   │   └── onboarding.json  # Landing page strings
│   └── ru/
│       ├── common.json
│       ├── chat.json
│       ├── upload.json
│       ├── errors.json
│       └── onboarding.json
├── js/
│   └── i18n.js              # i18next initialization (uses window.i18next)
```

**Initialization (`public/js/i18n.js`):**

```javascript
// i18next loaded via CDN - available as window.i18next
// Plugins: window.i18nextHttpBackend, window.i18nextBrowserLanguageDetector

const SUPPORTED_LOCALES = ['en', 'ru'];
const DEFAULT_LOCALE = 'en';
const STORAGE_KEY = 'healthup_locale';

// Promise that resolves when i18next is ready
window.i18nReady = (async function initI18n() {
  await window.i18next
    .use(window.i18nextHttpBackend)
    .use(window.i18nextBrowserLanguageDetector)
    .init({
      supportedLngs: SUPPORTED_LOCALES,
      fallbackLng: DEFAULT_LOCALE,
      load: 'languageOnly',  // Normalize 'en-US' → 'en', 'ru-RU' → 'ru'
      defaultNS: 'common',
      ns: ['common', 'chat', 'upload', 'errors', 'onboarding'],

      backend: {
        loadPath: '/locales/{{lng}}/{{ns}}.json',
        // Retry once on failure before falling back
        requestOptions: {
          cache: 'default'
        }
      },

      detection: {
        order: ['localStorage', 'navigator'],
        lookupLocalStorage: STORAGE_KEY,
        caches: ['localStorage']
      },

      interpolation: {
        escapeValue: false  // XSS protection handled by textContent
      },

      // Fallback behavior on load errors
      returnEmptyString: false,  // Return key name instead of empty string
      returnNull: false,
      saveMissing: false,  // Enable in development to log missing keys (see Future Considerations)
      missingKeyHandler: (lng, ns, key) => {
        console.warn(`[i18n] Missing translation: ${lng}/${ns}:${key}`);
      }
    });

  console.log('[i18n] Initialized with locale:', window.i18next.language);
  return true;
})().catch(error => {
  // Critical: If i18next fails to initialize, app should still function
  console.error('[i18n] Failed to initialize:', error);
  // Provide a minimal fallback so i18next.t() doesn't throw
  window.i18next = {
    t: (key) => key.split(':').pop().split('.').pop(),  // Return last part of key
    language: 'en',
    changeLanguage: () => Promise.resolve()
  };
  return true;
});

// Helper to get current locale
function getCurrentLocale() {
  return window.i18next.language || DEFAULT_LOCALE;
}

// Helper to change locale
async function setLocale(locale) {
  if (!SUPPORTED_LOCALES.includes(locale)) {
    console.warn(`[i18n] Unsupported locale: ${locale}`);
    return;
  }
  await window.i18next.changeLanguage(locale);
  localStorage.setItem(STORAGE_KEY, locale);
  // Update HTML lang attribute for accessibility and browser defaults
  document.documentElement.lang = locale;
  // Dispatch event for components to react
  window.dispatchEvent(new CustomEvent('localeChanged', { detail: { locale } }));
}

// Expose helpers globally (consistent with vanilla JS pattern)
window.i18nHelpers = { getCurrentLocale, setLocale, SUPPORTED_LOCALES, DEFAULT_LOCALE, STORAGE_KEY };
```

**Usage in Components:**

```javascript
// Wait for i18n to be ready (similar to authReady pattern)
await window.i18nReady;

// Simple translation
const label = i18next.t('common:buttons.upload');  // "Upload" or "Загрузить"

// With interpolation
const msg = i18next.t('chat:resultsFound', { count: 5 });  // "Found 5 results"

// With namespace
const error = i18next.t('errors:network');  // "Network error. Please try again."

// Russian plurals (i18next handles automatically)
const files = i18next.t('upload:filesCount', { count: 21 });  // "21 файл" (not "файлов")
```

**Russian Plural Rules (Built-in):**

i18next has Russian plural rules built-in. Use these key suffixes:

| Count | Suffix | Example (files) |
|-------|--------|-----------------|
| 1, 21, 31... | `_one` | "{{count}} файл" |
| 2-4, 22-24... | `_few` | "{{count}} файла" |
| 0, 5-20, 25-30... | `_many` | "{{count}} файлов" |

```json
// ru/upload.json
{
  "filesCount_one": "{{count}} файл",
  "filesCount_few": "{{count}} файла",
  "filesCount_many": "{{count}} файлов"
}
```

---

### 2. Language Switcher Component

**Location:** Header area, near user menu

**Placement by Page:**
- `index.html`, `admin.html`: In header nav, next to user menu/logout button
- `login.html`: Top-right corner of page (no full header, just minimal placement)
- `landing.html`: In the minimal header bar, right-aligned

For pages without a full navigation header (login, landing), the switcher should be positioned in the top-right corner using absolute/fixed positioning to maintain consistent access across all pages.

**HTML Structure:**
```html
<div class="language-switcher">
  <select id="language-select" class="language-dropdown">
    <option value="en">English</option>
    <option value="ru">Русский</option>
  </select>
</div>
```

**JavaScript (`public/js/language-switcher.js`):**

```javascript
// Uses global window.i18next and window.i18nHelpers from i18n.js

function initLanguageSwitcher() {
  const select = document.getElementById('language-select');
  if (!select) return;

  const { getCurrentLocale, setLocale } = window.i18nHelpers;

  // Set current value
  select.value = getCurrentLocale();

  // Handle change
  select.addEventListener('change', async (e) => {
    await setLocale(e.target.value);
    updatePageTranslations();
  });
}

// Update all [data-i18n] elements on the page
function updatePageTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const options = el.getAttribute('data-i18n-options');

    // Parse options with defensive error handling
    let opts = {};
    if (options) {
      try {
        opts = JSON.parse(options);
      } catch (e) {
        console.warn(`[i18n] Invalid JSON in data-i18n-options for key "${key}":`, e);
      }
    }

    // Handle different element types
    if (el.tagName === 'INPUT' && el.placeholder) {
      el.placeholder = i18next.t(key, opts);
    } else if (el.hasAttribute('title')) {
      el.title = i18next.t(key, opts);  // Handle title attributes
    } else {
      el.textContent = i18next.t(key, opts);
    }
  });

  // Update document title (per-page key with fallback)
  const pageKey = document.body.dataset.i18nPage || 'index';
  document.title = i18next.t(`common:pageTitle.${pageKey}`, {
    defaultValue: i18next.t('common:pageTitle.index')
  });
}

/**
 * CRITICAL: DOM Targeting Strategy for data-i18n
 *
 * The `data-i18n` attribute must ONLY be applied to LEAF text nodes.
 * Using textContent on a parent element will WIPE all child markup.
 *
 * ❌ WRONG - Will destroy icon:
 *   <button data-i18n="buttons.upload"><i class="icon-upload"></i> Upload</button>
 *
 * ✅ CORRECT - Wrap text in span:
 *   <button><i class="icon-upload"></i> <span data-i18n="buttons.upload">Upload</span></button>
 *
 * ✅ CORRECT - Text-only element:
 *   <span class="label" data-i18n="labels.status">Status</span>
 *
 * Rule: If an element has child elements (icons, nested spans), wrap the
 * translatable text in its own <span data-i18n="..."> element.
 */

// Listen for locale changes from other sources
window.addEventListener('localeChanged', () => {
  const select = document.getElementById('language-select');
  const { getCurrentLocale } = window.i18nHelpers;
  if (select) select.value = getCurrentLocale();
  updatePageTranslations();
});

// Initialize after i18n is ready
window.i18nReady.then(() => initLanguageSwitcher());
```

**CSS (`public/css/language-switcher.css`):**

```css
.language-switcher {
  margin-left: var(--space-4);
}

.language-dropdown {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-elevated);
  font-family: var(--font-body);
  font-size: var(--text-sm);
  color: var(--color-text);
  cursor: pointer;
  transition: border-color var(--transition-base);
}

.language-dropdown:hover {
  border-color: var(--color-accent);
}

.language-dropdown:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px var(--color-accent-light);
}

/* Standalone positioning for pages without full header (login.html, landing.html) */
.language-switcher--standalone {
  position: fixed;
  top: var(--space-4);
  right: var(--space-4);
  z-index: 100;
  margin-left: 0;  /* Override default margin */
}

/* Optional: semi-transparent background for better visibility on varied backgrounds */
.language-switcher--standalone .language-dropdown {
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(4px);
}
```

**HTML for Standalone Pages (login.html, landing.html):**
```html
<!-- Add directly inside <body>, before other content -->
<div class="language-switcher language-switcher--standalone">
  <select id="language-select" class="language-dropdown">
    <option value="en">English</option>
    <option value="ru">Русский</option>
  </select>
</div>
```

---

### 3. Date and Number Formatting

**Use browser's `Intl` API based on selected locale.**

**Helper Module (`public/js/formatters.js`):**

```javascript
// IIFE pattern (consistent with plotRenderer.js) - no ES module exports
// Exposes window.formatters for use in other scripts
(() => {
  /**
   * Get current locale with fallback
   * Called inside each function to avoid race condition with i18n init
   */
  function getLocale() {
    return window.i18nHelpers?.getCurrentLocale() || 'en';
  }

  /**
   * Format date according to user's locale
   * @param {Date|string} date - Date to format
   * @param {object} options - Intl.DateTimeFormat options
   * @returns {string} Formatted date
   *
   * NOTE: Date-only strings (YYYY-MM-DD) are parsed as UTC midnight by JS,
   * which can shift to the previous day in negative UTC offsets. For most
   * display purposes this is acceptable. If precision is critical, consider
   * appending 'T12:00:00' before parsing or using the string directly with
   * Intl.DateTimeFormat options: { year: 'numeric', month: '2-digit', day: '2-digit' }
   */
  function formatDate(date, options = {}) {
    const locale = getLocale();
    const dateObj = typeof date === 'string' ? new Date(date) : date;

    const defaultOptions = {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    };

    return new Intl.DateTimeFormat(locale, { ...defaultOptions, ...options }).format(dateObj);
  }

  /**
   * Format number according to user's locale
   * @param {number} value - Number to format
   * @param {object} options - Intl.NumberFormat options
   * @returns {string} Formatted number
   *
   * NOTE: For lab values, preserve original precision to avoid clinical misinterpretation.
   * Use maximumFractionDigits to match source data precision.
   * Example: formatNumber(1.25, { maximumFractionDigits: 2 }) → "1.25" (en) / "1,25" (ru)
   */
  function formatNumber(value, options = {}) {
    const locale = getLocale();
    // Default to high precision for lab values to avoid unintended rounding
    const defaultOptions = { maximumFractionDigits: 6 };
    return new Intl.NumberFormat(locale, { ...defaultOptions, ...options }).format(value);
  }

  /**
   * Format date relative to now (e.g., "2 days ago")
   * @param {Date|string} date - Date to format
   * @returns {string} Relative date string
   */
  function formatRelativeDate(date) {
    const locale = getLocale();
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

    const diffMs = dateObj - new Date();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

    if (Math.abs(diffDays) < 1) {
      const diffHours = Math.round(diffMs / (1000 * 60 * 60));
      return rtf.format(diffHours, 'hour');
    } else if (Math.abs(diffDays) < 30) {
      return rtf.format(diffDays, 'day');
    } else if (Math.abs(diffDays) < 365) {
      return rtf.format(Math.round(diffDays / 30), 'month');
    } else {
      return rtf.format(Math.round(diffDays / 365), 'year');
    }
  }

  // Expose globally (classic script pattern)
  window.formatters = { formatDate, formatNumber, formatRelativeDate };
})();
```

**Expected Output Examples:**

| Value | English (en) | Russian (ru) |
|-------|--------------|--------------|
| `2026-01-16` | 01/16/2026 | 16.01.2026 |
| `1234.56` | 1,234.56 | 1 234,56 |
| `-2 days` | 2 days ago | 2 дня назад |

---

### 4. Analyte Translations Table

**Required API Change: Include `analyte_code` in Report Detail Response**

Currently `server/services/reportRetrieval.js` returns `parameter_name` only in the `parameters` array. To enable analyte name localization, we must expand the payload:

**Modification to `executeReportDetailQueries()` in `reportRetrieval.js`:**

```javascript
// Current query (lab_results only):
const labResults = await client.query(`
  SELECT id, position, parameter_name, result_value, unit, ...
  FROM lab_results WHERE report_id = $1
`, [reportId]);

// Updated query (JOIN to analytes for code):
const labResults = await client.query(`
  SELECT
    lr.id,
    lr.position,
    lr.parameter_name,
    lr.result_value,
    lr.unit,
    lr.analyte_id,
    a.code AS analyte_code,  -- NEW: for translation lookup
    ...
  FROM lab_results lr
  LEFT JOIN analytes a ON a.analyte_id = lr.analyte_id
  WHERE lr.report_id = $1
  ORDER BY lr.position ASC NULLS LAST, lr.created_at ASC
`, [reportId]);
```

**Updated Response Shape:**

```javascript
parameters: labResults.rows.map((row) => ({
  parameter_name: row.parameter_name,  // Original OCR text (always shown on hover)
  analyte_id: row.analyte_id || null,      // NEW: Stable key for filtering/selection
  analyte_code: row.analyte_code || null,  // NEW: For translation lookup, null if unmapped
  // ... rest unchanged
}))
```

**Frontend Fallback Logic:**

```javascript
function getDisplayName(param) {
  // If mapped and translation exists, use localized name
  if (param.analyte_code && analyteTranslations[param.analyte_code]) {
    return analyteTranslations[param.analyte_code];
  }
  // Fallback to original OCR parameter name
  return param.parameter_name;
}
```

**Critical: Stable Key for UI State (Filtering, Selection, Comparison)**

The `analyte_id` must be used as the stable identifier for all UI state operations. The localized display name is for presentation only. Use `analyte_code` only for translation lookup.

**Key selection hierarchy:**
1. **`analyte_id`** (preferred) - Unique integer, stable across all operations
2. **`analyte_code`** (for translation) - Human-readable code for looking up translations
3. **`parameter_name`** (fallback) - Only when analyte is unmapped; may have collisions

**Pattern for radio button selectors (e.g., chat.js parameter selector):**

```javascript
// BEFORE (broken with localization):
// radio.value = row.parameter_name;
// selectedParam = event.target.value;
// filteredRows = rows.filter(r => r.parameter_name === selectedParam);

// AFTER (stable key using analyte_id):
radio.value = row.analyte_id || row.parameter_name;  // Stable key (analyte_id preferred)
radio.dataset.analyteCode = row.analyte_code;         // For translation lookup
radio.dataset.parameterName = row.parameter_name;     // Original for hover/tooltip
label.textContent = getDisplayName(row);              // Localized display

// Filtering uses stable key:
const selectedKey = event.target.value;
const filteredRows = rows.filter(r =>
  String(r.analyte_id || r.parameter_name) === selectedKey
);
```

**Note:** Using `analyte_id` (not `analyte_code`) as the stable key prevents collisions. Multiple unmapped parameters with the same `parameter_name` will still collide, but this is acceptable as they represent the same logical analyte.

**Chat Context Exception (Agentic SQL Results):**

The `v_measurements` view does NOT include `analyte_id` (only `analyte_code`). For chat plot/table results from agentic SQL:

```javascript
// Chat context: use analyte_code as stable key (analyte_id unavailable)
radio.value = row.analyte_code || row.parameter_name;
const filteredRows = rows.filter(r =>
  (r.analyte_code || r.parameter_name) === selectedKey
);
```

This is acceptable because:
1. `analyte_code` is stable (codes don't change)
2. Chat results typically have mapped analytes (where `analyte_code` exists)
3. Unmapped parameters fall back to `parameter_name` (same as current behavior)

**Hover/Tooltip for Original Name:**

When displaying localized analyte names, show the original OCR-extracted name on hover:

```javascript
// In parameter table or selector
const cell = document.createElement('td');
cell.textContent = getDisplayName(param);              // Localized display
cell.title = `Original: ${param.parameter_name}`;      // OCR text on hover
```

This ensures:
1. **Filtering works** regardless of UI language (uses stable `analyte_code`)
2. **Display is localized** (uses `getDisplayName()`)
3. **Original data is accessible** (hover shows `parameter_name`)

**Analyte Localization Coverage by View:**

| View | Data Source | Has `analyte_code`? | Localization Strategy |
|------|-------------|---------------------|----------------------|
| **Report Detail** | `reportRetrieval.js` | ✅ Yes (added in v7.0) | Use `analyte_code` for translation lookup |
| **Parameter Table** | `reportRetrieval.js` | ✅ Yes (added in v7.0) | Use `analyte_code` for translation lookup |
| **Chat Plot Results** | Agentic SQL (`v_measurements`) | ⚠️ Optional | Fallback to `parameter_name` if no `analyte_code` |
| **Chat Table Results** | Agentic SQL (dynamic) | ⚠️ Optional | Fallback to `parameter_name` if no `analyte_code` |
| **Reports Browser** | `reportRetrieval.js` | ✅ Yes (added in v7.0) | Use `analyte_code` for translation lookup |

**Handling Agentic SQL Results Without `analyte_code`:**

Custom agentic SQL queries that don't use `v_measurements` may lack `analyte_code` (note: `v_measurements` includes `analyte_code` by default). For these cases:

```javascript
// Fallback pattern for SQL results
function getLocalizedName(row) {
  // If analyte_code present and has translation, use it
  if (row.analyte_code && analyteTranslations[row.analyte_code]) {
    return analyteTranslations[row.analyte_code];
  }
  // Otherwise use original parameter_name (not localized, but functional)
  return row.parameter_name || row.name || 'Unknown';
}
```

**Note:** The `v_measurements` view already includes `analyte_code` (via JOIN to `analytes` table). Agentic SQL queries that use this view will have access to `analyte_code` for localization. Custom queries that don't include this column should fall back to `parameter_name`.

**Recommendation for Agentic SQL Prompts:**

To maximize localization coverage in chat results, consider updating the SQL generation prompt (in `prompts/sql_generator.md` or equivalent) to:
1. Prefer using `v_measurements` over raw `lab_results` when querying analyte data
2. Include `analyte_code` in SELECT lists when the column is available
3. This ensures the frontend can translate analyte names without relying on fallback behavior

---

**New Table: `analyte_translations`**

```sql
CREATE TABLE IF NOT EXISTS analyte_translations (
  analyte_id INT NOT NULL REFERENCES analytes(analyte_id) ON DELETE CASCADE,
  locale TEXT NOT NULL,
  display_name TEXT NOT NULL,
  verified_by TEXT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (analyte_id, locale)
);

COMMENT ON TABLE analyte_translations IS 'Localized display names for analytes. Used for UI presentation only - does not affect OCR matching or source data.';

/**
 * OWNERSHIP CLARIFICATION: analyte_translations vs analyte_aliases
 *
 * - analyte_aliases: Used for OCR MATCHING (fuzzy search to map extracted
 *   parameter_name to canonical analyte_id). Contains variations, misspellings,
 *   abbreviations. Updated by MappingApplier and admin review flows.
 *
 * - analyte_translations: Used for UI DISPLAY only (showing human-readable
 *   names in user's language). Contains curated display names, one per locale.
 *   Initially seeded from aliases, then maintained separately.
 *
 * Post-launch updates:
 * - To fix OCR matching: Update analyte_aliases
 * - To fix display name: Update analyte_translations
 * - Adding new analyte: Add to analytes table, then add aliases + translations
 */

COMMENT ON COLUMN analyte_translations.locale IS 'ISO 639-1 language code (e.g., en, ru)';

COMMENT ON COLUMN analyte_translations.display_name IS 'Human-readable analyte name in the specified locale';

COMMENT ON COLUMN analyte_translations.verified_by IS 'Admin user who verified this translation';

CREATE INDEX IF NOT EXISTS idx_analyte_translations_locale ON analyte_translations(locale);
```

**Data Population Strategy:**

Russian translations are created via a two-step process:

1. **Extract from existing `analyte_aliases`** - Many Russian aliases already exist with `lang='ru'`
2. **LLM generation for gaps** - Missing translations filled via GPT/Claude with medical review

**Generation Script (`scripts/generate_analyte_translations.js`):**

```javascript
/**
 * Generates analyte_translations seed data:
 * 1. Extract Russian display names from analyte_aliases (prefer alias_display over alias)
 * 2. For analytes without Russian alias, use LLM to translate from English canonical name
 * 3. Output SQL seed file for review before applying
 *
 * Usage: node scripts/generate_analyte_translations.js > server/db/seed_analyte_translations.sql
 */

import OpenAI from 'openai';
import { query } from '../server/db/index.js';

const openai = new OpenAI();

async function generateTranslations() {
  // Step 1: Get all analytes with their existing Russian aliases
  const result = await query(`
    SELECT
      a.analyte_id,
      a.code,
      a.name AS english_name,
      (
        SELECT COALESCE(aa.alias_display, aa.alias)
        FROM analyte_aliases aa
        WHERE aa.analyte_id = a.analyte_id AND aa.lang = 'ru'
        ORDER BY aa.confidence DESC, aa.created_at ASC
        LIMIT 1
      ) AS russian_alias
    FROM analytes a
    ORDER BY a.code
  `);

  const translations = [];
  const needsLlm = [];

  for (const row of result.rows) {
    if (row.russian_alias) {
      // Use existing alias as display name
      translations.push({
        code: row.code,
        locale: 'ru',
        display_name: row.russian_alias,
        source: 'alias_extraction'
      });
    } else {
      needsLlm.push(row);
    }
  }

  console.error(`[generate] Found ${translations.length} Russian aliases, ${needsLlm.length} need LLM translation`);

  // Step 2: Batch LLM translation for missing ones
  if (needsLlm.length > 0) {
    const prompt = `Translate these medical analyte names to Russian. Return JSON array with {code, russian_name}.
    Use standard Russian medical terminology. Keep abbreviations where commonly used (e.g., АЛТ, АСТ).

    Analytes to translate:
    ${needsLlm.map(r => `- ${r.code}: ${r.english_name}`).join('\n')}`;

    // Use Responses API per project conventions (CLAUDE.md gotcha #11)
    const response = await openai.responses.parse({
      model: process.env.SQL_GENERATOR_MODEL || 'gpt-4o-mini',
      input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
      text: {
        format: {
          type: 'json_schema',
          name: 'analyte_translations',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              translations: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    code: { type: 'string' },
                    russian_name: { type: 'string' }
                  },
                  required: ['code', 'russian_name'],
                  additionalProperties: false
                }
              }
            },
            required: ['translations'],
            additionalProperties: false
          }
        }
      }
    });

    const llmTranslations = response.output_parsed;

    for (const t of llmTranslations.translations || []) {
      translations.push({
        code: t.code,
        locale: 'ru',
        display_name: t.russian_name,
        source: 'llm_translation'
      });
    }
  }

  // Step 3: Output SQL
  console.log('-- Auto-generated analyte translations');
  console.log(`-- Generated: ${new Date().toISOString()}`);
  console.log('-- Sources: alias_extraction (from analyte_aliases), llm_translation (GPT/Claude)');
  console.log('');
  console.log('-- English translations (from analytes.name)');
  console.log(`INSERT INTO analyte_translations (analyte_id, locale, display_name)
SELECT analyte_id, 'en', name FROM analytes
ON CONFLICT (analyte_id, locale) DO NOTHING;`);
  console.log('');
  console.log('-- Russian translations');

  // Defensive check: only output INSERT if translations exist
  if (translations.length === 0) {
    console.log('-- No Russian translations to seed (empty array)');
  } else {
    console.log('INSERT INTO analyte_translations (analyte_id, locale, display_name) VALUES');
    const values = translations.map(t =>
      `  ((SELECT analyte_id FROM analytes WHERE code = '${t.code}'), 'ru', '${t.display_name.replace(/'/g, "''")}')`
    );
    console.log(values.join(',\n'));
    console.log('ON CONFLICT (analyte_id, locale) DO NOTHING;');
  }
}

generateTranslations().catch(console.error);
```

**Seed File Output (`server/db/seed_analyte_translations.sql`):**

```sql
-- Auto-generated analyte translations
-- Generated: 2026-01-16T12:00:00.000Z
-- Sources: alias_extraction (from analyte_aliases), llm_translation (GPT/Claude)

-- English translations (from analytes.name)
INSERT INTO analyte_translations (analyte_id, locale, display_name)
SELECT analyte_id, 'en', name FROM analytes
ON CONFLICT (analyte_id, locale) DO NOTHING;

-- Russian translations
INSERT INTO analyte_translations (analyte_id, locale, display_name) VALUES
  ((SELECT analyte_id FROM analytes WHERE code = 'ALB'), 'ru', 'Альбумин'),
  ((SELECT analyte_id FROM analytes WHERE code = 'ALT'), 'ru', 'АЛТ (Аланинаминотрансфераза)'),
  ((SELECT analyte_id FROM analytes WHERE code = 'AST'), 'ru', 'АСТ (Аспартатаминотрансфераза)'),
  -- ... (250 analytes total, auto-generated)
ON CONFLICT (analyte_id, locale) DO NOTHING;
```

**Review Process:**
1. Run script to generate SQL
2. Review output for medical accuracy (especially LLM-generated translations)
3. Commit `seed_analyte_translations.sql` to repo
4. Apply via schema.js on boot

**Fallback if LLM Translation Fails:**
If the generation script cannot run (API unavailable, rate limits, etc.):
1. **English-only seed**: Comment out the Russian INSERT block and seed English translations only
2. **Manual CSV import**: Export analytes to CSV, translate manually, convert to SQL INSERT statements
3. **Incremental approach**: Run script with subset of analytes that have existing Russian aliases
The seed file uses `ON CONFLICT DO NOTHING`, so partial seeding is safe and can be supplemented later.

**Boot-time Seeding (add to `server/db/schema.js` in `ensureSchema()`):**

```javascript
// After the existing unit_aliases seeding block (after line 840, before the catch block):

// PRD v7.0: Seed analyte_translations on every boot (idempotent with ON CONFLICT DO NOTHING)
const analyteTranslationsSeedPath = path.join(__dirname, 'seed_analyte_translations.sql');
if (fs.existsSync(analyteTranslationsSeedPath)) {
  try {
    const seedSQL = fs.readFileSync(analyteTranslationsSeedPath, 'utf8');
    await client.query(seedSQL);
    console.log('[db] Analyte translations seeded successfully');
  } catch (seedError) {
    console.warn('[db] Failed to seed analyte_translations:', seedError);
  }
} else {
  console.warn('[db] Analyte translations seed file not found:', analyteTranslationsSeedPath);
}
```

This ensures translations are available on fresh deployments without requiring `resetDatabase()`.

**Note on `resetDatabase()` Behavior:**

The `analyte_translations` table has a foreign key to `analytes` with `ON DELETE CASCADE`. When `resetDatabase()` drops the `analytes` table, the `analyte_translations` table is automatically dropped via CASCADE. Since `resetDatabase()` calls `ensureSchema()` after dropping tables, the new table is recreated and seeded automatically. No explicit changes to `resetDatabase()` are required.

**API Endpoint for Translations:**

**File:** `server/routes/analytes.js`

```javascript
import express from 'express';
import { adminPool } from '../db/index.js';  // Use adminPool for catalog queries (no RLS needed)
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// GET /api/analytes/translations?locale=ru
router.get('/translations', requireAuth, async (req, res) => {
  const { locale = 'en' } = req.query;

  // Validate locale
  const supportedLocales = ['en', 'ru'];
  if (!supportedLocales.includes(locale)) {
    return res.status(400).json({ error: 'UNSUPPORTED_LOCALE' });  // Error code pattern
  }

  try {
    // adminPool used because analytes/translations are global catalog, not user-scoped
    const result = await adminPool.query(`
      SELECT
        a.analyte_id,
        a.code,
        COALESCE(t.display_name, a.name) AS display_name
      FROM analytes a
      LEFT JOIN analyte_translations t
        ON a.analyte_id = t.analyte_id AND t.locale = $1
      ORDER BY a.code
    `, [locale]);

    // Return as a lookup map for efficient frontend access
    const translations = {};
    for (const row of result.rows) {
      translations[row.code] = row.display_name;
    }

    res.json({ locale, translations });
  } catch (error) {
    console.error('[analytes] Failed to fetch translations:', error);
    res.status(500).json({ error: 'FETCH_TRANSLATIONS_FAILED' });
  }
});

export default router;
```

**Frontend Usage:**

```javascript
// Cache translations in memory
let analyteTranslations = {};

async function loadAnalyteTranslations(locale) {
  const response = await fetch(`/api/analytes/translations?locale=${locale}`, {
    credentials: 'include'
  });
  const data = await response.json();
  analyteTranslations = data.translations;
}

function getAnalyteDisplayName(code) {
  return analyteTranslations[code] || code;
}

// Listen for locale changes
window.addEventListener('localeChanged', async (e) => {
  await loadAnalyteTranslations(e.detail.locale);
  // Re-render any visible analyte names
  updateAnalyteDisplayNames();
});
```

---

### 5. LLM Response Language (No Changes Required)

**Approach:** Keep current auto-detect behavior.

The LLM (GPT/Claude) naturally detects and responds in the language the user writes in. This is the existing behavior and requires **no code changes**.

**How it works:**
- User writes in English → LLM responds in English
- User writes in Russian → LLM responds in Russian
- User switches mid-conversation → LLM follows

**Why this is preferred:**
1. **Natural interaction** - Users control language by how they communicate
2. **Simpler implementation** - No locale propagation through session/API
3. **Flexibility** - User can ask in one language about data in another
4. **Already works** - No new code to write or maintain

**What the language switcher affects:**
- Static UI strings (buttons, labels, navigation)
- Error messages (backend codes → frontend translations)
- Date/number formatting
- Analyte display names

**What the language switcher does NOT affect:**
- Chat responses from LLM
- Onboarding insights from LLM
- Any dynamically generated text from AI

This separation provides a clean architecture: i18n handles static content, LLM handles dynamic content with its own language intelligence.

---

### 6. Translation File Examples

**`public/locales/en/common.json`:**

```json
{
  "pageTitle": {
    "index": "HealthUp - Your Health Dashboard",
    "login": "HealthUp - Sign In",
    "landing": "HealthUp - Welcome",
    "admin": "HealthUp - Admin Panel"
  },
  "nav": {
    "assistant": "Assistant",
    "upload": "Upload",
    "uploadLabResults": "Upload Lab Results",
    "reports": "Reports",
    "management": "Management"
  },
  "header": {
    "logout": "Logout"
  },
  "buttons": {
    "send": "Send",
    "cancel": "Cancel",
    "retry": "Try Again",
    "upload": "Upload",
    "viewReport": "View Report",
    "newChat": "New Chat"
  },
  "labels": {
    "patient": "Patient",
    "date": "Date",
    "value": "Value",
    "unit": "Unit",
    "reference": "Reference Range",
    "status": "Status",
    "allPatients": "All Patients",
    "actions": "Actions"
  },
  "status": {
    "processing": "Processing...",
    "completed": "Completed",
    "failed": "Failed",
    "pending": "Pending"
  },
  "admin": {
    "pendingAnalytes": "Pending Analytes",
    "matchReviews": "Match Reviews",
    "approve": "Approve",
    "reject": "Reject",
    "discard": "Discard",
    "noItems": "No items to review",
    "confirmApprove": "Approve this analyte?",
    "confirmReject": "Reject this match?",
    "actionSuccess": "Action completed successfully",
    "actionFailed": "Action failed. Please try again."
  }
}
```

**`public/locales/ru/common.json`:**

```json
{
  "pageTitle": {
    "index": "HealthUp - Панель здоровья",
    "login": "HealthUp - Вход",
    "landing": "HealthUp - Добро пожаловать",
    "admin": "HealthUp - Админ панель"
  },
  "nav": {
    "assistant": "Ассистент",
    "upload": "Загрузка",
    "uploadLabResults": "Загрузка анализов",
    "reports": "Отчёты",
    "management": "Управление"
  },
  "header": {
    "logout": "Выйти"
  },
  "buttons": {
    "send": "Отправить",
    "cancel": "Отмена",
    "retry": "Повторить",
    "upload": "Загрузить",
    "viewReport": "Просмотреть",
    "newChat": "Новый чат"
  },
  "labels": {
    "patient": "Пациент",
    "date": "Дата",
    "value": "Значение",
    "unit": "Единица",
    "reference": "Референсный интервал",
    "status": "Статус",
    "allPatients": "Все пациенты",
    "actions": "Действия"
  },
  "status": {
    "processing": "Обработка...",
    "completed": "Завершено",
    "failed": "Ошибка",
    "pending": "В очереди"
  },
  "admin": {
    "pendingAnalytes": "Ожидающие аналиты",
    "matchReviews": "Проверка соответствий",
    "approve": "Одобрить",
    "reject": "Отклонить",
    "discard": "Удалить",
    "noItems": "Нет элементов для проверки",
    "confirmApprove": "Одобрить этот аналит?",
    "confirmReject": "Отклонить это соответствие?",
    "actionSuccess": "Действие выполнено успешно",
    "actionFailed": "Ошибка. Попробуйте ещё раз."
  }
}
```

**`public/locales/en/errors.json`:**

```json
{
  "network": "Network error. Please check your connection and try again.",
  "timeout": "Request timed out. Please try again.",
  "unauthorized": "Your session has expired. Please log in again.",
  "serverError": "Something went wrong. Please try again later.",
  "validation": {
    "required": "This field is required",
    "invalidFile": "Invalid file type. Supported: PDF, PNG, JPEG, HEIC",
    "fileTooLarge": "File is too large. Maximum size: {{max}}MB"
  },
  "upload": {
    "failed": "Upload failed. Please try again."
  },
  "duplicate": {
    "file": "This file has already been uploaded."
  },
  "ocr": {
    "failed": "Could not extract data from this document."
  },
  "session": {
    "expired": "Chat session expired. Starting a new conversation."
  },
  "send": {
    "failed": "Failed to send message. Please try again."
  }
}
```

**`public/locales/ru/errors.json`:**

```json
{
  "network": "Ошибка сети. Проверьте подключение и попробуйте снова.",
  "timeout": "Время ожидания истекло. Попробуйте ещё раз.",
  "unauthorized": "Сессия истекла. Пожалуйста, войдите снова.",
  "serverError": "Что-то пошло не так. Попробуйте позже.",
  "validation": {
    "required": "Это поле обязательно",
    "invalidFile": "Неверный тип файла. Поддерживаются: PDF, PNG, JPEG, HEIC",
    "fileTooLarge": "Файл слишком большой. Максимум: {{max}}МБ"
  },
  "upload": {
    "failed": "Загрузка не удалась. Попробуйте ещё раз."
  },
  "duplicate": {
    "file": "Этот файл уже был загружен."
  },
  "ocr": {
    "failed": "Не удалось извлечь данные из документа."
  },
  "session": {
    "expired": "Сессия чата истекла. Начинаем новый разговор."
  },
  "send": {
    "failed": "Не удалось отправить сообщение. Попробуйте ещё раз."
  }
}
```

**`public/locales/en/chat.json`:**

```json
{
  "placeholder": "Ask about your health data...",
  "send": "Send",
  "newChat": "New Chat",
  "thinking": "Thinking...",
  "searching": "Searching...",
  "executing": "Running query...",
  "connectionLost": "Connection lost. Reconnecting...",
  "reconnected": "Reconnected",
  "toolIndicators": {
    "fuzzySearch": "Searching parameters...",
    "executeSQL": "Executing query...",
    "schemaLookup": "Looking up schema..."
  },
  "resultsFound_one": "Found {{count}} result",
  "resultsFound_other": "Found {{count}} results",
  "noResults": "No results found",
  "plotGenerated": "Plot generated",
  "copySQL": "Copy SQL",
  "sqlCopied": "SQL copied to clipboard",
  "viewDetails": "View Details",
  "parameterSelector": {
    "title": "Select Parameter",
    "description": "Choose which parameter to plot"
  }
}
```

**`public/locales/ru/chat.json`:**

```json
{
  "placeholder": "Спросите о ваших данных здоровья...",
  "send": "Отправить",
  "newChat": "Новый чат",
  "thinking": "Думаю...",
  "searching": "Ищу...",
  "executing": "Выполняю запрос...",
  "connectionLost": "Соединение потеряно. Переподключение...",
  "reconnected": "Подключено",
  "toolIndicators": {
    "fuzzySearch": "Поиск параметров...",
    "executeSQL": "Выполнение запроса...",
    "schemaLookup": "Поиск в схеме..."
  },
  "resultsFound_one": "Найден {{count}} результат",
  "resultsFound_few": "Найдено {{count}} результата",
  "resultsFound_many": "Найдено {{count}} результатов",
  "noResults": "Результаты не найдены",
  "plotGenerated": "График построен",
  "copySQL": "Копировать SQL",
  "sqlCopied": "SQL скопирован",
  "viewDetails": "Подробнее",
  "parameterSelector": {
    "title": "Выберите параметр",
    "description": "Выберите параметр для графика"
  }
}
```

**`public/locales/en/upload.json`:**

```json
{
  "title": "Upload Lab Reports",
  "dragDrop": "Drag and drop files here",
  "or": "or",
  "browseFiles": "Browse Files",
  "supportedFormats": "Supported: PDF, PNG, JPEG, HEIC",
  "maxSize": "Max {{size}}MB per file",
  "maxFiles": "Up to {{count}} files",
  "queue": {
    "title": "Upload Queue",
    "filename": "Filename",
    "size": "Size",
    "type": "Type",
    "status": "Status",
    "actions": "Actions"
  },
  "status": {
    "queued": "Queued",
    "uploading": "Uploading...",
    "processing": "Processing...",
    "completed": "Completed",
    "failed": "Failed",
    "duplicate": "Duplicate"
  },
  "filesCount_one": "{{count}} file",
  "filesCount_other": "{{count}} files",
  "gmail": {
    "importButton": "Import from Gmail",
    "connecting": "Connecting to Gmail...",
    "fetchingEmails": "Fetching emails...",
    "classifying": "Classifying emails...",
    "selectAttachments": "Select Attachments",
    "noLabReports": "No lab reports found in your emails",
    "alreadyImported": "Already imported",
    "importSelected": "Import Selected",
    "progressStep1": "Fetching emails",
    "progressStep2": "Classifying content"
  },
  "results": {
    "title": "Results",
    "viewReport": "View",
    "success": "Successfully processed",
    "error": "Error processing file"
  },
  "clear": "Clear",
  "uploadAll": "Upload All"
}
```

**`public/locales/ru/upload.json`:**

```json
{
  "title": "Загрузка анализов",
  "dragDrop": "Перетащите файлы сюда",
  "or": "или",
  "browseFiles": "Выбрать файлы",
  "supportedFormats": "Поддерживаются: PDF, PNG, JPEG, HEIC",
  "maxSize": "Максимум {{size}}МБ на файл",
  "maxFiles": "До {{count}} файлов",
  "queue": {
    "title": "Очередь загрузки",
    "filename": "Имя файла",
    "size": "Размер",
    "type": "Тип",
    "status": "Статус",
    "actions": "Действия"
  },
  "status": {
    "queued": "В очереди",
    "uploading": "Загрузка...",
    "processing": "Обработка...",
    "completed": "Готово",
    "failed": "Ошибка",
    "duplicate": "Дубликат"
  },
  "filesCount_one": "{{count}} файл",
  "filesCount_few": "{{count}} файла",
  "filesCount_many": "{{count}} файлов",
  "gmail": {
    "importButton": "Импорт из Gmail",
    "connecting": "Подключение к Gmail...",
    "fetchingEmails": "Получение писем...",
    "classifying": "Классификация писем...",
    "selectAttachments": "Выбор вложений",
    "noLabReports": "Анализы не найдены в ваших письмах",
    "alreadyImported": "Уже импортировано",
    "importSelected": "Импортировать выбранные",
    "progressStep1": "Получение писем",
    "progressStep2": "Классификация"
  },
  "results": {
    "title": "Результаты",
    "viewReport": "Открыть",
    "success": "Успешно обработано",
    "error": "Ошибка обработки"
  },
  "clear": "Очистить",
  "uploadAll": "Загрузить все"
}
```

**`public/locales/en/onboarding.json`:**

```json
{
  "welcome": {
    "title": "Welcome to HealthUp",
    "subtitle": "Your personal health data assistant",
    "getStarted": "Get Started"
  },
  "steps": {
    "upload": {
      "title": "Upload Your First Lab Report",
      "description": "Start by uploading a lab report (PDF or image). We'll extract and analyze your health data."
    },
    "insight": {
      "title": "Get Personalized Insights",
      "description": "Our AI will analyze your results and provide helpful context about your health markers."
    },
    "chat": {
      "title": "Ask Questions",
      "description": "Chat with our AI assistant to understand your health data better."
    }
  },
  "firstUpload": {
    "title": "Let's Start with Your First Report",
    "instruction": "Upload a lab report to begin",
    "processing": "Analyzing your report...",
    "success": "Great! We've processed your report."
  },
  "insight": {
    "generating": "Generating your personalized insight...",
    "title": "Your Health Summary",
    "continueToChat": "Continue to Chat"
  },
  "login": {
    "title": "Sign in to continue",
    "subtitle": "Your data is private and secure"
  }
}
```

**`public/locales/ru/onboarding.json`:**

```json
{
  "welcome": {
    "title": "Добро пожаловать в HealthUp",
    "subtitle": "Ваш персональный помощник по здоровью",
    "getStarted": "Начать"
  },
  "steps": {
    "upload": {
      "title": "Загрузите ваш первый анализ",
      "description": "Начните с загрузки анализа (PDF или изображение). Мы извлечём и проанализируем ваши данные."
    },
    "insight": {
      "title": "Получите персональные выводы",
      "description": "Наш ИИ проанализирует результаты и предоставит полезный контекст о ваших показателях."
    },
    "chat": {
      "title": "Задавайте вопросы",
      "description": "Общайтесь с ИИ-ассистентом, чтобы лучше понять ваши данные о здоровье."
    }
  },
  "firstUpload": {
    "title": "Начнём с вашего первого анализа",
    "instruction": "Загрузите анализ для начала",
    "processing": "Анализируем ваш отчёт...",
    "success": "Отлично! Ваш анализ обработан."
  },
  "insight": {
    "generating": "Создаём персональный анализ...",
    "title": "Ваше резюме здоровья",
    "continueToChat": "Перейти к чату"
  },
  "login": {
    "title": "Войдите для продолжения",
    "subtitle": "Ваши данные защищены"
  }
}
```

---

### 7. Backend Error Code Pattern

**MVP Scope: Incremental Migration**

Currently, most backend routes return literal English error strings (e.g., `{ error: 'Invalid patient id' }`). Full migration to error codes is **NOT required for MVP**. Instead:

1. **New code** (e.g., `/api/analytes/translations`) uses error codes from the start
2. **Critical user-facing flows** (upload, chat, auth) are migrated in Phase 2
3. **Other routes** continue returning English strings until future refactor

**Target Pattern (for new/migrated routes):**

**Backend Response (new format with explicit `error_code`):**
```json
{
  "error_code": "UPLOAD_FAILED",
  "error": "Upload failed",
  "details": { "filename": "report.pdf" }
}
```

**Backend Response (legacy format, unchanged):**
```json
{
  "error": "Invalid patient id"
}
```

**Frontend Translation:**
```javascript
function translateError(response) {
  // New format: explicit error_code field (preferred)
  if (response.error_code) {
    const key = `errors:${response.error_code.toLowerCase().replace(/_/g, '.')}`;
    return i18next.t(key, response.details || {});
  }

  // Legacy format - return as-is (English string)
  // Non-MVP routes still return English strings without error_code
  return response.error || i18next.t('errors:serverError');
}
```

**Why explicit `error_code`:** The previous approach (detecting uppercase strings) was brittle because existing backend responses include mixed-case strings and some uppercase words. Using an explicit `error_code` field eliminates ambiguity and allows gradual migration.

**MVP Error Codes (Phase 2 migration):**

| Route | Backend Code | i18n Key (via transformation) |
|-------|--------------|-------------------------------|
| `/api/analyze-labs/*` | `UPLOAD_FAILED` | `errors:upload.failed` |
| `/api/analyze-labs/*` | `DUPLICATE_FILE` | `errors:duplicate.file` |
| `/api/analyze-labs/*` | `OCR_FAILED` | `errors:ocr.failed` |
| `/api/chat/*` | `SESSION_EXPIRED` | `errors:session.expired` |
| `/api/chat/*` | `SEND_FAILED` | `errors:send.failed` |
| `/api/auth/*` | `UNAUTHORIZED` | `errors:unauthorized` |

**Note:** The transformation `error_code.toLowerCase().replace(/_/g, '.')` converts `DUPLICATE_FILE` → `duplicate.file`. The `errors.json` keys must match these transformed values.

**Non-MVP routes** (reports, admin, gmail) keep English errors until future refactor.

---

## File Changes Summary

### New Files

| File | Purpose |
|------|---------|
| `public/js/i18n.js` | i18next initialization and helpers |
| `public/js/language-switcher.js` | Language dropdown component |
| `public/js/formatters.js` | Date/number formatting helpers |
| `public/css/language-switcher.css` | Switcher styles |
| `public/locales/en/*.json` | English translations (5 files) |
| `public/locales/ru/*.json` | Russian translations (5 files) |
| `server/db/seed_analyte_translations.sql` | Analyte translations seed data |
| `server/routes/analytes.js` | Analyte translations API |
| `scripts/generate_analyte_translations.js` | Script to extract/generate translations |

### Modified Files

| File | Change |
|------|--------|
| `server/db/schema.js` | Add `analyte_translations` table |
| `config/schema_aliases.json` | Add entries: `"translation": ["analyte_translations"], "localization": ["analyte_translations"], "display_name": ["analyte_translations"]` |
| `server/app.js` | Register `/api/analytes` routes (see code below) |
| `server/services/reportRetrieval.js` | Add `analyte_code` to lab results response |
| `public/index.html` | Add CDN scripts, language switcher, `data-i18n` attributes |
| `public/landing.html` | Add CDN scripts, language switcher, `data-i18n` attributes |
| `public/login.html` | Add CDN scripts, language switcher, `data-i18n` attributes |
| `public/admin.html` | Add CDN scripts, language switcher, `data-i18n` attributes |
| `public/js/app.js` | Wait for i18nReady, use formatters, extract dynamic strings |
| `public/js/chat.js` | Use i18next for status messages, error translations |
| `public/js/landing.js` | Use i18next for UI strings; **replace existing `FALLBACK_MESSAGES` locale detection** with `i18nHelpers.getCurrentLocale()` to avoid duplicate locale logic |
| `public/js/unified-upload.js` | Use error translations, extract validation messages |
| `public/js/admin.js` | Extract dynamic strings (toasts, status messages) |
| `public/js/login.js` | Use i18next for login form labels, error messages |
| `public/js/reports-browser.js` | Use i18next for report list UI strings |
| `public/js/onboarding-redirect.js` | Use i18next for redirect messages |
| `CLAUDE.md` | Document localization feature |

**Note:** No changes required to `agenticCore.js`, `chatStream.js`, or `onboarding.js` since LLM auto-detects language from user input.

**Route Registration in `server/app.js`:**

```javascript
// Add import (after other router imports, around line 21)
import analytesRouter from './routes/analytes.js';

// Add route registration (after onboarding routes, around line 188)
app.use('/api/analytes', analytesRouter);
```

---

## Implementation Phases

### Phase 1: i18next Setup & Language Switcher
- Add CDN script tags to all HTML files (order: after vendors, before app scripts)
- Create `i18n.js` initialization with `window.i18nReady` promise
- Add language switcher dropdown to header
- Create initial translation files (common.json, errors.json)
- **Critical**: Each page must `await window.i18nReady` before any DOM rendering
- Test: Language switching works, persists to localStorage

**Script Loading Order (all HTML files):**
```html
<!-- Existing vendors (Chart.js, marked, etc.) -->
<script src="cdn.../i18next.min.js" defer></script>
<script src="cdn.../i18nextHttpBackend.min.js" defer></script>
<script src="cdn.../i18nextBrowserLanguageDetector.min.js" defer></script>
<script src="js/i18n.js" defer></script>
<script src="js/formatters.js" defer></script>
<script src="js/language-switcher.js" defer></script>
<!-- Then auth.js (if applicable) and app scripts -->
```

**Init Pattern for Each Page:**
- `index.html`: `await window.i18nReady` → `await window.authReady` → app init
- `login.html`: `await window.i18nReady` → login init (no auth)
- `landing.html`: `await window.i18nReady` → landing init (auth optional)
- `admin.html`: `await window.i18nReady` → `await window.authReady` → admin init

**Init Order Checklist (Required Updates):**

| File | Current Behavior | Required Change |
|------|-----------------|-----------------|
| `public/js/app.js` | Runs after `authReady` | Add `await window.i18nReady` before auth init |
| `public/js/landing.js` | Uses `navigator.language` directly (line 461) | Must use `window.i18nHelpers.getCurrentLocale()` instead |
| `public/js/reports-browser.js` | Runs after `authReady` | Add `await window.i18nReady` before rendering |
| `public/js/chat.js` | Initializes on DOMContentLoaded | Add `await window.i18nReady` in `init()` method |
| `public/js/admin.js` | Runs after `authReady` | Add `await window.i18nReady` before table rendering |
| `public/js/unified-upload.js` | Module pattern, no explicit init | Ensure `i18next.t()` is ready before error messages |
| `public/index.html` inline script | Runs on DOMContentLoaded (sectionTitles) | Wrap in `await window.i18nReady` (see Appendix A) |
| `public/admin.html` inline script | May have hardcoded strings | Extract to i18next or wrap in `i18nReady` |

**Critical Note for `landing.js`:** The `displayFallbackInsight()` function currently detects locale via `navigator.language` (line 461), which ignores the user's localStorage preference set by the language switcher. This must be updated to call `window.i18nHelpers.getCurrentLocale()` to respect the PRD's locale hierarchy (localStorage > browser).

**Loading State Handling:**
To avoid showing untranslated text during i18n initialization, pages should either:
1. Use CSS to hide content until i18n is ready (e.g., `.i18n-loading { visibility: hidden }`)
2. Keep initial HTML in English and let i18n update it (acceptable flash of English text)

For the login page specifically, the Google Sign-In button will render independently of i18n (see Out of Scope section), so brief English display is expected and acceptable.

### Phase 2: UI String Extraction
- Audit all HTML files for hardcoded strings, **including inline `<script>` blocks** (e.g., navigation titles, progress step labels)
- Add `data-i18n` attributes to static elements
- Add `data-i18n-page` attribute to `<body>` for per-page title keys:

  | Page | `data-i18n-page` value | Title Key |
  |------|----------------------|-----------|
  | `index.html` | `index` | `pages.index.title` |
  | `login.html` | `login` | `pages.login.title` |
  | `landing.html` | `landing` | `pages.landing.title` |
  | `admin.html` | `admin` | `pages.admin.title` |
- Extract dynamic strings from JS files:
  - `chat.js`: Status messages ("Thinking...", "Connection lost...")
  - `unified-upload.js`: Validation errors, progress messages
  - `app.js`: Status labels, error messages
  - `admin.js`: Toast notifications, action confirmations
- Add Russian pluralization rules where needed (`_one`, `_few`, `_many`)
- Migrate critical error responses to error codes (upload, chat, auth routes)
- Complete translation files for all namespaces
- Test: All UI strings update when language changes

### Phase 3: Date/Number Formatting
- Create `formatters.js` module (IIFE pattern, exposes `window.formatters`)
- Replace all date/number formatting calls with localized versions
- Test: Dates show as `16.01.2026` in Russian, `01/16/2026` in English

### Phase 4: Analyte Translations
- Add `analyte_translations` table to schema
- Modify `reportRetrieval.js` to include `analyte_code` in response
- Run `scripts/generate_analyte_translations.js` to extract from aliases + LLM
- Review generated SQL for medical accuracy
- Implement `/api/analytes/translations` endpoint
- Update frontend to fetch and cache translations
- Test: Analyte names display in selected language

### Phase 5: Final Testing & Polish
- Full QA pass in both languages
- Fix any missed strings or formatting issues
- Update CLAUDE.md documentation
- Deploy to staging for validation

**Note:** No LLM localization phase needed - auto-detect behavior is preserved.

---

### Locale Change Re-render Contract

When the user changes language via the dropdown, different parts of the UI have different update strategies:

**Static Elements (Immediate Update via `updatePageTranslations()`):**
- All elements with `[data-i18n]` attributes
- Page title
- Form placeholders

**Dynamic Views (Event-Driven Re-render):**

Each major view listens for `localeChanged` event and handles re-rendering:

| View | File | Strategy | Implementation |
|------|------|----------|----------------|
| **Chat history** | `chat.js` | Re-render existing messages | Messages already in DOM stay as-is (LLM content doesn't change). Only UI chrome (timestamps, status labels) updates. |
| **Upload queue** | `unified-upload.js` | Update status labels | Progress table rows update status text via `i18next.t()`. File names stay as-is. |
| **Upload results** | `unified-upload.js` | Update status badges | Existing results update badge text. New uploads use current locale. |
| **Admin tables** | `admin.js` | Re-fetch and re-render | Pending analytes and match reviews tables re-render with translated action buttons. |
| **Report detail** | `app.js` | Update analyte names | Fetch new analyte translations, update display names in parameter table. |
| **Plot tooltips (dates)** | `plotRenderer.js` | No re-render needed | Date formatting in tooltips uses `Intl.DateTimeFormat` with current locale. Axis labels and units remain in English (universal). |

**Implementation Pattern for Dynamic Views:**

```javascript
// In each view's init function
window.addEventListener('localeChanged', async (e) => {
  const newLocale = e.detail.locale;

  // Update any cached translations
  await loadAnalyteTranslations(newLocale);

  // Re-render locale-sensitive parts
  updateStatusLabels();  // Update status text in tables
  updateDateFormats();   // Re-format visible dates
});
```

**What Does NOT Re-render:**
- Chat message content (LLM-generated text stays in its original language)
- File names (original filenames preserved)
- OCR-extracted parameter names (source data unchanged)
- Chart data points (only formatting/tooltips affected)

---

## Acceptance Criteria

### Language Switcher
- [ ] Dropdown visible in header on all pages
- [ ] Shows "English" / "Русский" options
- [ ] Selection persists across page refreshes (localStorage)
- [ ] Page updates immediately without full reload

### UI Translations
- [ ] All buttons, labels, navigation items translated
- [ ] Error messages from MVP routes (upload, chat, auth) translated
- [ ] All status messages translated
- [ ] Form validation messages translated
- [ ] Placeholders translated

### Date/Number Formatting
- [ ] Dates display in locale-appropriate format
- [ ] Numbers display with correct thousand/decimal separators
- [ ] Relative dates ("2 days ago") work in both languages

### Analyte Names
- [ ] Analyte names display in selected language
- [ ] Missing translations fall back to English
- [ ] Original OCR data is NOT modified
- [ ] Translation lookup is efficient (cached)

### LLM Responses (No Change)
- [ ] Chat responses auto-detect language from user's message (existing behavior)
- [ ] Onboarding insights auto-detect language from lab data (existing behavior)
- [ ] No forced locale override applied to LLM prompts

### Error Handling (MVP Scope)
- [ ] New routes (`/api/analytes/*`) return `error_code` field
- [ ] MVP routes (upload, chat, auth) migrated to `error_code` pattern (v7.0 Phase 2)
- [ ] Non-MVP routes continue returning English strings (deferred to future refactor)
- [ ] Frontend `translateError()` handles both `error_code` and legacy formats
- [ ] Unsupported locales fall back to English gracefully

---

## Security Considerations

1. **XSS Prevention via textContent**: For simple text updates (labels, buttons, status messages), always use `element.textContent = i18next.t(key)`. This is safe because textContent cannot execute scripts.

2. **Safe Templating with innerHTML**: Some existing code uses `innerHTML` for complex UI (e.g., building table rows in `admin.js`, chat messages in `chat.js`). For these cases:
   - **Allowed**: Interpolating translated strings into HTML templates when the translation contains NO user input
   - **Example (safe)**: `` `<span class="status">${i18next.t('status.processing')}</span>` ``
   - **Forbidden**: Interpolating user data into translations without escaping
   - **Example (unsafe)**: `` `<span>${i18next.t('greeting', { name: userInput })}</span>` `` (if `greeting` is `"Hello, {{name}}"`)

   For interpolated values that could contain user input, use `escapeValue: true` (i18next default) or sanitize with DOMPurify.

3. **Translation Validation**: Seed files are developer-controlled, no user input in translation sources
4. **No Sensitive Data**: Translations contain only UI strings, no personal data
5. **Fallback Safety**: Missing translations fall back to English, never to empty strings

---

## Performance Considerations

1. **Lazy Loading**: Translation files loaded on-demand per namespace
2. **Caching**: Analyte translations cached in memory after first fetch
3. **Bundle Size**: i18next browser bundle ~13KB gzipped
4. **No Server Load**: Language preference stored client-side (localStorage)

---

## Scope Clarifications

**Q: Is `admin.html` localization in MVP scope?**

**A: Yes, but with limited scope.** Admin panel localization includes:
- Navigation and header elements
- Action buttons ("Approve", "Reject", "Discard")
- Table headers ("Pending Analytes", "Match Reviews")
- Toast notifications and confirmation dialogs

Admin panel does NOT require localized:
- Analyte names/codes (displayed as-is from database)
- Log entries and timestamps (technical data)
- Error details in admin context (developer-facing)

See `common.json` translation examples above for the `admin.*` namespace keys.

**Q: Should `<input type="date">` match app locale?**

**A: Accept browser behavior.** The HTML5 date input is localized by the browser based on system settings. Overriding this would require a custom date picker component, which is out of scope for MVP. The `Intl.DateTimeFormat` is used for displaying dates in the UI, not for input controls.

**Q: Gmail import status messages - are they in scope?**

**A: Yes.** Gmail import is a core upload flow. All status messages are included in `upload.json` under the `gmail.*` namespace (see translation file examples above).

**Q: Should Chart.js date axis labels be localized?**

**A: Only tooltips, not axis labels.** Chart axis labels use short date formats that are generally universal. Tooltips (which show full dates on hover) use `Intl.DateTimeFormat` for localization. This is consistent with the "Out of Scope" statement that axis labels remain English/universal.

---

## Out of Scope (v7.0)

- Server-side language persistence (user preference in database)
- More than 2 languages (English + Russian only)
- RTL language support
- Translation management UI for admins
- Forcing LLM to respond in specific language (use auto-detect)
- Gender-specific translations (Russian has grammatical gender but not needed for UI strings)
- Chart.js axis labels and unit strings (use English/universal; date formatting in tooltips IS localized via Intl API)
- **Google Sign-In button localization**: The Google Sign-In button text is rendered by Google's Identity Services (GSI) SDK and cannot be controlled via i18next. The button will display in the language determined by Google (typically based on user's Google account or browser locale). To fully localize this button would require replacing it with a custom button and implementing manual OAuth flow, which is out of scope for v7.0.

---

## Future Considerations (Post-MVP)

1. **Ukrainian Language**: Add 'uk' locale after Russian is stable
2. **Translation Management**: Admin UI to edit translations without code deploy
3. **User Preference Sync**: Store locale in users table for cross-device sync
4. **Automatic Detection**: Use `Accept-Language` header as additional fallback
5. **Analytics**: Track which languages users prefer for prioritization
6. **CSP Allowlist for CDN**: Currently CSP is disabled in `server/app.js`. If CSP is enabled in the future, add `cdn.jsdelivr.net` to `script-src` directive to allow i18next CDN loading. Alternative: bundle i18next locally to avoid CDN dependency.
7. **HTML lang Attribute**: Update `<html lang="en">` to match selected locale on change for better accessibility and browser defaults.
8. **Cross-Tab Sync**: Add `storage` event listener to sync language preference across browser tabs when localStorage changes.
9. **Missing Translation Logger**: Enable i18next's `saveMissing` option in development to log missing translation keys for QA.

---

## Appendix A: Inline Script String Extraction

**Problem:** `index.html` contains an inline `<script>` block (lines ~394-516) with hardcoded strings that need localization, including the `sectionTitles` object used for navigation.

**Current Code (index.html inline script, lines 406-410):**
```javascript
const sectionTitles = {
  'upload': 'Upload Lab Reports',
  'assistant': 'Health Assistant',
  'reports': 'Reports'
};
```

**Migration Strategy: Read from i18next**

Rather than moving these strings to a separate file, the inline script should read from i18next after initialization:

```javascript
// After i18nReady, build sectionTitles from translations
let sectionTitles = {};

async function initSectionTitles() {
  await window.i18nReady;
  sectionTitles = {
    'upload': i18next.t('nav.uploadLabResults'),
    'assistant': i18next.t('nav.assistant'),
    'reports': i18next.t('nav.reports')
  };
}

// Re-build on locale change
window.addEventListener('localeChanged', () => {
  sectionTitles = {
    'upload': i18next.t('nav.uploadLabResults'),
    'assistant': i18next.t('nav.assistant'),
    'reports': i18next.t('nav.reports')
  };
  // Update any visible section headers
  updateSectionHeaders();
});
```

**Required Translation Keys (add to common.json):**

```json
{
  "nav": {
    "uploadLabResults": "Upload Lab Reports",
    "assistant": "Health Assistant",
    "reports": "Reports"
  }
}
```

**Note:** These keys align with the existing `nav` structure in `common.json` (`nav.uploadLabResults`, `nav.assistant`, `nav.reports`).

**Other Inline Strings to Extract:**

| Location | String | Translation Key |
|----------|--------|-----------------|
| Progress steps | "Uploading", "Processing", etc. | `upload:status.*` |
| Navigation tabs | Tab labels | `nav.*` |
| Status indicators | "Loading...", "Error" | `common:status.*` |

**Implementation Notes:**
- The inline script MUST wait for `window.i18nReady` before accessing `i18next.t()`
- Strings used before i18n is ready should have English fallbacks
- Consider moving large inline scripts to separate `.js` files for maintainability

---

## Appendix B: Migration Guide for Existing Code

### Adding `data-i18n` to HTML

**Before:**
```html
<button class="btn-primary">Upload</button>
```

**After:**
```html
<!-- Uses default namespace 'common', equivalent to data-i18n="common:buttons.upload" -->
<button class="btn-primary" data-i18n="buttons.upload">Upload</button>
```

### Updating JavaScript Strings

**Before:**
```javascript
showError('Upload failed. Please try again.');
```

**After:**
```javascript
// i18next available globally via CDN
showError(i18next.t('errors:upload.failed'));
```

### Updating Date Displays

**Before:**
```javascript
const dateStr = new Date(report.test_date).toLocaleDateString();
```

**After:**
```javascript
// formatters.js loaded via <script> tag
const dateStr = formatDate(report.test_date);
```

### Waiting for i18n Initialization

**Pattern (similar to authReady):**
```javascript
// In app initialization
(async () => {
  await window.i18nReady;  // Wait for i18next to load translations
  await window.authReady;  // Wait for auth check

  // Now safe to use i18next.t() and render UI
  initApp();
})();
```

---

**End of PRD v7.0**
