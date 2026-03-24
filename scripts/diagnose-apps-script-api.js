#!/usr/bin/env node

/**
 * Apps Script API Diagnostic Tool
 *
 * This script performs a comprehensive diagnosis of Apps Script API access
 * to identify exactly why deployment is failing.
 */

const { google } = require('googleapis');

// Configuration
const SCRIPT_ID = process.env.SCRIPT_ID;
const SERVICE_ACCOUNT_JSON = process.env.SERVICE_ACCOUNT_JSON;

async function diagnose() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Apps Script API Diagnostic Tool');
  console.log('═══════════════════════════════════════════════════════\n');

  // Step 1: Verify environment variables
  console.log('Step 1: Checking environment variables...');

  if (!SERVICE_ACCOUNT_JSON) {
    console.error('❌ SERVICE_ACCOUNT_JSON environment variable is not set');
    console.error('   Set it with: export SERVICE_ACCOUNT_JSON=\'{"type":"service_account",...}\'');
    process.exit(1);
  }
  console.log('✅ SERVICE_ACCOUNT_JSON is set');

  if (!SCRIPT_ID) {
    console.error('❌ SCRIPT_ID environment variable is not set');
    console.error('   Set it with: export SCRIPT_ID=\'1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l\'');
    process.exit(1);
  }
  console.log('✅ SCRIPT_ID is set');
  console.log(`   Script ID: ${SCRIPT_ID}\n`);

  // Step 2: Parse service account credentials
  console.log('Step 2: Parsing service account credentials...');

  let credentials;
  try {
    credentials = JSON.parse(SERVICE_ACCOUNT_JSON);
    console.log('✅ Service account JSON is valid');
    console.log(`   Project ID: ${credentials.project_id}`);
    console.log(`   Client Email: ${credentials.client_email}`);
    console.log(`   Private Key ID: ${credentials.private_key_id}`);
    console.log(`   Client ID: ${credentials.client_id}\n`);
  } catch (error) {
    console.error('❌ Failed to parse SERVICE_ACCOUNT_JSON:', error.message);
    console.error('   Make sure you copied the entire JSON file contents');
    process.exit(1);
  }

  // Step 3: Create auth client
  console.log('Step 3: Creating authentication client...');

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/script.projects',
      'https://www.googleapis.com/auth/script.deployments',
      'https://www.googleapis.com/auth/script.webapp.deploy',
      'https://www.googleapis.com/auth/drive'
    ]
  });

  let authClient;
  try {
    authClient = await auth.getClient();
    console.log('✅ Authentication client created successfully\n');
  } catch (error) {
    console.error('❌ Failed to create auth client:', error.message);
    process.exit(1);
  }

  const script = google.script({ version: 'v1', auth: authClient });
  const drive = google.drive({ version: 'v3', auth: authClient });

  // Step 4: Test basic API access
  console.log('Step 4: Testing Apps Script API access...');

  try {
    const response = await script.projects.get({
      scriptId: SCRIPT_ID
    });
    console.log('✅ Can read project metadata (projects.get)');
    console.log(`   Project Title: ${response.data.title}`);
    console.log(`   Created: ${response.data.createTime}`);
    console.log(`   Updated: ${response.data.updateTime}\n`);
  } catch (error) {
    console.error('❌ Cannot read project metadata (projects.get)');
    console.error(`   Error Code: ${error.code}`);
    console.error(`   Error Message: ${error.message}`);

    if (error.code === 403) {
      console.error('\n📋 This usually means:');
      console.error('   1. Service account is not added as Editor to the Apps Script project');
      console.error('   2. Apps Script API is not enabled in Google Cloud Console');
      console.error('   3. Wrong SCRIPT_ID\n');

      console.error('🔧 How to fix:');
      console.error('   1. Open: https://script.google.com/home/projects/' + SCRIPT_ID + '/edit');
      console.error('   2. Click "Share" (top right)');
      console.error('   3. Add: ' + credentials.client_email);
      console.error('   4. Set role: Editor');
      console.error('   5. Click "Share"\n');
    } else if (error.code === 404) {
      console.error('\n📋 This usually means:');
      console.error('   1. Wrong SCRIPT_ID');
      console.error('   2. Script project was deleted\n');
    }

    process.exit(1);
  }

  // Step 5: Test read content access
  console.log('Step 5: Testing read content access...');

  try {
    const response = await script.projects.getContent({
      scriptId: SCRIPT_ID
    });
    console.log('✅ Can read project content (projects.getContent)');
    console.log(`   Files in project: ${response.data.files.length}\n`);
  } catch (error) {
    console.error('❌ Cannot read project content (projects.getContent)');
    console.error(`   Error Code: ${error.code}`);
    console.error(`   Error Message: ${error.message}\n`);

    if (error.code === 403) {
      console.error('📋 Read metadata works, but read content fails. This suggests:');
      console.error('   1. Service account has View access but not Edit access');
      console.error('   2. Check the service account role in Share settings\n');
    }

    process.exit(1);
  }

  // Step 6: Test write access (critical test)
  console.log('Step 6: Testing WRITE access (this is where it usually fails)...');
  console.log('   Attempting a test upload...\n');

  try {
    // Get current content first
    const currentContent = await script.projects.getContent({
      scriptId: SCRIPT_ID
    });

    // Try to update with the same content (no-op update to test permission)
    const response = await script.projects.updateContent({
      scriptId: SCRIPT_ID,
      requestBody: {
        files: currentContent.data.files,
        scriptId: SCRIPT_ID
      }
    });

    console.log('✅ ✅ ✅ WRITE ACCESS WORKS! (projects.updateContent)');
    console.log('   You can successfully deploy to this project!');
    console.log(`   Files updated: ${response.data.files.length}\n`);

    console.log('═══════════════════════════════════════════════════════');
    console.log('  ✅ ALL DIAGNOSTICS PASSED!');
    console.log('═══════════════════════════════════════════════════════\n');
    console.log('Your configuration is correct. Deployment should work.');
    console.log('If deployment still fails, check GitHub secrets match these credentials.\n');

  } catch (error) {
    console.error('❌ ❌ ❌ WRITE ACCESS FAILED! (projects.updateContent)');
    console.error(`   Error Code: ${error.code}`);
    console.error(`   Error Message: ${error.message}`);

    if (error.response && error.response.data) {
      console.error('\n📋 Full Error Details:');
      console.error(JSON.stringify(error.response.data, null, 2));
    }

    console.error('\n═══════════════════════════════════════════════════════');
    console.error('  🔍 DIAGNOSIS: Apps Script API User Setting Not Enabled');
    console.error('═══════════════════════════════════════════════════════\n');

    console.error('📋 THE ISSUE:');
    console.error('   The OWNER of the Apps Script project has not enabled');
    console.error('   the Apps Script API in their USER settings.\n');

    console.error('🔧 HOW TO FIX:\n');

    console.error('   1. Identify the project OWNER:');
    console.error('      → Open: https://script.google.com/home/projects/' + SCRIPT_ID + '/edit');
    console.error('      → Click "Share" (top right)');
    console.error('      → Look for the account with "Owner" role (not Editor!)\n');

    console.error('   2. The OWNER must log in and visit:');
    console.error('      → https://script.google.com/home/usersettings\n');

    console.error('   3. The OWNER must toggle ON:');
    console.error('      → "Google Apps Script API"\n');

    console.error('   4. Wait 2-5 minutes for propagation\n');

    console.error('   5. Run this diagnostic again to verify\n');

    console.error('⚠️  IMPORTANT NOTES:');
    console.error('   • This is DIFFERENT from enabling the API in Google Cloud Console');
    console.error('   • BOTH the GCP API and the user setting must be enabled');
    console.error('   • It must be the OWNER, not just an Editor');
    console.error('   • Service accounts inherit permissions from the project owner\n');

    console.error('═══════════════════════════════════════════════════════\n');

    process.exit(1);
  }

  // Step 7: Check Drive API access (optional but helpful)
  console.log('Step 7: Checking Drive API access (optional)...');

  try {
    const response = await drive.files.get({
      fileId: SCRIPT_ID,
      fields: 'id,name,owners,permissions,capabilities'
    });

    console.log('✅ Can access script via Drive API');
    console.log(`   File Name: ${response.data.name}`);

    if (response.data.owners && response.data.owners.length > 0) {
      console.log('\n📋 Project Owner(s):');
      response.data.owners.forEach(owner => {
        console.log(`   👤 ${owner.displayName || owner.emailAddress || 'Unknown'}`);
        if (owner.emailAddress) {
          console.log(`      Email: ${owner.emailAddress}`);
        }
      });
      console.log('\n   ⚠️  This account must have enabled Apps Script API in user settings!');
      console.log('   ⚠️  Visit: https://script.google.com/home/usersettings\n');
    }

    if (response.data.capabilities) {
      console.log('📋 Service Account Capabilities:');
      console.log(`   Can Edit: ${response.data.capabilities.canEdit || false}`);
      console.log(`   Can Comment: ${response.data.capabilities.canComment || false}`);
      console.log(`   Can Share: ${response.data.capabilities.canShare || false}\n`);
    }

  } catch (error) {
    console.log('⚠️  Cannot access via Drive API (this is OK - not critical)');
    console.log(`   Error: ${error.message}\n`);
  }

  console.log('═══════════════════════════════════════════════════════');
  console.log('  Diagnostic Complete');
  console.log('═══════════════════════════════════════════════════════\n');
}

// Run diagnostics
if (require.main === module) {
  diagnose().catch(error => {
    console.error('\n❌ Unexpected error during diagnostics:');
    console.error(error);
    process.exit(1);
  });
}

module.exports = { diagnose };
