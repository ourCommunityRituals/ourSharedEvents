/**
 * Brand-voice regression guards — landing (/) and public listing (/events).
 *
 * Two migrations from .claude/brand-voice-guidelines.md land here:
 *   1. §8 HIGH "Landing flywheel rewrite" — `flywheel` is internal-only
 *      vocabulary (Q2, confirmed 2026-05-16); customer copy uses the
 *      event triangle / event cycle framing.
 *   2. §3 universal block — the anonymity affordance ("never who you are")
 *      is the Voice Constant's reference implementation and belongs on every
 *      public surface, including the two highest-traffic entry pages, not
 *      only the event-phase pages.
 *
 * Per §8: each migration ships with a regression-guard vitest test asserting
 * the new copy. These lock both.
 */

import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

async function page(path: string): Promise<string> {
  const res = await SELF.fetch(`https://t.test${path}`);
  expect(res.status, `GET ${path} should render 200`).toBe(200);
  return res.text();
}

describe('landing | brand voice (supply-side rewrite + never-who panel)', () => {
  // OSE-1312 rewrote the landing as the SUPPLY side (two doors + area view +
  // never-who panel). The old "flywheel" guard still holds; the old ring
  // subtitle and generic anonymity-affordance testid were removed with the hero.
  // The Voice Constant's core promise now lives in the landing-privacy panel,
  // which is TRUE of this page (no cookies / analytics / geolocation).
  it('customer copy no longer says "flywheel" (internal-only term)', async () => {
    const html = await page('/landing');
    expect(html.toLowerCase(), 'flywheel is internal-only vocabulary (Q2)').not.toContain(
      'flywheel'
    );
  });

  it('leads with the supply-side ask (two doors)', async () => {
    const html = await page('/landing');
    expect(html).toContain('data-testid="landing-doors"');
    expect(html).toContain('data-testid="door-create-event"');
    expect(html).toContain('data-testid="door-create-sponsor"');
  });

  it('carries the never-who core promise in the privacy panel', async () => {
    const html = await page('/landing');
    expect(html).toContain('data-testid="landing-privacy"');
    expect(html).toContain('without gathering who you are');
  });
});

describe('public /events listing | anonymity affordance', () => {
  it('carries the anonymity affordance with the core promise', async () => {
    const html = await page('/events');
    expect(html).toContain('data-testid="anonymity-affordance"');
    expect(html).toContain('never who you are');
  });
});
