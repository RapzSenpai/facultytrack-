-- ============================================================
-- FacultyTrack: Phase 7 — Super Admin + Program Scoping + Exports
-- File: supabase/migrations/013_phase7_super_admin_scoping.sql
-- Blueprint v3, Phase 7. Apply AFTER 001-012.
--
-- Client decisions implemented here:
--   D8   Program Head is NOT a separate role: Program Head =
--        Admin with a program assignment.
--   D9   Admins/Program Heads see and manage ONLY their assigned
--        program(s). Unassigned admin = no program data.
--   Req 10 / §4.6  super_admin role: all access + audit-gated
--        identity reveal. First super admin provisioned via SQL
--        (snippet at the bottom).
--   D11  Admin (scoped) + Super Admin export reports.
--   D13  Exports are statistics/numbers ONLY — no comment text,
--        no AI summaries, no identity. Enforced by the
--        export-report Edge Function contract (no comment
--        columns are ever selected there).
--
-- Backfill note (IMPORTANT): every EXISTING plain admin is
-- assigned to ALL existing programs below, preserving today's
-- behavior on day one. The super admin can narrow access later
-- by deleting rows in admin_program_assignments. New admins
-- created after this migration start unassigned (D9 strict).
-- ============================================================

-- ------------------------------------------------------------
-- 1. super_admin role [Req 10]
--    001 created users.role with CHECK (role IN ('admin','faculty','student')).
--    Constraint was added inline => auto-named users_role_check.
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_role_check'
      AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users DROP CONSTRAINT users_role_check;
  END IF;
END
$$;

ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'super_admin', 'faculty', 'student'));

-- ------------------------------------------------------------
-- 2. HELPERS — MUST be created before the policies below:
--    CREATE POLICY validates referenced functions at creation
--    time, so any use-before-define fails with 42883.
--    All SECURITY DEFINER (RLS-invisible, no recursion).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'super_admin'
  );
$$;

-- D9 gate for rows carrying department_id:
-- super admin => true; admin assigned to that program => true;
-- admin without the assignment => false; others => false.
CREATE OR REPLACE FUNCTION public.is_program_admin_for(p_department_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_super_admin()
    OR (
      public.is_admin()
      AND p_department_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.admin_program_assignments a
        WHERE a.admin_id = auth.uid()
          AND a.department_id = p_department_id
      )
    );
$$;

-- Same gate for tables that only carry the department TEXT name.
CREATE OR REPLACE FUNCTION public.is_program_admin_for_name(p_department text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_super_admin()
    OR (
      public.is_admin()
      AND p_department IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.admin_program_assignments a
        JOIN public.departments d ON d.id = a.department_id
        WHERE a.admin_id = auth.uid()
          AND lower(btrim(d.name)) = lower(btrim(p_department))
      )
    );
$$;

-- Programs (department ids) assigned to the caller (admins only).
CREATE OR REPLACE FUNCTION public.admin_assigned_department_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ARRAY(
    SELECT a.department_id
    FROM public.admin_program_assignments a
    WHERE a.admin_id = auth.uid()
  );
$$;

-- ------------------------------------------------------------
-- 3. admin_program_assignments (admin_id <-> department_id)
--    Admin with >=1 assignment = "Program Head" for those
--    programs [D8]. super_admin needs no rows.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_program_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (admin_id, department_id)
);

CREATE INDEX IF NOT EXISTS idx_apa_admin
  ON public.admin_program_assignments(admin_id);
CREATE INDEX IF NOT EXISTS idx_apa_department
  ON public.admin_program_assignments(department_id);

ALTER TABLE public.admin_program_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read program assignments"
  ON public.admin_program_assignments;
CREATE POLICY "Admins read program assignments"
  ON public.admin_program_assignments FOR SELECT
  TO authenticated
  USING (public.is_admin() OR public.is_super_admin());

DROP POLICY IF EXISTS "Super admin manages program assignments"
  ON public.admin_program_assignments;
CREATE POLICY "Super admin manages program assignments"
  ON public.admin_program_assignments FOR ALL
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- ------------------------------------------------------------
-- 4. BACKFILL: existing plain admins -> assigned to ALL existing
--    programs (preserves current behavior; super admin narrows
--    later). Idempotent via the UNIQUE pair.
-- ------------------------------------------------------------
INSERT INTO public.admin_program_assignments (admin_id, department_id)
SELECT u.id, d.id
FROM public.users u
CROSS JOIN public.departments d
WHERE u.role = 'admin'
  AND EXISTS (SELECT 1 FROM public.departments LIMIT 1)
ON CONFLICT (admin_id, department_id) DO NOTHING;

-- ------------------------------------------------------------
-- 5. D9 policy rewrites (guarded; re-runnable)
-- ------------------------------------------------------------

-- 5a. users: admin sees only own program's users [D9].
DROP POLICY IF EXISTS "Admin can view all users" ON public.users;
CREATE POLICY "Admin can view all users"
  ON public.users FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin()
    OR (
      public.is_admin()
      AND (
        department_id IS NOT NULL
        AND public.is_program_admin_for(department_id)
      )
    )
  );

DROP POLICY IF EXISTS "Admin can update any user" ON public.users;
CREATE POLICY "Admin can update any user"
  ON public.users FOR UPDATE
  TO authenticated
  USING (public.is_super_admin() OR public.is_program_admin_for(department_id))
  WITH CHECK (public.is_super_admin() OR public.is_program_admin_for(department_id));

DROP POLICY IF EXISTS "Admin can delete users" ON public.users;
CREATE POLICY "Admin can delete users"
  ON public.users FOR DELETE
  TO authenticated
  USING (public.is_super_admin() OR public.is_program_admin_for(department_id));

-- 5b. class_assignments: admin writes scoped to their programs.
DROP POLICY IF EXISTS "Faculty can view own assignments" ON public.class_assignments;
CREATE POLICY "Faculty can view own assignments"
  ON public.class_assignments FOR SELECT
  TO authenticated
  USING (
    faculty_id = auth.uid()
    OR public.is_super_admin()
    OR public.is_program_admin_for(department_id)
    OR public.is_program_admin_for_name(department)
  );

DROP POLICY IF EXISTS "Admin can insert class assignments" ON public.class_assignments;
CREATE POLICY "Admin can insert class assignments"
  ON public.class_assignments FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR public.is_program_admin_for(department_id)
    OR public.is_program_admin_for_name(department)
  );

DROP POLICY IF EXISTS "Admin can update class assignments" ON public.class_assignments;
CREATE POLICY "Admin can update class assignments"
  ON public.class_assignments FOR UPDATE
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

DROP POLICY IF EXISTS "Admin can delete class assignments" ON public.class_assignments;
CREATE POLICY "Admin can delete class assignments"
  ON public.class_assignments FOR DELETE
  TO authenticated
  USING (
    public.is_super_admin()
    OR public.is_program_admin_for(department_id)
    OR public.is_program_admin_for_name(department)
  );

-- 5c. departments: writes scoped (rows carry id + name).
DROP POLICY IF EXISTS "Admin can insert departments" ON public.departments;
CREATE POLICY "Admin can insert departments"
  ON public.departments FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR public.is_program_admin_for(id)
    OR public.is_program_admin_for_name(name)
  );

DROP POLICY IF EXISTS "Admin can update departments" ON public.departments;
CREATE POLICY "Admin can update departments"
  ON public.departments FOR UPDATE
  TO authenticated
  USING (
    public.is_super_admin()
    OR public.is_program_admin_for(id)
    OR public.is_program_admin_for_name(name)
  )
  WITH CHECK (
    public.is_super_admin()
    OR public.is_program_admin_for(id)
    OR public.is_program_admin_for_name(name)
  );

DROP POLICY IF EXISTS "Admin can delete departments" ON public.departments;
CREATE POLICY "Admin can delete departments"
  ON public.departments FOR DELETE
  TO authenticated
  USING (
    public.is_super_admin()
    OR public.is_program_admin_for(id)
    OR public.is_program_admin_for_name(name)
  );

-- 5d. student_enrollments: admin management scoped by the
--     student's program [D9].
DROP POLICY IF EXISTS "Admin can manage enrollments" ON public.student_enrollments;
CREATE POLICY "Admin can manage enrollments"
  ON public.student_enrollments FOR ALL
  TO authenticated
  USING (
    student_id = auth.uid()
    OR public.is_super_admin()
    OR (
      public.is_admin()
      AND EXISTS (
        SELECT 1 FROM public.users s
        WHERE s.id = student_id
          AND (
            (s.department_id IS NOT NULL AND public.is_program_admin_for(s.department_id))
            OR public.is_program_admin_for_name(s.department)
          )
      )
    )
  )
  WITH CHECK (
    student_id = auth.uid()
    OR public.is_super_admin()
    OR (
      public.is_admin()
      AND EXISTS (
        SELECT 1 FROM public.users s
        WHERE s.id = student_id
          AND (
            (s.department_id IS NOT NULL AND public.is_program_admin_for(s.department_id))
            OR public.is_program_admin_for_name(s.department)
          )
      )
    )
  );

-- 5e. subject_correction_requests: admin scope via the requesting
--     student's program.
DROP POLICY IF EXISTS "Admins can manage correction requests"
  ON public.subject_correction_requests;
CREATE POLICY "Admins can manage correction requests"
  ON public.subject_correction_requests FOR ALL
  TO authenticated
  USING (
    student_id = auth.uid()
    OR public.is_super_admin()
    OR (
      public.is_admin()
      AND EXISTS (
        SELECT 1 FROM public.users s
        WHERE s.id = student_id
          AND (
            (s.department_id IS NOT NULL AND public.is_program_admin_for(s.department_id))
            OR public.is_program_admin_for_name(s.department)
          )
      )
    )
  )
  WITH CHECK (
    student_id = auth.uid()
    OR public.is_super_admin()
    OR (
      public.is_admin()
      AND EXISTS (
        SELECT 1 FROM public.users s
        WHERE s.id = student_id
          AND (
            (s.department_id IS NOT NULL AND public.is_program_admin_for(s.department_id))
            OR public.is_program_admin_for_name(s.department)
          )
      )
    )
  );

-- 5f. grade_submissions: admin read scoped by the faculty's program.
DROP POLICY IF EXISTS "Admin can view grade submissions"
  ON public.grade_submissions;
CREATE POLICY "Admin can view grade submissions"
  ON public.grade_submissions FOR SELECT
  TO authenticated
  USING (
    faculty_id = auth.uid()
    OR public.is_super_admin()
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

-- 5g. evaluation_releases: GLOBAL rows (department IS NULL) become
--     super-admin-only; program rows manageable by that program's
--     admins [D9/D10 design from Phase 5].
DROP POLICY IF EXISTS "Admin can manage evaluation releases"
  ON public.evaluation_releases;
CREATE POLICY "Admin can manage evaluation releases"
  ON public.evaluation_releases FOR ALL
  TO authenticated
  USING (
    public.is_super_admin()
    OR (
      public.is_admin()
      AND department IS NOT NULL
      AND public.is_program_admin_for_name(department)
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR (
      public.is_admin()
      AND department IS NOT NULL
      AND public.is_program_admin_for_name(department)
    )
  );

-- 5h. evaluations: moderation + delete scoped by the evaluated
--     faculty member's program.
DROP POLICY IF EXISTS "Admin can moderate evaluations" ON public.evaluations;
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

DROP POLICY IF EXISTS "Admin can delete evaluations" ON public.evaluations;
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

-- 5i. blocked_words / priority_reviews: keep is_admin() (global
--     moderation config + queue) — super admins pass is_admin()
--     too? is_admin() checks role='admin' ONLY. Extend both to
--     include super_admin explicitly.
DROP POLICY IF EXISTS "Admin can manage blocked words" ON public.blocked_words;
CREATE POLICY "Admin can manage blocked words"
  ON public.blocked_words FOR ALL
  TO authenticated
  USING (public.is_admin() OR public.is_super_admin())
  WITH CHECK (public.is_admin() OR public.is_super_admin());

DROP POLICY IF EXISTS "Admin can manage priority reviews"
  ON public.priority_reviews;
CREATE POLICY "Admin can manage priority reviews"
  ON public.priority_reviews FOR ALL
  TO authenticated
  USING (public.is_admin() OR public.is_super_admin())
  WITH CHECK (public.is_admin() OR public.is_super_admin());

-- 5j. admin_evaluations_anon: admin branch now program-scoped;
--     super admin sees everything.
DROP VIEW IF EXISTS public.admin_evaluations_anon;
CREATE VIEW public.admin_evaluations_anon AS
SELECT
  e.id,
  e.assignment_id,
  e.faculty_id,
  md5(e.student_id::text) AS student_token,
  u.department AS student_department,
  e.academic_year,
  e.semester,
  e.ratings,
  e.comment,
  e.original_comment,
  e.moderation_status,
  e.moderation_labels,
  e.is_priority,
  e.priority_source,
  e.submitted_at::date AS submitted_on
FROM public.evaluations e
LEFT JOIN public.users u ON u.id = e.student_id
WHERE EXISTS (
  SELECT 1 FROM public.users au
  WHERE au.id = auth.uid()
    AND au.role IN ('admin', 'super_admin')
    AND (
      au.role = 'super_admin'
      OR EXISTS (
        SELECT 1 FROM public.users f
        WHERE f.id = e.faculty_id
          AND (
            (f.department_id IS NOT NULL AND public.is_program_admin_for(f.department_id))
            OR public.is_program_admin_for_name(f.department)
          )
      )
    )
);

-- ------------------------------------------------------------
-- 6. Audit-gated identity reveal (completes the §4.6 promise
--    from Phase 4): super admin only, every call audit-logged.
--    Returns the minimum needed to act on a priority case.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reveal_student_identity(p_evaluation_id uuid)
RETURNS TABLE (student_id uuid, full_name text, school_id text, department text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: super admin only.';
  END IF;

  RETURN QUERY
  SELECT s.id, s.full_name, s.school_id, s.department
  FROM public.evaluations e
  JOIN public.users s ON s.id = e.student_id
  WHERE e.id = p_evaluation_id;

  INSERT INTO public.audit_log (actor_id, actor_role, action, entity, entity_id, details)
  VALUES (
    auth.uid(),
    'super_admin',
    'evaluation.reveal_identity',
    'evaluations',
    p_evaluation_id::text,
    jsonb_build_object('via', 'reveal_student_identity')
  );
END;
$$;

-- ------------------------------------------------------------
-- 7. POST-MIGRATION VERIFICATION (run manually in SQL editor)
--
--    a) Role constraint allows super_admin:
--       SELECT pg_get_constraintdef(oid) FROM pg_constraint
--         WHERE conname = 'users_role_check';
--
--    b) Backfill: each existing admin has one row per program:
--       SELECT admin_id, count(*) FROM admin_program_assignments
--         GROUP BY admin_id;
--
--    c) Provision the FIRST super admin (required — without one,
--       nobody can manage program assignments):
--       UPDATE public.users SET role = 'super_admin'
--         WHERE email = '<your-admin-email>';
--
--    d) After provisioning (as the super admin): manage
--       assignments in the new admin page; as a scoped admin,
--       confirm out-of-program rows disappear from
--       Faculty/Student/Class Assignment/Report pages.
-- ------------------------------------------------------------
