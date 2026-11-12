/**
 * OSE-1850 (i18n slice C4) and OSE-1943 — the form pages on the language layer.
 *
 * Owner report 2026-11-10: "Does not translate to the selected language". A
 * reader who picked Spanish, Polish or Arabic on the event page and tapped into
 * check-in got an English page with no Language menu.
 *
 * Here, at the mock layer (handleFormPage with a stub DB; the page's scripts in
 * jsdom with a stubbed fetch, as in form-pages-less-text.spec.ts):
 *
 *   - every label, button, help line, confirmation and error is in the page's
 *     language, for every language in LANGUAGES, with `<html lang dir>`;
 *   - privacy and consent text keeps its English, marked `lang="en"`, with a
 *     plain note in the page's language (no machine translation, OSE-1850);
 *   - the header Language menu (both layouts) leads to the same form in each
 *     other language;
 *   - every link out of the form keeps the language;
 *   - the submission carries no language (nothing about it is stored);
 *   - negative, edge and fat-finger inputs: header garbage, a hostile query,
 *     an unknown event, an archived event, a typo'd id, a hostile title.
 *
 * The router side (prefix to page, 404s kept) is in the workers pool, in
 * language-path-prefix.spec.ts; staging is tests/e2e/3-flows.
 *
 * @born-red form pages in every language | method: this spec run against
 *   form-pages.ts as on main (0b3976a5, before the change): 163 of 218 cases
 *   fail. The 55 that pass there are the cases that must hold before and after:
 *   the English page's words, English errors and confirmations, the walk-in
 *   body, English for a garbled header, escaping, no cookie |
 *   date: 2026-11-11
 */
import { describe, test, expect, vi } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import { emailNextStep, handleFormPage, type FormPagesEnv } from '../src/handlers/form-pages';
import type { NextEventRow } from '../src/lib/next-at-venue';
import { PRODUCTION_ORIGIN, type EventFormScreen } from '../src/lib/canonical';
import { CATALOG, msg, type MessageKey } from '../src/lib/i18n/catalog';
import { formatHumanDate } from '../src/lib/event-datetime';
import { DEFAULT_LANG, DIRECTION, LANGUAGES, type Lang } from '../src/lib/i18n/languages';
import { withLangPrefix } from '../src/lib/i18n/path-prefix';

const EVENT = {
  id: 'evt_form_lang',
  brand_id: 'brand_lang',
  title: 'Danceventures in Toyland',
  slug: 'danceventures-in-toyland',
  status: 'active',
  description: null,
  location: 'Hilton Oak Lawn',
  where_address: '9333 S Cicero Ave',
  start_date: '2026-12-05',
  end_date: null,
  starts_at: '2026-12-06T00:00:00Z',
  timezone: 'America/Chicago',
};

const NEXT = [
  { id: 'evt_next_a', title: 'Winter Social!', start_date: '2026-12-12', location: 'Hilton' },
];

type Row = Record<string, unknown> | null;

function stubDb(row: Row = EVENT, next: unknown[] = NEXT): D1Database {
  return {
    prepare: (sql: string) => ({
      bind: () => ({
        first: async () => (sql.includes('WHERE id = ?') ? row : null),
        all: async () => ({ results: next }),
      }),
    }),
  } as unknown as D1Database;
}

const SCREENS: EventFormScreen[] = ['register', 'checkin', 'survey', 'updates'];
const OTHERS = LANGUAGES.filter((l) => l !== DEFAULT_LANG);

interface RenderOpts {
  lang?: Lang;
  accept?: string;
  query?: string;
  row?: Row;
  next?: unknown[];
  id?: string;
  tier?: number;
  env?: Partial<FormPagesEnv>;
}

async function respond(screen: EventFormScreen, o: RenderOpts = {}): Promise<Response> {
  const lang = o.lang ?? DEFAULT_LANG;
  const id = o.id ?? EVENT.id;
  const path = withLangPrefix(lang, `/events/${id}/${screen}`);
  return handleFormPage(
    new Request(`https://t.test${path}${o.query ?? ''}`, {
      headers: o.accept === undefined ? {} : { 'Accept-Language': o.accept },
    }),
    { DB: stubDb(o.row === undefined ? EVENT : o.row, o.next), ...o.env } as FormPagesEnv,
    id,
    o.tier ?? 1,
    screen,
    o.lang === undefined || o.lang === DEFAULT_LANG ? undefined : o.lang
  );
}

async function html(screen: EventFormScreen, o: RenderOpts = {}): Promise<string> {
  return (await respond(screen, o)).text();
}

/** The page parsed, scripts off: what the server wrote. */
async function doc(screen: EventFormScreen, o: RenderOpts = {}): Promise<Document> {
  return new JSDOM(await html(screen, o)).window.document;
}

interface Posted {
  url: string;
  body: Record<string, unknown>;
}

/** The page with its scripts running, fetch stubbed; returns what was posted. */
async function live(
  screen: EventFormScreen,
  lang: Lang,
  answer: (url: string) => { status: number; body: unknown } | 'reject',
  sponsors: unknown[] = []
) {
  const page = await html(screen, { lang });
  const posted: Posted[] = [];
  const errors: string[] = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => errors.push(String(e)));
  const dom = new JSDOM(page, {
    runScripts: 'dangerously',
    url: `https://t.test${withLangPrefix(lang, `/events/${EVENT.id}/${screen}`)}`,
    virtualConsole,
    beforeParse(window) {
      (window as unknown as { fetch: unknown }).fetch = async (
        url: string,
        init?: { body?: string }
      ) => {
        if (url.includes('/sponsor-bundle')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              bundle: { surface_sponsors: { mobileBanner: sponsors } },
            }),
          };
        }
        posted.push({ url, body: JSON.parse(init?.body ?? '{}') });
        const a = answer(url);
        if (a === 'reject') throw new TypeError('Failed to fetch');
        return { ok: a.status < 400, status: a.status, json: async () => a.body };
      };
    },
  });
  const d = dom.window.document;
  const settle = async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  };
  await settle();
  return { doc: d, window: dom.window, posted, errors, settle };
}

const OK = () => ({ status: 200, body: { ok: true } });

/** Every catalog key the form pages show. */
const FORM_KEYS = (Object.keys(CATALOG.en) as MessageKey[]).filter(
  (k) => k.startsWith('form.') && k !== 'form.eventFallback'
);
const SHELL_KEYS: MessageKey[] = [
  'page.skipContent',
  'back.label',
  'language.label',
  'menu.label',
  'sponsors.label',
  'sponsors.supportedBy',
  'cta.register',
  'calendar.label',
  'choices.checkinNote',
];

/**
 * The text and the reader-facing attributes of a page, without what is English
 * on purpose (`lang="en"`: the legal text), the language names in the menu
 * (each is in its own language or the page's), scripts and styles.
 */
function readerText(d: Document): string {
  const copy = d.documentElement.cloneNode(true) as HTMLElement;
  copy
    .querySelectorAll('script, style, [lang="en"], [data-testid="language-menu"] li')
    .forEach((el) => el.remove());
  const attrs = Array.from(copy.querySelectorAll('[placeholder], [aria-label], [title]'))
    .map((el) =>
      ['placeholder', 'aria-label', 'title'].map((a) => el.getAttribute(a) ?? '').join(' ')
    )
    .join(' ');
  return `${copy.textContent ?? ''} ${attrs}`;
}

/** A catalog value as the reader sees it (entities and tags gone). */
function plain(s: string): string {
  return new JSDOM(`<p>${s}</p>`).window.document.querySelector('p')!.textContent ?? '';
}

// ── The page is in its language ─────────────────────────────────────────────

describe('H1 | every form page, in every language, says what language it is in', () => {
  for (const lang of LANGUAGES) {
    for (const screen of SCREENS) {
      test(`${screen}, ${lang}: <html lang="${lang}" dir="${DIRECTION[lang]}">`, async () => {
        const d = await doc(screen, { lang });
        expect(d.documentElement.getAttribute('lang')).toBe(lang);
        expect(d.documentElement.getAttribute('dir')).toBe(DIRECTION[lang]);
      });
    }
  }
});

describe('H2 | no English word a reader sees on a page in another language', () => {
  for (const lang of OTHERS) {
    for (const screen of SCREENS) {
      test(`${screen}, ${lang}`, async () => {
        const text = readerText(await doc(screen, { lang }));
        for (const key of [...FORM_KEYS, ...SHELL_KEYS]) {
          const en = plain(msg('en', key));
          if (en === plain(msg(lang, key)) || key === 'form.privacy.englishNote') continue;
          // A short word may sit inside another one (e.g. "Menu" in "Menú").
          const pattern = new RegExp(
            `(^|[^\\p{L}])${en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`,
            'u'
          );
          expect(text, `${key} is still English: "${en}"`).not.toMatch(pattern);
        }
      });
    }
  }
});

describe('H3 | the words come from the catalog, per form', () => {
  for (const lang of LANGUAGES) {
    test(`check-in in ${lang}: heading, the round button, walk-in, and the promise`, async () => {
      const d = await doc('checkin', { lang });
      expect(d.querySelector('[data-testid="form-checkin"] h2')?.textContent).toBe(
        msg(lang, 'form.checkin.heading')
      );
      expect(d.querySelector('[data-testid="checkin-submit"]')?.innerHTML).toBe(
        msg(lang, 'form.checkin.tap').replace('<br/>', '<br>')
      );
      expect(d.querySelector('.walk-in-row')?.firstChild?.textContent?.trim()).toBe(
        msg(lang, 'form.checkin.noRegistration')
      );
      expect(d.querySelector('[data-testid="checkin-walk-in-submit"]')?.textContent).toBe(
        msg(lang, 'form.checkin.walkIn')
      );
      // The same promise, in the same words, as the event page's check-in choice.
      expect(d.querySelector('[data-testid="privacy-summary"]')?.textContent).toBe(
        msg(lang, 'choices.checkinNote')
      );
    });

    test(`register in ${lang}: heading, labels, help, placeholders, button`, async () => {
      const d = await doc('register', { lang });
      expect(d.querySelector('[data-testid="form-register"] h2')?.textContent).toBe(
        msg(lang, 'form.register.heading')
      );
      expect(d.querySelector('label[for="name"]')?.textContent).toBe(
        msg(lang, 'form.register.name')
      );
      expect(d.querySelector('label[for="email"]')?.textContent).toBe(
        msg(lang, 'form.register.email')
      );
      expect(d.querySelector('[data-testid="register-email-note"]')?.textContent).toBe(
        msg(lang, 'form.register.emailNote')
      );
      expect(d.getElementById('name')?.getAttribute('placeholder')).toBe(
        msg(lang, 'form.register.namePlaceholder')
      );
      expect(d.getElementById('email')?.getAttribute('placeholder')).toBe(
        msg(lang, 'form.register.emailPlaceholder')
      );
      expect(d.querySelector('[data-testid="register-submit"]')?.textContent).toBe(
        msg(lang, 'cta.register')
      );
    });

    test(`survey in ${lang}: heading, rating, each button's name, comments, submit`, async () => {
      const d = await doc('survey', { lang });
      expect(d.querySelector('[data-testid="form-survey"] h2')?.textContent).toBe(
        msg(lang, 'form.survey.heading')
      );
      expect(d.getElementById('rating-label')?.textContent).toBe(msg(lang, 'form.survey.rating'));
      for (const n of [1, 2, 3, 4, 5]) {
        const b = d.querySelector(`[data-testid="survey-rating-${n}"]`)!;
        expect(b.getAttribute('aria-label')).toBe(
          msg(lang, 'form.survey.rate').replace('{n}', String(n))
        );
        expect(b.textContent).toBe(String(n));
      }
      expect(d.querySelector('label[for="comments"]')?.textContent).toBe(
        msg(lang, 'form.survey.comments')
      );
      expect(d.getElementById('comments')?.getAttribute('placeholder')).toBe(
        msg(lang, 'form.survey.commentsPlaceholder')
      );
      expect(d.querySelector('[data-testid="survey-submit"]')?.textContent).toBe(
        msg(lang, 'form.survey.submit')
      );
    });

    test(`updates in ${lang}: heading, intro, label, placeholder, button`, async () => {
      const d = await doc('updates', { lang });
      expect(d.querySelector('[data-testid="form-email"] h2')?.textContent).toBe(
        msg(lang, 'form.email.heading')
      );
      expect(d.querySelector('.form-intro')?.textContent).toBe(msg(lang, 'form.email.intro'));
      expect(d.querySelector('label[for="email"]')?.textContent).toBe(
        msg(lang, 'form.email.label')
      );
      expect(d.getElementById('email')?.getAttribute('placeholder')).toBe(
        msg(lang, 'form.email.placeholder')
      );
      expect(d.querySelector('[data-testid="email-submit"]')?.textContent).toBe(
        msg(lang, 'form.email.submit')
      );
    });

    test(`the shell in ${lang}: skip link, sponsor strip name, Back`, async () => {
      const d = await doc('checkin', { lang });
      expect(d.querySelector('.skip-link')?.textContent).toBe(msg(lang, 'page.skipContent'));
      expect(d.getElementById('form-sponsor-strip')?.getAttribute('aria-label')).toBe(
        msg(lang, 'sponsors.label')
      );
      expect(d.querySelector('[data-testid="form-back"]')?.textContent).toBe(
        msg(lang, 'back.label')
      );
    });
  }
});

// ── Privacy and consent text: English, marked, with a note ──────────────────

describe('H4 | privacy and consent text stays English until a human translation and a legal read', () => {
  for (const lang of OTHERS) {
    for (const screen of SCREENS) {
      test(`${screen}, ${lang}: the details are English, marked lang="en", with a note in ${lang}`, async () => {
        const d = await doc(screen, { lang });
        const details = d.querySelector('[data-testid="privacy-details"]')!;
        expect(details.querySelector('summary')?.textContent).toBe(
          msg(lang, 'form.privacy.details')
        );
        const legal = details.querySelector('p')!;
        expect(legal.getAttribute('lang')).toBe('en');
        expect(legal.textContent).toContain('Legal basis:');
        expect(legal.textContent).toContain('supervisory authority');
        const note = d.querySelector('[data-testid="privacy-english-note"]');
        expect(note?.textContent).toBe(msg(lang, 'form.privacy.englishNote'));
        expect(note?.hasAttribute('lang')).toBe(false);
        const summary = d.querySelector('[data-testid="privacy-summary"]')!;
        // Check-in's line is the event page's own promise; the others are
        // retention text and keep their English.
        expect(summary.getAttribute('lang')).toBe(screen === 'checkin' ? null : 'en');
      });
    }
  }

  for (const screen of SCREENS) {
    test(`${screen}, en: no note and no lang marks (the page is English)`, async () => {
      const d = await doc(screen);
      expect(d.querySelector('[data-testid="privacy-english-note"]')).toBeNull();
      expect(d.querySelector('[data-testid="privacy-details"] p')?.hasAttribute('lang')).toBe(
        false
      );
      expect(d.querySelector('[data-testid="privacy-summary"]')?.hasAttribute('lang')).toBe(false);
    });
  }

  test('no catalog has a form key holding the legal text (no machine translation)', () => {
    for (const lang of LANGUAGES) {
      for (const [key, value] of Object.entries(CATALOG[lang])) {
        if (!key.startsWith('form.')) continue;
        expect(value, `${lang} ${key}`).not.toMatch(/\bGDPR\b|\bArt\. ?6|supervisory|\bPCI\b/);
      }
    }
  });

  test('a commerce tier adds its notice inside the English block, in every language', async () => {
    for (const lang of LANGUAGES) {
      const legal = (await doc('register', { lang, tier: 2 })).querySelector(
        '[data-testid="privacy-details"] p'
      )!;
      expect(legal.textContent, lang).toContain('Commerce notice:');
      expect(legal.getAttribute('lang'), lang).toBe(lang === DEFAULT_LANG ? null : 'en');
      const plain = (await doc('register', { lang })).querySelector(
        '[data-testid="privacy-details"] p'
      )!;
      expect(plain.textContent, lang).not.toContain('Commerce notice:');
    }
  });

  test('the full privacy policy link stays /privacy, English-only until OSE-1853', async () => {
    for (const lang of LANGUAGES) {
      const d = await doc('register', { lang });
      expect(
        d.querySelector('[data-testid="privacy-policy-link"]')?.getAttribute('href'),
        lang
      ).toBe('/privacy');
    }
  });
});

// ── The header Language menu ────────────────────────────────────────────────

describe('H5 | the header Language menu, at the start of the header, both layouts', () => {
  for (const lang of LANGUAGES) {
    for (const screen of SCREENS) {
      test(`${screen}, ${lang}: first in the header, current marked, others link to this form`, async () => {
        const d = await doc(screen, { lang, query: '?deployment=dep_menu1' });
        const header = d.querySelector('[data-testid="form-header"]')!;
        expect(header.firstElementChild?.getAttribute('data-testid')).toBe('form-topbar');
        const menu = header.querySelector('[data-testid="language-menu"]')!;
        expect(menu).not.toBeNull();
        expect(d.querySelectorAll('[data-testid="language-menu"]')).toHaveLength(1);
        for (const family of ['language-menu', 'site-menu-language']) {
          for (const other of LANGUAGES) {
            const item = menu.querySelector(`[data-testid="${family}-${other}"]`)!;
            if (other === lang) {
              expect(item.tagName).toBe('SPAN');
              expect(item.getAttribute('aria-current')).toBe('true');
            } else {
              expect(item.getAttribute('href')).toBe(
                `${withLangPrefix(other, `/events/${EVENT.id}/${screen}`)}?deployment=dep_menu1`
              );
            }
          }
        }
        // The button's word is in the page's language.
        expect(menu.querySelector('[data-testid="language-menu-button"]')?.textContent).toContain(
          msg(lang, 'language.label')
        );
      });
    }
  }

  test('the legacy /forms/<id>?type= address leads, by the menu, to the event form address', async () => {
    const res = await handleFormPage(
      new Request(`https://t.test/forms/${EVENT.id}?type=email`),
      { DB: stubDb() } as FormPagesEnv,
      EVENT.id
    );
    const d = new JSDOM(await res.text()).window.document;
    expect(d.querySelector('[data-testid="language-menu-es"]')?.getAttribute('href')).toBe(
      `/es/events/${EVENT.id}/updates`
    );
  });

  test('the menu sits in the same CSP nonce as the page (its one small script runs)', async () => {
    const page = await html('checkin', { lang: 'es' });
    const nonces = new Set(Array.from(page.matchAll(/<script nonce="([^"]+)"/g), (m) => m[1]));
    expect(nonces.size).toBe(1);
  });
});

// ── Links out keep the language ─────────────────────────────────────────────

describe('H6 | every link out of a form keeps the language', () => {
  for (const lang of LANGUAGES) {
    test(`${lang}: Back, back to the event page, and what's next at the venue`, async () => {
      const d = await doc('register', { lang });
      expect(d.querySelector('[data-testid="form-back"]')?.getAttribute('href')).toBe(
        withLangPrefix(lang, `/events/${EVENT.id}`)
      );
      const tpl = d.getElementById('form-next-step') as HTMLTemplateElement;
      const next = tpl.content;
      expect(
        next.querySelector('[data-testid="register-next-event-page"]')?.getAttribute('href')
      ).toBe(withLangPrefix(lang, `/events/${EVENT.id}/${EVENT.slug}`));
      expect(next.querySelector('[data-testid="register-next-event-page"]')?.textContent).toBe(
        msg(lang, 'form.next.eventPage')
      );
      // The calendar file is not a page: no language, same address.
      expect(
        next.querySelector('[data-testid="register-next-calendar"]')?.getAttribute('href')
      ).toBe(`/events/${EVENT.id}/calendar.ics`);
      expect(next.querySelector('[data-testid="register-next-calendar"]')?.textContent).toBe(
        msg(lang, 'calendar.label')
      );
      expect(next.querySelector('[data-testid="register-next-calendar-google"]')?.textContent).toBe(
        msg(lang, 'form.next.googleCalendar')
      );
      expect(next.querySelector('[data-testid="register-next-checkin"]')?.textContent).toBe(
        msg(lang, 'form.next.checkin')
      );

      const u = (await doc('updates', { lang })).getElementById(
        'form-next-step'
      ) as HTMLTemplateElement;
      const link = u.content.querySelector('[data-testid="email-next-venue-link-0"]')!;
      expect(link.getAttribute('href')).toBe(withLangPrefix(lang, '/events/evt_next_a'));
      // The date is in the page's language.
      expect(link.querySelector('.next-step-when')?.textContent).toBe(
        formatHumanDate('2026-12-12', lang)
      );
      expect(u.content.querySelector('#email-next-heading')?.textContent).toBe(
        msg(lang, 'next.atVenue').replace('{venue}', EVENT.location)
      );
    });

    test(`${lang}: nothing next at the venue links to the event list in the same language`, async () => {
      const d = await doc('updates', { lang, next: [] });
      const tpl = d.getElementById('form-next-step') as HTMLTemplateElement;
      const browse = tpl.content.querySelector('[data-testid="email-next-browse"]')!;
      expect(browse.getAttribute('href')).toBe(withLangPrefix(lang, '/events'));
      expect(browse.textContent).toBe(msg(lang, 'form.next.browse'));
    });

    test(`${lang}: a venue with no name reads "this venue" in the page's language`, () => {
      const out = emailNextStep({ ...EVENT, location: null }, NEXT as NextEventRow[], lang);
      const tpl = new JSDOM(out).window.document.getElementById(
        'form-next-step'
      ) as HTMLTemplateElement;
      expect(tpl.content.querySelector('#email-next-heading')?.textContent).toBe(
        msg(lang, 'next.atVenue').replace('{venue}', msg(lang, 'next.thisVenue'))
      );
    });
  }
});

// ── Arabic: typed text isolated ─────────────────────────────────────────────

describe('H7 | typed text on a right-to-left page is isolated; left-to-right pages are untouched', () => {
  test('ar: the event name, a next event title and the venue are each in <bdi>', async () => {
    const d = await doc('updates', { lang: 'ar' });
    expect(d.querySelector('[data-testid="form-event-name"]')?.innerHTML).toBe(
      `<bdi>${EVENT.title}</bdi>`
    );
    const tpl = d.getElementById('form-next-step') as HTMLTemplateElement;
    expect(
      tpl.content.querySelector('[data-testid="email-next-venue-link-0"] bdi')?.textContent
    ).toBe('Winter Social!');
    expect(tpl.content.querySelector('#email-next-heading bdi')?.textContent).toBe(EVENT.location);
  });

  for (const lang of ['en', 'es', 'pl'] as const) {
    test(`${lang}: no <bdi> anywhere the server wrote`, async () => {
      for (const screen of SCREENS) {
        const d = await doc(screen, { lang });
        const tpl = d.getElementById('form-next-step') as HTMLTemplateElement | null;
        expect(d.querySelector('bdi'), screen).toBeNull();
        expect(tpl?.content.querySelector('bdi') ?? null, screen).toBeNull();
      }
    });
  }

  test('ar: a hostile title is escaped and isolated, never markup', async () => {
    const d = await doc('checkin', {
      lang: 'ar',
      row: { ...EVENT, title: '<img src=x onerror=alert(1)>Night #3!' },
    });
    const name = d.querySelector('[data-testid="form-event-name"]')!;
    expect(name.querySelector('img')).toBeNull();
    expect(name.querySelector('bdi')?.textContent).toBe('<img src=x onerror=alert(1)>Night #3!');
  });

  // Staging T4i, 2026-11-12: the ar check-in page scrolled 9999 px sideways at
  // 375 px. The skip link sat at a physical `left: -9999px`, and on a
  // right-to-left page the overflow past the left edge is the scrollable side.
  // Placed by the reading start, as on the event page, it sits past the edge a
  // reader never scrolls to, in either direction.
  for (const lang of LANGUAGES) {
    test(`${lang}: the skip link hides and shows by the reading start, never a physical side`, async () => {
      for (const screen of SCREENS) {
        const page = await html(screen, { lang });
        const hidden = page.match(/\.skip-link\s*\{([^}]*)\}/)?.[1] ?? '';
        const shown = page.match(/\.skip-link:focus\s*\{([^}]*)\}/)?.[1] ?? '';
        expect(hidden, screen).toMatch(/inset-inline-start:\s*-9999px/);
        expect(shown, screen).toMatch(/inset-inline-start:\s*0/);
        for (const rule of [hidden, shown]) {
          expect(rule, screen).not.toMatch(/(^|[\s;])(left|right)\s*:/);
        }
      }
    });
  }
});

// ── In the browser: confirmations, errors, what is posted ───────────────────

describe('H8 | check-in in the browser, in each language', () => {
  for (const lang of LANGUAGES) {
    test(`${lang}: the tap confirms in ${lang}, posts to the unprefixed API, and sends no language`, async () => {
      const { doc: d, posted, errors, settle } = await live('checkin', lang, OK);
      (d.getElementById('checkin-btn') as HTMLButtonElement).click();
      await settle();
      expect(errors).toEqual([]);
      expect(d.getElementById('count')?.textContent).toBe(msg(lang, 'form.checkin.done'));
      expect(d.getElementById('checkin-btn')?.textContent).toBe(
        msg(lang, 'form.checkin.doneButton')
      );
      expect(posted).toHaveLength(1);
      expect(posted[0].url).toBe(`/api/v2/events/${EVENT.id}/forms/checkin`);
      expect(Object.keys(posted[0].body)).toEqual(['sourcePlacementId']);
    });

    test(`${lang}: the walk-in sends its arrival path and nothing about the language`, async () => {
      const { doc: d, posted, settle } = await live('checkin', lang, OK);
      (d.getElementById('walk-in-btn') as HTMLButtonElement).click();
      await settle();
      expect(posted[0].body).toEqual({ sourcePlacementId: null, arrival_path: 'walk_in' });
    });
  }
});

describe('H9 | confirmations after register, survey and updates', () => {
  for (const lang of LANGUAGES) {
    test(`${lang}: registered, with the next step in ${lang}`, async () => {
      const { doc: d, posted, settle } = await live('register', lang, OK);
      (d.getElementById('name') as HTMLInputElement).value = 'Ana';
      d.querySelector('[data-testid="register-form"]')!.dispatchEvent(
        new d.defaultView!.Event('submit', { bubbles: true, cancelable: true })
      );
      await settle();
      const success = d.querySelector('[data-testid="form-success"]')!;
      expect(success.querySelector('h2')?.textContent).toBe(msg(lang, 'form.register.done'));
      expect(success.querySelector('[data-testid="register-next-checkin"]')?.textContent).toBe(
        msg(lang, 'form.next.checkin')
      );
      expect(Object.keys(posted[0].body).sort()).toEqual(['name', 'sourcePlacementId']);
    });

    test(`${lang}: survey thanks`, async () => {
      const { doc: d, settle } = await live('survey', lang, OK);
      d.querySelector('[data-testid="survey-form"]')!.dispatchEvent(
        new d.defaultView!.Event('submit', { bubbles: true, cancelable: true })
      );
      await settle();
      expect(d.querySelector('[data-testid="form-success"] h2')?.textContent).toBe(
        msg(lang, 'form.survey.done')
      );
    });

    for (const duplicate of [false, true]) {
      test(`${lang}: updates, ${duplicate ? 'already on the list' : 'new'}`, async () => {
        const { doc: d, settle } = await live('updates', lang, () => ({
          status: 200,
          body: { ok: true, duplicate },
        }));
        (d.getElementById('email') as HTMLInputElement).value = 'a@b.co';
        d.querySelector('[data-testid="email-form"]')!.dispatchEvent(
          new d.defaultView!.Event('submit', { bubbles: true, cancelable: true })
        );
        await settle();
        expect(d.querySelector('[data-testid="form-success"] h2')?.textContent).toBe(
          msg(lang, duplicate ? 'form.email.already' : 'form.email.done')
        );
      });
    }
  }
});

describe('N1 | refusals read in the page language, and never echo the server', () => {
  const CASES: Array<[string, () => { status: number; body: unknown } | 'reject', MessageKey]> = [
    [
      'INVALID_EVENT_ID',
      () => ({ status: 400, body: { ok: false, code: 'INVALID_EVENT_ID' } }),
      'form.error.invalidEventId',
    ],
    [
      'INVALID_BODY',
      () => ({ status: 400, body: { ok: false, code: 'INVALID_BODY' } }),
      'form.error.invalidBody',
    ],
    [
      'PAYLOAD_TOO_LARGE',
      () => ({ status: 413, body: { ok: false, code: 'PAYLOAD_TOO_LARGE' } }),
      'form.error.payloadTooLarge',
    ],
    [
      'MISSING_FIELD',
      () => ({ status: 400, body: { ok: false, code: 'MISSING_FIELD' } }),
      'form.error.missingField',
    ],
    [
      'INVALID_EMAIL',
      () => ({ status: 400, body: { ok: false, code: 'INVALID_EMAIL' } }),
      'form.error.invalidEmail',
    ],
    [
      'CONFIG_ERROR',
      () => ({ status: 500, body: { ok: false, code: 'CONFIG_ERROR' } }),
      'form.error.configError',
    ],
    ['DB_ERROR', () => ({ status: 500, body: { ok: false, code: 'DB_ERROR' } }), 'form.error.busy'],
    [
      'METHOD_NOT_ALLOWED',
      () => ({ status: 405, body: { ok: false, code: 'METHOD_NOT_ALLOWED' } }),
      'form.error.methodNotAllowed',
    ],
    ['429, no code', () => ({ status: 429, body: { ok: false } }), 'form.error.tooMany'],
    ['503, no code', () => ({ status: 503, body: { ok: false } }), 'form.error.busy'],
    ['500, no code', () => ({ status: 500, body: { ok: false } }), 'form.error.server'],
    [
      '400, unknown code',
      () => ({ status: 400, body: { ok: false, code: 'NEW_CODE' } }),
      'form.error.generic',
    ],
    ['200 but not ok', () => ({ status: 200, body: { ok: false } }), 'form.error.generic'],
    // Fat finger on the server side: a code that is an object property name
    // must not reach the reader as "[object Object]" or a function's text.
    [
      'code "__proto__"',
      () => ({ status: 400, body: { ok: false, code: '__proto__' } }),
      'form.error.generic',
    ],
    [
      'code "toString"',
      () => ({ status: 500, body: { ok: false, code: 'toString' } }),
      'form.error.server',
    ],
    ['network down', () => 'reject', 'form.error.generic'],
  ];

  for (const lang of LANGUAGES) {
    for (const [name, answer, key] of CASES) {
      test(`${lang}: ${name}`, async () => {
        const { doc: d, settle } = await live('checkin', lang, answer);
        (d.getElementById('checkin-btn') as HTMLButtonElement).click();
        await settle();
        const err = d.querySelector('[data-testid="form-error"]')!;
        expect(err.textContent).toBe(msg(lang, key));
        // The tap stays live for a retry; no confirmation was shown.
        expect(d.getElementById('count')?.textContent).toBe('');
      });
    }
  }

  test('the friendly copy for a 4xx with no code is the generic line (the 400 branch is not lost)', async () => {
    const { doc: d, settle } = await live('checkin', 'es', () => ({
      status: 404,
      body: { ok: false },
    }));
    (d.getElementById('checkin-btn') as HTMLButtonElement).click();
    await settle();
    expect(d.querySelector('[data-testid="form-error"]')?.textContent).toBe(
      msg('es', 'form.error.generic')
    );
  });
});

describe('H10 | the sponsor strip and the thanks, in the page language; names as typed', () => {
  const SPONSORS = [
    { id: 'sp_1', title: 'TGI Fridays', logo_url: null },
    { id: 'sp_2', title: 'Hilton Chicago/Oak Lawn', logo_url: null },
  ];
  for (const lang of LANGUAGES) {
    test(`${lang}: "${msg(lang, 'sponsors.supportedBy')}" then the names`, async () => {
      const { doc: d, settle } = await live('checkin', lang, OK, SPONSORS);
      const strip = d.getElementById('form-sponsor-strip')!;
      expect(strip.querySelector('.strip-label')?.textContent).toBe(
        msg(lang, 'sponsors.supportedBy')
      );
      const names = Array.from(strip.querySelectorAll('.sponsor-name'));
      expect(names.map((n) => n.textContent)).toEqual(['TGI Fridays', 'Hilton Chicago/Oak Lawn']);
      expect(names.every((n) => (n.querySelector('bdi') !== null) === (lang === 'ar'))).toBe(true);

      void settle;
      // The thanks follows a confirmation (register), from the same fetched list.
      const reg = await live('register', lang, OK, SPONSORS);
      (reg.doc.getElementById('name') as HTMLInputElement).value = 'Ana';
      reg.doc
        .querySelector('[data-testid="register-form"]')!
        .dispatchEvent(new reg.window.Event('submit', { bubbles: true, cancelable: true }));
      await reg.settle();
      const thanks = reg.doc.querySelector('[data-testid="form-sponsor-thanks"]')!;
      expect(thanks.querySelector('.thanks-label')?.textContent).toBe(
        msg(lang, 'form.sponsorThanks')
      );
      const thanked = Array.from(thanks.querySelectorAll('.sponsor-name'));
      expect(thanked.map((n) => n.textContent)).toEqual(['TGI Fridays', 'Hilton Chicago/Oak Lawn']);
      expect(thanked.every((n) => (n.querySelector('bdi') !== null) === (lang === 'ar'))).toBe(
        true
      );
    });
  }

  test('a hostile sponsor name is escaped in every language', async () => {
    for (const lang of LANGUAGES) {
      const { doc: d } = await live('checkin', lang, OK, [
        { id: 'sp_x', title: '<img src=x onerror=alert(1)>', logo_url: null },
      ]);
      const strip = d.getElementById('form-sponsor-strip')!;
      expect(strip.querySelector('.sponsor-name img'), lang).toBeNull();
      expect(strip.querySelector('.sponsor-name')?.textContent, lang).toBe(
        '<img src=x onerror=alert(1)>'
      );
    }
  });
});

// ── Where the language comes from; negative and fat-finger cases ────────────

describe('E1 | the language source: the path first, then the header; nothing kept', () => {
  test('a bare address answers in the header language, and says it varies by it', async () => {
    const res = await respond('checkin', { accept: 'es-MX,es;q=0.9,en;q=0.5' });
    expect(res.headers.get('Vary')).toBe('Accept-Language');
    const d = new JSDOM(await res.text()).window.document;
    expect(d.documentElement.lang).toBe('es');
    expect(d.querySelector('[data-testid="form-checkin"] h2')?.textContent).toBe(
      msg('es', 'form.checkin.heading')
    );
  });

  test('a prefixed address beats the header, and does not vary by it', async () => {
    const res = await respond('checkin', { lang: 'pl', accept: 'ar' });
    expect(res.headers.get('Vary')).toBeNull();
    expect(new JSDOM(await res.text()).window.document.documentElement.lang).toBe('pl');
  });

  for (const accept of [
    '',
    '*',
    'xx-YY',
    'es;q=0',
    'q=1',
    ';;;,,,',
    'e'.repeat(4000),
    'english',
    'ES;q=abc',
  ]) {
    test(`fat finger: Accept-Language ${JSON.stringify(accept.slice(0, 12))} reads as English`, async () => {
      const res = await respond('register', { accept });
      expect(res.status).toBe(200);
      expect(new JSDOM(await res.text()).window.document.documentElement.lang).toBe('en');
    });
  }

  test('no cookie is set, in any language', async () => {
    for (const lang of LANGUAGES) {
      expect((await respond('checkin', { lang })).headers.get('Set-Cookie'), lang).toBeNull();
    }
  });
});

describe('N2 | a hostile or broken query never reaches the page or the menu', () => {
  for (const query of [
    '?deployment=%22%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E',
    '?deployment=dep_ok&lang=en',
    '?type=checkin&utm=%22%3E%3Cb%3E',
  ]) {
    test(`es, ${query}`, async () => {
      const page = await html('register', { lang: 'es', query });
      expect(page).not.toContain('<script>alert');
      expect(page).not.toContain('<b>');
      const d = new JSDOM(page).window.document;
      const href = d.querySelector('[data-testid="language-menu-en"]')!.getAttribute('href')!;
      expect(href).toMatch(/^\/events\/evt_form_lang\/register(\?deployment=dep_ok)?$/);
      // The page is Spanish whatever the query says.
      expect(d.documentElement.lang).toBe('es');
    });
  }
});

describe('E2 | edge cases', () => {
  for (const lang of LANGUAGES) {
    test(`${lang}: an event we cannot find is named "${msg(lang, 'form.eventFallback')}"`, async () => {
      const d = await doc('checkin', { lang, row: null });
      expect(d.querySelector('[data-testid="form-event-name"]')?.textContent).toBe(
        msg(lang, 'form.eventFallback')
      );
      expect(d.title).toBe(`${msg(lang, 'form.eventFallback')} – OurSharedEvents`);
    });
  }

  test('an archived event forwards to the event list in the same language', async () => {
    for (const lang of LANGUAGES) {
      const res = await respond('register', { lang, row: { ...EVENT, status: 'archived' } });
      expect(res.status, lang).toBe(302);
      expect(res.headers.get('Location'), lang).toBe(
        `https://t.test${withLangPrefix(lang, '/events')}`
      );
    }
  });

  test('a typo in the id (junk on the end) is mended; a prefix is kept, a bare address stays bare', async () => {
    const bare = await handleFormPage(
      new Request('https://t.test/forms/evt_form_lang.?type=checkin', {
        headers: { 'Accept-Language': 'es' },
      }),
      { DB: stubDb() } as FormPagesEnv,
      'evt_form_lang.'
    );
    expect(bare.status).toBe(302);
    expect(bare.headers.get('Location')).toBe('/events/evt_form_lang/checkin');
    // The mended address is this visitor's typo: no cache may keep it.
    expect(bare.headers.get('Cache-Control')).toBe('no-store');
    for (const lang of OTHERS) {
      const res = await handleFormPage(
        new Request(`https://t.test/${lang}/events/evt_form_lang./checkin`),
        { DB: stubDb() } as FormPagesEnv,
        'evt_form_lang.',
        1,
        'checkin',
        lang
      );
      expect(res.headers.get('Location'), lang).toBe(`/${lang}/events/evt_form_lang/register`);
    }
  });

  test(
    'the page scripts run without an error in every language (catalog text is script-safe)',
    { timeout: 60_000 },
    async () => {
      for (const lang of LANGUAGES) {
        for (const screen of SCREENS) {
          const { errors } = await live(screen, lang, OK);
          expect(errors, `${screen} ${lang}`).toEqual([]);
        }
      }
    }
  );

  test('a catalog value written into an attribute holds no quote that could end it', () => {
    const inAttributes: MessageKey[] = [
      'form.register.namePlaceholder',
      'form.register.emailPlaceholder',
      'form.survey.commentsPlaceholder',
      'form.email.placeholder',
      'form.survey.rate',
      'sponsors.label',
    ];
    for (const lang of LANGUAGES) {
      for (const key of inAttributes) expect(msg(lang, key), `${lang} ${key}`).not.toMatch(/["<>]/);
    }
  });
});

// Found by mutation testing (2026-11-11): what each answer carries besides its
// words. Each of these held before the change and must hold after it.

/** True when every text node directly inside `el` is blank: nothing stray between the parts. */
function onlyElements(el: Element | DocumentFragment): boolean {
  return Array.from(el.childNodes).every((n) => n.nodeType !== 3 || n.textContent!.trim() === '');
}

describe('E3 | headers, the log, and the parts around the words', () => {
  test('every form page says it is HTML in UTF-8, in every language', async () => {
    for (const lang of LANGUAGES) {
      for (const screen of SCREENS) {
        expect(
          (await respond(screen, { lang })).headers.get('Content-Type'),
          `${screen} ${lang}`
        ).toBe('text/html; charset=utf-8');
      }
    }
  });

  test('an archived event forward logs the surface and the state, and no one', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await respond('checkin', { lang: 'es', row: { ...EVENT, status: 'archived' } });
      const lines = log.mock.calls.map((c) => JSON.parse(String(c[0])));
      expect(lines).toContainEqual({
        type: 'STALE_EVENT_FORWARD',
        surface: 'form',
        event_id: EVENT.id,
        event_state: 'archived',
      });
    } finally {
      log.mockRestore();
    }
  });

  test('an event with an empty title is named by the fallback, in every language', async () => {
    for (const lang of LANGUAGES) {
      const d = await doc('register', { lang, row: { ...EVENT, title: '' } });
      expect(d.querySelector('[data-testid="form-event-name"]')?.textContent, lang).toBe(
        msg(lang, 'form.eventFallback')
      );
    }
  });

  test('in production the calendar entry links to the production event page', async () => {
    const d = await doc('register', { lang: 'es', env: { WORKER_ENV: 'production' } });
    const tpl = d.getElementById('form-next-step') as HTMLTemplateElement;
    const google = tpl.content
      .querySelector('[data-testid="register-next-calendar-google"]')!
      .getAttribute('href')!;
    expect(decodeURIComponent(google)).toContain(
      `${PRODUCTION_ORIGIN}/events/${EVENT.id}/${EVENT.slug}`
    );
    expect(decodeURIComponent(google)).not.toContain('https://t.test');
  });

  test('the old ?type=email address still gets the updates next step', async () => {
    const res = await handleFormPage(
      new Request(`https://t.test/forms/${EVENT.id}?type=email`),
      { DB: stubDb() } as FormPagesEnv,
      EVENT.id
    );
    const tpl = new JSDOM(await res.text()).window.document.getElementById(
      'form-next-step'
    ) as HTMLTemplateElement;
    expect(tpl.content.querySelector('[data-testid="email-next-step"]')).not.toBeNull();
    expect(tpl.content.querySelector('[data-testid="register-next-step"]')).toBeNull();
  });

  test('a form with no poster deployment has no deployment field and nothing in its place', async () => {
    for (const lang of LANGUAGES) {
      for (const screen of SCREENS) {
        const d = await doc(screen, { lang });
        expect(
          d.querySelector('[data-testid="form-deployment-id"]'),
          `${screen} ${lang}`
        ).toBeNull();
        for (const form of Array.from(d.querySelectorAll('form'))) {
          expect(onlyElements(form), `${screen} ${lang}`).toBe(true);
        }
      }
    }
  });

  test('two next events at the venue are two list items with nothing between them', async () => {
    const two = [
      ...NEXT,
      { id: 'evt_next_b', title: 'Spring Fling', start_date: '2027-03-20', location: 'Hilton' },
    ];
    for (const lang of LANGUAGES) {
      const tpl = (await doc('updates', { lang, next: two })).getElementById(
        'form-next-step'
      ) as HTMLTemplateElement;
      const list = tpl.content
        .querySelector('[data-testid="email-next-venue-link-1"]')!
        .closest('ul, ol')!;
      expect(list.querySelectorAll('li').length, lang).toBe(2);
      expect(onlyElements(list), lang).toBe(true);
    }
  });

  test('an event with no date has no calendar links and nothing in their place', async () => {
    for (const lang of LANGUAGES) {
      const tpl = (
        await doc('register', { lang, row: { ...EVENT, start_date: null, starts_at: null } })
      ).getElementById('form-next-step') as HTMLTemplateElement;
      const next = tpl.content.querySelector('[data-testid="register-next-step"]')!;
      expect(next.querySelector('[data-testid="register-next-calendar"]'), lang).toBeNull();
      expect(onlyElements(next), lang).toBe(true);
    }
  });

  test('a date Google cannot read keeps the calendar file and drops only the Google link', async () => {
    for (const lang of LANGUAGES) {
      const tpl = (
        await doc('register', { lang, row: { ...EVENT, start_date: 'TBD', starts_at: null } })
      ).getElementById('form-next-step') as HTMLTemplateElement;
      const next = tpl.content.querySelector('[data-testid="register-next-step"]')!;
      expect(next.querySelector('[data-testid="register-next-calendar"]'), lang).not.toBeNull();
      expect(next.querySelector('[data-testid="register-next-calendar-google"]'), lang).toBeNull();
      expect(onlyElements(next), lang).toBe(true);
    }
  });
});
