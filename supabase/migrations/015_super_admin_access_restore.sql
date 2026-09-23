-- ============================================================
-- FacultyTrack: Fix 015 — Super Admin access restore (C7)
-- Audit ref: C7. storage policies + log_id_photo_view +
-- delete_user_account + taxonomy write policies checked
-- is_admin() (role='admin' only), locking super_admin out.
-- Apply AFTER 001-014. Re-runnable. User applies via SQL editor.
--
-- Scope preserved: super_admin gains global access; scoped
-- admin behavior from 013 is untouched.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Storage: school-id-photos view + delete for super_admin
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can view school ID photos"
  ON storage.objects;
CREATE POLICY "Admins can view school ID photos"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'school-id-photos'
    AND (public.is_admin() OR public.is_super_admin())
  );

DROP POLICY IF EXISTS "Admins can delete school ID photos"
  ON storage.objects;
CREATE POLICY "Admins can delete school ID photos"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'school-id-photos'
    AND (public.is_admin() OR public.is_super_admin())
  );

-- ------------------------------------------------------------
-- 2. log_id_photo_view: admins + super_admin
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_id_photo_view(p_path TEXT)
RETURNS void AS $$
BEGIN
  IF NOT (public.is_admin() OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Unauthorized: administrators only.';
  END IF;

  INSERT INTO public.audit_log (actor_id, actor_role, action, entity, entity_id, details)
  VALUES (
    auth.uid(),
    (SELECT role FROM public.users WHERE id = auth.uid()),
    'id_photo.view',
    'users.school_id_photo_path',
    p_path,
    jsonb_build_object('bucket', 'school-id-photos')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

-- ------------------------------------------------------------
-- 3. delete_user_account: admins + super_admin
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_user_account(target_user_id UUID)
RETURNS void AS $$
DECLARE
  target_role TEXT;
  target_program TEXT;
BEGIN
  IF public.is_super_admin() THEN
    DELETE FROM auth.users WHERE id = target_user_id;
    RETURN;
  END IF;

  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Only administrators can delete accounts.';
  END IF;

  SELECT u.role, u.department
    INTO target_role, target_program
  FROM public.users u
  WHERE u.id = target_user_id;

  IF target_role IS NULL THEN
    RAISE EXCEPTION 'Target user not found.';
  END IF;

  IF target_role IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Administrators cannot delete other administrators.';
  END IF;

  IF NOT (
    (target_program IS NOT NULL AND public.is_program_admin_for_name(target_program))
    OR (target_program IS NULL AND FALSE)
  ) THEN
    RAISE EXCEPTION 'Unauthorized: target user is outside your program scope.';
  END IF;

  DELETE FROM auth.users WHERE id = target_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

-- ------------------------------------------------------------
-- 4. Taxonomy write policies: admins + super_admin.
--    Replaces the 002 raw-EXISTS (role='admin') checks with the
--    hardened definer helpers (also removes the per-row users
--    subquery recursion risk). SELECT policies untouched.
-- ------------------------------------------------------------
-- subjects
DROP POLICY IF EXISTS "Admin can insert subjects" ON public.subjects;
CREATE POLICY "Admin can insert subjects"
  ON public.subjects FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() OR public.is_super_admin());

DROP POLICY IF EXISTS "Admin can update subjects" ON public.subjects;
CREATE POLICY "Admin can update subjects"
  ON public.subjects FOR UPDATE TO authenticated
  USING (public.is_admin() OR public.is_super_admin());

DROP POLICY IF EXISTS "Admin can delete subjects" ON public.subjects;
CREATE POLICY "Admin can delete subjects"
  ON public.subjects FOR DELETE TO authenticated
  USING (public.is_admin() OR public.is_super_admin());

-- academic_years
DROP POLICY IF EXISTS "Admin can insert academic years" ON public.academic_years;
CREATE POLICY "Admin can insert academic years"
  ON public.academic_years FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() OR public.is_super_admin());

DROP POLICY IF EXISTS "Admin can update academic years" ON public.academic_years;
CREATE POLICY "Admin can update academic years"
  ON public.academic_years FOR UPDATE TO authenticated
  USING (public.is_admin() OR public.is_super_admin());

DROP POLICY IF EXISTS "Admin can delete academic years" ON public.academic_years;
CREATE POLICY "Admin can delete academic years"
  ON public.academic_years FOR DELETE TO authenticated
  USING (public.is_admin() OR public.is_super_admin());

-- criteria (002 names: "Admin can manage criteria" = INSERT)
DROP POLICY IF EXISTS "Admin can manage criteria" ON public.criteria;
CREATE POLICY "Admin can manage criteria"
  ON public.criteria FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() OR public.is_super_admin());

DROP POLICY IF EXISTS "Admin can update criteria" ON public.criteria;
CREATE POLICY "Admin can update criteria"
  ON public.criteria FOR UPDATE TO authenticated
  USING (public.is_admin() OR public.is_super_admin());

DROP POLICY IF EXISTS "Admin can delete criteria" ON public.criteria;
CREATE POLICY "Admin can delete criteria"
  ON public.criteria FOR DELETE TO authenticated
  USING (public.is_admin() OR public.is_super_admin());

-- questions
DROP POLICY IF EXISTS "Admin can insert questions" ON public.questions;
CREATE POLICY "Admin can insert questions"
  ON public.questions FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() OR public.is_super_admin());

DROP POLICY IF EXISTS "Admin can update questions" ON public.questions;
CREATE POLICY "Admin can update questions"
  ON public.questions FOR UPDATE TO authenticated
  USING (public.is_admin() OR public.is_super_admin());

DROP POLICY IF EXISTS "Admin can delete questions" ON public.questions;
CREATE POLICY "Admin can delete questions"
  ON public.questions FOR DELETE TO authenticated
  USING (public.is_admin() OR public.is_super_admin());

-- ------------------------------------------------------------
-- 5. POST-MIGRATION VERIFICATION (run manually in SQL editor)
--    SELECT policyname FROM pg_policies
--      WHERE schemaname='storage' AND tablename='objects'
--      AND policyname ILIKE '%school ID%';
--    -> 4 policies; view/delete definitions must contain
--       is_super_admin.
--    As a super_admin session:
--      SELECT public.is_super_admin(); -> true
--      SELECT * FROM storage.objects
--        WHERE bucket_id='school-id-photos' LIMIT 1; -> allowed
--      SELECT public.log_id_photo_view('probe'); -> writes an
--        id_photo.view audit row (delete the probe row after).
--    As a scoped admin on an unassigned program's taxonomy row:
--      INSERT INTO public.subjects ... -> allowed (taxonomy is
--      global; program scoping applies to program data, not
--      taxonomy). Denied path: student/faculty INSERT ->
--      must fail.
-- ------------------------------------------------------------
