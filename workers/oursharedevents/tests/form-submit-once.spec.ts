/**
 * OSE-1736 — a second tap on the same phone sends one check-in, not two.
 *
 * Renders the real check-in page (handleFormPage, stub DB), runs its scripts in
 * jsdom with a counting fetch, and taps. The public answer carries no count
 * (OSE-1657), so the page reads "You're checked in." after either tap: the only
 * way to see a double count is the requests sent.
 *   - after a success, more taps (plain or walk-in) send nothing
 *   - after a failure, the button is live again and a retry goes through
 *   - while a request is in flight the button reports it busy
 *
 * This is the client half only. Server-side idempotence (a per-event,
 * per-anonymous-id check-in key) is its own ticket.
 *
 * @born-red OSE-1736 | method: ran against form-pages.ts as on main f33d1b2 —
 * handleCheckin's finally block re-enabled the button after a success, so every
 * extra tap posted again | date: 2026-10-16
 */

import { describe, test, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { handleFormPage, type FormPagesEnv } from '../src/handlers/form-pages';

const EVENT = {
  id: 'evt_once_1736',
  brand_id: 'brand_once',
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

type Answer = { ok: boolean; code?: string };

async function mountCheckin(answers: Answer[]) {
  const env = { DB: stubDb() } as FormPagesEnv;
  const res = await handleFormPage(
    new Request(`https://t.test/forms/${EVENT.id}?type=checkin`),
    env,
    EVENT.id
  );
  const html = await res.text();
  const posts: string[] = [];
  let release: (() => void) | null = null;
  let hold = false;
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: `https://t.test/forms/${EVENT.id}?type=checkin`,
    beforeParse(window) {
      (window as unknown as { fetch: unknown }).fetch = async (url: string, init?: RequestInit) => {
        if (!url.includes('/forms/checkin'))
          return { ok: true, status: 200, json: async () => ({ ok: false }) };
        posts.push(String(init?.method));
        if (hold) await new Promise<void>((r) => (release = r));
        const a = answers[Math.min(posts.length - 1, answers.length - 1)];
        return { ok: a.ok, status: a.ok ? 200 : 400, json: async () => a };
      };
    },
  });
  const doc = dom.window.document;
  const settle = async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
  };
  const tap = () => (doc.querySelector('[data-testid="checkin-submit"]') as HTMLElement).click();
  const walkIn = () =>
    (doc.querySelector('[data-testid="checkin-walk-in-submit"]') as HTMLElement).click();
  return {
    doc,
    posts,
    settle,
    tap,
    walkIn,
    holdNext: () => (hold = true),
    releaseHeld: () => {
      hold = false;
      release?.();
    },
  };
}

describe('OSE-1736 a check-in is sent once per phone', () => {
  test('a second tap after a success sends nothing', async () => {
    const p = await mountCheckin([{ ok: true }]);
    p.tap();
    await p.settle();
    expect(p.doc.querySelector('[data-testid="checkin-count"]')!.textContent).toBe(
      "You're checked in."
    );
    p.tap();
    p.tap();
    await p.settle();
    expect(p.posts).toHaveLength(1);
  });

  test('a walk-in tap after a plain check-in sends nothing, and the other way round', async () => {
    const a = await mountCheckin([{ ok: true }]);
    a.tap();
    await a.settle();
    a.walkIn();
    await a.settle();
    expect(a.posts).toHaveLength(1);

    const b = await mountCheckin([{ ok: true }]);
    b.walkIn();
    await b.settle();
    b.tap();
    await b.settle();
    expect(b.posts).toHaveLength(1);
  });

  test('taps while the first is still in flight send nothing either', async () => {
    const p = await mountCheckin([{ ok: true }]);
    p.holdNext();
    p.tap();
    await p.settle();
    p.tap();
    p.walkIn();
    await p.settle();
    expect(p.posts).toHaveLength(1);
    p.releaseHeld();
    await p.settle();
    p.tap();
    await p.settle();
    expect(p.posts).toHaveLength(1);
  });

  test('a failed submit leaves the button live, and the retry goes through', async () => {
    const p = await mountCheckin([{ ok: false, code: 'DB_ERROR' }, { ok: true }]);
    p.tap();
    await p.settle();
    const btn = p.doc.querySelector('[data-testid="checkin-submit"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(p.doc.querySelector('[data-testid="checkin-count"]')!.textContent).toBe('');
    expect(p.doc.querySelector('[data-testid="form-error"]')!.textContent).not.toBe('');
    p.tap();
    await p.settle();
    expect(p.posts).toHaveLength(2);
    expect(p.doc.querySelector('[data-testid="checkin-count"]')!.textContent).toBe(
      "You're checked in."
    );
  });

  test('the button reports busy while the request is out, and reads as spent after', async () => {
    const p = await mountCheckin([{ ok: true }]);
    const btn = p.doc.querySelector('[data-testid="checkin-submit"]') as HTMLButtonElement;
    p.holdNext();
    p.tap();
    await p.settle();
    expect(btn.getAttribute('aria-busy')).toBe('true');
    p.releaseHeld();
    await p.settle();
    expect(btn.hasAttribute('aria-busy')).toBe(false);
    expect(btn.textContent).toBe('Checked in');
    expect(btn.style.opacity).toBe('0.5');
  });

  test('the status line is a live region, so the confirmation is announced', async () => {
    const p = await mountCheckin([{ ok: true }]);
    const count = p.doc.querySelector('[data-testid="checkin-count"]')!;
    expect(count.getAttribute('role')).toBe('status');
    expect(count.getAttribute('aria-live')).toBe('polite');
  });
});
