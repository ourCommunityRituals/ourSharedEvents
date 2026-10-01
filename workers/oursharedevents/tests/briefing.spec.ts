import { describe, test, expect } from 'vitest';
import { route } from '../src/router';
import { PLATFORM_BRAND_ID } from '../src/lib/admin-brand-scope';

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

  test('AUD-3: the admin key has no brand, so in production it gets 404 and no content', async () => {
    // Production carries no ADMIN_SCOPE_ALL (tests/prod-admin-scope-config.spec.ts),
    // so a key actor is never platform-scoped there.
    const res = await get('/briefing', { Authorization: `Bearer ${ADMIN_KEY}` });
    expect(res.status).toBe(404);
    const body = await res.text();
    for (const marker of CONFIDENTIAL_MARKERS) {
      expect(body).not.toContain(marker);
    }
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

// ── AUD-3 (OSE-1447): the briefing is platform-owned ────────────────────────────
//
// Only members of the reserved platform brand reach it. The env below keeps the
// auth gate live (DEV_OPEN_ADMIN unset) but is not a deployed env, so the decode-only
// Access token is accepted; JWT signature verification is covered by its own specs.

const FOUNDER = 'founder@example.com';
const BRAND_ADMIN = 'organizer@example.com';

function liveGateEnv(): Parameters<typeof route>[1] {
  return {
    ALLOWED_ADMIN_DOMAINS: 'example.com',
    ADMIN_BRAND_MEMBERSHIP: JSON.stringify({
      [FOUNDER]: [PLATFORM_BRAND_ID],
      [BRAND_ADMIN]: ['brand-x'],
    }),
  } as unknown as Parameters<typeof route>[1];
}

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function getAs(email: string, path: string): Promise<Response> {
  const now = Math.floor(Date.now() / 1000);
  const jwt = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ email, iat: now - 10, exp: now + 3600 })}.sig`;
  return route(
    new Request(`https://t.test${path}`, { headers: { 'Cf-Access-Jwt-Assertion': jwt } }),
    liveGateEnv(),
    ctx
  );
}

describe('AUD-3 | /briefing is reachable only through the reserved platform brand', () => {
  test('a platform-brand member gets the briefing (200, HTML, security headers)', async () => {
    const res = await getAs(FOUNDER, '/briefing');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    expect(res.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    const html = await res.text();
    expect(html).toContain('id="root"');
    expect(html).toContain('ourCommunityRituals');
  });

  test('/overview and /summary route to the briefing for a platform-brand member', async () => {
    for (const path of ['/overview', '/summary']) {
      const res = await getAs(FOUNDER, path);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('ourCommunityRituals');
    }
  });

  test('an ordinary brand admin gets 404 and no confidential content', async () => {
    for (const path of ['/briefing', '/overview', '/summary']) {
      const res = await getAs(BRAND_ADMIN, path);
      expect(res.status).toBe(404);
      const body = await res.text();
      for (const marker of CONFIDENTIAL_MARKERS) {
        expect(body).not.toContain(marker);
      }
    }
  });
});
