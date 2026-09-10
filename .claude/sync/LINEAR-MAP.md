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
