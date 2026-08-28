/**
 * OSE-291 (EPIC OSE-284 QR Integrity) — "a poster must never rot."
 *
 * A printed poster / shared QR shortlink can outlive the event it points at.
 * When the event is no longer active (archived, or wound back to draft/ready),
 * NO public link may hand the scanner a live, actionable surface. The systematic
 * map of public event-landing seams:
 *   - /events/:id (handlePublicEventPage) already forwards draft/ready → /events
 *     and renders archived as a graceful recap; /s/ shortlinks funnel there, so
 *     they were already covered.
 *   - /forms/:id (handleFormPage) — the /q/ QR landing — was the sole outlier,
 *     rendering a live registration form regardless of status. This spec locks
 *     the fix so every public link behaves consistently.
 *
 * Layer: API (SELF.fetch against the worker route) + a pure unit test on the
 * shared staleness decision.
 *
 * Format: `OSE-291 | <layer> | <method + path> (<condition>) | <assertion>`.
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { isStaleForPublicLanding, STALE_FORWARD_PATH } from '../src/lib/event-staleness';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

const ACTIVE_ID = 'evt_stale_active';
const ARCHIVED_ID = 'evt_stale_archived';
const DRAFT_ID = 'evt_stale_draft';
const READY_ID = 'evt_stale_ready';
const UNKNOWN_ID = 'evt_stale_unknown';
const TITLE = 'Bocce Night at RIPH';

beforeAll(async () => {
  const tenv = env as unknown as TestEnv;
  const tolerated = (msg: string) =>
    msg.includes('duplicate column name') ||
    msg.includes('already exists') ||
    msg.includes('no such column');
  const mainStmts: string[] = JSON.parse(tenv.TEST_MIGRATION_STATEMENTS);
  for (const stmt of mainStmts) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (tolerated(msg)) continue;
      throw e;
    }
  }
  // Seed the same event title in four lifecycle states so the ONLY variable is
  // `status`. Matches the events-table columns used by the canonical-title spec.
  const seed = async (id: string, status: string) =>
    tenv.DB.prepare(
      "INSERT OR REPLACE INTO events (id, brand_id, title, slug, status, start_date) VALUES (?, 'brand_test', ?, ?, ?, '2026-06-01T20:00:00Z')"
    )
      .bind(id, TITLE, id, status)
      .run();
  await seed(ACTIVE_ID, 'active');
  await seed(ARCHIVED_ID, 'archived');
  await seed(DRAFT_ID, 'draft');
  await seed(READY_ID, 'ready');
});

/** Fetch /forms/:id WITHOUT following redirects, so a staleness 302 is observable. */
async function fetchForm(eventId: string): Promise<Response> {
  return SELF.fetch(`https://test.local/forms/${eventId}`, {
    headers: { Accept: 'text/html' },
    redirect: 'manual',
  });
}

describe('OSE-291 QR staleness — /forms/:id forwards non-active events', () => {
  test('OSE-291 | API | GET /forms/:id (archived event) | 302 → /events, no live form', async () => {
    const res = await fetchForm(ARCHIVED_ID);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toMatch(new RegExp(`${STALE_FORWARD_PATH}$`));
  });

  test('OSE-291 | API | GET /forms/:id (draft event) | 302 → /events', async () => {
    const res = await fetchForm(DRAFT_ID);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toMatch(new RegExp(`${STALE_FORWARD_PATH}$`));
  });

  test('OSE-291 | API | GET /forms/:id (ready event) | 302 → /events', async () => {
    const res = await fetchForm(READY_ID);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toMatch(new RegExp(`${STALE_FORWARD_PATH}$`));
  });

  test('OSE-291 | API | GET /forms/:id (active event) | 200 renders the live form', async () => {
    const res = await fetchForm(ACTIVE_ID);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/data-testid="form-event-name"[^>]*>Bocce Night at RIPH</);
  });

  test('OSE-291 | API | GET /forms/:id (unknown/un-seeded event) | fallback preserved (200 form)', async () => {
    // Backward-compat (OSE-R-007): un-seeded ids must still render a form — the
    // staleness gate only fires for a KNOWN, non-active event, never for a
    // missing row (which would break test fixtures and pre-launch QR codes).
    const res = await fetchForm(UNKNOWN_ID);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/data-testid="form-event-name"[^>]*>Event</);
  });

  test('OSE-291 | API | GET /forms/:id (archived) | never-who: forward sets no cookie, Location is fixed internal path', async () => {
    // Dr-Security: the staleness forward must not set an anon/session cookie and
    // must redirect to a literal internal path — never an attacker-influenced one.
    const res = await fetchForm(ARCHIVED_ID);
    expect(res.headers.get('set-cookie')).toBeNull();
    const loc = res.headers.get('Location') ?? '';
    // Same-origin, ends exactly at the fixed listing path (no open-redirect).
    expect(loc.endsWith(STALE_FORWARD_PATH)).toBe(true);
    expect(res.headers.get('Cache-Control')).toContain('no-store');
  });
});

describe('OSE-291 QR staleness — pure decision (isStaleForPublicLanding)', () => {
  test('OSE-291 | unit | active | NOT stale', () => {
    expect(isStaleForPublicLanding('active')).toBe(false);
  });

  test('OSE-291 | unit | archived / draft / ready | stale', () => {
    expect(isStaleForPublicLanding('archived')).toBe(true);
    expect(isStaleForPublicLanding('draft')).toBe(true);
    expect(isStaleForPublicLanding('ready')).toBe(true);
  });

  test('OSE-291 | unit | unknown/garbage status | fail-safe stale (parses to draft)', () => {
    // An unparseable state must be treated as not-live, never silently as live.
    expect(isStaleForPublicLanding('')).toBe(true);
    expect(isStaleForPublicLanding(null)).toBe(true);
    expect(isStaleForPublicLanding('wat')).toBe(true);
  });
});
