/**
 * WHAT external link — the event page's optional outbound link.
 *
 * A general "go here for more" destination on the WHAT card, run off-platform by
 * the client (a fundraiser's donation site, tickets, a tournament/season signup,
 * a Google Doc). OSE just displays it. The launch driver is a fundraiser: a
 * patron who cannot attend can still act BEFORE, DURING and AFTER — so the link
 * must render on all three phase surfaces (pre / live / post).
 *
 * Node-clean unit test: imports the exported render functions and asserts their
 * string output. No cloudflare:test / D1 — registered in vitest.node-specs.mjs.
 *
 * These are born-red: run against the pre-change render, the "renders on
 * post/live", "optional / absent when unset", and "rejects javascript:" cases
 * all fail.
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
    start_date: '2026-10-01T18:00:00.000Z',
    end_date: '2026-10-01T21:00:00.000Z',
    timezone: 'America/Chicago',
    what_short: 'Come support the cause.',
    who_host: 'The Parish Council',
    why_purpose: null,
    how_details: null,
    where_address: '123 Main St',
    who_story: null,
    who_image_url: null,
    what_video_url: null,
    what_url: null,
    lat: null,
    lon: null,
    price_cents: null,
    price_model: null,
    price_note: null,
    ...overrides,
  };
}

const DONATE = 'https://example.org/donate';
const SHARE = 'https://oursharedevents.com/events/evt_x';

const renders: [string, (r: PublicEventRow) => string][] = [
  ['pre', (r) => renderPreEventHtml(r, SHARE)],
  ['live', (r) => renderEventLiveHtml(r, SHARE)],
  ['post', (r) => renderPostEventHtml(r, SHARE, [])],
];

describe('WHAT external link | renders on every phase (before/during/after)', () => {
  for (const [phase, render] of renders) {
    it(`${phase}: renders the external link when what_url is set`, () => {
      const html = render(row({ what_url: DONATE }));
      expect(html).toContain(`href="${DONATE}"`);
      expect(html).toContain('ose-what-link');
      // link-out hygiene
      expect(html).toContain('rel="noopener noreferrer nofollow"');
      expect(html).toContain('target="_blank"');
    });

    it(`${phase}: OPTIONAL — no link markup when what_url is null`, () => {
      const html = render(row({ what_url: null }));
      expect(html).not.toContain('ose-what-link');
    });

    it(`${phase}: rejects a non-http(s) scheme (javascript:) — never reaches href`, () => {
      const html = render(row({ what_url: 'javascript:alert(1)' }));
      expect(html).not.toContain('ose-what-link');
      expect(html).not.toContain('javascript:alert');
    });
  }
});

describe('WHAT external link | generic, not donation-named', () => {
  it('uses a neutral label so it serves any event type', () => {
    const html = renderPreEventHtml(row({ what_url: DONATE }), SHARE);
    expect(html).toContain('Visit the site');
    expect(html.toLowerCase()).not.toContain('>donate');
  });

  it('shows even when the host wrote no WHAT blurb (link-only WHAT card)', () => {
    const html = renderPreEventHtml(
      row({ what_short: null, description: null, what_url: DONATE }),
      SHARE
    );
    expect(html).toContain('data-testid="event-what"');
    expect(html).toContain('ose-what-link');
  });
});
