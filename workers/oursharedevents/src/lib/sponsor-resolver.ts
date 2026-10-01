/**
 * Sponsor Resolution Engine — pure business logic, no HTTP.
 *
 * Resolves which sponsors should appear for a given event using two paths (OSE-799
 * split model — a "sponsor" is sponsor_business ⨝ sponsor_placement ⨝ sponsor_asset):
 *   1. Direct: an active sponsor_placement.event_id = eventId (always included)
 *   2. Template+Geo: a business subscribed to the event's template_id AND matching
 *      area (zip or radius) — an implicit placement is derived (Option A)
 *
 * Every ACTIVE sponsor is eligible for every surface UNIFORMLY (no named-slot
 * filtering) and all qualifying sponsors accumulate (rotation, never replacement).
 *
 * ─── Two-sided acceptance — ASYMMETRIC (0068 + ADR-019) ─────────────────────────
 * A placement is a relationship: Path 1 is organizer-initiated, Path 2 is
 * sponsor-initiated (they subscribed to the template). The two sides are held to
 * DIFFERENT bars, on purpose (ADR-019, "silence != consent"):
 *
 *   • SPONSOR side is STRICT: a sponsor renders ONLY on `sp.sponsor_accepted = 1`.
 *     Pending (NULL) and declined (0) BOTH stay off every public surface until the
 *     sponsor accepts on their own /sponsor page — a brand is never shown backing
 *     an event it did not opt into. (CCR-PR567 M4 replaced the old permissive
 *     COALESCE(sponsor_accepted, 1); there is no backfill — pending placements are
 *     dark until answered.)
 *   • ORGANIZER side is PERMISSIVE for placements the organizer CREATED:
 *     `COALESCE(sp.organizer_accepted, <1, or 0 when source='sponsor_request'>) = 1`.
 *     A sponsor-initiated request (sponsor discovery) is NOT organizer-created,
 *     so its silence is not consent: it renders only with organizer_accepted = 1
 *     (ADR-019 amendment 2026-09-30). Defence in depth beside its is_active = 0.
 *     Original note —
 *     silence reads as OK; the organizer hides a sponsor only by rejecting (0).
 *
 * A rejection is durable: Path 2 skips any business the organizer already
 * rejected for THIS event, so a declined match is not re-proposed on every
 * resolve. That is what lets Path 2 match generously — an unwanted sponsor costs
 * one tap, once.
 *
 * ─── Business lifecycle (0068) ──────────────────────────────────────────────────
 * BOTH paths require sb.is_active = 1. Deleting a sponsor soft-deletes the
 * BUSINESS; it used to cascade is_active = 0 onto placements while leaving
 * sponsor_business untouched, which meant Path 2 re-surfaced deleted businesses
 * forever and any new placement resurrected them on Path 1.
 *
 * ─── Covenant model (OSE-661 / Invariant #25) — the locals-first SORT is RETIRED ─
 * The old OSE-330 two-level "locals-first, then tier priority" DISPLAY SORT no
 * longer exists. Under #25 the Local Sponsor Covenant is a rotation-frequency
 * FLOOR, not a display rank: money buys frequency-share + report depth only —
 * never size, slot, position, or is_local status. The resolved list is ordered by
 * covenant SHARE (buildShareRotation → allocateShares, share desc with a stable id
 * tie-break); that order carries NO size/slot meaning (every entry renders
 * identically). A local is guaranteed a share FLOOR (never zeroed), but is NOT
 * forced ahead of a higher-share non-local. See brain Invariant #25 +
 * ocr-docs-brain/sponsor-allocation.yaml (the tierSort/named-slot path in
 * Invariant #5 was superseded by #25).
 */

import { allocateShares, sovTierOf } from './sponsor-allocation';
import { sponsorTitle, sponsorCardPath, SPONSOR_ON_SHOW_SQL } from './sponsor-card';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface SponsorRow {
  id: string;
  event_id: string;
  name: string;
  logo_url: string | null;
  /**
   * OSE-1317: the sidebar (square/compact) logo, sponsor_asset format
   * 'logo_compact' (migration 0081). Optional — a surface with a compact slot
   * prefers it and falls back to logo_url, then to the sponsor's name.
   */
  sidebar_logo_url?: string | null;
  /**
   * 0083 public card. display_name is the optional public title (the resolver's
   * public seam folds it into `title`); address_line is the sponsor-entered
   * public location. Contact lives on the card page only, not in the bundle.
   */
  display_name?: string | null;
  address_line?: string | null;
  /** Public title: display_name, else name. Set at the public seam. */
  title?: string;
  /** Where a tap goes when there is no https website. Set at the public seam. */
  card_url?: string;
  website_url: string | null;
  tier: string;
  placement_formats: string;
  click_token: string | null;
  display_token: string | null;
  is_active: number;
  /**
   * Local-business classification (0/1). OSE-799 (A2): this is the resolver's
   * mapping of sponsor_placement.locality_band (persisted, geo-derived at
   * attachment) — the SINGLE seam that feeds the allocator's is_local boolean, so
   * allocateShares() is untouched and the #25 local-floor is preserved. For a
   * template-matched business with no persisted placement it is derived at read
   * time from business.h3_res7 vs event.h3_res7. Under the Local Sponsor Covenant
   * (OSE-661 / Invariant #25) the is_local class collectively holds a
   * rotation-frequency FLOOR (>= local_floor_pct) via allocateShares — NOT a
   * top-of-display rank (see buildShareRotation).
   */
  is_local: number;
  created_at: string;
  updated_at: string;
}

export interface Placements {
  posterTop?: boolean;
  tvTop?: boolean;
  tvSide?: boolean;
  mobileBanner?: boolean;
}

export type Surface = 'poster' | 'display' | 'public' | 'sharedReport';

export interface SponsorBundle {
  sponsors: SponsorRow[];
  surface_sponsors: {
    posterTop: SponsorRow[];
    tvTop: SponsorRow[];
    tvSide: SponsorRow[];
    mobileBanner: SponsorRow[];
  };
  rotation_config: {
    sponsorSlots: number;
    rotationMs: number;
  };
}

// ─── Covenant ordering (OSE-661 / Invariant #25) ─────────────────────────────
//
// The OSE-330 locals-first `tierSort` priority sort is RETIRED. Under the share
// covenant (#25, ratified 2026-08-08), the local guarantee is a FLOOR in
// rotation frequency (allocateShares), NOT a rank: a premium non-local may be
// seen MORE often than a local, so long as the is_local class holds its floor
// (≥ local_floor_pct) and no tier exceeds its cap. Ordering is therefore by
// covenant SHARE (buildShareRotation), and size/slot/position are uniform —
// only frequency is purchasable. The "local stays in" brand promise survives as
// the floor; its mechanism changed from priority-sort to share-floor. See the
// project memory (project-sponsor-covenant-local-floor) + OSE-661.

// ─── Geo Helpers ────────────────────────────────────────────────────────────────

/**
 * Haversine distance in miles between two lat/lon points.
 */
function haversineDistanceMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8; // Earth radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * OSE-1317: the website a public surface may link to — https:// only, else null
 * (the surface then renders the name without a link). Never javascript:, data:,
 * http:, or an unparseable string.
 */
export function publicWebsiteUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || raw.length > 500) return null;
  try {
    return new URL(raw).protocol === 'https:' ? raw : null;
  } catch {
    return null;
  }
}

/** A resolver row before the public seam: has_card is SPONSOR_ON_SHOW_SQL (0/1). */
type CardableRow = SponsorRow & { has_card: number };

// ─── Core Resolution ────────────────────────────────────────────────────────────

/**
 * Resolve all sponsors that should appear for a given event.
 *
 * Path 1 (Direct): sponsors.event_id = eventId — always included.
 * Path 2 (Template+Geo): sponsor has matching template_id via sponsor_event_types
 *   AND a matching area via sponsor_areas (zip match or within radius).
 *   Both conditions required for template-based sponsors.
 *
 * Returns deduplicated list sorted by tier priority.
 */
export async function resolveSponsorsForEvent(
  db: D1Database,
  eventId: string,
  opts: { geoMatchEnabled?: boolean } = {}
): Promise<SponsorRow[]> {
  // Fetch event context: brand_id (Path-2 tenant fence, INV #9), template_id,
  // geo, and corridor cell (h3_res7) for the OSE-799 locality_band derivation.
  const event = await db
    .prepare('SELECT brand_id, template_id, zip_code, lat, lon, h3_res7 FROM events WHERE id = ?')
    .bind(eventId)
    .first<{
      brand_id: string;
      template_id: string | null;
      zip_code: string | null;
      lat: number | null;
      lon: number | null;
      h3_res7: string | null;
    }>();

  if (!event) return [];

  // ── OSE-799 A2: read the split model ──
  // A "sponsor row" for an event is now a JOIN: identity from sponsor_business,
  // logo from sponsor_asset (format='logo'), per-event economics from
  // sponsor_placement. is_local is derived from placement.locality_band (the
  // allocator's boolean contract is preserved via this single mapping seam).
  // `id` is the sponsor_business id (the durable identity — the dedup + rotation
  // + tie-break key), NOT the placement id.
  const SELECT_PLACEMENT_ROW = `
    sb.id AS id,
    sp.event_id AS event_id,
    sb.name AS name,
    sb.display_name AS display_name,
    sb.address_line AS address_line,
    la.url AS logo_url,
    lc.url AS sidebar_logo_url,
    sb.website_url AS website_url,
    sp.tier AS tier,
    '[]' AS placement_formats,
    sp.click_token AS click_token,
    sp.display_token AS display_token,
    sp.is_active AS is_active,
    COALESCE(sp.locality_band, 0) AS is_local,
    sp.created_at AS created_at,
    sp.updated_at AS updated_at,
    ${SPONSOR_ON_SHOW_SQL} AS has_card`;

  // Path 1: Direct placements for this event (source organizer|corridor_covenant|
  // platform_seed). ORDER BY sb.id: stable, deterministic input for the
  // equal-share tie-break in buildShareRotation.
  const directResult = await db
    .prepare(
      `SELECT ${SELECT_PLACEMENT_ROW}
       FROM sponsor_placement sp
       JOIN sponsor_business sb ON sb.id = sp.sponsor_business_id
       LEFT JOIN sponsor_asset la ON la.sponsor_business_id = sb.id AND la.format = 'logo'
       LEFT JOIN sponsor_asset lc ON lc.sponsor_business_id = sb.id AND lc.format = 'logo_compact'
       WHERE sp.event_id = ? AND sp.is_active = 1
         AND sb.is_active = 1
         AND COALESCE(sp.organizer_accepted, CASE WHEN sp.source = 'sponsor_request' THEN 0 ELSE 1 END) = 1
         AND sp.sponsor_accepted = 1
       ORDER BY sb.id`
    )
    .bind(eventId)
    .all<CardableRow>();

  const directSponsors = directResult.results ?? [];

  // Path 2: Template+Geo matching (only if event has a template).
  // A business subscribed to the event's template appears WITHOUT a persisted
  // placement on THIS event (Option A, behavior-preserving). We derive an implicit
  // placement: locality_band from business.h3_res7 vs event.h3_res7, no tokens, and
  // — to preserve the pre-split behavior where the single `sponsors` row carried
  // the sponsor's tier — the tier of the business's most recent real placement
  // (falling back to 'standard' for a business that has none yet). Materializing
  // these as real placement rows is tracked separately — see OSE-799 follow-up.
  let templateGeoSponsors: CardableRow[] = [];

  // Path 2 is DARK-AT-LAUNCH (ADR-019 / CCR-PR567 M4): it renders a business that
  // only SUBSCRIBED to the event's template, with NO per-event accepted placement
  // — consideration, not per-event consent. Gated OFF by default; enable
  // post-launch via env SPONSOR_GEO_MATCH_ENABLED (threaded through opts).
  if (opts.geoMatchEnabled && event.template_id) {
    // Find businesses subscribed to this template (identity + logo + corridor cell
    // + the representative tier from their latest placement).
    const templateResult = await db
      .prepare(
        `SELECT sb.id AS id, sb.name AS name, sb.display_name AS display_name,
                sb.address_line AS address_line, sb.website_url AS website_url,
                sb.h3_res7 AS h3_res7, la.url AS logo_url,
                ${SPONSOR_ON_SHOW_SQL} AS has_card,
                (SELECT lc.url FROM sponsor_asset lc WHERE lc.sponsor_business_id = sb.id
                  AND lc.format = 'logo_compact') AS sidebar_logo_url,
                COALESCE((SELECT sp2.tier FROM sponsor_placement sp2
                  WHERE sp2.sponsor_business_id = sb.id
                  ORDER BY sp2.created_at DESC, sp2.id DESC LIMIT 1), sb.tier) AS tier
         FROM sponsor_business sb
         JOIN sponsor_event_types st ON st.sponsor_id = sb.id
         LEFT JOIN sponsor_asset la ON la.sponsor_business_id = sb.id AND la.format = 'logo'
         WHERE st.template_id = ? AND st.is_active = 1
           AND sb.is_active = 1
           AND sb.brand_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM sponsor_placement spx
              WHERE spx.sponsor_business_id = sb.id
                AND spx.event_id = ?
                AND (spx.organizer_accepted = 0 OR spx.sponsor_accepted = 0)
           )
         ORDER BY sb.id`
      )
      .bind(event.template_id, event.brand_id, eventId)
      .all<{
        id: string;
        name: string;
        display_name: string | null;
        address_line: string | null;
        website_url: string | null;
        h3_res7: string | null;
        logo_url: string | null;
        sidebar_logo_url: string | null;
        tier: string | null;
        has_card: number;
      }>();

    // Derive an implicit placement SponsorRow per template-matched business.
    const candidateSponsors: CardableRow[] = (templateResult.results ?? []).map((b) => ({
      id: b.id,
      event_id: eventId,
      name: b.name,
      display_name: b.display_name,
      address_line: b.address_line,
      logo_url: b.logo_url,
      sidebar_logo_url: b.sidebar_logo_url,
      website_url: b.website_url,
      tier: b.tier ?? 'standard',
      placement_formats: '[]',
      click_token: null,
      display_token: null,
      is_active: 1,
      // locality_band derived: local iff sponsor + event share the corridor cell.
      is_local: b.h3_res7 && event.h3_res7 && b.h3_res7 === event.h3_res7 ? 1 : 0,
      created_at: '',
      updated_at: '',
      has_card: b.has_card,
    }));

    // Geo filter: each candidate must have at least one matching area
    if (
      candidateSponsors.length > 0 &&
      (event.zip_code || (event.lat !== null && event.lon !== null))
    ) {
      for (const sponsor of candidateSponsors) {
        const areasResult = await db
          .prepare('SELECT * FROM sponsor_areas WHERE sponsor_id = ?')
          .bind(sponsor.id)
          .all<{
            zip_code: string | null;
            lat: number | null;
            lon: number | null;
            radius_miles: number;
          }>();

        const areas = areasResult.results ?? [];

        // No areas defined = no geo restriction (template match alone is sufficient)
        if (areas.length === 0) {
          templateGeoSponsors.push(sponsor);
          continue;
        }

        const matches = areas.some((area) => {
          // Zip code match
          if (area.zip_code && event.zip_code && area.zip_code === event.zip_code) {
            return true;
          }
          // Radius match
          if (area.lat !== null && area.lon !== null && event.lat !== null && event.lon !== null) {
            const dist = haversineDistanceMiles(area.lat, area.lon, event.lat, event.lon);
            return dist <= (area.radius_miles ?? 10);
          }
          return false;
        });

        if (matches) {
          templateGeoSponsors.push(sponsor);
        }
      }
    } else if (candidateSponsors.length > 0) {
      // Event has no geo — include all template-matched sponsors (no geo filtering)
      templateGeoSponsors = candidateSponsors;
    }
  }

  // Deduplicate by sponsor ID.
  const seen = new Set<string>();
  const all: SponsorRow[] = [];
  for (const s of [...directSponsors, ...templateGeoSponsors]) {
    if (!seen.has(s.id)) {
      seen.add(s.id);
      // OSE-1317: an outbound link renders only for an https:// website. Writes
      // are validated, but a row stored before that rule (or seeded directly)
      // is normalised here, at the one seam every public surface reads through.
      // 0083: the public title and the no-website tap target are decided here
      // too, once, so no surface re-derives them.
      // OSE-1438: card_url only when the card will render (SPONSOR_ON_SHOW_SQL,
      // the card page's own gate). A Path 2 match with no accepted placement on
      // any active event has no card, so it gets no card_url and renders unlinked
      // when it has no website. has_card is internal and never leaves the seam.
      const { has_card, ...row } = s;
      all.push({
        ...row,
        website_url: publicWebsiteUrl(s.website_url),
        title: sponsorTitle(s),
        ...(Number(has_card) === 1 ? { card_url: sponsorCardPath(s.id) } : {}),
      });
    }
  }

  // OSE-661 (#25): order by covenant rotation SHARE, not locals-first priority.
  return buildShareRotation(all).map((r) => r.sponsor);
}

// ─── Surface Filtering ──────────────────────────────────────────────────────────

/**
 * Filter sponsors for a rendering surface.
 *
 * OSE-661 (#25): placement is UNIFORM — every active sponsor is eligible for
 * every surface. Surface distinctions are RENDERING-only (e.g. poster = no
 * clickable links, print-safe), never a membership / size / slot / position
 * purchase. The old placement_formats slot filter (posterTop/tvTop/tvSide/
 * mobileBanner) is retired — it was the #25 violation (buying a named slot).
 * `surface` is retained in the signature for call-site compatibility.
 */
export function filterSponsorsForSurface(sponsors: SponsorRow[], _surface: Surface): SponsorRow[] {
  return sponsors;
}

// ─── OSE-661: Covenant share rotation (Invariant #25) ─────────────────────────
//
// The ADDITIVE replacement for the spend-visible tier-priority sort + named-slot
// filtering. Under the covenant, every ACTIVE sponsor is eligible for every
// surface UNIFORMLY — no size, slot, or position differentiation. Only rotation
// FREQUENCY varies, computed by allocateShares() under the capped + locally-
// floored share model. Surfaces migrate to this seam; the old tierSort/
// filterSponsorsForSurface path is retired once every surface has flipped.
//
// This is the single covenant seam consumed by BOTH the backend renderer and
// (via sovTierOf) the admin authoring form — one source of truth for the wall.

export interface RotationEntry {
  sponsor: SponsorRow;
  /** Percent of rotation impressions — the ONLY purchasable dimension (WALL 3). */
  sharePct: number;
}

/**
 * Build the covenant frequency rotation for a set of resolved sponsors. Pure.
 *
 * - Only is_active sponsors participate.
 * - Every participant is eligible for the surface (uniform placement); the
 *   surface is NOT chosen per-sponsor (that was the #25 violation).
 * - sharePct comes from allocateShares() → cap (premium/mid) + local floor hold.
 * - Sorted by share desc for a deterministic rotation order; order carries NO
 *   size/slot meaning (all entries render identically — frequency is the only
 *   differentiator).
 */
export function buildShareRotation(sponsors: SponsorRow[]): RotationEntry[] {
  const active = sponsors.filter((s) => s.is_active === 1);
  if (active.length === 0) return [];
  const alloc = allocateShares(
    active.map((s) => ({ id: s.id, tier: sovTierOf(s.tier), is_local: s.is_local === 1 }))
  );
  const byId = new Map(alloc.map((a) => [a.id, a.sharePct]));
  return (
    active
      .map((s) => ({ sponsor: s, sharePct: byId.get(s.id) ?? 0 }))
      // Share desc, then a deterministic secondary tie-break by id. The floor is
      // split EVENLY across locals and equal-weight tiers water-fill equally
      // (allocateShares), so equal sharePct ties are common; without the id
      // tie-break their order fell to D1 physical row order (the SELECTs below
      // had no ORDER BY) and flipped between calls — a nondeterministic covenant
      // rotation. Shares within 1e-9 are treated as tied (float water-fill can
      // differ at ~1e-14 by input order) so the id order is the stable decider.
      .sort((a, b) => {
        const d = b.sharePct - a.sharePct;
        if (Math.abs(d) > 1e-9) return d;
        return a.sponsor.id < b.sponsor.id ? -1 : a.sponsor.id > b.sponsor.id ? 1 : 0;
      })
  );
}

// ─── Deterministic seeded shuffle (OSE-1138 · Invariant #25 · COST-101) ──────
// The display ORDER must carry no tier/share meaning — a fixed first/top slot is
// position-prominence, and #25 forbids buying size/slot/position. So sponsors are
// SHUFFLED, never share-sorted, on the rendered surfaces. But the runtime is
// deterministic by doctrine (COST-101 — no Math.random on any path): identical
// (sponsors, seed) MUST yield an identical order so the covenant is reproducible
// across the edge fleet and testable. We therefore shuffle with a PRNG SEEDED off
// the event id — "randomly displayed," but a seeded, verifiable random.
function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}
function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic Fisher–Yates shuffle keyed off `seed` (COST-101: no RNG). */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const arr = items.slice();
  const rand = mulberry32(xmur3(seed || 'ose-covenant')());
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = t;
  }
  return arr;
}

// How many rotation slots the covenant shares are apportioned across on a temporal
// surface. 20 lets premium(7)/mid(3)/base(1) land clean integer counts in the
// common case while keeping the sidebar cycle a sane length.
const ROTATION_GRANULARITY = 20;

/**
 * Frequency-weighted, randomly-ordered rotation sequence for a TEMPORAL surface
 * (the TV sidebar cycles one slot at a time). This is where "the right to buy
 * more visibility" becomes real: a sponsor's NUMBER OF SLOTS is proportional to
 * its covenant share (allocateShares → sharePct: premium 7 / mid 3 / base 1,
 * `is_local` floored at 30%, premium/mid capped), so a premium sponsor's logo
 * comes up MORE OFTEN over time. Slots are apportioned by largest-remainder
 * (Hamilton) so integer counts track the shares closely and the local floor
 * survives rounding; every active sponsor gets ≥ 1 slot (min-presence — never
 * zeroed). The sequence is then seeded-SHUFFLED so ORDER carries no meaning
 * (#25: only frequency is purchasable, never position). Deterministic per seed.
 */
export function buildWeightedRotation(entries: RotationEntry[], seed: string): SponsorRow[] {
  if (entries.length === 0) return [];
  if (entries.length === 1) return [entries[0]!.sponsor];

  const base = entries.map((e) => {
    const exact = (e.sharePct / 100) * ROTATION_GRANULARITY;
    const slots = Math.max(1, Math.floor(exact)); // min-presence floor: ≥ 1 each
    return { sponsor: e.sponsor, slots, frac: exact - Math.floor(exact) };
  });
  let used = base.reduce((a, b) => a + b.slots, 0);
  // At least GRANULARITY slots, but never fewer than one-per-sponsor.
  const target = Math.max(ROTATION_GRANULARITY, base.length);
  // Hand the leftover slots to the largest fractional remainders (Hamilton).
  const byFrac = base.slice().sort((a, b) => b.frac - a.frac);
  for (let k = 0; used < target; k++, used++) byFrac[k % byFrac.length]!.slots += 1;

  const sequence: SponsorRow[] = [];
  for (const b of base) for (let i = 0; i < b.slots; i++) sequence.push(b.sponsor);
  return seededShuffle(sequence, seed);
}

/**
 * Build the full sponsor bundle for a surface.
 *
 * OSE-661 / OSE-1138 (#25): every active sponsor is eligible for every surface
 * (uniform size/slot). What differs is expressed on two orthogonal, non-positional
 * axes only:
 *   • FREQUENCY — the purchasable axis. On a temporal surface (TV sidebar), a
 *     higher-share sponsor gets MORE rotation slots (buildWeightedRotation), so it
 *     is seen more often over time. The `is_local` floor + premium/mid caps ride
 *     in via allocateShares → sharePct.
 *   • ORDER — carries NO meaning: every surface is seeded-SHUFFLED off the event
 *     id, so no sponsor holds a fixed first/top position (#25: position is not
 *     purchasable). "Randomly displayed," deterministically (COST-101).
 * Snapshot surfaces (poster / TV banner / mobile — all sponsors visible at once)
 * show each sponsor ONCE, shuffled; frequency can't apply to a simultaneous view,
 * and duplicating there would be simultaneous repetition = prominence.
 * The posterTop/tvTop/tvSide/mobileBanner keys remain for response-schema
 * stability (Invariant #16); #2's named-slot filter and #5's tier sort stay RETIRED.
 *
 * `seed` is the event id — same event renders the same order everywhere; a bare
 * call falls back to a stable covenant seed so the function is still pure.
 */
export function buildSponsorBundle(sponsors: SponsorRow[], seed = ''): SponsorBundle {
  const entries = buildShareRotation(sponsors); // unique, sharePct, #25 walls enforced
  const unique = entries.map((e) => e.sponsor);

  // Snapshot surfaces: each sponsor once, order shuffled (position carries no meaning).
  const snapshot = seededShuffle(unique, seed);
  // Temporal surface (sidebar cycle): frequency-weighted + shuffled.
  const temporal = buildWeightedRotation(entries, seed);

  const maxSlots = Math.max(temporal.length, 1);
  const rotationMs = Math.min(15000, Math.max(3000, 5000 * Math.ceil(maxSlots / 3)));

  return {
    sponsors: snapshot,
    surface_sponsors: {
      posterTop: snapshot,
      tvTop: snapshot,
      tvSide: temporal,
      mobileBanner: snapshot,
    },
    rotation_config: {
      sponsorSlots: maxSlots,
      rotationMs,
    },
  };
}
