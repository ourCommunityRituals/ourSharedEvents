/**
 * OSE-1350 — the ONE sanctioned "who ↔ anon_id" correlation seam.
 *
 * ADR-001 / OSE-798 doctrine ("never-who"): no file may read a FORMS_DB
 * identity column (email, anonymous_id, ...) while also touching a main-DB
 * scan table — that combination is the structural join the P5 static gate
 * (tests/anti-logging-proof.spec.ts) forbids, because it's exactly the shape
 * of a de-anonymization pipeline.
 *
 * GDPR Art. 17 / CCPA §1798.105 erasure is a legitimate, narrow exception:
 * to purge a data subject's anon-ID-linked scan/report rows, something has to
 * read the one place email and anon_id are ever recorded together
 * (email_signups.anonymous_id / form_registrations.anonymous_id — written at
 * submission time). This file is that single, narrowly-scoped chokepoint —
 * it touches ONLY FORMS_DB tables and returns anon_ids as data, never SQL.
 * It deliberately contains NO reference to any main-DB scan table, so the P5
 * gate's file-level check never fires here. The caller (src/handlers/data-subject.ts)
 * takes the returned anon_ids and performs the main-DB deletes itself, in a
 * separate file that never re-reads a FORMS_DB identity column — keeping the
 * two DBs' file-level correlation surface disjoint everywhere except this one
 * function, which exists solely to serve an erasure request already validated
 * and authenticated by the caller.
 *
 * WHAT THIS CAN STILL FIND (2026-10-07). The form handlers no longer store the
 * raw anonymous id. They store a per-event keyed id (lib/event-anon-key.ts),
 * which equals nothing in the main DB and cannot be turned back into the
 * cookie value, and forms migration 0016 cleared the raw values stored before
 * that. So for every row written since, this lookup returns nothing, and
 * erasure by email cannot reach the main-DB scan and returns tables: that
 * link is exactly what was removed. Keyed ids are skipped here rather
 * than handed to the caller, so the audit record never counts a "linked"
 * anonymous id that could not match a scan row. Only a raw value still on a
 * row (a database the scrub has not reached) is returned.
 */

import { isEventAnonKey } from './event-anon-key';

export interface ErasureAnonLookupEnv {
  FORMS_DB: D1Database;
}

/**
 * Returns the distinct set of raw anon_ids still linked to `emailHash` via a
 * form submission (email_signups or form_registrations) — see "WHAT THIS CAN
 * STILL FIND" above: empty for every row written with a per-event keyed id.
 * Best-effort: query failures propagate to the caller, which treats this as
 * non-fatal to the core email-keyed erasure.
 */
export async function findAnonIdsLinkedToEmailHash(
  env: ErasureAnonLookupEnv,
  emailHash: string
): Promise<Set<string>> {
  const anonIds = new Set<string>();
  const rows = await env.FORMS_DB.prepare(
    `SELECT DISTINCT anonymous_id FROM email_signups
       WHERE email_hash = ? AND anonymous_id IS NOT NULL
     UNION
     SELECT DISTINCT anonymous_id FROM form_registrations
       WHERE attendee_email_hash = ? AND anonymous_id IS NOT NULL`
  )
    .bind(emailHash, emailHash)
    .all<{ anonymous_id: string }>();
  for (const row of rows.results ?? []) {
    // A per-event keyed id is not an anonymous id: it matches no main-DB row.
    if (row.anonymous_id && !isEventAnonKey(row.anonymous_id)) anonIds.add(row.anonymous_id);
  }
  return anonIds;
}
