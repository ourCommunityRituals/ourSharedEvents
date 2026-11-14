/**
 * mock-data.ts — Deterministic fixture library for OSE (MOCK-1a / OSE-147).
 *
 * Every export is pure and returns identical data on every call — no randomness,
 * no Date.now(). Safe to import in Vitest unit tests, Playwright fixtures, and
 * wrangler dev local mode without any live bindings.
 *
 * Invariants preserved:
 *   - No PII in mock data (anonymous ID format: anon_{uuid})
 *   - Email fields store the literal string "[mock-encrypted]" — never real addresses
 *   - All IDs follow repo conventions: evt_, anon_, sp_, etc.
 *   - Timestamps bucket to the nearest hour (privacy invariant)
 *   - Sponsor count is configurable 1–15 via getSponsorFixtures(count)
 */

import { allCodes } from './uec/index.js';

// ── Shared types (mirrors DB columns) ─────────────────────────────────────────

export type EventState = 'draft' | 'ready' | 'active' | 'archived';
export type EventPhase = 'pre' | 'active' | 'post' | 'closed';
export type Tier = 'free' | 'mid' | 'enterprise';

export interface MockEvent {
  id: string;
  brand_id: string;
  title: string;
  slug: string;
  status: EventState;
  phase: EventPhase;
  description: string | null;
  location: string | null;
  cover_image_url: string | null;
  timezone: string;
  /** OSE-1313 — canonical UTC start instant; null/absent for date-only events. */
  starts_at?: string | null;
  template_id: string | null;
  event_type_id: string | null;
  what_short: string | null;
  who_host: string | null;
  why_purpose: string | null;
  how_details: string | null;
  where_address: string | null;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  updated_at: string;
  lat: number | null;
  lon: number | null;
  h3_res9: string | null;
  h3_res7: string | null;
  /** Migration 0108 (OSE-2012): 'in_person', 'online' or 'both'. */
  attendance_mode?: string | null;
  /** Migration 0105: 'business' or 'address'; absent in fixtures. */
  place_kind?: string | null;
  corridor_id: string | null;
  legal_clearance_tier: string | null;
}

export interface MockSponsor {
  id: string;
  brand_id: string;
  event_id: string;
  name: string;
  tier: 'premium' | 'mid' | 'local';
  area: string;
  event_type: string;
  logo_url: string | null;
  website_url: string | null;
  display_order: number;
  active: boolean;
}

export interface MockPosterDeployment {
  id: string;
  event_id: string;
  brand_id: string;
  lat: number;
  lon: number;
  label: string;
  deployed_at: string;
}

export interface MockScanRecord {
  id: string;
  event_id: string;
  anon_id: string;
  uec_code: string;
  scanned_at: string; // bucketed to hour
  lat: number | null;
  lon: number | null;
}

export interface MockScanAggregate {
  event_id: string;
  uec_code: string;
  hour_bucket: string;
  count: number;
}

export interface MockRegistration {
  id: string;
  event_id: string;
  anon_id: string;
  submitted_at: string;
  party_size: number;
  source: string;
}

export interface MockCheckin {
  id: string;
  event_id: string;
  anon_id: string;
  checked_in_at: string;
  method: 'qr' | 'manual';
}

export interface MockSurvey {
  id: string;
  event_id: string;
  anon_id: string;
  submitted_at: string;
  rating: number; // 1–5
  would_return: boolean;
  comment_length: number; // length only — no content stored (privacy)
}

export interface MockEmailSignup {
  id: string;
  event_id: string;
  anon_id: string;
  email_hash: string; // SHA-256 of address — never raw
  email_encrypted: string; // "[mock-encrypted]" sentinel
  signed_up_at: string;
}

export type FlagMap = Record<string, boolean>;

export interface MockFeatureFlags {
  tier: Tier;
  flags: FlagMap;
  scope: 'global' | 'event';
  event_id: string | null;
}

// ── Core constants ─────────────────────────────────────────────────────────────

export const MOCK_EVENT_ID = 'evt_00000000-0000-0000-0000-riph-bocce-001';
export const MOCK_BRAND_ID = 'riph-blue-island';
export const MOCK_BASE_DATE = '2026-08-02'; // frozen "today" for mock data

// Rock Island Public House, 13328 Olde Western Ave, Blue Island, IL 60406 —
// the brain's primary activation anchor (OCR_VISION.md, corridor-definitions.yaml).
// The Western Ave corridor spine funnels the south-Chicagoland community between
// nodes (Blue Island ↔ Morgan Park ↔ Beverly). Previously drifted to Beverly +
// a Colorado H3 cell — reconciled to the real anchor (OSE-995).
const BLUE_ISLAND_LAT = 41.6572;
const BLUE_ISLAND_LON = -87.68;

// ── 1. Event fixture ───────────────────────────────────────────────────────────

export function getEventFixture(): MockEvent {
  return {
    id: MOCK_EVENT_ID,
    brand_id: MOCK_BRAND_ID,
    title: 'RIPH Bocce League — Blue Island Summer Classic',
    slug: 'riph-bocce-blue-island-summer-classic',
    status: 'active',
    phase: 'active',
    description:
      'The Rock Island Public House summer bocce league championship. ' +
      'All skill levels welcome. Food and drinks available.',
    location: 'Rock Island Public House, 13328 Olde Western Ave, Blue Island, IL 60406',
    cover_image_url: null,
    timezone: 'America/Chicago',
    template_id: null,
    event_type_id: null,

    what_short: 'Summer bocce championship for the Blue Island / Western Ave corridor.',
    who_host: 'Rock Island Public House (RIPH)',
    why_purpose:
      'Recurring community gathering that funnels the Western Ave corridor — ' +
      'Blue Island, Morgan Park, and Beverly neighbors — between its venues. ' +
      'Proceeds support neighborhood businesses.',
    how_details:
      'Round-robin pool play followed by single-elimination bracket. ' +
      'Teams of 2. Check in at the bar.',
    where_address: '13328 Olde Western Ave, Blue Island, IL 60406',

    start_date: '2026-08-02',
    end_date: '2026-08-02',
    created_at: '2026-07-01T10:00:00Z',
    updated_at: '2026-08-01T08:00:00Z',

    lat: BLUE_ISLAND_LAT,
    lon: BLUE_ISLAND_LON,
    h3_res9: '89266454447ffff',
    h3_res7: '872664544ffffff',
    corridor_id: 'blue-island',
    attendance_mode: 'in_person',

    legal_clearance_tier: 'tier-1',
  };
}

// ── 2. Sponsor fixtures ────────────────────────────────────────────────────────

// Real S. Western Ave corridor businesses (verified addresses). The premium/mid
// tiers are the up-corridor Beverly / Morgan Park regional draws the community
// funnels between; the local floor is Blue Island's own Uptown (Olde Western /
// Vermont St), immediately around RIPH. `is_local` (geo) is NOT modeled here —
// MockSponsor is the portfolio fixture; the season roster (getRiphSponsors)
// carries the is_local⟂tier orthogonality (OSE-995 / #25 / OSE-670).
const SPONSOR_POOL: Omit<MockSponsor, 'id' | 'event_id' | 'display_order'>[] = [
  // Premium tier (3) — well-known regional institutions on the Western Ave spine
  {
    brand_id: MOCK_BRAND_ID,
    name: 'Beverly Records', // 11612 S Western Ave — vinyl institution since 1967
    tier: 'premium',
    area: 'beverly-western',
    event_type: 'music',
    logo_url: null,
    website_url: null,
    active: true,
  },
  {
    brand_id: MOCK_BRAND_ID,
    name: 'Beverly Arts Center', // 2407 W 111th St — regional arts anchor since 1968
    tier: 'premium',
    area: 'beverly',
    event_type: 'arts',
    logo_url: null,
    website_url: null,
    active: true,
  },
  {
    brand_id: MOCK_BRAND_ID,
    name: 'Beggars Pizza', // 12660 Western Ave, Blue Island — founded here 1976
    tier: 'premium',
    area: 'blue-island',
    event_type: 'food',
    logo_url: null,
    website_url: null,
    active: true,
  },
  // Mid tier (6) — corridor corner placements, regionally known
  {
    brand_id: MOCK_BRAND_ID,
    name: 'Horse Thief Hollow', // 10827 S Western Ave — Beverly brewpub
    tier: 'mid',
    area: 'beverly-western',
    event_type: 'drinks',
    logo_url: null,
    website_url: null,
    active: true,
  },
  {
    brand_id: MOCK_BRAND_ID,
    name: 'Open Outcry Brewing', // 10934 S Western Ave — Morgan Park rooftop brewery
    tier: 'mid',
    area: 'morgan-park-western',
    event_type: 'drinks',
    logo_url: null,
    website_url: null,
    active: true,
  },
  {
    brand_id: MOCK_BRAND_ID,
    name: 'Natural Law Cocktail Club', // 13404 Olde Western Ave, Blue Island
    tier: 'mid',
    area: 'blue-island-uptown',
    event_type: 'drinks',
    logo_url: null,
    website_url: null,
    active: true,
  },
  {
    brand_id: MOCK_BRAND_ID,
    name: 'Cork & Kerry', // S Western Ave — Beverly Irish pub
    tier: 'mid',
    area: 'beverly-western',
    event_type: 'drinks',
    logo_url: null,
    website_url: null,
    active: true,
  },
  {
    brand_id: MOCK_BRAND_ID,
    name: 'Studious Coffee', // 2421 Grove St, Blue Island — Uptown cafe
    tier: 'mid',
    area: 'blue-island-uptown',
    event_type: 'food',
    logo_url: null,
    website_url: null,
    active: true,
  },
  {
    brand_id: MOCK_BRAND_ID,
    name: 'Beverly Phono Mart', // 1808 W 103rd St — Morgan Park record store
    tier: 'mid',
    area: 'morgan-park',
    event_type: 'music',
    logo_url: null,
    website_url: null,
    active: true,
  },
  // Local tier (6) — Blue Island's own Uptown floor, immediately around RIPH
  {
    brand_id: MOCK_BRAND_ID,
    name: 'Elsewhere Comics & Collectibles', // 2361 Vermont St — comics + game store
    tier: 'local',
    area: 'blue-island-uptown',
    event_type: 'games',
    logo_url: null,
    website_url: null,
    active: true,
  },
  {
    brand_id: MOCK_BRAND_ID,
    name: 'International Fades & Beauty', // 13319 Old Western Ave — next to RIPH
    tier: 'local',
    area: 'blue-island-uptown',
    event_type: 'services',
    logo_url: null,
    website_url: null,
    active: true,
  },
  {
    brand_id: MOCK_BRAND_ID,
    name: 'Blue Island-Robbins Neighborhood Network', // 13315 Olde Western Ave
    tier: 'local',
    area: 'blue-island-uptown',
    event_type: 'community',
    logo_url: null,
    website_url: null,
    active: true,
  },
  {
    brand_id: MOCK_BRAND_ID,
    name: 'OldTown Barbershop', // 12352 Western Ave, Blue Island
    tier: 'local',
    area: 'blue-island',
    event_type: 'services',
    logo_url: null,
    website_url: null,
    active: true,
  },
  {
    brand_id: MOCK_BRAND_ID,
    name: 'Blue Island Smoke Shop', // 11923 Western Ave
    tier: 'local',
    area: 'blue-island',
    event_type: 'retail',
    logo_url: null,
    website_url: null,
    active: true,
  },
  {
    brand_id: MOCK_BRAND_ID,
    name: "Iversen's Bakery", // Blue Island neighborhood bakery
    tier: 'local',
    area: 'blue-island',
    event_type: 'food',
    logo_url: null,
    website_url: null,
    active: true,
  },
];

/**
 * Returns up to `count` sponsor fixtures (1–15). Default: all 15.
 * Ordered: premium → mid → local, then alphabetically within tier.
 */
export function getSponsorFixtures(count: number = 15): MockSponsor[] {
  const clamped = Math.max(1, Math.min(15, count));
  return SPONSOR_POOL.slice(0, clamped).map((s, i) => ({
    ...s,
    id: `sp_mock_${String(i + 1).padStart(3, '0')}`,
    event_id: MOCK_EVENT_ID,
    display_order: i + 1,
  }));
}

// ── 3. Poster deployment fixtures ─────────────────────────────────────────────

export function getPosterDeployments(): MockPosterDeployment[] {
  return [
    {
      id: 'pd_mock_001',
      event_id: MOCK_EVENT_ID,
      brand_id: MOCK_BRAND_ID,
      lat: BLUE_ISLAND_LAT,
      lon: BLUE_ISLAND_LON,
      label: 'Blue Island — Rock Island Public House (RIPH, main entrance)',
      deployed_at: '2026-07-28T09:00:00Z',
    },
    {
      id: 'pd_mock_002',
      event_id: MOCK_EVENT_ID,
      brand_id: MOCK_BRAND_ID,
      lat: 41.7219,
      lon: -87.7025,
      label: 'Evergreen Park — 95th St & Kedzie',
      deployed_at: '2026-07-28T10:30:00Z',
    },
    {
      id: 'pd_mock_003',
      event_id: MOCK_EVENT_ID,
      brand_id: MOCK_BRAND_ID,
      lat: 41.7044,
      lon: -87.7524,
      label: 'Oak Lawn — 95th St & Cicero',
      deployed_at: '2026-07-29T08:00:00Z',
    },
  ];
}

// ── 4. Scan records (150, deterministic hourly buckets) ───────────────────────

const UEC_CODES = allCodes().map((c) => c.scan_hex);
const SCAN_HOURS = [
  '2026-08-02T10:00:00Z',
  '2026-08-02T11:00:00Z',
  '2026-08-02T12:00:00Z',
  '2026-08-02T13:00:00Z',
  '2026-08-02T14:00:00Z',
  '2026-08-02T15:00:00Z',
];

// Distribution: 10, 20, 35, 45, 30, 10 = 150 scans across 6 hours
const HOUR_COUNTS = [10, 20, 35, 45, 30, 10];

export function getScanRecords(): MockScanRecord[] {
  const records: MockScanRecord[] = [];
  let idx = 0;

  SCAN_HOURS.forEach((hour, hi) => {
    const count = HOUR_COUNTS[hi];
    for (let i = 0; i < count; i++) {
      const uec = UEC_CODES[idx % UEC_CODES.length];
      const anonSuffix = String(idx + 1).padStart(4, '0');
      records.push({
        id: `sc_mock_${String(idx + 1).padStart(4, '0')}`,
        event_id: MOCK_EVENT_ID,
        anon_id: `anon_00000000-0000-0000-0000-mock${anonSuffix}`,
        uec_code: uec,
        scanned_at: hour,
        lat: BLUE_ISLAND_LAT + (idx % 5) * 0.0001,
        lon: BLUE_ISLAND_LON - (idx % 3) * 0.0001,
      });
      idx++;
    }
  });

  return records;
}

// ── 5. Pre-computed scan aggregates ───────────────────────────────────────────

export function getScanAggregates(): MockScanAggregate[] {
  const records = getScanRecords();
  const buckets: Record<string, number> = {};

  for (const r of records) {
    const key = `${r.event_id}|${r.uec_code}|${r.scanned_at}`;
    buckets[key] = (buckets[key] ?? 0) + 1;
  }

  return Object.entries(buckets).map(([key, count]) => {
    const [event_id, uec_code, hour_bucket] = key.split('|');
    return { event_id, uec_code, hour_bucket, count };
  });
}

// ── 6. Registration fixtures (20) ─────────────────────────────────────────────

export function getRegistrationFixtures(): MockRegistration[] {
  return Array.from({ length: 20 }, (_, i) => ({
    id: `reg_mock_${String(i + 1).padStart(3, '0')}`,
    event_id: MOCK_EVENT_ID,
    anon_id: `anon_00000000-0000-0000-0000-reg0${String(i + 1).padStart(3, '0')}`,
    submitted_at: i < 10 ? '2026-07-30T14:00:00Z' : '2026-07-31T09:00:00Z',
    party_size: (i % 3) + 1,
    source:
      i % 4 === 0
        ? 'poster-qr'
        : i % 4 === 1
          ? 'public-page'
          : i % 4 === 2
            ? 'admin-link'
            : 'shortlink',
  }));
}

// ── 7. Checkin fixtures (50) ───────────────────────────────────────────────────

export function getCheckinFixtures(): MockCheckin[] {
  return Array.from({ length: 50 }, (_, i) => ({
    id: `ci_mock_${String(i + 1).padStart(3, '0')}`,
    event_id: MOCK_EVENT_ID,
    anon_id: `anon_00000000-0000-0000-0000-ci00${String(i + 1).padStart(3, '0')}`,
    checked_in_at: SCAN_HOURS[i % SCAN_HOURS.length],
    method: i % 5 === 0 ? 'manual' : 'qr',
  }));
}

// ── 8. Survey fixtures (10) ───────────────────────────────────────────────────

export function getSurveyFixtures(): MockSurvey[] {
  const ratings = [5, 5, 4, 5, 3, 5, 4, 4, 5, 5];
  return ratings.map((rating, i) => ({
    id: `sv_mock_${String(i + 1).padStart(3, '0')}`,
    event_id: MOCK_EVENT_ID,
    anon_id: `anon_00000000-0000-0000-0000-sv00${String(i + 1).padStart(3, '0')}`,
    submitted_at: '2026-08-02T16:00:00Z',
    rating,
    would_return: rating >= 4,
    comment_length: rating === 5 ? 0 : 42, // length only — no content
  }));
}

// ── 9. Email signup fixtures (5) ──────────────────────────────────────────────

export function getEmailSignupFixtures(): MockEmailSignup[] {
  return Array.from({ length: 5 }, (_, i) => ({
    id: `es_mock_${String(i + 1).padStart(3, '0')}`,
    event_id: MOCK_EVENT_ID,
    anon_id: `anon_00000000-0000-0000-0000-es00${String(i + 1).padStart(3, '0')}`,
    email_hash: `mock_hash_${String(i + 1).padStart(64, '0')}`, // 64-char sentinel
    email_encrypted: '[mock-encrypted]', // never a real address
    signed_up_at: '2026-08-02T13:00:00Z',
  }));
}

// ── 10. Feature flag fixtures (all 3 tiers) ───────────────────────────────────

const FLAG_KEYS = [
  'forms.register',
  'forms.checkin',
  'forms.survey',
  'forms.email-signup',
  'config.self-serve',
  'config.event-settings',
  'analytics.shared-report',
  'report.export-json',
  'report.advanced-metrics',
  'report.export-pdf',
  'report.custom-window',
  'report.portfolio',
  'assets.file-upload',
  'assets.custom-qr',
  'branding.white-label',
  'branding.custom-domain',
  'branding.color-palette',
] as const;

export type FlagKey = (typeof FLAG_KEYS)[number];

const TIER_FLAGS: Record<Tier, Record<FlagKey, boolean>> = {
  free: {
    'forms.register': true,
    'forms.checkin': true,
    'forms.survey': false,
    'forms.email-signup': false,
    'config.self-serve': false,
    'config.event-settings': false,
    'analytics.shared-report': false,
    'report.export-json': false,
    'report.advanced-metrics': false,
    'report.export-pdf': false,
    'report.custom-window': false,
    'report.portfolio': false,
    'assets.file-upload': false,
    'assets.custom-qr': false,
    'branding.white-label': false,
    'branding.custom-domain': false,
    'branding.color-palette': false,
  },
  mid: {
    'forms.register': true,
    'forms.checkin': true,
    'forms.survey': true,
    'forms.email-signup': true,
    'config.self-serve': true,
    'config.event-settings': true,
    'analytics.shared-report': true,
    'report.export-json': false,
    'report.advanced-metrics': true,
    'report.export-pdf': false,
    'report.custom-window': false,
    'report.portfolio': false,
    'assets.file-upload': false,
    'assets.custom-qr': false,
    'branding.white-label': false,
    'branding.custom-domain': false,
    'branding.color-palette': false,
  },
  enterprise: {
    'forms.register': true,
    'forms.checkin': true,
    'forms.survey': true,
    'forms.email-signup': true,
    'config.self-serve': true,
    'config.event-settings': true,
    'analytics.shared-report': true,
    'report.export-json': true,
    'report.advanced-metrics': true,
    'report.export-pdf': true,
    'report.custom-window': true,
    'report.portfolio': true,
    'assets.file-upload': true,
    'assets.custom-qr': true,
    'branding.white-label': true,
    'branding.custom-domain': true,
    'branding.color-palette': true,
  },
};

export function getFeatureFlagFixtures(): MockFeatureFlags[] {
  return (['free', 'mid', 'enterprise'] as Tier[]).map((tier) => ({
    tier,
    flags: TIER_FLAGS[tier],
    scope: 'global',
    event_id: null,
  }));
}

export function getFlagsForTier(tier: Tier): FlagMap {
  return { ...TIER_FLAGS[tier] };
}

// ── Convenience: full snapshot ─────────────────────────────────────────────────

export interface MockSnapshot {
  event: MockEvent;
  sponsors: MockSponsor[];
  posterDeployments: MockPosterDeployment[];
  scanRecords: MockScanRecord[];
  scanAggregates: MockScanAggregate[];
  registrations: MockRegistration[];
  checkins: MockCheckin[];
  surveys: MockSurvey[];
  emailSignups: MockEmailSignup[];
  featureFlags: MockFeatureFlags[];
}

export function getMockSnapshot(sponsorCount: number = 15): MockSnapshot {
  return {
    event: getEventFixture(),
    sponsors: getSponsorFixtures(sponsorCount),
    posterDeployments: getPosterDeployments(),
    scanRecords: getScanRecords(),
    scanAggregates: getScanAggregates(),
    registrations: getRegistrationFixtures(),
    checkins: getCheckinFixtures(),
    surveys: getSurveyFixtures(),
    emailSignups: getEmailSignupFixtures(),
    featureFlags: getFeatureFlagFixtures(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// RIPH multi-league demo dataset (OSE-608 / OSE-995)
//
// The shared dataset all three demo sites render: RIPH (Rock Island Public House,
// Blue Island) as a multi-container sponsor property — one venue, four recurring
// containers (trivia / bocce / pinball / cigar social club), campaign-grouped
// sponsors distributed across
// Local / Mid / Premium, a mock season with realistic scan distributions, real
// H3 cells for the corridor map, and — deliberately — at least one visible ladder
// fallback bucket (the "too small alone" honesty feature on display).
//
// Everything here is data_class = 'demo': labeled at write time, lives in prod
// indefinitely, never enters vintage / reports-for-sale / research corpus. Pure &
// deterministic (no Date.now / randomness) so reset is one call and byte-identical.
// ═══════════════════════════════════════════════════════════════════════════════

/** Third data class beside production/synthetic (OSE-606 doctrine, forward-compatible). */
export type DataClass = 'production' | 'synthetic' | 'demo';

export interface MockLeague {
  id: string;
  brand_id: string;
  name: string;
  event_type: string;
  slug: string;
}

export interface MockCampaign {
  id: string;
  brand_id: string;
  title: string;
  /** Tier CLASS of the campaign (display/covenant vocabulary), not report depth. */
  tier: 'premium' | 'mid' | 'local';
  status: 'active';
}

/** One instance of a league across the season — an event carrying its league + data_class. */
export interface MockSeasonEvent {
  id: string;
  brand_id: string;
  league_id: string;
  title: string;
  slug: string;
  event_type: string;
  status: EventState;
  phase: EventPhase;
  start_date: string;
  end_date: string;
  timezone: string;
  lat: number;
  lon: number;
  h3_res9: string;
  h3_res7: string;
  corridor_id: string;
  data_class: DataClass;
  /** Unique gatherings (headcount) — the free-tier "smoke test" number. */
  headcount: number;
}

/** A sponsor as it appears in the RIPH property — carries campaign + tier. */
export interface MockSeasonSponsor {
  id: string;
  brand_id: string;
  campaign_id: string;
  name: string;
  tier: 'premium' | 'mid' | 'local';
  area: string;
  event_type: string;
  is_local: boolean;
  data_class: DataClass;
}

/** Per-sponsor impression rollup within one event (campaign-groupable). */
export interface MockSponsorImpression {
  event_id: string;
  sponsor_id: string;
  campaign_id: string;
  campaign_title: string;
  surface: string;
  count: number;
}

/**
 * A fine-grain (per-hour, per-cell) bucket. `suppressed` marks a bucket that
 * falls below the K-anon floor (K≥5) — the platform's honesty feature: it is
 * never published as a raw count; the demo shows the "too small alone" label.
 */
export interface MockLadderBucket {
  event_id: string;
  h3_res9: string;
  hour_bucket: string;
  count: number;
  suppressed: boolean;
  label: string;
}

export const RIPH_BRAND_ID = 'riph-blue-island';
export const RIPH_VENUE_NAME = 'Rock Island Public House (RIPH) — Blue Island';
const RIPH_CORRIDOR = 'blue-island';
// Rock Island Public House, Blue Island, IL (~41.6572, -87.6800) — the brain's
// primary activation anchor (OCR_VISION.md, corridor-definitions.yaml). All three
// cells resolve inside the Blue Island / south-Chicagoland corridor (OSE-995).
const RIPH_LAT = 41.6572;
const RIPH_LON = -87.68;
const RIPH_H3_RES9 = '89266454447ffff';
const RIPH_H3_RES7 = '872664544ffffff';
const RIPH_H3_RES9_B = '8926645447bffff'; // an adjacent cell so the corridor map has spread

const K_ANON_FLOOR = 5;

// ── Leagues (4 recurring containers — the flagship consolidation story) ────────
// Rock Island Public House runs four recurring social containers on one platform;
// OCR/OSE consolidates a sponsor's reach ACROSS them (riph-flagship-consolidation).

export function getRiphLeagues(): MockLeague[] {
  return [
    {
      id: 'league_trivia',
      brand_id: RIPH_BRAND_ID,
      name: 'RIPH Trivia Nights',
      event_type: 'trivia',
      slug: 'riph-trivia',
    },
    {
      id: 'league_bocce',
      brand_id: RIPH_BRAND_ID,
      name: 'RIPH Bocce League',
      event_type: 'bocce',
      slug: 'riph-bocce',
    },
    {
      id: 'league_pinball',
      brand_id: RIPH_BRAND_ID,
      name: 'RIPH Pinball League',
      event_type: 'pinball',
      slug: 'riph-pinball',
    },
    {
      id: 'league_cigar',
      brand_id: RIPH_BRAND_ID,
      name: 'RIPH Cigar Social Club',
      event_type: 'cigar-social-club',
      slug: 'riph-cigar',
    },
  ];
}

// ── Campaigns (Premium: exactly 2 · Mid: 3 · Local: 1 shared) ─────────────────

export function getRiphCampaigns(): MockCampaign[] {
  return [
    // Premium — exactly 2, so the class renders as a class (not a lone example)
    {
      id: 'camp_premium_1',
      brand_id: RIPH_BRAND_ID,
      title: 'Beggars Pizza — Season Presenting',
      tier: 'premium',
      status: 'active',
    },
    {
      id: 'camp_premium_2',
      brand_id: RIPH_BRAND_ID,
      title: 'Beverly Records — Season Presenting',
      tier: 'premium',
      status: 'active',
    },
    // Mid — a few different campaigns so placement/attribution has real variety
    {
      id: 'camp_mid_1',
      brand_id: RIPH_BRAND_ID,
      title: 'Natural Law Cocktail Club — League Nights',
      tier: 'mid',
      status: 'active',
    },
    {
      id: 'camp_mid_2',
      brand_id: RIPH_BRAND_ID,
      title: 'Horse Thief Hollow — Corridor Series',
      tier: 'mid',
      status: 'active',
    },
    {
      id: 'camp_mid_3',
      brand_id: RIPH_BRAND_ID,
      title: 'Studious Coffee — Trivia Nights',
      tier: 'mid',
      status: 'active',
    },
    // Local — the neighborhood texture, grouped under one shared local campaign
    {
      id: 'camp_local_1',
      brand_id: RIPH_BRAND_ID,
      title: 'Local Friends of RIPH',
      tier: 'local',
      status: 'active',
    },
  ];
}

// ── Sponsors (Premium 2 · Mid 3 · Local 5), each carrying a campaign ──────────

export function getRiphSponsors(): MockSeasonSponsor[] {
  // is_local is a GEO-derived value (in-corridor?), independent of the paid `tier`
  // and shown read-only (#25 / OSE-670): money buys frequency-share/tier, NEVER
  // local status. Passed explicitly (not `tier === 'local'`) so the dataset
  // DEMONSTRATES the two axes are orthogonal — premium & mid each occur at both
  // is_local=true and is_local=false. (Business↔geo mapping is illustrative
  // pending the real Blue Island roster; see OSE-995.)
  const s = (
    id: string,
    campaign_id: string,
    name: string,
    tier: MockSeasonSponsor['tier'],
    area: string,
    event_type: string,
    is_local: boolean
  ): MockSeasonSponsor => ({
    id,
    brand_id: RIPH_BRAND_ID,
    campaign_id,
    name,
    tier,
    area,
    event_type,
    is_local,
    data_class: 'demo',
  });
  return [
    // Premium (2) — one in-corridor local brand, one up-corridor regional draw:
    // premium status is NOT gated on geography. Beggars Pizza was founded in Blue
    // Island (is_local); Beverly Records is a worldwide vinyl institution up the
    // Western Ave spine in Beverly (is_local=false) — money buys tier, not local.
    s('sp_riph_prem_1', 'camp_premium_1', 'Beggars Pizza', 'premium', 'blue-island', 'bocce', true),
    s(
      'sp_riph_prem_2',
      'camp_premium_2',
      'Beverly Records',
      'premium',
      'beverly-western',
      'cigar-social-club',
      false
    ),
    // Mid (3) — spans both localities: mid occurs at is_local=true AND is_local=false.
    s(
      'sp_riph_mid_1',
      'camp_mid_1',
      'Natural Law Cocktail Club',
      'mid',
      'blue-island-uptown',
      'cigar-social-club',
      true
    ),
    s(
      'sp_riph_mid_2',
      'camp_mid_2',
      'Horse Thief Hollow',
      'mid',
      'beverly-western',
      'trivia',
      false
    ),
    s(
      'sp_riph_mid_3',
      'camp_mid_3',
      'Studious Coffee',
      'mid',
      'blue-island-uptown',
      'trivia',
      true
    ),
    // Local (5) — the covenant floor: Blue Island's own Uptown, all in-corridor.
    s(
      'sp_riph_loc_1',
      'camp_local_1',
      'Elsewhere Comics & Collectibles',
      'local',
      'blue-island-uptown',
      'pinball',
      true
    ),
    s(
      'sp_riph_loc_2',
      'camp_local_1',
      'International Fades & Beauty',
      'local',
      'blue-island-uptown',
      'cigar-social-club',
      true
    ),
    s(
      'sp_riph_loc_3',
      'camp_local_1',
      'Blue Island-Robbins Neighborhood Network',
      'local',
      'blue-island-uptown',
      'pinball',
      true
    ),
    s('sp_riph_loc_4', 'camp_local_1', 'OldTown Barbershop', 'local', 'blue-island', 'bocce', true),
    s(
      'sp_riph_loc_5',
      'camp_local_1',
      'Blue Island Smoke Shop',
      'local',
      'blue-island',
      'cigar-social-club',
      true
    ),
  ];
}

// ── Season: 3 leagues × 3 instances = 9 events (headcounts vary; some climb) ───

const SEASON_PLAN: {
  league_id: string;
  event_type: string;
  name: string;
  dates: string[];
  headcounts: number[];
  cell: string;
}[] = [
  {
    league_id: 'league_trivia',
    event_type: 'trivia',
    name: 'RIPH Trivia',
    dates: ['2026-06-18', '2026-07-16', '2026-08-06'],
    headcounts: [31, 38, 45],
    cell: RIPH_H3_RES9,
  },
  {
    league_id: 'league_bocce',
    event_type: 'bocce',
    name: 'RIPH Bocce',
    dates: ['2026-06-06', '2026-07-11', '2026-08-01'],
    headcounts: [42, 58, 71], // climbing across the season
    cell: RIPH_H3_RES9,
  },
  {
    league_id: 'league_pinball',
    event_type: 'pinball',
    name: 'RIPH Pinball',
    dates: ['2026-06-13', '2026-07-18', '2026-08-15'],
    headcounts: [22, 28, 33],
    cell: RIPH_H3_RES9_B,
  },
  {
    league_id: 'league_cigar',
    event_type: 'cigar-social-club',
    name: 'RIPH Cigar Social Club',
    dates: ['2026-06-27', '2026-07-25', '2026-08-08'],
    headcounts: [18, 11, 27], // a small, intimate night in the middle — realistic
    cell: RIPH_H3_RES9_B,
  },
];

export function getRiphSeasonEvents(): MockSeasonEvent[] {
  const events: MockSeasonEvent[] = [];
  for (const plan of SEASON_PLAN) {
    plan.dates.forEach((date, i) => {
      const n = i + 1;
      events.push({
        id: `evt_riph_${plan.league_id.replace('league_', '')}_${n}`,
        brand_id: RIPH_BRAND_ID,
        league_id: plan.league_id,
        title: `${plan.name} — Night ${n}`,
        slug: `${plan.league_id.replace('league_', 'riph-')}-night-${n}`,
        event_type: plan.event_type,
        status: 'active',
        phase: 'post',
        start_date: date,
        end_date: date,
        timezone: 'America/Chicago',
        lat: RIPH_LAT,
        lon: RIPH_LON,
        h3_res9: plan.cell,
        h3_res7: RIPH_H3_RES7,
        corridor_id: RIPH_CORRIDOR,
        data_class: 'demo',
        headcount: plan.headcounts[i],
      });
    });
  }
  return events;
}

// ── Sponsor impressions per event (campaign-groupable, tier-weighted) ─────────

// Premium campaigns run full rotation, mid mid-weight, local lightest — but every
// sponsor clears K≥5 at the event grain (locals are served, never suppressed at
// their own level). Weighting is by tier, scaled by each event's headcount.
const TIER_IMPRESSION_WEIGHT: Record<MockSeasonSponsor['tier'], number> = {
  premium: 3,
  mid: 2,
  local: 1,
};

export function getRiphSponsorImpressions(): MockSponsorImpression[] {
  const events = getRiphSeasonEvents();
  const sponsors = getRiphSponsors();
  const campaigns = getRiphCampaigns();
  const campaignTitle = (id: string) => campaigns.find((c) => c.id === id)?.title ?? 'unknown';

  const rows: MockSponsorImpression[] = [];
  for (const ev of events) {
    for (const sp of sponsors) {
      // Deterministic: base on headcount × tier weight, floored above K-anon.
      const base = Math.max(
        K_ANON_FLOOR,
        Math.round((ev.headcount * TIER_IMPRESSION_WEIGHT[sp.tier]) / 4)
      );
      rows.push({
        event_id: ev.id,
        sponsor_id: sp.id,
        campaign_id: sp.campaign_id,
        campaign_title: campaignTitle(sp.campaign_id),
        surface: 'display',
        count: base,
      });
    }
  }
  return rows;
}

// ── Ladder fallback buckets (the honesty feature on display) ──────────────────

// Deliberately includes at least one fine-grain bucket below the K-anon floor so
// the demo shows "by the hour — too small alone" rather than a raw small count.
// The season-level headcount still renders (cleared the floor); only the fine
// grain is suppressed — exactly the platform's honesty feature.
export function getRiphLadderBuckets(): MockLadderBucket[] {
  return [
    {
      event_id: 'evt_riph_cigar_2', // the small cigar social night (headcount 11)
      h3_res9: RIPH_H3_RES9_B,
      hour_bucket: '2026-07-25T19:00:00Z',
      count: 3, // below K≥5
      suppressed: true,
      label: 'By the hour — too small alone (K≥5)',
    },
    {
      event_id: 'evt_riph_cigar_2',
      h3_res9: RIPH_H3_RES9_B,
      hour_bucket: '2026-07-25T20:00:00Z',
      count: 9, // clears the floor — shown
      suppressed: false,
      label: '8–9pm',
    },
    {
      event_id: 'evt_riph_bocce_3',
      h3_res9: RIPH_H3_RES9,
      hour_bucket: '2026-08-01T14:00:00Z',
      count: 34,
      suppressed: false,
      label: '2–3pm (peak)',
    },
  ];
}

// ── Full canonical dataset (one call = deterministic reset) ────────────────────

export interface RiphDataset {
  venue_name: string;
  brand_id: string;
  data_class: DataClass;
  leagues: MockLeague[];
  campaigns: MockCampaign[];
  sponsors: MockSeasonSponsor[];
  events: MockSeasonEvent[];
  sponsorDisplays: MockSponsorImpression[];
  ladderBuckets: MockLadderBucket[];
  corridorCells: string[];
}

/**
 * The canonical RIPH demo dataset. Pure + deterministic — calling it twice
 * yields byte-identical data, so "reset to canonical state" is exactly this
 * function (the fixtures ARE the versioned seed).
 */
export function getRiphDataset(): RiphDataset {
  return {
    venue_name: RIPH_VENUE_NAME,
    brand_id: RIPH_BRAND_ID,
    data_class: 'demo',
    leagues: getRiphLeagues(),
    campaigns: getRiphCampaigns(),
    sponsors: getRiphSponsors(),
    events: getRiphSeasonEvents(),
    sponsorDisplays: getRiphSponsorImpressions(),
    ladderBuckets: getRiphLadderBuckets(),
    corridorCells: [RIPH_H3_RES9, RIPH_H3_RES9_B],
  };
}
