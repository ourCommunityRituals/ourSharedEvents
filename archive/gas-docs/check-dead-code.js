#!/usr/bin/env node
/**
 * Dead Export Check for Code.gs
 *
 * This script detects unused/zombie functions in Code.gs that are:
 * - Defined as global functions
 * - Never referenced from router, ApiSchemas, or HTML templates
 *
 * For now: Logs warnings but does NOT auto-delete.
 * This provides visibility for manual cleanup.
 *
 * Usage:
 *   node scripts/check-dead-code.js
 *   node scripts/check-dead-code.js --fail-on-dead   # Exit 1 if dead code found
 *
 * Exit codes:
 *   0 - No dead code found (or running in warning mode)
 *   1 - Dead code found (with --fail-on-dead flag)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC_MVP = path.join(ROOT, 'src', 'mvp');

// Known entrypoints that are called by Google Apps Script runtime (not from code)
const GAS_RUNTIME_ENTRYPOINTS = [
  'doGet', // HTTP GET handler
  'doPost', // HTTP POST handler
  'onOpen', // Spreadsheet open trigger
  'onEdit', // Spreadsheet edit trigger
  'onInstall', // Add-on install trigger
  'onFormSubmit', // Form submit trigger
  'include', // Template include function (called from HTML templates)
];

// Known exported functions that are used by HTML templates via NUSDK
const NUSDK_API_FUNCTIONS = [
  'api_get',
  'api_list',
  'api_create',
  'api_update',
  'api_delete',
  'api_getPublicBundle',
  'api_getDisplayBundle',
  'api_getPosterBundle',
  'api_getEventTemplates',
  'api_updateEventData',
  'api_createFormFromTemplate',
  'api_generateFormShortlink',
  'api_getSharedAnalytics',
  'api_getSponsorAnalytics',
  'api_exportSharedReport',
  'api_logExternalClick',
  'api_statusPure',
  'api_setupCheck',
  'api_checkPermissions',
  'api_generateToken',
];

// Functions that are private helpers (underscore suffix convention)
// These are expected to be called only from within Code.gs
const PRIVATE_FUNCTION_PATTERN = /^_.*_$/; // e.g., _helperFunction_

// ============================================================================
// Parse functions from .gs files
// ============================================================================

/**
 * Extract all function definitions from a .gs file
 * @param {string} content - File content
 * @returns {Array<{name: string, line: number}>}
 */
function extractFunctions(content) {
  const functions = [];
  const lines = content.split('\n');

  // Match: function functionName(
  // Match: const functionName = function(
  // Match: const functionName = (...) => (arrow functions)
  // NOTE: We require => for arrow functions to avoid false positives from
  // local variable assignments like: const foo = (bar || 'default')
  const patterns = [
    /^(?:function\s+)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/,
    /^(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*function\s*\(/,
    /^(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*\([^)]*\)\s*=>/,
    /^(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*[a-zA-Z_$][a-zA-Z0-9_$]*\s*=>/,
  ];

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    patterns.forEach((pattern) => {
      const match = trimmed.match(pattern);
      if (match) {
        functions.push({
          name: match[1],
          line: index + 1,
        });
      }
    });
  });

  return functions;
}

/**
 * Find all function references in content
 * @param {string} content - File content
 * @returns {Set<string>} Set of function names that are referenced
 */
function findFunctionReferences(content) {
  const refs = new Set();

  // Match function calls: functionName(
  // Match function references: functionName, or functionName; or :functionName
  const pattern = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?:\(|,|;|\)|:|\])/g;

  let match;
  while ((match = pattern.exec(content)) !== null) {
    refs.add(match[1]);
  }

  // Also match google.script.run.functionName patterns
  const gsrPattern = /google\.script\.run(?:\.[a-zA-Z]+)*\.([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
  while ((match = gsrPattern.exec(content)) !== null) {
    refs.add(match[1]);
  }

  return refs;
}

// ============================================================================
// Main analysis
// ============================================================================

/**
 * Analyze Code.gs for dead exports
 * @returns {{defined: Map, referenced: Set, dead: Array}|null}
 */
function analyzeCodeGs() {
  const codeGsPath = path.join(SRC_MVP, 'Code.gs');

  // Story 1: Check if Code.gs exists (may be archived after GAS→Worker migration)
  if (!fs.existsSync(codeGsPath)) {
    console.log('ℹ️  Code.gs not found in src/mvp/ (archived after GAS→Worker migration)');
    console.log('ℹ️  Skipping dead code analysis for Code.gs');
    console.log('ℹ️  See docs/GAS-TO-CLOUDFLARE-MIGRATION.md for architecture details\n');
    return null;
  }

  const codeGsContent = fs.readFileSync(codeGsPath, 'utf8');

  // Get all defined functions in Code.gs
  const definedFunctions = extractFunctions(codeGsContent);
  const defined = new Map();
  definedFunctions.forEach((fn) => {
    defined.set(fn.name, fn);
  });

  console.log(`📂 Found ${defined.size} function definitions in Code.gs\n`);

  // Collect all references from all source files
  const allRefs = new Set();

  // Add runtime entrypoints (always considered "used")
  GAS_RUNTIME_ENTRYPOINTS.forEach((fn) => allRefs.add(fn));

  // Add NUSDK API functions (called from frontend via google.script.run)
  NUSDK_API_FUNCTIONS.forEach((fn) => allRefs.add(fn));

  // Scan all .gs files for internal references
  const gsFiles = fs
    .readdirSync(SRC_MVP)
    .filter((f) => f.endsWith('.gs'))
    .map((f) => path.join(SRC_MVP, f));

  gsFiles.forEach((filePath) => {
    const content = fs.readFileSync(filePath, 'utf8');
    const refs = findFunctionReferences(content);
    refs.forEach((ref) => allRefs.add(ref));
  });

  // Scan all .html files for function references
  const htmlFiles = fs
    .readdirSync(SRC_MVP)
    .filter((f) => f.endsWith('.html'))
    .map((f) => path.join(SRC_MVP, f));

  htmlFiles.forEach((filePath) => {
    const content = fs.readFileSync(filePath, 'utf8');
    const refs = findFunctionReferences(content);
    refs.forEach((ref) => allRefs.add(ref));
  });

  console.log(`📂 Found ${allRefs.size} total function references across codebase\n`);

  // Find dead functions (defined but not referenced)
  const dead = [];
  defined.forEach((fn, name) => {
    // Skip private helper functions (they're expected to be internal)
    if (PRIVATE_FUNCTION_PATTERN.test(name)) {
      return; // Private functions are OK to be unused externally
    }

    // Skip if referenced
    if (allRefs.has(name)) {
      return;
    }

    dead.push({
      name,
      line: fn.line,
      file: 'Code.gs',
    });
  });

  return { defined, referenced: allRefs, dead };
}

/**
 * Analyze other .gs files for dead functions
 * @returns {Array}
 */
function analyzeOtherGsFiles() {
  const dead = [];

  // Get all .gs files except Code.gs
  const gsFiles = fs
    .readdirSync(SRC_MVP)
    .filter((f) => f.endsWith('.gs') && f !== 'Code.gs')
    .map((f) => ({ name: f, path: path.join(SRC_MVP, f) }));

  // Collect all references from all source files
  const allRefs = new Set();

  // Add runtime entrypoints
  GAS_RUNTIME_ENTRYPOINTS.forEach((fn) => allRefs.add(fn));
  NUSDK_API_FUNCTIONS.forEach((fn) => allRefs.add(fn));

  // Scan all files for references
  const allFiles = fs
    .readdirSync(SRC_MVP)
    .filter((f) => f.endsWith('.gs') || f.endsWith('.html'))
    .map((f) => path.join(SRC_MVP, f));

  allFiles.forEach((filePath) => {
    const content = fs.readFileSync(filePath, 'utf8');
    const refs = findFunctionReferences(content);
    refs.forEach((ref) => allRefs.add(ref));
  });

  // Check each non-Code.gs file
  gsFiles.forEach(({ name, path: filePath }) => {
    const content = fs.readFileSync(filePath, 'utf8');
    const definedFunctions = extractFunctions(content);

    definedFunctions.forEach((fn) => {
      // Skip private functions
      if (PRIVATE_FUNCTION_PATTERN.test(fn.name)) {
        return;
      }

      if (!allRefs.has(fn.name)) {
        dead.push({
          name: fn.name,
          line: fn.line,
          file: name,
        });
      }
    });
  });

  return dead;
}

// ============================================================================
// Main
// ============================================================================

function main() {
  const failOnDead = process.argv.includes('--fail-on-dead');

  console.log('🔍 Dead Export Check - Scanning for zombie functions...\n');

  // Analyze Code.gs
  console.log('=== Analyzing Code.gs ===\n');
  const codeResult = analyzeCodeGs();

  // Analyze other .gs files
  console.log('=== Analyzing other .gs files ===\n');
  const otherDead = analyzeOtherGsFiles();

  // Combine results (handle null if Code.gs was skipped)
  const allDead = [...(codeResult ? codeResult.dead : []), ...otherDead];

  // Group by file
  const byFile = {};
  allDead.forEach((fn) => {
    if (!byFile[fn.file]) {
      byFile[fn.file] = [];
    }
    byFile[fn.file].push(fn);
  });

  // Report results
  if (allDead.length === 0) {
    console.log('🎉 SUCCESS: No dead exports detected!');
    console.log('   All exported functions are referenced somewhere in the codebase.');
    process.exit(0);
  } else {
    console.log(`⚠️  WARNING: Found ${allDead.length} potentially unused function(s):\n`);

    Object.entries(byFile).forEach(([file, functions]) => {
      console.log(`📄 ${file}:`);
      functions
        .sort((a, b) => a.line - b.line)
        .forEach((fn) => {
          console.log(`   Line ${fn.line}: ${fn.name}()`);
        });
      console.log('');
    });

    console.log('─'.repeat(60));
    console.log('NOTE: These functions may be:');
    console.log('  1. Truly dead code (safe to remove)');
    console.log('  2. Called dynamically via string references');
    console.log('  3. Future-planned features');
    console.log('  4. Utility functions used in console/testing');
    console.log('');
    console.log('Review each function before removing.');
    console.log('─'.repeat(60));

    if (failOnDead) {
      console.log('\n❌ FAILED: Dead exports detected (--fail-on-dead flag set)');
      process.exit(1);
    } else {
      console.log('\n✅ PASS (warnings only): Run with --fail-on-dead to fail on dead exports');
      process.exit(0);
    }
  }
}

main();
