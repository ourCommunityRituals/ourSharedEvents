/**
 * Partner links between groups on one event (owner, 2026-11-28; migration 0128).
 *
 * HOW IT WORKS. The event's organizer invites another brand to one event, with
 * the name the page will show and a kind: 'partner', or 'co_host'. A public
 * body (a village, a park district, a library) is always a co-host, never a
 * sponsor. A member of the invited brand accepts or declines. Only while both
 * sides accept:
 *   - the event page says "Co-hosted with ..." or "With ..." under the host;
 *   - the partner brand can read the event's floored scan total, and nothing
 *     else of the event (handlers/event-partners.ts).
 * Either side can end the link by setting its own flag to 0.
 *
 * WHAT IS NEVER DONE. No person moves between the brands; the partner never
 * reads a per-stop count, a sign-up or a row; a declined or withdrawn link
 * shows nothing and reads nothing; the platform brand and the public brand are
 * never a partner (CHECK in the migration and here).
 *
 * Pure: no env, no DB.
 */

import { escapeHtml as esc } from './html-escape';
import { fmt } from './i18n/catalog';
import { isolateTyped } from './i18n/bidi';
import type { Lang } from './i18n/languages';

export type PartnerKind = 'co_host' | 'partner';

/** Brands that are never a partner (the platform and the shared public brand). */
export const NEVER_PARTNER = ['ose-platform', 'root'] as const;
export const PARTNER_NAME_MAX = 80;
/** A brand id as the platform writes one: lower-case words joined by `-` or `_`. */
const BRAND_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/**
 * SQL (a boolean) for "this link is on": both sides accept. `p` is the alias of
 * event_partners in the caller's statement. The one place the rule lives.
 */
export function partnerOnSql(p = 'p'): string {
  return `(${p}.organizer_accepted = 1 AND ${p}.partner_accepted = 1)`;
}

export interface PartnerInvite {
  partner_brand_id: string;
  partner_name: string;
  kind: PartnerKind;
  is_public_body: boolean;
}

export type InviteCheck = { ok: true; value: PartnerInvite } | { ok: false; error: string };

/**
 * Check an organizer's invite. `eventBrand` is the event's own brand: a brand
 * cannot partner with itself.
 */
export function validatePartnerInvite(body: unknown, eventBrand: string): InviteCheck {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return { ok: false, error: 'Body must be a JSON object' };
  const b = body as Record<string, unknown>;
  const brand = typeof b.partner_brand_id === 'string' ? b.partner_brand_id.trim() : '';
  if (!BRAND_ID_RE.test(brand)) return { ok: false, error: 'partner_brand_id is not a brand id' };
  if ((NEVER_PARTNER as readonly string[]).includes(brand))
    return { ok: false, error: 'That brand cannot be a partner' };
  if (brand === eventBrand)
    return { ok: false, error: 'An event cannot partner with its own brand' };
  const name = typeof b.partner_name === 'string' ? b.partner_name.trim() : '';
  if (name.length < 1 || name.length > PARTNER_NAME_MAX)
    return { ok: false, error: `partner_name must be 1 to ${PARTNER_NAME_MAX} characters` };
  if (b.is_public_body !== undefined && typeof b.is_public_body !== 'boolean')
    return { ok: false, error: 'is_public_body must be true or false' };
  const publicBody = b.is_public_body === true;
  if (b.kind !== undefined && b.kind !== 'co_host' && b.kind !== 'partner')
    return { ok: false, error: "kind must be 'co_host' or 'partner'" };
  // A public body is a co-host, never a sponsor-like partner.
  const kind: PartnerKind = publicBody ? 'co_host' : b.kind === 'co_host' ? 'co_host' : 'partner';
  return {
    ok: true,
    value: { partner_brand_id: brand, partner_name: name, kind, is_public_body: publicBody },
  };
}

/** A partner on show: what the page line needs, nothing else. */
export interface PartnerOnShow {
  name: string;
  kind: PartnerKind;
  is_public_body: boolean;
}

function nameOf(p: PartnerOnShow, lang: Lang): string {
  const name = isolateTyped(lang, esc(p.name));
  return p.is_public_body ? fmt(lang, 'partners.publicBody', { name }) : name;
}

/**
 * The line under "Hosted by": co-hosts first, then partners, each list joined
 * with commas. Empty when no partner is on show.
 */
export function renderPartnerLine(
  partners: PartnerOnShow[],
  testid: string,
  lang: Lang = 'en'
): string {
  if (partners.length === 0) return '';
  const co = partners.filter((p) => p.kind === 'co_host').map((p) => nameOf(p, lang));
  const with_ = partners.filter((p) => p.kind === 'partner').map((p) => nameOf(p, lang));
  const parts: string[] = [];
  if (co.length > 0) parts.push(fmt(lang, 'partners.coHostedWith', { names: co.join(', ') }));
  if (with_.length > 0) parts.push(fmt(lang, 'partners.with', { names: with_.join(', ') }));
  return `<p class="ose-meta" data-testid="${testid}">${parts.join(' · ')}</p>`;
}
