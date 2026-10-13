/**
 * GET /ui-toast.js: the @ocr/ui toast runtime, served from this origin.
 *
 * The pages that report action results (admin, sponsor home) load it with
 * `<script src="/ui-toast.js" defer>`. It is same-origin and external, so the
 * pages' CSP (`script-src 'self' 'nonce-...'`) allows it with no change.
 *
 * What this holds:
 *   - the route answers with the pinned @ocr/ui script, as JavaScript, nosniff
 *   - it carries the hardening headers, so it loads under the pages' COEP
 *   - it revalidates by ETag, so a hub pin bump reaches browsers at once
 *   - it sets no cookie and is not an admin route (no sign-in to load it)
 *   - the admin pages are served with the script tag, nonce'd like every other
 *     script, under the same CSP as before
 *   - a refused request from each action that reports in a toast carries the
 *     two things a failure toast shows: a `code` in the body and an
 *     `X-Request-Id` header, both short ids, the header equal to the body's
 *     `requestId`
 *
 * @born-red toast route | method: run before the route existed (every case
 *   answered 404), then with the hardening spread removed (the header case
 *   failed alone) | date: 2026-10-12
 * @born-red request reference on a refusal | method: run before the events,
 *   sponsors and poster-deployment error helpers set the header (three cases
 *   failed with a null header; the sponsor answer passed) | date: 2026-10-12
 * @born-red request reference on the form switch, publish and unpublish |
 *   method: the header taken out of the answers of handlers/feature-flags.ts
 *   and handlers/qr-verify.ts (those five cases failed with a null header,
 *   the other refusals passed) | date: 2026-10-12
 */

import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, test, expect } from 'vitest';
import { toastScript } from '@ocr/ui';
import { HARDENING_HEADERS } from '../src/lib/security-headers';

const URL_ = 'https://t.test/ui-toast.js';
const ADMIN = { Authorization: 'Bearer test-admin-key-e2e-2026' };
// The CSP every page is served with (handlers/pages.ts securityHeaders). The
// toast needed no change to it: a same-origin script is already allowed.
const PAGE_CSP =
  /^default-src 'self'; script-src 'self' 'nonce-([A-Za-z0-9+/=_-]+)'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'$/;

describe('GET /ui-toast.js', () => {
  test('answers 200 with the pinned @ocr/ui toast script, as JavaScript', async () => {
    const res = await SELF.fetch(URL_);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/javascript; charset=utf-8');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    const body = await res.text();
    expect(body).toBe(toastScript);
    expect(body).toContain('root.ocrToast = {');
  });

  test('carries every hardening header, so the script loads under COEP require-corp', async () => {
    const res = await SELF.fetch(URL_);
    expect(res.status).toBe(200);
    for (const [name, value] of Object.entries(HARDENING_HEADERS)) {
      expect(res.headers.get(name), `/ui-toast.js missing ${name}`).toBe(value);
    }
  });

  test('revalidates by ETag and answers 304 with no body when unchanged', async () => {
    const res = await SELF.fetch(URL_);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
    const etag = res.headers.get('ETag');
    expect(etag).toMatch(/^"ocr-toast-[0-9a-f]{8}"$/);

    const again = await SELF.fetch(URL_, { headers: { 'If-None-Match': etag! } });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe('');
    expect(again.headers.get('X-Content-Type-Options')).toBe('nosniff');
    for (const [name, value] of Object.entries(HARDENING_HEADERS)) {
      expect(again.headers.get(name), `304 missing ${name}`).toBe(value);
    }

    const stale = await SELF.fetch(URL_, { headers: { 'If-None-Match': '"old"' } });
    expect(stale.status).toBe(200);
  });

  test('sets no cookie and needs no sign-in', async () => {
    const res = await SELF.fetch(URL_);
    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).toBeNull();
    expect(res.headers.get('WWW-Authenticate')).toBeNull();
  });

  test('only GET and HEAD are served', async () => {
    const res = await SELF.fetch(URL_, { method: 'POST' });
    expect(res.status).not.toBe(200);
    expect(await res.text()).not.toContain('root.ocrToast');
  });
});

describe('the admin pages are served with the toast script', () => {
  for (const path of ['/admin', '/api/v2/admin/screens/logs', '/api/v2/admin/screens/settings']) {
    test(`${path} loads /ui-toast.js once, with the response nonce, and the CSP is unchanged`, async () => {
      const res = await SELF.fetch(`https://t.test${path}`, { headers: ADMIN });
      expect(res.status).toBe(200);
      const csp = res.headers.get('Content-Security-Policy') ?? '';
      const nonce = csp.match(PAGE_CSP)?.[1];
      expect(nonce, `CSP changed: ${csp}`).toBeTruthy();
      const html = await res.text();
      const tags = html.match(/<script[^>]*src="\/ui-toast\.js"[^>]*><\/script>/g) ?? [];
      expect(tags).toEqual([`<script nonce="${nonce}" src="/ui-toast.js" defer></script>`]);
      // Still the only script loaded by address: nothing from another origin.
      expect(html.match(/<script[^>]*\ssrc=/g)).toHaveLength(1);
    });
  }
});

describe('what a failure toast reads from a refused request', () => {
  beforeAll(async () => {
    const t = env as unknown as { DB: D1Database; TEST_MIGRATION_STATEMENTS: string };
    for (const stmt of JSON.parse(t.TEST_MIGRATION_STATEMENTS) as string[]) {
      try {
        await t.DB.prepare(stmt).run();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
        throw e;
      }
    }
  });

  const JSON_BODY = { 'Content-Type': 'application/json' };
  // One refusal per action that reports through the toast (admin.html and
  // sponsor-home.html). Each is the page's own request, for a thing that is
  // not there.
  const REFUSALS: Array<{
    action: string;
    method: string;
    path: string;
    headers: Record<string, string>;
    body?: unknown;
    status: number;
    code: string;
  }> = [
    {
      action: 'sponsor home: answer a placement',
      method: 'POST',
      path: '/api/v2/sponsor/placements/spl_none/respond',
      headers: JSON_BODY,
      body: { token: 'not.a.valid.token', accepted: true },
      status: 401,
      code: 'UNAUTHORIZED',
    },
    {
      action: 'sponsor home: ask to back an event',
      method: 'POST',
      path: '/api/v2/sponsor/requests',
      headers: JSON_BODY,
      body: { token: 'not.a.valid.token', event_id: 'evt_none' },
      status: 401,
      code: 'UNAUTHORIZED',
    },
    {
      action: 'admin: create a sponsor page link',
      method: 'POST',
      path: '/api/v2/admin/sponsors/sb_none/home-link',
      headers: ADMIN,
      status: 404,
      code: 'NOT_FOUND',
    },
    {
      action: 'admin: answer a sponsor request',
      method: 'POST',
      path: '/api/v2/admin/sponsor-requests/spl_none/respond',
      headers: { ...ADMIN, ...JSON_BODY },
      body: { approve: true },
      status: 404,
      code: 'NOT_FOUND',
    },
    {
      action: 'admin: deactivate a sponsor',
      method: 'DELETE',
      path: '/api/v2/admin/sponsors/sb_none',
      headers: ADMIN,
      status: 404,
      code: 'NOT_FOUND',
    },
    {
      action: 'admin: deactivate a poster deployment',
      method: 'DELETE',
      path: '/api/v2/admin/poster-deployments/pd_none',
      headers: ADMIN,
      status: 404,
      code: 'NOT_FOUND',
    },
    {
      action: 'admin: change an event status',
      method: 'PUT',
      path: '/api/v2/admin/events/evt_none',
      headers: { ...ADMIN, ...JSON_BODY },
      body: { status: 'ready' },
      status: 404,
      code: 'NOT_FOUND',
    },
    {
      action: 'admin: switch a form on or off',
      method: 'PUT',
      path: '/api/v2/admin/events/evt_none/flags/not.a.flag',
      headers: { ...ADMIN, ...JSON_BODY },
      body: { enabled: true },
      status: 400,
      code: 'INVALID_FLAG_KEY',
    },
    {
      action: 'admin: switch a form with no on or off in the request',
      method: 'PUT',
      path: '/api/v2/admin/events/evt_none/flags/forms.register',
      headers: { ...ADMIN, ...JSON_BODY },
      body: {},
      status: 400,
      code: 'MISSING_FIELD',
    },
    {
      action: 'admin: remove a form switch',
      method: 'DELETE',
      path: '/api/v2/admin/events/evt_none/flags/not.a.flag',
      headers: ADMIN,
      status: 400,
      code: 'INVALID_FLAG_KEY',
    },
    {
      action: 'admin: publish an event (verify-qr)',
      method: 'POST',
      path: '/api/v2/admin/events/evt_none/verify-qr',
      headers: ADMIN,
      status: 404,
      code: 'EVENT_NOT_FOUND',
    },
    {
      action: 'admin: unpublish an event (unverify-qr)',
      method: 'POST',
      path: '/api/v2/admin/events/evt_none/unverify-qr',
      headers: ADMIN,
      status: 404,
      code: 'EVENT_NOT_FOUND',
    },
  ];

  for (const r of REFUSALS) {
    test(`${r.action}: a code, and X-Request-Id as a short id`, async () => {
      const res = await SELF.fetch(`https://t.test${r.path}`, {
        method: r.method,
        headers: r.headers,
        body: r.body === undefined ? undefined : JSON.stringify(r.body),
      });
      expect(res.status).toBe(r.status);
      const body = (await res.json()) as { code: string; requestId: string };
      expect(body.code).toBe(r.code);
      const reference = res.headers.get('X-Request-Id');
      // The toast shows a code or a reference only when it is a short id
      // (letters, digits, `_ . : -`); anything else reads "not available".
      expect(reference, 'X-Request-Id header').toMatch(/^[A-Za-z0-9_.:-]{8,64}$/);
      expect(body.code).toMatch(/^[A-Za-z0-9_.:-]{1,48}$/);
      expect(body.requestId).toBe(reference);
    });
  }
});
