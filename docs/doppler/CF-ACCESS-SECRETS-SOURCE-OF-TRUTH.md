# CF Access + CI secrets — Doppler as single source of truth (OSE-349)

**Why this exists:** the T3 sponsor covenant kept going red on `main` because the
CF Access service token drifted out of sync with the `CF_ACCESS_CLIENT_ID` /
`CF_ACCESS_CLIENT_SECRET` GitHub Actions secrets — rotated/expired in Cloudflare
without the repo secrets being updated. Occurrences: OSE-349 → 889 → 940 → 1112.
The root class is **two copies of one credential drifting apart.** This makes
Doppler the _only writer_; GitHub Actions secrets become a **read-only mirror**
that Doppler regenerates, so there is only one copy to keep fresh.

Chosen integration style: **Doppler → GitHub Actions sync** (not runtime
injection). Rationale (Dr. of Security, OSE-349 CCR): sync keeps GitHub holding
only per-secret values — there is **no single `DOPPLER_TOKEN` in CI that unlocks
everything**, so blast radius is unchanged from today while drift is eliminated.

---

## The one rule after cutover

> **`gh secret set` for these keys is forbidden.** Doppler is the only writer.
> If you set a GitHub secret by hand, you have re-created the drift this closes.
> Rotate the value in Doppler; the sync repopulates GitHub within seconds.

Secrets under Doppler control (project `oursharedevents`):
`ADMIN_KEY`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`, `X_OCR_INTERNAL`,
`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN_OSE`.

---

## One-time setup — HUMAN (Doppler + GitHub dashboards)

1. **Doppler → project `oursharedevents` → config `stg`** (already exists; see
   `docs/doppler/doppler_secrets_set_CLOUDFLARE_ACCOUNT_.md`).
2. **Integrations → GitHub Actions → Configure.** Authorize the
   `ourCommunityRituals/ourSharedEvents` repo. Choose **sync direction:
   Doppler → GitHub**, scope = **repository secrets**, config = `stg`.
3. Doppler now writes the six keys above into the repo's Actions secrets and
   re-writes them on every change. Confirm with `gh secret list` — the
   `Updated` timestamps should move whenever you change a value in Doppler.

## Rotating the CF Access token (the recurrence path) — HUMAN, ~2 min

```powershell
# 1. Cloudflare Zero Trust → Access → Service Tokens → OSE CI token → Refresh.
#    Copy the new Client ID + Secret (shown once).
# 2. Write them to Doppler — the ONLY place you touch:
doppler secrets set CF_ACCESS_CLIENT_ID="<new id>"     --project oursharedevents --config stg
doppler secrets set CF_ACCESS_CLIENT_SECRET="<new secret>" --project oursharedevents --config stg
# 3. Sync repopulates the GitHub secrets automatically. Verify:
gh workflow run cf-access-canary.yml --ref main   # fail-closed canary → green means edge+worker both accept
```

Do **not** run `gh secret set CF_ACCESS_CLIENT_ID …` — that bypasses Doppler and
re-opens the drift.

---

## Anti-recurrence trio (credential-hardening audit)

| Control             | Where                                                                                                                                                                                                                                                                             | Status                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| **Bounded expiry**  | Cloudflare service-token **Duration** — set deliberately (long enough to avoid self-inflicted outages, short enough to force rotation hygiene). **Verify this now** — a sub-24h recurrence suggests it is set too short or the Access policy, not value drift, is the real cause. | ⚠️ human check (OSE-349) |
| **Tripwire**        | `.github/workflows/cf-access-canary.yml` — fail-closed, every 6h. Catches a stale/expired token within 6h, **before** it shadows a covenant merge.                                                                                                                                | ✅ this PR               |
| **Dated follow-up** | Calendar/Linear reminder to rotate ahead of the chosen Duration, so bounded-expiry never lapses silently a 5th time.                                                                                                                                                              | 📋 file on cutover       |

## What Doppler does and does not fix

- **Fixes:** value drift between Cloudflare and GitHub (cause #1) — one writer, one copy.
- **Does NOT fix:** a too-short token **Duration** (cause #1b) or an Access
  **policy** that no longer covers `/api/v2/admin/*` for this token (causes #2/#3).
  Those are Cloudflare-side and must be verified at the dashboard. The canary
  will keep flagging `cf_access_shadow` until they are correct — that is the
  tripwire doing its job, not a false alarm.
