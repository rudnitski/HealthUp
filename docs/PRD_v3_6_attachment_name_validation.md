# PRD v3.6: Attachment Name Validation (Gmail Step 2.5)

**Status:** Ready for Implementation
**Created:** 2025-11-27
**Author:** Claude (with user collaboration)
**Target Release:** v3.6
**Dependencies:** PRD v2.8 (Gmail Integration Step 2), PRD v3.0 (Unified Upload)

---

## Overview

### Problem Statement

After Gmail Step 2 (body classification) completes, users see an attachment selection table where they can choose which files to download and process. However, **non-lab-report attachments** (logos, signatures, decorative images) currently appear in this table alongside legitimate lab reports.

**Real-world example:**
```
From: "ОДО \"Медицинский центр «Кравира»\"" <analiz@kravira.by>
Subject: ОДО "Медицинский центр «Кравира»". Результаты анализов.
Date: Wed, 30 Nov 2022 13:30:11 +0300

Attachments shown to user:
☑ results_2022_11_30.pdf (245 KB)
☑ logo.jpg (12 KB)                 ← Not a lab report!
```

**Why this happens:**
1. **Step 2 (Body Classification)** correctly identifies the email as a lab results notification
2. **Attachment filtering** only checks MIME type (PDF, JPEG, PNG, HEIC) and file size
3. `logo.jpg` passes MIME type check (`image/jpeg` is allowed) and size check (< 15 MB)
4. User sees `logo.jpg` as a selectable option, even though it's clearly not a lab report

**User impact:**
- Confusion: "Why is there a logo in my lab results?"
- Wasted resources: User might select it, triggering download + OCR on a 12KB image
- Noise in selection table: Hard to find real lab reports among decorative files

### Goals

1. **Filter out non-lab-report attachments** before showing the selection table to users
2. **LLM-based validation**: Use attachment filename + size to determine if it's likely a lab report
3. **Maintain transparency**: Show rejected attachments in a collapsible debug section
4. **Minimal false positives**: Prefer showing questionable attachments rather than hiding real lab reports
5. **Consistent with existing patterns**: Follow the same debug disclosure pattern as "Show rejected emails"

### Non-Goals (Out of Scope)

- Attachment content analysis (no image recognition, no PDF page counting)
- Manual override (no "force include" checkbox for rejected attachments)
- Heuristic-only filtering (avoid brittle rules like "reject files < 50KB")
- Retroactive filtering of already-ingested attachments

---

## Current State Analysis

### Existing Filtering (Step 2 → Attachment Selection)

**Location:** `server/routes/gmailDev.js:392-405`

After Step 2 body classification completes, attachments are passed through to the selection UI with **NO filtering**:

```javascript
attachments: email.attachments.map(a => ({
  filename: a.filename,
  mimeType: a.mimeType,
  size: a.size,
  attachmentId: a.attachmentId,
  isInline: a.isInline
}))
```

**Current behavior before selection UI:**
- ❌ No MIME type filtering
- ❌ No inline check
- ❌ No size validation
- ❌ No filename validation

**All attachments** from Step 2 body fetch appear in the selection table. The only filtering that exists happens **later at Step 3 ingestion** (`server/routes/gmailDev.js:636-709`):
- ✅ MIME type validation (`isValidAttachment()` checks extension/MIME)
- ✅ Size limit check (15MB default)
- ❌ Still no inline check
- ❌ Still no filename validation

**Problem:** Users see ALL attachments (including logos, inline images, potentially huge files) in the selection table. They can check boxes, but ingestion may reject them with validation errors at Step 3.

### Existing Debug Sections

**Location:** `public/index.html` + `public/js/unified-upload.js:660-830`

The Gmail results UI already has two collapsible debug sections:

1. **"Show 10 rejected emails (Step 2)"** (line 660-700)
   - Displays emails that failed body classification
   - Shows subject, from, date, confidence, reason

2. **"Show 3 accepted emails with no usable attachments"** (line 705-750)
   - Displays emails that passed classification but had zero valid attachments
   - Shows attachment issues (e.g., "All attachments inline", "No attachments detected")

**Pattern to follow:**
```html
<details style="margin-top: 20px;">
  <summary style="cursor: pointer; font-weight: 600;">
    ▶ Show N rejected items (Reason)
  </summary>
  <div style="margin-top: 10px; padding: 15px; background: #f9f9f9; ...">
    <!-- Table or list of rejected items -->
  </div>
</details>
```

---

## Proposed Solution

### Design Principles

1. **LLM-based validation**: Filename + size are strong signals (logo.jpg, results_2022.pdf)
2. **Insert between Step 2 and duplicate detection**: Natural point in the pipeline
3. **Conservative filtering**: When uncertain, show the attachment (avoid false negatives)
4. **Full transparency**: Log all rejections in a collapsible debug section
5. **Minimal API cost**: Batch validation, reuse existing OpenAI client

### High-Level Flow

```
Step 1 (Metadata Classification)
  ↓
Step 2 (Body Classification)
  ↓
[NEW] Step 2.5 (Attachment Name Validation) ← Insert here
  ↓
Duplicate Detection (existing)
  ↓
Show Attachment Selection Table
  ↓
Step 3 (Download & Ingest)
```

**Insertion point:** `server/routes/gmailDev.js:405` (after `step2AllResults` is built, before duplicate detection at line 410)

---

## Technical Design

### A. LLM Prompt

**File:** `prompts/gmail_attachment_validator.txt`

```
You are an attachment classifier for a healthcare application. Your task is to analyze attachment metadata (filename, file size) and determine if each attachment is likely a lab test results document.

CRITICAL REQUIREMENTS:
1. For each attachment in the input array, you MUST return a validation object with the EXACT 'id' value from that attachment.
2. DO NOT modify, truncate, generate, or omit any ID values. Copy them verbatim from the input.
3. If you cannot classify an attachment with confidence, return is_likely_lab_report: true with low confidence (0.4-0.5) to avoid false negatives (better to show a questionable attachment than hide a real lab report).

Classification guidelines:
- is_likely_lab_report: true if filename suggests medical lab results (e.g., "results.pdf", "bloodwork_2022.pdf", "lab_report.pdf", "анализы.pdf")
- confidence: 0.0-1.0 score (0.8+ for clear indicators, 0.5-0.7 for moderate, <0.5 for weak)
- reason: Brief explanation (10-20 words) of why this attachment is/isn't likely a lab report

LIKELY LAB REPORTS (is_likely_lab_report: true):
- PDFs with medical keywords: "lab", "results", "test", "blood", "urine", "pathology", "анализы", "результаты"
- PDFs with dates in filename: "results_2022_11_30.pdf", "lab_report_2024.pdf"
- Large images that could be scanned documents: "scan001.jpg" (1.2MB), "IMG_20220515.jpg" (850KB)
- Generic medical filenames: "report.pdf", "document.pdf", "file.pdf" (conservative - might be lab reports)
- Ambiguous cases: When uncertain, default to is_likely_lab_report: true with low confidence

UNLIKELY LAB REPORTS (is_likely_lab_report: false):
- Logos and branding: "logo.jpg", "logo.png", "header.png", "banner.jpg", "company_logo.png"
- Signatures: "signature.png", "sig.jpg", "подпись.png", "doctor_signature.jpg"
- Decorative images: "footer.png", "icon.png", "spacer.gif", "divider.png"
- ONLY reject images if filename CLEARLY indicates branding/decoration AND file is small (context matters)
- Non-medical generic images: "image001.jpg" with small size AND no medical context

Important:
- Classify ALL provided attachments (no omissions).
- Be conservative: if uncertain (e.g., "document.pdf", "file.pdf"), mark as likely lab report with moderate confidence (0.5-0.6).
- PDFs are almost always documents - only reject if filename clearly indicates non-medical (e.g., "logo.pdf", "brochure.pdf").
- Large images could be scanned lab reports - use filename as primary signal, size as supporting context.
- When in doubt, prefer false positives (showing non-lab attachment) over false negatives (hiding real lab report).

Return format: JSON object with a "validations" array containing {id, is_likely_lab_report, confidence, reason} for EVERY attachment.

Example output structure:
{
  "validations": [
    {"id": "att_abc123", "is_likely_lab_report": true, "confidence": 0.95, "reason": "Filename 'results_2022.pdf' clearly indicates lab results"},
    {"id": "att_def456", "is_likely_lab_report": false, "confidence": 0.85, "reason": "Filename 'logo.jpg' and small size (12KB) indicate branding image"}
  ]
}
```

### B. Backend Implementation

**Location:** `server/routes/gmailDev.js:405` (insert new Step 2.5)

**New function:**
```javascript
/**
 * Validate attachment names using LLM (Step 2.5)
 * Filters out logos, signatures, and other non-lab-report files
 */
async function validateAttachmentNames(emails) {
  const attachmentsToValidate = [];

  // Collect all attachments with unique IDs
  emails.forEach(email => {
    email.attachments.forEach(att => {
      attachmentsToValidate.push({
        id: `${email.id}_${att.attachmentId}`,  // Composite key
        filename: att.filename,
        size: att.size,
        mimeType: att.mimeType
      });
    });
  });

  if (attachmentsToValidate.length === 0) {
    // No attachments to validate - return emails unchanged with empty rejectedAttachments
    logger.info(`[gmailDev] [Step-2.5] No attachments to validate, returning emails unchanged`);
    return emails.map(email => ({
      ...email,
      rejectedAttachments: []
    }));
  }

  logger.info(`[gmailDev] [Step-2.5] Validating ${attachmentsToValidate.length} attachment names`);

  // Call LLM with batch validation
  let validations;
  let validationStatus = 'success';

  try {
    validations = await validateAttachmentsWithLLM(attachmentsToValidate);
  } catch (error) {
    logger.error('[gmailDev] [Step-2.5] Validation failed, accepting all attachments as fallback', error);
    validationStatus = 'failed_fallback';

    // Fallback: treat all attachments as valid (conservative approach)
    return {
      emails: emails.map(email => ({
        ...email,
        rejectedAttachments: []
      })),
      validationStatus
    };
  }

  // Map validations back to email structure
  const emailsWithValidation = emails.map(email => {
    const validAttachments = [];
    const rejectedAttachments = [];

    email.attachments.forEach(att => {
      const compositeId = `${email.id}_${att.attachmentId}`;
      const validation = validations.find(v => v.id === compositeId);

      if (!validation) {
        logger.warn(`[gmailDev] [Step-2.5] No validation found for ${compositeId}, defaulting to accept`);
        validAttachments.push(att);
        return;
      }

      // Accept if is_likely_lab_report === true
      if (validation.is_likely_lab_report === true) {
        validAttachments.push(att);
      } else {
        rejectedAttachments.push({
          ...att,
          rejection_reason: validation.reason,
          rejection_confidence: validation.confidence
        });
      }
    });

    return {
      ...email,
      attachments: validAttachments,
      rejectedAttachments: rejectedAttachments
    };
  });

  const totalRejected = emailsWithValidation.reduce((sum, e) => sum + (e.rejectedAttachments?.length || 0), 0);
  logger.info(`[gmailDev] [Step-2.5] Validation complete: ${totalRejected} attachments rejected`);

  return {
    emails: emailsWithValidation,
    validationStatus
  };
}

/**
 * Call OpenAI to validate attachment names
 */
async function validateAttachmentsWithLLM(attachments) {
  const systemPrompt = loadPrompt('gmail_attachment_validator.txt');
  const client = getOpenAiClient(); // Reuse existing client

  const BATCH_SIZE = 50; // Validate 50 attachments per batch
  const batches = [];
  for (let i = 0; i < attachments.length; i += BATCH_SIZE) {
    batches.push(attachments.slice(i, i + BATCH_SIZE));
  }

  const allValidations = [];

  for (const batch of batches) {
    const response = await client.responses.parse({
      model: process.env.EMAIL_CLASSIFIER_MODEL || process.env.SQL_GENERATOR_MODEL || 'gpt-4o-mini',
      input: [
        { role: 'system', content: [{ type: 'input_text', text: systemPrompt }] },
        { role: 'user', content: [{ type: 'input_text', text: JSON.stringify(batch) }] }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'attachment_validation',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              validations: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    is_likely_lab_report: { type: 'boolean' },
                    confidence: { type: 'number' },
                    reason: { type: 'string' }
                  },
                  required: ['id', 'is_likely_lab_report', 'confidence', 'reason']
                }
              }
            },
            required: ['validations']
          }
        }
      }
    });

    allValidations.push(...response.output_parsed.validations);
  }

  return allValidations;
}
```

**Integration into existing flow (gmailDev.js:405-450):**

```javascript
// Existing code creates step2AllResults (line 377-405)
const step2AllResults = fullEmails.map(email => {
  const classification = step2Classifications.find(c => c.id === email.id);
  // ... existing mapping logic ...
});

// Extract only accepted emails FIRST (existing logic, moved up)
const acceptedEmails = step2AllResults.filter(item => item.accepted);

// [NEW] Step 2.5: Validate attachment names (only on accepted emails to save tokens)
const { emails: resultsWithValidatedAttachments, validationStatus } = await validateAttachmentNames(acceptedEmails);

// Continue with validated results
const results = resultsWithValidatedAttachments;

// Detect duplicates (existing logic continues at line 410)
const attachmentMap = new Map();
// ... rest of duplicate detection ...
```

### C. Response Schema Updates

**Add to job result object:**

```javascript
setJobResult(jobId, {
  results: resultsWithDuplicates,
  rejectedEmails,
  attachmentRejectedEmails,
  attachmentProblemEmails,
  rejectedAttachments,  // [NEW]
  attachmentValidationStatus: validationStatus,  // [NEW] - 'success' or 'failed_fallback'
  stats,
  threshold,
  debug: { ... }
});
```

**New field: `rejectedAttachments`**

```javascript
const rejectedAttachments = resultsWithDuplicates
  .filter(email => email.rejectedAttachments && email.rejectedAttachments.length > 0)
  .map(email => ({
    subject: email.subject,
    from: email.from,
    date: email.date,
    rejected: email.rejectedAttachments.map(att => ({
      filename: att.filename,
      size: att.size,
      reason: att.rejection_reason,
      confidence: att.rejection_confidence
    }))
  }));
```

### D. Frontend UI Updates

**Location:** `public/js/unified-upload.js` - Inside `renderGmailResults(result)` function, around line 700-830

**Context:** This code goes in the Gmail results summary rendering section, where the full job `result` object is available and where the existing two debug sections ("Show rejected emails" and "Show accepted emails with no usable attachments") are already rendered.

**Add third collapsible section (after existing debug sections):**

```javascript
// Inside renderGmailResults(result) function
// After the existing two <details> sections for rejected emails and attachment problems

function renderGmailResults(result) {
  // ... existing summary HTML rendering ...

  // Existing debug sections render here (lines ~660-750)

  // [NEW] Show validation fallback warning (if Step 2.5 failed)
  if (result.attachmentValidationStatus === 'failed_fallback') {
    summaryHtml += `
      <div style="margin-top: 15px; padding: 12px; background: #fff3cd; border-left: 4px solid #ffc107; border-radius: 4px;">
        <strong>⚠️ Attachment Filtering Unavailable</strong>
        <p style="margin: 5px 0 0; color: #856404; font-size: 0.9em;">
          Automatic filtering of logos/signatures failed. All attachments are shown below.
          Please manually review the selection to avoid processing non-lab-report files.
        </p>
      </div>
    `;
  }

  // [NEW] Show rejected attachments (Step 2.5)
  if (result.rejectedAttachments && result.rejectedAttachments.length > 0) {
    const totalRejected = result.rejectedAttachments.reduce((sum, e) => sum + e.rejected.length, 0);

    summaryHtml += `
      <details style="margin-top: 20px; border: 1px solid #e0e0e0; border-radius: 8px; padding: 12px;">
        <summary style="cursor: pointer; font-weight: 600; color: #666;">
          ▶ Show ${totalRejected} rejected attachment${totalRejected > 1 ? 's' : ''} (Step 2.5: Non-lab-report files filtered)
        </summary>
        <div style="margin-top: 10px; padding: 15px; background: #f9f9f9; border-radius: 4px; font-size: 0.9em;">
          <p style="margin-bottom: 10px; color: #666;">
            These attachments were filtered out because their filenames suggest they are not lab reports
            (e.g., logos, signatures, decorative images). If you believe an attachment was incorrectly filtered,
            please report this as a bug.
          </p>
          <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
            <thead>
              <tr style="background: #f0f0f0;">
                <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Email</th>
                <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Rejected Attachment</th>
                <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Size</th>
                <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Reason</th>
              </tr>
            </thead>
            <tbody>
    `;

    result.rejectedAttachments.forEach(email => {
      email.rejected.forEach(att => {
        summaryHtml += `
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-size: 0.85em;">
              <strong>From:</strong> ${email.from}<br>
              <strong>Subject:</strong> ${email.subject}
            </td>
            <td style="padding: 8px; border: 1px solid #ddd;">
              <code>${att.filename}</code>
            </td>
            <td style="padding: 8px; border: 1px solid #ddd;">
              ${formatFileSize(att.size)}
            </td>
            <td style="padding: 8px; border: 1px solid #ddd; color: #e67e00;">
              ${att.reason}
            </td>
          </tr>
        `;
      });
    });

    summaryHtml += `
            </tbody>
          </table>
        </div>
      </details>
    `;
  }

  // ... rest of renderGmailResults function ...
}
```

**Note:** The exact line numbers may shift depending on other code changes. The key is to place this section:
1. Inside the `renderGmailResults(result)` function (where `result` object is in scope)
2. After the existing two debug sections (rejected emails, attachment problems)
3. Before the attachment selection table rendering

---

## Implementation Checklist

### Phase 1: LLM Infrastructure

- [ ] Create prompt file `prompts/gmail_attachment_validator.txt`
- [ ] Add `validateAttachmentsWithLLM()` function in `server/routes/gmailDev.js`
- [ ] Add `validateAttachmentNames()` orchestrator function
- [ ] Unit test: Validate LLM returns correct schema for sample attachments
- [ ] Unit test: Validate batch processing (50 attachments per batch)

### Phase 2: Backend Integration

- [ ] Insert Step 2.5 call in `POST /api/dev-gmail/fetch` route (line 405)
- [ ] Update `step2AllResults` structure to include `rejectedAttachments`
- [ ] Add `rejectedAttachments` to job result response
- [ ] Test: Verify attachment filtering with real emails (logo.jpg, results.pdf)
- [ ] Test: Verify existing duplicate detection still works

### Phase 3: Frontend UI

- [ ] Add third collapsible debug section in `unified-upload.js:830`
- [ ] Render rejected attachments table
- [ ] Test: Verify UI shows rejected attachments with reasons
- [ ] Test: Verify attachment selection table only shows valid attachments

### Phase 4: Logging & Observability

- [ ] Add structured logging for Step 2.5 (start, progress, completion)
- [ ] Log rejection counts and reasons
- [ ] Update CLAUDE.md with Step 2.5 documentation

### Phase 5: Testing & Validation

- [ ] Manual test: Upload email with logo.jpg + results.pdf (verify logo filtered)
- [ ] Manual test: Upload email with signature.png + bloodwork.pdf (verify signature filtered)
- [ ] Manual test: Upload email with generic "document.pdf" (verify NOT filtered - conservative)
- [ ] Manual test: Verify collapsible section shows correct rejection reasons
- [ ] Regression test: Verify existing Step 1, Step 2, Step 3 flows still work

---

## Success Metrics

**Pre-launch (Baseline):**
- Measure: % of attachments in selection table that are non-lab-reports (manual review of 50 emails)
- Expected: ~5-10% (logos, signatures appear in selection table)

**Post-launch (Target):**
- Measure: % of attachments in selection table that are non-lab-reports
- Target: <1% (only ambiguous cases like "document.pdf" should remain)

**Quality Metrics:**
- False negatives: 0 (no real lab reports rejected)
- False positives: <2% (acceptable to show ambiguous attachments)

---

## Open Questions

1. **Should we add a manual override?** (Allow user to "force include" rejected attachments)
   - **Decision:** No (out of scope) - If false negatives occur, user can report as bug

2. **Should we validate during Step 3 ingestion?** (Double-check before download)
   - **Decision:** No - Step 2.5 is sufficient, no need to re-validate

3. **Should we log rejections to database?** (Track which attachments are commonly rejected)
   - **Decision:** No (keep ephemeral) - Use structured logs for debugging

4. **Should we allow size-based heuristics as fallback?** (If LLM fails, reject < 50KB)
   - **Decision:** No - Conservative default is to show attachment if LLM validation fails

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| LLM rejects real lab report (false negative) | High (user loses data) | Conservative prompt ("if uncertain, mark as likely"), log all rejections for review |
| LLM accepts logo/signature (false positive) | Low (user manually skips) | Acceptable trade-off, prioritize avoiding false negatives |
| LLM API failure/timeout | Medium (all attachments rejected) | Fallback: If validation fails, accept all attachments (log error) |
| Increased API costs | Low (1 extra call per fetch) | Batch validation (50 attachments/call), use cheap model (gpt-4o-mini) |
| UI clutter with debug section | Low (only for power users) | Collapsible by default, clear labeling |

---

## Future Enhancements (Out of Scope)

- **Attachment content analysis:** Use vision models to detect if image contains lab results
- **User feedback loop:** "Was this attachment correctly classified?" → Improve prompt
- **Attachment type classification:** Categorize as blood_test, mri_report, logo, etc.
- **Persistent rejection logs:** Store rejections in database for analytics
