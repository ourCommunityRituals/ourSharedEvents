/**
 * OSE-1554 — the brand test matrix: fixture ids and brand set (PURE module).
 *
 * No `cloudflare:test` import here, so the route list and the self-check can read
 * it from any pool. The seeding half lives in `brand-matrix.ts`.
 *
 * Four brands, matching the GAS toolkit's fixed set (`createBrandTestMatrix`):
 *   root  the platform's public brand
 *   abc   a parent brand
 *   cbc   a brand under abc
 *   cbl   a second brand under abc
 * The parent link is a COMMENT only until the `brands` table lands (OSE-1553);
 * today the three are independent tenants, which is what isolation needs.
 *
 * Every id carries a `bm-<brand>-` marker so a leak is found by substring:
 * if brand A's caller gets a body containing `bm-cbc-`, that is brand B's data.
 */

export const BRAND_KEYS = ['root', 'abc', 'cbc', 'cbl'] as const;
export type BrandKey = (typeof BRAND_KEYS)[number];

/** The reserved platform brand (AUD-3): a member of it is not a member of any tenant. */
export const PLATFORM_MEMBER_BRAND = 'ose-platform';
export const PLATFORM_MEMBER_EMAIL = 'platform-member@example.com';

/**
 * `abc` holds six live events, the rest hold one, so the same fixture sits both
 * under and over the count floor of 5 (a roll-up that floors each brand before it
 * adds can be proven on it later).
 */
export const EXTRA_ACTIVE_EVENTS: Record<BrandKey, number> = {
  root: 0,
  abc: 5,
  cbc: 0,
  cbl: 0,
};

/** One shared H3 res-7 cell so the public map returns every brand's live event. */
export const FIXTURE_CELL = '872664c1affffff';

export interface BrandFx {
  key: BrandKey;
  brandId: string;
  ownerEmail: string;
  activeEventId: string;
  draftEventId: string;
  sponsorId: string;
  placementId: string;
  campaignId: string;
  posterDeploymentId: string;
  /** Substring present in every id/title/name this brand owns. */
  marker: string;
}

export function brandFx(key: BrandKey): BrandFx {
  return {
    key,
    brandId: key,
    ownerEmail: `owner-${key}@example.com`,
    activeEventId: `bm-${key}-active`,
    draftEventId: `bm-${key}-draft`,
    sponsorId: `bm-${key}-sponsor`,
    placementId: `spl_bm-${key}-sponsor`,
    campaignId: `bm-${key}-campaign`,
    posterDeploymentId: `bm-${key}-pd`,
    marker: `bm-${key}-`,
  };
}

export const BRANDS: readonly BrandFx[] = BRAND_KEYS.map(brandFx);

/** An id that exists nowhere, used to compare "not yours" against "does not exist". */
export const UNKNOWN_ID = 'bm-nobody-unknown';

/** ADMIN_BRAND_MEMBERSHIP for the whole matrix: one owner per brand + a platform member. */
export function membershipJson(): string {
  const map: Record<string, string[]> = {
    [PLATFORM_MEMBER_EMAIL]: [PLATFORM_MEMBER_BRAND],
  };
  for (const b of BRANDS) map[b.ownerEmail] = [b.brandId];
  return JSON.stringify(map);
}
