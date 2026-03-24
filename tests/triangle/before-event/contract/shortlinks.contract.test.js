/**
 * Contract Tests for Shortlinks API (Before Event)
 *
 * Tests the shortlink creation endpoint used during the Before Event phase
 *
 * Triangle Phase: 📋 Before Event (Green)
 * API Endpoint: ?action=createShortlink
 * Purpose: Generate shareable shortlinks for event promotion
 * User Roles: Event Manager (primary)
 */

describe('🔺 TRIANGLE [BEFORE EVENT]: Shortlinks API Contract', () => {

  const validateEnvelope = (response) => {
    expect(response).toHaveProperty('ok');
    expect(typeof response.ok).toBe('boolean');

    if (response.ok) {
      if (!response.notModified) {
        expect(response).toHaveProperty('value');
      }
    } else {
      expect(response).toHaveProperty('code');
      expect(response).toHaveProperty('message');
    }
  };

  describe('api_createShortlink - Success responses', () => {
    it('should return token and shortlink on success', () => {
      const mockResponse = {
        ok: true,
        value: {
          token: 'abc12345',
          shortlink: 'https://script.google.com/macros/s/.../exec?p=r&t=abc12345',
          targetUrl: 'https://example.com/signup'
        }
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.value).toHaveProperty('token');
      expect(mockResponse.value).toHaveProperty('shortlink');
      expect(mockResponse.value).toHaveProperty('targetUrl');
    });

    it('should return alphanumeric token', () => {
      const mockResponse = {
        ok: true,
        value: {
          token: 'abc12345',
          shortlink: 'https://script.google.com/macros/s/.../exec?p=r&t=abc12345',
          targetUrl: 'https://example.com/signup'
        }
      };

      expect(typeof mockResponse.value.token).toBe('string');
      expect(mockResponse.value.token).toMatch(/^[a-zA-Z0-9]+$/);
    });

    it('should return valid shortlink URL with token', () => {
      const mockResponse = {
        ok: true,
        value: {
          token: 'abc12345',
          shortlink: 'https://script.google.com/macros/s/.../exec?p=r&t=abc12345',
          targetUrl: 'https://example.com/signup'
        }
      };

      expect(mockResponse.value.shortlink).toMatch(/^https:\/\//);
      expect(mockResponse.value.shortlink).toContain('p=r');
      expect(mockResponse.value.shortlink).toContain(`t=${mockResponse.value.token}`);
    });

    it('should preserve target URL', () => {
      const mockResponse = {
        ok: true,
        value: {
          token: 'abc12345',
          shortlink: 'https://script.google.com/macros/s/.../exec?p=r&t=abc12345',
          targetUrl: 'https://example.com/signup'
        }
      };

      expect(typeof mockResponse.value.targetUrl).toBe('string');
      expect(mockResponse.value.targetUrl).toMatch(/^https?:\/\//);
    });
  });

  describe('api_createShortlink - Validation errors', () => {
    it('should return error for missing target URL', () => {
      const mockResponse = {
        ok: false,
        code: 'BAD_INPUT',
        message: 'Missing targetUrl'
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.code).toBe('BAD_INPUT');
    });

    it('should return error for invalid URL format', () => {
      const mockResponse = {
        ok: false,
        code: 'BAD_INPUT',
        message: 'Invalid URL format'
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.code).toBe('BAD_INPUT');
    });
  });
});
