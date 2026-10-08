/**
 * What the browser is told to keep, for the pages a person should not find
 * again on a shared device: the admin page, the SharedReport page, and the
 * sponsor's own page.
 *
 *   - `/admin` and `/sharedReport` (and every alias of each) are sent with
 *     `Cache-Control: no-store`, so the page is not kept in a browser or
 *     shared-device cache and shown again after sign-out.
 *   - `/sharedReport` and `/sponsor` are opened by a signed link. Both are sent
 *     with `Referrer-Policy: no-referrer`, so the address never rides out in a
 *     Referer header, whatever is in it at that moment. On `/sponsor` that
 *     covers the refusals too: a 429 is served while a working token is still
 *     in the address.
 *   - `/sponsor` with no token at all says to open the link again. After the
 *     page drops the token from the address (tests/signed-link-url-scrub.spec.ts)
 *     this is what a refresh shows, and the old words ("isn't valid, ask for a
 *     fresh link") would be false: the link still works.
 *   - The scripts that drop the token are inline, so they must carry the
 *     response's CSP nonce or the browser refuses to run them.
 *
 * Through the router (`SELF.fetch`), so a route that stops going through these
 * handlers goes red too.
 *
 * @born-red signed-link headers | method: run against the pre-change handlers —
 * `/admin` and `/sharedReport` had no Cache-Control at all, `/sharedReport` and
 * `/sponsor` sent `strict-origin-when-cross-origin`, bare `/sponsor` said the
 * link "isn't valid", and neither page had a `history.replaceState` script. The
 * tests marked (guard) were green before | date: 2026-10-07
 */
import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { setFlag } from '../src/lib/feature-flags';
import { mintSponsorHomeToken } from '../src/lib/sponsor-home-auth';
import { handleSponsorHomePage } from '../src/handlers/sponsor-home';

/** A rate-limit store that says every caller is far over the limit. */
const OVER_LIMIT_KV = {
  get: async () => JSON.stringify({ count: 1_000_000, resetAt: Date.now() + 60_000 }),
  put: async () => {},
} as unknown as KVNamespace;

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
  SHARED_REPORT_SIGNING_SECRET: string;
}
const tenv = () => env as unknown as TestEnv;

const ADMIN_KEY = 'test-admin-key-e2e-2026';
const BRAND = 'ose-link-headers';
const SPONSOR = 'slh-bakery';

const REPORT_PATHS = ['/sharedReport', '/report', '/analytics', '/reports', '/insights', '/stats'];
const ADMIN_PATHS = ['/admin', '/manage', '/dashboard', '/create'];

function get(path: string, auth = false): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'text/html' };
  if (auth) headers.Authorization = `Bearer ${ADMIN_KEY}`;
  return SELF.fetch(`https://t.test${path}`, { headers });
}

async function sponsorLinkPath(): Promise<string> {
  const minted = await mintSponsorHomeToken(tenv(), SPONSOR, BRAND);
  return `/sponsor?t=${minted!.token}`;
}

/** The inline script that drops the token must run under this response's CSP. */
function expectScrubScriptIsNonced(res: Response, html: string): void {
  const nonce = /script-src 'self' 'nonce-([^']+)'/.exec(
    res.headers.get('content-security-policy') ?? ''
  )?.[1];
  expect(nonce, 'CSP nonce').toBeTruthy();
  // Any case, and an end tag written with spaces or attributes, as a browser reads it.
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\b[^>]*>/gi)];
  const scrub = scripts.filter((m) => m[2].includes('history.replaceState'));
  expect(scrub.length, 'a script that calls history.replaceState').toBeGreaterThan(0);
  for (const m of scrub) expect(m[1]).toContain(`nonce="${nonce}"`);
}

beforeAll(async () => {
  for (const [db, key] of [
    [tenv().DB, 'TEST_MIGRATION_STATEMENTS'],
    [tenv().FORMS_DB, 'TEST_FORMS_MIGRATION_STATEMENTS'],
  ] as const) {
    for (const stmt of JSON.parse(tenv()[key]) as string[]) {
      try {
        await db.prepare(stmt).run();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
        throw e;
      }
    }
  }
  // Without the flag /sharedReport answers the branded 403 page, and these
  // assertions would be about the wrong page.
  await setFlag(tenv().FORMS_DB, 'analytics.shared-report', true);
  await tenv().DB.prepare('DELETE FROM sponsor_business WHERE id = ?').bind(SPONSOR).run();
  await tenv()
    .DB.prepare('INSERT INTO sponsor_business (id, brand_id, name, is_active) VALUES (?, ?, ?, 1)')
    .bind(SPONSOR, BRAND, 'Link Headers Bakery')
    .run();
});

describe('/sharedReport page: not kept, and its address is never sent on', () => {
  for (const path of REPORT_PATHS) {
    test(`${path} is sent no-store`, async () => {
      const res = await get(path);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/text\/html/);
      expect(res.headers.get('cache-control')).toBe('no-store');
    });

    test(`${path} is sent Referrer-Policy: no-referrer`, async () => {
      const res = await get(path);
      expect(res.status).toBe(200);
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    });
  }

  test('opened by a signed link, the same two headers', async () => {
    const res = await get('/sharedReport?eventId=evt_1&token=abc.def');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  test('the script that drops the token carries the CSP nonce', async () => {
    const res = await get('/sharedReport');
    expectScrubScriptIsNonced(res, await res.text());
  });
});

describe('/admin page: not kept', () => {
  for (const path of ADMIN_PATHS) {
    test(`${path} is sent no-store`, async () => {
      const res = await get(path, true);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/text\/html/);
      expect(await res.text()).toContain('data-testid="admin-footer"');
      expect(res.headers.get('cache-control')).toBe('no-store');
    });
  }

  test('(guard) /admin keeps the referrer policy every other page has', async () => {
    const res = await get('/admin', true);
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });
});

describe("/sponsor page: the sponsor's signed link", () => {
  test('a working link is sent Referrer-Policy: no-referrer', async () => {
    const res = await get(await sponsorLinkPath());
    expect(res.status).toBe(200);
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  test('(guard) a working link is sent no-store', async () => {
    const res = await get(await sponsorLinkPath());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  test('the script that drops the token carries the CSP nonce', async () => {
    const res = await get(await sponsorLinkPath());
    expect(res.status).toBe(200);
    expectScrubScriptIsNonced(res, await res.text());
  });

  test('a refused link is sent Referrer-Policy: no-referrer too', async () => {
    const res = await get('/sponsor?t=not.a-real-token');
    expect(res.status).toBe(401);
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  test('(guard) a refused link still says the link is not valid', async () => {
    const res = await get('/sponsor?t=not.a-real-token');
    expect(res.status).toBe(401);
    const html = await res.text();
    expect(html).toContain('This sponsor link isn’t valid');
    expect(html).not.toContain('Link Headers Bakery');
  });

  // The one answer served while a WORKING token is still in the address: the
  // 429 page has no script, and a retry needs the link, so the token stays.
  // (Written after the code; seen red by removing the header from the 429.)
  test('a rate-limited request is sent Referrer-Policy: no-referrer', async () => {
    const res = await handleSponsorHomePage(
      new Request(`https://t.test${await sponsorLinkPath()}`, {
        headers: { 'CF-Connecting-IP': '203.0.113.77' },
      }),
      { ...(env as unknown as Record<string, unknown>), RATE_LIMIT_KV: OVER_LIMIT_KV } as never
    );
    expect(res.status).toBe(429);
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  // What a refresh shows once the page has dropped the token from the address.
  test('no token at all: says to open the link again, not that the link is invalid', async () => {
    const res = await get('/sponsor');
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    const html = await res.text();
    expect(html).toContain('data-testid="error-title">Open your sponsor link again<');
    expect(html).toContain('still works');
    expect(html).not.toContain('isn’t valid');
    expect(html).not.toContain('fresh link');
    expect(html).not.toContain('Link Headers Bakery');
    expect(html).not.toContain('"ok":false');
  });

  test('an empty token is the same as none', async () => {
    const res = await get('/sponsor?t=');
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('Open your sponsor link again');
  });
});

describe('(guard) the pages nobody asked to change keep their headers', () => {
  test('/events: the usual referrer policy, and not no-store', async () => {
    const res = await get('/events');
    expect(res.status).toBe(200);
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('cache-control') ?? '').not.toContain('no-store');
  });

  test('/ (landing): the usual referrer policy, and not no-store', async () => {
    const res = await get('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('cache-control') ?? '').not.toContain('no-store');
  });
});
