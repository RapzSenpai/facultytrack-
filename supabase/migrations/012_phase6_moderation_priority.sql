-- ============================================================
-- FacultyTrack: Phase 6 — Moderation + Priority (Req 3, 8 / D6, D7)
-- File: supabase/migrations/012_phase6_moderation_priority.sql
-- Blueprint v3, Phase 6. Apply AFTER 001-011.
--
-- Client decisions implemented here:
--   Req 3  Hybrid offensive-comment filtering (wordlist + AI)
--          at submission. Legit criticism must PASS; borderline
--          comments are FLAGGED, not blocked.
--   Req 8  Student "Priority" pill + OK/Cancel dialog; AI
--          auto-flag of serious comments; admin review queue;
--          faculty gets a notice WITHOUT the comment content.
--   D6     Faculty receives notice only — never the comment.
--   D7     Priority cases are handled by Admin.
--
-- Data-layer guarantees:
--   - Faculty NEVER see comment content for pending/flagged
--     evaluations: faculty_evaluations_anon masks `comment` with
--     NULL unless the row is moderation_status='allow' AND the
--     period is released. original_comment is never selected.
--   - Admins manage moderation via the base table (is_admin()).
--   - Faculty escalation notice = boolean per period ONLY (D6):
--       has_escalation  = priority_reviews rows exist
--       resolved        = none left in status 'new'/'acknowledged'
-- ============================================================

-- ------------------------------------------------------------
-- 1. Moderation + priority columns on evaluations
-- ------------------------------------------------------------
ALTER TABLE public.evaluations
  ADD COLUMN IF NOT EXISTS moderation_status TEXT NOT NULL DEFAULT 'allow'
    CHECK (moderation_status IN ('allow', 'flagged', 'blocked')),
  ADD COLUMN IF NOT EXISTS moderation_labels JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS original_comment TEXT,
  ADD COLUMN IF NOT EXISTS is_priority BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS priority_source TEXT
    CHECK (priority_source IN ('student', 'ai', 'admin'));

CREATE INDEX IF NOT EXISTS idx_evaluations_moderation
  ON public.evaluations(moderation_status);
CREATE INDEX IF NOT EXISTS idx_evaluations_priority
  ON public.evaluations(is_priority);

-- ------------------------------------------------------------
-- 2. blocked_words — admin-managed tier-1 wordlist
--    word: lowercase match term; severity: block | flag.
--    matched as whole-word substring, case-insensitive.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.blocked_words (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  word TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'flag'
    CHECK (severity IN ('block', 'flag')),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (word)
);

ALTER TABLE public.blocked_words ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin can manage blocked words"
  ON public.blocked_words;
CREATE POLICY "Admin can manage blocked words"
  ON public.blocked_words FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ------------------------------------------------------------
-- 3. priority_reviews — admin queue [D7]
--    One per evaluation. lifecycle: new -> acknowledged ->
--    resolved/dismissed. assigned_to = admin handling it.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.priority_reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  evaluation_id UUID NOT NULL REFERENCES public.evaluations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'acknowledged', 'resolved', 'dismissed')),
  source TEXT NOT NULL DEFAULT 'student'
    CHECK (source IN ('student', 'ai', 'admin')),
  assigned_to UUID REFERENCES public.users(id) ON DELETE SET NULL,
  resolution_note TEXT,
  resolved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_priority_reviews_evaluation
  ON public.priority_reviews(evaluation_id);

ALTER TABLE public.priority_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin can manage priority reviews"
  ON public.priority_reviews;
CREATE POLICY "Admin can manage priority reviews"
  ON public.priority_reviews FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ------------------------------------------------------------
-- 4. Faculty escalation notice [D6] — booleans per period ONLY.
--    SECURITY DEFINER: reads priority data without exposing any
--    of it. Faculty call this for the neutral banner; it returns
--    no comment, no student, no reviewer, nothing else.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_faculty_escalation_status(
  p_year text,
  p_semester text
)
RETURNS TABLE (has_escalation boolean, all_resolved boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(bool_or(e.is_priority), false),
    NOT COALESCE(bool_or(pr.status IN ('new', 'acknowledged')), false)
  FROM public.evaluations e
  LEFT JOIN public.priority_reviews pr ON pr.evaluation_id = e.id
  WHERE e.faculty_id = auth.uid()
    AND e.academic_year = p_year
    AND e.semester = p_semester
    AND e.is_priority
  GROUP BY e.faculty_id
  HAVING count(e.id) > 0;
$$;

-- ------------------------------------------------------------
-- 5. Faculty view rebuilt: comment masking + release gating.
--    comment visible ONLY when moderation_status='allow' AND the
--    period is released. blocked/flagged comments NEVER reach
--    faculty; original_comment is never selected. pending/
--    flagged periods stay entirely hidden until released.
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW public.faculty_evaluations_anon AS
SELECT
  e.id,
  e.faculty_id,
  e.assignment_id,
  e.academic_year,
  e.semester,
  e.ratings,
  CASE
    WHEN e.moderation_status = 'allow'
      AND public.is_period_released(
        e.academic_year,
        e.semester,
        (SELECT u.department FROM public.users u WHERE u.id = e.faculty_id)
      )
    THEN e.comment
    ELSE NULL
  END AS comment,
  e.submitted_at::date AS submitted_on
FROM public.evaluations e
WHERE e.faculty_id = auth.uid()
  AND public.is_period_released(
        e.academic_year,
        e.semester,
        (SELECT u.department FROM public.users u WHERE u.id = e.faculty_id)
      );

-- ------------------------------------------------------------
-- 5b. Admin view rebuilt with moderation columns (identity
--     restrictions unchanged: student_token, no student_id).
--     Admins NEED comment + original_comment + labels here —
--     they run the priority queue [D7] and triage flags.
--     NOTE: the new columns sit BEFORE submitted_on, and CREATE
--     OR REPLACE VIEW can only append columns at the end — it
--     cannot insert mid-list (42P16). The view has no dependents,
--     so drop + recreate is the correct re-runnable pattern here.
-- ------------------------------------------------------------
DROP VIEW IF EXISTS public.admin_evaluations_anon;
CREATE VIEW public.admin_evaluations_anon AS
SELECT
  e.id,
  e.assignment_id,
  e.faculty_id,
  md5(e.student_id::text) AS student_token,
  u.department AS student_department,
  e.academic_year,
  e.semester,
  e.ratings,
  e.comment,
  e.original_comment,
  e.moderation_status,
  e.moderation_labels,
  e.is_priority,
  e.priority_source,
  e.submitted_at::date AS submitted_on
FROM public.evaluations e
LEFT JOIN public.users u ON u.id = e.student_id
WHERE EXISTS (
  SELECT 1 FROM public.users au
  WHERE au.id = auth.uid() AND au.role = 'admin'
);

-- ------------------------------------------------------------
-- 6. Admin reclassification: an admin may flip is_priority for
--    evaluations directly (AI/manual triage corrections).
--    Base-table UPDATE via is_admin() — explicit policy because
--    evaluations previously had NO admin UPDATE policy at all.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Admin can moderate evaluations"
  ON public.evaluations;
CREATE POLICY "Admin can moderate evaluations"
  ON public.evaluations FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ------------------------------------------------------------
-- 7. Backfill: priorityReviews for any legacy rows (none expected,
--    but keeps the invariant one-review-per-priority-evaluation).
--    Backfill is idempotent via the unique index.
-- ------------------------------------------------------------
INSERT INTO public.priority_reviews (evaluation_id, source, status)
SELECT e.id, COALESCE(e.priority_source, 'admin'), 'new'
FROM public.evaluations e
WHERE e.is_priority
  AND NOT EXISTS (
    SELECT 1 FROM public.priority_reviews pr WHERE pr.evaluation_id = e.id
  );

-- ------------------------------------------------------------
-- 8. POST-MIGRATION VERIFICATION (run manually in SQL editor)
--
--    a) Columns exist:
--       SELECT column_name, data_type, column_default
--         FROM information_schema.columns
--         WHERE table_name = 'evaluations'
--           AND column_name IN ('moderation_status','moderation_labels',
--                               'original_comment','is_priority','priority_source');
--
--    b) Escalation RPC shape (as faculty via app):
--       SELECT * FROM get_faculty_escalation_status('<year>','<sem>');
--       -> at most one row of two booleans. No text columns.
--
--    c) Masking: as faculty, a released period with a 'blocked'
--       comment must show comment IS NULL for that row while
--       ratings remain visible.
--
--    d) blocked_words + priority_reviews policies exist:
--       SELECT tablename, policyname, cmd FROM pg_policies
--         WHERE tablename IN ('blocked_words','priority_reviews')
--         ORDER BY tablename, cmd;
-- ------------------------------------------------------------
