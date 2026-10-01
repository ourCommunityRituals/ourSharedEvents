/**
 * Schema Verification Tests — runs in CI after every migration apply.
 *
 * Gates:
 *   1. All 14 tables exist post-migration
 *   2. PII firewall: scans table has no user_email, user_name, ip_address columns
 *   3. scan_aggregates is NOT writable via user-facing route handlers
 *   4. All expected indexes exist (30 custom indexes)
 *   5. Column counts match schema spec per table
 *
 * Migration SQL and source files are injected at build time via vitest.config.ts
 * `define` constants (Workers runtime cannot use node:fs).
 */

import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';

// ── Test env bindings (injected via vitest.config.ts miniflare bindings) ─────
// Workers runtime cannot use node:fs — migration SQL and source files are
// read at config time and passed as string bindings.
interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string; // JSON array of SQL statements
  TEST_SOURCE_FILES_JSON: string;
  TEST_WRANGLER_TOML: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const EXPECTED_TABLES = [
  'corridor_readiness_latch', // 0082 (VISION §6.2b — a corridor's map, once open, stays open)
  'corridor_regulatory_status',
  'corridors',
  'event_templates',
  'event_type_registry',
  'event_type_category_registry', // 0076 (OSE-1344 — Category → Type picker)
  'events',
  'node_hierarchy',
  'poster_deployments',
  'scan_aggregates',
  'scan_node_returns', // 0062 (OSE-798 A1 — session side of the split scan path)
  'scan_placement_events', // 0062 (OSE-798 A1 — placement side of the split scan path)
  'shortlinks', // OSE-240 (migration 0030)
  'sponsor_areas',
  'sponsor_asset', // 0066 (OSE-799 A2 — durable creative)
  'sponsor_business', // 0065 (OSE-799 A2 — durable identity)
  'sponsor_event_types',
  'sponsor_impressions',
  'sponsor_placement', // 0067 (OSE-799 A2 — per-event attachment; replaces sponsors)
  'subscribers',
] as const;

const EXPECTED_INDEXES = [
  // Original (migrations 0001-0007)
  'idx_events_brand_status',
  'idx_events_slug',
  'idx_poster_deployments_event_id',
  'idx_poster_deployments_qr_token',
  // Split sponsor identity (migration 0065-0067 — OSE-799 A2): idx_sponsors_* retired
  'idx_sponsor_business_brand',
  'idx_sponsor_business_h3_res7',
  'idx_sponsor_business_active', // 0068
  'idx_sponsor_asset_business',
  'idx_sponsor_placement_event',
  'idx_sponsor_placement_business',
  'idx_sponsor_placement_locality',
  // Split scan path (migration 0062 — OSE-798 A1): scans + idx_scans_* retired
  'idx_spe_event_poster',
  'idx_snr_event_bucket',
  'idx_scan_aggregates_event_date',
  // NCR v2 hierarchy (migration 0010)
  'idx_node_hierarchy_brand_level',
  'idx_node_hierarchy_parent',
  'idx_corridors_brand',
  'idx_corridors_status',
  'idx_corridors_signal_class',
  // Corridor growth model (migration 0011)
  'idx_corridors_parent',
  'idx_corridors_growth_pattern',
  'idx_node_hierarchy_legal_tier', // column renamed by 0077 (OSE-1221); index name unchanged
  // Ring emergence support (migration 0012)
  'idx_corridors_directionality',
  'idx_corridors_temporal',
  'idx_node_hierarchy_ring_role',
  // Event templates (migration 0014)
  'idx_event_templates_category',
  // Sponsor event types (migration 0019)
  'idx_sponsor_event_types_sponsor',
  'idx_sponsor_event_types_template',
  // Sponsor areas (migration 0020)
  'idx_sponsor_areas_sponsor',
  'idx_sponsor_areas_zip',
  // Sponsor impressions (migration 0022)
  'idx_sponsor_impressions_sponsor',
  'idx_sponsor_impressions_event',
  // Regulatory schema (migration 0023)
  'idx_event_type_registry_phase',
  'idx_event_type_registry_uec',
  'idx_event_type_registry_category', // 0076 (OSE-1344)
  'idx_corridor_regulatory_status_corridor',
  // Admin audit log (migration 0026 — OSE-212)
  'idx_admin_audit_log_created_at',
  'idx_admin_audit_log_actor',
  'idx_admin_audit_log_resource',
  'idx_admin_audit_log_brand_created', // 0087 (AUD-3 Phase B brand-scoped audit view)
  'idx_snr_country_nonnull', // 0088 (OSE-1460 bounded country cleanup)
  'idx_anon_id_returns_last_seen', // 0089 (OSE-1460 rolling-window export)
  'idx_anon_id_returns_computed_at', // 0089 (OSE-1460 watermark probe)
  'idx_admin_brand_memberships_email', // 0050 (OSE-666/B2 membership scope lookup)
  'idx_events_data_class', // 0052 (OSE-606/608 demo data-class filtering)
  // OSE-240 (migration 0030)
  'idx_shortlinks_event_id',
  'idx_shortlinks_created_at',
  'idx_shortlinks_event_kind', // 0073 (Rb) — per-destination click-out reads
  'idx_events_status_updated', // 0075 — admin ?status= filter + stale-draft sweep
  'idx_events_created_by', // 0075 — admin ?mine=1 filter
  // Campaigns (migrations 0039/0040) — idx_sponsors_is_local + idx_sponsors_campaign_id
  // retired by OSE-799 A2 (0067): locality/campaign moved to sponsor_placement.
  'idx_campaigns_brand_id',
  // corridor_density_snapshots (migration 0044 — OER longitudinal archive)
  'idx_cds_corridor_dow_hour',
  'idx_cds_snapshot_date',
  // sponsor_impressions geo (migration 0048 — OSE-635 digital click geo privacy)
  'idx_sponsor_impressions_h3_res7',
] as const;

const EXPECTED_COLUMN_COUNTS: Record<string, number> = {
  // events: 23 (pre-OSE-236) + 6 (migration 0029: what_short, who_host,
  // why_purpose, how_details, where_address, corridor_id) + 1 (migration
  // 0034: series_id, OSE-272 Session 2) + 2 (migration 0037: h3_res9,
  // h3_res7, OSE-450 S-6 H3 NCR tagging) = 32; +3 (migration 0049: price_cents,
  // price_model, price_note — OSE-655 "HOW MUCH" event price display) = 35.
  // This count is the canonical floor — any future column add/drop on
  // events MUST bump this number in the same PR, surfacing the change
  // in code review.
  // 35 (pre-0051) + 3 (migration 0051: who_story, who_image_url,
  // what_video_url — OSE-664 rich WHO/WHAT authoring) = 38.
  // + 1 (migration 0052: data_class — OSE-606/608 demo data class) = 39.
  events: 46, // 0070 is_published; 0072 what_url; 0074 what_url_enabled + what_url_type (R3); 0075 created_by; 0078 starts_at (OSE-1313); 0085 settings_json (OSE-869)
  // OSE-799 A2 (0065-0067): `sponsors` (32) retired → split into three tables.
  // sponsor_business: id, brand_id, name, website_url, business_type, lat, lon,
  //   h3_res9, h3_res7, created_at, updated_at = 11.
  sponsor_business: 17, // +is_active (0068 — lifecycle lives on the business); +tier (0081, OSE-1316); +display_name/address_line/contact_phone/contact_email (0083 — public card)
  // sponsor_asset: id, sponsor_business_id, format, url, content_type, focal_x,
  //   focal_y, crop_rect, validated_at, created_at, updated_at = 11.
  sponsor_asset: 11, // 0081 rebuilds it (CHECK += logo_compact), same 11 columns
  corridor_readiness_latch: 3, // 0082: brand_id, h3_res7, latched_at
  // sponsor_placement: id, sponsor_business_id, event_id, tier, campaign_id, source,
  //   polarity, locality_band, click_token, display_token, is_active, created_at,
  //   updated_at = 13.
  sponsor_placement: 15, // +organizer_accepted, +sponsor_accepted (0068 — two-sided acceptance)
  // poster_deployments: 10 (pre-0047) + 2 (migration 0047: h3_res9, h3_res7,
  // OSE poster geo-tagging — res9 Node precision for physical placement attribution) = 12.
  // + 1 (migration 0079, OSE-1357: address — the place the poster hangs) = 13.
  // + 1 (migration 0082, OSE-1357 tiers: placement_type venue|community) = 14.
  poster_deployments: 14,
  // Split scan path (migration 0062 — OSE-798 A1): scans (10) retired →
  // scan_placement_events (id, event_id, poster_deployment_id, scan_bucket,
  // created_at = 5) + scan_node_returns (id, event_id, anonymous_id,
  // user_agent_hash, country_code, scan_bucket, created_at = 7).
  scan_placement_events: 5,
  scan_node_returns: 7,
  // scan_aggregates: 9 (pre-OSE-450) + 2 (migration 0038: h3_res9, h3_res7,
  // OSE-450 S-6.1.2 — denormalized NCR cells for density queries) = 11.
  scan_aggregates: 11,
  // subscribers: 5 (pre-0071) − plaintext email + email_hash + email_encrypted
  // (migration 0071, A-5 data-at-rest doctrine) = 6.
  subscribers: 6,
  node_hierarchy: 14,
  corridors: 22,
  sponsor_event_types: 5,
  sponsor_areas: 7,
  // sponsor_impressions: 7 (pre-OSE-635) + 1 (h3_res7, migration 0048) = 8.
  sponsor_impressions: 8,
  // + category_code (migration 0076, OSE-1344) = 11.
  event_type_registry: 11,
  corridor_regulatory_status: 5,
  // OSE-240 (migration 0030): code TEXT PK, event_id TEXT FK, created_at TEXT,
  // clicks INTEGER, last_clicked_at TEXT = 5; +target_url +kind (migration 0073, Rb) = 7.
  shortlinks: 8, // +poster_position (0080, OSE-1357 part 2)
};
// sponsors (32 cols) retired by OSE-799 A2 (0065-0067): identity → sponsor_business,
// creative → sponsor_asset, per-event attachment → sponsor_placement (counts above).

// ── Apply migrations before tests ────────────────────────────────────────────

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  const statements: string[] = JSON.parse(tenv.TEST_MIGRATION_STATEMENTS);
  for (const stmt of statements) {
    try {
      await env.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // ALTER TABLE ADD COLUMN is not idempotent in SQLite —
      // "duplicate column" on re-run means the column already exists, which is fine.
      if (msg.includes('duplicate column name')) continue;
      throw e;
    }
  }
}

beforeAll(async () => {
  await applyMigrations();
});

// ── Gate 1: Table existence ──────────────────────────────────────────────────

describe('Gate 1: Table existence', () => {
  test('all expected tables exist post-migration', async () => {
    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"
    ).all();

    const names = tables.results.map((r: Record<string, unknown>) => r.name);
    EXPECTED_TABLES.forEach((t) => expect(names).toContain(t));
  });

  test('each table is queryable (not missing)', async () => {
    for (const table of EXPECTED_TABLES) {
      const result = await env.DB.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).first<{
        cnt: number;
      }>();
      expect(result?.cnt).toBeGreaterThanOrEqual(0);
    }
  });
});

// ── Gate 2: Column counts match schema spec ──────────────────────────────────

describe('Gate 2: Column counts', () => {
  for (const [table, expectedCount] of Object.entries(EXPECTED_COLUMN_COUNTS)) {
    test(`${table} has ${expectedCount} columns`, async () => {
      const info = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
      expect(info.results.length).toBe(expectedCount);
    });
  }
});

// ── Gate 3: PII firewall ─────────────────────────────────────────────────────

describe('Gate 3: PII firewall', () => {
  // Split scan path (migration 0062 — OSE-798 A1): scans → scan_node_returns
  // (session side) + scan_placement_events (placement side). The PII firewall
  // now guards both, and the session side must carry only bucketed time.
  test('split scan tables have NO user_email / user_name / ip_address column', async () => {
    for (const table of ['scan_node_returns', 'scan_placement_events']) {
      const info = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
      const cols = info.results.map((r: Record<string, unknown>) => r.name);
      expect(cols, `${table} must not carry raw PII`).not.toContain('user_email');
      expect(cols, `${table} must not carry raw PII`).not.toContain('user_name');
      expect(cols, `${table} must not carry raw PII`).not.toContain('ip_address');
    }
  });

  test('scan_node_returns has NO exact timestamp column (bucketed time only)', async () => {
    const info = await env.DB.prepare('PRAGMA table_info(scan_node_returns)').all();
    const cols = info.results.map((r: Record<string, unknown>) => r.name);
    expect(cols).not.toContain('exact_timestamp');
    expect(cols).not.toContain('scanned_at');
    expect(cols).toContain('scan_bucket');
  });

  test('no route handler INSERTs PII columns into the split scan tables', () => {
    const sources: Record<string, string> = JSON.parse(
      (env as unknown as TestEnv).TEST_SOURCE_FILES_JSON
    );
    for (const [, content] of Object.entries(sources)) {
      if (/INSERT\s+INTO\s+scan_(node_returns|placement_events)/i.test(content)) {
        expect(content).not.toMatch(/user_email/i);
        expect(content).not.toMatch(/user_name/i);
        expect(content).not.toMatch(/ip_address/i);
      }
    }
  });
});

// ── Gate 4: scan_aggregates write protection ─────────────────────────────────

describe('Gate 4: scan_aggregates write protection', () => {
  test('scan_aggregates is NOT writable via user-facing route handlers', () => {
    const sources: Record<string, string> = JSON.parse(
      (env as unknown as TestEnv).TEST_SOURCE_FILES_JSON
    );
    for (const [path, content] of Object.entries(sources)) {
      const normalPath = path.replace(/\\/g, '/');
      // Skip test fixtures and spec files — only enforce on handler/lib source
      if (normalPath.includes('/tests/')) continue;
      // shared-report.ts is the cron lib — the ONLY permitted writer.
      // aggregateScanBuckets() (OSE-632) is a scheduled worker function, not a route.
      if (normalPath.endsWith('lib/shared-report.ts')) continue;
      expect(content, `${path} must not INSERT into scan_aggregates`).not.toMatch(
        /INSERT\s+.*scan_aggregates/i
      );
    }
  });

  test('scan_aggregates INSERT exists in shared-report.ts (the permitted cron writer)', () => {
    const sources: Record<string, string> = JSON.parse(
      (env as unknown as TestEnv).TEST_SOURCE_FILES_JSON
    );
    const entry = Object.entries(sources).find(([p]) =>
      p.replace(/\\/g, '/').endsWith('lib/shared-report.ts')
    );
    expect(entry, 'shared-report.ts not in TEST_SOURCE_FILES_JSON').toBeDefined();
    expect(entry![1]).toMatch(/INSERT\s+.*scan_aggregates/i);
  });
});

// ── Gate 5: Index verification ───────────────────────────────────────────────

describe('Gate 5: Index verification', () => {
  test('all 77 custom indexes exist', async () => {
    // 35 (pre-OSE-272) + 4 (OSE-272 Session 2: idx_anon_id_returns_venue_visit,
    // idx_event_series_venue_state, idx_event_series_venue_dow_hour,
    // idx_events_series_start) + 1 (idx_sponsors_is_local, OSE-330 Phase 2
    // — Local Sponsor Covenant enforcement, migration 0036) + 2
    // (idx_campaigns_brand_id, idx_sponsors_campaign_id — migrations 0039/0040) = 42
    // + 4 (idx_security_metrics_*, idx_security_alerts_* — migration 0042)
    // + 6 (idx_report_access_log_*, idx_export_manifest_* — migration 0043) = 52
    // + 2 (idx_cds_corridor_dow_hour, idx_cds_snapshot_date — migration 0044) = 54
    // + 1 (idx_sponsor_impressions_h3_res7 — migration 0048, OSE-635) = 55
    // + 1 (idx_admin_brand_memberships_email — migration 0050, OSE-666/B2) = 56.
    // + 1 (idx_events_data_class — migration 0052, OSE-606/608) = 57.
    // + 1 (idx_events_brand_h3res7_status_start — migration 0069, OSE-1242) = 58.
    // + 3 (idx_sponsor_business_draft_brand/_event/_status — migration 0053, OSE-724) = 60.
    // + 1 (idx_sponsor_asset_draft_token — migration 0054, OSE-725) = 61.
    // + 2 (idx_template_event_types_template/_uec — migration 0056, OSE-727) = 63.
    // + 1 (idx_business_type_category_map_bt — migration 0059, OSE-730) = 64.
    // − 3 + 2 (migration 0062, OSE-798 A1 split scan path): DROP TABLE scans
    //   removes idx_scans_event_bucket + idx_scans_poster_deployment, and
    //   idx_scans_anonymous is dropped; idx_spe_event_poster + idx_snr_event_bucket
    //   are added = 63.
    // − 3 + 6 (migration 0065-0067, OSE-799 A2 split sponsor identity): DROP TABLE
    //   sponsors removes idx_sponsors_event_id/_is_local/_campaign_id; add
    //   idx_sponsor_business_brand/_h3_res7, idx_sponsor_asset_business,
    //   idx_sponsor_placement_event/_business/_locality = 66.
    // + 1 (idx_events_published_brand_h3res7_start — migration 0070, OSE-1245) = 67. (The recreated
    //   sponsor_event_types/areas/impressions indexes keep their names → net 0.)
    const indexes = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name"
    ).all();

    const names = indexes.results.map((r: Record<string, unknown>) => r.name);
    // + 2 (idx_events_status_updated, idx_events_created_by — migration 0075) = 72.
    expect(names.length).toBe(77); // +2 0089 idx_anon_id_returns_last_seen + idx_anon_id_returns_computed_at; +1 0088 idx_snr_country_nonnull; +1 0087 idx_admin_audit_log_brand_created; +1 0076 idx_event_type_registry_category; // 0070 idx_events_published_brand_h3res7_start; 0073 idx_shortlinks_event_kind (Rb); 0075 ×2
    EXPECTED_INDEXES.forEach((idx) => expect(names).toContain(idx));
  });
});
