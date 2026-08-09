/**
 * landing.html unification — colorblind-safe status colors + non-color cue.
 *
 * The primary defect: success rendered green (#4ade80) against error red
 * (--danger) — the red/green deuteranopia trap the token system explicitly
 * avoids. Fix: success -> teal var(--success), plus a non-color glyph so the
 * valence survives colorblindness AND any palette swap. Locks the fix.
 */

import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

async function landing(): Promise<string> {
  const res = await SELF.fetch('https://t.test/landing');
  expect(res.status, 'GET /landing should render 200').toBe(200);
  return res.text();
}

describe('landing | colorblind-safe status (unification)', () => {
  it('the green success hex is gone entirely', async () => {
    const html = await landing();
    expect(html, '#4ade80 (the green paired against red) must be gone').not.toContain('#4ade80');
  });

  it('success is teal var(--success); error is var(--danger)', async () => {
    const html = await landing();
    expect(html).toMatch(/\.form-message\.success\s*\{[^}]*color:\s*var\(--success\)/);
    expect(html).toMatch(/\.form-message\.error\s*\{[^}]*color:\s*var\(--danger\)/);
  });

  it('a non-color valence cue (glyph) is present on success and error', async () => {
    const html = await landing();
    expect(html).toMatch(/\.form-message\.success::before\s*\{[^}]*content/);
    expect(html).toMatch(/\.form-message\.error::before\s*\{[^}]*content/);
  });

  it('the message region announces via aria-live (meaning is not color-only)', async () => {
    const html = await landing();
    expect(html).toMatch(/id="form-message"[^>]*aria-live/);
  });

  it('the CTA no longer uses black-on-accent (the AA failure)', async () => {
    const html = await landing();
    expect(html).not.toMatch(/button\[type='submit'\]\s*\{[^}]*color:\s*#000\b/);
  });
});
