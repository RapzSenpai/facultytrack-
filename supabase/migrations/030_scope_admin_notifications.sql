-- ============================================================
-- FacultyTrack: Migration 030 — Scope Admin Notifications by Department (Corrected)
--
-- Fixes:
-- 1. Corrects column reference on public.users (uses full_name instead of name).
-- 2. Scopes admin notifications on subject correction requests to:
--    - super_admin (global visibility)
--    - admin assigned to the student's department via admin_program_assignments
-- 3. Automatic deduplication preventing double alerts.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Scoped Trigger Function: Subject Correction Requests
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_notify_admin_new_correction_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student_name text;
  v_student_dept text;
  v_student_dept_id uuid;
  v_student_year text;
  v_student_section text;
  v_msg text;
BEGIN
  -- Look up student details from public.users using exact schema columns
  SELECT 
    COALESCE(NULLIF(btrim(full_name), ''), email, 'A student'),
    department,
    department_id,
    year_level,
    section
  INTO 
    v_student_name,
    v_student_dept,
    v_student_dept_id,
    v_student_year,
    v_student_section
  FROM public.users
  WHERE id = NEW.student_id;

  -- Build informative message matching student details
  v_msg := v_student_name || ' (' || COALESCE(v_student_dept, 'General') || 
           CASE 
             WHEN v_student_year IS NOT NULL OR v_student_section IS NOT NULL 
             THEN ' ' || COALESCE(v_student_year, '') || ' - ' || COALESCE(v_student_section, '') 
             ELSE '' 
           END || 
           ') reported: "' || SUBSTRING(NEW.message FROM 1 FOR 80) || 
           CASE WHEN LENGTH(NEW.message) > 80 THEN '...' ELSE '' END || '"';

  -- Insert notifications strictly for:
  --   1. super_admin (global visibility)
  --   2. admin assigned to the student's department via admin_program_assignments
  INSERT INTO public.notifications (user_id, title, message, type, link)
  SELECT DISTINCT
    u.id,
    'New Subject Issue Reported',
    v_msg,
    'warning',
    '/admin/subject-corrections'
  FROM public.users u
  WHERE u.status != 'deleted'
    AND (
      u.role = 'super_admin'
      OR (
        u.role = 'admin'
        AND EXISTS (
          SELECT 1 
          FROM public.admin_program_assignments apa
          LEFT JOIN public.departments d ON d.id = apa.department_id
          WHERE apa.admin_id = u.id
            AND (
              (v_student_dept_id IS NOT NULL AND apa.department_id = v_student_dept_id)
              OR (v_student_dept IS NOT NULL AND lower(btrim(d.name)) = lower(btrim(v_student_dept)))
            )
        )
      )
    )
    -- Deduplication guard: do not re-insert identical notification within 1 minute
    AND NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.user_id = u.id
        AND n.title = 'New Subject Issue Reported'
        AND n.created_at > now() - interval '1 minute'
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_new_subject_correction_notify ON public.subject_correction_requests;
CREATE TRIGGER trg_new_subject_correction_notify
AFTER INSERT ON public.subject_correction_requests
FOR EACH ROW EXECUTE FUNCTION public.trg_notify_admin_new_correction_fn();

-- ------------------------------------------------------------
-- 2. Server-Side RPC: Notify Admins for Department
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_admins_for_department(
  p_department text DEFAULT NULL,
  p_department_id uuid DEFAULT NULL,
  p_title text DEFAULT 'Admin Notification',
  p_message text DEFAULT '',
  p_type text DEFAULT 'info',
  p_link text DEFAULT NULL
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_target_dept_id uuid := p_department_id;
  v_notified_count int := 0;
BEGIN
  IF p_title IS NULL OR btrim(p_title) = '' OR p_message IS NULL OR btrim(p_message) = '' THEN
    RETURN 0;
  END IF;

  -- Resolve department ID from name if not directly provided
  IF v_target_dept_id IS NULL AND p_department IS NOT NULL AND btrim(p_department) <> '' THEN
    SELECT d.id INTO v_target_dept_id
    FROM public.departments d
    WHERE lower(btrim(d.name)) = lower(btrim(p_department))
    LIMIT 1;
  END IF;

  -- Insert notifications for super_admin + assigned admins
  WITH inserted AS (
    INSERT INTO public.notifications (user_id, title, message, type, link)
    SELECT DISTINCT
      u.id,
      p_title,
      p_message,
      p_type,
      p_link
    FROM public.users u
    WHERE u.status != 'deleted'
      AND (
        u.role = 'super_admin'
        OR (
          u.role = 'admin'
          AND v_target_dept_id IS NOT NULL
          AND EXISTS (
            SELECT 1 
            FROM public.admin_program_assignments apa
            WHERE apa.admin_id = u.id
              AND apa.department_id = v_target_dept_id
          )
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE n.user_id = u.id
          AND n.title = p_title
          AND n.created_at > now() - interval '15 seconds'
      )
    RETURNING id
  )
  SELECT count(*) INTO v_notified_count FROM inserted;

  RETURN v_notified_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_admins_for_department(text, uuid, text, text, text, text) TO authenticated;

-- ------------------------------------------------------------
-- 3. Reload PostgREST schema cache
-- ------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
