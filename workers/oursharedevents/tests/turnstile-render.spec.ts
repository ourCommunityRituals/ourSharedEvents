/**
 * L4 Turnstile Slice 2 — client render coverage (OSE-1378 / OSE-1379).
 *
 * Node-clean: pure render helpers + handleFormPage over a fake env (no DB, no
 * cloudflare:test / SELF.fetch). Listed in vitest.node-specs.mjs. Born-red: the
 * dark assertions flip if the flag gate is removed; the enabled assertions flip
 * if the widget/CSP wiring is dropped.
 */
import { describe, it, expect } from 'vitest';
import {
  turnstileClientEnabled,
  turnstileScriptTag,
  turnstileWidgetHtml,
} from '../src/lib/turnstile';
import { handleFormPage, type FormPagesEnv } from '../src/handlers/form-pages';

const ON: FormPagesEnv = { TURNSTILE_ENABLED: 'true', TURNSTILE_SITE_KEY: '0xTESTKEY' };
const OFF: FormPagesEnv = {};

function get(url: string): Request {
  return new Request(url, { method: 'GET' });
}

describe('turnstile — client render helpers', () => {
  it('turnstileClientEnabled needs BOTH the flag and a sitekey', () => {
    expect(turnstileClientEnabled({})).toBe(false);
    expect(turnstileClientEnabled({ TURNSTILE_ENABLED: 'true' })).toBe(false); // no sitekey
    expect(turnstileClientEnabled({ TURNSTILE_SITE_KEY: '0xK' })).toBe(false); // not enabled
    expect(turnstileClientEnabled({ TURNSTILE_ENABLED: 'true', TURNSTILE_SITE_KEY: '  ' })).toBe(
      false
    ); // blank sitekey
    expect(turnstileClientEnabled(ON)).toBe(true);
  });

  it('script tag + widget are empty strings when off', () => {
    expect(turnstileScriptTag(OFF)).toBe('');
    expect(turnstileWidgetHtml(OFF, 'register')).toBe('');
  });

  it('widget carries the sitekey + action and escapes attribute values', () => {
    const w = turnstileWidgetHtml(ON, 'register');
    expect(w).toContain('class="cf-turnstile"');
    expect(w).toContain('data-sitekey="0xTESTKEY"');
    expect(w).toContain('data-action="register"');
    const evil = turnstileWidgetHtml(
      { TURNSTILE_ENABLED: 'true', TURNSTILE_SITE_KEY: '"><script>x' },
      'a"b'
    );
    expect(evil).not.toContain('<script>x');
    expect(evil).toContain('&quot;');
  });
});

describe('form-pages — Turnstile Slice 2 render', () => {
  it('dark by default: no widget, no Turnstile CSP', async () => {
    const res = await handleFormPage(
      get('https://stg.oursharedevents.com/forms/evt_1'),
      OFF,
      'evt_1'
    );
    const html = await res.text();
    expect(html).not.toContain('class="cf-turnstile"');
    expect(html).not.toContain('challenges.cloudflare.com');
    expect(res.headers.get('Content-Security-Policy') ?? '').not.toContain(
      'challenges.cloudflare.com'
    );
  });

  it('enabled: register page gets the widget (correct action + sitekey) + loader', async () => {
    const res = await handleFormPage(
      get('https://stg.oursharedevents.com/forms/evt_1'),
      ON,
      'evt_1'
    );
    const html = await res.text();
    expect(html).toContain('class="cf-turnstile"');
    expect(html).toContain('data-action="register"');
    expect(html).toContain('data-sitekey="0xTESTKEY"');
    expect(html).toContain('challenges.cloudflare.com/turnstile/v0/api.js');
  });

  it('enabled: CSP allows the Turnstile host in script-src AND frame-src', async () => {
    const res = await handleFormPage(
      get('https://stg.oursharedevents.com/forms/evt_1?type=survey'),
      ON,
      'evt_1'
    );
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain('https://challenges.cloudflare.com');
    expect(csp).toContain('frame-src https://challenges.cloudflare.com');
  });

  it('enabled: action matches the endpoint for survey / email / checkin', async () => {
    const survey = await (
      await handleFormPage(get('https://s.oursharedevents.com/forms/e?type=survey'), ON, 'e')
    ).text();
    expect(survey).toContain('data-action="survey"');
    const email = await (
      await handleFormPage(get('https://s.oursharedevents.com/forms/e?type=email-signup'), ON, 'e')
    ).text();
    expect(email).toContain('data-action="email-signup"');
    const checkin = await (
      await handleFormPage(get('https://s.oursharedevents.com/forms/e?type=checkin'), ON, 'e')
    ).text();
    expect(checkin).toContain('data-action="checkin"');
  });

  it('enabled but NO sitekey → still dark (client needs a sitekey)', async () => {
    const res = await handleFormPage(
      get('https://stg.oursharedevents.com/forms/evt_1'),
      { TURNSTILE_ENABLED: 'true' },
      'evt_1'
    );
    const html = await res.text();
    expect(html).not.toContain('class="cf-turnstile"');
  });

  it('submit JS attaches the token as a header (wiring intact)', async () => {
    const html = await (
      await handleFormPage(get('https://stg.oursharedevents.com/forms/evt_1'), ON, 'evt_1')
    ).text();
    expect(html).toContain("_headers['cf-turnstile-response']");
  });
});
