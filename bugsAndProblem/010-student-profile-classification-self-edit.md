# Students could edit their own program/year/section (list re-matching loophole)

- **Area:** Database / RLS (`users` UPDATE) + profile UI
- **Fixed in:** Phase 3 — `supabase/migrations/008_phase3_subject_lists.sql` §4,
  `src/pages/student/StudentProfile.jsx`
- **Recorded:** 2026-09-23
- **Status:** FIXED ✅

## Symptom

A student could open their profile, change department/year_level/section,
and instantly re-match into another section's subject list — then
evaluate classes they don't belong to. The submission function matches
on these fields, so the loophole defeated the section rules entirely.

## Root cause

005's "Users can update own profile safely" allowed any own-profile
column except role/status/approved_at. Classification fields were left
editable. Known interim gap, deliberately deferred from Phase 1
(renovation.md §7.1) so live flows wouldn't break early.

## Fix

- Migration 008 extends the policy's WITH CHECK to pin `department`,
  `year_level` and `section` to their existing values (same pattern as
  role/status). Admin updates go through "Admin can update any user".
- `StudentProfile.jsx` renders the three fields read-only with an
  explanatory note; self-save no longer sends them (mirrors the RLS).

## Verification

Student edit fails silently in the UI; a direct API UPDATE of those
columns violates the WITH CHECK (verification query at the bottom of 008).
