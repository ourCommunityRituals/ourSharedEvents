/**
 * Sponsor Resolution Engine — pure business logic, no HTTP.
 *
 * Resolves which sponsors should appear for a given event using two paths:
 *   1. Direct: sponsor.event_id = eventId (legacy, always included)
 *   2. Template+Geo: matching template_id AND matching area (zip or radius)
 *
 * Surface filtering determines which placements each sponsor qualifies for.
 * All qualifying sponsors accumulate (rotation, never replacement).
 *
 * ─── Display priority (OSE-330 — Local Sponsor Covenant) ───────────────────
 * Two-level sort, locals-first:
 *   1. is_local=true sponsors (sorted by tier priority within the group)
 *   2. is_local=false sponsors (sorted by tier priority within the group)
 * No interleaving. A primary-tier local appears BEFORE a platinum-tier
 * non-local. This is the LITERAL mechanical implementation of the
 * Local Sponsor Covenant — see brain Invariant #5 + ADR-013 +
 * ocr-docs-brain/sponsor-allocation.yaml.
 *
 * Tier priority within each group: title(1) > platinum(2) > gold(3) >
 * silver(4) > bronze(5) > primary(6). Tier does NOT affect UX access OR
 * cross the local/non-local boundary.
 */

import { allocateShares, sovTierOf } from './sponsor-allocation';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface SponsorRow {
  id: string;
  event_id: string;
  name: string;
  logo_url: string | null;
  website_url: string | null;
  tier: string;
  placement_formats: string;
  click_token: string | null;
  impression_token: string | null;
  is_active: number;
  /**
   * Local-business classification (OSE-330 Phase 2). D1 returns SQLite
   * BOOLEAN as 0/1 integer. is_local=1 means the sponsor is a local
   * business and, under the Local Sponsor Covenant (OSE-661 / Invariant #25),
   * the is_local class collectively holds a rotation-frequency FLOOR
   * (>= local_floor_pct) via allocateShares — NOT a top-of-display rank (the
   * old locals-first tierSort is retired; see buildShareRotation below).
   * Defaults to 0 for existing sponsors (backward-compatible per migration 0036).
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
  eventId: string
): Promise<SponsorRow[]> {
  // Fetch event context: template_id and geo
  const event = await db
    .prepare('SELECT template_id, zip_code, lat, lon FROM events WHERE id = ?')
    .bind(eventId)
    .first<{
      template_id: string | null;
      zip_code: string | null;
      lat: number | null;
      lon: number | null;
    }>();

  if (!event) return [];

  // Path 1: Direct sponsors for this event
  const directResult = await db
    // ORDER BY id: give the direct query a stable, deterministic row order so
    // the equal-share tie-break in buildShareRotation is fed reproducible input.
    .prepare('SELECT * FROM sponsors WHERE event_id = ? AND is_active = 1 ORDER BY id')
    .bind(eventId)
    .all<SponsorRow>();

  const directSponsors = directResult.results ?? [];

  // Path 2: Template+Geo matching (only if event has a template)
  let templateGeoSponsors: SponsorRow[] = [];

  if (event.template_id) {
    // Find sponsors subscribed to this template
    const templateResult = await db
      .prepare(
        `SELECT s.* FROM sponsors s
         JOIN sponsor_event_types st ON s.id = st.sponsor_id
         WHERE st.template_id = ? AND st.is_active = 1 AND s.is_active = 1
         ORDER BY s.id`
      )
      .bind(event.template_id)
      .all<SponsorRow>();

    const candidateSponsors = templateResult.results ?? [];

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
      all.push(s);
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

/**
 * Build the full sponsor bundle for a surface.
 *
 * OSE-661 (#25): every active sponsor is eligible for every surface (uniform
 * placement); each surface bucket is the SAME covenant-share-ordered rotation.
 * Only rotation FREQUENCY (share) differs between sponsors — order carries no
 * size/slot/position meaning. Q3 rule: more sponsors = more rotation slots.
 */
export function buildSponsorBundle(sponsors: SponsorRow[]): SponsorBundle {
  const rotation = buildShareRotation(sponsors).map((r) => r.sponsor);

  const maxSlots = Math.max(rotation.length, 1);
  const rotationMs = Math.min(15000, Math.max(3000, 5000 * Math.ceil(maxSlots / 3)));

  return {
    sponsors: rotation,
    // Uniform: identical eligibility on every surface. Frequency is the only
    // differentiator (allocateShares), enforced by buildShareRotation.
    surface_sponsors: {
      posterTop: rotation,
      tvTop: rotation,
      tvSide: rotation,
      mobileBanner: rotation,
    },
    rotation_config: {
      sponsorSlots: maxSlots,
      rotationMs,
    },
  };
}
