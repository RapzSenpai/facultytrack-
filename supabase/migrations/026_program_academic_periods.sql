-- ============================================================
-- FacultyTrack: Migration 026 — per-program evaluation periods (D9)
-- Apply AFTER 001-025. Run in Supabase SQL Editor, then refresh.
--
-- academic_years gains department_id (NULL = shared/global period).
-- Existing rows stay NULL (shared) to preserve today's behavior;
-- the super admin assigns ownership afterward. New rows created by
-- a scoped admin are stamped with their own program (enforced
-- below + in UI); scoped admins cannot create shared rows.
--
-- Read rule: super sees all; scoped admin sees own-program +
-- shared; students/faculty see shared + their own program's
-- periods (id match with department-name fallback for legacy
-- NULL-id profile rows).
-- Write rule: super anything; scoped admin only own-program rows
-- (shared rows are read-only for them).
--
-- Requires helpers from 005/010/013: is_admin(),
-- is_super_admin(), is_program_admin_for(uuid).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Column + index (re-runnable).
-- ------------------------------------------------------------
ALTER TABLE public.academic_years
  ADD COLUMN IF NOT EXISTS department_id UUID
  REFERENCES public.departments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_academic_years_department_id
  ON public.academic_years(department_id);

-- ------------------------------------------------------------
-- 2. SELECT — replace the 002 open-view policy.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can view academic years"
  ON public.academic_years;
CREATE POLICY "Scoped academic year viewing"
  ON public.academic_years FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin()
    OR (
      public.is_admin()
      AND (
        department_id IS NULL
        OR public.is_program_admin_for(department_id)
      )
    )
    OR (
      NOT public.is_admin()
      AND NOT public.is_super_admin()
      AND EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = auth.uid()
          AND (
            academic_years.department_id IS NULL
            OR u.department_id = academic_years.department_id
            OR (
              u.department_id IS NULL
              AND EXISTS (
                SELECT 1 FROM public.departments d
                WHERE d.id = academic_years.department_id
                  AND lower(btrim(d.name)) = lower(btrim(u.department))
              )
            )
          )
      )
    )
  );

-- ------------------------------------------------------------
-- 3. Writes — replace the 015 admin-or-super policies.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Admin can insert academic years"
  ON public.academic_years;
CREATE POLICY "Scoped academic year insert"
  ON public.academic_years FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (
      public.is_admin()
      AND department_id IS NOT NULL
      AND public.is_program_admin_for(department_id)
    )
  );

DROP POLICY IF EXISTS "Admin can update academic years"
  ON public.academic_years;
CREATE POLICY "Scoped academic year update"
  ON public.academic_years FOR UPDATE
  TO authenticated
  USING (
    public.is_super_admin()
    OR (
      public.is_admin()
      AND department_id IS NOT NULL
      AND public.is_program_admin_for(department_id)
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR (
      public.is_admin()
      AND department_id IS NOT NULL
      AND public.is_program_admin_for(department_id)
    )
  );

DROP POLICY IF EXISTS "Admin can delete academic years"
  ON public.academic_years;
CREATE POLICY "Scoped academic year delete"
  ON public.academic_years FOR DELETE
  TO authenticated
  USING (
    public.is_super_admin()
    OR (
      public.is_admin()
      AND department_id IS NOT NULL
      AND public.is_program_admin_for(department_id)
    )
  );

NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------
-- 4. POST-MIGRATION VERIFICATION (run manually in SQL editor)
--    a) Column exists:
--       SELECT column_name FROM information_schema.columns
--         WHERE table_name = 'academic_years' AND column_name = 'department_id';
--    b) Only the new policies remain:
--       SELECT policyname, cmd FROM pg_policies
--         WHERE schemaname = 'public' AND tablename = 'academic_years';
--    c) As scoped (BSHM) admin: SELECT * FROM academic_years
--       returns only own-program + shared (NULL) rows.
--    d) Assign ownership, e.g.:
--       UPDATE public.academic_years SET department_id = '<BSIT_ID>'
--         WHERE year = '2025-2026' AND semester = '1st Semester';
-- ------------------------------------------------------------
