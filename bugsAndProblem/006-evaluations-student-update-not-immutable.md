# Submitted evaluations could be edited via the API

- **Area:** Database / RLS (`evaluations` table)
- **Fixed in:** `supabase/migrations/006_phase1_foundation.sql` §5.3 — Phase 1
- **Recorded:** 2026-09-23
- **Status:** FIXED ✅

## Symptom

A student could tamper with an already-submitted evaluation (change
ratings or the comment) using a direct API call after submitting.

## Root cause

Migration 002's "Students can update own evaluations" policy allowed
UPDATE wherever `student_id = auth.uid()`. The UI treated submissions as
read-only, but RLS is the wall — UI-only rules are cosmetic.

## Fix

Dropped the policy. Submissions are immutable for students at the data
layer; corrections flow through admin processes instead.

## Verification

A client-side UPDATE on own evaluation rows fails.
