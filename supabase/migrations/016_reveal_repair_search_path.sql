-- ============================================================
-- FacultyTrack: Fix 016 — reveal RPC repair + search_path
-- hardening (C6 + audit §5 hardening item).
-- Apply AFTER 001-015. Re-runnable. User applies via SQL editor.
--
-- 1. reveal_student_identity: STABLE + INSERT could never work
--    (Postgres rejects writes in STABLE functions) and the audit
--    row sat AFTER RETURN QUERY. Fixed: VOLATILE, audit FIRST,
--    search_path=''.
-- 2. Every other SECURITY DEFINER helper gets search_path=''
--    via ALTER FUNCTION (bodies already use schema-qualified
--    public.* / auth.* refs; pg_catalog stays implicit).
-- ============================================================

-- ------------------------------------------------------------
-- 1. reveal_student_identity repair
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reveal_student_identity(p_evaluation_id uuid)
RETURNS TABLE (student_id uuid, full_name text, school_id text, department text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: super admin only.';
  END IF;

  INSERT INTO public.audit_log (actor_id, actor_role, action, entity, entity_id, details)
  VALUES (
    auth.uid(),
    'super_admin',
    'evaluation.reveal_identity',
    'evaluations',
    p_evaluation_id::text,
    jsonb_build_object('via', 'reveal_student_identity')
  );

  RETURN QUERY
  SELECT s.id, s.full_name, s.school_id, s.department
  FROM public.evaluations e
  JOIN public.users s ON s.id = e.student_id
  WHERE e.id = p_evaluation_id;
END;
$$;

-- ------------------------------------------------------------
-- 2. Harden search_path on all other definer helpers.
--    ALTER ... SET only changes the stored config parameter;
--    bodies are untouched.
-- ------------------------------------------------------------
ALTER FUNCTION public.handle_new_user() SET search_path = '';
ALTER FUNCTION public.handle_user_updated() SET search_path = '';
ALTER FUNCTION public.is_admin() SET search_path = '';
ALTER FUNCTION public.delete_user_account(uuid) SET search_path = '';
ALTER FUNCTION public.resolve_school_id(text) SET search_path = '';
ALTER FUNCTION public.check_account_status(text) SET search_path = '';
ALTER FUNCTION public.log_id_photo_view(text) SET search_path = '';
ALTER FUNCTION public.is_evaluations_anonymous_access() SET search_path = '';
ALTER FUNCTION public.is_period_released(text, text, text) SET search_path = '';
ALTER FUNCTION public.get_faculty_escalation_status(text, text) SET search_path = '';
ALTER FUNCTION public.is_super_admin() SET search_path = '';
ALTER FUNCTION public.is_program_admin_for(uuid) SET search_path = '';
ALTER FUNCTION public.is_program_admin_for_name(text) SET search_path = '';
ALTER FUNCTION public.admin_assigned_department_ids() SET search_path = '';
ALTER FUNCTION public.is_faculty() SET search_path = '';
ALTER FUNCTION public.current_user_department() SET search_path = '';

-- ------------------------------------------------------------
-- 3. POST-MIGRATION VERIFICATION (run manually in SQL editor)
--    SELECT proname, provolatile, proconfig FROM pg_proc
--      WHERE pronamespace = 'public'::regnamespace
--        AND proname IN ('reveal_student_identity','is_admin',
--          'is_super_admin','is_period_released',
--          'get_faculty_escalation_status','log_id_photo_view',
--          'handle_new_user','resolve_school_id');
--    -> reveal = 'v' (volatile); every proconfig must contain
--       {search_path=}.
--    As super_admin:
--      SELECT * FROM public.reveal_student_identity('<eval-id>');
--    -> 1 row + 1 evaluation.reveal_identity audit row.
--    As admin/student: same call -> must raise Unauthorized.
-- ------------------------------------------------------------
