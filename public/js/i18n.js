/**
 * i18n Client Library
 * PRD v7.0: Internationalization with English/Russian support using i18next
 */

(function() {
  'use strict';

  const STORAGE_KEY = 'healthup_locale';
  const SUPPORTED_LANGS = ['en', 'ru'];
  const FALLBACK_LANG = 'en';

  /**
   * i18n Helpers exposed globally
   */
  const i18nHelpers = {
    SUPPORTED_LANGS,
    FALLBACK_LANG,
    STORAGE_KEY,

    /**
     * Get current locale from storage or browser preference
     */
    getCurrentLocale() {
      // First check localStorage
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && SUPPORTED_LANGS.includes(stored)) {
        return stored;
      }

      // Fall back to browser language
      const browserLang = navigator.language?.split('-')[0];
      if (browserLang && SUPPORTED_LANGS.includes(browserLang)) {
        return browserLang;
      }

      return FALLBACK_LANG;
    },

    /**
     * Set locale and persist to localStorage
     * @param {string} locale - The locale to set ('en' or 'ru')
     * @returns {Promise<void>}
     */
    async setLocale(locale) {
      if (!SUPPORTED_LANGS.includes(locale)) {
        console.warn(`Unsupported locale: ${locale}, falling back to ${FALLBACK_LANG}`);
        locale = FALLBACK_LANG;
      }

      localStorage.setItem(STORAGE_KEY, locale);

      if (window.i18next && window.i18next.isInitialized) {
        await window.i18next.changeLanguage(locale);

        // Dispatch custom event for components to react
        window.dispatchEvent(new CustomEvent('localeChanged', { detail: { locale } }));
      }
    },

    /**
     * Get display name for a locale
     * @param {string} locale
     * @returns {string}
     */
    getLocaleDisplayName(locale) {
      const names = {
        'en': 'English',
        'ru': 'Русский'
      };
      return names[locale] || locale;
    }
  };

  /**
   * Initialize i18next with CDN plugins
   * @returns {Promise<void>}
   */
  async function initI18n() {
    // Wait for i18next and plugins to be available
    const maxWait = 5000; // 5 seconds max wait
    const startTime = Date.now();

    while (!window.i18next || !window.i18nextHttpBackend || !window.i18nextBrowserLanguageDetector) {
      if (Date.now() - startTime > maxWait) {
        throw new Error('i18next CDN scripts failed to load');
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    const currentLocale = i18nHelpers.getCurrentLocale();

    await window.i18next
      .use(window.i18nextHttpBackend)
      .use(window.i18nextBrowserLanguageDetector)
      .init({
        // Language settings
        lng: currentLocale,
        supportedLngs: SUPPORTED_LANGS,
        fallbackLng: FALLBACK_LANG,

        // Namespace settings
        ns: ['common', 'chat', 'upload', 'errors', 'onboarding', 'admin'],
        defaultNS: 'common',

        // Backend settings for loading translation files
        backend: {
          loadPath: '/locales/{{lng}}/{{ns}}.json'
        },

        // Detection settings
        detection: {
          order: ['localStorage', 'navigator'],
          lookupLocalStorage: STORAGE_KEY,
          caches: ['localStorage']
        },

        // Interpolation settings
        interpolation: {
          escapeValue: false // React/vanilla JS handles escaping
        },

        // Debug mode (disable in production)
        debug: false,

        // Return key if translation not found
        returnEmptyString: false,
        returnNull: false
      });

    console.log(`[i18n] Initialized with locale: ${window.i18next.language}`);
  }

  // Create the ready promise
  const i18nReadyPromise = initI18n().catch(err => {
    console.error('[i18n] Initialization failed:', err);
    // Don't throw - allow app to continue with English fallback
    return Promise.resolve();
  });

  // Expose globally
  window.i18nHelpers = i18nHelpers;
  window.i18nReady = i18nReadyPromise;
})();
