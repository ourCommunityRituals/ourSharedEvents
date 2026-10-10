/**
 * An event archived before its day never happened, so its public page must not
 * say it did.
 *
 * The phase resolver puts every archived event in post_event, and the recap
 * read "Happened <date>" with "This one's a wrap" on top, even when the date was
 * three weeks away: the organizer had taken it down early. The rule now:
 *
 *   - archived, start still to come: the same recap-shaped page (nothing to
 *     join), but it says "No longer taking place. It was planned for <date>",
 *     and shows no "By the numbers" card, whose counts would read as a turnout;
 *   - archived, start passed: unchanged ("Happened <date>", numbers as before).
 *
 * "Start" is the same instant every surface uses (eventPhaseOf): starts_at for a
 * timed event, local midnight in the event's zone for a date-only one.
 *
 * @born-red method: the page blocks below ran against the pre-change renderer;
 * the three "called off" tests failed on "Happened" / the wrap chip / the
 * numbers card, the "happened" guards passed on both.
 */
import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { archivedBeforeStart } from '../src/lib/archived-before-start';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}
const E = env as unknown as TestEnv;
const BRAND = 'archived-before-start';

async function applyAll(db: D1Database, statementsJson: string): Promise<void> {
  for (const stmt of JSON.parse(statementsJson) as string[]) {
    try {
      await db.prepare(stmt).run();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (
        m.includes('duplicate column name') ||
        m.includes('already exists') ||
        m.includes('no such column')
      ) {
        continue;
      }
      throw e;
    }
  }
}

beforeAll(async () => {
  await applyAll(E.DB, E.TEST_MIGRATION_STATEMENTS);
  await applyAll(E.FORMS_DB, E.TEST_FORMS_MIGRATION_STATEMENTS);
});

const DAY = 86_400_000;
const dateIn = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

/** One archived, listed event, with a check-in count well over the floor. */
async function seed(
  id: string,
  opts: { startDate: string; startsAt?: string | null; timezone?: string | null }
): Promise<void> {
  await E.DB.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
  await E.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, is_published, location,
                         start_date, starts_at, timezone, what_short, listed_from,
                         created_at, updated_at)
     VALUES (?, ?, ?, ?, 'archived', 1, 'Eagles Hall', ?, ?, ?, 'A community gathering.',
             ?, datetime('now'), datetime('now'))`
  )
    .bind(
      id,
      BRAND,
      `Event ${id}`,
      id,
      opts.startDate,
      opts.startsAt ?? null,
      opts.timezone ?? null,
      new Date(Date.now() - 2 * DAY).toISOString()
    )
    .run();
  await E.FORMS_DB.prepare('DELETE FROM checkin_counts WHERE event_id = ?').bind(id).run();
  await E.FORMS_DB.prepare(
    'INSERT INTO checkin_counts (id, event_id, total_count) VALUES (?, ?, 12)'
  )
    .bind(`cc-${id}`, id)
    .run();
}

async function page(id: string): Promise<{ status: number; html: string }> {
  const res = await SELF.fetch(`https://localhost/events/${id}`);
  return { status: res.status, html: await res.text() };
}

function whenLine(html: string): string {
  const m = /data-testid="event-when-post"[^>]*>([^<]*)</.exec(html);
  expect(m, 'the recap date line renders').not.toBeNull();
  return m![1]!;
}

describe('archived before its day: the page does not say it happened', () => {
  test('timed, three weeks out (the organizer journey): "No longer taking place", never "Happened"', async () => {
    const day = dateIn(21);
    await seed('abs-timed-future', {
      startDate: day,
      startsAt: `${day}T23:30:00.000Z`,
      timezone: 'America/Chicago',
    });
    const { status, html } = await page('abs-timed-future');
    expect(status).toBe(200);
    const line = whenLine(html);
    expect(line).toMatch(/^No longer taking place\. It was planned for /);
    expect(line).toContain('Eagles Hall');
    expect(html).not.toContain('Happened');
    expect(html).not.toContain("This one's a wrap");
    expect(html).toContain('data-testid="event-phase-chip">Not happening<');
  });

  test('date-only, a week out: same words', async () => {
    await seed('abs-date-future', { startDate: dateIn(7) });
    const { html } = await page('abs-date-future');
    expect(whenLine(html)).toMatch(/^No longer taking place\. It was planned for /);
    expect(html).not.toContain('Happened');
  });

  test('no "By the numbers": counts would read as a turnout for an event that was not held', async () => {
    await seed('abs-numbers-future', { startDate: dateIn(7) });
    const { html } = await page('abs-numbers-future');
    expect(html).not.toContain('data-testid="event-stats-card"');
    expect(html).not.toContain('By the numbers');
    expect(html).not.toContain('The numbers below are the story');
  });

  test('still the recap shape: no register or check-in on a page for an event that is off', async () => {
    await seed('abs-shape-future', { startDate: dateIn(7) });
    const { html } = await page('abs-shape-future');
    expect(html).toContain('data-testid="event-main-post"');
    expect(html).not.toContain('data-testid="event-rsvp"');
    expect(html).not.toContain('data-testid="event-checkin"');
  });
});

describe('guard: an archived event whose date has passed reads as before', () => {
  test('date-only, a week ago: "Happened <date>" and the wrap chip', async () => {
    await seed('abs-date-past', { startDate: dateIn(-7) });
    const { status, html } = await page('abs-date-past');
    expect(status).toBe(200);
    expect(whenLine(html)).toMatch(/^Happened /);
    expect(html).toContain("This one's a wrap");
    expect(html).not.toContain('No longer taking place');
  });

  test('timed, a week ago: "Happened" and its numbers still show', async () => {
    const day = dateIn(-7);
    await seed('abs-timed-past', {
      startDate: day,
      startsAt: `${day}T23:30:00.000Z`,
      timezone: 'America/Chicago',
    });
    const { html } = await page('abs-timed-past');
    expect(whenLine(html)).toMatch(/^Happened /);
    expect(html).toContain('data-testid="event-stats-card"');
  });
});

describe('archivedBeforeStart: the start is read in the event zone, as every surface reads it', () => {
  const archived = { status: 'archived', end_date: null };

  test('date-only: before local midnight in the event zone is before; after is not', () => {
    const row = {
      ...archived,
      start_date: '2026-10-24',
      starts_at: null,
      timezone: 'America/Chicago',
    };
    // 04:00Z on the 24th is 23:00 on the 23rd in Chicago (CDT, UTC-5).
    expect(archivedBeforeStart(row, new Date('2026-10-24T04:00:00Z'))).toBe(true);
    // 06:00Z is 01:00 on the 24th in Chicago: the day has begun.
    expect(archivedBeforeStart(row, new Date('2026-10-24T06:00:00Z'))).toBe(false);
  });

  test('timed: the start is starts_at', () => {
    const row = {
      ...archived,
      start_date: '2026-10-24',
      starts_at: '2026-10-24T23:30:00.000Z',
      timezone: 'America/Chicago',
    };
    expect(archivedBeforeStart(row, new Date('2026-10-24T23:00:00Z'))).toBe(true);
    expect(archivedBeforeStart(row, new Date('2026-10-24T23:45:00Z'))).toBe(false);
  });

  test('only archived events; an archived event with no date is never called off', () => {
    const now = new Date('2026-10-01T00:00:00Z');
    const future = { start_date: '2026-10-24', end_date: null, starts_at: null, timezone: null };
    expect(archivedBeforeStart({ ...future, status: 'active' }, now)).toBe(false);
    expect(archivedBeforeStart({ ...future, status: 'draft' }, now)).toBe(false);
    expect(archivedBeforeStart({ ...future, status: 'ARCHIVED' }, now)).toBe(true);
    expect(archivedBeforeStart({ status: 'archived', start_date: null, end_date: null }, now)).toBe(
      false
    );
  });
});
