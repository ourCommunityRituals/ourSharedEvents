# Linear Mapping — Story Registry ↔ Linear Issues

Maps STORIES.md story IDs to Linear issues. Status lives in STORIES.md (source of truth).

## Linear Setup

```
Workspace:  oursharedevents
URL:        https://linear.app/oursharedevents
Team:       OUR
Backlog:    https://linear.app/oursharedevents/team/OUR/backlog
```

## Issue Mapping

| Story ID | Linear ID | Title                                          |
| -------- | --------- | ---------------------------------------------- |
| P0-1     | —         | Create Linear board + import all stories       |
| P1-1     | —         | Cloudflare Worker code                         |
| P1-2     | —         | CI/CD pipeline (GitHub Actions)                |
| P1-3     | —         | README — ourSharedEvents identity              |
| P1-4     | —         | STORIES.md — project tracking registry         |
| P1-5     | —         | E2E launch checklist                           |
| P1-6     | —         | Infra provisioning — Google Cloud + Cloudflare |
| P1-7     | —         | Secrets + first staging deploy                 |
| P1-8     | —         | Staging sign-off                               |
| P1-9     | —         | Repo migration → ourCommunityRituals           |
| P1-10    | —         | Production launch — v1.0.0                     |
| P2-1     | OSE-16    | D1 database creation + schema migrations       |
| P2-2     | —         | Data migration script: Sheets → D1             |
| P2-3     | —         | Swap data layer: sheets.ts → d1.ts             |
| P2-4     | —         | Remove Google SA credentials                   |
| P3-1     | —         | Firebase Hosting + React/Tailwind UI           |
| P3-2     | —         | Firebase Auth — replace Bearer token           |

> Fill in `Linear ID` after importing. Format: `OUR-123`.
> PRs that include `OUR-XXX` in commit messages auto-link via GitHub integration.
