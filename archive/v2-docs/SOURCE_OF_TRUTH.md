# Source of Truth Declaration

## Canonical Repository

**https://github.com/zeventbooks/MVP-EVENT-TOOLKIT**

## Canonical Branch

**`main`**

---

## What This Means

| Aspect | Value |
|--------|-------|
| **Repository** | `zeventbooks/MVP-EVENT-TOOLKIT` |
| **Primary Branch** | `main` |
| **Feature Branches** | Work-in-progress until merged to `main` |

## Guidelines

1. **All code in `main` is canonical** - This is the authoritative version of the codebase
2. **Feature branches are experimental** - Code in `claude/*`, `codex/*`, or other branches is not canonical until merged
3. **Conflicts defer to `main`** - Any conflicting code in other repos, forks, or pasted snippets should defer to what's in `main`
4. **PRs target `main`** - All pull requests should be opened against the `main` branch

## Overriding This Declaration

To change the source of truth, explicitly state:

> "Use branch X as the new source of truth"

or

> "Use repository Y as the new source of truth"

---

*Last updated: 2025-11-21*
