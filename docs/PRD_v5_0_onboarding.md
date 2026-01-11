# PRD v5.0: First-Time User Onboarding

## Overview

A dedicated onboarding experience for first-time users that guides them from upload to their first meaningful insight, then seamlessly transitions them to the main application with a pre-filled chat query.

**Goal:** Get users to their first "Aha!" moment in under 3 minutes: "I uploaded my lab report and got personalized insights without doing anything."

**Design Philosophy:** Calming, simple, modern. The experience should feel like something subtly magical is happening - the AI understands your health data and speaks to you about it - without being whimsical or fairy-tale-ish. Consistent with the existing "Serene Health Studio" design system.

---

## User Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           DECISION POINT                                 │
│                                                                          │
│   User visits app → Check: patients.length === 0 AND reports.length === 0│
│                                                                          │
│         YES (new user)              NO (has data)                        │
│              ↓                           ↓                               │
│       landing.html                  index.html                           │
│                                    (existing app)                        │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                         LANDING.HTML FLOW                                │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  STEP 1: Welcome State                                            │   │
│  │                                                                   │   │
│  │     [Centered, minimal layout]                                    │   │
│  │                                                                   │   │
│  │     Your labs, explained.                                         │   │
│  │                                                                   │   │
│  │     Upload a lab report and get instant,                          │   │
│  │     personalized insights powered by AI.                          │   │
│  │                                                                   │   │
│  │     ┌─────────────────────────────────────┐                       │   │
│  │     │  📄 Upload Lab Report               │  ← Primary CTA        │   │
│  │     │     PDF, PNG, JPEG, HEIC            │                       │   │
│  │     └─────────────────────────────────────┘                       │   │
│  │                                                                   │   │
│  │     Drop files here or click to browse                            │   │
│  │                                                                   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                              ↓ (user uploads file(s))                    │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  STEP 2: Processing State                                         │   │
│  │                                                                   │   │
│  │     [Same centered layout, content changes]                       │   │
│  │                                                                   │   │
│  │     Analyzing your report...                                      │   │
│  │                                                                   │   │
│  │     ┌─────────────────────────────────────┐                       │   │
│  │     │  ████████████░░░░░░░░  Processing   │  ← Progress bar       │   │
│  │     │  lipid_panel.pdf                    │                       │   │
│  │     └─────────────────────────────────────┘                       │   │
│  │                                                                   │   │
│  │     Extracting health markers...                                  │   │
│  │                                                                   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                              ↓ (OCR completes)                           │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  STEP 3: Generating Insight State                                 │   │
│  │                                                                   │   │
│  │     [Subtle transition, same layout]                              │   │
│  │                                                                   │   │
│  │     ✓ 23 health markers extracted                                 │   │
│  │                                                                   │   │
│  │     Preparing your personalized insights...                       │   │
│  │                                                                   │   │
│  │     [Subtle pulsing indicator]                                    │   │
│  │                                                                   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                              ↓ (insight generated)                       │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  STEP 4: Insight State                                            │   │
│  │                                                                   │   │
│  │     ┌─────────────────────────────────────────────────────────┐   │   │
│  │     │                                                         │   │   │
│  │     │  💡 Your Results at a Glance                            │   │   │
│  │     │                                                         │   │   │
│  │     │  You uploaded 2 reports spanning 3 months. Your LDL     │   │   │
│  │     │  cholesterol (145 mg/dL) is above the optimal range.    │   │   │
│  │     │  The good news: your HDL, triglycerides, and glucose    │   │   │
│  │     │  are all within healthy limits.                         │   │   │
│  │     │                                                         │   │   │
│  │     │  To maintain these positive markers, focus on regular   │   │   │
│  │     │  physical activity and a balanced diet rich in fiber.   │   │   │
│  │     │  Upload more reports as they come to track your         │   │   │
│  │     │  progress over time.                                    │   │   │
│  │     │                                                         │   │   │
│  │     └─────────────────────────────────────────────────────────┘   │   │
│  │                                                                   │   │
│  │     What would you like to know?                                  │   │
│  │                                                                   │   │
│  │     ┌─────────────────┐  ┌─────────────────┐                      │   │
│  │     │ Explain my LDL  │  │ Health tips     │  ← Dynamic from LLM  │   │
│  │     └─────────────────┘  └─────────────────┘                      │   │
│  │     ┌─────────────────┐  ┌─────────────────┐                      │   │
│  │     │ Compare results │  │ Full summary    │                      │   │
│  │     └─────────────────┘  └─────────────────┘                      │   │
│  │                                                                   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                              ↓ (user clicks suggestion)                  │
│                                                                          │
│   sessionStorage.setItem('onboarding_context', JSON.stringify({...}))    │
│   window.location.href = '/index.html#assistant'                                   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                      INDEX.HTML (on load from onboarding)                │
│                                                                          │
│   1. Detect sessionStorage.onboarding_context                            │
│   2. Create chat session with patient_id + initial_context               │
│   3. Seed conversation with system context (the insight)                 │
│   4. Wait for SSE session_start event                                    │
│   5. Auto-submit the selected_query message                              │
│   6. Clear sessionStorage.onboarding_context                             │
│   7. User sees streaming response to their question                      │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Technical Specification

### 1. New User Detection

**Endpoint:** `GET /api/onboarding/status`

**File:** `server/routes/onboarding.js`

```javascript
// GET /api/onboarding/status
// Uses efficient COUNT queries (not full list fetch)
// Response:
{
  is_new_user: boolean,  // true if patient_count === 0 AND report_count === 0
  patient_count: number,
  report_count: number
}
```

**Implementation:**

```javascript
import { queryWithUser } from '../db/index.js';

router.get('/status', requireAuth, async (req, res) => {
  const patientResult = await queryWithUser(
    'SELECT COUNT(*) as count FROM patients',
    [],
    req.user.id
  );
  const reportResult = await queryWithUser(
    'SELECT COUNT(*) as count FROM patient_reports WHERE status = $1',
    ['completed'],
    req.user.id
  );

  const patient_count = parseInt(patientResult.rows[0].count, 10);
  const report_count = parseInt(reportResult.rows[0].count, 10);

  res.json({
    is_new_user: patient_count === 0 && report_count === 0,
    patient_count,
    report_count
  });
});
```

**Frontend Logic (in auth callback or app initialization):**

```javascript
// IMPORTANT: Must wait for auth before API calls
await window.authReady;

try {
  const response = await fetch('/api/onboarding/status', {
    credentials: 'include'
  });

  // Handle HTTP errors explicitly
  if (!response.ok) {
    console.error('[Onboarding] Status check failed:', response.status);
    // On error, stay on current page to avoid redirect loops
    // Treat as "existing user" - they can manually navigate if needed
    return;
  }

  const status = await response.json();

  if (status.is_new_user && window.location.pathname !== '/landing.html') {
    window.location.href = '/landing.html';
  } else if (!status.is_new_user && window.location.pathname === '/landing.html') {
    window.location.href = '/index.html#assistant';
  }
} catch (error) {
  // Network errors, JSON parse errors, etc.
  console.error('[Onboarding] Status check error:', error);
  // CRITICAL: Do NOT redirect on error - stay on current page
  // This prevents redirect loops when the API is unavailable
  // User can refresh manually or continue with current page
}
```

**Error Handling Strategy:**
- On fetch error (network, 401, 500, etc.): Stay on current page, log error
- Never redirect on error to prevent loops (`/index.html` → `/landing.html` → `/index.html`)
- Treat errors as "existing user" - safer default (won't force new users into landing, but avoids broken loops)
- User can manually navigate or refresh if needed

**File Ownership for Redirect Logic:**
The onboarding status check and redirect logic should be placed in a new file `public/js/onboarding-redirect.js`
that is loaded AFTER `auth.js` but BEFORE `app.js` or `landing.js`. This ensures:
1. Auth is complete before status check (`await window.authReady`)
2. Redirect happens before main app initialization (no flash of wrong page)
3. Clear separation of concerns from auth and app logic

Include in both pages:
```html
<script src="/js/auth.js"></script>
<script src="/js/onboarding-redirect.js"></script>  <!-- NEW -->
<script src="/js/app.js"></script>  <!-- or landing.js -->
```

**Edge Case: Failed/Aborted Uploads (Intentional Behavior)**

If a user starts an upload that creates a patient record but fails before completing (OCR error,
network issue, browser close), the detection condition `patient_count === 0 && report_count === 0`
will return `is_new_user: false` (patient exists, even with zero completed reports).

This is **intentional for MVP**:
- The user already attempted onboarding and interacted with the system
- They are not truly "new" - they have context about the app
- Main app shows failed uploads, allowing retry from familiar interface
- Prevents confusion from being re-shown the "first time" experience

**Future enhancement:** If analytics show significant drop-off from failed first uploads,
consider `is_new_user: report_count === 0` (ignore patient existence).

### 2. Landing Page Structure

**File:** `public/landing.html`

**Authentication Requirement:**
- Landing page MUST include `auth.js` and wait for `window.authReady` before any API calls
- Same pattern as `index.html`: `<script src="/js/auth.js"></script>` in head
- All API calls (status check, upload, insight) require authenticated session

**States (managed by JS, not separate pages):**
1. `welcome` - Initial upload prompt
2. `processing` - Files uploading and OCR running
3. `generating` - Insight being generated
4. `insight` - Showing results and suggestions
5. `error` - Retry state (OCR or insight failed)

**CSS:** Create `public/css/landing.css` using existing design tokens from `style.css`

**JS:** Create `public/js/landing.js` for state management

```javascript
// landing.js initialization pattern
document.addEventListener('DOMContentLoaded', async () => {
  // CRITICAL: Wait for auth before any API calls
  await window.authReady;

  // Now safe to check onboarding status and initialize UI
  await initializeLanding();
});
```

### 3. Upload Flow (Reuses Existing)

Landing page reuses the existing batch upload infrastructure:

```javascript
// 1. User selects files
// 2. POST /api/analyze-labs/batch with FormData
//    - Field name: 'analysisFile' (MUST match existing endpoint)
//    - Returns { batch_id, jobs: [{ job_id, filename, status }] }
// 3. Poll GET /api/analyze-labs/batches/:batch_id every 2s
//    - Returns { batch_id, jobs: [{ job_id, filename, status, progress, progress_message, report_id, patient_id }] }
// 4. Track progress: pending → processing → completed
// 5. When ALL jobs completed → extract report_id and patient_id from each job
// 6. Trigger insight generation with collected report_ids
```

**API Field Names (snake_case to match existing endpoints):**

| Field | Description |
|-------|-------------|
| `batch_id` | Batch identifier UUID |
| `job_id` | Individual job identifier UUID |
| `report_id` | Created report UUID (exposed at job level) |
| `patient_id` | Created/matched patient UUID (exposed at job level) |
| `progress` | 0-100 integer |
| `progress_message` | Human-readable status string |

**Progress Message Mapping (from `labReportProcessor.js`):**

The `progress_message` field contains status strings from the backend. Landing page should display
user-friendly messages. Here's the mapping:

| Progress | Backend Message | Landing Page Display |
|----------|-----------------|----------------------|
| 5 | `File uploaded` | Uploading... |
| 10-20 | `Processing PDF` / `Processing X page(s)` | Preparing your report... |
| 25-35 | `Preparing analysis` / `PDF ready for analysis` | Setting up analysis... |
| 40 | `Analyzing with OPENAI` / `Analyzing with ANTHROPIC` | Extracting health markers... |
| 70-75 | `AI analysis completed` / `Parsing results` | Processing results... |
| 80-85 | `Saving results` / `Results saved` | Saving your data... |
| 87-95 | `Normalizing units` / `Mapping analytes` / `Analyte mapping completed` | Finalizing... |
| 100 | `Completed` | ✓ Done |

**Note:** The landing page can simplify these messages or show generic progress text. The exact
backend messages are provided for debugging and developer reference.

**Fallback for Unknown Messages:** If `progress_message` doesn't match any known pattern, display
a generic "Processing..." message. This ensures UI resilience if backend text changes:

```javascript
function getDisplayMessage(progress, progressMessage) {
  // Known message patterns (see table above)
  const patterns = [
    { match: /^File uploaded/i, display: 'Uploading...' },
    { match: /^Processing|^Preparing/i, display: 'Preparing your report...' },
    { match: /^Analyzing/i, display: 'Extracting health markers...' },
    { match: /^Parsing|^AI analysis/i, display: 'Processing results...' },
    { match: /^Saving|^Results saved/i, display: 'Saving your data...' },
    { match: /^Normalizing|^Mapping|^Analyte/i, display: 'Finalizing...' },
    { match: /^Completed$/i, display: '✓ Done' },
  ];

  for (const { match, display } of patterns) {
    if (match.test(progressMessage)) return display;
  }

  // FALLBACK: Unknown message - show generic progress
  return progress >= 100 ? '✓ Done' : 'Processing...';
}
```

**Required API Change: Expose `patient_id` in batch status**

The existing `getBatchStatus()` in `server/utils/jobManager.js` must be updated to expose `patient_id`:

```javascript
// In getBatchStatus() - add patient_id to job status
const jobsWithStatus = batch.jobs.map(({ jobId, filename }) => {
  const job = getJobStatus(jobId);
  return {
    job_id: jobId,
    filename,
    status: job?.status || 'pending',
    progress: job?.progress || 0,
    progress_message: job?.progressMessage || '',
    report_id: job?.result?.report_id || null,
    patient_id: job?.result?.patient_id || null,  // NEW: expose patient_id
    parameters: job?.result?.parameters || null,
    error: job?.error || null
  };
});
```

**Constraints:**
- Max 20 files per batch (existing limit)
- Max 10MB per individual file (enforced by `server/app.js` file upload middleware)
- Max 100MB aggregate per batch (existing limit)
- Supported: PDF, PNG, JPEG, HEIC (existing)
- Gmail import is NOT available on landing page
- Multipart field name MUST be `analysisFile` (existing endpoint requirement)

### 4. Insight Generation API

**New Endpoint:** `POST /api/onboarding/insight`

**File:** `server/routes/onboarding.js`

```javascript
// Request:
{
  report_ids: string[]  // UUIDs of completed reports (snake_case)
}

// Response (success):
{
  insight: string,  // 2-4 sentences, personalized
  suggestions: [
    { label: string, query: string },  // 2-4 items, LLM-generated
    ...
  ],
  analytes_extracted: number,
  reports_processed: number,
  patient_id: string  // For MVP: patient_id from first report (see Multi-Patient Handling)
}

// Response (error):
{
  error: string,
  retryable: boolean
}
```

**Implementation (using existing codebase functions):**

```javascript
import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { getReportDetail } from '../services/reportRetrieval.js';
import { requireAuth } from '../middleware/auth.js';
import { getDirname } from '../utils/path-helpers.js';

const __dirname = getDirname(import.meta.url);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const INSIGHT_MODEL = process.env.CHAT_MODEL || process.env.SQL_GENERATOR_MODEL || 'gpt-4o-mini';
const INSIGHT_TIMEOUT_MS = 30000;

// Load prompt template (ESM-safe file loading)
const FIRST_INSIGHT_TEMPLATE = fs.readFileSync(
  path.join(__dirname, '../../prompts/first_insight.md'),
  'utf-8'
);

function buildFirstInsightPrompt(labDataJson) {
  return FIRST_INSIGHT_TEMPLATE.replace('{{labResultsJson}}', labDataJson);
}

const MAX_REPORT_IDS = 20;  // Match upload batch limit

router.post('/insight', requireAuth, async (req, res) => {
  const { report_ids } = req.body;

  if (!report_ids || !Array.isArray(report_ids) || report_ids.length === 0) {
    return res.status(400).json({ error: 'report_ids array required', retryable: false });
  }

  // Defense-in-depth: Cap report_ids to prevent oversized prompts
  // This mirrors the 20-file upload limit from batch processing
  if (report_ids.length > MAX_REPORT_IDS) {
    return res.status(400).json({
      error: `Maximum ${MAX_REPORT_IDS} reports allowed`,
      retryable: false
    });
  }

  // ================================================================
  // UUID VALIDATION (Required - prevents PostgreSQL 500 errors)
  // ================================================================
  // PostgreSQL throws "invalid input syntax for type uuid" on malformed UUIDs.
  // Validate upfront to return 400 instead of 500.
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const invalidIds = report_ids.filter(id => typeof id !== 'string' || !uuidPattern.test(id));
  if (invalidIds.length > 0) {
    return res.status(400).json({
      error: 'Invalid report_id format - expected UUID',
      retryable: false
    });
  }

  try {
    // 1. Fetch lab results using existing getReportDetail() function
    // NOTE: Promise.all with up to 20 concurrent queries is acceptable for MVP.
    // Each query is fast (<50ms) and the pool queues excess requests.
    // Future enhancement: Use p-limit(5) for production scaling if pool contention observed.
    const rawReportsData = await Promise.all(
      report_ids.map(id => getReportDetail(id, { mode: 'user', userId: req.user.id }))
    );

    // Filter out null responses (invalid/unauthorized report_ids)
    const reportsData = rawReportsData.filter(Boolean);

    if (reportsData.length === 0) {
      return res.status(404).json({ error: 'No valid reports found', retryable: false });
    }

    // ================================================================
    // SERVER-SIDE PATIENT VALIDATION (Defense-in-depth)
    // ================================================================
    // Even though client filters reports to a single patient, we MUST validate
    // server-side to prevent crafted requests from mixing patient data.
    // This is critical for health data safety - never mix different patients' results.

    // Extract unique patient_ids from all fetched reports
    const patientIds = [...new Set(reportsData.map(r => r.patient_id).filter(Boolean))];

    if (patientIds.length === 0) {
      return res.status(400).json({ error: 'No patient_id found in reports', retryable: false });
    }

    // Use first patient as primary (consistent with client-side behavior)
    const primaryPatientId = patientIds[0];

    // Filter reports to ONLY the primary patient (reject mixed-patient requests)
    const singlePatientReports = reportsData.filter(r => r.patient_id === primaryPatientId);

    if (patientIds.length > 1) {
      // Log warning for debugging but don't fail - gracefully handle by filtering
      console.warn('[onboarding/insight] Multiple patients in request, filtering to primary:', {
        requested_count: reportsData.length,
        filtered_count: singlePatientReports.length,
        primary_patient_id: primaryPatientId,
        all_patient_ids: patientIds
      });
    }

    // 2. Aggregate parameters from SINGLE-PATIENT reports only
    let allParameters = singlePatientReports.flatMap(r => r?.parameters || []);

    // ================================================================
    // PARAMETER COUNT LIMIT (Prevent oversized prompts)
    // ================================================================
    // With 20 reports × 50+ parameters each, we could have 1000+ parameters
    // This would balloon token count and risk timeout/rate limits
    const MAX_PARAMETERS = 200;  // Reasonable limit for insight generation

    if (allParameters.length > MAX_PARAMETERS) {
      console.warn('[onboarding/insight] Truncating parameters:', {
        original_count: allParameters.length,
        truncated_to: MAX_PARAMETERS
      });

      // Prioritize out-of-range values (most clinically relevant)
      const outOfRange = allParameters.filter(p => p.is_value_out_of_range);
      const normal = allParameters.filter(p => !p.is_value_out_of_range);

      if (outOfRange.length >= MAX_PARAMETERS) {
        // If we have more out-of-range than limit, take most recent (last in array)
        allParameters = outOfRange.slice(-MAX_PARAMETERS);
      } else {
        // Take all out-of-range + fill remaining with normal values
        const remainingSlots = MAX_PARAMETERS - outOfRange.length;
        allParameters = [...outOfRange, ...normal.slice(-remainingSlots)];
      }
    }

    // NOTE: getReportDetail() returns flat patient_* fields, not nested patient object
    const firstReport = singlePatientReports[0];
    const patient_id = primaryPatientId;

    // 3. Build prompt with lab data
    // NOTE: Match actual getReportDetail() return shape (see reportRetrieval.js)
    const labDataJson = JSON.stringify({
      patient: {
        name: firstReport?.patient_name,
        gender: firstReport?.patient_gender
      },
      reports_count: singlePatientReports.length,  // Use filtered count for accurate messaging
      parameters: allParameters.map(p => ({
        name: p.parameter_name,
        value: p.result,
        unit: p.unit,
        out_of_range: p.is_value_out_of_range,
        reference: p.reference_interval?.text  // Use nested .text field
      }))
    }, null, 2);

    const systemPrompt = buildFirstInsightPrompt(labDataJson);

    // 4. Call LLM with structured output (Responses API - per CLAUDE.md gotcha #11)
    // IMPORTANT: Use responses.parse() instead of chat.completions.create() for structured outputs
    // Responses API is significantly faster (5-10x) for structured JSON outputs
    const response = await openai.responses.parse({
      model: INSIGHT_MODEL,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `${systemPrompt}\n\nGenerate the insight and suggestions based on the lab data provided.`
            }
          ]
        }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'insight_response',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              insight: { type: 'string', description: '2-4 sentence personalized insight' },
              suggestions: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string', description: 'Short button text (2-4 words)' },
                    query: { type: 'string', description: 'Full question to send to chat' }
                  },
                  required: ['label', 'query'],
                  additionalProperties: false
                },
                minItems: 2,
                maxItems: 4
              }
            },
            required: ['insight', 'suggestions'],
            additionalProperties: false
          }
        }
      },
      temperature: 0.7
    }, {
      timeout: INSIGHT_TIMEOUT_MS
    });

    // 5. Access parsed response (responses.parse() returns output_parsed directly)
    const parsed = response.output_parsed;

    // Return insight with patient info for client display
    res.json({
      insight: parsed.insight,
      suggestions: parsed.suggestions,
      analytes_extracted: allParameters.length,
      reports_processed: singlePatientReports.length,  // Count of filtered reports
      patient_id,
      patient_name: firstReport?.patient_name || null  // For client-side display
    });

  } catch (error) {
    if (error.name === 'AbortError') {
      return res.status(504).json({ error: 'Insight generation timed out', retryable: true });
    }
    console.error('[onboarding] Insight generation failed:', error.message);
    res.status(500).json({ error: 'Failed to generate insight', retryable: true });
  }
});
```

**JSON Parsing Safety:**
- Uses OpenAI's Responses API (`responses.parse()`) for guaranteed valid JSON (per CLAUDE.md gotcha #11)
- Responses API is 5-10x faster than Chat Completions API for structured outputs
- Schema enforces exact structure: `{ insight: string, suggestions: [{label, query}] }`
- `response.output_parsed` returns already-parsed object - no manual JSON.parse() needed
- On parse failure (shouldn't happen with strict schema): return generic fallback

**Prompt Template:** `prompts/first_insight.md`

**labResultsJson Schema (passed via `{{labResultsJson}}` placeholder):**

The `buildFirstInsightPrompt()` function injects this JSON structure:

```typescript
{
  patient: {
    name: string | null,    // Patient name from first report (may be null)
    gender: string | null   // Patient gender from first report (may be null)
  },
  reports_count: number,    // Total number of reports processed
  parameters: Array<{
    name: string,           // Parameter/analyte name (e.g., "LDL Cholesterol")
    value: string | number, // Result value (e.g., 145 or "Positive")
    unit: string | null,    // Measurement unit (e.g., "mg/dL", may be null)
    out_of_range: boolean,  // True if value is outside reference interval
    reference: string | null // Reference interval text (e.g., "< 100 mg/dL")
  }>
}
```

**Note:** Parameters are flattened from all reports (already filtered to single patient per Section 8).
The LLM receives one combined list regardless of how many reports were uploaded.

```markdown
You are a health assistant analyzing a user's first uploaded lab report(s).

## Lab Results Data
{{labResultsJson}}

## Task
Generate a brief, personalized insight (2-4 sentences) for this first-time user.

### Requirements:
1. **If any values are out of range:** Lead with those findings. Be factual but not alarming.
2. **If all values are normal:** Celebrate the positive results. Mention specific markers that look good.
3. **Always include:** A brief encouragement to upload more reports over time to track trends.
4. **Always include:** One actionable tip relevant to their results (diet, exercise, hydration, etc.)

### Tone:
- Warm and reassuring, like a knowledgeable friend
- Factual without being clinical
- Encouraging without being patronizing

## Suggestions
Also generate 2-4 follow-up questions the user might want to ask. These should be:
- Specific to THEIR results (not generic)
- Actionable (lead to useful information)
- Varied (different types of questions)

## Output Format (JSON):
{
  "insight": "Your personalized insight here...",
  "suggestions": [
    { "label": "Short button text", "query": "Full question to ask the assistant" },
    ...
  ]
}
```

**Timeout Handling:**
- Timeout: 30 seconds
- On timeout/error: Return `{ error: "...", retryable: true }`
- Frontend shows retry button

### 5. State Transfer to Main App

**Before redirect (landing.js):**

```javascript
function proceedToChat(selectedSuggestion, insightResponse) {
  const context = {
    insight: insightResponse.insight,           // The generated insight text
    selected_query: selectedSuggestion.query,   // Full question text (snake_case)
    report_ids: completedReportIds,             // Array of report UUIDs
    patient_id: insightResponse.patient_id,     // Patient UUID from insight response
    patient_name: insightResponse.patient_name  // Patient name for display (may be null)
  };

  sessionStorage.setItem('onboarding_context', JSON.stringify(context));
  window.location.href = '/index.html#assistant';
}
```

**On index.html load (app.js or chat.js):**

**CRITICAL: Initialization Order and SSE Event Handling**

The onboarding context handler MUST run BEFORE `ConversationalSQLChat.init()` to prevent
the chat component from auto-creating its own session.

**IMPORTANT: SSE Event Listener Race Condition Prevention**

EventSource does NOT buffer events for late listeners. If we post a message before attaching
`onmessage` handlers, streamed response events will be lost. Therefore:

1. `handleOnboardingContext()` creates session and EventSource, but does NOT post the message
2. `initWithExistingSession()` attaches SSE handlers FIRST
3. `initWithExistingSession()` THEN submits the auto-message (after handlers are ready)
4. This guarantees no SSE events are dropped

The sequence is:

1. `handleOnboardingContext()` checks for pending context
2. If context exists: create session, open SSE, wait for `session_start`
3. Pass session info AND the pending query to chat component
4. Chat component attaches all event handlers
5. Chat component submits the auto-message (handlers now ready to receive response)

```javascript
async function handleOnboardingContext() {
  const raw = sessionStorage.getItem('onboarding_context');
  if (!raw) return null;  // Return null to signal no onboarding context

  const ctx = JSON.parse(raw);
  // NOTE: Do NOT clear sessionStorage here - wait until session is confirmed
  // This allows retry if session creation or SSE connection fails

  try {
    // 1. Create chat session with patient context AND initial_context
    const sessionRes = await fetch('/api/chat/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        selectedPatientId: ctx.patient_id,
        initial_context: ctx.insight  // Pass insight for server-side seeding
      })
    });

    if (!sessionRes.ok) {
      throw new Error('Failed to create session');
    }

    const { sessionId } = await sessionRes.json();

    // 2. Open SSE connection and WAIT for session_start event
    // NOTE: We intentionally skip the HEAD /api/chat/sessions/:id/validate preflight
    // that chat.js uses for reconnection. Rationale:
    // - Session was just created (not stale) - validation would be redundant
    // - The 10-second timeout below provides implicit validation
    // - SSE connection failure triggers error handling and user can retry
    // - Preflight adds latency to the critical onboarding path
    const eventSource = window.createAuthAwareEventSource(`/api/chat/stream?sessionId=${sessionId}`);

    // CRITICAL: Server emits unnamed SSE events (just `data:` lines without `event:` field)
    // We MUST use onmessage and check data.type, NOT addEventListener('session_start')
    // See: server/routes/chatStream.js streamEvent() - only sends `data: {...}\n\n`
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        eventSource.close();
        reject(new Error('SSE timeout waiting for session_start'));
      }, 10000);

      // Use onmessage (fires for unnamed events) and check data.type
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'session_start') {
            clearTimeout(timeout);
            // Remove temporary handler - initWithExistingSession will attach proper handlers
            eventSource.onmessage = null;
            resolve();
          }
        } catch (e) {
          // Ignore parse errors during handshake
        }
      };

      eventSource.onerror = () => {
        clearTimeout(timeout);
        eventSource.close();
        reject(new Error('SSE connection failed'));
      };
    });

    // 3. SUCCESS - NOW safe to clear sessionStorage (session confirmed)
    sessionStorage.removeItem('onboarding_context');

    // 4. Return context INCLUDING pending query for chat component
    //    DO NOT post message here - EventSource handlers not fully attached yet
    //    initWithExistingSession() will:
    //    a) Attach proper SSE handlers first
    //    b) Add user bubble to UI
    //    c) Set isProcessing = true
    //    d) Then submit the message (preventing dropped events)
    return {
      sessionId,
      eventSource,
      selectedPatientId: ctx.patient_id,
      patientName: ctx.patient_name || null,  // Pass name if available for display
      pendingQuery: ctx.selected_query
    };

  } catch (error) {
    console.error('[Onboarding] Session setup failed:', error);
    // sessionStorage NOT cleared - user can retry by refreshing
    // Show error to user
    alert('Failed to start chat session. Please refresh the page to try again.');
    return null;
  }
}

// Integration with app.js - MUST bypass visibility gate for onboarding
// The existing app.js has a lazy-init pattern that only initializes chat when
// the Assistant section is visible. For onboarding, we MUST initialize immediately.
```

**CRITICAL: app.js Modification Required**

The existing `app.js` uses lazy initialization (`initChatIfVisible()`) that only initializes
the chat when `section-assistant` is visible. This breaks onboarding because:

1. Landing page redirects to `/index.html#assistant`
2. URL hash triggers navigation, but section may not be visible yet
3. Chat must initialize BEFORE the section becomes visible to handle onboarding

**Required changes to `public/js/app.js`:**

**IMPORTANT:** The existing `app.js` uses an async IIFE pattern (not `DOMContentLoaded`). The
onboarding integration MUST use the same pattern for consistency. The changes below should be
integrated into the existing IIFE, after the auth check and user display, but BEFORE the existing
chat lazy-init logic.

```javascript
// ==================== AUTH CHECK (MUST BE FIRST) ====================
// Existing async IIFE pattern - DO NOT change to DOMContentLoaded
(async () => {
  const isAuthenticated = await window.authReady;
  if (!isAuthenticated) {
    return;
  }

  // ... existing user display and management section hiding ...

  // ================================================================
  // PRD v5.0: ONBOARDING PRIORITY - Check for onboarding context FIRST
  // This MUST run BEFORE the existing lazy-init visibility check
  // Insert this block after user display, before chat initialization
  // ================================================================
  const onboardingSession = await handleOnboardingContext();

  // PRD v3.2: Initialize Conversational SQL Assistant
  // MODIFIED for v5.0: Check onboarding context before lazy-init
  let conversationalSQLChat = null;
  let chatInitialized = false;
  const assistantSection = document.getElementById('section-assistant');
  const chatContainer = document.getElementById('conversational-chat-container');

  if (onboardingSession && chatContainer) {
    // PRD v5.0: BYPASS visibility gate for onboarding - initialize immediately
    console.log('[app] Onboarding detected - initializing chat immediately');

    // Force assistant section visible (user is redirected with #assistant hash)
    if (assistantSection) {
      assistantSection.style.display = 'block';
      // Also update nav state to show Assistant as active
      document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.section === 'assistant');
      });
      document.querySelectorAll('.content-section').forEach(section => {
        section.style.display = section.id === 'section-assistant' ? 'block' : 'none';
      });
    }

    conversationalSQLChat = new window.ConversationalSQLChat();
    conversationalSQLChat.initWithExistingSession(chatContainer, onboardingSession);
    chatInitialized = true;
    console.log('[app] Onboarding chat session initialized');

  } else {
    // Normal lazy-init pattern (existing behavior, unchanged)
    const initChatIfVisible = () => {
      if (chatInitialized || !chatContainer || !assistantSection) return;
      if (getComputedStyle(assistantSection).display === 'none') return;
      if (!window.ConversationalSQLChat) {
        console.error('[app] ConversationalSQLChat not loaded');
        return;
      }
      conversationalSQLChat = new window.ConversationalSQLChat();
      conversationalSQLChat.init(chatContainer);
      chatInitialized = true;
      console.log('[app] Conversational SQL chat initialized');
    };

    if (assistantSection && 'MutationObserver' in window) {
      const observer = new MutationObserver(() => initChatIfVisible());
      observer.observe(assistantSection, { attributes: true, attributeFilter: ['style', 'hidden', 'class'] });
    }
    initChatIfVisible();
  }

  // ... rest of existing app.js code (report viewing, etc.) ...
})();
```

**Integration checklist:**
1. Place `handleOnboardingContext()` call AFTER `await window.authReady` succeeds
2. Place onboarding check BEFORE the existing `initChatIfVisible()` logic
3. Move `chatInitialized` and `conversationalSQLChat` declarations earlier (before onboarding check)
4. Keep all existing code paths intact when no onboarding context is present

**Why this is necessary:**
- The `#assistant` hash in the URL causes navigation to switch sections
- But section switching may happen AFTER the async IIFE executes
- Onboarding needs the chat to be ready to receive the auto-submitted message
- By checking for onboarding context FIRST and forcing visibility, we guarantee the flow works

**chat.js modification: Add `initWithExistingSession()` method**

**IMPORTANT:** This method MUST mirror all DOM bindings from `init()` to ensure consistent UI behavior.
The only difference is it uses a pre-created session instead of calling `initPatientSelector()`.

```javascript
// New method in ConversationalSQLChat class
// NOTE: Destructure patientName along with pendingQuery from onboarding context
initWithExistingSession(containerElement, { sessionId, eventSource, selectedPatientId, patientName, pendingQuery }) {
  // ============================================================
  // STEP 1: Set up ALL DOM references (must match init() exactly)
  // ============================================================
  this.chatContainer = containerElement;
  this.messagesContainer = this.chatContainer.querySelector('.chat-messages');
  this.inputTextarea = this.chatContainer.querySelector('.chat-input-textarea');
  this.sendButton = this.chatContainer.querySelector('.chat-send-button');
  this.resultsContainer = document.getElementById('sqlResults');  // REQUIRED for plot/table results

  // PRD v4.3: Patient selector elements (must be set even if locked)
  this.patientChipsContainer = document.getElementById('patient-chips-container');
  this.newChatButton = document.getElementById('new-chat-button');
  this.chipsScrollLeft = document.getElementById('chips-scroll-left');
  this.chipsScrollRight = document.getElementById('chips-scroll-right');

  // ============================================================
  // STEP 2: Attach ALL event listeners (must match init() exactly)
  // ============================================================
  this.sendButton.addEventListener('click', this.handleSendMessage);
  this.inputTextarea.addEventListener('keydown', this.handleKeyPress);

  // PRD v4.3: New Chat button handler
  if (this.newChatButton) {
    this.newChatButton.addEventListener('click', this.handleNewChat);
  }

  // Scroll arrow handlers for patient chips
  this.initChipsScrollHandlers();

  // Example prompt handlers (for empty state)
  this.attachExamplePromptHandlers();

  // ============================================================
  // STEP 3: Use pre-created session (do NOT call initPatientSelector)
  // ============================================================
  this.sessionId = sessionId;
  this.eventSource = eventSource;
  this.selectedPatientId = selectedPatientId;

  // ============================================================
  // STEP 4: Attach SSE handlers BEFORE submitting message
  // CRITICAL: This prevents dropped events from the streamed response
  // ============================================================
  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      this.handleSSEEvent(data);
    } catch (error) {
      console.error('[Chat] Failed to parse SSE event:', error, event.data);
    }
  };

  eventSource.onerror = (error) => {
    console.error('[Chat] SSE connection error:', error);
    if (this.eventSource.readyState === EventSource.CLOSED) {
      this.showError('Connection lost. Please refresh the page.');
      this.disableInput();
    }
  };

  // ============================================================
  // STEP 5: Lock patient chips (onboarding already selected patient)
  // Use patientName from onboarding context for display (avoids extra fetch)
  // ============================================================
  this.chipsLocked = true;
  this.patients = [{
    id: selectedPatientId,
    display_name: patientName || 'Patient',  // Fallback if name unavailable
    full_name: patientName || null
  }];
  this.selectedPatientId = selectedPatientId;
  this.renderPatientChips();

  // ============================================================
  // STEP 6: Submit pending query with proper UI state management
  // CRITICAL: Add user bubble and set isProcessing BEFORE submitting
  // This mirrors handleSendMessage() behavior for UI consistency
  // ============================================================
  if (pendingQuery) {
    // Add user message bubble (so user sees their question)
    this.addUserMessage(pendingQuery);

    // Set processing state (prevents duplicate submissions)
    this.isProcessing = true;
    this.disableInput();

    // NOW submit the message (SSE handlers already attached above)
    fetch('/api/chat/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        sessionId: this.sessionId,
        message: pendingQuery
      })
    }).catch(error => {
      console.error('[Chat] Failed to send onboarding message:', error);
      this.showError('Failed to send message. Please try again.');
      this.enableInput();
      this.isProcessing = false;
    });
  } else {
    // No pending query - just enable input
    this.enableInput();
  }
}
```

**CRITICAL: Why This Order Matters**
1. DOM references and event listeners are set up first (consistent behavior)
2. SSE `onmessage` handler is attached BEFORE the fetch (prevents dropped events)
3. User bubble is added and `isProcessing` is set (proper UI state)
4. THEN the message is submitted (response events will be captured)

**Server-side context seeding (chatStream.js modification):**

**Modified endpoint:** `POST /api/chat/sessions`

**CRITICAL: Onboarding context must NOT be pushed directly to `session.messages`**

The existing `initializeSystemPrompt()` function checks `session.messages.length === 1` to determine
if it should initialize the schema prompt. If we push a message at session creation, this check
fails and the schema prompt is never initialized.

**Solution:** Store `initial_context` on the session object (not in messages array), then inject
it AFTER `initializeSystemPrompt()` completes.

```javascript
// Add support for initial_context field
router.post('/sessions', requireAuth, async (req, res) => {
  const { selectedPatientId, initial_context } = req.body;  // NEW: initial_context

  // ... existing patient validation ...

  const session = sessionManager.createSession();
  session.userId = req.user.id;
  session.isAdmin = req.user.is_admin || false;

  if (selectedPatientId) {
    session.selectedPatientId = selectedPatientId;
  }

  // NEW: Store initial_context on session object (NOT in messages array yet)
  // This will be injected AFTER initializeSystemPrompt() runs
  if (initial_context) {
    session.initialContext = initial_context;
    logger.info({ userId: req.user.id, event: 'onboarding_context_stored' });
  }

  res.json({
    sessionId: session.id,
    selectedPatientId: selectedPatientId || null
  });
});
```

**Modify `processMessage()` to pass onboarding context to system prompt initialization:**

**CRITICAL: Why we merge into primary system prompt (not a second system message)**

The existing `pruneConversationIfNeeded()` function uses `session.messages.find(msg => msg.role === 'system')`
which only preserves the **first** system message during conversation pruning. A second system message
would be classified as a "conversation message" and could be pruned away in long conversations.

**Solution:** Pass onboarding context to `initializeSystemPrompt()` and prepend it to the primary
system prompt content. This ensures the context survives pruning.

```javascript
// In processMessage() - pass onboarding context to initializeSystemPrompt
if (session.messages.length === 1) {
  // Extract and clear onboarding context before initialization
  const onboardingContext = session.initialContext || null;
  if (onboardingContext) {
    delete session.initialContext;
    logger.info({ sessionId: session.id, event: 'onboarding_context_will_be_injected' });
  }

  await initializeSystemPrompt(session, { onboardingContext });
}
```

**Modify `initializeSystemPrompt()` to accept and merge onboarding context:**

```javascript
/**
 * Initialize system prompt with schema and patient context
 * PRD v5.0: Accepts optional onboardingContext to merge into primary system prompt
 * @param {object} session - Session object
 * @param {object} options - Optional parameters
 * @param {string|null} options.onboardingContext - Onboarding insight text to prepend
 */
async function initializeSystemPrompt(session, { onboardingContext = null } = {}) {
  // Get schema snapshot and format it
  const { manifest } = await getSchemaSnapshot();
  const schemaContext = buildSchemaSection(manifest, '');

  const { prompt } = await agenticCore.buildSystemPrompt(
    schemaContext,
    20,
    'chat',
    session.selectedPatientId,
    session.userId,
    session.isAdmin || false
  );

  // PRD v5.0: Prepend onboarding context to system prompt if provided
  // This ensures the context survives conversation pruning (only first system message is preserved)
  let finalPrompt = prompt;
  if (onboardingContext) {
    const onboardingPrefix = `## Onboarding Context

The user just completed their first upload and received this personalized insight:

${onboardingContext}

They are now asking a follow-up question. Continue the conversation naturally, building on this context. Reference specific findings from the insight when relevant.

---

`;
    finalPrompt = onboardingPrefix + prompt;
    logger.info({ sessionId: session.id, event: 'onboarding_context_merged_into_system_prompt' });
  }

  // Add system message (single system message, survives pruning)
  session.messages.unshift({
    role: 'system',
    content: finalPrompt
  });

  logger.info('[chatStream] System prompt initialized:', {
    session_id: session.id,
    selected_patient_id: session.selectedPatientId,
    has_onboarding_context: !!onboardingContext
  });
}
```

### 6. Error Handling

**OCR Failure:**
- Individual job fails → show error for that file, allow retry
- All jobs fail → show error state with "Try again" button
- Partial success → proceed with successful reports only

**Insight Generation Failure:**
- Show: "We couldn't generate your personalized insight."
- Show: "Try again" button
- After 3 retries: Show generic fallback with "Go to app" button
  - Fallback insight: "We processed {n} health markers from your report. You can now ask questions about your results."
  - Fallback suggestions: Fixed set ["Summarize my results", "What's out of range?", "Health recommendations"]

**Network Errors:**
- Show retry button with exponential backoff hint
- "Having trouble connecting. Please check your connection and try again."

### 7. Multi-File Upload Behavior

When user uploads multiple files:

1. **Progress Display:** Show aggregate progress
   ```
   Analyzing your reports...

   ████████████░░░░░░░░  2 of 3 complete

   • lipid_panel.pdf ✓
   • cbc_results.pdf ✓
   • thyroid.pdf ⏳ Processing...
   ```

2. **Wait for All:** Only proceed to insight generation when ALL jobs complete (or fail)

3. **Holistic Insight:** The prompt receives all results together, generates ONE combined insight
   - "You uploaded 3 reports spanning 6 months. Here's what stands out..."

4. **Error Handling:** If some fail, generate insight for successful ones only

### 8. Multi-Patient Handling (MVP)

**Problem:** If user uploads PDFs for different people (e.g., family members), each creates a different patient record. Chat sessions only accept one `selectedPatientId`.

**CRITICAL: Prevent Mixed-Patient Insights**

Generating an insight that blends lab data from multiple patients is factually incorrect and
potentially dangerous for health-related information. The insight endpoint receives `report_ids`
and must NOT mix data from different patients.

**MVP Rule: Filter reports to primary patient BEFORE insight generation**
- Extract `patient_id` from the first successfully completed job (this is the "primary patient")
- **Filter report_ids to ONLY include reports belonging to the primary patient**
- Pass filtered `report_ids` to insight generation (ensures single-patient data only)
- Pass `primaryPatientId` to chat session

**Implementation:**

```javascript
// After all jobs complete, collect patient_ids
// NOTE: patient_id is now exposed at job level (not nested in job.result)
// See "Required API Change" in Section 3 for jobManager.js modification
const completedJobs = batchStatus.jobs.filter(j => j.status === 'completed');
const patientIds = [...new Set(completedJobs.map(j => j.patient_id))];

// Use first patient as primary
const primaryPatientId = patientIds[0];

// CRITICAL: Filter reports to ONLY those belonging to the primary patient
// This prevents generating insights that mix data from different people
const primaryPatientReportIds = completedJobs
  .filter(j => j.patient_id === primaryPatientId)
  .map(j => j.report_id);

if (patientIds.length > 1) {
  console.warn('[landing] Multiple patients detected. Using primary patient:', primaryPatientId);
  console.warn('[landing] Filtered from', completedJobs.length, 'reports to', primaryPatientReportIds.length);
  // TODO (post-MVP): Show patient selector UI
}

// Pass ONLY the filtered report_ids to insight generation
const insightResponse = await fetch('/api/onboarding/insight', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({ report_ids: primaryPatientReportIds })  // Filtered!
});
```

**Why filter instead of mixing?**
- Health data from different people MUST NOT be combined in a single insight
- "Your LDL is 145" is dangerous if it's actually someone else's result
- The insight should accurately describe one person's health status
- Chat session can only query one patient's data anyway

**Why not show a patient picker?**
- Adds complexity to MVP onboarding flow
- Most first-time users upload their own reports (single patient)
- Multi-patient scenario is edge case for friends & family test
- Can revisit in future version if needed

**Future enhancement (post-MVP):**
- If `patientIds.length > 1`, show: "We found reports for multiple people. Who would you like to ask about?"
- Let user select patient before proceeding to insight

### 9. Design Specifications

**Consistency:** Use existing design tokens from `style.css`:

```css
/* Landing page specific styles */
.landing-container {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-8);
  background: var(--color-bg);  /* cream background */
}

.landing-card {
  max-width: 480px;
  width: 100%;
  background: var(--color-surface-elevated);  /* white */
  border-radius: var(--radius-2xl);
  padding: var(--space-10);
  box-shadow: var(--shadow-xl);
}

.landing-title {
  font-family: var(--font-display);  /* Source Serif 4 */
  font-size: var(--text-3xl);
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: var(--space-4);
  text-align: center;
}

.landing-subtitle {
  font-family: var(--font-body);  /* DM Sans */
  font-size: var(--text-lg);
  color: var(--color-text-secondary);
  text-align: center;
  margin-bottom: var(--space-8);
}

.upload-button {
  width: 100%;
  padding: var(--space-4) var(--space-6);
  background: var(--color-accent);  /* sage green */
  color: white;
  border: none;
  border-radius: var(--radius-lg);
  font-family: var(--font-body);
  font-size: var(--text-base);
  font-weight: 600;
  cursor: pointer;
  transition: background var(--transition-base);
}

.upload-button:hover {
  background: var(--color-accent-hover);
}

.insight-card {
  background: var(--color-accent-light);  /* sage-50 */
  border-radius: var(--radius-xl);
  padding: var(--space-6);
  margin-bottom: var(--space-6);
}

.suggestion-button {
  padding: var(--space-3) var(--space-4);
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  font-family: var(--font-body);
  font-size: var(--text-sm);
  color: var(--color-text);
  cursor: pointer;
  transition: all var(--transition-base);
}

.suggestion-button:hover {
  border-color: var(--color-accent);
  background: var(--color-accent-light);
}
```

**"Subtle Magic" Effects:**

1. **Progress animation:** Smooth gradient animation on progress bar (not jarring)
2. **Insight reveal:** Fade-in with slight upward motion (200ms ease-out)
3. **Suggestion buttons:** Staggered fade-in (50ms delay each)
4. **Success checkmark:** Subtle scale-in animation

```css
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.insight-card {
  animation: fadeInUp 300ms ease-out;
}

.suggestion-button:nth-child(1) { animation-delay: 0ms; }
.suggestion-button:nth-child(2) { animation-delay: 50ms; }
.suggestion-button:nth-child(3) { animation-delay: 100ms; }
.suggestion-button:nth-child(4) { animation-delay: 150ms; }
```

**SECURITY: Safe Rendering of LLM Content (Required)**

LLM-generated content (insight text, suggestion labels/queries) MUST be rendered safely to prevent XSS:

```javascript
// CORRECT: Use textContent (auto-escapes HTML)
insightTextEl.textContent = insightResponse.insight;
suggestionButton.textContent = suggestion.label;

// WRONG: Never use innerHTML with LLM content
insightTextEl.innerHTML = insightResponse.insight;  // XSS RISK!
```

**Rendering rules:**
1. **Insight text:** Use `element.textContent = insight` - never innerHTML
2. **Suggestion labels:** Use `button.textContent = label` - never innerHTML
3. **Suggestion queries:** Stored in data attributes or JS variables, not rendered as HTML
4. **sessionStorage:** Use `JSON.stringify()` for serialization (already safe)

**Why this matters:**
- LLM outputs can contain user-influenced content (patient names, test names from OCR)
- Malicious PDF content could inject `<script>` tags into extracted text
- textContent automatically escapes all HTML entities

### 10. Logging

**Server-side console logging (minimal):**

```javascript
// In onboarding.js
logger.info({ userId, event: 'onboarding_insight_requested', report_count: report_ids.length });
logger.info({ userId, event: 'onboarding_insight_generated', suggestion_count: suggestions.length });
logger.error({ userId, event: 'onboarding_insight_failed', error: err.message });

// In labReportProcessor.js (existing, no change)
// Already logs job completion

// In chatStream.js
logger.info({ userId, event: 'onboarding_chat_initiated', query: selectedQuery.substring(0, 50) });
```

---

## File Changes Summary

### New Files

| File | Purpose |
|------|---------|
| `public/landing.html` | Onboarding landing page HTML |
| `public/css/landing.css` | Landing page styles |
| `public/js/landing.js` | Landing page state machine and logic |
| `server/routes/onboarding.js` | Onboarding API routes |
| `prompts/first_insight.md` | LLM prompt for insight generation |

### Modified Files

| File | Change |
|------|--------|
| `server/app.js` | Register onboarding routes |
| `public/js/app.js` or `public/js/chat.js` | Handle onboarding context on load |
| `server/routes/chatStream.js` | Seed conversation with onboarding context |
| `CLAUDE.md` | Document onboarding feature |

---

## Acceptance Criteria

### Landing Page

- [ ] New users (0 patients AND 0 reports) are redirected to `/landing.html`
- [ ] Returning users (any reports) are redirected to `/index.html` from landing
- [ ] Upload button opens file picker (supports PDF, PNG, JPEG, HEIC)
- [ ] Drag-and-drop works for file upload
- [ ] Progress bar shows during OCR processing
- [ ] Progress messages update: "Uploading..." → "Extracting health markers..."
- [ ] Multiple files show aggregate progress ("2 of 3 complete")
- [ ] Insight card appears after all OCR jobs complete
- [ ] Insight is personalized to actual lab results
- [ ] 2-4 suggestion buttons appear, text is contextual to results
- [ ] Clicking suggestion stores context and redirects to index.html

### Insight Generation

- [ ] `POST /api/onboarding/insight` accepts array of report IDs
- [ ] Returns insight + suggestions within 30 seconds
- [ ] Handles all-normal results with positive messaging
- [ ] Handles out-of-range values with factual, non-alarming tone
- [ ] Includes encouragement to upload more reports
- [ ] Includes one actionable health tip
- [ ] On timeout: returns error with `retryable: true`
- [ ] On failure after 3 retries: returns fallback generic insight

### Main App Integration

- [ ] Index.html detects `onboarding_context` in sessionStorage
- [ ] Creates chat session with correct patient
- [ ] Pre-fills chat input with selected question
- [ ] Auto-submits message (no user click required)
- [ ] Streaming response begins immediately
- [ ] Conversation context includes the original insight
- [ ] sessionStorage is cleared after processing

### Error Handling

- [ ] OCR failure shows retry button
- [ ] Insight generation failure shows retry button
- [ ] Network errors show appropriate message
- [ ] Partial upload success proceeds with completed files
- [ ] After 3 retries, shows fallback and "Go to app" option

### Design

- [ ] Uses existing design tokens (colors, fonts, spacing)
- [ ] Animations are subtle and smooth (no jarring effects)
- [ ] Desktop layout is centered, max-width ~480px
- [ ] Mobile layout is functional but not optimized (desktop-first for MVP)

---

## Out of Scope (v5.0)

- Gmail import on landing page (hidden, only in main app)
- Mobile-optimized design (desktop-first)
- Onboarding completion tracking in database
- Skip/bypass option
- Onboarding analytics beyond console logging
- Patient name confirmation before upload (uses OCR auto-create)
- Video/demo content (text-only for MVP)

---

## Future Considerations (Post-MVP)

1. **Gmail fast-track:** After first manual upload success, show "Have lots of labs? Import from Gmail" prompt
2. **Mobile UX:** Dedicated mobile design with touch-friendly upload
3. **Onboarding analytics:** Track funnel metrics (started → uploaded → insight viewed → chat initiated)
4. **Sample data:** "Try with example report" for users without their own labs
5. **Returning user re-engagement:** If user uploads new report, show mini-insight before going to chat
