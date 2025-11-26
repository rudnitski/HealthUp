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

        // Check if we should retry this error
        const retryDecision = this.shouldRetry(error);
        if (attempt === attempts || !retryDecision.shouldRetry) {
          break;
        }

        // Calculate delay with jitter
        const delay = this.calculateBackoff(error, attempt, baseDelay, retryDecision);

        console.log(`[${this.constructor.name}] Retry attempt ${attempt}/${attempts} after ${delay}ms. ` +
          `Error: ${error.message} (status: ${error.status || error.response?.status || 'unknown'})`);

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  /**
   * Calculate backoff delay with exponential backoff, jitter, and retry-after support
   * @param {Error} error - Error from API call
   * @param {number} attempt - Current attempt number (1-based)
   * @param {number} baseDelay - Base delay in ms
   * @param {object} retryDecision - Decision from shouldRetry()
   * @returns {number} Delay in milliseconds
   */
  calculateBackoff(error, attempt, baseDelay, retryDecision) {
    // 1. Check for retry-after header (Anthropic best practice)
    // RFC 7231 allows Retry-After to be either delay-seconds or HTTP-date
    const retryAfterHeader = error.headers?.['retry-after'] ||
                             error.response?.headers?.['retry-after'];

    if (retryAfterHeader) {
      // Try parsing as seconds (numeric format)
      const retryAfterSeconds = parseInt(retryAfterHeader, 10);

      if (!isNaN(retryAfterSeconds) && retryAfterSeconds > 0) {
        const retryAfterMs = retryAfterSeconds * 1000;
        console.log(`[${this.constructor.name}] Using retry-after header: ${retryAfterSeconds}s`);
        return retryAfterMs;
      }

      // Try parsing as HTTP-date format (e.g., "Tue, 05 Mar 2024 10:00:00 GMT")
      const retryAfterDate = new Date(retryAfterHeader);
      if (!isNaN(retryAfterDate.getTime())) {
        const retryAfterMs = Math.max(0, retryAfterDate.getTime() - Date.now());
        console.log(`[${this.constructor.name}] Using retry-after header (HTTP-date): ${retryAfterMs}ms`);
        return retryAfterMs;
      }

      // Invalid header format - log warning and fall through to exponential backoff
      console.warn(`[${this.constructor.name}] Invalid retry-after header format: "${retryAfterHeader}". Falling back to exponential backoff.`);
    }

    // 2. Use longer base delay for overload errors (529)
    const effectiveBaseDelay = retryDecision.isOverload ? 3000 : baseDelay;

    // 3. Exponential backoff: baseDelay * 2^(attempt-1)
    const exponentialDelay = effectiveBaseDelay * (2 ** (attempt - 1));

    // 4. Add jitter (±20%) to prevent thundering herd
    const jitterFactor = 0.8 + (Math.random() * 0.4); // Random between 0.8 and 1.2
    const delayWithJitter = Math.floor(exponentialDelay * jitterFactor);

    return delayWithJitter;
  }

  /**
   * Determine if an error should trigger a retry
   * @param {Error} error - Error from API call
   * @returns {object} Retry decision with { shouldRetry, isOverload, isRateLimit }
   */
  shouldRetry(error) {
    if (!error) {
      return { shouldRetry: false, isOverload: false, isRateLimit: false };
    }

    // OpenAI SDK: error.response.status
    // Anthropic SDK: error.status (APIError)
    // Network errors: error.code
    const status = error.response?.status || error.status;

    if (status) {
      const is529Overload = status === 529;
      const is429RateLimit = status === 429;
      const is5xxError = status >= 500;

      // Retry on rate limits (429), overload (529), or server errors (5xx)
      if (is429RateLimit || is529Overload || is5xxError) {
        return {
          shouldRetry: true,
          isOverload: is529Overload,
          isRateLimit: is429RateLimit,
        };
      }
    }

    // Retry on network timeouts and connection errors
    const retryableCodes = ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND'];
    if (error.code && retryableCodes.includes(error.code)) {
      return { shouldRetry: true, isOverload: false, isRateLimit: false };
    }

    return { shouldRetry: false, isOverload: false, isRateLimit: false };
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

export default VisionProvider;
