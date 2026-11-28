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
import { handleDemoIndex, handleDemoSite } from '../src/handlers/demo';
import SPONSOR_HOME_HTML from '../src/templates/sponsor-home.html';
import { renderSponsorHomePage, type PlacementRow } from '../src/lib/sponsor-home-render';
import { renderSponsorCardPage } from '../src/lib/sponsor-card-render';
import { gridDisk, gridRing, latLngToCell } from 'h3-js';
import { renderEmptyLandingArea, renderLandingArea } from '../src/lib/landing-area';

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

  test('attendee map page (/map)', async () => {
    // OSE-1990: the landing page opened on its map view, at its own address.
    await scanPage(
      'Attendee map page',
      await handleLandingPage({} as never, null, new Request('https://t.test/map'), undefined, {
        mapFirst: true,
      }).then((r) => r.text())
    );
    // The page scanned is the map's own: its search box answers at /map. With no
    // database there is no event, so this is the page's empty state.
    expect(document.querySelector('form.where-form')?.getAttribute('action')).toBe('/map');
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
        '<section class="sh-section"><h2 class="section-title">Your placements</h2><p class="sub-line" data-testid="sponsor-home-empty">No placements yet.</p></section>'
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

  // Owner 2026-11-28: the foot-of-page languages are one chip that opens a card.
  // Open it, so axe sees every choice, its flag and its name.
  for (const lang of ['es', 'ar'] as const) {
    test(`pre-event page with the language chip open, ${lang}`, async () => {
      const html = renderPreEventHtml(row, SHARE, undefined, { lang, pageQuery: '' }).replace(
        '<details data-testid="language-switch-choice">',
        '<details open data-testid="language-switch-choice">'
      );
      expect(html, 'the chip opened').toContain(
        '<details open data-testid="language-switch-choice">'
      );
      await scanPage(`${lang} pre-event page, language chip open`, html);
      const chip = document.querySelector('[data-testid="language-switch-chip"]');
      expect(chip?.getAttribute('aria-label')).toBeTruthy();
      const links = document.querySelectorAll('[data-testid="language-switch-card"] a');
      expect(links.length).toBeGreaterThan(0);
      for (const a of links) expect(a.textContent?.trim()).not.toBe('');
    });
  }

  // OSE-1937 (epic OSE-1927): the header Language menu with every part open, the
  // wide-screen list, the phone menu and its Language list, so axe sees all of it.
  // Then the rules a menu can break that are not in wcag2a/aa: a second
  // "Language" landmark beside the footer switch (E8), and a summary with no name.
  for (const lang of ['es', 'en'] as const) {
    test(`pre-event page with the header menu open, ${lang}`, async () => {
      const html = renderPreEventHtml(row, SHARE, undefined, { lang, pageQuery: '' }).replace(
        /<details class="ose-langmenu-/g,
        '<details open class="ose-langmenu-'
      );
      expect(html.match(/<details open class="ose-langmenu-/g)?.length, 'all three opened').toBe(3);
      await scanPage(`${lang} pre-event page, header menu open`, html);

      const extra = await axe.run(document, {
        runOnly: {
          type: 'rule',
          values: [
            'landmark-unique',
            'summary-name',
            'link-name',
            'aria-allowed-attr',
            'duplicate-id',
          ],
        },
      });
      expect(extra.violations.map((v) => v.id)).toEqual([]);

      const label = lang === 'es' ? 'Idioma' : 'Language';
      expect(document.querySelector('[data-testid="language-menu-button"]')?.textContent).toBe(
        `${label}▾`
      );
      expect(
        document.querySelector('[data-testid="site-menu-button"]')?.getAttribute('aria-label')
      ).toBe(lang === 'es' ? 'Menú' : 'Menu');
      // The current language is text, not a link, so it is not a tab stop.
      const current = document.querySelector(`[data-testid="language-menu-${lang}"]`);
      expect(current?.tagName).toBe('SPAN');
      expect(current?.getAttribute('aria-current')).toBe('true');
    });
  }

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

// OSE-1762: /es/events and /es/, rendered the way the router serves them, in the
// states that change what is on the page (a filter, a search with no answer, a
// zip, a zip we do not know). axe checks the page language is a valid code and
// that nothing new is a critical or serious violation; one <h1> each.
describe('A11Y-7 / OSE-1762: the event list and the landing in Spanish', () => {
  const list = (query: string) =>
    handlePublicPage({} as never, null, new Request(`https://t.test/es/events${query}`), 'es');
  const landing = (query: string) =>
    handleLandingPage({} as never, null, new Request(`https://t.test/es/${query}`), 'es');

  for (const query of ['', '?when=weekend', '?q=zzzz', '?q=Blue+Island']) {
    test(`/es/events${query}`, async () => {
      await scanPage(`Spanish event list ${query}`, await (await list(query)).text());
      expect(document.documentElement.getAttribute('lang')).toBe('es');
    });
  }

  // The town box too (#1118): a name that is many places lists its choices.
  for (const query of [
    '',
    '?zip=60406',
    '?zip=00000',
    '?nozip=1',
    '?where=Springfield',
    '?where=Nowhereville',
  ]) {
    test(`/es/${query}`, async () => {
      await scanPage(`Spanish landing ${query}`, await (await landing(query)).text());
      expect(document.documentElement.getAttribute('lang')).toBe('es');
    });
  }

  // The map's own address (OSE-1990): the same page opened on its map view, with
  // a search that finds a zip and a name that is many places.
  const mapPage = (query: string) =>
    handleLandingPage({} as never, null, new Request(`https://t.test/es/map${query}`), 'es', {
      mapFirst: true,
    });
  for (const query of ['', '?zip=60406', '?where=Springfield']) {
    test(`/es/map${query}`, async () => {
      await scanPage(`Spanish map page ${query}`, await (await mapPage(query)).text());
      expect(document.documentElement.getAttribute('lang')).toBe('es');
    });
  }
});

// Polish (OSE-1957) and Arabic, the first right-to-left language (epic OSE-1959,
// story OSE-1971). Every page on the layer, menu closed and with every part of
// it open, in both. axe checks `lang` is a valid code (html-lang-valid,
// valid-lang on each menu item) and that nothing in the right-to-left page is a
// critical or serious violation. Then the menu rules from OSE-1937, and `dir`
// on <html>: rtl for Arabic, ltr for Polish.
describe('A11Y-7 / OSE-1957, OSE-1971: Polish and Arabic pages, menu closed and open', () => {
  const row = {
    id: 'evt_a11y',
    brand_id: 'root',
    title: 'Bocce Night #3!',
    slug: 'bocce-night',
    status: 'active',
    description: 'A neighborhood night.',
    location: 'St. Gerald Hall',
    start_date: '2026-10-24',
    end_date: '2026-10-24',
    timezone: 'America/Chicago',
    starts_at: '2026-10-24T23:00:00Z',
    what_short: 'Come and play.',
    who_host: 'Oak Lawn Bocce Club',
    why_purpose: null,
    how_details: null,
    where_address: '9500 S Cook Ave',
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
  } as PublicEventRow;
  const open = (html: string) =>
    html.replace(/<details class="ose-langmenu-/g, '<details open class="ose-langmenu-');

  for (const lang of ['pl', 'ar'] as const) {
    const dir = lang === 'ar' ? 'rtl' : 'ltr';
    const share = `https://t.test/${lang}/events/evt_a11y/bocce-night`;
    const pages: [string, () => Promise<string> | string][] = [
      ['pre-event', () => renderPreEventHtml(row, share, undefined, { lang, pageQuery: '' })],
      ['live', () => renderEventLiveHtml(row, share, undefined, { lang, pageQuery: '' })],
      ['post-event', () => renderPostEventHtml(row, share, [], undefined, { lang, pageQuery: '' })],
      [
        '/events',
        async () =>
          (
            await handlePublicPage(
              {} as never,
              null,
              new Request(`https://t.test/${lang}/events`),
              lang
            )
          ).text(),
      ],
      [
        'landing',
        async () =>
          (
            await handleLandingPage({} as never, null, new Request(`https://t.test/${lang}/`), lang)
          ).text(),
      ],
      [
        // OSE-1990: the map's own address, the landing opened on its map view.
        'map page',
        async () =>
          (
            await handleLandingPage(
              {} as never,
              null,
              new Request(`https://t.test/${lang}/map`),
              lang,
              { mapFirst: true }
            )
          ).text(),
      ],
    ];
    for (const [name, render] of pages) {
      for (const menu of ['closed', 'open'] as const) {
        test(`${lang} ${name}, menu ${menu}`, async () => {
          const html = await render();
          await scanPage(`${lang} ${name}, menu ${menu}`, menu === 'open' ? open(html) : html);
          expect(document.documentElement.getAttribute('lang')).toBe(lang);
          expect(document.documentElement.getAttribute('dir')).toBe(dir);
          expect(document.querySelectorAll('h1').length).toBe(1);
          const extra = await axe.run(document, {
            runOnly: {
              type: 'rule',
              values: [
                'valid-lang',
                'landmark-unique',
                'summary-name',
                'link-name',
                'aria-allowed-attr',
                'duplicate-id',
              ],
            },
          });
          expect(extra.violations.map((v) => v.id)).toEqual([]);
        });
      }
    }
  }
});

// The demo sites are the permanent reference installation (ADR-007), so they
// meet the page rules every other surface meets. They were missing from this
// file, which is how all four shipped with no <h1>: the page title was an <h2>
// and nothing scanned it. Each page's title is its one <h1>, and no heading
// below it skips a level.
describe('A11Y-7: the demo sites, one <h1> each and no skipped heading level', () => {
  const pages: Array<[string, string, () => Response]> = [
    ['demo index', 'The demo site', () => handleDemoIndex()],
    ['demo free', 'Demo — Free · Local', () => handleDemoSite('free')],
    ['demo mid', 'Demo — Mid', () => handleDemoSite('mid')],
    ['demo premium', 'Demo — Premium · Enterprise', () => handleDemoSite('premium')],
    ['no such demo site', 'No such demo site', () => handleDemoSite('nope')],
  ];

  for (const [name, title, render] of pages) {
    test(name, async () => {
      await scanPage(name, await render().text());
      expect(document.querySelector('h1')?.textContent?.trim()).toBe(title);
      const levels = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map((h) =>
        Number(h.tagName.slice(1))
      );
      // WCAG 2.5.3 Label in Name is not in the wcag2a/wcag2aa tags scanPage
      // runs. The front door's "Enter" links carried a name without the word
      // (OSE-2031), so the rule runs here by name.
      const named = await axe.run(document, {
        runOnly: { type: 'rule', values: ['label-content-name-mismatch'] },
      });
      expect(named.violations.map((v) => v.id)).toEqual([]);
      expect(levels[0], `${name}: the first heading is the page title`).toBe(1);
      levels.forEach((level, i) => {
        if (i > 0) {
          expect(
            level,
            `${name}: heading ${i + 1} jumps from h${levels[i - 1]} to h${level}`
          ).toBeLessThanOrEqual(levels[i - 1] + 1);
        }
      });
    });
  }
});

/**
 * OSE-2112: the area map with events on it. Every scan above builds the landing
 * with no database, so the page they read has no map, and the hexagon links
 * inside it were never read by axe. Here the area is rendered from events and
 * put in the real page in place of its empty state.
 *
 * BORN RED (2026-11-17): with the drawing back on role="img" whatever it holds,
 * both tests fail with "[serious] nested-interactive".
 */
describe('A11Y-7 / OSE-2112: the area map with events, hexagon links announced', () => {
  const NOW = Date.parse('2026-11-09T12:00:00Z');
  const CELL = latLngToCell(41.6565, -87.681, 7);
  // Neighbours: drawn large, so every hexagon is a link at every width.
  const NEAR = gridDisk(CELL, 1).filter((c) => c !== CELL);
  // Five areas apart: drawn smaller, so a hexagon is a link only on a wider
  // screen (lib/map-link-style.ts), drawn once as a link and once plain.
  const FAR = [CELL, gridRing(CELL, 5)[0]!];

  function pageWith(cells: string[], mapFirst: boolean): Promise<string> {
    const items = Array.from({ length: 12 }, (_, i) => ({
      id: `e${i}`,
      name: `Event ${i}`,
      startDateISO: '2026-11-20',
      phase: 'pre_event',
      venue: 'Hall, Blue Island, IL 60406',
      h3_res7: cells[i % cells.length],
    }));
    const area = renderLandingArea(items, {
      now: NOW,
      mapFirst,
      zoomHref: (c) => `/map?area=${c}`,
    });
    return handleLandingPage(
      {} as never,
      null,
      new Request(mapFirst ? 'https://t.test/map' : 'https://t.test/'),
      undefined,
      { mapFirst }
    )
      .then((r) => r.text())
      .then((html) => {
        const empty = renderEmptyLandingArea().html;
        expect(html).toContain(empty);
        return html.replace(empty, area.html);
      });
  }

  for (const [name, cells] of [
    ['large hexagons, links at every width', [CELL, ...NEAR.slice(0, 3)]],
    ['small hexagons, links from a wider screen', FAR],
  ] as const) {
    for (const mapFirst of [false, true]) {
      test(`${mapFirst ? '/map' : '/'}: ${name}`, async () => {
        await scanPage(`Area map, ${name}`, await pageWith([...cells], mapFirst));
        const links = document.querySelectorAll('[data-testid="amap-area-link"]');
        expect(links.length, 'the drawing holds hexagon links').toBeGreaterThan(0);
        expect(document.querySelector('[data-testid="amap-svg"]')?.getAttribute('role')).toBe(
          'group'
        );
        // Each link is named by its area: number, place and event count.
        for (const a of links) {
          expect(a.querySelector('title')?.textContent).toMatch(
            /^Area \d+, Blue Island: \d+ events?$/
          );
        }
      });
    }
  }
});
