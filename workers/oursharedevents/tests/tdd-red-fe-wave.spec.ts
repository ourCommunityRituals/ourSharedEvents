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

  redStory('OSE-1560', 'a new event is off the map unless someone turns it on', async () => {
    const id = await createDraft('Bare API event');
    const row = await E.DB.prepare('SELECT is_published FROM events WHERE id = ?')
      .bind(id)
      .first<{ is_published: number }>();
    expect(row?.is_published, '[OSE-1560] a new event starts off the map').toBe(0);
  });

  redStory(
    'OSE-1560',
    'leaving draft without a time and an event type is refused by name',
    async () => {
      const id = await createDraft('No time, no type');
      const res = await SELF.fetch(`https://localhost/api/v2/admin/events/${id}`, {
        method: 'PUT',
        headers: { ...BEARER, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ready' }),
      });
      expect(res.status, '[OSE-1560] leaving draft with core values missing is a 409').toBe(409);
      const body = (await res.json()) as { code?: string; missing?: string[] };
      expect(body.code, '[OSE-1560] the refusal is CORE_VALUES_MISSING').toBe(
        'CORE_VALUES_MISSING'
      );
      expect(body.missing, '[OSE-1560] it lists what is missing').toEqual(
        expect.arrayContaining(['time', 'event_type'])
      );
    }
  );
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

  redStory('OSE-1519', 'an archived event says it has ended, with no ERROR 404 label', async () => {
    await seedEvent('evt_1519_archived', 'archived', 'Finished Bocce Night');
    const { html } = await pageText('/events/evt_1519_archived');
    expect(html, '[OSE-1519] names the event as ended').toMatch(/has ended/i);
    expect(html, '[OSE-1519] no error-code label on a known event').not.toMatch(/error 404/i);
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
  redStory('OSE-1518', 'a live event page carries the trust header', async () => {
    await seedEvent('evt_1518_live', 'active', 'Trusted Night');
    const { html } = await pageText('/events/evt_1518_live');
    expect(html, '[OSE-1518] says no account is needed').toContain('No account needed to view');
    expect(html, '[OSE-1518] says the link is verified').toContain('Verified event link');
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
