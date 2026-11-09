#!/usr/bin/env node
// The stg edge rule that lets CI's own public reads through (OSE-1812, OSE-939).
//
// From GitHub runners the Cloudflare edge answers stg reads of /s/<code> and
// /events/<id> with a managed challenge, so the daily "Stock data (stg)" check never
// reaches the Worker and every run goes red. The dashboard skip rule for the
// X-OCR-CI header covers /q/* only (edge probe runs 42450169540, 42518385175).
// This script writes one skip rule, owned by its `ref`, that covers every public
// path CI reads on stg, so the owner applies it with one command instead of
// editing the dashboard by hand.
//
// Usage (both secrets from the environment only, never an argument, never printed):
//   CLOUDFLARE_API_TOKEN=... OCR_CI_EDGE_TOKEN=... node scripts/ci/cf-waf-stg-ci-skip.mjs
//   CLOUDFLARE_API_TOKEN=... OCR_CI_EDGE_TOKEN=... node scripts/ci/cf-waf-stg-ci-skip.mjs --apply
//   CLOUDFLARE_API_TOKEN=... node scripts/ci/cf-waf-stg-ci-skip.mjs --remove --apply   # rollback
//
// Dry run by default: it reads the zone, prints what it would write, and writes nothing.
// stg only: the rule's expression is pinned to stg's host, and no other host is accepted.
// stg shares its zone with production (oursharedevents.com), so this rule sits in the
// production zone's custom rules. The host match keeps it off production traffic.
// It writes only its own rule, through the per-rule endpoints (add, update, delete one
// rule by id), never by rewriting the rule set, so no other rule can be dropped or
// changed. A read it cannot trust (not a 200 with success and a rule list) stops it.
// Its rule goes first. The token is matched as an exact header value, and requests
// without it are challenged as before.
//
// Token needs: Zone > Zone WAF > Edit (custom rules), and Zone > Zone > Read, on this
// zone only. The owner runs it in their own terminal (AGENTS.md: Human approval).

import { fileURLToPath } from 'node:url';

export const RULE_REF = 'ose-1812-stg-ci-skip';
export const STG_HOST = 'stg.oursharedevents.com';
export const ZONE_NAME = 'oursharedevents.com';
export const PHASE = 'http_request_firewall_custom';

/**
 * Every public path CI reads on stg, from scripts/stock (check-full, stg-watch,
 * edge-probe): QR scans, short links, event pages and the /events search, art,
 * and the landing page's zip search. Reads only: GET and HEAD.
 */
export const EXACT_PATHS = ['/', '/events'];
export const PATH_PREFIXES = ['/q/', '/s/', '/events/', '/api/v2/uploads/'];
export const METHODS = ['GET', 'HEAD'];

/**
 * What the rule skips when the zone has no X-OCR-CI rule to copy from: the rest of
 * the custom rules, the bot rules, and the challenge products.
 */
export const DEFAULT_SKIP = {
  ruleset: 'current',
  phases: ['http_request_sbfm'],
  products: ['bic', 'hot', 'securityLevel', 'uaBlock', 'zoneLockdown'],
};

const TOKEN_RE = /^[A-Za-z0-9._~+/=-]{16,}$/;

/** True when a request path is one this rule covers. Built from the same lists. */
export function pathCovered(path) {
  const p = String(path).split('?')[0];
  return EXACT_PATHS.includes(p) || PATH_PREFIXES.some((pre) => p.startsWith(pre));
}

export function pathClause() {
  const parts = [
    ...EXACT_PATHS.map((p) => `http.request.uri.path eq "${p}"`),
    ...PATH_PREFIXES.map((p) => `starts_with(http.request.uri.path, "${p}")`),
  ];
  return `(${parts.join(' or ')})`;
}

export function expressionFor(ciToken) {
  if (typeof ciToken !== 'string' || !TOKEN_RE.test(ciToken)) {
    throw new Error(
      'OCR_CI_EDGE_TOKEN must be at least 16 characters of A-Z a-z 0-9 . _ ~ + / = -'
    );
  }
  return (
    `(http.host eq "${STG_HOST}") and ` +
    `(http.request.method in {${METHODS.map((m) => `"${m}"`).join(' ')}}) and ` +
    `any(http.request.headers["x-ocr-ci"][*] eq "${ciToken}") and ` +
    pathClause()
  );
}

/** The keys a skip rule's action_parameters may carry; anything else is dropped. */
const SKIP_KEYS = ['ruleset', 'phases', 'products', 'rules'];

export function buildRule(ciToken, skip = DEFAULT_SKIP) {
  const params = {};
  for (const k of SKIP_KEYS) if (skip && skip[k] !== undefined) params[k] = skip[k];
  return {
    ref: RULE_REF,
    description: 'OSE-1812: stg CI reads (X-OCR-CI) skip the challenge on every path CI reads',
    expression: expressionFor(ciToken),
    action: 'skip',
    action_parameters: params,
    logging: { enabled: true },
    enabled: true,
  };
}

// The positive form only: a rule that lets the token through, never one that
// excludes it (`not any(...)`).
const POSITIVE_CI = /any\(http\.request\.headers\["x-ocr-ci"\]\[\*\] eq "/i;
const NEGATED_CI = /not\s+any\(http\.request\.headers\["x-ocr-ci"\]/i;

/** A dashboard rule that already skips for X-OCR-CI (not ours). */
export function existingCiSkips(rules) {
  return (rules ?? []).filter((r) => {
    const expr = String(r.expression ?? '');
    return (
      r.ref !== RULE_REF &&
      r.action === 'skip' &&
      r.enabled !== false &&
      POSITIVE_CI.test(expr) &&
      !NEGATED_CI.test(expr)
    );
  });
}

/**
 * The skip set to use: the one X-OCR-CI skip rule's, when there is exactly one and
 * every rule before it is a skip (so ours, placed first, skips nothing it did not
 * reach already). Otherwise DEFAULT_SKIP.
 */
export function skipSetFrom(rules) {
  const list = (rules ?? []).filter((r) => r.ref !== RULE_REF);
  const found = existingCiSkips(list);
  if (found.length === 1 && found[0].action_parameters) {
    const at = list.indexOf(found[0]);
    if (list.slice(0, at).every((r) => r.action === 'skip')) {
      return { from: found[0], skip: found[0].action_parameters };
    }
  }
  return { from: null, skip: DEFAULT_SKIP };
}

/**
 * Another rule as it may be printed: never its expression or description (a
 * dashboard rule for X-OCR-CI holds the token), only what it is.
 */
export function describeRule(rule) {
  const expr = String(rule.expression ?? '');
  return {
    id: rule.id ?? null,
    ref: rule.ref ?? null,
    action: rule.action,
    enabled: rule.enabled !== false,
    mentionsXOcrCi: /x-ocr-ci/i.test(expr),
    ciPathsNamed: [
      ...EXACT_PATHS.filter((p) => expr.includes(`"${p}"`)),
      ...PATH_PREFIXES.filter((p) => expr.includes(`"${p}`)),
    ],
  };
}

/** Every line printed passes here: neither secret ever reaches the terminal. */
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

/** A ruleset answer that can be trusted: 200, success, an id and a rule list. */
function trustedRuleset(r) {
  return (
    r.status === 200 &&
    r.body?.success === true &&
    typeof r.body.result?.id === 'string' &&
    Array.isArray(r.body.result?.rules)
  );
}

/** Every other rule is still there, unchanged in id and order, and ours is first (or gone). */
export function othersKept(before, after, { removed = false } = {}) {
  const ids = (rules) => rules.filter((r) => r.ref !== RULE_REF).map((r) => r.id);
  const same = JSON.stringify(ids(before)) === JSON.stringify(ids(after));
  const oursFirst = after[0]?.ref === RULE_REF;
  const oursGone = !after.some((r) => r.ref === RULE_REF);
  return same && (removed ? oursGone : oursFirst);
}

/**
 * The whole run, injectable for tests. Returns the exit code.
 * Writes only with --apply, and only its own rule in the stg zone's custom rules.
 */
export async function run({ argv, env, fetchFn, log = console.log, err = console.error }) {
  const args = argv ?? [];
  const apply = args.includes('--apply');
  const remove = args.includes('--remove');
  const hostIdx = args.indexOf('--host');
  const host = hostIdx >= 0 ? args[hostIdx + 1] : STG_HOST;
  const token = env.CLOUDFLARE_API_TOKEN;
  const ciToken = env.OCR_CI_EDGE_TOKEN;
  const clean = redactor(token, ciToken);
  const out = (s) => log(clean(s));
  const fail = (s) => err(clean(s));

  if (host !== STG_HOST) {
    fail(`This rule is for ${STG_HOST} only; refusing ${host || '(none)'}.`);
    return 2;
  }
  if (!token) {
    fail('Need CLOUDFLARE_API_TOKEN in the environment.');
    return 2;
  }
  if (!remove) {
    try {
      expressionFor(ciToken);
    } catch (e) {
      fail(ciToken ? e.message : 'Need OCR_CI_EDGE_TOKEN in the environment (the value CI sends).');
      return 2;
    }
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
    const ours = before.find((r) => r.ref === RULE_REF);

    out(`Zone ${zone.name}: ${before.length} custom rule(s) now.`);
    for (const r of before) out(`  ${JSON.stringify(describeRule(r))}`);

    const base = `/zones/${zone.id}/rulesets/${rulesetId}/rules`;
    let call;
    if (remove) {
      if (!ours) {
        out(`${RULE_REF} is not there. Nothing to remove.`);
        return 0;
      }
      out(`Removing ${RULE_REF}; ${before.length - 1} rule(s) stay as they are.`);
      call = { path: `${base}/${ours.id}`, init: { method: 'DELETE' } };
    } else {
      const { from, skip } = skipSetFrom(before);
      out(
        from
          ? `Copying the skip set of the existing X-OCR-CI rule ${from.id}.`
          : 'No single X-OCR-CI skip rule to copy; using the default skip set.'
      );
      const rule = { ...buildRule(ciToken, skip), position: { index: 1 } };
      out(`${ours ? 'Updating' : 'Adding'} ${RULE_REF} as the first rule:`);
      out(JSON.stringify(rule, null, 2));
      call = ours
        ? { path: `${base}/${ours.id}`, init: { method: 'PATCH', body: JSON.stringify(rule) } }
        : { path: base, init: { method: 'POST', body: JSON.stringify(rule) } };
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
    if (!othersKept(before, res.body.result.rules, { removed: remove })) {
      fail('Written, but the rules read back are not as expected; check the dashboard now.');
      return 1;
    }
    out(
      remove
        ? 'Removed.'
        : 'Applied. Check it: gh workflow run stg-watch.yml (the edge job must be green), then gh workflow run stock-data-full.yml.'
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
