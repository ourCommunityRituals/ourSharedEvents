# Mobile workability baseline: 2026-10-06

Part of OSE-293 (parent epic OSE-292). This is the per-surface baseline the story
asked for. It was written five months after the story was filed, so it records
where the surfaces stand now, not the gap list the drains were meant to start from.

## What was run

| Item      | Value                                                                         |
| --------- | ----------------------------------------------------------------------------- |
| Spec      | `tests/playwright/mobile-workability.spec.ts`                                 |
| Config    | `playwright.config.ts` (the nightly's config; target is deployed staging)     |
| Target    | `https://stg.oursharedevents.com`, `/health` version `stg-be63c69-20261006`   |
| Run from  | a developer machine, 2026-10-06 06:12 UTC                                     |
| Projects  | iPhone SE, iPhone 14 Pro Max, iPad Air, Desktop Safari (all at 375×812)       |
| Contracts | no sideways scroll; touch targets ≥ 44×44 px; input font ≥ 16 px; primary CTA |
|           | above the fold; no pinch-zoom needed to submit a form                         |

Each surface gets 5 contracts × 4 projects = 20 checks.

**Result: 180 passed, 0 failed, 140 skipped.**

## Per surface, on staging

| Surface                   | Path                                     | Passed | Failed | Skipped |
| ------------------------- | ---------------------------------------- | ------ | ------ | ------- |
| Landing                   | `/`                                      | 20     | 0      | 0       |
| Public events listing     | `/events`                                | 20     | 0      | 0       |
| Public event page         | `/events/evt_test_2026`                  | 20     | 0      | 0       |
| Register form             | `/forms/evt_test_2026?type=register`     | 20     | 0      | 0       |
| Check-in form             | `/forms/evt_test_2026?type=checkin`      | 20     | 0      | 0       |
| Survey form               | `/forms/evt_test_2026?type=survey`       | 20     | 0      | 0       |
| Email sign-up form        | `/forms/evt_test_2026?type=email-signup` | 20     | 0      | 0       |
| Poster preview            | `/poster`                                | 20     | 0      | 0       |
| Component preview         | `/ui-preview`                            | 20     | 0      | 0       |
| Organizer sign-in page    | `/admin` (no credentials)                | 0      | 0      | 20      |
| Admin dashboard           | `/admin`                                 | 0      | 0      | 20      |
| Admin logs                | `/api/v2/admin/screens/logs`             | 0      | 0      | 20      |
| Admin settings            | `/api/v2/admin/screens/settings`         | 0      | 0      | 20      |
| SharedReport (admin mode) | `/sharedReport`                          | 0      | 0      | 20      |
| Sponsor home              | `/sponsor?t=`                            | 0      | 0      | 20      |
| Sponsor card              | `/sponsors/:id`                          | 0      | 0      | 20      |

No violation of any contract was found on the nine surfaces the staging run can reach.

## Why seven surfaces are skipped on staging

| Surface                                       | Reason                                                                              |
| --------------------------------------------- | ----------------------------------------------------------------------------------- |
| Admin dashboard, logs, settings, SharedReport | `OSE_ADMIN_BEARER` is not set for the nightly (OSE-302), so the run cannot sign in. |
| Sponsor home                                  | `OSE_SPONSOR_HOME_TOKEN` is not set; without it the page is the invalid-link page.  |
| Sponsor card                                  | `OSE_SPONSOR_CARD_ID` is not set; without a seeded sponsor the page is the 404.     |
| Organizer sign-in page                        | Cloudflare Access answers `/admin` on staging before the Worker runs (see below).   |

These seven are measured on every pull request instead, by the blocking job in
`mobile-workability-audit.yml` (`playwright.mobile.config.ts`, a local worker running
the PR's code, with a local admin key and a seeded sponsor). Its most recent passing
run before this report: run 37349575194 on 2026-10-05, 413 passed, 0 failed. That job
is the one that blocks a merge. The staging nightly does not block anything.

So the staging run is a check on nine public surfaces as deployed. It is not evidence
for the admin, SharedReport or sponsor surfaces on staging.

## One finding: the nightly was failing on Cloudflare's page

The nightly of 2026-10-05 (run 37357145901, commit `b547cf3f`) failed: 184 passed,
16 failed, 120 skipped. All 16 failures were the "organizer sign-in page" surface
(4 contracts × 4 projects), for example a 301×20 px link.

That surface was added to the audit with the organizer entry work. On a local worker,
`/admin` without credentials is the Worker's own sign-in page. On staging, an
unauthenticated `GET /admin` is a 302 to the Cloudflare Access login page (checked
2026-10-06), so the nightly measured Cloudflare's page. The wording and layout of that
page are set in the Cloudflare dashboard, not in this repo (OSE-1529).

Change in this PR: the surface is marked `localOnly`. A run whose `baseURL` is not a
local address skips it with the reason stated; a local run measures it as before.

- Before (CI, run 37357145901): 16 failed on this surface.
- After (staging, this run): 20 skipped on this surface, 0 failed overall.
- Still to confirm in this PR's own CI log: the blocking job lists the sign-in page as
  passed, not skipped. If it shows as skipped there, the change is wrong.

## What this means for the drain stories

| Story   | Surface         | Staging today | Locked by a blocking check on PRs |
| ------- | --------------- | ------------- | --------------------------------- |
| OSE-296 | Four form pages | 80 of 80 pass | Yes, all four types               |
| OSE-297 | `/events`       | 20 of 20 pass | Yes                               |
| OSE-299 | `/`             | 20 of 20 pass | Yes                               |

Each story's first acceptance line (the audit reports no violations for its surface)
holds on staging today and is held by the blocking PR job.

Not shown by this report:

- OSE-297 and OSE-299 also ask for "vitest + Playwright FE tests added". The Playwright
  side is this audit. There are worker-pool mobile specs for admin, the error page, the
  poster, the public event page and SharedReport, and none named for `/events` or `/`.
  Whether the audit alone satisfies that line is the PO's call.
- Text at 200% size in page bodies is not gated (event cards, sponsor-home cards and
  the register form overflow), as recorded in the project notes.
- The audit runs at 375×812 in every staging project. Real tablet width (820×1180) is
  measured only by the `tablet-chromium` project in the PR job; tablet column widths are
  the open decision in OSE-1557.

## Reproduce

```bash
STAGING_URL=https://stg.oursharedevents.com npx playwright test tests/playwright/mobile-workability.spec.ts --config playwright.config.ts --reporter=list
```
