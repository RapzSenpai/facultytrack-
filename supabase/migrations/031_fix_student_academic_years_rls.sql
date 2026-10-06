-- ============================================================
-- FacultyTrack: Migration 031 — Fix Academic Years Viewing for Students
-- ============================================================
-- Problem: Migration 026 added strict program scoping to academic_years SELECT.
-- When a program admin creates an on-going period (e.g. for BSIT),
-- students whose department is stored as full text (e.g. "Bachelor of Science in
-- Information Technology" or "BSIT - BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY")
-- or students in other departments get 0 records from academic_years, causing their
-- dashboard to show Current Semester: —, Academic Year: —, and Evaluation: CLOSED.
--
-- Solution:
-- 1. Allow all authenticated users (students & faculty) to SELECT from academic_years.
--    Academic periods represent the school calendar. Access to specific teacher evaluations
--    is already securely restricted by class_assignments and enrollment matching.
-- 2. Backfill department_id on users table using fuzzy matching so students are properly
--    linked to their departments.
-- ============================================================

-- 1. Replace SELECT policy on academic_years so students can always see the academic calendar
DROP POLICY IF EXISTS "Scoped academic year viewing" ON public.academic_years;
DROP POLICY IF EXISTS "Anyone can view academic years" ON public.academic_years;
DROP POLICY IF EXISTS "Anyone authenticated can view academic years" ON public.academic_years;

CREATE POLICY "Anyone authenticated can view academic years"
  ON public.academic_years FOR SELECT
  TO authenticated
  USING (true);

-- 2. Backfill department_id on users table for any student/faculty with unlinked or descriptive department text
UPDATE public.users u
SET department_id = d.id
FROM public.departments d
WHERE u.department_id IS NULL
  AND (
    lower(btrim(d.name)) = lower(btrim(u.department))
    OR lower(btrim(u.department)) LIKE lower(btrim(d.name)) || '%'
    OR lower(btrim(d.name)) LIKE lower(btrim(u.department)) || '%'
    OR lower(btrim(d.description)) = lower(btrim(u.department))
    OR lower(btrim(u.department)) LIKE '%' || lower(btrim(d.name)) || '%'
  );

NOTIFY pgrst, 'reload schema';
