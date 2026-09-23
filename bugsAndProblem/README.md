# bugsAndProblem — Fixed Problems Log

One markdown file per fixed bug/problem. Naming: `NNN-short-slug.md` (sequential).
Newest entries go at the **bottom** of the table. Related context: `renovation.md`
(master plan & status) and `supabase/functions/README.md` (deploy notes & smoke tests).

| # | File | Area | Fixed in |
|---|------|------|----------|
| 001 | [faculty-rls-self-comparison](001-faculty-rls-self-comparison.md) | DB / RLS (`users`) | migration 004 |
| 002 | [academic-years-missing-unique](002-academic-years-missing-unique.md) | DB / constraint | migration 004 |
| 003 | [eslint-config-broken](003-eslint-config-broken.md) | Tooling / lint | Phase 1 |
| 004 | [users-insert-policy-hole](004-users-insert-policy-hole.md) | DB / RLS security hole | Phase 1 (006 §3e) |
| 005 | [evaluations-direct-writes-open](005-evaluations-direct-writes-open.md) | DB / RLS (`evaluations`) | Phase 1 (006 §5.1) |
| 006 | [evaluations-student-update-not-immutable](006-evaluations-student-update-not-immutable.md) | DB / RLS (`evaluations`) | Phase 1 (006 §5.3) |
| 007 | [email-verifications-world-readable](007-email-verifications-world-readable.md) | DB / RLS security hole | Phase 1 (006 §5.12) |
| 008 | [register-eof-parse-error](008-register-eof-parse-error.md) | Frontend / build blocker | Phase 2 |
| 009 | [student-self-enrollment](009-student-self-enrollment.md) | Flow / design flaw (Req 2) | Phase 3 (008) |
| 010 | [student-profile-classification-self-edit](010-student-profile-classification-self-edit.md) | DB / RLS + UI (`users`) | Phase 3 (008) |
| 011 | [faculty-could-read-student-identity](011-faculty-could-read-student-identity.md) | DB / anonymity (Req 11) | Phase 4 (009) |
| 012 | [users-rls-infinite-recursion](012-users-rls-infinite-recursion.md) | DB / RLS — login 500 for all roles | Hotfix (migration 010) |

## Convention for new entries

- Copy the section structure of any file here: **Symptom → Root cause → Fix → Verification**.
- Design flaws (not runtime bugs) use **Problem → Client decision → Fix** instead.
- Always name the exact migration file / section or source files where the fix lives.
- Add the row to the table above; never rewrite or merge old entries.
