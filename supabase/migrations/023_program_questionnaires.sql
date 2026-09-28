-- ============================================================
-- FacultyTrack: Migration 023 — per-program questionnaires (D9)
-- Apply AFTER 001-022. Run in Supabase SQL Editor, then refresh.
--
-- criteria gains department_id (NULL = shared/global item).
-- Existing rows stay NULL (shared) to preserve today's behavior;
-- the super admin assigns ownership afterward by setting
-- department_id per row. New rows created by a scoped admin are
-- stamped with their own program (enforced below + in UI).
-- questions inherit scope through their parent criteria row.
--
-- Read rule: super sees all; scoped admin sees own-program +
-- shared rows; students/faculty/anon read as before (evaluation
-- form must render for everyone).
-- Write rule: super anything; scoped admin only own-program rows
-- (shared rows are read-only for them).
--
-- Requires helpers from 005/010/013: is_admin(),
-- is_super_admin(), is_program_admin_for(uuid).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Column + index (re-runnable).
-- ------------------------------------------------------------
ALTER TABLE public.criteria
  ADD COLUMN IF NOT EXISTS department_id UUID
  REFERENCES public.departments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_criteria_department_id
  ON public.criteria(department_id);

-- ------------------------------------------------------------
-- 2. CRITERIA policies — replace the 002 open manage policies.
--    (SELECT stays readable for the evaluation form; admin
--    reads are scoped to own program + shared.)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can view criteria"
  ON public.criteria;
CREATE POLICY "Scoped criteria viewing"
  ON public.criteria FOR SELECT
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
    )
  );

DROP POLICY IF EXISTS "Admin can manage criteria"
  ON public.criteria;
DROP POLICY IF EXISTS "Admin can update criteria"
  ON public.criteria;
DROP POLICY IF EXISTS "Admin can delete criteria"
  ON public.criteria;

CREATE POLICY "Scoped criteria insert"
  ON public.criteria FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (
      public.is_admin()
      AND department_id IS NOT NULL
      AND public.is_program_admin_for(department_id)
    )
  );

CREATE POLICY "Scoped criteria update"
  ON public.criteria FOR UPDATE
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

CREATE POLICY "Scoped criteria delete"
  ON public.criteria FOR DELETE
  TO authenticated
  USING (
    public.is_super_admin()
    OR (
      public.is_admin()
      AND department_id IS NOT NULL
      AND public.is_program_admin_for(department_id)
    )
  );

-- ------------------------------------------------------------
-- 3. QUESTIONS policies — scope inherited from parent criteria.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can view questions"
  ON public.questions;
CREATE POLICY "Scoped question viewing"
  ON public.questions FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin()
    OR (
      public.is_admin()
      AND EXISTS (
        SELECT 1 FROM public.criteria c
        WHERE c.id = criteria_id
          AND (
            c.department_id IS NULL
            OR public.is_program_admin_for(c.department_id)
          )
      )
    )
    OR (
      NOT public.is_admin()
      AND NOT public.is_super_admin()
    )
  );

DROP POLICY IF EXISTS "Admin can insert questions"
  ON public.questions;
DROP POLICY IF EXISTS "Admin can update questions"
  ON public.questions;
DROP POLICY IF EXISTS "Admin can delete questions"
  ON public.questions;

CREATE POLICY "Scoped question insert"
  ON public.questions FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (
      public.is_admin()
      AND EXISTS (
        SELECT 1 FROM public.criteria c
        WHERE c.id = criteria_id
          AND c.department_id IS NOT NULL
          AND public.is_program_admin_for(c.department_id)
      )
    )
  );

CREATE POLICY "Scoped question update"
  ON public.questions FOR UPDATE
  TO authenticated
  USING (
    public.is_super_admin()
    OR (
      public.is_admin()
      AND EXISTS (
        SELECT 1 FROM public.criteria c
        WHERE c.id = criteria_id
          AND c.department_id IS NOT NULL
          AND public.is_program_admin_for(c.department_id)
      )
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR (
      public.is_admin()
      AND EXISTS (
        SELECT 1 FROM public.criteria c
        WHERE c.id = criteria_id
          AND c.department_id IS NOT NULL
          AND public.is_program_admin_for(c.department_id)
      )
    )
  );

CREATE POLICY "Scoped question delete"
  ON public.questions FOR DELETE
  TO authenticated
  USING (
    public.is_super_admin()
    OR (
      public.is_admin()
      AND EXISTS (
        SELECT 1 FROM public.criteria c
        WHERE c.id = criteria_id
          AND c.department_id IS NOT NULL
          AND public.is_program_admin_for(c.department_id)
      )
    )
  );

-- ------------------------------------------------------------
-- 4. Reload PostgREST schema cache.
-- ------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------
-- 5. POST-MIGRATION VERIFICATION (run manually in SQL editor)
--    a) Column exists:
--       SELECT column_name FROM information_schema.columns
--         WHERE table_name = 'criteria' AND column_name = 'department_id';
--    b) Only the new policies remain:
--       SELECT policyname FROM pg_policies
--         WHERE schemaname = 'public'
--           AND tablename IN ('criteria', 'questions');
--    c) As scoped (BSHM) admin: SELECT * FROM criteria returns
--       only own-program + shared (NULL) rows.
--    d) Assign ownership, e.g.:
--       UPDATE public.criteria SET department_id = '<BSIT_ID>'
--         WHERE name = '<criterion>';
-- ------------------------------------------------------------
