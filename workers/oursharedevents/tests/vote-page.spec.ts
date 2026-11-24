/**
 * The voter page: GET /events/:id/vote (OSE-2129, S4b of OSE-1193; OSE ADR-040
 * decisions 5, 6 and 9). Workers pool, real D1 (migrations to 0114), the real
 * router.
 *
 * Each case names, in brackets, the fault it was seen failing on first. The
 * page's behaviour in a browser (the fragment leaving the address bar, no
 * storage, the buttons) is in tests/e2e/2-pages/voter-page.component.spec.ts.
 *
 * @born-red OSE-2129 | method: injected-fault, each removed after: the route
 *   dropped from the router (every page case red), `frame-ancestors 'none'`
 *   left as 'self' (headers case red), `is_final = 1` dropped from the result
 *   read (open-set case red), the result shown with the switch off (switch case
 *   red), the house rule list cut to nine (house-rule case red) | date: 2026-11-19
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { route, type RouterEnv } from '../src/router';
import { VOTING_ON } from '../src/lib/voting-switch';
import { TOO_CLOSE_WORDS } from '../src/lib/vote-results';
import { HOUSE_RULE_RISKS, SCAN_AGAIN_WORDS, VOTE_PAGE_CSS } from '../src/lib/vote-page-render';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = env as unknown as TestEnv;
const routerEnv = { ...(env as unknown as RouterEnv), VOTING_ENABLED: VOTING_ON } as RouterEnv;

const ORIGIN = 'https://ose.test';
const BRAND = 'brand-vpg-a';
const OWNER = 'owner-vpg-a@example.com';
const N1 = 'evt-vpg-n1';
const DRAFT = 'evt-vpg-draft';
const TEAM_1 = 'grp_00000021';

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const nowS = Math.floor(Date.now() / 1000);
const ADMIN = {
  'Cf-Access-Jwt-Assertion': `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({
    email: OWNER,
    iat: nowS - 10,
    exp: nowS + 3600,
  })}.sig`,
  'Sec-Fetch-Site': 'same-origin',
};

type Json = Record<string, any>;
async function routed(req: Request, over: Partial<RouterEnv> = {}) {
  const ctx = createExecutionContext();
  const res = await route(req, { ...routerEnv, ...over } as RouterEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
async function admin(method: string, path: string, body?: unknown) {
  const res = await routed(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers: body === undefined ? ADMIN : { ...ADMIN, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
}
const vp = (eventId: string, tail = '') => `/api/v2/admin/events/${eventId}/votables${tail}`;

async function page(eventId: string, over: Partial<RouterEnv> = {}, method = 'GET') {
  const res = await routed(new Request(`${ORIGIN}/events/${eventId}/vote`, { method }), over);
  return { status: res.status, headers: res.headers, text: await res.text() };
}

const run = (sql: string, ...binds: unknown[]) =>
  tenv.DB.prepare(sql)
    .bind(...binds)
    .run();
const one = (sql: string, ...binds: unknown[]) =>
  tenv.DB.prepare(sql)
    .bind(...binds)
    .first<Json>();

let markerSeq = 0x2129000;
const marker = () => (++markerSeq).toString(16).padStart(64, '0');

async function seedEvent(id: string, status: string) {
  await run(
    `INSERT INTO events (id, brand_id, title, slug, status, location, start_date, end_date, timezone)
     VALUES (?, ?, ?, ?, ?, 'Eagles Hall', '2099-06-01', '2099-06-01', 'America/Chicago')`,
    id,
    BRAND,
    `Fist of Five ${id}`,
    id,
    status
  );
}

async function openNight(
  eventId: string,
  labels: string[],
  playedBy: 'object' | 'team' = 'object'
): Promise<string[]> {
  expect((await admin('POST', vp(eventId), { played_by: playedBy })).status).toBe(201);
  const ids: string[] = [];
  for (const label of labels) {
    const res = await admin('POST', vp(eventId, '/objects'), {
      kind: 'song',
      label,
      ...(playedBy === 'team' ? { group_id: TEAM_1 } : {}),
    });
    ids.push(res.json.object.id);
  }
  expect((await admin('POST', vp(eventId, '/open'))).status).toBe(200);
  for (const id of ids)
    expect((await admin('POST', vp(eventId, `/objects/${id}/open`), {})).status).toBe(200);
  return ids;
}

const setIdOf = async (eventId: string) =>
  String((await one(`SELECT id FROM vote_sets WHERE event_id = ?`, eventId))!.id);

/** Twenty voters, so any floor (10 to 14) is met. */
async function voters(eventId: string) {
  const id = await setIdOf(eventId);
  for (let i = 0; i < 20; i++)
    await run(`INSERT INTO vote_participants (set_id, marker) VALUES (?, ?)`, id, marker());
}

async function closeAndCompute(eventId: string) {
  expect((await admin('POST', vp(eventId, '/close'))).status).toBe(200);
  expect((await admin('POST', vp(eventId, '/finalize'))).status).toBe(200);
}

beforeAll(async () => {
  for (const stmt of JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/duplicate column name|already exists|no such column/.test(msg)) continue;
      throw e;
    }
  }
  await run(
    `INSERT OR IGNORE INTO admin_brand_memberships (email, brand_id, role) VALUES (?, ?, 'brand_owner')`,
    OWNER,
    BRAND
  );
});

beforeEach(async () => {
  const like = 'evt-vpg-%';
  for (const sql of [
    `DELETE FROM vote_receipts WHERE object_id IN (SELECT id FROM votable_objects WHERE event_id LIKE ?)`,
    `DELETE FROM vote_tallies WHERE object_id IN (SELECT id FROM votable_objects WHERE event_id LIKE ?)`,
    `DELETE FROM vote_participants WHERE set_id IN (SELECT id FROM vote_sets WHERE event_id LIKE ?)`,
    `DELETE FROM vote_team_markers WHERE set_id IN (SELECT id FROM vote_sets WHERE event_id LIKE ?)`,
    `DELETE FROM votable_objects WHERE event_id LIKE ?`,
    `DELETE FROM vote_sets WHERE event_id LIKE ?`,
    `DELETE FROM admin_audit_log WHERE resource_id LIKE ?`,
    `DELETE FROM events WHERE id LIKE ?`,
  ])
    await run(sql, like);
  await seedEvent(N1, 'active');
  await seedEvent(DRAFT, 'draft');
});

const h1Count = (html: string) => (html.match(/<h1[\s>]/g) ?? []).length;
const between = (html: string, from: string, to: string) => {
  const start = html.indexOf(from);
  return start < 0 ? '' : html.slice(start, html.indexOf(to, start));
};

describe('the page opens for a live event, and only then', () => {
  test('a live event answers 200 with one h1 and the title and date above it [route dropped]', async () => {
    const res = await page(N1);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(h1Count(res.text)).toBe(1);
    const title = res.text.indexOf('data-testid="vote-event-title"');
    const h1 = res.text.indexOf('<h1');
    expect(title).toBeGreaterThan(0);
    expect(title).toBeLessThan(h1);
    expect(res.text).toContain(`Fist of Five ${N1}`);
  });

  test('a draft event, an unknown event and a malformed id are one 404', async () => {
    const draft = await page(DRAFT);
    const unknown = await page('evt-vpg-none');
    const bad = await page('bad%20id%3C');
    expect([draft.status, unknown.status, bad.status]).toEqual([404, 404, 404]);
    expect(draft.text).toBe(unknown.text);
    expect(unknown.text).toBe(bad.text);
  });

  test('only GET opens the page; a POST to it is not a vote', async () => {
    const res = await page(N1, {}, 'POST');
    expect(res.status).not.toBe(200);
  });

  test('the address /events/<id>/vote is not read as the event page name', async () => {
    const res = await page(N1);
    expect(res.text).toContain('data-testid="vote-page"');
    expect(res.text).not.toContain(
      'rel="canonical" href="https://ose.test/events/evt-vpg-n1/vote"'
    );
  });
});

describe('headers: never stored, no referrer, never framed, the script talks only to this site', () => {
  test('no-store, no-referrer, frame-ancestors none, connect-src self, a nonce [frame-ancestors self]', async () => {
    const res = await page(N1);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("frame-ancestors 'self'");
    expect(csp).toContain("connect-src 'self'");
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    const scripts = res.text.match(/<script\b[^>]*>/gi) ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    for (const s of scripts) expect(s).toContain(`nonce="${nonce}"`);
  });

  test('no cookie is set, with or without one sent', async () => {
    const plain = await page(N1);
    expect(plain.headers.get('set-cookie')).toBeNull();
    const res = await routed(
      new Request(`${ORIGIN}/events/${N1}/vote`, {
        headers: { Cookie: 'ose_anon=anon_11111111-aaaa-bbbb-cccc-000000000001' },
      })
    );
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  test('the page asks not to be indexed', async () => {
    const res = await page(N1);
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    expect(res.text).toContain('<meta name="robots" content="noindex" />');
  });
});

describe('what the page says', () => {
  test('anonymous, one vote on each, and the house rule with its ten risks [list cut to nine]', async () => {
    const res = await page(N1);
    expect(res.text).toContain('Your vote is anonymous.');
    expect(res.text).toContain('You get one vote on each song, stall, entry or event.');
    expect(res.text).toContain("The house rule: don't be a jag-off");
    expect(HOUSE_RULE_RISKS.length).toBe(10);
    const risks = between(res.text, 'data-testid="vote-house-rule-risks"', '</ol>');
    expect((risks.match(/<li[\s>]/g) ?? []).length).toBe(10);
  });

  test('the scan-again words are on the page for the script to show', async () => {
    const res = await page(N1);
    expect(res.text).toContain(SCAN_AGAIN_WORDS);
    expect(res.text).toMatch(/data-testid="vote-scan-again" hidden/);
  });

  test('no count and no "held" anywhere, before or after a result', async () => {
    const [a] = await openNight(N1, ['Bring It On Home']);
    const open = await page(N1);
    await run(`UPDATE vote_tallies SET up_count = 31 WHERE object_id = ?`, a);
    await voters(N1);
    await closeAndCompute(N1);
    const final = await page(N1);
    for (const res of [open, final]) {
      const main = between(res.text, '<main', '</main>');
      expect(main).not.toMatch(/\bheld\b/i);
      expect(main).not.toMatch(/\b(votes?|voters?)\s*:\s*\d/i);
      expect(main).not.toContain('31');
      expect(main).not.toContain('20 ');
    }
  });

  test('every button the page could draw is at least 48 px tall in its own CSS', async () => {
    const res = await page(N1);
    expect(res.text).toMatch(/\.vp-btn\{min-height:48px/);
  });

  test('the page CSS is layout only, inside the 400-character inline budget, with no colour', () => {
    expect(VOTE_PAGE_CSS.length).toBeLessThanOrEqual(400);
    expect(VOTE_PAGE_CSS).not.toMatch(/#[0-9a-f]{3,8}\b|color|background|rgb|hsl/i);
  });
});

describe('the result, once the set is final', () => {
  test('nothing while the set is open or closed [is_final dropped from the read]', async () => {
    await openNight(N1, ['One', 'Two']);
    expect((await page(N1)).text).not.toContain('data-testid="vote-result"');
    expect((await admin('POST', vp(N1, '/close'))).status).toBe(200);
    // Closed but not final: an outcome written by hand still does not show.
    await run(`UPDATE vote_sets SET outcome = 'too_close' WHERE event_id = ?`, N1);
    expect((await page(N1)).text).not.toContain('data-testid="vote-result"');
  });

  test('a night with no clear winner reads the too-close words', async () => {
    await openNight(N1, ['One', 'Two']);
    await closeAndCompute(N1);
    const res = await page(N1);
    expect(res.text).toContain('data-outcome="too_close"');
    expect(res.text).toContain(TOO_CLOSE_WORDS);
  });

  test('a won night names the winning song, and nothing about the runner-up', async () => {
    const [a, b] = await openNight(N1, ['Bring It On Home', 'Runner Up Song']);
    await run(`UPDATE vote_tallies SET up_count = 40 WHERE object_id = ?`, a);
    await run(`UPDATE vote_tallies SET up_count = 2 WHERE object_id = ?`, b);
    await voters(N1);
    await closeAndCompute(N1);
    const res = await page(N1);
    const result = between(res.text, 'data-testid="vote-result"', '</section>');
    expect(result).toContain("Tonight's winner");
    expect(result).toContain('Bring It On Home');
    expect(result).not.toContain('Runner Up Song');
  });

  test("a won team night lists the winning team's songs", async () => {
    await openNight(N1, ['Team Song A', 'Team Song B'], 'team');
    const id = await setIdOf(N1);
    for (let i = 0; i < 20; i++)
      await run(
        `INSERT INTO vote_team_markers (set_id, team_id, marker) VALUES (?, ?, ?)`,
        id,
        TEAM_1,
        marker()
      );
    await voters(N1);
    await closeAndCompute(N1);
    const res = await page(N1);
    const result = between(res.text, 'data-testid="vote-result"', '</section>');
    expect(result).toContain("Tonight's winning team played");
    expect(result).toContain('Team Song A');
    expect(result).toContain('Team Song B');
  });

  test('a void set shows nothing', async () => {
    await openNight(N1, ['One']);
    await closeAndCompute(N1);
    await run(
      `UPDATE vote_sets SET is_void = 1, void_reason = 'pepper_epoch' WHERE event_id = ?`,
      N1
    );
    expect((await page(N1)).text).not.toContain('data-testid="vote-result"');
  });
});

describe('the kill switch', () => {
  test('off, the page says voting is not open and shows no result [result shown with the switch off]', async () => {
    await openNight(N1, ['One', 'Two']);
    await closeAndCompute(N1);
    const res = await page(N1, { VOTING_ENABLED: 'off' } as Partial<RouterEnv>);
    expect(res.status).toBe(200);
    expect(res.text).toContain('data-voting="off"');
    expect(res.text).toContain('Voting is not open right now.');
    expect(res.text).not.toContain('data-testid="vote-result"');
  });

  test('on, the page is marked for the script to start', async () => {
    const res = await page(N1);
    expect(res.text).toContain('data-voting="on"');
    expect(res.text).not.toContain('data-testid="vote-off"');
  });
});
