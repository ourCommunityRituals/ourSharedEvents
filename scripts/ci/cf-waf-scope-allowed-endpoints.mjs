#!/usr/bin/env node
// Put the managed WAF back in front of production (OSE-2115).
//
// The dashboard custom rule "Skip WAF for allowed endpoints" skips the managed
// WAF, Super Bot Fight Mode and rate limiting on /, /api/*, /forms/*, /admin and
// about 40 more paths. It has no host condition, so it applies to production
// (oursharedevents.com) as well as stg, which shares the zone. And the zone's
// "Execute Cloudflare Managed Ruleset" rule is switched off. Read-only review,
// 2026-11-17.
//
// This script makes two changes, each to one rule only:
//   1. skip:    prefix that rule's expression with (http.host eq "stg.oursharedevents.com"),
//               so stg CI keeps the skip and production loses it.
//   2. managed: switch "Execute Cloudflare Managed Ruleset" on.
//
// Usage (the token from the environment only, never an argument, never printed):
//   CLOUDFLARE_API_TOKEN=... node scripts/ci/cf-waf-scope-allowed-endpoints.mjs                 # dry run, both
//   CLOUDFLARE_API_TOKEN=... node scripts/ci/cf-waf-scope-allowed-endpoints.mjs --only skip --apply
//   CLOUDFLARE_API_TOKEN=... node scripts/ci/cf-waf-scope-allowed-endpoints.mjs --only managed --apply
//   CLOUDFLARE_API_TOKEN=... node scripts/ci/cf-waf-scope-allowed-endpoints.mjs --rollback --apply
//
// Dry run by default. It writes through the per-rule endpoint (PATCH one rule by
// id), never by rewriting a rule set, and checks afterwards that every other rule
// is still there in the same order. A read it cannot trust stops it. It never
// prints a rule's expression or description: another rule in this zone holds the
// stg CI token in its expression.
//
// Token needs: Zone > Zone WAF > Edit and Zone > Zone > Read, on this zone only.
// The owner runs it in their own terminal (AGENTS.md: Human approval).

import { fileURLToPath } from 'node:url';

export const ZONE_NAME = 'oursharedevents.com';
export const STG_HOST = 'stg.oursharedevents.com';
export const SKIP_DESCRIPTION = 'Skip WAF for allowed endpoints';
export const CUSTOM_PHASE = 'http_request_firewall_custom';
export const MANAGED_PHASE = 'http_request_firewall_managed';
/** Cloudflare's own id for the Cloudflare Managed Ruleset (the same in every zone). */
export const MANAGED_RULESET_ID = 'efb7b8c949ac4650a09736fc376e9aee';
export const HOST_PREFIX = `(http.host eq "${STG_HOST}") and (`;

/** True when the expression is already pinned to stg by this script. */
export function isScoped(expression) {
  const e = String(expression ?? '');
  return e.startsWith(HOST_PREFIX) && e.endsWith(')');
}

export function scopeExpression(expression) {
  const e = String(expression ?? '').trim();
  if (!e) throw new Error('The rule has no expression.');
  return isScoped(e) ? e : `${HOST_PREFIX}${e})`;
}

export function unscopeExpression(expression) {
  const e = String(expression ?? '');
  return isScoped(e) ? e.slice(HOST_PREFIX.length, -1) : e;
}

/** The one dashboard skip rule this script owns the fix for. */
export function findSkipRules(rules) {
  return (rules ?? []).filter(
    (r) => r.action === 'skip' && String(r.description ?? '').trim() === SKIP_DESCRIPTION
  );
}

export function findManagedRules(rules) {
  return (rules ?? []).filter(
    (r) => r.action === 'execute' && r.action_parameters?.id === MANAGED_RULESET_ID
  );
}

/** A rule as it may be printed: never its expression or description. */
export function describeRule(rule) {
  return {
    id: rule.id ?? null,
    action: rule.action,
    enabled: rule.enabled !== false,
    hostScopedToStg: isScoped(rule.expression),
  };
}

/** The fields a rule PATCH carries; server fields (version, last_updated) are dropped. */
const RULE_KEYS = [
  'ref',
  'description',
  'expression',
  'action',
  'action_parameters',
  'logging',
  'enabled',
];

export function patchBody(rule, changes) {
  const body = {};
  for (const k of RULE_KEYS) if (rule[k] !== undefined) body[k] = rule[k];
  return { ...body, ...changes };
}

/** Every rule is still there, in the same order. */
export function sameOrder(before, after) {
  const ids = (rules) => (rules ?? []).map((r) => r.id);
  return JSON.stringify(ids(before)) === JSON.stringify(ids(after));
}

export function redactor(...secrets) {
  const live = secrets.filter((s) => typeof s === 'string' && s.length >= 4);
  return (line) => live.reduce((s, x) => s.split(x).join('<redacted>'), String(line));
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

function trustedRuleset(r) {
  return (
    r.status === 200 &&
    r.body?.success === true &&
    typeof r.body.result?.id === 'string' &&
    Array.isArray(r.body.result?.rules)
  );
}

/**
 * Plan one change: which rule, what to send, and how to check the answer.
 * Returns { skip: reason } when there is nothing to do, or throws when the
 * rule set is not as expected.
 */
export function planSkip(rules, { rollback }) {
  const found = findSkipRules(rules);
  if (found.length !== 1) {
    throw new Error(
      `Expected exactly one skip rule named "${SKIP_DESCRIPTION}", found ${found.length}. Nothing written.`
    );
  }
  const rule = found[0];
  const scoped = isScoped(rule.expression);
  if (!rollback && scoped) return { skip: 'already pinned to stg' };
  if (rollback && !scoped) return { skip: 'not pinned by this script; left as it is' };
  const expression = rollback
    ? unscopeExpression(rule.expression)
    : scopeExpression(rule.expression);
  return {
    rule,
    body: patchBody(rule, { expression }),
    check: (after) => {
      const r = (after ?? []).find((x) => x.id === rule.id);
      return Boolean(r) && isScoped(r.expression) === !rollback;
    },
    say: rollback
      ? `Rule ${rule.id}: remove the stg host condition (back to every host).`
      : `Rule ${rule.id}: add (http.host eq "${STG_HOST}"); production stops skipping the WAF.`,
  };
}

export function planManaged(rules, { rollback }) {
  const found = findManagedRules(rules);
  if (found.length !== 1) {
    throw new Error(
      `Expected exactly one rule executing the Cloudflare Managed Ruleset, found ${found.length}. Nothing written.`
    );
  }
  const rule = found[0];
  const on = rule.enabled !== false;
  const want = !rollback;
  if (on === want) return { skip: `already ${on ? 'on' : 'off'}` };
  return {
    rule,
    body: patchBody(rule, { enabled: want }),
    check: (after) => {
      const r = (after ?? []).find((x) => x.id === rule.id);
      return Boolean(r) && (r.enabled !== false) === want;
    },
    say: `Rule ${rule.id}: switch the Cloudflare Managed Ruleset ${want ? 'on' : 'off'}.`,
  };
}

/**
 * The whole run, injectable for tests. Returns the exit code.
 * Writes only with --apply.
 */
export async function run({ argv, env, fetchFn, log = console.log, err = console.error }) {
  const args = argv ?? [];
  const apply = args.includes('--apply');
  const rollback = args.includes('--rollback');
  const onlyIdx = args.indexOf('--only');
  const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null;
  const token = env.CLOUDFLARE_API_TOKEN;
  const clean = redactor(token);
  const out = (s) => log(clean(s));
  const fail = (s) => err(clean(s));

  if (only !== null && only !== 'skip' && only !== 'managed') {
    fail(`--only takes skip or managed, not ${only || '(none)'}.`);
    return 2;
  }
  if (!token) {
    fail('Need CLOUDFLARE_API_TOKEN in the environment.');
    return 2;
  }

  const steps = [
    { name: 'skip', phase: CUSTOM_PHASE, plan: planSkip },
    { name: 'managed', phase: MANAGED_PHASE, plan: planManaged },
  ].filter((s) => only === null || s.name === only);

  try {
    const z = await cf(fetchFn, token, `/zones?name=${encodeURIComponent(ZONE_NAME)}`);
    const zone = z.body?.success === true ? z.body.result?.[0] : null;
    if (!zone?.id) {
      fail(`No zone found for ${ZONE_NAME} (HTTP ${z.status}; token scope or name wrong).`);
      return 1;
    }

    // Read and plan every step before writing any, so a bad read stops the run whole.
    const planned = [];
    for (const step of steps) {
      const entry = await cf(
        fetchFn,
        token,
        `/zones/${zone.id}/rulesets/phases/${step.phase}/entrypoint`
      );
      if (!trustedRuleset(entry)) {
        fail(`Could not read the ${step.phase} rules (HTTP ${entry.status}). Nothing written.`);
        return 1;
      }
      const before = entry.body.result.rules;
      out(`${step.phase}: ${before.length} rule(s).`);
      for (const r of before) out(`  ${JSON.stringify(describeRule(r))}`);
      let plan;
      try {
        plan = step.plan(before, { rollback });
      } catch (e) {
        fail(e.message);
        return 1;
      }
      if (plan.skip) {
        out(`${step.name}: nothing to do (${plan.skip}).`);
        continue;
      }
      out(`${step.name}: ${plan.say}`);
      planned.push({ ...plan, rulesetId: entry.body.result.id, before });
    }

    if (!planned.length) {
      out('Nothing to write.');
      return 0;
    }
    if (!apply) {
      out('Dry run. Nothing written. Re-run with --apply to write.');
      return 0;
    }

    for (const p of planned) {
      const path = `/zones/${zone.id}/rulesets/${p.rulesetId}/rules/${p.rule.id}`;
      const res = await cf(fetchFn, token, path, { method: 'PATCH', body: JSON.stringify(p.body) });
      if (!trustedRuleset(res)) {
        fail(`Write failed (HTTP ${res.status}): ${JSON.stringify(res.body?.errors ?? [])}`);
        return 1;
      }
      const after = res.body.result.rules;
      if (!sameOrder(p.before, after) || !p.check(after)) {
        fail('Written, but the rules read back are not as expected; check the dashboard now.');
        return 1;
      }
      out(`Applied: ${p.say}`);
    }
    out(
      'Check it: Security > Events for a day, then dispatch the staging chain ' +
        '(gh workflow run "OurSharedEvents CI/CD" --ref main -f deploy_staging=true).'
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
