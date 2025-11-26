import OpenAI from 'openai';
import VisionProvider from './VisionProvider.js';

/**
 * OpenAI Vision API provider
 * Uses native structured output via responses.parse()
 */
class OpenAIProvider extends VisionProvider {
  constructor() {
    super();
    this.model = process.env.OPENAI_VISION_MODEL || 'gpt-5-mini';
  }

  /**
   * Validate OpenAI configuration
   * @throws {Error} If configuration is invalid
   */
  validateConfig() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required but not set');
    }
    if (!process.env.OPENAI_VISION_MODEL) {
      console.warn('[OpenAI] OPENAI_VISION_MODEL not set, using default: gpt-5-mini');
    }
  }

  /**
   * Analyze images or PDFs using OpenAI Vision API
   * @param {Array<string>} imageDataUrls - Base64 data URLs (format: data:image/png;base64,...) - optional if pdfBuffer provided
   * @param {string} systemPrompt - System instructions
   * @param {string} userPrompt - User query
   * @param {object} schema - JSON schema for structured output
   * @param {object} options - Optional parameters
   * @param {Buffer} options.pdfBuffer - PDF file buffer for native PDF processing
   * @param {string} options.mimetype - File MIME type (required if pdfBuffer provided)
   * @param {string} options.filename - Original filename (for PDF uploads)
   * @returns {Promise<object>} Structured extraction result
   */
  async analyze(imageDataUrls, systemPrompt, userPrompt, schema, options = {}) {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Build user content with text + files/images
    const userContent = [{ type: 'input_text', text: userPrompt }];

    // Handle native PDF input (experimental for gpt-5-mini)
    if (options.pdfBuffer && options.mimetype === 'application/pdf') {
      console.log('[OpenAIProvider] Using native PDF input (experimental)');

      // Validate PDF size (OpenAI limit: 50MB per file)
      this.validateImageSize(options.pdfBuffer, 50);

      const pdfBase64 = options.pdfBuffer.toString('base64');
      const filename = options.filename || 'lab_report.pdf';

      userContent.push({
        type: 'input_file',
        filename,
        file_data: `data:application/pdf;base64,${pdfBase64}`,
      });
    } else {
      // Handle image data URLs (converted PDFs or native images)
      imageDataUrls.forEach((imageUrl) => {
        // Validate image size (OpenAI limit: 20MB)
        const base64Data = imageUrl.split(',')[1];
        const imageBuffer = Buffer.from(base64Data, 'base64');
        this.validateImageSize(imageBuffer, 20);

        userContent.push({ type: 'input_image', image_url: imageUrl });
      });
    }

    const structuredOutputFormat = {
      type: 'json_schema',
      name: 'full_lab_extraction',
      strict: true,
      schema,
    };

    const requestPayload = {
      model: this.model,
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: systemPrompt }],
        },
        {
          role: 'user',
          content: userContent,
        },
      ],
      text: {
        format: structuredOutputFormat,
      },
    };

    // Wrap API call with retry logic
    const callVision = async () => {
      try {
        return await client.responses.parse(requestPayload);
      } catch (error) {
        // Fallback to create() if parse() fails with SyntaxError
        if (error instanceof SyntaxError) {
          return await client.responses.create(requestPayload);
        }
        throw error;
      }
    };

    // Use 5 attempts for vision API (expensive operations, more tolerance for overload/rate limit errors)
    const response = await this.withRetry(callVision, { attempts: 5, baseDelay: 1000 });

    // Extract structured output from response
    // OpenAI returns parsed JSON in output_parsed
    if (response.output_parsed) {
      return response.output_parsed;
    }

    // Fallback: parse output_text if output_parsed is not available
    if (response.output_text) {
      try {
        return JSON.parse(response.output_text);
      } catch (error) {
        console.error('[OpenAI] Failed to parse output_text:', error.message);
        throw new Error(`Failed to parse OpenAI response: ${error.message}`);
      }
    }

    throw new Error('OpenAI response missing both output_parsed and output_text');
  }
}

export default OpenAIProvider;
