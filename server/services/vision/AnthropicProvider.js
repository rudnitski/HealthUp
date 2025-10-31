const Anthropic = require('@anthropic-ai/sdk');
const VisionProvider = require('./VisionProvider');

/**
 * Anthropic Claude Vision API provider
 * Uses JSON mode for structured output (similar to OpenAI)
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
   * Generate simplified JSON structure instructions for the prompt
   * Uses human-readable examples instead of formal JSON schema
   * @param {object} schema - JSON schema (not directly used, kept for compatibility)
   * @returns {string} Formatted structure instructions
   */
  generateSchemaInstructions(schema) {
    return `You must respond with ONLY valid JSON that matches this exact structure:

{
  "patient_name": "string or null",
  "patient_age": "string/number or null",
  "patient_date_of_birth": "string or null",
  "patient_gender": "string or null",
  "test_date": "string or null",
  "parameters": [
    {
      "parameter_name": "string or null",
      "result": "string or null",
      "unit": "string or null",
      "reference_interval": {
        "lower": "number or null",
        "lower_operator": "string or null (e.g., '>', '>=')",
        "upper": "number or null",
        "upper_operator": "string or null (e.g., '<', '<=')",
        "text": "string or null (short version, e.g., '10-20')",
        "full_text": "string or null (complete reference text)"
      },
      "is_value_out_of_range": "boolean (true/false)",
      "numeric_result": "number or null (numeric value from result field)"
    }
  ],
  "missing_data": [
    {
      "parameter_name": "string or null",
      "missing_fields": ["array of field name strings"]
    }
  ]
}

CRITICAL REQUIREMENTS:
- Return ONLY the JSON object, no additional text or explanation before or after
- The response must be valid, parseable JSON with no syntax errors
- All fields listed above are required (use null if data is missing)
- Ensure all nested objects and arrays follow the structure exactly
- Pay special attention to proper comma placement in arrays and objects
- Ensure all strings are properly quoted and escaped
- Close all brackets and braces properly`;
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
    // Initialize client with beta header if using PDF input
    const clientConfig = {
      apiKey: process.env.ANTHROPIC_API_KEY,
    };

    // Add beta header for document support (Files API)
    if (options.pdfBuffer && options.mimetype === 'application/pdf') {
      clientConfig.defaultHeaders = {
        'anthropic-beta': 'pdfs-2024-09-25',
      };
    }

    const client = new Anthropic(clientConfig);

    // Build message content: text + documents/images
    const content = [
      { type: 'text', text: `${systemPrompt}\n\n${userPrompt}\n\n${this.generateSchemaInstructions(schema)}` },
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
    };

    // Wrap API call with retry logic
    const callVision = async () => await client.messages.create(requestPayload);

    const response = await this.withRetry(callVision);

    // Extract text response from Anthropic
    const textContent = response.content.find((block) => block.type === 'text');
    if (!textContent) {
      throw new Error('Anthropic response missing text block');
    }

    // Parse JSON from response
    let result;
    let jsonText = textContent.text.trim();

    // Remove markdown code blocks if present
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    try {
      result = JSON.parse(jsonText);
    } catch (parseError) {
      console.warn('[AnthropicProvider] Initial JSON parse failed, attempting repair...', {
        error: parseError.message,
        position: parseError.message.match(/position (\d+)/)?.[1],
      });

      // Try to extract valid JSON prefix (up to the error point)
      // This handles cases where Anthropic's response was truncated or malformed
      const match = parseError.message.match(/position (\d+)/);
      if (match) {
        const errorPos = parseInt(match[1], 10);

        // Try to find the last complete object by truncating at error position
        // and working backwards to find a valid closing point
        let truncated = jsonText.substring(0, errorPos);

        // Count unclosed brackets/braces and try to close them
        let openBraces = (truncated.match(/{/g) || []).length - (truncated.match(/}/g) || []).length;
        let openBrackets = (truncated.match(/\[/g) || []).length - (truncated.match(/]/g) || []).length;

        // Remove any trailing incomplete content (partial string, etc.)
        truncated = truncated.replace(/,\s*$/, '').replace(/:\s*[^,}\]]*$/, ': null');

        // Close open structures
        truncated += ']'.repeat(openBrackets) + '}'.repeat(openBraces);

        try {
          result = JSON.parse(truncated);
          console.log('[AnthropicProvider] Successfully repaired JSON by truncating at error position');
        } catch (repairError) {
          console.error('[AnthropicProvider] JSON repair failed:', {
            original_error: parseError.message,
            repair_error: repairError.message,
            response_length: jsonText.length,
            response_preview: jsonText.substring(0, 300),
          });
          throw new Error(`Failed to parse Anthropic JSON response: ${parseError.message}`);
        }
      } else {
        console.error('[AnthropicProvider] Cannot repair JSON (no position info):', {
          error: parseError.message,
          response_preview: jsonText.substring(0, 300),
        });
        throw new Error(`Failed to parse Anthropic JSON response: ${parseError.message}`);
      }
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

module.exports = AnthropicProvider;
