// The stock load writes staging D1 through the ordinary query endpoint
// (`wrangler d1 execute … --command`), never an import (`--file`), so its purge
// and acceptance writes never take staging offline for reads (OSE-2090).
const { readFileSync } = require('node:fs');
const path = require('node:path');

let rd;
let pf;
beforeAll(async () => {
  rd = await import('../../../scripts/stock/run-day.mjs');
  pf = await import('../../../scripts/stock/purge-full.mjs');
});

const ROOT = path.join(__dirname, '../../..');
const SEED = JSON.parse(readFileSync(path.join(ROOT, 'stock/seed/seed.json'), 'utf8'));
const DONE_ONE = '🚣 Executed 1 command in 4.10ms';
const DONE_MANY = '🚣 Executed 22 commands in 9.70ms';
const IMPORT_DONE = '🚣 Executed 22 queries in 9.70ms (3 rows read, 3 rows written)';
const D1 = ['d1', 'execute', 'ocr-db-staging', '--env', 'staging', '--remote'];
const bytes = (s) => Buffer.byteLength(s, 'utf8');

// A cloud whose wrangler records each call and answers with `answer(args, n)`.
function recordingCloud(answer = () => ({ code: 0, stdout: DONE_MANY, stderr: '' })) {
  const calls = [];
  const writes = [];
  const fs = {
    writeFileSync: (p) => writes.push(p),
    readFileSync: () => '',
  };
  const wrangler = async (args) => {
    calls.push(args);
    return answer(args, calls.length);
  };
  const cloud = rd.makeCloud({ wrangler, fs, tmpDir: '/tmp', sleep: async () => {} });
  const sent = () => calls.map((a) => a[a.indexOf('--command') + 1]);
  return { cloud, calls, writes, sent };
}

// A manifest with `n` events (and one sponsor and poster per event) on node `node`,
// every id `len` characters long, so a test can size the purge.
function bigManifest(n, len, node = 'oak-lawn') {
  const id = (kind, i) => `${kind}_${String(i).padStart(len - kind.length - 1, '0')}`;
  const items = [];
  for (let i = 0; i < n; i++) {
    items.push({ kind: 'event', id: id('evt', i), node });
    items.push({ kind: 'sponsor', id: id('sp', i), node });
    items.push({ kind: 'poster', id: id('pd', i), node });
  }
  return { date: '2026-11-16', items };
}

describe('the guard: d1 goes through --command, never --file', () => {
  test('a d1 import (--file) is refused, even on the staging database', () => {
    expect(() => rd.assertStaging([...D1, '--yes', '--file', '/tmp/stock-1-d1.sql'])).toThrow(
      /never takes --file/
    );
  });

  test.each([
    ['no --command', [...D1]],
    [
      'two --command',
      [...D1, '--command', "DELETE FROM events WHERE id IN ('a')", '--command', 'DELETE FROM x'],
    ],
    [
      'a SELECT, which would print rows to the public log',
      [...D1, '--command', 'SELECT * FROM events'],
    ],
    [
      'a RETURNING clause',
      [...D1, '--command', "DELETE FROM events WHERE id IN ('a') RETURNING *"],
    ],
    [
      'an INSERT (the stock run only deletes and accepts)',
      [...D1, '--command', "INSERT INTO events (id) VALUES ('a')"],
    ],
    [
      'a second statement that reads',
      [...D1, '--command', "DELETE FROM events WHERE id IN ('a'); PRAGMA table_info(events)"],
    ],
    ['empty SQL', [...D1, '--command', '  ']],
  ])('refuses %s', (_name, args) => {
    expect(() => rd.assertStaging(args)).toThrow(/wrangler: d1 execute/);
  });

  test('refuses a text over the D1 limit', () => {
    const sql = `DELETE FROM events WHERE id IN ('${'a'.repeat(pf.MAX_SQL_BYTES)}')`;
    expect(() => rd.assertStaging([...D1, '--command', sql])).toThrow(/wrangler: d1 execute/);
  });

  test('a quoted id that looks like SQL is data, not a statement', () => {
    expect(() =>
      rd.assertStaging([...D1, '--command', "DELETE FROM events WHERE id IN ('a; SELECT 1')"])
    ).not.toThrow();
  });

  test('stockSqlProblem names nothing for the two statements the run sends', () => {
    expect(rd.stockSqlProblem("DELETE FROM events WHERE id IN ('evt_1');\n")).toBe('');
    expect(rd.stockSqlProblem(rd.acceptSqlFor({ acceptSql: ['pl_1', 'pl_2'] }))).toBe('');
  });
});

describe('makeCloud.d1Execute', () => {
  test('sends one --command with the statements, writes no temp file', async () => {
    const w = recordingCloud();
    await w.cloud.d1Execute([
      "DELETE FROM scan_aggregates WHERE event_id IN ('evt_1')",
      "DELETE FROM events WHERE id IN ('evt_1')",
    ]);
    expect(w.calls).toHaveLength(1);
    expect(w.calls[0]).not.toContain('--file');
    expect(w.calls[0].slice(0, 6)).toEqual(D1);
    expect(w.sent()).toEqual([
      "DELETE FROM scan_aggregates WHERE event_id IN ('evt_1');\nDELETE FROM events WHERE id IN ('evt_1');\n",
    ]);
    expect(w.writes).toEqual([]);
  });

  test("the query endpoint's completion line counts, singular or plural", async () => {
    for (const stdout of [DONE_ONE, DONE_MANY]) {
      const w = recordingCloud(() => ({ code: 0, stdout, stderr: '' }));
      await expect(w.cloud.d1Execute(["DELETE FROM events WHERE id IN ('e')"])).resolves.toBe(
        undefined
      );
    }
  });

  test("an import's completion line never counts as done", async () => {
    const w = recordingCloud(() => ({ code: 0, stdout: IMPORT_DONE, stderr: '' }));
    await expect(w.cloud.d1Execute(["DELETE FROM events WHERE id IN ('e')"])).rejects.toThrow(
      /no completion line/
    );
  });

  test('a purge too big for one SQL text goes in ordered texts, each under the D1 limit', async () => {
    const manifest = bigManifest(400, 200);
    const statements = pf.buildPurgeStatements(manifest, ['oak-lawn']);
    const w = recordingCloud();
    await w.cloud.d1Execute(statements);
    const texts = w.sent();
    expect(texts.length).toBeGreaterThan(1);
    for (const text of texts) {
      expect(bytes(text)).toBeLessThanOrEqual(pf.MAX_SQL_BYTES);
      expect(rd.stockSqlProblem(text)).toBe('');
    }
    // nothing lost, nothing reordered: the texts are the statements, in order
    expect(texts.join('')).toBe(statements.map((s) => `${s};\n`).join(''));
    // children before parents across texts: no scan row is deleted after its event
    const all = texts.join('');
    expect(all.lastIndexOf('DELETE FROM scan_aggregates')).toBeLessThan(
      all.indexOf('DELETE FROM events')
    );
    for (const item of manifest.items.filter((i) => i.kind === 'event')) {
      expect(all).toContain(`'${item.id}'`);
    }
    expect(w.calls.every((a) => !a.includes('--file'))).toBe(true);
  });

  test('a text that fails stops the purge: nothing after it is sent, and it throws', async () => {
    const statements = pf.buildPurgeStatements(bigManifest(400, 200), ['oak-lawn']);
    const total = pf.packStatements(statements).length;
    expect(total).toBeGreaterThan(2);
    const w = recordingCloud((_args, n) =>
      n === 2 ? { code: 1, stdout: '', stderr: 'D1_ERROR: boom' } : { code: 0, stdout: DONE_MANY }
    );
    await expect(w.cloud.d1Execute(statements)).rejects.toThrow(
      `wrangler d1 execute (2 of ${total}) failed (exit 1)`
    );
    expect(w.calls).toHaveLength(2);
  });

  test('a text D1 answers busy is retried on its own, then the rest are sent', async () => {
    const statements = pf.buildPurgeStatements(bigManifest(400, 200), ['oak-lawn']);
    const total = pf.packStatements(statements).length;
    const w = recordingCloud((_args, n) =>
      n === 2
        ? { code: 1, stdout: '', stderr: 'D1_ERROR: SQLITE_BUSY' }
        : { code: 0, stdout: DONE_MANY }
    );
    await w.cloud.d1Execute(statements);
    expect(w.calls).toHaveLength(total + 1);
    expect(w.sent()[1]).toBe(w.sent()[2]);
  });
});

describe('purge SQL sizes', () => {
  test('inListStatements splits a list so each statement fits, and keeps every value once', () => {
    const values = Array.from({ length: 50 }, (_, i) => `'v${String(i).padStart(3, '0')}'`);
    const out = pf.inListStatements('DELETE FROM t WHERE c IN', values, 120);
    expect(out.length).toBeGreaterThan(1);
    for (const s of out) expect(bytes(`${s};\n`)).toBeLessThanOrEqual(120);
    expect(out.flatMap((s) => s.match(/'v\d+'/g))).toEqual(values);
    expect(pf.inListStatements('DELETE FROM t WHERE c IN', [], 120)).toEqual([]);
  });

  test('a value that cannot fit in any statement throws rather than send an oversize text', () => {
    expect(() =>
      pf.inListStatements('DELETE FROM t WHERE c IN', [`'${'x'.repeat(200)}'`], 100)
    ).toThrow(/too long/);
    expect(() => pf.packStatements(['x'.repeat(200)], 100)).toThrow(/too long/);
  });

  test('packStatements fills each text up to the limit, in order', () => {
    const statements = Array.from({ length: 10 }, (_, i) => `DELETE FROM t WHERE c IN ('${i}')`);
    const texts = pf.packStatements(statements, 100);
    for (const t of texts) expect(bytes(t)).toBeLessThanOrEqual(100);
    expect(texts.join('')).toBe(statements.map((s) => `${s};\n`).join(''));
    // greedy: no two neighbouring texts would have fitted together
    for (let i = 1; i < texts.length; i++) {
      expect(bytes(texts[i - 1]) + bytes(texts[i].split('\n')[0] + '\n')).toBeGreaterThan(100);
    }
  });

  test("today's seed: the largest node's purge is one SQL text, and stays one at the longest ids", () => {
    const perNode = {};
    // The wider area (owner 2026-11-19) holds most rows and is packed into several
    // texts below; the one-text rule is for the places with a boundary.
    for (const e of SEED.events)
      if (e.node !== 'area') perNode[e.node] = (perNode[e.node] || 0) + 1;
    const [node, events] = Object.entries(perNode).sort((a, b) => b[1] - a[1])[0];
    // ids as the API makes them (evt_<uuid>, 40 characters)
    const real = pf.buildPurgeStatements(bigManifest(events, 40, node), [node]);
    expect(pf.packStatements(real)).toHaveLength(1);
    // and the longest SAFE_ID allows: still under the limit per text, however many
    const longest = pf.buildPurgeStatements(bigManifest(events, 200, node), [node]);
    for (const t of pf.packStatements(longest)) {
      expect(bytes(t)).toBeLessThanOrEqual(pf.MAX_SQL_BYTES);
    }
    // the wider area: more than one text, each under the limit
    const areaEvents = SEED.events.filter((e) => e.node === 'area').length;
    const area = pf.packStatements(
      pf.buildPurgeStatements(bigManifest(areaEvents, 40, 'area'), ['area'])
    );
    expect(area.length).toBeGreaterThan(1);
    for (const t of area) expect(bytes(t)).toBeLessThanOrEqual(pf.MAX_SQL_BYTES);
  });

  test('buildPurgeSql is the statements, each ended by ;\\n', () => {
    const m = bigManifest(3, 40);
    expect(pf.buildPurgeSql(m, ['oak-lawn'])).toBe(
      pf
        .buildPurgeStatements(m, ['oak-lawn'])
        .map((s) => `${s};\n`)
        .join('')
    );
  });
});
