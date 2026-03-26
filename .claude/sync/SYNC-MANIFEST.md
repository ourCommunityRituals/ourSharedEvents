# Sync Manifest — Cross-Device File Registry

How files flow between Claude Code (CLI), Claude Web (claude.ai), phone (GitHub Mobile), and Linear.

## Sync Architecture

```
GitHub (source of truth)
  └── .claude/
       ├── skills/          → Claude Code + Claude Web (shared skills)
       ├── knowledge/        → Claude Code + Claude Web (shared context)
       ├── inputs/           → CoWork feed → Linear intake
       └── sync/
            ├── SYNC-MANIFEST.md   (this file)
            └── LINEAR-MAP.md      (story ↔ Linear mapping)

Phone (GitHub Mobile)
  └── reads/writes .claude/inputs/*.md  → CoWork story intake
  └── reads STORIES.md                  → daily scrum check

Linear (visualization layer)
  └── Team: ourCommunityRituals
       ├── Project: ourSharedEvents    ← maps from STORIES.md
       ├── Project: ourRecNights       ← future repos
       └── Project: <next-product>     ← future repos

Claude Code / Claude Web
  └── reads .claude/knowledge/*.md     → persistent context
  └── reads .claude/skills/*.md        → reusable capabilities
  └── reads STORIES.md                 → current sprint state
```

## Sync Rules

| File Pattern | Direction | Devices | Notes |
|---|---|---|---|
| `STORIES.md` | bidirectional | All | Sprint state — Linear reads this |
| `.claude/inputs/*.md` | phone → repo | Phone, Claude | CoWork story intake |
| `.claude/knowledge/*.md` | repo → clients | Claude Code, Web | Shared context MDs |
| `.claude/skills/*.md` | repo → clients | Claude Code, Web | Reusable skill definitions |
| `.claude/sync/LINEAR-MAP.md` | repo ↔ Linear | All | Story ID ↔ Linear issue mapping |
| `docs/stories/*.md` | repo → clients | All | Detailed story specs |

## How to Sync from Phone

1. Open **GitHub Mobile** → `ourCommunityRituals/ourSharedEvents`
2. Navigate to `.claude/inputs/`
3. Create/edit markdown files (new stories, feedback, priorities)
4. Commit directly to `main` or open a PR
5. Claude picks up changes on next session

## How Linear Stays Updated

Linear integration reads from `STORIES.md` and `.claude/sync/LINEAR-MAP.md`:
- Each Phase = Linear **Cycle** or **Project**
- Each Story ID (P1-1, P2-1, etc.) = Linear **Issue**
- Status badges (BACKLOG/IN PROGRESS/DONE) = Linear issue state
- Prerequisites = Linear issue dependencies

## Multi-Repo Strategy

This same `.claude/` structure replicates across repos:

```
ourCommunityRituals/
  ├── ourSharedEvents/.claude/     ← this repo
  ├── ourRecNights/.claude/        ← future
  ├── <product-N>/.claude/         ← future
  └── .github/.claude/             ← org-wide shared skills/knowledge
```

Org-wide files live in `ourCommunityRituals/.github/.claude/` and are inherited.
Per-repo files override org-wide ones.
