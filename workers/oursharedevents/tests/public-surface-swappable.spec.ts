/**
 * OSE-655 A2 — the public event surface is palette-agnostic (theme-swappable).
 *
 * The /events/:id renders must drive their palette from @ocr/ui role tokens
 * (via /ui.css), never raw hex, so a [data-brand] on <html> re-colors the whole
 * surface. This gate fails if a future edit re-hardcodes a hex value into the
 * [data-surface="ose-public"] token block or drops the shared stylesheet.
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  for (const stmt of JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes('duplicate column') || m.includes('already exists') || m.includes('no such column')) continue;
      throw e;
    }
  }
}

async function seed(id: string): Promise<void> {
  const tenv = env as unknown as TestEnv;
  const start = new Date(Date.now() + 7 * 86400000).toISOString();
  await tenv.DB.prepare(`DELETE FROM events WHERE id = ?`).bind(id).run();
  await tenv.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, location, start_date, end_date,
                         what_short, where_address, created_at, updated_at)
     VALUES (?, 'a2-test', 'A2 Swap Event', ?, 'active', 'Venue', ?, ?, 'What', '1 Main St',
             datetime('now'), datetime('now'))`
  )
    .bind(id, id, start, start)
    .run();
}

beforeAll(applyMigrations);

describe('OSE-655 A2 | public event surface is theme-swappable (role tokens, no raw hex)', () => {
  test('links the shared @ocr/ui stylesheet and drives --ose-* from role tokens', async () => {
    const id = 'evt_a2_swap';
    await seed(id);
    const html = await (await SELF.fetch(`https://t.test/events/${id}`)).text();

    // consumes the shared stylesheet (where the role tokens + brand themes live)
    expect(html).toContain('href="/ui.css"');

    // the surface token block aliases @ocr/ui role tokens (so a brand swaps it)
    expect(html).toMatch(/--ose-accent:\s*var\(--accent\)/);
    expect(html).toMatch(/--ose-bg:\s*var\(--bg\)/);
    expect(html).toMatch(/--ose-text:\s*var\(--text\)/);

    // NO raw hex in any --ose-* token definition (the A2 wall)
    expect(html, 'a --ose-* token must never be hardcoded to a hex value').not.toMatch(
      /--ose-[a-z-]+:\s*#[0-9a-fA-F]{3,8}/
    );
    // and no manual rgba() dark override sneaking back in on an --ose-* token
    expect(html).not.toMatch(/--ose-[a-z-]+:\s*rgba\(/);
  });
});
