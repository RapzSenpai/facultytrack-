# email_verifications was readable/writable by anyone (including anon)

- **Area:** Database / RLS (`email_verifications` table) — security hole
- **Fixed in:** `supabase/migrations/006_phase1_foundation.sql` §5.12 — Phase 1
- **Recorded:** 2026-09-23
- **Status:** FIXED ✅

## Symptom

Anonymous (signed-out) visitors could SELECT, INSERT and UPDATE rows in
`email_verifications` — verification codes were exposed to the public.

## Root cause

Migration 002 created three "Anyone can ..." policies (`USING (true)` /
`WITH CHECK (true)`) on the table.

## Fix

All three policies dropped (verified first that no frontend code touches
this table). The table is now default-deny for clients; the service role
keeps full access where a future flow needs it.

## Verification

`SELECT policyname FROM pg_policies WHERE tablename = 'email_verifications'`
returns zero client policies; anon reads fail.
