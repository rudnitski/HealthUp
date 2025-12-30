# PRD v4.4.4: Authentication - Part 4: Frontend Auth UI + Route Protection

**Status:** Ready for Implementation
**Created:** 2025-12-27
**Updated:** 2025-12-30 (Peer review round 2 fixes applied)
**Author:** System (Claude Code)
**Target Release:** v4.4.4
**Part:** 4 of 4
**Depends On:** Part 1 (Schema), Part 2 (Auth Core), Part 3 (RLS Data Access)

---

## 1. Overview

### Purpose

Part 4 completes the authentication system by adding **user-facing UI and route protection**:

1. Login page (`login.html`) with Google Sign-In
2. Auth client library (`auth.js`) for session management across pages
3. User header component (logout button, avatar, display name)
4. Redirect handling (store return URL, redirect to login, return after auth)
5. SSE 401 handling (reconnect after session expiry)
6. Protected HTML routes (redirect unauthenticated users to login)

### Key Deliverable

**Visible authentication.** Users can now log in, see their name/avatar, and log out. Unauthenticated users are redirected to login page. Backend from Parts 1-3 is fully utilized.

### Success Criteria

✅ Login page functional with Google Sign-In
✅ Users redirected to login if not authenticated
✅ After login, users redirect back to original page
✅ User header shows avatar, name, logout button
✅ Logout clears session and redirects to login
✅ SSE (chat) handles 401 gracefully (redirects to login; chat history lost - acceptable for MVP)
✅ Multi-tab logout (logging out in one tab logs out others)

**Note**: SSE re-auth without data loss is deferred to future PRD (requires `sessionStorage` persistence of chat history).

### Critical Backend Prerequisites

**MUST COMPLETE BEFORE FRONTEND DEPLOYMENT:**

1. **Add `is_admin` and `admin_configured` fields to `/api/auth/me` endpoint** (see section 4.4)
   - File: `server/routes/auth.js`
   - Required for admin panel role check and configuration detection (section 4.3)
   - Without these fields, ALL users will see "Configuration Error" on admin panel
   - `is_admin`: Boolean indicating if user's email is in `ADMIN_EMAIL_ALLOWLIST`
   - `admin_configured`: Boolean indicating if `ADMIN_EMAIL_ALLOWLIST` is non-empty
   - Verification: `curl http://localhost:3000/api/auth/me -H "Cookie: healthup_session=<valid_session>"` should return both fields

---

## 2. Login Page

### 2.1 File: `public/login.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign In - HealthUp</title>
  <link rel="stylesheet" href="css/style.css">
  <link rel="stylesheet" href="css/login.css">

  <!-- Google Identity Services -->
  <script src="https://accounts.google.com/gsi/client" async defer></script>
</head>
<body class="login-page">
  <div class="login-container">
    <div class="login-card">
      <div class="login-header">
        <h1>Welcome to HealthUp</h1>
        <p>Sign in to access your lab reports</p>
      </div>

      <div class="login-body">
        <!-- Google Sign-In Button Container -->
        <!-- Note: We use JS initialize() method instead of data attributes to avoid double initialization -->
        <!-- The client_id is fetched from /api/auth/config dynamically -->
        <div id="google-signin-button"></div>

        <!-- Error Message -->
        <div id="error-message" class="error-message hidden">
          <span class="error-icon">⚠️</span>
          <span id="error-text"></span>
        </div>

        <!-- Loading State -->
        <div id="loading-message" class="loading-message hidden">
          <div class="spinner"></div>
          <span>Signing in...</span>
        </div>
      </div>

      <div class="login-footer">
        <p class="privacy-notice">
          <!-- Note: Remove privacy/terms links for MVP deployment or create placeholder pages -->
          <!-- By signing in, you agree to our
          <a href="/privacy.html">Privacy Policy</a> and
          <a href="/terms.html">Terms of Service</a>. -->
          HealthUp Lab Report Analysis
        </p>
      </div>
    </div>
  </div>

  <script src="js/login.js" type="module"></script>

  <!-- IMPORTANT: Do NOT load auth.js on login page -->
  <!-- auth.js calls requireAuth() which would create an infinite redirect loop -->
  <!-- This page is intentionally unauthenticated to allow users to sign in -->
</body>
</html>
```

---

### 2.2 File: `public/css/login.css`

**Note**: The purple gradient theme shown below is a placeholder. Adjust colors to match existing branding if needed.

```css
.login-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
}

.login-container {
  width: 100%;
  max-width: 420px;
  padding: 20px;
}

.login-card {
  background: white;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  overflow: hidden;
}

.login-header {
  text-align: center;
  padding: 40px 40px 20px;
}

.login-header h1 {
  margin: 0 0 8px;
  font-size: 28px;
  font-weight: 600;
  color: #1a1a1a;
}

.login-header p {
  margin: 0;
  font-size: 16px;
  color: #666;
}

.login-body {
  padding: 20px 40px 40px;
}

#google-signin-button {
  display: flex;
  justify-content: center;
  margin-bottom: 20px;
}

.error-message {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: #fee;
  border: 1px solid #fcc;
  border-radius: 8px;
  color: #c33;
  font-size: 14px;
  margin-top: 16px;
}

.error-message.hidden {
  display: none;
}

.error-icon {
  font-size: 18px;
}

.loading-message {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 16px;
  color: #666;
  font-size: 14px;
}

.loading-message.hidden {
  display: none;
}

.spinner {
  width: 20px;
  height: 20px;
  border: 3px solid #f3f3f3;
  border-top: 3px solid #667eea;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.login-footer {
  padding: 20px 40px;
  background: #f8f9fa;
  border-top: 1px solid #e9ecef;
}

.privacy-notice {
  margin: 0;
  font-size: 13px;
  color: #666;
  text-align: center;
}

.privacy-notice a {
  color: #667eea;
  text-decoration: none;
}

.privacy-notice a:hover {
  text-decoration: underline;
}

@media (max-width: 480px) {
  .login-card {
    border-radius: 0;
  }

  .login-header,
  .login-body,
  .login-footer {
    padding-left: 24px;
    padding-right: 24px;
  }
}
```

---

### 2.3 File: `public/js/login.js`

```javascript
// Fetch auth config from backend
let googleClientId;

async function initializeGoogleSignIn() {
  try {
    // Fetch Google Client ID from backend
    const response = await fetch('/api/auth/config');
    const config = await response.json();

    // Check if Google Client ID is configured
    if (!config.googleClientId) {
      throw new Error('Google Sign-In is not configured. Please contact support.');
    }

    googleClientId = config.googleClientId;

    // Initialize Google Sign-In (single initialization via JS - no data attributes)
    window.google.accounts.id.initialize({
      client_id: googleClientId,
      callback: handleCredentialResponse,
      auto_select: false,
      cancel_on_tap_outside: true
    });

    // Render the button
    window.google.accounts.id.renderButton(
      document.getElementById('google-signin-button'),
      {
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        shape: 'rectangular',
        logo_alignment: 'left',
        width: 320
      }
    );

  } catch (error) {
    console.error('Failed to initialize Google Sign-In:', error);
    showError(error.message || 'Failed to load sign-in. Please refresh the page.');
  }
}

// Handle Google credential response
async function handleCredentialResponse(response) {
  const credential = response.credential;

  showLoading();
  hideError();

  try {
    const apiResponse = await fetch('/api/auth/google', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ credential }),
    });

    const data = await apiResponse.json();

    if (!apiResponse.ok) {
      hideLoading();

      // Map error codes to user-friendly messages
      // Note: Unmapped codes (e.g., MISSING_CREDENTIAL, EMAIL_CONFLICT, INTERNAL_ERROR)
      // fall back to generic message via || operator
      const errorMessages = {
        'INVALID_TOKEN': 'Sign-in failed. Please try again.',
        'TOKEN_EXPIRED': 'Sign-in expired. Please try again.',
        'EMAIL_UNVERIFIED': 'Your Google email is not verified. Please verify your email and try again.',
        'RATE_LIMIT_EXCEEDED': 'Too many sign-in attempts. Please wait a minute and try again.',
        'SERVICE_UNAVAILABLE': 'Google authentication is temporarily unavailable. Please try again later.'
      };

      const message = errorMessages[data.code] || data.error || 'Sign-in failed. Please try again.';
      showError(message);
      return;
    }

    // Success - redirect to original page or dashboard
    const redirectTo = sessionStorage.getItem('auth_redirect') || '/index.html';
    sessionStorage.removeItem('auth_redirect'); // Clean up
    console.log('Logged in as:', data.user.display_name);
    window.location.href = redirectTo;

  } catch (error) {
    hideLoading();
    console.error('Login error:', error);
    showError('Network error. Please check your connection and try again.');
  }
}

function showError(message) {
  const errorDiv = document.getElementById('error-message');
  const errorText = document.getElementById('error-text');
  errorText.textContent = message;
  errorDiv.classList.remove('hidden');
}

function hideError() {
  const errorDiv = document.getElementById('error-message');
  errorDiv.classList.add('hidden');
}

function showLoading() {
  const loadingDiv = document.getElementById('loading-message');
  loadingDiv.classList.remove('hidden');

  // Disable Google button
  const googleButton = document.getElementById('google-signin-button');
  googleButton.style.pointerEvents = 'none';
  googleButton.style.opacity = '0.5';
}

function hideLoading() {
  const loadingDiv = document.getElementById('loading-message');
  loadingDiv.classList.add('hidden');

  // Re-enable Google button
  const googleButton = document.getElementById('google-signin-button');
  googleButton.style.pointerEvents = 'auto';
  googleButton.style.opacity = '1';
}

// Initialize when Google API is loaded
window.addEventListener('load', () => {
  // Wait for Google API to load
  const checkGoogleLoaded = setInterval(() => {
    if (window.google?.accounts?.id) {
      clearInterval(checkGoogleLoaded);
      initializeGoogleSignIn();
    }
  }, 100);
});

// Make handleCredentialResponse available globally for GSI callback
window.handleCredentialResponse = handleCredentialResponse;
```

---

## 3. Auth Client Library

### 3.1 File: `public/js/auth.js`

Central auth state management for all protected pages.

```javascript
/**
 * Auth Client Library
 * Handles authentication state management across all pages
 */

class AuthClient {
  constructor() {
    this.currentUser = null;
    this.isAuthenticated = false;
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
```

**Note**: This file is loaded as a classic script (with `defer`), not as an ES module. All exports go directly to `window` object for global access by other scripts.

---

### 3.2 Update `public/index.html` - Script Loading Strategy

**CRITICAL DECISION**: The existing codebase uses global variables (`window.ConversationalSQLChat`, `ReportsBrowser` object) that are referenced by an inline navigation script. Scripts with `type="module"` are deferred by default and execute AFTER classic scripts, which would break auth client access.

**MVP Strategy: Classic Scripts with Deferred Execution** (minimal changes, deterministic load order)

1. **Load `auth.js` as a CLASSIC script with `defer`** (loads async, executes in order)
2. **Add `defer` to ALL existing scripts** (ensures auth.js runs first)
3. **Access auth via global `window.authClient`** (exported in auth.js line 559)

Update the script tags at the bottom of `public/index.html`:

```html
<!-- CRITICAL: Vendor libraries MUST load first (other scripts depend on them) -->
<!-- All scripts use defer to ensure deterministic execution order -->
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js" defer></script>
<script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3.0.0/dist/chartjs-adapter-date-fns.bundle.min.js" defer></script>
<script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0/dist/chartjs-plugin-datalabels.min.js" defer></script>
<script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-zoom@2.0.1/dist/chartjs-plugin-zoom.min.js" defer></script>
<script src="https://cdn.jsdelivr.net/npm/hammerjs@2.0.8/hammer.min.js" defer></script>
<script src="https://cdn.jsdelivr.net/npm/marked@17/lib/marked.umd.min.js" defer></script>
<script src="https://cdn.jsdelivr.net/npm/dompurify@3/dist/purify.min.js" defer></script>

<!-- Load auth client AFTER vendors, BEFORE app scripts -->
<script src="js/auth.js" defer></script>

<!-- App scripts (run AFTER auth.js) -->
<script src="js/plotRenderer.js" defer></script>
<script src="js/unified-upload.js" defer></script>
<script src="js/chat.js" defer></script>
<script src="js/reports-browser.js" defer></script>
<script src="js/app.js" defer></script>
```

**Why This Works:**
- All `defer` scripts execute in document order after DOM is parsed
- **Execution order**: Vendors → Auth → App scripts (deterministic, no race conditions)
- Vendor libraries (Chart.js, DOMPurify, marked) load first and are available to app scripts
- `auth.js` runs after vendors, setting up `window.authClient` before app scripts
- App scripts can access both vendors and `authClient` synchronously
- Inline navigation script executes immediately but only registers a `DOMContentLoaded` listener. The listener's handler runs after DOMContentLoaded fires, which is AFTER all `defer` scripts have executed. Therefore, `window.authClient` and `window.authReady` are guaranteed to be available when the handler runs.

**Alternative (Not Recommended)**: Load `auth.js` as a module with `type="module"` and add `defer` to all other scripts. This works but mixes module and classic scripts unnecessarily.

**Future Migration Path** (post-MVP, optional):
- Convert all scripts to `type="module"` (remove `defer`, modules are always deferred)
- Refactor inline navigation script into `js/navigation.js` module
- Remove global assignments, use proper `import`/`export`

---

## 4. Protected Page Template

### 4.1 Update `public/js/app.js` (Dashboard/Main App)

**CRITICAL**: The existing `app.js` is a single IIFE that executes immediately (line 1: `(() => { ... })()`). We need to add auth check at the VERY TOP of this IIFE, before any DOM operations.

**Integration Strategy**: Add async auth check as the first statement inside the existing IIFE.

**Find this code** (current line 1):
```javascript
(() => {
  // Report viewing elements (shown when ?reportId= parameter is present)
  const fileMessageEl = document.querySelector('#file-message');
```

**Replace with**:
```javascript
// ==================== AUTH CHECK (MUST BE FIRST) ====================
// CRITICAL: Make the entire IIFE async to block initialization until auth completes
// This prevents race conditions where DOM operations run before auth check finishes
(async () => {
  // Wait for auth.js to complete authentication check
  // RACE CONDITION FIX: auth.js calls requireAuth() immediately when loaded,
  // and exposes window.authReady promise that resolves when auth completes.
  // All app scripts await this promise to prevent API calls before auth verification.
  const isAuthenticated = await window.authReady;
  if (!isAuthenticated) {
    // Not authenticated - auth.js already redirected to login
    // Stop all app execution
    return;
  }

  // User is authenticated - display user info in header
  const user = authClient.getUser();
  console.log('[app] Logged in as:', user.display_name);
  displayUserInfo(user);

  // ==================== APP INITIALIZATION (AUTH-GATED) ====================
  // ALL existing code runs here AFTER auth check succeeds
  // This ensures no UI flash or API calls happen before authentication

  function displayUserInfo(user) {
    // Add user menu to header using safe DOM methods (prevents XSS)
    const header = document.querySelector('.content-header-inner');
    if (!header) {
      console.warn('[app] Header element not found for user menu');
      return;
    }

    const userMenu = document.createElement('div');
    userMenu.className = 'user-menu';

    // Create avatar image with fallback for missing avatar_url
    const avatar = document.createElement('img');
    // Google OAuth always provides picture, but use fallback for defensive coding
    avatar.src = user.avatar_url || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23999"%3E%3Cpath d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/%3E%3C/svg%3E';
    avatar.alt = user.display_name;
    avatar.className = 'user-avatar';
    avatar.onerror = function() {
      // Fallback if avatar_url fails to load
      this.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23999"%3E%3Cpath d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/%3E%3C/svg%3E';
    };

    // Create user name span
    const userName = document.createElement('span');
    userName.className = 'user-name';
    userName.textContent = user.display_name; // textContent auto-escapes HTML

    // Create logout button
    const logoutBtn = document.createElement('button');
    logoutBtn.id = 'logout-btn';
    logoutBtn.className = 'btn-logout';
    logoutBtn.textContent = 'Logout';
    logoutBtn.addEventListener('click', () => authClient.logout());

    // Assemble user menu
    userMenu.appendChild(avatar);
    userMenu.appendChild(userName);
    userMenu.appendChild(logoutBtn);
    header.appendChild(userMenu);
  }

  // Report viewing elements (shown when ?reportId= parameter is present)
  const fileMessageEl = document.querySelector('#file-message');
```

**Why This Works:**
- Outer IIFE is now `async`, allowing `await window.authReady`
- `window.authReady` is a promise created by `auth.js` when it loads (before app scripts)
- `auth.js` immediately calls `requireAuth()` and stores the promise as `window.authReady`
- ALL app scripts (app.js, unified-upload.js, chat.js) await this SAME promise
- No race condition - auth check happens ONCE in auth.js, all scripts wait for same result
- If not authenticated, `return` statement stops execution before any DOM operations
- Prevents UI flash, unauthorized API calls, and 401 errors before redirect

---

### 4.2 Update `public/js/chat.js` (Chat Interface)

**Implementation Notes:**

The `chat.js` file uses a `ConversationalSQLChat` class with method `connectSSE(sessionId)` to establish the SSE connection. You need to modify this method to use auth-aware EventSource.

**Exact change location:** In `public/js/chat.js`, find the `connectSSE()` method (around line 363).

**Find this line:**
```javascript
this.eventSource = new EventSource(`/api/chat/stream?sessionId=${sessionId}`);
```

**Replace with:**
```javascript
this.eventSource = window.createAuthAwareEventSource(`/api/chat/stream?sessionId=${sessionId}`);
```

**Why this works:**
- `createAuthAwareEventSource()` is a global function provided by `auth.js` (loaded with `defer` before `chat.js`)
- It wraps `EventSource` with automatic 401 detection and redirect to login
- When SSE receives 401, the wrapper probes `/api/auth/me` to confirm auth failure, then triggers `authClient.handleUnauthorized()`
- This prevents the chat from hanging on expired sessions

**CRITICAL LIMITATION**: SSE re-auth will redirect to login, losing chat history. Chat state is in-memory (`sessionManager.js`) and will be lost on page reload. This is acceptable for MVP. Future enhancement: persist chat history to `sessionStorage` before redirect and restore after login.

---

### 4.3 Update `public/js/unified-upload.js` (Upload Interface)

**CRITICAL**: The existing `unified-upload.js` is an IIFE that executes immediately and makes API calls (e.g., checking Gmail auth status). We must gate all logic on `window.authReady`.

**Find this code** (current line 6):
```javascript
(() => {
  // Check if we're viewing a specific report (reportId in URL)
```

**Replace with**:
```javascript
(async () => {
  // ==================== AUTH CHECK (MUST BE FIRST) ====================
  // Wait for auth.js to complete authentication check before any initialization
  const isAuthenticated = await window.authReady;
  if (!isAuthenticated) {
    // Not authenticated - auth.js already redirected to login
    return;
  }

  // Check if we're viewing a specific report (reportId in URL)
```

**Also find the closing** at the end of the file:
```javascript
})();
```

This should remain unchanged (the async IIFE is self-invoking).

**Why This Change**:
- Prevents API calls to `/api/dev-gmail/status` before auth is verified
- Prevents DOM operations before auth check completes
- Uses same `window.authReady` promise as other scripts (single auth check)

---

### 4.4 Update `public/js/reports-browser.js` (Reports Browser)

**CRITICAL**: The `ReportsBrowser` object is defined at the top level and `init()` is called from the inline navigation script. We must ensure `init()` awaits `window.authReady` before making API calls.

**Current structure** (simplified):
```javascript
const ReportsBrowser = {
  initialized: false,

  async init() {
    this.bindEvents();
    await this.loadPatients();  // Makes API call to /api/reports/patients
    await this.loadReports();   // Makes API call to /api/reports
  },
  // ...
};
```

**Find this code** (current lines 5-9):
```javascript
  async init() {
    this.bindEvents();
    await this.loadPatients();
    await this.loadReports();
  },
```

**Replace with**:
```javascript
  async init() {
    // ==================== AUTH CHECK (MUST BE FIRST) ====================
    // Wait for auth.js to complete authentication check before any API calls
    const isAuthenticated = await window.authReady;
    if (!isAuthenticated) {
      // Not authenticated - auth.js already redirected to login
      return;
    }

    this.bindEvents();
    await this.loadPatients();
    await this.loadReports();
  },
```

**Why This Change**:
- Prevents `/api/reports/patients` and `/api/reports` calls before auth is verified
- `init()` is called from inline navigation script, which runs after DOMContentLoaded
- At that point, `window.authReady` is available (auth.js ran before navigation script)
- Uses same promise as other scripts (no redundant auth checks)

---

### 4.5 Update `public/admin.html` and `public/js/admin.js` (Admin Panel)

The admin panel also requires authentication protection.

**Update `public/admin.html` script tags:**

Add `auth.js` before existing scripts (use `defer` to match index.html loading strategy):

```html
<!-- Load auth client first with defer -->
<script src="/js/auth.js" defer></script>

<!-- Existing admin script with defer -->
<script src="/js/admin.js" defer></script>
```

**Update `public/js/admin.js`:**

**CRITICAL REFACTOR**: The current `admin.js` has substantial top-level code (DOM queries, event listeners, function definitions) that runs immediately on load. We must wrap ALL existing code in `initializeAdminPanel()` to prevent execution before auth checks complete.

**Implementation Strategy**:
1. Add async IIFE at top of file for auth + admin checks
2. Move ALL existing code (lines 4-617) into `initializeAdminPanel()` function
3. Call `initializeAdminPanel()` only after both checks pass

**Complete new structure**:

```javascript
// public/js/admin.js

// ==================== AUTH + ADMIN CHECKS (MUST BE FIRST) ====================
// CRITICAL: All existing code MUST be wrapped in initializeAdminPanel()
// to prevent execution before auth checks complete
(async function() {
  // Wait for auth.js to complete authentication check
  // Uses same window.authReady promise as app.js (prevents race conditions)
  const isAuthenticated = await window.authReady;
  if (!isAuthenticated) {
    // Not authenticated - auth.js already redirected to login
    return;
  }

  // User is authenticated - check admin role
  const user = authClient.getUser();
  console.log('[admin] Checking admin access for:', user.display_name);

  // CRITICAL: Check admin role
  // BACKEND REQUIREMENT: /api/auth/me MUST return is_admin and admin_configured fields
  // See "Backend Changes Required" section (4.6) for implementation details

  // Check 1: Backend configuration error (missing fields)
  if (user.is_admin === undefined || user.admin_configured === undefined) {
    console.error('[admin] Required fields missing from /api/auth/me response:', { is_admin: user.is_admin, admin_configured: user.admin_configured });

    document.body.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; height: 100vh; flex-direction: column; font-family: system-ui; text-align: center;">
        <h1 style="color: #c33; margin-bottom: 1rem;">⚠️ Configuration Error</h1>
        <p style="color: #666; margin-bottom: 2rem;">Admin role fields are missing. Please check backend configuration.</p>
        <p style="color: #888; font-size: 0.9em;">Contact administrator if this persists.</p>
      </div>
    `;

    return;
  }

  // Check 2: Admin allowlist not configured (ADMIN_EMAIL_ALLOWLIST is empty)
  if (!user.admin_configured) {
    console.error('[admin] Admin allowlist not configured - ADMIN_EMAIL_ALLOWLIST is empty');

    document.body.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; height: 100vh; flex-direction: column; font-family: system-ui; text-align: center;">
        <h1 style="color: #fa0; margin-bottom: 1rem;">⚙️ Admin Not Configured</h1>
        <p style="color: #666; margin-bottom: 1rem;">The admin panel is not set up yet.</p>
        <p style="color: #666; margin-bottom: 2rem;">Please add your email to <code>ADMIN_EMAIL_ALLOWLIST</code> environment variable.</p>
        <p style="color: #888; font-size: 0.9em;">Redirecting to dashboard...</p>
      </div>
    `;

    // Redirect to dashboard after 3 seconds
    setTimeout(() => {
      window.location.href = '/index.html';
    }, 3000);

    return;
  }

  // Check 3: User is not an admin (allowlist is configured but user not in it)
  if (!user.is_admin) {
    console.warn('[admin] Access denied - user is not in admin allowlist');

    document.body.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; height: 100vh; flex-direction: column; font-family: system-ui; text-align: center;">
        <h1 style="color: #c33; margin-bottom: 1rem;">⛔ Access Denied</h1>
        <p style="color: #666; margin-bottom: 2rem;">You do not have permission to access the admin panel.</p>
        <p style="color: #888; font-size: 0.9em;">Redirecting to dashboard...</p>
      </div>
    `;

    // Redirect to dashboard after 2 seconds
    setTimeout(() => {
      window.location.href = '/index.html';
    }, 2000);

    return;
  }

  // User is authenticated AND is admin - initialize admin panel
  console.log('[admin] Admin access granted for:', user.display_name);
  initializeAdminPanel();
})();

// ==================== ADMIN PANEL INITIALIZATION ====================
function initializeAdminPanel() {
  // ALL EXISTING CODE FROM CURRENT admin.js (lines 4-617) GOES HERE
  // This includes:
  // - State variables (pendingAnalytes, ambiguousMatches)
  // - DOM element queries (tabButtons, tabContents, etc.)
  // - Event listeners (tab switching, button clicks, etc.)
  // - All function definitions (switchTab, fetchPendingAnalytes, etc.)
  // - The init() function call at the end

  // State
  let pendingAnalytes = [];
  let ambiguousMatches = [];

  // DOM Elements
  const tabButtons = document.querySelectorAll('.admin-tab');
  const tabContents = document.querySelectorAll('.tab-content');
  // ... (all other DOM queries)

  // Tab Switching
  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      const tab = button.dataset.tab;
      switchTab(tab);
    });
  });

  // ... (all other existing code: functions, event handlers, etc.)

  // Initialize (this was at the bottom of current admin.js)
  async function init() {
    await fetchPendingAnalytes();
    await fetchAmbiguousMatches();
  }

  init(); // Call init at end of initializeAdminPanel()
}
```

**Why This Refactor is Required**:
- Current admin.js runs 600+ lines of code at top level (DOM queries, event listeners)
- Simple async IIFE at top won't stop this code from executing
- Must encapsulate ALL logic in `initializeAdminPanel()` function
- Only called after auth + admin checks pass
- Prevents DOM operations and API calls before authorization

**Note**: Apply the same pattern to any other protected pages. All pages that display user data must await `window.authReady` before initialization.

---

### 4.6 Backend Changes Required

The frontend admin role check (section 4.5) requires the `/api/auth/me` endpoint to return an `is_admin` field. This field must be computed server-side based on `ADMIN_EMAIL_ALLOWLIST`.

**File: `server/routes/auth.js`**

**Find this code** (current lines ~323-342):
```javascript
router.get('/me', requireAuth, async (req, res) => {
  // requireAuth already validated session and attached req.user

  // Fetch additional user details
  // Note: users table doesn't have RLS (yet), but using pool is fine here
  const result = await pool.query(
    `SELECT id, display_name, primary_email as email, avatar_url, created_at, last_login_at
     FROM users WHERE id = $1`,
    [req.user.id]
  );

  if (result.rows.length === 0) {
    return res.status(401).json({
      error: 'User not found',
      code: 'USER_NOT_FOUND'
    });
  }

  res.json({ user: result.rows[0] });
});
```

**Replace with**:
```javascript
router.get('/me', requireAuth, async (req, res) => {
  // requireAuth already validated session and attached req.user

  // Fetch additional user details
  // Note: users table doesn't have RLS (yet), but using pool is fine here
  const result = await pool.query(
    `SELECT id, display_name, primary_email as email, avatar_url, created_at, last_login_at
     FROM users WHERE id = $1`,
    [req.user.id]
  );

  if (result.rows.length === 0) {
    return res.status(401).json({
      error: 'User not found',
      code: 'USER_NOT_FOUND'
    });
  }

  const user = result.rows[0];

  // Compute admin status from ADMIN_EMAIL_ALLOWLIST
  // PRD v4.4.4: Required for frontend admin panel access control
  const adminEmails = (process.env.ADMIN_EMAIL_ALLOWLIST || '')
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(email => email.length > 0);

  user.is_admin = adminEmails.includes(user.email.toLowerCase());
  user.admin_configured = adminEmails.length > 0;

  res.json({ user });
});
```

**Why This Change:**
- Frontend admin.js checks `user.is_admin` to gate admin panel access
- `user.admin_configured` distinguishes "allowlist empty" from "user not in allowlist" for better UX
- Admin status is derived from environment variable (no DB schema change needed)
- Consistent with existing `requireAdmin` middleware logic (server/middleware/auth.js:221-236)
- When `ADMIN_EMAIL_ALLOWLIST` is empty:
  - `is_admin = false` for all users
  - `admin_configured = false` triggers "Admin Not Configured" message (not "Access Denied")

---

## 5. User Header Component

### 5.1 Add to `public/css/style.css`

```css
.user-menu {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-left: auto;
}

.user-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 2px solid #e0e0e0;
}

.user-name {
  font-size: 14px;
  font-weight: 500;
  color: #333;
}

.btn-logout {
  padding: 6px 14px;
  font-size: 13px;
  font-weight: 500;
  color: #555;
  background: white;
  border: 1px solid #d0d0d0;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-logout:hover {
  background: #e8e8e8;
  border-color: #ccc;
  color: #333;
}
```

---

## 6. HTML Route Protection (Post-MVP)

**Status**: **DEFERRED to PRD v4.4.5** (or later)

**Rationale for Deferral**:
- **NOT a security boundary** - Client-side `auth.js` + API middleware provide real protection
- **High blast radius** - Requires middleware reordering in `server/app.js` affecting all routes
- **Convenience-only feature** - Marginal UX benefit (prevents users without JS from seeing empty pages)
- **Low priority** - Modern browsers have JS enabled; edge case doesn't justify implementation risk

**Current MVP Protection Strategy** (Sufficient for Production):

1. **Client-side protection** (`auth.js`):
   - Validates session via `/api/auth/me` on every page load
   - Redirects unauthenticated users to `/login.html`
   - Preserves full URL (path + query + hash) via `sessionStorage` for post-login redirect

2. **API protection** (middleware):
   - All `/api/*` endpoints use `requireAuth` middleware
   - Validates session authenticity in database/cache
   - Returns 401 for expired/invalid sessions
   - Global fetch wrapper in `auth.js` intercepts 401 responses and redirects to login

3. **Result**: Unauthenticated users cannot access data, even if they view HTML files directly

**If Server-Side HTML Protection Needed in Future**:
- Create PRD v4.4.5 with detailed analysis of implementation trade-offs
- Requires reordering `express.static()` middleware in `server/app.js`
- Must implement real session validation (not just cookie presence check)
- Or consider this a non-goal if all modern browsers support JavaScript

---

## 7. Multi-Tab Logout Handling

### 7.1 Broadcast Channel API (Best Effort)

**Browser Support Status:**
- ✅ Chrome 54+, Firefox 38+, Edge 79+ (full support)
- ✅ Safari 15.4+ (added April 2022)
- ❌ Safari <15.4, IE 11 (no support)
- **MVP Decision**: Use BroadcastChannel with feature detection, NO fallback
- **Degraded behavior**: Older browsers only log out current tab (acceptable for MVP)
- **Future enhancement**: Add `localStorage` event fallback for broader compatibility (see implementation note below)

Sync logout across tabs using Broadcast Channel:

```javascript
// Add to public/js/auth.js

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
}
```

---

### 7.2 localStorage Fallback (Future Enhancement)

For broader browser compatibility, add this fallback implementation:

```javascript
// In AuthClient constructor:
constructor() {
  this.currentUser = null;
  this.isAuthenticated = false;

  // Try BroadcastChannel first (modern browsers)
  if (window.BroadcastChannel) {
    this.authChannel = new BroadcastChannel('auth_channel');
    this.authChannel.addEventListener('message', (event) => {
      if (event.data.type === 'LOGOUT') {
        window.location.href = '/login.html';
      }
    });
  } else {
    // Fallback to localStorage events (Safari <15.4, older browsers)
    console.warn('[auth] BroadcastChannel not supported, using localStorage fallback');
    window.addEventListener('storage', (event) => {
      if (event.key === 'auth_logout' && event.newValue) {
        window.location.href = '/login.html';
      }
    });
  }
}

// In logout():
async logout() {
  // ... existing logout logic ...

  if (response.ok) {
    this.currentUser = null;
    this.isAuthenticated = false;

    // Broadcast logout to other tabs
    if (this.authChannel) {
      // BroadcastChannel approach (modern browsers)
      this.authChannel.postMessage({ type: 'LOGOUT' });
    } else {
      // localStorage approach (fallback for older browsers)
      // Note: storage events don't fire in the tab that made the change,
      // so this only notifies OTHER tabs (current tab redirects normally)
      localStorage.setItem('auth_logout', Date.now().toString());
      setTimeout(() => localStorage.removeItem('auth_logout'), 100);
    }

    window.location.href = '/login.html';
  }
}
```

**How localStorage Fallback Works:**
- `storage` event fires in all tabs EXCEPT the one that modified localStorage
- Setting then removing `auth_logout` key triggers event in other tabs
- Current tab redirects normally (no self-event needed)
- Cross-browser compatibility: Works in all browsers with localStorage (IE8+)

**MVP Decision**: Skip this fallback. BroadcastChannel covers 95%+ of modern browsers.

---

## 8. Testing Strategy

### 8.1 Manual QA Checklist

**Login Flow:**
- [ ] Visit `/index.html` while not authenticated → redirects to `/login.html`
- [ ] Click "Continue with Google" → Google Sign-In dialog appears
- [ ] Select Google account → Login succeeds, redirects to `/index.html`
- [ ] User header shows avatar, name, logout button
- [ ] Refresh page → User still logged in (session persists)

**Logout Flow:**
- [ ] Click "Logout" button → Session cleared, redirects to `/login.html`
- [ ] Try to access `/index.html` → Redirects to login (not authenticated)
- [ ] Open second tab, logout in first tab → Second tab also logs out (multi-tab sync)

**Session Expiry:**
- [ ] Login, wait for session expiry (or set short TTL for testing)
- [ ] Click on any protected feature → Redirects to login with 401 error
- [ ] SSE chat: Start chat, expire session → Redirects to login (chat history lost - expected behavior)

**Error Handling:**
- [ ] Disconnect network, try to login → Shows "Network error" message
- [ ] Enter invalid Google token (simulate via dev tools) → Shows "Sign-in failed" message
- [ ] Rate limit login (make 10+ requests quickly) → Shows "Too many attempts" message

---

### 8.2 Automated Tests

```javascript
describe('Frontend Auth Flow', () => {
  test('unauthenticated user redirected to login', async () => {
    const response = await request(app).get('/index.html');
    // Depends on server-side protection or client-side redirect (manual check)
  });

  test('login sets session cookie', async () => {
    // Covered in Part 2 backend tests
  });

  test('logout clears session cookie', async () => {
    const session = await loginAsTestUser();
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', session);

    expect(res.headers['set-cookie'][0]).toContain('Max-Age=0');
  });

  test('401 on expired session', async () => {
    const expiredSession = await createExpiredSession();
    const res = await request(app)
      .get('/api/patients')
      .set('Cookie', `healthup_session=${expiredSession}`);

    expect(res.status).toBe(401);
  });
});
```

---

## 9. Deployment Checklist

### Pre-Deployment

- [ ] **CRITICAL BACKEND PREREQUISITE**: Add `is_admin` field to `/api/auth/me` (see "Critical Backend Prerequisites" in section 1 and implementation in section 4.4)
- [ ] All frontend files created (login.html, auth.js, login.js, login.css)
- [ ] **CRITICAL**: Update `index.html` to add `defer` to ALL scripts AND include `chartjs-adapter-date-fns` (see section 3.2)
- [ ] **CRITICAL**: Update `admin.html` to add `defer` to ALL scripts
- [ ] Google Client ID configured in `.env`
- [ ] Test Google OAuth flow in local environment
- [ ] Review all protected scripts await `window.authReady` (app.js, unified-upload.js, reports-browser.js, chat.js, admin.js)
- [ ] Test admin role check (non-admin user accessing `/admin/pending-analytes` should see access denied)
- [ ] Test multi-tab logout
- [ ] Remove or replace privacy/terms links in login.html footer

### Deployment Steps

**Phase 1: Frontend Files**
1. **Create new files**:
   - `public/login.html` (no `g_id_onload` data attributes - JS initialization only)
   - `public/js/auth.js` (classic script, no ES module exports, sets `window.authClient`)
   - `public/js/login.js` (uses sessionStorage for redirect handling, single GSI init)
   - `public/css/login.css`

2. **Update `public/index.html`**:
   - Add `defer` attribute to ALL existing `<script>` tags
   - Add `<script src="js/auth.js" defer></script>` AFTER vendor scripts, BEFORE app scripts
   - **Order matters**: vendors → auth.js → app scripts (plotRenderer, unified-upload, chat, reports-browser, app)

3. **Update `public/admin.html`**:
   - Add `<script src="/js/auth.js" defer></script>` BEFORE admin.js
   - Add `defer` attribute to admin.js script tag

4. **Update existing JS files** (use global `window.authClient` and `window.authReady`):
   - `app.js`: Add async IIFE auth check at top (see section 4.1 for exact code)
   - `chat.js`: Use `createAuthAwareEventSource()` for SSE (see section 4.2)
   - `unified-upload.js`: Add async IIFE auth check at top (see section 4.3 for exact code)
   - `reports-browser.js`: Add auth check in `init()` method (see section 4.4 for exact code)
   - `admin.js`: Add async IIFE auth check + admin role check (see section 4.5 for exact code)

**Phase 2: Validation**
5. **Test Google OAuth**: Full login flow end-to-end
6. **Test 401 handling**: Simulate expired session, verify redirect to login
7. **Test SSE 401**: Expire session during chat, verify redirect (chat history will be lost - acceptable)
8. **Test deep links**: Verify client-side deep link restoration (path + query + hash via sessionStorage)

### Post-Deployment Validation

- [ ] Login flow works (Google Sign-In → Dashboard)
- [ ] Logout flow works (clears session, redirects to login)
- [ ] Unauthenticated users redirected to login (client-side via auth.js)
- [ ] User header displays avatar, name, logout button
- [ ] Admin role check works (non-admin user sees "Access Denied" on `/admin/pending-analytes`)
- [ ] Session persists across page refreshes
- [ ] Multi-tab logout works (broadcast channel syncs tabs)
- [ ] SSE chat handles 401 gracefully (redirects to login; chat history loss is expected)
- [ ] Deep link restoration works (client-side sessionStorage preserves full URL including hash)
- [ ] Privacy/terms links removed or replaced with actual pages

---

## 10. Success Metrics

**Functional:**
- 100% of protected pages require authentication
- Login success rate >95% (excluding user errors like unverified email)
- Session persistence: >90% of users don't need to re-login within 14 days
- Multi-tab logout: 100% of tabs log out within 2 seconds

**User Experience:**
- Login completion time: <5 seconds (from button click to dashboard load)
- Zero "stuck in redirect loop" issues (proper sessionStorage handling)
- Error messages are user-friendly (no raw HTTP errors shown)

---

## 11. What's Next?

**Post-MVP Enhancements (Future PRDs):**
- **SSE chat persistence** (sessionStorage-based chat history backup/restore on re-auth)
- Apple Sign In (PRD v4.5)
- Email + Password authentication (PRD v4.6)
- Multi-session management UI (view/revoke active sessions)
- Account deletion (GDPR compliance)
- 2FA/MFA (PRD v4.7)
- Password recovery flow (for email auth)
- Admin user roles/permissions

**Part 4 output**: Fully functional, user-facing authentication system. HealthUp is now ready for production deployment.
