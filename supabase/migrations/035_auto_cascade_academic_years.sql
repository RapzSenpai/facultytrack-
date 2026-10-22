-- ============================================================
-- FacultyTrack: Migration 035 — Auto Cascade Academic Years
--
-- 1. One-time cleanup of all orphaned records from previously deleted periods
-- 2. Automatic trigger on academic_years so future deletes cascade to child tables
-- ============================================================

-- 1. Delete orphaned evaluation submissions
DELETE FROM public.evaluations
WHERE NOT EXISTS (
  SELECT 1 FROM public.academic_years ay
  WHERE ay.year = evaluations.academic_year
    AND ay.semester = evaluations.semester
);

-- 2. Delete orphaned class assignments
DELETE FROM public.class_assignments
WHERE NOT EXISTS (
  SELECT 1 FROM public.academic_years ay
  WHERE ay.year = class_assignments.academic_year
    AND ay.semester = class_assignments.semester
);

-- 3. Delete orphaned evaluation releases
DELETE FROM public.evaluation_releases
WHERE NOT EXISTS (
  SELECT 1 FROM public.academic_years ay
  WHERE ay.year = evaluation_releases.academic_year
    AND ay.semester = evaluation_releases.semester
);

-- 4. Delete orphaned student enrollments
DELETE FROM public.student_enrollments
WHERE NOT EXISTS (
  SELECT 1 FROM public.academic_years ay
  WHERE ay.year = student_enrollments.academic_year
    AND ay.semester = student_enrollments.semester
);

-- 5. Cascade trigger function
CREATE OR REPLACE FUNCTION public.cascade_delete_academic_year()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Delete evaluations matching year and semester
  DELETE FROM public.evaluations
  WHERE academic_year = OLD.year AND semester = OLD.semester;

  -- Delete class_assignments
  DELETE FROM public.class_assignments
  WHERE academic_year = OLD.year AND semester = OLD.semester
    AND (OLD.department_id IS NULL OR department_id = OLD.department_id);

  -- Delete evaluation_releases
  DELETE FROM public.evaluation_releases
  WHERE academic_year = OLD.year AND semester = OLD.semester;

  -- Delete student_enrollments
  DELETE FROM public.student_enrollments
  WHERE academic_year = OLD.year AND semester = OLD.semester;

  RETURN OLD;
END;
$$;

-- 6. Attach trigger to academic_years
DROP TRIGGER IF EXISTS trg_cascade_delete_academic_year ON public.academic_years;
CREATE TRIGGER trg_cascade_delete_academic_year
AFTER DELETE ON public.academic_years
FOR EACH ROW
EXECUTE FUNCTION public.cascade_delete_academic_year();
