# PRD — Gmail Integration (Step-2)

**Version:** 2.8.0
**Status:** Ready for Implementation
**Scope:** Body-aware, attachment-aware classification; no OCR or attachment downloads
**Model:** Same as Step-1 (EMAIL_CLASSIFIER_MODEL from .env)
**Mode:** Dev-only, ephemeral (no DB writes)
**Requirements:** Node.js 16.14.0+ (for URL-safe base64 decoding)
**Last Updated:** 2025-11-03

---

## 1) Objective

Extend the Step-1 Gmail integration to fetch **full email content (body + headers)** and **attachment metadata**, then use **LLM reasoning (language-agnostic, content-only)** to identify which emails are truly **clinical lab result notifications**.

The outcome is a refined **final list of emails** that are likely to contain genuine lab test reports with attachments, ready for possible OCR extraction in a later stage.

**Key Difference from Step-1:** Analyze full email body content and attachment presence, not just subject/sender metadata.

---

## 2) Goals

- ✅ Use OpenAI LLM (same model as Step-1) to analyze the **email body** (any language) and decide whether it describes real **clinical lab test results**.
- ✅ Rely solely on **message content and structure** — no provider rules, no phrase heuristics, no language restrictions.
- ✅ Inspect **attachment metadata** (type, filename, size, inline flag) to detect whether a message likely includes **result documents**.
- ✅ Display the refined list of emails in the developer UI, without downloading or processing attachments.
- ⚙️ Keep all logic **ephemeral** and **dev-only** (no persistence, no database writes).

---

## 3) Non-Goals

- ❌ No attachment downloads or OCR.
- ❌ No vendor/provider allow or deny lists.
- ❌ No language-based branching or localized rules.
- ❌ No data persistence.
- ❌ No A/B testing, dry-run mode, or export functionality.

---

## 4) Flow Overview

### A. Input Set
- Fetch all emails from Gmail inbox (up to `GMAIL_MAX_EMAILS=200`).
- **Optimization:** Filter by attachment presence FIRST (fast, free), then classify only emails with relevant attachments (expensive).

### B. Fetch Full Messages and Attachment Metadata
Gmail API call: `users.messages.get(id, format='full')`

**Body Extraction:**
- Walk Gmail's nested `payload.parts[]` structure recursively
- Concatenate all text parts into a single body string
- Preference: text/plain > text/html
- **Base64 decode body data using URL-safe encoding**: `Buffer.from(data, 'base64url').toString('utf8')`
  - ⚠️ Gmail uses URL-safe base64 (RFC 4648 §5) - standard 'base64' will produce corrupted output
- Basic HTML stripping (remove tags with simple regex: `body.replace(/<[^>]*>/g, '')`)
- Collapse whitespace: `body.replace(/\s+/g, ' ').trim()`
- Truncate to `GMAIL_MAX_BODY_CHARS` (default 8000 characters to stay under token limits)

**Attachment Metadata Extraction:**
- Walk Gmail's nested `payload.parts[]` structure recursively
- Identify parts with `filename` property (non-empty string)
- For each attachment part:
  - Extract: `filename`, `mimeType`, `body.size`, `body.attachmentId`
  - Detect inline: Check part headers for `Content-Disposition: inline` OR `Content-ID` header presence
  - Return array: `[{filename, mimeType, size, attachmentId, isInline}]`

**Output:** `{id, subject, from, date, body, attachments[]}`

### C. Attachment Pre-Filter (Fast, Free)
Before expensive LLM classification, filter emails by attachment criteria:
- Has at least one attachment where:
  - `mimeType` ∈ `[application/pdf, image/png, image/jpeg, image/jpg, image/tiff]`
  - `isInline == false`
  - `size <= GMAIL_MAX_ATTACHMENT_MB * 1024 * 1024` (default 15 MB)

**Result:** Only ~10-30% of emails pass to LLM stage (massive cost savings).

### D. LLM Classification (Content-Only)
- **Model:** `process.env.EMAIL_CLASSIFIER_MODEL || process.env.SQL_GENERATOR_MODEL`
- **API:** Same structure as Step-1 (`client.responses.parse()` with `input` array)
- **Batch Size:** 30 emails per batch (larger bodies = fewer per batch than Step-1's 50)
- **Prompt:** Load from `prompts/gmail_body_classifier.txt`

**Input per email:**
```javascript
{
  id: "msg_123",
  subject: "Lab Results Available",
  from: "noreply@quest.com",
  date: "2025-11-01",
  body_excerpt: "Dear Patient, Your recent blood work...", // Truncated to limit
  attachments_summary: "1 PDF (lab_results.pdf, 245KB)"
}
```

**Output per email:**
```javascript
{
  id: "msg_123",
  is_clinical_results_email: true,
  confidence: 0.92,
  reason: "Email body mentions blood work results and references attached lab report"
}
```

**LLM JSON Schema:** (same structure as Step-1, different field names)
```json
{
  "type": "object",
  "properties": {
    "classifications": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {"type": "string"},
          "is_clinical_results_email": {"type": "boolean"},
          "confidence": {"type": "number"},
          "reason": {"type": "string"}
        },
        "required": ["id", "is_clinical_results_email", "confidence", "reason"]
      }
    }
  },
  "required": ["classifications"]
}
```

### E. Final Selection Logic
Include an email in the **final results list** if:
1. ✅ Has at least one supported, non-inline attachment (already pre-filtered in step C)
2. ✅ `is_clinical_results_email == true` with `confidence >= GMAIL_BODY_ACCEPT_THRESHOLD` (default 0.70)

**Output Structure (final results array contains ONLY accepted lab result emails):**
```javascript
{
  results: [
    {
      id: "msg_123",
      subject: "Lab Results Available",
      from: "noreply@quest.com",
      date: "2025-11-01T10:30:00Z",
      body_excerpt: "Dear Patient, Your recent blood work...", // First 200 chars for display
      attachments: [{
        filename: "lab_results.pdf",
        mimeType: "application/pdf",
        size: 245760,
        attachmentId: "ANGjdJ8w..." // Gmail attachment ID for Step-3 download
      }],
      confidence: 0.92, // All results have confidence >= threshold by definition
      reason: "Email body mentions blood work results and references attached lab report"
    }
    // Only emails with clinical content + supported attachments + confidence >= threshold
  ],
  stats: {
    total_fetched: 200,           // All emails from inbox
    with_attachments: 45,          // Emails with supported PDF/image attachments
    llm_classified: 42,            // Emails SENT to LLM (attachment-qualified with non-empty bodies)
    classification_errors: 0,      // Emails that failed LLM classification (API errors)
    final_results: 12              // Accepted lab result emails (in results array)
  },
  threshold: 0.70 // Actual threshold used (from GMAIL_BODY_ACCEPT_THRESHOLD)
}
```

---

## 5) Configuration (Environment Variables)

**Add to `.env` and `.env.example`:**

```bash
# Gmail Integration Step-2 (Body & Attachment Analysis)
GMAIL_MAX_BODY_CHARS=8000                                    # Max body text characters (default 8000)
GMAIL_BODY_ACCEPT_THRESHOLD=0.70                             # LLM confidence threshold (default 0.70)
GMAIL_ALLOWED_MIME=application/pdf,image/png,image/jpeg,image/jpg,image/tiff
GMAIL_MAX_ATTACHMENT_MB=15                                   # Max attachment size in MB (default 15)
```

**Reused from Step-1:**
- `GMAIL_MAX_EMAILS=200`
- `GMAIL_CONCURRENCY_LIMIT=20` (consider reducing to 10 for full message fetches)

**Model Selection (same fallback chain as Step-1):**
1. `EMAIL_CLASSIFIER_MODEL` (if set) → use this model
2. `SQL_GENERATOR_MODEL` (if set and EMAIL_CLASSIFIER_MODEL not set) → use this model
3. `gpt-5-mini` (if neither set) → default fallback

**Example:**
- If `EMAIL_CLASSIFIER_MODEL=gpt-4o` → uses `gpt-4o`
- If only `SQL_GENERATOR_MODEL=gpt-4-turbo` → uses `gpt-4-turbo`
- If neither set → uses `gpt-5-mini`

**Note:** Step-2 uses the same OpenAI API structure (`responses.parse()`) and fallback logic as Step-1.

---

## 6) Dev UI Updates

**Extend existing `public/gmail-dev.html` and `public/js/gmail-dev.js`:**

### Table Columns
| Column | Description |
|--------|-------------|
| Subject | Email subject (truncated, hover for full) |
| From | Sender email |
| Date | Formatted date |
| **Confidence** | LLM confidence percentage (all >= threshold) |
| **Attachments** | Count + list (filename, type, size) - inline excluded |
| **Reason** | LLM explanation why this is a clinical results email |

**Note:** Table shows **only accepted emails** (clinical + supported attachments + confidence >= threshold).

### Statistics Panel
Display after job completion:
```
📊 Processing Summary:
- Total Fetched: 200 emails
- With Supported Attachments: 45 (22%)
- LLM Classified: 45
- ✅ Final Lab Results: 12 (6% of total, 27% of classified)

Applied Filters:
✓ PDF/image attachments only
✓ Clinical content (LLM confidence >= 70%)
✓ Non-inline attachments only

⚠️ If classification_errors > 0, display warning:
"⚠️ {count} emails failed classification due to API errors. Check server logs for details."
```

### Loading States
- "Fetching full email content..." (0-10s)
- "Filtering by attachments..." (instant)
- "Classifying with AI (X/Y batches)..." (10-40s)
- "Merging results..." (instant)

---

## 7) Error Handling & Safeguards

| Scenario | Behavior |
|----------|----------|
| Body text missing | Skip LLM classification, mark as rejected (reason: "No body content") |
| Body too large | Truncate to `GMAIL_MAX_BODY_CHARS` |
| LLM API fails | Retry once, then mark batch as failed (job continues) |
| LLM returns malformed JSON | Log error, mark emails as uncertain (excluded from results) |
| Gmail API 429 rate limit | Fail job with clear error message (user retries manually) |
| Attachment metadata malformed | Skip attachment, log warning, continue |
| No attachments found | Skip LLM classification, exclude from results (reason: "No supported attachments") |

**Privacy & Security:**
- ❌ NEVER log email body content
- ❌ NEVER log email subjects or sender addresses
- ✅ Log only: counts, job status, error types, timings
- ✅ All data ephemeral (no DB writes)

**Graceful Degradation:**
- Individual email fetch failures don't stop the entire job
- LLM batch failures are isolated (other batches continue)
- UI shows partial results if some batches succeed

---

## 8) Cost & Performance Analysis

### Token Usage (per email)
| Stage | Tokens | Notes |
|-------|--------|-------|
| System Prompt | 300 | One-time per batch |
| Email Input | ~2,500 | Subject (20) + From (20) + Body (2000) + Attachments (50) |
| Output | ~50 | Structured JSON response |
| **Total per email** | **~2,850** | |

### Cost Estimate (200 emails, 45 with attachments)
| Scenario | Tokens | Cost (gpt-4o-mini at $0.15/$0.60 per 1M) |
|----------|--------|------------------------------------------|
| Step-1 (metadata only) | 200 × 350 = 70K | ~$0.02 |
| Step-2 (all emails) | 200 × 2,850 = 570K | ~$0.20 |
| **Step-2 (optimized)** | **45 × 2,850 = 128K** | **~$0.04** |

**Optimization impact:** 78% cost reduction by pre-filtering attachments.

### Performance (200 emails)
| Operation | Time | Notes |
|-----------|------|-------|
| Fetch full messages (20 concurrent) | 10-15s | Larger payloads than Step-1 |
| Filter by attachments | <100ms | Local, synchronous |
| LLM classification (2 batches) | 15-30s | Only ~45 emails with attachments |
| Merge results | <50ms | Local, synchronous |
| **Total** | **25-45s** | Acceptable for dev |

---

## 9) Implementation Details

### A. Update `server/services/gmailConnector.js`

**Add helper functions:**

```javascript
/**
 * Recursively extract body text from Gmail payload parts
 * @param {object} payload - Gmail message payload
 * @returns {string} Concatenated body text
 */
function extractEmailBody(payload) {
  let bodyText = '';

  function walkParts(part) {
    // Single-part message (body directly in payload)
    if (part.body && part.body.data) {
      // Gmail uses URL-safe base64 (RFC 4648 §5) - requires Node.js 16.14.0+
      const decoded = Buffer.from(part.body.data, 'base64url').toString('utf8');
      // Prefer text/plain
      if (part.mimeType === 'text/plain') {
        bodyText = decoded + '\n' + bodyText;
      } else if (part.mimeType === 'text/html' && !bodyText) {
        // Fallback to HTML if no plain text found
        bodyText = decoded;
      }
    }

    // Multipart message (recurse into parts)
    if (part.parts && Array.isArray(part.parts)) {
      part.parts.forEach(walkParts);
    }
  }

  walkParts(payload);

  // Strip HTML tags
  bodyText = bodyText.replace(/<[^>]*>/g, '');
  // Collapse whitespace
  bodyText = bodyText.replace(/\s+/g, ' ').trim();
  // Truncate
  const maxChars = parseInt(process.env.GMAIL_MAX_BODY_CHARS) || 8000;
  if (bodyText.length > maxChars) {
    bodyText = bodyText.substring(0, maxChars) + '...';
  }

  return bodyText;
}

/**
 * Extract attachment metadata from Gmail payload parts
 * @param {object} payload - Gmail message payload
 * @returns {array} Array of attachment metadata objects
 */
function extractAttachmentMetadata(payload) {
  const attachments = [];

  function walkParts(part) {
    // Check if part has a filename (indicates attachment)
    if (part.filename && part.filename.length > 0) {
      // Validate attachment metadata per §7 safeguard: "Attachment metadata malformed → Skip attachment, log warning, continue"
      try {
        // Validate filename (type, length, no null bytes)
        if (typeof part.filename !== 'string' || part.filename.length > 255 || part.filename.includes('\0')) {
          logger.warn('[gmailConnector] Skipping attachment with invalid filename (too long or contains null bytes)');
          return; // Skip this attachment, continue with others
        }

        // Validate size (must be valid non-negative integer)
        const size = parseInt(part.body?.size);
        if (isNaN(size) || size < 0) {
          logger.warn(`[gmailConnector] Skipping attachment "${part.filename}" with invalid size: ${part.body?.size}`);
          return; // Skip this attachment, continue with others
        }

        // Validate attachmentId (required, non-empty string)
        const attachmentId = part.body?.attachmentId;
        if (!attachmentId || typeof attachmentId !== 'string' || attachmentId.trim().length === 0) {
          logger.warn(`[gmailConnector] Skipping attachment "${part.filename}" with missing or invalid attachmentId`);
          return; // Skip this attachment, continue with others
        }

        // Validate mimeType (must be non-empty string if present)
        const mimeType = part.mimeType || 'application/octet-stream';
        if (typeof mimeType !== 'string' || mimeType.length === 0) {
          logger.warn(`[gmailConnector] Skipping attachment "${part.filename}" with invalid mimeType`);
          return; // Skip this attachment, continue with others
        }

        // Check for inline disposition
        let isInline = false;
        if (part.headers && Array.isArray(part.headers)) {
          const contentDisposition = part.headers.find(h =>
            h.name.toLowerCase() === 'content-disposition'
          );
          const contentId = part.headers.find(h =>
            h.name.toLowerCase() === 'content-id'
          );
          isInline = (contentDisposition?.value?.includes('inline')) || !!contentId;
        }

        // All validations passed, add attachment
        attachments.push({
          filename: part.filename,
          mimeType,
          size,
          attachmentId,
          isInline
        });
      } catch (error) {
        // Catch any unexpected errors during validation
        logger.warn(`[gmailConnector] Skipping malformed attachment "${part.filename}": ${error.message}`);
        // Continue processing other attachments
      }
    }

    // Recurse into nested parts
    if (part.parts && Array.isArray(part.parts)) {
      part.parts.forEach(walkParts);
    }
  }

  walkParts(payload);
  return attachments;
}
```

**Update `fetchEmailMetadata()` → `fetchFullEmails()`:**

```javascript
/**
 * Fetch full email content including body and attachments
 * @returns {Promise<Array>} Array of email objects with full content
 */
async function fetchFullEmails() {
  const authenticated = await isAuthenticated();
  if (!authenticated) {
    throw new Error('Not authenticated with Gmail');
  }

  try {
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    logger.info('[gmailConnector] Fetching email IDs from inbox');

    // Step 1: List message IDs
    const listResponse = await gmail.users.messages.list({
      userId: 'me',
      q: 'in:inbox',
      maxResults: GMAIL_MAX_EMAILS
    });

    const messages = listResponse.data.messages || [];

    if (messages.length === 0) {
      logger.info('[gmailConnector] No emails found in inbox');
      return [];
    }

    logger.info(`[gmailConnector] Found ${messages.length} emails, fetching full content`);

    // Step 2: Fetch full messages in parallel
    const limit = pLimit(GMAIL_CONCURRENCY_LIMIT);

    const emailPromises = messages.map(({ id }) =>
      limit(async () => {
        try {
          const response = await gmail.users.messages.get({
            userId: 'me',
            id,
            format: 'full'  // Changed from 'metadata'
          });

          const headers = response.data.payload.headers || [];
          const subject = headers.find(h => h.name === 'Subject')?.value || '';
          const from = headers.find(h => h.name === 'From')?.value || '';
          const date = headers.find(h => h.name === 'Date')?.value || '';

          // Extract body and attachments
          const body = extractEmailBody(response.data.payload);
          const attachments = extractAttachmentMetadata(response.data.payload);

          return {
            id,
            subject: decodeMimeHeader(subject),
            from: decodeMimeHeader(from),
            date,
            body,
            attachments
          };
        } catch (error) {
          // Check for Gmail API rate limit (429) - fail job immediately per §7
          if (error.code === 429 || error.message?.includes('429') || error.message?.includes('rate limit')) {
            logger.error('[gmailConnector] Gmail API rate limit hit (429), failing job');
            throw new Error('Gmail API rate limit exceeded (429). Please wait and try again.');
          }

          // For other errors, log but continue with placeholder (graceful degradation)
          logger.error(`[gmailConnector] Failed to fetch full message ${id}:`, error.message);
          return {
            id,
            subject: '[Error fetching]',
            from: '[Error fetching]',
            date: '',
            body: '',
            attachments: []
          };
        }
      })
    );

    const emails = await Promise.all(emailPromises);

    logger.info(`[gmailConnector] Successfully fetched ${emails.length} full emails`);

    return emails;
  } catch (error) {
    logger.error('[gmailConnector] Failed to fetch full emails:', error.message);
    throw error;
  }
}
```

**Export new function:**
```javascript
module.exports = {
  // ... existing exports
  fetchFullEmails  // Add this
};
```

### B. Create `server/services/bodyClassifier.js`

```javascript
/**
 * Body Classifier Service
 * Analyzes email body content to identify clinical lab results
 * PRD: docs/PRD_v2_8_Gmail_Integration_Step2.md
 */

const OpenAI = require('openai');
const pino = require('pino');
const pLimit = require('p-limit');
const { loadPrompt } = require('../utils/promptLoader');

const NODE_ENV = process.env.NODE_ENV || 'development';

const logger = pino({
  transport: NODE_ENV === 'development' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss',
      ignore: 'pid,hostname',
    },
  } : undefined,
});

// Configuration
const DEFAULT_MODEL = process.env.EMAIL_CLASSIFIER_MODEL || process.env.SQL_GENERATOR_MODEL || 'gpt-5-mini';
const BATCH_SIZE = 30; // Reduced from 50 due to larger bodies
const PROMPT_FILE = 'gmail_body_classifier.txt';

let openAiClient;

function getOpenAiClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }
  if (!openAiClient) {
    openAiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openAiClient;
}

/**
 * Filter emails by attachment criteria
 */
function filterByAttachments(emails) {
  // Normalize allow-list: lowercase and trim each MIME type
  // (handles env overrides like "application/PDF, image/PNG ")
  const allowedMimeTypes = (process.env.GMAIL_ALLOWED_MIME ||
    'application/pdf,image/png,image/jpeg,image/jpg,image/tiff')
    .split(',')
    .map(m => m.toLowerCase().trim());
  const maxSizeBytes = (parseInt(process.env.GMAIL_MAX_ATTACHMENT_MB) || 15) * 1024 * 1024;

  return emails.filter(email => {
    if (!email.attachments || email.attachments.length === 0) {
      return false;
    }

    return email.attachments.some(att => {
      // Normalize MIME type: lowercase, strip parameters (e.g., "application/PDF; charset=binary" → "application/pdf")
      const normalizedMime = (att.mimeType || '').toLowerCase().split(';')[0].trim();
      return !att.isInline &&
        allowedMimeTypes.includes(normalizedMime) &&
        att.size <= maxSizeBytes;
    });
  });
}

/**
 * Format attachment summary for LLM input
 */
function formatAttachmentsSummary(attachments) {
  if (!attachments || attachments.length === 0) return 'None';

  const supported = attachments.filter(a => !a.isInline);
  if (supported.length === 0) return 'None (only inline images)';

  return supported.map(a => {
    const sizeMB = (a.size / 1024 / 1024).toFixed(2);
    const ext = a.filename.split('.').pop()?.toUpperCase() || '?';
    return `${ext} (${a.filename}, ${sizeMB}MB)`;
  }).join(', ');
}

/**
 * Classification schema
 */
const CLASSIFICATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    classifications: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          is_clinical_results_email: { type: 'boolean' },
          confidence: { type: 'number' },
          reason: { type: 'string' }
        },
        required: ['id', 'is_clinical_results_email', 'confidence', 'reason']
      }
    }
  },
  required: ['classifications']
};

/**
 * Classify batch of emails
 */
async function classifyBatch(emailBatch, systemPrompt) {
  const client = getOpenAiClient();

  // Format input with body and attachment info
  const formattedBatch = emailBatch.map(email => ({
    id: email.id,
    subject: email.subject,
    from: email.from,
    date: email.date,
    body_excerpt: email.body.substring(0, 8000), // Ensure limit
    attachments_summary: formatAttachmentsSummary(email.attachments)
  }));

  const requestPayload = {
    model: DEFAULT_MODEL,
    input: [
      {
        role: 'system',
        content: [{ type: 'input_text', text: systemPrompt }]
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: JSON.stringify(formattedBatch) }]
      }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'gmail_body_classification',
        strict: true,
        schema: CLASSIFICATION_SCHEMA
      }
    }
  };

  logger.info(`[bodyClassifier] Classifying batch of ${emailBatch.length} emails`);

  let response;
  let retryCount = 0;
  const MAX_RETRIES = 1;

  while (retryCount <= MAX_RETRIES) {
    try {
      response = await client.responses.parse(requestPayload);
      logger.info('[bodyClassifier] Batch classified successfully');
      break;
    } catch (error) {
      retryCount++;
      if (retryCount > MAX_RETRIES) {
        logger.error(`[bodyClassifier] Failed to classify batch after ${MAX_RETRIES} retry:`, error.message);
        // Return "uncertain" classifications instead of throwing (graceful degradation)
        return emailBatch.map(email => ({
          id: email.id,
          is_clinical_results_email: false,
          confidence: 0,
          reason: 'Classification failed (API error)'
        }));
      }

      logger.warn(`[bodyClassifier] Retry ${retryCount}/${MAX_RETRIES} after error:`, error.message);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Brief delay before retry
    }
  }

  const parsed = response?.output_parsed;

  if (!parsed || !Array.isArray(parsed.classifications)) {
    logger.error('[bodyClassifier] Invalid response format from OpenAI');
    // Return "uncertain" classifications instead of throwing (graceful degradation)
    return emailBatch.map(email => ({
      id: email.id,
      is_clinical_results_email: false,
      confidence: 0,
      reason: 'Classification failed (malformed response)'
    }));
  }

  return parsed.classifications;
}

/**
 * Classify emails with body content
 */
async function classifyEmailBodies(emails) {
  if (!Array.isArray(emails) || emails.length === 0) {
    logger.info('[bodyClassifier] No emails to classify');
    return [];
  }

  logger.info(`[bodyClassifier] Starting classification of ${emails.length} emails with body content`);

  const systemPrompt = loadPrompt(PROMPT_FILE);

  // Filter by attachments FIRST (before expensive LLM calls)
  const emailsWithAttachments = filterByAttachments(emails);
  logger.info(`[bodyClassifier] Filtered to ${emailsWithAttachments.length}/${emails.length} emails with supported attachments`);

  if (emailsWithAttachments.length === 0) {
    return [];
  }

  // Filter out empty bodies (deterministic rejection per §7)
  const emailsWithBodies = emailsWithAttachments.filter(email => {
    return email.body && email.body.trim().length > 0;
  });

  // Track emails with empty bodies for deterministic rejection (skip LLM call)
  const emptyBodyRejections = emailsWithAttachments
    .filter(email => !email.body || email.body.trim().length === 0)
    .map(email => ({
      id: email.id,
      is_clinical_results_email: false,
      confidence: 0,
      reason: 'No body content'
    }));

  logger.info(`[bodyClassifier] ${emptyBodyRejections.length} emails skipped (no body content), ${emailsWithBodies.length} ready for LLM`);

  if (emailsWithBodies.length === 0) {
    logger.info('[bodyClassifier] No emails with body content to classify');
    return emptyBodyRejections; // Return only deterministic rejections
  }

  // Split into batches (only emails with bodies)
  const batches = [];
  for (let i = 0; i < emailsWithBodies.length; i += BATCH_SIZE) {
    batches.push(emailsWithBodies.slice(i, i + BATCH_SIZE));
  }

  logger.info(`[bodyClassifier] Processing ${batches.length} batches of up to ${BATCH_SIZE} emails each`);

  // Process batches sequentially (graceful degradation: failed batches return "uncertain" classifications)
  const limit = pLimit(1);

  const batchResults = await Promise.all(
    batches.map((batch, index) =>
      limit(async () => {
        logger.info(`[bodyClassifier] Processing batch ${index + 1}/${batches.length}`);
        return await classifyBatch(batch, systemPrompt);
      })
    )
  );

  // Merge LLM classifications with deterministic empty-body rejections
  const llmClassifications = batchResults.flat();
  const allClassifications = [...llmClassifications, ...emptyBodyRejections];

  logger.info(`[bodyClassifier] Classification complete: ${llmClassifications.length} LLM-classified, ${emptyBodyRejections.length} rejected (no body), ${allClassifications.length} total`);

  return allClassifications;
}

module.exports = {
  classifyEmailBodies,
  filterByAttachments
};
```

### C. Create `prompts/gmail_body_classifier.txt`

```
You are an email body classifier for a healthcare application. Your task is to analyze full email content (subject, sender, body text, and attachment info) and determine if each email is a clinical lab test results notification.

CRITICAL REQUIREMENTS:
1. For each email in the input array, you MUST return a classification object with the EXACT 'id' value from that email.
2. DO NOT modify, truncate, generate, or omit any ID values. Copy them verbatim from the input.
3. If you cannot classify an email, still return its exact ID with is_clinical_results_email: false.

Classification guidelines:
- is_clinical_results_email: true if the email body content clearly indicates it's notifying the recipient about available clinical lab test results
- confidence: 0.0-1.0 score (0.8+ for clear indicators, 0.6-0.8 for moderate, <0.6 for weak)
- reason: Brief explanation (15-30 words) of why this email is/isn't a clinical results notification

TRUE CLINICAL RESULTS EMAILS (is_clinical_results_email: true):
- Body explicitly mentions lab results, test results, blood work, pathology reports, or diagnostic test results are ready/available
- Body references specific medical tests (CBC, cholesterol, vitamin D, A1C, thyroid panel, etc.)
- Body states results can be viewed, downloaded, or are attached
- Language like: "Your results are ready", "Lab work completed", "Test results available", "View your results"
- Sender from: medical labs (Quest, LabCorp), hospitals, clinics, patient portals (MyChart, FollowMyHealth, etc.)
- Has PDF or image attachments with medical-sounding filenames

FALSE POSITIVES TO REJECT (is_clinical_results_email: false):
- Appointment reminders or confirmations (even from medical providers)
- Billing statements, insurance claims, payment due notices
- Marketing emails from healthcare providers (even if mentioning "test" or "results")
- General health tips, newsletters, wellness articles
- Prescription refill notifications
- Telemedicine appointment links
- Patient portal registration/password reset emails
- Health insurance enrollment or benefits information
- Medical device/supply orders
- Emails that mention "results" in a non-medical context

Important:
- Use BOTH body content AND subject/sender to make the decision
- Body content is the PRIMARY signal - if body doesn't clearly indicate clinical results, mark as false even if subject suggests it
- Be conservative: if uncertain or body is vague, mark as unlikely with low confidence
- Ignore inline images/attachments - only consider regular attachments
- Language-agnostic: analyze meaning, not specific phrases

Return format: JSON object with a "classifications" array containing {id, is_clinical_results_email, confidence, reason} for EVERY email.

Example output:
{
  "classifications": [
    {
      "id": "abc123",
      "is_clinical_results_email": true,
      "confidence": 0.92,
      "reason": "Body states 'Your lab results from blood work on Nov 1 are ready to view' with PDF attachment named lab_results.pdf"
    },
    {
      "id": "def456",
      "is_clinical_results_email": false,
      "confidence": 0.25,
      "reason": "Appointment reminder email, body only mentions upcoming visit, no lab results referenced"
    }
  ]
}
```

### D. Update `server/routes/gmailDev.js`

**Replace fetch route handler:**

```javascript
const { fetchFullEmails } = require('../services/gmailConnector');
const { classifyEmailBodies, filterByAttachments } = require('../services/bodyClassifier');

router.post('/fetch', async (req, res) => {
  try {
    logger.info('[gmailDev] Fetch request received (Step-2: body analysis)');

    const authenticated = await isAuthenticated();

    if (!authenticated) {
      logger.warn('[gmailDev] Fetch failed - not authenticated');
      return res.status(401).json({
        error: 'Gmail authentication required',
        message: 'Please connect your Gmail account first'
      });
    }

    const jobId = createJob('dev-gmail-step2', {
      emailCount: parseInt(process.env.GMAIL_MAX_EMAILS) || 200
    });

    logger.info(`[gmailDev] Job created: ${jobId}`);

    setImmediate(async () => {
      try {
        logger.info(`[gmailDev:${jobId}] Starting Step-2 processing (body + attachments)`);

        updateJob(jobId, JobStatus.PROCESSING);

        // Fetch full emails with body and attachments
        const emails = await fetchFullEmails();

        if (emails.length === 0) {
          logger.info(`[gmailDev:${jobId}] No emails found, completing with empty results`);
          const threshold = parseFloat(process.env.GMAIL_BODY_ACCEPT_THRESHOLD) || 0.70;
          setJobResult(jobId, {
            results: [],
            stats: {
              total_fetched: 0,
              with_attachments: 0,
              llm_classified: 0,
              classification_errors: 0,
              final_results: 0
            },
            threshold
          });
          return;
        }

        logger.info(`[gmailDev:${jobId}] Fetched ${emails.length} full emails`);

        // Filter by attachments (fast, free)
        const emailsWithAttachments = filterByAttachments(emails);
        logger.info(`[gmailDev:${jobId}] ${emailsWithAttachments.length}/${emails.length} have supported attachments`);

        // Classify only emails with attachments
        const classifications = await classifyEmailBodies(emails); // Includes filtering internally

        logger.info(`[gmailDev:${jobId}] Classification complete, filtering accepted results`);

        // Filter to only accepted emails (clinical + supported attachments + confidence >= threshold)
        const threshold = parseFloat(process.env.GMAIL_BODY_ACCEPT_THRESHOLD) || 0.70;

        const results = emails
          .map(email => {
            const classification = classifications.find(c => c.id === email.id);
            // Check if email passed the MIME/size filter
            const hasSupportedAttachments = emailsWithAttachments.some(e => e.id === email.id);

            // Acceptance criteria per §4E (with null-safe checks)
            const isAccepted =
              hasSupportedAttachments &&
              classification?.is_clinical_results_email === true &&
              classification?.confidence != null &&
              classification.confidence >= threshold;

            return {
              email,
              classification,
              hasSupportedAttachments,
              isAccepted
            };
          })
          .filter(item => item.isAccepted) // Only include accepted emails
          .map(item => {
            // Filter attachments by same criteria as email filtering (MIME type, size, non-inline)
            const allowedMimeTypes = (process.env.GMAIL_ALLOWED_MIME ||
              'application/pdf,image/png,image/jpeg,image/jpg,image/tiff')
              .split(',')
              .map(m => m.toLowerCase().trim());
            const maxSizeBytes = (parseInt(process.env.GMAIL_MAX_ATTACHMENT_MB) || 15) * 1024 * 1024;

            const supportedAttachments = item.email.attachments.filter(a => {
              const normalizedMime = (a.mimeType || '').toLowerCase().split(';')[0].trim();
              return !a.isInline &&
                allowedMimeTypes.includes(normalizedMime) &&
                a.size <= maxSizeBytes;
            });

            return {
              id: item.email.id,
              subject: item.email.subject,
              from: item.email.from,
              date: item.email.date,
              body_excerpt: item.email.body.substring(0, 200), // First 200 chars for UI
              attachments: supportedAttachments.map(a => ({
                filename: a.filename,
                mimeType: a.mimeType,
                size: a.size,
                attachmentId: a.attachmentId // Required for Step-3 OCR download
              })),
              confidence: item.classification.confidence,
              reason: item.classification.reason
            };
          });

        // Count classification errors (confidence: 0 with "Classification failed" reason)
        const classificationErrors = classifications.filter(c =>
          c.confidence === 0 && c.reason?.includes('Classification failed')
        ).length;

        // Count empty body rejections (deterministic, not sent to LLM)
        const emptyBodyRejections = classifications.filter(c =>
          c.reason === 'No body content'
        ).length;

        // llm_classified = emails SENT to LLM (excludes empty bodies and errors)
        const llmClassified = classifications.length - emptyBodyRejections - classificationErrors;

        const stats = {
          total_fetched: emails.length,
          with_attachments: emailsWithAttachments.length,
          llm_classified: llmClassified,  // Emails SENT to LLM (attachment-qualified with non-empty bodies)
          classification_errors: classificationErrors,
          final_results: results.length
        };

        logger.info(
          `[gmailDev:${jobId}] Job completed: ${stats.final_results} lab result emails found` +
          (stats.classification_errors > 0 ? ` (${stats.classification_errors} classification errors)` : '')
        );

        setJobResult(jobId, { results, stats, threshold });
      } catch (error) {
        logger.error(`[gmailDev:${jobId}] Job failed:`, error.message);
        setJobError(jobId, error);
      }
    });

    return res.status(202).json({
      job_id: jobId,
      status: 'pending',
      message: 'Email fetch and body classification started. Poll /api/dev-gmail/jobs/:jobId for status.'
    });
  } catch (error) {
    logger.error('[gmailDev] Failed to create fetch job:', error.message);
    return res.status(500).json({
      error: 'Failed to create fetch job',
      message: error.message
    });
  }
});
```

### E. Update UI (`public/js/gmail-dev.js`)

**Update job polling to extract threshold:**

```javascript
// In pollJobStatus, when job.status === 'completed':
if (job.status === 'completed') {
  clearInterval(pollInterval);
  jobLoading.hidden = true;
  fetchBtn.disabled = false;
  fetchBtn.textContent = 'Fetch & Classify Emails';

  const results = job.result?.results || [];
  const stats = job.result?.stats || {};
  const threshold = job.result?.threshold || 0.70; // Fallback for safety

  if (results.length === 0) {
    resultsEmpty.hidden = false;
  } else {
    displayResults(results, stats, threshold); // Pass threshold from backend
  }
}
```

**Update displayResults function to show new columns and stats:**

```javascript
function displayResults(results, stats, threshold) {
  // Update stats panel (guard against division by zero)
  document.getElementById('total-fetched').textContent = stats.total_fetched;
  document.getElementById('with-attachments-count').textContent =
    stats.total_fetched > 0
      ? `${stats.with_attachments} (${((stats.with_attachments/stats.total_fetched)*100).toFixed(0)}%)`
      : `${stats.with_attachments} (0%)`;
  document.getElementById('classified-count').textContent = stats.llm_classified;
  document.getElementById('final-results-count').textContent =
    stats.total_fetched > 0
      ? `${stats.final_results} (${((stats.final_results/stats.total_fetched)*100).toFixed(0)}% of total, ${stats.llm_classified > 0 ? ((stats.final_results/stats.llm_classified)*100).toFixed(0) : 0}% of classified)`
      : `${stats.final_results} (0%)`;
  document.getElementById('threshold-display').textContent = `${(threshold * 100).toFixed(0)}%`;

  // Show error warning if classification failures occurred
  const errorWarning = document.getElementById('classification-error-warning');
  if (stats.classification_errors > 0) {
    errorWarning.textContent = `⚠️ ${stats.classification_errors} emails failed classification due to API errors. Check server logs for details.`;
    errorWarning.hidden = false;
    errorWarning.style.color = '#f59e0b';
    errorWarning.style.padding = '10px';
    errorWarning.style.marginTop = '10px';
    errorWarning.style.backgroundColor = '#fef3c7';
    errorWarning.style.borderLeft = '4px solid #f59e0b';
  } else {
    errorWarning.hidden = true;
  }

  // Clear and populate table (all results are already filtered to accepted only)
  resultsTbody.innerHTML = '';

  if (results.length === 0) {
    const emptyRow = document.createElement('tr');
    const emptyCell = document.createElement('td');
    emptyCell.colSpan = 6;
    emptyCell.textContent = 'No lab result emails found matching criteria';
    emptyCell.style.textAlign = 'center';
    emptyCell.style.padding = '20px';
    emptyCell.style.color = '#9ca3af';
    emptyRow.appendChild(emptyCell);
    resultsTbody.appendChild(emptyRow);
  } else {
    results.forEach(result => {
      const row = document.createElement('tr');

      // Subject column
      const subjectCell = document.createElement('td');
      subjectCell.textContent = result.subject || '(no subject)';
      subjectCell.style.maxWidth = '300px';
      subjectCell.style.overflow = 'hidden';
      subjectCell.style.textOverflow = 'ellipsis';
      subjectCell.title = result.subject;
      row.appendChild(subjectCell);

      // From column
      const fromCell = document.createElement('td');
      fromCell.textContent = result.from || '(unknown)';
      fromCell.style.maxWidth = '200px';
      fromCell.style.overflow = 'hidden';
      fromCell.style.textOverflow = 'ellipsis';
      fromCell.title = result.from;
      row.appendChild(fromCell);

      // Date column
      const dateCell = document.createElement('td');
      const date = new Date(result.date);
      if (!isNaN(date)) {
        dateCell.textContent = date.toLocaleDateString();
        dateCell.title = date.toLocaleString();
      } else {
        dateCell.textContent = result.date ? result.date.substring(0, 16) : '';
      }
      row.appendChild(dateCell);

      // Confidence column (all results pass threshold, show as green)
      const confidenceCell = document.createElement('td');
      confidenceCell.innerHTML = `<span style="color: #16a34a; font-weight: 600;">${(result.confidence * 100).toFixed(0)}%</span>`;
      row.appendChild(confidenceCell);

      // Attachments column
      const attachmentsCell = document.createElement('td');
      if (result.attachments && result.attachments.length > 0) {
        const summary = result.attachments.map(a =>
          `${a.filename} (${(a.size/1024).toFixed(0)}KB)`
        ).join(', ');
        attachmentsCell.textContent = `${result.attachments.length}: ${summary}`;
        attachmentsCell.title = summary;
        attachmentsCell.style.maxWidth = '250px';
        attachmentsCell.style.overflow = 'hidden';
        attachmentsCell.style.textOverflow = 'ellipsis';
      } else {
        attachmentsCell.textContent = 'None';
        attachmentsCell.style.color = '#9ca3af';
      }
      row.appendChild(attachmentsCell);

      // Reason column (why LLM identified as lab result)
      const reasonCell = document.createElement('td');
      reasonCell.textContent = result.reason || 'Clinical lab result identified';
      reasonCell.style.maxWidth = '300px';
      reasonCell.style.overflow = 'hidden';
      reasonCell.style.textOverflow = 'ellipsis';
      reasonCell.title = result.reason;
      row.appendChild(reasonCell);

      resultsTbody.appendChild(row);
    });
  }

  resultsContainer.hidden = false;
}
```

---

## 10) Acceptance Criteria

### Functional
- ✅ Fetches full email bodies and attachment metadata (no downloads)
- ✅ Pre-filters by attachment presence before LLM classification (cost optimization)
- ✅ LLM classifies only emails with supported attachments
- ✅ **Final results contain ONLY accepted emails** (clinical content + supported attachments + confidence >= threshold)
- ✅ UI displays only lab result emails with confidence, attachments, and LLM reasoning
- ✅ Statistics panel shows processing funnel (fetched → attachments → classified → final results)

### Non-Functional
- ✅ Follows existing patterns (job queue, responses.parse(), pino logging)
- ✅ Cost-optimized (filter before classify)
- ✅ No email body content in logs
- ✅ Feature flag enforced (dev-only)
- ✅ Total job time <60s for 200 emails

---

## 11) Testing Checklist

### Backend
- [ ] `extractEmailBody()` handles multipart messages correctly
- [ ] `extractEmailBody()` strips HTML tags
- [ ] `extractEmailBody()` truncates to character limit
- [ ] `extractAttachmentMetadata()` detects inline attachments correctly
- [ ] `extractAttachmentMetadata()` extracts size and mimeType
- [ ] `filterByAttachments()` applies MIME type whitelist
- [ ] `filterByAttachments()` applies size limits
- [ ] `filterByAttachments()` excludes inline attachments
- [ ] `classifyEmailBodies()` processes only filtered emails
- [ ] Job completes with correct stats object

### Frontend
- [ ] Statistics panel displays correct counts
- [ ] Table shows body verdict with confidence
- [ ] Table shows attachment list (filename, size)
- [ ] Table shows acceptance status with reason
- [ ] Filters work correctly
- [ ] Hover tooltips show full text

### Integration
- [ ] End-to-end flow from fetch to UI display
- [ ] Error handling for missing bodies
- [ ] Error handling for LLM failures
- [ ] No sensitive data in server logs

---

**Status:** ✅ Ready for Implementation
**Next Steps:**
1. Add env vars to `.env.example`
2. Create `prompts/gmail_body_classifier.txt`
3. Update `gmailConnector.js` with body/attachment extraction
4. Create `bodyClassifier.js` service
5. Update route handler and UI
