/**
 * Sponsor Wing — Business Logic Tests
 *
 * Validates the three core sponsor business questions:
 *   Q1: Can a sponsor sign up for 5 event types?
 *   Q2: Does a local sponsor appear for matching event type + area?
 *       Does it NOT appear when it shouldn't?
 *   Q3: Do sponsors accumulate (rotation, not replacement)?
 *
 * Uses D1 in-memory database via cloudflare:test.
 */

import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import {
  resolveSponsorsForEvent,
  filterSponsorsForSurface,
  buildSponsorBundle,
} from '../src/lib/sponsor-resolver';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  const statements: string[] = JSON.parse(tenv.TEST_MIGRATION_STATEMENTS);
  for (const stmt of statements) {
    try {
      await env.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name')) continue;
      throw e;
    }
  }
}

// ─── Seed helpers ───────────────────────────────────────────────────────────────

async function seedEvent(
  id: string,
  opts: { templateId?: string; zipCode?: string; lat?: number; lon?: number } = {}
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, template_id, zip_code, lat, lon)
     VALUES (?, 'root', ?, ?, 'active', ?, ?, ?, ?)`
  )
    .bind(
      id,
      `Test Event ${id}`,
      `test-event-${id}`,
      opts.templateId ?? null,
      opts.zipCode ?? null,
      opts.lat ?? null,
      opts.lon ?? null
    )
    .run();
}

async function seedSponsor(
  id: string,
  eventId: string,
  opts: { tier?: string; placements?: Record<string, boolean> } = {}
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO sponsors (id, event_id, name, tier, placement_formats, is_active)
     VALUES (?, ?, ?, ?, ?, 1)`
  )
    .bind(
      id,
      eventId,
      `Sponsor ${id}`,
      opts.tier ?? 'primary',
      JSON.stringify(opts.placements ?? {})
    )
    .run();
}

async function seedSponsorEventType(sponsorId: string, templateId: string): Promise<void> {
  const id = `set_${sponsorId}_${templateId}`;
  await env.DB.prepare(
    'INSERT INTO sponsor_event_types (id, sponsor_id, template_id) VALUES (?, ?, ?)'
  )
    .bind(id, sponsorId, templateId)
    .run();
}

async function seedSponsorArea(
  sponsorId: string,
  opts: { zipCode?: string; lat?: number; lon?: number; radiusMiles?: number }
): Promise<void> {
  const id = `sa_${sponsorId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  await env.DB.prepare(
    'INSERT INTO sponsor_areas (id, sponsor_id, zip_code, lat, lon, radius_miles) VALUES (?, ?, ?, ?, ?, ?)'
  )
    .bind(
      id,
      sponsorId,
      opts.zipCode ?? null,
      opts.lat ?? null,
      opts.lon ?? null,
      opts.radiusMiles ?? 10
    )
    .run();
}

// ─── Setup ──────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await applyMigrations();

  // Seed event templates used in tests
  for (const tmpl of ['bar_night', 'trivia', 'music_event', 'rec_league', 'darts']) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO event_templates (id, name, category, default_sections, default_ui_presets)
       VALUES (?, ?, 'social', '{"sponsors":true}', '{}')`
    )
      .bind(tmpl, tmpl)
      .run();
  }
});

// ─── Q1: Multi-event-type signup ────────────────────────────────────────────────

describe('Q1: Sponsor signs up for 5 event types', () => {
  beforeAll(async () => {
    // Create a sponsor (direct to a dummy event)
    await seedEvent('evt-q1-dummy', {});
    await seedSponsor('sp-q1-multi', 'evt-q1-dummy', { tier: 'gold' });

    // Link to 5 event types
    for (const tmpl of ['bar_night', 'trivia', 'music_event', 'rec_league', 'darts']) {
      await seedSponsorEventType('sp-q1-multi', tmpl);
    }
  });

  test('sponsor is linked to 5 templates', async () => {
    const result = await env.DB.prepare(
      'SELECT COUNT(*) as cnt FROM sponsor_event_types WHERE sponsor_id = ?'
    )
      .bind('sp-q1-multi')
      .first<{ cnt: number }>();
    expect(result?.cnt).toBe(5);
  });

  test('duplicate (sponsor_id, template_id) is rejected', async () => {
    await expect(seedSponsorEventType('sp-q1-multi', 'bar_night')).rejects.toThrow(/UNIQUE/);
  });

  test('sponsor resolves for event with matching template', async () => {
    await seedEvent('evt-q1-bar', { templateId: 'bar_night' });
    const sponsors = await resolveSponsorsForEvent(env.DB, 'evt-q1-bar');
    const ids = sponsors.map((s) => s.id);
    expect(ids).toContain('sp-q1-multi');
  });
});

// ─── Q2: Hyperlocal filtering ───────────────────────────────────────────────────

describe('Q2: Hyperlocal sponsor filtering', () => {
  beforeAll(async () => {
    // Sponsor with zip area = 60614 (Chicago Lincoln Park)
    await seedEvent('evt-q2-dummy', {});
    await seedSponsor('sp-q2-local', 'evt-q2-dummy', { tier: 'silver' });
    await seedSponsorEventType('sp-q2-local', 'bar_night');
    await seedSponsorArea('sp-q2-local', { zipCode: '60614' });

    // Sponsor with lat/lon radius (downtown Chicago, 5 mile radius)
    await seedSponsor('sp-q2-radius', 'evt-q2-dummy', { tier: 'gold' });
    await seedSponsorEventType('sp-q2-radius', 'bar_night');
    await seedSponsorArea('sp-q2-radius', { lat: 41.8781, lon: -87.6298, radiusMiles: 5 });
  });

  test('matching template + matching zip -> sponsor appears', async () => {
    await seedEvent('evt-q2-match-zip', { templateId: 'bar_night', zipCode: '60614' });
    const sponsors = await resolveSponsorsForEvent(env.DB, 'evt-q2-match-zip');
    const ids = sponsors.map((s) => s.id);
    expect(ids).toContain('sp-q2-local');
  });

  test('matching template + wrong zip -> sponsor absent', async () => {
    await seedEvent('evt-q2-wrong-zip', { templateId: 'bar_night', zipCode: '90210' });
    const sponsors = await resolveSponsorsForEvent(env.DB, 'evt-q2-wrong-zip');
    const ids = sponsors.map((s) => s.id);
    expect(ids).not.toContain('sp-q2-local');
  });

  test('wrong template + matching zip -> sponsor absent', async () => {
    await seedEvent('evt-q2-wrong-tmpl', { templateId: 'rec_league', zipCode: '60614' });
    const sponsors = await resolveSponsorsForEvent(env.DB, 'evt-q2-wrong-tmpl');
    const ids = sponsors.map((s) => s.id);
    expect(ids).not.toContain('sp-q2-local');
  });

  test('matching template + within radius -> sponsor appears', async () => {
    // Lincoln Park is ~3 miles from downtown Chicago
    await seedEvent('evt-q2-near', { templateId: 'bar_night', lat: 41.9214, lon: -87.6513 });
    const sponsors = await resolveSponsorsForEvent(env.DB, 'evt-q2-near');
    const ids = sponsors.map((s) => s.id);
    expect(ids).toContain('sp-q2-radius');
  });

  test('matching template + outside radius -> sponsor absent', async () => {
    // Milwaukee ~90 miles from Chicago
    await seedEvent('evt-q2-far', { templateId: 'bar_night', lat: 43.0389, lon: -87.9065 });
    const sponsors = await resolveSponsorsForEvent(env.DB, 'evt-q2-far');
    const ids = sponsors.map((s) => s.id);
    expect(ids).not.toContain('sp-q2-radius');
  });

  test('direct event_id assignment always appears (no geo check)', async () => {
    // Sponsor directly assigned to this event — appears regardless
    await seedEvent('evt-q2-direct', { templateId: 'trivia', zipCode: '90210' });
    await seedSponsor('sp-q2-direct', 'evt-q2-direct', { tier: 'platinum' });

    const sponsors = await resolveSponsorsForEvent(env.DB, 'evt-q2-direct');
    const ids = sponsors.map((s) => s.id);
    expect(ids).toContain('sp-q2-direct');
  });
});

// ─── Q3: Rotation not replacement ───────────────────────────────────────────────

describe('Q3: Sponsors accumulate (rotation, not replacement)', () => {
  beforeAll(async () => {
    await seedEvent('evt-q3-accumulate', { templateId: 'trivia', zipCode: '60614' });

    // 5 sponsors all matching trivia + 60614
    const tiers = ['title', 'platinum', 'gold', 'silver', 'bronze'] as const;
    for (let i = 0; i < 5; i++) {
      const spId = `sp-q3-${i}`;
      await seedSponsor(spId, 'evt-q2-dummy', {
        tier: tiers[i],
        placements: { posterTop: true, tvTop: true, mobileBanner: true },
      });
      await seedSponsorEventType(spId, 'trivia');
      await seedSponsorArea(spId, { zipCode: '60614' });
    }
  });

  test('all 5 sponsors returned for matching event', async () => {
    const sponsors = await resolveSponsorsForEvent(env.DB, 'evt-q3-accumulate');
    const q3Sponsors = sponsors.filter((s) => s.id.startsWith('sp-q3-'));
    expect(q3Sponsors.length).toBe(5);
  });

  test('sponsors sorted by tier priority (title first, bronze last)', async () => {
    const sponsors = await resolveSponsorsForEvent(env.DB, 'evt-q3-accumulate');
    const q3Sponsors = sponsors.filter((s) => s.id.startsWith('sp-q3-'));
    const tiers = q3Sponsors.map((s) => s.tier);
    expect(tiers).toEqual(['title', 'platinum', 'gold', 'silver', 'bronze']);
  });

  test('bundle rotation_config adapts to sponsor count', async () => {
    const sponsors = await resolveSponsorsForEvent(env.DB, 'evt-q3-accumulate');
    const q3Sponsors = sponsors.filter((s) => s.id.startsWith('sp-q3-'));
    const bundle = buildSponsorBundle(q3Sponsors);
    expect(bundle.rotation_config.sponsorSlots).toBeGreaterThanOrEqual(5);
    expect(bundle.rotation_config.rotationMs).toBeGreaterThanOrEqual(3000);
  });
});

// ─── Surface filtering ──────────────────────────────────────────────────────────

describe('Surface filtering', () => {
  const makeSponsor = (id: string, placements: Record<string, boolean>): any => ({
    id,
    event_id: 'test',
    name: `Sponsor ${id}`,
    logo_url: null,
    website_url: null,
    tier: 'primary',
    placement_formats: JSON.stringify(placements),
    click_token: null,
    display_token: null,
    is_active: 1,
    created_at: '',
    updated_at: '',
  });

  // OSE-661 (#25): placement is UNIFORM — every active sponsor is eligible for
  // every surface; the named-slot filter (posterTop/tvTop/tvSide/mobileBanner)
  // is retired (it was the covenant violation — buying a named slot). Surface
  // distinctions are rendering-only. So filterSponsorsForSurface returns ALL.
  test('poster surface includes ALL sponsors (uniform placement, #25)', () => {
    const sponsors = [
      makeSponsor('a', { posterTop: true, tvTop: true }),
      makeSponsor('b', { tvTop: true }),
      makeSponsor('c', { posterTop: true }),
    ];
    const filtered = filterSponsorsForSurface(sponsors, 'poster');
    expect(filtered.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  test('display surface includes ALL sponsors (uniform placement, #25)', () => {
    const sponsors = [
      makeSponsor('a', { tvTop: true }),
      makeSponsor('b', { tvSide: true }),
      makeSponsor('c', { mobileBanner: true }),
    ];
    const filtered = filterSponsorsForSurface(sponsors, 'display');
    expect(filtered.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  test('public surface includes ALL sponsors (uniform placement, #25)', () => {
    const sponsors = [
      makeSponsor('a', { mobileBanner: true }),
      makeSponsor('b', { posterTop: true }),
    ];
    const filtered = filterSponsorsForSurface(sponsors, 'public');
    expect(filtered.map((s) => s.id)).toEqual(['a', 'b']);
  });

  test('sharedReport surface returns all sponsors', () => {
    const sponsors = [
      makeSponsor('a', { posterTop: true }),
      makeSponsor('b', { tvTop: true }),
      makeSponsor('c', {}),
    ];
    const filtered = filterSponsorsForSurface(sponsors, 'sharedReport');
    expect(filtered.length).toBe(3);
  });
});
