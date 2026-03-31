/**
 * Corridors Configuration — Geographic Seed Data
 *
 * Defines founding community corridors (Level 1) and
 * primary highway corridors (Level 5 Region).
 *
 * GROWTH MODEL — Corridors are living structures, not static lines:
 *
 *   SPIDERWEB: Highway corridors branch into sub-corridors at every
 *     intermediate town, school gym, dance studio, park, and venue
 *     along the route. I-94 East spawns dozens of community corridors
 *     between Chicago and Detroit.
 *
 *   FRACTAL: The branching pattern repeats at every hierarchy level.
 *     Level 5 highway corridor → Level 4 metro corridors → Level 3
 *     zone corridors → Level 1 community corridors. Same pattern,
 *     every scale, infinitely.
 *
 *   REVERB: Signal echoes both directions and amplifies. A bocce
 *     tournament in Beverly generates attendance from Evergreen Park
 *     and Hammond. That signal doesn't decay — it compounds as more
 *     events activate more nodes along the corridor.
 *
 * GROWTH SEQUENCE (event verticals activating nodes over time):
 *   Wave 1 (NOW):   Sports leagues, rec nights, bocce, pickup games
 *   Wave 2 (NEXT):  Dance, gymnastics, school-funded gatherings
 *   Wave 3 (LEGAL): Museums, art institutes, school functions
 *                    (requires HIPAA/COPPA clearance)
 *   Wave 4 (SCALE): Every public/private event along the routes as
 *                    corridors span into countryside where people live
 *
 * Schema: See migrations/0010 (base) + 0011 (growth model)
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
// Growth Patterns
// =============================================================================

const GROWTH_PATTERNS = Object.freeze({
  SPIDERWEB: 'SPIDERWEB',   // Branching outward from route into surrounding communities
  FRACTAL: 'FRACTAL',       // Self-similar pattern replicating at smaller scale
  REVERB: 'REVERB',         // Signal echo between connected nodes amplifying engagement
});

// =============================================================================
// Event Verticals — What activates nodes (growth sequence)
// =============================================================================

const EVENT_VERTICALS = Object.freeze({
  // Wave 1 — NOW (no special legal clearance)
  SPORTS: 'sports',               // Bocce, rec leagues, pickup games
  DANCE: 'dance',                 // Dance nights, classes, competitions
  GYMNASTICS: 'gymnastics',       // Gymnastics events, meets
  SCHOOL_FUNDED: 'school_funded', // School-funded community gatherings

  // Wave 2 — RESTRICTED (COPPA compliance required)
  SCHOOL_FUNCTIONS: 'school_functions', // K-12 events, PTA, assemblies
  YOUTH_EVENTS: 'youth_events',         // Under-18 programs

  // Wave 3 — REGULATED (HIPAA/institutional clearance)
  MUSEUMS: 'museums',             // Museum events, gallery openings
  ART_INSTITUTES: 'art_institutes', // Art institute programs
  COMMUNITY_HEALTH: 'community_health', // Health fairs, wellness events

  // Wave 4 — OPEN (general expansion)
  COMMUNITY: 'community',         // General community gatherings
  PRIVATE: 'private',             // Private events, parties, corporate
  PUBLIC: 'public',               // Public festivals, fairs, markets
});

// Legal clearance tiers for event verticals
const LEGAL_CLEARANCE = Object.freeze({
  OPEN: 'OPEN',             // sports, dance, general community
  RESTRICTED: 'RESTRICTED', // school functions, youth events (COPPA)
  REGULATED: 'REGULATED',   // healthcare-adjacent, institutional (HIPAA)
});

// =============================================================================
// Founding Community Nodes (Level 3 Zone)
// The original five communities as geographic nodes.
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
    parent_corridor_id: null,
    growth_pattern: GROWTH_PATTERNS.REVERB,
    reverb_strength: null,
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
    parent_corridor_id: 'corridor-i94-east', // child of I-94 East highway corridor
    growth_pattern: GROWTH_PATTERNS.REVERB,
    reverb_strength: null,
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
    parent_corridor_id: 'corridor-i94-east', // child of I-94 East highway corridor
    growth_pattern: GROWTH_PATTERNS.REVERB,
    reverb_strength: null,
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
    parent_corridor_id: null,
    growth_pattern: GROWTH_PATTERNS.REVERB,
    reverb_strength: null,
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
    parent_corridor_id: null,
    growth_pattern: GROWTH_PATTERNS.REVERB,
    reverb_strength: null,
  },
]);

// =============================================================================
// Ring Candidate Corridors (Inter-Community, same hierarchy level)
// These form the cycle topology required for ring emergence:
//   Beverly ↔ Evergreen Park ↔ Hammond ↔ Beverly (minimum 3-node cycle)
//   Bronzeville connects but may be core or periphery — TBD by data.
//
// A ring is NOT spokes to a hub. It's a cycle: A ↔ B ↔ C ↔ A.
// These corridors exist BETWEEN communities at the same level,
// not between communities and their parent metro.
// =============================================================================

const RING_CANDIDATE_CORRIDORS = Object.freeze([
  // Beverly ↔ Evergreen Park (adjacent south side communities, ~2 miles)
  {
    id: 'corridor-beverly-ep',
    name: 'Beverly ↔ Evergreen Park',
    origin_node_id: 'community-beverly',
    destination_node_id: 'community-evergreen-park',
    corridor_signal_class: 'CLASS_B',
    corridor_status: 'HYPOTHESIZED',
    signal_class: 'SIGNAL_BEHAVIORAL',
    directionality: 'UNKNOWN',
    separation_blur_index: null,
    level: HIERARCHY_LEVELS.ZONE,
    route_designation: null,
    parent_corridor_id: null,
    growth_pattern: GROWTH_PATTERNS.REVERB,
    reverb_strength: null,
    ring_candidate: true,
  },
  // Evergreen Park ↔ Hammond (cross-state, ~15 miles via I-80/I-94)
  {
    id: 'corridor-ep-hammond',
    name: 'Evergreen Park ↔ Hammond',
    origin_node_id: 'community-evergreen-park',
    destination_node_id: 'community-hammond',
    corridor_signal_class: 'CLASS_B',
    corridor_status: 'HYPOTHESIZED',
    signal_class: 'SIGNAL_BEHAVIORAL',
    directionality: 'UNKNOWN',
    separation_blur_index: null,
    level: HIERARCHY_LEVELS.ZONE,
    route_designation: null,
    parent_corridor_id: null,
    growth_pattern: GROWTH_PATTERNS.REVERB,
    reverb_strength: null,
    ring_candidate: true,
  },
  // Hammond ↔ Beverly (closes the 3-node cycle — minimum ring topology)
  {
    id: 'corridor-hammond-beverly',
    name: 'Hammond ↔ Beverly',
    origin_node_id: 'community-hammond',
    destination_node_id: 'community-beverly',
    corridor_signal_class: 'CLASS_B',
    corridor_status: 'HYPOTHESIZED',
    signal_class: 'SIGNAL_BEHAVIORAL',
    directionality: 'UNKNOWN',
    separation_blur_index: null,
    level: HIERARCHY_LEVELS.ZONE,
    route_designation: null,
    parent_corridor_id: null,
    growth_pattern: GROWTH_PATTERNS.REVERB,
    reverb_strength: null,
    ring_candidate: true,
  },
  // Beverly ↔ Bronzeville (connects core candidate to potential periphery)
  {
    id: 'corridor-beverly-bronzeville',
    name: 'Beverly ↔ Bronzeville',
    origin_node_id: 'community-beverly',
    destination_node_id: 'community-bronzeville',
    corridor_signal_class: 'CLASS_B',
    corridor_status: 'HYPOTHESIZED',
    signal_class: 'SIGNAL_BEHAVIORAL',
    directionality: 'UNKNOWN',
    separation_blur_index: null,
    level: HIERARCHY_LEVELS.ZONE,
    route_designation: null,
    parent_corridor_id: null,
    growth_pattern: GROWTH_PATTERNS.REVERB,
    reverb_strength: null,
    ring_candidate: true,
  },
  // Bronzeville ↔ Hammond (potential second ring path)
  {
    id: 'corridor-bronzeville-hammond',
    name: 'Bronzeville ↔ Hammond',
    origin_node_id: 'community-bronzeville',
    destination_node_id: 'community-hammond',
    corridor_signal_class: 'CLASS_B',
    corridor_status: 'HYPOTHESIZED',
    signal_class: 'SIGNAL_BEHAVIORAL',
    directionality: 'UNKNOWN',
    separation_blur_index: null,
    level: HIERARCHY_LEVELS.ZONE,
    route_designation: null,
    parent_corridor_id: null,
    growth_pattern: GROWTH_PATTERNS.REVERB,
    reverb_strength: null,
    ring_candidate: true,
  },
  // SW Michigan connects as periphery (seasonal, unidirectional expected)
  {
    id: 'corridor-beverly-sw-michigan',
    name: 'Beverly ↔ SW Michigan',
    origin_node_id: 'community-beverly',
    destination_node_id: 'community-sw-michigan',
    corridor_signal_class: 'CLASS_B',
    corridor_status: 'HYPOTHESIZED',
    signal_class: 'SIGNAL_BEHAVIORAL',
    directionality: 'UNKNOWN',
    separation_blur_index: null,
    level: HIERARCHY_LEVELS.ZONE,
    route_designation: null,
    parent_corridor_id: 'corridor-i94-east',
    growth_pattern: GROWTH_PATTERNS.REVERB,
    reverb_strength: null,
    ring_candidate: true,
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
    parent_corridor_id: null,
    growth_pattern: GROWTH_PATTERNS.SPIDERWEB,
    reverb_strength: null,
    // Spiderweb: every exit between Chicago and Detroit spawns community
    // corridors — Michigan City, Benton Harbor, Kalamazoo, Ann Arbor, etc.
    // SW Michigan and Hammond founding corridors are already children.
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
    parent_corridor_id: null,
    growth_pattern: GROWTH_PATTERNS.SPIDERWEB,
    reverb_strength: null,
    // Spiderweb: Kenosha, Racine, Waukegan — every town along the lakeshore
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
    parent_corridor_id: null,
    growth_pattern: GROWTH_PATTERNS.SPIDERWEB,
    reverb_strength: null,
    // Spiderweb: Rockford, Madison, Wisconsin Dells, La Crosse, Rochester
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
    parent_corridor_id: null,
    growth_pattern: GROWTH_PATTERNS.SPIDERWEB,
    reverb_strength: null,
    // Spiderweb: Joliet, Bloomington-Normal, Springfield, Litchfield
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
    parent_corridor_id: null,
    growth_pattern: GROWTH_PATTERNS.SPIDERWEB,
    reverb_strength: null,
    metadata_json: JSON.stringify({ louisville_status: 'TBD' }),
    // Spiderweb: Gary, Lafayette, Indianapolis suburbs, Columbus (IN),
    // Louisville (TBD legal), Bowling Green, Nashville suburbs
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
    parent_corridor_id: null,
    growth_pattern: GROWTH_PATTERNS.SPIDERWEB,
    reverb_strength: null,
    // Spiderweb: DeKalb, Dixon, Sterling, Peoria spur — deep countryside
  },
]);

// =============================================================================
// Exports
// =============================================================================

module.exports = {
  HIERARCHY_LEVELS,
  GROWTH_PATTERNS,
  EVENT_VERTICALS,
  LEGAL_CLEARANCE,
  FOUNDING_COMMUNITIES,
  METRO_NODES,
  FOUNDING_CORRIDORS,
  RING_CANDIDATE_CORRIDORS,
  HIGHWAY_CORRIDORS,
};
