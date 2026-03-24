/**
 * Newman/Postman Environment Fixtures
 *
 * DRY fixtures for API testing with Newman
 * Centralizes environment variables, test data, and request builders
 *
 * Usage in Postman Tests:
 * const eventData = pm.collectionVariables.get('basicEvent');
 * pm.sendRequest(createEventRequest(eventData));
 */

const { getBaseUrl } = require('../../config/environments');

const BASE_URL = getBaseUrl();

/**
 * Environment Configuration
 */
const environments = {
  local: {
    baseUrl: 'http://localhost:8080',
    timeout: 5000,
    retries: 3
  },
  development: {
    baseUrl: process.env.DEV_URL || BASE_URL,
    timeout: 10000,
    retries: 2
  },
  staging: {
    baseUrl: process.env.STAGING_URL || BASE_URL,
    timeout: 15000,
    retries: 2
  },
  production: {
    baseUrl: process.env.PROD_URL || BASE_URL,
    timeout: 20000,
    retries: 1
  }
};

/**
 * Brand Configuration
 */
const brands = {
  root: {
    brandId: 'root',
    adminKey: process.env.ROOT_ADMIN_KEY || 'root-admin-key',
    description: 'Root brand for system administration'
  },
  abc: {
    brandId: 'abc',
    adminKey: process.env.ABC_ADMIN_KEY || 'abc-admin-key',
    description: 'ABC Corporation brand'
  },
  cbc: {
    brandId: 'cbc',
    adminKey: process.env.CBC_ADMIN_KEY || 'cbc-admin-key',
    description: 'CBC Organization brand'
  },
  cbl: {
    brandId: 'cbl',
    adminKey: process.env.CBL_ADMIN_KEY || 'cbl-admin-key',
    description: 'CBL Company brand'
  }
};

/**
 * API Request Builders
 */

/**
 * Build API status request
 */
const createStatusRequest = (env = 'development') => ({
  method: 'GET',
  url: `${environments[env].baseUrl}?action=status`,
  header: {
    'Content-Type': 'application/json'
  }
});

/**
 * Build event list request
 */
const createListRequest = (env = 'development', params = {}) => {
  const queryParams = new URLSearchParams({
    action: 'list',
    ...params
  });

  return {
    method: 'GET',
    url: `${environments[env].baseUrl}?${queryParams}`,
    header: {
      'Content-Type': 'application/json'
    }
  };
};

/**
 * Build get event request
 */
const createGetRequest = (eventId, env = 'development') => ({
  method: 'GET',
  url: `${environments[env].baseUrl}?action=get&id=${eventId}`,
  header: {
    'Content-Type': 'application/json'
  }
});

/**
 * Build create event request
 */
const createEventRequest = (eventData, brand = 'root', env = 'development') => ({
  method: 'POST',
  url: `${environments[env].baseUrl}?action=create`,
  header: {
    'Content-Type': 'application/json'
  },
  body: {
    mode: 'raw',
    raw: JSON.stringify({
      adminKey: brands[brand].adminKey,
      brandId: brands[brand].brandId,
      ...eventData
    })
  }
});

/**
 * Build update event request
 */
const createUpdateRequest = (eventId, updateData, brand = 'root', env = 'development') => ({
  method: 'POST',
  url: `${environments[env].baseUrl}?action=updateEventData`,
  header: {
    'Content-Type': 'application/json'
  },
  body: {
    mode: 'raw',
    raw: JSON.stringify({
      adminKey: brands[brand].adminKey,
      brandId: brands[brand].brandId,
      id: eventId,
      ...updateData
    })
  }
});

/**
 * Build log analytics request
 */
const createLogEventsRequest = (events, brand = 'root', env = 'development') => ({
  method: 'POST',
  url: `${environments[env].baseUrl}?action=logEvents`,
  header: {
    'Content-Type': 'application/json'
  },
  body: {
    mode: 'raw',
    raw: JSON.stringify({
      adminKey: brands[brand].adminKey,
      brandId: brands[brand].brandId,
      events
    })
  }
});

/**
 * Build get report request
 */
const createGetReportRequest = (eventId, params = {}, brand = 'root', env = 'development') => {
  const queryParams = new URLSearchParams({
    action: 'getReport',
    id: eventId,
    ...params
  });

  return {
    method: 'GET',
    url: `${environments[env].baseUrl}?${queryParams}`,
    header: {
      'Content-Type': 'application/json',
      'X-Admin-Key': brands[brand].adminKey
    }
  };
};

/**
 * Build create shortlink request
 */
const createShortlinkRequest = (targetUrl, brand = 'root', env = 'development') => ({
  method: 'POST',
  url: `${environments[env].baseUrl}?action=createShortlink`,
  header: {
    'Content-Type': 'application/json'
  },
  body: {
    mode: 'raw',
    raw: JSON.stringify({
      adminKey: brands[brand].adminKey,
      brandId: brands[brand].brandId,
      targetUrl
    })
  }
});

/**
 * Build generate JWT token request
 */
const createGenerateTokenRequest = (brand = 'root', env = 'development') => ({
  method: 'POST',
  url: `${environments[env].baseUrl}?action=generateToken`,
  header: {
    'Content-Type': 'application/json'
  },
  body: {
    mode: 'raw',
    raw: JSON.stringify({
      adminKey: brands[brand].adminKey,
      brandId: brands[brand].brandId
    })
  }
});

/**
 * Test Data Fixtures
 */

/**
 * Basic event data for testing
 */
const basicEventData = {
  name: 'Test Event {{$timestamp}}',
  dateISO: '2025-12-15',
  location: 'Test Venue',
  description: 'Automated test event'
};

/**
 * Complete event data for testing
 */
const completeEventData = {
  name: 'Complete Test Event {{$timestamp}}',
  dateISO: '2025-12-20',
  timeStart: '18:00',
  timeEnd: '22:00',
  location: 'Complete Test Venue',
  address: '123 Test St, Test City, TC 12345',
  description: 'Complete automated test event',
  sponsors: [
    {
      name: 'Test Platinum Sponsor',
      tier: 'platinum',
      logo: 'https://via.placeholder.com/300x100/FFD700/000000?text=Platinum'
    },
    {
      name: 'Test Gold Sponsor',
      tier: 'gold',
      logo: 'https://via.placeholder.com/300x100/C0C0C0/000000?text=Gold'
    }
  ],
  displayMode: 'dynamic',
  displayUrls: [
    'https://www.youtube.com/embed/dQw4w9WgXcQ'
  ]
};

/**
 * Event with sponsors
 */
const sponsoredEventData = {
  name: 'Sponsored Event {{$timestamp}}',
  dateISO: '2025-12-25',
  location: 'Sponsored Venue',
  description: 'Event with multiple sponsors',
  sponsors: [
    {
      name: 'Platinum Corp',
      tier: 'platinum',
      logo: 'https://via.placeholder.com/300x100/FFD700/000000?text=Platinum',
      website: 'https://platinum-corp.example.com'
    },
    {
      name: 'Gold Industries',
      tier: 'gold',
      logo: 'https://via.placeholder.com/300x100/C0C0C0/000000?text=Gold',
      website: 'https://gold-industries.example.com'
    },
    {
      name: 'Silver Solutions',
      tier: 'silver',
      logo: 'https://via.placeholder.com/300x100/CD7F32/000000?text=Silver',
      website: 'https://silver-solutions.example.com'
    }
  ]
};

/**
 * Invalid event data for negative testing
 */
const invalidEventData = {
  missingName: {
    dateISO: '2025-12-15',
    location: 'Test Venue'
  },
  missingDate: {
    name: 'Event Without Date',
    location: 'Test Venue'
  },
  missingLocation: {
    name: 'Event Without Location',
    dateISO: '2025-12-15'
  },
  invalidDate: {
    name: 'Invalid Date Event',
    dateISO: 'not-a-date',
    location: 'Test Venue'
  }
};

/**
 * Analytics event data
 */
const analyticsEventData = [
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
    eventType: 'dwell',
    surface: 'display',
    sponsorId: 'platinum-corp',
    dwellSec: 15,
    timestamp: new Date().toISOString()
  }
];

/**
 * Postman Test Assertions
 * Reusable test scripts for Postman collections
 */
const postmanTests = {
  /**
   * Test for successful response envelope
   */
  assertSuccessEnvelope: `
pm.test("Response is success envelope", function() {
    const jsonData = pm.response.json();
    pm.expect(jsonData).to.have.property('ok', true);
    pm.expect(jsonData).to.have.property('value');
});
`,

  /**
   * Test for error response envelope
   */
  assertErrorEnvelope: `
pm.test("Response is error envelope", function() {
    const jsonData = pm.response.json();
    pm.expect(jsonData).to.have.property('ok', false);
    pm.expect(jsonData).to.have.property('code');
    pm.expect(jsonData).to.have.property('message');
});
`,

  /**
   * Test for response time
   */
  assertResponseTime: (maxTime = 2000) => `
pm.test("Response time is acceptable", function() {
    pm.expect(pm.response.responseTime).to.be.below(${maxTime});
});
`,

  /**
   * Test for status code
   */
  assertStatusCode: (code = 200) => `
pm.test("Status code is ${code}", function() {
    pm.response.to.have.status(${code});
});
`,

  /**
   * Test for event structure
   */
  assertEventStructure: `
pm.test("Event has valid structure", function() {
    const event = pm.response.json().value;
    pm.expect(event).to.have.property('id');
    pm.expect(event).to.have.property('brandId');
    pm.expect(event).to.have.property('data');
    pm.expect(event).to.have.property('createdAt');
    pm.expect(event).to.have.property('slug');
});
`,

  /**
   * Test for event links
   */
  assertEventLinks: `
pm.test("Event has valid links", function() {
    const links = pm.response.json().value.links;
    pm.expect(links).to.have.property('publicUrl');
    pm.expect(links).to.have.property('posterUrl');
    pm.expect(links).to.have.property('displayUrl');

    pm.expect(links.publicUrl).to.match(/^https?:\\/\\//);
    pm.expect(links.posterUrl).to.match(/^https?:\\/\\//);
    pm.expect(links.displayUrl).to.match(/^https?:\\/\\//);
});
`,

  /**
   * Test for analytics structure
   */
  assertAnalyticsStructure: `
pm.test("Analytics has valid structure", function() {
    const analytics = pm.response.json().value;
    pm.expect(analytics).to.have.property('totals');
    pm.expect(analytics).to.have.property('bySurface');
    pm.expect(analytics).to.have.property('bySponsor');
    pm.expect(analytics).to.have.property('byToken');

    pm.expect(analytics.totals).to.have.property('impressions');
    pm.expect(analytics.totals).to.have.property('clicks');
    pm.expect(analytics.totals).to.have.property('dwellSec');
});
`,

  /**
   * Save event ID to collection variables
   */
  saveEventId: `
if (pm.response.json().ok) {
    const eventId = pm.response.json().value.id;
    pm.collectionVariables.set("eventId", eventId);
    console.log("Saved event ID:", eventId);
}
`,

  /**
   * Save token to collection variables
   */
  saveToken: `
if (pm.response.json().ok) {
    const token = pm.response.json().value.token;
    pm.collectionVariables.set("authToken", token);
    console.log("Saved auth token");
}
`
};

/**
 * Generate Postman environment file
 */
const generatePostmanEnvironment = (env = 'development', brand = 'root') => ({
  id: `${brand}-${env}`,
  name: `MVP Event Toolkit - ${brand} (${env})`,
  values: [
    {
      key: 'baseUrl',
      value: environments[env].baseUrl,
      enabled: true
    },
    {
      key: 'brandId',
      value: brands[brand].brandId,
      enabled: true
    },
    {
      key: 'adminKey',
      value: brands[brand].adminKey,
      enabled: true,
      type: 'secret'
    },
    {
      key: 'timeout',
      value: environments[env].timeout.toString(),
      enabled: true
    },
    {
      key: 'retries',
      value: environments[env].retries.toString(),
      enabled: true
    }
  ],
  _postman_variable_scope: 'environment',
  _postman_exported_at: new Date().toISOString(),
  _postman_exported_using: 'MVP Event Toolkit Newman Fixtures'
});

module.exports = {
  // Configurations
  environments,
  brands,

  // Request Builders
  createStatusRequest,
  createListRequest,
  createGetRequest,
  createEventRequest,
  createUpdateRequest,
  createLogEventsRequest,
  createGetReportRequest,
  createShortlinkRequest,
  createGenerateTokenRequest,

  // Test Data
  basicEventData,
  completeEventData,
  sponsoredEventData,
  invalidEventData,
  analyticsEventData,

  // Postman Test Scripts
  postmanTests,

  // Environment Generator
  generatePostmanEnvironment
};
