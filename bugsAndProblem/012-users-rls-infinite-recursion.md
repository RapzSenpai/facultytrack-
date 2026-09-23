# users RLS infinite recursion — login returned 500 for ALL roles

- **Area:** Database / RLS (`users` table) — total login outage
- **Fixed in:** `supabase/migrations/010_hotfix_users_rls_recursion.sql` (hotfix, 2026-09-23)
- **Recorded:** 2026-09-23
- **Status:** FIXED ✅

## Symptom

Logging in with any existing account (admin, faculty, student) failed:

```
GET /rest/v1/users?select=*&id=eq.<uid>  500 (Internal Server Error)
POST /rest/v1/users                      409 (Conflict)
Login.jsx:127 Profile creation error: 23505 duplicate key ... users_pkey
→ "User record not found and could not be created"
```

## Root cause

Three SELECT policies on `users` queried the `users` table inside their
own USING clauses (self-referencing EXISTS):

- 002 "Admin can view all users"
- 002 "Student can view own profile only"
- 006 "Faculty can view own and co-faculty profiles"

Postgres raises **"infinite recursion detected in policy"** at plan time,
and because all policies on a table are planned together, ONE recursive
policy broke ALL reads of `users` — including the plain own-profile read
AuthContext performs on every login. PostgREST surfaces that as HTTP 500.
The 409 afterwards was a secondary effect: Login.jsx's fallback
profile-creation INSERT (dead code on a correctly migrated DB) collided
with the profile row the signup trigger had already created.

## Fix

Migration 010 routes every role/department lookup in `users` policies
through **SECURITY DEFINER helper functions** (definer rights bypass
RLS, so recursion is structurally impossible — the same pattern 005
used for `is_admin()`):

- `is_faculty()` and `current_user_department()` added;
  `is_admin()` re-asserted as SECURITY DEFINER.
- "Admin can view all users" → `USING (is_admin())`
- Co-faculty policy → `id = auth.uid() OR (is_faculty() AND
  department = current_user_department())`
- "Student can view own profile only" dropped (fully redundant with
  "Users can view own profile": `auth.uid() = id`).

Re-runnable; no Edge Function changes.

## Verification

Log in with an existing account per role — the users SELECT returns the
row, no 500/409 in the console. Per-role scoping checks (student sees
only own row; faculty own + same-department faculty; admin all users)
are documented at the bottom of the migration file.

## Lesson

**Never subquery the same table a policy protects.** Put role lookups in
SECURITY DEFINER helpers from day one — and note the 500 error code is
misleading: it looked like a server fault but was a policy-authoring bug.
