/**
 * NCR Coverage — Midwest Region (HOME REGION)
 * Assembles East North Central + West North Central
 * States: IL, IN, MI, OH, WI, IA, KS, MN, MO, NE, ND, SD
 *
 * Split into two files for manageability:
 * - midwest-enc.js (IL, IN, MI, OH, WI)
 * - midwest-wnc.js (IA, KS, MN, MO, NE, ND, SD)
 *
 * @module config/ncr-regions/midwest
 */

const enc = require('./midwest-enc');
const wnc = require('./midwest-wnc');

const territories = Object.freeze([...(enc.territories || []), ...(wnc.territories || [])]);

const states = Object.freeze([...(enc.states || []), ...(wnc.states || [])]);

const nodes = Object.freeze([...enc.nodes, ...wnc.nodes]);

module.exports = { territories, states, nodes };
