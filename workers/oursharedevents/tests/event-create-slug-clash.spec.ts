/**
 * A second event with the same title can be created (OSE-1684 CCR hold).
 *
 * events.slug is unique across the whole platform and write-once (Invariant
 * 18). Create derived the slug from the title with no suffix, so a second
 * "Trivia Night" anywhere, in any brand, answered 409 SLUG_TAKEN and the admin
 * page had no way past it. A derived slug now gets a short random suffix when
 * its plain form is taken. A slug the caller chose keeps its 409.
 *
 * Born-red: without the retry the second create of each pair answers 409.
 */
import { describe, test, expect, beforeAll } from 'vitest';
import { SELF, env } from 'cloudflare:test';

const ORIGIN = 'https://t.test';
const AUTH = {
  Authorization: 'Bearer test-admin-key-e2e-2026',
  'Content-Type': 'application/json',
};

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

beforeAll(async () => {
  const tenv = env as unknown as TestEnv;
  for (const stmt of JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }
});

async function create(body: Record<string, unknown>) {
  const res = await SELF.fetch(`${ORIGIN}/api/v2/admin/events`, {
    method: 'POST',
    headers: AUTH,
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function slugOf(id: unknown): Promise<string | undefined> {
  const row = await (env as unknown as TestEnv).DB.prepare('SELECT slug FROM events WHERE id = ?')
    .bind(String(id))
    .first<{ slug: string }>();
  return row?.slug;
}

describe('creating an event whose title another event already has', () => {
  test('both create; the second gets the plain slug plus a short suffix', async () => {
    const title = `Trivia Night ${Date.now()}`;
    const plain = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const a = await create({ title });
    const b = await create({ title });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(await slugOf(a.body.id)).toBe(plain);
    const second = await slugOf(b.body.id);
    expect(second).toMatch(new RegExp(`^${plain}-[0-9a-f]{6}$`));
  });

  test('three in a row all create, each with its own slug', async () => {
    const title = `Bocce League ${Date.now()}`;
    const results = [await create({ title }), await create({ title }), await create({ title })];
    expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
    const slugs = await Promise.all(results.map((r) => slugOf(r.body.id)));
    expect(new Set(slugs).size).toBe(3);
  });

  test('a title with no letters or digits gets "event", then "event-…"', async () => {
    const a = await create({ title: '!!!' });
    const b = await create({ title: '???' });
    expect([a.status, b.status]).toEqual([201, 201]);
    const slugs = [await slugOf(a.body.id), await slugOf(b.body.id)];
    for (const s of slugs) expect(s).toMatch(/^event(-[0-9a-f]{6})?$/);
    expect(slugs[0]).not.toBe(slugs[1]);
  });

  test('a slug the caller chose is not changed: a clash still answers 409', async () => {
    const slug = `chosen-${Date.now()}`;
    expect((await create({ title: 'One', slug })).status).toBe(201);
    const again = await create({ title: 'Two', slug });
    expect(again.status).toBe(409);
    expect(JSON.stringify(again.body)).toContain('SLUG_TAKEN');
  });
});
