/**
 * OSE-stakeholder-surfaces-p1 — sponsor strips, social proof counts, and
 * attendance stats on public event phase pages.
 *
 * Covers the 6 new conditional render behaviors added in Phase 1:
 *
 *   Pre-event phase:
 *     1. Sponsor strip (pre-sponsor-strip) renders when active sponsors exist
 *     2. Sponsor strip absent when no sponsors
 *     3. Social proof count (registration-count) renders when live regs > 0
 *     4. Social proof count absent when regs = 0
 *     5. Expired registrations are excluded from the social proof count
 *     6. XSS: javascript: sponsor URL → name-only render, no href emitted
 *     7. Valid HTTPS sponsor URL → renders as <a href> link
 *
 *   Event-live phase:
 *     8. Live check-in count (checkin-count) renders when total_count > 0
 *     9. Live check-in count absent when checkin_counts row missing
 *     10. Live sponsor strip (live-sponsor-strip) renders when sponsors exist
 *
 *   Post-event phase:
 *     11. Stats card (event-stats-card) renders when any count > 0
 *     12. Stats card absent when all counts are 0
 *     13. Attendance rate renders only when both registrations and checkins > 0
 *     14. Sponsor thank-you (post-sponsor-thanks) renders when sponsors exist
 *     15. Sponsor thank-you absent when no sponsors
 *
 * Anonymity invariant: PII column values (email_hash, email_encrypted,
 * attendee_name) must never appear in any rendered HTML.
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { seedSplitSponsor } from './helpers/seed-sponsor';
import { env, SELF } from 'cloudflare:test';

const BRAND = 'ose-ssp1-test';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}

function tenv(): TestEnv {
  return env as unknown as TestEnv;
}

async function applyMigrations(): Promise<void> {
  const stmts: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await tenv().DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        msg.includes('duplicate column name') ||
        msg.includes('already exists') ||
        msg.includes('no such column')
      )
        continue;
      throw e;
    }
  }
  const formStmts: string[] = JSON.parse(tenv().TEST_FORMS_MIGRATION_STATEMENTS);
  for (const stmt of formStmts) {
    try {
      await tenv().FORMS_DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('already exists') || msg.includes('duplicate column name')) continue;
      throw e;
    }
  }
}

async function seedEvent(
  id: string,
  opts: { startOffsetDays: number; endOffsetDays: number; status?: string }
): Promise<void> {
  const now = Date.now();
  const start = new Date(now + opts.startOffsetDays * 86400000).toISOString();
  const end = new Date(now + opts.endOffsetDays * 86400000).toISOString();
  await tenv().DB.prepare(`DELETE FROM events WHERE id = ?`).bind(id).run();
  await tenv()
    .DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, location, start_date, end_date, what_short, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    )
    .bind(
      id,
      BRAND,
      `Event ${id}`,
      id,
      opts.status ?? 'active',
      'Test Venue',
      start,
      end,
      'A community gathering.'
    )
    .run();
}

async function seedSponsor(
  eventId: string,
  opts: { name: string; websiteUrl?: string | null; isActive?: number }
): Promise<void> {
  const id = `spon_${eventId}_${opts.name.replace(/\s+/g, '_').toLowerCase()}`;
  // OSE-799 A2: split model (helper is idempotent — clears prior rows for this id).
  await seedSplitSponsor(tenv().DB, {
    id,
    eventId,
    name: opts.name,
    tier: 'gold',
    websiteUrl: opts.websiteUrl ?? null,
    isActive: opts.isActive ?? 1,
  });
}

async function seedRegistration(
  eventId: string,
  opts: { id: string; expiresAt?: string | null }
): Promise<void> {
  await tenv()
    .FORMS_DB.prepare(
      `INSERT OR REPLACE INTO form_registrations
       (id, event_id, registration_bucket, status, created_at, expires_at)
       VALUES (?, ?, '15min', 'confirmed', datetime('now'), ?)`
    )
    .bind(opts.id, eventId, opts.expiresAt ?? null)
    .run();
}

async function seedCheckinCount(eventId: string, count: number): Promise<void> {
  await tenv()
    .FORMS_DB.prepare(
      `INSERT OR REPLACE INTO checkin_counts (id, event_id, total_count, updated_at)
       VALUES (?, ?, ?, datetime('now'))`
    )
    .bind(`cc_${eventId}`, eventId, count)
    .run();
}

async function seedSurvey(eventId: string, id: string): Promise<void> {
  await tenv()
    .FORMS_DB.prepare(
      `INSERT OR REPLACE INTO form_surveys (id, event_id, responses_json, submitted_bucket, pii_scrubbed, created_at)
       VALUES (?, ?, '{}', '15min', 1, datetime('now'))`
    )
    .bind(id, eventId)
    .run();
}

async function seedEmailSignup(eventId: string, id: string): Promise<void> {
  await tenv()
    .FORMS_DB.prepare(
      `INSERT OR REPLACE INTO email_signups
       (id, event_id, email_hash, email_encrypted, signup_bucket, retention_expires_at, created_at)
       VALUES (?, ?, 'hash_abc', 'enc_abc', '15min', datetime('now', '+30 days'), datetime('now'))`
    )
    .bind(id, eventId)
    .run();
}

beforeAll(async () => {
  await applyMigrations();
}, 120_000);

// ── Pre-event: sponsor strip ──────────────────────────────────────────────────

describe('OSE-ssp1: pre-event sponsor strip', () => {
  test('pre-sponsor-strip renders when active sponsors exist', async () => {
    const id = 'evt_ssp1_pre_sponsor_yes';
    await seedEvent(id, { startOffsetDays: 7, endOffsetDays: 8 });
    await seedSponsor(id, { name: 'Acme Corp', websiteUrl: 'https://acme.example.com' });

    const res = await SELF.fetch(`https://t.test/events/${id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('data-testid="pre-sponsor-strip"');
    expect(html).toContain('Acme Corp');
    expect(html).toContain('Supported by');
  });

  test('pre-sponsor-strip renders below the title and date, above the content', async () => {
    const id = 'evt_ssp1_pre_sponsor_top';
    await seedEvent(id, { startOffsetDays: 7, endOffsetDays: 8 });
    await seedSponsor(id, { name: 'Top Sponsor', websiteUrl: 'https://top.example.com' });

    const html = await (await SELF.fetch(`https://t.test/events/${id}`)).text();
    const strip = html.indexOf('data-testid="pre-sponsor-strip"');
    const title = html.indexOf('data-testid="event-title"');
    const where = html.indexOf('data-testid="event-where"');
    expect(strip, 'sponsor strip must render').toBeGreaterThan(-1);
    expect(where, 'WHERE must render').toBeGreaterThan(-1);
    expect(strip, 'sponsor strip follows the event title').toBeGreaterThan(title);
    expect(strip, 'sponsor strip precedes the content and map').toBeLessThan(where);
  });

  test('pre-sponsor-strip absent when no sponsors for event', async () => {
    const id = 'evt_ssp1_pre_sponsor_no';
    await seedEvent(id, { startOffsetDays: 7, endOffsetDays: 8 });

    const res = await SELF.fetch(`https://t.test/events/${id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('data-testid="pre-sponsor-strip"');
    expect(html).not.toContain('Supported by');
  });

  test('inactive sponsors are excluded from the strip', async () => {
    const id = 'evt_ssp1_pre_sponsor_inactive';
    await seedEvent(id, { startOffsetDays: 7, endOffsetDays: 8 });
    await seedSponsor(id, {
      name: 'Inactive Brand',
      websiteUrl: 'https://inactive.example.com',
      isActive: 0,
    });

    const res = await SELF.fetch(`https://t.test/events/${id}`);
    const html = await res.text();
    expect(html).not.toContain('Inactive Brand');
    expect(html).not.toContain('data-testid="pre-sponsor-strip"');
  });

  test('valid HTTPS sponsor URL renders as <a href> link', async () => {
    const id = 'evt_ssp1_pre_sponsor_link';
    await seedEvent(id, { startOffsetDays: 7, endOffsetDays: 8 });
    await seedSponsor(id, { name: 'Link Sponsor', websiteUrl: 'https://linksponsor.example.com' });

    const res = await SELF.fetch(`https://t.test/events/${id}`);
    const html = await res.text();
    expect(html).toContain('href="https://linksponsor.example.com"');
    expect(html).toContain('class="ose-sponsor-link"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
  });

  test('javascript: sponsor URL is never emitted — the tap falls back to the sponsor card (XSS guard)', async () => {
    const id = 'evt_ssp1_pre_sponsor_xss';
    await seedEvent(id, { startOffsetDays: 7, endOffsetDays: 8 });
    await seedSponsor(id, {
      name: 'Malicious Sponsor',
      websiteUrl: 'javascript:alert(document.domain)',
    });

    const res = await SELF.fetch(`https://t.test/events/${id}`);
    const html = await res.text();
    // Must render the sponsor name (strip present) but MUST NOT render javascript: href
    expect(html).toContain('Malicious Sponsor');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('javascript:alert');
    // 0083: a sponsor with no usable website links to its own public card.
    expect(html).toMatch(
      /href="\/sponsors\/[^"]+" class="ose-sponsor-link" data-testid="sponsor-card-link"/
    );
  });

  test('null sponsor URL links to the sponsor card instead of an outbound site', async () => {
    const id = 'evt_ssp1_pre_sponsor_nourl';
    await seedEvent(id, { startOffsetDays: 7, endOffsetDays: 8 });
    await seedSponsor(id, { name: 'No Link Sponsor', websiteUrl: null });

    const res = await SELF.fetch(`https://t.test/events/${id}`);
    const html = await res.text();
    expect(html).toContain('No Link Sponsor');
    // 0083 (decided 2026-09-30): tap → the sponsor's card, never nowhere.
    expect(html).toMatch(
      /href="\/sponsors\/[^"]+" class="ose-sponsor-link" data-testid="sponsor-card-link">No Link Sponsor</
    );
    expect(html).not.toContain('rel="noopener noreferrer nofollow"');
  });
});

// ── Counts are POST-EVENT only (founder decision 2026-09-04) ─────────────────
//
// Live tallies were removed from the pre-event and event-live phases: an
// attendee deciding whether to come, or standing in the room, is never shown
// how many others did. The platform counts the room for the host, the sponsor
// and the SharedReport — never to persuade the room. The post-event recap card
// keeps its counts (OSE-657 keepsake); those assertions live further below.
//
// These tests are born-red against the previous behaviour: each seeds the exact
// condition that used to render a count and asserts it is absent.

describe('counts are post-event only: pre-event phase shows none', () => {
  test('no registration count with live registrations present', async () => {
    const id = 'evt_ssp1_pre_reg_yes';
    await seedEvent(id, { startOffsetDays: 7, endOffsetDays: 8 });
    await seedRegistration(id, { id: 'reg_ssp1_a1', expiresAt: null });
    await seedRegistration(id, { id: 'reg_ssp1_a2', expiresAt: null });

    const html = await (await SELF.fetch(`https://t.test/events/${id}`)).text();
    expect(html).not.toContain('data-testid="registration-count"');
    expect(html).not.toMatch(/registered so far/i);
    // The RSVP path itself is untouched — the ask stays, only the tally goes.
    expect(html).toContain('data-testid="event-rsvp"');
  });

  test('no registration count with exactly one registration', async () => {
    const id = 'evt_ssp1_pre_reg_one';
    await seedEvent(id, { startOffsetDays: 7, endOffsetDays: 8 });
    await seedRegistration(id, { id: 'reg_ssp1_one', expiresAt: null });

    const html = await (await SELF.fetch(`https://t.test/events/${id}`)).text();
    expect(html).not.toContain('data-testid="registration-count"');
    expect(html).not.toMatch(/\d+ registered so far/i);
  });

  test('no registration count when there are no registrations', async () => {
    const id = 'evt_ssp1_pre_reg_no';
    await seedEvent(id, { startOffsetDays: 7, endOffsetDays: 8 });

    const html = await (await SELF.fetch(`https://t.test/events/${id}`)).text();
    expect(html).not.toContain('data-testid="registration-count"');
  });
});

describe('counts are post-event only: event-live phase shows none', () => {
  test('no check-in tally on the live page even with 42 check-ins', async () => {
    const id = 'evt_ssp1_live_cc_yes';
    await seedEvent(id, { startOffsetDays: -1 / 24, endOffsetDays: 1 / 24 });
    await seedCheckinCount(id, 42);

    const html = await (await SELF.fetch(`https://t.test/events/${id}`)).text();
    expect(html).toContain('data-testid="event-main-live"');
    expect(html).not.toContain('data-testid="checkin-count"');
    expect(html).not.toMatch(/checked in so far/i);
    expect(html).not.toMatch(/>\s*42\s*</);
    // The check-in ACTION stays — attendees can still check in, they just
    // aren't shown the running total.
    expect(html).toContain('data-testid="event-checkin"');
  });

  test('no check-in tally on the live page with no check-ins', async () => {
    const id = 'evt_ssp1_live_cc_no';
    await seedEvent(id, { startOffsetDays: -1 / 24, endOffsetDays: 1 / 24 });

    const html = await (await SELF.fetch(`https://t.test/events/${id}`)).text();
    expect(html).toContain('data-testid="event-main-live"');
    expect(html).not.toContain('data-testid="checkin-count"');
  });
});

describe('OSE-ssp1: live-event sponsor strip', () => {
  test('live-sponsor-strip renders when active sponsors exist', async () => {
    const id = 'evt_ssp1_live_sponsor_yes';
    await seedEvent(id, { startOffsetDays: -1 / 24, endOffsetDays: 1 / 24 });
    await seedSponsor(id, { name: 'Live Sponsor', websiteUrl: 'https://livesponsor.example.com' });

    const res = await SELF.fetch(`https://t.test/events/${id}`);
    const html = await res.text();
    expect(html).toContain('data-testid="live-sponsor-strip"');
    expect(html).toContain('Live Sponsor');
  });

  test('live-sponsor-strip absent when no sponsors', async () => {
    const id = 'evt_ssp1_live_sponsor_no';
    await seedEvent(id, { startOffsetDays: -1 / 24, endOffsetDays: 1 / 24 });

    const res = await SELF.fetch(`https://t.test/events/${id}`);
    const html = await res.text();
    expect(html).toContain('data-testid="event-main-live"');
    expect(html).not.toContain('data-testid="live-sponsor-strip"');
  });

  test('live-sponsor-strip renders below the title and date, above the content', async () => {
    const id = 'evt_ssp1_live_sponsor_top';
    await seedEvent(id, { startOffsetDays: -1 / 24, endOffsetDays: 1 / 24 });
    await seedSponsor(id, { name: 'Live Top Sponsor', websiteUrl: 'https://livetop.example.com' });

    const html = await (await SELF.fetch(`https://t.test/events/${id}`)).text();
    const strip = html.indexOf('data-testid="live-sponsor-strip"');
    const title = html.indexOf('data-testid="event-title-live"');
    const where = html.indexOf('data-testid="event-where-live"');
    expect(strip, 'live sponsor strip must render').toBeGreaterThan(-1);
    expect(where, 'WHERE must render').toBeGreaterThan(-1);
    expect(strip, 'live sponsor strip follows the event title').toBeGreaterThan(title);
    expect(strip, 'live sponsor strip precedes the content and map').toBeLessThan(where);
  });
});

// ── Live-event 5W order (mirrors the pre-event order) ────────────────────────

describe('live-event section order (WHAT → WHERE → WHO → HOW MUCH → CTA → WHY → HOW)', () => {
  async function seedRichLive(id: string): Promise<void> {
    const now = Date.now();
    const start = new Date(now - 3600_000).toISOString();
    const end = new Date(now + 3600_000).toISOString();
    await tenv().DB.prepare(`DELETE FROM events WHERE id = ?`).bind(id).run();
    await tenv()
      .DB.prepare(
        `INSERT INTO events (id, brand_id, title, slug, status, location, start_date, end_date,
                             what_short, who_host, why_purpose, how_details, where_address,
                             price_cents, price_model, price_note, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', 'The Venue', ?, ?,
                 'What it is', 'The host', 'Why it matters', 'How to join', '1 Main St',
                 1000, 'fixed', NULL, datetime('now'), datetime('now'))`
      )
      .bind(id, BRAND, `Event ${id}`, id, start, end)
      .run();
  }

  test('the live section order matches pre-event — WHO before cost, CTA before WHY/HOW', async () => {
    const id = 'evt_ssp1_live_order';
    await seedRichLive(id);
    const html = await (await SELF.fetch(`https://t.test/events/${id}`)).text();
    const at = (t: string) => html.indexOf(`data-testid="${t}"`);

    expect(html).toContain('data-testid="event-main-live"');
    for (const t of [
      'event-what-live',
      'event-where-live',
      'event-who-live',
      'event-how-much-live',
      'event-checkin',
      'event-why-live',
      'event-how-live',
    ]) {
      expect(at(t), `${t} must render`).toBeGreaterThan(-1);
    }
    // WHAT → WHERE → WHO → HOW MUCH → CTA(checkin) → WHY → HOW
    expect(at('event-what-live'), 'WHAT leads').toBeLessThan(at('event-where-live'));
    expect(at('event-where-live'), 'WHERE before WHO').toBeLessThan(at('event-who-live'));
    expect(at('event-who-live'), 'WHO before HOW MUCH').toBeLessThan(at('event-how-much-live'));
    expect(at('event-how-much-live'), 'HOW MUCH before the CTA').toBeLessThan(at('event-checkin'));
    expect(at('event-checkin'), 'the CTA precedes WHY/HOW').toBeLessThan(at('event-why-live'));
    expect(at('event-why-live'), 'WHY before HOW').toBeLessThan(at('event-how-live'));
  });
});

// ── Post-event phase ──────────────────────────────────────────────────────────

describe('OSE-ssp1: post-event stats card and sponsor thank-you', () => {
  test('event-stats-card renders when check-in count > 0', async () => {
    const id = 'evt_ssp1_post_stats_yes';
    await seedEvent(id, { startOffsetDays: -7, endOffsetDays: -6 });
    await seedCheckinCount(id, 15);

    const res = await SELF.fetch(`https://t.test/events/${id}`);
    const html = await res.text();
    expect(html).toContain('data-testid="event-main-post"');
    expect(html).toContain('data-testid="event-stats-card"');
    expect(html).toContain('data-testid="stat-checkins"');
    expect(html).toContain('15');
    expect(html).toContain('Checked in');
  });

  // D1 (CCR 2026-09-14): the public recap is unauthenticated and must not leak an
  // exact SUB-K count the admin tile + SharedReport hide (OSE-665 uniform floor).
  // This case previously seeded 2 reg / 1 checkin and asserted the exact numbers
  // + the "% showed up" ratio RENDER — it locked the leak in. It now asserts the
  // floor: sub-K cohorts read "Fewer than 5", the exact number never appears, and
  // the ratio (which over a sub-K denominator back-derives a person) is suppressed.
  test('event-stats-card floors SUB-K counts and suppresses the sub-K ratio', async () => {
    const id = 'evt_ssp1_post_stats_subk';
    await seedEvent(id, { startOffsetDays: -7, endOffsetDays: -6 });
    await seedRegistration(id, { id: 'reg_subk_a', expiresAt: null });
    await seedRegistration(id, { id: 'reg_subk_b', expiresAt: null });
    await seedCheckinCount(id, 1);
    await seedSurvey(id, 'surv_subk_a');
    await seedEmailSignup(id, 'email_subk_a');

    const res = await SELF.fetch(`https://t.test/events/${id}`);
    const html = await res.text();
    // The card + its lines still render (there WAS activity) — but floored.
    expect(html).toContain('data-testid="event-stats-card"');
    expect(html).toContain('data-testid="stat-checkins"');
    expect(html).toContain('data-testid="stat-registrations"');
    expect(html).toContain('Fewer than 5 Registered');
    expect(html).toContain('Fewer than 5 Checked in');
    // The exact sub-K values must NOT appear as the rendered stat.
    expect(html).not.toContain('<strong>2</strong> Registered');
    expect(html).not.toContain('<strong>1</strong> Checked in');
    // Ratio over a sub-K denominator (50% of 2) is the de-anon vector — suppressed.
    expect(html).not.toContain('data-testid="stat-showed-up-share"');
    expect(html).not.toMatch(/% of those registered showed up/);
  });

  test('event-stats-card renders EXACT counts + ratio once every operand clears the floor', async () => {
    const id = 'evt_ssp1_post_stats_abovefloor';
    await seedEvent(id, { startOffsetDays: -7, endOffsetDays: -6 });
    for (let i = 0; i < 10; i++) await seedRegistration(id, { id: `reg_af_${i}`, expiresAt: null });
    await seedCheckinCount(id, 7);
    for (let i = 0; i < 6; i++) await seedSurvey(id, `surv_af_${i}`);
    for (let i = 0; i < 5; i++) await seedEmailSignup(id, `email_af_${i}`);

    const res = await SELF.fetch(`https://t.test/events/${id}`);
    const html = await res.text();
    expect(html).toContain('<strong>7</strong> Checked in');
    expect(html).toContain('<strong>10</strong> Registered');
    expect(html).toContain('data-testid="stat-showed-up-share"');
    expect(html).toContain('70% of those registered showed up'); // 7/10
    expect(html).toContain('<strong>6</strong> Surveys submitted');
    expect(html).toContain('<strong>5</strong> Email signups');
    // OSE-1201: the ratio never wears the banned word.
    expect(html).not.toMatch(/attendance/i);
    expect(html).not.toContain('Fewer than 5');
  });

  test('showed-up share shown only when both registrations and checkins > 0', async () => {
    const id = 'evt_ssp1_post_rate_gate';
    await seedEvent(id, { startOffsetDays: -7, endOffsetDays: -6 });
    // Only checkins, no registrations → no showed-up share
    await seedCheckinCount(id, 5);

    const res = await SELF.fetch(`https://t.test/events/${id}`);
    const html = await res.text();
    expect(html).toContain('data-testid="stat-checkins"');
    expect(html).not.toContain('data-testid="stat-showed-up-share"');
  });

  test('event-stats-card absent when all counts are zero', async () => {
    const id = 'evt_ssp1_post_stats_zero';
    await seedEvent(id, { startOffsetDays: -7, endOffsetDays: -6 });

    const res = await SELF.fetch(`https://t.test/events/${id}`);
    const html = await res.text();
    expect(html).toContain('data-testid="event-main-post"');
    expect(html).not.toContain('data-testid="event-stats-card"');
  });

  test('post-sponsor-thanks renders when active sponsors exist', async () => {
    const id = 'evt_ssp1_post_sponsor_yes';
    await seedEvent(id, { startOffsetDays: -7, endOffsetDays: -6 });
    await seedSponsor(id, {
      name: 'Post Sponsor',
      websiteUrl: 'https://postsponsor.example.com',
    });

    const res = await SELF.fetch(`https://t.test/events/${id}`);
    const html = await res.text();
    expect(html).toContain('data-testid="post-sponsor-thanks"');
    expect(html).toContain('Post Sponsor');
    expect(html).toContain('Thanks to our sponsors');
  });

  test('post-sponsor-thanks renders below the title and date, above the recap', async () => {
    const id = 'evt_ssp1_post_sponsor_top';
    await seedEvent(id, { startOffsetDays: -7, endOffsetDays: -6 });
    await seedSponsor(id, { name: 'Top Sponsor', websiteUrl: 'https://top.example.com' });

    const html = await (await SELF.fetch(`https://t.test/events/${id}`)).text();
    const thanks = html.indexOf('data-testid="post-sponsor-thanks"');
    const when = html.indexOf('data-testid="event-when-post"');
    const recap = html.indexOf('data-testid="recap-primary"');
    expect(thanks, 'sponsor thanks must render').toBeGreaterThan(-1);
    expect(recap, 'the recap must render').toBeGreaterThan(-1);
    expect(thanks, 'sponsor thanks follows the title and date').toBeGreaterThan(when);
    expect(thanks, 'sponsor thanks precedes the recap').toBeLessThan(recap);
  });

  test('post-sponsor-thanks absent when no sponsors', async () => {
    const id = 'evt_ssp1_post_sponsor_no';
    await seedEvent(id, { startOffsetDays: -7, endOffsetDays: -6 });

    const res = await SELF.fetch(`https://t.test/events/${id}`);
    const html = await res.text();
    expect(html).toContain('data-testid="event-main-post"');
    expect(html).not.toContain('data-testid="post-sponsor-thanks"');
  });
});

// ── Anonymity invariant ───────────────────────────────────────────────────────

describe('OSE-ssp1: new UI elements preserve anonymity invariant', () => {
  test('registration PII columns never appear in rendered HTML', async () => {
    const id = 'evt_ssp1_anon_guard';
    await seedEvent(id, { startOffsetDays: 7, endOffsetDays: 8 });
    await seedRegistration(id, { id: 'reg_anon_a', expiresAt: null });

    const res = await SELF.fetch(`https://t.test/events/${id}`);
    const html = await res.text();
    // These PII column values are in the table but must never surface in HTML
    expect(html).not.toContain('attendee_name');
    expect(html).not.toContain('attendee_email_hash');
    expect(html).not.toContain('source_placement_id');
    // The anonymity affordance must still be present
    expect(html).toContain('data-testid="anonymity-affordance"');
  });

  test('email signup PII columns never appear in rendered HTML', async () => {
    const id = 'evt_ssp1_anon_email';
    await seedEvent(id, { startOffsetDays: -7, endOffsetDays: -6 });
    await seedEmailSignup(id, 'email_anon_a');
    await seedCheckinCount(id, 3);

    const res = await SELF.fetch(`https://t.test/events/${id}`);
    const html = await res.text();
    expect(html).not.toContain('hash_abc');
    expect(html).not.toContain('enc_abc');
    expect(html).toContain('data-testid="event-main-post"');
  });
});
