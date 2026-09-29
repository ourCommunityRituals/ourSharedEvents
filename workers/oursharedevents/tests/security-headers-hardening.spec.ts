/**
 * OSE-1186 G2 — cross-cutting response-header hardening (DAST teeth).
 *
 * The ZAP baseline (`.github/workflows/dast-zap-baseline.yml`) flagged every
 * public surface for a missing Permissions-Policy and Cross-Origin isolation
 * trio (rules 10063 / 90004, now promoted to FAIL in `.zap/rules.tsv`). This
 * spec is the same contract at the unit/integration rung: it asserts the real
 * wire response for each public surface carries the shared HARDENING_HEADERS
 * (source of truth `src/lib/security-headers.ts`).
 *
 * Born-red: delete the `...HARDENING_HEADERS` spread from any surface (or the
 * /ui.css wrapper in router.ts) and that surface's case fails here — the same
 * regression the DAST would red on, caught one layer cheaper.
 */

import { SELF } from 'cloudflare:test';
import { describe, test, expect } from 'vitest';
import { HARDENING_HEADERS } from '../src/lib/security-headers';

// Public GET surfaces the DAST scans; each must carry the cross-cutting headers.
const HTML_SURFACES = ['/', '/events', '/display', '/poster', '/sharedReport', '/demo', '/privacy'];

describe('OSE-1186 G2: cross-cutting hardening headers on every public surface', () => {
  for (const path of HTML_SURFACES) {
    test(`${path} carries every HARDENING_HEADERS entry with the source-of-truth value`, async () => {
      const res = await SELF.fetch(`https://t.test${path}`);
      // Not asserting status — some surfaces redirect/vary — only that whatever
      // response ships carries the hardening headers.
      for (const [name, value] of Object.entries(HARDENING_HEADERS)) {
        expect(res.headers.get(name), `${path} missing ${name}`).toBe(value);
      }
    });
  }

  test('/health (JSON) carries nosniff and the hardening headers', async () => {
    // The DAST scans /health; ZAP 10021 (nosniff) + 90004 (CORP) fire on JSON
    // too, so this public endpoint must be hardened like the HTML surfaces.
    const res = await SELF.fetch('https://t.test/health');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    for (const [name, value] of Object.entries(HARDENING_HEADERS)) {
      expect(res.headers.get(name), `/health missing ${name}`).toBe(value);
    }
  });

  test('/ui.css carries nosniff and the isolation headers (wrapped @ocr/ui response)', async () => {
    const res = await SELF.fetch('https://t.test/ui.css');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    for (const [name, value] of Object.entries(HARDENING_HEADERS)) {
      expect(res.headers.get(name), `/ui.css missing ${name}`).toBe(value);
    }
  });

  // OSE-1398: the href is fixed, so the stylesheet must revalidate rather than
  // sit in caches for @ocr/ui's 24h after an .ocr-hub-ref bump.
  test('/ui.css revalidates by ETag (no 24h stale window) and answers 304 when unchanged', async () => {
    const res = await SELF.fetch('https://t.test/ui.css');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate');
    const etag = res.headers.get('ETag');
    expect(etag).toMatch(/^"[0-9a-f]{32}"$/);
    expect((await res.text()).length).toBeGreaterThan(1000);

    const again = await SELF.fetch('https://t.test/ui.css', { headers: { 'If-None-Match': etag! } });
    expect(again.status).toBe(304);
    expect(again.headers.get('X-Content-Type-Options')).toBe('nosniff');
    const stale = await SELF.fetch('https://t.test/ui.css', { headers: { 'If-None-Match': '"old"' } });
    expect(stale.status).toBe(200);
  });

  test('the hardening contract is the one DAST gates on (require-corp, deny device APIs)', () => {
    // Guards the values themselves so an accidental weakening (e.g. COEP back to
    // unsafe-none) fails here, not only in the nightly scan.
    expect(HARDENING_HEADERS['Cross-Origin-Embedder-Policy']).toBe('require-corp');
    expect(HARDENING_HEADERS['Cross-Origin-Opener-Policy']).toBe('same-origin');
    expect(HARDENING_HEADERS['Cross-Origin-Resource-Policy']).toBe('same-origin');
    expect(HARDENING_HEADERS['Permissions-Policy']).toContain('camera=()');
  });
});
