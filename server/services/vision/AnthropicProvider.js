const Anthropic = require('@anthropic-ai/sdk');
const VisionProvider = require('./VisionProvider');

/**
 * Anthropic Claude Vision API provider
 * Uses native structured outputs for guaranteed schema compliance
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
   * Analyze images or PDFs using Anthropic Claude Vision API with structured outputs
   * @param {Array<string>} imageDataUrls - Base64 data URLs (format: data:image/png;base64,...) - optional if pdfBuffer provided
   * @param {string} systemPrompt - System instructions
   * @param {string} userPrompt - User query
   * @param {object} schema - JSON schema for structured output (same format as OpenAI)
   * @param {object} options - Optional parameters
   * @param {Buffer} options.pdfBuffer - PDF file buffer for native PDF processing (Anthropic only)
   * @param {string} options.mimetype - File MIME type (required if pdfBuffer provided)
   * @returns {Promise<object>} Structured extraction result
   */
  async analyze(imageDataUrls, systemPrompt, userPrompt, schema, options = {}) {
    // Initialize client with beta headers for PDF support and structured outputs
    const betaFeatures = ['structured-outputs-2025-11-13'];

    // Add PDF beta if using native PDF input
    if (options.pdfBuffer && options.mimetype === 'application/pdf') {
      betaFeatures.push('pdfs-2024-09-25');
    }

    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      defaultHeaders: {
        'anthropic-beta': betaFeatures.join(','),
      },
    });

    // Build message content: text + documents/images
    const content = [
      { type: 'text', text: `${systemPrompt}\n\n${userPrompt}` },
    ];

    // Handle native PDF input (Anthropic supports this directly)
    if (options.pdfBuffer && options.mimetype === 'application/pdf') {
      console.log('[AnthropicProvider] Using native PDF input (no conversion)');

      // Validate PDF size (Anthropic limit: 32MB for documents)
      this.validateImageSize(options.pdfBuffer, 32);

      const pdfBase64 = options.pdfBuffer.toString('base64');
      content.push({
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
        content.push({
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
      messages: [
        {
          role: 'user',
          content,
        },
      ],
      output_format: {
        type: 'json_schema',
        schema,
      },
    };

    // Wrap API call with retry logic
    const callVision = async () => await client.messages.create(requestPayload);

    const response = await this.withRetry(callVision);

    // Extract text response from Anthropic
    const textContent = response.content.find((block) => block.type === 'text');
    if (!textContent) {
      throw new Error('Anthropic response missing text block');
    }

    // Parse JSON from response - guaranteed to be valid with structured outputs
    const result = JSON.parse(textContent.text);

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

module.exports = AnthropicProvider;
