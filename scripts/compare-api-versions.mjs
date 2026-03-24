#!/usr/bin/env node
/**
 * API Version Comparison CLI (Story 3.2)
 *
 * Compares staging and production API responses to detect contract drift.
 * Generates reports in multiple formats (console, JSON, Markdown).
 *
 * Usage:
 *   node scripts/compare-api-versions.mjs                    # Run comparison
 *   node scripts/compare-api-versions.mjs --json             # JSON output
 *   node scripts/compare-api-versions.mjs --markdown         # Markdown output
 *   node scripts/compare-api-versions.mjs --output report    # Save to file
 *   node scripts/compare-api-versions.mjs --help             # Show help
 *
 * Environment Variables:
 *   STAGING_BASE_URL    - Override staging URL
 *   PRODUCTION_BASE_URL - Override production URL
 *
 * Exit Codes:
 *   0 - All contracts identical or compatible
 *   1 - Contract mismatches detected
 *   2 - Fetch errors occurred
 *   3 - Invalid arguments
 *
 * @see tests/shared/helpers/api-version-comparator.js
 * @see API_CONTRACT.md
 */

import { createRequire } from 'module';
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import comparator utilities
const {
  compareEnvironments,
  formatReport,
  formatJsonReport,
  formatMarkdownReport,
  CRITICAL_ENDPOINTS,
  ENVIRONMENTS
} = require('../tests/shared/helpers/api-version-comparator.js');

// ============================================================================
// CLI CONFIGURATION
// ============================================================================

const VERSION = '1.0.0';
const SCRIPT_NAME = 'compare-api-versions.mjs';

const HELP_TEXT = `
API Version Comparison Tool (Story 3.2)
=======================================

Compares staging and production API responses to detect contract drift.

Usage:
  node scripts/${SCRIPT_NAME} [options]

Options:
  --help, -h          Show this help message
  --version, -v       Show version
  --json              Output as JSON (machine-readable)
  --markdown, -md     Output as Markdown (for GitHub)
  --output, -o FILE   Save report to file (auto-detects format from extension)
  --quiet, -q         Suppress console output (useful with --output)
  --verbose           Show detailed comparison info
  --endpoints LIST    Comma-separated list of endpoint names to compare

Environment Variables:
  STAGING_BASE_URL     Override staging API URL
  PRODUCTION_BASE_URL  Override production API URL

Examples:
  # Basic comparison with console output
  node scripts/${SCRIPT_NAME}

  # Save JSON report for CI
  node scripts/${SCRIPT_NAME} --json --output api-version-report.json

  # Generate Markdown for GitHub issue
  node scripts/${SCRIPT_NAME} --markdown --output report.md

  # Compare specific endpoints
  node scripts/${SCRIPT_NAME} --endpoints status,statusmvp

Exit Codes:
  0 - All contracts identical or compatible
  1 - Contract mismatches detected (errors)
  2 - Fetch errors occurred
  3 - Invalid arguments

Critical Endpoints:
${CRITICAL_ENDPOINTS.map(e => `  - ${e.name}: ${e.description}`).join('\n')}
`;

// ============================================================================
// ARGUMENT PARSING
// ============================================================================

/**
 * Parse command line arguments
 * @param {string[]} args - Command line arguments
 * @returns {Object} Parsed options
 */
function parseArgs(args) {
  const options = {
    help: false,
    version: false,
    json: false,
    markdown: false,
    output: null,
    quiet: false,
    verbose: false,
    endpoints: null
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--help':
      case '-h':
        options.help = true;
        break;

      case '--version':
      case '-v':
        options.version = true;
        break;

      case '--json':
        options.json = true;
        break;

      case '--markdown':
      case '-md':
        options.markdown = true;
        break;

      case '--output':
      case '-o':
        options.output = args[++i];
        if (!options.output) {
          console.error('Error: --output requires a file path');
          process.exit(3);
        }
        break;

      case '--quiet':
      case '-q':
        options.quiet = true;
        break;

      case '--verbose':
        options.verbose = true;
        break;

      case '--endpoints':
        options.endpoints = args[++i]?.split(',').map(e => e.trim());
        if (!options.endpoints) {
          console.error('Error: --endpoints requires a comma-separated list');
          process.exit(3);
        }
        break;

      default:
        if (arg.startsWith('-')) {
          console.error(`Error: Unknown option: ${arg}`);
          console.error('Use --help for usage information');
          process.exit(3);
        }
    }
  }

  // Auto-detect format from output extension
  if (options.output) {
    if (options.output.endsWith('.json')) {
      options.json = true;
    } else if (options.output.endsWith('.md')) {
      options.markdown = true;
    }
  }

  return options;
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  // Handle help and version
  if (options.help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  if (options.version) {
    console.log(`API Version Comparator v${VERSION}`);
    process.exit(0);
  }

  // Determine endpoints to compare
  let endpoints = CRITICAL_ENDPOINTS;
  if (options.endpoints) {
    endpoints = CRITICAL_ENDPOINTS.filter(e =>
      options.endpoints.includes(e.name)
    );

    if (endpoints.length === 0) {
      console.error('Error: No matching endpoints found');
      console.error(`Available endpoints: ${CRITICAL_ENDPOINTS.map(e => e.name).join(', ')}`);
      process.exit(3);
    }
  }

  // Show startup info
  if (!options.quiet) {
    console.log('API Version Comparison (Story 3.2)');
    console.log('==================================');
    console.log('');
    console.log(`Staging:    ${ENVIRONMENTS.staging.baseUrl}`);
    console.log(`Production: ${ENVIRONMENTS.production.baseUrl}`);
    console.log(`Endpoints:  ${endpoints.length}`);
    console.log('');
    console.log('Comparing environments...');
    console.log('');
  }

  try {
    // Run comparison
    const report = await compareEnvironments(endpoints);

    // Format output
    let output;
    if (options.json) {
      output = formatJsonReport(report);
    } else if (options.markdown) {
      output = formatMarkdownReport(report);
    } else {
      output = formatReport(report);
    }

    // Output to console unless quiet
    if (!options.quiet) {
      console.log(output);
    }

    // Save to file if requested
    if (options.output) {
      const outputPath = resolve(process.cwd(), options.output);
      writeFileSync(outputPath, output);
      if (!options.quiet) {
        console.log(`\nReport saved to: ${outputPath}`);
      }
    }

    // Determine exit code
    if (report.summary.failedFetches > 0) {
      if (!options.quiet) {
        console.error('\nExiting with code 2: Fetch errors occurred');
      }
      process.exit(2);
    }

    if (report.summary.contractMismatches > 0) {
      if (!options.quiet) {
        console.error('\nExiting with code 1: Contract mismatches detected');
      }
      process.exit(1);
    }

    // Success
    if (!options.quiet && report.status === 'warning') {
      console.log('\nExiting with code 0: Contracts compatible (with warnings)');
    } else if (!options.quiet) {
      console.log('\nExiting with code 0: All contracts identical');
    }
    process.exit(0);

  } catch (error) {
    console.error('Error running comparison:', error.message);
    if (options.verbose) {
      console.error(error.stack);
    }
    process.exit(2);
  }
}

// Run main
main().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(2);
});
