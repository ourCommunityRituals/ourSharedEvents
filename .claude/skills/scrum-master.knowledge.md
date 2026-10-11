# Scrum Master — Knowledge Base

> **Role:** Ensures tickets are moving, stories make sense, dependencies are respected, and team is unblocked
> **Last Reconciled:** 2026-03-27

---

## Current Sprint State

### Story Flow (STORIES.md)

```
Phase 0 ─── P0-1 (Trello/Linear board)           📋 BACKLOG
Phase 1 Build
        ├── P1-1 (Worker code)                    ✅ DONE
        ├── P1-2 (CI/CD pipeline)                 ✅ DONE
        ├── P1-3 (README identity)                ✅ DONE
        ├── P1-4 (STORIES.md)                     ✅ DONE
        └── P1-5 (E2E launch checklist)           ✅ DONE
Phase 1 Ops
        ├── P1-6 (Infra provisioning)         ←── 📋 NEXT UP (critical path)
        ├── P1-7 (Secrets + first deploy)         📋 blocked by P1-6
        ├── P1-8 (Staging sign-off)               📋 blocked by P1-7
        ├── P1-9 (Repo migration)                 📋 blocked by P1-8
        └── P1-10 (Production launch v1.0.0)      📋 blocked by P1-9
Phase 2
        ├── P2-1 (D1 schema)                      📋 BACKLOG (⚠️ actually done)
        ├── P2-2 (Sheets → D1 migration)          📋 blocked by P2-1
        ├── P2-3 (Swap data layer)                📋 blocked by P2-2
        └── P2-4 (Remove Google SA)               📋 blocked by P2-3
Phase 3
        ├── P3-1 (Firebase Hosting + React)       📋 blocked by P2-3
        └── P3-2 (Firebase Auth)                  📋 blocked by P3-1
```

### Velocity

- **Completed:** 5 stories (P1-1 through P1-5)
- **In Progress:** 0
- **Blocked:** 0 (but P1-6 is the gate for everything)
- **Backlog:** 12 stories

---

## Dependency Chain

```
P1-6 (Infra) → P1-7 (Secrets) → P1-8 (Staging sign-off) → P1-9 (Repo migration) → P1-10 (Launch)
                                                                                         │
                                                                                         ▼
P2-1 (D1 schema) → P2-2 (Migration script) → P2-3 (Swap layer) → P2-4 (Remove Google SA)
                                                    │
                                                    ▼
                                              P3-1 (Firebase) → P3-2 (Auth)
```

**Critical path:** P1-6 → P1-7 → P1-8 → P1-9 → P1-10

Every Phase 2 and Phase 3 story depends on P1-10 completing first. P1-6 (infra provisioning) is the single biggest blocker — it requires human action (Google Cloud console, Cloudflare dashboard, domain registrar).

---

## Issues Flagged

### 1. Story Status Drift — P2-1

**Problem:** STORIES.md shows P2-1 (D1 schema) as 📋 BACKLOG, but 7 migration files and 2 test files already exist in the codebase. Schema work is partially complete.

**Action:** Update P2-1 to 🔄 IN PROGRESS or split into P2-1a (schema design ✅) and P2-1b (D1 database creation 📋).

### 2. Dual Worker — Untracked Work

**Problem:** `worker/` directory contains 5,000+ lines of feature-rich code (40+ handlers, OAuth, BigQuery, Vertex AI) that isn't tracked in any story. `workers/oursharedevents/` is the canonical deployment but has a fraction of the features.

**Action:** Create a resolution story (e.g., P1-X: Resolve dual Worker architecture). This is a product + architecture decision that affects every team member.

### 3. Tracking Tool Mismatch

**Problem:** STORIES.md references Trello (`Trello #` column), `.claude/inputs/` has a Linear integration story, and `.claude/sync/LINEAR-MAP.md` maps to Linear issue IDs.

**Action:** Decide on one tool. Update STORIES.md header to match.

### 4. Test Target Drift

**Problem:** 80+ test files target `worker/` (the legacy implementation), but CI deploys `workers/oursharedevents/` (the clean implementation). Test results don't validate what ships.

**Action:** Flag to QA and SDET. Prioritize writing tests for the canonical Worker.

### 5. Legacy Workflows Still Active

**Problem:** `stage1.yml` and `stage2.yml` run against old code. They may produce confusing CI results.

**Action:** Flag to DevOps. Archive these workflows.

---

## Team Role Coverage (Reconciled)

| Role                       | Knowledge File                      | Key Concern                                       |
| -------------------------- | ----------------------------------- | ------------------------------------------------- |
| Lead Backend Architect     | `backend-architect.knowledge.md`    | Dual Worker resolution, d1.ts creation            |
| Lead Frontend Integration  | `frontend-integration.knowledge.md` | Only 2 of 5 surfaces in canonical Worker          |
| QA / Playwright            | `qa-playwright.knowledge.md`        | Test target mismatch (80+ tests hit wrong Worker) |
| Lead SDET/SRE              | `sdet-sre.knowledge.md`             | Postman collections stale, Datadog not set up     |
| Director of Product Owners | `product-director.knowledge.md`     | Ecosystem products are concepts only              |
| DevOps                     | `devops.knowledge.md`               | No infra provisioned, legacy workflows active     |
| Scrum Master               | `scrum-master.knowledge.md`         | This file                                         |

---

## Ceremony Schedule (Recommended)

| Ceremony         | Frequency | Duration | Purpose                                         |
| ---------------- | --------- | -------- | ----------------------------------------------- |
| Daily Standup    | Daily     | 15 min   | Done/doing/blocked (use `daily-scrum.md` skill) |
| Sprint Planning  | Bi-weekly | 1 hour   | Pick stories, estimate, assign                  |
| Sprint Review    | Bi-weekly | 30 min   | Demo completed work                             |
| Retrospective    | Bi-weekly | 30 min   | Process improvement                             |
| Backlog Grooming | Weekly    | 30 min   | Refine upcoming stories                         |

---

## Story Intake Process

### Sources

1. **`.claude/inputs/`** — Drop `YYYY-MM-DD-short-description.md` files
2. **STORIES.md** — Master registry
3. **Linear** — Issue tracking (via LINEAR-MAP.md)
4. **GitHub Issues** — Bug reports, feature requests

### Intake Flow

```
New idea → .claude/inputs/YYYY-MM-DD-idea.md
  → story-intake.md skill processes it
  → Added to STORIES.md with Phase-Number ID
  → Mapped in LINEAR-MAP.md
  → Picked up in next sprint planning
```

---

## Definition of Done (per story)

From `AGENTS.md`, Definition of Done — all role POVs must be satisfied:

- [ ] Worker route code implemented
- [ ] Tests written (Jest/Vitest + Playwright)
- [ ] D1 migrations applied (if applicable)
- [ ] All acceptance criteria met
- [ ] PR created, CI passes
- [ ] STORIES.md updated
- [ ] `docs/brain/ROLE-STATE.md` role states updated

---

## Action Items (This Sprint)

| Priority | Action                           | Owner             | Status |
| -------- | -------------------------------- | ----------------- | ------ |
| P0       | Resolve dual Worker architecture | Product + Backend | ❌     |
| P0       | Update P2-1 story status         | Scrum Master      | ❌     |
| P1       | Archive legacy workflows         | DevOps            | ❌     |
| P1       | Decide Trello vs Linear          | Product           | ❌     |
| P1       | Begin P1-6 infra provisioning    | DevOps + Product  | ❌     |
| P2       | Write tests for canonical Worker | QA                | ❌     |
| P2       | Update Postman collections       | SDET              | ❌     |
| P3       | Plan Datadog Synthetics          | SDET + DevOps     | ❌     |
