/**
 * The privacy page must say what the code does. Each line here ties a sentence
 * on /privacy to the constant or setting that makes it true, so changing one
 * without the other fails CI.
 */
import { describe, expect, test } from 'vitest';
import { env } from 'cloudflare:test';
import { handlePrivacyPage } from '../src/handlers/privacy';
import {
  EMAIL_RETENTION_DAYS,
  FORMS_RETENTION_CEILING_DAYS,
  REGISTRATION_TTL_DAYS,
  SUBSCRIBER_RETENTION_DAYS,
} from '../src/lib/retention-windows';
import { generateAnonId, setAnonCookie, signAnonId } from '../src/lib/anonymous-id';

async function pageText(): Promise<string> {
  return (await handlePrivacyPage().text()).replace(/\s+/g, ' ');
}

describe('privacy page states the real retention windows', () => {
  test('event email sign-ups: EMAIL_RETENTION_DAYS', async () => {
    expect(EMAIL_RETENTION_DAYS).toBe(30);
    expect(await pageText()).toContain(`automatically deleted after ${EMAIL_RETENTION_DAYS} days`);
  });

  test('updates list: SUBSCRIBER_RETENTION_DAYS', async () => {
    expect(SUBSCRIBER_RETENTION_DAYS).toBe(90);
    expect(await pageText()).toMatch(
      /Updates list:<\/strong> encrypted at rest and automatically deleted after 90 days/
    );
  });

  test('registration: name and email cleared the day after the event, rest by REGISTRATION_TTL_DAYS', async () => {
    const text = await pageText();
    expect(text).toContain('removed automatically the day after the event ends');
    expect(text).toContain(`deleted ${REGISTRATION_TTL_DAYS} days after you register`);
    expect(text).not.toContain('deleted automatically when the event ends');
  });

  test('forms ceiling: FORMS_RETENTION_CEILING_DAYS', async () => {
    expect(await pageText()).toContain(`kept longer than ${FORMS_RETENTION_CEILING_DAYS} days`);
  });

  test('anonymous visit records: SCAN_RETURNS_RETENTION_DAYS is one year in every env', async () => {
    const toml = (env as Record<string, unknown>).TEST_WRANGLER_TOML as string;
    const values = [...toml.matchAll(/^\s*SCAN_RETURNS_RETENTION_DAYS\s*=\s*"(\d+)"/gm)].map(
      (m) => m[1]
    );
    expect(values.length).toBeGreaterThan(0);
    for (const v of values) expect(v).toBe('365');
    expect(await pageText()).toContain('Anonymous visit records:</strong> deleted after one year');
  });
});

describe('privacy page names the anonymous cookie and its real lifetime', () => {
  test('ose_anon is named, and the cookie the code sets lasts one year', async () => {
    const value = await signAnonId(generateAnonId(), 'test-pepper-test-pepper-test-pepper');
    const res = setAnonCookie(new Response('ok'), value as never);
    const header = res.headers.get('Set-Cookie') ?? '';
    expect(header).toMatch(/^ose_anon=/);
    expect(header).toContain(`Max-Age=${365 * 24 * 60 * 60}`);
    const text = await pageText();
    expect(text).toContain('<strong>ose_anon</strong>');
    expect(text).toContain('It lasts one year');
  });

  test('no claim that counting stores no personal data at all', async () => {
    expect(await pageText()).not.toContain('no personal data is stored');
  });
});

describe('privacy page covers everyone whose data we hold', () => {
  test('sponsors, staff sign-in and the updates list are listed', async () => {
    const text = await pageText();
    expect(text).toContain('<strong>Sponsors:</strong>');
    expect(text).toContain('<strong>Venue staff and admins:</strong>');
    expect(text).toContain('<strong>Updates list:</strong>');
  });

  test('names the legal entity, the processors and the transfer basis', async () => {
    const text = await pageText();
    expect(text).toContain('OurCommunityRituals LLC');
    expect(text).toContain('Cloudflare, Inc.');
    expect(text).toContain('Google LLC');
    expect(text).toContain('EU-US Data Privacy Framework');
  });

  test('states the minimum age to submit a form', async () => {
    expect(await pageText()).toContain('You must be 18 or older to register');
  });
});
