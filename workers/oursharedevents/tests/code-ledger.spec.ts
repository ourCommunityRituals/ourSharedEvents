/**
 * OSE-1420 — the code ledger: the admin's truth surface for an event's codes.
 *
 * Contract under test:
 *   - a URL / QR is present on a code ONLY when it is live (its own validity
 *     AND the event active + listed); otherwise `reasons` says why;
 *   - the log names every gap in organiser words ("not created", "none placed");
 *   - GET /code-ledger is READ-ONLY — it never mints a short link;
 *   - the same decision gates GET /poster-deployments, GET /poster-codes and
 *     GET /pre-event-activity, so no admin card can show a dead link.
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  decideEventLive,
  decideShortlink,
  decideDeployment,
  buildLedgerLog,
} from '../src/lib/code-ledger';

async function applyMigrations(): Promise<void> {
  const statements: string[] = JSON.parse(
    (env as Record<string, string>).TEST_MIGRATION_STATEMENTS
  );
  for (const stmt of statements) {
    try {
      await (env as Record<string, D1Database>).DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }
}
beforeAll(applyMigrations);

const ADMIN = { Authorization: 'Bearer test-admin-key-e2e-2026' };
const db = () => (env as Record<string, D1Database>).DB;
const ORIGIN = 'https://t.test';

async function seedEvent(id: string, status: string, isPublished = 1): Promise<void> {
  await db().prepare('DELETE FROM shortlinks WHERE event_id = ?').bind(id).run();
  await db().prepare('DELETE FROM poster_deployments WHERE event_id = ?').bind(id).run();
  await db()
    .prepare(
      `INSERT OR REPLACE INTO events (id, brand_id, title, slug, status, is_published, created_at, updated_at)
       VALUES (?, 'brand-ledger', 'Ledger Event', ?, ?, ?, datetime('now'), datetime('now'))`
    )
    .bind(id, id, status, isPublished)
    .run();
}
async function seedShortlink(
  id: string,
  code: string,
  kind = 'public',
  target: string | null = null
) {
  await db()
    .prepare(
      `INSERT OR REPLACE INTO shortlinks (code, event_id, target_url, kind, created_at) VALUES (?, ?, ?, ?, datetime('now'))`
    )
    .bind(code, id, target, kind)
    .run();
}
async function seedDeployment(id: string, pdId: string, isActive = 1, label = 'front door') {
  await db()
    .prepare(
      `INSERT OR REPLACE INTO poster_deployments (id, event_id, qr_token, placement_label, is_active)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(pdId, id, `qrt_${pdId}`, label, isActive)
    .run();
}
async function ledger(id: string) {
  const res = await SELF.fetch(`${ORIGIN}/api/v2/admin/events/${id}/code-ledger`, {
    headers: ADMIN,
  });
  return {
    res,
    body: (await res.json()) as Record<string, unknown> & { codes: LedgerCode[]; log: Reason[] },
  };
}
type Reason = { level: string; code: string; message: string };
type LedgerCode = {
  kind: string;
  id: string;
  label: string;
  valid: boolean;
  live: boolean;
  reasons: Reason[];
  url?: string;
  qr?: string;
};

// ─── Pure decisions ──────────────────────────────────────────────────────────

describe('code ledger | pure decisions', () => {
  const liveEv = { live: true, reasons: [] as Reason[] };

  test('event liveness: draft / ready / archived / unlisted each print their own reason', () => {
    expect(decideEventLive({ id: 'e', status: 'draft', is_published: 1 }).reasons[0].code).toBe(
      'EVENT_DRAFT'
    );
    expect(decideEventLive({ id: 'e', status: 'ready', is_published: 1 }).reasons[0].code).toBe(
      'EVENT_READY'
    );
    expect(decideEventLive({ id: 'e', status: 'archived', is_published: 1 }).reasons[0].code).toBe(
      'EVENT_ARCHIVED'
    );
    const unlisted = decideEventLive({ id: 'e', status: 'active', is_published: 0 });
    expect(unlisted.live).toBe(false);
    expect(unlisted.reasons[0].code).toBe('EVENT_UNLISTED');
    expect(unlisted.reasons[0].level).toBe('warn');
    expect(decideEventLive({ id: 'e', status: 'active', is_published: 1 })).toEqual({
      live: true,
      reasons: [],
    });
  });

  test('a live short link carries url + qr; a draft-event short link carries the reason and NO url/qr', () => {
    const live = decideShortlink(
      { code: 'abc123', kind: 'public', target_url: null },
      liveEv,
      ORIGIN
    );
    expect(live).toMatchObject({
      kind: 'shortlink',
      id: 'abc123',
      valid: true,
      live: true,
      url: `${ORIGIN}/s/abc123`,
    });
    expect(live.qr?.startsWith('data:image/')).toBe(true);
    const draftEv = decideEventLive({ id: 'e', status: 'draft', is_published: 1 });
    const off = decideShortlink(
      { code: 'abc123', kind: 'public', target_url: null },
      draftEv,
      ORIGIN
    );
    expect(off.valid).toBe(true);
    expect(off.live).toBe(false);
    expect(off).not.toHaveProperty('url');
    expect(off).not.toHaveProperty('qr');
    expect(off.reasons.map((r) => r.code)).toEqual(['EVENT_DRAFT']);
  });

  test('a malformed code or a non-https target is invalid even on a live event', () => {
    const bad = decideShortlink({ code: 'nope', kind: 'public', target_url: null }, liveEv, ORIGIN);
    expect(bad.valid).toBe(false);
    expect(bad.live).toBe(false);
    expect(bad).not.toHaveProperty('url');
    expect(bad.reasons[0].code).toBe('SHORTLINK_INVALID_CODE');
    const http = decideShortlink(
      { code: 'abc123', kind: 'donation', target_url: 'http://x.test' },
      liveEv,
      ORIGIN
    );
    expect(http.valid).toBe(false);
    expect(http.reasons[0].code).toBe('SHORTLINK_INVALID_TARGET');
  });

  test('an inactive deployment is never live, and says a scan goes to the home page', () => {
    const off = decideDeployment(
      { id: 'pd1', qr_token: 'qrt_1', placement_label: 'bar', is_active: 0 },
      liveEv,
      ORIGIN
    );
    expect(off).toMatchObject({
      kind: 'deployment',
      valid: false,
      live: false,
      label: 'Poster QR — bar',
    });
    expect(off).not.toHaveProperty('url');
    expect(off.reasons[0].code).toBe('DEPLOYMENT_INACTIVE');
    const on = decideDeployment(
      { id: 'pd1', qr_token: 'qrt_1', placement_label: null, is_active: 1 },
      liveEv,
      ORIGIN
    );
    expect(on.live).toBe(true);
    expect(on.url).toBe(`${ORIGIN}/q/qrt_1`);
    expect(on.label).toBe('Poster QR');
  });

  test('the log names the gaps: not created / none placed / all switched off', () => {
    const draftEv = decideEventLive({ id: 'e', status: 'draft', is_published: 1 });
    const empty = buildLedgerLog({ id: 'e', status: 'draft', is_published: 1 }, draftEv, [], []);
    expect(empty.map((l) => l.code)).toEqual([
      'EVENT_DRAFT',
      'SHORTLINK_NOT_CREATED',
      'POSTER_NONE',
    ]);
    expect(empty[1].level).toBe('warn');
    expect(empty[1].message).toMatch(/not created/i);
    const allOff = buildLedgerLog(
      { id: 'e', status: 'active', is_published: 1 },
      liveEv,
      [{ code: 'abc123', kind: 'public', target_url: null }],
      [{ id: 'pd1', qr_token: 'q', placement_label: null, is_active: 0 }]
    );
    expect(allOff.map((l) => l.code)).toEqual(['EVENT_LIVE', 'POSTER_ALL_INACTIVE']);
  });
});

// ─── GET /api/v2/admin/events/:id/code-ledger ────────────────────────────────

describe('GET /api/v2/admin/events/:id/code-ledger', () => {
  test('no auth → 401; unknown event → 404', async () => {
    expect((await SELF.fetch(`${ORIGIN}/api/v2/admin/events/x/code-ledger`)).status).toBe(401);
    const { res, body } = await ledger('ledger-nope');
    expect(res.status).toBe(404);
    expect(body.code).toBe('NOT_FOUND');
  });

  test('draft event: every code carries reasons and NO url/qr; the log says why', async () => {
    const id = 'ledger-draft';
    await seedEvent(id, 'draft');
    await seedShortlink(id, 'ldr001');
    await seedDeployment(id, 'pd-ldr-1', 1);
    const { res, body } = await ledger(id);
    expect(res.status).toBe(200);
    expect(body.event_live).toBe(false);
    expect(body.codes).toHaveLength(2);
    for (const c of body.codes) {
      expect(c.live).toBe(false);
      expect(c).not.toHaveProperty('url');
      expect(c).not.toHaveProperty('qr');
      expect(c.reasons.map((r) => r.code)).toContain('EVENT_DRAFT');
    }
    expect(body.log.map((l) => l.code)).toEqual(['EVENT_DRAFT']);
    expect(JSON.stringify(body)).not.toMatch(/\/s\/ldr001|\/q\/qrt_/);
  });

  test('live event: live codes carry url + qr; an inactive deployment does not', async () => {
    const id = 'ledger-live';
    await seedEvent(id, 'active', 1);
    await seedShortlink(id, 'ldr002');
    await seedDeployment(id, 'pd-ldr-on', 1, 'front door');
    await seedDeployment(id, 'pd-ldr-off', 0, 'back wall');
    const { body } = await ledger(id);
    expect(body.event_live).toBe(true);
    const byId = Object.fromEntries(body.codes.map((c) => [c.id, c]));
    expect(byId.ldr002.url).toBe(`${ORIGIN}/s/ldr002`);
    expect(byId.ldr002.qr?.startsWith('data:image/')).toBe(true);
    expect(byId['pd-ldr-on'].url).toBe(`${ORIGIN}/q/qrt_pd-ldr-on`);
    expect(byId['pd-ldr-off'].live).toBe(false);
    expect(byId['pd-ldr-off']).not.toHaveProperty('url');
    expect(byId['pd-ldr-off'].reasons[0].code).toBe('DEPLOYMENT_INACTIVE');
    expect(body.log.map((l) => l.code)).toEqual(['EVENT_LIVE']);
    expect((body.evidence as { shortlinks: number }).shortlinks).toBe(1);
  });

  test('never who: the ledger carries codes, counts and reasons — nothing about a person', async () => {
    // Owner's standing rule: the privacy claim is the basis structure and is
    // perpetuated through every surface, the admin card included. A ledger
    // payload names codes and why they are (not) live; it never names anyone.
    const id = 'ledger-neverwho';
    await seedEvent(id, 'active', 1);
    await seedShortlink(id, 'ldr009');
    await seedDeployment(id, 'pd-ldr-nw', 1, 'front door');
    const res = await SELF.fetch(`${ORIGIN}/api/v2/admin/events/${id}/code-ledger`, {
      headers: ADMIN,
    });
    const raw = await res.text();
    for (const banned of [
      'anonymous_id',
      'anon_id',
      'anon_id_hash',
      'ua_hash',
      'user_agent',
      'ip',
      'country',
      'email',
      'attendee_name',
      'lat',
      'lon',
      'h3_res9',
    ]) {
      expect(raw, banned).not.toMatch(new RegExp(`"${banned}"`));
    }
  });

  test('published-but-unlisted event: nothing is live and the log warns', async () => {
    const id = 'ledger-unlisted';
    await seedEvent(id, 'active', 0);
    await seedShortlink(id, 'ldr003');
    const { body } = await ledger(id);
    expect(body.event_live).toBe(false);
    expect(body.codes[0].live).toBe(false);
    expect(body.log[0].code).toBe('EVENT_UNLISTED');
    expect(body.log[0].level).toBe('warn');
  });

  test('an event whose short-link minting failed reads "not created" — and the GET mints nothing', async () => {
    const id = 'ledger-nolink';
    await seedEvent(id, 'draft');
    const before = await db()
      .prepare('SELECT COUNT(*) AS n FROM shortlinks')
      .first<{ n: number }>();
    const { body } = await ledger(id);
    expect(body.log.map((l) => l.code)).toEqual([
      'EVENT_DRAFT',
      'SHORTLINK_NOT_CREATED',
      'POSTER_NONE',
    ]);
    expect(body.codes).toHaveLength(0);
    const after = await db().prepare('SELECT COUNT(*) AS n FROM shortlinks').first<{ n: number }>();
    expect(after?.n).toBe(before?.n);
  });
});

// ─── The same decision gates the existing card endpoints ─────────────────────

describe('the card endpoints emit url/qr ONLY for live codes (OSE-1420)', () => {
  test('GET /poster-deployments on a draft event: rows have reasons, no scan_url, no qr_data_uri, no slot urls', async () => {
    const id = 'ledger-pd-draft';
    await seedEvent(id, 'draft');
    await seedShortlink(id, 'ldr004');
    await seedDeployment(id, 'pd-ldr-d', 1);
    const res = await SELF.fetch(`${ORIGIN}/api/v2/admin/events/${id}/poster-deployments`, {
      headers: ADMIN,
    });
    const body = (await res.json()) as {
      ok: boolean;
      event_live: boolean;
      items: Array<{
        live: boolean;
        valid: boolean;
        scan_url: string | null;
        qr_data_uri: string;
        reasons: Reason[];
        slots: Array<{ live: boolean; url?: string; qr?: string }>;
      }>;
    };
    expect(res.status).toBe(200);
    expect(body.event_live).toBe(false);
    expect(body.items[0].valid).toBe(true);
    expect(body.items[0].live).toBe(false);
    expect(body.items[0].scan_url).toBeNull();
    expect(body.items[0].qr_data_uri).toBe('');
    expect(body.items[0].reasons[0].code).toBe('EVENT_DRAFT');
    expect(body.items[0].slots[0].live).toBe(false);
    expect(body.items[0].slots[0]).not.toHaveProperty('url');
    expect(JSON.stringify(body)).not.toMatch(/\/s\/ldr004|\/q\/qrt_/);
  });

  test('GET /poster-deployments on a live event: an active row is live with scan_url; an inactive row is not', async () => {
    const id = 'ledger-pd-live';
    await seedEvent(id, 'active', 1);
    await seedShortlink(id, 'ldr005');
    await seedDeployment(id, 'pd-ldr-l1', 1);
    await seedDeployment(id, 'pd-ldr-l0', 0);
    const res = await SELF.fetch(`${ORIGIN}/api/v2/admin/events/${id}/poster-deployments`, {
      headers: ADMIN,
    });
    const body = (await res.json()) as {
      items: Array<{
        id: string;
        live: boolean;
        scan_url: string | null;
        qr_data_uri: string;
        slots: Array<{ url?: string }>;
      }>;
    };
    const on = body.items.find((i) => i.id === 'pd-ldr-l1')!;
    const off = body.items.find((i) => i.id === 'pd-ldr-l0')!;
    expect(on.live).toBe(true);
    expect(on.scan_url).toBe(`${ORIGIN}/q/qrt_pd-ldr-l1`);
    expect(on.qr_data_uri.startsWith('data:image/')).toBe(true);
    expect(on.slots[0].url).toBe(`${ORIGIN}/s/ldr005`);
    expect(off.live).toBe(false);
    expect(off.scan_url).toBeNull();
    expect(off.qr_data_uri).toBe('');
  });

  test('GET /poster-codes on a draft event: codes carry reasons and no url/qr', async () => {
    const id = 'ledger-pc-draft';
    await seedEvent(id, 'draft');
    await seedShortlink(id, 'ldr006');
    const res = await SELF.fetch(`${ORIGIN}/api/v2/admin/events/${id}/poster-codes`, {
      headers: ADMIN,
    });
    const body = (await res.json()) as {
      ok: boolean;
      event_live: boolean;
      codes: Array<{ code: string; live: boolean; reasons: Reason[]; url?: string; qr?: string }>;
    };
    expect(res.status).toBe(200);
    expect(body.event_live).toBe(false);
    expect(body.codes[0].code).toBe('ldr006');
    expect(body.codes[0].live).toBe(false);
    expect(body.codes[0]).not.toHaveProperty('url');
    expect(body.codes[0]).not.toHaveProperty('qr');
    expect(body.codes[0].reasons[0].code).toBe('EVENT_DRAFT');
  });

  test('GET /pre-event-activity on a draft event: link is null and the reason is named', async () => {
    const id = 'ledger-pe-draft';
    await seedEvent(id, 'draft');
    await seedShortlink(id, 'ldr007');
    const res = await SELF.fetch(`${ORIGIN}/api/v2/admin/events/${id}/pre-event-activity`, {
      headers: ADMIN,
    });
    const body = (await res.json()) as {
      link: unknown;
      event_live: boolean;
      event_reasons: Reason[];
    };
    expect(res.status).toBe(200);
    expect(body.link).toBeNull();
    expect(body.event_live).toBe(false);
    expect(body.event_reasons[0].code).toBe('EVENT_DRAFT');
  });
});
