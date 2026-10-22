-- ============================================================
-- FacultyTrack: Migration 033 — Strict Department Notification Isolation & Purge
--
-- Fixes:
-- 1. Updates `trg_notify_admin_new_correction_fn` to strictly isolate notifications
--    by department so admins of other programs never receive cross-department notifications.
-- 2. Updates `notify_admins_for_department` RPC: eliminates the leaky fallback where
--    unresolved departments blasted notifications to all admins.
-- 3. One-time database cleanup: permanently purges leaked cross-department notifications
--    from admins' inboxes.
-- ============================================================

-- 1. Canonical department matching functions (re-runnable)
CREATE OR REPLACE FUNCTION public.get_canonical_dept(val text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN regexp_replace(lower(COALESCE(val, '')), '[^a-z0-9]', '', 'g') LIKE '%hospitality%' 
         OR regexp_replace(lower(COALESCE(val, '')), '[^a-z0-9]', '', 'g') IN ('bshm', 'hm') THEN 'BSHM'
    WHEN regexp_replace(lower(COALESCE(val, '')), '[^a-z0-9]', '', 'g') LIKE '%informationtechnology%' 
         OR regexp_replace(lower(COALESCE(val, '')), '[^a-z0-9]', '', 'g') LIKE '%infotech%' 
         OR regexp_replace(lower(COALESCE(val, '')), '[^a-z0-9]', '', 'g') IN ('bsit', 'it') THEN 'BSIT'
    WHEN regexp_replace(lower(COALESCE(val, '')), '[^a-z0-9]', '', 'g') LIKE '%entrepreneur%' 
         OR regexp_replace(lower(COALESCE(val, '')), '[^a-z0-9]', '', 'g') IN ('bsentrep', 'bsentrepreneur', 'entrep') THEN 'BSEntrep'
    WHEN regexp_replace(lower(COALESCE(val, '')), '[^a-z0-9]', '', 'g') LIKE '%secondary%' 
         OR regexp_replace(lower(COALESCE(val, '')), '[^a-z0-9]', '', 'g') IN ('bsed', 'sed') THEN 'BSED'
    WHEN regexp_replace(lower(COALESCE(val, '')), '[^a-z0-9]', '', 'g') LIKE '%elementary%' 
         OR regexp_replace(lower(COALESCE(val, '')), '[^a-z0-9]', '', 'g') IN ('beed', 'eed') THEN 'BEED'
    WHEN regexp_replace(lower(COALESCE(val, '')), '[^a-z0-9]', '', 'g') LIKE '%physical%' 
         OR regexp_replace(lower(COALESCE(val, '')), '[^a-z0-9]', '', 'g') IN ('bped', 'ped') THEN 'BPED'
    ELSE upper(regexp_replace(lower(COALESCE(val, '')), '[^a-z0-9]', '', 'g'))
  END;
$$;

CREATE OR REPLACE FUNCTION public.match_department(dept_a text, dept_b text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(dept_a, '') <> '' AND COALESCE(dept_b, '') <> '' AND (
    public.get_canonical_dept(dept_a) = public.get_canonical_dept(dept_b)
    OR regexp_replace(lower(dept_a), '[^a-z0-9]', '', 'g') = regexp_replace(lower(dept_b), '[^a-z0-9]', '', 'g')
  );
$$;

-- 2. Backfill department_id on users table where missing
UPDATE public.users u
SET department_id = d.id
FROM public.departments d
WHERE u.department_id IS NULL
  AND u.department IS NOT NULL
  AND public.match_department(d.name, u.department);

-- 3. Strict Subject Correction Notification Trigger
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
    -- Deduplication guard: do not re-insert identical notification within 1 minute
    AND NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.user_id = u.id
        AND n.title LIKE '%New Subject Issue Reported%'
        AND n.created_at > now() - interval '1 minute'
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_new_subject_correction_notify ON public.subject_correction_requests;
CREATE TRIGGER trg_new_subject_correction_notify
AFTER INSERT ON public.subject_correction_requests
FOR EACH ROW EXECUTE FUNCTION public.trg_notify_admin_new_correction_fn();

-- 4. Strict Server-Side RPC: notify_admins_for_department
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
          AND v_target_dept_id IS NOT NULL
          AND (
            EXISTS (
              SELECT 1 
              FROM public.admin_program_assignments apa
              WHERE apa.admin_id = u.id
                AND apa.department_id = v_target_dept_id
            )
            OR u.department_id = v_target_dept_id
            OR (v_clean_dept <> '' AND u.department IS NOT NULL AND public.match_department(u.department, v_clean_dept))
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

-- 5. One-time database cleanup: Purge old cross-department notifications from admin inboxes
-- Delete notifications where user is a scoped admin and the notification belongs to a different department
DELETE FROM public.notifications n
USING public.users u
WHERE n.user_id = u.id
  AND u.role = 'admin'
  AND (
    -- BSIT notifications mistakenly delivered to non-BSIT admins
    (
      (n.message ILIKE '%(BSIT%' OR n.message ILIKE '%[BSIT]%' OR n.title ILIKE '%[BSIT]%')
      AND NOT EXISTS (
        SELECT 1 FROM public.admin_program_assignments apa
        JOIN public.departments d ON d.id = apa.department_id
        WHERE apa.admin_id = u.id AND public.match_department(d.name, 'BSIT')
      )
      AND NOT public.match_department(COALESCE(u.department, ''), 'BSIT')
    )
    OR
    -- BSHM notifications mistakenly delivered to non-BSHM admins
    (
      (n.message ILIKE '%(BSHM%' OR n.message ILIKE '%[BSHM]%' OR n.title ILIKE '%[BSHM]%')
      AND NOT EXISTS (
        SELECT 1 FROM public.admin_program_assignments apa
        JOIN public.departments d ON d.id = apa.department_id
        WHERE apa.admin_id = u.id AND public.match_department(d.name, 'BSHM')
      )
      AND NOT public.match_department(COALESCE(u.department, ''), 'BSHM')
    )
    OR
    -- BSEntrep notifications mistakenly delivered to non-BSEntrep admins
    (
      (n.message ILIKE '%(BSEntrep%' OR n.message ILIKE '%[BSEntrep]%' OR n.title ILIKE '%[BSEntrep]%')
      AND NOT EXISTS (
        SELECT 1 FROM public.admin_program_assignments apa
        JOIN public.departments d ON d.id = apa.department_id
        WHERE apa.admin_id = u.id AND public.match_department(d.name, 'BSEntrep')
      )
      AND NOT public.match_department(COALESCE(u.department, ''), 'BSEntrep')
    )
    OR
    -- Generic un-scoped legacy trigger messages that were blasted to all admins
    (
      n.message = 'A student has submitted an issue regarding their assigned subject list.'
    )
  );

-- 6. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
