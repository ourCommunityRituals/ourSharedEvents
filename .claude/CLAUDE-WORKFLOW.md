# CLAUDE-WORKFLOW.md — Session Workflow Reference

> Operational workflow for Claude Code sessions on ourSharedEvents.
> All paths validated 2026-03-30.

---

## Environment

**Working Directory:** `C:\Users\mzdan\dev\ourCommunityRituals\ourSharedEvents`

**Repository:** `ourCommunityRituals/ourSharedEvents`

**Branch Strategy:**

- `main` — production branch
- `claude/<feature>-<id>` — Claude Code feature branches
- PRs target `main`

**Runtime:**

- Node.js (for tests, scripts)
- Cloudflare Workers (wrangler for local dev)
- D1 SQLite (edge database, Phase 2)

---

## Session Protocol

```
1. Read CLAUDE.md          → full project context
2. Read STORIES.md         → find next unstarted story
3. Read .claude/inputs/    → any new intake items
4. Pick next story         → respect prerequisites
5. Implement complete      → all 6 role POVs
6. Create PR               → CI runs automatically
7. Update STORIES.md       → mark IN PROGRESS
```

See CLAUDE.md §5 "The Loop" for full protocol.

---

## Directory Structure (Active)

```
ourSharedEvents/
├── .claude/              # Claude Code workspace files
│   ├── inputs/           # Story intake
│   ├── documents/        # Specs, decisions
│   ├── outputs/          # Generated artifacts
│   ├── research/         # Analysis, references
│   ├── skills/           # Reusable skill definitions
│   └── sync/             # Linear mapping
├── config/               # Brand config, environments, feature flags
├── docs/                 # Architecture, features, deployment, security
├── schemas/              # JSON Schema definitions
├── scripts/              # Build/validation scripts
├── tests/                # All test suites
├── web/                  # HTML surface templates
├── worker/               # Cloudflare Worker (active implementation)
├── workers/oursharedevents/  # D1 migrations + Worker tests
└── wrangler.toml         # Cloudflare config
```

---

## Archived Paths — Do Not Reference

| Path                | Status             | Notes                                                      |
| ------------------- | ------------------ | ---------------------------------------------------------- |
| `~/ZEVENTBOOKS`     | [ARCHIVE]          | Legacy project root — replaced by ourSharedEvents          |
| `MVP-EVENT-TOOLKIT` | [ARCHIVE]          | Legacy repo name — now ourCommunityRituals/ourSharedEvents |
| ThinkPad / E16      | [RETIRED HARDWARE] | Development hardware references no longer applicable       |
| `src/mvp/Config.gs` | [ARCHIVE]          | Apps Script config — replaced by Cloudflare Worker         |
| `Code.gs`           | [ARCHIVE]          | Apps Script entry point — replaced by worker/src/index.ts  |
| `.clasp.json`       | [ARCHIVE]          | clasp config — no longer used                              |

---

## CI/CD Pipeline

5-stage pipeline (see `.github/workflows/`):

1. Typecheck
2. Schema verify
3. Migration apply + table verify
4. Health check + API smoke
5. UI smoke + prod isolation

---

## Sync Points

| Local (CoWork)                     | Repo                 |
| ---------------------------------- | -------------------- |
| `C:\Users\mzdan\claude\Inputs\`    | `.claude/inputs/`    |
| `C:\Users\mzdan\claude\Documents\` | `.claude/documents/` |
| `C:\Users\mzdan\claude\Outputs\`   | `.claude/outputs/`   |
| `C:\Users\mzdan\claude\Research\`  | `.claude/research/`  |
