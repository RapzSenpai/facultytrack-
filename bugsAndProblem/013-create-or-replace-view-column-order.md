# CREATE OR REPLACE VIEW failed: cannot insert columns mid-list (42P16)

- **Area:** Database / views (`admin_evaluations_anon`) — migration 012 apply failure
- **Fixed in:** `supabase/migrations/012_phase6_moderation_priority.sql` §5b
- **Recorded:** 2026-09-23
- **Status:** FIXED ✅

## Symptom

Applying migration 012 failed with:

```
ERROR: 42P16: cannot change name of view column "submitted_on" to "original_comment"
HINT:  Use ALTER VIEW ... RENAME COLUMN ... to change name of view column instead.
```

## Root cause

Phase 6 rebuilt `admin_evaluations_anon` with `CREATE OR REPLACE VIEW`,
inserting the five new moderation columns
(`original_comment`, `moderation_status`, `moderation_labels`,
`is_priority`, `priority_source`) **before** the existing last column
`submitted_on`. Postgres only allows `CREATE OR REPLACE VIEW` to
**append** new columns at the end of the list — it can never insert,
remove, reorder, or rename existing columns. With new columns before
`submitted_on`, Postgres interpreted the new list as "rename
submitted_on to original_comment" and refused.

Note: the SQL editor runs the whole file in one transaction, so the
failed run rolled back completely — nothing was half-applied.

## Fix

- `admin_evaluations_anon`: `DROP VIEW IF EXISTS` + `CREATE VIEW`.
  The view has no dependents (policies grant it, nothing references
  it in SQL), so drop-and-recreate is the correct re-runnable pattern
  for column-list changes.
- `faculty_evaluations_anon` kept `CREATE OR REPLACE`: its Phase 6
  rebuild preserves every column name and position (only the `comment`
  expression and the WHERE clause change), which is exactly what
  CREATE OR REPLACE supports.

## Verification

Full re-run of 012 applies cleanly; verification queries at the bottom
of the migration confirm both views expose the expected columns.

## Lesson

`CREATE OR REPLACE VIEW` is only safe when the column name/position
list is unchanged (appending at the end is allowed). Any structural
column change → drop and recreate the view. Write migrations that way
from the start so they stay re-runnable.
