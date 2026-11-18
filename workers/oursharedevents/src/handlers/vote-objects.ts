/**
 * GET /api/v2/vote/:eventId/objects: what a voter can vote on now (OSE-2135,
 * S3c of OSE-1193; OSE ADR-040 decisions 5 and 7).
 *
 *   200 {"objects": [{"id": "vob_…", "kind": "song", "label": "…"}]}
 *
 * Public and anonymous, for the voter page (S4b). It sits outside
 * `/api/v2/events*`, on the `DB` side. The router routes it only while
 * `VOTING_ENABLED` is on (lib/voting-switch.ts) and wraps it in
 * `publicReadLimited` (lib/public-read-limit.ts); with the switch off the path
 * does not exist.
 *
 * WHAT THE ANSWER CARRIES. One key, `objects`, and each object only `id`,
 * `kind` and `label` (lib/vote-open-objects.ts builds them field by field). No
 * count, no time, no state, nothing about the set, and the same empty list for
 * every reason there is nothing to vote on. It reads no cookie and sets none,
 * and its log line on a failure carries no event id.
 */

import { errorLabel } from '../lib/error-label';
import { listOpenObjects } from '../lib/vote-open-objects';

export interface VoteObjectsEnv {
  DB?: D1Database;
}

/** An event id the read will look up. Anything else answers the empty list. */
const EVENT_ID = /^[A-Za-z0-9_-]{1,128}$/;

const HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
} as const;

export async function handleVoteObjects(
  _request: Request,
  env: VoteObjectsEnv,
  eventId: string
): Promise<Response> {
  if (!EVENT_ID.test(eventId)) return Response.json({ objects: [] }, { headers: HEADERS });
  const db = env.DB;
  if (!db)
    return Response.json(
      { ok: false, status: 503, code: 'DB_NOT_CONFIGURED', error: 'Database not available' },
      { status: 503, headers: HEADERS }
    );
  try {
    const objects = await listOpenObjects(db, eventId);
    return Response.json({ objects }, { headers: HEADERS });
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'DB_ERROR',
        handler: 'handleVoteObjects',
        error: errorLabel(err),
        timestamp: new Date().toISOString(),
      })
    );
    return Response.json(
      { ok: false, status: 503, code: 'DB_ERROR', error: 'The vote list could not be read' },
      { status: 503, headers: HEADERS }
    );
  }
}
