/**
 * OSE-1357 part 2 — more than one code per poster, each pointing at a target
 * the organizer picks. API half (workers pool): the admin endpoint, the /s/
 * resolver, and the poster bundle, end to end through SELF.fetch + D1.
 * UI half: tests/poster-multi-code-ui.spec.ts (node + jsdom, admin card + /poster).
 *
 * Covers: N codes persisted and returned in order with the event page first;
 * each kind's target (check-in → the event's check-in form, donate / ourWKRP →
 * validated https only; javascript:/http:/data: refused with a clear 400); the
 * plan's code allotment enforced server-side; /s/<code> for every code routes to
 * its target; the bundle carries word + tone per code; removed codes keep
 * routing; tracking (/q) and routing (/s) stay separate; a click stores no
 * location.
 *
 * @born-red OSE-1357 | method: spec written before the change and run against
 *   the base branch (claude/poster-address-walk-in + poster-print-digital: no
 *   /poster-codes route, no poster_position, check-in codes impossible) — red;
 *   green after | date: 2026-09-29
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { AS_PERSON } from './helpers/person-agent';

const ADMIN_HEADERS = {
  Authorization: 'Bearer test-admin-key-e2e-2026',
  'Content-Type': 'application/json',
} as const;

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}
const tenv = () => env as unknown as TestEnv;

const BRAND = 'poster-multi-1357';
const EVT = 'evt-multi-code-1357';
const EVT_LEGACY = 'evt-multi-code-1357-legacy';
const ORIGIN = 'https://t.test';
const DONATE = 'https://give.example.org/harbor-bocce';
const OW = 'https://ourwkrp.example.org/playlists/bocce-night';

interface Code {
  kind: string;
  word: string;
  uec: { id: string; color: string; scan_hex: string };
  code: string;
  url: string;
  target_url: string | null;
  points_to: string;
  qr: string;
}
interface CodesBody {
  ok: boolean;
  limit: number;
  kinds: Array<{ kind: string; word: string; needs_url: boolean }>;
  codes: Code[];
  code?: string;
  error?: string;
  index?: number;
}

async function applyMigrations(): Promise<void> {
  const sets: Array<[D1Database, string]> = [
    [tenv().DB, tenv().TEST_MIGRATION_STATEMENTS],
    [tenv().FORMS_DB, tenv().TEST_FORMS_MIGRATION_STATEMENTS],
  ];
  for (const [db, json] of sets) {
    for (const stmt of JSON.parse(json) as string[]) {
      try {
        await db.prepare(stmt).run();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/duplicate column name|already exists|no such column/.test(msg)) continue;
        throw e;
      }
    }
  }
}

const codesUrl = (id: string) => `${ORIGIN}/api/v2/admin/events/${id}/poster-codes`;

async function getCodes(id = EVT): Promise<CodesBody> {
  const res = await SELF.fetch(codesUrl(id), { headers: ADMIN_HEADERS });
  expect(res.status).toBe(200);
  return res.json();
}

async function putCodes(body: unknown, id = EVT): Promise<{ status: number; body: CodesBody }> {
  const res = await SELF.fetch(codesUrl(id), {
    method: 'PUT',
    headers: ADMIN_HEADERS,
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function follow(code: string): Promise<string | null> {
  const res = await SELF.fetch(`${ORIGIN}/s/${code}`, { redirect: 'manual', headers: AS_PERSON });
  expect(res.status).toBe(302);
  return res.headers.get('Location');
}

beforeAll(async () => {
  await applyMigrations();
  await tenv()
    .DB.prepare('DELETE FROM shortlinks WHERE event_id IN (?, ?)')
    .bind(EVT, EVT_LEGACY)
    .run();
  await tenv().DB.prepare('DELETE FROM events WHERE brand_id = ?').bind(BRAND).run();
  await tenv()
    .DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status)
       VALUES (?, ?, 'Harbor County Bocce', 'multi-code-1357', 'active')`
    )
    .bind(EVT, BRAND)
    .run();
  await tenv()
    .DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, what_url, what_url_type, what_url_enabled)
       VALUES (?, ?, 'Legacy Link', 'multi-code-1357-legacy', 'active', ?, 'donation', 1)`
    )
    .bind(EVT_LEGACY, BRAND, DONATE)
    .run();
});

describe('OSE-1357 p2 | the admin reads the poster’s codes', () => {
  test('a new event starts with the event page only; the plan allotment is a number, never a tier name', async () => {
    const body = await getCodes();
    expect(body.ok).toBe(true);
    expect(body.codes.map((c) => c.kind)).toEqual(['public']);
    expect(body.codes[0].word).toBe('EVENT');
    expect(body.codes[0].points_to).toBe(`${ORIGIN}/events/${EVT}`);
    expect(Number.isInteger(body.limit)).toBe(true);
    expect(body.limit).toBeGreaterThanOrEqual(2);
    // Organizer language only — no internal tier codes leak into the response.
    expect(JSON.stringify(body)).not.toMatch(/"(free|mid|enterprise)"|tier/i);
    // Every target the brief names is pickable; the event page is not (implicit).
    const kinds = body.kinds.map((k) => k.kind);
    for (const k of ['checkin', 'donation', 'signup', 'tickets', 'website', 'ow']) {
      expect(kinds).toContain(k);
    }
    expect(kinds).not.toContain('public');
    expect(body.kinds.find((k) => k.kind === 'checkin')!.needs_url).toBe(false);
    expect(body.kinds.find((k) => k.kind === 'donation')!.needs_url).toBe(true);
  });

  test('an event with an existing typed link carries it over (event page + donate)', async () => {
    const body = await getCodes(EVT_LEGACY);
    expect(body.codes.map((c) => c.kind)).toEqual(['public', 'donation']);
    expect(body.codes[1].target_url).toBe(DONATE);
  });

  test('admin only: no credentials → 401 for GET and PUT', async () => {
    const get = await SELF.fetch(codesUrl(EVT));
    expect(get.status).toBe(401);
    const put = await SELF.fetch(codesUrl(EVT), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codes: [] }),
    });
    expect(put.status).toBe(401);
  });

  test('unknown event → 404', async () => {
    const res = await SELF.fetch(codesUrl('evt-does-not-exist-1357'), { headers: ADMIN_HEADERS });
    expect(res.status).toBe(404);
  });
});

describe('OSE-1357 p2 | save: N codes, in order, event page first', () => {
  let saved: Code[] = [];

  beforeAll(async () => {
    const { limit } = await getCodes();
    // Use as many kinds as the plan fits (≥ 2 extra), in a deliberate order.
    const wanted = [
      { kind: 'checkin', target_url: 'https://evil.example/ignored' },
      { kind: 'donation', target_url: DONATE },
      { kind: 'ow', target_url: OW },
    ].slice(0, Math.max(1, limit - 1));
    expect(wanted.length).toBeGreaterThanOrEqual(2);
    const { status, body } = await putCodes({ codes: wanted });
    expect(status, JSON.stringify(body)).toBe(200);
    saved = body.codes;
  });

  test('the response lists the event page first, then the codes in the order sent', () => {
    expect(saved[0].kind).toBe('public');
    expect(saved.slice(1, 3).map((c) => c.kind)).toEqual(['checkin', 'donation']);
  });

  test('every code has its own 6-char /s/ short link and a QR picture of it', () => {
    const codes = saved.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of saved) {
      expect(c.code).toMatch(/^[A-Za-z0-9]{6}$/);
      expect(c.url).toBe(`${ORIGIN}/s/${c.code}`);
      expect(c.qr).toMatch(/^data:image\/(png|gif);base64,/);
    }
  });

  test('word + UEC per kind: check-in is CHECK-IN, donate is SHOP, the event page is UTILITY', () => {
    const by = Object.fromEntries(saved.map((c) => [c.kind, c]));
    expect(by.checkin.word).toBe('CHECK IN');
    expect(by.checkin.uec).toMatchObject({ id: 'CHECK-IN', color: 'Teal' });
    expect(by.donation.word).toBe('DONATE');
    expect(by.donation.uec).toMatchObject({ id: 'SHOP', color: 'Dark Teal' });
    expect(by.public.uec.id).toBe('UTILITY');
    if (by.ow) expect(by.ow.uec.id).toBe('UTILITY');
    for (const c of saved) expect(c.uec.scan_hex).toMatch(/^#[0-9A-F]{6}$/i);
  });

  test('check-in is built server-side (the check-in form); a client-sent target is dropped', async () => {
    const checkin = saved.find((c) => c.kind === 'checkin')!;
    expect(checkin.target_url).toBeNull();
    expect(checkin.points_to).toBe(`${ORIGIN}/forms/${EVT}?type=checkin`);
    const row = await tenv()
      .DB.prepare('SELECT target_url FROM shortlinks WHERE code = ?')
      .bind(checkin.code)
      .first<{ target_url: string | null }>();
    expect(row!.target_url).toBeNull();
  });

  test('persisted: poster_position 0..N in the saved order', async () => {
    const rows = await tenv()
      .DB.prepare(
        `SELECT code, kind, poster_position FROM shortlinks
          WHERE event_id = ? AND poster_position IS NOT NULL ORDER BY poster_position`
      )
      .bind(EVT)
      .all<{ code: string; kind: string | null; poster_position: number }>();
    expect(rows.results.map((r) => r.poster_position)).toEqual(saved.map((_, i) => i));
    expect(rows.results.map((r) => r.code)).toEqual(saved.map((c) => c.code));
    // …and a re-read returns the same list.
    expect((await getCodes()).codes.map((c) => c.code)).toEqual(saved.map((c) => c.code));
  });

  test('/s/<code> routes each code to its own target', async () => {
    for (const c of saved) {
      const loc = await follow(c.code);
      if (c.kind === 'public') expect(loc).toBe(`${ORIGIN}/events/${EVT}`);
      if (c.kind === 'checkin') expect(loc).toBe(`${ORIGIN}/forms/${EVT}?type=checkin`);
      if (c.kind === 'donation') expect(loc).toBe(DONATE);
      if (c.kind === 'ow') expect(loc).toBe(OW);
    }
  });

  test('the check-in redirect carries no identity — only the event id and the form type', async () => {
    const checkin = saved.find((c) => c.kind === 'checkin')!;
    const loc = new URL((await follow(checkin.code))!);
    expect([...loc.searchParams.keys()]).toEqual(['type']);
    expect(loc.pathname).toBe(`/forms/${EVT}`);
  });

  test('never-who: a click is a counter; shortlinks has no location / person column', async () => {
    const donate = saved.find((c) => c.kind === 'donation')!;
    const before = await tenv()
      .DB.prepare('SELECT clicks FROM shortlinks WHERE code = ?')
      .bind(donate.code)
      .first<{ clicks: number }>();
    await follow(donate.code);
    const after = await tenv()
      .DB.prepare('SELECT clicks FROM shortlinks WHERE code = ?')
      .bind(donate.code)
      .first<{ clicks: number }>();
    expect(after!.clicks).toBe(before!.clicks + 1);
    const cols = await tenv().DB.prepare('PRAGMA table_info(shortlinks)').all<{ name: string }>();
    const names = cols.results.map((c) => c.name).sort();
    expect(names).toEqual(
      [
        'clicks',
        'code',
        'created_at',
        'event_id',
        'kind',
        'last_clicked_at',
        'poster_position',
        'target_url',
      ].sort()
    );
  });

  test('the poster bundle renders the saved codes in order, each with word + UEC, all /s/ (never /q/)', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v2/events/${EVT}/poster-bundle`);
    expect(res.status).toBe(200);
    const bundle = (await res.json()) as {
      slots: Array<{
        kind: string;
        word: string;
        uec: { id: string; scan_hex: string };
        code: string;
        url: string;
        qr: string;
      }>;
    };
    expect(bundle.slots.map((s) => s.code)).toEqual(saved.map((c) => c.code));
    for (const s of bundle.slots) {
      expect(s.word.length).toBeGreaterThan(0);
      expect(s.uec.id.length).toBeGreaterThan(0);
      expect(s.uec.scan_hex).toMatch(/^#[0-9A-F]{6}$/i);
      expect(s.url).toBe(`${ORIGIN}/s/${s.code}`);
      expect(s.url).not.toContain('/q/');
      expect(s.qr).toMatch(/^data:image\//);
    }
  });
});

describe('OSE-1357 p2 | reorder, edit in place, remove (printed codes keep working)', () => {
  test('reorder keeps each kind’s code; editing a target updates it in place; a removed code still routes', async () => {
    const first = await putCodes({
      codes: [{ kind: 'checkin' }, { kind: 'donation', target_url: DONATE }],
    });
    expect(first.status).toBe(200);
    const codeOf = (list: Code[], k: string) => list.find((c) => c.kind === k)!.code;
    const checkinCode = codeOf(first.body.codes, 'checkin');
    const donateCode = codeOf(first.body.codes, 'donation');

    // Reorder + fix the donate link.
    const FIXED = 'https://give.example.org/harbor-bocce-2026';
    const second = await putCodes({
      codes: [{ kind: 'donation', target_url: FIXED }, { kind: 'checkin' }],
    });
    expect(second.status).toBe(200);
    expect(second.body.codes.map((c) => c.kind)).toEqual(['public', 'donation', 'checkin']);
    expect(codeOf(second.body.codes, 'donation')).toBe(donateCode);
    expect(codeOf(second.body.codes, 'checkin')).toBe(checkinCode);
    expect(await follow(donateCode)).toBe(FIXED);

    // Remove donate: off the poster, but its printed code still routes.
    const third = await putCodes({ codes: [{ kind: 'checkin' }] });
    expect(third.status).toBe(200);
    expect(third.body.codes.map((c) => c.kind)).toEqual(['public', 'checkin']);
    const row = await tenv()
      .DB.prepare('SELECT poster_position FROM shortlinks WHERE code = ?')
      .bind(donateCode)
      .first<{ poster_position: number | null }>();
    expect(row!.poster_position).toBeNull();
    expect(await follow(donateCode)).toBe(FIXED);

    // Re-adding the kind reuses its code (one row per kind per event).
    const fourth = await putCodes({
      codes: [{ kind: 'checkin' }, { kind: 'donation', target_url: FIXED }],
    });
    expect(codeOf(fourth.body.codes, 'donation')).toBe(donateCode);
  });

  test('an explicit public entry is ignored — the event page is always first', async () => {
    const { status, body } = await putCodes({
      codes: [{ kind: 'checkin' }, { kind: 'public' }],
    });
    expect(status).toBe(200);
    expect(body.codes.map((c) => c.kind)).toEqual(['public', 'checkin']);
  });
});

describe('OSE-1357 p2 | fat-finger + abuse refusals (clear 400s, nothing written)', () => {
  const HOSTILE = [
    'javascript:alert(1)',
    'http://give.example.org/donate',
    'data:text/html,<script>alert(1)</script>',
    'ftp://give.example.org',
    'give.example.org/donate',
    '',
  ];
  for (const target of HOSTILE) {
    test(`donate target ${JSON.stringify(target)} → 400 INVALID_TARGET`, async () => {
      const before = await getCodes();
      const { status, body } = await putCodes({
        codes: [{ kind: 'checkin' }, { kind: 'donation', target_url: target }],
      });
      expect(status).toBe(400);
      expect(body.code).toBe('INVALID_TARGET');
      expect(body.index).toBe(1);
      expect(body.error).toMatch(/https:\/\//);
      // Nothing changed.
      expect((await getCodes()).codes.map((c) => c.code)).toEqual(before.codes.map((c) => c.code));
    });
  }

  test('an ourWKRP link must be https too', async () => {
    const { status, body } = await putCodes({
      codes: [{ kind: 'ow', target_url: 'http://ourwkrp.example.org/x' }],
    });
    expect(status).toBe(400);
    expect(body.code).toBe('INVALID_TARGET');
  });

  test('unknown kind → 400 INVALID_KIND; duplicate kind → 400 DUPLICATE_KIND; bad body → 400', async () => {
    expect((await putCodes({ codes: [{ kind: 'tracking' }] })).body.code).toBe('INVALID_KIND');
    const dup = await putCodes({ codes: [{ kind: 'checkin' }, { kind: 'checkin' }] });
    expect(dup.status).toBe(400);
    expect(dup.body.code).toBe('DUPLICATE_KIND');
    const bad = await putCodes({ codes: 'checkin' });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('INVALID_BODY');
  });

  test('the plan allotment is enforced by the server, with a clear error', async () => {
    const { limit } = await getCodes();
    const kinds = [
      'checkin',
      'donation',
      'signup',
      'tickets',
      'website',
      'ow',
      'league',
      'menu',
      'substack',
      'workshop',
    ];
    const over = kinds
      .slice(0, limit)
      .map((kind) =>
        kind === 'checkin' ? { kind } : { kind, target_url: `https://example.org/${kind}` }
      );
    expect(over.length + 1).toBe(limit + 1); // one more than the plan fits (event page counts)
    const before = await getCodes();
    const { status, body } = await putCodes({ codes: over });
    expect(status).toBe(403);
    expect(body.code).toBe('PLAN_LIMIT');
    expect(body.limit).toBe(limit);
    expect(body.error).toContain(String(limit));
    expect(body.error).not.toMatch(/\b(free|mid|enterprise)\b/i);
    expect((await getCodes()).codes.map((c) => c.code)).toEqual(before.codes.map((c) => c.code));
    // Exactly at the limit is fine.
    const at = await putCodes({ codes: over.slice(0, limit - 1) });
    expect(at.status).toBe(200);
    expect(at.body.codes).toHaveLength(limit);
  });

  test('a hostile-but-https target is stored and returned verbatim as DATA (rendering keeps it text)', async () => {
    const hostile = 'https://x.example/"><img src=x onerror=alert(1)>';
    const { status, body } = await putCodes({
      codes: [{ kind: 'donation', target_url: hostile }],
    });
    expect(status).toBe(200);
    expect(body.codes.find((c) => c.kind === 'donation')!.target_url).toBe(hostile);
  });
});
