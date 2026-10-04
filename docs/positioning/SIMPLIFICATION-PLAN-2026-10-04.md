> **Status: plan, 2026-10-04. PO confirmed the direction in chat; each step below still needs its own go-ahead before it is executed.** Companion to `BRAND-INFRASTRUCTURE-MAPPING-2026-10-04.md`.

# Simplification plan: less to manage, same features

## Principle

OSE and OW stay separate runtimes with their own invariants, code and tests. The simplification happens in the public name, the repos that hold no code, the design system and the pipeline. It never merges runtimes or databases.

## Evidence (measured 2026-10-04)

| Repo                   | Source files | Workflows | Wrangler configs |
| ---------------------- | ------------ | --------- | ---------------- |
| OSE                    | 281          | 28        | 2                |
| OW                     | 73           | 6         | 1                |
| OSG, OSR, OSP, OSM, OA | 0 each       | 2 each    | 0                |

Only OSE and OW have running code. The other five carry their own CI and propagation commits.

## Steps, in order

1. **Keep OSE and OW separate.** No change. Written down in the mapping doc.
2. **Cheap simplifications, now.**
   - **Superseded by PO, 2026-10-04: do not archive the child repos.** OSM, OA, OSG, OSR and OSP stay present in the infrastructure. Reduce their cost by sharing the spine's CI bracket instead of removing repos (see `docs/architecture/ECOSYSTEM-LAYERS.md`).
   - Adopt one public name and one front page (branch canvas, front page boards). The name is the PO's to set; `[YOUR NAME]` until then.
   - Put the naming map and the templates rule (event templates in OSE, profile templates in OW, never gating) in the hub, once.
3. **Hold new OW and OA feature work until OSE has launched.** The launch (Oct 24, the bocce client, the first corridors) needs OSE only.
4. **ADR-008 Phase 1 after launch, as already planned.** One repo, one pipeline, path filters. Its test stays "a smaller pipeline surface".

## Not decided here

- Whether Games and Records become OSE event formats or stay separate for now.
- Whether the templates rule gets one hub ADR or one ADR per runtime.
- Whether the four Experiment boards in the master are kept or retired.

## Checks before each step

- Linear and the audit in `docs/audits/LINEAR_BACKLOG_RECONCILIATION_2026-09-22.md` for anything tied to the repos in step 2.
- Brain invariants still pass after any move (run the 0-architecture gates before pushing).
