-- NOTE (Fix 021-plan): no explicit BEGIN/COMMIT here — `supabase db
-- push` runs each migration in its own transaction; nested
-- transaction control breaks the push. OWNER/GRANT statements
-- below were also removed: hosted DBs reject OWNER TO postgres,
-- and default function grants suffice (admin gates live inside
-- the definer bodies).

CREATE OR REPLACE FUNCTION public.is_faculty()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = (SELECT auth.uid())
      AND role = 'faculty'
  );
$$;

CREATE OR REPLACE FUNCTION public.current_user_department()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT department::text
  FROM public.users
  WHERE id = (SELECT auth.uid())
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = (SELECT auth.uid())
      AND role = 'admin'
  );
$$;

DROP POLICY IF EXISTS "Users can view own profile" ON public.users;
CREATE POLICY "Users can view own profile"
  ON public.users FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "Student can view own profile only" ON public.users;

DROP POLICY IF EXISTS "Admin can view all users" ON public.users;
CREATE POLICY "Admin can view all users"
  ON public.users FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Faculty can view own and co-faculty profiles"
  ON public.users;
CREATE POLICY "Faculty can view own and co-faculty profiles"
  ON public.users FOR SELECT
  TO authenticated
  USING (
    id = (SELECT auth.uid())
    OR (
      public.is_faculty()
      AND role = 'faculty'
      AND department = public.current_user_department()
    )
  );
