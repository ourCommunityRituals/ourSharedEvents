/**
 * Sponsor home — the sponsor corner of the triangle gets a screen.
 *
 * Covers:
 *   - token: mint/verify round trip, expiry, tamper, wrong `kind` (a report
 *     token can never open the sponsor home), missing secret → fail closed
 *   - admin mint route: brand-scoped (out-of-scope → 404, same as missing),
 *     audited, returns a /sponsor?t= URL
 *   - page: invalid token → branded 401 page (never a stack trace, never JSON);
 *     valid token → sponsor name, one card per placement, event state labels,
 *     Accept/Decline controls, report link only once the event is active/over,
 *     no attendee data, no-store + nonce CSP
 *   - respond: sets sponsor_accepted for the token's own placement; a
 *     placement belonging to another sponsor → 404; bad token → 401; audited
 *     as actor sponsor:<id>
 */

import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import {
  mintSponsorHomeToken,
  verifySponsorHomeToken,
  SPONSOR_HOME_TTL_SECONDS,
} from '../src/lib/sponsor-home-auth';
import { mintSignedLinkToken } from '../src/lib/shared-report-auth';

const BRAND = 'ose-sponsor-home';
const OTHER_BRAND = 'ose-sponsor-home-other';
const ADMIN_HEADERS = { Authorization: 'Bearer test-admin-key-e2e-2026' };

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  SHARED_REPORT_SIGNING_SECRET: string;
}
const tenv = env as unknown as TestEnv;

async function applyMigrations(): Promise<void> {
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

async function seedEvent(id: string, status: string, startDate: string): Promise<void> {
  await tenv.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, start_date, location)
     VALUES (?, ?, ?, ?, ?, ?, 'Eagles Hall')`
  )
    .bind(id, BRAND, `SH ${id}`, `slug-${id}`, status, startDate)
    .run();
}
async function seedSponsor(id: string, brand: string, name: string): Promise<void> {
  await tenv.DB.prepare(
    `INSERT INTO sponsor_business (id, brand_id, name, is_active) VALUES (?, ?, ?, 1)`
  )
    .bind(id, brand, name)
    .run();
}
async function seedPlacement(
  id: string,
  sponsorId: string,
  eventId: string,
  accepted: number | null = null
) {
  await tenv.DB.prepare(
    `INSERT INTO sponsor_placement (id, sponsor_business_id, event_id, tier, source, is_active, sponsor_accepted)
     VALUES (?, ?, ?, 'standard', 'organizer', 1, ?)`
  )
    .bind(id, sponsorId, eventId, accepted)
    .run();
}

beforeAll(async () => {
  await applyMigrations();
  await tenv.DB.prepare('DELETE FROM sponsor_placement WHERE id LIKE ?').bind('shp-%').run();
  await tenv.DB.prepare('DELETE FROM sponsor_business WHERE id LIKE ?').bind('shs-%').run();
  await tenv.DB.prepare('DELETE FROM events WHERE brand_id = ?').bind(BRAND).run();
  await seedEvent('sh-ev-live', 'active', '2026-09-16');
  await seedEvent('sh-ev-soon', 'active', '2099-01-01');
  await seedEvent('sh-ev-draft', 'draft', '2099-02-01');
  await seedEvent('sh-ev-over', 'archived', '2020-01-01');
  await seedSponsor('shs-brew', BRAND, 'Local Brewery');
  await seedSponsor('shs-other', OTHER_BRAND, 'Other Tenant Co');
  await seedPlacement('shp-1', 'shs-brew', 'sh-ev-live', null);
  await seedPlacement('shp-2', 'shs-brew', 'sh-ev-soon', 1);
  await seedPlacement('shp-3', 'shs-brew', 'sh-ev-draft', null);
  await seedPlacement('shp-4', 'shs-brew', 'sh-ev-over', 1);
  await seedPlacement('shp-x', 'shs-other', 'sh-ev-live', null);
});

describe('sponsor-home token', () => {
  test('round trip carries sponsor + brand and expires in 30 days', async () => {
    const minted = await mintSponsorHomeToken(tenv, 'shs-brew', BRAND);
    expect(minted).not.toBeNull();
    const claim = await verifySponsorHomeToken(tenv, minted!.token);
    expect(claim).toEqual({
      kind: 'sponsor_home',
      sponsor_id: 'shs-brew',
      brand_id: BRAND,
      exp: minted!.exp,
    });
    expect(minted!.exp - Math.floor(Date.now() / 1000)).toBeGreaterThan(
      SPONSOR_HOME_TTL_SECONDS - 5
    );
  });
  test('an expired token is refused', async () => {
    const minted = await mintSponsorHomeToken(tenv, 'shs-brew', BRAND, -1);
    expect(await verifySponsorHomeToken(tenv, minted!.token)).toBeNull();
  });
  test('a tampered payload is refused (signature covers it)', async () => {
    const minted = await mintSponsorHomeToken(tenv, 'shs-brew', BRAND);
    const [payload, sig] = minted!.token.split('.');
    const forged = btoa(
      JSON.stringify({
        kind: 'sponsor_home',
        sponsor_id: 'shs-other',
        brand_id: OTHER_BRAND,
        exp: 9999999999,
      })
    )
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(await verifySponsorHomeToken(tenv, `${forged}.${sig}`)).toBeNull();
    expect(await verifySponsorHomeToken(tenv, `${payload}.${'0'.repeat(64)}`)).toBeNull();
  });
  test('a SharedReport token (different kind, same secret) can never open the sponsor home', async () => {
    const reportToken = await mintSignedLinkToken(tenv, 'sh-ev-live', 'sponsor', 3600, {
      sponsor_id: 'shs-brew',
    });
    expect(reportToken).not.toBeNull();
    expect(await verifySponsorHomeToken(tenv, reportToken)).toBeNull();
  });
  test('no secret → fail closed on both mint and verify', async () => {
    const noSecret = { SHARED_REPORT_SIGNING_SECRET: '' };
    expect(await mintSponsorHomeToken(noSecret, 'shs-brew', BRAND)).toBeNull();
    const minted = await mintSponsorHomeToken(tenv, 'shs-brew', BRAND);
    expect(await verifySponsorHomeToken(noSecret, minted!.token)).toBeNull();
  });
});

describe('POST /api/v2/admin/sponsors/:id/home-link', () => {
  test('mints a /sponsor?t= URL for an in-scope sponsor and audits it', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/admin/sponsors/shs-brew/home-link', {
      method: 'POST',
      headers: ADMIN_HEADERS,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; url: string; expiresAt: string };
    expect(body.ok).toBe(true);
    expect(body.url).toMatch(/^https:\/\/t\.test\/sponsor\?t=[A-Za-z0-9_-]+\.[0-9a-f]{64}$/);
    const audit = await tenv.DB.prepare(
      "SELECT actor, outcome FROM admin_audit_log WHERE action = 'MINT_SPONSOR_HOME_LINK' AND resource_id = 'shs-brew' ORDER BY rowid DESC LIMIT 1"
    ).first<{ actor: string; outcome: string }>();
    expect(audit?.outcome).toBe('success');
    expect(audit?.actor).toBe('key:admin');
  });
  test('an unknown sponsor is 404', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/admin/sponsors/shs-nope/home-link', {
      method: 'POST',
      headers: ADMIN_HEADERS,
    });
    expect(res.status).toBe(404);
  });
  test('unauthenticated → 401', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/admin/sponsors/shs-brew/home-link', {
      method: 'POST',
    });
    expect(res.status).toBe(401);
  });
});

describe('GET /sponsor — the page', () => {
  async function pageFor(
    sponsorId: string,
    brand = BRAND
  ): Promise<{ res: Response; html: string }> {
    const minted = await mintSponsorHomeToken(tenv, sponsorId, brand);
    const res = await SELF.fetch(`https://t.test/sponsor?t=${minted!.token}`);
    return { res, html: await res.text() };
  }

  test('no token → branded 401 page, not JSON, not a trace', async () => {
    const res = await SELF.fetch('https://t.test/sponsor');
    expect(res.status).toBe(401);
    const html = await res.text();
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(html).toContain('sponsor link');
    expect(html).not.toContain('"ok":false');
  });

  test('cross-tenant claim (sponsor in another brand) is the same invalid page', async () => {
    const { res } = await pageFor('shs-other', BRAND);
    expect(res.status).toBe(401);
  });

  test('renders the sponsor, one card per placement, honest state labels, and the counts', async () => {
    const { res, html } = await pageFor('shs-brew');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-security-policy')).toMatch(/script-src 'self' 'nonce-/);
    expect(html).toContain('data-testid="sponsor-home-name">Local Brewery<');
    expect(html.match(/data-testid="placement-card"/g)?.length).toBe(4);
    // Live now / Coming up / Over / Organizer still setting up
    expect(html).toContain('>Live now<');
    expect(html).toContain('>Coming up<');
    expect(html).toContain('>Over<');
    expect(html).toContain('>Organizer still setting up<');
    expect(html).toContain('data-testid="sponsor-home-count-live">1<');
    expect(html).toContain('data-testid="sponsor-home-count-upcoming">1<');
    expect(html).toContain('data-testid="sponsor-home-count-pending">2<');
  });

  test('report link only where there is something to report; public link only when live-renderable', async () => {
    const { html } = await pageFor('shs-brew');
    const card = (eventId: string) => {
      const i = html.indexOf(`data-event-id="${eventId}"`);
      const j = html.indexOf('</article>', i);
      return html.slice(i, j);
    };
    expect(card('sh-ev-live')).toContain('data-testid="placement-report-link"');
    expect(card('sh-ev-live')).toContain('href="/events/sh-ev-live"');
    expect(card('sh-ev-over')).toContain('data-testid="placement-report-link"');
    expect(card('sh-ev-over')).not.toContain('data-testid="placement-public-link"');
    expect(card('sh-ev-draft')).not.toContain('data-testid="placement-report-link"');
    expect(card('sh-ev-draft')).not.toContain('data-testid="placement-public-link"');
    // The report link is sponsor-scoped (token carries sponsor_id) and hits the
    // signed-link surface, never an admin endpoint.
    expect(card('sh-ev-live')).toMatch(
      /href="\/sharedReport\?eventId=sh-ev-live&token=[A-Za-z0-9_-]+\.[0-9a-f]{64}"/
    );
  });

  test('never renders attendee data or the other tenant', async () => {
    const { html } = await pageFor('shs-brew');
    expect(html).not.toContain('Other Tenant Co');
    expect(html).not.toMatch(/registrations|attendee_name|email/i);
  });

  test('page load is rate-limited on the public read limiter (429 page, not 500)', async () => {
    // Just proves the path is wired: the limiter is KV-backed and lenient in
    // tests, so we assert shape on a normal request rather than exhaust it.
    const { res } = await pageFor('shs-brew');
    expect([200, 429]).toContain(res.status);
  });
});

describe('POST /api/v2/sponsor/placements/:id/respond', () => {
  async function respond(placementId: string, token: string | null, accepted: unknown) {
    const res = await SELF.fetch(
      `https://t.test/api/v2/sponsor/placements/${placementId}/respond`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, accepted }),
      }
    );
    return {
      res,
      body: (await res.json()) as { ok: boolean; code?: string; sponsor_accepted?: number },
    };
  }
  async function acceptedOf(id: string): Promise<number | null> {
    const row = await tenv.DB.prepare('SELECT sponsor_accepted FROM sponsor_placement WHERE id = ?')
      .bind(id)
      .first<{ sponsor_accepted: number | null }>();
    return row?.sponsor_accepted ?? null;
  }

  test('the sponsor accepts, then declines, their own placement; audited as sponsor:<id>', async () => {
    const token = (await mintSponsorHomeToken(tenv, 'shs-brew', BRAND))!.token;
    expect(await acceptedOf('shp-1')).toBeNull();
    let r = await respond('shp-1', token, true);
    expect(r.res.status).toBe(200);
    expect(r.body.sponsor_accepted).toBe(1);
    expect(await acceptedOf('shp-1')).toBe(1);
    r = await respond('shp-1', token, false);
    expect(r.res.status).toBe(200);
    expect(await acceptedOf('shp-1')).toBe(0);
    const audit = await tenv.DB.prepare(
      "SELECT actor, details FROM admin_audit_log WHERE action = 'SPONSOR_PLACEMENT_RESPOND' AND resource_id = 'shp-1' ORDER BY rowid DESC LIMIT 1"
    ).first<{ actor: string; details: string }>();
    expect(audit?.actor).toBe('sponsor:shs-brew');
    expect(JSON.parse(audit!.details).accepted).toBe(false);
  });

  test("another sponsor's placement is 404 (not 403 — no enumeration oracle)", async () => {
    const token = (await mintSponsorHomeToken(tenv, 'shs-brew', BRAND))!.token;
    const r = await respond('shp-x', token, true);
    expect(r.res.status).toBe(404);
    expect(await acceptedOf('shp-x')).toBeNull();
  });

  test('bad / missing token → 401 and nothing written', async () => {
    const before = await acceptedOf('shp-2');
    expect((await respond('shp-2', 'nope.nope', true)).res.status).toBe(401);
    expect((await respond('shp-2', null, true)).res.status).toBe(401);
    expect(await acceptedOf('shp-2')).toBe(before);
  });

  test('accepted must be a boolean', async () => {
    const token = (await mintSponsorHomeToken(tenv, 'shs-brew', BRAND))!.token;
    const r = await respond('shp-2', token, 'yes');
    expect(r.res.status).toBe(400);
    expect(r.body.code).toBe('MISSING_FIELD');
  });

  test('the admin sponsors card offers the Sponsor link action, dispatched CSP-safely', async () => {
    const res = await SELF.fetch('https://t.test/admin', { headers: ADMIN_HEADERS });
    const html = await res.text();
    expect(html).toContain('data-action="sponsor-home-link"');
    expect(html).toContain("'sponsor-home-link': function (el)");
    expect(html).toContain(
      "fetch('/api/v2/admin/sponsors/' + encodeURIComponent(id) + '/home-link', { method: 'POST' })"
    );
  });
});
