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
 * @born-red styles moved to @ocr/ui | method: the inline OSE-1826 CSS put back,
 * the digital label left on its print class, a [data-tier] panel rule added to
 * @ocr/ui. Each turned the styles block red | date: 2026-11-09
 */
import { describe, test, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { componentStyles } from '@ocr/ui';
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
    expect(item.className).toBe('sponsor-panel-block');
    const kids = [...item.children].map((c) => c.className);
    expect(kids).toEqual(['sponsor-panel-header', 'sponsor-panel-id', 'sponsor-panel-text']);
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
    expect(item.querySelector('.sponsor-panel-header')).toBeNull();
    expect(item.querySelector('.sponsor-panel-text')).toBeNull();
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
      expect(item.querySelector('.sponsor-panel-header'), String(has)).toBeNull();
      expect(item.querySelector('.sponsor-panel-text')).toBeNull();
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
    expect(item.className).toBe('poster-sponsor');
    expect(item.querySelector('.sponsor-panel-header, .sponsor-panel-text')).toBeNull();
    expect(item.querySelector('[data-testid="poster-sponsor-name"]')!.textContent).toBe(
      'Western Ave Bakery'
    );
  });
});

// The block's look is @ocr/ui's sponsor panel (.sponsor-panel*), not CSS in
// this spoke: the spoke-styles ratchet refuses a poster that grows its own
// stylesheet (owner 2026-11-09, "Move to @ocr/ui").
describe('the block’s styles come from @ocr/ui', () => {
  const posterCss = [...POSTER_HTML.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((m) => m[1])
    .join('\n');
  const uiCss = componentStyles.replace(/\/\*[\s\S]*?\*\//g, '');
  /** The declaration block of the @ocr/ui rule whose selector is exactly `sel`. */
  const uiRule = (sel: string): string => {
    for (const before of ['\n', '}']) {
      const at = uiCss.indexOf(`${before}${sel}{`);
      if (at === -1) continue;
      const start = at + before.length + sel.length + 1;
      return uiCss.slice(start, uiCss.indexOf('}', start));
    }
    return '';
  };
  const PANEL = [
    '.sponsor-panel',
    '.sponsor-panel-label',
    '.sponsor-panel-block',
    '.sponsor-panel-header',
    '.sponsor-panel-id',
    '.sponsor-panel-id img',
    '.sponsor-panel-name',
    '.sponsor-panel-text',
  ];

  test('the digital strip, label and name use the panel classes; print keeps its own', async () => {
    const digital = await openPoster('digital', bundle([BAKERY]));
    const strip = digital.doc.querySelector('[data-testid="poster-sponsor-strip"]')!;
    expect(strip.classList.contains('sponsor-panel')).toBe(true);
    expect(strip.querySelector('[data-testid="poster-sponsor-label"]')!.className).toBe(
      'sponsor-panel-label'
    );
    expect(strip.querySelector('[data-testid="poster-sponsor-name"]')!.className).toBe(
      'sponsor-panel-name'
    );
    const print = await openPoster('print', bundle([BAKERY]));
    const printStrip = print.doc.querySelector('[data-testid="poster-sponsor-strip"]')!;
    expect(printStrip.classList.contains('sponsor-panel')).toBe(false);
    expect(printStrip.querySelector('[data-testid="poster-sponsor-label"]')!.className).toBe(
      'poster-sponsor-label'
    );
  });

  test('@ocr/ui defines every class the block uses', () => {
    for (const sel of PANEL) expect(uiRule(sel), sel).not.toBe('');
  });

  test('the poster carries no CSS of its own for the block', () => {
    expect(posterCss).not.toMatch(
      /\.(?:sponsor-panel[\w-]*|poster-sponsor--block|poster-sponsor-(?:header|id|text))\b[^{]*\{/
    );
  });

  test('tier-blind (WALL-3b): no panel rule reads a tier', () => {
    const rules = uiCss.split('}').filter((r) => r.includes('sponsor-panel'));
    expect(rules.length).toBeGreaterThanOrEqual(PANEL.length);
    for (const r of rules) expect(r).not.toMatch(/tier|platinum|gold|silver|bronze/i);
  });

  test('tokens only: no raw colour', () => {
    for (const sel of PANEL) {
      expect(uiRule(sel), sel).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    }
  });

  test('the label is small (the 13px floor), and the header image is full width at 3:1', () => {
    expect(uiRule('.sponsor-panel-label')).toContain('font-size:var(--text-min)');
    const header = uiRule('.sponsor-panel-header');
    expect(header).toContain('width:100%');
    expect(header).toContain('aspect-ratio:3/1');
  });
});
