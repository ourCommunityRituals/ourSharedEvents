/**
 * poster.html preview mode (2026-10-02). The admin poster preview sets
 * data-preview-event on <body>; the poster then draws that event from the
 * ADMIN poster-bundle (which serves drafts) instead of the public one, with no
 * ?event= in the URL. Without the attribute nothing changes. Runs the page's
 * real script in jsdom with a stubbed fetch.
 */
import { describe, test, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import POSTER_HTML from '../src/templates/poster.html';

function mainScript(): string {
  const doc = new JSDOM(POSTER_HTML).window.document;
  const el = Array.from(doc.querySelectorAll('script')).find((s) =>
    (s.textContent || '').includes('async function loadPosterBundle')
  );
  expect(el, 'poster main script').toBeDefined();
  return el!.textContent || '';
}

async function boot(opts: { previewEvent?: string; search?: string; slots?: unknown[] }) {
  const html = opts.previewEvent
    ? POSTER_HTML.replace('<body>', `<body data-preview-event="${opts.previewEvent}">`)
    : POSTER_HTML;
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://t.test/poster' + (opts.search ?? ''),
  });
  const w = dom.window as unknown as Window & { eval(s: string): unknown };
  const urls: string[] = [];
  w.fetch = (async (url: string) => {
    urls.push(url);
    const body = url.endsWith('/poster-bundle')
      ? {
          ok: true,
          event: { id: 'evt-draft', name: 'Draft Bocce Night', title: 'Draft Bocce Night' },
          sponsors: [],
          qr: {},
          slots: opts.slots ?? [],
          settings: { showQRSection: !!opts.slots },
        }
      : { ok: true, items: [] };
    return { ok: true, status: 200, json: async () => body };
  }) as unknown as typeof fetch;
  w.eval(mainScript());
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
  return { doc: w.document, urls };
}

describe('poster preview mode', () => {
  test('draws the named draft from the admin bundle, with no ?event= needed', async () => {
    const { doc, urls } = await boot({ previewEvent: 'evt-draft' });
    expect(urls).toEqual(['/api/v2/admin/events/evt-draft/poster-bundle']);
    expect(doc.getElementById('poster-area')!.textContent).toContain('Draft Bocce Night');
  });

  test('a normal scoped poster still uses the public bundle', async () => {
    const { urls } = await boot({ search: '?event=evt-live' });
    expect(urls).toEqual(['/api/v2/events/evt-live/poster-bundle']);
  });
});

describe('poster QR cards: short codes live, direct links only in preview', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgo=';
  const hrefs = (doc: Document) =>
    [...doc.querySelectorAll('#poster-qr-slots a')].map((a) => a.getAttribute('href'));

  test('preview: a slot with no code yet still shows, linking to its destination', async () => {
    const { doc } = await boot({
      previewEvent: 'evt-draft',
      slots: [
        {
          kind: 'public',
          code: null,
          url: 'https://t.test/events/evt-draft',
          qr: PNG,
          word: 'Event page',
        },
      ],
    });
    expect(hrefs(doc)).toEqual(['https://t.test/events/evt-draft']);
  });

  test('preview: a non-https or odd link is dropped, never put in an href', async () => {
    const { doc } = await boot({
      previewEvent: 'evt-draft',
      slots: [
        { kind: 'public', code: null, url: 'javascript:alert(1)', qr: PNG },
        { kind: 'donation', code: null, url: 'http://plain.example/', qr: PNG },
      ],
    });
    expect(hrefs(doc)).toEqual([]);
  });

  test('live poster: only validated short codes, a code-less slot is dropped', async () => {
    const { doc } = await boot({
      search: '?event=evt-live',
      slots: [
        { kind: 'public', code: 'ABC123', url: 'https://t.test/s/ABC123', qr: PNG },
        { kind: 'donation', code: null, url: 'https://donate.example/', qr: PNG },
      ],
    });
    expect(hrefs(doc)).toEqual(['https://t.test/s/ABC123']);
  });
});
