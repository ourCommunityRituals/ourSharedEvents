/**
 * A list of fewer than 5 people is withheld, for the organizer's own event too
 * (OSE-2087; owner ruling 2026-11-16: "no exceptions" reaches the lists).
 *
 * Until that day four admin routes handed back rows whatever their number, on
 * the ground that the organizer holds every row: the registrations list, the
 * surveys list, the forms export and the registrant contacts. Rows are a
 * count: three rows say "three", and name them. Now each route returns no row
 * while its list is under the floor, and the same `{ count: null, suppressed:
 * true }` a withheld count carries.
 *
 * Each route is held three ways:
 *   - under the floor: no row, no name, no email, no count;
 *   - neighbours: an event with none and one with 4 answer the same, byte for
 *     byte (bar the event id), so nothing tells 0 from 1 to 4;
 *   - control: at 5 the rows come back, or the gate proves nothing.
 *
 * Placement: workers pool (real routes over D1, with the admin guard).
 *
 * @born-red OSE-2087 | method: written beside the change and run with
 *   src/handlers/forms.ts as on main at f62fb82. Red 22 of 25: every "under
 *   the floor" and "neighbours" case (rows, names and emails came back; an
 *   empty event and one with 4 differed), and the contacts and export controls,
 *   whose old answers carried no `suppressed` field. The two list controls and
 *   the CSV control passed | date: 2026-11-16
 */
import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, test } from 'vitest';
import { encryptEmail, encryptText } from '../src/lib/pii';
import { CORE_VALUES } from './helpers/core-values';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  FORMS_ENCRYPTION_KEY: string;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}
const tenv = env as unknown as TestEnv;
const ADMIN = { Authorization: 'Bearer test-admin-key-e2e-2026' };
const NAMES = ['Ada', 'Ben', 'Cy', 'Dee', 'Eli', 'Fay', 'Gus'];

beforeAll(async () => {
  const run = async (db: D1Database, json: string) => {
    for (const stmt of JSON.parse(json) as string[]) {
      try {
        await db.prepare(stmt).run();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('duplicate column name')) continue;
        throw e;
      }
    }
  };
  await run(tenv.DB, tenv.TEST_MIGRATION_STATEMENTS);
  await run(tenv.FORMS_DB, tenv.TEST_FORMS_MIGRATION_STATEMENTS);
});

async function createEvent(title: string): Promise<string> {
  const res = await SELF.fetch('https://t.test/api/v2/admin/events', {
    method: 'POST',
    headers: { ...ADMIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      attendance_mode: 'in_person',
      location: 'Hall',
      title,
      status: 'active',
      ...CORE_VALUES,
    }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** `n` registrations, each with a name and an email the organizer could read. */
async function seedRegistrations(eventId: string, n: number) {
  const key = tenv.FORMS_ENCRYPTION_KEY;
  for (let i = 0; i < n; i++) {
    await tenv.FORMS_DB.prepare(
      `INSERT INTO form_registrations
         (id, event_id, registration_bucket, status, attendee_email_hash,
          attendee_name_encrypted, attendee_email_encrypted)
       VALUES (?, ?, 'bucket-a', 'confirmed', ?, ?, ?)`
    )
      .bind(
        crypto.randomUUID(),
        eventId,
        crypto.randomUUID(),
        await encryptText(NAMES[i], key),
        await encryptText(`${NAMES[i].toLowerCase()}@example.org`, key)
      )
      .run();
  }
}
async function seedSurveys(eventId: string, n: number) {
  for (let i = 0; i < n; i++) {
    await tenv.FORMS_DB.prepare(
      `INSERT INTO form_surveys (id, event_id, responses_json, submitted_bucket, pii_scrubbed)
       VALUES (?, ?, ?, 'bucket-a', 1)`
    )
      .bind(crypto.randomUUID(), eventId, JSON.stringify({ rating: 5, note: `answer-${i}` }))
      .run();
  }
}
async function seedSignups(eventId: string, n: number) {
  for (let i = 0; i < n; i++) {
    await tenv.FORMS_DB.prepare(
      `INSERT INTO email_signups
         (id, event_id, email_hash, email_encrypted, signup_bucket, retention_expires_at)
       VALUES (?, ?, ?, ?, '2026-11', '2099-01-01T00:00:00.000Z')`
    )
      .bind(
        crypto.randomUUID(),
        eventId,
        crypto.randomUUID(),
        await encryptEmail(`signup${i}@example.org`, tenv.FORMS_ENCRYPTION_KEY)
      )
      .run();
  }
}

async function get(eventId: string, path: string): Promise<Response> {
  const res = await SELF.fetch(`https://t.test/api/v2/admin/events/${eventId}/forms/${path}`, {
    headers: ADMIN,
  });
  expect(res.status, path).toBe(200);
  return res;
}
/** The answer as text with the event's own id taken out, to compare two events. */
async function text(eventId: string, path: string): Promise<string> {
  return (await (await get(eventId, path)).text()).split(eventId).join('EVENT');
}

const PERSONAL = /Ada|Ben|Cy\b|Dee|example\.org|answer-\d|signup\d/;
const WITHHELD = { count: null, suppressed: true, floor: 5 };

type Seed = (eventId: string, n: number) => Promise<void>;
const ROUTES: [name: string, path: string, seed: Seed, hasCount: boolean][] = [
  ['registrations list', 'registrations', seedRegistrations, true],
  ['surveys list', 'surveys', seedSurveys, true],
  ['registrant contacts', 'contacts', seedRegistrations, false],
  ['export: registrations', 'export?type=registrations', seedRegistrations, true],
  ['export: surveys', 'export?type=surveys', seedSurveys, true],
  ['export: email sign-ups', 'export?type=email-signups', seedSignups, true],
];

describe.each(ROUTES)('OSE-2087 | %s', (_name, path, seed, hasCount) => {
  test('4 rows: no row, no name, no email, no count', async () => {
    const id = await createEvent(`Roster under ${path}`);
    await seed(id, 4);
    const res = await get(id, path);
    const raw = await res.clone().text();
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.items).toEqual([]);
    expect(body.suppressed).toBe(true);
    expect(body.floor).toBe(5);
    if (hasCount) expect(body.count).toBeNull();
    expect(raw).not.toMatch(PERSONAL);
    expect(raw).not.toMatch(/"(count|total|length|decrypt_failed)":\s*[1-4]\b/);
  });

  test('neighbours: an event with none and one with 4 answer the same', async () => {
    const none = await createEvent(`Roster none ${path}`);
    const four = await createEvent(`Roster four ${path}`);
    await seed(four, 4);
    expect(await text(four, path)).toBe(await text(none, path));
  });

  test('control: at 5 the rows come back', async () => {
    const id = await createEvent(`Roster five ${path}`);
    await seed(id, 5);
    const body = (await (await get(id, path)).json()) as Record<string, unknown>;
    expect((body.items as unknown[]).length).toBe(5);
    expect(body.suppressed).toBe(false);
    if (hasCount) expect(body.count).toBe(5);
  });
});

describe('OSE-2087 | the CSV download says it in words', () => {
  test.each([
    ['registrations', 'registrations', seedRegistrations],
    ['surveys', 'survey answers', seedSurveys],
    ['email-signups', 'email sign-ups', seedSignups],
  ] as [string, string, Seed][])(
    '%s: under 5, one line of words and no row',
    async (type, noun, seed) => {
      const id = await createEvent(`Roster csv ${type}`);
      await seed(id, 4);
      const res = await get(id, `export?type=${type}&format=csv`);
      expect(res.headers.get('X-OSE-Withheld')).toBe('true');
      const csv = await res.text();
      expect(csv).toContain(
        `Fewer than 5 ${noun}. The list is withheld until there are 5 or more.`
      );
      expect(csv).not.toMatch(PERSONAL);
      expect(csv.trim().split('\n')).toHaveLength(2);
    }
  );

  test('neighbours: the file for an empty event is the file for one with 4', async () => {
    const none = await createEvent('Roster csv none');
    const four = await createEvent('Roster csv four');
    await seedRegistrations(four, 4);
    const path = 'export?type=registrations&format=csv';
    expect(await text(four, path)).toBe(await text(none, path));
  });

  test('control: at 5 the file holds the rows and no withheld mark', async () => {
    const id = await createEvent('Roster csv five');
    await seedRegistrations(id, 5);
    const res = await get(id, 'export?type=registrations&format=csv');
    expect(res.headers.get('X-OSE-Withheld')).toBeNull();
    const csv = await res.text();
    expect(csv).toContain('Ada');
    expect(csv.trim().split('\n')).toHaveLength(6);
  });
});

describe('OSE-2087 | the registrations list follows its count', () => {
  test('withheld: there is no next page to walk', async () => {
    const id = await createEvent('Roster paging');
    await seedRegistrations(id, 4);
    const body = (await (await get(id, 'registrations?limit=2')).json()) as Record<string, unknown>;
    expect(body.items).toEqual([]);
    expect(body.next_cursor).toBeNull();
    expect({ count: body.count, suppressed: body.suppressed, floor: body.floor }).toEqual(WITHHELD);
  });

  test('5 rows of which only 4 are counted (one past its retention date): still withheld', async () => {
    const id = await createEvent('Roster expired');
    await seedRegistrations(id, 5);
    await tenv.FORMS_DB.prepare(
      `UPDATE form_registrations SET expires_at = '2020-01-01 00:00:00'
        WHERE id = (SELECT id FROM form_registrations WHERE event_id = ? LIMIT 1)`
    )
      .bind(id)
      .run();
    const body = (await (await get(id, 'registrations')).json()) as Record<string, unknown>;
    expect(body.items).toEqual([]);
    expect(body.suppressed).toBe(true);
  });

  // Found in review, 2026-11-16: the export and the contacts each withheld by
  // their own row count, so with 5 rows of which 3 are counted the list was
  // withheld while the export and the contacts handed over all 5 names.
  describe('what is read from registrations is withheld whenever the list is', () => {
    async function fiveRowsThreeCounted(title: string): Promise<string> {
      const id = await createEvent(title);
      await seedRegistrations(id, 5);
      await tenv.FORMS_DB.prepare(
        `UPDATE form_registrations SET expires_at = '2020-01-01 00:00:00'
          WHERE id IN (SELECT id FROM form_registrations WHERE event_id = ? LIMIT 2)`
      )
        .bind(id)
        .run();
      return id;
    }

    test('the list itself is withheld (the case the others must follow)', async () => {
      const id = await fiveRowsThreeCounted('Roster three of five: list');
      const body = (await (await get(id, 'registrations')).json()) as Record<string, unknown>;
      expect(body.items).toEqual([]);
      expect(body.suppressed).toBe(true);
    });

    test('the JSON export gives no row', async () => {
      const id = await fiveRowsThreeCounted('Roster three of five: export');
      const res = await get(id, 'export?type=registrations');
      const text = await res.text();
      const body = JSON.parse(text) as Record<string, unknown>;
      expect(body.items).toEqual([]);
      expect({ count: body.count, suppressed: body.suppressed, floor: body.floor }).toEqual(
        WITHHELD
      );
      for (const name of NAMES) expect(text).not.toContain(name);
    });

    test('the CSV export says so in words and names no one', async () => {
      const id = await fiveRowsThreeCounted('Roster three of five: csv');
      const res = await get(id, 'export?type=registrations&format=csv');
      expect(res.headers.get('X-OSE-Withheld')).toBe('true');
      const text = await res.text();
      expect(text).toContain('Fewer than 5 registrations');
      for (const name of NAMES) expect(text).not.toContain(name);
    });

    test('the contacts give no name and no email', async () => {
      const id = await fiveRowsThreeCounted('Roster three of five: contacts');
      const res = await get(id, 'contacts');
      const text = await res.text();
      const body = JSON.parse(text) as Record<string, unknown>;
      expect(body.items).toEqual([]);
      expect(body.suppressed).toBe(true);
      expect(text).not.toContain('@example.org');
    });

    // Found in loop 2 of the invariant 2 review, 2026-11-17, by two readers: the
    // gate passed at 5 counted, and then every row came back, the uncounted ones
    // with them. 7 rows of which 5 count: a reader of 7 rows beside a count of 5
    // learns that 2 are not counted, and who. That group of 2 is under the floor.
    describe('7 rows of which 5 are counted: only the counted rows are read', () => {
      async function sevenRowsFiveCounted(title: string): Promise<string> {
        const id = await createEvent(title);
        await seedRegistrations(id, 7);
        await tenv.FORMS_DB.prepare(
          `UPDATE form_registrations SET expires_at = '2020-01-01 00:00:00'
            WHERE id IN (SELECT id FROM form_registrations WHERE event_id = ? LIMIT 2)`
        )
          .bind(id)
          .run();
        return id;
      }

      test('the list gives 5 rows beside its count of 5, and no further page', async () => {
        const id = await sevenRowsFiveCounted('Roster five of seven: list');
        const body = (await (await get(id, 'registrations')).json()) as {
          items: unknown[];
          count: number;
          next_cursor: string | null;
        };
        expect(body.count).toBe(5);
        expect(body.items).toHaveLength(5);
        expect(body.next_cursor).toBeNull();
      });

      test('paging the list never reaches an uncounted row', async () => {
        const id = await sevenRowsFiveCounted('Roster five of seven: paging');
        let cursor: string | null = null;
        let seen = 0;
        for (let page = 0; page < 10; page++) {
          const path: string =
            'registrations?limit=2' + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
          const body = (await (await get(id, path)).json()) as {
            items: unknown[];
            next_cursor: string | null;
          };
          seen += body.items.length;
          cursor = body.next_cursor;
          if (!cursor) break;
        }
        expect(seen).toBe(5);
      });

      test('the JSON export gives 5 rows', async () => {
        const id = await sevenRowsFiveCounted('Roster five of seven: export');
        const body = (await (await get(id, 'export?type=registrations')).json()) as {
          items: unknown[];
          count: number;
        };
        expect(body.items).toHaveLength(5);
        expect(body.count).toBe(5);
      });

      test('the contacts give 5 people', async () => {
        const id = await sevenRowsFiveCounted('Roster five of seven: contacts');
        const body = (await (await get(id, 'contacts')).json()) as { items: unknown[] };
        expect(body.items).toHaveLength(5);
      });
    });

    test('control: with 5 counted rows the export and the contacts give all 5', async () => {
      const id = await createEvent('Roster five of five');
      await seedRegistrations(id, 5);
      const exp = (await (await get(id, 'export?type=registrations')).json()) as {
        items: unknown[];
        suppressed: boolean;
      };
      expect(exp.suppressed).toBe(false);
      expect(exp.items).toHaveLength(5);
      const con = (await (await get(id, 'contacts')).json()) as {
        items: unknown[];
        suppressed: boolean;
      };
      expect(con.suppressed).toBe(false);
      expect(con.items).toHaveLength(5);
    });
  });
});
