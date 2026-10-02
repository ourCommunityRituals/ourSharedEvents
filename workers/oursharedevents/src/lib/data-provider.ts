/**
 * data-provider.ts — OSE data-access fallback chain (MOCK-1b-ii / OSE-190).
 *
 * Source priority per request:  live → CF cache → mock → error
 *
 *   1. live   — DB binding present AND mock-mode is off AND not production-blocked
 *   2. cache  — Cloudflare Cache API; stale-while-revalidate via ctx.waitUntil()
 *   3. mock   — deterministic fixtures from mock-data.ts
 *   4. error  — no source available; throws DataProviderError
 *
 * Production guard
 * ─────────────────
 * Mock mode is blocked in production (`WORKER_ENV === 'production'`) unless
 * the `config.mock-mode` feature flag is explicitly true in the DB.  Pass an
 * already-resolved `mockModeOverride` boolean to the constructor to apply DB
 * flag checks before instantiation (see `createDataProvider` async factory).
 *
 * Stale-while-revalidate
 * ──────────────────────
 * When a cached entry is stale (age > ttl) but within the SWR window
 * (age < ttl + swrSeconds), the cached value is returned immediately and a
 * background revalidation is queued via `ctx.waitUntil()`.  When ctx is not
 * provided the SWR refresh is skipped (entry served stale without refresh).
 *
 * Shared types come from `@ocr/data-provider`.  Each OCR Worker (OSM, OW…)
 * has its own DataProvider class following the same pattern.
 */

import {
  makeCacheKey,
  readCfCache,
  writeCfCache,
  deleteCfCache,
  DataProviderError,
  type DataSource,
  type DataResult,
  type DataProviderCtx,
  type CacheTtlConfig,
} from '@ocr/data-provider';

import {
  getEventFixture,
  getSponsorFixtures,
  getPosterDeployments,
  getScanAggregates,
  getFeatureFlagFixtures,
  getFlagsForTier,
  MOCK_EVENT_ID,
  type MockEvent,
  type MockSponsor,
  type MockPosterDeployment,
  type MockScanAggregate,
  type MockFeatureFlags,
  type FlagMap,
  type Tier,
} from './mock-data.js';

import { resolveSponsorsForEvent, type SponsorRow } from './sponsor-resolver.js';
import { listedSql } from './publish-grace';

// ── Re-export shared types so callers only need one import ─────────────────────

export type { DataSource, DataResult, DataProviderCtx };
export { DataProviderError };

// ── Env shape ──────────────────────────────────────────────────────────────────

export interface DataProviderEnv {
  DB?: D1Database;
  WORKER_ENV?: string;
  /** Set to "1" or "true" to force mock mode in non-production environments. */
  MOCK_MODE?: string;
  /** "1" enables Path-2 template+geo sponsor auto-match (dark-at-launch; ADR-019). */
  SPONSOR_GEO_MATCH_ENABLED?: string;
}

// ── Per-route TTL config ───────────────────────────────────────────────────────

const TTL: Record<string, CacheTtlConfig> = {
  event: { ttlSeconds: 60, swrSeconds: 300 },
  events: { ttlSeconds: 60, swrSeconds: 300 },
  sponsor: { ttlSeconds: 30, swrSeconds: 300 },
  flags: { ttlSeconds: 120, swrSeconds: 600 },
  poster: { ttlSeconds: 120, swrSeconds: 600 },
  scan: { ttlSeconds: 60, swrSeconds: 300 },
};

// ── Sponsor cache invalidation (OSE-1000) ───────────────────────────────────────
//
// The public sponsors read is cache-fronted (TTL.sponsor = 30s, no revalidate
// while fresh). A sponsor mutation must bust this key or the just-written change
// is invisible on the cache-fronted read for up to the TTL — a write→read race.
// This helper is the single source of the sponsors cache key, shared by the read
// (getSponsors) and every mutation handler, so read and invalidation can't drift.

/** Cache key path for an event's resolved public sponsor list. */
export function sponsorsCacheKeyPath(eventId: string): string {
  return `sponsors/${eventId}`;
}

/**
 * Invalidate the cached public sponsor list for an event. Call after any sponsor
 * create/update/delete so the next public read re-fetches live instead of
 * serving a stale pre-write snapshot (OSE-1000). No-op when the cache is
 * unavailable; failures are swallowed inside deleteCfCache.
 */
export async function invalidateSponsorsCache(eventId: string): Promise<void> {
  await deleteCfCache(makeCacheKey(sponsorsCacheKeyPath(eventId)));
}

// ── DataProvider ───────────────────────────────────────────────────────────────

export class DataProvider {
  private readonly db: D1Database | null;
  private readonly mockMode: boolean;
  private readonly ctx: DataProviderCtx | null;
  private readonly geoMatchEnabled: boolean;

  constructor(env: DataProviderEnv, ctx?: DataProviderCtx | null, mockModeOverride?: boolean) {
    this.db = env.DB ?? null;
    this.ctx = ctx ?? null;
    // Path-2 template+geo sponsor auto-match: OFF unless explicitly enabled (ADR-019 dark-at-launch).
    this.geoMatchEnabled = env.SPONSOR_GEO_MATCH_ENABLED === '1';

    if (typeof mockModeOverride === 'boolean') {
      this.mockMode = mockModeOverride;
    } else {
      const requested = env.MOCK_MODE === '1' || env.MOCK_MODE === 'true';
      // Production blocks mock via env var — require explicit DB flag (see createDataProvider).
      const isProd = env.WORKER_ENV === 'production';
      this.mockMode = !isProd && requested;
    }
  }

  get isMockActive(): boolean {
    return this.mockMode || this.db === null;
  }

  /**
   * INTENTIONAL demo/mock mode — the operator deliberately put this worker in
   * mock mode (env MOCK_MODE in non-prod, or the explicit prod DB flag). Unlike
   * `isMockActive` this EXCLUDES the `db === null` outage fallback: a missing DB
   * binding is a degradation, not a demo. Used by the demo-provenance banner
   * (OSE-1012) so "this is a demo" is asserted only when it truly is one.
   */
  get isIntentionalMock(): boolean {
    return this.mockMode;
  }

  get preferredSource(): DataSource {
    return this.isMockActive ? 'mock' : 'live';
  }

  // ── Internal helpers ─────────────────────────────────────────────────────────

  private async fromCache<T>(
    cacheKeyPath: string,
    ttl: CacheTtlConfig,
    revalidate: () => Promise<T | null>
  ): Promise<{ data: T; source: 'cache'; cacheAge: number } | null> {
    const key = makeCacheKey(cacheKeyPath);
    const hit = await readCfCache<T>(key);
    if (!hit) return null;

    const { ttlSeconds, swrSeconds = 300 } = ttl;

    if (hit.age < ttlSeconds * 1000) {
      // Fresh cache hit
      return { data: hit.data, source: 'cache', cacheAge: hit.age };
    }

    if (hit.age < (ttlSeconds + swrSeconds) * 1000) {
      // Stale — serve immediately, revalidate in background if ctx available
      if (this.ctx) {
        this.ctx.waitUntil(
          revalidate()
            .then(async (fresh) => {
              if (fresh !== null) await writeCfCache(key, fresh, ttl);
            })
            .catch(() => {
              /* background errors are silent */
            })
        );
      }
      return { data: hit.data, source: 'cache', cacheAge: hit.age };
    }

    // Beyond SWR window — treat as miss
    return null;
  }

  private async fetchAndCache<T>(
    cacheKeyPath: string,
    ttl: CacheTtlConfig,
    fetcher: () => Promise<T | null>
  ): Promise<T | null> {
    const data = await fetcher();
    if (data !== null) {
      await writeCfCache(makeCacheKey(cacheKeyPath), data, ttl);
    }
    return data;
  }

  // ── Events ───────────────────────────────────────────────────────────────────

  async getEvent(eventId: string): Promise<DataResult<MockEvent>> {
    if (!this.isMockActive) {
      const keyPath = `events/single/${eventId}`;
      const ttl = TTL.event;

      const cached = await this.fromCache<MockEvent>(keyPath, ttl, () => this.fetchEvent(eventId));
      // A cached row that is not live may have just been published (a TV or
      // phone that opened the draft): read it fresh rather than refuse a live
      // event for the cache's 60 s + 300 s. Drafts are rare reads, so this
      // costs little; live rows keep the cache.
      if (cached && (cached.data as { status?: string } | null)?.status === 'active') return cached;

      const row = await this.fetchAndCache(keyPath, ttl, () => this.fetchEvent(eventId));
      // Return null data when event not found in live mode — do not fall through to mock fixture.
      // Callers (handleGetEvent) check `result.data` and return 404 when null.
      return { data: row as unknown as MockEvent, source: 'live', cacheAge: null };
    }

    const fixture =
      eventId === MOCK_EVENT_ID
        ? getEventFixture()
        : { ...getEventFixture(), id: eventId, title: `[mock] Event ${eventId}` };

    return { data: fixture, source: 'mock', cacheAge: null };
  }

  /**
   * Fetch one event by id.
   *
   * DELIBERATELY NOT FILTERED BY `is_published` (OSE-1245). Unpublished means
   * ABSENT FROM DISCOVERY — the map and the list — not unreachable. A host who
   * keeps their home off the map still printed a QR poster and still handed a
   * link to the twelve people they invited; breaking those would make
   * unpublishing break the host's own event, which is the opposite of giving
   * them control.
   *
   * The distinction is: `/events` and `/events/map` ANSWER "what is happening
   * near me" and must only speak for hosts who said yes. `/events/:id` and
   * `/forms/:id` ARE the event, reached by someone who already has its
   * address — the flag was never about them.
   *
   * The consequence to be honest about: an unpublished event's id is still a
   * bearer token. Ids are UUIDs, not enumerable, but this is a knows-the-link
   * model rather than an access-control one, and it should be named as such
   * rather than mistaken for privacy.
   */
  private async fetchEvent(eventId: string): Promise<MockEvent | null> {
    return this.db!.prepare(
      `SELECT id, brand_id, title, slug, status, description, location,
              start_date, end_date, timezone, starts_at, cover_image_url, created_at, updated_at,
              legal_clearance_tier,
              what_short, who_host, why_purpose, how_details, where_address,
              lat, lon, corridor_id, h3_res9, h3_res7
       FROM events WHERE id = ?1 LIMIT 1`
    )
      .bind(eventId)
      .first<MockEvent>();
  }

  async listEvents(brand: string = 'root'): Promise<DataResult<MockEvent[]>> {
    if (!this.isMockActive) {
      // No CF cache for the list — always live so test isolation is maintained
      // and newly created events are immediately visible without SWR delay.
      const rows = await this.fetchEvents(brand);
      if (rows) return { data: rows, source: 'live', cacheAge: null };
    }

    return { data: [getEventFixture()], source: 'mock', cacheAge: null };
  }

  private async fetchEvents(brand: string): Promise<MockEvent[] | null> {
    const { results } = await this.db!.prepare(
      // template_id / event_type_id feed the landing area's event-type filter
      // (OSE-1312). Additive to the list projection; the JSON API drops both via
      // its allowlist projection (public-event-projection), so this cannot leak.
      `SELECT id, brand_id, title, slug, status, description, location,
              start_date, end_date, timezone, starts_at, cover_image_url, created_at, updated_at,
              legal_clearance_tier, template_id, event_type_id,
              what_short, who_host, why_purpose, how_details, where_address,
              lat, lon, corridor_id, h3_res9, h3_res7
       FROM events
       WHERE is_published = 1 AND brand_id = ? AND status = 'active' AND ${listedSql()}
       ORDER BY start_date ASC, starts_at ASC
       LIMIT 1000`
    )
      // LIMIT 1000 (CCR-PR567 L3d): a worst-case guard so the uncached,
      // server-rendered /events discovery (applyDiscoveryFilters runs O(N)
      // in-Worker over this set) can't read an unbounded result. Far above any
      // realistic single-brand active+published count; the real scale fix is
      // pushing the when/q filters into SQL, deferred until a brand approaches it.
      .bind(brand)
      .all<MockEvent>();
    return results ?? [];
  }

  // ── Sponsors ─────────────────────────────────────────────────────────────────

  async getSponsors(
    eventId: string,
    opts: { count?: number; bypassCache?: boolean } = {}
  ): Promise<DataResult<SponsorRow[]>> {
    if (!this.isMockActive) {
      if (opts.bypassCache) {
        const rows = await this.fetchSponsors(eventId);
        if (rows) return { data: rows, source: 'live', cacheAge: null };
      }

      const keyPath = sponsorsCacheKeyPath(eventId);
      const ttl = TTL.sponsor;

      const cached = await this.fromCache<SponsorRow[]>(keyPath, ttl, () =>
        this.fetchSponsors(eventId)
      );
      if (cached) return cached;

      const rows = await this.fetchAndCache(keyPath, ttl, () => this.fetchSponsors(eventId));
      if (rows) return { data: rows, source: 'live', cacheAge: null };
    }

    return {
      data: getSponsorFixtures(opts.count ?? 15) as unknown as SponsorRow[],
      source: 'mock',
      cacheAge: null,
    };
  }

  private async fetchSponsors(eventId: string): Promise<SponsorRow[] | null> {
    return resolveSponsorsForEvent(this.db!, eventId, { geoMatchEnabled: this.geoMatchEnabled });
  }

  // ── Poster deployments ───────────────────────────────────────────────────────

  async getPosterDeployments(eventId: string): Promise<DataResult<MockPosterDeployment[]>> {
    if (!this.isMockActive) {
      const keyPath = `poster-deployments/${eventId}`;
      const ttl = TTL.poster;

      const cached = await this.fromCache<MockPosterDeployment[]>(keyPath, ttl, () =>
        this.fetchPosterDeployments(eventId)
      );
      if (cached) return cached;

      const rows = await this.fetchAndCache(keyPath, ttl, () =>
        this.fetchPosterDeployments(eventId)
      );
      if (rows) return { data: rows, source: 'live', cacheAge: null };
    }

    return { data: getPosterDeployments(), source: 'mock', cacheAge: null };
  }

  private async fetchPosterDeployments(eventId: string): Promise<MockPosterDeployment[] | null> {
    const { results } = await this.db!.prepare(
      'SELECT * FROM poster_deployments WHERE event_id = ?1'
    )
      .bind(eventId)
      .all<MockPosterDeployment>();
    return results ?? [];
  }

  // ── Scan aggregates ──────────────────────────────────────────────────────────

  async getScanAggregates(eventId: string): Promise<DataResult<MockScanAggregate[]>> {
    if (!this.isMockActive) {
      const keyPath = `scan-aggregates/${eventId}`;
      const ttl = TTL.scan;

      const cached = await this.fromCache<MockScanAggregate[]>(keyPath, ttl, () =>
        this.fetchScanAggregates(eventId)
      );
      if (cached) return cached;

      const rows = await this.fetchAndCache(keyPath, ttl, () => this.fetchScanAggregates(eventId));
      if (rows) return { data: rows, source: 'live', cacheAge: null };
    }

    return { data: getScanAggregates(), source: 'mock', cacheAge: null };
  }

  private async fetchScanAggregates(eventId: string): Promise<MockScanAggregate[] | null> {
    const { results } = await this.db!.prepare(
      'SELECT event_id, uec_code, hour_bucket, count ' +
        'FROM scan_aggregates WHERE event_id = ?1 ORDER BY hour_bucket ASC'
    )
      .bind(eventId)
      .all<MockScanAggregate>();
    return results ?? [];
  }

  // ── Feature flags ────────────────────────────────────────────────────────────

  async getFlags(tier: Tier = 'free'): Promise<DataResult<FlagMap>> {
    if (!this.isMockActive) {
      const keyPath = `flags/global/${tier}`;
      const ttl = TTL.flags;

      const cached = await this.fromCache<FlagMap>(keyPath, ttl, () => this.fetchFlags());
      if (cached) return cached;

      try {
        const flags = await this.fetchFlags();
        if (flags !== null) {
          await writeCfCache(makeCacheKey(keyPath), flags, ttl);
          return { data: flags, source: 'live', cacheAge: null };
        }
      } catch {
        // Fall through to mock
      }
    }

    return { data: getFlagsForTier(tier), source: 'mock', cacheAge: null };
  }

  private async fetchFlags(): Promise<FlagMap | null> {
    try {
      const { results } = await this.db!.prepare(
        "SELECT flag_key, flag_value FROM feature_flags WHERE scope = 'global'"
      ).all<{ flag_key: string; flag_value: number }>();

      if (results.length === 0) return null;

      const flags: FlagMap = {};
      for (const row of results) flags[row.flag_key] = row.flag_value === 1;
      return flags;
    } catch {
      return null;
    }
  }

  async getFeatureFlagFixtures(): Promise<DataResult<MockFeatureFlags[]>> {
    return { data: getFeatureFlagFixtures(), source: 'mock', cacheAge: null };
  }

  // ── Health summary ───────────────────────────────────────────────────────────

  healthSummary(): {
    db_bound: boolean;
    mock_mode_forced: boolean;
    effective_source: DataSource;
  } {
    return {
      db_bound: this.db !== null,
      mock_mode_forced: this.mockMode,
      effective_source: this.preferredSource,
    };
  }
}

// ── Factories ──────────────────────────────────────────────────────────────────

/**
 * Creates a DataProvider for the current request.
 * Pass `ctx` to enable stale-while-revalidate background refresh.
 */
export function getDataProvider(env: DataProviderEnv, ctx?: DataProviderCtx | null): DataProvider {
  return new DataProvider(env, ctx);
}

/**
 * Async factory that resolves the `config.mock-mode` feature flag from the DB
 * before constructing the DataProvider.  Use this when accurate production
 * mock-mode gating via the DB flag matters (e.g., the /health handler).
 */
export async function createDataProvider(
  env: DataProviderEnv,
  ctx?: DataProviderCtx | null
): Promise<DataProvider> {
  const isProd = env.WORKER_ENV === 'production';

  if (isProd && env.DB) {
    // In production, only allow mock if the DB flag is explicitly true.
    try {
      const row = await env.DB.prepare(
        "SELECT flag_value FROM feature_flags WHERE scope = 'global' AND flag_key = 'config.mock-mode' LIMIT 1"
      ).first<{ flag_value: number }>();
      const flagEnabled = row?.flag_value === 1;
      return new DataProvider(env, ctx, flagEnabled);
    } catch {
      // DB error — default to no mock in production
      return new DataProvider(env, ctx, false);
    }
  }

  return new DataProvider(env, ctx);
}
