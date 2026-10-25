-- ============================================================
-- FacultyTrack: Migration 042 — Super Admin CRUD on curriculum
-- Tables: departments, subjects, sections.
-- ADDITIVE ONLY: existing scoped-admin / faculty / student policies
-- untouched. Permissive policies OR together, so this only grants
-- super_admin full access. Re-runnable.
-- ============================================================

-- departments
DROP POLICY IF EXISTS "Super admin full access departments" ON public.departments;
CREATE POLICY "Super admin full access departments"
  ON public.departments FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'super_admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'super_admin'));

-- subjects
DROP POLICY IF EXISTS "Super admin full access subjects" ON public.subjects;
CREATE POLICY "Super admin full access subjects"
  ON public.subjects FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'super_admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'super_admin'));

-- sections
DROP POLICY IF EXISTS "Super admin full access sections" ON public.sections;
CREATE POLICY "Super admin full access sections"
  ON public.sections FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'super_admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'super_admin'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.departments, public.subjects, public.sections TO authenticated;

NOTIFY pgrst, 'reload schema';
