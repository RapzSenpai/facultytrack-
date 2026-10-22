-- ============================================================
-- Migration 038: Sync auth.users email when public.users email is updated
-- When an administrator edits a user's email address in the admin panel,
-- keep auth.users in sync so login credentials remain valid.
-- ============================================================

CREATE OR REPLACE FUNCTION public.sync_auth_email_on_user_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email AND NEW.email IS NOT NULL AND NEW.email <> '' THEN
    UPDATE auth.users
    SET email = NEW.email,
        email_confirmed_at = COALESCE(email_confirmed_at, now()),
        updated_at = now()
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_auth_email ON public.users;
CREATE TRIGGER trg_sync_auth_email
  AFTER UPDATE OF email ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_auth_email_on_user_update();
