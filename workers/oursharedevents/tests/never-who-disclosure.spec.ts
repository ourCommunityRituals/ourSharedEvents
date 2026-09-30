/**
 * OSE-1372 + the front-end half of OSE-1373 — dogfooding fixes on the anonymous
 * surfaces (staging, phone width, 2026-09-26).
 *
 * OSE-1372
 *   - "How this works" was a ~90px card on the landing, /events and every event
 *     phase. It is Invariant #1 surface language: it must be PRESENT and TRUE,
 *     not tall. Now: one visible line + the unchanged paragraph behind a native
 *     <details>, collapsed, from ONE partial (lib/never-who.ts).
 *   - The footer repeated "Never who, only how many." — one line, not two.
 *   - /events: the Everything chip sat beside "0 this month" and "Nothing else
 *     this month yet." One table per `when` now drives chip, count, and empty
 *     copy; "else" is gone; Next month exists.
 *
 * OSE-1373 (front-end part — walk-in by arrival path is a data change, left on
 * the story)
 *   - "By the numbers": Registered first, Checked in second, ratio last.
 *   - Sponsor names ran together ("Covenant Local BronzeCovenant Local
 *     Platinum…") — now one list item each, on every phase.
 *   - Add to calendar showed on a wrapped event; the recap drops it.
 *
 * @born-red OSE-1372/OSE-1373 | method: every describe below fails against the
 * pre-change render (section card, footer subtitle, "else" copy, bare <div>
 * sponsor run, calendar on post, Checked-in-first) | date: 2026-09-29
 */
import { describe, test, expect } from 'vitest';
import { SELF } from 'cloudflare:test';
import {
  renderPreEventHtml,
  renderEventLiveHtml,
  renderPostEventHtml,
  type PublicEventRow,
} from '../src/handlers/pages';
import { renderNeverWho, NEVER_WHO_LINE } from '../src/lib/never-who';
import {
  WHEN_OPTIONS,
  renderDiscoveryFilters,
  discoveryEmptyCopy,
  discoveryChipLabel,
  discoveryCountLabel,
} from '../src/lib/event-discovery';

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
const SPONSORS = [
  { id: 's1', name: 'Covenant Local Bronze', website_url: 'https://a.example' },
  { id: 's2', name: 'Covenant Local Platinum', website_url: null },
  { id: 's3', name: 'Covenant NonLocal Title', website_url: 'https://c.example' },
];
const social = (over: Partial<Record<string, number>> = {}) => ({
  sponsors: SPONSORS,
  regCount: 1389,
  checkinCount: 956,
  surveyCount: 0,
  emailCount: 0,
  ...over,
});

const PAGES: [string, () => string][] = [
  ['pre', () => renderPreEventHtml(row(), SHARE, social())],
  ['live', () => renderEventLiveHtml(row(), SHARE, social())],
  ['post', () => renderPostEventHtml(row(), SHARE, [], social())],
];

/** The one <details class="ose-never-who"> block in a page. */
function disclosure(html: string): string {
  const m = html.match(/<details class="ose-never-who"[\s\S]*?<\/details>/g) ?? [];
  expect(m.length).toBe(1);
  return m[0];
}

describe('OSE-1372 | never-who is one line + a native disclosure on every anonymous surface', () => {
  test('the partial: <details> collapsed, summary carries the line and the trigger', () => {
    const d = renderNeverWho('event');
    expect(d).toMatch(/^<details class="ose-never-who"/);
    expect(d).not.toMatch(/<details[^>]*\sopen/); // collapsed by default
    expect(d).toMatch(
      /<summary[^>]*>[\s\S]*Never who, only how many\.[\s\S]*How this works[\s\S]*<\/summary>/
    );
    expect(NEVER_WHO_LINE).toBe('Never who, only how many.');
  });

  for (const [phase, render] of PAGES) {
    test(`${phase}: one disclosure, the event paragraph verbatim inside, no old card`, () => {
      const html = render();
      const d = disclosure(html);
      expect(d).toContain('data-testid="anonymity-affordance"');
      expect(d).toContain('The link you followed counted as a');
      expect(d).toContain('nothing about your device, location, or identity was');
      expect(html).not.toContain('class="ose-anonymity"');
      // Styled on shared tokens, with a 44px summary.
      expect(html).toMatch(/\.ose-never-who-summary \{[^}]*min-height: 44px/);
    });
  }

  test('landing: the disclosure replaces the card, paragraph and link unchanged, no footer repeat', async () => {
    const html = await (await SELF.fetch('https://t.test/')).text();
    const d = disclosure(html);
    expect(d).toContain('data-testid="landing-privacy"');
    expect(d).toContain('This page sets no cookies,');
    expect(d).toContain('data-testid="privacy-more"');
    expect(html).not.toContain('<!--OCR_NEVER_WHO-->');
    expect(html).not.toContain('/*OCR_NEVER_WHO_CSS*/');
    expect(html.split('Never who, only how many.').length - 1).toBe(1);
  });

  test('/events: the disclosure replaces the card, no footer repeat', async () => {
    const html = await (await SELF.fetch('https://t.test/events')).text();
    const d = disclosure(html);
    expect(d).toContain('data-testid="anonymity-affordance"');
    expect(d).toContain('Nothing about your device, location,');
    expect(html).not.toContain('<!--OCR_NEVER_WHO-->');
    expect(html.split('Never who, only how many.').length - 1).toBe(1);
  });
});

describe('OSE-1372 | /events chip, count line, and empty copy agree for every `when`', () => {
  for (const when of WHEN_OPTIONS) {
    test(`when=${when}`, () => {
      const bar = renderDiscoveryFilters({ when, q: '' }, 0);
      // The active chip is the one for this `when`, and only it.
      const active = [
        // [0-9] since OSE-1362 added `next-90` — the first `when` value with a digit.
        ...bar.matchAll(/data-testid="disc-when-([a-z0-9-]+)" aria-current="true"/g),
      ].map((m) => m[1]);
      expect(active).toEqual([when]);
      expect(bar).toContain(`>${discoveryChipLabel(when)}</a>`);
      // The count line is keyed to the same value.
      const summary = bar.match(/data-testid="disc-summary">([^<]*)</)?.[1] ?? '';
      expect(summary).toBe(discoveryCountLabel(when, 0));
      const empty = discoveryEmptyCopy({ when, q: '' });
      expect(empty).not.toContain('else');
      // Both name the same window (the default names none).
      const span = discoveryCountLabel(when, 0).replace(/^0 events ?/, '');
      if (span)
        expect(empty.toLowerCase()).toContain(span.replace('recently wrapped', 'wrapped recently'));
    });
  }

  test('count line reads naturally', () => {
    expect(discoveryCountLabel('all', 3)).toBe('3 events');
    expect(discoveryCountLabel('month', 1)).toBe('1 event this month');
    expect(discoveryCountLabel('next-month', 0)).toBe('0 events next month');
  });

  test('chips wrap on a phone instead of scrolling the active one out of view', async () => {
    const html = await (await SELF.fetch('https://t.test/events?when=month')).text();
    expect(html).toMatch(/\.disc-chips \{[^}]*flex-wrap: wrap/);
    expect(html).not.toMatch(/\.disc-chips \{[^}]*overflow-x: auto/);
    expect(html).toMatch(/disc-when-month" aria-current="true"/);
  });
});

describe('OSE-1373 | recap numbers, sponsor list, and no calendar after the fact', () => {
  test('By the numbers: Registered, then Checked in, then the ratio', () => {
    const html = renderPostEventHtml(row(), SHARE, [], social());
    const reg = html.indexOf('data-testid="stat-registrations"');
    const chk = html.indexOf('data-testid="stat-checkins"');
    const ratio = html.indexOf('data-testid="stat-showed-up-share"');
    expect(reg).toBeGreaterThan(-1);
    expect(reg).toBeLessThan(chk);
    expect(chk).toBeLessThan(ratio);
  });

  test('the floor still holds for every line (<5 never prints exact)', () => {
    const html = renderPostEventHtml(row(), SHARE, [], social({ regCount: 3, checkinCount: 2 }));
    expect(html).toContain('Fewer than');
    expect(html).not.toContain('data-testid="stat-showed-up-share"');
  });

  for (const [phase, render] of PAGES) {
    test(`${phase}: sponsors render one per list item, never run together`, () => {
      const html = render();
      const lists = html.match(/<ul class="ose-sponsor-list"[\s\S]*?<\/ul>/g) ?? [];
      expect(lists.length).toBe(1);
      expect((lists[0].match(/<li class="ose-sponsor-item"/g) ?? []).length).toBe(SPONSORS.length);
      expect(html).not.toContain('<div class="ose-sponsor-list">');
      expect(html).not.toMatch(/Covenant Local Bronze<\/a><a/);
      expect(html).toMatch(/\.ose-sponsor-item \{[^}]*min-height: 44px/);
    });
  }

  test('post-event: Share stays, Add to calendar is gone', () => {
    const html = renderPostEventHtml(row(), SHARE, [], social());
    expect(html).toContain('data-testid="share-btn"');
    expect(html).not.toContain('data-testid="add-to-calendar"');
  });
});
