/**
 * OSE-1199 — the poster's QR codes are data: PNGs (poster-bundle + UEC
 * resolver). Without `img-src 'self' data:` the browser falls back to
 * default-src 'self' and refuses every code; staging printed alt text.
 *
 * Locks the directive on every HTML page served through pages.ts
 * securityHeaders(), not only /poster: the public event page renders the
 * same data: QR when the poster bundle is embedded, and a future page that
 * drops the directive must go red here before it reaches a wall.
 */
import { SELF } from 'cloudflare:test';
import { describe, test, expect } from 'vitest';

const PAGES = ['/poster', '/', '/events', '/display'];

describe('OSE-1199 | CSP | pages.ts securityHeaders admits data: images', () => {
  for (const path of PAGES) {
    test(`GET ${path} | Content-Security-Policy carries img-src 'self' data:`, async () => {
      const res = await SELF.fetch(`https://t.test${path}`);
      expect(res.status).toBe(200);
      const csp = res.headers.get('Content-Security-Policy') ?? '';
      expect(csp, `${path} must keep the nonce CSP`).toMatch(/script-src 'self' 'nonce-/);
      expect(csp, `${path} must allow data: images or QR codes will not render`).toContain(
        "img-src 'self' data:"
      );
      // default-src stays 'self' — img-src widens ONLY images, nothing else.
      expect(csp).toContain("default-src 'self'");
      expect(csp).not.toMatch(/img-src[^;]*\*/);
    });
  }
});
