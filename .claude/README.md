# Claude — CoWork Sync Directory

This directory mirrors the local `wkrp_ftw\claude\` CoWork folder structure.
GitHub is the sync layer between devices.

## Structure

```
.claude/
├── Documents/     ← Persistent docs, specs, decisions
├── Inputs/        ← Story intake — CoWork feeds stories here
├── Outputs/       ← Claude-generated artifacts (reports, summaries)
├── Research/      ← Research findings, analysis, reference material
├── knowledge/     ← Claude session context (auto-loaded)
├── skills/        ← Reusable Claude skill definitions
└── sync/          ← Sync manifest + Linear mapping
```

## Sync Flow

```
Local (wkrp_ftw\claude\)          GitHub (.claude/)
  Documents/ ──── git push/pull ────→ documents/
  Inputs/    ──── git push/pull ────→ inputs/
  Outputs/   ──── git push/pull ────→ outputs/
  Research/  ──── git push/pull ────→ research/
```

## Quick Sync Commands

```bash
# Push local changes to GitHub
cd wkrp_ftw\claude
git add . && git commit -m "sync: CoWork updates" && git push

# Pull latest from GitHub to local
git pull origin main
```

## Phone Access
Open GitHub Mobile → `ourCommunityRituals/ourSharedEvents` → `.claude/inputs/`
to add stories on the go.
