-- ============================================================
-- FacultyTrack: Migration 036 — Fix Subject Issue Department Notifications
--
-- Ensures:
-- 1. Subject issue reports and priority concern notifications correctly deliver
--    to assigned program/department admins as well as super_admin.
-- 2. Strictly prevents cross-department leakage (other department admins never receive them).
-- 3. Robustly resolves student department_id from department name and vice-versa.
-- ============================================================

-- 1. Backfill department_id on users table where missing
UPDATE public.users u
SET department_id = d.id
FROM public.departments d
WHERE u.department_id IS NULL
  AND u.department IS NOT NULL
  AND public.match_department(d.name, u.department);

-- 2. Enhanced Trigger Function for New Subject Correction Requests
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
  v_canonical_dept text;
BEGIN
  -- Look up student details from public.users
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

  -- Auto-resolve department_id if missing
  IF v_student_dept_id IS NULL AND v_student_dept IS NOT NULL AND btrim(v_student_dept) <> '' THEN
    SELECT d.id INTO v_student_dept_id
    FROM public.departments d
    WHERE public.match_department(d.name, v_student_dept)
    LIMIT 1;
  END IF;

  -- Auto-resolve department name if missing
  IF (v_student_dept IS NULL OR btrim(v_student_dept) = '') AND v_student_dept_id IS NOT NULL THEN
    SELECT d.name INTO v_student_dept
    FROM public.departments d
    WHERE d.id = v_student_dept_id;
  END IF;

  v_canonical_dept := public.get_canonical_dept(v_student_dept);

  -- Build formatted notification message with clear department tag
  v_msg := '[' || COALESCE(NULLIF(v_canonical_dept, ''), 'General') || '] ' || 
           v_student_name || ' (' || COALESCE(v_student_dept, 'General') || 
           CASE 
             WHEN v_student_year IS NOT NULL OR v_student_section IS NOT NULL 
             THEN ' ' || COALESCE(v_student_year, '') || ' - ' || COALESCE(v_student_section, '') 
             ELSE '' 
           END || 
           ') reported: "' || SUBSTRING(NEW.message FROM 1 FOR 80) || 
           CASE WHEN LENGTH(NEW.message) > 80 THEN '...' ELSE '' END || '"';

  -- Insert notifications strictly for:
  --   1. super_admin (global visibility)
  --   2. admin assigned to the student's department via admin_program_assignments OR matching users table
  -- Program admins of OTHER departments are STRICTLY excluded!
  INSERT INTO public.notifications (user_id, title, message, type, link)
  SELECT DISTINCT
    u.id,
    '[' || COALESCE(NULLIF(v_canonical_dept, ''), 'General') || '] New Subject Issue Reported',
    v_msg,
    'warning',
    '/admin/subject-corrections'
  FROM public.users u
  WHERE u.status != 'deleted'
    AND (
      u.role = 'super_admin'
      OR (
        u.role = 'admin'
        AND (
          EXISTS (
            SELECT 1 
            FROM public.admin_program_assignments apa
            LEFT JOIN public.departments d ON d.id = apa.department_id
            WHERE apa.admin_id = u.id
              AND (
                (v_student_dept_id IS NOT NULL AND apa.department_id = v_student_dept_id)
                OR (v_student_dept IS NOT NULL AND d.name IS NOT NULL AND public.match_department(d.name, v_student_dept))
              )
          )
          OR (
            (v_student_dept_id IS NOT NULL AND u.department_id = v_student_dept_id)
            OR (v_student_dept IS NOT NULL AND u.department IS NOT NULL AND public.match_department(u.department, v_student_dept))
          )
        )
      )
    )
    -- Deduplication guard: do not re-insert identical notification within 15 seconds
    AND NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.user_id = u.id
        AND n.title LIKE '%New Subject Issue Reported%'
        AND n.created_at > now() - interval '15 seconds'
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_new_subject_correction_notify ON public.subject_correction_requests;
CREATE TRIGGER trg_new_subject_correction_notify
AFTER INSERT ON public.subject_correction_requests
FOR EACH ROW EXECUTE FUNCTION public.trg_notify_admin_new_correction_fn();

-- 3. Enhanced notify_admins_for_department RPC
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
  v_clean_dept text := btrim(COALESCE(p_department, ''));
BEGIN
  IF p_title IS NULL OR btrim(p_title) = '' OR p_message IS NULL OR btrim(p_message) = '' THEN
    RETURN 0;
  END IF;

  -- Resolve department ID from name using canonical matching
  IF v_target_dept_id IS NULL AND v_clean_dept <> '' THEN
    SELECT d.id INTO v_target_dept_id
    FROM public.departments d
    WHERE public.match_department(d.name, v_clean_dept)
    LIMIT 1;
  END IF;

  -- Resolve department name from ID if name was not provided
  IF v_clean_dept = '' AND v_target_dept_id IS NOT NULL THEN
    SELECT d.name INTO v_clean_dept
    FROM public.departments d
    WHERE d.id = v_target_dept_id;
  END IF;

  -- Strict delivery:
  -- If target department is known, deliver to super_admin + matching program admins.
  -- If target department could NOT be resolved, deliver to super_admin ONLY (never blast other admins!).
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
          AND (
            (v_target_dept_id IS NOT NULL AND (
              EXISTS (
                SELECT 1 
                FROM public.admin_program_assignments apa
                WHERE apa.admin_id = u.id
                  AND apa.department_id = v_target_dept_id
              )
              OR u.department_id = v_target_dept_id
            ))
            OR (v_clean_dept <> '' AND (
              (u.department IS NOT NULL AND public.match_department(u.department, v_clean_dept))
              OR EXISTS (
                SELECT 1 
                FROM public.admin_program_assignments apa
                JOIN public.departments d ON d.id = apa.department_id
                WHERE apa.admin_id = u.id
                  AND public.match_department(d.name, v_clean_dept)
              )
            ))
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
GRANT EXECUTE ON FUNCTION public.match_department(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_canonical_dept(text) TO authenticated;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
