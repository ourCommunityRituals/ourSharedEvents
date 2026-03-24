/**
 * Analytics Service
 *
 * Centralizes all analytics-related operations:
 * - Event logging (impressions, clicks, dwell time)
 * - Data aggregation (by surface, sponsor, token)
 * - Report generation (raw metrics without formatting)
 * - Shared analytics (event managers & sponsors)
 * - Timeline and trend analysis
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * [MVP] SERVICE CONTRACT
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * READS:
 *   ← Analytics sheet (raw event logs: timestamp, eventId, surface, metric, etc.)
 *   ← Events sheet (for ownership verification)
 *
 * WRITES:
 *   → Analytics sheet (via AnalyticsService_logEvents)
 *
 * OUTPUT SHAPES (consumed by SharedReporting.gs):
 *   → Summary metrics → SharedAnalytics.summary
 *   → Surface metrics → SharedAnalytics.surfaces
 *   → Sponsor metrics → SharedAnalytics.sponsors
 *   → Event metrics   → SharedAnalytics.events
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * [MVP] LOCKED METRICS LIST (SharedReport renders only these)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Summary metrics (/schemas/shared-analytics.schema.json $defs/Summary):
 *   - totalImpressions    // [MVP] Page views across all surfaces
 *   - totalClicks         // [MVP] CTA button clicks
 *   - totalQrScans        // [MVP] QR code scans (poster/public)
 *   - totalSignups        // [MVP] Form submission completions
 *   - uniqueEvents        // [MVP] Distinct events in scope
 *   - uniqueSponsors      // [MVP] Distinct sponsors in scope
 *
 * Per-surface metrics (/schemas/shared-analytics.schema.json $defs/SurfaceMetrics):
 *   - id                  // [MVP] Surface identifier (poster|display|public|signup)
 *   - label               // [MVP] Human-readable name
 *   - impressions         // [MVP] Surface page views
 *   - clicks              // [MVP] Surface CTA clicks
 *   - qrScans             // [MVP] Surface QR scans
 *   - engagementRate      // [MVP OPTIONAL] Derived (clicks/impressions * 100)
 *
 * Per-sponsor metrics (/schemas/shared-analytics.schema.json $defs/SponsorMetrics):
 *   - id                  // [MVP] Sponsor identifier
 *   - name                // [MVP] Sponsor display name
 *   - impressions         // [MVP] Sponsor logo impressions
 *   - clicks              // [MVP] Sponsor link clicks
 *   - ctr                 // [MVP] Click-through rate percentage
 *
 * Per-event metrics (/schemas/shared-analytics.schema.json $defs/EventMetrics):
 *   - id                  // [MVP] Event identifier
 *   - name                // [MVP] Event display name
 *   - impressions         // [MVP] Event page views
 *   - clicks              // [MVP] Event CTA clicks
 *   - ctr                 // [MVP] Click-through rate percentage
 *
 * DO NOT add metrics to SharedAnalytics without updating:
 *   - /schemas/shared-analytics.schema.json
 *   - SharedReport.html (consumer)
 *   - SharedReporting.gs (producer)
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Design principles:
 * - Separates data aggregation from presentation
 * - Returns raw metrics for flexible rendering
 * - Provides filtering and date range support
 * - Sanitizes all inputs to prevent injection
 * - DRY: Shared utilities used by SponsorService and SharedReporting
 *
 * @module AnalyticsService
 */

// === Shared Metrics Utilities (DRY) ==========================================
// These utilities are the single source of truth for metrics calculations
// Used by: AnalyticsService, SponsorService, SharedReporting

/**
 * Calculate CTR (Click-Through Rate) percentage
 * Single source of truth for CTR calculation across all services
 *
 * @param {number} clicks - Number of clicks
 * @param {number} impressions - Number of impressions
 * @returns {number} CTR as percentage with 2 decimal places, or 0 if no impressions
 */
function MetricsUtils_calculateCTR(clicks, impressions) {
  if (!impressions || impressions <= 0) return 0;
  return +((clicks / impressions) * 100).toFixed(2);
}

/**
 * Apply CTR calculation to a metrics bucket object
 * Mutates the bucket in place
 *
 * @param {object} bucket - Object with impressions and clicks properties
 * @returns {object} Same bucket with ctr property added
 */
function MetricsUtils_applyCTR(bucket) {
  bucket.ctr = MetricsUtils_calculateCTR(bucket.clicks, bucket.impressions);
  return bucket;
}

/**
 * Create a new empty metrics bucket
 * Standard shape used across all aggregations
 *
 * @param {boolean} [includeDwell=true] - Include dwellSec field
 * @returns {object} Fresh metrics bucket
 */
function MetricsUtils_createBucket(includeDwell = true) {
  const bucket = { impressions: 0, clicks: 0, ctr: 0 };
  if (includeDwell) bucket.dwellSec = 0;
  return bucket;
}

/**
 * Increment metrics in a bucket based on metric type
 *
 * @param {object} bucket - Metrics bucket to update
 * @param {string} metric - Metric type ('impression', 'click', 'dwellSec')
 * @param {number} [value=1] - Value to add (used for dwellSec)
 */
function MetricsUtils_incrementBucket(bucket, metric, value = 1) {
  if (metric === 'impression') bucket.impressions++;
  else if (metric === 'click') bucket.clicks++;
  else if (metric === 'dwellSec' && bucket.dwellSec !== undefined) {
    bucket.dwellSec += Number(value) || 0;
  }
}

/**
 * Parse a raw analytics row into a structured object
 * Standard row format: [timestamp, eventId, surface, metric, sponsorId, value, token, userAgent]
 *
 * @param {array} row - Raw spreadsheet row
 * @returns {object} Parsed analytics entry
 */
function MetricsUtils_parseRow(row) {
  return {
    timestamp: row[0],
    eventId: row[1],
    surface: row[2] || 'unknown',
    metric: row[3],
    sponsorId: (row[4] !== null && row[4] !== undefined && row[4] !== '') ? row[4] : null,
    value: Number((row[5] !== null && row[5] !== undefined) ? row[5] : 0),
    token: (row[6] !== null && row[6] !== undefined && row[6] !== '') ? row[6] : null,
    userAgent: row[7] || ''
  };
}

/**
 * Add a data point to daily timeline, creating day entry if needed
 *
 * @param {array} timeline - Array of {date, impressions, clicks, dwellSec, ctr} objects
 * @param {Date|string} timestamp - Timestamp of the event
 * @param {string} metric - Metric type
 * @param {number} [value=1] - Value for dwellSec
 * @returns {object} The day data object that was updated
 */
function MetricsUtils_addToTimeline(timeline, timestamp, metric, value = 1) {
  const date = new Date(timestamp).toISOString().split('T')[0];
  let dayData = timeline.find(d => d.date === date);
  if (!dayData) {
    dayData = { date, impressions: 0, clicks: 0, dwellSec: 0, ctr: 0 };
    timeline.push(dayData);
  }
  MetricsUtils_incrementBucket(dayData, metric, value);
  return dayData;
}

/**
 * Finalize timeline by calculating CTR and sorting by date
 *
 * @param {array} timeline - Array of day data objects
 * @returns {array} Same array, sorted and with CTR calculated
 */
function MetricsUtils_finalizeTimeline(timeline) {
  timeline.forEach(day => MetricsUtils_applyCTR(day));
  timeline.sort((a, b) => a.date.localeCompare(b.date));
  return timeline;
}

/**
 * Finalize all buckets in a grouped object by calculating CTR
 *
 * @param {object} grouped - Object with bucket values
 * @returns {object} Same object with CTR applied to all buckets
 */
function MetricsUtils_finalizeGrouped(grouped) {
  for (const key in grouped) {
    MetricsUtils_applyCTR(grouped[key]);
  }
  return grouped;
}

// === Event Logging ========================================================

/**
 * Log analytics events (impressions, clicks, dwell time)
 *
 * @param {array} items - Array of analytics events to log
 * @returns {object} Result envelope with count of logged events
 */
function AnalyticsService_logEvents(items) {
  if (!items || !items.length) return Ok({ count: 0 });

  const sh = _ensureAnalyticsSheet_();
  const now = Date.now();

  // Sanitize all values to prevent formula injection
  const rows = items.map(it => [
    new Date(it.ts || now),
    SecurityMiddleware_sanitizeSpreadsheetValue(it.eventId || ''),
    SecurityMiddleware_sanitizeSpreadsheetValue(it.surface || ''),
    SecurityMiddleware_sanitizeSpreadsheetValue(it.metric || ''),
    SecurityMiddleware_sanitizeSpreadsheetValue(it.sponsorId || ''),
    Number(it.value || 0),
    SecurityMiddleware_sanitizeSpreadsheetValue(it.token || ''),
    SecurityMiddleware_sanitizeSpreadsheetValue((it.ua || '').slice(0, 200))
  ]);

  sh.getRange(sh.getLastRow() + 1, 1, rows.length, 8).setValues(rows);

  diag_('info', 'AnalyticsService_logEvents', 'logged', { count: rows.length });

  return Ok({ count: rows.length });
}

// === Report Operations ====================================================

/**
 * Get analytics report for an event
 * Returns raw metrics without formatting
 *
 * @param {object} params - Report parameters
 * @param {string} params.eventId - Event ID
 * @param {string} [params.brandId] - Brand ID (for authorization)
 * @param {string} [params.dateFrom] - Start date (ISO)
 * @param {string} [params.dateTo] - End date (ISO)
 * @returns {object} Result envelope with aggregated metrics
 */
function AnalyticsService_getEventReport(params) {
  const { eventId, brandId, dateFrom, dateTo } = params || {};

  if (!eventId) return Err(ERR.BAD_INPUT, 'missing eventId');

  // Verify event exists and belongs to brand (if brandId provided)
  if (brandId) {
    const verifyResult = AnalyticsService_verifyEventOwnership(eventId, brandId);
    if (!verifyResult.ok) return verifyResult;
  }

  const sh = _ensureAnalyticsSheet_();
  let data = sh.getDataRange().getValues().slice(1)
    .filter(r => r[1] === eventId);

  // Filter by date range if provided
  if (dateFrom || dateTo) {
    const fromDate = dateFrom ? new Date(dateFrom) : new Date(0);
    const toDate = dateTo ? new Date(dateTo) : new Date();

    data = data.filter(r => {
      const rowDate = new Date(r[0]);
      return rowDate >= fromDate && rowDate <= toDate;
    });
  }

  // Aggregate metrics
  const agg = AnalyticsService_aggregateEventData(data);

  return Ok(agg);
}

/**
 * Aggregate event analytics data
 * Uses shared MetricsUtils_ for DRY compliance
 *
 * @param {array} data - Raw analytics rows
 * @returns {object} Aggregated metrics
 */
function AnalyticsService_aggregateEventData(data) {
  const agg = {
    totals: MetricsUtils_createBucket(true),
    bySurface: {},
    bySponsor: {},
    byToken: {},
    timeline: []
  };

  for (const r of data) {
    const parsed = MetricsUtils_parseRow(r);
    const { timestamp, surface, metric, value } = parsed;
    const sponsorId = parsed.sponsorId || '-';
    const token = parsed.token || '-';

    // Initialize aggregation buckets using shared utility
    if (!agg.bySurface[surface]) agg.bySurface[surface] = MetricsUtils_createBucket(true);
    if (!agg.bySponsor[sponsorId]) agg.bySponsor[sponsorId] = MetricsUtils_createBucket(true);
    if (!agg.byToken[token]) agg.byToken[token] = MetricsUtils_createBucket(true);

    // Increment all buckets using shared utility
    MetricsUtils_incrementBucket(agg.totals, metric, value);
    MetricsUtils_incrementBucket(agg.bySurface[surface], metric, value);
    MetricsUtils_incrementBucket(agg.bySponsor[sponsorId], metric, value);
    MetricsUtils_incrementBucket(agg.byToken[token], metric, value);

    // Track daily timeline using shared utility
    MetricsUtils_addToTimeline(agg.timeline, timestamp, metric, value);
  }

  // Calculate CTR for all aggregations using shared utilities
  MetricsUtils_applyCTR(agg.totals);
  MetricsUtils_finalizeGrouped(agg.bySurface);
  MetricsUtils_finalizeGrouped(agg.bySponsor);
  MetricsUtils_finalizeGrouped(agg.byToken);
  MetricsUtils_finalizeTimeline(agg.timeline);

  return agg;
}

// === Shared Analytics =====================================================

/**
 * Get shared analytics (for both event managers and sponsors)
 *
 * @param {object} params - Query parameters
 * @param {string} params.brandId - Brand ID
 * @param {string} [params.eventId] - Filter by event ID
 * @param {string} [params.sponsorId] - Filter by sponsor ID
 * @param {string} [params.dateFrom] - Start date (ISO)
 * @param {string} [params.dateTo] - End date (ISO)
 * @param {boolean} [params.isSponsorView=false] - True if sponsor is requesting
 * @returns {object} Result envelope with shared analytics
 */
function AnalyticsService_getSharedAnalytics(params) {
  const { brandId, eventId, sponsorId, dateFrom, dateTo, isSponsorView = false } = params || {};

  if (!brandId) return Err(ERR.BAD_INPUT, 'brandId required');

  // Get analytics sheet
  const sh = _ensureAnalyticsSheet_();
  const rows = sh.getDataRange().getValues();
  const headers = rows[0];

  // Parse analytics data
  let analytics = rows.slice(1).map(row => ({
    timestamp: row[0],
    eventId: row[1],
    surface: row[2],
    metric: row[3],
    sponsorId: row[4],
    value: row[5],
    token: row[6],
    userAgent: row[7]
  }));

  // Filter by parameters
  analytics = analytics.filter(a => a.eventId); // Has event ID

  if (eventId) {
    analytics = analytics.filter(a => a.eventId === eventId);
  }

  if (sponsorId || isSponsorView) {
    // Sponsor view: only show their own data
    analytics = analytics.filter(a => a.sponsorId === (sponsorId || params.sponsorId));
  }

  if (dateFrom) {
    const start = new Date(dateFrom);
    analytics = analytics.filter(a => new Date(a.timestamp) >= start);
  }

  if (dateTo) {
    const end = new Date(dateTo);
    analytics = analytics.filter(a => new Date(a.timestamp) <= end);
  }

  // Calculate shared metrics
  const metrics = {
    // Overview metrics (shared by both)
    totalImpressions: analytics.filter(a => a.metric === 'impression').length,
    totalClicks: analytics.filter(a => a.metric === 'click').length,
    uniqueEvents: Math.min(
      new Set(analytics.slice(0, 10000).map(a => a.eventId)).size,
      analytics.length
    ),
    uniqueSponsors: Math.min(
      new Set(analytics.slice(0, 10000).filter(a => a.sponsorId).map(a => a.sponsorId)).size,
      analytics.length
    ),

    // Engagement rate (shared key metric)
    engagementRate: AnalyticsService_calculateEngagementRate(analytics),

    // By surface (shared - shows where engagement happens)
    bySurface: AnalyticsService_groupBySurface(analytics),

    // By event (for event managers)
    byEvent: !isSponsorView ? AnalyticsService_groupByEvent(analytics) : null,

    // By sponsor (for sponsors AND event managers)
    bySponsor: AnalyticsService_groupBySponsor(analytics),

    // Time-based trends (shared)
    dailyTrends: AnalyticsService_calculateDailyTrends(analytics)
  };

  return Ok(metrics);
}

// === Helper Functions =====================================================

/**
 * Verify event ownership (belongs to brand)
 *
 * @param {string} eventId - Event ID
 * @param {string} brandId - Brand ID
 * @returns {object} Result envelope (Ok/Err)
 */
function AnalyticsService_verifyEventOwnership(eventId, brandId) {
  const brand = findBrand_(brandId);
  if (!brand) return Err(ERR.NOT_FOUND, 'Unknown brand');

  const eventSheet = SpreadsheetApp.openById(brand.store.spreadsheetId)
    .getSheetByName('EVENTS');

  if (!eventSheet) {
    return Err(ERR.NOT_FOUND, 'Events sheet not found');
  }

  const eventRows = eventSheet.getDataRange().getValues().slice(1);
  const event = eventRows.find(r => r[0] === eventId && r[1] === brandId);

  if (!event) {
    diag_('warn', 'AnalyticsService_verifyEventOwnership', 'Unauthorized access attempt',
      { eventId, brandId });
    return Err(ERR.NOT_FOUND, 'Event not found or unauthorized');
  }

  return Ok();
}

/**
 * Calculate engagement rate from analytics data
 * Uses shared MetricsUtils_calculateCTR for DRY compliance
 *
 * @param {array} analytics - Analytics data
 * @returns {number} Engagement rate (%)
 */
function AnalyticsService_calculateEngagementRate(analytics) {
  const impressions = analytics.filter(a => a.metric === 'impression').length;
  const clicks = analytics.filter(a => a.metric === 'click').length;
  return MetricsUtils_calculateCTR(clicks, impressions);
}

/**
 * Group analytics by surface
 * Uses shared MetricsUtils_ for DRY compliance
 *
 * @param {array} analytics - Analytics data
 * @returns {object} Metrics grouped by surface
 */
function AnalyticsService_groupBySurface(analytics) {
  const grouped = {};

  for (const a of analytics) {
    if (!grouped[a.surface]) grouped[a.surface] = MetricsUtils_createBucket(false);
    MetricsUtils_incrementBucket(grouped[a.surface], a.metric);
  }

  return MetricsUtils_finalizeGrouped(grouped);
}

/**
 * Group analytics by event
 * Uses shared MetricsUtils_ for DRY compliance
 *
 * @param {array} analytics - Analytics data
 * @returns {object} Metrics grouped by event
 */
function AnalyticsService_groupByEvent(analytics) {
  const grouped = {};

  for (const a of analytics) {
    if (!grouped[a.eventId]) grouped[a.eventId] = MetricsUtils_createBucket(false);
    MetricsUtils_incrementBucket(grouped[a.eventId], a.metric);
  }

  return MetricsUtils_finalizeGrouped(grouped);
}

/**
 * Group analytics by sponsor
 * Uses shared MetricsUtils_ for DRY compliance
 *
 * @param {array} analytics - Analytics data
 * @returns {object} Metrics grouped by sponsor
 */
function AnalyticsService_groupBySponsor(analytics) {
  const grouped = {};

  for (const a of analytics) {
    const sponsorId = a.sponsorId || '-';
    if (!grouped[sponsorId]) grouped[sponsorId] = MetricsUtils_createBucket(false);
    MetricsUtils_incrementBucket(grouped[sponsorId], a.metric);
  }

  return MetricsUtils_finalizeGrouped(grouped);
}

/**
 * Calculate daily trends
 * Uses shared MetricsUtils_ for DRY compliance
 *
 * @param {array} analytics - Analytics data
 * @returns {array} Daily trend data
 */
function AnalyticsService_calculateDailyTrends(analytics) {
  const timeline = [];

  for (const a of analytics) {
    MetricsUtils_addToTimeline(timeline, a.timestamp, a.metric);
  }

  return MetricsUtils_finalizeTimeline(timeline);
}

// ═══════════════════════════════════════════════════════════════════════════════
// [MVP] TOP SPONSORS HELPER (used by SharedReporting.gs)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get top sponsors by clicks (for Top Sponsors card)
 *
 * Returns the top N sponsors sorted by click count (descending).
 * Used by SharedReporting.gs to populate the topSponsors field.
 *
 * @param {array} analytics - Analytics data rows with sponsorId and metric fields
 * @param {object} sponsorNameMap - Map of { sponsorId: sponsorName } for name resolution
 * @param {number} [limit=3] - Maximum number of sponsors to return
 * @returns {array} Array of SponsorMetrics: { id, name, impressions, clicks, ctr }
 */
function AnalyticsService_getTopSponsorsByClicks(analytics, sponsorNameMap, limit) {
  limit = limit || 3;
  const nameMap = sponsorNameMap || {};
  const sponsorMap = {};

  // Aggregate metrics per sponsor
  analytics.forEach(function(a) {
    if (!a.sponsorId) return;

    if (!sponsorMap[a.sponsorId]) {
      sponsorMap[a.sponsorId] = {
        id: a.sponsorId,
        name: nameMap[a.sponsorId] || a.sponsorId,
        impressions: 0,
        clicks: 0
      };
    }

    if (a.metric === 'impression') sponsorMap[a.sponsorId].impressions++;
    if (a.metric === 'click') sponsorMap[a.sponsorId].clicks++;
  });

  // Calculate CTR, sort by clicks descending, and limit results
  return Object.values(sponsorMap)
    .map(function(s) {
      s.ctr = s.impressions > 0
        ? Number(((s.clicks / s.impressions) * 100).toFixed(2))
        : 0;
      return s;
    })
    .sort(function(a, b) { return b.clicks - a.clicks; })
    .slice(0, limit);
}

// ═══════════════════════════════════════════════════════════════════════════════
// [V2-ONLY] MULTI-EVENT AGGREGATION PATHS
// ═══════════════════════════════════════════════════════════════════════════════
//
// The following operations are V2-only features NOT part of MVP:
//
// 1. Portfolio Analytics (api_getPortfolioAnalyticsV2) - archived in v2-code/
//    Multi-event cross-brand aggregation for parent organizations.
//    Requires: FEATURE_FLAGS.PORTFOLIO_V2 = true
//
// 2. Export Report (api_exportSharedReport) - guarded in SharedReporting.gs
//    Export analytics to CSV/JSON/PDF formats.
//    Requires: FEATURE_FLAGS.PORTFOLIO_V2 = true
//
// 3. Report Generation (api_generateSharedReport) - guarded in SharedReporting.gs
//    Generate formatted reports with recommendations.
//    Requires: FEATURE_FLAGS.PORTFOLIO_V2 = true
//
// MVP uses ONLY:
//   - api_getSharedAnalytics (single-event/brand analytics)
//   - api_getSponsorAnalytics (sponsor-scoped analytics)
//   - api_getSponsorReportQr (QR code generation)
//
// ═══════════════════════════════════════════════════════════════════════════════
