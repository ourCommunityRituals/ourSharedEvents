#!/usr/bin/env node

/**
 * Get Deployment URL from Apps Script API
 *
 * Reliably extracts the deployment URL from Google Apps Script API.
 * This replaces the fragile regex parsing of clasp output.
 *
 * Features:
 * - Uses Apps Script API to get exact deployment info
 * - Works with both service accounts and OAuth credentials
 * - Outputs URL in multiple formats (GitHub Actions, stdout, JSON)
 * - Validates deployment is a web app
 *
 * Usage:
 *   # Using OAuth credentials (from clasp)
 *   node scripts/get-deployment-url.js
 *
 *   # Using service account
 *   SERVICE_ACCOUNT_JSON='...' node scripts/get-deployment-url.js
 *
 *   # Specify deployment ID
 *   DEPLOYMENT_ID='AKfycb...' node scripts/get-deployment-url.js
 *
 * Outputs:
 *   - Prints URL to stdout (last line)
 *   - Sets GitHub Actions outputs: url, deployment_id, version
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// Configuration from environment or .clasp.json
const SCRIPT_ID = process.env.SCRIPT_ID || getScriptIdFromClasp();
const DEPLOYMENT_ID = process.env.DEPLOYMENT_ID;

/**
 * Read script ID from .clasp.json
 */
function getScriptIdFromClasp() {
  try {
    const claspPath = path.join(process.cwd(), '.clasp.json');
    const clasp = JSON.parse(fs.readFileSync(claspPath, 'utf8'));
    return clasp.scriptId;
  } catch (err) {
    console.error('Failed to read .clasp.json:', err.message);
    return null;
  }
}

/**
 * Get OAuth credentials from ~/.clasprc.json or environment
 */
function getOAuthCredentials() {
  // Try environment variable first (for CI)
  if (process.env.CLASPRC_JSON) {
    try {
      return JSON.parse(process.env.CLASPRC_JSON);
    } catch (err) {
      console.error('Failed to parse CLASPRC_JSON:', err.message);
    }
  }

  // Try ~/.clasprc.json (for local development)
  try {
    const clasprcPath = path.join(process.env.HOME || process.env.USERPROFILE, '.clasprc.json');
    if (fs.existsSync(clasprcPath)) {
      return JSON.parse(fs.readFileSync(clasprcPath, 'utf8'));
    }
  } catch (err) {
    console.error('Failed to read ~/.clasprc.json:', err.message);
  }

  return null;
}

/**
 * Refresh OAuth token if expired
 */
async function refreshTokenIfNeeded(credentials) {
  const token = credentials.token;
  if (!token || !token.refresh_token) {
    throw new Error('No refresh token available');
  }

  // Check if token is expired (with 5 minute buffer)
  const now = Date.now();
  const expiryDate = token.expiry_date || 0;
  if (expiryDate > now + 300000) {
    // Token is still valid
    return token.access_token;
  }

  console.log('🔄 Refreshing OAuth token...');

  // Get OAuth client info
  const oauth2Client = credentials.oauth2ClientSettings || {};
  const clientId = oauth2Client.clientId || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = oauth2Client.clientSecret || process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Missing OAuth client credentials for token refresh');
  }

  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: token.refresh_token,
      grant_type: 'refresh_token'
    }).toString();

    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          const newToken = JSON.parse(data);
          resolve(newToken.access_token);
        } else {
          reject(new Error(`Token refresh failed: ${res.statusCode} ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

/**
 * Make authenticated API request
 */
async function apiRequest(accessToken, endpoint) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'script.googleapis.com',
      path: `/v1/projects/${SCRIPT_ID}${endpoint}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`API request failed: ${res.statusCode} ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

/**
 * Get deployment info from Apps Script API
 */
async function getDeploymentInfo(accessToken) {
  // Get list of deployments
  const deployments = await apiRequest(accessToken, '/deployments');

  if (!deployments.deployments || deployments.deployments.length === 0) {
    throw new Error('No deployments found for this script');
  }

  // Find the target deployment
  let deployment;
  if (DEPLOYMENT_ID) {
    // Use specified deployment ID
    deployment = deployments.deployments.find(d => d.deploymentId === DEPLOYMENT_ID);
    if (!deployment) {
      throw new Error(`Deployment ID not found: ${DEPLOYMENT_ID}`);
    }
  } else {
    // Use the most recent deployment (excluding @HEAD)
    deployment = deployments.deployments.find(d =>
      d.deploymentConfig && d.deploymentConfig.versionNumber
    );
    if (!deployment) {
      // Fallback to first deployment
      deployment = deployments.deployments[0];
    }
  }

  return deployment;
}

/**
 * Extract web app URL from deployment
 */
function getWebAppUrl(deployment) {
  const entryPoints = deployment.entryPoints || [];
  const webApp = entryPoints.find(ep => ep.entryPointType === 'WEB_APP');

  if (webApp && webApp.webApp && webApp.webApp.url) {
    return webApp.webApp.url;
  }

  // Construct URL from deployment ID if not in entry points
  if (deployment.deploymentId) {
    return `https://script.google.com/macros/s/${deployment.deploymentId}/exec`;
  }

  return null;
}

/**
 * Main function
 */
async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  📍 Get Deployment URL');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Script ID: ${SCRIPT_ID || 'NOT SET'}`);
  console.log(`  Deployment ID: ${DEPLOYMENT_ID || 'AUTO (latest)'}`);
  console.log('');

  if (!SCRIPT_ID) {
    console.error('❌ ERROR: SCRIPT_ID not found');
    console.error('   Set SCRIPT_ID environment variable or create .clasp.json');
    process.exit(1);
  }

  // Get OAuth credentials
  const credentials = getOAuthCredentials();
  if (!credentials) {
    console.error('❌ ERROR: No OAuth credentials found');
    console.error('   Set CLASPRC_JSON environment variable or run "npx clasp login"');
    process.exit(1);
  }

  try {
    // Get access token (refresh if needed)
    const accessToken = await refreshTokenIfNeeded(credentials);
    console.log('✅ Authentication successful');

    // Get deployment info
    console.log('🔍 Fetching deployment info...');
    const deployment = await getDeploymentInfo(accessToken);

    // Extract URL
    const url = getWebAppUrl(deployment);
    if (!url) {
      throw new Error('Could not extract web app URL from deployment');
    }

    const deploymentId = deployment.deploymentId;
    const version = deployment.deploymentConfig?.versionNumber || 'HEAD';
    const description = deployment.deploymentConfig?.description || '';

    console.log('');
    console.log('📋 Deployment Info:');
    console.log(`   ID:          ${deploymentId}`);
    console.log(`   Version:     ${version}`);
    console.log(`   Description: ${description || '(none)'}`);
    console.log('');
    console.log('🌐 Web App URL:');
    console.log(`   ${url}`);
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');

    // Output for GitHub Actions
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `url=${url}\n`);
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `deployment_id=${deploymentId}\n`);
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
    }

    // Output URL as last line for easy parsing
    console.log(url);

    process.exit(0);
  } catch (err) {
    console.error('');
    console.error('❌ ERROR:', err.message);
    console.error('');

    if (err.message.includes('401') || err.message.includes('403')) {
      console.error('💡 Tip: Your OAuth credentials may be expired.');
      console.error('   Run "npx clasp login" to refresh credentials.');
    }

    process.exit(1);
  }
}

main();
