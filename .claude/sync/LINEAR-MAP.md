# Linear Mapping — Story Registry ↔ Linear Issues

Maps STORIES.md story IDs to Linear for visualization and scrum tracking.

## Linear Setup

```
Workspace:  ourCommunityRituals
Team:       Platform

Project:    ourSharedEvents
  Cycles:
    - Phase 0 — Project Setup
    - Phase 1 — Build
    - Phase 1 — Operations
    - Phase 2 — D1 Database
    - Phase 3 — Firebase
```

## Issue Mapping

| Story ID | Linear ID | Title | Status | Sprint |
|----------|-----------|-------|--------|--------|
| P0-1 | — | Create Trello board + import all stories | Backlog | — |
| P1-1 | — | Cloudflare Worker code | Done | — |
| P1-2 | — | CI/CD pipeline (GitHub Actions) | Done | — |
| P1-3 | — | README — ourSharedEvents identity | Done | — |
| P1-4 | — | STORIES.md — project tracking registry | Done | — |
| P1-5 | — | E2E launch checklist | Done | — |
| P1-6 | — | Infra provisioning — Google Cloud + Cloudflare | Backlog | — |
| P1-7 | — | Secrets + first staging deploy | Backlog | — |
| P1-8 | — | Staging sign-off | Backlog | — |
| P1-9 | — | Repo migration → ourCommunityRituals | Backlog | — |
| P1-10 | — | Production launch — v1.0.0 | Backlog | — |
| P2-1 | — | D1 database creation + schema migrations | Backlog | — |
| P2-2 | — | Data migration script: Sheets → D1 | Backlog | — |
| P2-3 | — | Swap data layer: sheets.ts → d1.ts | Backlog | — |
| P2-4 | — | Remove Google SA credentials | Backlog | — |
| P3-1 | — | Firebase Hosting + React/Tailwind UI | Backlog | — |
| P3-2 | — | Firebase Auth — replace Bearer token | Backlog | — |

> **Fill in Linear IDs** after importing stories. Format: `OSE-123` (project prefix + number).

## Scrum Mapping

| Scrum Concept | Linear Feature | Source File |
|---|---|---|
| Product Backlog | Project backlog view | `STORIES.md` |
| Sprint Backlog | Active cycle | `.claude/sync/LINEAR-MAP.md` Sprint column |
| Daily Standup | Cycle progress view | Linear dashboard |
| Sprint Review | Cycle completion | Phase acceptance criteria |
| Epics | Projects | Phase 0, 1, 2, 3 |
| Stories | Issues | P1-1, P1-2, etc. |
| Tasks | Sub-issues | Individual PRs / commits |
| Blockers | Issue dependencies | Prerequisite column in STORIES.md |

## How the Scrum Team Works

```
Product Owner (You)
  → Writes epics/features/stories in .claude/inputs/ via CoWork or phone
  → Reviews sprint progress in Linear dashboard
  → Accepts/rejects completed stories

Scrum Master (Claude — this system)
  → Picks up stories from STORIES.md in priority order
  → Updates status as work progresses
  → Creates PRs, runs tests, deploys
  → Reports blockers

Dev Team (Claude agents across repos)
  → ourSharedEvents agent: Platform work
  → Future: ourRecNights agent, etc.
  → Each agent works its repo's STORIES.md
```

## Import to Linear

To bulk-import stories into Linear:

1. Export this table as CSV
2. Linear → Settings → Import → CSV
3. Map columns: Story ID → Identifier, Title → Title, Status → State
4. Assign to `ourSharedEvents` project
5. Fill `Linear ID` column back into this file
6. Commit updated LINEAR-MAP.md

Or use Linear API:
```bash
# Example: create issue via Linear API
curl -X POST https://api.linear.app/graphql \
  -H "Authorization: Bearer $LINEAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "mutation { issueCreate(input: { teamId: \"TEAM_ID\", title: \"P1-6: Infra provisioning\", projectId: \"PROJECT_ID\" }) { issue { id identifier } } }"}'
```
