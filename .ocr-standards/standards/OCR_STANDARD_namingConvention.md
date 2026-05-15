# Naming Convention — OCR Org-Level

> One spine. Every file type. Every repo. Read the name, know the contents.

---

## The spine

```
{Product}_{Type}_{What}_{How}_{Why}
```

| Segment | Answers | Required |
|---------|---------|----------|
| **Product** | Which repo/product owns this | Always |
| **Type** | What category of artifact this is | Always |
| **What** | What this file does or defines | Always |
| **How** | How it accomplishes it, or what mechanism it uses | When the mechanism matters |
| **Why** | Why this file exists — the trigger, the story, the constraint | When intent matters |

Not every file needs all five segments. A migration needs Product, Type, What, and Why. A simple config might only need Product and Type. The rule: **use as many segments as it takes for the name to tell the story without opening the file.**

---

## Product codes

| Code | Product |
|------|---------|
| `OCR` | OurCommunityRituals (org-level) |
| `OSE` | OurSharedEvents |
| `OW` | OurWKRP |
| `OSG` | OurSharedGames |
| `OSR` | OurSharedRecords |
| `OSP` | OurSharedPulse |
| `OSM` | OurSharedMagnets |
| `OER` | OurEventRings |
| `OWL` | OurWhiteList |

---

## By artifact type

### Tests

See `OCR_STANDARD_testNaming.md` for full detail. Summary:

```
{Product}_{TestType}_{What}_{How}_{Why}.test.js
```

Test types: `SECURITY`, `LINT`, `UNIT`, `CONTRACT`, `INTEGRATION`, `API`, `FEATURE`, `E2E`, `FLOW`

```
OSE_UNIT_sponsorTierNormalization_mockCoercion_backwardCompat.test.js
OSE_CONTRACT_sponsorSchema_enumValidation_OSE168.test.js
OW_UNIT_sanitizeForExport_stripContributorId_boundaryOWxOSE.test.js
OSE_FLOW_sponsorOnboarding_adminCreateToPreview_fullJourney.test.js
```

### Migrations

See `OCR_STANDARD_d1Migration.md` for schema rules. File naming:

```
{NNNN}_{Product}_{MIGRATION}_{what}_{why}.sql
```

The sequence number stays first for ordering. Product and type follow the spine.

```
0018_OSE_MIGRATION_fixSponsorTierDefault_OSE168.sql
0006_OW_MIGRATION_djAttribution_epicPlaylistLinking.sql
0010_OSE_MIGRATION_ncrV2Hierarchy_geographicExperiment.sql
```

### Documentation

```
{Product}_{DocType}_{what}_{why}.md
```

Doc types: `STANDARD`, `DECISION`, `GATE`, `CHECKLIST`, `VISION`, `DEPENDENCY`, `PROMPT`

```
OCR_STANDARD_d1Migration.md
OCR_STANDARD_testNaming.md
OCR_STANDARD_namingConvention.md
OCR_DECISION_mockDataProvider.md
OW_GATE_OW30_boundaryReview.md
OCR_CHECKLIST_beverlyActivation.md
OCR_DEPENDENCY_crossRepo.md
OSE_GATE_OSE12_acAudit.md
```

#### ADRs — exception (MADR format)

Architecture Decision Records are an **exception** to the `{Product}_{DocType}_{what}_{why}.md` rule. As of 2026-05-15 (routing-matrix adoption — see `OCR-docs/OPERATING_SYSTEM.md §3`), ADRs use the MADR convention `ADR-NNN-kebab-case-title.md` and live in `docs/adr/` (per-repo) or `OCR-docs/docs/adr/` (fleet-wide).

```
ourSharedEvents/docs/adr/ADR-001-anonymous-identity-architecture.md   # per-repo
OCR-docs/docs/adr/ADR-001-docs-as-code-scaffold.md                    # fleet-wide
```

The previous file `OCR_ADR_001_repoScaffold.md` has been migrated to `OCR-docs/docs/adr/ADR-001-docs-as-code-scaffold.md` as part of `CURRENT_STATE_INVENTORY.md` gap G9 closure.

### Skills

Skills use Claude Code's discovery format (`skills/` directory, `*.knowledge.md` suffix). These are tool-mandated names — do not rename.

```
skills/ccr-protocol.knowledge.md       — Claude Code knowledge file (tool-mandated)
skills/ccr-mvp.md                       — Claude Code skill (tool-mandated)
skills/ccr-template.md                  — Claude Code skill (tool-mandated)
```

For new in-house skill docs that are NOT Claude Code skill files:

```
{Product}_{SKILL}_{what}.md
```

### Prompts

```
{Product}_{PROMPT}_{what}_{trigger}.md
```

```
OCR_PROMPT_dailyLinearSync.md
OCR_PROMPT_systemSyncStatus.md
OCR_PROMPT_storyRunnerPrecheck.md
```

### Schemas

```
{Product}_{SCHEMA}_{entity}_{version}.json
```

```
OSE_SCHEMA_sponsor_v1.json
OSE_SCHEMA_event_v1.json
OW_SCHEMA_contributor_v1.json
OW_SCHEMA_playlist_v1.json
```

### Workflows (CI/CD)

```
{product}-{type}-{what}.yml
```

Lowercase with hyphens for GitHub Actions compatibility.

```
ose-ci-deploy-staging.yml
ose-ci-security-gate.yml
ocr-ci-propagate-standards.yml
ocr-ci-nightly-sync-check.yml
ow-ci-deploy-staging.yml
```

### Templates

Tool-mandated templates (Claude Code scaffold) keep their names:

```
templates/CLAUDE-base.md              — Claude Code base template (tool-mandated)
templates/SKILL-template.md           — Claude Code skill template (tool-mandated)
```

In-house templates follow the spine:

```
{Product}_{TEMPLATE}_{what}.md
```

```
OCR_TEMPLATE_adr.md
ocr-template-docs-ci-caller.yml      — yml uses lowercase-hyphenated
```

### Config files

Config files that live in repo root (`wrangler.toml`, `package.json`, `tsconfig.json`, etc.) keep their standard names — these are tool-mandated and should not be renamed.

Product-specific config inside `config/` or `environments/` directories:

```
{product}-{environment}-{what}.{ext}
```

```
ose-staging-wrangler.toml
ose-mock-stg.environment.yaml
ow-production-secrets.example.env
```

---

## Casing rules

| Context | Casing | Example |
|---------|--------|---------|
| Product code | UPPERCASE | `OSE`, `OW`, `OCR` |
| Type | UPPERCASE | `UNIT`, `MIGRATION`, `STANDARD` |
| What/How/Why segments | camelCase | `sponsorTierNormalization`, `mockCoercion` |
| Workflow files | lowercase-hyphenated | `ose-ci-deploy-staging.yml` |
| Migration files | snake_case after sequence | `0018_OSE_MIGRATION_fixSponsorTierDefault_OSE168.sql` |

---

## CCR integration

The naming convention and CCR protocol are the two halves of the governance backbone. Naming tells you **what something is**. CCR tells you **whether it's ready to move**.

### CCR status in file names

Gate reviews, decisions, and audit docs carry the CCR outcome in the Why segment:

```
OCR_GATE_OW30_boundaryReview_BLOCKED.md        — CCR blocked, cannot proceed
OCR_GATE_OW30_boundaryReview_PASSED.md          — CCR passed, cleared for sprint
OCR_DECISION_mockDataProvider_DECIDED.md         — Decision recorded
OSE_GATE_OSE12_acAudit_CLOSEABLE.md              — Audit complete, ready to close
```

When a gate changes status, the file is renamed. The folder listing is a live governance dashboard.

### CCR loops reference naming

CCR Loop 1 (Critical) flags blockers. Those blockers become file names:

```
CCR flags OSE-168 as critical
  → Migration created: 0018_OSE_MIGRATION_fixSponsorTierDefault_OSE168.sql
  → Test created:      OSE_CONTRACT_sponsorSchema_enumValidation_OSE168.test.js
  → Gate updated:      OSE_GATE_OSE168_isPrimaryFix_RESOLVED.md
```

The story ID travels from the CCR loop → through the file names → into the CI output → back to the sync agent. Full traceability by naming alone.

### Cross-repo propagation

Every product repo maintains the same DAC scaffold:

```
{repo}/
├── CLAUDE.md                    — Session protocol (references naming convention)
├── docs/
│   ├── VISION.md                — Product vision (derived from OCR)
│   ├── standards/               — Links back to OCR org-level standards
│   ├── decisions/               — Product-level decisions
│   └── ccr-gates/               — CCR gate reviews
├── skills/                      — Reusable AI skills
├── templates/                   — Scaffolding templates
├── migrations/                  — D1 migrations (per OCR_STANDARD_d1Migration)
└── tests/                       — Tests (per OCR_STANDARD_testNaming)
```

OCR-docs owns the standards. Product repos inherit them. The `propagate-standards.yml` workflow (Phase 3) cascades changes. Until then, the naming convention makes manual propagation obvious — if a file follows the spine, it belongs. If it doesn't, it's tech debt.

## Why this matters

A sync agent scanning the file tree can categorize every artifact without reading contents. A new dev can navigate by filename. A CI report becomes a status dashboard. A PR diff tells you which products, which types, and which stories are in play — from the file list alone. A CCR review reads the folder and knows what's blocked, what's passed, and what's missing.

The naming convention is the cheapest documentation in the system. It costs nothing to maintain because it's enforced at file creation. And it compounds — every file named correctly makes every other file easier to find, every CCR gate easier to trace, and every cross-repo dependency easier to audit.

---

## Adoption

### New files

All new files follow this convention from now. No exceptions.

### Existing files

Rename existing files to match the convention during the next meaningful touch. Don't create churn-only PRs to rename files — rename when you're already editing. Within one release cycle, the codebase converges naturally.

### Validation

A future CI check (planned) will validate file naming against this standard. Until then, PR reviewers enforce it.

---

*Last updated: April 9 2026*
*Owner: Matt*
*Status: ACTIVE*
