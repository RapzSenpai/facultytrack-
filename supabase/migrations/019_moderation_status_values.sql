-- ============================================================
-- FacultyTrack: Fix 019 — moderation_status canonical values
-- Post-audit discovery: 012 constrained moderation_status to
-- ('allow','flagged','blocked'), but the submit-evaluation Edge
-- Function and AdminModeration write ('allow','flag','block').
-- Every flagged insert failed the CHECK (500 "Could not save").
-- Canonical set is now ('allow','flag','block') everywhere.
-- Apply AFTER 001-018. Re-runnable. User applies via SQL editor.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'evaluations_moderation_status_check'
      AND conrelid = 'public.evaluations'::regclass
  ) THEN
    ALTER TABLE public.evaluations
      DROP CONSTRAINT evaluations_moderation_status_check;
  END IF;
END
$$;

-- Normalize any rows written with the old literals first.
UPDATE public.evaluations SET moderation_status = 'flag'
  WHERE moderation_status = 'flagged';
UPDATE public.evaluations SET moderation_status = 'block'
  WHERE moderation_status = 'blocked';

ALTER TABLE public.evaluations
  ADD CONSTRAINT evaluations_moderation_status_check
  CHECK (moderation_status IN ('allow', 'flag', 'block'));

-- ------------------------------------------------------------
-- POST-MIGRATION VERIFICATION (run manually in SQL editor)
--    SELECT pg_get_constraintdef(oid) FROM pg_constraint
--      WHERE conname = 'evaluations_moderation_status_check';
--    -> CHECK (moderation_status IN ('allow','flag','block')).
--    SELECT DISTINCT moderation_status FROM public.evaluations;
--    -> only allow/flag/block.
-- ------------------------------------------------------------
