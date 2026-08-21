/**
 * Shared test seed for the split sponsor model (OSE-799 A2).
 *
 * Before the split, tests wrote a single `INSERT INTO sponsors (...)`. Migration
 * 0067 retired that table, splitting a sponsor into three:
 *   • sponsor_business   — durable identity (carries brand_id, the #9 tenant key)
 *   • sponsor_placement  — the per-event attachment (tier, locality_band, tokens,
 *                          is_active)
 *   • sponsor_asset      — creative, one row per format (logo/poster/…)
 *
 * `seedSplitSponsor` writes all three in one batch with the SAME semantics the old
 * flat insert had, so a test keeps using the sponsor id it already knows (that id
 * is now the sponsor_business id — the caller-facing handle). brand_id defaults to
 * the seeded event's brand, mirroring the create/promotion handlers, so the #9
 * scope tests stay meaningful under the new direct `sponsor_business.brand_id`
 * scope.
 */

export interface SeedSponsorOpts {
  /** The sponsor id callers use — becomes sponsor_business.id. */
  id: string;
  /** Event the sponsor is attached to (drives the placement + default brand). */
  eventId: string;
  name?: string;
  /** #9 tenant. Defaults to the event's brand_id, else 'brand_default'. */
  brandId?: string;
  tier?: string;
  websiteUrl?: string | null;
  logoUrl?: string | null;
  /** → sponsor_placement.is_active (default 1). */
  isActive?: number;
  /** → sponsor_placement.locality_band (default 0). */
  isLocal?: number;
  clickToken?: string | null;
  displayToken?: string | null;
  lat?: number | null;
  lon?: number | null;
  h3Res9?: string | null;
  h3Res7?: string | null;
  campaignId?: string | null;
  /** 'organizer' | 'corridor_covenant' | 'platform_seed' (default 'organizer'). */
  source?: string;
  createdAt?: string;
  updatedAt?: string;
  /** Per-format creative → sponsor_asset rows. */
  posterUrl?: string | null;
  bannerUrl?: string | null;
  verticalUrl?: string | null;
  squareUrl?: string | null;
  /** Override the generated placement id (rarely needed). */
  placementId?: string;
}

export async function seedSplitSponsor(db: D1Database, opts: SeedSponsorOpts): Promise<void> {
  const id = opts.id;

  let brandId = opts.brandId;
  if (brandId === undefined) {
    const ev = await db
      .prepare('SELECT brand_id FROM events WHERE id = ?')
      .bind(opts.eventId)
      .first<{ brand_id: string | null }>();
    brandId = ev?.brand_id ?? 'brand_default';
  }

  const now = opts.updatedAt ?? '2026-01-01T00:00:00.000Z';
  const createdAt = opts.createdAt ?? now;

  // Idempotent: clear any prior split rows for this business id so a test can
  // re-seed the same id (mirrors the old DELETE-then-INSERT seed pattern). FK is
  // off in the miniflare test DB, so plain deletes are safe and order-free.
  await db.batch([
    db.prepare('DELETE FROM sponsor_asset WHERE sponsor_business_id = ?').bind(id),
    db.prepare('DELETE FROM sponsor_placement WHERE sponsor_business_id = ?').bind(id),
    db.prepare('DELETE FROM sponsor_business WHERE id = ?').bind(id),
  ]);

  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO sponsor_business
           (id, brand_id, name, website_url, lat, lon, h3_res9, h3_res7, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        brandId,
        opts.name ?? `Sponsor ${id}`,
        opts.websiteUrl ?? null,
        opts.lat ?? null,
        opts.lon ?? null,
        opts.h3Res9 ?? null,
        opts.h3Res7 ?? null,
        createdAt,
        now
      ),
    db
      .prepare(
        `INSERT INTO sponsor_placement
           (id, sponsor_business_id, event_id, tier, campaign_id, source, polarity,
            locality_band, click_token, display_token, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        opts.placementId ?? `spl_${id}`,
        id,
        opts.eventId,
        opts.tier ?? 'primary',
        opts.campaignId ?? null,
        opts.source ?? 'organizer',
        opts.isLocal ?? 0,
        opts.clickToken ?? null,
        opts.displayToken ?? null,
        opts.isActive ?? 1,
        createdAt,
        now
      ),
  ];

  const assets: Array<[string, string | null | undefined]> = [
    ['logo', opts.logoUrl],
    ['poster', opts.posterUrl],
    ['banner', opts.bannerUrl],
    ['vertical', opts.verticalUrl],
    ['square', opts.squareUrl],
  ];
  for (const [format, url] of assets) {
    if (!url) continue;
    stmts.push(
      db
        .prepare(
          `INSERT INTO sponsor_asset
             (id, sponsor_business_id, format, url, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(`sa_${id}_${format}`, id, format, url, createdAt, now)
    );
  }

  await db.batch(stmts);
}
