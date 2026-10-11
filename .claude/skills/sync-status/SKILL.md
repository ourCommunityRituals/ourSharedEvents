---
name: sync-status
description: Report what changed since the owner's last session, from a new device or after time away. Use when the owner asks about sync, what's new, or what changed.
---

# Cross-device sync status

1. `git log --oneline -15 origin/main`, plus open PRs and their CI.
2. Unprocessed items in `.claude/inputs/`.
3. The relevant ADRs against the code, to spot drift.
4. Linear state changes since the last session (team OSE).
5. Flag stale backlog or admin state as drift unless the code confirms it.
6. Report what is new, then anything that needs the owner's attention.
