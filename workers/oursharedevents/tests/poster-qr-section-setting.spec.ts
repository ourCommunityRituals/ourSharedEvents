/**
 * OSE-869 (PO-4) — `settings.showQRSection` finally has a backing.
 *
 * GAS let an organiser print a walk-up event poster with no QR grid. The port
 * kept the poster and dropped the switch: `grep showQRSection src/` was 0 hits.
 * PO decision (2026-09-30): a per-event setting in `events.settings_json`
 * (migration 0082), read only through `lib/event-settings.ts` — the first slice
 * of OSE-851 (X-14), which extends that module rather than adding a second home.
 *
 * Both branches are asserted (a one-branch test only proves the grid still
 * works). The rendered-poster branches live in:
 *   - tests/poster-multi-code-ui.spec.ts › OSE-869 (JSDOM, node project)
 *   - tests/e2e/2-pages/poster-print.spec.ts › showQRSection (component tier)
 */

import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import {
  parseEventSettings,
  showQRSection,
  validateSettingsPatch,
  mergeEventSettings,
} from '../src/lib/event-settings';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
  TEST_SOURCE_FILES_JSON: string;
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
    body: JSON.stringify({ title: `QR switch ${crypto.randomUUID()}`, status: 'active', ...extra }),
  });
  const body = (await res.json()) as { item?: { id: string }; id?: string; error?: string };
  expect(res.status, JSON.stringify(body)).toBe(201);
  return (body.item?.id ?? body.id) as string;
}

async function update(id: string, body: Record<string, unknown>): Promise<Response> {
  return SELF.fetch(`https://t.test/api/v2/admin/events/${id}`, {
    method: 'PUT',
    headers: ADMIN,
    body: JSON.stringify(body),
  });
}

async function bundleSettings(id: string): Promise<Record<string, unknown>> {
  const res = await SELF.fetch(`https://t.test/api/v2/events/${id}/poster-bundle`);
  expect(res.status).toBe(200);
  const b = (await res.json()) as { settings: Record<string, unknown> };
  return b.settings;
}

describe('OSE-869 lib: absent means on; only an explicit false turns the grid off', () => {
  test('parse: absent / {} / malformed / junk all read as on', () => {
    for (const raw of [undefined, null, '', '{}', 'not json', '[]', '{"showQRSection":"no"}']) {
      expect(showQRSection(parseEventSettings(raw)), String(raw)).toBe(true);
    }
  });

  test('parse: explicit false is off, explicit true is on, unknown keys are dropped', () => {
    expect(showQRSection(parseEventSettings('{"showQRSection":false}'))).toBe(false);
    expect(showQRSection(parseEventSettings('{"showQRSection":true}'))).toBe(true);
    expect(parseEventSettings('{"showQRSection":false,"mystery":1}')).toEqual({
      showQRSection: false,
    });
  });

  test('validate: a write is strict — unknown key or non-boolean is refused', () => {
    expect(validateSettingsPatch({ showQRSection: false })).toEqual({
      ok: true,
      value: { showQRSection: false },
    });
    expect(validateSettingsPatch({ showQRSection: 'false' }).ok).toBe(false);
    expect(validateSettingsPatch({ showMystery: true }).ok).toBe(false);
    expect(validateSettingsPatch(['showQRSection']).ok).toBe(false);
    expect(validateSettingsPatch(null).ok).toBe(false);
  });

  test('merge: a partial patch keeps what it does not name', () => {
    expect(mergeEventSettings({ showQRSection: false }, {})).toEqual({ showQRSection: false });
    expect(mergeEventSettings({ showQRSection: false }, { showQRSection: true })).toEqual({
      showQRSection: true,
    });
  });
});

describe('OSE-869 L2: the switch round-trips from admin write to the poster bundle', () => {
  test('an event with no setting shows the grid (existing posters do not change)', async () => {
    const id = await createEvent();
    expect(await bundleSettings(id)).toEqual({ showQRSection: true });
  });

  test('created with showQRSection:false → the bundle says off', async () => {
    const id = await createEvent({ settings: { showQRSection: false } });
    expect(await bundleSettings(id)).toEqual({ showQRSection: false });
  });

  test('PUT turns it off, then back on', async () => {
    const id = await createEvent();
    let res = await update(id, { settings: { showQRSection: false } });
    expect(res.status).toBe(200);
    expect((await bundleSettings(id)).showQRSection).toBe(false);
    res = await update(id, { settings: { showQRSection: true } });
    expect(res.status).toBe(200);
    expect((await bundleSettings(id)).showQRSection).toBe(true);
  });

  test('a PUT that does not mention settings leaves the switch alone', async () => {
    const id = await createEvent({ settings: { showQRSection: false } });
    const res = await update(id, { description: 'Walk-up only, no codes.' });
    expect(res.status).toBe(200);
    expect((await bundleSettings(id)).showQRSection).toBe(false);
  });

  test('a malformed settings write is a 400 INVALID_SETTINGS and changes nothing', async () => {
    const id = await createEvent({ settings: { showQRSection: false } });
    for (const bad of [{ showQRSection: 'no' }, { showSomething: true }, 'off', [false]]) {
      const res = await update(id, { settings: bad });
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(((await res.json()) as { code: string }).code).toBe('INVALID_SETTINGS');
    }
    expect((await bundleSettings(id)).showQRSection).toBe(false);

    const create = await SELF.fetch('https://t.test/api/v2/admin/events', {
      method: 'POST',
      headers: ADMIN,
      body: JSON.stringify({ title: 'bad settings', settings: { showQRSection: 1 } }),
    });
    expect(create.status).toBe(400);
    expect(((await create.json()) as { code: string }).code).toBe('INVALID_SETTINGS');
  });

  test('suppression is visibility, not rendering: codes are still minted, same palette (#3)', async () => {
    const on = await createEvent();
    const off = await createEvent({ settings: { showQRSection: false } });
    const get = async (id: string) =>
      (await (await SELF.fetch(`https://t.test/api/v2/events/${id}/poster-bundle`)).json()) as {
        slots: Array<{ kind: string; qr: string }>;
        uec: Record<string, { scan_hex: string }>;
      };
    const a = await get(on);
    const b = await get(off);
    expect(b.slots.length).toBe(a.slots.length);
    expect(b.slots[0].qr).toMatch(/^data:image\/png;base64,/);
    expect(Object.fromEntries(Object.entries(b.uec).map(([k, v]) => [k, v.scan_hex]))).toEqual(
      Object.fromEntries(Object.entries(a.uec).map(([k, v]) => [k, v.scan_hex]))
    );
  });

  test('settings never reach the public event projection', async () => {
    const id = await createEvent({ settings: { showQRSection: false } });
    const res = await SELF.fetch(`https://t.test/api/v2/events/${id}`);
    const item = ((await res.json()) as { item: Record<string, unknown> }).item;
    expect(item).not.toHaveProperty('settings_json');
    expect(item).not.toHaveProperty('settings');
  });
});

describe('OSE-869 L1: the organiser can reach the switch', () => {
  function sourceFile(suffix: string): string {
    const files: Record<string, string> = JSON.parse(tenv().TEST_SOURCE_FILES_JSON);
    const key = Object.keys(files).find((k) => k.replace(/\\/g, '/').endsWith(suffix));
    return key ? files[key] : '';
  }

  test('admin.html has a labelled "QR codes on the poster" switch that writes settings.showQRSection', () => {
    const admin = sourceFile('templates/admin.html');
    expect(admin).toContain('data-testid="poster-show-qr"');
    expect(admin).toMatch(/<label[^>]*for="poster-show-qr"/);
    expect(admin).toContain('settings: { showQRSection:');
  });

  test('showQRSection is read in exactly one module (no second implementation)', () => {
    const files: Record<string, string> = JSON.parse(tenv().TEST_SOURCE_FILES_JSON);
    const readers = Object.keys(files).filter(
      (k) =>
        /\/src\/(handlers|lib)\//.test(k.replace(/\\/g, '/')) &&
        /settings_json(?!\.sql)/.test(files[k])
    );
    // The lib parses; handlers only select/write the column through it.
    for (const k of readers) {
      const src = files[k];
      if (k.endsWith('lib/event-settings.ts')) continue;
      expect(src, `${k} reads settings_json without lib/event-settings`).toContain(
        'event-settings'
      );
    }
  });
});
