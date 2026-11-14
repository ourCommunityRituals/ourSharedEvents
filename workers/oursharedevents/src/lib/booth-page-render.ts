/**
 * Pure render for the public stall page (GET /events/:id/booths/:number,
 * OSE-1998, OSE ADR-034 decisions 1 and 5).
 *
 * No env, no DB: the handler reads the rows and hands them here, so the page is
 * testable on its own (the split of sponsor-card-render.ts).
 *
 * What the page says, top to bottom:
 *   1. the fair's title and date;
 *   2. the sponsor strip, when the fair has sponsors on show (AGENTS.md
 *      invariant 6: below the title and date, above the content);
 *   3. the stall: its number, its trading name (the one <h1>) and its category;
 *   4. a link to the fair's page, then Back, last as on every public page.
 *
 * What it never says: a count of any kind (no scans, visits, sign-ups), and
 * nothing about a person. A stall holds no person field (decision 5).
 *
 * Every stored value goes through the one escaper. The category is shown only
 * as a label from the fixed list below, never as the stored text. Colours come
 * from /ui.css only; the page's own CSS stays inside the inline budget.
 */

import { escapeHtml as esc } from './html-escape';
import { injectLegalFooter } from './legal-footer';
import { renderBackButton } from './back-button';
import { eventPagePath } from './canonical';
import { msg } from './i18n/catalog';
import { sponsorCardPath, sponsorTitle } from './sponsor-card';
import { BOOTH_CATEGORIES, type BoothCategory } from './event-booths';
import type { PublicBooth } from './public-booths';

/** The words a visitor reads for each category. Same keys as BOOTH_CATEGORIES. */
export const BOOTH_CATEGORY_LABELS: Readonly<Record<BoothCategory, string>> = {
  food: 'Food and drink',
  craft: 'Craft',
  art: 'Art',
  books: 'Books',
  clothing: 'Clothing',
  services: 'Services',
  community: 'Community',
  other: 'Other',
};

/** A sponsor on show at the fair: what the strip needs, nothing else. */
export interface BoothPageSponsor {
  id: string;
  name: string;
  display_name: string | null;
  website_url: string | null;
  has_logo: boolean;
}

export interface BoothPageInput {
  event: { id: string; title: string; slug: string | null };
  /** The fair's date line, already formatted in the fair's own zone. */
  when: string;
  booth: PublicBooth;
  sponsors: BoothPageSponsor[];
  /** The fair is open by link but off the map: ask search engines to skip it. */
  noindex: boolean;
}

/** The page's own CSS: layout only, no colour. Under the 400-character inline budget. */
const BOOTH_PAGE_CSS =
  'main{max-width:560px;margin:0 auto;padding:1rem 16px 3rem;overflow-wrap:anywhere}' +
  '.bp-gap{margin-top:1rem}.bp-name{font-size:1.75rem;line-height:1.2;margin:.25rem 0}';

function categoryLabel(category: string | null): string {
  return category && (BOOTH_CATEGORIES as readonly string[]).includes(category)
    ? BOOTH_CATEGORY_LABELS[category as BoothCategory]
    : '';
}

/** One sponsor in the hub's sponsor panel: its site when it has one, else its card. */
function renderSponsor(s: BoothPageSponsor): string {
  const title = esc(sponsorTitle(s));
  const logo = s.has_logo
    ? `<img src="${esc(`/api/v2/sponsors/${encodeURIComponent(s.id)}/logo?slot=sidebar`)}" alt="" ` +
      `loading="lazy" decoding="async" referrerpolicy="no-referrer" data-testid="booth-sponsor-logo">`
    : '';
  const inner = `<span class="sponsor-panel-id">${logo}<span class="sponsor-panel-name">${title}</span></span>`;
  const site = s.website_url ?? '';
  // Each anchor stays one complete <a …> literal: the click-out invariant
  // (sponsor-signal-never-who) reads these tags from source to prove noreferrer.
  const anchor = site.startsWith('https://')
    ? `<a class="sponsor-panel-main" href="${esc(site)}" rel="noopener noreferrer nofollow" data-testid="booth-sponsor-link">${inner}</a>`
    : `<a class="sponsor-panel-main" href="${esc(sponsorCardPath(s.id))}" data-testid="booth-sponsor-card-link">${inner}</a>`;
  return `<div class="sponsor-panel-block" data-testid="booth-sponsor-item">${anchor}</div>`;
}

function renderSponsorStrip(sponsors: BoothPageSponsor[]): string {
  if (!sponsors.length) return '';
  return (
    `<section class="sponsor-panel bp-gap" aria-label="${msg('en', 'sponsors.label')}" ` +
    `data-testid="booth-sponsor-strip">` +
    `<p class="sponsor-panel-label">${msg('en', 'sponsors.supportedBy')}</p>` +
    sponsors.map(renderSponsor).join('') +
    `</section>`
  );
}

export function renderBoothPage(input: BoothPageInput): string {
  const { event, booth } = input;
  const eventTitle = esc(event.title);
  const number = esc(booth.number);
  const name = esc(booth.name);
  const category = categoryLabel(booth.category);
  const eventPath = eventPagePath(encodeURIComponent(event.id), event.slug);

  const page = `<!DOCTYPE html>
<html lang="en" data-surface="ose-booth">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />${
      input.noindex ? '\n    <meta name="robots" content="noindex" />' : ''
    }
    <title>Stall ${number} · ${name} · ${eventTitle}</title>
    <link rel="stylesheet" href="/ui.css" />
    <style>${BOOTH_PAGE_CSS}</style>
  </head>
  <body>
    <header class="header">
      <a class="btn btn-link" href="/" data-testid="booth-page-home">OurSharedEvents</a>
      <a class="btn btn-link" href="/events" data-testid="booth-page-events">What's on</a>
    </header>
    <main id="main-content" data-testid="booth-page">
      <section data-testid="booth-event" aria-label="The fair">
        <p class="detail-card-main" data-testid="booth-event-title">${eventTitle}</p>
        ${input.when ? `<p class="detail-card-sub" data-testid="booth-event-when">${esc(input.when)}</p>` : ''}
      </section>
      ${renderSponsorStrip(input.sponsors)}
      <section class="card bp-gap" data-testid="booth" aria-labelledby="booth-name">
        <p class="detail-card-label" data-testid="booth-number">Stall ${number}</p>
        <h1 class="bp-name" id="booth-name" data-testid="booth-name">${name}</h1>
        ${category ? `<p class="detail-card-sub" data-testid="booth-category">${esc(category)}</p>` : ''}
      </section>
      <a class="btn btn-primary btn-block bp-gap" href="${esc(eventPath)}" data-testid="booth-event-link">See the fair: ${eventTitle}</a>
      ${renderBackButton({ fallbackHref: eventPath, testid: 'booth-back', className: 'btn btn-secondary btn-block' })}
    </main>
    <!--OCR_LEGAL_FOOTER-->
  </body>
</html>`;
  return injectLegalFooter(page, 'public');
}
