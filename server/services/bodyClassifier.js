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
const BATCH_SIZE = 25; // Aligned with Step 1 for consistency
const CONCURRENCY = 3; // Process 3 batches in parallel (like Step 1)
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
 * @deprecated Use formatAttachmentsForLLM() instead for structured attachment data
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
 * Format attachments for LLM input (detailed list with index for classification)
 * Uses numeric index instead of full attachmentId to reduce output tokens
 */
function formatAttachmentsForLLM(attachments) {
  if (!attachments || attachments.length === 0) return [];

  return attachments.map((a, index) => {
    const sizeMB = (a.size / 1024 / 1024).toFixed(2);
    return {
      index,  // LLM returns this index instead of long attachmentId
      filename: a.filename,
      mimeType: a.mimeType,
      size_mb: sizeMB,
      is_inline: a.isInline
    };
  });
}

/**
 * Classification schema (includes attachment-level classification)
 * Uses attachmentIndex (integer) instead of attachmentId (string) to reduce output tokens
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
          reason: { type: 'string' },
          attachments: {  // Required by OpenAI strict mode, but can be empty array
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                attachmentIndex: { type: 'integer' },  // Index from input array (0, 1, 2...)
                is_likely_lab_report: { type: 'boolean' },
                confidence: { type: 'number' },
                reason: { type: 'string' }
              },
              required: ['attachmentIndex', 'is_likely_lab_report', 'confidence', 'reason']
            }
          }
        },
        required: ['id', 'is_clinical_results_email', 'confidence', 'reason', 'attachments']
        // NOTE: 'attachments' is required by OpenAI strict mode, but empty array [] is valid
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

  // Format input with body and attachment info (structured attachments for classification)
  const formattedBatch = emailBatch.map(email => ({
    id: email.id,
    subject: email.subject,
    from: email.from,
    date: email.date,
    body_excerpt: email.body.substring(0, 8000), // Ensure limit
    attachments: formatAttachmentsForLLM(email.attachments) // Structured, not summary string
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
      // Log full error details for debugging
      console.log('[bodyClassifier] API Error Details:', JSON.stringify({
        message: error.message,
        status: error.status,
        code: error.code,
        type: error.type,
        error: error.error
      }, null, 2));

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

  // Process batches in parallel (3 concurrent requests like Step 1)
  const limit = pLimit(CONCURRENCY);
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

  // Enrich classifications with attachment filtering (PRD v3.6)
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

    // Map attachment classifications back to attachment objects using index
    const validAttachments = [];
    const rejectedAttachments = [];

    email.attachments.forEach((att, index) => {
      const attClassification = classification.attachments.find(
        a => a.attachmentIndex === index
      );

      if (!attClassification) {
        // No classification for this attachment - default to accept (conservative)
        logger.warn(`[bodyClassifier] No classification for attachment index ${index} (${att.filename}), defaulting to accept`);
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

export {
  classifyEmailBodies
};
