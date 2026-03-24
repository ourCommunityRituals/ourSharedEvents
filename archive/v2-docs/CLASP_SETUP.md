# Clasp Setup Guide for CI/CD

This guide explains how to configure Google Apps Script deployment with clasp in GitHub Actions.

## Overview

The CI/CD pipeline automatically deploys to Google Apps Script on pushes to the `main` branch. This requires two GitHub secrets to be configured:

1. `CLASPRC_JSON` - OAuth credentials for clasp
2. `SCRIPT_ID` - Your Google Apps Script project ID

## Prerequisites

- A Google account with access to Google Apps Script
- Node.js and npm installed locally
- `@google/clasp` installed globally: `npm install -g @google/clasp`

## Step 1: Login to Clasp Locally

On your local machine, authenticate with clasp:

```bash
clasp login
```

This will:
1. Open a browser window for Google OAuth authentication
2. Ask you to grant permissions to clasp
3. Create a `.clasprc.json` file in your home directory (usually `~/.clasprc.json`)

## Step 2: Get Your CLASPRC_JSON Secret

After logging in, read the contents of your `.clasprc.json` file:

**On macOS/Linux:**
```bash
cat ~/.clasprc.json
```

**On Windows:**
```powershell
type %USERPROFILE%\.clasprc.json
```

The file should look like one of these formats (depending on your clasp version):

**Clasp 3.x format (newest - v3.0+):**
```json
{
  "tokens": {
    "default": {
      "client_id": "1072944905499-...",
      "client_secret": "...",
      "type": "authorized_user",
      "refresh_token": "1//0e...",
      "access_token": "ya29.a0..."
    }
  }
}
```

**Clasp 2.x nested format (older versions):**
```json
{
  "token": {
    "access_token": "ya29.a0...",
    "refresh_token": "1//0e...",
    "scope": "https://www.googleapis.com/auth/...",
    "token_type": "Bearer",
    "expiry_date": 1234567890123
  },
  "oauth2ClientSettings": {
    "clientId": "1234567890-abc123.apps.googleusercontent.com",
    "clientSecret": "GOCSPX-...",
    "redirectUri": "http://localhost"
  },
  "isLocalCreds": false
}
```

**Clasp 2.x flat format:**
```json
{
  "access_token": "ya29.a0...",
  "refresh_token": "1//0e...",
  "scope": "https://www.googleapis.com/auth/...",
  "token_type": "Bearer",
  "expiry_date": 1234567890123
}
```

Copy the **entire contents** of this file. All three formats are supported by the CI/CD pipeline.

## Step 3: Get Your Script ID

If you already have a Google Apps Script project:

1. Open your script in the [Apps Script editor](https://script.google.com)
2. Click on **Project Settings** (gear icon)
3. Copy the **Script ID**

If you need to create a new project:

```bash
# Create a new Apps Script project
clasp create --title "MVP Event Toolkit" --type webapp --rootDir .

# This creates a .clasp.json file with your script ID
cat .clasp.json
```

The `.clasp.json` will contain your `scriptId`:

```json
{
  "scriptId": "1a2b3c4d5e6f7g8h9i0j",
  "rootDir": "."
}
```

## Step 4: Configure GitHub Secrets

1. Go to your GitHub repository
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**

### Add CLASPRC_JSON Secret

- **Name**: `CLASPRC_JSON`
- **Value**: Paste the entire contents of your `.clasprc.json` file (from Step 2)
- Click **Add secret**

### Add SCRIPT_ID Secret

- **Name**: `SCRIPT_ID`
- **Value**: Paste your Script ID (from Step 3)
- Click **Add secret**

## Step 5: Verify Setup

Push a change to the `main` branch and check the GitHub Actions logs. The deployment job should:

1. ✅ Validate that secrets are present
2. ✅ Validate that CLASPRC_JSON is valid JSON
3. ✅ Validate that access_token field exists
4. ✅ Successfully push to Apps Script

## Troubleshooting

### Error: "CLASPRC_JSON secret is not set"

- Make sure you created the secret with the exact name `CLASPRC_JSON` (case-sensitive)
- Verify the secret exists in **Settings** → **Secrets and variables** → **Actions**

### Error: "CLASPRC_JSON is not valid JSON"

- Ensure you copied the entire `.clasprc.json` file contents
- Check for any trailing spaces or newlines
- Validate the JSON using a tool like [jsonlint.com](https://jsonlint.com/)

### Error: "CLASPRC_JSON is missing required OAuth access_token field"

- Your `.clasprc.json` may be corrupted or incomplete
- Run `clasp logout` and then `clasp login` again to generate fresh credentials
- Verify the JSON structure matches one of the examples in Step 2 (either nested or flat format)
- Ensure you copied the entire file contents without truncation

### Error: "Script not found"

- Verify your `SCRIPT_ID` is correct
- Make sure the Google account used for `clasp login` has access to the script
- Check that the script hasn't been deleted

### Token Expired

OAuth tokens can expire. If deployments start failing after working previously:

1. Run `clasp login` again on your local machine
2. Get the new `.clasprc.json` contents
3. Update the `CLASPRC_JSON` secret in GitHub

## Security Notes

- **Never commit `.clasprc.json` to your repository** - it contains sensitive OAuth credentials
- The `.clasprc.json` is already in `.gitignore`
- GitHub secrets are encrypted and only exposed to GitHub Actions
- Limit access to repository settings to trusted team members
- Consider using a dedicated Google account for CI/CD deployments

## Local Development

For local development, you don't need to configure GitHub secrets. Just:

```bash
# Login (one time)
clasp login

# Pull latest from Apps Script
clasp pull

# Make changes to your code

# Push to Apps Script
clasp push

# Or use npm scripts
npm run push
npm run pull
```

## Pre-flight Validation

**Before configuring GitHub Actions**, validate your local setup:

```bash
./scripts/validate-clasp-setup.sh
```

This script will:
- ✅ Check Clasp installation
- ✅ Validate `.clasprc.json` format and OAuth fields
- ✅ Check token expiration
- ✅ Verify `.clasp.json` configuration
- ✅ Test connection to Google Apps Script
- ✅ Provide ready-to-use values for GitHub secrets

**Run this every time before updating GitHub secrets!**

## Additional Resources

### Documentation
- [Deployment Flow Guide](docs/DEPLOYMENT_FLOW.md) - Complete CI/CD pipeline visualization
- [GitHub Actions Debugging Guide](docs/CLASP_GITHUB_ACTIONS_DEBUG.md) - Comprehensive troubleshooting for Clasp issues
- [Validation Script](scripts/validate-clasp-setup.sh) - Local setup validation tool

### External Links
- [Clasp Documentation](https://github.com/google/clasp)
- [Google Apps Script Documentation](https://developers.google.com/apps-script)
- [GitHub Actions Secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets)

## Quick Reference

**Common Commands:**
```bash
# Validate setup before configuring GitHub
./scripts/validate-clasp-setup.sh

# Re-authenticate (when tokens expire)
clasp logout && clasp login

# Copy credentials to clipboard (macOS)
cat ~/.clasprc.json | pbcopy

# Test JSON format
cat ~/.clasprc.json | jq .

# Get Script ID
cat .clasp.json | jq -r '.scriptId'

# Test deployment locally
npm run push
```

**GitHub Secret Configuration:**
1. Validate locally: `./scripts/validate-clasp-setup.sh`
2. Copy credentials: `cat ~/.clasprc.json | pbcopy`
3. Go to: `https://github.com/YOUR_USERNAME/YOUR_REPO/settings/secrets/actions`
4. Create/Update secrets:
   - `CLASPRC_JSON`: Paste entire `.clasprc.json` contents
   - `SCRIPT_ID`: Your Apps Script project ID

**Troubleshooting:**
- See [GitHub Actions Debugging Guide](docs/CLASP_GITHUB_ACTIONS_DEBUG.md) for detailed troubleshooting
- See [Deployment Flow](docs/DEPLOYMENT_FLOW.md) for understanding the complete pipeline
