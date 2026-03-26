# System Overview — ourCommunityRituals

## What This Is

ourCommunityRituals is an organization managing community event platforms. The system runs as a continuous scrum operation where Claude agents work through epics/features/stories across multiple repositories.

## Active Products

| Product | Repo | Status | Stack |
|---|---|---|---|
| ourSharedEvents | `ourCommunityRituals/ourSharedEvents` | Phase 1 done, Phase 1-Ops next | Cloudflare Worker + D1 + Firebase |

## Architecture

```
                    ┌─────────────────────┐
                    │   Linear Dashboard  │ ← Visualization
                    │  (Epics/Sprints)    │
                    └─────────┬───────────┘
                              │ reads
                    ┌─────────▼───────────┐
                    │    GitHub Repos      │ ← Source of Truth
                    │  .claude/ + STORIES  │
                    └──┬──────┬──────┬────┘
                       │      │      │
              ┌────────▼┐ ┌──▼────┐ ┌▼────────┐
              │ Claude   │ │Claude │ │ Phone   │
              │ Code CLI │ │ Web   │ │ (GitHub │
              │          │ │       │ │ Mobile) │
              └──────────┘ └───────┘ └─────────┘
```

## How Work Flows

1. **Intake**: Stories created in `.claude/inputs/` (via CoWork, phone, or Claude)
2. **Backlog**: Stories added to `STORIES.md` with status BACKLOG
3. **Sprint**: Stories moved to IN PROGRESS, mapped in LINEAR-MAP.md
4. **Execution**: Claude agents work stories (code, test, deploy)
5. **Review**: PRs created, CI runs, story acceptance criteria checked
6. **Done**: Status updated to DONE, Linear updated

## Key Files (per repo)

| File | Purpose |
|---|---|
| `STORIES.md` | Master story registry — sprint state |
| `.claude/knowledge/*.md` | Persistent context for Claude sessions |
| `.claude/skills/*.md` | Reusable skill definitions |
| `.claude/inputs/*.md` | Story intake from CoWork/phone |
| `.claude/sync/SYNC-MANIFEST.md` | Cross-device sync rules |
| `.claude/sync/LINEAR-MAP.md` | Story ↔ Linear issue mapping |
