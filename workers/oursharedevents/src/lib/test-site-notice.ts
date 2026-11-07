/**
 * test-site-notice.ts: the "Testing purposes only." band on staging pages.
 *
 * The staging site carries real-world data (owner 2026-11-06: one staging site,
 * loaded from the fixed seed of real events and businesses), so every staging
 * HTML page says it is for testing and that its listings come from public
 * sources and are not an endorsement. The guard is exactly
 * `WORKER_ENV === 'staging'`: development, test and production never render it.
 *
 * `data-wizard-keep` keeps it shown while the admin setup wizard hides the other
 * direct children of <body> (admin.html, body.wizard-active).
 *
 * Colours come from the spine tokens only (no raw hex), which pages get from
 * `/ui.css` (@ocr/ui). The band sits on `--status-warn` and its text is
 * `--ground`: charcoal on amber in the dark theme (9.5:1) and creme on brown in
 * the light theme (5.1:1), both AA. The fallbacks are CSS keywords (not hex) for a
 * page that does not link `/ui.css`: it still shows a legible, bordered band.
 *
 * Stacking: the band is `position:relative` with z-index 9000: above the fixed
 * layers the templates use, and below the focused skip links (9999 at top:0 in
 * display.html and public.html), so a keyboard user still sees the skip link
 * over the band. It sits
 * in flow at the top of <body>, so it pushes content down and scrolls away with
 * the page. It is not sticky: a sticky band at top:0 would cover the sticky
 * toolbars that also sit at top:0 (the admin preview toolbar, the theme bar, the
 * briefing header). The z-index keeps a fixed layer from covering it while it is
 * in view, the TV display included (a flex column body with `min-height:100vh`).
 *
 * Language: the band speaks the page's language, read from the page's own
 * `<html lang>` (a Spanish event page says "Solo para pruebas."). A page with
 * no `lang`, or one the catalog does not have, gets English.
 */

import { msg } from './i18n/catalog';
import { DEFAULT_LANG, isLang, type Lang } from './i18n/languages';

export const TEST_SITE_NOTICE_TESTID = 'test-site-notice';

const STYLE =
  `.ose-test-notice{position:relative;z-index:9000;box-sizing:border-box;min-height:44px;width:100%;padding:.5rem 1rem;` +
  `display:flex;flex-wrap:wrap;gap:.25rem .75rem;align-items:center;justify-content:center;` +
  `background:var(--status-warn,Canvas);color:var(--ground,CanvasText);` +
  `border-bottom:2px solid var(--status-warn,CanvasText);text-align:center;` +
  `font:600 1rem/1.3 system-ui,-apple-system,sans-serif;overflow-wrap:anywhere}` +
  `.ose-test-notice p{margin:0}`;

export function testSiteNoticeMarkup(lang: Lang = DEFAULT_LANG): string {
  const detail = `<p>${msg(lang, 'testSite.listings')}</p>`;
  return (
    `<style>${STYLE}</style>` +
    `<div class="ose-test-notice" role="note" data-testid="${TEST_SITE_NOTICE_TESTID}" data-wizard-keep>` +
    `<p><strong>${msg(lang, 'testSite.headline')}</strong></p>${detail}</div>`
  );
}

/**
 * Prepend the notice to every staging HTML page. Any other environment, and any
 * non-HTML response, comes back untouched (same object). A page with no
 * `<body>` is passed through by HTMLRewriter unchanged.
 *
 * A response that names a Content-Encoding (anything but `identity`) also comes
 * back untouched: its body may already be encoded bytes (`encodeBody: 'manual'`),
 * and HTMLRewriter would parse those as text and could corrupt them. No handler
 * sets the header today; the Worker's own pages leave encoding to the runtime.
 * Streamed bodies are fine: HTMLRewriter finds `<body>` across chunk boundaries.
 * `<html>` opens before `<body>`, so its `lang` is known when the band goes in.
 */
export function injectTestSiteNotice(res: Response, env: { WORKER_ENV?: string }): Response {
  if (env.WORKER_ENV !== 'staging') return res;
  const type = res.headers.get('content-type') || '';
  if (!type.toLowerCase().startsWith('text/html')) return res;
  const encoding = (res.headers.get('content-encoding') || '').trim().toLowerCase();
  if (encoding !== '' && encoding !== 'identity') return res;
  let lang: Lang = DEFAULT_LANG;
  return new HTMLRewriter()
    .on('html', {
      element(el) {
        const tag = (el.getAttribute('lang') || '').trim().toLowerCase();
        if (isLang(tag)) lang = tag;
      },
    })
    .on('body', {
      element(el) {
        el.prepend(testSiteNoticeMarkup(lang), { html: true });
      },
    })
    .transform(res);
}
