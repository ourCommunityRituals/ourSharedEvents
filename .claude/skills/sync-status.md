# Skill: Cross-Device Sync Status

## When to Use

User asks about sync, what's changed, or checks from a new device

## Steps

1. Check `git log --oneline -10` for recent changes
2. Check `.claude/inputs/` for unprocessed intake items
3. Check the relevant ADR(s) against the code to detect drift
4. Check `STORIES.md` for any status changes
5. Check `.claude/sync/LINEAR-MAP.md` for sprint updates
6. Flag stale backlog/admin state as drift unless it is directly verified in code
7. Report what's new since the user's last session
8. Flag any conflicts or items needing attention
