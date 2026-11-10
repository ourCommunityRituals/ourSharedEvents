/**
 * The event's Share button (owner, 2026-11-09: "the same share from the events
 * page"). One builder for the button the event page shows and the one on each
 * card in the map's place panel, so both carry the same label, the same link and
 * the same title.
 *
 * Behaviour, the same on both: the phone's share sheet (Web Share API), else copy
 * the link and say so. Pressing it writes nothing anywhere. A friend who opens
 * the shared `/e/<code>` link is a share open, counted as before (what and when,
 * never who; lib/share-count.ts).
 *
 * The URL and title travel in data attributes, escaped here, never in script.
 * The event page keeps its own one-button script (its golden renders are
 * byte-for-byte); a page with many buttons uses `shareScript`, one listener for
 * all of them. Either way the page's `html()` puts the CSP nonce on the tag.
 */
import { escapeHtml } from './html-escape.js';
import { DEFAULT_LANG, type Lang } from './i18n/languages.js';
import { msg } from './i18n/catalog.js';
import { withLangPrefix } from './i18n/path-prefix.js';

/** The link a share carries: the event's short share code, else its page. */
export function eventShareUrl(
  origin: string,
  lang: Lang,
  ev: { shareCode?: string | null; pagePath: string }
): string {
  const path = ev.shareCode
    ? withLangPrefix(lang, `/e/${encodeURIComponent(ev.shareCode)}`)
    : withLangPrefix(lang, ev.pagePath);
  return `${origin}${path}`;
}

/** The button. `inert` (an admin draft preview) shows it switched off, with no link. */
export function renderShareButton(
  url: string,
  title: string,
  lang: Lang = DEFAULT_LANG,
  opts: { inert?: boolean; className?: string } = {}
): string {
  const attrs = opts.inert
    ? 'disabled aria-disabled="true" data-preview-inert="true"'
    : `data-share-url="${escapeHtml(url)}" data-share-title="${escapeHtml(title)}"`;
  const cls = opts.className ? `ose-share-btn ${opts.className}` : 'ose-share-btn';
  return `<button class="${cls}" data-testid="share-btn" type="button" ${attrs}>${msg(lang, 'share.label')}</button>`;
}

/** The copied message, made safe to sit inside a single-quoted script string. */
function jsStr(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/</g, '\\x3c');
}

/**
 * One listener for every Share button on the page (the map's panel has one per
 * card). Same behaviour as the event page's: share sheet, else copy and say so.
 */
export function shareScript(lang: Lang = DEFAULT_LANG): string {
  const copied = jsStr(msg(lang, 'share.copied'));
  return `<script data-testid="share-script">(function(){document.addEventListener('click',function(ev){var t=ev.target,btn=t&&t.closest?t.closest('.ose-share-btn'):null;if(!btn||btn.disabled)return;var u=btn.getAttribute('data-share-url'),n=btn.getAttribute('data-share-title');if(!u)return;if(navigator.share){navigator.share({title:n,url:u}).catch(function(){});}else if(navigator.clipboard){var orig=btn.textContent;navigator.clipboard.writeText(u).then(function(){btn.textContent='${copied}';setTimeout(function(){btn.textContent=orig;},2000);}).catch(function(){});}});})();</script>`;
}
