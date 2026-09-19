-- ============================================================
-- FacultyTrack: Security & Approval Flow Migration (Reviewed)
-- File: supabase/migrations/005_security_and_approval_fixes.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. HELPER FUNCTION: Check if auth user is Admin (NO RECURSION)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;


-- ------------------------------------------------------------
-- 2. TRIGGER: Auto-create user profile as 'pending'
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
    role, status, email_verified, department, year_level, section, photo_url
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
    COALESCE(NEW.raw_user_meta_data->>'year_level', ''),
    COALESCE(NEW.raw_user_meta_data->>'section', ''),
    COALESCE(NEW.raw_user_meta_data->>'photo_url', '')
  )
  ON CONFLICT (id) DO NOTHING;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ------------------------------------------------------------
-- 3. RLS POLICIES FOR 'public.users'
-- ------------------------------------------------------------

-- Clean up older or conflicting policies
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
DROP POLICY IF EXISTS "Users can update own profile safely" ON public.users;
DROP POLICY IF EXISTS "Admin can update any user" ON public.users;
DROP POLICY IF EXISTS "Admin can delete users" ON public.users;
DROP POLICY IF EXISTS "Public can view users" ON public.users;
DROP POLICY IF EXISTS "Anyone can view users" ON public.users;

-- Admin full update access
CREATE POLICY "Admin can update any user"
  ON public.users FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Regular users can only update their own profile (CANNOT touch role or status)
CREATE POLICY "Users can update own profile safely"
  ON public.users FOR UPDATE
  TO authenticated
  USING (auth.uid() = id AND NOT public.is_admin())
  WITH CHECK (
    auth.uid() = id
    AND role = (SELECT u.role FROM public.users u WHERE u.id = auth.uid())
    AND status = (SELECT u.status FROM public.users u WHERE u.id = auth.uid())
    AND approved_at IS NOT DISTINCT FROM (SELECT u.approved_at FROM public.users u WHERE u.id = auth.uid())
  );

-- Admin delete access
CREATE POLICY "Admin can delete users"
  ON public.users FOR DELETE
  TO authenticated
  USING (public.is_admin());


-- ------------------------------------------------------------
-- 4. SECURE RPC: Delete User Account (Admin Rejection)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_user_account(target_user_id UUID)
RETURNS void AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Only administrators can delete accounts.';
  END IF;

  DELETE FROM auth.users WHERE id = target_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ------------------------------------------------------------
-- 5. SECURE RPC: Pre-Auth School ID Lookup (Login)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_school_id(p_school_id TEXT)
RETURNS TEXT AS $$
DECLARE
  found_email TEXT;
BEGIN
  SELECT email INTO found_email
  FROM public.users
  WHERE school_id = p_school_id
  LIMIT 1;

  RETURN found_email;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ------------------------------------------------------------
-- 6. SECURE RPC: Check Account Status (Pending Polling)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_account_status(p_identifier TEXT)
RETURNS TEXT AS $$
DECLARE
  found_status TEXT;
BEGIN
  SELECT status INTO found_status
  FROM public.users
  WHERE email = p_identifier OR school_id = p_identifier
  LIMIT 1;

  RETURN found_status;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
