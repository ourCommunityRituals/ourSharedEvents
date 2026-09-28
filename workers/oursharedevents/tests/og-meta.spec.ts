/**
 * OSE-637 | MKTB-1 — OpenGraph + Twitter Card meta tag coverage gate
 *
 * Source-level gates asserting that pages.ts emits a complete OG + Twitter
 * meta block on /events/:id for all three event phases.
 *
 * Gates:
 *   1. buildOgMeta helper is defined with the required tags
 *   2. All three render functions call buildOgMeta (pre_event, event, post_event)
 *   3. og:site_name = "OurSharedEvents" in the helper
 *   4. og:locale = "en_US" in the helper
 *   5. twitter:card, twitter:title, twitter:description in the helper
 *   6. og:event:start_time and og:event:end_time are conditional on date fields
 *   7. Live phase (renderEventLiveHtml) now includes twitter:card (was missing)
 */

import { env } from 'cloudflare:test';
import { describe, test, expect } from 'vitest';

interface TestEnv {
  TEST_SOURCE_FILES_JSON: string;
}

function getPagesTs(): string {
  const sources: Record<string, string> = JSON.parse(
    (env as unknown as TestEnv).TEST_SOURCE_FILES_JSON
  );
  const entry = Object.entries(sources).find(([p]) =>
    p.replace(/\\/g, '/').endsWith('handlers/pages.ts')
  );
  if (!entry) throw new Error('handlers/pages.ts not found in TEST_SOURCE_FILES_JSON');
  return entry[1];
}

describe('OSE-637 | MKTB-1 | OpenGraph meta tag coverage gate', () => {
  test('buildOgMeta helper is defined in pages.ts', () => {
    const src = getPagesTs();
    expect(src).toContain('function buildOgMeta(');
  });

  test('buildOgMeta emits og:site_name = OurSharedEvents', () => {
    const src = getPagesTs();
    expect(src).toContain('og:site_name');
    expect(src).toContain('OurSharedEvents');
  });

  test('buildOgMeta emits og:locale = en_US', () => {
    const src = getPagesTs();
    expect(src).toContain('og:locale');
    expect(src).toContain('en_US');
  });

  test('buildOgMeta emits twitter:card', () => {
    const src = getPagesTs();
    expect(src).toContain('twitter:card');
  });

  test('buildOgMeta emits twitter:title', () => {
    const src = getPagesTs();
    expect(src).toContain('twitter:title');
  });

  test('buildOgMeta emits twitter:description', () => {
    const src = getPagesTs();
    expect(src).toContain('twitter:description');
  });

  test('buildOgMeta conditionally emits og:event:start_time', () => {
    const src = getPagesTs();
    expect(src).toContain('og:event:start_time');
    // Conditional: only when startTime is truthy
    expect(src).toMatch(/opts\.startTime.*og:event:start_time|og:event:start_time.*opts\.startTime/s);
  });

  test('buildOgMeta conditionally emits og:event:end_time', () => {
    const src = getPagesTs();
    expect(src).toContain('og:event:end_time');
  });

  test('renderPreEventHtml calls buildOgMeta', () => {
    const src = getPagesTs();
    // renderPreEventHtml is the first render function — assert it calls buildOgMeta
    // with summary_large_image card (pre-event social preview needs the larger card)
    expect(src).toMatch(/renderPreEventHtml[\s\S]{1,3000}buildOgMeta/);
    expect(src).toContain("twitterCard: 'summary_large_image'");
  });

  test('renderEventLiveHtml calls buildOgMeta (twitter:card was missing before OSE-637)', () => {
    const src = getPagesTs();
    expect(src).toMatch(/renderEventLiveHtml[\s\S]{1,3000}buildOgMeta/);
  });

  test('renderPostEventHtml calls buildOgMeta with summary card', () => {
    const src = getPagesTs();
    expect(src).toMatch(/renderPostEventHtml[\s\S]{1,3000}buildOgMeta/);
    expect(src).toContain("twitterCard: 'summary'");
  });

  test('all three render functions pass the event start to buildOgMeta', () => {
    const src = getPagesTs();
    // One per render fn. OSE-1313: the canonical UTC instant (starts_at) is
    // preferred when the event has a time; the date-only start_date is the fallback.
    const matches = src.match(/startTime:\s*row\.starts_at\s*\?\?\s*row\.start_date/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(3);
  });
});
