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
 *      [layouts left out of validateSettingsPatch].
 *
 * Placement: workers pool (route + D1).
 *
 * @born-red OSE-2226, OSE-2232 | method: injected-fault, each removed after;
 * listed in the PR body | date: 2026-11-25
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
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

beforeEach(async () => {
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
    expect(before).toContain('"skin":"words_first"');
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
    expect(body.layouts.vote_screen.skin).toBe('words_first');
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
    expect(after.surface).toBe('report');
    expect(after.layouts.report.order.slice(0, 2)).toEqual(['map', 'stats']);
    const stored = await tenv.DB.prepare(`SELECT settings_json FROM events WHERE id = ?`)
      .bind(NIGHT)
      .first<{ settings_json: string }>();
    expect(JSON.parse(stored!.settings_json).layouts.report.skin).toBe('custom');

    const bad = await call('PUT', layouts(), {
      body: { markdown: '---\nsurface: report\nskin: standard\ncolumns: 1\norder: map\n---' },
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toMatch(/order must list each of/);
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
