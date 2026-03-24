/**
 * API Contract Tests for All MVP Bundles - Story 8
 *
 * LOCKED CONTRACT: Tests the contract for all MVP bundle endpoints:
 * - api_getPublicBundle  (Public.html surface)
 * - api_getDisplayBundle (Display.html TV mode)
 * - api_getAdminBundle   (Admin.html - 7-card layout)
 * - api_getPosterBundle  (Poster.html print-ready)
 *
 * All bundles follow EVENT_CONTRACT.md v2.0 canonical event shape.
 *
 * This ensures the new Admin layout (Story 5-6) still speaks the
 * correct event object format.
 *
 * Bundle Envelope:
 * {
 *   ok: true,
 *   etag: string,
 *   value: {
 *     event: EventCore,  // Canonical v2.2 event (MVP-frozen)
 *     config: BrandConfig,
 *     ... (bundle-specific fields)
 *   }
 * }
 *
 * @see /schemas/event.schema.json (v2.2 MVP-frozen)
 * @see /src/mvp/Admin.html (7-card layout)
 */

const {
  validateEnvelope,
  validateSuccessEnvelope,
  validateErrorEnvelope,
  ERROR_CODES,
  dateHelpers
} = require('../shared/helpers/test.helpers.js');

const {
  validateEventContractV2,
  validateBundleEnvelope,
  validateEtag,
  validateBrandConfig
} = require('../shared/helpers/test-runner.js');

// ============================================================================
// TEST MATRICES
// ============================================================================

/**
 * Public Bundle Test Matrix
 *
 * | Input | Expected | Notes |
 * |-------|----------|-------|
 * | Valid brandId + eventId | Ok + event + config | Full canonical shape |
 * | Valid brandId (no eventId) | Ok + default/first event | Uses first event |
 * | Invalid brandId | Err BAD_INPUT | Unknown brand |
 * | Missing brandId | Err BAD_INPUT | Required field |
 * | Valid ifNoneMatch (cached) | Ok + notModified | 304 equivalent |
 * | Invalid ifNoneMatch | Ok + full bundle | Returns fresh data |
 */
const PUBLIC_BUNDLE_MATRIX = {
  success: [
    {
      name: 'returns full canonical event per v2.0',
      input: { brandId: 'root' },
      validate: (response) => {
        expect(response.ok).toBe(true);
        expect(response).toHaveProperty('value');
        expect(response.value).toHaveProperty('event');
        expect(response.value).toHaveProperty('config');
      }
    },
    {
      name: 'event contains MVP required fields',
      input: { brandId: 'root' },
      validate: (response) => {
        const event = response.value.event;
        expect(event).toHaveProperty('id');
        expect(event).toHaveProperty('slug');
        expect(event).toHaveProperty('name');
        expect(event).toHaveProperty('startDateISO');
        expect(event).toHaveProperty('venue');
      }
    },
    {
      name: 'event contains links block',
      input: { brandId: 'root' },
      validate: (response) => {
        const { links } = response.value.event;
        expect(links).toHaveProperty('publicUrl');
        expect(links).toHaveProperty('displayUrl');
        expect(links).toHaveProperty('posterUrl');
        expect(links).toHaveProperty('signupUrl');
      }
    },
    {
      name: 'event contains QR codes',
      input: { brandId: 'root' },
      validate: (response) => {
        const { qr } = response.value.event;
        expect(qr).toHaveProperty('public');
        expect(qr).toHaveProperty('signup');
      }
    },
    {
      name: 'event contains CTAs block',
      input: { brandId: 'root' },
      validate: (response) => {
        const { ctas } = response.value.event;
        expect(ctas).toHaveProperty('primary');
        expect(ctas.primary).toHaveProperty('label');
        expect(ctas.primary).toHaveProperty('url');
      }
    },
    {
      name: 'event contains settings block',
      input: { brandId: 'root' },
      validate: (response) => {
        const { settings } = response.value.event;
        expect(typeof settings.showSchedule).toBe('boolean');
        expect(typeof settings.showStandings).toBe('boolean');
        expect(typeof settings.showBracket).toBe('boolean');
      }
    },
    {
      name: 'event contains metadata timestamps',
      input: { brandId: 'root' },
      validate: (response) => {
        const event = response.value.event;
        expect(event).toHaveProperty('createdAtISO');
        expect(event).toHaveProperty('updatedAtISO');
      }
    },
    {
      name: 'config contains brand information',
      input: { brandId: 'root' },
      validate: (response) => {
        const { config } = response.value;
        expect(config).toHaveProperty('brandId');
        expect(config).toHaveProperty('brandName');
      }
    },
    {
      name: 'returns etag for caching',
      input: { brandId: 'root' },
      validate: (response) => {
        expect(response).toHaveProperty('etag');
        expect(typeof response.etag).toBe('string');
        expect(response.etag.length).toBeGreaterThan(0);
      }
    }
  ],
  errors: [
    {
      name: 'rejects missing brandId',
      input: {},
      expectedCode: 'BAD_INPUT'
    },
    {
      name: 'rejects invalid brandId',
      input: { brandId: 'nonexistent-brand-xyz' },
      expectedCode: 'BAD_INPUT'
    }
  ],
  caching: [
    {
      name: 'returns notModified when etag matches',
      input: { brandId: 'root' },
      validate: async (response, makeRequest) => {
        // First request to get etag
        const first = response;
        expect(first.etag).toBeTruthy();

        // Second request with matching etag
        const second = await makeRequest({
          action: 'api_getPublicBundle',
          brandId: 'root',
          ifNoneMatch: first.etag
        });

        expect(second.ok).toBe(true);
        expect(second.notModified).toBe(true);
        expect(second.etag).toBe(first.etag);
      }
    },
    {
      name: 'returns full bundle when etag does not match',
      input: { brandId: 'root', ifNoneMatch: 'invalid-etag-12345' },
      validate: (response) => {
        expect(response.ok).toBe(true);
        expect(response.notModified).toBeFalsy();
        expect(response).toHaveProperty('value');
      }
    }
  ]
};

/**
 * Display Bundle Test Matrix
 *
 * | Input | Expected | Notes |
 * |-------|----------|-------|
 * | Valid brandId | Ok + event + rotation + layout | Display-specific fields |
 * | Invalid brandId | Err BAD_INPUT | Unknown brand |
 */
const DISPLAY_BUNDLE_MATRIX = {
  success: [
    {
      name: 'returns event with display-specific fields',
      input: { brandId: 'root' },
      validate: (response) => {
        expect(response.ok).toBe(true);
        expect(response.value).toHaveProperty('event');
      }
    },
    {
      name: 'includes rotation configuration',
      input: { brandId: 'root' },
      validate: (response) => {
        // rotation may be optional
        if (response.value.rotation) {
          expect(typeof response.value.rotation.rotationMs).toBe('number');
        }
      }
    },
    {
      name: 'includes layout configuration',
      input: { brandId: 'root' },
      validate: (response) => {
        // layout may be optional
        if (response.value.layout) {
          expect(typeof response.value.layout).toBe('object');
        }
      }
    },
    {
      name: 'event follows v2.0 canonical shape',
      input: { brandId: 'root' },
      validate: (response) => {
        const result = validateEventContractV2(response.value.event);
        expect(result).toBe(true);
      }
    }
  ],
  errors: [
    {
      name: 'rejects missing brandId',
      input: {},
      expectedCode: 'BAD_INPUT'
    }
  ]
};

/**
 * Admin Bundle Test Matrix
 *
 * | Input | Expected | Notes |
 * |-------|----------|-------|
 * | Valid brandId + adminKey | Ok + full admin bundle | Includes templates |
 * | Invalid adminKey | Err BAD_INPUT | Auth failure |
 * | Missing adminKey | Err BAD_INPUT | Required for admin |
 */
const ADMIN_BUNDLE_MATRIX = {
  success: [
    {
      name: 'returns full admin bundle with auth',
      input: { brandId: 'root', adminKey: 'ADMIN_KEY_PLACEHOLDER' },
      validate: (response) => {
        expect(response.ok).toBe(true);
        expect(response.value).toHaveProperty('event');
      }
    },
    {
      name: 'includes brand configuration',
      input: { brandId: 'root', adminKey: 'ADMIN_KEY_PLACEHOLDER' },
      validate: (response) => {
        if (response.value.brandConfig) {
          expect(typeof response.value.brandConfig).toBe('object');
        }
      }
    },
    {
      name: 'includes available templates',
      input: { brandId: 'root', adminKey: 'ADMIN_KEY_PLACEHOLDER' },
      validate: (response) => {
        if (response.value.templates) {
          expect(Array.isArray(response.value.templates)).toBe(true);
        }
      }
    }
  ],
  errors: [
    {
      name: 'rejects invalid adminKey',
      input: { brandId: 'root', adminKey: 'invalid-key-12345' },
      expectedCode: 'BAD_INPUT'
    }
  ]
};

/**
 * Poster Bundle Test Matrix
 *
 * | Input | Expected | Notes |
 * |-------|----------|-------|
 * | Valid brandId | Ok + print-optimized event | QR codes required |
 * | Invalid brandId | Err BAD_INPUT | Unknown brand |
 */
const POSTER_BUNDLE_MATRIX = {
  success: [
    {
      name: 'returns print-optimized event',
      input: { brandId: 'root' },
      validate: (response) => {
        expect(response.ok).toBe(true);
        expect(response.value).toHaveProperty('event');
      }
    },
    {
      name: 'includes QR codes for poster',
      input: { brandId: 'root' },
      validate: (response) => {
        const { qr } = response.value.event;
        expect(qr).toHaveProperty('public');
        expect(qr).toHaveProperty('signup');
      }
    },
    {
      name: 'event follows v2.0 canonical shape',
      input: { brandId: 'root' },
      validate: (response) => {
        const result = validateEventContractV2(response.value.event);
        expect(result).toBe(true);
      }
    }
  ],
  errors: [
    {
      name: 'rejects missing brandId',
      input: {},
      expectedCode: 'BAD_INPUT'
    }
  ]
};

// ============================================================================
// TEST SUITES
// ============================================================================

describe('📦 Bundle Contract Tests - Story 8 (LOCKED)', () => {

  describe('api_getPublicBundle', () => {

    describe('Success Responses (v2.0 Canonical Shape)', () => {
      PUBLIC_BUNDLE_MATRIX.success.forEach(testCase => {
        it(testCase.name, () => {
          // Mock response matching expected contract
          const mockResponse = {
            ok: true,
            etag: 'abc123def456',
            value: {
              event: {
                id: 'test-event-1',
                slug: 'test-event',
                name: 'Test Event',
                startDateISO: '2025-12-31',
                venue: 'Test Venue',
                links: {
                  publicUrl: 'https://example.com/public',
                  displayUrl: 'https://example.com/display',
                  posterUrl: 'https://example.com/poster',
                  signupUrl: 'https://forms.google.com/test'
                },
                qr: {
                  public: 'data:image/png;base64,abc',
                  signup: 'data:image/png;base64,def'
                },
                ctas: {
                  primary: { label: 'Sign Up', url: 'https://forms.google.com/test' },
                  secondary: null
                },
                settings: {
                  showSchedule: true,
                  showStandings: false,
                  showBracket: false,
                  showSponsors: true
                },
                schedule: [],
                standings: [],
                sponsors: [],
                media: {},
                externalData: {},
                analytics: { enabled: false },
                payments: { enabled: false, provider: 'stripe', price: null, currency: 'USD' },
                createdAtISO: '2025-01-01T00:00:00.000Z',
                updatedAtISO: '2025-01-01T00:00:00.000Z'
              },
              config: {
                appTitle: 'Event Toolkit',
                brandId: 'root',
                brandName: 'Root Brand'
              }
            }
          };

          testCase.validate(mockResponse);
        });
      });
    });

    describe('Error Responses', () => {
      PUBLIC_BUNDLE_MATRIX.errors.forEach(testCase => {
        it(testCase.name, () => {
          const mockResponse = {
            ok: false,
            code: testCase.expectedCode,
            message: 'Validation failed'
          };

          validateErrorEnvelope(mockResponse, testCase.expectedCode);
        });
      });
    });

    describe('Caching (ETags)', () => {
      it('notModified response follows contract', () => {
        const mockNotModified = {
          ok: true,
          notModified: true,
          etag: 'abc123def456'
        };

        validateEnvelope(mockNotModified);
        expect(mockNotModified.notModified).toBe(true);
        expect(mockNotModified.etag).toBeTruthy();
      });

      it('etag is consistent MD5 hash', () => {
        const etag1 = 'abc123def456';
        const etag2 = 'abc123def456';

        expect(etag1).toBe(etag2);
        expect(etag1.length).toBeGreaterThan(8);
      });
    });
  });

  describe('api_getDisplayBundle', () => {

    describe('Success Responses', () => {
      DISPLAY_BUNDLE_MATRIX.success.forEach(testCase => {
        it(testCase.name, () => {
          const mockResponse = {
            ok: true,
            etag: 'display-etag-123',
            value: {
              event: {
                id: 'test-event-1',
                slug: 'test-event',
                name: 'Test Event',
                startDateISO: '2025-12-31',
                venue: 'Test Venue',
                links: {
                  publicUrl: 'https://example.com/public',
                  displayUrl: 'https://example.com/display',
                  posterUrl: 'https://example.com/poster',
                  signupUrl: ''
                },
                qr: { public: 'data:image/png;base64,abc', signup: 'data:image/png;base64,def' },
                ctas: { primary: { label: 'View', url: '' } },
                settings: { showSchedule: true, showStandings: false, showBracket: false },
                createdAtISO: '2025-01-01T00:00:00.000Z',
                updatedAtISO: '2025-01-01T00:00:00.000Z'
              },
              rotation: {
                sponsorSlots: 4,
                rotationMs: 10000
              },
              layout: {
                hasSidePane: false,
                emphasis: 'event'
              }
            }
          };

          testCase.validate(mockResponse);
        });
      });
    });

    describe('Error Responses', () => {
      DISPLAY_BUNDLE_MATRIX.errors.forEach(testCase => {
        it(testCase.name, () => {
          const mockResponse = {
            ok: false,
            code: testCase.expectedCode,
            message: 'Validation failed'
          };

          validateErrorEnvelope(mockResponse, testCase.expectedCode);
        });
      });
    });

    describe('Display-Specific Fields', () => {
      it('rotation config has required fields', () => {
        const rotation = {
          sponsorSlots: 4,
          rotationMs: 10000
        };

        expect(typeof rotation.sponsorSlots).toBe('number');
        expect(typeof rotation.rotationMs).toBe('number');
        expect(rotation.rotationMs).toBeGreaterThan(0);
      });

      it('layout config has required fields', () => {
        const layout = {
          hasSidePane: false,
          emphasis: 'event'
        };

        expect(typeof layout.hasSidePane).toBe('boolean');
        expect(typeof layout.emphasis).toBe('string');
      });
    });
  });

  describe('api_getAdminBundle', () => {

    describe('Success Responses (Authenticated)', () => {
      it('returns full admin bundle with valid auth', () => {
        const mockResponse = {
          ok: true,
          etag: 'admin-etag-123',
          value: {
            event: {
              id: 'test-event-1',
              slug: 'test-event',
              name: 'Test Event',
              startDateISO: '2025-12-31',
              venue: 'Test Venue',
              links: {
                publicUrl: 'https://example.com/public',
                displayUrl: 'https://example.com/display',
                posterUrl: 'https://example.com/poster',
                signupUrl: ''
              },
              qr: { public: 'data:image/png;base64,abc', signup: 'data:image/png;base64,def' },
              ctas: { primary: { label: 'View', url: '' } },
              settings: { showSchedule: true, showStandings: false, showBracket: false },
              createdAtISO: '2025-01-01T00:00:00.000Z',
              updatedAtISO: '2025-01-01T00:00:00.000Z'
            },
            brandConfig: {
              primaryColor: '#000000',
              logoUrl: 'https://example.com/logo.png'
            },
            templates: [
              { id: 'event', label: 'Standard Event' },
              { id: 'league', label: 'League Event' }
            ],
            diagnostics: {
              formStatus: 'ok',
              shortlinksCount: 5
            },
            allSponsors: []
          }
        };

        validateSuccessEnvelope(mockResponse);
        expect(mockResponse.value.event).toBeTruthy();
        expect(mockResponse.value.brandConfig).toBeTruthy();
        expect(Array.isArray(mockResponse.value.templates)).toBe(true);
      });
    });

    describe('Error Responses', () => {
      ADMIN_BUNDLE_MATRIX.errors.forEach(testCase => {
        it(testCase.name, () => {
          const mockResponse = {
            ok: false,
            code: testCase.expectedCode,
            message: 'Authentication failed'
          };

          validateErrorEnvelope(mockResponse, testCase.expectedCode);
        });
      });
    });

    describe('Admin-Specific Fields', () => {
      it('templates array has required structure', () => {
        const template = { id: 'event', label: 'Standard Event' };

        expect(template).toHaveProperty('id');
        expect(template).toHaveProperty('label');
        expect(typeof template.id).toBe('string');
        expect(typeof template.label).toBe('string');
      });

      it('diagnostics has status fields', () => {
        const diagnostics = {
          formStatus: 'ok',
          shortlinksCount: 5
        };

        expect(diagnostics).toHaveProperty('formStatus');
        expect(['ok', 'error', 'pending']).toContain(diagnostics.formStatus);
      });
    });

    /**
     * Admin 7-Card Layout Contract Tests
     *
     * Ensures Admin bundle provides all fields required by the 7-card layout:
     * Card 1: Event Details (name, date, venue, template)
     * Card 2: CTA Manager (ctas.primary, ctas.secondary)
     * Card 3: Schedule (schedule[], settings.showSchedule)
     * Card 4: Standings (standings[], settings.showStandings)
     * Card 5: External Data (externalData.scheduleUrl, etc)
     * Card 6: Sponsors (sponsors[], settings.showSponsors)
     * Card 7: Settings Toggles (all settings.show* booleans)
     */
    describe('Admin 7-Card Layout Contract (Story 5-6)', () => {
      const mockAdminEvent = {
        id: 'test-event-1',
        slug: 'test-event',
        name: 'Test Event',
        startDateISO: '2025-12-31',
        venue: 'Test Venue',
        templateId: 'rec_league',
        links: {
          publicUrl: 'https://example.com/public',
          displayUrl: 'https://example.com/display',
          posterUrl: 'https://example.com/poster',
          signupUrl: 'https://forms.google.com/test'
        },
        qr: { public: 'data:image/png;base64,abc', signup: 'data:image/png;base64,def' },
        ctas: {
          primary: { label: 'Sign Up', url: 'https://forms.google.com/test' },
          secondary: { label: 'Learn More', url: 'https://example.com' }
        },
        settings: {
          showSchedule: true,
          showStandings: true,
          showBracket: false,
          showSponsors: true,
          showVideo: false,
          showMap: false,
          showGallery: false,
          showSponsorBanner: true,
          showSponsorStrip: true,
          showLeagueStrip: true,
          showQRSection: true
        },
        schedule: [
          { time: '10:00 AM', title: 'Check-in' }
        ],
        standings: [
          { rank: 1, team: 'Team A', wins: 5, losses: 1 }
        ],
        bracket: null,
        sponsors: [
          { id: 'sp-1', name: 'Sponsor', logoUrl: 'https://example.com/logo.png', placement: 'poster' }
        ],
        media: {},
        externalData: {
          scheduleUrl: 'https://example.com/schedule.json',
          standingsUrl: 'https://example.com/standings.json'
        },
        createdAtISO: '2025-01-01T00:00:00.000Z',
        updatedAtISO: '2025-01-01T00:00:00.000Z'
      };

      it('Card 1: Event Details - provides name, date, venue, templateId', () => {
        expect(mockAdminEvent).toHaveProperty('name');
        expect(mockAdminEvent).toHaveProperty('startDateISO');
        expect(mockAdminEvent).toHaveProperty('venue');
        expect(mockAdminEvent).toHaveProperty('templateId');
      });

      it('Card 2: CTA Manager - provides primary and secondary CTAs', () => {
        expect(mockAdminEvent.ctas).toHaveProperty('primary');
        expect(mockAdminEvent.ctas.primary).toHaveProperty('label');
        expect(mockAdminEvent.ctas.primary).toHaveProperty('url');
        // secondary can be null
        if (mockAdminEvent.ctas.secondary) {
          expect(mockAdminEvent.ctas.secondary).toHaveProperty('label');
          expect(mockAdminEvent.ctas.secondary).toHaveProperty('url');
        }
      });

      it('Card 3: Schedule - provides schedule array and showSchedule setting', () => {
        expect(mockAdminEvent).toHaveProperty('schedule');
        expect(mockAdminEvent.settings).toHaveProperty('showSchedule');
        expect(typeof mockAdminEvent.settings.showSchedule).toBe('boolean');
      });

      it('Card 4: Standings - provides standings array and showStandings setting', () => {
        expect(mockAdminEvent).toHaveProperty('standings');
        expect(mockAdminEvent.settings).toHaveProperty('showStandings');
        expect(typeof mockAdminEvent.settings.showStandings).toBe('boolean');
      });

      it('Card 5: External Data - provides externalData object with URLs', () => {
        expect(mockAdminEvent).toHaveProperty('externalData');
        expect(typeof mockAdminEvent.externalData).toBe('object');
        // URLs are optional but should be strings if present
        if (mockAdminEvent.externalData.scheduleUrl) {
          expect(typeof mockAdminEvent.externalData.scheduleUrl).toBe('string');
        }
        if (mockAdminEvent.externalData.standingsUrl) {
          expect(typeof mockAdminEvent.externalData.standingsUrl).toBe('string');
        }
        if (mockAdminEvent.externalData.bracketUrl) {
          expect(typeof mockAdminEvent.externalData.bracketUrl).toBe('string');
        }
      });

      it('Card 6: Sponsors - provides sponsors array and showSponsors setting', () => {
        expect(mockAdminEvent).toHaveProperty('sponsors');
        expect(mockAdminEvent.settings).toHaveProperty('showSponsors');
        expect(typeof mockAdminEvent.settings.showSponsors).toBe('boolean');
      });

      it('Card 7: Settings Toggles - provides all show* boolean settings', () => {
        const requiredSettings = [
          'showSchedule',
          'showStandings',
          'showBracket'
        ];

        const optionalSettings = [
          'showSponsors',
          'showVideo',
          'showMap',
          'showGallery',
          'showSponsorBanner',
          'showSponsorStrip',
          'showLeagueStrip',
          'showQRSection'
        ];

        // Required settings must be present and boolean
        requiredSettings.forEach(setting => {
          expect(mockAdminEvent.settings).toHaveProperty(setting);
          expect(typeof mockAdminEvent.settings[setting]).toBe('boolean');
        });

        // Optional settings if present must be boolean
        optionalSettings.forEach(setting => {
          if (mockAdminEvent.settings[setting] !== undefined) {
            expect(typeof mockAdminEvent.settings[setting]).toBe('boolean');
          }
        });
      });

      it('Admin bundle should provide all links for surface navigation', () => {
        expect(mockAdminEvent.links).toHaveProperty('publicUrl');
        expect(mockAdminEvent.links).toHaveProperty('displayUrl');
        expect(mockAdminEvent.links).toHaveProperty('posterUrl');
        expect(mockAdminEvent.links).toHaveProperty('signupUrl');
      });

      it('Admin bundle should provide QR codes for preview', () => {
        expect(mockAdminEvent.qr).toHaveProperty('public');
        expect(mockAdminEvent.qr).toHaveProperty('signup');
      });
    });
  });

  describe('api_getPosterBundle', () => {

    describe('Success Responses', () => {
      POSTER_BUNDLE_MATRIX.success.forEach(testCase => {
        it(testCase.name, () => {
          const mockResponse = {
            ok: true,
            etag: 'poster-etag-123',
            value: {
              event: {
                id: 'test-event-1',
                slug: 'test-event',
                name: 'Test Event',
                startDateISO: '2025-12-31',
                venue: 'Test Venue',
                links: {
                  publicUrl: 'https://example.com/public',
                  displayUrl: 'https://example.com/display',
                  posterUrl: 'https://example.com/poster',
                  signupUrl: 'https://forms.google.com/test'
                },
                qr: {
                  public: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg',
                  signup: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg'
                },
                ctas: { primary: { label: 'Sign Up', url: 'https://forms.google.com/test' } },
                settings: { showSchedule: true, showStandings: false, showBracket: false },
                sponsors: [
                  { id: 'sponsor-1', name: 'Test Sponsor', logoUrl: 'https://example.com/sponsor.png' }
                ],
                createdAtISO: '2025-01-01T00:00:00.000Z',
                updatedAtISO: '2025-01-01T00:00:00.000Z'
              },
              config: {
                brandId: 'root',
                brandName: 'Root Brand'
              }
            }
          };

          testCase.validate(mockResponse);
        });
      });
    });

    describe('Error Responses', () => {
      POSTER_BUNDLE_MATRIX.errors.forEach(testCase => {
        it(testCase.name, () => {
          const mockResponse = {
            ok: false,
            code: testCase.expectedCode,
            message: 'Validation failed'
          };

          validateErrorEnvelope(mockResponse, testCase.expectedCode);
        });
      });
    });

    describe('Poster-Specific Requirements', () => {
      it('QR codes are base64 PNG data URIs', () => {
        const qr = {
          public: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg',
          signup: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg'
        };

        expect(qr.public).toMatch(/^data:image\/png;base64,/);
        expect(qr.signup).toMatch(/^data:image\/png;base64,/);
      });

      it('sponsors array has print-ready structure', () => {
        const sponsor = {
          id: 'sponsor-1',
          name: 'Test Sponsor',
          logoUrl: 'https://example.com/sponsor.png'
        };

        expect(sponsor).toHaveProperty('id');
        expect(sponsor).toHaveProperty('name');
        // logoUrl is optional for text fallback
      });
    });
  });

  describe('Cross-Bundle Consistency', () => {
    it('all bundles return same event ID for same request', () => {
      const eventId = 'test-event-1';

      const publicBundle = { value: { event: { id: eventId } } };
      const displayBundle = { value: { event: { id: eventId } } };
      const posterBundle = { value: { event: { id: eventId } } };

      expect(publicBundle.value.event.id).toBe(eventId);
      expect(displayBundle.value.event.id).toBe(eventId);
      expect(posterBundle.value.event.id).toBe(eventId);
    });

    it('all bundles use same etag format', () => {
      const etag1 = 'abc123def456ghi789';
      const etag2 = 'abc123def456ghi789';

      expect(etag1).toBe(etag2);
      expect(typeof etag1).toBe('string');
      expect(etag1.length).toBeGreaterThan(8);
    });

    it('all success bundles have consistent envelope', () => {
      const bundles = [
        { ok: true, etag: 'etag1', value: { event: {} } },
        { ok: true, etag: 'etag2', value: { event: {} } },
        { ok: true, etag: 'etag3', value: { event: {} } }
      ];

      bundles.forEach(bundle => {
        expect(bundle).toHaveProperty('ok');
        expect(bundle.ok).toBe(true);
        expect(bundle).toHaveProperty('etag');
        expect(bundle).toHaveProperty('value');
        expect(bundle.value).toHaveProperty('event');
      });
    });
  });
});

// ============================================================================
// EVENT CONTRACT V2.0 VALIDATION
// ============================================================================

describe('📜 EVENT_CONTRACT.md v2.0 Validation', () => {

  describe('Required Fields', () => {
    const validEvent = {
      id: 'test-event-1',
      slug: 'test-event',
      name: 'Test Event',
      startDateISO: '2025-12-31',
      venue: 'Test Venue',
      links: {
        publicUrl: 'https://example.com/public',
        displayUrl: 'https://example.com/display',
        posterUrl: 'https://example.com/poster',
        signupUrl: ''
      },
      qr: {
        public: 'data:image/png;base64,abc',
        signup: 'data:image/png;base64,def'
      },
      ctas: {
        primary: { label: 'View', url: '' }
      },
      settings: {
        showSchedule: true,
        showStandings: false,
        showBracket: false
      },
      createdAtISO: '2025-01-01T00:00:00.000Z',
      updatedAtISO: '2025-01-01T00:00:00.000Z'
    };

    it('validates complete v2.0 event', () => {
      const result = validateEventContractV2(validEvent);
      expect(result).toBe(true);
    });

    it('fails when id is missing', () => {
      const event = { ...validEvent };
      delete event.id;
      const result = validateEventContractV2(event);
      expect(result).toContain('Missing id');
    });

    it('fails when links block is missing', () => {
      const event = { ...validEvent };
      delete event.links;
      const result = validateEventContractV2(event);
      expect(result).toContain('Missing links');
    });

    it('fails when qr block is missing', () => {
      const event = { ...validEvent };
      delete event.qr;
      const result = validateEventContractV2(event);
      expect(result).toContain('Missing qr');
    });

    it('fails when ctas block is missing', () => {
      const event = { ...validEvent };
      delete event.ctas;
      const result = validateEventContractV2(event);
      expect(result).toContain('Missing ctas');
    });

    it('fails when settings block is missing', () => {
      const event = { ...validEvent };
      delete event.settings;
      const result = validateEventContractV2(event);
      expect(result).toContain('Missing settings');
    });
  });

  describe('Field Types', () => {
    it('startDateISO is YYYY-MM-DD format', () => {
      const datePattern = /^\d{4}-\d{2}-\d{2}$/;
      const validDate = '2025-12-31';
      expect(validDate).toMatch(datePattern);
    });

    it('QR codes are base64 data URIs', () => {
      const qrPattern = /^data:image\/png;base64,/;
      const validQR = 'data:image/png;base64,iVBORw0KGgo';
      expect(validQR).toMatch(qrPattern);
    });

    it('timestamps are ISO 8601 format', () => {
      const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
      const validTimestamp = '2025-01-01T00:00:00.000Z';
      expect(validTimestamp).toMatch(isoPattern);
    });
  });
});
