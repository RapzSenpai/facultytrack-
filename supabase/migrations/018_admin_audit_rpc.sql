-- ============================================================
-- FacultyTrack: Fix 018 — generic admin audit RPC (H8)
-- audit_log has no client-insert policy (service-role only),
-- so privileged admin writes had no audit trail. This single
-- SECURITY DEFINER RPC is the client-reachable audit path.
-- Apply AFTER 001-017. Re-runnable. User applies via SQL editor.
-- ============================================================

CREATE OR REPLACE FUNCTION public.log_admin_action(
  p_action text,
  p_entity text,
  p_entity_id text DEFAULT NULL,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT (public.is_admin() OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Unauthorized: administrators only.';
  END IF;

  INSERT INTO public.audit_log (actor_id, actor_role, action, entity, entity_id, details)
  VALUES (
    auth.uid(),
    (SELECT role FROM public.users WHERE id = auth.uid()),
    p_action,
    p_entity,
    p_entity_id,
    COALESCE(p_details, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.log_admin_action(text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_admin_action(text, text, text, jsonb) TO authenticated;

-- ------------------------------------------------------------
-- POST-MIGRATION VERIFICATION (run manually in SQL editor)
--    As admin: SELECT public.log_admin_action('test.ping',
--      'users', NULL, '{"probe":true}');
--    -> 1 audit_log row with your id. Delete the probe row via
--       service role / dashboard afterwards.
--    As student: same call -> must raise Unauthorized.
-- ------------------------------------------------------------
