#!/usr/bin/env node

/**
 * Google Apps Script API Deployment Script
 *
 * Replaces Clasp with direct Apps Script API calls using service account authentication.
 * No OAuth, no token refresh, no credential expiration issues.
 *
 * Requirements:
 * - SERVICE_ACCOUNT_JSON environment variable (service account key)
 * - SCRIPT_ID environment variable (Apps Script project ID)
 *
 * Usage:
 *   SERVICE_ACCOUNT_JSON='{"type":"service_account",...}' SCRIPT_ID='xxx' node scripts/deploy-apps-script.js
 */

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

// Configuration
const SCRIPT_ID = process.env.SCRIPT_ID;
const SERVICE_ACCOUNT_JSON = process.env.SERVICE_ACCOUNT_JSON;
const IMPERSONATE_USER = process.env.IMPERSONATE_USER; // Optional: email of Apps Script project owner

// Apps Script file extensions and their types
const FILE_TYPE_MAP = {
  '.gs': 'SERVER_JS',
  '.js': 'SERVER_JS',
  '.html': 'HTML',
  '.json': 'JSON'
};

/**
 * Get all Apps Script project files from the local directory
 */
function getProjectFiles() {
  const files = [];
  const rootDir = process.cwd();

  // Files to include (Apps Script source files)
  // Note: Currently collecting all .gs and .html files not in excluded directories
  // Potential patterns for future filtering:
  // ['Code.gs', 'appsscript.json', '*.gs', '*.html', 'src/**/*.gs', 'lib/**/*.gs']

  // Files to exclude
  const excludePatterns = [
    'node_modules',
    '.git',
    'tests',
    'scripts',
    'docs',
    '.github',
    'playwright-report',
    'coverage',
    'newman-reports',
    'postman'
  ];

  /**
   * Recursively scan directory for Apps Script files
   */
  function scanDirectory(dir, baseDir = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.join(baseDir, entry.name);

      // Skip excluded directories
      if (entry.isDirectory()) {
        const shouldExclude = excludePatterns.some(pattern =>
          relativePath.includes(pattern) || entry.name === pattern
        );

        if (!shouldExclude) {
          scanDirectory(fullPath, relativePath);
        }
        continue;
      }

      // Check if file should be included
      const ext = path.extname(entry.name);
      const fileType = FILE_TYPE_MAP[ext];

      if (fileType) {
        const content = fs.readFileSync(fullPath, 'utf8');

        // Apps Script API expects files without extension in the name
        // For appsscript.json, the name must be exactly "appsscript" (no extension)
        let name = relativePath;
        if (entry.name === 'appsscript.json') {
          name = 'appsscript';
        } else {
          // Remove extension for .gs and .html files
          name = relativePath.replace(ext, '');
        }

        files.push({
          name: name,
          type: fileType,
          source: content
        });

        console.log(`  📄 ${relativePath} (${fileType})`);
      }
    }
  }

  console.log('📂 Scanning project files...');
  scanDirectory(rootDir);

  return files;
}

/**
 * Authenticate with Google Apps Script API using service account
 */
async function getAuthenticatedClient() {
  if (!SERVICE_ACCOUNT_JSON) {
    throw new Error('SERVICE_ACCOUNT_JSON environment variable is required');
  }

  if (!SCRIPT_ID) {
    throw new Error('SCRIPT_ID environment variable is required');
  }

  console.log('🔐 Authenticating with service account...');

  let credentials;
  try {
    credentials = JSON.parse(SERVICE_ACCOUNT_JSON);
  } catch (error) {
    throw new Error(`Failed to parse SERVICE_ACCOUNT_JSON: ${error.message}`);
  }

  const authConfig = {
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/script.projects',
      'https://www.googleapis.com/auth/script.deployments',
      'https://www.googleapis.com/auth/script.webapp.deploy'
    ]
  };

  // If IMPERSONATE_USER is set, configure domain-wide delegation
  if (IMPERSONATE_USER) {
    console.log(`🔄 Impersonating user: ${IMPERSONATE_USER}`);
    authConfig.clientOptions = { subject: IMPERSONATE_USER };
  }

  const auth = new google.auth.GoogleAuth(authConfig);

  const authClient = await auth.getClient();
  console.log('✅ Authentication successful');

  return google.script({ version: 'v1', auth: authClient });
}

/**
 * Verify Apps Script API is enabled and accessible
 */
async function verifyApiAccess(scriptClient) {
  console.log('🔍 Verifying Apps Script API access...');

  try {
    // Try to get project metadata to verify READ access
    await scriptClient.projects.get({
      scriptId: SCRIPT_ID
    });
    console.log('✅ Apps Script API read access verified');

    // Try to verify WRITE access by getting current content
    try {
      await scriptClient.projects.getContent({
        scriptId: SCRIPT_ID
      });
      console.log('✅ Apps Script API write access verified');
    } catch (writeError) {
      if (writeError.code === 403) {
        console.error('\n' + '═'.repeat(55));
        console.error('  ⚠️  Write Access Not Enabled');
        console.error('═'.repeat(55));
        console.error('\n⚠️  WARNING: Read access works, but write access is blocked.');
        console.error('This typically means the project owner needs to enable the');
        console.error('Apps Script API in their USER settings.\n');
        console.error('📋 To fix this:\n');
        console.error('1. Project owner must visit:');
        console.error('   https://script.google.com/home/usersettings\n');
        console.error('2. Enable "Google Apps Script API"\n');
        console.error('3. Wait 2-5 minutes for propagation\n');
        console.error('4. Retry this deployment\n');
        console.error('Note: This is DIFFERENT from enabling the API in GCP Console.');
        console.error('      Both the GCP API AND user settings must be enabled.\n');
        console.error('═'.repeat(55));
        throw new Error('Apps Script API user setting not enabled. See instructions above.');
      }
      // If it's not a 403, continue anyway - we'll catch write errors during upload
      console.log('⚠️  Could not verify write access (will attempt upload anyway)');
    }

    return true;
  } catch (error) {
    if (error.message && error.message.includes('Apps Script API')) {
      // Re-throw if already formatted
      throw error;
    }
    if (error.code === 403 || error.code === 404) {
      console.error('\n' + '═'.repeat(55));
      console.error('  ❌ Apps Script API Access Denied');
      console.error('═'.repeat(55));
      console.error('\nCannot access the Apps Script project.');
      console.error('\n📋 Possible causes:\n');
      console.error('1. Apps Script API not enabled in Google Cloud Console:');
      console.error('   → https://console.cloud.google.com/apis/library\n');
      console.error('2. Service account not granted access to the Apps Script project:');
      console.error('   → Open Apps Script → Share → Add service account as Editor\n');
      console.error('3. Wrong SCRIPT_ID:');
      console.error(`   → Current ID: ${SCRIPT_ID}\n`);
      console.error('🔍 Run diagnostic tool to identify the exact issue:');
      console.error('   → npm run deploy:diagnose\n');
      console.error('📖 Full setup guide: docs/APPS_SCRIPT_API_SETUP.md\n');
      console.error('═'.repeat(55));
      throw new Error('Apps Script API access denied. Run "npm run deploy:diagnose" for detailed diagnostics.');
    }
    throw error;
  }
}

/**
 * Upload project files to Apps Script
 */
async function uploadFiles(scriptClient, files) {
  console.log('\n📤 Uploading files to Apps Script...');

  try {
    const response = await scriptClient.projects.updateContent({
      scriptId: SCRIPT_ID,
      requestBody: {
        files: files,
        scriptId: SCRIPT_ID
      }
    });

    console.log(`✅ Uploaded ${files.length} files successfully`);
    return response.data;
  } catch (error) {
    console.error('❌ Upload failed:', error.message);
    if (error.response) {
      console.error('Error details:', JSON.stringify(error.response.data, null, 2));
    }

    // Provide specific guidance for common errors
    if (error.message && error.message.includes('Apps Script API')) {
      console.error('\n' + '═'.repeat(55));
      console.error('  ⚠️  Apps Script API Not Enabled (User Settings)');
      console.error('═'.repeat(55));
      console.error('\n⚠️  CRITICAL: The project OWNER must enable Apps Script API');
      console.error('in their USER settings. This is different from the GCP setting.\n');
      console.error('📋 Required Steps:\n');
      console.error('1. Project owner must visit:');
      console.error('   https://script.google.com/home/usersettings\n');
      console.error('2. Toggle ON: "Google Apps Script API"\n');
      console.error('3. Wait 2-5 minutes for the change to propagate\n');
      console.error('4. Retry this deployment\n');
      console.error('\n📋 Additional Requirements (if above doesn\'t work):\n');
      console.error('A. Enable API in Google Cloud Console:');
      console.error('   https://console.cloud.google.com/apis/library\n');
      console.error('B. Grant service account Editor access to Apps Script:');
      console.error('   → Apps Script → Share → Add service account email\n');
      console.error('🔍 Run diagnostic tool to identify the exact issue:');
      console.error('   → npm run deploy:diagnose\n');
      console.error('📖 Complete guide: docs/APPS_SCRIPT_API_SETUP.md\n');
      console.error('═'.repeat(55));
    }

    throw error;
  }
}

/**
 * Create a new deployment
 */
async function createDeployment(scriptClient) {
  console.log('\n🚀 Creating deployment...');

  const timestamp = new Date().toISOString();
  const description = `CI/CD Deploy ${timestamp}`;

  try {
    const response = await scriptClient.projects.deployments.create({
      scriptId: SCRIPT_ID,
      requestBody: {
        versionNumber: undefined, // undefined = create from HEAD
        description: description
      }
    });

    const deployment = response.data;
    console.log('✅ Deployment created successfully');
    console.log(`   Deployment ID: ${deployment.deploymentId}`);

    // Get the web app URL
    const entryPoints = deployment.entryPoints || [];
    const webAppEntry = entryPoints.find(ep => ep.entryPointType === 'WEB_APP');

    if (webAppEntry && webAppEntry.webApp) {
      const url = webAppEntry.webApp.url;
      console.log(`   Web App URL: ${url}`);

      // Output for GitHub Actions
      if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(
          process.env.GITHUB_OUTPUT,
          `deployment_id=${deployment.deploymentId}\n`
        );
        fs.appendFileSync(
          process.env.GITHUB_OUTPUT,
          `url=${url}\n`
        );
      }

      return { deploymentId: deployment.deploymentId, url };
    } else {
      console.warn('⚠️  No web app entry point found in deployment');
      return { deploymentId: deployment.deploymentId, url: null };
    }
  } catch (error) {
    console.error('❌ Deployment creation failed:', error.message);
    if (error.response) {
      console.error('Error details:', JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
}

/**
 * Main deployment function
 */
async function deploy() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Google Apps Script API Deployment');
  console.log('═══════════════════════════════════════════════════════\n');

  try {
    // Get authenticated client
    const scriptClient = await getAuthenticatedClient();

    // Verify API access before proceeding
    await verifyApiAccess(scriptClient);

    // Get project files
    const files = getProjectFiles();

    if (files.length === 0) {
      throw new Error('No Apps Script files found to deploy');
    }

    console.log(`\n📊 Found ${files.length} files to deploy`);

    // Upload files
    await uploadFiles(scriptClient, files);

    // Create deployment
    const result = await createDeployment(scriptClient);

    console.log('\n═══════════════════════════════════════════════════════');
    console.log('  ✅ Deployment Complete!');
    console.log('═══════════════════════════════════════════════════════');

    if (result.url) {
      console.log(`\n🌐 Your app is live at:\n   ${result.url}\n`);
    }

    return result;

  } catch (error) {
    console.error('\n═══════════════════════════════════════════════════════');
    console.error('  ❌ Deployment Failed');
    console.error('═══════════════════════════════════════════════════════\n');
    console.error(error.message);

    if (error.code === 'ENOENT') {
      console.error('\n💡 Tip: Make sure you are running this from the project root directory');
    }

    process.exit(1);
  }
}

// Run deployment
if (require.main === module) {
  deploy();
}

module.exports = { deploy, getProjectFiles };
