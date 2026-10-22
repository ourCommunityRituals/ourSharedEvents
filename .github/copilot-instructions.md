# Copilot instructions

Follow `AGENTS.md` at the repo root. It is the operating contract for every agent here: architecture, invariants, commands, quality gates, what needs a human, and the Definition of Done.

The rules that most often decide a review:

- Counts, never identities; any published count below 5 is withheld (no exceptions).
- Location is an H3 cell (res 7 or 9), never coordinates, request geo or IP. No cookies on public surfaces, except the anonymous `ose_anon` token on `/q` and the forms routes (owner ruling 2026-10-22).
- `DB` (anonymous) and `FORMS_DB` (identified) never cross. No model-provider SDK or API call under `workers/oursharedevents/src/`.
- Colours only from the design tokens; one `<h1>` per page.
- A test counts as coverage only if CI runs it, and only once it has been seen failing on a planted fault.
- PR bodies use `Part of OSE-###`; keep ids out of branch names and titles, and keep closing words away from ids.
