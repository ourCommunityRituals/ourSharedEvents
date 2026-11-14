# Runbook: the stg CI skip rule (OSE-1812)

The owner runs this once. After that, the daily "Stock data (stg)" run and the twice-daily stg watch pass the Cloudflare edge with no manual step.

## Why

From GitHub runners, the edge answers stg reads of `/s/<code>` and `/events/<id>` with a managed challenge. The stock check never reaches the Worker, so every run is red. The dashboard skip rule for the `X-OCR-CI` header covers `/q/*` only (edge probe runs 42450169540 and 42518385175, 2026-11-08).

`scripts/ci/cf-waf-stg-ci-skip.mjs` writes one skip rule, `ose-1812-stg-ci-skip`, in the zone's custom rules. It matches all four of these, and nothing else:

- the host `stg.oursharedevents.com`;
- a read (`GET` or `HEAD`);
- the `X-OCR-CI` header equal to the CI token;
- a path CI reads: `/`, `/events`, `/events/…`, `/brands/…`, `/q/…`, `/s/…`, `/api/v2/uploads/…`.

`/brands/…` was added on 2026-11-13 for the brand calendar feed (`/brands/<brand>/calendar.ics`, OSE-2022). A rule applied before that date does not cover it: run the script again (dry run, then `--apply`). It updates its own rule in place.

A request without the token is challenged as before. The rule sits first, so it covers the rules after it.

The script writes only its own rule, through Cloudflare's per-rule endpoints (add, update or delete one rule by its id). It never rewrites the rule set, so it cannot drop or change another rule. It stops without writing when the read of the rules is not a clean answer. After writing, it checks that every other rule is still there, in the same order.

If the zone has exactly one X-OCR-CI skip rule (the `/q/` one), and only skip rules come before it, the script copies what that rule skips and only widens the paths. Otherwise it uses its default skip set: the rest of the custom rules, Super Bot Fight Mode, and the challenge products (browser integrity check, hotlink, security level, user agent and zone lockdown).

stg shares its zone with production (`oursharedevents.com`). The host match keeps the rule off production traffic, and the script refuses any host but stg.

## Before you start

1. In Cloudflare → My Profile → API Tokens, create a custom token:
   - Permissions: **Zone → Zone WAF → Edit** and **Zone → Zone → Read**.
   - Zone resources: **Include → Specific zone → oursharedevents.com**.
   - TTL: end it tomorrow. Delete it when you are done.
2. Have the `OCR_CI_EDGE_TOKEN` value (the repository secret CI sends).

Type both in your own terminal (Git Bash). They stay out of the shell history and are never printed:

```bash
read -rs CLOUDFLARE_API_TOKEN && export CLOUDFLARE_API_TOKEN
read -rs OCR_CI_EDGE_TOKEN && export OCR_CI_EDGE_TOKEN
```

## Run it

1. Dry run. It reads the zone and writes nothing:

   ```bash
   node scripts/ci/cf-waf-stg-ci-skip.mjs
   ```

   Check the output:
   - each current rule, with no expression or description printed (either may hold the token);
   - which skip set it uses (copied from the X-OCR-CI rule, or the default);
   - the rule it would write, with the token shown as `<OCR_CI_EDGE_TOKEN>`.

2. Apply:

   ```bash
   node scripts/ci/cf-waf-stg-ci-skip.mjs --apply
   ```

   It ends with `Applied.` and exits 0 only when Cloudflare saved this rule first and every other rule is still there. If it says `check the dashboard now`, open Security → WAF → Custom rules and compare against the dry run's list.

   A zone with no custom rules at all has nothing to add to. The script stops, and the rule is added in the dashboard instead.

3. Clear the variables and delete the API token:

   ```bash
   unset CLOUDFLARE_API_TOKEN OCR_CI_EDGE_TOKEN
   ```

## Check it

```bash
gh workflow run stg-watch.yml
```

The `edge` job must be green: every `check` read gets the Worker's own answer, and none is challenged. Then run the stock load, or wait for its 09:23 UTC schedule:

```bash
gh workflow run stock-data-full.yml
```

A green run closes the open `ci-red:stock-data-stg` issue, and its summary shows the Poster showcase table.

## Turn on the calendar strict switch (OSE-2022)

The edge probe reads the two calendar addresses, `/brands/root/calendar.ics` and `/events/test-event-001/calendar.ics`. Until the rule covers `/brands/`, the `edge` job is red on the first of them, and the T2 and T4 calendar checks show a warning, "Edge challenge (OSE-2022)", and stay green.

Once the `edge` job is green for both addresses, make a challenged calendar read a failure:

```bash
gh variable set CALENDAR_EDGE_STRICT --body 1
```

From the next run, a calendar read the edge challenges fails T2 (Bruno Pages) and T4g (Launch Story Smoke) by name. To go back, delete the variable:

```bash
gh variable delete CALENDAR_EDGE_STRICT
```

The owner sets this variable. An agent never sets repository variables (AGENTS.md).

This rule lets CI through. It does not let a calendar app through: that is a separate decision, `docs/adr/ADR-028-calendar-addresses-and-the-edge.md`.

## If a read is still challenged

The run summary names the first challenged read with its Ray ID. Look it up in Cloudflare → Security → Events to see which product challenged it:

- If it is a product the copied skip set leaves out, add it to that rule in the dashboard, then run the script again. It copies the dashboard rule's skip set each time.
- If the write fails with a plan error (for example, skipping Super Bot Fight Mode needs Pro or above), the default skip set asks for more than the plan allows. Add an X-OCR-CI skip rule in the dashboard with what the plan allows, then run the script again.

## Roll back

```bash
node scripts/ci/cf-waf-stg-ci-skip.mjs --remove --apply
```

This needs only `CLOUDFLARE_API_TOKEN`. It removes this rule and keeps every other rule as it was. CI's `/s/`, `/events/` and `/brands/` reads are challenged again. Delete `CALENDAR_EDGE_STRICT` first, or T2 and T4 go red.
