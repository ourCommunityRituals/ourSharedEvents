/**
 * Pure render for the public sponsor card (GET /sponsors/:id, migration 0083).
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
import { renderBackButton } from './back-button';
import { sponsorLogoPath } from './sponsor-logo';
import { SPONSOR_DEFAULT_LOGO_PATH, sponsorCardPath, sponsorTitle, telHref } from './sponsor-card';
import { fmt, msg } from './i18n/catalog';
import { DEFAULT_LANG, type Lang } from './i18n/languages';
import { LANGUAGE_MENU_CSS, renderLanguageMenu } from './i18n/language-menu';
import { withLangPrefix } from './i18n/path-prefix';
import { fillTemplate } from './i18n/template';

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

/** mailto: with each side of the @ URI-encoded, so no query can ride along. */
function mailtoHref(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return 'mailto:';
  return `mailto:${encodeURIComponent(email.slice(0, at))}@${encodeURIComponent(email.slice(at + 1))}`;
}

export function renderSponsorCardPage(row: SponsorCardRow, lang: Lang = DEFAULT_LANG): string {
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
        `data-testid="sponsor-card-phone">${fmt(lang, 'sponsorCard.call', { phone: esc(row.contact_phone) })}</a>`
    );
  }
  if (row.contact_email) {
    actions.push(
      // The address was allowlisted on write (no ? & = % …); encoding the
      // local part and domain again here means a row stored some other way
      // still cannot carry mailto: parameters.
      `<a class="btn btn-secondary btn-block" href="${esc(mailtoHref(row.contact_email))}" ` +
        `data-testid="sponsor-card-email">${fmt(lang, 'sponsorCard.email', { email: esc(row.contact_email) })}</a>`
    );
  }
  if (row.website_url && /^https:\/\//i.test(row.website_url)) {
    actions.push(
      `<a class="btn btn-secondary btn-block" href="${esc(row.website_url)}" target="_blank" ` +
        `rel="noopener noreferrer" data-testid="sponsor-card-website">${msg(lang, 'sponsorCard.website')}</a>`
    );
  }

  // The shell is filled in the page's language first, so nothing the sponsor
  // typed is ever read for slots.
  let page = fillTemplate(SPONSOR_CARD_HTML, lang)
    .split('</style>')
    .join(`${LANGUAGE_MENU_CSS}</style>`)
    .split('<!--OCR_SPONSOR_TITLE-->')
    .join(esc(title));
  page = injectMarker(
    page,
    '<!--OCR_LANGUAGE_MENU-->',
    renderLanguageMenu({ lang, path: sponsorCardPath(row.id) })
  );
  page = injectMarker(page, '<!--OCR_SPONSOR_ID-->', esc(row.id));
  page = injectMarker(page, '<!--OCR_SPONSOR_LOGO-->', logo);
  page = injectMarker(page, '<!--OCR_SPONSOR_LINES-->', lines.join(''));
  page = injectMarker(page, '<!--OCR_SPONSOR_ACTIONS-->', actions.join(''));
  // Back, last on the page as on every public page (owner 2026-10-11). The
  // card's buttons are the hub's, so Back is too; html() adds the nonce.
  page = injectMarker(
    page,
    '<!--OCR_SPONSOR_BACK-->',
    renderBackButton({
      fallbackHref: withLangPrefix(lang, '/events'),
      testid: 'sponsor-card-back',
      lang,
      className: 'btn btn-secondary btn-block',
    })
  );
  return injectLegalFooter(page, 'public', undefined, lang);
}
