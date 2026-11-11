/**
 * OSE-1850 — golden renders of the four form pages, in every language.
 *
 * The English goldens were taken from form-pages.ts as it was before the forms
 * joined the language layer (the commit that adds this spec carries them,
 * before any source change). The PR that moves the forms onto the layer then
 * shows, in the diff of the English goldens, exactly what an English reader
 * gets that is new: the header Language menu (OSE-1943) and `dir="ltr"`. Every
 * English word stays as it was.
 *
 * The page is rendered by handleFormPage with a stub DB, as in
 * tests/form-pages-less-text.spec.ts. The CSP nonce is random per request, so
 * it is replaced by a fixed value before the comparison.
 *
 * .golden.txt on purpose: the commit hook runs prettier on staged .html.
 */
import { describe, it, expect } from 'vitest';
import { handleFormPage, type FormPagesEnv } from '../src/handlers/form-pages';
import type { EventFormScreen } from '../src/lib/canonical';

const EVENT = {
  id: 'evt_form_golden',
  brand_id: 'brand_golden',
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
  {
    id: 'evt_next_1',
    title: 'Winter Social',
    slug: 'winter-social',
    start_date: '2026-12-12',
    location: 'Hilton Oak Lawn',
  },
];

function stubDb(): D1Database {
  return {
    prepare: (sql: string) => ({
      bind: () => ({
        first: async () => (sql.includes('WHERE id = ?') ? EVENT : null),
        all: async () => ({ results: NEXT }),
      }),
    }),
  } as unknown as D1Database;
}

const SCREENS: EventFormScreen[] = ['register', 'checkin', 'survey', 'updates'];

async function render(screen: EventFormScreen): Promise<string> {
  const res = await handleFormPage(
    new Request(`https://t.test/events/${EVENT.id}/${screen}?deployment=dep_golden1`),
    { DB: stubDb() } as FormPagesEnv,
    EVENT.id,
    1,
    screen
  );
  return (await res.text()).replace(/nonce="[^"]*"/g, 'nonce="N"');
}

const dir = './__golden__/form-pages';

describe('OSE-1850 form pages | golden renders', () => {
  for (const screen of SCREENS) {
    it(`${screen}, en`, async () => {
      await expect(await render(screen)).toMatchFileSnapshot(`${dir}/${screen}.en.golden.txt`);
    });
  }
});
