# eslint.config.js broken (flat config reference)

- **Area:** Tooling / lint
- **Fixed in:** `eslint.config.js` — during Phase 1 of the renovation
- **Recorded:** 2026-09-23
- **Status:** FIXED ✅

## Symptom

`npm run lint` failed outright with a config-level crash (not per-file
warnings), so linting could not serve as a verification gate for any
change.

## Root cause

eslint-plugin-react-hooks 5.2.0 changed its export shape; the config
referenced `configs.flat` on the plugin object, which no longer exists.

## Fix

Rewrote `eslint.config.js` with explicit flat-config registration of the
plugin, and added `supabase/` to the ignores (SQL/Edge Function files
are not lint targets).

## Verification

`npm run lint` runs and reports per-file results; used as a gate for
every phase since ("no new lint issues in touched files").
