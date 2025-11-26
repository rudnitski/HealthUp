/**
 * Email Classifier Service
 * Uses OpenAI to classify emails as likely/unlikely to contain lab test results
 * PRD: docs/PRD_v2_8_Gmail_Integration_Step1.md
 */

import OpenAI from 'openai';
import pino from 'pino';
import pLimit from 'p-limit';
import { loadPrompt } from '../utils/promptLoader.js';

const NODE_ENV = process.env.NODE_ENV || 'development';
const MAX_RETRIES = parseInt(process.env.EMAIL_CLASSIFIER_MAX_RETRIES, 10) || 3;
const RETRY_DELAY_MS = parseInt(process.env.EMAIL_CLASSIFIER_RETRY_DELAY_MS, 10) || 1000;

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
const DEFAULT_MODEL = process.env.EMAIL_CLASSIFIER_MODEL || process.env.SQL_GENERATOR_MODEL || 'gpt-5-mini';
const BATCH_SIZE = parseInt(process.env.EMAIL_CLASSIFIER_BATCH_SIZE, 10) || 25;
const CONCURRENCY = parseInt(process.env.EMAIL_CLASSIFIER_CONCURRENCY, 10) || 3;
const PROMPT_FILE = 'gmail_lab_classifier.txt';

let openAiClient;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function serializeError(error) {
  return {
    message: error?.message,
    code: error?.code,
    type: error?.type,
    status: error?.status ?? error?.statusCode,
    response_status: error?.response?.status,
    response_status_text: error?.response?.statusText,
    response_error: error?.response?.data?.error || error?.response?.data,
    headers: error?.response?.headers,
    cause: error?.cause ? { message: error.cause.message, code: error.cause.code } : undefined
  };
}

/**
 * Get OpenAI client
 */
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
 * Classification schema for OpenAI structured output
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
          is_lab_likely: { type: 'boolean' },
          confidence: { type: 'number' },
          reason: { type: 'string' }
        },
        required: ['id', 'is_lab_likely', 'confidence', 'reason']
      }
    }
  },
  required: ['classifications']
};

/**
 * Classify a batch of emails
 * @param {Array} emailBatch - Array of email objects with {id, subject, from, date}
 * @param {string} systemPrompt - System prompt for classification
 * @returns {Promise<Array>} Array of classification results
 */
async function classifyBatch(emailBatch, systemPrompt) {
  const client = getOpenAiClient();

  const requestPayload = {
    model: DEFAULT_MODEL,
    input: [
      {
        role: 'system',
        content: [{ type: 'input_text', text: systemPrompt }]
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: JSON.stringify(emailBatch) }]
      }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'gmail_lab_classification',
        strict: true,
        schema: CLASSIFICATION_SCHEMA
      }
    }
  };

  logger.info(`[emailClassifier] Classifying batch of ${emailBatch.length} emails`);

  let response;
  const startedAt = Date.now();
  try {
    response = await client.responses.parse(requestPayload);
    logger.info(`[emailClassifier] Batch classified successfully in ${Date.now() - startedAt}ms`);
  } catch (error) {
    if (error instanceof SyntaxError) {
      logger.warn('[emailClassifier] SyntaxError in parse, falling back to create');
      response = await client.responses.create(requestPayload);
      logger.info(`[emailClassifier] Batch classified via create in ${Date.now() - startedAt}ms`);
    } else {
      logger.error(`[emailClassifier] Failed to classify batch after ${Date.now() - startedAt}ms`, serializeError(error));
      throw error;
    }
  }

  const parsed = response?.output_parsed;

  if (!parsed || !Array.isArray(parsed.classifications)) {
    logger.error('[emailClassifier] Invalid response format from OpenAI');
    throw new Error('Invalid response format from OpenAI');
  }

  // Validate that LLM returned correct number of classifications
  if (parsed.classifications.length !== emailBatch.length) {
    const diff = parsed.classifications.length - emailBatch.length;
    if (diff > 0) {
      logger.warn(
        `[emailClassifier] LLM returned ${parsed.classifications.length} classifications but expected ${emailBatch.length}. ` +
        `${diff} extra/duplicate classification(s).`
      );
    } else {
      logger.warn(
        `[emailClassifier] LLM returned ${parsed.classifications.length} classifications but expected ${emailBatch.length}. ` +
        `${Math.abs(diff)} missing classification(s).`
      );
    }
  }

  return parsed.classifications;
}

/**
 * Classify emails as likely/unlikely to contain lab results
 * @param {Array} emails - Array of email metadata objects {id, subject, from, date}
 * @param {Function} onProgress - Optional callback for progress updates (batchIndex, totalBatches)
 * @returns {Promise<{results: Array, failedBatches: Array}>} Classification results and any failed batches
 */
async function classifyEmails(emails, onProgress = null) {
  if (!Array.isArray(emails) || emails.length === 0) {
    logger.info('[emailClassifier] No emails to classify');
    return { results: [], failedBatches: [] };
  }

  logger.info(`[emailClassifier] Starting classification of ${emails.length} emails`);

  try {
    // Load system prompt
    const systemPrompt = loadPrompt(PROMPT_FILE);

    // Split emails into batches
    const batches = [];
    for (let i = 0; i < emails.length; i += BATCH_SIZE) {
      batches.push(emails.slice(i, i + BATCH_SIZE));
    }

    logger.info(`[emailClassifier] Processing ${batches.length} batches of ${BATCH_SIZE} emails each (parallel)`);

    // Process batches IN PARALLEL with configurable concurrency
    const limit = pLimit(CONCURRENCY);
    let completedBatches = 0;
    const startedAt = Date.now();

    const batchResults = await Promise.all(
      batches.map((batch, index) =>
        limit(async () => {
          const label = `${index + 1}/${batches.length}`;
          logger.info(`[emailClassifier] Processing batch ${label}`);

          let attempts = 0;
          let lastError;
          const batchStart = Date.now();

          while (attempts < MAX_RETRIES) {
            attempts++;

            try {
              const result = await classifyBatch(batch, systemPrompt);

              completedBatches++;
              if (onProgress) {
                onProgress(completedBatches, batches.length);
              }

              logger.info(`[emailClassifier] Batch ${label} done in ${Date.now() - batchStart}ms (attempt ${attempts})`);
              return result;
            } catch (error) {
              lastError = error;
              const backoff = RETRY_DELAY_MS * Math.pow(2, attempts - 1);

              logger.error(`[emailClassifier] Batch ${label} attempt ${attempts} failed`, serializeError(error));

              if (attempts < MAX_RETRIES) {
                logger.warn(`[emailClassifier] Retrying batch ${label} in ${backoff}ms`);
                await delay(backoff);
              }
            }
          }

          const errorPayload = serializeError(lastError);
          logger.error(`[emailClassifier] Batch ${label} failed after ${MAX_RETRIES} attempts`, errorPayload);

          return { __failed: true, label, error: errorPayload };
        })
      )
    );

    // Flatten results
    const failedBatches = batchResults.filter(r => r && r.__failed);
    const successfulResults = batchResults.filter(r => !r?.__failed);

    const allClassifications = successfulResults.flat();

    // Calculate classification discrepancy
    const totalEmailsSent = emails.length;
    const totalClassificationsReceived = allClassifications.length;
    const discrepancy = totalClassificationsReceived - totalEmailsSent;

    if (failedBatches.length) {
      logger.error(`[emailClassifier] ${failedBatches.length} batches failed during classification`, failedBatches);

      if (failedBatches.length === batches.length) {
        throw new Error('All email classification batches failed. Check logs for details.');
      }
    }

    if (discrepancy > 0) {
      logger.warn(
        `[emailClassifier] LLM returned ${discrepancy} extra classifications (${totalClassificationsReceived} received vs ${totalEmailsSent} sent). ` +
        `Likely duplicate/hallucinated IDs.`
      );
    } else if (discrepancy < 0) {
      logger.warn(
        `[emailClassifier] Missing ${Math.abs(discrepancy)} classifications (${totalClassificationsReceived} received vs ${totalEmailsSent} sent). ` +
        `${((Math.abs(discrepancy) / totalEmailsSent) * 100).toFixed(1)}% loss.`
      );
    }

    logger.info(
      `[emailClassifier] Classification complete in ${Date.now() - startedAt}ms: ` +
      `${allClassifications.length}/${totalEmailsSent} results (${failedBatches.length} failed batch(es)) with concurrency=${CONCURRENCY}, batchSize=${BATCH_SIZE}`
    );

    return {
      results: allClassifications,
      failedBatches,
      stats: {
        total_emails_sent: totalEmailsSent,
        classifications_received: totalClassificationsReceived,
        extra_count: discrepancy > 0 ? discrepancy : 0,
        missing_count: discrepancy < 0 ? Math.abs(discrepancy) : 0
      }
    };
  } catch (error) {
    logger.error('[emailClassifier] Failed to classify emails:', serializeError(error));
    throw error;
  }
}

export {
  classifyEmails
};
