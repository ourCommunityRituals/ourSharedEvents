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
 *   --stage1   Validate Stage 1 secrets only (deployment)
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
  quiet: args.includes('--quiet'),
};

// Secret definitions with categories
const SECRETS = {
  stage1: {
    required: [
      {
        name: 'CLOUDFLARE_API_TOKEN_OSE',
        env: 'CLOUDFLARE_API_TOKEN_OSE',
        description: 'Cloudflare API token for Worker deployment (OurSharedEvents)',
      },
      {
        name: 'CLOUDFLARE_ACCOUNT_ID',
        env: 'CLOUDFLARE_ACCOUNT_ID',
        description: 'Cloudflare account ID',
      },
    ],
    optional: [],
  },
  stage2: {
    required: [
      { name: 'ADMIN_KEY_ROOT', env: 'ADMIN_KEY_ROOT', description: 'Root brand admin key' },
    ],
    optional: [
      { name: 'ADMIN_KEY', env: 'ADMIN_KEY', description: 'Fallback admin key' },
      { name: 'ADMIN_KEY_ABC', env: 'ADMIN_KEY_ABC', description: 'ABC brand admin key' },
      { name: 'ADMIN_KEY_CBC', env: 'ADMIN_KEY_CBC', description: 'CBC brand admin key' },
      { name: 'ADMIN_KEY_CBL', env: 'ADMIN_KEY_CBL', description: 'CBL brand admin key' },
    ],
  },
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
    preview: exists ? `${value.substring(0, 10)}...` : null,
  };
}

function validateSecrets(category, secrets) {
  const results = {
    category,
    required: { total: 0, missing: [], found: [] },
    optional: { total: 0, missing: [], found: [] },
  };

  for (const secret of secrets.required) {
    results.required.total++;
    const check = checkSecret(secret);
    if (check.exists) {
      results.required.found.push(check);
    } else {
      results.required.missing.push(check);
    }
  }

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

  log(`Required (${results.required.found.length}/${results.required.total}):`);
  for (const s of results.required.found) {
    log(`  \u2705 ${s.name}`);
  }
  for (const s of results.required.missing) {
    log(`  \u274C ${s.name} - ${s.description}`);
  }

  log('');
  log(`Optional (${results.optional.found.length}/${results.optional.total}):`);
  for (const s of results.optional.found) {
    log(`  \u2705 ${s.name}`);
  }
  for (const s of results.optional.missing) {
    log(`  \u26AA ${s.name} - ${s.description}`);
  }
}

function main() {
  const allResults = [];
  let hasErrors = false;

  log(
    '\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557'
  );
  log('\u2551           CI SECRETS VALIDATION                            \u2551');
  log(
    '\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D'
  );

  if (MODE.all || MODE.stage1) {
    const stage1Results = validateSecrets('Stage 1 (Deployment)', SECRETS.stage1);
    allResults.push(stage1Results);
    printResults(stage1Results);

    if (stage1Results.required.missing.length > 0) {
      hasErrors = true;
    }
  }

  if (MODE.all || MODE.stage2) {
    const stage2Results = validateSecrets('Stage 2 (Testing)', SECRETS.stage2);
    allResults.push(stage2Results);
    printResults(stage2Results);

    if (stage2Results.required.missing.length > 0) {
      hasErrors = true;
    }
  }

  log('');
  log('\u2550'.repeat(60));

  const totalRequired = allResults.reduce((sum, r) => sum + r.required.total, 0);
  const totalMissing = allResults.reduce((sum, r) => sum + r.required.missing.length, 0);
  const totalOptional = allResults.reduce((sum, r) => sum + r.optional.total, 0);
  const optionalMissing = allResults.reduce((sum, r) => sum + r.optional.missing.length, 0);

  log(`Required: ${totalRequired - totalMissing}/${totalRequired} configured`);
  log(`Optional: ${totalOptional - optionalMissing}/${totalOptional} configured`);
  log('');

  if (hasErrors) {
    log('\u274C VALIDATION FAILED - Required secrets missing');
    log('');
    log('To fix, add missing secrets at:');
    log('https://github.com/OurCommunityRituals/ourSharedEvents/settings/secrets/actions');
  } else {
    log('\u2705 VALIDATION PASSED - All required secrets configured');
  }

  if (MODE.json) {
    console.log(
      JSON.stringify(
        {
          success: !hasErrors,
          results: allResults,
          summary: {
            required: { total: totalRequired, missing: totalMissing },
            optional: { total: totalOptional, missing: optionalMissing },
          },
        },
        null,
        2
      )
    );
  }

  process.exit(hasErrors ? 1 : 0);
}

main();
