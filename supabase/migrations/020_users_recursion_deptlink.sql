-- ============================================================
-- FacultyTrack: Fix 020 — kill users UPDATE recursion, link
-- department_id at signup, admin name-fallback on users
-- Audit refs: ID-photo "infinite recursion detected in policy
-- for relation users" (008 self-update policy subqueries the
-- users table inside its own WITH CHECK); scoped-admin
-- approval/dashboard blindness on NULL department_id rows.
-- Apply AFTER 001-019. Re-runnable. User applies via SQL editor.
--
-- 1. "Users can update own profile safely" rewritten with NO
--    self-table subqueries (recursion-free). The locked-field
--    guard moves to a BEFORE UPDATE trigger comparing OLD/NEW
--    directly (no table reads => cannot recurse).
-- 2. handle_new_user resolves department_id from the
--    department name at signup (definer => bypasses RLS).
-- 3. Backfill NULL department_id rows (safe re-run of 006).
-- 4. Users admin SELECT/UPDATE/DELETE gain the same
--    is_program_admin_for_name(department) fallback the other
--    program tables already use (covers legacy NULL-id rows).
-- ============================================================

-- ------------------------------------------------------------
-- 1a. Recursion-free self-update policy (replaces 008 version)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Users can update own profile safely"
  ON public.users;

CREATE POLICY "Users can update own profile safely"
  ON public.users FOR UPDATE
  TO authenticated
  USING (auth.uid() = id AND NOT public.is_admin())
  WITH CHECK (auth.uid() = id AND NOT public.is_admin());

-- ------------------------------------------------------------
-- 1b. Locked-field trigger (role/status/approved_at/program).
--     Fires for every UPDATE; admins/super bypass; students and
--     faculty can still edit names/contact/photo/photo-path.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lock_own_profile_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- No user JWT (SQL-editor migrations, backfills, service-role
  -- writes): nothing to lock — row ownership for app users is
  -- enforced by RLS, not here. Without this escape hatch the
  -- backfill in section 3 would trip this very trigger.
  IF auth.uid() IS NULL OR auth.uid() <> OLD.id THEN
    RETURN NEW;
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF public.is_super_admin() THEN
      RETURN NEW;
    END IF;
    IF public.is_admin() THEN
      RAISE EXCEPTION 'You cannot change roles to or from admin privileges on your own row.';
    END IF;
  END IF;
  IF public.is_admin() OR public.is_super_admin() THEN
    RETURN NEW;
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role
    OR NEW.status IS DISTINCT FROM OLD.status
    OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
    OR NEW.department IS DISTINCT FROM OLD.department
    OR NEW.department_id IS DISTINCT FROM OLD.department_id
    OR NEW.year_level IS DISTINCT FROM OLD.year_level
    OR NEW.section IS DISTINCT FROM OLD.section
    OR NEW.school_id IS DISTINCT FROM OLD.school_id
    OR NEW.email_verified IS DISTINCT FROM OLD.email_verified
  THEN
    RAISE EXCEPTION 'You cannot change your role, status, or program assignment. Ask an administrator to correct it (you can report it in-app).';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_own_profile_fields ON public.users;
CREATE TRIGGER trg_lock_own_profile_fields
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.lock_own_profile_fields();

-- ------------------------------------------------------------
-- 2. handle_new_user resolves department_id at signup
--    (same whitelist/shape as 005, plus the id lookup)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  assigned_role TEXT;
BEGIN
  assigned_role := COALESCE(NEW.raw_user_meta_data->>'role', 'student');

  -- Prevent privilege escalation via raw_user_meta_data
  IF assigned_role NOT IN ('student', 'faculty') THEN
    assigned_role := 'student';
  END IF;

  INSERT INTO public.users (
    id, email, full_name, first_name, last_name, suffix, school_id,
    role, status, email_verified, department, department_id,
    year_level, section, photo_url
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'suffix', ''),
    NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'school_id', '')), ''),
    assigned_role,
    'pending', -- All self-registrations require approval
    COALESCE((NEW.raw_user_meta_data->>'email_verified')::boolean, false),
    COALESCE(NEW.raw_user_meta_data->>'department', ''),
    (
      SELECT d.id FROM public.departments d
      WHERE btrim(COALESCE(NEW.raw_user_meta_data->>'department', '')) <> ''
        AND lower(btrim(d.name)) = lower(btrim(COALESCE(NEW.raw_user_meta_data->>'department', '')))
      LIMIT 1
    ),
    COALESCE(NEW.raw_user_meta_data->>'year_level', ''),
    COALESCE(NEW.raw_user_meta_data->>'section', ''),
    COALESCE(NEW.raw_user_meta_data->>'photo_url', '')
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER FUNCTION public.handle_new_user() SET search_path = '';

-- ------------------------------------------------------------
-- 3. Backfill NULL department_id (006 re-run, idempotent)
-- ------------------------------------------------------------
UPDATE public.users u
SET department_id = d.id
FROM public.departments d
WHERE u.department_id IS NULL
  AND btrim(COALESCE(u.department, '')) <> ''
  AND lower(btrim(d.name)) = lower(btrim(u.department));

UPDATE public.class_assignments ca
SET department_id = d.id
FROM public.departments d
WHERE ca.department_id IS NULL
  AND btrim(COALESCE(ca.department, '')) <> ''
  AND lower(btrim(d.name)) = lower(btrim(ca.department));

-- ------------------------------------------------------------
-- 4. Users admin policies: name fallback alongside id match
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Admin can view all users" ON public.users;
CREATE POLICY "Admin can view all users"
  ON public.users FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin()
    OR (
      public.is_admin()
      AND (
        (department_id IS NOT NULL AND public.is_program_admin_for(department_id))
        OR public.is_program_admin_for_name(department)
      )
    )
  );

DROP POLICY IF EXISTS "Admin can update any user" ON public.users;
CREATE POLICY "Admin can update any user"
  ON public.users FOR UPDATE
  TO authenticated
  USING (
    public.is_super_admin()
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
    OR (
      public.is_admin()
      AND (
        (department_id IS NOT NULL AND public.is_program_admin_for(department_id))
        OR public.is_program_admin_for_name(department)
      )
    )
  );

DROP POLICY IF EXISTS "Admin can delete users" ON public.users;
CREATE POLICY "Admin can delete users"
  ON public.users FOR DELETE
  TO authenticated
  USING (
    public.is_super_admin()
    OR (
      public.is_admin()
      AND (
        (department_id IS NOT NULL AND public.is_program_admin_for(department_id))
        OR public.is_program_admin_for_name(department)
      )
    )
  );

-- ------------------------------------------------------------
-- 5. POST-MIGRATION VERIFICATION (run manually in SQL editor)
--    a) No users policy text may contain "FROM public.users":
--       SELECT policyname FROM pg_policies WHERE tablename='users'
--       AND (qual LIKE '%FROM public.users%' OR with_check LIKE
--       '%FROM public.users%') -> 0 rows. (Recursion source gone.)
--    b) As a student: UPDATE public.users
--       SET school_id_photo_path='probe' WHERE id=auth.uid();
--       -> success (revert afterwards). Role change attempt:
--       UPDATE public.users SET role='admin' WHERE id=auth.uid();
--       -> trigger exception, no recursion error.
--    c) SELECT count(*) FROM public.users WHERE department_id
--       IS NULL AND btrim(COALESCE(department,'')) <> '';
--       -> 0 (or only rows whose program name matches no
--       department — create the department or fix the name).
--    d) As a scoped admin: pending users of your program are
--       visible and approvable; other programs invisible.
-- ------------------------------------------------------------
