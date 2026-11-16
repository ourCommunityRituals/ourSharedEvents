/**
 * campaigns.ts: the rules for a campaign an organizer can use (showcase S14).
 *
 * A campaign is a brand's named group of sponsor placements across its events
 * (table `campaigns`, migration 0039; `sponsor_placement.campaign_id`, 0067).
 * An event can be in one campaign too (`events.campaign_id`, 0110, OSE-1552).
 * A partner that backs a whole showcase station is a campaign across that
 * station's events (owner, 2026-11-12). It has a title and a status, and it
 * lives in exactly one brand.
 *
 * Three rules live here, each with a test that fails without it
 * (tests/campaigns.spec.ts):
 *
 *   1. Brand wall. A placement joins a campaign only when the placement's event
 *      and the campaign are in the same brand. The predicate is in the UPDATE
 *      itself, so no caller, the automation key included, can cross it.
 *   2. Consent. A campaign is public only through a placement that is on show:
 *      the event opted in, the sponsor accepted and the organizer accepted
 *      (PLACEMENT_ON_SHOW_SQL, the per-placement form of SPONSOR_ON_SHOW_SQL).
 *   3. Never a filter. Nothing here, and no route, selects, searches or sorts
 *      by a campaign's title, the same as a sponsor's name. Lists are ordered by
 *      creation time only.
 *
 * The event link follows rule 1 and is not public: an event joins a campaign
 * only in its own brand (the predicate is in the UPDATE), and no public read
 * names an event's campaign.
 *
 * TWO LINKS, STORED APART, AND THE EVENT'S WINS WHEN READ (OSE ADR-030 D8, owner
 * 2026-11-15). A placement's campaign (`sponsor_placement.campaign_id`) and its
 * event's campaign (`events.campaign_id`) are separate columns, and no statement
 * copies one onto the other. When a campaign is READ for a placement, the event's
 * campaign wins: the placement's own value counts only while its event is in
 * none (EFFECTIVE_CAMPAIGN_ID_SQL). Nothing stored is lost: take the event out
 * and the placement's own campaign is read again.
 *
 * THE LOCALS STILL APPLY (ADR-030 D9, owner 2026-11-15). A campaign is a label on
 * a sponsor the bundle already shows. It is never an input to which sponsors
 * show, their order or their share of rotation.
 *
 * No tier is read: scoping and consent are the same at every tier (invariant 7).
 */

import { PLACEMENT_ON_SHOW_SQL } from './sponsor-card';

export const CAMPAIGN_TITLE_MAX = 120;
export const CAMPAIGN_STATUSES = ['active', 'paused', 'completed'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/** The only fields a create accepts. `brand_id` names where it is created. */
export const CAMPAIGN_CREATE_FIELDS: readonly string[] = ['title', 'status', 'brand_id'];

/** The only fields an update accepts. The brand is set at create and never changed. */
export const CAMPAIGN_UPDATE_FIELDS: readonly string[] = ['title', 'status'];

/** Most campaigns one list call returns (newest first). */
export const CAMPAIGN_LIST_MAX = 500;

/** Most events one campaign's member list returns (earliest start first). */
export const CAMPAIGN_EVENT_LIST_MAX = 500;

export interface CampaignRow {
  id: string;
  brand_id: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
}

/** What a public surface may know about a campaign: its id and its title. */
export interface PublicCampaign {
  id: string;
  title: string;
}

/**
 * The id of the campaign a placement is read as in (ADR-030 D8). It expects
 * three aliases in the statement that uses it:
 *
 *   e    the placement's event
 *   sp   the placement
 *   ec   the event's own campaign, joined ONLY on the brand match:
 *        LEFT JOIN campaigns ec ON ec.id = e.campaign_id AND ec.brand_id = e.brand_id
 *
 *   - The event's campaign, when the event is in one AND that campaign is in the
 *     event's own brand. A paused or completed event campaign still wins here:
 *     the caller's own status rule then decides whether it is announced, and the
 *     placement's own campaign does not step in for it.
 *   - Otherwise the placement's own campaign. An event linked past the API to
 *     another brand's campaign counts as an event in none (`ec` is then NULL).
 *
 * The caller still joins `campaigns c` on this id AND on `c.brand_id = e.brand_id`:
 * this picks which link is read, it does not prove the brand of the result.
 *
 * The `ec` join is written out in each statement, not folded in here, so that
 * each read of `campaigns` sits beside the bound event id of its own statement,
 * where the tenant-isolation scan reads it. No exemption is needed for it.
 */
export const EFFECTIVE_CAMPAIGN_ID_SQL = 'COALESCE(ec.id, sp.campaign_id)';

export type FieldResult<T> = { ok: true; value: T } | { ok: false; code: string; message: string };

/** A campaign title: one line of plain text, 1 to CAMPAIGN_TITLE_MAX characters. */
export function checkCampaignTitle(raw: unknown): FieldResult<string> {
  if (typeof raw !== 'string') {
    return { ok: false, code: 'MISSING_TITLE', message: 'title is required' };
  }
  // One line: runs of whitespace (newlines included) collapse to a space.
  const v = raw.replace(/\s+/g, ' ').trim();
  if (v === '') return { ok: false, code: 'MISSING_TITLE', message: 'title is required' };
  if (v.length > CAMPAIGN_TITLE_MAX) {
    return {
      ok: false,
      code: 'INVALID_TITLE',
      message: `title must be ${CAMPAIGN_TITLE_MAX} characters or fewer`,
    };
  }
  return { ok: true, value: v };
}

/** A campaign status. Absent means 'active' (the column default). */
export function checkCampaignStatus(raw: unknown): FieldResult<CampaignStatus> {
  if (raw === undefined) return { ok: true, value: 'active' };
  if (typeof raw !== 'string' || !(CAMPAIGN_STATUSES as readonly string[]).includes(raw)) {
    return {
      ok: false,
      code: 'INVALID_STATUS',
      message: `status must be one of: ${CAMPAIGN_STATUSES.join(', ')}`,
    };
  }
  return { ok: true, value: raw as CampaignStatus };
}

/** `cmp_<uuid>`: 40 characters of [A-Za-z0-9_-], which is what ourWKRP's creator file accepts. */
export function newCampaignId(): string {
  return `cmp_${crypto.randomUUID()}`;
}

/**
 * The campaign of each sponsor that is on show for this event, keyed by sponsor
 * (sponsor_business) id. This is the only public read of a campaign.
 *
 * The campaign read is the placement's EFFECTIVE one: its event's campaign when
 * the event is in one, else its own (EFFECTIVE_CAMPAIGN_ID_SQL, ADR-030 D8).
 *
 * A row comes back only when ALL of these hold:
 *   - the placement is on show (PLACEMENT_ON_SHOW_SQL: active placement and
 *     business, sponsor accepted, organizer accepted, live event in the
 *     sponsor's own brand, and the event opted in to sponsors);
 *   - the campaign is in the event's brand (a mislinked row never shows);
 *   - the campaign is active (a paused or completed campaign is not announced).
 */
export async function readShownPlacementCampaigns(
  db: D1Database,
  eventId: string
): Promise<Map<string, PublicCampaign>> {
  const res = await db
    .prepare(
      `SELECT sp.sponsor_business_id AS sponsor_id, c.id AS id, c.title AS title
         FROM sponsor_placement sp
         JOIN sponsor_business sb ON sb.id = sp.sponsor_business_id
         JOIN events e ON e.id = sp.event_id
         LEFT JOIN campaigns ec ON ec.id = e.campaign_id AND ec.brand_id = e.brand_id
         JOIN campaigns c ON c.id = ${EFFECTIVE_CAMPAIGN_ID_SQL}
        WHERE sp.event_id = ?
          AND c.brand_id = e.brand_id
          AND c.status = 'active'
          AND ${PLACEMENT_ON_SHOW_SQL}`
    )
    .bind(eventId)
    .all<{ sponsor_id: string; id: string; title: string }>();
  const out = new Map<string, PublicCampaign>();
  for (const r of res.results ?? []) out.set(r.sponsor_id, { id: r.id, title: r.title });
  return out;
}

export type PlacementCampaignResult =
  | { ok: true; event_id: string }
  | { ok: false; code: 'CAMPAIGN_NOT_FOUND' | 'PLACEMENT_NOT_FOUND' };

function brandClause(brandIds: readonly string[] | null, col: string) {
  if (!brandIds) return { sql: '', params: [] as string[] };
  return { sql: ` AND ${col} IN (${brandIds.map(() => '?').join(', ')})`, params: [...brandIds] };
}

/**
 * Put a placement in a campaign. `brandIds` is the caller's server-derived
 * brand list, or null for the automation scope that sees every brand.
 *
 * The same-brand rule is in the UPDATE's WHERE (the placement's event and the
 * campaign share a brand), so it holds for every caller. A placement that is
 * unknown, in another brand than the campaign, or outside the caller's brands
 * is the same PLACEMENT_NOT_FOUND, and nothing is written.
 */
export async function attachPlacementToCampaign(
  db: D1Database,
  campaignId: string,
  placementId: string,
  brandIds: readonly string[] | null
): Promise<PlacementCampaignResult> {
  const scope = brandClause(brandIds, 'brand_id');
  const campaign = await db
    .prepare(`SELECT id FROM campaigns WHERE id = ?${scope.sql}`)
    .bind(campaignId, ...scope.params)
    .first<{ id: string }>();
  if (!campaign) return { ok: false, code: 'CAMPAIGN_NOT_FOUND' };

  const eventScope = brandClause(brandIds, 'e.brand_id');
  const row = await db
    .prepare(
      `UPDATE sponsor_placement
          SET campaign_id = ?1, updated_at = ?2
        WHERE id = ?3
          AND EXISTS (
            SELECT 1 FROM events e
              JOIN campaigns c ON c.brand_id = e.brand_id
             WHERE e.id = sponsor_placement.event_id AND c.id = ?1${eventScope.sql})
        RETURNING event_id`
    )
    .bind(campaignId, new Date().toISOString(), placementId, ...eventScope.params)
    .first<{ event_id: string }>();
  return row ? { ok: true, event_id: row.event_id } : { ok: false, code: 'PLACEMENT_NOT_FOUND' };
}

/**
 * Take a placement out of a campaign. Only a placement that is in THIS campaign
 * is changed; anything else is PLACEMENT_NOT_FOUND and nothing is written.
 */
export async function detachPlacementFromCampaign(
  db: D1Database,
  campaignId: string,
  placementId: string,
  brandIds: readonly string[] | null
): Promise<PlacementCampaignResult> {
  const scope = brandClause(brandIds, 'brand_id');
  const campaign = await db
    .prepare(`SELECT id FROM campaigns WHERE id = ?${scope.sql}`)
    .bind(campaignId, ...scope.params)
    .first<{ id: string }>();
  if (!campaign) return { ok: false, code: 'CAMPAIGN_NOT_FOUND' };

  const row = await db
    .prepare(
      `UPDATE sponsor_placement
          SET campaign_id = NULL, updated_at = ?1
        WHERE id = ?2 AND campaign_id = ?3
        RETURNING event_id`
    )
    .bind(new Date().toISOString(), placementId, campaignId)
    .first<{ event_id: string }>();
  return row ? { ok: true, event_id: row.event_id } : { ok: false, code: 'PLACEMENT_NOT_FOUND' };
}

// ─── An event in a campaign (events.campaign_id, migration 0110) ────────────────

export type EventCampaignResult =
  { ok: true; event_id: string } | { ok: false; code: 'CAMPAIGN_NOT_FOUND' | 'EVENT_NOT_FOUND' };

/** What an admin sees of an event in a campaign. Nothing here is public. */
export interface CampaignEventRow {
  id: string;
  title: string;
  status: string;
  start_date: string | null;
}

/**
 * Put an event in a campaign. `brandIds` is the caller's server-derived brand
 * list, or null for the automation scope that sees every brand.
 *
 * The same-brand rule is in the UPDATE's WHERE (the campaign's brand is the
 * event's own brand), so it holds for every caller. An event that is unknown, in
 * another brand than the campaign, or outside the caller's brands is the same
 * EVENT_NOT_FOUND, and nothing is written.
 *
 * An event is in at most one campaign (one column). Putting it in a second
 * campaign of its brand moves it. Only `campaign_id` is written: the event's
 * `updated_at`, its sponsor placements and their own campaigns are untouched.
 */
export async function addEventToCampaign(
  db: D1Database,
  campaignId: string,
  eventId: string,
  brandIds: readonly string[] | null
): Promise<EventCampaignResult> {
  const scope = brandClause(brandIds, 'brand_id');
  const campaign = await db
    .prepare(`SELECT id FROM campaigns WHERE id = ?${scope.sql}`)
    .bind(campaignId, ...scope.params)
    .first<{ id: string }>();
  if (!campaign) return { ok: false, code: 'CAMPAIGN_NOT_FOUND' };

  const eventScope = brandClause(brandIds, 'events.brand_id');
  const row = await db
    .prepare(
      `UPDATE events
          SET campaign_id = ?1
        WHERE id = ?2
          AND EXISTS (
            SELECT 1 FROM campaigns c
             WHERE c.id = ?1 AND c.brand_id = events.brand_id)${eventScope.sql}
        RETURNING id`
    )
    .bind(campaignId, eventId, ...eventScope.params)
    .first<{ id: string }>();
  return row ? { ok: true, event_id: row.id } : { ok: false, code: 'EVENT_NOT_FOUND' };
}

/**
 * Take an event out of a campaign. Only an event that is in THIS campaign, and
 * in the caller's brands, is changed; anything else is EVENT_NOT_FOUND and
 * nothing is written. Clearing a link crosses no brand wall, so this statement
 * does not ask for the brand match: a row mislinked past the API can still be
 * cleared, by the automation scope or by an admin who is in both brands.
 */
export async function removeEventFromCampaign(
  db: D1Database,
  campaignId: string,
  eventId: string,
  brandIds: readonly string[] | null
): Promise<EventCampaignResult> {
  const scope = brandClause(brandIds, 'brand_id');
  const campaign = await db
    .prepare(`SELECT id FROM campaigns WHERE id = ?${scope.sql}`)
    .bind(campaignId, ...scope.params)
    .first<{ id: string }>();
  if (!campaign) return { ok: false, code: 'CAMPAIGN_NOT_FOUND' };

  const eventScope = brandClause(brandIds, 'brand_id');
  const row = await db
    .prepare(
      `UPDATE events
          SET campaign_id = NULL
        WHERE id = ?1 AND campaign_id = ?2${eventScope.sql}
        RETURNING id`
    )
    .bind(eventId, campaignId, ...eventScope.params)
    .first<{ id: string }>();
  return row ? { ok: true, event_id: row.id } : { ok: false, code: 'EVENT_NOT_FOUND' };
}

/**
 * The events in a campaign, earliest start first. Admin only.
 *
 * The join is on the brand match, so an event mislinked to another brand's
 * campaign is not listed under it. Returns null when the campaign is unknown or
 * outside the caller's brands.
 */
export async function listCampaignEvents(
  db: D1Database,
  campaignId: string,
  brandIds: readonly string[] | null
): Promise<CampaignEventRow[] | null> {
  const scope = brandClause(brandIds, 'brand_id');
  const campaign = await db
    .prepare(`SELECT id FROM campaigns WHERE id = ?${scope.sql}`)
    .bind(campaignId, ...scope.params)
    .first<{ id: string }>();
  if (!campaign) return null;

  const eventScope = brandClause(brandIds, 'e.brand_id');
  const res = await db
    .prepare(
      `SELECT e.id AS id, e.title AS title, e.status AS status, e.start_date AS start_date
         FROM events e
         JOIN campaigns c ON c.id = e.campaign_id
        WHERE c.id = ?
          AND c.brand_id = e.brand_id${eventScope.sql}
        ORDER BY e.start_date, e.id
        LIMIT ${CAMPAIGN_EVENT_LIST_MAX}`
    )
    .bind(campaignId, ...eventScope.params)
    .all<CampaignEventRow>();
  return res.results ?? [];
}

// ─── Rename a campaign, or change its status ────────────────────────────────────

/**
 * Change a campaign's title, its status, or both. `brandIds` is the caller's
 * server-derived brand list, or null for the automation scope.
 *
 * Only `title`, `status` and `updated_at` are written. The brand is never
 * changed: a campaign lives in exactly one brand (OSE ADR-030), and moving one
 * would carry its placements and events across the wall. A campaign that is
 * unknown or outside the caller's brands returns null, and nothing is written.
 *
 * A status other than 'active' takes the campaign out of the public sponsor
 * bundle at once (readShownPlacementCampaigns); its sponsors still show.
 */
export async function updateCampaign(
  db: D1Database,
  campaignId: string,
  change: { title?: string; status?: CampaignStatus },
  brandIds: readonly string[] | null
): Promise<CampaignRow | null> {
  const scope = brandClause(brandIds, 'brand_id');
  // The write answers only the id; the row is read back by that id. (A title
  // in a RETURNING list would sit after the WHERE, where the never-a-filter scan
  // in tests/campaign-never-a-filter.spec.ts reads a title as a selection.)
  const changed = await db
    .prepare(
      `UPDATE campaigns
          SET title = COALESCE(?1, title), status = COALESCE(?2, status), updated_at = ?3
        WHERE id = ?4${scope.sql}
        RETURNING id`
    )
    .bind(
      change.title ?? null,
      change.status ?? null,
      new Date().toISOString(),
      campaignId,
      ...scope.params
    )
    .first<{ id: string }>();
  if (!changed) return null;
  const row = await db
    .prepare(
      `SELECT id, brand_id, title, status, created_at, updated_at
         FROM campaigns WHERE id = ?${scope.sql}`
    )
    .bind(changed.id, ...scope.params)
    .first<CampaignRow>();
  return row ?? null;
}
