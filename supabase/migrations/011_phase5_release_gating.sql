-- ============================================================
-- FacultyTrack: Phase 5 — Result Release Gating (Req 7 / D2–D4)
-- File: supabase/migrations/011_phase5_release_gating.sql
-- Blueprint v3, Phase 5. Apply AFTER 001-010.
--
-- Client decisions implemented here:
--   D2  No actual grades stored — only a per-teacher
--       "grades submitted" status flag.
--   D3  Teachers mark their own "grades submitted" status.
--   D4  Results visible only when Admin approved AND the release
--       date has passed; a passed date WITHOUT approval stays
--       hidden.
--   §4.7 (explicit user instruction, overrides any default):
--       released = approved = true
--                  AND release_date IS NOT NULL
--                  AND release_date <= today
--       A missing release_date NEVER counts as released.
--
-- Enforcement is at the data layer: faculty_evaluations_anon
-- (Phase 4 view) becomes release-aware, so no faculty surface can
-- read an unreleased period's results regardless of client code.
--
-- Re-runnable. Verification queries at the bottom.
-- ============================================================

-- ------------------------------------------------------------
-- 1. grade_submissions [D2, D3]
--    One row per faculty per period = "grades submitted".
--    No grades are ever stored — only the flag + timestamp.
--    Faculty self-mark (own rows only); admins read for the
--    release screen.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.grade_submissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  faculty_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  academic_year TEXT NOT NULL,
  semester TEXT NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (faculty_id, academic_year, semester)
);

ALTER TABLE public.grade_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Faculty can view own grade submissions"
  ON public.grade_submissions;
CREATE POLICY "Faculty can view own grade submissions"
  ON public.grade_submissions FOR SELECT
  TO authenticated
  USING (faculty_id = auth.uid() AND public.is_faculty());

DROP POLICY IF EXISTS "Faculty can mark own grades submitted"
  ON public.grade_submissions;
CREATE POLICY "Faculty can mark own grades submitted"
  ON public.grade_submissions FOR INSERT
  TO authenticated
  WITH CHECK (faculty_id = auth.uid() AND public.is_faculty());

DROP POLICY IF EXISTS "Faculty can update own grade submissions"
  ON public.grade_submissions;
CREATE POLICY "Faculty can update own grade submissions"
  ON public.grade_submissions FOR UPDATE
  TO authenticated
  USING (faculty_id = auth.uid() AND public.is_faculty())
  WITH CHECK (faculty_id = auth.uid() AND public.is_faculty());

DROP POLICY IF EXISTS "Admin can view grade submissions"
  ON public.grade_submissions;
CREATE POLICY "Admin can view grade submissions"
  ON public.grade_submissions FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- ------------------------------------------------------------
-- 2. evaluation_releases [D4, §4.7]
--    One row per (period) or (period, program). department NULL =
--    all programs (per-department rows become meaningful in
--    Phase 7 program scoping; the table is designed for it now).
--    The release rule lives ONLY in is_period_released() below —
--    every consumer (views, UI display) derives from it.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.evaluation_releases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  academic_year TEXT NOT NULL,
  semester TEXT NOT NULL,
  department TEXT,
  approved BOOLEAN NOT NULL DEFAULT false,
  approved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  release_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- UNIQUE treats NULLs as distinct, so a plain UNIQUE(a,y,s,department)
-- would allow duplicate global (department IS NULL) rows. Use a
-- COALESCE expression index instead.
CREATE UNIQUE INDEX IF NOT EXISTS uq_evaluation_releases_period_dept
  ON public.evaluation_releases
  (academic_year, semester, COALESCE(department, ''));

ALTER TABLE public.evaluation_releases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin can manage evaluation releases"
  ON public.evaluation_releases;
CREATE POLICY "Admin can manage evaluation releases"
  ON public.evaluation_releases FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ------------------------------------------------------------
-- 3. THE release rule — single source of truth (§4.7)
--    released = approved AND release_date IS NOT NULL AND passed.
--    Matches a global row (department IS NULL) OR an exact
--    program row for the given department. SECURITY DEFINER so
--    views can call it regardless of caller RLS on the table.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_period_released(
  p_year text,
  p_semester text,
  p_department text DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.evaluation_releases r
    WHERE r.academic_year = p_year
      AND r.semester = p_semester
      AND (r.department IS NULL OR r.department = p_department)
      AND r.approved = true
      AND r.release_date IS NOT NULL
      AND r.release_date <= CURRENT_DATE
  );
$$;

-- ------------------------------------------------------------
-- 4. Release-aware faculty view (replaces the Phase 4 version).
--    Unreleased periods are INVISIBLE to faculty at the data
--    layer — not merely grayed out in the UI.
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW public.faculty_evaluations_anon AS
SELECT
  e.id,
  e.faculty_id,
  e.assignment_id,
  e.academic_year,
  e.semester,
  e.ratings,
  e.comment,
  e.submitted_at::date AS submitted_on
FROM public.evaluations e
WHERE e.faculty_id = auth.uid()
  AND public.is_period_released(
        e.academic_year,
        e.semester,
        (SELECT u.department FROM public.users u WHERE u.id = e.faculty_id)
      );

-- ------------------------------------------------------------
-- 5. Faculty pending-release status view.
--    Booleans + period labels for the caller's own periods only —
--    no result data. Powers the "pending release" states and the
--    grades-submitted card [D2/D3] in the faculty UI.
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW public.faculty_release_status AS
SELECT
  p.academic_year,
  p.semester,
  EXISTS (
    SELECT 1 FROM public.evaluations e
    WHERE e.faculty_id = auth.uid()
      AND e.academic_year = p.academic_year
      AND e.semester = p.semester
  ) AS has_evaluations,
  EXISTS (
    SELECT 1 FROM public.grade_submissions g
    WHERE g.faculty_id = auth.uid()
      AND g.academic_year = p.academic_year
      AND g.semester = p.semester
  ) AS grades_submitted,
  public.is_period_released(
    p.academic_year,
    p.semester,
    (SELECT u.department FROM public.users u WHERE u.id = auth.uid())
  ) AS released
FROM (
  SELECT DISTINCT academic_year, semester
  FROM public.evaluations
  WHERE faculty_id = auth.uid()
) p;

-- ------------------------------------------------------------
-- 6. BACKFILL: all pre-existing periods count as released.
--    Without this, every historical result would vanish from
--    faculty view the moment this migration applies. Rows are
--    global (department NULL), approved, effective immediately.
-- ------------------------------------------------------------
INSERT INTO public.evaluation_releases
  (academic_year, semester, department, approved, release_date)
SELECT DISTINCT
  e.academic_year,
  e.semester,
  NULL,
  true,
  CURRENT_DATE
FROM public.evaluations e
WHERE NOT EXISTS (
  SELECT 1 FROM public.evaluation_releases r
  WHERE r.academic_year = e.academic_year
    AND r.semester = e.semester
    AND r.department IS NULL
);

-- ------------------------------------------------------------
-- 7. POST-MIGRATION VERIFICATION (run manually in SQL editor)
--
--    a) Tables + policies:
--       SELECT tablename, policyname, cmd FROM pg_policies
--         WHERE tablename IN ('grade_submissions','evaluation_releases')
--         ORDER BY tablename, cmd;
--
--    b) Backfill (one row per historical period, approved=true):
--       SELECT academic_year, semester, department, approved, release_date
--         FROM public.evaluation_releases ORDER BY academic_year, semester;
--
--    c) The rule never releases without approval or a date:
--       INSERT INTO evaluation_releases (academic_year, semester, approved)
--       VALUES ('TEST','TEST', true);
--       SELECT is_period_released('TEST','TEST');            -- false (no date)
--       UPDATE evaluation_releases SET approved=false WHERE semester='TEST';
--       UPDATE evaluation_releases SET release_date=CURRENT_DATE
--         WHERE semester='TEST';
--       SELECT is_period_released('TEST','TEST');            -- false (not approved)
--       UPDATE evaluation_releases SET approved=true WHERE semester='TEST';
--       SELECT is_period_released('TEST','TEST');            -- true
--       DELETE FROM evaluation_releases WHERE semester='TEST';
--
--    d) As faculty (via app): historical periods still render on
--       the results page; the current on-going period is hidden
--       until an admin approves it with a passed release date;
--       the dashboard shows the pending-release banner and the
--       grades-submitted card works (toggle persists).
-- ------------------------------------------------------------
