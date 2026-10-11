/**
 * OSE-298 — /events/:id mobile workability (DRAIN 5/7 of OSE-292).
 *
 * Layer: API (vitest inspects the rendered public-event HTML for the
 * defensive horizontal-scroll guard; the actual viewport-rendered
 * behavior is verified by the Playwright `mobile-workability.spec.ts`
 * audit running against staging at 375x812).
 *
 * Diagnosis: the mobile-workability audit reported "primary CTA
 * selector matched 0 elements" against /events/evt_test_2026 on
 * staging. Root cause was the audit's CTA selector listed
 * `[data-testid="rsvp-cta"]` / `[data-testid="register-cta"]`, but
 * the codebase actually renders `data-testid="event-rsvp"` and
 * `data-testid="event-checkin"`. The audit selector was widened in
 * the same PR.
 *
 * The page itself was clean (max-width:720px body, width:100%
 * venue map, no tables). To make the surface resilient against
 * future content (long sponsor URLs in the 5W fields, embedded
 * iframes, etc.) we add a defensive horizontal-scroll guard:
 *   - html, body { overflow-x: hidden; }
 *   - body { overflow-wrap: anywhere; word-break: break-word; }
 *   - .ose-venue-map { max-width: 100%; }
 *   - .ose-choice-btn { min-height: 44px; } (OSE-1518: register, check-in and Back share it)
 *     (touch-target floor, invariant 14)
 *
 * The defensive rules are deliberately applied at the html/body
 * level so they cover all future descendants without us having to
 * touch every new component.
 *
 * Per OCR_STANDARD_perStoryTestPyramid: names follow
 *   `OSE-298 | API | GET <path> (<condition>) | <assertion>`.
 *
 * We seed an event row directly via the test D1 binding so the
 * handler renders the live pre_event / event variant rather than
 * the 404 branded error page.
 */

import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';

interface TestEnv {
  TEST_MIGRATION_STATEMENTS: string;
  DB: D1Database;
}

const PRE_EVENT_ID = 'evt_drain5_pre';
const LIVE_EVENT_ID = 'evt_drain5_live';

beforeAll(async () => {
  const tenv = env as unknown as TestEnv;
  const stmts = JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[];
  for (const stmt of stmts) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('duplicate column name') && !msg.includes('already exists')) throw e;
    }
  }
  // Pre-event row: starts in the future so phase = pre_event and
  // renderPreEventHtml fires.
  const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await tenv.DB.prepare(
    `INSERT OR REPLACE INTO events (id, brand_id, title, slug, status,
       description, location, start_date, end_date, timezone,
       what_short, who_host, why_purpose, how_details, where_address)
     VALUES (?, 'brand_test', 'Drain 5 Pre Event', 'drain-5-pre', 'active',
       'desc', '100 Main St', ?, ?, 'America/Chicago',
       'short what', 'Test Host', 'Test purpose', 'Test how', '100 Main St')`
  )
    .bind(PRE_EVENT_ID, future, future)
    .run();
  // Live event: started 1h ago, ends 1h from now → phase = event.
  const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await tenv.DB.prepare(
    `INSERT OR REPLACE INTO events (id, brand_id, title, slug, status,
       description, location, start_date, end_date, timezone,
       what_short, who_host, why_purpose, how_details, where_address)
     VALUES (?, 'brand_test', 'Drain 5 Live Event', 'drain-5-live', 'active',
       'desc', '100 Main St', ?, ?, 'America/Chicago',
       'short what', 'Test Host', 'Test purpose', 'Test how', '100 Main St')`
  )
    .bind(LIVE_EVENT_ID, past, soon)
    .run();
});

async function fetchEventHtml(eventId: string): Promise<string> {
  const res = await SELF.fetch(`https://test.local/events/${eventId}`);
  expect(res.status).toBe(200);
  return res.text();
}

describe('OSE-298 public event page mobile workability — API layer', () => {
  test('OSE-298 | API | GET /events/:id (pre_event) | html+body have overflow-x:hidden defensive guard', async () => {
    const html = await fetchEventHtml(PRE_EVENT_ID);
    expect(html).toMatch(/html,\s*body\s*\{[^}]*overflow-x:\s*hidden/);
  });

  test('OSE-298 | API | GET /events/:id (pre_event) | body has overflow-wrap:anywhere so long strings wrap', async () => {
    const html = await fetchEventHtml(PRE_EVENT_ID);
    // Match either the dedicated body rule or the consolidated one —
    // overflow-wrap:anywhere is the load-bearing assertion regardless
    // of which selector carries it.
    expect(html).toMatch(/body\s*\{[^}]*overflow-wrap:\s*anywhere/);
    expect(html).toMatch(/body\s*\{[^}]*word-break:\s*break-word/);
  });

  test('OSE-298 | API | GET /events/:id (pre_event) | venue map img caps at max-width:100%', async () => {
    const html = await fetchEventHtml(PRE_EVENT_ID);
    // Prevents the explicit width="600" attribute on the venue-map img
    // from pushing the body wide on a 375px screen.
    expect(html).toMatch(/\.ose-venue-map\s*\{[^}]*max-width:\s*100%/);
  });

  test('OSE-298 | API | GET /events/:id (pre_event) | RSVP CTA hits the 44px touch-target floor', async () => {
    const html = await fetchEventHtml(PRE_EVENT_ID);
    expect(html).toMatch(/\.ose-choice-btn\s*\{[^}]*min-height:\s*44px/);
  });

  test('OSE-298 | API | GET /events/:id (event live) | html+body have overflow-x:hidden defensive guard', async () => {
    const html = await fetchEventHtml(LIVE_EVENT_ID);
    expect(html).toMatch(/html,\s*body\s*\{[^}]*overflow-x:\s*hidden/);
  });

  test('OSE-298 | API | GET /events/:id (event live) | check-in CTA hits the 44px touch-target floor', async () => {
    const html = await fetchEventHtml(LIVE_EVENT_ID);
    expect(html).toMatch(/\.ose-choice-btn\s*\{[^}]*min-height:\s*44px/);
  });
});
