# Runbook: the calendar edge rule (ADR-028, OSE-2023)

The owner runs this. After it, a calendar app can load a calendar address on staging, and later on production.

## Why

A calendar app is a machine. Google Calendar and Outlook.com fetch a feed from their own servers. Apple Calendar fetches from the person's device. None of them can answer a Cloudflare challenge.

On stg the edge answered a read with no browser and no CI header with a managed challenge (read 2026-11-13). So a subscription to `/brands/<brand>/calendar.ics` could not load, and the Subscribe menu's Google Calendar and Outlook.com options could add a calendar that stays empty.

The owner decided on 2026-11-14 (`docs/adr/ADR-028-calendar-addresses-and-the-edge.md`): skip the challenge for the two calendar address shapes, for every caller.

## What the rule does

`scripts/ci/cf-waf-calendar-skip.mjs` writes one skip rule in the zone's custom rules. It matches all three of these, and nothing else:

- the host: `stg.oursharedevents.com` for stg; `oursharedevents.com` and `www.oursharedevents.com` for production;
- a read (`GET` or `HEAD`);
- a path that starts with `/events/` or `/brands/` and ends with `/calendar.ics`.

It needs no header and no token. That is the point: an ordinary calendar app gets through.

What still protects those two addresses is the Worker's own limit: 60 requests per 10 seconds and 360 per minute, per caller. The answer is public data only, sets no cookie and writes nothing.

stg and production share one zone, so each has its own rule: `ose-2023-calendar-skip-stg` and `ose-2023-calendar-skip-production`. Applying one leaves the other alone.

The script writes only its own rule, through Cloudflare's per-rule endpoints. It never rewrites the rule set. It stops without writing when the read of the rules is not a clean answer, and after writing it checks that every other rule is still there, in the same order.

If the CI skip rule (`ose-1812-stg-ci-skip`) is on the zone, the script copies what that rule skips, because that set is already shown to get a read past this zone's edge. Otherwise it uses the default set: the rest of the custom rules, Super Bot Fight Mode, and the challenge products.

## Before you start

In Cloudflare → My Profile → API Tokens, create a custom token:

- Permissions: **Zone → Zone WAF → Edit** and **Zone → Zone → Read**.
- Zone resources: **Include → Specific zone → oursharedevents.com**.
- TTL: end it tomorrow. Delete it when you are done.

Type it in your own terminal. It stays out of the shell history and is never printed:

```bash
read -rs CLOUDFLARE_API_TOKEN && export CLOUDFLARE_API_TOKEN
```

## Run it on stg

1. Dry run. It reads the zone and writes nothing:

   ```bash
   node scripts/ci/cf-waf-calendar-skip.mjs
   ```

   Check the output: the current rules (no expression or description is printed), which skip set it uses, and the rule it would write.

2. Apply:

   ```bash
   node scripts/ci/cf-waf-calendar-skip.mjs --apply
   ```

   It ends with `Applied.` and exits 0 only when Cloudflare saved the rule and every other rule is still there. If it says `check the dashboard now`, open Security → WAF → Custom rules and compare against the dry run's list.

3. Clear the variable and delete the API token:

   ```bash
   unset CLOUDFLARE_API_TOKEN
   ```

## Check it

```bash
gh workflow run stg-edge-probe.yml
```

Under the table, the run summary has one line for calendar apps:

> Calendar addresses read with no header, as a calendar app reads them: 2 of 2 reached the Worker. A calendar app can load them.

`2 of 2` means the rule works. Then try the real thing once on staging: open a listed event page, choose Subscribe to calendar, and tap Google Calendar and Outlook.com. Neither link form is documented by its service, so this tap is the only real test of them. If one fails, the fourth option (the calendar address) pasted into the service's own "From URL" or "Subscribe from web" box is the documented way.

## Production

Only when the owner decides it, as a production change:

```bash
node scripts/ci/cf-waf-calendar-skip.mjs --host production
```

```bash
node scripts/ci/cf-waf-calendar-skip.mjs --host production --apply
```

Production is held closed (AGENTS.md). Applying the rule there keeps production in line with stg. It does not make production live.

## If a read is still challenged

Find the Ray ID of the challenged `plain` row in the probe's table and look it up in Cloudflare → Security → Events to see which product challenged it.

- If it is a product the copied skip set leaves out, add it to the CI skip rule in the dashboard, then run this script again. It copies that rule's skip set each time.
- If the write fails with a plan error (for example, skipping Super Bot Fight Mode needs Pro or above), the default skip set asks for more than the plan allows. Add the rule in the dashboard with what the plan allows.

## Roll back

```bash
node scripts/ci/cf-waf-calendar-skip.mjs --remove --apply
```

Add `--host production` for the production rule. It removes this rule and keeps every other rule as it was. Calendar apps are challenged again.
