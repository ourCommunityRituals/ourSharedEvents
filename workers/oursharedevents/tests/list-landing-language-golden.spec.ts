/**
 * Part of OSE-1762 (i18n slice C, surface 1) — golden renders of /events and
 * the landing page, in English and Spanish.
 *
 * Moving the two pages onto the language layer must not change one byte of
 * the English page. The English golden files were taken from the renderers
 * before any source change (the commit that adds this spec carries them), so a
 * match here is the proof. The Spanish files are the reviewed Spanish page.
 *
 * Every state is rendered: the list with and without filters (each window, a
 * text search, a place and a zip, an empty answer), the error and the no-events
 * states; the landing with the map leading, with the list leading and the
 * example map, with no events at all, and for a zip that has events, one that
 * has none, one we do not know and a phone with no US zip.
 *
 * Deterministic: the clock is fixed, the event rows are the helper's own (the
 * data provider and the sponsor read are replaced), and the per-response CSP
 * nonce is blanked out. A Spanish page is rendered at its `/es` address, the
 * way the router serves it.
 *
 * Born red: change any English string these pages show (or any Spanish one)
 * and the matching golden fails.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { Lang } from '../src/lib/i18n/languages';
import { BEVERLY, BLUE_ISLAND, FEW, MANY, NOW } from './helpers/list-landing-rows';

const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], fail: false }));

vi.mock('../src/lib/data-provider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getDataProvider: () => ({
    listEvents: async () => {
      if (state.fail) throw new Error('read failed');
      return { data: state.rows, source: 'live', cacheAge: null };
    },
  }),
}));
vi.mock('../src/lib/sponsor-titles', async () => {
  const { SPONSORED_EVENT } = await import('./helpers/list-landing-rows');
  return { fetchSponsorTitles: async () => new Map([[SPONSORED_EVENT, 'Beggars Pizza']]) };
});

import { handlePublicPage, handleLandingPage } from '../src/handlers/pages';
import { renderAttendeeMap } from '../src/lib/attendee-map';
import { toPublicEvent } from '../src/lib/public-event-projection';

const LANGS: readonly Lang[] = ['en', 'es'];

function stable(html: string): string {
  return html.replace(/nonce="[^"]*"/g, 'nonce="N"').replace(/\r\n/g, '\n');
}

/** The page's address in a language (`/es/events?...`), as the router serves it. */
function at(lang: Lang, path: string): { request: Request; pathLang: Lang | undefined } {
  const prefix = lang === 'en' ? '' : `/${lang}`;
  return {
    request: new Request(`https://oursharedevents.com${prefix}${path}`),
    pathLang: lang === 'en' ? undefined : lang,
  };
}

async function eventsPage(query: string, rows: Record<string, unknown>[], lang: Lang) {
  state.rows = rows;
  const { request, pathLang } = at(lang, `/events${query}`);
  return stable(await (await handlePublicPage({} as never, null, request, pathLang)).text());
}

async function landingPage(query: string, rows: Record<string, unknown>[], lang: Lang) {
  state.rows = rows;
  const { request, pathLang } = at(lang, `/${query}`);
  return stable(await (await handleLandingPage({} as never, null, request, pathLang)).text());
}

const dir = './__golden__/list-landing';

type Case = { name: string; query: string; rows: () => Record<string, unknown>[] };

const EVENTS_CASES: Case[] = [
  { name: 'all', query: '', rows: () => MANY },
  { name: 'today', query: '?when=today', rows: () => MANY },
  { name: 'weekend', query: '?when=weekend', rows: () => MANY },
  { name: 'week', query: '?when=week', rows: () => MANY },
  { name: 'month', query: '?when=month', rows: () => MANY },
  { name: 'next-month', query: '?when=next-month', rows: () => MANY },
  { name: 'next-90', query: '?when=next-90', rows: () => MANY },
  { name: 'past', query: '?when=past', rows: () => MANY },
  { name: 'search', query: '?q=trivia', rows: () => MANY },
  { name: 'search-one', query: '?q=vinyl', rows: () => MANY },
  { name: 'search-none', query: '?when=month&q=zzzz', rows: () => MANY },
  { name: 'place', query: '?q=Blue+Island', rows: () => MANY },
  { name: 'place-none', query: '?q=Oak+Lawn', rows: () => MANY },
  { name: 'zip', query: '?q=60643', rows: () => MANY },
  { name: 'empty-window', query: '?when=today', rows: () => FEW },
  { name: 'only-wrapped', query: '', rows: () => [MANY[11]] },
  { name: 'no-events', query: '', rows: () => [] },
];

const LANDING_CASES: Case[] = [
  { name: 'map-leads', query: '', rows: () => MANY },
  { name: 'list-leads', query: '', rows: () => FEW },
  { name: 'no-events', query: '', rows: () => [] },
  { name: 'zip', query: '?zip=60406', rows: () => MANY },
  { name: 'zip-nothing-near', query: '?zip=60453', rows: () => MANY },
  { name: 'zip-unknown', query: '?zip=00000', rows: () => MANY },
  { name: 'no-us-zip', query: '?nozip=1', rows: () => MANY },
];

describe('OSE-1762 | /events and the landing | golden renders', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterAll(() => {
    vi.useRealTimers();
    state.fail = false;
  });

  for (const lang of LANGS) {
    for (const c of EVENTS_CASES) {
      it(`/events, ${c.name}, ${lang}`, async () => {
        await expect(await eventsPage(c.query, c.rows(), lang)).toMatchFileSnapshot(
          `${dir}/events-${c.name}.${lang}.golden.txt`
        );
      });
    }

    it(`/events, the read failed, ${lang}`, async () => {
      state.fail = true;
      try {
        await expect(await eventsPage('', MANY, lang)).toMatchFileSnapshot(
          `${dir}/events-error.${lang}.golden.txt`
        );
      } finally {
        state.fail = false;
      }
    });

    for (const c of LANDING_CASES) {
      it(`landing, ${c.name}, ${lang}`, async () => {
        await expect(await landingPage(c.query, c.rows(), lang)).toMatchFileSnapshot(
          `${dir}/landing-${c.name}.${lang}.golden.txt`
        );
      });
    }

    it(`landing, the read failed, ${lang}`, async () => {
      state.fail = true;
      try {
        await expect(await landingPage('', MANY, lang)).toMatchFileSnapshot(
          `${dir}/landing-error.${lang}.golden.txt`
        );
      } finally {
        state.fail = false;
      }
    });

    it(`the neighborhood map in each state, ${lang}`, async () => {
      const asItems = (rows: Record<string, unknown>[]) =>
        rows.map((r) =>
          toPublicEvent({
            ...r,
            name: r.title,
            startDateISO: r.start_date,
            venue: r.location,
            phase: 'pre_event',
          })
        );
      const now = NOW.getTime();
      const gate = (count: number) => ({ count, min: 10, latched: false });
      const parts = [
        // Under the per-corridor readiness number: the note, the example.
        renderAttendeeMap(asItems(FEW), { now, lang }).html,
        // Ready, and one latched corridor drawn below its number.
        renderAttendeeMap(asItems(MANY), { now, lang, latched: new Set([BLUE_ISLAND, BEVERLY]) })
          .html,
        // The landing's area gate: below it with one and with none so far, and
        // at it with nothing placeable.
        renderAttendeeMap(asItems(FEW), { now, lang, area: gate(1) }).html,
        renderAttendeeMap(asItems(FEW), { now, lang, area: gate(0) }).html,
        renderAttendeeMap(asItems(FEW.map((r) => ({ ...r, h3_res7: null }))), {
          now,
          lang,
          area: gate(12),
        }).html,
      ];
      await expect(parts.join('\n----\n') + '\n').toMatchFileSnapshot(
        `${dir}/corridor-map.${lang}.golden.txt`
      );
    });
  }
});
