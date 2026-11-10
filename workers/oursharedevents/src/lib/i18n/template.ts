/**
 * Static page shells on the language layer (OSE-1762).
 *
 * The landing and /events shells are HTML files. Their words are catalog keys
 * written as slots, and this fills them in the page's language:
 *
 *   {{lang}}          the language tag, for `<html lang>`
 *   {{dir}}           the language's direction, `ltr` or `rtl`, for `<html dir>`
 *                     (epic OSE-1959)
 *   {{langdir}}      the language's folder in an address: nothing in the
 *                     default language, `es/` in Spanish. It always follows a
 *                     literal slash (`href="/{{langdir}}events"`), so an address
 *                     in a shell starts with `/` and a slot never begins a URL
 *                     (Semgrep var-in-href).
 *   {{t:key}}         the catalog text, as HTML (catalog text is ours, not input)
 *   {{js:key}}        the catalog text inside a single-quoted script string
 *
 * A shell is filled before anything else is put into it, so text a visitor or
 * an organizer typed is never read for slots. A slot naming a key the catalog
 * has not got is a broken shell, and throws rather than shipping the raw slot.
 * Shells are filled on each request: a few kilobytes of text, one pass.
 */
import { CATALOG, msg, type MessageKey } from './catalog';
import { DEFAULT_LANG, DIRECTION, type Lang } from './languages';
import { withLangPrefix } from './path-prefix';

const SLOT = /\{\{(?:(lang|langdir|dir)|(t|js):([^{}\s]+))\}\}/g;

// U+2028 and U+2029 end a line inside a script string, so they are written as
// escapes. Split and joined: a regex literal cannot hold them.
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

function jsString(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/</g, '\\u003C')
    .replace(/>/g, '\\u003E')
    .replace(/\r?\n/g, '\\n')
    .split(LINE_SEPARATOR)
    .join('\\u2028')
    .split(PARAGRAPH_SEPARATOR)
    .join('\\u2029');
}

function key(name: string): MessageKey {
  if (!(name in CATALOG[DEFAULT_LANG])) throw new Error(`No catalog key "${name}" for a page slot`);
  return name as MessageKey;
}

export function fillTemplate(html: string, lang: Lang): string {
  return html.replace(
    SLOT,
    (_slot, bare: string | undefined, kind: string | undefined, name: string | undefined) => {
      if (bare === 'lang') return lang;
      if (bare === 'dir') return DIRECTION[lang];
      // `/es/` without its leading slash; the default language has no folder.
      if (bare === 'langdir') return withLangPrefix(lang, '/').slice(1);
      const text = msg(lang, key(name as string));
      return kind === 'js' ? jsString(text) : text;
    }
  );
}
