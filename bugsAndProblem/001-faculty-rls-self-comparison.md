# Faculty RLS policy compared a column to itself

- **Area:** Database / RLS (`users` table)
- **Fixed in:** `supabase/migrations/004_fix_rls_and_constraints.sql` (pre-renovation fix, kept for history)
- **Recorded:** 2026-09-23
- **Status:** FIXED ✅

## Symptom

The faculty SELECT policy on `users` did not actually restrict anything:
its WHERE clause compared the department column to itself, so the check
was vacuously true and the policy exposed rows it was never meant to.

## Root cause

The policy's inner query aliased the same table it was protecting and
compared `users.department` against itself instead of comparing the
**caller's** department against the **target row's** department.

## Fix

Migration 004 dropped and recreated
"Faculty can view faculty and students in same dept" with a correct
correlated EXISTS (caller is faculty AND department matches the target
row, students visible to same-department faculty).

## Verification

Faculty session sees own row + same-department users only.

## Note

This same policy later became recursion-prone (see
[012-users-rls-infinite-recursion](012-users-rls-infinite-recursion.md))
and was finally rewritten with SECURITY DEFINER helpers in migration 010.
