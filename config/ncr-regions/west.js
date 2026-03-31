/**
 * NCR Coverage — West Region
 * Mountain + Pacific (CA cities in west-ca.js, assembled here)
 * AZ, CO, ID, MT, NV, NM, UT, WY, AK, CA, HI, OR, WA
 *
 * Level 4 = pop 100k+, Level 3 = max 4 per state
 *
 * @module config/ncr-regions/west
 */

const territories = Object.freeze([
  { id: 'territory-mountain', name: 'Mountain', level: 6 },
  { id: 'territory-pacific', name: 'Pacific', level: 6 },
]);

const states = Object.freeze([
  { id: 'state-az', name: 'Arizona', state: 'AZ', level: 5, territory: 'territory-mountain' },
  { id: 'state-co', name: 'Colorado', state: 'CO', level: 5, territory: 'territory-mountain' },
  { id: 'state-id', name: 'Idaho', state: 'ID', level: 5, territory: 'territory-mountain' },
  { id: 'state-mt', name: 'Montana', state: 'MT', level: 5, territory: 'territory-mountain' },
  { id: 'state-nv', name: 'Nevada', state: 'NV', level: 5, territory: 'territory-mountain' },
  { id: 'state-nm', name: 'New Mexico', state: 'NM', level: 5, territory: 'territory-mountain' },
  { id: 'state-ut', name: 'Utah', state: 'UT', level: 5, territory: 'territory-mountain' },
  { id: 'state-wy', name: 'Wyoming', state: 'WY', level: 5, territory: 'territory-mountain' },
  { id: 'state-ak', name: 'Alaska', state: 'AK', level: 5, territory: 'territory-pacific' },
  { id: 'state-ca', name: 'California', state: 'CA', level: 5, territory: 'territory-pacific' },
  { id: 'state-hi', name: 'Hawaii', state: 'HI', level: 5, territory: 'territory-pacific' },
  { id: 'state-or', name: 'Oregon', state: 'OR', level: 5, territory: 'territory-pacific' },
  { id: 'state-wa', name: 'Washington', state: 'WA', level: 5, territory: 'territory-pacific' },
]);

const nodes = Object.freeze([
  // ─── ARIZONA ────────────────────────────────────────────────
  // Level 4
  { id: 'node-az-phoenix', name: 'Phoenix', state: 'AZ', level: 4, lat: 33.45, lng: -112.07 },
  { id: 'node-az-tucson', name: 'Tucson', state: 'AZ', level: 4, lat: 32.22, lng: -110.97 },
  { id: 'node-az-mesa', name: 'Mesa', state: 'AZ', level: 4, lat: 33.42, lng: -111.83 },
  { id: 'node-az-chandler', name: 'Chandler', state: 'AZ', level: 4, lat: 33.31, lng: -111.84 },
  { id: 'node-az-gilbert', name: 'Gilbert', state: 'AZ', level: 4, lat: 33.35, lng: -111.79 },
  { id: 'node-az-glendale', name: 'Glendale', state: 'AZ', level: 4, lat: 33.54, lng: -112.19 },
  { id: 'node-az-scottsdale', name: 'Scottsdale', state: 'AZ', level: 4, lat: 33.49, lng: -111.93 },
  { id: 'node-az-peoria', name: 'Peoria', state: 'AZ', level: 4, lat: 33.58, lng: -112.24 },
  { id: 'node-az-tempe', name: 'Tempe', state: 'AZ', level: 4, lat: 33.43, lng: -111.94 },
  { id: 'node-az-surprise', name: 'Surprise', state: 'AZ', level: 4, lat: 33.63, lng: -112.37 },
  { id: 'node-az-goodyear', name: 'Goodyear', state: 'AZ', level: 4, lat: 33.44, lng: -112.36 },
  { id: 'node-az-avondale', name: 'Avondale', state: 'AZ', level: 4, lat: 33.44, lng: -112.35 },
  // Level 3
  { id: 'node-az-flagstaff', name: 'Flagstaff', state: 'AZ', level: 3, lat: 35.20, lng: -111.65 },
  { id: 'node-az-yuma', name: 'Yuma', state: 'AZ', level: 3, lat: 32.69, lng: -114.63 },
  { id: 'node-az-prescott', name: 'Prescott', state: 'AZ', level: 3, lat: 34.54, lng: -112.47 },
  { id: 'node-az-lake-havasu-city', name: 'Lake Havasu City', state: 'AZ', level: 3, lat: 34.48, lng: -114.32 },

  // ─── COLORADO ───────────────────────────────────────────────
  // Level 4
  { id: 'node-co-denver', name: 'Denver', state: 'CO', level: 4, lat: 39.74, lng: -104.99 },
  { id: 'node-co-colorado-springs', name: 'Colorado Springs', state: 'CO', level: 4, lat: 38.83, lng: -104.82 },
  { id: 'node-co-aurora', name: 'Aurora', state: 'CO', level: 4, lat: 39.73, lng: -104.83 },
  { id: 'node-co-fort-collins', name: 'Fort Collins', state: 'CO', level: 4, lat: 40.59, lng: -105.08 },
  { id: 'node-co-lakewood', name: 'Lakewood', state: 'CO', level: 4, lat: 39.70, lng: -105.08 },
  { id: 'node-co-thornton', name: 'Thornton', state: 'CO', level: 4, lat: 39.87, lng: -104.97 },
  { id: 'node-co-arvada', name: 'Arvada', state: 'CO', level: 4, lat: 39.80, lng: -105.09 },
  { id: 'node-co-westminster', name: 'Westminster', state: 'CO', level: 4, lat: 39.84, lng: -105.04 },
  { id: 'node-co-pueblo', name: 'Pueblo', state: 'CO', level: 4, lat: 38.25, lng: -104.61 },
  { id: 'node-co-centennial', name: 'Centennial', state: 'CO', level: 4, lat: 39.58, lng: -104.88 },
  { id: 'node-co-boulder', name: 'Boulder', state: 'CO', level: 4, lat: 40.02, lng: -105.27 },
  { id: 'node-co-greeley', name: 'Greeley', state: 'CO', level: 4, lat: 40.42, lng: -104.71 },
  { id: 'node-co-longmont', name: 'Longmont', state: 'CO', level: 4, lat: 40.17, lng: -105.10 },
  { id: 'node-co-loveland', name: 'Loveland', state: 'CO', level: 4, lat: 40.40, lng: -105.08 },
  // Level 3
  { id: 'node-co-grand-junction', name: 'Grand Junction', state: 'CO', level: 3, lat: 39.06, lng: -108.55 },
  { id: 'node-co-durango', name: 'Durango', state: 'CO', level: 3, lat: 37.28, lng: -107.88 },
  { id: 'node-co-steamboat-springs', name: 'Steamboat Springs', state: 'CO', level: 3, lat: 40.49, lng: -106.83 },
  { id: 'node-co-aspen', name: 'Aspen', state: 'CO', level: 3, lat: 39.19, lng: -106.82 },

  // ─── IDAHO ──────────────────────────────────────────────────
  // Level 4
  { id: 'node-id-boise', name: 'Boise', state: 'ID', level: 4, lat: 43.62, lng: -116.20 },
  { id: 'node-id-meridian', name: 'Meridian', state: 'ID', level: 4, lat: 43.61, lng: -116.39 },
  { id: 'node-id-nampa', name: 'Nampa', state: 'ID', level: 4, lat: 43.54, lng: -116.56 },
  // Level 3
  { id: 'node-id-idaho-falls', name: 'Idaho Falls', state: 'ID', level: 3, lat: 43.49, lng: -112.03 },
  { id: 'node-id-pocatello', name: 'Pocatello', state: 'ID', level: 3, lat: 42.86, lng: -112.45 },
  { id: 'node-id-twin-falls', name: 'Twin Falls', state: 'ID', level: 3, lat: 42.56, lng: -114.46 },
  { id: 'node-id-coeur-d-alene', name: "Coeur d'Alene", state: 'ID', level: 3, lat: 47.68, lng: -116.78 },

  // ─── MONTANA ────────────────────────────────────────────────
  // Level 3 only
  { id: 'node-mt-billings', name: 'Billings', state: 'MT', level: 3, lat: 45.78, lng: -108.50 },
  { id: 'node-mt-missoula', name: 'Missoula', state: 'MT', level: 3, lat: 46.87, lng: -113.99 },
  { id: 'node-mt-great-falls', name: 'Great Falls', state: 'MT', level: 3, lat: 47.50, lng: -111.30 },
  { id: 'node-mt-bozeman', name: 'Bozeman', state: 'MT', level: 3, lat: 45.68, lng: -111.04 },

  // ─── NEVADA ─────────────────────────────────────────────────
  // Level 4
  { id: 'node-nv-las-vegas', name: 'Las Vegas', state: 'NV', level: 4, lat: 36.17, lng: -115.14 },
  { id: 'node-nv-henderson', name: 'Henderson', state: 'NV', level: 4, lat: 36.04, lng: -114.98 },
  { id: 'node-nv-reno', name: 'Reno', state: 'NV', level: 4, lat: 39.53, lng: -119.81 },
  { id: 'node-nv-north-las-vegas', name: 'North Las Vegas', state: 'NV', level: 4, lat: 36.20, lng: -115.12 },
  { id: 'node-nv-sparks', name: 'Sparks', state: 'NV', level: 4, lat: 39.53, lng: -119.75 },
  // Level 3
  { id: 'node-nv-carson-city', name: 'Carson City', state: 'NV', level: 3, lat: 39.16, lng: -119.77 },

  // ─── NEW MEXICO ─────────────────────────────────────────────
  // Level 4
  { id: 'node-nm-albuquerque', name: 'Albuquerque', state: 'NM', level: 4, lat: 35.08, lng: -106.65 },
  { id: 'node-nm-las-cruces', name: 'Las Cruces', state: 'NM', level: 4, lat: 32.32, lng: -106.76 },
  { id: 'node-nm-rio-rancho', name: 'Rio Rancho', state: 'NM', level: 4, lat: 35.23, lng: -106.66 },
  // Level 3
  { id: 'node-nm-santa-fe', name: 'Santa Fe', state: 'NM', level: 3, lat: 35.69, lng: -105.94 },
  { id: 'node-nm-roswell', name: 'Roswell', state: 'NM', level: 3, lat: 33.39, lng: -104.52 },
  { id: 'node-nm-farmington', name: 'Farmington', state: 'NM', level: 3, lat: 36.73, lng: -108.22 },
  { id: 'node-nm-taos', name: 'Taos', state: 'NM', level: 3, lat: 36.41, lng: -105.57 },

  // ─── UTAH ───────────────────────────────────────────────────
  // Level 4
  { id: 'node-ut-salt-lake-city', name: 'Salt Lake City', state: 'UT', level: 4, lat: 40.76, lng: -111.89 },
  { id: 'node-ut-west-valley-city', name: 'West Valley City', state: 'UT', level: 4, lat: 40.69, lng: -111.99 },
  { id: 'node-ut-west-jordan', name: 'West Jordan', state: 'UT', level: 4, lat: 40.61, lng: -111.94 },
  { id: 'node-ut-provo', name: 'Provo', state: 'UT', level: 4, lat: 40.23, lng: -111.66 },
  { id: 'node-ut-orem', name: 'Orem', state: 'UT', level: 4, lat: 40.30, lng: -111.69 },
  { id: 'node-ut-sandy', name: 'Sandy', state: 'UT', level: 4, lat: 40.56, lng: -111.86 },
  { id: 'node-ut-ogden', name: 'Ogden', state: 'UT', level: 4, lat: 41.22, lng: -111.97 },
  { id: 'node-ut-st-george', name: 'St George', state: 'UT', level: 4, lat: 37.10, lng: -113.57 },
  { id: 'node-ut-layton', name: 'Layton', state: 'UT', level: 4, lat: 41.06, lng: -111.97 },
  // Level 3
  { id: 'node-ut-logan', name: 'Logan', state: 'UT', level: 3, lat: 41.74, lng: -111.83 },
  { id: 'node-ut-park-city', name: 'Park City', state: 'UT', level: 3, lat: 40.65, lng: -111.50 },
  { id: 'node-ut-cedar-city', name: 'Cedar City', state: 'UT', level: 3, lat: 37.68, lng: -113.06 },
  { id: 'node-ut-moab', name: 'Moab', state: 'UT', level: 3, lat: 38.57, lng: -109.55 },

  // ─── WYOMING ────────────────────────────────────────────────
  // Level 3 only
  { id: 'node-wy-cheyenne', name: 'Cheyenne', state: 'WY', level: 3, lat: 41.14, lng: -104.82 },
  { id: 'node-wy-casper', name: 'Casper', state: 'WY', level: 3, lat: 42.87, lng: -106.31 },
  { id: 'node-wy-laramie', name: 'Laramie', state: 'WY', level: 3, lat: 41.31, lng: -105.59 },
  { id: 'node-wy-jackson', name: 'Jackson', state: 'WY', level: 3, lat: 43.48, lng: -110.76 },

  // ─── ALASKA ─────────────────────────────────────────────────
  // Level 3 only
  { id: 'node-ak-anchorage', name: 'Anchorage', state: 'AK', level: 3, lat: 61.22, lng: -149.90 },
  { id: 'node-ak-fairbanks', name: 'Fairbanks', state: 'AK', level: 3, lat: 64.84, lng: -147.72 },
  { id: 'node-ak-juneau', name: 'Juneau', state: 'AK', level: 3, lat: 58.30, lng: -134.42 },

  // ─── HAWAII ─────────────────────────────────────────────────
  // Level 3 only
  { id: 'node-hi-honolulu', name: 'Honolulu', state: 'HI', level: 3, lat: 21.31, lng: -157.86 },
  { id: 'node-hi-hilo', name: 'Hilo', state: 'HI', level: 3, lat: 19.72, lng: -155.09 },
  { id: 'node-hi-kailua', name: 'Kailua', state: 'HI', level: 3, lat: 21.40, lng: -157.74 },
  { id: 'node-hi-kahului', name: 'Kahului', state: 'HI', level: 3, lat: 20.89, lng: -156.47 },

  // ─── OREGON ─────────────────────────────────────────────────
  // Level 4
  { id: 'node-or-portland', name: 'Portland', state: 'OR', level: 4, lat: 45.52, lng: -122.68 },
  { id: 'node-or-salem', name: 'Salem', state: 'OR', level: 4, lat: 44.94, lng: -123.04 },
  { id: 'node-or-eugene', name: 'Eugene', state: 'OR', level: 4, lat: 44.05, lng: -123.09 },
  { id: 'node-or-gresham', name: 'Gresham', state: 'OR', level: 4, lat: 45.50, lng: -122.43 },
  { id: 'node-or-hillsboro', name: 'Hillsboro', state: 'OR', level: 4, lat: 45.52, lng: -122.99 },
  { id: 'node-or-beaverton', name: 'Beaverton', state: 'OR', level: 4, lat: 45.49, lng: -122.80 },
  { id: 'node-or-bend', name: 'Bend', state: 'OR', level: 4, lat: 44.06, lng: -121.32 },
  { id: 'node-or-medford', name: 'Medford', state: 'OR', level: 4, lat: 42.33, lng: -122.88 },
  // Level 3
  { id: 'node-or-corvallis', name: 'Corvallis', state: 'OR', level: 3, lat: 44.56, lng: -123.26 },
  { id: 'node-or-ashland', name: 'Ashland', state: 'OR', level: 3, lat: 42.19, lng: -122.71 },
  { id: 'node-or-astoria', name: 'Astoria', state: 'OR', level: 3, lat: 46.19, lng: -123.83 },
  { id: 'node-or-hood-river', name: 'Hood River', state: 'OR', level: 3, lat: 45.71, lng: -121.52 },

  // ─── WASHINGTON ─────────────────────────────────────────────
  // Level 4
  { id: 'node-wa-seattle', name: 'Seattle', state: 'WA', level: 4, lat: 47.61, lng: -122.33 },
  { id: 'node-wa-spokane', name: 'Spokane', state: 'WA', level: 4, lat: 47.66, lng: -117.43 },
  { id: 'node-wa-tacoma', name: 'Tacoma', state: 'WA', level: 4, lat: 47.25, lng: -122.44 },
  { id: 'node-wa-vancouver', name: 'Vancouver', state: 'WA', level: 4, lat: 45.64, lng: -122.66 },
  { id: 'node-wa-bellevue', name: 'Bellevue', state: 'WA', level: 4, lat: 47.61, lng: -122.20 },
  { id: 'node-wa-kent', name: 'Kent', state: 'WA', level: 4, lat: 47.38, lng: -122.23 },
  { id: 'node-wa-everett', name: 'Everett', state: 'WA', level: 4, lat: 47.98, lng: -122.20 },
  { id: 'node-wa-renton', name: 'Renton', state: 'WA', level: 4, lat: 47.48, lng: -122.22 },
  // Level 3
  { id: 'node-wa-olympia', name: 'Olympia', state: 'WA', level: 3, lat: 47.04, lng: -122.90 },
  { id: 'node-wa-bellingham', name: 'Bellingham', state: 'WA', level: 3, lat: 48.76, lng: -122.49 },
  { id: 'node-wa-yakima', name: 'Yakima', state: 'WA', level: 3, lat: 46.60, lng: -120.51 },
  { id: 'node-wa-walla-walla', name: 'Walla Walla', state: 'WA', level: 3, lat: 46.06, lng: -118.33 },
]);

// Assemble CA cities from separate file
const westCa = require('./west-ca');
const allNodes = Object.freeze([...nodes, ...westCa.nodes]);

module.exports = { territories, states, nodes: allNodes };
