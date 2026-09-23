# CREATE POLICY failed: referenced helper function did not exist yet (42883)

- **Area:** Database / migrations (013) — use-before-define ordering
- **Fixed in:** `supabase/migrations/013_phase7_super_admin_scoping.sql` §2/§3 reorder
- **Recorded:** 2026-09-23
- **Status:** FIXED ✅

## Symptom

Applying migration 013 failed with:

```
ERROR: 42883: function public.is_super_admin() does not exist
HINT:  No function matches the given name and argument types.
```

## Root cause

The migration defined the D9 helper functions (§3) **after** the
`admin_program_assignments` policies (§2) that reference them.
Unlike SQL function bodies (parsed only, name-resolved at execution),
`CREATE POLICY` **validates referenced functions at creation time** —
so the very first policy using `is_super_admin()` failed. The failed
run rolled back fully (single transaction), leaving nothing
half-applied.

## Fix

Reordered the migration: helpers are now §2, immediately after the
role constraint and before `admin_program_assignments` and every
policy that calls them. Verified with grep that no `CREATE POLICY`
precedes its helper definitions.

## Verification

Full re-run of 013 applies cleanly; the verification queries at the
bottom of the migration confirm helpers + policies exist.

## Lesson

Inside one migration: **helpers first, then tables, then policies**
(the reverse of typical prose order). CREATE POLICY resolves function
references eagerly; SQL-function bodies do not — the two rules are
easy to confuse.
