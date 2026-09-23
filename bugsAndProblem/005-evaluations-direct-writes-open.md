# Students could INSERT evaluations directly via the API

- **Area:** Database / RLS (`evaluations` table)
- **Fixed in:** `supabase/migrations/006_phase1_foundation.sql` §5.1 — Phase 1
- **Recorded:** 2026-09-23
- **Status:** FIXED ✅

## Symptom

The UI was fine, but a crafted API call (or modified client) could
insert an evaluation row directly — bypassing every rule the submission
flow enforces.

## Root cause

Migration 002's "Students can insert own evaluations" policy accepted
any row where `student_id = auth.uid()`. None of the real business
rules (active period, authorized subject list, duplicate guard, ratings
validation) are checkable from a plain RLS policy, so they were UI-only.

## Fix

Dropped the policy. Evaluations now have **exactly one write path**: the
`submit-evaluation` Edge Function using the service role, which
validates active student, on-going period + end date, assignment
authorization (section match ∪ legacy confirmed − admin exclusions),
duplicate guard, and ratings 1–5, then writes an `audit_log` row.
Direct client INSERT is default-deny. This is blueprint architecture
rule §4.2 — never reintroduce client writes.

## Verification

Direct client INSERT fails; submissions through
`functions.invoke('submit-evaluation')` succeed; a second submission for
the same subject returns 409.
