/**
 * test-site-notice.ts: the "Testing purposes only." band on staging pages.
 *
 * Both staging sites carry real-world data, so every staging HTML page says it
 * is for testing. The guard is exactly `WORKER_ENV === 'staging'`: development,
 * test and production never render it. `STAGING_VARIANT === 'full'` adds the
 * line saying the listings come from public sources and are not an endorsement.
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
 */

export const TEST_SITE_NOTICE_TESTID = 'test-site-notice';

const HEADLINE = 'Testing purposes only.';
const FULL_VARIANT_LINE =
  'Events, venues and businesses here are drawn from public listings for testing; nothing here is an endorsement or an offer.';

const STYLE =
  `.ose-test-notice{position:relative;z-index:9000;box-sizing:border-box;min-height:44px;width:100%;padding:.5rem 1rem;` +
  `display:flex;flex-wrap:wrap;gap:.25rem .75rem;align-items:center;justify-content:center;` +
  `background:var(--status-warn,Canvas);color:var(--ground,CanvasText);` +
  `border-bottom:2px solid var(--status-warn,CanvasText);text-align:center;` +
  `font:600 1rem/1.3 system-ui,-apple-system,sans-serif;overflow-wrap:anywhere}` +
  `.ose-test-notice p{margin:0}`;

export function testSiteNoticeMarkup(variant?: string): string {
  const detail = variant === 'full' ? `<p>${FULL_VARIANT_LINE}</p>` : '';
  return (
    `<style>${STYLE}</style>` +
    `<div class="ose-test-notice" role="note" data-testid="${TEST_SITE_NOTICE_TESTID}" data-wizard-keep>` +
    `<p><strong>${HEADLINE}</strong></p>${detail}</div>`
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
 */
export function injectTestSiteNotice(
  res: Response,
  env: { WORKER_ENV?: string; STAGING_VARIANT?: string }
): Response {
  if (env.WORKER_ENV !== 'staging') return res;
  const type = res.headers.get('content-type') || '';
  if (!type.toLowerCase().startsWith('text/html')) return res;
  const encoding = (res.headers.get('content-encoding') || '').trim().toLowerCase();
  if (encoding !== '' && encoding !== 'identity') return res;
  const html = testSiteNoticeMarkup(env.STAGING_VARIANT);
  return new HTMLRewriter()
    .on('body', {
      element(el) {
        el.prepend(html, { html: true });
      },
    })
    .transform(res);
}
