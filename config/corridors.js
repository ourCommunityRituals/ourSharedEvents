/**
 * Corridors Configuration — Geographic Seed Data
 *
 * Defines founding community corridors (Level 1-3) and
 * primary highway corridors (Level 5 Region).
 *
 * Schema: See workers/oursharedevents/migrations/0010_create_ncr_v2_hierarchy.sql
 * ADR: See docs/adr/ADR-009-ncr-v2-geographic-hierarchy.md
 *
 * @module config/corridors
 */

// =============================================================================
// NCR v2 Hierarchy Levels
// =============================================================================

const HIERARCHY_LEVELS = Object.freeze({
  COMMUNITY: 1,
  DISTRICT: 2,
  ZONE: 3,
  METRO: 4,
  REGION: 5,
  TERRITORY: 6,
  NETWORK: 7,
});

// =============================================================================
// Founding Community Corridors (Level 1-3)
// These are the original five communities. They remain as-is.
// =============================================================================

const FOUNDING_COMMUNITIES = Object.freeze([
  {
    id: 'community-beverly',
    name: 'Beverly',
    level: HIERARCHY_LEVELS.ZONE,
    level_label: 'Zone',
    latitude: 41.7153,
    longitude: -87.6723,
    metro: 'Chicago',
  },
  {
    id: 'community-sw-michigan',
    name: 'SW Michigan / Harbor Country',
    level: HIERARCHY_LEVELS.ZONE,
    level_label: 'Zone',
    latitude: 41.8075,
    longitude: -86.6186,
    metro: 'SW Michigan',
  },
  {
    id: 'community-hammond',
    name: 'Hammond',
    level: HIERARCHY_LEVELS.ZONE,
    level_label: 'Zone',
    latitude: 41.5834,
    longitude: -87.5001,
    metro: 'Chicago',
  },
  {
    id: 'community-bronzeville',
    name: 'Bronzeville',
    level: HIERARCHY_LEVELS.ZONE,
    level_label: 'Zone',
    latitude: 41.8231,
    longitude: -87.6177,
    metro: 'Chicago',
  },
  {
    id: 'community-evergreen-park',
    name: 'Evergreen Park',
    level: HIERARCHY_LEVELS.ZONE,
    level_label: 'Zone',
    latitude: 41.7206,
    longitude: -87.7015,
    metro: 'Chicago',
  },
]);

// =============================================================================
// Metro Nodes (Level 4) — Referenced by Highway Corridors
// =============================================================================

const METRO_NODES = Object.freeze([
  { id: 'metro-chicago', name: 'Chicago', level: HIERARCHY_LEVELS.METRO, level_label: 'Metro', latitude: 41.8781, longitude: -87.6298 },
  { id: 'metro-detroit', name: 'Detroit', level: HIERARCHY_LEVELS.METRO, level_label: 'Metro', latitude: 42.3314, longitude: -83.0458 },
  { id: 'metro-milwaukee', name: 'Milwaukee', level: HIERARCHY_LEVELS.METRO, level_label: 'Metro', latitude: 43.0389, longitude: -87.9065 },
  { id: 'metro-minneapolis', name: 'Minneapolis', level: HIERARCHY_LEVELS.METRO, level_label: 'Metro', latitude: 44.9778, longitude: -93.2650 },
  { id: 'metro-st-louis', name: 'St. Louis', level: HIERARCHY_LEVELS.METRO, level_label: 'Metro', latitude: 38.6270, longitude: -90.1994 },
  { id: 'metro-indianapolis', name: 'Indianapolis', level: HIERARCHY_LEVELS.METRO, level_label: 'Metro', latitude: 39.7684, longitude: -86.1581 },
  { id: 'metro-louisville', name: 'Louisville', level: HIERARCHY_LEVELS.METRO, level_label: 'Metro', latitude: 38.2527, longitude: -85.7585 },
  { id: 'metro-nashville', name: 'Nashville', level: HIERARCHY_LEVELS.METRO, level_label: 'Metro', latitude: 36.1627, longitude: -86.7816 },
  { id: 'metro-galesburg', name: 'Galesburg', level: HIERARCHY_LEVELS.METRO, level_label: 'Metro', latitude: 40.9478, longitude: -90.3712 },
  { id: 'metro-sw-michigan', name: 'SW Michigan', level: HIERARCHY_LEVELS.METRO, level_label: 'Metro', latitude: 41.8075, longitude: -86.6186 },
]);

// =============================================================================
// Founding Community Corridors (Level 1 Community)
// The original five corridors. They remain as Level 1 community corridors.
// These represent local community connection patterns, not highway routes.
// =============================================================================

const FOUNDING_CORRIDORS = Object.freeze([
  {
    id: 'corridor-beverly',
    name: 'Beverly Community Corridor',
    origin_node_id: 'community-beverly',
    destination_node_id: 'metro-chicago',
    corridor_signal_class: 'CLASS_B',
    corridor_status: 'HYPOTHESIZED',
    separation_blur_index: null,
    level: HIERARCHY_LEVELS.COMMUNITY,
    route_designation: null,
  },
  {
    id: 'corridor-sw-michigan',
    name: 'SW Michigan / Harbor Country Community Corridor',
    origin_node_id: 'community-sw-michigan',
    destination_node_id: 'metro-sw-michigan',
    corridor_signal_class: 'CLASS_B',
    corridor_status: 'HYPOTHESIZED',
    separation_blur_index: null,
    level: HIERARCHY_LEVELS.COMMUNITY,
    route_designation: null,
  },
  {
    id: 'corridor-hammond',
    name: 'Hammond Community Corridor',
    origin_node_id: 'community-hammond',
    destination_node_id: 'metro-chicago',
    corridor_signal_class: 'CLASS_B',
    corridor_status: 'HYPOTHESIZED',
    separation_blur_index: null,
    level: HIERARCHY_LEVELS.COMMUNITY,
    route_designation: null,
  },
  {
    id: 'corridor-bronzeville',
    name: 'Bronzeville Community Corridor',
    origin_node_id: 'community-bronzeville',
    destination_node_id: 'metro-chicago',
    corridor_signal_class: 'CLASS_B',
    corridor_status: 'HYPOTHESIZED',
    separation_blur_index: null,
    level: HIERARCHY_LEVELS.COMMUNITY,
    route_designation: null,
  },
  {
    id: 'corridor-evergreen-park',
    name: 'Evergreen Park Community Corridor',
    origin_node_id: 'community-evergreen-park',
    destination_node_id: 'metro-chicago',
    corridor_signal_class: 'CLASS_B',
    corridor_status: 'HYPOTHESIZED',
    separation_blur_index: null,
    level: HIERARCHY_LEVELS.COMMUNITY,
    route_designation: null,
  },
]);

// =============================================================================
// Primary Highway Corridors (Level 5 Region)
// All status: HYPOTHESIZED — awaiting validation through event data.
// =============================================================================

const HIGHWAY_CORRIDORS = Object.freeze([
  {
    id: 'corridor-i94-east',
    name: 'Chicago → SW Michigan → Detroit (I-94 East)',
    origin_node_id: 'metro-chicago',
    destination_node_id: 'metro-detroit',
    corridor_signal_class: 'CLASS_B',
    corridor_status: 'HYPOTHESIZED',
    separation_blur_index: null,
    level: HIERARCHY_LEVELS.REGION,
    route_designation: 'I-94 East',
  },
  {
    id: 'corridor-i94-north',
    name: 'Chicago → Milwaukee (I-94 North)',
    origin_node_id: 'metro-chicago',
    destination_node_id: 'metro-milwaukee',
    corridor_signal_class: 'CLASS_B',
    corridor_status: 'HYPOTHESIZED',
    separation_blur_index: null,
    level: HIERARCHY_LEVELS.REGION,
    route_designation: 'I-94 North',
  },
  {
    id: 'corridor-i90-94',
    name: 'Chicago → Minneapolis (I-90/94)',
    origin_node_id: 'metro-chicago',
    destination_node_id: 'metro-minneapolis',
    corridor_signal_class: 'CLASS_B',
    corridor_status: 'HYPOTHESIZED',
    separation_blur_index: null,
    level: HIERARCHY_LEVELS.REGION,
    route_designation: 'I-90/94',
  },
  {
    id: 'corridor-i55',
    name: 'Chicago → St. Louis (I-55)',
    origin_node_id: 'metro-chicago',
    destination_node_id: 'metro-st-louis',
    corridor_signal_class: 'CLASS_B',
    corridor_status: 'HYPOTHESIZED',
    separation_blur_index: null,
    level: HIERARCHY_LEVELS.REGION,
    route_designation: 'I-55',
  },
  {
    id: 'corridor-i65',
    name: 'Chicago → Indianapolis → Louisville → Nashville (I-65)',
    origin_node_id: 'metro-chicago',
    destination_node_id: 'metro-nashville',
    corridor_signal_class: 'CLASS_B',
    corridor_status: 'HYPOTHESIZED',
    separation_blur_index: null,
    level: HIERARCHY_LEVELS.REGION,
    route_designation: 'I-65',
    metadata_json: JSON.stringify({ louisville_status: 'TBD' }),
  },
  {
    id: 'corridor-i88-74',
    name: 'Chicago → Galesburg (I-88/I-74 West)',
    origin_node_id: 'metro-chicago',
    destination_node_id: 'metro-galesburg',
    corridor_signal_class: 'CLASS_B',
    corridor_status: 'HYPOTHESIZED',
    separation_blur_index: null,
    level: HIERARCHY_LEVELS.REGION,
    route_designation: 'I-88/I-74 West',
  },
]);

// =============================================================================
// Exports
// =============================================================================

module.exports = {
  HIERARCHY_LEVELS,
  FOUNDING_COMMUNITIES,
  METRO_NODES,
  FOUNDING_CORRIDORS,
  HIGHWAY_CORRIDORS,
};
