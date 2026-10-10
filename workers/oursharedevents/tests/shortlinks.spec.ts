/**
 * OSE-240 / BE-25 — Shortlinks lib + handler end-to-end coverage.
 *
 * Unit (L1):
 *   - generateCode: base62, 6-char, never repeats inside a single call
 *   - isValidCodeShape: accept-list of base62 / reject everything else
 *
 * Behavioral (L2):
 *   - POST /api/v2/admin/events response carries `shortcode`
 *   - GET /s/:code 302-redirects to /api/v2/events/:id
 *   - GET /s/:code increments clicks counter + stamps last_clicked_at
 *   - GET /s/<malformed> returns 404 (probing reveals nothing)
 *   - GET /s/<unknown valid-shape> returns 404 (same shape as malformed)
 *   - Anonymity-principle compliance: shortlinks table has NO column
 *     that could carry per-attendee identity (counter + timestamp only).
 *
 * Static (L1 source-scan):
 *   - handlers/shortlink-resolve.ts never reads IP / Cookie / Referer
 *     from the request (anonymity-principle gate).
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  generateCode,
  isValidCodeShape,
  isValidHttpsTarget,
  createShortlink,
  ensureSlotShortlinks,
  resolveCode,
  incrementClick,
} from '../src/lib/shortlinks';
import { isLinkPreviewAgent } from '../src/lib/share-count';
import { AS_PERSON, PERSON_UA } from './helpers/person-agent';

const ADMIN_HEADERS = { Authorization: 'Bearer test-admin-key-e2e-2026' };
const BRAND = 'ose240-test';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_SOURCE_FILES_JSON: string;
}

interface CreateEventResponse {
  ok: boolean;
  status?: number;
  id?: string;
  slug?: string;
  shortcode?: string | null;
}

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  const stmts: string[] = JSON.parse(tenv.TEST_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        msg.includes('duplicate column name') ||
        msg.includes('already exists') ||
        msg.includes('no such column')
      ) {
        continue;
      }
      throw e;
    }
  }
}

beforeAll(async () => {
  await applyMigrations();
  // Clean slate for this brand so re-runs are deterministic.
  const tenv = env as unknown as TestEnv;
  await tenv.DB.prepare('DELETE FROM events WHERE brand_id = ?').bind(BRAND).run();
});

describe('OSE-240: generateCode', () => {
  test('produces a 6-character base62 string', () => {
    const code = generateCode();
    expect(code).toMatch(/^[A-Za-z0-9]{6}$/);
    expect(code.length).toBe(6);
  });

  test('produces high entropy (1000 codes, near-zero collisions)', () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      set.add(generateCode());
    }
    // 62^6 = 56.8 billion; 1000 draws should have 0 collisions with
    // overwhelming probability. Allow 1 collision as a flake guard.
    expect(set.size).toBeGreaterThanOrEqual(999);
  });
});

describe('OSE-240: isValidCodeShape', () => {
  test('accepts valid base62 6-char strings', () => {
    expect(isValidCodeShape('abc123')).toBe(true);
    expect(isValidCodeShape('AbCdEf')).toBe(true);
    expect(isValidCodeShape('Z9z0Aa')).toBe(true);
  });

  test('rejects wrong-length strings', () => {
    expect(isValidCodeShape('')).toBe(false);
    expect(isValidCodeShape('abc')).toBe(false);
    expect(isValidCodeShape('abcdefg')).toBe(false);
  });

  test('rejects non-base62 characters', () => {
    expect(isValidCodeShape('abc-12')).toBe(false);
    expect(isValidCodeShape('abc 12')).toBe(false);
    expect(isValidCodeShape('abc.12')).toBe(false);
    expect(isValidCodeShape('abc/12')).toBe(false);
  });

  test('rejects non-string inputs gracefully', () => {
    // @ts-expect-error testing runtime safety
    expect(isValidCodeShape(undefined)).toBe(false);
    // @ts-expect-error testing runtime safety
    expect(isValidCodeShape(null)).toBe(false);
    // @ts-expect-error testing runtime safety
    expect(isValidCodeShape(123456)).toBe(false);
  });
});

describe('OSE-240: createShortlink + resolveCode lib round-trip', () => {
  test('creates a shortlink for an event and resolves it back', async () => {
    const tenv = env as unknown as TestEnv;
    const eventId = `evt_ose240_lib_${Date.now()}`;
    await tenv.DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    )
      .bind(eventId, BRAND, 'Lib roundtrip', 'lib-roundtrip', 'active')
      .run();

    const { code } = await createShortlink(tenv, eventId);
    expect(isValidCodeShape(code)).toBe(true);

    const resolved = await resolveCode(tenv, code);
    expect(resolved).not.toBeNull();
    expect(resolved!.event_id).toBe(eventId);
    expect(resolved!.code).toBe(code);
  });

  // ── Rb — external-target routing (open-redirect-safe; https validated at creation) ──
  test('isValidHttpsTarget accepts https and rejects every unsafe/non-https form', () => {
    expect(isValidHttpsTarget('https://give.example.org/donate')).toBe(true);
    expect(isValidHttpsTarget('http://give.example.org')).toBe(false); // not https
    expect(isValidHttpsTarget('javascript:alert(1)')).toBe(false); // scheme injection
    expect(isValidHttpsTarget('data:text/html,<script>x</script>')).toBe(false);
    expect(isValidHttpsTarget('/events/evt_x')).toBe(false); // not an absolute URL
    expect(isValidHttpsTarget('')).toBe(false);
    expect(isValidHttpsTarget('https://x/' + 'a'.repeat(3000))).toBe(false); // over length cap
    // @ts-expect-error runtime safety
    expect(isValidHttpsTarget(null)).toBe(false);
  });

  test('createShortlink REJECTS a non-https target at creation (fat-finger + open-redirect gate)', async () => {
    const tenv = env as unknown as TestEnv;
    const eventId = `evt_ose240_badtarget_${Date.now()}`;
    await tenv.DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    )
      .bind(eventId, BRAND, 'Bad target', 'bad-target', 'active')
      .run();
    await expect(
      createShortlink(tenv, eventId, { targetUrl: 'javascript:alert(1)' })
    ).rejects.toThrow();
    await expect(
      createShortlink(tenv, eventId, { targetUrl: 'http://insecure.example' })
    ).rejects.toThrow();
  });

  test('a shortlink with an https target_url 302-redirects to that external destination', async () => {
    const tenv = env as unknown as TestEnv;
    const eventId = `evt_ose240_donate_${Date.now()}`;
    await tenv.DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    )
      .bind(eventId, BRAND, 'Donate slot', 'donate-slot', 'active')
      .run();
    const target = 'https://give.example.org/campaign/bocce';
    const { code } = await createShortlink(tenv, eventId, { targetUrl: target, kind: 'donate' });

    const resolved = await resolveCode(tenv, code);
    expect(resolved!.target_url).toBe(target);

    const res = await SELF.fetch(`https://t.test/s/${code}`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(target);
  });

  test('a shortlink with NO target_url still routes to the event public page (backward-compatible)', async () => {
    const tenv = env as unknown as TestEnv;
    const eventId = `evt_ose240_public_${Date.now()}`;
    await tenv.DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    )
      .bind(eventId, BRAND, 'Public slot', 'public-slot', 'active')
      .run();
    const { code } = await createShortlink(tenv, eventId, { kind: 'public' });
    const res = await SELF.fetch(`https://t.test/s/${code}`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toContain(`/events/${eventId}`);
  });

  // ── Per-slot shortlink minting (poster destination slots) ──
  async function seedSlotEvent(tenv: TestEnv, id: string, title: string): Promise<void> {
    await tenv.DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    )
      .bind(id, BRAND, title, id, 'active')
      .run();
  }

  test('ensureSlotShortlinks returns only the Public slot when there is no typed link', async () => {
    const tenv = env as unknown as TestEnv;
    const eventId = `evt_ose240_slots_pub_${Date.now()}`;
    await seedSlotEvent(tenv, eventId, 'Slots public');
    const slots = await ensureSlotShortlinks(tenv, eventId, {});
    expect(slots).toHaveLength(1);
    expect(slots[0]!.kind).toBe('public');
    expect(slots[0]!.target_url).toBeNull();
  });

  test('ensureSlotShortlinks adds a typed slot when what_url is enabled + https', async () => {
    const tenv = env as unknown as TestEnv;
    const eventId = `evt_ose240_slots_typed_${Date.now()}`;
    await seedSlotEvent(tenv, eventId, 'Slots typed');
    const slots = await ensureSlotShortlinks(tenv, eventId, {
      whatUrl: 'https://give.example.org/donate',
      whatUrlType: 'donate',
      whatUrlEnabled: 1,
    });
    expect(slots.map((s) => s.kind)).toEqual(['public', 'donate']);
    expect(slots[1]!.target_url).toBe('https://give.example.org/donate');
  });

  test('ensureSlotShortlinks omits the typed slot when disabled or non-https', async () => {
    const tenv = env as unknown as TestEnv;
    const eventId = `evt_ose240_slots_off_${Date.now()}`;
    await seedSlotEvent(tenv, eventId, 'Slots off');
    const disabled = await ensureSlotShortlinks(tenv, eventId, {
      whatUrl: 'https://give.example.org',
      whatUrlType: 'donate',
      whatUrlEnabled: 0,
    });
    expect(disabled).toHaveLength(1);
    const insecure = await ensureSlotShortlinks(tenv, eventId, {
      whatUrl: 'http://insecure.example',
      whatUrlType: 'donate',
      whatUrlEnabled: 1,
    });
    expect(insecure).toHaveLength(1);
  });

  test('ensureSlotShortlinks is idempotent and reuses the creation shortlink for Public', async () => {
    const tenv = env as unknown as TestEnv;
    const eventId = `evt_ose240_slots_idem_${Date.now()}`;
    await seedSlotEvent(tenv, eventId, 'Slots idem');
    const creation = await createShortlink(tenv, eventId); // event's kind-less shortlink
    const first = await ensureSlotShortlinks(tenv, eventId, {
      whatUrl: 'https://x.example/signup',
      whatUrlType: 'signup',
      whatUrlEnabled: 1,
    });
    const second = await ensureSlotShortlinks(tenv, eventId, {
      whatUrl: 'https://x.example/signup',
      whatUrlType: 'signup',
      whatUrlEnabled: 1,
    });
    expect(first.map((s) => s.code)).toEqual(second.map((s) => s.code));
    expect(first[0]!.code).toBe(creation.code);
  });

  test('resolveCode returns null for unknown but valid-shape codes', async () => {
    const tenv = env as unknown as TestEnv;
    const result = await resolveCode(tenv, 'ZzZzZz');
    expect(result).toBeNull();
  });

  test('resolveCode returns null for malformed codes (DB never hit)', async () => {
    const tenv = env as unknown as TestEnv;
    expect(await resolveCode(tenv, '')).toBeNull();
    expect(await resolveCode(tenv, 'abc-12')).toBeNull();
    expect(await resolveCode(tenv, 'too-long-code')).toBeNull();
  });

  test('incrementClick raises the counter + stamps last_clicked_at', async () => {
    const tenv = env as unknown as TestEnv;
    const eventId = `evt_ose240_click_${Date.now()}`;
    await tenv.DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    )
      .bind(eventId, BRAND, 'Click counter', 'click-counter', 'active')
      .run();
    const { code } = await createShortlink(tenv, eventId);

    const afterFirst = await incrementClick(tenv, code);
    expect(afterFirst).toBe(1);
    const afterSecond = await incrementClick(tenv, code);
    expect(afterSecond).toBe(2);

    const row = await tenv.DB.prepare(`SELECT last_clicked_at FROM shortlinks WHERE code = ?`)
      .bind(code)
      .first<{ last_clicked_at: string }>();
    expect(row?.last_clicked_at).toBeTruthy();
  });
});

describe('OSE-1613: shortlink clicks by day (aggregate series, never per-click)', () => {
  async function seedLink(tag: string): Promise<string> {
    const tenv = env as unknown as TestEnv;
    const eventId = `evt_ose1613_${tag}_${Date.now()}`;
    await tenv.DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    )
      .bind(eventId, BRAND, `Daily ${tag}`, `daily-${tag}`, 'active')
      .run();
    return (await createShortlink(tenv, eventId)).code;
  }

  test('each click adds one to today bucket and to the total', async () => {
    const tenv = env as unknown as TestEnv;
    const code = await seedLink('bucket');
    await incrementClick(tenv, code);
    await incrementClick(tenv, code);
    await incrementClick(tenv, code);

    const rows = await tenv.DB.prepare(
      `SELECT day, clicks FROM shortlink_click_daily WHERE code = ?`
    )
      .bind(code)
      .all<{ day: string; clicks: number }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0].day).toBe(new Date().toISOString().slice(0, 10));
    expect(rows.results[0].clicks).toBe(3);

    const total = await tenv.DB.prepare(`SELECT clicks FROM shortlinks WHERE code = ?`)
      .bind(code)
      .first<{ clicks: number }>();
    expect(total?.clicks).toBe(3);
  });

  test('an unknown code creates no bucket', async () => {
    const tenv = env as unknown as TestEnv;
    await incrementClick(tenv, 'ZzNone');
    const row = await tenv.DB.prepare(
      `SELECT COUNT(*) AS n FROM shortlink_click_daily WHERE code = ?`
    )
      .bind('ZzNone')
      .first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  test('a bucket write failure never breaks the click or the redirect path', async () => {
    const tenv = env as unknown as TestEnv;
    const code = await seedLink('fail');
    await tenv.DB.prepare(
      `ALTER TABLE shortlink_click_daily RENAME TO shortlink_click_daily_off`
    ).run();
    try {
      const count = await incrementClick(tenv, code);
      expect(count).toBe(1);
    } finally {
      await tenv.DB.prepare(
        `ALTER TABLE shortlink_click_daily_off RENAME TO shortlink_click_daily`
      ).run();
    }
  });

  test('table holds only code, day and clicks: no identity, no finer time', async () => {
    const tenv = env as unknown as TestEnv;
    const info = await tenv.DB.prepare(`PRAGMA table_info('shortlink_click_daily')`).all<{
      name: string;
    }>();
    expect((info.results ?? []).map((r) => r.name)).toEqual(['code', 'day', 'clicks']);
  });
});

describe('OSE-240: POST /api/v2/admin/events returns shortcode', () => {
  test('newly-created event response carries a base62 shortcode', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/admin/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
      body: JSON.stringify({ title: 'OSE-240 e2e create', brand_id: BRAND }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as CreateEventResponse;
    expect(body.ok).toBe(true);
    expect(body.id).toMatch(/^evt_/);
    expect(typeof body.shortcode).toBe('string');
    expect(isValidCodeShape(body.shortcode as string)).toBe(true);
  });
});

describe('OSE-240: GET /s/:code redirect + click counter', () => {
  test('valid code -> 302 redirect to /events/:id (public HTML page)', async () => {
    // Create an event so we have a code to resolve.
    const create = await SELF.fetch('https://t.test/api/v2/admin/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
      body: JSON.stringify({ title: 'OSE-240 redirect target', brand_id: BRAND }),
    });
    const created = (await create.json()) as CreateEventResponse;
    expect(created.shortcode).toBeTruthy();

    const res = await SELF.fetch(`https://t.test/s/${created.shortcode}`, {
      redirect: 'manual',
      headers: AS_PERSON,
    });
    expect(res.status).toBe(302);
    const location = res.headers.get('Location');
    // OSE-243a moved the redirect target from the JSON endpoint
    // (/api/v2/events/:id) to the HTML public page (/events/:id). The
    // recipient's browser now lands on a rendered event page, not raw JSON.
    expect(location).toContain(`/events/${created.id}`);
    expect(location).not.toContain('/api/v2/events/');
    // Cache-Control: no-store prevents intermediaries from masking click signals.
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  test('redirect increments the click counter exactly once per hit', async () => {
    const create = await SELF.fetch('https://t.test/api/v2/admin/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
      body: JSON.stringify({ title: 'OSE-240 counter test', brand_id: BRAND }),
    });
    const created = (await create.json()) as CreateEventResponse;
    const code = created.shortcode as string;

    // Three redirects → three increments
    for (let i = 0; i < 3; i++) {
      const res = await SELF.fetch(`https://t.test/s/${code}`, {
        redirect: 'manual',
        headers: AS_PERSON,
      });
      expect(res.status).toBe(302);
    }

    const tenv = env as unknown as TestEnv;
    const row = await tenv.DB.prepare(`SELECT clicks FROM shortlinks WHERE code = ?`)
      .bind(code)
      .first<{ clicks: number }>();
    expect(row?.clicks).toBe(3);
  });

  test('malformed code -> 404 (probing reveals nothing)', async () => {
    const res = await SELF.fetch('https://t.test/s/<<<malformed>>>', { redirect: 'manual' });
    expect(res.status).toBe(404);
  });

  test('unknown valid-shape code -> 404 (same 404 as malformed)', async () => {
    const res = await SELF.fetch('https://t.test/s/ZzZzZz', { redirect: 'manual' });
    expect(res.status).toBe(404);
  });
});

describe('OSE-240: anonymity-principle compliance', () => {
  test('shortlinks table schema has NO column that could carry per-attendee identity', async () => {
    const tenv = env as unknown as TestEnv;
    const info = await tenv.DB.prepare(`PRAGMA table_info('shortlinks')`).all<{ name: string }>();
    const cols = (info.results ?? []).map((r) => r.name);
    expect(cols).toEqual([
      'code',
      'event_id',
      'created_at',
      'clicks',
      'last_clicked_at',
      // Rb (migration 0073): admin-set ROUTING config — NOT per-attendee data.
      // target_url = the fixed external destination (https, validated at
      // creation); kind = destination category (public/donate/signup). Neither
      // can carry identity — the forbidden-PII check below still guards that.
      'target_url',
      'kind',
      // OSE-1357 p2 (0080): the code's place on the poster — an order, not a person.
      'poster_position',
    ]);

    // Sanity: every forbidden PII-bearing column name from the
    // pii-invariant gate MUST be absent from the new table.
    const forbidden = [
      'ip_address',
      'ip_addr',
      'client_ip',
      'remote_ip',
      'remote_addr',
      'x_forwarded_for',
      'cf_connecting_ip',
      'user_ip',
      'anonymous_id',
      'session_id',
      'cookie',
      'user_agent',
      'referer',
      'email',
      'email_hash',
    ];
    for (const f of forbidden) {
      expect(cols, `shortlinks has forbidden PII column '${f}'`).not.toContain(f);
    }
  });

  test('handlers/shortlink-resolve.ts source has zero per-attendee identity reads', () => {
    // Static-source check: the resolve handler MUST NOT read IP, anon_id,
    // session cookie, or Referer. If a future refactor adds any of those,
    // this gate fails before the change can land.
    const sources: Record<string, string> = JSON.parse(
      (env as unknown as TestEnv).TEST_SOURCE_FILES_JSON
    );
    const entry = Object.entries(sources).find(([p]) =>
      p.replace(/\\/g, '/').endsWith('src/handlers/shortlink-resolve.ts')
    );
    expect(entry, 'shortlink-resolve.ts source not in TEST_SOURCE_FILES_JSON').toBeDefined();
    const src = entry![1];

    const forbiddenReads = [
      /\bCf-Connecting-Ip\b/i,
      /\bX-Forwarded-For\b/i,
      /\brequest\.headers\.get\(['"]?[Cc]ookie['"]?\)/,
      /\bgetOrCreateAnonId\b/, // public anon_id helper
      /\bsetAnonCookie\b/,
      /\brequest\.headers\.get\(['"]?[Rr]eferer['"]?\)/,
    ];
    const violations: string[] = [];
    for (const pattern of forbiddenReads) {
      if (pattern.test(src)) violations.push(pattern.source);
    }
    expect(
      violations,
      `shortlink-resolve.ts reads per-attendee identity (violates OSE anonymity principle): ${violations.join(', ')}`
    ).toEqual([]);
  });
});

describe('link-preview robots open a short link but are not counted (owner 2026-10-10)', () => {
  const PINTEREST_APP =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [Pinterest/iOS]';
  const ROBOTS: Record<string, string | null> = {
    'iMessage preview':
      'Mozilla/5.0 (Macintosh) AppleWebKit/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0',
    'Slack unfurl': 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
    'WhatsApp and Signal preview': 'WhatsApp/2.23.20.0',
    'Discord embed': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
    'Pinterest robot': 'Pinterest/0.2 (+https://www.pinterest.com/bot.html)',
    Pinterestbot: 'Mozilla/5.0 (compatible; Pinterestbot/1.0; +http://www.pinterest.com/bot.html)',
    'no user agent at all': null,
  };

  async function newCode(title: string): Promise<string> {
    const create = await SELF.fetch('https://t.test/api/v2/admin/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
      body: JSON.stringify({ title, brand_id: BRAND }),
    });
    const created = (await create.json()) as CreateEventResponse;
    return created.shortcode as string;
  }
  async function clicksOf(code: string): Promise<number> {
    const row = await (env as unknown as TestEnv).DB.prepare(
      'SELECT clicks FROM shortlinks WHERE code = ?'
    )
      .bind(code)
      .first<{ clicks: number }>();
    return Number(row?.clicks) || 0;
  }
  const open = (code: string, ua: string | null) =>
    SELF.fetch(`https://t.test/s/${code}`, {
      redirect: 'manual',
      headers: ua === null ? {} : { 'User-Agent': ua },
    });

  // @born-red TL-076 | method: deliberate-fixture-break | date: 2026-10-10
  test('each robot gets the same redirect as a person, and adds no tap', async () => {
    const code = await newCode(`Robot taps ${Date.now()}`);
    const person = await open(code, PERSON_UA);
    expect(person.status).toBe(302);
    for (const [name, ua] of Object.entries(ROBOTS)) {
      const res = await open(code, ua);
      expect(res.status, name).toBe(302);
      expect(res.headers.get('Location'), name).toBe(person.headers.get('Location'));
    }
    expect(await clicksOf(code)).toBe(1);
  });

  test('a person in the Pinterest app is a person', async () => {
    expect(isLinkPreviewAgent(PINTEREST_APP)).toBe(false);
    const code = await newCode(`Pinterest app ${Date.now()}`);
    await open(code, PINTEREST_APP);
    expect(await clicksOf(code)).toBe(1);
  });

  test('every robot above is recognised by the shared rule (the one /e/ uses too)', () => {
    for (const [name, ua] of Object.entries(ROBOTS)) {
      expect(isLinkPreviewAgent(ua), name).toBe(true);
    }
    expect(isLinkPreviewAgent(PERSON_UA)).toBe(false);
  });
});
