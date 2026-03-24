/**
 * Centralized UI Selectors for E2E Tests
 *
 * DRY Principle: Single source of truth for all UI selectors
 * Benefits:
 * - Easy maintenance when UI changes
 * - Consistent selector strategy
 * - Type-safe with JSDoc
 * - Mobile-responsive aware
 *
 * Usage:
 * const { ADMIN_PAGE, PUBLIC_PAGE } = require('./selectors');
 * await page.click(ADMIN_PAGE.CREATE_EVENT_BUTTON);
 */

/**
 * Admin Page Selectors
 */
const ADMIN_PAGE = {
  // Form Elements (match Admin.html actual IDs: #name, #startDateISO, #venue)
  EVENT_NAME_INPUT: '#name, input[name="eventName"], #eventName, input[placeholder*="Event Name"]',
  EVENT_DATE_INPUT: '#startDateISO, #dateISO, input[type="date"], input[name="eventDate"], #eventDate',
  EVENT_TIME_INPUT: '#timeISO, input[name="timeISO"]',
  EVENT_LOCATION_INPUT: '#venue, #location, input[name="location"], input[placeholder*="Location"]',
  EVENT_DESCRIPTION_TEXTAREA: '#summary, textarea[name="description"], #description',

  // Time Fields
  TIME_START_INPUT: 'input[name="timeStart"], #timeStart',
  TIME_END_INPUT: 'input[name="timeEnd"], #timeEnd',

  // Sponsor Fields
  SPONSOR_NAME_INPUT: 'input[name*="sponsorName"], input[placeholder*="Sponsor Name"]',
  SPONSOR_TIER_SELECT: 'select[name*="sponsorTier"], #sponsorTier',
  SPONSOR_LOGO_INPUT: 'input[name*="sponsorLogo"], input[placeholder*="Logo URL"]',
  SPONSOR_WEBSITE_INPUT: 'input[name*="sponsorWebsite"], input[placeholder*="Website"]',

  // Buttons
  CREATE_EVENT_BUTTON: 'button[type="submit"], button:has-text("Create Event"), input[type="submit"][value*="Create"]',
  SAVE_BUTTON: 'button:has-text("Save"), input[type="submit"][value*="Save"]',
  CANCEL_BUTTON: 'button:has-text("Cancel")',
  DELETE_BUTTON: 'button:has-text("Delete"), button.delete-btn',
  ADD_SPONSOR_BUTTON: 'button:has-text("Add Sponsor"), button#addSponsor',
  REMOVE_SPONSOR_BUTTON: 'button:has-text("Remove"), button.remove-sponsor',

  // Create Card (Phase 1 - Event Creation Form)
  CREATE_CARD: '#createCard',
  CREATE_FORM: '#createForm, form',

  // Seven-Card Shell (Phase 2 - After Event Creation)
  EVENT_CARD_CONTAINER: '#eventCard',

  // Card 1: Event Basics
  CARD_1_EVENT_BASICS: '#card1EventBasics',
  EVENT_INFO: '#eventInfo',

  // Card 2: Sponsors
  CARD_2_SPONSORS: '#card2Sponsors',
  SPONSOR_PERFORMANCE_CARD: '#sponsorPerformanceCard',
  SPONSOR_REPORTS_LIST: '#sponsorReportsList',
  CUSTOM_SPONSOR_ID_INPUT: '#customSponsorId',
  GENERATE_SPONSOR_LINK_BUTTON: 'button:has-text("Generate Link")',
  CUSTOM_SPONSOR_LINK_OUTPUT: '#customSponsorLinkOutput',
  CUSTOM_SPONSOR_LINK_FIELD: '#customSponsorLinkField',

  // Card 3: Sign-Up Forms
  CARD_3_SIGNUP: '#card3SignUp',
  SIGNUP_COUNT: '#signupCount',
  SIGNUP_SUMMARY: '#signupSummary',
  CONFIGURE_SIGNUP_BUTTON: 'button:has-text("Configure Forms")',
  CREATE_GOOGLE_FORMS_BUTTON: 'button:has-text("Create Google Forms")',

  // Card 4: Poster Page
  CARD_4_POSTER: '#card4Poster',
  POSTER_LINK: '#lnkPoster',
  POSTER_QR_PREVIEW: '#qrPosterPreview',
  COPY_POSTER_LINK_BUTTON: '#card4Poster button:has-text("Copy Link")',
  OPEN_POSTER_BUTTON: '#card4Poster button:has-text("Open Poster")',
  SHOW_POSTER_QR_BUTTON: 'button:has-text("Show QR Code")',

  // Card 5: TV Display
  CARD_5_DISPLAY: '#card5Display',
  DISPLAY_LINK: '#lnkDisplay',
  COPY_DISPLAY_LINK_BUTTON: '#card5Display button:has-text("Copy Link")',
  OPEN_DISPLAY_BUTTON: '#card5Display button:has-text("Open on TV")',
  DISPLAY_SETTINGS_BUTTON: '#card5Display button:has-text("Settings")',

  // Card 6: Public Page
  CARD_6_PUBLIC: '#card6PublicPage',
  PUBLIC_LINK: '#lnkPublic',
  PUBLIC_QR_PREVIEW: '#qrPublicPreview',
  COPY_PUBLIC_LINK_BUTTON: '#card6PublicPage button:has-text("Copy Link")',
  OPEN_PUBLIC_BUTTON: '#card6PublicPage button:has-text("Open Page")',
  SHOW_PUBLIC_QR_BUTTON: '#card6PublicPage button:has-text("Show QR Code")',

  // Card 7: Shared Report
  CARD_7_REPORT: '#card7Report',
  REPORT_LINK: '#lnkReport',
  COPY_REPORT_LINK_BUTTON: '#card7Report button:has-text("Copy Report Link")',
  VIEW_REPORT_BUTTON: '#card7Report button:has-text("View Report")',
  SHARED_REPORT_QR: '#qrSharedReport',

  // Diagnostics Card (Advanced Tools)
  CARD_DIAGNOSTICS: '#cardDiagnostics',
  EVENT_ID_DISPLAY: '#eventIdDisplay',

  // Advanced Sections (collapsed by default)
  ADVANCED_DISPLAY_TOGGLES: '[data-testid="advanced-display-toggles"]',
  ADVANCED_DISPLAY_TOGGLES_HEADER: '#advancedDisplayTogglesHeader',
  ADVANCED_EVENT_DETAILS: '[data-testid="advanced-event-details"]',
  ADVANCED_EVENT_DETAILS_HEADER: '#advancedEventDetailsHeader',
  EXTERNAL_LINKS_SECTION: '[data-testid="external-links-section"]',
  EXTERNAL_LINKS_HEADER: '#externalLinksHeader',
  SUMMARY_SECTION: '[data-testid="summary-section"]',
  MEDIA_SECTION: '[data-testid="media-section"]',
  BIO_SECTION: '[data-testid="bio-section"]',

  // Create Another Event
  CREATE_ANOTHER_BUTTON: 'button:has-text("Create Another Event")',

  // Display Configuration
  DISPLAY_MODE_SELECT: 'select[name="displayMode"], #displayMode',
  DISPLAY_URL_INPUT: 'input[name*="displayUrl"], input[placeholder*="Display URL"]',
  ADD_DISPLAY_URL_BUTTON: 'button:has-text("Add Display URL")',

  // Form URLs
  REGISTRATION_URL_INPUT: 'input[name="registrationUrl"], #registrationUrl, #registerUrl',
  CHECKIN_URL_INPUT: 'input[name="checkinUrl"], #checkinUrl',
  WALKIN_URL_INPUT: 'input[name="walkinUrl"], #walkinUrl',
  SURVEY_URL_INPUT: 'input[name="surveyUrl"], #surveyUrl',

  // Map Configuration
  MAP_URL_INPUT: 'input[name="mapUrl"], #mapUrl',

  // Admin Controls
  ADMIN_KEY_INPUT: 'input[name="adminKey"], input[type="password"]#adminKey',
  BRAND_SELECT: 'select[name="brandId"], #brandId',

  // Status Messages
  SUCCESS_MESSAGE: '.success-message, .alert-success, [role="alert"].success',
  ERROR_MESSAGE: '.error-message, .alert-error, [role="alert"].error',

  // Event List
  EVENT_LIST_CONTAINER: '.event-list, #eventList, [data-testid="event-list"]',
  EVENT_ITEM: '.event-item, .event-card',
  EVENT_EDIT_BUTTON: 'button:has-text("Edit"), .edit-btn',
  EVENT_DELETE_BUTTON: 'button:has-text("Delete"), .delete-btn',

  // Navigation
  BACK_TO_LIST_BUTTON: 'button:has-text("Back"), a:has-text("Back to List")',
  LOGOUT_BUTTON: 'button:has-text("Logout"), a:has-text("Logout")',
};

/**
 * Public Page Selectors
 */
const PUBLIC_PAGE = {
  // Event Display
  EVENT_CONTAINER: '.event-container, #events, [data-testid="events"]',
  EVENT_CARD: '.event-card, .event-item',
  EVENT_TITLE: '.event-title, .event-name, h2',
  EVENT_DATE: '.event-date, time',
  EVENT_LOCATION: '.event-location, .location',
  EVENT_DESCRIPTION: '.event-description, .description',

  // Sponsors
  SPONSOR_CONTAINER: '.sponsors, #sponsors, [data-testid="sponsors"]',
  SPONSOR_LOGO: '.sponsor-logo, img[alt*="Sponsor"]',
  SPONSOR_LINK: '.sponsor-link, a.sponsor',

  // Filters and Search
  SEARCH_INPUT: 'input[type="search"], input[placeholder*="Search"]',
  FILTER_DATE: 'select[name="filterDate"], #filterDate',
  FILTER_LOCATION: 'select[name="filterLocation"], #filterLocation',
  FILTER_APPLY_BUTTON: 'button:has-text("Apply"), button.apply-filter',
  FILTER_RESET_BUTTON: 'button:has-text("Reset"), button.reset-filter',

  // Pagination
  NEXT_PAGE_BUTTON: 'button:has-text("Next"), .pagination-next',
  PREV_PAGE_BUTTON: 'button:has-text("Previous"), .pagination-prev',
  PAGE_NUMBER: '.page-number, .pagination-page',

  // Event Details
  VIEW_DETAILS_BUTTON: 'button:has-text("View Details"), a:has-text("Details")',
  REGISTER_BUTTON: 'button:has-text("Register"), a:has-text("Register")',

  // Mobile Menu
  MOBILE_MENU_BUTTON: 'button.menu-toggle, .hamburger-menu',
  MOBILE_MENU: '.mobile-menu, nav.mobile',
};

/**
 * Display Page Selectors (TV/Kiosk Mode)
 */
const DISPLAY_PAGE = {
  // Main Display
  DISPLAY_CONTAINER: '.display-container, #display',
  EVENT_TITLE: '.display-title, h1',
  EVENT_DATE_TIME: '.display-datetime, .event-time',
  EVENT_LOCATION: '.display-location',

  // Sponsors
  SPONSOR_CAROUSEL: '.sponsor-carousel, #sponsors',
  SPONSOR_SLIDE: '.sponsor-slide, .sponsor-item',
  SPONSOR_LOGO: '.sponsor-logo img',
  SPONSOR_NAME: '.sponsor-name',

  // Dynamic Content
  VIDEO_PLAYER: 'video, iframe[src*="youtube"], iframe[src*="vimeo"]',
  CONTENT_FRAME: '.content-frame, #dynamicContent',

  // Navigation Controls
  NEXT_SLIDE_BUTTON: 'button.next-slide',
  PREV_SLIDE_BUTTON: 'button.prev-slide',
  PAUSE_BUTTON: 'button.pause',
  PLAY_BUTTON: 'button.play',

  // QR Code
  QR_CODE: '.qr-code, img[alt*="QR"]',
  QR_LABEL: '.qr-label',
};

/**
 * Poster Page Selectors
 */
const POSTER_PAGE = {
  POSTER_CONTAINER: '.poster-container, #poster',
  EVENT_TITLE: '.poster-title, h1',
  EVENT_DATE: '.poster-date',
  EVENT_LOCATION: '.poster-location',
  EVENT_TIME: '.poster-time',

  // Sponsors
  SPONSOR_GRID: '.sponsor-grid, .sponsors',
  SPONSOR_LOGO: '.sponsor-logo img',

  // Map
  MAP_CONTAINER: '.map-container, #map',
  MAP_IFRAME: 'iframe[src*="google.com/maps"]',

  // QR Codes
  REGISTRATION_QR: '.registration-qr, #registrationQR',
  EVENT_QR: '.event-qr, #eventQR',
};

/**
 * Shared Reporting Page Selectors
 */
const REPORT_PAGE = {
  // Analytics Dashboard
  DASHBOARD_CONTAINER: '.analytics-dashboard, #analytics',

  // Metrics
  TOTAL_IMPRESSIONS: '.total-impressions, #totalImpressions',
  TOTAL_CLICKS: '.total-clicks, #totalClicks',
  CTR_METRIC: '.ctr, #clickThroughRate',
  DWELL_TIME: '.dwell-time, #dwellTime',

  // Charts
  IMPRESSIONS_CHART: '#impressionsChart, .chart-impressions',
  CLICKS_CHART: '#clicksChart, .chart-clicks',
  SPONSOR_CHART: '#sponsorChart, .chart-sponsors',

  // Filters
  DATE_RANGE_START: 'input[name="dateStart"], #dateStart',
  DATE_RANGE_END: 'input[name="dateEnd"], #dateEnd',
  SURFACE_FILTER: 'select[name="surface"], #surfaceFilter',
  SPONSOR_FILTER: 'select[name="sponsor"], #sponsorFilter',
  APPLY_FILTER_BUTTON: 'button:has-text("Apply"), .apply-filters',

  // Tables
  ANALYTICS_TABLE: '.analytics-table, table#analytics',
  TABLE_ROW: 'tr.analytics-row',

  // Export
  EXPORT_CSV_BUTTON: 'button:has-text("Export CSV"), .export-csv',
  EXPORT_PDF_BUTTON: 'button:has-text("Export PDF"), .export-pdf',
};

/**
 * Authentication Selectors
 */
const AUTH = {
  // Admin Dialog (Browser Prompt)
  ADMIN_DIALOG_USERNAME: 'input[name="username"]',
  ADMIN_DIALOG_PASSWORD: 'input[name="password"]',

  // JWT Token
  TOKEN_INPUT: 'input[name="token"], #authToken',
  TOKEN_SUBMIT: 'button:has-text("Submit Token")',

  // API Key
  API_KEY_INPUT: 'input[name="apiKey"], #apiKey',

  // Logout
  LOGOUT_LINK: 'a:has-text("Logout"), button:has-text("Logout")',
};

/**
 * Form Template Selectors
 */
const FORMS = {
  // Template Selection
  TEMPLATE_SELECT: 'select[name="template"], #formTemplate',
  TEMPLATE_PREVIEW: '.template-preview, #templatePreview',

  // Form Builder
  QUESTION_INPUT: 'input[name*="question"], .question-text',
  QUESTION_TYPE_SELECT: 'select[name*="questionType"]',
  ADD_QUESTION_BUTTON: 'button:has-text("Add Question")',
  REMOVE_QUESTION_BUTTON: 'button:has-text("Remove"), .remove-question',

  // Form Actions
  CREATE_FORM_BUTTON: 'button:has-text("Create Form")',
  SAVE_TEMPLATE_BUTTON: 'button:has-text("Save Template")',
  PREVIEW_FORM_BUTTON: 'button:has-text("Preview")',
};

/**
 * Diagnostics Page Selectors
 */
const DIAGNOSTICS = {
  DIAGNOSTICS_CONTAINER: '.diagnostics, #diagnostics',

  // Status Checks
  API_STATUS: '.api-status, #apiStatus',
  DATABASE_STATUS: '.db-status, #dbStatus',
  AUTH_STATUS: '.auth-status, #authStatus',

  // Actions
  RUN_DIAGNOSTICS_BUTTON: 'button:has-text("Run Diagnostics")',
  CLEAR_CACHE_BUTTON: 'button:has-text("Clear Cache")',

  // Results
  DIAGNOSTICS_RESULTS: '.diagnostics-results, #results',
  ERROR_LOG: '.error-log, #errorLog',
};

/**
 * Common UI Elements
 */
const COMMON = {
  // Loading States
  LOADING_SPINNER: '.spinner, .loading, [aria-busy="true"]',
  LOADING_MESSAGE: '.loading-message',

  // Modals
  MODAL: '.modal, [role="dialog"]',
  MODAL_CLOSE: 'button.close, .modal-close, button[aria-label="Close"]',
  MODAL_CONFIRM: 'button:has-text("Confirm"), .modal-confirm',
  MODAL_CANCEL: 'button:has-text("Cancel"), .modal-cancel',

  // Alerts
  ALERT: '[role="alert"], .alert',
  ALERT_SUCCESS: '.alert-success, [role="alert"].success',
  ALERT_ERROR: '.alert-error, [role="alert"].error',
  ALERT_WARNING: '.alert-warning, [role="alert"].warning',
  ALERT_INFO: '.alert-info, [role="alert"].info',

  // Navigation
  NAV_MENU: 'nav, .navigation',
  NAV_LINK: 'nav a, .nav-link',
  BREADCRUMB: '.breadcrumb, nav[aria-label="Breadcrumb"]',

  // Footer
  FOOTER: 'footer',
  COPYRIGHT: '.copyright',

  // Accessibility
  SKIP_LINK: 'a:has-text("Skip to main content"), .skip-link',
  MAIN_CONTENT: 'main, [role="main"]',
};

/**
 * Mobile-Specific Selectors
 */
const MOBILE = {
  // Mobile Navigation
  HAMBURGER_MENU: 'button.hamburger, .menu-toggle',
  MOBILE_NAV: 'nav.mobile-nav, .mobile-menu',
  MOBILE_NAV_CLOSE: 'button.close-menu',

  // Mobile Search
  MOBILE_SEARCH_TOGGLE: 'button.search-toggle',
  MOBILE_SEARCH_INPUT: '.mobile-search input',

  // Mobile Cards
  MOBILE_CARD: '.mobile-card, .card-mobile',
  MOBILE_CARD_EXPAND: 'button.expand, .card-expand',

  // Touch Actions
  SWIPE_CONTAINER: '.swipeable, [data-swipe="true"]',
  PULL_TO_REFRESH: '.pull-to-refresh',
};

/**
 * Data Test IDs (Recommended for Stable Testing)
 */
const DATA_TEST_IDS = {
  // Admin
  ADMIN_FORM: '[data-testid="admin-form"]',
  EVENT_LIST: '[data-testid="event-list"]',
  EVENT_ITEM: '[data-testid="event-item"]',

  // Public
  PUBLIC_EVENTS: '[data-testid="public-events"]',
  EVENT_CARD: '[data-testid="event-card"]',
  SPONSOR_LIST: '[data-testid="sponsor-list"]',

  // Display
  DISPLAY_SCREEN: '[data-testid="display-screen"]',
  SPONSOR_CAROUSEL: '[data-testid="sponsor-carousel"]',

  // Forms
  FORM_BUILDER: '[data-testid="form-builder"]',
  FORM_PREVIEW: '[data-testid="form-preview"]',

  // Analytics
  ANALYTICS_DASHBOARD: '[data-testid="analytics-dashboard"]',
  METRICS_PANEL: '[data-testid="metrics-panel"]',
};

/**
 * Accessibility Landmarks
 */
const ARIA = {
  // Roles
  MAIN: '[role="main"]',
  NAVIGATION: '[role="navigation"]',
  SEARCH: '[role="search"]',
  BANNER: '[role="banner"]',
  CONTENTINFO: '[role="contentinfo"]',
  COMPLEMENTARY: '[role="complementary"]',

  // Live Regions
  ALERT: '[role="alert"]',
  STATUS: '[role="status"]',
  LOG: '[role="log"]',

  // Interactive
  BUTTON: '[role="button"]',
  LINK: '[role="link"]',
  DIALOG: '[role="dialog"]',
  TAB: '[role="tab"]',
  TABPANEL: '[role="tabpanel"]',
};

module.exports = {
  ADMIN_PAGE,
  PUBLIC_PAGE,
  DISPLAY_PAGE,
  POSTER_PAGE,
  REPORT_PAGE,
  AUTH,
  FORMS,
  DIAGNOSTICS,
  COMMON,
  MOBILE,
  DATA_TEST_IDS,
  ARIA,

  // Convenience exports
  SELECTORS: {
    ADMIN_PAGE,
    PUBLIC_PAGE,
    DISPLAY_PAGE,
    POSTER_PAGE,
    REPORT_PAGE,
    AUTH,
    FORMS,
    DIAGNOSTICS,
    COMMON,
    MOBILE,
    DATA_TEST_IDS,
    ARIA,
  }
};
