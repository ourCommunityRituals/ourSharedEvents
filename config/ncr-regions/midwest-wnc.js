/**
 * NCR Coverage — Midwest West North Central
 * Census division: West North Central (IA, KS, MN, MO, NE, ND, SD)
 *
 * 1 territory, 7 states
 * ~20 Level 4 metros (100k+), ~42 Level 3 zones (25k-100k, max 6/state)
 *
 * @module config/ncr-regions/midwest-wnc
 */

const territories = Object.freeze([
  { id: 'territory-west-north-central', name: 'West North Central', level: 6 },
]);

const states = Object.freeze([
  { id: 'state-ia', name: 'Iowa', state: 'IA', level: 5, territory: 'territory-west-north-central' },
  { id: 'state-ks', name: 'Kansas', state: 'KS', level: 5, territory: 'territory-west-north-central' },
  { id: 'state-mn', name: 'Minnesota', state: 'MN', level: 5, territory: 'territory-west-north-central' },
  { id: 'state-mo', name: 'Missouri', state: 'MO', level: 5, territory: 'territory-west-north-central' },
  { id: 'state-ne', name: 'Nebraska', state: 'NE', level: 5, territory: 'territory-west-north-central' },
  { id: 'state-nd', name: 'North Dakota', state: 'ND', level: 5, territory: 'territory-west-north-central' },
  { id: 'state-sd', name: 'South Dakota', state: 'SD', level: 5, territory: 'territory-west-north-central' },
]);

const nodes = Object.freeze([
  // ─── IOWA ───────────────────────────────────────────────────
  // Level 4: Cities 100k+
  { id: 'node-ia-des-moines', name: 'Des Moines', state: 'IA', level: 4, lat: 41.5868, lng: -93.6250 },
  { id: 'node-ia-cedar-rapids', name: 'Cedar Rapids', state: 'IA', level: 4, lat: 41.9779, lng: -91.6656 },
  { id: 'node-ia-davenport', name: 'Davenport', state: 'IA', level: 4, lat: 41.5236, lng: -90.5776 },
  { id: 'node-ia-sioux-city', name: 'Sioux City', state: 'IA', level: 4, lat: 42.4963, lng: -96.4049 },
  { id: 'node-ia-iowa-city', name: 'Iowa City', state: 'IA', level: 4, lat: 41.6611, lng: -91.5302 },
  // Level 3: Key cities 25k-100k
  { id: 'node-ia-waterloo', name: 'Waterloo', state: 'IA', level: 3, lat: 42.4928, lng: -92.3426 },
  { id: 'node-ia-ames', name: 'Ames', state: 'IA', level: 3, lat: 42.0347, lng: -93.6200 },
  { id: 'node-ia-dubuque', name: 'Dubuque', state: 'IA', level: 3, lat: 42.5006, lng: -90.6646 },
  { id: 'node-ia-council-bluffs', name: 'Council Bluffs', state: 'IA', level: 3, lat: 41.2619, lng: -95.8608 },
  { id: 'node-ia-mason-city', name: 'Mason City', state: 'IA', level: 3, lat: 43.1536, lng: -93.2010 },
  { id: 'node-ia-burlington', name: 'Burlington', state: 'IA', level: 3, lat: 40.8075, lng: -91.1129 },

  // ─── KANSAS ─────────────────────────────────────────────────
  // Level 4: Cities 100k+
  { id: 'node-ks-wichita', name: 'Wichita', state: 'KS', level: 4, lat: 37.6872, lng: -97.3301 },
  { id: 'node-ks-overland-park', name: 'Overland Park', state: 'KS', level: 4, lat: 38.9822, lng: -94.6708 },
  { id: 'node-ks-kansas-city', name: 'Kansas City', state: 'KS', level: 4, lat: 39.1155, lng: -94.6268 },
  { id: 'node-ks-olathe', name: 'Olathe', state: 'KS', level: 4, lat: 38.8814, lng: -94.8191 },
  { id: 'node-ks-topeka', name: 'Topeka', state: 'KS', level: 4, lat: 39.0489, lng: -95.6780 },
  { id: 'node-ks-lawrence', name: 'Lawrence', state: 'KS', level: 4, lat: 38.9717, lng: -95.2353 },
  // Level 3: Key cities 25k-100k
  { id: 'node-ks-manhattan', name: 'Manhattan', state: 'KS', level: 3, lat: 39.1836, lng: -96.5717 },
  { id: 'node-ks-salina', name: 'Salina', state: 'KS', level: 3, lat: 38.8403, lng: -97.6114 },
  { id: 'node-ks-hutchinson', name: 'Hutchinson', state: 'KS', level: 3, lat: 38.0608, lng: -97.9298 },
  { id: 'node-ks-leavenworth', name: 'Leavenworth', state: 'KS', level: 3, lat: 39.3112, lng: -94.9224 },
  { id: 'node-ks-garden-city', name: 'Garden City', state: 'KS', level: 3, lat: 37.9717, lng: -100.8727 },

  // ─── MINNESOTA ──────────────────────────────────────────────
  // Level 4: Cities 100k+
  { id: 'node-mn-minneapolis', name: 'Minneapolis', state: 'MN', level: 4, lat: 44.9778, lng: -93.2650 },
  { id: 'node-mn-st-paul', name: 'St Paul', state: 'MN', level: 4, lat: 44.9537, lng: -93.0900 },
  { id: 'node-mn-rochester', name: 'Rochester', state: 'MN', level: 4, lat: 44.0121, lng: -92.4802 },
  { id: 'node-mn-duluth', name: 'Duluth', state: 'MN', level: 4, lat: 46.7867, lng: -92.1005 },
  { id: 'node-mn-bloomington', name: 'Bloomington', state: 'MN', level: 4, lat: 44.8408, lng: -93.2983 },
  { id: 'node-mn-brooklyn-park', name: 'Brooklyn Park', state: 'MN', level: 4, lat: 45.0941, lng: -93.3563 },
  { id: 'node-mn-plymouth', name: 'Plymouth', state: 'MN', level: 4, lat: 45.0105, lng: -93.4555 },
  // Level 3: Key cities 25k-100k
  { id: 'node-mn-st-cloud', name: 'St Cloud', state: 'MN', level: 3, lat: 45.5579, lng: -94.1632 },
  { id: 'node-mn-mankato', name: 'Mankato', state: 'MN', level: 3, lat: 44.1636, lng: -93.9994 },
  { id: 'node-mn-moorhead', name: 'Moorhead', state: 'MN', level: 3, lat: 46.8738, lng: -96.7678 },
  { id: 'node-mn-winona', name: 'Winona', state: 'MN', level: 3, lat: 44.0499, lng: -91.6393 },
  { id: 'node-mn-owatonna', name: 'Owatonna', state: 'MN', level: 3, lat: 44.0839, lng: -93.2260 },
  { id: 'node-mn-faribault', name: 'Faribault', state: 'MN', level: 3, lat: 44.2950, lng: -93.2688 },

  // ─── MISSOURI ───────────────────────────────────────────────
  // Level 4: Cities 100k+
  { id: 'node-mo-kansas-city', name: 'Kansas City', state: 'MO', level: 4, lat: 39.0997, lng: -94.5786 },
  { id: 'node-mo-st-louis', name: 'St Louis', state: 'MO', level: 4, lat: 38.6270, lng: -90.1994 },
  { id: 'node-mo-springfield', name: 'Springfield', state: 'MO', level: 4, lat: 37.2090, lng: -93.2923 },
  { id: 'node-mo-columbia', name: 'Columbia', state: 'MO', level: 4, lat: 38.9517, lng: -92.3341 },
  { id: 'node-mo-independence', name: 'Independence', state: 'MO', level: 4, lat: 39.0911, lng: -94.4155 },
  { id: 'node-mo-lees-summit', name: "Lee's Summit", state: 'MO', level: 4, lat: 38.9108, lng: -94.3822 },
  // Level 3: Key cities 25k-100k
  { id: 'node-mo-st-joseph', name: 'St Joseph', state: 'MO', level: 3, lat: 39.7687, lng: -94.8466 },
  { id: 'node-mo-jefferson-city', name: 'Jefferson City', state: 'MO', level: 3, lat: 38.5768, lng: -92.1735 },
  { id: 'node-mo-joplin', name: 'Joplin', state: 'MO', level: 3, lat: 37.0842, lng: -94.5133 },
  { id: 'node-mo-cape-girardeau', name: 'Cape Girardeau', state: 'MO', level: 3, lat: 37.3059, lng: -89.5182 },
  { id: 'node-mo-sedalia', name: 'Sedalia', state: 'MO', level: 3, lat: 38.7045, lng: -93.2283 },
  { id: 'node-mo-hannibal', name: 'Hannibal', state: 'MO', level: 3, lat: 39.7084, lng: -91.3585 },

  // ─── NEBRASKA ───────────────────────────────────────────────
  // Level 4: Cities 100k+
  { id: 'node-ne-omaha', name: 'Omaha', state: 'NE', level: 4, lat: 41.2565, lng: -95.9345 },
  { id: 'node-ne-lincoln', name: 'Lincoln', state: 'NE', level: 4, lat: 40.8136, lng: -96.7026 },
  { id: 'node-ne-bellevue', name: 'Bellevue', state: 'NE', level: 4, lat: 41.1544, lng: -95.8908 },
  { id: 'node-ne-grand-island', name: 'Grand Island', state: 'NE', level: 4, lat: 40.9264, lng: -98.3420 },
  // Level 3: Key cities 25k-100k
  { id: 'node-ne-kearney', name: 'Kearney', state: 'NE', level: 3, lat: 40.6993, lng: -99.0832 },
  { id: 'node-ne-north-platte', name: 'North Platte', state: 'NE', level: 3, lat: 41.1240, lng: -100.7654 },
  { id: 'node-ne-hastings', name: 'Hastings', state: 'NE', level: 3, lat: 40.5862, lng: -98.3887 },
  { id: 'node-ne-norfolk', name: 'Norfolk', state: 'NE', level: 3, lat: 42.0285, lng: -97.4170 },
  { id: 'node-ne-scottsbluff', name: 'Scottsbluff', state: 'NE', level: 3, lat: 41.8666, lng: -103.6672 },
  { id: 'node-ne-fremont', name: 'Fremont', state: 'NE', level: 3, lat: 41.4433, lng: -96.4981 },

  // ─── NORTH DAKOTA ───────────────────────────────────────────
  // Level 4: Cities 100k+
  { id: 'node-nd-fargo', name: 'Fargo', state: 'ND', level: 4, lat: 46.8772, lng: -96.7898 },
  // Level 3: Key cities 25k-100k
  { id: 'node-nd-bismarck', name: 'Bismarck', state: 'ND', level: 3, lat: 46.8083, lng: -100.7837 },
  { id: 'node-nd-grand-forks', name: 'Grand Forks', state: 'ND', level: 3, lat: 47.9253, lng: -97.0329 },
  { id: 'node-nd-minot', name: 'Minot', state: 'ND', level: 3, lat: 48.2330, lng: -101.2923 },
  { id: 'node-nd-west-fargo', name: 'West Fargo', state: 'ND', level: 3, lat: 46.8770, lng: -96.9003 },
  { id: 'node-nd-dickinson', name: 'Dickinson', state: 'ND', level: 3, lat: 46.8792, lng: -102.7896 },
  { id: 'node-nd-jamestown', name: 'Jamestown', state: 'ND', level: 3, lat: 46.9106, lng: -98.7084 },

  // ─── SOUTH DAKOTA ───────────────────────────────────────────
  // Level 4: Cities 100k+
  { id: 'node-sd-sioux-falls', name: 'Sioux Falls', state: 'SD', level: 4, lat: 43.5446, lng: -96.7311 },
  // Level 3: Key cities 25k-100k
  { id: 'node-sd-rapid-city', name: 'Rapid City', state: 'SD', level: 3, lat: 44.0805, lng: -103.2310 },
  { id: 'node-sd-aberdeen', name: 'Aberdeen', state: 'SD', level: 3, lat: 45.4647, lng: -98.4865 },
  { id: 'node-sd-brookings', name: 'Brookings', state: 'SD', level: 3, lat: 44.3114, lng: -96.7984 },
  { id: 'node-sd-watertown', name: 'Watertown', state: 'SD', level: 3, lat: 44.8994, lng: -97.1151 },
  { id: 'node-sd-mitchell', name: 'Mitchell', state: 'SD', level: 3, lat: 43.7094, lng: -98.0298 },
  { id: 'node-sd-pierre', name: 'Pierre', state: 'SD', level: 3, lat: 44.3683, lng: -100.3510 },
]);

module.exports = { territories, states, nodes };
