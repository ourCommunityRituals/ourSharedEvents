/**
 * SharedAnalytics Fixtures for E2E Testing
 *
 * Schema: /schemas/shared-analytics.schema.json (v1.1 frozen)
 *
 * These fixtures provide test data for SharedReport mobile E2E tests.
 * All fixtures comply with the SharedAnalytics schema contract.
 */

/**
 * Full SharedAnalytics fixture - complete organizer view with all optional fields
 * Use this to test the full SharedReport rendering with sponsors, events, topSponsors
 */
const fullSharedAnalytics = {
  lastUpdatedISO: new Date().toISOString(),
  summary: {
    totalImpressions: 15420,
    totalClicks: 892,
    totalQrScans: 234,
    totalSignups: 156,
    uniqueEvents: 5,
    uniqueSponsors: 8
  },
  surfaces: [
    {
      id: 'display',
      label: 'Digital Display',
      impressions: 8500,
      clicks: 425,
      qrScans: 0,
      engagementRate: 5.0
    },
    {
      id: 'public',
      label: 'Public Page',
      impressions: 4200,
      clicks: 315,
      qrScans: 120,
      engagementRate: 10.4
    },
    {
      id: 'poster',
      label: 'Poster QR',
      impressions: 1820,
      clicks: 112,
      qrScans: 114,
      engagementRate: 12.4
    },
    {
      id: 'signup',
      label: 'Signup Form',
      impressions: 900,
      clicks: 40,
      qrScans: 0,
      engagementRate: 4.4
    }
  ],
  sponsors: [
    { id: 'sponsor-1', name: 'TechCorp Solutions', impressions: 4500, clicks: 225, ctr: 5.0 },
    { id: 'sponsor-2', name: 'Global Industries', impressions: 3800, clicks: 190, ctr: 5.0 },
    { id: 'sponsor-3', name: 'Innovation Labs', impressions: 2900, clicks: 174, ctr: 6.0 },
    { id: 'sponsor-4', name: 'Premier Partners', impressions: 2100, clicks: 147, ctr: 7.0 },
    { id: 'sponsor-5', name: 'Summit Group', impressions: 1200, clicks: 96, ctr: 8.0 },
    { id: 'sponsor-6', name: 'Apex Ventures', impressions: 520, clicks: 36, ctr: 6.9 },
    { id: 'sponsor-7', name: 'NextGen Corp', impressions: 300, clicks: 18, ctr: 6.0 },
    { id: 'sponsor-8', name: 'Future Tech', impressions: 100, clicks: 6, ctr: 6.0 }
  ],
  events: [
    { id: 'event-1', name: 'Annual Conference 2025', impressions: 5200, clicks: 312, ctr: 6.0, signupsCount: 78 },
    { id: 'event-2', name: 'Tech Summit Q1', impressions: 3800, clicks: 228, ctr: 6.0, signupsCount: 45 },
    { id: 'event-3', name: 'Innovation Workshop', impressions: 2900, clicks: 174, ctr: 6.0, signupsCount: 22 },
    { id: 'event-4', name: 'Networking Mixer', impressions: 2100, clicks: 126, ctr: 6.0, signupsCount: 8 },
    { id: 'event-5', name: 'Product Launch', impressions: 1420, clicks: 52, ctr: 3.7, signupsCount: 3 }
  ],
  topSponsors: [
    { id: 'sponsor-1', name: 'TechCorp Solutions', impressions: 4500, clicks: 225, ctr: 5.0 },
    { id: 'sponsor-2', name: 'Global Industries', impressions: 3800, clicks: 190, ctr: 5.0 },
    { id: 'sponsor-3', name: 'Innovation Labs', impressions: 2900, clicks: 174, ctr: 6.0 }
  ]
};

/**
 * Minimal SharedAnalytics fixture - summary only, no sponsors/events/topSponsors
 * Use this to test the "summary only" state without optional sections
 */
const minimalSharedAnalytics = {
  lastUpdatedISO: new Date().toISOString(),
  summary: {
    totalImpressions: 250,
    totalClicks: 12,
    totalQrScans: 5,
    totalSignups: 2,
    uniqueEvents: 1,
    uniqueSponsors: 0
  },
  surfaces: [
    {
      id: 'public',
      label: 'Public Page',
      impressions: 250,
      clicks: 12,
      qrScans: 5,
      engagementRate: 6.8
    }
  ]
  // No sponsors, events, or topSponsors - tests graceful handling of missing optional fields
};

/**
 * Empty SharedAnalytics fixture - zero metrics
 * Use this to test rendering with no data collected yet
 */
const emptySharedAnalytics = {
  lastUpdatedISO: new Date().toISOString(),
  summary: {
    totalImpressions: 0,
    totalClicks: 0,
    totalQrScans: 0,
    totalSignups: 0,
    uniqueEvents: 0,
    uniqueSponsors: 0
  },
  surfaces: []
};

/**
 * Sponsor-view SharedAnalytics fixture - scoped to a single sponsor
 * Use this to test the sponsor report view
 */
const sponsorViewAnalytics = {
  lastUpdatedISO: new Date().toISOString(),
  summary: {
    totalImpressions: 4500,
    totalClicks: 225,
    totalQrScans: 45,
    totalSignups: 18,
    uniqueEvents: 3,
    uniqueSponsors: 1
  },
  surfaces: [
    {
      id: 'display',
      label: 'Digital Display',
      impressions: 2500,
      clicks: 125,
      qrScans: 0,
      engagementRate: 5.0
    },
    {
      id: 'public',
      label: 'Public Page',
      impressions: 1500,
      clicks: 75,
      qrScans: 30,
      engagementRate: 7.0
    },
    {
      id: 'poster',
      label: 'Poster QR',
      impressions: 500,
      clicks: 25,
      qrScans: 15,
      engagementRate: 8.0
    }
  ],
  sponsors: [
    { id: 'sponsor-1', name: 'TechCorp Solutions', impressions: 4500, clicks: 225, ctr: 5.0 }
  ],
  events: [
    { id: 'event-1', name: 'Annual Conference 2025', impressions: 2000, clicks: 100, ctr: 5.0, signupsCount: 10 },
    { id: 'event-2', name: 'Tech Summit Q1', impressions: 1500, clicks: 75, ctr: 5.0, signupsCount: 5 },
    { id: 'event-3', name: 'Innovation Workshop', impressions: 1000, clicks: 50, ctr: 5.0, signupsCount: 3 }
  ]
};

/**
 * High-engagement SharedAnalytics fixture - high CTR values
 * Use this to test rendering of success/high-performance badges
 */
const highEngagementAnalytics = {
  lastUpdatedISO: new Date().toISOString(),
  summary: {
    totalImpressions: 10000,
    totalClicks: 1500,
    totalQrScans: 800,
    totalSignups: 450,
    uniqueEvents: 3,
    uniqueSponsors: 5
  },
  surfaces: [
    {
      id: 'display',
      label: 'Digital Display',
      impressions: 5000,
      clicks: 750,
      qrScans: 0,
      engagementRate: 15.0
    },
    {
      id: 'public',
      label: 'Public Page',
      impressions: 3000,
      clicks: 450,
      qrScans: 500,
      engagementRate: 31.7
    },
    {
      id: 'poster',
      label: 'Poster QR',
      impressions: 2000,
      clicks: 300,
      qrScans: 300,
      engagementRate: 30.0
    }
  ],
  sponsors: [
    { id: 'sponsor-1', name: 'Top Performer Inc', impressions: 4000, clicks: 600, ctr: 15.0 },
    { id: 'sponsor-2', name: 'Engagement Masters', impressions: 3000, clicks: 450, ctr: 15.0 },
    { id: 'sponsor-3', name: 'Click Champions', impressions: 2000, clicks: 300, ctr: 15.0 }
  ],
  topSponsors: [
    { id: 'sponsor-1', name: 'Top Performer Inc', impressions: 4000, clicks: 600, ctr: 15.0 },
    { id: 'sponsor-2', name: 'Engagement Masters', impressions: 3000, clicks: 450, ctr: 15.0 },
    { id: 'sponsor-3', name: 'Click Champions', impressions: 2000, clicks: 300, ctr: 15.0 }
  ]
};

module.exports = {
  // Primary fixtures
  fullSharedAnalytics,
  minimalSharedAnalytics,
  emptySharedAnalytics,

  // View-specific fixtures
  sponsorViewAnalytics,

  // Performance variants
  highEngagementAnalytics,

  // Helper to generate fresh timestamps
  withFreshTimestamp: (fixture) => ({
    ...fixture,
    lastUpdatedISO: new Date().toISOString()
  })
};
