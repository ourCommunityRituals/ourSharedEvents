# Operations Runbook

> **Purpose:** Step-by-step procedures for diagnosing and resolving common production issues.
> **Architecture:** Cloudflare Worker + D1 (Phase 2 complete)
> **Last Updated:** 2026-04-09
> **Supersedes:** Previous version referencing oursharedevents.com, GAS, and Google Sheets

---

## Quick Reference

### Health Check URLs

| Check          | URL                                             | Expected Response                       |
| -------------- | ----------------------------------------------- | --------------------------------------- |
| Health         | `https://stg.oursharedevents.com/health`        | `{"ok":true,"env":"staging","d1":"ok"}` |
| Events API     | `https://stg.oursharedevents.com/api/v2/events` | `{"ok":true,"items":[...]}`             |
| Public page    | `https://stg.oursharedevents.com/`              | HTTP 200, HTML                          |
| Admin (authed) | `https://stg.oursharedevents.com/admin`         | HTTP 200 (with Bearer token)            |

> Replace `stg` with `www` or remove subdomain for production URLs.

### Quick Commands

```bash
# Basic health check
curl -s https://stg.oursharedevents.com/health | jq

# Events API
curl -s https://stg.oursharedevents.com/api/v2/events | jq

# Admin auth test
curl -s -H "Authorization: Bearer <ADMIN_KEY>" \
  https://stg.oursharedevents.com/api/v2/admin/events | jq '.ok'

# Live logs (real-time)
wrangler tail --env staging
```

---

## Incident Response

### When Alerted

**Step 1: Acknowledge** (0-2 minutes)

- Note the time and initial symptoms

**Step 2: Verify** (2-5 minutes)

```bash
# Health endpoint — checks D1 connectivity
curl -s https://stg.oursharedevents.com/health | jq

# If health fails, check Cloudflare status
# https://www.cloudflarestatus.com/
```

**Step 3: Diagnose** (5-15 minutes)

- See specific issue sections below
- Use `wrangler tail --env staging` for real-time error logs

**Step 4: Resolve or Escalate** (15+ minutes)

- Apply fix from runbook
- Or rollback (see ROLLBACK.md)

---

## Common Issues

### Issue: Health Check Returns Non-200

**Symptoms:**

- Health endpoint returns 5xx or no response
- D1 connectivity shows `"d1": "error"`

**Diagnostic Steps:**

1. **Check Cloudflare status**: https://www.cloudflarestatus.com/ (Workers + D1)

2. **Check Worker logs**:

   ```bash
   wrangler tail --env staging
   ```

3. **Verify D1 is accessible**:
   ```bash
   wrangler d1 execute DB --env staging --command "SELECT 1"
   ```

**Resolution:**

- If Cloudflare is down: Wait for restore
- If D1 query fails: Check migrations are applied (`wrangler d1 migrations apply DB --env staging --remote`)
- If Worker throws: Check logs for the specific error, redeploy if needed

---

### Issue: D1 Query Errors

**Symptoms:**

- Events API returns errors
- Health shows `"d1": "error"`

**Diagnostic Steps:**

1. **Check table existence**:

   ```bash
   wrangler d1 execute DB --env staging --command ".tables"
   ```

2. **Check migration state**:

   ```bash
   wrangler d1 migrations list DB --env staging --remote
   ```

3. **Verify specific table**:
   ```bash
   wrangler d1 execute DB --env staging --command "SELECT COUNT(*) FROM events"
   ```

**Resolution:**

- If tables missing: Apply migrations
  ```bash
  wrangler d1 migrations apply DB --env staging --remote
  wrangler d1 migrations apply FORMS_DB --env staging --remote
  ```
- If data is wrong or missing: see [DISASTER-RECOVERY.md](./DISASTER-RECOVERY.md). Start at its table in §1. Do not delete a database.

---

### Issue: Admin Authentication Fails

**Symptoms:**

- `/admin` returns 401 even with correct token
- Admin API endpoints reject Bearer token

**Diagnostic Steps:**

1. **Verify ADMIN_KEY is set**:

   ```bash
   wrangler secret list --env staging
   # Should show ADMIN_KEY
   ```

2. **Test auth**:

   ```bash
   curl -s -o /dev/null -w "%{http_code}" \
     -H "Authorization: Bearer <ADMIN_KEY>" \
     https://stg.oursharedevents.com/admin
   ```

3. **Check ALLOW_ADMIN_KEY_FALLBACK** (staging only):
   - In `wrangler.toml`: `ALLOW_ADMIN_KEY_FALLBACK = "true"` should be set for staging
   - Production uses CF Access JWT as primary

4. **Read the refusal line** (an Access login that gets 401): in the live logs,
   find `ADMIN_JWT_REFUSED` with the response's `X-Request-Id` as `request_id`.
   `where` says which check refused it (`preflight` in the router, or
   `requireAdmin`), and `reason` says why:
   - `expired`, `not_yet_valid`: the token's time claims (check the clock skew
     or log in again).
   - `audience`, `issuer`: a token for another Access app or team. Check
     `CF_ACCESS_AUD` and `CF_ACCESS_TEAM_DOMAIN`.
   - `signature`: not signed by the team's current key.
   - `email_shape`: the email is not a plain address.
   - `actor_mismatch`: the identity changed during the request (it was not
     valid at entry). Retry.
   - `malformed`: a token that cannot be decoded, **or** a JWKS fetch outage
     (TL-093). If many requests fail at once, check the team's certs endpoint.

   An `ADMIN_AUTH_MISCONFIG` line means a deployed worker received an Access
   token with no `CF_ACCESS_TEAM_DOMAIN` set; the token is not trusted.

**Resolution:**

- Re-set the secret: `wrangler secret put ADMIN_KEY --env staging`
- Redeploy: `npm run deploy:staging`

---

### Issue: Recent Deployment Broke Something

**Symptoms:**

- Issues started after a push to main
- New build version in health response

**Diagnostic Steps:**

1. **Check current build**:

   ```bash
   curl -s https://stg.oursharedevents.com/health | jq '.version'
   ```

2. **Check GitHub Actions history**:
   - Repository > Actions tab > recent workflow runs
   - Look for failed tests or deployment errors

3. **Check what changed**:
   ```bash
   git log --oneline -10
   ```

**Resolution:**

- Revert the change through a pull request: [ROLLBACK.md](./ROLLBACK.md) §3. A push straight to `main` is refused by branch protection.
- For production, then run ROLLBACK.md §4.
- Switching a Worker back by hand, outside CI, is break-glass on production: ROLLBACK.md §6.

---

### Issue: Forms / PII Encryption Errors

**Symptoms:**

- Form submissions fail
- Email signup encryption errors in logs

**Diagnostic Steps:**

1. **Check FORMS_ENCRYPTION_KEY**:

   ```bash
   wrangler secret list --env staging
   # Should show FORMS_ENCRYPTION_KEY
   ```

2. **Check Forms DB**:
   ```bash
   wrangler d1 execute FORMS_DB --env staging --command ".tables"
   ```

**Resolution:**

- If key missing: `wrangler secret put FORMS_ENCRYPTION_KEY --env staging`
- If forms DB tables missing: `wrangler d1 migrations apply FORMS_DB --env staging --remote`

---

### Issue: PII Cron Job Not Running

**Symptoms:**

- Expired registrations not being deleted
- Survey PII not being scrubbed

**Diagnostic Steps:**

1. **Check cron is configured** (in `wrangler.toml`):

   ```toml
   [triggers]
   crons = ["0 3 * * *"]
   ```

2. **Check logs during cron window** (3 AM UTC):
   ```bash
   wrangler tail --env staging --format pretty
   # Look for FORM_EVENT and LIFECYCLE log entries
   ```

**Resolution:**

- Verify the cron trigger is deployed: redeploy the Worker
- Manually trigger the cron in CF Dashboard: Workers > oursharedevents-stg > Triggers > Run Now

---

### Reading the nightly spine key check (`SPINE_KEY_CHECK`)

The same 03:00 UTC run ends with a check of the two spine keys on events
(`venue_canonical_id`, `event_correlation_id`; `src/lib/spine-keys-store.ts`). It
starts once every other nightly job has settled and logs one line, type
`SPINE_KEY_CHECK`. The line is a warning when it corrected a key, met an error or
left rows for another night, and an ordinary log line otherwise. Nothing alerts
on it, and no alerting exists in the repo (OSE-1603): look for it in the cron
window.

**No `SPINE_KEY_CHECK` line in the window means the check did not run**: one of
the other nightly jobs never finished, or the run was cut off.

| Field                               | Meaning                                                                                                                       |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `checked`                           | Events read this run (at most 5,000). Not the size of the table when the table is larger.                                     |
| `with_venue_key` / `with_event_key` | Of the events read, how many have what a venue key and an event key need. The rest have no key, by design.                    |
| `filled`                            | Events given a key they did not have. Expected after a deploy and after seeds run.                                            |
| `corrected`                         | Events whose stored key was wrong and was replaced. See below.                                                                |
| `errors`, `first_error`             | Rows that could not be computed or written, and the first error's class and database code (never its message).                |
| `incomplete`, `stopped`             | Rows were left for another night. `stopped` says why the run ended early; it is null when a write failed but the run went on. |

**`corrected` above zero** means an input of a key changed without the keys being
cleared. Causes: a type's `uec_code` was changed in the registry; a seed file or
migration changed a venue, cell, type or start and did not clear the keys; SQL run
by hand; an older Worker version ran after migration 0104 (a rollback); or the
rule in `lib/spine-keys.ts` changed. A night of it after one of those (several
nights when many rows are waiting) is the check doing its job. The same count
every night means something keeps writing without clearing: find the writer
(`tests/spine-keys-writers.spec.ts` lists the shapes it can and cannot see).

What to do for each `stopped` value:

- `write_cap`: 200 keys were written and more are waiting. Expected for a few
  nights after a deploy. Nothing to do unless it lasts longer than the number of
  events waiting, divided by 200, in nights.
- `row_cap`: the table has more than 5,000 events, so a run reads part of it and
  the next run starts elsewhere. Nothing to do; a given row is reached within a
  few nights, more as the table grows.
- `time`: the run took more than 10 seconds, which means the database was slow.
  Look at the other jobs' lines for the same night. One night of it needs nothing.
- `db_error`: a page could not be read. `first_error` has the class and code. The
  run stopped; the next night starts at a different point. If it repeats, treat
  it as a database problem, not a spine key problem.

`errors` with `stopped` null means a batch of writes failed. A batch is one
transaction: every write in that page's batch failed together, and they are
tried again on a later night. The same `first_error` every night needs a person:
take the code to the database's own error documentation.

On staging `filled` is a small number most nights: the CI seed files clear the
keys of the events they reset, and the check puts them back.

A save that could not store its keys logs `SPINE_KEYS_REFRESH_FAILED` (a
warning). The event keeps no key until a nightly check gives it one.

**An event with coordinates and no map cell** is off the map and has no key.
This is what is left if a coordinate change saved and the statement that computes
the new cell then failed (the request answered 503). The check cannot repair it.
Save the event's coordinates again, or, as a platform admin, call the one-shot
cell backfill route (`POST /api/v2/admin/events/backfill-h3-cells`).

---

### Issue: An Event Is Still Visible After Undo / Take Offline

**Symptoms:**

- An organizer pressed Undo or Take offline, but a guest or the TV still shows the event for a few minutes

**What is expected (OSE-1508):** the database change is immediate, but copies already handed out live until they expire.

| Where                                                              | How long it can lag                                         | Source                                                                                                |
| ------------------------------------------------------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Guest's browser, `GET /api/v2/events` and `GET /api/v2/events/:id` | up to 60 s fresh + 300 s stale-while-revalidate = **6 min** | `private, max-age=60, stale-while-revalidate=300` in `workers/oursharedevents/src/handlers/events.ts` |
| Attendee map, `GET /api/v2/events/map`                             | up to **6 min** (also cacheable at the edge: `public`)      | `workers/oursharedevents/src/handlers/events-map.ts`                                                  |
| TV `/display` event list                                           | until its next refresh, **5 min**                           | `setInterval(loadEvents, 5 * 60 * 1000)` in `src/templates/display.html`                              |
| TV screen settings (`display-config`)                              | **1 min**                                                   | `setInterval(loadDisplayConfig, 60 * 1000)` in `src/templates/display.html`                           |

**Inside the publish grace window** (`PUBLISH_GRACE_MINUTES`, 10 on deployed envs) the event was never listed, on the map, sitemap or the TV's "coming up", so an Undo there leaves no public trace. Only someone who already had the direct link could have seen it.

**Resolution:** none needed; wait up to 6 minutes. A guest can reload to see the change sooner. To shorten the lag, lower `max-age` / `stale-while-revalidate` on those responses (a code change, with a test).

## Monitoring

### Cloudflare Dashboard

- Worker analytics: dash.cloudflare.com > Workers > oursharedevents-stg > Analytics
- Request logs: Workers > oursharedevents-stg > Logs
- D1 metrics: Workers > D1 > ocr-db-staging

### GitHub Actions

- CI/CD runs: Repository > Actions tab
- Deploy history: Filter by "oursharedevents-ci" workflow

### Live Logging

```bash
# Staging (real-time logs)
wrangler tail --env staging --format pretty

# Production
wrangler tail --env production --format pretty
```

---

## Escalation

| Role              | Contact             | When to Escalate        |
| ----------------- | ------------------- | ----------------------- |
| Primary On-Call   | (configure in team) | First responder         |
| Backend Developer | (configure in team) | D1 / Worker issues      |
| Infrastructure    | (configure in team) | Cloudflare / DNS issues |

---

## Post-Incident

After resolving an incident:

1. **Document in incident log**
   - Time detected → Time resolved
   - Root cause
   - Fix applied
   - Lessons learned

2. **Update runbook** if the incident revealed a gap in procedures

3. **Consider automation** — if the same issue recurs, add monitoring or auto-recovery

---

## Related Documentation

- [ROLLBACK.md](./ROLLBACK.md) — Rollback procedures
- [DISASTER-RECOVERY.md](./DISASTER-RECOVERY.md) — DR protocol
- [RUNBOOK-SECRETS.md](./RUNBOOK-SECRETS.md) — Secret rotation
- [INFRA-CHECKLIST.md](../deployment/INFRA-CHECKLIST.md) — Infrastructure setup
