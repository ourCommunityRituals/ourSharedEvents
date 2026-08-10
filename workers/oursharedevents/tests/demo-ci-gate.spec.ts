/**
 * demo-ci-gate.spec.ts — OSE-609: demo-as-CI-gate. "Break the demo = break the build."
 *
 * This suite runs inside the existing test gate (T0), so a broken demo surface,
 * a broken depth ladder, or a demo-row data_class leak fails the build — no
 * separate infra needed. It consumes the SAME registry the front door publishes
 * (OSE-610), so the checked URLs and the published URLs are one list.
 *
 * Three standing assertions (the "three layers" — one per tier, plus isolation):
 *   1. Smoke   — every canonical demo URL renders healthy.
 *   2. Depth   — the ladder gates by depth (free locks what paid unlocks).
 *   3. Isolation — every demo row is data_class='demo' (never leaks unlabeled).
 *
 * DEFERRED (production path): a deployed-URL smoke hitting the three live demo
 * URLs per release + a conformance-report line (OSE-560). This handler-level
 * gate is the always-on core.
 */
import { describe, it, expect } from 'vitest';
import { handleDemoIndex, handleDemoSite } from '../src/handlers/demo';
import { demoPaths } from '../src/lib/demo-registry';
import { getRiphDataset } from '../src/lib/mock-data';

/** Dispatch a registry path to its handler — mirrors the router's demo routes. */
function dispatch(path: string): Response {
  if (path === '/demo') return handleDemoIndex();
  const m = path.match(/^\/demo\/([^/]+)$/);
  if (m) return handleDemoSite(m[1]);
  throw new Error(`no demo handler for ${path}`);
}

const lockedCount = (html: string): number => (html.match(/depth-locked/g) ?? []).length;

describe('OSE-609 gate — smoke: every canonical demo URL renders healthy', () => {
  it('all registry paths return 200 with non-empty HTML', async () => {
    for (const path of demoPaths()) {
      const res = dispatch(path);
      expect(res.status, `${path} must be healthy`).toBe(200);
      const html = await res.text();
      expect(html.length, `${path} must render content`).toBeGreaterThan(500);
      expect(html).toContain('</html>');
    }
  });

  it('the checked URLs ARE the published registry (one list, never two)', () => {
    // Every registry path is dispatchable; a path with no handler throws above.
    expect(() => demoPaths().forEach(dispatch)).not.toThrow();
  });
});

describe('OSE-609 gate — depth: the ladder gates by depth', () => {
  it('free locks strictly more than mid, and mid more than premium', async () => {
    const free = lockedCount(await dispatch('/demo/free').text());
    const mid = lockedCount(await dispatch('/demo/mid').text());
    const premium = lockedCount(await dispatch('/demo/premium').text());
    // Monotonic ladder: each paid step unlocks sections the tier below cannot see.
    expect(free).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(premium);
  });

  it('free does NOT get the map (paid value line) — it renders locked at free', async () => {
    const free = await dispatch('/demo/free').text();
    expect(free).toContain('Corridor map');
    expect(free).toContain('depth-locked');
  });
});

describe('OSE-609 gate — isolation: demo rows never leak unlabeled', () => {
  it('every event and sponsor in the demo dataset is data_class="demo"', () => {
    const ds = getRiphDataset();
    expect(ds.data_class).toBe('demo');
    expect(ds.events.every((e) => e.data_class === 'demo')).toBe(true);
    expect(ds.sponsors.every((s) => s.data_class === 'demo')).toBe(true);
  });

  it('the honesty feature is present (a suppressed sub-floor bucket, labeled)', () => {
    const suppressed = getRiphDataset().ladderBuckets.filter((b) => b.suppressed);
    expect(suppressed.length).toBeGreaterThanOrEqual(1);
    expect(suppressed.every((b) => b.count < 5 && b.label.length > 0)).toBe(true);
  });
});
