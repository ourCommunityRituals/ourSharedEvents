/**
 * A withheld count reads "Fewer than 5" on every page, from one source
 * (OSE-1656; AGENTS.md invariant 2: "a withheld count reads in words, never
 * as 0").
 *
 * The routes already withhold the value (`{ count: null, suppressed: true }`).
 * What differed was how each page drew it: the admin dashboard tile and the
 * forms rows drew "<5", the Live view and the "Before the event" tiles drew
 * "Held". This file holds:
 *
 *   1. the one source, `src/lib/withheld-words.ts`: the worker's function and
 *      the page script say the same thing, and a bad floor never prints
 *      "undefined", "NaN" or 0;
 *   2. the copies: `admin.html` and `shared-report.html` are static files and
 *      each carries the page script between markers. A copy that differs from
 *      the source fails here;
 *   3. the translated recap line (`stats.fewerThan`) starts with the same
 *      English phrase;
 *   4. no page writes its own: no "<5", no "Held", no quoted "fewer than"
 *      outside the source, anywhere under `src/`;
 *   5. each page that drew something else, run with a withheld value: the
 *      admin dashboard tiles, the forms rows, the Live view, the report
 *      funnel, the sponsor's reach line. The "Before the event" card and the
 *      checklist are held in `poster-tiers-ui.spec.ts` and
 *      `admin-event-status-phase-consistency.spec.ts`.
 *
 * Placement: node project (jsdom and the source tree; no Worker runtime).
 *
 * @born-red OSE-1656 | method: this file was run with the page code as it is
 *   on main at 52a4ca0 (src/templates, src/handlers and
 *   src/lib/sponsor-home-render.ts checked out from main; the new source file
 *   kept so the file loads). Red 12 of 25: the copies were missing (3), the sweep found
 *   "<5" and "Held" literals and a COUNT off the one definition (2), and every
 *   withheld slot read "<5", "Held" or a dash
 *   (dashboard tiles, forms rows, Live tiles and days, funnel rate). Green
 *   after | date: 2026-11-14
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, test } from 'vitest';
import { JSDOM } from 'jsdom';
import ADMIN_HTML from '../src/templates/admin.html';
import REPORT_HTML from '../src/templates/shared-report.html';
import { handleAdminEventLivePage, type LiveMonitorEnv } from '../src/handlers/live-monitor';
import { fewerThan, WITHHELD_PHRASE, WITHHELD_WORDS_CLIENT_JS } from '../src/lib/withheld-words';
import { fmt } from '../src/lib/i18n/catalog';
import { renderPreEventReach } from '../src/lib/sponsor-home-render';
import { COUNTED_REGISTRATION_SQL } from '../src/lib/registration-count';
import { installFewerThan } from './helpers/fewer-than';

type ClientFn = (floor?: unknown, tail?: string, lower?: boolean) => string;

const WITHHELD = { count: null, suppressed: true, floor: 5 };
const shown = (n: number) => ({ count: n, suppressed: false, floor: 5 });

/** What a withheld slot may never read. */
const NOT_WORDS = /<\s*5|&lt;|\bHeld\b|^\s*0?\s*$|null|undefined|NaN|^—$|^-$/;

function expectWords(text: string | null | undefined, exact: string) {
  expect(text ?? '').not.toMatch(NOT_WORDS);
  expect((text ?? '').trim()).toBe(exact);
}

// ─── 1. The one source ───────────────────────────────────────────────────────

describe('the words for a withheld count have one source', () => {
  test('the phrase is "Fewer than 5", with the noun where there is one', () => {
    expect(fewerThan()).toBe('Fewer than 5');
    expect(fewerThan(5, 'scans in any hour')).toBe('Fewer than 5 scans in any hour');
    expect(fewerThan(5, 'taps on any one link', true)).toBe('fewer than 5 taps on any one link');
    expect(fewerThan(10)).toBe('Fewer than 10');
  });

  test.each([undefined, null, NaN, 0, -3, Infinity, 'x', {}])(
    'a bad floor (%s) reads as the floor of 5, never "undefined", "NaN" or 0',
    (bad) => {
      expect(fewerThan(bad as unknown as number)).toBe('Fewer than 5');
    }
  );

  test('the page script says exactly what the worker says', () => {
    const w: { oseFewerThan?: ClientFn } = {};
    installFewerThan(w);
    const client = w.oseFewerThan as ClientFn;
    const floors = [5, 10, 5.9, undefined, null, NaN, 0, -1, Infinity, '7', 'x'];
    const tails = [undefined, '', 'scans in any hour', 'each'];
    for (const floor of floors)
      for (const tail of tails)
        for (const lower of [undefined, false, true])
          expect(client(floor, tail, lower), `${String(floor)} / ${tail} / ${lower}`).toBe(
            fewerThan(floor as number | undefined, tail, lower)
          );
  });

  test('the page script can sit in a template literal as it is', () => {
    expect(WITHHELD_WORDS_CLIENT_JS).not.toMatch(/[\\`]|\$\{/);
    expect(WITHHELD_WORDS_CLIENT_JS).not.toMatch(/<\/?script/i);
  });
});

// ─── 2. The copies in the static pages ───────────────────────────────────────

/** The block between the markers, markers included, without indentation. */
function copyIn(html: string): string {
  const begin = html.indexOf('// @ose-fewer-than:begin');
  const endMark = '// @ose-fewer-than:end';
  const end = html.indexOf(endMark);
  if (begin < 0 || end < 0) return '';
  return html
    .slice(begin, end + endMark.length)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .join('\n');
}
const source = WITHHELD_WORDS_CLIENT_JS.split('\n')
  .map((l) => l.trim())
  .join('\n');

describe('each static page carries the source, unchanged', () => {
  test.each([
    ['admin.html', ADMIN_HTML],
    ['shared-report.html', REPORT_HTML],
  ])('%s', (_name, html) => {
    expect(copyIn(html)).toBe(source);
    // Once, and ahead of every use.
    expect(html.split('@ose-fewer-than:begin').length - 1).toBe(1);
    expect(html.slice(0, html.indexOf('@ose-fewer-than:begin'))).not.toContain('oseFewerThan');
  });

  test('the Live view page carries it too', async () => {
    const res = await handleAdminEventLivePage(liveEnv(), 'evt_live');
    expect(copyIn(await res.text())).toBe(source);
  });
});

// ─── 3. The translated recap line ────────────────────────────────────────────

test('the recap line in English is the same phrase', () => {
  expect(fmt('en', 'stats.fewerThan', { floor: 5, label: 'Checked in' })).toBe(
    fewerThan(5, 'Checked in')
  );
  expect(WITHHELD_PHRASE).toBe('Fewer than {floor}');
});

// ─── 4. No page writes its own ───────────────────────────────────────────────

const SRC = join(__dirname, '..', 'src');
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|js|html)$/.test(name) ? [p] : [];
  });
}
const rel = (p: string) => relative(SRC, p).split(sep).join('/');

/** Source text without comments: a comment may quote the old forms. */
function code(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

describe('no page writes its own words for a withheld count', () => {
  // The source, the language catalogs (the translated recap line), and prose
  // that gives a reason rather than drawing a count (the report's notes on why
  // a figure is missing; the demo's made-up season).
  const ALLOWED = new Set([
    'lib/withheld-words.ts',
    'lib/i18n/catalog.ts',
    'lib/i18n/catalog-pl.ts',
    'lib/i18n/catalog-ar.ts',
    'lib/shared-report-builder.ts',
  ]);

  const BANNED: [string, RegExp][] = [
    ['"<5" as text', /&lt;\s*5|['"`]<\s*5|['"`]<['"`]\s*\+/],
    ['"Held" as text', /['"`>]\s*Held\s*['"`<]|[?:]\s*['"`]held['"`]/],
    ['a quoted "fewer than"', /['"`][^'"`\n]*\b[Ff]ewer than\b/],
    [
      'a quoted "under 5" or "below 5"',
      /['"`][^'"`\n]*\b(?:under|below) (?:5|five)\b[^'"`\n]*['"`]\s*[;,)]/,
    ],
  ];

  test('nothing under src/ draws "<5", "Held" or its own "fewer than"', () => {
    const found: string[] = [];
    for (const file of files(SRC)) {
      if (ALLOWED.has(rel(file))) continue;
      const lines = code(readFileSync(file, 'utf8')).split('\n');
      lines.forEach((line, i) => {
        if (line.includes('@ose-fewer-than') || line.includes('"Fewer than {floor}"')) return;
        for (const [what, re] of BANNED)
          if (re.test(line))
            found.push(`${rel(file)}:${i + 1} ${what}: ${line.trim().slice(0, 90)}`);
      });
    }
    expect(found).toEqual([]);
  });

  test('every count of registrations uses the one definition', () => {
    const found: string[] = [];
    for (const file of files(SRC)) {
      const text = readFileSync(file, 'utf8');
      const re = /COUNT\([^)]*\)[^;`'"]*FROM form_registrations[^;`'"]*/g;
      for (const m of text.matchAll(re))
        if (!m[0].includes('${COUNTED_REGISTRATION_SQL}')) found.push(`${rel(file)}: ${m[0]}`);
    }
    expect(found).toEqual([]);
    expect(COUNTED_REGISTRATION_SQL).toBe(
      "status = 'confirmed' AND (expires_at IS NULL OR expires_at > datetime('now'))"
    );
  });
});

// ─── 5. Each page, run with a withheld value ─────────────────────────────────

function scriptContaining(html: string, needle: string): string {
  const doc = new JSDOM(html).window.document;
  const el = Array.from(doc.querySelectorAll('script')).find((s) =>
    (s.textContent || '').includes(needle)
  );
  expect(el, needle).toBeDefined();
  return el!.textContent || '';
}

describe('the admin dashboard tiles', () => {
  function tiles(data: unknown) {
    const start = ADMIN_HTML.indexOf('<div class="dash-stat scans" data-testid="admin-stat-scans"');
    const markup = ADMIN_HTML.slice(
      start,
      ADMIN_HTML.indexOf('</div>', ADMIN_HTML.indexOf('admin-stat-checkins-num', start))
    );
    const dom = new JSDOM(`<!doctype html><body><div>${markup}</div></div></body>`, {
      runScripts: 'outside-only',
      url: 'https://ose.test/admin',
    });
    const w = dom.window as unknown as Window & {
      eval(s: string): unknown;
      EventDashboard: { init(d: unknown): void };
    };
    installFewerThan(w);
    w.eval(scriptContaining(ADMIN_HTML, 'window.EventDashboard = Dashboard'));
    w.EventDashboard.init(data);
    return (id: string) => w.document.querySelector(`[data-testid="admin-stat-${id}-num"]`)!;
  }

  test('withheld registrations and check-ins read "Fewer than 5", not "<5"', () => {
    const at = tiles({
      scans: shown(12),
      appearances: 2,
      registrations: WITHHELD,
      checkins: WITHHELD,
    });
    expectWords(at('registrations').textContent, 'Fewer than 5');
    expectWords(at('checkins').textContent, 'Fewer than 5');
    expect(at('registrations').classList.contains('is-withheld')).toBe(true);
    expect(at('scans').textContent).toBe('12');
    expect(at('scans').classList.contains('is-withheld')).toBe(false);
    expect(at('appearances').textContent).toBe('2');
  });

  test('withheld scans say what was held: no hour reached 5', () => {
    const at = tiles({
      scans: WITHHELD,
      appearances: 0,
      registrations: shown(9),
      checkins: shown(6),
    });
    expectWords(at('scans').textContent, 'Fewer than 5 in any hour');
    expect(at('registrations').textContent).toBe('9');
  });

  test('a count that is missing keeps its dash and is not drawn as withheld', () => {
    const at = tiles({ scans: shown(12) });
    expect(at('registrations').textContent).toBe('—');
    expect(at('registrations').classList.contains('is-withheld')).toBe(false);
  });
});

describe('the admin forms rows', () => {
  test('a withheld count reads "Fewer than 5", not "<5"', () => {
    const begin = ADMIN_HTML.indexOf('// @ose-forms-section:begin');
    const end = ADMIN_HTML.indexOf('// @ose-forms-section:end');
    installFewerThan(globalThis);
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const section = new Function(`${ADMIN_HTML.slice(begin, end)}; return oseFormsSection;`)() as (
      o: unknown
    ) => { rowsHtml: string };
    const { rowsHtml } = section({
      types: [
        { key: 'register', flagKey: 'forms.register', label: 'Registration', desc: 'Sign-up' },
      ],
      counts: ['suppressed'],
      eventFlags: { 'forms.register': true },
      planFlags: { 'forms.register': true },
      eventPhase: 1,
      eventId: 'evt-1',
      eventName: 'Bocce night',
      tierLabel: () => 'Free plan',
      phaseLabel: () => 'Community events',
    });
    const doc = new JSDOM(`<div>${rowsHtml}</div>`).window.document;
    const slot = doc.querySelector('[data-testid="count-suppressed"]');
    expectWords(slot?.textContent, 'Fewer than 5');
    expect(rowsHtml).not.toMatch(/&lt;\s*5/);
  });
});

function liveEnv(): LiveMonitorEnv {
  const row = { id: 'evt_live', title: 'Bocce night', status: 'active' };
  const stmt = { bind: () => stmt, first: async () => row };
  return { DB: { prepare: () => stmt } as unknown as D1Database };
}

describe('the Live view', () => {
  async function open(dashboard: unknown): Promise<Document> {
    const res = await handleAdminEventLivePage(liveEnv(), 'evt_live');
    const dom = new JSDOM(await res.text(), {
      url: 'https://ose.test/api/v2/admin/events/evt_live/live',
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      beforeParse(w) {
        (w as unknown as { fetch: unknown }).fetch = async () =>
          new Response(JSON.stringify(dashboard), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
      },
    });
    const doc = dom.window.document;
    for (let i = 0; i < 120; i++) {
      if (doc.querySelector('[data-testid="live-status"]')?.getAttribute('data-state') === 'fresh')
        return doc;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('the Live view did not render');
  }
  const at = (doc: Document, id: string) => doc.querySelector(`[data-testid="${id}"]`)?.textContent;

  test('every withheld tile and day reads in words, never "Held"', async () => {
    const doc = await open({
      ok: true,
      reach: {
        scans: WITHHELD,
        clicks: WITHHELD,
        posters: 2,
        places: 1,
        scansByDay: [
          { day: '2026-11-12', count: WITHHELD },
          { day: '2026-11-13', count: shown(6) },
        ],
      },
      participation: { explicit: { checkins: WITHHELD } },
      sponsors: { on_show: 1 },
    });
    expectWords(at(doc, 'live-scans'), 'Fewer than 5 in any hour');
    expectWords(at(doc, 'live-taps'), 'Fewer than 5 on any one link');
    expectWords(at(doc, 'live-checkins'), 'Fewer than 5');
    expect(at(doc, 'live-posters')).toBe('2');
    const days = [...doc.querySelectorAll('[data-testid="live-days"] li b')].map(
      (b) => b.textContent
    );
    expectWords(days[0], 'Fewer than 5 in any hour');
    expect(days[1]).toBe('6');
    // No hover text stands in for the words, and the note uses them too.
    expect(doc.querySelector('[data-testid="live-scans"]')?.hasAttribute('title')).toBe(false);
    expect(at(doc, 'live-note')).not.toMatch(/Held/);
    expect(at(doc, 'live-note')).toMatch(/under 5 read .Fewer than 5.\./);
  });

  test('a count sent as null with no flag is withheld too, never a dash', async () => {
    const doc = await open({
      ok: true,
      reach: {
        scans: { count: null, floor: 5 },
        clicks: shown(8),
        posters: 0,
        places: 0,
        scansByDay: [],
      },
      participation: { explicit: { checkins: shown(5) } },
      sponsors: { on_show: 0 },
    });
    expectWords(at(doc, 'live-scans'), 'Fewer than 5 in any hour');
    expect(at(doc, 'live-taps')).toBe('8');
  });
});

describe('the report funnel', () => {
  test('withheld counts read "Fewer than 5" and the rate is not "Held"', async () => {
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    const dom = new JSDOM(REPORT_HTML, {
      url: 'https://ose.test/sharedReport',
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      beforeParse(w) {
        (w as unknown as { fetch: unknown }).fetch = async (input: string) => {
          const url = String(input);
          if (url === '/api/v2/events')
            return json({
              ok: true,
              items: [{ id: 'evt_1', name: 'Bocce night', title: 'Bocce night', status: 'active' }],
            });
          if (url.includes('/flags/current-tier')) return json({ ok: true, tier: 'mid' });
          if (url.endsWith('/forms/registrations')) return json({ ok: true, ...shown(12) });
          if (url.endsWith('/forms/checkin-count')) return json({ ok: true, ...WITHHELD });
          return json({ ok: false }, 404);
        };
      },
    });
    const doc = dom.window.document;
    for (let i = 0; i < 120 && !doc.querySelector('[data-testid="funnel-row"]'); i++)
      await new Promise((r) => setTimeout(r, 25));
    const at = (id: string) => doc.querySelector(`[data-testid="${id}"]`)?.textContent;
    expect(at('funnel-reg-count')).toBe('12');
    expectWords(at('funnel-checkin-count'), 'Fewer than 5');
    expect(at('funnel-rate')).not.toMatch(/Held|\d+%|^\s*$/);
    expect(at('funnel-rate')).toBe('Not shown');
  });
});

describe("the sponsor's reach line", () => {
  test('both withheld: words for each, and scans say "in any one hour"', () => {
    const html = renderPreEventReach({
      posters: 1,
      places: 1,
      scans: WITHHELD,
      clicks: WITHHELD,
      scansByDay: [],
    } as unknown as Parameters<typeof renderPreEventReach>[0]);
    expect(html).toContain(
      'So far: fewer than 5 taps on any one link · fewer than 5 poster scans in any one hour.'
    );
    expect(html).not.toMatch(/Held|&lt;5|\b0 poster scans|null|undefined/);
  });
});
