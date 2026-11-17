// vitest globals: true (vitest.config.ts). The script is ESM, so it is loaded with import().
// OSE-2115: the "Skip WAF for allowed endpoints" rule is pinned to stg and the
// Cloudflare Managed Ruleset is switched on, one rule at a time, dry run by
// default, never printing a rule expression (another rule holds the CI token).
let S;
beforeAll(async () => {
  S = await import('../../scripts/ci/cf-waf-scope-allowed-endpoints.mjs');
});

const CF_TOKEN = 'cf-token-xyz-0123';
const CI_TOKEN = 'ci-edge-token-0123456789abcdef';
const ZONE = { id: 'zone123', name: 'oursharedevents.com' };
const ENV = { CLOUDFLARE_API_TOKEN: CF_TOKEN };
const PATHS =
  '(http.request.uri.path eq "/health") or (starts_with(http.request.uri.path, "/api/"))';

const CI_RULE = {
  id: 'r-ci',
  description: 'CI skip: stg with X-OCR-CI',
  expression: `(http.host eq "stg.oursharedevents.com" and any(http.request.headers["x-ocr-ci"][*] eq "${CI_TOKEN}"))`,
  action: 'skip',
  action_parameters: { phases: ['http_request_sbfm'] },
  enabled: true,
};
const SKIP_RULE = {
  id: 'r-skip',
  description: 'Skip WAF for allowed endpoints',
  expression: PATHS,
  action: 'skip',
  action_parameters: { ruleset: 'current', phases: ['http_request_firewall_managed'] },
  enabled: true,
  version: '3',
  last_updated: '2026-04-06',
};
const BLOCK_RULE = {
  id: 'r-block',
  description: 'AI bots',
  expression: 'true',
  action: 'block',
  enabled: true,
};
const MANAGED = {
  id: 'm-managed',
  action: 'execute',
  action_parameters: { id: 'efb7b8c949ac4650a09736fc376e9aee', version: 'latest' },
  expression: 'true',
  enabled: false,
};
const OWASP = {
  id: 'm-owasp',
  action: 'execute',
  action_parameters: { id: '4814384a9e5d4991b9815dcfc25d2f1f', version: 'latest' },
  expression: 'true',
  enabled: true,
};

// A fake Cloudflare API with the custom and managed entry points.
// read: 'ok' | 'bad' ; write: 'ok' | 'refuse' | 'drop-other' | 'ignore'
function fakeCf({
  custom = [CI_RULE, SKIP_RULE, BLOCK_RULE],
  managed = [MANAGED, OWASP],
  read = 'ok',
  write = 'ok',
} = {}) {
  const calls = [];
  const sets = {
    rsC: custom.map((r) => ({ ...r })),
    rsM: managed.map((r) => ({ ...r })),
  };
  const json = (status, body) => ({ status, json: async () => body });
  const answer = (id) => json(200, { success: true, result: { id, rules: sets[id] } });
  const fetchFn = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    const p = u.pathname.replace('/client/v4', '');
    calls.push({ method, path: p, body });
    if (p === '/zones') return json(200, { success: true, result: [ZONE] });
    if (p.endsWith('/phases/http_request_firewall_custom/entrypoint')) {
      return read === 'ok' ? answer('rsC') : json(403, { success: false });
    }
    if (p.endsWith('/phases/http_request_firewall_managed/entrypoint')) return answer('rsM');
    const m = p.match(/\/rulesets\/(rsC|rsM)\/rules\/(.+)$/);
    if (m && method === 'PATCH') {
      const [, set, id] = m;
      if (write === 'refuse') return json(400, { success: false, errors: [{ message: 'no' }] });
      if (write !== 'ignore') sets[set] = sets[set].map((r) => (r.id === id ? { ...body, id } : r));
      if (write === 'drop-other') sets[set] = sets[set].filter((r) => r.id === id);
      return answer(set);
    }
    return json(404, { success: false });
  };
  return { fetchFn, calls, sets };
}

async function runWith(argv, cf = fakeCf(), env = ENV) {
  const lines = [];
  const code = await S.run({
    argv,
    env,
    fetchFn: cf.fetchFn,
    log: (s) => lines.push(s),
    err: (s) => lines.push(`ERR ${s}`),
  });
  return { code, text: lines.join('\n'), cf };
}

const writes = (cf) => cf.calls.filter((c) => c.method !== 'GET');

describe('OSE-2115: expression helpers', () => {
  test('pins an expression to the stg host, once', () => {
    const once = S.scopeExpression(PATHS);
    expect(once).toBe(`(http.host eq "stg.oursharedevents.com") and (${PATHS})`);
    expect(S.scopeExpression(once)).toBe(once);
    expect(S.isScoped(once)).toBe(true);
    expect(S.isScoped(PATHS)).toBe(false);
  });

  test('rollback gives back the original expression exactly', () => {
    expect(S.unscopeExpression(S.scopeExpression(PATHS))).toBe(PATHS);
  });

  test('refuses an empty expression', () => {
    expect(() => S.scopeExpression('')).toThrow();
  });

  test('a PATCH body drops server fields and keeps the rest', () => {
    const body = S.patchBody(SKIP_RULE, { expression: 'x' });
    expect(body).not.toHaveProperty('version');
    expect(body).not.toHaveProperty('last_updated');
    expect(body).not.toHaveProperty('id');
    expect(body.action_parameters).toEqual(SKIP_RULE.action_parameters);
    expect(body.expression).toBe('x');
  });
});

describe('OSE-2115: run', () => {
  test('dry run by default: reads, plans both changes, writes nothing', async () => {
    const { code, text, cf } = await runWith([]);
    expect(code).toBe(0);
    expect(writes(cf)).toHaveLength(0);
    expect(text).toContain('Rule r-skip: add (http.host eq "stg.oursharedevents.com")');
    expect(text).toContain('Rule m-managed: switch the Cloudflare Managed Ruleset on.');
    expect(text).toContain('Dry run. Nothing written.');
  });

  test('--apply pins the skip rule to stg and switches the managed ruleset on', async () => {
    const { code, cf } = await runWith(['--apply']);
    expect(code).toBe(0);
    expect(writes(cf).map((c) => c.path)).toEqual([
      '/zones/zone123/rulesets/rsC/rules/r-skip',
      '/zones/zone123/rulesets/rsM/rules/m-managed',
    ]);
    const skip = cf.sets.rsC.find((r) => r.id === 'r-skip');
    expect(skip.expression).toBe(S.scopeExpression(PATHS));
    expect(skip.action_parameters).toEqual(SKIP_RULE.action_parameters);
    expect(cf.sets.rsM.find((r) => r.id === 'm-managed').enabled).toBe(true);
    // Every other rule untouched.
    expect(cf.sets.rsC.find((r) => r.id === 'r-ci')).toEqual(CI_RULE);
    expect(cf.sets.rsC.find((r) => r.id === 'r-block')).toEqual(BLOCK_RULE);
    expect(cf.sets.rsM.find((r) => r.id === 'm-owasp')).toEqual(OWASP);
  });

  test('--only skip writes only the custom rule', async () => {
    const { code, cf } = await runWith(['--only', 'skip', '--apply']);
    expect(code).toBe(0);
    expect(writes(cf)).toHaveLength(1);
    expect(writes(cf)[0].path).toContain('/rsC/rules/r-skip');
  });

  test('--only managed writes only the managed rule', async () => {
    const { code, cf } = await runWith(['--only', 'managed', '--apply']);
    expect(code).toBe(0);
    expect(writes(cf)).toHaveLength(1);
    expect(writes(cf)[0].path).toContain('/rsM/rules/m-managed');
  });

  test('a second run has nothing to write', async () => {
    const cf = fakeCf();
    await runWith(['--apply'], cf);
    const before = writes(cf).length;
    const { code, text } = await runWith(['--apply'], cf);
    expect(code).toBe(0);
    expect(writes(cf).length).toBe(before);
    expect(text).toContain('Nothing to write.');
  });

  test('--rollback --apply puts both back as they were', async () => {
    const cf = fakeCf();
    await runWith(['--apply'], cf);
    const { code } = await runWith(['--rollback', '--apply'], cf);
    expect(code).toBe(0);
    expect(cf.sets.rsC.find((r) => r.id === 'r-skip').expression).toBe(PATHS);
    expect(cf.sets.rsM.find((r) => r.id === 'm-managed').enabled).toBe(false);
  });

  test('never prints a rule expression, the CI token or the API token', async () => {
    const { text } = await runWith(['--apply']);
    expect(text).not.toContain(CI_TOKEN);
    expect(text).not.toContain(CF_TOKEN);
    expect(text).not.toContain('starts_with');
  });

  // Failure cases.
  test('no token: refuses before any call', async () => {
    const cf = fakeCf();
    const { code } = await runWith(['--apply'], cf, {});
    expect(code).toBe(2);
    expect(cf.calls).toHaveLength(0);
  });

  test('a bad --only value is refused', async () => {
    const { code } = await runWith(['--only', 'everything']);
    expect(code).toBe(2);
  });

  test('an unreadable rule set stops the run and writes nothing', async () => {
    const { code, cf } = await runWith(['--apply'], fakeCf({ read: 'bad' }));
    expect(code).toBe(1);
    expect(writes(cf)).toHaveLength(0);
  });

  test('no matching skip rule: stops and writes nothing', async () => {
    const { code, text, cf } = await runWith(
      ['--apply'],
      fakeCf({ custom: [CI_RULE, BLOCK_RULE] })
    );
    expect(code).toBe(1);
    expect(text).toContain('found 0');
    expect(writes(cf)).toHaveLength(0);
  });

  test('two matching skip rules: stops and writes nothing', async () => {
    const twin = { ...SKIP_RULE, id: 'r-skip-2' };
    const { code, cf } = await runWith(['--apply'], fakeCf({ custom: [SKIP_RULE, twin] }));
    expect(code).toBe(1);
    expect(writes(cf)).toHaveLength(0);
  });

  test('a refused write fails the run', async () => {
    const { code, text } = await runWith(['--apply'], fakeCf({ write: 'refuse' }));
    expect(code).toBe(1);
    expect(text).toContain('Write failed (HTTP 400)');
  });

  test('a write that drops another rule fails the run', async () => {
    const { code, text } = await runWith(
      ['--only', 'skip', '--apply'],
      fakeCf({ write: 'drop-other' })
    );
    expect(code).toBe(1);
    expect(text).toContain('not as expected');
  });

  test('a write the API ignored fails the run', async () => {
    const { code } = await runWith(['--only', 'skip', '--apply'], fakeCf({ write: 'ignore' }));
    expect(code).toBe(1);
  });
});
