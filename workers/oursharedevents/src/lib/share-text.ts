// ─── Share text: what a shared event says (OSE-1371) ─────────────────────────
//
// ONE builder for every way a visitor passes an event on — the Web Share sheet,
// the Email (mailto:) link and Copy. All three carry the exact `body` returned
// here, so a friend reads the same invite whichever button was pressed.
//
// Pure: no DOM, no D1, no clock. The page passes the event row it already read
// plus the event's public /s/ short link (read-only lookup; never minted on a
// page render) or, when none exists, the canonical /events/:id URL.
//
// What it will NOT carry (never-who + organizer privacy): no tracking params,
// no per-person token, no /q/ scan path, no internal/admin path, and no field
// the public projection does not already publish. Empty fields are omitted —
// never "TBD".

import { formatEventPrice } from './event-price.js';
import { isValidIanaTimezone, zonedDatePart } from './event-datetime.js';

export type ShareLang = 'en' | 'es';

/** The public fields a share may read. Everything else on the row is ignored. */
export interface ShareEventInput {
  title: string | null;
  what_short?: string | null;
  description?: string | null;
  start_date?: string | null;
  starts_at?: string | null;
  timezone?: string | null;
  location?: string | null;
  where_address?: string | null;
  how_details?: string | null;
  price_cents?: number | null;
  price_model?: string | null;
  price_note?: string | null;
}

export interface ShareText {
  /** Email subject / share-sheet title: "{title}, {Sat Oct 24}". */
  subject: string;
  /** Body: a blank first line for the sender's own note, then the invite. */
  body: string;
}

/** Hard ceiling for the body (a text message / email preview stays readable). */
export const SHARE_BODY_MAX = 600;

const COPY = {
  en: {
    details: 'Details and RSVP:',
    footer: 'Sent from OurSharedEvents. Nothing about you or me was collected to send this.',
    fallbackTitle: 'An event',
    locale: 'en-US',
  },
  es: {
    details: 'Detalles y confirmación:',
    footer:
      'Enviado desde OurSharedEvents. No se recopiló nada sobre ti ni sobre mí para enviar esto.',
    fallbackTitle: 'Un evento',
    locale: 'es-US',
  },
} as const;

/** Collapse whitespace to one line and clip with an ellipsis. */
function oneLine(raw: string | null | undefined, max: number): string {
  const s = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}

/** The event's local calendar day ("YYYY-MM-DD"), or '' when it has none. */
function eventDay(e: ShareEventInput): string {
  if (e.starts_at) return zonedDatePart(e.starts_at, e.timezone ?? null);
  const d = (e.start_date ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  return d ? zonedDatePart(d, e.timezone ?? null) : '';
}

/** Format a calendar day (anchored at UTC so it never drifts a day). */
function formatDay(day: string, locale: string, opts: Intl.DateTimeFormatOptions): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' }).format(d);
}

/** "Sat Oct 24" / "sáb 24 oct" — the subject's compact date. */
function subjectDate(day: string, lang: ShareLang): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
  const parts = new Intl.DateTimeFormat(COPY[lang].locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).formatToParts(new Date(`${day}T00:00:00Z`));
  const get = (t: string) => (parts.find((p) => p.type === t)?.value ?? '').replace(/\.$/, '');
  const [w, m, n] = [get('weekday'), get('month'), get('day')];
  if (!w || !m || !n) return '';
  return lang === 'es' ? `${w} ${n} ${m}` : `${w} ${m} ${n}`;
}

/** Start time in the EVENT's zone with its abbreviation ("6:00 PM CDT"). */
function startTime(e: ShareEventInput, lang: ShareLang): string {
  if (!e.starts_at) return '';
  const d = new Date(e.starts_at);
  if (Number.isNaN(d.getTime())) return '';
  const zone = isValidIanaTimezone(e.timezone) ? (e.timezone as string) : 'UTC';
  return new Intl.DateTimeFormat(COPY[lang].locale, {
    timeZone: zone,
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(d);
}

/**
 * Build the subject + body for sharing an event.
 *
 * @param shortUrl the public /s/ short link, or the canonical /events/:id URL.
 */
export function buildShareText(
  event: ShareEventInput,
  shortUrl: string,
  lang: ShareLang = 'en'
): ShareText {
  const c = COPY[lang === 'es' ? 'es' : 'en'];
  const l: ShareLang = lang === 'es' ? 'es' : 'en';
  const title = oneLine(event.title, 100) || c.fallbackTitle;
  const day = eventDay(event);

  const sDate = subjectDate(day, l);
  const subject = sDate ? `${title}, ${sDate}` : title;

  const what = oneLine(event.what_short || event.description, 140);
  const longDate = formatDay(day, c.locale, { weekday: 'long', month: 'long', day: 'numeric' });
  const time = startTime(event, l);
  const when = [longDate, time].filter(Boolean).join(' · ');
  const venue = oneLine(event.location, 80);
  const address = oneLine(event.where_address, 100);
  const place = [venue, address && address !== venue ? address : ''].filter(Boolean).join(', ');
  const price = formatEventPrice({
    price_cents: event.price_cents ?? null,
    price_model: event.price_model ?? null,
    price_note: event.price_note ?? null,
  });
  const howOrPrice = price ? oneLine(price, 80) : oneLine(event.how_details, 100);
  const link = `${c.details} ${shortUrl}`;

  // Optional lines, dropped in this order if the body would run long.
  const optional = { what, howOrPrice, place };
  const assemble = () =>
    ['', title, optional.what, when, optional.place, optional.howOrPrice, link, '', c.footer]
      .filter((line, i) => i === 0 || i === 7 || line !== '')
      .join('\n');

  let body = assemble();
  for (const key of ['what', 'howOrPrice', 'place'] as const) {
    if (body.length <= SHARE_BODY_MAX) break;
    optional[key] = '';
    body = assemble();
  }
  return { subject, body };
}

/** `mailto:` href carrying the same subject + body (newlines as %0A). */
export function shareMailtoHref(text: ShareText): string {
  return `mailto:?subject=${encodeURIComponent(text.subject)}&body=${encodeURIComponent(text.body)}`;
}
