/**
 * Adversarial simulations of the publishing rule (OSE ADR-040 decisions 7 and
 * 13): what an attacker with a given budget of extra votes can and cannot do to
 * a night. Node project, pure and seeded: the same numbers on every run. The
 * rule is the model in tests/helpers/vote-outcome-model.ts, which
 * tests/vote-outcome-differential.spec.ts checks against the product's SQL.
 *
 * The numbers here are the ones in docs/security/THREAT-MODEL-voting-red-blue-2026-11-26.md
 * (section "What the simulations show"). `VOTE_SIM_PRINT=1` prints the tables.
 *
 * Red-team ids: RT-AP-11 (a host's Access Passes boost a song), RT-AP-12
 * (Access Passes bury a winner), RT-RP-04 ("not for me" stuffing), RT-RP-05
 * (a scripted swarm), RT-RP-06 (a tiny night).
 *
 * @born-red decision 13 | method: injected-fault, each removed after: the
 *   model's lead test `>= n.T` changed to `> n.T - 1 - 1` (the tie and the
 *   exhaustive table cases red), ACCESS_PASS_CAP raised to 5 (the tie case
 *   red), the model ranking by up + down (the "not for me" case red); the SQL is
 *   held to the model by tests/vote-outcome-differential.spec.ts |
 *   date: 2026-11-26
 */
import { describe, expect, test } from 'vitest';
import { decide, rng, T_VALUES, V_VALUES, type Night } from './helpers/vote-outcome-model';
import { ACCESS_PASS_CAP } from '../src/lib/vote-access-pass';
import { SECRET_FLOOR_RANGE, SECRET_MARGIN_RANGE } from '../src/lib/vote-sets';

const PRINT = typeof process !== 'undefined' && process.env.VOTE_SIM_PRINT === '1';
const show = (title: string, rows: unknown) => {
  if (PRINT) {
    console.log(`\n${title}`);
    console.table(rows);
  }
};

const winnerIs = (n: Night, i: number) => {
  const o = decide(n);
  return o.outcome === 'winner' && o.index === i;
};

describe('the model uses the product ranges', () => {
  test('T is 5 to 9 and V is 10 to 14, as lib/vote-sets.ts draws them', () => {
    expect([...SECRET_MARGIN_RANGE]).toEqual([T_VALUES[0], T_VALUES[T_VALUES.length - 1]]);
    expect([...SECRET_FLOOR_RANGE]).toEqual([V_VALUES[0], V_VALUES[V_VALUES.length - 1]]);
  });
});

describe('RT-AP-11: a host stacks Access Passes to push a song', () => {
  test(`from a tie or from behind, ${ACCESS_PASS_CAP} passes can never make a winner, for every T, V and room size`, () => {
    for (const T of T_VALUES)
      for (const V of V_VALUES)
        for (let a = 0; a <= 60; a++)
          for (let behind = 0; behind <= 10; behind++) {
            const b = Math.max(0, a - behind);
            const n: Night = { ups: [a, b + ACCESS_PASS_CAP], voters: 200, T, V };
            // B started level or behind A: the passes alone never carry it.
            expect(winnerIs(n, 1), `T=${T} a=${a} b=${b}`).toBe(false);
          }
  });

  test('the cap is below the smallest margin: that is what makes the tie case hold', () => {
    expect(ACCESS_PASS_CAP).toBeLessThan(SECRET_MARGIN_RANGE[0]);
  });

  test('from a lead of L, the chance that the passes carry it over the line is the share of T at most L + cap', () => {
    const rows = [];
    for (let L = 1; L < 9; L++) {
      let flips = 0;
      for (const T of T_VALUES) {
        const before = winnerIs({ ups: [20, 20 + L], voters: 200, T, V: 10 }, 1);
        const after = winnerIs({ ups: [20, 20 + L + ACCESS_PASS_CAP], voters: 200, T, V: 10 }, 1);
        if (!before && after) flips++;
      }
      const expected = T_VALUES.filter((T) => L < T && L + ACCESS_PASS_CAP >= T).length;
      expect(flips).toBe(expected);
      rows.push({ lead: L, 'chance the passes decide it': `${flips} in 5` });
    }
    show(`RT-AP-11: ${ACCESS_PASS_CAP} passes on a song already leading by L`, rows);
    // The worst case is a lead of 4: four of the five values of T.
    expect(Math.max(...rows.map((r) => Number(r['chance the passes decide it'][0])))).toBe(4);
  });
});

describe('RT-AP-12: Access Passes used to bury a winner', () => {
  test('passes for the runner-up can turn a narrow win into "too close"; never into a win for the runner-up', () => {
    for (const T of T_VALUES)
      for (let L = T; L <= T + 20; L++) {
        const n: Night = { ups: [30 + L, 30 + ACCESS_PASS_CAP], voters: 200, T, V: 10 };
        const o = decide(n);
        const buried = L - ACCESS_PASS_CAP < T;
        expect(o.outcome === 'too_close', `T=${T} L=${L}`).toBe(buried);
        expect(winnerIs(n, 1)).toBe(false);
      }
  });
});

describe('RT-RP-04: "not for me" stuffing', () => {
  test('any number of "not for me" votes never changes a result: the rule reads up counts only', () => {
    const r = rng(404);
    for (let i = 0; i < 5000; i++) {
      const ups = [Math.floor(r() * 40), Math.floor(r() * 40), Math.floor(r() * 40)];
      const T = T_VALUES[Math.floor(r() * 5)];
      const V = V_VALUES[Math.floor(r() * 5)];
      const voters = 5 + Math.floor(r() * 60);
      // Any number of "not for me" votes, on any object, up to 1,000 each.
      const downs = ups.map(() => Math.floor(r() * 1000));
      expect(decide({ ups, downs, voters, T, V })).toEqual(decide({ ups, voters, T, V }));
    }
  });
});

describe('RT-RP-05: a scripted swarm of extra voters', () => {
  test('from a tie, s extra votes win with chance (#T <= s)/5, and 9 always win: the room cannot be protected by T alone', () => {
    const rows = [];
    for (let s = 0; s <= 10; s++) {
      let wins = 0;
      for (const T of T_VALUES)
        if (winnerIs({ ups: [15, 15 + s], voters: 200, T, V: 10 }, 1)) wins++;
      expect(wins).toBe(T_VALUES.filter((T) => s >= T).length);
      rows.push({ 'extra votes': s, 'chance of a win from a tie': `${wins} in 5` });
    }
    show('RT-RP-05: a swarm from a tie', rows);
  });

  test('Monte Carlo, a room of 40 with a small honest lean: chance a budget of b extra votes changes the result', () => {
    const r = rng(2026);
    const trials = 4000;
    const budgets = [0, 4, 10, 20, 50];
    const rows = budgets.map((b) => {
      let changed = 0;
      for (let t = 0; t < trials; t++) {
        // Each of 40 people backs A with 0.55, else B; T and V drawn as the product does.
        let a = 0;
        let bb = 0;
        for (let p = 0; p < 40; p++) r() < 0.55 ? a++ : bb++;
        const T = T_VALUES[Math.floor(r() * 5)];
        const V = V_VALUES[Math.floor(r() * 5)];
        const honest = decide({ ups: [a, bb], voters: 40, T, V });
        const attacked = decide({ ups: [a, bb + b], voters: 40 + b, T, V });
        if (JSON.stringify(honest) !== JSON.stringify(attacked)) changed++;
      }
      return {
        budget: b,
        'result changed': `${((100 * changed) / trials).toFixed(1)}%`,
        p: changed / trials,
      };
    });
    show('RT-RP-05: room of 40, lean 55/45, attacker backs B', rows);
    expect(rows[0].p).toBe(0);
    // More extra votes never make the attack less likely to change the result.
    for (let i = 1; i < rows.length; i++) expect(rows[i].p).toBeGreaterThanOrEqual(rows[i - 1].p);
    // The Access Pass cap's reach is far smaller than a swarm's.
    expect(rows[1].p).toBeLessThan(rows[3].p);
    expect(rows[4].p).toBeGreaterThan(0.9);
  });
});

describe('RT-RP-06: a tiny night', () => {
  test('below V nothing is published, whatever the lead; V + T extra browsers decide a night with nobody else in it', () => {
    for (const T of T_VALUES)
      for (const V of V_VALUES) {
        expect(decide({ ups: [V - 1, 0], voters: V - 1, T, V }).outcome).toBe('too_close');
        expect(winnerIs({ ups: [0, Math.max(T, V)], voters: Math.max(T, V), T, V }, 1)).toBe(true);
      }
    // 14 browsers always decide an empty room: the room-size check (OSE-2234,
    // PR #1562) is what flags it, and the house rule card says so.
    expect(Math.max(...V_VALUES, ...T_VALUES)).toBe(14);
  });
});
