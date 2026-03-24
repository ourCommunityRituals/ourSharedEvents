#!/usr/bin/env node

/**
 * Matrix Tests Runner Script
 *
 * Runs comprehensive matrix tests against a live deployment using TestRunner.
 * This script validates:
 *   - Bundle endpoints (public, display, admin, poster)
 *   - Brand configs (multi-brand validation)
 *   - Sponsor contracts
 *   - Envelope boundary compliance (API_CONTRACT.md)
 *
 * Usage:
 *   BASE_URL=https://stg.eventangle.com node scripts/run-matrix-tests.js
 *   ADMIN_KEY=xxx node scripts/run-matrix-tests.js
 *
 * Exit codes:
 *   0 - All tests passed
 *   1 - Some tests failed
 */

const {
  TestRunner,
  validateEventContractV2,
  validateBundleEnvelope,
  validateBrandConfig,
  validateSponsorContract,
  buildSuccessMatrix,
  buildErrorMatrix,
  buildFlatMatrix,
  FLAT_ENDPOINTS
} = require('../tests/shared/helpers/test-runner.js');

// ============================================================================
// CONFIGURATION
// ============================================================================

const BASE_URL = process.env.BASE_URL || 'https://stg.eventangle.com';
const ADMIN_KEY = process.env.ADMIN_KEY || process.env.ADMIN_KEY_ROOT || '';
const VERBOSE = process.env.VERBOSE === 'true' || process.argv.includes('--verbose');

// Supported brands for multi-brand testing
const BRANDS = ['root', 'abc', 'cbc', 'cbl'];

// ============================================================================
// TEST MATRICES
// ============================================================================

/**
 * Bundle Endpoint Tests
 * Tests all MVP bundle endpoints for envelope compliance and contract validation
 */
const bundleMatrices = [
  // Public Bundle
  buildSuccessMatrix('api_getPublicBundle', 'Public bundle - canonical event shape', [
    {
      name: 'returns valid public bundle with event',
      input: { brandId: 'root' },
      expected: {
        ok: true,
        requiredFields: ['event', 'config'],
        validator: (response) => {
          if (!response.value?.event) return 'Missing event in bundle';
          const eventValidation = validateEventContractV2(response.value.event);
          if (eventValidation !== true) return eventValidation;
          return true;
        }
      }
    },
    {
      name: 'event contains links block',
      input: { brandId: 'root' },
      expected: {
        ok: true,
        validator: (response) => {
          const links = response.value?.event?.links;
          if (!links) return 'Missing links block';
          if (!links.publicUrl) return 'Missing publicUrl';
          if (!links.displayUrl) return 'Missing displayUrl';
          return true;
        }
      }
    },
    {
      name: 'event contains QR codes',
      input: { brandId: 'root' },
      expected: {
        ok: true,
        validator: (response) => {
          const qr = response.value?.event?.qr;
          if (!qr) return 'Missing QR block';
          if (!qr.public) return 'Missing public QR';
          return true;
        }
      }
    },
    {
      name: 'includes etag for caching',
      input: { brandId: 'root' },
      expected: {
        ok: true,
        validator: (response) => {
          if (!response.etag) return 'Missing etag';
          if (typeof response.etag !== 'string') return 'Invalid etag type';
          return true;
        }
      }
    }
  ]),

  // Display Bundle
  buildSuccessMatrix('api_getDisplayBundle', 'Display bundle - TV/kiosk mode', [
    {
      name: 'returns valid display bundle',
      input: { brandId: 'root' },
      expected: {
        ok: true,
        requiredFields: ['event'],
        validator: (response) => {
          if (!response.value?.event) return 'Missing event';
          return true;
        }
      }
    },
    {
      name: 'event follows v2.0 canonical shape',
      input: { brandId: 'root' },
      expected: {
        ok: true,
        validator: (response) => {
          const event = response.value?.event;
          if (!event) return 'Missing event';
          return validateEventContractV2(event);
        }
      }
    }
  ]),

  // Poster Bundle
  buildSuccessMatrix('api_getPosterBundle', 'Poster bundle - print-ready', [
    {
      name: 'returns valid poster bundle with QR codes',
      input: { brandId: 'root' },
      expected: {
        ok: true,
        requiredFields: ['event'],
        validator: (response) => {
          const event = response.value?.event;
          if (!event) return 'Missing event';
          if (!event.qr?.public) return 'Missing public QR for poster';
          return true;
        }
      }
    },
    {
      name: 'event follows v2.0 canonical shape',
      input: { brandId: 'root' },
      expected: {
        ok: true,
        validator: (response) => {
          const event = response.value?.event;
          if (!event) return 'Missing event';
          return validateEventContractV2(event);
        }
      }
    }
  ])
];

// Add admin bundle tests only if admin key is available
if (ADMIN_KEY) {
  bundleMatrices.push(
    buildSuccessMatrix('api_getAdminBundle', 'Admin bundle - management interface', [
      {
        name: 'returns valid admin bundle with auth',
        input: { brandId: 'root', adminKey: ADMIN_KEY },
        expected: {
          ok: true,
          requiredFields: ['event'],
          validator: (response) => {
            if (!response.value?.event) return 'Missing event';
            return true;
          }
        }
      },
      {
        name: 'includes brand configuration',
        input: { brandId: 'root', adminKey: ADMIN_KEY },
        expected: {
          ok: true,
          validator: (response) => {
            // brandConfig is optional but should be object if present
            if (response.value?.brandConfig && typeof response.value.brandConfig !== 'object') {
              return 'Invalid brandConfig type';
            }
            return true;
          }
        }
      }
    ])
  );
}

/**
 * Multi-Brand Configuration Tests
 * Validates brand isolation and configuration across all supported brands
 */
const brandConfigMatrices = BRANDS.map(brandId =>
  buildSuccessMatrix('api_getPublicBundle', `Brand config - ${brandId}`, [
    {
      name: `${brandId} brand returns valid config`,
      input: { brandId },
      expected: {
        ok: true,
        validator: (response) => {
          const config = response.value?.config;
          if (!config) return 'Missing config in bundle';
          const validation = validateBrandConfig(config);
          if (validation !== true) return validation;
          // Verify brand isolation
          if (config.brandId !== brandId) {
            return `Brand mismatch: expected ${brandId}, got ${config.brandId}`;
          }
          return true;
        }
      }
    }
  ])
);

/**
 * Sponsor Contract Tests
 * Validates sponsor data structure in bundles
 */
const sponsorMatrices = [
  buildSuccessMatrix('api_getPublicBundle', 'Sponsor contract validation', [
    {
      name: 'sponsors array follows contract',
      input: { brandId: 'root' },
      expected: {
        ok: true,
        validator: (response) => {
          const sponsors = response.value?.event?.sponsors;
          // sponsors is optional, but if present must be array
          if (sponsors === undefined) return true;
          if (!Array.isArray(sponsors)) return 'sponsors must be array';
          // Validate each sponsor if present
          for (const sponsor of sponsors) {
            const validation = validateSponsorContract(sponsor);
            if (validation !== true) return validation;
          }
          return true;
        }
      }
    }
  ]),
  buildSuccessMatrix('api_getPosterBundle', 'Poster sponsor validation', [
    {
      name: 'poster sponsors have required fields for print',
      input: { brandId: 'root' },
      expected: {
        ok: true,
        validator: (response) => {
          const sponsors = response.value?.event?.sponsors;
          if (!sponsors || sponsors.length === 0) return true;
          // Poster sponsors need at least id and name
          for (const sponsor of sponsors) {
            if (!sponsor.id) return 'Sponsor missing id';
            if (!sponsor.name) return 'Sponsor missing name';
          }
          return true;
        }
      }
    }
  ])
];

/**
 * Flat Endpoint Tests (status, statusmvp)
 * Validates flat response format per API_CONTRACT.md Rule 1
 */
const flatEndpointMatrices = [
  buildFlatMatrix('status', 'Status endpoint - flat response', [
    {
      name: 'returns flat status response with buildId',
      input: { brandId: 'root' },
      expected: {
        ok: true,
        validator: (response) => {
          // Flat endpoints must have buildId at root
          if (!response.buildId) return 'Missing buildId at root (flat response)';
          if (!response.brandId) return 'Missing brandId at root (flat response)';
          if (!response.time) return 'Missing time at root (flat response)';
          // Must NOT have value wrapper
          if (response.value !== undefined) {
            return 'Flat endpoint should not have value wrapper';
          }
          return true;
        }
      }
    }
  ]),
  buildFlatMatrix('statusmvp', 'StatusMVP endpoint - flat response', [
    {
      name: 'returns flat statusmvp response',
      input: { brandId: 'root' },
      expected: {
        ok: true,
        validator: (response) => {
          if (!response.buildId) return 'Missing buildId at root';
          if (!response.brandId) return 'Missing brandId at root';
          if (response.value !== undefined) {
            return 'Flat endpoint should not have value wrapper';
          }
          return true;
        }
      }
    }
  ])
];

/**
 * Error Response Tests
 * Validates error envelope structure
 */
const errorMatrices = [
  buildErrorMatrix('api_getPublicBundle', 'Error responses - envelope compliance', [
    {
      name: 'rejects invalid brandId with proper error envelope',
      input: { brandId: 'nonexistent-brand-xyz-123' },
      expected: {
        ok: false,
        code: 'BAD_INPUT',
        validator: (response) => {
          if (response.ok !== false) return 'Expected ok=false';
          if (!response.code) return 'Missing error code';
          if (!response.message) return 'Missing error message';
          return true;
        }
      }
    }
  ]),
  buildErrorMatrix('api_getPublicBundle', 'Missing required fields', [
    {
      name: 'rejects missing brandId',
      input: {},
      expected: {
        ok: false,
        code: 'BAD_INPUT'
      }
    }
  ])
];

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  console.log('');
  console.log('='.repeat(70));
  console.log('🧪 MATRIX TESTS - TestRunner Validation');
  console.log('='.repeat(70));
  console.log('');
  console.log(`📍 Target URL: ${BASE_URL}`);
  console.log(`🔑 Admin Key:  ${ADMIN_KEY ? '✓ Configured' : '✗ Not configured (admin tests skipped)'}`);
  console.log(`📝 Verbose:    ${VERBOSE ? 'Yes' : 'No'}`);
  console.log('');

  // Create TestRunner instance
  const runner = new TestRunner({
    baseUrl: BASE_URL,
    adminKey: ADMIN_KEY,
    brandId: 'root',
    verbose: VERBOSE
  });

  // Collect all matrices
  const allMatrices = [
    ...bundleMatrices,
    ...brandConfigMatrices,
    ...sponsorMatrices,
    ...flatEndpointMatrices,
    ...errorMatrices
  ];

  console.log(`📋 Running ${allMatrices.length} test matrices...\n`);

  try {
    // Run all matrices
    await runner.runAllMatrices(allMatrices);

    // Print report
    const summary = runner.printReport();

    // Create summary for CI
    console.log('\n📊 Matrix Test Summary:');
    console.log(`   Total Tests:  ${summary.total}`);
    console.log(`   Passed:       ${summary.passed}`);
    console.log(`   Failed:       ${summary.failed}`);
    console.log(`   Pass Rate:    ${summary.passRate}%`);
    console.log(`   Duration:     ${summary.duration}ms`);

    // Assert all passed for CI
    if (summary.failed > 0) {
      console.log('\n❌ Matrix tests FAILED');
      console.log('   Review failed tests above for details.');
      process.exit(1);
    }

    console.log('\n✅ All matrix tests PASSED');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Matrix tests encountered an error:');
    console.error(error.message);
    if (VERBOSE) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

module.exports = { main };
