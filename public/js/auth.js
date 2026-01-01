/**
 * Auth Client Library
 * PRD v4.4.4: Handles authentication state management across all pages
 */

class AuthClient {
  constructor() {
    this.currentUser = null;
    this.isAuthenticated = false;

    // Create broadcast channel for multi-tab sync
    if (window.BroadcastChannel) {
      this.authChannel = new BroadcastChannel('auth_channel');
      this.authChannel.addEventListener('message', (event) => {
        if (event.data.type === 'LOGOUT') {
          // Another tab logged out - redirect this tab too
          window.location.href = '/login.html';
        }
      });
    }
  }

  /**
   * Check if user is authenticated
   * Calls /api/auth/me to validate session
   *
   * Note: Calls API on every invocation to ensure fresh auth state.
   * Future optimization: Add TTL-based caching (trade-off: may miss expired sessions).
   */
  async checkAuth() {
    try {
      const response = await fetch('/api/auth/me');

      if (response.ok) {
        const data = await response.json();
        this.currentUser = data.user;
        this.isAuthenticated = true;
        return true;
      } else {
        this.currentUser = null;
        this.isAuthenticated = false;
        return false;
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      this.currentUser = null;
      this.isAuthenticated = false;
      return false;
    }
  }

  /**
   * Require authentication - redirect to login if not authenticated
   */
  async requireAuth() {
    const isAuth = await this.checkAuth();

    if (!isAuth) {
      // Store current URL for redirect after login (including hash for section navigation)
      sessionStorage.setItem('auth_redirect', window.location.pathname + window.location.search + window.location.hash);
      window.location.href = '/login.html';
      return false;
    }

    return true;
  }

  /**
   * Logout current user
   */
  async logout() {
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        this.currentUser = null;
        this.isAuthenticated = false;

        // Broadcast logout to other tabs
        if (this.authChannel) {
          this.authChannel.postMessage({ type: 'LOGOUT' });
        }

        window.location.href = '/login.html';
      } else {
        throw new Error('Logout failed');
      }
    } catch (error) {
      console.error('Logout error:', error);
      alert('Logout failed. Please try again.');
    }
  }

  /**
   * Get current user
   */
  getUser() {
    return this.currentUser;
  }

  /**
   * Handle 401 responses globally
   */
  handleUnauthorized() {
    this.currentUser = null;
    this.isAuthenticated = false;
    sessionStorage.setItem('auth_redirect', window.location.pathname + window.location.search + window.location.hash);
    window.location.href = '/login.html';
  }
}

// Global instance
const authClient = new AuthClient();

/**
 * Global 401 handler - wrap fetch to intercept 401 responses
 * This runs in auth.js (loaded first) to ensure ALL pages get 401 protection
 *
 * ARCHITECTURE NOTE: Unconditional redirect on 401 is intentional for MVP.
 * All 401s in this app mean "session expired" - no use case for feature-specific handling.
 * This WILL cancel in-flight operations (job polling, batch status checks, etc.) by redirecting
 * mid-request. This is acceptable: expired session means user must re-authenticate regardless.
 * If needed later, add opt-out via custom header: X-Suppress-Auth-Redirect
 */
const originalFetch = window.fetch;
window.fetch = async function(...args) {
  const response = await originalFetch(...args);

  // Intercept 401 responses and redirect to login
  if (response.status === 401) {
    authClient.handleUnauthorized();
  }

  return response;
};

/**
 * SSE (EventSource) 401 handler
 *
 * EventSource does not expose HTTP status codes directly.
 * When SSE receives 401, browser closes connection and fires 'error' event.
 *
 * Strategy: On ANY error, probe auth status to check if it's a 401.
 * This is more robust than checking readyState (some browsers retry silently).
 *
 * THROTTLING: Auth probes are rate-limited to prevent request storms during
 * rapid reconnection attempts. Max one probe per 5 seconds per EventSource.
 */
function createAuthAwareEventSource(url) {
  const eventSource = new EventSource(url);

  // Throttle auth probes to prevent request storms on rapid reconnection
  let lastAuthProbe = 0;
  const AUTH_PROBE_COOLDOWN_MS = 5000; // Max once per 5 seconds

  eventSource.addEventListener('error', async (event) => {
    // Check cooldown before probing auth
    const now = Date.now();
    if (now - lastAuthProbe < AUTH_PROBE_COOLDOWN_MS) {
      // Already probed recently - skip to prevent request storm
      console.debug('[SSE] Auth probe skipped - cooldown active');
      return;
    }
    lastAuthProbe = now;

    // Probe auth status on ANY error, regardless of readyState
    // If it's a 401, redirect immediately. Otherwise, let EventSource retry.
    try {
      const authCheck = await fetch('/api/auth/me');
      if (authCheck.status === 401) {
        // Session expired - trigger redirect
        authClient.handleUnauthorized();
        return;
      }
      // Not a 401 - likely network error or server restart
      // EventSource will handle reconnection automatically
    } catch (err) {
      // Network error - EventSource will retry
      console.error('SSE error - auth probe failed:', err);
    }
  });

  return eventSource;
}

/**
 * RACE CONDITION FIX (Peer Review Issue #1):
 * Execute auth check immediately when auth.js loads, BEFORE any app scripts run.
 * App scripts (app.js, unified-upload.js, chat.js) await this promise before initialization.
 * This prevents API calls from executing before auth state is verified.
 */
const authReadyPromise = authClient.requireAuth();

// Attach to window for global access (classic script strategy)
window.authClient = authClient;
window.authReady = authReadyPromise; // NEW: Promise that resolves when auth check completes
window.createAuthAwareEventSource = createAuthAwareEventSource;
