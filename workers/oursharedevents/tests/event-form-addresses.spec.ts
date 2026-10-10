/**
 * An event's forms live under its own address (OSE-1684, slice 3).
 *
 * The TV and poster moved to /events/<id>/tv and /events/<id>/poster. The four
 * forms follow: /events/<id>/register, /checkin, /survey and /updates (the
 * email signup). /forms/<id>?type= keeps answering, because printed posters
 * and saved links use it. Every link the platform writes is the new address.
 *
 * @born-red 2026-10-10 | method: on main the four addresses answered the event
 * page's 301/404 and every link writer below still wrote /forms/
 */

import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { eventFormPath, formScreenFor } from '../src/lib/canonical';
import { renderEventCard } from '../src/lib/event-list';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}
const E = env as unknown as TestEnv;
const ORIGIN = 'https://localhost';

async function applyAll(db: D1Database, statementsJson: string): Promise<void> {
  for (const stmt of JSON.parse(statementsJson) as string[]) {
    try {
      await db.prepare(stmt).run();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (
        m.includes('duplicate column name') ||
        m.includes('already exists') ||
        m.includes('no such column')
      ) {
        continue;
      }
      throw e;
    }
  }
}

beforeAll(async () => {
  await applyAll(E.DB, E.TEST_MIGRATION_STATEMENTS);
  await applyAll(E.FORMS_DB, E.TEST_FORMS_MIGRATION_STATEMENTS);
});

let n = 0;
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

async function seed(status: 'draft' | 'active'): Promise<string> {
  const id = `formaddr-${status}-${Date.now().toString(36)}-${n++}`;
  await E.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date,
                         location, listed_from, qr_verified, created_at, updated_at)
     VALUES (?, 'root', ?, ?, ?, 1, ?, 'Old Western, Rock Island', ?, ?, datetime('now'), datetime('now'))`
  )
    .bind(
      id,
      `Bears watch party ${id}`,
      id,
      status,
      inDays(1),
      status === 'active' ? new Date(Date.now() - 86_400_000).toISOString() : null,
      status === 'active' ? 1 : 0
    )
    .run();
  return id;
}

const get = (path: string, init: RequestInit = {}) =>
  SELF.fetch(`${ORIGIN}${path}`, { redirect: 'manual', ...init });

const FORMS: Array<[string, string]> = [
  ['register', 'form-register'],
  ['checkin', 'form-checkin'],
  ['survey', 'form-survey'],
  ['updates', 'form-email'],
];

describe('the address of each form', () => {
  test('eventFormPath writes /events/<id>/<screen>; the email signup is /updates', () => {
    expect(eventFormPath('evt_1', 'register')).toBe('/events/evt_1/register');
    expect(eventFormPath('evt_1', 'checkin')).toBe('/events/evt_1/checkin');
    expect(eventFormPath('evt_1', 'survey')).toBe('/events/evt_1/survey');
    expect(eventFormPath('evt_1', 'email')).toBe('/events/evt_1/updates');
    expect(eventFormPath('evt_1', 'email-signup')).toBe('/events/evt_1/updates');
  });

  test('a poster deployment rides along; an unknown type is the sign-up form', () => {
    expect(eventFormPath('evt_1', 'checkin', 'dep_9')).toBe(
      '/events/evt_1/checkin?deployment=dep_9'
    );
    expect(eventFormPath('evt_1', 'nonsense')).toBe('/events/evt_1/register');
    expect(eventFormPath('evt_1', null)).toBe('/events/evt_1/register');
    expect(formScreenFor('nonsense')).toBeNull();
  });

  test('the id is encoded, so it can never add a path segment', () => {
    expect(eventFormPath('a/b?c', 'register')).toBe('/events/a%2Fb%3Fc/register');
  });
});

describe('/events/<id>/<form> serves the form', () => {
  for (const [screen, testid] of FORMS) {
    test(`/${screen} shows that form for a live event`, async () => {
      const id = await seed('active');
      const res = await get(`/events/${id}/${screen}`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain(`data-testid="${testid}"`);
      expect(html).toContain(`Bears watch party ${id}`);
    });
  }

  test('HEAD answers too', async () => {
    const id = await seed('active');
    const res = await get(`/events/${id}/register`, { method: 'HEAD' });
    expect(res.status).toBe(200);
  });

  test('?deployment= reaches the form, for poster attribution', async () => {
    const id = await seed('active');
    const html = await (await get(`/events/${id}/register?deployment=dep_abc`)).text();
    expect(html).toContain('data-testid="form-deployment-id" value="dep_abc"');
  });

  test('the screen decides the form; a ?type= on the new address is not read', async () => {
    const id = await seed('active');
    const html = await (await get(`/events/${id}/checkin?type=survey`)).text();
    expect(html).toContain('data-testid="form-checkin"');
    expect(html).not.toContain('data-testid="form-survey"');
  });

  test('a draft answers exactly as /forms/ does for it (forwarded, never the form)', async () => {
    const id = await seed('draft');
    const fresh = await get(`/events/${id}/register`);
    const old = await get(`/forms/${id}?type=register`);
    expect(fresh.status).toBe(old.status);
    expect(fresh.headers.get('Location')).toBe(old.headers.get('Location'));
    expect(await fresh.text()).not.toContain('data-testid="form-register"');
  });

  test('the older /forms/<id>?type= still serves the same form', async () => {
    const id = await seed('active');
    for (const [type, testid] of [
      ['register', 'form-register'],
      ['checkin', 'form-checkin'],
      ['survey', 'form-survey'],
      ['email', 'form-email'],
      ['email-signup', 'form-email'],
    ]) {
      const res = await get(`/forms/${id}?type=${type}`);
      expect(res.status, type).toBe(200);
      expect(await res.text(), type).toContain(`data-testid="${testid}"`);
    }
  });

  test('a readable event name that starts like a form screen is still the event page', async () => {
    const id = await seed('active');
    const res = await get(`/events/${id}/register-night`);
    expect(res.status).toBe(301); // the wrong name forwards to the event's own
    expect(res.headers.get('Location')).toContain(`/events/${id}`);
  });
});

describe('every link the platform writes is the new address', () => {
  test("the event page's choices and its Keep me posted link", async () => {
    const id = await seed('active');
    const res = await get(`/events/${id}/${id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`href="/events/${id}/register"`);
    expect(html).toContain(`href="/events/${id}/checkin"`);
    expect(html).not.toMatch(/href="\/forms\//);
  });

  test('a poster deployment on the event page carries into the form link', async () => {
    const id = await seed('active');
    const html = await (await get(`/events/${id}/${id}?type=checkin&deployment=dep_7`)).text();
    expect(html).toContain(`/events/${id}/checkin?deployment=dep_7`);
  });

  test('the poster bundle links each form at its own address', async () => {
    const id = await seed('active');
    const res = await get(`/api/v2/events/${id}/poster-bundle`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { links: Record<string, string> };
    expect(body.links.register).toBe(`${ORIGIN}/events/${id}/register`);
    expect(body.links.checkin).toBe(`${ORIGIN}/events/${id}/checkin`);
    expect(body.links.survey).toBe(`${ORIGIN}/events/${id}/survey`);
    expect(body.links['email-signup']).toBe(`${ORIGIN}/events/${id}/updates`);
  });

  test("the events list's Register button", () => {
    const html = renderEventCard({ id: 'evt_9', name: 'Bears & Beer', startDateISO: '2026-10-11' });
    expect(html).toContain('href="/events/evt_9/register"');
    expect(html).not.toContain('/forms/');
  });

  test('the sign-up and door short codes (/r/ and /c/) lead to the new addresses', async () => {
    const id = await seed('active');
    const mint = await SELF.fetch(`${ORIGIN}/api/v2/admin/events/${id}/short-links`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-admin-key-e2e-2026',
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    expect(mint.status).toBe(200);
    const { links } = (await mint.json()) as { links: Record<string, string> };
    const person = {
      'User-Agent':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    };
    for (const [key, screen] of [
      ['register', 'register'],
      ['checkin', 'checkin'],
    ]) {
      expect(links[key], key).toBeTruthy();
      const hop = await get(links[key], { headers: person });
      expect(hop.status, key).toBeGreaterThanOrEqual(300);
      expect(hop.status, key).toBeLessThan(400);
      expect(new URL(hop.headers.get('Location') || '', ORIGIN).pathname).toBe(
        `/events/${id}/${screen}`
      );
    }
  });
});
