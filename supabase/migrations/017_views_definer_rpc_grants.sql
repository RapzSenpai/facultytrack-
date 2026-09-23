-- ============================================================
-- FacultyTrack: Fix 017 — anon views definer + RPC grants
-- Audit refs: H5 (plain-invoker views return zero under base
-- RLS deny), H6 (unauthenticated RPC exposure).
-- Apply AFTER 001-016. Re-runnable. User applies via SQL editor.
--
-- 1. The three anon views filter by auth.uid() THEMSELVES
--    (faculty_id = caller; admin caller + program scope), so
--    running them as the view owner is safe — and required,
--    because base evaluations SELECT is denied for faculty and
--    for admins (009/013). This implements the security_invoker
--    = false intent already documented in 009.
-- 2. check_account_status / delete_user_account /
--    log_id_photo_view / reveal_student_identity are revoked
--    from anon: every legitimate caller holds a session
--    (PendingApproval polls while signed in; admin actions run
--    as admin). resolve_school_id STAYS publicly callable: the
--    pre-auth school-ID login flow (Login.jsx) requires it.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Definer views (PG15+ security_invoker parameter)
-- ------------------------------------------------------------
ALTER VIEW public.faculty_evaluations_anon SET (security_invoker = false);
ALTER VIEW public.admin_evaluations_anon SET (security_invoker = false);
ALTER VIEW public.faculty_release_status SET (security_invoker = false);

-- ------------------------------------------------------------
-- 2. RPC grant hardening
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.check_account_status(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_account_status(text) TO authenticated;

REVOKE ALL ON FUNCTION public.delete_user_account(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_user_account(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.log_id_photo_view(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_id_photo_view(text) TO authenticated;

REVOKE ALL ON FUNCTION public.reveal_student_identity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reveal_student_identity(uuid) TO authenticated;

-- resolve_school_id intentionally left PUBLIC: Login.jsx calls it
-- pre-auth to map school ID -> email. It returns at most one
-- email for an exact school-ID match (oracle tradeoff accepted
-- and required for the login UX).

-- ------------------------------------------------------------
-- 3. POST-MIGRATION VERIFICATION (run manually in SQL editor)
--    SELECT c.relname AS viewname, c.reloptions
--      FROM pg_class c
--      JOIN pg_namespace n ON n.oid = c.relnamespace
--      WHERE n.nspname = 'public'
--        AND c.relname IN ('faculty_evaluations_anon',
--          'admin_evaluations_anon', 'faculty_release_status');
--    -> reloptions includes security_invoker=false for all three.
--    As faculty: SELECT * FROM faculty_evaluations_anon LIMIT 1;
--      -> own released rows only (no student_id column exists).
--    As faculty: SELECT * FROM evaluations LIMIT 1;
--      -> 0 rows (base deny intact).
--    Anon (no JWT): SELECT public.check_account_status('x');
--      -> permission denied. Authenticated: works.
-- ------------------------------------------------------------
