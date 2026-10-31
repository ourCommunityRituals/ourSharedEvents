/**
 * The string catalog for the public pages (OSE-1760).
 *
 * Every visible string that used to be an inline `lang === 'es' ? ... : ...`
 * lives here, keyed once. A render function asks `msg(lang, key)` and never
 * decides a language itself. English is the source of truth: its keys define
 * `MessageKey`, and every other language is typed against that set, so a key
 * missing from Spanish is a compile error, not a silent English string.
 *
 * Adding a language: add its tag to `LANGUAGES`, add a catalog below. A language
 * that is not finished may declare fewer keys; the lookup then falls back to
 * English for that key only.
 *
 * Organizer-entered text (titles, descriptions, venues) is never in here: it
 * shows as typed. Legal and civic text is translated by a person and reviewed;
 * a machine draft may start it and never ships alone.
 */
import { DEFAULT_LANG, LANGUAGES, type Lang } from './languages';

const en = {
  'share.label': 'Share this event',
  'share.copied': 'Link copied!',
  'calendar.label': 'Add to calendar',
  'calendar.ics': 'Apple or Outlook',
  'directions.pre': 'Get directions',
  'directions.live': 'Navigate now',
  'video.watch': '▶ Watch the video',
  'back.label': 'Back',
  'language.label': 'Language',
  'choices.heading': 'How would you like to take part?',
  'choices.registerNote': 'Asks for your name and email.',
  'choices.checkinLabel': 'Count me in, anon',
  'choices.checkinNote': 'Counted, never named.',
  'what.donation': 'Donate →',
  'what.league': 'View the league →',
  'what.workshop': 'Register →',
  'what.substack': 'Subscribe →',
  'what.tickets': 'Get tickets →',
  'what.menu': 'Menu & reservations →',
  'what.website': 'Visit the site →',
} as const;

export type MessageKey = keyof typeof en;

const es: Record<MessageKey, string> = {
  'share.label': 'Compartir este evento',
  'share.copied': 'Enlace copiado',
  'calendar.label': 'Agregar al calendario',
  'calendar.ics': 'Apple u Outlook',
  'directions.pre': 'Cómo llegar',
  'directions.live': 'Cómo llegar',
  'video.watch': '▶ Ver el video',
  'back.label': 'Volver',
  'language.label': 'Idioma',
  'choices.heading': '¿Cómo quieres participar?',
  'choices.registerNote': 'Pide tu nombre y correo.',
  'choices.checkinLabel': 'Cuenta conmigo, de forma anónima',
  'choices.checkinNote': 'Te contamos, nunca te nombramos.',
  'what.donation': 'Donar →',
  'what.league': 'Ver la liga →',
  'what.workshop': 'Inscribirse →',
  'what.substack': 'Suscribirse →',
  'what.tickets': 'Comprar entradas →',
  'what.menu': 'Menú y reservas →',
  'what.website': 'Visitar el sitio →',
};

/** One catalog per language. A language still being written may omit keys. */
export const CATALOG: Record<Lang, Partial<Record<MessageKey, string>>> = { en, es };

/** The type names a WHAT link can carry; each has a `what.<type>` key. */
export const WHAT_TYPES = [
  'donation',
  'league',
  'workshop',
  'substack',
  'tickets',
  'menu',
  'website',
] as const;

export type WhatType = (typeof WHAT_TYPES)[number];

export function msg(lang: Lang, key: MessageKey): string {
  return CATALOG[lang][key] ?? en[key];
}

/** Every language's text for one key, in `LANGUAGES` order. */
export function msgAll(key: MessageKey): Record<Lang, string> {
  return Object.fromEntries(LANGUAGES.map((l) => [l, msg(l, key)])) as Record<Lang, string>;
}

export { DEFAULT_LANG };
