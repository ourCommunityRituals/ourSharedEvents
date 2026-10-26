# Launch: consolidated waves (stg · prod · BigQuery)

Single source of record, 2026-10-03 ~02:30Z. Built from every session report pasted into this thread, plus a live re-read of prod and staging and Linear (OSE-1477 SEC children, OSE-1444 AUD children, OSE-1491, OSE-1377, OSE-1447, OSE-1490, OSE-1504, OSE-1507, OSE-1508).
**You** = PO / dashboard / secrets (separate terminal). **Claude** = code + evidence.

## Live state (re-read)

| Thing               | State                                                                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Staging             | deployed `1b375d7` (#761), but **main is red**: T2 Bruno failed (stale `updated_at` ordering check, fix #762), so T3/T4 skipped. #761 not Done until a green run |
| Production          | Worker live, `db: ok`, **old build** (`version: "main"`, `_debug`). `/admin` 401 with no Access login. `CF_ACCESS_AUD = ""` on both envs                         |
| Anonymous paths     | `/events`, `/api/v2/events`, `/q/*` reach the Worker on both hosts from a residential IP (no edge challenge)                                                     |
| Red-team            | T5 green on `61f72c1`; **red** on the next run (RL-002, known limiter flake OSE-1509), so T6 correctly skipped. T6 still **unproven** on the new layout          |
| `OCR_CI_EDGE_TOKEN` | set 2026-10-02 18:33Z, so T4 is green (OSE-1490 effectively met)                                                                                                 |
| Open PRs            | #762 (Bruno ordering check, makes main green again)                                                                                                              |

---

## Wave 0: now, nothing blocks these (You, ~30 min, any order)

- [ ] **Linear moves to Done** (staging chain green): OSE-1512 (#760), OSE-1432, OSE-1434. OSE-1490: add the token's expiry to the inventory, then Done (unblocks OSE-1511).
- [ ] **Tick OSE-1416's checklist** (steps 1–2 are done; only the comments say so).
- [ ] **Staging Access app**: add the 5 missing path groups (dashboard, create, briefing, overview, summary). OSE-1510. Until then the canary's staging row is red.
- [ ] **ourWKRP**: `CLOUDFLARE_API_TOKEN` in Doppler `stg` (project ourwkrp). OW main is red until then.
- [ ] **`OCR_PROPAGATE_TOKEN`**: Contents: write on ourSharedEvents. The Conformance Report is red on every main run until then.
- [ ] **#750 setup**: add `CLAUDE_CODE_OAUTH_TOKEN`; turn off Copilot's automatic review.
- [ ] **WAF**: delete "Allow staging test agents" (`ip.src eq 192.168.86.21`, can never match).
- [ ] **2FA + recovery on every owner account** (GitHub, Cloudflare, Google, Linear, registrar, Doppler). OSE-1478, Urgent, also on the go/no-go list.

## Wave 1: production comes up (You, in order; each step needs the one before)

1. [ ] **Production Access app**, all **8** admin path groups (OSE-1353; `RUNBOOK-DEPLOYMENT.md` §Cloudflare Access App). Verify: `/admin` shows the Access login.
2. [ ] **Give Claude the app's AUD tag** (not a secret) → **Claude opens the AUD-pin PR** (`CF_ACCESS_AUD` in `[env.production.vars]`, and staging's tag too). OSE-1377 finding #2. The email allowlist retirement comes **after** this, never before.
3. [ ] **Production secrets** (`bash scripts/set-secrets.sh production`, incl. `FORMS_HASH_PEPPER`). Confirm `ALLOW_OCR_INTERNAL` / Bearer fallback are off in prod (OSE-1511, OSE-1491 item 3).
4. [ ] **BigQuery for production, before its first 03:00 UTC run**: create `oureventring_general` → `scripts/bq-create-pool-tables.sh` for all **four** tables → GRANT the dataset to production's Worker identity **only** (runbook §Create the BigQuery pool tables). Check whether the Worker identity needs the GCP service account from OSE-61 (INFRA-3).
5. [ ] **Deploy production** (tag or `deploy_production=PRODUCTION`). Verify `/health` → `prod-<sha>-<date>`, no `_debug`; `/sponsor-default-logo.svg` → 200; canary prod row green.
6. [ ] **Two membership rows** (runbook §One-Time Data Steps): founder brand membership (OSE-1415) **and** founder `ose-platform` membership (OSE-1447 Phase A; also needed on **staging**).
7. [ ] **`PRODUCTION_LIVE=true`** → security monitoring covers prod (OSE-1418).

## Wave 2: security go/no-go before Bocce is public (OSE-1491 → OSE-1251)

OSE-1491 is the security section of OSE-1251 and stays NO-GO until each item is Done or has a signed waiver. **Claude** collects evidence into one comment; **You** sign "security GO".

- [ ] OSE-1467: rotate possibly exposed CI credentials (Urgent, In Progress).
- [ ] OSE-1480: Cloudflare API tokens at least privilege; retire the Global API Key.
- [ ] OSE-1488: AI agent / MCP credentials inventoried and reduced (Urgent).
- [ ] OSE-1484: alerting + on-call; one test alert received from production.
- [ ] OSE-1483: backups + **restore drill**. Fix **OSE-1503** first: the DR and rollback runbooks delete production databases and restore erased PII. Do not run them as written.
- [ ] OSE-1466: credential-isolation red-team tests green (T5 now green; T6 runs after #761).
- [ ] **Urgent privacy items not on the list. Decide fix or waiver**:
  - OSE-1496: `ose_anon` cookie is forgeable and `/q/` has no rate limit, so fake scans can probe whether someone scanned.
  - OSE-1493: raw anonymous id stored next to named form data. A waiver holds only if forms stay **off** in production (lean launch scope); confirm that.
- [ ] Founder "security GO" comment on OSE-1491, then OSE-1251 sign-off.

## Wave 3: Bocce on production (You, founder-operated)

- [ ] **OSE-1456 holds: no Bocce organizer gets `/admin`.** The founder configures the event. Organizer access waits for the platform/role holes (AUD epic OSE-1444) to close.
- [ ] Use the draft page / poster / TV previews before publishing (#754).
- [ ] After Publish the event is off `/events`, the map and sponsor discovery for 10 minutes (`PUBLISH_GRACE_MINUTES`). The direct link and a test scan work at once.

## Wave 4: staging hygiene + BigQuery (Claude, can run alongside Waves 1–3)

- [ ] Merge #762 → main green again (T1–T4) → #761 meets Done.
- [ ] First T5 run that passes RL-001/RL-002: confirm T6 + post-T6 **run** (job logs + test counts). Until OSE-1509 lands, the limiter flake can keep T6 from running; with OSE-1506 (nightly), retries are cheap.
- [ ] OSE-1507 last item: run the ~24 never-run `poster-print.data` tests against staging once, then enable them permanently.
- [ ] OSE-1508 last item: write the unpublish lag (TV 5 min; guest JSON up to 60 s + 300 s SWR) into admin help or the runbook.
- [ ] Staging BigQuery: tonight proves `events_backup`. The returns export skips until ~2026-10-09 unless **You** OK resetting the staging claim row.
- [ ] Open tickets (on your OK): Vertex AI access is pool-wide (cross-env); the legacy flat backup path is dead code; add the prod BigQuery dataset to OSE-1251.

## Wave 5: code queue after launch (Claude, one PR each, in order)

1. ourWKRP: `captureGitInfo` off + port the artifact scanner (OW handles identities; no guard today).
2. OSE: scan the PR mobile-audit Playwright upload + a test that every report upload is scanned.
3. `persist-credentials: false` in the 6 sibling repos + OCR-docs `brain-location-audit.yml`.
4. Guard R3 remainder: unfiltered push, comment-triggered PR checkout, `merge_group`, default-token writes.
5. OSE-1377 remainder: retire the email allowlist (after the AUD pin is live); replace the `[200,403]` test tolerance with a challenge discriminator.
6. OSE-1436 sponsor staging seed (publish the seed event; phone + email on sponsor "B") + real-browser staging checks (phone screenshots, print, broken-logo swap); then OSE-1431, then OSE-1435 (hub change first).
7. OSE-1514 a11y, OSE-1515 wizard fixes.
8. UI-components package (the other session's branch has an **unpushed** local merge `57201056`): CI workflow → first real use = admin Undo `toast()` → README points at `npm run worktree:link-deps`.
9. Rate limits: OSE-1504 (admin geocode per-actor; admin limiter in staging too) under OSE-1098's plan with OSE-1509; OSE-1498 venue-image proxy.
10. OSE-1492: signed sponsor/report links written to Workers Logs (High, In Progress).
11. Governance doc fixes (your review): ADR-020 reviewer `@mzdano` → `bereasonable13`; OCR-docs `CLAUDE.md:90` CODEOWNERS claim; CLAUDE.md §3 role states for #745–#761; CLAUDE.md OSE-1416 note ("only `oursharedevents_backup`"); OSE-1402 (OSE-1080 drift); CCR worksheet refresh.
12. Low: 3 Windows-only local test failures (scanner path assertion, 2 in `production-read-only.test.js`).

## Decisions waiting on you (unblock Waves 2 and 5)

- OSE-1506: red-team nightly on its own schedule.
- OSE-1496 / OSE-1493: fix before launch, or waiver (see Wave 2).
- OSE-1513: sponsor strip below title/date.
- R18: OCR-docs runs PR code on the self-hosted Windows runner.
- D1–D9 (D1 = separate GitHub identity for agents).
- OSE-1352: `ose_anon` cookie Max-Age (1 year today).
