/**
 * OSE-1561: inside the platform's public brand (`root`), the person who created a
 * row is the boundary (OSE ADR-022, decision 2a; owner decisions 2026-11-18).
 *
 * "No brand" is stored as `root`, so every organizer without a brand of their own
 * is a member of the same brand. The brand wall (OSE-1080, tests/brand-matrix.spec.ts)
 * cannot keep them apart. This file runs the same route list as that matrix, with
 * PEOPLE in place of brands: each person has a whole tree in `root` (events, a
 * sponsor, a placement, a campaign, a poster deployment, a booth, a vote set).
 *
 * The rule, as decided:
 *   organizer, staff, sponsor_manager, a member with no recorded role
 *                    their own rows only: list and by id, read and write. A row
 *                    with no creator matches nobody. Not-yours answers 404, the
 *                    same as does-not-exist.
 *   brand_owner      event rows, sponsors and campaigns as before; never another
 *                    person's form data (the five forms reads and the export).
 *   a brand of its own   unchanged: the brand is still the boundary.
 *   key actor with ADMIN_SCOPE_ALL   unchanged.
 *
 * Workers pool, mock layer. It proves the wall in the Worker's own router. It does
 * not prove staging: the Bruno folder for this story does not run until staging
 * has two organizer identities.
 *
 * NOTE. FORMS_DB has no tables in this pool, so a forms read that gets past the
 * wall answers 503. "Not 404" is therefore the positive control for forms.
 */

import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, test } from 'vitest';
import {
  UNKNOWN_ID,
  applyMigrations,
  callAs,
  personFx,
  routerEnv,
  seedBrandTree,
  snapshotFixture,
  type BrandFx,
  type CallerKind,
} from './helpers/brand-matrix';
import {
  MATRIX_ROUTES,
  idOf,
  type MatrixRoute,
  type ObjectRoute,
} from './helpers/brand-matrix-routes';

// ── people and their trees ───────────────────────────────────────────────────

const PUBLIC_BRAND = 'root';
const OWN_BRAND = 'own-brand-1561';

/** Two organizers in `root`, each with a tree they created. */
const ORG_A = personFx('orga');
const ORG_B = personFx('orgb');
/** A tree in `root` that nobody created (rows from before the creator was recorded). */
const NOBODY = personFx('orgnone');
/** A tree in a brand of its own, created by someone who is not the caller. */
const IN_OWN_BRAND = personFx('ownbrand', OWN_BRAND);

const ROOT_OWNER = 'root-owner-1561@example.com';
const ROOT_STAFF = 'root-staff-1561@example.com';
const ROOT_SPONSOR_MANAGER = 'root-sponsor-manager-1561@example.com';
/** In `root` through the env map only, so no role is recorded for them. */
const ROOT_NO_ROLE = 'root-no-role-1561@example.com';
/** `organizer` in `root` and `organizer` in a brand of its own. */
const TWO_BRANDS = 'two-brands-1561@example.com';

const as = (email: string): CallerKind => ({
  kind: 'owner',
  brand: { ...ORG_A, ownerEmail: email },
});
const A = as(ORG_A.ownerEmail);
const B = as(ORG_B.ownerEmail);

async function grant(email: string, brandId: string, role: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO admin_brand_memberships (email, brand_id, role) VALUES (?, ?, ?)`
  )
    .bind(email, brandId, role)
    .run();
}

beforeAll(async () => {
  await applyMigrations();
  await seedBrandTree(ORG_A);
  await seedBrandTree(ORG_B);
  await seedBrandTree(NOBODY, null);
  await seedBrandTree(IN_OWN_BRAND, 'someone-else-1561@example.com');

  await grant(ORG_A.ownerEmail, PUBLIC_BRAND, 'organizer');
  await grant(ORG_B.ownerEmail, PUBLIC_BRAND, 'organizer');
  await grant(ROOT_OWNER, PUBLIC_BRAND, 'brand_owner');
  await grant(ROOT_STAFF, PUBLIC_BRAND, 'staff');
  await grant(ROOT_SPONSOR_MANAGER, PUBLIC_BRAND, 'sponsor_manager');
  await grant(TWO_BRANDS, PUBLIC_BRAND, 'organizer');
  await grant(TWO_BRANDS, OWN_BRAND, 'organizer');
  (routerEnv as { ADMIN_BRAND_MEMBERSHIP?: string }).ADMIN_BRAND_MEMBERSHIP = JSON.stringify({
    [ROOT_NO_ROLE]: [PUBLIC_BRAND],
  });
});

// ── helpers ──────────────────────────────────────────────────────────────────

const objectRoutes = MATRIX_ROUTES.filter((r): r is ObjectRoute => r.shape === 'object');
const label = (r: MatrixRoute) => `${r.method} ${r.pattern}${r.variant ? ` (${r.variant})` : ''}`;
const isFormsData = (r: ObjectRoute) => r.pattern.includes('/forms/');
const reachedHandler = (status: number): boolean => ![401, 403, 404].includes(status);

function normalise(text: string, ...ids: string[]): string {
  let out = text;
  for (const id of ids) out = out.split(id).join('<id>');
  return out
    .replace(/"requestId":"[^"]*"/g, '"requestId":"<r>"')
    .replace(/"timestamp":"[^"]*"/g, '"timestamp":"<t>"');
}

/** The same call against `target`'s object: 404, nothing of theirs in the body, nothing written. */
async function expectWalled(caller: CallerKind, r: ObjectRoute, target: BrandFx): Promise<void> {
  const before = r.mutates ? await snapshotFixture() : null;
  const id = idOf(target, r.objectOf);
  const res = await callAs(caller, r.method, r.path(id), r.body?.(target));
  const text = await res.text();
  expect(res.status, `${label(r)} leaked: ${res.status} ${text.slice(0, 200)}`).toBe(404);
  expect(normalise(text, id), 'the 404 names something of theirs').not.toContain(target.marker);
  if (before !== null)
    expect(await snapshotFixture(), 'a refused write changed a row').toBe(before);
}

// ── by id: one person against another person's rows ──────────────────────────

describe('OSE-1561 by id: organizer A against organizer B, both in root', () => {
  for (const r of objectRoutes) {
    test(`${label(r)} | organizer A -> organizer B's row is 404`, () => expectWalled(A, r, ORG_B));

    test(`${label(r)} | organizer A -> a row nobody created is 404`, () =>
      expectWalled(A, r, NOBODY));

    // Dr of Security: no way to tell "someone else's" from "does not exist".
    test(`${label(r)} | not-yours is indistinguishable from does-not-exist`, async () => {
      const theirs = idOf(ORG_B, r.objectOf);
      const cross = await callAs(A, r.method, r.path(theirs), r.body?.(ORG_B));
      const unknown = await callAs(A, r.method, r.path(UNKNOWN_ID), r.body?.(ORG_B));
      expect(cross.status).toBe(unknown.status);
      // A sub-id in the path follows the same naming rule, so strip both stems.
      const stem = (id: string) => id.replace(/-(active|sponsor|campaign|pd)$/, '');
      const clean = (t: string, id: string) =>
        normalise(t, id, stem(id).replace(/^spl_/, ''), 'bm-orgb');
      expect(clean(await cross.text(), theirs)).toBe(clean(await unknown.text(), UNKNOWN_ID));
    });

    if (!r.mutates) {
      // Positive control: a cell that passes because the route is dead proves nothing.
      test(`${label(r)} | organizer B reaches their OWN row`, async () => {
        const res = await callAs(B, r.method, r.path(idOf(ORG_B, r.objectOf)));
        const ok = r.ownOk ? r.ownOk(res.status) : reachedHandler(res.status);
        expect(ok, `${label(r)} own: ${res.status}`).toBe(true);
      });
    }
  }
});

describe('OSE-1561 by id: every role but brand owner is held to its own rows', () => {
  const held: Array<[string, string]> = [
    ['staff', ROOT_STAFF],
    ['sponsor_manager', ROOT_SPONSOR_MANAGER],
    ['a member with no recorded role (env map)', ROOT_NO_ROLE],
    ['an organizer who also has a brand of their own', TWO_BRANDS],
  ];
  for (const [who, email] of held) {
    for (const r of objectRoutes) {
      test(`${label(r)} | ${who} -> organizer B's row is 404`, () =>
        expectWalled(as(email), r, ORG_B));
    }
  }
});

// ── the brand owner of root ──────────────────────────────────────────────────

describe("OSE-1561 the root brand owner: event rows, never another person's form data", () => {
  const owner = as(ROOT_OWNER);
  for (const r of objectRoutes.filter(isFormsData)) {
    for (const target of [ORG_B, NOBODY]) {
      test(`${label(r)} ${r.path('x').split('/x')[1]} | brand owner -> ${target.key} is 404`, () =>
        expectWalled(owner, r, target));
    }
  }
  for (const kind of ['surveys', 'checkin-count', 'email-signups']) {
    test(`GET forms/${kind} | brand owner -> organizer B is 404`, async () => {
      const res = await callAs(
        owner,
        'GET',
        `/api/v2/admin/events/${ORG_B.activeEventId}/forms/${kind}`
      );
      expect(res.status).toBe(404);
    });
    test(`GET forms/${kind} | organizer A -> organizer B is 404`, async () => {
      const res = await callAs(
        A,
        'GET',
        `/api/v2/admin/events/${ORG_B.activeEventId}/forms/${kind}`
      );
      expect(res.status).toBe(404);
    });
    test(`GET forms/${kind} | organizer B reaches their OWN event's`, async () => {
      const res = await callAs(
        B,
        'GET',
        `/api/v2/admin/events/${ORG_B.activeEventId}/forms/${kind}`
      );
      expect(res.status).not.toBe(404);
    });
  }

  for (const r of objectRoutes.filter((x) => !x.mutates && !isFormsData(x))) {
    test(`${label(r)} | brand owner still reaches organizer B's row (support)`, async () => {
      const res = await callAs(owner, r.method, r.path(idOf(ORG_B, r.objectOf)));
      const ok = r.ownOk ? r.ownOk(res.status) : reachedHandler(res.status);
      expect(ok, `${label(r)} brand owner: ${res.status}`).toBe(true);
    });
  }

  test("the brand owner lists every person's events, sponsors and campaigns in root", async () => {
    for (const path of [
      '/api/v2/admin/events?limit=100',
      '/api/v2/admin/sponsors',
      '/api/v2/admin/campaigns',
    ]) {
      const text = await (await callAs(owner, 'GET', path)).text();
      for (const who of [ORG_A, ORG_B, NOBODY]) {
        expect(text, `${path}: ${who.key} missing for the brand owner`).toContain(who.marker);
      }
    }
  });
});

// ── a brand of its own is unchanged ──────────────────────────────────────────

describe('OSE-1561 in a brand of its own the brand is still the boundary', () => {
  const member = as(TWO_BRANDS);
  for (const r of objectRoutes.filter((x) => !x.mutates)) {
    test(`${label(r)} | a member reaches a row someone else created in their brand`, async () => {
      const res = await callAs(member, r.method, r.path(idOf(IN_OWN_BRAND, r.objectOf)));
      const ok = r.ownOk ? r.ownOk(res.status) : reachedHandler(res.status);
      expect(ok, `${label(r)} own brand: ${res.status}`).toBe(true);
    });
  }
  test("their lists hold the brand's rows and, from root, only their own", async () => {
    for (const path of [
      '/api/v2/admin/events?limit=100',
      '/api/v2/admin/sponsors',
      '/api/v2/admin/campaigns',
    ]) {
      const text = await (await callAs(member, 'GET', path)).text();
      expect(text, path).toContain(IN_OWN_BRAND.marker);
      for (const who of [ORG_A, ORG_B, NOBODY]) expect(text, path).not.toContain(who.marker);
    }
  });
});

describe('OSE-1561 the automation key with ADMIN_SCOPE_ALL is unchanged', () => {
  for (const r of objectRoutes.filter((x) => !x.mutates)) {
    test(`${label(r)} | key-all reaches organizer B's row`, async () => {
      const res = await callAs({ kind: 'key-all' }, r.method, r.path(idOf(ORG_B, r.objectOf)));
      const ok = r.ownOk ? r.ownOk(res.status) : reachedHandler(res.status);
      expect(ok, `${label(r)} key-all: ${res.status}`).toBe(true);
    });
  }
});

// ── lists and sums ───────────────────────────────────────────────────────────

describe('OSE-1561 lists: a person in root is handed only their own rows', () => {
  const lists = [
    '/api/v2/admin/events?limit=100',
    '/api/v2/admin/sponsors',
    '/api/v2/admin/campaigns',
  ];
  const callers: Array<[string, CallerKind, BrandFx | null]> = [
    ['organizer A', A, ORG_A],
    ['organizer B', B, ORG_B],
    ['staff', as(ROOT_STAFF), null],
    ['a member with no recorded role', as(ROOT_NO_ROLE), null],
  ];
  for (const path of lists) {
    for (const [who, caller, own] of callers) {
      test(`GET ${path} | ${who}`, async () => {
        const res = await callAs(caller, 'GET', path);
        expect(res.status).toBe(200);
        const text = await res.text();
        for (const other of [ORG_A, ORG_B, NOBODY, IN_OWN_BRAND]) {
          if (other === own) continue;
          expect(text, `${who} was handed ${other.key}'s rows`).not.toContain(other.marker);
        }
        // Not an empty-body pass: their own rows are there.
        if (own) expect(text, `${who}'s own rows are missing`).toContain(own.marker);
      });
    }
  }

  test('?mine=1 and ?eventId= do not widen it', async () => {
    const mine = await (await callAs(A, 'GET', '/api/v2/admin/events?limit=100&mine=0')).text();
    expect(mine).not.toContain(ORG_B.marker);
    // The answer echoes the id that was asked for; what matters is that no row comes back.
    const byEvent = (await (
      await callAs(A, 'GET', `/api/v2/admin/sponsors?eventId=${ORG_B.activeEventId}`)
    ).json()) as { items: unknown[] };
    expect(byEvent.items).toEqual([]);
    const own = (await (
      await callAs(B, 'GET', `/api/v2/admin/sponsors?eventId=${ORG_B.activeEventId}`)
    ).json()) as { items: unknown[] };
    expect(own.items.length, 'organizer B sees the sponsor on their own event').toBe(1);
  });

  test("the roll-up counts only the caller's own events", async () => {
    type Rollup = { sponsors?: { active?: number }; totals?: Record<string, unknown> };
    const read = async (c: CallerKind) => {
      const res = await callAs(c, 'GET', '/api/v2/admin/events/portfolio-rollup');
      expect(res.status).toBe(200);
      return JSON.stringify((await res.json()) as Rollup);
    };
    // Each person's tree is the same shape, so a sum over one tree is the same
    // text for A and for B, and a sum over the whole brand is not.
    const whole = await read(as(ROOT_OWNER));
    const a = await read(A);
    const b = await read(B);
    const strip = (t: string) => t.replace(/"requestId":"[^"]*"/g, '');
    expect(strip(a)).toBe(strip(b));
    expect(strip(a), "organizer A was given the whole brand's sum").not.toBe(strip(whole));
  });

  for (const board of ['operations', 'corridor']) {
    test(`the ${board} dashboard does not sum the whole of root for an organizer`, async () => {
      const res = await callAs(A, 'GET', `/api/v2/admin/dashboards/${board}`);
      expect(res.status).toBe(403);
      const named = await callAs(A, 'GET', `/api/v2/admin/dashboards/${board}?brand_id=root`);
      expect(named.status).toBe(403);
    });
    test(`the ${board} dashboard still answers the root brand owner`, async () => {
      const res = await callAs(as(ROOT_OWNER), 'GET', `/api/v2/admin/dashboards/${board}`);
      expect(res.status).toBe(200);
    });
  }
});

// ── writes that name someone else's row in the body or a second path id ──────

describe("OSE-1561 a write cannot reach another person's row by naming it", () => {
  test("a sponsor cannot be created on organizer B's event", async () => {
    const before = await snapshotFixture();
    const res = await callAs(A, 'POST', '/api/v2/admin/sponsors', {
      name: 'bm-cross-sponsor',
      event_id: ORG_B.activeEventId,
      tier: 'primary',
    });
    expect(res.status >= 400 && res.status < 500, `accepted: ${res.status}`).toBe(true);
    expect(await snapshotFixture()).toBe(before);
    // The same answer as an event that does not exist.
    const unknown = await callAs(A, 'POST', '/api/v2/admin/sponsors', {
      name: 'bm-cross-sponsor',
      event_id: UNKNOWN_ID,
      tier: 'primary',
    });
    expect(res.status).toBe(unknown.status);
  });

  test("organizer A's own sponsor cannot be attached to organizer B's event", async () => {
    const before = await snapshotFixture();
    const res = await callAs(A, 'PUT', `/api/v2/admin/sponsors/${ORG_A.sponsorId}`, {
      event_id: ORG_B.activeEventId,
    });
    expect(res.status >= 400 && res.status < 500, `accepted: ${res.status}`).toBe(true);
    expect(await snapshotFixture()).toBe(before);
  });

  test("organizer B's event cannot be put in organizer A's campaign", async () => {
    const before = await snapshotFixture();
    const res = await callAs(
      A,
      'PUT',
      `/api/v2/admin/campaigns/${ORG_A.campaignId}/events/${ORG_B.activeEventId}`
    );
    expect(res.status).toBe(404);
    expect(await snapshotFixture()).toBe(before);
  });

  test("organizer B's placement cannot be put in organizer A's campaign", async () => {
    const before = await snapshotFixture();
    const res = await callAs(
      A,
      'PUT',
      `/api/v2/admin/campaigns/${ORG_A.campaignId}/placements/${ORG_B.placementId}`
    );
    expect(res.status).toBe(404);
    expect(await snapshotFixture()).toBe(before);
  });
});

// ── a series names events and suggestions in the request body ────────────────

describe("OSE-1561 a series cannot take, show or answer for another person's event", () => {
  const SUGGESTION = 'evtsrs_bm-orgb-suggestion';
  const seriesOf = (eventId: string) =>
    env.DB.prepare('SELECT series_id FROM events WHERE id = ?')
      .bind(eventId)
      .first<{ series_id: string | null }>();
  const stateOf = (id: string) =>
    env.DB.prepare('SELECT state FROM event_series WHERE id = ?')
      .bind(id)
      .first<{ state: string }>();
  const declare = (eventIds: string[]) => ({
    name: 'Owner wall series',
    cadence: 'weekly',
    day_of_week: 1,
    hour_of_day: 17,
    event_ids: eventIds,
  });
  const seriesPath = (eventId: string, tail = '') =>
    `/api/v2/admin/events/${eventId}/series${tail}`;

  beforeAll(async () => {
    // A suggestion the nightly detector left on organizer B's event.
    await env.DB.prepare(
      `INSERT OR REPLACE INTO event_series
         (id, venue_id, series_name, cadence, day_of_week, hour_of_day, state, detected_at,
          created_at, updated_at)
       VALUES (?, ?, 'bm-orgb-suggestion', 'weekly', 2, 18, 'pending', '2099-01-01T00:00:00Z',
               '2099-01-01T00:00:00Z', '2099-01-01T00:00:00Z')`
    )
      .bind(SUGGESTION, ORG_B.activeEventId)
      .run();
  });

  test("organizer A cannot declare a series that takes organizer B's event", async () => {
    const res = await callAs(
      A,
      'POST',
      seriesPath(ORG_A.activeEventId),
      declare([ORG_B.draftEventId])
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('EVENT_NOT_FOUND');
    expect(await seriesOf(ORG_B.draftEventId)).toEqual({ series_id: null });
    expect(await seriesOf(ORG_A.activeEventId)).toEqual({ series_id: null });
    // The same answer as an event id that exists nowhere.
    const unknown = await callAs(A, 'POST', seriesPath(ORG_A.activeEventId), declare([UNKNOWN_ID]));
    expect(unknown.status).toBe(404);
  });

  test("organizer A is not shown the suggestion on organizer B's event", async () => {
    const mine = await callAs(A, 'GET', seriesPath(ORG_A.activeEventId));
    expect(mine.status).toBe(200);
    expect(await mine.text()).not.toContain('bm-orgb-');
    // Positive controls: organizer B and the brand owner are shown it.
    expect(await (await callAs(B, 'GET', seriesPath(ORG_B.activeEventId))).text()).toContain(
      'bm-orgb-suggestion'
    );
    expect(
      await (await callAs(as(ROOT_OWNER), 'GET', seriesPath(ORG_B.activeEventId))).text()
    ).toContain('bm-orgb-suggestion');
  });

  test("organizer A cannot confirm or reject the suggestion on organizer B's event", async () => {
    const confirm = await callAs(A, 'POST', seriesPath(ORG_A.activeEventId, '/confirm'), {
      series_id: SUGGESTION,
      name: 'taken by organizer A',
      event_ids: [],
    });
    expect(confirm.status).toBe(404);
    const reject = await callAs(A, 'POST', seriesPath(ORG_A.activeEventId, '/reject'), {
      series_id: SUGGESTION,
    });
    expect(reject.status).toBe(404);
    expect(await stateOf(SUGGESTION)).toEqual({ state: 'pending' });
  });

  test("organizer A cannot attach their event to organizer B's series", async () => {
    const made = await callAs(B, 'POST', seriesPath(ORG_B.draftEventId), declare([]));
    expect(made.status, await made.clone().text()).toBe(201);
    const { series } = (await made.json()) as { series: { id: string } };
    const res = await callAs(A, 'PUT', seriesPath(ORG_A.draftEventId), { series_id: series.id });
    expect(res.status).toBe(404);
    expect(await seriesOf(ORG_A.draftEventId)).toEqual({ series_id: null });
    // Organizer B attaches their own event to their own series.
    const own = await callAs(B, 'PUT', seriesPath(ORG_B.activeEventId), { series_id: series.id });
    expect(own.status).toBe(200);
  });
});

// ── a sponsor's request to join an event ─────────────────────────────────────

describe("OSE-1561 a sponsor's request is answered by the organizer of that event", () => {
  // The matrix cell for this route cannot fail on its own: the fixture placement is
  // already accepted, so the handler answers 404 for everyone. This one is waiting.
  const PENDING = 'spl_bm-orgb-waiting';
  const waiting = () =>
    env.DB.prepare('SELECT organizer_accepted, is_active FROM sponsor_placement WHERE id = ?')
      .bind(PENDING)
      .first<{ organizer_accepted: number | null; is_active: number }>();

  beforeAll(async () => {
    // A sponsor organizer A created asks to join organizer B's event.
    await env.DB.prepare(
      `INSERT OR REPLACE INTO sponsor_placement
         (id, sponsor_business_id, event_id, tier, source, polarity, locality_band,
          click_token, display_token, is_active, sponsor_accepted, organizer_accepted)
       VALUES (?, ?, ?, 'primary', 'sponsor_request', 1, 0, ?, ?, 0, 1, NULL)`
    )
      .bind(PENDING, ORG_A.sponsorId, ORG_B.activeEventId, `ct_${PENDING}`, `dt_${PENDING}`)
      .run();
  });

  for (const [who, caller] of [
    ['organizer A (who created the sponsor, not the event)', A],
    ['staff', as(ROOT_STAFF)],
  ] as Array<[string, CallerKind]>) {
    test(`${who} cannot answer it`, async () => {
      const res = await callAs(
        caller,
        'POST',
        `/api/v2/admin/sponsor-requests/${PENDING}/respond`,
        {
          approve: true,
        }
      );
      expect(res.status).toBe(404);
      expect(await waiting()).toEqual({ organizer_accepted: null, is_active: 0 });
    });
  }

  test('organizer B, whose event it is, answers it', async () => {
    const res = await callAs(B, 'POST', `/api/v2/admin/sponsor-requests/${PENDING}/respond`, {
      approve: false,
    });
    expect(res.status).toBe(200);
    expect(await waiting()).toEqual({ organizer_accepted: 0, is_active: 0 });
  });
});

// ── a sponsor placed on someone else's event ─────────────────────────────────

describe("OSE-1561 a placement on another person's event is that person's, not the sponsor creator's", () => {
  // Organizer A created the sponsor. The sponsor asked to join organizer B's
  // draft event and organizer B said yes, so the placement is live on B's event.
  const CROSS = 'spl_bm-orgb-from-orga';
  const tierOf = (placementId: string) =>
    env.DB.prepare('SELECT tier FROM sponsor_placement WHERE id = ?')
      .bind(placementId)
      .first<{ tier: string }>();

  beforeAll(async () => {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO sponsor_placement
         (id, sponsor_business_id, event_id, tier, source, polarity, locality_band,
          click_token, display_token, is_active, sponsor_accepted, organizer_accepted)
       VALUES (?, ?, ?, 'primary', 'sponsor_request', 1, 0, 'ct_cross_orga', 'dt_cross_orga', 1, 1, 1)`
    )
      .bind(CROSS, ORG_A.sponsorId, ORG_B.draftEventId)
      .run();
  });

  test("organizer A's sponsor lists do not show the placement on organizer B's event", async () => {
    const all = await (await callAs(A, 'GET', '/api/v2/admin/sponsors')).text();
    expect(all).toContain(ORG_A.sponsorId); // their sponsor is still listed
    expect(all).not.toContain(CROSS);
    expect(all).not.toContain('ct_cross_orga');
    expect(all).not.toContain('dt_cross_orga');
    const byEvent = (await (
      await callAs(A, 'GET', `/api/v2/admin/sponsors?eventId=${ORG_B.draftEventId}`)
    ).json()) as { items: unknown[] };
    expect(byEvent.items).toEqual([]);
    // Positive control: the placement is there, and the brand owner is shown it.
    const owner = await (
      await callAs(as(ROOT_OWNER), 'GET', `/api/v2/admin/sponsors?eventId=${ORG_B.draftEventId}`)
    ).text();
    expect(owner).toContain(CROSS);
  });

  test("reading the sponsor by id never returns the placement on organizer B's event", async () => {
    const res = await callAs(A, 'GET', `/api/v2/admin/sponsors/${ORG_A.sponsorId}`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(ORG_B.draftEventId);
    expect(text).not.toContain('ct_cross_orga');
  });

  test("changing the sponsor's tier does not change the placement on organizer B's event", async () => {
    const res = await callAs(A, 'PUT', `/api/v2/admin/sponsors/${ORG_A.sponsorId}`, {
      tier: 'gold',
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await tierOf(ORG_A.placementId)).toEqual({ tier: 'gold' }); // their own event
    expect(await tierOf(CROSS)).toEqual({ tier: 'primary' }); // organizer B's event
  });
});

// ── the creator is recorded by the server ────────────────────────────────────

describe('OSE-1561 a new sponsor and a new campaign record who created them', () => {
  test("a sponsor created by organizer B is B's, and a body cannot say otherwise", async () => {
    const made = await callAs(B, 'POST', '/api/v2/admin/sponsors', {
      name: 'creator-check sponsor',
      tier: 'primary',
      created_by: ORG_A.ownerEmail,
    });
    expect(made.status).toBe(201);
    const { id } = (await made.json()) as { id: string };
    const row = await env.DB.prepare(
      'SELECT brand_id, created_by FROM sponsor_business WHERE id = ?'
    )
      .bind(id)
      .first<{ brand_id: string; created_by: string | null }>();
    expect(row).toEqual({ brand_id: PUBLIC_BRAND, created_by: ORG_B.ownerEmail });

    expect((await callAs(A, 'GET', `/api/v2/admin/sponsors/${id}`)).status).toBe(404);
    expect((await callAs(B, 'GET', `/api/v2/admin/sponsors/${id}`)).status).toBe(200);
    const put = await callAs(A, 'PUT', `/api/v2/admin/sponsors/${id}`, { name: 'renamed by A' });
    expect(put.status).toBe(404);
    const after = await env.DB.prepare('SELECT name FROM sponsor_business WHERE id = ?')
      .bind(id)
      .first<{ name: string }>();
    expect(after?.name).toBe('creator-check sponsor');
  });

  test("a campaign created by organizer B is B's", async () => {
    const made = await callAs(B, 'POST', '/api/v2/admin/campaigns', {
      title: 'creator-check campaign',
    });
    expect(made.status).toBe(201);
    const { id } = (await made.json()) as { id: string };
    const row = await env.DB.prepare('SELECT brand_id, created_by FROM campaigns WHERE id = ?')
      .bind(id)
      .first<{ brand_id: string; created_by: string | null }>();
    expect(row).toEqual({ brand_id: PUBLIC_BRAND, created_by: ORG_B.ownerEmail });

    const put = await callAs(A, 'PUT', `/api/v2/admin/campaigns/${id}`, { title: 'renamed by A' });
    expect(put.status).toBe(404);
    expect(
      (await callAs(B, 'PUT', `/api/v2/admin/campaigns/${id}`, { title: 'renamed by B' })).status
    ).toBe(200);
    const listA = await (await callAs(A, 'GET', '/api/v2/admin/campaigns')).text();
    expect(listA).not.toContain(id);
  });

  test("an event created by organizer B is B's (the column from 0075)", async () => {
    const made = await callAs(B, 'POST', '/api/v2/admin/events', {
      brand_id: PUBLIC_BRAND,
      title: 'creator-check event',
      attendance_mode: 'online',
    });
    expect(made.status, await made.clone().text()).toBe(201);
    const { id } = (await made.json()) as { id: string };
    expect((await callAs(A, 'GET', `/api/v2/admin/events/${id}/stats`)).status).toBe(404);
    expect((await callAs(B, 'GET', `/api/v2/admin/events/${id}/stats`)).status).toBe(200);
    const put = await callAs(A, 'PUT', `/api/v2/admin/events/${id}`, { title: 'renamed by A' });
    expect(put.status).toBe(404);
    const row = await env.DB.prepare('SELECT title, created_by FROM events WHERE id = ?')
      .bind(id)
      .first<{ title: string; created_by: string | null }>();
    expect(row).toEqual({ title: 'creator-check event', created_by: ORG_B.ownerEmail });
  });
});
