/**
 * NCR Coverage — Northeast Region
 * Census divisions: New England (CT ME MA NH RI VT) + Mid-Atlantic (NJ NY PA)
 *
 * 2 territories, 9 states
 * ~21 Level 4 metros (100k+), ~70+ Level 3 zones (25k-100k)
 *
 * @module config/ncr-regions/northeast
 */

const territories = Object.freeze([
  { id: 'territory-new-england', name: 'New England', level: 6 },
  { id: 'territory-mid-atlantic', name: 'Mid-Atlantic', level: 6 },
]);

const states = Object.freeze([
  { id: 'state-ct', name: 'Connecticut', state: 'CT', level: 5, territory: 'territory-new-england' },
  { id: 'state-me', name: 'Maine', state: 'ME', level: 5, territory: 'territory-new-england' },
  { id: 'state-ma', name: 'Massachusetts', state: 'MA', level: 5, territory: 'territory-new-england' },
  { id: 'state-nh', name: 'New Hampshire', state: 'NH', level: 5, territory: 'territory-new-england' },
  { id: 'state-ri', name: 'Rhode Island', state: 'RI', level: 5, territory: 'territory-new-england' },
  { id: 'state-vt', name: 'Vermont', state: 'VT', level: 5, territory: 'territory-new-england' },
  { id: 'state-nj', name: 'New Jersey', state: 'NJ', level: 5, territory: 'territory-mid-atlantic' },
  { id: 'state-ny', name: 'New York', state: 'NY', level: 5, territory: 'territory-mid-atlantic' },
  { id: 'state-pa', name: 'Pennsylvania', state: 'PA', level: 5, territory: 'territory-mid-atlantic' },
]);

const nodes = Object.freeze([
  // ─── CONNECTICUT ────────────────────────────────────────────
  // Level 4: Cities 100k+
  { id: 'node-ct-bridgeport', name: 'Bridgeport', state: 'CT', level: 4, lat: 41.1865, lng: -73.1952 },
  { id: 'node-ct-new-haven', name: 'New Haven', state: 'CT', level: 4, lat: 41.3083, lng: -72.9279 },
  { id: 'node-ct-stamford', name: 'Stamford', state: 'CT', level: 4, lat: 41.0534, lng: -73.5387 },
  { id: 'node-ct-hartford', name: 'Hartford', state: 'CT', level: 4, lat: 41.7658, lng: -72.6734 },
  { id: 'node-ct-waterbury', name: 'Waterbury', state: 'CT', level: 4, lat: 41.5582, lng: -73.0515 },
  // Level 3: Key cities 25k-100k
  { id: 'node-ct-norwalk', name: 'Norwalk', state: 'CT', level: 3, lat: 41.1176, lng: -73.4082 },
  { id: 'node-ct-danbury', name: 'Danbury', state: 'CT', level: 3, lat: 41.3948, lng: -73.4540 },
  { id: 'node-ct-new-britain', name: 'New Britain', state: 'CT', level: 3, lat: 41.6612, lng: -72.7795 },
  { id: 'node-ct-west-hartford', name: 'West Hartford', state: 'CT', level: 3, lat: 41.7620, lng: -72.7420 },
  { id: 'node-ct-middletown', name: 'Middletown', state: 'CT', level: 3, lat: 41.5623, lng: -72.6506 },
  { id: 'node-ct-storrs', name: 'Storrs', state: 'CT', level: 3, lat: 41.8084, lng: -72.2495 },
  { id: 'node-ct-new-london', name: 'New London', state: 'CT', level: 3, lat: 41.3557, lng: -72.0995 },

  // ─── MAINE ──────────────────────────────────────────────────
  // No cities 100k+ in Maine
  // Level 3: Key cities
  { id: 'node-me-portland', name: 'Portland', state: 'ME', level: 3, lat: 43.6591, lng: -70.2568 },
  { id: 'node-me-lewiston', name: 'Lewiston', state: 'ME', level: 3, lat: 44.1004, lng: -70.2148 },
  { id: 'node-me-bangor', name: 'Bangor', state: 'ME', level: 3, lat: 44.8016, lng: -68.7712 },
  { id: 'node-me-south-portland', name: 'South Portland', state: 'ME', level: 3, lat: 43.6415, lng: -70.2409 },
  { id: 'node-me-auburn', name: 'Auburn', state: 'ME', level: 3, lat: 44.0979, lng: -70.2312 },
  { id: 'node-me-augusta', name: 'Augusta', state: 'ME', level: 3, lat: 44.3106, lng: -69.7795 },
  { id: 'node-me-biddeford', name: 'Biddeford', state: 'ME', level: 3, lat: 43.4926, lng: -70.4512 },
  { id: 'node-me-orono', name: 'Orono', state: 'ME', level: 3, lat: 44.8984, lng: -68.6718 },
  { id: 'node-me-brunswick', name: 'Brunswick', state: 'ME', level: 3, lat: 43.9145, lng: -69.9653 },

  // ─── MASSACHUSETTS ──────────────────────────────────────────
  // Level 4: Cities 100k+
  { id: 'node-ma-boston', name: 'Boston', state: 'MA', level: 4, lat: 42.3601, lng: -71.0589 },
  { id: 'node-ma-worcester', name: 'Worcester', state: 'MA', level: 4, lat: 42.2626, lng: -71.8023 },
  { id: 'node-ma-springfield', name: 'Springfield', state: 'MA', level: 4, lat: 42.1015, lng: -72.5898 },
  { id: 'node-ma-cambridge', name: 'Cambridge', state: 'MA', level: 4, lat: 42.3736, lng: -71.1097 },
  { id: 'node-ma-lowell', name: 'Lowell', state: 'MA', level: 4, lat: 42.6334, lng: -71.3162 },
  { id: 'node-ma-new-bedford', name: 'New Bedford', state: 'MA', level: 4, lat: 41.6362, lng: -70.9342 },
  // Level 3: Key cities 25k-100k
  { id: 'node-ma-brockton', name: 'Brockton', state: 'MA', level: 3, lat: 42.0834, lng: -71.0184 },
  { id: 'node-ma-quincy', name: 'Quincy', state: 'MA', level: 3, lat: 42.2529, lng: -71.0023 },
  { id: 'node-ma-fall-river', name: 'Fall River', state: 'MA', level: 3, lat: 41.7015, lng: -71.1550 },
  { id: 'node-ma-newton', name: 'Newton', state: 'MA', level: 3, lat: 42.3370, lng: -71.2092 },
  { id: 'node-ma-somerville', name: 'Somerville', state: 'MA', level: 3, lat: 42.3876, lng: -71.0995 },
  { id: 'node-ma-amherst', name: 'Amherst', state: 'MA', level: 3, lat: 42.3732, lng: -72.5199 },
  { id: 'node-ma-pittsfield', name: 'Pittsfield', state: 'MA', level: 3, lat: 42.4501, lng: -73.2453 },
  { id: 'node-ma-northampton', name: 'Northampton', state: 'MA', level: 3, lat: 42.3251, lng: -72.6412 },
  { id: 'node-ma-barnstable', name: 'Barnstable', state: 'MA', level: 3, lat: 41.7003, lng: -70.3002 },
  { id: 'node-ma-plymouth', name: 'Plymouth', state: 'MA', level: 3, lat: 41.9584, lng: -70.6673 },

  // ─── NEW HAMPSHIRE ──────────────────────────────────────────
  // Level 4: Cities 100k+
  { id: 'node-nh-manchester', name: 'Manchester', state: 'NH', level: 4, lat: 42.9956, lng: -71.4548 },
  // Level 3: Key cities 25k-100k
  { id: 'node-nh-nashua', name: 'Nashua', state: 'NH', level: 3, lat: 42.7654, lng: -71.4676 },
  { id: 'node-nh-concord', name: 'Concord', state: 'NH', level: 3, lat: 43.2081, lng: -71.5376 },
  { id: 'node-nh-dover', name: 'Dover', state: 'NH', level: 3, lat: 43.1979, lng: -70.8737 },
  { id: 'node-nh-rochester', name: 'Rochester', state: 'NH', level: 3, lat: 43.3045, lng: -70.9756 },
  { id: 'node-nh-keene', name: 'Keene', state: 'NH', level: 3, lat: 42.9337, lng: -72.2782 },
  { id: 'node-nh-durham', name: 'Durham', state: 'NH', level: 3, lat: 43.1339, lng: -70.9264 },
  { id: 'node-nh-hanover', name: 'Hanover', state: 'NH', level: 3, lat: 43.7022, lng: -72.2896 },
  { id: 'node-nh-lebanon', name: 'Lebanon', state: 'NH', level: 3, lat: 43.6423, lng: -72.2518 },

  // ─── RHODE ISLAND ───────────────────────────────────────────
  // Level 4: Cities 100k+
  { id: 'node-ri-providence', name: 'Providence', state: 'RI', level: 4, lat: 41.8240, lng: -71.4128 },
  // Level 3: Key cities 25k-100k
  { id: 'node-ri-warwick', name: 'Warwick', state: 'RI', level: 3, lat: 41.7001, lng: -71.4162 },
  { id: 'node-ri-cranston', name: 'Cranston', state: 'RI', level: 3, lat: 41.7798, lng: -71.4373 },
  { id: 'node-ri-pawtucket', name: 'Pawtucket', state: 'RI', level: 3, lat: 41.8787, lng: -71.3826 },
  { id: 'node-ri-east-providence', name: 'East Providence', state: 'RI', level: 3, lat: 41.8137, lng: -71.3701 },
  { id: 'node-ri-woonsocket', name: 'Woonsocket', state: 'RI', level: 3, lat: 42.0029, lng: -71.5145 },
  { id: 'node-ri-newport', name: 'Newport', state: 'RI', level: 3, lat: 41.4901, lng: -71.3128 },
  { id: 'node-ri-kingston', name: 'Kingston', state: 'RI', level: 3, lat: 41.4804, lng: -71.5225 },

  // ─── VERMONT ────────────────────────────────────────────────
  // No cities 100k+ in Vermont
  // Level 3: Key cities
  { id: 'node-vt-burlington', name: 'Burlington', state: 'VT', level: 3, lat: 44.4759, lng: -73.2121 },
  { id: 'node-vt-south-burlington', name: 'South Burlington', state: 'VT', level: 3, lat: 44.4669, lng: -73.1710 },
  { id: 'node-vt-rutland', name: 'Rutland', state: 'VT', level: 3, lat: 43.6106, lng: -72.9726 },
  { id: 'node-vt-montpelier', name: 'Montpelier', state: 'VT', level: 3, lat: 44.2601, lng: -72.5754 },
  { id: 'node-vt-barre', name: 'Barre', state: 'VT', level: 3, lat: 44.1970, lng: -72.5020 },
  { id: 'node-vt-brattleboro', name: 'Brattleboro', state: 'VT', level: 3, lat: 42.8509, lng: -72.5579 },
  { id: 'node-vt-middlebury', name: 'Middlebury', state: 'VT', level: 3, lat: 44.0153, lng: -73.1673 },
  { id: 'node-vt-st-johnsbury', name: 'St. Johnsbury', state: 'VT', level: 3, lat: 44.4189, lng: -72.0151 },
  { id: 'node-vt-bennington', name: 'Bennington', state: 'VT', level: 3, lat: 42.8782, lng: -73.1968 },

  // ─── NEW JERSEY ─────────────────────────────────────────────
  // Level 4: Cities 100k+
  { id: 'node-nj-newark', name: 'Newark', state: 'NJ', level: 4, lat: 40.7357, lng: -74.1724 },
  { id: 'node-nj-jersey-city', name: 'Jersey City', state: 'NJ', level: 4, lat: 40.7178, lng: -74.0431 },
  { id: 'node-nj-paterson', name: 'Paterson', state: 'NJ', level: 4, lat: 40.9168, lng: -74.1718 },
  { id: 'node-nj-elizabeth', name: 'Elizabeth', state: 'NJ', level: 4, lat: 40.6640, lng: -74.2107 },
  { id: 'node-nj-clifton', name: 'Clifton', state: 'NJ', level: 4, lat: 40.8584, lng: -74.1638 },
  { id: 'node-nj-trenton', name: 'Trenton', state: 'NJ', level: 4, lat: 40.2171, lng: -74.7429 },
  // Level 3: Key cities 25k-100k
  { id: 'node-nj-camden', name: 'Camden', state: 'NJ', level: 3, lat: 39.9259, lng: -75.1196 },
  { id: 'node-nj-new-brunswick', name: 'New Brunswick', state: 'NJ', level: 3, lat: 40.4862, lng: -74.4518 },
  { id: 'node-nj-atlantic-city', name: 'Atlantic City', state: 'NJ', level: 3, lat: 39.3643, lng: -74.4229 },
  { id: 'node-nj-hoboken', name: 'Hoboken', state: 'NJ', level: 3, lat: 40.7440, lng: -74.0324 },
  { id: 'node-nj-princeton', name: 'Princeton', state: 'NJ', level: 3, lat: 40.3573, lng: -74.6672 },
  { id: 'node-nj-morristown', name: 'Morristown', state: 'NJ', level: 3, lat: 40.7968, lng: -74.4815 },
  { id: 'node-nj-hackensack', name: 'Hackensack', state: 'NJ', level: 3, lat: 40.8859, lng: -74.0435 },
  { id: 'node-nj-toms-river', name: 'Toms River', state: 'NJ', level: 3, lat: 39.9537, lng: -74.1979 },
  { id: 'node-nj-cherry-hill', name: 'Cherry Hill', state: 'NJ', level: 3, lat: 39.9348, lng: -75.0307 },
  { id: 'node-nj-somerville', name: 'Somerville', state: 'NJ', level: 3, lat: 40.5743, lng: -74.6099 },

  // ─── NEW YORK ───────────────────────────────────────────────
  // Level 4: Cities 100k+
  { id: 'node-ny-new-york', name: 'New York City', state: 'NY', level: 4, lat: 40.7128, lng: -74.0060 },
  { id: 'node-ny-buffalo', name: 'Buffalo', state: 'NY', level: 4, lat: 42.8864, lng: -78.8784 },
  { id: 'node-ny-rochester', name: 'Rochester', state: 'NY', level: 4, lat: 43.1566, lng: -77.6088 },
  { id: 'node-ny-yonkers', name: 'Yonkers', state: 'NY', level: 4, lat: 40.9312, lng: -73.8987 },
  { id: 'node-ny-syracuse', name: 'Syracuse', state: 'NY', level: 4, lat: 43.0481, lng: -76.1474 },
  { id: 'node-ny-albany', name: 'Albany', state: 'NY', level: 4, lat: 42.6526, lng: -73.7562 },
  // Level 3: Key cities 25k-100k
  { id: 'node-ny-new-rochelle', name: 'New Rochelle', state: 'NY', level: 3, lat: 40.9115, lng: -73.7824 },
  { id: 'node-ny-schenectady', name: 'Schenectady', state: 'NY', level: 3, lat: 42.8142, lng: -73.9396 },
  { id: 'node-ny-utica', name: 'Utica', state: 'NY', level: 3, lat: 43.1009, lng: -75.2327 },
  { id: 'node-ny-binghamton', name: 'Binghamton', state: 'NY', level: 3, lat: 42.0987, lng: -75.9180 },
  { id: 'node-ny-ithaca', name: 'Ithaca', state: 'NY', level: 3, lat: 42.4440, lng: -76.5019 },
  { id: 'node-ny-white-plains', name: 'White Plains', state: 'NY', level: 3, lat: 41.0340, lng: -73.7629 },
  { id: 'node-ny-troy', name: 'Troy', state: 'NY', level: 3, lat: 42.7284, lng: -73.6918 },
  { id: 'node-ny-niagara-falls', name: 'Niagara Falls', state: 'NY', level: 3, lat: 43.0962, lng: -79.0377 },
  { id: 'node-ny-saratoga-springs', name: 'Saratoga Springs', state: 'NY', level: 3, lat: 43.0831, lng: -73.7846 },
  { id: 'node-ny-poughkeepsie', name: 'Poughkeepsie', state: 'NY', level: 3, lat: 41.7004, lng: -73.9209 },

  // ─── PENNSYLVANIA ───────────────────────────────────────────
  // Level 4: Cities 100k+
  { id: 'node-pa-philadelphia', name: 'Philadelphia', state: 'PA', level: 4, lat: 39.9526, lng: -75.1652 },
  { id: 'node-pa-pittsburgh', name: 'Pittsburgh', state: 'PA', level: 4, lat: 40.4406, lng: -79.9959 },
  { id: 'node-pa-allentown', name: 'Allentown', state: 'PA', level: 4, lat: 40.6084, lng: -75.4902 },
  { id: 'node-pa-reading', name: 'Reading', state: 'PA', level: 4, lat: 40.3357, lng: -75.9269 },
  { id: 'node-pa-erie', name: 'Erie', state: 'PA', level: 4, lat: 42.1292, lng: -80.0851 },
  // Level 3: Key cities 25k-100k
  { id: 'node-pa-scranton', name: 'Scranton', state: 'PA', level: 3, lat: 41.4090, lng: -75.6624 },
  { id: 'node-pa-bethlehem', name: 'Bethlehem', state: 'PA', level: 3, lat: 40.6259, lng: -75.3705 },
  { id: 'node-pa-lancaster', name: 'Lancaster', state: 'PA', level: 3, lat: 40.0379, lng: -76.3055 },
  { id: 'node-pa-harrisburg', name: 'Harrisburg', state: 'PA', level: 3, lat: 40.2732, lng: -76.8867 },
  { id: 'node-pa-york', name: 'York', state: 'PA', level: 3, lat: 39.9626, lng: -76.7277 },
  { id: 'node-pa-wilkes-barre', name: 'Wilkes-Barre', state: 'PA', level: 3, lat: 41.2459, lng: -75.8813 },
  { id: 'node-pa-state-college', name: 'State College', state: 'PA', level: 3, lat: 40.7934, lng: -77.8600 },
  { id: 'node-pa-norristown', name: 'Norristown', state: 'PA', level: 3, lat: 40.1218, lng: -75.3399 },
  { id: 'node-pa-west-chester', name: 'West Chester', state: 'PA', level: 3, lat: 39.9607, lng: -75.6055 },
  { id: 'node-pa-easton', name: 'Easton', state: 'PA', level: 3, lat: 40.6910, lng: -75.2210 },
]);

module.exports = { territories, states, nodes };
