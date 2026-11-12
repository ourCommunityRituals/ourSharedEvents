/**
 * OSE-1516 — the poster arranges itself from what the event has: how many
 * codes, whether there is artwork, whether there are sponsors. The organizer
 * picks nothing.
 *
 * Two halves, both run from the served template (poster.html), never pattern
 * matched:
 *   1. the pure layout rules (posterLayout / posterActionLabel /
 *      posterTitleStep), extracted from the page script and run as functions;
 *   2. the page script run in jsdom with a stubbed poster-bundle, at 0..8
 *      codes, with and without artwork. Real layout (sizes, overlap, one-line
 *      title) is measured in a browser: tests/playwright/poster-layout.spec.ts.
 *
 * The ticket left "how eight codes are handled" open. Decision (conservative,
 * no new sheet size): the codes keep their size (never under 100px) and the
 * artwork gives way. Eight codes = four rows of two, the artwork shrinks to
 * what is left of the sheet but is never dropped.
 *
 * @born-red OSE-1516 | method: written before the change and run against the
 *   base template (no posterLayout, no data-layout, dashed placeholder still
 *   rendered, one meta row per fact, codes with a word only) — red; green after
 */

import { describe, test, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import POSTER_HTML from '../src/templates/poster.html';

// ── the pure rules ──────────────────────────────────────────────────────────

type Layout = {
  layout: 'row' | 'art' | 'corners' | 'side' | 'grid';
  count: number;
  art: boolean;
  sponsors: boolean;
  columns: number;
  rows: number;
  spots: string[];
  codeIn: number;
  codeMinPx: number;
  artMaxIn: number | null;
  titleSize: 'large' | 'normal';
};
type Rules = {
  posterLayout: (i: { codes: unknown; hasArt: boolean; hasSponsors: boolean }) => Layout;
  posterActionLabel: (kind: unknown, digital: boolean) => string;
  posterTitleStep: (name: unknown) => number;
};

function rules(): Rules {
  const start = POSTER_HTML.indexOf('/* poster-layout:begin */');
  const end = POSTER_HTML.indexOf('/* poster-layout:end */');
  expect(start, 'poster.html must carry the layout rules').toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(
    `${POSTER_HTML.slice(start, end)}; return { posterLayout, posterActionLabel, posterTitleStep };`
  )() as Rules;
}
const { posterLayout, posterActionLabel, posterTitleStep } = rules();

const lay = (codes: unknown, hasArt = true, hasSponsors = true) =>
  posterLayout({ codes, hasArt, hasSponsors });

describe('posterLayout: which layout, from the code count and the artwork', () => {
  test('no artwork: the artwork area drops out and the codes sit in a row, at any count', () => {
    for (let n = 0; n <= 8; n++) {
      const l = lay(n, false);
      expect(l.layout, `${n} codes`).toBe('row');
      expect(l.art).toBe(false);
      expect(l.artMaxIn).toBeNull();
      expect(l.titleSize).toBe('large');
    }
  });

  test('artwork and no codes yet: artwork alone', () => {
    const l = lay(0);
    expect(l.layout).toBe('art');
    expect(l.spots).toEqual([]);
  });

  test('1-2 codes: artwork full width, the codes on top of it in the bottom corners', () => {
    expect(lay(1).layout).toBe('corners');
    expect(lay(2).layout).toBe('corners');
    expect(lay(1).spots).toEqual(['art-bottom-left']);
    expect(lay(2).spots).toEqual(['art-bottom-left', 'art-bottom-right']);
    // Overlaid codes take nothing from the artwork.
    expect(lay(2).artMaxIn).toBe(lay(0).artMaxIn);
  });

  test('3 codes: a side column beside the artwork', () => {
    const l = lay(3);
    expect(l.layout).toBe('side');
    expect(l.columns).toBe(1);
    expect(l.spots).toEqual(['side-1', 'side-2', 'side-3']);
  });

  test('4-8 codes: a two-column grid', () => {
    for (let n = 4; n <= 8; n++) {
      const l = lay(n);
      expect(l.layout, `${n} codes`).toBe('grid');
      expect(l.columns).toBe(2);
      expect(l.rows).toBe(Math.ceil(n / 2));
      expect(l.spots).toHaveLength(n);
    }
  });

  test('the count is clamped: more than eight are not drawn, junk reads as none', () => {
    expect(lay(9).count).toBe(8);
    expect(lay(50).spots).toHaveLength(8);
    for (const junk of [-3, NaN, undefined, null, 'x', {}, Infinity]) {
      expect(lay(junk).count, String(junk)).toBe(junk === Infinity ? 8 : 0);
    }
    expect(lay('3').layout).toBe('side');
    expect(lay(2.9).count).toBe(2);
  });
});

describe('posterLayout: codes keep their size ahead of the artwork', () => {
  test('no layout takes a code below 100px', () => {
    for (const hasArt of [true, false]) {
      for (let n = 0; n <= 8; n++) {
        const l = lay(n, hasArt);
        expect(l.codeMinPx).toBeGreaterThanOrEqual(100);
        // Printed size, at 96 css px to the inch.
        expect(l.codeIn * 96, `${n} codes, art ${hasArt}`).toBeGreaterThanOrEqual(100);
      }
    }
  });

  test('more codes shrink the artwork, never the codes', () => {
    let last = Infinity;
    for (const n of [2, 4, 6, 8]) {
      const l = lay(n);
      expect(l.artMaxIn!, `${n} codes`).toBeLessThanOrEqual(last);
      last = l.artMaxIn!;
    }
    expect(lay(8).artMaxIn!).toBeLessThan(lay(4).artMaxIn!);
    expect(lay(8).codeIn).toBe(lay(4).codeIn);
  });

  test('eight codes: the artwork is smaller but is never dropped', () => {
    for (const hasSponsors of [true, false]) {
      const l = lay(8, true, hasSponsors);
      expect(l.layout).toBe('grid');
      expect(l.art).toBe(true);
      expect(l.artMaxIn!).toBeGreaterThanOrEqual(1.5);
    }
  });

  test('sponsors cost the artwork some room only where the codes are in the way', () => {
    expect(lay(8, true, true).artMaxIn!).toBeLessThan(lay(8, true, false).artMaxIn!);
    expect(lay(2, true, true).artMaxIn).toBe(lay(2, true, false).artMaxIn);
    expect(lay(8, true, true).sponsors).toBe(true);
    expect(lay(8, true, false).sponsors).toBe(false);
  });
});

describe('posterLayout: placements are named spots, not pixels', () => {
  test('every spot is a unique name made of words and small numbers', () => {
    for (const hasArt of [true, false]) {
      for (let n = 0; n <= 8; n++) {
        const { spots } = lay(n, hasArt);
        expect(new Set(spots).size).toBe(spots.length);
        for (const s of spots) {
          expect(s).toMatch(/^[a-z]+(-[a-z]+|-\d)+$/);
          expect(s).not.toMatch(/px|in\b|%|\d{2,}/);
        }
      }
    }
  });
});

describe('posterActionLabel: each code says what scanning it does', () => {
  test('print says Scan, digital says Tap, for every kind the admin offers', () => {
    const KINDS: Record<string, string> = {
      public: 'see the event',
      checkin: 'check in',
      register: 'register',
      donation: 'donate',
      sponsor: 'become a sponsor',
      signup: 'sign up',
      tickets: 'get tickets',
      ow: 'hear the music',
      league: 'see the league',
      workshop: 'register',
      substack: 'subscribe',
      menu: 'see the menu',
      website: 'learn more',
    };
    for (const [kind, what] of Object.entries(KINDS)) {
      expect(posterActionLabel(kind, false)).toBe(`Scan to ${what}`);
      expect(posterActionLabel(kind, true)).toBe(`Tap to ${what}`);
    }
    expect(posterActionLabel('register', false)).toBe('Scan to register');
  });

  test('an unknown kind, or a hostile one, falls back to a plain label', () => {
    for (const k of ['nope', '', undefined, null, '__proto__', 'constructor', 'toString', 7]) {
      expect(posterActionLabel(k, false), String(k)).toBe('Scan to learn more');
    }
  });
});

describe('posterTitleStep: the title steps down before it wraps', () => {
  test('longer names start on a smaller step, never below the last', () => {
    const steps = [
      'Bocce',
      'Harbor County Bocce',
      'Harbor County Bocce Night',
      'Harbor County Summer Bocce League Night',
      'The Annual Harbor County Summer Bocce League Night Fundraiser',
      'x'.repeat(200),
    ].map(posterTitleStep);
    expect(steps[0]).toBe(0);
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThanOrEqual(steps[i - 1]);
    expect(steps[steps.length - 1]).toBe(4);
    expect(posterTitleStep(undefined)).toBe(0);
  });
});

// ── the page, in jsdom ──────────────────────────────────────────────────────

const EVT = 'evt_layout_1516';
const QR = 'data:image/png;base64,iVBORw0KGgo=';
const ART = 'https://img.example.org/poster-art.png';
const KIND_ROTATION = [
  'public',
  'checkin',
  'register',
  'donation',
  'signup',
  'tickets',
  'ow',
  'league',
  'menu',
  'website',
];
const slots = (n: number) =>
  Array.from({ length: n }, (_, i) => {
    const kind = KIND_ROTATION[i];
    const code = `Cd${String(i).padStart(4, '0')}`;
    return {
      kind,
      word: kind.toUpperCase(),
      label: kind,
      code,
      url: `https://ose.test/s/${code}`,
      qr: QR,
    };
  });

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

function posterScript(): string {
  const doc = new JSDOM(POSTER_HTML).window.document;
  const el = Array.from(doc.querySelectorAll('script')).find((s) =>
    (s.textContent || '').includes('async function loadPosterBundle')
  );
  expect(el, 'poster main script').toBeDefined();
  return el!.textContent || '';
}
function errorScript(): string {
  const doc = new JSDOM(POSTER_HTML).window.document;
  const el = Array.from(doc.querySelectorAll('script')).find((s) =>
    (s.textContent || '').includes("el.tagName === 'IMG'")
  );
  expect(el, 'poster image-error script').toBeDefined();
  return el!.textContent || '';
}
function posterBody(): string {
  const doc = new JSDOM(POSTER_HTML).window.document;
  doc.querySelectorAll('script').forEach((s) => s.remove());
  return doc.body.innerHTML;
}

async function mount(
  n: number,
  opts: {
    art?: boolean;
    sponsors?: boolean;
    kind?: 'print' | 'digital';
    event?: Record<string, unknown>;
  } = {}
) {
  const dom = new JSDOM(`<!doctype html><body>${posterBody()}</body>`, {
    runScripts: 'outside-only',
    url: `https://ose.test/poster?event=${EVT}&kind=${opts.kind ?? 'print'}`,
  });
  const w = dom.window as unknown as Window &
    Record<string, unknown> & { eval(s: string): unknown };
  w.fetch = vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () =>
      url.includes('/poster-bundle')
        ? {
            ok: true,
            event: {
              id: EVT,
              name: 'Harbor County Bocce',
              venue: 'Harbor Hall, Sawyer',
              startDateISO: '2026-10-24',
              starts_at: '2026-10-24T23:00:00.000Z',
              timezone: 'America/Chicago',
              ...(opts.art === false ? {} : { cover_image_url: ART }),
              ...(opts.event ?? {}),
            },
            sponsors:
              opts.sponsors === false
                ? []
                : [{ id: 'sp1', name: 'Sawyer Hardware', tier: 'primary' }],
            slots: slots(n),
          }
        : { ok: false },
  })) as unknown as typeof fetch;
  w.eval(posterScript());
  w.eval(errorScript());
  await flush();
  return { doc: w.document, w };
}

const poster = (doc: Document) => doc.querySelector('[data-testid="poster-card"]') as HTMLElement;

describe('/poster | the layout follows what the event has (jsdom)', () => {
  const EXPECT: Array<[number, string]> = [
    [1, 'corners'],
    [2, 'corners'],
    [3, 'side'],
    [4, 'grid'],
    [5, 'grid'],
    [6, 'grid'],
    [7, 'grid'],
    [8, 'grid'],
  ];
  for (const kind of ['print', 'digital'] as const) {
    for (const [n, layout] of EXPECT) {
      test(`${kind}, ${n} code(s) with artwork: ${layout}`, async () => {
        const { doc } = await mount(n, { kind });
        const p = poster(doc);
        expect(p.getAttribute('data-layout')).toBe(layout);
        expect(p.getAttribute('data-codes')).toBe(String(n));
        expect(p.getAttribute('data-art')).toBe('1');
        expect(doc.querySelectorAll('#poster-qr-slots .code-card')).toHaveLength(n);
        expect(doc.querySelector('[data-testid="poster-art-img"]')).not.toBeNull();
      });
    }
  }

  test('every code card carries its named spot, in order', async () => {
    const { doc } = await mount(4);
    const spots = Array.from(doc.querySelectorAll('#poster-qr-slots .code-card')).map((c) =>
      c.getAttribute('data-spot')
    );
    expect(spots).toEqual(posterLayout({ codes: 4, hasArt: true, hasSponsors: true }).spots);
    const two = await mount(2);
    expect(
      Array.from(two.doc.querySelectorAll('#poster-qr-slots .code-card')).map((c) =>
        c.getAttribute('data-spot')
      )
    ).toEqual(['art-bottom-left', 'art-bottom-right']);
  });

  test('more than eight codes in the bundle: eight are drawn', async () => {
    const { doc } = await mount(10);
    expect(doc.querySelectorAll('#poster-qr-slots .code-card')).toHaveLength(8);
    expect(poster(doc).getAttribute('data-codes')).toBe('8');
  });

  test('the poster says how big the codes print and how much artwork is left', async () => {
    const { doc } = await mount(8);
    const p = poster(doc);
    expect(p.style.getPropertyValue('--code-in')).toMatch(/^\d+(\.\d+)?in$/);
    expect(p.style.getPropertyValue('--art-max-in')).toMatch(/^\d+(\.\d+)?$/);
  });
});

describe('/poster | no artwork: the area drops out, nothing dashed is left', () => {
  test('no cover image: no art area, no placeholder, the codes in a row, the title large', async () => {
    const { doc } = await mount(3, { art: false });
    const p = poster(doc);
    expect(p.getAttribute('data-layout')).toBe('row');
    expect(p.getAttribute('data-art')).toBe('0');
    expect(doc.querySelector('[data-testid="poster-art-viewport"]')).toBeNull();
    expect(doc.querySelector('[data-testid="poster-art-empty"]')).toBeNull();
    expect(doc.querySelector('.poster-art--empty')).toBeNull();
    expect(doc.querySelectorAll('#poster-qr-slots .code-card')).toHaveLength(3);
  });

  test('the dashed placeholder is gone from the stylesheet too', () => {
    expect(POSTER_HTML).not.toContain('poster-art--empty');
    expect(POSTER_HTML).not.toContain('poster-art-placeholder');
  });

  test('artwork that fails to load drops out the same way, and the layout is redone', async () => {
    const { doc } = await mount(2);
    expect(poster(doc).getAttribute('data-layout')).toBe('corners');
    const img = doc.querySelector('[data-testid="poster-art-img"]') as HTMLImageElement;
    img.dispatchEvent(new (doc.defaultView as unknown as Window).Event('error'));
    await flush();
    expect(doc.querySelector('[data-testid="poster-art-viewport"]')).toBeNull();
    expect(poster(doc).getAttribute('data-layout')).toBe('row');
    expect(poster(doc).getAttribute('data-art')).toBe('0');
    expect(doc.querySelectorAll('#poster-qr-slots .code-card')).toHaveLength(2);
  });

  test('no sponsors: the sponsor header is not there', async () => {
    const { doc } = await mount(2, { sponsors: false });
    expect(doc.querySelector('[data-testid="poster-sponsor-item"]')).toBeNull();
    expect(doc.querySelector('[data-testid="poster-sponsor-label"]')).toBeNull();
  });
});

describe('/poster | each code says what scanning it does', () => {
  test('print: "Scan to register", with its word still on the card', async () => {
    const { doc } = await mount(3);
    expect(doc.querySelector('[data-testid="poster-qr-slot-action-register"]')!.textContent).toBe(
      'Scan to register'
    );
    expect(doc.querySelector('[data-testid="poster-qr-slot-action-checkin"]')!.textContent).toBe(
      'Scan to check in'
    );
    expect(
      doc.querySelector('[data-testid="poster-qr-slot-label-register"]')!.textContent
    ).toContain('REGISTER');
  });

  test('digital: "Tap to ..."', async () => {
    const { doc } = await mount(2, { kind: 'digital' });
    expect(doc.querySelector('[data-testid="poster-qr-slot-action-checkin"]')!.textContent).toBe(
      'Tap to check in'
    );
  });

  test('the label comes from the page, never from the response', async () => {
    const { doc } = await mount(1);
    const bad = new JSDOM(`<!doctype html><body>${posterBody()}</body>`, {
      runScripts: 'outside-only',
      url: `https://ose.test/poster?event=${EVT}&kind=print`,
    });
    const w = bad.window as unknown as Window &
      Record<string, unknown> & { eval(s: string): unknown };
    w.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        event: { id: EVT, name: 'x' },
        sponsors: [],
        slots: [
          {
            kind: 'donation',
            word: 'DONATE',
            action: '<img src=x onerror=window.__a=1>',
            code: 'Don001',
            qr: QR,
          },
        ],
      }),
    })) as unknown as typeof fetch;
    w.eval(posterScript());
    await flush();
    expect(w.__a).toBeUndefined();
    expect(
      w.document.querySelector('[data-testid="poster-qr-slot-action-donation"]')!.textContent
    ).toBe('Scan to donate');
    expect(doc).toBeDefined();
  });
});

// OSE-1991 (owner 2026-11-11): print's one plain line became the When and Where
// cards the digital poster has (nothing tapped on paper): one list, two cards.
describe('/poster | date, start time and venue: the When and Where cards', () => {
  test('one list holds the date with the start time in the event zone, and the venue', async () => {
    const { doc } = await mount(2);
    const meta = doc.querySelector('[data-testid="poster-meta"]')!;
    const date = meta.querySelector('[data-testid="poster-meta-date"]')!;
    const venue = meta.querySelector('[data-testid="poster-meta-venue"]')!;
    expect(date.textContent).toContain('October 24, 2026');
    expect(date.textContent).toContain('6:00 PM CDT');
    expect(venue.textContent).toContain('Harbor Hall, Sawyer');
    // The two facts are siblings in one list, not separate sections.
    expect(date.parentElement).toBe(venue.parentElement);
    expect(meta.querySelectorAll('.meta-row')).toHaveLength(0);
  });

  test('a date-only event shows no invented time', async () => {
    const { doc } = await mount(1, { event: { starts_at: null, timezone: null } });
    const date = doc.querySelector('[data-testid="poster-meta-date"]')!;
    expect(date.textContent).toContain('October 24, 2026');
    expect(date.textContent).not.toMatch(/\d:\d\d/);
  });
});

describe('/poster | the title is held to one line', () => {
  test('the title carries a step, and the long name starts on a smaller one', async () => {
    const short = await mount(1);
    const long = await mount(1, {
      event: { name: 'The Annual Harbor County Summer Bocce League Night Fundraiser' },
    });
    const step = (d: Document) =>
      Number(d.querySelector('[data-testid="poster-title"]')!.getAttribute('data-title-step'));
    expect(step(short.doc)).toBe(0);
    expect(step(long.doc)).toBeGreaterThan(0);
  });
});

describe('/poster | what was already true still is (print gate, no QR hole)', () => {
  test('Print is ready once the codes have settled', async () => {
    const { doc } = await mount(4);
    doc.querySelectorAll('.qr-img, [data-testid="poster-sponsor-logo"]').forEach((img) => {
      img.dispatchEvent(new (doc.defaultView as unknown as Window).Event('load'));
    });
    await flush();
    expect((doc.querySelector('[data-testid="poster-print"]') as HTMLButtonElement).disabled).toBe(
      false
    );
  });

  test('the QR placeholder still holds the print gate before any code is drawn', async () => {
    const { doc } = await mount(0);
    expect(doc.querySelectorAll('.qr-loading').length).toBe(1);
    expect(poster(doc).getAttribute('data-layout')).toBe('art');
  });
});
