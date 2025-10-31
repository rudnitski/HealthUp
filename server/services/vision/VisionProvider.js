/**
 * Abstract interface for vision OCR providers
 * Provides common retry logic and error handling for both OpenAI and Anthropic
 */
class VisionProvider {
  /**
   * Analyze images and extract structured data
   * @param {Array<string>} imageDataUrls - Base64 data URLs
   * @param {string} systemPrompt - System instructions
   * @param {string} userPrompt - User query
   * @param {object} schema - JSON schema for structured output
   * @returns {Promise<object>} Structured extraction result
   */
  async analyze(imageDataUrls, systemPrompt, userPrompt, schema) {
    throw new Error('analyze() must be implemented by subclass');
  }

  /**
   * Validate provider configuration (API keys, model names)
   * @throws {Error} If configuration is invalid
   */
  validateConfig() {
    throw new Error('validateConfig() must be implemented by subclass');
  }

  /**
   * Retry a function with exponential backoff
   * @param {Function} fn - Async function to retry
   * @param {object} options - Retry options
   * @param {number} options.attempts - Max retry attempts (default: 3)
   * @param {number} options.baseDelay - Base delay in ms (default: 500)
   * @returns {Promise<any>} Result from fn
   */
  async withRetry(fn, { attempts = 3, baseDelay = 500 } = {}) {
    let lastError;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        if (attempt === attempts || !this.shouldRetry(error)) {
          break;
        }

        const backoff = baseDelay * (2 ** (attempt - 1));
        console.log(`[${this.constructor.name}] Retry attempt ${attempt}/${attempts} after ${backoff}ms. Error: ${error.message}`);
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }

    throw lastError;
  }

  /**
   * Determine if an error should trigger a retry
   * @param {Error} error - Error from API call
   * @returns {boolean} True if should retry
   */
  shouldRetry(error) {
    if (!error) {
      return false;
    }

    // OpenAI SDK: error.response.status
    // Anthropic SDK: error.status (APIError)
    // Network errors: error.code
    const status = error.response?.status || error.status;

    if (status) {
      return status === 429 || status >= 500;
    }

    // Retry on network timeouts and connection errors
    const retryableCodes = ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND'];
    if (error.code && retryableCodes.includes(error.code)) {
      return true;
    }

    return false;
  }

  /**
   * Validate image size for provider limits
   * @param {Buffer} imageBuffer - Image data
   * @param {number} limitMB - Size limit in MB
   * @throws {Error} If image exceeds provider limit
   */
  validateImageSize(imageBuffer, limitMB) {
    const sizeMB = imageBuffer.length / (1024 * 1024);
    const providerName = this.constructor.name.replace('Provider', '').toLowerCase();

    if (sizeMB > limitMB) {
      const error = new Error(
        `Image size ${sizeMB.toFixed(2)}MB exceeds ${providerName} limit of ${limitMB}MB. ` +
        `Please upload a smaller file or reduce PDF quality.`
      );
      error.statusCode = 413; // Payload Too Large
      throw error;
    }

    // Log warning at 80% of limit
    if (sizeMB > limitMB * 0.8) {
      console.warn(`[${providerName}] Image size: ${sizeMB.toFixed(2)}MB approaching limit of ${limitMB}MB`);
    } else {
      console.log(`[${providerName}] Image size: ${sizeMB.toFixed(2)}MB (limit: ${limitMB}MB)`);
    }
  }
}

module.exports = VisionProvider;
