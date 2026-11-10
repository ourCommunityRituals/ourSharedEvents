/**
 * sponsor-card.ts — the sponsor's public presentation (OSE-1316 / OSE-1317
 * follow-up, migration 0083).
 *
 * A sponsor is valid with only a business name. On every surface it shows:
 *   - an image: its own logo, or the OSE default mark when it has none (or its
 *     logo fails to load). Choosing the default is a real choice, not an error.
 *   - a title: its display_name, or the business name when that is blank.
 * When a visitor taps it, it goes to the sponsor's https website if it has one,
 * and otherwise to its public card (GET /sponsors/:id): title, location and
 * contact — each optional, each entered by the sponsor to be found.
 *
 * Tier equity (Invariant #5): nothing here reads tier. The default image, a
 * custom image, a display name and the card are available at every tier.
 */

import { useSponsorsSql } from './event-settings';

// ── Field rules ───────────────────────────────────────────────────────────────

export const DISPLAY_NAME_MAX = 80;
export const ADDRESS_LINE_MAX = 200;
export const CONTACT_PHONE_MAX = 32;
export const CONTACT_EMAIL_MAX = 254;
/** OSE-1826 (0105): the short text in the sponsor's header block. */
export const HEADER_TEXT_MAX = 140;

export type CardField =
  'display_name' | 'address_line' | 'contact_phone' | 'contact_email' | 'header_text';

export type CardFieldResult =
  { ok: true; value: string | null } | { ok: false; code: string; message: string };

// Digits plus the punctuation people actually type in a phone number, and an
// optional extension. At least 7 digits, so "call us" is not a phone number.
const PHONE_RE = /^\+?[0-9 ().\-]{7,}(?:\s*(?:x|ext\.?)\s*[0-9]{1,6})?$/i;
// An allowlist, not a denylist: letters, digits and . _ + - before the @, and
// dot-separated labels after it. Anything else — notably ? & = % # / , ; —
// is refused, because the value becomes a public mailto: link and those
// characters would let a stored address prefill a visitor's subject, body or
// extra recipients (CCR PR #699). Deliverability is the sponsor's business.
const EMAIL_RE = /^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

/**
 * Validate one optional card field from a request body. Absent is handled by
 * the caller; here null / '' / whitespace mean "clear it" (→ null).
 */
export function checkCardField(field: CardField, raw: unknown): CardFieldResult {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== 'string') {
    return { ok: false, code: `INVALID_${field.toUpperCase()}`, message: `${field} must be text` };
  }
  // Collapse runs of whitespace (incl. newlines) so a card line stays one line.
  const v = raw.replace(/\s+/g, ' ').trim();
  if (v === '') return { ok: true, value: null };
  switch (field) {
    case 'display_name':
      if (v.length > DISPLAY_NAME_MAX) {
        return {
          ok: false,
          code: 'INVALID_DISPLAY_NAME',
          message: `Display name must be ${DISPLAY_NAME_MAX} characters or fewer`,
        };
      }
      return { ok: true, value: v };
    case 'address_line':
      if (v.length > ADDRESS_LINE_MAX) {
        return {
          ok: false,
          code: 'INVALID_ADDRESS_LINE',
          message: `Location must be ${ADDRESS_LINE_MAX} characters or fewer`,
        };
      }
      return { ok: true, value: v };
    case 'contact_phone':
      if (
        v.length > CONTACT_PHONE_MAX ||
        !PHONE_RE.test(v) ||
        (v.match(/[0-9]/g) ?? []).length < 7
      ) {
        return {
          ok: false,
          code: 'INVALID_CONTACT_PHONE',
          message: 'Phone must be a phone number, e.g. (773) 555-0100',
        };
      }
      return { ok: true, value: v };
    case 'contact_email':
      if (v.length > CONTACT_EMAIL_MAX || !EMAIL_RE.test(v)) {
        return {
          ok: false,
          code: 'INVALID_CONTACT_EMAIL',
          message: 'Email must be an email address, e.g. hello@example.com',
        };
      }
      return { ok: true, value: v.toLowerCase() };
    case 'header_text':
      if (v.length > HEADER_TEXT_MAX) {
        return {
          ok: false,
          code: 'INVALID_HEADER_TEXT',
          message: `Header text must be ${HEADER_TEXT_MAX} characters or fewer`,
        };
      }
      return { ok: true, value: v };
  }
}

export const CARD_FIELDS: readonly CardField[] = [
  'display_name',
  'address_line',
  'contact_phone',
  'contact_email',
  'header_text',
];

// ── Presentation ──────────────────────────────────────────────────────────────

/** The public title: display_name when set, else the business name. */
export function sponsorTitle(s: { name: string; display_name?: string | null }): string {
  const d = typeof s.display_name === 'string' ? s.display_name.trim() : '';
  return d || s.name;
}

/**
 * The one rule for "this sponsor's card renders" (GET /sponsors/:id), as a SQL
 * boolean over a `sponsor_business sb` row. It is the card page's gate and the
 * resolver's test for whether to hand out a card_url, so a link can never point
 * at a card that 404s (OSE-1438: a Path 2 sponsor with no accepted placement
 * anywhere would otherwise get one).
 *
 * Organizer side uses the same source-aware rule as the resolver and the logo
 * route (ADR-019 amendment): silence is consent only for a placement the
 * organizer created; a sponsor_request needs organizer_accepted = 1.
 *
 * On show = an active placement, accepted by both sides, on an event whose
 * public page renders (RENDERABLE 'public' is 'active' only). A sponsor placed
 * only on a draft, ready or archived event is not on show. Deliberately NOT
 * is_published: an unlisted-but-active event page still shows its sponsors,
 * and their card links must work.
 */
export const SPONSOR_ON_SHOW_SQL = `(sb.is_active = 1 AND EXISTS (
  SELECT 1 FROM sponsor_placement sp_show
   WHERE sp_show.sponsor_business_id = sb.id AND sp_show.is_active = 1
     AND COALESCE(sp_show.organizer_accepted, CASE WHEN sp_show.source = 'sponsor_request' THEN 0 ELSE 1 END) = 1
     AND sp_show.sponsor_accepted = 1
     AND EXISTS (SELECT 1 FROM events e_show WHERE e_show.id = sp_show.event_id
                 AND e_show.brand_id = sb.brand_id AND e_show.status = 'active'
                 AND ${eventUsesSponsorsSql('e_show')})
))`;

/**
 * THE EVENT'S OWN YES (OSE-1900, owner 2026-11-09): sponsors show only if the
 * event chose them. This is the one gate, and every sponsor reader goes through
 * it, in one of three forms:
 *
 *   eventUsesSponsorsSql(alias)       a boolean over an `events` row the query
 *                                     already has in scope (default alias `e`)
 *   PLACEMENT_EVENT_USES_SPONSORS_SQL the same, for a query that has only the
 *                                     placement (`sp`) in scope
 *   SPONSOR_ON_SHOW_SQL / PLACEMENT_ON_SHOW_SQL, which include it
 *
 * The switch is `useSponsors` in events.settings_json, and it is opt-in: absent
 * means OFF (lib/event-settings.ts holds the key, that rule and the JSON SQL).
 * It comes before the two-sided placement consent and replaces neither side of
 * it: a placement shows when the event opted in AND the sponsor accepted AND
 * the organizer accepted. Turning the switch off hides every placement of the
 * event at once and deletes none.
 *
 * Who must use it: any statement that shows a sponsor on a public surface,
 * serves a sponsor's logo or creative, records a display or click, or offers
 * an event to a sponsor (lib/sponsor-discovery.ts). The Path 2 geo auto-match
 * in lib/sponsor-resolver.ts is dark (ADR-019) and sits behind the same gate.
 * tests/sponsor-opt-in-readers.spec.ts reads `src/` and fails when a statement
 * carries the consent rule without this gate.
 *
 * No tier is read here, and none may be: consent is never tier-gated
 * (invariant 7).
 */
export function eventUsesSponsorsSql(alias = 'e'): string {
  return useSponsorsSql(alias);
}

/** The gate for a query with only the placement (`sp`) in scope. */
export const PLACEMENT_EVENT_USES_SPONSORS_SQL = `EXISTS (
  SELECT 1 FROM events e_uses WHERE e_uses.id = sp.event_id AND ${eventUsesSponsorsSql('e_uses')})`;

/**
 * The same on-show rule per PLACEMENT, for counting (OSE-1468 dashboards). A
 * boolean over a row with `sp` (sponsor_placement), `sb` (its sponsor_business)
 * and `e` (its event) in scope: active placement, active business, sponsor
 * accepted, organizer accepted under the source-aware rule, live event, the
 * event in the sponsor's own brand (the schema does not enforce that; the card
 * does), and the event opted in to sponsors (OSE-1900, the gate above). Keep in
 * step with SPONSOR_ON_SHOW_SQL above; tests/dashboards.spec.ts pins the cases.
 */
export const PLACEMENT_ON_SHOW_SQL = `(sp.is_active = 1 AND sb.is_active = 1
  AND sp.sponsor_accepted = 1
  AND COALESCE(sp.organizer_accepted, CASE WHEN sp.source = 'sponsor_request' THEN 0 ELSE 1 END) = 1
  AND e.status = 'active' AND e.brand_id = sb.brand_id
  AND ${eventUsesSponsorsSql('e')})`;

/** The public card for a sponsor (no website → a tap lands here). */
export function sponsorCardPath(sponsorId: string): string {
  return `/sponsors/${encodeURIComponent(sponsorId)}`;
}

/** tel: href — digits and a leading + only, so the link dials what was shown. */
export function telHref(phone: string): string {
  const ext = phone.match(/(?:x|ext\.?)\s*([0-9]{1,6})\s*$/i);
  const main = (ext ? phone.slice(0, ext.index) : phone).replace(/[^0-9+]/g, '');
  return `tel:${main}${ext ? `;ext=${ext[1]}` : ''}`;
}

// ── The OSE default image ─────────────────────────────────────────────────────

export const SPONSOR_DEFAULT_LOGO_PATH = '/sponsor-default-logo.svg';

/**
 * The OSE default sponsor image: the platform's triangle (Events at the apex,
 * Sponsors and Customers at the base) on a neutral tile. Square, so it sits in
 * the compact side rail and letterboxes cleanly in a wide header slot. Static,
 * no script, no external reference; colours are fixed because an <img> cannot
 * read the page's design tokens. The same mark shows for every sponsor that
 * has no logo — it says "a sponsor, shown the OSE way", and the sponsor's own
 * title always sits beside it.
 */
export const SPONSOR_DEFAULT_LOGO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">' +
  '<title>OurSharedEvents sponsor</title>' +
  // A LIGHT tile, so it reads on dark TV and dark pages alike and prints as
  // a light mark rather than a block of ink on the poster.
  '<rect x="4" y="4" width="232" height="232" rx="36" fill="hsl(40 30% 97%)" ' +
  'stroke="hsl(222 15% 80%)" stroke-width="4"/>' +
  '<path d="M120 58 L182 166 L58 166 Z" fill="none" stroke="hsl(222 25% 35%)" ' +
  'stroke-width="10" stroke-linejoin="round"/>' +
  '<circle cx="120" cy="58" r="14" fill="hsl(32 80% 50%)"/>' +
  '<circle cx="58" cy="166" r="14" fill="hsl(205 65% 45%)"/>' +
  '<circle cx="182" cy="166" r="14" fill="hsl(150 45% 38%)"/>' +
  '<circle cx="120" cy="130" r="9" fill="hsl(222 25% 35%)"/>' +
  '</svg>';

/** Serve the default image. Same-origin, cached a day, locked down like /ui.css. */
export function sponsorDefaultLogoResponse(): Response {
  return new Response(SPONSOR_DEFAULT_LOGO_SVG, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
