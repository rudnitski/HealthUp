# PRD — Gmail Integration (Step-3)

**Scope:** User-controlled download + OCR ingestion of Gmail attachments confirmed in Step-2, with integrated debug tables for Steps 1–3 and automatic redirection to the main lab-results view after processing.  
**Model:** Vision/OCR provider via existing `VisionProviderFactory` (OpenAI or Anthropic).  
**Mode:** Dev-only, feature-flagged.

---

## 1. Objective

Expand the Gmail integration to the full ingestion loop:

1. Retain visibility into **Step 1 (subject/sender classification)** and **Step 2 (body + attachment metadata classification)**.  
2. In a new **Step 3 view**, list all Step-2 emails (including duplicates flagged by attachment name/size/hash).  
3. Let the user **select which attachments to download and recognize**.  
4. Download, OCR, and persist them through the same pipeline used for manual uploads.  
5. When all chosen attachments finish processing, **redirect to the main HealthUp page** (`index.html`) where recognized reports appear one-by-one exactly like normal manual uploads.

---

## 2. Goals

- ✅ Maintain full debug visibility of Step 1 & 2 tables.  
- ✅ Display all Step-2 emails again in Step-3, with duplicate indicators.  
- ✅ Add a **selection checkbox** per attachment and a **“Download & Recognize”** button.  
- ✅ Execute recognition in parallel batch jobs with **per-attachment progress** (queued → downloading → OCR → completed/failed).  
- ✅ On completion, automatically redirect to the main results page where new lab reports are visible.  
- ✅ Reuse existing ingestion logic: `/api/analyze-labs`, `labReportProcessor`, `MappingApplier`.  
- ✅ Keep Gmail read-only; attachments processed transiently, never stored beyond ingestion.

---

## 3. Non-Goals

- ❌ Automatic ingestion of all attachments (user must choose).  
- ❌ Modifying or labeling Gmail messages.  
- ❌ Any UI redesign of the main HealthUp results area beyond listing multiple reports.  
- ❌ Multi-user support or production enablement (dev-only).

---

## 4. Flow Overview

### A — UI Overview

| Step | Purpose | Visible Data |
|------|----------|--------------|
| **Step 1** | Raw subject/sender classification | All 200 emails fetched |
| **Step 2** | Body + attachment analysis | Reduced list of potential lab results |
| **Step 3** | Attachment ingestion | All Step-2 emails + duplicate marks + selection checkboxes |

All three remain visible on the Gmail-Dev page, collapsible for clarity.

---

### B — Attachment Selection & Batch Start

1. User checks attachments to process.  
2. Clicks **“Download & Recognize Selected”**.  
3. Front-end sends  
   ```json
   {
     "attachments": [
       { "messageId": "...", "attachmentId": "...", "filename": "...", "mimeType": "application/pdf" }
     ]
   }
   ```  
   to `POST /api/dev-gmail/ingest`.  
4. Backend validates Gmail token, verifies mime type & size, then queues one job per attachment via `jobManager`.

---

### C — Attachment Download → OCR → Persistence

Per job:

1. Gmail API `users.messages.attachments.get` → decode base64 → in-memory buffer.  
2. Stream buffer to `labReportProcessor.processLabReport()` (same path as manual upload).  
3. Vision provider extracts structured data → `reportPersistence` saves → `MappingApplier` runs.  
4. On success:  
   - mark job `completed`;  
   - record provenance (messageId, attachment SHA, sender, subject, date).  
5. On failure:  
   - mark job `failed` + error reason.  
6. Remove buffer after ingestion.

---

### D — UI Progress & Completion

- Table columns:  
  - ✅ **Select** (checkbox)  
  - 📎 **Filename / Size / Type**  
  - 🔁 **Duplicate** (if detected by name + size + hash)  
  - 🧠 **Status** (Queued → Downloading → Recognizing → Done / Failed)  
  - 🪶 **Progress bar %**  
  - 🗒️ **Reason / Error (if any)**  

- The page polls `/api/dev-gmail/jobs/summary` every 2 s.  

- When all selected attachments finish:  
  - Show completion modal (“All selected attachments processed successfully”).  
  - Auto-redirect (3 s delay) to `/index.html?source=gmail`.  
  - On the main page, newly ingested lab reports appear sequentially via the existing “manual upload” display component.

---

## 5. Backend API Additions

### `POST /api/dev-gmail/ingest`

| Field | Type | Description |
|--------|------|-------------|
| `attachments[]` | array | messageId + attachmentId + filename + mimeType |
| Response | `{ job_ids: [...], count: n }` |

- Validates Gmail authentication and attachment metadata.  
- Rejects unsupported types / oversize files.  
- Creates one ingestion job per attachment.

### `GET /api/dev-gmail/jobs/summary`

Returns live per-attachment states (`pending`, `downloading`, `processing`, `completed`, `failed`) with progress %, filename, and error (if any).

### Service: `server/services/gmailAttachmentIngest.js`

Responsibilities:  
- Gmail download → decode → buffer → feed to `labReportProcessor`.  
- Deduplicate attachments via SHA-256 before ingestion.  
- Stream progress updates to `jobManager`.

---

## 6. Duplicate Detection Logic

Within Step-3 table:  
- Compute hash key = lowercase(filename) + size + extension.  
- Mark duplicates in same batch with a ⚠️ icon.  
- Still allow user to include/exclude each manually.

---

## 7. Configuration (.env)

| Variable | Purpose |
|-----------|----------|
| `GMAIL_ATTACHMENT_INGEST_ENABLED` | Enable Step-3 routes |
| `GMAIL_ALLOWED_MIME` | `application/pdf,image/png,image/jpeg,image/tiff` |
| `GMAIL_MAX_ATTACHMENT_MB` | Max allowed size (default 15) |
| `OCR_PROVIDER` | `openai` (default) or `anthropic` |
| `OPENAI_USE_NATIVE_PDF` | true/false (reuses current OCR config) |

---

## 8. Error Handling

| Scenario | Handling |
|-----------|-----------|
| Token expired | 401 → UI prompt “Reconnect Gmail” |
| Gmail 429 | Retry with exponential backoff per job |
| Unsupported / oversize file | Mark skipped + reason |
| OCR provider error | Job = failed + reason |
| Duplicate by SHA | Mark duplicate; skip unless user overrides |
| Network failure | Retry once; if still failing → failed |

---

## 9. Security & Privacy

- Gmail scope remains **read-only**.  
- Attachment bytes processed only in memory; removed after OCR.  
- No email bodies or attachments persisted or logged.  
- Provenance data (IDs + hash) stored only inside HealthUp DB after ingestion.

---

## 10. Acceptance Criteria

- ✅ UI displays all three steps (1–3) with collapsible sections.  
- ✅ Step-3 shows all Step-2 results (with duplicates flagged).  
- ✅ User can check attachments and start recognition.  
- ✅ Each attachment shows live progress and final status.  
- ✅ On completion, redirect to main HealthUp page showing all newly recognized lab reports.  
- ✅ No raw email data written to logs or disk.  
- ✅ Routes disabled unless `GMAIL_ATTACHMENT_INGEST_ENABLED=true`.

---

**Status:** Draft — Ready for implementation discussion  
**Next Step:** Implement `gmailAttachmentIngest` service, extend `gmailDev.js` for Step-3 table and batch-processing UI, wire redirect to main page after completion.
