// ─── The public sponsor-bundle projection ──────────────────────────────────────
//
// OSE-2048. What `GET /api/v2/events/:id/sponsor-bundle` sends was, until this
// module, whatever the resolver's row happened to hold: the resolver spreads its
// row, the bundle carries the row, and the handler sent the bundle. A column
// added to the resolver's SELECT for any internal reason would have reached the
// public answer, and no test would have said so.
//
// This module makes the answer a decision, the same way
// `lib/public-event-projection.ts` does for an event: an allowlist, never a
// spread of the row. A field nobody decided to publish is absent by default.
//
// WHAT IS ON THE LIST. Exactly what a live answer carried on the day the list
// was written (2026-11-18), so no reader loses a field: this change locks the
// shape, it does not narrow it. Narrowing (the two admin-typed tokens, the row
// timestamps) is a contract change with readers to check, and is left as an
// open question on the ticket.
//
// Additions are decisions. tests/sponsor-bundle-field-list.spec.ts holds the
// same lists written out by hand, so adding or removing a name here fails that
// spec until the test is changed on purpose.

import type { SponsorBundle, SponsorRow } from './sponsor-resolver';

/** Fields every sponsor in the answer carries. */
const PUBLIC_SPONSOR_REQUIRED_FIELDS = [
  'id',
  'event_id',
  'name',
  'logo_url',
  'website_url',
  'tier',
] as const;

/**
 * Fields a sponsor may carry. A live answer carries every one except the three
 * noted, which each have their own condition.
 */
const PUBLIC_SPONSOR_OPTIONAL_FIELDS = [
  'display_name',
  'address_line',
  'header_text',
  'has_header_image',
  'sidebar_logo_url',
  'title',
  'placement_formats',
  'click_token',
  'display_token',
  'is_active',
  'is_local',
  'created_at',
  'updated_at',
  // Only when the sponsor's card page will render (OSE-1438).
  'card_url',
  // Only when a signing secret is set (OSE-1310). It holds an expiry in whole
  // seconds, so two answers a second apart differ here and nowhere else.
  'beacon_token',
  // Only when the placement is in a campaign on show (S14). Its own field list
  // is PUBLIC_SPONSOR_CAMPAIGN_FIELDS.
  'campaign',
] as const;

/** A sponsor's campaign: its id and its title, nothing else. */
const PUBLIC_SPONSOR_CAMPAIGN_FIELDS = ['id', 'title'] as const;

/** The bundle itself. */
const PUBLIC_SPONSOR_BUNDLE_FIELDS = ['sponsors', 'surface_sponsors', 'rotation_config'] as const;

/** The lists inside `surface_sponsors` (the names are kept for old readers). */
const PUBLIC_SPONSOR_SURFACE_FIELDS = ['posterTop', 'tvTop', 'tvSide', 'mobileBanner'] as const;

/** `rotation_config`. */
const PUBLIC_SPONSOR_ROTATION_FIELDS = ['sponsorSlots', 'rotationMs'] as const;

const PUBLIC_SPONSOR_FIELDS: readonly string[] = [
  ...PUBLIC_SPONSOR_REQUIRED_FIELDS,
  ...PUBLIC_SPONSOR_OPTIONAL_FIELDS,
];

const own = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

/** Copy the named fields that are present and defined; everything else is left behind. */
function pick(source: object, fields: readonly string[]): Record<string, unknown> {
  const from = source as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of fields) {
    if (own(from, key) && from[key] !== undefined) out[key] = from[key];
  }
  return out;
}

/** Reduce one sponsor to the fields a public answer may carry. */
export function toPublicSponsor(row: object): Record<string, unknown> {
  const out = pick(row, PUBLIC_SPONSOR_FIELDS);
  const campaign = out.campaign;
  if (campaign !== null && typeof campaign === 'object') {
    out.campaign = pick(campaign, PUBLIC_SPONSOR_CAMPAIGN_FIELDS);
  } else {
    delete out.campaign;
  }
  return out;
}

export interface PublicSponsorBundle {
  sponsors: Array<Record<string, unknown>>;
  surface_sponsors: Record<(typeof PUBLIC_SPONSOR_SURFACE_FIELDS)[number], unknown[]>;
  rotation_config: Record<string, unknown>;
}

/**
 * Reduce a whole bundle to its named fields. The bundle's lists share their
 * sponsor objects, so each sponsor is reduced once and the order of every list
 * is kept as it was.
 */
export function toPublicSponsorBundle(bundle: SponsorBundle): PublicSponsorBundle {
  const done = new Map<SponsorRow, Record<string, unknown>>();
  const one = (row: SponsorRow): Record<string, unknown> => {
    let out = done.get(row);
    if (!out) {
      out = toPublicSponsor(row);
      done.set(row, out);
    }
    return out;
  };
  const list = (rows: SponsorRow[] | undefined): Array<Record<string, unknown>> =>
    (rows ?? []).map(one);

  const surfaces = {} as PublicSponsorBundle['surface_sponsors'];
  for (const key of PUBLIC_SPONSOR_SURFACE_FIELDS) {
    surfaces[key] = list(bundle.surface_sponsors?.[key]);
  }

  return {
    sponsors: list(bundle.sponsors),
    surface_sponsors: surfaces,
    rotation_config: pick(bundle.rotation_config ?? {}, PUBLIC_SPONSOR_ROTATION_FIELDS),
  };
}

export {
  PUBLIC_SPONSOR_BUNDLE_FIELDS,
  PUBLIC_SPONSOR_CAMPAIGN_FIELDS,
  PUBLIC_SPONSOR_FIELDS,
  PUBLIC_SPONSOR_OPTIONAL_FIELDS,
  PUBLIC_SPONSOR_REQUIRED_FIELDS,
  PUBLIC_SPONSOR_ROTATION_FIELDS,
  PUBLIC_SPONSOR_SURFACE_FIELDS,
};
