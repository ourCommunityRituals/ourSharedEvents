/**
 * TDD red layer: front-end wave stories, written before the work (OSE-1560, 1519,
 * 1520, 1518, 1522).
 *
 * Each `redStory` is a test for a story that is still open. It must fail on its
 * own tagged assertion; when the story lands it flips to "promote me" and the
 * wrapper comes off. See helpers/red-story.ts and docs/ops/TDD-RED-MAP.md for the
 * story → flow → level map.
 *
 * The plain `it` blocks beside them are guards: behaviour that is correct today and
 * must survive the fix (the generic 404 for an unknown id, a title-only draft).
 *
 * Level: W (workers pool, real D1, real routes through SELF). Browser-level
 * expectations for the same stories are in tests/playwright/tdd-red-fe-wave.spec.ts.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { redStory } from './helpers/red-story';
import { seedSplitSponsor } from './helpers/seed-sponsor';

const E = env as unknown as Record<string, string> & { DB: D1Database };
const BEARER = { Authorization: 'Bearer test-admin-key-e2e-2026' };
const BRAND = 'root';

beforeAll(async () => {
  for (const stmt of JSON.parse(E.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await E.DB.prepare(stmt).run();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes('duplicate column name') || m.includes('already exists')) continue;
      throw e;
    }
  }
});

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function seedEvent(id: string, status: string, title = `Event ${id}`): Promise<void> {
  await E.DB.prepare(
    `INSERT OR REPLACE INTO events (id, brand_id, title, slug, status, is_published, start_date,
            what_short, who_host, where_address, location, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, 'A weekly game night', 'The Host', '1 Main St', 'The Venue',
             datetime('now'), datetime('now'))`
  )
    .bind(id, BRAND, title, id, status, inDays(3))
    .run();
}

async function createDraft(title: string): Promise<string> {
  const res = await SELF.fetch('https://localhost/api/v2/admin/events', {
    method: 'POST',
    headers: { ...BEARER, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  expect(res.status, 'creating a title-only draft must work').toBe(201);
  const body = (await res.json()) as { id?: string; item?: { id?: string } };
  const id = body.item?.id ?? body.id;
  expect(id, 'create response carries the new id').toBeTruthy();
  return id as string;
}

async function pageText(
  path: string,
  init?: RequestInit
): Promise<{ status: number; html: string }> {
  const res = await SELF.fetch(`https://localhost${path}`, init);
  return { status: res.status, html: await res.text() };
}

describe('OSE-1560 core values at publish; map defaults to off', () => {
  it('guard: a draft still needs only a title', async () => {
    await createDraft('Title only');
  });

  it('a new event is off the map unless someone turns it on', async () => {
    const id = await createDraft('Bare API event');
    const row = await E.DB.prepare('SELECT is_published FROM events WHERE id = ?')
      .bind(id)
      .first<{ is_published: number }>();
    expect(row?.is_published, 'a new event starts off the map').toBe(0);
  });

  // Still open: the heads-up is a toast (neutral, polite, no focus, 10 s with
  // "Turn off", paused on hover and focus). The component is OSE-1564 (hub
  // @ocr/ui); until it lands, the same words show as plain persistent text in
  // the admin status panel and the create message, which is not the toast.
  // OSE-1560 is closed; the toast was carried to OSE-1644, so that is the story
  // this red test now belongs to.
  redStory('OSE-1644', 'the map heads-up shows as a toast with a Turn off action', async () => {
    const files = JSON.parse(E.TEST_SOURCE_FILES_JSON) as Record<string, string>;
    const key = Object.keys(files).find((k) => k.endsWith('templates/admin.html'));
    const admin = key ? files[key]! : '';
    expect(admin.length, 'admin.html is readable in the test pool').toBeGreaterThan(1000);
    expect(admin, '[OSE-1644] the heads-up is a toast').toContain('data-testid="map-toast"');
  });

  it('leaving draft without a time and an event type is refused by name', async () => {
    const id = await createDraft('No time, no type');
    const res = await SELF.fetch(`https://localhost/api/v2/admin/events/${id}`, {
      method: 'PUT',
      headers: { ...BEARER, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'ready' }),
    });
    expect(res.status, '[OSE-1560] leaving draft with core values missing is a 409').toBe(409);
    const body = (await res.json()) as { code?: string; missing?: string[] };
    expect(body.code, '[OSE-1560] the refusal is CORE_VALUES_MISSING').toBe('CORE_VALUES_MISSING');
    expect(body.missing, '[OSE-1560] it lists what is missing').toEqual(
      expect.arrayContaining(['time', 'event_type'])
    );
  });

  it('verify-qr is the same door: a draft is refused', async () => {
    const id = await createDraft('Verify door');
    const res = await SELF.fetch(`https://localhost/api/v2/admin/events/${id}/verify-qr`, {
      method: 'POST',
      headers: BEARER,
    });
    expect(res.status).toBe(409);
  });

  it('one PUT may supply the time and the type and move on', async () => {
    const id = await createDraft('Supply and go');
    const type = await E.DB.prepare('SELECT id FROM event_type_registry LIMIT 1').first<{
      id: string;
    }>();
    const res = await SELF.fetch(`https://localhost/api/v2/admin/events/${id}`, {
      method: 'PUT',
      headers: { ...BEARER, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'ready',
        start_date: '2027-05-01',
        start_time: '18:00',
        timezone: 'America/Chicago',
        event_type_id: type?.id,
      }),
    });
    expect(res.status).toBe(200);
  });

  it('a title-only draft can still be archived without the values', async () => {
    const id = await createDraft('Archive a draft');
    const res = await SELF.fetch(`https://localhost/api/v2/admin/events/${id}`, {
      method: 'PUT',
      headers: { ...BEARER, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'archived' }),
    });
    expect(res.status).not.toBe(409);
  });

  it('a type without a start time is refused as time only', async () => {
    const id = await createDraft('Type but no time');
    const type = await E.DB.prepare('SELECT id FROM event_type_registry LIMIT 1').first<{
      id: string;
    }>();
    const res = await SELF.fetch(`https://localhost/api/v2/admin/events/${id}`, {
      method: 'PUT',
      headers: { ...BEARER, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'ready', event_type_id: type?.id }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { missing?: string[] };
    expect(body.missing).toEqual(['time']);
  });
});

describe('OSE-1519 a scanned code for a non-public event names the page', () => {
  it('guard: an unknown id keeps the generic not-found page', async () => {
    const { status, html } = await pageText('/events/no-such-event-1519');
    expect(status).toBe(404);
    expect(html).toContain('We couldn&#39;t find that event');
  });

  it('guard (privacy, decision open in the story): a draft is not named to an anonymous visitor', async () => {
    await seedEvent('evt_1519_draft', 'draft', 'Secret Draft Gala');
    const { html } = await pageText('/events/evt_1519_draft');
    expect(
      html,
      'a draft must not leak its title until the PO decides what may be shown'
    ).not.toContain('Secret Draft Gala');
  });

  async function seedArchived(id: string, title: string, listedFrom: string | null) {
    await seedEvent(id, 'archived', title);
    await E.DB.prepare('UPDATE events SET is_published = 0, listed_from = ? WHERE id = ?')
      .bind(listedFrom, id)
      .run();
  }

  it('an archived event that was once live says it has ended, with no ERROR 404 label', async () => {
    await seedArchived('evt_1519_archived', 'Finished Bocce Night', '2026-09-01T00:00:00Z');
    const { status, html } = await pageText('/events/evt_1519_archived');
    expect(status, '[OSE-1519] a known, ended event is gone, not "not found"').toBe(410);
    expect(html, '[OSE-1519] names the event').toContain('Finished Bocce Night');
    expect(html, '[OSE-1519] names the event as ended').toMatch(/has ended/i);
    expect(html, '[OSE-1519] no error-code label on a known event').not.toMatch(/error 4\d\d/i);
  });

  it('guard (privacy): an archived event that was never live is not named', async () => {
    await seedArchived('evt_1519_never_live', 'Never Live Gala', null);
    const { status, html } = await pageText('/events/evt_1519_never_live');
    expect(status).toBe(404);
    expect(html).not.toContain('Never Live Gala');
  });

  it('an ended event lists the next events at its venue', async () => {
    await seedArchived('evt_1519_venue', 'Old Bocce Night', '2026-09-01T00:00:00Z');
    await seedEvent('evt_1519_next', 'active', 'Next Bocce Night');
    const { html } = await pageText('/events/evt_1519_venue');
    expect(html, '[OSE-1519] next event at the same venue').toContain('Next Bocce Night');
  });
});

describe('OSE-1520 one events surface', () => {
  it('/public redirects to /events (one address), keeping the query', async () => {
    const res = await SELF.fetch('https://localhost/public?when=week', { redirect: 'manual' });
    expect(res.status, '[OSE-1520] /public redirects').toBeGreaterThanOrEqual(300);
    expect(res.headers.get('location') ?? '', '[OSE-1520] to /events').toMatch(
      /\/events\?when=week$/
    );
  });

  it('the /events tab title says what the page is', async () => {
    const { html } = await pageText('/events');
    const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? '';
    expect(title, '[OSE-1520] not just the product name').not.toBe('OurSharedEvents');
  });
});

describe('OSE-1518 event page: trust header and plain choices', () => {
  it('a live event page carries the trust header, with the host', async () => {
    await seedEvent('evt_1518_live', 'active', 'Trusted Night');
    const { html } = await pageText('/events/evt_1518_live');
    expect(html, '[OSE-1518] says no account is needed').toContain('No account needed to view');
    expect(html, '[OSE-1518] says the link is verified').toContain('Verified event link');
    expect(html, '[OSE-1518] names the host').toContain('Hosted by The Host');
  });

  it('the trust header is on the page while the event is on now, too', async () => {
    await seedEvent('evt_1518_now', 'active', 'Trusted Now');
    await E.DB.prepare('UPDATE events SET start_date = ?, end_date = ? WHERE id = ?')
      .bind(inDays(-1), inDays(1), 'evt_1518_now')
      .run();
    const { html } = await pageText('/events/evt_1518_now');
    expect(html, 'the live render is the one under test').toContain('event-title-live');
    expect(html, '[OSE-1518] live render carries it').toContain('Verified event link');
  });
});

describe('OSE-1522 a consented sponsor shows wherever the title shows', () => {
  it('the /events card shows the sponsor by the title', async () => {
    await seedEvent('evt_1522_card', 'active', 'Sponsored Card Night');
    await seedSplitSponsor(E.DB, {
      id: 'sp_1522_card',
      eventId: 'evt_1522_card',
      name: 'Card Sponsor 1522',
      brandId: BRAND,
    });
    const { html } = await pageText('/events');
    expect(html, 'the event itself is listed').toContain('Sponsored Card Night');
    expect(html, '[OSE-1522] the consented sponsor shows on the card').toContain(
      'Card Sponsor 1522'
    );
  });

  it('a sponsor that has not said yes (ADR-019) is not on the card', async () => {
    await seedEvent('evt_1522_pending', 'active', 'Pending Sponsor Night');
    await seedSplitSponsor(E.DB, {
      id: 'sp_1522_pending',
      eventId: 'evt_1522_pending',
      name: 'Pending Sponsor 1522',
      brandId: BRAND,
      sponsorAccepted: 0,
    });
    const { html } = await pageText('/events');
    expect(html).toContain('Pending Sponsor Night');
    expect(html, '[OSE-1522] silence is not consent').not.toContain('Pending Sponsor 1522');
  });

  it('the card shows the sponsor display name, not the business name', async () => {
    await seedEvent('evt_1522_title', 'active', 'Titled Sponsor Night');
    await seedSplitSponsor(E.DB, {
      id: 'sp_1522_title',
      eventId: 'evt_1522_title',
      name: 'Legal Name 1522 LLC',
      brandId: BRAND,
    });
    await E.DB.prepare(
      "UPDATE sponsor_business SET display_name = 'Friendly Title 1522' WHERE id = ?"
    )
      .bind('sp_1522_title')
      .run();
    const { html } = await pageText('/events');
    expect(html, '[OSE-1522] display name shows').toContain('Friendly Title 1522');
    expect(html, 'the legal name does not').not.toContain('Legal Name 1522 LLC');
  });
});
