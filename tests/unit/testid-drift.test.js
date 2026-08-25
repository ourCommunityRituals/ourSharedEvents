/**
 * Artifact-integrity #1 — testid-drift gate (SDET standard, from OSE-1005).
 *
 * Fails when a Playwright spec references a `data-testid` that is emitted
 * NOWHERE in source (dead / typo'd / aspirational selector) and is NOT already
 * in the triaged baseline. This catches the OSE-1003 roots 1 & 3 class (e.g.
 * `checkin-button` vs the real `checkin-submit`) statically — before a 14-min
 * live E2E — and stops new stale selectors from landing.
 *
 * Baseline (tests/unit/fixtures/testid-drift-baseline.json) is the known
 * backlog of pre-existing drift. It is enforced TIGHT in both directions:
 *   - no NEW drift (referenced-but-unemitted testid not in the baseline), and
 *   - no STALE baseline entry (a baselined testid that now IS emitted must be
 *     removed) — so the backlog can only shrink. `npm run lint:testids --update`
 *     regenerates it when a change is intentional.
 */

const fs = require('fs');
const path = require('path');
const { computeDrift } = require('../_shared/testid-inventory.js');

const repoRoot = path.resolve(__dirname, '..', '..');
const BASELINE = path.join(__dirname, 'fixtures', 'testid-drift-baseline.json');

describe('testid drift (OSE-1003 roots 1 & 3 class)', () => {
  const drift = computeDrift(repoRoot);
  const driftIds = new Set(drift.map((d) => d.testid));
  const baseline = new Set(JSON.parse(fs.readFileSync(BASELINE, 'utf8')));

  test('no NEW testid drift beyond the triaged baseline', () => {
    const newDrift = drift.filter((d) => !baseline.has(d.testid));
    const detail = newDrift.map((d) => `  ${d.testid} <- ${d.specs.join(', ')}`).join('\n');
    expect(
      newDrift.map((d) => d.testid),
      `NEW testid-drift — a spec references a data-testid the code never emits (fix the selector, implement the element, or \`npm run lint:testids -- --update\` if intentionally deferred):\n${detail}`
    ).toEqual([]);
  });

  test('baseline is tight — no entries that are no longer drift', () => {
    const stale = [...baseline].filter((id) => !driftIds.has(id));
    expect(
      stale,
      `Baseline has ${stale.length} stale entr(y/ies) — these testids are now emitted; remove them via \`npm run lint:testids -- --update\` so the backlog stays honest:\n  ${stale.join('\n  ')}`
    ).toEqual([]);
  });
});
