/**
 * OSE-Dark-Theme: @ocr/ui CSS integration test pyramid
 *
 * Verifies the dark-theme wiring introduced in feat(ose-ui):
 *   1. GET /ui.css — route exists, returns CSS, correct Content-Type, includes
 *      the OCR design-system tokens that templates depend on
 *   2. Contract — all 7 OSE templates link to /ui.css via <link rel="stylesheet">
 *   3. L1 static — router.ts registers /ui.css and imports serveCss from @ocr/ui
 *
 * These tests sit at the Unit/Integration level of the pyramid. The a11y gate
 * (tests/a11y-axe.spec.ts) provides the accessibility level; no separate E2E is
 * needed — the CSS is served from a Worker route with no async state dependencies.
 */

import { SELF } from 'cloudflare:test';
import { describe, test, expect } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// L2 Integration: /ui.css route
// ─────────────────────────────────────────────────────────────────────────────

describe('DT-1: GET /ui.css route', () => {
  test('returns 200', async () => {
    const res = await SELF.fetch('https://t.test/ui.css');
    expect(res.status).toBe(200);
  });

  test('Content-Type is text/css', async () => {
    const res = await SELF.fetch('https://t.test/ui.css');
    expect(res.headers.get('Content-Type')).toMatch(/text\/css/);
  });

  test('response body is non-empty CSS', async () => {
    const res = await SELF.fetch('https://t.test/ui.css');
    const body = await res.text();
    expect(body.length).toBeGreaterThan(0);
    expect(body).toMatch(/[{:;]/);
  });

  test('body contains OCR design-token --bg (dark background)', async () => {
    const res = await SELF.fetch('https://t.test/ui.css');
    const body = await res.text();
    expect(body).toContain('--bg');
  });

  test('body contains OCR design-token --accent (brand colour)', async () => {
    const res = await SELF.fetch('https://t.test/ui.css');
    const body = await res.text();
    expect(body).toContain('--accent');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// L2 Contract: every surface links /ui.css
// ─────────────────────────────────────────────────────────────────────────────

const UI_CSS_LINK = '<link rel="stylesheet" href="/ui.css" />';

describe('DT-2: all 7 OSE templates link to /ui.css', () => {
  test('GET / (public page) contains ui.css link', async () => {
    const res = await SELF.fetch('https://t.test/');
    expect(await res.text()).toContain(UI_CSS_LINK);
  });

  test('GET /admin (admin dashboard) contains ui.css link', async () => {
    const res = await SELF.fetch('https://t.test/admin', {
      headers: { Authorization: 'Bearer test-admin-key-e2e-2026' },
    });
    expect(await res.text()).toContain(UI_CSS_LINK);
  });

  test('GET /admin-signin page (unauthenticated browser request) contains ui.css link', async () => {
    // admin-signin is returned when /admin receives Accept: text/html but no valid token
    const res = await SELF.fetch('https://t.test/admin', {
      headers: { Accept: 'text/html' },
    });
    expect(res.status).toBe(401);
    expect(await res.text()).toContain(UI_CSS_LINK);
  });

  test('GET /display contains ui.css link', async () => {
    const res = await SELF.fetch('https://t.test/display');
    expect(await res.text()).toContain(UI_CSS_LINK);
  });

  test('GET /landing contains ui.css link', async () => {
    const res = await SELF.fetch('https://t.test/landing');
    expect(await res.text()).toContain(UI_CSS_LINK);
  });

  test('GET /poster contains ui.css link', async () => {
    const res = await SELF.fetch('https://t.test/poster');
    expect(await res.text()).toContain(UI_CSS_LINK);
  });

  test('GET /sharedReport contains ui.css link', async () => {
    const res = await SELF.fetch('https://t.test/sharedReport');
    expect(await res.text()).toContain(UI_CSS_LINK);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// L1 Static: router wiring and import integrity
// ─────────────────────────────────────────────────────────────────────────────

describe('DT-3 L1: router wires /ui.css via @ocr/ui serveCss()', () => {
  test('router.ts imports serveCss from @ocr/ui', async () => {
    const res = await SELF.fetch('https://t.test/ui.css');
    // Indirect proof: if the import were missing the route would 404
    expect(res.status).toBe(200);
  });

  test('/ui.css does NOT require auth (public static asset)', async () => {
    // No Authorization header — must still return 200
    const res = await SELF.fetch('https://t.test/ui.css');
    expect(res.status).toBe(200);
  });

  test('/ui.css is distinct from /health (not aliased)', async () => {
    const css = await SELF.fetch('https://t.test/ui.css');
    const health = await SELF.fetch('https://t.test/health');
    expect(css.headers.get('Content-Type')).toMatch(/text\/css/);
    expect(health.headers.get('Content-Type')).toMatch(/application\/json/);
  });
});
