// PRD v4.4.4: Login page JavaScript
// Fetch auth config from backend

let googleClientId;

async function initializeGoogleSignIn() {
  try {
    // Fetch Google Client ID from backend
    const response = await fetch('/api/auth/config');
    const config = await response.json();

    // Check if Google Client ID is configured
    if (!config.googleClientId) {
      const msg = window.i18next?.t('onboarding:login.errors.notConfigured') || 'Google Sign-In is not configured. Please contact support.';
      throw new Error(msg);
    }

    googleClientId = config.googleClientId;
    console.log('[login.js] Initializing Google Sign-In with client_id:', googleClientId);

    // Initialize Google Sign-In (single initialization via JS - no data attributes)
    // Note: Using redirect mode instead of popup for Safari compatibility
    window.google.accounts.id.initialize({
      client_id: googleClientId,
      callback: handleCredentialResponse,
      auto_select: false
    });
    console.log('[login.js] Google Sign-In initialized');

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
    const fallback = window.i18next?.t('onboarding:login.errors.loadFailed') || 'Failed to load sign-in. Please refresh the page.';
    showError(error.message || fallback);
  }
}

// Handle Google credential response
async function handleCredentialResponse(response) {
  console.log('[login.js] handleCredentialResponse called', response);
  const credential = response.credential;

  if (!credential) {
    console.error('[login.js] No credential in response');
    showError(window.i18next?.t('onboarding:login.errors.noCredential') || 'Sign-in failed - no credential received');
    return;
  }

  console.log('[login.js] Got credential, posting to /api/auth/google');
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

      // Map error codes to user-friendly messages (i18n)
      // Note: Unmapped codes (e.g., MISSING_CREDENTIAL, EMAIL_CONFLICT, INTERNAL_ERROR)
      // fall back to generic message via || operator
      const t = window.i18next?.t?.bind(window.i18next) || ((key, fallback) => fallback);
      const errorMessages = {
        'INVALID_TOKEN': t('onboarding:login.errors.invalidToken', 'Sign-in failed. Please try again.'),
        'TOKEN_EXPIRED': t('onboarding:login.errors.tokenExpired', 'Sign-in expired. Please try again.'),
        'EMAIL_UNVERIFIED': t('onboarding:login.errors.emailUnverified', 'Your Google email is not verified. Please verify your email and try again.'),
        'RATE_LIMIT_EXCEEDED': t('onboarding:login.errors.rateLimitExceeded', 'Too many sign-in attempts. Please wait a minute and try again.'),
        'SERVICE_UNAVAILABLE': t('onboarding:login.errors.serviceUnavailable', 'Google authentication is temporarily unavailable. Please try again later.')
      };

      const genericError = t('onboarding:login.errors.generic', 'Sign-in failed. Please try again.');
      const message = errorMessages[data.code] || data.error || genericError;
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
    showError(window.i18next?.t('onboarding:login.errors.networkError') || 'Network error. Please check your connection and try again.');
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
window.addEventListener('load', async () => {
  // PRD v7.0: Wait for i18n to initialize before UI rendering
  if (window.i18nReady) {
    await window.i18nReady;
  }

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
