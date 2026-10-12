/**
 * Back, the last control on every public page (owner 2026-10-11).
 *
 * "Just looking" on the event page became Back at the foot of the page, and
 * the owner asked for it in the same place everywhere (the event page in each
 * phase, the form pages, the sponsor card), so a visitor learns where it is and
 * can always find the way out of a page.
 *
 * When the visitor came from a page (a referrer) and the tab has history, Back
 * goes back there, on this site or not. Opened fresh from a QR code or a shared
 * link there is neither, and a new tab can still count a blank first entry, so
 * the link opens `fallbackHref` instead, which is also what it does with no
 * script. In an admin draft preview it is switched off (no href).
 *
 * The script reads document.referrer and history.length in the browser only.
 * It sends nothing and stores nothing.
 */

import { escapeHtml as esc } from './html-escape';

export const BACK_LABELS = { en: 'Back', es: 'Volver' } as const;

/**
 * The outlined, full-width Back button. It reads the @ocr/ui role tokens
 * (/ui.css), so it follows the page's theme, and matches the event page's
 * outlined choices.
 */
export const BACK_BUTTON_CSS = `
    .ose-back { margin: 1.5rem 0 0.5rem; }
    .ose-back-btn { display: flex; align-items: center; justify-content: center; box-sizing: border-box; width: 100%; min-height: 44px; padding: 0.75rem 1.5rem; border: 1.5px solid var(--accent); border-radius: 6px; background: transparent; color: var(--accent); font-size: 1.05rem; font-weight: 600; line-height: 1.5; text-decoration: none; }
    .ose-back-btn:focus { outline: 3px solid var(--accent); outline-offset: 2px; }`;

export interface BackButtonOptions {
  /** Where Back goes when there is no page to go back to. */
  fallbackHref: string;
  /** The page's CSP nonce. Leave it out when the page's html() adds one to every script. */
  nonce?: string;
  lang?: 'en' | 'es';
  /** Admin draft preview: shown, but switched off. */
  inert?: boolean;
  testid?: string;
  /** The button's classes. The sponsor card uses the hub's own button. */
  className?: string;
}

export function renderBackButton(opts: BackButtonOptions): string {
  const label = BACK_LABELS[opts.lang ?? 'en'];
  const testid = opts.testid ?? 'page-back';
  const cls = opts.className ?? 'ose-back-btn';
  if (opts.inert) {
    return `<nav class="ose-back" aria-label="${label}">
      <a class="${cls}" data-testid="${testid}" data-preview-inert="true" aria-disabled="true">${label}</a>
    </nav>`;
  }
  const nonce = opts.nonce ? ` nonce="${esc(opts.nonce)}"` : '';
  return `<nav class="ose-back" aria-label="${label}">
      <a class="${cls}" data-testid="${testid}" href="${esc(opts.fallbackHref)}">${label}</a>
    </nav>
<script${nonce}>(function(){var a=document.querySelector('[data-testid="${testid}"]');if(!a||!document.referrer||window.history.length<2)return;a.addEventListener('click',function(e){e.preventDefault();window.history.back();});})();</script>`;
}
