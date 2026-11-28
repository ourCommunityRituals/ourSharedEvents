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

  test('every type has the category of its UEC prefix (47 seeded + Watch Party, 0097 + Storytime, 0115 + 20 new, 0127)', async () => {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN category_code = substr(uec_code, 1, instr(uec_code, '-') - 1) THEN 1 ELSE 0 END) AS matched
         FROM event_type_registry`
    ).first<{ total: number; matched: number }>();
    expect(row?.total).toBe(69);
    expect(row?.matched).toBe(69);
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

  // 0127: the picker groups by the 9 buckets. 65 types are offered; the four
  // tier-2 types (Bingo, Charity Night, Parade, Camp) wait for the ceiling.
  test('returns the grouped catalog: 9 buckets, 65 types, 0 orphans, Sports > Bocce', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/admin/event-types', {
      headers: ADMIN_HEADERS,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Catalog;
    expect(body.ok).toBe(true);
    expect(body.orphans).toBe(0);
    expect(body.categories.map((c) => c.code)).toEqual([
      'SPT',
      'GAM',
      'SHW',
      'PTY',
      'BGN',
      'KID',
      'LRN',
      'GIV',
      'CMT',
    ]);
    expect(body.categories.reduce((n, c) => n + c.types.length, 0)).toBe(65);
    const rec = body.categories.find((c) => c.code === 'SPT');
    expect(rec?.name).toBe('Sports & Recreation');
    expect(rec?.types.some((t) => t.uec_code === 'REC-BOCCE-001')).toBe(true);
    expect(body.categories.some((c) => c.code === OTHER_CATEGORY_CODE)).toBe(false);
  });
});

// Owner request 2026-10-10 (migration 0097): Watch Party is a type of its own,
// under Social & Community Dining, and a sponsor can reach it.
describe('Watch Party (0097)', () => {
  test('the picker lists it under Parties & Festivals (its bucket since 0127)', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/admin/event-types', {
      headers: ADMIN_HEADERS,
    });
    const body = (await res.json()) as Catalog;
    const soc = body.categories.find((c) => c.code === 'PTY');
    expect(soc?.name).toBe('Parties & Festivals');
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

// Part of OSE-2155 (migration 0115): Storytime is adults telling stories aloud,
// in Performing Arts, beside Storytelling Night. A new type rather than
// Storytelling Night itself is an assumption, not an owner ruling.
// @born-red OSE-2155 | method: run with 0115 removed, every test here fails | date: 2026-11-21
describe('Storytime (0115)', () => {
  test('the picker lists it under Music & Shows (its bucket since 0127), beside an unchanged Storytelling Night', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/admin/event-types', {
      headers: ADMIN_HEADERS,
    });
    const body = (await res.json()) as Catalog;
    const per = body.categories.find((c) => c.code === 'SHW');
    expect(per?.types.find((t) => t.uec_code === 'PER-STORYTIME-001')).toEqual(
      expect.objectContaining({ id: 'etr-per-storytime', name: 'Storytime' })
    );
    expect(per?.types.find((t) => t.uec_code === 'PER-STORY-001')).toEqual(
      expect.objectContaining({ id: 'etr-per-story', name: 'Storytelling Night' })
    );
  });

  test('it is Phase 1, tier 1, active, and carries no age, child or family wording', async () => {
    const r = await env.DB.prepare(
      `SELECT name, description, phase, legal_clearance_tier, is_active, category_code
         FROM event_type_registry WHERE uec_code = 'PER-STORYTIME-001'`
    ).first<{
      name: string;
      description: string;
      phase: number;
      legal_clearance_tier: number;
      is_active: number;
      category_code: string;
    }>();
    expect(r).toEqual(
      expect.objectContaining({
        phase: 1,
        legal_clearance_tier: 1,
        is_active: 1,
        category_code: 'PER',
      })
    );
    // The owner: no HIPAA, COPPA or SOPPA until further notice. The type names
    // no audience by age or family.
    expect(`${r?.name} ${r?.description}`).not.toMatch(
      /\b(child|children|kid|kids|toddler|baby|babies|infant|family|families|parent|carer|caregiver|ages?\s*\d)/i
    );
  });

  test('a sponsor can reach it through the same template as Storytelling Night', async () => {
    const rows = await env.DB.prepare(
      `SELECT uec_code, template_id FROM template_event_types
        WHERE uec_code IN ('PER-STORY-001', 'PER-STORYTIME-001')
        ORDER BY uec_code, template_id`
    ).all<{ uec_code: string; template_id: string }>();
    expect(rows.results).toEqual([
      { uec_code: 'PER-STORY-001', template_id: 'music_event' },
      { uec_code: 'PER-STORYTIME-001', template_id: 'music_event' },
    ]);
  });

  test('an event can be saved as Storytime', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/admin/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
      body: JSON.stringify({
        attendance_mode: 'in_person',
        location: 'Test Hall',
        title: 'Told stories night',
        brand_id: BRAND,
        slug: `story-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        event_type_id: 'etr-per-storytime',
      }),
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const r = await env.DB.prepare('SELECT event_type_id FROM events WHERE id = ?')
      .bind(id)
      .first<{ event_type_id: string | null }>();
    expect(r?.event_type_id).toBe('etr-per-storytime');
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

  test('wizard step 1: the same two-level picker, ahead of the copy-prefill cards', async () => {
    const h = await html();
    // Owner 2026-11-27: two screens; "what kind" is on step 1.
    const step1 = h.indexOf('id="wizard-step-1"');
    const picker = h.indexOf('id="wizard-category"');
    const cards = h.indexOf('id="wizardTemplatePicker"');
    const step2 = h.indexOf('id="wizard-step-2"');
    expect(step1).toBeGreaterThan(-1);
    expect(picker).toBeGreaterThan(step1);
    expect(cards).toBeGreaterThan(picker);
    expect(step2).toBeGreaterThan(cards);
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

// Owner approval 2026-11-28 (OCR-docs PROPOSAL_event-type-buckets.md, D1 to D6):
// the 9 buckets are a display layer. Ids, uec_code and category_code stay.
// @born-red | method: run with 0127 removed, every test here fails | date: 2026-11-28
describe('event type buckets (0127)', () => {
  const BUCKET_OF: Record<string, string> = {
    'etr-rec-bocce': 'SPT',
    'etr-fit-running': 'SPT',
    'etr-gar-trail': 'SPT',
    'etr-rec-soccer': 'SPT',
    'etr-ent-trivia': 'GAM',
    'etr-tab-rpg': 'GAM',
    'etr-ent-film': 'SHW',
    'etr-ent-karaoke': 'SHW',
    'etr-art-gallery': 'SHW',
    'etr-art-cultural': 'PTY',
    'etr-gar-harvest': 'PTY',
    'etr-soc-potluck': 'PTY',
    'etr-civ-parade': 'PTY',
    'etr-mkt-craft': 'BGN',
    'etr-mkt-yardsale': 'BGN',
    'etr-soc-kidsparty': 'KID',
    'etr-rec-camp': 'KID',
    'etr-biz-network': 'LRN',
    'etr-lit-bookclub': 'LRN',
    'etr-gar-planting': 'GIV',
    'etr-vol-mutual': 'GIV',
    'etr-fnd-charity': 'GIV',
    'etr-civ-meeting': 'CMT',
    'etr-fai-service': 'CMT',
  };

  test('every type has a bucket that exists, and every bucket has a type', async () => {
    const orphans = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM event_type_registry
        WHERE bucket_code IS NULL OR bucket_code NOT IN (SELECT bucket_code FROM event_type_bucket)`
    ).first<{ n: number }>();
    expect(orphans?.n).toBe(0);
    const empty = await env.DB.prepare(
      `SELECT b.bucket_code FROM event_type_bucket b
        WHERE NOT EXISTS (SELECT 1 FROM event_type_registry t WHERE t.bucket_code = b.bucket_code)`
    ).all<{ bucket_code: string }>();
    expect(empty.results).toEqual([]);
  });

  test('types sit in the bucket the proposal names (the exceptions too)', async () => {
    const rows = await env.DB.prepare('SELECT id, bucket_code FROM event_type_registry').all<{
      id: string;
      bucket_code: string;
    }>();
    const got = new Map(rows.results.map((r) => [r.id, r.bucket_code]));
    for (const [id, bucket] of Object.entries(BUCKET_OF)) expect(got.get(id), id).toBe(bucket);
  });

  test('the guts stay: the 15 categories are unchanged and every old id keeps its code', async () => {
    const cats = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM event_type_category_registry WHERE is_active = 1'
    ).first<{ n: number }>();
    expect(cats?.n).toBe(15);
    const mutual = await env.DB.prepare(
      "SELECT uec_code, category_code FROM event_type_registry WHERE id = 'etr-vol-mutual'"
    ).first<{ uec_code: string; category_code: string }>();
    expect(mutual).toEqual({ uec_code: 'VOL-MUTUAL-001', category_code: 'VOL' });
  });

  test('plain names (D6) change the display name only', async () => {
    const r = await env.DB.prepare(
      "SELECT name FROM event_type_registry WHERE id IN ('etr-vol-mutual', 'etr-biz-workshop', 'etr-soc-potluck') ORDER BY id"
    ).all<{ name: string }>();
    expect(r.results.map((x) => x.name)).toEqual([
      'Job Skills Class',
      'Potluck',
      'Free Supplies Giveaway',
    ]);
  });

  test('types that can need a licence are tier 2, hidden from the picker, on an unselectable template', async () => {
    const tiered = await env.DB.prepare(
      'SELECT id FROM event_type_registry WHERE legal_clearance_tier > 1 ORDER BY id'
    ).all<{ id: string }>();
    expect(tiered.results.map((r) => r.id)).toEqual([
      'etr-civ-parade',
      'etr-ent-bingo',
      'etr-fnd-charity',
      'etr-rec-camp',
    ]);
    const res = await SELF.fetch('https://t.test/api/v2/admin/event-types', {
      headers: ADMIN_HEADERS,
    });
    const body = (await res.json()) as Catalog;
    const offered = body.categories.flatMap((c) => c.types.map((t) => t.id));
    for (const r of tiered.results) expect(offered, r.id).not.toContain(r.id);
    expect(offered).toContain('etr-rec-soccer');
    // No template people can choose today was raised above tier 1 by a new type.
    const raised = await env.DB.prepare(
      `SELECT DISTINCT t.template_id FROM template_event_types t
         JOIN event_type_registry r ON r.uec_code = t.uec_code
        WHERE r.legal_clearance_tier > 1`
    ).all<{ template_id: string }>();
    expect(raised.results.map((r) => r.template_id)).toEqual(['licensed_gathering']);
  });

  test('drinking games are never a type', async () => {
    const r = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM event_type_registry WHERE lower(name) LIKE '%drinking%' OR lower(name) LIKE '%beer pong%'"
    ).first<{ n: number }>();
    expect(r?.n).toBe(0);
  });
});
