#!/usr/bin/env node
/**
 * guard-no-gas.js - Security Guard: No Google Apps Script Dependencies
 *
 * Scans the repository for any Google Apps Script (GAS) dependencies or drift.
 * This guard FAILS the CI build if any forbidden GAS patterns are detected.
 *
 * Architectural Invariant: This MVP uses a Worker-only backend.
 * No GAS runtime dependencies are permitted.
 *
 * @see docs/security/NO_GAS_GUARD.md
 */

const fs = require('fs');
const path = require('path');

// ============================================================================
// CONFIGURATION
// ============================================================================

// Root directory to scan (can be overridden via GUARD_NO_GAS_ROOT env var)
const ROOT_DIR = process.env.GUARD_NO_GAS_ROOT || process.cwd();

// Directories to skip
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.wrangler',
  '.turbo',
  '.next',
  'coverage',
  '.test-results',
  'playwright-report',
  'playwright-report-api',
  'playwright-report-smoke',
  'playwright-report-pages',
  'playwright-report-flows',
  'archive', // Historical/archived code - not active
  'workflow-archive', // Archived workflows
  '.security-reports', // Historical security reports
  'postman', // Postman collections with test data
  'schemas', // JSON schemas with example data
  'tests', // Test files with test patterns
]);

// Files/patterns to skip (documentation files are excluded by default)
// These are legitimate documentation that may reference GAS for historical context
const SKIP_PATTERNS = [
  /\.md$/i, // Markdown files are documentation
  /^\.clasp.*\.json$/, // Clasp config files (GAS tooling - covered by allowlist)
  /\.gs$/, // GAS source files (legitimately contain GAS code)
  /\.test\.js$/, // Test files (may contain test patterns)
  /\.test\.ts$/, // TypeScript test files
  /\.spec\.js$/, // Spec files (may contain test patterns)
  /\.spec\.ts$/, // TypeScript spec files
];

// File extensions to scan (note: .md is excluded via SKIP_PATTERNS as documentation)
const SCANNABLE_EXTENSIONS = new Set([
  '.js',
  '.ts',
  '.tsx',
  '.json',
  '.yml',
  '.yaml',
  '.toml',
  '.html',
  '.css',
]);

// Also scan files that start with .env
const SCAN_ENV_FILES = true;

// Allowlist file path
const ALLOWLIST_PATH =
  process.env.GUARD_NO_GAS_ALLOWLIST ||
  path.join(ROOT_DIR, 'scripts', 'guard-no-gas.allowlist.json');

// ============================================================================
// FORBIDDEN PATTERNS
// ============================================================================

/**
 * Forbidden patterns that indicate GAS dependency or drift.
 * Each pattern has a description for clear error messages.
 */
const FORBIDDEN_PATTERNS = [
  // A) Forbidden domains/URLs
  {
    pattern: /script\.google\.com/gi,
    token: 'script.google.com',
    description: 'GAS deployment URL',
    category: 'domain',
  },

  // B) Forbidden env/config keys
  {
    pattern: /GAS_BASE_URL/g,
    token: 'GAS_BASE_URL',
    description: 'GAS environment variable',
    category: 'env',
  },

  // C) Forbidden code patterns (GAS APIs)
  {
    pattern: /\bdoGet\b/g,
    token: 'doGet',
    description: 'GAS HTTP handler function',
    category: 'code',
  },
  {
    pattern: /\bContentService\b/g,
    token: 'ContentService',
    description: 'GAS ContentService API',
    category: 'code',
  },
  {
    pattern: /\bSpreadsheetApp\b/g,
    token: 'SpreadsheetApp',
    description: 'GAS SpreadsheetApp API',
    category: 'code',
  },
  {
    pattern: /\bPropertiesService\b/g,
    token: 'PropertiesService',
    description: 'GAS PropertiesService API',
    category: 'code',
  },
  {
    pattern: /\bclasp\b/gi,
    token: 'clasp',
    description: 'GAS deployment tool (clasp)',
    category: 'tool',
  },
  {
    pattern: /action=api_/g,
    token: 'action=api_',
    description: 'GAS doGet action parameter pattern',
    category: 'code',
  },
  {
    pattern: /google\.script\.run/g,
    token: 'google.script.run',
    description: 'GAS client-side API call',
    category: 'code',
  },
  {
    pattern: /\bScriptApp\b/g,
    token: 'ScriptApp',
    description: 'GAS ScriptApp API',
    category: 'code',
  },
  {
    pattern: /\bUrlFetchApp\b/g,
    token: 'UrlFetchApp',
    description: 'GAS UrlFetchApp API',
    category: 'code',
  },
];

// ============================================================================
// ALLOWLIST HANDLING
// ============================================================================

/**
 * Load the allowlist from JSON file.
 * Returns an object with file paths as keys and arrays of allowed tokens as values.
 *
 * Example allowlist format:
 * {
 *   "docs/architecture/legacy-gas-notes.md": ["SpreadsheetApp", "doGet"],
 *   "scripts/guard-no-gas.js": ["*"]  // Wildcard: allow all in this file
 * }
 */
function loadAllowlist() {
  try {
    if (!fs.existsSync(ALLOWLIST_PATH)) {
      // No allowlist file = no exceptions (fail-closed)
      return {};
    }
    const content = fs.readFileSync(ALLOWLIST_PATH, 'utf-8');
    const parsed = JSON.parse(content);

    // Validate structure
    if (typeof parsed !== 'object' || parsed === null) {
      console.error(`[guard-no-gas] ERROR: Invalid allowlist format in ${ALLOWLIST_PATH}`);
      console.error('Expected: { "file/path": ["token1", "token2"] }');
      process.exit(1);
    }

    return parsed;
  } catch (err) {
    console.error(`[guard-no-gas] ERROR: Failed to load allowlist: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Check if a finding is allowlisted.
 */
function isAllowlisted(allowlist, filePath, token) {
  // Normalize path to be relative to ROOT_DIR AND use forward slashes so the
  // lookup matches the allowlist JSON (which always uses forward slashes for
  // cross-platform stability). Without the `.replace(/\\/g, '/')`, the entire
  // allowlist was silently inert on Windows runners — every path with a
  // backslash separator missed every entry — producing 137 false-positive
  // findings against a fully-allowlisted codebase.
  const relativePath = path.relative(ROOT_DIR, filePath).replace(/\\/g, '/');

  const allowedTokens = allowlist[relativePath];
  if (!allowedTokens) {
    return false;
  }

  // Check for wildcard or specific token
  if (allowedTokens.includes('*') || allowedTokens.includes(token)) {
    return true;
  }

  return false;
}

// ============================================================================
// FILE SCANNING
// ============================================================================

/**
 * Check if a file is binary by looking for null bytes in first 1KB.
 */
function isBinaryFile(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(1024);
    const bytesRead = fs.readSync(fd, buffer, 0, 1024, 0);
    fs.closeSync(fd);

    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0) {
        return true;
      }
    }
    return false;
  } catch {
    // If we can't read the file, skip it
    return true;
  }
}

/**
 * Check if a file should be scanned based on extension and name.
 */
function shouldScanFile(filePath) {
  const basename = path.basename(filePath);
  const ext = path.extname(filePath);

  // Check skip patterns first (documentation, config files)
  for (const pattern of SKIP_PATTERNS) {
    if (pattern.test(basename)) {
      return false;
    }
  }

  // Check if it's an env file
  if (SCAN_ENV_FILES && basename.startsWith('.env')) {
    return true;
  }

  // Check extension
  if (SCANNABLE_EXTENSIONS.has(ext)) {
    return true;
  }

  return false;
}

/**
 * Recursively collect all files to scan.
 */
function collectFiles(dir, files = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.error(`[guard-no-gas] ERROR: Cannot read directory ${dir}: ${err.message}`);
    process.exit(1);
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        collectFiles(fullPath, files);
      }
    } else if (entry.isFile()) {
      if (shouldScanFile(fullPath) && !isBinaryFile(fullPath)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

/**
 * Scan a single file for forbidden patterns.
 * Returns array of findings.
 */
function scanFile(filePath, allowlist) {
  const findings = [];
  let content;

  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    console.error(`[guard-no-gas] ERROR: Cannot read file ${filePath}: ${err.message}`);
    process.exit(1);
  }

  const lines = content.split('\n');

  for (const { pattern, token, description, category } of FORBIDDEN_PATTERNS) {
    // Reset regex state
    pattern.lastIndex = 0;

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum];
      pattern.lastIndex = 0;

      let match;
      while ((match = pattern.exec(line)) !== null) {
        // Check if allowlisted
        if (isAllowlisted(allowlist, filePath, token)) {
          continue;
        }

        // Create snippet (trimmed to 80 chars)
        const snippet = line.trim().slice(0, 80);

        findings.push({
          // Same forward-slash normalization as isAllowlisted() — keeps
          // findings output stable across Windows + POSIX so allowlist
          // matching, log scraping, and test assertions all read the same
          // path shape regardless of host OS.
          file: path.relative(ROOT_DIR, filePath).replace(/\\/g, '/'),
          line: lineNum + 1,
          column: match.index + 1,
          token,
          description,
          category,
          snippet,
        });
      }
    }
  }

  return findings;
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

function main() {
  console.log('');
  console.log('==================================================');
  console.log('  guard-no-gas: Google Apps Script Dependency Guard');
  console.log('==================================================');
  console.log('');
  console.log(`Scanning: ${ROOT_DIR}`);
  console.log(`Allowlist: ${ALLOWLIST_PATH}`);
  console.log('');

  // Load allowlist
  const allowlist = loadAllowlist();
  const allowlistCount = Object.keys(allowlist).length;
  if (allowlistCount > 0) {
    console.log(`Loaded ${allowlistCount} allowlist entries`);
  }

  // Collect files to scan
  const files = collectFiles(ROOT_DIR);
  console.log(`Found ${files.length} files to scan`);
  console.log('');

  // Scan all files
  const allFindings = [];
  for (const file of files) {
    const findings = scanFile(file, allowlist);
    allFindings.push(...findings);
  }

  // Report results
  if (allFindings.length === 0) {
    console.log('==================================================');
    console.log('  ✅ guard-no-gas passed');
    console.log('==================================================');
    console.log('');
    console.log('No Google Apps Script dependencies detected.');
    console.log('');
    process.exit(0);
  }

  // Failure case
  console.log('==================================================');
  console.log('  ❌ guard-no-gas failed');
  console.log('==================================================');
  console.log('');
  console.log(`Found ${allFindings.length} forbidden GAS pattern(s):`);
  console.log('');

  // Group findings by file
  const byFile = {};
  for (const finding of allFindings) {
    if (!byFile[finding.file]) {
      byFile[finding.file] = [];
    }
    byFile[finding.file].push(finding);
  }

  // Output findings
  for (const [file, findings] of Object.entries(byFile)) {
    console.log(`📄 ${file}`);
    for (const f of findings) {
      console.log(`   Line ${f.line}: ${f.token} (${f.description})`);
      console.log(`   └─ ${f.snippet}`);
    }
    console.log('');
  }

  console.log('--------------------------------------------------');
  console.log('Summary:');
  console.log(`  Total findings: ${allFindings.length}`);
  console.log(`  Files affected: ${Object.keys(byFile).length}`);
  console.log('');
  console.log('Guidance:');
  console.log('  Remove GAS dependency or add a documented allowlist exception.');
  console.log('  See: docs/security/NO_GAS_GUARD.md');
  console.log('');
  console.log('  To add an allowlist exception, edit:');
  console.log('    scripts/guard-no-gas.allowlist.json');
  console.log('');
  console.log('  ⚠️  Only documentation/spec references should be allowlisted.');
  console.log('  ⚠️  Production code with GAS dependencies is NOT acceptable.');
  console.log('--------------------------------------------------');
  console.log('');

  process.exit(1);
}

// Run if executed directly
if (require.main === module) {
  main();
}

// Export for testing
module.exports = {
  FORBIDDEN_PATTERNS,
  IGNORED_DIRS,
  SCANNABLE_EXTENSIONS,
  SKIP_PATTERNS,
  loadAllowlist,
  isAllowlisted,
  isBinaryFile,
  shouldScanFile,
  collectFiles,
  scanFile,
};
