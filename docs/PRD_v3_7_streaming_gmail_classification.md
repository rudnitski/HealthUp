# PRD v3.7: Streaming Gmail Classification Pipeline

**Status:** Ready for Implementation
**Created:** 2025-11-27
**Author:** Claude (with user collaboration)
**Target Release:** v3.7
**Dependencies:** PRD v2.8 (Gmail Integration Steps 1-3), PRD v3.6 (Attachment Name Validation)

---

## Overview

### Problem Statement

The current Gmail integration pipeline uses a **batch-and-process pattern** that introduces unnecessary latency:

```
Current Flow (Sequential):
1. Fetch ALL 3500 emails metadata (batches of 100, ~150 seconds)
   └─> WAIT for completion
2. THEN classify ALL 3500 emails with LLM (batches of 25, ~300+ seconds)
   └─> Total: ~450+ seconds before user sees results
```

**The Bottleneck:**
`server/routes/gmailDev.js:448` waits for **all** metadata to be fetched before starting LLM classification:

```javascript
const metadataEmails = await fetchEmailMetadata(); // BLOCKS until all 3500 emails fetched
// ...
await classifyEmails(metadataEmails, ...); // Only starts AFTER above completes
```

**Real-World Impact:**
- User waits 2.5 minutes for metadata fetch to complete before ANY classification starts
- Gmail API and LLM work sequentially instead of in parallel
- High memory usage (all 3500 emails buffered in memory before processing)
- Poor perceived performance (no progressive results)

### Goals

1. **Reduce total processing time by 25-30%** through parallelization of Gmail fetch and LLM classification
2. **Start LLM classification immediately** as soon as first Gmail batch arrives
3. **Stream work progressively** to overlap Gmail fetch and LLM classification
4. **Maintain existing error handling** and retry logic
5. **Preserve concurrency controls** to avoid exceeding LLM/Gmail API rate limits

### Non-Goals (Out of Scope)

- Changing Step 2 (body classification) or Step 2.5 (attachment validation) logic
- Modifying LLM batch sizes within `classifyEmails()` (batches of 25, concurrency 3)
- Altering Gmail API rate limits or batch sizes
- Changing UI polling behavior or result display
- Reducing memory footprint (both `metadataEmails` and `allClassifications` remain in memory)

---

## Current State Analysis

### Step 1 Flow (Metadata Classification)

**Location:** `server/routes/gmailDev.js:440-500`

```javascript
// 1. Fetch ALL metadata (blocking)
const metadataEmails = await fetchEmailMetadata(); // Returns array of 3500 emails

// 2. THEN classify (only starts after fetch completes)
const { results: step1Classifications } = await classifyEmails(metadataEmails, onProgress);
```

**Timing breakdown for 3500 emails:**
- Gmail metadata fetch: ~150 seconds (35 batches × 100 emails, sequential batches)
- LLM classification: ~300 seconds (140 batches × 25 emails, 3 concurrent)
- **Total: ~450 seconds (7.5 minutes)**

### fetchEmailMetadata() Architecture

**Location:** `server/services/gmailConnector.js:367-490`

Current implementation:
1. Fetch all email IDs with pagination (500 IDs per page)
2. Fetch metadata in batches of 100 emails
3. Return complete array only after ALL batches complete

```javascript
async function fetchEmailMetadata() {
  // ... fetch all IDs ...

  const emailMetadata = [];
  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    // Fetch batch of 100 emails
    const batchPromises = batchMessages.map(({ id }) =>
      SHARED_GMAIL_LIMITER(async () => { /* fetch metadata */ })
    );
    const batchResults = await Promise.all(batchPromises);
    emailMetadata.push(...batchResults); // Accumulate in memory
  }

  return emailMetadata; // Returns ONLY after all batches complete
}
```

**Problem:** No mechanism to process batches as they arrive.

### classifyEmails() Architecture

**Location:** `server/services/emailClassifier.js:178-280`

Current implementation:
- Accepts full array of emails
- Splits into batches of 25
- Processes batches in parallel (concurrency: 3)
- Returns aggregated results

```javascript
async function classifyEmails(emails, onProgress = null) {
  // Split emails into batches
  const batches = [];
  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    batches.push(emails.slice(i, i + BATCH_SIZE));
  }

  // Process ALL batches in parallel
  const batchResults = await Promise.all(
    batches.map((batch, index) => limit(async () => classifyBatch(batch)))
  );

  return { results: batchResults.flat() };
}
```

**Observation:** `classifyEmails()` already processes batches in parallel internally. We just need to feed it emails incrementally instead of all at once.

---

## Proposed Solution

### Design Principles

1. **Streaming pipeline:** Process emails as they arrive from Gmail API
2. **Non-breaking change:** Maintain backward compatibility with existing code
3. **Progressive aggregation:** Accumulate classification results as batches complete
4. **Preserve concurrency controls:** Keep existing rate limits and batch sizes
5. **Maintain error handling:** Retry logic, failed batch tracking, progress updates

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Gmail API (batches of 100)                                  │
└──┬──────┬──────┬──────┬──────────────────────────────┬─────┘
   │      │      │      │                              │
   ▼      ▼      ▼      ▼                              ▼
┌──────┬──────┬──────┬──────┐                    ┌──────┐
│Batch1│Batch2│Batch3│Batch4│ ... (all queued)   │Batch35│
└──┬───┴──┬───┴──┬───┴──┬───┘                    └──┬───┘
   │      │      │      │                           │
   │ (immediately feed to LLM, don't wait)          │
   ▼      ▼      ▼      ▼                           ▼
┌────────────────────────────────────────────────────────────┐
│ LLM Classifier (batches of 25, concurrency: 3)            │
│ Processes batches AS THEY ARRIVE                           │
└────────────────────────────────────────────────────────────┘
```

**Time Comparison:**

Current (Sequential - No Overlap):
```
|------ Gmail Fetch 150s ------|------- LLM Classify 300s -------|
                                                    Total: 450s
```

Optimized (Parallel - Gmail/LLM Overlap):
```
|------ Gmail Fetch 150s ------|
    |------- LLM Classify 300s -------|
                                   Total: ~320s (29% faster)
```

**Why ~320s total?**
- Gmail fetches first batch (~4s) → starts first LLM classification
- Gmail continues fetching while LLM processes earlier batches (overlap)
- LLM bottleneck (300s total) dominates, but starts ~10-20s earlier than before
- Small overhead from 35 separate `classifyEmails()` invocations (~20s)
- Net savings: ~130s (29% reduction from 450s)

---

## Technical Design

### A. Add Streaming Support to fetchEmailMetadata()

**Location:** `server/services/gmailConnector.js`

**New signature:**
```javascript
async function fetchEmailMetadata(onBatchReady = null) {
  // ... existing ID fetch logic ...

  const emailMetadata = [];
  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const batchStart = batchIndex * BATCH_SIZE;
    const batchEnd = Math.min(batchStart + BATCH_SIZE, allMessages.length);
    const batchMessages = allMessages.slice(batchStart, batchEnd);

    logger.info(`[gmailConnector] Fetching metadata batch ${batchIndex + 1}/${totalBatches}`);

    // Fetch metadata in parallel within this batch
    const batchPromises = batchMessages.map(({ id }) =>
      SHARED_GMAIL_LIMITER(async () => { /* existing fetch logic */ })
    );
    const batchResults = await Promise.all(batchPromises);

    // [NEW] Stream batch to callback IMMEDIATELY (don't wait for all batches)
    if (onBatchReady) {
      await onBatchReady(batchResults, {
        batchIndex: batchIndex + 1,
        totalBatches,
        completedEmails: emailMetadata.length + batchResults.length,
        totalEmails: allMessages.length
      });
    }

    emailMetadata.push(...batchResults);

    // Existing progress logging
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = (emailMetadata.length / elapsed).toFixed(1);
    logger.info(`[gmailConnector] Batch ${batchIndex + 1}/${totalBatches} complete: ${emailMetadata.length}/${allMessages.length} emails fetched (${elapsed.toFixed(1)}s elapsed, ${rate} emails/sec)`);
  }

  logger.info(`[gmailConnector] Successfully fetched metadata for ${emailMetadata.length} emails`);
  return emailMetadata; // Still return full array for backward compatibility
}
```

**Backward Compatibility:** If `onBatchReady` is not provided, function behaves identically to current implementation (returns full array after all batches complete).

### B. Add Streaming Classifier Wrapper

**Location:** `server/routes/gmailDev.js` (new helper function)

```javascript
import pLimit from 'p-limit';

/**
 * Stream-based email classification
 * Accepts emails incrementally and aggregates results
 *
 * CONCURRENCY CONTROL:
 * - Limits concurrent classifyEmails() invocations to prevent API rate limit violations
 * - Each classifyEmails() call internally uses pLimit(3) for LLM batch concurrency
 * - With MAX_CONCURRENT_GMAIL_BATCHES=3, max concurrent LLM requests = 3 × 3 = 9
 *
 * CONCURRENCY CONTROL (NOT BACK-PRESSURE):
 * - feedBatch() returns immediately (non-blocking) to allow Gmail/LLM overlap
 * - pLimit(maxConcurrentBatches) caps concurrent executions but queues excess calls
 * - Queue grows unbounded when Gmail fetch outpaces classification (expected behavior)
 * - Memory usage: allEmails array duplicates metadataEmails (higher than current)
 *
 * PROGRESS TRACKING:
 * - Aggregates progress across all concurrent classifyEmails() invocations
 * - Tracks total emails sent vs total classifications received
 * - Ignores individual classifyEmails() progress callbacks (which reset per invocation)
 * - Reports global 0-100% progress to upstream callback
 *
 * ERROR HANDLING:
 * - classifyEmails() already has 3-attempt retry logic with exponential backoff
 * - _classifyBatch() catch block only triggers if all retries exhausted
 * - Failed batches are aggregated and returned in finalize() for upstream handling
 */
class StreamingClassifier {
  constructor(onProgress = null, maxConcurrentBatches = 3) {
    this.allEmails = [];
    this.allClassifications = [];
    this.failedBatches = [];
    this.onProgress = onProgress;
    this.activeClassifications = [];
    this.totalBatchesReceived = 0;
    this.totalEmailsSent = 0;
    this.totalClassificationsReceived = 0;

    // Limit concurrent classifyEmails() invocations
    this.limiter = pLimit(maxConcurrentBatches);
  }

  /**
   * Feed a batch of emails for classification
   * Returns immediately (non-blocking) to allow parallel Gmail fetch + LLM classification
   */
  async feedBatch(emails) {
    this.allEmails.push(...emails);
    this.totalBatchesReceived++;
    this.totalEmailsSent += emails.length;

    // Queue classification with concurrency limit (non-blocking)
    // pLimit() will queue internally when limit is reached, without blocking this call
    const classificationPromise = this.limiter(() => this._classifyBatch(emails));
    this.activeClassifications.push(classificationPromise);

    // DO NOT await - return immediately to allow Gmail fetch to continue
  }

  /**
   * Wait for all pending classifications to complete
   */
  async finalize() {
    // Wait for all active classifications to finish
    await Promise.all(this.activeClassifications);

    return {
      results: this.allClassifications,
      failedBatches: this.failedBatches,
      stats: {
        classifications_received: this.allClassifications.length,
        extra_count: this.allClassifications.length - this.allEmails.length,
        missing_count: Math.max(0, this.allEmails.length - this.allClassifications.length)
      }
    };
  }

  async _classifyBatch(emails) {
    try {
      // classifyEmails() already handles retries (3 attempts with exponential backoff)
      // This catch block only triggers if all retries fail
      // NOTE: We pass null instead of this.onProgress because we aggregate progress manually below
      const { results, failedBatches } = await classifyEmails(emails, null);

      this.allClassifications.push(...results);
      this.failedBatches.push(...failedBatches);

      // Update aggregate progress
      this.totalClassificationsReceived += results.length;
      if (this.onProgress) {
        // Report global progress: total classifications received / total emails sent
        const globalProgress = Math.min(
          Math.floor((this.totalClassificationsReceived / this.totalEmailsSent) * 100),
          100
        );
        this.onProgress(this.totalClassificationsReceived, this.totalEmailsSent, globalProgress);
      }
    } catch (error) {
      // All retries exhausted, log and track as failed batch
      logger.error('[StreamingClassifier] Batch classification failed after all retries', error);
      this.failedBatches.push({
        __failed: true,
        error: error.message,
        emailCount: emails.length
      });
    }
  }
}
```

### C. Update Step 1 Flow in gmailDev.js

**Location:** `server/routes/gmailDev.js:440-500`

```javascript
setImmediate(async () => {
  try {
    updateJob(jobId, JobStatus.PROCESSING);

    // ===== STEP 1: Metadata Classification (STREAMING) =====
    logger.info(`[gmailDev:${jobId}] [Step-1] Starting streaming metadata classification`);

    // Create streaming classifier with aggregate progress tracking
    const classifier = new StreamingClassifier((completed, total, globalProgress) => {
      // globalProgress is already computed as 0-100% by StreamingClassifier
      // Map to 0-50% for Step-1 portion of overall job progress
      const step1Progress = Math.floor(globalProgress * 0.5); // 0-100% → 0-50%
      updateJob(jobId, JobStatus.PROCESSING, {
        progress: step1Progress,
        progressMessage: `Step-1: Classified ${completed}/${total} emails`
      });
    });

    // Fetch metadata with streaming callback
    const metadataEmails = await fetchEmailMetadata(async (batchEmails, batchInfo) => {
      // Feed batch to classifier (non-blocking - returns immediately)
      // This allows Gmail fetch and LLM classification to run in parallel
      classifier.feedBatch(batchEmails);

      logger.info(
        `[gmailDev:${jobId}] [Step-1] Queued batch ${batchInfo.batchIndex}/${batchInfo.totalBatches} ` +
        `(${batchEmails.length} emails) for classification`
      );
    });

    if (metadataEmails.length === 0) {
      // ... existing empty result handling ...
      return;
    }

    logger.info(`[gmailDev:${jobId}] [Step-1] Fetched ${metadataEmails.length} emails metadata`);
    logger.info(`[gmailDev:${jobId}] [Step-1] Waiting for classification to complete...`);

    // Wait for all classifications to finish
    const { results: step1Classifications, failedBatches: step1FailedBatches, stats: step1Stats } =
      await classifier.finalize();

    logger.info(`[gmailDev:${jobId}] [Step-1] Classification complete: ${step1Classifications.length} results`);

    // ... rest of existing Step 1 logic (filtering candidates, etc.) ...
  } catch (error) {
    logger.error(`[gmailDev:${jobId}] Job failed:`, error.message);
    setJobError(jobId, error);
  }
});
```

---

## Implementation Checklist

### Phase 1: Add Streaming Infrastructure

- [ ] Update `fetchEmailMetadata()` to accept `onBatchReady` callback
- [ ] Add backward compatibility test (ensure existing calls still work)
- [ ] Create `StreamingClassifier` class in `gmailDev.js`
- [ ] Unit test: Verify streaming classifier aggregates results correctly
- [ ] Unit test: Verify streaming classifier handles failures gracefully

### Phase 2: Integrate Streaming Pipeline

- [ ] Update Step 1 flow in `gmailDev.js` to use streaming classifier
- [ ] Update progress tracking to account for overlapping Gmail fetch + LLM classification
- [ ] Test: Verify classifications start before all metadata is fetched
- [ ] Test: Verify final results match non-streaming implementation
- [ ] Test: Verify failed batch tracking still works

### Phase 3: Performance Validation

- [ ] Benchmark: Measure total time for 3500 emails (before vs after)
- [ ] Benchmark: Measure time to first classification result
- [ ] Monitor: Track memory usage during streaming vs batch processing
- [ ] Test: Verify no regressions in Step 2, Step 2.5, or Step 3

### Phase 4: Logging & Observability

- [ ] Add structured logging for streaming events
- [ ] Log: Time saved by parallel processing
- [ ] Update CLAUDE.md with streaming architecture documentation

### Phase 5: Production Readiness

- [ ] Manual test: Full Gmail fetch with streaming enabled
- [ ] Manual test: Error handling (simulate LLM timeout mid-stream)
- [ ] Regression test: Verify existing flows still work
- [ ] Performance dashboard: Track average processing time reduction

---

## Success Metrics

**Pre-launch (Baseline):**
- Measure: Total time for 3500 emails (Gmail fetch + Step 1 classification)
- Expected: ~450 seconds (7.5 minutes) - **needs empirical validation**

**Post-launch (Target):**
- Measure: Total time for 3500 emails with streaming
- Target: ~320 seconds (5.3 minutes) - **29% reduction** (estimated, pending validation)

**Additional Metrics:**
- Time to first classification result: <15 seconds best-case (vs ~150 seconds before)
- Classification accuracy: 100% match with non-streaming (no regressions)
- Concurrency control: Max 3 concurrent Gmail batches being classified (9 concurrent LLM API calls)

**Note on Memory Usage:**
- Streaming **increases** peak memory usage due to duplication:
  - `metadataEmails` array: Returned by `fetchEmailMetadata()`
  - `allEmails` array: Copy maintained in `StreamingClassifier`
  - `pLimit` queue: 35 pending classification promises
- For 3500 emails: ~700KB additional memory (acceptable trade-off for 29% performance gain)
- Future optimization could process-and-discard batches to eliminate duplication

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Increased code complexity | Medium (harder to debug) | Maintain backward compatibility, add comprehensive logging |
| Race conditions in result aggregation | High (incorrect results) | Use proper async/await, test with concurrent batches |
| Concurrency explosion | High (API rate limits) | **MITIGATED**: StreamingClassifier uses pLimit(3) to cap concurrent classifyEmails() calls (max 9 LLM requests) |
| Unbounded queue growth | Low (acceptable trade-off) | pLimit(3) queues excess calls; for 3500 emails this adds ~350KB (35 batches × 10KB metadata); acceptable for performance gain |
| Regression in error handling | Medium (failed jobs) | **MITIGATED**: Documented that classifyEmails() retry logic is preserved |
| Repeated invocation overhead | Low (performance degradation) | 35 separate classifyEmails() calls add ~20s overhead (prompt loading, setup), but negligible vs 300s LLM time |
| Performance claims unvalidated | Medium (wrong targets) | **ACKNOWLEDGED**: 450s baseline and 29% savings are estimates pending empirical measurement |
| Gmail API rate limit changes | Low (streaming throttled) | Rate limiter already in place (SHARED_GMAIL_LIMITER) |

---

## Future Enhancements (Out of Scope)

- **Streaming Step 2 (body classification):** Apply same pattern to body classification
- **Progressive UI updates:** Show classified emails as they arrive (instead of waiting for all)
- **Adaptive batch sizing:** Adjust Gmail/LLM batch sizes based on API latency
- **Persistent streaming:** Resume interrupted streams from last checkpoint

---

## Appendix: Performance Analysis

**IMPORTANT**: The timing estimates below are theoretical calculations based on assumed Gmail API and LLM API latencies. Actual performance must be validated empirically with real Gmail accounts and current `GMAIL_CONCURRENCY_LIMIT=50` settings.

### Current Performance Profile (3500 emails)

```
Timeline (Estimated):
00:00 - 02:30  Gmail metadata fetch (35 batches × 100 emails)
02:30 - 07:30  LLM classification (140 batches × 25 emails, 3 concurrent)
07:30          Results returned to user

Bottleneck: Sequential processing (Gmail → LLM, zero overlap)
```

### Optimized Performance Profile (3500 emails)

```
Timeline (Estimated):
00:00          Gmail batch 1 (100 emails) starts fetching
00:04          Gmail batch 1 complete → LLM classification starts (non-blocking)
00:04          Gmail batch 2 starts fetching (parallel with LLM)
00:08          Gmail batch 2 complete → LLM classification queued
...
02:30          Gmail batch 35 complete → All metadata fetched, Gmail idle
               LLM still processing earlier batches
05:20          LLM finishes all classifications (300s + ~20s overhead)
05:20          Results returned to user

Bottleneck: LLM classification (320s total), but overlaps with Gmail fetch
Time saved: ~130s (2.2 minutes)
```

**Calculation:**
- Gmail fetch time: 150s (unchanged)
- LLM classification time: 300s base + ~20s overhead from 35 invocations = 320s
- Current: 150s (Gmail) + 300s (LLM) = 450s (sequential, zero overlap)
- Optimized: First Gmail batch (4s) + LLM total (320s) = ~324s (overlapped)
- **Estimated Savings: ~126s (28% faster)**
- **Note**: Actual savings depend on Gmail/LLM API latencies and cannot be precisely calculated without empirical measurement

### Scalability Impact

| Email Count | Current (s) | Optimized (s) | Savings (%) |
|-------------|-------------|---------------|-------------|
| 500         | 65          | 43            | 34%         |
| 1000        | 130         | 86            | 34%         |
| 2000        | 260         | 172           | 34%         |
| 3500        | 450         | 300           | 33%         |
| 5000        | 650         | 430           | 34%         |

**Pattern:** Savings scale linearly with email count (constant ~33% reduction).
