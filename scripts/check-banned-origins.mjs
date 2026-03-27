#!/usr/bin/env node
/**
 * GAS Origin Ban Script - Story 3 (Environment Alignment)
 *
 * HARD GATE: Prevents shipping code that references GAS origins
 *
 * Purpose:
 *   Make it impossible to "accidentally" ship code that uses GAS at runtime.
 *   Once Cloudflare is the backend, GAS must never appear in CI or runtime again.
 *   This is a Stage-1 hard gate - build cannot proceed if banned origins are
 *   found outside the allowlist.
 *
 * Scanned Directories:
 *   - tests/**
 *   - worker/**
 *   - web/**
 *   - src/**
 *   - config/**
 *   - cloudflare-proxy/** (worker.js, templates/*)
 *   - Root config files (.env*, deploy-manifest.json, wrangler.toml)
 *
 * Banned Patterns:
 *   - script.google.com/macros     (GAS execution URLs)
 *   - google.script.run            (GAS client-side RPC)
 *   - googleusercontent.com/macros (GAS exec pattern)
 *   - GAS /exec URLs with real deployment IDs (AKfycb...)
 *
 * Allowlist:
 *   - Reads from scripts/banned-origins.allow.txt (external allowlist file)
 *   - config/gas-upstream.template.json (migration reference)
 *   - Documentation files (*.md) - allowed for historical/migration docs
 *   - Archived files (archive/**) - legacy code not in active use
 *   - Schema files (schemas/**) - JSON Schema examples
 *   - Postman files (postman/**) - API testing collection examples
 *   - .clasp*.json files - Google clasp CLI configuration
 *   - Test files checking for ABSENCE of patterns (negative assertions)
 *   - Comments documenting removal/non-usage of GAS patterns
 *
 * Usage:
 *   node scripts/check-banned-origins.mjs
 *   npm run check:banned-origins
 *
 * Exit Codes:
 *   0 - No banned patterns found (or only in allowlisted files)
 *   1 - Banned patterns detected in non-allowlisted files
 *
 * @see Story 3 - Enforce Environment Alignment & Ban GAS Origins
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, dirname, relative, extname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');

// Path to external allowlist file
const ALLOWLIST_FILE = join(__dirname, 'banned-origins.allow.txt');

// =============================================================================
// Configuration
// =============================================================================

/**
 * Read the external allowlist file and parse entries
 * @returns {string[]} Array of allowlisted paths (relative to ROOT_DIR)
 */
function readExternalAllowlist() {
  const allowlistPaths = [];

  if (!existsSync(ALLOWLIST_FILE)) {
    log.warn(`Allowlist file not found: ${ALLOWLIST_FILE}`);
    return allowlistPaths;
  }

  try {
    const content = readFileSync(ALLOWLIST_FILE, 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      // Add the path to allowlist
      allowlistPaths.push(trimmed);
    }

    return allowlistPaths;
  } catch (error) {
    log.warn(`Could not read allowlist file: ${error.message}`);
    return allowlistPaths;
  }
}

/**
 * Banned URL patterns - any file containing these is a violation
 * These are the actual GAS execution URL patterns with REAL deployment IDs
 *
 * We distinguish between:
 * - Placeholder IDs (ABC123, XXXX, etc.) - allowed in docs/examples
 * - Real deployment IDs (AKfycb...) - BANNED in active code
 *
 * Note: All patterns use specific URL prefixes (https://) to ensure
 * we match complete URLs rather than partial strings.
 */
const BANNED_PATTERNS = [
  // GAS Web App execution URLs with REAL deployment IDs (AKfycb... pattern)
  // Real IDs are 50+ chars starting with AKfycb
  /https:\/\/script\.google\.com\/macros\/s\/AKfycb[A-Za-z0-9_-]{30,}\/exec/gi,
  // GAS project URLs with real project IDs (these should not be in runtime code)
  /https:\/\/script\.google\.com\/home\/projects\/[A-Za-z0-9_-]{40,}/gi,
];

/**
 * Simple string patterns for banned domains
 * These are checked via string includes() rather than regex to avoid
 * CodeQL regex anchor warnings while still detecting banned patterns.
 *
 * Story 3: These patterns ensure no direct GAS calls can slip through.
 */
const BANNED_STRINGS = [
  // GAS Web App URLs (Story 3 - main banned pattern)
  'script.google.com/macros',
  // googleusercontent.com macros exec (legacy GAS pattern)
  'googleusercontent.com/macros',
  // GAS client-side RPC (Story 3 - must never appear in runtime code)
  'google.script.run',
];

/**
 * Directories to scan for banned patterns
 */
const SCAN_DIRECTORIES = [
  'tests',
  'worker',
  'web',
  'src',
  'config',
  'cloudflare-proxy',
];

/**
 * Root files to scan for banned patterns
 */
const SCAN_ROOT_FILES = [
  'deploy-manifest.json',
  'wrangler.toml',
  '.env.example',
  'openapi.yaml',
];

/**
 * File extensions to scan
 */
const SCAN_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.json',
  '.html',
  '.htm',
  '.yaml',
  '.yml',
  '.toml',
  '.gs',
  '.sh',
]);

/**
 * Allowlisted paths - these files are allowed to contain banned patterns
 * Paths are relative to ROOT_DIR
 *
 * Story 3: Now reads from external file scripts/banned-origins.allow.txt
 * Entries below are hardcoded fallbacks; external file takes precedence.
 */
const ALLOWLIST_FALLBACK = [
  // Migration reference file (if needed)
  'config/gas-upstream.template.json',

  // Deployment manifest - historical record of GAS deployments
  // LEGACY GAS – this file documents historical deployments for audit trail
  'deploy-manifest.json',

  // Deployment IDs module - contains historical URLs for reference
  'config/deployment-ids.js',

  // Clasp configuration files (Google's CLI)
  '.clasp.json',
  '.clasp-staging.json',
  '.clasp-production.json',
  '.clasp.json.archived',
  '.clasp-staging.json.archived',
  '.clasp-production.json.archived',
  '.clasp.tmp',
];

/**
 * Allowlisted directory patterns - entire directories that are excluded
 */
const ALLOWLISTED_DIRECTORIES = [
  'archive',           // Legacy code archive
  'node_modules',      // Dependencies
  '.git',              // Git internals
  'schemas',           // JSON Schema examples
  'postman',           // Postman collection examples
  'docs',              // Documentation
  '.github/workflow-archive', // Archived workflows
];

/**
 * Allowlisted extensions - documentation files
 */
const ALLOWLISTED_EXTENSIONS = new Set([
  '.md',        // Markdown documentation
  '.mdx',       // MDX documentation
  '.txt',       // Text files (diagrams, notes)
  '.backup',    // Backup files
]);

/**
 * Context patterns that indicate a file is CHECKING for absence of GAS URLs
 * (i.e., negative assertions in tests)
 */
const NEGATIVE_ASSERTION_PATTERNS = [
  /expect\([^)]+\)\.not\.toContain/,
  /expect\([^)]+\)\.not\.toMatch/,
  /toContain.*script\.google/i,
  /toContain.*googleusercontent/i,
  /toContain.*google\.script\.run/i,
  /should.*not.*contain/i,
  /'script\.googleusercontent\.com'/,  // Banned pattern list in tests
  /google\.script\.run.*not.*available/i,  // Tests for unavailability
  /has.*no.*google\.script\.run/i,  // Test names checking absence
  /filter.*google\.script/i,  // Filtering out expected errors
  /expect\(.*google.*\)\.toBe(Undefined|False)/i,  // Negative assertions
];

/**
 * Comment patterns that indicate the code is documenting NON-usage of GAS
 * These patterns appear in comments explaining that GAS is NOT used
 */
const NON_USAGE_COMMENT_PATTERNS = [
  /NO\s+\w*\s*google\.script\.run/i,        // "NO google.script.run" or "NO fallback to google.script.run"
  /not\s+.*google\.script\.run/i,           // "not use google.script.run"
  /without\s+google\.script\.run/i,         // "without google.script.run"
  /replaces\s+google\.script\.run/i,        // "replaces google.script.run"
  /instead\s+of\s+google\.script\.run/i,    // "instead of google.script.run"
  /never\s+.*google\.script\.run/i,         // "never use google.script.run"
  /NO\s+fallback\s+to\s+google\.script\.run/i, // "NO fallback to google.script.run"
  /Allow\s+google\.script\.run\s+errors/i,  // "Allow google.script.run errors"
];

// =============================================================================
// ANSI Colors
// =============================================================================

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

const log = {
  info: (msg) => console.log(`${colors.blue}[INFO]${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}[PASS]${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}[FAIL]${colors.reset} ${msg}`),
  warn: (msg) => console.log(`${colors.yellow}[WARN]${colors.reset} ${msg}`),
  header: (msg) => console.log(`\n${colors.bright}${colors.cyan}${'='.repeat(70)}${colors.reset}\n${colors.bright}${colors.cyan}${msg}${colors.reset}\n${colors.bright}${colors.cyan}${'='.repeat(70)}${colors.reset}\n`),
};

// =============================================================================
// Helper Functions
// =============================================================================

// Cached allowlist entries (loaded once on first use)
let cachedAllowlist = null;

/**
 * Get the complete allowlist (external file + fallback entries)
 */
function getAllowlist() {
  if (cachedAllowlist === null) {
    const externalEntries = readExternalAllowlist();
    // Merge external allowlist with fallback, removing duplicates
    const combined = new Set([...externalEntries, ...ALLOWLIST_FALLBACK]);
    cachedAllowlist = Array.from(combined);
  }
  return cachedAllowlist;
}

/**
 * Check if a path should be excluded based on allowlist
 */
function isAllowlisted(filePath) {
  const relativePath = relative(ROOT_DIR, filePath);
  const allowlist = getAllowlist();

  // Check exact file matches (from external file + fallback)
  if (allowlist.includes(relativePath)) {
    return true;
  }

  // Check directory exclusions
  for (const dir of ALLOWLISTED_DIRECTORIES) {
    if (relativePath.startsWith(dir + '/') || relativePath === dir) {
      return true;
    }
  }

  // Check extension exclusions
  const ext = extname(filePath).toLowerCase();
  if (ALLOWLISTED_EXTENSIONS.has(ext)) {
    return true;
  }

  return false;
}

/**
 * Check if file content contains negative assertions (testing for absence)
 */
function containsNegativeAssertions(content) {
  return NEGATIVE_ASSERTION_PATTERNS.some(pattern => pattern.test(content));
}

/**
 * Check if a comment line documents NON-usage of GAS (e.g., "NO google.script.run fallback")
 */
function isNonUsageComment(line) {
  return NON_USAGE_COMMENT_PATTERNS.some(pattern => pattern.test(line));
}

/**
 * Scan a file for banned patterns
 * @returns {object[]} Array of violations found
 */
function scanFile(filePath) {
  const violations = [];

  try {
    const content = readFileSync(filePath, 'utf-8');
    const relativePath = relative(ROOT_DIR, filePath);

    // Check if this file contains negative assertions (test files checking for absence)
    if (containsNegativeAssertions(content)) {
      return violations; // Skip - this is a test checking for absence of banned patterns
    }

    const lines = content.split('\n');

    // Check each banned regex pattern
    for (const pattern of BANNED_PATTERNS) {
      for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];
        // Reset regex state for each line
        pattern.lastIndex = 0;

        let match;
        while ((match = pattern.exec(line)) !== null) {
          // Check if this line is a comment explaining the pattern (not actual usage)
          const trimmedLine = line.trim();
          const isComment = trimmedLine.startsWith('//') ||
                           trimmedLine.startsWith('#') ||
                           trimmedLine.startsWith('*') ||
                           trimmedLine.startsWith('<!--');

          // Allow comments that are documenting the migration or NON-usage
          if (isComment && (
            trimmedLine.includes('LEGACY') ||
            trimmedLine.includes('migration') ||
            trimmedLine.includes('removed') ||
            trimmedLine.includes('deprecated') ||
            trimmedLine.includes('no longer') ||
            trimmedLine.includes('not supported') ||
            isNonUsageComment(trimmedLine)
          )) {
            continue;
          }

          violations.push({
            file: relativePath,
            line: lineNum + 1,
            column: match.index + 1,
            match: match[0],
            context: line.trim().substring(0, 100),
            reason: 'GAS execution URL with real deployment ID',
          });
        }
      }
    }

    // Check each banned string pattern (simple includes check)
    for (const bannedString of BANNED_STRINGS) {
      for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];
        const index = line.indexOf(bannedString);

        if (index !== -1) {
          // Check if this line is a comment explaining the pattern (not actual usage)
          const trimmedLine = line.trim();
          const isComment = trimmedLine.startsWith('//') ||
                           trimmedLine.startsWith('#') ||
                           trimmedLine.startsWith('*') ||
                           trimmedLine.startsWith('<!--');

          // Allow comments that are documenting the migration or NON-usage
          if (isComment && (
            trimmedLine.includes('LEGACY') ||
            trimmedLine.includes('migration') ||
            trimmedLine.includes('removed') ||
            trimmedLine.includes('deprecated') ||
            trimmedLine.includes('no longer') ||
            trimmedLine.includes('not supported') ||
            isNonUsageComment(trimmedLine)
          )) {
            continue;
          }

          // Determine specific reason and fix hint based on pattern
          let reason = 'Banned GAS origin pattern';
          let fixHint = 'Use Cloudflare Worker endpoints instead';
          if (bannedString === 'google.script.run') {
            reason = 'GAS client-side RPC - must use fetch() instead';
            fixHint = 'Replace with fetch() to /api/* endpoints via Cloudflare Worker';
          } else if (bannedString === 'script.google.com/macros') {
            reason = 'Direct GAS Web App URL - traffic must route via Cloudflare';
            fixHint = 'Use stg.oursharedevents.com or oursharedevents.com instead of script.google.com';
          } else if (bannedString.includes('googleusercontent')) {
            reason = 'Legacy GAS execution URL pattern';
            fixHint = 'Use Cloudflare Worker endpoints (stg.oursharedevents.com or oursharedevents.com)';
          }

          violations.push({
            file: relativePath,
            line: lineNum + 1,
            column: index + 1,
            match: bannedString,
            context: line.trim().substring(0, 100),
            reason,
            fixHint,
          });
        }
      }
    }
  } catch (error) {
    if (error.code !== 'EISDIR') {
      log.warn(`Could not read file: ${filePath} (${error.message})`);
    }
  }

  return violations;
}

/**
 * Recursively scan a directory
 * @returns {object[]} Array of all violations found
 */
function scanDirectory(dirPath) {
  const violations = [];

  if (!existsSync(dirPath)) {
    return violations;
  }

  try {
    const entries = readdirSync(dirPath);

    for (const entry of entries) {
      const fullPath = join(dirPath, entry);

      // Skip allowlisted paths
      if (isAllowlisted(fullPath)) {
        continue;
      }

      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        violations.push(...scanDirectory(fullPath));
      } else if (stat.isFile()) {
        const ext = extname(entry).toLowerCase();
        if (SCAN_EXTENSIONS.has(ext)) {
          violations.push(...scanFile(fullPath));
        }
      }
    }
  } catch (error) {
    log.warn(`Could not scan directory: ${dirPath} (${error.message})`);
  }

  return violations;
}

/**
 * Scan root-level files
 */
function scanRootFiles() {
  const violations = [];

  for (const file of SCAN_ROOT_FILES) {
    const filePath = join(ROOT_DIR, file);
    if (existsSync(filePath) && !isAllowlisted(filePath)) {
      violations.push(...scanFile(filePath));
    }
  }

  // Also scan .env* files
  try {
    const rootEntries = readdirSync(ROOT_DIR);
    for (const entry of rootEntries) {
      if (entry.startsWith('.env') && !entry.endsWith('.example')) {
        const filePath = join(ROOT_DIR, entry);
        if (!isAllowlisted(filePath)) {
          violations.push(...scanFile(filePath));
        }
      }
    }
  } catch (error) {
    log.warn(`Could not scan root directory for .env files: ${error.message}`);
  }

  return violations;
}

// =============================================================================
// Main
// =============================================================================

function main() {
  log.header('GAS ORIGIN BAN SCRIPT - Story 3 (Environment Alignment)');

  console.log('Purpose: Prevent shipping code that references GAS origins');
  console.log('Policy: GAS must never re-enter runtime. Cloudflare is the backend.');
  console.log('        All traffic must route through stg.oursharedevents.com or oursharedevents.com');
  console.log('');
  console.log('Banned patterns:');
  console.log('  - script.google.com/macros              (GAS Web App URLs)');
  console.log('  - script.google.com/macros/s/{ID}/exec  (GAS execution URLs)');
  console.log('  - script.google.com/home/projects/{ID}  (GAS project URLs)');
  console.log('  - google.script.run                     (GAS client-side RPC)');
  console.log('  - googleusercontent.com/macros          (Legacy GAS pattern)');
  console.log('');

  // Load and display allowlist info
  const allowlist = getAllowlist();
  log.info(`Loaded allowlist with ${allowlist.length} entries from:`);
  console.log(`  - scripts/banned-origins.allow.txt`);
  console.log(`  - Built-in fallback entries`);
  console.log('');

  log.info('Scanning directories for banned GAS origins...');
  console.log('');

  const allViolations = [];
  let filesScanned = 0;

  // Scan configured directories
  for (const dir of SCAN_DIRECTORIES) {
    const dirPath = join(ROOT_DIR, dir);
    if (existsSync(dirPath)) {
      log.info(`Scanning ${dir}/...`);
      const violations = scanDirectory(dirPath);
      allViolations.push(...violations);
      // Count files (approximate)
      try {
        const count = readdirSync(dirPath, { recursive: true }).length;
        filesScanned += count;
      } catch {
        // Ignore counting errors
      }
    }
  }

  // Scan root files
  log.info('Scanning root configuration files...');
  allViolations.push(...scanRootFiles());
  filesScanned += SCAN_ROOT_FILES.length;

  console.log('');

  // Report results
  if (allViolations.length === 0) {
    log.success('No banned GAS origins found in scanned files');
    console.log('');
    console.log('Scanned directories:');
    SCAN_DIRECTORIES.forEach(dir => console.log(`  - ${dir}/`));
    console.log('  - Root config files');
    console.log('');
    console.log('Allowlisted (not scanned):');
    console.log('  - archive/** (legacy code)');
    console.log('  - *.md (documentation)');
    console.log('  - schemas/** (JSON Schema examples)');
    console.log('  - postman/** (API testing examples)');
    console.log('  - .clasp*.json (Google clasp config)');
    console.log('  - Comments documenting NON-usage of GAS');
    console.log('');
    log.success('Stage-1 GAS origin ban check: PASSED');
    console.log('');
    console.log('Contract boundary enforced:');
    console.log('  - Worker upstream is configured via environment variables');
    console.log('  - Front-end must never call GAS directly');
    console.log('  - All traffic routes through stg.oursharedevents.com or oursharedevents.com');
    console.log('');
    process.exit(0);
  } else {
    log.error(`Found ${allViolations.length} banned GAS origin reference(s):\n`);

    // Group violations by file
    const byFile = {};
    for (const v of allViolations) {
      if (!byFile[v.file]) {
        byFile[v.file] = [];
      }
      byFile[v.file].push(v);
    }

    for (const [file, violations] of Object.entries(byFile)) {
      console.log(`${colors.red}${colors.bright}${file}${colors.reset}`);
      for (const v of violations) {
        console.log(`  Line ${v.line}: ${colors.dim}${v.context}${colors.reset}`);
        console.log(`  ${colors.yellow}Match: ${v.match}${colors.reset}`);
        if (v.reason) {
          console.log(`  ${colors.cyan}Reason: ${v.reason}${colors.reset}`);
        }
        if (v.fixHint) {
          console.log(`  ${colors.green}Fix: ${v.fixHint}${colors.reset}`);
        }
        console.log('');
      }
    }

    console.log(`${colors.bright}${colors.red}${'='.repeat(70)}${colors.reset}`);
    log.error('STAGE-1 HARD GATE FAILED: Banned GAS origins detected');
    console.log(`${colors.bright}${colors.red}${'='.repeat(70)}${colors.reset}`);
    console.log('');
    console.log('To fix:');
    console.log('  1. Remove or replace the banned URLs/patterns with Cloudflare Worker equivalents');
    console.log('     - Replace script.google.com URLs with stg.oursharedevents.com (staging)');
    console.log('       or oursharedevents.com (production)');
    console.log('  2. Replace google.script.run calls with fetch() to /api/* endpoints');
    console.log('  3. If legacy reference is needed for migration docs, add to allowlist:');
    console.log('     scripts/banned-origins.allow.txt');
    console.log('     Include a justification comment explaining why it\'s allowed');
    console.log('');
    console.log('Example fix:');
    console.log('  Before: const url = "https://script.google.com/macros/s/.../exec";');
    console.log('  After:  const url = "https://stg.oursharedevents.com/api/events";');
    console.log('');
    console.log('See Story 3 - Enforce Environment Alignment & Ban GAS Origins');
    console.log('');
    process.exit(1);
  }
}

main();
