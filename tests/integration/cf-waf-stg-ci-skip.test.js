// vitest globals: true (vitest.config.ts). The scripts are ESM, so they are loaded with import().
// The stg CI skip rule (OSE-1812): covers every path CI reads and nothing more, is
// pinned to stg, never prints a secret, writes only its own rule (per-rule endpoints,
// never the whole set), and stops on any read or write it cannot trust.
let S;
let PROBE_PATHS;
beforeAll(async () => {
  S = await import('../../scripts/ci/cf-waf-stg-ci-skip.mjs');
  ({ PROBE_PATHS } = await import('../../scripts/stock/edge-probe.mjs'));
});

const TOKEN = 'ci-edge-token-0123456789abcdef';
const CF_TOKEN = 'cf-token-xyz-0123';
const ZONE = { id: 'zone123', name: 'oursharedevents.com' };
const ENV = { CLOUDFLARE_API_TOKEN: CF_TOKEN, OCR_CI_EDGE_TOKEN: TOKEN };

// A dashboard rule like the one on stg today: X-OCR-CI on /q/ only.
const DASH = {
  id: 'r-dash',
  description: `CI scan trace ${TOKEN}`,
  expression: `(http.host eq "stg.oursharedevents.com" and starts_with(http.request.uri.path, "/q/") and any(http.request.headers["x-ocr-ci"][*] eq "${TOKEN}"))`,
  action: 'skip',
  action_parameters: { ruleset: 'current', products: ['bic', 'securityLevel'] },
  enabled: true,
};
const OTHER = {
  id: 'r-other',
  description: 'block admin from abroad',
  expression: 'starts_with(http.request.uri.path, "/admin") and ip.geoip.country ne "US"',
  action: 'block',
  enabled: true,
};

// A fake Cloudflare API holding one custom-rules set.
// read: 'ok' | 'bad-json' | 'success-false' | 404 | 403
// write: 'ok' | 'refuse' | 'drop-other' | 'quote-token'
function fakeCf({ rules = [DASH, OTHER], read = 'ok', write = 'ok' } = {}) {
  const calls = [];
  let set = rules.map((r) => ({ ...r }));
  const json = (status, body) => ({ status, json: async () => body });
  const notJson = (status) => ({ status, json: async () => JSON.parse('<html>') });
  const answer = () => json(200, { success: true, result: { id: 'rs1', rules: set } });
  const fetchFn = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, path: u.pathname, body });
    const p = u.pathname.replace('/client/v4', '');
    if (p === '/zones') return json(200, { success: true, result: [ZONE] });
    if (p === '/zones/zone123/rulesets/phases/http_request_firewall_custom/entrypoint') {
      if (read === 'bad-json') return notJson(200);
      if (read === 'success-false') return json(200, { success: false });
      if (read !== 'ok') return json(read, { success: false });
      return answer();
    }
    if (p.startsWith('/zones/zone123/rulesets/rs1/rules')) {
      if (write === 'refuse') {
        return json(400, { success: false, errors: [{ message: 'not entitled' }] });
      }
      if (write === 'quote-token') {
        return json(400, { success: false, errors: [{ message: `bad: ${body?.expression}` }] });
      }
      const id = p.split('/rules/')[1];
      const { position, ...rule } = body ?? {}; // eslint-disable-line no-unused-vars
      if (method === 'POST') set = [{ ...rule, id: 'r-ours' }, ...set];
      if (method === 'PATCH') set = [{ ...rule, id }, ...set.filter((r) => r.id !== id)];
      if (method === 'DELETE') set = set.filter((r) => r.id !== id);
      if (write === 'drop-other') set = set.filter((r) => r.id !== 'r-other');
      return answer();
    }
    return json(404, { success: false });
  };
  return { fetchFn, calls };
}

async function runWith(argv, env = ENV, cf = fakeCf()) {
  const out = [];
  const code = await S.run({
    argv,
    env,
    fetchFn: cf.fetchFn,
    log: (s) => out.push(String(s)),
    err: (s) => out.push(String(s)),
  });
  return { code, out: out.join('\n'), calls: cf.calls };
}
const writes = (calls) => calls.filter((c) => c.method !== 'GET');

describe('the rule', () => {
  test('is exactly this expression: stg host, reads only, the exact token, CI paths', () => {
    expect(S.buildRule(TOKEN).expression).toBe(
      '(http.host eq "stg.oursharedevents.com") and ' +
        '(http.request.method in {"GET" "HEAD"}) and ' +
        `any(http.request.headers["x-ocr-ci"][*] eq "${TOKEN}") and ` +
        '(http.request.uri.path eq "/" or http.request.uri.path eq "/events" or ' +
        'starts_with(http.request.uri.path, "/q/") or starts_with(http.request.uri.path, "/s/") or ' +
        'starts_with(http.request.uri.path, "/events/") or ' +
        'starts_with(http.request.uri.path, "/brands/") or ' +
        'starts_with(http.request.uri.path, "/api/v2/uploads/"))'
    );
    const r = S.buildRule(TOKEN);
    expect(r.action).toBe('skip');
    expect(r.ref).toBe(S.RULE_REF);
    expect(r.logging).toEqual({ enabled: true });
  });

  test('covers every public path CI reads on stg', () => {
    const read = [
      ...PROBE_PATHS, // the edge probe's reads: /q/, /s/, /events/<id>, /?zip=
      '/q/qrt_abc', // check-full: the placement QR
      '/s/ABC234', // check-full: the short link
      '/events/evt_1', // check-full: the event page
      '/events?q=Oak%20Lawn', // check-full and stg-watch: the search
      '/api/v2/uploads/events/evt_1/1-art.png', // check-full: the art
      '/?zip=60453', // stg-watch: the landing zip search
      '/brands/root/calendar.ics', // T2 and T4: the brand calendar feed (OSE-2022)
      '/events/test-event-001/calendar.ics', // T2: the per-event calendar file
    ];
    for (const p of read) expect(S.pathCovered(p), p).toBe(true);
  });

  test('covers nothing beyond those paths', () => {
    for (const p of [
      '/admin',
      '/api/v2/admin/events',
      '/display/x',
      '/qx',
      '/eventsX',
      '/events.json',
      '/brands',
      '/brandsX/root/calendar.ics',
    ]) {
      expect(S.pathCovered(p), p).toBe(false);
    }
  });

  test('a token that could break out of the expression, or a short one, is refused', () => {
    expect(() => S.expressionFor('x" or true or "0123456789')).toThrow();
    expect(() => S.expressionFor('short')).toThrow();
    expect(() => S.expressionFor(undefined)).toThrow();
  });

  test('copies the skip set of the one X-OCR-CI rule only where placing ours first changes nothing', () => {
    expect(S.skipSetFrom([DASH, OTHER]).skip).toEqual(DASH.action_parameters);
    expect(S.skipSetFrom([OTHER]).skip).toEqual(S.DEFAULT_SKIP);
    // a block rule before it: ours first would skip that block rule too
    expect(S.skipSetFrom([OTHER, DASH]).skip).toEqual(S.DEFAULT_SKIP);
    // two candidates: no guessing
    expect(S.skipSetFrom([DASH, { ...DASH, id: 'r2' }]).skip).toEqual(S.DEFAULT_SKIP);
    // a disabled one, or one that excludes the token, does not count
    expect(S.skipSetFrom([{ ...DASH, enabled: false }]).skip).toEqual(S.DEFAULT_SKIP);
    const negated = {
      ...DASH,
      expression: `not any(http.request.headers["x-ocr-ci"][*] eq "${TOKEN}")`,
      action_parameters: { phases: ['http_ratelimit'] },
    };
    expect(S.skipSetFrom([negated]).skip).toEqual(S.DEFAULT_SKIP);
    // our own rule is never the source
    expect(S.skipSetFrom([S.buildRule(TOKEN, { ruleset: 'current' })]).skip).toEqual(
      S.DEFAULT_SKIP
    );
    // only skip keys are carried over
    expect(S.buildRule(TOKEN, { ruleset: 'current', evil: 1 }).action_parameters).toEqual({
      ruleset: 'current',
    });
  });

  test('what is printed of another rule holds neither its expression nor its description', () => {
    const d = S.describeRule(DASH);
    expect(JSON.stringify(d)).not.toContain(TOKEN);
    expect(d.mentionsXOcrCi).toBe(true);
    expect(d.ciPathsNamed).toEqual(['/q/']);
  });
});

describe('a run', () => {
  test('dry run reads, prints, and writes nothing; no secret is printed', async () => {
    const r = await runWith([]);
    expect(r.code).toBe(0);
    expect(writes(r.calls)).toHaveLength(0);
    expect(r.out).toContain('Dry run');
    expect(r.out).toContain('Copying the skip set');
    expect(r.out).not.toContain(TOKEN);
    expect(r.out).not.toContain(CF_TOKEN);
  });

  test('--apply adds only our rule, first, through the per-rule endpoint', async () => {
    const r = await runWith(['--apply']);
    expect(r.code).toBe(0);
    const w = writes(r.calls);
    expect(w).toHaveLength(1);
    expect(w[0].method).toBe('POST');
    expect(w[0].path).toBe('/client/v4/zones/zone123/rulesets/rs1/rules');
    expect(w[0].body.ref).toBe(S.RULE_REF);
    expect(w[0].body.position).toEqual({ index: 1 });
    expect(w[0].body.action_parameters).toEqual(DASH.action_parameters);
    expect(r.out).not.toContain(TOKEN);
  });

  test('a second --apply updates our rule in place', async () => {
    const ours = { ...S.buildRule(TOKEN), id: 'r-ours' };
    const r = await runWith(['--apply'], ENV, fakeCf({ rules: [ours, DASH, OTHER] }));
    expect(r.code).toBe(0);
    const w = writes(r.calls);
    expect(w.map((c) => `${c.method} ${c.path}`)).toEqual([
      'PATCH /client/v4/zones/zone123/rulesets/rs1/rules/r-ours',
    ]);
  });

  test('a read it cannot trust stops the run before any write', async () => {
    for (const read of ['bad-json', 'success-false', 404, 403]) {
      const r = await runWith(['--apply'], ENV, fakeCf({ read }));
      expect(r.code, String(read)).toBe(1);
      expect(writes(r.calls), String(read)).toHaveLength(0);
      expect(r.out).toContain('Nothing written');
    }
  });

  test('a refused write fails the run and says why, with no token in it', async () => {
    const r = await runWith(['--apply'], ENV, fakeCf({ write: 'refuse' }));
    expect(r.code).toBe(1);
    expect(r.out).toContain('not entitled');
    const q = await runWith(['--apply'], ENV, fakeCf({ write: 'quote-token' }));
    expect(q.code).toBe(1);
    expect(q.out).not.toContain(TOKEN);
  });

  test('a write that loses another rule fails the run', async () => {
    const r = await runWith(['--apply'], ENV, fakeCf({ write: 'drop-other' }));
    expect(r.code).toBe(1);
    expect(r.out).toContain('check the dashboard');
  });

  test('a fetch that throws is reported without the token', async () => {
    const thrower = async () => {
      throw new Error(`Headers.append: "Bearer ${CF_TOKEN}" is an invalid header value.`);
    };
    const r = await runWith(['--apply'], ENV, { fetchFn: thrower, calls: [] });
    expect(r.code).toBe(1);
    expect(r.out).not.toContain(CF_TOKEN);
  });

  test('any host but stg is refused before Cloudflare is called', async () => {
    for (const host of ['oursharedevents.com', 'www.oursharedevents.com', 'stg.evil.example', '']) {
      const r = await runWith(['--host', host, '--apply']);
      expect(r.code, host).toBe(2);
      expect(r.calls, host).toHaveLength(0);
    }
  });

  test('missing or unsafe secrets are refused before Cloudflare is called', async () => {
    for (const env of [
      { OCR_CI_EDGE_TOKEN: TOKEN },
      { CLOUDFLARE_API_TOKEN: CF_TOKEN },
      { CLOUDFLARE_API_TOKEN: CF_TOKEN, OCR_CI_EDGE_TOKEN: 'x" or true or "0123456789' },
    ]) {
      const r = await runWith(['--apply'], env);
      expect(r.code).toBe(2);
      expect(r.calls).toHaveLength(0);
      expect(r.out).not.toContain('x" or true');
    }
  });

  test('--remove --apply deletes only ours; with ours absent it writes nothing', async () => {
    const ours = { ...S.buildRule(TOKEN), id: 'r-ours' };
    const cf = fakeCf({ rules: [ours, DASH, OTHER] });
    const r = await runWith(['--remove', '--apply'], { CLOUDFLARE_API_TOKEN: CF_TOKEN }, cf);
    expect(r.code).toBe(0);
    expect(writes(r.calls).map((c) => `${c.method} ${c.path}`)).toEqual([
      'DELETE /client/v4/zones/zone123/rulesets/rs1/rules/r-ours',
    ]);
    const none = await runWith(['--remove', '--apply'], { CLOUDFLARE_API_TOKEN: CF_TOKEN });
    expect(none.code).toBe(0);
    expect(writes(none.calls)).toHaveLength(0);
  });
});
