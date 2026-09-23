# Edge Functions — Deploy Notes

## Hotfix (migration 010 — users RLS recursion, login 500)

Pre-existing bug from 002/004/006: SELECT policies on `users` queried
`users` inside themselves → Postgres "infinite recursion" → PostgREST
500 on every login (any role), then a 409 from Login.jsx's fallback
INSERT. No Edge Function involvement. Apply `010_hotfix_users_rls_recursion.sql`
in the SQL editor, then log in with any existing account to confirm the
fix (no 500/409 in the console).

## Phase 4 (migration 009 — student anonymity)

No Edge Function changes in this phase. Apply
`009_phase4_student_anonymity.sql` in the SQL editor, then release the
frontend build together with it (the faculty/admin pages switch to the
anonymous views in the same release — old frontend + new DB still works,
new frontend + old DB would make faculty/admin lists empty until the
views exist, so apply the migration first).

Smoke tests:
- Faculty results page still loads: ratings, comments, per-period stats.
  The "Students Evaluated" card now equals submitted forms (no identity).
- As faculty, in the browser console:
  `supabase.from('evaluations').select('student_id').limit(1)` → empty
  array (RLS default-deny), and
  `supabase.from('faculty_evaluations_anon').select('student_id')`
  → error (column does not exist).
- Admin dashboard/report still show participation counts and charts;
  dedupe works via the anonymous `student_token`.
- Student dashboard "already evaluated" state unchanged (own-row read).

## Phase 3 (migration 008 — admin-managed subject lists)

The `submit-evaluation` function now resolves the authorized list as:
**section match ∪ legacy confirmed enrollments − `excluded_assignments`**
(an `admin`/`exception` enrollment row fully governs: match − excluded).
Students can no longer write `student_enrollments` (migration 008 §5.5).

**Deploy order is flexible this phase:** the new function code handles both
the pre-008 DB (rows without the new columns — those read as NULL and are
ignored) and the post-008 DB. Recommended order anyway:

1. Apply `008_phase3_subject_lists.sql` in the SQL editor (verification
   queries at the bottom of the file).
2. Redeploy:
   ```
   supabase functions deploy submit-evaluation
   ```
3. Release the Phase 3 frontend build.

Smoke tests:
- Student: only their section's subjects appear; no Add Subject UI anywhere;
  submission to a subject outside the list is rejected (403 from the function).
- Profile: program/year/section are read-only; a direct API UPDATE of those
  columns fails the RLS WITH CHECK.
- Report an Issue → row in `subject_correction_requests` → admin resolves on
  `/admin/subject-corrections` → student sees status + note.
- Admin adjusts a student's list → student's evaluable list follows it
  immediately on both student pages.

## Phase 2 (migration 007 — school ID photos)

No Edge Function in this phase. Apply `007_phase2_id_photos.sql` in the
SQL editor (safe before or after the frontend release), then verify:

```sql
SELECT policyname FROM pg_policies
 WHERE schemaname='storage' AND tablename='objects'
   AND policyname ILIKE '%school ID%';   -- expect 4 policies
SELECT id, public, file_size_limit, allowed_mime_types
  FROM storage.buckets WHERE id='school-id-photos';  -- false / 5242880 / jpeg,png,webp
```

Smoke test: register with an ID photo (or upload on the pending-approval
page), then view it as admin in Approvals — and confirm the view created
an `id_photo.view` row: `SELECT action, created_at FROM audit_log ORDER BY created_at DESC LIMIT 5;`

## submit-evaluation

The only write path for `evaluations` (blueprint v3 §5.1). Direct client
INSERT is closed by migration `006_phase1_foundation.sql`.

The Supabase runtime auto-injects `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` — no secrets setup is required.

### Required deployment order (critical)

The frontend, the migration, and the function must move together:

1. **Deploy the function first**
   ```
   supabase functions deploy submit-evaluation
   ```
   (Run `supabase login` first if this machine has no stored access token.
   The project is already linked via `supabase/.temp/linked-project.json`.)

2. **Apply migration 006** — SQL editor or `supabase db push`.
   This closes the direct client INSERT. Old clients keep working because
   the function now handles submissions.

3. **Release the updated frontend** (the build that calls
   `functions.invoke('submit-evaluation')`).

Reverse order breaks submissions: migration first without the function
deployed means clients can neither insert directly nor call the function.

### Verification after deploy

- Submit an evaluation as a student — should succeed.
- Direct insert attempt via anon key against `evaluations` — must fail
  with an RLS error.
- `audit_log` should gain an `evaluation.submit` row per submission
  (only readable via service role).
