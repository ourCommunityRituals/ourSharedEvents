/**
 * OSE-1825 — the digital poster's When / Where / Share block (owner 2026-11-09).
 *
 * Before: the date line ("… 5:00 PM CST · Add to calendar") and the place line
 * ("Uptown Blue Island · Directions" opening "Google Maps Apple Maps") were
 * inline text links, the place had no street address, and there was no way to
 * share the event from the poster. After: each fact is a small card with its
 * actions as @ocr/ui buttons, the place shows the venue's street address
 * (events.where_address, already in the public projection), and a Share button
 * uses the phone's own share sheet, falling back to plain share links on a
 * desktop (OSE-1371 decision, owner 2026-09-28: no SDK, no tracker, no cookie).
 *
 * Layer: the served template, its script run in jsdom with the poster-bundle
 * answered here. The phone check is tests/playwright/poster-digital-actions.spec.ts.
 *
 * @born-red OSE-1825 | method: run against the pre-change template (no
 * poster-details, no address line, no share block) and against planted faults:
 * the address line removed, Web Share skipped, a tracking parameter added to
 * the shared address, the preview's Share left live, a control under 44px.
 * Each turned this file red | date: 2026-11-09
 * @born-red styles moved to @ocr/ui | method: the inline OSE-1825 CSS put back,
 * a class renamed in the markup, .share-chip dropped from @ocr/ui, its
 * min-height dropped. Each turned the styles block red | date: 2026-11-09
 */
import { describe, test, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { componentStyles, structural } from '@ocr/ui';
import POSTER_HTML from '../src/templates/poster.html';

const EVT = 'evt_1825';
const ORIGIN = 'https://ose.test';
const EVENT_URL = `${ORIGIN}/events/${EVT}`;

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function bundle(event: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ok: true,
    status: 200,
    eventId: EVT,
    event: {
      id: EVT,
      name: 'Uptown Blue Island',
      venue: 'Uptown Blue Island',
      where_address: '13001 S Western Ave, Blue Island, IL 60406',
      startDateISO: '2026-11-11',
      starts_at: '2026-11-11T23:00:00.000Z',
      timezone: 'America/Chicago',
      ...event,
    },
    sponsors: [],
    slots: [],
    settings: { showQRSection: true },
  };
}

interface Opened {
  doc: Document;
  win: JSDOM['window'];
}

type Nav = {
  share?: (data: unknown) => Promise<void>;
  clipboard?: { writeText: (s: string) => Promise<void> };
};

async function openPoster(
  kind: 'print' | 'digital',
  body: Record<string, unknown>,
  opts: { preview?: boolean; nav?: Nav; template?: string } = {}
): Promise<Opened> {
  const template = opts.template ?? POSTER_HTML;
  const served = opts.preview
    ? template.replace('<body>', `<body data-preview-event="${EVT}">`)
    : template;
  const url = opts.preview
    ? `${ORIGIN}/api/v2/admin/events/${EVT}/poster-preview?kind=${kind}`
    : `${ORIGIN}/events/${EVT}/poster?kind=${kind}`;
  const dom = new JSDOM(served, {
    url,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      (w as unknown as { fetch: unknown }).fetch = async (input: string) =>
        String(input).includes('/poster-bundle') ? json(200, body) : json(404, { ok: false });
      const nav = w.navigator as unknown as Record<string, unknown>;
      // jsdom has neither; a test opts in to each.
      if (opts.nav?.share) Object.defineProperty(nav, 'share', { value: opts.nav.share });
      if (opts.nav?.clipboard)
        Object.defineProperty(nav, 'clipboard', { value: opts.nav.clipboard });
    },
  });
  const doc = dom.window.document;
  for (let i = 0; i < 80; i++) {
    const strip = doc.querySelector('[data-testid="poster-sponsor-strip"]');
    if (strip && strip.getAttribute('aria-busy') === 'false') break;
    await new Promise((r) => setTimeout(r, 25));
  }
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  expect(doc.querySelector('[data-testid="poster-card"]'), 'the poster card').not.toBeNull();
  return { doc, win: dom.window };
}

const q = (doc: Document, id: string) => doc.querySelector(`[data-testid="${id}"]`);
const tick = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

describe('digital: When and Where are cards with button actions', () => {
  test('When: the date and the start time as text, Add to calendar as a button', async () => {
    const { doc } = await openPoster('digital', bundle());
    expect(q(doc, 'poster-when-date')!.textContent).toBe('Wednesday, November 11, 2026');
    expect(q(doc, 'poster-when-time')!.textContent).toBe('5:00 PM CST');
    const cal = q(doc, 'poster-add-to-calendar')!;
    expect(cal.tagName).toBe('A');
    expect(cal.className).toBe('btn btn-outline');
    expect(cal.textContent).toBe('Add to calendar');
    expect(cal.getAttribute('href')).toBe(`/events/${EVT}/calendar.ics`);
  });

  test('Where: the venue name, its street address under it, and two map buttons', async () => {
    const { doc } = await openPoster('digital', bundle());
    expect(q(doc, 'poster-venue-name')!.textContent).toBe('Uptown Blue Island');
    expect(q(doc, 'poster-venue-address')!.textContent).toBe(
      '13001 S Western Ave, Blue Island, IL 60406'
    );
    const group = q(doc, 'poster-directions')!;
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toBe('Directions');
    const buttons = [...group.querySelectorAll('a')];
    expect(buttons.map((b) => [b.className, b.textContent])).toEqual([
      ['btn btn-outline', 'Google Maps'],
      ['btn btn-outline', 'Apple Maps'],
    ]);
    // The maps search the street address the organizer typed.
    const q1 = encodeURIComponent('13001 S Western Ave, Blue Island, IL 60406');
    expect(buttons[0].getAttribute('href')).toBe(
      `https://www.google.com/maps/search/?api=1&query=${q1}`
    );
    expect(buttons[1].getAttribute('href')).toBe(`https://maps.apple.com/?q=${q1}`);
    for (const b of buttons) expect(b.getAttribute('rel')).toBe('noopener noreferrer');
  });

  test('an address that only repeats the venue name is not shown twice', async () => {
    const { doc } = await openPoster(
      'digital',
      bundle({ venue: 'Harbor Hall', where_address: '  harbor hall ' })
    );
    expect(q(doc, 'poster-venue-name')!.textContent).toBe('Harbor Hall');
    expect(q(doc, 'poster-venue-address')).toBeNull();
  });

  test('no address: the venue alone, and the maps search the venue name', async () => {
    const { doc } = await openPoster(
      'digital',
      bundle({ venue: 'Harbor Hall', where_address: null })
    );
    expect(q(doc, 'poster-venue-address')).toBeNull();
    expect(q(doc, 'poster-open-map')!.getAttribute('href')).toBe(
      'https://www.google.com/maps/search/?api=1&query=Harbor%20Hall'
    );
  });

  test('an address and no venue name: the address is the place', async () => {
    const { doc } = await openPoster('digital', bundle({ venue: null, location: null }));
    expect(q(doc, 'poster-venue-name')!.textContent).toBe(
      '13001 S Western Ave, Blue Island, IL 60406'
    );
    expect(q(doc, 'poster-venue-address')).toBeNull();
  });

  // OSE-1991 (owner 2026-11-11): "The print url should follow using the cards,
  // titles, action buttons without the clicking."
  test('print: the same When and Where cards and button shapes, nothing to tap, no Share', async () => {
    const { doc } = await openPoster('print', bundle());
    const meta = q(doc, 'poster-meta')!;
    expect(meta.classList.contains('detail-list')).toBe(true);
    expect(q(doc, 'poster-meta-date')!.className).toBe('detail-card');
    expect(q(doc, 'poster-meta-venue')!.className).toBe('detail-card');
    expect(q(doc, 'poster-when-date')!.textContent).toBe('Wednesday, November 11, 2026');
    expect(q(doc, 'poster-when-time')!.textContent).toBe('5:00 PM CST');
    expect(q(doc, 'poster-venue-name')!.textContent).toBe('Uptown Blue Island');
    expect(q(doc, 'poster-venue-address')!.textContent).toBe(
      '13001 S Western Ave, Blue Island, IL 60406'
    );
    // The same three buttons, as pictures: spans, no address, no tab stop.
    const shapes = ['poster-add-to-calendar', 'poster-open-map', 'poster-open-map-apple'].map(
      (id) => q(doc, id)!
    );
    expect(shapes.map((b) => [b.tagName, b.className, b.textContent])).toEqual([
      ['SPAN', 'btn btn-outline btn-static', 'Add to calendar'],
      ['SPAN', 'btn btn-outline btn-static', 'Google Maps'],
      ['SPAN', 'btn btn-outline btn-static', 'Apple Maps'],
    ]);
    expect(meta.querySelectorAll('a, button, [href], [tabindex], [role="group"]')).toHaveLength(0);
    // A screen reader is not told about buttons it cannot press.
    for (const b of shapes) expect(b.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(q(doc, 'poster-share')).toBeNull();
    expect(q(doc, 'poster-share-btn')).toBeNull();
  });
});

describe('digital: Share', () => {
  test('the phone’s own share sheet first: title, the poster’s words, the public page', async () => {
    const calls: unknown[] = [];
    const { doc, win } = await openPoster('digital', bundle(), {
      nav: { share: async (d) => void calls.push(d) },
    });
    const btn = q(doc, 'poster-share-btn') as HTMLButtonElement;
    expect(btn.className).toBe('btn btn-primary btn-block');
    expect(btn.textContent).toBe('Share this event');
    btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await tick();
    expect(calls).toEqual([
      {
        title: 'Uptown Blue Island',
        text: 'Uptown Blue Island · Wednesday, November 11, 2026, 5:00 PM CST · Uptown Blue Island',
        url: EVENT_URL,
      },
    ]);
    // The sheet did the work: the fallback row stays closed.
    expect((q(doc, 'poster-share-links') as HTMLElement).hidden).toBe(true);
  });

  test('a person closing the sheet is not an error; a refused sheet opens the links', async () => {
    const abort = Object.assign(new Error('closed'), { name: 'AbortError' });
    const closed = await openPoster('digital', bundle(), {
      nav: { share: () => Promise.reject(abort) },
    });
    q(closed.doc, 'poster-share-btn')!.dispatchEvent(
      new closed.win.MouseEvent('click', { bubbles: true })
    );
    await tick();
    expect((q(closed.doc, 'poster-share-links') as HTMLElement).hidden).toBe(true);

    const refused = Object.assign(new Error('no'), { name: 'NotAllowedError' });
    const r = await openPoster('digital', bundle(), {
      nav: { share: () => Promise.reject(refused) },
    });
    q(r.doc, 'poster-share-btn')!.dispatchEvent(new r.win.MouseEvent('click', { bubbles: true }));
    await tick();
    expect((q(r.doc, 'poster-share-links') as HTMLElement).hidden).toBe(false);
  });

  test('no share sheet (a desktop): the button opens and closes a row of plain share links', async () => {
    const { doc, win } = await openPoster('digital', bundle());
    const btn = q(doc, 'poster-share-btn')!;
    const links = q(doc, 'poster-share-links') as HTMLElement;
    expect(links.hidden).toBe(true);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.getAttribute('aria-controls')).toBe(links.id);
    btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    expect(links.hidden).toBe(false);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    expect(links.hidden).toBe(true);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  test('each share link is a fixed start and the public page, with nothing added to it', async () => {
    const { doc } = await openPoster('digital', bundle());
    const text = `Uptown Blue Island · Wednesday, November 11, 2026, 5:00 PM CST · Uptown Blue Island\n${EVENT_URL}`;
    const T = encodeURIComponent(text);
    const U = encodeURIComponent(EVENT_URL);
    const links = [...q(doc, 'poster-share-links')!.querySelectorAll('a')];
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Email', `mailto:?body=${T}`],
      ['Text message', `sms:?&body=${T}`],
      ['WhatsApp', `https://wa.me/?text=${T}`],
      ['Facebook', `https://www.facebook.com/sharer/sharer.php?u=${U}`],
      ['X', `https://twitter.com/intent/tweet?text=${T}`],
      ['LinkedIn', `https://www.linkedin.com/sharing/share-offsite/?url=${U}`],
      ['Reddit', `https://www.reddit.com/submit?url=${U}`],
      ['Telegram', `https://t.me/share/url?url=${U}`],
    ]);
    // Leaving the site: a new tab, and no referrer from the anonymous page.
    for (const a of links.filter((l) => l.getAttribute('href')!.startsWith('https://'))) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    }
    // No tracking parameter anywhere in what is shared.
    const block = q(doc, 'poster-share')!.outerHTML;
    expect(block).not.toMatch(/utm_|fbclid|gclid|ref%3D|%3Fref|source%3D/i);
    expect(q(doc, 'poster-share')!.getAttribute('data-share-url')).toBe(EVENT_URL);
  });

  test('Copy link puts the public page on the clipboard and says so', async () => {
    const copied: string[] = [];
    const { doc, win } = await openPoster('digital', bundle(), {
      nav: { clipboard: { writeText: async (s) => void copied.push(s) } },
    });
    q(doc, 'poster-share-btn')!.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    q(doc, 'poster-share-copy')!.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await tick();
    expect(copied).toEqual([EVENT_URL]);
    expect(q(doc, 'poster-share-status')!.textContent).toBe('Link copied');
    expect(q(doc, 'poster-share-status')!.getAttribute('role')).toBe('status');
  });

  test('a failed copy shows the link instead of failing quietly', async () => {
    const { doc, win } = await openPoster('digital', bundle(), {
      nav: { clipboard: { writeText: () => Promise.reject(new Error('denied')) } },
    });
    q(doc, 'poster-share-copy')!.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await tick();
    expect(q(doc, 'poster-share-status')!.textContent).toBe(
      `Copy did not work. The link is ${EVENT_URL}`
    );
  });

  test('the admin draft preview shows Share switched off: its link is not public yet', async () => {
    const calls: unknown[] = [];
    const { doc, win } = await openPoster('digital', bundle(), {
      preview: true,
      nav: { share: async (d) => void calls.push(d) },
    });
    const btn = q(doc, 'poster-share-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(q(doc, 'poster-share-links')).toBeNull();
    btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await tick();
    expect(calls).toEqual([]);
  });

  test('Share is screen-only: the block is hidden when the digital poster is printed', async () => {
    const { doc } = await openPoster('digital', bundle());
    expect(q(doc, 'poster-share')!.classList.contains('no-print')).toBe(true);
  });
});

// The block's look comes from @ocr/ui (.detail-card, .share-row, .share-chip),
// not from CSS in this spoke: the spoke-styles ratchet refuses a poster that
// grows its own stylesheet (owner 2026-11-09, "Move to @ocr/ui").
describe('the block’s styles come from @ocr/ui: 44px targets, tokens only', () => {
  const posterCss = [...POSTER_HTML.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((m) => m[1])
    .join('\n');
  /** The declaration block of the @ocr/ui rule whose selector is exactly `sel`. */
  const uiRule = (sel: string): string => {
    for (const before of ['\n', '}']) {
      const at = componentStyles.indexOf(`${before}${sel}{`);
      if (at === -1) continue;
      const start = at + before.length + sel.length + 1;
      return componentStyles.slice(start, componentStyles.indexOf('}', start));
    }
    return '';
  };
  const tapMinPx = Number(/^(\d+)px$/.exec(structural['--tap-min'])?.[1]);

  test('the digital markup uses the @ocr/ui classes', async () => {
    const { doc } = await openPoster('digital', bundle(), { nav: {} });
    expect(q(doc, 'poster-meta')!.classList.contains('detail-list')).toBe(true);
    expect(q(doc, 'poster-meta-date')!.className).toBe('detail-card');
    expect(q(doc, 'poster-meta-venue')!.className).toBe('detail-card');
    expect(q(doc, 'poster-directions')!.className).toBe('detail-card-actions');
    expect(q(doc, 'poster-share')!.classList.contains('share-row')).toBe(true);
    expect(q(doc, 'poster-share-links')!.className).toBe('share-chips');
    const chips = [...q(doc, 'poster-share-links')!.querySelectorAll('a, button')];
    expect(chips.length).toBe(9);
    for (const c of chips) expect(c.className, c.textContent ?? '').toBe('share-chip');
    expect(q(doc, 'poster-share-status')!.className).toBe('share-status');
  });

  test('@ocr/ui defines every class the block uses', () => {
    for (const sel of [
      '.detail-list',
      '.detail-card',
      '.detail-card-text',
      '.detail-card-label',
      '.detail-card-main',
      '.detail-card-sub',
      '.detail-card-actions',
      '.share-chips',
      '.share-chip',
      '.share-status',
    ]) {
      expect(uiRule(sel), sel).not.toBe('');
    }
  });

  test('the poster carries no CSS of its own for the block', () => {
    expect(posterCss).not.toMatch(
      /\.(?:detail-list|detail-card|share-row|share-chips?|share-status|poster-details?|poster-detail-\w+|poster-share(?:-\w+)?)\b[^{]*\{/
    );
  });

  test('every control in it is at least 44px tall', () => {
    expect(tapMinPx).toBeGreaterThanOrEqual(44);
    expect(uiRule('.btn')).toContain('min-height:var(--tap-min)');
    expect(uiRule('.share-chip')).toContain('min-height:var(--tap-min)');
    expect(uiRule('.detail-card-actions .btn')).not.toMatch(/height/);
  });

  test('no raw colour: every colour is a token', () => {
    for (const sel of [
      '.detail-card',
      '.detail-card-label',
      '.detail-card-main',
      '.share-chip',
      '.share-status',
    ]) {
      const body = uiRule(sel);
      expect(body, sel).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
      expect(body, sel).toMatch(/var\(--/);
    }
  });
});
