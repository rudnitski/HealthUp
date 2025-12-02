# PRD v3.6: Attachment Name Validation (Enhanced Step 2)

**Status:** Ready for Implementation
**Created:** 2025-11-27
**Updated:** 2025-12-02 (Merged Step 2.5 into Step 2)
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
2. **LLM-based validation**: Use email context + attachment metadata to determine if each attachment is likely a lab report
3. **Maintain transparency**: Show rejected attachments in a collapsible debug section
4. **Minimal false positives**: Prefer showing questionable attachments rather than hiding real lab reports
5. **Consistent with existing patterns**: Follow the same debug disclosure pattern as "Show rejected emails"

**Important Scope Clarification:**
- This feature targets **attachment-level filtering** within emails that pass Step 2 classification
- If Step 2 rejects an entire email, ALL its attachments are implicitly rejected (already shown in "Show rejected emails" section)
- The new debug section shows only attachments filtered from **accepted emails** (e.g., email accepted, but logo.jpg filtered out)

### Non-Goals (Out of Scope)

- Attachment content analysis (no image recognition, no PDF page counting)
- Manual override (no "force include" checkbox for rejected attachments)
- Heuristic-only filtering (avoid brittle rules like "reject files < 50KB")
- Retroactive filtering of already-ingested attachments

---

## Solution Design

### Why Merge into Step 2 (Not Separate Step 2.5)

**Step 2 already has superior context for attachment validation:**
- Full email body (often describes attachments: "here's your lab report and our logo")
- Subject line (additional context clues)
- Sender information (helps identify branding vs medical content)
- All attachment metadata (filename, size, mimeType, isInline)

**Benefits of merged approach:**
- ✅ One less API call (faster + cheaper)
- ✅ Better accuracy (more context = better decisions)
- ✅ Simpler architecture (fewer pipeline stages)
- ✅ Less code to maintain
- ✅ LLM can cross-reference body content with attachment names

**Original PRD had separate Step 2.5 (attachment name validation), but this was redundant. The merged design is superior.**

---

## Current State Analysis

### Existing Step 2 Implementation

**Location:** `server/services/bodyClassifier.js`

Current behavior:
- Receives emails with full body content + attachment metadata
- Formats attachments as summary string: `"PDF (results.pdf, 0.24MB), JPEG (logo.jpg, 0.01MB)"`
- LLM classifies email-level: `is_clinical_results_email`, confidence, reason
- Returns **no per-attachment classification**

**Current response schema:**
```json
{
  "classifications": [
    {
      "id": "email123",
      "is_clinical_results_email": true,
      "confidence": 0.95,
      "reason": "Email body indicates lab results"
    }
  ]
}
```

**Problem:** All attachments from accepted emails are shown in selection table. No attachment-level filtering.

### Existing Debug Sections

**Location:** `public/js/unified-upload.js` - Inside `showAttachmentSelection()` function

The Gmail results UI already has three collapsible debug sections using custom button toggles:

1. **"Show N rejected emails (Step 2)"**
   - Displays emails that failed body classification
   - Shows subject, from, date, confidence, reason

2. **"Show N emails with attachment issues"**
   - Displays emails that had attachment validation problems
   - Shows attachment-specific issues (inline, invalid MIME types, etc.)

3. **"Show N accepted emails with no usable attachments"**
   - Displays emails that passed classification but ended up with zero valid attachments
   - Shows reasons why attachments were not usable

**Pattern to follow:**
```javascript
const sectionId = 'rejected-attachments-section-' + Date.now();
summaryHtml += `
  <div style="margin-top: 16px; border-top: 1px solid #e5e7eb; padding-top: 12px;">
    <button
      type="button"
      id="${sectionId}-toggle"
      style="background: none; border: none; color: #6b7280; cursor: pointer; font-size: 0.9em; padding: 4px 8px; display: flex; align-items: center; gap: 6px;"
      onclick="
        const content = document.getElementById('${sectionId}-content');
        const icon = document.getElementById('${sectionId}-icon');
        if (content.style.display === 'none') {
          content.style.display = 'block';
          icon.textContent = '▼';
        } else {
          content.style.display = 'none';
          icon.textContent = '▶';
        }
      ">
      <span id="${sectionId}-icon">▶</span>
      <span>Show N items (Description)</span>
    </button>
    <div id="${sectionId}-content" style="display: none; margin-top: 8px;">
      <!-- Table content here -->
    </div>
  </div>
`;
```

---

## Technical Design

### A. Enhanced Step 2 Prompt

**File:** `prompts/gmail_body_classifier.txt` (update existing file)

**Add to existing prompt after line 39 ("Return format:..."):**

```
ATTACHMENT CLASSIFICATION (NEW):

In addition to classifying the email, you must also classify EACH attachment to determine if it's likely a lab report.

For each attachment in the email, analyze:
1. **Filename pattern**: Does it suggest medical content or branding/decoration?
2. **File size context**: Large files more likely to be documents, small files more likely to be logos
3. **Email body context**: Does the email body mention this specific attachment or describe it?
4. **MIME type**: PDFs are usually documents; images could be scans OR logos

LIKELY LAB REPORTS (is_likely_lab_report: true):
- PDFs with medical keywords: "lab", "results", "test", "blood", "urine", "pathology", "анализы", "результаты"
- PDFs with dates in filename: "results_2022_11_30.pdf", "lab_report_2024.pdf"
- Large images that could be scanned documents: "scan001.jpg" (1.2MB), "IMG_20220515.jpg" (850KB)
- Generic medical filenames: "report.pdf", "document.pdf", "file.pdf" (conservative - might be lab reports)
- Attachments explicitly mentioned in email body as "results" or "lab report"
- Ambiguous cases: When uncertain, default to is_likely_lab_report: true with low confidence (0.4-0.5)

UNLIKELY LAB REPORTS (is_likely_lab_report: false):
- Logos and branding: "logo.jpg", "logo.png", "header.png", "banner.jpg", "company_logo.png"
- Signatures: "signature.png", "sig.jpg", "подпись.png", "doctor_signature.jpg"
- Decorative images: "footer.png", "icon.png", "spacer.gif", "divider.png"
- Small images with generic names: "image001.jpg" (15KB)
- Email body describes attachment as "logo" or "signature"
- ONLY reject images if filename CLEARLY indicates branding/decoration AND file is small

Important:
- **CRITICAL**: For emails with NO attachments in the input, you MUST return an empty attachments array: `"attachments": []`
- Classify ALL attachments in the email (no omissions)
- Be conservative: if uncertain (e.g., "document.pdf", "file.pdf"), mark as likely lab report with moderate confidence (0.5-0.6)
- PDFs are almost always documents - only reject if filename clearly indicates non-medical (e.g., "logo.pdf", "brochure.pdf")
- Large images could be scanned lab reports - use filename as primary signal, size as supporting context
- When in doubt, prefer false positives (showing non-lab attachment) over false negatives (hiding real lab report)
- Use email body context: if body says "attached is your lab report and our logo", you can confidently classify which is which

**Priority Hierarchy:**
1. **Never hide real lab reports** (0 false negatives is MANDATORY)
2. **Minimize showing non-lab files** (low false positives is ASPIRATIONAL)

**Confidence Score Usage:**
- The `confidence` field (0.0-1.0) is for **logging and debugging only**
- Filtering decisions use the **boolean `is_likely_lab_report` field exclusively**
- No confidence threshold is applied - we trust the LLM's boolean decision
- Rationale: The prompt already instructs conservative behavior for uncertain cases
- Future enhancement: Could add confidence-based overrides if needed (e.g., force-accept if confidence < 0.4)
```

**Updated return format specification:**

```
Return format: JSON object with a "classifications" array containing email classifications AND per-attachment classifications.

Example output structure:
{
  "classifications": [
    {
      "id": "abc123",
      "is_clinical_results_email": true,
      "confidence": 0.95,
      "reason": "Body states 'Your lab results are ready' with attachments",
      "attachments": [
        {
          "attachmentId": "att_001",
          "is_likely_lab_report": true,
          "confidence": 0.95,
          "reason": "PDF named 'results_2022_11_30.pdf' explicitly mentioned in body"
        },
        {
          "attachmentId": "att_002",
          "is_likely_lab_report": false,
          "confidence": 0.90,
          "reason": "Small JPEG named 'logo.jpg' (12KB), typical branding file"
        }
      ]
    },
    {
      "id": "def456",
      "is_clinical_results_email": true,
      "confidence": 0.75,
      "reason": "Body mentions lab results but no attachments",
      "attachments": []
    }
  ]
}
```

### B. Backend Implementation

**Location:** `server/services/bodyClassifier.js`

**Changes required:**

1. **Update `CLASSIFICATION_SCHEMA`:**

**Location:** `server/services/bodyClassifier.js` - Update the existing `CLASSIFICATION_SCHEMA` constant (around line 93-113)

```javascript
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
          reason: { type: 'string' },
          attachments: {  // NEW - Optional for defensive fallback handling
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                attachmentId: { type: 'string' },
                is_likely_lab_report: { type: 'boolean' },
                confidence: { type: 'number' },
                reason: { type: 'string' }
              },
              required: ['attachmentId', 'is_likely_lab_report', 'confidence', 'reason']
            }
          }
        },
        required: ['id', 'is_clinical_results_email', 'confidence', 'reason']
        // NOTE: 'attachments' is NOT required - allows fallback if LLM omits it
      }
    }
  },
  required: ['classifications']
};
```

**Key change**: Removed `'attachments'` from the `required` array to allow defensive fallback handling when LLM omits the field.

2. **Update `formatAttachmentsSummary()` to include attachmentId:**

**Location:** `server/services/bodyClassifier.js` - Find the `formatAttachmentsSummary()` function (search for "Format attachments")

```javascript
/**
 * Format attachments for LLM input (detailed list with IDs)
 */
function formatAttachmentsForLLM(attachments) {
  if (!attachments || attachments.length === 0) return [];

  return attachments.map(a => {
    const sizeMB = (a.size / 1024 / 1024).toFixed(2);
    const inlineFlag = a.isInline ? '[inline]' : '';
    return {
      attachmentId: a.attachmentId,
      filename: a.filename,
      mimeType: a.mimeType,
      size_mb: sizeMB,
      is_inline: a.isInline
    };
  });
}
```

3. **Update `classifyBatch()` to pass structured attachments:**

**Location:** `server/services/bodyClassifier.js` - Inside the `classifyBatch()` function, find where `formattedBatch` is created

```javascript
const formattedBatch = emailBatch.map(email => ({
  id: email.id,
  subject: email.subject,
  from: email.from,
  date: email.date,
  body_excerpt: email.body.substring(0, 8000),
  attachments: formatAttachmentsForLLM(email.attachments) // Structured, not summary string
}));
```

4. **Update `classifyEmailBodies()` to process attachment classifications:**

The function should continue to return an array (maintaining backward compatibility), but each classification object should be enriched with attachment filtering data.

**Location:** `server/services/bodyClassifier.js` - Inside the `classifyEmailBodies()` function, just before the final `return` statement

```javascript
export async function classifyEmailBodies(emails, onProgress) {
  // ... existing code processes batches and creates allClassifications array ...

  // Before returning, enrich classifications with attachment filtering
  // Create email lookup map for fast access
  const emailsMap = new Map(emails.map(e => [e.id, e]));

  const enrichedClassifications = allClassifications.map(classification => {
    const email = emailsMap.get(classification.id);

    if (!email || !email.attachments || email.attachments.length === 0) {
      // No email found or no attachments - return classification as-is
      return classification;
    }

    // Check if LLM returned attachment classifications
    if (!classification.attachments || !Array.isArray(classification.attachments)) {
      // LLM didn't return attachment classifications - accept all attachments (fallback)
      logger.warn(`[bodyClassifier] No attachment classifications for email ${email.id}, accepting all attachments`);
      return {
        ...classification,
        email: {
          ...email,
          rejectedAttachments: []
        }
      };
    }

    // Map attachment classifications back to attachment objects
    const validAttachments = [];
    const rejectedAttachments = [];

    email.attachments.forEach(att => {
      const attClassification = classification.attachments.find(
        a => a.attachmentId === att.attachmentId
      );

      if (!attClassification) {
        // No classification for this attachment - default to accept (conservative)
        logger.warn(`[bodyClassifier] No classification for attachment ${att.attachmentId}, defaulting to accept`);
        validAttachments.push(att);
        return;
      }

      if (attClassification.is_likely_lab_report === true) {
        validAttachments.push(att);
      } else {
        rejectedAttachments.push({
          ...att,
          rejection_reason: attClassification.reason,
          rejection_confidence: attClassification.confidence
        });
      }
    });

    return {
      ...classification,
      email: {
        ...email,
        attachments: validAttachments,
        rejectedAttachments: rejectedAttachments
      }
    };
  });

  return enrichedClassifications; // Still returns array, maintaining backward compatibility
}
```

**Important**: The function continues to return an array (not `{ results, failedBatches }`), maintaining backward compatibility with existing route code.

**Location:** `server/routes/gmailDev.js`

**Changes required:** Find the section where `step2AllResults` is created (search for "step2AllResults = fullEmails.map")

```javascript
// Existing code creates step2AllResults
const step2AllResults = fullEmails.map(email => {
  const classification = step2Classifications.find(c => c.id === email.id);

  if (!classification) {
    return {
      ...email,
      accepted: false,
      confidence: 0,
      reason: 'No classification received',
      attachments: [],
      rejectedAttachments: []
    };
  }

  const accepted = classification.is_clinical_results_email === true
    && classification.confidence >= threshold;

  return {
    id: email.id,
    subject: email.subject,
    from: email.from,
    date: email.date,
    accepted: accepted,
    confidence: classification.confidence,
    reason: classification.reason,
    attachments: classification.email?.attachments || [],  // Already filtered by Step 2
    rejectedAttachments: classification.email?.rejectedAttachments || []  // NEW
  };
});

// Continue with duplicate detection (existing logic)
const acceptedEmails = step2AllResults.filter(item => item.accepted);
const attachmentMap = new Map();
// ... rest of duplicate detection ...
```

### C. Response Schema Updates

**Location:** `server/routes/gmailDev.js` - Find where `setJobResult()` is called at the end of the Step 2 flow (search for "setJobResult")

```javascript
// Collect rejected attachments for debug section
// NOTE: This only includes attachments rejected from ACCEPTED emails (attachment-level filtering).
// Attachments from rejected emails are already covered by the "Show rejected emails" section.
// IMPORTANT: Always returns an array (empty if no rejections) - never null/undefined
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
// rejectedAttachments is now [] if filter found nothing (guaranteed array)

setJobResult(jobId, {
  results: resultsWithDuplicates,
  rejectedEmails,
  attachmentRejectedEmails,
  attachmentProblemEmails,
  rejectedAttachments,  // NEW - ALWAYS present (empty array if no rejections)
  stats,
  threshold,
  debug: { ... }
});
```

**Response Contract (API Guarantee):**
```javascript
// rejectedAttachments is ALWAYS an array (never null/undefined)
// Empty array [] when:
// - No emails had rejected attachments
// - All emails had zero attachments
// - All attachments were accepted
rejectedAttachments: Array<{
  subject: string,
  from: string,
  date: string,
  rejected: Array<{
    filename: string,
    size: number,
    reason: string,
    confidence: number
  }>
}>

// Default value if not populated: []
```

### D. Frontend UI Updates

**Location:** `public/js/unified-upload.js`

**Step 1: Update `showAttachmentSelection()` function signature:**

**Location:** `public/js/unified-upload.js` - Find the `showAttachmentSelection()` function definition (search for "function showAttachmentSelection")

```javascript
// Add rejectedAttachments parameter
function showAttachmentSelection(
  results,
  stats = {},
  rejectedEmails = [],
  attachmentRejectedEmails = [],
  attachmentProblemEmails = [],
  rejectedAttachments = []  // NEW parameter
) {
```

**Step 2: Add fourth collapsible section:**

**Location:** Inside `showAttachmentSelection()` function, immediately after the three existing debug sections and before the line `gmailSelectionSummary.innerHTML = summaryHtml` (search for "gmailSelectionSummary.innerHTML")

```javascript
// Inside showAttachmentSelection() function
// After the existing three debug sections (rejected emails, attachment issues, no usable attachments)
// Before gmailSelectionSummary.innerHTML assignment

  // [NEW] Show rejected attachments (Step 2: Attachment-level filtering)
  // This section shows attachments filtered from ACCEPTED emails only
  // (Attachments from rejected emails are already covered in first debug section)
  if (rejectedAttachments && rejectedAttachments.length > 0) {
    const totalRejected = rejectedAttachments.reduce((sum, e) => sum + e.rejected.length, 0);
    const rejectedAttId = 'rejected-attachments-section-' + Date.now();

    summaryHtml += `
      <div style="margin-top: 16px; border-top: 1px solid #e5e7eb; padding-top: 12px;">
        <button
          type="button"
          id="${rejectedAttId}-toggle"
          style="background: none; border: none; color: #6b7280; cursor: pointer; font-size: 0.9em; padding: 4px 8px; display: flex; align-items: center; gap: 6px;"
          onclick="
            const content = document.getElementById('${rejectedAttId}-content');
            const icon = document.getElementById('${rejectedAttId}-icon');
            if (content.style.display === 'none') {
              content.style.display = 'block';
              icon.textContent = '▼';
            } else {
              content.style.display = 'none';
              icon.textContent = '▶';
            }
          ">
          <span id="${rejectedAttId}-icon">▶</span>
          <span>Show ${totalRejected} rejected attachment${totalRejected > 1 ? 's' : ''} (Step 2: Non-lab-report files filtered)</span>
        </button>
        <div id="${rejectedAttId}-content" style="display: none; margin-top: 8px;">
          <p style="margin-bottom: 10px; color: #6b7280; font-size: 0.9em;">
            These attachments were filtered out during email body classification because their filenames and context
            suggest they are not lab reports (e.g., logos, signatures, decorative images).
            If you believe an attachment was incorrectly filtered, please report this as a bug.
          </p>
          <table style="width: 100%; border-collapse: collapse; font-size: 0.85em;">
            <thead>
              <tr style="background-color: #f9fafb; border-bottom: 1px solid #e5e7eb;">
                <th style="text-align: left; padding: 8px;">Email</th>
                <th style="text-align: left; padding: 8px;">Rejected Attachment</th>
                <th style="text-align: left; padding: 8px;">Size</th>
                <th style="text-align: left; padding: 8px;">Reason</th>
              </tr>
            </thead>
            <tbody>
    `;

    rejectedAttachments.forEach(email => {
      email.rejected.forEach(att => {
        summaryHtml += `
          <tr style="border-bottom: 1px solid #f3f4f6;">
            <td style="padding: 8px;">
              <strong>From:</strong> ${email.from || '(unknown)'}<br>
              <strong>Subject:</strong> ${email.subject || '(no subject)'}
            </td>
            <td style="padding: 8px;">
              <code>${att.filename}</code>
            </td>
            <td style="padding: 8px; white-space: nowrap;">
              ${formatFileSize(att.size)}
            </td>
            <td style="padding: 8px; color: #6b7280;">
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
      </div>
    `;
  }

  // Next line: gmailSelectionSummary.innerHTML = summaryHtml;
  // ... rest of function ...
}
```

**Step 3: Update the function call site:**

**Location:** `public/js/unified-upload.js` - Find where `showAttachmentSelection()` is called (search for "showAttachmentSelection(")

```javascript
// Update the showAttachmentSelection() call to pass rejectedAttachments
showAttachmentSelection(
  results,
  stats,
  rejectedEmails,
  attachmentRejectedEmails,
  attachmentProblemEmails,
  result.rejectedAttachments || []  // NEW argument
);
```

---

## Implementation Checklist

### Phase 1: Prompt Enhancement

- [ ] Update `prompts/gmail_body_classifier.txt` with attachment classification instructions
- [ ] Add examples of likely/unlikely lab report attachments
- [ ] Add guidance on using email body context for classification

### Phase 2: Backend Schema Updates

- [ ] Update `CLASSIFICATION_SCHEMA` in `bodyClassifier.js` to include `attachments` array (make it optional, not required)
- [ ] Update `formatAttachmentsForLLM()` to return structured attachment objects (not summary string)
- [ ] Update `classifyBatch()` to pass structured attachments to LLM
- [ ] Update `classifyEmailBodies()` to process attachment classifications and split into valid/rejected
- [ ] Test: Email with zero attachments (verify LLM returns empty `attachments: []`)
- [ ] Test: LLM omits `attachments` field entirely (verify fallback accepts all attachments)
- [ ] Test: LLM returns partial attachment classifications (some but not all attachments classified)
- [ ] Test: Schema validation with both valid and malformed responses

### Phase 3: Route Integration

- [ ] Update `gmailDev.js` Step 2 result mapping to include `rejectedAttachments`
- [ ] Add `rejectedAttachments` collection logic before `setJobResult()`
- [ ] Add `rejectedAttachments` to job result response (ensure always returns array, never null/undefined)
- [ ] Test: Verify `rejectedAttachments` is empty array [] when no rejections
- [ ] Test: Verify attachment filtering with real emails (logo.jpg, results.pdf)
- [ ] Test: Verify existing duplicate detection still works

### Phase 4: Frontend UI

- [ ] Update `showAttachmentSelection()` function signature to accept `rejectedAttachments` parameter
- [ ] Add fourth collapsible debug section in `unified-upload.js` (after existing three sections)
- [ ] Update function call site to pass `rejectedAttachments` data from job result
- [ ] Test: Verify UI shows rejected attachments with reasons
- [ ] Test: Verify attachment selection table only shows valid attachments
- [ ] Test: Verify button toggle mechanism works correctly

### Phase 5: Logging & Observability

- [ ] Add structured logging for attachment filtering (counts, rejection reasons)
- [ ] Log warning if LLM returns no attachment classifications (fallback to accept all)
- [ ] Update CLAUDE.md with enhanced Step 2 documentation

### Phase 6: Testing & Validation

- [ ] Manual test: Email with logo.jpg + results.pdf (verify logo filtered)
- [ ] Manual test: Email with signature.png + bloodwork.pdf (verify signature filtered)
- [ ] Manual test: Email with generic "document.pdf" (verify NOT filtered - conservative)
- [ ] Manual test: Email body mentions "attached is your report and our logo" (verify context used)
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

**Quality Metrics (Priority Hierarchy):**
1. **False negatives: 0** (MANDATORY - never hide real lab reports)
2. **False positives: <2%** (ASPIRATIONAL - minimize showing non-lab files)

**Important:** These metrics reflect a strict priority hierarchy:
- **Priority 1** is non-negotiable: hiding a real lab report is catastrophic user impact
- **Priority 2** is an optimization goal: showing a logo is minor annoyance
- When in conflict, always choose false positive over false negative
- The prompt enforces Priority 1; the <2% target for Priority 2 is an aspirational optimization, not a hard requirement

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| LLM rejects real lab report (false negative) | High (user loses data) | Conservative prompt ("if uncertain, mark as likely"), log all rejections for review |
| LLM accepts logo/signature (false positive) | Low (user manually skips) | Acceptable trade-off, prioritize avoiding false negatives |
| LLM doesn't return attachment classifications | Medium (all attachments shown) | Fallback: If `attachments` array missing, accept all attachments (log warning) |
| Increased Step 2 latency | Low (minimal token increase) | Structured attachment objects add ~50 tokens per email, negligible impact |
| UI clutter with debug section | Low (only for power users) | Collapsible by default, clear labeling |

---

## Future Enhancements (Out of Scope)

- **Attachment content analysis:** Use vision models to detect if image contains lab results
- **User feedback loop:** "Was this attachment correctly classified?" → Improve prompt
- **Attachment type classification:** Categorize as blood_test, mri_report, logo, etc.
- **Persistent rejection logs:** Store rejections in database for analytics

---

## Change Log

**2025-12-02:** Merged separate Step 2.5 (attachment name validation) into enhanced Step 2. Rationale: Step 2 already has superior context (email body, subject, sender) for better attachment classification. One less API call, better accuracy, simpler architecture.
