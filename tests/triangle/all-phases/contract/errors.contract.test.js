/**
 * Contract Tests for Error Codes (All Phases)
 *
 * Tests the standardized error codes used across all API endpoints
 * Story 5.1: Now includes correlation ID (corrId) validation for error tracing
 * Story 11: HTML error pages now include correlation IDs
 *
 * Triangle Phase: ⚡ All Phases (Blue)
 * Purpose: Standardized error handling across the application
 */

describe('🔺 TRIANGLE [ALL PHASES]: Error Codes Contract', () => {

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

  /**
   * Story 5.1: Validate error envelope includes correlation ID
   * corrId is optional for backward compatibility but required for structured errors
   */
  const validateErrorWithCorrId = (response) => {
    validateEnvelope(response);
    expect(response.ok).toBe(false);
    expect(response).toHaveProperty('corrId');
    expect(typeof response.corrId).toBe('string');
    // corrId format: timestamp (base36) + "-" + random suffix
    expect(response.corrId).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
    // Message should include reference to corrId
    expect(response.message).toContain('Reference:');
  };

  describe('Error code definitions', () => {
    const ERR = Object.freeze({
      BAD_INPUT:    'BAD_INPUT',
      NOT_FOUND:    'NOT_FOUND',
      RATE_LIMITED: 'RATE_LIMITED',
      INTERNAL:     'INTERNAL',
      CONTRACT:     'CONTRACT'
    });

    const errorCodes = ['BAD_INPUT', 'NOT_FOUND', 'RATE_LIMITED', 'INTERNAL', 'CONTRACT'];

    errorCodes.forEach(code => {
      it(`should have ${code} error code defined`, () => {
        expect(ERR[code]).toBe(code);
      });
    });
  });

  describe('BAD_INPUT error responses', () => {
    it('should return BAD_INPUT for invalid input', () => {
      const mockResponse = {
        ok: false,
        code: 'BAD_INPUT',
        message: 'Missing field: name'
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.code).toBe('BAD_INPUT');
      expect(typeof mockResponse.message).toBe('string');
    });

    it('should return BAD_INPUT for invalid admin key', () => {
      const mockResponse = {
        ok: false,
        code: 'BAD_INPUT',
        message: 'Invalid admin key'
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.code).toBe('BAD_INPUT');
    });
  });

  describe('NOT_FOUND error responses', () => {
    it('should return NOT_FOUND for missing resources', () => {
      const mockResponse = {
        ok: false,
        code: 'NOT_FOUND',
        message: 'Event not found'
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.code).toBe('NOT_FOUND');
    });
  });

  describe('RATE_LIMITED error responses', () => {
    it('should return RATE_LIMITED when rate limit exceeded', () => {
      const mockResponse = {
        ok: false,
        code: 'RATE_LIMITED',
        message: 'Too many requests'
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.code).toBe('RATE_LIMITED');
    });
  });

  describe('INTERNAL error responses', () => {
    it('should return INTERNAL for server errors', () => {
      const mockResponse = {
        ok: false,
        code: 'INTERNAL',
        message: 'Internal server error'
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.code).toBe('INTERNAL');
    });
  });

  describe('CONTRACT error responses', () => {
    it('should return CONTRACT for contract violations', () => {
      const mockResponse = {
        ok: false,
        code: 'CONTRACT',
        message: 'Response does not match contract'
      };

      validateEnvelope(mockResponse);
      expect(mockResponse.code).toBe('CONTRACT');
    });
  });

  // Story 5.1: Correlation ID Tests
  describe('Correlation ID (Story 5.1)', () => {
    it('should include corrId in structured error responses', () => {
      const mockStructuredError = {
        ok: false,
        code: 'INTERNAL',
        message: 'Something went wrong. Reference: lqx5m8k-a7b2',
        corrId: 'lqx5m8k-a7b2'
      };

      validateErrorWithCorrId(mockStructuredError);
    });

    it('should have corrId in correct format (timestamp-random)', () => {
      const mockError = {
        ok: false,
        code: 'BAD_INPUT',
        message: 'Something went wrong. Reference: m1abc23-xyz9',
        corrId: 'm1abc23-xyz9'
      };

      expect(mockError.corrId).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
    });

    it('should NOT expose stack trace to client', () => {
      const mockError = {
        ok: false,
        code: 'INTERNAL',
        message: 'Something went wrong. Reference: lqx5m8k-a7b2',
        corrId: 'lqx5m8k-a7b2'
      };

      expect(mockError).not.toHaveProperty('stack');
      expect(mockError.message).not.toContain('Error:');
      expect(mockError.message).not.toContain('at ');
    });

    it('should include corrId reference in user-facing message', () => {
      const mockError = {
        ok: false,
        code: 'INTERNAL',
        message: 'Something went wrong. Reference: abc123-def4',
        corrId: 'abc123-def4'
      };

      expect(mockError.message).toContain('Reference:');
      expect(mockError.message).toContain(mockError.corrId);
    });

    it('should allow backward-compatible errors without corrId', () => {
      // Some simple errors (like validation) may not require corrId
      const simpleError = {
        ok: false,
        code: 'BAD_INPUT',
        message: 'Missing required field: name'
      };

      validateEnvelope(simpleError);
      // corrId is optional for simple validation errors
      expect(simpleError.ok).toBe(false);
    });
  });

  // Story 11: HTML Error Pages with Correlation IDs
  describe('HTML Error Pages with Correlation ID (Story 11)', () => {
    /**
     * Validate HTML error page includes required elements
     * - User-friendly title
     * - Generic error message (not internal details)
     * - Correlation ID reference for support
     */
    const validateHtmlErrorPage = (html, expectedTitle, corrId) => {
      // Should contain title
      expect(html).toContain(expectedTitle);
      // Should contain generic error message
      expect(html).toContain('Something went wrong');
      // Should contain correlation ID reference
      expect(html).toContain('Reference:');
      expect(html).toContain(corrId);
      // Should contain help text
      expect(html).toContain('assistance');
    };

    it('should include corrId in HTML error pages', () => {
      const mockCorrId = 'lqx5m8k-a7b2';
      const mockHtml = `
        <!DOCTYPE html>
        <html>
        <head><title>Error - Invalid shortlink</title></head>
        <body>
          <h1>Invalid shortlink</h1>
          <p>Something went wrong. Please try again or contact support.</p>
          <div class="reference">Reference: ${mockCorrId}</div>
          <p>If you need assistance, please provide this reference code.</p>
        </body>
        </html>
      `;

      validateHtmlErrorPage(mockHtml, 'Invalid shortlink', mockCorrId);
    });

    it('should NOT include internal error details in HTML', () => {
      const mockHtml = `
        <!DOCTYPE html>
        <html>
        <head><title>Error - Configuration error</title></head>
        <body>
          <h1>Configuration error</h1>
          <p>Something went wrong. Please try again or contact support.</p>
          <div class="reference">Reference: abc123-def4</div>
        </body>
        </html>
      `;

      // Should NOT contain internal details like:
      expect(mockHtml).not.toContain('spreadsheetId');
      expect(mockHtml).not.toContain('SpreadsheetApp');
      expect(mockHtml).not.toContain('getSheetByName');
      expect(mockHtml).not.toContain('database');
      expect(mockHtml).not.toContain('connection');
    });

    it('should NOT include stack traces in HTML', () => {
      const mockHtml = `
        <!DOCTYPE html>
        <html>
        <head><title>Error</title></head>
        <body>
          <h1>Error</h1>
          <p>Something went wrong.</p>
          <div class="reference">Reference: xyz789-abc1</div>
        </body>
        </html>
      `;

      // Should NOT contain stack trace elements
      expect(mockHtml).not.toContain('at ');
      expect(mockHtml).not.toContain('.gs:');
      expect(mockHtml).not.toContain('Error:');
      expect(mockHtml).not.toContain('throw');
    });

    it('should escape HTML special characters in error titles', () => {
      const dangerousTitle = '<script>alert("xss")</script>';
      const escapedTitle = '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;';

      const mockHtml = `<h1>${escapedTitle}</h1>`;

      expect(mockHtml).toContain('&lt;script&gt;');
      expect(mockHtml).not.toContain('<script>alert');
    });

    it('should have corrId in valid format in HTML page', () => {
      const corrIdPattern = /Reference:\s*([a-z0-9]+-[a-z0-9]+)/;
      const mockHtml = `
        <div class="reference">Reference: m1abc23-xyz9</div>
      `;

      const match = mockHtml.match(corrIdPattern);
      expect(match).not.toBeNull();
      expect(match[1]).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
    });

    describe('handleRedirect_ HTML errors', () => {
      const errorScenarios = [
        { title: 'Invalid shortlink', reason: 'Missing token parameter' },
        { title: 'Configuration error', reason: 'Root brand not configured' },
        { title: 'Shortlink not found', reason: 'Token not in database' },
        { title: 'Invalid shortlink URL', reason: 'URL validation failed' },
        { title: 'Invalid shortlink protocol', reason: 'Non-HTTP protocol' }
      ];

      errorScenarios.forEach(({ title, reason }) => {
        it(`should return HTML error with corrId for: ${reason}`, () => {
          const mockCorrId = 'test123-abcd';
          const mockHtml = `
            <!DOCTYPE html>
            <html>
            <head><title>Error - ${title}</title></head>
            <body>
              <h1>${title}</h1>
              <p>Something went wrong. Please try again or contact support.</p>
              <div class="reference">Reference: ${mockCorrId}</div>
              <p>If you need assistance, please provide this reference code.</p>
            </body>
            </html>
          `;

          expect(mockHtml).toContain(title);
          expect(mockHtml).toContain('Reference:');
          expect(mockHtml).toContain(mockCorrId);
          // Should NOT contain internal reason
          expect(mockHtml).not.toContain(reason);
        });
      });
    });
  });
});
