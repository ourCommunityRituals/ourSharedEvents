/**
 * SPON-4: Poster surface sponsor rendering (OSE-177)
 * AS-2:   data-testid coverage on Poster page (OSE-47)
 *
 * Verifies:
 *   - Poster HTML has 12+ distinct data-testid values
 *   - poster-sponsor-strip and sponsor-label present
 *   - Print-safe: no clickable links inside sponsor strip JS
 */

import { describe, test, expect } from 'vitest';
import { handlePosterPage } from '../src/handlers/pages';

function posterHtml(): Promise<string> {
  return handlePosterPage({} as never).then((r) => r.text());
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
    'poster-title',
    'poster-meta',
    'poster-qr-section',
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

// ─── SPON-4: Sponsor JS rendering ────────────────────────────────────────────

describe('SPON-4: Poster sponsor JS rendering', () => {
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
