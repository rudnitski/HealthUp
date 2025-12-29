// server/utils/sessionCache.js
// PRD v4.4.2: In-memory LRU cache for session data
// Reduces DB load by caching session lookups for 5 minutes

import { LRUCache } from 'lru-cache';

/**
 * Session cache configuration
 * - max: Maximum number of cached sessions (configurable via SESSION_CACHE_MAX)
 * - ttl: Time-to-live in milliseconds (5 minutes)
 *
 * Design decisions:
 * - 5-minute TTL: Balances performance with freshness (high cache hit rate for active users)
 * - LRU eviction: Automatically removes least-recently-used sessions when cache full
 * - No TTL extension on access: Cache entry expires 5min after creation, regardless of access
 * - Configurable max entries: Default 10k sessions (~10 sessions/user over 5min window)
 */
const cacheMax = parseInt(process.env.SESSION_CACHE_MAX) || 10000;

export const sessionCache = new LRUCache({
  max: cacheMax,
  ttl: 5 * 60 * 1000, // 5-minute TTL (300,000 ms)
  updateAgeOnGet: false, // Don't extend TTL on cache hit
  updateAgeOnHas: false,
});

/**
 * Invalidate session from cache (call on logout)
 * Ensures immediate logout effect even within cache TTL window
 *
 * @param {string} sessionId - Session ID to invalidate
 */
export function invalidateSession(sessionId) {
  sessionCache.delete(sessionId);
}

/**
 * Get cache statistics for monitoring
 * @returns {object} Cache statistics
 */
export function getCacheStats() {
  return {
    size: sessionCache.size,
    maxSize: cacheMax,
    ttlMs: 5 * 60 * 1000,
  };
}
