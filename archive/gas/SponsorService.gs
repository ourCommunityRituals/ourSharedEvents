/**
 * Sponsor Service
 *
 * Centralizes all sponsor-related operations:
 * - Sponsor contract validation (validateSponsorContract)
 * - Sponsor analytics (impressions, clicks, CTR)
 * - Performance metrics and insights
 * - ROI calculations
 * - Portfolio reports (cross-brand)
 * - Engagement scoring
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * [MVP] SERVICE CONTRACT
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * READS:
 *   ← Analytics sheet (impressions, clicks by sponsorId)
 *   ← Brand config (sponsor list per brand)
 *
 * WRITES: None (analytics-only service, does not mutate sponsor data)
 *
 * OUTPUT SHAPES (aligns with schemas):
 *   → Sponsor entity: /schemas/sponsor.schema.json
 *   → SponsorMetrics: /schemas/shared-analytics.schema.json $defs/SponsorMetrics
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * SCHEMA CONTRACT: Sponsor shape (/schemas/sponsor.schema.json)
 * {
 *   id: string,              // [MVP] Sponsor identifier
 *   name: string,            // [MVP] Display name
 *   logoUrl: string,         // [MVP] Logo URL (https)
 *   linkUrl: string|null,    // [MVP] Click-through URL (optional)
 *   placement: enum,         // [Legacy] 'poster'|'display'|'public'|'tv-banner'
 *   placements: {            // [V2] Multi-placement configuration
 *     posterTop: boolean,    // Show on poster top banner
 *     tvTop: boolean,        // Show on TV display top banner
 *     tvSide: boolean,       // Show on TV display side panel
 *     mobileBanner: boolean  // Show on mobile/public banner
 *   },
 *   clickToken: string|null,       // [V2] Tracking token for click attribution
 *   impressionToken: string|null   // [V2] Tracking token for impression attribution
 * }
 *
 * SponsorMetrics shape (/schemas/shared-analytics.schema.json):
 * {
 *   id: string,              // [MVP] Sponsor identifier
 *   name: string,            // [MVP] Display name
 *   impressions: integer,    // [MVP] Total impressions
 *   clicks: integer,         // [MVP] Total clicks
 *   ctr: number              // [MVP] Click-through rate percentage
 * }
 *
 * SponsorService MUST only emit the above fields. Any additional fields
 * are reserved for V2+ and should not be added without schema update.
 *
 * [V2+] FEATURES (not in MVP scope):
 *   - SponsorService_calculateROI() → ROI/financial calculations
 *   - SponsorService_generateInsights() → AI-driven insights
 *   - SponsorService_getSettings() → Placement configuration
 *   - SponsorService_validatePlacements() → Placement validation
 *   - SponsorService_getPortfolioSponsors() → Cross-brand portfolio
 *
 * Design principles:
 * - Encapsulates sponsor business logic
 * - Provides data aggregation and analysis
 * - Separates data retrieval from presentation
 * - Supports multi-brand portfolio views
 *
 * @module SponsorService
 */

// === Contract Validation =================================================

/**
 * Valid placement values for legacy single-placement mode
 * @constant {string[]}
 */
var VALID_PLACEMENTS = ['poster', 'display', 'public', 'tv-banner'];

/**
 * Valid placement keys for multi-placement mode
 * @constant {string[]}
 */
var VALID_PLACEMENT_KEYS = ['posterTop', 'tvTop', 'tvSide', 'mobileBanner'];

/**
 * Validate a sponsor object against the Sponsor Contract
 *
 * Enforces the canonical sponsor shape defined in /schemas/sponsor.schema.json.
 * Returns validation result with errors array if invalid.
 *
 * Required fields: id, name, logoUrl
 * Must have either: placement (legacy) OR placements (v2)
 *
 * @param {object} sponsor - Sponsor object to validate
 * @returns {object} Validation result: { valid: boolean, errors: string[], sponsor: object|null }
 *
 * @example
 * // Valid v2 sponsor
 * validateSponsorContract({
 *   id: 'sp-123',
 *   name: 'Acme Corp',
 *   logoUrl: 'https://example.com/logo.png',
 *   placements: { posterTop: true, tvTop: true }
 * });
 * // => { valid: true, errors: [], sponsor: {...} }
 *
 * @example
 * // Invalid sponsor (missing id)
 * validateSponsorContract({ name: 'Test' });
 * // => { valid: false, errors: ['Missing required field: id'], sponsor: null }
 */
function validateSponsorContract(sponsor) {
  var errors = [];

  // Null/undefined check
  if (!sponsor || typeof sponsor !== 'object') {
    return { valid: false, errors: ['Sponsor must be a non-null object'], sponsor: null };
  }

  // Required field: id
  if (!sponsor.id || typeof sponsor.id !== 'string' || sponsor.id.trim() === '') {
    errors.push('Missing required field: id');
  } else if (!/^[a-zA-Z0-9_-]+$/.test(sponsor.id)) {
    errors.push('Invalid id: must contain only alphanumeric characters, underscores, and hyphens');
  } else if (sponsor.id.length > 128) {
    errors.push('Invalid id: must be 128 characters or fewer');
  }

  // Required field: name
  if (!sponsor.name || typeof sponsor.name !== 'string' || sponsor.name.trim() === '') {
    errors.push('Missing required field: name');
  } else if (sponsor.name.length > 200) {
    errors.push('Invalid name: must be 200 characters or fewer');
  }

  // Required field: logoUrl
  if (!sponsor.logoUrl || typeof sponsor.logoUrl !== 'string' || sponsor.logoUrl.trim() === '') {
    errors.push('Missing required field: logoUrl');
  } else if (!/^https?:\/\/.+/.test(sponsor.logoUrl)) {
    errors.push('Invalid logoUrl: must be a valid HTTP/HTTPS URL');
  }

  // Optional field: linkUrl (if present, must be valid URL or null)
  if (sponsor.linkUrl !== undefined && sponsor.linkUrl !== null) {
    if (typeof sponsor.linkUrl !== 'string' || !/^https?:\/\/.+/.test(sponsor.linkUrl)) {
      errors.push('Invalid linkUrl: must be a valid HTTP/HTTPS URL or null');
    }
  }

  // Must have either placement (legacy) or placements (v2)
  var hasPlacement = sponsor.placement !== undefined && sponsor.placement !== null;
  var hasPlacements = sponsor.placements !== undefined && sponsor.placements !== null;

  if (!hasPlacement && !hasPlacements) {
    errors.push('Must have either placement (string) or placements (object)');
  }

  // Validate legacy placement
  if (hasPlacement) {
    if (typeof sponsor.placement !== 'string' || VALID_PLACEMENTS.indexOf(sponsor.placement) === -1) {
      errors.push('Invalid placement: must be one of ' + VALID_PLACEMENTS.join(', '));
    }
  }

  // Validate v2 placements object
  if (hasPlacements) {
    if (typeof sponsor.placements !== 'object') {
      errors.push('Invalid placements: must be an object');
    } else {
      var placementKeys = Object.keys(sponsor.placements);
      var hasAtLeastOne = false;

      for (var i = 0; i < placementKeys.length; i++) {
        var key = placementKeys[i];
        if (VALID_PLACEMENT_KEYS.indexOf(key) === -1) {
          errors.push('Invalid placement key: ' + key + '. Valid keys: ' + VALID_PLACEMENT_KEYS.join(', '));
        } else if (typeof sponsor.placements[key] !== 'boolean') {
          errors.push('Invalid placement value for ' + key + ': must be boolean');
        } else if (sponsor.placements[key] === true) {
          hasAtLeastOne = true;
        }
      }

      if (!hasAtLeastOne && placementKeys.length > 0) {
        errors.push('At least one placement must be enabled (true)');
      }
    }
  }

  // Validate optional tokens
  if (sponsor.clickToken !== undefined && sponsor.clickToken !== null) {
    if (typeof sponsor.clickToken !== 'string' || sponsor.clickToken.length > 256) {
      errors.push('Invalid clickToken: must be a string of 256 characters or fewer');
    }
  }

  if (sponsor.impressionToken !== undefined && sponsor.impressionToken !== null) {
    if (typeof sponsor.impressionToken !== 'string' || sponsor.impressionToken.length > 256) {
      errors.push('Invalid impressionToken: must be a string of 256 characters or fewer');
    }
  }

  // Validate optional tier
  if (sponsor.tier !== undefined && sponsor.tier !== null) {
    var validTiers = ['title', 'platinum', 'gold', 'silver', 'bronze', 'primary'];
    if (typeof sponsor.tier !== 'string' || validTiers.indexOf(sponsor.tier) === -1) {
      errors.push('Invalid tier: must be one of ' + validTiers.join(', '));
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors: errors, sponsor: null };
  }

  // Return normalized sponsor object
  return {
    valid: true,
    errors: [],
    sponsor: {
      id: sponsor.id.trim(),
      name: sponsor.name.trim(),
      logoUrl: sponsor.logoUrl.trim(),
      linkUrl: sponsor.linkUrl || null,
      placement: sponsor.placement || null,
      placements: sponsor.placements || null,
      clickToken: sponsor.clickToken || null,
      impressionToken: sponsor.impressionToken || null,
      tier: sponsor.tier || null
    }
  };
}

/**
 * Validate an array of sponsors against the Sponsor Contract
 *
 * @param {array} sponsors - Array of sponsor objects to validate
 * @returns {object} Validation result: { valid: boolean, errors: object[], validSponsors: object[] }
 */
function validateSponsorsArray(sponsors) {
  if (!Array.isArray(sponsors)) {
    return { valid: false, errors: [{ index: -1, errors: ['Sponsors must be an array'] }], validSponsors: [] };
  }

  var allErrors = [];
  var validSponsors = [];

  for (var i = 0; i < sponsors.length; i++) {
    var result = validateSponsorContract(sponsors[i]);
    if (result.valid) {
      validSponsors.push(result.sponsor);
    } else {
      allErrors.push({ index: i, sponsorId: sponsors[i]?.id || '(unknown)', errors: result.errors });
    }
  }

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    validSponsors: validSponsors,
    totalCount: sponsors.length,
    validCount: validSponsors.length,
    invalidCount: allErrors.length
  };
}

/**
 * Check if a sponsor should be shown on a specific surface
 *
 * Handles both legacy (placement string) and v2 (placements object) formats.
 *
 * @param {object} sponsor - Sponsor object
 * @param {string} surface - Surface to check ('poster', 'display', 'public', 'tv-banner')
 * @returns {boolean} True if sponsor should be shown on the surface
 */
function shouldShowSponsorOnSurface(sponsor, surface) {
  if (!sponsor) return false;

  // V2 placements object takes precedence
  if (sponsor.placements) {
    switch (surface) {
      case 'poster':
        return sponsor.placements.posterTop === true;
      case 'display':
      case 'tv-banner':
        return sponsor.placements.tvTop === true || sponsor.placements.tvSide === true;
      case 'public':
        return sponsor.placements.mobileBanner === true;
      default:
        return false;
    }
  }

  // Legacy: single placement string
  if (sponsor.placement) {
    // 'display' and 'tv-banner' are interchangeable for backward compatibility
    if (surface === 'display' || surface === 'tv-banner') {
      return sponsor.placement === 'display' || sponsor.placement === 'tv-banner';
    }
    return sponsor.placement === surface;
  }

  return false;
}

/**
 * Filter sponsors for a specific surface
 *
 * @param {array} sponsors - Array of sponsor objects
 * @param {string} surface - Surface to filter for ('poster', 'display', 'public', 'tv-banner')
 * @returns {array} Sponsors that should appear on the surface
 */
function filterSponsorsForSurface(sponsors, surface) {
  if (!Array.isArray(sponsors)) return [];
  return sponsors.filter(function(s) {
    return shouldShowSponsorOnSurface(s, surface);
  });
}

// === Analytics Operations =================================================

/**
 * Get sponsor-specific analytics data
 *
 * @param {object} params - Analytics parameters
 * @param {string} params.sponsorId - Sponsor ID
 * @param {string} [params.eventId] - Filter by event ID
 * @param {string} [params.dateFrom] - Start date (ISO)
 * @param {string} [params.dateTo] - End date (ISO)
 * @param {string} [params.brandId] - Brand ID (for admin access)
 * @returns {object} Result envelope with analytics data
 */
function SponsorService_getAnalytics(params) {
  if (!params || typeof params !== 'object') {
    return Err(ERR.BAD_INPUT, 'Missing payload');
  }

  const { sponsorId, eventId, dateFrom, dateTo } = params;

  if (!sponsorId) return Err(ERR.BAD_INPUT, 'Missing sponsorId');

  // Get analytics data
  const sh = _ensureAnalyticsSheet_();
  let data = sh.getDataRange().getValues().slice(1);

  // Filter by sponsor ID
  data = data.filter(r => r[4] === sponsorId);

  // Filter by event ID if provided
  if (eventId) {
    data = data.filter(r => r[1] === eventId);
  }

  // Filter by date range if provided
  if (dateFrom || dateTo) {
    const fromDate = dateFrom ? new Date(dateFrom) : new Date(0);
    const toDate = dateTo ? new Date(dateTo) : new Date();

    data = data.filter(r => {
      const rowDate = new Date(r[0]); // timestamp column
      return rowDate >= fromDate && rowDate <= toDate;
    });
  }

  // Aggregate metrics
  const agg = SponsorService_aggregateMetrics(data, sponsorId);

  diag_('info', 'SponsorService_getAnalytics', 'Analytics retrieved', {
    sponsorId,
    eventId: eventId || 'all',
    totalImpressions: agg.totals.impressions
  });

  return Ok(agg);
}

/**
 * Aggregate sponsor metrics from raw analytics data
 * Uses shared MetricsUtils_ from AnalyticsService for DRY compliance
 *
 * @param {array} data - Raw analytics rows
 * @param {string} sponsorId - Sponsor ID
 * @returns {object} Aggregated metrics
 */
function SponsorService_aggregateMetrics(data, sponsorId) {
  const agg = {
    sponsorId: sponsorId,
    totals: MetricsUtils_createBucket(true),
    bySurface: {},
    byEvent: {},
    timeline: []
  };

  // Process each analytics row using shared utilities
  for (const r of data) {
    const parsed = MetricsUtils_parseRow(r);
    const { timestamp, eventId, surface, metric, value } = parsed;

    // Initialize buckets using shared utility
    if (!agg.bySurface[surface]) agg.bySurface[surface] = MetricsUtils_createBucket(true);
    if (!agg.byEvent[eventId]) agg.byEvent[eventId] = MetricsUtils_createBucket(true);

    // Increment all buckets using shared utility
    MetricsUtils_incrementBucket(agg.totals, metric, value);
    MetricsUtils_incrementBucket(agg.bySurface[surface], metric, value);
    MetricsUtils_incrementBucket(agg.byEvent[eventId], metric, value);

    // Track daily timeline using shared utility
    MetricsUtils_addToTimeline(agg.timeline, timestamp, metric, value);
  }

  // Calculate CTR for all aggregations using shared utilities
  MetricsUtils_applyCTR(agg.totals);
  MetricsUtils_finalizeGrouped(agg.bySurface);
  MetricsUtils_finalizeGrouped(agg.byEvent);
  MetricsUtils_finalizeTimeline(agg.timeline);

  // Add engagement score
  agg.totals.engagementScore = SponsorService_calculateEngagementScore(
    agg.totals.ctr,
    agg.totals.dwellSec,
    agg.totals.impressions
  );

  // Add performance insights
  agg.insights = SponsorService_generateInsights(agg);

  return agg;
}

// === [V2+] ROI Calculations ===============================================

/**
 * Calculate ROI metrics for a sponsor
 *
 * @param {object} params - ROI parameters
 * @param {string} params.sponsorId - Sponsor ID
 * @param {number} [params.sponsorshipCost=0] - Total sponsorship investment
 * @param {number} [params.costPerClick=0] - Expected cost per click
 * @param {number} [params.conversionRate=0] - Conversion rate (%)
 * @param {number} [params.avgTransactionValue=0] - Average transaction value
 * @param {string} [params.dateFrom] - Start date
 * @param {string} [params.dateTo] - End date
 * @returns {object} Result envelope with ROI metrics
 */
function SponsorService_calculateROI(params) {
  const {
    sponsorId,
    sponsorshipCost = 0,
    costPerClick = 0,
    conversionRate = 0,
    avgTransactionValue = 0,
    dateFrom,
    dateTo
  } = params || {};

  if (!sponsorId) return Err(ERR.BAD_INPUT, 'Missing sponsorId');

  // Get analytics for the sponsor
  const analyticsResult = SponsorService_getAnalytics({
    sponsorId,
    dateFrom,
    dateTo
  });

  if (!analyticsResult.ok) return analyticsResult;

  const analytics = analyticsResult.value;

  // Calculate ROI metrics
  const totalClicks = analytics.totals.clicks;
  const totalImpressions = analytics.totals.impressions;
  const ctr = analytics.totals.ctr;

  // Estimated value from clicks
  const estimatedConversions = totalClicks * (conversionRate / 100);
  const estimatedRevenue = estimatedConversions * avgTransactionValue;

  // Cost metrics
  const actualCostPerClick = sponsorshipCost > 0 && totalClicks > 0
    ? sponsorshipCost / totalClicks
    : costPerClick;

  const totalCost = sponsorshipCost || (totalClicks * costPerClick);

  // ROI calculation: (Revenue - Cost) / Cost * 100
  const roi = totalCost > 0
    ? ((estimatedRevenue - totalCost) / totalCost * 100).toFixed(2)
    : 0;

  // Cost per impression (CPM - Cost Per Mille)
  const cpm = totalImpressions > 0
    ? (totalCost / totalImpressions * 1000).toFixed(2)
    : 0;

  return Ok({
    sponsorId,
    period: { from: dateFrom, to: dateTo },
    metrics: {
      impressions: totalImpressions,
      clicks: totalClicks,
      ctr: ctr,
      engagementScore: analytics.totals.engagementScore
    },
    financials: {
      totalCost: parseFloat(totalCost.toFixed(2)),
      costPerClick: parseFloat(actualCostPerClick.toFixed(2)),
      cpm: parseFloat(cpm),
      estimatedConversions: parseFloat(estimatedConversions.toFixed(2)),
      estimatedRevenue: parseFloat(estimatedRevenue.toFixed(2)),
      roi: parseFloat(roi)
    },
    insights: SponsorService_generateROIInsights({
      roi: parseFloat(roi),
      ctr,
      cpm: parseFloat(cpm),
      engagementScore: analytics.totals.engagementScore
    })
  });
}

// === [V2+] Engagement & Insights ==========================================

/**
 * Calculate engagement score from CTR and dwell time
 *
 * @param {number} ctr - Click-through rate (percentage)
 * @param {number} dwellSec - Total dwell time in seconds
 * @param {number} impressions - Total impressions
 * @returns {number} Engagement score (0-100)
 */
function SponsorService_calculateEngagementScore(ctr, dwellSec, impressions) {
  if (impressions === 0) return 0;

  // Normalize dwell time (assuming 5 seconds is good engagement per impression)
  const avgDwellPerImpression = dwellSec / impressions;
  const normalizedDwell = Math.min(avgDwellPerImpression / 5 * 100, 100);

  // Weight: 60% CTR, 40% dwell time
  const score = (ctr * 0.6) + (normalizedDwell * 0.4);

  return +score.toFixed(2);
}

/**
 * Generate performance insights for sponsors
 *
 * @param {object} agg - Aggregated analytics data
 * @returns {array} Array of insight objects
 */
function SponsorService_generateInsights(agg) {
  const insights = [];

  // Insight 1: Best performing surface
  let bestSurface = null;
  let bestCTR = 0;

  for (const [surface, data] of Object.entries(agg.bySurface)) {
    if (data.ctr > bestCTR && data.impressions >= 10) {
      bestCTR = data.ctr;
      bestSurface = surface;
    }
  }

  if (bestSurface) {
    insights.push({
      type: 'best_surface',
      message: `Best performing surface: ${bestSurface} (${bestCTR}% CTR)`,
      surface: bestSurface,
      ctr: bestCTR
    });
  }

  // Insight 2: Engagement trend
  if (agg.timeline.length >= 7) {
    const recentDays = agg.timeline.slice(-7);
    const recentAvgCTR = recentDays.reduce((sum, d) => sum + d.ctr, 0) / 7;
    const previousDays = agg.timeline.slice(-14, -7);
    const previousAvgCTR = previousDays.length > 0
      ? previousDays.reduce((sum, d) => sum + d.ctr, 0) / previousDays.length
      : 0;

    if (recentAvgCTR > previousAvgCTR * 1.1) {
      insights.push({
        type: 'trending_up',
        message: `Engagement trending up: ${recentAvgCTR.toFixed(2)}% CTR (last 7 days)`,
        trend: 'up',
        currentCTR: recentAvgCTR.toFixed(2)
      });
    } else if (recentAvgCTR < previousAvgCTR * 0.9) {
      insights.push({
        type: 'trending_down',
        message: `Engagement trending down: ${recentAvgCTR.toFixed(2)}% CTR (last 7 days)`,
        trend: 'down',
        currentCTR: recentAvgCTR.toFixed(2)
      });
    }
  }

  // Insight 3: Engagement score rating
  const score = agg.totals.engagementScore;
  if (score >= 70) {
    insights.push({
      type: 'high_engagement',
      message: `Excellent engagement score: ${score}/100`,
      score: score,
      rating: 'excellent'
    });
  } else if (score < 40) {
    insights.push({
      type: 'low_engagement',
      message: `Low engagement score: ${score}/100. Consider optimizing creative or placement.`,
      score: score,
      rating: 'needs_improvement'
    });
  }

  return insights;
}

/**
 * Generate ROI-specific insights
 *
 * @param {object} metrics - ROI metrics
 * @returns {array} Array of ROI insights
 */
function SponsorService_generateROIInsights(metrics) {
  const insights = [];
  const { roi, ctr, cpm, engagementScore } = metrics;

  // ROI insights
  if (roi > 100) {
    insights.push({
      type: 'positive_roi',
      message: `Strong positive ROI of ${roi}%`,
      severity: 'success'
    });
  } else if (roi > 0) {
    insights.push({
      type: 'moderate_roi',
      message: `Moderate positive ROI of ${roi}%`,
      severity: 'info'
    });
  } else {
    insights.push({
      type: 'negative_roi',
      message: `Negative ROI of ${roi}%. Review campaign effectiveness.`,
      severity: 'warning'
    });
  }

  // CPM insights (industry benchmark: $5-$15 for digital display)
  if (cpm < 5) {
    insights.push({
      type: 'low_cpm',
      message: `Very cost-effective CPM of $${cpm}`,
      severity: 'success'
    });
  } else if (cpm > 15) {
    insights.push({
      type: 'high_cpm',
      message: `High CPM of $${cpm}. Consider negotiating better rates.`,
      severity: 'warning'
    });
  }

  // CTR insights (industry benchmark: 0.5%-2% for display)
  if (ctr > 2) {
    insights.push({
      type: 'excellent_ctr',
      message: `Exceptional CTR of ${ctr}% (above industry average)`,
      severity: 'success'
    });
  } else if (ctr < 0.5) {
    insights.push({
      type: 'low_ctr',
      message: `Low CTR of ${ctr}%. Consider improving creative or targeting.`,
      severity: 'warning'
    });
  }

  return insights;
}

// === [V2+] Configuration Operations =======================================

/**
 * Get sponsor placement settings and configurations
 *
 * Returns available placement positions, allowed positions per surface,
 * and upsell opportunities (e.g., dedicated TV pane).
 *
 * @param {object} params - Settings parameters
 * @param {string} [params.brandId] - Brand ID for brand-specific settings
 * @returns {object} Result envelope with sponsor settings
 */
function SponsorService_getSettings(params) {
  const { brandId } = params || {};

  // Default placement settings
  const settings = {
    placements: {
      posterTop: {
        name: 'Poster Top Banner',
        description: 'Large banner at the top of printed posters',
        surface: 'poster',
        maxSponsors: 1,
        dimensions: { width: 800, height: 120 },
        recommended: true
      },
      posterBottom: {
        name: 'Poster Bottom Banner',
        description: 'Banner at the bottom of printed posters',
        surface: 'poster',
        maxSponsors: 1,
        dimensions: { width: 800, height: 100 }
      },
      tvTop: {
        name: 'TV Display Top Banner',
        description: 'Banner at the top of TV displays',
        surface: 'display',
        maxSponsors: 1,
        dimensions: { width: 1920, height: 200 },
        recommended: true
      },
      tvSide: {
        name: 'TV Display Side Cards',
        description: 'Rotating sponsor cards in sidebar',
        surface: 'display',
        maxSponsors: 5,
        dimensions: { width: 300, height: 250 }
      },
      tvDedicated: {
        name: 'Dedicated TV Pane (Premium)',
        description: 'Full-screen sponsor rotation',
        surface: 'display',
        maxSponsors: 3,
        premium: true,
        upsell: true,
        dimensions: { width: 1920, height: 1080 }
      },
      mobileBanner: {
        name: 'Mobile Banner',
        description: 'Banner on mobile public page',
        surface: 'public',
        maxSponsors: 1,
        dimensions: { width: 375, height: 90 },
        recommended: true
      },
      mobileInline: {
        name: 'Mobile Inline Card',
        description: 'Inline sponsor card in mobile content',
        surface: 'public',
        maxSponsors: 3,
        dimensions: { width: 375, height: 200 }
      }
    },
    surfaces: {
      poster: {
        name: 'Poster/Print',
        allowedPlacements: ['posterTop', 'posterBottom']
      },
      display: {
        name: 'TV Display',
        allowedPlacements: ['tvTop', 'tvSide', 'tvDedicated']
      },
      public: {
        name: 'Mobile/Public Page',
        allowedPlacements: ['mobileBanner', 'mobileInline']
      }
    },
    features: {
      analytics: {
        enabled: true,
        metrics: ['impressions', 'clicks', 'ctr', 'dwellTime', 'engagementScore']
      },
      rotation: {
        enabled: true,
        minDuration: 5,
        maxDuration: 300,
        defaultDuration: 10
      },
      upsells: {
        tvDedicated: {
          available: true,
          description: 'Upgrade to dedicated TV pane rotation for maximum visibility',
          benefits: [
            'Full-screen sponsor visibility',
            'Dedicated rotation slot',
            'Premium analytics dashboard',
            'Higher engagement rates'
          ]
        }
      }
    }
  };

  // If brand-specific settings exist, merge them
  if (brandId) {
    const brand = findBrand_(brandId);
    if (brand && brand.sponsorSettings) {
      // Merge brand-specific overrides
      Object.assign(settings, brand.sponsorSettings);
    }
  }

  diag_('info', 'SponsorService_getSettings', 'Settings retrieved', {
    brandId: brandId || 'default',
    placementsCount: Object.keys(settings.placements).length
  });

  return Ok(settings);
}

/**
 * Validate sponsor placement configuration
 *
 * Ensures sponsors are assigned to valid placements and don't exceed limits.
 *
 * @param {object} params - Validation parameters
 * @param {array} params.sponsors - Array of sponsor objects with placements
 * @param {string} [params.brandId] - Brand ID for settings lookup
 * @returns {object} Result envelope with validation results
 */
function SponsorService_validatePlacements(params) {
  const { sponsors, brandId } = params || {};

  if (!Array.isArray(sponsors)) {
    return Err(ERR.BAD_INPUT, 'Sponsors must be an array');
  }

  // Get settings
  const settingsResult = SponsorService_getSettings({ brandId });
  if (!settingsResult.ok) return settingsResult;

  const settings = settingsResult.value;
  const placementSettings = settings.placements;

  const errors = [];
  const warnings = [];
  const placementCounts = {};

  // Count sponsors per placement
  for (const sponsor of sponsors) {
    const placements = sponsor.placements || {};

    for (const [placementId, enabled] of Object.entries(placements)) {
      if (!enabled) continue;

      // Check if placement exists
      if (!placementSettings[placementId]) {
        errors.push({
          sponsorId: sponsor.id,
          sponsorName: sponsor.name,
          placement: placementId,
          message: `Invalid placement: ${placementId}`
        });
        continue;
      }

      // Count placement usage
      placementCounts[placementId] = (placementCounts[placementId] || 0) + 1;
    }
  }

  // Check placement limits
  for (const [placementId, count] of Object.entries(placementCounts)) {
    const setting = placementSettings[placementId];
    const maxSponsors = setting.maxSponsors || 999;

    if (count > maxSponsors) {
      errors.push({
        placement: placementId,
        count: count,
        max: maxSponsors,
        message: `Placement ${placementId} has ${count} sponsors but only allows ${maxSponsors}`
      });
    }
  }

  // Check for recommended placements not used
  for (const [placementId, setting] of Object.entries(placementSettings)) {
    if (setting.recommended && !placementCounts[placementId]) {
      warnings.push({
        placement: placementId,
        message: `Recommended placement ${setting.name} is not being used`
      });
    }
  }

  const isValid = errors.length === 0;

  return Ok({
    valid: isValid,
    errors,
    warnings,
    placementCounts,
    totalSponsors: sponsors.length
  });
}

// === [V2+] Portfolio Operations ===========================================

/**
 * Get portfolio sponsor list (all sponsors across child brands)
 *
 * @param {string} parentBrandId - Parent brand ID
 * @returns {object} Result envelope with sponsor list
 */
function SponsorService_getPortfolioSponsors(parentBrandId) {
  const parentBrand = findBrand_(parentBrandId);
  if (!parentBrand) {
    return Err(ERR.NOT_FOUND, 'Unknown parent brand');
  }

  const childBrandIds = parentBrand.childBrands || [];

  // Collect all unique sponsors across all child brands
  const sponsorsMap = new Map();

  for (const childBrandId of childBrandIds) {
    const childBrand = findBrand_(childBrandId);
    if (!childBrand) continue;

    const sponsors = childBrand.sponsors || [];
    for (const sponsor of sponsors) {
      if (!sponsorsMap.has(sponsor.id)) {
        sponsorsMap.set(sponsor.id, {
          id: sponsor.id,
          name: sponsor.name,
          logo: sponsor.logo,
          brands: [childBrandId]
        });
      } else {
        const existing = sponsorsMap.get(sponsor.id);
        if (!existing.brands.includes(childBrandId)) {
          existing.brands.push(childBrandId);
        }
      }
    }
  }

  const sponsors = Array.from(sponsorsMap.values());

  return Ok({
    parentBrandId,
    totalSponsors: sponsors.length,
    sponsors
  });
}
