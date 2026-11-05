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
// strictDeletes: an R2 delete of a key that is not there answers as wrangler does (MISSING).
function world({ index, objects = {}, fail = () => false, raw, strictDeletes = false } = {}) {
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
        if (strictDeletes && !r2.has(key)) return { code: 1, stdout: '', stderr: MISSING };
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

  test('an R2 delete of an object already gone is a success: the stale manifest still leaves', async () => {
    // yesterday's art for node a is gone already (an earlier purge took it); b's is still there
    const w = world({
      index: [STALE_NAME],
      objects: {
        [`stock/${STALE_NAME}`]: manifestOf('2026-11-03', 'y', ['a', 'b']),
        'events/y_evt_b/art.png': 'bytes',
      },
      strictDeletes: true,
    });
    const report = await swap(w);
    allCalls.push(...w.calls);
    expect(w.deletes().sort()).toEqual([
      `${rd.R2_BUCKET}/events/y_evt_a/art.png`,
      `${rd.R2_BUCKET}/events/y_evt_b/art.png`,
    ]);
    expect(w.r2.has('events/y_evt_b/art.png')).toBe(false);
    expect(report.purges.every((p) => p.ok)).toBe(true);
    expect(w.liveIndex()).toEqual([TODAY_NAME]);
    expect(report.exitCode).toBe(0);
  });

  test('makeCloud.r2Delete: missing is success, any other failure throws without its output', async () => {
    const answers = [
      { code: 1, stdout: '', stderr: MISSING },
      { code: 1, stdout: '', stderr: 'NoSuchKey: gone' },
      { code: 1, stdout: '', stderr: 'Authentication error 10000' },
    ];
    const cloud = rd.makeCloud({ wrangler: async () => answers.shift(), fs: {}, tmpDir: '/tmp' });
    await expect(cloud.r2Delete('events/x/a.png')).resolves.toBeUndefined();
    await expect(cloud.r2Delete('events/x/a.png')).resolves.toBeUndefined();
    const err = await cloud.r2Delete('events/x/a.png').catch((e) => e);
    expect(err.message).toBe('wrangler r2 delete events/x/a.png failed (exit 1)');
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

describe('fix round 2: a re-run of check-swap alone', () => {
  test('attempt 2 over attempt 1’s artifact never purges today’s rows; attempt 1 leaves, attempt 2 stays', async () => {
    const first = `manifest-${TODAY}-${RUN}-1.json`;
    const second = `manifest-${TODAY}-${RUN}-2.json`;
    const same = manifestOf(TODAY, 't', ['a', 'b']);
    const w = world({ index: [first], objects: { [`stock/${first}`]: same } });
    const report = await swap(w, { manifest: same, runAttempt: '2' });
    allCalls.push(...w.calls);
    const todayIds = same.items.map((i) => i.id);
    for (const sql of w.sqls().filter((s) => s.startsWith('DELETE'))) {
      for (const id of todayIds) expect(sql).not.toContain(`'${id}'`);
    }
    for (const key of w.deletes()) for (const id of todayIds) expect(key).not.toContain(id);
    expect(w.sqls().filter((s) => s.startsWith('DELETE'))).toEqual([]);
    expect(w.deletes()).toEqual([]);
    expect(w.liveIndex()).toEqual([second]);
    expect(report.exitCode).toBe(0);
  });

  test('a build killed before its first API call still leaves an empty manifest', async () => {
    const w = world();
    const outDir = path.join('/out');
    let calls = 0;
    let stalled;
    const hung = new Promise((resolve) => (stalled = resolve));
    rd.runBuild({
      env: {
        STG_FULL_ADMIN_KEY: 'k',
        STG_FULL_ACCESS_CLIENT_ID: 'i',
        STG_FULL_ACCESS_CLIENT_SECRET: 's',
        GITHUB_RUN_ID: RUN,
        GITHUB_RUN_ATTEMPT: ATTEMPT,
      },
      fs: w.fs,
      wrangler: w.wrangler,
      tmpDir: '/tmp',
      log: () => {},
      fetch: () => {
        calls += 1;
        stalled();
        return new Promise(() => {}); // killed during the very first request
      },
      now: () => new Date('2026-11-04T12:00:00Z'),
      outDir,
    });
    await hung;
    expect(calls).toBe(1);
    expect(JSON.parse(w.files.get(path.join(outDir, 'manifest.json')))).toEqual({
      date: TODAY,
      items: [],
      qr: [],
      acceptSql: [],
      short: {},
      warnings: [],
    });
  });

  test('check-swap on that empty manifest is red and touches no row', async () => {
    const w = world({ index: [] });
    w.fs.writeFileSync(
      path.join('/out', 'manifest.json'),
      JSON.stringify({ date: TODAY, items: [], qr: [], acceptSql: [], short: {}, warnings: [] })
    );
    const code = await rd.runCheckSwap({
      env: {
        GITHUB_RUN_ID: RUN,
        GITHUB_RUN_ATTEMPT: ATTEMPT,
        STG_FULL_ADMIN_KEY: 'k',
        STG_FULL_ACCESS_CLIENT_ID: 'i',
        STG_FULL_ACCESS_CLIENT_SECRET: 's',
      },
      fs: w.fs,
      fetch: async () => ({ status: 200 }),
      wrangler: w.wrangler,
      now: () => new Date('2026-11-04T12:00:00Z'),
      outDir: path.join('/out'),
      tmpDir: '/tmp',
      log: () => {},
    });
    allCalls.push(...w.calls);
    expect(code).toBe(1);
    expect(w.sqls()).toEqual([]);
    expect(w.liveIndex()).toEqual([]);
  });

  test('a stale manifest sharing some ids purges only the ones today does not record', async () => {
    const stale = manifestOf('2026-11-03', 'y', ['a', 'b']);
    const today = manifestOf(TODAY, 't', ['a', 'b']);
    // the stale run also recorded one of today's sponsors (a shared row)
    stale.items.push({ kind: 'sponsor', id: 't_sp_a', node: 'a', tier: 'premium' });
    const w = world({ index: [STALE_NAME], objects: { [`stock/${STALE_NAME}`]: stale } });
    const report = await swap(w, { manifest: today });
    allCalls.push(...w.calls);
    const purged = w.sqls().join('\n');
    expect(purged).toContain("'y_evt_a'");
    expect(purged).toContain("'y_sp_a'");
    expect(purged).not.toContain("'t_sp_a'");
    expect(w.liveIndex()).toEqual([TODAY_NAME]);
    expect(report.exitCode).toBe(0);
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
      `rows of ${TODAY_NAME} for b are still live; they are recorded only in this run's stock-manifest artifact; purge them by hand`
    );
    expect(report.exitCode).toBe(1);
  });

  test('when the manifest object was saved but the index write failed, the summary says so', async () => {
    const w = world({
      index: [],
      fail: (c) =>
        (c.args[2] === 'put' && c.args[3].endsWith('manifest-index.json')) ||
        (c.sql !== null && c.sql.includes("'t_evt_b'")),
    });
    const report = await swap(w);
    allCalls.push(...w.calls);
    expect(w.r2.has(`stock/${TODAY_NAME}`)).toBe(true);
    const text = report.problems.join('\n');
    expect(text).toContain(
      `rows of ${TODAY_NAME} for b are still live; the manifest object stock/${TODAY_NAME} exists in R2 but is not listed in the index; add it by hand or rely on this run's artifact`
    );
    expect(text).not.toContain('recorded only in');
    expect(report.exitCode).toBe(1);
  });

  test('with no manifest at all, check-swap says rows may need a manual purge, and is red', async () => {
    const w = world({ index: [] });
    const logs = [];
    const code = await rd.runCheckSwap({
      env: { GITHUB_STEP_SUMMARY: '/summary.md', GITHUB_RUN_ID: RUN, GITHUB_RUN_ATTEMPT: ATTEMPT },
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
    // it looked for an R2 copy of today's manifest, and changed nothing
    allCalls.push(...w.calls);
    expect(w.calls.map((c) => `${c.args[0]} ${c.args[2]}`)).toEqual(['r2 get']);
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
        GITHUB_RUN_ID: RUN,
        GITHUB_RUN_ATTEMPT: ATTEMPT,
      },
      fs: w.fs,
      wrangler: w.wrangler,
      tmpDir: '/tmp',
      log: () => {},
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
    GITHUB_RUN_ID: RUN,
    GITHUB_RUN_ATTEMPT: ATTEMPT,
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
      wrangler: w.wrangler,
      tmpDir: '/tmp',
      log: () => {},
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
      wrangler: w.wrangler,
      tmpDir: '/tmp',
      log: () => {},
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

describe('final review', () => {
  const W = require('./worker-bodies');
  const ENV = {
    STG_FULL_ADMIN_KEY: 'admin-key-value-1',
    STG_FULL_ACCESS_CLIENT_ID: 'access-id-value-2',
    STG_FULL_ACCESS_CLIENT_SECRET: 'access-secret-value-3',
    GITHUB_RUN_ID: RUN,
    GITHUB_RUN_ATTEMPT: ATTEMPT,
  };
  const NODE_LIST = JSON.parse(readFileSync(path.join(ROOT, 'stock/nodes.json'), 'utf8')).nodes;
  const CATALOG = { ok: true, categories: [{ code: 'SOCIAL', types: [{ id: 'trivia' }] }] };
  const res = (status, body) => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    headers: { get: () => null },
  });
  let nodeAt;
  beforeAll(async () => {
    ({ nodeAt } = await import('../../../scripts/stock/validate-finds.mjs'));
  });
  // A point inside a node's boundary polygon.
  const insideOf = (id) => {
    const n = NODE_LIST.find((x) => x.id === id);
    const ring = (
      n.polygon.type === 'Polygon' ? n.polygon.coordinates : n.polygon.coordinates[0]
    )[0];
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    for (let i = 1; i < 40; i++) {
      for (let j = 1; j < 40; j++) {
        const lng = Math.min(...xs) + ((Math.max(...xs) - Math.min(...xs)) * i) / 40;
        const lat = Math.min(...ys) + ((Math.max(...ys) - Math.min(...ys)) * j) / 40;
        if (nodeAt(NODE_LIST, lat, lng) === id) return { lat, lng };
      }
    }
    throw new Error(`no interior point for ${id}`);
  };

  test('check-swap judges the window from the manifest day, even past Chicago midnight', async () => {
    const w = world({ index: [] });
    w.fs.writeFileSync(
      path.join('/out', 'manifest.json'),
      JSON.stringify(manifestOf(TODAY, 't', ['a']))
    );
    w.fs.writeFileSync(path.join('/out', 'build-notes.json'), JSON.stringify({ ok: true }));
    const seen = [];
    await rd.runCheckSwap({
      env: { ...ENV, BUILD_RESULT: 'success' },
      fs: w.fs,
      fetch: async () => ({ status: 200 }),
      wrangler: w.wrangler,
      // 00:30 on 5 November in Chicago: the clock says the 5th, the build was for the 4th
      now: () => new Date('2026-11-05T06:30:00Z'),
      outDir: '/out',
      tmpDir: '/tmp',
      checkNodes: async ({ today }) => {
        seen.push(today);
        return {};
      },
      log: () => {},
    });
    allCalls.push(...w.calls);
    expect(seen).toEqual([TODAY]);
  });

  test('validate geocodes each business, places it by polygon and drops the rest', async () => {
    const w = world();
    const outDir = '/out';
    w.fs.writeFileSync(path.join(outDir, 'finds.json'), '[]');
    w.fs.writeFileSync(
      path.join(outDir, 'businesses.json'),
      JSON.stringify([
        // the search said beverly; the address is in oak-lawn
        { name: 'Anchor Co', address: '1 in-oak-lawn Rd', node: 'beverly', anchor: true },
        { name: 'Far Co', address: '2 far-away St', node: 'beverly', anchor: false },
        { name: 'anchor co.', address: '1 In-Oak-Lawn Rd', node: 'oak-lawn', anchor: false },
        { name: 'Lost Co', address: '3 no-such St', node: 'beverly', anchor: false },
      ])
    );
    const geocoded = [];
    const code = await rd.runValidate({
      env: { ...ENV, GITHUB_STEP_SUMMARY: '/summary.md' },
      fs: w.fs,
      fetch: async (url, init = {}) => {
        if (String(url).endsWith('/event-types')) return res(200, CATALOG);
        if (String(url).endsWith('/api/v2/admin/geocode')) {
          const { address } = JSON.parse(init.body);
          geocoded.push(address);
          if (address.includes('in-oak-lawn')) return res(200, W.geocode(insideOf('oak-lawn')));
          if (address.includes('far-away')) {
            return res(200, W.geocode({ lat: 41.95, lng: -87.65 }));
          }
          return res(422, { ok: false });
        }
        return res(404, {});
      },
      now: () => new Date('2026-11-04T12:00:00Z'),
      outDir,
    });
    expect(code).toBe(0);
    expect(geocoded).toEqual(['1 in-oak-lawn Rd', '2 far-away St', '3 no-such St']);
    const at = insideOf('oak-lawn');
    expect(JSON.parse(w.files.get(path.join(outDir, 'businesses.json')))).toEqual([
      {
        name: 'Anchor Co',
        address: '1 in-oak-lawn Rd',
        node: 'oak-lawn',
        anchor: true,
        lat: at.lat,
        lng: at.lng,
      },
    ]);
    const summary = w.files.get('/summary.md');
    expect(summary).toMatch(/[|] oak-lawn [|] 0 [|] [0-9]+ [|] 1 [|]/);
    expect(summary).toMatch(/[|] beverly [|] 0 [|] [0-9]+ [|] 0 [|]/);
    expect(summary).toContain('Businesses refused: not-in-node 1, duplicate 1, geocode-failed 1');
  });

  test('build with Instagram refusing the token (401) exits 0, warns, and builds events without art', async () => {
    const w = world();
    const outDir = '/out';
    const point = insideOf('beverly');
    w.fs.writeFileSync(
      path.join(outDir, 'accepted.json'),
      JSON.stringify([
        {
          venue: 'Cork',
          address: '1 Main St',
          sector: 'private',
          node: 'beverly',
          event_type_id: 'trivia',
          starts_at: '2026-11-10T19:00:00-06:00',
          ends_at: null,
          title: 'Trivia',
          summary: 'Weekly.',
          source_url: 'https://example.com/e/1',
          lat: point.lat,
          lng: point.lng,
        },
      ])
    );
    w.fs.writeFileSync(
      path.join(outDir, 'businesses.json'),
      JSON.stringify([{ name: 'Anchor Co', address: '2 Main St', node: 'beverly', anchor: true }])
    );
    const paths = [];
    let n = 0;
    const code = await rd.runBuild({
      env: {
        ...ENV,
        INSTAGRAM_ACCESS_TOKEN: 'ig-token-value-4',
        INSTAGRAM_TOKEN_ISSUED: '2026-10-30',
      },
      fs: w.fs,
      wrangler: w.wrangler,
      tmpDir: '/tmp',
      log: () => {},
      fetch: async (url, init = {}) => {
        const u = String(url);
        if (u.startsWith('https://graph.instagram.com/')) return res(401, {});
        const p = u.slice('https://stg-full.oursharedevents.com'.length);
        paths.push(`${init.method || 'GET'} ${p}`);
        n += 1;
        if (p.endsWith('/event-types')) return res(200, CATALOG);
        if (p === '/api/v2/admin/sponsors') return res(201, W.sponsorCreate({ id: 'sp_anchor' }));
        if (p === '/api/v2/admin/events') {
          return res(201, W.eventCreate({ id: `evt_${n}`, shortcode: `SC${n}` }));
        }
        if (p.endsWith('/poster-deployments')) {
          return res(201, W.posterCreate({ id: `pd_${n}`, qr_token: `qrt_${n}` }));
        }
        if (p.endsWith('/short-links')) return res(200, W.shortLinks());
        if (p.startsWith('/api/v2/admin/sponsors?eventId=')) {
          return res(200, W.sponsorList([{ id: 'sp_anchor', placement_id: 'spl_1' }]));
        }
        return res(200, { ok: true });
      },
      now: () => new Date('2026-11-04T12:00:00Z'),
      outDir,
    });
    expect(code).toBe(0);
    const notes = JSON.parse(w.files.get(path.join(outDir, 'build-notes.json')));
    expect(notes.ok).toBe(true);
    expect(notes.instagramWarning).toMatch(/rejected the token [(]HTTP 401[)]; no art this run/);
    expect(JSON.stringify(notes)).not.toContain('ig-token-value-4');
    const manifest = JSON.parse(w.files.get(path.join(outDir, 'manifest.json')));
    expect(manifest.items.filter((i) => i.kind === 'event')).toHaveLength(1);
    expect(manifest.items.filter((i) => i.kind === 'placement')).toHaveLength(1);
    expect(manifest.items.filter((i) => i.kind === 'upload')).toEqual([]);
    expect(paths.some((p) => p.endsWith('/uploads'))).toBe(false);
    expect(paths.some((p) => /^PUT [/]api[/]v2[/]admin[/]events[/]/.test(p))).toBe(false);
  });
});

describe('the manifest is registered in R2 during the build', () => {
  const ENV = {
    STG_FULL_ADMIN_KEY: 'admin-key-value-1',
    STG_FULL_ACCESS_CLIENT_ID: 'access-id-value-2',
    STG_FULL_ACCESS_CLIENT_SECRET: 'access-secret-value-3',
    GITHUB_RUN_ID: RUN,
    GITHUB_RUN_ATTEMPT: ATTEMPT,
  };
  const EMPTY = { date: TODAY, items: [], qr: [], acceptSql: [], short: {}, warnings: [] };
  const CATALOG = { ok: true, categories: [{ code: 'SOCIAL', types: [{ id: 'trivia' }] }] };
  const NODE_LIST = JSON.parse(readFileSync(path.join(ROOT, 'stock/nodes.json'), 'utf8')).nodes;
  const res = (status, body) => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const businesses = (n) =>
    Array.from({ length: n }, (_, i) => ({
      name: `Biz ${i + 1}`,
      address: `${i + 1} Main St`,
      node: 'beverly',
      anchor: i === 0,
    }));
  const buildWorld = (opts, list = []) => {
    const w = world(opts);
    w.fs.writeFileSync(path.join('/out', 'accepted.json'), '[]');
    w.fs.writeFileSync(path.join('/out', 'businesses.json'), JSON.stringify(list));
    return w;
  };
  const manifestPuts = (w, name = TODAY_NAME) =>
    w.calls.filter((c) => c.args[2] === 'put' && c.args[3].endsWith(`stock/${name}`));
  const isManifestPut = (c) => c.args[2] === 'put' && /manifest-\d/.test(c.args[3]);
  const isIndexPut = (c) => c.args[2] === 'put' && c.args[3].endsWith('manifest-index.json');

  test('the build writes the empty manifest and lists its name before the first API call', async () => {
    const w = buildWorld({ index: [STALE_NAME] });
    let stalled;
    const hung = new Promise((resolve) => (stalled = resolve));
    rd.runBuild({
      env: ENV,
      fs: w.fs,
      wrangler: w.wrangler,
      tmpDir: '/tmp',
      log: () => {},
      fetch: () => {
        w.order.push('api');
        stalled();
        return new Promise(() => {});
      },
      now: () => new Date('2026-11-04T12:00:00Z'),
      outDir: '/out',
    });
    await hung;
    allCalls.push(...w.calls);
    expect(JSON.parse(w.r2.get(`stock/${TODAY_NAME}`))).toEqual(EMPTY);
    expect(w.liveIndex()).toEqual([STALE_NAME, TODAY_NAME]);
    // read the index and today's key, write the object, then the index; only then the API
    expect(w.order).toEqual(['r2:get', 'r2:get', 'r2:put', 'r2:put', 'api']);
    expect(w.calls[3].args[3]).toBe(`${rd.R2_BUCKET}/${rd.INDEX_KEY}`);
  });

  test.each([
    ['the index cannot be read', (c) => c.args[2] === 'get'],
    ['the manifest object cannot be written', isManifestPut],
    ['the index cannot be written', isIndexPut],
  ])('when %s, the build creates nothing and exits red', async (_, fail) => {
    const w = buildWorld({ index: [STALE_NAME], fail }, businesses(2));
    let fetched = 0;
    const code = await rd.runBuild({
      env: ENV,
      fs: w.fs,
      wrangler: w.wrangler,
      tmpDir: '/tmp',
      log: () => {},
      fetch: async () => {
        fetched += 1;
        return res(200, CATALOG);
      },
      now: () => new Date('2026-11-04T12:00:00Z'),
      outDir: '/out',
    });
    allCalls.push(...w.calls);
    expect(code).toBe(1);
    expect(fetched).toBe(0);
    const notes = JSON.parse(w.files.get(path.join('/out', 'build-notes.json')));
    expect(notes.ok).toBe(false);
    expect(notes.error).toMatch(/^manifest not registered in R2: /);
    expect(w.liveIndex()).toEqual([STALE_NAME]);
  });

  test('a build with no run id registers nothing and creates nothing', async () => {
    const w = buildWorld({ index: [] });
    let fetched = 0;
    const code = await rd.runBuild({
      env: { ...ENV, GITHUB_RUN_ID: '' },
      fs: w.fs,
      wrangler: w.wrangler,
      tmpDir: '/tmp',
      log: () => {},
      fetch: async () => {
        fetched += 1;
        return res(200, CATALOG);
      },
      now: () => new Date('2026-11-04T12:00:00Z'),
      outDir: '/out',
    });
    expect(code).toBe(1);
    expect(fetched).toBe(0);
    expect(w.calls).toEqual([]);
  });

  test('an existing object under the build’s own name is never overwritten: red, nothing created', async () => {
    const w = buildWorld({
      index: [],
      objects: { [`stock/${TODAY_NAME}`]: manifestOf(TODAY, 'other', ['a']) },
    });
    let fetched = 0;
    const code = await rd.runBuild({
      env: ENV,
      fs: w.fs,
      wrangler: w.wrangler,
      tmpDir: '/tmp',
      log: () => {},
      fetch: async () => {
        fetched += 1;
        return res(200, CATALOG);
      },
      now: () => new Date('2026-11-04T12:00:00Z'),
      outDir: '/out',
    });
    allCalls.push(...w.calls);
    expect(code).toBe(1);
    expect(fetched).toBe(0);
    expect(JSON.parse(w.r2.get(`stock/${TODAY_NAME}`)).items[0].id).toMatch(/^other_/);
    expect(w.calls.some((c) => c.args[2] === 'put')).toBe(false);
  });

  describe('throttled copies, under a fake clock', () => {
    // A clock and a timer queue that move only when the test says so.
    const fakeTime = (start = 0) => {
      const t = { now: start, timers: [] };
      t.setTimer = (fn, ms) => {
        const h = { at: t.now + ms, fn };
        t.timers.push(h);
        return h;
      };
      t.clearTimer = (h) => {
        t.timers = t.timers.filter((x) => x !== h);
      };
      t.advance = async (ms) => {
        const end = t.now + ms;
        for (;;) {
          const due = t.timers.filter((h) => h.at <= end).sort((a, b) => a.at - b.at)[0];
          if (!due) break;
          t.timers = t.timers.filter((x) => x !== due);
          t.now = due.at;
          due.fn();
          await settle();
        }
        t.now = end;
        await settle();
      };
      return t;
    };

    test('at most one write per 20 s, a lone change still lands within 20 s, then a final write', async () => {
      const t = fakeTime();
      const writes = [];
      const p = rd.makeManifestPersister({
        save: async (text) => writes.push({ at: t.now, n: JSON.parse(text).items.length }),
        now: () => t.now,
        setTimer: t.setTimer,
        clearTimer: t.clearTimer,
      });
      const m = { date: TODAY, items: [] };
      for (let i = 1; i <= 65; i++) {
        m.items.push({ kind: 'sponsor', id: `sp_${i}`, node: 'a' });
        p.record(m);
        await t.advance(1000);
      }
      expect(writes.map((x) => x.at)).toEqual([20000, 40000, 60000]);
      for (let i = 1; i < writes.length; i++) {
        expect(writes[i].at - writes[i - 1].at).toBeGreaterThanOrEqual(rd.PERSIST_INTERVAL_MS);
      }
      // the last records, then nothing: the trailing write still lands by 80 s
      await t.advance(25000);
      expect(writes.map((x) => x.at)).toEqual([20000, 40000, 60000, 80000]);
      expect(writes[3].n).toBe(65);
      await p.final(m);
      expect(writes).toHaveLength(5);
      expect(writes[4]).toEqual({ at: 90000, n: 65 });
      expect(t.timers).toEqual([]);
    });

    test('a failed throttled write is a warning; a failed final write throws', async () => {
      const t = fakeTime();
      const warnings = [];
      let ok = false;
      const p = rd.makeManifestPersister({
        save: async () => {
          if (!ok) throw new Error('wrangler r2 put failed (exit 1)');
        },
        now: () => t.now,
        setTimer: t.setTimer,
        clearTimer: t.clearTimer,
        warn: (msg) => warnings.push(msg),
      });
      const m = { date: TODAY, items: [{ kind: 'sponsor', id: 'sp_1', node: 'a' }] };
      p.record(m);
      await t.advance(21000);
      expect(warnings).toEqual([
        'manifest copy in R2 not updated: wrangler r2 put failed (exit 1)',
      ]);
      await expect(p.final(m)).rejects.toThrow('wrangler r2 put failed (exit 1)');
      ok = true;
      await expect(p.final(m)).resolves.toBeUndefined();
    });

    // The build's clock moves 15 s per API call, so its R2 copy is throttled for real.
    const runTimed = (
      w,
      {
        env = ENV,
        start = '2026-11-04T12:00:00Z',
        log = () => {},
        t = fakeTime(Date.parse(start)),
      },
      fetchFor
    ) => {
      return rd.runBuild({
        env,
        fs: w.fs,
        wrangler: w.wrangler,
        tmpDir: '/tmp',
        log,
        now: () => new Date(t.now),
        setTimer: t.setTimer,
        clearTimer: t.clearTimer,
        fetch: (url, init) => {
          t.now += 15000;
          return fetchFor(String(url), init);
        },
        outDir: '/out',
      });
    };
    const sponsorsOk = () => {
      let n = 0;
      return async (url) =>
        url.endsWith('/event-types') ? res(200, CATALOG) : res(201, { id: `sp_${++n}` });
    };

    test('the build writes throttled copies and a final one when buildDay returns', async () => {
      const w = buildWorld({ index: [] }, businesses(6));
      const code = await runTimed(w, {}, sponsorsOk());
      allCalls.push(...w.calls);
      expect(code).toBe(0);
      const local = JSON.parse(w.files.get(path.join('/out', 'manifest.json')));
      expect(local.items).toHaveLength(6);
      expect(JSON.parse(w.r2.get(`stock/${TODAY_NAME}`))).toEqual(local);
      // registration, at least one throttled copy mid-build, then the final copy
      const sizes = manifestPuts(w).map(
        (c) => JSON.parse(w.files.get(c.args[c.args.indexOf('--file') + 1])).items.length
      );
      expect(sizes[0]).toBe(0);
      expect(sizes.at(-1)).toBe(6);
      expect(sizes.slice(1, -1).length).toBeGreaterThanOrEqual(1);
      expect(sizes.slice(1, -1).every((k) => k > 0 && k < 6)).toBe(true);
      expect(w.liveIndex()).toEqual([TODAY_NAME]);
    });

    test('the build writes a final copy when buildDay throws', async () => {
      const w = buildWorld({ index: [] }, businesses(3));
      let n = 0;
      const code = await runTimed(w, {}, async (url) => {
        if (url.endsWith('/event-types')) return res(200, CATALOG);
        n += 1;
        return n < 3 ? res(201, { id: `sp_${n}` }) : res(500, {});
      });
      allCalls.push(...w.calls);
      expect(code).toBe(1);
      const saved = JSON.parse(w.r2.get(`stock/${TODAY_NAME}`));
      expect(saved.items.map((i) => i.id)).toEqual(['sp_1', 'sp_2']);
    });

    test('a failed final copy turns a good build red; failed throttled copies alone do not', async () => {
      // every manifest put after registration fails: the throttled ones warn, the final one is red
      let puts = 0;
      const red = buildWorld(
        { index: [], fail: (c) => isManifestPut(c) && ++puts > 1 },
        businesses(4)
      );
      const logs = [];
      const code = await runTimed(red, { log: (l) => logs.push(l) }, sponsorsOk());
      allCalls.push(...red.calls);
      expect(code).toBe(1);
      expect(puts).toBeGreaterThan(2); // at least one throttled copy, then the final one
      expect(logs.join('\n')).toContain('manifest copy in R2 not updated');
      const notes = JSON.parse(red.files.get(path.join('/out', 'build-notes.json')));
      expect(notes.ok).toBe(false);
      expect(notes.error).toMatch(/manifest not saved to R2/);

      // only the throttled copies fail: the build stays green and the final copy lands
      const sizes = [];
      const green = buildWorld(
        {
          index: [],
          fail: (c) => {
            if (!isManifestPut(c)) return false;
            sizes.push(c);
            return sizes.length > 1 && sizes.length < manifestPuts(red).length;
          },
        },
        businesses(4)
      );
      const ok = await runTimed(green, {}, sponsorsOk());
      allCalls.push(...green.calls);
      expect(sizes.length).toBeGreaterThan(2);
      expect(ok).toBe(0);
      expect(JSON.parse(green.r2.get(`stock/${TODAY_NAME}`)).items).toHaveLength(4);
    });

    test('a cancelled build’s registered manifest is stale to the next run, which purges it per passing node', async () => {
      // Run 100 on the 3rd: two sponsors made, a throttled copy written, then cancelled.
      const w = buildWorld({ index: [] }, businesses(3));
      const t = fakeTime(Date.parse('2026-11-03T12:00:00Z'));
      let n = 0;
      let stalled;
      const hung = new Promise((resolve) => (stalled = resolve));
      runTimed(w, { env: { ...ENV, GITHUB_RUN_ID: '100' }, t }, async (url) => {
        if (url.endsWith('/event-types')) return res(200, CATALOG);
        n += 1;
        if (n === 3) {
          await t.advance(20000); // the third request hangs long enough for the timer
          stalled();
          return new Promise(() => {}); // cancelled here: no final write, no check-swap
        }
        return res(201, { id: `sp_${n}` });
      });
      await hung;
      await settle();
      expect(w.liveIndex()).toEqual([STALE_NAME]);
      expect(JSON.parse(w.r2.get(`stock/${STALE_NAME}`)).items.map((i) => i.id)).toEqual([
        'sp_1',
        'sp_2',
      ]);

      // Run 200 on the 4th: every node passes, so the cancelled run's rows are purged.
      const report = await rd.checkSwap({
        manifest: manifestOf(TODAY, 't', ['beverly']),
        nodes: { nodes: NODE_LIST },
        targets: TARGETS,
        today: TODAY,
        runId: RUN,
        runAttempt: ATTEMPT,
        cloud: w.cloud,
        checkNodes: async () =>
          Object.fromEntries(
            NODE_LIST.map((x) => [
              x.id,
              { pass: true, count: P, expected: P, totalListed: P, reasons: [] },
            ])
          ),
      });
      allCalls.push(...w.calls);
      const purged = w
        .sqls()
        .filter((s) => s.startsWith('DELETE'))
        .join('\n');
      expect(purged).toContain("'sp_1'");
      expect(purged).toContain("'sp_2'");
      expect(purged).not.toContain("'t_");
      expect(w.liveIndex()).toEqual([TODAY_NAME]);
      expect(report.exitCode).toBe(0);
    });
  });
});

describe('check-swap over a manifest the build registered', () => {
  test('it overwrites its own registered object with the complete manifest, and lists it once', async () => {
    const full = manifestOf(TODAY, 't', ['a', 'b']);
    const partial = { ...full, items: full.items.slice(0, 3), acceptSql: [] };
    const w = world({ index: [TODAY_NAME], objects: { [`stock/${TODAY_NAME}`]: partial } });
    const report = await swap(w, { manifest: full });
    allCalls.push(...w.calls);
    expect(JSON.parse(w.r2.get(`stock/${TODAY_NAME}`))).toEqual(full);
    expect(w.liveIndex()).toEqual([TODAY_NAME]);
    expect(w.order).toContain('check');
    expect(w.sqls().filter((s) => s.startsWith('DELETE'))).toEqual([]);
    expect(report.problems).toEqual([]);
    expect(report.exitCode).toBe(0);
  });

  test('it overwrites the empty registration of a build that recorded nothing yet', async () => {
    const w = world({
      index: [TODAY_NAME],
      objects: {
        [`stock/${TODAY_NAME}`]: {
          date: TODAY,
          items: [],
          qr: [],
          acceptSql: [],
          short: {},
          warnings: [],
        },
      },
    });
    const report = await swap(w);
    allCalls.push(...w.calls);
    expect(JSON.parse(w.r2.get(`stock/${TODAY_NAME}`)).items).toHaveLength(10);
    expect(w.liveIndex()).toEqual([TODAY_NAME]);
    expect(report.exitCode).toBe(0);
  });

  test('it refuses red when the registered object holds an id the artifact does not', async () => {
    const full = manifestOf(TODAY, 't', ['a', 'b']);
    const foreign = {
      ...full,
      items: [...full.items, { kind: 'event', id: 'x_evt_a', node: 'a' }],
    };
    const w = world({ index: [TODAY_NAME], objects: { [`stock/${TODAY_NAME}`]: foreign } });
    const report = await swap(w, { manifest: full });
    allCalls.push(...w.calls);
    expect(JSON.parse(w.r2.get(`stock/${TODAY_NAME}`))).toEqual(foreign);
    expect(w.calls.some((c) => c.args[2] === 'put')).toBe(false);
    expect(w.order).not.toContain('check');
    expect(w.sqls().join('\n')).not.toContain("'x_evt_a'");
    expect(report.problems.join('\n')).toMatch(/x_evt_a/);
    expect(report.problems.join('\n')).toMatch(/never overwritten/);
    expect(report.exitCode).toBe(1);
  });

  test('a garbled object under today’s name is never overwritten', async () => {
    const w = world({ index: [TODAY_NAME] });
    w.r2.set(`stock/${TODAY_NAME}`, '{"items": nope');
    const report = await swap(w);
    allCalls.push(...w.calls);
    expect(w.r2.get(`stock/${TODAY_NAME}`)).toBe('{"items": nope');
    expect(w.calls.some((c) => c.args[2] === 'put')).toBe(false);
    expect(report.exitCode).toBe(1);
  });

  test('with no artifact, it purges every node of the R2 copy, red', async () => {
    const w = world({
      index: [STALE_NAME, TODAY_NAME],
      objects: {
        [`stock/${STALE_NAME}`]: manifestOf('2026-11-03', 'y', ['a', 'b']),
        [`stock/${TODAY_NAME}`]: manifestOf(TODAY, 't', ['a', 'b']),
      },
    });
    let checked = false;
    const code = await rd.runCheckSwap({
      env: {
        GITHUB_RUN_ID: RUN,
        GITHUB_RUN_ATTEMPT: ATTEMPT,
        BUILD_RESULT: 'success',
        GITHUB_STEP_SUMMARY: '/summary.md',
      },
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
    expect(code).toBe(1);
    expect(checked).toBe(false);
    const purged = w.sqls().join('\n');
    expect(purged).toContain("'t_evt_a'");
    expect(purged).toContain("'t_evt_b'");
    expect(purged).not.toContain("'y_");
    expect(w.liveIndex()).toEqual([STALE_NAME]);
    const summary = w.files.get('/summary.md');
    expect(summary).toContain(`the R2 copy of ${TODAY_NAME}`);
    expect(summary).not.toContain('No manifest was saved');
  });
});

describe('check-swap re-run alone recovers the build’s registration', () => {
  const nameOf = (attempt) => `manifest-${TODAY}-${RUN}-${attempt}.json`;
  const runAlone = async (w, attempt) => {
    let checked = false;
    const code = await rd.runCheckSwap({
      env: {
        GITHUB_RUN_ID: RUN,
        GITHUB_RUN_ATTEMPT: attempt,
        BUILD_RESULT: 'success',
        GITHUB_STEP_SUMMARY: '/summary.md',
      },
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
    return { code, checked, summary: w.files.get('/summary.md') };
  };

  test('the build ran as attempt 1, check-swap re-runs as attempt 2 with no artifact: attempt 1 is purged, red', async () => {
    const w = world({
      index: [STALE_NAME, nameOf(1)],
      objects: {
        [`stock/${STALE_NAME}`]: manifestOf('2026-11-03', 'y', ['a', 'b']),
        [`stock/${nameOf(1)}`]: manifestOf(TODAY, 't', ['a', 'b']),
      },
    });
    const { code, checked, summary } = await runAlone(w, '2');
    expect(code).toBe(1);
    expect(checked).toBe(false);
    const purged = w.sqls().join('\n');
    expect(purged).toContain("'t_evt_a'");
    expect(purged).toContain("'t_evt_b'");
    expect(purged).not.toContain("'y_");
    expect(w.deletes()).toContain(`${rd.R2_BUCKET}/events/t_evt_a/art.png`);
    // the copy keeps its own name: nothing is written under attempt 2
    expect(w.r2.has(`stock/${nameOf(2)}`)).toBe(false);
    expect(w.liveIndex()).toEqual([STALE_NAME]);
    expect(summary).toContain(`the R2 copy of ${nameOf(1)}`);
    expect(summary).not.toContain('No manifest was saved');
  });

  test('the current attempt is preferred when both attempts registered', async () => {
    const w = world({
      index: [nameOf(1), nameOf(2)],
      objects: {
        [`stock/${nameOf(1)}`]: manifestOf(TODAY, 'one', ['a', 'b']),
        [`stock/${nameOf(2)}`]: manifestOf(TODAY, 't', ['a', 'b']),
      },
    });
    const { code, summary } = await runAlone(w, '2');
    expect(code).toBe(1);
    const purged = w.sqls().join('\n');
    expect(purged).toContain("'t_evt_a'");
    expect(purged).not.toContain("'one_");
    expect(w.liveIndex()).toEqual([nameOf(1)]);
    expect(summary).toContain(`the R2 copy of ${nameOf(2)}`);
  });

  test('otherwise the highest attempt whose object can be read', async () => {
    // attempts 1, 2 and 3 registered; 3 is listed but missing, so 2 is recovered
    const w = world({
      index: [nameOf(1), nameOf(3), nameOf(2)],
      objects: {
        [`stock/${nameOf(1)}`]: manifestOf(TODAY, 'one', ['a', 'b']),
        [`stock/${nameOf(2)}`]: manifestOf(TODAY, 'two', ['a', 'b']),
      },
    });
    const { code, summary } = await runAlone(w, '4');
    expect(code).toBe(1);
    const purged = w.sqls().join('\n');
    expect(purged).toContain("'two_evt_a'");
    expect(purged).not.toContain("'one_");
    expect(w.liveIndex()).toEqual([nameOf(1), nameOf(3)]);
    expect(summary).toContain(`the R2 copy of ${nameOf(2)}`);
  });

  test('no registration for this run id is the red "no manifest" path, and changes nothing', async () => {
    const other = 'manifest-2026-11-04-999-1.json';
    const w = world({
      index: [other],
      objects: { [`stock/${other}`]: manifestOf(TODAY, 'z', ['a', 'b']) },
    });
    const { code, summary } = await runAlone(w, '2');
    expect(code).toBe(1);
    expect(summary).toContain(
      'No manifest was saved; rows created by an interrupted build may need a manual purge.'
    );
    expect(w.calls.some((c) => c.args[2] === 'put' || c.args[2] === 'delete')).toBe(false);
    expect(w.sqls()).toEqual([]);
    expect(w.liveIndex()).toEqual([other]);
  });
});
