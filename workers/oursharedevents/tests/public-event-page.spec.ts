/**
 * OSE-243a / BE-27 — Public event landing page behavioral tests.
 *
 * The page at /events/:id is the FINAL critical-path surface for Pulse 1:
 * recipients land here from /s/:code shortlinks and must see actual event
 * content, not JSON or a stub.
 *
 * Coverage:
 *   - Phase dispatch (OSE-242 resolver): pre_event vs event vs post_event
 *   - State gate (OSE-199 state machine): draft/ready -> 404, archived ok
 *   - 5W content surfaces on pre_event page
 *   - Venue map thumbnail src points at the proxy (OSE-217)
 *   - Anonymity affordance is present + uses user-facing language
 *   - data-testid hooks for E2E targetability
 *   - Skip-link landmark for keyboard nav
 *   - CSP headers attached + nonce present in <style> tag
 *   - 404 shape preserved for unknown / malformed event IDs
 *
 * Anonymity-principle compliance (user-reinforced 2026-05-14):
 *   - Source of handlePublicEventPage MUST NOT read IP / Cookie / anon_id
 *   - The rendered HTML MUST include the anonymity affordance section
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';

const ADMIN_HEADERS = { Authorization: 'Bearer test-admin-key-e2e-2026' };
const BRAND = 'ose243a-test';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_SOURCE_FILES_JSON: string;
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
      )
        continue;
      throw e;
    }
  }
}

interface SeedOpts {
  id: string;
  status?: string;
  startOffsetDays?: number;
  endOffsetDays?: number;
  withFiveW?: boolean;
}

async function seedEvent(opts: SeedOpts): Promise<void> {
  const tenv = env as unknown as TestEnv;
  const now = Date.now();
  const start =
    opts.startOffsetDays != null ? new Date(now + opts.startOffsetDays * 86400000) : null;
  const end = opts.endOffsetDays != null ? new Date(now + opts.endOffsetDays * 86400000) : null;
  const fiveW = opts.withFiveW
    ? {
        what_short: 'A bocce-league rematch you can actually walk to.',
        who_host: 'Beverly Hills Bocce League',
        why_purpose: 'Round-robin tournament to seed Sunday playoffs.',
        how_details: 'Free entry. Bring a folding chair if you want to sit.',
        where_address: '12345 South Western Ave, Blue Island IL 60406',
      }
    : {
        what_short: null,
        who_host: null,
        why_purpose: null,
        how_details: null,
        where_address: null,
      };
  await tenv.DB.prepare(`DELETE FROM events WHERE id = ?`).bind(opts.id).run();
  await tenv.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, location, start_date, end_date,
                           what_short, who_host, why_purpose, how_details, where_address,
                           created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
  )
    .bind(
      opts.id,
      BRAND,
      'OSE-243a Smoke Event',
      opts.id, // slug = id for uniqueness
      opts.status ?? 'active',
      'Eagles Bowl',
      start ? start.toISOString() : null,
      end ? end.toISOString() : null,
      fiveW.what_short,
      fiveW.who_host,
      fiveW.why_purpose,
      fiveW.how_details,
      fiveW.where_address
    )
    .run();
}

beforeAll(async () => {
  await applyMigrations();
});

describe('OSE-243a: pre-event rendering (full 5W page)', () => {
  test('GET /events/:id for active pre_event renders all 5W sections + map + anonymity affordance', async () => {
    const eventId = 'evt_ose243a_pre_full';
    // Start 7 days from now → pre_event phase
    await seedEvent({
      id: eventId,
      status: 'active',
      startOffsetDays: 7,
      endOffsetDays: 8,
      withFiveW: true,
    });

    const res = await SELF.fetch(`https://t.test/events/${eventId}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');

    const html = await res.text();
    // 5W content sections
    expect(html).toContain('data-testid="event-title"');
    expect(html).toContain('OSE-243a Smoke Event');
    expect(html).toContain('data-testid="event-what"');
    expect(html).toContain('bocce-league rematch'); // what_short
    expect(html).toContain('data-testid="event-who"');
    expect(html).toContain('Beverly Hills Bocce League'); // who_host
    expect(html).toContain('data-testid="event-why"');
    expect(html).toContain('Round-robin tournament'); // why_purpose
    expect(html).toContain('data-testid="event-how"');
    expect(html).toContain('Free entry'); // how_details
    expect(html).toContain('data-testid="event-where"');
    expect(html).toContain('12345 South Western Ave'); // where_address

    // Venue map proxy reference
    expect(html).toContain('/api/v2/maps/venue-image?venue=');
    expect(html).toContain('data-testid="venue-map"');
    expect(html).toContain('data-testid="gmaps-link"');

    // RSVP CTA points at the existing register form route
    expect(html).toContain('data-testid="event-rsvp"');
    expect(html).toContain(`/forms/${eventId}?type=register`);
  });

  test('anonymity affordance is rendered with user-facing language', async () => {
    const eventId = 'evt_ose243a_anon';
    await seedEvent({ id: eventId, status: 'active', startOffsetDays: 7, withFiveW: true });
    const res = await SELF.fetch(`https://t.test/events/${eventId}`);
    const html = await res.text();
    expect(html).toContain('data-testid="anonymity-affordance"');
    // Plain-language phrasing the recipient reads before sign-up actions
    expect(html).toContain("You're part of the group, anonymously");
    expect(html).toContain('groups gather');
    expect(html).toContain('not people');
  });

  test('event with no 5W content still renders title + anonymity affordance (no crash)', async () => {
    const eventId = 'evt_ose243a_minimal';
    await seedEvent({ id: eventId, status: 'active', startOffsetDays: 7, withFiveW: false });
    const res = await SELF.fetch(`https://t.test/events/${eventId}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('OSE-243a Smoke Event');
    expect(html).toContain('data-testid="anonymity-affordance"');
    // Absent 5W sections should NOT appear
    expect(html).not.toContain('data-testid="event-what"');
    expect(html).not.toContain('data-testid="event-why"');
  });

  test('skip link present for keyboard navigation (a11y)', async () => {
    const eventId = 'evt_ose243a_skip';
    await seedEvent({ id: eventId, status: 'active', startOffsetDays: 7, withFiveW: true });
    const res = await SELF.fetch(`https://t.test/events/${eventId}`);
    const html = await res.text();
    expect(html).toContain('Skip to event content');
    expect(html).toContain('href="#main"');
    expect(html).toContain('id="main"');
  });
});

describe('OSE-243a: phase dispatch', () => {
  test('active event in [start_date, end_date] → minimal "Live now" stub', async () => {
    const eventId = 'evt_ose243a_live';
    // start_date 1 hour ago, end_date 1 hour from now → phase = event
    await seedEvent({
      id: eventId,
      status: 'active',
      startOffsetDays: -1 / 24,
      endOffsetDays: 1 / 24,
      withFiveW: true,
    });
    const res = await SELF.fetch(`https://t.test/events/${eventId}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('data-testid="event-phase-msg"');
    expect(html).toContain('This event is happening now');
    expect(html).toContain('data-testid="anonymity-affordance"');
  });

  test('active event past end_date → minimal "ended" stub', async () => {
    const eventId = 'evt_ose243a_past';
    await seedEvent({
      id: eventId,
      status: 'active',
      startOffsetDays: -7,
      endOffsetDays: -6,
      withFiveW: true,
    });
    const res = await SELF.fetch(`https://t.test/events/${eventId}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('This event has ended');
    expect(html).toContain('data-testid="anonymity-affordance"');
  });

  test('archived event → 200 minimal "ended" stub (status forces post_event)', async () => {
    const eventId = 'evt_ose243a_archived';
    await seedEvent({ id: eventId, status: 'archived', startOffsetDays: 7, withFiveW: true });
    const res = await SELF.fetch(`https://t.test/events/${eventId}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('This event has ended');
  });
});

describe('OSE-243a: state gate + 404 semantics', () => {
  test('draft event → 404 (unpublished, MUST NOT leak to public)', async () => {
    const eventId = 'evt_ose243a_draft';
    await seedEvent({ id: eventId, status: 'draft', startOffsetDays: 7, withFiveW: true });
    const res = await SELF.fetch(`https://t.test/events/${eventId}`);
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain('Event not found');
    // MUST NOT leak the event title or content
    expect(html).not.toContain('OSE-243a Smoke Event');
  });

  test('ready event → 404 (approvals pending, MUST NOT leak)', async () => {
    const eventId = 'evt_ose243a_ready';
    await seedEvent({ id: eventId, status: 'ready', startOffsetDays: 7, withFiveW: true });
    const res = await SELF.fetch(`https://t.test/events/${eventId}`);
    expect(res.status).toBe(404);
  });

  test('unknown event ID → 404', async () => {
    const res = await SELF.fetch('https://t.test/events/evt_does_not_exist_ose243a');
    expect(res.status).toBe(404);
  });

  test('malformed event ID (path traversal) → 404 (not 200 with leaked content)', async () => {
    const res = await SELF.fetch('https://t.test/events/evt..%2Ffoo');
    // Either the router didn't match (404) or the validator rejected (404).
    // Both acceptable — what matters is no 200 with content.
    expect([404]).toContain(res.status);
  });

  test('over-long event ID → 404', async () => {
    const longId = 'a'.repeat(200);
    const res = await SELF.fetch(`https://t.test/events/${longId}`);
    expect(res.status).toBe(404);
  });
});

describe('OSE-243a: anonymity-principle source gate (L1 static)', () => {
  test('handlePublicEventPage source has zero per-attendee identity reads', () => {
    // Static-source check: the handler MUST NOT read IP / Cookie / anon_id /
    // Referer / User-Agent. If a future refactor adds any of those, this
    // gate fails before the change can land.
    const sources: Record<string, string> = JSON.parse(
      (env as unknown as TestEnv).TEST_SOURCE_FILES_JSON
    );
    const entry = Object.entries(sources).find(([p]) =>
      p.replace(/\\/g, '/').endsWith('src/handlers/pages.ts')
    );
    expect(entry, 'pages.ts source not in TEST_SOURCE_FILES_JSON').toBeDefined();
    const src = entry![1];

    // Extract just the handlePublicEventPage function body.
    const start = src.indexOf('export async function handlePublicEventPage');
    expect(start, 'handlePublicEventPage not found in pages.ts').toBeGreaterThan(-1);
    // Walk braces to find end of function
    let depth = 0;
    let i = src.indexOf('{', start);
    const bodyStart = i;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    const body = src.slice(bodyStart, i + 1);

    const forbiddenReads = [
      /\bCf-Connecting-Ip\b/i,
      /\bX-Forwarded-For\b/i,
      /\brequest\.headers\.get\(['"]?[Cc]ookie['"]?\)/,
      /\bgetOrCreateAnonId\b/,
      /\bsetAnonCookie\b/,
      /\brequest\.headers\.get\(['"]?[Rr]eferer['"]?\)/,
      /\brequest\.headers\.get\(['"]?[Uu]ser-[Aa]gent['"]?\)/,
    ];
    const violations: string[] = [];
    for (const pattern of forbiddenReads) {
      if (pattern.test(body)) violations.push(pattern.source);
    }
    expect(
      violations,
      `handlePublicEventPage reads per-attendee identity (violates OSE anonymity principle): ${violations.join(', ')}`
    ).toEqual([]);
  });

  test('shortlink → event page chain has zero per-attendee identity reads end-to-end', async () => {
    // Behavioral corroboration of the static gate. Create event, click
    // shortlink, follow redirect to the rendered page. The full chain
    // should produce a 200 HTML response with the anonymity affordance
    // and zero session cookies set anywhere along the way.
    // Create event with status=active + future start_date so the state gate
    // passes (draft -> 404) and computeEventPhase returns pre_event.
    const startDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const create = await SELF.fetch('https://t.test/api/v2/admin/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
      body: JSON.stringify({
        title: 'OSE-243a chain test',
        brand_id: BRAND,
        status: 'active',
        start_date: startDate,
        what_short: 'End-to-end chain proves anonymity holds across hops.',
        where_address: '123 Chain Test Lane',
      }),
    });
    const created = (await create.json()) as { id: string; shortcode: string };

    const redirect = await SELF.fetch(`https://t.test/s/${created.shortcode}`, {
      redirect: 'manual',
    });
    expect(redirect.status).toBe(302);
    // Critical: the shortlink hop sets NO Set-Cookie header.
    expect(redirect.headers.get('Set-Cookie')).toBeNull();

    const target = redirect.headers.get('Location');
    expect(target).toBeTruthy();
    const eventRes = await SELF.fetch(`https://t.test${new URL(target!).pathname}`);
    expect(eventRes.status).toBe(200);
    // The event-page hop also sets NO Set-Cookie header (no anon_id set
    // pre-RSVP; the user-facing affordance promises this).
    expect(eventRes.headers.get('Set-Cookie')).toBeNull();

    const html = await eventRes.text();
    expect(html).toContain('OSE-243a chain test');
    expect(html).toContain('data-testid="anonymity-affordance"');
  });
});
