# Scrum Workflow — Continuous Agent Operations

## Daily Scrum (Check-In Protocol)

When the user checks in, Claude should:

1. **Read** `STORIES.md` — current sprint state
2. **Read** `.claude/inputs/` — any new stories or priorities from phone/CoWork
3. **Read** `.claude/sync/LINEAR-MAP.md` — what's assigned to current sprint
4. **Report**:
   - What was completed since last check-in
   - What's in progress now
   - Any blockers
5. **Propose** next story to pick up (respecting prerequisites)

## Sprint Cadence

- **Sprint length**: 1 week (or as the user defines)
- **Sprint planning**: User selects stories from BACKLOG → assigns to sprint in LINEAR-MAP.md
- **Sprint review**: At sprint end, review DONE stories, demo if applicable
- **Retrospective**: What worked, what didn't, adjust process

## Story Lifecycle

```
.claude/inputs/new-story.md   →   STORIES.md (BACKLOG)
                                       │
                               LINEAR-MAP.md (Sprint assigned)
                                       │
                               STORIES.md (IN PROGRESS)
                                       │
                               PR created + CI passes
                                       │
                               STORIES.md (DONE)
                                       │
                               LINEAR-MAP.md (Linear ID filled)
```

## Multi-Repo Coordination

When stories span repos:
1. Create story in the **primary** repo's STORIES.md
2. Add cross-references: `Depends on: ourRecNights#P1-3`
3. Claude agents in each repo work their own STORIES.md
4. Linear shows cross-project dependencies
