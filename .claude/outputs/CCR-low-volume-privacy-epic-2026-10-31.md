# CCR worksheet: Epic OSE-1766 (low-volume privacy and click integrity), loop 1

Date: 2026-10-31. Lead: Claude (Sonnet 5.5). Protocol: `.claude/skills/ccr-protocol.md` v3 core. Loop 1 of 5+ (classified as an architecture change touching the privacy surface). Loops are not run in parallel; this is the surface pass only.

## Verdict

| Item | Result |
|---|---|
| **System score** (the story set) | **0%** (Security Critical floor; raw arithmetic below is 100 − 181, clamped) |
| **Assessment confidence** (how sure the findings are real) | **80%**. Ten lenses converged on the same defects, and the lead re-read six claims in code. Every finding is source-read; none is proven at runtime. |
| Direction | Baseline (first loop) |
| Gate | **STOP. Human gate.** Below 95%, and a Security Critical is unresolved. No loop 2 until the owner answers the questions at the end. |
| What this score is not | Not permission to build or to skip building. It is a signal about the story set as drafted, not about the code on `main`. |

## What was reviewed

**In scope:** the epic and slices 1 to 13 (OSE-1766; slices 1 to 10 = OSE-1767 to OSE-1776; slices 11 to 13 = OSE-1777 to OSE-1779) as written in `.claude/outputs/STORY-DRAFT-low-volume-privacy-and-click-integrity-2026-10-30.md`, and the code and config the draft cites under `workers/oursharedevents/`, `wrangler.toml`, the CI workflow, and the memo `docs/security/SCAN_TIME_BUCKETING_DISCLOSURE_MODEL.md`.

**Out of scope:** the Worker code on `main` as a product (only where a slice relies on it); OurWKRP; Linear ticket bodies (no Linear access for the role agents); runtime or staging behaviour; the OCR-docs files beyond what the draft cites.

**Team (extended scrum team, one lens each, read-only, run in parallel then merged once):** Dr of Security, Lead Backend Architect, Lead FE Integration, Sr Design FE, Sr Automation QA, Sr SDET/SRE, DevOps Mgr, Sr Data Scientist, Product Owner, Scrum Master. Each listed the commands it ran. After the run the main checkout's `git status` matched the pre-run baseline (8 untracked files, none modified).

## Loop 1

**Critical (most dangerous assumption).** The draft assumes slices 1, 3 and 11 do what their titles say. Three independent lenses found each of them either does not close the attack, undercounts real crowds, or breaks a sold metric. The most dangerous single assumption: "one person cannot clear the floor" after slice 1. `getOrCreateAnonId` accepts any `anon_[A-Za-z0-9_-]+` value (`src/lib/anonymous-id.ts:36`, re-read by the lead), so a forged cookie per request counts as a new person each time. The draft scopes cookie signing (OSE-1496) and the hostile organizer out, but invariant 2 says the floor holds against the brand's own admin.

**Conservative (worst case, does the floor hold?).** It does not. An injector who sends five requests with five forged cookies (or five `/s` taps; `/s` has no dedup) publishes a cell, and every real scan after that reads exactly as 5 plus the real scans. Slice 3's hold-and-margin does not change that: the release poll shows the exact count within the 30 s window. Separately, the proposed fix for cookie-less requests (dedup by IP) collapses a whole venue's Wi-Fi to one person and pushes real events below the floor.

**Recursive (score).** First scoring; no earlier loop to compare. 0% system score, 80% confidence.

## Findings register

Weights: Security Critical 15 (floors the system score at 0), Critical 15, High 10, Medium 5, Low 2. Loop-position modifier ×1.0 (loop 1). Breadth, correlation and environment modifiers were **not** applied; applying them would only lower the score further.

| # | Sev | Slices | Finding | Evidence | Basis | Raised by |
|---|---|---|---|---|---|---|
| 1 | **Security Critical** | 1, 3 | The floor is seedable. Forged cookies are accepted, so slice 1's criteria can pass while one person pads a count past 5. The residual risk (padding by an outsider, or by an organizer or sponsor) is not written down. | `anonymous-id.ts:36` (lead re-read); `qr-scan.ts:168-187`; draft scope lines | source-read, verified | Dr of Security, Data Scientist, Backend |
| 2 | Critical | 1 | Dedup by IP undercounts crowds. Every first scan arrives with no cookie; venue Wi-Fi or carrier NAT collapses to one person per hour, and the `/s` header promises the opposite. Real events read "Held". | `qr-scan.ts:168`; `public-read-limit.ts:86,179-203`; `shortlink-resolve.ts:23` | source-read | Dr, FE, Backend, SDET, QA |
| 3 | Critical | 11 | Slice 11's premises are wrong. It kills `return_rate` (venue and corridor), the corridor baseline windows, the BigQuery returns export and the "Return Rate" card, and the suppression text becomes false. "Old rows stay unlinkable" is false: `snk1_` is plaintext and identical across events until the 365-day sweep, and re-keying needs a Worker backfill (HMAC), not a SQL migration. | `report-depth.ts:63,80`; `shared-report-builder.ts:349-467`; `shared-report-export.ts:481-499`; `scan-node-key.ts:11-21,97-108` | source-read | FE, Data Scientist, Backend, Dr, PO |
| 4 | High | 3 | Slice 3 as written does not work. Sticky suppression plus a margin only moves the leak (a release at 8 is exact within the 30 s poll). The real control is R4 (sealed hours, D2). Six readers consume the open hour, `/s` taps have no hour cell to seal, the "live" copy becomes false, and only a jsdom mock tests the live view. | `live-monitor.ts:31,73`; `scan-cells.ts:48-63`; six readers; `shortlinks.ts:362` | source-read | Dr, DS, FE, Design |
| 5 | High | 2, 1 | The `/q` dedup KV key pairs the browser key with the poster placement in plaintext for an hour, and holds the **raw cookie value** when the pepper is missing (staging only warns). The staging dead-letter queue keeps whole messages with `anon_id` and `deployment_id`. This is the who-and-where pairing the split exists to prevent, held outside the tables. | `qr-scan.ts:179`; `scan-buffer.ts:72-74` (lead re-read); `wrangler.toml:221` | source-read, verified | Dr, Backend |
| 6 | High | 1, 5 | The `/q` KV `get` and `put` have no try/catch, so a KV error returns a 500 to someone scanning a poster. The draft's "fail open when KV is down" is true for beacons, false for `/q`. Slice 1 adds more KV calls to this path. | `qr-scan.ts:178-187` (lead re-read); `index.ts:58-77` | source-read, verified | SDET |
| 7 | High | 5 | Slice 5's premise is overstated and its fix is unsafe. Minting is idempotent per (event, kind), bounded at two rows, with a non-unique-index race; the real gap is the missing read limit. Removing mint-on-GET orphans typed-slot codes for events with no saved poster codes. The poster page calls the bundle on load, so a new limit sends a real visitor a 429 with no page for it. The cited `router.ts` lines have drifted. | `poster-bundle.ts:273-287`; `shortlinks.ts:164-191`; `router.ts:1847-1851`; `poster.html:1220` | source-read | PO, Backend, Dr, Design |
| 8 | High | 2, 11 | Migration risk. The database migrates before the Worker deploys; migrations are forward-only; queue messages are in flight; slices 2 and 11 both rewrite the same two tables and each bumps the single `REQUIRED_DB_MIGRATION`. The index from 0101 must be recreated exactly or dedup silently disappears. | `oursharedevents-ci.yml:1275,1374`; `ROLLBACK.md:74`; `schema-guard.ts:28`; `0101` | source-read | DevOps, Backend, Scrum Master |
| 9 | High | 7, 1, 10 | Staging proof can pass vacuously. A missing pepper only warns on staging; T4g accepts 403 and has no `OCR_CI_EDGE_TOKEN`; `flow-shortlink-resolver` sits outside the smoke config's `testDir` and sends no CI headers; Bruno T2 has no zero-check floor; a new WAF rule would 429 CI. | `ci.yml:1266,2348-2362,1621-1626`; `playwright.e2e-smoke.config.ts:21`; `launch-story-smoke.spec.ts:261-264` | source-read | DevOps, QA, SDET, FE |
| 10 | High | 3-13 | Only slices 1 and 2 have acceptance criteria. None of the 13 has the CI/CD testing ticket AGENTS.md requires before Done. Existing specs scan with no cookie and no User-Agent and expect counted rows, so slice 1's born-red test is confounded. A staging "dedup adds one click" cannot be read through a floored surface. | draft lines 75-88; `shortlinks.spec.ts:433-456`; `scan-to-export-trace.spec.ts:286` | source-read | QA, Scrum Master |
| 11 | High | 6, 12 | Slice 6 has no data. Invalid-traffic reasons are never persisted, so a share needs a new counter and migration; a published rate can be reconstructed to its numerator and denominator; the new sponsor-facing element has no wording, test id or accessibility criteria; it is a new feature, not a gap fix; and `sponsor_displays.created_at` is second-precision, which collides with slice 12. | `sponsors.ts:1535`; `invalid-traffic.ts:38-43`; `migrations/0102:42` | source-read | SDET, DS, FE, Design, Backend, PO |
| 12 | High | 8 | Slice 8 reintroduces cross-grain differencing (a day cell of 10 minus a published hour of 6 leaves 4), contradicts the documented "count of people", and R1 is unratified. It is a feature. | `count-floor.ts:44-52`; `scan-cells.ts:16-20`; `QR-AND-SHORTLINKS.md:138-148` | source-read | DS, Design, PO |
| 13 | Medium | 1, 3, 11, 13 | Decisions D1 to D6 have no owner or date, and the slice text presumes answers: slice 1's criteria assume D1; slice 11 assumes D6 option 1; slice 13 "ratifies" R1 to R4, which is an owner decision. | draft lines 46-53, 69, 77-82 | source-read | PO, Scrum Master |
| 14 | Medium | 4 | Slice 4's audit rows would get `brand_id` NULL and be invisible to brand admins (`AUDIT_BRAND_RESOLVE_SQL` has no deployment or shortlink branch). The structural check "an audit call appears in the source" can be dodged. No `_audit` exists on deployment create, update or delete, or on short-link POST. | `audit-log.ts:43-54,94-102`; `router.ts:1337,1431-1434,1359-1364`; `poster-codes.ts:312` | source-read | Backend, Dr, QA |
| 15 | Medium | 12 | Slice 12's allowlist is the real work: 51 `datetime('now')`, `strftime`, `CURRENT_TIMESTAMP` or `unixepoch` hits in 24 `src/` files (lead's count; the Scrum Master's narrower pattern found 41 in 23). "Scan or identity table" is undefined, and the pattern misses `CURRENT_TIMESTAMP`, `unixepoch()` and double-quoted forms. | lead grep over `src/` | source-read, verified | SM, QA, FE |
| 16 | Medium | 2 | Row-order link is plausible, not proven. D1 Time Travel (about 30 days) keeps the old state, so "existing rows unreadable as an ordered pair" fails while it holds. `WITHOUT ROWID` needs a copy, drop and rename. The spike must cover the queue path and the direct path. | `0062:11-37`; `scan-buffer.ts:105-136,158,179` | source-read, Time Travel inferred | Dr, Backend |
| 17 | Medium | 1, 2, 3, 11 | The queue is bound on staging and unbound in production, so the write path differs per environment and no slice names which it covers. A pepper rotation resets the scan key, the distinct counts and dedup, with a manual purge. Stale lines remain (`QR-AND-SHORTLINKS.md:422`, `DISASTER-RECOVERY.md:206`; retention is set in every environment). | `wrangler.toml:209-221,362-379,121,245,398`; `env-parity.mjs:24,64-74` | source-read | DevOps |
| 18 | Medium | 1, 3, 6, 8, 11 | Wording. Withheld reads three ways ("Held" in a tooltip, "Fewer than 5", "Hidden to keep things anonymous"). New states (open hour, sticky-withheld, merged grain, returns) have no string. The event page says a link "counted as a single click". `click_outs` is rendered by no page, so a "count dropped" note has no slot. | `live-monitor.ts:124-125`; `pages.ts:496-501`; `shared-report.html:1092`; `never-who.ts:53` | source-read | Design, FE |
| 19 | Medium | 2, 3, 6, 8, 11 | Process and sizing. Slice 12 was started in its own session before any CCR (the session is now on Opus, with no commits yet). Slices 2, 3, 6, 8 and 11 are epics in a row. The dependency order is unwritten. | worktree `time-precision-gate-5dab95` at `main`, no commits | runtime (git) | Scrum Master |
| 20 | Medium | all | The draft has errors of its own. Its header says "Nothing here is filed" (corrected today). "All fail open" is wrong for `/q`. "5 of 13 stale ledger refs" is unreproduced (one stale ref confirmed of nine checked). Principle 1 ("no new per-visitor value") is contradicted by dedup markers. | draft lines 3, 22-23, 32 | source-read | SM, SDET, QA |
| 21 | Low | all | No alert exists for "a control stopped working"; KV fail-open on the public limiter and invalid-traffic filter is silent. | `public-read-limit.ts:145-150`; `invalid-traffic.ts:230-245` | source-read | SDET |
| 22 | Low | 7, 10, 13 | Slice 7 is the testing ticket for slices 1 to 6 and should depend on them; slice 10 is owner config with no Done evidence rule; slice 13 is another repo, so the close-guard and staging chain do not apply. | draft slices table | source-read | SM |
| 23 | Low | none | `/e /p /r /c` share opens have the same inflation and are in no slice. | `router.ts:642` | source-read | Backend |

**Arithmetic (base weights):** 1 Security Critical (15) + 2 Critical (30) + 9 High (90) + 8 Medium (40) + 3 Low (6) = 181. Raw `100 − 181` clamps to 0. The Security Critical floor sets the system score to 0% regardless.

### Corrections to my own earlier statements

- Invariant 3's "no `CF-IP*`" covers device geolocation headers only; gate 8b permits `CF-Connecting-IP` (`poster-deployments-h3-tagging.spec.ts:503-510`). Slice 1 does not break that gate. It does break the draft's own principle of storing no new per-visitor value.
- "These controls all fail open when KV is down" is wrong for `/q` (finding 6).
- "Slice 5: the public GET mints rows" is overstated (finding 7).
- "Old rows stay unlinkable" after slice 11 is false (finding 3).
- "The corridor latch is the precedent" for slice 3 is wrong: it counts events, and its 24 hours is an organizer undo grace, not a disclosure control.
- "5 of 13 relevant threat-ledger refs are stale" is unverified.

## What must be true before shipping any slice

1. A decision on padding: either write it down as an accepted residual risk with an owner, or bring cookie signing (OSE-1496) into scope. Slice 1 cannot be called a floor control without one.
2. D1, D2 and D6 answered, and slice text rewritten so it does not presume them.
3. Slice 1 split: a `/q` link-preview robot rule plus KV try/catch (independent, small); `/s` dedup only after D1; the cookie-less IP dedup dropped.
4. Slice 3 replaced by R4 (sealed hours, D2) or dropped. Sticky suppression and the margin removed.
5. Slice 11 reduced to a reader-inventory spike until D6 and the product call on `return_rate` are made. Any new key uses a new HKDF context and a test that it differs from the forms key.
6. Slice 5 cut to "add a read limit, with a visitor-facing 429 page"; minting moves only after that.
7. New work item: the dedup KV key (hash it or drop the raw-cookie fallback) and the staging dead-letter queue retention.
8. Acceptance criteria and a CI/CD testing ticket for every slice built; slice 7 rewritten (T4g token, spec location, Bruno floor).
9. Slice 12 allowlist and pattern list specified (finding 15) before its PR is trusted.

**Suggested sequence (Scrum Master and Backend, merged):** decisions D1, D2, D6; slice 12 and 10 early (independent); slice 1a; slice 2 spike; slice 11 reader spike; slice 5 in two steps; slice 4 after the brand-resolve change; slice 7 per slice; slices 6 and 8 deferred.

## Verification after shipping

Per slice: the born-red evidence on an injected fault; a mock-layer and a staging test; a named CI job that goes red on regression; staging chain green for the merge SHA before Done (AGENTS.md two-stage rule). Re-read each role's "not checked" list before loop 2.

## Risks accepted

### RA-1: known-target probe on a small poster-hour (accepted 2026-10-31)

- **Accepted by:** the owner (Matthew Zdano, PO), in chat, 2026-10-31, in answer to gate question 7. This entry is the written record.
- **The risk.** Someone who can send scans to a poster adds 4 fake scans to a poster-hour and learns, from whether the figure reaches 5, whether at least one real scan occurred there (once the hour is sealed, if D2 chooses sealed hours; within about 30 s today). This is the standard injection attack on a count floor. It reveals "one or more real scans in that poster-hour", not who scanned, and not a second-level count above the floor.
- **Accepted only on these conditions** (each is work still to be built; until it is, the risk is larger than described here):
  1. Cookie signing is in place (OSE-1496), so a client cannot choose or guess an id.
  2. The per-poster-hour cap is in place with an atomic counter (the owner's 2026-10-31 choice), so inflation by anyone is bounded.
  3. The floor stays at K=5 and withheld counts keep reading in words, never 0 (invariants 2 and 8).
  4. Nothing in this acceptance relaxes never-who: no identity, no cross-event link and no per-visitor value is accepted as a consequence.
- **Public wording must follow.** The memo's claim "you are one of at least 5 people who are indistinguishable within it" is false when scans are injected. It must read "at least 5 counted scans" (or equivalent) and must not say identification is impossible. Carry this into the wording work (slice 13 and the honest-claim text); it is not changed yet.
- **Review triggers (re-open the acceptance if any occurs):** before `PRODUCTION_LIVE` is ever set by the owner; any observed probing or padding; any change to K, the time grain or the sealed-hour rule; reopening D5 (noise); onboarding a client whose event is small enough that one real scan is sensitive; the next CCR loop on this epic.
- **Evidence limits:** the attack and its cost are source-read, not demonstrated at runtime on staging.
- **Effect on the score:** none yet. Finding 1 stays registered. How the protocol scores a Security Critical that carries an owner acceptance is to be settled in loop 2; the 0% above has not been changed.

## Human-gate answers received

- **Q1, padding (2026-10-31): bring cookie signing in.** OSE-1496 is now a prerequisite of the epic; slice 1 (OSE-1767) is blocked by it; comments were added on OSE-1766 and OSE-1496. Not reparented. **Caveat recorded:** signing stops a client choosing or guessing an id, but a client that sends no cookie gets a fresh signed id each time, so finding 1 is only closed together with a per-client bound on `/q` and `/s`, which in turn undercounts crowds behind one address (finding 2). That trade-off is an open owner question, not resolved by this decision. Finding 1 stays unresolved until it is answered and built.

- **Cookie-less bound (2026-10-31): per-poster-hour cap.** Recorded on OSE-1496 and OSE-1767. A cap bounds inflation by anyone (outsider, sponsor, organizer) but does **not** stop the known-target probe: the probe needs K-1 = 4 fake scans and any cap of 5 or more admits them; a cap below the floor would withhold real crowds. It also undercounts a real crowd above the cap (figure needs "N or more" wording and a rule for N), and needs an atomic counter (the KV get-then-put is non-atomic). **Finding 1 therefore remains open as the probe**, and needs a further owner decision (below, question 7).

## Human-gate questions

7. ~~**Probe residual.** After signing, the per-poster-hour cap and sealed hours (R4, if D2 chooses it), a known-target probe still works. Accept it as a written residual risk with an owner, or reopen noise (D5)?~~ Answered 2026-10-31: accept, write it down. Recorded as RA-1 under "Risks accepted"; D5 stays parked.

1. ~~**Padding.** Accept it as a written residual risk, or bring cookie signing (OSE-1496) into this epic?~~ Answered: bring signing in (see above).
2. **D1.** Does a published tap count mean people or taps? (Decides slice 1's `/s` half.)
3. **D2.** Show sealed hours only (R4, the live view then lags by up to an hour), or keep the live view and accept that the crossing is visible?
4. **D6 and `return_rate`.** Is the cross-event `return_rate` a sold feature that must survive? If yes, option 1 is off the table.
5. **Slices 6 and 8.** Defer both as features, not gap fixes?
6. **Slice 12.** Let the running session continue with the wider pattern list and an explicit allowlist, or pause it until loop 2?

Information that would close these: the owner's answers above; a runtime read of staging for `/q` and `/s` under padding; the Linear bodies (not read by the role agents).

Loop and layer where each gap appeared: all in loop 1; findings 1 to 3 at the Critical layer; the floor failure at the Conservative layer.
