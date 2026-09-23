-- ============================================================
-- FacultyTrack: Phase 3 — Remove "Add Subject" (Req 2 / D5)
-- File: supabase/migrations/008_phase3_subject_lists.sql
-- Apply AFTER 007. No Edge Function coupling in this phase:
-- the 008 portion of submit-evaluation keeps working against
-- both the pre- and post-008 DB (documented in
-- supabase/functions/README.md).
--
-- What changes:
--   1. student_enrollments becomes admin-only (§5.5):
--      student INSERT/UPDATE policies dropped; student keeps
--      SELECT on own rows so legacy confirmed lists still
--      display. Admin keeps full management (exceptions).
--   2. §5.4: student SELECT on class_assignments is restricted
--      to assignments matching the student's own
--      program/year/section. The submit-evaluation function
--      validates via service role, so the UI list and the
--      write path stay consistent.
--   3. Students can no longer edit their own
--      department/year_level/section (closes the Phase 1
--      interim re-match gap; renovation.md §7.1).
--   4. New table subject_correction_requests + RLS + indexes:
--      students report subject-list issues in-app; admins
--      resolve them and adjust subject lists per student.
-- ============================================================

-- ------------------------------------------------------------
-- 1. subject_correction_requests (Phase 3 planned object)
--    No student_id leak concern: students only ever read their
--    own rows; admins read all.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subject_correction_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'resolved', 'dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT DEFAULT '',
  resolved_by UUID REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_subject_correction_requests_student
  ON public.subject_correction_requests(student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subject_correction_requests_status
  ON public.subject_correction_requests(status, created_at DESC);

ALTER TABLE public.subject_correction_requests ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'subject_correction_requests'
      AND policyname = 'Students can insert own correction requests'
  ) THEN
    CREATE POLICY "Students can insert own correction requests"
      ON public.subject_correction_requests FOR INSERT
      TO authenticated
      WITH CHECK (
        student_id = auth.uid()
        AND EXISTS (
          SELECT 1 FROM public.users u
          WHERE u.id = auth.uid() AND u.role = 'student'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'subject_correction_requests'
      AND policyname = 'Students can view own correction requests'
  ) THEN
    CREATE POLICY "Students can view own correction requests"
      ON public.subject_correction_requests FOR SELECT
      TO authenticated
      USING (
        student_id = auth.uid()
        AND EXISTS (
          SELECT 1 FROM public.users u
          WHERE u.id = auth.uid() AND u.role = 'student'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'subject_correction_requests'
      AND policyname = 'Admins can manage correction requests'
  ) THEN
    CREATE POLICY "Admins can manage correction requests"
      ON public.subject_correction_requests FOR ALL
      TO authenticated
      USING (public.is_admin())
      WITH CHECK (public.is_admin());
  END IF;
END
$$;

-- ------------------------------------------------------------
-- 2. §5.5 — student_enrollments becomes admin-only for writes
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Students can insert own enrollments"
  ON public.student_enrollments;
DROP POLICY IF EXISTS "Students can update own enrollments"
  ON public.student_enrollments;

-- Student SELECT on own rows stays (legacy display + audit);
-- admin management stays (migration 002 "Admin can manage
-- enrollments", FOR ALL). No new policy needed for either.

-- ------------------------------------------------------------
-- 3. §5.4 — students read only assignments for their own
--    program/year/section (fuzzy-normalized comparison, the
--    same matching semantics the UI has always used).
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Students can view assignments for enrolled subjects"
  ON public.class_assignments;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'class_assignments'
      AND policyname = 'Students can view assignments for their section and period'
  ) THEN
    CREATE POLICY "Students can view assignments for their section and period"
      ON public.class_assignments FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.users s
          WHERE s.id = auth.uid()
            AND s.role = 'student'
            AND (
              -- Null/empty student fields must not match anything
              -- (default-deny for unsectioned accounts).
              (
                lower(regexp_replace(COALESCE(s.department, ''), '[^a-z0-9]', '', 'g'))
                  = lower(regexp_replace(class_assignments.department, '[^a-z0-9]', '', 'g'))
                AND lower(regexp_replace(COALESCE(s.year_level, ''), '[^a-z0-9]', '', 'g'))
                  = lower(regexp_replace(class_assignments.year_level, '[^a-z0-9]', '', 'g'))
                AND lower(regexp_replace(COALESCE(s.section, ''), '[^a-z0-9]', '', 'g'))
                  = lower(regexp_replace(class_assignments.section, '[^a-z0-9]', '', 'g'))
                AND COALESCE(s.department, '') <> ''
                AND COALESCE(s.year_level, '') <> ''
                AND COALESCE(s.section, '') <> ''
                AND COALESCE(class_assignments.department, '') <> ''
                AND COALESCE(class_assignments.year_level, '') <> ''
                AND COALESCE(class_assignments.section, '') <> ''
              )
            )
        )
      );
  END IF;
END
$$;

-- ------------------------------------------------------------
-- 4. Lock student self-edits of department/year_level/section
--    (closes the Phase 1 interim gap, renovation.md §7.1).
--    Extends "Users can update own profile safely" (005):
--    WITH CHECK now compares the classification fields against
--    the existing row, in addition to role/status/approved_at.
--    Admin updates go through "Admin can update any user".
--    Replaces the 005 version so re-running stays idempotent.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Users can update own profile safely"
  ON public.users;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'users'
      AND policyname = 'Users can update own profile safely'
  ) THEN
    CREATE POLICY "Users can update own profile safely"
      ON public.users FOR UPDATE
      TO authenticated
      USING (auth.uid() = id AND NOT public.is_admin())
      WITH CHECK (
        auth.uid() = id
        AND role = (SELECT u.role FROM public.users u WHERE u.id = auth.uid())
        AND status = (SELECT u.status FROM public.users u WHERE u.id = auth.uid())
        AND approved_at IS NOT DISTINCT FROM
              (SELECT u.approved_at FROM public.users u WHERE u.id = auth.uid())
        AND department IS NOT DISTINCT FROM
              (SELECT u.department FROM public.users u WHERE u.id = auth.uid())
        AND year_level IS NOT DISTINCT FROM
              (SELECT u.year_level FROM public.users u WHERE u.id = auth.uid())
        AND section IS NOT DISTINCT FROM
              (SELECT u.section FROM public.users u WHERE u.id = auth.uid())
      );
  END IF;
END
$$;

-- ------------------------------------------------------------
-- 5. POST-MIGRATION VERIFICATION (run manually in SQL editor)
--    Expect exactly these on student_enrollments:
--      SELECT policyname, cmd FROM pg_policies
--        WHERE tablename = 'student_enrollments';
--      -> "Students can view own enrollments" (SELECT),
--         "Admin can manage enrollments" (ALL). The student
--         INSERT/UPDATE policies must be gone.
--
--    Expect on class_assignments:
--      SELECT policyname FROM pg_policies
--        WHERE tablename = 'class_assignments'
--          AND policyname ILIKE '%Students%';
--      -> only "Students can view assignments for their
--         section and period".
--
--    Expect 3 policies on subject_correction_requests.
--
--    Student self-edit lock (run as a student session):
--      UPDATE public.users SET section = 'Z' WHERE id = auth.uid();
--      -> must fail with a WITH CHECK violation.
-- ------------------------------------------------------------