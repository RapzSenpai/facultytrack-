-- ============================================================
-- FacultyTrack: Migration 027 — super-only audit_log reads
-- Writes already flow via log_admin_action (018, SECURITY DEFINER).
-- No SELECT policy exists, so the System Monitor audit viewer
-- needs this read path. Super-only: scoped admins have no business
-- in cross-program audit trails.
-- Re-runnable.
-- ============================================================

DROP POLICY IF EXISTS "Super admin can view audit log"
  ON public.audit_log;
CREATE POLICY "Super admin can view audit log"
  ON public.audit_log FOR SELECT
  TO authenticated
  USING (public.is_super_admin());

NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------
-- POST-MIGRATION VERIFICATION (run manually in SQL editor)
--    As super_admin: SELECT COUNT(*) FROM public.audit_log;
--    As scoped admin: same query -> 0 rows (no error).
-- ------------------------------------------------------------
