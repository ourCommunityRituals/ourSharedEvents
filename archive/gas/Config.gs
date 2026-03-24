// === Zeventbook Production Config ===
// Extended event model with full Triangle support

const ZEB = Object.freeze({
  APP_TITLE: 'Zeventbook',
  BUILD_ID: 'mvp-v19',
  CONTRACT_VER: '1.0.0', // EVENT_CONTRACT.md v1.0.0

  // === Friendly URL Configuration ===
  // When set, generates user-facing URLs using this base instead of raw GAS URL
  // Used for: QR codes, shareable links, display URLs
  // Leave empty to use raw GAS URL (for development/testing)
  FRIENDLY_BASE_URL: 'https://www.eventangle.com',  // Production friendly domain
  FRIENDLY_BASE_URL_DEV: '',  // Empty = use raw GAS URL for development

  // === Feature Flags ===
  // Controls which features are active in the current deployment
  // Set to false to defer non-MVP features without removing code
  //
  // Tags: [MVP] = v1 production, [V2+] = deferred, [Internal] = tooling only
  FEATURE_FLAGS: {
    // [MVP] Core Features (always enabled for v1 production)
    EVENTS: true,           // [MVP] Event CRUD operations
    SPONSORS: true,         // [MVP] Sponsor management (basic)
    ANALYTICS: true,        // [MVP] Basic analytics and reporting
    FORMS: true,            // [MVP] Google Forms integration
    SHORTLINKS: true,       // [MVP] URL shortening

    // [MVP] Portfolio Features (enabled for parent organizations)
    PORTFOLIO_ANALYTICS: true,  // [MVP] Basic parent org portfolio reporting (uses MVP endpoints)

    // ─────────────────────────────────────────────────────────────────────────
    // [V2] DEFERRED FEATURES - NOT ENABLED FOR MVP
    // ─────────────────────────────────────────────────────────────────────────
    // These features are blocked by check-rpc-inventory.js V2 quarantine.
    // Set to true AND update check-rpc-inventory.js to enable.

    // [V2] Template Management UI (hidden from early bar pilots)
    TEMPLATE_MANAGEMENT_V2: false,

    // [V2] Portfolio Analytics V2 - Multi-event exports, advanced filtering
    // Blocked endpoints: api_exportSharedReport, api_getPortfolioAnalyticsV2
    // UI: Export/Filter/Portfolio buttons hidden (display:none) in SharedReport.html
    PORTFOLIO_V2: false,

    // Story 16: V2 features archived - code moved to archive/v2-code/
    // WEBHOOKS, I18N, ADVANCED_ANALYTICS, SPONSOR_SELF_SERVICE removed
  },

  // Customer-Friendly URL Routing
  // Maps friendly URLs to technical parameters for better UX
  // Example: /abc/events → ?brand=abc&p=public
  //          /abc/manage → ?brand=abc&p=admin
  URL_ALIASES: {
    // Public-facing aliases (no authentication required)
    'events': { page: 'public', label: 'Events', public: true },
    'schedule': { page: 'public', label: 'Schedule', public: true },
    'calendar': { page: 'public', label: 'Calendar', public: true },

    // Admin/Management aliases (authentication required)
    'manage': { page: 'admin', label: 'Management', public: false },
    'admin': { page: 'admin', label: 'Admin', public: false },
    'create': { page: 'admin', label: 'Create Event', public: false },
    'dashboard': { page: 'admin', label: 'Dashboard', public: false },
    // Story 16: Removed planner, cards - pages archived in v2-code

    // Display aliases (for TV/kiosks)
    'display': { page: 'display', label: 'Display', public: true },
    'tv': { page: 'display', label: 'TV Display', public: true },
    'kiosk': { page: 'display', label: 'Kiosk', public: true },
    'screen': { page: 'display', label: 'Screen', public: true },

    // Marketing/Promotional aliases
    'posters': { page: 'poster', label: 'Posters', public: true },
    'poster': { page: 'poster', label: 'Poster', public: true },
    'flyers': { page: 'poster', label: 'Flyers', public: true },

    // Analytics aliases
    'analytics': { page: 'report', label: 'Analytics', public: false },
    'reports': { page: 'report', label: 'Reports', public: false },
    'insights': { page: 'report', label: 'Insights', public: false },
    'stats': { page: 'report', label: 'Statistics', public: false },

    // Utility aliases
    'status': { page: 'status', label: 'Status', public: true },
    'health': { page: 'status', label: 'Health Check', public: true },
    'ping': { page: 'ping', label: 'Ping', public: true },  // Ultra-simple uptime check
    'whoami': { page: 'whoami', label: 'Whoami', public: true }  // Story 4: Deployment/account info for CI
    // V2 aliases removed: teams, picker, randomizer, portfolio - router locked to MVP surfaces
    // Story 16: Removed docs, api - ApiDocs.html archived in v2-code
  },

  // Brand URL Templates
  // Defines how brands can customize their URLs
  BRAND_URL_PATTERNS: {
    // Pattern: /{brand}/{alias}
    // Example: /abc/events, /cbc/manage
    enableBrandPrefix: true,

    // Pattern: subdomain routing (requires DNS)
    // Example: abc.zeventbooks.com/events
    enableSubdomainRouting: false,

    // Custom aliases per brand (optional)
    // Allows brands to create branded URLs
    customAliases: {
      // ABC (Parent Organization) - Custom URLs
      'abc': {
        'tournaments': { page: 'public', label: 'Tournaments', public: true },
        'leagues': { page: 'public', label: 'Leagues', public: true },
        'bocce': { page: 'public', label: 'Bocce Events', public: true },
        'network': { page: 'report', label: 'Network Analytics', public: false }  // Parent-level reporting
      },

      // CBC (Child Brand) - Custom URLs
      'cbc': {
        'tournaments': { page: 'public', label: 'CBC Tournaments', public: true },
        'club-events': { page: 'public', label: 'Club Events', public: true },
        'register': { page: 'admin', label: 'Register Event', public: false }
      },

      // CBL (Child Brand) - Custom URLs
      'cbl': {
        'seasons': { page: 'public', label: 'Seasons', public: true },
        'league-events': { page: 'public', label: 'League Events', public: true },
        'schedule': { page: 'public', label: 'Schedule', public: true }
      }
    }
  },

  // Demo Mode Configuration
  // Activated via ?demo=true URL parameter
  // Use cases: Development testing, UAT, stakeholder demos, screenshots/videos
  DEMO_MODE: {
    // Visual indicators
    showBadge: true,              // Show "DEMO MODE" badge
    badgeText: '🧪 DEMO MODE',    // Badge text
    badgeColor: '#667eea',        // Badge color

    // Development & UAT features
    showDebugPanel: true,         // Show debug info panel
    showApiTiming: true,          // Log API response times
    showErrorDetails: true,       // Show detailed error messages
    enableConsoleLogging: true,   // Enhanced console logs

    // Sample data features
    enablePrefill: true,          // Enable sample data auto-fill
    showPrefillButton: true,      // Show "Fill Sample Data" button

    // Feature highlighting (for stakeholder demos)
    highlightNewFeatures: true,   // Add badges/glow to new features
    showHelpTooltips: true,       // Extra help tooltips

    // Screenshot/video mode
    showWatermark: false,         // Optional "DEMO" watermark (set to true for videos)
    hideRealData: true,           // Hide real user data in demo mode

    // Sample data templates
    sampleEvent: {
      name: 'Community Fundraiser Night 2025',
      dateISO: '2025-08-15',
      timeISO: '18:00',
      location: 'Main Street Tavern',
      entity: 'Community Events',
      summary: 'Join us for a great night out! All proceeds support local programs.',
      imageUrl: 'https://picsum.photos/800/400?random=1',
      sponsorIds: ''
    },

    sampleSponsor: {
      name: 'Local Pizza Co.',
      website: 'https://example.com',
      tier: 'Gold',
      entity: 'Community Events',
      logoUrl: 'https://picsum.photos/200/200?random=2'
    }
  },

  // Display/TV Mode Configuration
  // Settings for Display.html TV display surface
  // All values computed from Config + Template + Brand; no extra DB fields needed
  DISPLAY_CONFIG: {
    // Default rotation settings (can be overridden per brand/template)
    rotation: {
      sponsorSlots: 4,           // How many sponsor tiles to show at once
      rotationMs: 8000,          // Cycle interval in milliseconds (8 seconds)
      refreshMs: 300000          // Page refresh interval (5 minutes)
    },

    // Default layout settings
    layout: {
      hasSidePane: true,         // Show sponsor side panel
      emphasis: 'hero'           // 'scores' | 'sponsors' | 'hero' - what to emphasize
    },

    // === V2 PANE ROTATION ENGINE ===
    // Defines available pane types for rotation mode
    // Schema: settings.displayRotation in /schemas/event.schema.json
    paneTypes: {
      'public': {
        label: 'Event Page',
        description: 'Embeds the public event page',
        defaultDwellMs: 30000    // 30 seconds default
      },
      'schedule': {
        label: 'Schedule',
        description: 'Full-screen schedule display',
        defaultDwellMs: 15000    // 15 seconds default
      },
      'standings': {
        label: 'Standings',
        description: 'Full-screen standings/leaderboard',
        defaultDwellMs: 15000    // 15 seconds default
      },
      'sponsors': {
        label: 'Sponsor Carousel',
        description: 'Rotating sponsor showcase',
        defaultDwellMs: 20000    // 20 seconds default
      },
      'custom': {
        label: 'Custom URL',
        description: 'Embed any URL (if embeddable)',
        defaultDwellMs: 20000    // 20 seconds default
      }
    },

    // Default pane rotation (when displayRotation.enabled but no panes specified)
    defaultPanes: [
      { type: 'public', dwellMs: 30000 },
      { type: 'sponsors', dwellMs: 20000 }
    ],

    // Template-specific overrides (merged with defaults)
    templateOverrides: {
      'rec_league': {
        layout: { emphasis: 'scores', hasSidePane: true },
        rotation: { sponsorSlots: 3, rotationMs: 6000 },
        // V2: Rotation panes when enabled
        defaultPanes: [
          { type: 'standings', dwellMs: 20000, title: 'League Standings' },
          { type: 'schedule', dwellMs: 15000, title: 'Upcoming Games' },
          { type: 'sponsors', dwellMs: 15000 },
          { type: 'public', dwellMs: 30000 }
        ]
      },
      'bocce': {
        layout: { emphasis: 'scores', hasSidePane: true },
        rotation: { sponsorSlots: 3, rotationMs: 6000 },
        // Bocce league display - emphasize standings and schedule
        defaultPanes: [
          { type: 'standings', dwellMs: 20000, title: 'Bocce Standings' },
          { type: 'schedule', dwellMs: 15000, title: 'Upcoming Matches' },
          { type: 'sponsors', dwellMs: 15000 },
          { type: 'public', dwellMs: 30000 }
        ]
      },
      'bar_night': {
        layout: { emphasis: 'sponsors', hasSidePane: true },
        rotation: { sponsorSlots: 4, rotationMs: 10000 },
        // V2: Bar nights emphasize sponsors
        defaultPanes: [
          { type: 'sponsors', dwellMs: 25000 },
          { type: 'public', dwellMs: 35000 }
        ]
      },
      'trivia': {
        layout: { emphasis: 'hero', hasSidePane: false },
        rotation: { sponsorSlots: 2, rotationMs: 12000 },
        // V2: Trivia shows standings between rounds
        defaultPanes: [
          { type: 'standings', dwellMs: 20000, title: 'Trivia Leaderboard' },
          { type: 'sponsors', dwellMs: 15000 },
          { type: 'public', dwellMs: 25000 }
        ]
      },
      'fundraiser': {
        layout: { emphasis: 'sponsors', hasSidePane: true },
        rotation: { sponsorSlots: 6, rotationMs: 5000 },
        // V2: Fundraisers maximize sponsor visibility
        defaultPanes: [
          { type: 'sponsors', dwellMs: 30000, title: 'Thank You to Our Sponsors!' },
          { type: 'public', dwellMs: 30000 }
        ]
      },
      'darts': {
        layout: { emphasis: 'scores', hasSidePane: true },
        rotation: { sponsorSlots: 3, rotationMs: 8000 },
        defaultPanes: [
          { type: 'standings', dwellMs: 20000, title: 'Darts Standings' },
          { type: 'schedule', dwellMs: 15000 },
          { type: 'sponsors', dwellMs: 15000 },
          { type: 'public', dwellMs: 30000 }
        ]
      },
      'bags': {
        layout: { emphasis: 'scores', hasSidePane: true },
        rotation: { sponsorSlots: 3, rotationMs: 8000 },
        defaultPanes: [
          { type: 'standings', dwellMs: 20000, title: 'Cornhole Standings' },
          { type: 'schedule', dwellMs: 15000 },
          { type: 'sponsors', dwellMs: 15000 },
          { type: 'public', dwellMs: 30000 }
        ]
      },
      'pinball': {
        layout: { emphasis: 'scores', hasSidePane: false },
        rotation: { sponsorSlots: 2, rotationMs: 10000 },
        defaultPanes: [
          { type: 'standings', dwellMs: 25000, title: 'High Scores' },
          { type: 'sponsors', dwellMs: 15000 },
          { type: 'public', dwellMs: 20000 }
        ]
      }
    }
  }
});

// ============================================================================
// Canonical Base URL Configuration
// ============================================================================
// Single source of truth for user-facing URLs (QR codes, shareable links, posters)
// All URL construction for external/user-facing surfaces should use getBaseUrl()

/**
 * Get the canonical base URL for user-facing links
 *
 * This is the single source of truth for constructing user-facing URLs:
 * - QR codes (Public, Signup)
 * - Shareable links (Public, Display, Poster)
 * - Copy link buttons in Admin
 * - SharedReport links
 *
 * Returns the friendly domain (without path) for URL construction.
 * Individual surfaces append their paths: /events, /display, /poster, etc.
 *
 * @returns {string} Canonical base URL (e.g., 'https://www.eventangle.com')
 */
function getBaseUrl() {
  // Production: Use friendly URL from config
  // Development: Falls back to raw GAS URL
  if (ZEB.FRIENDLY_BASE_URL) {
    return ZEB.FRIENDLY_BASE_URL;
  }

  // Fallback to GAS URL (development/testing without Cloudflare)
  try {
    return ScriptApp.getService().getUrl();
  } catch (e) {
    // ScriptApp not available (e.g., during offline testing)
    return 'https://www.eventangle.com';
  }
}

/**
 * Get the canonical events page URL
 *
 * This is the primary user-facing URL shown in marketing materials,
 * CI logs, and documentation.
 *
 * @returns {string} Canonical events URL (e.g., 'https://www.eventangle.com/events')
 */
function getEventsBaseUrl() {
  return getBaseUrl() + '/events';
}

// ============================================================================
// Spreadsheet ID Configuration (Per-Brand Support)
// ============================================================================
// Spreadsheet IDs can be configured via Script Properties:
//
// Option 1: Shared spreadsheet for all brands
//   SPREADSHEET_ID = "1abc..."
//
// Option 2: Dedicated spreadsheet per brand (overrides shared)
//   SPREADSHEET_ID_ROOT = "1abc..."
//   SPREADSHEET_ID_ABC  = "1def..."
//   SPREADSHEET_ID_CBC  = "1ghi..."
//   SPREADSHEET_ID_CBL  = "1jkl..."
//
// Priority: Brand-specific > Shared > Default
//
// Setup functions (run in Apps Script editor):
//   setupSpreadsheetId('1abc...')           // Set shared for all brands
//   setupBrandSpreadsheetId('abc', '1def...') // Set dedicated for ABC brand
//   showScriptConfig()                        // View current configuration
//
// Default fallback (used if no Script Properties set):
const DEFAULT_SPREADSHEET_ID = '1SV1oZMq4GbZBaRc0YmTeV02Tl5KXWD8R6FZXC7TwVCQ';

/**
 * Get the spreadsheet ID for a brand from Script Properties
 *
 * Priority:
 *   1. SPREADSHEET_ID_{BRAND} (e.g., SPREADSHEET_ID_ABC) - per-brand spreadsheet
 *   2. SPREADSHEET_ID - shared spreadsheet for all brands
 *   3. DEFAULT_SPREADSHEET_ID - hardcoded fallback
 *
 * @param {string} brandId - Optional brand ID (root, abc, cbc, cbl)
 * @returns {string} Spreadsheet ID
 */
function getSpreadsheetId_(brandId) {
  try {
    const props = PropertiesService.getScriptProperties();

    // 1. Check for brand-specific spreadsheet ID
    if (brandId) {
      const brandKey = `SPREADSHEET_ID_${brandId.toUpperCase()}`;
      const brandSpreadsheetId = props.getProperty(brandKey);
      if (brandSpreadsheetId && brandSpreadsheetId.trim()) {
        return brandSpreadsheetId.trim();
      }
    }

    // 2. Check for shared spreadsheet ID
    const sharedId = props.getProperty('SPREADSHEET_ID');
    if (sharedId && sharedId.trim()) {
      return sharedId.trim();
    }
  } catch (e) {
    // Script Properties not available (e.g., during testing)
    console.warn('Could not read Script Properties, using default spreadsheet ID');
  }

  // 3. Fallback to default
  return DEFAULT_SPREADSHEET_ID;
}

// Brands (multi-brand architecture, single DB for MVP)
// SECURITY: Admin secrets moved to Script Properties for security
// Set via: File > Project Properties > Script Properties in Apps Script UI
// Or via: PropertiesService.getScriptProperties().setProperty('ADMIN_SECRET_ROOT', 'your-secret')
const BRANDS = [
  {
    id: 'root',
    name: 'Zeventbook',
    // Story 2: Added stg.eventangle.com for staging environment
    hostnames: ['zeventbook.io','www.zeventbook.io','eventangle.com','www.eventangle.com','stg.eventangle.com','api-stg.eventangle.com'],
    logoUrl: '', // Set to empty or use a valid HTTP/HTTPS URL
    // adminSecret: moved to Script Properties as 'ADMIN_SECRET_ROOT'
    store: { type: 'workbook', spreadsheetId: '1SV1oZMq4GbZBaRc0YmTeV02Tl5KXWD8R6FZXC7TwVCQ' },
    scopesAllowed: ['events', 'sponsors'],
    // Feature flags - Dark Launch / Kill Switch for non-critical features
    features: { sharedReportEnabled: true, sponsorAnalyticsEnabled: true }
  },
  {
    id: 'abc',
    name: 'American Bocce Co.',
    type: 'parent',  // Parent organization
    childBrands: ['cbc', 'cbl'],  // Child brands under ABC
    hostnames: ['americanbocceco.zeventbooks.io'],
    logoUrl: '', // Set to empty or use a valid HTTP/HTTPS URL
    // adminSecret: moved to Script Properties as 'ADMIN_SECRET_ABC'
    store: { type: 'workbook', spreadsheetId: '1SV1oZMq4GbZBaRc0YmTeV02Tl5KXWD8R6FZXC7TwVCQ' },
    scopesAllowed: ['events', 'sponsors'],
    features: { sharedReportEnabled: true, sponsorAnalyticsEnabled: true }
  },
  {
    id: 'cbc',
    name: 'Chicago Bocce Club',
    type: 'child',  // Child brand of ABC
    parentBrand: 'abc',  // Parent organization
    includeInPortfolioReports: true,  // Include this child in parent's brand portfolio analytics
    hostnames: ['chicagobocceclub.zeventbooks.io'],
    logoUrl: '', // Set to empty or use a valid HTTP/HTTPS URL
    // adminSecret: moved to Script Properties as 'ADMIN_SECRET_CBC'
    store: { type: 'workbook', spreadsheetId: '1SV1oZMq4GbZBaRc0YmTeV02Tl5KXWD8R6FZXC7TwVCQ' },
    scopesAllowed: ['events', 'sponsors'],
    features: { sharedReportEnabled: true, sponsorAnalyticsEnabled: true }
  },
  {
    id: 'cbl',
    name: 'Chicago Bocce League',
    type: 'child',  // Child brand of ABC
    parentBrand: 'abc',  // Parent organization
    includeInPortfolioReports: true,  // Include this child in parent's brand portfolio analytics
    hostnames: ['chicagobocceleague.zeventbooks.io'],
    logoUrl: '', // Set to empty or use a valid HTTP/HTTPS URL
    // adminSecret: moved to Script Properties as 'ADMIN_SECRET_CBL'
    store: { type: 'workbook', spreadsheetId: '1SV1oZMq4GbZBaRc0YmTeV02Tl5KXWD8R6FZXC7TwVCQ' },
    scopesAllowed: ['events', 'sponsors'],
    features: { sharedReportEnabled: true, sponsorAnalyticsEnabled: true }
  }
];

// ============================================================================
// [MVP] Brand → Event Template Mappings
// ============================================================================
// Controls which event templates each brand can access
// Templates are defined in TemplateService.gs (EVENT_TEMPLATES)

var BRAND_TEMPLATE_CONFIG = {
  // Root brand sees ALL templates
  root: {
    templates: [
      // [MVP] Core templates
      'bar_night', 'rec_league', 'bocce', 'custom',
      // [V2] Professional & Corporate
      'school', 'fundraiser', 'corporate',
      // [V2] Social & Celebration
      'wedding', 'photo_gallery', 'shower', 'bachelor_party',
      // [V2] Community & Faith
      'farmers_market', 'art_show', 'carnival', 'church', 'church_club',
      // [V2] Bar Games & Leagues
      'trivia', 'darts', 'bags', 'pinball'
    ],
    defaultTemplateId: 'custom'
  },
  // ABC - American Bocce Co. (Rec/bar-focused brand)
  // MVP templates: bocce, rec_league, bar_night, custom
  abc: {
    templates: ['bocce', 'rec_league', 'bar_night', 'custom', 'trivia', 'darts', 'bags', 'pinball', 'fundraiser', 'corporate'],
    defaultTemplateId: 'bocce'
  },
  // CBC - Chicago Bocce Club (Community-focused brand)
  // MVP templates: bocce, rec_league, custom
  cbc: {
    templates: ['bocce', 'rec_league', 'bar_night', 'custom', 'fundraiser', 'church', 'church_club', 'farmers_market', 'carnival'],
    defaultTemplateId: 'bocce'
  },
  // CBL - Chicago Bocce League (League-only brand)
  // MVP templates: bocce, rec_league, custom
  cbl: {
    templates: ['bocce', 'rec_league', 'custom', 'darts', 'bags', 'pinball'],
    defaultTemplateId: 'bocce'
  }
};

/**
 * Get template config for a brand (MVP)
 * @param {string} brandId - Brand identifier
 * @returns {Object} Brand template config (defaults to root if not found)
 */
function getBrandTemplateConfig_(brandId) {
  return BRAND_TEMPLATE_CONFIG[brandId] || BRAND_TEMPLATE_CONFIG.root;
}

/**
 * Get available templates for a brand (MVP)
 * @param {string} brandId - Brand identifier
 * @returns {Array} Array of template objects available for this brand
 */
function getTemplatesForBrand_(brandId) {
  var cfg = getBrandTemplateConfig_(brandId);
  var allTemplates = getEventTemplates_();
  return allTemplates.filter(function(t) {
    return cfg.templates.indexOf(t.id) !== -1;
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// TEMPLATES - Admin Form Field Definitions
//
// IMPORTANT: These define what Admin.html forms collect, NOT the canonical schema.
// The canonical schema is /schemas/event.schema.json
//
// Fields marked "IN SCHEMA" are part of the contract.
// Fields marked "LEGACY/V2" are stored but NOT returned by _buildEventContract_().
// ═══════════════════════════════════════════════════════════════════════════
const TEMPLATES = [
  {
    id: 'event',
    label: 'Event',
    fields: [
      // ─── IN SCHEMA: /schemas/event.schema.json ───────────────────────────
      { id: 'name',        type: 'text', required: true, maxLength: 200 },  // IN SCHEMA
      { id: 'startDateISO', type: 'date', required: false },                // IN SCHEMA (was: dateISO)
      { id: 'venue',       type: 'text', required: false },                 // IN SCHEMA (was: location/venueName)
      { id: 'signupUrl',   type: 'url',  required: false },                 // IN SCHEMA → links.signupUrl
      { id: 'externalData', type: 'json', required: false },                // IN SCHEMA (scheduleUrl, standingsUrl, bracketUrl only)
      { id: 'sponsorIds',  type: 'text', required: false },                 // Internal → hydrated to sponsors[]

      // ─── LEGACY: Backward compat mappings (Admin forms still use these) ──
      { id: 'dateISO',     type: 'date', required: false },  // LEGACY → maps to startDateISO
      { id: 'location',    type: 'text', required: false },  // LEGACY → maps to venue
      { id: 'venueName',   type: 'text', required: false },  // LEGACY → maps to venue
      { id: 'videoUrl',    type: 'url',  required: false },  // LEGACY → maps to media.videoUrl
      { id: 'mapEmbedUrl', type: 'url',  required: false },  // LEGACY → maps to media.mapUrl
      { id: 'galleryUrls', type: 'text', required: false },  // LEGACY → maps to media.gallery

      // ─── V2 CONCEPTS: Not in MVP schema, stored but not returned ─────────
      // { id: 'status',    type: 'text' },   // V2: draft|published|cancelled|completed
      // { id: 'timeISO',   type: 'time' },   // V2: MVP is date-only
      // { id: 'summary',   type: 'text' },   // V2: Event description
      // { id: 'notes',     type: 'text' },   // V2: Admin-only notes
      // { id: 'audience',  type: 'text' },   // V2: Target audience
      // { id: 'imageUrl',  type: 'url'  },   // V2: Hero image

      // ─── DEPRECATED: Remove after migration ──────────────────────────────
      { id: 'sections',    type: 'json', required: false },  // DEPRECATED → use settings.show*
      { id: 'ctaLabels',   type: 'json', required: false }   // DEPRECATED → use ctas.primary/secondary
      // REMOVED: checkinUrl, feedbackUrl, surveyUrl, entity, summaryLink, bio, bioLink, registerUrl, walkinUrl
    ]
  },
  {
    id: 'sponsor',
    label: 'Sponsor',
    // Schema: /schemas/sponsor.schema.json
    fields: [
      // ─── IN SCHEMA ───────────────────────────────────────────────────────
      { id: 'name',        type: 'text', required: true },   // IN SCHEMA
      { id: 'logoUrl',     type: 'url',  required: false },  // IN SCHEMA
      { id: 'linkUrl',     type: 'url',  required: false },  // IN SCHEMA (was: website)
      { id: 'placement',   type: 'text', required: false },  // IN SCHEMA: poster|display|public|tv-banner

      // ─── LEGACY: Backward compat ─────────────────────────────────────────
      { id: 'website',     type: 'url',  required: false }   // LEGACY → maps to linkUrl
      // REMOVED: tier, entity, startDate, endDate, displayOrder (V2 concepts)
    ]
  }
];

// Google Forms Templates - Pre-built form configurations
const FORM_TEMPLATES = [
  {
    id: 'sign-up',
    label: 'Sign-Up Form',
    description: 'Pre-registration for upcoming events',
    questions: [
      { title: 'Full Name', type: 'TEXT', required: true },
      { title: 'Email Address', type: 'TEXT', required: true },
      { title: 'Phone Number', type: 'TEXT', required: false },
      { title: 'Number of Attendees', type: 'MULTIPLE_CHOICE', choices: ['1', '2', '3', '4', '5+'], required: true },
      { title: 'Dietary Restrictions', type: 'TEXT', required: false },
      { title: 'How did you hear about this event?', type: 'MULTIPLE_CHOICE', choices: ['Social Media', 'Friend/Family', 'Website', 'Email', 'Other'], required: false },
      { title: 'Special Requests or Comments', type: 'PARAGRAPH_TEXT', required: false }
    ]
  },
  {
    id: 'check-in',
    label: 'Check-In Form',
    description: 'Quick check-in for registered attendees',
    questions: [
      { title: 'Full Name', type: 'TEXT', required: true },
      { title: 'Email Address', type: 'TEXT', required: true },
      { title: 'Confirmation Number (if available)', type: 'TEXT', required: false },
      { title: 'Number in Party', type: 'MULTIPLE_CHOICE', choices: ['1', '2', '3', '4', '5+'], required: true },
      { title: 'Additional Notes', type: 'PARAGRAPH_TEXT', required: false }
    ]
  },
  {
    id: 'walk-in',
    label: 'Walk-In Registration Form',
    description: 'Registration for walk-in attendees',
    questions: [
      { title: 'Full Name', type: 'TEXT', required: true },
      { title: 'Email Address', type: 'TEXT', required: true },
      { title: 'Phone Number', type: 'TEXT', required: false },
      { title: 'Number in Party', type: 'MULTIPLE_CHOICE', choices: ['1', '2', '3', '4', '5+'], required: true },
      { title: 'How did you hear about this event?', type: 'MULTIPLE_CHOICE', choices: ['Social Media', 'Friend/Family', 'Website', 'Email', 'Other'], required: false },
      { title: 'Additional Comments', type: 'PARAGRAPH_TEXT', required: false }
    ]
  },
  {
    id: 'survey',
    label: 'Post-Event Survey',
    description: 'Feedback and satisfaction survey',
    questions: [
      { title: 'Overall, how would you rate this event?', type: 'SCALE', scaleMin: 1, scaleMax: 5, scaleMinLabel: 'Poor', scaleMaxLabel: 'Excellent', required: true },
      { title: 'What did you enjoy most about the event?', type: 'PARAGRAPH_TEXT', required: false },
      { title: 'What could we improve for future events?', type: 'PARAGRAPH_TEXT', required: false },
      { title: 'Would you attend another event?', type: 'MULTIPLE_CHOICE', choices: ['Definitely', 'Probably', 'Not Sure', 'Probably Not', 'Definitely Not'], required: true },
      { title: 'Would you recommend this event to others?', type: 'SCALE', scaleMin: 1, scaleMax: 10, scaleMinLabel: 'Not Likely', scaleMaxLabel: 'Very Likely', required: true },
      { title: 'Any additional feedback?', type: 'PARAGRAPH_TEXT', required: false }
    ]
  }
];

// Accessors - inject dynamic spreadsheet ID from Script Properties
function loadBrands_() {
  return BRANDS.map(brand => ({
    ...brand,
    store: { ...brand.store, spreadsheetId: getSpreadsheetId_(brand.id) }
  }));
}

function findBrand_(id) {
  const brand = BRANDS.find(b => b.id === id);
  if (!brand) return null;

  // Inject dynamic spreadsheet ID (per-brand or shared)
  return {
    ...brand,
    store: { ...brand.store, spreadsheetId: getSpreadsheetId_(brand.id) }
  };
}

/**
 * Check if a feature is enabled
 * @param {string} featureName - Feature name (e.g., 'WEBHOOKS', 'I18N')
 * @returns {boolean} - True if feature is enabled
 */
function isFeatureEnabled_(featureName) {
  return ZEB.FEATURE_FLAGS[featureName] === true;
}

/**
 * Gate an API response based on feature flag
 * Returns a "feature disabled" error if the feature is not enabled
 * @param {string} featureName - Feature name to check
 * @returns {object|null} - Error envelope if disabled, null if enabled
 */
function requireFeature_(featureName) {
  if (!isFeatureEnabled_(featureName)) {
    return Err('FEATURE_DISABLED', `Feature '${featureName}' is not enabled in this deployment. Contact admin to enable.`);
  }
  return null;
}

// =============================================================================
// Brand-Level Feature Flags (Dark Launch / Kill Switch)
// =============================================================================
// Per-brand feature toggles for non-critical features like SharedReport and
// SponsorAnalytics. Allows disabling features per brand without affecting others.
// =============================================================================

/**
 * Default brand features - used when brand doesn't specify a feature
 * @constant {Object}
 */
const DEFAULT_BRAND_FEATURES_ = Object.freeze({
  sharedReportEnabled: true,
  sponsorAnalyticsEnabled: true
});

/**
 * Get feature flags for a specific brand
 * @param {string} brandId - Brand ID to get features for
 * @returns {Object} Feature flags with defaults applied
 */
function getBrandFeatures_(brandId) {
  const brand = findBrand_(brandId);
  if (!brand) {
    return { ...DEFAULT_BRAND_FEATURES_ };
  }
  return {
    ...DEFAULT_BRAND_FEATURES_,
    ...(brand.features || {})
  };
}

/**
 * Check if a specific feature is enabled for a brand
 * @param {string} brandId - Brand ID to check
 * @param {string} featureName - Feature name (e.g., 'sharedReportEnabled')
 * @returns {boolean} True if feature is enabled
 */
function isBrandFeatureEnabled_(brandId, featureName) {
  const features = getBrandFeatures_(brandId);
  // Return true if not explicitly set to false (opt-out model)
  return features[featureName] !== false;
}

/**
 * Gate an API response based on brand-level feature flag
 * Returns a "feature disabled" error if the feature is not enabled for this brand
 * @param {string} brandId - Brand ID to check
 * @param {string} featureName - Feature name to check
 * @returns {object|null} - Error envelope if disabled, null if enabled
 */
function requireBrandFeature_(brandId, featureName) {
  if (!isBrandFeatureEnabled_(brandId, featureName)) {
    return Err('FEATURE_DISABLED', `Feature '${featureName}' is not enabled for this brand.`);
  }
  return null;
}

// Fixed: Bug #43 - Don't default to root brand for unknown hosts
function findBrandByHost_(host) {
  host = String(host || '').toLowerCase();
  const brand = BRANDS.find(b => (b.hostnames || []).includes(host));

  if (!brand) {
    // Log warning for unknown hostname
    try {
      const timestamp = new Date().toISOString();
      console.warn(`[${timestamp}] Unknown hostname: ${host}`);
    } catch (e) {
      // Ignore logging errors
    }
  }

  return brand || null;
}
function findTemplate_(id) { return TEMPLATES.find(x => x.id === id) || null; }
function findFormTemplate_(id) { return FORM_TEMPLATES.find(x => x.id === id) || null; }
function listFormTemplates_() { return FORM_TEMPLATES; }

/**
 * Get admin secret for a brand from Script Properties
 * @param {string} brandId - Brand ID (root, abc, cbc, cbl)
 * @returns {string|null} - Admin secret or null if not found
 */
function getAdminSecret_(brandId) {
  if (!brandId) return null;

  const props = PropertiesService.getScriptProperties();
  const key = `ADMIN_SECRET_${brandId.toUpperCase()}`;
  const secret = props.getProperty(key);

  // If not found, log warning
  if (!secret) {
    console.warn(`Admin secret not found for brand: ${brandId}. Set via Script Properties: ${key}`);
  }

  return secret;
}

/**
 * Setup script - Initialize admin secrets in Script Properties
 * Run this once manually to migrate from hardcoded secrets
 * Example: setupAdminSecrets_({ root: 'secret1', abc: 'secret2', ... })
 */
function setupAdminSecrets_(secrets) {
  const props = PropertiesService.getScriptProperties();

  for (const [brandId, secret] of Object.entries(secrets)) {
    const key = `ADMIN_SECRET_${brandId.toUpperCase()}`;
    props.setProperty(key, secret);
    console.log(`✅ Set admin secret for brand: ${brandId}`);
  }

  console.log('✅ Admin secrets migration complete!');
  console.log('⚠️  Remove hardcoded secrets from Config.gs if not already done');
}

/**
 * Setup script - Set the shared spreadsheet ID for all brands
 * Run this once per deployment to configure the shared database
 *
 * Usage in Apps Script editor:
 *   1. Open script editor
 *   2. Run: setupSpreadsheetId('YOUR_SPREADSHEET_ID')
 *   3. Redeploy
 *
 * @param {string} spreadsheetId - Google Sheets spreadsheet ID
 */
function setupSpreadsheetId(spreadsheetId) {
  if (!spreadsheetId || typeof spreadsheetId !== 'string') {
    console.error('❌ Invalid spreadsheet ID. Usage: setupSpreadsheetId("1abc...")');
    return;
  }

  const props = PropertiesService.getScriptProperties();
  props.setProperty('SPREADSHEET_ID', spreadsheetId.trim());

  console.log('✅ Shared spreadsheet ID configured: ' + spreadsheetId);
  console.log('   This will be used by all brands without a dedicated spreadsheet.');
  console.log('');
  console.log('Next steps:');
  console.log('1. Verify: Run showScriptConfig() to confirm');
  console.log('2. Test: Visit ?p=status to check database connection');
  console.log('3. Redeploy: Create new deployment version');
}

/**
 * Setup script - Set a brand-specific spreadsheet ID
 * Use this to give a brand its own dedicated spreadsheet
 *
 * Usage in Apps Script editor:
 *   setupBrandSpreadsheetId('abc', '1xyz...')
 *
 * @param {string} brandId - Brand ID (root, abc, cbc, cbl)
 * @param {string} spreadsheetId - Google Sheets spreadsheet ID
 */
function setupBrandSpreadsheetId(brandId, spreadsheetId) {
  if (!brandId || typeof brandId !== 'string') {
    console.error('❌ Invalid brand ID. Usage: setupBrandSpreadsheetId("abc", "1xyz...")');
    return;
  }
  if (!spreadsheetId || typeof spreadsheetId !== 'string') {
    console.error('❌ Invalid spreadsheet ID. Usage: setupBrandSpreadsheetId("abc", "1xyz...")');
    return;
  }

  const props = PropertiesService.getScriptProperties();
  const key = `SPREADSHEET_ID_${brandId.toUpperCase()}`;
  props.setProperty(key, spreadsheetId.trim());

  console.log(`✅ Brand spreadsheet configured for ${brandId.toUpperCase()}`);
  console.log(`   ${key}: ${spreadsheetId}`);
  console.log('');
  console.log('Next steps:');
  console.log('1. Verify: Run showScriptConfig() to confirm');
  console.log(`2. Test: Visit ?p=status&brand=${brandId} to check database connection`);
  console.log('3. Redeploy: Create new deployment version');
}

/**
 * Show current Script Properties configuration
 * Useful for debugging deployment issues
 */
function showScriptConfig() {
  const props = PropertiesService.getScriptProperties();
  const allProps = props.getProperties();

  console.log('=== Script Properties Configuration ===');
  console.log('');

  // Shared Spreadsheet ID
  const sharedId = allProps['SPREADSHEET_ID'] || '(not set)';
  console.log('SPREADSHEET_ID (shared): ' + sharedId);
  console.log('  Default fallback: ' + DEFAULT_SPREADSHEET_ID);
  console.log('');

  // Per-brand Spreadsheet IDs
  console.log('Per-Brand Spreadsheets:');
  ['ROOT', 'ABC', 'CBC', 'CBL'].forEach(brand => {
    const key = `SPREADSHEET_ID_${brand}`;
    const brandId = allProps[key];
    const activeId = getSpreadsheetId_(brand.toLowerCase());
    if (brandId) {
      console.log(`  ${key}: ${brandId} ✅ dedicated`);
    } else {
      console.log(`  ${key}: (not set) → using ${activeId === DEFAULT_SPREADSHEET_ID ? 'default' : 'shared'}`);
    }
  });
  console.log('');

  // Admin secrets (show only existence, not values)
  console.log('Admin Secrets:');
  ['ROOT', 'ABC', 'CBC', 'CBL'].forEach(brand => {
    const key = `ADMIN_SECRET_${brand}`;
    const hasSecret = !!allProps[key];
    console.log(`  ${key}: ${hasSecret ? '✅ configured' : '❌ not set'}`);
  });

  console.log('');
  console.log('=== End Configuration ===');
}

/**
 * URL Alias Resolution
 * Converts friendly URLs to technical parameters
 *
 * Examples:
 *   resolveUrlAlias_('events') → { page: 'public', label: 'Events' }
 *   resolveUrlAlias_('manage') → { page: 'admin', mode: 'advanced', label: 'Management' }
 *   resolveUrlAlias_('tournaments', 'abc') → { page: 'public', label: 'Tournaments' }
 *
 * @param {string} alias - Friendly URL alias
 * @param {string} brandId - Optional brand ID for custom aliases
 * @returns {object|null} - Alias configuration or null if not found
 */
function resolveUrlAlias_(alias, brandId) {
  if (!alias) return null;

  const aliasLower = alias.toLowerCase();

  // Check brand-specific custom aliases first
  if (brandId && ZEB.BRAND_URL_PATTERNS.customAliases[brandId]) {
    const customAlias = ZEB.BRAND_URL_PATTERNS.customAliases[brandId][aliasLower];
    if (customAlias) {
      return { ...customAlias, source: 'brand-custom' };
    }
  }

  // Check global aliases
  const globalAlias = ZEB.URL_ALIASES[aliasLower];
  if (globalAlias) {
    return { ...globalAlias, source: 'global' };
  }

  return null;
}

/**
 * Generate friendly URL for a page
 *
 * Examples:
 *   getFriendlyUrl_('public', 'abc') → '/abc/events'
 *   getFriendlyUrl_('admin', 'cbc') → '/cbc/manage'
 *   getFriendlyUrl_('display', 'root') → '/display'
 *
 * @param {string} page - Technical page name
 * @param {string} brandId - Brand ID (optional)
 * @param {object} options - Additional options (mode, etc.)
 * @returns {string} - Friendly URL path
 */
function getFriendlyUrl_(page, brandId, options = {}) {
  // Find matching alias
  let matchingAlias = null;

  // Check brand custom aliases first
  if (brandId && ZEB.BRAND_URL_PATTERNS.customAliases[brandId]) {
    for (const [alias, config] of Object.entries(ZEB.BRAND_URL_PATTERNS.customAliases[brandId])) {
      if (config.page === page &&
          (!options.mode || config.mode === options.mode)) {
        matchingAlias = alias;
        break;
      }
    }
  }

  // Check global aliases
  if (!matchingAlias) {
    for (const [alias, config] of Object.entries(ZEB.URL_ALIASES)) {
      if (config.page === page &&
          (!options.mode || config.mode === options.mode)) {
        matchingAlias = alias;
        break;
      }
    }
  }

  // Build URL
  if (matchingAlias) {
    if (ZEB.BRAND_URL_PATTERNS.enableBrandPrefix && brandId && brandId !== 'root') {
      return `/${brandId}/${matchingAlias}`;
    }
    return `/${matchingAlias}`;
  }

  // Fallback to query parameters
  let url = `?p=${page}`;
  if (brandId) url += `&brand=${brandId}`;
  if (options.mode) url += `&mode=${options.mode}`;
  return url;
}

/**
 * Get list of all available aliases
 * Useful for documentation and navigation menus
 *
 * @param {string} brandId - Optional brand ID to include custom aliases
 * @param {boolean} publicOnly - Only return public aliases
 * @returns {array} - Array of alias objects
 */
function listUrlAliases_(brandId, publicOnly = false) {
  const aliases = [];

  // Add global aliases
  for (const [alias, config] of Object.entries(ZEB.URL_ALIASES)) {
    if (!publicOnly || config.public) {
      aliases.push({
        alias: alias,
        ...config,
        url: getFriendlyUrl_(config.page, brandId, { mode: config.mode })
      });
    }
  }

  // Add brand custom aliases
  if (brandId && ZEB.BRAND_URL_PATTERNS.customAliases[brandId]) {
    for (const [alias, config] of Object.entries(ZEB.BRAND_URL_PATTERNS.customAliases[brandId])) {
      if (!publicOnly || config.public) {
        aliases.push({
          alias: alias,
          ...config,
          url: getFriendlyUrl_(config.page, brandId, { mode: config.mode }),
          custom: true
        });
      }
    }
  }

  return aliases;
}
