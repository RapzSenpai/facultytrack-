-- ============================================================
-- Migration 044: Flag Bisaya personal character attacks
-- Adds Bisaya attitude/character insults to blocked_words ('flag')
-- Retroactively updates existing 'allow' evaluations containing
-- character attacks so they are hidden from faculty immediately.
-- ============================================================

INSERT INTO public.blocked_words (word, severity) VALUES
  ('bati ug batasan', 'flag'),
  ('bati og batasan', 'flag'),
  ('way batasan', 'flag'),
  ('walay batasan', 'flag'),
  ('pangit ug batasan', 'flag'),
  ('walang modo', 'flag'),
  ('bastos', 'flag')
ON CONFLICT (word) DO UPDATE SET severity = 'flag';

-- Retroactively flag existing comments with personal character attacks
UPDATE public.evaluations
SET moderation_status = 'flag'
WHERE moderation_status = 'allow'
  AND (
    comment ILIKE '%bati%batasan%'
    OR comment ILIKE '%way batasan%'
    OR comment ILIKE '%walay batasan%'
    OR comment ILIKE '%pangit%batasan%'
  );
