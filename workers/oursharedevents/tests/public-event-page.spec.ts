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
  isPublished?: number;
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
    `INSERT INTO events (id, brand_id, title, slug, status, is_published, location, start_date, end_date,
                           what_short, who_host, why_purpose, how_details, where_address,
                           created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
  )
    .bind(
      opts.id,
      BRAND,
      'OSE-243a Smoke Event',
      opts.id, // slug = id for uniqueness
      opts.status ?? 'active',
      opts.isPublished ?? 1,
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
    expect(html).toContain('data-testid="geo-link"');

    // RSVP CTA points at the existing register form route
    expect(html).toContain('data-testid="event-rsvp"');
    expect(html).toContain(`/forms/${eventId}?type=register`);
  });

  test('OSE-1318: poster scan context lands on event page and CTA preserves form/deployment attribution', async () => {
    const eventId = 'evt_ose1318_poster_scan';
    await seedEvent({
      id: eventId,
      status: 'active',
      startOffsetDays: 7,
      endOffsetDays: 8,
      withFiveW: true,
    });

    const res = await SELF.fetch(
      `https://t.test/events/${eventId}?type=survey&deployment=pd_poster_1318`
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('data-testid="event-rsvp"');
    expect(html).toContain(`/forms/${eventId}?type=survey&amp;deployment=pd_poster_1318`);
    expect(html).toContain('Share feedback');
  });

  test('OSE-1318: invalid poster scan context falls back to register CTA without leaking deployment', async () => {
    const eventId = 'evt_ose1318_bad_context';
    await seedEvent({
      id: eventId,
      status: 'active',
      startOffsetDays: 7,
      endOffsetDays: 8,
      withFiveW: true,
    });

    const res = await SELF.fetch(
      `https://t.test/events/${eventId}?type=javascript:alert(1)&deployment=../bad`
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`/forms/${eventId}?type=register`);
    expect(html).not.toContain('javascript:alert');
    expect(html).not.toContain('../bad');
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
  test('active event in [start_date, end_date] → full event-live render (OSE-244a)', async () => {
    const eventId = 'evt_ose244a_live';
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
    // Full event-live render distinguishing markers
    expect(html).toContain('data-testid="event-main-live"');
    expect(html).toContain('data-testid="event-header-live"');
    expect(html).toContain('data-testid="event-title-live"');
    expect(html).toContain('data-testid="event-live-badge"');
    expect(html).toContain('Live now');
    // Check-in CTA points at forms surface with type=checkin
    expect(html).toContain('data-testid="event-checkin"');
    expect(html).toContain(`href="/forms/${eventId}?type=checkin"`);
    // 5W sections rendered with -live suffixed testids (distinct from pre_event)
    expect(html).toContain('data-testid="event-what-live"');
    expect(html).toContain('data-testid="event-where-live"');
    expect(html).toContain('data-testid="event-who-live"');
    expect(html).toContain('data-testid="event-why-live"');
    expect(html).toContain('data-testid="event-how-live"');
    // Wayfinding CTA distinct from pre_event (Navigate, not See on)
    expect(html).toContain('Navigate now');
    // Anonymity affordance must persist across all rendered phases
    expect(html).toContain('data-testid="anonymity-affordance"');
    // MUST NOT fall through to the minimal stub
    expect(html).not.toContain('data-testid="event-phase-msg"');
    expect(html).not.toContain('This event is happening now.');
  });

  test('active event past end_date → post-event recap render', async () => {
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
    // OSE-245: post_event now renders a full recap page (renderPostEventHtml),
    // not the old minimal stub. Check for the canonical post-event markers.
    expect(html).toContain('data-testid="event-main-post"');
    expect(html).toContain('data-testid="event-phase-chip"');
    expect(html).toContain('data-testid="anonymity-affordance"');
  });

  test('archived event → 200 post-event recap (status forces post_event)', async () => {
    const eventId = 'evt_ose243a_archived';
    await seedEvent({ id: eventId, status: 'archived', startOffsetDays: 7, withFiveW: true });
    const res = await SELF.fetch(`https://t.test/events/${eventId}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    // archived status → post_event phase → renderPostEventHtml
    expect(html).toContain('data-testid="event-main-post"');
    expect(html).toContain('data-testid="event-phase-chip"');
  });

  test('post-event: email CTA present — stay-connected card routes to /forms/:id?type=email', async () => {
    // OSE-454: email CTA harness test. The stay-connected card must always
    // appear in the post-event render with the correct forms route.
    const eventId = 'evt_ose454_email_cta';
    await seedEvent({
      id: eventId,
      status: 'active',
      startOffsetDays: -3,
      endOffsetDays: -2,
      withFiveW: true,
    });
    const res = await SELF.fetch(`https://t.test/events/${eventId}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('data-testid="stay-connected-card"');
    expect(html).toContain('data-testid="email-signup-link"');
    expect(html).toContain(`href="/forms/${eventId}?type=email"`);
  });

  test('post-event: return loop — next-event-card appears when future event at same location', async () => {
    // OSE-454: return loop harness test. When a future active event exists at
    // the same location, the post-event page renders next-event-card with a
    // link to that event — closing the ritual loop.
    // Uses a unique location ('OSE454 Harness Venue') so no other seeded
    // events in this spec interfere with the next-event query.
    const tenv = env as unknown as TestEnv;
    const db = tenv.DB;
    const pastId = 'evt_ose454_past_iso';
    const nextId = 'evt_ose454_next_iso';
    const venue = 'OSE454 Harness Venue';
    const now = new Date();
    const past = new Date(now.getTime() - 7 * 86400000).toISOString();
    const pastEnd = new Date(now.getTime() - 6 * 86400000).toISOString();
    const future = new Date(now.getTime() + 14 * 86400000).toISOString();
    const futureEnd = new Date(now.getTime() + 15 * 86400000).toISOString();
    await db.prepare('DELETE FROM events WHERE id IN (?, ?)').bind(pastId, nextId).run();
    await db
      .prepare(
        `INSERT INTO events (id, brand_id, title, slug, status, location, start_date, end_date, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', ?, ?, ?, datetime('now'), datetime('now'))`
      )
      .bind(pastId, BRAND, 'OSE-454 Past Event', pastId, venue, past, pastEnd)
      .run();
    await db
      .prepare(
        `INSERT INTO events (id, brand_id, title, slug, status, location, start_date, end_date, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', ?, ?, ?, datetime('now'), datetime('now'))`
      )
      .bind(nextId, BRAND, 'OSE-454 Next Event', nextId, venue, future, futureEnd)
      .run();

    const res = await SELF.fetch(`https://t.test/events/${pastId}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('data-testid="next-event-card"');
    expect(html).toContain('data-testid="next-event-link"');
    expect(html).toContain(`href="/events/${nextId}"`);
    expect(html).not.toContain('data-testid="next-event-fallback"');
  });
});

describe('OSE-243a: state gate + 404 semantics', () => {
  test('draft event → 404 (unpublished, MUST NOT leak to public)', async () => {
    const eventId = 'evt_ose243a_draft';
    await seedEvent({ id: eventId, status: 'draft', startOffsetDays: 7, withFiveW: true });
    const res = await SELF.fetch(`https://t.test/events/${eventId}`);
    expect(res.status).toBe(404);
    const html = await res.text();
    // OSE-R-004 (2026-05-15): the bare "<h1>Event not found</h1>" 1996-style
    // body was replaced by the branded renderErrorPage shell. The contract
    // tests for THIS shell live in tests/public-event-error-pages.spec.ts.
    // Here we only re-assert the security-critical invariants: 404 status
    // (above) + no event title / content leak (below).
    expect(html).toMatch(/data-testid="error-title"/);
    // MUST NOT leak the event title or content
    expect(html).not.toContain('OSE-243a Smoke Event');
  });

  test('ready event → 404 (approvals pending, MUST NOT leak)', async () => {
    const eventId = 'evt_ose243a_ready';
    await seedEvent({ id: eventId, status: 'ready', startOffsetDays: 7, withFiveW: true });
    const res = await SELF.fetch(`https://t.test/events/${eventId}`);
    expect(res.status).toBe(404);
  });

  test('active but unpublished event → 404 (admin-only draft parking, MUST NOT leak)', async () => {
    const eventId = 'evt_ose1354_unpublished';
    await seedEvent({
      id: eventId,
      status: 'active',
      isPublished: 0,
      startOffsetDays: 7,
      withFiveW: true,
    });
    const res = await SELF.fetch(`https://t.test/events/${eventId}`);
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toMatch(/data-testid="error-title"/);
    expect(html).not.toContain('OSE-243a Smoke Event');
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

describe('OSE-243a + OSE-263: anonymity-principle source gate (L1 static)', () => {
  // Helper — extracts the body of a named exported function (sync or async)
  // from a source blob via brace-walking. Returns null if not found.
  function extractFunctionBody(src: string, exportName: string): string | null {
    const patterns = [`export async function ${exportName}`, `export function ${exportName}`];
    let start = -1;
    for (const p of patterns) {
      const idx = src.indexOf(p);
      if (idx > -1) {
        start = idx;
        break;
      }
    }
    if (start < 0) return null;
    let depth = 0;
    let i = src.indexOf('{', start);
    if (i < 0) return null;
    const bodyStart = i;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    return src.slice(bodyStart, i + 1);
  }

  // Forbidden per-attendee identity reads. These MUST NOT appear in any
  // public-render handler in pages.ts. If a future refactor adds any of
  // these to a rendering handler, this gate fails the PR before it lands.
  //
  // Why these specific patterns:
  //   - CF-Connecting-IP / X-Forwarded-For: the network identifier
  //   - Cookie / anon_id: per-attendee session identifier
  //   - Referer: the previous URL (can re-identify attendee browsing pattern)
  //   - User-Agent: device fingerprinting input
  //
  // Exemptions explicitly OUT of this gate's scope (with rationale):
  //   - handleAdminPage: admin surface, CF Access JWT auth is legitimate
  //   - handleSubscribe: explicit email opt-in + peppered IP hash for rate
  //     limiting (OSE-207 / migration 0028); never stores raw IP
  //   - Any non-render utility (rate limiter, geocoder, etc.): out of scope
  const FORBIDDEN_READS: RegExp[] = [
    /\bCf-Connecting-Ip\b/i,
    /\bX-Forwarded-For\b/i,
    /\brequest\.headers\.get\(['"]?[Cc]ookie['"]?\)/,
    /\bgetOrCreateAnonId\b/,
    /\bsetAnonCookie\b/,
    /\brequest\.headers\.get\(['"]?[Rr]eferer['"]?\)/,
    /\brequest\.headers\.get\(['"]?[Uu]ser-[Aa]gent['"]?\)/,
  ];

  // The set of public-render handlers in pages.ts that MUST be anonymity-safe.
  // This is the OSE-263 widening of the original OSE-243a gate, which only
  // covered handlePublicEventPage. Adding a new public-render handler? It MUST
  // go in this list.
  const PUBLIC_RENDER_HANDLERS = [
    'handlePublicPage',
    'handlePublicEventPage',
    'handleLandingPage',
    'handleDisplayPage',
    'handlePosterPage',
    'handleSharedReportPage',
    // OSE-1355 — admin-authenticated draft preview uses the public pre-event
    // renderer. It is not public, but it is still an HTML render surface and
    // must not introduce per-attendee identity reads.
    'handleAdminEventPreviewPage',
    // R-001 (2026-05-15) — HTML sign-in page for unauth GET /admin. Public-
    // render because it's served to anonymous prospects; must be anonymity-safe.
    'handleAdminSignInPage',
  ];

  function loadPagesSource(): string {
    const sources: Record<string, string> = JSON.parse(
      (env as unknown as TestEnv).TEST_SOURCE_FILES_JSON
    );
    const entry = Object.entries(sources).find(([p]) =>
      p.replace(/\\/g, '/').endsWith('src/handlers/pages.ts')
    );
    expect(entry, 'pages.ts source not in TEST_SOURCE_FILES_JSON').toBeDefined();
    return entry![1];
  }

  // OSE-243a — preserved as the named anchor on handlePublicEventPage
  test('handlePublicEventPage source has zero per-attendee identity reads', () => {
    const body = extractFunctionBody(loadPagesSource(), 'handlePublicEventPage');
    expect(body, 'handlePublicEventPage not found in pages.ts').not.toBeNull();
    const violations: string[] = [];
    for (const pattern of FORBIDDEN_READS) {
      if (pattern.test(body!)) violations.push(pattern.source);
    }
    expect(
      violations,
      `handlePublicEventPage reads per-attendee identity (violates OSE anonymity principle): ${violations.join(', ')}`
    ).toEqual([]);
  });

  // OSE-263 — widens the gate to every public-render handler in pages.ts.
  // The set is the union of handlers that produce HTML responses for public
  // (non-admin, non-subscribe) consumption. handleAdminPage is exempt (admin
  // auth is legitimate). handleSubscribe is exempt (explicit email opt-in +
  // peppered IP hash for rate limit; OSE-207 compliance).
  test('all public-render handlers in pages.ts have zero per-attendee identity reads (OSE-263)', () => {
    const src = loadPagesSource();
    const perHandlerViolations: Record<string, string[]> = {};

    for (const fnName of PUBLIC_RENDER_HANDLERS) {
      const body = extractFunctionBody(src, fnName);
      expect(
        body,
        `${fnName} not found in pages.ts — gate must be updated when handlers are renamed or removed`
      ).not.toBeNull();
      const violations: string[] = [];
      for (const pattern of FORBIDDEN_READS) {
        if (pattern.test(body!)) violations.push(pattern.source);
      }
      if (violations.length > 0) {
        perHandlerViolations[fnName] = violations;
      }
    }

    expect(
      perHandlerViolations,
      `Public-render handlers reading per-attendee identity (violates OSE anonymity principle, ADR-001): ${JSON.stringify(perHandlerViolations, null, 2)}`
    ).toEqual({});
  });

  // OSE-263 — guard against silent regression: if a new public-render handler
  // is added to pages.ts and isn't in PUBLIC_RENDER_HANDLERS, the gate would
  // miss it. This test enumerates `export async function handle*Page` /
  // `export function handle*Page` in the source and asserts the gate covers
  // every one (minus the documented exemptions).
  test('PUBLIC_RENDER_HANDLERS list covers every public-render handler in pages.ts (no silent gaps)', () => {
    const src = loadPagesSource();
    // Match handler exports — both sync and async — with names matching
    // handle*Page. Excludes handleSubscribe (which doesn't end in Page) and
    // any helpers.
    const handlerRegex = /export (?:async )?function (handle\w*Page)\b/g;
    const found = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = handlerRegex.exec(src)) !== null) {
      found.add(m[1]);
    }

    // Exemptions: documented, must stay short and audited.
    const EXEMPT: Set<string> = new Set(['handleAdminPage']);

    const expectedInGate = [...found].filter((name) => !EXEMPT.has(name)).sort();
    const gateNames = [...PUBLIC_RENDER_HANDLERS].sort();

    expect(
      gateNames,
      `OSE-263 gate drift: PUBLIC_RENDER_HANDLERS does not match the handle*Page exports in pages.ts.\n  In source (non-exempt): ${expectedInGate.join(', ')}\n  In gate: ${gateNames.join(', ')}\n  → Add the missing handler to PUBLIC_RENDER_HANDLERS OR add a documented exemption (with rationale) above the EXEMPT set.`
    ).toEqual(expectedInGate);
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
