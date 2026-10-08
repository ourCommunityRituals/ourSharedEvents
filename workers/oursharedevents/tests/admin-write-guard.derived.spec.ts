/**
 * Derived gate: every admin route in the router is behind the admin write guard.
 *
 * The guard (src/lib/admin-write-guard.ts) is one call in router.ts. That is only
 * safe while every admin route is declared after it and sits on a path it covers.
 * This gate does not keep a list of routes. It reads them out of `src/router.ts`
 * (every block that calls requireAdmin, plus every `/api/v2/admin...` path), then
 * sends a real request to each one through route() and checks the answer.
 *
 * So a new admin write fails here when it is declared ahead of the guard, when it
 * lives on a path the guard does not cover, or when the guard is narrowed or
 * removed. It needs no edit when a route is added correctly.
 *
 * Shape (tests/e2e/0-architecture/README.md): property-asserting. Negative controls
 * prove the derivation sees routes at all and that a 403 is the guard's and not a
 * blanket answer. The exemption list has one entry, with its reason.
 *
 * Placement: workers pool, so it runs with the Worker tests on every pull request.
 * The source arrives through TEST_SOURCE_FILES_JSON.
 *
 * Seen red (2026-10-07) by running it against the router with the guard call
 * taken out, which is the code as it was before the guard.
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { route, type RouterEnv } from '../src/router';
import {
  SAMPLE_ID,
  adminPrefixedPaths,
  adminRoutePaths,
  deriveAdminRouteSites,
  samplePathFor,
} from './helpers/admin-write-routes';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
  TEST_SOURCE_FILES_JSON: string;
}

const tenv = env as unknown as TestEnv;
const routerEnv = env as unknown as RouterEnv;
const HOST = 'https://ose.test';

function routerSource(): string {
  const sources = JSON.parse(tenv.TEST_SOURCE_FILES_JSON) as Record<string, string>;
  for (const [path, content] of Object.entries(sources)) {
    if (path.replace(/\\/g, '/').endsWith('src/router.ts')) return content;
  }
  throw new Error('src/router.ts not found in TEST_SOURCE_FILES_JSON');
}

const SOURCE = routerSource();
const SITES = deriveAdminRouteSites(SOURCE);
const PATHS = adminRoutePaths(SOURCE);
const UNSAFE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;

/**
 * Admin writes that do not take JSON. Each needs a reason a reviewer would accept.
 * The cross-site check has no exemptions.
 */
const NOT_JSON: Readonly<Record<string, string>> = {
  [`/api/v2/admin/events/${SAMPLE_ID}/uploads`]:
    'File upload: multipart/form-data with a boundary, checked by handlers/upload.ts itself.',
};

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A signed-in person with no brand membership: every handler refuses them anyway. */
function signedIn(): Record<string, string> {
  const now = Math.floor(Date.now() / 1000);
  return {
    'Cf-Access-Jwt-Assertion': `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({
      email: 'awg-derived@example.com',
      iat: now - 10,
      exp: now + 3600,
    })}.sig`,
  };
}

const CROSS_SITE = { 'Sec-Fetch-Site': 'cross-site', Origin: 'https://evil.example' };
const SAME_ORIGIN = { 'Sec-Fetch-Site': 'same-origin', Origin: HOST };

async function send(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: string
): Promise<{ status: number; code: string | undefined }> {
  const ctx = createExecutionContext();
  const res = await route(new Request(`${HOST}${path}`, { method, headers, body }), routerEnv, ctx);
  await waitOnExecutionContext(ctx);
  let code: string | undefined;
  try {
    code = ((await res.json()) as { code?: string }).code;
  } catch {
    code = undefined;
  }
  return { status: res.status, code };
}

async function applyStatements(db: D1Database, json: string): Promise<void> {
  for (const stmt of JSON.parse(json) as string[]) {
    try {
      await db.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }
}

beforeAll(async () => {
  await applyStatements(tenv.DB, tenv.TEST_MIGRATION_STATEMENTS);
  await applyStatements(tenv.FORMS_DB, tenv.TEST_FORMS_MIGRATION_STATEMENTS);
});

describe('the derivation (negative controls on synthetic router source)', () => {
  test('a literal path guarded by requireAdmin is found', () => {
    const src = [
      "  if (pathname === '/secret-console' && method === 'POST') {",
      '    const deny = await requireAdmin(request, env, id);',
      '  }',
    ].join('\n');
    expect(deriveAdminRouteSites(src)).toEqual([
      { line: 2, paths: ['/secret-console'], unresolved: false },
    ]);
  });

  test('a match-variable route resolves to a requestable path', () => {
    const src = [
      '  const thingMatch = pathname.match(',
      '    /^\\/api\\/v3\\/ops\\/things\\/([^/]+)\\/(start|stop)$/',
      '  );',
      "  if (thingMatch && (method === 'PUT' || method === 'DELETE')) {",
      '    const deny = await requireAdmin(request, env, id);',
      '  }',
    ].join('\n');
    expect(deriveAdminRouteSites(src)).toEqual([
      { line: 5, paths: [`/api/v3/ops/things/${SAMPLE_ID}/start`], unresolved: false },
    ]);
  });

  test('an inline regex test and a multi-path condition are both found', () => {
    const src = [
      "  if (method === 'POST' && /^\\/api\\/v2\\/admin\\/events\\/([^/]+)\\/go$/.test(pathname)) {",
      '    const authRes = await requireAdmin(request, env, reqId);',
      '  }',
      "  if (pathname === '/manage' || pathname === '/create') {",
      '    const deny = await requireAdmin(request, env, id);',
      '  }',
    ].join('\n');
    expect(deriveAdminRouteSites(src).map((s) => s.paths)).toEqual([
      [`/api/v2/admin/events/${SAMPLE_ID}/go`],
      ['/manage', '/create'],
    ]);
  });

  test('a requireAdmin whose route names no path is reported, not skipped', () => {
    const src = [
      '  if (someFlag) {',
      '    const deny = await requireAdmin(request, env, id);',
      '  }',
    ].join('\n');
    expect(deriveAdminRouteSites(src)).toEqual([{ line: 2, paths: [], unresolved: true }]);
  });

  test('a regex this helper cannot turn into a path is reported, not guessed', () => {
    expect(samplePathFor('\\/api\\/v2\\/admin\\/things\\/(\\d{4})')).toBeNull();
    expect(samplePathFor('\\/api\\/v2\\/admin\\/things\\/([^/]+)')).toBe(
      `/api/v2/admin/things/${SAMPLE_ID}`
    );
  });

  test('an admin-prefixed route with no requireAdmin is still collected', () => {
    const src = [
      "  if (pathname === '/api/v2/admin/forgot-auth' && method === 'POST') {",
      '    return handleSomething(request, env);',
      '  }',
    ].join('\n');
    expect(deriveAdminRouteSites(src)).toEqual([]);
    expect(adminPrefixedPaths(src)).toEqual(['/api/v2/admin/forgot-auth']);
    expect(adminRoutePaths(src)).toEqual(['/api/v2/admin/forgot-auth']);
  });
});

describe('the derivation sees the real router', () => {
  test('it finds the requireAdmin call sites (not an empty list)', () => {
    expect(SITES.length).toBeGreaterThanOrEqual(40);
    expect(PATHS.length).toBeGreaterThanOrEqual(40);
  });

  test('every requireAdmin call site resolves to a path', () => {
    const lost = SITES.filter((s) => s.unresolved).map((s) => `router.ts:${s.line}`);
    expect(
      lost,
      `requireAdmin call(s) whose route path could not be derived. Teach ` +
        `tests/helpers/admin-write-routes.ts the new route shape; do not skip it:\n  ${lost.join('\n  ')}`
    ).toEqual([]);
  });

  test('it finds routes of every kind the router uses', () => {
    for (const known of [
      '/admin',
      '/manage',
      '/briefing',
      '/api/v2/admin/events',
      `/api/v2/admin/events/${SAMPLE_ID}`,
      `/api/v2/admin/events/${SAMPLE_ID}/verify-qr`,
      `/api/v2/admin/events/${SAMPLE_ID}/uploads`,
      `/api/v2/admin/events/${SAMPLE_ID}/flags/${SAMPLE_ID}`,
      `/api/v2/admin/events/${SAMPLE_ID}/poster-deployments`,
      `/api/v2/admin/poster-deployments/${SAMPLE_ID}`,
      `/api/v2/admin/sponsors/${SAMPLE_ID}`,
      `/api/v2/admin/sponsor-requests/${SAMPLE_ID}/respond`,
      `/api/v2/admin/flags/${SAMPLE_ID}`,
      '/api/v2/admin/flags/apply-tier',
      '/api/v2/admin/data-subject/erase',
      '/api/v2/admin/geocode',
    ]) {
      expect(PATHS, `derivation missed ${known}`).toContain(known);
    }
  });

  test('the guard is called once in the router, ahead of every requireAdmin', () => {
    const lines = SOURCE.split(/\r?\n/);
    const guardCalls = lines
      .map((l, i) => (/=\s*adminWriteRefusal\(request, env, url\)/.test(l) ? i + 1 : 0))
      .filter(Boolean);
    expect(guardCalls.length, 'the guard must be called exactly once').toBe(1);
    const first = Math.min(...SITES.map((s) => s.line));
    expect(guardCalls[0], 'a requireAdmin route is declared before the guard').toBeLessThan(first);
  });
});

describe('every derived admin route refuses a cross-site write', () => {
  test('negative control: the same request to a public route is not refused by the guard', async () => {
    const res = await send(
      'POST',
      `/api/v2/events/${SAMPLE_ID}/forms/checkin`,
      { ...signedIn(), ...CROSS_SITE, 'Content-Type': 'application/json' },
      '{}'
    );
    expect(res.code).not.toBe('CROSS_SITE_WRITE');
  });

  for (const path of PATHS) {
    test(`${path}: POST, PUT, PATCH and DELETE from another site → 403 CROSS_SITE_WRITE`, async () => {
      for (const method of UNSAFE_METHODS) {
        const res = await send(method, path, { ...signedIn(), ...CROSS_SITE });
        expect(res.status, `${method} ${path}`).toBe(403);
        expect(res.code, `${method} ${path}`).toBe('CROSS_SITE_WRITE');
      }
    });
  }

  test('the guard is the one refusing: from this origin, no derived route answers CROSS_SITE_WRITE', async () => {
    const wrong: string[] = [];
    for (const path of PATHS) {
      for (const method of UNSAFE_METHODS) {
        const res = await send(method, path, { ...signedIn(), ...SAME_ORIGIN });
        if (res.code === 'CROSS_SITE_WRITE') wrong.push(`${method} ${path}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe('every derived admin route refuses a body that is not JSON', () => {
  test('every exemption is a real route and states its reason', () => {
    for (const [path, reason] of Object.entries(NOT_JSON)) {
      expect(PATHS, `exemption for a route that is not in the router: ${path}`).toContain(path);
      expect(reason.trim().length, `exemption for ${path} has no reason`).toBeGreaterThanOrEqual(
        25
      );
    }
  });

  for (const path of PATHS.filter((p) => !(p in NOT_JSON))) {
    test(`${path}: a text/plain body from the admin site itself → 400 BAD_CONTENT_TYPE`, async () => {
      for (const contentType of ['text/plain', 'text/plain; x=application/json']) {
        const res = await send(
          'POST',
          path,
          { ...signedIn(), ...SAME_ORIGIN, 'Content-Type': contentType },
          '{"a":1}'
        );
        expect(res.status, `${contentType} ${path}`).toBe(400);
        expect(res.code, `${contentType} ${path}`).toBe('BAD_CONTENT_TYPE');
      }
    });
  }

  for (const path of Object.keys(NOT_JSON)) {
    test(`${path}: exempt from the JSON rule, so the request goes past the guard`, async () => {
      const res = await send(
        'POST',
        path,
        { ...signedIn(), ...SAME_ORIGIN, 'Content-Type': 'text/plain' },
        '{"a":1}'
      );
      // The next check in line answers (no such event for this caller), not the guard.
      expect(res.status).toBe(404);
      expect(res.code).toBe('NOT_FOUND');
    });
  }
});
