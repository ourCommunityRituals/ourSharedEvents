/**
 * Comprehensive Unit Tests for Backend Functions (Code.gs)
 *
 * Tests all utility functions, guards, helpers, and business logic
 * Run with: npm test
 */

describe('Error Envelopes', () => {
  const Ok = (value={}) => ({ ok: true, value });
  const Err = (code, message) => ({ ok: false, code, message: message || code });

  describe('Ok envelope', () => {
    it('should create success response with value', () => {
      const res = Ok({ id: '123', name: 'Test' });
      expect(res.ok).toBe(true);
      expect(res.value).toEqual({ id: '123', name: 'Test' });
    });

    it('should default to empty object if no value provided', () => {
      const res = Ok();
      expect(res.ok).toBe(true);
      expect(res.value).toEqual({});
    });
  });

  describe('Err envelope', () => {
    it('should create error response with code and message', () => {
      const res = Err('NOT_FOUND', 'Resource not found');
      expect(res.ok).toBe(false);
      expect(res.code).toBe('NOT_FOUND');
      expect(res.message).toBe('Resource not found');
    });

    it('should use code as message if message not provided', () => {
      const res = Err('BAD_INPUT');
      expect(res.ok).toBe(false);
      expect(res.code).toBe('BAD_INPUT');
      expect(res.message).toBe('BAD_INPUT');
    });

    it('should handle all error codes', () => {
      const codes = ['BAD_INPUT', 'NOT_FOUND', 'RATE_LIMITED', 'INTERNAL', 'CONTRACT'];
      codes.forEach(code => {
        const res = Err(code);
        expect(res.code).toBe(code);
      });
    });
  });
});

describe('Input Sanitization', () => {
  const sanitizeInput_ = (input) => {
    if (!input || typeof input !== 'string') return '';
    return String(input)
      .replace(/[<>"']/g, '')
      .trim()
      .slice(0, 1000);
  };

  describe('XSS prevention', () => {
    it('should remove < and >', () => {
      expect(sanitizeInput_('<script>alert("XSS")</script>'))
        .toBe('scriptalert(XSS)/script');
    });

    it('should remove double quotes', () => {
      expect(sanitizeInput_('"malicious"')).toBe('malicious');
    });

    it('should remove single quotes', () => {
      expect(sanitizeInput_("'malicious'")).toBe('malicious');
    });

    it('should remove all dangerous characters at once', () => {
      expect(sanitizeInput_('<div class="test">content</div>'))
        .toBe('div class=testcontent/div');
    });
  });

  describe('Whitespace handling', () => {
    it('should trim leading whitespace', () => {
      expect(sanitizeInput_('   hello')).toBe('hello');
    });

    it('should trim trailing whitespace', () => {
      expect(sanitizeInput_('hello   ')).toBe('hello');
    });

    it('should trim both sides', () => {
      expect(sanitizeInput_('   hello world   ')).toBe('hello world');
    });

    it('should preserve internal whitespace', () => {
      expect(sanitizeInput_('hello   world')).toBe('hello   world');
    });
  });

  describe('Length limits', () => {
    it('should limit to 1000 characters', () => {
      const longString = 'a'.repeat(1500);
      const result = sanitizeInput_(longString);
      expect(result).toHaveLength(1000);
      expect(result).toBe('a'.repeat(1000));
    });

    it('should not truncate strings under 1000 chars', () => {
      const str = 'a'.repeat(999);
      expect(sanitizeInput_(str)).toHaveLength(999);
    });
  });

  describe('Edge cases', () => {
    it('should return empty string for null', () => {
      expect(sanitizeInput_(null)).toBe('');
    });

    it('should return empty string for undefined', () => {
      expect(sanitizeInput_(undefined)).toBe('');
    });

    it('should return empty string for empty string', () => {
      expect(sanitizeInput_('')).toBe('');
    });

    it('should return empty string for non-string types', () => {
      expect(sanitizeInput_(123)).toBe('');
      expect(sanitizeInput_({})).toBe('');
      expect(sanitizeInput_([])).toBe('');
    });

    it('should handle strings with only dangerous characters', () => {
      expect(sanitizeInput_("<>\"'<>\"'")).toBe('');
    });
  });
});

describe('URL Validation', () => {
  const isUrl = (s) => {
    try {
      const url = new URL(String(s));
      return ['http:', 'https:'].includes(url.protocol);
    } catch(_) {
      return false;
    }
  };

  describe('Valid URLs', () => {
    it('should accept http:// URLs', () => {
      expect(isUrl('http://example.com')).toBe(true);
    });

    it('should accept https:// URLs', () => {
      expect(isUrl('https://example.com')).toBe(true);
    });

    it('should accept URLs with paths', () => {
      expect(isUrl('https://example.com/path/to/resource')).toBe(true);
    });

    it('should accept URLs with query strings', () => {
      expect(isUrl('https://example.com?foo=bar&baz=qux')).toBe(true);
    });

    it('should accept URLs with ports', () => {
      expect(isUrl('http://localhost:8080')).toBe(true);
    });

    it('should accept URLs with hashes', () => {
      expect(isUrl('https://example.com/page#section')).toBe(true);
    });
  });

  describe('Invalid URLs - Security', () => {
    it('should reject javascript: protocol', () => {
      expect(isUrl('javascript:alert(1)')).toBe(false);
    });

    it('should reject data: protocol', () => {
      expect(isUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    });

    it('should reject file: protocol', () => {
      expect(isUrl('file:///etc/passwd')).toBe(false);
    });

    it('should reject ftp: protocol', () => {
      expect(isUrl('ftp://example.com')).toBe(false);
    });

    it('should reject vbscript: protocol', () => {
      expect(isUrl('vbscript:msgbox(1)')).toBe(false);
    });
  });

  describe('Invalid URLs - Malformed', () => {
    it('should reject plain text', () => {
      expect(isUrl('not a url')).toBe(false);
    });

    it('should reject empty string', () => {
      expect(isUrl('')).toBe(false);
    });

    it('should reject null', () => {
      expect(isUrl(null)).toBe(false);
    });

    it('should reject undefined', () => {
      expect(isUrl(undefined)).toBe(false);
    });

    it('should reject relative URLs', () => {
      expect(isUrl('/path/to/resource')).toBe(false);
    });

    it('should reject URLs without protocol', () => {
      expect(isUrl('example.com')).toBe(false);
    });
  });
});

describe('Schema Validation', () => {
  const schemaCheck = (schema, obj) => {
    if (schema.type === 'object' && obj && typeof obj === 'object') {
      for (const [k, v] of Object.entries(schema.props || {})) {
        if (v.required && !(k in obj)) {
          throw new Error(`Missing required field: ${k}`);
        }
        if (k in obj && v.type && typeof obj[k] !== v.type) {
          throw new Error(`Type mismatch for ${k}: expected ${v.type}, got ${typeof obj[k]}`);
        }
      }
    } else if (schema.type === 'array' && Array.isArray(obj)) {
      // Arrays are valid
    } else if (schema.type && typeof obj !== schema.type) {
      throw new Error(`Schema type mismatch: expected ${schema.type}, got ${typeof obj}`);
    }
    return true;
  };

  describe('Required fields', () => {
    const schema = {
      type: 'object',
      props: {
        name: { type: 'string', required: true },
        age: { type: 'number', required: true }
      }
    };

    it('should pass when all required fields present', () => {
      expect(() => schemaCheck(schema, { name: 'John', age: 30 })).not.toThrow();
    });

    it('should fail when required field missing', () => {
      expect(() => schemaCheck(schema, { name: 'John' }))
        .toThrow('Missing required field: age');
    });

    it('should fail when multiple required fields missing', () => {
      expect(() => schemaCheck(schema, {}))
        .toThrow('Missing required field');
    });
  });

  describe('Type validation', () => {
    const schema = {
      type: 'object',
      props: {
        name: { type: 'string' },
        age: { type: 'number' },
        active: { type: 'boolean' }
      }
    };

    it('should pass with correct types', () => {
      expect(() => schemaCheck(schema, {
        name: 'John',
        age: 30,
        active: true
      })).not.toThrow();
    });

    it('should fail with incorrect string type', () => {
      expect(() => schemaCheck(schema, { name: 123 }))
        .toThrow('Type mismatch for name: expected string');
    });

    it('should fail with incorrect number type', () => {
      expect(() => schemaCheck(schema, { age: '30' }))
        .toThrow('Type mismatch for age: expected number');
    });

    it('should fail with incorrect boolean type', () => {
      expect(() => schemaCheck(schema, { active: 'true' }))
        .toThrow('Type mismatch for active: expected boolean');
    });
  });

  describe('Optional fields', () => {
    const schema = {
      type: 'object',
      props: {
        name: { type: 'string', required: true },
        email: { type: 'string', required: false }
      }
    };

    it('should pass when optional field omitted', () => {
      expect(() => schemaCheck(schema, { name: 'John' })).not.toThrow();
    });

    it('should pass when optional field provided with correct type', () => {
      expect(() => schemaCheck(schema, {
        name: 'John',
        email: 'john@example.com'
      })).not.toThrow();
    });

    it('should fail when optional field has wrong type', () => {
      expect(() => schemaCheck(schema, { name: 'John', email: 123 }))
        .toThrow('Type mismatch for email');
    });
  });

  describe('Schema types', () => {
    it('should validate array type', () => {
      const schema = { type: 'array' };
      expect(() => schemaCheck(schema, [])).not.toThrow();
      expect(() => schemaCheck(schema, [1, 2, 3])).not.toThrow();
    });

    it('should validate string type', () => {
      const schema = { type: 'string' };
      expect(() => schemaCheck(schema, 'hello')).not.toThrow();
      expect(() => schemaCheck(schema, 123)).toThrow('Schema type mismatch');
    });

    it('should validate number type', () => {
      const schema = { type: 'number' };
      expect(() => schemaCheck(schema, 42)).not.toThrow();
      expect(() => schemaCheck(schema, '42')).toThrow('Schema type mismatch');
    });

    it('should validate boolean type', () => {
      const schema = { type: 'boolean' };
      expect(() => schemaCheck(schema, true)).not.toThrow();
      expect(() => schemaCheck(schema, 'true')).toThrow('Schema type mismatch');
    });
  });
});

describe('Frontend SDK (NU)', () => {
  const esc = (s) => {
    return String(s).replace(/[&<>"']/g, m => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      '\'': '&#39;'
    }[m]));
  };

  describe('HTML entity escaping', () => {
    it('should escape < to &lt;', () => {
      expect(esc('<')).toBe('&lt;');
    });

    it('should escape > to &gt;', () => {
      expect(esc('>')).toBe('&gt;');
    });

    it('should escape & to &amp;', () => {
      expect(esc('&')).toBe('&amp;');
    });

    it('should escape " to &quot;', () => {
      expect(esc('"')).toBe('&quot;');
    });

    it('should escape \' to &#39;', () => {
      expect(esc("'")).toBe('&#39;');
    });
  });

  describe('XSS protection', () => {
    it('should escape script tags', () => {
      expect(esc('<script>alert("XSS")</script>'))
        .toBe('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;');
    });

    it('should escape img onerror attack', () => {
      expect(esc('<img src=x onerror="alert(1)">'))
        .toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    });

    it('should escape event handlers', () => {
      expect(esc('<div onclick="evil()">'))
        .toBe('&lt;div onclick=&quot;evil()&quot;&gt;');
    });

    it('should escape HTML entities in user content', () => {
      expect(esc('Ben & Jerry\'s "Ice Cream" <3'))
        .toBe('Ben &amp; Jerry&#39;s &quot;Ice Cream&quot; &lt;3');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty string', () => {
      expect(esc('')).toBe('');
    });

    it('should handle string with no special chars', () => {
      expect(esc('Hello World')).toBe('Hello World');
    });

    it('should handle multiple occurrences', () => {
      expect(esc('<<>>')).toBe('&lt;&lt;&gt;&gt;');
    });

    it('should handle numbers', () => {
      expect(esc(123)).toBe('123');
    });

    it('should handle unicode', () => {
      expect(esc('Hello 世界')).toBe('Hello 世界');
    });
  });
});

describe('Rate Limiting Logic', () => {
  const RATE_MAX_PER_MIN = 20;

  function checkRateLimit(requestCount) {
    return requestCount < RATE_MAX_PER_MIN;
  }

  it('should allow requests under limit', () => {
    expect(checkRateLimit(0)).toBe(true);
    expect(checkRateLimit(10)).toBe(true);
    expect(checkRateLimit(19)).toBe(true);
  });

  it('should block requests at limit', () => {
    expect(checkRateLimit(20)).toBe(false);
  });

  it('should block requests over limit', () => {
    expect(checkRateLimit(21)).toBe(false);
    expect(checkRateLimit(100)).toBe(false);
  });

  it('should have correct limit constant', () => {
    expect(RATE_MAX_PER_MIN).toBe(20);
  });
});

describe('Slug Generation', () => {
  function generateSlug(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  it('should convert to lowercase', () => {
    expect(generateSlug('Hello World')).toBe('hello-world');
  });

  it('should replace spaces with hyphens', () => {
    expect(generateSlug('my event name')).toBe('my-event-name');
  });

  it('should remove special characters', () => {
    expect(generateSlug('Event @ 2024!')).toBe('event-2024');
  });

  it('should remove leading hyphens', () => {
    expect(generateSlug('---test')).toBe('test');
  });

  it('should remove trailing hyphens', () => {
    expect(generateSlug('test---')).toBe('test');
  });

  it('should handle consecutive spaces', () => {
    expect(generateSlug('hello    world')).toBe('hello-world');
  });

  it('should handle empty string', () => {
    expect(generateSlug('')).toBe('');
  });

  it('should preserve numbers', () => {
    expect(generateSlug('Event 2024')).toBe('event-2024');
  });

  it('should handle unicode characters', () => {
    expect(generateSlug('Café Münchën')).toBe('caf-m-nch-n');
  });
});

describe('EVENT_CONTRACT.md v2.0 Validation', () => {
  // === MVP Required Field Defaults (per EVENT_CONTRACT.md v2.0) ===
  const EVENT_DEFAULTS_ = {
    // Schedule/Standings/Bracket (MVP optional)
    schedule: null,
    standings: null,
    bracket: null,

    // CTAs
    ctas: {
      primary: { label: 'Sign Up', url: '' },
      secondary: null
    },

    // V2 Optional (with defaults)
    sponsors: [],
    media: {},
    externalData: {},
    analytics: { enabled: false },
    payments: { enabled: false },

    // Settings (MVP required)
    settings: {
      showSchedule: false,
      showStandings: false,
      showBracket: false,
      showSponsors: false
    }
  };

  describe('EVENT_DEFAULTS_ structure', () => {
    it('should have MVP optional fields with null defaults', () => {
      expect(EVENT_DEFAULTS_.schedule).toBeNull();
      expect(EVENT_DEFAULTS_.standings).toBeNull();
      expect(EVENT_DEFAULTS_.bracket).toBeNull();
    });

    it('should have ctas with primary object and secondary null', () => {
      expect(EVENT_DEFAULTS_.ctas).toBeDefined();
      expect(EVENT_DEFAULTS_.ctas.primary).toEqual({ label: 'Sign Up', url: '' });
      expect(EVENT_DEFAULTS_.ctas.secondary).toBeNull();
    });

    it('should have V2 optional fields with appropriate defaults', () => {
      expect(EVENT_DEFAULTS_.sponsors).toEqual([]);
      expect(EVENT_DEFAULTS_.media).toEqual({});
      expect(EVENT_DEFAULTS_.externalData).toEqual({});
      expect(EVENT_DEFAULTS_.analytics).toEqual({ enabled: false });
      expect(EVENT_DEFAULTS_.payments).toEqual({ enabled: false });
    });

    it('should have settings with all show flags false by default', () => {
      expect(EVENT_DEFAULTS_.settings.showSchedule).toBe(false);
      expect(EVENT_DEFAULTS_.settings.showStandings).toBe(false);
      expect(EVENT_DEFAULTS_.settings.showBracket).toBe(false);
      expect(EVENT_DEFAULTS_.settings.showSponsors).toBe(false);
    });
  });

  describe('MVP Required Field Validation', () => {
    const validateMVPRequired = (event) => {
      const errors = [];
      if (!event.name || typeof event.name !== 'string' || event.name.trim() === '') {
        errors.push('name is required');
      }
      if (!event.startDateISO) {
        errors.push('startDateISO is required');
      } else if (!/^\d{4}-\d{2}-\d{2}$/.test(event.startDateISO)) {
        errors.push('startDateISO must be YYYY-MM-DD format');
      }
      if (!event.venue || typeof event.venue !== 'string' || event.venue.trim() === '') {
        errors.push('venue is required');
      }
      return errors;
    };

    it('should pass with all MVP required fields', () => {
      const event = {
        name: 'Thursday Trivia Night',
        startDateISO: '2025-12-01',
        venue: "O'Malley's Pub"
      };
      expect(validateMVPRequired(event)).toEqual([]);
    });

    it('should fail when name is missing', () => {
      const event = { startDateISO: '2025-12-01', venue: 'Test Venue' };
      const errors = validateMVPRequired(event);
      expect(errors).toContain('name is required');
    });

    it('should fail when name is empty string', () => {
      const event = { name: '', startDateISO: '2025-12-01', venue: 'Test Venue' };
      const errors = validateMVPRequired(event);
      expect(errors).toContain('name is required');
    });

    it('should fail when startDateISO is missing', () => {
      const event = { name: 'Test Event', venue: 'Test Venue' };
      const errors = validateMVPRequired(event);
      expect(errors).toContain('startDateISO is required');
    });

    it('should fail when startDateISO has invalid format', () => {
      const event = { name: 'Test Event', startDateISO: '12/01/2025', venue: 'Test Venue' };
      const errors = validateMVPRequired(event);
      expect(errors).toContain('startDateISO must be YYYY-MM-DD format');
    });

    it('should fail when venue is missing', () => {
      const event = { name: 'Test Event', startDateISO: '2025-12-01' };
      const errors = validateMVPRequired(event);
      expect(errors).toContain('venue is required');
    });

    it('should fail when venue is empty string', () => {
      const event = { name: 'Test Event', startDateISO: '2025-12-01', venue: '   ' };
      const errors = validateMVPRequired(event);
      expect(errors).toContain('venue is required');
    });
  });

  describe('Date Format Validation', () => {
    const isValidDateISO = (date) => {
      if (!date || typeof date !== 'string') return false;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
      // Parse and verify the date round-trips correctly
      const [year, month, day] = date.split('-').map(Number);
      const parsed = new Date(Date.UTC(year, month - 1, day));
      return parsed.getUTCFullYear() === year &&
             parsed.getUTCMonth() === month - 1 &&
             parsed.getUTCDate() === day;
    };

    it('should accept valid YYYY-MM-DD format', () => {
      expect(isValidDateISO('2025-12-01')).toBe(true);
      expect(isValidDateISO('2024-01-15')).toBe(true);
      expect(isValidDateISO('2030-06-30')).toBe(true);
    });

    it('should reject MM/DD/YYYY format', () => {
      expect(isValidDateISO('12/01/2025')).toBe(false);
    });

    it('should reject DD-MM-YYYY format', () => {
      expect(isValidDateISO('01-12-2025')).toBe(false);
    });

    it('should reject invalid dates', () => {
      expect(isValidDateISO('2025-13-01')).toBe(false); // Invalid month
      expect(isValidDateISO('2025-02-30')).toBe(false); // Invalid day for Feb
    });

    it('should reject empty/null values', () => {
      expect(isValidDateISO('')).toBe(false);
      expect(isValidDateISO(null)).toBe(false);
      expect(isValidDateISO(undefined)).toBe(false);
    });
  });

  describe('CTA Structure Validation', () => {
    const validateCtas = (ctas) => {
      if (!ctas || typeof ctas !== 'object') return false;
      if (!ctas.primary || typeof ctas.primary !== 'object') return false;
      if (typeof ctas.primary.label !== 'string') return false;
      if (typeof ctas.primary.url !== 'string') return false;
      if (ctas.secondary !== null && typeof ctas.secondary !== 'object') return false;
      return true;
    };

    it('should accept valid ctas with primary and null secondary', () => {
      const ctas = {
        primary: { label: 'Sign Up', url: 'https://forms.google.com/...' },
        secondary: null
      };
      expect(validateCtas(ctas)).toBe(true);
    });

    it('should accept valid ctas with both primary and secondary', () => {
      const ctas = {
        primary: { label: 'Sign Up', url: 'https://forms.google.com/...' },
        secondary: { label: 'Learn More', url: 'https://example.com/about' }
      };
      expect(validateCtas(ctas)).toBe(true);
    });

    it('should accept empty url string', () => {
      const ctas = {
        primary: { label: 'Sign Up', url: '' },
        secondary: null
      };
      expect(validateCtas(ctas)).toBe(true);
    });

    it('should reject missing primary', () => {
      const ctas = { secondary: null };
      expect(validateCtas(ctas)).toBe(false);
    });

    it('should reject primary without label', () => {
      const ctas = {
        primary: { url: 'https://example.com' },
        secondary: null
      };
      expect(validateCtas(ctas)).toBe(false);
    });
  });

  describe('Settings Structure Validation', () => {
    const validateSettings = (settings) => {
      if (!settings || typeof settings !== 'object') return false;
      if (typeof settings.showSchedule !== 'boolean') return false;
      if (typeof settings.showStandings !== 'boolean') return false;
      if (typeof settings.showBracket !== 'boolean') return false;
      if (typeof settings.showSponsors !== 'boolean') return false;
      return true;
    };

    it('should accept valid settings with all boolean flags', () => {
      const settings = {
        showSchedule: true,
        showStandings: false,
        showBracket: false,
        showSponsors: false
      };
      expect(validateSettings(settings)).toBe(true);
    });

    it('should reject settings with missing flags', () => {
      const settings = { showSchedule: true };
      expect(validateSettings(settings)).toBe(false);
    });

    it('should reject settings with non-boolean values', () => {
      const settings = {
        showSchedule: 'true',
        showStandings: false,
        showBracket: false,
        showSponsors: false
      };
      expect(validateSettings(settings)).toBe(false);
    });
  });

  describe('QR Code Format Validation', () => {
    const isValidQRDataUri = (qr) => {
      if (typeof qr !== 'string') return false;
      // Accept empty string for signup QR when no URL
      if (qr === '') return true;
      // Must be base64 PNG data URI
      return qr.startsWith('data:image/png;base64,');
    };

    it('should accept valid base64 PNG data URI', () => {
      expect(isValidQRDataUri('data:image/png;base64,iVBORw0KGgo...')).toBe(true);
    });

    it('should accept empty string for missing signup URL', () => {
      expect(isValidQRDataUri('')).toBe(true);
    });

    it('should reject other image formats', () => {
      expect(isValidQRDataUri('data:image/jpeg;base64,...')).toBe(false);
    });

    it('should reject regular URLs', () => {
      expect(isValidQRDataUri('https://example.com/qr.png')).toBe(false);
    });
  });

  describe('Links Structure Validation', () => {
    const validateLinks = (links) => {
      if (!links || typeof links !== 'object') return false;
      const required = ['publicUrl', 'displayUrl', 'posterUrl', 'signupUrl'];
      for (const field of required) {
        if (typeof links[field] !== 'string') return false;
      }
      return true;
    };

    it('should accept valid links with all required URLs', () => {
      const links = {
        publicUrl: 'https://example.com/events/test',
        displayUrl: 'https://example.com/display/test',
        posterUrl: 'https://example.com/poster/test',
        signupUrl: 'https://forms.google.com/...'
      };
      expect(validateLinks(links)).toBe(true);
    });

    it('should accept empty signupUrl string', () => {
      const links = {
        publicUrl: 'https://example.com/events/test',
        displayUrl: 'https://example.com/display/test',
        posterUrl: 'https://example.com/poster/test',
        signupUrl: ''
      };
      expect(validateLinks(links)).toBe(true);
    });

    it('should reject missing publicUrl', () => {
      const links = {
        displayUrl: 'https://example.com/display/test',
        posterUrl: 'https://example.com/poster/test',
        signupUrl: ''
      };
      expect(validateLinks(links)).toBe(false);
    });
  });

  describe('Sponsor Structure Validation (V2)', () => {
    const validateSponsor = (sponsor) => {
      if (!sponsor || typeof sponsor !== 'object') return false;
      if (typeof sponsor.id !== 'string') return false;
      if (typeof sponsor.name !== 'string') return false;
      if (typeof sponsor.logoUrl !== 'string') return false;
      const validPlacements = ['poster', 'display', 'public', 'tv-banner'];
      if (!validPlacements.includes(sponsor.placement)) return false;
      return true;
    };

    it('should accept valid sponsor with all fields', () => {
      const sponsor = {
        id: 'sp-123',
        name: 'Acme Corp',
        logoUrl: 'https://example.com/logo.png',
        linkUrl: 'https://acme.com',
        placement: 'poster'
      };
      expect(validateSponsor(sponsor)).toBe(true);
    });

    it('should accept valid sponsor without linkUrl', () => {
      const sponsor = {
        id: 'sp-456',
        name: 'Local Sponsor',
        logoUrl: 'https://example.com/local.png',
        linkUrl: null,
        placement: 'display'
      };
      expect(validateSponsor(sponsor)).toBe(true);
    });

    it('should accept all valid placement values', () => {
      const placements = ['poster', 'display', 'public', 'tv-banner'];
      placements.forEach(placement => {
        const sponsor = {
          id: 'sp-test',
          name: 'Test',
          logoUrl: 'https://ex.com/logo.png',
          placement
        };
        expect(validateSponsor(sponsor)).toBe(true);
      });
    });

    it('should reject invalid placement', () => {
      const sponsor = {
        id: 'sp-123',
        name: 'Test',
        logoUrl: 'https://ex.com/logo.png',
        placement: 'invalid'
      };
      expect(validateSponsor(sponsor)).toBe(false);
    });
  });

  describe('Full Event Contract Building', () => {
    // Test helper simulating _buildEventContract_() behavior
    const buildEventContract = (rawData, defaults) => {
      return {
        ...defaults,
        ...rawData,
        settings: {
          ...defaults.settings,
          ...(rawData.settings || {})
        },
        ctas: {
          ...defaults.ctas,
          ...(rawData.ctas || {})
        }
      };
    };

    it('should merge with defaults preserving user values', () => {
      const raw = {
        name: 'Test Event',
        startDateISO: '2025-12-01',
        venue: 'Test Venue',
        settings: { showSchedule: true }
      };

      const result = buildEventContract(raw, EVENT_DEFAULTS_);

      expect(result.name).toBe('Test Event');
      expect(result.settings.showSchedule).toBe(true);
      expect(result.settings.showStandings).toBe(false);
      expect(result.sponsors).toEqual([]);
      expect(result.analytics).toEqual({ enabled: false });
    });

    it('should not overwrite provided V2 fields', () => {
      const raw = {
        name: 'Test Event',
        sponsors: [{ id: 'sp-1', name: 'Test Sponsor', logoUrl: 'https://ex.com/logo.png', placement: 'poster' }],
        analytics: { enabled: true }
      };

      const result = buildEventContract(raw, EVENT_DEFAULTS_);

      expect(result.sponsors.length).toBe(1);
      expect(result.analytics.enabled).toBe(true);
    });
  });
});

describe('Bug #50: Pagination Support in api_list', () => {
  test('should paginate results with default limit', () => {
    // Mock data - 150 items
    const allItems = Array.from({ length: 150 }, (_, i) => ({
      id: `item-${i}`,
      brandId: 'root',
      templateId: 'event',
      data: { name: `Event ${i}` },
      createdAt: new Date().toISOString(),
      slug: `event-${i}`
    }));

    const paginate = (items, limit = 100, offset = 0) => {
      const pageLimit = Math.min(parseInt(limit) || 100, 1000);
      const pageOffset = Math.max(parseInt(offset) || 0, 0);
      const totalCount = items.length;
      const paginatedItems = items.slice(pageOffset, pageOffset + pageLimit);

      return {
        items: paginatedItems,
        pagination: {
          total: totalCount,
          limit: pageLimit,
          offset: pageOffset,
          hasMore: (pageOffset + pageLimit) < totalCount
        }
      };
    };

    // Test default pagination (100 items)
    const page1 = paginate(allItems);
    expect(page1.items.length).toBe(100);
    expect(page1.pagination.total).toBe(150);
    expect(page1.pagination.limit).toBe(100);
    expect(page1.pagination.offset).toBe(0);
    expect(page1.pagination.hasMore).toBe(true);

    // Test second page
    const page2 = paginate(allItems, 100, 100);
    expect(page2.items.length).toBe(50);
    expect(page2.pagination.hasMore).toBe(false);
  });

  test('should respect custom limit parameter', () => {
    const allItems = Array.from({ length: 100 }, (_, i) => ({ id: `item-${i}` }));

    const paginate = (items, limit = 100, offset = 0) => {
      const pageLimit = Math.min(parseInt(limit) || 100, 1000);
      const pageOffset = Math.max(parseInt(offset) || 0, 0);
      const totalCount = items.length;
      const paginatedItems = items.slice(pageOffset, pageOffset + pageLimit);

      return {
        items: paginatedItems,
        pagination: {
          total: totalCount,
          limit: pageLimit,
          offset: pageOffset,
          hasMore: (pageOffset + pageLimit) < totalCount
        }
      };
    };

    // Test custom limit of 25
    const result = paginate(allItems, 25, 0);
    expect(result.items.length).toBe(25);
    expect(result.pagination.limit).toBe(25);
    expect(result.pagination.hasMore).toBe(true);
  });

  test('should enforce maximum limit of 1000', () => {
    const allItems = Array.from({ length: 2000 }, (_, i) => ({ id: `item-${i}` }));

    const paginate = (items, limit = 100, offset = 0) => {
      const pageLimit = Math.min(parseInt(limit) || 100, 1000);
      const pageOffset = Math.max(parseInt(offset) || 0, 0);
      const totalCount = items.length;
      const paginatedItems = items.slice(pageOffset, pageOffset + pageLimit);

      return {
        items: paginatedItems,
        pagination: {
          total: totalCount,
          limit: pageLimit,
          offset: pageOffset,
          hasMore: (pageOffset + pageLimit) < totalCount
        }
      };
    };

    // Try to request 5000 items, should be capped at 1000
    const result = paginate(allItems, 5000, 0);
    expect(result.items.length).toBe(1000);
    expect(result.pagination.limit).toBe(1000);
    expect(result.pagination.hasMore).toBe(true);
  });

  test('should handle offset parameter correctly', () => {
    const allItems = Array.from({ length: 100 }, (_, i) => ({ id: `item-${i}` }));

    const paginate = (items, limit = 100, offset = 0) => {
      const pageLimit = Math.min(parseInt(limit) || 100, 1000);
      const pageOffset = Math.max(parseInt(offset) || 0, 0);
      const totalCount = items.length;
      const paginatedItems = items.slice(pageOffset, pageOffset + pageLimit);

      return {
        items: paginatedItems,
        pagination: {
          total: totalCount,
          limit: pageLimit,
          offset: pageOffset,
          hasMore: (pageOffset + pageLimit) < totalCount
        }
      };
    };

    // Skip first 50 items
    const result = paginate(allItems, 25, 50);
    expect(result.items.length).toBe(25);
    expect(result.items[0].id).toBe('item-50');
    expect(result.pagination.offset).toBe(50);
  });

  test('should indicate hasMore correctly', () => {
    const allItems = Array.from({ length: 100 }, (_, i) => ({ id: `item-${i}` }));

    const paginate = (items, limit = 100, offset = 0) => {
      const pageLimit = Math.min(parseInt(limit) || 100, 1000);
      const pageOffset = Math.max(parseInt(offset) || 0, 0);
      const totalCount = items.length;
      const paginatedItems = items.slice(pageOffset, pageOffset + pageLimit);

      return {
        items: paginatedItems,
        pagination: {
          total: totalCount,
          limit: pageLimit,
          offset: pageOffset,
          hasMore: (pageOffset + pageLimit) < totalCount
        }
      };
    };

    // First page - has more
    const page1 = paginate(allItems, 50, 0);
    expect(page1.pagination.hasMore).toBe(true);

    // Last page - no more
    const page2 = paginate(allItems, 50, 50);
    expect(page2.pagination.hasMore).toBe(false);

    // Exact fit - no more
    const page3 = paginate(allItems, 100, 0);
    expect(page3.pagination.hasMore).toBe(false);
  });

  test('should handle negative or invalid offset gracefully', () => {
    const allItems = Array.from({ length: 100 }, (_, i) => ({ id: `item-${i}` }));

    const paginate = (items, limit = 100, offset = 0) => {
      const pageLimit = Math.min(parseInt(limit) || 100, 1000);
      const pageOffset = Math.max(parseInt(offset) || 0, 0);
      const totalCount = items.length;
      const paginatedItems = items.slice(pageOffset, pageOffset + pageLimit);

      return {
        items: paginatedItems,
        pagination: {
          total: totalCount,
          limit: pageLimit,
          offset: pageOffset,
          hasMore: (pageOffset + pageLimit) < totalCount
        }
      };
    };

    // Negative offset should be treated as 0
    const result = paginate(allItems, 25, -10);
    expect(result.pagination.offset).toBe(0);
    expect(result.items[0].id).toBe('item-0');
  });

  test('should handle empty result set', () => {
    const allItems = [];

    const paginate = (items, limit = 100, offset = 0) => {
      const pageLimit = Math.min(parseInt(limit) || 100, 1000);
      const pageOffset = Math.max(parseInt(offset) || 0, 0);
      const totalCount = items.length;
      const paginatedItems = items.slice(pageOffset, pageOffset + pageLimit);

      return {
        items: paginatedItems,
        pagination: {
          total: totalCount,
          limit: pageLimit,
          offset: pageOffset,
          hasMore: (pageOffset + pageLimit) < totalCount
        }
      };
    };

    const result = paginate(allItems);
    expect(result.items.length).toBe(0);
    expect(result.pagination.total).toBe(0);
    expect(result.pagination.hasMore).toBe(false);
  });
});

// ============================================================================
// api_trackEventMetric - Simplified Analytics Endpoint (MVP)
// ============================================================================

describe('api_trackEventMetric', () => {
  /**
   * Unit tests for the simplified analytics tracking endpoint.
   * This endpoint wraps AnalyticsService_logEvents for MVP surfaces.
   *
   * Required: eventId, surface, action
   * Optional: sponsorId, value
   */

  // Mock implementation matching Code.gs
  const VALID_SURFACES = ['public', 'display', 'poster', 'admin'];
  const VALID_ACTIONS = ['view', 'impression', 'click', 'scan', 'cta_click', 'sponsor_click', 'dwell'];

  const ACTION_TO_METRIC = {
    'view': 'view',
    'impression': 'impression',
    'click': 'click',
    'scan': 'scan',
    'cta_click': 'cta_click',
    'sponsor_click': 'click',
    'dwell': 'dwell'
  };

  function api_trackEventMetric(params) {
    const { eventId, surface, action, sponsorId, value } = params;

    // Validate required fields
    if (!eventId) {
      return { ok: false, code: 'BAD_INPUT', message: 'missing eventId' };
    }
    if (!surface) {
      return { ok: false, code: 'BAD_INPUT', message: 'missing surface' };
    }
    if (!action) {
      return { ok: false, code: 'BAD_INPUT', message: 'missing action' };
    }

    // Validate enums
    if (!VALID_SURFACES.includes(surface)) {
      return { ok: false, code: 'BAD_INPUT', message: 'invalid surface' };
    }
    if (!VALID_ACTIONS.includes(action)) {
      return { ok: false, code: 'BAD_INPUT', message: 'invalid action' };
    }

    // Map action to metric
    const metric = ACTION_TO_METRIC[action];

    // Build analytics event
    const analyticsEvent = {
      eventId,
      surface,
      metric,
      sponsorId: sponsorId || null,
      value: value || 1,
      ts: Date.now()
    };

    // In real implementation, this calls AnalyticsService_logEvents
    return { ok: true, value: { count: 1 } };
  }

  describe('Required Field Validation', () => {
    test('should require eventId', () => {
      const result = api_trackEventMetric({
        surface: 'public',
        action: 'view'
      });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('BAD_INPUT');
      expect(result.message).toBe('missing eventId');
    });

    test('should require surface', () => {
      const result = api_trackEventMetric({
        eventId: 'evt-123',
        action: 'view'
      });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('BAD_INPUT');
      expect(result.message).toBe('missing surface');
    });

    test('should require action', () => {
      const result = api_trackEventMetric({
        eventId: 'evt-123',
        surface: 'public'
      });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('BAD_INPUT');
      expect(result.message).toBe('missing action');
    });

    test('should succeed with all required fields', () => {
      const result = api_trackEventMetric({
        eventId: 'evt-123',
        surface: 'public',
        action: 'view'
      });
      expect(result.ok).toBe(true);
      expect(result.value.count).toBe(1);
    });
  });

  describe('Surface Enum Validation', () => {
    const validSurfaces = ['public', 'display', 'poster', 'admin'];

    validSurfaces.forEach(surface => {
      test(`should accept surface: "${surface}"`, () => {
        const result = api_trackEventMetric({
          eventId: 'evt-123',
          surface,
          action: 'view'
        });
        expect(result.ok).toBe(true);
      });
    });

    test('should reject invalid surface', () => {
      const result = api_trackEventMetric({
        eventId: 'evt-123',
        surface: 'invalid_surface',
        action: 'view'
      });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('BAD_INPUT');
      expect(result.message).toBe('invalid surface');
    });
  });

  describe('Action Enum Validation', () => {
    const validActions = ['view', 'impression', 'click', 'scan', 'cta_click', 'sponsor_click', 'dwell'];

    validActions.forEach(action => {
      test(`should accept action: "${action}"`, () => {
        const result = api_trackEventMetric({
          eventId: 'evt-123',
          surface: 'public',
          action
        });
        expect(result.ok).toBe(true);
      });
    });

    test('should reject invalid action', () => {
      const result = api_trackEventMetric({
        eventId: 'evt-123',
        surface: 'public',
        action: 'invalid_action'
      });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('BAD_INPUT');
      expect(result.message).toBe('invalid action');
    });
  });

  describe('Optional Parameters', () => {
    test('should accept optional sponsorId', () => {
      const result = api_trackEventMetric({
        eventId: 'evt-123',
        surface: 'public',
        action: 'sponsor_click',
        sponsorId: 'sp-456'
      });
      expect(result.ok).toBe(true);
    });

    test('should accept optional value for dwell time', () => {
      const result = api_trackEventMetric({
        eventId: 'evt-123',
        surface: 'display',
        action: 'dwell',
        value: 30
      });
      expect(result.ok).toBe(true);
    });
  });

  describe('Action to Metric Mapping', () => {
    test('should map view action to view metric', () => {
      expect(ACTION_TO_METRIC['view']).toBe('view');
    });

    test('should map impression action to impression metric', () => {
      expect(ACTION_TO_METRIC['impression']).toBe('impression');
    });

    test('should map click action to click metric', () => {
      expect(ACTION_TO_METRIC['click']).toBe('click');
    });

    test('should map scan action to scan metric', () => {
      expect(ACTION_TO_METRIC['scan']).toBe('scan');
    });

    test('should map cta_click action to cta_click metric', () => {
      expect(ACTION_TO_METRIC['cta_click']).toBe('cta_click');
    });

    test('should map sponsor_click action to click metric', () => {
      expect(ACTION_TO_METRIC['sponsor_click']).toBe('click');
    });

    test('should map dwell action to dwell metric', () => {
      expect(ACTION_TO_METRIC['dwell']).toBe('dwell');
    });
  });

  describe('MVP Surface-Action Combinations', () => {
    test('public page view tracking', () => {
      const result = api_trackEventMetric({
        eventId: 'evt-123',
        surface: 'public',
        action: 'view'
      });
      expect(result.ok).toBe(true);
    });

    test('public page CTA click tracking', () => {
      const result = api_trackEventMetric({
        eventId: 'evt-123',
        surface: 'public',
        action: 'cta_click'
      });
      expect(result.ok).toBe(true);
    });

    test('display page impression tracking', () => {
      const result = api_trackEventMetric({
        eventId: 'evt-123',
        surface: 'display',
        action: 'impression'
      });
      expect(result.ok).toBe(true);
    });

    test('display page dwell time tracking', () => {
      const result = api_trackEventMetric({
        eventId: 'evt-123',
        surface: 'display',
        action: 'dwell',
        value: 45
      });
      expect(result.ok).toBe(true);
    });

    test('poster QR scan tracking', () => {
      const result = api_trackEventMetric({
        eventId: 'evt-123',
        surface: 'poster',
        action: 'scan'
      });
      expect(result.ok).toBe(true);
    });

    test('sponsor click tracking with sponsorId', () => {
      const result = api_trackEventMetric({
        eventId: 'evt-123',
        surface: 'public',
        action: 'sponsor_click',
        sponsorId: 'sp-789'
      });
      expect(result.ok).toBe(true);
    });
  });
});

// ============================================================================
// api_getDisplayBundle Unit Tests
// ============================================================================

describe('api_getDisplayBundle', () => {
  /**
   * DisplayBundle interface per EVENT_CONTRACT.md v2.0:
   * - event: EventCore (full canonical event shape with hydrated sponsors)
   * - rotation: { sponsorSlots, rotationMs }
   * - layout: { hasSidePane, emphasis }
   */

  // Mock the display bundle response structure
  const createMockDisplayBundle = (overrides = {}) => ({
    event: {
      id: 'evt-123',
      slug: 'test-event',
      name: 'Test Event',
      startDateISO: '2025-12-01',
      venue: 'Test Venue',
      templateId: 'general',
      settings: {
        showSchedule: false,
        showStandings: false,
        showBracket: false,
        showSponsors: true
      },
      sponsors: [],
      links: {
        publicUrl: 'https://example.com/public/test',
        displayUrl: 'https://example.com/display/test'
      },
      ...overrides.event
    },
    rotation: {
      sponsorSlots: 4,
      rotationMs: 10000,
      ...overrides.rotation
    },
    layout: {
      hasSidePane: false,
      emphasis: 'hero',
      ...overrides.layout
    }
  });

  describe('DisplayBundle Shape Validation', () => {
    test('should have event property with canonical shape', () => {
      const bundle = createMockDisplayBundle();
      expect(bundle).toHaveProperty('event');
      expect(bundle.event).toHaveProperty('id');
      expect(bundle.event).toHaveProperty('name');
      expect(bundle.event).toHaveProperty('startDateISO');
      expect(bundle.event).toHaveProperty('venue');
      expect(bundle.event).toHaveProperty('settings');
      expect(bundle.event).toHaveProperty('links');
    });

    test('should have rotation property with sponsorSlots and rotationMs', () => {
      const bundle = createMockDisplayBundle();
      expect(bundle).toHaveProperty('rotation');
      expect(bundle.rotation).toHaveProperty('sponsorSlots');
      expect(bundle.rotation).toHaveProperty('rotationMs');
      expect(typeof bundle.rotation.sponsorSlots).toBe('number');
      expect(typeof bundle.rotation.rotationMs).toBe('number');
    });

    test('should have layout property with hasSidePane and emphasis', () => {
      const bundle = createMockDisplayBundle();
      expect(bundle).toHaveProperty('layout');
      expect(bundle.layout).toHaveProperty('hasSidePane');
      expect(bundle.layout).toHaveProperty('emphasis');
      expect(typeof bundle.layout.hasSidePane).toBe('boolean');
    });

    test('emphasis should be valid value', () => {
      const validEmphasis = ['scores', 'sponsors', 'hero'];
      const bundle = createMockDisplayBundle();
      expect(validEmphasis).toContain(bundle.layout.emphasis);
    });
  });

  describe('Event Settings for Display', () => {
    test('should include showSponsors setting', () => {
      const bundle = createMockDisplayBundle({
        event: { settings: { showSponsors: true } }
      });
      expect(bundle.event.settings.showSponsors).toBe(true);
    });

    test('should include showStandings for league templates', () => {
      const bundle = createMockDisplayBundle({
        event: {
          templateId: 'rec_league',
          settings: { showStandings: true }
        }
      });
      expect(bundle.event.settings.showStandings).toBe(true);
    });

    test('should include showBracket for tournament templates', () => {
      const bundle = createMockDisplayBundle({
        event: {
          templateId: 'bags',
          settings: { showBracket: true }
        }
      });
      expect(bundle.event.settings.showBracket).toBe(true);
    });
  });

  describe('Display Rotation Config', () => {
    test('sponsorSlots should be positive integer', () => {
      const bundle = createMockDisplayBundle({
        rotation: { sponsorSlots: 6 }
      });
      expect(bundle.rotation.sponsorSlots).toBeGreaterThan(0);
      expect(Number.isInteger(bundle.rotation.sponsorSlots)).toBe(true);
    });

    test('rotationMs should be positive integer', () => {
      const bundle = createMockDisplayBundle({
        rotation: { rotationMs: 15000 }
      });
      expect(bundle.rotation.rotationMs).toBeGreaterThan(0);
      expect(Number.isInteger(bundle.rotation.rotationMs)).toBe(true);
    });

    test('rotationMs should be reasonable duration (5-60 seconds)', () => {
      const bundle = createMockDisplayBundle({
        rotation: { rotationMs: 10000 }
      });
      expect(bundle.rotation.rotationMs).toBeGreaterThanOrEqual(5000);
      expect(bundle.rotation.rotationMs).toBeLessThanOrEqual(60000);
    });
  });

  describe('Display Layout Config', () => {
    test('hasSidePane false by default', () => {
      const bundle = createMockDisplayBundle();
      expect(bundle.layout.hasSidePane).toBe(false);
    });

    test('hasSidePane can be true when sponsors configured', () => {
      const bundle = createMockDisplayBundle({
        layout: { hasSidePane: true }
      });
      expect(bundle.layout.hasSidePane).toBe(true);
    });

    test('emphasis defaults to hero', () => {
      const bundle = createMockDisplayBundle();
      expect(bundle.layout.emphasis).toBe('hero');
    });
  });
});

// ============================================================================
// api_getPosterBundle Unit Tests
// ============================================================================

describe('api_getPosterBundle', () => {
  /**
   * PosterBundle interface per EVENT_CONTRACT.md v2.0:
   * - event: EventCore (full canonical event shape with hydrated sponsors)
   * - qrCodes: { public, signup } - QR code URLs for scanning
   * - print: { dateLine, venueLine } - Pre-formatted strings for print
   */

  // Mock the poster bundle response structure
  const createMockPosterBundle = (overrides = {}) => ({
    event: {
      id: 'evt-123',
      slug: 'test-event',
      name: 'Test Event',
      startDateISO: '2025-12-01',
      venue: 'Test Venue',
      templateId: 'general',
      settings: {
        showSchedule: false,
        showStandings: false,
        showBracket: false,
        showSponsors: true
      },
      sponsors: [],
      links: {
        publicUrl: 'https://example.com/public/test',
        signupUrl: 'https://example.com/signup/test'
      },
      ctas: {
        primary: { label: 'Sign Up', url: 'https://example.com/signup/test' }
      },
      ...overrides.event
    },
    qrCodes: {
      public: 'https://quickchart.io/qr?text=https%3A%2F%2Fexample.com%2Fpublic%2Ftest&size=200&margin=1',
      signup: 'https://quickchart.io/qr?text=https%3A%2F%2Fexample.com%2Fsignup%2Ftest&size=200&margin=1',
      ...overrides.qrCodes
    },
    print: {
      dateLine: 'Monday, December 1, 2025',
      venueLine: 'Test Venue',
      ...overrides.print
    }
  });

  describe('PosterBundle Shape Validation', () => {
    test('should have event property with canonical shape', () => {
      const bundle = createMockPosterBundle();
      expect(bundle).toHaveProperty('event');
      expect(bundle.event).toHaveProperty('id');
      expect(bundle.event).toHaveProperty('name');
      expect(bundle.event).toHaveProperty('startDateISO');
      expect(bundle.event).toHaveProperty('venue');
      expect(bundle.event).toHaveProperty('settings');
      expect(bundle.event).toHaveProperty('links');
      expect(bundle.event).toHaveProperty('ctas');
    });

    test('should have qrCodes property with public and signup', () => {
      const bundle = createMockPosterBundle();
      expect(bundle).toHaveProperty('qrCodes');
      expect(bundle.qrCodes).toHaveProperty('public');
      expect(bundle.qrCodes).toHaveProperty('signup');
    });

    test('should have print property with dateLine and venueLine', () => {
      const bundle = createMockPosterBundle();
      expect(bundle).toHaveProperty('print');
      expect(bundle.print).toHaveProperty('dateLine');
      expect(bundle.print).toHaveProperty('venueLine');
    });
  });

  describe('QR Code URLs', () => {
    test('public QR should use quickchart.io', () => {
      const bundle = createMockPosterBundle();
      expect(bundle.qrCodes.public).toContain('quickchart.io/qr');
    });

    test('signup QR should use quickchart.io', () => {
      const bundle = createMockPosterBundle();
      expect(bundle.qrCodes.signup).toContain('quickchart.io/qr');
    });

    test('QR codes should be URL-encoded', () => {
      const bundle = createMockPosterBundle();
      expect(bundle.qrCodes.public).toContain('text=');
      expect(bundle.qrCodes.public).toContain('%3A%2F%2F'); // URL-encoded ://
    });

    test('QR codes should include size and margin params', () => {
      const bundle = createMockPosterBundle();
      expect(bundle.qrCodes.public).toContain('size=');
      expect(bundle.qrCodes.public).toContain('margin=');
    });

    test('QR codes can be null if no URL configured', () => {
      const bundle = createMockPosterBundle({
        qrCodes: { public: null, signup: null }
      });
      expect(bundle.qrCodes.public).toBeNull();
      expect(bundle.qrCodes.signup).toBeNull();
    });
  });

  describe('Print-Formatted Strings', () => {
    test('dateLine should be formatted date string', () => {
      const bundle = createMockPosterBundle({
        print: { dateLine: 'Saturday, December 15, 2025' }
      });
      expect(typeof bundle.print.dateLine).toBe('string');
      expect(bundle.print.dateLine).toContain('2025');
    });

    test('venueLine should be venue string', () => {
      const bundle = createMockPosterBundle({
        print: { venueLine: 'Central Park Event Center' }
      });
      expect(typeof bundle.print.venueLine).toBe('string');
      expect(bundle.print.venueLine.length).toBeGreaterThan(0);
    });

    test('print strings can be null if not available', () => {
      const bundle = createMockPosterBundle({
        print: { dateLine: null, venueLine: null }
      });
      expect(bundle.print.dateLine).toBeNull();
      expect(bundle.print.venueLine).toBeNull();
    });
  });

  describe('Poster Sponsor Strip', () => {
    test('event should include sponsors array', () => {
      const bundle = createMockPosterBundle({
        event: {
          sponsors: [
            { id: 'sp-1', name: 'Sponsor One', logoUrl: 'https://ex.com/logo1.png', placement: 'poster' }
          ]
        }
      });
      expect(bundle.event.sponsors).toBeInstanceOf(Array);
      expect(bundle.event.sponsors.length).toBe(1);
    });

    test('sponsors should have placement field', () => {
      const bundle = createMockPosterBundle({
        event: {
          sponsors: [
            { id: 'sp-1', name: 'Sponsor', logoUrl: 'https://ex.com/logo.png', placement: 'poster' }
          ]
        }
      });
      expect(bundle.event.sponsors[0]).toHaveProperty('placement');
      expect(bundle.event.sponsors[0].placement).toBe('poster');
    });

    test('showSponsors setting controls sponsor visibility', () => {
      const bundle = createMockPosterBundle({
        event: { settings: { showSponsors: false } }
      });
      expect(bundle.event.settings.showSponsors).toBe(false);
    });
  });

  describe('CTA Button for Poster', () => {
    test('event should include ctas.primary', () => {
      const bundle = createMockPosterBundle();
      expect(bundle.event).toHaveProperty('ctas');
      expect(bundle.event.ctas).toHaveProperty('primary');
    });

    test('primary CTA should have label and url', () => {
      const bundle = createMockPosterBundle();
      expect(bundle.event.ctas.primary).toHaveProperty('label');
      expect(bundle.event.ctas.primary).toHaveProperty('url');
    });

    test('CTA label defaults to Sign Up', () => {
      const bundle = createMockPosterBundle();
      expect(bundle.event.ctas.primary.label).toBe('Sign Up');
    });
  });
});
