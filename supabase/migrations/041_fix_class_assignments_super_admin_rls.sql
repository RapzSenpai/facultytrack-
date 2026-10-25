-- ============================================================
-- FacultyTrack: Migration 041 — Fix Super Admin Class Assignments RLS
-- Allows Super Admin to view, insert, update, and delete class assignments.
-- Preserves program-scoped admin restrictions and student policies.
-- ============================================================

-- 1. Ensure is_super_admin() helper has safe search_path
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'super_admin'
  );
$$;

-- 2. Drop existing conflicting policies on class_assignments
DROP POLICY IF EXISTS "Faculty can view own assignments" ON public.class_assignments;
DROP POLICY IF EXISTS "Faculty and Admins can view class assignments" ON public.class_assignments;
DROP POLICY IF EXISTS "Admin can insert class assignments" ON public.class_assignments;
DROP POLICY IF EXISTS "Admins can insert class assignments" ON public.class_assignments;
DROP POLICY IF EXISTS "Admin can update class assignments" ON public.class_assignments;
DROP POLICY IF EXISTS "Admins can update class assignments" ON public.class_assignments;
DROP POLICY IF EXISTS "Admin can delete class assignments" ON public.class_assignments;
DROP POLICY IF EXISTS "Admins can delete class assignments" ON public.class_assignments;

-- 3. SELECT: Super admin (global), Program admin (scoped), Faculty (own)
CREATE POLICY "Faculty and Admins can view class assignments"
  ON public.class_assignments FOR SELECT
  TO authenticated
  USING (
    faculty_id = auth.uid()
    OR public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role = 'super_admin'
    )
    OR (
      public.is_admin()
      AND (
        (department_id IS NOT NULL AND public.is_program_admin_for(department_id))
        OR public.is_program_admin_for_name(department)
        OR department_id IS NULL
      )
    )
  );

-- 4. INSERT: Super admin (global), Program admin (scoped to program)
CREATE POLICY "Admins can insert class assignments"
  ON public.class_assignments FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role = 'super_admin'
    )
    OR (
      public.is_admin()
      AND (
        (department_id IS NOT NULL AND public.is_program_admin_for(department_id))
        OR public.is_program_admin_for_name(department)
      )
    )
  );

-- 5. UPDATE: Super admin (global), Program admin (scoped to program)
CREATE POLICY "Admins can update class assignments"
  ON public.class_assignments FOR UPDATE
  TO authenticated
  USING (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role = 'super_admin'
    )
    OR (
      public.is_admin()
      AND (
        (department_id IS NOT NULL AND public.is_program_admin_for(department_id))
        OR public.is_program_admin_for_name(department)
      )
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role = 'super_admin'
    )
    OR (
      public.is_admin()
      AND (
        (department_id IS NOT NULL AND public.is_program_admin_for(department_id))
        OR public.is_program_admin_for_name(department)
      )
    )
  );

-- 6. DELETE: Super admin (global), Program admin (scoped to program)
CREATE POLICY "Admins can delete class assignments"
  ON public.class_assignments FOR DELETE
  TO authenticated
  USING (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role = 'super_admin'
    )
    OR (
      public.is_admin()
      AND (
        (department_id IS NOT NULL AND public.is_program_admin_for(department_id))
        OR public.is_program_admin_for_name(department)
      )
    )
  );

-- 7. Ensure table privileges for authenticated role
GRANT SELECT, INSERT, UPDATE, DELETE ON public.class_assignments TO authenticated;
