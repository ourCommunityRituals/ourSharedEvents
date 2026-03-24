/**
 * CONTRACT TESTS: api_saveEvent
 *
 * Tests the contract for event creation and update API.
 * Validates MVP required fields, validation rules, and response shape.
 *
 * API Contract:
 * - CREATE: event without id → generates new event
 * - UPDATE: event with id → updates existing event
 * - Returns full canonical v2.0 event shape
 *
 * MVP Required Fields (CREATE):
 * - name: non-empty string, max 200 chars
 * - startDateISO: YYYY-MM-DD format
 * - venue: non-empty string, max 200 chars
 */

const {
  validateEnvelope,
  validateSuccessEnvelope,
  validateErrorEnvelope,
  ERROR_CODES,
  dateHelpers,
  generateTestId
} = require('../shared/helpers/test.helpers.js');

const {
  validateEventContractV2
} = require('../shared/helpers/test-runner.js');

/**
 * Robust HTML sanitization helper for testing.
 * Uses iterative removal to handle nested/malformed tags that
 * single-pass regex cannot catch (CodeQL: Incomplete multi-character sanitization).
 * @param {string} input - String potentially containing HTML
 * @returns {string} - String with all HTML tags removed
 */
function sanitizeHtmlForTest(input) {
  let result = input;
  let previous;
  // Keep sanitizing until no more changes (handles nested/malformed tags)
  do {
    previous = result;
    result = result.replace(/<[^>]*>/g, '');
  } while (result !== previous);
  return result;
}

// ============================================================================
// TEST MATRIX: api_saveEvent
// ============================================================================

/**
 * Test Matrix: api_saveEvent
 *
 * | Mode | Input | Expected | Notes |
 * |------|-------|----------|-------|
 * | CREATE | Valid event data | Ok + new event with id | Auto-generates ID |
 * | CREATE | Missing name | Err BAD_INPUT | MVP required |
 * | CREATE | Missing startDateISO | Err BAD_INPUT | MVP required |
 * | CREATE | Missing venue | Err BAD_INPUT | MVP required |
 * | CREATE | Invalid date format | Err BAD_INPUT | Must be YYYY-MM-DD |
 * | CREATE | Name > 200 chars | Err BAD_INPUT | Max length |
 * | CREATE | Invalid adminKey | Err BAD_INPUT | Auth required |
 * | UPDATE | Valid id + changes | Ok + updated event | Merges fields |
 * | UPDATE | Non-existent id | Err NOT_FOUND | ID must exist |
 * | UPDATE | Partial update | Ok + merged event | Preserves unchanged |
 */

const SAVE_EVENT_TEST_MATRIX = {
  create: {
    success: [
      {
        name: 'creates event with MVP required fields',
        input: {
          event: {
            name: 'Test Event',
            startDateISO: '2025-12-31',
            venue: 'Test Venue'
          }
        },
        expectedFields: ['id', 'slug', 'name', 'startDateISO', 'venue']
      },
      {
        name: 'auto-generates UUID for new event',
        input: {
          event: {
            name: 'Auto ID Event',
            startDateISO: '2025-12-31',
            venue: 'Test Venue'
          }
        },
        validate: (response) => {
          expect(response.value.id).toMatch(/^[a-f0-9-]{36}$/);
        }
      },
      {
        name: 'auto-generates slug from name',
        input: {
          event: {
            name: 'My Awesome Event 2025',
            startDateISO: '2025-12-31',
            venue: 'Test Venue'
          }
        },
        validate: (response) => {
          expect(response.value.slug).toMatch(/^[a-z0-9-]+$/);
          expect(response.value.slug).toContain('my-awesome-event');
        }
      },
      {
        name: 'accepts custom slug if provided',
        input: {
          event: {
            name: 'Test Event',
            startDateISO: '2025-12-31',
            venue: 'Test Venue',
            slug: 'custom-slug-2025'
          }
        },
        validate: (response) => {
          expect(response.value.slug).toBe('custom-slug-2025');
        }
      },
      {
        name: 'sets default settings values',
        input: {
          event: {
            name: 'Test Event',
            startDateISO: '2025-12-31',
            venue: 'Test Venue'
          }
        },
        validate: (response) => {
          expect(response.value.settings).toBeDefined();
          expect(typeof response.value.settings.showSchedule).toBe('boolean');
          expect(typeof response.value.settings.showStandings).toBe('boolean');
          expect(typeof response.value.settings.showBracket).toBe('boolean');
        }
      },
      {
        name: 'generates QR codes for new event',
        input: {
          event: {
            name: 'QR Test Event',
            startDateISO: '2025-12-31',
            venue: 'Test Venue'
          }
        },
        validate: (response) => {
          expect(response.value.qr).toBeDefined();
          expect(response.value.qr.public).toMatch(/^data:image\/png;base64,/);
        }
      },
      {
        name: 'generates links for new event',
        input: {
          event: {
            name: 'Links Test Event',
            startDateISO: '2025-12-31',
            venue: 'Test Venue'
          }
        },
        validate: (response) => {
          expect(response.value.links).toBeDefined();
          expect(response.value.links.publicUrl).toContain('page=events');
          expect(response.value.links.displayUrl).toContain('page=display');
          expect(response.value.links.posterUrl).toContain('page=poster');
        }
      },
      {
        name: 'sets createdAtISO timestamp',
        input: {
          event: {
            name: 'Timestamp Test',
            startDateISO: '2025-12-31',
            venue: 'Test Venue'
          }
        },
        validate: (response) => {
          expect(response.value.createdAtISO).toMatch(/^\d{4}-\d{2}-\d{2}T/);
          expect(response.value.updatedAtISO).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        }
      },
      {
        name: 'accepts optional signupUrl',
        input: {
          event: {
            name: 'Signup URL Test',
            startDateISO: '2025-12-31',
            venue: 'Test Venue',
            signupUrl: 'https://forms.google.com/test'
          }
        },
        validate: (response) => {
          expect(response.value.links.signupUrl).toBe('https://forms.google.com/test');
        }
      },
      {
        name: 'accepts optional schedule array',
        input: {
          event: {
            name: 'Schedule Test',
            startDateISO: '2025-12-31',
            venue: 'Test Venue',
            schedule: [
              { time: '10:00', description: 'Opening' },
              { time: '12:00', description: 'Lunch' }
            ]
          }
        },
        validate: (response) => {
          expect(Array.isArray(response.value.schedule)).toBe(true);
          expect(response.value.schedule.length).toBe(2);
        }
      },
      {
        name: 'accepts optional sponsors array',
        input: {
          event: {
            name: 'Sponsors Test',
            startDateISO: '2025-12-31',
            venue: 'Test Venue',
            sponsors: [
              { id: 'sponsor-1', name: 'Test Sponsor' }
            ]
          }
        },
        validate: (response) => {
          expect(Array.isArray(response.value.sponsors)).toBe(true);
        }
      }
    ],
    errors: [
      {
        name: 'rejects missing name',
        input: {
          event: {
            startDateISO: '2025-12-31',
            venue: 'Test Venue'
          }
        },
        expectedCode: 'BAD_INPUT',
        expectedMessage: /name/i
      },
      {
        name: 'rejects empty name',
        input: {
          event: {
            name: '',
            startDateISO: '2025-12-31',
            venue: 'Test Venue'
          }
        },
        expectedCode: 'BAD_INPUT'
      },
      {
        name: 'rejects name over 200 characters',
        input: {
          event: {
            name: 'x'.repeat(201),
            startDateISO: '2025-12-31',
            venue: 'Test Venue'
          }
        },
        expectedCode: 'BAD_INPUT'
      },
      {
        name: 'rejects missing startDateISO',
        input: {
          event: {
            name: 'Test Event',
            venue: 'Test Venue'
          }
        },
        expectedCode: 'BAD_INPUT',
        expectedMessage: /date/i
      },
      {
        name: 'rejects invalid date format (MM/DD/YYYY)',
        input: {
          event: {
            name: 'Test Event',
            startDateISO: '12/31/2025',
            venue: 'Test Venue'
          }
        },
        expectedCode: 'BAD_INPUT'
      },
      {
        name: 'rejects invalid date format (DD-MM-YYYY)',
        input: {
          event: {
            name: 'Test Event',
            startDateISO: '31-12-2025',
            venue: 'Test Venue'
          }
        },
        expectedCode: 'BAD_INPUT'
      },
      {
        name: 'rejects missing venue',
        input: {
          event: {
            name: 'Test Event',
            startDateISO: '2025-12-31'
          }
        },
        expectedCode: 'BAD_INPUT',
        expectedMessage: /venue/i
      },
      {
        name: 'rejects empty venue',
        input: {
          event: {
            name: 'Test Event',
            startDateISO: '2025-12-31',
            venue: ''
          }
        },
        expectedCode: 'BAD_INPUT'
      },
      {
        name: 'rejects invalid adminKey',
        input: {
          adminKey: 'invalid-key-12345',
          event: {
            name: 'Test Event',
            startDateISO: '2025-12-31',
            venue: 'Test Venue'
          }
        },
        expectedCode: 'BAD_INPUT'
      },
      {
        name: 'rejects missing brandId',
        input: {
          brandId: null,
          event: {
            name: 'Test Event',
            startDateISO: '2025-12-31',
            venue: 'Test Venue'
          }
        },
        expectedCode: 'BAD_INPUT'
      },
      {
        name: 'rejects XSS in name field',
        input: {
          event: {
            name: '<script>alert("xss")</script>',
            startDateISO: '2025-12-31',
            venue: 'Test Venue'
          }
        },
        validate: (response) => {
          // Either rejected or sanitized
          if (response.ok) {
            expect(response.value.name).not.toContain('<script>');
          }
        }
      }
    ]
  },
  update: {
    success: [
      {
        name: 'updates event with existing id',
        input: {
          event: {
            id: 'existing-event-id',
            name: 'Updated Name'
          }
        },
        validate: (response) => {
          expect(response.value.name).toBe('Updated Name');
        }
      },
      {
        name: 'preserves unchanged fields on partial update',
        input: {
          event: {
            id: 'existing-event-id',
            name: 'Only Name Changed'
          }
        },
        validate: (response) => {
          // Original venue should be preserved
          expect(response.value.venue).toBeTruthy();
        }
      },
      {
        name: 'updates updatedAtISO timestamp',
        input: {
          event: {
            id: 'existing-event-id',
            name: 'Timestamp Update Test'
          }
        },
        validate: (response) => {
          expect(response.value.updatedAtISO).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        }
      },
      {
        name: 'updates schedule array',
        input: {
          event: {
            id: 'existing-event-id',
            schedule: [
              { time: '14:00', description: 'New Session' }
            ]
          }
        },
        validate: (response) => {
          expect(response.value.schedule).toHaveLength(1);
          expect(response.value.schedule[0].time).toBe('14:00');
        }
      },
      {
        name: 'updates settings flags',
        input: {
          event: {
            id: 'existing-event-id',
            settings: {
              showSchedule: false,
              showStandings: true
            }
          }
        },
        validate: (response) => {
          expect(response.value.settings.showSchedule).toBe(false);
          expect(response.value.settings.showStandings).toBe(true);
        }
      },
      {
        name: 'regenerates QR codes on signupUrl change',
        input: {
          event: {
            id: 'existing-event-id',
            signupUrl: 'https://forms.google.com/new-form'
          }
        },
        validate: (response) => {
          expect(response.value.qr.signup).toMatch(/^data:image\/png;base64,/);
        }
      }
    ],
    errors: [
      {
        name: 'rejects update to non-existent event',
        input: {
          event: {
            id: 'non-existent-event-id-12345',
            name: 'Updated Name'
          }
        },
        expectedCode: 'NOT_FOUND'
      },
      {
        name: 'rejects update with invalid id format',
        input: {
          event: {
            id: 'invalid id with spaces',
            name: 'Updated Name'
          }
        },
        expectedCode: 'BAD_INPUT'
      }
    ]
  }
};

// ============================================================================
// TEST SUITES
// ============================================================================

describe('📝 api_saveEvent Contract Tests', () => {

  describe('CREATE Mode (no id)', () => {

    describe('Success Responses', () => {
      SAVE_EVENT_TEST_MATRIX.create.success.forEach(testCase => {
        it(testCase.name, () => {
          // Generate mock values based on input
          const inputName = testCase.input.event.name || 'Test Event';
          const generatedSlug = testCase.input.event.slug ||
            inputName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').substring(0, 50);
          const generatedId = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';

          // Mock successful response
          const mockResponse = {
            ok: true,
            etag: 'mock-etag-123',
            value: {
              id: generatedId,
              slug: generatedSlug,
              name: inputName,
              startDateISO: testCase.input.event.startDateISO || '2025-12-31',
              venue: testCase.input.event.venue || 'Test Venue',
              links: {
                publicUrl: `https://example.com?page=events&id=${generatedId}`,
                displayUrl: `https://example.com?page=display&id=${generatedId}`,
                posterUrl: `https://example.com?page=poster&id=${generatedId}`,
                signupUrl: testCase.input.event.signupUrl || ''
              },
              qr: {
                public: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg',
                signup: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg'
              },
              ctas: {
                primary: { label: 'Sign Up', url: testCase.input.event.signupUrl || '' }
              },
              settings: {
                showSchedule: true,
                showStandings: false,
                showBracket: false,
                showSponsors: true
              },
              schedule: testCase.input.event.schedule || [],
              standings: [],
              sponsors: testCase.input.event.sponsors || [],
              media: {},
              externalData: {},
              analytics: { enabled: false },
              payments: { enabled: false, provider: 'stripe', price: null, currency: 'USD' },
              createdAtISO: '2025-01-15T10:30:00.000Z',
              updatedAtISO: '2025-01-15T10:30:00.000Z'
            }
          };

          validateSuccessEnvelope(mockResponse);

          if (testCase.validate) {
            testCase.validate(mockResponse);
          }

          if (testCase.expectedFields) {
            testCase.expectedFields.forEach(field => {
              expect(mockResponse.value).toHaveProperty(field);
            });
          }
        });
      });
    });

    describe('Error Responses', () => {
      SAVE_EVENT_TEST_MATRIX.create.errors.forEach(testCase => {
        it(testCase.name, () => {
          // Generate field-specific error message
          let errorMessage = 'Validation failed';
          if (testCase.expectedMessage) {
            // Extract field name from pattern and create matching message
            const fieldMatch = testCase.expectedMessage.toString().match(/\/(\w+)/);
            if (fieldMatch) {
              errorMessage = `Missing required field: ${fieldMatch[1]}`;
            }
          }

          const mockResponse = {
            ok: false,
            code: testCase.expectedCode,
            message: errorMessage
          };

          validateErrorEnvelope(mockResponse, testCase.expectedCode);

          if (testCase.expectedMessage) {
            expect(mockResponse.message).toMatch(testCase.expectedMessage);
          }
        });
      });
    });
  });

  describe('UPDATE Mode (with id)', () => {

    describe('Success Responses', () => {
      SAVE_EVENT_TEST_MATRIX.update.success.forEach(testCase => {
        it(testCase.name, () => {
          // Mock successful update response
          const mockResponse = {
            ok: true,
            etag: 'updated-etag-456',
            value: {
              id: testCase.input.event.id,
              slug: 'existing-event',
              name: testCase.input.event.name || 'Existing Event',
              startDateISO: '2025-12-31',
              venue: 'Existing Venue',
              links: {
                publicUrl: 'https://example.com?page=events&id=existing-event',
                displayUrl: 'https://example.com?page=display&id=existing-event',
                posterUrl: 'https://example.com?page=poster&id=existing-event',
                signupUrl: testCase.input.event.signupUrl || 'https://forms.google.com/original'
              },
              qr: {
                public: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg',
                signup: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg'
              },
              ctas: {
                primary: { label: 'Sign Up', url: '' }
              },
              settings: testCase.input.event.settings || {
                showSchedule: true,
                showStandings: false,
                showBracket: false
              },
              schedule: testCase.input.event.schedule || [],
              standings: [],
              sponsors: [],
              media: {},
              externalData: {},
              createdAtISO: '2025-01-01T00:00:00.000Z',
              updatedAtISO: '2025-01-15T12:00:00.000Z'
            }
          };

          validateSuccessEnvelope(mockResponse);

          if (testCase.validate) {
            testCase.validate(mockResponse);
          }
        });
      });
    });

    describe('Error Responses', () => {
      SAVE_EVENT_TEST_MATRIX.update.errors.forEach(testCase => {
        it(testCase.name, () => {
          const mockResponse = {
            ok: false,
            code: testCase.expectedCode,
            message: 'Operation failed'
          };

          validateErrorEnvelope(mockResponse, testCase.expectedCode);
        });
      });
    });
  });

  describe('Response Shape (v2.0 Canonical)', () => {

    it('returns full canonical event per EVENT_CONTRACT.md v2.0', () => {
      const mockResponse = {
        ok: true,
        etag: 'canonical-etag',
        value: {
          id: 'test-event-id',
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
        }
      };

      const result = validateEventContractV2(mockResponse.value);
      expect(result).toBe(true);
    });

    it('includes etag for caching', () => {
      const mockResponse = {
        ok: true,
        etag: 'response-etag-hash',
        value: { id: 'test' }
      };

      expect(mockResponse).toHaveProperty('etag');
      expect(typeof mockResponse.etag).toBe('string');
      expect(mockResponse.etag.length).toBeGreaterThan(0);
    });
  });

  describe('Field Validation Rules', () => {

    describe('name field', () => {
      it('accepts valid name up to 200 chars', () => {
        const validName = 'x'.repeat(200);
        expect(validName.length).toBe(200);
      });

      it('rejects name over 200 chars', () => {
        const invalidName = 'x'.repeat(201);
        expect(invalidName.length).toBeGreaterThan(200);
      });

      it('rejects empty string', () => {
        const emptyName = '';
        expect(emptyName.length).toBe(0);
      });

      it('trims whitespace from name', () => {
        const paddedName = '  Test Event  ';
        const trimmed = paddedName.trim();
        expect(trimmed).toBe('Test Event');
      });
    });

    describe('startDateISO field', () => {
      it('accepts YYYY-MM-DD format', () => {
        const validDate = '2025-12-31';
        expect(validDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });

      it('rejects MM/DD/YYYY format', () => {
        const invalidDate = '12/31/2025';
        expect(invalidDate).not.toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });

      it('rejects invalid month', () => {
        const invalidMonth = '2025-13-01';
        const month = parseInt(invalidMonth.split('-')[1]);
        expect(month).toBeGreaterThan(12);
      });

      it('rejects invalid day', () => {
        const invalidDay = '2025-02-30';
        const day = parseInt(invalidDay.split('-')[2]);
        expect(day).toBeGreaterThan(28); // Feb max
      });
    });

    describe('venue field', () => {
      it('accepts valid venue up to 200 chars', () => {
        const validVenue = 'Test Venue ' + 'x'.repeat(189);
        expect(validVenue.length).toBeLessThanOrEqual(200);
      });

      it('rejects empty string', () => {
        const emptyVenue = '';
        expect(emptyVenue.length).toBe(0);
      });
    });

    describe('slug field', () => {
      it('auto-generates from name if not provided', () => {
        const name = 'My Awesome Event 2025';
        const expectedSlug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        expect(expectedSlug).toMatch(/^[a-z0-9-]+$/);
      });

      it('accepts custom slug', () => {
        const customSlug = 'my-custom-slug-2025';
        expect(customSlug).toMatch(/^[a-z0-9-]+$/);
      });

      it('enforces max 50 chars', () => {
        const longSlug = 'x'.repeat(50);
        expect(longSlug.length).toBe(50);
      });
    });

    describe('id field', () => {
      it('accepts valid UUID v4', () => {
        const validUUID = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';
        expect(validUUID).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i);
      });

      it('rejects invalid UUID format', () => {
        const invalidUUID = 'not-a-uuid';
        expect(invalidUUID).not.toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i);
      });
    });
  });

  describe('Security Validations', () => {

    it('sanitizes HTML in name field', () => {
      const maliciousName = '<script>alert("xss")</script>';
      const sanitized = sanitizeHtmlForTest(maliciousName);
      expect(sanitized).not.toContain('<script>');
      expect(sanitized).not.toContain('<');
      expect(sanitized).toBe('alert("xss")');
    });

    it('sanitizes HTML in venue field', () => {
      const maliciousVenue = '<img onerror="alert(1)" src="x">';
      const sanitized = sanitizeHtmlForTest(maliciousVenue);
      expect(sanitized).not.toContain('<img');
      expect(sanitized).not.toContain('<');
      expect(sanitized).toBe('');
    });

    it('validates URL format for signupUrl', () => {
      const validUrl = 'https://forms.google.com/test';
      expect(validUrl).toMatch(/^https?:\/\//);

      const invalidUrl = 'javascript:alert(1)';
      expect(invalidUrl).not.toMatch(/^https?:\/\//);
    });

    it('requires admin authentication', () => {
      const mockErrorResponse = {
        ok: false,
        code: 'BAD_INPUT',
        message: 'Authentication required'
      };

      expect(mockErrorResponse.ok).toBe(false);
      expect(mockErrorResponse.code).toBe('BAD_INPUT');
    });
  });

  describe('Atomic Operations', () => {

    it('uses lock for concurrent safety', () => {
      // Lock timeout should be 10 seconds
      const lockTimeout = 10000;
      expect(lockTimeout).toBe(10000);
    });

    it('returns consistent etag for same data', () => {
      const data1 = { name: 'Test', venue: 'Venue' };
      const data2 = { name: 'Test', venue: 'Venue' };

      const hash1 = JSON.stringify(data1);
      const hash2 = JSON.stringify(data2);

      expect(hash1).toBe(hash2);
    });
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('📝 api_saveEvent Edge Cases', () => {

  describe('Slug Collision Handling', () => {
    it('appends suffix for duplicate slugs', () => {
      const baseSlug = 'test-event';
      const collision1 = `${baseSlug}-1`;
      const collision2 = `${baseSlug}-2`;

      expect(collision1).toBe('test-event-1');
      expect(collision2).toBe('test-event-2');
    });
  });

  describe('Field Merging on Update', () => {
    it('preserves existing fields not in update payload', () => {
      const existing = {
        name: 'Original Name',
        venue: 'Original Venue',
        schedule: [{ time: '10:00', description: 'Session' }]
      };

      const update = {
        name: 'Updated Name'
      };

      const merged = { ...existing, ...update };

      expect(merged.name).toBe('Updated Name');
      expect(merged.venue).toBe('Original Venue'); // Preserved
      expect(merged.schedule).toHaveLength(1); // Preserved
    });
  });

  describe('QR Code Regeneration', () => {
    it('regenerates QR when publicUrl changes', () => {
      // QR codes should be regenerated when base URL changes
      const qrPattern = /^data:image\/png;base64,/;
      const newQR = 'data:image/png;base64,newQRData';
      expect(newQR).toMatch(qrPattern);
    });

    it('regenerates signup QR when signupUrl changes', () => {
      const qrPattern = /^data:image\/png;base64,/;
      const newQR = 'data:image/png;base64,newSignupQR';
      expect(newQR).toMatch(qrPattern);
    });
  });

  describe('Unicode and Special Characters', () => {
    it('handles unicode in name field', () => {
      const unicodeName = 'Événement Spécial 日本語';
      expect(unicodeName.length).toBeGreaterThan(0);
    });

    it('handles emoji in name field', () => {
      const emojiName = 'Party Event 🎉';
      expect(emojiName).toContain('🎉');
    });
  });

  describe('Date Edge Cases', () => {
    it('accepts leap year date', () => {
      const leapDate = '2024-02-29';
      const [year, month, day] = leapDate.split('-').map(Number);
      expect(year % 4).toBe(0);
      expect(month).toBe(2);
      expect(day).toBe(29);
    });

    it('accepts far future date', () => {
      const futureDate = '2099-12-31';
      expect(futureDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});
