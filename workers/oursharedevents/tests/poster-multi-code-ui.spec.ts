/**
 * OSE-1357 part 2 — the two screens of "more than one code per poster":
 *   1. the admin poster card's "Codes on the poster" editor, and
 *   2. /poster, print and digital,
 * each RUN (their real scripts, from the served templates) in jsdom against a
 * stubbed fetch — not pattern-matched. API half: tests/poster-multi-code.spec.ts.
 *
 * @born-red OSE-1357 | method: spec written before the change and run against
 *   the base branch (no editor in the card; /poster slots carried no word/tone
 *   and took their href from the response) — red; green after | date: 2026-09-29
 */

import { describe, test, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import ADMIN_HTML from '../src/templates/admin.html';
import POSTER_HTML from '../src/templates/poster.html';

const EVT = 'evt_multi_ui_1357';
const QR = 'data:image/png;base64,iVBORw0KGgo=';
const KINDS = [
  {
    kind: 'checkin',
    word: 'CHECK IN',
    choice: 'Anonymous check-in',
    tone: 'checkin',
    needs_url: false,
  },
  { kind: 'donation', word: 'DONATE', choice: 'Donation link', tone: 'donate', needs_url: true },
  { kind: 'signup', word: 'SIGN UP', choice: 'Sign-up link', tone: 'neutral', needs_url: true },
  { kind: 'ow', word: 'MUSIC', choice: 'ourWKRP link', tone: 'neutral', needs_url: true },
];
const code = (kind: string, c: string, extra: Record<string, unknown> = {}) => ({
  kind,
  word: KINDS.find((k) => k.kind === kind)?.word ?? 'EVENT',
  code: c,
  url: `https://ose.test/s/${c}`,
  qr: QR,
  target_url: null,
  points_to: kind === 'public' ? `https://ose.test/events/${EVT}` : '',
  ...extra,
});
const SAVED = [
  code('public', 'Pub001'),
  code('checkin', 'Chk001', { points_to: `https://ose.test/forms/${EVT}?type=checkin` }),
  code('donation', 'Don001', {
    target_url: 'https://give.example.org/x',
    points_to: 'https://give.example.org/x',
  }),
];

type Reply = { status?: number; body?: unknown };
type Router = (url: string, init?: RequestInit) => Reply;

function stubFetch(w: Window & Record<string, unknown>, router: Router) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  w.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: (init?.method ?? 'GET').toUpperCase(),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const r = router(url, init);
    const status = r.status ?? 200;
    return { ok: status < 400, status, json: async () => r.body };
  }) as unknown as typeof fetch;
  return calls;
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

// ── Admin card ──────────────────────────────────────────────────────────────

function cardMarkup(html: string): string {
  const start = html.indexOf('<div class="card poster-deployments-card"');
  const end = html.indexOf('<!-- R4 (OSE-1319)', start);
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, end);
}
// Scripts are found as parsed elements (jsdom parses without running them),
// never by slicing raw text around a script tag — that pattern is what
// Semgrep's unknown-value-with-script-tag rule flags, and a parser is the
// more honest extraction anyway.
function scriptContaining(html: string, needle: string): string {
  const doc = new JSDOM(html).window.document;
  const el = Array.from(doc.querySelectorAll('script')).find((s) =>
    (s.textContent || '').includes(needle)
  );
  expect(el, needle).toBeDefined();
  return el!.textContent || '';
}
function codesScript(html: string): string {
  return scriptContaining(html, 'window.loadPosterCodes = async function');
}

async function mountAdmin(
  opts: { limit?: number; codes?: unknown[]; put?: (b: unknown) => Reply } = {}
) {
  const dom = new JSDOM(`<!doctype html><body>${cardMarkup(ADMIN_HTML)}</body>`, {
    runScripts: 'outside-only',
    url: 'https://ose.test/admin',
  });
  const w = dom.window as unknown as Window &
    Record<string, unknown> & { eval(s: string): unknown };
  const calls = stubFetch(w, (url, init) => {
    if (url.endsWith('/poster-codes') && (init?.method ?? 'GET') === 'PUT') {
      return opts.put
        ? opts.put(JSON.parse(String(init!.body)))
        : { body: { ok: true, limit: opts.limit ?? 4, kinds: KINDS, codes: SAVED } };
    }
    if (url.endsWith('/poster-codes')) {
      return {
        body: { ok: true, limit: opts.limit ?? 4, kinds: KINDS, codes: opts.codes ?? SAVED },
      };
    }
    return { status: 404, body: { ok: false } };
  });
  const writeText = vi.fn(async () => {});
  Object.defineProperty(w.navigator, 'clipboard', { value: { writeText }, configurable: true });
  w.eval(codesScript(ADMIN_HTML));
  await (w.loadPosterCodes as (id: string) => Promise<void>)(EVT);
  await flush();
  const doc = w.document;
  const rows = () =>
    Array.from(doc.querySelectorAll('[data-testid="poster-code-row"]')) as HTMLElement[];
  const click = async (el: Element | null) => {
    (el as HTMLElement).click();
    await flush();
  };
  return { w, doc, calls, rows, click, writeText };
}

describe('admin | Codes on the poster', () => {
  test('loads the event’s codes in order; the event page is first and cannot be moved or removed', async () => {
    const { calls, rows } = await mountAdmin();
    expect(calls[0].url).toBe(`/api/v2/admin/events/${EVT}/poster-codes`);
    expect(rows().map((r) => r.getAttribute('data-kind'))).toEqual([
      'public',
      'checkin',
      'donation',
    ]);
    const pub = rows()[0];
    expect(pub.querySelector('[data-testid="poster-code-remove"]')).toBeNull();
    expect(pub.querySelector('[data-testid="poster-code-kind"]')).toBeNull();
    expect(
      rows()[1].querySelector('[data-testid="poster-code-up"]')!.hasAttribute('disabled')
    ).toBe(true);
  });

  test('each code: one big word + icon, colour only as a second channel (green check-in, blue donate)', async () => {
    const { rows } = await mountAdmin();
    const [pub, chk, don] = rows();
    expect(chk.querySelector('[data-testid="poster-code-word"]')!.textContent).toContain(
      'CHECK IN'
    );
    expect(don.querySelector('[data-testid="poster-code-word"]')!.textContent).toContain('DONATE');
    expect(chk.querySelector('.pc-icon')!.textContent!.length).toBeGreaterThan(0);
    expect(chk.classList.contains('tone-checkin')).toBe(true);
    expect(don.classList.contains('tone-donate')).toBe(true);
    expect(pub.classList.contains('tone-neutral')).toBe(true);
  });

  test('short link + Copy come FIRST, then the QR; Copy copies the link built from the code', async () => {
    const { rows, click, writeText } = await mountAdmin();
    for (const r of rows()) {
      const link = r.querySelector('[data-testid="poster-code-link"]')!;
      const qr = r.querySelector('[data-testid="poster-code-qr"]')!;
      expect(link.compareDocumentPosition(qr) & 4, 'link precedes QR').toBe(4);
      const copy = r.querySelector('[data-testid="poster-code-copy"]')!;
      expect(copy.compareDocumentPosition(qr) & 4, 'Copy precedes QR').toBe(4);
      expect((qr as HTMLImageElement).src).toBe(QR);
    }
    expect(rows()[1].querySelector('[data-testid="poster-code-link"]')!.textContent).toBe(
      'https://ose.test/s/Chk001'
    );
    await click(rows()[2].querySelector('[data-testid="poster-code-copy"]'));
    expect(writeText).toHaveBeenCalledWith('https://ose.test/s/Don001');
  });

  test('shows the plan’s allotment; at the limit Add is disabled and the upsell reads in organizer words', async () => {
    const { doc } = await mountAdmin({ limit: 3 });
    expect(doc.getElementById('pc-plan')!.textContent).toContain('3 codes');
    expect((doc.getElementById('pc-add') as HTMLButtonElement).disabled).toBe(true);
    const upsell = doc.getElementById('pc-upsell')!;
    expect(upsell.hidden).toBe(false);
    expect(upsell.textContent).toMatch(/plan/i);
    expect(doc.querySelector('.pc-codes')!.textContent).not.toMatch(
      /\b(free|mid|enterprise|tier)\b/i
    );
  });

  test('below the limit: Add appends an unused kind; Save sends kinds + targets in order (event page implicit)', async () => {
    const { doc, rows, click, calls } = await mountAdmin({ limit: 5 });
    expect(doc.getElementById('pc-upsell')!.hidden).toBe(true);
    await click(doc.getElementById('pc-add'));
    expect(rows()).toHaveLength(4);
    const added = rows()[3];
    const sel = added.querySelector('select') as HTMLSelectElement;
    expect(sel.value).toBe('signup');
    // Kinds already on the poster are not offered twice.
    expect((sel.querySelector('option[value="checkin"]') as HTMLOptionElement).disabled).toBe(true);
    const input = added.querySelector('[data-testid="poster-code-target"]') as HTMLInputElement;
    input.value = 'https://signup.example.org/bocce';
    input.dispatchEvent(new doc.defaultView!.Event('input'));
    // Move it up above DONATE.
    await click(rows()[3].querySelector('[data-testid="poster-code-up"]'));
    await click(doc.getElementById('pc-save'));
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.url).toBe(`/api/v2/admin/events/${EVT}/poster-codes`);
    expect(put.body).toEqual({
      codes: [
        { kind: 'checkin' },
        { kind: 'signup', target_url: 'https://signup.example.org/bocce' },
        { kind: 'donation', target_url: 'https://give.example.org/x' },
      ],
    });
  });

  test('fat-finger: a non-https link is flagged inline and nothing is sent', async () => {
    for (const bad of ['javascript:alert(1)', 'http://give.example.org', 'give.example.org', '']) {
      const { rows, click, calls, doc } = await mountAdmin();
      const input = rows()[2].querySelector(
        '[data-testid="poster-code-target"]'
      ) as HTMLInputElement;
      input.value = bad;
      input.dispatchEvent(new doc.defaultView!.Event('input'));
      await click(doc.getElementById('pc-save'));
      expect(
        calls.some((c) => c.method === 'PUT'),
        bad
      ).toBe(false);
      const err = rows()[2].querySelector('[data-testid="poster-code-error"]') as HTMLElement;
      expect(err.hidden).toBe(false);
      expect(err.textContent).toContain('https://');
      expect(input.getAttribute('aria-invalid')).toBe('true');
    }
  });

  test('Remove is one click with a confirm-free Undo that puts the code back where it was', async () => {
    const { rows, click, doc } = await mountAdmin();
    await click(rows()[1].querySelector('[data-testid="poster-code-remove"]'));
    expect(rows().map((r) => r.getAttribute('data-kind'))).toEqual(['public', 'donation']);
    const undo = doc.getElementById('pc-undo') as HTMLButtonElement;
    expect(undo.hidden).toBe(false);
    await click(undo);
    expect(rows().map((r) => r.getAttribute('data-kind'))).toEqual([
      'public',
      'checkin',
      'donation',
    ]);
    expect(undo.hidden).toBe(true);
  });

  test('a server refusal shows its message on the offending row', async () => {
    const { rows, click, doc } = await mountAdmin({
      put: () => ({
        status: 400,
        body: {
          ok: false,
          code: 'INVALID_TARGET',
          error: 'The DONATE link must be a full https:// address.',
          index: 1,
        },
      }),
    });
    await click(doc.getElementById('pc-save'));
    const err = rows()[2].querySelector('[data-testid="poster-code-error"]') as HTMLElement;
    expect(err.hidden).toBe(false);
    expect(err.textContent).toContain('DONATE');
    expect(doc.getElementById('pc-msg')!.textContent).toContain('https://');
  });

  test('XSS: hostile words/targets stay text; a bad code or non-image QR never reaches the page', async () => {
    const hostile = '"><img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>';
    const { rows, doc, w } = await mountAdmin({
      codes: [
        code('public', 'Pub001', { word: hostile, points_to: hostile }),
        code('donation', 'javascript:alert(1)', {
          word: hostile,
          target_url: hostile,
          qr: 'javascript:alert(1)',
        }),
      ],
    });
    await flush();
    expect(w.__pwned).toBeUndefined();
    const list = doc.getElementById('pc-list')!;
    expect(list.querySelector('script')).toBeNull();
    expect(list.querySelector('img[onerror]')).toBeNull();
    expect(list.querySelectorAll('a')).toHaveLength(0); // no href built from a response value
    expect(rows()[0].querySelector('.pc-word-text')!.textContent).toBe(hostile);
    // The bad code gets no short link, no Copy and no QR.
    const bad = rows()[1];
    expect(bad.querySelector('[data-testid="poster-code-copy"]')).toBeNull();
    expect(bad.querySelector('[data-testid="poster-code-qr"]')).toBeNull();
    expect(bad.querySelector('[data-testid="poster-code-link"]')!.textContent).not.toContain(
      'javascript'
    );
    expect(
      (bad.querySelector('[data-testid="poster-code-target"]') as HTMLInputElement).value
    ).toBe(hostile);
  });

  test('every control has a label or accessible name (44px targets come from the shared classes)', async () => {
    const { rows, doc } = await mountAdmin();
    for (const r of rows().slice(1)) {
      for (const field of Array.from(r.querySelectorAll('select, input'))) {
        expect(doc.querySelector(`label[for="${field.id}"]`), field.id).not.toBeNull();
      }
      expect(
        r.querySelector('[data-testid="poster-code-remove"]')!.getAttribute('aria-label')
      ).toMatch(/Remove the/);
    }
  });
});

// ── /poster ─────────────────────────────────────────────────────────────────

function posterBody(html: string): string {
  const doc = new JSDOM(html).window.document;
  doc.querySelectorAll('script').forEach((s) => s.remove());
  return doc.body.innerHTML;
}
function posterScript(html: string): string {
  return scriptContaining(html, 'async function loadPosterQR');
}

async function mountPoster(kind: 'print' | 'digital', slots: unknown[]) {
  const dom = new JSDOM(`<!doctype html><body>${posterBody(POSTER_HTML)}</body>`, {
    runScripts: 'outside-only',
    url: `https://ose.test/poster?event=${EVT}&kind=${kind}`,
  });
  const w = dom.window as unknown as Window &
    Record<string, unknown> & { eval(s: string): unknown };
  stubFetch(w, (url) => {
    if (url === '/api/v2/events') {
      return {
        body: { ok: true, items: [{ id: EVT, name: 'Harbor County Bocce', venue: 'Sawyer' }] },
      };
    }
    if (url.includes('/poster-bundle')) return { body: { ok: true, slots } };
    return { body: { ok: false } };
  });
  w.eval(posterScript(POSTER_HTML));
  await flush();
  return { doc: w.document, w };
}

const BUNDLE_SLOTS = [
  {
    kind: 'public',
    word: 'EVENT',
    tone: 'neutral',
    label: 'Event page',
    code: 'Pub001',
    url: 'https://ose.test/s/Pub001',
    qr: QR,
  },
  {
    kind: 'checkin',
    word: 'CHECK IN',
    tone: 'checkin',
    label: 'Check in',
    code: 'Chk001',
    url: 'https://ose.test/s/Chk001',
    qr: QR,
  },
  {
    kind: 'donation',
    word: 'DONATE',
    tone: 'donate',
    label: 'Donate',
    code: 'Don001',
    url: 'https://ose.test/s/Don001',
    qr: QR,
  },
  {
    kind: 'ow',
    word: 'MUSIC',
    tone: 'neutral',
    label: 'Listen on ourWKRP',
    code: 'Ow0001',
    url: 'https://ose.test/s/Ow0001',
    qr: QR,
  },
];

describe('/poster | every code, in order, word + colour', () => {
  test('print: each code renders its word, tone class, QR and the printed short link, in the saved order', async () => {
    const { doc } = await mountPoster('print', BUNDLE_SLOTS);
    const cards = Array.from(doc.querySelectorAll('#poster-qr-slots .code-card'));
    expect(cards.map((c) => c.getAttribute('data-testid'))).toEqual([
      'poster-qr-slot-public',
      'poster-qr-slot-checkin',
      'poster-qr-slot-donation',
      'poster-qr-slot-ow',
    ]);
    const chk = doc.querySelector('[data-testid="poster-qr-slot-checkin"]')!;
    expect(chk.classList.contains('tone-checkin')).toBe(true);
    expect(chk.querySelector('.code-word')!.textContent).toContain('CHECK IN');
    expect(
      doc
        .querySelector('[data-testid="poster-qr-slot-donation"]')!
        .classList.contains('tone-donate')
    ).toBe(true);
    expect(
      doc.querySelector('[data-testid="poster-qr-slot-ow"]')!.classList.contains('tone-neutral')
    ).toBe(true);
    for (const s of BUNDLE_SLOTS) {
      expect(
        (doc.querySelector(`[data-testid="qr-img-slot-${s.kind}"]`) as HTMLImageElement).src
      ).toBe(QR);
      expect(doc.querySelector(`[data-testid="qr-slot-code-${s.kind}"]`)!.textContent).toBe(
        `https://ose.test/s/${s.code}`
      );
    }
  });

  test('digital: no QR images, each code is a tappable short link with its word', async () => {
    const { doc } = await mountPoster('digital', BUNDLE_SLOTS);
    expect(doc.querySelectorAll('#poster-qr-slots img')).toHaveLength(0);
    for (const s of BUNDLE_SLOTS) {
      const a = doc.querySelector(`a[data-testid="qr-slot-code-${s.kind}"]`) as HTMLAnchorElement;
      expect(a.getAttribute('href')).toBe(`https://ose.test/s/${s.code}`);
      expect(
        doc.querySelector(`[data-testid="poster-qr-slot-label-${s.kind}"]`)!.textContent
      ).toContain(s.word);
    }
  });

  test('hrefs are rebuilt from a validated code on this origin — never taken from the response', async () => {
    const { doc, w } = await mountPoster('print', [
      {
        kind: 'donation',
        word: '<img src=x onerror="window.__pwned=1">',
        code: 'Don001',
        url: 'javascript:alert(1)',
        qr: 'javascript:alert(1)',
      },
      { kind: 'ow', word: 'MUSIC', code: '../../evil', url: 'https://evil.example/', qr: QR },
    ]);
    expect(w.__pwned).toBeUndefined();
    const hrefs = Array.from(doc.querySelectorAll('#poster-qr-slots a')).map((a) =>
      a.getAttribute('href')
    );
    expect(hrefs).toEqual(['https://ose.test/s/Don001']);
    expect(doc.querySelector('[data-testid="poster-qr-slot-ow"]')).toBeNull();
    expect(doc.querySelector('#poster-qr-slots img[onerror]')).toBeNull();
    expect(
      (doc.querySelector('[data-testid="qr-img-slot-donation"]') as HTMLImageElement).getAttribute(
        'src'
      )
    ).toBe('');
    expect(
      doc.querySelector('[data-testid="poster-qr-slot-label-donation"]')!.textContent
    ).toContain('<img');
  });

  test('no raw hex and no size keyed to a kind: the tone classes only colour a same-width band', () => {
    const style = POSTER_HTML.slice(
      POSTER_HTML.indexOf('.code-card {'),
      POSTER_HTML.indexOf('.qr-section {')
    );
    expect(style).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(style).toContain('var(--success)');
    expect(style).toContain('var(--info)');
    for (const tone of ['.tone-checkin', '.tone-donate']) {
      const rule = style.slice(style.indexOf(tone), style.indexOf('}', style.indexOf(tone)));
      expect(rule).not.toMatch(/width|height|font-size|padding|margin/);
    }
    const admin = ADMIN_HTML.slice(
      ADMIN_HTML.indexOf('.pc-list {'),
      ADMIN_HTML.indexOf('.pc-qr {')
    );
    expect(admin).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(admin).toContain('var(--success)');
    expect(admin).toContain('var(--info)');
  });
});
