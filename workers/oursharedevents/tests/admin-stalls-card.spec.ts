/**
 * OSE-1998: the admin's Stalls card.
 *
 * The stall routes (OSE ADR-034 decision 1) had no screen. This card is where
 * an organizer lists a fair's stalls, adds one or a pasted list, changes one,
 * takes one out of use, makes a code for one, and reads each stall's scans.
 *
 *   1. The card is in the page, hidden until an event is selected, built from
 *      classes that already exist (@ocr/ui's btn, card-title, sub-line,
 *      detail-card; the page's mcard-*, create-form, create-msg, pc-list,
 *      pd-link). It adds no CSS, no `style=`, no raw colour and no h1.
 *   2. The rules it checks a stall by are the server's: the categories and
 *      their words, the length caps and the bulk cap are a copy between
 *      markers held to lib/event-booths.ts and lib/booth-page-render.ts, and
 *      the stall check agrees with parseBoothCreate on every case below.
 *   3. A pasted list is checked line by line before anything is sent, and
 *      every refused line is named by its line number.
 *   4. What the server says goes in as text; a stored name that is markup stays
 *      text.
 *   5. A stall's scans read through oseFewerThan when withheld, never 0 and
 *      never a number under the floor; the plan cap reads as the poster list's
 *      does; the list keeps the organizer's order, never a count's.
 *   6. The card talks to the stall routes, the counts route and the poster
 *      list, and writes only through them.
 *
 * Runs the card's real script text from the admin.html Text import, the way
 * tests/admin-series-card.spec.ts does.
 *
 * @born-red OSE-1998 | method: written before the card existed and run against
 * the template on origin/main f62fb82 (no markup, no script, no click actions):
 * 66 of 66 failed. Then, with the card in, faults planted one at a time and
 * each seen red: the name set through innerHTML (1 red); a withheld count drawn
 * as its number (1); the plan note ignored (1); the list sorted by scans (10);
 * a duplicate number in the paste let through (1); the categories copy out of
 * step with the server (5) | date: 2026-11-16
 */

import { describe, test, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import ADMIN_HTML_RAW from '../src/templates/admin.html';
import {
  BOOTH_BULK_MAX,
  BOOTH_CATEGORIES,
  BOOTH_NAME_MAX,
  BOOTH_NUMBER_MAX,
  parseBoothCreate,
} from '../src/lib/event-booths';
import { BOOTH_CATEGORY_LABELS } from '../src/lib/booth-page-render';
import { installFewerThan } from './helpers/fewer-than';

const ADMIN_HTML = ADMIN_HTML_RAW.replace(/\r\n/g, '\n');

/** The Stalls card: its comment, markup and script, up to the Posters card. */
function card(): string {
  const start = ADMIN_HTML.indexOf('<!-- Stalls (OSE-1998');
  expect(start, 'the stalls card').toBeGreaterThan(-1);
  const end = ADMIN_HTML.indexOf('<!-- Posters', start);
  expect(end, 'the posters card follows').toBeGreaterThan(start);
  return ADMIN_HTML.slice(start, end);
}

/** The card's own script, without its <script> tags. */
function scriptText(): string {
  const c = card();
  const open = c.indexOf('<script>');
  const close = c.indexOf('</script>', open);
  expect(open, "the card's script").toBeGreaterThan(-1);
  return c.slice(open + '<script>'.length, close);
}

/** The card's markup only. */
function markup(): string {
  const c = card();
  return c.slice(0, c.indexOf('<script>'));
}

function pageCss(): string {
  return [...ADMIN_HTML.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
}

type Win = Record<string, any>;
type FetchImpl = (url: string, init?: any) => Promise<any>;

const EVENTS = {
  'evt-1': { id: 'evt-1', title: 'Harvest fair', status: 'active' },
  'evt-draft': { id: 'evt-draft', title: 'Spring fair', status: 'draft' },
};

/** The card in a DOM, with its script run against `fetchImpl`. */
function mount(fetchImpl?: FetchImpl) {
  const dom = new JSDOM(`<body>${markup()}</body>`);
  const win = dom.window as unknown as Win;
  win._oseList = { byId: { ...EVENTS } };
  installFewerThan(win);
  win.fetch = fetchImpl ?? (async () => ({ ok: false, status: 500, json: async () => null }));
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('window', 'document', 'fetch', 'oseFewerThan', scriptText())(
    win,
    win.document,
    (u: string, i: any) => win.fetch(u, i),
    win.oseFewerThan
  );
  const q = (id: string) => win.document.querySelector(`[data-testid="${id}"]`) as HTMLElement;
  const rows = () =>
    [...win.document.querySelectorAll('#stalls-list [data-testid="stall-row"]')] as HTMLElement[];
  const inRow = (row: Element, id: string) =>
    row.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  return { win, doc: win.document as Document, q, rows, inRow };
}

const WITHHELD = { count: null, suppressed: true, floor: 5 };
const shown = (n: number) => ({ count: n, suppressed: false, floor: 5 });

const booth = (id: string, number: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  event_id: 'evt-1',
  number,
  name,
  category: null,
  hall_x: null,
  hall_y: null,
  is_active: true,
  sort: 0,
  created_at: '2026-11-16T00:00:00Z',
  updated_at: '2026-11-16T00:00:00Z',
  ...extra,
});

const BOOTHS = [
  booth('booth_a', '1', 'Rosa Bakery', { category: 'food' }),
  booth('booth_b', '2', 'Pine Crafts', { category: 'craft' }),
  booth('booth_c', '9', 'Old Books', { is_active: false }),
];

const COUNTS = {
  ok: true,
  event_id: 'evt-1',
  booths: [
    {
      id: 'booth_a',
      number: '1',
      name: 'Rosa Bakery',
      category: 'food',
      is_active: true,
      scans: WITHHELD,
    },
    {
      id: 'booth_b',
      number: '2',
      name: 'Pine Crafts',
      category: 'craft',
      is_active: true,
      scans: shown(42),
    },
    {
      id: 'booth_c',
      number: '9',
      name: 'Old Books',
      category: null,
      is_active: false,
      scans: shown(7),
    },
  ],
  categories: [],
  no_stall: { placements: 2, scans: shown(12) },
  total: shown(61),
  any_withheld: true,
};

const PLACEMENT = {
  id: 'pd_1',
  booth_id: 'booth_b',
  placement_label: 'Stall 2 table card',
  scan_url: 'https://stg.example/q/qrt_1',
  qr_data_uri: 'data:image/png;base64,AAAA',
  is_active: 1,
};

function render(win: Win, data: unknown, id = 'evt-1') {
  win.renderStallsCard(id, data);
}

describe('the rules are the server’s, copied once and held to it', () => {
  test('the categories, their words and the caps match lib/event-booths.ts', () => {
    const { win } = mount();
    const B = win.OSE_BOOTH;
    expect(B.categories.map((c: string[]) => c[0])).toEqual([...BOOTH_CATEGORIES]);
    expect(Object.fromEntries(B.categories)).toEqual(BOOTH_CATEGORY_LABELS);
    expect(B.numberMax).toBe(BOOTH_NUMBER_MAX);
    expect(B.nameMax).toBe(BOOTH_NAME_MAX);
    expect(B.bulkMax).toBe(BOOTH_BULK_MAX);
  });

  test('the copy sits between markers, once, and nothing else lists the categories', () => {
    expect(ADMIN_HTML.split('@ose-booth-rules:begin').length - 1).toBe(1);
    expect(ADMIN_HTML.split('@ose-booth-rules:end').length - 1).toBe(1);
    const outside = scriptText().replace(/@ose-booth-rules:begin[\s\S]*@ose-booth-rules:end/, '');
    expect(outside).not.toMatch(/'clothing'|Food and drink/);
    expect(markup()).not.toMatch(/value="clothing"|Food and drink/);
  });

  test.each([
    ['12', 'Rosa Bakery', ''],
    ['  A3 ', '  Pine   Crafts  ', 'craft'],
    ['', 'No number', ''],
    ['123456789012345678901', 'Too long a number', ''],
    ['7', '', ''],
    ['7', 'x'.repeat(121), ''],
    ['7', 'x'.repeat(120), ''],
    ['7', 'rosa@example.com', ''],
    ['7', 'Call 312 555 0199', ''],
    ['7', 'Stall 1234567', ''],
    ['7', 'Bakery 2024', ''],
    ['7', 'Tab\there', ''],
    ['7\u0007', 'Bell', ''],
    ['7', 'Bakery', 'foods'],
    ['7', 'Bakery', 'other'],
  ])('the stall check agrees with the server on %j %j %j', (number, name, category) => {
    const { win } = mount();
    const mine = win.stallCheck({ number, name, category });
    const server = parseBoothCreate({ number, name, category: category || null });
    expect(mine.ok).toBe(server.ok);
    if (server.ok && mine.ok) {
      expect(mine.value).toEqual({
        number: server.value.number,
        name: server.value.name,
        category: server.value.category,
      });
    }
  });

  test('a category is read from its value or its words, in any case', () => {
    const { win } = mount();
    expect(win.stallCheck({ number: '1', name: 'A', category: 'FOOD' }).value.category).toBe(
      'food'
    );
    expect(
      win.stallCheck({ number: '1', name: 'A', category: 'food and drink' }).value.category
    ).toBe('food');
    const bad = win.stallCheck({ number: '1', name: 'A', category: 'snacks' });
    expect(bad.ok).toBe(false);
    expect(bad.field).toBe('category');
    expect(bad.reason).toContain('Food and drink');
  });

  test('each refusal names its field and says what to do, in words', () => {
    const { win } = mount();
    const email = win.stallCheck({ number: '1', name: 'rosa@example.com' });
    expect(email).toMatchObject({ ok: false, field: 'name' });
    expect(email.reason).toMatch(/email address/);
    const phone = win.stallCheck({ number: '1', name: '312 555 0199' });
    expect(phone).toMatchObject({ ok: false, field: 'name' });
    expect(phone.reason).toMatch(/phone number/);
    expect(win.stallCheck({ number: ' ', name: 'A' })).toMatchObject({
      ok: false,
      field: 'number',
    });
  });
});

describe('a pasted list is checked before anything is sent', () => {
  const check = (text: string, taken: string[] = []) => mount().win.stallsBulkCheck(text, taken);

  test('each line is number, trading name and an optional category, trimmed', () => {
    const r = check('12, Rosa Bakery, food\n  A3 ,Pine Crafts  \n');
    expect(r.ok).toBe(true);
    expect(r.refused).toEqual([]);
    expect(r.rows).toEqual([
      { line: 1, number: '12', name: 'Rosa Bakery', category: 'food' },
      { line: 2, number: 'A3', name: 'Pine Crafts', category: null },
    ]);
  });

  test('blank lines are skipped and every line keeps its own number', () => {
    const r = check('\n1, One\n\n   \n2, Two\n');
    expect(r.rows.map((x: any) => x.line)).toEqual([2, 5]);
  });

  test('a name with a comma is quoted; "" is a quote inside one', () => {
    const r = check('4, "Smith, Jones & Co", craft\n5, "The ""Best"" Bread"');
    expect(r.ok).toBe(true);
    expect(r.rows[0]).toMatchObject({ number: '4', name: 'Smith, Jones & Co', category: 'craft' });
    expect(r.rows[1]).toMatchObject({ number: '5', name: 'The "Best" Bread', category: null });
  });

  test('a line pasted from a spreadsheet is split on tabs, and its commas are the name’s', () => {
    const r = check('6\tSmith, Jones & Co\tFood and drink');
    expect(r.rows).toEqual([{ line: 1, number: '6', name: 'Smith, Jones & Co', category: 'food' }]);
  });

  test('an unquoted comma in a name is refused with its line and how to fix it', () => {
    const r = check('1, One\n2, Smith, Jones & Co');
    expect(r.ok).toBe(false);
    expect(r.rows.map((x: any) => x.line)).toEqual([1]);
    expect(r.refused).toHaveLength(1);
    expect(r.refused[0].line).toBe(2);
    expect(r.refused[0].reason).toMatch(/double quotes/);
  });

  test('more than three parts, or a quote left open, is refused', () => {
    const r = check('1, A, food, extra\n2, "Open quote, food');
    expect(r.refused.map((x: any) => x.line)).toEqual([1, 2]);
    // Empty trailing columns from a spreadsheet export are not parts.
    expect(check('3, C, food,,').ok).toBe(true);
  });

  test('every refused line is named, with the server’s reasons', () => {
    const r = check('1, rosa@example.com\n, No number\n3, Bakery, snacks\n4, Fine');
    expect(r.refused.map((x: any) => x.line)).toEqual([1, 2, 3]);
    expect(r.refused[0].reason).toMatch(/email address/);
    expect(r.refused[2].reason).toMatch(/not a category/);
    expect(r.rows.map((x: any) => x.number)).toEqual(['4']);
    expect(r.ok).toBe(false);
  });

  test('two lines with one number are both refused, in any case', () => {
    const r = check('a1, One\n2, Two\nA1, Three');
    expect(r.refused.map((x: any) => x.line)).toEqual([1, 3]);
    expect(r.refused[0].reason).toMatch(/line 3/i);
    expect(r.refused[1].reason).toMatch(/line 1/i);
    expect(r.rows.map((x: any) => x.line)).toEqual([2]);
  });

  test('a number this fair already has, in use or not, is refused', () => {
    const r = check('9, New name\n10, Ten', ['9']);
    expect(r.refused).toHaveLength(1);
    expect(r.refused[0].line).toBe(1);
    expect(r.refused[0].reason).toMatch(/already/);
  });

  test('over the cap refuses the whole list and says the cap', () => {
    const lines = Array.from({ length: BOOTH_BULK_MAX + 1 }, (_, i) => `${i + 1}, Stall ${i + 1}`);
    const r = check(lines.join('\n'));
    expect(r.ok).toBe(false);
    expect(r.rows).toEqual([]);
    expect(r.over).toBe(BOOTH_BULK_MAX + 1);
    const at = check(lines.slice(0, BOOTH_BULK_MAX).join('\n'));
    expect(at.ok).toBe(true);
    expect(at.rows).toHaveLength(BOOTH_BULK_MAX);
  });

  test('an empty paste is not a list', () => {
    expect(check('  \n ').ok).toBe(false);
  });
});

describe('the card is in the page, built from what already exists', () => {
  test('it is hidden to start, with a title, a summary, its parts and a status region', () => {
    const { doc, q } = mount();
    expect(q('stalls-card').hidden).toBe(true);
    expect(doc.querySelector('#stalls-card h2')!.textContent).toBe('Stalls');
    for (const id of [
      'stalls-summary',
      'stalls-toggle',
      'stalls-body',
      'stalls-list',
      'stalls-add',
      'stall-number-input',
      'stall-name-input',
      'stall-category-input',
      'stall-add-btn',
      'stalls-bulk',
      'stalls-bulk-text',
      'stalls-bulk-check',
      'stalls-bulk-save',
      'stalls-msg',
    ]) {
      expect(q(id), id).not.toBeNull();
    }
    expect(q('stalls-msg').getAttribute('role')).toBe('status');
  });

  test('every field has a label and sits in the page’s 44 px / 16 px form rows', () => {
    const { doc, q } = mount();
    for (const id of ['stall-number', 'stall-name', 'stall-category', 'stalls-bulk-text']) {
      expect(doc.querySelector(`label[for="${id}"]`), id).not.toBeNull();
      expect(doc.getElementById(id)!.closest('.create-form'), id).not.toBeNull();
    }
    expect(pageCss()).toMatch(
      /\.create-form input, \.create-form select, \.create-form textarea[^{]*\{[^}]*min-height: 44px[^}]*font-size: 16px/
    );
    expect(q('stall-number-input').getAttribute('maxlength')).toBe(String(BOOTH_NUMBER_MAX));
    expect(q('stall-name-input').getAttribute('maxlength')).toBe(String(BOOTH_NAME_MAX));
  });

  test('the category list is filled from the rules, with "No category" first', () => {
    const { win, q } = mount();
    render(win, { booths: [], counts: null, placements: [] });
    const opts = [...q('stall-category-input').querySelectorAll('option')];
    expect(opts.map((o) => (o as HTMLOptionElement).value)).toEqual(['', ...BOOTH_CATEGORIES]);
    expect(opts[0].textContent).toBe('No category');
    expect(opts[1].textContent).toBe('Food and drink');
  });

  test('the bulk help says the cap from the rules', () => {
    const { win, q } = mount();
    render(win, { booths: [], counts: null, placements: [] });
    expect(q('stalls-bulk-hint').textContent).toContain(`Up to ${BOOTH_BULK_MAX} stalls`);
  });

  test('buttons are real buttons with the house button classes', () => {
    const { doc } = mount();
    const buttons = [
      ...doc.querySelectorAll('#stalls-card button'),
      ...[...doc.querySelectorAll('#stalls-card template')].flatMap((t) => [
        ...(t as HTMLTemplateElement).content.querySelectorAll('button'),
      ]),
    ];
    expect(buttons.length).toBeGreaterThanOrEqual(10);
    for (const b of buttons) {
      expect(b.getAttribute('type'), b.outerHTML).toBe('button');
      expect(b.classList.contains('btn'), b.outerHTML).toBe(true);
      expect(b.getAttribute('data-action'), b.outerHTML).toBeTruthy();
    }
  });

  test('the card adds no CSS, no style attribute, no raw colour and no h1', () => {
    expect(card()).not.toMatch(/\sstyle=/);
    expect(card()).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    expect(pageCss()).not.toMatch(/[.#][\w-]*stall/);
    expect(scriptText()).not.toMatch(/\.style\b/);
    expect(card()).not.toMatch(/<h1[\s>]/);
  });

  test('the click table routes every action the card uses', () => {
    const used = new Set(
      [...card().matchAll(/data-action="([^"]+)"/g)]
        .map((m) => m[1])
        .filter((a) => a !== 'pd-print' && a !== 'ecb-jump')
    );
    expect(used.size).toBeGreaterThanOrEqual(10);
    for (const action of used) expect(ADMIN_HTML, action).toContain(`'${action}': function (el)`);
    expect(scriptText()).toContain("window.addEventListener('ose:event-selected'");
  });
});

describe('the card shows what the server says', () => {
  test('no event selected: hidden', () => {
    const { win, q } = mount();
    render(win, { booths: [], counts: null, placements: [] }, 'nope');
    expect(q('stalls-card').hidden).toBe(true);
  });

  test('a failed read says so and offers nothing', () => {
    const { win, q } = mount();
    render(win, null);
    expect(q('stalls-card').hidden).toBe(false);
    expect(q('stalls-summary').textContent).toBe(
      'Could not read this event’s stalls. Reload the page to try again.'
    );
    expect(q('stalls-add').hidden).toBe(true);
    expect(q('stalls-bulk').hidden).toBe(true);
  });

  test('(1) no stalls: the empty state in words', () => {
    const { win, q, rows } = mount();
    render(win, { booths: [], counts: { ...COUNTS, booths: [], total: WITHHELD }, placements: [] });
    expect(q('stalls-summary').textContent).toBe('No stalls yet.');
    expect(q('stalls-empty').hidden).toBe(false);
    expect(q('stalls-empty').textContent).toMatch(/No stalls yet/);
    expect(rows()).toHaveLength(0);
    expect(q('stalls-add').hidden).toBe(false);
  });

  test('(2) stalls in and out of use, in the server’s order, each with its actions', () => {
    const { win, q, rows, inRow } = mount();
    render(win, { booths: BOOTHS, counts: COUNTS, placements: [] });
    expect(q('stalls-summary').textContent).toBe('2 stalls in use, 1 out of use.');
    expect(q('stalls-empty').hidden).toBe(true);
    const r = rows();
    expect(r.map((x) => inRow(x, 'stall-row-number')!.textContent)).toEqual([
      'Stall 1',
      'Stall 2',
      'Stall 9',
    ]);
    expect(inRow(r[0], 'stall-row-name')!.textContent).toBe('Rosa Bakery');
    expect(inRow(r[0], 'stall-row-category')!.textContent).toBe('Food and drink');
    expect(inRow(r[2], 'stall-row-category')).toBeNull();
    // In use: change, make a code, take out of use. Out of use: change, put back.
    const actions = (row: Element) =>
      [...row.querySelectorAll('[data-testid="stall-row-actions"] button')].map((b) =>
        b.getAttribute('data-action')
      );
    expect(actions(r[0])).toEqual(['stall-edit', 'stall-code', 'stall-out']);
    expect(actions(r[2])).toEqual(['stall-edit', 'stall-back']);
    expect(inRow(r[0], 'stall-row-state')).toBeNull();
    expect(inRow(r[2], 'stall-row-state')!.textContent).toMatch(
      /^Out of use\. Its codes still point at it/
    );
    for (const b of r[0].querySelectorAll('button')) {
      expect(b.getAttribute('data-booth-id')).toBe('booth_a');
      expect(b.getAttribute('aria-label')).toMatch(/stall 1$/);
    }
  });

  test('the order is the organizer’s even when counts would rank it otherwise', () => {
    const { win, rows, inRow } = mount();
    const counts = {
      ...COUNTS,
      booths: COUNTS.booths.map((b, i) => ({ ...b, scans: shown(100 - i * 40) })).reverse(),
    };
    render(win, { booths: BOOTHS, counts, placements: [] });
    expect(rows().map((x) => inRow(x, 'stall-row-number')!.textContent)).toEqual([
      'Stall 1',
      'Stall 2',
      'Stall 9',
    ]);
    expect(scriptText()).not.toMatch(/\.sort\(/);
  });

  test('(3) a name that is markup stays text, in the list, the codes and the edit form', () => {
    const { win, doc, rows, inRow } = mount();
    const evil = '<img src=x onerror="window.pwned=1">';
    render(win, {
      booths: [booth('booth_x', '<b>7</b>', evil)],
      counts: null,
      placements: [{ ...PLACEMENT, booth_id: 'booth_x', placement_label: evil }],
    });
    const row = rows()[0];
    expect(inRow(row, 'stall-row-name')!.textContent).toBe(evil);
    expect(inRow(row, 'stall-row-number')!.textContent).toBe('Stall <b>7</b>');
    expect(inRow(row, 'stall-code-label')!.textContent).toBe(evil);
    win.stallEditOpen(inRow(row, 'stall-row-edit'));
    expect((row.querySelector('[data-field="name"]') as HTMLInputElement).value).toBe(evil);
    win.stallOutAsk(row.querySelector('[data-action="stall-out"]'));
    expect(doc.querySelector('img')).toBeNull();
    expect(doc.querySelector('b')).toBeNull();
    expect(win.pwned).toBeUndefined();
    expect(scriptText()).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });

  test('(4) a withheld count reads in words, a published one as its number, never 0', () => {
    const { win, q, rows, inRow } = mount();
    render(win, { booths: BOOTHS, counts: COUNTS, placements: [] });
    const r = rows();
    expect(inRow(r[0], 'stall-row-scans')!.textContent).toBe('Fewer than 5 scans in any hour');
    expect(inRow(r[1], 'stall-row-scans')!.textContent).toBe('42 scans');
    expect(inRow(r[2], 'stall-row-scans')!.textContent).toBe('7 scans');
    expect(q('stalls-total').textContent).toBe('The whole fair: 61 scans');
    expect(q('stalls-no-stall').hidden).toBe(false);
    expect(q('stalls-no-stall').textContent).toBe('Codes at no stall: 12 scans');
  });

  test('a count that is not a published number at or over the floor is never drawn as one', () => {
    const { win, q, rows, inRow } = mount();
    const odd = [
      { count: 0, suppressed: false, floor: 5 },
      { count: 3, suppressed: false, floor: 5 },
      { count: 9, suppressed: true, floor: 5 },
    ];
    render(win, {
      booths: BOOTHS,
      counts: {
        ...COUNTS,
        booths: COUNTS.booths.map((b, i) => ({ ...b, scans: odd[i] })),
        total: WITHHELD,
        no_stall: { placements: 0, scans: WITHHELD },
      },
      placements: [],
    });
    for (const row of rows()) {
      expect(inRow(row, 'stall-row-scans')!.textContent).toBe('Fewer than 5 scans in any hour');
    }
    expect(q('stalls-total').textContent).toBe('The whole fair: Fewer than 5 scans in any hour');
    expect(q('stalls-no-stall').textContent).toBe(
      'Codes at no stall: Fewer than 5 scans in any hour'
    );
  });

  test('(5) on a capped plan each stall says so as the poster list does; the fair total stays', () => {
    const { win, q, rows, inRow } = mount();
    const capped = {
      ok: true,
      event_id: 'evt-1',
      booths: COUNTS.booths.map(({ scans: _s, ...b }) => b),
      categories: [],
      no_stall: { placements: 2 },
      total: shown(61),
      plan: {
        paid_report: false,
        locked_sections: ['booths.scans', 'categories.scans', 'no_stall.scans', 'any_withheld'],
        next_plan: 'mid',
      },
    };
    render(win, { booths: BOOTHS, counts: capped, placements: [] });
    for (const row of rows()) {
      expect(inRow(row, 'stall-row-scans')!.textContent).toBe('Scan counts come with the Mid plan');
    }
    expect(q('stalls-total').textContent).toBe('The whole fair: 61 scans');
    expect(q('stalls-no-stall').hidden).toBe(true);
    // The poster list's own words, so the two read the same.
    expect(ADMIN_HTML).toContain("? 'Scan counts come with the Mid plan'");
  });

  test('counts that could not be read are not drawn as withheld', () => {
    const { win, q, rows, inRow } = mount();
    render(win, { booths: BOOTHS, counts: null, placements: [] });
    for (const row of rows()) {
      expect(inRow(row, 'stall-row-scans')!.textContent).toBe(
        'Scan counts could not be read just now'
      );
    }
    expect(q('stalls-total').hidden).toBe(true);
    expect(q('stalls-no-stall').hidden).toBe(true);
  });

  test('a stall’s codes are listed with the placement card’s own print action', () => {
    const { win, rows, inRow } = mount();
    win._pdItems = new Map();
    render(win, { booths: BOOTHS, counts: COUNTS, placements: [PLACEMENT] });
    const r = rows();
    expect(inRow(r[0], 'stall-codes')!.hidden).toBe(true);
    const codes = r[1].querySelectorAll('[data-testid="stall-code"]');
    expect(codes).toHaveLength(1);
    expect(inRow(codes[0], 'stall-code-label')!.textContent).toBe('Stall 2 table card');
    expect(inRow(codes[0], 'stall-code-link')!.textContent).toBe('https://stg.example/q/qrt_1');
    const print = inRow(codes[0], 'stall-code-print')!;
    expect(print.getAttribute('data-action')).toBe('pd-print');
    expect(print.getAttribute('data-pd-id')).toBe('pd_1');
    const jump = inRow(codes[0], 'stall-code-posters')!;
    expect(jump.getAttribute('data-action')).toBe('ecb-jump');
    expect(jump.getAttribute('data-target')).toBe('poster-deployments-card');
    // printPosterQr reads the placement from the same map the Posters card fills.
    expect(win._pdItems.get('pd_1')).toEqual({
      qr_data_uri: 'data:image/png;base64,AAAA',
      scan_url: 'https://stg.example/q/qrt_1',
      label: 'Stall 2 table card',
    });
  });

  test('a placement’s QR that is not a data:image is never kept', () => {
    const { win } = mount();
    win._pdItems = new Map();
    render(win, {
      booths: BOOTHS,
      counts: COUNTS,
      placements: [{ ...PLACEMENT, qr_data_uri: 'javascript:alert(1)' }],
    });
    expect(win._pdItems.get('pd_1').qr_data_uri).toBe('');
  });

  test('a live fair links each stall in use to its public page', () => {
    const { win, q, rows, inRow } = mount();
    render(win, {
      booths: [...BOOTHS, booth('booth_d', 'A 1/2', 'Odd number')],
      counts: COUNTS,
      placements: [],
    });
    const r = rows();
    const link = inRow(r[0], 'stall-row-public-link') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/events/evt-1/booths/1');
    expect(link.textContent).toBe('Open the public page of stall 1');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(inRow(r[2], 'stall-row-public-link')).toBeNull();
    expect(inRow(r[3], 'stall-row-public-link')!.getAttribute('href')).toBe(
      '/events/evt-1/booths/A%201%2F2'
    );
    expect(q('stalls-public-note').hidden).toBe(true);
  });

  test('a fair that is not live says when the pages open, and links none', () => {
    const { win, q, rows, inRow } = mount();
    render(win, { booths: BOOTHS, counts: COUNTS, placements: [] }, 'evt-draft');
    expect(rows().every((x) => inRow(x, 'stall-row-public-link') === null)).toBe(true);
    expect(q('stalls-public-note').hidden).toBe(false);
    expect(q('stalls-public-note').textContent).toBe(
      'Each stall in use gets its own public page once the fair is live.'
    );
  });

  test('Show and Hide fold the card’s body', () => {
    const { win, q } = mount();
    render(win, { booths: BOOTHS, counts: COUNTS, placements: [] });
    expect(q('stalls-body').hidden).toBe(true);
    win.stallsToggle(q('stalls-toggle'));
    expect(q('stalls-body').hidden).toBe(false);
    expect(q('stalls-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(q('stalls-toggle').textContent).toBe('Hide');
  });
});

/** A fetch that answers the card's three reads and records every call. */
function server(overrides: Record<string, (init?: any) => { status: number; body: any }> = {}) {
  const calls: Array<{ url: string; init?: any }> = [];
  const impl: FetchImpl = async (url, init) => {
    calls.push({ url, init });
    const key = `${init?.method ?? 'GET'} ${url}`;
    const hit = overrides[key];
    const answer = hit
      ? hit(init)
      : url.endsWith('/booths')
        ? { status: 200, body: { ok: true, booths: BOOTHS } }
        : url.endsWith('/booths/counts')
          ? { status: 200, body: COUNTS }
          : url.endsWith('/poster-deployments')
            ? { status: 200, body: { ok: true, items: [PLACEMENT] } }
            : { status: 404, body: { ok: false } };
    return { ok: answer.status < 400, status: answer.status, json: async () => answer.body };
  };
  return { calls, impl };
}

const writes = (calls: Array<{ url: string; init?: any }>) =>
  calls.filter((c) => c.init && c.init.method && c.init.method !== 'GET');

describe('the card talks to its routes and nothing else', () => {
  test('load reads the stalls, their counts and the poster list for the event', async () => {
    const { calls, impl } = server();
    const { win, rows } = mount(impl);
    await win.loadStalls('evt-1');
    expect(calls.map((c) => c.url).sort()).toEqual([
      '/api/v2/admin/events/evt-1/booths',
      '/api/v2/admin/events/evt-1/booths/counts',
      '/api/v2/admin/events/evt-1/poster-deployments',
    ]);
    expect(writes(calls)).toEqual([]);
    expect(rows()).toHaveLength(3);
  });

  test('the event id is encoded into the path', async () => {
    const { calls, impl } = server();
    const { win } = mount(impl);
    win._oseList.byId['a/b'] = { id: 'a/b', title: 't', status: 'draft' };
    await win.loadStalls('a/b');
    expect(calls[0].url).toBe('/api/v2/admin/events/a%2Fb/booths');
  });

  test('the script names no route but these', () => {
    const urls = [...scriptText().matchAll(/'(\/api\/[^']*)'/g)].map((m) => m[1]);
    expect([...new Set(urls)]).toEqual(['/api/v2/admin/events/']);
    const tails = [...scriptText().matchAll(/\+ '(\/[a-z/-]+)'/g)].map((m) => m[1]);
    for (const t of tails)
      expect([
        '/booths',
        '/booths/counts',
        '/booths/bulk',
        '/booths/',
        '/poster-deployments',
      ]).toContain(t);
  });

  test('adding one stall checks it first, sends the three fields, and shows the server’s refusal at the field', async () => {
    const { calls, impl } = server({
      'POST /api/v2/admin/events/evt-1/booths': () => ({
        status: 409,
        body: {
          ok: false,
          code: 'DUPLICATE_NUMBER',
          error: 'Another booth of this event has that number',
        },
      }),
    });
    const { win, q } = mount(impl);
    await win.loadStalls('evt-1');
    (q('stall-number-input') as HTMLInputElement).value = '1';
    (q('stall-name-input') as HTMLInputElement).value = 'rosa@example.com';
    await win.stallAdd(q('stall-add-btn'));
    expect(writes(calls)).toEqual([]);
    expect(q('stall-name-error').hidden).toBe(false);
    expect(q('stall-name-error').textContent).toMatch(/email address/);
    expect(q('stall-name-input').getAttribute('aria-invalid')).toBe('true');

    (q('stall-name-input') as HTMLInputElement).value = ' Rosa  Bakery ';
    (q('stall-category-input') as HTMLSelectElement).value = 'food';
    await win.stallAdd(q('stall-add-btn'));
    const sent = writes(calls);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('/api/v2/admin/events/evt-1/booths');
    expect(sent[0].init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(sent[0].init.body)).toEqual({
      number: '1',
      name: 'Rosa Bakery',
      category: 'food',
    });
    expect(q('stall-name-error').hidden).toBe(true);
    expect(q('stall-number-error').hidden).toBe(false);
    expect(q('stall-number-error').textContent).toBe(
      'Another stall of this fair has that number. A stall out of use keeps its number.'
    );
  });

  test('an added stall is said in words and the list is read again', async () => {
    const { calls, impl } = server({
      'POST /api/v2/admin/events/evt-1/booths': () => ({
        status: 201,
        body: { ok: true, id: 'booth_n' },
      }),
    });
    const { win, q } = mount(impl);
    await win.loadStalls('evt-1');
    const reads = calls.length;
    (q('stall-number-input') as HTMLInputElement).value = '12';
    (q('stall-name-input') as HTMLInputElement).value = 'Rosa Bakery';
    await win.stallAdd(q('stall-add-btn'));
    expect(JSON.parse(writes(calls)[0].init.body)).toEqual({ number: '12', name: 'Rosa Bakery' });
    expect(calls.length).toBe(reads + 1 + 3);
    expect(q('stalls-msg').textContent).toBe('Stall 12 is added.');
    expect(q('stalls-msg').className).toBe('create-msg success');
    expect((q('stall-number-input') as HTMLInputElement).value).toBe('');
  });

  test('a pasted list is shown before it is sent, and a refused line stops the save', async () => {
    const { calls, impl } = server();
    const { win, q } = mount(impl);
    await win.loadStalls('evt-1');
    (q('stalls-bulk-text') as HTMLTextAreaElement).value =
      '20, Twenty\n2, Clash with stall 2\n21, Twenty one, art';
    win.stallsBulkRun();
    expect(q('stalls-bulk-result').hidden).toBe(false);
    expect(q('stalls-bulk-ok-title').textContent).toBe('Ready to add: 2 stalls.');
    expect([...q('stalls-bulk-ok-list').children].map((li) => li.textContent)).toEqual([
      'Line 1: stall 20, Twenty',
      'Line 3: stall 21, Twenty one (Art)',
    ]);
    expect(q('stalls-bulk-refused-title').textContent).toBe(
      'Refused: 1 line. Nothing is added until every line is right.'
    );
    expect(q('stalls-bulk-refused-list').children[0].textContent).toMatch(/^Line 2: /);
    expect(q('stalls-bulk-save').hidden).toBe(true);
    await win.stallsBulkSave(q('stalls-bulk-save'));
    expect(writes(calls)).toEqual([]);
  });

  test('a clean list is sent once, in one request, and only as it was checked', async () => {
    const { calls, impl } = server({
      'POST /api/v2/admin/events/evt-1/booths/bulk': () => ({
        status: 201,
        body: { ok: true, created: 2, booths: [] },
      }),
    });
    const { win, q } = mount(impl);
    await win.loadStalls('evt-1');
    const text = q('stalls-bulk-text') as HTMLTextAreaElement;
    text.value = '20, Twenty\n21, "Twenty, one", art';
    win.stallsBulkRun();
    expect(q('stalls-bulk-save').hidden).toBe(false);
    expect(q('stalls-bulk-save').textContent).toBe('Add these 2 stalls');
    // Changed after the check: nothing is sent; the list is shown again.
    text.value = '20, Twenty\n21, "Twenty, one", art\n22, Late';
    await win.stallsBulkSave(q('stalls-bulk-save'));
    expect(writes(calls)).toEqual([]);
    expect(q('stalls-bulk-ok-title').textContent).toBe('Ready to add: 3 stalls.');
    expect(q('stalls-msg').textContent).toMatch(/changed/);
    text.value = '20, Twenty\n21, "Twenty, one", art';
    win.stallsBulkRun();
    await win.stallsBulkSave(q('stalls-bulk-save'));
    const sent = writes(calls);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('/api/v2/admin/events/evt-1/booths/bulk');
    expect(JSON.parse(sent[0].init.body)).toEqual({
      booths: [
        { number: '20', name: 'Twenty' },
        { number: '21', name: 'Twenty, one', category: 'art' },
      ],
    });
    expect(q('stalls-msg').textContent).toBe('Added 2 stalls.');
    expect(text.value).toBe('');
    expect(q('stalls-bulk-result').hidden).toBe(true);
  });

  test('a list the server refuses names each refused line, and says nothing was saved', async () => {
    const { impl } = server({
      'POST /api/v2/admin/events/evt-1/booths/bulk': () => ({
        status: 409,
        body: {
          ok: false,
          code: 'BOOTHS_REFUSED',
          error: '1 of 2 booths were refused; nothing was saved',
          failed: [{ index: 1, number: '21', code: 'DUPLICATE_NUMBER', error: 'x' }],
          created: 0,
        },
      }),
    });
    const { win, q } = mount(impl);
    await win.loadStalls('evt-1');
    (q('stalls-bulk-text') as HTMLTextAreaElement).value = '\n20, Twenty\n\n21, Twenty one';
    win.stallsBulkRun();
    await win.stallsBulkSave(q('stalls-bulk-save'));
    expect(q('stalls-bulk-refused-title').textContent).toBe(
      'Nothing was saved. Refused: 1 line. Fix it, then check the list again.'
    );
    expect(q('stalls-bulk-refused-list').children[0].textContent).toBe(
      'Line 4: stall 21. Another stall already has this number.'
    );
    expect(q('stalls-bulk-save').hidden).toBe(true);
  });

  test('a change sends only what changed, to the stall of this event', async () => {
    const { calls, impl } = server({
      'PUT /api/v2/admin/events/evt-1/booths/booth_a': () => ({ status: 200, body: { ok: true } }),
    });
    const { win, rows } = mount(impl);
    await win.loadStalls('evt-1');
    const row = rows()[0];
    win.stallEditOpen(row.querySelector('[data-action="stall-edit"]'));
    const form = row.querySelector('[data-testid="stall-edit-form"]')!;
    const number = form.querySelector('[data-field="number"]') as HTMLInputElement;
    const name = form.querySelector('[data-field="name"]') as HTMLInputElement;
    const category = form.querySelector('[data-field="category"]') as HTMLSelectElement;
    expect(number.value).toBe('1');
    expect(category.value).toBe('food');
    for (const el of [number, name, category]) {
      expect(row.ownerDocument.querySelector(`label[for="${el.id}"]`), el.id).not.toBeNull();
    }
    name.value = 'Rosa Bread';
    category.value = '';
    await win.stallEditSave(form.querySelector('[data-action="stall-save"]'));
    const sent = writes(calls);
    expect(sent).toHaveLength(1);
    expect(sent[0].init.method).toBe('PUT');
    expect(JSON.parse(sent[0].init.body)).toEqual({ name: 'Rosa Bread', category: null });
  });

  test('taking a stall out of use asks first, in plain words, then sends DELETE', async () => {
    const { calls, impl } = server({
      'DELETE /api/v2/admin/events/evt-1/booths/booth_b': () => ({
        status: 200,
        body: { ok: true, placements_kept: 1 },
      }),
    });
    const { win, q, rows } = mount(impl);
    await win.loadStalls('evt-1');
    const row = rows()[1];
    win.stallOutAsk(row.querySelector('[data-action="stall-out"]'));
    expect(writes(calls)).toEqual([]);
    const ask = row.querySelector('[data-testid="stall-out-confirm"]')!;
    expect(ask.textContent).toContain(
      'Take stall 2 out of use? Its codes keep pointing at it and its past scans still count. It is not deleted, and you can put it back in use.'
    );
    await win.stallOutConfirm(ask.querySelector('[data-action="stall-out-yes"]'));
    const sent = writes(calls);
    expect(sent).toHaveLength(1);
    expect(sent[0].init.method).toBe('DELETE');
    expect(sent[0].url).toBe('/api/v2/admin/events/evt-1/booths/booth_b');
    expect(q('stalls-msg').textContent).toBe('Stall 2 is out of use. Nothing was deleted.');
  });

  test('putting a stall back in use sends is_active true', async () => {
    const { calls, impl } = server({
      'PUT /api/v2/admin/events/evt-1/booths/booth_c': () => ({ status: 200, body: { ok: true } }),
    });
    const { win, q, rows } = mount(impl);
    await win.loadStalls('evt-1');
    await win.stallBack(rows()[2].querySelector('[data-action="stall-back"]'));
    expect(JSON.parse(writes(calls)[0].init.body)).toEqual({ is_active: true });
    expect(q('stalls-msg').textContent).toBe('Stall 9 is back in use.');
  });

  test('a code for a stall is an ordinary placement at the venue that points at it', async () => {
    const { calls, impl } = server({
      'POST /api/v2/admin/events/evt-1/poster-deployments': () => ({
        status: 201,
        body: { ok: true, id: 'pd_2', booth_id: 'booth_a' },
      }),
    });
    const { win, q, rows } = mount(impl);
    let refreshed = '';
    win.loadPosterDeployments = (id: string) => {
      refreshed = id;
    };
    await win.loadStalls('evt-1');
    await win.stallMakeCode(rows()[0].querySelector('[data-action="stall-code"]'));
    const sent = writes(calls);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('/api/v2/admin/events/evt-1/poster-deployments');
    expect(JSON.parse(sent[0].init.body)).toEqual({
      placement_label: 'Stall 1 · Rosa Bakery',
      placement_type: 'venue',
      booth_id: 'booth_a',
    });
    expect(refreshed).toBe('evt-1');
    expect(q('stalls-msg').textContent).toBe(
      'A code for stall 1 is made. Print it here, or find it under Posters.'
    );
  });

  test('a write the server refuses for a stall that is gone says so and reads again', async () => {
    const { impl } = server({
      'DELETE /api/v2/admin/events/evt-1/booths/booth_b': () => ({
        status: 404,
        body: { ok: false, code: 'BOOTH_NOT_FOUND', error: 'Booth not found' },
      }),
    });
    const { win, q, rows } = mount(impl);
    await win.loadStalls('evt-1');
    const row = rows()[1];
    win.stallOutAsk(row.querySelector('[data-action="stall-out"]'));
    await win.stallOutConfirm(row.querySelector('[data-action="stall-out-yes"]'));
    expect(q('stalls-msg').textContent).toBe(
      'That stall is no longer on this fair. The list is up to date now.'
    );
    expect(q('stalls-msg').className).toBe('create-msg error');
  });

  test('the server’s own sentence is never shown', async () => {
    const { impl } = server({
      'POST /api/v2/admin/events/evt-1/booths': () => ({
        status: 503,
        body: { ok: false, code: 'DB_ERROR', error: 'SECRET internal detail' },
      }),
    });
    const { win, doc, q } = mount(impl);
    await win.loadStalls('evt-1');
    (q('stall-number-input') as HTMLInputElement).value = '30';
    (q('stall-name-input') as HTMLInputElement).value = 'Thirty';
    await win.stallAdd(q('stall-add-btn'));
    expect(doc.body.textContent).not.toContain('SECRET');
    expect(q('stalls-msg').textContent).toBe(
      'Could not save the stall. Nothing was changed. Try again.'
    );
  });
});
