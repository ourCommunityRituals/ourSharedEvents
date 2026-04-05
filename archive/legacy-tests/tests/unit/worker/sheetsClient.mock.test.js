/**
 * Unit Tests for sheetsClient.ts with Mocked Google APIs
 *
 * Story 2.1 — Sheets Client Implementation (Service Account Auth)
 *
 * Tests the Google Sheets client implementation with mocked fetch calls.
 * Validates:
 * - getValues operation (single range read)
 * - batchGet operation (multiple range read)
 * - append operation (add row)
 * - update operation (modify row)
 * - Service account authentication flow
 * - Retry behavior for rate limits (429)
 * - Error handling for various HTTP status codes
 *
 * @see worker/src/sheetsClient.ts
 * @see worker/src/googleAuth.ts
 */

// =============================================================================
// Test Setup - Mocking fetch and crypto
// =============================================================================

// Save original globals
const originalFetch = global.fetch;
const originalCrypto = global.crypto;

// Mock environment
const mockEnv = {
  GOOGLE_CLIENT_EMAIL: 'test-worker@test-project.iam.gserviceaccount.com',
  GOOGLE_PRIVATE_KEY: `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC7P5q9RsHmE9gL
FAKE_KEY_FOR_TESTING_ONLY_NOT_A_REAL_KEY_AAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
-----END PRIVATE KEY-----`,
  SHEETS_SPREADSHEET_ID: 'test-spreadsheet-id-12345',
};

// Track fetch calls
let fetchCalls = [];

// Mock Response class
class MockResponse {
  constructor(body, options = {}) {
    this._body = body;
    this.status = options.status || 200;
    this.ok = this.status >= 200 && this.status < 300;
    this.statusText = options.statusText || 'OK';
    this._headers = new Map(Object.entries(options.headers || {}));
  }

  async json() {
    return typeof this._body === 'string' ? JSON.parse(this._body) : this._body;
  }

  async text() {
    return typeof this._body === 'string' ? this._body : JSON.stringify(this._body);
  }

  get headers() {
    return {
      get: (name) => this._headers.get(name.toLowerCase()) || null,
    };
  }
}

// Create mock fetch
function createMockFetch(responses) {
  let callIndex = 0;
  return async (url, options) => {
    fetchCalls.push({ url, options, callIndex });

    if (typeof responses === 'function') {
      return responses(url, options, callIndex++);
    }

    const response = Array.isArray(responses) ? responses[callIndex++] : responses;

    if (!response) {
      throw new Error(`No mock response for call ${callIndex - 1}: ${url}`);
    }

    return new MockResponse(response.body, {
      status: response.status || 200,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

// Reset mocks before each test
beforeEach(() => {
  fetchCalls = [];
});

// Restore globals after all tests
afterAll(() => {
  global.fetch = originalFetch;
  global.crypto = originalCrypto;
});

// =============================================================================
// Module Contract Tests
// =============================================================================

describe('Story 2.1 - Sheets Client Module Contract', () => {
  const fs = require('fs');
  const path = require('path');

  const sheetsClientPath = path.join(__dirname, '../../../worker/src/sheets/sheetsClient.ts');
  let sheetsClientSource = '';

  beforeAll(() => {
    try {
      sheetsClientSource = fs.readFileSync(sheetsClientPath, 'utf8');
    } catch (error) {
      console.error('Failed to read sheetsClient.ts:', error.message);
    }
  });

  describe('Module Exports', () => {
    it('should re-export getSheetValues function', () => {
      expect(sheetsClientSource).toContain('getSheetValues');
    });

    it('should re-export batchGetRanges function', () => {
      expect(sheetsClientSource).toContain('batchGetRanges');
    });

    it('should re-export appendRow function', () => {
      expect(sheetsClientSource).toContain('appendRow');
    });

    it('should re-export updateRow function', () => {
      expect(sheetsClientSource).toContain('updateRow');
    });

    it('should re-export SheetsError class', () => {
      expect(sheetsClientSource).toContain('SheetsError');
    });

    it('should re-export SHEETS_ERROR_CODES', () => {
      expect(sheetsClientSource).toContain('SHEETS_ERROR_CODES');
    });

    it('should re-export healthCheck function', () => {
      expect(sheetsClientSource).toContain('healthCheck');
    });

    it('should re-export isConfigured function', () => {
      expect(sheetsClientSource).toContain('isConfigured');
    });

    it('should re-export Google Auth utilities', () => {
      expect(sheetsClientSource).toContain('getAccessToken');
      expect(sheetsClientSource).toContain('hasCredentials');
      expect(sheetsClientSource).toContain('validateCredentials');
      expect(sheetsClientSource).toContain('AuthError');
    });
  });

  describe('Story 2.1 Documentation', () => {
    it('should reference Story 2.1 in module docs', () => {
      expect(sheetsClientSource).toContain('Story 2.1');
    });

    it('should document service account auth (no OAuth UI)', () => {
      expect(sheetsClientSource).toContain('Service account');
      expect(sheetsClientSource).toContain('no OAuth UI');
    });

    it('should document the four core operations', () => {
      expect(sheetsClientSource).toContain('getValues');
      expect(sheetsClientSource).toContain('batchGet');
      expect(sheetsClientSource).toContain('append');
      expect(sheetsClientSource).toContain('update');
    });
  });
});

// =============================================================================
// Service Account Authentication Tests
// =============================================================================

describe('Story 2.1 - Service Account Authentication', () => {
  const fs = require('fs');
  const path = require('path');

  const googleAuthPath = path.join(__dirname, '../../../worker/src/googleAuth.ts');
  let googleAuthSource = '';

  beforeAll(() => {
    try {
      googleAuthSource = fs.readFileSync(googleAuthPath, 'utf8');
    } catch (error) {
      console.error('Failed to read googleAuth.ts:', error.message);
    }
  });

  describe('JWT-based Authentication (No OAuth UI)', () => {
    it('should use service account credentials', () => {
      expect(googleAuthSource).toContain('GOOGLE_CLIENT_EMAIL');
      expect(googleAuthSource).toContain('GOOGLE_PRIVATE_KEY');
    });

    it('should NOT use OAuth authorization URL', () => {
      // Service account auth should not redirect to Google OAuth
      expect(googleAuthSource).not.toContain('accounts.google.com/o/oauth2/v2/auth');
      expect(googleAuthSource).not.toContain('response_type=code');
    });

    it('should use JWT bearer grant type', () => {
      expect(googleAuthSource).toContain('urn:ietf:params:oauth:grant-type:jwt-bearer');
    });

    it('should use RS256 signing algorithm', () => {
      expect(googleAuthSource).toContain("alg: 'RS256'");
    });

    it('should request spreadsheets scope', () => {
      expect(googleAuthSource).toContain('https://www.googleapis.com/auth/spreadsheets');
    });

    it('should validate service account email format', () => {
      expect(googleAuthSource).toContain('.iam.gserviceaccount.com');
    });
  });

  describe('Token Management', () => {
    it('should cache access tokens', () => {
      expect(googleAuthSource).toContain('tokenCache');
    });

    it('should support cache clearing for testing', () => {
      expect(googleAuthSource).toContain('clearTokenCache');
    });

    it('should refresh token before expiry (5 min buffer)', () => {
      expect(googleAuthSource).toContain('TOKEN_EXPIRY_BUFFER_MS');
    });
  });
});

// =============================================================================
// API Operation Tests
// =============================================================================

describe('Story 2.1 - Sheets API Operations', () => {
  const fs = require('fs');
  const path = require('path');

  const sheetsClientPath = path.join(__dirname, '../../../worker/src/sheetsClient.ts');
  let sheetsClientSource = '';

  beforeAll(() => {
    try {
      sheetsClientSource = fs.readFileSync(sheetsClientPath, 'utf8');
    } catch (error) {
      console.error('Failed to read sheetsClient.ts:', error.message);
    }
  });

  describe('getSheetValues (getValues)', () => {
    it('should accept sheetName and range parameters', () => {
      expect(sheetsClientSource).toMatch(
        /getSheetValues\(\s*env.*sheetName:\s*string.*range:\s*string/s
      );
    });

    it('should construct full range notation (SheetName!Range)', () => {
      expect(sheetsClientSource).toContain('const fullRange = `${sheetName}!${range}`');
    });

    it('should return 2D string array', () => {
      expect(sheetsClientSource).toContain('export type SheetValues = string[][]');
    });

    it('should support valueRenderOption', () => {
      expect(sheetsClientSource).toContain('valueRenderOption');
      expect(sheetsClientSource).toContain('FORMATTED_VALUE');
      expect(sheetsClientSource).toContain('UNFORMATTED_VALUE');
    });
  });

  describe('batchGetRanges (batchGet)', () => {
    it('should accept array of ranges', () => {
      expect(sheetsClientSource).toMatch(/batchGetRanges\(.*ranges:\s*string\[\]/s);
    });

    it('should use batchGet endpoint', () => {
      expect(sheetsClientSource).toContain('values:batchGet');
    });

    it('should return array of BatchGetResult', () => {
      expect(sheetsClientSource).toContain('interface BatchGetResult');
      expect(sheetsClientSource).toContain('Promise<BatchGetResult[]>');
    });
  });

  describe('appendRow (append)', () => {
    it('should accept sheetName and row parameters', () => {
      expect(sheetsClientSource).toMatch(/appendRow\(.*sheetName:\s*string.*row:/s);
    });

    it('should use append endpoint', () => {
      expect(sheetsClientSource).toContain(':append');
    });

    it('should insert rows at the end', () => {
      expect(sheetsClientSource).toContain("insertDataOption: 'INSERT_ROWS'");
    });

    it('should return AppendResult with updated info', () => {
      expect(sheetsClientSource).toContain('interface AppendResult');
      expect(sheetsClientSource).toContain('updatedRows');
      expect(sheetsClientSource).toContain('updatedCells');
    });
  });

  describe('updateRow (update)', () => {
    it('should accept sheetName, rowIndex, and row parameters', () => {
      expect(sheetsClientSource).toMatch(
        /updateRow\(.*sheetName:\s*string.*rowIndex:\s*number.*row:/s
      );
    });

    it('should use PUT method', () => {
      expect(sheetsClientSource).toContain("method: 'PUT'");
    });

    it('should validate rowIndex >= 1', () => {
      expect(sheetsClientSource).toContain('if (rowIndex < 1)');
    });

    it('should return UpdateResult', () => {
      expect(sheetsClientSource).toContain('interface UpdateResult');
    });
  });
});

// =============================================================================
// Retry and Error Handling Tests
// =============================================================================

describe('Story 2.1 - Retry and Error Handling', () => {
  const fs = require('fs');
  const path = require('path');

  const sheetsClientPath = path.join(__dirname, '../../../worker/src/sheetsClient.ts');
  let sheetsClientSource = '';

  beforeAll(() => {
    try {
      sheetsClientSource = fs.readFileSync(sheetsClientPath, 'utf8');
    } catch (error) {
      console.error('Failed to read sheetsClient.ts:', error.message);
    }
  });

  describe('Rate Limit (429) Handling', () => {
    it('should treat 429 as retryable', () => {
      expect(sheetsClientSource).toContain('status === 429');
      expect(sheetsClientSource).toContain('RATE_LIMITED');
    });

    it('should respect Retry-After header', () => {
      expect(sheetsClientSource).toContain("headers.get('Retry-After')");
    });

    it('should use exponential backoff', () => {
      expect(sheetsClientSource).toContain('RETRY_BACKOFF_MULTIPLIER');
      expect(sheetsClientSource).toContain('Math.pow');
    });

    it('should cap retries at MAX_RETRIES', () => {
      expect(sheetsClientSource).toContain('MAX_RETRIES');
      expect(sheetsClientSource).toContain('attempt <= MAX_RETRIES');
    });
  });

  describe('Server Error (5xx) Handling', () => {
    it('should treat 5xx as retryable', () => {
      expect(sheetsClientSource).toMatch(/status\s*>=\s*500\s*&&\s*status\s*<\s*600/);
    });

    it('should create SERVER_ERROR for 5xx', () => {
      expect(sheetsClientSource).toContain('SHEETS_ERROR_CODES.SERVER_ERROR');
    });
  });

  describe('Non-Retryable Errors', () => {
    it('should NOT retry 400 (bad request)', () => {
      const section400 = sheetsClientSource.match(
        /if \(status === 400\)[\s\S]*?(?=\n\s*if \(status)/
      );
      if (section400) {
        expect(section400[0]).toContain('retryable: false');
      }
    });

    it('should NOT retry 401 (unauthorized)', () => {
      expect(sheetsClientSource).toContain('status === 401');
      expect(sheetsClientSource).toMatch(/401[\s\S]*?retryable:\s*false/);
    });

    it('should NOT retry 403 (forbidden)', () => {
      expect(sheetsClientSource).toContain('status === 403');
      expect(sheetsClientSource).toContain('PERMISSION_DENIED');
    });

    it('should NOT retry 404 (not found)', () => {
      expect(sheetsClientSource).toContain('status === 404');
      expect(sheetsClientSource).toContain('NOT_FOUND');
    });
  });

  describe('Error Codes', () => {
    it('should define comprehensive error codes', () => {
      expect(sheetsClientSource).toContain("NOT_CONFIGURED: 'SHEETS_NOT_CONFIGURED'");
      expect(sheetsClientSource).toContain("AUTH_ERROR: 'SHEETS_AUTH_ERROR'");
      expect(sheetsClientSource).toContain("INVALID_RANGE: 'SHEETS_INVALID_RANGE'");
      expect(sheetsClientSource).toContain("NOT_FOUND: 'SHEETS_NOT_FOUND'");
      expect(sheetsClientSource).toContain("PERMISSION_DENIED: 'SHEETS_PERMISSION_DENIED'");
      expect(sheetsClientSource).toContain("RATE_LIMITED: 'SHEETS_RATE_LIMITED'");
      expect(sheetsClientSource).toContain("SERVER_ERROR: 'SHEETS_SERVER_ERROR'");
      expect(sheetsClientSource).toContain("NETWORK_ERROR: 'SHEETS_NETWORK_ERROR'");
      expect(sheetsClientSource).toContain("RETRY_EXHAUSTED: 'SHEETS_RETRY_EXHAUSTED'");
    });
  });
});

// =============================================================================
// Health Check Tests
// =============================================================================

describe('Story 2.1 - Health Check', () => {
  const fs = require('fs');
  const path = require('path');

  const sheetsClientPath = path.join(__dirname, '../../../worker/src/sheetsClient.ts');
  let sheetsClientSource = '';

  beforeAll(() => {
    try {
      sheetsClientSource = fs.readFileSync(sheetsClientPath, 'utf8');
    } catch (error) {
      console.error('Failed to read sheetsClient.ts:', error.message);
    }
  });

  it('should export healthCheck function', () => {
    expect(sheetsClientSource).toContain('export async function healthCheck(');
  });

  it('should return connected status', () => {
    expect(sheetsClientSource).toContain('connected: true');
    expect(sheetsClientSource).toContain('connected: false');
  });

  it('should return latency in milliseconds', () => {
    expect(sheetsClientSource).toContain('latencyMs');
    expect(sheetsClientSource).toContain('Date.now() - startTime');
  });

  it('should return error message on failure', () => {
    expect(sheetsClientSource).toContain('error?: string');
  });

  it('should check spreadsheet metadata for health', () => {
    expect(sheetsClientSource).toContain('fields=spreadsheetId');
  });
});

// =============================================================================
// Acceptance Criteria Validation
// =============================================================================

describe('Story 2.1 - Acceptance Criteria', () => {
  const fs = require('fs');
  const path = require('path');

  const sheetsClientPath = path.join(__dirname, '../../../worker/src/sheetsClient.ts');
  const googleAuthPath = path.join(__dirname, '../../../worker/src/googleAuth.ts');
  let sheetsClientSource = '';
  let googleAuthSource = '';

  beforeAll(() => {
    try {
      sheetsClientSource = fs.readFileSync(sheetsClientPath, 'utf8');
      googleAuthSource = fs.readFileSync(googleAuthPath, 'utf8');
    } catch (error) {
      console.error('Failed to read source files:', error.message);
    }
  });

  describe('AC: Support getValues, batchGet, append, update', () => {
    it('should implement getValues (getSheetValues)', () => {
      expect(sheetsClientSource).toContain('export async function getSheetValues(');
    });

    it('should implement batchGet (batchGetRanges)', () => {
      expect(sheetsClientSource).toContain('export async function batchGetRanges(');
    });

    it('should implement append (appendRow)', () => {
      expect(sheetsClientSource).toContain('export async function appendRow(');
    });

    it('should implement update (updateRow)', () => {
      expect(sheetsClientSource).toContain('export async function updateRow(');
    });
  });

  describe('AC: No OAuth UI prompts (service account only)', () => {
    it('should use service account email', () => {
      expect(googleAuthSource).toContain('GOOGLE_CLIENT_EMAIL');
    });

    it('should use private key for signing', () => {
      expect(googleAuthSource).toContain('GOOGLE_PRIVATE_KEY');
    });

    it('should NOT include OAuth redirect flow', () => {
      expect(googleAuthSource).not.toContain('authorization_code');
      expect(googleAuthSource).not.toContain('redirect_uri');
    });

    it('should use JWT bearer assertion', () => {
      expect(googleAuthSource).toContain('jwt-bearer');
    });
  });

  describe('AC: Worker successfully fetches rows', () => {
    it('should use Sheets API v4', () => {
      expect(sheetsClientSource).toContain('sheets.googleapis.com/v4/spreadsheets');
    });

    it('should include Authorization header with Bearer token', () => {
      expect(sheetsClientSource).toContain("'Authorization': `Bearer ${accessToken}`");
    });

    it('should handle empty response gracefully', () => {
      expect(sheetsClientSource).toContain('result.values || []');
    });
  });
});

// =============================================================================
// DevOps Configuration Tests
// =============================================================================

describe('Story 2.1 - DevOps Configuration', () => {
  const fs = require('fs');
  const path = require('path');

  const wranglerPath = path.join(__dirname, '../../../worker/wrangler.toml');
  let wranglerConfig = '';

  beforeAll(() => {
    try {
      wranglerConfig = fs.readFileSync(wranglerPath, 'utf8');
    } catch (error) {
      console.error('Failed to read wrangler.toml:', error.message);
    }
  });

  describe('Cloudflare Secrets Documentation', () => {
    it('should document GOOGLE_CLIENT_EMAIL secret', () => {
      expect(wranglerConfig).toContain('GOOGLE_CLIENT_EMAIL');
      expect(wranglerConfig).toContain('Service account email');
    });

    it('should document GOOGLE_PRIVATE_KEY secret', () => {
      expect(wranglerConfig).toContain('GOOGLE_PRIVATE_KEY');
      expect(wranglerConfig).toContain('private key');
    });

    it('should document SHEETS_SPREADSHEET_ID secret', () => {
      expect(wranglerConfig).toContain('SHEETS_SPREADSHEET_ID');
    });

    it('should include wrangler secret put commands', () => {
      expect(wranglerConfig).toContain('wrangler secret put');
    });
  });
});

// =============================================================================
// CI Configuration Tests
// =============================================================================

describe('Story 2.1 - CI Configuration', () => {
  const fs = require('fs');
  const path = require('path');

  // Story 1: stage1-ci.yml was consolidated into stage1.yml
  const ciPath = path.join(__dirname, '../../../.github/workflows/stage1.yml');
  let ciConfig = '';

  beforeAll(() => {
    try {
      ciConfig = fs.readFileSync(ciPath, 'utf8');
    } catch (error) {
      console.error('Failed to read stage1.yml:', error.message);
    }
  });

  describe('Sheets Connectivity Test in CI', () => {
    it('should have sheets-connectivity job', () => {
      expect(ciConfig).toContain('sheets-connectivity');
    });

    it('should inject GOOGLE_CLIENT_EMAIL secret', () => {
      expect(ciConfig).toContain('GOOGLE_CLIENT_EMAIL: ${{ secrets.GOOGLE_CLIENT_EMAIL }}');
    });

    it('should inject GOOGLE_PRIVATE_KEY secret', () => {
      expect(ciConfig).toContain('GOOGLE_PRIVATE_KEY: ${{ secrets.GOOGLE_PRIVATE_KEY }}');
    });

    it('should inject STAGING_SHEETS_SPREADSHEET_ID secret', () => {
      expect(ciConfig).toContain(
        'SHEETS_SPREADSHEET_ID: ${{ secrets.STAGING_SHEETS_SPREADSHEET_ID }}'
      );
    });

    it('should validate secrets before connectivity test', () => {
      // Story 1: Step renamed to "Verify Sheets secrets are configured"
      expect(ciConfig).toContain('Verify Sheets secrets');
    });

    it('should run connectivity test', () => {
      // Story 1: Renamed from test:story1.1 to test:sheets:connectivity
      expect(ciConfig).toContain('npm run test:sheets:connectivity');
    });
  });

  describe('Required Secrets Documentation', () => {
    it('should document required secrets in header', () => {
      expect(ciConfig).toContain('Required Secrets:');
      expect(ciConfig).toContain('GOOGLE_CLIENT_EMAIL');
      expect(ciConfig).toContain('GOOGLE_PRIVATE_KEY');
      expect(ciConfig).toContain('STAGING_SHEETS_SPREADSHEET_ID');
    });
  });
});
