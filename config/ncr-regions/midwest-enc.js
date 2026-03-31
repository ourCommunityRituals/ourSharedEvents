/**
 * NCR Coverage — Midwest East North Central
 * Census division: East North Central
 * States: IL, IN, MI, OH, WI
 *
 * Level 4: Cities 100k+ population
 * Level 3: Key cities 25k-100k (max 8 per state)
 *
 * @module config/ncr-regions/midwest-enc
 */

const territories = Object.freeze([
  { id: 'territory-east-north-central', name: 'East North Central', level: 6 },
]);

const states = Object.freeze([
  { id: 'state-il', name: 'Illinois', state: 'IL', level: 5, territory: 'territory-east-north-central' },
  { id: 'state-in', name: 'Indiana', state: 'IN', level: 5, territory: 'territory-east-north-central' },
  { id: 'state-mi', name: 'Michigan', state: 'MI', level: 5, territory: 'territory-east-north-central' },
  { id: 'state-oh', name: 'Ohio', state: 'OH', level: 5, territory: 'territory-east-north-central' },
  { id: 'state-wi', name: 'Wisconsin', state: 'WI', level: 5, territory: 'territory-east-north-central' },
]);

const nodes = Object.freeze([
  // ─── ILLINOIS ───────────────────────────────────────────────
  // Level 4: Cities 100k+
  { id: 'node-il-chicago', name: 'Chicago', state: 'IL', level: 4, lat: 41.8781, lng: -87.6298 },
  { id: 'node-il-aurora', name: 'Aurora', state: 'IL', level: 4, lat: 41.7606, lng: -88.3201 },
  { id: 'node-il-naperville', name: 'Naperville', state: 'IL', level: 4, lat: 41.7508, lng: -88.1535 },
  { id: 'node-il-joliet', name: 'Joliet', state: 'IL', level: 4, lat: 41.5250, lng: -88.0817 },
  { id: 'node-il-rockford', name: 'Rockford', state: 'IL', level: 4, lat: 42.2711, lng: -89.0940 },
  { id: 'node-il-springfield', name: 'Springfield', state: 'IL', level: 4, lat: 39.7817, lng: -89.6501 },
  { id: 'node-il-elgin', name: 'Elgin', state: 'IL', level: 4, lat: 42.0354, lng: -88.2826 },
  { id: 'node-il-peoria', name: 'Peoria', state: 'IL', level: 4, lat: 40.6936, lng: -89.5890 },
  { id: 'node-il-champaign', name: 'Champaign', state: 'IL', level: 4, lat: 40.1164, lng: -88.2434 },
  // Level 3: Key cities 25k-100k
  { id: 'node-il-bloomington', name: 'Bloomington', state: 'IL', level: 3, lat: 40.4842, lng: -88.9937 },
  { id: 'node-il-decatur', name: 'Decatur', state: 'IL', level: 3, lat: 39.8403, lng: -88.9548 },
  { id: 'node-il-arlington-heights', name: 'Arlington Heights', state: 'IL', level: 3, lat: 42.0884, lng: -87.9806 },
  { id: 'node-il-evanston', name: 'Evanston', state: 'IL', level: 3, lat: 42.0451, lng: -87.6877 },
  { id: 'node-il-schaumburg', name: 'Schaumburg', state: 'IL', level: 3, lat: 42.0334, lng: -88.0834 },
  { id: 'node-il-dekalb', name: 'DeKalb', state: 'IL', level: 3, lat: 41.9295, lng: -88.7501 },
  { id: 'node-il-carbondale', name: 'Carbondale', state: 'IL', level: 3, lat: 37.7273, lng: -89.2168 },
  { id: 'node-il-normal', name: 'Normal', state: 'IL', level: 3, lat: 40.5142, lng: -88.9907 },
  // ─── INDIANA ────────────────────────────────────────────────
  // Level 4: Cities 100k+
  { id: 'node-in-indianapolis', name: 'Indianapolis', state: 'IN', level: 4, lat: 39.7684, lng: -86.1581 },
  { id: 'node-in-fort-wayne', name: 'Fort Wayne', state: 'IN', level: 4, lat: 41.0793, lng: -85.1394 },
  { id: 'node-in-evansville', name: 'Evansville', state: 'IN', level: 4, lat: 37.9716, lng: -87.5711 },
  { id: 'node-in-south-bend', name: 'South Bend', state: 'IN', level: 4, lat: 41.6764, lng: -86.2520 },
  { id: 'node-in-carmel', name: 'Carmel', state: 'IN', level: 4, lat: 39.9784, lng: -86.1180 },
  { id: 'node-in-fishers', name: 'Fishers', state: 'IN', level: 4, lat: 39.9568, lng: -86.0139 },
  // Level 3: Key cities 25k-100k
  { id: 'node-in-bloomington', name: 'Bloomington', state: 'IN', level: 3, lat: 39.1653, lng: -86.5264 },
  { id: 'node-in-lafayette', name: 'Lafayette', state: 'IN', level: 3, lat: 40.4167, lng: -86.8753 },
  { id: 'node-in-muncie', name: 'Muncie', state: 'IN', level: 3, lat: 40.1934, lng: -85.3864 },
  { id: 'node-in-terre-haute', name: 'Terre Haute', state: 'IN', level: 3, lat: 39.4667, lng: -87.4139 },
  { id: 'node-in-kokomo', name: 'Kokomo', state: 'IN', level: 3, lat: 40.4864, lng: -86.1336 },
  { id: 'node-in-anderson', name: 'Anderson', state: 'IN', level: 3, lat: 40.1053, lng: -85.6803 },
  { id: 'node-in-noblesville', name: 'Noblesville', state: 'IN', level: 3, lat: 40.0456, lng: -86.0086 },
  { id: 'node-in-columbus', name: 'Columbus', state: 'IN', level: 3, lat: 39.2014, lng: -85.9214 },
  // ─── MICHIGAN ───────────────────────────────────────────────
  // Level 4: Cities 100k+
  { id: 'node-mi-detroit', name: 'Detroit', state: 'MI', level: 4, lat: 42.3314, lng: -83.0458 },
  { id: 'node-mi-grand-rapids', name: 'Grand Rapids', state: 'MI', level: 4, lat: 42.9634, lng: -85.6681 },
  { id: 'node-mi-warren', name: 'Warren', state: 'MI', level: 4, lat: 42.5145, lng: -83.0147 },
  { id: 'node-mi-sterling-heights', name: 'Sterling Heights', state: 'MI', level: 4, lat: 42.5803, lng: -83.0302 },
  { id: 'node-mi-lansing', name: 'Lansing', state: 'MI', level: 4, lat: 42.7325, lng: -84.5555 },
  { id: 'node-mi-ann-arbor', name: 'Ann Arbor', state: 'MI', level: 4, lat: 42.2808, lng: -83.7430 },
  { id: 'node-mi-flint', name: 'Flint', state: 'MI', level: 4, lat: 43.0125, lng: -83.6875 },
  // Level 3: Key cities 25k-100k
  { id: 'node-mi-kalamazoo', name: 'Kalamazoo', state: 'MI', level: 3, lat: 42.2917, lng: -85.5872 },
  { id: 'node-mi-muskegon', name: 'Muskegon', state: 'MI', level: 3, lat: 43.2342, lng: -86.2484 },
  { id: 'node-mi-holland', name: 'Holland', state: 'MI', level: 3, lat: 42.7876, lng: -86.1089 },
  { id: 'node-mi-traverse-city', name: 'Traverse City', state: 'MI', level: 3, lat: 44.7631, lng: -85.6206 },
  { id: 'node-mi-midland', name: 'Midland', state: 'MI', level: 3, lat: 43.6156, lng: -84.2472 },
  { id: 'node-mi-port-huron', name: 'Port Huron', state: 'MI', level: 3, lat: 42.9709, lng: -82.4249 },
  { id: 'node-mi-saginaw', name: 'Saginaw', state: 'MI', level: 3, lat: 43.4195, lng: -83.9508 },
  { id: 'node-mi-battle-creek', name: 'Battle Creek', state: 'MI', level: 3, lat: 42.3212, lng: -85.1797 },
  // ─── OHIO ───────────────────────────────────────────────────
  // Level 4: Cities 100k+
  { id: 'node-oh-columbus', name: 'Columbus', state: 'OH', level: 4, lat: 39.9612, lng: -82.9988 },
  { id: 'node-oh-cleveland', name: 'Cleveland', state: 'OH', level: 4, lat: 41.4993, lng: -81.6944 },
  { id: 'node-oh-cincinnati', name: 'Cincinnati', state: 'OH', level: 4, lat: 39.1031, lng: -84.5120 },
  { id: 'node-oh-toledo', name: 'Toledo', state: 'OH', level: 4, lat: 41.6528, lng: -83.5379 },
  { id: 'node-oh-akron', name: 'Akron', state: 'OH', level: 4, lat: 41.0814, lng: -81.5190 },
  { id: 'node-oh-dayton', name: 'Dayton', state: 'OH', level: 4, lat: 39.7589, lng: -84.1916 },
  // Level 3: Key cities 25k-100k
  { id: 'node-oh-youngstown', name: 'Youngstown', state: 'OH', level: 3, lat: 41.0998, lng: -80.6495 },
  { id: 'node-oh-canton', name: 'Canton', state: 'OH', level: 3, lat: 40.7990, lng: -81.3784 },
  { id: 'node-oh-athens', name: 'Athens', state: 'OH', level: 3, lat: 39.3292, lng: -82.1013 },
  { id: 'node-oh-mansfield', name: 'Mansfield', state: 'OH', level: 3, lat: 40.7589, lng: -82.5154 },
  { id: 'node-oh-newark', name: 'Newark', state: 'OH', level: 3, lat: 40.0581, lng: -82.4013 },
  { id: 'node-oh-lima', name: 'Lima', state: 'OH', level: 3, lat: 40.7428, lng: -84.1052 },
  { id: 'node-oh-findlay', name: 'Findlay', state: 'OH', level: 3, lat: 41.0442, lng: -83.6499 },
  { id: 'node-oh-sandusky', name: 'Sandusky', state: 'OH', level: 3, lat: 41.4489, lng: -82.7079 },
  // ─── WISCONSIN ──────────────────────────────────────────────
  // Level 4: Cities 100k+
  { id: 'node-wi-milwaukee', name: 'Milwaukee', state: 'WI', level: 4, lat: 43.0389, lng: -87.9065 },
  { id: 'node-wi-madison', name: 'Madison', state: 'WI', level: 4, lat: 43.0731, lng: -89.4012 },
  { id: 'node-wi-green-bay', name: 'Green Bay', state: 'WI', level: 4, lat: 44.5133, lng: -88.0133 },
  { id: 'node-wi-kenosha', name: 'Kenosha', state: 'WI', level: 4, lat: 42.5847, lng: -87.8212 },
  // Level 3: Key cities 25k-100k
  { id: 'node-wi-racine', name: 'Racine', state: 'WI', level: 3, lat: 42.7261, lng: -87.7829 },
  { id: 'node-wi-appleton', name: 'Appleton', state: 'WI', level: 3, lat: 44.2619, lng: -88.4154 },
  { id: 'node-wi-oshkosh', name: 'Oshkosh', state: 'WI', level: 3, lat: 44.0247, lng: -88.5426 },
  { id: 'node-wi-eau-claire', name: 'Eau Claire', state: 'WI', level: 3, lat: 44.8113, lng: -91.4985 },
  { id: 'node-wi-la-crosse', name: 'La Crosse', state: 'WI', level: 3, lat: 43.8014, lng: -91.2396 },
  { id: 'node-wi-waukesha', name: 'Waukesha', state: 'WI', level: 3, lat: 43.0117, lng: -88.2315 },
  { id: 'node-wi-janesville', name: 'Janesville', state: 'WI', level: 3, lat: 42.6828, lng: -89.0187 },
  { id: 'node-wi-sturgeon-bay', name: 'Sturgeon Bay', state: 'WI', level: 3, lat: 44.8342, lng: -87.3770 },
]);

module.exports = { territories, states, nodes };
