/**
 * Sponsor Fixtures for Testing
 *
 * Shared sponsor data for all test types across Triangle phases
 *
 * CONTRACT: /schemas/sponsor.schema.json
 * Required fields: id, name, logoUrl, (placement OR placements)
 * Optional fields: linkUrl, clickToken, impressionToken, tier
 */

/**
 * Sponsor tier definitions
 */
const sponsorTiers = {
  platinum: {
    name: 'Platinum',
    color: '#FFD700',
    priority: 1
  },
  gold: {
    name: 'Gold',
    color: '#C0C0C0',
    priority: 2
  },
  silver: {
    name: 'Silver',
    color: '#CD7F32',
    priority: 3
  }
};

/**
 * Valid placement keys per contract
 */
const VALID_PLACEMENT_KEYS = ['posterTop', 'tvTop', 'tvSide', 'mobileBanner'];

/**
 * Platinum sponsor fixture (Contract-compliant)
 */
const platinumSponsor = {
  id: 'sp-platinum-corp',
  name: 'Platinum Corp',
  logoUrl: 'https://via.placeholder.com/300x100/FFD700/000000?text=Platinum+Corp',
  linkUrl: 'https://platinum-corp.example.com',
  tier: 'platinum',
  placements: {
    posterTop: true,
    tvTop: true,
    tvSide: true,
    mobileBanner: true
  },
  clickToken: 'plat-click-token-001',
  impressionToken: 'plat-imp-token-001'
};

/**
 * Gold sponsor fixture (Contract-compliant)
 */
const goldSponsor = {
  id: 'sp-gold-industries',
  name: 'Gold Industries',
  logoUrl: 'https://via.placeholder.com/300x100/C0C0C0/000000?text=Gold+Industries',
  linkUrl: 'https://gold-industries.example.com',
  tier: 'gold',
  placements: {
    posterTop: true,
    tvTop: false,
    tvSide: true,
    mobileBanner: true
  },
  clickToken: 'gold-click-token-001',
  impressionToken: 'gold-imp-token-001'
};

/**
 * Silver sponsor fixture (Contract-compliant)
 */
const silverSponsor = {
  id: 'sp-silver-solutions',
  name: 'Silver Solutions',
  logoUrl: 'https://via.placeholder.com/300x100/CD7F32/000000?text=Silver+Solutions',
  linkUrl: 'https://silver-solutions.example.com',
  tier: 'silver',
  placements: {
    posterTop: false,
    tvTop: false,
    tvSide: true,
    mobileBanner: false
  },
  clickToken: null,
  impressionToken: null
};

/**
 * Multi-tier sponsor configuration (typical event setup)
 */
const multiTierSponsors = [
  platinumSponsor,
  goldSponsor,
  silverSponsor
];

/**
 * Single sponsor configuration (small event)
 */
const singleSponsor = [platinumSponsor];

/**
 * Large sponsor list (major event)
 */
const largeSponsorList = [
  { ...platinumSponsor, name: 'Platinum Corp Alpha' },
  { ...platinumSponsor, name: 'Platinum Corp Beta' },
  { ...goldSponsor, name: 'Gold Industries One' },
  { ...goldSponsor, name: 'Gold Industries Two' },
  { ...goldSponsor, name: 'Gold Industries Three' },
  { ...silverSponsor, name: 'Silver Solutions A' },
  { ...silverSponsor, name: 'Silver Solutions B' },
  { ...silverSponsor, name: 'Silver Solutions C' },
  { ...silverSponsor, name: 'Silver Solutions D' },
  { ...silverSponsor, name: 'Silver Solutions E' }
];

/**
 * Sponsor with analytics data (After Event phase)
 */
const sponsorWithAnalytics = {
  ...platinumSponsor,
  analytics: {
    impressions: 1000,
    clicks: 50,
    ctr: 0.05,
    dwellSec: 5000,
    surfaces: {
      display: { impressions: 500, clicks: 25, dwellSec: 2500 },
      public: { impressions: 300, clicks: 15, dwellSec: 1500 },
      poster: { impressions: 200, clicks: 10, dwellSec: 1000 }
    }
  }
};

/**
 * Legacy sponsor using single placement (for backward compatibility tests)
 */
const legacySponsor = {
  id: 'sp-legacy-corp',
  name: 'Legacy Corp',
  logoUrl: 'https://via.placeholder.com/300x100/888888/000000?text=Legacy+Corp',
  linkUrl: 'https://legacy-corp.example.com',
  placement: 'display' // Legacy single placement
};

/**
 * Invalid sponsor fixtures (for validation testing against contract)
 */
const invalidSponsors = {
  // Missing required field: id
  missingId: {
    name: 'No ID Sponsor',
    logoUrl: 'https://via.placeholder.com/300x100',
    placements: { posterTop: true }
  },
  // Missing required field: name
  missingName: {
    id: 'sp-no-name',
    logoUrl: 'https://via.placeholder.com/300x100',
    placements: { posterTop: true }
  },
  // Missing required field: logoUrl
  missingLogoUrl: {
    id: 'sp-no-logo',
    name: 'No Logo Sponsor',
    placements: { posterTop: true }
  },
  // Missing placement/placements (neither provided)
  missingPlacements: {
    id: 'sp-no-placements',
    name: 'No Placements Sponsor',
    logoUrl: 'https://via.placeholder.com/300x100'
  },
  // Invalid id pattern
  invalidIdPattern: {
    id: 'sp invalid id!', // Contains spaces and special chars
    name: 'Bad ID Sponsor',
    logoUrl: 'https://via.placeholder.com/300x100',
    placements: { posterTop: true }
  },
  // Invalid logoUrl
  invalidLogoUrl: {
    id: 'sp-bad-logo',
    name: 'Bad Logo Sponsor',
    logoUrl: 'not-a-valid-url',
    placements: { posterTop: true }
  },
  // Invalid placement value (legacy)
  invalidPlacement: {
    id: 'sp-bad-placement',
    name: 'Bad Placement Sponsor',
    logoUrl: 'https://via.placeholder.com/300x100',
    placement: 'invalid-placement'
  },
  // Invalid placements keys
  invalidPlacementKeys: {
    id: 'sp-bad-placement-keys',
    name: 'Bad Placement Keys Sponsor',
    logoUrl: 'https://via.placeholder.com/300x100',
    placements: { invalidKey: true }
  },
  // All placements false
  allPlacementsFalse: {
    id: 'sp-all-false',
    name: 'All False Sponsor',
    logoUrl: 'https://via.placeholder.com/300x100',
    placements: { posterTop: false, tvTop: false, tvSide: false, mobileBanner: false }
  },
  // Invalid tier
  invalidTier: {
    id: 'sp-bad-tier',
    name: 'Invalid Tier Sponsor',
    logoUrl: 'https://via.placeholder.com/300x100',
    placements: { posterTop: true },
    tier: 'diamond' // Not a valid tier
  },
  // Null object
  nullSponsor: null,
  // Empty object
  emptySponsor: {}
};

module.exports = {
  // Contract constants
  VALID_PLACEMENT_KEYS,

  // Tier definitions
  sponsorTiers,

  // Individual sponsors (contract-compliant)
  platinumSponsor,
  goldSponsor,
  silverSponsor,

  // Legacy sponsor (backward compatibility)
  legacySponsor,

  // Sponsor configurations
  multiTierSponsors,
  singleSponsor,
  largeSponsorList,

  // With analytics
  sponsorWithAnalytics,

  // Invalid data (for contract validation testing)
  invalidSponsors
};
