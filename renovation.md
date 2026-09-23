# FacultyTrack Renovation — Master Plan & Status

> Working document for the FacultyTrack renovation project. Any AI (or human) joining this
> codebase should read this file first. It records WHY changes are being made, WHAT the client
> decided, WHAT is done, and WHAT comes next. Update the status tables as work progresses.

---

## 1. What This Project Is

**FacultyTrack** — a faculty evaluation system for a college (CCTC). Students evaluate faculty
members per subject/semester; admins manage accounts, programs, subjects, class assignments,
academic periods, questionnaires, and reports.

**Stack:**
- React 19 + Vite SPA (`src/`), Bootstrap, Recharts, lucide-react icons
- **Supabase** as the entire backend: auth, Postgres, RLS, Storage, Edge Functions
- **No custom server.** Every DB call is client-side Supabase SDK; every real security rule
  lives in RLS policies and Edge Functions. React checks are UX only.
- Migrations: plain SQL files in `supabase/migrations/`, applied manually via Supabase SQL
  editor (numbered sequentially, 001–…). CLI is installed (2.117.0); project is linked.
- Roles today: `student`, `faculty`, `admin` (+ `super_admin` arriving in Phase 7).

**Core files map:**
| Path | Purpose |
|---|---|
| `src/App.jsx` | Routes, all wrapped in `ProtectedRoute` (client-side role gate) |
| `src/context/AuthContext.jsx` | Session + profile (`userProfile` object) |
| `src/config/supabase.js` | Supabase client (anon key) |
| `src/pages/Register.jsx` | Student/faculty self-registration |
| `src/pages/Login.jsx`, `PendingApproval.jsx` | Login + pending-account flow |
| `src/pages/student/StudentDashboard.jsx`, `StudentEvaluation.jsx` | Enrollment + evaluation submission |
| `src/pages/faculty/FacultyDashboard.jsx`, `FacultyEvalResult.jsx` | Faculty results views |
| `src/pages/admin/Admin*.jsx` | Admin CRUD pages; `AdminApprovals.jsx` = account approval |
| `supabase/migrations/*.sql` | Schema + RLS (001–007 so far) |
| `supabase/functions/` | Edge Functions (`submit-evaluation`); `README.md` = deploy notes |

---

## 2. Why "Renovation" — The 11 Client Requirements

The client requested 11 changes/features. Full analysis produced **Blueprint v3** (approved).
Requirements, with their final client-confirmed shape:

1. **School ID photo at registration** — required for students AND faculty, kept permanently.
2. **Remove "Add Subject"** — students get an admin-controlled subject list; self-enrollment dies.
3. **AI offensive-comment filtering** — hybrid (wordlist + AI classifier) at submission.
4. **Admin AI chatbox** — analysis of evaluation data via fixed pre-authorized queries (never
   raw DB access), with evidence and "AI-generated" labeling.
5. **Summarized comments** — on-demand AI summary, scope = one teacher / subject / period.
6. **AI responsibilities per role** — student: none; faculty: summaries + escalation notice;
   admin: analysis (scoped); super admin: all + audit.
7. **Result visibility gating** — results hidden until admin approval AND release date passed.
8. **Priority feedback** — student "Priority" pill + OK/Cancel dialog, AI auto-flag of serious
   comments, admin review queue, faculty gets a notice WITHOUT the comment content.
9. **Program Head role** — NOT a separate role; Program Head = Admin with a program assignment.
10. **Super Admin role** — new role value; exports reports (statistics only).
11. **Student anonymity** — faculty must never be able to read `student_id`; enforced at the
    data layer, not the UI.

---

## 3. Confirmed Client Decisions (authoritative — never redesign these)

Source: client questionnaire (Q1–Q7) + follow-ups (A1–A3).

| # | Decision |
|---|---|
| D1 | Summary scope = all comments about **one teacher, per subject, per evaluation period** |
| D2 | **No actual grades stored** — only a per-teacher "grades submitted" status flag |
| D3 | **Teachers mark their own** "grades submitted" status |
| D4 | Results visible only when **Admin approved AND release date passed**; a passed date without approval stays hidden |
| D5 | Subjects auto-assigned by program/year/section rules; students report issues **in-app and outside** the system; Admin corrects lists |
| D6 | Faculty receives **notice only** that a concern was escalated — never the priority comment |
| D7 | Priority cases handled by Admin |
| D8 | **No separate `program_head` role** — Program Head = Admin with a program assignment |
| D9 | **Admins/Program Heads see and manage ONLY their assigned program(s)** |
| D10 | Program Heads approve release for their program |
| D11 | **Admin + Super Admin** can export reports |
| D12 | ID photo required for **students AND faculty**; kept **permanently** (delete only on account rejection) |
| D13 | Exports = **statistics/numbers only** — no written comments, no AI summaries, no identity |

Conventions used everywhere: `[CLIENT]` = decided by client · `[REQ]` = original requirement ·
`[REC]` = technical recommendation (not client-confirmed).

---

## 4. Non-Negotiable Architecture Rules

1. **RLS is the wall.** Any new rule must be enforced by RLS policies and/or Edge Functions.
   Frontend checks are cosmetic.
2. **Evaluations have exactly one write path:** the `submit-evaluation` Edge Function
   (service role). Direct client INSERT is closed (migration 006). Never reintroduce client writes.
3. **AI provider keys live only in Edge Function secrets** — never in `VITE_*` env vars
   (everything in `VITE_*` is public).
4. **Postgres has no `CREATE POLICY IF NOT EXISTS`** — every `CREATE POLICY` in a migration must
   be wrapped in a `DO $$ ... $$` guard checking `pg_policies` (see 006/007 for the pattern).
   Migrations must be re-runnable.
5. **Deploy order matters** for migration 006-coupled releases: deploy Edge Function FIRST,
   then migration, then frontend. Documented in `supabase/functions/README.md`.
6. **Anonymity invariant:** `evaluations.student_id` must never be readable by faculty
   (and by admins by default; identity reveal only via audit-gated RPC, super admin only).
7. **Phase 5 release rule (explicit user instruction, overrides blueprint default):**
   `released = approved = true AND release_date IS NOT NULL AND release_date <= today`.
   A missing `release_date` NEVER counts as released.
8. Known lint baseline: 8 pre-existing errors + 2 warnings in untouched files (was 10+2
   before Phase 4 cleaned FacultyEvalResult's two; was 18+2 before Phase 3 cleaned the
   student pages) — they are NOT part of any phase; don't chase them, don't introduce
   new ones.

---

## 5. Phase Plan & Status

| Phase | Scope | Status |
|---|---|---|
| 1 | Foundation: audit_log, RLS hardening, submit-evaluation Edge Function, department_id backfill | **DONE** (DB applied + verified; function deployed; frontend released) |
| 2 | School ID photos (Req 1 / D12) | **DONE (code)** — Register.jsx blocker fixed + lint/build verified; user still needs to apply 007 + run smoke tests if not yet done |
| 3 | Remove Add Subject (Req 2 / D5) | **IN PROGRESS (code complete)** — awaiting 008 application + function redeploy + smoke tests |
| 4 | Student anonymity refactor (Req 11) | **DONE** (009 applied + verified) |
| 5 | Result release gating (Req 7 / D2–D4) | **IN PROGRESS (code complete)** — awaiting 011 application + smoke tests |
| 6 | Moderation + priority (Req 3, 8 / D6, D7) | **IN PROGRESS (code complete)** — awaiting 012 + function deploy + smoke tests |
| 7 | Super Admin + program scoping + exports (Req 9, 10 / D8–D11) | **IN PROGRESS (code complete)** — awaiting 013 + super-admin provisioning + smoke tests |
| 8 | AI chatbox + summaries + role separation (Req 4, 5, 6) | Not started |

---

### Phase 1 — Foundation ✅

**Delivered:**
- `supabase/migrations/006_phase1_foundation.sql`: `audit_log` table (no client policies;
  service-role writes only), `users.department_id` + `class_assignments.department_id` FKs with
  backfill from text names, RLS hardening.
- RLS hardening applied: evaluations direct INSERT closed; student UPDATE revoked; faculty
  `users` SELECT reduced to own row + co-faculty (no more reading students);
  `email_verifications` open policies dropped; **discovered hole closed**: migration 002's
  "Service role inserts users" (authenticated INSERT into `users`) dropped — profile creation
  is handled by the `handle_new_user` trigger.
- `supabase/functions/submit-evaluation/index.ts`: the only evaluation write path. Validates
  active student, on-going period + end date, assignment-in-period, authorized list (confirmed
  enrollment governs, else the same fuzzy dept/year/section match as the old UI), duplicate
  guard, ratings 1–5. Moderation STUBBED to allow (replaced in Phase 6). Writes `audit_log`.
- `src/pages/student/StudentEvaluation.jsx` switched to `functions.invoke("submit-evaluation")`.
- `eslint.config.js` repaired (plugin 5.2.0 broke `configs.flat` reference; now explicit flat
  registration) + `supabase/` ignored.

**Deliberate deferrals (do in their own phases, to avoid breaking live flows):**
- §5.4 assignments student-read restriction + §5.5 enrollment writes → **Phase 3**.
- §5.2 faculty identity-stripped view → **Phase 4**.

**Known interim gap (pre-existing, closed in Phase 3):** students can still edit their own
`department/year_level/section` profile fields and re-match into another section.

---

### Phase 2 — School ID Photos ✅ (code complete)

**Client basis:** Req 1 + D12. Photos required for students AND faculty at registration;
reviewed by admin; kept permanently; deleted only on account rejection; every admin view
audit-logged.

**RESOLVED:** the Register.jsx EOF parse blocker described below was fixed (missing `};`
after `handleIdPhotoChange` added); `npm run lint` shows Register.jsx clean and
`npm run build` passes. Remaining user steps (unchanged): apply `007_phase2_id_photos.sql`
via SQL editor + run the Phase 2 smoke tests in `supabase/functions/README.md`.

**Delivered (code):**
- `supabase/migrations/007_phase2_id_photos.sql`: `users.school_id_photo_path`; private Storage
  bucket `school-id-photos` (5 MB limit, jpeg/png/webp enforced server-side); 4 guarded storage
  policies (owner read/upload own folder `{auth.uid}/...`; admin read + delete via
  `is_admin()`); `log_id_photo_view(path)` SECURITY DEFINER RPC (admin-gated) writing an
  `id_photo.view` audit row.
- `src/utils/idPhoto.js`: shared `validateIdPhoto` (MIME + 5 MB, mirrors bucket limits) +
  `uploadSchoolIdPhoto(userId, file)` (uploads under own folder, records path on own users row).
- `src/pages/Register.jsx`: required ID-photo field on BOTH student/faculty tabs with preview;
  upload after `signUp` when a session exists; `photoPending` flag when email confirmation is on
  (no session at signup).
- `src/pages/Login.jsx`: pending users WITHOUT a photo keep their session and are sent to
  PendingApproval with `photoPending`; others signed out as before.
- `src/pages/PendingApproval.jsx`: upload card when the photo is missing (post-login
  contingency path); signs out after successful upload.
- `src/context/AuthContext.jsx`: exposes `schoolIdPhotoPath`.
- `src/pages/admin/AdminApprovals.jsx`: "ID Photo" column (View button / MISSING badge),
  signed-URL viewer modal (60s TTL) with audit RPC call before every view, reject flow deletes
  the stored photo before account deletion.
- `supabase/functions/README.md`: Phase 2 apply/verify/smoke-test notes.

**Remaining for Phase 2 completion (user steps):**
1. Apply `007_phase2_id_photos.sql` in SQL editor (verification queries are at the
   bottom of the file; expect 4 storage policies + bucket limits set).
2. Smoke tests (README): register with photo → admin views in Approvals →
   `id_photo.view` row in `audit_log`; reject → photo removed from bucket.

---

### Phase 3 — Remove "Add Subject" (Req 2 / D5) — code complete, 🚧 pending apply/smoke

**Delivered:**
- `supabase/migrations/008_phase3_subject_lists.sql` (re-runnable, guarded, verification
  queries at bottom):
  - `subject_correction_requests` (student_id, message, status new/resolved/dismissed,
    resolution_note, resolved_by/at) + RLS (student insert/select own; admin full via
    `is_admin()`) + indexes.
  - §5.5: student INSERT/UPDATE policies on `student_enrollments` dropped — the table is
    admin-write-only now. Student SELECT on own rows kept (legacy display).
  - §5.4: student SELECT on `class_assignments` restricted to own
    program/year/section (normalized-exact comparison; empty student fields match nothing).
  - Student self-edit lock: "Users can update own profile safely" now also pins
    `department`/`year_level`/`section` (closes the Phase 1 interim gap; §7.1).
- `supabase/functions/submit-evaluation/index.ts` (deploy AFTER applying 008, or before —
  the new code handles both pre- and post-008 DB shapes): authorized list =
  section match ∪ legacy confirmed − `excluded_assignments`; an `admin`/`exception`
  enrollment row fully governs (match − excluded).
- `src/pages/student/StudentDashboard.jsx`: all self-enrollment UI removed (Add Subject
  modal, confirm/remove handlers, enrollment mode); evaluable list = section match widened
  by legacy confirmed ids, narrowed by admin exclusions; "Admin" badge on adjusted rows.
- `src/pages/student/StudentEvaluation.jsx`: enrollment mode + Add Subject modal + "Edit
  Subjects" removed; same list semantics; **Report an Issue** card writes
  `subject_correction_requests` and shows the student's past reports with status + admin
  note. Also fixed a latent bug: post-submit row update now reads
  `data.evaluation.submitted_at` (the function's actual response shape).
- `src/pages/student/StudentProfile.jsx`: program/year/section rendered read-only with an
  explanatory note; self-save no longer sends those fields (mirrors the new RLS WITH CHECK).
- `src/pages/admin/AdminSubjectCorrections.jsx` (new, route `/admin/subject-corrections`,
  nav "Subject Corrections" in MANAGE EVALUATION): report queue (filter/search, resolve with
  note, dismiss) + per-student subject editor — pick period, preselects section match,
  include/exclude per assignment, add out-of-section subjects (irregular/retake),
  **Clear Overrides** (deletes the row → student reverts to plain section match),
  **Save Subject List** (upsert `enrollment_kind='admin'`), idempotent via the UNIQUE triple.

**Remaining for Phase 3 completion (user steps, in order):**
1. Apply `008_phase3_subject_lists.sql` in the SQL editor (verification queries at the
   bottom of the file).
2. Redeploy the function: `supabase functions deploy submit-evaluation`
   (safe before or after step 1 — see `supabase/functions/README.md`).
3. Smoke tests: (a) student sees only their section's subjects and no Add Subject UI;
   (b) student edit of program/year/section on the profile fails silently + RLS rejects
   a direct API attempt; (c) report an issue → appears in admin queue → resolve → student
   sees status + note; (d) admin adjusts a student's list → student's dashboard/evaluate
   page reflects it and submission to an excluded subject is rejected by the function.

### Phase 4 — Student Anonymity Refactor (Req 11) — code complete, 🚧 pending apply/smoke

**Delivered:**
- `supabase/migrations/009_phase4_student_anonymity.sql` (re-runnable, verification queries
  at the bottom):
  - Dropped "Faculty can view evaluations for own classes" (002) — faculty base-table SELECT
    on `evaluations` is gone (default-deny).
  - New narrow student policy "Students can view own evaluations"
    (`student_id = auth.uid()`; keeps the student pages' own-row read).
  - `faculty_evaluations_anon` view: id, faculty_id, assignment_id, academic_year, semester,
    ratings, comment, `submitted_on` (day-truncated) — **no `student_id` column exists**, and
    rows are pinned to `faculty_id = auth.uid()` in the view WHERE (owner-rights view, so it
    evaluates as the caller and is not affected by base-table RLS).
  - `admin_evaluations_anon` view (§4.6 default: admins are identity-restricted too):
    same shape plus `student_token` = `md5(student_id)` (preserves distinct-count semantics
    for participation stats) and `student_department` (program participation charts).
    Documented limitation: md5 is accidental-leak protection, not cryptography — Phase 7's
    audit-gated reveal RPC is the real identity gate.
  - `is_evaluations_anonymous_access()` helper for later phases.
- `src/pages/faculty/FacultyDashboard.jsx`: reads the faculty view.
- `src/pages/faculty/FacultyEvalResult.jsx`: reads the faculty view; `uniqueStudents`
  per period replaced by submitted-form count (no identity available/needed).
- `src/pages/admin/AdminDashboard.jsx` + `AdminReport.jsx`: read the admin view;
  participation dedupe via `student_token`, program charts via `student_department`.

**Remaining for Phase 4 completion (user steps):**
1. Apply `009_phase4_student_anonymity.sql` in the SQL editor (verification queries at the
   bottom of the file).
2. Release the frontend build in the same step (apply migration first, then deploy the
   frontend — see `supabase/functions/README.md`).
3. Smoke tests (README): faculty results still render; faculty direct `student_id` reads
   return empty/error; admin stats and charts unchanged; student own-row read unchanged.

### Hotfix — users RLS infinite recursion (login 500) ✅

**Symptom:** every login (any role) failed — `GET /rest/v1/users?...id=eq.<uid>` → 500,
then Login.jsx's fallback INSERT → 409 → "User record not found and could not be created".

**Root cause (pre-existing, 002/004/006):** SELECT policies on `users` subqueried `users`
inside themselves ("Admin can view all users", "Student can view own profile only",
006's co-faculty policy) → Postgres "infinite recursion detected in policy" → PostgREST 500.

**Fix:** `supabase/migrations/010_hotfix_users_rls_recursion.sql` — all role/department
lookups in `users` policies now go through SECURITY DEFINER helpers (`is_admin()`, new
`is_faculty()`, `current_user_department()`; 005's pattern). Redundant student-only policy
dropped. Non-recursive, re-runnable, no Edge Function changes. Login must now succeed for
all roles (original symptom gone; role scoping per-role verification queries are at the
bottom of the migration file).### Phase 5 — Result Release Gating (Req 7 / D2–D4) — code complete, 🚧 pending apply/smoke

**Delivered:**
- `supabase/migrations/011_phase5_release_gating.sql` (re-runnable, verification + rule
  truth-table checks at the bottom):
  - `grade_submissions` (faculty_id, academic_year, semester, submitted_at; UNIQUE triple)
    [D2/D3] — faculty self-mark/unmark own rows; admin SELECT. No grades ever stored.
  - `evaluation_releases` (academic_year, semester, department NULL = all programs,
    approved, approved_by/at, release_date) — designed for Phase 7 program scoping now;
    unique index on COALESCE(department,'') because a plain UNIQUE treats NULLs as distinct.
  - `is_period_released(year, semester, department)` — **the single source of the §4.7 rule**:
    `approved AND release_date IS NOT NULL AND release_date <= CURRENT_DATE` (a missing
    release_date NEVER counts as released). SECURITY DEFINER; matches global OR exact-program row.
  - `faculty_evaluations_anon` rebuilt **release-aware**: unreleased periods are invisible
    to faculty at the data layer — not merely grayed out.
  - `faculty_release_status` view: per-period `has_evaluations` / `grades_submitted` /
    `released` booleans for the caller only (no result data).
  - Backfill: every pre-existing period inserted as global + approved + effective
    immediately, so no historical result disappears.
- `src/utils/releaseStatus.js`: faculty release-status fetch + grades toggle (id pinned by RLS).
- `src/utils/periodRelease.js`: client mirror of the rule for UI display only (SQL is the gate).
- `FacultyDashboard.jsx`: pending-release banner, grades-submitted self-mark card [D3],
  rating card shows "Pending" until release; table gated on `activeReleased`.
- `FacultyEvalResult.jsx`: distinguishes "no results" vs "results pending release" [D4]
  via `faculty_release_status`; belt-and-braces client filter to released periods.
- `AdminReleaseManagement.jsx` (route `/admin/release-management`, nav "Release Management"):
  period picker with status pill (draft/scheduled/released), release date + approve
  checkbox, save (select-then-update/insert because the unique index is on
  COALESCE(department,'')), honest status explainer, per-faculty grades-submitted table.

**Remaining for Phase 5 completion (user steps):**
1. Apply `011_phase5_release_gating.sql` in the SQL editor (verification + rule checks at
   the bottom of the file).
2. Smoke tests (README §Phase 5): backfill keeps history visible; faculty dashboard shows
   pending banner + grades toggle persists; results page distinguishes pending vs empty;
   admin sets a future date + approve → hidden until the date passes → visible after;
   passed date without approval stays hidden.

### Phase 6 — Moderation + Priority (Req 3, 8 / D6, D7) — code complete, 🚧 pending apply/deploy/smoke

**Delivered:**
- `supabase/migrations/012_phase6_moderation_priority.sql` (re-runnable, verification at
  the bottom):
  - `evaluations` + `moderation_status` (allow/flagged/blocked), `moderation_labels JSONB`,
    `original_comment` (faculty-invisible), `is_priority`, `priority_source`
    (student/ai/admin).
  - `blocked_words` (word UNIQUE, severity block/flag) + admin-only RLS.
  - `priority_reviews` (unique per evaluation; new/acknowledged/resolved/dismissed,
    source, assigned_to, resolution_note) + admin-only RLS [D7].
  - `get_faculty_escalation_status(year, semester)` — SECURITY DEFINER RPC returning
    **two booleans only** [D6]: has_escalation / all_resolved. No text ever.
  - `faculty_evaluations_anon` rebuilt: `comment` is NULL unless `moderation_status='allow'`
    AND the period is released — flagged/blocked comments NEVER reach faculty;
    `original_comment` is never selected.
  - `admin_evaluations_anon` rebuilt with moderation columns + `original_comment`
    (admins triage; identity restrictions unchanged).
  - "Admin can moderate evaluations" UPDATE policy (evaluations had no admin UPDATE before).
- `supabase/functions/submit-evaluation` (deploy REQUIRED — replaces the stub):
  - Tier 1: admin wordlist (whole-word, block beats flag).
  - Tier 2: OpenAI classifier (`OPENAI_API_KEY` in function secrets — never VITE_*),
    prompt tuned so professional criticism is ALWAYS allowed; block only for
    profanity/slurs/threats/harassment; flag = borderline.
  - AI down/not configured → wordlist-only verdict + `unreviewed` label (admin backlog).
  - `block` → 422 with a re-edit message; original kept only in `original_comment`.
  - High AI severity → auto-priority (`priority_source='ai'`).
  - Student Priority [Req 8]: `priority: true` in payload, rate-limited max 3/period [REC].
  - Response now returns `{ evaluation: { id, submitted_at, moderation_status } }`.
- `StudentEvaluation.jsx`: **also fixed here — the file had regressed to a direct
  evaluations INSERT (dead against the migrated DB); now calls the Edge Function again.**
  Priority pill + OK/Cancel confirm dialog; flagged/priority-aware success messages.
- `FacultyDashboard.jsx`: neutral escalation banner [D6] via the RPC — "a concern is
  being reviewed / has been resolved", never any content.
- `AdminModeration.jsx` (route `/admin/moderation`, nav "Moderation & Priority"):
  Priority queue (acknowledge/resolve/dismiss + comment context), flagged-comments
  triage (Allow / Withhold, `unreviewed` warning), blocked-words CRUD.
- `src/App.jsx` + `AdminLayout.jsx`: route + nav.

**Remaining for Phase 6 completion (user steps):**
1. ~~Apply `012_phase6_moderation_priority.sql`~~ DONE (after the 42P16 view fix —
   see `bugsAndProblem/013`). Confirm via the verification queries at the bottom of 012.
2. ~~Deploy the function~~ DONE — `submit-evaluation` redeployed.
3. ~~AI tier~~ DONE — classifier runs a candidate chain:
   `openai/gpt-oss-safeguard-20b` → `openai/gpt-oss-20b` on Groq (`GROQ_API_KEY`),
   `gpt-4o-mini` on OpenAI (`OPENAI_API_KEY`) if set. (llama-3.1-8b-instant was
   deprecated by Groq in June 2026; the safeguard model is purpose-built for
   moderation and was live-tested: criticism → allow, profanity → block/high.)
   Key set via `supabase secrets set`; lives only in function secrets. Without
   any key the system degrades to wordlist-only + `unreviewed` backlog by design.
4. Smoke tests (README §Phase 6): blocked word → 422; flagged → admin triage;
   Priority pill + dialog → admin queue → resolve → faculty banner says resolved;
   rate limit at 3; faculty never see flagged/blocked comments after release.

### Phase 7 — Super Admin + Program Scoping + Exports (Req 9, 10 / D8–D11) — code complete, 🚧 pending apply/provision/smoke

**Delivered:**
- `supabase/migrations/013_phase7_super_admin_scoping.sql` (re-runnable, verification +
  provisioning snippet at the bottom):
  - `users.role` CHECK extended: 'admin' | 'super_admin' | 'faculty' | 'student' [Req 10].
  - `admin_program_assignments` (admin_id ↔ department_id, UNIQUE pair) — Program Head =
    admin with ≥1 assignment [D8]. RLS: all admins read; super admin writes.
  - Helpers (SECURITY DEFINER): `is_super_admin()`, `is_program_admin_for(department_id)`,
    `is_program_admin_for_name(department_text)`, `admin_assigned_department_ids()`.
  - **Backfill: every existing admin assigned to ALL existing programs** so today's
    behavior is preserved on day one; the super admin narrows later by deleting rows.
  - D9 policy rewrites (guarded, names preserved): users SELECT/UPDATE/DELETE,
    class_assignments CRUD, departments writes, student_enrollments,
    subject_correction_requests, grade_submissions, evaluation_releases (global rows =
    super-admin-only), evaluations moderate/delete — all scoped to the caller's
    assigned programs; unassigned admin = no program data; super admin = all.
  - `admin_evaluations_anon` rebuilt (DROP+CREATE per bug 013 lesson): admin branch
    program-scoped, super admin sees everything; identity rules unchanged.
  - `reveal_student_identity(evaluation_id)` — super-admin-only, audit-logged identity
    reveal (completes the §4.6 promise from Phase 4).
  - NOTE: `is_admin()` deliberately still means role='admin' ONLY. Policies that must
    include super_admin list it explicitly; policies using is_admin() were rewritten in
    this migration.
- `supabase/functions/export-report/index.ts` (DEPLOYED): stats-only export [D13] —
  per-faculty averages, forms, rating distributions + summary; NEVER selects
  comment/student identity; program-scoped [D9] (no assignments → 403); every call
  audit-logged [D11].
- Client:
  - `ProtectedRoute` + `Login.jsx`: super_admin passes admin gates and logs in on the
    Admin tab → /admin/dashboard.
  - `AdminProgramAssignments.jsx` (route `/admin/program-assignments`, nav under SYSTEM
    USERS, super-admin-only client-side + RLS): per-admin program checkboxes, save =
    insert new + delete removed.
  - `AdminReport.jsx`: "Export CSV" button (admin + super admin [D11]) calling
    export-report; builds CSV from the stats payload (Faculty, Program, Forms,
    Average, Performance, 1★–5★, summary row).
  - `AdminLayout.jsx`: superOnly nav filtering.

**Remaining for Phase 7 completion (user steps, in order):**
1. Apply `013_phase7_super_admin_scoping.sql` in the SQL editor.
2. Provision the FIRST super admin (required — nobody can manage assignments otherwise):
   ```sql
   UPDATE public.users SET role = 'super_admin' WHERE email = '<your-email>';
   ```
   (That account then logs in via the ADMIN tab.)
3. Smoke tests (README §Phase 7): scoped admin sees only their programs;
   unassigned admin sees no program data; super admin manages assignments + exports;
   scoped admin export contains only their faculty; every export lands in audit_log;
   reveal RPC is super-admin-only and audit-logged.

### Phase 8 — AI Chatbox + Summaries + Role Separation (Req 4, 5, 6) — planned

- `summarize-comments` Edge Function: on demand, scope = teacher/subject/period [D1];
  identity-scrubbed; small-class caveat shown.
- `admin-analyst` Edge Function: tool-calling over a FIXED query set (program averages,
  lowest-rated, weak criteria, flagged/priority counts, participation gaps, trends); scope
  enforced in SQL from the caller's assignment; answers require evidence + "AI-generated" label;
  chat transcripts to `audit_log`. Never sees `student_id`.

---

## 6. Database Object Inventory

**Exists now:** `departments`, `subjects`, `users` (+`department_id`, `school_id_photo_path`),
`academic_years`, `class_assignments` (+`department_id`), `criteria`, `questions`, `evaluations`,
`email_verifications` (policies locked), `student_enrollments`
(+# `excluded_assignments`, `enrollment_kind` in 008), `subject_correction_requests` (008), `audit_log`, views `faculty_evaluations_anon`,
`admin_evaluations_anon` (009),
Storage bucket `school-id-photos` (private, 5 MB, jpeg/png/webp),
RPCs: `delete_user_account`, `resolve_school_id`, `check_account_status`, `log_id_photo_view`,
helpers: `is_admin()`, trigger `handle_new_user` (roles clamped to student/faculty).

**Planned:** Phase 8: none (functions only).

**Added in 013:** `admin_program_assignments`; helpers `is_super_admin()`,
`is_program_admin_for()`, `is_program_admin_for_name()`, `admin_assigned_department_ids()`;
RPC `reveal_student_identity()`; role value `super_admin`.

**Added in 012:** `blocked_words`, `priority_reviews`; `evaluations` moderation/priority
columns; RPC `get_faculty_escalation_status()`.

**Views:** `faculty_evaluations_anon` (009, rebuilt release-aware in 011),
`admin_evaluations_anon` (009), `faculty_release_status` (011).
**Rule helpers:** `is_period_released()` (011, §4.7), `is_admin()` / `is_faculty()` /
`current_user_department()` (005/010).

**Edge Functions:** `submit-evaluation` (live) · planned: `summarize-comments`,
`admin-analyst`, `export-report`.

---

## 7. Open Items / Known Issues

1. ~~Register.jsx EOF parse error~~ **RESOLVED** (fixed + verified; see Phase 2).
2. **8 pre-existing lint errors + 2 warnings** in untouched files (AuthField, Login,
   AdminCriteria, AdminDashboard, AdminQuestionnaire) — out of scope for
   all phases; cleanup task later. (StudentDashboard/StudentEvaluation were rewritten in
   Phase 3; FacultyEvalResult in Phase 4 — baseline shrank from 18 errors to 8.)
3. ~~Migrations 008 and 009 pending user application~~ Applied (008 + 009 verified).
   Phase 3 still needs its `submit-evaluation` redeploy if not yet done; 010 hotfix
   applied — login works for all roles again.
4. `Login.jsx` fallback profile-creation INSERT is dead code on a correctly migrated DB
   (trigger creates profiles; direct INSERT now default-deny). Safe to leave; may be removed
   in a later cleanup.
5. ~~Interim anonymity gap (faculty can read `student_id` in raw evaluations)~~ **CLOSED**
   in Phase 4 (migration 009: faculty base-table SELECT revoked; anonymous views).
   Admin identity reveal RPC arrives in Phase 7.
6. Legacy `student_enrollments` rows created by students before Phase 3 are treated as
   "confirmed additions" (they WIDEN the section match, never narrow it) so no previously
   confirmed subject disappears; admins convert a student to a governed list by saving one
   on the Subject Corrections page, or restore pure section matching via Clear Overrides.

---

## 8. Working Conventions for Any AI Here

- Read this file + `supabase/functions/README.md` before changing anything.
- Every fixed bug/problem gets its own markdown file in `bugsAndProblem/`
  (NNN-slug.md, one problem per file, Symptom → Root cause → Fix →
  Verification), plus a row in that folder's README index. Design-flaw
  fixes use Problem → Client decision → Fix. Don't merge old entries.
- Migrations: next sequential number, re-runnable (guarded policies, `IF NOT EXISTS`),
  include verification queries at the bottom. User applies them via SQL editor — never run twice
  silently; if a re-run errors with 42710, the migration already applied.
- Lint baseline: 18 pre-existing errors + 2 warnings (see §7.2). `npm run build` must pass;
  new lint issues in touched files are not acceptable.
- Client decisions (§3) are immutable; if a decision looks wrong, surface it — don't redesign.
- Phase gates: user reviews and approves before each next phase starts.
