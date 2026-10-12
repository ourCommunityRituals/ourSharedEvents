/**
 * OSE-1431 — a sponsor sees one name everywhere.
 *
 * The public surfaces show the sponsor's title: its display name, or the
 * business name when that is blank (`sponsorTitle`, lib/sponsor-card.ts). This
 * spec holds the two surfaces that still showed the business name:
 *   - the sponsor's own home page (`/sponsor?t=`)
 *   - the SharedReport sponsor lines (`sponsor_displays[].sponsor_title`)
 *
 * Identity stays with the business name: the report keeps `sponsor_name`
 * unchanged, and the admin sponsors list keeps `name`.
 *
 * @born-red OSE-1431 | method: ran against the pre-change src — sponsor home
 * rendered the business name, the builder emitted no sponsor_title, and the
 * report page read s.sponsor_name; the admin/identity assertions passed on both
 * | date: 2026-10-03
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { buildSharedReport } from '../src/lib/shared-report-builder';
import { mintSponsorHomeToken } from '../src/lib/sponsor-home-auth';

const BRAND = 'ose-sponsor-title';
const EVENT = 'evt-1431-live';
const ADMIN_HEADERS = { Authorization: 'Bearer test-admin-key-e2e-2026' };

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  SHARED_REPORT_SIGNING_SECRET: string;
}
const tenv = env as unknown as TestEnv;

async function applyMigrations(): Promise<void> {
  const statements: string[] = JSON.parse(tenv.TEST_MIGRATION_STATEMENTS);
  for (const stmt of statements) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }
}

async function seedSponsor(id: string, name: string, displayName: string | null): Promise<void> {
  await tenv.DB.prepare(
    `INSERT INTO sponsor_business (id, brand_id, name, display_name, is_active) VALUES (?, ?, ?, ?, 1)`
  )
    .bind(id, BRAND, name, displayName)
    .run();
  await tenv.DB.prepare(
    `INSERT INTO sponsor_placement (id, sponsor_business_id, event_id, tier, source, is_active, sponsor_accepted)
     VALUES (?, ?, ?, 'standard', 'organizer', 1, 1)`
  )
    .bind(`pl-${id}`, id, EVENT)
    .run();
  // A (sponsor x surface) row is published only at the K = 5 floor (OSE-1421),
  // so seed exactly K impressions: the report must carry this sponsor's line.
  for (let i = 0; i < 5; i++) {
    await tenv.DB.prepare(
      `INSERT INTO sponsor_displays (id, sponsor_id, event_id, surface, placement, event_type, created_at)
       VALUES (?, ?, ?, 'public', 'p1', 'impression', datetime('now'))`
    )
      .bind(`si-${id}-${i}`, id, EVENT)
      .run();
  }
}

async function homeFor(sponsorId: string): Promise<string> {
  const minted = await mintSponsorHomeToken(tenv, sponsorId, BRAND);
  const res = await SELF.fetch(`https://t.test/sponsor?t=${minted!.token}`);
  expect(res.status).toBe(200);
  return res.text();
}

beforeAll(async () => {
  await applyMigrations();
  await tenv.DB.prepare(`DELETE FROM sponsor_displays WHERE id LIKE 'si-st1431-%'`).run();
  await tenv.DB.prepare(`DELETE FROM sponsor_placement WHERE id LIKE 'pl-st1431-%'`).run();
  await tenv.DB.prepare(`DELETE FROM sponsor_business WHERE id LIKE 'st1431-%'`).run();
  await tenv.DB.prepare('DELETE FROM events WHERE id = ?').bind(EVENT).run();
  await tenv.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, location, start_date, created_at, updated_at)
     VALUES (?, ?, 'Title Night', ?, 'active', 'Test Venue', '2099-01-01', datetime('now'), datetime('now'))`
  )
    .bind(EVENT, BRAND, EVENT)
    .run();
  await seedSponsor('st1431-titled', 'Harbor Hops LLC', 'Harbor Hops');
  await seedSponsor('st1431-null', 'Plain Legal Name Inc', null);
  await seedSponsor('st1431-blank', 'Blank Title Co', '   ');
});

describe('OSE-1431: sponsor home shows the sponsor title', () => {
  test('display name set → the header shows the display name', async () => {
    const html = await homeFor('st1431-titled');
    expect(html).toContain('data-testid="sponsor-home-name">Harbor Hops<');
    expect(html).not.toContain('Harbor Hops LLC');
  });

  test('display name null → falls back to the business name', async () => {
    const html = await homeFor('st1431-null');
    expect(html).toContain('data-testid="sponsor-home-name">Plain Legal Name Inc<');
  });

  test('display name blank → falls back to the business name', async () => {
    const html = await homeFor('st1431-blank');
    expect(html).toContain('data-testid="sponsor-home-name">Blank Title Co<');
  });
});

describe('OSE-1431: SharedReport sponsor lines carry the sponsor title', () => {
  test('sponsor_title is the display name, else the business name; sponsor_name stays the business name', async () => {
    const built = await buildSharedReport(tenv.DB, EVENT);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const rows = built.report.sponsor_displays as Array<{
      sponsor_id: string;
      sponsor_name: string;
      sponsor_title?: string;
    }>;
    const by = (id: string) => rows.find((r) => r.sponsor_id === id);

    expect(by('st1431-titled')?.sponsor_title).toBe('Harbor Hops');
    expect(by('st1431-null')?.sponsor_title).toBe('Plain Legal Name Inc');
    expect(by('st1431-blank')?.sponsor_title).toBe('Blank Title Co');

    // Identity is unchanged.
    expect(by('st1431-titled')?.sponsor_name).toBe('Harbor Hops LLC');
    expect(by('st1431-null')?.sponsor_name).toBe('Plain Legal Name Inc');
  });

  test('the report page renders the title, with the business name as fallback', async () => {
    const html = await (await SELF.fetch('https://t.test/sharedReport')).text();
    expect(html.includes('esc(s.sponsor_title || s.sponsor_name)')).toBe(true);
  });
});

describe('OSE-1431: admin keeps the business name', () => {
  test('the admin sponsors list returns the business name as name', async () => {
    const res = await SELF.fetch(`https://t.test/api/v2/admin/sponsors?event_id=${EVENT}`, {
      headers: ADMIN_HEADERS,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ id: string; name: string }> };
    const titled = body.items.find((s) => s.id === 'st1431-titled');
    expect(titled?.name).toBe('Harbor Hops LLC');
  });
});
