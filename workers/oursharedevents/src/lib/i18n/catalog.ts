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
  // The event page, all three phases. A `{name}` is filled by `fmt`; the value
  // put there is escaped by the caller.
  'page.skip': 'Skip to event content',
  'nav.site': 'Site',
  'nav.allEvents': '&larr; All events',
  'nav.eventPage': 'Event page',
  'nav.poster': 'Poster',
  'event.type': 'Type: {type}',
  'event.hostedBy': 'Hosted by {host}',
  'live.badge': 'Live now',
  'live.badgeLabel': 'Event is live now',
  'sponsors.supportedBy': 'Supported by',
  'sponsors.label': 'Event sponsors',
  'sponsors.thanks': 'Thanks to our sponsors',
  'section.what': 'What',
  'section.where': 'Where',
  'section.who': 'Who',
  'section.howMuch': 'How much',
  'section.why': 'Why',
  'section.how': 'How',
  'who.photoOf': 'Photo of {host}',
  'who.host': 'Host',
  'map.alt': 'Map of {venue}',
  'cta.register': 'Register',
  'cta.checkin': 'Check in at this event',
  'cta.survey': 'Share feedback',
  'cta.emailSignup': 'Get event updates',
  'price.free': 'Free',
  'price.sliding': 'Sliding scale',
  'price.donation': 'Pay what you can',
  'price.varies': 'Varies',
  'countdown.now': 'Starting now',
  'countdown.today': 'Starts today',
  'countdown.tomorrow': 'Starts tomorrow',
  'countdown.in': 'Starts in ',
  'countdown.minute': ' minute',
  'countdown.minutes': ' minutes',
  'countdown.hour': ' hour',
  'countdown.hours': ' hours',
  'countdown.days': ' days',
  'next.atVenue': 'Next at {venue}',
  'next.thisVenue': 'this venue',
  'next.fallbackHeading': 'The corridor keeps going',
  'next.fallbackNote': 'More gatherings are always coming together nearby.',
  'next.browse': "See what's coming up",
  'recap.title': 'recap',
  'recap.titleCalledOff': 'no longer taking place',
  'recap.chip': "This one's a wrap",
  'recap.chipCalledOff': 'Not happening',
  'recap.happened': 'Happened {when}',
  'recap.ended': 'This event has ended.',
  'recap.calledOffWhen': 'No longer taking place. It was planned for {when}',
  'recap.calledOff': 'No longer taking place.',
  'recap.whatHeading': 'What this was',
  'recap.empty': "The host hasn't written this one up yet. The numbers below are the story.",
  'recap.emptyCalledOff': "The host didn't write this one up.",
  'stats.heading': 'By the numbers',
  'stats.registered': 'Registered',
  'stats.checkedIn': 'Checked in',
  'stats.walkedIn': 'Walked in',
  'stats.surveys': 'Surveys submitted',
  'stats.emailSignups': 'Email signups',
  'stats.fewerThan': 'Fewer than {floor} {label}',
  'stats.walkInShare': '{pct}% of check-ins were walk-ins',
  'stats.showedUpShare': '{pct}% of those registered showed up',
  'connect.heading': 'Hear about the next one',
  'connect.note': "One email when something's coming up. Nothing else.",
  'connect.cta': 'Keep me posted',
  // The never-who disclosure on the event page (lib/never-who.ts). Spacing is
  // part of the page's bytes; keep it as it is.
  'neverWho.line': 'Never who, only how many.',
  'neverWho.trigger': 'How this works',
  'neverWho.event': `<p>
      You're part of the group, anonymously. OurSharedEvents tracks when
      groups gather &mdash; never who you are. Event hosts and sponsors see
      corridors and venues, not people. The link you followed counted as a
      single click; nothing about your device, location, or identity was
      collected to display this page.
    </p>`,
  // The band on every staging page (lib/test-site-notice.ts), in the page's language.
  'testSite.headline': 'Testing purposes only.',
  'testSite.listings':
    'Events, venues and businesses here are drawn from public listings for testing; nothing here is an endorsement or an offer.',
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
  'page.skip': 'Ir al contenido del evento',
  'nav.site': 'Sitio',
  'nav.allEvents': '&larr; Todos los eventos',
  'nav.eventPage': 'Página del evento',
  'nav.poster': 'Cartel',
  'event.type': 'Tipo: {type}',
  'event.hostedBy': 'Organizado por {host}',
  'live.badge': 'En vivo',
  'live.badgeLabel': 'El evento está en vivo',
  'sponsors.supportedBy': 'Con el apoyo de',
  'sponsors.label': 'Patrocinadores del evento',
  'sponsors.thanks': 'Gracias a nuestros patrocinadores',
  'section.what': 'Qué',
  'section.where': 'Dónde',
  'section.who': 'Quién',
  'section.howMuch': 'Cuánto cuesta',
  'section.why': 'Por qué',
  'section.how': 'Cómo',
  'who.photoOf': 'Foto de {host}',
  'who.host': 'Quien organiza',
  'map.alt': 'Mapa de {venue}',
  'cta.register': 'Inscribirse',
  'cta.checkin': 'Registrar mi llegada',
  'cta.survey': 'Danos tu opinión',
  'cta.emailSignup': 'Recibir novedades del evento',
  'price.free': 'Gratis',
  'price.sliding': 'Precio escalonado',
  'price.donation': 'Paga lo que puedas',
  'price.varies': 'Varía',
  'countdown.now': 'Empieza ahora',
  'countdown.today': 'Empieza hoy',
  'countdown.tomorrow': 'Empieza mañana',
  'countdown.in': 'Empieza en ',
  'countdown.minute': ' minuto',
  'countdown.minutes': ' minutos',
  'countdown.hour': ' hora',
  'countdown.hours': ' horas',
  'countdown.days': ' días',
  'next.atVenue': 'Próximamente en {venue}',
  'next.thisVenue': 'este lugar',
  'next.fallbackHeading': 'El corredor sigue',
  'next.fallbackNote': 'Siempre hay más encuentros organizándose cerca.',
  'next.browse': 'Ver lo que viene',
  'recap.title': 'resumen',
  'recap.titleCalledOff': 'ya no se realizará',
  'recap.chip': 'Ya terminó',
  'recap.chipCalledOff': 'No se realizará',
  'recap.happened': 'Se realizó el {when}',
  'recap.ended': 'Este evento ya terminó.',
  'recap.calledOffWhen': 'Ya no se realizará. Estaba previsto para el {when}',
  'recap.calledOff': 'Ya no se realizará.',
  'recap.whatHeading': 'De qué se trató',
  'recap.empty':
    'Quien organiza aún no ha escrito sobre este evento. Las cifras de abajo cuentan la historia.',
  'recap.emptyCalledOff': 'Quien organiza no escribió sobre este evento.',
  'stats.heading': 'En cifras',
  'stats.registered': 'inscritos',
  'stats.checkedIn': 'registraron su llegada',
  'stats.walkedIn': 'llegaron sin inscribirse',
  'stats.surveys': 'encuestas enviadas',
  'stats.emailSignups': 'suscripciones por correo',
  'stats.fewerThan': 'Menos de {floor} {label}',
  'stats.walkInShare': 'El {pct}% de las llegadas fueron sin inscripción',
  'stats.showedUpShare': 'Llegó el {pct}% de los inscritos',
  'connect.heading': 'Entérate del próximo',
  'connect.note': 'Un correo cuando se acerque algo. Nada más.',
  'connect.cta': 'Avísame',
  'neverWho.line': 'Nunca quién, solo cuántos.',
  'neverWho.trigger': 'Cómo funciona',
  'neverWho.event': `<p>
      Eres parte del grupo, de manera anónima. OurSharedEvents registra cuándo
      se reúnen los grupos &mdash; nunca quién eres. Quienes organizan y
      patrocinan ven corredores y lugares, no personas. El enlace que seguiste
      contó como un solo clic; no se recopiló nada sobre tu dispositivo, tu
      ubicación ni tu identidad para mostrar esta página.
    </p>`,
  'testSite.headline': 'Solo para pruebas.',
  'testSite.listings':
    'Los eventos, lugares y negocios que aparecen aquí provienen de listados públicos y se usan para hacer pruebas; nada de esto es una recomendación ni una oferta.',
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

/**
 * A message with its `{name}` slots filled. The values go in as given, so a
 * caller escapes anything organizer-entered first. A slot with no value is left
 * as written, which a test then sees.
 */
export function fmt(lang: Lang, key: MessageKey, vars: Record<string, string | number>): string {
  return msg(lang, key).replace(/\{(\w+)\}/g, (slot, name: string) =>
    name in vars ? String(vars[name]) : slot
  );
}

/** Every language's text for one key, in `LANGUAGES` order. */
export function msgAll(key: MessageKey): Record<Lang, string> {
  return Object.fromEntries(LANGUAGES.map((l) => [l, msg(l, key)])) as Record<Lang, string>;
}

export { DEFAULT_LANG };
