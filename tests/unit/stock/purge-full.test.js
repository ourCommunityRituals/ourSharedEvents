/* eslint-disable security/detect-non-literal-fs-filename, security/detect-non-literal-regexp -- reads the repo's own migrations folder; every pattern is built from fixed fragments */
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');

let buildPurgeSql;
let purgeR2Keys;
let listStaleManifests;
let listNewerManifests;
let manifestName;
let parseManifestName;
let PURGE_TABLES;
let PURGE_EXEMPT;
beforeAll(async () => {
  ({
    buildPurgeSql,
    purgeR2Keys,
    listStaleManifests,
    listNewerManifests,
    manifestName,
    parseManifestName,
    PURGE_TABLES,
    PURGE_EXEMPT,
  } = await import('../../../scripts/stock/purge-full.mjs'));
});

const MIGRATIONS = path.join(__dirname, '../../../workers/oursharedevents/migrations');

// ── The schema as the migrations leave it ───────────────────────────────────
// Replays CREATE TABLE / DROP TABLE / ALTER TABLE (rename, add, rename column,
// drop column) in file order, so a rebuilt or renamed table reads as it is now.
const IDENT = String.raw`["\x60\[]?([A-Za-z_][A-Za-z0-9_]*)["\x60\]]?`;
const STATEMENT = new RegExp(
  String.raw`\b(?:CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+${IDENT}\s*\(` +
    String.raw`|DROP\s+TABLE(?:\s+IF\s+EXISTS)?\s+${IDENT}` +
    String.raw`|ALTER\s+TABLE\s+${IDENT}\s+(?:RENAME\s+TO\s+${IDENT}` +
    String.raw`|ADD\s+(?:COLUMN\s+)?${IDENT}([^;]*)` +
    String.raw`|RENAME\s+(?:COLUMN\s+)?${IDENT}\s+TO\s+${IDENT}` +
    String.raw`|DROP\s+(?:COLUMN\s+)?${IDENT}))`,
  'gi'
);

function parenBody(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return [text.slice(open + 1, i), i];
  }
  throw new Error('unbalanced parentheses');
}

function topLevelParts(body) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  return parts.map((s) => s.trim()).filter(Boolean);
}

// table -> { file, columns: Map(column -> definition), fks: [{ column, parent }] }
// `extraSql` is replayed after the real migrations, as if it were the next one.
function finalSchema(extraSql = '') {
  const tables = new Map();
  const sources = readdirSync(MIGRATIONS)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort()
    .map((file) => [file, readFileSync(path.join(MIGRATIONS, file), 'utf8')]);
  if (extraSql) sources.push(['9999_fixture.sql', extraSql]);
  for (const [file, sql] of sources) {
    const text = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
    const re = new RegExp(STATEMENT.source, 'gi');
    let m;
    while ((m = re.exec(text))) {
      if (m[1]) {
        const [body, end] = parenBody(text, m.index + m[0].length - 1);
        re.lastIndex = end;
        if (/IF\s+NOT\s+EXISTS/i.test(m[0]) && tables.has(m[1])) continue;
        const columns = new Map();
        const fks = [];
        for (const part of topLevelParts(body)) {
          const fk = part.match(
            new RegExp(String.raw`^FOREIGN\s+KEY\s*\(\s*${IDENT}\s*\)\s*REFERENCES\s+${IDENT}`, 'i')
          );
          if (fk) fks.push({ column: fk[1], parent: fk[2] });
          if (/^(CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|CHECK)\b/i.test(part)) continue;
          const col = part.match(new RegExp(`^${IDENT}`))[1];
          columns.set(col, part);
        }
        tables.set(m[1], { file, columns, fks });
      } else if (m[2]) {
        tables.delete(m[2]);
      } else if (m[3]) {
        const t = tables.get(m[3]);
        if (!t) throw new Error(`${file}: ALTER of unknown table ${m[3]}`);
        if (m[4]) {
          tables.delete(m[3]);
          tables.set(m[4], t);
        } else if (m[5]) {
          t.columns.set(m[5], `${m[5]} ${m[6]}`);
        } else if (m[7]) {
          const def = t.columns.get(m[7]);
          t.columns.delete(m[7]);
          t.columns.set(m[8], def);
          for (const fk of t.fks) if (fk.column === m[7]) fk.column = m[8];
        } else if (m[9]) {
          t.columns.delete(m[9]);
        }
      }
    }
  }
  // inline `col TEXT REFERENCES parent(id)` foreign keys
  for (const t of tables.values()) {
    for (const [col, def] of t.columns) {
      const ref = String(def).match(new RegExp(String.raw`\bREFERENCES\s+${IDENT}`, 'i'));
      if (ref) t.fks.push({ column: col, parent: ref[1] });
    }
  }
  return tables;
}

// Columns that hold a manifest id: by name, or by a foreign key to a table whose
// rows the manifest records.
const KEY_NAMES = new Set(['event_id', 'sponsor_business_id', 'placement_id']);
const KEY_PARENTS = new Set([
  'events',
  'sponsor_business',
  'sponsor_placement',
  'poster_deployments',
]);

function keyedColumns(tables) {
  const out = [];
  for (const [table, t] of tables) {
    const fkCols = new Set(t.fks.filter((f) => KEY_PARENTS.has(f.parent)).map((f) => f.column));
    for (const col of t.columns.keys()) {
      if (KEY_NAMES.has(col) || fkCols.has(col)) out.push(`${table}.${col}`);
    }
  }
  return out.sort();
}

// ── A two-node manifest ─────────────────────────────────────────────────────
const manifest = {
  date: '2026-11-04',
  items: [
    { kind: 'sponsor', id: 'sp_oak_1', node: 'oak-lawn', tier: 'premium' },
    { kind: 'sponsor', id: 'sp_oak_2', node: 'oak-lawn', tier: 'local' },
    { kind: 'sponsor', id: 'sp_bev_1', node: 'beverly', tier: 'premium' },
    { kind: 'event', id: 'evt_oak_1', node: 'oak-lawn' },
    { kind: 'poster', id: 'pd_oak_1', node: 'oak-lawn' },
    { kind: 'upload', id: 'events/evt_oak_1/art.png', node: 'oak-lawn' },
    { kind: 'placement', id: 'spl_oak_1', node: 'oak-lawn' },
    { kind: 'event', id: 'evt_oak_2', node: 'oak-lawn' },
    { kind: 'poster', id: 'pd_oak_2', node: 'oak-lawn' },
    { kind: 'event', id: 'evt_bev_1', node: 'beverly' },
    { kind: 'poster', id: 'pd_bev_1', node: 'beverly' },
    { kind: 'upload', id: 'events/evt_bev_1/art.png', node: 'beverly' },
    { kind: 'placement', id: 'spl_bev_1', node: 'beverly' },
  ],
  qr: [],
  acceptSql: ['spl_oak_1', 'spl_bev_1'],
  short: {},
  warnings: [],
};

const statements = (sql) =>
  sql
    .split(';\n')
    .map((s) => s.trim())
    .filter(Boolean);
const literals = (sql) => [...sql.matchAll(/'([^']*)'/g)].map((m) => m[1]);
// eslint-disable-next-line security/detect-unsafe-regex -- each group is anchored on a quote, no backtracking blow-up
const DELETE_SHAPE = /^DELETE FROM ([a-z_]+) WHERE ([a-z_]+) IN \('[^']+'(?:, '[^']+')*\)$/;

describe('buildPurgeSql', () => {
  test("for ['oak-lawn'] it names only Oak Lawn ids, and every one of them", () => {
    const sql = buildPurgeSql(manifest, ['oak-lawn']);
    const oak = new Set(['sp_oak_1', 'sp_oak_2', 'evt_oak_1', 'evt_oak_2', 'pd_oak_1', 'pd_oak_2']);
    const named = new Set(literals(sql));
    expect([...named].filter((id) => !oak.has(id))).toEqual([]);
    expect([...oak].filter((id) => !named.has(id))).toEqual([]);
  });

  test('every statement is DELETE … WHERE <col> IN (<non-empty list>), separated by ;\\n', () => {
    const sql = buildPurgeSql(manifest, ['oak-lawn', 'beverly']);
    expect(sql.endsWith(';\n')).toBe(true);
    const list = statements(sql);
    expect(list.length).toBeGreaterThan(0);
    for (const s of list) expect(s).toMatch(DELETE_SHAPE);
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bUPDATE\b/i);
    expect(sql).not.toMatch(/\bIN\s*\(\s*\)/i);
    expect(sql).not.toMatch(/\bBEGIN\b|\bCOMMIT\b|\bTRANSACTION\b/i);
    // one DELETE per statement: no DELETE without its own WHERE … IN (
    expect(sql.match(/\bDELETE\b/gi).length).toBe(list.length);
    expect(sql.match(/\bWHERE [a-z_]+ IN \('/g).length).toBe(list.length);
  });

  test('child tables are deleted before events and before sponsor_business', () => {
    const list = statements(buildPurgeSql(manifest, ['oak-lawn']));
    const tableAt = list.map((s) => s.match(DELETE_SHAPE)[1]);
    const eventsAt = tableAt.indexOf('events');
    const sponsorsAt = tableAt.indexOf('sponsor_business');
    expect(eventsAt).toBeGreaterThan(0);
    expect(sponsorsAt).toBeGreaterThan(0);
    list.forEach((s, i) => {
      const [, table, col] = s.match(DELETE_SHAPE);
      if (table !== 'events' && table !== 'sponsor_business') {
        expect(i, `${table}.${col}`).toBeLessThan(Math.min(eventsAt, sponsorsAt));
      }
    });
  });

  test('child rows go by event_id or sponsor id; events and sponsors only by recorded id', () => {
    const list = statements(buildPurgeSql(manifest, ['oak-lawn']));
    const by = (table, col) =>
      list.find((s) => s.startsWith(`DELETE FROM ${table} WHERE ${col} IN (`));
    expect(by('sponsor_placement', 'event_id')).toContain("'evt_oak_1', 'evt_oak_2'");
    expect(by('sponsor_placement', 'sponsor_business_id')).toContain("'sp_oak_1', 'sp_oak_2'");
    expect(by('poster_deployments', 'event_id')).toBeDefined();
    expect(by('scan_placement_events', 'event_id')).toBeDefined();
    expect(by('shortlinks', 'event_id')).toBeDefined();
    expect(by('event_codes', 'event_id')).toBeDefined();
    expect(by('events', 'id')).toBe("DELETE FROM events WHERE id IN ('evt_oak_1', 'evt_oak_2')");
    expect(by('sponsor_business', 'id')).toBe(
      "DELETE FROM sponsor_business WHERE id IN ('sp_oak_1', 'sp_oak_2')"
    );
    // placement ids and upload keys are never embedded: placements go by event_id
    expect(literals(list.join('\n'))).not.toContain('spl_oak_1');
    expect(literals(list.join('\n'))).not.toContain('events/evt_oak_1/art.png');
  });

  test('a node with no ids of a kind emits no statement for it, never IN ()', () => {
    const onlySponsors = {
      ...manifest,
      items: [{ kind: 'sponsor', id: 'sp_x', node: 'beverly', tier: 'premium' }],
    };
    const list = statements(buildPurgeSql(onlySponsors, ['beverly']));
    expect(list.length).toBeGreaterThan(0);
    for (const s of list) {
      expect(s).toMatch(/WHERE (sponsor_business_id|sponsor_id|id) IN \('sp_x'\)$/);
    }
    expect(list.some((s) => s.startsWith('DELETE FROM events '))).toBe(false);
  });

  test('no ids at all gives an empty string', () => {
    expect(buildPurgeSql(manifest, [])).toBe('');
    expect(buildPurgeSql(manifest, ['blue-island'])).toBe('');
  });

  test.each([
    ["evt'1", 'a quote'],
    ['evt_1; DROP TABLE events', 'a statement'],
    ['evt 1', 'a space'],
    ['', 'empty'],
    ['x'.repeat(201), 'over 200 chars'],
  ])('refuses an id with %s (%s)', (bad) => {
    const m = { ...manifest, items: [{ kind: 'event', id: bad, node: 'oak-lawn' }] };
    expect(() => buildPurgeSql(m, ['oak-lawn'])).toThrow(/unsafe id/);
  });

  test('refuses a non-string id', () => {
    const m = { ...manifest, items: [{ kind: 'event', id: 42, node: 'oak-lawn' }] };
    expect(() => buildPurgeSql(m, ['oak-lawn'])).toThrow(/unsafe id/);
  });

  test('refuses an item kind it does not know, rather than purge half a node', () => {
    const m = { ...manifest, items: [{ kind: 'mystery', id: 'm_1', node: 'oak-lawn' }] };
    expect(() => buildPurgeSql(m, ['oak-lawn'])).toThrow(/unknown manifest item kind/);
  });

  test('refuses an id that the manifest also records under a node not being purged', () => {
    const m = {
      ...manifest,
      items: [
        { kind: 'sponsor', id: 'sp_shared', node: 'oak-lawn', tier: 'premium' },
        { kind: 'sponsor', id: 'sp_shared', node: 'beverly', tier: 'premium' },
      ],
    };
    expect(() => buildPurgeSql(m, ['oak-lawn'])).toThrow(/also recorded/);
    expect(() => buildPurgeSql(m, ['oak-lawn', 'beverly'])).not.toThrow();
  });

  test('a repeated id is named once', () => {
    const m = {
      ...manifest,
      items: [
        { kind: 'event', id: 'evt_1', node: 'oak-lawn' },
        { kind: 'event', id: 'evt_1', node: 'oak-lawn' },
      ],
    };
    expect(buildPurgeSql(m, ['oak-lawn'])).toContain("DELETE FROM events WHERE id IN ('evt_1');");
  });
});

describe('purge coverage, read from workers/oursharedevents/migrations', () => {
  const tables = finalSchema();

  test('the parser sees the tables it must (sanity)', () => {
    for (const t of ['events', 'sponsor_business', 'sponsor_placement', 'poster_deployments']) {
      expect(tables.has(t), t).toBe(true);
    }
    expect(tables.has('sponsors')).toBe(false); // dropped in 0067
    expect(tables.has('scans')).toBe(false); // dropped in 0062
  });

  // Keyed columns that are neither purged nor exempt. Exemptions are per column.
  const uncovered = (schema) => {
    const purged = new Set(PURGE_TABLES.map((p) => `${p.table}.${p.column}`));
    return keyedColumns(schema).filter(
      (key) => !purged.has(key) && !Object.hasOwn(PURGE_EXEMPT, key)
    );
  };

  test('every manifest-id column is purged or exempt with a reason', () => {
    expect(uncovered(tables)).toEqual([]);
  });

  test('a new key column on an exempt table fails the gate', () => {
    const next = finalSchema('ALTER TABLE export_manifest ADD COLUMN sponsor_business_id TEXT;');
    expect(uncovered(next)).toEqual(['export_manifest.sponsor_business_id']);
  });

  test('every purge entry names a table and column that exist now', () => {
    for (const { table, column } of PURGE_TABLES) {
      expect(tables.get(table)?.columns.has(column), `${table}.${column}`).toBe(true);
    }
  });

  test('every exemption names a real keyed column, is not also purged, and gives a reason', () => {
    const keyed = new Set(keyedColumns(tables));
    for (const [key, reason] of Object.entries(PURGE_EXEMPT)) {
      expect(keyed.has(key), key).toBe(true);
      expect(
        PURGE_TABLES.some((p) => `${p.table}.${p.column}` === key),
        key
      ).toBe(false);
      expect(typeof reason === 'string' && reason.length > 20, key).toBe(true);
    }
  });

  test('a child table is purged before every parent its foreign keys point at', () => {
    // events.series_id → event_series is the one cycle: event_series.venue_id points back at
    // events. The stock build never sets series_id (only an admin links a series), so
    // event_series rows keyed by a stock event go first.
    const ALLOWED = new Set(['events.series_id']);
    const first = new Map();
    const last = new Map();
    PURGE_TABLES.forEach(({ table }, i) => {
      if (!first.has(table)) first.set(table, i);
      last.set(table, i);
    });
    for (const [child, t] of tables) {
      if (!first.has(child)) continue;
      for (const fk of t.fks) {
        if (fk.parent === child || !first.has(fk.parent)) continue;
        if (ALLOWED.has(`${child}.${fk.column}`)) continue;
        expect(last.get(child), `${child}.${fk.column} → ${fk.parent}`).toBeLessThan(
          first.get(fk.parent)
        );
      }
    }
  });
});

describe('purgeR2Keys', () => {
  test('returns the upload keys for the named nodes only', () => {
    expect(purgeR2Keys(manifest, ['oak-lawn'])).toEqual(['events/evt_oak_1/art.png']);
    expect(purgeR2Keys(manifest, ['oak-lawn', 'beverly']).sort()).toEqual([
      'events/evt_bev_1/art.png',
      'events/evt_oak_1/art.png',
    ]);
    expect(purgeR2Keys(manifest, [])).toEqual([]);
  });

  test('refuses an unsafe key', () => {
    const m = { ...manifest, items: [{ kind: 'upload', id: 'a b; rm -rf', node: 'oak-lawn' }] };
    expect(() => purgeR2Keys(m, ['oak-lawn'])).toThrow(/unsafe id/);
  });
});

describe('manifest names', () => {
  test('manifestName is manifest-YYYY-MM-DD-<runId>-<attempt>.json', () => {
    expect(manifestName('2026-11-04', '18934572001', '1')).toBe(
      'manifest-2026-11-04-18934572001-1.json'
    );
    expect(manifestName('2026-11-04', 7, 2)).toBe('manifest-2026-11-04-7-2.json');
  });

  test.each([
    ['2026-11-4', '1', '1'],
    ['2026-02-30', '1', '1'],
    ['2026-11-04', 'run-1', '1'],
    ['2026-11-04', '', '1'],
    ['2026-11-04', '1/../2', '1'],
    ['2026-11-04', '1', undefined],
    ['2026-11-04', '1', '0'],
    ['2026-11-04', '1', '01'],
    ['2026-11-04', '1', '1/..'],
  ])('manifestName refuses %s / %s / %s', (date, runId, attempt) => {
    expect(() => manifestName(date, runId, attempt)).toThrow(/manifestName/);
  });

  test('parseManifestName reads an exact name and nothing else', () => {
    expect(parseManifestName('manifest-2026-11-04-18934572001-2.json')).toEqual({
      date: '2026-11-04',
      runId: '18934572001',
      attempt: '2',
    });
    for (const bad of [
      'manifest-2026-11-04-run-12345678-1.json',
      'manifest-2026-11-04.json',
      'manifest-2026-11-04-1.json', // no attempt
      'manifest-2026-11-04-1-0.json',
      'stock/manifest-2026-11-04-1-1.json',
      'manifest-2026-11-04-1-1.json.bak',
      'manifest-2026-13-01-1-1.json',
      'xmanifest-2026-11-04-1-1.json',
      null,
    ]) {
      expect(parseManifestName(bad), String(bad)).toBeNull();
    }
  });
});

describe('listStaleManifests', () => {
  const n = (date, run, attempt = 1) => `manifest-${date}-${run}-${attempt}.json`;

  // Ordered by run start (run id, then attempt), never by date: a re-run of an older
  // run carries a later date but is not newer (CCR 2026-11-07 L3-08).
  test('every manifest from an earlier run than the newest passing one, oldest run first', () => {
    const names = [n('2026-11-03', 300), n('2026-11-01', 100), n('2026-11-02', 200)];
    expect(listStaleManifests(names, n('2026-11-03', 300))).toEqual([
      n('2026-11-01', 100),
      n('2026-11-02', 200),
    ]);
  });

  test('a same-day rerun makes the earlier run stale, and never a later one', () => {
    const names = [
      n('2026-11-04', 9),
      n('2026-11-04', 10),
      n('2026-11-04', 11),
      n('2026-11-05', 12),
    ];
    // ordered by run id as a number: 9 < 10, though "9" > "10" as text
    expect(listStaleManifests(names, n('2026-11-04', 10))).toEqual([n('2026-11-04', 9)]);
  });

  test('a re-run of the same run makes the earlier attempt stale, ordered as numbers', () => {
    const names = [n('2026-11-04', 10, 1), n('2026-11-04', 10, 9), n('2026-11-04', 10, 11)];
    expect(listStaleManifests(names, n('2026-11-04', 10, 2))).toEqual([n('2026-11-04', 10, 1)]);
    expect(listStaleManifests(names, n('2026-11-04', 10, 10))).toEqual([
      n('2026-11-04', 10, 1),
      n('2026-11-04', 10, 9),
    ]);
  });

  test('a name that is not an exact manifest name is never stale', () => {
    const names = ['manifest-2026-11-01-run-12345678-1.json', 'notes.txt', n('2026-11-01', 5)];
    expect(parseManifestName('manifest-2026-11-01-run-12345678-1.json')).toBeNull();
    expect(listStaleManifests(names, n('2026-11-03', 9))).toEqual([n('2026-11-01', 5)]);
  });

  test('a later date from an earlier run is stale; an earlier date from a later run is not', () => {
    const names = [n('2026-11-06', 100), n('2026-11-02', 300)];
    expect(listStaleManifests(names, n('2026-11-04', 200))).toEqual([n('2026-11-06', 100)]);
    expect(listNewerManifests(names, n('2026-11-04', 200))).toEqual([n('2026-11-02', 300)]);
  });

  test('refuses a newest-passing value that is not a manifest name', () => {
    expect(() => listStaleManifests([n('2026-11-01', 1)], '2026-11-03')).toThrow(/manifest name/);
  });
});
