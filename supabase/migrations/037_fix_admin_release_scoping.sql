-- ============================================================
-- FacultyTrack: Migration 037 — Fix Admin Release Scoping & Permissions
--
-- Problem:
-- When a regular department admin attempts to release evaluation
-- results in /admin/release-management, the release row may fail to insert
-- or update if:
--   1. The admin was created without an explicit row in admin_program_assignments
--      (only users.department was set).
--   2. RLS policy on evaluation_releases strictly required admin_program_assignments.
--   3. approved_by foreign key constraint fails if auth id differs.
--
-- Solution:
-- 1. Backfill admin_program_assignments for all admins with a department.
-- 2. Update is_program_admin_for_name & is_program_admin_for to check both
--    admin_program_assignments AND users.department / users.department_id.
-- 3. Update evaluation_releases RLS policy to allow program admins to manage
--    releases for their program.
-- ============================================================

-- 1. Backfill admin_program_assignments for all admins
INSERT INTO public.admin_program_assignments (admin_id, department_id)
SELECT u.id, d.id
FROM public.users u
JOIN public.departments d ON (u.department_id = d.id OR public.match_department(d.name, u.department))
WHERE u.role = 'admin'
ON CONFLICT (admin_id, department_id) DO NOTHING;

-- 2. Update is_program_admin_for_name helper to support canonical department matching and users.department
CREATE OR REPLACE FUNCTION public.is_program_admin_for_name(p_department text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.is_super_admin()
    OR (
      public.is_admin()
      AND p_department IS NOT NULL
      AND (
        EXISTS (
          SELECT 1
          FROM public.admin_program_assignments a
          JOIN public.departments d ON d.id = a.department_id
          WHERE a.admin_id = auth.uid()
            AND (lower(btrim(d.name)) = lower(btrim(p_department)) OR public.match_department(d.name, p_department))
        )
        OR EXISTS (
          SELECT 1
          FROM public.users u
          WHERE u.id = auth.uid()
            AND u.role = 'admin'
            AND (lower(btrim(COALESCE(u.department, ''))) = lower(btrim(p_department)) OR public.match_department(u.department, p_department))
        )
      )
    );
$$;

-- 3. Update is_program_admin_for helper
CREATE OR REPLACE FUNCTION public.is_program_admin_for(p_department_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.is_super_admin()
    OR (
      public.is_admin()
      AND p_department_id IS NOT NULL
      AND (
        EXISTS (
          SELECT 1 FROM public.admin_program_assignments a
          WHERE a.admin_id = auth.uid()
            AND a.department_id = p_department_id
        )
        OR EXISTS (
          SELECT 1 FROM public.users u
          WHERE u.id = auth.uid()
            AND u.role = 'admin'
            AND u.department_id = p_department_id
        )
      )
    );
$$;

-- 4. Update evaluation_releases RLS policy
DROP POLICY IF EXISTS "Admin can manage evaluation releases" ON public.evaluation_releases;
CREATE POLICY "Admin can manage evaluation releases"
  ON public.evaluation_releases FOR ALL
  TO authenticated
  USING (
    public.is_super_admin()
    OR (
      public.is_admin()
      AND department IS NOT NULL
      AND (
        public.is_program_admin_for_name(department)
        OR EXISTS (
          SELECT 1 FROM public.users u
          WHERE u.id = auth.uid()
            AND u.role = 'admin'
            AND (
              u.department = department
              OR public.match_department(u.department, department)
            )
        )
      )
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR (
      public.is_admin()
      AND department IS NOT NULL
      AND (
        public.is_program_admin_for_name(department)
        OR EXISTS (
          SELECT 1 FROM public.users u
          WHERE u.id = auth.uid()
            AND u.role = 'admin'
            AND (
              u.department = department
              OR public.match_department(u.department, department)
            )
        )
      )
    )
  );
