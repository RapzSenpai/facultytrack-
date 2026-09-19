-- ============================================
-- FacultyTrack Fixes
-- Run this after 001, 002, 003 are already applied
-- ============================================

-- Fix faculty RLS policy (old one compared column to itself)
DROP POLICY IF EXISTS "Faculty can view faculty and students in same dept" ON users;

CREATE POLICY "Faculty can view faculty and students in same dept"
  ON users FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users AS u
      WHERE u.id = auth.uid()
      AND u.role = 'faculty'
      AND (u.department = users.department OR users.role = 'student')
    )
  );

-- Add missing UNIQUE constraint on academic_years (safe if already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'academic_years_year_semester_key'
    AND conrelid = 'academic_years'::regclass
  ) THEN
    ALTER TABLE academic_years ADD UNIQUE(year, semester);
  END IF;
END $$;
