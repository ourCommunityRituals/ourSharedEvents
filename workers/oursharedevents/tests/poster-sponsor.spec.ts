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

  test('poster sponsors come from the poster-bundle (OSE-867 — no separate sponsor-bundle call)', async () => {
    const body = await posterHtml();
    expect(body).toContain('renderPosterSponsors(data.sponsors)');
    expect(body).not.toContain("'/sponsor-bundle");
  });
});

// ─── SPON-4: Print safety ─────────────────────────────────────────────────────

describe('SPON-4: Poster sponsor section is print-safe (no clickable links)', () => {
  test('renderPosterSponsors does not inject <a href> tags', async () => {
    const body = await posterHtml();
    // Extract JS body of renderPosterSponsors (up to the next function).
    const fnStart = body.indexOf('function renderPosterSponsors');
    const fnEnd = body.indexOf('function renderPosterSlots', fnStart);
    expect(
      fnStart,
      'renderPosterSponsors must exist — an empty slice would pass vacuously'
    ).toBeGreaterThanOrEqual(0);
    expect(fnEnd).toBeGreaterThan(fnStart);
    const fnBody = body.slice(fnStart, fnEnd);
    expect(fnBody).toContain('poster-sponsor-item');
    expect(fnBody).not.toMatch(/<a\s+href/);
  });
});

// ─── Placement: sponsors sit under the title ────────────────────────────────

describe('Poster sponsor strip sits below the title, above the details and codes', () => {
  test('the strip is built after the poster title and before the body', async () => {
    const body = await posterHtml();
    const title = body.indexOf('data-testid="poster-title"');
    const strip = body.indexOf('data-testid="poster-sponsor-strip"');
    const details = body.indexOf('data-testid="poster-body"');
    const codes = body.indexOf('data-testid="poster-qr-section"');
    expect(title, 'poster title must exist').toBeGreaterThanOrEqual(0);
    expect(strip, 'sponsor strip follows the title').toBeGreaterThan(title);
    expect(strip, 'sponsor strip precedes the details and artwork').toBeLessThan(details);
    expect(strip, 'sponsor strip precedes the codes').toBeLessThan(codes);
  });
});
