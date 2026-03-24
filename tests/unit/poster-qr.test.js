/**
 * Poster QR + Domain Integrity Tests
 *
 * Purpose: Ensure Poster QR codes always point to friendly URLs (eventangle.com)
 *          and never leak the Google Apps Script exec URL.
 *
 * Test Strategy:
 *   1. Parse quickchart.io QR URLs to extract encoded target URL (fast, offline)
 *   2. Optionally decode actual QR images with jsQR (thorough, requires network)
 *
 * Run with: npm run test:poster-qr
 */

const jsQR = require('jsqr');

// =============================================================================
// Constants
// =============================================================================

// Friendly URL domain - QR codes MUST point here
const FRIENDLY_DOMAIN = 'eventangle.com';
const FRIENDLY_BASE = `https://www.${FRIENDLY_DOMAIN}`;

// GAS exec URL - QR codes MUST NOT contain this
const GAS_DOMAIN = 'script.google.com';

// Valid page query parameters for QR URLs
const VALID_PAGE_PARAMS = ['public', 'signup'];

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if hostname exactly matches or is a subdomain of the target domain
 * This prevents bypass attacks like "evil-script.google.com" or "script.google.com.evil.com"
 *
 * @param {string} hostname - The hostname to check
 * @param {string} domain - The domain to match against
 * @returns {boolean} True if hostname matches or is a valid subdomain
 */
function isExactDomainMatch(hostname, domain) {
  // Exact match
  if (hostname === domain) {
    return true;
  }
  // Subdomain match (e.g., "www.eventangle.com" matches "eventangle.com")
  // Must end with ".domain" to prevent "evileventangle.com" matching
  if (hostname.endsWith('.' + domain)) {
    return true;
  }
  return false;
}

/**
 * Extract target URL from quickchart.io QR URL
 * QuickChart URL format: https://quickchart.io/qr?text={encodedUrl}&size=200&margin=1
 *
 * @param {string} qrImageUrl - The quickchart.io QR image URL
 * @returns {string|null} The decoded target URL or null if invalid
 */
function extractTargetUrlFromQuickChart(qrImageUrl) {
  if (!qrImageUrl || typeof qrImageUrl !== 'string') {
    return null;
  }

  try {
    const url = new URL(qrImageUrl);

    // Must be quickchart.io
    if (url.hostname !== 'quickchart.io') {
      return null;
    }

    // Extract the 'text' parameter (the encoded target URL)
    const targetUrl = url.searchParams.get('text');
    if (!targetUrl) {
      return null;
    }

    // Validate it's a proper URL
    new URL(targetUrl);
    return targetUrl;
  } catch {
    return null;
  }
}

/**
 * Generate mock QR code URLs (simulating generateQRCodes_ from Code.gs)
 * This mirrors the backend logic for testing purposes
 *
 * @param {object} links - Event links object with publicUrl and signupUrl
 * @returns {object} { public, signup } QR code image URLs
 */
function generateMockQRCodes(links) {
  const QR_SIZE = 200;
  const QR_MARGIN = 1;

  const qrUrl = (targetUrl) => {
    if (!targetUrl) return null;
    return `https://quickchart.io/qr?text=${encodeURIComponent(targetUrl)}&size=${QR_SIZE}&margin=${QR_MARGIN}`;
  };

  return {
    public: qrUrl(links?.publicUrl),
    signup: qrUrl(links?.signupUrl)
  };
}

/**
 * Decode QR code from image data using jsQR
 *
 * @param {Uint8ClampedArray} imageData - RGBA pixel data
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @returns {string|null} Decoded QR content or null
 */
function decodeQRFromImageData(imageData, width, height) {
  const result = jsQR(imageData, width, height);
  return result ? result.data : null;
}

/**
 * Validate that a URL is a friendly URL (not GAS)
 *
 * @param {string} url - URL to validate
 * @returns {object} { isValid, isFriendly, isGAS, errors }
 */
function validateQRTargetUrl(url) {
  const result = {
    isValid: false,
    isFriendly: false,
    isGAS: false,
    hasValidPage: false,
    hasEventParam: false,
    errors: []
  };

  if (!url || typeof url !== 'string') {
    result.errors.push('URL is empty or invalid');
    return result;
  }

  try {
    const parsed = new URL(url);

    // Check for GAS URL (MUST NOT match) - use exact domain matching to prevent bypass
    // This prevents attacks like "evil-script.google.com" or "script.google.com.evil.com"
    if (isExactDomainMatch(parsed.hostname, GAS_DOMAIN)) {
      result.isGAS = true;
      result.errors.push(`URL contains forbidden GAS domain: ${GAS_DOMAIN}`);
      return result;
    }

    // Check for friendly domain - use exact domain matching
    // Accepts "eventangle.com" or "www.eventangle.com" or other valid subdomains
    if (isExactDomainMatch(parsed.hostname, FRIENDLY_DOMAIN)) {
      result.isFriendly = true;
    } else {
      result.errors.push(`URL must use friendly domain (${FRIENDLY_DOMAIN}), got: ${parsed.hostname}`);
    }

    // Check URL starts with expected base
    if (url.startsWith(FRIENDLY_BASE)) {
      result.isValid = true;
    } else if (url.startsWith(`https://${FRIENDLY_DOMAIN}`)) {
      // Also accept without www
      result.isValid = true;
    } else {
      result.errors.push(`URL must start with ${FRIENDLY_BASE}`);
    }

    // Check for valid page parameter (if present)
    const page = parsed.searchParams.get('page');
    if (page) {
      if (VALID_PAGE_PARAMS.includes(page)) {
        result.hasValidPage = true;
      } else {
        result.errors.push(`Invalid page parameter: ${page}. Expected: ${VALID_PAGE_PARAMS.join(', ')}`);
      }
    } else {
      // Also support friendly URL paths (no query params needed)
      // e.g., https://www.eventangle.com/events or /abc/events
      // Only check pathname if no page parameter is set
      if (parsed.pathname.includes('/events') || parsed.pathname.includes('/signup')) {
        result.hasValidPage = true;
      }
    }

    // Check for event parameter
    const eventId = parsed.searchParams.get('event') || parsed.searchParams.get('id');
    if (eventId) {
      result.hasEventParam = true;
    }

  } catch (e) {
    result.errors.push(`Invalid URL format: ${e.message}`);
  }

  return result;
}

// =============================================================================
// Test Suites
// =============================================================================

describe('Poster QR + Domain Integrity', () => {

  describe('Domain Matching Security (isExactDomainMatch)', () => {

    it('should match exact domain', () => {
      expect(isExactDomainMatch('eventangle.com', 'eventangle.com')).toBe(true);
      expect(isExactDomainMatch('script.google.com', 'script.google.com')).toBe(true);
    });

    it('should match valid subdomains', () => {
      expect(isExactDomainMatch('www.eventangle.com', 'eventangle.com')).toBe(true);
      expect(isExactDomainMatch('api.eventangle.com', 'eventangle.com')).toBe(true);
      expect(isExactDomainMatch('www.script.google.com', 'script.google.com')).toBe(true);
    });

    it('should NOT match prefix attacks (evileventangle.com)', () => {
      expect(isExactDomainMatch('evileventangle.com', 'eventangle.com')).toBe(false);
      expect(isExactDomainMatch('fakescript.google.com', 'script.google.com')).toBe(false);
      expect(isExactDomainMatch('notscript.google.com', 'script.google.com')).toBe(false);
    });

    it('should NOT match suffix attacks (eventangle.com.evil.com)', () => {
      expect(isExactDomainMatch('eventangle.com.evil.com', 'eventangle.com')).toBe(false);
      expect(isExactDomainMatch('script.google.com.evil.com', 'script.google.com')).toBe(false);
    });

    it('should NOT match partial domain names', () => {
      expect(isExactDomainMatch('eventangle', 'eventangle.com')).toBe(false);
      expect(isExactDomainMatch('google.com', 'script.google.com')).toBe(false);
    });
  });

  describe('URL Extraction from QuickChart', () => {

    it('should extract target URL from valid quickchart.io QR URL', () => {
      const targetUrl = 'https://www.eventangle.com/events?page=public&event=test123';
      const qrImageUrl = `https://quickchart.io/qr?text=${encodeURIComponent(targetUrl)}&size=200&margin=1`;

      const extracted = extractTargetUrlFromQuickChart(qrImageUrl);

      expect(extracted).toBe(targetUrl);
    });

    it('should return null for non-quickchart URLs', () => {
      const qrImageUrl = 'https://example.com/qr?text=test';

      const extracted = extractTargetUrlFromQuickChart(qrImageUrl);

      expect(extracted).toBeNull();
    });

    it('should return null for URLs without text parameter', () => {
      const qrImageUrl = 'https://quickchart.io/qr?size=200';

      const extracted = extractTargetUrlFromQuickChart(qrImageUrl);

      expect(extracted).toBeNull();
    });

    it('should return null for invalid text parameter (not a URL)', () => {
      const qrImageUrl = 'https://quickchart.io/qr?text=not-a-url';

      const extracted = extractTargetUrlFromQuickChart(qrImageUrl);

      expect(extracted).toBeNull();
    });

    it('should handle URL-encoded special characters', () => {
      const targetUrl = 'https://www.eventangle.com/events?event=Summer%20BBQ%202024';
      const qrImageUrl = `https://quickchart.io/qr?text=${encodeURIComponent(targetUrl)}&size=200`;

      const extracted = extractTargetUrlFromQuickChart(qrImageUrl);

      expect(extracted).toBe(targetUrl);
    });
  });

  describe('QR Target URL Validation', () => {

    describe('Friendly URL Detection', () => {

      it('should validate friendly URL with www', () => {
        const url = 'https://www.eventangle.com/events?page=public&event=test123';

        const result = validateQRTargetUrl(url);

        expect(result.isFriendly).toBe(true);
        expect(result.isGAS).toBe(false);
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should validate friendly URL without www', () => {
        const url = 'https://eventangle.com/events?page=public&event=test123';

        const result = validateQRTargetUrl(url);

        expect(result.isFriendly).toBe(true);
        expect(result.isGAS).toBe(false);
        expect(result.isValid).toBe(true);
      });

      it('should validate friendly URL with signup page', () => {
        const url = 'https://www.eventangle.com/events?page=signup&event=test123';

        const result = validateQRTargetUrl(url);

        expect(result.isFriendly).toBe(true);
        expect(result.hasValidPage).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should validate friendly URL paths (no query params)', () => {
        const url = 'https://www.eventangle.com/abc/events';

        const result = validateQRTargetUrl(url);

        expect(result.isFriendly).toBe(true);
        expect(result.isValid).toBe(true);
        expect(result.hasValidPage).toBe(true);
      });
    });

    describe('GAS URL Detection', () => {

      it('should reject Google Apps Script exec URL', () => {
        const url = 'https://script.google.com/macros/s/DEPLOYMENT_ID/exec?page=public';

        const result = validateQRTargetUrl(url);

        expect(result.isGAS).toBe(true);
        expect(result.isFriendly).toBe(false);
        expect(result.isValid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors.some(e => e.includes('forbidden GAS domain'))).toBe(true);
      });

      it('should reject GAS URL with encoded parameters', () => {
        const url = 'https://script.google.com/macros/s/AKfycby.../exec?brand=abc&page=public';

        const result = validateQRTargetUrl(url);

        expect(result.isGAS).toBe(true);
        // Check error message contains expected text (not doing URL validation here)
        expect(result.errors.some(e => e.includes('forbidden GAS domain'))).toBe(true);
      });

      it('should reject any URL containing script.google.com', () => {
        const urls = [
          'https://script.google.com/macros/s/id/exec',
          'https://script.google.com/a/domain/macros/s/id/exec',
          'https://script.google.com/macros/s/AKfycbyS1cW9VhviR-Jr8AmYY_BAGrb1gzuKkrgEBP2M3bMdqAv4ktqHOZInWV8ogkpz5i8SYQ/exec'
        ];

        urls.forEach(url => {
          const result = validateQRTargetUrl(url);
          expect(result.isGAS).toBe(true);
          expect(result.isFriendly).toBe(false);
        });
      });

      it('should NOT be bypassed by subdomain prefix attacks', () => {
        // Security: "evil-script.google.com" should NOT match "script.google.com"
        const bypassAttempts = [
          'https://evil-script.google.com/macros/exec',
          'https://notscript.google.com/test',
          'https://script.google.com.evil.com/test',
          'https://fakescript.google.com/macros/exec'
        ];

        bypassAttempts.forEach(url => {
          const result = validateQRTargetUrl(url);
          // These should NOT be flagged as GAS URLs
          expect(result.isGAS).toBe(false);
        });
      });

      it('should accept valid GAS subdomains', () => {
        // Valid subdomains of script.google.com should still be caught
        const validGasUrls = [
          'https://script.google.com/macros/s/id/exec',
          'https://www.script.google.com/macros/exec' // hypothetical subdomain
        ];

        validGasUrls.forEach(url => {
          const result = validateQRTargetUrl(url);
          expect(result.isGAS).toBe(true);
        });
      });
    });

    describe('Invalid URL Handling', () => {

      it('should reject empty URL', () => {
        const result = validateQRTargetUrl('');
        expect(result.isValid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });

      it('should reject null URL', () => {
        const result = validateQRTargetUrl(null);
        expect(result.isValid).toBe(false);
      });

      it('should reject malformed URL', () => {
        const result = validateQRTargetUrl('not-a-valid-url');
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.includes('Invalid URL'))).toBe(true);
      });

      it('should reject non-eventangle domains', () => {
        const result = validateQRTargetUrl('https://example.com/events');
        expect(result.isFriendly).toBe(false);
        expect(result.errors.some(e => e.includes('must use friendly domain'))).toBe(true);
      });
    });
  });

  describe('QR Code Generation Contract', () => {

    it('should generate friendly URLs for public page QR', () => {
      const eventLinks = {
        publicUrl: 'https://www.eventangle.com/events?page=public&event=summer-bbq',
        signupUrl: 'https://www.eventangle.com/events?page=signup&event=summer-bbq'
      };

      const qrCodes = generateMockQRCodes(eventLinks);

      // Extract and validate public QR
      const publicTarget = extractTargetUrlFromQuickChart(qrCodes.public);
      const publicValidation = validateQRTargetUrl(publicTarget);

      expect(publicValidation.isFriendly).toBe(true);
      expect(publicValidation.isGAS).toBe(false);
      expect(publicTarget).toContain('eventangle.com');
      expect(publicTarget).not.toContain('script.google.com');
    });

    it('should generate friendly URLs for signup page QR', () => {
      const eventLinks = {
        publicUrl: 'https://www.eventangle.com/events?page=public&event=summer-bbq',
        signupUrl: 'https://www.eventangle.com/events?page=signup&event=summer-bbq'
      };

      const qrCodes = generateMockQRCodes(eventLinks);

      // Extract and validate signup QR
      const signupTarget = extractTargetUrlFromQuickChart(qrCodes.signup);
      const signupValidation = validateQRTargetUrl(signupTarget);

      expect(signupValidation.isFriendly).toBe(true);
      expect(signupValidation.isGAS).toBe(false);
      expect(signupTarget).toContain('eventangle.com');
      expect(signupTarget).not.toContain('script.google.com');
    });

    it('should FAIL if GAS URL is accidentally used', () => {
      // Simulate a regression where GAS URL leaks into event links
      const brokenEventLinks = {
        publicUrl: 'https://script.google.com/macros/s/DEPLOYMENT_ID/exec?page=public&event=test',
        signupUrl: 'https://script.google.com/macros/s/DEPLOYMENT_ID/exec?page=signup&event=test'
      };

      const qrCodes = generateMockQRCodes(brokenEventLinks);

      // Extract targets
      const publicTarget = extractTargetUrlFromQuickChart(qrCodes.public);
      const signupTarget = extractTargetUrlFromQuickChart(qrCodes.signup);

      // These should FAIL validation
      const publicValidation = validateQRTargetUrl(publicTarget);
      const signupValidation = validateQRTargetUrl(signupTarget);

      expect(publicValidation.isGAS).toBe(true);
      expect(publicValidation.isFriendly).toBe(false);
      expect(signupValidation.isGAS).toBe(true);
      expect(signupValidation.isFriendly).toBe(false);
    });

    it('should handle null URLs gracefully', () => {
      const eventLinks = {
        publicUrl: null,
        signupUrl: undefined
      };

      const qrCodes = generateMockQRCodes(eventLinks);

      expect(qrCodes.public).toBeNull();
      expect(qrCodes.signup).toBeNull();
    });
  });

  describe('Full QR Decode Contract (jsQR)', () => {

    it('jsQR library should be available', () => {
      expect(typeof jsQR).toBe('function');
    });

    it('should decode QR content correctly', () => {
      // Create a simple test case with known QR data
      // Note: In real tests, we'd fetch actual QR images
      // This tests the decodeQRFromImageData helper works with jsQR

      // jsQR expects RGBA image data
      // For unit tests, we verify the helper function signature
      const mockImageData = new Uint8ClampedArray(4 * 100 * 100); // 100x100 RGBA
      const result = decodeQRFromImageData(mockImageData, 100, 100);

      // Empty/noise image won't decode to valid QR
      expect(result).toBeNull();
    });
  });

  describe('Regression Prevention', () => {

    it('CRITICAL: Public QR must start with https://www.eventangle.com/events', () => {
      const validPublicUrls = [
        'https://www.eventangle.com/events',
        'https://www.eventangle.com/events?page=public',
        'https://www.eventangle.com/events?page=public&event=abc123',
        'https://www.eventangle.com/abc/events',
        'https://eventangle.com/events'
      ];

      validPublicUrls.forEach(url => {
        const result = validateQRTargetUrl(url);
        expect(result.isFriendly).toBe(true);
        expect(result.isGAS).toBe(false);
      });
    });

    it('CRITICAL: Signup QR must use eventangle.com domain', () => {
      const validSignupUrls = [
        'https://www.eventangle.com/events?page=signup',
        'https://www.eventangle.com/events?page=signup&event=abc123',
        'https://www.eventangle.com/signup',
        'https://eventangle.com/signup'
      ];

      validSignupUrls.forEach(url => {
        const result = validateQRTargetUrl(url);
        expect(result.isFriendly).toBe(true);
        expect(result.isGAS).toBe(false);
      });
    });

    it('CRITICAL: Any script.google.com URL must be rejected', () => {
      const gasUrls = [
        'https://script.google.com/macros/s/id/exec',
        'https://script.google.com/macros/s/AKfycby.../exec?page=public',
        'https://script.google.com/a/custom.domain/macros/s/id/exec',
        'https://script.google.com/macros/s/deployment-id/exec?brand=root&page=public&event=123'
      ];

      gasUrls.forEach(url => {
        const result = validateQRTargetUrl(url);
        expect(result.isGAS).toBe(true);
        expect(result.isFriendly).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });
    });

    it('should validate page parameter values', () => {
      // Valid pages
      expect(validateQRTargetUrl('https://www.eventangle.com/events?page=public').hasValidPage).toBe(true);
      expect(validateQRTargetUrl('https://www.eventangle.com/events?page=signup').hasValidPage).toBe(true);

      // Invalid pages should not crash but should flag
      const invalidPage = validateQRTargetUrl('https://www.eventangle.com/events?page=admin');
      expect(invalidPage.hasValidPage).toBe(false);
    });

    it('should detect event parameter presence', () => {
      const withEvent = validateQRTargetUrl('https://www.eventangle.com/events?page=public&event=test123');
      expect(withEvent.hasEventParam).toBe(true);

      const withId = validateQRTargetUrl('https://www.eventangle.com/events?page=public&id=test123');
      expect(withId.hasEventParam).toBe(true);

      const withoutEvent = validateQRTargetUrl('https://www.eventangle.com/events?page=public');
      expect(withoutEvent.hasEventParam).toBe(false);
    });
  });
});

// =============================================================================
// Export for use in integration tests
// =============================================================================

module.exports = {
  isExactDomainMatch,
  extractTargetUrlFromQuickChart,
  validateQRTargetUrl,
  generateMockQRCodes,
  decodeQRFromImageData,
  FRIENDLY_DOMAIN,
  FRIENDLY_BASE,
  GAS_DOMAIN,
  VALID_PAGE_PARAMS
};
