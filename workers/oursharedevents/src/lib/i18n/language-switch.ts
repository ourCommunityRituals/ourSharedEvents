/**
 * The language choice at the foot of a page (OSE-1761; one chip since owner
 * 2026-11-28).
 *
 * It used to be a row of 21 links, one per other language, which filled the
 * bottom of a phone screen. Now it is one chip, in the shared chip style: the
 * page's own flag and language name and a caret. A tap opens a card with every
 * other language, each with its flag, two to a row so the card fits one phone
 * screen. A tap on the chip again closes it.
 *
 * Plain markup, no script and no cookie: `<details>` opens and closes it, and
 * each choice is a plain link to the same page in that language. Nothing about
 * the visitor is stored. The link text comes from `LANGUAGE_SWITCH_NAMES`: a
 * Spanish page names English in Spanish ("Inglés"), an English page names
 * Spanish by its own name ("Español"). A link's `lang` is the language its text
 * is written in, so a screen reader says it right; `hreflang` is the language it
 * leads to. The landmark's name ("Language" / "Idioma") is in the page's
 * language, and so is the chip's spoken name.
 *
 * Layout uses logical properties only, so `<html dir="rtl">` mirrors it with no
 * extra rule. Colours are tokens from /ui.css; every tap target is at least
 * 44 px and text is 16 px.
 *
 * It sits above Back, which stays the last control on the page (owner
 * 2026-10-11). An admin draft preview has no public address and shows none.
 */
import { escapeHtml as esc } from '../html-escape';
import { msg } from './catalog';
import { LANGUAGES, LANGUAGE_NAMES, LANGUAGE_SWITCH_NAMES, type Lang } from './languages';
import { languageFlagPath } from './language-flags';
import { withLangPrefix } from './path-prefix';

export const LANGUAGE_SWITCH_CSS = `
    .ose-lang { display: flex; flex-direction: column; align-items: center; margin: 1.5rem 0 0; }
    .ose-lang details { width: 100%; display: flex; flex-direction: column; align-items: center; }
    .ose-lang-chip { list-style: none; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; box-sizing: border-box; min-height: 48px; min-width: 44px; padding: 0.5rem 1rem; border: 1.5px solid var(--border-strong); border-radius: 999px; background: var(--surface); color: var(--text); font-size: 1rem; font-weight: 600; line-height: 1.5; }
    .ose-lang-chip::-webkit-details-marker { display: none; }
    .ose-lang-chip:hover { outline: 2px solid var(--border-strong); outline-offset: -2px; }
    .ose-lang-chip:focus-visible, .ose-lang a:focus-visible { outline: 3px solid var(--focus-ring, var(--accent)); outline-offset: 2px; }
    .ose-lang-caret { font-size: 0.875rem; }
    .ose-lang details[open] > .ose-lang-chip .ose-lang-caret { transform: rotate(180deg); }
    .ose-lang-flag { flex: 0 0 auto; border-radius: 2px; }
    .ose-lang-card { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.25rem; box-sizing: border-box; width: min(100%, 26rem); margin: 0.5rem 0 0; padding: 0.375rem; list-style: none; background: var(--surface); border: 1.5px solid var(--border-strong); border-radius: 8px; }
    .ose-lang a { display: flex; align-items: center; gap: 0.5rem; box-sizing: border-box; min-height: 44px; min-width: 44px; padding: 0.5rem 0.75rem; border-radius: 6px; color: var(--text); font-size: 1rem; font-weight: 600; line-height: 1.5; text-decoration: none; }
    .ose-lang a:hover { outline: 2px solid var(--border-strong); outline-offset: -2px; }`;

export interface LanguageSwitchOptions {
  /** The language the page is in. */
  lang: Lang;
  /** The page's address without a language prefix, e.g. `/events/abc/spring-fair`. */
  path: string;
  /** Query to carry over, already vetted by the caller: `''` or `?type=checkin`. */
  query?: string;
}

/**
 * A flag or letter badge: a picture with no text (alt=""), so a link's
 * accessible name stays the language's name alone. The chip's flag is on screen
 * and loads with the page; the card's flags wait until the card is opened.
 */
function flag(lang: Lang, lazy: boolean): string {
  return `<img class="ose-lang-flag" src="${languageFlagPath(lang)}" alt="" width="21" height="14"${lazy ? ' loading="lazy"' : ''}>`;
}

/** One leading slash, then anything but a second slash or a backslash. */
const SAME_SITE_PATH = /^\/(?![/\\])/;

export function renderLanguageSwitch(opts: LanguageSwitchOptions): string {
  const others = LANGUAGES.filter((l) => l !== opts.lang);
  if (others.length === 0) return '';
  // Every choice stays on this site: a path that is not one plain local path
  // ("//host", "/\\host", "https:…") would make a link to another site, so the
  // switch is left out rather than built from it.
  if (!SAME_SITE_PATH.test(opts.path)) return '';
  const query = opts.query ?? '';
  const label = esc(msg(opts.lang, 'language.label'));
  const links = others
    .map((l) => {
      const name = LANGUAGE_SWITCH_NAMES[opts.lang][l];
      // Its own name ("Español") is in that language; any other is in the page's.
      const textLang = name === LANGUAGE_NAMES[l] ? l : opts.lang;
      // Every value is escaped (esc) or a code from the fixed LANGUAGES list.
      // nosemgrep: javascript.express.security.injection.raw-html-format.raw-html-format
      return `<li><a lang="${textLang}" hreflang="${l}" data-testid="language-switch-${l}" href="${esc(withLangPrefix(l, opts.path) + query)}">${flag(l, true)}${esc(name)}</a></li>`;
    })
    .join('\n        ');
  // The chip names the page's language in that language ("Español").
  return `<nav class="ose-lang" data-testid="language-switch" aria-label="${label}">
      <details data-testid="language-switch-choice">
        <summary class="ose-lang-chip" aria-label="${label}: ${esc(LANGUAGE_NAMES[opts.lang])}" data-testid="language-switch-chip">${flag(opts.lang, false)}<span lang="${opts.lang}">${esc(LANGUAGE_NAMES[opts.lang])}</span><span class="ose-lang-caret" aria-hidden="true">▾</span></summary>
        <ul class="ose-lang-card" data-testid="language-switch-card">
        ${links}
        </ul>
      </details>
    </nav>`;
}
