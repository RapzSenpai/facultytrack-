-- ============================================================
-- FacultyTrack: Migration 025 — scoped admin SELECT on evaluations
-- Live-DB discovery: evaluations has NO admin SELECT policy
-- (only "Students can view own evaluations" plus faculty/student
-- ones). Consequence: an admin UPDATE succeeds server-side, but
-- PostgREST filters the RETURNING clause through SELECT RLS and
-- hands back zero rows — the app mistakes a saved change for a
-- scope block ("No change saved …"). The anon view kept working
-- because views run with owner rights, masking the gap.
-- This adds the missing scoped read (super bypass +
-- faculty-program match, same predicate as 024).
-- Re-runnable.
-- ============================================================

DROP POLICY IF EXISTS "Admin can view evaluations"
  ON public.evaluations;
CREATE POLICY "Admin can view evaluations"
  ON public.evaluations FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin()
    OR (
      public.is_admin()
      AND EXISTS (
        SELECT 1 FROM public.users f
        WHERE f.id = faculty_id
          AND (
            (f.department_id IS NOT NULL AND public.is_program_admin_for(f.department_id))
            OR public.is_program_admin_for_name(f.department)
          )
      )
    )
  );

NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------
-- POST-MIGRATION VERIFICATION (run manually in SQL editor)
--    SELECT policyname, cmd FROM pg_policies
--      WHERE schemaname = 'public' AND tablename = 'evaluations'
--      AND cmd = 'SELECT';
--    -> "Admin can view evaluations" present.
--    Retest Allow/Withhold as BSIT admin: change saves AND the
--    row updates in place with no scope alert.
-- ------------------------------------------------------------
