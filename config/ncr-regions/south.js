/**
 * NCR Coverage — South Region
 * South Atlantic + East South Central + West South Central
 * DE, FL, GA, MD, NC, SC, VA, DC, WV, AL, KY, MS, TN, AR, LA, OK, TX
 *
 * 3 territories, 17 states + DC
 * Level 4 (100k+) and Level 3 (max 5 per state) only
 *
 * @module config/ncr-regions/south
 */

const territories = Object.freeze([
  { id: 'territory-south-atlantic', name: 'South Atlantic', level: 6 },
  { id: 'territory-east-south-central', name: 'East South Central', level: 6 },
  { id: 'territory-west-south-central', name: 'West South Central', level: 6 },
]);

const states = Object.freeze([
  {
    id: 'state-de',
    name: 'Delaware',
    state: 'DE',
    level: 5,
    territory: 'territory-south-atlantic',
  },
  { id: 'state-fl', name: 'Florida', state: 'FL', level: 5, territory: 'territory-south-atlantic' },
  { id: 'state-ga', name: 'Georgia', state: 'GA', level: 5, territory: 'territory-south-atlantic' },
  {
    id: 'state-md',
    name: 'Maryland',
    state: 'MD',
    level: 5,
    territory: 'territory-south-atlantic',
  },
  {
    id: 'state-nc',
    name: 'North Carolina',
    state: 'NC',
    level: 5,
    territory: 'territory-south-atlantic',
  },
  {
    id: 'state-sc',
    name: 'South Carolina',
    state: 'SC',
    level: 5,
    territory: 'territory-south-atlantic',
  },
  {
    id: 'state-va',
    name: 'Virginia',
    state: 'VA',
    level: 5,
    territory: 'territory-south-atlantic',
  },
  {
    id: 'state-dc',
    name: 'District of Columbia',
    state: 'DC',
    level: 5,
    territory: 'territory-south-atlantic',
  },
  {
    id: 'state-wv',
    name: 'West Virginia',
    state: 'WV',
    level: 5,
    territory: 'territory-south-atlantic',
  },
  {
    id: 'state-al',
    name: 'Alabama',
    state: 'AL',
    level: 5,
    territory: 'territory-east-south-central',
  },
  {
    id: 'state-ky',
    name: 'Kentucky',
    state: 'KY',
    level: 5,
    territory: 'territory-east-south-central',
  },
  {
    id: 'state-ms',
    name: 'Mississippi',
    state: 'MS',
    level: 5,
    territory: 'territory-east-south-central',
  },
  {
    id: 'state-tn',
    name: 'Tennessee',
    state: 'TN',
    level: 5,
    territory: 'territory-east-south-central',
  },
  {
    id: 'state-ar',
    name: 'Arkansas',
    state: 'AR',
    level: 5,
    territory: 'territory-west-south-central',
  },
  {
    id: 'state-la',
    name: 'Louisiana',
    state: 'LA',
    level: 5,
    territory: 'territory-west-south-central',
  },
  {
    id: 'state-ok',
    name: 'Oklahoma',
    state: 'OK',
    level: 5,
    territory: 'territory-west-south-central',
  },
  {
    id: 'state-tx',
    name: 'Texas',
    state: 'TX',
    level: 5,
    territory: 'territory-west-south-central',
  },
]);

const nodes = Object.freeze([
  // ─── DELAWARE ───────────────────────────────────────────────
  // No cities 100k+ in Delaware
  // Level 3
  {
    id: 'node-de-wilmington',
    name: 'Wilmington',
    state: 'DE',
    level: 3,
    lat: 39.7459,
    lng: -75.5466,
  },
  { id: 'node-de-dover', name: 'Dover', state: 'DE', level: 3, lat: 39.1582, lng: -75.5244 },
  { id: 'node-de-newark', name: 'Newark', state: 'DE', level: 3, lat: 39.6837, lng: -75.7497 },

  // ─── FLORIDA ────────────────────────────────────────────────
  // Level 4
  {
    id: 'node-fl-jacksonville',
    name: 'Jacksonville',
    state: 'FL',
    level: 4,
    lat: 30.3322,
    lng: -81.6557,
  },
  { id: 'node-fl-miami', name: 'Miami', state: 'FL', level: 4, lat: 25.7617, lng: -80.1918 },
  { id: 'node-fl-tampa', name: 'Tampa', state: 'FL', level: 4, lat: 27.9506, lng: -82.4572 },
  { id: 'node-fl-orlando', name: 'Orlando', state: 'FL', level: 4, lat: 28.5383, lng: -81.3792 },
  {
    id: 'node-fl-st-petersburg',
    name: 'St Petersburg',
    state: 'FL',
    level: 4,
    lat: 27.7676,
    lng: -82.6403,
  },
  { id: 'node-fl-hialeah', name: 'Hialeah', state: 'FL', level: 4, lat: 25.8576, lng: -80.2781 },
  {
    id: 'node-fl-port-st-lucie',
    name: 'Port St Lucie',
    state: 'FL',
    level: 4,
    lat: 27.273,
    lng: -80.3582,
  },
  {
    id: 'node-fl-cape-coral',
    name: 'Cape Coral',
    state: 'FL',
    level: 4,
    lat: 26.5629,
    lng: -81.9495,
  },
  {
    id: 'node-fl-tallahassee',
    name: 'Tallahassee',
    state: 'FL',
    level: 4,
    lat: 30.4383,
    lng: -84.2807,
  },
  {
    id: 'node-fl-fort-lauderdale',
    name: 'Fort Lauderdale',
    state: 'FL',
    level: 4,
    lat: 26.1224,
    lng: -80.1373,
  },
  {
    id: 'node-fl-pembroke-pines',
    name: 'Pembroke Pines',
    state: 'FL',
    level: 4,
    lat: 26.0128,
    lng: -80.3241,
  },
  {
    id: 'node-fl-hollywood',
    name: 'Hollywood',
    state: 'FL',
    level: 4,
    lat: 26.0112,
    lng: -80.1495,
  },
  {
    id: 'node-fl-gainesville',
    name: 'Gainesville',
    state: 'FL',
    level: 4,
    lat: 29.6516,
    lng: -82.3248,
  },
  {
    id: 'node-fl-coral-springs',
    name: 'Coral Springs',
    state: 'FL',
    level: 4,
    lat: 26.2712,
    lng: -80.2706,
  },
  { id: 'node-fl-lakeland', name: 'Lakeland', state: 'FL', level: 4, lat: 28.0395, lng: -81.9498 },
  {
    id: 'node-fl-clearwater',
    name: 'Clearwater',
    state: 'FL',
    level: 4,
    lat: 27.9659,
    lng: -82.8001,
  },
  { id: 'node-fl-palm-bay', name: 'Palm Bay', state: 'FL', level: 4, lat: 28.0345, lng: -80.5887 },
  {
    id: 'node-fl-pompano-beach',
    name: 'Pompano Beach',
    state: 'FL',
    level: 4,
    lat: 26.2379,
    lng: -80.1248,
  },
  { id: 'node-fl-miramar', name: 'Miramar', state: 'FL', level: 4, lat: 25.9773, lng: -80.3223 },
  // Level 3
  {
    id: 'node-fl-daytona-beach',
    name: 'Daytona Beach',
    state: 'FL',
    level: 3,
    lat: 29.2108,
    lng: -81.0228,
  },
  { id: 'node-fl-ocala', name: 'Ocala', state: 'FL', level: 3, lat: 29.1872, lng: -82.1401 },
  { id: 'node-fl-sarasota', name: 'Sarasota', state: 'FL', level: 3, lat: 27.3364, lng: -82.5307 },
  { id: 'node-fl-naples', name: 'Naples', state: 'FL', level: 3, lat: 26.142, lng: -81.7948 },
  { id: 'node-fl-key-west', name: 'Key West', state: 'FL', level: 3, lat: 24.5551, lng: -81.78 },

  // ─── GEORGIA ────────────────────────────────────────────────
  // Level 4
  { id: 'node-ga-atlanta', name: 'Atlanta', state: 'GA', level: 4, lat: 33.749, lng: -84.388 },
  { id: 'node-ga-augusta', name: 'Augusta', state: 'GA', level: 4, lat: 33.4735, lng: -81.9748 },
  { id: 'node-ga-columbus', name: 'Columbus', state: 'GA', level: 4, lat: 32.461, lng: -84.9877 },
  { id: 'node-ga-savannah', name: 'Savannah', state: 'GA', level: 4, lat: 32.0809, lng: -81.0912 },
  { id: 'node-ga-athens', name: 'Athens', state: 'GA', level: 4, lat: 33.9519, lng: -83.3576 },
  {
    id: 'node-ga-sandy-springs',
    name: 'Sandy Springs',
    state: 'GA',
    level: 4,
    lat: 33.9304,
    lng: -84.3733,
  },
  { id: 'node-ga-roswell', name: 'Roswell', state: 'GA', level: 4, lat: 34.0232, lng: -84.3616 },
  { id: 'node-ga-macon', name: 'Macon', state: 'GA', level: 4, lat: 32.8407, lng: -83.6324 },

  // ─── MARYLAND ───────────────────────────────────────────────
  // Level 4
  {
    id: 'node-md-baltimore',
    name: 'Baltimore',
    state: 'MD',
    level: 4,
    lat: 39.2904,
    lng: -76.6122,
  },

  // ─── NORTH CAROLINA ─────────────────────────────────────────
  // Level 4
  {
    id: 'node-nc-charlotte',
    name: 'Charlotte',
    state: 'NC',
    level: 4,
    lat: 35.2271,
    lng: -80.8431,
  },
  { id: 'node-nc-raleigh', name: 'Raleigh', state: 'NC', level: 4, lat: 35.7796, lng: -78.6382 },
  {
    id: 'node-nc-greensboro',
    name: 'Greensboro',
    state: 'NC',
    level: 4,
    lat: 36.0726,
    lng: -79.792,
  },
  { id: 'node-nc-durham', name: 'Durham', state: 'NC', level: 4, lat: 35.994, lng: -78.8986 },
  {
    id: 'node-nc-winston-salem',
    name: 'Winston-Salem',
    state: 'NC',
    level: 4,
    lat: 36.0999,
    lng: -80.2442,
  },
  {
    id: 'node-nc-fayetteville',
    name: 'Fayetteville',
    state: 'NC',
    level: 4,
    lat: 35.0527,
    lng: -78.8784,
  },
  { id: 'node-nc-cary', name: 'Cary', state: 'NC', level: 4, lat: 35.7915, lng: -78.7811 },
  {
    id: 'node-nc-wilmington',
    name: 'Wilmington',
    state: 'NC',
    level: 4,
    lat: 34.2257,
    lng: -77.9447,
  },
  {
    id: 'node-nc-high-point',
    name: 'High Point',
    state: 'NC',
    level: 4,
    lat: 35.9557,
    lng: -80.0053,
  },

  // ─── SOUTH CAROLINA ─────────────────────────────────────────
  // Level 4
  {
    id: 'node-sc-charleston',
    name: 'Charleston',
    state: 'SC',
    level: 4,
    lat: 32.7765,
    lng: -79.9311,
  },
  { id: 'node-sc-columbia', name: 'Columbia', state: 'SC', level: 4, lat: 34.0007, lng: -81.0348 },
  {
    id: 'node-sc-north-charleston',
    name: 'North Charleston',
    state: 'SC',
    level: 4,
    lat: 32.8546,
    lng: -79.9748,
  },
  {
    id: 'node-sc-greenville',
    name: 'Greenville',
    state: 'SC',
    level: 4,
    lat: 34.8526,
    lng: -82.394,
  },

  // ─── VIRGINIA ───────────────────────────────────────────────
  // Level 4
  {
    id: 'node-va-virginia-beach',
    name: 'Virginia Beach',
    state: 'VA',
    level: 4,
    lat: 36.8529,
    lng: -75.978,
  },
  { id: 'node-va-norfolk', name: 'Norfolk', state: 'VA', level: 4, lat: 36.8508, lng: -76.2859 },
  {
    id: 'node-va-chesapeake',
    name: 'Chesapeake',
    state: 'VA',
    level: 4,
    lat: 36.7682,
    lng: -76.2875,
  },
  { id: 'node-va-richmond', name: 'Richmond', state: 'VA', level: 4, lat: 37.5407, lng: -77.436 },
  {
    id: 'node-va-newport-news',
    name: 'Newport News',
    state: 'VA',
    level: 4,
    lat: 37.0871,
    lng: -76.473,
  },
  {
    id: 'node-va-alexandria',
    name: 'Alexandria',
    state: 'VA',
    level: 4,
    lat: 38.8048,
    lng: -77.0469,
  },
  { id: 'node-va-hampton', name: 'Hampton', state: 'VA', level: 4, lat: 37.0299, lng: -76.3452 },
  { id: 'node-va-roanoke', name: 'Roanoke', state: 'VA', level: 4, lat: 37.271, lng: -79.9414 },

  // ─── DISTRICT OF COLUMBIA ───────────────────────────────────
  // Level 4
  {
    id: 'node-dc-washington',
    name: 'Washington',
    state: 'DC',
    level: 4,
    lat: 38.9072,
    lng: -77.0369,
  },

  // ─── WEST VIRGINIA ──────────────────────────────────────────
  // No cities 100k+ in West Virginia
  // Level 3
  {
    id: 'node-wv-charleston',
    name: 'Charleston',
    state: 'WV',
    level: 3,
    lat: 38.3498,
    lng: -81.6326,
  },
  {
    id: 'node-wv-huntington',
    name: 'Huntington',
    state: 'WV',
    level: 3,
    lat: 38.4192,
    lng: -82.4452,
  },
  {
    id: 'node-wv-morgantown',
    name: 'Morgantown',
    state: 'WV',
    level: 3,
    lat: 39.6295,
    lng: -79.9559,
  },
  {
    id: 'node-wv-parkersburg',
    name: 'Parkersburg',
    state: 'WV',
    level: 3,
    lat: 39.2667,
    lng: -81.5615,
  },
  { id: 'node-wv-wheeling', name: 'Wheeling', state: 'WV', level: 3, lat: 40.064, lng: -80.7209 },

  // ─── ALABAMA ────────────────────────────────────────────────
  // Level 4
  {
    id: 'node-al-birmingham',
    name: 'Birmingham',
    state: 'AL',
    level: 4,
    lat: 33.5186,
    lng: -86.8104,
  },
  {
    id: 'node-al-montgomery',
    name: 'Montgomery',
    state: 'AL',
    level: 4,
    lat: 32.3792,
    lng: -86.3077,
  },
  {
    id: 'node-al-huntsville',
    name: 'Huntsville',
    state: 'AL',
    level: 4,
    lat: 34.7304,
    lng: -86.5861,
  },
  { id: 'node-al-mobile', name: 'Mobile', state: 'AL', level: 4, lat: 30.6954, lng: -88.0399 },
  {
    id: 'node-al-tuscaloosa',
    name: 'Tuscaloosa',
    state: 'AL',
    level: 4,
    lat: 33.2098,
    lng: -87.5692,
  },

  // ─── KENTUCKY ───────────────────────────────────────────────
  // Level 4
  {
    id: 'node-ky-louisville',
    name: 'Louisville',
    state: 'KY',
    level: 4,
    lat: 38.2527,
    lng: -85.7585,
  },
  {
    id: 'node-ky-lexington',
    name: 'Lexington',
    state: 'KY',
    level: 4,
    lat: 38.0406,
    lng: -84.5037,
  },
  {
    id: 'node-ky-bowling-green',
    name: 'Bowling Green',
    state: 'KY',
    level: 4,
    lat: 36.9685,
    lng: -86.4808,
  },

  // ─── MISSISSIPPI ────────────────────────────────────────────
  // Level 4
  { id: 'node-ms-jackson', name: 'Jackson', state: 'MS', level: 4, lat: 32.2988, lng: -90.1848 },
  { id: 'node-ms-gulfport', name: 'Gulfport', state: 'MS', level: 4, lat: 30.3674, lng: -89.0928 },
  { id: 'node-ms-southaven', name: 'Southaven', state: 'MS', level: 4, lat: 34.992, lng: -89.9787 },

  // ─── TENNESSEE ──────────────────────────────────────────────
  // Level 4
  {
    id: 'node-tn-nashville',
    name: 'Nashville',
    state: 'TN',
    level: 4,
    lat: 36.1627,
    lng: -86.7816,
  },
  { id: 'node-tn-memphis', name: 'Memphis', state: 'TN', level: 4, lat: 35.1495, lng: -90.049 },
  {
    id: 'node-tn-knoxville',
    name: 'Knoxville',
    state: 'TN',
    level: 4,
    lat: 35.9606,
    lng: -83.9207,
  },
  {
    id: 'node-tn-chattanooga',
    name: 'Chattanooga',
    state: 'TN',
    level: 4,
    lat: 35.0456,
    lng: -85.3097,
  },
  {
    id: 'node-tn-clarksville',
    name: 'Clarksville',
    state: 'TN',
    level: 4,
    lat: 36.5298,
    lng: -87.3595,
  },
  {
    id: 'node-tn-murfreesboro',
    name: 'Murfreesboro',
    state: 'TN',
    level: 4,
    lat: 35.8456,
    lng: -86.3903,
  },

  // ─── ARKANSAS ───────────────────────────────────────────────
  // Level 4
  {
    id: 'node-ar-little-rock',
    name: 'Little Rock',
    state: 'AR',
    level: 4,
    lat: 34.7465,
    lng: -92.2896,
  },
  {
    id: 'node-ar-fort-smith',
    name: 'Fort Smith',
    state: 'AR',
    level: 4,
    lat: 35.3859,
    lng: -94.3985,
  },
  {
    id: 'node-ar-fayetteville',
    name: 'Fayetteville',
    state: 'AR',
    level: 4,
    lat: 36.0822,
    lng: -94.1719,
  },
  {
    id: 'node-ar-springdale',
    name: 'Springdale',
    state: 'AR',
    level: 4,
    lat: 36.1867,
    lng: -94.1288,
  },
  {
    id: 'node-ar-jonesboro',
    name: 'Jonesboro',
    state: 'AR',
    level: 4,
    lat: 35.8423,
    lng: -90.7043,
  },

  // ─── LOUISIANA ──────────────────────────────────────────────
  // Level 4
  {
    id: 'node-la-new-orleans',
    name: 'New Orleans',
    state: 'LA',
    level: 4,
    lat: 29.9511,
    lng: -90.0715,
  },
  {
    id: 'node-la-baton-rouge',
    name: 'Baton Rouge',
    state: 'LA',
    level: 4,
    lat: 30.4515,
    lng: -91.1871,
  },
  {
    id: 'node-la-shreveport',
    name: 'Shreveport',
    state: 'LA',
    level: 4,
    lat: 32.5252,
    lng: -93.7502,
  },
  {
    id: 'node-la-lafayette',
    name: 'Lafayette',
    state: 'LA',
    level: 4,
    lat: 30.2241,
    lng: -92.0198,
  },
  {
    id: 'node-la-lake-charles',
    name: 'Lake Charles',
    state: 'LA',
    level: 4,
    lat: 30.2266,
    lng: -93.2174,
  },

  // ─── OKLAHOMA ───────────────────────────────────────────────
  // Level 4
  {
    id: 'node-ok-oklahoma-city',
    name: 'Oklahoma City',
    state: 'OK',
    level: 4,
    lat: 35.4676,
    lng: -97.5164,
  },
  { id: 'node-ok-tulsa', name: 'Tulsa', state: 'OK', level: 4, lat: 36.154, lng: -95.9928 },
  { id: 'node-ok-norman', name: 'Norman', state: 'OK', level: 4, lat: 35.2226, lng: -97.4395 },
  {
    id: 'node-ok-broken-arrow',
    name: 'Broken Arrow',
    state: 'OK',
    level: 4,
    lat: 36.0609,
    lng: -95.7975,
  },
  { id: 'node-ok-edmond', name: 'Edmond', state: 'OK', level: 4, lat: 35.6528, lng: -97.4781 },
  { id: 'node-ok-lawton', name: 'Lawton', state: 'OK', level: 4, lat: 34.6036, lng: -98.3959 },

  // ─── TEXAS ──────────────────────────────────────────────────
  // Level 4
  { id: 'node-tx-houston', name: 'Houston', state: 'TX', level: 4, lat: 29.7604, lng: -95.3698 },
  {
    id: 'node-tx-san-antonio',
    name: 'San Antonio',
    state: 'TX',
    level: 4,
    lat: 29.4241,
    lng: -98.4936,
  },
  { id: 'node-tx-dallas', name: 'Dallas', state: 'TX', level: 4, lat: 32.7767, lng: -96.797 },
  { id: 'node-tx-austin', name: 'Austin', state: 'TX', level: 4, lat: 30.2672, lng: -97.7431 },
  {
    id: 'node-tx-fort-worth',
    name: 'Fort Worth',
    state: 'TX',
    level: 4,
    lat: 32.7555,
    lng: -97.3308,
  },
  { id: 'node-tx-el-paso', name: 'El Paso', state: 'TX', level: 4, lat: 31.7619, lng: -106.485 },
  {
    id: 'node-tx-arlington',
    name: 'Arlington',
    state: 'TX',
    level: 4,
    lat: 32.7357,
    lng: -97.1081,
  },
  {
    id: 'node-tx-corpus-christi',
    name: 'Corpus Christi',
    state: 'TX',
    level: 4,
    lat: 27.8006,
    lng: -97.3964,
  },
  { id: 'node-tx-plano', name: 'Plano', state: 'TX', level: 4, lat: 33.0198, lng: -96.6989 },
  { id: 'node-tx-laredo', name: 'Laredo', state: 'TX', level: 4, lat: 27.5036, lng: -99.5076 },
  { id: 'node-tx-lubbock', name: 'Lubbock', state: 'TX', level: 4, lat: 33.5779, lng: -101.8552 },
  { id: 'node-tx-irving', name: 'Irving', state: 'TX', level: 4, lat: 32.814, lng: -96.9489 },
  { id: 'node-tx-garland', name: 'Garland', state: 'TX', level: 4, lat: 32.9126, lng: -96.6389 },
  { id: 'node-tx-frisco', name: 'Frisco', state: 'TX', level: 4, lat: 33.1507, lng: -96.8236 },
  { id: 'node-tx-mckinney', name: 'McKinney', state: 'TX', level: 4, lat: 33.1972, lng: -96.6397 },
  { id: 'node-tx-amarillo', name: 'Amarillo', state: 'TX', level: 4, lat: 35.222, lng: -101.8313 },
  {
    id: 'node-tx-brownsville',
    name: 'Brownsville',
    state: 'TX',
    level: 4,
    lat: 25.9017,
    lng: -97.4975,
  },
  {
    id: 'node-tx-grand-prairie',
    name: 'Grand Prairie',
    state: 'TX',
    level: 4,
    lat: 32.746,
    lng: -96.9978,
  },
  { id: 'node-tx-killeen', name: 'Killeen', state: 'TX', level: 4, lat: 31.1171, lng: -97.7278 },
  { id: 'node-tx-pasadena', name: 'Pasadena', state: 'TX', level: 4, lat: 29.6911, lng: -95.2091 },
  { id: 'node-tx-midland', name: 'Midland', state: 'TX', level: 4, lat: 31.9973, lng: -102.0779 },
  { id: 'node-tx-mcallen', name: 'McAllen', state: 'TX', level: 4, lat: 26.2034, lng: -98.23 },
  { id: 'node-tx-denton', name: 'Denton', state: 'TX', level: 4, lat: 33.2148, lng: -97.1331 },
  { id: 'node-tx-waco', name: 'Waco', state: 'TX', level: 4, lat: 31.5493, lng: -97.1467 },
  { id: 'node-tx-odessa', name: 'Odessa', state: 'TX', level: 4, lat: 31.8457, lng: -102.3676 },
  { id: 'node-tx-beaumont', name: 'Beaumont', state: 'TX', level: 4, lat: 30.0802, lng: -94.1266 },
  { id: 'node-tx-abilene', name: 'Abilene', state: 'TX', level: 4, lat: 32.4487, lng: -99.7331 },
  {
    id: 'node-tx-round-rock',
    name: 'Round Rock',
    state: 'TX',
    level: 4,
    lat: 30.5083,
    lng: -97.6789,
  },
  {
    id: 'node-tx-college-station',
    name: 'College Station',
    state: 'TX',
    level: 4,
    lat: 30.628,
    lng: -96.3344,
  },
  // Level 3
  { id: 'node-tx-tyler', name: 'Tyler', state: 'TX', level: 3, lat: 32.3513, lng: -95.3011 },
  {
    id: 'node-tx-san-marcos',
    name: 'San Marcos',
    state: 'TX',
    level: 3,
    lat: 29.8833,
    lng: -97.9414,
  },
  {
    id: 'node-tx-new-braunfels',
    name: 'New Braunfels',
    state: 'TX',
    level: 3,
    lat: 29.703,
    lng: -98.1245,
  },
  {
    id: 'node-tx-galveston',
    name: 'Galveston',
    state: 'TX',
    level: 3,
    lat: 29.3013,
    lng: -94.7977,
  },
  { id: 'node-tx-temple', name: 'Temple', state: 'TX', level: 3, lat: 31.0982, lng: -97.3428 },
]);

module.exports = { territories, states, nodes };
