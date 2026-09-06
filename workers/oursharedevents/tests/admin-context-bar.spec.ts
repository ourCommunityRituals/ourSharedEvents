/**
 * OSE-673 — persistent context bar + sticky mobile card nav.
 *
 * A sticky sub-header shows the selected event and a segmented Forms/Poster/
 * Sponsors/Surfaces nav that scrolls to each management card. It is populated
 * from the OSE-667 selection event and hidden until an event is selected.
 * Pure #14/#3 win — palette-agnostic (role tokens), keyboard + tap ≥44px.
 *
 * Source-shape assertions on the served admin HTML, matching admin-ui.spec.ts.
 */

import { SELF } from 'cloudflare:test';
import { describe, test, expect } from 'vitest';

async function fetchAdminHtml(): Promise<string> {
  const res = await SELF.fetch('https://t.test/admin', {
    headers: { Authorization: 'Bearer test-admin-key-e2e-2026' },
  });
  expect(res.status).toBe(200);
  return res.text();
}

describe('OSE-673 — context bar', () => {
  test('the bar exists and is hidden until an event is selected', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('data-testid="event-context-bar"');
    // Rendered hidden; revealed by the selection handler.
    expect(html).toMatch(/id="event-context-bar"[\s\S]*?hidden/);
    expect(html).toContain('bar.hidden = false;');
  });

  test('the caption is driven by the single selection event (OSE-667)', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain("addEventListener('ose:event-selected'");
    expect(html).toContain('data-testid="ecb-caption"');
    // id-only fallback — no PII.
    expect(html).toContain('cap.textContent = d.name || d.id');
  });

  test('a segmented nav jumps to each of the four management cards', async () => {
    const html = await fetchAdminHtml();
    // OSE-1239: the targets moved from an inline ecbJump('…') call — refused
    // by the nonce CSP, so the nav jumped nowhere — onto data-target, which
    // the delegated dispatcher reads at click time.
    for (const card of [
      'forms-card',
      'poster-deployments-card',
      'sponsors-card',
      'surface-cards',
    ]) {
      expect(html, `no nav button targets ${card}`).toMatch(
        new RegExp(`data-action="ecb-jump"[^>]*data-target="${card}"`)
      );
    }
    expect(html).toContain('window.ecbJump = function');
    expect(html).toContain("el.scrollIntoView({ behavior: 'smooth', block: 'start' })");
  });

  test('nav buttons meet #14 (>=44px tap) and #3 (role tokens, no inline styles)', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('.ecb-nav button');
    expect(html).toContain('min-height: 44px');
    expect(html).toContain('min-width: 44px');
    // palette-agnostic — themed via role tokens, focus-visible present.
    expect(html).toContain('background: var(--surface)');
    expect(html).toContain('.ecb-nav button:focus-visible');
  });
});
