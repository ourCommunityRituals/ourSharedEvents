# Runbook: the calendar edge rule (ADR-028, OSE-2023)

The owner runs this, from GitHub. After it, a calendar app can load a calendar address on staging.

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

## Before you start: one secret, added in the browser

Everything below is done in a browser. Nothing runs on your own computer.

1. In Cloudflare → My Profile → API Tokens, create a custom token:
   - Permissions: **Zone → Zone WAF → Edit** and **Zone → Zone → Read**.
   - Zone resources: **Include → Specific zone → oursharedevents.com**.
   - Give it an end date you are comfortable with. It can be deleted after the rule is applied and made again if the rule ever needs changing.
2. In GitHub → the ourSharedEvents repository → Settings → Secrets and variables → Actions → **New repository secret**:
   - Name: `CLOUDFLARE_WAF_EDIT_TOKEN`
   - Value: the token.

The token can edit this zone's edge rules and nothing else: no deploy, no database, no storage. Only the "calendar edge rule (stg)" workflow reads it, and only in the step that writes the rule. The script redacts it from every line it prints.

## Run it on stg, from GitHub

In GitHub → Actions → **calendar edge rule (stg)** → Run workflow.

1. **Dry run first.** Leave `action` on `dry-run` and the confirm box empty. Run it.

   The run summary shows, in order: what a calendar app sees now (expect the two addresses challenged), then the script's output: the current rules (no expression or description is printed), which skip set it uses, and the rule it would write. Nothing is written.

2. **Apply.** Run it again with `action` set to `apply` and `APPLY` typed in the confirm box.

   The run writes the rule, waits 30 seconds, and reads the two calendar addresses again with no header. The job is green only when both reached the Worker:

   > Calendar addresses read with no header, as a calendar app reads them: 2 of 2 reached the Worker. A calendar app can load them.

   If the job is red on that last step, the rule was written but a read is still challenged. See "If a read is still challenged".

   If the script says `check the dashboard now`, open Cloudflare → Security → WAF → Custom rules and compare against the dry run's list.

Without the word `APPLY` in the confirm box, `apply` and `remove` stop before anything is read or written.

## Then try the real thing once

Open a listed event page on staging, choose Subscribe to calendar, and tap Google Calendar and Outlook.com. Neither link form is documented by its service, so this tap is the only real test of them. If one fails, the fourth option (the calendar address) pasted into the service's own "From URL" or "Subscribe from web" box is the documented way.

## The same thing from a terminal

The workflow only runs `scripts/ci/cf-waf-calendar-skip.mjs`. Anyone holding a token with the permissions above can run it directly:

```bash
node scripts/ci/cf-waf-calendar-skip.mjs
```

```bash
node scripts/ci/cf-waf-calendar-skip.mjs --apply
```

The token is read from `CLOUDFLARE_API_TOKEN` in the environment. This is a fallback, not the expected path.

## Production

Not offered by the workflow. The production rule is a separate rule (`ose-2023-calendar-skip-production`) and a production change the owner decides. The script supports it with `--host production`; adding it to the workflow is a small change to make when that decision is taken.

Production is held closed (AGENTS.md). Applying the rule there keeps production in line with stg. It does not make production live.

## If a read is still challenged

Find the Ray ID of the challenged `plain` row in the probe's table and look it up in Cloudflare → Security → Events to see which product challenged it.

- If it is a product the copied skip set leaves out, add it to the CI skip rule in the dashboard, then run this script again. It copies that rule's skip set each time.
- If the write fails with a plan error (for example, skipping Super Bot Fight Mode needs Pro or above), the default skip set asks for more than the plan allows. Add the rule in the dashboard with what the plan allows.

## Roll back

Run the workflow with `action` set to `remove` and `APPLY` in the confirm box. It removes this rule and keeps every other rule as it was. Calendar apps are challenged again.
