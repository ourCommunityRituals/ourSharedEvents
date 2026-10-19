# Token project: pick-up note, 2026-10-19 evening

Read this first. Full reasoning is in `CCR-TOKEN-PROJECT-DIRECTION-2026-10-19.md` (PR 1000). Names, dates and run ids only. No values.

## Where things stand

- Staging chain on `main` has been red since 2026-10-16 14:52Z. Cause: the Cloudflare API token CI uses is rejected (`Authentication error 10000`). It hits the T1 gate and the T2 seed steps.
- Two token pages exist in the Cloudflare account `c4dee735…` (matches `wrangler.toml`):
  - `…e7a88a6c…`: the earlier token (status and name not yet read to me).
  - `…940ba375…`: "my new one". Not yet tested. Not yet stored in GitHub (owner's recollection: not done).
- Setup order is correct: keep the old token until the new one is proven. The old value was overwritten in GitHub on 10-16 and cannot be restored.
- PR 1000 (docs only, draft) is green.

## Do tonight, in this order (your terminal)

1. **Test the new token before storing it.** Account ID is `c4dee735e39737db94d7befeecf96e82`.

```bash
read -rs -p "Token (new one, 940ba375…): " CF_TOKEN; echo
CF_ID=c4dee735e39737db94d7befeecf96e82
H="Authorization: Bearer $CF_TOKEN"; API=https://api.cloudflare.com/client/v4
curl -s -o /dev/null -w "1 verify : %{http_code}\n" -H "$H" "$API/accounts/$CF_ID/tokens/verify"
curl -s -H "$H" "$API/accounts" | python3 -c 'import sys,json;d=json.load(sys.stdin);print("2 accounts:",d.get("success"),[a["id"][:6]+"…"+a["id"][-4:] for a in d.get("result",[])],[e["code"] for e in d.get("errors",[])])'
curl -s -o /dev/null -w "3 secrets: %{http_code}\n" -H "$H" "$API/accounts/$CF_ID/workers/scripts/oursharedevents-stg/secrets"
unset CF_TOKEN
```

2. **Read the result.**
   - 1 = 200 and 3 = 200: token is good, go to step 3.
   - 1 not 200: value is bad. Roll once in the dashboard, test the new value, do not store yet.
   - 1 = 200 and 3 = 403: a permission is missing. Edit the policy on the token page (value stays the same), test again.
   - Code 10502 or 429: Cloudflare is throttling failed attempts. Wait, then run once more.
3. **Store both secrets only after a pass** (hidden prompt for the token):

```bash
gh secret set CLOUDFLARE_API_TOKEN_OSE --repo ourCommunityRituals/ourSharedEvents
gh secret set CLOUDFLARE_ACCOUNT_ID    --repo ourCommunityRituals/ourSharedEvents --body c4dee735e39737db94d7befeecf96e82
gh secret list --repo ourCommunityRituals/ourSharedEvents --json name,updatedAt | grep -E 'CLOUDFLARE_API_TOKEN_OSE|CLOUDFLARE_ACCOUNT_ID'
```

4. **One dispatch on `main`** (not a scheduled run: T1 is skipped on schedule). Send me the run id.
5. After a green T1 to T4: decide about the old token.

## Decisions waiting on you

1. Old token (`e7a88a6c…`): hold until the green run, or read the audit log now and delete early if clean? Bring back its name and status.
2. Go for Lanes A and B as draft PRs on their own branches? (Needs your explicit permission to push to a branch other than `claude/kind-pasteur-wjl7ro`.)
3. Go for the Linear updates (OSE-1730 to In Progress with corrected facts, OSE-1731 to Todo, dated OSE-1695 comment)?
4. Accept the PR-head reach to the token (F7) until OSE-1699, in writing?
5. The archived "Token overhaul" session had uncommitted files. Check them on a trusted device before the container is reclaimed.

## Built while you were out (local only, not pushed)

Two commits on top of `f33d1b24`, saved as patches in `.claude/outputs/patches/`. Nothing is pushed to any branch other than this one, and nothing touches a credential.

| Patch | What it does | Proof |
| ----- | ------------ | ----- |
| `0001` Lane A | The secrets gate captures wrangler's exit code and `scripts/ci/classify-wrangler-failure.sh` labels auth, network and other failures. A rejected token now reads "Cloudflare authentication failure ... NOT a missing-secret finding ... Do NOT run set-secrets.sh". A genuinely missing name reads as before. Fail-closed is unchanged. | 14 new tests. 4 YAML cases red against the old workflow; 9 behaviour cases red with the script removed. Both real gate texts (staging and production) replayed end to end with a stubbed wrangler: auth, all-present, one-missing. |
| `0002` Lane B | T2 and T4 install the worker's locked dependencies before their seed steps, so they run wrangler 4.145.0 and not whatever npx fetches. Hub staging becomes required in those two jobs (the ADR-008 wiring gate demands it once they build the Worker). `continue-on-error` baseline 22 to 20. | New spec red on exactly `contract-staging-sub` and `functional-staging-sub` before the change. `tests/unit/ci` plus `tests/integration`: 57 files, 1,175 tests pass. eslint clean. |

Not covered by these patches: a gate that checks the token's scope or owning account (F5), exact-name matching in the secrets gate, and PR-head reach to the token (F7).

Cost to watch: T2 and T4 now run a worker `npm ci` (setup-node already caches both lockfiles). Read the first run's duration.

To use them: say go, and I push each to its own branch and open two draft PRs ("Part of OSE-1731" and "Part of OSE-1695"). Or apply locally: `git am .claude/outputs/patches/*.patch`.

## Do not

- Do not run `scripts/set-secrets.sh`. The gate message tells you to when auth fails. It overwrites the encryption key and peppers.
- Do not re-run CI before step 2 passes. Failed runs feed Cloudflare's throttle.
- Do not rotate `ADMIN_KEY`, `X_OCR_INTERNAL` or the Access token until the chain is green.
