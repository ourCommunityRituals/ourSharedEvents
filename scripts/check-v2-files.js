#!/usr/bin/env node
/**
 * V2 File Guardrails - Prevent V2 code in MVP directory
 *
 * This script ensures that no V2 files exist in src/mvp.
 * The MVP directory must contain only shippable MVP code.
 * V2/experimental code should live in archive/v2-code.
 *
 * Matches files with "V2" in the name (case-insensitive):
 *   - *V2*.gs
 *   - *V2*.html
 *   - *v2*.gs
 *   - *v2*.html
 *
 * Usage:
 *   node scripts/check-v2-files.js
 *
 * Exit codes:
 *   0 - No V2 files found in src/mvp
 *   1 - V2 files detected (must be moved to archive/v2-code)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC_MVP = path.join(ROOT, 'src', 'mvp');
const ARCHIVE_V2 = path.join(ROOT, 'archive', 'v2-code');

// Pattern to detect V2 files (case-insensitive)
const V2_PATTERN = /v2/i;

/**
 * Check for V2 files in src/mvp
 * @returns {string[]} Array of V2 file paths found
 */
function findV2FilesInMvp() {
  const v2Files = [];

  if (!fs.existsSync(SRC_MVP)) {
    console.error('ERROR: src/mvp directory not found');
    process.exit(1);
  }

  const files = fs.readdirSync(SRC_MVP);

  files.forEach(file => {
    if (V2_PATTERN.test(file)) {
      v2Files.push(file);
    }
  });

  return v2Files;
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
  console.log('🔍 V2 File Guardrails - Checking for V2 files in src/mvp...\n');

  // Step 1: Check for V2 files in MVP directory
  const v2FilesInMvp = findV2FilesInMvp();

  // Step 2: List archived V2 files for reference
  const archivedFiles = listArchivedV2Files();

  console.log(`📂 Scanned: ${SRC_MVP}`);
  console.log(`📦 Archive: ${ARCHIVE_V2}`);
  console.log('');

  if (archivedFiles.length > 0) {
    console.log(`📋 Archived V2 files (${archivedFiles.length}):`);
    archivedFiles.forEach(f => console.log(`   - ${f}`));
    console.log('');
  }

  if (v2FilesInMvp.length === 0) {
    console.log('✅ SUCCESS: No V2 files found in src/mvp');
    console.log('   MVP directory contains only shippable MVP code.');
    process.exit(0);
  } else {
    console.log(`❌ FAILED: Found ${v2FilesInMvp.length} V2 file(s) in src/mvp:\n`);
    v2FilesInMvp.forEach(file => {
      console.log(`   ❌ src/mvp/${file}`);
    });
    console.log('');
    console.log('V2 files must be moved to archive/v2-code/ or deleted.');
    console.log('The MVP directory must only contain shippable MVP code.');
    console.log('');
    console.log('To fix:');
    v2FilesInMvp.forEach(file => {
      console.log(`   mv src/mvp/${file} archive/v2-code/${file}`);
    });
    console.log('');
    process.exit(1);
  }
}

main();
