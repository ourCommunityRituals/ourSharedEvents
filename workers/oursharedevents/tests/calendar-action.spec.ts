/**
 * OSE-1358 — "Add to calendar" on the public event page: a CSP-safe disclosure
 * (<details>) beside Share offering Google Calendar + a plain .ics download.
 *
 * Node-clean render test (same seam as what-external-link.spec.ts): imports the
 * exported phase renderers and asserts their string output. No cloudflare:test.
 *
 * Born-red: against the pre-change render (a single .ics <a>), the disclosure
 * markup, the Google option, and the summary/menu testids are all absent.
 */
import { describe, it, expect } from 'vitest';
import {
  renderPreEventHtml,
  renderEventLiveHtml,
  renderPostEventHtml,
  type PublicEventRow,
} from '../src/handlers/pages';

function row(overrides: Partial<PublicEventRow> = {}): PublicEventRow {
  return {
    id: 'evt_x',
    brand_id: 'root',
    title: 'Parish Spring Fundraiser',
    slug: 'parish-spring-fundraiser',
    status: 'active',
    description: 'A neighborhood fundraiser.',
    location: 'St. Barnabas Hall',
    start_date: '2026-10-24',
    end_date: '2026-10-24',
    timezone: 'America/Chicago',
    starts_at: '2026-10-24T23:00:00Z',
    what_short: 'Come support the cause.',
    who_host: 'The Parish Council',
    why_purpose: null,
    how_details: null,
    where_address: '123 Main St',
    who_story: null,
    who_image_url: null,
    what_video_url: null,
    what_url: null,
    what_url_enabled: 0,
    what_url_type: null,
    lat: null,
    lon: null,
    price_cents: null,
    price_model: null,
    price_note: null,
    ...overrides,
  };
}

const SHARE = 'https://oursharedevents.com/events/evt_x';

describe('OSE-1358 Add to calendar disclosure | every phase', () => {
  // The menu currently renders on all three phases; whether it should be hidden
  // post-event is OSE-1373's decision, not this story's. Cover what ships today.
  for (const [phase, render] of [
    ['pre', (r: PublicEventRow) => renderPreEventHtml(r, SHARE)],
    ['live', (r: PublicEventRow) => renderEventLiveHtml(r, SHARE)],
    ['post', (r: PublicEventRow) => renderPostEventHtml(r, SHARE, [])],
  ] as const) {
    it(`${phase}: renders a <details> menu beside Share with Google + .ics`, () => {
      const html = render(row());
      // Same row/weight as Share.
      expect(html).toContain('data-testid="event-actions"');
      expect(html).toContain('data-testid="share-btn"');
      // The disclosure (CSP-safe, no JS). Keeps the add-to-calendar testid.
      expect(html).toContain('data-testid="add-to-calendar"');
      expect(html).toContain('class="ose-calendar-menu"');
      expect(html).toContain('Add to calendar');
      // Google option → the deep link on the event's own day.
      expect(html).toContain('data-testid="add-to-calendar-google"');
      expect(html).toContain('https://calendar.google.com/calendar/render');
      expect(html).toContain('dates=20261024T230000Z/20261025T000000Z');
      // .ics option preserved (Apple / Outlook desktop / everywhere).
      expect(html).toContain('data-testid="add-to-calendar-ics"');
      expect(html).toContain('href="/events/evt_x/calendar.ics"');
      expect(html).toContain('download');
      // never-who: no scan-ingest path or tracking params in the actions.
      expect(html).not.toContain('/q/');
      expect(html).not.toContain('utm_');
    });
  }

  it('a date-only event (no time) still offers an all-day Google link on its own day', () => {
    const html = renderPreEventHtml(row({ starts_at: null }), SHARE);
    expect(html).toContain('data-testid="add-to-calendar-google"');
    expect(html).toContain('dates=20261024/20261025');
  });

  it('no menu when the event has no start_date at all', () => {
    const html = renderPreEventHtml(row({ start_date: null, starts_at: null }), SHARE);
    expect(html).not.toContain('data-testid="add-to-calendar"');
  });

  it('a hostile title/venue cannot break out of the Google href (esc + encodeURIComponent)', () => {
    const html = renderPreEventHtml(
      row({ title: '"><script>alert(1)</script>', location: 'Venue "X"', where_address: '<b>' }),
      SHARE
    );
    // The disclosure still renders...
    expect(html).toContain('data-testid="add-to-calendar-google"');
    // ...but no injected markup or scheme escapes into the page.
    expect(html).not.toContain('<script>alert(1)');
    expect(html).not.toContain('javascript:');
  });
});
