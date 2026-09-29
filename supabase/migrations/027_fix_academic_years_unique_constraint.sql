-- ============================================================
-- FacultyTrack: Migration 027 — Fix academic_years unique constraint
--
-- Replaces the global UNIQUE(year, semester) constraint from 004
-- with scoped unique indexes so that different departments can have
-- their own schedules for the same academic year and semester.
-- ============================================================

-- 1. Drop the old global constraint
ALTER TABLE public.academic_years
  DROP CONSTRAINT IF EXISTS academic_years_year_semester_key;

-- 2. Enforce uniqueness per department: department_id + year + semester
CREATE UNIQUE INDEX IF NOT EXISTS idx_academic_years_dept_year_sem
  ON public.academic_years(department_id, year, semester)
  WHERE department_id IS NOT NULL;

-- 3. Enforce uniqueness for shared/global periods (department_id IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS idx_academic_years_shared_year_sem
  ON public.academic_years(year, semester)
  WHERE department_id IS NULL;
