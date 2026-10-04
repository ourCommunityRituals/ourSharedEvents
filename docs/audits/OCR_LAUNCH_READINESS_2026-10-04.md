# OCR launch-readiness report, 2026-10-04

Point-in-time snapshot taken 2026-10-04, 20 days before the Oct 24 launch. Sources: Linear (all OCR teams), GitHub Actions and PR counts for every active repo in `ourCommunityRituals`, and unauthenticated probes of production. Status values may have moved since.

## Findings

1. **Production admin has no Access app in front of it.** Unauthenticated GETs to `/admin`, `/manage`, `/briefing` and `/api/v2/admin/sponsors` on `oursharedevents.com` return a Worker 401 with no Access redirect. HEAD on `/admin` returns 404. The last 6 CF Access Canary runs (Oct 2 to Oct 4) all failed, and the latest run failed both "Access app routing" jobs (production and staging). OSE-1353 is a Cloudflare dashboard task: 8 path destinations on the apex, an Allow policy for the founder email only, then pin `CF_ACCESS_AUD`. `www` needs no Access destinations: `www.oursharedevents.com/admin` answers 301 to the apex with no Worker headers, before the Worker runs. OSE-1415, OSE-1511 and the AUD pin wait behind OSE-1353.
2. **Security work dominates the release-blocking list.** In progress: OSE-1447, OSE-1466, OSE-1467, OSE-1421 (due Sep 30), OSE-1561. OSE-1456 (no non-founder admin until the holes close) is in Backlog. OSE-1490 (missing `OCR_CI_EDGE_TOKEN`) keeps T4 red.
3. **Outside OSE, only OurWKRP needs attention.** Its `main` has a failing CI run (Deploy Staging job) and a failing Mobile Workability run. Backlog: OW-124 (KV rate limiter never counted), OW-130 (roster full-dump), OW-116 (org-wide credential audit).

## By product

| Product                | `main` CI (latest)               | Open PRs   | Notes                                   |
| ---------------------- | -------------------------------- | ---------- | --------------------------------------- |
| OSE                    | Success, last 5 pushes           | not pulled | 13 release-blocking issues open         |
| OW                     | Failure (CI, Mobile Workability) | 0          | 3 in review                             |
| OCR hub                | Success                          | 0          |                                         |
| OCR-docs               | Success                          | 0          | OCR-145 in progress                     |
| OSG, OSR, OSM, OSP, OA | Success (last push Oct 2)        | 0          | OSR, OSM, OSP, OA not queried in Linear |
| OER                    | Success (last push Sep 29)       | 0          | no Linear team                          |

## Overdue or stale

- OSE-1421 due Sep 30, in progress.
- OSE-1396 (Dependabot decision, Urgent) and OSE-797 (sponsor-card walk) both due Oct 3, no activity.
- OSE-1252 (print a poster and scan it) due Oct 17, Todo, needs the founder in person.
- OSE-1251 (GO/NO-GO) due Oct 21, in progress.

## Gaps in this run

First run, so no week-over-week comparison. The Urgent issue list had a second page that was not pulled. No XLSX. OSR, OSM, OSP and OA were not checked in Linear. OSE open-PR count not pulled.

## Report definition (saved for reruns)

```
Name:      OCR launch-readiness (org-wide)
Created:   2026-10-04
Cadence:   weekly, Mon to Sun (proposed, not confirmed)
Metrics:   release-blocking Linear issues by status, priority and due date (OSE);
           open Urgent and started issues per Linear team (OW, OCR-doc, OSG, OSR, OSM);
           main-branch CI, last 3 runs, per repo in ourCommunityRituals;
           open PRs per repo;
           OSE only: staging chain T1 to T4 for the latest main push, CF Access Canary
           last 6 runs, live probe of the admin paths on production
Grouping:  by product
Comparison: previous run
Period:    trailing 7 days for activity, point-in-time for status
Sources:   Linear, GitHub (gh), curl
Output:    chat summary + page; XLSX optional
```
