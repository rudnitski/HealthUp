const OpenAIProvider = require('./OpenAIProvider');
const AnthropicProvider = require('./AnthropicProvider');

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
}

module.exports = VisionProviderFactory;
