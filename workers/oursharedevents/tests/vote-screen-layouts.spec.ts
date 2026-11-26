/**
 * The host's vote screen (OSE-2226) and the layouts route (OSE-2232).
 *
 * Rules held here, each named after the fault it was watched failing on:
 *   1. signed out, the vote screen answers like any admin page: no code, no
 *      page of its own [requireAdmin removed from the route];
 *   2. with a code in use it shows the code's QR and "Scan to vote", one h1,
 *      no count, and the token is still in no public answer (display-config)
 *      [token added to display-config];
 *   3. with no code it says so and makes none; with the switch off it shows
 *      no code [screen made the code / switch not read];
 *   4. the screen takes the event's vote-screen layout [layout not read];
 *   5. the layouts route reads every surface with its skins and .md files,
 *      saves a .md skin, refuses a bad one in words and audits the save
 *      [save not audited / bad file stored];
 *   6. the event's own settings write takes a layout and refuses a bad one
 *      [layouts left out of validateSettingsPatch];
 *   7. without the brand's skins add-on, the standard look still saves, any
 *      other look is refused in words (403), and a saved one shows as the
 *      standard skin [gate removed from the .md save / the settings write /
 *      the vote screen];
 *   8. only the platform turns an add-on on or off, and each change is
 *      audited [_platformOnly removed / audit removed].
 *
 * Placement: workers pool (route + D1).
 *
 * Tests 1-6 run with the add-on on (beforeEach); 7 and 8 take it away.
 *
 * @born-red OSE-2226, OSE-2232 | method: injected-fault, each removed after;
 * listed in the PR body | date: 2026-11-25
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { linkVenue } from './helpers/link-venue';
import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { route, type RouterEnv } from '../src/router';
import { skinLayout } from '../src/lib/layout-skins';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = env as unknown as TestEnv;
const routerEnv = env as unknown as RouterEnv;

const BRAND = 'brand-vscreen';
const OWNER = 'owner-vscreen@example.com';
const NIGHT = 'evt-vscreen-night';
const ORIGIN = 'https://ose.test';

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const now = () => Math.floor(Date.now() / 1000);
const ADMIN = {
  'Cf-Access-Jwt-Assertion': `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({
    email: OWNER,
    iat: now() - 10,
    exp: now() + 3600,
  })}.sig`,
  'Sec-Fetch-Site': 'same-origin',
};

const ON = { ...routerEnv, VOTING_ENABLED: 'on' } as RouterEnv;

async function call(
  method: string,
  path: string,
  opts: { body?: unknown; headers?: Record<string, string>; env?: RouterEnv } = {}
): Promise<Response> {
  const ctx = createExecutionContext();
  const headers: Record<string, string> = { ...(opts.headers ?? ADMIN) };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await route(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }),
    opts.env ?? ON,
    ctx
  );
  await waitOnExecutionContext(ctx);
  return res;
}

const screen = (id = NIGHT) => `/api/v2/admin/events/${id}/vote-screen`;
const layouts = (id = NIGHT) => `/api/v2/admin/events/${id}/layouts`;

async function applyMigrations(db: D1Database, statements: string): Promise<void> {
  for (const stmt of JSON.parse(statements) as string[]) {
    try {
      await db.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/duplicate column name|already exists|no such column/.test(msg)) continue;
      throw e;
    }
  }
}

const run = (sql: string, ...binds: unknown[]) =>
  tenv.DB.prepare(sql)
    .bind(...binds)
    .run();

beforeAll(async () => {
  await applyMigrations(tenv.DB, tenv.TEST_MIGRATION_STATEMENTS);
  await run(
    `INSERT OR IGNORE INTO admin_brand_memberships (email, brand_id, role) VALUES (?, ?, 'brand_owner')`,
    OWNER,
    BRAND
  );
});

const KEY = { Authorization: 'Bearer test-admin-key-e2e-2026' };
const grant = () =>
  run(
    `INSERT OR IGNORE INTO brand_addons (brand_id, addon, granted_at, granted_by)
     VALUES (?, 'skins', datetime('now'), 'platform')`,
    BRAND
  );

beforeEach(async () => {
  await grant();
  await run(`DELETE FROM poster_deployments WHERE event_id = ?`, NIGHT);
  await run(`DELETE FROM vote_sets WHERE event_id = ?`, NIGHT);
  await run(`DELETE FROM events WHERE id = ?`, NIGHT);
  await run(
    `INSERT INTO events (id, brand_id, title, slug, status, is_published, location, start_date, end_date, timezone,
                         starts_at, event_type_id, created_at, updated_at)
     VALUES (?, ?, 'Vote screen night', ?, 'active', 1, 'Eagles Hall', '2099-06-01', '2099-06-01',
             'America/Chicago', '2099-06-01T19:00:00-06:00', 'etr-rec-bocce', datetime('now'), datetime('now'))`,
    NIGHT,
    BRAND,
    NIGHT
  );
  await linkVenue(tenv.DB, NIGHT);
});

async function makeCode(): Promise<string> {
  const r = await call('POST', `/api/v2/admin/events/${NIGHT}/votables/code`, { body: {} });
  expect([200, 201]).toContain(r.status);
  const j = (await r.json()) as { code: { url: string } };
  return new URL(j.code.url).pathname.replace(/^\/q\//, '');
}

describe('OSE-2226 | the host vote screen', () => {
  test('1. signed out, it answers like any admin page', async () => {
    await makeCode();
    const json = await call('GET', screen(), { headers: {} });
    expect(json.status).toBe(401);
    const page = await call('GET', screen(), { headers: { Accept: 'text/html' } });
    const text = await page.text();
    expect(text).not.toContain('vote-screen-qr');
    expect(text).not.toContain('qrt_');
  });

  test('2. shows the QR and one line; the token stays out of public answers', async () => {
    const token = await makeCode();
    const res = await call('GET', screen());
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('X-Robots-Tag')).toContain('noindex');
    const html = await res.text();
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toContain('>Scan to vote</h1>');
    expect(html).toMatch(
      /<img src="data:image\/png;base64,[^"]+" alt="QR code to vote in this room"/
    );
    expect(html).not.toMatch(/\b\d+ votes?\b/i);
    expect(html).not.toContain('Vote screen night');
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);

    const pub = await call('GET', `/api/v2/events/${NIGHT}/display-config`, { headers: {} });
    expect(pub.status).toBe(200);
    expect(await pub.text()).not.toContain(token);
  });

  test('3. no code: says so and makes none; switch off: shows no code', async () => {
    const none = await call('GET', screen());
    expect(none.status).toBe(200);
    expect(await none.text()).toContain('data-testid="vote-screen-none"');
    const made = await tenv.DB.prepare(
      `SELECT COUNT(*) AS n FROM poster_deployments WHERE event_id = ? AND is_vote_code = 1`
    )
      .bind(NIGHT)
      .first<{ n: number }>();
    expect(made?.n).toBe(0);

    await makeCode();
    const off = await call('GET', screen(), {
      env: { ...routerEnv, VOTING_ENABLED: 'off' } as RouterEnv,
    });
    const text = await off.text();
    expect(text).toContain('data-testid="vote-screen-off"');
    expect(text).not.toContain('vote-screen-qr');
  });

  test('4. takes the event vote-screen layout', async () => {
    await makeCode();
    const before = await (await call('GET', screen())).text();
    expect(before).toContain('"skin":"standard"');
    await run(
      `UPDATE events SET settings_json = ? WHERE id = ?`,
      JSON.stringify({ layouts: { vote_screen: skinLayout('vote_screen', 'side_by_side') } }),
      NIGHT
    );
    const after = await (await call('GET', screen())).text();
    expect(after).toContain('"skin":"side_by_side","columns":2,"order":["code","line"]');
    expect(after).toContain('window.OSE_applyLayout');
  });
});

describe('OSE-2232 | the layouts route and the settings write', () => {
  test('5. reads, saves a .md skin, refuses a bad one, audits the save', async () => {
    const read = await call('GET', layouts());
    expect(read.status).toBe(200);
    const body = (await read.json()) as Record<string, any>;
    expect(body.layouts.report.skin).toBe('standard');
    expect(body.layouts.vote_screen.skin).toBe('standard');
    expect(body.skins.report.map((k: { name: string }) => k.name)).toEqual([
      'standard',
      'map_first',
      'sponsors_first',
      'side_by_side',
    ]);
    expect(body.markdown.report).toMatch(/^---\nsurface: report\nskin: standard\n/);

    const md = body.markdown.report
      .replace('skin: standard', 'skin: custom')
      .replace('order: stats, map,', 'order: map, stats,');
    const saved = await call('PUT', layouts(), { body: { markdown: md } });
    expect(saved.status).toBe(200);
    const after = (await saved.json()) as Record<string, any>;
    expect(after.saved).toEqual(['report']);
    expect(after.layouts.report.order.slice(0, 2)).toEqual(['map', 'stats']);
    const stored = await tenv.DB.prepare(`SELECT settings_json FROM events WHERE id = ?`)
      .bind(NIGHT)
      .first<{ settings_json: string }>();
    expect(JSON.parse(stored!.settings_json).layouts.report.skin).toBe('custom');

    const bad = await call('PUT', layouts(), {
      body: { markdown: '---\nsurface: report\nskin: standard\ncolumns: 1\norder: map\n---' },
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toMatch(
      /order must list every required part. Missing: stats, sponsors/
    );
    const extra = await call('PUT', layouts(), { body: { markdown: md, layout: {} } });
    expect(extra.status).toBe(400);
    const still = await tenv.DB.prepare(`SELECT settings_json FROM events WHERE id = ?`)
      .bind(NIGHT)
      .first<{ settings_json: string }>();
    expect(JSON.parse(still!.settings_json).layouts.report.order[0]).toBe('map');

    const audit = await tenv.DB.prepare(
      `SELECT action, outcome FROM admin_audit_log WHERE resource_id = ? AND action = 'LAYOUT_SAVE' ORDER BY rowid`
    )
      .bind(NIGHT)
      .all<{ action: string; outcome: string }>();
    expect(audit.results.map((r) => r.outcome)).toEqual(['success', 'denied', 'denied']);
  });

  test('6. the event settings write takes a layout and refuses a bad one', async () => {
    const good = skinLayout('report', 'sponsors_first');
    const ok = await call('PUT', `/api/v2/admin/events/${NIGHT}`, {
      body: { settings: { layouts: { report: good } } },
    });
    expect(ok.status).toBe(200);
    const read = (await (await call('GET', layouts())).json()) as Record<string, any>;
    expect(read.layouts.report).toEqual(good);

    const bad = await call('PUT', `/api/v2/admin/events/${NIGHT}`, {
      body: { settings: { layouts: { report: { ...good, wide: ['person'] } } } },
    });
    expect(bad.status).toBe(400);
  });
});

describe('OSE-2232 | the skins add-on: standard is free, any other look is sold', () => {
  const WORDS = 'Custom looks are an add-on. Ask us to turn them on.';
  const STANDARD_MD =
    '---\nsurface: vote_screen\nskin: standard\ncolumns: 1\norder: line, code\nwide:\n---\n';
  const SIDE_MD =
    '---\nsurface: vote_screen\nskin: side_by_side\ncolumns: 2\norder: code, line\nwide:\n---\n';

  test('7. without the add-on: standard saves, others are refused, a saved one shows standard', async () => {
    await run(`DELETE FROM brand_addons WHERE brand_id = ?`, BRAND);
    const read = (await (await call('GET', layouts())).json()) as { entitled: boolean };
    expect(read.entitled).toBe(false);

    const std = await call('PUT', layouts(), { body: { markdown: STANDARD_MD } });
    expect(std.status).toBe(200);

    const side = await call('PUT', layouts(), { body: { markdown: SIDE_MD } });
    expect(side.status).toBe(403);
    expect(await side.json()).toMatchObject({ code: 'ADDON_REQUIRED', error: WORDS });

    const viaSettings = await call('PUT', `/api/v2/admin/events/${NIGHT}`, {
      body: { settings: { layouts: { report: skinLayout('report', 'map_first') } } },
    });
    expect(viaSettings.status).toBe(403);
    expect(await viaSettings.json()).toMatchObject({ code: 'ADDON_REQUIRED', error: WORDS });
    const stored = await tenv.DB.prepare(`SELECT settings_json FROM events WHERE id = ?`)
      .bind(NIGHT)
      .first<{ settings_json: string | null }>();
    expect(stored?.settings_json ?? '').not.toContain('map_first');

    // A look saved while the add-on was on stays saved, and shows as standard.
    await run(
      `UPDATE events SET settings_json = ? WHERE id = ?`,
      JSON.stringify({ layouts: { vote_screen: skinLayout('vote_screen', 'side_by_side') } }),
      NIGHT
    );
    await makeCode();
    const page = await (await call('GET', screen())).text();
    expect(page).toContain('"skin":"standard"');
    expect(page).not.toContain('"skin":"side_by_side"');
    const kept = (await (await call('GET', layouts())).json()) as Record<string, any>;
    expect(kept.layouts.vote_screen.skin).toBe('side_by_side');
  });

  test('8. only the platform turns it on or off, and each change is audited', async () => {
    await run(`DELETE FROM brand_addons WHERE brand_id = ?`, BRAND);
    const addons = '/api/v2/admin/addons';
    const on = { brand_id: BRAND, addon: 'skins', on: true };

    const self = await call('PUT', addons, { body: on });
    expect(self.status).toBe(404);
    expect(((await (await call('GET', layouts())).json()) as { entitled: boolean }).entitled).toBe(
      false
    );

    const bad = await call('PUT', addons, { headers: KEY, body: { ...on, addon: 'colors' } });
    expect(bad.status).toBe(400);

    const granted = await call('PUT', addons, { headers: KEY, body: on });
    expect(granted.status).toBe(200);
    expect(await granted.json()).toMatchObject({ brand_id: BRAND, addons: { skins: true } });
    expect(((await (await call('GET', layouts())).json()) as { entitled: boolean }).entitled).toBe(
      true
    );
    expect((await call('PUT', layouts(), { body: { markdown: SIDE_MD } })).status).toBe(200);

    const off = await call('PUT', addons, { headers: KEY, body: { ...on, on: false } });
    expect(await off.json()).toMatchObject({ addons: { skins: false } });
    const page = await (await call('GET', screen())).text();
    expect(page).not.toContain('"skin":"side_by_side"');

    const audit = await tenv.DB.prepare(
      `SELECT outcome FROM admin_audit_log WHERE action = 'ADDON_SET' ORDER BY rowid`
    ).all<{ outcome: string }>();
    expect(audit.results.map((r) => r.outcome).slice(-4)).toEqual([
      'denied',
      'denied',
      'success',
      'success',
    ]);
  });
});
