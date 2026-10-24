-- Seed Tagalog / Bisaya (Cebuano) profanity & insults into the blocked-words tier.
-- REVIEW BEFORE RUNNING. Admins can still add/remove words in the UI afterwards.
-- 'block' = rejected on submit. 'flag' = stored for admin review.
-- Matching is whole-word and tolerant of accents, "g@go"-style swaps and stretched letters.
insert into public.blocked_words (word, severity) values
  -- Tagalog: block
  ('putangina', 'block'),
  ('putang ina', 'block'),
  ('tangina', 'block'),
  ('tang ina', 'block'),
  ('gago', 'block'),
  ('gaga', 'block'),
  ('ulol', 'block'),
  ('puta', 'block'),
  ('pakyu', 'block'),
  ('tarantado', 'block'),
  ('magulang mo', 'block'),
  ('inang mo', 'block'),
  ('ina mo', 'block'),
  ('mag inang', 'block'),
  ('leche', 'block'),
  ('hayop ka', 'block'),
  ('patayin kita', 'block'),
  -- Bisaya / Cebuano: block
  ('yawa', 'block'),
  ('yawa ka', 'block'),
  ('mamamo', 'block'),
  ('piste', 'block'),
  ('pisti', 'block'),
  ('pisteng yawa', 'block'),
  ('atay', 'block'),
  ('giatay', 'block'),
  ('animal ka', 'block'),
  ('patyon taka', 'block'),
  -- Milder insults: flag for review
  ('bobo', 'flag'),
  ('tanga', 'flag'),
  ('engot', 'flag'),
  ('siraulo', 'flag'),
  ('bwisit', 'flag'),
  ('buang', 'flag'),
  ('bogo', 'flag'),
  ('abnoy', 'flag'),
  ('walay pulos', 'flag'),
  ('walang kwenta', 'flag')
on conflict do nothing;
