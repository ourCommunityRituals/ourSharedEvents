/**
 * Deployment IDs Configuration
 *
 * Cloudflare Worker deployment configuration.
 * GAS deployment IDs have been archived — this module now provides
 * Worker-era defaults and stubs for backward compatibility.
 *
 * @module config/deployment-ids
 */

// Stubs for backward compatibility — callers that import these
// will get empty strings. The active system uses BASE_URL env var.
module.exports = {
  STAGING_SCRIPT_ID: '',
  STAGING_DEPLOYMENT_ID: '',
  STAGING_WEB_APP_URL: '',
  STAGING_GAS_EDIT_URL: '',

  PROD_SCRIPT_ID: '',
  PROD_DEPLOYMENT_ID: '',
  PROD_WEB_APP_URL: '',
  PROD_GAS_EDIT_URL: '',

  PRODUCTION_DEPLOYMENT_ID: '',
  PRODUCTION_SCRIPT_ID: '',
  GAS_PRODUCTION_URL: '',
  GAS_STAGING_URL: '',

  getDeploymentConfig() {
    return { scriptId: '', deploymentId: '', webAppUrl: '', gasEditUrl: '' };
  },
  buildWebAppUrl() {
    return '';
  },
  buildGasEditUrl() {
    return '';
  },
  isValidDeploymentId() {
    return false;
  },
  isValidScriptId() {
    return false;
  },
};
