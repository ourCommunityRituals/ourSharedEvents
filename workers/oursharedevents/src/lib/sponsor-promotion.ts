/**
 * Sponsor draft → live promotion (OSE-736 / T8) — the ONE sanctioned crossing of
 * the #25 resolver-invisibility wall.
 *
 * `promoteSponsorDraft(env, draftToken)` copies a `sponsor_business_draft` (+ its
 * `sponsor_asset_draft` rows) into the live `sponsors` table, making it visible
 * to the resolver exactly once. It is transactional (one D1 batch), idempotent
 * (double-promote blocked), brand-scoped (#9), covenant-gated, and derives
 * `sponsor_event_types` as a SUBSET of the selectable templates mapped to the
 * draft's chosen categories (no foreign template_id injection, #8/#25).
 *
 * Four adversarial fixes are baked in (see the RESOLVER-ISOLATION findings):
 *   1. tier escalation — `sponsors.tier` is SERVER-FORCED to the covenant base
 *      tier; it is NEVER read from the draft/client (the draft has no tier).
 *   2. double-promote — refuses if the draft is already promoted; the write is a
 *      single guarded batch, so a second call mints no second sponsors row.
 *   3. is_active second door — promotion is the ONLY non-admin writer of
 *      sponsors.is_active=1, and it is covenant + brand gated here.
 *   4. JSON injection — category_selections is re-validated at promotion; the
 *      derived template set is bounded to selectable templates in the chosen
 *      categories, and malformed JSON fails closed with NO partial write.
 *
 * HARD DEPENDENCY: brand integrity reuses the per-ID scope concept from OSE-722
 * (draft.brand_id must equal the event's real brand). Must land after OSE-722.
 */

import { resolveAllowedMaxTier, type ClearanceEnv } from './template-clearance';
import { ASSET_FORMATS } from './sponsor-asset';
import { resolveSponsorEligibility } from './sponsor-eligibility';

export interface PromotionEnv extends ClearanceEnv {
  DB: D1Database;
  UPLOADS_BUCKET?: R2Bucket;
}

/**
 * The base share-of-voice tier. Promotion always writes this — a draft carries
 * no tier, and a live pricing/escalation path is out of scope (never client-set).
 * 'primary' maps to the `base` SoV group (sovTierOf), the lowest weight, no cap
 * exemption — fail-safe.
 */
export const COVENANT_BASE_TIER = 'primary';

// Uniform, non-purchasable placement marker (mirrors handlers/sponsors.ts). The
// resolver ignores it; stored only so legacy readers see "eligible everywhere".
const UNIFORM_PLACEMENT_FORMATS =
  '{"posterTop":true,"tvTop":true,"tvSide":true,"mobileBanner":true}';

export type PromotionResult =
  | { ok: true; sponsor_id: string; template_ids: string[] }
  | { ok: false; code: string; status: number };

interface DraftRow {
  draft_token: string;
  brand_id: string;
  event_id: string | null;
  campaign_id: string | null;
  name: string;
  website_url: string | null;
  logo_url: string | null;
  lat: number | null;
  lon: number | null;
  h3_res9: string | null;
  h3_res7: string | null;
  category_selections: string;
  covenant_acknowledged_at: string | null;
  promoted_sponsor_id: string | null;
  status: string;
  free_tier_eligible: number;
  eligibility_source: string | null;
}

function genId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID ? crypto.randomUUID() : String(Date.now())}`;
}

/**
 * Promote a draft to a live sponsor. Returns the new sponsor id + derived
 * template ids on success, or a coded failure (no partial write on any failure).
 */
export async function promoteSponsorDraft(
  env: PromotionEnv,
  draftToken: string,
  opts: { compClaimValid?: boolean } = {}
): Promise<PromotionResult> {
  if (!env.DB) return { ok: false, code: 'DB_NOT_CONFIGURED', status: 503 };

  const draft = await env.DB.prepare(
    `SELECT draft_token, brand_id, event_id, campaign_id, name, website_url, logo_url,
            lat, lon, h3_res9, h3_res7, category_selections, covenant_acknowledged_at,
            promoted_sponsor_id, status, free_tier_eligible, eligibility_source
       FROM sponsor_business_draft WHERE draft_token = ?`
  )
    .bind(draftToken)
    .first<DraftRow>();
  if (!draft) return { ok: false, code: 'DRAFT_NOT_FOUND', status: 404 };

  // FIX 2 — double-promote guard.
  if (draft.status === 'promoted' || draft.promoted_sponsor_id) {
    return { ok: false, code: 'ALREADY_PROMOTED', status: 409 };
  }

  // Covenant gate — a live sponsor cannot exist without an acknowledged covenant.
  if (!draft.covenant_acknowledged_at) {
    return { ok: false, code: 'COVENANT_REQUIRED', status: 412 };
  }

  // A live sponsor belongs to an event (sponsors.event_id FK).
  if (!draft.event_id) return { ok: false, code: 'EVENT_REQUIRED', status: 412 };

  // FIX (brand integrity, #9 / OSE-722) — the referenced event must belong to the
  // draft's brand. A draft whose brand_id doesn't match the event's real brand is
  // a cross-tenant association and is refused BEFORE any write.
  const ev = await env.DB.prepare('SELECT brand_id, h3_res7 FROM events WHERE id = ?')
    .bind(draft.event_id)
    .first<{ brand_id: string; h3_res7: string | null }>();
  if (!ev) return { ok: false, code: 'EVENT_NOT_FOUND', status: 404 };
  if (ev.brand_id !== draft.brand_id) return { ok: false, code: 'BRAND_MISMATCH', status: 403 };

  // P1 ELIGIBILITY GATE (OSE-744, #25/#8) — after covenant + brand checks, before
  // ANY write. A pure boolean admit/deny; price/tier NEVER enters (it is not an
  // input to resolveSponsorEligibility, so it cannot reach allocateShares). Sources
  // compose free_tier -> comp -> subscription(stub) -> store_credit(stub);
  // fail-closed. A 402 leaves draft.status untouched (re-submittable) and writes
  // no sponsors row. 402 is a normal outcome — info-level log, never error/page.
  const eligibility = resolveSponsorEligibility({
    free_tier: draft.free_tier_eligible === 1,
    comp: opts.compClaimValid === true,
    subscription: false, // stub until OSE-745 hasActiveSubscription()
    store_credit: false, // stub until OSE-745 hasStoreCredit()
  });
  if (!eligibility.eligible) {
    console.log(
      JSON.stringify({
        type: 'SPONSOR_PROMOTION_GATE',
        decision: 'payment_required',
        draft_token: draftToken,
        brand_id: draft.brand_id,
      })
    );
    return { ok: false, code: 'PAYMENT_REQUIRED', status: 402 };
  }

  // is_local — GEO-DERIVED (draft cell vs event cell), never a client toggle.
  const isLocal =
    draft.h3_res7 !== null && ev.h3_res7 !== null && draft.h3_res7 === ev.h3_res7 ? 1 : 0;

  // FIX 4 — re-validate category_selections and derive sponsor_event_types as a
  // SUBSET of the SELECTABLE templates mapped to the chosen categories. Because
  // `excluded` can only REMOVE, no foreign/unmapped template_id can be injected.
  let selections: unknown;
  try {
    selections = JSON.parse(draft.category_selections || '[]');
  } catch {
    return { ok: false, code: 'MALFORMED_CATEGORY_SELECTIONS', status: 400 };
  }
  if (!Array.isArray(selections)) {
    return { ok: false, code: 'MALFORMED_CATEGORY_SELECTIONS', status: 400 };
  }
  const allowed = resolveAllowedMaxTier(env);
  const templateIds = new Set<string>();
  for (const raw of selections) {
    if (!raw || typeof raw !== 'object') {
      return { ok: false, code: 'MALFORMED_CATEGORY_SELECTIONS', status: 400 };
    }
    const sel = raw as Record<string, unknown>;
    if (typeof sel.category !== 'string') {
      return { ok: false, code: 'MALFORMED_CATEGORY_SELECTIONS', status: 400 };
    }
    const excluded = new Set(
      Array.isArray(sel.excluded)
        ? sel.excluded.filter((x): x is string => typeof x === 'string')
        : []
    );
    // Selectable templates in this category (the 0057 clearance gate, bound-param).
    const rows = await env.DB.prepare(
      `SELECT id FROM event_templates
         WHERE category = ? AND max_clearance_tier IS NOT NULL AND max_clearance_tier <= ?`
    )
      .bind(sel.category, allowed)
      .all<{ id: string }>();
    for (const r of rows.results ?? []) {
      if (!excluded.has(r.id)) templateIds.add(r.id);
    }
  }

  const sponsorId = genId('sp');

  // Copy per-format assets from the draft namespace to the sponsor namespace and
  // record the derived R2 key in sponsors.{format}_url (the #7 'derived' rung).
  const formatUrl: Record<string, string | null> = {};
  const formatCt: Record<string, string | null> = {};
  const assetDrafts = await env.DB.prepare(
    'SELECT format, content_type FROM sponsor_asset_draft WHERE draft_token = ?'
  )
    .bind(draftToken)
    .all<{ format: string; content_type: string | null }>();
  for (const ad of assetDrafts.results ?? []) {
    if (!(ASSET_FORMATS as readonly string[]).includes(ad.format)) continue;
    const dstKey = `sponsors/${sponsorId}/${ad.format}`;
    if (env.UPLOADS_BUCKET) {
      const obj = await env.UPLOADS_BUCKET.get(`sponsors/${draftToken}/${ad.format}`);
      if (obj) {
        await env.UPLOADS_BUCKET.put(dstKey, obj.body, {
          httpMetadata: { contentType: ad.content_type ?? obj.httpMetadata?.contentType },
        });
      }
    }
    // Record the derived key regardless of bucket state — the serve path
    // (T7b) falls back to logo/monogram if the object is absent (always-200).
    formatUrl[ad.format] = dstKey;
    formatCt[ad.format] = ad.content_type;
  }

  const now = new Date().toISOString();

  // FIX 1 (tier forced) + FIX 2 (guarded UPDATE) + FIX 3 (is_active gated here).
  // One atomic batch: INSERT sponsor, INSERT its event-types, flip the draft.
  const statements: D1PreparedStatement[] = [];
  statements.push(
    env.DB.prepare(
      `INSERT INTO sponsors (
         id, event_id, name, logo_url, website_url, tier, placement_formats,
         click_token, impression_token, is_active, is_local, lat, lon, h3_res9, h3_res7,
         poster_url, poster_content_type, banner_url, banner_content_type,
         vertical_url, vertical_content_type, square_url, square_content_type,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      sponsorId,
      draft.event_id,
      draft.name,
      draft.logo_url,
      draft.website_url,
      COVENANT_BASE_TIER, // server-forced, never from draft/client
      UNIFORM_PLACEMENT_FORMATS,
      null,
      null,
      isLocal,
      draft.lat,
      draft.lon,
      draft.h3_res9,
      draft.h3_res7,
      formatUrl.poster ?? null,
      formatCt.poster ?? null,
      formatUrl.banner ?? null,
      formatCt.banner ?? null,
      formatUrl.vertical ?? null,
      formatCt.vertical ?? null,
      formatUrl.square ?? null,
      formatCt.square ?? null,
      now,
      now
    )
  );
  for (const tid of templateIds) {
    statements.push(
      env.DB.prepare(
        'INSERT INTO sponsor_event_types (id, sponsor_id, template_id) VALUES (?, ?, ?)'
      ).bind(genId('set'), sponsorId, tid)
    );
  }
  statements.push(
    env.DB.prepare(
      `UPDATE sponsor_business_draft
         SET promoted_sponsor_id = ?, status = 'promoted', updated_at = ?
       WHERE draft_token = ? AND status != 'promoted'`
    ).bind(sponsorId, now, draftToken)
  );

  await env.DB.batch(statements);

  return { ok: true, sponsor_id: sponsorId, template_ids: [...templateIds] };
}
