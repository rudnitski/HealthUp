# PRD v4.4.5: Authentication - Part 5: Server-Side HTML Route Protection (Post-MVP)

**Status:** Deferred (Post-MVP)
**Created:** 2025-12-30
**Author:** System (Claude Code)
**Target Release:** Post-MVP (v4.5.0 or later)
**Part:** 5 of 4+ (optional enhancement)
**Depends On:** Part 4 (Frontend Auth UI)

---

## 1. Overview

### Purpose

Add **optional server-side HTML route protection** to prevent unauthenticated users from viewing HTML pages without JavaScript enabled.

**CRITICAL CONTEXT**: This is a **convenience feature ONLY**, not a security boundary. Parts 1-4 already provide complete security:
- Client-side: `auth.js` validates sessions via `/api/auth/me`
- API-side: `requireAuth` middleware validates all data access

### Rationale for Deferral

This feature was originally part of PRD v4.4.4 but was deferred due to:
1. **Not a security boundary** - Only checks cookie presence, not session validity
2. **High blast radius** - Requires reordering middleware in `server/app.js`
3. **Low value** - Modern browsers have JS enabled; edge case benefit
4. **Complexity vs benefit** - Substantial implementation risk for marginal UX improvement

### Use Cases

**When This Feature Helps:**
- Users with JavaScript disabled see redirect instead of empty pages
- Search engine crawlers don't index protected page shells
- Network errors during page load fail more gracefully

**Why This is Optional:**
- 99%+ of users have JavaScript enabled
- Empty page shells contain no sensitive data
- API endpoints already protected (real security boundary)

---

## 2. Implementation Requirements

### 2.1 Server-Side Middleware

**File: `server/middleware/htmlAuth.js`** (new file)

```javascript
export function protectHTMLRoute(req, res, next) {
  // CRITICAL: Allow API routes to pass through (they have their own auth middleware)
  if (req.path.startsWith('/api/')) {
    return next();
  }

  // Allow login page
  if (req.path === '/login.html') {
    return next();
  }

  // Allow static assets (CSS, JS, images, fonts, favicon)
  if (req.path.startsWith('/css/') ||
      req.path.startsWith('/js/') ||
      req.path.startsWith('/images/') ||
      req.path.startsWith('/fonts/') ||
      req.path === '/favicon.ico') {
    return next();
  }

  // Check for session cookie (PRESENCE ONLY, NOT VALIDITY)
  const sessionId = req.cookies.healthup_session;
  if (!sessionId) {
    // Preserve original URL for redirect after login
    const returnUrl = encodeURIComponent(req.originalUrl);
    return res.redirect(`/login.html?redirect=${returnUrl}`);
  }

  // Session cookie present - continue to serve HTML
  next();
}
```

**Security Limitation:** This middleware only checks cookie **presence**, not authenticity or expiry. Anyone can set `healthup_session=fake` to bypass. Real protection happens in `auth.js` (client) and `requireAuth` (API).

---

### 2.2 Route Reordering in `server/app.js`

**BREAKING CHANGE WARNING**: This requires moving `express.static()` middleware, which can have subtle side effects on route precedence and 404 handling.

**Current Order** (PRD v4.4.4):
```javascript
// Line ~104
app.use(express.static(publicDir));

// Lines 180-188
app.use('/api/auth', authRouter);
app.use('/api/sql-generator', sqlGeneratorRouter);
// ... other API routers
```

**Required New Order**:
```javascript
// Mount API routers FIRST (bypass HTML protection)
app.use('/api/auth', authRouter);
app.use('/api/sql-generator', sqlGeneratorRouter);
app.use('/api/chat', chatStreamRouter);
app.use('/api/analyze-labs', analyzeLabReportRouter);
app.use('/api/execute-sql', executeSqlRouter);
app.use('/api/admin', adminRouter);
app.use('/api/dev-gmail', gmailDevRouter);
app.use('/api', reportsRouter);

// THEN mount HTML protection
app.use(protectHTMLRoute);

// THEN explicit HTML routes
app.get('/', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.get('/admin/pending-analytes', (_req, res) => {
  res.sendFile(path.join(publicDir, 'admin.html'));
});

// FINALLY static file serving
app.use(express.static(publicDir));
```

**Critical Route Ordering:**
1. API routers - have own auth, bypass HTML guard
2. `protectHTMLRoute` middleware - checks cookie for routes below
3. Explicit HTML routes - NOW protected
4. Static file serving - also protected
5. Health check / 404 handlers - at end

---

### 2.3 Frontend Changes

**Update `public/js/login.js`** to honor `?redirect=` query param:

```javascript
// In handleCredentialResponse function

// Success - redirect to original page or dashboard
const urlParams = new URLSearchParams(window.location.search);
const serverRedirect = urlParams.get('redirect'); // Server-side redirect
const clientRedirect = sessionStorage.getItem('auth_redirect'); // Client-side
const redirectTo = serverRedirect || clientRedirect || '/index.html';

sessionStorage.removeItem('auth_redirect');
window.location.href = redirectTo;
```

**Note on Hash Preservation:**
- Server-side redirects preserve **path + query only** (HTTP doesn't transmit hash to server)
- Client-side redirects (existing `auth.js`) preserve **full URL including hash**
- Full deep link restoration requires JavaScript (already implemented)

---

## 3. Testing Requirements

**Before Deployment:**
- [ ] Test login flow with server protection enabled
- [ ] Verify API endpoints still work (not blocked by HTML guard)
- [ ] Test static asset loading (CSS, JS, images)
- [ ] Verify `/api/` exclusion prevents login page from breaking
- [ ] Test `?redirect=` preservation (path + query, not hash)
- [ ] Compare behavior with JavaScript disabled vs enabled

**Regression Testing:**
- [ ] All existing auth flows (Google OAuth, logout, 401 handling)
- [ ] Multi-tab logout still works
- [ ] SSE chat still handles 401 correctly
- [ ] Admin panel access control unchanged

---

## 4. Decision Point: Implement or Defer Further?

Before implementing, evaluate:

### Option A: Implement with Real Session Validation

**Upgrade the middleware:**
- Query session cache/database to validate session authenticity
- Return 401 if session expired/invalid
- **Pros**: Becomes a real security layer
- **Cons**: Performance overhead (DB query per HTML request)

### Option B: Implement as-is (Cookie Presence Only)

**Keep lightweight middleware:**
- Only checks cookie presence (current spec)
- **Pros**: No performance impact
- **Cons**: Trivially bypassable (not a security feature)

### Option C: Do Not Implement

**Defer indefinitely:**
- Current client-side + API protection is sufficient
- Modern browsers have JS enabled
- Avoid middleware reordering complexity
- **Pros**: Zero risk, zero maintenance
- **Cons**: No graceful degradation for edge cases

**Recommendation**: **Option C** - Do not implement unless a specific use case emerges (e.g., crawler indexing concerns, accessibility requirements).

---

## 5. Success Criteria (If Implemented)

**Functional:**
- Unauthenticated users redirected to login (server-side)
- Login page accessible without session cookie
- API endpoints bypass HTML protection
- `?redirect=` parameter preserves return URL

**Non-Functional:**
- No performance degradation (<5ms overhead per HTML request)
- No regressions in existing auth flows
- Route ordering changes thoroughly tested

---

## 6. Future Enhancements (If Needed)

**Potential Improvements:**
1. Real session validation (query cache/DB)
2. Configurable via environment variable (`HTML_ROUTE_PROTECTION_ENABLED`)
3. Whitelist/blacklist patterns for protection
4. Metrics tracking (redirects due to missing cookie)

**Alternative Approach:**
- Use reverse proxy (nginx, Cloudflare Workers) for HTML protection
- Keeps Node.js middleware simple
- Better performance for high-traffic deployments

---

## 7. Notes

- This PRD exists to document the deferred feature, not to mandate implementation
- Parts 1-4 provide complete authentication without this feature
- Implement only if a clear business need emerges
- If implementing, thoroughly test middleware reordering (high blast radius)
