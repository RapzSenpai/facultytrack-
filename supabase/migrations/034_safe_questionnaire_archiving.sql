-- ============================================================
-- FacultyTrack: Migration 034 — Safe Questionnaire Archiving
--
-- Adds `is_active` boolean column to `questions` table so
-- questions can be archived/deactivated instead of hard-deleted.
--
-- Why:
-- When a question is hard-deleted, past evaluation submissions that
-- reference that question ID in evaluations.ratings lose their question
-- text, category mapping, and report integrity.
--
-- With is_active:
-- 1. Deactivated/archived questions remain in the DB, preserving past results.
-- 2. New student evaluation forms load only is_active = true questions.
-- 3. Historical reports and AI analytics continue reading all past scores accurately.
-- ============================================================

-- 1. Add is_active column to questions (idempotent)
ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- 2. Ensure index on is_active and criteria_id for fast queries
CREATE INDEX IF NOT EXISTS idx_questions_active
  ON public.questions(criteria_id, is_active);
