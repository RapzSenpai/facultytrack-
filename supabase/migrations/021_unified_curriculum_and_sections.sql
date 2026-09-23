-- ============================================================
-- FacultyTrack: Migration 021 — Unified Curriculum & Sections
-- File: supabase/migrations/021_unified_curriculum_and_sections.sql
-- (Renumbered from 014: a second 014 existed and duplicate
-- versions break `supabase db push` ordering. Content unchanged
-- apart from the pgcrypto guard below.)
--
-- Unifies academic structure into a clean hierarchy:
--   Department / Program (e.g., BSIT)
--     └── Year Level (1st, 2nd, 3rd, 4th)
--           ├── Sections (dynamic per program & year level)
--           └── Subjects (cataloged by program, year level & semester)
-- ============================================================

-- Enable UUID generation extensions if not present
-- (uuid-ossp for uuid_generate_v4, pgcrypto for gen_random_uuid)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------
-- 1. SECTIONS TABLE
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID REFERENCES public.departments(id) ON DELETE CASCADE,
  department TEXT NOT NULL,
  year_level TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(department, year_level, name)
);

CREATE INDEX IF NOT EXISTS idx_sections_dept_year
  ON public.sections(department, year_level);

-- ------------------------------------------------------------
-- 2. ENHANCE SUBJECTS TABLE
-- ------------------------------------------------------------
ALTER TABLE public.subjects
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS department TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS year_level TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS semester TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS units INTEGER DEFAULT 3;

CREATE INDEX IF NOT EXISTS idx_subjects_dept_year
  ON public.subjects(department, year_level);

-- ------------------------------------------------------------
-- 3. ROW LEVEL SECURITY (RLS) FOR SECTIONS
-- ------------------------------------------------------------
ALTER TABLE public.sections ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sections'
      AND policyname = 'Anyone authenticated can view sections'
  ) THEN
    CREATE POLICY "Anyone authenticated can view sections"
      ON public.sections FOR SELECT
      TO authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sections'
      AND policyname = 'Admins can manage sections'
  ) THEN
    CREATE POLICY "Admins can manage sections"
      ON public.sections FOR ALL
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.users
          WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.users
          WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
        )
      );
  END IF;
END
$$;

-- ------------------------------------------------------------
-- 4. SEED INITIAL SECTIONS FOR EXISTING PROGRAMS
-- ------------------------------------------------------------
DO $$
DECLARE
  dept_rec RECORD;
  yl TEXT;
  sec TEXT;
  year_levels TEXT[] := ARRAY['1st', '2nd', '3rd', '4th'];
  default_sections TEXT[] := ARRAY['A', 'B'];
BEGIN
  FOR dept_rec IN SELECT id, name FROM public.departments LOOP
    FOREACH yl IN ARRAY year_levels LOOP
      FOREACH sec IN ARRAY default_sections LOOP
        INSERT INTO public.sections (department_id, department, year_level, name)
        VALUES (dept_rec.id, dept_rec.name, yl, sec)
        ON CONFLICT (department, year_level, name) DO NOTHING;
      END LOOP;
    END LOOP;
  END LOOP;
END
$$;

-- ------------------------------------------------------------
-- 5. RELOAD POSTGREST SCHEMA CACHE
-- ------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

