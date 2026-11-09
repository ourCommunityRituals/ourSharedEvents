/**
 * OSE-1826 — the digital poster's sponsor block, page half (owner 2026-11-09).
 *
 * "Sponsored by" is a small label above the sponsor, and each sponsor gets a
 * header block: its header image full width (through the consent-gated proxy,
 * ?slot=header), its logo and name, its short text. A sponsor with neither
 * shows its logo and name as before. Print keeps the compact logo row. The
 * block is the same for every tier (WALL-3b).
 *
 * Layer: the served template, its script run in jsdom with the poster-bundle
 * answered here. API half: sponsor-header-block.spec.ts. Phone check:
 * tests/playwright/poster-digital-actions.spec.ts.
 *
 * @born-red OSE-1826 | method: run against the parent commit's template and
 * with planted faults: the header image loaded from the sponsor's own host,
 * the header text written as markup, the fallback drawing an empty image, the
 * header drawn on print, a failed header image left in place, a tier selector
 * in the block's CSS | date: 2026-11-09
 */
import { describe, test, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import POSTER_HTML from '../src/templates/poster.html';

const EVT = 'evt_1826';
const ORIGIN = 'https://ose.test';
const TAIL = '" X1="1" <B X2>&AMP;</B>';

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

type Sponsor = Record<string, unknown>;

function bundle(sponsors: Sponsor[]): Record<string, unknown> {
  return {
    ok: true,
    status: 200,
    eventId: EVT,
    event: {
      id: EVT,
      name: 'Uptown Blue Island',
      venue: 'Uptown Blue Island',
      startDateISO: '2026-11-11',
      starts_at: '2026-11-11T23:00:00.000Z',
      timezone: 'America/Chicago',
    },
    sponsors,
    slots: [],
    settings: { showQRSection: true },
  };
}

const BAKERY: Sponsor = {
  id: 'sp_bakery',
  name: 'Western Ave Bakery',
  title: 'Western Ave Bakery',
  tier: 'bronze',
  logo_url: 'https://logo.example.org/bakery.png',
  has_header_image: true,
  header_text: 'Fresh bread every morning, two blocks from the square.',
};

async function openPoster(kind: 'print' | 'digital', body: Record<string, unknown>) {
  const dom = new JSDOM(POSTER_HTML, {
    url: `${ORIGIN}/events/${EVT}/poster?kind=${kind}`,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      (w as unknown as { fetch: unknown }).fetch = async (input: string) =>
        String(input).includes('/poster-bundle') ? json(200, body) : json(404, { ok: false });
      // One sponsor at a time and no motion: the rotation is not under test.
      (w as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: true });
    },
  });
  const doc = dom.window.document;
  for (let i = 0; i < 80; i++) {
    const strip = doc.querySelector('[data-testid="poster-sponsor-strip"]');
    if (strip && strip.getAttribute('aria-busy') === 'false') break;
    await new Promise((r) => setTimeout(r, 25));
  }
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  return { doc, win: dom.window };
}

const items = (doc: Document) => [...doc.querySelectorAll('[data-testid="poster-sponsor-item"]')];

describe('digital: each sponsor gets a header block', () => {
  test('header image full width through the proxy, then logo and name, then the text', async () => {
    const { doc } = await openPoster('digital', bundle([BAKERY]));
    const [item] = items(doc);
    expect(item.classList.contains('poster-sponsor--block')).toBe(true);
    const kids = [...item.children].map((c) => c.className);
    expect(kids).toEqual(['poster-sponsor-header', 'poster-sponsor-id', 'poster-sponsor-text']);
    const img = item.querySelector('[data-testid="poster-sponsor-header"]')!;
    expect(img.getAttribute('src')).toBe('/api/v2/sponsors/sp_bakery/logo?slot=header');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
    // The name is right there in text; the picture adds nothing a reader needs.
    expect(img.getAttribute('alt')).toBe('');
    expect(item.querySelector('[data-testid="poster-sponsor-name"]')!.textContent).toBe(
      'Western Ave Bakery'
    );
    expect(item.querySelector('[data-testid="poster-sponsor-logo"]')).not.toBeNull();
    expect(item.querySelector('[data-testid="poster-sponsor-text"]')!.textContent).toBe(
      'Fresh bread every morning, two blocks from the square.'
    );
  });

  test('"Sponsored by" is one small label above the sponsor', async () => {
    const { doc } = await openPoster('digital', bundle([BAKERY]));
    const strip = doc.querySelector('[data-testid="poster-sponsor-strip"]')!;
    const label = strip.querySelector('[data-testid="poster-sponsor-label"]')!;
    expect(strip.firstElementChild).toBe(label);
    expect(label.textContent).toBe('Sponsored By');
  });

  test('the sponsor sits below the title and above the date, place and art', async () => {
    const { doc } = await openPoster('digital', bundle([BAKERY]));
    const order = [
      ...doc.querySelectorAll(
        '[data-testid="poster-title"], [data-testid="poster-sponsor-strip"], [data-testid="poster-meta"], [data-testid="poster-stage"]'
      ),
    ].map((e) => e.getAttribute('data-testid'));
    expect(order).toEqual(['poster-title', 'poster-sponsor-strip', 'poster-meta', 'poster-stage']);
  });

  test('an unconfigured sponsor falls back to its logo and name: no empty image, no empty text', async () => {
    const { doc } = await openPoster(
      'digital',
      bundle([{ id: 'sp_plain', name: 'Plain Hardware', tier: 'primary', logo_url: null }])
    );
    const [item] = items(doc);
    expect(item.querySelector('.poster-sponsor-header')).toBeNull();
    expect(item.querySelector('.poster-sponsor-text')).toBeNull();
    expect(item.querySelector('[data-testid="poster-sponsor-name"]')!.textContent).toBe(
      'Plain Hardware'
    );
    expect(item.querySelector('img')!.getAttribute('src')).toBe('/sponsor-default-logo.svg');
  });

  test('only a real yes draws the image; blank text draws no text', async () => {
    for (const has of [1, 'true', 'yes', null, undefined, false]) {
      const { doc } = await openPoster(
        'digital',
        bundle([{ ...BAKERY, has_header_image: has, header_text: '   ' }])
      );
      const [item] = items(doc);
      expect(item.querySelector('.poster-sponsor-header'), String(has)).toBeNull();
      expect(item.querySelector('.poster-sponsor-text')).toBeNull();
    }
  });

  test('typed text stays text, and the id is encoded into the proxy address', async () => {
    const { doc } = await openPoster(
      'digital',
      bundle([{ ...BAKERY, id: `sp_x/../${TAIL}`, header_text: `Hello${TAIL}` }])
    );
    const strip = doc.querySelector('[data-testid="poster-sponsor-strip"]')!;
    expect(strip.querySelectorAll('[x1], [x2], b')).toHaveLength(0);
    expect(strip.querySelector('[data-testid="poster-sponsor-text"]')!.textContent).toBe(
      `Hello${TAIL}`
    );
    expect(strip.querySelector('[data-testid="poster-sponsor-header"]')!.getAttribute('src')).toBe(
      `/api/v2/sponsors/${encodeURIComponent(`sp_x/../${TAIL}`)}/logo?slot=header`
    );
  });

  test('a header image that fails to load drops out; the logo, name and text stay', async () => {
    const { doc, win } = await openPoster('digital', bundle([BAKERY]));
    const img = doc.querySelector('[data-testid="poster-sponsor-header"]')!;
    img.dispatchEvent(new win.Event('error'));
    const [item] = items(doc);
    expect(item.querySelector('[data-testid="poster-sponsor-header"]')).toBeNull();
    expect(item.querySelector('[data-testid="poster-sponsor-name"]')).not.toBeNull();
    expect(item.querySelector('[data-testid="poster-sponsor-text"]')).not.toBeNull();
    // The logo keeps its own fallback, untouched by the header's.
    expect(item.querySelector('[data-testid="poster-sponsor-logo"]')!.getAttribute('src')).toBe(
      '/api/v2/sponsors/sp_bakery/logo'
    );
  });

  test('every tier gets the same block: the markup does not depend on tier', async () => {
    const shapes = new Set<string>();
    for (const tier of ['title', 'platinum', 'gold', 'silver', 'bronze', 'primary']) {
      const { doc } = await openPoster('digital', bundle([{ ...BAKERY, tier }]));
      const [item] = items(doc);
      shapes.add(
        `${item.className}|${[...item.querySelectorAll('*')].map((e) => e.className).join(',')}`
      );
    }
    expect(shapes.size).toBe(1);
  });
});

describe('print keeps the compact row', () => {
  test('no header image and no header text on the printed sheet', async () => {
    const { doc } = await openPoster('print', bundle([BAKERY]));
    const [item] = items(doc);
    expect(item.classList.contains('poster-sponsor--block')).toBe(false);
    expect(item.querySelector('.poster-sponsor-header, .poster-sponsor-text')).toBeNull();
    expect(item.querySelector('[data-testid="poster-sponsor-name"]')!.textContent).toBe(
      'Western Ave Bakery'
    );
  });
});

describe('the block’s styles', () => {
  const css = (() => {
    const start = POSTER_HTML.indexOf('/* OSE-1826:');
    const end = POSTER_HTML.indexOf('.page-header a:focus-visible', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return POSTER_HTML.slice(start, end).replace(/\r\n/g, '\n');
  })();

  test('tier-blind (WALL-3b): no rule in it reads a tier', () => {
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).not.toMatch(/tier/i);
  });

  test('tokens only: no raw colour', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/rgba?\(|hsla?\(/);
  });

  test('the label is smaller on the digital poster, and the header image is full width', () => {
    const label = /\.poster--digital \.poster-sponsor-label \{([^}]*)\}/.exec(css)![1];
    expect(Number(/font-size:\s*([\d.]+)rem/.exec(label)![1])).toBeLessThan(0.65);
    const header = /\.poster-sponsor \.poster-sponsor-header \{([^}]*)\}/.exec(css)![1];
    expect(header).toMatch(/width:\s*100%/);
    expect(header).toMatch(/max-width:\s*none/);
  });
});
