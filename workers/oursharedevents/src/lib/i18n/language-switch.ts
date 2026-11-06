/**
 * The visible language switch (OSE-1761).
 *
 * A plain link to the same page in each other language: no script, no cookie,
 * nothing stored about the visitor. The link text comes from
 * `LANGUAGE_SWITCH_NAMES`: a Spanish page names English in Spanish ("Inglés"),
 * an English page names Spanish by its own name ("Español"). The link's `lang`
 * is the language its text is written in, so a screen reader says it right;
 * `hreflang` is the language it leads to. The group's name ("Language" /
 * "Idioma") is in the page's language.
 *
 * It sits above Back, which stays the last control on the page (owner
 * 2026-10-11). An admin draft preview has no public address and shows none.
 */
import { escapeHtml as esc } from '../html-escape';
import { msg } from './catalog';
import { LANGUAGES, LANGUAGE_NAMES, LANGUAGE_SWITCH_NAMES, type Lang } from './languages';
import { withLangPrefix } from './path-prefix';

export const LANGUAGE_SWITCH_CSS = `
    .ose-lang { display: flex; flex-wrap: wrap; justify-content: center; gap: 0.5rem; margin: 1.5rem 0 0; }
    .ose-lang a { display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; min-height: 44px; min-width: 44px; padding: 0.5rem 1rem; color: var(--accent); font-size: 1rem; font-weight: 600; line-height: 1.5; text-decoration: underline; }
    .ose-lang a:focus { outline: 3px solid var(--accent); outline-offset: 2px; }`;

export interface LanguageSwitchOptions {
  /** The language the page is in. */
  lang: Lang;
  /** The page's address without a language prefix, e.g. `/events/abc/spring-fair`. */
  path: string;
  /** Query to carry over, already vetted by the caller: `''` or `?type=checkin`. */
  query?: string;
}

export function renderLanguageSwitch(opts: LanguageSwitchOptions): string {
  const others = LANGUAGES.filter((l) => l !== opts.lang);
  if (others.length === 0) return '';
  const query = opts.query ?? '';
  const links = others
    .map((l) => {
      const name = LANGUAGE_SWITCH_NAMES[opts.lang][l];
      // Its own name ("Español") is in that language; any other is in the page's.
      const textLang = name === LANGUAGE_NAMES[l] ? l : opts.lang;
      return `<a lang="${textLang}" hreflang="${l}" data-testid="language-switch-${l}" href="${esc(withLangPrefix(l, opts.path) + query)}">${esc(name)}</a>`;
    })
    .join('\n      ');
  return `<nav class="ose-lang" data-testid="language-switch" aria-label="${esc(msg(opts.lang, 'language.label'))}">
      ${links}
    </nav>`;
}
