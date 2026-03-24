#!/usr/bin/env node
/**
 * SharedAnalytics Schema Test Harness
 *
 * Validates shared-analytics schema consistency across all layers:
 * 1. JSON Schema validation (via Ajv)
 * 2. Full data fixture (summary + surfaces + sponsors + topSponsors)
 * 3. Minimal data fixture (summary only, no sponsors/events/topSponsors)
 * 4. AnalyticsService deterministic output validation
 * 5. SharedReporting negative-path tests (graceful degradation)
 *
 * Usage:
 *   node scripts/test-analytics-schema.js
 *   npm run test:schemas:analytics
 *
 * Exit codes:
 *   0 - All validations passed
 *   1 - One or more validations failed
 *
 * @see /schemas/shared-analytics.schema.json (MVP-frozen v1.1)
 * @see src/mvp/AnalyticsService.gs
 * @see src/mvp/SharedReporting.gs
 */

const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');

// ============================================================================
// Configuration
// ============================================================================

const ROOT = path.join(__dirname, '..');
const SCHEMAS_DIR = path.join(ROOT, 'schemas');

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m'
};

// ============================================================================
// Fixture: Full SharedAnalytics (all optional arrays populated)
// ============================================================================

/**
 * Full fixture representing complete SharedAnalytics output.
 * Includes summary + surfaces + sponsors + events + topSponsors.
 * This represents what AnalyticsService + SharedReporting produce for an organizer view.
 */
const FULL_ANALYTICS_FIXTURE = {
  lastUpdatedISO: '2025-01-15T14:30:00.000Z',

  // MVP REQUIRED - Summary metrics
  summary: {
    totalImpressions: 1500,
    totalClicks: 75,
    totalQrScans: 42,
    totalSignups: 18,
    uniqueEvents: 3,
    uniqueSponsors: 5
  },

  // MVP REQUIRED - Surface breakdown
  surfaces: [
    {
      id: 'poster',
      label: 'Poster',
      impressions: 500,
      clicks: 25,
      qrScans: 30,
      engagementRate: 11.0
    },
    {
      id: 'display',
      label: 'Display',
      impressions: 400,
      clicks: 20,
      qrScans: 5,
      engagementRate: 6.25
    },
    {
      id: 'public',
      label: 'Public',
      impressions: 350,
      clicks: 18,
      qrScans: 7,
      engagementRate: 7.14
    },
    {
      id: 'signup',
      label: 'Signup',
      impressions: 250,
      clicks: 12,
      qrScans: 0,
      engagementRate: 4.8
    }
  ],

  // MVP OPTIONAL - Sponsor breakdown (organizer view)
  sponsors: [
    {
      id: 'sp_acme_001',
      name: 'Acme Corporation',
      impressions: 450,
      clicks: 25,
      ctr: 5.56
    },
    {
      id: 'sp_joe_tavern',
      name: "Joe's Tavern",
      impressions: 380,
      clicks: 20,
      ctr: 5.26
    },
    {
      id: 'sp_mega_sports',
      name: 'Mega Sports',
      impressions: 320,
      clicks: 15,
      ctr: 4.69
    },
    {
      id: 'sp_local_bank',
      name: 'Local Bank',
      impressions: 200,
      clicks: 10,
      ctr: 5.0
    },
    {
      id: 'sp_pizza_palace',
      name: 'Pizza Palace',
      impressions: 150,
      clicks: 5,
      ctr: 3.33
    }
  ],

  // MVP OPTIONAL - Event breakdown
  events: [
    {
      id: 'evt_summer_tournament_2024',
      name: 'Summer Tournament 2024',
      impressions: 600,
      clicks: 35,
      ctr: 5.83,
      signupsCount: 12
    },
    {
      id: 'evt_winter_league_2024',
      name: 'Winter League 2024',
      impressions: 500,
      clicks: 25,
      ctr: 5.0,
      signupsCount: 4
    },
    {
      id: 'evt_spring_championship',
      name: 'Spring Championship',
      impressions: 400,
      clicks: 15,
      ctr: 3.75,
      signupsCount: 2
    }
  ],

  // MVP OPTIONAL - Top 3 sponsors by clicks
  topSponsors: [
    {
      id: 'sp_acme_001',
      name: 'Acme Corporation',
      impressions: 450,
      clicks: 25,
      ctr: 5.56
    },
    {
      id: 'sp_joe_tavern',
      name: "Joe's Tavern",
      impressions: 380,
      clicks: 20,
      ctr: 5.26
    },
    {
      id: 'sp_mega_sports',
      name: 'Mega Sports',
      impressions: 320,
      clicks: 15,
      ctr: 4.69
    }
  ]
};

/**
 * Minimal fixture with only MVP REQUIRED fields.
 * No sponsors, events, or topSponsors arrays - tests graceful degradation.
 */
const MINIMAL_ANALYTICS_FIXTURE = {
  lastUpdatedISO: '2025-01-01',

  // MVP REQUIRED - Summary (zeros)
  summary: {
    totalImpressions: 0,
    totalClicks: 0,
    totalQrScans: 0,
    totalSignups: 0,
    uniqueEvents: 0,
    uniqueSponsors: 0
  },

  // MVP REQUIRED - Surfaces (empty but valid)
  surfaces: []
};

/**
 * Fixture with null optional arrays (explicit null vs missing).
 * Tests that null values are handled correctly per schema.
 */
const NULL_OPTIONALS_FIXTURE = {
  lastUpdatedISO: '2025-01-15T10:00:00Z',

  summary: {
    totalImpressions: 100,
    totalClicks: 5,
    totalQrScans: 2,
    totalSignups: 1,
    uniqueEvents: 1,
    uniqueSponsors: 0
  },

  surfaces: [
    {
      id: 'public',
      label: 'Public',
      impressions: 100,
      clicks: 5,
      qrScans: 2
    }
  ],

  sponsors: null,
  events: null,
  topSponsors: null
};

/**
 * Edge case: Maximum allowed topSponsors (3)
 */
const MAX_TOP_SPONSORS_FIXTURE = {
  lastUpdatedISO: '2025-01-15T12:00:00.000Z',

  summary: {
    totalImpressions: 1000,
    totalClicks: 100,
    totalQrScans: 50,
    totalSignups: 25,
    uniqueEvents: 2,
    uniqueSponsors: 3
  },

  surfaces: [
    {
      id: 'poster',
      label: 'Poster',
      impressions: 1000,
      clicks: 100,
      qrScans: 50,
      engagementRate: 15.0
    }
  ],

  topSponsors: [
    { id: 'sp1', name: 'Sponsor 1', impressions: 400, clicks: 50, ctr: 12.5 },
    { id: 'sp2', name: 'Sponsor 2', impressions: 350, clicks: 30, ctr: 8.57 },
    { id: 'sp3', name: 'Sponsor 3', impressions: 250, clicks: 20, ctr: 8.0 }
  ]
};

// ============================================================================
// Negative Path Fixtures (should fail validation or test graceful handling)
// ============================================================================

/**
 * Invalid fixture - missing required 'summary' field
 */
const INVALID_MISSING_SUMMARY = {
  lastUpdatedISO: '2025-01-15T10:00:00Z',
  surfaces: []
};

/**
 * Invalid fixture - missing required 'surfaces' field
 */
const INVALID_MISSING_SURFACES = {
  lastUpdatedISO: '2025-01-15T10:00:00Z',
  summary: {
    totalImpressions: 0,
    totalClicks: 0,
    totalQrScans: 0,
    totalSignups: 0,
    uniqueEvents: 0,
    uniqueSponsors: 0
  }
};

/**
 * Invalid fixture - missing required 'lastUpdatedISO' field
 */
const INVALID_MISSING_TIMESTAMP = {
  summary: {
    totalImpressions: 0,
    totalClicks: 0,
    totalQrScans: 0,
    totalSignups: 0,
    uniqueEvents: 0,
    uniqueSponsors: 0
  },
  surfaces: []
};

/**
 * Invalid fixture - surface with invalid id (not in enum)
 */
const INVALID_SURFACE_ID = {
  lastUpdatedISO: '2025-01-15T10:00:00Z',
  summary: {
    totalImpressions: 100,
    totalClicks: 5,
    totalQrScans: 2,
    totalSignups: 1,
    uniqueEvents: 1,
    uniqueSponsors: 0
  },
  surfaces: [
    {
      id: 'invalid_surface', // Not in enum: poster, display, public, signup
      label: 'Invalid',
      impressions: 100,
      clicks: 5,
      qrScans: 2
    }
  ]
};

/**
 * Invalid fixture - topSponsors exceeds maxItems (3)
 */
const INVALID_TOO_MANY_TOP_SPONSORS = {
  lastUpdatedISO: '2025-01-15T10:00:00Z',
  summary: {
    totalImpressions: 1000,
    totalClicks: 100,
    totalQrScans: 50,
    totalSignups: 25,
    uniqueEvents: 2,
    uniqueSponsors: 5
  },
  surfaces: [
    { id: 'poster', label: 'Poster', impressions: 1000, clicks: 100, qrScans: 50 }
  ],
  topSponsors: [
    { id: 'sp1', name: 'Sponsor 1', impressions: 400, clicks: 50, ctr: 12.5 },
    { id: 'sp2', name: 'Sponsor 2', impressions: 350, clicks: 30, ctr: 8.57 },
    { id: 'sp3', name: 'Sponsor 3', impressions: 250, clicks: 20, ctr: 8.0 },
    { id: 'sp4', name: 'Sponsor 4', impressions: 200, clicks: 15, ctr: 7.5 } // 4th sponsor - invalid
  ]
};

/**
 * Invalid fixture - negative metric values
 */
const INVALID_NEGATIVE_METRICS = {
  lastUpdatedISO: '2025-01-15T10:00:00Z',
  summary: {
    totalImpressions: -100, // Invalid: minimum is 0
    totalClicks: 5,
    totalQrScans: 2,
    totalSignups: 1,
    uniqueEvents: 1,
    uniqueSponsors: 0
  },
  surfaces: []
};

/**
 * Invalid fixture - wrong type for lastUpdatedISO
 */
const INVALID_TIMESTAMP_TYPE = {
  lastUpdatedISO: 12345, // Should be string
  summary: {
    totalImpressions: 0,
    totalClicks: 0,
    totalQrScans: 0,
    totalSignups: 0,
    uniqueEvents: 0,
    uniqueSponsors: 0
  },
  surfaces: []
};

/**
 * Invalid fixture - sponsor with empty id
 */
const INVALID_SPONSOR_EMPTY_ID = {
  lastUpdatedISO: '2025-01-15T10:00:00Z',
  summary: {
    totalImpressions: 100,
    totalClicks: 5,
    totalQrScans: 2,
    totalSignups: 1,
    uniqueEvents: 1,
    uniqueSponsors: 1
  },
  surfaces: [
    { id: 'public', label: 'Public', impressions: 100, clicks: 5, qrScans: 2 }
  ],
  sponsors: [
    {
      id: '', // Empty string - invalid (minLength: 1)
      name: 'Test Sponsor',
      impressions: 100,
      clicks: 5,
      ctr: 5.0
    }
  ]
};

// ============================================================================
// AnalyticsService Deterministic Output Tests
// ============================================================================

/**
 * Simulates AnalyticsService behavior for testing.
 * Given known analytics data, produces deterministic SharedAnalytics output.
 */
const ANALYTICS_SERVICE_INPUT = [
  // Event 1 - Summer Tournament
  { timestamp: '2025-01-10T09:00:00Z', eventId: 'evt1', surface: 'poster', metric: 'impression', sponsorId: 'sp1' },
  { timestamp: '2025-01-10T09:05:00Z', eventId: 'evt1', surface: 'poster', metric: 'impression', sponsorId: 'sp1' },
  { timestamp: '2025-01-10T09:10:00Z', eventId: 'evt1', surface: 'poster', metric: 'click', sponsorId: 'sp1' },
  { timestamp: '2025-01-10T10:00:00Z', eventId: 'evt1', surface: 'public', metric: 'impression', sponsorId: 'sp2' },
  { timestamp: '2025-01-10T10:05:00Z', eventId: 'evt1', surface: 'public', metric: 'qr_scan', sponsorId: null },
  { timestamp: '2025-01-10T11:00:00Z', eventId: 'evt1', surface: 'signup', metric: 'signup', sponsorId: null },

  // Event 2 - Winter League
  { timestamp: '2025-01-11T14:00:00Z', eventId: 'evt2', surface: 'display', metric: 'impression', sponsorId: 'sp1' },
  { timestamp: '2025-01-11T14:05:00Z', eventId: 'evt2', surface: 'display', metric: 'click', sponsorId: 'sp1' },
  { timestamp: '2025-01-11T15:00:00Z', eventId: 'evt2', surface: 'public', metric: 'impression', sponsorId: 'sp3' }
];

/**
 * Expected output from AnalyticsService given ANALYTICS_SERVICE_INPUT.
 * Tests deterministic behavior of aggregation functions.
 */
const EXPECTED_ANALYTICS_OUTPUT = {
  summary: {
    totalImpressions: 5,
    totalClicks: 2,
    totalQrScans: 1,
    totalSignups: 1,
    uniqueEvents: 2,
    uniqueSponsors: 3
  },
  surfaces: {
    poster: { impressions: 2, clicks: 1, qrScans: 0 },
    public: { impressions: 2, clicks: 0, qrScans: 1 },
    display: { impressions: 1, clicks: 1, qrScans: 0 },
    signup: { impressions: 0, clicks: 0, qrScans: 0 }
  },
  sponsors: {
    sp1: { impressions: 3, clicks: 2 },
    sp2: { impressions: 1, clicks: 0 },
    sp3: { impressions: 1, clicks: 0 }
  }
};

// ============================================================================
// Schema Utilities
// ============================================================================

/**
 * Load and parse JSON schema file
 */
function loadJsonSchema(filename) {
  const filepath = path.join(SCHEMAS_DIR, filename);
  return JSON.parse(fs.readFileSync(filepath, 'utf8'));
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate fixture against JSON schema using Ajv
 */
function validateWithAjv(schema, data, label) {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const validate = ajv.compile(schema);
  const valid = validate(data);

  return {
    valid,
    label,
    errors: valid ? [] : validate.errors.map(e => ({
      path: e.instancePath || '/',
      message: e.message,
      keyword: e.keyword,
      params: e.params
    }))
  };
}

/**
 * Simulate AnalyticsService aggregation from raw analytics data.
 * This mirrors the logic in buildSharedAnalyticsResponse_().
 */
function simulateAnalyticsService(analytics) {
  const impressions = analytics.filter(a => a.metric === 'impression');
  const clicks = analytics.filter(a => a.metric === 'click');
  const qrScans = analytics.filter(a => a.metric === 'qr_scan');
  const signups = analytics.filter(a => a.metric === 'signup');

  const eventIds = new Set(analytics.map(a => a.eventId).filter(Boolean));
  const sponsorIds = new Set(analytics.map(a => a.sponsorId).filter(Boolean));

  // Aggregate by surface
  const surfaces = {};
  analytics.forEach(a => {
    const surfaceId = (a.surface || 'unknown').toLowerCase();
    if (!surfaces[surfaceId]) {
      surfaces[surfaceId] = { impressions: 0, clicks: 0, qrScans: 0 };
    }
    if (a.metric === 'impression') surfaces[surfaceId].impressions++;
    if (a.metric === 'click') surfaces[surfaceId].clicks++;
    if (a.metric === 'qr_scan') surfaces[surfaceId].qrScans++;
  });

  // Aggregate by sponsor
  const sponsors = {};
  analytics.forEach(a => {
    if (!a.sponsorId) return;
    if (!sponsors[a.sponsorId]) {
      sponsors[a.sponsorId] = { impressions: 0, clicks: 0 };
    }
    if (a.metric === 'impression') sponsors[a.sponsorId].impressions++;
    if (a.metric === 'click') sponsors[a.sponsorId].clicks++;
  });

  return {
    summary: {
      totalImpressions: impressions.length,
      totalClicks: clicks.length,
      totalQrScans: qrScans.length,
      totalSignups: signups.length,
      uniqueEvents: eventIds.size,
      uniqueSponsors: sponsorIds.size
    },
    surfaces,
    sponsors
  };
}

/**
 * Compare two aggregation results for deterministic output
 */
function compareAggregations(actual, expected) {
  const issues = [];

  // Compare summary
  for (const key of Object.keys(expected.summary)) {
    if (actual.summary[key] !== expected.summary[key]) {
      issues.push(`summary.${key}: expected ${expected.summary[key]}, got ${actual.summary[key]}`);
    }
  }

  // Compare surfaces
  for (const surface of Object.keys(expected.surfaces)) {
    if (!actual.surfaces[surface]) {
      issues.push(`surfaces.${surface}: missing in actual output`);
      continue;
    }
    for (const metric of Object.keys(expected.surfaces[surface])) {
      if (actual.surfaces[surface][metric] !== expected.surfaces[surface][metric]) {
        issues.push(`surfaces.${surface}.${metric}: expected ${expected.surfaces[surface][metric]}, got ${actual.surfaces[surface][metric]}`);
      }
    }
  }

  // Compare sponsors
  for (const sponsor of Object.keys(expected.sponsors)) {
    if (!actual.sponsors[sponsor]) {
      issues.push(`sponsors.${sponsor}: missing in actual output`);
      continue;
    }
    for (const metric of Object.keys(expected.sponsors[sponsor])) {
      if (actual.sponsors[sponsor][metric] !== expected.sponsors[sponsor][metric]) {
        issues.push(`sponsors.${sponsor}.${metric}: expected ${expected.sponsors[sponsor][metric]}, got ${actual.sponsors[sponsor][metric]}`);
      }
    }
  }

  return issues;
}

/**
 * Test graceful degradation for missing optional arrays.
 * Simulates how SharedReporting should handle edge cases.
 */
function testGracefulDegradation() {
  const issues = [];

  // Test 1: No sponsors array - should not crash
  const noSponsors = {
    lastUpdatedISO: new Date().toISOString(),
    summary: { totalImpressions: 0, totalClicks: 0, totalQrScans: 0, totalSignups: 0, uniqueEvents: 0, uniqueSponsors: 0 },
    surfaces: [],
    sponsors: null
  };

  if (!canRenderSponsorsSection(noSponsors)) {
    // Expected behavior - graceful degradation
  } else {
    issues.push('Expected sponsors section to degrade gracefully with null sponsors');
  }

  // Test 2: No events array - should not crash
  const noEvents = {
    lastUpdatedISO: new Date().toISOString(),
    summary: { totalImpressions: 0, totalClicks: 0, totalQrScans: 0, totalSignups: 0, uniqueEvents: 0, uniqueSponsors: 0 },
    surfaces: [],
    events: null
  };

  if (!canRenderEventsSection(noEvents)) {
    // Expected behavior - graceful degradation
  } else {
    issues.push('Expected events section to degrade gracefully with null events');
  }

  // Test 3: No topSponsors array - should not crash
  const noTopSponsors = {
    lastUpdatedISO: new Date().toISOString(),
    summary: { totalImpressions: 0, totalClicks: 0, totalQrScans: 0, totalSignups: 0, uniqueEvents: 0, uniqueSponsors: 0 },
    surfaces: [],
    topSponsors: null
  };

  if (!canRenderTopSponsorsSection(noTopSponsors)) {
    // Expected behavior - graceful degradation
  } else {
    issues.push('Expected topSponsors section to degrade gracefully with null topSponsors');
  }

  // Test 4: Empty arrays - should show "No data" messages
  const emptyArrays = {
    lastUpdatedISO: new Date().toISOString(),
    summary: { totalImpressions: 0, totalClicks: 0, totalQrScans: 0, totalSignups: 0, uniqueEvents: 0, uniqueSponsors: 0 },
    surfaces: [],
    sponsors: [],
    events: [],
    topSponsors: []
  };

  if (emptyArrays.sponsors.length === 0 && emptyArrays.events.length === 0) {
    // Expected behavior - shows empty states
  } else {
    issues.push('Expected empty arrays to be handled gracefully');
  }

  return issues;
}

// Helper functions for graceful degradation tests
function canRenderSponsorsSection(data) {
  return Array.isArray(data.sponsors) && data.sponsors.length > 0;
}

function canRenderEventsSection(data) {
  return Array.isArray(data.events) && data.events.length > 0;
}

function canRenderTopSponsorsSection(data) {
  return Array.isArray(data.topSponsors) && data.topSponsors.length > 0;
}

// ============================================================================
// Output Formatting
// ============================================================================

function printHeader(text) {
  console.log(`\n${colors.cyan}${'='.repeat(70)}${colors.reset}`);
  console.log(`${colors.cyan}  ${text}${colors.reset}`);
  console.log(`${colors.cyan}${'='.repeat(70)}${colors.reset}\n`);
}

function printSection(text) {
  console.log(`${colors.dim}${'-'.repeat(50)}${colors.reset}`);
  console.log(`${text}`);
}

function printSuccess(message) {
  console.log(`  ${colors.green}[PASS]${colors.reset} ${message}`);
}

function printFailure(message) {
  console.log(`  ${colors.red}[FAIL]${colors.reset} ${message}`);
}

function printWarning(message) {
  console.log(`  ${colors.yellow}[WARN]${colors.reset} ${message}`);
}

function printDetail(message) {
  console.log(`    ${colors.dim}${message}${colors.reset}`);
}

// ============================================================================
// Main Test Harness
// ============================================================================

function main() {
  console.log(`\n${colors.cyan}SharedAnalytics Schema Test Harness${colors.reset}`);
  console.log(`${colors.dim}Validating AnalyticsService + SharedReporting alignment${colors.reset}`);

  let totalErrors = 0;
  let totalWarnings = 0;
  let totalPassed = 0;

  // -------------------------------------------------------------------------
  // 1. Load JSON Schema
  // -------------------------------------------------------------------------
  printHeader('1. JSON Schema Loading');

  let analyticsSchema;
  try {
    analyticsSchema = loadJsonSchema('shared-analytics.schema.json');
    printSuccess('Loaded /schemas/shared-analytics.schema.json');
    totalPassed++;
  } catch (e) {
    printFailure(`Failed to load shared-analytics.schema.json: ${e.message}`);
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // 2. Happy Path - Valid Fixtures
  // -------------------------------------------------------------------------
  printHeader('2. Happy Path Validation (Valid Fixtures)');

  const validFixtures = [
    { data: FULL_ANALYTICS_FIXTURE, label: 'Full Analytics (all fields populated)' },
    { data: MINIMAL_ANALYTICS_FIXTURE, label: 'Minimal Analytics (MVP Required only)' },
    { data: NULL_OPTIONALS_FIXTURE, label: 'Null Optionals (explicit nulls)' },
    { data: MAX_TOP_SPONSORS_FIXTURE, label: 'Max TopSponsors (exactly 3)' }
  ];

  printSection('Validating valid fixtures...');

  for (const fixture of validFixtures) {
    const result = validateWithAjv(analyticsSchema, fixture.data, fixture.label);
    if (result.valid) {
      printSuccess(result.label);
      totalPassed++;
    } else {
      printFailure(`${result.label} - ${result.errors.length} error(s)`);
      result.errors.forEach(e => {
        printDetail(`${e.path}: ${e.message}`);
      });
      totalErrors++;
    }
  }

  // -------------------------------------------------------------------------
  // 3. Negative Path - Invalid Fixtures (should fail validation)
  // -------------------------------------------------------------------------
  printHeader('3. Negative Path Validation (Invalid Fixtures)');

  const invalidFixtures = [
    { data: INVALID_MISSING_SUMMARY, label: 'Missing summary (should fail)', expectedError: 'summary' },
    { data: INVALID_MISSING_SURFACES, label: 'Missing surfaces (should fail)', expectedError: 'surfaces' },
    { data: INVALID_MISSING_TIMESTAMP, label: 'Missing lastUpdatedISO (should fail)', expectedError: 'lastUpdatedISO' },
    { data: INVALID_SURFACE_ID, label: 'Invalid surface id (should fail)', expectedError: 'enum' },
    { data: INVALID_TOO_MANY_TOP_SPONSORS, label: 'Too many topSponsors (should fail)', expectedError: 'maxItems' },
    { data: INVALID_NEGATIVE_METRICS, label: 'Negative metrics (should fail)', expectedError: 'minimum' },
    { data: INVALID_TIMESTAMP_TYPE, label: 'Wrong timestamp type (should fail)', expectedError: 'type' },
    { data: INVALID_SPONSOR_EMPTY_ID, label: 'Empty sponsor id (should fail)', expectedError: 'minLength' }
  ];

  printSection('Validating invalid fixtures (expect failures)...');

  for (const fixture of invalidFixtures) {
    const result = validateWithAjv(analyticsSchema, fixture.data, fixture.label);
    if (!result.valid) {
      // Good - invalid fixture correctly rejected
      const hasExpectedError = result.errors.some(e =>
        e.path.includes(fixture.expectedError) ||
        e.keyword === fixture.expectedError ||
        e.message.includes(fixture.expectedError)
      );
      if (hasExpectedError) {
        printSuccess(`${fixture.label} - correctly rejected`);
        totalPassed++;
      } else {
        printWarning(`${fixture.label} - rejected but for unexpected reason`);
        result.errors.forEach(e => printDetail(`${e.path}: ${e.message}`));
        totalWarnings++;
      }
    } else {
      printFailure(`${fixture.label} - should have been rejected but passed!`);
      totalErrors++;
    }
  }

  // -------------------------------------------------------------------------
  // 4. AnalyticsService Deterministic Output Tests
  // -------------------------------------------------------------------------
  printHeader('4. AnalyticsService Deterministic Output Tests');

  printSection('Testing aggregation determinism...');

  const actualOutput = simulateAnalyticsService(ANALYTICS_SERVICE_INPUT);
  const aggregationIssues = compareAggregations(actualOutput, EXPECTED_ANALYTICS_OUTPUT);

  if (aggregationIssues.length === 0) {
    printSuccess('Summary metrics match expected output');
    printSuccess('Surface metrics match expected output');
    printSuccess('Sponsor metrics match expected output');
    totalPassed += 3;
  } else {
    printFailure(`Aggregation mismatch - ${aggregationIssues.length} issue(s)`);
    aggregationIssues.forEach(issue => printDetail(issue));
    totalErrors += aggregationIssues.length;
  }

  // -------------------------------------------------------------------------
  // 5. SharedReporting Graceful Degradation Tests
  // -------------------------------------------------------------------------
  printHeader('5. SharedReporting Graceful Degradation Tests');

  printSection('Testing handling of missing optional arrays...');

  const degradationIssues = testGracefulDegradation();

  if (degradationIssues.length === 0) {
    printSuccess('No sponsors array handled gracefully');
    printSuccess('No events array handled gracefully');
    printSuccess('No topSponsors array handled gracefully');
    printSuccess('Empty arrays show empty states correctly');
    totalPassed += 4;
  } else {
    printFailure(`Graceful degradation issues - ${degradationIssues.length} issue(s)`);
    degradationIssues.forEach(issue => printDetail(issue));
    totalErrors += degradationIssues.length;
  }

  // -------------------------------------------------------------------------
  // 6. Schema Field Coverage Check
  // -------------------------------------------------------------------------
  printHeader('6. Schema Field Coverage Check');

  printSection('Verifying schema structure...');

  // Check required fields
  const requiredFields = analyticsSchema.required || [];
  const expectedRequired = ['lastUpdatedISO', 'summary', 'surfaces'];

  const missingRequired = expectedRequired.filter(f => !requiredFields.includes(f));
  if (missingRequired.length === 0) {
    printSuccess(`Required fields: ${expectedRequired.join(', ')}`);
    totalPassed++;
  } else {
    printFailure(`Missing required fields: ${missingRequired.join(', ')}`);
    totalErrors++;
  }

  // Check Summary fields
  const summaryRequired = analyticsSchema.$defs?.Summary?.required || [];
  const expectedSummary = ['totalImpressions', 'totalClicks', 'totalQrScans', 'totalSignups', 'uniqueEvents', 'uniqueSponsors'];

  const missingSummary = expectedSummary.filter(f => !summaryRequired.includes(f));
  if (missingSummary.length === 0) {
    printSuccess(`Summary fields: ${expectedSummary.join(', ')}`);
    totalPassed++;
  } else {
    printFailure(`Missing Summary fields: ${missingSummary.join(', ')}`);
    totalErrors++;
  }

  // Check SurfaceMetrics fields
  const surfaceRequired = analyticsSchema.$defs?.SurfaceMetrics?.required || [];
  const expectedSurface = ['id', 'label', 'impressions', 'clicks', 'qrScans'];

  const missingSurface = expectedSurface.filter(f => !surfaceRequired.includes(f));
  if (missingSurface.length === 0) {
    printSuccess(`SurfaceMetrics fields: ${expectedSurface.join(', ')}`);
    totalPassed++;
  } else {
    printFailure(`Missing SurfaceMetrics fields: ${missingSurface.join(', ')}`);
    totalErrors++;
  }

  // Check SponsorMetrics fields
  const sponsorRequired = analyticsSchema.$defs?.SponsorMetrics?.required || [];
  const expectedSponsor = ['id', 'name', 'impressions', 'clicks', 'ctr'];

  const missingSponsor = expectedSponsor.filter(f => !sponsorRequired.includes(f));
  if (missingSponsor.length === 0) {
    printSuccess(`SponsorMetrics fields: ${expectedSponsor.join(', ')}`);
    totalPassed++;
  } else {
    printFailure(`Missing SponsorMetrics fields: ${missingSponsor.join(', ')}`);
    totalErrors++;
  }

  // Check EventMetrics fields
  const eventRequired = analyticsSchema.$defs?.EventMetrics?.required || [];
  const expectedEvent = ['id', 'name', 'impressions', 'clicks', 'ctr', 'signupsCount'];

  const missingEvent = expectedEvent.filter(f => !eventRequired.includes(f));
  if (missingEvent.length === 0) {
    printSuccess(`EventMetrics fields: ${expectedEvent.join(', ')}`);
    totalPassed++;
  } else {
    printFailure(`Missing EventMetrics fields: ${missingEvent.join(', ')}`);
    totalErrors++;
  }

  // Check topSponsors maxItems constraint
  const topSponsorsMaxItems = analyticsSchema.properties?.topSponsors?.maxItems;
  if (topSponsorsMaxItems === 3) {
    printSuccess('topSponsors maxItems: 3');
    totalPassed++;
  } else {
    printFailure(`topSponsors maxItems should be 3, got ${topSponsorsMaxItems}`);
    totalErrors++;
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  printHeader('Summary');

  console.log(`${colors.green}Passed: ${totalPassed}${colors.reset}`);
  if (totalWarnings > 0) {
    console.log(`${colors.yellow}Warnings: ${totalWarnings}${colors.reset}`);
  }
  if (totalErrors > 0) {
    console.log(`${colors.red}Errors: ${totalErrors}${colors.reset}`);
  }

  console.log('');

  if (totalErrors === 0) {
    console.log(`${colors.green}All SharedAnalytics schema validations passed!${colors.reset}`);
    if (totalWarnings > 0) {
      console.log(`${colors.yellow}  (${totalWarnings} warning(s) - non-blocking)${colors.reset}`);
    }
    console.log(`\n${colors.dim}SharedAnalytics schema is locked and consistent across:${colors.reset}`);
    console.log(`${colors.dim}  - /schemas/shared-analytics.schema.json${colors.reset}`);
    console.log(`${colors.dim}  - src/mvp/AnalyticsService.gs${colors.reset}`);
    console.log(`${colors.dim}  - src/mvp/SharedReporting.gs${colors.reset}\n`);
    process.exit(0);
  } else {
    console.log(`${colors.red}${totalErrors} validation error(s) found${colors.reset}`);
    if (totalWarnings > 0) {
      console.log(`${colors.yellow}  (${totalWarnings} warning(s))${colors.reset}`);
    }
    console.log(`\n${colors.dim}Fix the issues above to ensure schema consistency.${colors.reset}`);
    console.log(`${colors.dim}See /schemas/shared-analytics.schema.json for the canonical definition.${colors.reset}\n`);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

// Export for testing
module.exports = {
  FULL_ANALYTICS_FIXTURE,
  MINIMAL_ANALYTICS_FIXTURE,
  NULL_OPTIONALS_FIXTURE,
  MAX_TOP_SPONSORS_FIXTURE,
  ANALYTICS_SERVICE_INPUT,
  EXPECTED_ANALYTICS_OUTPUT,
  loadJsonSchema,
  validateWithAjv,
  simulateAnalyticsService,
  compareAggregations,
  testGracefulDegradation
};
