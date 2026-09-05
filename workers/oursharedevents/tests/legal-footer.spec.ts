/**
 * The legal footer contract (OSE-1232).
 *
 * WHAT THIS GUARDS
 *   The privacy policy is the one page a person goes looking for when they
 *   want to know what the platform knows about them. Measured 2026-09-05, it
 *   was linked from exactly ONE surface — the staff sign-in page — while the
 *   two public surfaces, the admin dashboard and the SharedReport linked it
 *   from nowhere. That is not a footer bug; it is a reachability defect on the
 *   product's central promise ("Never who, only how many"), and it is the kind
 *   that returns silently the next time a template is edited by hand.
 *
 *   So the assertions here are deliberately about REACHABILITY and OPT-OUT,
 *   not about markup: every surface that should carry the footer serves it,
 *   every surface that should not is untouched, and no link in it can point
 *   at a route that does not exist.
 *
 * @born-red OSE-1232 | method: privacy linked from 1 of 5 surfaces
 * | date: 2026-09-05
 *
 * The defect it was written against: three divergent hand-written footers
 * (admin-signin, landing, public) and two surfaces with none (admin,
 * shared-report). Reverting src/lib/legal-footer.ts and restoring the inline
 * footers fails "links the privacy policy" on four of the five surfaces.
 */
import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { setFlag } from '../src/lib/feature-flags';
import {
  LEGAL_LINKS,
  FOOTER_MARKER,
  footerLinksFor,
  renderLegalFooter,
} from '../src/lib/legal-footer';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}
const tenv = () => env as unknown as TestEnv;

const ADMIN_KEY = 'test-admin-key-e2e-2026';

/**
 * Surfaces that must render the footer, with the test-id prefix each emits.
 * `/admin` needs the Bearer fallback or the router hands back the sign-in page
 * (which has its own footer, and its own test below); `/sharedReport` needs the
 * analytics flag or the router hands back the branded 403 page.
 */
const FOOTED: ReadonlyArray<{ path: string; prefix: string; auth?: boolean }> = [
  { path: '/', prefix: 'landing' },
  { path: '/events', prefix: 'public' },
  { path: '/admin', prefix: 'admin', auth: true },
  { path: '/sharedReport', prefix: 'shared-report' },
];

/** Surfaces that must NOT render one — the opt-out is "carries no marker". */
const UNFOOTED: ReadonlyArray<string> = ['/display', '/poster'];

async function body(path: string, auth = false): Promise<string> {
  const headers: Record<string, string> = { Accept: 'text/html' };
  if (auth) headers.Authorization = `Bearer ${ADMIN_KEY}`;
  const res = await SELF.fetch(`https://example.com${path}`, { headers });
  return await res.text();
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
        if (msg.includes('duplicate column name')) continue;
        throw e;
      }
    }
  }
  // The SharedReport surface is tier-gated. Without this the route returns the
  // branded 403 page and the footer assertion would be testing the wrong page.
  await setFlag(tenv().FORMS_DB, 'analytics.shared-report', true);
});

describe('legal footer — reachability', () => {
  for (const { path, prefix, auth } of FOOTED) {
    test(`${path} renders the shared footer`, async () => {
      const html = await body(path, auth);
      expect(html).toContain(`data-testid="${prefix}-footer"`);
      expect(html).toContain('class="ocr-footer"');
    });

    test(`${path} links the privacy policy`, async () => {
      const html = await body(path, auth);
      expect(html).toContain('href="/privacy"');
    });
  }

  // The sign-in page answers 401 with a real body, so it is fetched separately
  // rather than folded into the loop above.
  test('the unauthenticated /admin sign-in body carries the footer', async () => {
    const res = await SELF.fetch('https://example.com/admin', {
      headers: { Accept: 'text/html' },
    });
    expect(res.status).toBe(401);
    const html = await res.text();
    expect(html).toContain('data-testid="signin-footer"');
    expect(html).toContain('href="/privacy"');
  });
});

describe('legal footer — the opt-out is silence, not a negative check', () => {
  for (const path of UNFOOTED) {
    test(`${path} carries no legal footer`, async () => {
      const html = await body(path);
      expect(html).not.toContain('class="ocr-footer"');
    });
  }

  test('no served page leaks the raw marker', async () => {
    for (const { path, auth } of FOOTED) {
      expect(await body(path, auth)).not.toContain(FOOTER_MARKER);
    }
    for (const path of UNFOOTED) {
      expect(await body(path)).not.toContain(FOOTER_MARKER);
    }
  });
});

describe('legal footer — every link resolves', () => {
  // The failure this prevents: a footer link added ahead of its page. A dead
  // link is worst precisely here, in the one place people look for their rights.
  for (const link of LEGAL_LINKS) {
    test(`${link.href} is a real route, not a 404`, async () => {
      const res = await SELF.fetch(`https://example.com${link.href}`);
      expect(res.status).toBeLessThan(400);
    });
  }

  test('Browse Events resolves for the surfaces that offer it', async () => {
    const res = await SELF.fetch('https://example.com/events');
    expect(res.status).toBeLessThan(400);
  });
});

describe('legal footer — per-surface composition', () => {
  test('admin and shared-report omit the wayfinding link', () => {
    for (const s of ['admin', 'shared-report'] as const) {
      expect(footerLinksFor(s).some((l) => l.href === '/events')).toBe(false);
    }
  });

  test('landing, public and sign-in keep it, and keep it first', () => {
    for (const s of ['landing', 'public', 'admin-signin'] as const) {
      expect(footerLinksFor(s)[0]?.href).toBe('/events');
    }
  });

  test('the standing subtitle rides the two public surfaces only', () => {
    expect(renderLegalFooter('landing')).toContain('Never who, only how many.');
    expect(renderLegalFooter('public')).toContain('Never who, only how many.');
    for (const s of ['admin', 'shared-report', 'admin-signin'] as const) {
      expect(renderLegalFooter(s)).not.toContain('Never who');
    }
  });

  // The contract two E2E specs depend on. `admin-signin` emitted `signin-footer`,
  // and renaming it would have broken callers for no gain.
  test('admin-signin keeps its historical `signin-` test-id prefix', () => {
    expect(renderLegalFooter('admin-signin')).toContain('data-testid="signin-footer"');
    expect(renderLegalFooter('admin-signin')).not.toContain('admin-signin-footer');
  });

  test('every link is individually addressable by test-id', () => {
    for (const s of ['landing', 'public', 'admin', 'shared-report', 'admin-signin'] as const) {
      for (const l of footerLinksFor(s)) {
        expect(l.testid, `${s} → ${l.href}`).toBeTruthy();
      }
    }
  });
});
