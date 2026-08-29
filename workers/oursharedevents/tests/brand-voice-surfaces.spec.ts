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

describe('landing | brand voice (flywheel rewrite + anonymity affordance)', () => {
  it('customer copy no longer says "flywheel" (internal-only term)', async () => {
    const html = await page('/landing');
    expect(html.toLowerCase(), 'flywheel is internal-only vocabulary (Q2)').not.toContain(
      'flywheel'
    );
  });

  it('the ring subtitle uses the event-cycle framing', async () => {
    const html = await page('/landing');
    expect(html).toContain('Six Southside communities. One connected event cycle.');
  });

  it('carries the anonymity affordance with the core promise', async () => {
    const html = await page('/landing');
    expect(html).toContain('data-testid="anonymity-affordance"');
    expect(html).toContain('never who you are');
  });
});

describe('public /events listing | anonymity affordance', () => {
  it('carries the anonymity affordance with the core promise', async () => {
    const html = await page('/events');
    expect(html).toContain('data-testid="anonymity-affordance"');
    expect(html).toContain('never who you are');
  });
});
