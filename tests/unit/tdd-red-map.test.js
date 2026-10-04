// The TDD red layer's bookkeeping: every red story is on the map, and the map
// never says Done while its test is still wrapped (workers/oursharedevents/docs/ops/TDD-RED-MAP.md).
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
// vitest globals: true (vitest.config.ts), as in the sibling CI meta-tests.

const ROOT = join(__dirname, '..', '..');
const MAP = readFileSync(
  join(ROOT, 'workers', 'oursharedevents', 'docs', 'ops', 'TDD-RED-MAP.md'),
  'utf8'
);

function specFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() && d.name !== 'node_modules' && d.name !== 'helpers' && d.name !== '_helpers'
      ? specFiles(join(dir, d.name))
      : /\.spec\.ts$/.test(d.name)
        ? [join(dir, d.name)]
        : []
  );
}

const wrapped = new Set();
for (const root of [join(ROOT, 'workers', 'oursharedevents', 'tests'), join(ROOT, 'tests')]) {
  for (const f of specFiles(root)) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/^\s*redStory\(\s*'(OSE-\d+)'/gm)) wrapped.add(m[1]);
  }
}

const redTable = MAP.split('## Red now')[1]?.split('## Not written yet')[0] ?? '';
const rows = [...redTable.matchAll(/^\|\s*(OSE-\d+)\s*\|.*\|\s*(Open|Done)\s*\|\s*$/gm)].map(
  (m) => ({
    story: m[1],
    status: m[2],
  })
);

describe('TDD red map', () => {
  it('has red tests wrapped (else this guard is vacuous)', () => {
    expect(wrapped.size).toBeGreaterThan(0);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('every wrapped red story is listed on the map', () => {
    const listed = new Set(rows.map((r) => r.story));
    expect([...wrapped].filter((s) => !listed.has(s))).toEqual([]);
  });

  it('no story is marked Done while its test is still wrapped', () => {
    const doneButWrapped = rows.filter((r) => r.status === 'Done' && wrapped.has(r.story));
    expect(doneButWrapped.map((r) => r.story)).toEqual([]);
  });

  it('no story is Open on the map with no wrapped test left', () => {
    const open = new Set(rows.filter((r) => r.status === 'Open').map((r) => r.story));
    expect([...open].filter((s) => !wrapped.has(s))).toEqual([]);
  });
});
