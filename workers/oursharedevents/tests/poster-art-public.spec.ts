/**
 * OSE-1370 + OSE-1371 — poster art reaches the public, and a share lands as a card.
 *
 * Node-clean render tests over the exported renderers (same seam as
 * calendar-action.spec.ts), parsed with jsdom — never text-sliced. The share
 * script is RUN in jsdom against stubbed navigator.share / canShare / clipboard
 * / fetch, so the feature-detect + fallback is exercised, not pattern-matched.
 * The served-route half (D1 row → /events/:id, /, /events, /s/ link, preview)
 * is tests/poster-art-share-card-served.spec.ts; the pure text builder is
 * tests/share-text.spec.ts.
 *
 * @born-red OSE-1370/OSE-1371 | method: spec written first and run against
 *   origin/main's src (tagged stash of the src change, tests kept) — cards had no
 *   thumb/date, the event page no hero, og:image absent with art, og:description
 *   had no date/venue, the share button carried only title+url and the script
 *   never feature-detected canShare or offered Email | date: 2026-09-30
 */
import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  renderPreEventHtml,
  renderEventLiveHtml,
  renderPostEventHtml,
  type PublicEventRow,
} from '../src/handlers/pages';
import { renderEventList } from '../src/lib/event-list';
import { renderLandingArea } from '../src/lib/landing-area';

const ART = '/api/v2/uploads/events/evt_x/1727700000000-bocce-poster.png';
const SHARE = 'https://oursharedevents.com/events/evt_x';
const SHORT = 'https://oursharedevents.com/s/AbC123';
const HOSTILE = [
  'javascript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'http://evil.example/poster.png',
  'https://evil.example/poster.png',
  '//evil.example/poster.png',
  '/api/v2/uploads/events/evt_x/../../admin.png',
  '/api/v2/uploads/events/evt_x/flyer.pdf',
  '" onerror="alert(1)',
];

function row(overrides: Partial<PublicEventRow> = {}): PublicEventRow {
  return {
    id: 'evt_x',
    brand_id: 'root',
    title: 'Harbor Bocce Night',
    slug: 'harbor-bocce-night',
    status: 'active',
    description: 'A neighborhood league night.',
    location: 'Eagles Bowl',
    start_date: '2026-10-24',
    end_date: '2026-10-24',
    timezone: 'America/Chicago',
    starts_at: '2026-10-24T23:00:00Z',
    what_short: 'Rolling on the green, all levels.',
    who_host: 'Harbor County Bocce',
    why_purpose: null,
    how_details: null,
    where_address: '100 Red Arrow Hwy, Sawyer MI',
    who_story: null,
    who_image_url: null,
    what_video_url: null,
    what_url: null,
    what_url_enabled: 0,
    what_url_type: null,
    lat: null,
    lon: null,
    price_cents: 500,
    price_model: 'fixed',
    price_note: null,
    is_published: 1,
    event_type_id: null,
    event_type_name: null,
    cover_image_url: ART,
    ...overrides,
  };
}

const doc = (html: string) => new JSDOM(html).window.document;
const imgSrcs = (html: string) =>
  [...doc(html).querySelectorAll('img')].map((i) => i.getAttribute('src') ?? '');
const meta = (d: Document, key: string) =>
  d.querySelector(`meta[property="${key}"], meta[name="${key}"]`)?.getAttribute('content') ?? null;

// ── OSE-1370: cards ─────────────────────────────────────────────────────────

describe('OSE-1370 | /events cards carry the poster thumbnail', () => {
  const item = (cover: unknown) => ({
    id: 'evt_x',
    name: 'Harbor Bocce Night',
    startDateISO: '2026-10-24',
    venue: 'Eagles Bowl',
    phase: 'pre_event',
    timezone: 'America/Chicago',
    cover_image_url: cover,
  });

  it('art → a lazy, no-referrer thumbnail on the leading edge, date + venue beside it', () => {
    const d = doc(renderEventList([item(ART)]).html);
    const card = d.querySelector('[data-testid="public-event-card"]')!;
    const thumb = card.querySelector('img[data-testid="public-event-thumb"]')!;
    expect(thumb.getAttribute('src')).toBe(ART);
    expect(thumb.getAttribute('loading')).toBe('lazy');
    expect(thumb.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(thumb.getAttribute('alt')).toBe(''); // the name is the text beside it
    // Leading edge: the thumb precedes the info block.
    const kids = [...card.children].map((c) => c.getAttribute('data-testid'));
    expect(kids.indexOf('public-event-thumb')).toBeLessThan(kids.indexOf('public-event-info'));
    expect(card.querySelector('[data-testid="public-event-date"]')!.textContent).toContain(
      'October 24'
    );
    // Whole-card link + tap-through are untouched (#683).
    expect(card.querySelector('a.event-card-link')!.getAttribute('href')).toBe('/events/evt_x');
  });

  it('no art → a neutral tile, never an <img>', () => {
    const d = doc(renderEventList([item(null)]).html);
    expect(d.querySelector('[data-testid="public-event-thumb-fallback"]')).not.toBeNull();
    expect(d.querySelector('img')).toBeNull();
  });

  it.each(HOSTILE)('hostile cover %s never reaches an src (tile instead)', (bad) => {
    const html = renderEventList([item(bad)]).html;
    expect(imgSrcs(html)).toEqual([]);
    expect(doc(html).querySelector('[data-testid="public-event-thumb-fallback"]')).not.toBeNull();
  });
});

describe('OSE-1370 | landing "Happening near you" cards: thumb + DATE', () => {
  const NOW = Date.parse('2026-10-20T12:00:00Z');
  const ev = (cover: unknown) => ({
    id: 'evt_x',
    name: 'Harbor Bocce Night',
    startDateISO: '2026-10-24',
    timezone: 'America/Chicago',
    phase: 'pre_event',
    venue: 'Eagles Bowl',
    cover_image_url: cover,
  });

  it('art → thumbnail; the meta line now leads with the date, then the venue', () => {
    const d = doc(renderLandingArea([ev(ART)], { now: NOW }).html);
    const card = d.querySelector('a[data-testid="area-card"]')!;
    expect(card.getAttribute('href')).toBe('/events/evt_x');
    const thumb = card.querySelector('img[data-testid="area-card-thumb"]')!;
    expect(thumb.getAttribute('src')).toBe(ART);
    expect(thumb.getAttribute('loading')).toBe('lazy');
    expect(thumb.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(card.querySelector('[data-testid="area-card-date"]')!.textContent).toBe('Sat, Oct 24');
    expect(card.querySelector('[data-testid="area-card-meta"]')!.textContent).toBe(
      'Sat, Oct 24 · Eagles Bowl'
    );
  });

  it('no art → tile; hostile art → tile, never an src', () => {
    for (const cover of [null, ...HOSTILE]) {
      const html = renderLandingArea([ev(cover)], { now: NOW }).html;
      expect(imgSrcs(html)).toEqual([]);
      expect(doc(html).querySelector('[data-testid="area-card-thumb-fallback"]')).not.toBeNull();
    }
  });
});

// ── OSE-1370: event page hero ───────────────────────────────────────────────

describe('OSE-1370 | the event page leads with the poster art', () => {
  for (const [phase, render, hero, titleId] of [
    ['pre', (r: PublicEventRow) => renderPreEventHtml(r, SHARE), 'event-hero', 'event-title'],
    [
      'live',
      (r: PublicEventRow) => renderEventLiveHtml(r, SHARE),
      'event-hero-live',
      'event-title-live',
    ],
  ] as const) {
    it(`${phase}: hero above the title, alt = event name, eager, no-referrer, sized`, () => {
      const d = doc(render(row()));
      const fig = d.querySelector(`figure[data-testid="${hero}"]`)!;
      expect(fig).not.toBeNull();
      const img = fig.querySelector('img')!;
      expect(img.getAttribute('src')).toBe(ART);
      expect(img.getAttribute('alt')).toBe('Harbor Bocce Night');
      expect(img.getAttribute('loading')).toBe('eager');
      expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
      expect(img.getAttribute('width')).toBeTruthy();
      expect(img.getAttribute('height')).toBeTruthy();
      const title = d.querySelector(`[data-testid="${titleId}"]`)!;
      // DOCUMENT_POSITION_FOLLOWING (4): the title comes after the hero.
      expect(fig.compareDocumentPosition(title) & 4).toBe(4);
      // The capped, fixed-height box is styled (no layout shift, aspect kept).
      expect(d.querySelector('style')!.textContent).toMatch(/\.ose-hero \{[^}]*height: min\(/);
    });

    it(`${phase}: no art or hostile art → no hero, no <img> of it`, () => {
      for (const cover of [null, ...HOSTILE]) {
        const html = render(row({ cover_image_url: cover }));
        expect(doc(html).querySelector(`[data-testid="${hero}"]`)).toBeNull();
        for (const src of imgSrcs(html)) expect(src).not.toMatch(/evil|javascript:|data:/);
      }
    });
  }

  it('post: the art sits INSIDE the recap card, and recap-first still holds (OSE-657)', () => {
    const d = doc(renderPostEventHtml(row(), SHARE, []));
    const recapCard = d.querySelector('[data-testid="event-recap-card"]')!;
    const fig = recapCard.querySelector('figure[data-testid="event-hero-post"]')!;
    expect(fig).not.toBeNull();
    expect(fig.querySelector('img')!.getAttribute('alt')).toBe('Harbor Bocce Night');
    const recap = d.querySelector('[data-testid="recap-primary"]')!;
    const margin = d.querySelector('[data-testid="suggestions-margin"]')!;
    expect(recap.compareDocumentPosition(margin) & 4).toBe(4);
  });
});

// ── OSE-1370/1371: the unfurl ───────────────────────────────────────────────

describe('OSE-1370/1371 | og:image, twitter:image, og:description', () => {
  const renders = [
    ['pre', (r: PublicEventRow) => renderPreEventHtml(r, SHARE)],
    ['live', (r: PublicEventRow) => renderEventLiveHtml(r, SHARE)],
    ['post', (r: PublicEventRow) => renderPostEventHtml(r, SHARE, [])],
  ] as const;

  for (const [phase, render] of renders) {
    it(`${phase}: with art → absolute og:image on our origin + large card`, () => {
      const d = doc(render(row()));
      const abs = `https://oursharedevents.com${ART}`;
      expect(meta(d, 'og:image')).toBe(abs);
      expect(meta(d, 'twitter:image')).toBe(abs);
      expect(meta(d, 'twitter:card')).toBe('summary_large_image');
    });

    it(`${phase}: og:description carries the date + venue (the unfurl's second line)`, () => {
      const desc = meta(doc(render(row())), 'og:description') ?? '';
      expect(desc).toContain('Saturday, October 24');
      expect(desc).toContain('Eagles Bowl');
      expect(meta(doc(render(row())), 'twitter:description')).toBe(desc);
    });

    it(`${phase}: no art (or hostile art) → text-only tags, small card`, () => {
      for (const cover of [null, 'https://evil.example/p.png', 'javascript:alert(1)']) {
        const d = doc(render(row({ cover_image_url: cover })));
        expect(meta(d, 'og:image')).toBeNull();
        expect(meta(d, 'twitter:image')).toBeNull();
        expect(meta(d, 'twitter:card')).toBe('summary');
        expect(meta(d, 'og:description')).toContain('Eagles Bowl');
      }
    });
  }
});

// ── OSE-1371: the share block, run in jsdom ─────────────────────────────────

interface Stubs {
  share?: ReturnType<typeof vi.fn>;
  canShare?: (d: { files?: unknown[] }) => boolean;
  clipboard?: ReturnType<typeof vi.fn>;
}

/** Load a rendered page into jsdom, stub the platform, run ITS inline scripts. */
async function runPage(html: string, stubs: Stubs) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: SHARE });
  const w = dom.window as unknown as Window & typeof globalThis & { eval: (s: string) => void };
  const nav = w.navigator as unknown as Record<string, unknown>;
  if (stubs.share) Object.defineProperty(nav, 'share', { value: stubs.share, configurable: true });
  if (stubs.canShare)
    Object.defineProperty(nav, 'canShare', { value: stubs.canShare, configurable: true });
  if (stubs.clipboard)
    Object.defineProperty(nav, 'clipboard', {
      value: { writeText: stubs.clipboard },
      configurable: true,
    });
  const fetchStub = vi.fn(async () => ({
    ok: true,
    blob: async () => new w.Blob(['png-bytes'], { type: 'image/png' }),
  }));
  (w as unknown as { fetch: unknown }).fetch = fetchStub;
  for (const s of [...w.document.querySelectorAll('script')]) w.eval(s.textContent ?? '');
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  return { w, d: w.document, fetchStub };
}

function shareParts(html: string) {
  const d = doc(html);
  const btn = d.querySelector('[data-testid="share-btn"]')!;
  const mail = d.querySelector('a[data-testid="share-email"]')!;
  const href = mail.getAttribute('href') ?? '';
  const q = new URLSearchParams(href.slice(href.indexOf('?') + 1));
  return { btn, mail, href, subject: q.get('subject'), body: q.get('body') };
}

describe('OSE-1371 | one body for share sheet, Email and Copy', () => {
  it('the button, the mailto: and the short link agree, byte for byte', () => {
    const { btn, href, subject, body } = shareParts(
      renderPreEventHtml(row(), SHARE, undefined, { nonce: 'n1', shortUrl: SHORT })
    );
    expect(btn.getAttribute('data-share-url')).toBe(SHORT);
    expect(btn.getAttribute('data-share-title')).toBe('Harbor Bocce Night, Sat Oct 24');
    const text = btn.getAttribute('data-share-text')!;
    expect(text).toContain(`Details and RSVP: ${SHORT}`);
    expect(subject).toBe(btn.getAttribute('data-share-title'));
    expect(body).toBe(text);
    // Newlines are percent-encoded in the href, never raw.
    expect(href).toContain('%0A');
    expect(href).not.toMatch(/\n/);
    // Never-who: no tracking path, no params on the shared link, no internal id path.
    expect(text).not.toContain('/q/');
    expect(text).not.toContain('evt_x');
    expect(btn.getAttribute('data-share-art')).toBe(ART);
  });

  it('no short link → the canonical /events/:id URL', () => {
    const { btn } = shareParts(renderPreEventHtml(row(), SHARE, undefined, { nonce: 'n1' }));
    expect(btn.getAttribute('data-share-url')).toBe(SHARE);
  });

  it('Spanish page → Spanish invite', () => {
    const { btn } = shareParts(
      renderPreEventHtml(row(), SHARE, undefined, { nonce: 'n1', lang: 'es', shortUrl: SHORT })
    );
    expect(btn.getAttribute('data-share-text')).toContain(`Detalles y confirmación: ${SHORT}`);
    expect(btn.getAttribute('data-share-title')).toBe('Harbor Bocce Night, sáb 24 oct');
  });

  it('every inline script carries the nonce; no inline event handlers', () => {
    const d = doc(renderPreEventHtml(row(), SHARE, undefined, { nonce: 'n1', shortUrl: SHORT }));
    const scripts = [...d.querySelectorAll('script')];
    expect(scripts.length).toBeGreaterThanOrEqual(2); // share + art error listener
    for (const s of scripts) expect(s.getAttribute('nonce')).toBe('n1');
    for (const el of [...d.querySelectorAll('*')])
      for (const a of [...el.attributes]) expect(a.name.startsWith('on')).toBe(false);
  });
});

describe('OSE-1371 | the share script feature-detects and falls back', () => {
  const page = () => renderPreEventHtml(row(), SHARE, undefined, { nonce: 'n1', shortUrl: SHORT });

  it('Web Share + canShare(files) → ONE Share button; the poster rides along as a File', async () => {
    const share = vi.fn(async () => undefined);
    const { d, fetchStub } = await runPage(page(), { share, canShare: () => true });
    expect(fetchStub).toHaveBeenCalledWith(ART, { credentials: 'omit' });
    expect(d.querySelector('[data-testid="share-email"]')).toBeNull(); // one button
    (d.querySelector('[data-testid="share-btn"]') as HTMLButtonElement).click();
    expect(share).toHaveBeenCalledTimes(1);
    const arg = share.mock.calls[0][0] as {
      title: string;
      text: string;
      url: string;
      files?: File[];
    };
    expect(arg.url).toBe(SHORT);
    expect(arg.title).toBe('Harbor Bocce Night, Sat Oct 24');
    expect(arg.text).toBe(shareParts(page()).body);
    expect(arg.files).toHaveLength(1);
    expect(arg.files![0].name).toBe('poster.png');
  });

  it('Web Share but canShare says no to files → text + url only', async () => {
    const share = vi.fn(async () => undefined);
    const { d } = await runPage(page(), { share, canShare: () => false });
    (d.querySelector('[data-testid="share-btn"]') as HTMLButtonElement).click();
    const arg = share.mock.calls[0][0] as { files?: unknown };
    expect(arg.files).toBeUndefined();
  });

  it('Web Share without canShare → no poster fetch, text + url', async () => {
    const share = vi.fn(async () => undefined);
    const { d, fetchStub } = await runPage(page(), { share });
    expect(fetchStub).not.toHaveBeenCalled();
    (d.querySelector('[data-testid="share-btn"]') as HTMLButtonElement).click();
    expect((share.mock.calls[0][0] as { files?: unknown }).files).toBeUndefined();
  });

  it('no Web Share → Email + Copy; Copy copies the SAME body the Email carries', async () => {
    const clipboard = vi.fn(async () => undefined);
    const { d } = await runPage(page(), { clipboard });
    const btn = d.querySelector('[data-testid="share-btn"]') as HTMLButtonElement;
    expect(btn.textContent).toBe('Copy invite');
    expect(d.querySelector('a[data-testid="share-email"]')).not.toBeNull();
    btn.click();
    expect(clipboard).toHaveBeenCalledWith(shareParts(page()).body);
  });
});

// ── OSE-1355 holds: the draft preview stays inert + noindex ─────────────────

describe('OSE-1355 | draft preview with art stays inert and noindex', () => {
  it('noindex, disabled share, no share text/Email/script — the art may show', () => {
    const d = doc(
      renderPreEventHtml(row(), SHARE, undefined, { nonce: 'n1', preview: true, shortUrl: SHORT })
    );
    expect(d.querySelector('meta[name="robots"]')!.getAttribute('content')).toBe(
      'noindex, nofollow'
    );
    const btn = d.querySelector('[data-testid="share-btn"]')!;
    expect(btn.hasAttribute('disabled')).toBe(true);
    expect(btn.hasAttribute('data-share-text')).toBe(false);
    expect(btn.hasAttribute('data-share-url')).toBe(false);
    expect(d.querySelector('[data-testid="share-email"]')).toBeNull();
    for (const s of [...d.querySelectorAll('script')])
      expect(s.textContent).not.toContain('navigator.share');
    expect(d.querySelector('[data-testid="event-hero"]')).not.toBeNull();
  });
});
