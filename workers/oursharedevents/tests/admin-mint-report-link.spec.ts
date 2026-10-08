/**
 * The admin "Shared Report Links" panel: Generate Link shows the link.
 *
 * What an organizer saw: a red box reading "esc is not defined". The request
 * to POST /api/v2/admin/events/:id/shared-report/mint-link had succeeded; the
 * code that draws the answer called an escape helper that was not in scope
 * where it ran, so no token, no copy control and no link ever appeared.
 *
 * The earlier tests over this panel read the template as text (they looked for
 * the string `esc(reportUrl)`), so they passed while the page threw. This spec
 * runs the page's own scripts in jsdom, as the classic scripts they are, with a
 * stubbed fetch that answers the way the route does, and looks at what is drawn.
 *
 * Seen red on main at ba247322 before the template changed. Red with
 * `expected 'esc is not defined' to be ''`: "shows the token, a copy control
 * and the report link", "the copy control copies the whole link", "opens the
 * report page", "is shown as text", "a second link replaces the first". Red
 * with `ReferenceError: escAttr is not defined`: "escapes quote marks". "Says
 * the link is shown only once" was red the same way, and after the repair red
 * on its own account until the line was added. Green from the start (guards on
 * behaviour that already worked): the request shape, the four refusals, and
 * "no event selected".
 */
import vm from 'node:vm';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import ADMIN_HTML from '../src/templates/admin.html';

const ORIGIN = 'https://admin.test';
const EVT = 'evt_mint_panel';
// Shaped like a signed link (claim, a dot, signature, base64url characters) and
// plainly not one, so no secret scanner takes it for a credential.
const TOKEN = 'test-claim_part.test-signature_part-0';
const EXPIRES = '2026-10-15T12:00:00.000Z';

const reportUrl = (eventId: string, token: string) =>
  `${ORIGIN}/sharedReport?eventId=${encodeURIComponent(eventId)}&token=${encodeURIComponent(token)}`;

// The page scripts this flow runs through, each found by a line only it has.
// They are run in the order the page has them.
const PAGE_SCRIPTS = [
  'var ACTIONS = {', // the click / change dispatcher (data-action, data-change)
  'window._adminAnnounce = function', // the status line
  'window.mintReportLink = async function', // the forms card and the mint panel
  'window.friendlyTier = function', // plan and phase names
];

type Reply = { status?: number; body?: unknown; throws?: string };
type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

// Each test parses the whole 330 KB page; on a busy machine that alone can take
// seconds, so the default five-second limit is not used here.
vi.setConfig({ testTimeout: 30_000 });

const open: JSDOM[] = [];
afterEach(() => {
  while (open.length) open.pop()!.window.close();
});

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

async function mount(eventId: string = EVT, ...mintReplies: Reply[]) {
  const dom = new JSDOM(ADMIN_HTML, { runScripts: 'outside-only', url: `${ORIGIN}/admin` });
  open.push(dom);
  const w = dom.window as unknown as Window & Record<string, unknown>;
  const doc = w.document;

  const calls: Call[] = [];
  const replies = mintReplies.length
    ? [...mintReplies]
    : [{ body: { ok: true, token: TOKEN, expires_at: EXPIRES } }];
  const answer = (status: number, body: unknown) => ({
    ok: status < 400,
    status,
    json: async () => body,
  });
  w.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({
      url: String(url),
      method,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (String(url).endsWith('/shared-report/mint-link')) {
      const r = replies.length > 1 ? replies.shift()! : replies[0];
      if (r.throws) throw new Error(r.throws);
      return answer(r.status ?? 200, r.body);
    }
    if (String(url).includes('/flags/resolve')) return answer(200, { ok: true, flags: {} });
    return answer(200, { ok: true, suppressed: true }); // the four form counts
  }) as unknown as typeof fetch;

  const copied: string[] = [];
  Object.defineProperty(w.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (text: string) => {
        copied.push(text);
      },
    },
  });

  // Run as classic scripts in the page's own global scope, so a name one script
  // declares at its top level is visible to the others exactly as in a browser.
  const context = dom.getInternalVMContext();
  const scripts = Array.from(doc.querySelectorAll('script'))
    .map((s) => s.textContent || '')
    .filter((text) => PAGE_SCRIPTS.some((marker) => text.includes(marker)));
  expect(scripts.length, 'every page script this flow needs was found').toBe(PAGE_SCRIPTS.length);
  for (const text of scripts) new vm.Script(text).runInContext(context);

  // An organizer selects an event; the forms card draws the mint panel.
  await (w.loadForms as (id: string, name: string, phase: number) => Promise<void>)(
    eventId,
    'Bocce Night',
    1
  );

  const $ = <T extends HTMLElement>(id: string) => doc.querySelector<T>(`[data-testid="${id}"]`);
  const generate = async (role: 'admin' | 'bar_owner' = 'admin') => {
    const roleSelect = $<HTMLSelectElement>('mint-role')!;
    roleSelect.value = role;
    roleSelect.dispatchEvent(new w.Event('change', { bubbles: true }));
    $<HTMLButtonElement>('mint-link-btn')!.click();
    await flush();
  };
  // What the result box says when it holds no link: an error, or nothing yet.
  const errorShown = () => ($('mint-token') ? '' : ($('mint-result')!.textContent ?? ''));
  const inPage = (code: string) => new vm.Script(code).runInContext(context) as unknown;
  const posts = () => calls.filter((c) => c.method === 'POST');
  return { w, doc, $, generate, errorShown, inPage, calls, posts, copied };
}

describe('admin Shared Report Links: Generate Link', () => {
  test('shows the token, a copy control and the report link, and no error', async () => {
    const { $, generate, errorShown } = await mount();
    await generate();

    expect(errorShown(), 'the result box shows an error instead of a link').toBe('');
    expect($('mint-token')!.textContent).toBe(TOKEN);
    expect($('mint-copy-btn'), 'the copy control').not.toBeNull();
    expect($('mint-copy-btn')!.getAttribute('data-url')).toBe(reportUrl(EVT, TOKEN));
    expect($('mint-report-url'), 'the report link').not.toBeNull();
    expect($('mint-report-url')!.getAttribute('href')).toBe(reportUrl(EVT, TOKEN));
    expect($('mint-report-url')!.textContent).toBe(reportUrl(EVT, TOKEN));
    expect($('mint-result')!.textContent).toContain(
      `expires ${new Date(EXPIRES).toLocaleDateString()}`
    );
    expect($('mint-result')!.textContent).not.toMatch(/is not defined|undefined|\[object/);

    const button = $<HTMLButtonElement>('mint-link-btn')!;
    expect(button.disabled, 'the button is usable again').toBe(false);
    expect(button.textContent).toBe('Generate Link');
  });

  test('sends what the route accepts: one JSON POST with the role and the days', async () => {
    const { generate, posts } = await mount();
    await generate('bar_owner');

    expect(posts()).toHaveLength(1);
    expect(posts()[0].url).toBe(`/api/v2/admin/events/${EVT}/shared-report/mint-link`);
    // An admin write must carry a JSON body (lib/admin-write-guard).
    expect(posts()[0].headers['Content-Type']).toBe('application/json');
    expect(posts()[0].body).toEqual({ role: 'bar_owner', ttl_days: 7 });
  });

  test('the copy control copies the whole link and says so', async () => {
    const { $, generate, errorShown, copied } = await mount();
    await generate();

    expect(errorShown()).toBe('');
    const copy = $<HTMLButtonElement>('mint-copy-btn')!;
    expect(copy.getAttribute('aria-label')).toBe('Copy report link');
    copy.click();
    await flush();
    expect(copied).toEqual([reportUrl(EVT, TOKEN)]);
    expect(copy.textContent).toBe('Copied!');
  });

  test('the link opens the report page for this event with this token, in a new tab', async () => {
    const { $, generate, errorShown } = await mount();
    await generate();

    expect(errorShown()).toBe('');
    const link = $<HTMLAnchorElement>('mint-report-url')!;
    const url = new URL(link.getAttribute('href')!);
    expect(url.origin + url.pathname).toBe(`${ORIGIN}/sharedReport`);
    expect(url.searchParams.get('eventId')).toBe(EVT);
    expect(url.searchParams.get('token')).toBe(TOKEN);
    expect(link.target).toBe('_blank');
    expect(link.rel.split(' ')).toContain('noopener');
  });

  test('says the link is shown only once', async () => {
    const { $, generate, errorShown } = await mount();
    await generate();

    expect(errorShown()).toBe('');
    expect($('mint-result')!.textContent).toContain(
      "Copy this now; it isn't stored and can't be shown again."
    );
  });

  test('a second link replaces the first', async () => {
    const second = 'second-claim.second-signature';
    const { doc, $, generate, errorShown } = await mount(
      EVT,
      { body: { ok: true, token: TOKEN, expires_at: EXPIRES } },
      { body: { ok: true, token: second, expires_at: EXPIRES } }
    );
    await generate();
    await generate();

    expect(errorShown()).toBe('');
    expect(doc.querySelectorAll('[data-testid="mint-token"]')).toHaveLength(1);
    expect($('mint-token')!.textContent).toBe(second);
    expect($('mint-report-url')!.getAttribute('href')).toBe(reportUrl(EVT, second));
  });
});

describe('admin Shared Report Links: what is drawn is text', () => {
  // The route only ever returns base64url, and event ids are shape-checked, so
  // neither value below can occur. The panel still may not trust them.
  const HOSTILE_TOKEN = `a.b"><img src=x onerror=alert(1)>'&amp;`;
  const HOSTILE_EVENT = `evt"><img src=x onerror=alert(2)>'&`;

  test('a token or event id carrying markup is shown as text, never as markup', async () => {
    const { $, generate, errorShown } = await mount(HOSTILE_EVENT, {
      body: { ok: true, token: HOSTILE_TOKEN, expires_at: EXPIRES },
    });
    await generate();

    expect(errorShown()).toBe('');
    const result = $('mint-result')!;
    expect(result.querySelector('img'), 'no element was made from a value').toBeNull();
    const drawn = new Set([...result.querySelectorAll('*')].map((el) => el.tagName));
    for (const tag of drawn) expect(['DIV', 'P', 'CODE', 'BUTTON', 'A'], tag).toContain(tag);
    expect(result.querySelectorAll('[onerror]')).toHaveLength(0);
    expect($('mint-token')!.textContent).toBe(HOSTILE_TOKEN);
    expect($('mint-token')!.children).toHaveLength(0);
    expect(result.textContent).toContain(`/api/v2/events/${HOSTILE_EVENT}/shared-report`);

    // Both values survive the trip through the URL and the attribute unchanged.
    for (const attr of [
      $('mint-report-url')!.getAttribute('href')!,
      $('mint-copy-btn')!.getAttribute('data-url')!,
    ]) {
      const url = new URL(attr);
      expect(url.searchParams.get('eventId')).toBe(HOSTILE_EVENT);
      expect(url.searchParams.get('token')).toBe(HOSTILE_TOKEN);
    }
  });

  // The link is built from the page's own origin and two URL-encoded values, so
  // no input can put a quote mark into it and the test above cannot see whether
  // it is escaped. This one reads which helper each use goes through, from the
  // page's own source, and then calls that helper in the page.
  test('whatever writes the link into href, data-url and the page escapes quote marks', async () => {
    const { doc, inPage } = await mount();
    const source = Array.from(doc.querySelectorAll('script'))
      .map((s) => s.textContent || '')
      .find((text) => text.includes('window.mintReportLink = async function'))!;
    const block = source.slice(source.indexOf('window.mintReportLink = async function'));

    const href = block.match(/href="' \+ ([A-Za-z_$][\w$]*)\(reportUrl\) \+ '"/);
    const dataUrl = block.match(/data-url="' \+ ([A-Za-z_$][\w$]*)\(reportUrl\) \+ '"/);
    const linkText = block.match(/>' \+ ([A-Za-z_$][\w$]*)\(reportUrl\) \+ '<\/a>/);
    expect(href, 'href is written through an escape helper').not.toBeNull();
    expect(dataUrl, 'data-url is written through an escape helper').not.toBeNull();
    expect(linkText, 'the link text is written through an escape helper').not.toBeNull();

    for (const name of new Set([href![1], dataUrl![1], linkText![1]])) {
      // Called where the forms script's top level sees it, as the page would.
      const escaped = inPage(`${name}(${JSON.stringify(`"'<>&`)})`);
      expect(escaped, `${name} escapes every character that can end an attribute or a tag`).toBe(
        '&quot;&#39;&lt;&gt;&amp;'
      );
    }
  });
});

describe('admin Shared Report Links: when no link can be made', () => {
  test.each([
    [
      'the server refuses the request',
      { status: 400, body: { ok: false, code: 'BAD_REQUEST', error: 'ttl_days must be 1-365' } },
      'ttl_days must be 1-365',
    ],
    [
      'the signing secret is not configured',
      {
        status: 503,
        body: {
          ok: false,
          code: 'CONFIGURATION_ERROR',
          error: 'SHARED_REPORT_SIGNING_SECRET is not configured',
        },
      },
      'SHARED_REPORT_SIGNING_SECRET is not configured',
    ],
    ['the request never arrives', { throws: 'Failed to fetch' }, 'Failed to fetch'],
    ['the answer carries no reason', { status: 500, body: { ok: false } }, 'Mint failed'],
  ])(
    '%s: the reason is shown, no link, and the button works again',
    async (_name, reply, shown) => {
      const { $, generate } = await mount(EVT, reply as Reply);
      await generate();

      expect($('mint-result')!.textContent).toBe(shown);
      expect($('mint-token')).toBeNull();
      expect($('mint-copy-btn')).toBeNull();
      expect($('mint-report-url')).toBeNull();
      const button = $<HTMLButtonElement>('mint-link-btn')!;
      expect(button.disabled).toBe(false);
      expect(button.textContent).toBe('Generate Link');
    }
  );

  test('no event selected: asks for one and sends nothing', async () => {
    const { doc, $, posts } = await mount();
    const button = $<HTMLButtonElement>('mint-link-btn')!;
    button.setAttribute('data-event-id', '');
    button.click();
    await flush();

    expect(posts()).toHaveLength(0);
    expect(doc.getElementById('admin-status')!.textContent).toBe('Select an event first.');
  });
});
