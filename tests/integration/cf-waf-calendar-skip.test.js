// vitest globals: true (vitest.config.ts). The scripts are ESM, so they are loaded with import().
// The calendar edge rule (ADR-028, OSE-2023): it covers the two calendar address
// shapes and nothing else, needs no header, never prints the API token, writes only
// its own rule (per-rule endpoints), and stops on any read or write it cannot trust.
let S;
let CI;
beforeAll(async () => {
  S = await import('../../scripts/ci/cf-waf-calendar-skip.mjs');
  CI = await import('../../scripts/ci/cf-waf-stg-ci-skip.mjs');
});

const CF_TOKEN = 'cf-token-xyz-0123';
const ZONE = { id: 'zone123', name: 'oursharedevents.com' };
const ENV = { CLOUDFLARE_API_TOKEN: CF_TOKEN };

const OTHER = {
  id: 'r-other',
  description: 'block admin from abroad',
  expression: 'starts_with(http.request.uri.path, "/admin") and ip.geoip.country ne "US"',
  action: 'block',
  enabled: true,
};
// The CI skip rule as cf-waf-stg-ci-skip.mjs writes it, with its own skip set.
const CI_RULE = {
  id: 'r-ci',
  ref: 'ose-1812-stg-ci-skip',
  description: 'ci',
  expression: 'x',
  action: 'skip',
  action_parameters: { ruleset: 'current', products: ['bic', 'securityLevel'] },
  enabled: true,
};

// A fake Cloudflare API holding one custom-rules set.
// read: 'ok' | 'bad-json' | 'success-false' | 404 ; write: 'ok' | 'refuse' | 'drop-other'
function fakeCf({ rules = [CI_RULE, OTHER], read = 'ok', write = 'ok' } = {}) {
  const calls = [];
  let set = rules.map((r) => ({ ...r }));
  const json = (status, body) => ({ status, json: async () => body });
  const answer = () => json(200, { success: true, result: { id: 'rs1', rules: set } });
  const fetchFn = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, path: u.pathname, body, auth: init.headers?.Authorization });
    const p = u.pathname.replace('/client/v4', '');
    if (p === '/zones') return json(200, { success: true, result: [ZONE] });
    if (p === '/zones/zone123/rulesets/phases/http_request_firewall_custom/entrypoint') {
      if (read === 'bad-json') return { status: 200, json: async () => JSON.parse('<html>') };
      if (read === 'success-false') return json(200, { success: false });
      if (read !== 'ok') return json(read, { success: false });
      return answer();
    }
    if (p.startsWith('/zones/zone123/rulesets/rs1/rules')) {
      if (write === 'refuse') {
        return json(400, { success: false, errors: [{ message: 'not entitled' }] });
      }
      const id = p.split('/rules/')[1];
      const { position, ...rule } = body ?? {};
      if (method === 'POST') {
        set =
          position?.index === 1
            ? [{ ...rule, id: 'r-ours' }, ...set]
            : [...set, { ...rule, id: 'r-ours' }];
      }
      if (method === 'PATCH') set = set.map((r) => (r.id === id ? { ...rule, id } : r));
      if (method === 'DELETE') set = set.filter((r) => r.id !== id);
      if (write === 'drop-other') set = set.filter((r) => r.id !== 'r-other');
      return answer();
    }
    return json(404, { success: false });
  };
  return { fetchFn, calls, rules: () => set };
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
  return { code, out: out.join('\n'), calls: cf.calls, rules: cf.rules() };
}
const writes = (calls) => calls.filter((c) => c.method !== 'GET');

describe('the rule', () => {
  test('is exactly this expression on stg: the host, reads only, the two calendar shapes', () => {
    expect(S.buildRule('stg').expression).toBe(
      '(http.host in {"stg.oursharedevents.com"}) and ' +
        '(http.request.method in {"GET" "HEAD"}) and ' +
        '(starts_with(http.request.uri.path, "/events/") or starts_with(http.request.uri.path, "/brands/")) and ' +
        'ends_with(http.request.uri.path, "/calendar.ics")'
    );
    const r = S.buildRule('stg');
    expect(r.action).toBe('skip');
    expect(r.ref).toBe('ose-2023-calendar-skip-stg');
    expect(r.logging).toEqual({ enabled: true });
  });

  test('production names only the production hosts, under its own ref', () => {
    const r = S.buildRule('production');
    expect(r.expression).toContain(
      '(http.host in {"oursharedevents.com" "www.oursharedevents.com"})'
    );
    expect(r.expression).not.toContain('stg.');
    expect(r.ref).toBe('ose-2023-calendar-skip-production');
    expect(S.buildRule('stg').expression).not.toContain('"oursharedevents.com"');
  });

  test('needs no header and no token: an ordinary calendar app must get through', () => {
    for (const target of Object.keys(S.TARGETS)) {
      const expr = S.buildRule(target).expression;
      expect(expr).not.toMatch(/headers|x-ocr-ci|cookie|user_agent|ip\.src/i);
    }
  });

  test('covers the two calendar addresses', () => {
    for (const p of [
      '/brands/root/calendar.ics',
      '/brands/riverside-arts/calendar.ics',
      '/events/test-event-001/calendar.ics',
      '/events/evt_5efbe20d-f06e-4480-ae34-c65eeb4d05ea/calendar.ics',
      '/brands/root/calendar.ics?x=1',
    ]) {
      expect(S.pathCovered(p), p).toBe(true);
    }
  });

  test('covers nothing else', () => {
    for (const p of [
      '/',
      '/events',
      '/events/test-event-001',
      '/events/test-event-001/register',
      '/brands/root',
      '/calendar.ics',
      '/admin/calendar.ics',
      '/api/v2/admin/events/x/calendar.ics',
      '/q/abc/calendar.ics',
      '/s/abc/calendar.ics',
      '/brands/root/calendar.icsx',
      '/brands/root/calendar.ics/extra',
      '/eventsX/a/calendar.ics',
    ]) {
      expect(S.pathCovered(p), p).toBe(false);
    }
  });

  test('skips what the CI skip rule skips when that rule is on the zone, else the default set', () => {
    expect(S.skipSetFrom([CI_RULE, OTHER]).skip).toEqual(CI_RULE.action_parameters);
    expect(S.skipSetFrom([OTHER]).skip).toEqual(CI.DEFAULT_SKIP);
    expect(S.skipSetFrom([{ ...CI_RULE, enabled: false }]).skip).toEqual(CI.DEFAULT_SKIP);
  });
});

describe('the run', () => {
  test('dry run by default: reads, prints the rule, writes nothing', async () => {
    const r = await runWith([]);
    expect(r.code).toBe(0);
    expect(writes(r.calls)).toHaveLength(0);
    expect(r.out).toContain('Dry run. Nothing written.');
    expect(r.out).toContain('ose-2023-calendar-skip-stg');
    expect(r.out).toContain('Copying the skip set of the CI skip rule r-ci.');
  });

  test('--apply adds the rule first and keeps every other rule in order', async () => {
    const r = await runWith(['--apply']);
    expect(r.code).toBe(0);
    const w = writes(r.calls);
    expect(w).toHaveLength(1);
    expect(w[0].method).toBe('POST');
    expect(w[0].body.position).toEqual({ index: 1 });
    expect(r.rules.map((x) => x.id)).toEqual(['r-ours', 'r-ci', 'r-other']);
    expect(r.out).toContain('Applied.');
  });

  test('a second --apply updates the rule in place, and does not move it', async () => {
    const cf = fakeCf();
    await runWith(['--apply'], ENV, cf);
    // The CI script later puts its own rule first; ours is then second.
    const moved = fakeCf({ rules: [CI_RULE, { ...S.buildRule('stg'), id: 'r-ours' }, OTHER] });
    const r = await runWith(['--apply'], ENV, moved);
    expect(r.code).toBe(0);
    const w = writes(r.calls);
    expect(w).toHaveLength(1);
    expect(w[0].method).toBe('PATCH');
    expect(w[0].body.position).toBeUndefined();
    expect(r.rules.map((x) => x.id)).toEqual(['r-ci', 'r-ours', 'r-other']);
  });

  test('--remove --apply deletes only this rule', async () => {
    const cf = fakeCf({ rules: [{ ...S.buildRule('stg'), id: 'r-ours' }, CI_RULE, OTHER] });
    const r = await runWith(['--remove', '--apply'], ENV, cf);
    expect(r.code).toBe(0);
    expect(writes(r.calls)).toEqual([expect.objectContaining({ method: 'DELETE' })]);
    expect(r.rules.map((x) => x.id)).toEqual(['r-ci', 'r-other']);
  });

  test('--remove with nothing to remove writes nothing', async () => {
    const r = await runWith(['--remove', '--apply']);
    expect(r.code).toBe(0);
    expect(writes(r.calls)).toHaveLength(0);
  });

  test('stg and production are separate rules: applying one leaves the other alone', async () => {
    const cf = fakeCf({ rules: [{ ...S.buildRule('stg'), id: 'r-stg' }, OTHER] });
    const r = await runWith(['--host', 'production', '--apply'], ENV, cf);
    expect(r.code).toBe(0);
    expect(r.out).toContain('This is the PRODUCTION rule.');
    expect(r.rules.map((x) => x.ref ?? x.id)).toEqual([
      'ose-2023-calendar-skip-production',
      'ose-2023-calendar-skip-stg',
      'r-other',
    ]);
  });

  test('refuses any target but stg or production, before any request', async () => {
    for (const bad of ['example.com', 'stg.oursharedevents.com', '', undefined]) {
      const r = await runWith(['--host', bad].filter((x) => x !== undefined));
      expect(r.code, String(bad)).toBe(2);
      expect(r.calls, String(bad)).toHaveLength(0);
    }
  });

  test('needs the API token, and never prints it', async () => {
    const none = await runWith([], {});
    expect(none.code).toBe(2);
    expect(none.calls).toHaveLength(0);

    const r = await runWith(['--apply']);
    expect(r.out).not.toContain(CF_TOKEN);
    expect(r.calls.every((c) => c.auth === `Bearer ${CF_TOKEN}`)).toBe(true);
  });

  test.each(['bad-json', 'success-false', 404])(
    'a read it cannot trust (%s) stops it without writing',
    async (read) => {
      const r = await runWith(['--apply'], ENV, fakeCf({ read }));
      expect(r.code).toBe(1);
      expect(writes(r.calls)).toHaveLength(0);
      expect(r.out).toContain('Nothing written.');
    }
  );

  test('a refused write is a failure', async () => {
    const r = await runWith(['--apply'], ENV, fakeCf({ write: 'refuse' }));
    expect(r.code).toBe(1);
    expect(r.out).toContain('Write failed (HTTP 400)');
  });

  test('a write that loses another rule is reported, not called a success', async () => {
    const r = await runWith(['--apply'], ENV, fakeCf({ write: 'drop-other' }));
    expect(r.code).toBe(1);
    expect(r.out).toContain('check the dashboard now');
  });

  test("another rule's expression and description are never printed", async () => {
    const r = await runWith([]);
    expect(r.out).not.toContain(OTHER.expression);
    expect(r.out).not.toContain(OTHER.description);
  });
});
