/**
 * A11Y-7: axe-core WCAG 2.0 AA scan — all page variants
 *
 * Runs in jsdom environment (vitest.config.a11y.mts) — NOT the CF Workers pool.
 * Scans every page handler's HTML output for critical/serious WCAG violations.
 * Zero critical or serious violations required to pass.
 */

import { describe, test, expect } from 'vitest';
import axe from 'axe-core';
import {
  handleAdminPage,
  handleSharedReportPage,
  handlePosterPage,
  handlePublicPage,
  handleLandingPage,
  renderPreEventHtml,
  renderEventLiveHtml,
  renderPostEventHtml,
  type PublicEventRow,
} from '../src/handlers/pages';
import { LANGUAGE_SWITCH_CSS } from '../src/lib/i18n/language-switch';
import { handleFormPage } from '../src/handlers/form-pages';
import SPONSOR_HOME_HTML from '../src/templates/sponsor-home.html';
import { renderSponsorHomePage, type PlacementRow } from '../src/lib/sponsor-home-render';
import { renderSponsorCardPage } from '../src/lib/sponsor-card-render';

async function axeScan(html: string): Promise<axe.Result[]> {
  document.open();
  document.write(html);
  document.close();
  const results = await axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
  });
  return results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
}

function formReq(type: string): Request {
  return new Request(`https://t.test/forms/evt1?type=${type}&event=Test+Event`);
}

async function scanPage(name: string, html: string): Promise<void> {
  const violations = await axeScan(html);
  // Exactly-one-<h1> gate. axe's wcag2a/wcag2aa tags do NOT include the
  // page-has-heading-one rule (it lives in best-practice), so a page with NO
  // page-level heading passes axe while failing real screen-reader/SEO needs —
  // that is exactly how the OSE-1312 landing shipped with zero <h1>. Every
  // served surface must have precisely one page-level heading; assert it here so
  // the axe scan can't be green on a headingless page.
  const h1Count = document.querySelectorAll('h1').length;
  expect(h1Count, `${name} must have exactly one <h1> (found ${h1Count})`).toBe(1);
  if (violations.length > 0) {
    const summary = violations.map((v) => `  [${v.impact}] ${v.id}: ${v.description}`).join('\n');
    expect.fail(`${name} has ${violations.length} critical/serious violation(s):\n${summary}`);
  }
  expect(violations).toHaveLength(0);
}

describe('A11Y-7: axe-core WCAG 2.0 AA — zero critical/serious violations', () => {
  test('admin page', async () => {
    await scanPage('Admin page', await handleAdminPage({} as never).text());
  });

  test('shared report page', async () => {
    await scanPage(
      'Shared report page',
      await handleSharedReportPage({} as never).then((r) => r.text())
    );
  });

  test('poster page', async () => {
    await scanPage('Poster page', await handlePosterPage({} as never).then((r) => r.text()));
  });

  test('public listing page', async () => {
    await scanPage(
      'Public listing page',
      await handlePublicPage({} as never).then((r) => r.text())
    );
  });

  test('landing page', async () => {
    // handleLandingPage is async as of OSE-1312 slice-2 (data-driven area view) —
    // await the Response, then read it, like the other async handlers above.
    await scanPage('Landing page', await handleLandingPage({} as never).then((r) => r.text()));
  });

  test('register form', async () => {
    await scanPage(
      'Register form',
      await (await handleFormPage(formReq('register'), {} as never, 'evt1')).text()
    );
  });

  test('checkin form', async () => {
    await scanPage(
      'Checkin form',
      await (await handleFormPage(formReq('checkin'), {} as never, 'evt1')).text()
    );
  });

  test('survey form', async () => {
    await scanPage(
      'Survey form',
      await (await handleFormPage(formReq('survey'), {} as never, 'evt1')).text()
    );
  });

  test('email signup form', async () => {
    await scanPage(
      'Email form',
      await (await handleFormPage(formReq('email'), {} as never, 'evt1')).text()
    );
  });

  // 0083: the public sponsor card — full (logo, location, all three actions)
  // and minimal (a name only), so both the richest and the barest card are
  // scanned for landmarks, one <h1>, and named controls.
  test('sponsor card (full + name-only)', async () => {
    await scanPage(
      'Sponsor card (full)',
      renderSponsorCardPage({
        id: 'sp_a11y',
        name: 'Card Co LLC',
        display_name: 'Card Co',
        address_line: '123 Main St, Blue Island',
        contact_phone: '(708) 555-0100',
        contact_email: 'hi@cardco.example',
        website_url: 'https://cardco.example',
        has_logo: true,
      })
    );
    await scanPage(
      'Sponsor card (name only)',
      renderSponsorCardPage({
        id: 'sp_a11y2',
        name: 'Just A Name',
        display_name: null,
        address_line: null,
        contact_phone: null,
        contact_email: null,
        website_url: null,
        has_logo: false,
      })
    );
  });

  // PR #567: /sponsor was invisible to this gate (a11y-axe never scanned it),
  // which is how the double-<h1> shipped. The empty shell carries the page
  // landmarks and the one-<h1> contract the regression violated.
  test('sponsor home page (shell / empty state)', async () => {
    const page = SPONSOR_HOME_HTML.replace('<!--OCR_SPONSOR_ID-->', 'sb_test')
      .replace('<!--OCR_SPONSOR_NAME-->', 'Test Sponsor Co')
      .replace('<!--OCR_COUNT_LIVE-->', '0')
      .replace('<!--OCR_COUNT_UPCOMING-->', '0')
      .replace('<!--OCR_COUNT_PENDING-->', '0')
      .replace(
        '<!--OCR_SPONSOR_PLACEMENTS-->',
        '<div class="sh-empty" data-testid="sponsor-home-empty">No placements yet. When an organizer adds you to an event, it shows up here.</div>'
      )
      .replace('<!--OCR_EXPIRES-->', 'Oct 1, 2026');
    await scanPage('Sponsor home page', page);
  });

  // CCR-PR567 re-run item 6 — scan the POPULATED page too, not just the shell.
  // The prior "placement-card a11y rides on the integration-tier spec" claim was
  // false: sponsor-home.spec.ts runs in the workers pool with NO axe/DOM, so the
  // cards were axe-scanned nowhere. renderSponsorHomePage is now pure, so the
  // real placement markup (multiple <h2> titles, state chips, action buttons in
  // pending/accepted/declined states) is scanned here — including that the cards
  // introduce NO second <h1> and every control has an accessible name.
  test('sponsor home page (populated — pending/accepted/declined cards)', async () => {
    const base: PlacementRow = {
      placement_id: 'p',
      event_id: 'e',
      tier: 'gold',
      locality_band: 1,
      organizer_accepted: 1,
      sponsor_accepted: 1,
      placement_active: 1,
      title: 'Community Bocce Night',
      status: 'active',
      start_date: '2026-10-01',
      end_date: null,
      location: 'Sawyer Town Hall',
      is_published: 1,
    };
    const page = renderSponsorHomePage({
      sponsor: { id: 'sb_test', name: 'Test Sponsor Co' },
      placements: [
        { ...base, placement_id: 'p1', event_id: 'e1', sponsor_accepted: null }, // pending
        { ...base, placement_id: 'p2', event_id: 'e2', sponsor_accepted: 1 }, // accepted, live
        {
          ...base,
          placement_id: 'p3',
          event_id: 'e3',
          sponsor_accepted: 0,
          status: 'draft',
        }, // declined + not-yet-listed
      ],
      expiresIso: '2026-10-01T12:00:00Z',
    });
    await scanPage('Sponsor home page (populated)', page);
  });
});

// OSE-1761: the event page under a language prefix, with the language switch.
// The page is rendered the way /es/events/<id> renders it (Spanish, canonical and
// hreflang in the head, the switch above Back). axe checks the page language is a
// valid code, the language-named parts are valid, and nothing in the switch is a
// critical or serious violation. jsdom cannot compute size, so the 44 px and
// 16 px floors are asserted on the switch's own stylesheet.
describe('A11Y-7 / OSE-1761: event page in Spanish with the language switch', () => {
  const row: PublicEventRow = {
    id: 'evt_a11y',
    brand_id: 'root',
    title: 'Feria de primavera',
    slug: 'feria-de-primavera',
    status: 'active',
    description: 'Una feria del barrio.',
    location: 'Salón San Bernabé',
    start_date: '2026-10-24',
    end_date: '2026-10-24',
    timezone: 'America/Chicago',
    starts_at: '2026-10-24T23:00:00Z',
    what_short: 'Ven a apoyar la causa.',
    who_host: 'El consejo parroquial',
    why_purpose: null,
    how_details: null,
    where_address: '123 Main St',
    who_story: null,
    who_image_url: null,
    what_video_url: null,
    what_url: null,
    what_url_enabled: 0,
    what_url_type: null,
    lat: 41.7,
    lon: -87.7,
    price_cents: null,
    price_model: null,
    price_note: null,
  };
  const SHARE = 'https://t.test/es/events/evt_a11y/feria-de-primavera';

  test('pre-event page', async () => {
    const html = renderPreEventHtml(row, SHARE, undefined, { lang: 'es', pageQuery: '' });
    await scanPage('Spanish pre-event page', html);
    expect(document.documentElement.getAttribute('lang')).toBe('es');
    const link = document.querySelector('[data-testid="language-switch-en"]');
    // "Inglés" is a Spanish word, so the link's lang is the page's; it leads to English.
    expect(link?.getAttribute('lang')).toBe('es');
    expect(link?.getAttribute('hreflang')).toBe('en');
    expect(link?.textContent).toBe('Inglés');
  });

  test('live page', async () => {
    await scanPage(
      'Spanish live page',
      renderEventLiveHtml(row, SHARE, undefined, { lang: 'es', pageQuery: '' })
    );
  });

  test('post-event page', async () => {
    await scanPage(
      'Spanish post-event page',
      renderPostEventHtml(row, SHARE, [], undefined, { lang: 'es', pageQuery: '' })
    );
  });

  test('the switch keeps the 44 px target and the 16 px text floor', () => {
    expect(LANGUAGE_SWITCH_CSS).toMatch(/\.ose-lang a \{[^}]*min-height: 44px/);
    expect(LANGUAGE_SWITCH_CSS).toMatch(/\.ose-lang a \{[^}]*min-width: 44px/);
    expect(LANGUAGE_SWITCH_CSS).toMatch(/\.ose-lang a \{[^}]*font-size: 1rem/);
  });
});
