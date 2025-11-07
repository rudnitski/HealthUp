/**
 * Gmail Dev Routes
 * Developer-only endpoints for Gmail integration testing
 * PRD: docs/PRD_v2_8_Gmail_Integration_Step1.md
 */

const express = require('express');
const pino = require('pino');
const { createJob, getJobStatus, updateJob, setJobResult, setJobError, JobStatus, getJob } = require('../utils/jobManager');
const {
  getAuthUrl,
  handleOAuthCallback,
  isAuthenticated,
  getOAuth2Client,
  fetchEmailMetadata,
  fetchFullEmailsByIds
} = require('../services/gmailConnector');
const { classifyEmails } = require('../services/emailClassifier');
const { classifyEmailBodies } = require('../services/bodyClassifier');
const gmailAttachmentIngest = require('../services/gmailAttachmentIngest');

const router = express.Router();

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

/**
 * Feature flag guard middleware
 * Blocks access if Gmail integration is disabled or in production
 */
function featureFlagGuard(req, res, next) {
  const enabled = process.env.GMAIL_INTEGRATION_ENABLED === 'true';
  const isProduction = NODE_ENV === 'production';

  if (!enabled || isProduction) {
    logger.warn('[gmailDev] Access blocked - feature disabled or production environment');
    return res.status(403).json({
      error: 'Gmail integration is not available',
      message: 'This feature is only available in development mode when GMAIL_INTEGRATION_ENABLED=true'
    });
  }

  next();
}

// Apply feature flag guard to all routes
router.use(featureFlagGuard);

/**
 * GET /api/dev-gmail/status
 * Check Gmail authentication status
 */
router.get('/status', async (req, res) => {
  try {
    logger.info('[gmailDev] Status check requested');

    const clientStatus = await getOAuth2Client();

    return res.status(200).json(clientStatus);
  } catch (error) {
    logger.error('[gmailDev] Failed to check status:', error.message);
    return res.status(500).json({
      connected: false,
      error: 'Failed to check authentication status'
    });
  }
});

/**
 * GET /api/dev-gmail/auth-url
 * Generate OAuth authorization URL
 */
router.get('/auth-url', async (req, res) => {
  try {
    logger.info('[gmailDev] Auth URL requested');

    const authUrl = await getAuthUrl();

    return res.status(200).json({ auth_url: authUrl });
  } catch (error) {
    logger.error('[gmailDev] Failed to generate auth URL:', error.message);
    return res.status(500).json({
      error: 'Failed to generate authorization URL',
      message: error.message
    });
  }
});

/**
 * GET /api/dev-gmail/oauth-callback
 * Handle OAuth callback from Google
 */
router.get('/oauth-callback', async (req, res) => {
  const { code, state, error } = req.query;

  logger.info('[gmailDev] OAuth callback received');

  // Check for OAuth errors
  if (error) {
    logger.error('[gmailDev] OAuth error:', error);
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Gmail Authentication Failed</title>
          <style>
            body { font-family: system-ui, -apple-system, sans-serif; padding: 40px; text-align: center; }
            .error { color: #dc2626; font-size: 18px; margin: 20px 0; }
            button { padding: 10px 20px; font-size: 14px; cursor: pointer; }
          </style>
        </head>
        <body>
          <h1>Authentication Failed</h1>
          <div class="error">Error: ${error}</div>
          <button onclick="window.close()">Close Window</button>
        </body>
      </html>
    `);
  }

  // Validate required parameters
  if (!code || !state) {
    logger.error('[gmailDev] Missing code or state parameter');
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Gmail Authentication Failed</title>
          <style>
            body { font-family: system-ui, -apple-system, sans-serif; padding: 40px; text-align: center; }
            .error { color: #dc2626; font-size: 18px; margin: 20px 0; }
            button { padding: 10px 20px; font-size: 14px; cursor: pointer; }
          </style>
        </head>
        <body>
          <h1>Authentication Failed</h1>
          <div class="error">Missing required parameters</div>
          <button onclick="window.close()">Close Window</button>
        </body>
      </html>
    `);
  }

  try {
    // Handle OAuth callback
    await handleOAuthCallback(code, state);

    logger.info('[gmailDev] OAuth callback handled successfully');

    // Return success page that closes the window
    return res.status(200).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Gmail Connected</title>
          <style>
            body { font-family: system-ui, -apple-system, sans-serif; padding: 40px; text-align: center; }
            .success { color: #16a34a; font-size: 24px; margin: 20px 0; }
            .message { color: #666; font-size: 16px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="success">✓ Gmail Connected Successfully</div>
          <div class="message">This window will close automatically...</div>
          <script>
            // Notify parent window
            if (window.opener) {
              window.opener.postMessage({ type: 'gmail-auth-success' }, '*');
            }
            // Close window after 2 seconds
            setTimeout(() => window.close(), 2000);
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    logger.error('[gmailDev] OAuth callback failed:', error.message);

    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Gmail Authentication Failed</title>
          <style>
            body { font-family: system-ui, -apple-system, sans-serif; padding: 40px; text-align: center; }
            .error { color: #dc2626; font-size: 18px; margin: 20px 0; }
            button { padding: 10px 20px; font-size: 14px; cursor: pointer; }
          </style>
        </head>
        <body>
          <h1>Authentication Failed</h1>
          <div class="error">${error.message}</div>
          <button onclick="window.close()">Close Window</button>
        </body>
      </html>
    `);
  }
});

/**
 * POST /api/dev-gmail/fetch
 * Create job to fetch and classify emails (Step-1 → Step-2 sequential)
 */
router.post('/fetch', async (req, res) => {
  try {
    logger.info('[gmailDev] Fetch request received (Step-1 → Step-2 sequential)');

    const authenticated = await isAuthenticated();

    if (!authenticated) {
      logger.warn('[gmailDev] Fetch failed - not authenticated');
      return res.status(401).json({
        error: 'Gmail authentication required',
        message: 'Please connect your Gmail account first'
      });
    }

    const jobId = createJob('dev-gmail-step1-step2', {
      emailCount: parseInt(process.env.GMAIL_MAX_EMAILS) || 200
    });

    logger.info(`[gmailDev] Job created: ${jobId}`);

    setImmediate(async () => {
      try {
        updateJob(jobId, JobStatus.PROCESSING);

        // ===== STEP 1: Metadata Classification =====
        logger.info(`[gmailDev:${jobId}] [Step-1] Starting metadata classification`);

        // Fetch metadata only (subject, sender, date)
        const metadataEmails = await fetchEmailMetadata();

        if (metadataEmails.length === 0) {
          logger.info(`[gmailDev:${jobId}] No emails found, completing with empty results`);
          const threshold = parseFloat(process.env.GMAIL_BODY_ACCEPT_THRESHOLD) || 0.70;
          setJobResult(jobId, {
            results: [],
            stats: {
              step1_total_fetched: 0,
              step1_candidates: 0,
              step2_fetched_full: 0,
              step2_classified: 0,
              step2_errors: 0,
              final_results: 0
            },
            threshold
          });
          return;
        }

        logger.info(`[gmailDev:${jobId}] [Step-1] Fetched ${metadataEmails.length} emails metadata`);

        // Classify with Step-1 LLM (subject/sender heuristics) with progress updates
        const step1Classifications = await classifyEmails(metadataEmails, (completed, total) => {
          const progress = Math.floor((completed / total) * 50); // Step-1 is 0-50%
          updateJob(jobId, JobStatus.PROCESSING, {
            progress,
            progressMessage: `Step-1: Classifying batch ${completed}/${total}`
          });
        });

        // Filter to candidates (is_lab_likely: true)
        const candidates = metadataEmails.filter(email => {
          const classification = step1Classifications.find(c => c.id === email.id);
          return classification?.is_lab_likely === true;
        });

        logger.info(`[gmailDev:${jobId}] [Step-1] Found ${candidates.length} candidates (${((candidates.length/metadataEmails.length)*100).toFixed(0)}%)`);

        if (candidates.length === 0) {
          logger.info(`[gmailDev:${jobId}] No candidates found, completing with empty results`);
          const threshold = parseFloat(process.env.GMAIL_BODY_ACCEPT_THRESHOLD) || 0.70;
          setJobResult(jobId, {
            results: [],
            stats: {
              step1_total_fetched: metadataEmails.length,
              step1_candidates: 0,
              step2_fetched_full: 0,
              step2_classified: 0,
              step2_errors: 0,
              final_results: 0
            },
            threshold
          });
          return;
        }

        // ===== STEP 2: Body Refinement =====
        logger.info(`[gmailDev:${jobId}] [Step-2] Fetching full content for ${candidates.length} candidates`);

        // Fetch full body + attachments for ONLY candidates
        const candidateIds = candidates.map(c => c.id);
        const fullEmails = await fetchFullEmailsByIds(candidateIds);

        logger.info(`[gmailDev:${jobId}] [Step-2] Successfully fetched ${fullEmails.length} full emails`);

        // Classify with Step-2 LLM (body + attachments content) with progress updates
        updateJob(jobId, JobStatus.PROCESSING, {
          progress: 50,
          progressMessage: `Step-2: Fetched ${fullEmails.length} full emails, starting classification`
        });

        logger.info(`[gmailDev:${jobId}] [Step-2] Classifying ${fullEmails.length} emails with body content`);
        const step2Classifications = await classifyEmailBodies(fullEmails, (completed, total) => {
          const progress = 50 + Math.floor((completed / total) * 40); // Step-2 is 50-90%
          updateJob(jobId, JobStatus.PROCESSING, {
            progress,
            progressMessage: `Step-2: Analyzing email bodies ${completed}/${total}`
          });
        });

        logger.info(`[gmailDev:${jobId}] [Step-2] Classification complete, filtering by confidence threshold`);

        // Apply confidence threshold
        const threshold = parseFloat(process.env.GMAIL_BODY_ACCEPT_THRESHOLD) || 0.70;

        // Prepare Step-1 candidates for debugging (with Step-1 reasons)
        const step1CandidatesDebug = candidates.map(email => {
          const step1Classification = step1Classifications.find(c => c.id === email.id);
          return {
            id: email.id,
            subject: email.subject,
            from: email.from,
            date: email.date,
            step1_confidence: step1Classification?.confidence || 0,
            step1_reason: step1Classification?.reason || 'Unknown'
          };
        });

        // Prepare ALL Step-2 results (accepted + rejected) for debugging
        const step2AllResults = fullEmails.map(email => {
          const classification = step2Classifications.find(c => c.id === email.id);

          // Acceptance criteria: clinical results + confidence >= threshold
          const isAccepted =
            classification?.is_clinical_results_email === true &&
            classification?.confidence != null &&
            classification.confidence >= threshold;

          return {
            id: email.id,
            subject: email.subject,
            from: email.from,
            date: email.date,
            body_excerpt: email.body.substring(0, 200),
            attachments: email.attachments.map(a => ({
              filename: a.filename,
              mimeType: a.mimeType,
              size: a.size,
              attachmentId: a.attachmentId,
              isInline: a.isInline
            })),
            step2_is_clinical: classification?.is_clinical_results_email || false,
            step2_confidence: classification?.confidence || 0,
            step2_reason: classification?.reason || 'Unknown',
            accepted: isAccepted
          };
        });

        // Extract only accepted emails for final results
        const results = step2AllResults.filter(item => item.accepted);

        // Detect duplicates by attachment filename + size
        const attachmentMap = new Map(); // key: "filename:size", value: [email_ids]
        const duplicateInfo = new Map(); // key: email_id, value: {is_duplicate, duplicate_group_id, group_size}

        results.forEach(email => {
          if (email.attachments && email.attachments.length > 0) {
            email.attachments.forEach(att => {
              const key = `${att.filename}:${att.size}`;
              if (!attachmentMap.has(key)) {
                attachmentMap.set(key, []);
              }
              attachmentMap.get(key).push(email.id);
            });
          }
        });

        // Mark duplicates (first occurrence is NOT a duplicate, subsequent ones ARE)
        attachmentMap.forEach((emailIds, key) => {
          if (emailIds.length > 1) {
            // Multiple emails with same attachment
            emailIds.forEach((emailId, index) => {
              duplicateInfo.set(emailId, {
                is_duplicate: index > 0, // First one is NOT duplicate
                duplicate_group_id: key,
                duplicate_group_size: emailIds.length
              });
            });
          }
        });

        // Add duplicate flags to results
        const resultsWithDuplicates = results.map(email => {
          const dupInfo = duplicateInfo.get(email.id);
          return {
            ...email,
            is_duplicate: dupInfo?.is_duplicate || false,
            duplicate_group_id: dupInfo?.duplicate_group_id || null,
            duplicate_group_size: dupInfo?.duplicate_group_size || 1
          };
        });

        // Count classification errors
        const classificationErrors = step2Classifications.filter(c =>
          c.confidence === 0 && c.reason?.includes('Classification failed')
        ).length;

        // Count empty body rejections
        const emptyBodyRejections = step2Classifications.filter(c =>
          c.reason === 'No body content'
        ).length;

        // step2_classified = emails SENT to LLM (excludes empty bodies)
        const step2Classified = step2Classifications.length - emptyBodyRejections;

        const stats = {
          step1_total_fetched: metadataEmails.length,
          step1_candidates: candidates.length,
          step2_fetched_full: fullEmails.length,
          step2_classified: step2Classified,
          step2_errors: classificationErrors,
          final_results: resultsWithDuplicates.length
        };

        const acceptanceRate = candidates.length > 0 ? ((resultsWithDuplicates.length / candidates.length) * 100).toFixed(0) : 0;

        logger.info(
          `[gmailDev:${jobId}] Job completed: ${stats.final_results} lab result emails found (${acceptanceRate}% of candidates)` +
          (stats.step2_errors > 0 ? ` (${stats.step2_errors} classification errors)` : '')
        );

        setJobResult(jobId, {
          results: resultsWithDuplicates,
          stats,
          threshold,
          debug: {
            step1_candidates: step1CandidatesDebug,
            step2_all_results: step2AllResults
          }
        });
      } catch (error) {
        logger.error(`[gmailDev:${jobId}] Job failed:`, error.message);
        setJobError(jobId, error);
      }
    });

    return res.status(202).json({
      job_id: jobId,
      status: 'pending',
      message: 'Email fetch and classification started (Step-1 → Step-2). Poll /api/dev-gmail/jobs/:jobId for status.'
    });
  } catch (error) {
    logger.error('[gmailDev] Failed to create fetch job:', error.message);
    return res.status(500).json({
      error: 'Failed to create fetch job',
      message: error.message
    });
  }
});

/**
 * GET /api/dev-gmail/jobs/summary
 * Get batch progress for Step 3 attachment ingestion
 * NOTE: This route must come BEFORE /jobs/:jobId to avoid matching "summary" as a jobId
 */
router.get('/jobs/summary', async (req, res) => {
  try {
    const { batchId } = req.query;

    if (!batchId) {
      return res.status(400).json({
        success: false,
        error: 'batchId is required'
      });
    }

    logger.info(`[gmailDev] Batch summary requested: ${batchId}`);

    const summary = gmailAttachmentIngest.getBatchSummary(batchId);

    // Also update progress from jobManager for attachments currently being processed
    for (const attachment of summary.attachments) {
      if (attachment.jobId && attachment.status === 'processing') {
        const job = getJob(attachment.jobId);
        if (job) {
          attachment.progress = job.progress || attachment.progress;
          attachment.progressMessage = job.progressMessage || attachment.progressMessage;
        }
      }
    }

    res.json(summary);

  } catch (error) {
    logger.error('[gmailDev] Failed to get job summary:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get job summary'
    });
  }
});

/**
 * GET /api/dev-gmail/jobs/:jobId
 * Get job status and results
 */
router.get('/jobs/:jobId', (req, res) => {
  const { jobId } = req.params;

  logger.info(`[gmailDev] Job status requested: ${jobId}`);

  const jobStatus = getJobStatus(jobId);

  if (!jobStatus) {
    logger.warn(`[gmailDev] Job not found: ${jobId}`);
    return res.status(404).json({ error: 'Job not found' });
  }

  return res.status(200).json(jobStatus);
});

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
    if (filenameLower.endsWith('.tif') || filenameLower.endsWith('.tiff')) return true;
  }

  return false;
}

/**
 * POST /api/dev-gmail/ingest
 * Start batch ingestion of selected attachments (Step 3)
 */
router.post('/ingest', async (req, res) => {
  if (!process.env.GMAIL_ATTACHMENT_INGEST_ENABLED) {
    return res.status(403).json({
      success: false,
      error: 'Attachment ingestion is not enabled'
    });
  }

  try {
    logger.info('[gmailDev] Attachment ingestion requested');

    // Check authentication status
    const authenticated = await isAuthenticated();
    if (!authenticated) {
      logger.warn('[gmailDev] Ingest failed - not authenticated');
      return res.status(401).json({
        success: false,
        error: 'Gmail authentication required'
      });
    }

    const { selections } = req.body;

    if (!Array.isArray(selections) || selections.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No attachments selected'
      });
    }

    // Validate batch size limit
    const maxBatchSize = parseInt(process.env.GMAIL_BATCH_MAX_ATTACHMENTS || '20');
    if (selections.length > maxBatchSize) {
      return res.status(400).json({
        success: false,
        error: `Batch size exceeds limit of ${maxBatchSize} attachments`
      });
    }

    // Get allowed MIME types from env
    const allowedMimes = (process.env.GMAIL_ALLOWED_MIME || 'application/pdf,image/png,image/jpeg,image/tiff').split(',');

    // Validate each selection
    for (const sel of selections) {
      if (!sel.messageId || !sel.attachmentId || !sel.filename || !sel.mimeType) {
        return res.status(400).json({
          success: false,
          error: 'Invalid attachment data'
        });
      }

      // Validate MIME type or file extension
      if (!isValidAttachment(sel.filename, sel.mimeType, allowedMimes)) {
        return res.status(400).json({
          success: false,
          error: `Unsupported file type: ${sel.mimeType} (${sel.filename})`
        });
      }

      // Validate size
      const maxBytes = parseInt(process.env.GMAIL_MAX_ATTACHMENT_MB || '15') * 1024 * 1024;
      if (sel.size > maxBytes) {
        return res.status(400).json({
          success: false,
          error: `File too large: ${sel.filename} (${Math.round(sel.size / 1024 / 1024)}MB)`
        });
      }
    }

    // Start batch ingestion
    const result = await gmailAttachmentIngest.startBatchIngestion(selections);

    logger.info(`[gmailDev] Batch ingestion started: ${result.batchId} (${result.count} attachments)`);

    res.json({
      success: true,
      batchId: result.batchId,
      count: result.count,
      message: `Started ingestion of ${result.count} attachment${result.count > 1 ? 's' : ''}`
    });

  } catch (error) {
    logger.error('[gmailDev] Failed to start attachment ingestion:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to start ingestion'
    });
  }
});

module.exports = router;
