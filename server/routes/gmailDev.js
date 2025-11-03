/**
 * Gmail Dev Routes
 * Developer-only endpoints for Gmail integration testing
 * PRD: docs/PRD_v2_8_Gmail_Integration_Step1.md
 */

const express = require('express');
const pino = require('pino');
const { createJob, getJobStatus, updateJob, setJobResult, setJobError, JobStatus } = require('../utils/jobManager');
const {
  getAuthUrl,
  handleOAuthCallback,
  isAuthenticated,
  getOAuth2Client,
  fetchEmailMetadata
} = require('../services/gmailConnector');
const { classifyEmails } = require('../services/emailClassifier');

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
 * Create job to fetch and classify emails
 */
router.post('/fetch', async (req, res) => {
  try {
    logger.info('[gmailDev] Fetch request received');

    // Check authentication first
    const authenticated = await isAuthenticated();

    if (!authenticated) {
      logger.warn('[gmailDev] Fetch failed - not authenticated');
      return res.status(401).json({
        error: 'Gmail authentication required',
        message: 'Please connect your Gmail account first'
      });
    }

    // Create job
    const jobId = createJob('dev-gmail', {
      emailCount: parseInt(process.env.GMAIL_MAX_EMAILS) || 200
    });

    logger.info(`[gmailDev] Job created: ${jobId}`);

    // Start background processing
    setImmediate(async () => {
      try {
        logger.info(`[gmailDev:${jobId}] Starting background processing`);

        // Update job to processing
        updateJob(jobId, JobStatus.PROCESSING);

        // Fetch email metadata
        const emails = await fetchEmailMetadata();

        if (emails.length === 0) {
          logger.info(`[gmailDev:${jobId}] No emails found, completing with empty results`);
          setJobResult(jobId, { results: [] });
          return;
        }

        logger.info(`[gmailDev:${jobId}] Fetched ${emails.length} emails, starting classification`);

        // Classify emails
        const classifications = await classifyEmails(emails);

        logger.info(`[gmailDev:${jobId}] Classification complete, merging results`);

        // Merge emails with classifications
        const results = emails.map(email => {
          const classification = classifications.find(c => c.id === email.id);
          return {
            ...email,
            is_lab_likely: classification?.is_lab_likely || false,
            confidence: classification?.confidence || 0,
            reason: classification?.reason || 'Classification unavailable'
          };
        });

        logger.info(`[gmailDev:${jobId}] Job completed successfully with ${results.length} results`);

        setJobResult(jobId, { results });
      } catch (error) {
        logger.error(`[gmailDev:${jobId}] Job failed:`, error.message);
        setJobError(jobId, error);
      }
    });

    // Return job ID immediately
    return res.status(202).json({
      job_id: jobId,
      status: 'pending',
      message: 'Email fetch and classification started. Poll /api/dev-gmail/jobs/:jobId for status.'
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

module.exports = router;
