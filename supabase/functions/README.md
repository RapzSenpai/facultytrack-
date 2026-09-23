# Edge Functions — Deploy Notes

## Phase 7 (migration 013 + export-report — super admin & scoping)

`export-report` is deployed. After applying `013_phase7_super_admin_scoping.sql`,
provision the first super admin (see the snippet at the bottom of the migration):

```sql
UPDATE public.users SET role = 'super_admin' WHERE email = '<your-email>';
```

Smoke tests:
- Scoped admin (some programs assigned): Faculty/Student/Class Assignment/Report
  pages show ONLY their programs' rows; export contains only their faculty.
- Unassigned admin: program pages are empty [D9 strict].
- Super admin: sees everything; manages Program Assignments (/admin/program-assignments);
  changes take effect on the scoped admin's next page load (RLS filters live).
- Export CSV (AdminReport): scoped admin + super admin get a stats-only CSV;
  every export writes a `report.export` row to audit_log. Comments/identities
  never appear [D13].
- Reveal RPC: `reveal_student_identity(...)` works for super admin only and
  audit-logs each call; scoped admins get an error.

## Phase 6 (migration 012 + submit-evaluation redeploy — moderation & priority)

**Deploy order:**
1. Apply `012_phase6_moderation_priority.sql` in the SQL editor.
2. Redeploy the function (REQUIRED — replaces the moderation stub):
   ```
   supabase functions deploy submit-evaluation
   ```
3. Optional AI tier (DONE for this project): the classifier walks a
   candidate chain — `openai/gpt-oss-safeguard-20b` → `openai/gpt-oss-20b`
   on Groq (`GROQ_API_KEY`), then `gpt-4o-mini` on OpenAI (`OPENAI_API_KEY`)
   if set. llama-3.1-8b-instant was deprecated by Groq (June 2026).
   Keys live ONLY in function secrets — never in VITE_*. Without any key
   the function still works: wordlist-only verdicts + `unreviewed` labels.

Smoke tests:
- Add a `block` word (e.g. a profanity) in Admin → Moderation & Priority;
  submit a comment containing it → rejected with the re-edit message (422),
  nothing stored.
- Add a `flag` word; submit a comment with it → submission succeeds, row
  appears in Flagged Comments with the original text; Allow/Withhold works.
- Priority pill: OK/Cancel dialog → after submit, row in Priority Queue;
  Acknowledge → Resolve → faculty banner switches to "resolved" copy [D6].
- Rate limit: 3 priority submissions per student per period → 4th is rejected [REC].
- AI auto-priority: with GROQ_API_KEY set, a severe comment creates a
  priority review with source `ai`. Live-tested with the safeguard model:
  legit criticism → allow/low; profanity → block/high.
- Anonymity: faculty view must show comment NULL for flagged rows and no
  flagged/blocked row content anywhere, even after release.

## Phase 5 (migration 011 — result release gating)

No Edge Function changes. Apply `011_phase5_release_gating.sql`, then release the
frontend build (faculty/admin pages use the new views/tables in the same release).
The migration backfills all pre-existing periods as released, so history stays visible.

Smoke tests:
- Faculty dashboard: pending-release banner on the active (unreleased) period;
  "Mark as Submitted" grades toggle persists [D3]; historical periods render normally.
- Faculty results page: unreleased periods show "Results pending release" (with the
  period list), released periods render as before.
- Admin → Release Management: pick the active period, set a FUTURE date + approve →
  faculty still see nothing; after the date passes (or set today's date) results appear.
  Uncheck approve with a past date → hidden again (D4: passed date ≠ released).
- Console as faculty: `supabase.from('faculty_evaluations_anon').select('*')` returns
  only released periods' rows.

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
