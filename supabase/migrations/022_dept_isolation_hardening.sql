-- ============================================================
-- FacultyTrack: Migration 022 — Curriculum RLS hardening (D9)
-- File: supabase/migrations/022_dept_isolation_hardening.sql
-- Apply AFTER 001-021. Run in Supabase SQL Editor, then refresh.
--
-- Completes department isolation for the Curriculum console:
--   subjects + sections readable/writable by an admin ONLY for
--   their assigned program(s); super_admin bypasses everything.
--   Students/faculty keep read access (enrollment + evaluation
--   flows depend on the catalog).
--
-- Frontend (AdminDepartment/AdminReport/AdminDashboard) filters
-- to the same scope client-side; these policies are the
-- server-side backstop so cross-dept rows are unreachable even
-- via direct API calls.
--
-- Requires helpers from 013: is_super_admin(),
-- is_program_admin_for(uuid), is_program_admin_for_name(text).
-- ============================================================

-- ------------------------------------------------------------
-- 1. SECTIONS — replace the 021 open policies with scoped ones.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone authenticated can view sections"
  ON public.sections;
DROP POLICY IF EXISTS "Admins can manage sections"
  ON public.sections;

CREATE POLICY "Scoped section viewing"
  ON public.sections FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin()
    OR public.is_program_admin_for(department_id)
    OR public.is_program_admin_for_name(department)
    OR EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role IN ('faculty', 'student')
    )
  );

CREATE POLICY "Scoped section insert"
  ON public.sections FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR public.is_program_admin_for(department_id)
    OR public.is_program_admin_for_name(department)
  );

CREATE POLICY "Scoped section update"
  ON public.sections FOR UPDATE
  TO authenticated
  USING (
    public.is_super_admin()
    OR public.is_program_admin_for(department_id)
    OR public.is_program_admin_for_name(department)
  )
  WITH CHECK (
    public.is_super_admin()
    OR public.is_program_admin_for(department_id)
    OR public.is_program_admin_for_name(department)
  );

CREATE POLICY "Scoped section delete"
  ON public.sections FOR DELETE
  TO authenticated
  USING (
    public.is_super_admin()
    OR public.is_program_admin_for(department_id)
    OR public.is_program_admin_for_name(department)
  );

-- ------------------------------------------------------------
-- 2. SUBJECTS — replace the 002 open policies with scoped ones.
--    (Policy names from 002_rls_policies.sql.)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can view subjects"
  ON public.subjects;
DROP POLICY IF EXISTS "Admin can insert subjects"
  ON public.subjects;
DROP POLICY IF EXISTS "Admin can update subjects"
  ON public.subjects;
DROP POLICY IF EXISTS "Admin can delete subjects"
  ON public.subjects;

CREATE POLICY "Scoped subject viewing"
  ON public.subjects FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin()
    OR public.is_program_admin_for(department_id)
    OR public.is_program_admin_for_name(department)
    OR EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role IN ('faculty', 'student')
    )
  );

CREATE POLICY "Scoped subject insert"
  ON public.subjects FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR public.is_program_admin_for(department_id)
    OR public.is_program_admin_for_name(department)
  );

CREATE POLICY "Scoped subject update"
  ON public.subjects FOR UPDATE
  TO authenticated
  USING (
    public.is_super_admin()
    OR public.is_program_admin_for(department_id)
    OR public.is_program_admin_for_name(department)
  )
  WITH CHECK (
    public.is_super_admin()
    OR public.is_program_admin_for(department_id)
    OR public.is_program_admin_for_name(department)
  );

CREATE POLICY "Scoped subject delete"
  ON public.subjects FOR DELETE
  TO authenticated
  USING (
    public.is_super_admin()
    OR public.is_program_admin_for(department_id)
    OR public.is_program_admin_for_name(department)
  );

-- ------------------------------------------------------------
-- 3. Reload PostgREST schema cache.
-- ------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------
-- 4. POST-MIGRATION VERIFICATION (run manually in SQL editor)
--    a) Only the new policies remain:
--       SELECT policyname FROM pg_policies
--         WHERE schemaname = 'public'
--           AND tablename IN ('subjects', 'sections');
--    b) As a scoped (BSIT) admin: SELECT * FROM subjects /
--       sections returns only own-program rows.
--    c) Cross-dept INSERT as scoped admin fails; as super
--       admin it succeeds.
-- ------------------------------------------------------------
