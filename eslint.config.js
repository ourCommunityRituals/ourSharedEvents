/**
 * ESLint Flat Config (ESLint v9+)
 *
 * Story 2.2: ESLint static code analysis configuration
 * Migrated from .eslintrc.json for compatibility with ESLint v9.
 * Includes Google Apps Script globals and test environment support.
 *
 * Key Rules:
 * - no-unused-vars: Error for production code (catches dead code)
 * - no-undef: Warn for .gs files (due to GAS cross-file concatenation)
 * - no-console: Warn for production code (use Logger/diag_ instead)
 * - semi: Error (consistent semicolon usage)
 * - no-var: Warn (prefer let/const)
 *
 * @see docs/CODING-STYLE.md for full coding style guide
 */

const js = require('@eslint/js');
const globals = require('globals');

// Google Apps Script platform globals
const gasGlobals = {
  SpreadsheetApp: 'readonly',
  ScriptApp: 'readonly',
  ContentService: 'readonly',
  HtmlService: 'readonly',
  CacheService: 'readonly',
  Utilities: 'readonly',
  FormApp: 'readonly',
  google: 'readonly',
  Logger: 'readonly',
  Session: 'readonly',
  UrlFetchApp: 'readonly',
  LockService: 'readonly',
  PropertiesService: 'readonly',
  DriveApp: 'readonly',
  DocumentApp: 'readonly',
  GmailApp: 'readonly',
  CalendarApp: 'readonly',
  Charts: 'readonly',
  Maps: 'readonly',
  CardService: 'readonly',
  MailApp: 'readonly',
};

// App-specific globals (from Code.gs, Config.gs, etc.)
// These are defined in various .gs files and used across the GAS project
const appGlobals = {
  // Result pattern
  ERR: 'readonly',
  Ok: 'readonly',
  Err: 'readonly',
  UserFriendlyErr_: 'readonly',
  runSafe: 'readonly',

  // Diagnostics
  diag_: 'readonly',
  logError: 'readonly',

  // Database/Sheet access
  getDb_: 'readonly',
  getStoreSheet_: 'readonly',
  _ensureAnalyticsSheet_: 'readonly',

  // Brand management
  findBrand_: 'readonly',
  findBrandByHost_: 'readonly',
  findTemplate_: 'readonly',
  findFormTemplate_: 'readonly',
  listFormTemplates_: 'readonly',
  loadBrands_: 'readonly',
  getBrandTemplateConfig_: 'readonly',
  getBrandFeatures_: 'readonly',
  isBrandFeatureEnabled_: 'readonly',

  // Admin/Security
  getAdminSecret_: 'readonly',
  setupAdminSecrets_: 'readonly',
  isValidAdminKey_: 'readonly',

  // URL handling
  resolveUrlAlias_: 'readonly',
  listUrlAliases_: 'readonly',
  isUrl: 'readonly',

  // Utilities
  safeJSONParse_: 'readonly',
  schemaCheck: 'readonly',
  MetricsUtils_calculateCTR: 'readonly',

  // Templates
  getTemplatesByTier_: 'readonly',
  getEventTemplates_: 'readonly',
  getGroupedTemplates_: 'readonly',
  TEMPLATE_TIER: 'readonly',

  // Global objects
  brand: 'readonly',
  TEMPLATES: 'readonly',
  BRANDS: 'readonly',
  FORM_TEMPLATES: 'readonly',
  ZEB: 'readonly',
};

// Security middleware globals
const securityGlobals = {
  SecurityMiddleware_sanitizeInput: 'readonly',
  SecurityMiddleware_sanitizeId: 'readonly',
  SecurityMiddleware_sanitizeSpreadsheetValue: 'readonly',
  SecurityMiddleware_sanitizeMetaForLogging: 'readonly',
  SecurityMiddleware_assertScopeAllowed: 'readonly',
  SecurityMiddleware_authenticateRequest: 'readonly',
  SecurityMiddleware_validateOrigin: 'readonly',
  SecurityMiddleware_generateCSRFToken: 'readonly',
  SecurityMiddleware_validateCSRFToken: 'readonly',
  SecurityMiddleware_generateJWT: 'readonly',
  SecurityMiddleware_gate: 'readonly',
  SecurityMiddleware_timingSafeCompare: 'readonly',
};

// Service globals
const serviceGlobals = {
  // Form Service
  FormService_listTemplates: 'readonly',
  FormService_createFromTemplate: 'readonly',
  FormService_generateShortlink: 'readonly',
  FormService_getResponseAnalytics: 'readonly',
  FormService_linkToEvent: 'readonly',

  // Sponsor Service
  SponsorService_calculateROI: 'readonly',
  SponsorService_validatePlacements: 'readonly',
  SponsorService_getSettings: 'readonly',
  SponsorService_getPortfolioSponsors: 'readonly',

  // Webhook Service
  WebhookService_register: 'readonly',
  WebhookService_unregister: 'readonly',
  WebhookService_list: 'readonly',
  WebhookService_deliver: 'readonly',
  WebhookService_test: 'readonly',
  WebhookService_getDeliveries: 'readonly',
  WebhookService_verifySignature: 'readonly',

  // Analytics Service
  AnalyticsService_logEvents: 'readonly',
  AnalyticsService_getEventReport: 'readonly',
  AnalyticsService_getSharedAnalytics: 'readonly',
  AnalyticsService_getTopSponsorsByClicks: 'readonly',

  // API Schemas
  ApiSchemas_validateRequest: 'readonly',
  ApiSchemas_validateResponse: 'readonly',
  ApiSchemas_getSchema: 'readonly',
  ApiSchemas_getAllSchemas: 'readonly',

  // Template Service
  TemplateService_migrateData: 'readonly',
  TemplateService_renderForm: 'readonly',
  TemplateService_composeTemplate: 'readonly',
};

// API globals
const apiGlobals = {
  api_translate: 'readonly',
  api_getTemplate: 'readonly',
  api_listTemplates: 'readonly',
  api_validateTemplateData: 'readonly',
  api_healthCheck: 'readonly',
  api_runDiagnostics: 'readonly',
  api_createShortlink: 'readonly',
  api_exportSharedReport: 'readonly',
  api_getSharedAnalytics: 'readonly',
  api_rebuildEventAnalytics: 'readonly',
  api_getAnalyticsRollupStatus: 'readonly',
  api_getEventTemplates: 'readonly',
  api_getPortfolioAnalyticsV2: 'readonly',
  api_getPortfolioSummaryV2: 'readonly',
  api_getPortfolioSponsorReportV2: 'readonly',
  api_getPortfolioSponsorsV2: 'readonly',

  // i18n
  i18n_detectLocale: 'readonly',
  i18n_formatDate: 'readonly',
  i18n_formatCurrency: 'readonly',
  i18n_setUserLocale: 'readonly',
  i18n_getSupportedLocales: 'readonly',

  // Entry points
  doGet: 'readonly',
  doPost: 'readonly',
  include: 'readonly',

  // Internal helpers used across files
  buildEventNameMap_: 'readonly',
  buildSponsorNameMap_: 'readonly',
  installAnalyticsRollupTrigger: 'readonly',
  removeAnalyticsRollupTrigger: 'readonly',
  scheduledRebuildEventAnalytics_: 'readonly',
  forceRebuildEventAnalytics: 'readonly',
  backupControlSheet: 'readonly',
  restoreFromBackup_: 'readonly',
  getBackupStats_: 'readonly',
};

// Combined app globals for .gs files
const allGasGlobals = {
  ...gasGlobals,
  ...appGlobals,
  ...securityGlobals,
  ...serviceGlobals,
  ...apiGlobals,
  // Browser globals needed in GAS context
  console: 'readonly',
  URL: 'readonly',
  atob: 'readonly',
  btoa: 'readonly',
};

// Combined globals for JS files
const allAppGlobals = {
  ...gasGlobals,
  ...appGlobals,
  ...securityGlobals,
  ...serviceGlobals,
  ...apiGlobals,
};

module.exports = [
  // Base recommended config
  js.configs.recommended,

  // Global ignores
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      'dist/**',
      'build/**',
      'playwright-report/**',
      'playwright-report-*/**',
      'test-results/**',
      '.test-results/**',
      'tests/load/**',
      // Archive folder - legacy V2 code not in active use
      'archive/**',
      // Generated files
      '**/*.min.js',
      '**/vendor/**',
      // TypeScript files - linted by TypeScript compiler, not ESLint
      '**/*.ts',
      '**/*.tsx',
    ],
  },

  // Default config for all JS files
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...allAppGlobals,
      },
    },
    rules: {
      // Critical rules - these cause CI to fail
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      'semi': ['error', 'always'],

      // Warning rules - tracked but won't fail CI immediately
      'no-console': 'warn',
      'no-undef': 'warn',
      'no-var': 'warn',

      // Style rules
      'quotes': 'off',
      'eqeqeq': ['warn', 'smart'],
      'curly': ['warn', 'multi-line'],
    },
  },

  // Google Apps Script files (.gs)
  // These files are concatenated by GAS, so globals defined in one file
  // are available in others. We include all app globals here.
  {
    files: ['**/*.gs', 'src/**/*.gs'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'script',
      globals: allGasGlobals,
    },
    rules: {
      // GAS-specific adjustments
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_|^api_|^Service_|^Middleware_',
        caughtErrorsIgnorePattern: '^_',
      }],
      'no-console': 'off', // GAS uses Logger, but console.log is also available
      'no-undef': 'warn', // Warn only - many cross-file references in GAS
      'semi': ['error', 'always'],
      'no-var': 'warn',
      // Disable no-redeclare for .gs files since they define app globals
      'no-redeclare': 'off',
    },
  },

  // Test files (Jest - Unit/Contract tests)
  {
    files: ['tests/**/*.js', '**/*.test.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.jest,
        ...allAppGlobals,
        test: 'readonly',
        expect: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        jest: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off', // Console is fine in tests
      'no-redeclare': 'off', // Tests often mock/redefine globals
    },
  },

  // E2E test files (Playwright - ESM)
  {
    files: ['tests/e2e/**/*.js', 'tests/e2e/**/*.spec.js', '**/*.spec.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': 'off',
      'no-console': 'off',
      'no-redeclare': 'off',
    },
  },

  // Smoke test files
  {
    files: ['tests/smoke/**/*.js', 'tests/api/**/*.ts', 'tests/ui/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': 'off',
      'no-console': 'off',
      'no-redeclare': 'off',
    },
  },

  // Triangle test files
  {
    files: ['tests/triangle/**/*.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.jest,
      },
    },
    rules: {
      'no-unused-vars': 'off',
      'no-console': 'off',
      'no-redeclare': 'off',
    },
  },

  // Scripts (Node.js CommonJS)
  {
    files: ['scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'script',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off', // Console is expected in CLI scripts
      'no-redeclare': 'off',
    },
  },

  // Scripts (Node.js ESM - .mjs files)
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      'no-redeclare': 'off',
    },
  },

  // Root-level utility scripts
  {
    files: ['*.js'],
    ignores: ['eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'script',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },

  // Cloudflare Worker files (ESM)
  {
    files: ['cloudflare-proxy/**/*.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      globals: {
        // Cloudflare Worker globals
        addEventListener: 'readonly',
        fetch: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        Headers: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        crypto: 'readonly',
        caches: 'readonly',
        console: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        atob: 'readonly',
        btoa: 'readonly',
        // Cloudflare KV/Durable Objects
        TEMPLATES_KV: 'readonly',
        ENV: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_|^DEPRECATED',
      }],
      'no-console': 'off', // Console logging is used for observability
    },
  },

  // Config files
  {
    files: ['*.config.js', '*.config.mjs', 'playwright*.config.*'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': 'off',
    },
  },
];
