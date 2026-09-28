-- ============================================================
-- FacultyTrack: Migration 024 — repair evaluations admin policies
-- Live-DB discovery: evaluations still carries the 012-era
-- "Admin can moderate evaluations" (is_admin() only). The 013
-- scoped rewrite never landed there, so super_admin has NO write
-- path (is_admin() matches role='admin' exactly) and program
-- scoping is unenforced. This (re)applies the 013 versions:
-- super bypass + faculty-program scoping for scoped admins.
-- Re-runnable. Requires 013 helpers (verified present live):
-- is_super_admin(), is_admin(), is_program_admin_for(uuid),
-- is_program_admin_for_name(text).
-- ============================================================

DROP POLICY IF EXISTS "Admin can moderate evaluations"
  ON public.evaluations;
CREATE POLICY "Admin can moderate evaluations"
  ON public.evaluations FOR UPDATE
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
  )
  WITH CHECK (
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

DROP POLICY IF EXISTS "Admin can delete evaluations"
  ON public.evaluations;
CREATE POLICY "Admin can delete evaluations"
  ON public.evaluations FOR DELETE
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
--    SELECT policyname, cmd, qual, with_check FROM pg_policies
--      WHERE schemaname = 'public' AND tablename = 'evaluations';
--    -> UPDATE/DELETE policies reference is_super_admin().
-- ------------------------------------------------------------
