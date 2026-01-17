/**
 * Language Switcher Component
 * PRD v7.0: Dropdown component for language selection
 */

(function() {
  'use strict';

  /**
   * Initialize language switcher dropdown
   * @param {string} containerId - ID of the container element (optional, auto-detects if not provided)
   */
  function initLanguageSwitcher(containerId) {
    // Find the container
    let container = containerId
      ? document.getElementById(containerId)
      : document.querySelector('.language-switcher');

    if (!container) {
      console.warn('[language-switcher] Container not found');
      return;
    }

    // Create dropdown if it doesn't exist
    let dropdown = container.querySelector('.language-dropdown');
    if (!dropdown) {
      dropdown = createDropdown();
      container.appendChild(dropdown);
    }

    // Set current value
    const currentLocale = window.i18nHelpers?.getCurrentLocale() || 'en';
    dropdown.value = currentLocale;

    // Add change listener
    dropdown.addEventListener('change', async (e) => {
      const newLocale = e.target.value;
      if (window.i18nHelpers) {
        await window.i18nHelpers.setLocale(newLocale);
      }
    });

    // Listen for external locale changes
    window.addEventListener('localeChanged', (e) => {
      if (dropdown.value !== e.detail.locale) {
        dropdown.value = e.detail.locale;
      }
      updatePageTranslations();
    });
  }

  /**
   * Create the dropdown element
   * @returns {HTMLSelectElement}
   */
  function createDropdown() {
    const dropdown = document.createElement('select');
    dropdown.className = 'language-dropdown';
    dropdown.setAttribute('aria-label', 'Select language');

    const supportedLangs = window.i18nHelpers?.SUPPORTED_LANGS || ['en', 'ru'];

    supportedLangs.forEach(lang => {
      const option = document.createElement('option');
      option.value = lang;
      option.textContent = window.i18nHelpers?.getLocaleDisplayName(lang) || lang;
      dropdown.appendChild(option);
    });

    return dropdown;
  }

  /**
   * Update all elements with data-i18n attribute
   */
  function updatePageTranslations() {
    if (!window.i18next || !window.i18next.isInitialized) {
      console.warn('[language-switcher] i18next not initialized');
      return;
    }

    const elements = document.querySelectorAll('[data-i18n]');

    elements.forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (!key) return;

      // Handle different translation types
      const translationOptions = getTranslationOptions(el);
      const translated = window.i18next.t(key, translationOptions);

      // Check for attribute-specific translations
      const attrPrefix = 'data-i18n-';
      Array.from(el.attributes).forEach(attr => {
        if (attr.name.startsWith(attrPrefix)) {
          const targetAttr = attr.name.substring(attrPrefix.length);
          const attrKey = attr.value;
          const attrTranslated = window.i18next.t(attrKey, translationOptions);
          el.setAttribute(targetAttr, attrTranslated);
        }
      });

      // Set text content (unless element has data-i18n-html attribute)
      if (el.hasAttribute('data-i18n-html')) {
        el.innerHTML = translated;
      } else {
        // Preserve child elements (like icons)
        const childElements = Array.from(el.children);
        if (childElements.length > 0) {
          // Find text nodes and update them
          const textNode = Array.from(el.childNodes).find(
            node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()
          );
          if (textNode) {
            textNode.textContent = translated;
          } else {
            // Insert text after icons or at the beginning
            const iconElement = el.querySelector('i, svg, .icon');
            if (iconElement) {
              // Add space after icon if needed
              const nextSibling = iconElement.nextSibling;
              if (nextSibling && nextSibling.nodeType === Node.TEXT_NODE) {
                nextSibling.textContent = ' ' + translated;
              } else {
                iconElement.after(' ' + translated);
              }
            } else {
              el.textContent = translated;
            }
          }
        } else {
          el.textContent = translated;
        }
      }
    });

    // Update placeholders
    const placeholderElements = document.querySelectorAll('[data-i18n-placeholder]');
    placeholderElements.forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key) {
        el.placeholder = window.i18next.t(key);
      }
    });

    // Update titles
    const titleElements = document.querySelectorAll('[data-i18n-title]');
    titleElements.forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      if (key) {
        el.title = window.i18next.t(key);
      }
    });

    // Dispatch event for components that need custom handling
    window.dispatchEvent(new CustomEvent('translationsUpdated'));
  }

  /**
   * Get translation options from element data attributes
   * @param {HTMLElement} el
   * @returns {Object}
   */
  function getTranslationOptions(el) {
    const options = {};

    // Check for count (for pluralization)
    if (el.hasAttribute('data-i18n-count')) {
      const countAttr = el.getAttribute('data-i18n-count');
      // If it's a variable reference, try to resolve it
      if (countAttr.startsWith('{{') && countAttr.endsWith('}}')) {
        // This will be handled by interpolation
        options.count = parseInt(countAttr.slice(2, -2), 10) || 0;
      } else {
        options.count = parseInt(countAttr, 10) || 0;
      }
    }

    // Check for other interpolation values
    Array.from(el.attributes).forEach(attr => {
      if (attr.name.startsWith('data-i18n-var-')) {
        const varName = attr.name.substring('data-i18n-var-'.length);
        options[varName] = attr.value;
      }
    });

    return options;
  }

  /**
   * Translate a single key with options
   * Convenience wrapper for window.i18next.t
   * @param {string} key
   * @param {Object} options
   * @returns {string}
   */
  function t(key, options = {}) {
    if (!window.i18next || !window.i18next.isInitialized) {
      console.warn('[language-switcher] i18next not initialized, returning key');
      return key;
    }
    return window.i18next.t(key, options);
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      // Wait for i18n to be ready before initializing
      if (window.i18nReady) {
        window.i18nReady.then(() => {
          initLanguageSwitcher();
          updatePageTranslations();
        });
      }
    });
  } else {
    // DOM already loaded
    if (window.i18nReady) {
      window.i18nReady.then(() => {
        initLanguageSwitcher();
        updatePageTranslations();
      });
    }
  }

  // Expose globally
  window.languageSwitcher = {
    init: initLanguageSwitcher,
    updateTranslations: updatePageTranslations,
    t: t
  };
})();
