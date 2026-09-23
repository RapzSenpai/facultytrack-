-- ============================================================
-- FacultyTrack: Phase 2 — School ID Photos (Req 1 / D12)
-- File: supabase/migrations/007_phase2_id_photos.sql
-- Apply AFTER 006. No deploy-order coupling: safe to apply
-- before or after the frontend release (the upload UI simply
-- appears once both are live).
--
-- D12 [CLIENT]: photo required for students AND faculty,
-- kept PERMANENTLY (no retention job). Cleanup happens only
-- on account rejection/deletion.
-- ============================================================

-- 1. Path column on users (storage object path, not a URL).
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS school_id_photo_path TEXT;

-- 2. Private bucket. file_size_limit + allowed_mime_types are
--    enforced by the storage service (trust boundary), the
--    frontend repeats them only for UX.
INSERT INTO storage.buckets (id, name, public)
VALUES ('school-id-photos', 'school-id-photos', false)
ON CONFLICT (id) DO NOTHING;

UPDATE storage.buckets
SET file_size_limit = 5242880, -- 5 MB
    allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp']
WHERE id = 'school-id-photos';

-- 3. Storage policies. Object path convention: {auth.uid}/{timestamp}.{ext}
--    so the first folder segment identifies the owner.
--    All CREATE POLICY statements are guarded (no IF NOT EXISTS in PG).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage'
    AND tablename='objects' AND policyname='Owner can view own school ID photos') THEN
    CREATE POLICY "Owner can view own school ID photos"
      ON storage.objects FOR SELECT TO authenticated
      USING (
        bucket_id = 'school-id-photos'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage'
    AND tablename='objects' AND policyname='Admins can view school ID photos') THEN
    CREATE POLICY "Admins can view school ID photos"
      ON storage.objects FOR SELECT TO authenticated
      USING (
        bucket_id = 'school-id-photos'
        AND public.is_admin()
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage'
    AND tablename='objects' AND policyname='Owner can upload own school ID photo') THEN
    CREATE POLICY "Owner can upload own school ID photo"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'school-id-photos'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage'
    AND tablename='objects' AND policyname='Admins can delete school ID photos') THEN
    CREATE POLICY "Admins can delete school ID photos"
      ON storage.objects FOR DELETE TO authenticated
      USING (
        bucket_id = 'school-id-photos'
        AND public.is_admin()
      );
  END IF;
END
$$;

-- 4. Audit hook: every admin view of an ID photo is logged.
--    audit_log has no client-insert policy; this SECURITY DEFINER
--    RPC is the only client-reachable write path, admin-gated.
CREATE OR REPLACE FUNCTION public.log_id_photo_view(p_path TEXT)
RETURNS void AS $$
BEGIN
  IF NOT public.is_admin() THEN
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- POST-MIGRATION VERIFICATION (SQL editor):
--   SELECT policyname FROM pg_policies
--     WHERE schemaname='storage' AND tablename='objects'
--     AND (policyname ILIKE '%school ID%');
--   -> expect exactly 4 policies.
--
--   SELECT id, public, file_size_limit, allowed_mime_types
--     FROM storage.buckets WHERE id = 'school-id-photos';
--   -> expect false / 5242880 / {jpeg,png,webp}.
-- ------------------------------------------------------------
