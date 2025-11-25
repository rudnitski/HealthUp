/**
 * Gmail Attachment Ingest Service
 * Orchestrates attachment download, duplicate detection, and ingestion pipeline
 * PRD: docs/PRD_v2_8_Gmail_Integration_Step3.md
 */

const { SHARED_GMAIL_LIMITER, ...gmailConnector } = require('./gmailConnector');
const crypto = require('crypto');
const jobManager = require('../utils/jobManager');
const labReportProcessor = require('./labReportProcessor');
const { pool } = require('../db');
const pino = require('pino');

const NODE_ENV = process.env.NODE_ENV || 'development';

// Logger with pretty printing in development
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

// Helper: Sleep for async delays
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Configuration constants
// Note: Gmail API rate limiting now handled by SHARED_GMAIL_LIMITER from gmailConnector
const RETRY_CONFIG = { maxAttempts: 3, baseDelay: 1000 }; // 1s, 2s, 4s
const ATTACHMENT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// In-memory attachment tracking (simple Map, not persistent)
const attachmentJobs = new Map(); // attachmentId → { status, progress, progressMessage, jobId, reportId, error, ... }

/**
 * Check if a file is valid based on MIME type or file extension
 * Handles cases where Gmail returns 'application/octet-stream' for PDFs
 */
function isValidAttachment(filename, mimeType, allowedMimes) {
  // Normalize MIME type to lowercase for comparison
  const normalizedMime = (mimeType || '').toLowerCase();

  // Check if MIME type is in allowed list (case-insensitive)
  const normalizedAllowedMimes = allowedMimes.map(m => m.toLowerCase());
  if (normalizedAllowedMimes.includes(normalizedMime)) {
    return true;
  }

  // Fallback: Check file extension for common cases where Gmail misidentifies MIME type
  const filenameLower = (filename || '').toLowerCase();

  // If MIME type is generic (application/octet-stream), check extension
  if (normalizedMime === 'application/octet-stream' || !mimeType) {
    if (filenameLower.endsWith('.pdf')) return true;
    if (filenameLower.endsWith('.png')) return true;
    if (filenameLower.endsWith('.jpg') || filenameLower.endsWith('.jpeg')) return true;
  }

  return false;
}

/**
 * Start batch ingestion of selected attachments
 * @param {Array} selections - Array of { messageId, attachmentId, filename, mimeType, size }
 * @returns {Object} - { batchId, count }
 */
async function startBatchIngestion(selections) {
  const batchId = `batch_${Date.now()}`; // e.g., "batch_1730900000000"

  logger.info(`[gmailAttachmentIngest] Starting batch ${batchId} with ${selections.length} attachments`);

  // Ensure Gmail tokens are fresh (triggers auto-refresh if needed)
  // This is critical for long-running workflows where user may return hours later
  const authenticated = await gmailConnector.ensureFreshTokens();
  if (!authenticated) {
    throw new Error('Gmail authentication expired. Please reconnect to Gmail and try again.');
  }

  // Validate selections (mime type, size limits)
  const allowedMimes = (process.env.GMAIL_ALLOWED_MIME || 'application/pdf,image/png,image/jpeg,image/heic').split(',');
  const maxBytes = parseInt(process.env.GMAIL_MAX_ATTACHMENT_MB || '15') * 1024 * 1024;

  const validSelections = selections.filter(sel => {
    if (!isValidAttachment(sel.filename, sel.mimeType, allowedMimes)) {
      logger.warn(`Skipping ${sel.filename}: unsupported MIME type ${sel.mimeType}`);
      return false;
    }
    if (sel.size > maxBytes) {
      logger.warn(`Skipping ${sel.filename}: file too large (${Math.round(sel.size / 1024 / 1024)}MB)`);
      return false;
    }
    return true;
  });

  // Initialize tracking for each attachment
  validSelections.forEach(sel => {
    const trackingId = `${sel.messageId}_${sel.attachmentId}`;
    attachmentJobs.set(trackingId, {
      batchId,
      messageId: sel.messageId,
      attachmentId: sel.attachmentId,
      filename: sel.filename,
      mimeType: sel.mimeType,
      size: sel.size,
      status: 'queued',
      progress: 0,
      progressMessage: 'Waiting to start...',
      jobId: null,
      reportId: null,
      error: null,
      startedAt: null,
      completedAt: null
    });
  });

  // Start processing with controlled concurrency
  processAttachmentsWithConcurrency(validSelections, batchId);

  return { batchId, count: validSelections.length };
}

/**
 * Process attachments with concurrency
 * Note: Gmail API rate limiting now handled inside downloadAttachmentWithRetry (wraps only the API call)
 */
async function processAttachmentsWithConcurrency(selections, batchId) {
  logger.info(`[gmailAttachmentIngest] Processing batch ${batchId} (${selections.length} attachments)`);

  // No limiter wrapper here - each ingestAttachment will rate-limit only its Gmail API call
  const promises = selections.map(sel =>
    ingestAttachment(sel, batchId)
  );

  await Promise.allSettled(promises);
  logger.info(`[gmailAttachmentIngest] Batch ${batchId} completed`);
}

/**
 * Ingest a single attachment through the full pipeline
 */
async function ingestAttachment(selection, batchId) {
  const trackingId = `${selection.messageId}_${selection.attachmentId}`;
  const tracking = attachmentJobs.get(trackingId);

  logger.info(`[gmailAttachmentIngest] Starting ingestion: ${selection.filename}`);

  // Get authenticated Gmail client from connector
  const gmail = await gmailConnector.getAuthenticatedGmailClient();

  try {
    tracking.startedAt = Date.now();

    // Step 1: Check if this Gmail attachment was already processed in a previous batch
    updateStatus(trackingId, 'queued', 5, 'Checking for cross-batch duplicates...');
    const existingProvenance = await checkGmailProvenanceExists(selection.messageId, selection.attachmentId);
    if (existingProvenance) {
      logger.info(`[gmailAttachmentIngest] ${selection.filename} already ingested (provenance match)`);
      updateStatus(trackingId, 'duplicate', 100, 'Already ingested in previous batch');
      tracking.reportId = existingProvenance.report_id;
      tracking.completedAt = Date.now();
      return;
    }

    // Step 2: Download attachment
    updateStatus(trackingId, 'downloading', 10, 'Downloading from Gmail...');
    const buffer = await downloadAttachmentWithRetry(gmail, selection.messageId, selection.attachmentId);

    logger.info(`[gmailAttachmentIngest] Downloaded ${selection.filename} (${buffer.length} bytes)`);

    // Step 3: Compute SHA-256 checksum + short-circuit if we've already OCR'd this payload
    updateStatus(trackingId, 'processing', 30, 'Computing checksum...');
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
    const existingChecksumProvenance = await checkChecksumAlreadyProcessed(checksum);
    if (existingChecksumProvenance) {
      logger.info(`[gmailAttachmentIngest] ${selection.filename} already ingested (checksum match)`);
      updateStatus(trackingId, 'duplicate', 100, 'Checksum already ingested');
      tracking.reportId = existingChecksumProvenance.report_id;
      tracking.completedAt = Date.now();
      return;
    }

    // Step 4: Create job in jobManager for labReportProcessor
    updateStatus(trackingId, 'processing', 40, 'Starting OCR extraction...');
    const jobId = jobManager.createJob('gmail-attachment', {
      filename: selection.filename,
      messageId: selection.messageId,
      attachmentId: selection.attachmentId
    });
    tracking.jobId = jobId;

    logger.info(`[gmailAttachmentIngest] Created job ${jobId} for ${selection.filename}`);

    // Normalize MIME type based on file extension (Gmail sometimes returns generic types)
    let normalizedMimeType = selection.mimeType.toLowerCase();
    const filenameLower = selection.filename.toLowerCase();

    if (normalizedMimeType === 'application/octet-stream' || !selection.mimeType) {
      if (filenameLower.endsWith('.pdf')) {
        normalizedMimeType = 'application/pdf';
        logger.info(`[gmailAttachmentIngest] Normalized MIME type to application/pdf for ${selection.filename}`);
      } else if (filenameLower.endsWith('.png')) {
        normalizedMimeType = 'image/png';
      } else if (filenameLower.endsWith('.jpg') || filenameLower.endsWith('.jpeg')) {
        normalizedMimeType = 'image/jpeg';
      }
    }

    // Step 5: Process via labReportProcessor
    await labReportProcessor.processLabReport({
      jobId,
      fileBuffer: buffer,
      mimetype: normalizedMimeType,
      filename: selection.filename,
      fileSize: buffer.length
    });

    // Step 6: Get result from jobManager
    const job = jobManager.getJob(jobId);

    if (job.status === 'failed') {
      logger.error(`[gmailAttachmentIngest] Job ${jobId} failed: ${job.error}`);
      updateStatus(trackingId, 'failed', 0, job.error || 'OCR processing failed');
      return;
    }

    if (job.status !== 'completed' || !job.result?.report_id) {
      logger.error(`[gmailAttachmentIngest] Job ${jobId} in unexpected state: ${job.status}`);
      updateStatus(trackingId, 'failed', 0, 'Unexpected job state');
      return;
    }

    // Step 7: Determine if this was a new insert or update of existing report
    // Use PostgreSQL xmax trick to detect insert vs update
    const wasUpdate = await checkIfReportWasUpdated(job.result.report_id);

    // Step 8: Save Gmail provenance
    updateStatus(trackingId, 'processing', 95, 'Saving provenance...');

    // Fetch email metadata (sender, subject, date) from Gmail
    const emailMetadata = await fetchEmailMetadata(gmail, selection.messageId);

    await saveGmailProvenance({
      reportId: job.result.report_id,
      messageId: selection.messageId,
      attachmentId: selection.attachmentId,
      checksum,
      senderEmail: emailMetadata.from.email,
      senderName: emailMetadata.from.name,
      emailSubject: emailMetadata.subject,
      emailDate: emailMetadata.date
    });

    // Step 9: Mark completed or updated
    if (wasUpdate) {
      logger.info(`[gmailAttachmentIngest] ${selection.filename} updated existing report ${job.result.report_id}`);
      updateStatus(trackingId, 'updated', 100, 'Updated existing report');
    } else {
      logger.info(`[gmailAttachmentIngest] ${selection.filename} created new report ${job.result.report_id}`);
      updateStatus(trackingId, 'completed', 100, 'Successfully ingested');
    }
    tracking.reportId = job.result.report_id;
    tracking.completedAt = Date.now();

  } catch (error) {
    logger.error(`[gmailAttachmentIngest] Attachment ingestion failed: ${selection.filename}`, error);

    // Handle specific errors
    let errorMessage = error.message;
    if (error.code === 401) {
      errorMessage = 'Gmail authentication expired. Please reconnect.';
    } else if (error.code === 429) {
      errorMessage = 'Gmail API rate limit exceeded. Please try again later.';
    }

    updateStatus(trackingId, 'failed', 0, errorMessage);
  }
}

/**
 * Download attachment with retry logic for rate limits
 */
async function downloadAttachmentWithRetry(gmail, messageId, attachmentId, attempt = 1) {
  try {
    // Wrap ONLY the Gmail API call with rate limiter (not the entire ingestion pipeline)
    const response = await SHARED_GMAIL_LIMITER(async () => {
      return await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId,
        id: attachmentId
      });
    });

    // Decode base64url to buffer
    const buffer = Buffer.from(response.data.data, 'base64url');
    return buffer;

  } catch (error) {
    if (error.code === 429 && attempt <= RETRY_CONFIG.maxAttempts) {
      // Exponential backoff: 1s, 2s, 4s
      const delay = RETRY_CONFIG.baseDelay * Math.pow(2, attempt - 1);
      logger.warn(`[gmailAttachmentIngest] Rate limited, retrying in ${delay}ms (attempt ${attempt}/${RETRY_CONFIG.maxAttempts})`);
      await sleep(delay);
      return downloadAttachmentWithRetry(gmail, messageId, attachmentId, attempt + 1);
    }
    throw error;
  }
}

/**
 * Check if this Gmail attachment was already ingested in a previous batch
 */
async function checkGmailProvenanceExists(messageId, attachmentId) {
  const result = await pool.query(`
    SELECT report_id FROM gmail_report_provenance
    WHERE message_id = $1 AND attachment_id = $2
  `, [messageId, attachmentId]);
  return result.rows[0] || null;
}

/**
 * Check if we've already persisted the exact same attachment payload (checksum match)
 */
async function checkChecksumAlreadyProcessed(checksum) {
  const result = await pool.query(`
    SELECT report_id FROM gmail_report_provenance
    WHERE attachment_checksum = $1
    ORDER BY ingested_at DESC
    LIMIT 1
  `, [checksum]);

  return result.rows[0] || null;
}

/**
 * Check if the report was an update (vs new insert) using timestamp comparison
 * If created_at === updated_at, it's a new insert
 * If created_at !== updated_at, it was updated via ON CONFLICT
 */
async function checkIfReportWasUpdated(reportId) {
  const result = await pool.query(`
    SELECT created_at, updated_at
    FROM patient_reports
    WHERE id = $1
  `, [reportId]);

  if (!result.rows[0]) {
    return false; // Report not found, assume new
  }

  const { created_at, updated_at } = result.rows[0];
  // If timestamps differ, it was an update (ON CONFLICT was triggered)
  return created_at.getTime() !== updated_at.getTime();
}

/**
 * Fetch email metadata (sender, subject, date) from Gmail
 */
async function fetchEmailMetadata(gmail, messageId) {
  // Wrap Gmail API call with rate limiter to prevent quota exhaustion
  const response = await SHARED_GMAIL_LIMITER(async () => {
    return await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'metadata',
      metadataHeaders: ['From', 'Subject', 'Date']
    });
  });

  const headers = response.data.payload.headers;
  const from = parseFromHeader(headers.find(h => h.name === 'From')?.value || '');
  const subject = headers.find(h => h.name === 'Subject')?.value || '(No subject)';
  const date = headers.find(h => h.name === 'Date')?.value || null;

  return { from, subject, date: date ? new Date(date) : null };
}

/**
 * Parse "From" header into { name, email }
 */
function parseFromHeader(fromValue) {
  // Example: "John Doe <john@example.com>" or "john@example.com"
  const match = fromValue.match(/^(.*?)\s*<(.+?)>$/) || fromValue.match(/^(.+)$/);
  if (match) {
    if (match[2]) {
      return { name: match[1].trim(), email: match[2].trim() };
    } else {
      return { name: '', email: match[1].trim() };
    }
  }
  return { name: '', email: '' };
}

/**
 * Save Gmail provenance to database
 */
async function saveGmailProvenance(data) {
  await pool.query(`
    INSERT INTO gmail_report_provenance (
      report_id, message_id, attachment_id, sender_email, sender_name,
      email_subject, email_date, attachment_checksum
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (message_id, attachment_id) DO NOTHING
  `, [
    data.reportId,
    data.messageId,
    data.attachmentId,
    data.senderEmail,
    data.senderName,
    data.emailSubject,
    data.emailDate,
    data.checksum
  ]);
}

/**
 * Update attachment status in tracking map
 */
function updateStatus(trackingId, status, progress, progressMessage) {
  const tracking = attachmentJobs.get(trackingId);
  if (tracking) {
    tracking.status = status;
    tracking.progress = progress;
    tracking.progressMessage = progressMessage;
    tracking.error = status === 'failed' ? progressMessage : null;
  }
}

/**
 * Get current status of all attachments in a batch
 */
function getBatchSummary(batchId) {
  const attachments = Array.from(attachmentJobs.values())
    .filter(job => job.batchId === batchId);

  // Terminal states: attachment processing is complete (successfully or not)
  const TERMINAL_STATES = ['completed', 'updated', 'failed', 'duplicate'];

  const completedCount = attachments.filter(a =>
    TERMINAL_STATES.includes(a.status)
  ).length;

  const allComplete = completedCount === attachments.length;

  // Batch succeeded if all attachments are completed or updated (not failed/duplicate only)
  const SUCCESS_STATES = ['completed', 'updated'];
  const batchStatus = allComplete
    ? (attachments.every(a => SUCCESS_STATES.includes(a.status)) ? 'completed' : 'partial_failure')
    : 'processing';

  return {
    attachments: attachments.map(a => ({
      messageId: a.messageId,
      attachmentId: a.attachmentId,
      filename: a.filename,
      status: a.status,
      progress: a.progress,
      progressMessage: a.progressMessage,
      jobId: a.jobId,
      reportId: a.reportId,
      error: a.error
    })),
    batchStatus,
    completedCount,
    totalCount: attachments.length,
    allComplete
  };
}

module.exports = {
  startBatchIngestion,
  getBatchSummary,
  attachmentJobs // Exported for testing/debugging
};
