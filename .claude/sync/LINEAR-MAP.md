# Linear Mapping — Story Registry ↔ Linear Issues

Maps STORIES.md story IDs to Linear issues. Status lives in STORIES.md (source of truth).

## Linear Setup

```
Workspace:  oursharedevents
URL:        https://linear.app/oursharedevents
Team:       OUR
Backlog:    https://linear.app/oursharedevents/team/OUR/backlog
```

## Issue Mapping

| Story ID | Linear ID | Title                                          |
| -------- | --------- | ---------------------------------------------- |
| P0-1     | —         | Create Linear board + import all stories       |
| P1-1     | —         | Cloudflare Worker code                         |
| P1-2     | —         | CI/CD pipeline (GitHub Actions)                |
| P1-3     | —         | README — ourSharedEvents identity              |
| P1-4     | —         | STORIES.md — project tracking registry         |
| P1-5     | —         | E2E launch checklist                           |
| P1-6     | —         | Infra provisioning — Google Cloud + Cloudflare |
| P1-7     | —         | Secrets + first staging deploy                 |
| P1-8     | —         | Staging sign-off                               |
| P1-9     | —         | Repo migration → ourCommunityRituals           |
| P1-10    | —         | Production launch — v1.0.0                     |
| P2-1     | OSE-16    | D1 database creation + schema migrations       |
| P2-2     | —         | Data migration script: Sheets → D1             |
| P2-3     | —         | Swap data layer: sheets.ts → d1.ts             |
| P2-4     | —         | Remove Google SA credentials                   |
| P3-1     | —         | Firebase Hosting + React/Tailwind UI           |
| P3-2     | —         | Firebase Auth — replace Bearer token           |

> Fill in `Linear ID` after importing. Format: `OUR-123`.
> PRs that include `OUR-XXX` in commit messages auto-link via GitHub integration.

## Security / privacy — OSE-563

| Story ID | Linear ID | Title                                                 | Evidence                                                                                    |
| -------- | --------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| —        | OSE-563   | Attendee anti-logging proof: born-red absence harness | `workers/oursharedevents/tests/anti-logging-proof.spec.ts` (30 tests, 8 absence properties) |

| SharedReport | OSE-923 | Unlinkability — stored anonymous return rows cannot be re-joined without the dedicated pepper | `workers/oursharedevents/tests/shared-report-pipeline-invariants.spec.ts` (pepper isolation + no raw anon ID) |

## Supply-chain security

| Story ID           | Linear ID | Title                                                                                     | Evidence                                                                                                                                                               |
| ------------------ | --------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S0 / advisory SBOM | OSE-1030  | Keep CycloneDX SBOM generation green with the managed-runner `@ocr/flags` file dependency | PR #588 (`f02075a`); `.github/workflows/advanced-security-scan.yml` uses `--ignore-npm-errors`, and `tests/integration/infra-consistency.test.js` guards the tolerance |

## Landing / supply-side experience

| Story ID | Linear ID | Title                                                                         | Evidence / status                                                                                                                                                                                                                                                                                    |
| -------- | --------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Landing  | OSE-1312  | Supply-side landing with two doors, privacy promise, and filterable area view | PR #550 (`0bbb341`); `workers/oursharedevents/src/lib/landing-area.ts`, `workers/oursharedevents/tests/landing-area.spec.ts`, `tests/e2e/3-flows/landing-to-events.spec.js`, and the a11y surface gate. Slice 2 is merged; real map rendering and hybrid-product backing remain explicit follow-ups. |

## TRIANGLE / publication boundary

| Story ID            | Linear ID | Title                                                                                    | Evidence / status                                                                                                                                                                                                                                                                                                       |
| ------------------- | --------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TRI-3 / create flow | OSE-1245  | Publication is an explicit owner choice and unpublished events are absent from discovery | PR #460 (`32a59c60`); `workers/oursharedevents/tests/create-flow-publication.spec.ts` proves both create paths ask and send `is_published`, while `events-publication.spec.ts` proves map exclusion and query-level filtering. Location-precision policy remains an explicit follow-up in `public-event-projection.ts`. |

## T4b Core Journeys

| Story ID | Linear ID | Title                                                    | Evidence                                                                                                                                                                                                                                                  |
| -------- | --------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T4b      | OSE-984   | Admin + sponsor flywheel reaches a green staging journey | PR #384 (`625b409`) stages `ADMIN_SCOPE_ALL` and hardens sponsor journey request/read paths; PR #385 (`90b979a`) makes the covenant read retry-safe; `.github/workflows/oursharedevents-ci.yml` resets synthetic sponsor fixtures before the contract run |

## Incentive spine / field validation

| Story ID        | Linear ID | Title                                                                      | Evidence / status                                                                                                                                                                     |
| --------------- | --------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Incentive spine | OSE-797   | Validate the anchor-pledge, corridor-card, and free-local incentive ladder | `workers/oursharedevents/docs/ops/ADR-INCENTIVE-SPINE-2026-09-16.md`, section 10 defines the five-business paper-card experiment; no execution evidence is present in this repository |

## SharedReport / Contract-tier — OSE-575..892 range · added 2026-09-21 (drift-audit reconcile)

These IDs already appeared as inline citations in `STORIES.md` but had no row here, so a reader relying on this table alone would conclude they don't exist in Linear. Added for traceability only — no status claims changed; see `STORIES.md` for the authoritative status of each.

| Story ID     | Linear ID | Title                                                                    |
| ------------ | --------- | ------------------------------------------------------------------------ |
| SharedReport | OSE-628   | corridor_map SVG render on signed-link SharedReport view                 |
| SharedReport | OSE-631   | `refreshCorridorBaselines` COALESCE(h3_res7, corridor_id) coverage       |
| SR-15        | OSE-638   | Form page CSP (nonce-based)                                              |
| SR-25        | OSE-714   | SharedReport depth enforcement — cited evidence (server gate lineage)    |
| SR-25        | OSE-816   | SharedReport depth enforcement — server-side gate (ADR-017)              |
| SR-25        | OSE-817   | SharedReport depth enforcement — client `upgrade.locked_sections` render |
| TP-3         | OSE-838   | Newman entry points repointed at live OSE collections (pre-Bruno)        |
| TRI-6        | OSE-729   | category_registry — layout-template axis (context reference only)        |

> **Known gap (not yet closed):** `docs/adr/ADR-017-sharedreport-depth-enforcement.md` also cites **OSE-577** and **OSE-815** for the depth-enforcement work; neither appears anywhere in `STORIES.md`, so they are intentionally omitted from the table above pending a STORIES.md update that would give them a story-ID anchor.

## Epic — Doc→Code→Process Continuity Remediation (CCR 5-loop) · created 2026-09-10

Linear team key is **OSE** (not `OUR`). EPIC = Linear project `Doc→Code→Process Continuity Remediation (CCR 5-loop)`, linked to the "Self-Checking Infrastructure — Invariants as the Core Framework" initiative.

| Finding    | Linear ID | Kind    | Title                                                                         |
| ---------- | --------- | ------- | ----------------------------------------------------------------------------- |
| —          | OSE-1282  | Feature | Tier A — Reconcile Docs to Authoritative Code                                 |
| F2         | OSE-1285  | Story   | Author ADR-018 (Declined Regulatory Regimes) + supersession notes ADR-001/009 |
| F16        | OSE-1286  | Story   | Reconcile invariant #21 activation_note with live status                      |
| F11        | OSE-1287  | Story   | Correct "self-hosted pool retired org-wide" claim                             |
| —          | OSE-1283  | Feature | Tier B — Close Enforcement Gaps                                               |
| F13        | OSE-1288  | Story   | Enforce Invariant #22 (cross-repo import isolation) on OW side                |
| F9         | OSE-1289  | Story   | #2/#4 live but only T4-gated — add PR-gating specs or correct status          |
| F10        | OSE-1290  | Story   | Wire or retire ~104 dead tests/e2e specs + test:e2e:* scripts                 |
| —          | OSE-1284  | Feature | Tier C — Traceability & Hygiene                                               |
| F3         | OSE-1291  | Story   | Add ADR↔invariant back-references                                             |
| F14        | OSE-1292  | Story   | Refresh OW CLAUDE.md                                                          |
| F12/F15/F5 | OSE-1293  | Story   | Brain silent-pass hardening + 3rd-layer labeling + ADR axis cross-ref         |
