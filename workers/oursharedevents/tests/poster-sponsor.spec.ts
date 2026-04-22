/**
 * SPON-4: Poster surface sponsor tier rendering (OSE-177)
 * AS-2:   data-testid coverage on Poster page (OSE-47)
 *
 * Verifies:
 *   - Poster HTML has 10+ distinct data-testid values
 *   - Sponsor tier CSS classes present (premium, mid, local)
 *   - Tier-based renderTierRow logic present in JS
 *   - poster-sponsor-strip and sponsor-label present
 *   - Print-safe: no clickable links inside sponsor strip JS
 */

import { describe, test, expect } from 'vitest';
import { handlePosterPage } from '../src/handlers/pages';

function posterHtml(): Promise<string> {
  return handlePosterPage({} as never).text();
}

// ─── AS-2: data-testid coverage ──────────────────────────────────────────────

describe('AS-2: Poster page has 10+ data-testid values', () => {
  const requiredTestIds = [
    'poster-header',
    'poster-print',
    'poster-container',
    'poster-event-select',
    'poster-event-picker',
    'poster-area',
    'poster-card',
    'poster-event-title',
    'poster-meta',
    'poster-qr',
    'poster-sponsor-strip',
    'poster-footer',
  ];

  for (const id of requiredTestIds) {
    test(`poster page has data-testid="${id}"`, async () => {
      expect(await posterHtml()).toContain(`data-testid="${id}"`);
    });
  }

  test('poster page has at least 12 distinct data-testid values', async () => {
    const body = await posterHtml();
    const matches = body.match(/data-testid="([^"]+)"/g) ?? [];
    const ids = new Set(matches.map((m) => m.match(/data-testid="([^"]+)"/)?.[1] ?? ''));
    expect(ids.size).toBeGreaterThanOrEqual(12);
  });
});

// ─── SPON-4: Tier rendering CSS ───────────────────────────────────────────────

describe('SPON-4: Poster sponsor tier CSS present', () => {
  test('poster has .poster-sponsor-tier-row CSS', async () => {
    expect(await posterHtml()).toMatch(/\.poster-sponsor-tier-row\s*\{/);
  });

  test('poster has .poster-sponsor--premium CSS', async () => {
    expect(await posterHtml()).toMatch(/\.poster-sponsor--premium/);
  });

  test('poster has .poster-sponsor--mid CSS', async () => {
    expect(await posterHtml()).toMatch(/\.poster-sponsor--mid/);
  });

  test('poster has .poster-sponsor--local CSS', async () => {
    expect(await posterHtml()).toMatch(/\.poster-sponsor--local/);
  });

  test('poster has .poster-sponsor-tier-label CSS', async () => {
    expect(await posterHtml()).toMatch(/\.poster-sponsor-tier-label\s*\{/);
  });
});

// ─── SPON-4: Tier-based JS rendering logic ────────────────────────────────────

describe('SPON-4: Poster sponsor JS groups sponsors by tier', () => {
  test('loadPosterSponsors filters premium tiers (title, platinum)', async () => {
    const body = await posterHtml();
    expect(body).toContain("s.tier === 'title'");
    expect(body).toContain("s.tier === 'platinum'");
  });

  test('loadPosterSponsors filters mid tiers (gold, silver)', async () => {
    const body = await posterHtml();
    expect(body).toContain("s.tier === 'gold'");
    expect(body).toContain("s.tier === 'silver'");
  });

  test('loadPosterSponsors filters local tiers (bronze, primary)', async () => {
    const body = await posterHtml();
    expect(body).toContain("s.tier === 'bronze'");
    expect(body).toContain("s.tier === 'primary'");
  });

  test('renderTierRow uses poster-sponsor-premium testid', async () => {
    expect(await posterHtml()).toContain("'poster-sponsor-premium'");
  });

  test('renderTierRow uses poster-sponsor-mid testid', async () => {
    expect(await posterHtml()).toContain("'poster-sponsor-mid'");
  });

  test('renderTierRow uses poster-sponsor-local testid', async () => {
    expect(await posterHtml()).toContain("'poster-sponsor-local'");
  });

  test('sponsor strip has Sponsored By label with testid', async () => {
    const body = await posterHtml();
    expect(body).toContain('data-testid="poster-sponsor-label"');
    expect(body).toContain('Sponsored By');
  });

  test('poster sponsor JS fetches from sponsor-bundle?surface=poster', async () => {
    expect(await posterHtml()).toContain('sponsor-bundle?surface=poster');
  });
});

// ─── SPON-4: Print safety ─────────────────────────────────────────────────────

describe('SPON-4: Poster sponsor section is print-safe (no clickable links)', () => {
  test('loadPosterSponsors does not inject <a href> tags', async () => {
    const body = await posterHtml();
    // Extract JS body of loadPosterSponsors
    const fnStart = body.indexOf('async function loadPosterSponsors');
    const fnEnd = body.indexOf('init();', fnStart);
    const fnBody = fnStart >= 0 && fnEnd > fnStart ? body.slice(fnStart, fnEnd) : '';
    expect(fnBody).not.toMatch(/<a\s+href/);
  });
});
