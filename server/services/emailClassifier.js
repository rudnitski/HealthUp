/**
 * Email Classifier Service
 * Uses OpenAI to classify emails as likely/unlikely to contain lab test results
 * PRD: docs/PRD_v2_8_Gmail_Integration_Step1.md
 */

const OpenAI = require('openai');
const pino = require('pino');
const pLimit = require('p-limit');
const { loadPrompt } = require('../utils/promptLoader');

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
const DEFAULT_MODEL = process.env.EMAIL_CLASSIFIER_MODEL || process.env.SQL_GENERATOR_MODEL || 'gpt-5-mini';
const BATCH_SIZE = 50; // Process 50 emails per batch
const PROMPT_FILE = 'gmail_lab_classifier.txt';

let openAiClient;

/**
 * Get OpenAI client
 */
function getOpenAiClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  if (!openAiClient) {
    openAiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
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
  try {
    response = await client.responses.parse(requestPayload);
    logger.info(`[emailClassifier] Batch classified successfully`);
  } catch (error) {
    if (error instanceof SyntaxError) {
      logger.warn('[emailClassifier] SyntaxError in parse, falling back to create');
      response = await client.responses.create(requestPayload);
    } else {
      logger.error('[emailClassifier] Failed to classify batch:', error.message);
      throw error;
    }
  }

  const parsed = response?.output_parsed;

  if (!parsed || !Array.isArray(parsed.classifications)) {
    logger.error('[emailClassifier] Invalid response format from OpenAI');
    throw new Error('Invalid response format from OpenAI');
  }

  return parsed.classifications;
}

/**
 * Classify emails as likely/unlikely to contain lab results
 * @param {Array} emails - Array of email metadata objects {id, subject, from, date}
 * @returns {Promise<Array>} Array of classification results
 */
async function classifyEmails(emails) {
  if (!Array.isArray(emails) || emails.length === 0) {
    logger.info('[emailClassifier] No emails to classify');
    return [];
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

    logger.info(`[emailClassifier] Processing ${batches.length} batches of ${BATCH_SIZE} emails each`);

    // Process batches sequentially (using p-limit with concurrency 1)
    const limit = pLimit(1);

    const batchResults = await Promise.all(
      batches.map((batch, index) =>
        limit(async () => {
          logger.info(`[emailClassifier] Processing batch ${index + 1}/${batches.length}`);
          return await classifyBatch(batch, systemPrompt);
        })
      )
    );

    // Flatten results
    const allClassifications = batchResults.flat();

    logger.info(`[emailClassifier] Classification complete: ${allClassifications.length} results`);

    return allClassifications;
  } catch (error) {
    logger.error('[emailClassifier] Failed to classify emails:', error.message);
    throw error;
  }
}

module.exports = {
  classifyEmails
};
