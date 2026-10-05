# CCR — PR #831 "Search indexability: canonicals for / and /privacy, one production host, sponsor robots rule" (2026-10-05)

**Target:** ourCommunityRituals/ourSharedEvents#831, branch `seo/indexability-slice-1`.

- Assessed head: `906cf7fa`.
- Corrected head: `25567345` (two correction commits: `10ccffba`, `25567345`).

**Protocol:** CCR v3.0 (`.claude/skills/ccr-protocol.md`), 4 loops, gate 95%. Scoped as a standard change with a security-adjacent surface (crawl policy for a token page), on a production public surface with no PII in the changed pages (environment modifier 1.0).

- Weights: Critical 15 · High 10 · Medium 5 · Low 2; Tier-1 base items at 15/15/10/10/15 (Partial = half).
- Deductions apply only to unresolved findings _in this change_. This follows the repo's earlier PR worksheets (flat weights). A strict reading of the heuristics (H3 breadth, H4 three-or-more promotion) is shown as a sensitivity line, not hidden.

**Team:** the extended scrum team — PO · BE · FD · Sr Design FE · Sr QA Automation · Sr SDET/SRE · DevOps Mgr · **Dr of Security** · **Sr Data Scientist**.

**Frame:** a crawler, a link-preview bot and a visitor reach the same public pages from `oursharedevents.com`, and a sponsor opens a private link. Search engines must see one address per page, must never be pointed at a private page, and the change must not make any count wrong.

## Scope of what this PR changes

Builds on #828 (already on `main`: canonical, description and JSON-LD on event pages, canonical on `/events`, the four alias redirects). This PR adds:

- canonical on `/` (also served at `/home`, `/welcome`, `/landing`, `/about`, `/info`) and `/privacy` (also `/privacy-policy`);
- `lib/canonical.ts`: production always names `https://oursharedevents.com`; other environments name the host asked;
- `robots.txt`: `Disallow: /sponsor` becomes `/sponsor?` + `/sponsor$`; the `Sitemap:` line and `sitemap.xml` use the same origin;
- Bruno alias requests that assert the redirect; three specs.

## Evidence gathered before scoring

- **Only two routes sit under the old `/sponsor` prefix:** `GET /sponsor` (token page, `router.ts:1967`) and `GET /sponsors/:id` (public card, `router.ts:1973`). Plus the static `/sponsor-default-logo.svg`. Nothing private is newly crawlable.
- **The card is read-only and limited.** No INSERT/UPDATE/DELETE or `waitUntil` in `handlers/sponsor-card.ts`; `isPublicReadLimited(request, env, 'sponsor-card')` at `sponsor-card.ts:28`. It renders only a sponsor that is on show, and `sponsor-card.html` carries `<meta name="robots" content="noindex">`.
- **A bare `/sponsor` returns the invalid-link page, no data:** `verifySponsorHomeToken(env, null)` fails at `sponsor-home.ts:178-179`.
- **Production really is `production`:** `wrangler.toml:372` (`[env.production.vars] WORKER_ENV = "production"`), and `/health` on production returned `env: production` (root `CLAUDE.md` §3, read live 2026-10-03). The Worker also routes `www.` (`wrangler.toml:293-296`).
- **`www` never reaches the Worker today.** Live, read-only, 2026-10-05: `https://www.oursharedevents.com/events` and `/robots.txt` answer `301` to the apex (a Cloudflare redirect, not in this repo). Production `/robots.txt` is currently `404` (JSON), which is the launch step under OSE-1511.
- **Event ids are server-generated** `evt_<uuid>` (`events.ts:561`), so a raw id in the canonical and an encoded id in the sitemap cannot differ.
- **The worker specs are a merge gate.** `worker-d1-schema` shards 1–3 run `npm test` (both pools) under the required `T0 Gate (tests)` aggregate (`oursharedevents-ci.yml:846-891`).
- **T2 (Bruno) runs without the Cloudflare edge token:** the `bru run . -r --env ose-staging` step passes the admin key, the internal secret and the Access service token, not `OCR_CI_EDGE_TOKEN` (`oursharedevents-ci.yml:1511-1516`; the edge token appears only at `:1913` and `:2271`). The sibling page requests accept `403`, and OSE-1377 ("unblock anonymous edge paths (SBFM Skip)") is still In Progress.
- **Request-origin derivations in `src/`:** 15 sites. Three are crawler-facing (the event page share URL, `robots.txt`, `sitemap.xml`) and all three now use the shared origin. The other 12 are not crawler-facing, by route: `/api/` JSON or admin handlers (`handleGetPosterBundle`, `handleAdminGetPosterCodes`, `handleAdminCreatePosterDeployment`, `handleAdminPreEventActivity`, display-config, UEC resolve), `/q/` and `/s/` redirects (QR scan, shortlink), the `/forms/` stale-event redirect (`handleFormPage`), the signed token page, the `noindex` admin preview, and the `.ics` download.
- **Close-guard, run locally on the real inputs:** `node scripts/check-pr-linear-close.mjs` with this PR's branch, title, body and commit messages → "no undeclared auto-close"; self-test 14/14.
- **Full worker suite (rebased tree, before the corrections):** 381 files / 6492 tests, 0 failures. Final head: see Loop 4.
- **CI on the first pushed head (`906cf7fa`), read from the run:** the three `worker-d1-schema` shards, `root-vitest`, `security-iac`, `launch-contracts`, `T0 Gate (lint)`, `(typecheck)`, `(invariants)`, `(a11y)` and `(component)` all passed. `T0 Tests (ui-drift)` was cancelled at 15m02s with **no runner ever assigned** (`runnerName: null`, no failed step), and five other jobs ended at the same 15m02s mark. That is a runner-capacity stall, not a code failure, but it failed the two aggregate gates (`T0 Gate (tests)`, the gate-execution reconciler), which count a missing job as red. The corrections are not on CI yet; pushing them starts a fresh run.

## Loop 1 — Surface (what would break this?) · score 75.5

| #   | Lens                 | Finding                                                                                                                                                                                                                                                                                                    | Sev        | Status                                |
| --- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------- |
| F1  | DevOps / Sr SDET     | **The five Bruno alias requests demand a strict `301`.** T2 runs without the edge token, the sibling page requests tolerate `403`, and OSE-1377 shows staging challenges anonymous paths. A challenged `bru` turns T2 red; a skipped T4 and the production deploy follow (a skipped job is not `success`). | High (10)  | Fixed `10ccffba`                      |
| F2  | Data Scientist / SRE | **`robots.txt` and `sitemap.xml` still derive the host from the request**, so on a non-apex host they would name URLs that disagree with the canonical the pages now declare.                                                                                                                              | Medium (5) | Fixed `10ccffba` (re-rated in Loop 2) |
| F3  | PO                   | **Do sponsor cards belong in search?** The card is `noindex` by design; the old prefix block hid that from crawlers, this change lets them read it. The card stays out of search either way.                                                                                                               | Low (2)    | Open: PO decision (OSE-1625)          |

| Base item                          | State    | Evidence / gap                                                                                                | Deduction |
| ---------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------- | --------- |
| Environmental assumptions verified | Verified | `WORKER_ENV` and routes cited above                                                                           | 0         |
| Full surface mapped                | Partial  | the four pages and the `/sponsor` routes mapped; `robots`/`sitemap` and the other origin sites not yet mapped | 7.5       |
| Partial-fix risk assessed          | Verified | the PR names the sitemap gap; no false closure is claimed                                                     | 0         |
| Chunk scope correctly defined      | Verified | one commit, diff against `main` is only this PR's parts                                                       | 0         |
| Human gate not bypassed            | Verified | the PR was opened on an explicit "Create PR"; no force-push; nothing assumed                                  | 0         |
| **Total deduction**                |          | 7.5 + 10 + 5 + 2                                                                                              | **−24.5** |
| **Score**                          |          |                                                                                                               | **75.5%** |

**Gate:** 75.5 < 95. Stop; correct F1 and F2 (reactive correction), then re-score.

_Sensitivity (strict heuristics):_ F1 is one defect copied into five files, so H4 promotes High → Critical (15) and H3 scales it by log₂(6) = 2.58 → 38.8; F2 spans two surfaces (log₂3 = 1.58 → 7.9). Loop 1 would read 100 − 7.5 − 38.8 − 7.9 − 2 = **43.8**. The decision is the same: stop and correct.

## Loop 2 — Pressure (what did I assume and never verify?) · score 93.0

**Corrections applied 1→2 (`10ccffba`):**

- F1: the alias requests accept `301` or `403` and assert `Location` only on a `301`. A page served with `200` still fails. The script was run offline against five responses (301 with the right `Location`, 403, 200, 301 with the wrong `Location`, 301 with the query dropped): pass, pass, fail, fail, fail as intended.
- F2: `handleRobotsTxt` and `handleSitemapXml` use `canonicalOrigin`. Three new cases in `crawl-policy.spec.ts`, each red against its fault (robots via `www`, sitemap via `www`); a staging host is not rewritten to production.

**Assumptions checked in this loop**

| Assumption                                                         | Result                                                                                                                                                                                                                      |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "`www` reaches the Worker, so the origin pin fixes a live problem" | **False today.** `www` 301s to the apex at the edge (live check). F2 is defense in depth: it matters if that rule is removed or the Worker is reached on another host.                                                      |
| "The other 12 origin sites don't affect crawlers"                  | Verified by route and handler name (evidence above): all under `/api/`, `/q/`, `/s/`, `/forms/`, a token page, an admin preview or a file download.                                                                         |
| "`Disallow: /sponsor$` protects the token page"                    | Not universally: `$` is not honoured by every parser. The portable `/sponsor?` rule protects every URL that carries a token, and a bare `/sponsor` returns the invalid-link page with no data. Accepted, verified harmless. |
| "The new tests would catch a regression"                           | A first run of my own new sitemap test failed on correct code (`not.toContain('www.')` also matches the sitemap's `xmlns`). Green was required before mutation; the assertion was tightened and the red-proofs redone.      |

| #   | Lens        | New finding (×1.25)                                                                                                                                                         | Sev       | Status                |
| --- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | --------------------- |
| F4  | PO / DevOps | **The PR body presented the `www` pin as a live fix.** The edge redirect makes that path unreachable today, which the body did not say.                                     | Low (2.5) | Fixed: PR body edited |
| F5  | BE / Sr QA  | **The canonical tag was spelled in three places** (`lib/canonical`, the inline `/events` code from #828, `buildSearchMeta`), against OSE-1622's own "one helper" criterion. | Low (2.5) | Fixed `25567345`      |
| F3  | PO          | carried from Loop 1                                                                                                                                                         | Low (2)   | Open: PO decision     |

Score before correcting F4 and F5: 100 − 2.5 − 2.5 − 2 = **93.0**. Below 95 → fix both (both actionable, both small), then advance.

_Sensitivity:_ F5 lives in three locations, so H4 promotes Low → Medium and H3 gives log₂(4) = 2 → 5 × 2 × 1.25 = 12.5; Loop 2 would read ≈ 83.5. That is the reason F5 was fixed rather than ticketed.

## Loop 3 — Confirmation (am I rationalizing or verifying?) · score 98.0

**Corrections applied 2→3:**

- F5 (`25567345`): `canonicalLinkTagFor` is the one place the tag is spelled; `/events` goes through `injectCanonical`, `buildSearchMeta` through `canonicalLinkTagFor`. No behaviour change. The specs for every page type pass unchanged (100/100 across the five SEO specs), and corrupting the tag in the helper turns **14** assertions red across `canonical-link.spec.ts` and #828's `seo-canonical-schema.spec.ts`; restored: 29/29.
- F4: the PR body now states the edge redirect and calls the pin defense in depth.

**Would I defend this if it shipped and broke?** The only way the change makes a wrong page appear in search is a wrong canonical, and every page type is asserted to name exactly one address. The only way it exposes something is the robots edit, and the two newly crawlable routes are read-only, rate-limited, `noindex` or static. Yes.

Score: 100 − 2 (F3, a PO decision) = **98.0**. No new finding appeared in this loop, so there is no ×1.5 penalty.

## Loop 4 — Verification of the corrections (evidence, not assertion) · score 98.0

| Check                                                                                                       | Result                                                         |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `tsc --noEmit`                                                                                              | clean                                                          |
| SEO specs (`canonical-link`, `seo-canonical-schema`, `page-aliases`, `crawl-policy`, `admin-draft-preview`) | 100/100                                                        |
| Infra consistency + router source test (root)                                                               | 132 passed, 4 skipped                                          |
| Structural architecture gates (CI's `e2e-smoke` config, 11 files)                                           | 91/91                                                          |
| Close-guard on the real PR inputs                                                                           | passes; self-test 14/14                                        |
| Full worker suite on the final head `25567345`                                                              | 381 files / 6495 tests, 0 failures (exit 0), run on `25567345` |

**Red-proofs, all seen:**

| Fault injected                          | Tests red |
| --------------------------------------- | --------- |
| bare `/sponsor` prefix restored         | 3         |
| `/sponsor$` rule dropped                | 2         |
| production origin read from the request | 2         |
| event-page share URL pin removed        | 1         |
| `/events` canonical pin removed         | 1         |
| `/` canonical removed                   | 2         |
| `/privacy` canonical removed            | 2         |
| robots `Sitemap:` from the request host | 1         |
| sitemap `<loc>` from the request host   | 1         |
| canonical tag corrupted in the helper   | 14        |

## The extended team, lens by lens

| Lens                  | Verdict                            | What it checked                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PO**                | Hold on one decision               | Every audit item in this slice is covered. F3 needs an answer: leave sponsor cards out of search (default) or delete one meta tag.                                                                                                                                                                                                                                                                                                                                      |
| **BE**                | Pass                               | One canonical helper; pure functions; optional parameters keep every existing caller working; origin pinned only for `WORKER_ENV === 'production'`.                                                                                                                                                                                                                                                                                                                     |
| **FD**                | Pass                               | Head tags only. No visible change, no new script, no CSS.                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Sr Design FE**      | Pass                               | No style text added (0 literal style tags in the `pages.ts` diff, the thing the design ratchet trips on). The ratchet ran in `T0 Gate (lint)` on `906cf7fa` and passed; the later commits add no style.                                                                                                                                                                                                                                                                 |
| **Sr QA Automation**  | Pass                               | Every guard seen red. One false-red on my own test was caught by requiring green first. The Bruno requests print their `test()` names in T2; **read a Bruno PASS only if those names appear.**                                                                                                                                                                                                                                                                          |
| **Sr SDET / SRE**     | Pass with a watch item             | F1 closed a path to a red T2 and a skipped production deploy. `robots.txt` caches for 24 h and `sitemap.xml` for 1 h (`crawl-policy.ts` `textHeaders`), so a crawler may keep the old rules for a day after deploy.                                                                                                                                                                                                                                                     |
| **DevOps Mgr**        | Pass                               | No migration, secret, binding or wrangler change. Learned: the `www` → apex redirect is a Cloudflare rule outside the repo; nothing here records it.                                                                                                                                                                                                                                                                                                                    |
| **Dr of Security**    | Pass, no Security Critical finding | Efficacy: the matcher test fails when the prefix returns, so it would catch the over-block; an under-block of the token page fails the 22 blocked-path cases. Gating reality: it runs in the worker shards of the required `T0 Gate (tests)`, so it blocks a merge. Residual: `$` is not universal, mitigated by the portable `/sponsor?` rule (verified above). robots.txt is a request, not access control; the token page is still `noindex`, `no-store` and signed. |
| **Sr Data Scientist** | Pass                               | Crawler reach does not change a count: the card is read-only, `/q/` (scan ingestion, "a fetch is a write") and `/s/` (click counter) stay blocked, and the canonical changes no counting path. The shared origin means sitemap, robots, canonical and share link agree, so attribution to one address holds.                                                                                                                                                            |

## Final synthesis

**Verdict: HELD.** The work is sound at **98%**. It passes once CI is green on `25567345` and the PO answers F3 (merge does not have to wait for F3; the default is safe).

**Holds (convert HELD → PASS):**

- [ ] CI green on `25567345` after the push, including `T0 Tests (ui-drift)` (never ran on the first head), `T0 Gate (tests)`, the gate-execution reconciler, S0, the phone audit, CodeQL and close-guard.
- [ ] PO: sponsor cards in search, yes or no (F3).

**Post-merge verification**

- [ ] T2: the alias requests' `test()` names print in the run; a 301 or a 403 passes, never a 200.
- [ ] After the first production deploy (OSE-1511): `https://oursharedevents.com/robots.txt` returns 200 `text/plain` and contains `Disallow: /sponsor?` and `Disallow: /sponsor$` and no bare `Disallow: /sponsor` line; `/sitemap.xml` returns 200 and names only the apex; `/sponsors/<id>` returns 200 with `noindex`; `/sponsor?t=x` returns the invalid-link page.
- [ ] Canonical on `/`, `/privacy`, `/events` and one event page, read from the live HTML.
- [ ] Rich Results Test and Search Console URL Inspection on one live event (belongs to OSE-1624; cannot run in CI).

**Follow-ups (not deductions)**

- Record the `www` → apex redirect rule in the runbook, so removing it is a known act.
- If sponsor cards should be searchable: delete the card's `noindex`, then give it a canonical and a description.
- Whether `/home`, `/welcome`, `/landing`, `/about`, `/info` and `/privacy-policy` should 301 like the events aliases (they now name their canonical instead).

**Commit sequence**

1. `906cf7fa`: canonicals for `/` and `/privacy`, one production host, the sponsor robots rule, tests.
2. `10ccffba`: robots and sitemap name the canonical host; Bruno aliases tolerate an edge challenge.
3. `25567345`: one helper spells the canonical tag.

**Review gates**

- `crawl-policy.ts` and the robots rules: a reviewer with security authority.
- `pages.ts` and `lib/canonical.ts`: BE review.
- Bruno alias requests: confirm LF endings in the index (`tests/integration/infra-consistency.test.js` enforces it).

## Honest limits

- **Nothing here was seen by a real crawler.** Google and Bing behaviour for `$` and for the canonical is from their published rules, not from Search Console.
- **T2 against staging has not run.** The edge-challenge finding (F1) is evidence-based risk, not an observed failure; the fix removes the dependency either way.
- **CI on the final head has not run.** The first head's run was partly lost to a runner stall (above); the corrections need a clean run, in particular `ui-drift` and the two aggregate gates. Until then the T0 and CodeQL lines are expectations, with the first head's passing jobs as the evidence.
- **The 98 is a flat-weight score** (repo convention). Under strict heuristics the Loop 1 and Loop 2 numbers are far lower (43.8 and ≈83.5); Loop 3 and 4 are unaffected, because the findings that triggered the penalties are fixed.
