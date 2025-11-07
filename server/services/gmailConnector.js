/**
 * Gmail Connector Service
 * Handles OAuth authentication and email metadata retrieval for Gmail Integration
 * PRD: docs/PRD_v2_8_Gmail_Integration_Step1.md
 */

const { google } = require('googleapis');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const pino = require('pino');
const pLimit = require('p-limit');

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

// Configuration
const GMAIL_MAX_EMAILS = parseInt(process.env.GMAIL_MAX_EMAILS) || 200;
const GMAIL_CONCURRENCY_LIMIT = parseInt(process.env.GMAIL_CONCURRENCY_LIMIT) || 20;
const GMAIL_TOKEN_PATH = process.env.GMAIL_TOKEN_PATH || path.join(__dirname, '../config/gmail-token.json');
const OAUTH_REDIRECT_URI = process.env.GMAIL_OAUTH_REDIRECT_URI || 'http://localhost:3000/api/dev-gmail/oauth-callback';

// Log loaded configuration on module load
logger.info(`[gmailConnector] Loaded GMAIL_MAX_EMAILS=${GMAIL_MAX_EMAILS} from ${process.env.GMAIL_MAX_EMAILS ? 'env' : 'default'}`);

// OAuth state tokens (in-memory, expire after 10 minutes)
const oauthStates = new Map();
const STATE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

// OAuth2 client
let oauth2Client = null;
let tokenListenerRegistered = false;

/**
 * Initialize OAuth2 client
 */
function initOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in environment variables');
  }

  oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    OAUTH_REDIRECT_URI
  );

  return oauth2Client;
}

/**
 * Register token refresh listener to preserve refresh_token
 */
function registerTokenRefreshListener() {
  if (tokenListenerRegistered) return;

  if (!oauth2Client) {
    initOAuth2Client();
  }

  oauth2Client.on('tokens', async (newTokens) => {
    try {
      logger.info('[gmailConnector] Tokens refreshed, saving to file');

      // Load existing tokens to preserve refresh_token
      const existingData = await fs.readFile(GMAIL_TOKEN_PATH, 'utf8');
      const existingTokens = JSON.parse(existingData);

      // Merge tokens, preserving refresh_token if not included in new tokens
      const mergedTokens = {
        ...existingTokens,
        ...newTokens,
        refresh_token: newTokens.refresh_token || existingTokens.refresh_token
      };

      if (!mergedTokens.refresh_token) {
        logger.error('[gmailConnector] refresh_token missing - skipping save');
        return;
      }

      // Ensure directory exists
      await fs.mkdir(path.dirname(GMAIL_TOKEN_PATH), { recursive: true });
      await fs.writeFile(GMAIL_TOKEN_PATH, JSON.stringify(mergedTokens, null, 2));

      logger.info('[gmailConnector] Tokens saved successfully');
    } catch (error) {
      logger.error('[gmailConnector] Failed to save refreshed tokens:', error.message);
    }
  });

  tokenListenerRegistered = true;
  logger.info('[gmailConnector] Token refresh listener registered');
}

/**
 * Generate OAuth authorization URL with CSRF protection
 * @returns {Promise<string>} Authorization URL
 */
async function getAuthUrl() {
  if (!oauth2Client) {
    initOAuth2Client();
  }

  // Generate cryptographically random state token
  const state = crypto.randomBytes(32).toString('hex');

  // Store state with timestamp
  oauthStates.set(state, Date.now());

  // Clean up expired states
  cleanupExpiredStates();

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/gmail.readonly'],
    state,
    prompt: 'consent' // Force consent to ensure refresh_token is returned
  });

  logger.info('[gmailConnector] Generated auth URL with state token');
  return authUrl;
}

/**
 * Clean up expired OAuth state tokens
 */
function cleanupExpiredStates() {
  const now = Date.now();
  let cleaned = 0;

  for (const [state, timestamp] of oauthStates.entries()) {
    if (now - timestamp > STATE_EXPIRY_MS) {
      oauthStates.delete(state);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logger.info(`[gmailConnector] Cleaned up ${cleaned} expired state tokens`);
  }
}

/**
 * Handle OAuth callback
 * @param {string} code - Authorization code from Google
 * @param {string} state - CSRF state token
 * @returns {Promise<void>}
 * @throws {Error} If state is invalid or token exchange fails
 */
async function handleOAuthCallback(code, state) {
  if (!oauth2Client) {
    initOAuth2Client();
  }

  // Validate state token
  if (!state || !oauthStates.has(state)) {
    logger.error('[gmailConnector] Invalid or expired state token');
    throw new Error('Invalid or expired state token');
  }

  // Delete state token (one-time use)
  oauthStates.delete(state);
  cleanupExpiredStates();

  try {
    // Exchange authorization code for tokens
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
      logger.warn('[gmailConnector] No refresh_token received - user may need to revoke and re-authorize');
    }

    // Set credentials
    oauth2Client.setCredentials(tokens);

    // Save tokens to file
    await fs.mkdir(path.dirname(GMAIL_TOKEN_PATH), { recursive: true });
    await fs.writeFile(GMAIL_TOKEN_PATH, JSON.stringify(tokens, null, 2));

    // Register token refresh listener
    registerTokenRefreshListener();

    logger.info('[gmailConnector] OAuth callback handled successfully, tokens saved');
  } catch (error) {
    logger.error('[gmailConnector] Failed to exchange authorization code:', error.message);
    throw new Error('Failed to exchange authorization code for tokens');
  }
}

/**
 * Load credentials from file
 * @returns {Promise<boolean>} True if credentials loaded successfully
 */
async function loadCredentials() {
  if (!oauth2Client) {
    initOAuth2Client();
  }

  try {
    const tokenData = await fs.readFile(GMAIL_TOKEN_PATH, 'utf8');
    const tokens = JSON.parse(tokenData);

    oauth2Client.setCredentials(tokens);
    registerTokenRefreshListener();

    logger.info('[gmailConnector] Credentials loaded from file');
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      logger.info('[gmailConnector] No stored credentials found');
    } else {
      logger.error('[gmailConnector] Failed to load credentials:', error.message);
    }
    return false;
  }
}

/**
 * Check if user is authenticated
 * @returns {Promise<boolean>} True if authenticated with valid tokens
 */
async function isAuthenticated() {
  try {
    await loadCredentials();

    if (!oauth2Client || !oauth2Client.credentials) {
      return false;
    }

    // Check if we have required tokens
    const { access_token, refresh_token } = oauth2Client.credentials;

    if (!access_token && !refresh_token) {
      return false;
    }

    return true;
  } catch (error) {
    logger.error('[gmailConnector] Authentication check failed:', error.message);
    return false;
  }
}

/**
 * Get authenticated OAuth2 client
 * @returns {Promise<Object>} OAuth2 client with user info
 */
async function getOAuth2Client() {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    return { connected: false };
  }

  try {
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const profile = await gmail.users.getProfile({ userId: 'me' });

    return {
      connected: true,
      email: profile.data.emailAddress
    };
  } catch (error) {
    logger.error('[gmailConnector] Failed to get user profile:', error.message);
    return { connected: false };
  }
}

/**
 * MIME header decoder
 * Decodes Base64 and Quoted-Printable encoded headers
 * @param {string} value - Header value to decode
 * @returns {string} Decoded header value
 */
function decodeMimeHeader(value) {
  if (!value) return '';

  const mimePattern = /=\?([^?]+)\?([BQ])\?([^?]+)\?=/gi;

  return value.replace(mimePattern, (match, charset, encoding, text) => {
    try {
      if (encoding.toUpperCase() === 'B') {
        // Base64 decoding
        return Buffer.from(text, 'base64').toString('utf8');
      } else if (encoding.toUpperCase() === 'Q') {
        // Quoted-Printable decoding
        return text
          .replace(/_/g, ' ')
          .replace(/=([0-9A-F]{2})/gi, (_, hex) =>
            String.fromCharCode(parseInt(hex, 16))
          );
      }
    } catch (err) {
      logger.warn('[gmailConnector] MIME decode failed for text:', text.substring(0, 20));
    }
    return match;
  });
}

/**
 * Fetch email metadata from Gmail
 * @returns {Promise<Array>} Array of email metadata objects
 */
async function fetchEmailMetadata() {
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

    logger.info(`[gmailConnector] Found ${messages.length} emails, fetching metadata`);

    // Step 2: Fetch metadata in parallel (20 concurrent requests)
    const limit = pLimit(GMAIL_CONCURRENCY_LIMIT);

    const metadataPromises = messages.map(({ id }) =>
      limit(async () => {
        try {
          const response = await gmail.users.messages.get({
            userId: 'me',
            id,
            format: 'metadata',
            metadataHeaders: ['Subject', 'From', 'Date']
          });

          const headers = response.data.payload.headers || [];

          // Extract headers
          const subject = headers.find(h => h.name === 'Subject')?.value || '';
          const from = headers.find(h => h.name === 'From')?.value || '';
          const date = headers.find(h => h.name === 'Date')?.value || '';

          return {
            id,
            subject: decodeMimeHeader(subject),
            from: decodeMimeHeader(from),
            date
          };
        } catch (error) {
          logger.error(`[gmailConnector] Failed to fetch metadata for message ${id}:`, error.message);
          return {
            id,
            subject: '[Error fetching]',
            from: '[Error fetching]',
            date: ''
          };
        }
      })
    );

    const emailMetadata = await Promise.all(metadataPromises);

    logger.info(`[gmailConnector] Successfully fetched metadata for ${emailMetadata.length} emails`);

    return emailMetadata;
  } catch (error) {
    logger.error('[gmailConnector] Failed to fetch email metadata:', error.message);
    throw error;
  }
}

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

/**
 * Fetch full email content for specific email IDs only
 * @param {Array<string>} emailIds - Array of Gmail message IDs
 * @returns {Promise<Array>} Array of email objects with full content
 */
async function fetchFullEmailsByIds(emailIds) {
  const authenticated = await isAuthenticated();
  if (!authenticated) {
    throw new Error('Not authenticated with Gmail');
  }

  if (!Array.isArray(emailIds) || emailIds.length === 0) {
    logger.info('[gmailConnector] No email IDs provided');
    return [];
  }

  try {
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    logger.info(`[gmailConnector] Fetching full content for ${emailIds.length} emails`);

    // Fetch full messages in parallel
    const limit = pLimit(GMAIL_CONCURRENCY_LIMIT);

    const emailPromises = emailIds.map(id =>
      limit(async () => {
        try {
          const response = await gmail.users.messages.get({
            userId: 'me',
            id,
            format: 'full'
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
          // Check for Gmail API rate limit (429) - fail job immediately
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
    logger.error('[gmailConnector] Failed to fetch full emails by IDs:', error.message);
    throw error;
  }
}

/**
 * Get authenticated Gmail API client for direct use
 * Must be called after isAuthenticated() to ensure tokens are loaded
 * @returns {Promise<gmail_v1.Gmail>} Authenticated Gmail API client
 * @throws {Error} If not authenticated
 */
async function getAuthenticatedGmailClient() {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    throw new Error('Gmail not authenticated. Call isAuthenticated() first.');
  }

  if (!oauth2Client) {
    throw new Error('OAuth client not initialized');
  }

  // Uses existing top-level `google` import (line 7 of gmailConnector.js)
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  return gmail;
}

// Initialize OAuth client on module load
try {
  initOAuth2Client();
} catch (error) {
  logger.warn('[gmailConnector] Failed to initialize OAuth client:', error.message);
}

module.exports = {
  getAuthUrl,
  handleOAuthCallback,
  loadCredentials,
  isAuthenticated,
  getOAuth2Client,
  fetchEmailMetadata,
  fetchFullEmailsByIds,
  getAuthenticatedGmailClient
};
