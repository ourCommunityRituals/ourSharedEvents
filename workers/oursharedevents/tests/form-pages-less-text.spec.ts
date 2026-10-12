/**
 * Form pages: less explanatory text (owner 2026-10-11, after the landing,
 * admin, event and sponsor pages).
 *
 *   - Each form's one-line privacy summary says what that form keeps. It used
 *     to say "We never store your name once the event ends." on check-in,
 *     survey and updates alike, and none of those three asks for a name.
 *   - The confirmation drops "You can close this page."
 *   - The check-in line after registering is one short sentence.
 *
 * The page is rendered by handleFormPage with a stub DB and its scripts run in
 * jsdom with a stubbed fetch, as in tests/form-next-step-dom.spec.ts.
 *
 * @born-red form pages less text | method: run against form-pages.ts as on
 *   ba956f7b, before the copy change | date: 2026-10-11
 */

import { describe, test, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { handleFormPage, type FormPagesEnv } from '../src/handlers/form-pages';

const EVENT = {
  id: 'evt_less_text',
  brand_id: 'brand_less',
  title: 'Bocce night',
  slug: 'bocce-night',
  status: 'active',
  description: null,
  location: 'Eagles Hall',
  where_address: null,
  start_date: '2026-12-05',
  end_date: null,
  starts_at: '2026-12-06T00:00:00Z',
  timezone: 'America/Chicago',
};

function stubDb(): D1Database {
  return {
    prepare: (sql: string) => ({
      bind: () => ({
        first: async () => (sql.includes('WHERE id = ?') ? EVENT : null),
        all: async () => ({ results: [] }),
      }),
    }),
  } as unknown as D1Database;
}

async function page(type: string, answer: Record<string, unknown> = { ok: true }) {
  const env = { DB: stubDb() } as FormPagesEnv;
  const res = await handleFormPage(
    new Request(`https://t.test/forms/${EVENT.id}?type=${type}`),
    env,
    EVENT.id
  );
  const html = await res.text();
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: `https://t.test/forms/${EVENT.id}?type=${type}`,
    beforeParse(window) {
      (window as unknown as { fetch: unknown }).fetch = async (url: string) => ({
        ok: true,
        status: 200,
        json: async () => (url.includes('/forms/') ? answer : { ok: false }),
      });
    },
  });
  const doc = dom.window.document;
  const settle = async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
  };
  return { html, doc, settle };
}

const summary = (doc: Document) =>
  doc.querySelector('[data-testid="privacy-summary"]')?.textContent?.trim();

describe('each form says in one line what it keeps', () => {
  test('check-in: counted, never named', async () => {
    expect(summary((await page('checkin')).doc)).toBe('Counted, never named.');
  });

  test('survey: comments are cleaned within a day', async () => {
    expect(summary((await page('survey')).doc)).toBe(
      'Comments are cleaned of personal details within 24 hours.'
    );
  });

  test('updates: the email is deleted after 30 days', async () => {
    expect(summary((await page('email')).doc)).toBe('Your email is deleted after 30 days.');
  });

  test('no form claims to hold a name it never asked for', async () => {
    for (const type of ['register', 'checkin', 'survey', 'email']) {
      expect((await page(type)).html).not.toContain(
        'We never store your name once the event ends.'
      );
    }
  });
});

describe('the confirmation is shorter', () => {
  test('after registering: no "You can close this page.", and one short check-in line', async () => {
    const { doc, settle } = await page('register');
    (doc.getElementById('name') as HTMLInputElement).value = 'Jane';
    const form = doc.querySelector('[data-testid="register-form"]')!;
    form.dispatchEvent(new doc.defaultView!.Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    const success = doc.querySelector('[data-testid="form-success"]')!;
    expect(success, 'the confirmation renders').not.toBeNull();
    expect(success.textContent).not.toContain('You can close this page.');
    expect(success.querySelector('[data-testid="register-next-checkin"]')?.textContent).toBe(
      'On the day, check in with one tap.'
    );
  });
});
