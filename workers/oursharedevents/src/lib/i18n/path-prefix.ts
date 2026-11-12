/**
 * The language in the URL path (OSE-1761).
 *
 * A language other than the default travels as a prefix: `/es/events/<id>`.
 * English stays unprefixed, so every existing link and printed code keeps
 * working. The prefix is the visitor's explicit choice and beats the
 * Accept-Language header; a bare URL still negotiates by header.
 *
 * Only a page that is on the language layer may be served under a prefix
 * (`matchLanguagePage`). Anything else under a prefix is not matched by the
 * router and gets its ordinary 404: an unfinished page is never served in the
 * wrong language, and a prefix can never reach an admin, API or short-link
 * route. A surface joins by adding its matcher here (slice C).
 *
 * Nothing here reads or stores anything about a visitor.
 */
import { EVENT_SCREEN_SEGMENTS, type EventFormScreen } from '../canonical';
import { DEFAULT_LANG, LANGUAGES, type Lang } from './languages';

export interface LangPrefix {
  lang: Lang;
  /** The path with the prefix taken off; `/` when nothing follows it. */
  rest: string;
}

/**
 * `/es/events/x` is `{ es, /events/x }`. The default language is never a prefix
 * (`/en/...` is not a page), the tag is matched exactly (lower-case), and the
 * tag must be a whole path segment (`/espanol` is not `/es`).
 */
export function parseLangPrefix(pathname: string): LangPrefix | null {
  if (!pathname.startsWith('/')) return null;
  const segment = pathname.split('/')[1];
  const lang = (LANGUAGES as readonly string[]).find((l) => l === segment && l !== DEFAULT_LANG);
  if (!lang) return null;
  return { lang: lang as Lang, rest: pathname.slice(1 + segment.length) || '/' };
}

/** `/events/x` in Spanish is `/es/events/x`; in English it is unchanged. */
export function withLangPrefix(lang: Lang, path: string): string {
  return lang === DEFAULT_LANG ? path : `/${lang}${path}`;
}

/** The pages that render in the visitor's language, and what each is called. */
export type LanguagePage =
  | { kind: 'event'; id: string; name?: string }
  | { kind: 'share'; code: string }
  | { kind: 'landing' }
  | { kind: 'events' }
  // OSE-1850: an event's form screens (register, check in, feedback, updates).
  | { kind: 'form'; id: string; screen: EventFormScreen };

const EVENT_PAGE = /^\/events\/([A-Za-z0-9_-]{1,128})$/;
const EVENT_PAGE_NAMED = /^\/events\/([A-Za-z0-9_-]{1,128})\/([a-z0-9-]{1,100})$/;
const SHARE_LINK = /^\/e\/([^/]{1,40})$/;
// The same shape as the router's own form route: /events/<id>/<screen>.
const EVENT_FORM = /^\/events\/([A-Za-z0-9_-]{1,128})\/(register|checkin|survey|updates)$/;

/**
 * Which language-layer page a prefix-free path is, or null when none. The shapes
 * match the router's own for these pages. A name that is a screen of the event
 * (`tv`, `poster`, `register`, ...) is that screen, not an event page.
 */
export function matchLanguagePage(rest: string): LanguagePage | null {
  // OSE-1762: the landing (`/es/`, `/es`) and the event list (`/es/events`).
  if (rest === '/') return { kind: 'landing' };
  if (rest === '/events') return { kind: 'events' };
  // OSE-1850: a form screen is a page under a prefix. The other screens (tv,
  // poster, calendar) are not: they have not joined the language layer.
  const form = rest.match(EVENT_FORM);
  if (form) return { kind: 'form', id: form[1], screen: form[2] as EventFormScreen };
  const plain = rest.match(EVENT_PAGE);
  if (plain) return { kind: 'event', id: plain[1] };
  const named = rest.match(EVENT_PAGE_NAMED);
  if (named && !EVENT_SCREEN_SEGMENTS.includes(named[2])) {
    return { kind: 'event', id: named[1], name: named[2] };
  }
  const share = rest.match(SHARE_LINK);
  if (share) return { kind: 'share', code: share[1] };
  return null;
}

export interface LanguageAlternate {
  /** An `hreflang` value: a language tag, or `x-default`. */
  hreflang: string;
  href: string;
}

/**
 * The same page in every language, for `<link rel="alternate" hreflang>`.
 * `x-default` is the unprefixed address.
 */
export function languageAlternates(origin: string, path: string): LanguageAlternate[] {
  return [
    ...LANGUAGES.map((l) => ({ hreflang: l, href: `${origin}${withLangPrefix(l, path)}` })),
    { hreflang: 'x-default', href: `${origin}${path}` },
  ];
}
