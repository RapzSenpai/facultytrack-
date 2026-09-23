# Any authenticated user could INSERT into `users` ("Service role inserts users")

- **Area:** Database / RLS (`users` table) — security hole
- **Fixed in:** `supabase/migrations/006_phase1_foundation.sql` §3e — Phase 1
- **Recorded:** 2026-09-23
- **Status:** FIXED ✅

## Symptom

No visible runtime error — a discovered **privilege-escalation path**.

## Root cause

Migration 002 shipped a policy named "Service role inserts users" with
`WITH CHECK (true)`. RLS policies cannot distinguish the service role
from ordinary clients (the service role simply bypasses RLS entirely),
so despite the name this policy allowed **any authenticated client** to
INSERT rows into `public.users` — including rows with `role = 'admin'`.

## Fix

Dropped the policy. Profile creation is handled exclusively by the
SECURITY DEFINER trigger `handle_new_user` (003/005), which does not
need a client-writable path. The table is now default-deny for INSERT.

Known cosmetic side effect (documented, intentional): `Login.jsx`'s
fallback profile-creation INSERT (dead code on a correctly migrated DB,
since the trigger always fires at signup) can no longer succeed.

## Verification

A client-side `supabase.from('users').insert({...})` fails; signup still
creates the profile via the trigger.
