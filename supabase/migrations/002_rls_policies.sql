-- ============================================
-- FacultyTrack Row Level Security Policies
-- Run this AFTER 001_initial_schema.sql
-- ============================================

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE academic_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_enrollments ENABLE ROW LEVEL SECURITY;

-- ============================================
-- USERS policies
-- ============================================
CREATE POLICY "Users can view own profile"
  ON users FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Admin can view all users"
  ON users FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

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

CREATE POLICY "Student can view own profile only"
  ON users FOR SELECT
  USING (
    auth.uid() = id
    AND EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'student')
  );

CREATE POLICY "Admin can update any user"
  ON users FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Users can update own profile"
  ON users FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Service role inserts users"
  ON users FOR INSERT
  WITH CHECK (true);

-- ============================================
-- DEPARTMENTS policies (admin only write)
-- ============================================
CREATE POLICY "Anyone can view departments"
  ON departments FOR SELECT
  USING (true);

CREATE POLICY "Admin can insert departments"
  ON departments FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admin can update departments"
  ON departments FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admin can delete departments"
  ON departments FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- ============================================
-- SUBJECTS policies (admin only write)
-- ============================================
CREATE POLICY "Anyone can view subjects"
  ON subjects FOR SELECT
  USING (true);

CREATE POLICY "Admin can insert subjects"
  ON subjects FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admin can update subjects"
  ON subjects FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admin can delete subjects"
  ON subjects FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- ============================================
-- ACADEMIC YEARS policies (admin only write)
-- ============================================
CREATE POLICY "Anyone can view academic years"
  ON academic_years FOR SELECT
  USING (true);

CREATE POLICY "Admin can insert academic years"
  ON academic_years FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admin can update academic years"
  ON academic_years FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admin can delete academic years"
  ON academic_years FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- ============================================
-- CLASS ASSIGNMENTS policies
-- ============================================
CREATE POLICY "Faculty can view own assignments"
  ON class_assignments FOR SELECT
  USING (
    faculty_id = auth.uid()
    OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Students can view assignments for enrolled subjects"
  ON class_assignments FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'student')
  );

CREATE POLICY "Admin can insert class assignments"
  ON class_assignments FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admin can update class assignments"
  ON class_assignments FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admin can delete class assignments"
  ON class_assignments FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- ============================================
-- CRITERIA policies
-- ============================================
CREATE POLICY "Anyone can view criteria"
  ON criteria FOR SELECT
  USING (true);

CREATE POLICY "Admin can manage criteria"
  ON criteria FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admin can update criteria"
  ON criteria FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admin can delete criteria"
  ON criteria FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- ============================================
-- QUESTIONS policies
-- ============================================
CREATE POLICY "Anyone can view questions"
  ON questions FOR SELECT
  USING (true);

CREATE POLICY "Admin can insert questions"
  ON questions FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admin can update questions"
  ON questions FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admin can delete questions"
  ON questions FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- ============================================
-- EVALUATIONS policies
-- ============================================
CREATE POLICY "Students can insert own evaluations"
  ON evaluations FOR INSERT
  WITH CHECK (
    student_id = auth.uid()
    AND EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'student')
  );

CREATE POLICY "Faculty can view evaluations for own classes"
  ON evaluations FOR SELECT
  USING (
    faculty_id = auth.uid()
    OR student_id = auth.uid()
    OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Students can update own evaluations"
  ON evaluations FOR UPDATE
  USING (
    student_id = auth.uid()
  );

CREATE POLICY "Admin can delete evaluations"
  ON evaluations FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- ============================================
-- EMAIL VERIFICATIONS policies
-- ============================================
CREATE POLICY "Anyone can read email verifications"
  ON email_verifications FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert email verifications"
  ON email_verifications FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update email verifications"
  ON email_verifications FOR UPDATE
  USING (true);

-- ============================================
-- STUDENT ENROLLMENTS policies
-- ============================================
CREATE POLICY "Students can view own enrollments"
  ON student_enrollments FOR SELECT
  USING (
    student_id = auth.uid()
    OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Students can insert own enrollments"
  ON student_enrollments FOR INSERT
  WITH CHECK (
    student_id = auth.uid()
  );

CREATE POLICY "Students can update own enrollments"
  ON student_enrollments FOR UPDATE
  USING (
    student_id = auth.uid()
  );

CREATE POLICY "Admin can manage enrollments"
  ON student_enrollments FOR ALL
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );
