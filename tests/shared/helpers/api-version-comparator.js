/**
 * API Version Comparator (Story 3.2)
 *
 * Compares API responses between staging and production environments
 * to detect structural contract differences.
 *
 * Features:
 * - Structural comparison (ignores data-specific values)
 * - Deep object comparison with path tracking
 * - Field presence detection (fields in one env but not the other)
 * - Type mismatch detection
 * - Configurable ignored fields (timestamps, IDs, etc.)
 *
 * Usage:
 *   const { compareResponses, compareEnvironments } = require('./api-version-comparator');
 *   const report = compareResponses(stagingResponse, prodResponse);
 *   const fullReport = await compareEnvironments(endpoints);
 *
 * @see API_CONTRACT.md
 */

const https = require('https');
const http = require('http');

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Default environment URLs
 */
const ENVIRONMENTS = {
  staging: {
    name: 'Staging',
    baseUrl: 'https://api-stg.eventangle.com',
    // Fallback to stg.eventangle.com if api-stg is not available
    fallbackUrl: 'https://stg.eventangle.com'
  },
  production: {
    name: 'Production',
    baseUrl: 'https://api.eventangle.com',
    // Fallback to www.eventangle.com
    fallbackUrl: 'https://www.eventangle.com'
  }
};

/**
 * Fields to ignore during comparison (dynamic data)
 * These fields are expected to differ between environments
 */
const IGNORED_FIELDS = [
  'time',           // Timestamp will always differ
  'buildId',        // Build ID may differ between deploys
  'corrId',         // Correlation ID is request-specific
  'etag',           // ETag is data-specific
  'eventId',        // IDs are environment-specific
  'sponsorId',
  'id',
  'createdAt',
  'updatedAt',
  'lastModified',
  'version'
];

/**
 * Fields to ignore for value comparison but check for presence
 * These fields should exist in both environments but may have different values
 */
const VALUE_IGNORED_FIELDS = [
  'brandId',        // Brand may differ in test data
  'message',        // Error messages may be localized
  'count',          // Count depends on data
  'total'
];

/**
 * Critical endpoints to compare
 * These represent the core contract boundary between environments
 */
const CRITICAL_ENDPOINTS = [
  // Flat status endpoints
  {
    name: 'status',
    path: '/exec?p=status&brand=root',
    schemaId: 'status',
    description: 'System health status (flat format)'
  },
  {
    name: 'statusmvp',
    path: '/exec?p=statusmvp&brand=root',
    schemaId: 'status-mvp',
    description: 'MVP analytics health status (flat format)'
  },
  // Envelope endpoints (use test data that should exist in both envs)
  {
    name: 'getEventTemplates',
    path: '/exec?p=getEventTemplates&brand=root',
    schemaId: 'api-envelope',
    description: 'Event templates list'
  }
];

// ============================================================================
// STRUCTURAL COMPARISON
// ============================================================================

/**
 * Get the structural type of a value
 * @param {*} value - Value to check
 * @returns {string} Type descriptor
 */
const getStructuralType = (value) => {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'array';
  return typeof value;
};

/**
 * Extract structural schema from a value (recursive)
 * @param {*} value - Value to analyze
 * @param {string} path - Current path (for debugging)
 * @param {Set} visited - Visited references (cycle detection)
 * @returns {Object} Structural schema
 */
const extractStructure = (value, path = '', visited = new Set()) => {
  const type = getStructuralType(value);

  if (type === 'null' || type === 'undefined') {
    return { type };
  }

  if (type === 'array') {
    if (value.length === 0) {
      return { type: 'array', itemType: 'unknown' };
    }
    // Analyze first item for array structure
    const itemStructure = extractStructure(value[0], `${path}[0]`, visited);
    return { type: 'array', itemType: itemStructure };
  }

  if (type === 'object') {
    // Cycle detection
    if (visited.has(value)) {
      return { type: 'object', circular: true };
    }
    visited.add(value);

    const fields = {};
    for (const key of Object.keys(value).sort()) {
      fields[key] = extractStructure(value[key], `${path}.${key}`, visited);
    }
    return { type: 'object', fields };
  }

  // Primitives
  return { type };
};

/**
 * Compare two structural schemas
 * @param {Object} structA - First structure
 * @param {Object} structB - Second structure
 * @param {string} path - Current path
 * @param {string[]} ignoredFields - Fields to ignore
 * @returns {Array} Array of differences
 */
const compareStructures = (structA, structB, path = '', ignoredFields = IGNORED_FIELDS) => {
  const differences = [];
  const pathKey = path.split('.').pop() || '';

  // Check if this field should be ignored
  if (ignoredFields.includes(pathKey)) {
    return differences;
  }

  // Type mismatch
  if (structA.type !== structB.type) {
    differences.push({
      type: 'type_mismatch',
      path: path || '(root)',
      staging: structA.type,
      production: structB.type,
      severity: 'error'
    });
    return differences;
  }

  // Handle arrays
  if (structA.type === 'array') {
    if (structA.itemType && structB.itemType) {
      const itemDiffs = compareStructures(
        structA.itemType,
        structB.itemType,
        `${path}[]`,
        ignoredFields
      );
      differences.push(...itemDiffs);
    }
    return differences;
  }

  // Handle objects
  if (structA.type === 'object' && structA.fields && structB.fields) {
    const allKeys = new Set([
      ...Object.keys(structA.fields || {}),
      ...Object.keys(structB.fields || {})
    ]);

    for (const key of allKeys) {
      if (ignoredFields.includes(key)) continue;

      const newPath = path ? `${path}.${key}` : key;
      const fieldA = structA.fields[key];
      const fieldB = structB.fields[key];

      if (!fieldA) {
        differences.push({
          type: 'field_missing_staging',
          path: newPath,
          staging: null,
          production: fieldB.type,
          severity: 'warning'
        });
      } else if (!fieldB) {
        differences.push({
          type: 'field_missing_production',
          path: newPath,
          staging: fieldA.type,
          production: null,
          severity: 'warning'
        });
      } else {
        const fieldDiffs = compareStructures(fieldA, fieldB, newPath, ignoredFields);
        differences.push(...fieldDiffs);
      }
    }
  }

  return differences;
};

/**
 * Compare two API responses structurally
 * @param {Object} stagingResponse - Response from staging
 * @param {Object} prodResponse - Response from production
 * @param {Object} options - Comparison options
 * @returns {Object} Comparison report
 */
const compareResponses = (stagingResponse, prodResponse, options = {}) => {
  const {
    ignoredFields = IGNORED_FIELDS,
    endpointName = 'unknown'
  } = options;

  const stagingStructure = extractStructure(stagingResponse);
  const prodStructure = extractStructure(prodResponse);

  const differences = compareStructures(
    stagingStructure,
    prodStructure,
    '',
    ignoredFields
  );

  const errors = differences.filter(d => d.severity === 'error');
  const warnings = differences.filter(d => d.severity === 'warning');

  return {
    endpoint: endpointName,
    identical: differences.length === 0,
    compatible: errors.length === 0,
    differences,
    summary: {
      total: differences.length,
      errors: errors.length,
      warnings: warnings.length
    },
    structures: {
      staging: stagingStructure,
      production: prodStructure
    }
  };
};

// ============================================================================
// HTTP FETCHING
// ============================================================================

/**
 * Fetch JSON from a URL with timeout
 * @param {string} url - URL to fetch
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<Object>} Parsed JSON response
 */
const fetchJson = (url, timeout = 30000) => {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const protocol = urlObj.protocol === 'https:' ? https : http;

    const req = protocol.get(url, {
      timeout,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'API-Version-Comparator/1.0 (Story 3.2)'
      }
    }, (res) => {
      let data = '';

      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchJson(res.headers.location, timeout)
          .then(resolve)
          .catch(reject);
        return;
      }

      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: json
          });
        } catch (parseError) {
          reject(new Error(`Failed to parse JSON from ${url}: ${parseError.message}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Request failed for ${url}: ${err.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timeout for ${url}`));
    });
  });
};

/**
 * Fetch endpoint from an environment
 * @param {string} envKey - Environment key ('staging' or 'production')
 * @param {string} path - Endpoint path
 * @returns {Promise<Object>} Response data
 */
const fetchFromEnvironment = async (envKey, path) => {
  const env = ENVIRONMENTS[envKey];
  if (!env) {
    throw new Error(`Unknown environment: ${envKey}`);
  }

  const url = `${env.baseUrl}${path}`;

  try {
    return await fetchJson(url);
  } catch (primaryError) {
    // Try fallback URL
    if (env.fallbackUrl) {
      const fallbackUrl = `${env.fallbackUrl}${path}`;
      try {
        return await fetchJson(fallbackUrl);
      } catch (fallbackError) {
        throw new Error(
          `Both primary (${url}) and fallback (${fallbackUrl}) failed. ` +
          `Primary: ${primaryError.message}. Fallback: ${fallbackError.message}`
        );
      }
    }
    throw primaryError;
  }
};

// ============================================================================
// ENVIRONMENT COMPARISON
// ============================================================================

/**
 * Compare a single endpoint across environments
 * @param {Object} endpoint - Endpoint configuration
 * @returns {Promise<Object>} Comparison result
 */
const compareEndpoint = async (endpoint) => {
  const result = {
    name: endpoint.name,
    path: endpoint.path,
    description: endpoint.description,
    timestamp: new Date().toISOString(),
    staging: { success: false, error: null, response: null },
    production: { success: false, error: null, response: null },
    comparison: null
  };

  // Fetch from both environments in parallel
  const [stagingResult, prodResult] = await Promise.allSettled([
    fetchFromEnvironment('staging', endpoint.path),
    fetchFromEnvironment('production', endpoint.path)
  ]);

  // Process staging result
  if (stagingResult.status === 'fulfilled') {
    result.staging.success = true;
    result.staging.response = stagingResult.value;
  } else {
    result.staging.error = stagingResult.reason.message;
  }

  // Process production result
  if (prodResult.status === 'fulfilled') {
    result.production.success = true;
    result.production.response = prodResult.value;
  } else {
    result.production.error = prodResult.reason.message;
  }

  // Compare if both succeeded
  if (result.staging.success && result.production.success) {
    result.comparison = compareResponses(
      result.staging.response.body,
      result.production.response.body,
      { endpointName: endpoint.name }
    );
  }

  return result;
};

/**
 * Compare all critical endpoints across environments
 * @param {Array} endpoints - Endpoints to compare (defaults to CRITICAL_ENDPOINTS)
 * @returns {Promise<Object>} Full comparison report
 */
const compareEnvironments = async (endpoints = CRITICAL_ENDPOINTS) => {
  const startTime = Date.now();
  const results = [];

  for (const endpoint of endpoints) {
    const result = await compareEndpoint(endpoint);
    results.push(result);
  }

  const endTime = Date.now();
  const duration = endTime - startTime;

  // Calculate summary
  const summary = {
    timestamp: new Date().toISOString(),
    duration: `${duration}ms`,
    totalEndpoints: results.length,
    successfulComparisons: results.filter(r => r.comparison).length,
    failedFetches: results.filter(r => !r.staging.success || !r.production.success).length,
    identicalContracts: results.filter(r => r.comparison?.identical).length,
    compatibleContracts: results.filter(r => r.comparison?.compatible).length,
    contractMismatches: results.filter(r => r.comparison && !r.comparison.compatible).length
  };

  // Determine overall status
  let status = 'pass';
  if (summary.failedFetches > 0) {
    status = 'error';
  } else if (summary.contractMismatches > 0) {
    status = 'fail';
  } else if (summary.identicalContracts < summary.successfulComparisons) {
    status = 'warning';
  }

  return {
    status,
    summary,
    results,
    environments: ENVIRONMENTS
  };
};

// ============================================================================
// REPORT FORMATTING
// ============================================================================

/**
 * Format comparison report for console output
 * @param {Object} report - Comparison report
 * @returns {string} Formatted report
 */
const formatReport = (report) => {
  const lines = [];
  const divider = '='.repeat(70);

  lines.push(divider);
  lines.push('API VERSION COMPATIBILITY REPORT (Story 3.2)');
  lines.push(divider);
  lines.push('');

  // Summary
  lines.push('SUMMARY');
  lines.push('-'.repeat(40));
  lines.push(`Status:        ${report.status.toUpperCase()}`);
  lines.push(`Timestamp:     ${report.summary.timestamp}`);
  lines.push(`Duration:      ${report.summary.duration}`);
  lines.push(`Endpoints:     ${report.summary.totalEndpoints}`);
  lines.push(`Compared:      ${report.summary.successfulComparisons}`);
  lines.push(`Identical:     ${report.summary.identicalContracts}`);
  lines.push(`Compatible:    ${report.summary.compatibleContracts}`);
  lines.push(`Mismatches:    ${report.summary.contractMismatches}`);
  lines.push(`Fetch Errors:  ${report.summary.failedFetches}`);
  lines.push('');

  // Environment info
  lines.push('ENVIRONMENTS');
  lines.push('-'.repeat(40));
  lines.push(`Staging:    ${report.environments.staging.baseUrl}`);
  lines.push(`Production: ${report.environments.production.baseUrl}`);
  lines.push('');

  // Per-endpoint results
  lines.push('ENDPOINT RESULTS');
  lines.push('-'.repeat(40));

  for (const result of report.results) {
    lines.push('');
    lines.push(`[${result.name}]`);
    lines.push(`  Path: ${result.path}`);
    lines.push(`  Description: ${result.description}`);

    if (result.staging.error) {
      lines.push(`  Staging: ERROR - ${result.staging.error}`);
    } else {
      lines.push(`  Staging: OK (HTTP ${result.staging.response?.status || 'unknown'})`);
    }

    if (result.production.error) {
      lines.push(`  Production: ERROR - ${result.production.error}`);
    } else {
      lines.push(`  Production: OK (HTTP ${result.production.response?.status || 'unknown'})`);
    }

    if (result.comparison) {
      const c = result.comparison;
      if (c.identical) {
        lines.push('  Contract: IDENTICAL');
      } else if (c.compatible) {
        lines.push(`  Contract: COMPATIBLE (${c.summary.warnings} warnings)`);
        for (const diff of c.differences) {
          lines.push(`    - [${diff.severity}] ${diff.path}: ${diff.type}`);
        }
      } else {
        lines.push(`  Contract: MISMATCH (${c.summary.errors} errors, ${c.summary.warnings} warnings)`);
        for (const diff of c.differences) {
          lines.push(`    - [${diff.severity}] ${diff.path}: ${diff.type}`);
          if (diff.staging !== null) lines.push(`      Staging: ${diff.staging}`);
          if (diff.production !== null) lines.push(`      Production: ${diff.production}`);
        }
      }
    } else {
      lines.push('  Contract: NOT COMPARED (fetch failed)');
    }
  }

  lines.push('');
  lines.push(divider);
  lines.push(`Overall Status: ${report.status.toUpperCase()}`);
  lines.push(divider);

  return lines.join('\n');
};

/**
 * Format report as JSON for CI systems
 * @param {Object} report - Comparison report
 * @returns {string} JSON string
 */
const formatJsonReport = (report) => {
  return JSON.stringify(report, null, 2);
};

/**
 * Format report as Markdown for GitHub
 * @param {Object} report - Comparison report
 * @returns {string} Markdown string
 */
const formatMarkdownReport = (report) => {
  const lines = [];

  // Status badge
  const statusEmoji = {
    pass: ':white_check_mark:',
    warning: ':warning:',
    fail: ':x:',
    error: ':bangbang:'
  };

  lines.push(`# API Version Compatibility Report ${statusEmoji[report.status] || ''}`);
  lines.push('');
  lines.push(`**Story 3.2**: Staging/Production API Contract Comparison`);
  lines.push('');

  // Summary table
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Status | **${report.status.toUpperCase()}** |`);
  lines.push(`| Timestamp | ${report.summary.timestamp} |`);
  lines.push(`| Duration | ${report.summary.duration} |`);
  lines.push(`| Endpoints Tested | ${report.summary.totalEndpoints} |`);
  lines.push(`| Successful Comparisons | ${report.summary.successfulComparisons} |`);
  lines.push(`| Identical Contracts | ${report.summary.identicalContracts} |`);
  lines.push(`| Contract Mismatches | ${report.summary.contractMismatches} |`);
  lines.push('');

  // Environments
  lines.push('## Environments');
  lines.push('');
  lines.push(`- **Staging**: ${report.environments.staging.baseUrl}`);
  lines.push(`- **Production**: ${report.environments.production.baseUrl}`);
  lines.push('');

  // Endpoint details
  lines.push('## Endpoint Results');
  lines.push('');

  for (const result of report.results) {
    const icon = result.comparison?.identical
      ? ':white_check_mark:'
      : result.comparison?.compatible
        ? ':warning:'
        : result.comparison
          ? ':x:'
          : ':grey_question:';

    lines.push(`### ${icon} ${result.name}`);
    lines.push('');
    lines.push(`- **Path**: \`${result.path}\``);
    lines.push(`- **Description**: ${result.description}`);
    lines.push(`- **Staging**: ${result.staging.success ? 'OK' : `Error: ${result.staging.error}`}`);
    lines.push(`- **Production**: ${result.production.success ? 'OK' : `Error: ${result.production.error}`}`);

    if (result.comparison) {
      const c = result.comparison;
      if (c.identical) {
        lines.push('- **Contract**: Identical :white_check_mark:');
      } else if (c.differences.length > 0) {
        lines.push('');
        lines.push('#### Differences');
        lines.push('');
        lines.push('| Path | Type | Staging | Production | Severity |');
        lines.push('|------|------|---------|------------|----------|');
        for (const diff of c.differences) {
          lines.push(`| \`${diff.path}\` | ${diff.type} | ${diff.staging || '-'} | ${diff.production || '-'} | ${diff.severity} |`);
        }
      }
    }
    lines.push('');
  }

  return lines.join('\n');
};

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Core comparison
  compareResponses,
  compareStructures,
  extractStructure,
  getStructuralType,

  // Environment comparison
  compareEndpoint,
  compareEnvironments,

  // HTTP utilities
  fetchJson,
  fetchFromEnvironment,

  // Report formatting
  formatReport,
  formatJsonReport,
  formatMarkdownReport,

  // Configuration
  ENVIRONMENTS,
  CRITICAL_ENDPOINTS,
  IGNORED_FIELDS,
  VALUE_IGNORED_FIELDS
};
