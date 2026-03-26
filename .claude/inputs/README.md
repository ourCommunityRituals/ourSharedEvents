# Inputs — Story Intake Folder

Drop markdown files here from any device to feed new stories into the system.

## How to Use

### From Phone (GitHub Mobile)
1. Open this folder in GitHub Mobile
2. Tap "+" to create a new file
3. Name it: `YYYY-MM-DD-short-description.md`
4. Write your story idea, feature request, or priority change
5. Commit to `main`

### From CoWork
1. Export your story/epic as markdown
2. Save to this folder
3. Commit and push

### From Claude Web
1. Ask Claude to create a new input file
2. Claude writes to `.claude/inputs/`

## Template

```markdown
# [Story Title]

## Type
epic | feature | story | bug | chore

## Priority
high | medium | low

## Description
What needs to happen and why.

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2
```

## Processing
Claude picks up files here during daily scrum and adds them to STORIES.md.
Processed files are moved to `.claude/inputs/archive/` after integration.
