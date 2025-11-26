/**
 * Body Classifier Service
 * Analyzes email body content to identify clinical lab results
 * PRD: docs/PRD_v2_8_Gmail_Integration_Step2.md
 */

import OpenAI from 'openai';
import pino from 'pino';
import pLimit from 'p-limit';
import { loadPrompt } from '../utils/promptLoader.js';

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
    openAiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 120000 // 2 minutes timeout to prevent infinite hangs
    });
  }
  return openAiClient;
}

/**
 * Check if attachments contain OCR-able formats (PDF, images)
 * Checks both MIME type AND file extension (some emails have generic MIME types)
 */
function hasOcrableAttachments(attachments) {
  if (!attachments || attachments.length === 0) return false;

  const ocrableMimeTypes = [
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/heic'
  ];

  const ocrableExtensions = ['pdf', 'png', 'jpg', 'jpeg', 'heic'];

  return attachments.some(a => {
    if (a.isInline) return false; // Skip inline images

    // Check MIME type
    if (ocrableMimeTypes.includes(a.mimeType?.toLowerCase())) {
      return true;
    }

    // Fallback: Check file extension (for generic MIME types like application/octet-stream)
    const ext = a.filename?.split('.').pop()?.toLowerCase();
    return ext && ocrableExtensions.includes(ext);
  });
}

/**
 * Format attachment summary for LLM input (includes all attachments)
 */
function formatAttachmentsSummary(attachments) {
  if (!attachments || attachments.length === 0) return 'None';

  return attachments.map(a => {
    const sizeMB = (a.size / 1024 / 1024).toFixed(2);
    const ext = a.filename.split('.').pop()?.toUpperCase() || '?';
    const inlineFlag = a.isInline ? ' [inline]' : '';
    return `${ext} (${a.filename}, ${sizeMB}MB)${inlineFlag}`;
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
 * Classify emails with body content (no pre-filtering)
 * @param {Array} emails - Array of email objects with body content
 * @param {Function} onProgress - Optional callback for progress updates (completed, total)
 */
async function classifyEmailBodies(emails, onProgress = null) {
  if (!Array.isArray(emails) || emails.length === 0) {
    logger.info('[bodyClassifier] No emails to classify');
    return [];
  }

  logger.info(`[bodyClassifier] Starting classification of ${emails.length} emails with body content`);

  const systemPrompt = loadPrompt(PROMPT_FILE);

  // Filter out empty bodies (deterministic rejection)
  const emailsWithBodies = emails.filter(email => {
    return email.body && email.body.trim().length > 0;
  });

  // Handle emails with no body:
  // - If they have OCR-able attachments: ACCEPT (inherit Step-1 confidence)
  // - Otherwise: REJECT (can't process)
  const emptyBodyEmails = emails.filter(email => !email.body || email.body.trim().length === 0);

  const emptyBodyAcceptances = emptyBodyEmails
    .filter(email => hasOcrableAttachments(email.attachments))
    .map(email => ({
      id: email.id,
      is_clinical_results_email: true,
      confidence: 0.75, // Moderate confidence - based on Step-1 + OCR-able attachments
      reason: 'No body text, but has OCR-able attachments (PDF/image)'
    }));

  const emptyBodyRejections = emptyBodyEmails
    .filter(email => !hasOcrableAttachments(email.attachments))
    .map(email => ({
      id: email.id,
      is_clinical_results_email: false,
      confidence: 0,
      reason: 'No body content and no OCR-able attachments'
    }));

  logger.info(
    `[bodyClassifier] ${emptyBodyRejections.length} emails rejected (no body, no OCR-able attachments), ` +
    `${emptyBodyAcceptances.length} accepted (no body but has OCR-able attachments), ` +
    `${emailsWithBodies.length} ready for LLM`
  );

  if (emailsWithBodies.length === 0) {
    logger.info('[bodyClassifier] No emails with body content to classify');
    return [...emptyBodyAcceptances, ...emptyBodyRejections];
  }

  // Split into batches (only emails with bodies)
  const batches = [];
  for (let i = 0; i < emailsWithBodies.length; i += BATCH_SIZE) {
    batches.push(emailsWithBodies.slice(i, i + BATCH_SIZE));
  }

  logger.info(`[bodyClassifier] Processing ${batches.length} batches of up to ${BATCH_SIZE} emails each`);

  // Process batches sequentially (graceful degradation: failed batches return "uncertain" classifications)
  const limit = pLimit(1);
  let completedBatches = 0;

  const batchResults = await Promise.all(
    batches.map((batch, index) =>
      limit(async () => {
        logger.info(`[bodyClassifier] Processing batch ${index + 1}/${batches.length}`);
        const result = await classifyBatch(batch, systemPrompt);

        completedBatches++;
        if (onProgress) {
          onProgress(completedBatches, batches.length);
        }

        return result;
      })
    )
  );

  // Merge LLM classifications with deterministic empty-body results (acceptances + rejections)
  const llmClassifications = batchResults.flat();
  const allClassifications = [...llmClassifications, ...emptyBodyAcceptances, ...emptyBodyRejections];

  logger.info(
    `[bodyClassifier] Classification complete: ${llmClassifications.length} LLM-classified, ` +
    `${emptyBodyAcceptances.length} accepted (no body + OCR-able attachments), ` +
    `${emptyBodyRejections.length} rejected (no body), ${allClassifications.length} total`
  );

  return allClassifications;
}

export {
  classifyEmailBodies
};
