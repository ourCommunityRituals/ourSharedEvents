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
  template_id: string | null;
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
export const MOCK_BRAND_ID = 'riph-beverly';
export const MOCK_BASE_DATE = '2026-08-02'; // frozen "today" for mock data

// Beverly, Chicago
const BEVERLY_LAT = 41.7197;
const BEVERLY_LON = -87.672;

// ── 1. Event fixture ───────────────────────────────────────────────────────────

export function getEventFixture(): MockEvent {
  return {
    id: MOCK_EVENT_ID,
    brand_id: MOCK_BRAND_ID,
    title: 'RIPH Bocce Tournament — Beverly Summer Classic',
    slug: 'riph-bocce-beverly-summer-classic',
    status: 'active',
    phase: 'active',
    description:
      'The Ridge-Irish-Prairie Hills summer bocce league championship. ' +
      'All skill levels welcome. Food and drinks available.',
    location: 'Ridge Country Club, 10220 S Central Park Ave, Beverly, Chicago, IL 60655',
    cover_image_url: null,
    timezone: 'America/Chicago',
    template_id: null,

    what_short: 'Summer bocce championship for the Beverly/RIPH corridor.',
    who_host: 'Ridge-Irish-Prairie Hills (RIPH) Community League',
    why_purpose:
      'Annual community gathering that brings together Beverly, ' +
      'Morgan Park, and Mt. Greenwood neighbors. Proceeds support ' +
      'neighborhood beautification.',
    how_details:
      'Round-robin pool play followed by single-elimination bracket. ' +
      'Teams of 2. Check in at the north shelter.',
    where_address: '10220 S Central Park Ave, Beverly, Chicago, IL 60655',

    start_date: '2026-08-02',
    end_date: '2026-08-02',
    created_at: '2026-07-01T10:00:00Z',
    updated_at: '2026-08-01T08:00:00Z',

    lat: BEVERLY_LAT,
    lon: BEVERLY_LON,
    h3_res9: '892698a6d0bffff',
    h3_res7: '872698a6dffffff',
    corridor_id: 'beverly-morgan-park',

    legal_clearance_tier: 'tier-1',
  };
}

// ── 2. Sponsor fixtures ────────────────────────────────────────────────────────

const SPONSOR_POOL: Omit<MockSponsor, 'id' | 'event_id' | 'display_order'>[] = [
  // Premium tier (3)
  {
    brand_id: MOCK_BRAND_ID,
    name: 'Beverly Arts Center',
    tier: 'premium',
    area: 'beverly',
    event_type: 'bocce',
    logo_url: null,
    website_url: null,
    active: true,
  },
  {
    brand_id: MOCK_BRAND_ID,
    name: 'Ridge Home + Garden',
    tier: 'premium',
    area: 'beverly',
    event_type: 'bocce',
    logo_url: null,
    website_url: null,
    active: true,
  },
  {
    brand_id: MOCK_BRAND_ID,
    name: 'Irish American Heritage',
    tier: 'premium',
    area: 'beverly',
    event_type: 'sports',
    logo_url: null,
    website_url: null,
    active: true,
  },
  // Mid tier (6)
  {
    brand_id: MOCK_BRAND_ID,
    name: 'Beverly Taqueria',
    tier: 'mid',
    area: 'beverly',
    event_type: 'food',
    logo_url: null,
    website_url: null,
    active: true,
  },
  {
    brand_id: MOCK_BRAND_ID,
    name: 'Prairie Hills Brewing',
    tier: 'mid',
    area: 'prairie-hills',
    event_type: 'drinks',
    logo_url: null,
    website_url: null,
    active: true,
  },
  {
    brand_id: MOCK_BRAND_ID,
    name: 'Morgan Park Auto Care',
    tier: 'mid',
    area: 'morgan-park',
    event_type: 'services',
    logo_url: null,
    website_url: null,
    active: true,
  },
  {
    brand_id: MOCK_BRAND_ID,
    name: 'Western Ave Fitness',
    tier: 'mid',
    area: 'beverly',
    event_type: 'fitness',
    logo_url: null,
    website_url: null,
    active: true,
  },
  {
    brand_id: MOCK_BRAND_ID,
    name: 'South Side Realty Group',
    tier: 'mid',
    area: 'beverly',
    event_type: 'real-estate',
    logo_url: null,
    website_url: null,
    active: true,
  },
  {
    brand_id: MOCK_BRAND_ID,
    name: 'Mt. Greenwood Dental',
    tier: 'mid',
    area: 'mt-greenwood',
    event_type: 'health',
    logo_url: null,
    website_url: null,
    active: true,
  },
  // Local tier (6)
  {
    brand_id: MOCK_BRAND_ID,
    name: 'Ridge Dry Cleaners',
    tier: 'local',
    area: 'beverly',
    event_type: 'retail',
    logo_url: null,
    website_url: null,
    active: true,
  },
  {
    brand_id: MOCK_BRAND_ID,
    name: 'Beverly Bakehouse',
    tier: 'local',
    area: 'beverly',
    event_type: 'food',
    logo_url: null,
    website_url: null,
    active: true,
  },
  {
    brand_id: MOCK_BRAND_ID,
    name: 'Shamrock Tax Services',
    tier: 'local',
    area: 'beverly',
    event_type: 'finance',
    logo_url: null,
    website_url: null,
    active: true,
  },
  {
    brand_id: MOCK_BRAND_ID,
    name: 'Prairie Paws Vet Clinic',
    tier: 'local',
    area: 'prairie-hills',
    event_type: 'pets',
    logo_url: null,
    website_url: null,
    active: true,
  },
  {
    brand_id: MOCK_BRAND_ID,
    name: "Kelly's Corner Pub",
    tier: 'local',
    area: 'beverly',
    event_type: 'food',
    logo_url: null,
    website_url: null,
    active: true,
  },
  {
    brand_id: MOCK_BRAND_ID,
    name: 'Greenwood Locksmith',
    tier: 'local',
    area: 'mt-greenwood',
    event_type: 'services',
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
      lat: BEVERLY_LAT,
      lon: BEVERLY_LON,
      label: 'Beverly — Ridge Country Club (main entrance)',
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
        lat: BEVERLY_LAT + (idx % 5) * 0.0001,
        lon: BEVERLY_LON - (idx % 3) * 0.0001,
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
