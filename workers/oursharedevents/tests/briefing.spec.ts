import { describe, test, expect } from 'vitest';
import { route } from '../src/router';

/**
 * OSE-574 — the CEO Briefing route MUST be gated server-side.
 *
 * The full confidential briefing (revenue model, IP portfolio, risk register,
 * OurWKRP entity, CEO handoff) is embedded directly in the served HTML. The
 * embedded React PIN gate is a CLIENT-SIDE convenience only — both the PIN and
 * every section's content ship in the page payload — so before the fix a plain
 * unauthenticated `GET /briefing` leaked the entire briefing in the HTML source.
 * requireAdmin now runs BEFORE any HTML is produced.
 *
 * TEST-ENV NOTE: the shared miniflare env sets DEV_OPEN_ADMIN=true (WORKER_ENV
 * 'test'), which makes requireAdmin pass through so the admin UI is viewable on
 * `wrangler dev` — that bypass would mask the gate under SELF.fetch. To verify
 * the PRODUCTION security posture we drive route() directly with a prod-like env
 * (DEV_OPEN_ADMIN unset, WORKER_ENV 'production'), where the gate is live. This
 * replaces the earlier BRIEF-1 suite, which asserted the vulnerable "200 + full
 * HTML for everyone" behavior.
 */

const ADMIN_KEY = 'test-admin-key-e2e-2026';
const CONFIDENTIAL_MARKERS = ['PIN="2026"', 'IP Portfolio', 'OurWKRP', 'id="root"'];

// Prod-like env: the dev-open bypass is OFF, Bearer fallback is the auth method.
function prodEnv(): Parameters<typeof route>[1] {
  return {
    WORKER_ENV: 'production',
    ADMIN_KEY,
    ALLOW_ADMIN_KEY_FALLBACK: 'true',
    // DEV_OPEN_ADMIN intentionally unset — the gate must be live.
  } as unknown as Parameters<typeof route>[1];
}

const ctx = {
  waitUntil() {},
  passThroughOnException() {},
} as unknown as ExecutionContext;

function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return route(new Request(`https://t.test${path}`, { headers }), prodEnv(), ctx);
}

describe('OSE-574 | /briefing server-side auth gate (production posture)', () => {
  test('unauthenticated GET /briefing → 401, no page content in body', async () => {
    const res = await get('/briefing');
    expect(res.status).toBe(401);
    const body = await res.text();
    for (const marker of CONFIDENTIAL_MARKERS) {
      expect(body).not.toContain(marker);
    }
  });

  test('unauthenticated /overview and /summary are also gated (401, no content)', async () => {
    for (const path of ['/overview', '/summary']) {
      const res = await get(path);
      expect(res.status).toBe(401);
      const body = await res.text();
      for (const marker of CONFIDENTIAL_MARKERS) {
        expect(body).not.toContain(marker);
      }
    }
  });

  test('admin-authenticated GET /briefing → 200 with HTML', async () => {
    const res = await get('/briefing', { Authorization: `Bearer ${ADMIN_KEY}` });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('id="root"');
    expect(html).toContain('ourCommunityRituals');
  });

  test('admin-authenticated /overview and /summary route to the briefing page', async () => {
    for (const path of ['/overview', '/summary']) {
      const res = await get(path, { Authorization: `Bearer ${ADMIN_KEY}` });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('ourCommunityRituals');
    }
  });

  test('admin briefing response keeps its security headers', async () => {
    const res = await get('/briefing', { Authorization: `Bearer ${ADMIN_KEY}` });
    expect(res.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  test('a wrong Bearer token is still denied (401, no content)', async () => {
    const res = await get('/briefing', { Authorization: 'Bearer not-the-key' });
    expect(res.status).toBe(401);
    const body = await res.text();
    for (const marker of CONFIDENTIAL_MARKERS) {
      expect(body).not.toContain(marker);
    }
  });
});
