const OpenAIProvider = require('./OpenAIProvider');
const AnthropicProvider = require('./AnthropicProvider');
const FallbackVisionProvider = require('./FallbackVisionProvider');

/**
 * Factory for creating vision provider instances
 */
class VisionProviderFactory {
  /**
   * Create a vision provider instance based on provider name
   * @param {string} providerName - Provider name ('openai' or 'anthropic')
   * @returns {VisionProvider} Provider instance
   * @throws {Error} If provider name is unknown
   */
  static create(providerName) {
    switch (providerName?.toLowerCase()) {
      case 'openai':
        return new OpenAIProvider();
      case 'anthropic':
        return new AnthropicProvider();
      default:
        throw new Error(`Unknown OCR provider: ${providerName}. Supported: openai, anthropic`);
    }
  }

  /**
   * Create a vision provider with automatic fallback support
   * Reads configuration from environment variables:
   * - OCR_PROVIDER: Primary provider ('openai' or 'anthropic')
   * - VISION_FALLBACK_ENABLED: Enable fallback (default: false)
   *
   * If fallback is enabled, creates a FallbackVisionProvider that:
   * - Tries primary provider first (with all retries)
   * - Falls back to alternative provider if primary exhausts retries
   *
   * @returns {VisionProvider} Provider instance (with or without fallback)
   * @throws {Error} If configuration is invalid
   */
  static createWithFallback() {
    const primaryProviderName = process.env.OCR_PROVIDER || 'openai';
    const fallbackEnabled = process.env.VISION_FALLBACK_ENABLED === 'true';

    // Create primary provider
    const primaryProvider = this.create(primaryProviderName);

    // If fallback disabled, return primary provider directly
    if (!fallbackEnabled) {
      return primaryProvider;
    }

    // Determine fallback provider (opposite of primary)
    const fallbackProviderName = primaryProviderName.toLowerCase() === 'openai' ? 'anthropic' : 'openai';

    console.log(`[VisionProviderFactory] Fallback enabled: ${primaryProviderName} → ${fallbackProviderName}`);

    try {
      // Create fallback provider
      const fallbackProvider = this.create(fallbackProviderName);

      // Wrap in FallbackVisionProvider
      return new FallbackVisionProvider(primaryProvider, fallbackProvider);
    } catch (error) {
      console.warn(
        `[VisionProviderFactory] Failed to create fallback provider (${fallbackProviderName}): ${error.message}. ` +
        `Continuing with primary provider only (${primaryProviderName}).`
      );
      return primaryProvider;
    }
  }
}

module.exports = VisionProviderFactory;
