/**
 * The map's place panels (owner, 2026-11-09; OSE-1892, OSE-1893, OSE-1897).
 *
 * On the zoomed area (`/?area=<res-7 cell>`) each numbered dot is one place. A
 * tap on a dot keeps the map on screen and opens that place's panel right under
 * it: a title, Prev and Next to step through the places, and each event as the
 * landing's own card with its buttons in a grid. No script runs for any of
 * this; only the Share button uses one (the event page's own share).
 *
 * How it works without script: every place renders an empty
 * `<span class="amap-t" id="amap-dot-N">` just before its `<section>`. The dot
 * links to `#amap-dot-N`, so that span becomes `:target` and
 * `.amap-t:target + .amap-p` shows the panel. The span sits at the top of the
 * map's wrapper (absolute, top 0), so the browser scrolls the MAP to the top of
 * the screen, with the panel under it. Each tap is one history entry, so Back
 * steps back through the places; a shared `#amap-dot-3` opens on place 3.
 *
 * Never who: a panel shows no count of people, and no map tap is counted. The
 * buttons go straight to their destinations (lib/map-place-links.ts).
 * Colours come from tokens only (map-panel-style.ts, event-list.ts).
 */
import { escapeHtml } from './html-escape.js';
import { eventFormPath, eventPagePath } from './canonical.js';
import { renderEventCard, type EventListItem } from './event-list.js';
import { fmt, fmtCount, msg, type MessageKey } from './i18n/catalog.js';
import { DEFAULT_LANG, type Lang } from './i18n/languages.js';
import { withLangPrefix } from './i18n/path-prefix.js';
import { eventShareUrl, renderShareButton, shareScript } from './share-button.js';
import type { PlaceLinks } from './map-place-links.js';

/** Cards one panel shows before pointing at the full list. */
export const PANEL_CARD_MAX = 12;

/** What a panel needs to know about one event (the public projection). */
export type PanelEvent = EventListItem & { location?: unknown; classes?: readonly string[] };

export interface PanelPlace {
  /** 1-based, the number printed in the dot. */
  n: number;
  /** True when every event here is at a business: named, not pinpointed. */
  business: boolean;
  events: PanelEvent[];
}

export interface PanelOptions {
  lang?: Lang;
  /** Event id → consented sponsor title (OSE-1522), shown by the title. */
  sponsorTitles?: ReadonlyMap<string, string>;
  /** Event id → its map links and share code. */
  placeLinks?: ReadonlyMap<string, PlaceLinks>;
  /** The site's origin, for the absolute link a Share carries; none, no Share. */
  origin?: string | null;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function venueOf(e: PanelEvent): string {
  return str(e.venue) || str(e.location);
}

/** The venue every event here shares, else ''. */
function sharedVenue(events: readonly PanelEvent[]): string {
  const first = venueOf(events[0]!);
  return first && events.every((e) => venueOf(e) === first) ? first : '';
}

/** Labels for the organizer's link kinds; the event page's words where it has them. */
const LINK_LABEL: Record<string, MessageKey> = {
  donation: 'what.donation',
  league: 'what.league',
  workshop: 'what.workshop',
  substack: 'what.substack',
  tickets: 'what.tickets',
  menu: 'what.menu',
  website: 'what.website',
  signup: 'map.link.signup',
  sponsor: 'map.link.sponsor',
  ow: 'map.link.ow',
};

function linkLabel(kind: string, lang: Lang): string {
  return msg(lang, LINK_LABEL[kind] ?? 'map.link.more');
}

/** One card's buttons: Open event, Register, the organizer's links, Share. */
export function panelActions(e: PanelEvent, opts: PanelOptions = {}): string {
  const lang = opts.lang ?? DEFAULT_LANG;
  const id = str(e.id);
  const name = str(e.name) || msg(lang, 'card.untitled');
  const safeName = escapeHtml(name);
  const page = eventPagePath(id, str(e.slug));
  const pageHref = escapeHtml(withLangPrefix(lang, page));
  const wrapped = e.phase === 'post_event';
  const out: string[] = [];
  out.push(
    `<a class="cta" href="${pageHref}" data-testid="amap-open" aria-label="${fmt(lang, 'card.open', { name: safeName })}">${msg(lang, wrapped ? 'card.recap' : 'map.openEvent')}</a>`
  );
  if (!wrapped) {
    out.push(
      `<a class="cta cta-secondary" href="${escapeHtml(eventFormPath(id, 'register'))}" data-testid="amap-register">${msg(lang, 'cta.register')}</a>`
    );
  }
  const links = opts.placeLinks?.get(id);
  for (const l of links?.links ?? []) {
    const label = linkLabel(l.kind, lang);
    out.push(
      `<a class="cta cta-secondary" href="${escapeHtml(l.href)}" target="_blank" rel="noopener noreferrer nofollow" data-testid="amap-link" data-kind="${escapeHtml(l.kind)}" aria-label="${fmt(lang, 'map.external', { label: escapeHtml(label) })}">${label}</a>`
    );
  }
  if (opts.origin) {
    const url = eventShareUrl(opts.origin, lang, { shareCode: links?.shareCode, pagePath: page });
    out.push(renderShareButton(url, name, lang, { className: 'cta cta-secondary' }));
  }
  return `<div class="amap-acts" data-testid="amap-acts">${out.join('')}</div>`;
}

function panelTitle(p: PanelPlace, lang: Lang): string {
  const venue = sharedVenue(p.events);
  return venue
    ? fmt(lang, 'map.placeNamed', { n: p.n, name: escapeHtml(venue) })
    : fmt(lang, 'map.place', { n: p.n });
}

function panelMeta(p: PanelPlace, lang: Lang): string {
  const count = fmtCount(lang, p.events.length, { one: 'map.eventsOne', other: 'map.events' });
  const venue = sharedVenue(p.events);
  const where =
    p.business && venue
      ? fmt(lang, 'map.atVenue', { venue: escapeHtml(venue) })
      : msg(lang, 'map.onBlock');
  return `${count} · ${where}`;
}

function panelNav(p: PanelPlace, total: number, lang: Lang): string {
  const prev =
    p.n > 1
      ? `<a class="disc-chip" href="#amap-dot-${p.n - 1}" data-testid="amap-prev">${fmt(lang, 'map.prevPlace', { n: p.n - 1 })}</a>`
      : '<span></span>';
  const next =
    p.n < total
      ? `<a class="disc-chip" href="#amap-dot-${p.n + 1}" data-testid="amap-next">${fmt(lang, 'map.nextPlace', { n: p.n + 1 })}</a>`
      : '<span></span>';
  return total > 1
    ? `<nav class="amap-pn" aria-label="${msg(lang, 'map.placesNav')}">${prev}${next}</nav>`
    : '';
}

/** Every filter class this place's events carry, so a pill hides it only when none match. */
function placeClasses(p: PanelPlace): string {
  return [...new Set(p.events.flatMap((e) => [...(e.classes ?? [])]))].join(' ');
}

/** One place's target span and panel. */
export function renderPlacePanel(p: PanelPlace, total: number, opts: PanelOptions = {}): string {
  const lang = opts.lang ?? DEFAULT_LANG;
  const shown = p.events.slice(0, PANEL_CARD_MAX);
  const more = p.events.length - shown.length;
  const cards = shown
    .map((e) =>
      renderEventCard(
        { ...e, venue: venueOf(e) },
        {
          variant: 'panel',
          extraClasses: ['amap-f', ...(e.classes ?? [])],
          sponsorTitle: opts.sponsorTitles?.get(str(e.id)),
          actions: panelActions(e, opts),
          lang,
        }
      )
    )
    .join('');
  const rest = more > 0 ? `<p class="amap-pm">${fmt(lang, 'map.morePlace', { n: more })}</p>` : '';
  const cls = `amap-p amap-f ${placeClasses(p)}`.trim();
  return (
    `<span class="amap-t" id="amap-dot-${p.n}"></span>` +
    `<section class="${escapeHtml(cls)}" aria-labelledby="amap-ph-${p.n}" data-testid="amap-panel" data-n="${p.n}">` +
    `<h2 class="amap-ph" id="amap-ph-${p.n}">${panelTitle(p, lang)}</h2>` +
    `<p class="amap-pm" data-testid="amap-panel-meta">${panelMeta(p, lang)}</p>` +
    panelNav(p, total, lang) +
    cards +
    rest +
    `<p><a class="amap-all" href="#amap-places" data-testid="amap-all">${msg(lang, 'map.allPlaces')}</a></p>` +
    `</section>`
  );
}

/** Every place's panel, the selected-dot rules, and (once) the Share script. */
export function renderPlacePanels(places: readonly PanelPlace[], opts: PanelOptions = {}): string {
  if (places.length === 0) return '';
  const lang = opts.lang ?? DEFAULT_LANG;
  const panels = places.map((p) => renderPlacePanel(p, places.length, opts)).join('');
  // The tapped dot gets a ring: one rule per place (generated, not a stylesheet).
  const sel = places
    .map((p) => `.amap-wrap:has(#amap-dot-${p.n}:target) .amap-d${p.n} .amap-dot`)
    .join(',');
  const selStyle = `<style data-testid="amap-sel-css">${sel}{stroke:var(--text);stroke-width:6}</style>`;
  return `${selStyle}${panels}${opts.origin ? shareScript(lang) : ''}`;
}
