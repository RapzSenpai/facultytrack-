-- ============================================================
-- FacultyTrack: Fix 014 — enrollment columns + correction/enrollment RLS
-- Audit refs: C1 (missing excluded_assignments/enrollment_kind),
-- C8 (013 re-opened student enrollment writes),
-- C9 (students could UPDATE correction status/resolution).
-- Apply AFTER 001-013. Re-runnable. User applies via SQL editor.
--
-- What changes:
--   1. student_enrollments gains excluded_assignments UUID[]
--      + enrollment_kind TEXT ('auto'|'admin'|'exception').
--      submit-evaluation + AdminSubjectCorrections already
--      read/write these columns.
--   2. student_enrollments FOR ALL loses the student_id=self
--      branch (admin-only writes restored; students keep
--      SELECT-own only).
--   3. subject_correction_requests FOR ALL loses the
--      student_id=self branch (students keep INSERT + SELECT-own
--      from 008; only scoped admins + super_admin manage/resolve).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Missing columns (C1)
-- ------------------------------------------------------------
ALTER TABLE public.student_enrollments
  ADD COLUMN IF NOT EXISTS excluded_assignments UUID[] NOT NULL DEFAULT '{}';

ALTER TABLE public.student_enrollments
  ADD COLUMN IF NOT EXISTS enrollment_kind TEXT NOT NULL DEFAULT 'auto';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'student_enrollments_kind_check'
      AND conrelid = 'public.student_enrollments'::regclass
  ) THEN
    ALTER TABLE public.student_enrollments
      ADD CONSTRAINT student_enrollments_kind_check
      CHECK (enrollment_kind IN ('auto', 'admin', 'exception'));
  END IF;
END
$$;

-- Legacy rows keep the 'auto' default, which the Edge Function
-- already handles (section-match UNION confirmed list). The admin
-- UI always writes enrollment_kind explicitly on the next save,
-- so no heuristic backfill is needed and none is attempted.

-- ------------------------------------------------------------
-- 2. student_enrollments: admin-only writes (C8)
--    Students keep SELECT-own (002, left intact).
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Admin can manage enrollments"
  ON public.student_enrollments;

CREATE POLICY "Admin can manage enrollments"
  ON public.student_enrollments FOR ALL
  TO authenticated
  USING (
    public.is_super_admin()
    OR (
      public.is_admin()
      AND EXISTS (
        SELECT 1 FROM public.users s
        WHERE s.id = student_enrollments.student_id
          AND (
            (s.department_id IS NOT NULL AND public.is_program_admin_for(s.department_id))
            OR public.is_program_admin_for_name(s.department)
          )
      )
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR (
      public.is_admin()
      AND EXISTS (
        SELECT 1 FROM public.users s
        WHERE s.id = student_enrollments.student_id
          AND (
            (s.department_id IS NOT NULL AND public.is_program_admin_for(s.department_id))
            OR public.is_program_admin_for_name(s.department)
          )
      )
    )
  );

-- Ensure no legacy student write policies survive (008 dropped
-- them; re-drop for idempotency against partial applies).
DROP POLICY IF EXISTS "Students can insert own enrollments"
  ON public.student_enrollments;
DROP POLICY IF EXISTS "Students can update own enrollments"
  ON public.student_enrollments;

-- Ensure student SELECT-own exists (from 002; recreate guarded
-- if a partial apply dropped it).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'student_enrollments'
      AND policyname = 'Students can view own enrollments'
  ) THEN
    CREATE POLICY "Students can view own enrollments"
      ON public.student_enrollments FOR SELECT
      TO authenticated
      USING (student_id = auth.uid());
  END IF;
END
$$;

-- ------------------------------------------------------------
-- 3. subject_correction_requests: students INSERT + SELECT-own
--    only; management is admin-only (C9).
--    The 008 student policies are left intact.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can manage correction requests"
  ON public.subject_correction_requests;

CREATE POLICY "Admins can manage correction requests"
  ON public.subject_correction_requests FOR ALL
  TO authenticated
  USING (
    public.is_super_admin()
    OR (
      public.is_admin()
      AND EXISTS (
        SELECT 1 FROM public.users s
        WHERE s.id = subject_correction_requests.student_id
          AND (
            (s.department_id IS NOT NULL AND public.is_program_admin_for(s.department_id))
            OR public.is_program_admin_for_name(s.department)
          )
      )
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR (
      public.is_admin()
      AND EXISTS (
        SELECT 1 FROM public.users s
        WHERE s.id = subject_correction_requests.student_id
          AND (
            (s.department_id IS NOT NULL AND public.is_program_admin_for(s.department_id))
            OR public.is_program_admin_for_name(s.department)
          )
      )
    )
  );

-- ------------------------------------------------------------
-- 4. POST-MIGRATION VERIFICATION (run manually in SQL editor)
--    SELECT column_name, data_type FROM information_schema.columns
--      WHERE table_name = 'student_enrollments'
--        AND column_name IN ('excluded_assignments','enrollment_kind');
--    -> 2 rows.
--    SELECT policyname, cmd, roles FROM pg_policies
--      WHERE tablename = 'student_enrollments';
--    -> "Students can view own enrollments" (SELECT) +
--       "Admin can manage enrollments" (ALL). No student
--       INSERT/UPDATE. The ALL policy text must NOT contain
--       "student_id = auth.uid()".
--    SELECT policyname, cmd FROM pg_policies
--      WHERE tablename = 'subject_correction_requests';
--    -> student INSERT + student SELECT + admin ALL. The admin
--       ALL policy text must NOT contain "student_id = auth.uid()".
--    As a student session:
--      UPDATE public.student_enrollments SET enrollment_kind='auto'
--        WHERE student_id = auth.uid(); -> must fail (42501/42502).
--      UPDATE public.subject_correction_requests SET status='resolved'
--        WHERE student_id = auth.uid(); -> must fail.
-- ------------------------------------------------------------
