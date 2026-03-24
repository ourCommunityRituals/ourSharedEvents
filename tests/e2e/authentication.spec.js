/**
 * E2E Tests for Authentication Features
 *
 * Tests all three authentication methods:
 * 1. Admin Key (legacy)
 * 2. Bearer Token (JWT)
 * 3. API Key Header
 */

const { test, expect } = require('@playwright/test');
const { getBaseUrl } = require('../config/environments');

const BASE_URL = getBaseUrl();
const ADMIN_KEY = process.env.ADMIN_KEY || 'test-admin-key';

test.describe('Authentication Methods', () => {

  test.describe('Method 1: Admin Key (Legacy)', () => {
    test('should create event with admin key in body', async ({ request }) => {
      const response = await request.post(BASE_URL, {
        data: {
          action: 'create',
          brandId: 'root',
          adminKey: ADMIN_KEY,
          scope: 'events',
          templateId: 'Event',
          data: {
            eventName: 'Auth Test Event - Admin Key',
            eventDate: '2025-07-15',
            eventTime: '19:00',
            locationName: 'Test Venue'
          }
        }
      });

      expect(response.ok()).toBeTruthy();
      const result = await response.json();

      expect(result.ok).toBe(true);
      expect(result.value).toHaveProperty('id');
      expect(result.value).toHaveProperty('publicUrl');
    });

    test('should reject request with invalid admin key', async ({ request }) => {
      const response = await request.post(BASE_URL, {
        data: {
          action: 'create',
          brandId: 'root',
          adminKey: 'INVALID_KEY',
          scope: 'events',
          templateId: 'Event',
          data: {
            eventName: 'Should Fail',
            eventDate: '2025-07-15'
          }
        }
      });

      const result = await response.json();

      expect(result.ok).toBe(false);
      expect(result.code).toBe('BAD_INPUT');
      expect(result.message).toContain('Invalid');
    });

    test('should reject request with missing admin key', async ({ request }) => {
      const response = await request.post(BASE_URL, {
        data: {
          action: 'create',
          brandId: 'root',
          // adminKey missing
          scope: 'events',
          templateId: 'Event',
          data: {
            eventName: 'Should Fail',
            eventDate: '2025-07-15'
          }
        }
      });

      const result = await response.json();

      expect(result.ok).toBe(false);
      expect(result.code).toBe('BAD_INPUT');
    });
  });

  test.describe('Method 2: Bearer Token (JWT)', () => {
    let jwtToken = null;
    let tokenExpiresAt = null;

    test('should generate JWT token', async ({ request }) => {
      const response = await request.post(BASE_URL, {
        data: {
          action: 'generateToken',
          brandId: 'root',
          adminKey: ADMIN_KEY,
          expiresIn: 3600,
          scope: 'events'
        }
      });

      expect(response.ok()).toBeTruthy();
      const result = await response.json();

      expect(result.ok).toBe(true);
      expect(result.value).toHaveProperty('token');
      expect(result.value).toHaveProperty('expiresIn');
      expect(result.value).toHaveProperty('expiresAt');
      expect(result.value).toHaveProperty('usage');
      expect(result.value.expiresIn).toBe(3600);

      // Save token for subsequent tests
      jwtToken = result.value.token;
      tokenExpiresAt = result.value.expiresAt;

      // Verify token structure (JWT has 3 parts)
      const parts = jwtToken.split('.');
      expect(parts).toHaveLength(3);
    });

    test('should create event with Bearer token', async ({ request }) => {
      // Generate fresh token
      const tokenResponse = await request.post(BASE_URL, {
        data: {
          action: 'generateToken',
          brandId: 'root',
          adminKey: ADMIN_KEY,
          expiresIn: 3600
        }
      });

      const tokenResult = await tokenResponse.json();
      const token = tokenResult.value.token;

      // Use token to create event
      const response = await request.post(BASE_URL, {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        data: {
          action: 'create',
          brandId: 'root',
          scope: 'events',
          templateId: 'Event',
          data: {
            eventName: 'Auth Test Event - JWT',
            eventDate: '2025-07-15',
            eventTime: '19:00',
            locationName: 'Test Venue'
          }
        }
      });

      expect(response.ok()).toBeTruthy();
      const result = await response.json();

      expect(result.ok).toBe(true);
      expect(result.value).toHaveProperty('id');
      expect(result.value).toHaveProperty('publicUrl');
    });

    test('should reject request with invalid JWT token', async ({ request }) => {
      const response = await request.post(BASE_URL, {
        headers: {
          'Authorization': 'Bearer INVALID.TOKEN.HERE'
        },
        data: {
          action: 'create',
          brandId: 'root',
          scope: 'events',
          templateId: 'Event',
          data: {
            eventName: 'Should Fail',
            eventDate: '2025-07-15'
          }
        }
      });

      const result = await response.json();

      expect(result.ok).toBe(false);
      expect(result.code).toBe('BAD_INPUT');
    });

    test('should reject request with malformed JWT', async ({ request }) => {
      const response = await request.post(BASE_URL, {
        headers: {
          'Authorization': 'Bearer not-a-jwt'
        },
        data: {
          action: 'create',
          brandId: 'root',
          scope: 'events',
          templateId: 'Event',
          data: {
            eventName: 'Should Fail',
            eventDate: '2025-07-15'
          }
        }
      });

      const result = await response.json();

      expect(result.ok).toBe(false);
    });

    test('should generate token with custom expiration', async ({ request }) => {
      const response = await request.post(BASE_URL, {
        data: {
          action: 'generateToken',
          brandId: 'root',
          adminKey: ADMIN_KEY,
          expiresIn: 1800, // 30 minutes
          scope: 'events'
        }
      });

      const result = await response.json();

      expect(result.ok).toBe(true);
      expect(result.value.expiresIn).toBe(1800);
    });
  });

  test.describe('Method 3: API Key Header', () => {
    test('should create event with X-API-Key header', async ({ request }) => {
      const response = await request.post(BASE_URL, {
        headers: {
          'X-API-Key': ADMIN_KEY
        },
        data: {
          action: 'create',
          brandId: 'root',
          scope: 'events',
          templateId: 'Event',
          data: {
            eventName: 'Auth Test Event - API Key',
            eventDate: '2025-07-15',
            eventTime: '19:00',
            locationName: 'Test Venue'
          }
        }
      });

      expect(response.ok()).toBeTruthy();
      const result = await response.json();

      expect(result.ok).toBe(true);
      expect(result.value).toHaveProperty('id');
      expect(result.value).toHaveProperty('publicUrl');
    });

    test('should reject request with invalid API key', async ({ request }) => {
      const response = await request.post(BASE_URL, {
        headers: {
          'X-API-Key': 'INVALID_KEY'
        },
        data: {
          action: 'create',
          brandId: 'root',
          scope: 'events',
          templateId: 'Event',
          data: {
            eventName: 'Should Fail',
            eventDate: '2025-07-15'
          }
        }
      });

      const result = await response.json();

      expect(result.ok).toBe(false);
      expect(result.code).toBe('BAD_INPUT');
    });
  });

  test.describe('Multi-Method Authentication', () => {
    test('should work with any of the three methods', async ({ request }) => {
      // Test that all three methods can create events successfully

      // Method 1: Admin Key
      const response1 = await request.post(BASE_URL, {
        data: {
          action: 'create',
          brandId: 'root',
          adminKey: ADMIN_KEY,
          scope: 'events',
          templateId: 'Event',
          data: {
            eventName: 'Multi-Auth Test 1',
            eventDate: '2025-07-15'
          }
        }
      });
      expect((await response1.json()).ok).toBe(true);

      // Method 2: JWT
      const tokenResponse = await request.post(BASE_URL, {
        data: {
          action: 'generateToken',
          brandId: 'root',
          adminKey: ADMIN_KEY
        }
      });
      const token = (await tokenResponse.json()).value.token;

      const response2 = await request.post(BASE_URL, {
        headers: { 'Authorization': `Bearer ${token}` },
        data: {
          action: 'create',
          brandId: 'root',
          scope: 'events',
          templateId: 'Event',
          data: {
            eventName: 'Multi-Auth Test 2',
            eventDate: '2025-07-15'
          }
        }
      });
      expect((await response2.json()).ok).toBe(true);

      // Method 3: API Key Header
      const response3 = await request.post(BASE_URL, {
        headers: { 'X-API-Key': ADMIN_KEY },
        data: {
          action: 'create',
          brandId: 'root',
          scope: 'events',
          templateId: 'Event',
          data: {
            eventName: 'Multi-Auth Test 3',
            eventDate: '2025-07-15'
          }
        }
      });
      expect((await response3.json()).ok).toBe(true);
    });

    test('should prefer Bearer token over admin key when both provided', async ({ request }) => {
      // Generate valid token
      const tokenResponse = await request.post(BASE_URL, {
        data: {
          action: 'generateToken',
          brandId: 'root',
          adminKey: ADMIN_KEY
        }
      });
      const token = (await tokenResponse.json()).value.token;

      // Send request with both Bearer token and admin key
      const response = await request.post(BASE_URL, {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        data: {
          action: 'create',
          brandId: 'root',
          adminKey: 'WRONG_KEY', // This should be ignored
          scope: 'events',
          templateId: 'Event',
          data: {
            eventName: 'Token Priority Test',
            eventDate: '2025-07-15'
          }
        }
      });

      const result = await response.json();

      // Should succeed because Bearer token is valid
      expect(result.ok).toBe(true);
    });
  });

  test.describe('Token Security', () => {
    test('should validate token signature', async ({ request }) => {
      // Generate valid token
      const tokenResponse = await request.post(BASE_URL, {
        data: {
          action: 'generateToken',
          brandId: 'root',
          adminKey: ADMIN_KEY
        }
      });
      const token = (await tokenResponse.json()).value.token;

      // Tamper with the signature
      const parts = token.split('.');
      const tamperedToken = `${parts[0]}.${parts[1]}.TAMPERED_SIGNATURE`;

      // Try to use tampered token
      const response = await request.post(BASE_URL, {
        headers: {
          'Authorization': `Bearer ${tamperedToken}`
        },
        data: {
          action: 'create',
          brandId: 'root',
          scope: 'events',
          templateId: 'Event',
          data: {
            eventName: 'Should Fail',
            eventDate: '2025-07-15'
          }
        }
      });

      const result = await response.json();

      expect(result.ok).toBe(false);
      expect(result.code).toBe('BAD_INPUT');
    });

    test('should validate token brand', async ({ request }) => {
      // This test assumes the token payload can be inspected
      // In a real scenario, you'd need a token for a different brand

      // For now, just verify that tokens contain brand information
      const tokenResponse = await request.post(BASE_URL, {
        data: {
          action: 'generateToken',
          brandId: 'root',
          adminKey: ADMIN_KEY
        }
      });
      const token = (await tokenResponse.json()).value.token;

      // Decode payload (middle part of JWT)
      const parts = token.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());

      expect(payload).toHaveProperty('brand');
      expect(payload.brand).toBe('root');
      expect(payload).toHaveProperty('exp');
      expect(payload).toHaveProperty('iat');
    });
  });

  test.describe('Rate Limiting', () => {
    test('should enforce rate limits across all auth methods', async ({ request }) => {
      // Note: This test might be flaky depending on rate limit implementation
      // Skip if rate limits are low or tests run in parallel

      const requests = [];
      for (let i = 0; i < 25; i++) {
        requests.push(
          request.post(BASE_URL, {
            data: {
              action: 'list',
              brandId: 'root',
              adminKey: ADMIN_KEY,
              scope: 'events'
            }
          })
        );
      }

      const responses = await Promise.all(requests);
      const results = await Promise.all(responses.map(r => r.json()));

      // At least one should be rate limited (20 req/min limit)
      const rateLimited = results.filter(r => r.code === 'RATE_LIMITED');
      expect(rateLimited.length).toBeGreaterThan(0);
    });
  });
});

test.describe('Public Endpoints (No Auth Required)', () => {
  test('should access status endpoint without authentication', async ({ request }) => {
    const response = await request.get(`${BASE_URL}?action=status`);

    expect(response.ok()).toBeTruthy();
    const result = await response.json();

    expect(result.ok).toBe(true);
    expect(result.value).toHaveProperty('build');
    expect(result.value).toHaveProperty('dbOk');
  });

  test('should list events without authentication', async ({ request }) => {
    const response = await request.get(`${BASE_URL}?action=list&brand=root&scope=events`);

    expect(response.ok()).toBeTruthy();
    const result = await response.json();

    expect(result.ok).toBe(true);
    expect(result.value).toHaveProperty('items');
    expect(Array.isArray(result.value.items)).toBe(true);
  });

  test('should get config without authentication', async ({ request }) => {
    const response = await request.get(`${BASE_URL}?action=config&brand=root&scope=events`);

    expect(response.ok()).toBeTruthy();
    const result = await response.json();

    expect(result.ok).toBe(true);
    expect(result.value).toHaveProperty('brand');
  });
});

test.describe('Authentication Error Handling', () => {
  test('should return consistent error format for auth failures', async ({ request }) => {
    const response = await request.post(BASE_URL, {
      data: {
        action: 'create',
        brandId: 'root',
        adminKey: 'WRONG_KEY',
        scope: 'events',
        templateId: 'Event',
        data: {
          eventName: 'Should Fail',
          eventDate: '2025-07-15'
        }
      }
    });

    const result = await response.json();

    // Verify error envelope structure
    expect(result).toHaveProperty('ok');
    expect(result).toHaveProperty('code');
    expect(result).toHaveProperty('message');
    expect(result.ok).toBe(false);
    expect(typeof result.code).toBe('string');
    expect(typeof result.message).toBe('string');
  });

  test('should handle missing Authorization header gracefully', async ({ request }) => {
    const response = await request.post(BASE_URL, {
      // No auth headers or body
      data: {
        action: 'create',
        brandId: 'root',
        scope: 'events',
        templateId: 'Event',
        data: {
          eventName: 'Should Fail',
          eventDate: '2025-07-15'
        }
      }
    });

    const result = await response.json();

    expect(result.ok).toBe(false);
    expect(result.code).toBe('BAD_INPUT');
  });
});
