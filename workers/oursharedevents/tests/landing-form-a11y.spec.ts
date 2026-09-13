/**
 * A11Y-2 (Form Accessibility) — landing subscribe form.
 *
 * The subscribe input already had a label + aria-live message region. This locks
 * the remaining WCAG gaps: input-purpose autocomplete (1.3.5), the message
 * programmatically associated to the input (aria-describedby), and the input's
 * validity state exposed to assistive tech (aria-invalid, 4.1.2) — toggled by
 * the client validation JS on error and cleared on correction/success.
 */

import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

async function landing(): Promise<string> {
  const res = await SELF.fetch('https://t.test/landing');
  expect(res.status, 'GET /landing should render 200').toBe(200);
  return res.text();
}

describe('landing | subscribe form accessibility (A11Y-2)', () => {
  it('the email input declares its input purpose (autocomplete=email)', async () => {
    const html = await landing();
    expect(html).toMatch(/id="email-input"[\s\S]*?autocomplete="email"/);
  });

  it('the email input is programmatically associated with the message region', async () => {
    const html = await landing();
    expect(html).toMatch(/id="email-input"[\s\S]*?aria-describedby="form-message"/);
  });

  it('the label is associated to the input (for=email-input)', async () => {
    const html = await landing();
    expect(html).toMatch(/<label[^>]*for="email-input"/);
  });

  it('the client validation exposes validity via aria-invalid on error', async () => {
    const html = await landing();
    // set true on empty/invalid/server-error, false on success/correction
    expect(html).toMatch(/setAttribute\('aria-invalid',\s*'true'\)/);
    expect(html).toMatch(/setAttribute\('aria-invalid',\s*'false'\)/);
  });
});
