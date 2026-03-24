/**
 * V2 Sponsor Portfolio Analytics Module
 *
 * Multi-event portfolio mode for cross-brand sponsor ROI tracking.
 * This is a post-MVP feature designed to unlock future revenue levers.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * [V2] SERVICE CONTRACT
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * SCHEMA: /schemas/sponsor-portfolio-v2.schema.json (v2.0.0)
 *
 * READS:
 *   ← Config.gs (brand hierarchy: parent/child relationships)
 *   ← Analytics sheet (impressions, clicks by sponsorId across brands)
 *   ← Events sheet (event data per brand)
 *   ← SPONSORS sheet (sponsor entities per brand)
 *
 * WRITES: None (analytics-only service, does not mutate data)
 *
 * OUTPUT SHAPES:
 *   → PortfolioAnalytics: /schemas/sponsor-portfolio-v2.schema.json
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * PORTFOLIO MODES
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * 1. single-brand (default):
 *    - Standard SharedAnalytics behavior
 *    - Single brand context
 *
 * 2. multi-event-portfolio:
 *    - Cross-brand aggregation for parent organizations
 *    - Sponsor deduplication across child brands
 *    - Consolidated ROI metrics
 *    - Triggered by: ?portfolioMode=multi-event-portfolio
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ENDPOINTS
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * api_getPortfolioAnalyticsV2(params):
 *   - params.brandId: Parent brand ID (required)
 *   - params.sponsorId: Filter to specific sponsor (optional)
 *   - params.mode: 'single-brand' | 'multi-event-portfolio' (optional)
 *   - Returns: PortfolioAnalytics shape per schema
 *
 * api_getPortfolioSummaryV2(params):
 *   - params.brandId: Parent brand ID (required)
 *   - Returns: Portfolio summary metrics
 *
 * api_getPortfolioSponsorReportV2(params):
 *   - params.brandId: Parent brand ID (required)
 *   - params.sponsorId: Sponsor ID (required)
 *   - Returns: Consolidated sponsor report across portfolio
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * @module SponsorPortfolioV2
 * @version 2.0.0
 * @see /schemas/sponsor-portfolio-v2.schema.json
 */

// === Portfolio Mode Constants ================================================

const PORTFOLIO_MODES = {
  SINGLE_BRAND: 'single-brand',
  MULTI_EVENT: 'multi-event-portfolio'
};

// === V2 Portfolio Analytics API ==============================================

/**
 * Get V2 Portfolio Analytics
 *
 * Main entry point for portfolio analytics with mode selection.
 *
 * @param {Object} params - Request parameters
 * @param {string} params.brandId - Brand ID (parent org for multi-event mode)
 * @param {string} [params.mode='single-brand'] - Portfolio mode
 * @param {string} [params.sponsorId] - Filter to specific sponsor
 * @param {string} [params.adminKey] - Admin key for authentication
 * @returns {Object} Ok/Err envelope with PortfolioAnalytics
 */
function api_getPortfolioAnalyticsV2(params) {
  try {
    const { brandId, mode = PORTFOLIO_MODES.SINGLE_BRAND, sponsorId, adminKey } = params || {};

    // Validate required params
    if (!brandId) {
      return Err(ERR.BAD_INPUT, 'brandId required');
    }

    // Get brand configuration
    const brand = findBrand_(brandId);
    if (!brand) {
      return Err(ERR.NOT_FOUND, `Brand not found: ${brandId}`);
    }

    // For multi-event-portfolio mode, verify this is a parent org
    if (mode === PORTFOLIO_MODES.MULTI_EVENT) {
      if (brand.type !== 'parent' || !Array.isArray(brand.childBrands)) {
        return Err(ERR.BAD_INPUT, 'Multi-event portfolio mode requires a parent organization brand');
      }

      // Require admin authentication for portfolio view
      if (!adminKey || !_validateAdminKey_(brandId, adminKey)) {
        return Err(ERR.BAD_INPUT, 'Invalid admin key for portfolio access');
      }

      return _buildMultiEventPortfolioAnalytics_(brand, sponsorId);
    }

    // Single-brand mode: delegate to standard SharedAnalytics
    return api_getSharedAnalytics({
      brandId,
      sponsorId,
      isSponsorView: !!sponsorId
    });

  } catch (e) {
    diag_('error', 'api_getPortfolioAnalyticsV2', e.toString());
    return Err(ERR.INTERNAL, 'Failed to get portfolio analytics');
  }
}

/**
 * Get V2 Portfolio Summary
 *
 * Returns high-level portfolio metrics for parent organizations.
 *
 * @param {Object} params - Request parameters
 * @param {string} params.brandId - Parent brand ID
 * @param {string} params.adminKey - Admin authentication key
 * @returns {Object} Ok/Err envelope with portfolio summary
 */
function api_getPortfolioSummaryV2(params) {
  try {
    const { brandId, adminKey } = params || {};

    if (!brandId) {
      return Err(ERR.BAD_INPUT, 'brandId required');
    }

    const brand = findBrand_(brandId);
    if (!brand) {
      return Err(ERR.NOT_FOUND, `Brand not found: ${brandId}`);
    }

    // Verify parent organization
    if (brand.type !== 'parent' || !Array.isArray(brand.childBrands)) {
      return Err(ERR.BAD_INPUT, 'Portfolio summary requires a parent organization brand');
    }

    // Require admin authentication
    if (!adminKey || !_validateAdminKey_(brandId, adminKey)) {
      return Err(ERR.BAD_INPUT, 'Invalid admin key for portfolio access');
    }

    return _buildPortfolioSummary_(brand);

  } catch (e) {
    diag_('error', 'api_getPortfolioSummaryV2', e.toString());
    return Err(ERR.INTERNAL, 'Failed to get portfolio summary');
  }
}

/**
 * Get V2 Portfolio Sponsor Report
 *
 * Returns consolidated sponsor performance across all portfolio brands.
 *
 * @param {Object} params - Request parameters
 * @param {string} params.brandId - Parent brand ID
 * @param {string} params.sponsorId - Sponsor ID to report on
 * @param {string} params.adminKey - Admin authentication key
 * @returns {Object} Ok/Err envelope with sponsor portfolio report
 */
function api_getPortfolioSponsorReportV2(params) {
  try {
    const { brandId, sponsorId, adminKey } = params || {};

    if (!brandId) {
      return Err(ERR.BAD_INPUT, 'brandId required');
    }

    if (!sponsorId) {
      return Err(ERR.BAD_INPUT, 'sponsorId required for sponsor report');
    }

    const brand = findBrand_(brandId);
    if (!brand) {
      return Err(ERR.NOT_FOUND, `Brand not found: ${brandId}`);
    }

    // Verify parent organization
    if (brand.type !== 'parent' || !Array.isArray(brand.childBrands)) {
      return Err(ERR.BAD_INPUT, 'Portfolio sponsor report requires a parent organization brand');
    }

    // Require admin authentication
    if (!adminKey || !_validateAdminKey_(brandId, adminKey)) {
      return Err(ERR.BAD_INPUT, 'Invalid admin key for portfolio access');
    }

    return _buildPortfolioSponsorReport_(brand, sponsorId);

  } catch (e) {
    diag_('error', 'api_getPortfolioSponsorReportV2', e.toString());
    return Err(ERR.INTERNAL, 'Failed to get portfolio sponsor report');
  }
}

/**
 * Get list of sponsors across portfolio (for UI dropdown/selection)
 *
 * @param {Object} params - Request parameters
 * @param {string} params.brandId - Parent brand ID
 * @param {string} params.adminKey - Admin authentication key
 * @returns {Object} Ok/Err envelope with sponsor list
 */
function api_getPortfolioSponsorsV2(params) {
  try {
    const { brandId, adminKey } = params || {};

    if (!brandId) {
      return Err(ERR.BAD_INPUT, 'brandId required');
    }

    const brand = findBrand_(brandId);
    if (!brand) {
      return Err(ERR.NOT_FOUND, `Brand not found: ${brandId}`);
    }

    // Verify parent organization
    if (brand.type !== 'parent' || !Array.isArray(brand.childBrands)) {
      return Err(ERR.BAD_INPUT, 'Portfolio sponsors requires a parent organization brand');
    }

    // Require admin authentication
    if (!adminKey || !_validateAdminKey_(brandId, adminKey)) {
      return Err(ERR.BAD_INPUT, 'Invalid admin key for portfolio access');
    }

    return _getPortfolioSponsors_(brand);

  } catch (e) {
    diag_('error', 'api_getPortfolioSponsorsV2', e.toString());
    return Err(ERR.INTERNAL, 'Failed to get portfolio sponsors');
  }
}

// === Internal Helpers ========================================================

/**
 * Build multi-event portfolio analytics response
 *
 * @param {Object} parentBrand - Parent brand config
 * @param {string} [sponsorId] - Optional sponsor filter
 * @returns {Object} Ok envelope with portfolio analytics
 * @private
 */
function _buildMultiEventPortfolioAnalytics_(parentBrand, sponsorId) {
  const now = new Date().toISOString();

  // Get child brands that are included in portfolio reports
  const childBrands = _getIncludedChildBrands_(parentBrand);

  // Collect analytics from all brands in portfolio
  const allBrandIds = [parentBrand.id, ...childBrands.map(b => b.id)];
  const aggregatedAnalytics = _aggregatePortfolioAnalytics_(allBrandIds, sponsorId);

  // Build portfolio structure
  const portfolio = {
    parent: {
      id: parentBrand.id,
      name: parentBrand.name,
      isParent: true
    },
    children: childBrands.map(b => ({
      id: b.id,
      name: b.name,
      isParent: false
    }))
  };

  // Build summary metrics
  const summary = _calculatePortfolioSummary_(aggregatedAnalytics);

  // Build by-brand breakdown
  const byBrand = _buildByBrandMetrics_(aggregatedAnalytics, allBrandIds);

  // Build sponsors list (deduplicated)
  const sponsors = sponsorId
    ? null  // Single sponsor mode, no list needed
    : _buildPortfolioSponsorsList_(aggregatedAnalytics);

  // Build top performing events
  const topPerformingEvents = _getTopPerformingEvents_(aggregatedAnalytics, 10);

  return Ok({
    mode: PORTFOLIO_MODES.MULTI_EVENT,
    lastUpdatedISO: now,
    portfolio,
    summary,
    byBrand,
    sponsors,
    topPerformingEvents,
    roi: null,  // V2+ feature, requires sponsor cost data
    generatedAt: now
  });
}

/**
 * Build portfolio summary response
 *
 * @param {Object} parentBrand - Parent brand config
 * @returns {Object} Ok envelope with summary
 * @private
 */
function _buildPortfolioSummary_(parentBrand) {
  const now = new Date().toISOString();

  // Get child brands
  const childBrands = _getIncludedChildBrands_(parentBrand);
  const allBrandIds = [parentBrand.id, ...childBrands.map(b => b.id)];

  // Aggregate metrics
  const aggregatedAnalytics = _aggregatePortfolioAnalytics_(allBrandIds);
  const summary = _calculatePortfolioSummary_(aggregatedAnalytics);
  const byBrand = _buildByBrandMetrics_(aggregatedAnalytics, allBrandIds);

  return Ok({
    portfolio: {
      parent: {
        id: parentBrand.id,
        name: parentBrand.name
      },
      children: childBrands.map(b => ({
        id: b.id,
        name: b.name
      }))
    },
    metrics: summary,
    byBrand,
    generatedAt: now
  });
}

/**
 * Build portfolio sponsor report for a specific sponsor
 *
 * @param {Object} parentBrand - Parent brand config
 * @param {string} sponsorId - Sponsor ID
 * @returns {Object} Ok envelope with sponsor report
 * @private
 */
function _buildPortfolioSponsorReport_(parentBrand, sponsorId) {
  const now = new Date().toISOString();

  // Get child brands
  const childBrands = _getIncludedChildBrands_(parentBrand);
  const allBrandIds = [parentBrand.id, ...childBrands.map(b => b.id)];

  // Aggregate metrics for this sponsor only
  const aggregatedAnalytics = _aggregatePortfolioAnalytics_(allBrandIds, sponsorId);
  const summary = _calculatePortfolioSummary_(aggregatedAnalytics);
  const byBrand = _buildByBrandMetrics_(aggregatedAnalytics, allBrandIds);
  const topEvents = _getTopPerformingEvents_(aggregatedAnalytics, 5);

  // Get sponsor info
  const sponsorInfo = _getSponsorInfo_(allBrandIds, sponsorId);

  return Ok({
    parentOrg: {
      id: parentBrand.id,
      name: parentBrand.name
    },
    sponsor: sponsorInfo || { id: sponsorId, name: sponsorId },
    portfolioSummary: {
      totalEvents: summary.totalEvents,
      totalImpressions: summary.totalImpressions,
      totalClicks: summary.totalClicks,
      portfolioCTR: summary.portfolioCTR.toFixed(2)
    },
    byBrand,
    topPerformingEvents: topEvents,
    generatedAt: now
  });
}

/**
 * Get sponsors list across portfolio
 *
 * @param {Object} parentBrand - Parent brand config
 * @returns {Object} Ok envelope with sponsors list
 * @private
 */
function _getPortfolioSponsors_(parentBrand) {
  // Get child brands
  const childBrands = _getIncludedChildBrands_(parentBrand);
  const allBrandIds = [parentBrand.id, ...childBrands.map(b => b.id)];

  // Collect all sponsors from all brands
  const sponsorMap = new Map();

  for (const brandId of allBrandIds) {
    const brand = findBrand_(brandId);
    if (!brand) continue;

    // Get sponsors from SPONSORS sheet
    try {
      const sponsorSheet = getStoreSheet_(brand, 'sponsors');
      const lastRow = sponsorSheet.getLastRow();
      if (lastRow > 1) {
        const rows = sponsorSheet.getRange(2, 1, lastRow - 1, 4).getValues();

        rows.forEach(row => {
          const id = row[0];
          const rowBrandId = row[1];
          const dataJson = row[3];

          if (rowBrandId === brandId && id) {
            const data = safeJSONParse_(dataJson, {});
            if (!sponsorMap.has(id)) {
              sponsorMap.set(id, {
                id,
                name: data.name || id,
                logoUrl: data.logoUrl || null,
                brands: [{
                  brandId,
                  brandName: brand.name
                }]
              });
            } else {
              const existing = sponsorMap.get(id);
              if (!existing.brands.some(b => b.brandId === brandId)) {
                existing.brands.push({
                  brandId,
                  brandName: brand.name
                });
              }
            }
          }
        });
      }
    } catch (e) {
      // SPONSORS sheet might not exist - continue
      diag_('debug', '_getPortfolioSponsors_', 'No SPONSORS sheet', { brandId });
    }

    // Also get sponsors embedded in events
    try {
      const eventSheet = getStoreSheet_(brand, 'events');
      const eventLastRow = eventSheet.getLastRow();
      if (eventLastRow > 1) {
        const eventRows = eventSheet.getRange(2, 1, eventLastRow - 1, 4).getValues();

        eventRows.forEach(row => {
          const rowBrandId = row[1];
          const dataJson = row[3];

          if (rowBrandId === brandId) {
            const data = safeJSONParse_(dataJson, {});
            if (Array.isArray(data.sponsors)) {
              data.sponsors.forEach(sponsor => {
                if (sponsor.id && sponsor.name) {
                  if (!sponsorMap.has(sponsor.id)) {
                    sponsorMap.set(sponsor.id, {
                      id: sponsor.id,
                      name: sponsor.name,
                      logoUrl: sponsor.logoUrl || null,
                      brands: [{
                        brandId,
                        brandName: brand.name
                      }]
                    });
                  } else {
                    const existing = sponsorMap.get(sponsor.id);
                    if (!existing.brands.some(b => b.brandId === brandId)) {
                      existing.brands.push({
                        brandId,
                        brandName: brand.name
                      });
                    }
                  }
                }
              });
            }
          }
        });
      }
    } catch (e) {
      diag_('debug', '_getPortfolioSponsors_', 'Error reading events', { brandId, error: e.message });
    }
  }

  const sponsors = Array.from(sponsorMap.values());

  return Ok({
    sponsors,
    totalCount: sponsors.length
  });
}

/**
 * Get child brands that should be included in portfolio reports
 *
 * @param {Object} parentBrand - Parent brand config
 * @returns {Array} Array of child brand configs
 * @private
 */
function _getIncludedChildBrands_(parentBrand) {
  if (!Array.isArray(parentBrand.childBrands)) return [];

  return parentBrand.childBrands
    .map(childId => findBrand_(childId))
    .filter(child => child && child.includeInPortfolioReports !== false);
}

/**
 * Aggregate analytics across multiple brands
 *
 * @param {Array} brandIds - Array of brand IDs
 * @param {string} [sponsorId] - Optional sponsor filter
 * @returns {Object} Aggregated analytics data
 * @private
 */
function _aggregatePortfolioAnalytics_(brandIds, sponsorId) {
  const result = {
    byBrand: {},
    byEvent: {},
    bySponsor: {},
    bySurface: {},
    totals: {
      impressions: 0,
      clicks: 0,
      qrScans: 0,
      signups: 0
    },
    events: new Set(),
    sponsors: new Set()
  };

  for (const brandId of brandIds) {
    const brand = findBrand_(brandId);
    if (!brand) continue;

    // Initialize brand bucket
    result.byBrand[brandId] = {
      brandId,
      brandName: brand.name,
      events: 0,
      impressions: 0,
      clicks: 0,
      qrScans: 0,
      signups: 0
    };

    try {
      // Count events for this brand
      const eventSheet = getStoreSheet_(brand, 'events');
      const eventLastRow = eventSheet.getLastRow();
      if (eventLastRow > 1) {
        const eventRows = eventSheet.getRange(2, 1, eventLastRow - 1, 4).getValues();
        eventRows.forEach(row => {
          if (row[1] === brandId) {
            result.byBrand[brandId].events++;
            result.events.add(row[0]); // event ID
          }
        });
      }
    } catch (e) {
      // No events sheet
    }

    try {
      // Read analytics for this brand
      const sh = _ensureAnalyticsSheet_();
      const rows = sh.getDataRange().getValues().slice(1);

      rows.forEach(row => {
        const eventId = row[1];
        const surface = row[2];
        const metric = row[3];
        const rowSponsorId = row[4];

        // Skip if sponsor filter doesn't match
        if (sponsorId && rowSponsorId !== sponsorId) return;

        // Track sponsors
        if (rowSponsorId) {
          result.sponsors.add(rowSponsorId);
        }

        // Initialize event bucket
        if (!result.byEvent[eventId]) {
          result.byEvent[eventId] = {
            id: eventId,
            brandId,
            impressions: 0,
            clicks: 0,
            qrScans: 0,
            signups: 0
          };
        }

        // Initialize sponsor bucket
        if (rowSponsorId && !result.bySponsor[rowSponsorId]) {
          result.bySponsor[rowSponsorId] = {
            id: rowSponsorId,
            impressions: 0,
            clicks: 0,
            qrScans: 0
          };
        }

        // Initialize surface bucket
        if (!result.bySurface[surface]) {
          result.bySurface[surface] = {
            id: surface,
            impressions: 0,
            clicks: 0,
            qrScans: 0
          };
        }

        // Increment counters
        if (metric === 'impression') {
          result.totals.impressions++;
          result.byBrand[brandId].impressions++;
          result.byEvent[eventId].impressions++;
          if (rowSponsorId) result.bySponsor[rowSponsorId].impressions++;
          result.bySurface[surface].impressions++;
        } else if (metric === 'click') {
          result.totals.clicks++;
          result.byBrand[brandId].clicks++;
          result.byEvent[eventId].clicks++;
          if (rowSponsorId) result.bySponsor[rowSponsorId].clicks++;
          result.bySurface[surface].clicks++;
        } else if (metric === 'qr_scan') {
          result.totals.qrScans++;
          result.byBrand[brandId].qrScans++;
          result.byEvent[eventId].qrScans++;
          if (rowSponsorId) result.bySponsor[rowSponsorId].qrScans++;
          result.bySurface[surface].qrScans++;
        } else if (metric === 'signup') {
          result.totals.signups++;
          result.byBrand[brandId].signups++;
          result.byEvent[eventId].signups++;
        }
      });
    } catch (e) {
      diag_('warn', '_aggregatePortfolioAnalytics_', 'Failed to read analytics', {
        brandId,
        error: e.message
      });
    }
  }

  return result;
}

/**
 * Calculate portfolio summary from aggregated analytics
 *
 * @param {Object} aggregated - Aggregated analytics data
 * @returns {Object} Summary metrics
 * @private
 */
function _calculatePortfolioSummary_(aggregated) {
  const { totals, events, sponsors, bySponsor } = aggregated;

  // Count active sponsors (those with at least one impression)
  const activeSponsors = Object.values(bySponsor).filter(s => s.impressions > 0).length;

  // Calculate portfolio CTR
  const portfolioCTR = totals.impressions > 0
    ? (totals.clicks / totals.impressions) * 100
    : 0;

  return {
    totalEvents: events.size,
    totalImpressions: totals.impressions,
    totalClicks: totals.clicks,
    totalQrScans: totals.qrScans,
    totalSignups: totals.signups,
    totalSponsors: sponsors.size,
    activeSponsors,
    portfolioCTR
  };
}

/**
 * Build by-brand metrics breakdown
 *
 * @param {Object} aggregated - Aggregated analytics
 * @param {Array} brandIds - Brand IDs
 * @returns {Object} Metrics by brand
 * @private
 */
function _buildByBrandMetrics_(aggregated, brandIds) {
  const result = {};

  for (const brandId of brandIds) {
    const brandData = aggregated.byBrand[brandId];
    if (!brandData) continue;

    const ctr = brandData.impressions > 0
      ? (brandData.clicks / brandData.impressions) * 100
      : 0;

    result[brandId] = {
      brandId: brandData.brandId,
      brandName: brandData.brandName,
      events: brandData.events,
      impressions: brandData.impressions,
      clicks: brandData.clicks,
      ctr: +ctr.toFixed(2),
      qrScans: brandData.qrScans,
      signups: brandData.signups
    };
  }

  return result;
}

/**
 * Build portfolio sponsors list (deduplicated)
 *
 * @param {Object} aggregated - Aggregated analytics
 * @returns {Array} Sponsor list with metrics
 * @private
 */
function _buildPortfolioSponsorsList_(aggregated) {
  return Object.values(aggregated.bySponsor)
    .map(sponsor => {
      const ctr = sponsor.impressions > 0
        ? (sponsor.clicks / sponsor.impressions) * 100
        : 0;

      return {
        id: sponsor.id,
        name: sponsor.id, // Name resolved later
        logoUrl: null,
        brands: [],
        metrics: {
          impressions: sponsor.impressions,
          clicks: sponsor.clicks,
          ctr: +ctr.toFixed(2),
          qrScans: sponsor.qrScans,
          engagementScore: null
        }
      };
    })
    .sort((a, b) => b.metrics.impressions - a.metrics.impressions);
}

/**
 * Get top performing events across portfolio
 *
 * @param {Object} aggregated - Aggregated analytics
 * @param {number} limit - Max events to return
 * @returns {Array} Top events sorted by impressions
 * @private
 */
function _getTopPerformingEvents_(aggregated, limit) {
  const eventNameMap = {};

  // Build name map for all brands
  for (const brandId of Object.keys(aggregated.byBrand)) {
    Object.assign(eventNameMap, buildEventNameMap_(brandId));
  }

  return Object.values(aggregated.byEvent)
    .map(event => {
      const ctr = event.impressions > 0
        ? (event.clicks / event.impressions) * 100
        : 0;

      const brand = findBrand_(event.brandId);

      return {
        id: event.id,
        name: eventNameMap[event.id] || event.id,
        brandId: event.brandId,
        brandName: brand ? brand.name : event.brandId,
        impressions: event.impressions,
        clicks: event.clicks,
        ctr: +ctr.toFixed(2),
        signupsCount: event.signups
      };
    })
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, limit);
}

/**
 * Get sponsor info from across portfolio brands
 *
 * @param {Array} brandIds - Brand IDs to search
 * @param {string} sponsorId - Sponsor ID
 * @returns {Object|null} Sponsor info or null
 * @private
 */
function _getSponsorInfo_(brandIds, sponsorId) {
  for (const brandId of brandIds) {
    const nameMap = buildSponsorNameMap_(brandId);
    if (nameMap[sponsorId]) {
      return {
        id: sponsorId,
        name: nameMap[sponsorId]
      };
    }
  }
  return null;
}

/**
 * Validate admin key for a brand
 *
 * @param {string} brandId - Brand ID
 * @param {string} adminKey - Admin key to validate
 * @returns {boolean} True if valid
 * @private
 */
function _validateAdminKey_(brandId, adminKey) {
  try {
    // Get admin secret from Script Properties
    const props = PropertiesService.getScriptProperties();
    const secretKey = `ADMIN_SECRET_${brandId.toUpperCase()}`;
    const expected = props.getProperty(secretKey);

    if (!expected) {
      diag_('warn', '_validateAdminKey_', 'No admin secret configured', { brandId });
      return false;
    }

    return adminKey === expected;
  } catch (e) {
    diag_('error', '_validateAdminKey_', 'Failed to validate', { error: e.message });
    return false;
  }
}
