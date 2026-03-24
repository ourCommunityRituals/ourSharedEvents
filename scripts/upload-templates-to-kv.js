#!/usr/bin/env node
/**
 * Upload Templates to Cloudflare KV
 *
 * Uploads bundled HTML templates to Cloudflare KV storage for the Worker to serve.
 * Templates must be bundled first using: npm run bundle:templates
 *
 * Usage:
 *   node scripts/upload-templates-to-kv.js --env staging
 *   node scripts/upload-templates-to-kv.js --env production
 *   node scripts/upload-templates-to-kv.js --env staging --dry-run
 *
 * Prerequisites:
 *   1. Wrangler CLI installed and authenticated: wrangler login
 *   2. KV namespace created and ID added to wrangler.toml:
 *      wrangler kv:namespace create "TEMPLATES_KV" --env staging
 *      wrangler kv:namespace create "TEMPLATES_KV" --env production
 *   3. Templates bundled: npm run bundle:templates
 *
 * Story 8: Complete KV-based template serving infrastructure
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Template directory
const TEMPLATES_DIR = path.join(__dirname, '../cloudflare-proxy/templates');
const WRANGLER_TOML = path.join(__dirname, '../cloudflare-proxy/wrangler.toml');

// Template files to upload
const TEMPLATE_FILES = [
  'public.html',
  'admin.html',
  'display.html',
  'poster.html',
  'report.html',
  'manifest.json'
];

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    env: null,
    dryRun: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--env' && args[i + 1]) {
      options.env = args[++i];
    } else if (args[i] === '--dry-run') {
      options.dryRun = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      options.help = true;
    }
  }

  return options;
}

/**
 * Show help message
 */
function showHelp() {
  console.log(`
Upload Templates to Cloudflare KV

Usage:
  node scripts/upload-templates-to-kv.js --env <environment> [options]

Options:
  --env <env>    Target environment: staging or production (required)
  --dry-run      Show what would be uploaded without executing
  --help, -h     Show this help message

Examples:
  # Upload to staging
  node scripts/upload-templates-to-kv.js --env staging

  # Preview what would be uploaded to production
  node scripts/upload-templates-to-kv.js --env production --dry-run

Prerequisites:
  1. Run 'wrangler login' to authenticate
  2. Create KV namespace if not exists:
     wrangler kv:namespace create "TEMPLATES_KV" --env staging
  3. Add namespace ID to cloudflare-proxy/wrangler.toml
  4. Bundle templates: npm run bundle:templates
`);
}

/**
 * Verify templates exist and are valid
 */
function verifyTemplates() {
  console.log('Verifying templates...\n');

  const results = [];
  let allValid = true;

  for (const file of TEMPLATE_FILES) {
    const filePath = path.join(TEMPLATES_DIR, file);

    if (!fs.existsSync(filePath)) {
      results.push({ file, valid: false, error: 'File not found' });
      allValid = false;
      continue;
    }

    const stats = fs.statSync(filePath);
    if (stats.size === 0) {
      results.push({ file, valid: false, error: 'File is empty' });
      allValid = false;
      continue;
    }

    results.push({ file, valid: true, size: stats.size });
  }

  // Print results
  for (const result of results) {
    if (result.valid) {
      const sizeKB = (result.size / 1024).toFixed(1);
      console.log(`  ✓ ${result.file} (${sizeKB} KB)`);
    } else {
      console.log(`  ✗ ${result.file}: ${result.error}`);
    }
  }

  if (!allValid) {
    console.log('\n✗ Template verification failed.');
    console.log('Run `npm run bundle:templates` to generate templates.');
    process.exit(1);
  }

  console.log('\n✓ All templates verified\n');
  return results;
}

/**
 * Extract KV namespace ID from wrangler.toml
 */
function getNamespaceId(env) {
  if (!fs.existsSync(WRANGLER_TOML)) {
    console.error(`✗ wrangler.toml not found: ${WRANGLER_TOML}`);
    process.exit(1);
  }

  const content = fs.readFileSync(WRANGLER_TOML, 'utf8');

  // Pre-defined regex patterns for known environments (avoids regex injection)
  // These patterns match: [[env.<env>.kv_namespaces]] ... binding = "TEMPLATES_KV" ... id = "..."
  const ENV_PATTERNS = {
    staging: /\[\[env\.staging\.kv_namespaces\]\][\s\S]*?binding\s*=\s*"TEMPLATES_KV"[\s\S]*?id\s*=\s*"([^"]+)"/m,
    production: /\[\[env\.production\.kv_namespaces\]\][\s\S]*?binding\s*=\s*"TEMPLATES_KV"[\s\S]*?id\s*=\s*"([^"]+)"/m
  };

  const envPattern = ENV_PATTERNS[env];
  if (!envPattern) {
    console.error(`\n✗ Unknown environment: ${env}`);
    process.exit(1);
  }

  const match = content.match(envPattern);

  if (!match) {
    console.error(`\n✗ KV namespace not configured for environment: ${env}`);
    console.error(`\nTo fix this:`);
    console.error(`1. Create the KV namespace:`);
    console.error(`   wrangler kv:namespace create "TEMPLATES_KV" --env ${env}`);
    console.error(`\n2. Add the returned ID to cloudflare-proxy/wrangler.toml:`);
    console.error(`   [[env.${env}.kv_namespaces]]`);
    console.error(`   binding = "TEMPLATES_KV"`);
    console.error(`   id = "YOUR_NAMESPACE_ID_HERE"`);
    process.exit(1);
  }

  const namespaceId = match[1];

  // Check for placeholder values
  if (namespaceId.includes('REPLACE_WITH') || namespaceId.includes('your-') || namespaceId.includes('YOUR_')) {
    console.error(`\n✗ KV namespace ID is a placeholder: ${namespaceId}`);
    console.error(`\nTo fix this:`);
    console.error(`1. Create the KV namespace:`);
    console.error(`   wrangler kv:namespace create "TEMPLATES_KV" --env ${env}`);
    console.error(`\n2. Replace the placeholder in cloudflare-proxy/wrangler.toml with the actual ID`);
    process.exit(1);
  }

  return namespaceId;
}

/**
 * Upload a single file to KV
 */
function uploadFile(file, namespaceId, env, dryRun) {
  const filePath = path.join(TEMPLATES_DIR, file);

  // Read file content
  const content = fs.readFileSync(filePath, 'utf8');
  const sizeKB = (content.length / 1024).toFixed(1);

  if (dryRun) {
    console.log(`  [DRY RUN] Would upload: ${file} (${sizeKB} KB)`);
    return true;
  }

  try {
    // Use wrangler kv:key put to upload
    // We pipe the content via stdin to avoid shell escaping issues
    const cmd = `wrangler kv:key put "${file}" --namespace-id="${namespaceId}" --path="${filePath}"`;

    execSync(cmd, {
      cwd: path.join(__dirname, '../cloudflare-proxy'),
      stdio: ['pipe', 'pipe', 'pipe']
    });

    console.log(`  ✓ Uploaded: ${file} (${sizeKB} KB)`);
    return true;
  } catch (error) {
    console.error(`  ✗ Failed to upload ${file}: ${error.message}`);
    return false;
  }
}

/**
 * Upload all templates to KV
 */
function uploadTemplates(env, namespaceId, dryRun) {
  console.log(`Uploading templates to KV (${env})...\n`);
  console.log(`Namespace ID: ${namespaceId}\n`);

  let successCount = 0;
  let failCount = 0;

  for (const file of TEMPLATE_FILES) {
    if (uploadFile(file, namespaceId, env, dryRun)) {
      successCount++;
    } else {
      failCount++;
    }
  }

  console.log('');

  if (failCount > 0) {
    console.log(`✗ Upload completed with errors: ${successCount} succeeded, ${failCount} failed`);
    return false;
  }

  if (dryRun) {
    console.log(`✓ Dry run complete: ${successCount} files would be uploaded`);
  } else {
    console.log(`✓ All ${successCount} templates uploaded successfully`);
  }

  return true;
}

/**
 * Verify wrangler is available
 */
function verifyWrangler() {
  try {
    execSync('wrangler --version', { stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    console.error('✗ Wrangler CLI not found.');
    console.error('Install it with: npm install -g wrangler');
    console.error('Then authenticate: wrangler login');
    process.exit(1);
  }
}

/**
 * Main function
 */
function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  if (!options.env) {
    console.error('✗ Environment required. Use --env staging or --env production\n');
    showHelp();
    process.exit(1);
  }

  if (!['staging', 'production'].includes(options.env)) {
    console.error(`✗ Invalid environment: ${options.env}`);
    console.error('Valid environments: staging, production');
    process.exit(1);
  }

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║        Upload Templates to Cloudflare KV                   ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  console.log(`Environment: ${options.env}`);
  if (options.dryRun) {
    console.log('Mode: DRY RUN (no changes will be made)\n');
  } else {
    console.log('');
  }

  // Step 1: Verify wrangler is available
  verifyWrangler();

  // Step 2: Verify templates exist
  verifyTemplates();

  // Step 3: Get namespace ID from config
  const namespaceId = getNamespaceId(options.env);

  // Step 4: Upload templates
  const success = uploadTemplates(options.env, namespaceId, options.dryRun);

  if (!success) {
    process.exit(1);
  }

  // Print next steps
  if (!options.dryRun) {
    console.log('\n─────────────────────────────────────────────────────────────');
    console.log('Next steps:');
    console.log(`1. Deploy the worker: wrangler deploy --env ${options.env}`);
    console.log(`2. Verify templates: curl https://${options.env === 'staging' ? 'stg.' : ''}eventangle.com/events`);
    console.log('─────────────────────────────────────────────────────────────');
  }
}

// Run
main();
