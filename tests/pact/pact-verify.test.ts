/**
 * L8 PACT — consumer-driven contract verification (offline).
 *
 * WHY THIS LAYER EXISTS, AND WHY IT IS THE ONE THAT COULD BE BUILT TODAY
 * ---------------------------------------------------------------------
 * The provider snapshots in `workers/oursharedevents/src/api-schema-snapshots/`
 * already protect the API surface: drop a field and the snapshot diff shows it.
 * What a snapshot cannot tell you is WHO BREAKS. It protects every field
 * equally, including fields no consumer has ever read.
 *
 * A pact records the other direction: "I am public.html, and I require
 * `venue`." When a field disappears, the failure names the consumer that
 * loses. That turns a schema diff into a blast-radius answer.
 *
 * Critically, this runs with NO network, NO deployed worker and NO CF Access
 * token — it is a static join between the pacts and the committed provider
 * snapshots. That matters here: the Newman contract tier (T2) has been blocked
 * on a stale service token since 2026-05-19, and T3 is `needs:`-gated on T2, so
 * both have been dark on every trigger for over three months. This layer
 * restores contract coverage that does not depend on credentials being fixed.
 *
 * HOW IT RELATES TO THE TIER ABOVE IT
 * -----------------------------------
 * In the standard pact split, the consumer side generates the contract offline
 * and the provider side verifies it against the running service. That is
 * exactly the shape here: these pacts are the consumer half, and when the CF
 * Access token is restored, Newman becomes their provider verification against
 * the live worker rather than an independent set of assertions. Building this
 * half now is not a workaround for the blocked tier — it is the half that was
 * always supposed to come first.
 *
 * WHAT THIS DOES NOT DO
 * ---------------------
 * Field PRESENCE only. It does not assert semantics. `is_local` being present
 * says nothing about whether it stayed independent of `sponsor_tier` — that is
 * invariant #25's covenant specs, one layer up. A pact that claimed to prove
 * semantics would be the false green this repo keeps finding.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const PACT_DIR = join(HERE, 'pacts');

type Consumer = {
  consumer: string;
  ratified: boolean;
  source: string;
  endpoint: string;
  requires_fields: string[];
  requires_envelope?: string[];
};
type Pact = {
  provider_snapshot: string;
  provider_snapshot_version: string;
  consumers: Consumer[];
};

const pactFiles = readdirSync(PACT_DIR).filter((f) => f.endsWith('.pact.json'));
const pacts: Array<[string, Pact]> = pactFiles.map((f) => [
  f,
  JSON.parse(readFileSync(join(PACT_DIR, f), 'utf8')) as Pact,
]);

const snapshotOf = (p: Pact) => JSON.parse(readFileSync(join(REPO, p.provider_snapshot), 'utf8'));

/**
 * Resolve the provider's field set for an endpoint. Handles both snapshot
 * shapes in this repo: HTTP endpoints keyed under `endpoints`, and the
 * SharedReport interface whose field lists are top-level keys.
 */
function providerFields(snapshot: any, endpoint: string): string[] | null {
  if (endpoint.startsWith('SharedReport.')) {
    const key = endpoint.slice('SharedReport.'.length);
    return Array.isArray(snapshot[key]) ? snapshot[key] : null;
  }
  const ep = snapshot.endpoints?.[endpoint];
  if (!ep) return null;
  return [...(ep.projected_columns ?? []), ...(ep.computed_fields ?? [])];
}

function providerEnvelope(snapshot: any, endpoint: string): string[] | null {
  const ep = snapshot.endpoints?.[endpoint];
  return ep?.envelope_keys ?? null;
}

describe('L8 PACT — consumer-driven contracts vs provider snapshots', () => {
  it('finds at least one pact (an empty pact dir must not pass silently)', () => {
    expect(pactFiles.length).toBeGreaterThan(0);
  });

  describe.each(pacts)('%s', (_file, pact) => {
    const snapshot = snapshotOf(pact);

    // A provider version bump must force re-ratification. Without this, a
    // provider could rev the snapshot, drop a field, and every pact would
    // still be checked against the new reality it never agreed to.
    it('is pinned to the provider snapshot version it was ratified against', () => {
      expect(
        snapshot.version,
        `pact pins provider_snapshot_version=${pact.provider_snapshot_version} but the ` +
          `snapshot is now v${snapshot.version}. Re-read each consumer's source, update ` +
          `requires_fields if what it reads changed, then bump the pin. Do NOT bump the ` +
          `pin alone — that is the review this check exists to force.`
      ).toBe(pact.provider_snapshot_version);
    });

    describe.each(pact.consumers.map((c) => [c.consumer, c] as const))(
      'consumer: %s',
      (_name, c) => {
        it('declares an endpoint the provider actually exposes', () => {
          expect(
            providerFields(snapshot, c.endpoint),
            `consumer "${c.consumer}" pacts against "${c.endpoint}", which does not exist ` +
              `in ${pact.provider_snapshot}. Either the endpoint was removed (the consumer ` +
              `is broken) or the pact names it wrongly (the pact is broken).`
          ).not.toBeNull();
        });

        it('requires only fields the provider still guarantees', () => {
          const fields = providerFields(snapshot, c.endpoint) ?? [];
          const missing = c.requires_fields.filter((f) => !fields.includes(f));
          expect(
            missing,
            `PROVIDER BREAKS CONSUMER "${c.consumer}" (${c.source}): ` +
              `${c.endpoint} no longer guarantees [${missing.join(', ')}]. ` +
              `Either restore the field, or land the consumer change that stops ` +
              `needing it and update this pact in the same PR.`
          ).toEqual([]);
        });

        if (c.requires_envelope) {
          it('requires only envelope keys the provider still returns', () => {
            const env = providerEnvelope(snapshot, c.endpoint);
            if (env === null) return; // interface-shaped snapshot, no envelope
            const missing = (c.requires_envelope ?? []).filter((k) => !env.includes(k));
            expect(
              missing,
              `consumer "${c.consumer}" requires envelope keys [${missing.join(', ')}] ` +
                `that ${c.endpoint} no longer returns.`
            ).toEqual([]);
          });
        }
      }
    );
  });

  // Ratification status is REPORTED, never silently tolerated. An unratified
  // pact is still verified above; this surfaces which obligations the provider
  // declared for itself and no consumer has confirmed.
  it('reports unratified pacts so provider-declared obligations stay visible', () => {
    const unratified = pacts.flatMap(([file, p]) =>
      p.consumers.filter((c) => !c.ratified).map((c) => `${file}:${c.consumer}`)
    );
    // eslint-disable-next-line no-console
    console.log(
      unratified.length
        ? `[pact] UNRATIFIED (provider-declared, consumer has not confirmed): ${unratified.join(', ')}`
        : '[pact] all pacts ratified by their consumers'
    );
    expect(Array.isArray(unratified)).toBe(true);
  });
});
