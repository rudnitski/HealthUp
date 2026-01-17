/**
 * Formatters Library
 * PRD v7.0: Locale-aware date, number, and relative time formatting
 */

(function() {
  'use strict';

  /**
   * Get current locale for formatting
   * Falls back to 'en' if i18nHelpers not available
   */
  function getLocale() {
    return window.i18nHelpers?.getCurrentLocale() || 'en';
  }

  /**
   * Map our locale codes to Intl locale codes
   * @param {string} locale
   * @returns {string}
   */
  function toIntlLocale(locale) {
    const mapping = {
      'en': 'en-US',
      'ru': 'ru-RU'
    };
    return mapping[locale] || 'en-US';
  }

  /**
   * Format a date according to current locale
   * @param {Date|string|number} date - Date to format
   * @param {Object} options - Intl.DateTimeFormat options
   * @returns {string}
   */
  function formatDate(date, options = {}) {
    if (!date) return '';

    const dateObj = date instanceof Date ? date : new Date(date);
    if (isNaN(dateObj.getTime())) return '';

    const locale = toIntlLocale(getLocale());

    const defaultOptions = {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    };

    const mergedOptions = { ...defaultOptions, ...options };

    try {
      return new Intl.DateTimeFormat(locale, mergedOptions).format(dateObj);
    } catch (err) {
      console.error('[formatters] Date formatting error:', err);
      return dateObj.toLocaleDateString();
    }
  }

  /**
   * Format a date with time
   * @param {Date|string|number} date - Date to format
   * @param {Object} options - Additional Intl.DateTimeFormat options
   * @returns {string}
   */
  function formatDateTime(date, options = {}) {
    return formatDate(date, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      ...options
    });
  }

  /**
   * Format a date in short form (for charts, compact displays)
   * @param {Date|string|number} date
   * @returns {string}
   */
  function formatDateShort(date) {
    return formatDate(date, {
      year: '2-digit',
      month: 'short',
      day: 'numeric'
    });
  }

  /**
   * Format a date in long form
   * @param {Date|string|number} date
   * @returns {string}
   */
  function formatDateLong(date) {
    return formatDate(date, {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  /**
   * Format a number according to current locale
   * @param {number} value - Number to format
   * @param {Object} options - Intl.NumberFormat options
   * @returns {string}
   */
  function formatNumber(value, options = {}) {
    if (value === null || value === undefined || isNaN(value)) return '';

    const locale = toIntlLocale(getLocale());

    try {
      return new Intl.NumberFormat(locale, options).format(value);
    } catch (err) {
      console.error('[formatters] Number formatting error:', err);
      return String(value);
    }
  }

  /**
   * Format a number as decimal with specified precision
   * @param {number} value
   * @param {number} decimals - Number of decimal places
   * @returns {string}
   */
  function formatDecimal(value, decimals = 2) {
    return formatNumber(value, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  /**
   * Format a number as percentage
   * @param {number} value - Value between 0 and 1 (or 0-100 if already percentage)
   * @param {boolean} isRatio - If true, value is 0-1, if false, value is 0-100
   * @returns {string}
   */
  function formatPercent(value, isRatio = true) {
    const actualValue = isRatio ? value : value / 100;
    return formatNumber(actualValue, {
      style: 'percent',
      minimumFractionDigits: 0,
      maximumFractionDigits: 1
    });
  }

  /**
   * Format a relative time (e.g., "2 days ago", "in 3 hours")
   * @param {Date|string|number} date - Date to compare against now
   * @returns {string}
   */
  function formatRelativeDate(date) {
    if (!date) return '';

    const dateObj = date instanceof Date ? date : new Date(date);
    if (isNaN(dateObj.getTime())) return '';

    const locale = toIntlLocale(getLocale());
    const now = new Date();
    const diffMs = dateObj.getTime() - now.getTime();
    const diffSec = Math.round(diffMs / 1000);
    const diffMin = Math.round(diffSec / 60);
    const diffHour = Math.round(diffMin / 60);
    const diffDay = Math.round(diffHour / 24);
    const diffWeek = Math.round(diffDay / 7);
    const diffMonth = Math.round(diffDay / 30);
    const diffYear = Math.round(diffDay / 365);

    try {
      const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

      if (Math.abs(diffSec) < 60) {
        return rtf.format(diffSec, 'second');
      } else if (Math.abs(diffMin) < 60) {
        return rtf.format(diffMin, 'minute');
      } else if (Math.abs(diffHour) < 24) {
        return rtf.format(diffHour, 'hour');
      } else if (Math.abs(diffDay) < 7) {
        return rtf.format(diffDay, 'day');
      } else if (Math.abs(diffWeek) < 4) {
        return rtf.format(diffWeek, 'week');
      } else if (Math.abs(diffMonth) < 12) {
        return rtf.format(diffMonth, 'month');
      } else {
        return rtf.format(diffYear, 'year');
      }
    } catch (err) {
      console.error('[formatters] Relative time formatting error:', err);
      return formatDate(date);
    }
  }

  /**
   * Format file size in human readable form
   * @param {number} bytes
   * @returns {string}
   */
  function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    if (!bytes || isNaN(bytes)) return '';

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const size = bytes / Math.pow(k, i);

    return `${formatNumber(size, { maximumFractionDigits: i === 0 ? 0 : 1 })} ${units[i]}`;
  }

  // Expose formatters globally
  window.formatters = {
    formatDate,
    formatDateTime,
    formatDateShort,
    formatDateLong,
    formatNumber,
    formatDecimal,
    formatPercent,
    formatRelativeDate,
    formatFileSize,
    getLocale,
    toIntlLocale
  };
})();
