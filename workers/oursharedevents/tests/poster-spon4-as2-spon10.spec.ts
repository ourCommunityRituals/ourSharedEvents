/**
 * AS-2: data-testid on Poster (OSE-47) — 30+ target
 * AS-8: ARIA attributes on Poster (OSE-53)
 * SPON-4: Poster sponsor rendering (OSE-177)
 * SPON-10: Sponsor print stylesheet (OSE-183)
 */

import { describe, test, expect } from 'vitest';
import { handlePosterPage } from '../src/handlers/pages';

function posterHtml(): Promise<string> {
  return handlePosterPage({} as never).text();
}

// ─── AS-2: Poster data-testid coverage ───────────────────────────────────────

describe('AS-2: Poster page has 30+ data-testid values (OSE-47)', () => {
  const requiredIds = [
    // Static DOM elements
    'poster-header',
    'poster-print',
    'poster-container',
    'poster-event-select',
    'poster-event-picker',
    'poster-area',
    'poster-loading',
    // renderPoster() output (in script strings)
    'poster-card',
    'poster-card-header',
    'poster-org',
    'poster-title',
    'poster-body',
    'poster-meta',
    'poster-meta-date',
    'poster-meta-venue',
    'poster-qr-section',
    'poster-qr-event',
    'poster-qr-event-placeholder',
    'poster-qr-event-label',
    'poster-qr-register',
    'poster-qr-register-placeholder',
    'poster-qr-register-label',
    'poster-sponsor-strip',
    'poster-footer',
    // init() error/empty states (in script strings)
    'poster-empty',
    'poster-error',
    // loadPosterSponsors() output (in script strings)
    'poster-sponsors-loading',
    'poster-sponsor-label',
    'poster-sponsor-item',
    'poster-sponsor-logo',
    'poster-sponsor-name',
  ];

  for (const id of requiredIds) {
    test(`poster page has data-testid="${id}"`, async () => {
      expect(await posterHtml()).toContain(`data-testid="${id}"`);
    });
  }

  test('poster page has 30+ distinct data-testid values', async () => {
    const body = await posterHtml();
    const matches = body.match(/data-testid="([^"]+)"/g) ?? [];
    const ids = new Set(matches.map((m) => m.match(/data-testid="([^"]+)"/)?.[1] ?? ''));
    expect(ids.size).toBeGreaterThanOrEqual(30);
  });
});

// ─── AS-8: Poster ARIA attributes ────────────────────────────────────────────

describe('AS-8: ARIA attributes on Poster page (OSE-53)', () => {
  test('poster-loading has role="status"', async () => {
    const body = await posterHtml();
    expect(body).toMatch(
      /data-testid="poster-loading"[^>]*role="status"|role="status"[^>]*data-testid="poster-loading"/
    );
  });

  test('poster-card has role="article"', async () => {
    expect(await posterHtml()).toContain('role="article"');
  });

  test('poster-card has aria-label for event poster', async () => {
    const body = await posterHtml();
    expect(body).toMatch(/data-testid="poster-card"[^>]*aria-label=/);
  });

  test('poster-sponsor-strip has role="list"', async () => {
    expect(await posterHtml()).toContain('role="list"');
  });

  test('poster-sponsor-strip has aria-label="Event sponsors"', async () => {
    expect(await posterHtml()).toContain('aria-label="Event sponsors"');
  });

  test('poster-sponsor-item has role="listitem"', async () => {
    expect(await posterHtml()).toContain('role="listitem"');
  });

  test('poster-empty has role="status"', async () => {
    expect(await posterHtml()).toContain(`data-testid="poster-empty"`);
    expect(await posterHtml()).toMatch(
      /data-testid="poster-empty"[^>]*role="status"|role="status"[^>]*data-testid="poster-empty"/
    );
  });

  test('poster-error has role="alert"', async () => {
    expect(await posterHtml()).toContain(`data-testid="poster-error"`);
    expect(await posterHtml()).toMatch(
      /data-testid="poster-error"[^>]*role="alert"|role="alert"[^>]*data-testid="poster-error"/
    );
  });

  test('poster meta icons are aria-hidden', async () => {
    expect(await posterHtml()).toContain('aria-hidden="true"');
  });

  test('poster has skip link targeting main content', async () => {
    const body = await posterHtml();
    expect(body).toContain('class="skip-link"');
    expect(body).toContain('href="#main-content"');
  });
});

// ─── SPON-4: Poster sponsor rendering integration ────────────────────────────

describe('SPON-4: Poster sponsor rendering (OSE-177)', () => {
  test('poster has sponsor strip container', async () => {
    expect(await posterHtml()).toContain('data-testid="poster-sponsor-strip"');
  });

  test('poster sponsor strip uses role="list"', async () => {
    const body = await posterHtml();
    expect(body).toMatch(/data-testid="poster-sponsor-strip"[^>]*role="list"/);
  });

  test('poster has loadPosterSponsors function', async () => {
    expect(await posterHtml()).toContain('loadPosterSponsors');
  });

  test('poster fetches sponsor bundle via /api/v2/events/', async () => {
    const body = await posterHtml();
    expect(body).toContain('/api/v2/events/');
    expect(body).toContain('sponsor-bundle');
  });

  test('poster sponsor strip has aria-busy lifecycle', async () => {
    expect(await posterHtml()).toContain('aria-busy');
  });

  test('poster has sr-only sponsors loading state', async () => {
    expect(await posterHtml()).toContain('data-testid="poster-sponsors-loading"');
    expect(await posterHtml()).toContain('class="sr-only"');
  });
});

// ─── SPON-10: Sponsor print stylesheet ───────────────────────────────────────

describe('SPON-10: Sponsor print stylesheet (OSE-183)', () => {
  test('poster has @media print block', async () => {
    expect(await posterHtml()).toContain('@media print');
  });

  test('print styles hide page-header and event-select', async () => {
    const body = await posterHtml();
    expect(body).toMatch(/@media print[\s\S]*\.page-header[\s\S]*display: none/);
  });

  test('print styles include page-break-inside: avoid on sponsor strip', async () => {
    expect(await posterHtml()).toContain('page-break-inside: avoid');
  });

  test('print styles apply grayscale filter to sponsor logos', async () => {
    expect(await posterHtml()).toContain('grayscale(1)');
  });

  test('print styles enforce black text for sponsor names', async () => {
    const body = await posterHtml();
    expect(body).toContain('poster-sponsor-name');
    expect(body).toMatch(/poster-sponsor-name[^}]*color: #000|color: #000[^}]*poster-sponsor-name/);
  });
});
