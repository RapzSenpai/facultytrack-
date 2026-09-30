# SuperAdmin Revamp — FacultyTrack

## Direction (approved)
Superadmin oversees the whole system instead of repeating Admin day-to-day CRUD.
Principle: **govern, don't operate.** Full CRUD stays reachable through the
existing admin screens as fallback, but the main Superadmin workflow is
monitoring, user management, analytics, and reporting.

Assumptions: one Superadmin for now; all gates stay role-based
(`role = 'super_admin'`) so multiple Superadmins work later with zero rework.

## Reuse map (do not fork)
- `src/pages/admin/AdminReport.jsx` — charts, filters, teacher search, CSV.
  Reports shell reuses it via a shared `<ReportView department>` extract.
- `supabase/functions/export-report` — statistics-only export, already serves
  super. Used unchanged (D13: numbers only, no comments/identity).
- `log_admin_action` RPC (`018`) — audit writes exist; reads do not.
- `useScopedAdmin` / `isSuper` — super bypass already everywhere.
- recharts — already a dependency for analytics charts.

## Phase 1 — Audit read + Monitor viewer
- Prerequisite migration: super-only SELECT on `audit_log`
  (writes exist via `018`, reads are service-role-only today).
- New super-only Audit viewer: filter by actor, action, entity, date.
- Orphan/duplicate detectors (pure client reads, no new tables):
  program-less users/faculty, unowned criteria/periods (NULL department),
  duplicate department names, pending-approval aging queue across programs,
  moderation backlog counts.

## Phase 2 — Manage Users/Admins
- Extend `AdminProgramAssignments`: create/deactivate admin accounts,
  coverage map of departments with zero assigned admin (with alert),
  assignment history via audit log.
- Deferred: admin password reset needs a service-role edge function.
  Interim: deactivate + fresh invite.

## Phase 3 — Reports & Export (department cards)
- Super-only shell: department cards (faculty count + active academic year),
  click opens results for that department.
- Extract shared `<ReportView department>` from `AdminReport` so admin and
  super views never diverge; super shell passes a fixed department per card.
- Filters: teacher search, Academic Year, Semester, Evaluation Period.
- Export through existing `export-report` edge function.

## Phase 4 — Analytics
- Client aggregates over `admin_evaluations_anon` + users (D13-safe):
  evaluation response rates (denominator from enrollments/assignments),
  ratings per program charts, trends across released periods,
  moderation load overview.

## Execution rules
- Phase by phase, one phase per approval. No phase starts early.
- New nav: separate super-only "Oversight" section in `AdminLayout`;
  existing admin items untouched (CRUD fallback).
- Build must pass before each phase is declared done.
- Migrations run live in Supabase SQL editor + verification queries,
  same as 023–026.
