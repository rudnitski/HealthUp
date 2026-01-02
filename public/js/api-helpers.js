// public/js/api-helpers.js
// PRD v4.4.6: Frontend endpoint resolver for admin access pattern
// Routes admin users to /api/admin/* endpoints, regular users to /api/reports/*

/**
 * Get the appropriate reports endpoint based on user admin status
 * Uses window.authClient.getUser() which includes is_admin field
 *
 * @param {string} path - The path suffix (e.g., '/patients', '/:reportId')
 * @returns {string} Full endpoint path for API call
 *
 * Mapping:
 *   /patients              -> /api/admin/patients or /api/reports/patients
 *   /patients/:id/reports  -> /api/admin/patients/:id/reports or /api/patients/:id/reports
 *   /:reportId             -> /api/admin/reports/:reportId or /api/reports/:reportId
 *   /:reportId/original-file -> /api/admin/reports/:reportId/original-file or /api/reports/:reportId/original-file
 *   / or empty             -> /api/admin/reports or /api/reports
 */
window.getReportsEndpoint = function(path) {
  const user = window.authClient?.getUser();

  // Non-admin users use standard /api/reports/* endpoints
  if (!user?.is_admin) {
    // Special case: /patients/:id/reports maps to /api/patients/:id/reports (not /api/reports/patients/:id/reports)
    const patientsReportsMatch = path.match(/^\/patients\/([^/]+)\/reports$/);
    if (patientsReportsMatch) {
      return `/api/patients/${patientsReportsMatch[1]}/reports`;
    }
    return `/api/reports${path}`;
  }

  // Admin users: map paths to /api/admin/* endpoints (PRD v4.4.6 Section 6)
  const patterns = [
    // /patients -> /api/admin/patients
    { pattern: /^\/patients$/, admin: '/api/admin/patients' },
    // /patients/:id/reports -> /api/admin/patients/:id/reports
    { pattern: /^\/patients\/([^/]+)\/reports$/, admin: '/api/admin/patients/$1/reports' },
    // /:reportId/original-file -> /api/admin/reports/:reportId/original-file
    { pattern: /^\/([^/]+)\/original-file$/, admin: '/api/admin/reports/$1/original-file' },
    // /:reportId -> /api/admin/reports/:reportId (must be after original-file pattern)
    { pattern: /^\/([^/]+)$/, admin: '/api/admin/reports/$1' },
    // / or empty -> /api/admin/reports
    { pattern: /^\/?$/, admin: '/api/admin/reports' }
  ];

  for (const { pattern, admin } of patterns) {
    const match = path.match(pattern);
    if (match) {
      // Replace $1, $2, etc. with captured groups
      return admin.replace(/\$(\d+)/g, (_, i) => match[parseInt(i, 10)]);
    }
  }

  // Fallback: prepend /api/admin/reports to path
  return `/api/admin/reports${path}`;
};
