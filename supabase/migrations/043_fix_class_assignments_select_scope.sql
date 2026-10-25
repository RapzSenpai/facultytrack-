-- ============================================================
-- Migration 043: Restore strict program isolation on class_assignments SELECT
-- Fixes 041 leak (department_id IS NULL visible to every admin).
-- Same scope as 013 + explicit super_admin check. Re-runnable.
-- ============================================================
DROP POLICY IF EXISTS "Faculty and Admins can view class assignments" ON public.class_assignments;
CREATE POLICY "Faculty and Admins can view class assignments"
  ON public.class_assignments FOR SELECT
  TO authenticated
  USING (
    faculty_id = auth.uid()
    OR public.is_super_admin()
    OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'super_admin')
    OR public.is_program_admin_for(department_id)
    OR public.is_program_admin_for_name(department)
  );

NOTIFY pgrst, 'reload schema';
