/* eslint-disable security/detect-non-literal-fs-filename -- reads the repo's own stock scripts */
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');

let rd;
beforeAll(async () => {
  rd = await import('../../../scripts/stock/run-day.mjs');
});

const ROOT = path.join(__dirname, '../../..');
const TODAY = '2026-11-04';
const RUN = '200';
const ATTEMPT = '1';
const TODAY_NAME = `manifest-${TODAY}-${RUN}-${ATTEMPT}.json`;
const STALE_NAME = 'manifest-2026-11-03-100-1.json';
const OLDER_NAME = 'manifest-2026-11-02-90-1.json';
const NEWER_NAME = 'manifest-2026-11-05-300-1.json';
const NODES = { nodes: [{ id: 'a' }, { id: 'b' }] };
const TARGETS = JSON.parse(readFileSync(path.join(ROOT, 'stock/targets.json'), 'utf8'));
const P = TARGETS.perNode;
const MISSING = '✘ [ERROR] The specified key does not exist.';

// A day's manifest: one event, sponsor, poster and upload per node, one placement to accept.
const manifestOf = (date, tag, nodes) => ({
  date,
  items: nodes.flatMap((n) => [
    { kind: 'sponsor', id: `${tag}_sp_${n}`, node: n, tier: 'premium' },
    { kind: 'event', id: `${tag}_evt_${n}`, node: n },
    { kind: 'poster', id: `${tag}_pd_${n}`, node: n },
    { kind: 'placement', id: `${tag}_pl_${n}`, node: n },
    { kind: 'upload', id: `events/${tag}_evt_${n}/art.png`, node: n },
  ]),
  qr: [],
  acceptSql: nodes.map((n) => `${tag}_pl_${n}`),
  short: {},
  warnings: [],
});

// The R2 bucket, a scratch file system and a wrangler that acts on both.
function world({ index, objects = {}, fail = () => false, raw } = {}) {
  const r2 = new Map(Object.entries(objects).map(([k, v]) => [k, JSON.stringify(v)]));
  if (raw !== undefined) r2.set(rd.INDEX_KEY, raw);
  else if (index !== undefined) r2.set(rd.INDEX_KEY, JSON.stringify({ manifests: index }));
  const files = new Map();
  const fs = {
    writeFileSync: (p, t) => files.set(p, String(t)),
    appendFileSync: (p, t) => files.set(p, (files.get(p) || '') + String(t)),
    readFileSync: (p) => {
      if (!files.has(p)) throw new Error(`ENOENT ${p}`);
      return files.get(p);
    },
    existsSync: (p) => files.has(p),
    mkdirSync: () => {},
  };
  const calls = [];
  const order = [];
  const wrangler = async (args) => {
    const fileAt = args.indexOf('--file');
    const file = fileAt >= 0 ? args[fileAt + 1] : null;
    const call = { args, sql: args[0] === 'd1' ? files.get(file) : null };
    calls.push(call);
    order.push(args[0] === 'd1' ? `d1:${call.sql.split(' ')[0]}` : `r2:${args[2]}`);
    if (fail(call)) return { code: 1, stdout: '', stderr: 'boom' };
    if (args[0] === 'r2') {
      const key = args[3].slice(`${rd.R2_BUCKET}/`.length);
      if (args[2] === 'get') {
        if (!r2.has(key)) return { code: 1, stdout: '', stderr: MISSING };
        files.set(file, r2.get(key));
      } else if (args[2] === 'put') {
        r2.set(key, files.get(file));
      } else if (args[2] === 'delete') {
        r2.delete(key);
      }
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  const cloud = rd.makeCloud({ wrangler, fs, tmpDir: '/tmp' });
  const liveIndex = () => JSON.parse(r2.get(rd.INDEX_KEY)).manifests;
  const sqls = () => calls.filter((c) => c.sql !== null).map((c) => c.sql);
  const deletes = () => calls.filter((c) => c.args[2] === 'delete').map((c) => c.args[3]);
  return { r2, files, fs, calls, order, wrangler, cloud, liveIndex, sqls, deletes };
}

// A checkNodes that passes the named nodes and records when it ran.
const checker = (passing, order) => async () => {
  if (order) order.push('check');
  return Object.fromEntries(
    NODES.nodes.map((n) => [
      n.id,
      {
        pass: passing.includes(n.id),
        count: passing.includes(n.id) ? P : P - 3,
        expected: P,
        totalListed: P + 2,
        reasons: passing.includes(n.id) ? [] : [`count:${P - 3}/${P}`],
      },
    ])
  );
};

const swap = (w, extra = {}) =>
  rd.checkSwap({
    manifest: manifestOf(TODAY, 't', ['a', 'b']),
    nodes: NODES,
    targets: TARGETS,
    today: TODAY,
    runId: RUN,
    runAttempt: ATTEMPT,
    cloud: w.cloud,
    checkNodes: checker(['a', 'b'], w.order),
    ...extra,
  });

// Every wrangler call made by any test in this file, for the target check at the end.
const allCalls = [];

describe('swap per node', () => {
  test('a passing node purges only stale manifests, never today or a newer one', async () => {
    const w = world({
      index: [STALE_NAME, NEWER_NAME],
      objects: {
        [`stock/${STALE_NAME}`]: manifestOf('2026-11-03', 'y', ['a', 'b']),
        [`stock/${NEWER_NAME}`]: manifestOf('2026-11-05', 'n', ['a', 'b']),
      },
    });
    const report = await swap(w);
    allCalls.push(...w.calls);
    const purged = w
      .sqls()
      .filter((s) => s.startsWith('DELETE'))
      .join('\n');
    expect(purged).toContain("'y_evt_a'");
    expect(purged).toContain("'y_evt_b'");
    expect(purged).not.toMatch(/'t_/);
    expect(purged).not.toMatch(/'n_/);
    expect(w.deletes().sort()).toEqual([
      `${rd.R2_BUCKET}/events/y_evt_a/art.png`,
      `${rd.R2_BUCKET}/events/y_evt_b/art.png`,
    ]);
    // the stale one is fully purged, so it leaves; the newer one is never touched
    expect(w.liveIndex()).toEqual([NEWER_NAME, TODAY_NAME]);
    expect(w.r2.has(`stock/${STALE_NAME}`)).toBe(true); // the manifest object itself stays
    expect(JSON.parse(w.r2.get(`stock/${TODAY_NAME}`)).date).toBe(TODAY);
    expect(report.exitCode).toBe(0);
  });

  test('a failing node purges only today’s ids for that node, so yesterday’s stay', async () => {
    const w = world({
      index: [STALE_NAME],
      objects: { [`stock/${STALE_NAME}`]: manifestOf('2026-11-03', 'y', ['a', 'b']) },
    });
    const report = await swap(w, { checkNodes: checker(['a'], w.order) });
    allCalls.push(...w.calls);
    const purged = w.sqls().filter((s) => s.startsWith('DELETE'));
    expect(purged).toHaveLength(2);
    expect(purged.join('\n')).toContain("'y_evt_a'");
    expect(purged.join('\n')).toContain("'t_evt_b'");
    expect(purged.join('\n')).not.toContain("'y_evt_b'");
    expect(purged.join('\n')).not.toContain("'t_evt_a'");
    // yesterday still holds b, today still holds a: both stay listed
    expect(w.liveIndex()).toEqual([STALE_NAME, TODAY_NAME]);
    expect(report.results.b.pass).toBe(false);
    expect(report.exitCode).toBe(1);
  });

  test('a purge failure keeps the name in the index and exits non-zero', async () => {
    const w = world({
      index: [STALE_NAME],
      objects: { [`stock/${STALE_NAME}`]: manifestOf('2026-11-03', 'y', ['a', 'b']) },
      fail: (c) => c.sql !== null && c.sql.includes("'y_evt_b'"),
    });
    const report = await swap(w);
    allCalls.push(...w.calls);
    expect(report.purges.filter((p) => !p.ok)).toEqual([
      { name: STALE_NAME, node: 'b', ok: false, error: 'wrangler d1 execute failed (exit 1)' },
    ]);
    expect(w.liveIndex()).toEqual([STALE_NAME, TODAY_NAME]);
    expect(report.exitCode).toBe(1);
  });

  test('an R2 delete failure also keeps the name', async () => {
    const w = world({
      index: [STALE_NAME],
      objects: { [`stock/${STALE_NAME}`]: manifestOf('2026-11-03', 'y', ['a', 'b']) },
      fail: (c) => c.args[2] === 'delete' && c.args[3].includes('y_evt_a'),
    });
    const report = await swap(w);
    allCalls.push(...w.calls);
    expect(w.liveIndex()).toContain(STALE_NAME);
    expect(report.exitCode).toBe(1);
  });

  test('an empty purge SQL skips wrangler', async () => {
    const w = world({
      index: [STALE_NAME],
      objects: { [`stock/${STALE_NAME}`]: { date: '2026-11-03', items: [], acceptSql: [] } },
    });
    const report = await swap(w, { manifest: { ...manifestOf(TODAY, 't', []), items: [] } });
    allCalls.push(...w.calls);
    expect(w.calls.filter((c) => c.args[0] === 'd1')).toEqual([]);
    expect(w.sqls().every((s) => s.trim() !== '')).toBe(true);
    // nothing of either manifest is live, so both leave the index
    expect(w.liveIndex()).toEqual([]);
    expect(report.exitCode).toBe(0);
  });

  test('acceptSql runs before the check, as the only UPDATE', async () => {
    const w = world({ index: [] });
    await swap(w);
    allCalls.push(...w.calls);
    expect(w.order.indexOf('d1:UPDATE')).toBeGreaterThanOrEqual(0);
    expect(w.order.indexOf('d1:UPDATE')).toBeLessThan(w.order.indexOf('check'));
    expect(w.sqls()[0]).toBe(
      "UPDATE sponsor_placement SET sponsor_accepted = 1, organizer_accepted = 1 WHERE id IN ('t_pl_a', 't_pl_b');\n"
    );
  });

  test('a placement id outside the allowlist is refused: no UPDATE, every node fails', async () => {
    const w = world({ index: [] });
    const manifest = manifestOf(TODAY, 't', ['a', 'b']);
    manifest.acceptSql = ["x'); DROP TABLE events; --"];
    const report = await swap(w, { manifest });
    allCalls.push(...w.calls);
    expect(w.sqls().some((s) => s.startsWith('UPDATE'))).toBe(false);
    expect(w.order).not.toContain('check');
    expect(Object.values(report.results).every((r) => !r.pass)).toBe(true);
    expect(report.exitCode).toBe(1);
  });

  test('a build failure saves the partial manifest and purges all of its nodes', async () => {
    const w = world({
      index: [STALE_NAME],
      objects: { [`stock/${STALE_NAME}`]: manifestOf('2026-11-03', 'y', ['a', 'b']) },
    });
    const partial = manifestOf(TODAY, 't', ['a']);
    const report = await swap(w, { manifest: partial, buildFailed: true });
    allCalls.push(...w.calls);
    expect(w.r2.has(`stock/${TODAY_NAME}`)).toBe(true);
    expect(w.order).not.toContain('check');
    expect(w.sqls().some((s) => s.startsWith('UPDATE'))).toBe(false);
    const purged = w.sqls().join('\n');
    expect(purged).toContain("'t_evt_a'");
    expect(purged).not.toContain("'y_");
    expect(w.liveIndex()).toEqual([STALE_NAME]);
    expect(report.exitCode).toBe(1);
  });

  test('prefixed R2 keys in the index are stripped to bare names', async () => {
    expect(rd.bareManifestName(`stock/${STALE_NAME}`)).toBe(STALE_NAME);
    expect(rd.bareManifestName(STALE_NAME)).toBe(STALE_NAME);
    const w = world({
      index: [`stock/${STALE_NAME}`],
      objects: { [`stock/${STALE_NAME}`]: manifestOf('2026-11-03', 'y', ['a', 'b']) },
    });
    await swap(w);
    allCalls.push(...w.calls);
    expect(w.sqls().join('\n')).toContain("'y_evt_a'");
    expect(w.liveIndex()).toEqual([TODAY_NAME]);
  });

  test('a missing index is an empty list; an unreadable one is never overwritten', async () => {
    const fresh = world();
    const ok = await swap(fresh);
    allCalls.push(...fresh.calls);
    expect(fresh.liveIndex()).toEqual([TODAY_NAME]);
    expect(ok.exitCode).toBe(0);

    const garbled = world({ raw: '{"manifests": "oops"}' });
    const bad = await swap(garbled);
    allCalls.push(...garbled.calls);
    expect(garbled.r2.get(rd.INDEX_KEY)).toBe('{"manifests": "oops"}');
    expect(garbled.sqls().join('\n')).toContain("'t_evt_a'"); // today purged, nothing orphaned
    expect(bad.exitCode).toBe(1);

    const denied = world({ fail: (c) => c.args[2] === 'get' });
    const red = await swap(denied);
    allCalls.push(...denied.calls);
    expect(denied.calls.some((c) => c.args[2] === 'put')).toBe(false);
    expect(red.exitCode).toBe(1);
  });

  test('a stale manifest that is listed but missing or garbled stays listed and turns the run red', async () => {
    const w = world({
      index: [OLDER_NAME, STALE_NAME],
      objects: { [`stock/${OLDER_NAME}`]: { date: '2026-11-02' } },
    });
    const report = await swap(w);
    allCalls.push(...w.calls);
    expect(w.liveIndex()).toEqual([OLDER_NAME, STALE_NAME, TODAY_NAME]);
    expect(report.exitCode).toBe(1);
  });
});

describe('wrangler target', () => {
  test('every wrangler invocation names --env staging-full and runs remote', () => {
    expect(allCalls.length).toBeGreaterThan(20);
    for (const { args } of allCalls) {
      const line = args.join(' ');
      expect(line).toContain('--env staging-full');
      expect(`${line} `).not.toContain('--env staging ');
      expect(line).not.toContain('--env production');
      expect(args).toContain('--remote');
      if (args[0] === 'd1') expect(args[2]).toBe('ocr-db-staging-full');
      else expect(args[3].startsWith('ose-uploads-staging-full/')).toBe(true);
    }
  });

  test('the runner refuses a command aimed anywhere else', async () => {
    const ran = [];
    const cloud = rd.makeCloud({
      wrangler: async (a) => {
        ran.push(a);
        return { code: 0 };
      },
      fs: { writeFileSync() {}, readFileSync: () => '' },
      tmpDir: '/tmp',
    });
    await expect(cloud.d1File('SELECT 1;')).resolves.toBeUndefined();
    for (const bad of [
      ['d1', 'execute', 'x', '--env', 'staging', '--remote'],
      ['d1', 'execute', 'x', '--env', 'production', '--remote'],
      ['d1', 'execute', 'x', '--remote'],
      ['d1', 'execute', 'x', '--env', 'staging-full', '-e', 'staging', '--remote'],
      ['d1', 'execute', 'x', '--env', 'staging-full'],
    ]) {
      expect(() => rd.assertStagingFull(bad)).toThrow();
    }
    expect(ran).toHaveLength(1);
  });

  test('UPDATE appears once in the stock scripts and workflow: the acceptance SQL', () => {
    const files = [
      ...readdirSync(path.join(ROOT, 'scripts/stock')).map((f) => `scripts/stock/${f}`),
      '.github/workflows/stock-data-full.yml',
    ];
    const hits = [];
    for (const rel of files) {
      const text = readFileSync(path.join(ROOT, rel), 'utf8');
      for (const m of text.matchAll(/\bUPDATE\s+\w+\s+SET\b/gi)) hits.push(`${rel}: ${m[0]}`);
    }
    expect(hits).toEqual(['scripts/stock/run-day.mjs: UPDATE sponsor_placement SET']);
    // and every SQL the swap sent is a DELETE or that one UPDATE
    const sent = allCalls.filter((c) => c.sql !== null).map((c) => c.sql);
    for (const sql of sent) {
      for (const stmt of sql.split(';\n').filter((s) => s.trim())) {
        expect(stmt).toMatch(
          /^(DELETE FROM [a-z_]+ WHERE [a-z_]+ IN \(|UPDATE sponsor_placement SET sponsor_accepted = 1, organizer_accepted = 1 WHERE id IN \()/
        );
      }
    }
  });
});

describe('the site and the secrets', () => {
  const ENV = {
    STG_FULL_ADMIN_KEY: 'admin-key-value-1',
    STG_FULL_ACCESS_CLIENT_ID: 'access-id-value-2',
    STG_FULL_ACCESS_CLIENT_SECRET: 'access-secret-value-3',
    INSTAGRAM_ACCESS_TOKEN: 'ig-token-value-4',
    GITHUB_RUN_ID: RUN,
    GITHUB_RUN_ATTEMPT: ATTEMPT,
  };

  test('public reads send only the Access headers, never the Bearer, never a redirect', async () => {
    const seen = [];
    const fetchPublic = rd.fetchPublicFrom(ENV, async (url, init) => {
      seen.push({ url, init });
      return { status: 200 };
    });
    await fetchPublic('https://stg-full.oursharedevents.com/events/x', { method: 'GET' });
    expect(seen[0].init.redirect).toBe('manual');
    expect(seen[0].init.headers).toEqual({
      'CF-Access-Client-Id': ENV.STG_FULL_ACCESS_CLIENT_ID,
      'CF-Access-Client-Secret': ENV.STG_FULL_ACCESS_CLIENT_SECRET,
    });
    expect(JSON.stringify(seen)).not.toContain(ENV.STG_FULL_ADMIN_KEY);
    expect(() => fetchPublic('https://evil.example/x')).toThrow();
  });

  test('each secret is masked through a workflow command, and only that way', () => {
    const out = [];
    rd.maskSecrets(ENV, (s) => out.push(s));
    expect(out).toEqual([
      `::add-mask::${ENV.STG_FULL_ADMIN_KEY}\n`,
      `::add-mask::${ENV.STG_FULL_ACCESS_CLIENT_ID}\n`,
      `::add-mask::${ENV.STG_FULL_ACCESS_CLIENT_SECRET}\n`,
      `::add-mask::${ENV.INSTAGRAM_ACCESS_TOKEN}\n`,
    ]);
  });

  test('check-swap writes one summary row per node, with no secret in it', async () => {
    const w = world({ index: [] });
    const outDir = '/out';
    const manifest = manifestOf(TODAY, 't', ['blue-island']);
    manifest.warnings = ['no shortcode for t_evt_blue-island'];
    w.fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest));
    w.fs.writeFileSync(
      path.join(outDir, 'build-notes.json'),
      JSON.stringify({ ok: true, instagramWarning: 'IG note', tokenWarning: 'token note' })
    );
    const nodes = JSON.parse(readFileSync(path.join(ROOT, 'stock/nodes.json'), 'utf8')).nodes;
    const code = await rd.runCheckSwap({
      env: { ...ENV, BUILD_RESULT: 'success', GITHUB_STEP_SUMMARY: '/summary.md' },
      fs: w.fs,
      fetch: async () => ({ status: 200 }),
      wrangler: w.wrangler,
      now: () => new Date('2026-11-04T12:00:00Z'),
      outDir,
      tmpDir: '/tmp',
      checkNodes: async () =>
        Object.fromEntries(
          nodes.map((n) => [
            n.id,
            {
              pass: n.id !== 'beverly',
              count: n.id === 'beverly' ? P - 3 : P,
              expected: P,
              totalListed: P + 1,
              reasons: n.id === 'beverly' ? [`count:${P - 3}/${P}`] : [],
            },
          ])
        ),
      log: () => {},
    });
    allCalls.push(...w.calls);
    const summary = w.files.get('/summary.md');
    expect(code).toBe(1);
    expect(summary).toContain(
      '| Node | Expected (perNode) | Stock listed | Total listed | Result | Reasons |'
    );
    for (const n of nodes) expect(summary).toContain(`| ${n.id} | ${P} | `);
    expect(summary).toContain(
      `| beverly | ${P} | ${P - 3} | ${P + 1} | FAIL | count:${P - 3}/${P} |`
    );
    expect(summary).toContain('IG note');
    expect(summary).toContain('token note');
    expect(summary).toContain('no shortcode for t_evt_blue-island');
    for (const v of Object.values(ENV).filter((v) => v !== RUN && v !== ATTEMPT)) {
      expect(summary).not.toContain(v);
    }
    expect(summary).not.toMatch(/https?:\/\//);
  });

  test('check-swap treats a build that did not say ok as failed', async () => {
    const w = world({ index: [] });
    w.fs.writeFileSync(
      path.join('/out', 'manifest.json'),
      JSON.stringify(manifestOf(TODAY, 't', ['a']))
    );
    let checked = false;
    const code = await rd.runCheckSwap({
      env: { ...ENV, BUILD_RESULT: 'failure' },
      fs: w.fs,
      fetch: async () => ({ status: 200 }),
      wrangler: w.wrangler,
      now: () => new Date('2026-11-04T12:00:00Z'),
      outDir: '/out',
      tmpDir: '/tmp',
      checkNodes: async () => {
        checked = true;
        return {};
      },
      log: () => {},
    });
    allCalls.push(...w.calls);
    expect(checked).toBe(false);
    expect(w.sqls().join('\n')).toContain("'t_evt_a'");
    expect(code).toBe(1);
  });
});

describe('the search prompt', () => {
  test('fills perNode + 3, the window and the catalog, and leaves nothing unfilled', () => {
    const template = readFileSync(path.join(ROOT, 'stock/search-prompt.md'), 'utf8');
    const perNode = JSON.parse(readFileSync(path.join(ROOT, 'stock/targets.json'), 'utf8')).perNode;
    const nodes = JSON.parse(readFileSync(path.join(ROOT, 'stock/nodes.json'), 'utf8')).nodes;
    const out = rd.renderPrompt(template, {
      today: TODAY,
      perNode,
      catalog: [{ id: 'trivia', name: 'Trivia', category: 'SOCIAL' }],
      nodes,
    });
    expect(out).toContain(`once you have ${perNode + 3} good finds`);
    expect(out).toContain('2026-11-04');
    expect(out).toContain('2027-02-02'); // today + 90
    expect(out).toContain('{"id":"trivia","name":"Trivia","category":"SOCIAL"}');
    expect(out).not.toMatch(/\{\{[A-Z_]+\}\}/);
    expect(() =>
      rd.renderPrompt('{{NOPE}}', { today: TODAY, perNode, catalog: [], nodes })
    ).toThrow();
  });

  test('the places come from stock/nodes.json, in its order, and none is written in the template', () => {
    const template = readFileSync(path.join(ROOT, 'stock/search-prompt.md'), 'utf8');
    const nodes = JSON.parse(readFileSync(path.join(ROOT, 'stock/nodes.json'), 'utf8')).nodes;
    for (const n of nodes) {
      expect(template).not.toContain(n.id);
      for (const zip of n.zips) expect(template).not.toContain(zip);
    }
    const out = rd.renderPrompt(template, { today: TODAY, perNode: P, catalog: [], nodes });
    const lines = nodes.map(
      (n, i) => `${i + 1}. ${n.name} (node \`${n.id}\`, zip ${n.zips.join(', ')})`
    );
    for (const line of lines) expect(out).toContain(line);
    const at = lines.map((line) => out.indexOf(line));
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // a node added to nodes.json reaches the prompt with no template edit
    const more = [...nodes, { id: 'new-place', name: 'New Place', zips: ['60999'] }];
    expect(
      rd.renderPrompt(template, { today: TODAY, perNode: P, catalog: [], nodes: more })
    ).toContain(`${nodes.length + 1}. New Place (node \`new-place\`, zip 60999)`);
  });

  test('prepare-search writes to STOCK_PREP_DIR, outside the checkout', async () => {
    const w = world();
    const code = await rd.runPrepareSearch({
      env: {
        STG_FULL_ADMIN_KEY: 'k',
        STG_FULL_ACCESS_CLIENT_ID: 'i',
        STG_FULL_ACCESS_CLIENT_SECRET: 's',
        STOCK_PREP_DIR: path.join('/runner-temp', 'stock-prep'),
      },
      fs: w.fs,
      fetch: async () => ({
        status: 200,
        ok: true,
        json: async () => ({
          categories: [{ code: 'SOCIAL', types: [{ id: 'trivia', name: 'Trivia' }] }],
        }),
      }),
      now: () => new Date('2026-11-04T12:00:00Z'),
      outDir: path.join('/out'),
    });
    expect(code).toBe(0);
    expect(w.files.has(path.join('/runner-temp', 'stock-prep', 'search-prompt.txt'))).toBe(true);
    expect([...w.files.keys()].some((k) => k.startsWith(path.join('/out')))).toBe(false);
  });
});

describe('fix round 1: re-runs, interrupted builds, unknown nodes', () => {
  test('a re-run (same run id, attempt 2) makes attempt 1 stale and purges it', async () => {
    const first = `manifest-${TODAY}-${RUN}-1.json`;
    const w = world({
      index: [first],
      objects: { [`stock/${first}`]: manifestOf(TODAY, 'r1', ['a', 'b']) },
    });
    const report = await swap(w, { runAttempt: '2' });
    allCalls.push(...w.calls);
    expect(report.todayName).toBe(`manifest-${TODAY}-${RUN}-2.json`);
    const purged = w.sqls().join('\n');
    expect(purged).toContain("'r1_evt_a'");
    expect(purged).toContain("'r1_evt_b'");
    expect(w.liveIndex()).toEqual([`manifest-${TODAY}-${RUN}-2.json`]);
    expect(JSON.parse(w.r2.get(`stock/${first}`)).items[0].id).toMatch(/^r1_/); // never overwritten
    expect(report.exitCode).toBe(0);
  });

  test('an existing manifest object under today’s name is never overwritten', async () => {
    const w = world({
      index: [],
      objects: { [`stock/${TODAY_NAME}`]: manifestOf(TODAY, 'other', ['a']) },
    });
    const report = await swap(w);
    allCalls.push(...w.calls);
    expect(JSON.parse(w.r2.get(`stock/${TODAY_NAME}`)).items[0].id).toMatch(/^other_/);
    expect(w.calls.some((c) => c.args[2] === 'put')).toBe(false);
    expect(w.order).not.toContain('check');
    expect(w.sqls().join('\n')).toContain("'t_evt_a'"); // this run's rows go, the other's stay
    expect(w.sqls().join('\n')).not.toContain("'other_");
    expect(report.problems.join('\n')).toMatch(/never overwritten/);
    expect(report.exitCode).toBe(1);
  });

  test('a listed manifest recording a node not in nodes.json turns the run red, naming it', async () => {
    const w = world({
      index: [STALE_NAME],
      objects: { [`stock/${STALE_NAME}`]: manifestOf('2026-11-03', 'y', ['a', 'gone-place']) },
    });
    const report = await swap(w);
    allCalls.push(...w.calls);
    expect(report.problems.join('\n')).toContain(
      `${STALE_NAME} records node(s) not in stock/nodes.json: gone-place`
    );
    expect(w.liveIndex()).toContain(STALE_NAME);
    expect(report.exitCode).toBe(1);
  });

  test('a purge that fails after the manifest could not be saved names the artifact as the only record', async () => {
    const w = world({
      index: [],
      fail: (c) => c.args[2] === 'put' || (c.sql !== null && c.sql.includes("'t_evt_b'")),
    });
    const report = await swap(w);
    allCalls.push(...w.calls);
    const summary = rd.renderSummary({
      report,
      nodes: NODES,
      targets: TARGETS,
      manifest: manifestOf(TODAY, 't', ['a', 'b']),
      notes: { ok: true },
    });
    expect(summary).toContain(
      `rows of ${TODAY_NAME} for b are still live and recorded only in this run's stock-manifest artifact; purge them by hand`
    );
    expect(report.exitCode).toBe(1);
  });

  test('with no manifest at all, check-swap says rows may need a manual purge, and is red', async () => {
    const w = world({ index: [] });
    const logs = [];
    const code = await rd.runCheckSwap({
      env: { GITHUB_STEP_SUMMARY: '/summary.md' },
      fs: w.fs,
      fetch: async () => ({ status: 200 }),
      wrangler: w.wrangler,
      now: () => new Date('2026-11-04T12:00:00Z'),
      outDir: path.join('/out'),
      tmpDir: '/tmp',
      log: (l) => logs.push(l),
    });
    expect(code).toBe(1);
    const text = `${logs.join('\n')}\n${w.files.get('/summary.md')}`;
    expect(text).toContain(
      'No manifest was saved; rows created by an interrupted build may need a manual purge.'
    );
    expect(text).not.toMatch(/nothing was (created|recorded)/i);
    expect(w.calls).toEqual([]);
  });

  test('a build killed mid-run leaves a manifest file with what it created', async () => {
    const w = world();
    const outDir = path.join('/out');
    w.fs.writeFileSync(path.join(outDir, 'accepted.json'), '[]');
    w.fs.writeFileSync(
      path.join(outDir, 'businesses.json'),
      JSON.stringify([
        { name: 'One', address: '1 Main St', node: 'beverly', anchor: true },
        { name: 'Two', address: '2 Main St', node: 'beverly', anchor: false },
        { name: 'Three', address: '3 Main St', node: 'beverly', anchor: false },
      ])
    );
    let sponsors = 0;
    let stalled;
    const hung = new Promise((resolve) => (stalled = resolve));
    rd.runBuild({
      env: {
        STG_FULL_ADMIN_KEY: 'k',
        STG_FULL_ACCESS_CLIENT_ID: 'i',
        STG_FULL_ACCESS_CLIENT_SECRET: 's',
      },
      fs: w.fs,
      fetch: (url) => {
        if (String(url).endsWith('/event-types')) {
          return Promise.resolve({
            status: 200,
            ok: true,
            json: async () => ({ categories: [{ code: 'SOCIAL', types: [{ id: 'trivia' }] }] }),
          });
        }
        sponsors += 1;
        if (sponsors === 3) {
          stalled();
          return new Promise(() => {}); // the process is killed here: nothing after runs
        }
        return Promise.resolve({
          status: 201,
          ok: true,
          json: async () => ({ id: `sp_${sponsors}` }),
        });
      },
      now: () => new Date('2026-11-04T12:00:00Z'),
      outDir,
    });
    await hung;
    const saved = JSON.parse(w.files.get(path.join(outDir, 'manifest.json')));
    expect(saved.items.map((i) => i.id)).toEqual(['sp_1', 'sp_2']);
    expect(w.files.has(path.join(outDir, 'build-notes.json'))).toBe(false);
  });
});

describe('build', () => {
  const ENV = {
    STG_FULL_ADMIN_KEY: 'admin-key-value-1',
    STG_FULL_ACCESS_CLIENT_ID: 'access-id-value-2',
    STG_FULL_ACCESS_CLIENT_SECRET: 'access-secret-value-3',
  };
  const res = (status, body) => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  });
  const CATALOG = { ok: true, categories: [{ code: 'SOCIAL', types: [{ id: 'trivia' }] }] };
  const NODE_IDS = JSON.parse(readFileSync(path.join(ROOT, 'stock/nodes.json'), 'utf8')).nodes.map(
    (n) => n.id
  );
  const setup = (businesses) => {
    const w = world();
    const outDir = path.join('/out');
    w.fs.writeFileSync(path.join(outDir, 'accepted.json'), '[]');
    w.fs.writeFileSync(path.join(outDir, 'businesses.json'), JSON.stringify(businesses));
    return { w, outDir };
  };

  test('passes every node in stock/nodes.json, so each one counts toward short', async () => {
    const { w, outDir } = setup([]);
    const code = await rd.runBuild({
      env: ENV,
      fs: w.fs,
      fetch: async (url) => res(200, String(url).endsWith('/event-types') ? CATALOG : {}),
      now: () => new Date('2026-11-04T12:00:00Z'),
      outDir,
    });
    const manifest = JSON.parse(w.files.get(path.join(outDir, 'manifest.json')));
    expect(Object.keys(manifest.short)).toEqual(NODE_IDS);
    const notes = JSON.parse(w.files.get(path.join(outDir, 'build-notes.json')));
    expect(notes.ok).toBe(true);
    expect(notes.instagramWarning).toMatch(/INSTAGRAM_ACCESS_TOKEN is not set/);
    expect(code).toBe(0);
  });

  test('a failed build still writes its partial manifest and exits non-zero', async () => {
    const { w, outDir } = setup([
      { name: 'One', address: '1 Main St', node: 'beverly', anchor: true },
      { name: 'Two', address: '2 Main St', node: 'beverly', anchor: false },
    ]);
    let sponsors = 0;
    const code = await rd.runBuild({
      env: ENV,
      fs: w.fs,
      fetch: async (url) => {
        if (String(url).endsWith('/event-types')) return res(200, CATALOG);
        sponsors += 1;
        return sponsors === 1 ? res(201, { id: 'sp_1' }) : res(500, {});
      },
      now: () => new Date('2026-11-04T12:00:00Z'),
      outDir,
    });
    const manifest = JSON.parse(w.files.get(path.join(outDir, 'manifest.json')));
    expect(manifest.items).toEqual([
      { kind: 'sponsor', id: 'sp_1', node: 'beverly', tier: 'premium' },
    ]);
    const notes = JSON.parse(w.files.get(path.join(outDir, 'build-notes.json')));
    expect(notes.ok).toBe(false);
    expect(notes.error).toBe('POST /api/v2/admin/sponsors failed: 500');
    expect(JSON.stringify(notes)).not.toContain(ENV.STG_FULL_ADMIN_KEY);
    expect(code).toBe(1);
  });
});
