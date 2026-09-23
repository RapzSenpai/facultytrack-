BEGIN;

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

ALTER FUNCTION public.is_faculty() OWNER TO postgres;
ALTER FUNCTION public.current_user_department() OWNER TO postgres;
ALTER FUNCTION public.is_admin() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.is_faculty() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_user_department() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.is_faculty() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_department() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

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

COMMIT;