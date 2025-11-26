import VisionProvider from './VisionProvider.js';

/**
 * Fallback Vision Provider
 * Wraps two vision providers and automatically falls back to secondary if primary fails
 */
class FallbackVisionProvider extends VisionProvider {
  /**
   * Create fallback provider
   * @param {VisionProvider} primaryProvider - Primary provider to try first
   * @param {VisionProvider} fallbackProvider - Fallback provider if primary fails
   */
  constructor(primaryProvider, fallbackProvider) {
    super();
    this.primary = primaryProvider;
    this.fallback = fallbackProvider;
    this.primaryName = primaryProvider.constructor.name.replace('Provider', '');
    this.fallbackName = fallbackProvider.constructor.name.replace('Provider', '');

    // Start with primary model - will be updated if fallback runs
    // This ensures parserVersion accurately reflects which model was actually used
    this.model = this.primary.model;
  }

  /**
   * Validate both providers' configurations
   * @throws {Error} If either provider's configuration is invalid
   */
  validateConfig() {
    console.log('[FallbackVisionProvider] Validating primary provider:', this.primaryName);
    this.primary.validateConfig();

    console.log('[FallbackVisionProvider] Validating fallback provider:', this.fallbackName);
    this.fallback.validateConfig();

    console.log('[FallbackVisionProvider] ✅ Both providers validated successfully');
  }

  /**
   * Determine if we should attempt fallback for this error
   * @param {Error} error - Error from primary provider
   * @returns {boolean} True if should try fallback
   */
  shouldFallback(error) {
    if (!error) {
      return false;
    }

    const status = error.response?.status || error.status;

    // Fallback for:
    // - 429 (rate limit)
    // - 529 (overload)
    // - 5xx (server errors)
    // - Network timeouts
    if (status) {
      return status === 429 || status === 529 || status >= 500;
    }

    // Network errors
    const retryableCodes = ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND'];
    return error.code && retryableCodes.includes(error.code);
  }

  /**
   * Analyze images using primary provider with fallback to secondary
   * @param {Array<string>} imageDataUrls - Base64 data URLs
   * @param {string} systemPrompt - System instructions
   * @param {string} userPrompt - User query
   * @param {object} schema - JSON schema for structured output
   * @param {object} options - Optional parameters
   * @param {Function} options.onProgressUpdate - Progress callback function(percentage, message)
   * @returns {Promise<object>} Structured extraction result
   */
  async analyze(imageDataUrls, systemPrompt, userPrompt, schema, options = {}) {
    let primaryError;
    const { onProgressUpdate } = options;

    // Try primary provider first
    try {
      console.log(`[FallbackVisionProvider] Attempting primary provider: ${this.primaryName}`);
      const result = await this.primary.analyze(imageDataUrls, systemPrompt, userPrompt, schema, options);
      console.log(`[FallbackVisionProvider] ✅ Primary provider succeeded: ${this.primaryName}`);
      return result;
    } catch (error) {
      primaryError = error;
      console.error(`[FallbackVisionProvider] Primary provider failed: ${this.primaryName}`, {
        message: error.message,
        status: error.status || error.response?.status,
      });

      // Check if we should attempt fallback
      if (!this.shouldFallback(error)) {
        console.error(`[FallbackVisionProvider] Error is not fallback-eligible. Throwing error.`);
        throw error;
      }
    }

    // Notify UI about fallback switch
    const fallbackMessage = `${this.primaryName} failed, switching to ${this.fallbackName}`;
    console.warn(`[FallbackVisionProvider] ⚠️  ${fallbackMessage}`);

    if (onProgressUpdate && typeof onProgressUpdate === 'function') {
      onProgressUpdate(45, fallbackMessage);
    }

    // Update model to reflect fallback provider before attempting
    // This ensures parserVersion is correct if fallback succeeds
    this.model = this.fallback.model;

    // Try fallback provider
    try {
      const result = await this.fallback.analyze(imageDataUrls, systemPrompt, userPrompt, schema, options);
      console.log(
        `[FallbackVisionProvider] ✅ Fallback provider succeeded: ${this.fallbackName} (${this.model}). ` +
        `Original error was: ${primaryError.message}`
      );

      // Update UI with success message
      if (onProgressUpdate && typeof onProgressUpdate === 'function') {
        onProgressUpdate(70, `AI analysis completed (${this.fallbackName})`);
      }

      return result;
    } catch (fallbackError) {
      console.error(`[FallbackVisionProvider] ❌ Fallback provider also failed: ${this.fallbackName}`, {
        message: fallbackError.message,
        status: fallbackError.status || fallbackError.response?.status,
      });

      // Both providers failed - throw composite error
      const compositeError = new Error(
        `Vision API fallback failed. Primary (${this.primaryName}): ${primaryError.message}. ` +
        `Fallback (${this.fallbackName}): ${fallbackError.message}`
      );
      compositeError.primaryError = primaryError;
      compositeError.fallbackError = fallbackError;
      throw compositeError;
    }
  }
}

export default FallbackVisionProvider;
