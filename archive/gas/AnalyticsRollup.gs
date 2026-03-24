// =============================================================================
// [MVP] ANALYTICS ROLLUP SERVICE
// =============================================================================
//
// Precomputed analytics summary table for SharedReport performance optimization.
// Computing analytics on-the-fly from raw logs drags as volume grows.
// Precomputing rollups keeps SharedReport snappy and predictable.
//
// ═══════════════════════════════════════════════════════════════════════════════
// SERVICE CONTRACT
// ═══════════════════════════════════════════════════════════════════════════════
//
// READS:
//   ← ANALYTICS sheet (raw event logs)
//   ← EVENTS sheet (for event name/slug resolution)
//   ← SPONSORS sheet (for sponsor name resolution)
//
// WRITES:
//   → EVENT_ANALYTICS sheet (precomputed rollup table)
//
// OUTPUT SHAPE (EVENT_ANALYTICS columns):
//   eventId       - UUID v4 of the event
//   slug          - URL-safe event identifier
//   name          - Human-readable event name
//   impressions   - Total impressions for this event
//   clicks        - Total clicks for this event
//   qrScans       - Total QR code scans
//   signups       - Total form submissions
//   ctaClicksJson - JSON: { poster: N, display: N, public: N, signup: N }
//   ctr           - Click-through rate percentage
//   lastRollupISO - Timestamp of last rollup (ISO 8601)
//
// ═══════════════════════════════════════════════════════════════════════════════
// IDEMPOTENCY GUARANTEE
// ═══════════════════════════════════════════════════════════════════════════════
//
// rebuildEventAnalytics_() is idempotent:
// - Clears all data rows (keeps header)
// - Rebuilds from raw ANALYTICS sheet
// - Re-running produces identical output (no double-counting)
//
// ═══════════════════════════════════════════════════════════════════════════════

// Sheet name constant
const EVENT_ANALYTICS_SHEET = 'EVENT_ANALYTICS';

// Column headers for EVENT_ANALYTICS sheet
const EVENT_ANALYTICS_HEADERS = [
  'eventId',
  'slug',
  'name',
  'impressions',
  'clicks',
  'qrScans',
  'signups',
  'ctaClicksJson',
  'ctr',
  'lastRollupISO'
];

// =============================================================================
// SHEET MANAGEMENT
// =============================================================================

/**
 * Get or create the EVENT_ANALYTICS sheet
 *
 * @param {string} [spreadsheetId] - Optional spreadsheet ID (uses root brand if not provided)
 * @returns {GoogleAppsScript.Spreadsheet.Sheet} The EVENT_ANALYTICS sheet
 */
function _ensureEventAnalyticsSheet_(spreadsheetId) {
  // If no spreadsheet ID provided, use root brand
  if (!spreadsheetId) {
    const rootBrand = findBrand_('root');
    if (rootBrand && rootBrand.store && rootBrand.store.spreadsheetId) {
      spreadsheetId = rootBrand.store.spreadsheetId;
    }
  }

  const ss = spreadsheetId
    ? SpreadsheetApp.openById(spreadsheetId)
    : SpreadsheetApp.getActive();

  let sh = ss.getSheetByName(EVENT_ANALYTICS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(EVENT_ANALYTICS_SHEET);
    sh.appendRow(EVENT_ANALYTICS_HEADERS);
    sh.setFrozenRows(1);

    // Set column widths for readability
    sh.setColumnWidth(1, 300);  // eventId (UUID)
    sh.setColumnWidth(2, 150);  // slug
    sh.setColumnWidth(3, 200);  // name
    sh.setColumnWidth(4, 100);  // impressions
    sh.setColumnWidth(5, 80);   // clicks
    sh.setColumnWidth(6, 80);   // qrScans
    sh.setColumnWidth(7, 80);   // signups
    sh.setColumnWidth(8, 250);  // ctaClicksJson
    sh.setColumnWidth(9, 80);   // ctr
    sh.setColumnWidth(10, 180); // lastRollupISO

    diag_('info', 'AnalyticsRollup', 'Created EVENT_ANALYTICS sheet');
  }
  return sh;
}

// =============================================================================
// ROLLUP IMPLEMENTATION
// =============================================================================

/**
 * Rebuild the EVENT_ANALYTICS rollup table from raw ANALYTICS data.
 *
 * This function is IDEMPOTENT:
 * - Clears existing rollup data (preserves header row)
 * - Reads all raw analytics from ANALYTICS sheet
 * - Aggregates metrics per event
 * - Writes fresh rollup rows
 *
 * Can be safely re-run without double-counting.
 *
 * @param {string} [brandId] - Optional brand ID to scope the rollup
 * @returns {Object} Result envelope with rollup stats
 */
function rebuildEventAnalytics_(brandId) {
  const startTime = Date.now();

  try {
    // Use lock to prevent concurrent rollups
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) {
      diag_('warn', 'rebuildEventAnalytics_', 'Failed to acquire lock - another rollup in progress');
      return Err(ERR.RATE_LIMITED, 'Analytics rollup already in progress');
    }

    try {
      // Get sheets
      const analyticsSheet = _ensureAnalyticsSheet_();
      const rollupSheet = _ensureEventAnalyticsSheet_();

      // Step 1: Read raw analytics data
      const rawData = analyticsSheet.getDataRange().getValues();
      const analyticsRows = rawData.slice(1); // Skip header

      if (analyticsRows.length === 0) {
        diag_('info', 'rebuildEventAnalytics_', 'No analytics data to rollup');
        return Ok({ eventsProcessed: 0, rowsRead: 0, durationMs: Date.now() - startTime });
      }

      // Step 2: Build event name/slug maps for enrichment
      const eventMaps = _buildEventMaps_(brandId);

      // Step 3: Aggregate metrics per event
      const eventMetrics = {};

      for (const row of analyticsRows) {
        const eventId = row[1];
        const surface = (row[2] || 'unknown').toLowerCase();
        const metric = row[3];

        // Skip rows without eventId
        if (!eventId) continue;

        // Initialize event bucket if needed
        if (!eventMetrics[eventId]) {
          eventMetrics[eventId] = {
            eventId: eventId,
            slug: eventMaps.slugs[eventId] || '',
            name: eventMaps.names[eventId] || eventId,
            impressions: 0,
            clicks: 0,
            qrScans: 0,
            signups: 0,
            ctaClicks: {
              poster: 0,
              display: 0,
              public: 0,
              signup: 0,
              admin: 0,
              unknown: 0
            }
          };
        }

        // Aggregate by metric type
        const bucket = eventMetrics[eventId];

        if (metric === 'impression') {
          bucket.impressions++;
        } else if (metric === 'click') {
          bucket.clicks++;
          // Track clicks by surface (CTA type)
          if (bucket.ctaClicks[surface] !== undefined) {
            bucket.ctaClicks[surface]++;
          } else {
            bucket.ctaClicks.unknown++;
          }
        } else if (metric === 'qr_scan') {
          bucket.qrScans++;
        } else if (metric === 'signup') {
          bucket.signups++;
        }
      }

      // Step 4: Prepare rollup rows
      const rollupTimestamp = new Date().toISOString();
      const rollupRows = Object.values(eventMetrics).map(e => {
        const ctr = MetricsUtils_calculateCTR(e.clicks, e.impressions);
        return [
          e.eventId,
          e.slug,
          e.name,
          e.impressions,
          e.clicks,
          e.qrScans,
          e.signups,
          JSON.stringify(e.ctaClicks),
          ctr,
          rollupTimestamp
        ];
      });

      // Step 5: Clear existing data and write new rollup (idempotent)
      const lastRow = rollupSheet.getLastRow();
      if (lastRow > 1) {
        rollupSheet.deleteRows(2, lastRow - 1);
      }

      if (rollupRows.length > 0) {
        rollupSheet.getRange(2, 1, rollupRows.length, EVENT_ANALYTICS_HEADERS.length)
          .setValues(rollupRows);
      }

      const duration = Date.now() - startTime;
      diag_('info', 'rebuildEventAnalytics_', 'Rollup complete', {
        eventsProcessed: rollupRows.length,
        rowsRead: analyticsRows.length,
        durationMs: duration
      });

      return Ok({
        eventsProcessed: rollupRows.length,
        rowsRead: analyticsRows.length,
        durationMs: duration,
        lastRollupISO: rollupTimestamp
      });

    } finally {
      lock.releaseLock();
    }

  } catch (e) {
    diag_('error', 'rebuildEventAnalytics_', 'Rollup failed', {
      error: e.message,
      stack: e.stack
    });
    return Err(ERR.INTERNAL, 'Analytics rollup failed: ' + e.message);
  }
}

/**
 * Build maps of eventId → name/slug for enrichment
 *
 * @param {string} [brandId] - Optional brand ID to filter events
 * @returns {Object} { names: { eventId: name }, slugs: { eventId: slug } }
 * @private
 */
function _buildEventMaps_(brandId) {
  const names = {};
  const slugs = {};

  try {
    // Try to get events from all brands if no brandId specified
    const brands = brandId ? [findBrand_(brandId)] : [
      findBrand_('root'),
      findBrand_('abc'),
      findBrand_('cbc'),
      findBrand_('cbl')
    ].filter(Boolean);

    for (const brand of brands) {
      if (!brand) continue;

      try {
        const sh = getStoreSheet_(brand, 'events');
        const lastRow = sh.getLastRow();
        if (lastRow <= 1) continue;

        // Get event rows: [id, brandId, templateId, dataJSON, createdAt, slug]
        const rows = sh.getRange(2, 1, lastRow - 1, 6).getValues();

        for (const row of rows) {
          const id = row[0];
          const slug = row[5];
          const dataJson = row[3];

          if (id) {
            slugs[id] = slug || '';
            const data = safeJSONParse_(dataJson, {});
            names[id] = data.name || id;
          }
        }
      } catch (e) {
        // Skip brand if events sheet doesn't exist
        diag_('debug', '_buildEventMaps_', 'Could not read events for brand', {
          brandId: brand.id,
          error: e.message
        });
      }
    }
  } catch (e) {
    diag_('warn', '_buildEventMaps_', 'Failed to build event maps', { error: e.message });
  }

  return { names, slugs };
}

// =============================================================================
// QUERY FUNCTIONS (for SharedReporting)
// =============================================================================

/**
 * Get analytics from the precomputed EVENT_ANALYTICS rollup table.
 * Returns null if the rollup table doesn't exist or is empty.
 *
 * This is the primary data source for SharedReporting when available.
 *
 * @param {Object} params - Query parameters
 * @param {string} [params.eventId] - Filter by specific event ID
 * @param {string} [params.brandId] - Brand ID (for filtering if needed)
 * @returns {Object|null} Aggregated analytics or null if rollup unavailable
 */
function getEventAnalyticsRollup_(params) {
  const { eventId, brandId } = params || {};

  try {
    // Try to get the rollup sheet
    let spreadsheetId;
    if (brandId) {
      const brand = findBrand_(brandId);
      if (brand && brand.store && brand.store.spreadsheetId) {
        spreadsheetId = brand.store.spreadsheetId;
      }
    }

    const ss = spreadsheetId
      ? SpreadsheetApp.openById(spreadsheetId)
      : SpreadsheetApp.getActive();

    const rollupSheet = ss.getSheetByName(EVENT_ANALYTICS_SHEET);

    // If rollup sheet doesn't exist, return null to trigger fallback
    if (!rollupSheet) {
      return null;
    }

    const lastRow = rollupSheet.getLastRow();

    // If only header row, return null (empty rollup)
    if (lastRow <= 1) {
      return null;
    }

    // Read rollup data
    const data = rollupSheet.getRange(2, 1, lastRow - 1, EVENT_ANALYTICS_HEADERS.length).getValues();

    // Parse into objects
    let rollupData = data.map(row => ({
      eventId: row[0],
      slug: row[1],
      name: row[2],
      impressions: row[3] || 0,
      clicks: row[4] || 0,
      qrScans: row[5] || 0,
      signups: row[6] || 0,
      ctaClicks: safeJSONParse_(row[7], {}),
      ctr: row[8] || 0,
      lastRollupISO: row[9]
    }));

    // Filter by eventId if specified
    if (eventId) {
      rollupData = rollupData.filter(r => r.eventId === eventId);
    }

    // Calculate summary
    const summary = {
      totalImpressions: 0,
      totalClicks: 0,
      totalQrScans: 0,
      totalSignups: 0,
      uniqueEvents: rollupData.length,
      uniqueSponsors: 0  // Not tracked in rollup, will be 0 or computed separately
    };

    // Surface aggregations
    const surfaceAgg = {
      poster: { impressions: 0, clicks: 0, qrScans: 0 },
      display: { impressions: 0, clicks: 0, qrScans: 0 },
      public: { impressions: 0, clicks: 0, qrScans: 0 },
      signup: { impressions: 0, clicks: 0, qrScans: 0 }
    };

    // Aggregate
    for (const row of rollupData) {
      summary.totalImpressions += row.impressions;
      summary.totalClicks += row.clicks;
      summary.totalQrScans += row.qrScans;
      summary.totalSignups += row.signups;

      // Distribute clicks to surfaces from ctaClicks
      for (const surface of ['poster', 'display', 'public', 'signup']) {
        if (row.ctaClicks[surface]) {
          surfaceAgg[surface].clicks += row.ctaClicks[surface];
        }
      }
    }

    // Find oldest rollup timestamp
    const lastRollup = rollupData.length > 0 ? rollupData[0].lastRollupISO : null;

    return {
      summary,
      events: rollupData,
      surfaceAgg,
      lastRollupISO: lastRollup,
      fromRollup: true  // Flag to indicate this came from precomputed data
    };

  } catch (e) {
    diag_('warn', 'getEventAnalyticsRollup_', 'Failed to read rollup', { error: e.message });
    return null;
  }
}

/**
 * Check if the analytics rollup is stale (older than threshold)
 *
 * @param {number} [maxAgeMinutes=60] - Maximum age in minutes before considered stale
 * @returns {boolean} True if rollup is stale or missing
 */
function isAnalyticsRollupStale_(maxAgeMinutes) {
  maxAgeMinutes = maxAgeMinutes || 60;

  try {
    const rollup = getEventAnalyticsRollup_({});
    if (!rollup || !rollup.lastRollupISO) {
      return true;
    }

    const rollupDate = new Date(rollup.lastRollupISO);
    const now = new Date();
    const ageMinutes = (now - rollupDate) / (1000 * 60);

    return ageMinutes > maxAgeMinutes;

  } catch (e) {
    return true;
  }
}

// =============================================================================
// MANUAL TRIGGER / MENU FUNCTIONS
// =============================================================================

/**
 * Force rebuild of analytics rollup.
 *
 * Exposed for manual triggering via:
 * - Script editor: Run > forceRebuildEventAnalytics
 * - Custom menu (if added via onOpen)
 * - Time-based trigger
 *
 * @returns {Object} Result envelope with rollup stats
 */
function forceRebuildEventAnalytics() {
  diag_('info', 'forceRebuildEventAnalytics', 'Manual rollup triggered');
  return rebuildEventAnalytics_();
}

/**
 * API endpoint to trigger analytics rollup manually.
 * Requires authentication (admin only in production).
 *
 * @param {Object} params - Request parameters
 * @param {string} [params.brandId] - Optional brand ID to scope rollup
 * @returns {Object} Result envelope with rollup stats
 */
function api_rebuildEventAnalytics(params) {
  return runSafe('api_rebuildEventAnalytics', () => {
    // Note: Add admin authentication check here for production
    // For now, allow any authenticated request

    const result = rebuildEventAnalytics_(params && params.brandId);
    return result;
  });
}

/**
 * Get rollup status for monitoring.
 *
 * @returns {Object} Rollup status information
 */
function api_getAnalyticsRollupStatus() {
  return runSafe('api_getAnalyticsRollupStatus', () => {
    try {
      const rollup = getEventAnalyticsRollup_({});

      if (!rollup) {
        return Ok({
          exists: false,
          message: 'Analytics rollup table not found or empty',
          stale: true
        });
      }

      const isStale = isAnalyticsRollupStale_(60);

      return Ok({
        exists: true,
        lastRollupISO: rollup.lastRollupISO,
        eventsCount: rollup.events ? rollup.events.length : 0,
        stale: isStale,
        summary: rollup.summary
      });

    } catch (e) {
      return Err(ERR.INTERNAL, 'Failed to get rollup status: ' + e.message);
    }
  });
}

// =============================================================================
// SCHEDULED TRIGGER SETUP
// =============================================================================

/**
 * Install a time-based trigger for scheduled rollup.
 * Call this once from the Script Editor to set up automatic rollups.
 *
 * Default schedule: Every hour.
 *
 * @param {number} [everyHours=1] - Run frequency in hours (1-24)
 */
function installAnalyticsRollupTrigger(everyHours) {
  everyHours = everyHours || 1;

  // Remove existing triggers for this function first
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'scheduledRebuildEventAnalytics_') {
      ScriptApp.deleteTrigger(trigger);
    }
  }

  // Create new hourly trigger
  ScriptApp.newTrigger('scheduledRebuildEventAnalytics_')
    .timeBased()
    .everyHours(everyHours)
    .create();

  diag_('info', 'installAnalyticsRollupTrigger', 'Trigger installed', { everyHours });
}

/**
 * Remove the scheduled rollup trigger.
 */
function removeAnalyticsRollupTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;

  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'scheduledRebuildEventAnalytics_') {
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  }

  diag_('info', 'removeAnalyticsRollupTrigger', 'Triggers removed', { count: removed });
}

/**
 * Handler for scheduled trigger.
 * Called by time-based trigger installed via installAnalyticsRollupTrigger().
 *
 * @private
 */
function scheduledRebuildEventAnalytics_() {
  diag_('info', 'scheduledRebuildEventAnalytics_', 'Scheduled rollup starting');
  rebuildEventAnalytics_();
}
