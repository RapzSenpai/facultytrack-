# Students picked their own subjects (self-enrollment) — design flaw

- **Area:** Enrollment flow / authorization — client Req 2, decision D5
- **Fixed in:** Phase 3 — `supabase/migrations/008_phase3_subject_lists.sql`,
  `supabase/functions/submit-evaluation/index.ts`,
  `src/pages/student/StudentDashboard.jsx`, `src/pages/student/StudentEvaluation.jsx`,
  new `src/pages/admin/AdminSubjectCorrections.jsx`
- **Recorded:** 2026-09-23
- **Status:** FIXED ✅

## Problem

Students chose their own subjects via an "Add Subject" modal and wrote
their own `student_enrollments` rows. Consequences: students could
evaluate subjects/classes they were never part of (the submission
function trusted confirmed enrollments), lists drifted from the
registrar's truth, and admins had no control or oversight.

## Client decision

D5: subjects are auto-assigned by program/year/section rules; students
report issues; admins correct lists. No self-enrollment.

## Fix

- Migration 008: student INSERT/UPDATE policies on `student_enrollments`
  dropped — the table is admin-write-only now (student SELECT on own
  rows kept for legacy display).
- All self-enrollment UI removed from the student pages; the evaluable
  list is now section match ∪ legacy confirmed − admin exclusions.
- `subject_correction_requests` table + "Report an Issue" card on the
  student side; queue + per-student subject editor (include/exclude,
  out-of-section additions for irregulars/retakes, Clear Overrides) on
  the new admin page.
- `submit-evaluation` re-derives the authorized list with the same
  semantics, so a forged client cannot submit to a non-listed subject.

## Verification

Smoke tests in `supabase/functions/README.md` (Phase 3 section): student
sees only their section's subjects, no Add Subject UI anywhere;
submission outside the list is rejected 403 by the function; report →
admin resolve → student sees status + note; admin adjustment reflects
immediately on both student pages.
