/**
 * Admin Logs and Settings pages: how they are served.
 *
 *   GET /api/v2/admin/screens/logs
 *   GET /api/v2/admin/screens/settings
 *
 * They sit under /api/v2/admin so the Cloudflare Access app, the admin rate limit
 * and requireAdmin already cover them. The pages carry no rows; what they show
 * comes from the audit-log route (brand-scoped by the server) and the settings
 * route. Under the page CSP (script-src 'self' 'nonce-…') a script needs the
 * nonce and an inline handler is dead, so both are asserted.
 *
 * @born-red logs-settings-screens | method: ran before the routes and templates
 * existed (404 on both pages, no nav link in admin.html) | date: 2026-10-04
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { route, type RouterEnv } from '../src/router';
import ADMIN_HTML from '../src/templates/admin.html';
import LOGS_HTML from '../src/templates/admin-logs.html';
import SETTINGS_HTML from '../src/templates/admin-settings.html';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}
const tenv = env as unknown as TestEnv;
const routerEnv = env as unknown as RouterEnv;

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

const KEY = { Authorization: 'Bearer test-admin-key-e2e-2026' };

async function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await route(
    new Request(`https://ose.test${path}`, { method: 'GET', headers }),
    routerEnv,
    ctx
  );
  await waitOnExecutionContext(ctx);
  return res;
}

const PAGES = [
  { name: 'Logs', path: '/api/v2/admin/screens/logs', testid: 'logs-screen', source: LOGS_HTML },
  {
    name: 'Settings',
    path: '/api/v2/admin/screens/settings',
    testid: 'settings-screen',
    source: SETTINGS_HTML,
  },
] as const;

for (const page of PAGES) {
  describe(`${page.name} page: ${page.path}`, () => {
    test('is closed to the unauthenticated: JSON 401, never the page', async () => {
      const res = await get(page.path);
      expect(res.status).toBe(401);
      expect(await res.text()).not.toContain(page.testid);
    });

    test('a browser without sign-in gets the HTML sign-in page, still a 401', async () => {
      const res = await get(page.path, { Accept: 'text/html' });
      expect(res.status).toBe(401);
      expect(res.headers.get('content-type') ?? '').toContain('text/html');
      expect(await res.text()).not.toContain(page.testid);
    });

    test('an admin gets the page, private and unindexed, with no cookie', async () => {
      const res = await get(page.path, KEY);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type') ?? '').toContain('text/html');
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('x-robots-tag')).toMatch(/noindex/);
      expect(res.headers.get('set-cookie')).toBeNull();
      expect(await res.text()).toContain(`data-testid="${page.testid}"`);
    });

    test('CSP: every script carries the nonce the header names, and there are no inline handlers', async () => {
      const res = await get(page.path, KEY);
      const csp = res.headers.get('content-security-policy') ?? '';
      const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
      expect(nonce, 'a nonce in script-src').toBeTruthy();
      const body = await res.text();
      const scripts = body.match(/<script\b[^>]*>/gi) ?? [];
      expect(scripts.length).toBeGreaterThan(0);
      for (const s of scripts) expect(s, s).toContain(`nonce="${nonce}"`);
      expect(body).not.toMatch(/\son[a-z]+\s*=/i);
      expect(body).not.toMatch(/javascript:/i);
    });

    test('exactly one h1 (accessibility hard gate)', async () => {
      const body = await (await get(page.path, KEY)).text();
      expect(body.match(/<h1[\s>]/g)?.length).toBe(1);
    });

    test('writes every value with textContent: no innerHTML, outerHTML or insertAdjacentHTML', () => {
      expect(page.source).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    });

    test('tokens only: no raw colour, no local :root, no own stylesheet beyond the page budget', () => {
      const css = [...page.source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
        .map((m) => m[1])
        .join(' ');
      expect(css.replace(/\s+/g, '').length).toBeLessThanOrEqual(400);
      expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(css).not.toMatch(/:root\s*\{/);
      expect(page.source).toContain('href="/ui.css"');
    });

    test('links back to /admin and across to its sibling', () => {
      expect(page.source).toContain('href="/admin"');
      expect(page.source).toMatch(/href="\/api\/v2\/admin\/screens\/(logs|settings)"/);
    });
  });
}

describe('what each page may call', () => {
  test('Logs reads the audit-log route and nothing else', () => {
    const urls = LOGS_HTML.match(/(['"])\/api\/[^'"?]*/g) ?? [];
    expect(new Set(urls.map((u) => u.slice(1)))).toEqual(
      new Set(['/api/v2/admin/audit-log', '/api/v2/admin/screens/settings'])
    );
    // It starts in the brand view: the first option, and the only one the server
    // answers for a brand owner.
    expect(LOGS_HTML).toMatch(/<select id="logs-view"[^>]*>\s*<option value="brand">/);
    expect(LOGS_HTML).toContain("q.push('scope=brand')");
  });

  test('Settings reads the settings route and nothing else', () => {
    const urls = SETTINGS_HTML.match(/(['"])\/api\/[^'"?]*/g) ?? [];
    expect(new Set(urls.map((u) => u.slice(1)))).toEqual(
      new Set(['/api/v2/admin/screens/logs', '/api/v2/admin/settings'])
    );
  });

  test('neither page sends anything: no POST, PUT, DELETE or form', () => {
    for (const src of [LOGS_HTML, SETTINGS_HTML]) {
      expect(src).not.toMatch(/method\s*:\s*['"](POST|PUT|PATCH|DELETE)/i);
      expect(src).not.toMatch(/<form[\s>]/i);
    }
  });
});

describe('the admin page links to both screens', () => {
  test('one nav entry each, to the real page paths', () => {
    expect(ADMIN_HTML).toContain('href="/api/v2/admin/screens/logs"');
    expect(ADMIN_HTML).toContain('href="/api/v2/admin/screens/settings"');
    expect(ADMIN_HTML).toContain('data-testid="admin-nav-logs"');
    expect(ADMIN_HTML).toContain('data-testid="admin-nav-settings"');
  });
});
