/**
 * Pure render for the public stall list of a fair (GET /events/:id/booths,
 * OSE-1998, OSE ADR-034 decisions 1 and 5).
 *
 * No env, no DB: the handler reads the rows and hands them here, as it does for
 * the single stall page (booth-page-render.ts, whose pieces this reuses).
 *
 * What the page says, top to bottom:
 *   1. the fair's title and date;
 *   2. the sponsor strip, when the fair has sponsors on show (AGENTS.md
 *      invariant 6: below the title and date, above the content);
 *   3. one <h1>, "Stalls";
 *   4. the stalls in use, grouped under a heading per category. The groups
 *      follow the fixed list (BOOTH_CATEGORIES); a stall with no category, or
 *      one whose stored category is not on the list, is in the "Other" group,
 *      which is last. Within a group the stalls keep the order of the public
 *      read (the organizer's sort, then number). Each stall is one row, a link
 *      to its own page, showing "Stall <number>" and the trading name;
 *   5. a link to the fair's page, then Back.
 *
 * What it never says: a count of any kind (not how many stalls, not how many in
 * a category, no scans), and nothing about a person. A stall holds no person
 * field (decision 5).
 *
 * Every stored value goes through the one escaper. A category heading is a
 * label from the fixed map, never the stored text. Colours come from /ui.css
 * only; the page's own CSS is layout and stays inside the inline budget.
 */

import { escapeHtml as esc } from './html-escape';
import { renderBackButton } from './back-button';
import { eventPagePath } from './canonical';
import { BOOTH_CATEGORIES, type BoothCategory } from './event-booths';
import { boothPagePath, type PublicBooth } from './public-booths';
import {
  BOOTH_CATEGORY_LABELS,
  renderFairHeading,
  renderFairPageShell,
  renderSponsorStrip,
  type BoothPageSponsor,
} from './booth-page-render';

export interface BoothListPageInput {
  event: { id: string; title: string; slug: string | null };
  /** The fair's date line, already formatted in the fair's own zone. */
  when: string;
  /** The stalls in use, in the order of the public read. Never empty here. */
  booths: PublicBooth[];
  sponsors: BoothPageSponsor[];
  /** The fair is open by link but off the map: ask search engines to skip it. */
  noindex: boolean;
}

/** The page's own CSS: layout only, no colour. Under the 400-character inline budget. */
export const BOOTH_LIST_CSS =
  'main{max-width:560px;margin:0 auto;padding:1rem 16px 3rem;overflow-wrap:anywhere}' +
  '.bp-gap{margin-top:1rem}.bl-title{font-size:1.75rem;line-height:1.2;margin:1.25rem 0 .25rem}' +
  '.bl-group{margin-top:1.25rem}.bl-list{list-style:none}' +
  '.bl-row{min-height:44px;text-decoration:none}';

export interface BoothGroup {
  category: BoothCategory;
  label: string;
  booths: PublicBooth[];
}

/**
 * The stalls in groups, in the fixed category order. A stall whose category is
 * missing or not on the list joins "other". The order inside a group is the
 * order given. A group with no stall is left out.
 */
export function groupBoothsByCategory(booths: PublicBooth[]): BoothGroup[] {
  const known = BOOTH_CATEGORIES as readonly string[];
  const byCategory = new Map<BoothCategory, PublicBooth[]>();
  for (const booth of booths) {
    const category = (
      booth.category && known.includes(booth.category) ? booth.category : 'other'
    ) as BoothCategory;
    const list = byCategory.get(category) ?? [];
    list.push(booth);
    byCategory.set(category, list);
  }
  return BOOTH_CATEGORIES.filter((c) => byCategory.has(c)).map((category) => ({
    category,
    label: BOOTH_CATEGORY_LABELS[category],
    booths: byCategory.get(category) ?? [],
  }));
}

function renderRow(eventId: string, booth: PublicBooth): string {
  return `<li><a class="detail-card bl-row" href="${esc(boothPagePath(eventId, booth.number))}" data-testid="booth-list-row">
          <span class="detail-card-text">
            <span class="detail-card-label" data-testid="booth-list-row-number">Stall ${esc(booth.number)}</span>
            <span class="detail-card-main" data-testid="booth-list-row-name">${esc(booth.name)}</span>
          </span>
        </a></li>`;
}

function renderGroup(eventId: string, group: BoothGroup): string {
  const headingId = `booth-group-${group.category}`;
  return `<section class="bl-group" aria-labelledby="${headingId}" data-testid="booth-list-group" data-category="${group.category}">
        <h2 class="section-title" id="${headingId}" data-testid="booth-list-group-title">${esc(group.label)}</h2>
        <ul class="detail-list bl-list">
        ${group.booths.map((b) => renderRow(eventId, b)).join('\n        ')}
        </ul>
      </section>`;
}

export function renderBoothListPage(input: BoothListPageInput): string {
  const { event } = input;
  const eventTitle = esc(event.title);
  const eventPath = eventPagePath(encodeURIComponent(event.id), event.slug);
  const groups = groupBoothsByCategory(input.booths);

  return renderFairPageShell({
    title: `Stalls · ${eventTitle}`,
    noindex: input.noindex,
    css: BOOTH_LIST_CSS,
    surface: 'ose-booth-list',
    mainTestId: 'booth-list-page',
    main: `${renderFairHeading(event.title, input.when)}
      ${renderSponsorStrip(input.sponsors)}
      <h1 class="bl-title" id="booth-list-title" data-testid="booth-list-title">Stalls</h1>
      ${groups.map((g) => renderGroup(event.id, g)).join('\n      ')}
      <a class="btn btn-primary btn-block bp-gap" href="${esc(eventPath)}" data-testid="booth-list-event-link">See the fair: ${eventTitle}</a>
      ${renderBackButton({ fallbackHref: eventPath, testid: 'booth-list-back', className: 'btn btn-secondary btn-block' })}`,
  });
}
