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
 * Tier priority (display order only): title(1) > platinum(2) > gold(3) >
 * silver(4) > bronze(5) > primary(6). Tier does NOT affect UX access.
 */

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

// ─── Tier Priority ──────────────────────────────────────────────────────────────

const TIER_PRIORITY: Record<string, number> = {
  title: 1,
  platinum: 2,
  gold: 3,
  silver: 4,
  bronze: 5,
  primary: 6,
};

function tierSort(a: SponsorRow, b: SponsorRow): number {
  return (TIER_PRIORITY[a.tier] ?? 99) - (TIER_PRIORITY[b.tier] ?? 99);
}

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
    .prepare('SELECT * FROM sponsors WHERE event_id = ? AND is_active = 1')
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
         WHERE st.template_id = ? AND st.is_active = 1 AND s.is_active = 1`
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

  // Deduplicate by sponsor ID, then sort by tier
  const seen = new Set<string>();
  const all: SponsorRow[] = [];
  for (const s of [...directSponsors, ...templateGeoSponsors]) {
    if (!seen.has(s.id)) {
      seen.add(s.id);
      all.push(s);
    }
  }

  return all.sort(tierSort);
}

// ─── Surface Filtering ──────────────────────────────────────────────────────────

function parsePlacements(raw: string): Placements {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) return parsed as Placements;
  } catch {
    // fall through
  }
  return {};
}

/**
 * Filter sponsors for a specific rendering surface.
 *
 * - poster: posterTop only, NO clickable links (print-safe)
 * - display: tvTop or tvSide
 * - public: mobileBanner
 * - sharedReport: all sponsors (aggregate metrics only)
 */
export function filterSponsorsForSurface(sponsors: SponsorRow[], surface: Surface): SponsorRow[] {
  if (surface === 'sharedReport') return sponsors;

  return sponsors.filter((s) => {
    const p = parsePlacements(s.placement_formats);
    switch (surface) {
      case 'poster':
        return p.posterTop === true;
      case 'display':
        return p.tvTop === true || p.tvSide === true;
      case 'public':
        return p.mobileBanner === true;
      default:
        return false;
    }
  });
}

/**
 * Build the full sponsor bundle for a surface.
 *
 * Q3 rule: more sponsors = more rotation slots, never fewer.
 * Base rotation is 5s per sponsor; minimum 3s, maximum 15s.
 */
export function buildSponsorBundle(sponsors: SponsorRow[]): SponsorBundle {
  const posterTop = filterSponsorsForSurface(sponsors, 'poster');
  const tvTop = sponsors.filter((s) => parsePlacements(s.placement_formats).tvTop === true);
  const tvSide = sponsors.filter((s) => parsePlacements(s.placement_formats).tvSide === true);
  const mobileBanner = filterSponsorsForSurface(sponsors, 'public');

  const maxSlots = Math.max(posterTop.length, tvTop.length, tvSide.length, mobileBanner.length, 1);
  const rotationMs = Math.min(15000, Math.max(3000, 5000 * Math.ceil(maxSlots / 3)));

  return {
    sponsors,
    surface_sponsors: { posterTop, tvTop, tvSide, mobileBanner },
    rotation_config: {
      sponsorSlots: maxSlots,
      rotationMs,
    },
  };
}
