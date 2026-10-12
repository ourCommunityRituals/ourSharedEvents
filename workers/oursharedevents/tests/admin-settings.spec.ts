/**
 * Settings screen data: GET /api/v2/admin/settings.
 *
 * Read only, first slice. Three honest sections and one list:
 *
 *   defaults — what every NEW event starts from today. Platform-wide: there is no
 *              brand-level storage yet, so `editable` is false and the screen says
 *              so. Each value is read from the constant the create path really uses.
 *   plan     — what the plan includes, Enterprise items named not hidden. Shows the
 *              plan; changes nothing.
 *   timings  — platform timings (the listing delay, the draft archive), resolved the
 *              way the code resolves them.
 *   fixed    — what no setting can change, in plain words, built from the same
 *              constants the code enforces so the page cannot drift from the code.
 *
 * Security is never tier-gated: the fixed list is IDENTICAL on free, mid and
 * enterprise, and no plan item is an audit, role, isolation or retention switch.
 *
 * @born-red settings-screen | method: ran before the route, the builder and the
 * retention constants existed (404 on the route, missing modules) | date: 2026-10-04
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { route, type RouterEnv } from '../src/router';
import { buildAdminSettings } from '../src/lib/admin-settings';
import { CORRIDOR_MAP_MIN_COUNT } from '../src/lib/shared-report';
import { PLATFORM_HOME_TZ } from '../src/lib/event-datetime';
import { DWELL_DEFAULT_SECONDS } from '../src/lib/event-settings';
import { REGISTRATION_TTL_DAYS, EMAIL_RETENTION_DAYS } from '../src/lib/retention-windows';
import { TIER_PRESETS, FLAG_KEYS } from '../src/lib/feature-flags';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
  TEST_SOURCE_FILES_JSON: string;
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

async function get(headers: Record<string, string>): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await route(
    new Request('https://ose.test/api/v2/admin/settings', { method: 'GET', headers }),
    routerEnv,
    ctx
  );
  await waitOnExecutionContext(ctx);
  return res;
}

interface Settings {
  ok: boolean;
  read_only: boolean;
  defaults: {
    editable: boolean;
    note: string;
    items: Array<{ key: string; label: string; value: string; source: string }>;
  };
  plan: {
    tier: string;
    name: string;
    description: string;
    items: Array<{ key: string; label: string; included: boolean; lowest_tier: string }>;
  };
  timings: Array<{ key: string; label: string; value: number; unit: string }>;
  fixed: Array<{ key: string; text: string }>;
}

const baseEnv = { PUBLISH_GRACE_MINUTES: undefined, DRAFT_EXPIRY_DAYS: undefined };

describe('GET /api/v2/admin/settings: the route', () => {
  test('is closed to the unauthenticated', async () => {
    const res = await get({});
    expect(res.status).toBe(401);
  });

  test('answers an admin with the four sections', async () => {
    const res = await get(KEY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Settings;
    expect(body.ok).toBe(true);
    expect(body.read_only).toBe(true);
    expect(body.defaults.items.length).toBeGreaterThan(0);
    expect(body.plan.items.length).toBeGreaterThan(0);
    expect(body.timings.length).toBeGreaterThan(0);
    expect(body.fixed.length).toBeGreaterThan(0);
  });

  test('names no person, id or secret (never-who)', async () => {
    const res = await get(KEY);
    const text = JSON.stringify(await res.json());
    expect(text).not.toMatch(/@/);
    expect(text).not.toMatch(/\b[0-9a-f]{32,}\b/i);
    expect(text).not.toMatch(/test-admin-key|ADMIN_KEY/);
  });

  test('is not cacheable by a shared cache', async () => {
    const res = await get(KEY);
    expect(res.headers.get('cache-control') ?? '').toMatch(/no-store|private/);
  });
});

describe('defaults: read from what the create path really does', () => {
  const s = buildAdminSettings({ tier: 'mid', env: baseEnv });
  const item = (k: string) => s.defaults.items.find((i) => i.key === k)!;

  test('are not editable yet, and say so', () => {
    expect(s.defaults.editable).toBe(false);
    expect(s.defaults.note).toMatch(/not.*(yet|built)|coming/i);
    expect(s.defaults.note).toMatch(/existing events/i);
  });

  test('time zone is the platform home zone, the one the create path falls back to', () => {
    expect(item('timezone').value).toBe(PLATFORM_HOME_TZ);
    const files = JSON.parse(tenv.TEST_SOURCE_FILES_JSON) as Record<string, string>;
    const events = Object.entries(files).find(([p]) =>
      p.replace(/\\/g, '/').endsWith('src/handlers/events.ts')
    )?.[1];
    expect(events, 'handlers/events.ts source').toBeDefined();
    expect(events).toContain(`: '${PLATFORM_HOME_TZ}'`);
  });

  test('TV seconds is the display default; QR codes start on', () => {
    expect(item('tv_seconds').value).toBe(`${DWELL_DEFAULT_SECONDS} seconds`);
    expect(item('print_qr').value).toBe('On');
  });

  test('survey and email updates follow the plan, not a platform constant', () => {
    const free = buildAdminSettings({ tier: 'free', env: baseEnv });
    const mid = buildAdminSettings({ tier: 'mid', env: baseEnv });
    const v = (x: Settings | typeof s, k: string) => x.defaults.items.find((i) => i.key === k)!;
    expect(v(free, 'survey').value).toBe(
      TIER_PRESETS.free.flags[FLAG_KEYS.FORMS_SURVEY] ? 'On' : 'Off'
    );
    expect(v(mid, 'survey').value).toBe(
      TIER_PRESETS.mid.flags[FLAG_KEYS.FORMS_SURVEY] ? 'On' : 'Off'
    );
    expect(v(mid, 'survey').source).toBe('plan');
  });
});

describe('plan: shown, never changed, Enterprise items named', () => {
  test('tier name and description come from the tier presets', () => {
    for (const tier of ['free', 'mid', 'enterprise'] as const) {
      const s = buildAdminSettings({ tier, env: baseEnv });
      expect(s.plan.tier).toBe(tier);
      expect(s.plan.name).toBe(TIER_PRESETS[tier].name);
      expect(s.plan.description).toBe(TIER_PRESETS[tier].description);
    }
  });

  test('Enterprise-only items are listed on every plan, marked not included below Enterprise', () => {
    const free = buildAdminSettings({ tier: 'free', env: baseEnv });
    const ent = buildAdminSettings({ tier: 'enterprise', env: baseEnv });
    const wl = (s: Settings | typeof free) =>
      s.plan.items.find((i) => i.key === FLAG_KEYS.BRANDING_WHITE_LABEL)!;
    expect(wl(free)).toBeDefined();
    expect(wl(free).lowest_tier).toBe('enterprise');
    expect(wl(free).included).toBe(false);
    expect(wl(ent).included).toBe(true);
  });

  test('every item says which plan it starts on, and what the current plan includes matches the preset', () => {
    const s = buildAdminSettings({ tier: 'mid', env: baseEnv });
    for (const i of s.plan.items) {
      expect(['free', 'mid', 'enterprise']).toContain(i.lowest_tier);
      expect(i.included).toBe(TIER_PRESETS.mid.flags[i.key as keyof typeof TIER_PRESETS.mid.flags]);
    }
  });

  test('test-only mock switches are not shown as plan features', () => {
    const s = buildAdminSettings({ tier: 'free', env: baseEnv });
    const keys = s.plan.items.map((i) => i.key);
    expect(keys).not.toContain(FLAG_KEYS.CONFIG_MOCK_MODE);
    expect(keys).not.toContain(FLAG_KEYS.CONFIG_MOCK_SPONSOR_COUNT);
  });

  test('every real plan feature has a plain-words label', () => {
    const s = buildAdminSettings({ tier: 'free', env: baseEnv });
    const real = Object.values(FLAG_KEYS).filter(
      (k) => k !== FLAG_KEYS.CONFIG_MOCK_MODE && k !== FLAG_KEYS.CONFIG_MOCK_SPONSOR_COUNT
    );
    expect(s.plan.items.map((i) => i.key).sort()).toEqual([...real].sort());
    for (const i of s.plan.items) expect(i.label.length).toBeGreaterThan(3);
  });
});

describe('security is never tier-gated', () => {
  test('the fixed list is byte-identical on free, mid and enterprise', () => {
    const lists = (['free', 'mid', 'enterprise'] as const).map((tier) =>
      JSON.stringify(buildAdminSettings({ tier, env: baseEnv }).fixed)
    );
    expect(lists[1]).toBe(lists[0]);
    expect(lists[2]).toBe(lists[0]);
  });

  test('no plan item is an audit, role, isolation or retention switch', () => {
    const s = buildAdminSettings({ tier: 'enterprise', env: baseEnv });
    for (const i of s.plan.items) {
      expect(`${i.key} ${i.label}`).not.toMatch(/audit|role|isolation|retention|privacy|security/i);
    }
  });

  test('the fixed list says security is the same on every plan', () => {
    const s = buildAdminSettings({ tier: 'free', env: baseEnv });
    const sec = s.fixed.find((f) => f.key === 'security_same_on_every_plan');
    expect(sec).toBeDefined();
    expect(sec!.text).toMatch(/every plan/i);
  });
});

describe('fixed list: numbers come from the code that enforces them', () => {
  const s = buildAdminSettings({ tier: 'free', env: baseEnv });
  const text = (k: string) => s.fixed.find((f) => f.key === k)?.text ?? '';

  test('the count floor', () => {
    expect(text('count_floor')).toContain(String(CORRIDOR_MAP_MIN_COUNT));
  });

  test('retention windows: registrations and email sign-ups', () => {
    expect(text('retention_registrations')).toContain(`${REGISTRATION_TTL_DAYS} days`);
    // Owner 2026-10-11: counted from registering, and name and email go first.
    expect(text('retention_registrations')).toBe(
      `A registrant's name and email are cleared the day after the event. The rest is deleted ${REGISTRATION_TTL_DAYS} days after they register.`
    );
    expect(text('retention_email')).toContain(`${EMAIL_RETENTION_DAYS} days`);
  });

  test('the form handler derives its windows from the same constants', () => {
    const files = JSON.parse(tenv.TEST_SOURCE_FILES_JSON) as Record<string, string>;
    const forms =
      Object.entries(files).find(([p]) =>
        p.replace(/\\/g, '/').endsWith('src/handlers/forms.ts')
      )?.[1] ?? '';
    expect(forms).toContain('REGISTRATION_TTL_DAYS');
    expect(forms).toContain('EMAIL_RETENTION_DAYS');
  });

  test('the plain-words guarantees are all there', () => {
    for (const k of [
      'privacy_line',
      'count_floor',
      'maps_neighbourhood_only',
      'no_cookies',
      'retention_registrations',
      'retention_email',
      'brand_isolation',
      'uec_colours',
      'security_same_on_every_plan',
      'brand_look_via_magnets',
    ]) {
      expect(text(k), k).not.toBe('');
    }
  });
});

describe('timings: resolved the way the code resolves them', () => {
  const t = (s: ReturnType<typeof buildAdminSettings>, k: string) =>
    s.timings.find((x) => x.key === k)!;

  test('defaults: a 10 minute listing delay and a 30 day draft archive', () => {
    const s = buildAdminSettings({ tier: 'free', env: baseEnv });
    expect(t(s, 'listing_delay_minutes')).toMatchObject({ value: 10, unit: 'minutes' });
    expect(t(s, 'draft_archive_days')).toMatchObject({ value: 30, unit: 'days' });
  });

  test('follow the deployment settings, including off', () => {
    const s = buildAdminSettings({
      tier: 'free',
      env: { PUBLISH_GRACE_MINUTES: '0', DRAFT_EXPIRY_DAYS: '0' },
    });
    expect(t(s, 'listing_delay_minutes').value).toBe(0);
    expect(t(s, 'draft_archive_days').value).toBe(0);
    const s2 = buildAdminSettings({
      tier: 'free',
      env: { PUBLISH_GRACE_MINUTES: '999', DRAFT_EXPIRY_DAYS: '45' },
    });
    expect(t(s2, 'listing_delay_minutes').value).toBe(60); // capped by the code
    expect(t(s2, 'draft_archive_days').value).toBe(45);
  });
});
