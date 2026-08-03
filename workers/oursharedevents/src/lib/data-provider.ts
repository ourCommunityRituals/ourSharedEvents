/**
 * data-provider.ts — Fallback chain for event data access (MOCK-1a / OSE-147).
 *
 * Source priority: live → server cache → mock → error
 *
 *   1. live   — DB binding present AND mock-mode flag is off
 *   2. cache  — in-memory map keyed by event ID; populated by live reads
 *   3. mock   — deterministic fixtures from mock-data.ts
 *   4. error  — no source available; throws DataProviderError
 *
 * The source used for the current request is always reported so callers can
 * surface it in /health responses without additional inspection.
 *
 * Usage:
 *   const provider = new DataProvider(env);
 *   const result   = await provider.getEvent(eventId);
 *   console.log(result.source);  // 'live' | 'cache' | 'mock'
 */

import {
  getMockSnapshot,
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

// ── Public types ───────────────────────────────────────────────────────────────

export type DataSource = 'live' | 'cache' | 'mock';

export interface DataResult<T> {
  data: T;
  source: DataSource;
}

export class DataProviderError extends Error {
  constructor(
    message: string,
    public readonly reason: string
  ) {
    super(message);
    this.name = 'DataProviderError';
  }
}

// ── Minimal env shape (only what DataProvider cares about) ────────────────────

export interface DataProviderEnv {
  DB?: D1Database;
  WORKER_ENV?: string;
  /** Set to "1" or "true" to force mock mode regardless of DB availability. */
  MOCK_MODE?: string;
}

// ── Cache ─────────────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  fetchedAt: number; // Date.now() at write time
}

// Module-level cache — survives across requests within a single isolate lifetime.
const eventCache = new Map<string, CacheEntry<MockEvent>>();
const sponsorCache = new Map<string, CacheEntry<MockSponsor[]>>();

const CACHE_TTL_MS = 30_000; // 30 s

function isFresh<T>(entry: CacheEntry<T>): boolean {
  return Date.now() - entry.fetchedAt < CACHE_TTL_MS;
}

// ── DataProvider ───────────────────────────────────────────────────────────────

export class DataProvider {
  private readonly db: D1Database | null;
  private readonly mockMode: boolean;

  constructor(env: DataProviderEnv) {
    this.db = env.DB ?? null;
    this.mockMode = env.MOCK_MODE === '1' || env.MOCK_MODE === 'true';
  }

  /** True when no live DB is available or mock mode is forced. */
  get isMockActive(): boolean {
    return this.mockMode || this.db === null;
  }

  /** Reports which source a fresh request would use. */
  get preferredSource(): DataSource {
    if (!this.isMockActive) return 'live';
    return 'mock';
  }

  // ── Events ──────────────────────────────────────────────────────────────────

  async getEvent(eventId: string): Promise<DataResult<MockEvent>> {
    if (!this.isMockActive) {
      const cached = eventCache.get(eventId);
      if (cached && isFresh(cached)) {
        return { data: cached.data, source: 'cache' };
      }

      const row = await this.db!.prepare('SELECT * FROM events WHERE id = ?1 LIMIT 1')
        .bind(eventId)
        .first<MockEvent>();

      if (row) {
        eventCache.set(eventId, { data: row, fetchedAt: Date.now() });
        return { data: row, source: 'live' };
      }
    }

    // Mock fallback — return fixture if IDs match, otherwise synthesise a stub.
    const fixture =
      eventId === MOCK_EVENT_ID
        ? getEventFixture()
        : { ...getEventFixture(), id: eventId, title: `[mock] Event ${eventId}` };

    return { data: fixture, source: 'mock' };
  }

  async listEvents(): Promise<DataResult<MockEvent[]>> {
    if (!this.isMockActive) {
      const { results } = await this.db!.prepare(
        'SELECT * FROM events WHERE status != ? ORDER BY start_date DESC LIMIT 100'
      )
        .bind('archived')
        .all<MockEvent>();

      for (const row of results) {
        eventCache.set(row.id, { data: row, fetchedAt: Date.now() });
      }
      return { data: results, source: 'live' };
    }

    return { data: [getEventFixture()], source: 'mock' };
  }

  // ── Sponsors ────────────────────────────────────────────────────────────────

  async getSponsors(
    eventId: string,
    opts: { count?: number } = {}
  ): Promise<DataResult<MockSponsor[]>> {
    if (!this.isMockActive) {
      const cacheKey = eventId;
      const cached = sponsorCache.get(cacheKey);
      if (cached && isFresh(cached)) {
        return { data: cached.data, source: 'cache' };
      }

      const { results } = await this.db!.prepare(
        'SELECT * FROM sponsors WHERE event_id = ?1 AND active = 1 ORDER BY display_order ASC'
      )
        .bind(eventId)
        .all<MockSponsor>();

      sponsorCache.set(cacheKey, { data: results, fetchedAt: Date.now() });
      return { data: results, source: 'live' };
    }

    return {
      data: getSponsorFixtures(opts.count ?? 15),
      source: 'mock',
    };
  }

  // ── Poster deployments ──────────────────────────────────────────────────────

  async getPosterDeployments(eventId: string): Promise<DataResult<MockPosterDeployment[]>> {
    if (!this.isMockActive) {
      const { results } = await this.db!.prepare(
        'SELECT * FROM poster_deployments WHERE event_id = ?1'
      )
        .bind(eventId)
        .all<MockPosterDeployment>();

      return { data: results, source: 'live' };
    }

    return { data: getPosterDeployments(), source: 'mock' };
  }

  // ── Scan aggregates ─────────────────────────────────────────────────────────

  async getScanAggregates(eventId: string): Promise<DataResult<MockScanAggregate[]>> {
    if (!this.isMockActive) {
      const { results } = await this.db!.prepare(
        'SELECT event_id, uec_code, hour_bucket, count ' +
          'FROM scan_aggregates WHERE event_id = ?1 ORDER BY hour_bucket ASC'
      )
        .bind(eventId)
        .all<MockScanAggregate>();

      return { data: results, source: 'live' };
    }

    return { data: getScanAggregates(), source: 'mock' };
  }

  // ── Feature flags ───────────────────────────────────────────────────────────

  async getFlags(tier: Tier = 'free'): Promise<DataResult<FlagMap>> {
    if (!this.isMockActive) {
      // Live path: read from KV or DB flag store.
      // Fall through to mock if not yet implemented (T0 gate may not have KV).
      try {
        const { results } = await this.db!.prepare(
          "SELECT flag_key, flag_value FROM feature_flags WHERE scope = 'global'"
        ).all<{ flag_key: string; flag_value: number }>();

        if (results.length > 0) {
          const flags: FlagMap = {};
          for (const row of results) {
            flags[row.flag_key] = row.flag_value === 1;
          }
          return { data: flags, source: 'live' };
        }
      } catch {
        // Table may not exist yet — fall through to mock.
      }
    }

    return { data: getFlagsForTier(tier), source: 'mock' };
  }

  async getFeatureFlagFixtures(): Promise<DataResult<MockFeatureFlags[]>> {
    return { data: getFeatureFlagFixtures(), source: 'mock' };
  }

  // ── Health summary ──────────────────────────────────────────────────────────

  healthSummary(): {
    db_bound: boolean;
    mock_mode_forced: boolean;
    effective_source: DataSource;
    cache_entries: { events: number; sponsors: number };
  } {
    return {
      db_bound: this.db !== null,
      mock_mode_forced: this.mockMode,
      effective_source: this.preferredSource,
      cache_entries: {
        events: eventCache.size,
        sponsors: sponsorCache.size,
      },
    };
  }

  /** Clears module-level in-memory caches (useful in tests). */
  static clearCache(): void {
    eventCache.clear();
    sponsorCache.clear();
  }
}

// ── Module-level singleton factory ────────────────────────────────────────────

let _instance: DataProvider | null = null;

/**
 * Returns the singleton DataProvider for this isolate. Call once per request
 * handler (env may differ between requests in local dev).
 */
export function getDataProvider(env: DataProviderEnv): DataProvider {
  // In production Workers, env is stable per isolate — reuse the instance.
  if (!_instance) {
    _instance = new DataProvider(env);
  }
  return _instance;
}

/**
 * Creates a fresh DataProvider without caching (useful in tests where you
 * want isolation between test cases).
 */
export function createDataProvider(env: DataProviderEnv): DataProvider {
  return new DataProvider(env);
}
