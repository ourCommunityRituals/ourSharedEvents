/**
 * demo-registry.spec.ts — OSE-610 canonical link registry.
 *
 * Locks the registry: the one address book every outward reference cites and the
 * CI gate (OSE-609) checks. Slug permanence — the canonical paths are pinned so
 * changing one goes red (a changed slug silently 404s every poster/QR/memo that
 * encoded it).
 */
import { describe, it, expect } from 'vitest';
import {
  DEMO_LINKS,
  DEMO_REGISTRY_VERSION,
  demoPaths,
  demoTierLinks,
  demoLinkByKey,
} from '../src/lib/demo-registry';

describe('OSE-610: canonical demo link registry', () => {
  it('contains the front door + exactly three tier sites', () => {
    expect(demoLinkByKey('demo-index')?.path).toBe('/demo');
    expect(
      demoTierLinks()
        .map((l) => l.tier)
        .sort()
    ).toEqual(['free', 'mid', 'premium']);
  });

  it('every path is unique and namespaced under /demo', () => {
    const paths = demoPaths();
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths.every((p) => p === '/demo' || p.startsWith('/demo/'))).toBe(true);
  });

  it('slug permanence — canonical paths are pinned (changing one is a breaking change)', () => {
    expect(demoPaths().sort()).toEqual(['/demo', '/demo/free', '/demo/mid', '/demo/premium']);
  });

  it('is versioned', () => {
    expect(DEMO_REGISTRY_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('every link carries a title + description (usable in outward material)', () => {
    expect(DEMO_LINKS.every((l) => l.title.length > 0 && l.description.length > 0)).toBe(true);
  });
});
