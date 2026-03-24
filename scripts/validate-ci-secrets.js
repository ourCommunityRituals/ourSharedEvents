#!/usr/bin/env node
/**
 * CI Secrets Validation Script
 *
 * Validates that all required GitHub secrets are available in the CI environment.
 * Run this early in CI workflows to fail fast if secrets are missing.
 *
 * Usage:
 *   node scripts/validate-ci-secrets.js [--stage1|--stage2|--all]
 *
 * Options:
 *   --stage1   Validate Stage 1 secrets only (clasp deployment)
 *   --stage2   Validate Stage 2 secrets only (E2E testing)
 *   --all      Validate all secrets (default)
 *   --json     Output results as JSON
 *   --quiet    Only output errors
 */

const args = process.argv.slice(2);

const MODE = {
  stage1: args.includes('--stage1'),
  stage2: args.includes('--stage2'),
  all: args.includes('--all') || (!args.includes('--stage1') && !args.includes('--stage2')),
  json: args.includes('--json'),
  quiet: args.includes('--quiet')
};

// Secret definitions with categories
// Secret configuration using standardized naming convention (STAGING_*, PROD_*)
// See config/deployment-ids.js and .github-secrets-required.json for canonical list
const SECRETS = {
  stage1: {
    required: [
      { name: 'OAUTH_CREDENTIALS', env: 'OAUTH_CREDENTIALS', description: 'Clasp OAuth credentials' }
    ],
    optional: [
      { name: 'PROD_DEPLOYMENT_ID', env: 'PROD_DEPLOYMENT_ID', description: 'Production deployment ID (standardized)' },
      { name: 'PROD_SCRIPT_ID', env: 'PROD_SCRIPT_ID', description: 'Production script ID (standardized)' },
      { name: 'STAGING_SCRIPT_ID', env: 'STAGING_SCRIPT_ID', description: 'Staging script ID' },
      { name: 'STAGING_DEPLOYMENT_ID', env: 'STAGING_DEPLOYMENT_ID', description: 'Staging deployment ID' },
      { name: 'CLOUDFLARE_API_TOKEN', env: 'CLOUDFLARE_API_TOKEN', description: 'Cloudflare API token' },
      { name: 'CLOUDFLARE_ACCOUNT_ID', env: 'CLOUDFLARE_ACCOUNT_ID', description: 'Cloudflare account ID' },
      // Legacy (deprecated - use PROD_DEPLOYMENT_ID instead)
      { name: 'DEPLOYMENT_ID', env: 'DEPLOYMENT_ID', description: 'Production deployment ID (legacy)' }
    ]
  },
  stage2: {
    required: [
      { name: 'ADMIN_KEY_ROOT', env: 'ADMIN_KEY_ROOT', description: 'Root brand admin key' }
    ],
    optional: [
      { name: 'ADMIN_KEY', env: 'ADMIN_KEY', description: 'Fallback admin key' },
      { name: 'ADMIN_KEY_ABC', env: 'ADMIN_KEY_ABC', description: 'ABC brand admin key' },
      { name: 'ADMIN_KEY_CBC', env: 'ADMIN_KEY_CBC', description: 'CBC brand admin key' },
      { name: 'ADMIN_KEY_CBL', env: 'ADMIN_KEY_CBL', description: 'CBL brand admin key' },
      { name: 'SPREADSHEET_ID', env: 'SPREADSHEET_ID', description: 'Fallback spreadsheet ID' },
      { name: 'SPREADSHEET_ID_ROOT', env: 'SPREADSHEET_ID_ROOT', description: 'Root spreadsheet ID' },
      { name: 'SPREADSHEET_ID_ABC', env: 'SPREADSHEET_ID_ABC', description: 'ABC spreadsheet ID' },
      { name: 'SPREADSHEET_ID_CBC', env: 'SPREADSHEET_ID_CBC', description: 'CBC spreadsheet ID' },
      { name: 'SPREADSHEET_ID_CBL', env: 'SPREADSHEET_ID_CBL', description: 'CBL spreadsheet ID' }
    ]
  }
};

function log(msg) {
  if (!MODE.quiet && !MODE.json) console.log(msg);
}

function checkSecret(secret) {
  const value = process.env[secret.env];
  const exists = value && value.length > 0 && value !== 'undefined';

  return {
    name: secret.name,
    env: secret.env,
    description: secret.description,
    exists,
    // Show partial value for debugging (first 10 chars)
    preview: exists ? `${value.substring(0, 10)}...` : null
  };
}

function validateSecrets(category, secrets) {
  const results = {
    category,
    required: { total: 0, missing: [], found: [] },
    optional: { total: 0, missing: [], found: [] }
  };

  // Check required secrets
  for (const secret of secrets.required) {
    results.required.total++;
    const check = checkSecret(secret);
    if (check.exists) {
      results.required.found.push(check);
    } else {
      results.required.missing.push(check);
    }
  }

  // Check optional secrets
  for (const secret of secrets.optional) {
    results.optional.total++;
    const check = checkSecret(secret);
    if (check.exists) {
      results.optional.found.push(check);
    } else {
      results.optional.missing.push(check);
    }
  }

  return results;
}

function printResults(results) {
  log('');
  log(`=== ${results.category.toUpperCase()} SECRETS ===`);
  log('');

  // Required secrets
  log(`Required (${results.required.found.length}/${results.required.total}):`);
  for (const s of results.required.found) {
    log(`  ✅ ${s.name}`);
  }
  for (const s of results.required.missing) {
    log(`  ❌ ${s.name} - ${s.description}`);
  }

  // Optional secrets
  log('');
  log(`Optional (${results.optional.found.length}/${results.optional.total}):`);
  for (const s of results.optional.found) {
    log(`  ✅ ${s.name}`);
  }
  for (const s of results.optional.missing) {
    log(`  ⚪ ${s.name} - ${s.description}`);
  }
}

function main() {
  const allResults = [];
  let hasErrors = false;

  log('╔════════════════════════════════════════════════════════════╗');
  log('║           CI SECRETS VALIDATION                            ║');
  log('╚════════════════════════════════════════════════════════════╝');

  // Stage 1 secrets
  if (MODE.all || MODE.stage1) {
    const stage1Results = validateSecrets('Stage 1 (Deployment)', SECRETS.stage1);
    allResults.push(stage1Results);
    printResults(stage1Results);

    if (stage1Results.required.missing.length > 0) {
      hasErrors = true;
    }
  }

  // Stage 2 secrets
  if (MODE.all || MODE.stage2) {
    const stage2Results = validateSecrets('Stage 2 (Testing)', SECRETS.stage2);
    allResults.push(stage2Results);
    printResults(stage2Results);

    if (stage2Results.required.missing.length > 0) {
      hasErrors = true;
    }
  }

  // Summary
  log('');
  log('═'.repeat(60));

  const totalRequired = allResults.reduce((sum, r) => sum + r.required.total, 0);
  const totalMissing = allResults.reduce((sum, r) => sum + r.required.missing.length, 0);
  const totalOptional = allResults.reduce((sum, r) => sum + r.optional.total, 0);
  const optionalMissing = allResults.reduce((sum, r) => sum + r.optional.missing.length, 0);

  log(`Required: ${totalRequired - totalMissing}/${totalRequired} configured`);
  log(`Optional: ${totalOptional - optionalMissing}/${totalOptional} configured`);
  log('');

  if (hasErrors) {
    log('❌ VALIDATION FAILED - Required secrets missing');
    log('');
    log('To fix, add missing secrets at:');
    log('https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/settings/secrets/actions');

    // Provide specific instructions for OAUTH_CREDENTIALS
    const oauthMissing = allResults.some(r =>
      r.required.missing.some(s => s.name === 'OAUTH_CREDENTIALS')
    );

    if (oauthMissing) {
      log('');
      log('For OAUTH_CREDENTIALS:');
      log('  1. Run locally: clasp login');
      log('  2. Copy contents of ~/.clasprc.json');
      log('  3. Paste as OAUTH_CREDENTIALS secret value');
    }
  } else {
    log('✅ VALIDATION PASSED - All required secrets configured');
  }

  // JSON output
  if (MODE.json) {
    console.log(JSON.stringify({
      success: !hasErrors,
      results: allResults,
      summary: {
        required: { total: totalRequired, missing: totalMissing },
        optional: { total: totalOptional, missing: optionalMissing }
      }
    }, null, 2));
  }

  process.exit(hasErrors ? 1 : 0);
}

main();
