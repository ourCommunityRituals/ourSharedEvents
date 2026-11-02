# Loop 2 (Conservative): Dr of Security, frozen v4 (sha256 dd9b8522 matches)

Saved by the lead from the agent's hand-back message (the agent's own rules forbade it writing to disk). Code: `ose-clock-gate` at e7c8297b (main 39a63d67 plus test commits). Paths are under `workers/oursharedevents/` unless they start with `.github/`. Nothing was run at runtime.

Summary: no Medium becomes a floor or never-who break through the retained slices alone, so there is no Critical in this scope. R1-08's worst case: with a short `RATE_LIMIT_KEY_PEPPER` (the deploy gates check names only), one honest visitor can lift a poster-hour to a published 5; the floor holds as written but no longer means 5 people. R1-01 and R1-10's worst case: someone who can list KV can already, on main, tie a keyed browser to a poster and a second; with FORMS_DB and its key as well, at low volume, the platform operator can put a name on that browser's trail across events. One new finding (L2-SEC-1, Medium). One re-rate (R1-23 to High).

## 1. Worst case for each High in my lens

**R1-01: stores and logs outside the scan tables. Floor holds: yes (insider only). Never-who holds: no for the operator. The criterion catches it: no.**

- **KV lister alone, today:** the marker name is `scan:dedup:snk1_…:<deployment>:<hour>` (`scan-buffer.ts:72-74`) with `expirationTtl: 3600` (`qr-scan.ts:185`). Anyone who can list KV gets who, where and the second without touching D1 (if the KV listing returns expiry, which is inferred).
- **After S2 hashes the name:** the operator holds `RATE_LIMIT_KEY_PEPPER`. The inputs to the hash are few (that hour's `snk1` values times the posters), so trying them all reverses it. S2's threat review says a KV holder cannot read the triple without the pepper. That is true but no protection against the person who holds the pepper.
- **Short pepper:** the `/q` caller bucket is an unpeppered SHA-256 of `publicread:qr-scan:<IP>` (`public-read-limit.ts:83-87`, `rate-limit.ts:122-132`). That reverses to an IPv4 address in 2^32 tries, and its `resetAt` is stored in milliseconds.
- **Joining to a name:** `form_registrations` stores `source_placement_id` and `consent_given_at` to the millisecond beside the encrypted name and email (`forms.ts:302-316`). At low volume, poster plus hour joins a registrant to the `snk1` found by row order, and `snk1` is the same at every event (ADR-001:52). S7 does not break this join, because the hour is enough.
- The register's line "does not by itself identify a person" is false when the same holder also has FORMS_DB and its key. This all exists on main and the slices do not create it, so it stays High. Correct that line.

**R1-07: S2's staging check proves a scan, not a marker. Floor holds: in letter only. The criterion catches it: no.** If a short pepper sends S2 down AC3's no-marker path, m1 to m4 stay green (the test env has a long pepper). The staging step checks only that no readable key appears, so it passes. No alert reads any log line. Repeat scans are counted and nothing goes red.

**R1-08: S2's silent no-marker path. Floor holds: in letter, not in meaning. The criterion catches it: no.**

- **Is a short pepper reachable?** Both deploy gates match names with `grep -q`, and the length is checked only by `set-secrets.sh` (`ci.yml:1255-1262`, `:2662-2670`). A `wrangler secret put` run directly skips that check.
- **What limits one person?** After S2 nothing per poster-hour: the caller limit is 60 per 10 s at the edge and 360 per minute in KV.
- **Result:** one person scanning 5 times publishes "5". The floor's premise, "a poster-hour of >= K scans is >= K people" (`shared-report.ts:865-867`), fails with no attacker at all.
- **What is logged:** `ANON_ID_HASH_PEPPER_MISSING` once per isolate (`qr-scan.ts:43-52`). Nothing for the AC3 path.
- **KV down:** the unwrapped `get` throws, the visitor gets a 500 and the scan is lost. That fails closed and belongs to the moved-out `/q` robustness story.

**R1-10: row order as a correlation key. Can one holder of D1 and KV time and place a browser to the second? Yes, before and after S2.** Row order of each hour's placement rows lines up with the sorted marker expiry times for that hour. That pairs each `snk1`, poster and second, approximately on the direct path. Dead letters (staging) pair them directly. Cloudflare Queues messages also carry a send `timestamp`, which is inferred, so that part of R1-01 is in milliseconds, not hours. S6 as written produces no fix.

**S4 under a queue backlog and the 03:00 cron (R1-16):** Production has no queue, so a cell cannot change after it seals. On staging a late row, or a stored cell built at 03:00 before its rows arrived, moves a cell after the seal. Two sealed figures for the same group can then differ by an exact number below 5. That reaches the public only if production gets the queue (env-parity UNDECIDED). It stays Medium.

**S3 under platform logs:** the invocation record carries `/q/<token>` and its time no matter which console fields S3 removes (F-15). It falls under R1-01 and no S3 criterion can see it.

**S15 read by a hostile organizer:** they learn the probe recipe, understated (R1-11), and the walk-in label (R1-04). No new break.

## 2. NEW findings

| id       | sev    | slice | claim                                                                                                                    | evidence                                                                                                                                                                                                                                                                                        | basis                   | root cause                          | not in R1 because                                                                                                                                             |
| -------- | ------ | ----- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L2-SEC-1 | Medium | S2    | The rotation, transition and rollback effect is "at most one extra per person per poster", and it is treated as harmless | C.8 "KV transition and rollback", Docs rotation text; `rate-limit.ts:37-40` "a rotation only resets counts"; `scan-node-key.ts:38-40`. 3 people x 2 = 6, which publishes. Two resets in one hour lift a 2-person hour to 6. No runbook rule keeps rotations or deploys out of live event hours. | arithmetic, source-read | dedup resets treated as count noise | R1-08 is the silent missing or short pepper path. This is the deliberate, documented reset path, and it needs a different fix (a timing rule in the runbook). |

## 3. Re-rates

| id    | old    | new  | why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----- | ------ | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1-23 | Medium | High | The T4 job declares no `environment:` but uses `secrets.CLOUDFLARE_API_TOKEN_OSE` (`ci.yml:1866-1882`, `:2014-2102`), so it is a repo or org secret, as `ci.yml:1170` says. The same secret name deploys production (`:2656-2774`). There is one account (`wrangler.toml:40`). It is reachable from any same-repo `full-pipeline/*` PR. A compromised step can probably deploy to production and read FORMS_DB through deployed code. That is a product effect, not just a false claim. S2 adds KV scope to this token and five slices add steps that hold it. Inferred: Cloudflare tokens are scoped to the account, and a production-environment secret with the same name could override it in the deploy job; neither is visible from the repo. |
| R1-01 | High   | High | Rationale corrected (see section 1).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

## 4. Not checked

- Platform facts: whether KV listing returns expiry, the Queues message `timestamp`, the Workers Logs content, the real scope of the Cloudflare token and the GitHub secret level.
- Linear, `gh` runs and staging.
- `hashUserAgent` (is the fallback peppered?), `event-anon-key.ts` and the export at `forms.ts:624`.
- Builder grain mismatches (owned by OSE-1784).
- Outside the subject, not scored: AGENTS invariant 3 says "no CF-IP* header is read", but `public-read-limit.ts:83` reads `CF-Connecting-IP` as a rate-limit key. The invariant may mean location only.

## 5. Commands (all read-only, none refused, no file writes by the agent)

- `ls -la`, `sha256sum`, `wc -c` over `ccr-run/`.
- `grep -n '^#'` over the subject.
- Read: the merged register, the subject (lines 29-58, 113-344, 538-612) and the agent's loop-1 report.
- In the worktree: `git log --oneline -3`; `sed -n` on `qr-scan.ts` 40-56, 90-270; `scan-node-key.ts` 20-120; `rate-limit.ts` 25-140, 190-215; `public-read-limit.ts` 60-100, 195-215; `scan-buffer.ts` 28-100, 140-200; `shared-report.ts` 860-910; `forms.ts` 285-320; `ci.yml` 1166-1200, 1250-1270, 1866-1882, 2025-2050, 2549-2580, 2655-2672; `wrangler.toml` 95-100, 210-222, 355-380; `grep` for `rate-limit-stats|.list(`, `publicCountLimited`, `CLOUDFLARE_API_TOKEN`, `environment:` and `uses:`, `account_id`, `source_placement_id`, `UNHANDLED`; `awk` over `ci.yml` 1866-2528.
