# PRD v4.4.6: Admin Access Pattern (Read-All Patients)

**Status:** Ready for Implementation  
**Created:** 2026-01-02  
**Author:** System (Codex)  
**Target Release:** v4.4.6  
**Depends On:** v4.4.2 Auth Core Backend, v4.4.4 Frontend Auth UI

---

## 1. Overview

### Purpose

Introduce a clear, industry-standard admin access boundary that allows an approved admin to view **all patients** in the UI while keeping RLS strictly enforced for non-admin users.

### Why This Pattern

- **Security boundary:** `/api/*` remains RLS-enforced; `/api/admin/*` explicitly bypasses RLS.
- **Auditability:** admin actions (read/write) are easy to log and review.
- **Maintainability:** admin code is isolated and harder to misuse accidentally.
- **Scalability:** future write actions can be added to the admin surface without touching user endpoints.

---

## 2. Goals

1. Admin users can view all patients and owner details in UI.
2. Regular users continue to see only their own patients (RLS enforced).
3. Admin endpoints require explicit authentication and admin authorization.
4. Admin read access is optionally auditable via `admin_actions`.

## 3. Non-Goals

- Admin role management UI.
- Multi-role permission system.
- Tenant-level scoping beyond current RLS model.

---

## 4. Access Model

### Phase 1 (MVP)

- Admins are defined via `ADMIN_EMAIL_ALLOWLIST` in `.env`.
- Server computes `user.is_admin` and `user.admin_configured` in `/api/auth/me`.
- UI uses only `user.is_admin` to show admin controls.

### Phase 2 (Future)

- Move admin roles into DB (`users.is_admin` or `user_roles` table).
- `requireAdmin` checks DB role instead of `.env` allowlist.
- Keep allowlist as temporary fallback during migration if needed.

---

## 5. API Design

### New Endpoint

**`GET /api/admin/patients`**

- **Auth:** `requireAuth` + `requireAdmin`
- **DB:** `queryAsAdmin()` (BYPASSRLS)
- **Returns:** All patients with owner email and report count

**SQL Example (server-side):**
```sql
SELECT
  p.id,
  p.full_name,
  p.date_of_birth,
  p.gender,
  p.user_id,
  p.last_seen_report_at,
  u.primary_email AS owner_email,
  u.display_name AS owner_name,
  COUNT(pr.id) AS report_count,
  MAX(pr.test_date_text) AS latest_test_date
FROM patients p
LEFT JOIN users u ON u.id = p.user_id
LEFT JOIN patient_reports pr ON pr.patient_id = p.id
GROUP BY p.id, u.primary_email, u.display_name
ORDER BY p.last_seen_report_at DESC NULLS LAST;
```

### Existing Endpoint (Unchanged)

**`GET /api/patients`** remains RLS enforced via `query()`.

---

## 6. Frontend Changes

1. On app init, call `/api/auth/me`.
2. If `user.is_admin === true`, display admin toggle.
3. When admin toggle is active, load patients from `/api/admin/patients`.
4. Display owner name, email, report count, last seen date, and latest test date in admin view.

**Important:** UI must not hardcode admin emails.

---

## 7. Audit Logging

### Read Actions (Optional but Recommended)

Log admin reads to `audit_logs`:
- `action_type`: `admin_view_patients`
- `entity_type`: `patients`
- `details`: `{ count, filters }`
- `user_id`: `req.user.id`

### Write Actions (Future)

All admin writes must log before/after changes to `audit_logs`.

---

## 8. Security Requirements

1. All `/api/admin/*` routes must be guarded by `requireAuth` and `requireAdmin`.
2. All admin routes must use `queryAsAdmin()` or `adminPool`.
3. Regular endpoints must never use `queryAsAdmin()`.
4. If `ADMIN_EMAIL_ALLOWLIST` is empty, admin access must be denied.

---

## 9. Acceptance Criteria

- Admin users can view all patients with owner details via `/api/admin/patients`.
- Non-admin users receive `403` from `/api/admin/patients`.
- Normal patient list is unchanged and still RLS-scoped.
- Admin UI toggle is visible only for `user.is_admin`.
- Admin view displays owner name, email, report count, last activity, and latest test date.
- Admin access is auditable via `audit_logs` (if logging enabled).

---

## 10. Implementation Notes

- Add new route to existing `server/routes/admin.js` (do not create a parallel admin router).
- Keep route ordering consistent with existing admin route patterns.
- Do not include PRD review history or comments in this file.
