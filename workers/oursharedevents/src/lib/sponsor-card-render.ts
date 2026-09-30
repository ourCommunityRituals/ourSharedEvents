/**
 * Pure render for the public sponsor card (GET /sponsors/:id, migration 0082).
 *
 * No env, no DB: the handler reads the row and hands it here, so the page is
 * a11y- and XSS-testable on its own (same split as sponsor-home-render.ts).
 * Every stored value goes through the one escaper; hrefs are built only from
 * validated shapes (https website, tel: digits, mailto: address).
 */

import SPONSOR_CARD_HTML from '../templates/sponsor-card.html';
import { escapeHtml as esc } from './html-escape';
import { injectMarker } from './inject-marker';
import { injectLegalFooter } from './legal-footer';
import { sponsorLogoPath } from './sponsor-logo';
import { SPONSOR_DEFAULT_LOGO_PATH, sponsorTitle, telHref } from './sponsor-card';

export interface SponsorCardRow {
  id: string;
  name: string;
  display_name: string | null;
  address_line: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  website_url: string | null;
  /** Whether the sponsor has a header logo stored (the URL itself never renders). */
  has_logo: boolean;
}

export function renderSponsorCardPage(row: SponsorCardRow): string {
  const title = sponsorTitle(row);
  const logoSrc = row.has_logo ? sponsorLogoPath(row.id) : SPONSOR_DEFAULT_LOGO_PATH;
  // Decorative next to the title it sits above, so alt="" (no double read-out).
  const logo =
    `<img class="sc-logo" src="${esc(logoSrc)}" alt="" referrerpolicy="no-referrer" ` +
    `data-default-src="${SPONSOR_DEFAULT_LOGO_PATH}" data-testid="sponsor-card-logo">`;

  const lines: string[] = [];
  // The display name replaced the business name as the title; keep the legal
  // name visible underneath so the card never hides who the sponsor is.
  if (title !== row.name) {
    lines.push(`<p class="sc-line" data-testid="sponsor-card-business">${esc(row.name)}</p>`);
  }
  if (row.address_line) {
    lines.push(
      `<p class="sc-line" data-testid="sponsor-card-address">${esc(row.address_line)}</p>`
    );
  }

  const actions: string[] = [];
  if (row.contact_phone) {
    actions.push(
      `<a class="btn btn-primary btn-block" href="${esc(telHref(row.contact_phone))}" ` +
        `data-testid="sponsor-card-phone">Call ${esc(row.contact_phone)}</a>`
    );
  }
  if (row.contact_email) {
    actions.push(
      `<a class="btn btn-secondary btn-block" href="mailto:${esc(row.contact_email)}" ` +
        `data-testid="sponsor-card-email">Email ${esc(row.contact_email)}</a>`
    );
  }
  if (row.website_url && /^https:\/\//i.test(row.website_url)) {
    actions.push(
      `<a class="btn btn-secondary btn-block" href="${esc(row.website_url)}" target="_blank" ` +
        `rel="noopener noreferrer" data-testid="sponsor-card-website">Visit website</a>`
    );
  }

  let page = SPONSOR_CARD_HTML.split('<!--OCR_SPONSOR_TITLE-->').join(esc(title));
  page = injectMarker(page, '<!--OCR_SPONSOR_ID-->', esc(row.id));
  page = injectMarker(page, '<!--OCR_SPONSOR_LOGO-->', logo);
  page = injectMarker(page, '<!--OCR_SPONSOR_LINES-->', lines.join(''));
  page = injectMarker(page, '<!--OCR_SPONSOR_ACTIONS-->', actions.join(''));
  return injectLegalFooter(page, 'public');
}
