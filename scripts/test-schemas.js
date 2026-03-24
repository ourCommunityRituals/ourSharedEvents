#!/usr/bin/env node
/**
 * Schema Sync Validation Helper Script
 *
 * This script validates that sample data matches the JSON schemas and that
 * all schema files are in sync with their canonical definitions.
 *
 * Usage:
 *   node scripts/test-schemas.js
 *   npm run test:schemas  (runs the full Jest test suite)
 *
 * What this script checks:
 * 1. All 4 JSON schema files exist and are valid JSON
 * 2. Sample event data matches the event schema structure
 * 3. Sample sponsor data matches the sponsor schema structure
 * 4. Sample form-config data matches the form-config schema structure
 * 5. Sample shared-analytics data matches the shared-analytics schema structure
 *
 * @see /schemas/event.schema.json
 * @see /schemas/sponsor.schema.json
 * @see /schemas/form-config.schema.json
 * @see /schemas/shared-analytics.schema.json
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCHEMAS_DIR = path.join(ROOT, 'schemas');

// ============================================================================
// Sample Data (matches JSON schema definitions)
// ============================================================================

const SAMPLE_EVENT = {
  id: 'evt_sample123',
  slug: 'summer-tournament-2024',
  name: 'Summer Tournament 2024',
  startDateISO: '2024-07-15',
  venue: 'Central Park Arena',
  templateId: 'tournament',
  links: {
    publicUrl: 'https://example.com/public',
    displayUrl: 'https://example.com/display',
    posterUrl: 'https://example.com/poster',
    signupUrl: 'https://example.com/signup',
    sharedReportUrl: null
  },
  qr: {
    public: 'data:image/png;base64,iVBORw0...',
    signup: 'data:image/png;base64,iVBORw0...'
  },
  ctas: {
    primary: { label: 'Register Now', url: 'https://example.com/signup' },
    secondary: null
  },
  settings: {
    showSchedule: true,
    showStandings: true,
    showBracket: false,
    showSponsors: true,
    showVideo: true,
    showMap: true,
    showGallery: false,
    showSponsorBanner: true,
    showSponsorStrip: true,
    showLeagueStrip: true,
    showQRSection: true
  },
  schedule: null,
  standings: null,
  bracket: null,
  sponsors: null,
  media: null,
  externalData: null,
  analytics: null,
  payments: null,
  createdAtISO: '2024-01-15T10:30:00.000Z',
  updatedAtISO: '2024-01-15T10:30:00.000Z'
};

const SAMPLE_SPONSOR = {
  id: 'sp_acme123',
  name: 'Acme Corp',
  logoUrl: 'https://example.com/logo.png',
  linkUrl: 'https://acmecorp.com',
  placement: 'poster'
};

const SAMPLE_FORM_CONFIG = {
  formId: '1FAIpQLSc...',
  signupUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSc.../viewform',
  shortLink: 'https://bit.ly/event-signup',
  qrB64: 'data:image/png;base64,iVBORw0...',
  totalResponses: 42
};

const SAMPLE_SHARED_ANALYTICS = {
  lastUpdatedISO: '2024-07-15T14:30:00.000Z',
  summary: {
    totalImpressions: 1250,
    totalClicks: 87,
    totalQrScans: 34,
    totalSignups: 28,
    uniqueEvents: 5,
    uniqueSponsors: 3
  },
  surfaces: [
    { id: 'public', label: 'Public Page', impressions: 500, clicks: 35, qrScans: 12, engagementRate: 9.4 },
    { id: 'display', label: 'Display', impressions: 400, clicks: 28, qrScans: 8, engagementRate: 9.0 },
    { id: 'poster', label: 'Poster', impressions: 200, clicks: 15, qrScans: 10, engagementRate: 12.5 },
    { id: 'signup', label: 'Sign Up', impressions: 150, clicks: 9, qrScans: 4, engagementRate: 8.7 }
  ],
  sponsors: [
    { id: 'sp_1', name: 'Acme Corp', impressions: 800, clicks: 45, ctr: 5.6 }
  ],
  events: [
    { id: 'evt_1', name: 'Summer Tournament', impressions: 600, clicks: 40, ctr: 6.7, signupsCount: 15 }
  ],
  topSponsors: [
    { id: 'sp_1', name: 'Acme Corp', impressions: 800, clicks: 45, ctr: 5.6 }
  ]
};

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Load and parse JSON schema file
 */
function loadSchema(filename) {
  const filepath = path.join(SCHEMAS_DIR, filename);
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch (e) {
    throw new Error(`Failed to load schema ${filename}: ${e.message}`);
  }
}

/**
 * Get all property keys from a JSON schema (flattened)
 */
function getSchemaKeys(schema, prefix = '') {
  const keys = new Set();

  if (!schema || typeof schema !== 'object') return keys;

  if (schema.properties) {
    for (const key of Object.keys(schema.properties)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      keys.add(fullKey);
    }
  }

  return keys;
}

/**
 * Get all keys from a sample object (flattened)
 */
function getSampleKeys(obj, prefix = '') {
  const keys = new Set();

  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return keys;

  for (const key of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    keys.add(fullKey);
  }

  return keys;
}

/**
 * Compare schema keys with sample data keys
 */
function compareKeys(schemaKeys, sampleKeys, schemaName) {
  const missingInSample = [];
  const extraInSample = [];

  for (const key of schemaKeys) {
    if (!sampleKeys.has(key)) {
      missingInSample.push(key);
    }
  }

  for (const key of sampleKeys) {
    if (!schemaKeys.has(key)) {
      extraInSample.push(key);
    }
  }

  return { missingInSample, extraInSample };
}

// ============================================================================
// Main Validation
// ============================================================================

function main() {
  console.log('Schema Sync Validation Helper');
  console.log('=============================\n');

  let errors = 0;

  // Check that all schema files exist
  const schemaFiles = [
    'event.schema.json',
    'sponsor.schema.json',
    'form-config.schema.json',
    'shared-analytics.schema.json'
  ];

  console.log('1. Checking schema files exist...');
  for (const file of schemaFiles) {
    const filepath = path.join(SCHEMAS_DIR, file);
    if (fs.existsSync(filepath)) {
      console.log(`   ✓ ${file}`);
    } else {
      console.log(`   ✗ ${file} - NOT FOUND`);
      errors++;
    }
  }
  console.log('');

  // Load schemas
  console.log('2. Loading and validating JSON schemas...');
  let eventSchema, sponsorSchema, formConfigSchema, sharedAnalyticsSchema;
  try {
    eventSchema = loadSchema('event.schema.json');
    console.log('   ✓ event.schema.json');
  } catch (e) {
    console.log(`   ✗ event.schema.json - ${e.message}`);
    errors++;
  }
  try {
    sponsorSchema = loadSchema('sponsor.schema.json');
    console.log('   ✓ sponsor.schema.json');
  } catch (e) {
    console.log(`   ✗ sponsor.schema.json - ${e.message}`);
    errors++;
  }
  try {
    formConfigSchema = loadSchema('form-config.schema.json');
    console.log('   ✓ form-config.schema.json');
  } catch (e) {
    console.log(`   ✗ form-config.schema.json - ${e.message}`);
    errors++;
  }
  try {
    sharedAnalyticsSchema = loadSchema('shared-analytics.schema.json');
    console.log('   ✓ shared-analytics.schema.json');
  } catch (e) {
    console.log(`   ✗ shared-analytics.schema.json - ${e.message}`);
    errors++;
  }
  console.log('');

  // Compare sample data with schemas
  console.log('3. Validating sample data against schemas...\n');

  // Event schema
  if (eventSchema) {
    const schemaKeys = getSchemaKeys(eventSchema);
    const sampleKeys = getSampleKeys(SAMPLE_EVENT);
    const { missingInSample, extraInSample } = compareKeys(schemaKeys, sampleKeys, 'event');

    if (missingInSample.length === 0 && extraInSample.length === 0) {
      console.log('   ✓ Event: All top-level fields match');
    } else {
      if (missingInSample.length > 0) {
        console.log(`   ✗ Event: Missing in sample: ${missingInSample.join(', ')}`);
        errors++;
      }
      if (extraInSample.length > 0) {
        console.log(`   ⚠ Event: Extra in sample: ${extraInSample.join(', ')}`);
      }
    }
  }

  // Sponsor schema
  if (sponsorSchema) {
    const schemaKeys = getSchemaKeys(sponsorSchema);
    const sampleKeys = getSampleKeys(SAMPLE_SPONSOR);
    const { missingInSample, extraInSample } = compareKeys(schemaKeys, sampleKeys, 'sponsor');

    if (missingInSample.length === 0 && extraInSample.length === 0) {
      console.log('   ✓ Sponsor: All fields match');
    } else {
      if (missingInSample.length > 0) {
        console.log(`   ✗ Sponsor: Missing in sample: ${missingInSample.join(', ')}`);
        errors++;
      }
      if (extraInSample.length > 0) {
        console.log(`   ⚠ Sponsor: Extra in sample: ${extraInSample.join(', ')}`);
      }
    }
  }

  // FormConfig schema
  if (formConfigSchema) {
    const schemaKeys = getSchemaKeys(formConfigSchema);
    const sampleKeys = getSampleKeys(SAMPLE_FORM_CONFIG);
    const { missingInSample, extraInSample } = compareKeys(schemaKeys, sampleKeys, 'formConfig');

    if (missingInSample.length === 0 && extraInSample.length === 0) {
      console.log('   ✓ FormConfig: All fields match');
    } else {
      if (missingInSample.length > 0) {
        console.log(`   ✗ FormConfig: Missing in sample: ${missingInSample.join(', ')}`);
        errors++;
      }
      if (extraInSample.length > 0) {
        console.log(`   ⚠ FormConfig: Extra in sample: ${extraInSample.join(', ')}`);
      }
    }
  }

  // SharedAnalytics schema
  if (sharedAnalyticsSchema) {
    const schemaKeys = getSchemaKeys(sharedAnalyticsSchema);
    const sampleKeys = getSampleKeys(SAMPLE_SHARED_ANALYTICS);
    const { missingInSample, extraInSample } = compareKeys(schemaKeys, sampleKeys, 'sharedAnalytics');

    if (missingInSample.length === 0 && extraInSample.length === 0) {
      console.log('   ✓ SharedAnalytics: All fields match');
    } else {
      if (missingInSample.length > 0) {
        console.log(`   ✗ SharedAnalytics: Missing in sample: ${missingInSample.join(', ')}`);
        errors++;
      }
      if (extraInSample.length > 0) {
        console.log(`   ⚠ SharedAnalytics: Extra in sample: ${extraInSample.join(', ')}`);
      }
    }
  }

  console.log('');

  // Summary
  console.log('=============================');
  if (errors === 0) {
    console.log('✓ All schema validations passed!\n');
    console.log('For full contract tests run: npm run test:schemas');
    process.exit(0);
  } else {
    console.log(`✗ ${errors} validation error(s) found\n`);
    console.log('Fix the issues above and run again.');
    console.log('For full contract tests run: npm run test:schemas');
    process.exit(1);
  }
}

main();
