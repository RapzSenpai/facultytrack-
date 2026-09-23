# Faculty (and admins) could read evaluations.student_id — anonymity broken

- **Area:** Database / RLS + views — client Req 11, architecture rule §4.6
- **Fixed in:** Phase 4 — `supabase/migrations/009_phase4_student_anonymity.sql`,
  `src/pages/faculty/FacultyDashboard.jsx`, `src/pages/faculty/FacultyEvalResult.jsx`,
  `src/pages/admin/AdminDashboard.jsx`, `src/pages/admin/AdminReport.jsx`
- **Recorded:** 2026-09-23
- **Status:** FIXED ✅

## Problem

Migration 002's "Faculty can view evaluations for own classes" granted
faculty SELECT on **full rows**, including `student_id` — so a faculty
member could correlate feedback with the student who wrote it. The same
policy's admin branch gave admins raw `student_id` too, against §4.6
("restricted by default"). Enforced at the data layer, not the UI.

## Fix

- Faculty base-table SELECT on `evaluations` **revoked** (default-deny).
- `faculty_evaluations_anon` view: ratings, comment, assignment/period,
  day-truncated `submitted_on` — **no `student_id` column exists**, and
  rows are pinned to `faculty_id = auth.uid()` inside the view WHERE.
- `admin_evaluations_anon` view: same shape plus `student_token`
  (per-row MD5 — preserves distinct-count semantics) and
  `student_department` (participation charts). Honest, documented
  limitation: md5 is accidental-leak protection, not cryptography; the
  audit-gated identity-reveal RPC arrives in Phase 7.
- Students keep a narrow own-row SELECT policy (their dashboard's
  "already evaluated" state needs it).
- Faculty "Students Evaluated" card now counts submitted forms;
  admin dashboards dedupe via the token.

## Verification

Console as faculty: `select('student_id')` on the base table → empty
(RLS), on the view → "column does not exist". Verification queries at
the bottom of 009; smoke tests in `supabase/functions/README.md`.
