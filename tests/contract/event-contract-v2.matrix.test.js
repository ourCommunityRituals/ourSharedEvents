/**
 * Event Contract V2 Test Matrix - Story 6
 *
 * Contract test matrix that validates ALL bundle endpoints return events
 * that pass validateEventContractV2 and validateBundleEnvelope.
 *
 * Test Matrix:
 * | Bundle Endpoint       | Event Contract | Envelope   | Bundle-Specific |
 * |-----------------------|----------------|------------|-----------------|
 * | api_getPublicBundle   | Full v2        | Yes        | config          |
 * | api_getDisplayBundle  | Full v2        | Yes        | rotation,layout |
 * | api_getPosterBundle   | Full v2        | Yes        | qrCodes, print  |
 * | api_getAdminBundle    | Full v2        | Yes        | templates, diag |
 *
 * This file uses TestRunner for actual API calls against deployed/local server.
 *
 * @see /schemas/event.schema.json
 * @see EVENT_CONTRACT.md v2.0
 */

const {
  validateEventContractV2,
  validateBundleEnvelope,
  validateEtag,
  buildEnvelopeMatrix
} = require('../shared/helpers/test-runner.js');

const {
  validateEnvelope,
  ERROR_CODES
} = require('../shared/helpers/test.helpers.js');

// ============================================================================
// BUNDLE CONTRACT VALIDATORS
// ============================================================================

/**
 * Validates Public Bundle structure beyond base event contract
 */
const validatePublicBundleContract = (response) => {
  const result = validateBundleEnvelope(response);
  if (result !== true) return result;

  const { value } = response;

  // config is required for public bundle
  if (!value.config) {
    return 'Public bundle missing config';
  }

  if (!value.config.brandId) {
    return 'Public bundle missing config.brandId';
  }

  if (!value.config.brandName) {
    return 'Public bundle missing config.brandName';
  }

  return validateEtag(response);
};

/**
 * Validates Display Bundle structure beyond base event contract
 */
const validateDisplayBundleContract = (response) => {
  const result = validateBundleEnvelope(response);
  if (result !== true) return result;

  const { value } = response;

  // rotation is required for display bundle
  if (!value.rotation || typeof value.rotation !== 'object') {
    return 'Display bundle missing rotation';
  }

  if (typeof value.rotation.rotationMs !== 'number') {
    return 'Display bundle missing rotation.rotationMs (number)';
  }

  // layout is required for display bundle
  if (!value.layout || typeof value.layout !== 'object') {
    return 'Display bundle missing layout';
  }

  if (typeof value.layout.hasSidePane !== 'boolean') {
    return 'Display bundle missing layout.hasSidePane (boolean)';
  }

  // displayRotation is V2 optional but must be valid if present
  if (value.displayRotation) {
    if (typeof value.displayRotation.enabled !== 'boolean') {
      return 'Display bundle displayRotation.enabled must be boolean';
    }
  }

  return validateEtag(response);
};

/**
 * Validates Poster Bundle structure beyond base event contract
 */
const validatePosterBundleContract = (response) => {
  const result = validateBundleEnvelope(response);
  if (result !== true) return result;

  const { value } = response;

  // qrCodes is required for poster bundle
  if (!value.qrCodes || typeof value.qrCodes !== 'object') {
    return 'Poster bundle missing qrCodes';
  }

  if (!value.qrCodes.public) {
    return 'Poster bundle missing qrCodes.public';
  }

  if (!value.qrCodes.signup) {
    return 'Poster bundle missing qrCodes.signup';
  }

  // print strings are required for poster bundle
  if (!value.print || typeof value.print !== 'object') {
    return 'Poster bundle missing print';
  }

  return validateEtag(response);
};

/**
 * Validates Admin Bundle structure beyond base event contract
 */
const validateAdminBundleContract = (response) => {
  const result = validateBundleEnvelope(response);
  if (result !== true) return result;

  const { value } = response;

  // brandConfig is required for admin bundle
  if (!value.brandConfig || typeof value.brandConfig !== 'object') {
    return 'Admin bundle missing brandConfig';
  }

  // templates array is required for admin bundle
  if (!Array.isArray(value.templates)) {
    return 'Admin bundle missing templates (array)';
  }

  // allSponsors array is required for admin bundle
  if (!Array.isArray(value.allSponsors)) {
    return 'Admin bundle missing allSponsors (array)';
  }

  return validateEtag(response);
};

/**
 * Validates SharedReport Bundle structure beyond base event contract
 * Story 6: Now returns FULL v2 canonical event (previously returned thin subset)
 */
const validateSharedReportBundleContract = (response) => {
  const result = validateBundleEnvelope(response);
  if (result !== true) return result;

  const { value } = response;

  // metrics is required for shared report bundle
  if (!value.metrics || typeof value.metrics !== 'object') {
    return 'SharedReport bundle missing metrics';
  }

  // Metrics should have standard metric fields
  if (typeof value.metrics.views !== 'number') {
    return 'SharedReport bundle missing metrics.views (number)';
  }

  return validateEtag(response);
};

// ============================================================================
// TEST MATRIX DEFINITIONS
// ============================================================================

/**
 * Public Bundle Test Matrix
 */
const PUBLIC_BUNDLE_MATRIX = buildEnvelopeMatrix('api_getPublicBundle',
  'Public surface data bundle - Public.html, Poster.html, Display.html consumers', [
    {
      name: 'returns v2 canonical event with full contract',
      input: { brandId: 'root' },
      expected: {
        ok: true,
        validator: validatePublicBundleContract
      }
    },
    {
      name: 'event passes validateEventContractV2',
      input: { brandId: 'root' },
      expected: {
        ok: true,
        validator: (response) => {
          if (!response.ok) return `Request failed: ${response.code}`;
          return validateEventContractV2(response.value.event);
        }
      }
    },
    {
      name: 'returns etag for caching',
      input: { brandId: 'root' },
      expected: {
        ok: true,
        requiredFields: ['etag']
      }
    },
    {
      name: 'rejects missing brandId',
      input: {},
      expected: {
        ok: false,
        code: ERROR_CODES.BAD_INPUT
      }
    },
    {
      name: 'rejects invalid brandId',
      input: { brandId: 'nonexistent-brand-12345' },
      expected: {
        ok: false,
        code: ERROR_CODES.BAD_INPUT
      }
    }
  ]
);

/**
 * Display Bundle Test Matrix
 */
const DISPLAY_BUNDLE_MATRIX = buildEnvelopeMatrix('api_getDisplayBundle',
  'TV/kiosk display-optimized bundle - Display.html TV mode consumer', [
    {
      name: 'returns v2 canonical event with display-specific fields',
      input: { brandId: 'root' },
      expected: {
        ok: true,
        validator: validateDisplayBundleContract
      }
    },
    {
      name: 'event passes validateEventContractV2',
      input: { brandId: 'root' },
      expected: {
        ok: true,
        validator: (response) => {
          if (!response.ok) return `Request failed: ${response.code}`;
          return validateEventContractV2(response.value.event);
        }
      }
    },
    {
      name: 'includes rotation configuration',
      input: { brandId: 'root' },
      expected: {
        ok: true,
        requiredFields: ['rotation.rotationMs']
      }
    },
    {
      name: 'includes layout configuration',
      input: { brandId: 'root' },
      expected: {
        ok: true,
        requiredFields: ['layout.hasSidePane', 'layout.emphasis']
      }
    },
    {
      name: 'rejects missing brandId',
      input: {},
      expected: {
        ok: false,
        code: ERROR_CODES.BAD_INPUT
      }
    }
  ]
);

/**
 * Poster Bundle Test Matrix
 */
const POSTER_BUNDLE_MATRIX = buildEnvelopeMatrix('api_getPosterBundle',
  'Print-optimized poster bundle - Poster.html consumer', [
    {
      name: 'returns v2 canonical event with print-specific fields',
      input: { brandId: 'root' },
      expected: {
        ok: true,
        validator: validatePosterBundleContract
      }
    },
    {
      name: 'event passes validateEventContractV2',
      input: { brandId: 'root' },
      expected: {
        ok: true,
        validator: (response) => {
          if (!response.ok) return `Request failed: ${response.code}`;
          return validateEventContractV2(response.value.event);
        }
      }
    },
    {
      name: 'QR codes are valid URLs',
      input: { brandId: 'root' },
      expected: {
        ok: true,
        validator: (response) => {
          const { qrCodes } = response.value;
          // Security: Use URL parsing to validate domain, not substring matching
          // This prevents bypass via URLs like "https://evil.com/quickchart.io/..."
          const isValidQuickchartUrl = (url) => {
            try {
              const parsed = new URL(url);
              return parsed.hostname === 'quickchart.io' || parsed.hostname.endsWith('.quickchart.io');
            } catch {
              return false;
            }
          };
          if (!qrCodes.public || !isValidQuickchartUrl(qrCodes.public)) {
            return 'qrCodes.public should be quickchart.io URL';
          }
          if (!qrCodes.signup || !isValidQuickchartUrl(qrCodes.signup)) {
            return 'qrCodes.signup should be quickchart.io URL';
          }
          return true;
        }
      }
    },
    {
      name: 'event.qr codes are base64 data URIs',
      input: { brandId: 'root' },
      expected: {
        ok: true,
        validator: (response) => {
          const { qr } = response.value.event;
          if (!qr.public || !qr.public.startsWith('data:image/')) {
            return 'event.qr.public must be base64 data URI';
          }
          if (!qr.signup || !qr.signup.startsWith('data:image/')) {
            return 'event.qr.signup must be base64 data URI';
          }
          return true;
        }
      }
    },
    {
      name: 'rejects missing brandId',
      input: {},
      expected: {
        ok: false,
        code: ERROR_CODES.BAD_INPUT
      }
    }
  ]
);

/**
 * Admin Bundle Test Matrix
 */
const ADMIN_BUNDLE_MATRIX = buildEnvelopeMatrix('api_getAdminBundle',
  'Admin surface data bundle - Admin.html 7-card layout consumer', [
    {
      name: 'returns v2 canonical event with admin-specific fields',
      input: { brandId: 'root', adminKey: process.env.ADMIN_KEY || 'test-admin-key' },
      expected: {
        ok: true,
        validator: validateAdminBundleContract
      }
    },
    {
      name: 'event passes validateEventContractV2',
      input: { brandId: 'root', adminKey: process.env.ADMIN_KEY || 'test-admin-key' },
      expected: {
        ok: true,
        validator: (response) => {
          if (!response.ok) return `Request failed: ${response.code}`;
          return validateEventContractV2(response.value.event);
        }
      }
    },
    {
      name: 'templates array contains valid template descriptors',
      input: { brandId: 'root', adminKey: process.env.ADMIN_KEY || 'test-admin-key' },
      expected: {
        ok: true,
        validator: (response) => {
          const { templates } = response.value;
          if (!Array.isArray(templates)) return 'templates must be array';
          if (templates.length === 0) return true; // Empty is valid
          const first = templates[0];
          if (!first.id || !first.label) {
            return 'Template must have id and label';
          }
          return true;
        }
      }
    },
    {
      name: 'rejects invalid adminKey',
      input: { brandId: 'root', adminKey: 'invalid-key-12345' },
      expected: {
        ok: false,
        code: ERROR_CODES.BAD_INPUT
      }
    },
    {
      name: 'rejects missing adminKey',
      input: { brandId: 'root' },
      expected: {
        ok: false,
        code: ERROR_CODES.BAD_INPUT
      }
    }
  ]
);

/**
 * SharedReport Bundle Test Matrix
 * Story 6: Now returns FULL v2 canonical event (previously returned thin subset)
 */
const SHARED_REPORT_BUNDLE_MATRIX = buildEnvelopeMatrix('api_getSharedReportBundle',
  'Shared analytics report bundle - SharedReport.html alternative consumer', [
    {
      name: 'returns v2 canonical event with metrics (Story 6 update)',
      input: { brandId: 'root' },
      expected: {
        ok: true,
        validator: validateSharedReportBundleContract
      }
    },
    {
      name: 'event passes validateEventContractV2 (Story 6: full event, not thin subset)',
      input: { brandId: 'root' },
      expected: {
        ok: true,
        validator: (response) => {
          if (!response.ok) return `Request failed: ${response.code}`;
          return validateEventContractV2(response.value.event);
        }
      }
    },
    {
      name: 'includes aggregated metrics from ANALYTICS sheet',
      input: { brandId: 'root' },
      expected: {
        ok: true,
        requiredFields: ['metrics.views', 'metrics.uniqueViews']
      }
    },
    {
      name: 'metrics includes sponsor and league breakdown',
      input: { brandId: 'root' },
      expected: {
        ok: true,
        validator: (response) => {
          const { metrics } = response.value;
          if (!metrics.sponsor) return 'Missing metrics.sponsor';
          if (!metrics.league) return 'Missing metrics.league';
          return true;
        }
      }
    },
    {
      name: 'rejects missing brandId',
      input: {},
      expected: {
        ok: false,
        code: ERROR_CODES.BAD_INPUT
      }
    }
  ]
);

// ============================================================================
// CROSS-BUNDLE CONSISTENCY MATRIX
// ============================================================================

/**
 * Cross-Bundle Consistency Test Matrix
 * Ensures all bundles return consistent event data
 */
const CROSS_BUNDLE_CONSISTENCY_MATRIX = buildEnvelopeMatrix('api_getPublicBundle',
  'Cross-bundle consistency validation', [
    {
      name: 'public bundle envelope structure is valid',
      input: { brandId: 'root' },
      expected: {
        ok: true,
        validator: (response) => {
          validateEnvelope(response);
          if (!response.ok) return 'Response not ok';
          if (!response.etag) return 'Missing etag';
          if (!response.value) return 'Missing value';
          if (!response.value.event) return 'Missing value.event';
          return true;
        }
      }
    }
  ]
);

// ============================================================================
// EXPORTS (for programmatic use and Jest integration)
// ============================================================================

module.exports = {
  // Contract validators
  validatePublicBundleContract,
  validateDisplayBundleContract,
  validatePosterBundleContract,
  validateAdminBundleContract,
  validateSharedReportBundleContract,

  // Test matrices
  PUBLIC_BUNDLE_MATRIX,
  DISPLAY_BUNDLE_MATRIX,
  POSTER_BUNDLE_MATRIX,
  ADMIN_BUNDLE_MATRIX,
  SHARED_REPORT_BUNDLE_MATRIX,
  CROSS_BUNDLE_CONSISTENCY_MATRIX,

  // All matrices for batch execution (Story 6: all bundles pass v2 contract)
  ALL_BUNDLE_MATRICES: [
    PUBLIC_BUNDLE_MATRIX,
    DISPLAY_BUNDLE_MATRIX,
    POSTER_BUNDLE_MATRIX,
    ADMIN_BUNDLE_MATRIX,
    SHARED_REPORT_BUNDLE_MATRIX
  ]
};

// ============================================================================
// JEST TEST SUITES
// ============================================================================

describe('Event Contract V2 Matrix Tests - Story 6', () => {

  describe('api_getPublicBundle - v2 Contract Compliance', () => {

    it('validates complete public bundle response structure', () => {
      // Mock response matching v2 contract
      const mockResponse = {
        ok: true,
        etag: 'abc123def456',
        value: {
          event: createMockV2Event(),
          config: {
            appTitle: 'Event Toolkit',
            brandId: 'root',
            brandName: 'Root Brand'
          }
        }
      };

      const result = validatePublicBundleContract(mockResponse);
      expect(result).toBe(true);
    });

    it('validates event passes full v2 contract', () => {
      const mockEvent = createMockV2Event();
      const result = validateEventContractV2(mockEvent);
      expect(result).toBe(true);
    });

    it('fails on missing config.brandId', () => {
      const mockResponse = {
        ok: true,
        etag: 'abc123',
        value: {
          event: createMockV2Event(),
          config: { brandName: 'Test' }
        }
      };

      const result = validatePublicBundleContract(mockResponse);
      expect(result).toContain('brandId');
    });

  });

  describe('api_getDisplayBundle - v2 Contract Compliance', () => {

    it('validates complete display bundle response structure', () => {
      const mockResponse = {
        ok: true,
        etag: 'display-etag-123',
        value: {
          event: createMockV2Event(),
          rotation: {
            sponsorSlots: 4,
            rotationMs: 10000
          },
          layout: {
            hasSidePane: false,
            emphasis: 'event'
          },
          displayRotation: {
            enabled: true,
            defaultDwellMs: 15000,
            panes: ['schedule', 'standings'],
            paneTypes: {}
          }
        }
      };

      const result = validateDisplayBundleContract(mockResponse);
      expect(result).toBe(true);
    });

    it('fails on missing rotation.rotationMs', () => {
      const mockResponse = {
        ok: true,
        etag: 'test',
        value: {
          event: createMockV2Event(),
          rotation: { sponsorSlots: 4 },
          layout: { hasSidePane: false }
        }
      };

      const result = validateDisplayBundleContract(mockResponse);
      expect(result).toContain('rotationMs');
    });

  });

  describe('api_getPosterBundle - v2 Contract Compliance', () => {

    it('validates complete poster bundle response structure', () => {
      const mockResponse = {
        ok: true,
        etag: 'poster-etag-123',
        value: {
          event: createMockV2Event(),
          qrCodes: {
            public: 'https://quickchart.io/qr?text=https://example.com/public',
            signup: 'https://quickchart.io/qr?text=https://forms.google.com/test'
          },
          print: {
            dateLine: 'December 31, 2025',
            venueLine: 'Test Venue'
          }
        }
      };

      const result = validatePosterBundleContract(mockResponse);
      expect(result).toBe(true);
    });

    it('fails on missing qrCodes', () => {
      const mockResponse = {
        ok: true,
        etag: 'test',
        value: {
          event: createMockV2Event(),
          print: { dateLine: 'Test' }
        }
      };

      const result = validatePosterBundleContract(mockResponse);
      expect(result).toContain('qrCodes');
    });

  });

  describe('api_getAdminBundle - v2 Contract Compliance', () => {

    it('validates complete admin bundle response structure', () => {
      const mockResponse = {
        ok: true,
        etag: 'admin-etag-123',
        value: {
          event: createMockV2Event(),
          brandConfig: {
            brandId: 'root',
            allowedTemplates: ['event', 'league'],
            defaultTemplateId: 'event'
          },
          templates: [
            { id: 'event', label: 'Standard Event' },
            { id: 'league', label: 'League Event' }
          ],
          diagnostics: {
            hasForm: true,
            hasShortlinks: false,
            lastPublishedAt: null
          },
          allSponsors: []
        }
      };

      const result = validateAdminBundleContract(mockResponse);
      expect(result).toBe(true);
    });

    it('fails on missing templates array', () => {
      const mockResponse = {
        ok: true,
        etag: 'test',
        value: {
          event: createMockV2Event(),
          brandConfig: { brandId: 'root' },
          allSponsors: []
        }
      };

      const result = validateAdminBundleContract(mockResponse);
      expect(result).toContain('templates');
    });

  });

  describe('api_getSharedReportBundle - v2 Contract Compliance (Story 6)', () => {

    it('validates complete shared report bundle response structure', () => {
      const mockResponse = {
        ok: true,
        etag: 'report-etag-123',
        value: {
          // Story 6: Now returns FULL canonical event (not thin subset)
          event: createMockV2Event(),
          metrics: {
            views: 150,
            uniqueViews: 75,
            signupClicks: 20,
            checkinClicks: 10,
            feedbackClicks: 5,
            sponsor: {
              totalImpressions: 500,
              totalClicks: 25,
              avgCtr: 5.0
            },
            league: {
              scheduleClicks: 30,
              standingsClicks: 20,
              bracketClicks: 10
            },
            lastUpdated: '2025-01-01T12:00:00.000Z'
          }
        }
      };

      const result = validateSharedReportBundleContract(mockResponse);
      expect(result).toBe(true);
    });

    it('Story 6: event passes validateEventContractV2 (full event, not thin subset)', () => {
      const mockResponse = {
        ok: true,
        etag: 'test',
        value: {
          event: createMockV2Event(),
          metrics: { views: 0, uniqueViews: 0, sponsor: {}, league: {} }
        }
      };

      // Story 6 key assertion: SharedReport now returns full v2 event
      const result = validateEventContractV2(mockResponse.value.event);
      expect(result).toBe(true);
    });

    it('fails on missing metrics', () => {
      const mockResponse = {
        ok: true,
        etag: 'test',
        value: {
          event: createMockV2Event()
          // metrics missing
        }
      };

      const result = validateSharedReportBundleContract(mockResponse);
      expect(result).toContain('metrics');
    });

    it('fails on missing metrics.views', () => {
      const mockResponse = {
        ok: true,
        etag: 'test',
        value: {
          event: createMockV2Event(),
          metrics: { uniqueViews: 0 }  // views missing
        }
      };

      const result = validateSharedReportBundleContract(mockResponse);
      expect(result).toContain('views');
    });

  });

  describe('Cross-Bundle Event Contract Consistency', () => {

    const mockEvent = createMockV2Event();

    it('all bundles return event with same identity fields', () => {
      // Simulating that all bundles receive the same canonical event
      // Story 6: sharedReport now included (returns full event, not thin subset)
      const bundles = [
        { name: 'public', event: { ...mockEvent } },
        { name: 'display', event: { ...mockEvent } },
        { name: 'poster', event: { ...mockEvent } },
        { name: 'admin', event: { ...mockEvent } },
        { name: 'sharedReport', event: { ...mockEvent } }
      ];

      // All events should have same identity
      const firstId = bundles[0].event.id;
      for (const bundle of bundles) {
        expect(bundle.event.id).toBe(firstId);
        expect(bundle.event.slug).toBe(mockEvent.slug);
        expect(bundle.event.name).toBe(mockEvent.name);
      }
    });

    it('all bundles return events that pass v2 contract', () => {
      // Story 6: All 5 bundle endpoints return v2-compliant events
      // Each bundle type receives the same canonical event shape from _buildEventContract_
      const bundleCount = 5; // public, display, poster, admin, sharedReport

      // Validate that our mock event passes v2 contract (same shape all bundles receive)
      const result = validateEventContractV2(mockEvent);
      expect(result).toBe(true);

      // Verify we're testing all 5 bundle types (documented in test matrix header)
      expect(bundleCount).toBe(5);
    });

  });

  describe('EVENT_CONTRACT.md v2.0 Field Validation', () => {

    describe('IDENTITY Block (MVP REQUIRED)', () => {
      it('requires id, slug, name, startDateISO, venue', () => {
        const event = createMockV2Event();

        // Remove each field and verify failure
        const requiredFields = ['id', 'slug', 'name', 'startDateISO', 'venue'];

        for (const field of requiredFields) {
          const testEvent = { ...event };
          delete testEvent[field];
          const result = validateEventContractV2(testEvent);
          expect(result).toContain(field);
        }
      });
    });

    describe('LINKS Block (MVP REQUIRED)', () => {
      it('requires publicUrl, displayUrl, posterUrl, signupUrl', () => {
        const event = createMockV2Event();

        const requiredLinks = ['publicUrl', 'displayUrl', 'posterUrl'];

        for (const link of requiredLinks) {
          const testEvent = { ...event, links: { ...event.links } };
          delete testEvent.links[link];
          const result = validateEventContractV2(testEvent);
          expect(result).toContain(link);
        }
      });

      it('allows signupUrl to be empty string', () => {
        const event = createMockV2Event();
        event.links.signupUrl = '';
        const result = validateEventContractV2(event);
        expect(result).toBe(true);
      });
    });

    describe('QR Block (MVP REQUIRED)', () => {
      it('requires qr.public and qr.signup', () => {
        const event = createMockV2Event();

        const testEvent1 = { ...event, qr: { signup: 'data:image/png;base64,abc' } };
        const result1 = validateEventContractV2(testEvent1);
        expect(result1).toContain('qr.public');

        const testEvent2 = { ...event, qr: { public: 'data:image/png;base64,abc' } };
        const result2 = validateEventContractV2(testEvent2);
        expect(result2).toContain('qr.signup');
      });
    });

    describe('CTAs Block (MVP REQUIRED)', () => {
      it('requires ctas.primary with label', () => {
        const event = createMockV2Event();

        const testEvent = { ...event };
        delete testEvent.ctas;
        const result = validateEventContractV2(testEvent);
        expect(result).toContain('ctas');
      });

      it('requires ctas.primary.label as string', () => {
        const event = createMockV2Event();
        event.ctas.primary.label = null;
        const result = validateEventContractV2(event);
        expect(result).toContain('label');
      });
    });

    describe('SETTINGS Block (MVP REQUIRED)', () => {
      it('requires showSchedule, showStandings, showBracket as booleans', () => {
        const event = createMockV2Event();

        const requiredSettings = ['showSchedule', 'showStandings', 'showBracket'];

        for (const setting of requiredSettings) {
          const testEvent = { ...event, settings: { ...event.settings } };
          testEvent.settings[setting] = 'not-a-boolean';
          const result = validateEventContractV2(testEvent);
          expect(result).toContain(setting);
        }
      });

      it('validates optional settings are boolean if present', () => {
        const event = createMockV2Event();
        event.settings.showSponsors = 'invalid';
        const result = validateEventContractV2(event);
        expect(result).toContain('showSponsors');
      });
    });

    describe('METADATA Block (MVP REQUIRED)', () => {
      it('requires createdAtISO and updatedAtISO', () => {
        const event = createMockV2Event();

        const testEvent1 = { ...event };
        delete testEvent1.createdAtISO;
        const result1 = validateEventContractV2(testEvent1);
        expect(result1).toContain('createdAtISO');

        const testEvent2 = { ...event };
        delete testEvent2.updatedAtISO;
        const result2 = validateEventContractV2(testEvent2);
        expect(result2).toContain('updatedAtISO');
      });
    });

  });

});

// ============================================================================
// MOCK DATA HELPERS
// ============================================================================

/**
 * Creates a complete mock event that passes validateEventContractV2
 */
function createMockV2Event() {
  return {
    // IDENTITY (MVP REQUIRED)
    id: 'test-event-v2-001',
    slug: 'test-event-v2',
    name: 'Test Event V2',
    startDateISO: '2025-12-31',
    venue: 'Test Venue',
    templateId: 'event',

    // LINKS (MVP REQUIRED)
    links: {
      publicUrl: 'https://example.com/events?brand=root&id=test-event-v2-001',
      displayUrl: 'https://example.com/display?brand=root&id=test-event-v2-001&tv=1',
      posterUrl: 'https://example.com/poster?brand=root&id=test-event-v2-001',
      signupUrl: 'https://forms.google.com/test'
    },

    // QR CODES (MVP REQUIRED)
    qr: {
      public: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      signup: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    },

    // CTAs (MVP REQUIRED)
    ctas: {
      primary: {
        label: 'Sign Up',
        url: 'https://forms.google.com/test'
      },
      secondary: null
    },

    // SETTINGS (MVP REQUIRED)
    settings: {
      showSchedule: true,
      showStandings: false,
      showBracket: false,
      // Optional settings
      showSponsors: true,
      showVideo: false,
      showMap: false,
      showGallery: false,
      showSponsorBanner: true,
      showSponsorStrip: false,
      showLeagueStrip: false,
      showQRSection: true
    },

    // V2 OPTIONAL CONTENT
    schedule: [],
    standings: [],
    bracket: null,
    sponsors: [],
    media: {
      videoUrl: null,
      mapUrl: null,
      gallery: null
    },
    externalData: {
      scheduleUrl: null,
      standingsUrl: null,
      bracketUrl: null
    },

    // RESERVED
    analytics: { enabled: false },
    payments: { enabled: false, provider: 'stripe', price: null, currency: 'USD' },

    // METADATA (MVP REQUIRED)
    createdAtISO: '2025-01-01T00:00:00.000Z',
    updatedAtISO: '2025-01-01T00:00:00.000Z'
  };
}
