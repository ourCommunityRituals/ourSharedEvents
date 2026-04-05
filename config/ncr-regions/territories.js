/**
 * NCR Coverage — US Territories
 * Puerto Rico + future territories (USVI, Guam, AS, CNMI)
 *
 * 1 territory, 1 state-equivalent
 * ~9 Level 4 municipios (100k+), ~15 Level 3 municipios (25k-100k)
 *
 * @module config/ncr-regions/territories
 */

const territories = Object.freeze([
  { id: 'territory-us-territories', name: 'US Territories', level: 6 },
]);

const states = Object.freeze([
  {
    id: 'state-pr',
    name: 'Puerto Rico',
    state: 'PR',
    level: 5,
    territory: 'territory-us-territories',
  },
]);

const nodes = Object.freeze([
  // ─── PUERTO RICO ────────────────────────────────────────────
  // Level 4: Municipios 100k+ (metro population)
  { id: 'node-pr-san-juan', name: 'San Juan', state: 'PR', level: 4, lat: 18.4655, lng: -66.1057 },
  {
    id: 'node-pr-bayamon',
    name: 'Bayam\u00f3n',
    state: 'PR',
    level: 4,
    lat: 18.3985,
    lng: -66.1553,
  },
  { id: 'node-pr-carolina', name: 'Carolina', state: 'PR', level: 4, lat: 18.3811, lng: -65.9574 },
  { id: 'node-pr-ponce', name: 'Ponce', state: 'PR', level: 4, lat: 18.0111, lng: -66.6141 },
  { id: 'node-pr-caguas', name: 'Caguas', state: 'PR', level: 4, lat: 18.2341, lng: -66.0485 },
  { id: 'node-pr-guaynabo', name: 'Guaynabo', state: 'PR', level: 4, lat: 18.3577, lng: -66.1108 },
  {
    id: 'node-pr-mayaguez',
    name: 'Mayag\u00fcez',
    state: 'PR',
    level: 4,
    lat: 18.2013,
    lng: -67.1397,
  },
  { id: 'node-pr-arecibo', name: 'Arecibo', state: 'PR', level: 4, lat: 18.4725, lng: -66.7157 },
  { id: 'node-pr-toa-baja', name: 'Toa Baja', state: 'PR', level: 4, lat: 18.4441, lng: -66.2544 },

  // Level 3: Major municipios 25k-100k
  {
    id: 'node-pr-aguadilla',
    name: 'Aguadilla',
    state: 'PR',
    level: 3,
    lat: 18.4274,
    lng: -67.1541,
  },
  { id: 'node-pr-humacao', name: 'Humacao', state: 'PR', level: 3, lat: 18.1498, lng: -65.8275 },
  { id: 'node-pr-fajardo', name: 'Fajardo', state: 'PR', level: 3, lat: 18.3258, lng: -65.6525 },
  {
    id: 'node-pr-vega-baja',
    name: 'Vega Baja',
    state: 'PR',
    level: 3,
    lat: 18.4461,
    lng: -66.3874,
  },
  { id: 'node-pr-isabela', name: 'Isabela', state: 'PR', level: 3, lat: 18.5, lng: -67.0244 },
  { id: 'node-pr-yauco', name: 'Yauco', state: 'PR', level: 3, lat: 18.035, lng: -66.8498 },
  { id: 'node-pr-guayama', name: 'Guayama', state: 'PR', level: 3, lat: 17.9842, lng: -66.1127 },
  { id: 'node-pr-cayey', name: 'Cayey', state: 'PR', level: 3, lat: 18.1119, lng: -66.166 },
  { id: 'node-pr-manati', name: 'Manat\u00ed', state: 'PR', level: 3, lat: 18.4306, lng: -66.4828 },
  {
    id: 'node-pr-san-german',
    name: 'San Germ\u00e1n',
    state: 'PR',
    level: 3,
    lat: 18.0826,
    lng: -67.0462,
  },
  {
    id: 'node-pr-cabo-rojo',
    name: 'Cabo Rojo',
    state: 'PR',
    level: 3,
    lat: 18.0866,
    lng: -67.1457,
  },
  { id: 'node-pr-catano', name: 'Cata\u00f1o', state: 'PR', level: 3, lat: 18.4413, lng: -66.1307 },
  {
    id: 'node-pr-trujillo-alto',
    name: 'Trujillo Alto',
    state: 'PR',
    level: 3,
    lat: 18.3547,
    lng: -66.0074,
  },
  { id: 'node-pr-dorado', name: 'Dorado', state: 'PR', level: 3, lat: 18.4589, lng: -66.2678 },
  {
    id: 'node-pr-canovanas',
    name: 'Can\u00f3vanas',
    state: 'PR',
    level: 3,
    lat: 18.3793,
    lng: -65.9013,
  },
]);

module.exports = { territories, states, nodes };
