/**
 * Every list of cards, five at a time (owner, 2026-11-22: "For the listed card
 * options fix, apply through the application where there is a list of cards";
 * lib/card-pager.ts).
 *
 * The landing and /map are pinned in tests/area-pager.spec.ts. This spec pins the
 * other lists: /events (upcoming and wrapped page apart), the sponsor's home (its
 * requests, the events it could back, nearest first, and its placements) and a
 * fair's stalls (each group apart, and no number in the status line, as that page
 * never says how many stalls there are). For each: what the server sends, and how
 * the one script behaves in jsdom (five, then "Click for more" five at a time
 * until the list ends, focus on the first new card, the button gone at the end).
 * And what the script may never do: read a position, ask for anything or store
 * anything.
 *
 * Node project: pure rendering, the script's text, and jsdom. Registered in
 * vitest.node-specs.mjs.
 */
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  CARD_PAGER_SCRIPT,
  CARD_PAGER_STYLE,
  PAGE_SIZE,
  cardPagerControls,
} from '../src/lib/card-pager';
import { renderEventList, type EventListItem } from '../src/lib/event-list';
import { renderSponsorHomePage, type PlacementRow } from '../src/lib/sponsor-home-render';
import { renderBoothListPage } from '../src/lib/booth-list-render';
import type { PublicBooth } from '../src/lib/public-booths';
import type { DiscoverableEvent } from '../src/lib/sponsor-discovery';

/** Run a page's markup with its scripts, as a browser would. */
function open(html: string) {
  const dom = new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const win = dom.window;
  const doc = win.document;
  const qa = (s: string) => [...doc.querySelectorAll<HTMLElement>(s)];
  /** The cards a person can see, by a stable attribute. */
  const shown = (sel: string, attr: string) =>
    qa(sel)
      .filter((c) => win.getComputedStyle(c).display !== 'none')
      .map((c) => c.getAttribute(attr) ?? c.textContent!.trim());
  const all = (sel: string, attr: string) =>
    qa(sel).map((c) => c.getAttribute(attr) ?? c.textContent!.trim());
  const button = (testid: string) =>
    doc.querySelector<HTMLButtonElement>(`[data-testid="${testid}"]`);
  const status = (testid: string) =>
    doc.querySelector(`[data-testid="${testid}-status"]`)?.textContent ?? null;
  return { win, doc, qa, shown, all, button, status };
}

/** Tap until the button goes, checking five more each time and where focus lands. */
function walk(page: ReturnType<typeof open>, sel: string, attr: string, testid: string): void {
  const every = page.all(sel, attr);
  expect(every.length).toBeGreaterThan(PAGE_SIZE);
  let n = PAGE_SIZE;
  expect(page.shown(sel, attr)).toEqual(every.slice(0, n));
  while (n < every.length) {
    expect(page.button(testid)!.parentElement!.hidden).toBe(false);
    page.button(testid)!.click();
    const first = every[n];
    n = Math.min(n + PAGE_SIZE, every.length);
    expect(page.shown(sel, attr)).toEqual(every.slice(0, n));
    // Focus goes to the first card the tap brought in.
    const focused = page.doc.activeElement!;
    const card = page.qa(sel).find((c) => c === focused || c.contains(focused));
    expect(card?.getAttribute(attr) ?? card?.textContent!.trim()).toBe(first);
  }
  expect(page.button(testid)!.parentElement!.hidden).toBe(true);
}

// ─── /events ───────────────────────────────────────────────────────────────────

const day = (n: number) => new Date(Date.UTC(2099, 0, 1 + n)).toISOString();
const events = (up: number, wrapped: number): EventListItem[] =>
  [
    ...Array.from({ length: up }, (_, i) => ({
      id: `u${i}`,
      name: `Upcoming ${i}`,
      startDateISO: day(10 + i),
      phase: 'pre_event',
    })),
    ...Array.from({ length: wrapped }, (_, i) => ({
      id: `w${i}`,
      name: `Wrapped ${i}`,
      startDateISO: day(-10 - i),
      phase: 'post_event',
    })),
  ] as EventListItem[];

const UP = '#events article.event-card:not([data-phase="post_event"])';
const WR = '#events article.event-card[data-phase="post_event"]';
const eventsPage = (up: number, wrapped: number, lang: 'en' | 'es' = 'en') =>
  `<div id="events">${renderEventList(events(up, wrapped), undefined, { lang }).html}</div>`;

describe('/events | five at a time', () => {
  it('upcoming and wrapped each page on their own, five then five more', () => {
    const p = open(eventsPage(12, 7));
    expect(p.status('events-more')).toBe('Showing 5 of 12 events.');
    expect(p.status('events-wrapped-more')).toBe('Showing 5 of 7 events.');
    // The wrapped heading sits over wrapped cards that show.
    expect(p.shown(WR, 'data-event-id')).toHaveLength(5);
    walk(p, UP, 'data-event-id', 'events-more');
    expect(p.status('events-more')).toBe('Showing 12 of 12 events.');
    // Tapping the upcoming list leaves the wrapped list as it was.
    expect(p.shown(WR, 'data-event-id')).toHaveLength(5);
    walk(p, WR, 'data-event-id', 'events-wrapped-more');
  });

  it('five or fewer in a group: that group has no button; none at all, no script', () => {
    const some = eventsPage(5, 6);
    expect(some).not.toContain('data-testid="events-more"');
    expect(some).toContain('data-testid="events-wrapped-more"');
    const none = eventsPage(5, 5);
    expect(none).not.toContain('data-card-more');
    expect(none).not.toContain('<script');
    const p = open(eventsPage(5, 5));
    expect(p.shown('#events article.event-card', 'data-event-id')).toHaveLength(10);
  });

  it('keeps the server order (the page knows no place) and speaks the page language', () => {
    const html = eventsPage(7, 0, 'es');
    expect(html).toContain('>Haz clic para ver más</button>');
    expect(html).toContain('data-says="Mostrando %n de %t eventos."');
    const p = open(eventsPage(7, 0));
    expect(p.all(UP, 'data-event-id')).toEqual(['u0', 'u1', 'u2', 'u3', 'u4', 'u5', 'u6']);
  });

  it('without the script every card shows: the button is hidden in the markup', () => {
    const html = eventsPage(12, 0);
    expect(html).toMatch(/<p class="card-more" data-card-more="events"[^>]* hidden>/);
    expect(html).not.toMatch(/<article[^>]*data-paged-out/);
  });
});

// ─── The sponsor's home ────────────────────────────────────────────────────────

const placement = (i: number): PlacementRow => ({
  placement_id: `p${i}`,
  event_id: `pe${i}`,
  tier: 'gold',
  locality_band: 0,
  organizer_accepted: 1,
  sponsor_accepted: 1,
  placement_active: 1,
  title: `Placement ${i}`,
  status: 'active',
  start_date: '2099-10-01',
  end_date: null,
  location: 'Eagles Hall',
  is_published: 1,
});
const discoverable = (n: number, nearAt: number[] = []): DiscoverableEvent[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `d${i}`,
    title: `Could back ${i}`,
    start_date: '2099-10-02',
    location: 'Eagles Hall',
    near: nearAt.includes(i) ? 1 : 0,
  }));
const sponsorHome = (placements: number, could: number, requests: number, nearAt: number[] = []) =>
  renderSponsorHomePage({
    sponsor: { id: 'sb1', name: 'Corner Bakery' },
    placements: Array.from({ length: placements }, (_, i) => placement(i)),
    expiresIso: '2099-11-10T12:00:00Z',
    discoverable: discoverable(could, nearAt),
    requests: Array.from({ length: requests }, (_, i) => ({
      placement_id: `r${i}`,
      event_id: `re${i}`,
      title: `Request ${i}`,
      start_date: '2099-10-03',
      organizer_accepted: null,
    })),
  });

describe('the sponsor home | five at a time', () => {
  it('placements, requests and the events it could back each page on their own', () => {
    const p = open(sponsorHome(8, 11, 6));
    expect(p.status('placement-more')).toBe('Showing 5 of 8 placements.');
    expect(p.status('request-more')).toBe('Showing 5 of 6 requests.');
    expect(p.status('discover-more')).toBe('Showing 5 of 11 events.');
    walk(p, '#sh-placements article.sh-card', 'data-placement-id', 'placement-more');
    walk(p, '#sh-requests article.sh-card', 'data-placement-id', 'request-more');
    walk(p, '#sh-discover article.sh-card', 'data-event-id', 'discover-more');
  });

  it('the events it could back come nearest first: its own area leads, then the server order', () => {
    const p = open(sponsorHome(1, 8, 0, [3, 6]));
    expect(p.all('#sh-discover article.sh-card', 'data-event-id')).toEqual([
      'd3',
      'd6',
      'd0',
      'd1',
      'd2',
      'd4',
      'd5',
      'd7',
    ]);
  });

  it('a page with no list over five sends no button and no script', () => {
    const html = sponsorHome(5, 5, 5);
    expect(html).not.toContain('data-card-more');
    expect(html).not.toContain(CARD_PAGER_SCRIPT);
  });

  it('one script for the page however many lists use it', () => {
    const html = sponsorHome(8, 11, 6);
    expect(html.split(CARD_PAGER_SCRIPT)).toHaveLength(2);
  });
});

// ─── A fair's stalls ───────────────────────────────────────────────────────────

const booths = (food: number, craft: number): PublicBooth[] => [
  ...Array.from({ length: food }, (_, i) => ({
    id: `f${i}`,
    number: `F${i}`,
    name: `Food ${i}`,
    category: 'food',
    hall_x: null,
    hall_y: null,
  })),
  ...Array.from({ length: craft }, (_, i) => ({
    id: `c${i}`,
    number: `C${i}`,
    name: `Craft ${i}`,
    category: 'craft',
    hall_x: null,
    hall_y: null,
  })),
];
const stalls = (food: number, craft: number) =>
  renderBoothListPage({
    event: { id: 'fair1', title: 'Harvest Fair', slug: null },
    when: 'Sat, Oct 1',
    booths: booths(food, craft),
    sponsors: [],
    noindex: false,
  });

describe("a fair's stalls | five at a time", () => {
  it('each group pages on its own; the status line names no number', () => {
    const p = open(stalls(13, 3));
    walk(p, '#booth-list-food li', 'data-x', 'booth-list-more-food');
    expect(p.button('booth-list-more-craft')).toBeNull();
    expect(p.shown('#booth-list-craft li', 'data-x')).toHaveLength(3);
    const said = p.status('booth-list-more-food')!;
    expect(said).toBe('Stalls show five at a time.');
    expect(said).not.toMatch(/\d/);
  });

  it('no group over five: no button and no script', () => {
    const html = stalls(5, 5);
    expect(html).not.toContain('data-card-more');
    expect(html).not.toContain(CARD_PAGER_SCRIPT);
  });
});

// ─── The piece itself ──────────────────────────────────────────────────────────

describe('the card pager | the piece', () => {
  it('a filter that hides cards is counted: only showing cards make the five', () => {
    const items = Array.from({ length: 9 }, (_, i) => `<li data-i="${i}">Card ${i}</li>`).join('');
    const p = open(
      `<ul id="l">${items}</ul>${cardPagerControls({ list: 'l', cards: 'li', testid: 'm' })}<style>${CARD_PAGER_STYLE.slice(7, -8)}</style><script>${CARD_PAGER_SCRIPT}</script>`
    );
    expect(p.shown('#l li', 'data-i')).toEqual(['0', '1', '2', '3', '4']);
    // Another script hides two cards (a filter): the next two step up.
    p.qa('#l li')[1]!.style.display = 'none';
    p.qa('#l li')[2]!.style.display = 'none';
    return new Promise<void>((done) =>
      setTimeout(() => {
        expect(p.shown('#l li', 'data-i')).toEqual(['0', '3', '4', '5', '6']);
        expect(p.status('m')).toBe('Showing 5 of 7 events.');
        done();
      }, 0)
    );
  });

  it('the style hides only the waiting cards, with tokens, no colour of its own, inside the budget', () => {
    expect(CARD_PAGER_STYLE).toContain('[data-paged-out]{display:none!important}');
    expect(CARD_PAGER_STYLE).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(CARD_PAGER_STYLE.length - '<style></style>'.length).toBeLessThanOrEqual(400);
  });

  it('never reads a position, asks for anything, or stores anything', () => {
    for (const banned of [
      /geolocation/,
      /getCurrentPosition/,
      /\bfetch\s*\(/,
      /XMLHttpRequest/,
      /sendBeacon/,
      /document\.cookie/,
      /localStorage/,
      /sessionStorage/,
      /indexedDB/,
      /history\./,
      /location\./,
    ]) {
      expect(CARD_PAGER_SCRIPT, String(banned)).not.toMatch(banned);
    }
  });

  it('escapes what it is given', () => {
    const html = cardPagerControls({ list: '"><x', cards: 'li', testid: 't', says: '<b>{n}' });
    expect(html).not.toContain('"><x');
    expect(html).not.toContain('<b>');
  });
});
