/**
 * Analytics Fixtures for Testing
 *
 * Shared analytics data for After Event phase testing
 */

/**
 * Basic analytics response (After Event phase)
 */
const basicAnalytics = {
  ok: true,
  value: {
    totals: {
      impressions: 1000,
      clicks: 50,
      dwellSec: 10000,
      ctr: 0.05
    },
    bySurface: {
      display: {
        impressions: 500,
        clicks: 25,
        dwellSec: 5000,
        ctr: 0.05
      },
      public: {
        impressions: 300,
        clicks: 15,
        dwellSec: 3000,
        ctr: 0.05
      },
      poster: {
        impressions: 200,
        clicks: 10,
        dwellSec: 2000,
        ctr: 0.05
      }
    },
    bySponsor: {
      'platinum-corp': {
        impressions: 600,
        clicks: 30,
        dwellSec: 6000,
        ctr: 0.05
      },
      'gold-industries': {
        impressions: 300,
        clicks: 15,
        dwellSec: 3000,
        ctr: 0.05
      },
      'silver-solutions': {
        impressions: 100,
        clicks: 5,
        dwellSec: 1000,
        ctr: 0.05
      }
    },
    byToken: {
      'token-abc123': {
        impressions: 200,
        clicks: 10,
        dwellSec: 2000,
        ctr: 0.05,
        targetUrl: 'https://example.com/registration'
      }
    }
  }
};

/**
 * Empty analytics (event with no data)
 */
const emptyAnalytics = {
  ok: true,
  value: {
    totals: {
      impressions: 0,
      clicks: 0,
      dwellSec: 0,
      ctr: 0
    },
    bySurface: {},
    bySponsor: {},
    byToken: {}
  }
};

/**
 * High-performance event analytics
 */
const highPerformanceAnalytics = {
  ok: true,
  value: {
    totals: {
      impressions: 10000,
      clicks: 1000,
      dwellSec: 100000,
      ctr: 0.10 // 10% CTR
    },
    bySurface: {
      display: {
        impressions: 6000,
        clicks: 600,
        dwellSec: 60000,
        ctr: 0.10
      },
      public: {
        impressions: 3000,
        clicks: 300,
        dwellSec: 30000,
        ctr: 0.10
      },
      poster: {
        impressions: 1000,
        clicks: 100,
        dwellSec: 10000,
        ctr: 0.10
      }
    },
    bySponsor: {},
    byToken: {}
  }
};

/**
 * Low-performance event analytics
 */
const lowPerformanceAnalytics = {
  ok: true,
  value: {
    totals: {
      impressions: 1000,
      clicks: 10,
      dwellSec: 1000,
      ctr: 0.01 // 1% CTR
    },
    bySurface: {
      display: {
        impressions: 600,
        clicks: 6,
        dwellSec: 600,
        ctr: 0.01
      },
      public: {
        impressions: 300,
        clicks: 3,
        dwellSec: 300,
        ctr: 0.01
      },
      poster: {
        impressions: 100,
        clicks: 1,
        dwellSec: 100,
        ctr: 0.01
      }
    },
    bySponsor: {},
    byToken: {}
  }
};

/**
 * Analytics event log entry (for logging)
 */
const analyticsEventLog = {
  eventType: 'impression',
  surface: 'display',
  sponsorId: 'platinum-corp',
  token: 'token-abc123',
  timestamp: new Date().toISOString(),
  metadata: {
    userAgent: 'Mozilla/5.0...',
    deviceType: 'desktop',
    viewportWidth: 1920,
    viewportHeight: 1080
  }
};

/**
 * Batch analytics events
 */
const batchAnalyticsEvents = [
  {
    eventType: 'impression',
    surface: 'display',
    sponsorId: 'platinum-corp',
    timestamp: new Date().toISOString()
  },
  {
    eventType: 'click',
    surface: 'display',
    sponsorId: 'platinum-corp',
    timestamp: new Date().toISOString()
  },
  {
    eventType: 'impression',
    surface: 'public',
    sponsorId: 'gold-industries',
    timestamp: new Date().toISOString()
  },
  {
    eventType: 'dwell',
    surface: 'display',
    sponsorId: 'platinum-corp',
    dwellSec: 15,
    timestamp: new Date().toISOString()
  }
];

/**
 * Daily trend data
 */
const dailyTrends = {
  ok: true,
  value: {
    dates: [
      '2025-01-01',
      '2025-01-02',
      '2025-01-03',
      '2025-01-04',
      '2025-01-05'
    ],
    impressions: [100, 200, 300, 250, 150],
    clicks: [5, 10, 15, 12, 8],
    ctr: [0.05, 0.05, 0.05, 0.048, 0.053]
  }
};

/**
 * Sponsor ROI comparison
 */
const sponsorROIComparison = {
  ok: true,
  value: {
    sponsors: [
      {
        name: 'Platinum Corp',
        impressions: 600,
        clicks: 30,
        ctr: 0.05,
        roi: 2.5, // 250% ROI
        costPerClick: 2.50
      },
      {
        name: 'Gold Industries',
        impressions: 300,
        clicks: 15,
        ctr: 0.05,
        roi: 1.8,
        costPerClick: 3.33
      },
      {
        name: 'Silver Solutions',
        impressions: 100,
        clicks: 5,
        ctr: 0.05,
        roi: 1.2,
        costPerClick: 5.00
      }
    ]
  }
};

module.exports = {
  // Basic analytics
  basicAnalytics,
  emptyAnalytics,

  // Performance variants
  highPerformanceAnalytics,
  lowPerformanceAnalytics,

  // Event logging
  analyticsEventLog,
  batchAnalyticsEvents,

  // Trends and comparisons
  dailyTrends,
  sponsorROIComparison
};
