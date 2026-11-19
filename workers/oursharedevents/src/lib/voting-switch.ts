/**
 * The voting kill switch, `VOTING_ENABLED` (OSE-2135, S3c of OSE-1193; OSE
 * ADR-040 decisions 5, 6 and 10).
 *
 * A plain value in each `vars` block of wrangler.toml, like `STREET_MAP`.
 * Exactly "on" turns the public vote surfaces on. "off", no value, a typo or
 * anything else is off. Off is the default in every block: local dev and the
 * test pool, staging and production. Only the owner turns it on, never before
 * the voter page (S4b, OSE-2129) ships (a vote code's redirect needs a page to
 * land on; S3b security review, F4), and
 * `scripts/ci/env-parity.mjs` lists it so that production can be "on" only once
 * staging is (tests/unit/ci/env-parity.test.js).
 *
 * WHAT OFF MEANS. Every public vote surface answers as if voting does not exist:
 *   - the open-objects read (`GET /api/v2/vote/:eventId/objects`) is not routed,
 *     so it gets the router's own 404, byte for byte the answer to a path that
 *     was never there (router.ts);
 *   - the vote `POST /api/v2/vote/:eventId` (S4a, OSE-2128) is not routed
 *     either: the router's own 404, and the handler refuses by itself too;
 *   - `/q` mints no vote pass (S3b, OSE-2133).
 *   Each calls `votingEnabled` below.
 * The admin votables routes (S3) are not switched: a host may set a night up
 * while voting is off, and nothing they do there can count a vote or show one.
 *
 * Read it with `votingEnabled(env)` and nothing else, so the one spelling of
 * "on" lives here.
 */

/** The one value of `VOTING_ENABLED` that turns voting on. Anything else is off. */
export const VOTING_ON = 'on';

export interface VotingSwitchEnv {
  /** The switch: voting is on only when this is exactly `VOTING_ON`. */
  VOTING_ENABLED?: string;
}

/** Is voting on in this environment? Only for exactly "on". */
export function votingEnabled(env: VotingSwitchEnv | null | undefined): boolean {
  return env?.VOTING_ENABLED === VOTING_ON;
}
