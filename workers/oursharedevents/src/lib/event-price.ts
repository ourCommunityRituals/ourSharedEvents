/**
 * OSE-655 "HOW MUCH" — event price display model.
 *
 * DISPLAY METADATA ONLY. These fields describe the event's own price
 * (organizer <-> attendee); they are NOT platform billing. Invariant #6
 * inert_monetization_hooks holds because nothing here processes a payment —
 * this module formats a string. No charge/debit/Stripe/checkout logic exists
 * or may be added; if a payment primitive is ever needed it lives elsewhere,
 * behind the monetization wall, never on this display path.
 *
 *   price_cents  0 = free, N = fixed price in cents, null = unset
 *   price_model  'free' | 'fixed' | 'sliding' | 'donation' | 'varies'
 *   price_note   optional qualifier for sliding/varies ("$5-15 suggested")
 *
 * The structured shape (vs free-text) makes price machine-readable for
 * affordability discovery + OER corridor-pricing analytics (aggregate, floored
 * per #7) while the enum keeps sliding-scale / pay-what-you-can events honest.
 */

import { msg } from './i18n/catalog';
import { DEFAULT_LANG, type Lang } from './i18n/languages';

export type PriceModel = 'free' | 'fixed' | 'sliding' | 'donation' | 'varies';

export const PRICE_MODELS: readonly PriceModel[] = [
  'free',
  'fixed',
  'sliding',
  'donation',
  'varies',
];

export interface EventPriceInput {
  price_cents: number | null;
  price_model: string | null;
  price_note: string | null;
}

/** Format cents as a compact dollar string: 1000 -> "$10", 1050 -> "$10.50". */
function formatCents(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

/**
 * Resolve the effective price model. Prefer an explicit valid `price_model`;
 * otherwise infer from `price_cents` (0 -> free, >0 -> fixed). Returns null when
 * genuinely unset (no model, no cents) so the caller renders no HOW MUCH card.
 */
export function resolvePriceModel(p: EventPriceInput): PriceModel | null {
  if (p.price_model && (PRICE_MODELS as readonly string[]).includes(p.price_model)) {
    return p.price_model as PriceModel;
  }
  if (p.price_cents === 0) return 'free';
  if (typeof p.price_cents === 'number' && p.price_cents > 0) return 'fixed';
  return null;
}

/**
 * Human-readable price for the HOW MUCH card. Returns null when unset (render
 * nothing — no broken card). The returned string is PLAIN TEXT; callers that
 * embed it in HTML MUST escape it (`price_note` is organizer-authored).
 */
export function formatEventPrice(p: EventPriceInput, lang: Lang = DEFAULT_LANG): string | null {
  const model = resolvePriceModel(p);
  if (model === null) return null;
  const note = (p.price_note || '').trim();
  const withNote = (base: string) => (note ? `${base} (${note})` : base);

  switch (model) {
    case 'free':
      return withNote(msg(lang, 'price.free'));
    case 'fixed':
      if (p.price_cents === 0) return withNote(msg(lang, 'price.free'));
      if (typeof p.price_cents === 'number' && p.price_cents > 0) {
        return withNote(formatCents(p.price_cents));
      }
      return null; // model 'fixed' with no amount is malformed -> no card
    case 'sliding':
      return withNote(msg(lang, 'price.sliding'));
    case 'donation':
      return withNote(msg(lang, 'price.donation'));
    case 'varies':
      return withNote(msg(lang, 'price.varies'));
    default:
      return null;
  }
}
