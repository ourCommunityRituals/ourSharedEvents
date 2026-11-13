// vitest globals: true (vitest.config.ts). OSE-2022 / OSE-2025.
//
// THE RULE. An address a machine reads has no person to answer a Cloudflare
// challenge. Today those are the calendar files: every route in the router that
// ends in `.ics`. Each one must have
//   1. a read in the stg edge probe (scripts/stock/edge-probe.mjs), so a run says
//      whether the edge lets it through, and
//   2. cover in the stg CI skip rule (scripts/ci/cf-waf-stg-ci-skip.mjs), so CI's
//      own read of it reaches the Worker.
// Without both, the route's staging tests can pass on a challenge and prove
// nothing (found on /brands/:brand/calendar.ics, 2026-11-13).
//
// The routes are read out of the router source, so a new `.ics` route fails this
// gate until it has a probe and cover.
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const ROUTER = resolve(__dirname, '../../workers/oursharedevents/src/router.ts');

let PROBES;
let pathCovered;
beforeAll(async () => {
  ({ PROBES } = await import('../../scripts/stock/edge-probe.mjs'));
  ({ pathCovered } = await import('../../scripts/ci/cf-waf-stg-ci-skip.mjs'));
});

/** Every `pathname.match(/^…\.ics$/)` pattern in the router, as a RegExp. */
function icsRoutes() {
  const src = readFileSync(ROUTER, 'utf8');
  const out = [];
  for (const m of src.matchAll(/pathname\.match\(\s*\/(\^[^\n]*?\\\.ics\$)\/\s*\)/g)) {
    out.push(new RegExp(m[1]));
  }
  return out;
}

describe('every machine-read address has an edge probe and skip-rule cover', () => {
  test('the reader finds the calendar routes', () => {
    const routes = icsRoutes().map(String);
    expect(routes).toContain(String(/^\/events\/([^/]+)\/calendar\.ics$/));
    expect(routes).toContain(String(/^\/brands\/([^/]+)\/calendar\.ics$/));
  });

  test('no .ics route is matched in a way the reader cannot see', () => {
    // Every mention of `.ics` in routing code must be one of the patterns read
    // above, so a route written another way (startsWith, endsWith, a string
    // compare) cannot slip past this gate.
    const src = readFileSync(ROUTER, 'utf8');
    const code = src.slice(src.indexOf('*/') + 2); // skip the route-table comment
    const mentions = code
      .split('\n')
      .filter((line) => /\.ics/.test(line) && !/^\s*(\/\/|\*)/.test(line));
    expect(mentions.length).toBe(icsRoutes().length);
  });

  test('each route has a probe, and the skip rule covers that probe', () => {
    for (const route of icsRoutes()) {
      const probe = PROBES.find((p) => route.test(p.path));
      expect(probe, `edge probe has a read for ${route}`).toBeDefined();
      expect(pathCovered(probe.path), `skip rule covers ${probe.path}`).toBe(true);
    }
  });

  test('a calendar probe accepts only answers the Worker gives, never 403', () => {
    for (const probe of PROBES.filter((p) => p.path.endsWith('.ics'))) {
      expect(probe.expect.length).toBeGreaterThan(0);
      expect(probe.expect).not.toContain(403);
    }
  });
});
