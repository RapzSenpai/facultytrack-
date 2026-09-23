# academic_years allowed duplicate year/semester rows

- **Area:** Database / constraints
- **Fixed in:** `supabase/migrations/004_fix_rls_and_constraints.sql`
- **Recorded:** 2026-09-23
- **Status:** FIXED ✅

## Problem

`academic_years` had no uniqueness guarantee on (year, semester). Two
rows for the same period could exist, and every "find the on-going
period" lookup (student dashboard, submit-evaluation function) picks
`years.find(...)` / `LIMIT`-style first match — with duplicates, which
row wins is undefined and evaluation gating can latch onto the wrong one.

## Fix

Guarded `ALTER TABLE academic_years ADD UNIQUE(year, semester)` wrapped
in a `DO $$ ... $$` block checking `pg_constraint` (re-runnable).

## Verification

Re-inserting an existing (year, semester) pair fails with 23505.
