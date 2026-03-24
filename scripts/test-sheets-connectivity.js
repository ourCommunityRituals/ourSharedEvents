#!/usr/bin/env node
/**
 * Google Sheets Connectivity Test Script
 *
 * Story 1.1: Create Google Service Account & Bind to Sheets
 *
 * Purpose: Verify that the service account credentials can successfully
 * read and write to Google Sheets. This script runs locally and in CI
 * to validate the Sheets pipeline before deployment.
 *
 * Required Environment Variables:
 *   GOOGLE_CLIENT_EMAIL    - Service account email
 *   GOOGLE_PRIVATE_KEY     - Service account private key (PEM format)
 *   SHEETS_SPREADSHEET_ID  - Spreadsheet ID to test against
 *
 * Optional Environment Variables:
 *   SHEETS_TEST_RANGE      - Range to test (default: 'TEST!A1:B2')
 *   VERBOSE                - Enable verbose output
 *
 * Usage:
 *   npm run test:sheets:connectivity
 *
 * Exit Codes:
 *   0 - All tests passed
 *   1 - One or more tests failed
 *   2 - Missing required environment variables
 *
 * @see docs/env/GOOGLE_SERVICE_ACCOUNT_SETUP.md
 */

const { google } = require('googleapis');
const crypto = require('crypto');

// Configuration
const TEST_RANGE = process.env.SHEETS_TEST_RANGE || 'TEST!A1:B2';
const VERBOSE = process.env.VERBOSE === 'true';

/**
 * Logger utility
 */
const log = {
  info: (msg) => console.log(msg),
  verbose: (msg) => VERBOSE && console.log(`  [verbose] ${msg}`),
  success: (msg) => console.log(`  \u2713 ${msg}`),
  error: (msg) => console.error(`  \u2717 ${msg}`),
  step: (num, total, msg) => console.log(`\n[${num}/${total}] ${msg}`)
};

/**
 * Normalize PEM private key by converting escaped newlines to actual newlines
 * GitHub Actions passes secrets with literal \n instead of actual newlines
 * @param {string} key - The private key (possibly with escaped newlines)
 * @returns {string} - The normalized private key with actual newlines
 */
function normalizePemKey(key) {
  if (!key) return key;

  let normalized = key;

  // Remove surrounding quotes if present (from JSON copy-paste)
  if ((normalized.startsWith('"') && normalized.endsWith('"')) ||
      (normalized.startsWith("'") && normalized.endsWith("'"))) {
    normalized = normalized.slice(1, -1);
  }

  // Handle escaped quotes from JSON double-encoding (\" -> ")
  // This happens when the secret is wrapped in extra JSON escaping
  normalized = normalized.replace(/\\"/g, '"');
  normalized = normalized.replace(/\\'/g, "'");

  // After unescaping quotes, try removing surrounding quotes again
  if ((normalized.startsWith('"') && normalized.endsWith('"')) ||
      (normalized.startsWith("'") && normalized.endsWith("'"))) {
    normalized = normalized.slice(1, -1);
  }

  // Handle case where JSON field name is included (e.g., 'private_key": "-----BEGIN...')
  // This can happen when secret is copy-pasted incorrectly from JSON credentials file
  const jsonFieldPatterns = [
    /^["']?private_key["']?\s*:\s*["']/i,  // private_key": " or "private_key": "
    /^["']?key["']?\s*:\s*["']/i           // key": " or "key": "
  ];
  for (const pattern of jsonFieldPatterns) {
    if (pattern.test(normalized)) {
      normalized = normalized.replace(pattern, '');
      // Also remove trailing quote if present
      if (normalized.endsWith('"') || normalized.endsWith("'")) {
        normalized = normalized.slice(0, -1);
      }
      break;
    }
  }

  // Handle triple-escaped newlines first (\\\\n -> \n)
  normalized = normalized.replace(/\\\\\\\\n/g, '\n');

  // Handle double-escaped newlines (\\n -> \n)
  normalized = normalized.replace(/\\\\n/g, '\n');

  // Replace literal \n with actual newlines
  // This handles the common case where GitHub Actions escapes newlines
  normalized = normalized.replace(/\\n/g, '\n');

  // Handle \r\n (Windows line endings)
  normalized = normalized.replace(/\r\n/g, '\n');
  normalized = normalized.replace(/\r/g, '\n');

  // Trim any extra whitespace
  normalized = normalized.trim();

  // Validate basic PEM structure
  if (!normalized.includes('-----BEGIN') || !normalized.includes('-----END')) {
    log.verbose('Warning: Key missing PEM headers after normalization');
  }

  return normalized;
}

/**
 * Validate required environment variables
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateEnvironment() {
  const required = [
    'GOOGLE_CLIENT_EMAIL',
    'GOOGLE_PRIVATE_KEY',
    'SHEETS_SPREADSHEET_ID'
  ];

  const errors = [];

  for (const varName of required) {
    if (!process.env[varName]) {
      errors.push(`Missing required environment variable: ${varName}`);
    }
  }

  // Validate private key format (after normalization)
  if (process.env.GOOGLE_PRIVATE_KEY) {
    const key = normalizePemKey(process.env.GOOGLE_PRIVATE_KEY);
    if (!key.includes('-----BEGIN') || !key.includes('-----END')) {
      errors.push('GOOGLE_PRIVATE_KEY must include PEM headers (-----BEGIN/END PRIVATE KEY-----)');
    }
  }

  // Validate email format - use endsWith() to prevent URL substring bypass attacks
  // Service account emails must end with .iam.gserviceaccount.com
  if (process.env.GOOGLE_CLIENT_EMAIL) {
    const email = process.env.GOOGLE_CLIENT_EMAIL;
    if (!email.includes('@') || !email.endsWith('.iam.gserviceaccount.com')) {
      errors.push('GOOGLE_CLIENT_EMAIL should be a service account email (*.iam.gserviceaccount.com)');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Create a JWT-authenticated Google Sheets client
 * @returns {Promise<{ sheets: any, auth: any }>}
 */
async function createSheetsClient() {
  // Normalize the private key to handle escaped newlines from GitHub Actions
  const privateKey = normalizePemKey(process.env.GOOGLE_PRIVATE_KEY);

  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  // Authorize and get access token
  await auth.authorize();

  const sheets = google.sheets({ version: 'v4', auth });

  return { sheets, auth };
}

/**
 * Test 1: Authenticate and get access token
 * @returns {Promise<{ success: boolean, latencyMs: number, error?: string }>}
 */
async function testAuthentication() {
  const startTime = Date.now();

  try {
    // Normalize the private key to handle escaped newlines from GitHub Actions
    const privateKey = normalizePemKey(process.env.GOOGLE_PRIVATE_KEY);

    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_CLIENT_EMAIL,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    const credentials = await auth.authorize();

    if (!credentials.access_token) {
      return {
        success: false,
        latencyMs: Date.now() - startTime,
        error: 'No access token returned'
      };
    }

    return {
      success: true,
      latencyMs: Date.now() - startTime
    };
  } catch (error) {
    return {
      success: false,
      latencyMs: Date.now() - startTime,
      error: error.message
    };
  }
}

/**
 * Test 2: Read from spreadsheet
 * @param {any} sheets - Sheets API client
 * @returns {Promise<{ success: boolean, latencyMs: number, error?: string, data?: any }>}
 */
async function testRead(sheets) {
  const startTime = Date.now();

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SHEETS_SPREADSHEET_ID,
      range: TEST_RANGE
    });

    return {
      success: true,
      latencyMs: Date.now() - startTime,
      data: response.data.values
    };
  } catch (error) {
    return {
      success: false,
      latencyMs: Date.now() - startTime,
      error: error.message
    };
  }
}

/**
 * Test 3: Write to spreadsheet
 * @param {any} sheets - Sheets API client
 * @returns {Promise<{ success: boolean, latencyMs: number, error?: string, timestamp?: string }>}
 */
async function testWrite(sheets) {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  try {
    // Write to a single cell in the test range
    const writeRange = 'TEST!B1';
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.SHEETS_SPREADSHEET_ID,
      range: writeRange,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[`CI-Test: ${timestamp}`]]
      }
    });

    return {
      success: true,
      latencyMs: Date.now() - startTime,
      timestamp
    };
  } catch (error) {
    return {
      success: false,
      latencyMs: Date.now() - startTime,
      error: error.message
    };
  }
}

/**
 * Test 4: Verify write by reading back
 * @param {any} sheets - Sheets API client
 * @param {string} expectedTimestamp - Expected timestamp from write test
 * @returns {Promise<{ success: boolean, latencyMs: number, error?: string }>}
 */
async function testVerifyWrite(sheets, expectedTimestamp) {
  const startTime = Date.now();

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SHEETS_SPREADSHEET_ID,
      range: 'TEST!B1'
    });

    const value = response.data.values?.[0]?.[0];
    const expectedValue = `CI-Test: ${expectedTimestamp}`;

    if (value !== expectedValue) {
      return {
        success: false,
        latencyMs: Date.now() - startTime,
        error: `Value mismatch. Expected: "${expectedValue}", Got: "${value}"`
      };
    }

    return {
      success: true,
      latencyMs: Date.now() - startTime
    };
  } catch (error) {
    return {
      success: false,
      latencyMs: Date.now() - startTime,
      error: error.message
    };
  }
}

/**
 * Main test runner
 */
async function main() {
  console.log('');
  console.log('==========================================');
  console.log('Google Sheets Connectivity Test');
  console.log('Story 1.1: Service Account Validation');
  console.log('==========================================');

  // Validate environment
  const envValidation = validateEnvironment();
  if (!envValidation.valid) {
    console.log('\nEnvironment validation failed:');
    for (const error of envValidation.errors) {
      log.error(error);
    }
    console.log('\nSee: docs/env/GOOGLE_SERVICE_ACCOUNT_SETUP.md');
    process.exit(2);
  }

  // Print configuration (masked)
  console.log('');
  console.log('Configuration:');
  console.log(`  Service Account: ${process.env.GOOGLE_CLIENT_EMAIL}`);
  console.log(`  Spreadsheet ID:  ${process.env.SHEETS_SPREADSHEET_ID.substring(0, 8)}...`);
  console.log(`  Test Range:      ${TEST_RANGE}`);

  // Debug key format (verbose mode only)
  if (VERBOSE) {
    const rawKey = process.env.GOOGLE_PRIVATE_KEY;
    const normalizedKey = normalizePemKey(rawKey);
    console.log('');
    console.log('  [verbose] Private Key Info:');
    console.log(`    Raw key length:        ${rawKey?.length || 0} chars`);
    console.log(`    Normalized key length: ${normalizedKey?.length || 0} chars`);
    console.log(`    Has escaped newlines:  ${rawKey?.includes('\\n') ? 'YES (will be normalized)' : 'NO'}`);
    console.log(`    Has PEM headers:       ${normalizedKey?.includes('-----BEGIN') ? 'YES' : 'NO'}`);
    console.log(`    First 50 chars:        ${normalizedKey?.substring(0, 50)}...`);

    // Additional diagnostics for key format issues
    const lines = normalizedKey?.split('\n') || [];
    console.log(`    Line count:            ${lines.length}`);
    console.log(`    First line:            ${lines[0]?.substring(0, 40)}...`);
    console.log(`    Last line:             ${lines[lines.length - 1]?.substring(0, 40)}...`);

    // Compute key fingerprint (SHA256 of base64 content) for verification
    try {
      const base64Content = normalizedKey
        .replace(/-----BEGIN PRIVATE KEY-----/g, '')
        .replace(/-----END PRIVATE KEY-----/g, '')
        .replace(/-----BEGIN RSA PRIVATE KEY-----/g, '')
        .replace(/-----END RSA PRIVATE KEY-----/g, '')
        .replace(/\s/g, '');
      const keyFingerprint = crypto.createHash('sha256')
        .update(base64Content)
        .digest('hex')
        .substring(0, 16);
      console.log(`    Key fingerprint:       ${keyFingerprint}...`);
      console.log('    (Compare this fingerprint with your local key to verify match)');
    } catch {
      console.log('    Key fingerprint:       Unable to compute');
    }

    // Check for common issues
    if (rawKey?.startsWith('"') || rawKey?.startsWith("'")) {
      console.log('    Warning: Key starts with quote character');
    }
    if (/^["']?private_key["']?\s*:/i.test(rawKey)) {
      console.log('    Warning: Key includes JSON field name prefix (will be stripped)');
    }
    if (rawKey?.includes('\\\\n')) {
      console.log('    Warning: Key has double-escaped newlines');
    }
    if (lines.length < 20) {
      console.log('    Warning: Key has too few lines (expected ~28 for RSA 2048)');
    }

    // Check for invisible/problematic characters (avoiding control chars in regex for ESLint)
    const controlCharCount = rawKey?.split('').filter(c => {
      const code = c.charCodeAt(0);
      return (code >= 0 && code <= 8) || code === 11 || code === 12 ||
             (code >= 14 && code <= 31) || code === 127;
    }).length || 0;
    if (controlCharCount > 0) {
      console.log(`    Warning: Key contains ${controlCharCount} invisible/control characters`);
    }

    // Check for BOM
    if (rawKey?.charCodeAt(0) === 0xFEFF || rawKey?.startsWith('\uFEFF')) {
      console.log('    Warning: Key starts with BOM (byte order mark)');
    }
  }

  const totalTests = 4;
  const results = [];
  let sheets = null;

  // Test 1: Authentication
  log.step(1, totalTests, 'Getting access token...');
  const authResult = await testAuthentication();
  results.push({ name: 'Authentication', ...authResult });

  if (authResult.success) {
    log.success(`OK (${authResult.latencyMs}ms)`);
  } else {
    log.error(`FAILED: ${authResult.error}`);
    printSummary(results, totalTests);
    process.exit(1);
  }

  // Create sheets client for remaining tests
  const client = await createSheetsClient();
  sheets = client.sheets;

  // Test 2: Read
  log.step(2, totalTests, `Reading test range (${TEST_RANGE})...`);
  const readResult = await testRead(sheets);
  results.push({ name: 'Read', ...readResult });

  if (readResult.success) {
    log.success(`OK (${readResult.latencyMs}ms)`);
    log.verbose(`Data: ${JSON.stringify(readResult.data)}`);
  } else {
    log.error(`FAILED: ${readResult.error}`);
    printSummary(results, totalTests);
    process.exit(1);
  }

  // Test 3: Write
  log.step(3, totalTests, 'Writing timestamp to TEST!B1...');
  const writeResult = await testWrite(sheets);
  results.push({ name: 'Write', ...writeResult });

  if (writeResult.success) {
    log.success(`OK (${writeResult.latencyMs}ms)`);
    log.verbose(`Wrote: CI-Test: ${writeResult.timestamp}`);
  } else {
    log.error(`FAILED: ${writeResult.error}`);
    printSummary(results, totalTests);
    process.exit(1);
  }

  // Test 4: Verify Write
  log.step(4, totalTests, 'Verifying write...');
  const verifyResult = await testVerifyWrite(sheets, writeResult.timestamp);
  results.push({ name: 'Verify Write', ...verifyResult });

  if (verifyResult.success) {
    log.success(`OK (${verifyResult.latencyMs}ms)`);
  } else {
    log.error(`FAILED: ${verifyResult.error}`);
    printSummary(results, totalTests);
    process.exit(1);
  }

  // Print summary
  printSummary(results, totalTests);

  // All tests passed
  console.log('');
  console.log('\u2705 All connectivity tests passed!');
  console.log('');
  process.exit(0);
}

/**
 * Print test results summary
 * @param {Array} results - Test results
 * @param {number} totalTests - Total number of tests
 */
function printSummary(results, totalTests) {
  console.log('');
  console.log('==========================================');
  console.log('Test Summary');
  console.log('==========================================');

  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const totalLatency = results.reduce((sum, r) => sum + r.latencyMs, 0);

  console.log(`  Passed:      ${passed}/${totalTests}`);
  console.log(`  Failed:      ${failed}/${totalTests}`);
  console.log(`  Total Time:  ${totalLatency}ms`);
  console.log('');

  // Detailed results
  for (const result of results) {
    const status = result.success ? '\u2713' : '\u2717';
    console.log(`  ${status} ${result.name} (${result.latencyMs}ms)`);
    if (!result.success && result.error) {
      console.log(`      Error: ${result.error}`);
    }
  }
}

// Error handling
process.on('unhandledRejection', (error) => {
  console.error('\nUnhandled error:', error.message);
  process.exit(1);
});

// Run main
main().catch((error) => {
  console.error('\nFatal error:', error.message);
  process.exit(1);
});
