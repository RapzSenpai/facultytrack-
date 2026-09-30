-- ============================================================
-- Migration 029: Fix Notifications Table Permissions and Delete RLS
-- Resolves: Notifications deleted on one device still showing up
-- on other devices because PostgreSQL table-level DELETE permission 
-- was not granted to the authenticated role, causing deletes to fail silently.
-- ============================================================

-- 1. Explicitly grant full permissions to authenticated and service_role
GRANT ALL ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

-- 2. Ensure RLS is active
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- 3. Re-create clean RLS policies for notifications
DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;
CREATE POLICY "Users can view own notifications"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
CREATE POLICY "Users can update own notifications"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own notifications" ON public.notifications;
CREATE POLICY "Users can delete own notifications"
  ON public.notifications FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users and system can insert notifications" ON public.notifications;
CREATE POLICY "Users and system can insert notifications"
  ON public.notifications FOR INSERT
  TO authenticated, service_role
  WITH CHECK (true);

-- 4. Tell PostgREST to immediately refresh its schema cache
NOTIFY pgrst, 'reload schema';
