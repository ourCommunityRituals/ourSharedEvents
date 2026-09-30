/**
 * OSE-1410 follow-up — regression locks for the five CodeQL security findings
 * the new findings gate reported in the served templates, which kept the
 * CodeQL job red on every push to main from 2026-09-29:
 *
 *   1. js/xss-more-sources (admin.html, wizard sign-up QR)
 *      poster-bundle's qr.register went straight into img.src.
 *   2. js/xss-more-sources (admin.html, poster art preview)
 *      events.cover_image_url (free text, only length-capped) went straight
 *      into img.src.
 *   3. js/remote-property-injection-more-sources (admin.html, poster deployments)
 *      window._pdItems[pd.id] = … — a row id of "__proto__" wrote to the
 *      prototype.
 *   4. js/remote-property-injection-more-sources (shared-report.html)
 *      suppressionByField[r.field] = r, same shape, from the report response.
 *   5. js/log-injection-more-sources (admin.html, flag toggle)
 *      console.error logged an Error built from the server's error text.
 *
 * 2, 3 run the card's real script in jsdom. 1, 4 and 5 sit inside page-level
 * scripts that need the whole page to run, so they are asserted on the
 * extracted script text. All five were confirmed cleared by a local CodeQL
 * 2.27.1 run of the security-experimental suite over src/ (5 results before,
 * 0 after).
 *
 * @born-red OSE-1410 | method: run against origin/main's templates (e147f17)
 *   — red; green after | date: 2026-09-30
 */

import { describe, test, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import ADMIN_HTML from '../src/templates/admin.html';
import SHARED_REPORT_HTML from '../src/templates/shared-report.html';

// Find a page script as a parsed element (no execution), by a marker it contains.
function scriptContaining(html: string, marker: string): string {
  const doc = new JSDOM(html).window.document;
  const el = Array.from(doc.querySelectorAll('script')).find((s) =>
    (s.textContent || '').includes(marker)
  );
  expect(el, `script containing ${marker}`).toBeDefined();
  return el!.textContent || '';
}

function markupBetween(html: string, startMarker: string, endMarker: string): string {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  expect(start, startMarker).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

type W = Window & Record<string, unknown> & { eval(s: string): unknown };

function mount(markup: string, script: string, reply: (url: string) => unknown): W {
  const dom = new JSDOM(`<!doctype html><body>${markup}</body>`, {
    runScripts: 'outside-only',
    url: 'https://admin.test/admin',
  });
  const w = dom.window as unknown as W;
  w.fetch = vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () => reply(url),
  })) as unknown as typeof fetch;
  w._adminAnnounce = () => {};
  w.eval(script);
  return w;
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

describe('poster art preview shows only an image this Worker serves', () => {
  const markup = markupBetween(
    ADMIN_HTML,
    '<div class="card poster-art-card"',
    '<p class="create-msg" id="pa-msg"'
  );
  const script = scriptContaining(ADMIN_HTML, 'window.loadPosterArt = async function');

  async function previewFor(cover: unknown) {
    const w = mount(markup, script, () => ({ ok: true, item: { cover_image_url: cover } }));
    await (w.loadPosterArt as (id: string) => Promise<void>)('evt_art_1');
    await flush();
    const img = w.document.getElementById('pa-preview') as HTMLImageElement;
    const none = w.document.getElementById('pa-preview-none') as HTMLElement;
    return { src: img.getAttribute('src'), imgHidden: img.hidden, noneHidden: none.hidden };
  }

  test('an R2 upload path is previewed', async () => {
    const url = '/api/v2/uploads/events/evt_art_1/1727700000000-poster.png';
    expect(await previewFor(url)).toEqual({ src: url, imgHidden: false, noneHidden: true });
  });

  test.each([
    'javascript:alert(1)',
    'https://evil.example/pixel.png',
    '//evil.example/x.png',
    'data:image/svg+xml,<svg onload=alert(1)>',
    '/api/v2/uploads/x.png" onerror="alert(1)',
    '/admin',
  ])('%s is not put in the page; the empty state shows instead', async (cover) => {
    expect(await previewFor(cover)).toEqual({ src: null, imgHidden: true, noneHidden: false });
  });
});

describe('poster deployments are kept by id without touching the prototype', () => {
  const markup = markupBetween(
    ADMIN_HTML,
    '<div class="card poster-deployments-card"',
    '<!-- R4 (OSE-1319)'
  );
  const script = scriptContaining(ADMIN_HTML, 'window.loadPosterDeployments = async function');
  const row = (id: string) => ({
    id,
    qr_token: 'qrt_' + id,
    placement_label: 'Front door',
    is_active: 1,
    scan_url: 'https://oursharedevents.com/q/qrt_x',
    qr_data_uri: 'data:image/png;base64,iVBORw0KGgo=',
    target_url: 'https://oursharedevents.com/events/evt_x',
    target_label: 'Event page',
    slots: [],
  });

  test('a row id of "__proto__" is stored as an entry, not as the prototype', async () => {
    const w = mount(markup, script, () => ({ ok: true, items: [row('__proto__'), row('pd_1')] }));
    await (w.loadPosterDeployments as (id: string) => Promise<void>)('evt_pd_1');
    await flush();
    const items = w._pdItems as Map<string, { label: string }>;
    expect(items).toBeInstanceOf(w.Map as unknown as MapConstructor);
    expect(items.get('__proto__')?.label).toBe('Front door');
    expect(items.get('pd_1')?.label).toBe('Front door');
    expect(Object.getPrototypeOf(items)).toBe((w.Map as unknown as MapConstructor).prototype);
    expect(({} as Record<string, unknown>).label).toBeUndefined();
  });

  test('Download QR still finds a row by id', async () => {
    const w = mount(markup, script, () => ({ ok: true, items: [row('pd_1')] }));
    await (w.loadPosterDeployments as (id: string) => Promise<void>)('evt_pd_1');
    await flush();
    const announce = vi.fn();
    w._adminAnnounce = announce;
    const clicked: string[] = [];
    (
      w as unknown as { HTMLAnchorElement: typeof HTMLAnchorElement }
    ).HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    };
    (w.downloadPosterQr as (id: string) => void)('pd_1');
    expect(announce).not.toHaveBeenCalled();
    expect(clicked).toEqual(['poster-qr-front-door.png']);
  });
});

describe('page-level scripts: guarded sinks', () => {
  test('wizard sign-up QR: img.src is set only after a PNG data-URI check', () => {
    const src = scriptContaining(ADMIN_HTML, "getElementById('wizardQrSignup')");
    expect(src).not.toMatch(/\.src\s*=\s*data\.qr\.register/);
    const guard = src.indexOf('/^data:image\\/png;base64,[A-Za-z0-9+/=]+$/.test(regQr)');
    const sink = src.indexOf('img2.src = regQr');
    expect(guard).toBeGreaterThan(-1);
    expect(sink).toBeGreaterThan(guard);
  });

  test('flag toggle: the caught error is not logged', () => {
    const src = scriptContaining(ADMIN_HTML, "'Could not update ' + flagKey");
    expect(src).not.toMatch(/console\.error\('Flag toggle failed:',\s*err/);
    expect(src).toContain("console.error('Flag toggle failed.')");
  });

  test('shared report: suppression reasons are keyed in a Map, not a plain object', () => {
    const src = scriptContaining(SHARED_REPORT_HTML, 'suppressionByField');
    expect(src).toContain('const suppressionByField = new Map();');
    expect(src).not.toMatch(/suppressionByField\[/);
  });
});
