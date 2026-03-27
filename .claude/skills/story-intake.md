# Skill: Story Intake from CoWork/Phone

## When to Use
New files appear in `.claude/inputs/` or user submits story ideas

## Steps

1. Read new/modified files in `.claude/inputs/`
2. For each intake item:
   - Assign a story ID following the convention (Phase-Number, e.g. P1-11)
   - Write acceptance criteria
   - Identify prerequisites from existing stories
   - Determine which phase/epic it belongs to
3. Add the story to `STORIES.md` in the correct phase section
4. Update `.claude/sync/LINEAR-MAP.md` with the new story
5. Commit changes with message: `feat: add story <ID> — <title>`
