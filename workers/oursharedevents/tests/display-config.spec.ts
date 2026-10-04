/**
 * GET /api/v2/events/:id/display-config — the TV's saved order, seconds per
 * screen and league links (settings.displayPanes / displayDwellSeconds /
 * leagueLinks, lib/event-settings.ts), with a strong ETag and a 304 when the
 * TV's copy is current. Ported idea: the GAS-era bundle ETag + the display's
 * swr() (MVP-EVENT-TOOLKIT worker/src/handlers/posterBundle.ts).
 *
 * L2: the admin write round-trips to what the TV reads, both branches.
 */

import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}
const tenv = () => env as unknown as TestEnv;
const ADMIN = {
  Authorization: 'Bearer test-admin-key-e2e-2026',
  'Content-Type': 'application/json',
};

async function applyMigrations(db: D1Database, json: string): Promise<void> {
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
  await applyMigrations(tenv().DB, tenv().TEST_MIGRATION_STATEMENTS);
  await applyMigrations(tenv().FORMS_DB, tenv().TEST_FORMS_MIGRATION_STATEMENTS);
});

async function createEvent(extra: Record<string, unknown> = {}): Promise<string> {
  const res = await SELF.fetch('https://t.test/api/v2/admin/events', {
    method: 'POST',
    headers: ADMIN,
    body: JSON.stringify({ title: `TV ${crypto.randomUUID()}`, status: 'active', ...extra }),
  });
  const body = (await res.json()) as { item?: { id: string }; id?: string };
  expect(res.status, JSON.stringify(body)).toBe(201);
  return (body.item?.id ?? body.id) as string;
}

async function put(id: string, settings: Record<string, unknown>): Promise<Response> {
  return SELF.fetch(`https://t.test/api/v2/admin/events/${id}`, {
    method: 'PUT',
    headers: ADMIN,
    body: JSON.stringify({ settings }),
  });
}

interface Config {
  ok: boolean;
  panes: string[];
  dwell_seconds: number;
  league: Array<{ kind: string; label: string; url: string; qr: string | null }>;
  event_page: { url: string; qr: string | null };
  donate: { label: string; url: string; qr: string | null } | null;
}

async function config(id: string, headers: Record<string, string> = {}) {
  const res = await SELF.fetch(`https://t.test/api/v2/events/${id}/display-config`, { headers });
  return res;
}

describe('display-config: what the TV reads', () => {
  test('an event with nothing saved gets the default order and 15 s, no league', async () => {
    const id = await createEvent();
    const res = await config(id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Config;
    expect(body.panes).toEqual(['event', 'upcoming', 'sponsors', 'league', 'donate']);
    expect(body.dwell_seconds).toBe(15);
    expect(body.league).toEqual([]);
    // No donate link saved: no donate screen. The event's own page is always there.
    expect(body.donate).toBeNull();
    expect(body.event_page.url).toBe(`https://t.test/events/${id}`);
    expect(body.event_page.qr).toMatch(/^data:image\/png;base64,/);
  });

  test('OSE-1521: the donate link round-trips with a QR; the sponsor screens are chosen, never default', async () => {
    const id = await createEvent();
    const saved = await put(id, {
      displayPanes: ['event', 'donate', 'sponsor'],
      donateLink: 'https://donate.example/give',
    });
    expect(saved.status).toBe(200);
    const body = (await (await config(id)).json()) as Config;
    expect(body.panes).toEqual(['event', 'donate', 'sponsor']);
    expect(body.donate).toMatchObject({ label: 'Donate', url: 'https://donate.example/give' });
    expect(body.donate!.qr).toMatch(/^data:image\/png;base64,/);
    // null clears it again: the screen goes away, the order stays.
    expect((await put(id, { donateLink: null })).status).toBe(200);
    const after = (await (await config(id)).json()) as Config;
    expect(after.donate).toBeNull();
    expect(after.panes).toEqual(['event', 'donate', 'sponsor']);
  });

  test('OSE-1521: a donate link that is not https, or too long for the QR, is a 400 and nothing changes', async () => {
    const id = await createEvent({ settings: { donateLink: 'https://donate.example/ok' } });
    const before = await (await config(id)).text();
    for (const bad of [
      'http://donate.example/',
      'javascript:alert(1)',
      `https://donate.example/${'x'.repeat(155 - 23 + 1)}`,
    ]) {
      const res = await put(id, { donateLink: bad });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { code?: string }).code).toBe('INVALID_SETTINGS');
    }
    expect(await (await config(id)).text()).toBe(before);
  });

  test('OSE-1521: nothing numeric about a fundraiser is stored or served (no counts on the TV)', async () => {
    const id = await createEvent();
    expect((await put(id, { donateGoal: 5000 })).status).toBe(400);
    expect((await put(id, { donateRaised: 1200 })).status).toBe(400);
    const text = await (await config(id)).text();
    expect(text).not.toMatch(/goal|raised|progress|amount/i);
  });

  test('the admin save round-trips: order, dwell and league links with QR codes', async () => {
    const id = await createEvent();
    const saved = await put(id, {
      displayPanes: ['league', 'event'],
      displayDwellSeconds: 30,
      leagueLinks: {
        standings: 'https://docs.google.com/spreadsheets/d/abcdefghijklmnop/edit#gid=0',
        schedule: 'https://league.example/schedule',
      },
    });
    expect(saved.status).toBe(200);
    const body = (await (await config(id)).json()) as Config;
    expect(body.panes).toEqual(['league', 'event']);
    expect(body.dwell_seconds).toBe(30);
    // Fixed order (schedule, standings, bracket), only the links that exist.
    expect(body.league.map((l) => [l.kind, l.label])).toEqual([
      ['schedule', 'Schedule'],
      ['standings', 'Standings'],
    ]);
    for (const l of body.league) expect(l.qr).toMatch(/^data:image\/png;base64,/);
  });

  test('null clears a link and the order goes back to default; other links stay', async () => {
    const id = await createEvent({
      settings: {
        displayPanes: ['sponsors'],
        leagueLinks: {
          schedule: 'https://league.example/s',
          bracket: 'https://league.example/b',
        },
      },
    });
    expect((await put(id, { displayPanes: null, leagueLinks: { schedule: null } })).status).toBe(
      200
    );
    const body = (await (await config(id)).json()) as Config;
    expect(body.panes).toEqual(['event', 'upcoming', 'sponsors', 'league', 'donate']);
    expect(body.league.map((l) => l.kind)).toEqual(['bracket']);
  });

  test('a bad write is a 400 INVALID_SETTINGS and the TV config is unchanged', async () => {
    const id = await createEvent({ settings: { displayDwellSeconds: 20 } });
    const before = await (await config(id)).text();
    const res = await put(id, { leagueLinks: { schedule: 'http://not-https.example/' } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe('INVALID_SETTINGS');
    expect(await (await config(id)).text()).toBe(before);
  });

  test('the poster switch and the TV settings do not disturb each other', async () => {
    const id = await createEvent({ settings: { showQRSection: false } });
    await put(id, { displayDwellSeconds: 40 });
    const poster = await SELF.fetch(`https://t.test/api/v2/events/${id}/poster-bundle`);
    expect(((await poster.json()) as { settings: unknown }).settings).toEqual({
      showQRSection: false,
    });
    expect(((await (await config(id)).json()) as Config).dwell_seconds).toBe(40);
  });

  test('a draft or unknown event is not shown on a TV', async () => {
    const draft = await createEvent({ status: 'draft' });
    expect((await config(draft)).status).toBe(403);
    expect((await config('no-such-event')).status).toBe(404);
  });
});

describe('display-config: ETag / 304', () => {
  test('a strong ETag, and Cache-Control that always revalidates', async () => {
    const id = await createEvent();
    const res = await config(id);
    expect(res.headers.get('ETag')).toMatch(/^"[0-9a-f]{32}"$/);
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
  });

  test('sending the ETag back gets a bodiless 304 while nothing changed', async () => {
    const id = await createEvent();
    const etag = (await config(id)).headers.get('ETag')!;
    const again = await config(id, { 'If-None-Match': etag });
    expect(again.status).toBe(304);
    expect(again.headers.get('ETag')).toBe(etag);
    expect(await again.text()).toBe('');
    // A weak or listed form of the same tag matches too.
    expect((await config(id, { 'If-None-Match': `"x", W/${etag}` })).status).toBe(304);
  });

  test('saving a new order changes the ETag, so the old one gets the new body', async () => {
    const id = await createEvent();
    const etag = (await config(id)).headers.get('ETag')!;
    await put(id, { displayPanes: ['event'] });
    const res = await config(id, { 'If-None-Match': etag });
    expect(res.status).toBe(200);
    expect(res.headers.get('ETag')).not.toBe(etag);
    expect(((await res.json()) as Config).panes).toEqual(['event']);
  });

  test('two events never share an ETag', async () => {
    const a = (await config(await createEvent())).headers.get('ETag');
    const b = (await config(await createEvent())).headers.get('ETag');
    expect(a).not.toBe(b);
  });
});

describe('admin display-config: what the TV card loads', () => {
  test('works on a draft (configure the TV before going live)', async () => {
    const id = await createEvent({ status: 'draft', settings: { displayDwellSeconds: 25 } });
    const res = await SELF.fetch(`https://t.test/api/v2/admin/events/${id}/display-config`, {
      headers: ADMIN,
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Config).dwell_seconds).toBe(25);
  });

  test('needs admin auth', async () => {
    const id = await createEvent();
    const res = await SELF.fetch(`https://t.test/api/v2/admin/events/${id}/display-config`);
    expect(res.status).toBe(401);
  });

  test('an unknown event is a 404', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/admin/events/no-such/display-config', {
      headers: ADMIN,
    });
    expect(res.status).toBe(404);
  });
});
