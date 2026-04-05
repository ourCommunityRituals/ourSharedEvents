/**
 * NCR Coverage Map — Full United States
 *
 * Assembles all regional chunks into one unified coverage map.
 * Chunked by Census division, batched by agent, assembled here.
 *
 * Hierarchy:
 *   Level 7 (Network)    → 1 node  (ourSharedEvents US)
 *   Level 6 (Territory)  → 9 nodes (Census divisions)
 *   Level 5 (Region)     → 50+ nodes (states + DC + territories)
 *   Level 4 (Metro)      → ~330 nodes (cities 100k+)
 *   Level 3 (Zone)       → ~500+ nodes (cities 25k-100k, key communities)
 *   Level 2-1            → Emerge organically from events (not pre-seeded nationally)
 *
 * Midwest corridor detail (Level 1-2) is in config/corridors.js
 * and the agent-generated corridor data.
 *
 * Schema: workers/oursharedevents/migrations/0010 + 0011
 * ADR: docs/adr/ADR-009-ncr-v2-geographic-hierarchy.md
 *
 * @module config/ncr-regions
 */

const northeast = require('./northeast');
const south = require('./south');
const midwest = require('./midwest');
const west = require('./west');
const usTerritories = require('./territories');

// =============================================================================
// Level 7 — Network Root
// =============================================================================

const NETWORK = Object.freeze({
  id: 'network-us',
  name: 'ourSharedEvents US Network',
  level: 7,
  level_label: 'Network',
});

// =============================================================================
// Assemble all regions
// =============================================================================

const ALL_TERRITORIES = Object.freeze([
  ...northeast.territories,
  ...south.territories,
  ...midwest.territories,
  ...west.territories,
  ...usTerritories.territories,
]);

const ALL_STATES = Object.freeze([
  ...northeast.states,
  ...south.states,
  ...midwest.states,
  ...west.states,
  ...usTerritories.states,
]);

const ALL_NODES = Object.freeze([
  ...northeast.nodes,
  ...south.nodes,
  ...midwest.nodes,
  ...west.nodes,
  ...usTerritories.nodes,
]);

// =============================================================================
// Stats
// =============================================================================

function getCoverageStats() {
  const level4 = ALL_NODES.filter((n) => n.level === 4);
  const level3 = ALL_NODES.filter((n) => n.level === 3);
  const states = new Set(ALL_NODES.map((n) => n.state));

  return {
    network: 1,
    territories: ALL_TERRITORIES.length,
    states: ALL_STATES.length,
    metros_level4: level4.length,
    zones_level3: level3.length,
    total_nodes: ALL_NODES.length,
    states_covered: [...states].sort(),
  };
}

// =============================================================================
// Exports
// =============================================================================

module.exports = {
  NETWORK,
  ALL_TERRITORIES,
  ALL_STATES,
  ALL_NODES,
  getCoverageStats,

  // Individual regions for targeted queries
  northeast,
  south,
  midwest,
  west,
  usTerritories,
};
