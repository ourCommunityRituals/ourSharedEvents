/**
 * OSE-1344 — Category → Type picker ("Sports > Bocce").
 *
 * Measured 2026-09-16: neither create path had an event type control. The
 * advanced form had no field; the wizard's step 2 was four hardcoded
 * copy-prefill cards. `events.event_type_id` (0023) had NEVER been written.
 * The 47 types (0024) carried their category only as the UEC prefix.
 *
 * This spec pins:
 *   1. the acceptance criterion — after migration 0076 every active type has a
 *      category, i.e. zero orphans (a type without one would otherwise vanish
 *      from a naive picker; ours groups it under "Other" AND the count is 0);
 *   2. the pure grouping (lib/event-type-catalog.ts): order, alpha types,
 *      empty categories dropped, orphans → "Other" last, inactive skipped;
 *   3. GET /api/v2/admin/event-types — auth, envelope, 15 categories / 47 types;
 *   4. create + update actually WRITE event_type_id; a bad id is a 400, null
 *      clears; legal_clearance_tier is NOT derived (Invariant #4, OSE-380);
 *   5. admin.html carries the two-level picker on BOTH create paths, driven by
 *      one loader, and both POSTs send event_type_id.
 *
 * @born-red OSE-1344 | 2026-09-16 — (3)–(5) fail on the pre-change tree.
 */

import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import {
  buildEventTypeCatalog,
  isEventTypeIdShape,
  OTHER_CATEGORY_CODE,
} from '../src/lib/event-type-catalog';
import { handleAdminPage } from '../src/handlers/pages';

const ADMIN_HEADERS = { Authorization: 'Bearer test-admin-key-e2e-2026' };
const BRAND = 'ose-1344';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  const statements: string[] = JSON.parse(tenv.TEST_MIGRATION_STATEMENTS);
  for (const stmt of statements) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }
}

interface Catalog {
  ok: boolean;
  categories: {
    code: string;
    name: string;
    types: { id: string; uec_code: string; name: string }[];
  }[];
  orphans: number;
}

beforeAll(applyMigrations);

describe('acceptance criterion — no orphaned types after 0076', () => {
  test('every active type resolves to an active category row (0 orphans)', async () => {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM event_type_registry t
        WHERE t.is_active = 1
          AND (t.category_code IS NULL
               OR t.category_code NOT IN (SELECT category_code FROM event_type_category_registry WHERE is_active = 1))`
    ).first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  test('every type has the category of its UEC prefix (47 seeded + Watch Party, 0097)', async () => {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN category_code = substr(uec_code, 1, instr(uec_code, '-') - 1) THEN 1 ELSE 0 END) AS matched
         FROM event_type_registry`
    ).first<{ total: number; matched: number }>();
    expect(row?.total).toBe(48);
    expect(row?.matched).toBe(48);
  });

  test('15 categories, and every one has at least one type', async () => {
    const rows = await env.DB.prepare(
      `SELECT c.category_code, COUNT(t.id) AS n
         FROM event_type_category_registry c
         LEFT JOIN event_type_registry t ON t.category_code = c.category_code AND t.is_active = 1
        GROUP BY c.category_code`
    ).all<{ category_code: string; n: number }>();
    expect(rows.results).toHaveLength(15);
    for (const r of rows.results) expect(r.n, r.category_code).toBeGreaterThan(0);
  });
});

describe('buildEventTypeCatalog (pure)', () => {
  const cats = [
    { category_code: 'SOC', display_name: 'Social', display_order: 20 },
    { category_code: 'REC', display_name: 'Sports', display_order: 10 },
    { category_code: 'EMPTY', display_name: 'Nothing here', display_order: 5 },
    { category_code: 'OFF', display_name: 'Retired', display_order: 1, is_active: 0 },
  ];
  const types = [
    {
      id: 'etr-rec-softball',
      uec_code: 'REC-SOFTBALL-001',
      name: 'Softball',
      description: null,
      category_code: 'REC',
    },
    {
      id: 'etr-rec-bocce',
      uec_code: 'REC-BOCCE-001',
      name: 'Bocce Tournament',
      description: 'x',
      category_code: 'REC',
    },
    {
      id: 'etr-soc-dinner',
      uec_code: 'SOC-DINNER-001',
      name: 'Dinner',
      description: null,
      category_code: 'SOC',
    },
    {
      id: 'etr-zzz-lost',
      uec_code: 'ZZZ-LOST-001',
      name: 'Lost type',
      description: null,
      category_code: 'ZZZ',
    },
    {
      id: 'etr-null',
      uec_code: 'NUL-X-001',
      name: 'No category',
      description: null,
      category_code: null,
    },
    {
      id: 'etr-off',
      uec_code: 'OFF-X-001',
      name: 'In a retired category',
      description: null,
      category_code: 'OFF',
    },
    {
      id: 'etr-inactive',
      uec_code: 'REC-OLD-001',
      name: 'Inactive',
      description: null,
      category_code: 'REC',
      is_active: 0,
    },
  ];

  test('categories by display_order, types alphabetical, empty categories dropped', () => {
    const c = buildEventTypeCatalog(cats, types);
    expect(c.categories.map((x) => x.code)).toEqual(['REC', 'SOC', OTHER_CATEGORY_CODE]);
    expect(c.categories[0].types.map((t) => t.name)).toEqual(['Bocce Tournament', 'Softball']);
  });

  test('a type is NEVER dropped: unmapped / null / retired-category types land in Other and are counted', () => {
    const c = buildEventTypeCatalog(cats, types);
    const other = c.categories[c.categories.length - 1];
    expect(other.code).toBe(OTHER_CATEGORY_CODE);
    expect(other.types.map((t) => t.id).sort()).toEqual(['etr-null', 'etr-off', 'etr-zzz-lost']);
    expect(c.orphans).toBe(3);
    const all = c.categories.flatMap((x) => x.types.map((t) => t.id));
    expect(all).not.toContain('etr-inactive');
    expect(all).toHaveLength(6);
  });

  test('id shape is bounded and lowercase-safe (no whitespace, no SQL-ish junk)', () => {
    expect(isEventTypeIdShape('etr-rec-bocce')).toBe(true);
    expect(isEventTypeIdShape('')).toBe(false);
    expect(isEventTypeIdShape("etr' OR 1=1")).toBe(false);
    expect(isEventTypeIdShape('a'.repeat(65))).toBe(false);
    expect(isEventTypeIdShape(42)).toBe(false);
  });
});

describe('GET /api/v2/admin/event-types', () => {
  test('requires admin', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/admin/event-types');
    expect(res.status).toBe(401);
  });

  test('returns the grouped catalog: 15 categories, 48 types, 0 orphans, Sports > Bocce', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/admin/event-types', {
      headers: ADMIN_HEADERS,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Catalog;
    expect(body.ok).toBe(true);
    expect(body.orphans).toBe(0);
    expect(body.categories).toHaveLength(15);
    expect(body.categories.reduce((n, c) => n + c.types.length, 0)).toBe(48);
    const rec = body.categories.find((c) => c.code === 'REC');
    expect(rec?.name).toMatch(/Sports/);
    expect(rec?.types.some((t) => t.uec_code === 'REC-BOCCE-001')).toBe(true);
    expect(body.categories.some((c) => c.code === OTHER_CATEGORY_CODE)).toBe(false);
  });
});

// Owner request 2026-10-10 (migration 0097): Watch Party is a type of its own,
// under Social & Community Dining, and a sponsor can reach it.
describe('Watch Party (0097)', () => {
  test('the picker lists it under Social & Community Dining', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/admin/event-types', {
      headers: ADMIN_HEADERS,
    });
    const body = (await res.json()) as Catalog;
    const soc = body.categories.find((c) => c.code === 'SOC');
    expect(soc?.name).toBe('Social & Community Dining');
    expect(soc?.types.find((t) => t.uec_code === 'SOC-WATCHPARTY-001')).toEqual(
      expect.objectContaining({ id: 'etr-soc-watchparty', name: 'Watch Party' })
    );
  });

  test('it is mapped to the bar night and community gathering templates', async () => {
    const rows = await env.DB.prepare(
      "SELECT template_id FROM template_event_types WHERE uec_code = 'SOC-WATCHPARTY-001' ORDER BY template_id"
    ).all<{ template_id: string }>();
    expect(rows.results.map((r) => r.template_id)).toEqual(['bar_night', 'community_gathering']);
  });

  test('an event can be saved as a Watch Party', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/admin/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
      body: JSON.stringify({
        attendance_mode: 'in_person',
        location: 'Test Hall',
        title: 'Watch the Bears game',
        brand_id: BRAND,
        slug: `watch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        event_type_id: 'etr-soc-watchparty',
      }),
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const r = await env.DB.prepare('SELECT event_type_id FROM events WHERE id = ?')
      .bind(id)
      .first<{ event_type_id: string | null }>();
    expect(r?.event_type_id).toBe('etr-soc-watchparty');
  });
});

describe('event_type_id is written on create and update', () => {
  async function create(extra: Record<string, unknown>): Promise<Response> {
    return SELF.fetch('https://t.test/api/v2/admin/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
      body: JSON.stringify({
        attendance_mode: 'in_person',
        location: 'Test Hall',
        title: 'OSE-1344',
        brand_id: BRAND,
        slug: `ose1344-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        ...extra,
      }),
    });
  }
  async function row(id: string) {
    return env.DB.prepare('SELECT event_type_id, legal_clearance_tier FROM events WHERE id = ?')
      .bind(id)
      .first<{ event_type_id: string | null; legal_clearance_tier: number }>();
  }

  test('create with a valid id stores it — and leaves legal_clearance_tier at the DB default', async () => {
    const res = await create({ event_type_id: 'etr-rec-bocce' });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const r = await row(id);
    expect(r?.event_type_id).toBe('etr-rec-bocce');
    // Invariant #4 (OSE-380): the type is a discovery classification; the
    // regulatory tier is never written through the API, not even by derivation.
    expect(r?.legal_clearance_tier).toBe(1);
  });

  test('create without a type still saves (the picker is optional)', async () => {
    const res = await create({});
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect((await row(id))?.event_type_id).toBeNull();
  });

  test('create with an unknown or malformed id is a 400, never a silent NULL', async () => {
    for (const bad of ['etr-does-not-exist', "x' OR 1=1", 12]) {
      const res = await create({ event_type_id: bad });
      expect(res.status, String(bad)).toBe(400);
      expect(((await res.json()) as { code: string }).code).toBe('INVALID_EVENT_TYPE');
    }
  });

  test('update sets, rejects, and clears', async () => {
    const created = await create({});
    const { id } = (await created.json()) as { id: string };
    const put = (body: unknown) =>
      SELF.fetch(`https://t.test/api/v2/admin/events/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
        body: JSON.stringify(body),
      });
    expect((await put({ event_type_id: 'etr-rec-bocce' })).status).toBe(200);
    expect((await row(id))?.event_type_id).toBe('etr-rec-bocce');
    expect((await put({ event_type_id: 'nope' })).status).toBe(400);
    expect((await row(id))?.event_type_id).toBe('etr-rec-bocce');
    expect((await put({ event_type_id: null })).status).toBe(200);
    expect((await row(id))?.event_type_id).toBeNull();
  });
});

describe('admin.html — the picker is on BOTH create paths', () => {
  const html = () => handleAdminPage({} as never).text();

  test('advanced form: Category → Type selects, type disabled until a category is chosen', async () => {
    const h = await html();
    expect(h).toMatch(
      /id="create-category"[^>]*data-type-picker="category"[^>]*data-type-select="create-event-type"/s
    );
    expect(h).toMatch(/id="create-event-type"[^>]*name="event_type_id"[^>]*disabled/s);
    expect(h).toContain('data-testid="create-type-picker-msg"');
  });

  test('wizard step 2: the same two-level picker, ahead of the copy-prefill cards', async () => {
    const h = await html();
    const step2 = h.indexOf('id="wizard-step-2"');
    const picker = h.indexOf('id="wizard-category"');
    const cards = h.indexOf('id="wizardTemplatePicker"');
    const step3 = h.indexOf('id="wizard-step-3"');
    expect(step2).toBeGreaterThan(-1);
    expect(picker).toBeGreaterThan(step2);
    expect(cards).toBeGreaterThan(picker);
    expect(step3).toBeGreaterThan(cards);
    expect(h).toMatch(/id="wizard-category"[^>]*data-type-select="wizard-event-type"/s);
  });

  test('one loader feeds both: a single fetch of the catalog, mounted by attribute', async () => {
    const h = await html();
    expect(h.split("fetch('/api/v2/admin/event-types')").length - 1).toBe(1);
    expect(h).toContain(
      'document.querySelectorAll(\'[data-type-picker="category"]\').forEach(mount)'
    );
    expect(h).toContain('window.oseTypePicker = {');
  });

  test('both POSTs send event_type_id when a type was picked', async () => {
    const h = await html();
    expect(h).toContain("window.oseTypePicker.value('wizard-event-type')");
    expect(h).toContain('if (wizTypeId) body.event_type_id = wizTypeId;');
    expect(h).toContain("window.oseTypePicker.value('create-event-type')");
    expect(h).toContain('if (typeId) body.event_type_id = typeId;');
  });

  test('DOM is built with createElement/textContent, never innerHTML, and a failed load is honest', async () => {
    const h = await html();
    const start = h.indexOf('OSE-1344 — ONE event-type picker');
    const end = h.indexOf('</script>', start);
    const block = h.slice(start, end);
    expect(block).not.toMatch(/\.innerHTML\s*=/);
    expect(block).toContain('o.textContent = label;');
    expect(block).toContain('You can still save and set the type later.');
  });
});
