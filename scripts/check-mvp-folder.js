#!/usr/bin/env node
/**
 * MVP Folder Guardrails - Prevent V2 code in MVP directory
 *
 * This script ensures that no V2 or experimental files exist in src/mvp.
 * The MVP directory must contain only shippable MVP code.
 *
 * Blocked patterns:
 *   - Any file with "V2" in the name (case-insensitive)
 *   - Randomizer.html (V2 utility not part of MVP)
 *
 * Usage:
 *   node scripts/check-mvp-folder.js
 *
 * Exit codes:
 *   0 - Clean: no blocked files found in src/mvp
 *   1 - Blocked files detected (must be moved to archive/v2-code)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC_MVP = path.join(ROOT, 'src', 'mvp');
const ARCHIVE_V2 = path.join(ROOT, 'archive', 'v2-code');

// Pattern to detect V2 files (case-insensitive)
const V2_PATTERN = /v2/i;

// Explicit blocklist of non-MVP files
const BLOCKED_FILES = [
  'Randomizer.html'
];

/**
 * Check for blocked files in src/mvp
 * @returns {{v2Files: string[], blockedFiles: string[]}} Arrays of blocked file paths
 */
function findBlockedFilesInMvp() {
  const v2Files = [];
  const blockedFiles = [];

  if (!fs.existsSync(SRC_MVP)) {
    console.error('ERROR: src/mvp directory not found');
    process.exit(1);
  }

  const files = fs.readdirSync(SRC_MVP);

  files.forEach(file => {
    // Check for V2 pattern
    if (V2_PATTERN.test(file)) {
      v2Files.push(file);
    }
    // Check explicit blocklist
    if (BLOCKED_FILES.includes(file)) {
      blockedFiles.push(file);
    }
  });

  return { v2Files, blockedFiles };
}

/**
 * List V2 files in archive for reference
 * @returns {string[]} Array of archived V2 files
 */
function listArchivedV2Files() {
  if (!fs.existsSync(ARCHIVE_V2)) {
    return [];
  }

  return fs.readdirSync(ARCHIVE_V2).filter(f =>
    f.endsWith('.gs') || f.endsWith('.html')
  );
}

// ============================================================================
// Main
// ============================================================================

function main() {
  console.log('MVP Folder Guardrails - Checking src/mvp for blocked files...\n');

  // Step 1: Check for blocked files in MVP directory
  const { v2Files, blockedFiles } = findBlockedFilesInMvp();
  const allBlocked = [...new Set([...v2Files, ...blockedFiles])];

  // Step 2: List archived V2 files for reference
  const archivedFiles = listArchivedV2Files();

  console.log(`Scanned: ${SRC_MVP}`);
  console.log(`Archive: ${ARCHIVE_V2}`);
  console.log('');

  console.log('Blocked patterns:');
  console.log('  - *V2* (case-insensitive)');
  BLOCKED_FILES.forEach(f => console.log(`  - ${f}`));
  console.log('');

  if (archivedFiles.length > 0) {
    console.log(`Archived V2 files (${archivedFiles.length}):`);
    archivedFiles.forEach(f => console.log(`   - ${f}`));
    console.log('');
  }

  if (allBlocked.length === 0) {
    console.log('SUCCESS: No blocked files found in src/mvp');
    console.log('   MVP directory contains only shippable MVP code.');
    process.exit(0);
  } else {
    console.log(`FAILED: Found ${allBlocked.length} blocked file(s) in src/mvp:\n`);
    allBlocked.forEach(file => {
      const reason = V2_PATTERN.test(file) ? 'V2 pattern' : 'explicit blocklist';
      console.log(`   src/mvp/${file} (${reason})`);
    });
    console.log('');
    console.log('Blocked files must be moved to archive/v2-code/ or deleted.');
    console.log('The MVP directory must only contain shippable MVP code.');
    console.log('');
    console.log('To fix:');
    allBlocked.forEach(file => {
      console.log(`   mv src/mvp/${file} archive/v2-code/${file}`);
    });
    console.log('');
    process.exit(1);
  }
}

main();
