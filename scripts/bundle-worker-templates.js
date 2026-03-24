#!/usr/bin/env node
/**
 * Bundle Worker Templates
 *
 * Pre-processes GAS templates for use in Cloudflare Worker.
 * - Resolves <?!= include('File') ?> directives
 * - Preserves <?= variable ?> markers for runtime substitution
 * - Outputs bundled HTML files to cloudflare-proxy/templates/
 * - Validates all templates are present and non-empty (Stage-1)
 *
 * Usage:
 *   node scripts/bundle-worker-templates.js
 *   node scripts/bundle-worker-templates.js --check    # Verify bundles are up-to-date
 *   node scripts/bundle-worker-templates.js --validate # Validate templates only (Stage-1)
 *
 * Template Variables (replaced at runtime by Worker):
 *   <?= appTitle ?>  - Brand name + scope (e.g., "My Brand · events")
 *   <?= brandId ?>   - Brand identifier from URL
 *   <?= scope ?>     - Scope from URL (default: 'events')
 *   <?= execUrl ?>   - GAS deployment URL for API calls
 *   <?= demoMode ?>  - Demo mode flag (true/false)
 *
 * Stage-1 Validation (Story 3):
 *   - All templates must be present
 *   - All templates must be non-empty
 *   - All templates must contain valid HTML structure
 *   - Exits with code 1 if any validation fails
 *
 * Related: cloudflare-proxy/worker.js (renderTemplate function)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Source and output directories
const SRC_DIR = path.join(__dirname, '../src/mvp');
const OUTPUT_DIR = path.join(__dirname, '../cloudflare-proxy/templates');

// Templates to bundle
const TEMPLATES = [
  { source: 'Public.html', output: 'public.html', name: 'Public' },
  { source: 'Admin.html', output: 'admin.html', name: 'Admin' },
  { source: 'Display.html', output: 'display.html', name: 'Display' },
  { source: 'Poster.html', output: 'poster.html', name: 'Poster' },
  { source: 'SharedReport.html', output: 'report.html', name: 'Report' }
];

// Include files that will be resolved
const INCLUDE_FILES = [
  'Styles.html',
  'NUSDK.html',
  'SharedUtils.html',
  'SponsorUtils.html',
  'FooterComponent.html',
  'DesignAdapter.html',
  'DesignTokens.html',
  'CollapsibleSections.html',
  'SpinnerComponent.html',
  'Header.html',
  'HeaderInit.html'
];

/**
 * Strip all HTML comments from content using iterative approach.
 * Uses a loop to ensure complete removal even with edge cases.
 * This addresses CodeQL's "Incomplete multi-character sanitization" warning.
 *
 * @param {string} content - The content to strip comments from
 * @returns {string} Content with all HTML comments removed
 */
function stripHtmlComments(content) {
  // Use literal regex pattern (not constructed from user input)
  const commentPattern = /<!--[\s\S]*?-->/g;
  let result = content;
  let previous;

  // Iterate until no more comments are found (handles edge cases)
  do {
    previous = result;
    result = result.replace(commentPattern, '');
  } while (result !== previous);

  return result;
}

/**
 * Read a template file
 */
function readTemplate(filename) {
  const filepath = path.join(SRC_DIR, filename);
  if (!fs.existsSync(filepath)) {
    console.warn(`Warning: Template file not found: ${filename}`);
    return '';
  }
  return fs.readFileSync(filepath, 'utf8');
}

/**
 * Resolve include directives in template
 * Handles: <?!= include('Filename'); ?> and <?!= include('Filename') ?>
 */
function resolveIncludes(content, depth = 0) {
  if (depth > 10) {
    throw new Error('Include depth exceeded 10 - possible circular include');
  }

  // Match include patterns: <?!= include('File'); ?> or <?!= include('File') ?>
  const includePattern = /<\?!=\s*include\s*\(\s*['"]([^'"]+)['"]\s*\)\s*;?\s*\?>/g;

  return content.replace(includePattern, (match, filename) => {
    // Add .html extension if not present
    const includeFile = filename.endsWith('.html') ? filename : `${filename}.html`;
    const includedContent = readTemplate(includeFile);

    if (!includedContent) {
      console.warn(`Warning: Include file not found: ${includeFile}`);
      return `<!-- Include not found: ${includeFile} -->`;
    }

    // Recursively resolve includes in the included content
    return resolveIncludes(includedContent, depth + 1);
  });
}

/**
 * Convert GAS template variables to Worker-compatible markers
 * <?= variable ?> becomes {{variable}} for easier runtime replacement
 */
function convertVariables(content) {
  // Preserve the original GAS syntax but also add a comment marker
  // This allows the Worker to do simple string replacement
  const varPattern = /<\?=\s*(\w+)\s*\?>/g;

  return content.replace(varPattern, (match, varName) => {
    // Keep as-is - Worker will replace these at runtime
    return match;
  });
}

/**
 * Remove GAS-specific conditional blocks
 * <? if (condition) { ?> ... <? } ?>
 *
 * For MVP, we render a simplified version that works without GAS conditions
 */
function simplifyConditionals(content) {
  // Remove simple GAS conditionals - keep the content, remove the tags
  // This is a simplified approach - more complex conditionals may need manual handling

  // Remove opening conditional: <? if (...) { ?>
  content = content.replace(/<\?\s*if\s*\([^)]*\)\s*\{\s*\?>/g, '');

  // Remove else blocks: <? } else { ?>
  content = content.replace(/<\?\s*\}\s*else\s*\{\s*\?>/g, '');

  // Remove closing: <? } ?>
  content = content.replace(/<\?\s*\}\s*\?>/g, '');

  // Remove <?!= JSON.stringify(...) ?> and replace with placeholder
  content = content.replace(/<\?!=\s*JSON\.stringify\s*\([^)]+\)\s*\?>/g, '{}');

  return content;
}

/**
 * Add cache-busting comment with bundle timestamp
 */
function addBundleMetadata(content, templateName) {
  const timestamp = new Date().toISOString();
  const hash = crypto.createHash('md5').update(content).digest('hex').slice(0, 8);

  const metadata = `<!--
  Template: ${templateName}
  Bundled: ${timestamp}
  Hash: ${hash}
  Source: GAS templates (src/mvp/)
  Generator: scripts/bundle-worker-templates.js

  Variables (replaced at runtime):
  - <?= appTitle ?> - Page title
  - <?= brandId ?> - Brand identifier
  - <?= scope ?> - Scope (events, leagues, etc.)
  - <?= execUrl ?> - API endpoint URL
-->
`;

  // Insert metadata after <!DOCTYPE html> if present
  if (content.toLowerCase().includes('<!doctype html>')) {
    return content.replace(/(<!doctype html>)/i, `$1\n${metadata}`);
  }

  return metadata + content;
}

/**
 * Bundle a single template
 */
function bundleTemplate(template) {
  console.log(`Bundling ${template.name}...`);

  let content = readTemplate(template.source);

  if (!content) {
    console.error(`Error: Source file not found: ${template.source}`);
    return null;
  }

  // Step 1: Resolve all includes
  content = resolveIncludes(content);

  // Step 2: Simplify conditionals (remove GAS-specific control flow)
  content = simplifyConditionals(content);

  // Step 3: Convert variables (keep <?= ?> syntax for Worker replacement)
  content = convertVariables(content);

  // Step 4: Add bundle metadata
  content = addBundleMetadata(content, template.name);

  return content;
}

/**
 * Write bundled template to output directory
 */
function writeBundle(template, content) {
  const outputPath = path.join(OUTPUT_DIR, template.output);

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  fs.writeFileSync(outputPath, content, 'utf8');
  console.log(`  Written: ${template.output} (${(content.length / 1024).toFixed(1)} KB)`);
}

/**
 * Generate template manifest for Worker
 */
function generateManifest(results) {
  const manifest = {
    version: '1.0.0',
    generated: new Date().toISOString(),
    templates: {}
  };

  for (const result of results) {
    if (result.success) {
      manifest.templates[result.name.toLowerCase()] = {
        file: result.output,
        size: result.size,
        hash: result.hash
      };
    }
  }

  const manifestPath = path.join(OUTPUT_DIR, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`\nManifest written: manifest.json`);

  return manifest;
}

/**
 * Check if bundles are up-to-date
 */
function checkBundles() {
  console.log('Checking if template bundles are up-to-date...\n');

  let allUpToDate = true;
  const results = [];

  for (const template of TEMPLATES) {
    const bundled = bundleTemplate(template);
    if (!bundled) {
      results.push({ name: template.name, status: 'error', message: 'Failed to bundle' });
      allUpToDate = false;
      continue;
    }

    const outputPath = path.join(OUTPUT_DIR, template.output);
    if (!fs.existsSync(outputPath)) {
      results.push({ name: template.name, status: 'missing', message: 'Bundle file not found' });
      allUpToDate = false;
      continue;
    }

    const existing = fs.readFileSync(outputPath, 'utf8');

    // Compare content (ignoring metadata comments which include timestamps)
    // Security note: stripHtmlComments is used for string comparison only,
    // not for HTML output. The stripped content is only used for equality checking.
    const bundledClean = stripHtmlComments(bundled).trim();
    const existingClean = stripHtmlComments(existing).trim();

    if (bundledClean !== existingClean) {
      results.push({ name: template.name, status: 'outdated', message: 'Content differs from source' });
      allUpToDate = false;
    } else {
      results.push({ name: template.name, status: 'ok', message: 'Up to date' });
    }
  }

  // Print results
  for (const result of results) {
    const icon = result.status === 'ok' ? '✓' : '✗';
    const color = result.status === 'ok' ? '\x1b[32m' : '\x1b[31m';
    console.log(`${color}${icon}\x1b[0m ${result.name}: ${result.message}`);
  }

  if (!allUpToDate) {
    console.log('\n\x1b[33mRun `npm run bundle:templates` to update bundles.\x1b[0m');
    process.exit(1);
  }

  console.log('\n\x1b[32mAll template bundles are up-to-date.\x1b[0m');
}

/**
 * Stage-1 Validation: Validate all bundled templates
 *
 * Story 3: Ensures Worker has all templates it needs.
 * Fails if any template is missing, empty, or invalid.
 *
 * Validation checks:
 * - Template file exists
 * - Template file is non-empty
 * - Template contains valid HTML structure (DOCTYPE or <html>)
 * - Template contains required placeholders
 * - Template is reasonably sized (> 100 bytes)
 */
function validateBundles() {
  console.log('Stage-1 Validation: Checking bundled templates...\n');

  const MIN_TEMPLATE_SIZE = 100;
  const REQUIRED_PLACEHOLDERS = ['appTitle', 'brandId'];

  let allValid = true;
  const results = [];

  for (const template of TEMPLATES) {
    const templatePath = path.join(OUTPUT_DIR, template.output);
    const checks = [];

    // Check 1: File exists
    if (!fs.existsSync(templatePath)) {
      results.push({
        name: template.name,
        valid: false,
        checks: [{ check: 'exists', passed: false, message: 'Template file not found' }]
      });
      allValid = false;
      continue;
    }
    checks.push({ check: 'exists', passed: true });

    // Read file content
    const content = fs.readFileSync(templatePath, 'utf8');
    const trimmed = content.trim();

    // Check 2: Non-empty
    if (trimmed.length === 0) {
      checks.push({ check: 'non-empty', passed: false, message: 'Template is empty' });
      results.push({ name: template.name, valid: false, checks });
      allValid = false;
      continue;
    }
    checks.push({ check: 'non-empty', passed: true });

    // Check 3: Minimum size
    if (trimmed.length < MIN_TEMPLATE_SIZE) {
      checks.push({
        check: 'min-size',
        passed: false,
        message: `Template too small: ${trimmed.length} bytes (min ${MIN_TEMPLATE_SIZE})`
      });
      results.push({ name: template.name, valid: false, checks });
      allValid = false;
      continue;
    }
    checks.push({ check: 'min-size', passed: true, size: trimmed.length });

    // Check 4: Valid HTML structure
    const lowerContent = trimmed.toLowerCase();
    if (!lowerContent.includes('<!doctype html') && !lowerContent.includes('<html')) {
      checks.push({
        check: 'html-structure',
        passed: false,
        message: 'Missing DOCTYPE or <html> tag'
      });
      results.push({ name: template.name, valid: false, checks });
      allValid = false;
      continue;
    }
    checks.push({ check: 'html-structure', passed: true });

    // Check 5: Required placeholders
    const missingPlaceholders = [];
    for (const placeholder of REQUIRED_PLACEHOLDERS) {
      const pattern = new RegExp(`<\\?=\\s*${placeholder}\\s*\\?>`, 'i');
      if (!pattern.test(content)) {
        missingPlaceholders.push(placeholder);
      }
    }
    if (missingPlaceholders.length > 0) {
      checks.push({
        check: 'placeholders',
        passed: false,
        message: `Missing placeholders: ${missingPlaceholders.join(', ')}`
      });
      results.push({ name: template.name, valid: false, checks });
      allValid = false;
      continue;
    }
    checks.push({ check: 'placeholders', passed: true });

    // Check 6: No unresolved includes
    if (/<\?!=\s*include\s*\(/.test(content)) {
      checks.push({
        check: 'includes-resolved',
        passed: false,
        message: 'Unresolved <?!= include() ?> directives found'
      });
      results.push({ name: template.name, valid: false, checks });
      allValid = false;
      continue;
    }
    checks.push({ check: 'includes-resolved', passed: true });

    // All checks passed
    results.push({ name: template.name, valid: true, checks, size: trimmed.length });
  }

  // Print results
  console.log('Validation Results:');
  console.log('─'.repeat(60));

  for (const result of results) {
    const icon = result.valid ? '✓' : '✗';
    const color = result.valid ? '\x1b[32m' : '\x1b[31m';
    const sizeStr = result.size ? ` (${(result.size / 1024).toFixed(1)} KB)` : '';

    console.log(`${color}${icon}\x1b[0m ${result.name}${sizeStr}`);

    if (!result.valid) {
      for (const check of result.checks) {
        if (!check.passed) {
          console.log(`  └─ ${check.check}: ${check.message}`);
        }
      }
    }
  }

  console.log('─'.repeat(60));

  if (!allValid) {
    console.log('\n\x1b[31m✗ Stage-1 validation FAILED\x1b[0m');
    console.log('Run `npm run bundle:templates` to regenerate templates.');
    process.exit(1);
  }

  const totalSize = results.reduce((sum, r) => sum + (r.size || 0), 0);
  console.log(`\n\x1b[32m✓ All ${results.length} templates validated successfully\x1b[0m`);
  console.log(`Total bundle size: ${(totalSize / 1024).toFixed(1)} KB`);
}

/**
 * Main bundling process
 */
function main() {
  const args = process.argv.slice(2);
  const isCheck = args.includes('--check');
  const isValidate = args.includes('--validate');

  if (isValidate) {
    validateBundles();
    return;
  }

  if (isCheck) {
    checkBundles();
    return;
  }

  console.log('Bundling GAS templates for Worker...\n');

  const results = [];

  for (const template of TEMPLATES) {
    const content = bundleTemplate(template);

    if (content) {
      writeBundle(template, content);
      const hash = crypto.createHash('md5').update(content).digest('hex').slice(0, 8);
      results.push({
        name: template.name,
        output: template.output,
        size: content.length,
        hash,
        success: true
      });
    } else {
      results.push({
        name: template.name,
        output: template.output,
        success: false
      });
    }
  }

  generateManifest(results);

  console.log('\nBundle complete!');

  // Summary
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  console.log(`\nSummary: ${successful} succeeded, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

// Run
main();
