/**
 * OSE-2207 — a sponsor's kind of business (migration 0116; owner 2026-11-22: in
 * Create Sponsor the icon slider picks the kind of business, saved with the
 * sponsor).
 *
 *   - admin create / update: business_kind is optional, must be on the list in
 *     lib/business-kinds.ts exactly, and '' / null clears it; leaving it out of
 *     an update keeps it;
 *   - the admin reads it back (one sponsor and the list);
 *   - the public bundle does not carry it (nothing public reads it yet);
 *   - the admin page draws the slider in the sponsor form, one button per kind,
 *     with its own icon, and sends nothing until one is tapped.
 *
 * @born-red OSE-2207 | method: run with src/handlers/sponsors.ts at the parent
 *   commit (migration 0116 kept): create ignored the field (stored NULL), the
 *   unknown kind was accepted, the read had no business_kind; and with the
 *   admin page's marker left unreplaced (no slider). | date: 2026-11-22
 */

import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { BUSINESS_KINDS, BUSINESS_KIND_ICONS, isBusinessKind } from '../src/lib/business-kinds';
import { iconSvg } from '../src/lib/category-slider';

const ADMIN = { Authorization: 'Bearer test-admin-key-e2e-2026' };

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}

async function applyMigrations(db: D1Database, json: string): Promise<void> {
  for (const stmt of JSON.parse(json) as string[]) {
    try {
      await db.prepare(stmt).run();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes('duplicate column name') || m.includes('already exists')) continue;
      throw e;
    }
  }
}

const BRAND = 'ose2207';
const EVENT = 'ose2207-evt';

beforeAll(async () => {
  const tenv = env as unknown as TestEnv;
  await applyMigrations(tenv.DB, tenv.TEST_MIGRATION_STATEMENTS);
  await applyMigrations(tenv.FORMS_DB, tenv.TEST_FORMS_MIGRATION_STATEMENTS);
  await env.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, start_date, settings_json)
     VALUES (?, ?, 'Kind Night', ?, 'active', '2026-11-30', '{"useSponsors":true}') ON CONFLICT(id) DO NOTHING`
  )
    .bind(EVENT, BRAND, EVENT)
    .run();
});

type Json = Record<string, unknown>;

async function send(method: string, path: string, payload?: Json) {
  const res = await SELF.fetch(`https://t.test${path}`, {
    method,
    headers: { ...ADMIN, 'Content-Type': 'application/json' },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  return { status: res.status, body: (await res.json()) as Json };
}
const create = (p: Json) =>
  send('POST', '/api/v2/admin/sponsors', { tier: 'gold', event_id: EVENT, ...p });
const update = (id: string, p: Json) =>
  send('PUT', `/api/v2/admin/sponsors/${encodeURIComponent(id)}`, p);
const stored = async (id: string) =>
  (
    await env.DB.prepare('SELECT business_kind FROM sponsor_business WHERE id = ?')
      .bind(id)
      .first<{ business_kind: string | null }>()
  )?.business_kind;

describe('OSE-2207 | the list of kinds', () => {
  test('twenty kinds, unique lower-case values, each with its own drawing', () => {
    expect(BUSINESS_KINDS).toHaveLength(20);
    const values = BUSINESS_KINDS.map((k) => k.value);
    expect(new Set(values).size).toBe(values.length);
    for (const v of values) {
      expect(v).toMatch(/^[a-z][a-z_]*$/);
      expect(BUSINESS_KIND_ICONS[v], v).toBeTruthy();
    }
    const drawings = values.map((v) => BUSINESS_KIND_ICONS[v]);
    expect(new Set(drawings).size).toBe(drawings.length);
    expect(BUSINESS_KINDS[BUSINESS_KINDS.length - 1]!.value).toBe('other');
  });

  test('isBusinessKind is exact: no case, space or near miss gets through', () => {
    expect(isBusinessKind('bar')).toBe(true);
    for (const v of ['Bar', ' bar', 'bar ', 'bars', '', null, 1, {}, 'restaurant;drop']) {
      expect(isBusinessKind(v), String(v)).toBe(false);
    }
  });
});

describe('OSE-2207 | business_kind on the admin sponsor API', () => {
  test('stored on create and read back by the admin, one sponsor and the list', async () => {
    const { status, body } = await create({ name: 'Kind Bar', business_kind: 'bar' });
    expect(status, JSON.stringify(body)).toBe(201);
    const id = String(body.id);
    expect(await stored(id)).toBe('bar');
    const one = await send('GET', `/api/v2/admin/sponsors/${id}`);
    expect((one.body.item as Json).business_kind).toBe('bar');
    const list = await send('GET', `/api/v2/admin/sponsors?event_id=${EVENT}`);
    const row = ((list.body.items ?? list.body.sponsors) as Json[]).find((s) => s.id === id);
    expect(row?.business_kind).toBe('bar');
  });

  test('optional: left out, it is NULL', async () => {
    const { status, body } = await create({ name: 'Kind None' });
    expect(status).toBe(201);
    expect(await stored(String(body.id))).toBeNull();
  });

  test('an unknown kind is refused with INVALID_BUSINESS_KIND and nothing is created', async () => {
    for (const bad of ['Bar', 'nightclub', ' bar', 42, ['bar']]) {
      const { status, body } = await create({ name: `Bad ${String(bad)}`, business_kind: bad });
      expect(status, String(bad)).toBe(400);
      expect(body.code).toBe('INVALID_BUSINESS_KIND');
    }
    const n = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM sponsor_business WHERE name LIKE 'Bad %'"
    ).first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  test('update: changes it, keeps it when left out, clears it with null or empty', async () => {
    const id = String((await create({ name: 'Kind Changer', business_kind: 'cafe' })).body.id);
    expect((await update(id, { business_kind: 'grocery' })).status).toBe(200);
    expect(await stored(id)).toBe('grocery');
    expect((await update(id, { name: 'Kind Changer 2' })).status).toBe(200);
    expect(await stored(id)).toBe('grocery');
    expect((await update(id, { business_kind: null })).status).toBe(200);
    expect(await stored(id)).toBeNull();
    expect((await update(id, { business_kind: 'pets' })).status).toBe(200);
    expect((await update(id, { business_kind: '' })).status).toBe(200);
    expect(await stored(id)).toBeNull();
    const bad = await update(id, { business_kind: 'PETS' });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('INVALID_BUSINESS_KIND');
  });

  test('the public poster bundle does not carry it', async () => {
    const id = String((await create({ name: 'Kind Public', business_kind: 'legal' })).body.id);
    await env.DB.prepare(
      'UPDATE sponsor_placement SET sponsor_accepted = 1 WHERE sponsor_business_id = ?'
    )
      .bind(id)
      .run();
    const res = await SELF.fetch(`https://t.test/api/v2/events/${EVENT}/poster-bundle`);
    const text = await res.text();
    expect(text).not.toContain('business_kind');
    expect(text).not.toContain('"legal"');
  });
});

describe('OSE-2207 | the admin page draws the kind slider in the sponsor form', () => {
  test('one button per kind with its own icon, none chosen, an empty field, named arrows', async () => {
    const res = await SELF.fetch('https://t.test/admin', { headers: ADMIN });
    expect(res.status).toBe(200);
    const page = await res.text();
    expect(page).not.toContain('<!--OCR_SPON_KIND-->');
    const field = page.slice(page.indexOf('data-testid="spon-kind-field"'));
    expect(field).toContain(
      '<p class="icon-slider-heading" id="spon-kind-label">Kind of business (optional)</p>'
    );
    for (const k of BUSINESS_KINDS) {
      expect(field).toContain(
        `<button type="button" class="icon-slider-item" data-value="${k.value}" aria-pressed="false" data-testid="spon-kind-${k.value}">${iconSvg(k.value, BUSINESS_KIND_ICONS)}`
      );
    }
    expect(field).toContain(
      '<input type="hidden" name="business_kind" value="" data-icon-slider-value />'
    );
    expect(field).toContain('aria-label="Show more kinds"');
    // The slider's own script carries the page's nonce like every other script.
    expect(field).toMatch(
      /<script nonce="[^"]+">\(function \(\) \{\n  var all = document\.querySelectorAll\('\[data-icon-slider\]'\)/
    );
  });
});
