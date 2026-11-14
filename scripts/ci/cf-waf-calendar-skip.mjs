#!/usr/bin/env node
// The edge rule that lets a calendar app read a calendar address (ADR-028, OSE-2023).
//
// A calendar app is a machine. Google Calendar and Outlook.com fetch a feed from
// their own servers, and Apple Calendar fetches from the person's device; none of
// them can answer a Cloudflare challenge. On stg the edge answered such a read of
// /brands/<brand>/calendar.ics and /events/<id>/calendar.ics with a managed
// challenge (2026-11-13), so a subscription could not load.
//
// Owner decision, 2026-11-14 (ADR-028, D1): skip the challenge for reads of those
// two address shapes, for every caller. This script writes that one rule, owned by
// its `ref`, so the owner applies it with one command.
//
// Usage (the token from the environment only, never an argument, never printed):
//   CLOUDFLARE_API_TOKEN=... node scripts/ci/cf-waf-calendar-skip.mjs                    # stg, dry run
//   CLOUDFLARE_API_TOKEN=... node scripts/ci/cf-waf-calendar-skip.mjs --apply            # stg
//   CLOUDFLARE_API_TOKEN=... node scripts/ci/cf-waf-calendar-skip.mjs --host production  # dry run
//   CLOUDFLARE_API_TOKEN=... node scripts/ci/cf-waf-calendar-skip.mjs --remove --apply   # rollback
//
// Dry run by default: it reads the zone, prints what it would write, writes nothing.
//
// WHAT THE RULE MATCHES, and nothing else:
//   - the host(s) of the chosen environment;
//   - a read (GET or HEAD);
//   - a path that starts with /events/ or /brands/ AND ends with /calendar.ics.
// No header and no token: the point is that an ordinary calendar app gets through.
//
// WHAT STILL PROTECTS THOSE ADDRESSES: the Worker's own limit on both routes
// (publicReadLimited: 60 requests per 10 seconds and 360 per minute, per caller).
// The answer is public data only, sets no cookie and writes nothing.
//
// Like the CI skip rule (cf-waf-stg-ci-skip.mjs) it writes only its own rule,
// through the per-rule endpoints, never by rewriting the rule set, and it stops on
// any read or write it cannot trust. stg and production share one zone
// (oursharedevents.com), so each environment has its own rule and its own ref.
//
// Token needs: Zone > Zone WAF > Edit and Zone > Zone > Read, on this zone only.
// The owner runs it in their own terminal (AGENTS.md: Human approval). An agent
// never applies an edge rule, on stg or production.

import { fileURLToPath } from 'node:url';
import {
  DEFAULT_SKIP,
  PHASE,
  ZONE_NAME,
  RULE_REF as CI_RULE_REF,
  redactor,
} from './cf-waf-stg-ci-skip.mjs';

/** The environments this rule can be written for, each with its hosts and its ref. */
export const TARGETS = {
  stg: { hosts: ['stg.oursharedevents.com'], ref: 'ose-2023-calendar-skip-stg' },
  production: {
    hosts: ['oursharedevents.com', 'www.oursharedevents.com'],
    ref: 'ose-2023-calendar-skip-production',
  },
};

/** A calendar address starts with one of these and ends with CALENDAR_SUFFIX. */
export const CALENDAR_PREFIXES = ['/events/', '/brands/'];
export const CALENDAR_SUFFIX = '/calendar.ics';
export const METHODS = ['GET', 'HEAD'];

/** True when a request path is one this rule covers. Built from the same lists. */
export function pathCovered(path) {
  const p = String(path).split('?')[0];
  return CALENDAR_PREFIXES.some((pre) => p.startsWith(pre)) && p.endsWith(CALENDAR_SUFFIX);
}

export function expressionFor(target) {
  const t = TARGETS[target];
  if (!t) throw new Error(`Unknown target ${target}; use stg or production.`);
  const hosts = t.hosts.map((h) => `"${h}"`).join(' ');
  const prefixes = CALENDAR_PREFIXES.map((p) => `starts_with(http.request.uri.path, "${p}")`).join(
    ' or '
  );
  return (
    `(http.host in {${hosts}}) and ` +
    `(http.request.method in {${METHODS.map((m) => `"${m}"`).join(' ')}}) and ` +
    `(${prefixes}) and ` +
    `ends_with(http.request.uri.path, "${CALENDAR_SUFFIX}")`
  );
}

/** The keys a skip rule's action_parameters may carry; anything else is dropped. */
const SKIP_KEYS = ['ruleset', 'phases', 'products', 'rules'];

export function buildRule(target, skip = DEFAULT_SKIP) {
  const params = {};
  for (const k of SKIP_KEYS) if (skip && skip[k] !== undefined) params[k] = skip[k];
  return {
    ref: TARGETS[target].ref,
    description: `ADR-028 (OSE-2023): calendar apps read .ics addresses on ${target} without a challenge`,
    expression: expressionFor(target),
    action: 'skip',
    action_parameters: params,
    logging: { enabled: true },
    enabled: true,
  };
}

/**
 * What to skip: the same set the CI skip rule skips, when that rule is on the zone,
 * because it is the set already shown to get a read past this zone's edge.
 * Otherwise the default set.
 */
export function skipSetFrom(rules) {
  const ci = (rules ?? []).find(
    (r) =>
      r.ref === CI_RULE_REF && r.action === 'skip' && r.enabled !== false && r.action_parameters
  );
  return ci ? { from: ci, skip: ci.action_parameters } : { from: null, skip: DEFAULT_SKIP };
}

/** Another rule as it may be printed: never its expression or description. */
export function describeRule(rule) {
  return {
    id: rule.id ?? null,
    ref: rule.ref ?? null,
    action: rule.action,
    enabled: rule.enabled !== false,
  };
}

async function cf(fetchFn, token, path, init = {}) {
  const res = await fetchFn(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

/** A ruleset answer that can be trusted: 200, success, an id and a rule list. */
function trustedRuleset(r) {
  return (
    r.status === 200 &&
    r.body?.success === true &&
    typeof r.body.result?.id === 'string' &&
    Array.isArray(r.body.result?.rules)
  );
}

/**
 * Every other rule is still there, in the same order, and ours is there (or gone).
 * Ours need not stay first: the CI skip rule puts itself first each time it runs,
 * and the two do not overlap in what they let through.
 */
export function othersKept(before, after, ref, { removed = false } = {}) {
  const ids = (rules) => rules.filter((r) => r.ref !== ref).map((r) => r.id);
  const same = JSON.stringify(ids(before)) === JSON.stringify(ids(after));
  const oursThere = after.some((r) => r.ref === ref);
  return same && (removed ? !oursThere : oursThere);
}

/**
 * The whole run, injectable for tests. Returns the exit code.
 * Writes only with --apply, and only its own rule in the zone's custom rules.
 */
export async function run({ argv, env, fetchFn, log = console.log, err = console.error }) {
  const args = argv ?? [];
  const apply = args.includes('--apply');
  const remove = args.includes('--remove');
  const hostIdx = args.indexOf('--host');
  const target = hostIdx >= 0 ? args[hostIdx + 1] : 'stg';
  const token = env.CLOUDFLARE_API_TOKEN;
  const clean = redactor(token);
  const out = (s) => log(clean(s));
  const fail = (s) => err(clean(s));

  if (!Object.prototype.hasOwnProperty.call(TARGETS, target ?? '')) {
    fail(`--host must be stg or production; refusing ${target || '(none)'}.`);
    return 2;
  }
  if (!token) {
    fail('Need CLOUDFLARE_API_TOKEN in the environment.');
    return 2;
  }
  const { ref, hosts } = TARGETS[target];
  if (target === 'production') {
    out(
      'This is the PRODUCTION rule. Apply it only as a production change the owner has decided ' +
        '(AGENTS.md: Human approval; ADR-028 D3 says stg first).'
    );
  }

  try {
    const z = await cf(fetchFn, token, `/zones?name=${encodeURIComponent(ZONE_NAME)}`);
    const zone = z.body?.success === true ? z.body.result?.[0] : null;
    if (!zone?.id) {
      fail(`No zone found for ${ZONE_NAME} (HTTP ${z.status}; token scope or name wrong).`);
      return 1;
    }

    const entry = await cf(fetchFn, token, `/zones/${zone.id}/rulesets/phases/${PHASE}/entrypoint`);
    if (!trustedRuleset(entry)) {
      fail(
        `Could not read the ${PHASE} rules (HTTP ${entry.status}). Nothing written. ` +
          'A zone with no custom rules yet: add this rule in the dashboard instead.'
      );
      return 1;
    }
    const rulesetId = entry.body.result.id;
    const before = entry.body.result.rules;
    const ours = before.find((r) => r.ref === ref);

    out(`Zone ${zone.name}: ${before.length} custom rule(s) now. Target: ${hosts.join(', ')}.`);
    for (const r of before) out(`  ${JSON.stringify(describeRule(r))}`);

    const base = `/zones/${zone.id}/rulesets/${rulesetId}/rules`;
    let call;
    if (remove) {
      if (!ours) {
        out(`${ref} is not there. Nothing to remove.`);
        return 0;
      }
      out(`Removing ${ref}; ${before.length - 1} rule(s) stay as they are.`);
      call = { path: `${base}/${ours.id}`, init: { method: 'DELETE' } };
    } else {
      const { from, skip } = skipSetFrom(before);
      out(
        from
          ? `Copying the skip set of the CI skip rule ${from.id}.`
          : 'No CI skip rule on the zone to copy from; using the default skip set.'
      );
      const rule = buildRule(target, skip);
      out(`${ours ? 'Updating' : 'Adding'} ${ref}${ours ? ' in place' : ' as the first rule'}:`);
      out(JSON.stringify(rule, null, 2));
      // A new rule goes first, ahead of whatever challenges. An update keeps its place.
      call = ours
        ? { path: `${base}/${ours.id}`, init: { method: 'PATCH', body: JSON.stringify(rule) } }
        : {
            path: base,
            init: { method: 'POST', body: JSON.stringify({ ...rule, position: { index: 1 } }) },
          };
    }

    if (!apply) {
      out('Dry run. Nothing written. Re-run with --apply to write.');
      return 0;
    }

    const res = await cf(fetchFn, token, call.path, call.init);
    if (!trustedRuleset(res)) {
      fail(`Write failed (HTTP ${res.status}): ${JSON.stringify(res.body?.errors ?? [])}`);
      return 1;
    }
    if (!othersKept(before, res.body.result.rules, ref, { removed: remove })) {
      fail('Written, but the rules read back are not as expected; check the dashboard now.');
      return 1;
    }
    out(
      remove
        ? 'Removed.'
        : 'Applied. Check it: gh workflow run stg-edge-probe.yml, then read the "plain" rows for the two calendar addresses.'
    );
    return 0;
  } catch {
    fail('The Cloudflare API call failed before an answer came back. Check the token value.');
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run({ argv: process.argv.slice(2), env: process.env, fetchFn: fetch }).then((code) =>
    process.exit(code)
  );
}
