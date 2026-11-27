/**
 * The attendee map page's Content-Security-Policy, pinned whole.
 *
 * Why: every request a browser makes carries the visitor's IP address. If the
 * map page could load a map library, map tiles or fonts from an outside map or
 * tile host, each visitor's IP address (and the areas they looked at) would
 * reach that host. Pinning the policy keeps the map same-origin, so visitors'
 * IP addresses never leave for an outside mapping service.
 *
 * /map (OSE-1990) is the landing page opened on its map view, served through
 * pages.ts securityHeaders(). This spec holds the header it sends to exactly
 * the directives below, directive by directive, with only the per-request
 * nonce allowed to vary. Any change to the policy, a new directive, a new
 * source on an existing one, or a dropped one, turns this red, so a change to
 * the map page's policy is always a visible, reviewed edit to this file.
 *
 * Named on purpose, beside the exact match, so the failure says what moved:
 *   - connect-src stays 'self' only;
 *   - img-src stays 'self' data: only;
 *   - no worker-src or child-src directive, and no blob: source anywhere;
 *   - no host, scheme-only source or wildcard in any directive.
 *
 * Staging twin: bruno/ose-pages/16. Landing Map Zoom (OSE-1886 OSE-1891
 * OSE-1896)/"Map page - GET map - content policy is pinned.yml".
 *
 * Born-red (watched 2026-11-27, each fault in securityHeaders(), then reverted):
 *   `blob:` added to img-src            16 of 21 failed
 *   `https://example.com` in connect-src 12 of 21 failed
 *   `worker-src 'self'` added            8 of 21 failed
 */
import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  const stmts: string[] = JSON.parse(tenv.TEST_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        msg.includes('duplicate column name') ||
        msg.includes('already exists') ||
        msg.includes('no such column')
      ) {
        continue;
      }
      throw e;
    }
  }
}

/** The map page's policy, in the order it is sent. `<nonce>` stands for the per-request nonce. */
const EXPECTED: ReadonlyArray<readonly [string, string]> = [
  ['default-src', "'self'"],
  ['script-src', "'self' 'nonce-<nonce>'"],
  ['style-src', "'self' 'unsafe-inline'"],
  ['img-src', "'self' data:"],
  ['connect-src', "'self'"],
  ['frame-ancestors', "'self'"],
  ['base-uri', "'self'"],
  ['form-action', "'self'"],
];

const PATHS = ['/map', '/map?area=872664405ffffff', '/map?zip=60406', '/es/map'];

/** Split a policy into [name, sources] pairs, with the nonce value replaced. */
function directives(policy: string): Array<[string, string]> {
  return policy
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const [name, ...sources] = d.split(/\s+/);
      const joined = sources.join(' ').replace(/'nonce-[A-Za-z0-9+/=]+'/g, "'nonce-<nonce>'");
      return [name.toLowerCase(), joined] as [string, string];
    });
}

async function policyOf(path: string): Promise<string> {
  const res = await SELF.fetch(`https://stg.oursharedevents.com${path}`);
  expect(res.status, `${path} status`).toBe(200);
  const csp = res.headers.get('Content-Security-Policy');
  expect(csp, `${path} must send a Content-Security-Policy`).toBeTruthy();
  return csp ?? '';
}

describe('Map page | Content-Security-Policy is pinned', () => {
  beforeAll(async () => {
    await applyMigrations();
  });

  test('self-test | the directive reader sees a change the way the pin must', () => {
    const base = directives(
      "default-src 'self'; script-src 'self' 'nonce-abc+/='; img-src 'self' data:"
    );
    expect(base).toEqual([
      ['default-src', "'self'"],
      ['script-src', "'self' 'nonce-<nonce>'"],
      ['img-src', "'self' data:"],
    ]);
    expect(directives("img-src 'self' data: blob:")).not.toEqual([['img-src', "'self' data:"]]);
  });

  for (const path of PATHS) {
    describe(`GET ${path}`, () => {
      test('the policy is exactly the pinned one (only the nonce varies)', async () => {
        expect(directives(await policyOf(path))).toEqual(EXPECTED);
      });

      test("connect-src is 'self' only", async () => {
        const d = new Map(directives(await policyOf(path)));
        expect(d.get('connect-src')).toBe("'self'");
      });

      test("img-src is 'self' data: only", async () => {
        const d = new Map(directives(await policyOf(path)));
        expect(d.get('img-src')).toBe("'self' data:");
      });

      test('no worker-src or child-src directive, and no blob: source', async () => {
        const policy = await policyOf(path);
        const names = directives(policy).map(([n]) => n);
        expect(names).not.toContain('worker-src');
        expect(names).not.toContain('child-src');
        expect(policy.toLowerCase()).not.toContain('blob:');
      });

      test('no host, scheme-only source or wildcard in any directive', async () => {
        const sources = directives(await policyOf(path)).flatMap(([, s]) => s.split(' '));
        const allowed = new Set(["'self'", "'nonce-<nonce>'", "'unsafe-inline'", 'data:']);
        expect(sources.filter((s) => !allowed.has(s))).toEqual([]);
      });
    });
  }
});
