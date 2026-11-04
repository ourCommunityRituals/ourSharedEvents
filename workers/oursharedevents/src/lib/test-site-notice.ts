/**
 * test-site-notice.ts: the "Testing purposes only." band on staging pages.
 *
 * Both staging sites carry real-world data, so every staging HTML page says it
 * is for testing. The guard is exactly `WORKER_ENV === 'staging'`: development,
 * test and production never render it. `STAGING_VARIANT === 'full'` adds the
 * line saying the listings come from public sources and are not an endorsement.
 *
 * Colours come from the spine tokens only (no raw hex), which pages get from
 * `/ui.css` (@ocr/ui). The band sits on `--status-warn` and its text is
 * `--ground`: charcoal on amber in the dark theme (9.5:1) and creme on brown in
 * the light theme (5.1:1), both AA. The fallbacks are CSS keywords (not hex) for a
 * page that does not link `/ui.css`: it still shows a legible, bordered band.
 *
 * Stacking: the band is `position:sticky;top:0` with a z-index above every fixed
 * layer the templates use (the highest is 9999, the focused skip link). Sticky
 * keeps it in flow, so it pushes content down instead of covering it, and it
 * stays visible on the TV display (a flex column body with `min-height:100vh`).
 */

export const TEST_SITE_NOTICE_TESTID = 'test-site-notice';

const HEADLINE = 'Testing purposes only.';
const FULL_VARIANT_LINE =
  'Events, venues and businesses here are drawn from public listings for testing; nothing here is an endorsement or an offer.';

const STYLE =
  `.ose-test-notice{position:sticky;top:0;z-index:2147483000;box-sizing:border-box;min-height:44px;width:100%;padding:.5rem 1rem;` +
  `display:flex;flex-wrap:wrap;gap:.25rem .75rem;align-items:center;justify-content:center;` +
  `background:var(--status-warn,Canvas);color:var(--ground,CanvasText);` +
  `border-bottom:2px solid var(--status-warn,CanvasText);text-align:center;` +
  `font:600 1rem/1.3 system-ui,-apple-system,sans-serif;overflow-wrap:anywhere}` +
  `.ose-test-notice p{margin:0}`;

export function testSiteNoticeMarkup(variant?: string): string {
  const detail = variant === 'full' ? `<p>${FULL_VARIANT_LINE}</p>` : '';
  return (
    `<style>${STYLE}</style>` +
    `<div class="ose-test-notice" role="note" data-testid="${TEST_SITE_NOTICE_TESTID}">` +
    `<p><strong>${HEADLINE}</strong></p>${detail}</div>`
  );
}

/**
 * Prepend the notice to every staging HTML page. Any other environment, and any
 * non-HTML response, comes back untouched (same object). A page with no
 * `<body>` is passed through by HTMLRewriter unchanged.
 */
export function injectTestSiteNotice(
  res: Response,
  env: { WORKER_ENV?: string; STAGING_VARIANT?: string }
): Response {
  if (env.WORKER_ENV !== 'staging') return res;
  const type = res.headers.get('content-type') || '';
  if (!type.toLowerCase().startsWith('text/html')) return res;
  const html = testSiteNoticeMarkup(env.STAGING_VARIANT);
  return new HTMLRewriter()
    .on('body', {
      element(el) {
        el.prepend(html, { html: true });
      },
    })
    .transform(res);
}
