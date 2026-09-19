-- ============================================
-- FacultyTrack Database Schema
-- Run this in Supabase SQL Editor
-- ============================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- 1. DEPARTMENTS
-- ============================================
CREATE TABLE departments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- 2. SUBJECTS
-- ============================================
CREATE TABLE subjects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- 3. USERS (extends Supabase auth.users)
-- ============================================
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL DEFAULT '',
  first_name TEXT DEFAULT '',
  last_name TEXT DEFAULT '',
  suffix TEXT DEFAULT '',
  school_id TEXT UNIQUE,
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('admin', 'faculty', 'student')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'inactive')),
  email_verified BOOLEAN DEFAULT false,
  department TEXT DEFAULT '',
  year_level TEXT DEFAULT '',
  section TEXT DEFAULT '',
  contact_number TEXT DEFAULT '',
  photo_url TEXT DEFAULT '',
  position TEXT DEFAULT '',
  specialization TEXT DEFAULT '',
  office_location TEXT DEFAULT '',
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- 4. ACADEMIC YEARS
-- ============================================
CREATE TABLE academic_years (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  year TEXT NOT NULL,
  semester TEXT NOT NULL,
  start_date TEXT DEFAULT '',
  end_date TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'on-going' CHECK (status IN ('on-going', 'closed')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(year, semester)
);

-- ============================================
-- 5. CLASS ASSIGNMENTS
-- ============================================
CREATE TABLE class_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  faculty_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  faculty_name TEXT DEFAULT '',
  subject_code TEXT NOT NULL,
  subject_name TEXT DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  year_level TEXT NOT NULL DEFAULT '',
  section TEXT NOT NULL DEFAULT '',
  semester TEXT NOT NULL DEFAULT '',
  academic_year TEXT NOT NULL DEFAULT ''
);

-- ============================================
-- 6. CRITERIA
-- ============================================
CREATE TABLE criteria (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- 7. QUESTIONS
-- ============================================
CREATE TABLE questions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  criteria_id UUID NOT NULL REFERENCES criteria(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  "order" INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- 8. EVALUATIONS
-- ============================================
CREATE TABLE evaluations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assignment_id UUID NOT NULL REFERENCES class_assignments(id) ON DELETE CASCADE,
  faculty_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  academic_year TEXT NOT NULL DEFAULT '',
  semester TEXT NOT NULL DEFAULT '',
  ratings JSONB NOT NULL DEFAULT '{}',
  comment TEXT DEFAULT '',
  submitted_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(student_id, assignment_id)
);

-- ============================================
-- 9. EMAIL VERIFICATIONS
-- ============================================
CREATE TABLE email_verifications (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- 10. STUDENT ENROLLMENTS
-- ============================================
CREATE TABLE student_enrollments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  academic_year TEXT NOT NULL,
  semester TEXT NOT NULL,
  confirmed_assignments UUID[] DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(student_id, academic_year, semester)
);

-- ============================================
-- INDEXES for performance
-- ============================================
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_school_id ON users(school_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_class_assignments_faculty ON class_assignments(faculty_id);
CREATE INDEX idx_class_assignments_academic_year ON class_assignments(academic_year, semester);
CREATE INDEX idx_evaluations_student ON evaluations(student_id);
CREATE INDEX idx_evaluations_faculty ON evaluations(faculty_id);
CREATE INDEX idx_evaluations_assignment ON evaluations(assignment_id);
CREATE INDEX idx_questions_criteria ON questions(criteria_id);
CREATE INDEX idx_student_enrollments_student ON student_enrollments(student_id);
CREATE INDEX idx_student_enrollments_lookup ON student_enrollments(student_id, academic_year, semester);
