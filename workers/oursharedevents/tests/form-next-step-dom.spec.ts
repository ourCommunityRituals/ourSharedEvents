/**
 * F5.3 — the next step shows in the confirmation, and only there.
 *
 * Renders the real form page (handleFormPage, stub DB), runs its scripts in
 * jsdom with a stubbed fetch, submits the form and reads the confirmation:
 *   - S-5.3.1 (OSE-479): after "You're registered!" the card offers Add to
 *     calendar (the event's .ics route), the event page and one check-in line;
 *     the confirmation carries no number at all (never a count, #885).
 *   - S-5.3.2 (OSE-480): after an email signup, "Next at this venue" is there
 *     at once, before any email is sent.
 *   - A refused submit shows no card.
 * The server-side rules for what the card may list are in
 * tests/form-next-step.spec.ts (workers pool, real D1).
 *
 * @born-red OSE-479 / OSE-480 | method: ran against form-pages.ts as on main
 * be0ba4c — the confirmation held only the heading and "You can close this
 * page." | date: 2026-10-09
 */

import { describe, test, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { handleFormPage, type FormPagesEnv } from '../src/handlers/form-pages';

const EVENT = {
  id: 'evt_dom_479',
  brand_id: 'brand_dom',
  title: 'Bocce night',
  status: 'active',
  description: null,
  location: 'Eagles Hall',
  where_address: null,
  start_date: '2026-12-05',
  end_date: null,
  starts_at: '2026-12-06T00:00:00Z',
  timezone: 'America/Chicago',
};

const NEXT = [
  {
    id: 'evt_dom_next_1',
    title: 'Trivia at the hall',
    start_date: '2026-12-12',
    location: 'Eagles Hall',
  },
];

function stubDb(next = NEXT): D1Database {
  return {
    prepare: (sql: string) => ({
      bind: () => ({
        first: async () => (sql.includes('WHERE id = ?') ? EVENT : null),
        all: async () => ({ results: sql.includes('location = ?2') ? next : [] }),
      }),
    }),
  } as unknown as D1Database;
}

async function mount(type: string, answer: Record<string, unknown>) {
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
        status: url.includes('/forms/') ? (answer.ok ? 200 : 400) : 200,
        json: async () => (url.includes('/forms/') ? answer : { ok: false }),
      });
    },
  });
  const doc = dom.window.document;
  const settle = async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
  };
  return { dom, doc, settle };
}

function submit(doc: Document, formTestId: string) {
  const form = doc.querySelector(`[data-testid="${formTestId}"]`)!;
  form.dispatchEvent(new doc.defaultView!.Event('submit', { bubbles: true, cancelable: true }));
}

describe('S-5.3.1 the registration confirmation offers the next step', () => {
  test('nothing shows before submit; after success the card is in the confirmation', async () => {
    const { doc, settle } = await mount('register', { ok: true });
    expect(doc.querySelector('[data-testid="register-next-step"]')).toBeNull();
    (doc.getElementById('name') as HTMLInputElement).value = 'Jane';
    submit(doc, 'register-form');
    await settle();
    const success = doc.querySelector('[data-testid="form-success"]')!;
    expect(success, 'the confirmation renders').not.toBeNull();
    const cal = success.querySelector('[data-testid="register-next-calendar"]')!;
    expect(cal.getAttribute('href')).toBe(`/events/${EVENT.id}/calendar.ics`);
    expect(cal.hasAttribute('download')).toBe(true);
    expect(
      success.querySelector('[data-testid="register-next-event-page"]')!.getAttribute('href')
    ).toBe(`/events/${EVENT.id}`);
    expect(success.querySelector('[data-testid="register-next-checkin"]')!.textContent).toMatch(
      /check in/i
    );
  });

  test('the confirmation carries no number and no echo of the name typed', async () => {
    const { doc, settle } = await mount('register', { ok: true });
    (doc.getElementById('name') as HTMLInputElement).value = 'Jane Q';
    submit(doc, 'register-form');
    await settle();
    const text = doc.querySelector('[data-testid="form-success"]')!.textContent || '';
    expect(text).toContain("You're registered!");
    expect(text).not.toMatch(/\d/);
    expect(text).not.toContain('Jane Q');
  });

  test('a refused submit shows no card', async () => {
    const { doc, settle } = await mount('register', { ok: false, code: 'MISSING_FIELD' });
    submit(doc, 'register-form');
    await settle();
    expect(doc.querySelector('[data-testid="form-success"]')).toBeNull();
    expect(doc.querySelector('[data-testid="register-next-step"]')).toBeNull();
  });
});

describe('S-5.3.2 the email-signup confirmation shows next at this venue at once', () => {
  test('after "You\'re on the list!" the venue list is there', async () => {
    const { doc, settle } = await mount('email-signup', { ok: true });
    (doc.getElementById('email') as HTMLInputElement).value = 'a@example.com';
    submit(doc, 'email-form');
    await settle();
    const success = doc.querySelector('[data-testid="form-success"]')!;
    expect(success.textContent).toContain("You're on the list!");
    expect(success.querySelector('[data-testid="email-next-venue"]')!.textContent).toContain(
      'Next at Eagles Hall'
    );
    const link = success.querySelector('[data-testid="email-next-venue-link-0"]')!;
    expect(link.getAttribute('href')).toBe('/events/evt_dom_next_1');
    expect(link.textContent).toContain('Trivia at the hall');
    expect(success.textContent).not.toContain('a@example.com');
  });

  test('an address already on the list gets the same payoff', async () => {
    const { doc, settle } = await mount('email-signup', { ok: true, duplicate: true });
    (doc.getElementById('email') as HTMLInputElement).value = 'a@example.com';
    submit(doc, 'email-form');
    await settle();
    const success = doc.querySelector('[data-testid="form-success"]')!;
    expect(success.textContent).toContain("You're already signed up!");
    expect(success.querySelector('[data-testid="email-next-venue"]')).not.toBeNull();
  });
});
