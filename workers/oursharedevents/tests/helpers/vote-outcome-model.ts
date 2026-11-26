/**
 * A plain model of the publishing rule (OSE ADR-040 decision 7), for the
 * adversarial simulations (tests/vote-swarm-simulation.spec.ts). The product's
 * rule lives in SQL (src/lib/vote-results.ts, src/lib/vote-crowd.ts); the
 * workers-pool spec tests/vote-outcome-differential.spec.ts checks this model
 * against that SQL on random nights, so the simulations below argue about the
 * rule the product actually runs.
 *
 * A winner needs: distinct voters >= V, and (first up count - second up count)
 * >= T. Otherwise "too close". No tiebreak: a tie is a lead of 0.
 */
export interface Night {
  /** Up counts per object. */
  ups: number[];
  /** "Not for me" counts per object. The rule never reads them. */
  downs?: number[];
  /** Distinct voters on the set. */
  voters: number;
  /** The secret margin, 5 to 9. */
  T: number;
  /** The secret floor, 10 to 14. */
  V: number;
}

export type Outcome = { outcome: 'winner'; index: number } | { outcome: 'too_close' };

export function decide(n: Night): Outcome {
  const order = n.ups.map((u, i) => ({ u, i })).sort((a, b) => b.u - a.u || a.i - b.i);
  const first = order[0]?.u ?? 0;
  const second = order[1]?.u ?? 0;
  if (n.voters >= n.V && first - second >= n.T) return { outcome: 'winner', index: order[0].i };
  return { outcome: 'too_close' };
}

export const T_VALUES = [5, 6, 7, 8, 9] as const;
export const V_VALUES = [10, 11, 12, 13, 14] as const;

/** A small seeded PRNG (mulberry32), so a simulation is the same on every run. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
