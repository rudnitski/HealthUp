// public/js/onboarding-redirect.js
// PRD v5.0: Onboarding redirect logic
// Loaded AFTER auth.js, BEFORE app.js or landing.js

(async () => {
  // Wait for auth to complete
  const isAuthenticated = await window.authReady;

  if (!isAuthenticated) {
    // User is not authenticated - auth.js will handle redirect to auth flow
    return;
  }

  // PRD v5.0: Skip onboarding for admin users - they don't need guided upload flow
  const user = window.authClient?.getUser();
  if (user?.is_admin) {
    console.log('[Onboarding] Admin user detected, skipping onboarding check');
    return;
  }

  try {
    const response = await fetch('/api/onboarding/status', {
      credentials: 'include'
    });

    if (!response.ok) {
      console.error('[Onboarding] Status check failed:', response.status);
      // On error, stay on current page to avoid redirect loops
      return;
    }

    const status = await response.json();
    const currentPath = window.location.pathname;

    if (status.is_new_user && currentPath !== '/landing.html') {
      // New user on main app - redirect to landing
      window.location.href = '/landing.html';
    } else if (!status.is_new_user && currentPath === '/landing.html') {
      // Existing user on landing - redirect to main app
      window.location.href = '/index.html#assistant';
    }
    // Otherwise, stay on current page

  } catch (error) {
    // Network errors, JSON parse errors, etc.
    console.error('[Onboarding] Status check error:', error);
    // CRITICAL: Do NOT redirect on error - stay on current page
    // This prevents redirect loops when the API is unavailable
  }
})();
