-- ============================================================
-- FacultyTrack: Phase 1 Foundation
-- File: supabase/migrations/006_phase1_foundation.sql
-- Blueprint v3, Phase 1: audit_log, department linkage,
-- RLS hardening. Apply AFTER 001-005.
--
-- Deploy order (critical, see supabase/functions/README.md):
--   1. Deploy submit-evaluation Edge Function
--   2. Apply THIS migration
--   3. Release the updated frontend
-- ============================================================

-- ------------------------------------------------------------
-- 1. AUDIT LOG
--    Table only. Written by Edge Functions via the service role
--    (bypasses RLS). No client policies by design: audit rows
--    are never readable or writable by regular users.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id UUID,
  actor_role TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor_created
  ON public.audit_log(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity
  ON public.audit_log(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action
  ON public.audit_log(action);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 2. DEPARTMENT LINKAGE (blueprint §4: department_id backfill)
--    Programs exist as free-text columns today. Add FK columns
--    and backfill: exact name match first, then a
--    case/trim-insensitive pass to maximize coverage.
--    Phase 7 program scoping joins on these columns.
-- ------------------------------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS department_id UUID
  REFERENCES public.departments(id) ON DELETE SET NULL;

ALTER TABLE public.class_assignments
  ADD COLUMN IF NOT EXISTS department_id UUID
  REFERENCES public.departments(id) ON DELETE SET NULL;

UPDATE public.users u
SET department_id = d.id
FROM public.departments d
WHERE u.department_id IS NULL
  AND btrim(u.department) = d.name;

UPDATE public.users u
SET department_id = d.id
FROM public.departments d
WHERE u.department_id IS NULL
  AND lower(btrim(u.department)) = lower(btrim(d.name));

UPDATE public.class_assignments ca
SET department_id = d.id
FROM public.departments d
WHERE ca.department_id IS NULL
  AND btrim(ca.department) = d.name;

UPDATE public.class_assignments ca
SET department_id = d.id
FROM public.departments d
WHERE ca.department_id IS NULL
  AND lower(btrim(ca.department)) = lower(btrim(d.name));

CREATE INDEX IF NOT EXISTS idx_users_department_id
  ON public.users(department_id);
CREATE INDEX IF NOT EXISTS idx_class_assignments_department_id
  ON public.class_assignments(department_id);

-- ------------------------------------------------------------
-- 3. RLS HARDENING (blueprint §5.1, §5.3, §5.6, §5.12)
-- ------------------------------------------------------------

-- 3a. §5.1: Evaluations are written ONLY through the
--     submit-evaluation Edge Function (service role bypasses RLS).
--     Direct client INSERT is closed; RLS default-deny applies.
DROP POLICY IF EXISTS "Students can insert own evaluations"
  ON public.evaluations;

-- 3b. §5.3: Student submissions are immutable. The UI already
--     treats submissions as read-only; this removes the unused
--     API-level write path.
DROP POLICY IF EXISTS "Students can update own evaluations"
  ON public.evaluations;

-- 3c. §5.6: Faculty can no longer read student profiles (Req 11).
--     Faculty keep: own row + co-faculty in the same department.
--     Verified before change: no faculty page queries the users
--     table directly; profiles come from own-row reads in
--     AuthContext.
DROP POLICY IF EXISTS "Faculty can view faculty and students in same dept"
  ON public.users;

-- CREATE POLICY has no IF NOT EXISTS in Postgres; guard manually so
-- the migration can be re-run safely.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'users'
      AND policyname = 'Faculty can view own and co-faculty profiles'
  ) THEN
    CREATE POLICY "Faculty can view own and co-faculty profiles"
      ON public.users FOR SELECT
      TO authenticated
      USING (
        id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.users AS u
          WHERE u.id = auth.uid()
            AND u.role = 'faculty'
            AND u.department = users.department
        )
      );
  END IF;
END
$$;

-- 3d. §5.12: email_verifications was readable/writable by anyone
--     (anon + authenticated). Verified: no frontend code touches
--     this table. Service role retains full access (RLS bypass).
DROP POLICY IF EXISTS "Anyone can read email verifications"
  ON public.email_verifications;
DROP POLICY IF EXISTS "Anyone can insert email verifications"
  ON public.email_verifications;
DROP POLICY IF EXISTS "Anyone can update email verifications"
  ON public.email_verifications;

-- 3e. Hardening of a discovered pre-existing hole (flagged in the
--     Phase 1 report, not part of blueprint §5): migration 002's
--     "Service role inserts users" policy allowed ANY authenticated
--     client to INSERT rows into public.users. Profile rows are
--     created by the SECURITY DEFINER trigger handle_new_user
--     (003/005), so authenticated INSERT access is unnecessary.
--     Default-deny now; service role and the trigger are unaffected.
--     Note: Login.jsx's fallback profile-creation insert (only runs
--     if the signup trigger is missing) will no longer succeed —
--     on a correctly migrated DB the trigger always fires first.
DROP POLICY IF EXISTS "Service role inserts users"
  ON public.users;

-- ------------------------------------------------------------
-- 4. POST-MIGRATION VERIFICATION (run manually in SQL editor)
--    Expect zero rows from each:
--
--    SELECT id, department FROM public.users
--      WHERE department IS NOT NULL AND department <> ''
--        AND department_id IS NULL;
--
--    SELECT id, department FROM public.class_assignments
--      WHERE department IS NOT NULL AND department <> ''
--        AND department_id IS NULL;
--
--    Expect the new policies:
--      SELECT policyname FROM pg_policies
--        WHERE tablename IN ('users','evaluations','email_verifications')
--        ORDER BY tablename, policyname;
-- ------------------------------------------------------------
