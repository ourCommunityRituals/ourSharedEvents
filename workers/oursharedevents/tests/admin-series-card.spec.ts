/**
 * OSE-2019: the admin's Series card.
 *
 * The series routes (OSE ADR-029) had no screen. This card is where an
 * organizer starts a series from an event, takes an event off one, and answers
 * a suggestion the nightly detector made.
 *
 *   1. The card is in the page, hidden until an event is selected, built from
 *      classes that already exist (@ocr/ui's btn, card-title, sub-line and the
 *      page's `.create-form`, whose fields are 44 px tall with 16 px text). It
 *      adds no CSS, no `style=` and no raw colour.
 *   2. The schedule reads in words ("Every Monday at 5 PM"), for all five
 *      cadences, and never invents a day or a time a cadence does not state.
 *   3. The form sends only what its cadence states: no day for weekdays,
 *      neither for as-announced.
 *   4. Names from the server go in as text. A name that is markup stays text.
 *   5. The card's script calls the series routes and nothing else, and shows
 *      no count.
 *
 * Runs the page's real script text from the admin.html Text import, the way
 * tests/admin-sponsors-switch.spec.ts does.
 *
 * @born-red OSE-2019 | method: ran against the template before the card was
 * added (no markup, no helper, no click action): every test below failed. Then
 * planted, one at a time: `innerHTML` for the series name; a `style=` on the
 * button; a `.series-card{}` rule in the page; a day sent with daily-weekdays;
 * a fetch to another route | date: 2026-11-13
 */

import { describe, test, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { componentStyles } from '@ocr/ui';
import ADMIN_HTML_RAW from '../src/templates/admin.html';

const ADMIN_HTML = ADMIN_HTML_RAW.replace(/\r\n/g, '\n');

/** One `window.<name> = ...;` definition from the dashboard script, as source. */
function sourceOf(opener: string): string {
  const start = ADMIN_HTML.indexOf(opener);
  expect(start, `admin.html must define ${opener}`).toBeGreaterThan(-1);
  const end = ADMIN_HTML.indexOf('\n      };\n', start) + '\n      };'.length;
  return ADMIN_HTML.slice(start, end);
}

const OPENERS = {
  text: 'window.seriesScheduleText = function (s) {',
  body: 'window.seriesDeclareBody = function (f) {',
  fields: 'window.seriesCadenceFields = function (cadence) {',
  render: 'window.renderSeriesCard = function (id, data) {',
  load: 'window.loadEventSeries = async function (id) {',
  write: 'window.seriesWrite = async function (id, method, tail, body, btn) {',
};
const scriptText = () => Object.values(OPENERS).map(sourceOf).join('\n');

/** The series card, from its opening tag to the sponsors card that follows it. */
function card(): string {
  const from = ADMIN_HTML.indexOf(' id="series-card"');
  expect(from, 'the series card').toBeGreaterThan(-1);
  const start = ADMIN_HTML.lastIndexOf('<div', from);
  const end = ADMIN_HTML.indexOf('<!-- Sponsors', start);
  expect(end, 'the sponsors card follows').toBeGreaterThan(start);
  return ADMIN_HTML.slice(start, end);
}

function uiRule(sel: string): string {
  for (const before of ['\n', '}']) {
    const at = componentStyles.indexOf(`${before}${sel}{`);
    if (at === -1) continue;
    const start = at + before.length + sel.length + 1;
    return componentStyles.slice(start, componentStyles.indexOf('}', start));
  }
  return '';
}

function pageCss(): string {
  return [...ADMIN_HTML.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
}

type Win = Record<string, any>;

/** The card in a DOM, with the page's own series functions loaded. */
function mount(fetchImpl?: (url: string, init?: any) => Promise<any>) {
  const dom = new JSDOM(`<body>${card()}</body>`);
  const win = dom.window as unknown as Win;
  win._oseList = {
    byId: {
      'evt-1': { id: 'evt-1', title: 'Thursday Trivia Night', start_date: '2026-11-12' },
    },
  };
  win.fetch = fetchImpl ?? (async () => ({ ok: false, status: 500, json: async () => null }));
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('window', 'document', 'fetch', scriptText())(
    win,
    win.document,
    (u: string, i: any) => win.fetch(u, i)
  );
  const q = (id: string) => win.document.querySelector(`[data-testid="${id}"]`) as HTMLElement;
  return { win, doc: win.document as Document, q };
}

const SERIES = {
  id: 'evtsrs_1',
  name: 'Thursday trivia',
  cadence: 'weekly',
  day_of_week: 4,
  hour_of_day: 19,
  state: 'confirmed',
};

describe('the schedule in words', () => {
  const text = () => mount().win.seriesScheduleText as (s: unknown) => string;

  test.each([
    [{ cadence: 'weekly', day_of_week: 1, hour_of_day: 17 }, 'Every Monday at 5 PM'],
    [{ cadence: 'biweekly', day_of_week: 4, hour_of_day: 19 }, 'Every other Thursday at 7 PM'],
    [{ cadence: 'monthly', day_of_week: 6, hour_of_day: 10 }, 'Monthly, on a Saturday at 10 AM'],
    [{ cadence: 'daily-weekdays', day_of_week: null, hour_of_day: 17 }, 'Weekdays at 5 PM'],
    [{ cadence: 'as-announced', day_of_week: null, hour_of_day: null }, 'Dates as announced'],
    [{ cadence: 'weekly', day_of_week: 0, hour_of_day: 0 }, 'Every Sunday at 12 AM'],
    [{ cadence: 'weekly', day_of_week: 0, hour_of_day: 12 }, 'Every Sunday at 12 PM'],
  ])('%j reads as "%s"', (s, want) => {
    expect(text()(s)).toBe(want);
  });

  test('a day or an hour that is missing is left out, never made up', () => {
    expect(text()({ cadence: 'weekly', day_of_week: null, hour_of_day: null })).toBe('Weekly');
    expect(text()({ cadence: 'weekly', day_of_week: 1, hour_of_day: null })).toBe('Every Monday');
    expect(text()({ cadence: null })).toBe('');
    expect(text()(null)).toBe('');
  });

  test('a cadence the page does not know is shown as nothing, not as raw data', () => {
    expect(text()({ cadence: '<b>x</b>', day_of_week: 1, hour_of_day: 1 })).toBe('');
  });
});

describe('the form sends only what its cadence states', () => {
  const body = () => mount().win.seriesDeclareBody as (f: unknown) => Record<string, unknown>;
  const form = { name: '  Thursday trivia ', cadence: 'weekly', day: '4', hour: '19' };

  test('weekly, biweekly and monthly send a day and an hour, as numbers', () => {
    for (const cadence of ['weekly', 'biweekly', 'monthly']) {
      expect(body()({ ...form, cadence })).toEqual({
        name: 'Thursday trivia',
        cadence,
        day_of_week: 4,
        hour_of_day: 19,
      });
    }
  });

  test('weekdays sends an hour and no day', () => {
    expect(body()({ ...form, cadence: 'daily-weekdays' })).toEqual({
      name: 'Thursday trivia',
      cadence: 'daily-weekdays',
      hour_of_day: 19,
    });
  });

  test('as announced sends neither', () => {
    expect(body()({ ...form, cadence: 'as-announced' })).toEqual({
      name: 'Thursday trivia',
      cadence: 'as-announced',
    });
  });

  test('the body never carries anything but the four series fields', () => {
    const sent = body()({ ...form, email: 'someone@example.com', event_ids: ['x'] });
    expect(Object.keys(sent).sort()).toEqual(['cadence', 'day_of_week', 'hour_of_day', 'name']);
  });

  test('which fields each cadence shows', () => {
    const fields = mount().win.seriesCadenceFields as (c: string) => unknown;
    expect(fields('weekly')).toEqual({ day: true, hour: true });
    expect(fields('daily-weekdays')).toEqual({ day: false, hour: true });
    expect(fields('as-announced')).toEqual({ day: false, hour: false });
  });
});

describe('the card is in the page, built from what already exists', () => {
  test('it carries a title, a summary, the three parts and a status region, hidden to start', () => {
    const { doc, q } = mount();
    expect((q('series-card') as HTMLElement).hidden).toBe(true);
    expect(doc.querySelector('#series-card h2')!.textContent).toBe('Series');
    for (const id of [
      'series-summary',
      'series-on',
      'series-detach',
      'series-declare',
      'series-name',
      'series-cadence',
      'series-day',
      'series-hour',
      'series-declare-btn',
      'series-suggestions',
      'series-suggestion-list',
      'series-msg',
    ]) {
      expect(q(id), id).not.toBeNull();
    }
    expect(q('series-msg').getAttribute('role')).toBe('status');
  });

  test('every field has a label, and the cadence list is the five', () => {
    const { doc, q } = mount();
    for (const id of ['series-name', 'series-cadence', 'series-day', 'series-hour']) {
      expect(doc.querySelector(`label[for="${id}"]`), id).not.toBeNull();
    }
    const values = [...q('series-cadence').querySelectorAll('option')].map((o) => o.value);
    expect(values).toEqual(['weekly', 'biweekly', 'monthly', 'daily-weekdays', 'as-announced']);
    expect(q('series-day').querySelectorAll('option')).toHaveLength(7);
    expect(q('series-name').getAttribute('maxlength')).toBe('80');
  });

  test('buttons name their outcome and are real buttons', () => {
    const { q } = mount();
    expect(q('series-declare-btn').textContent!.trim()).toBe('Start the series');
    expect(q('series-detach').textContent!.trim()).toBe('Take this event off the series');
    for (const id of ['series-declare-btn', 'series-detach']) {
      expect(q(id).tagName).toBe('BUTTON');
      expect(q(id).getAttribute('type')).toBe('button');
      expect(q(id).classList.contains('btn')).toBe(true);
    }
  });

  test('44 px controls and 16 px fields come from rules that already exist', () => {
    expect(uiRule('.btn')).toContain('min-height:var(--tap-min)');
    const { q } = mount();
    // The fields sit in the page's `.create-form`: min-height 44px, font-size 16px.
    expect(q('series-name').closest('.create-form')).not.toBeNull();
    expect(pageCss()).toMatch(
      /\.create-form input, \.create-form select[^{]*\{[^}]*min-height: 44px[^}]*font-size: 16px/
    );
  });

  test('the card adds no CSS, no style attribute and no raw colour', () => {
    expect(card()).not.toMatch(/\sstyle=/);
    expect(card()).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    expect(pageCss()).not.toMatch(/series-/);
    expect(scriptText()).not.toMatch(/\.style\.|#[0-9a-fA-F]{6}\b/);
  });

  test('the card adds no h1: its title is an h2, its parts are h3', () => {
    expect(card()).not.toMatch(/<h1[\s>]/);
    const { doc } = mount();
    expect(doc.querySelectorAll('#series-card h2')).toHaveLength(1);
    expect(doc.querySelectorAll('#series-card h3').length).toBeGreaterThanOrEqual(2);
  });

  test('the click table routes the four actions', () => {
    for (const action of ['series-declare', 'series-detach', 'series-confirm', 'series-reject']) {
      expect(ADMIN_HTML, action).toContain(`'${action}': function (el)`);
    }
    expect(ADMIN_HTML).toContain("'series-cadence': function (el)");
    expect(ADMIN_HTML).toContain('window.loadEventSeries(d.id);');
  });
});

describe('the card shows what the server says', () => {
  test('an event on a series: its name and schedule, and the way off', () => {
    const { win, q } = mount();
    win.renderSeriesCard('evt-1', { series: SERIES, suggestions: [] });
    expect(q('series-card').hidden).toBe(false);
    expect(q('series-summary').textContent).toBe('Thursday trivia. Every Thursday at 7 PM.');
    expect(q('series-on').hidden).toBe(false);
    expect(q('series-declare').hidden).toBe(true);
    expect(q('series-detach').getAttribute('data-event-id')).toBe('evt-1');
  });

  test('an event on no series: the form, filled in from the event', () => {
    const { win, q } = mount();
    win.renderSeriesCard('evt-1', { series: null, suggestions: [] });
    expect(q('series-summary').textContent).toBe('This event is not part of a series.');
    expect(q('series-on').hidden).toBe(true);
    expect(q('series-declare').hidden).toBe(false);
    expect((q('series-name') as HTMLInputElement).value).toBe('Thursday Trivia Night');
    // 2026-11-12 is a Thursday.
    expect((q('series-day') as HTMLSelectElement).value).toBe('4');
    expect(q('series-hour').querySelectorAll('option')).toHaveLength(24);
    expect(q('series-suggestions').hidden).toBe(true);
  });

  test('suggestions: each with its schedule and two answers that name the series', () => {
    const { win, q } = mount();
    win.renderSeriesCard('evt-1', {
      series: null,
      suggestions: [
        { ...SERIES, id: 'evtsrs_s1', name: 'Thursday 7 PM (auto-detected)', state: 'pending' },
      ],
    });
    expect(q('series-suggestions').hidden).toBe(false);
    const items = q('series-suggestion-list').querySelectorAll('li');
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain('Thursday 7 PM (auto-detected)');
    expect(items[0].textContent).toContain('Every Thursday at 7 PM');
    const [yes, no] = [...items[0].querySelectorAll('button')];
    expect(yes.textContent).toBe('Yes, this is a series');
    expect(no.textContent).toBe('Not a series');
    for (const b of [yes, no]) {
      expect(b.getAttribute('data-series-id')).toBe('evtsrs_s1');
      expect(b.getAttribute('data-event-id')).toBe('evt-1');
      expect(b.classList.contains('btn')).toBe(true);
    }
    expect(yes.getAttribute('data-action')).toBe('series-confirm');
    expect(no.getAttribute('data-action')).toBe('series-reject');
  });

  test('a name that is markup stays text', () => {
    const { win, doc, q } = mount();
    const evil = '<img src=x onerror="window.pwned=1">';
    win.renderSeriesCard('evt-1', {
      series: { ...SERIES, name: evil },
      suggestions: [{ ...SERIES, id: 'evtsrs_s1', name: evil, state: 'pending' }],
    });
    expect(doc.querySelector('img')).toBeNull();
    expect(q('series-summary').textContent).toContain(evil);
    expect(win.pwned).toBeUndefined();
  });

  test('no event selected, or a failed read: the card says so and offers nothing', () => {
    const { win, q } = mount();
    win.renderSeriesCard('evt-1', null);
    expect(q('series-summary').textContent).toBe(
      'Could not read this event’s series. Reload the page to try again.'
    );
    expect(q('series-declare').hidden).toBe(true);
    expect(q('series-on').hidden).toBe(true);
    win.renderSeriesCard('nope', { series: null, suggestions: [] });
    expect(q('series-card').hidden).toBe(true);
  });
});

describe('the card talks to the series routes and nothing else', () => {
  test('load reads GET …/series for the event', async () => {
    const calls: Array<[string, any]> = [];
    const { win, q } = mount(async (url, init) => {
      calls.push([url, init]);
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, series: SERIES, suggestions: [] }),
      };
    });
    await win.loadEventSeries('evt-1');
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('/api/v2/admin/events/evt-1/series');
    expect(calls[0][1]).toBeUndefined();
    expect(q('series-summary').textContent).toContain('Thursday trivia');
  });

  test('a write sends JSON to the route, then reads the card again and says what happened', async () => {
    const calls: Array<[string, any]> = [];
    const { win, q } = mount(async (url, init) => {
      calls.push([url, init]);
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, series: SERIES, suggestions: [] }),
      };
    });
    await win.seriesWrite('evt-1', 'POST', '/confirm', {
      series_id: 'evtsrs_s1',
      event_ids: ['evt-1'],
    });
    expect(calls[0][0]).toBe('/api/v2/admin/events/evt-1/series/confirm');
    expect(calls[0][1].method).toBe('POST');
    expect(calls[0][1].headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(calls[0][1].body)).toEqual({ series_id: 'evtsrs_s1', event_ids: ['evt-1'] });
    expect(calls[1][0]).toBe('/api/v2/admin/events/evt-1/series');
    expect(q('series-msg').className).toBe('create-msg success');
  });

  test('a refused write says why, as an error, and changes nothing on screen by guessing', async () => {
    const { win, q } = mount(async (_url, init) =>
      init
        ? {
            ok: false,
            status: 409,
            json: async () => ({
              ok: false,
              error: 'An event is already part of a series; detach it first',
            }),
          }
        : { ok: true, status: 200, json: async () => ({ ok: true, series: null, suggestions: [] }) }
    );
    await win.seriesWrite('evt-1', 'POST', '', { name: 'x' });
    expect(q('series-msg').textContent).toBe(
      'An event is already part of a series; detach it first'
    );
    expect(q('series-msg').className).toBe('create-msg error');
  });

  test('the event id is encoded into the path', async () => {
    const calls: string[] = [];
    const { win } = mount(async (url) => {
      calls.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, series: null, suggestions: [] }),
      };
    });
    win._oseList.byId['a/b'] = { id: 'a/b', title: 't' };
    await win.loadEventSeries('a/b');
    expect(calls[0]).toBe('/api/v2/admin/events/a%2Fb/series');
  });

  test('the script never writes HTML, and names no route but the series one', () => {
    const src = scriptText();
    expect(src).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    const urls = [...src.matchAll(/'(\/api\/[^']*)'/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(0);
    expect([...new Set(urls)]).toEqual(['/api/v2/admin/events/']);
    expect(src).toContain("+ '/series'");
  });

  test('the card shows no count', () => {
    expect(card()).not.toMatch(/\b(scans?|attend|headcount|visitors?|people)\b/i);
    expect(scriptText()).not.toMatch(/distinct|headcount|scan_|\.count\b/);
  });
});
