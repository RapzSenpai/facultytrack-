-- ============================================================
-- FacultyTrack: Migration 032 — Fix Department Notifications & Isolation
--
-- Fixes:
-- 1. Canonical SQL department matching function (match_department).
-- 2. Scopes student subject-issue notification trigger so program admins
--    (e.g. Entrep admin) NEVER receive notifications from other departments.
-- 3. Scopes notify_admins_for_department RPC with canonical resolution.
-- 4. Backfills department_id on users table using canonical department matching.
-- ============================================================

-- 1. Canonical department helpers in PostgreSQL
CREATE OR REPLACE FUNCTION public.get_canonical_dept(val text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN lower(regexp_replace(COALESCE(val, ''), '[^a-z0-9]', '', 'g')) LIKE '%hospitality%' 
         OR lower(regexp_replace(COALESCE(val, ''), '[^a-z0-9]', '', 'g')) IN ('bshm', 'hm') THEN 'BSHM'
    WHEN lower(regexp_replace(COALESCE(val, ''), '[^a-z0-9]', '', 'g')) LIKE '%informationtechnology%' 
         OR lower(regexp_replace(COALESCE(val, ''), '[^a-z0-9]', '', 'g')) LIKE '%infotech%' 
         OR lower(regexp_replace(COALESCE(val, ''), '[^a-z0-9]', '', 'g')) IN ('bsit', 'it') THEN 'BSIT'
    WHEN lower(regexp_replace(COALESCE(val, ''), '[^a-z0-9]', '', 'g')) LIKE '%entrepreneur%' 
         OR lower(regexp_replace(COALESCE(val, ''), '[^a-z0-9]', '', 'g')) IN ('bsentrep', 'bsentrepreneur', 'entrep') THEN 'BSEntrep'
    WHEN lower(regexp_replace(COALESCE(val, ''), '[^a-z0-9]', '', 'g')) LIKE '%secondary%' 
         OR lower(regexp_replace(COALESCE(val, ''), '[^a-z0-9]', '', 'g')) IN ('bsed', 'sed') THEN 'BSED'
    WHEN lower(regexp_replace(COALESCE(val, ''), '[^a-z0-9]', '', 'g')) LIKE '%elementary%' 
         OR lower(regexp_replace(COALESCE(val, ''), '[^a-z0-9]', '', 'g')) IN ('beed', 'eed') THEN 'BEED'
    WHEN lower(regexp_replace(COALESCE(val, ''), '[^a-z0-9]', '', 'g')) LIKE '%physical%' 
         OR lower(regexp_replace(COALESCE(val, ''), '[^a-z0-9]', '', 'g')) IN ('bped', 'ped') THEN 'BPED'
    ELSE upper(lower(regexp_replace(COALESCE(val, ''), '[^a-z0-9]', '', 'g')))
  END;
$$;

CREATE OR REPLACE FUNCTION public.match_department(dept_a text, dept_b text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(dept_a, '') <> '' AND COALESCE(dept_b, '') <> '' AND (
    public.get_canonical_dept(dept_a) = public.get_canonical_dept(dept_b)
    OR lower(regexp_replace(dept_a, '[^a-z0-9]', '', 'g')) = lower(regexp_replace(dept_b, '[^a-z0-9]', '', 'g'))
  );
$$;

-- 2. Backfill department_id on users table using canonical matcher
UPDATE public.users u
SET department_id = d.id
FROM public.departments d
WHERE u.department_id IS NULL
  AND u.department IS NOT NULL
  AND public.match_department(d.name, u.department);

-- 3. Replace Subject Correction Notification Trigger
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
  -- Program admins of OTHER departments (e.g. Entrep admin when an HM or Educ student reports) are STRICTLY excluded!
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
              OR (v_student_dept IS NOT NULL AND d.name IS NOT NULL AND public.match_department(d.name, v_student_dept))
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

-- 4. Server-Side RPC: Notify Admins for Department with Canonical Resolution
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

  -- Resolve department ID from name using canonical matching if not directly provided
  IF v_target_dept_id IS NULL AND p_department IS NOT NULL AND btrim(p_department) <> '' THEN
    SELECT d.id INTO v_target_dept_id
    FROM public.departments d
    WHERE public.match_department(d.name, p_department)
    LIMIT 1;
  END IF;

  -- Insert notifications for super_admin + assigned admins for this department ONLY
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
GRANT EXECUTE ON FUNCTION public.match_department(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_canonical_dept(text) TO authenticated;

-- 5. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
