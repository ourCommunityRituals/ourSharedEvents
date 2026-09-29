/**
 * @vitest-environment jsdom
 */
/**
 * OSE-1205 + OSE-1243 — the public event list.
 *
 * HISTORY, because the shape of this file changed for a reason. It used to
 * read `public.html`, pull the `<script>` that called `/api/v2/events` out of
 * it with a regex, run it in jsdom against a stubbed `fetch`, wait two
 * microtask turns, and then read the DOM. That was the only way to reach the
 * logic, because the logic only existed inside a string inside a template.
 *
 * OSE-1243 server-rendered the list, so the logic is now a function. The tests
 * below are the same assertions against `renderEventList` directly. The output
 * is still parsed into jsdom rather than string-matched — the thing worth
 * proving is that the markup is well-formed and structured, not that it
 * matches a particular concatenation.
 */
import { describe, test, expect, afterEach, vi } from 'vitest';
import {
  renderEventList,
  renderEventListError,
  injectEventList,
  EVENT_LIST_MARKER,
  EVENT_COUNT_MARKER,
} from '../../workers/oursharedevents/src/lib/event-list.js';
import { enrichWithPhase } from '../../workers/oursharedevents/src/lib/event-enrich.js';

/** Render, then parse into a real DOM so structure is what gets asserted. */
function render(items: unknown[]): { el: HTMLElement; countText: string } {
  const out = renderEventList(items as never);
  const el = document.createElement('div');
  el.innerHTML = out.html;
  return { el, countText: out.countText };
}

afterEach(() => {
  document.body.innerHTML = '';
});

const wrapped = {
  id: 'evt-wrapped',
  name: 'Community Game Night',
  startDateISO: '2026-05-01',
  venue: 'Beverly Arts Center',
  phase: 'post_event',
};
const upcoming = {
  id: 'evt-next',
  name: 'Bocce Thursday',
  startDateISO: '2026-10-02',
  venue: 'RIPH',
  phase: 'pre_event',
};

describe('OSE-1205 | /events phase-aware cards', () => {
  test('post_event → Wrapped tag + recap CTA to /events/:id, never a registration form', () => {
    const { el } = render([wrapped]);
    const card = el.querySelector('[data-testid="public-event-card"]') as HTMLElement;
    expect(card.getAttribute('data-phase')).toBe('post_event');
    expect(card.querySelector('[data-testid="public-event-wrapped"]')?.textContent).toBe('Wrapped');
    const cta = card.querySelector('[data-testid="public-event-cta"]') as HTMLAnchorElement;
    expect(cta.getAttribute('data-cta')).toBe('recap');
    expect(cta.getAttribute('href')).toBe('/events/evt-wrapped');
    expect(cta.textContent).toBe('See how it went');
    const cardLink = card.querySelector(
      '[data-testid="public-event-card-link"]'
    ) as HTMLAnchorElement;
    expect(cardLink.getAttribute('href')).toBe('/events/evt-wrapped');
    expect(card.innerHTML).not.toContain('type=register');
  });

  test('pre_event → card links to the public page; Register CTA remains the shortcut', () => {
    const { el } = render([upcoming]);
    const card = el.querySelector('[data-testid="public-event-card"]') as HTMLElement;
    expect(card.getAttribute('data-phase')).toBe('pre_event');
    expect(card.querySelector('[data-testid="public-event-wrapped"]')).toBeNull();
    const cardLink = card.querySelector(
      '[data-testid="public-event-card-link"]'
    ) as HTMLAnchorElement;
    expect(cardLink.getAttribute('href')).toBe('/events/evt-next');
    const cta = card.querySelector('[data-testid="public-event-cta"]') as HTMLAnchorElement;
    expect(cta.getAttribute('data-cta')).toBe('register');
    expect(cta.getAttribute('href')).toMatch(/^\/forms\/evt-next\?type=register/);
    expect(cta.textContent).toBe('Register');
  });

  test('the sr-only count excludes wrapped events', () => {
    expect(render([wrapped, upcoming]).countText).toBe('1 upcoming event');
  });

  test('the count is singular at one and plural at two', () => {
    expect(render([upcoming]).countText).toBe('1 upcoming event');
    expect(render([upcoming, { ...upcoming, id: 'b' }]).countText).toBe('2 upcoming events');
  });

  test('empty list → empty state', () => {
    const { el } = render([]);
    expect(el.querySelector('[data-testid="public-events-empty"]')?.textContent).toBe(
      'No events scheduled.'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OSE-1243. These cases came down from tests/e2e/4-negative/public-events-
// errors.spec.ts, where each one cost a browser, a route interception and a
// settled microtask queue. They are the same cases; only the price changed.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// A date-only event (start_date/end_date set, starts_at NULL) is a CALENDAR
// DAY in the event's own zone. Read raw, "2026-09-29" is UTC midnight — the
// evening of Sep 28 in Chicago — so the event went live the night before and
// rendered as the recap ("This one's a wrap") for the whole of its own day.
// Found in the rendered audit of 2026-09-29. These go through enrichWithPhase,
// the one seam the list, the API and the detail page all share.
// ─────────────────────────────────────────────────────────────────────────────

function phaseAt(nowIso: string, row: Record<string, unknown>): string {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(nowIso));
  try {
    return enrichWithPhase({ status: 'active', starts_at: null, ...row }).phase;
  } finally {
    vi.useRealTimers();
  }
}

describe("date-only events live for the whole of their day in the event's zone", () => {
  const chicagoDay = {
    start_date: '2026-09-29',
    end_date: '2026-09-29',
    timezone: 'America/Chicago',
  };

  test('on its day (10:00 CDT) → live, not the recap', () => {
    expect(phaseAt('2026-09-29T15:00:00Z', chicagoDay)).toBe('event');
  });

  test('late on its day (23:30 CDT, already the next day in UTC) → still live', () => {
    expect(phaseAt('2026-09-30T04:30:00Z', chicagoDay)).toBe('event');
  });

  test('the evening before (21:00 CDT, already its date in UTC) → pre', () => {
    expect(phaseAt('2026-09-29T02:00:00Z', chicagoDay)).toBe('pre_event');
  });

  test('the day after (01:00 CDT) → post', () => {
    expect(phaseAt('2026-09-30T06:00:00Z', chicagoDay)).toBe('post_event');
  });

  test('no end_date → the start day is the whole event, post once it ends', () => {
    const noEnd = { ...chicagoDay, end_date: null };
    expect(phaseAt('2026-09-29T15:00:00Z', noEnd)).toBe('event');
    expect(phaseAt('2026-09-30T06:00:00Z', noEnd)).toBe('post_event');
  });

  test('a missing timezone falls back to America/Chicago', () => {
    const noZone = { ...chicagoDay, timezone: null };
    expect(phaseAt('2026-09-30T04:30:00Z', noZone)).toBe('event');
    expect(phaseAt('2026-09-29T02:00:00Z', noZone)).toBe('pre_event');
  });
});

describe('a multi-day date-only event runs through the end of its last local day', () => {
  const weekend = {
    start_date: '2026-09-29',
    end_date: '2026-10-01',
    timezone: 'America/Chicago',
  };

  test('the middle day → live', () => {
    expect(phaseAt('2026-09-30T18:00:00Z', weekend)).toBe('event');
  });

  test('late on the last day (22:00 CDT Oct 1) → still live', () => {
    expect(phaseAt('2026-10-02T03:00:00Z', weekend)).toBe('event');
  });

  test('after the last day ends (01:00 CDT Oct 2) → post', () => {
    expect(phaseAt('2026-10-02T06:00:00Z', weekend)).toBe('post_event');
  });
});

describe('date-only events in zones far from UTC', () => {
  test('Auckland (UTC+13): 01:00 local on the day is the previous UTC day → live', () => {
    const row = { start_date: '2026-10-10', end_date: '2026-10-10', timezone: 'Pacific/Auckland' };
    expect(phaseAt('2026-10-09T12:00:00Z', row)).toBe('event');
    expect(phaseAt('2026-10-09T10:00:00Z', row)).toBe('pre_event'); // 23:00 Oct 9 NZDT
    expect(phaseAt('2026-10-10T11:30:00Z', row)).toBe('post_event'); // 00:30 Oct 11 NZDT
  });

  test('Honolulu (UTC-10): 22:00 local on the day is the next UTC day → live', () => {
    const row = { start_date: '2026-10-10', end_date: '2026-10-10', timezone: 'Pacific/Honolulu' };
    expect(phaseAt('2026-10-11T08:00:00Z', row)).toBe('event');
    expect(phaseAt('2026-10-10T09:00:00Z', row)).toBe('pre_event'); // 23:00 Oct 9 HST
    expect(phaseAt('2026-10-11T10:30:00Z', row)).toBe('post_event'); // 00:30 Oct 11 HST
  });
});

describe('timed events (starts_at set) are unchanged', () => {
  const timed = {
    start_date: '2026-09-29',
    end_date: '2026-09-29',
    starts_at: '2026-09-29T23:00:00Z', // 18:00 CDT
    timezone: 'America/Chicago',
  };

  test('before the start instant → pre, even on the same local day', () => {
    expect(phaseAt('2026-09-29T15:00:00Z', timed)).toBe('pre_event');
  });

  test('after the start instant, through the end of the local day → live', () => {
    expect(phaseAt('2026-09-30T04:30:00Z', timed)).toBe('event');
  });

  test('after the local day ends → post', () => {
    expect(phaseAt('2026-09-30T06:00:00Z', timed)).toBe('post_event');
  });
});

describe('OSE-1243 | hostile and malformed input', () => {
  test('a script payload in the name is escaped, not executed', () => {
    const { el } = render([{ ...upcoming, name: '<script>alert(1)</script>' }]);
    expect(el.querySelector('script')).toBeNull();
    expect(el.querySelector('[data-testid="public-event-name"]')?.textContent).toBe(
      '<script>alert(1)</script>'
    );
  });

  test('an img/onerror payload in the venue produces no element and no attribute', () => {
    const { el } = render([{ ...upcoming, venue: '<img src=x onerror=alert(1)>' }]);
    // The payload survives as TEXT — that is the point. Asserting the absence
    // of the substring "onerror=" would be wrong: escaped text legitimately
    // contains it, and the assertion would pass just as happily on markup that
    // spelled the attribute differently. What must be true is that the parser
    // built no element and no handler from it.
    expect(el.querySelector('img')).toBeNull();
    const venue = el.querySelector('[data-testid="public-event-venue"]') as HTMLElement;
    expect(venue.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(venue.children.length).toBe(0);
    expect(
      [...el.querySelectorAll('*')].some((n) =>
        n.getAttributeNames().some((a) => a.startsWith('on'))
      )
    ).toBe(false);
  });

  test('a quote in the id cannot break out of the attribute it sits in', () => {
    // The retired client escaper used textContent→innerHTML, which does NOT
    // escape `"`. This id would have closed data-event-id and opened whatever
    // followed. It is the reason this module has its own escaper.
    const { el } = render([{ ...upcoming, id: 'x" onmouseover="alert(1)' }]);
    const card = el.querySelector('[data-testid="public-event-card"]') as HTMLElement;
    expect(card.getAttribute('data-event-id')).toBe('x" onmouseover="alert(1)');
    expect(card.hasAttribute('onmouseover')).toBe(false);
  });

  test('an ampersand in the name survives the round trip through the CTA href', () => {
    const { el } = render([{ ...upcoming, name: 'Bocce & Beer' }]);
    expect(el.querySelector('[data-testid="public-event-name"]')?.textContent).toBe('Bocce & Beer');
    const href = el.querySelector('[data-testid="public-event-cta"]')?.getAttribute('href') ?? '';
    expect(new URL(href, 'https://x.test').searchParams.get('event')).toBe('Bocce & Beer');
  });

  test('missing name, date and venue render a card rather than throwing', () => {
    const { el } = render([{ id: 'bare', phase: 'pre_event' }]);
    const card = el.querySelector('[data-testid="public-event-card"]');
    expect(card).not.toBeNull();
    expect(el.querySelector('[data-testid="public-event-date"]')).toBeNull();
    expect(el.querySelector('[data-testid="public-event-venue"]')).toBeNull();
  });

  test('an unparseable date omits the date, keeping the rest of the card', () => {
    const { el } = render([{ ...upcoming, startDateISO: 'not-a-date' }]);
    expect(el.querySelector('[data-testid="public-event-date"]')).toBeNull();
    expect(el.querySelector('[data-testid="public-event-venue"]')?.textContent).toBe('RIPH');
  });

  test('null and undefined input render the empty state, not a crash', () => {
    for (const bad of [null, undefined, 'nope', 42, {}]) {
      const out = renderEventList(bad as never);
      expect(out.html).toContain('public-events-empty');
      expect(out.upcoming).toBe(0);
    }
  });
});

describe("OSE-1243 | the date is the event's local date, not the reader's", () => {
  // 02:00Z on Dec 2 is the evening of Dec 1 in Chicago. The retired client
  // script rendered this in the reader's own zone, so the same gathering had
  // different dates depending on who opened the page.
  const lateNight = { ...upcoming, startDateISO: '2026-12-02T02:00:00Z' };

  test("an event with a timezone renders that zone's date", () => {
    const { el } = render([{ ...lateNight, timezone: 'America/Chicago' }]);
    expect(el.querySelector('[data-testid="public-event-date"]')?.textContent).toBe(
      'Tuesday, December 1, 2026'
    );
  });

  test('an event without a timezone falls back to UTC', () => {
    const { el } = render([lateNight]);
    expect(el.querySelector('[data-testid="public-event-date"]')?.textContent).toBe(
      'Wednesday, December 2, 2026'
    );
  });

  test('an unknown timezone falls back to UTC instead of losing the list', () => {
    const { el } = render([{ ...lateNight, timezone: 'Mars/Olympus_Mons' }]);
    expect(el.querySelector('[data-testid="public-event-date"]')?.textContent).toBe(
      'Wednesday, December 2, 2026'
    );
  });
});

describe('OSE-1243 | injection is opt-in and total', () => {
  test('a shell without the markers comes back byte-identical', () => {
    const shell = '<html><body><p>no markers here</p></body></html>';
    expect(injectEventList(shell, renderEventList([upcoming]))).toBe(shell);
  });

  test('both markers are replaced and neither survives into the output', () => {
    const shell = `<div>${EVENT_COUNT_MARKER}</div><div>${EVENT_LIST_MARKER}</div>`;
    const out = injectEventList(shell, renderEventList([upcoming]));
    expect(out).not.toContain(EVENT_LIST_MARKER);
    expect(out).not.toContain(EVENT_COUNT_MARKER);
    expect(out).toContain('1 upcoming event');
    expect(out).toContain('public-event-card');
  });

  test('the error state renders a message the reader can act on', () => {
    const el = document.createElement('div');
    el.innerHTML = renderEventListError().html;
    expect(el.querySelector('[data-testid="public-error"]')?.textContent).toContain(
      'Please try again'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OSE-1243. The card → registration CTA contract, brought down from
// tests/e2e/3-flows/public-to-registration.spec.ts. Those tests intercepted
// **/api/v2/events to control the cards; server-rendering removed that seam,
// and these are markup assertions that never needed a browser to begin with.
// What stayed in the E2E file is the part that does: clicking through to a
// real form, computed touch-target size, focus outlines, mobile layout.
// ─────────────────────────────────────────────────────────────────────────────

describe('OSE-1243 | the card → registration CTA contract', () => {
  const evt = (o: Record<string, unknown> = {}) => ({
    id: 'evt_abc_123',
    name: 'Community BBQ',
    startDateISO: '2026-08-15T18:00:00Z',
    venue: 'Beverly Arts Center',
    phase: 'pre_event',
    ...o,
  });

  test('every card gets exactly one CTA', () => {
    const { el } = render([evt({ id: 'a' }), evt({ id: 'b' }), evt({ id: 'c' })]);
    expect(el.querySelectorAll('[data-testid="public-event-card"]').length).toBe(3);
    expect(el.querySelectorAll('[data-testid="public-event-cta"]').length).toBe(3);
  });

  test('the CTA is an anchor, not a button — it is navigation', () => {
    const { el } = render([evt()]);
    const cta = el.querySelector('[data-testid="public-event-cta"]') as HTMLElement;
    expect(cta.tagName.toLowerCase()).toBe('a');
  });

  test('the href is /forms/{id}?type=register with the name as a query param', () => {
    const { el } = render([evt()]);
    const href = el.querySelector('[data-testid="public-event-cta"]')?.getAttribute('href') ?? '';
    const url = new URL(href, 'https://x.test');
    expect(url.pathname).toBe('/forms/evt_abc_123');
    expect(url.searchParams.get('type')).toBe('register');
    expect(url.searchParams.get('event')).toBe('Community BBQ');
  });

  test('the aria-label names the event, so a screen reader hears which one', () => {
    const { el } = render([evt({ name: 'Jazz Night' })]);
    expect(el.querySelector('[data-testid="public-event-cta"]')?.getAttribute('aria-label')).toBe(
      'Register for Jazz Night'
    );
  });

  test('each card carries its own id, so the second card is not the first', () => {
    const { el } = render([evt({ id: 'evt_1' }), evt({ id: 'evt_2' })]);
    const ids = [...el.querySelectorAll('[data-testid="public-event-card"]')].map((n) =>
      n.getAttribute('data-event-id')
    );
    expect(ids).toEqual(['evt_1', 'evt_2']);
    const hrefs = [...el.querySelectorAll('[data-testid="public-event-cta"]')].map((n) =>
      n.getAttribute('href')
    );
    expect(hrefs[0]).toContain('/forms/evt_1');
    expect(hrefs[1]).toContain('/forms/evt_2');
  });

  test('cards render in the order the provider returned them', () => {
    const { el } = render([evt({ id: 'a', name: 'First' }), evt({ id: 'b', name: 'Second' })]);
    const names = [...el.querySelectorAll('[data-testid="public-event-name"]')].map(
      (n) => n.textContent
    );
    expect(names).toEqual(['First', 'Second']);
  });
});

describe('OSE-1243 | non-ASCII content renders intact', () => {
  // From tests/e2e/2-pages/public-events.spec.ts, where these needed a browser
  // only because the renderer lived inside a template string.
  test('emoji in the name and venue survive escaping', () => {
    const { el } = render([
      {
        id: 'e',
        name: '\u{1F3B5} Music Festival \u{1F3B8}',
        venue: '\u{1F3DF} Stadium',
        phase: 'pre_event',
      },
    ]);
    expect(el.querySelector('[data-testid="public-event-name"]')?.textContent).toContain(
      '\u{1F3B5}'
    );
    expect(el.querySelector('[data-testid="public-event-venue"]')?.textContent).toContain(
      '\u{1F3DF}'
    );
  });

  test('CJK characters survive escaping', () => {
    const { el } = render([
      {
        id: 'e',
        name: '\u30B3\u30DF\u30E5\u30CB\u30C6\u30A3\u30A4\u30D9\u30F3\u30C8',
        venue: '\u6771\u4EAC',
        phase: 'pre_event',
      },
    ]);
    expect(el.querySelector('[data-testid="public-event-name"]')?.textContent).toBe(
      '\u30B3\u30DF\u30E5\u30CB\u30C6\u30A3\u30A4\u30D9\u30F3\u30C8'
    );
    expect(el.querySelector('[data-testid="public-event-venue"]')?.textContent).toBe(
      '\u6771\u4EAC'
    );
  });

  test('the CTA query param round-trips non-ASCII names', () => {
    const { el } = render([{ id: 'e', name: '\u{1F3B5} Fest', phase: 'pre_event' }]);
    const href = el.querySelector('[data-testid="public-event-cta"]')?.getAttribute('href') ?? '';
    expect(new URL(href, 'https://x.test').searchParams.get('event')).toBe('\u{1F3B5} Fest');
  });
});
