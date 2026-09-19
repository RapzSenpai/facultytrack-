-- ============================================
-- FacultyTrack Auth Trigger
-- Run this AFTER 001_initial_schema.sql and 002_rls_policies.sql
-- ============================================

-- Function: auto-create user profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, first_name, last_name, role, status, email_verified, department, photo_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'role', 'student'),
    CASE
      WHEN COALESCE(NEW.raw_user_meta_data->>'role', 'student') = 'student' THEN 'active'
      ELSE 'pending'
    END,
    COALESCE((NEW.raw_user_meta_data->>'email_verified')::boolean, false),
    COALESCE(NEW.raw_user_meta_data->>'department', ''),
    COALESCE(NEW.raw_user_meta_data->>'photo_url', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger: fire on new auth user
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- Function: auto-update updated_at on user changes
-- ============================================
CREATE OR REPLACE FUNCTION public.handle_user_updated()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_user_updated
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_user_updated();
