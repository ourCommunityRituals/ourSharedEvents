#!/usr/bin/env node
// OSE-1509: the edge rate limit that meets the PO bar (a flood gets a 429 within 3 s;
// one person at ~5 requests a second never does).
//
// The Workers `ratelimits` binding and the KV count in the Worker cannot meet it
// (see src/lib/edge-rate-limit.ts). A Cloudflare WAF rate-limiting rule counts in the
// request path at the edge, before the Worker runs.
//
// Usage (token from the environment only, never an argument, never logged):
//   CLOUDFLARE_API_TOKEN=... node scripts/ci/cf-waf-rate-limit.mjs --host stg.oursharedevents.com
//   CLOUDFLARE_API_TOKEN=... node scripts/ci/cf-waf-rate-limit.mjs --host stg.oursharedevents.com --apply
//   CLOUDFLARE_API_TOKEN=... node scripts/ci/cf-waf-rate-limit.mjs --host stg.oursharedevents.com --remove --apply   # rollback
//
// Dry run by default: prints the rule set it would write and writes nothing.
// Idempotent: it owns exactly one rule, found by its `ref`, and leaves every other rule
// in the zone's `http_ratelimit` entrypoint untouched (a PUT replaces the whole set, so
// the existing rules are read first and merged).
//
// Token needs: Zone > Zone Rulesets > Edit, and Zone > Zone > Read, on this zone only.
//
// CI TRAFFIC (CCR finding, 2026-10-04): T2 Bruno, T3 smoke and T4 call /api/v2/events*
// from one GitHub runner IP. If a run goes past 60 requests in 10 s the rule would 429
// the pipeline's own tests. Only the /q/* scan trace sends the X-OCR-CI header today
// (scripts/ci/trace-scan-staging.sh). Before --apply on staging either:
//   (a) apply with --ci-exempt (OCR_CI_EDGE_TOKEN in the environment) AND make the T2-T4
//       clients send `X-OCR-CI: $OCR_CI_EDGE_TOKEN`, or
//   (b) apply without it, run T2-T4 once, and watch for 429s before leaving it on.
// The red-team RL tests send no such header, so they are still limited, which is the point.
// The token is secret: it is never printed, and --ci-exempt is for staging only.

export const RULE_REF = 'ose-1509-public-api-flood';
export const LIMIT_REQUESTS = 60;
export const PERIOD_SECONDS = 10;
export const MITIGATION_SECONDS = 10;

/** Public reads and form POSTs live under this prefix. Admin has its own auth. */
export const RULE_EXPRESSION = '(starts_with(http.request.uri.path, "/api/v2/events"))';

/** A secret CI header lets the pipeline's own traffic skip the limit. Never use on production. */
export function expressionFor(ciToken) {
  if (!ciToken) return RULE_EXPRESSION;
  if (!/^[A-Za-z0-9._~+/=-]{16,}$/.test(ciToken)) {
    throw new Error('OCR_CI_EDGE_TOKEN has characters that cannot go in a rule expression');
  }
  return `${RULE_EXPRESSION} and not any(http.request.headers["x-ocr-ci"][*] eq "${ciToken}")`;
}

export function buildRule(ciToken) {
  return {
    ref: RULE_REF,
    description: 'OSE-1509: 60 requests / 10 s per IP on /api/v2/events*',
    expression: expressionFor(ciToken),
    action: 'block',
    action_parameters: {
      response: {
        status_code: 429,
        content_type: 'application/json',
        content: '{"ok":false,"status":429,"code":"RATE_LIMITED","error":"Too many requests"}',
      },
    },
    ratelimit: {
      characteristics: ['ip.src', 'cf.colo.id'],
      period: PERIOD_SECONDS,
      requests_per_period: LIMIT_REQUESTS,
      mitigation_timeout: MITIGATION_SECONDS,
    },
    enabled: true,
  };
}

/** Replace our rule (by ref) or append it; keep every other rule as it was. */
/** Rollback: every rule except ours, untouched. */
export function removeRule(existing, ref = RULE_REF) {
  return (existing ?? []).filter((r) => r.ref !== ref);
}

/** The rule as it may be shown on a terminal: the CI token never appears. */
export function redactRule(rule, ciToken) {
  return ciToken
    ? { ...rule, expression: rule.expression.split(ciToken).join('<OCR_CI_EDGE_TOKEN>') }
    : rule;
}

export function mergeRules(existing, ours = buildRule()) {
  const others = (existing ?? []).filter((r) => r.ref !== ours.ref);
  return [...others, ours];
}

async function cf(token, path, init = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function main() {
  const args = process.argv.slice(2);
  const hostIdx = args.indexOf('--host');
  const host = hostIdx >= 0 ? args[hostIdx + 1] : '';
  const apply = args.includes('--apply');
  const ciExempt = args.includes('--ci-exempt');
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const ciToken = ciExempt ? process.env.OCR_CI_EDGE_TOKEN : undefined;
  if (ciExempt && !ciToken) {
    console.error('--ci-exempt needs OCR_CI_EDGE_TOKEN in the environment.');
    process.exit(2);
  }
  if (ciExempt && /^(www\.)?oursharedevents\.com$/.test(host)) {
    console.error('--ci-exempt is for staging only; production has no CI traffic to exempt.');
    process.exit(2);
  }
  if (!host || !token) {
    console.error('Need --host <hostname> and CLOUDFLARE_API_TOKEN in the environment.');
    process.exit(2);
  }

  // The zone is the registrable domain; try the host's parents until one resolves.
  const parts = host.split('.');
  let zone = null;
  for (let i = 0; i < parts.length - 1 && !zone; i++) {
    const name = parts.slice(i).join('.');
    const r = await cf(token, `/zones?name=${encodeURIComponent(name)}`);
    zone = r.body?.result?.[0] ?? null;
  }
  if (!zone) {
    console.error(`No zone found for ${host} (token scope or hostname wrong).`);
    process.exit(1);
  }

  const entry = await cf(token, `/zones/${zone.id}/rulesets/phases/http_ratelimit/entrypoint`);
  const existing = entry.status === 200 ? (entry.body.result?.rules ?? []) : [];
  if (entry.status !== 200 && entry.status !== 404) {
    console.error(`Could not read the http_ratelimit entrypoint (HTTP ${entry.status}).`);
    process.exit(1);
  }

  const ours = buildRule(ciToken);
  const remove = args.includes('--remove');
  const rules = remove ? removeRule(existing) : mergeRules(existing, ours);
  console.log(
    `Zone ${zone.name}: ${existing.length} existing rule(s), ${remove ? 'removing ours, leaving' : 'writing'} ${rules.length}.`
  );
  if (!remove) console.log(JSON.stringify(redactRule(ours, ciToken), null, 2));
  if (apply && !remove && !ciToken && !args.includes('--accept-ci-risk')) {
    console.error(
      'Refusing to apply without --ci-exempt: the pipeline calls /api/v2/events* from one IP and may be limited.'
    );
    console.error(
      'Use --ci-exempt (and make T2-T4 send X-OCR-CI), or add --accept-ci-risk to apply anyway and watch the next run.'
    );
    process.exit(2);
  }
  if (!apply) {
    console.log('Dry run. Re-run with --apply to write.');
    return;
  }

  const put = await cf(token, `/zones/${zone.id}/rulesets/phases/http_ratelimit/entrypoint`, {
    method: 'PUT',
    body: JSON.stringify({ rules }),
  });
  if (put.status !== 200 || !put.body.success) {
    console.error(`Write failed (HTTP ${put.status}): ${JSON.stringify(put.body.errors ?? [])}`);
    process.exit(1);
  }
  console.log('Applied. Verify with the T5 red-team run (RL-001/RL-002).');
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
