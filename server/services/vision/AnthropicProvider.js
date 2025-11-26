import Anthropic from '@anthropic-ai/sdk';
import VisionProvider from './VisionProvider.js';

/**
 * Anthropic Claude Vision API provider
 * Uses structured outputs (JSON schema) similar to OpenAI
 */
class AnthropicProvider extends VisionProvider {
  constructor() {
    super();
    this.model = process.env.ANTHROPIC_VISION_MODEL || 'claude-sonnet-4-5-20250929';
  }

  /**
   * Validate Anthropic configuration
   * @throws {Error} If configuration is invalid
   */
  validateConfig() {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is required but not set');
    }
    if (!process.env.ANTHROPIC_VISION_MODEL) {
      console.warn('[Anthropic] ANTHROPIC_VISION_MODEL not set, using default: claude-sonnet-4-5-20250929');
    }
  }

  /**
   * Parse data URL to extract media type and base64 data
   * @param {string} dataUrl - Data URL (format: data:image/png;base64,...)
   * @returns {object} Object with mediaType and data properties
   */
  parseDataUrl(dataUrl) {
    const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!match) {
      throw new Error(`Invalid data URL format: ${dataUrl.substring(0, 50)}...`);
    }
    return {
      mediaType: match[1], // 'image/png' or 'image/jpeg'
      data: match[2], // base64 data without prefix
    };
  }

  /**
   * Validate schema for compatibility with Anthropic's structured outputs API
   * Logs warnings for unsupported features that may cause 400 errors
   * @param {object} schema - JSON schema to validate
   * @param {string} path - Current path in schema (for nested validation)
   * @returns {Array<string>} Array of warning messages
   */
  validateSchemaCompatibility(schema, path = 'schema') {
    const warnings = [];

    const traverse = (node, currentPath) => {
      if (!node || typeof node !== 'object') {
        return;
      }

      // Check for unsupported constraints
      const unsupportedConstraints = [
        'minimum',
        'maximum',
        'exclusiveMinimum',
        'exclusiveMaximum',
        'multipleOf',
        'minLength',
        'maxLength',
        'pattern', // regex patterns may have limited support
      ];

      for (const constraint of unsupportedConstraints) {
        if (node[constraint] !== undefined) {
          warnings.push(`${currentPath}: '${constraint}' constraint not directly supported (will be removed by SDK)`);
        }
      }

      // Check for minItems with unsupported values
      if (node.minItems !== undefined && node.minItems > 1) {
        warnings.push(`${currentPath}: 'minItems' only supports 0 or 1 (found: ${node.minItems})`);
      }

      // Check for additionalProperties not set to false
      if (node.type === 'object' && node.additionalProperties !== false) {
        warnings.push(`${currentPath}: 'additionalProperties' should be set to false for objects`);
      }

      // Check for external $ref
      if (node.$ref && node.$ref.startsWith('http')) {
        warnings.push(`${currentPath}: External $ref not supported (${node.$ref})`);
      }

      // Check for unsupported string formats
      const supportedFormats = [
        'date-time',
        'time',
        'date',
        'duration',
        'email',
        'hostname',
        'uri',
        'ipv4',
        'ipv6',
        'uuid',
      ];
      if (node.format && !supportedFormats.includes(node.format)) {
        warnings.push(`${currentPath}: Unsupported string format '${node.format}'`);
      }

      // Recursively check nested objects
      if (node.properties) {
        Object.entries(node.properties).forEach(([key, value]) => {
          traverse(value, `${currentPath}.properties.${key}`);
        });
      }

      if (node.items) {
        traverse(node.items, `${currentPath}.items`);
      }

      if (Array.isArray(node.anyOf)) {
        node.anyOf.forEach((variant, idx) => {
          traverse(variant, `${currentPath}.anyOf[${idx}]`);
        });
      }

      if (Array.isArray(node.allOf)) {
        node.allOf.forEach((variant, idx) => {
          traverse(variant, `${currentPath}.allOf[${idx}]`);
        });
      }
    };

    traverse(schema, path);
    return warnings;
  }

  /**
   * Transform the shared schema into an Anthropic-friendly version.
   * Anthropic enforces tight limits on conditional branches per schema, so we
   * normalize repeated nullable variants into shared $defs and remove the
   * repeated anyOf structures that otherwise exceed the limit.
   * @param {object} schema - Original JSON schema
   * @returns {object} Anthropic-compatible JSON schema
   */
  transformSchema(schema) {
    // Validate schema compatibility and log warnings
    const warnings = this.validateSchemaCompatibility(schema);
    if (warnings.length > 0) {
      console.warn('[AnthropicProvider] Schema compatibility warnings:', warnings);
    }
    const defs = {
      NullableString: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      NullableNumber: { anyOf: [{ type: 'number' }, { type: 'null' }] },
      NullableStringOrNumber: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }] },
    };

    const signatureRefMap = {
      'null|string': '#/$defs/NullableString',
      'null|number': '#/$defs/NullableNumber',
      'null|number|string': '#/$defs/NullableStringOrNumber',
      'number|null|string': '#/$defs/NullableStringOrNumber',
      'null|string|number': '#/$defs/NullableStringOrNumber',
    };

    const clone = JSON.parse(JSON.stringify(schema));

    const normalize = (node) => {
      if (Array.isArray(node)) {
        return node.map((item) => (typeof item === 'object' && item !== null ? normalize(item) : item));
      }

      if (!node || typeof node !== 'object') {
        return node;
      }

      if (Array.isArray(node.anyOf)) {
        const signature = node.anyOf
          .map((variant) => (variant && typeof variant === 'object' ? variant.type : undefined))
          .filter(Boolean)
          .sort()
          .join('|');

        const ref = signatureRefMap[signature];

        // CRITICAL: Preserve all other properties (description, default, title, etc.)
        // Extract anyOf separately, then recursively normalize all other properties
        const { anyOf, ...otherProps } = node;
        const normalizedOtherProps = Object.entries(otherProps).reduce((acc, [key, value]) => {
          acc[key] = normalize(value);
          return acc;
        }, {});

        if (ref) {
          // Known pattern: Replace anyOf with $ref, but preserve all other properties
          return {
            $ref: ref,
            ...normalizedOtherProps,
          };
        }

        // Unknown pattern: Preserve anyOf as-is with all other properties
        console.warn(`[AnthropicProvider] Unknown anyOf pattern detected: ${signature}. Preserving as-is.`);
        return {
          anyOf: anyOf.map(normalize),
          ...normalizedOtherProps,
        };
      }

      return Object.entries(node).reduce((acc, [key, value]) => {
        if (key === 'anyOf') {
          return acc;
        }
        acc[key] = normalize(value);
        return acc;
      }, {});
    };

    const transformed = normalize(clone);
    transformed.$defs = { ...(transformed.$defs || {}), ...defs };
    return transformed;
  }

  /**
   * Log Anthropic rate limit headers for monitoring
   * @param {object} response - Anthropic API response object
   */
  logRateLimitHeaders(response) {
    // Anthropic SDK doesn't expose response headers directly on the response object
    // Headers are available via response_headers property if present
    const headers = response.response_headers || {};

    const rateLimitInfo = {
      requests_remaining: headers['anthropic-ratelimit-requests-remaining'],
      requests_reset: headers['anthropic-ratelimit-requests-reset'],
      input_tokens_remaining: headers['anthropic-ratelimit-input-tokens-remaining'],
      input_tokens_reset: headers['anthropic-ratelimit-input-tokens-reset'],
      output_tokens_remaining: headers['anthropic-ratelimit-output-tokens-remaining'],
      output_tokens_reset: headers['anthropic-ratelimit-output-tokens-reset'],
      retry_after: headers['retry-after'],
    };

    // Only log if we have any rate limit info
    const hasRateLimitInfo = Object.values(rateLimitInfo).some((v) => v !== undefined);

    if (hasRateLimitInfo) {
      // Filter out undefined values for cleaner logs
      const definedValues = Object.fromEntries(
        Object.entries(rateLimitInfo).filter(([, v]) => v !== undefined)
      );

      console.log('[AnthropicProvider] Rate limit status:', definedValues);

      // Warn if approaching limits (< 20% remaining)
      const requestsRemaining = parseInt(rateLimitInfo.requests_remaining, 10);
      if (!isNaN(requestsRemaining) && requestsRemaining < 10) {
        console.warn(`[AnthropicProvider] WARNING: Only ${requestsRemaining} requests remaining before rate limit`);
      }

      const inputTokensRemaining = parseInt(rateLimitInfo.input_tokens_remaining, 10);
      if (!isNaN(inputTokensRemaining) && inputTokensRemaining < 10000) {
        console.warn(`[AnthropicProvider] WARNING: Only ${inputTokensRemaining} input tokens remaining before rate limit`);
      }
    }
  }

  /**
   * Analyze images or PDFs using Anthropic Claude Vision API with JSON mode
   * @param {Array<string>} imageDataUrls - Base64 data URLs (format: data:image/png;base64,...) - optional if pdfBuffer provided
   * @param {string} systemPrompt - System instructions
   * @param {string} userPrompt - User query
   * @param {object} schema - JSON schema for structured output
   * @param {object} options - Optional parameters
   * @param {Buffer} options.pdfBuffer - PDF file buffer for native PDF processing (Anthropic only)
   * @param {string} options.mimetype - File MIME type (required if pdfBuffer provided)
   * @returns {Promise<object>} Structured extraction result
   */
  async analyze(imageDataUrls, systemPrompt, userPrompt, schema, options = {}) {
    const betas = ['structured-outputs-2025-11-13'];
    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    if (options.pdfBuffer && options.mimetype === 'application/pdf') {
      betas.push('pdfs-2024-09-25');
    }

    // Build message content: text + documents/images
    const userContent = [
      {
        type: 'text',
        text: `${userPrompt}\n\nReturn structured JSON that matches the provided schema.`,
      },
    ];

    // Handle native PDF input (Anthropic supports this directly)
    if (options.pdfBuffer && options.mimetype === 'application/pdf') {
      console.log('[AnthropicProvider] Using native PDF input (no conversion)');

      // Validate PDF size (Anthropic limit: 32MB for documents)
      this.validateImageSize(options.pdfBuffer, 32);

      const pdfBase64 = options.pdfBuffer.toString('base64');
      userContent.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: pdfBase64,
        },
      });
    } else {
      // Handle image data URLs (converted PDFs or native images)
      imageDataUrls.forEach((imageUrl) => {
        // Validate image size (Anthropic limit: 5MB per image)
        const { data } = this.parseDataUrl(imageUrl);
        const imageBuffer = Buffer.from(data, 'base64');
        this.validateImageSize(imageBuffer, 5);

        const { mediaType } = this.parseDataUrl(imageUrl);
        userContent.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: mediaType,
            data,
          },
        });
      });
    }

    const requestPayload = {
      model: this.model,
      max_tokens: 16384, // Max output tokens for large lab reports (Claude Sonnet 4.5 supports up to 32K)
      temperature: 0, // Deterministic output for consistency
      betas,
      output_format: {
        type: 'json_schema',
        schema: this.transformSchema(schema),
      },
      system: [{ type: 'text', text: systemPrompt }],
      messages: [
        {
          role: 'user',
          content: userContent,
        },
      ],
    };

    // Wrap API call with retry logic
    // Use 5 attempts for vision API (expensive operations, more tolerance for 529 overload errors)
    const callVision = async () => await client.beta.messages.create(requestPayload);

    const response = await this.withRetry(callVision, { attempts: 5, baseDelay: 1000 });

    // Log rate limit headers for monitoring (Anthropic best practice)
    this.logRateLimitHeaders(response);

    // Validate stop_reason before processing (structured outputs edge cases)
    if (response.stop_reason === 'refusal') {
      console.error('[AnthropicProvider] Request refused by Claude for safety reasons:', {
        model: this.model,
        response_preview: response.content[0]?.text?.substring(0, 300),
      });
      throw new Error('Request refused by Claude for safety reasons. The content may violate usage policies.');
    }

    if (response.stop_reason === 'max_tokens') {
      console.error('[AnthropicProvider] Response truncated due to max_tokens limit:', {
        model: this.model,
        max_tokens: requestPayload.max_tokens,
        response_preview: response.content[0]?.text?.substring(0, 300),
      });
      throw new Error(
        `Response truncated due to max_tokens limit (${requestPayload.max_tokens}). ` +
          'Increase max_tokens and retry, or simplify the input.',
      );
    }

    // Extract text response from Anthropic
    const textContent = response.content.find((block) => block.type === 'text');
    if (!textContent) {
      throw new Error('Anthropic response missing text block');
    }

    const jsonText = textContent.text.trim();
    let result;
    try {
      result = JSON.parse(jsonText);
    } catch (parseError) {
      console.error('[AnthropicProvider] Structured output parse failed:', {
        error: parseError.message,
        response_preview: jsonText.substring(0, 300),
        stop_reason: response.stop_reason,
      });
      throw new Error(`Failed to parse Anthropic JSON response: ${parseError.message}`);
    }

    // Debug logging
    console.log('[AnthropicProvider] Extracted data summary:', {
      has_patient_name: !!result.patient_name,
      has_parameters: !!result.parameters,
      parameters_count: result.parameters?.length || 0,
      has_missing_data: !!result.missing_data,
    });

    return result;
  }
}

export default AnthropicProvider;
