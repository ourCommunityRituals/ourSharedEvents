---
name: daily-scrum
description: Daily scrum check-in for OSE. Use when the owner says "scrum", "standup", "check in", "what's the status" or "daily".
---

# Daily scrum check-in

1. Read Linear (team OSE) for the current state: In Progress, In Review, Todo by priority. STORIES.md is historical.
2. Read `.claude/inputs/` for new intake items.
3. Check recent `git log origin/main` and the latest `OurSharedEvents CI/CD` push run (T1–T4 decide Done).
4. Report:
   - **Done:** merged and staging chain green since the last check-in
   - **Merged, not Done:** waiting on the staging chain
   - **In progress:** what is being worked
   - **Next up:** the next story by priority, respecting prerequisites
   - **Blockers:** anything waiting on the owner
5. Ask whether to start the next story or change priorities.

Confirm a ticket's state against code and CI before reporting it; Linear can lag.
