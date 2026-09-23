-- ============================================================
-- FacultyTrack: Phase 4 — Student Anonymity Refactor (Req 11)
-- File: supabase/migrations/009_phase4_student_anonymity.sql
-- Blueprint v3, Phase 4. Apply AFTER 001-008.
--
-- Goal: faculty must NEVER be able to read evaluations.student_id.
-- Enforced at the data layer (RLS + view shape), not the UI.
--
-- Shape of the fix:
--   1. The base-table policy "Faculty can view evaluations for
--      own classes" (002) granted faculty SELECT on FULL rows,
--      including student_id. It is DROPPED.
--   2. Students keep a narrow own-row SELECT (their dashboard
--      "already evaluated" state reads it).
--   3. Faculty get an identity-stripped VIEW instead:
--      faculty_evaluations_anon — physically has NO student_id
--      column, so even a crafted client query cannot leak it.
--      Row access is pinned to faculty_id = auth.uid() inside
--      the view definition (security_invoker = false, so the
--      base-table RLS is not the gate; the view WHERE is).
--   4. Admins lose raw student_id too (§4.6: admins are
--      identity-restricted by DEFAULT; the audit-gated reveal RPC
--      arrives in Phase 7). They get admin_evaluations_anon:
--      same shape plus a per-row MD5 token standing in for
--      student_id (distinct-count semantics preserved: admin
--      dashboards dedupe participants with it) and the student's
--      department text (program-participation charts). Neither
--      column identifies a student in the response itself.
--      Honest limitation, documented: an admin who can read the
--      users table could brute-force the token against known
--      user ids — this is accidental-leak protection, not
--      cryptography. Phase 7's audit-gated RPC is the real gate.
--   5. Students keep base-table own-row SELECT (their dashboard
--      "already evaluated" state reads it).
--
-- Re-runnable: drops/guards everywhere. Verification queries at
-- the bottom.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Revoke faculty base-table access
--    (was: USING (faculty_id = auth.uid() OR student_id = auth.uid()
--    OR is_admin) — full-row reads incl. student_id.)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Faculty can view evaluations for own classes"
  ON public.evaluations;

-- Student own-row read (narrow: student_id = auth.uid() only).
-- Guarded: 002's policy name already had the student branch; if it
-- exists it is exactly what we want, keep it. Otherwise create it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'evaluations'
      AND policyname = 'Students can view own evaluations'
  ) THEN
    CREATE POLICY "Students can view own evaluations"
      ON public.evaluations FOR SELECT
      TO authenticated
      USING (student_id = auth.uid());
  END IF;
END
$$;

-- ------------------------------------------------------------
-- 2. Anonymity helper (documents the invariant; usable in later
--    phases' policies/functions)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_evaluations_anonymous_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- True when the caller is a faculty member: identity columns of
  -- evaluations must be inaccessible to them.
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'faculty'
  );
$$;

-- ------------------------------------------------------------
-- 3. Identity-stripped faculty view
--    Columns: everything the faculty result pages need, minus
--    student_id. Dates rounded to day (timing-correlation guard).
--    Owner rights (default): evaluates auth.uid() as the VIEWING
--    faculty member; no student_id exists to leak.
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW public.faculty_evaluations_anon AS
SELECT
  e.id,
  e.faculty_id,
  e.assignment_id,
  e.academic_year,
  e.semester,
  e.ratings,
  e.comment,
  date_trunc('day', e.submitted_at)::date AS submitted_on
FROM public.evaluations e
WHERE e.faculty_id = auth.uid();

-- ------------------------------------------------------------
-- 3b. Admin identity-restricted view (§4.6 default-deny on
--     identity; audit-gated reveal = Phase 7)
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW public.admin_evaluations_anon AS
SELECT
  e.id,
  e.assignment_id,
  e.faculty_id,
  md5(e.student_id::text) AS student_token,
  u.department AS student_department,
  e.academic_year,
  e.semester,
  e.ratings,
  e.comment,
  date_trunc('day', e.submitted_at)::date AS submitted_on
FROM public.evaluations e
LEFT JOIN public.users u ON u.id = e.student_id
WHERE EXISTS (
  SELECT 1 FROM public.users au
  WHERE au.id = auth.uid() AND au.role = 'admin'
);

-- ------------------------------------------------------------
-- 4. POST-MIGRATION VERIFICATION (run manually in SQL editor)
--    All three must return the expected result:
--
--    a) No faculty base-table policy remains:
--       SELECT policyname FROM pg_policies
--         WHERE tablename = 'evaluations'
--         ORDER BY policyname;
--       Expect ONLY: "Students can view own evaluations",
--                    "Admin can delete evaluations".
--
--    b) Neither view exposes student_id:
--       SELECT column_name FROM information_schema.columns
--         WHERE table_schema = 'public'
--           AND table_name IN ('faculty_evaluations_anon',
--                              'admin_evaluations_anon')
--         ORDER BY table_name, ordinal_position;
--       Expect faculty view: id, faculty_id, assignment_id,
--         academic_year, semester, ratings, comment, submitted_on.
--       Expect admin view: same + student_token, student_department.
--       (No student_id in either — physically impossible to select.)
--
--    c) As a faculty user (SQL editor run-as is not available;
--       verify via the app): faculty result page still loads
--       with ratings + comments, and a direct
--       supabase.from('evaluations').select('student_id')
--         .eq('faculty_id', <own id>)
--       returns 0 rows (RLS default-deny for faculty now).
-- ----------------------------------------------------------
