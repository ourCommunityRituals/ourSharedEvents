import { env, SELF } from 'cloudflare:test';
import { describe, test, expect } from 'vitest';
import { injectTestSiteNotice, TEST_SITE_NOTICE_TESTID } from '../src/lib/test-site-notice';
import DISPLAY_HTML from '../src/templates/display.html';
import PUBLIC_HTML from '../src/templates/public.html';

const PAGE =
  '<!doctype html><html><head><title>t</title></head><body><h1>Hello</h1><p>x</p></body></html>';
const html = (body: string = PAGE, init: ResponseInit = {}) =>
  new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'x-keep': 'yes' },
    ...init,
  });
const count = (s: string, needle: string) => s.split(needle).length - 1;

describe('injectTestSiteNotice', () => {
  test('staging + text/html gets the band, role=note, and the headline, with the h1 count unchanged', async () => {
    const out = await injectTestSiteNotice(html(), { WORKER_ENV: 'staging' }).text();
    expect(out).toContain(`data-testid="${TEST_SITE_NOTICE_TESTID}"`);
    expect(out).toContain('role="note"');
    expect(out).toContain('Testing purposes only.');
    expect(count(out, '<h1')).toBe(count(PAGE, '<h1'));
    expect(out).not.toContain('endorsement');
  });

  test('STAGING_VARIANT=full adds the public-listings line', async () => {
    const out = await injectTestSiteNotice(html(), {
      WORKER_ENV: 'staging',
      STAGING_VARIANT: 'full',
    }).text();
    expect(out).toContain('nothing here is an endorsement or an offer');
  });

  test('STAGING_VARIANT=empty does not', async () => {
    const out = await injectTestSiteNotice(html(), {
      WORKER_ENV: 'staging',
      STAGING_VARIANT: 'empty',
    }).text();
    expect(out).toContain('Testing purposes only.');
    expect(out).not.toContain('endorsement');
  });

  // The band speaks the page's own language (<html lang>), so a Spanish page
  // has no English band at its top.
  const pageIn = (lang: string) => PAGE.replace('<html>', `<html lang="${lang}">`);

  test('a Spanish page gets the band in Spanish, the listings line too', async () => {
    const out = await injectTestSiteNotice(html(pageIn('es')), {
      WORKER_ENV: 'staging',
      STAGING_VARIANT: 'full',
    }).text();
    expect(out).toContain('<strong>Solo para pruebas.</strong>');
    expect(out).toContain('nada de esto es una recomendación ni una oferta');
    expect(out).not.toContain('Testing purposes only.');
    expect(out).not.toContain('endorsement');
  });

  test.each([['en'], ['fr'], ['ES-us'], ['']])(
    'a page with lang="%s" gets the band in English',
    async (lang) => {
      const out = await injectTestSiteNotice(html(pageIn(lang)), { WORKER_ENV: 'staging' }).text();
      expect(out).toContain('<strong>Testing purposes only.</strong>');
      expect(out).not.toContain('Solo para pruebas.');
    }
  );

  test.each(['production', 'development', 'test', undefined])(
    'WORKER_ENV=%s leaves the body byte-identical',
    async (w) => {
      const out = await injectTestSiteNotice(html(), {
        WORKER_ENV: w,
        STAGING_VARIANT: 'full',
      }).text();
      expect(out).toBe(PAGE);
    }
  );

  test('application/json on staging is unchanged', async () => {
    const res = new Response('{"a":"<body>"}', { headers: { 'content-type': 'application/json' } });
    const out = await injectTestSiteNotice(res, { WORKER_ENV: 'staging' }).text();
    expect(out).toBe('{"a":"<body>"}');
  });

  test('HTML with no <body> is unchanged and status and headers are preserved', async () => {
    const res = html('<p>fragment</p>', { status: 404 });
    const out = injectTestSiteNotice(res, { WORKER_ENV: 'staging' });
    expect(await out.text()).toBe('<p>fragment</p>');
    expect(out.status).toBe(404);
    expect(out.headers.get('x-keep')).toBe('yes');
    expect(out.headers.get('content-type')).toContain('text/html');
  });

  test('status and headers survive on a page that gets the band', async () => {
    const out = injectTestSiteNotice(html(PAGE, { status: 201 }), { WORKER_ENV: 'staging' });
    expect(out.status).toBe(201);
    expect(out.headers.get('x-keep')).toBe('yes');
    await out.text();
  });

  const noticeZ = async () => {
    const out = await injectTestSiteNotice(html(), { WORKER_ENV: 'staging' }).text();
    const style = out.match(/\.ose-test-notice\{[^}]*\}/)![0];
    return Number(style.match(/z-index:(\d+)/)![1]);
  };

  // Not sticky: a sticky band at top:0 covers the sticky toolbars that also sit at
  // top:0 (admin preview toolbar, theme bar, briefing header). Its z-index sits
  // below the focused skip links (9999 at top:0), which must stay visible over it.
  test('the band is in flow, never sticky or fixed, with a z-index above 0 and below 9999', async () => {
    const out = await injectTestSiteNotice(html(), { WORKER_ENV: 'staging' }).text();
    const style = out.match(/\.ose-test-notice\{[^}]*\}/)![0];
    expect(style).toContain('position:relative');
    expect(style).not.toMatch(/position:(sticky|fixed|absolute)/);
    expect(style).not.toMatch(/[{;]top:/);
    const z = Number(style.match(/z-index:(\d+)/)![1]);
    expect(z).toBeGreaterThan(0);
    expect(z).toBeLessThan(9999);
  });

  test.each([
    ['display.html', DISPLAY_HTML],
    ['public.html', PUBLIC_HTML],
  ])('the focused skip link in %s sits above the band', async (_name, page) => {
    const rule = (page as string).match(/\.skip-link:focus\s*\{[^}]*\}/);
    expect(rule, 'a .skip-link:focus rule').not.toBeNull();
    const z = Number(rule![0].match(/z-index:\s*(\d+)/)![1]);
    expect(z).toBeGreaterThan(await noticeZ());
  });

  test('the band carries data-wizard-keep, so the admin setup wizard does not hide it', async () => {
    const out = await injectTestSiteNotice(html(), { WORKER_ENV: 'staging' }).text();
    const band = out.match(/<div class="ose-test-notice"[^>]*>/)![0];
    expect(band).toMatch(/\sdata-wizard-keep[\s>=]/);
  });

  test('HTML with Content-Encoding: gzip passes through unchanged (same object, same bytes)', async () => {
    const bytes = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x3c, 0x62, 0x6f, 0x64, 0x79, 0x3e]);
    const res = new Response(bytes, {
      headers: { 'content-type': 'text/html; charset=utf-8', 'content-encoding': 'gzip' },
      encodeBody: 'manual',
    } as ResponseInit);
    const out = injectTestSiteNotice(res, { WORKER_ENV: 'staging' });
    expect(out).toBe(res);
    expect(new Uint8Array(await out.arrayBuffer())).toEqual(bytes);
  });

  test('Content-Encoding: identity is plain text, so it still gets the band', async () => {
    const res = html(PAGE, {
      headers: { 'content-type': 'text/html', 'content-encoding': 'identity' },
    });
    const out = await injectTestSiteNotice(res, { WORKER_ENV: 'staging' }).text();
    expect(out).toContain(`data-testid="${TEST_SITE_NOTICE_TESTID}"`);
  });

  test('a ReadableStream body gets the band, with <body> split across chunks', async () => {
    const enc = new TextEncoder();
    const chunks = ['<!doctype html><html><head></head><bo', 'dy><h1>Hi</h1>', '</body></html>'];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(enc.encode(c));
        controller.close();
      },
    });
    const res = new Response(stream, { headers: { 'content-type': 'text/html' } });
    const out = await injectTestSiteNotice(res, { WORKER_ENV: 'staging' }).text();
    expect(count(out, `data-testid="${TEST_SITE_NOTICE_TESTID}"`)).toBe(1);
    expect(out.indexOf(TEST_SITE_NOTICE_TESTID)).toBeLessThan(out.indexOf('<h1>Hi</h1>'));
    expect(out.indexOf('<body>')).toBeLessThan(out.indexOf(TEST_SITE_NOTICE_TESTID));
  });

  test('the band carries no raw hex colour', async () => {
    const out = await injectTestSiteNotice(html(), { WORKER_ENV: 'staging' }).text();
    expect(out).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe('index.ts wiring', () => {
  test('a real page served under WORKER_ENV=test carries no notice', async () => {
    const res = await SELF.fetch('https://example.com/health');
    await res.text();
    const page = await SELF.fetch('https://example.com/?brand=root');
    expect(page.headers.get('content-type') || '').toContain('text/html');
    expect(await page.text()).not.toContain(TEST_SITE_NOTICE_TESTID);
  });

  test('the fetch seam calls injectTestSiteNotice(', () => {
    const sources: Record<string, string> = JSON.parse(
      (env as unknown as { TEST_SOURCE_FILES_JSON: string }).TEST_SOURCE_FILES_JSON
    );
    const entry = Object.entries(sources).find(([p]) =>
      p.replaceAll('\\', '/').endsWith('src/index.ts')
    );
    expect(entry, 'src/index.ts not found in TEST_SOURCE_FILES_JSON').toBeDefined();
    expect(entry![1]).toContain('injectTestSiteNotice(');
  });
});
