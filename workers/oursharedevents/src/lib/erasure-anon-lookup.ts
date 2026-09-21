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
 */

export interface ErasureAnonLookupEnv {
  FORMS_DB: D1Database;
}

/**
 * Returns the distinct set of anon_ids ever linked to `emailHash` via a form
 * submission (email_signups or form_registrations). Best-effort: query
 * failures propagate to the caller, which treats this as non-fatal to the
 * core email-keyed erasure.
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
    if (row.anonymous_id) anonIds.add(row.anonymous_id);
  }
  return anonIds;
}
