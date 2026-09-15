/**
 * OSE-1319 R4 — poster-art management card in the admin surface.
 *
 * Structure test (workers pool): asserts the served /admin HTML, not a browser.
 * The card is a selected-event management card (hydrates on ose:event-selected)
 * that uploads via the EXISTING event-scoped endpoint and points
 * events.cover_image_url at the returned same-origin URL. Verified red against
 * the pre-R4 admin (no poster-art card, no loadPosterArt wiring).
 */
import { SELF } from 'cloudflare:test';
import { describe, test, expect } from 'vitest';

const ADMIN_KEY = 'test-admin-key-e2e-2026';

async function fetchAdminHtml(): Promise<string> {
  const res = await SELF.fetch('https://t.test/admin', {
    headers: { Authorization: `Bearer ${ADMIN_KEY}` },
  });
  expect(res.status).toBe(200);
  return res.text();
}

describe('R4 — poster-art card structure', () => {
  test('the card, panel, manage region, preview + none state, file input and status all render', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('data-testid="poster-art-card"');
    expect(html).toContain('data-testid="poster-art-panel"');
    expect(html).toContain('data-testid="poster-art-manage"');
    expect(html).toContain('data-testid="poster-art-preview"');
    expect(html).toContain('data-testid="poster-art-none"');
    expect(html).toContain('data-testid="poster-art-file"');
    expect(html).toContain('data-testid="poster-art-msg"');
  });

  test('the file input accepts only raster image types', async () => {
    const html = await fetchAdminHtml();
    expect(html).toMatch(/data-testid="poster-art-file"[\s\S]{0,200}accept="[^"]*image\/png/);
    // no SVG (XSS surface) in the accept list
    expect(html).not.toMatch(/accept="[^"]*svg/);
  });
});

describe('R4 — wiring', () => {
  test('loadPosterArt hydrates on event selection', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('window.loadPosterArt = async function');
    // wired into the ose:event-selected fan-out
    expect(html).toContain('window.loadPosterArt(d.id)');
  });

  test('upload goes to the existing endpoint, then sets cover_image_url via PUT', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain("'/api/v2/admin/events/' + encodeURIComponent(eventId) + '/uploads'");
    expect(html).toContain('cover_image_url');
    expect(html).toContain("method: 'PUT'");
  });

  test('client-side fat-finger guards on type + size are present', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('OK_TYPES');
    expect(html).toContain('MAX_BYTES');
  });
});

describe('R4 — mobile workability', () => {
  test('the file control declares >=44px target and >=16px font in CSS', async () => {
    const html = await fetchAdminHtml();
    expect(html).toMatch(/#pa-file[\s\S]{0,120}min-height:\s*44px/);
    expect(html).toMatch(/#pa-file[\s\S]{0,160}font-size:\s*16px/);
  });
});
