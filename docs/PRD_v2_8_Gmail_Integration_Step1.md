# PRD — Gmail Integration (Step-1 MVP)

**Version:** 2.9.0 (Streamlined)
**Status:** Ready for Implementation
**Owner:** HealthUp Engineering
**Last Updated:** 2025-11-02

---

## 1. Objective

Enable HealthUp (in dev mode) to **connect to a Gmail account**, **retrieve the latest 200 emails** from INBOX, and **use OpenAI** to analyze their **subjects and senders** to identify which messages likely contain **lab test results**.

This MVP is **exploratory** — validating feasibility and building foundation for deeper Gmail ingestion.

---

## 2. Goals

- ✅ Connect to Gmail securely (OAuth 2.0, dev-mode only)
- ✅ Retrieve metadata (subject, sender, date) of latest 200 INBOX emails via **async job queue**
- ✅ Use OpenAI to classify each email as "Likely lab result" or "Unlikely"
- ✅ Display results in **standalone developer UI** with loading states
- ⚙️ Keep all logic **ephemeral** (zero persistence — no DB writes)
- ⚙️ Follow existing HealthUp patterns (job queue, pino logging, feature flags)

---

## 3. Non-Goals

- ❌ No downloading/processing attachments
- ❌ No pushing results into database
- ❌ No Gmail filters or advanced queries
- ❌ No retry logic for failed API calls
- ❌ No production user flow — developer-only feature
- ❌ No OAuth token encryption — local testing only

---

## 4. Architecture Overview

### Components

| Component | Purpose | Location |
|-----------|---------|----------|
| **Gmail Connector Service** | OAuth flow, token management, Gmail API calls | `server/services/gmailConnector.js` |
| **Email Classifier Service** | OpenAI classification using responses.parse() | `server/services/emailClassifier.js` |
| **Gmail Dev Routes** | Thin Express router exposing async job endpoints | `server/routes/gmailDev.js` |
| **Dev UI Page** | Standalone HTML page with results table | `public/gmail-dev.html` |
| **Dev UI JavaScript** | OAuth flow, job polling, results rendering | `public/js/gmail-dev.js` |
| **Classifier Prompt** | System prompt template | `prompts/gmail_lab_classifier.txt` |

---

## 5. Flow Logic

### Step 1 — OAuth Authentication (One-time Setup)

**Initiation:**
1. Developer visits `http://localhost:3000/gmail-dev.html`
2. UI calls `GET /api/dev-gmail/status` to check if already authenticated
3. If not authenticated, clicks **"Connect Gmail Account"**
4. UI calls `GET /api/dev-gmail/auth-url` → returns `{ auth_url: "https://..." }`
5. Service generates cryptographically random `state` token (32 bytes hex), stores in-memory with timestamp
6. UI opens consent URL in new browser window
7. User grants permissions on Google consent screen

**Callback:**
1. Google redirects to `GET /api/dev-gmail/oauth-callback?code=xxx&state=RANDOM_TOKEN`
2. **CSRF Protection**: Service validates `state` parameter matches stored value
3. Service exchanges code for access/refresh tokens
4. Tokens saved to `server/config/gmail-token.json` (directory auto-created, .gitignored)
5. State token deleted (one-time use)
6. Callback page shows success and closes window

**Security:**
- OAuth scope: `https://www.googleapis.com/auth/gmail.readonly` (read-only)
- State tokens expire after 10 minutes
- Tokens stored locally (not committed to git)

### Step 2 — Job Creation

1. User clicks **"Fetch & Classify Emails"**
2. `POST /api/dev-gmail/fetch` checks authentication first
3. If authenticated: creates async job, returns `{ job_id }` (HTTP 202)
4. If not authenticated: returns HTTP 401
5. UI starts polling `GET /api/dev-gmail/jobs/:jobId` every 2 seconds

### Step 3 — Gmail Metadata Retrieval (Background)

1. Job status → `processing`
2. Gmail API `users.messages.list`:
   - Query: `q: "in:inbox"` (excludes SPAM/TRASH)
   - `maxResults=200`
   - Returns array of message IDs
3. **Parallel fetch metadata** (20 concurrent requests using `p-limit`):
   - For each ID: `users.messages.get({ id, format: 'metadata', metadataHeaders: ['Subject', 'From', 'Date'] })`
   - **MIME decode** Base64 and Quoted-Printable headers
   - Returns: `[{ id, subject, from, date }, ...]`
4. Handle empty inbox gracefully (return empty array, not error)

### Step 4 — LLM Classification (Background)

1. Load prompt: `loadPrompt('gmail_lab_classifier.txt')`
2. **Batch processing**: Split 200 emails into 4 batches of 50 (prevents output token truncation)
3. Model: `process.env.EMAIL_CLASSIFIER_MODEL || process.env.SQL_GENERATOR_MODEL`
4. Use `responses.parse()` with fallback to `responses.create()` on SyntaxError
5. Request format:
   ```javascript
   {
     model: '...',
     input: [
       { role: 'system', content: [{ type: 'input_text', text: systemPrompt }] },
       { role: 'user', content: [{ type: 'input_text', text: JSON.stringify(batch) }] }
     ],
     text: {
       format: {
         type: 'json_schema',
         name: 'gmail_lab_classification',
         strict: true,
         schema: { /* see schema below */ }
       }
     }
   }
   ```
6. Output schema:
   ```json
   {
     "type": "object",
     "properties": {
       "classifications": {
         "type": "array",
         "items": {
           "type": "object",
           "properties": {
             "id": { "type": "string" },
             "is_lab_likely": { "type": "boolean" },
             "confidence": { "type": "number" },
             "reason": { "type": "string" }
           },
           "required": ["id", "is_lab_likely", "confidence", "reason"]
         }
       }
     },
     "required": ["classifications"]
   }
   ```
7. Merge emails + classifications into single result array (backend join)

### Step 5 — Job Completion

1. Job status → `completed`
2. Result structure:
   ```json
   {
     "results": [
       {
         "id": "msg_123",
         "subject": "Your Lab Results",
         "from": "noreply@quest.com",
         "date": "2025-11-01",
         "is_lab_likely": true,
         "confidence": 0.92,
         "reason": "Subject mentions 'Lab Results' and sender is Quest"
       }
     ]
   }
   ```
3. UI stops polling and renders table:
   - Columns: Subject | Sender | Date | Verdict | Reason
   - Verdict badge: 🟢 "Likely Lab Result" or ⚪ "Unlikely"
   - Empty state: "No recent inbox emails found."

---

## 6. Environment Variables

### New Variables (add to `.env`)

```bash
# Gmail Integration (PRD v2.9, Dev-only)
GMAIL_INTEGRATION_ENABLED=false                    # Set to true to enable
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GMAIL_TOKEN_PATH=./server/config/gmail-token.json  # Auto-created
GMAIL_MAX_EMAILS=200                               # Max emails to fetch
GMAIL_CONCURRENCY_LIMIT=20                         # Concurrent Gmail API requests
GMAIL_OAUTH_REDIRECT_URI=http://localhost:3000/api/dev-gmail/oauth-callback
EMAIL_CLASSIFIER_MODEL=gpt-5-mini                  # Optional, defaults to SQL_GENERATOR_MODEL
```

### Add to `.env.example`

Copy all variables above to `.env.example` with placeholder values.

### Add to `.gitignore`

```
# Gmail OAuth token (dev-only, do not commit)
server/config/gmail-token.json
```

### Google Cloud Setup Checklist

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create/select project, enable **Gmail API**
3. Configure OAuth consent screen (External, add yourself as test user)
4. Create OAuth credentials (Web application)
5. Add authorized redirect URI: `http://localhost:3000/api/dev-gmail/oauth-callback`
6. Copy Client ID and Secret to `.env`

---

## 7. Performance & Limits

| Operation | Time | Notes |
|-----------|------|-------|
| Gmail list IDs | ~1-2s | Single API call |
| Fetch metadata (20 concurrent) | ~5-10s | Uses p-limit |
| OpenAI classification (4 batches) | ~20-40s | Sequential processing |
| **Total** | **~30-55s** | Acceptable for dev |

- Gmail quota: 250 units/user/sec (20 concurrent = 100 units/sec = 40% of quota)
- OpenAI: 4 batches × 50 emails = safer than single 200-email request

---

## 8. Deliverables for Engineering

### Backend Services

**`server/services/gmailConnector.js`**
- `getAuthUrl()` - Generate OAuth URL with CSRF state
- `handleOAuthCallback({ code, state })` - Validate state, exchange code, save tokens
- `loadCredentials()` - Load tokens from file
- `isAuthenticated()` - Check if valid tokens exist
- `fetchEmailMetadata()` - Fetch 200 emails with parallel get() calls
- `getOAuth2Client()` - Return authenticated client (for status endpoint)

**Key implementation notes:**
- Use in-memory Map for OAuth state tokens (expire after 10 minutes)
- Register token refresh listener **once** (guard with flag to prevent duplicates)
- Preserve `refresh_token` when updating file (Google omits it during refresh events)
- MIME decode headers using inline helper (Base64 and Quoted-Printable)

**`server/services/emailClassifier.js`**
- `classifyEmails(emails)` - Classify in batches of 50, return flat array

**Key implementation notes:**
- Use `p-limit(1)` for sequential batch processing
- Use `responses.parse()` with SyntaxError fallback to `responses.create()`
- Use `input` array (not `messages`) and `text.format.schema` (not `response_schema`)

### Backend Routes

**`server/routes/gmailDev.js`**
- Feature flag guard middleware (check `GMAIL_INTEGRATION_ENABLED` and `NODE_ENV !== 'production'`)
- `GET /api/dev-gmail/status` - Return `{ connected: boolean, email?: string }`
- `GET /api/dev-gmail/auth-url` - Return OAuth consent URL
- `GET /api/dev-gmail/oauth-callback` - Handle callback, return success/failure HTML
- `POST /api/dev-gmail/fetch` - Create job (check auth first), return `{ job_id }`
- `GET /api/dev-gmail/jobs/:jobId` - Poll job status

**Register in `server/app.js`** (after existing routes):
```javascript
const gmailDevRouter = require('./routes/gmailDev');
app.use('/api/dev-gmail', gmailDevRouter);
```

### Frontend

**`public/gmail-dev.html`**
- "Connect Gmail Account" button
- "Fetch & Classify Emails" button (disabled until authenticated)
- Loading state
- Results table
- Error banner

**`public/js/gmail-dev.js`**
- Status check on page load
- OAuth flow (open consent URL in new window)
- Fetch button handler
- Job polling (2s interval)
- Results rendering

**Reuse existing:** `public/css/admin.css` for styling

### Prompts

**`prompts/gmail_lab_classifier.txt`**

```
You are an email classifier for a healthcare application. Your task is to analyze email metadata (subject, sender, date) and determine if each email is likely to contain lab test results.

CRITICAL REQUIREMENTS:
1. For each email in the input array, you MUST return a classification object with the EXACT 'id' value from that email.
2. DO NOT modify, truncate, generate, or omit any ID values. Copy them verbatim from the input.
3. If you cannot classify an email, still return its exact ID with is_lab_likely: false.

Classification guidelines:
- is_lab_likely: true if subject/sender suggests medical lab results (e.g., "Lab Results", "Test Results", sender from Quest, LabCorp, hospitals)
- confidence: 0.0-1.0 score (0.8+ for clear indicators, 0.5-0.7 for moderate, <0.5 for weak)
- reason: Brief explanation (10-20 words) of why this email is/isn't likely a lab result

Likely Lab Results (is_lab_likely: true):
- Subject mentions: "lab results", "test results", "blood work", "pathology report", "diagnostic results"
- Sender is from: medical labs (Quest, LabCorp), hospitals, clinics, patient portals (MyChart)
- Subject includes patient names or medical record numbers
- Subject mentions specific tests (cholesterol, CBC, vitamin D, etc.)

Unlikely Lab Results (is_lab_likely: false):
- Marketing/promotional emails from healthcare providers
- Appointment reminders or confirmations
- Billing/insurance emails
- General health newsletters
- Non-medical emails

Important:
- Classify ALL provided emails (no omissions).
- Be conservative: if uncertain, mark as unlikely with low confidence.

Return format: JSON array with {id, is_lab_likely, confidence, reason} for EVERY email.
```

### Dependencies

Add to `package.json`:
```json
"googleapis": "^140.0.0",
"p-limit": "^2.3.0"
```

Install: `npm install googleapis@^140.0.0 p-limit@^2.3.0`

---

## 9. Security & Privacy

- ✅ Read-only Gmail scope
- ✅ CSRF protection (OAuth state token)
- ✅ No email content in logs (only counts/status)
- ✅ No database writes
- ✅ Token in .gitignore
- ✅ Feature flag + environment guard (dev-only)
- ⚠️ Unencrypted token storage (acceptable for local dev)

---

## 10. Error Handling

| Scenario | Response | UI Action |
|----------|----------|-----------|
| OAuth token missing | HTTP 401 | Show "Connect Gmail" button |
| OAuth token expired | HTTP 401 | Show "Reconnect Gmail" button |
| Gmail API 429 | Job `failed` | Show error, user retries manually |
| OpenAI API error | Job `failed` | Show error, user retries manually |
| Empty inbox | Job `completed`, `results: []` | Show "No emails found" (not error) |

**Logging (pino):**
- ✅ Log job creation/completion with counts
- ✅ Log API call success/failure
- ❌ DO NOT log email subjects/senders

---

## 11. Testing Checklist

- [ ] OAuth flow completes and stores token
- [ ] Fetch job returns `job_id` and progresses to `completed`
- [ ] UI displays 200 emails with classifications
- [ ] Empty inbox shows friendly message (not error)
- [ ] Expired token shows "Reconnect Gmail" option
- [ ] Feature flag blocks access when disabled
- [ ] No email data in server logs

---

## 12. Implementation Order

### Phase 1: Backend Core
1. Create `server/services/gmailConnector.js`
2. Create `server/services/emailClassifier.js`
3. Create `server/routes/gmailDev.js`
4. Register route in `server/app.js`

### Phase 2: Frontend
1. Create `public/gmail-dev.html`
2. Create `public/js/gmail-dev.js`

### Phase 3: Testing
1. Test OAuth flow end-to-end
2. Test classifications with real Gmail account
3. Verify no email data in logs

---

## 13. Key Implementation Details

### MIME Header Decoding
```javascript
const decodeMimeHeader = (value) => {
  if (!value) return '';
  const mimePattern = /=\?([^?]+)\?([BQ])\?([^?]+)\?=/gi;
  return value.replace(mimePattern, (match, charset, encoding, text) => {
    try {
      if (encoding.toUpperCase() === 'B') {
        return Buffer.from(text, 'base64').toString('utf8');
      } else if (encoding.toUpperCase() === 'Q') {
        return text.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi,
          (_, hex) => String.fromCharCode(parseInt(hex, 16))
        );
      }
    } catch (err) {
      logger.warn('MIME decode failed');
    }
    return match;
  });
};
```

### Token Refresh Listener (Preserve refresh_token)
```javascript
let tokenListenerRegistered = false;

function registerTokenRefreshListener() {
  if (tokenListenerRegistered) return;

  oauth2Client.on('tokens', async (newTokens) => {
    const existingData = await fs.readFile(tokenPath, 'utf8');
    const existingTokens = JSON.parse(existingData);

    const mergedTokens = {
      ...existingTokens,
      ...newTokens,
      refresh_token: newTokens.refresh_token || existingTokens.refresh_token
    };

    if (!mergedTokens.refresh_token) {
      logger.error('refresh_token missing - skipping save');
      return;
    }

    await fs.writeFile(tokenPath, JSON.stringify(mergedTokens, null, 2));
  });

  tokenListenerRegistered = true;
}
```

### Job Processing Pattern
```javascript
router.post('/fetch', async (req, res) => {
  const authenticated = await isAuthenticated();
  if (!authenticated) {
    return res.status(401).json({ error: 'Gmail authentication required' });
  }

  const jobId = createJob('dev-gmail', { emailCount: 200 });

  setImmediate(async () => {
    try {
      updateJob(jobId, JobStatus.PROCESSING);

      const emails = await fetchEmailMetadata();
      if (emails.length === 0) {
        setJobResult(jobId, { results: [] });
        return;
      }

      const classifications = await classifyEmails(emails);

      const results = emails.map(email => {
        const classification = classifications.find(c => c.id === email.id);
        return {
          ...email,
          is_lab_likely: classification?.is_lab_likely || false,
          confidence: classification?.confidence || 0,
          reason: classification?.reason || 'Classification unavailable'
        };
      });

      setJobResult(jobId, { results });
    } catch (error) {
      setJobError(jobId, error);
    }
  });

  return res.status(202).json({ job_id: jobId });
});
```

---

## 14. Acceptance Criteria

### Functional
- ✅ OAuth flow completes and stores token
- ✅ Fetch creates async job and returns job_id
- ✅ Job polls from pending → processing → completed
- ✅ UI displays all emails with classifications
- ✅ Empty inbox handled gracefully
- ✅ Errors display clear messages

### Non-Functional
- ✅ Total job time <60s
- ✅ Follows existing patterns (job queue, responses.parse())
- ✅ No email data in logs
- ✅ Feature flag enforced

---

## 15. Future Enhancements (Out of Scope)

- Download/process PDF attachments
- Store classifications for accuracy tracking
- Auto-sync for new emails
- Multi-account support
- Anthropic provider option
- Sender domain whitelist

---

**Status:** ✅ Ready for Implementation
**Next Step:** Begin with Phase 1 (Backend Core)