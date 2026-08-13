/**
 * OSE-734 / T7a — resolveAssetSource() pure lib + allocation-projection freeze.
 *
 * Two guarantees:
 *   1. TOTALITY (always-200 at the pure layer): for every one of the four
 *      formats, across {override set / only logo / nothing}, resolveAssetSource
 *      returns a source and NEVER null/undefined. Monogram is the terminal
 *      branch, independent of any R2 binding or palette endpoint.
 *   2. PROJECTION FREEZE (#25): the only thing stopping `format` from becoming a
 *      purchasable share dimension is that buildShareRotation projects only
 *      {id, tier, is_local} into allocateShares, whose output is {id, sharePct}.
 *      Pinned here (runtime output shape + source-level input shape) so a future
 *      format-weighting change fails CI.
 */

import { describe, test, expect } from 'vitest';
import { env } from 'cloudflare:test';
import {
  resolveAssetSource,
  isAssetFormat,
  ASSET_FORMATS,
  type AssetFormat,
} from '../src/lib/sponsor-asset';
import { allocateShares } from '../src/lib/sponsor-allocation';

interface TestEnv {
  TEST_SOURCE_FILES_JSON: string;
}
const tenv = () => env as unknown as TestEnv;

/** Strip TS block + line comments so source-shape gates see CODE, not prose. */
function stripComments(ts: string): string {
  return ts.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}
function sourceOf(re: RegExp): string {
  const sources: Record<string, string> = JSON.parse(tenv().TEST_SOURCE_FILES_JSON);
  const entry = Object.entries(sources).find(([p]) => re.test(p.replace(/\\/g, '/')));
  expect(entry, `source ${re} must be visible`).toBeTruthy();
  return entry![1];
}

describe('OSE-734 — resolveAssetSource totality (always-200 at the pure layer)', () => {
  test('override present → r2, for every format', () => {
    for (const fmt of ASSET_FORMATS) {
      const sponsor = {
        id: 's1',
        logo_url: 'https://x/logo.png',
        [`${fmt}_url`]: `sponsors/s1/${fmt}`,
      };
      const src = resolveAssetSource(sponsor, fmt);
      expect(src.kind).toBe('r2');
      expect(src).toEqual({ kind: 'r2', key: `sponsors/s1/${fmt}` });
    }
  });

  test('no override but logo present → proxy, for every format', () => {
    for (const fmt of ASSET_FORMATS) {
      const src = resolveAssetSource({ id: 's2', logo_url: 'https://x/logo.png' }, fmt);
      expect(src).toEqual({ kind: 'proxy', url: 'https://x/logo.png' });
    }
  });

  test('nothing set → monogram (terminal), for every format — NEVER null', () => {
    for (const fmt of ASSET_FORMATS) {
      const src = resolveAssetSource({ id: 's3' }, fmt);
      expect(src).toEqual({ kind: 'monogram', seed: 's3' });
      expect(src).not.toBeNull();
      expect(src).not.toBeUndefined();
    }
  });

  test('a 1-format sponsor still resolves a 200-able source for ALL four formats', () => {
    // Only 'poster' uploaded; the other three fall through to logo/monogram —
    // none returns null, so a surface never drops the sponsor (headline #25).
    const oneFormat = { id: 's4', poster_url: 'sponsors/s4/poster' };
    for (const fmt of ASSET_FORMATS) {
      const src = resolveAssetSource(oneFormat, fmt);
      expect(src.kind).toMatch(/^(r2|proxy|monogram)$/);
      if (fmt === 'poster') expect(src.kind).toBe('r2');
      else expect(src.kind).toBe('monogram'); // no logo_url here
    }
  });

  test('invalid format is fail-closed (throws), not silently coerced', () => {
    expect(() => resolveAssetSource({ id: 's5' }, 'billboard' as AssetFormat)).toThrow(
      /invalid format/i
    );
    expect(isAssetFormat('billboard')).toBe(false);
    expect(ASSET_FORMATS).toEqual(['poster', 'banner', 'vertical', 'square']);
  });

  test('pure: no hex literal and no palette I/O in the module CODE', () => {
    const code = stripComments(sourceOf(/lib\/sponsor-asset\.ts$/));
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,6}\b/); // no hex color literal
    expect(code).not.toMatch(/\bfetch\s*\(|\bpalette\b/i); // no I/O / palette read
  });
});

describe('OSE-734 — allocation-projection freeze (#25)', () => {
  test('allocateShares OUTPUT contains only {id, sharePct}', () => {
    const out = allocateShares([
      { id: 'a', tier: 'premium', is_local: false },
      { id: 'b', tier: 'base', is_local: true },
    ]);
    expect(out.length).toBe(2);
    for (const e of out) {
      expect(Object.keys(e).sort()).toEqual(['id', 'sharePct']);
    }
  });

  test('buildShareRotation INPUT to allocateShares is only {id, tier, is_local} (source freeze)', () => {
    // Strip comments first — allocateShares is mentioned in prose above the call.
    const src = stripComments(sourceOf(/lib\/sponsor-resolver\.ts$/));

    // Extract the object literal mapped into the real allocateShares(...) call.
    const call = src.slice(src.indexOf('allocateShares('));
    const mapped = call.slice(0, call.indexOf('))') + 2);
    expect(mapped).toMatch(/allocateShares/);

    // It must reference exactly the covenant projection keys...
    expect(mapped).toMatch(/\bid\s*:/);
    expect(mapped).toMatch(/\btier\s*:/);
    expect(mapped).toMatch(/\bis_local\s*:/);
    // ...and NEVER a format/url/slot/weight/rank/placement dimension.
    expect(mapped).not.toMatch(/url|format|slot|weight|rank|placement/i);
  });
});
