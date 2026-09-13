/**
 * OSE-657 — Post-event recap-first: recap primary, suggestions subtle margin.
 *
 * The acceptance that matters: "A reviewer can't reconfigure it to lead with
 * suggestions without failing a layout-invariant test." These tests encode that
 * invariant structurally, not by preference:
 *
 *   1. recap-primary region precedes the suggestions margin in the DOM.
 *   2. The recap keepsake (recap card + stats + sponsors) lives inside the
 *      primary region, ahead of any suggestion.
 *   3. Suggestions are the demoted margin (an <aside>) and are CURATED —
 *      bounded to MAX_POST_EVENT_SUGGESTIONS, never an exhaustive listing.
 *   4. Sponsor placement stays spend-blind (names/links only).
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { seedSplitSponsor } from './helpers/seed-sponsor';

const BRAND = 'ose657-test';
const MAX_SUGGESTIONS = 3; // mirrors MAX_POST_EVENT_SUGGESTIONS in pages.ts

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  const stmts: string[] = JSON.parse(tenv.TEST_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        msg.includes('duplicate column name') ||
        msg.includes('already exists') ||
        msg.includes('no such column')
      ) {
        continue;
      }
      throw e;
    }
  }
}

async function insertEvent(opts: {
  id: string;
  status?: string;
  location?: string | null;
  startOffsetDays: number;
  endOffsetDays?: number;
  withFiveW?: boolean;
}): Promise<void> {
  const tenv = env as unknown as TestEnv;
  const now = Date.now();
  const start = new Date(now + opts.startOffsetDays * 86400000).toISOString();
  const end =
    opts.endOffsetDays != null ? new Date(now + opts.endOffsetDays * 86400000).toISOString() : null;
  await tenv.DB.prepare('DELETE FROM events WHERE id = ?').bind(opts.id).run();
  await tenv.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, location, start_date, end_date,
                         what_short, who_host, why_purpose,
                         created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
  )
    .bind(
      opts.id,
      BRAND,
      `Event ${opts.id}`,
      opts.id,
      opts.status ?? 'active',
      opts.location ?? null,
      start,
      end,
      opts.withFiveW ? 'A night worth reliving.' : null,
      opts.withFiveW ? 'The Host' : null,
      opts.withFiveW ? 'Because the block shows up for each other.' : null
    )
    .run();
}

beforeAll(async () => {
  await applyMigrations();
  const tenv = env as unknown as TestEnv;
  await tenv.DB.prepare('DELETE FROM events WHERE brand_id = ?').bind(BRAND).run();
});

describe('OSE-657: recap-first is a hard layout invariant', () => {
  test('recap-primary region precedes the suggestions margin', async () => {
    const venue = 'OSE657 Invariant Venue';
    await insertEvent({
      id: 'evt_ose657_past',
      startOffsetDays: -7,
      endOffsetDays: -6,
      location: venue,
      withFiveW: true,
    });
    // A future event at the same venue → a real suggestion exists.
    await insertEvent({ id: 'evt_ose657_future1', startOffsetDays: 5, location: venue });

    const res = await SELF.fetch('https://t.test/events/evt_ose657_past');
    expect(res.status).toBe(200);
    const html = await res.text();

    const recapIdx = html.indexOf('data-testid="recap-primary"');
    const suggIdx = html.indexOf('data-testid="suggestions-margin"');
    expect(recapIdx, 'recap-primary must be present').toBeGreaterThan(-1);
    expect(suggIdx, 'suggestions-margin must be present').toBeGreaterThan(-1);
    // THE invariant: recap comes first. Reorder the template and this fails.
    expect(recapIdx).toBeLessThan(suggIdx);

    // The keepsake content sits inside the primary region, ahead of the margin.
    expect(html.indexOf('data-testid="event-recap-card"')).toBeLessThan(suggIdx);
    // The suggestion itself sits in the margin, after the recap region.
    expect(html.indexOf('data-testid="next-event-card"')).toBeGreaterThan(recapIdx);

    // Structural demotion: suggestions live in an <aside>, not the main flow top.
    expect(html).toMatch(/<aside[^>]*data-testid="suggestions-margin"/);
  });

  test('suggestions are curated — bounded, never an exhaustive listing', async () => {
    const venue = 'OSE657 Bounded Venue';
    await insertEvent({
      id: 'evt_ose657_bounded_past',
      startOffsetDays: -3,
      endOffsetDays: -2,
      location: venue,
      withFiveW: true,
    });
    // Seed MORE future events than the cap allows.
    for (let i = 0; i < MAX_SUGGESTIONS + 3; i++) {
      await insertEvent({
        id: `evt_ose657_bounded_future_${i}`,
        startOffsetDays: 2 + i,
        location: venue,
      });
    }

    const res = await SELF.fetch('https://t.test/events/evt_ose657_bounded_past');
    const html = await res.text();

    // Count rendered suggestion anchors (first = next-event-link, rest indexed).
    const linkCount =
      (html.match(/data-testid="next-event-link"/g) ?? []).length +
      (html.match(/data-testid="next-event-suggestion-link-\d+"/g) ?? []).length;
    expect(linkCount).toBeGreaterThan(0);
    expect(linkCount).toBeLessThanOrEqual(MAX_SUGGESTIONS);
    // The (cap+1)-th suggestion must never appear.
    expect(html).not.toContain(`data-testid="next-event-suggestion-${MAX_SUGGESTIONS}"`);
  });

  test('no future events → corridor fallback in the margin, recap still primary', async () => {
    await insertEvent({
      id: 'evt_ose657_nofuture',
      startOffsetDays: -4,
      endOffsetDays: -3,
      location: 'OSE657 Lonely Venue',
      withFiveW: true,
    });
    const res = await SELF.fetch('https://t.test/events/evt_ose657_nofuture');
    const html = await res.text();
    expect(html).toContain('data-testid="next-event-fallback"');
    expect(html).toContain('data-testid="browse-events-link"');
    // Even the fallback stays in the margin, after the recap.
    expect(html.indexOf('data-testid="recap-primary"')).toBeLessThan(
      html.indexOf('data-testid="suggestions-margin"')
    );
  });

  test('canonical 5W order (past tense): WHAT → WHERE → WHO → HOW MUCH → numbers; HOW dropped, WHY below the ask', async () => {
    // OSE-1136: the recap is the third phase of the canonical table, past-tense.
    // Seed a full-5W past event WITH a price, so every canonical card can render.
    const id = 'evt_ose1136_canonical';
    const tenv = env as unknown as TestEnv;
    const start = new Date(Date.now() - 7 * 86400000).toISOString();
    const end = new Date(Date.now() - 6 * 86400000).toISOString();
    await tenv.DB.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
    await tenv.DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, location, where_address,
                           start_date, end_date, what_short, who_host, why_purpose, how_details,
                           price_cents, price_model, created_at, updated_at)
       VALUES (?, ?, 'Canonical Recap', ?, 'active', 'The Venue', '1 Main St',
               ?, ?, 'What it was', 'The Host', 'Why it mattered', 'How to join',
               1000, 'fixed', datetime('now'), datetime('now'))`
    )
      .bind(id, BRAND, id, start, end)
      .run();

    const html = await (await SELF.fetch(`https://t.test/events/${id}`)).text();
    const at = (t: string) => html.indexOf(`data-testid="${t}"`);

    // Every canonical card renders (facts first), stats included.
    for (const t of [
      'event-recap-card',
      'event-where-post',
      'event-who-post',
      'event-how-much-post',
      'suggestions-margin',
      'event-why-post',
    ]) {
      expect(at(t), `${t} must render`).toBeGreaterThan(-1);
    }
    // WHAT → WHERE → WHO → HOW MUCH (facts, in canonical order).
    expect(at('event-recap-card'), 'WHAT leads').toBeLessThan(at('event-where-post'));
    expect(at('event-where-post'), 'WHERE before WHO').toBeLessThan(at('event-who-post'));
    expect(at('event-who-post'), 'WHO before HOW MUCH').toBeLessThan(at('event-how-much-post'));
    // Facts (recap-primary) precede the ask/return-loop margin.
    expect(at('event-how-much-post'), 'HOW MUCH sits in the recap, before the margin').toBeLessThan(
      at('suggestions-margin')
    );
    // WHY is deeper detail BELOW the ask (mirrors pre/live facts → ask → detail).
    expect(at('event-why-post'), 'WHY sits below the suggestions margin').toBeGreaterThan(
      at('suggestions-margin')
    );
    // HOW is intentionally dropped — nothing to "join" once the event is over.
    expect(at('event-how-post'), 'HOW must NOT render on a past event').toBe(-1);
    // HOW MUCH is a past-tense display label, not a payment primitive.
    expect(html, 'fixed price renders as a compact dollar string').toContain('$10');
  });

  test('sponsor placement in the recap stays spend-blind (no tier/spend leak)', async () => {
    const eventId = 'evt_ose657_sponsor';
    await insertEvent({
      id: eventId,
      startOffsetDays: -5,
      endOffsetDays: -4,
      location: 'OSE657 Sponsor Venue',
      withFiveW: true,
    });
    const tenv = env as unknown as TestEnv;
    // Seed an active sponsor with a tier that MUST NOT surface publicly.
    // OSE-799 A2: split model (idempotent helper clears prior rows for this id).
    await seedSplitSponsor(tenv.DB, {
      id: 'spn_ose657',
      eventId,
      name: 'Corner Cafe',
      websiteUrl: 'https://cornercafe.example',
      tier: 'platinum',
    });

    const res = await SELF.fetch(`https://t.test/events/${eventId}`);
    const html = await res.text();
    expect(html).toContain('data-testid="post-sponsor-thanks"');
    expect(html).toContain('Corner Cafe');
    // Spend-blind: the tier string never reaches the public recap.
    expect(html.toLowerCase()).not.toContain('platinum');
  });
});
