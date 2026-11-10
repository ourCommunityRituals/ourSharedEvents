/**
 * The Language menu in the header bar (owner 2026-11-10).
 *
 * The footer switch (`language-switch.ts`) was the only way to change language,
 * at the foot of the page. This menu sits on the left of the header bar:
 *
 * - Wide screen: a button that says "Language" ("Idioma"). It opens the list of
 *   every language the pages render, with the page's own language marked.
 * - Phone (640 px and narrower): a menu button. Its first option is Language,
 *   which opens the same list. Later options go after it.
 *
 * Picking a language that is not the current one follows a plain link to the
 * same page in that language, so the whole page loads again in it. The current
 * language is not a link. Opening it and switching are plain markup: `<details>`
 * and links, no cookie and nothing stored. One small script only closes an open
 * menu on a tap outside it or on Escape (owner D4, 2026-11-10, OSE-1934); with
 * script off the menu still opens, switches and closes from its own button.
 *
 * The list comes from `LANGUAGES`, so a new language appears here with no
 * change to this file. Names come from `LANGUAGE_SWITCH_NAMES`, as in the
 * footer: a Spanish page names English "Inglés".
 *
 * Both layouts are in the page; CSS shows one. Neither is a `<nav>`: the footer
 * switch is already the "Language" landmark, and two landmarks with one name
 * confuse a screen-reader user.
 */
import { escapeHtml as esc } from '../html-escape';
import { msg } from './catalog';
import { LANGUAGES, LANGUAGE_NAMES, LANGUAGE_SWITCH_NAMES } from './languages';
import type { LanguageSwitchOptions } from './language-switch';
import { withLangPrefix } from './path-prefix';

/** Colors are tokens from /ui.css; targets 48 px, text 16 px (design system). */
export const LANGUAGE_MENU_CSS = `
    .ose-langmenu { position: relative; display: inline-flex; align-items: center; flex: 0 0 auto; }
    .ose-langmenu details { position: relative; }
    .ose-langmenu summary { list-style: none; cursor: pointer; }
    .ose-langmenu summary::-webkit-details-marker { display: none; }
    .ose-langmenu-button { display: inline-flex; align-items: center; justify-content: center; gap: 0.375rem; box-sizing: border-box; min-height: 48px; min-width: 48px; padding: 0.5rem 0.875rem; border: 1.5px solid var(--border-strong); border-radius: 8px; background: var(--surface); color: var(--text); font-size: 1rem; font-weight: 600; line-height: 1.5; }
    .ose-langmenu-button:hover, .ose-langmenu-row:hover, a.ose-langmenu-item:hover { outline: 2px solid var(--border-strong); outline-offset: -2px; }
    .ose-langmenu summary:focus-visible, .ose-langmenu-item:focus-visible { outline: 3px solid var(--focus-ring, var(--accent)); outline-offset: 2px; }
    .ose-langmenu-caret { font-size: 0.875rem; }
    .ose-langmenu details[open] > summary .ose-langmenu-caret { transform: rotate(180deg); }
    .ose-langmenu-list { display: flex; flex-direction: column; gap: 0.75rem; margin: 0; padding: 0.375rem; list-style: none; }
    .ose-langmenu-desktop > .ose-langmenu-list, .ose-langmenu-panel { position: absolute; top: calc(100% + 0.5rem); left: 0; z-index: 50; box-sizing: border-box; background: var(--surface); border: 1.5px solid var(--border-strong); border-radius: 8px; }
    .ose-langmenu-desktop > .ose-langmenu-list { min-width: 12rem; }
    .ose-langmenu-panel { width: min(18rem, calc(100vw - 2rem)); padding: 0.375rem; }
    .ose-langmenu-item { display: flex; align-items: center; gap: 0.5rem; box-sizing: border-box; min-height: 48px; padding: 0.5rem 0.75rem; border-radius: 6px; color: var(--text); font-size: 1rem; font-weight: 600; line-height: 1.5; text-decoration: none; }
    .ose-langmenu-current { background: var(--accent); color: var(--on-accent); }
    .ose-langmenu-check { display: inline-block; width: 1.25em; }
    .ose-langmenu-row { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; box-sizing: border-box; min-height: 48px; padding: 0.5rem 0.75rem; border-radius: 6px; color: var(--text); font-size: 1rem; font-weight: 600; line-height: 1.5; }
    .ose-langmenu-sub[open] > .ose-langmenu-row .ose-langmenu-caret { transform: rotate(90deg); }
    .ose-langmenu-sub > .ose-langmenu-list { padding: 0.25rem 0 0 0.75rem; }
    .ose-langmenu-mobile { display: none; }
    @media (max-width: 640px) {
      .ose-langmenu-desktop { display: none; }
      .ose-langmenu-mobile { display: block; }
    }`;

/** The list of languages; `idPrefix` names each entry's test id. */
function languageList(opts: LanguageSwitchOptions, idPrefix: string): string {
  const query = opts.query ?? '';
  const label = esc(msg(opts.lang, 'language.label'));
  const items = LANGUAGES.map((l) => {
    const name = LANGUAGE_SWITCH_NAMES[opts.lang][l];
    // Its own name ("Español") is in that language; any other is in the page's.
    const textLang = name === LANGUAGE_NAMES[l] ? l : opts.lang;
    if (l === opts.lang) {
      return `<li><span class="ose-langmenu-item ose-langmenu-current" aria-current="true" lang="${textLang}" data-testid="${idPrefix}-${l}"><span class="ose-langmenu-check" aria-hidden="true">✓</span>${esc(name)}</span></li>`;
    }
    return `<li><a class="ose-langmenu-item" lang="${textLang}" hreflang="${l}" data-testid="${idPrefix}-${l}" href="${esc(withLangPrefix(l, opts.path) + query)}"><span class="ose-langmenu-check" aria-hidden="true"></span>${esc(name)}</a></li>`;
  }).join('');
  return `<ul class="ose-langmenu-list" aria-label="${label}">${items}</ul>`;
}

export interface LanguageMenuOptions extends LanguageSwitchOptions {
  /**
   * The page's CSP nonce, for pages that write their own `<script nonce>` (the
   * event pages). Left out, the script is a bare `<script>` and `html()` adds
   * the response's nonce (`/events`, the landing).
   */
  nonce?: string;
}

/**
 * Closes every open menu part on a click outside it, and all of them on Escape
 * with focus back on the outermost button. It reads and sets `details.open` and
 * focus only: no storage, no network, no HTML written.
 */
const LANGUAGE_MENU_SCRIPT =
  "(function(){function o(){return document.querySelectorAll('.ose-langmenu details[open]');}" +
  "document.addEventListener('click',function(e){var d=o();for(var i=0;i<d.length;i++){if(!d[i].contains(e.target))d[i].open=false;}});" +
  "document.addEventListener('keydown',function(e){if(e.key!=='Escape')return;var d=o();if(!d.length)return;var s=d[0].querySelector('summary');for(var i=0;i<d.length;i++)d[i].open=false;if(s)s.focus();});})();";

export function renderLanguageMenu(opts: LanguageMenuOptions): string {
  const label = esc(msg(opts.lang, 'language.label'));
  const menu = esc(msg(opts.lang, 'menu.label'));
  return `<div class="ose-langmenu" data-testid="language-menu">
      <details class="ose-langmenu-desktop" data-testid="language-menu-desktop">
        <summary class="ose-langmenu-button" data-testid="language-menu-button"><span>${label}</span><span class="ose-langmenu-caret" aria-hidden="true">▾</span></summary>
        ${languageList(opts, 'language-menu')}
      </details>
      <details class="ose-langmenu-mobile" data-testid="site-menu">
        <summary class="ose-langmenu-button" aria-label="${menu}" data-testid="site-menu-button"><span aria-hidden="true">☰</span></summary>
        <div class="ose-langmenu-panel" data-testid="site-menu-panel">
          <details class="ose-langmenu-sub" data-testid="site-menu-language">
            <summary class="ose-langmenu-row" data-testid="site-menu-language-button"><span>${label}</span><span class="ose-langmenu-caret" aria-hidden="true">›</span></summary>
            ${languageList(opts, 'site-menu-language')}
          </details>
        </div>
      </details>
    </div>
    <script${opts.nonce === undefined ? '' : ` nonce="${esc(opts.nonce)}"`}>${LANGUAGE_MENU_SCRIPT}</script>`;
}
