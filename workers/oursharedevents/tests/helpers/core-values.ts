/**
 * OSE-1560 — leaving draft needs a start time and an event type. Specs that seed
 * a row straight into D1 and then walk it through the lifecycle give it both
 * here, so they keep testing the transition and not the core-values refusal
 * (which tests/tdd-red-fe-wave.spec.ts covers).
 */
export async function giveCoreValues(db: D1Database, id: string): Promise<void> {
  await db
    .prepare(
      `UPDATE events
          SET starts_at = COALESCE(starts_at, '2027-06-01T23:00:00.000Z'),
              event_type_id = COALESCE(event_type_id, (SELECT id FROM event_type_registry LIMIT 1))
        WHERE id = ?`
    )
    .bind(id)
    .run();
}
