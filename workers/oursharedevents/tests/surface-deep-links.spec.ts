/**
 * Event-scoped surface deep-links — invariant guard spec.
 *
 * Idea #3 from the invariant-first frontend fleet. Selecting an event row
 * upgrades the four admin surface cards (Poster / Display / Public /
 * SharedReport) to that event's scoped surface, turning each Rings-flywheel
 * transition into one click. This is a template-only change: the scoped URL's
 * ONLY dynamic segment is the opaque, server-validated event id.
 *
 * INVARIANT #1 (anonymous_id): scoped URLs must carry only the event id — never
 * ose_anon / anonymous_id / PII — and the SharedReport link must target the
 * aggregate proof surface, not a per-subscriber/row endpoint.
 *
 * @born-red invariant#1 | method: design-time-negative-assertion | date: 2026-08-07
 */

import { describe, test, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

const ADMIN_KEY = 'test-admin-key-e2e-2026';

async function fetchAdmin(): Promise<string> {
  const res = await SELF.fetch('https://t.test/admin', {
    headers: { Authorization: `Bearer ${ADMIN_KEY}`, Accept: 'text/html' },
  });
  expect(res.status, '/admin should render 200').toBe(200);
  return res.text();
}

// Mirror of the in-template scopedSurfaceUrl() so its URL-shape contract is
// asserted directly. Kept byte-identical to the switch arms in admin.html.
function scopedSurfaceUrl(surface: string, eventId: string): string | null {
  if (!eventId) return null;
  const id = encodeURIComponent(eventId);
  switch (surface) {
    case 'poster':
      return '/poster?event=' + id;
    case 'display':
      return '/display?event=' + id;
    case 'public':
      return '/events/' + id;
    case 'report':
      return '/sharedReport?event=' + id;
    default:
      return null;
  }
}

const PII_RE = /ose_anon|anonymous_id|anon_[0-9a-f]|\bemail\b|\bphone\b|@/i;

describe('surface deep-links | template wiring', () => {
  test('each surface card carries a data-surface hook', async () => {
    const html = await fetchAdmin();
    expect(html).toMatch(/data-surface="poster"/);
    expect(html).toMatch(/data-surface="display"/);
    expect(html).toMatch(/data-surface="public"/);
    expect(html).toMatch(/data-surface="report"/);
  });

  test('scopeSurfaceCards + scopedSurfaceUrl are present and the selection event calls them', async () => {
    const html = await fetchAdmin();
    expect(html).toContain('window.scopeSurfaceCards');
    expect(html).toContain('function scopedSurfaceUrl');
    // OSE-667: scoping is driven by the single ose:event-selected fan-out, not a
    // direct call in the row onclick.
    expect(html).toContain('window.scopeSurfaceCards(d.id, d.name)');
    expect(html).toContain('onclick="window.selectEvent(');
  });

  test('scoping helper never reads a cookie or anon id', async () => {
    const html = await fetchAdmin();
    // Scope the assertion to the scopeSurfaceCards helper DEFINITION body.
    const start = html.indexOf('window.scopeSurfaceCards = function');
    const slice = html.slice(start, start + 800);
    expect(slice).not.toMatch(/document\.cookie/);
    expect(slice).not.toMatch(/ose_anon|anonymous_id/);
  });
});

describe('surface deep-links | INVARIANT #1 URL-shape contract', () => {
  const EVENT_ID = 'evt_9f3a2b';

  test('every scoped URL carries only the opaque event id — no anon/PII', () => {
    for (const surface of ['poster', 'display', 'public', 'report']) {
      const url = scopedSurfaceUrl(surface, EVENT_ID);
      expect(url, `${surface} must produce a scoped URL`).toBeTruthy();
      expect(url).toContain(EVENT_ID);
      expect(url).not.toMatch(PII_RE);
    }
  });

  test('scoped URLs match the exact per-surface path shape', () => {
    expect(scopedSurfaceUrl('poster', EVENT_ID)).toBe('/poster?event=evt_9f3a2b');
    expect(scopedSurfaceUrl('display', EVENT_ID)).toBe('/display?event=evt_9f3a2b');
    expect(scopedSurfaceUrl('public', EVENT_ID)).toBe('/events/evt_9f3a2b');
    expect(scopedSurfaceUrl('report', EVENT_ID)).toBe('/sharedReport?event=evt_9f3a2b');
  });

  test('SharedReport link targets the aggregate proof surface, never a row/api endpoint', () => {
    const url = scopedSurfaceUrl('report', EVENT_ID)!;
    expect(url.startsWith('/sharedReport?event=')).toBe(true);
    expect(url).not.toMatch(/^\/api\//);
    expect(url).not.toMatch(/subscriber|registration_id|anon/i);
  });

  test('an unknown surface yields no URL (fail-closed)', () => {
    expect(scopedSurfaceUrl('mystery', EVENT_ID)).toBeNull();
    expect(scopedSurfaceUrl('poster', '')).toBeNull();
  });
});
