# Org Brain Sync — OCR System Standard

> OCR-docs is the org brain. The sync system is how the brain talks to the body.

---

## The system

Three mechanisms keep the org in sync. Each operates at a different frequency and scope. Together they form a closed loop: standards flow down, status flows up, drift gets caught.

```
                        ┌─────────────┐
                        │  OCR-docs   │
                        │  (org brain)│
                        └──────┬──────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
      ┌───────▼──────┐ ┌──────▼───────┐ ┌──────▼───────┐
      │  Propagate   │ │   Nightly    │ │  Bloodraven  │
      │  Standards   │ │  Sync Check  │ │  Linear Sync │
      │  (push down) │ │  (audit)     │ │  (pull up)   │
      └───────┬──────┘ └──────┬───────┘ └──────┬───────┘
              │                │                │
              ▼                ▼                ▼
      ┌──────────────────────────────────────────────┐
      │  OSE  OW  OSG  OSR  OSP  OSM  OA           │
      │  (product repos)                              │
      └──────────────────────────────────────────────┘
```

---

## Mechanism 1: Propagate Standards (push down)

**What:** When OCR-docs standards change, open PRs in all product repos.
**Trigger:** Push to main touching `templates/`, `skills/`, `docs/OCR_VISION.md`, or `docs/references/OCR_DEPENDENCY_crossRepo.md`
**Workflow:** `.github/workflows/propagate-standards.yml`
**Frequency:** On change (event-driven)

### What propagates

| Source in OCR-docs | Destination in product repo | Content |
|---|---|---|
| `templates/` | `.ocr-standards/` | CLAUDE-base, SKILL-template, OCR_TEMPLATE_adr |
| `skills/` | `.ocr-standards/skills/` | CCR protocol, CCR template, CCR MVP |
| `docs/OCR_VISION.md` | `.ocr-standards/docs/OCR_VISION.md` | Org-level source of truth |
| `docs/references/OCR_DEPENDENCY_crossRepo.md` | `.ocr-standards/docs/OCR_DEPENDENCY_crossRepo.md` | Cross-repo dependencies |
| `docs/standards/` | `.ocr-standards/standards/` | **NEW — naming, testing, D1, org-brain-sync** |

### Standards propagation (wired)

`docs/standards/**` is included in the propagation trigger and copy step. All four standards propagate automatically:

- `OCR_STANDARD_namingConvention.md`
- `OCR_STANDARD_testNaming.md`
- `OCR_STANDARD_d1Migration.md`
- `OCR_STANDARD_orgBrainSync.md`

### Human gate

Propagation opens PRs. It does not auto-merge. Every product repo owner reviews and merges. This is intentional — product repos may need to adapt org standards to their context.

---

## Mechanism 2: Nightly Sync Check (audit)

**What:** Read-only audit of all product repos for DAC compliance and standards drift.
**Trigger:** Cron — 6am UTC / midnight CST daily
**Workflow:** `.github/workflows/nightly-sync-check.yml`
**Output:** GitHub issue in OCR-docs if drift detected

### What it checks

| Check | Severity | What it catches |
|---|---|---|
| `CLAUDE.md` exists | Failure | Repo has no session protocol |
| `README.md` exists | Failure | Repo has no public description |
| `SKILL.md` exists | Failure | Repo has no reusable skills |
| `docs-ci.yml` exists | Warning | No CI pipeline for docs |
| `.ocr-standards/` exists | Warning | Propagation has never run |
| `.ocr-standards/` matches OCR-docs | Warning | Standards have drifted |
| Unmerged propagation PRs | Warning | Standards PR waiting for review |

### What it should also check (planned)

| Check | Severity | What it catches |
|---|---|---|
| File naming matches `OCR_STANDARD_namingConvention.md` | Warning | Naming drift |
| Test files follow `OCR_STANDARD_testNaming.md` | Warning | Test naming drift |
| CCR gate files exist for In Progress stories | Warning | Stories moving without governance |
| Migration files follow `OCR_STANDARD_d1Migration.md` | Warning | Schema drift |

---

## Mechanism 3: Bloodraven Linear Sync (pull up)

**What:** Syncs Linear story status with codebase state, PRs, and commits. Feeds findings back to OCR-docs.
**Trigger:** Scheduled task (manual or automated)
**Prompt:** `docs/prompts/OCR_PROMPT_dailyLinearSync.md`
**Output:** `OCR_LOG_session.md` and `OCR_STATUS_project.md` in OCR-docs

### The three-pass structure

| Pass | Name | What it does |
|---|---|---|
| 1 | **Vision Integrity** | Reads VISION.md. Checks product registry against Linear teams. Flags drift, boundary violations, and today-specific events. |
| 2 | **Scrum CCR Efficiency** | Runs CCR loops on all visible teams. Identifies blockers, duplication risks, contradictions. Assigns confidence scores. |
| 3 | **Recursive** | Reconciles Pass 1 and Pass 2. Resolves conflicts. Ranks cross-repo action items. |

### What flows up

| From product repos | To OCR-docs | File |
|---|---|---|
| Linear issue counts and status | Issue snapshot table | `OCR_STATUS_project.md` |
| In Progress stories | Stall detection | `OCR_STATUS_project.md` |
| Critical blockers | Org-wide blocker table | `OCR_STATUS_project.md` |
| CCR confidence scores | Team health (RED/YELLOW/GREEN) | `OCR_LOG_session.md` |
| Cross-repo action items | Prioritized action list | `OCR_STATUS_project.md` |
| Boundary violations | CCR gate flags | `docs/ccr-gates/` |

### Bail check

Bloodraven runs a bail check first. If no stories changed status and no PRs merged in 24 hours, it writes "No changes detected" and stops. Target: under 10 tool calls on quiet days. Budget: 50 tool calls max.

---

## The closed loop

The three mechanisms form a cycle:

```
1. Standards defined in OCR-docs
   (OCR_STANDARD_namingConvention, OCR_STANDARD_testNaming, OCR_STANDARD_d1Migration, CCR protocol)
        │
        ▼
2. Propagate Standards pushes them to product repos via PR
        │
        ▼
3. Product repos adopt standards, build features, write tests
        │
        ▼
4. Bloodraven pulls status up — stories, blockers, drift, boundary violations
        │
        ▼
5. OCR-docs updates OCR_STATUS_project.md, OCR_LOG_session.md, ccr-gates/
        │
        ▼
6. Nightly Sync Check audits compliance — catches repos that fell behind
        │
        ▼
7. Audit findings feed back into OCR-docs action items
        │
        ▼
8. Standards updated if needed → back to step 1
```

### Naming is the connective tissue

The naming convention (`Product_Type_What_How_Why`) is what makes the loop machine-readable:

- **Propagate Standards** knows what to copy by file type segment
- **Nightly Sync Check** validates file names against the convention
- **Bloodraven** traces story IDs through file names (`OSE168` in migration name → in test name → in gate name)
- **CI output** reads like a report because test names carry full context
- **PR diffs** tell the story from the file list alone

Without consistent naming, the three mechanisms are disconnected scripts. With it, they're one system.

### CCR is the governance layer

CCR determines whether work can move:

- **Propagation** opens a PR → product repo applies CCR before merging
- **Bloodraven** flags stories that need CCR gates before entering sprint
- **Nightly audit** catches stories that moved to In Progress without a gate file
- **Gate files** (`docs/ccr-gates/`) carry the CCR outcome in the filename

The loop ensures that no story crosses a product boundary, no migration changes a schema, and no test validates a contract without governance having touched it.

---

## DAC scaffold (required in every repo)

```
{repo}/
├── CLAUDE.md                              — Session protocol
├── README.md                              — Public-facing description
├── SKILL.md                               — Reusable AI skills
├── docs/
│   ├── {Product}_VISION.md                — Product vision (derived from OCR)
│   ├── standards/                         — Links back to OCR org-level standards
│   ├── decisions/                         — Product-level decisions
│   └── ccr-gates/                         — CCR gate reviews
├── .ocr-standards/                        — Propagated from OCR-docs (do not edit directly)
│   ├── templates/
│   ├── skills/
│   ├── docs/
│   │   ├── OCR_VISION.md                  — Org-level reference copy
│   │   └── OCR_DEPENDENCY_crossRepo.md    — Cross-repo reference copy
│   └── standards/                         — Naming, testing, D1, org-brain-sync
├── skills/                                — Product-specific skills
├── templates/                             — Product-specific templates
├── migrations/                            — D1 migrations (per OCR_STANDARD_d1Migration)
└── tests/                                 — Tests (per OCR_STANDARD_testNaming)
    ├── security/
    ├── lint/
    ├── unit/
    ├── contract/
    ├── integration/
    ├── api/
    ├── feature/
    ├── e2e/
    └── flow/
```

---

## Propagation update needed

The `propagate-standards.yml` workflow currently watches:

```yaml
paths:
  - 'templates/**'
  - 'skills/**'
  - 'docs/OCR_VISION.md'
  - 'docs/references/OCR_DEPENDENCY_crossRepo.md'
```

It should also watch:

```yaml
paths:
  - 'templates/**'
  - 'skills/**'
  - 'docs/OCR_VISION.md'
  - 'docs/references/OCR_DEPENDENCY_crossRepo.md'
  - 'docs/standards/**'          # ← NEW: naming, testing, D1, org-brain-sync
```

And the copy step should include:

```bash
# Copy standards
mkdir -p target/.ocr-standards/standards
cp -r ocr-docs/docs/standards/* target/.ocr-standards/standards/
```

---

## System-level QA (Layer 5)

The `system-sync-status.md` prompt runs a deeper four-layer drift detection:

| Layer | What it checks | Scope |
|---|---|---|
| 1 | Story ↔ Code | Stories marked Done but code missing, code with no story |
| 2 | Infrastructure ↔ Code | wrangler.toml vs actual config, health checks vs data sources |
| 3 | Documentation ↔ Reality | Docs claim X provisioned but config has placeholders |
| 4 | Test Coverage | Legacy vs canonical test ratios, CI targeting |

This is the deepest audit. It should run weekly or before major milestones (e.g., June 1 corridor activation). Its output is a drift report, not a status update — it finds what the nightly check and Bloodraven miss.

---

## Frequency summary

| Mechanism | Frequency | Direction | Output |
|---|---|---|---|
| Propagate Standards | On change | OCR → product repos | PRs in product repos |
| Nightly Sync Check | Daily (midnight CST) | Product repos → OCR | GitHub issue in OCR-docs |
| Bloodraven Linear Sync | Daily (or on demand) | Linear + repos → OCR | OCR_LOG_session.md, OCR_STATUS_project.md |
| System QA (Layer 5) | Weekly / pre-milestone | Deep audit per repo | Drift report in `.claude/outputs/` |

---

*Last updated: April 9 2026*
*Owner: Matt*
*Status: ACTIVE*
