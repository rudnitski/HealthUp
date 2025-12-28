# PRD v4.4.4: Authentication - Part 4: Frontend Auth UI + Route Protection

**Status:** Ready for Implementation
**Created:** 2025-12-27
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
✅ SSE (chat) handles 401 gracefully (re-auth without data loss)
✅ Multi-tab logout (logging out in one tab logs out others)

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
        <!-- Google Sign-In Button (rendered by GSI) -->
        <div id="g_id_onload"
             data-client_id="GOOGLE_CLIENT_ID_PLACEHOLDER"
             data-callback="handleCredentialResponse"
             data-auto_prompt="false">
        </div>

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
          By signing in, you agree to our
          <a href="/privacy.html">Privacy Policy</a> and
          <a href="/terms.html">Terms of Service</a>.
        </p>
      </div>
    </div>
  </div>

  <script src="js/login.js" type="module"></script>
</body>
</html>
```

---

### 2.2 File: `public/css/login.css`

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
    const response = await fetch('/api/auth/config');
    const config = await response.json();
    googleClientId = config.googleClientId;

    // Update the data-client_id attribute
    const onloadDiv = document.getElementById('g_id_onload');
    onloadDiv.setAttribute('data-client_id', googleClientId);

    // Initialize Google Sign-In button
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
    showError('Failed to load sign-in. Please refresh the page.');
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
      // Store current URL for redirect after login
      sessionStorage.setItem('auth_redirect', window.location.pathname + window.location.search);
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
    sessionStorage.setItem('auth_redirect', window.location.pathname + window.location.search);
    window.location.href = '/login.html';
  }
}

// Global instance
const authClient = new AuthClient();

// Export for module usage
export default authClient;

// Also attach to window for non-module scripts
window.authClient = authClient;
```

---

## 4. Protected Page Template

### 4.1 Update `public/js/app.js` (Dashboard/Main App)

Add auth check at the top:

```javascript
import authClient from './auth.js';

// Check authentication before initializing app
(async function initApp() {
  // Require auth - will redirect to login if not authenticated
  const isAuthenticated = await authClient.requireAuth();

  if (!isAuthenticated) {
    return; // Redirecting to login
  }

  // User is authenticated - initialize app
  const user = authClient.getUser();
  console.log('Logged in as:', user.display_name);

  // Display user info in header
  displayUserInfo(user);

  // Continue with existing app initialization...
  initializeApp();
})();

function displayUserInfo(user) {
  // Add user menu to header using safe DOM methods (prevents XSS)
  const header = document.querySelector('header');
  const userMenu = document.createElement('div');
  userMenu.className = 'user-menu';

  // Create avatar image
  const avatar = document.createElement('img');
  avatar.src = user.avatar_url;
  avatar.alt = user.display_name;
  avatar.className = 'user-avatar';

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

// Global 401 handler - wrap fetch to intercept 401 responses
const originalFetch = window.fetch;
window.fetch = async function(...args) {
  const response = await originalFetch(...args);

  // Intercept 401 responses and redirect to login
  if (response.status === 401) {
    authClient.handleUnauthorized();
    // Return response anyway for caller to handle
  }

  return response;
};

/**
 * SSE (EventSource) 401 handler
 *
 * EventSource does not expose HTTP status codes directly.
 * When SSE receives 401, browser closes connection and fires 'error' event.
 *
 * Strategy: On error, probe auth status via fetch() to check if it's a 401.
 */
function createAuthAwareEventSource(url) {
  const eventSource = new EventSource(url);

  eventSource.addEventListener('error', async (event) => {
    // EventSource closed - could be 401, network error, or server restart
    if (eventSource.readyState === EventSource.CLOSED) {
      // Probe auth status by hitting a lightweight authenticated endpoint
      try {
        const authCheck = await fetch('/api/auth/me');
        if (authCheck.status === 401) {
          // The fetch wrapper will trigger handleUnauthorized() and redirect
          return;
        }
      } catch (err) {
        // Network error - different from auth failure
        console.error('SSE connection lost due to network error:', err);
      }
    }
  });

  return eventSource;
}

// Export for use in other modules (e.g., chat.js)
export { createAuthAwareEventSource };
```

---

### 4.2 Update `public/js/chat.js` (Chat Interface)

Use auth-aware EventSource:

```javascript
import authClient from './auth.js';
import { createAuthAwareEventSource } from './app.js';

// ... existing chat code ...

async function startChatSession() {
  // Check auth before starting chat
  await authClient.requireAuth();

  // Use auth-aware EventSource instead of raw EventSource
  const eventSource = createAuthAwareEventSource(`/api/chat/stream?sessionId=${sessionId}`);

  eventSource.addEventListener('message', (event) => {
    // Handle streaming response
  });

  // Error handling now includes 401 checks
  eventSource.addEventListener('error', (event) => {
    console.error('Chat connection error:', event);
  });
}
```

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

## 6. HTML Route Protection

### 6.1 Server-Side Route Protection (Optional)

Add middleware to redirect unauthenticated users at the server level:

```javascript
// File: server/middleware/htmlAuth.js

export function protectHTMLRoute(req, res, next) {
  const sessionId = req.cookies.healthup_session;

  // Allow login page and static assets
  if (req.path === '/login.html' || req.path.startsWith('/css/') || req.path.startsWith('/js/') || req.path.startsWith('/images/')) {
    return next();
  }

  // Redirect to login if no session cookie
  if (!sessionId) {
    return res.redirect('/login.html');
  }

  // Continue to serve HTML
  next();
}
```

Apply to static file serving:

```javascript
// server/app.js

import { protectHTMLRoute } from './middleware/htmlAuth.js';

// Protect HTML routes (but allow static assets)
app.use(protectHTMLRoute);
app.use(express.static('public'));
```

**Note**: Client-side redirect (auth.js) is primary mechanism. Server-side redirect is optional defense-in-depth.

---

## 7. Multi-Tab Logout Handling

### 7.1 Broadcast Channel API

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
- [ ] SSE chat: Start chat, expire session → Chat reconnects after re-auth

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

- [ ] All frontend files created (login.html, auth.js, login.js, CSS)
- [ ] Google Client ID configured in `.env`
- [ ] Test Google OAuth flow in local environment
- [ ] Review all protected pages have `authClient.requireAuth()` call
- [ ] Test multi-tab logout

### Deployment Steps

1. **Deploy frontend files**: `public/login.html`, `public/js/auth.js`, `public/js/login.js`, `public/css/login.css`
2. **Update existing pages**: Add `import authClient from './auth.js'` and `requireAuth()` call
3. **Verify Google OAuth**: Test full login flow end-to-end
4. **Test 401 handling**: Simulate expired session, verify redirect to login
5. **Test SSE 401**: Expire session during chat, verify reconnect

### Post-Deployment Validation

- [ ] Login flow works (Google Sign-In → Dashboard)
- [ ] Logout flow works (clears session, redirects to login)
- [ ] Unauthenticated users redirected to login
- [ ] User header displays avatar, name, logout button
- [ ] Session persists across page refreshes
- [ ] Multi-tab logout works
- [ ] SSE chat handles 401 gracefully

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
- Apple Sign In (PRD v4.5)
- Email + Password authentication (PRD v4.6)
- Multi-session management UI (view/revoke active sessions)
- Account deletion (GDPR compliance)
- 2FA/MFA (PRD v4.7)
- Password recovery flow (for email auth)
- Admin user roles/permissions

**Part 4 output**: Fully functional, user-facing authentication system. HealthUp is now ready for production deployment.
