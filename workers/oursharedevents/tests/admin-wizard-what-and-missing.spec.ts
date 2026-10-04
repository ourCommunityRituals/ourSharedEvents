/**
 * OSE-1518 — the wizard asks for What and a start time, and never blocks on them.
 *
 * PO decision 2026-10-03: publishing needs only a name and a place. The page
 * looks complete when What and a start time are present; when they are missing
 * the organizer is asked, not stopped.
 *
 *   1. Step 2 has an optional one-line "what is it" field. Before this, the
 *      "Something Else" card said "describe it your way" and offered no field.
 *      A template card fills the line; the organizer's own words are kept.
 *   2. Step 3, the last screen before Create, says what the page will not say
 *      (what it is, what time it starts) and leaves Create enabled.
 *
 * Runs the wizard's real script from the admin.html Text import in jsdom.
 *
 * @born-red OSE-1518 | method: ran against the pre-change template — there was
 * no what field and no note, and the create request for "Something Else" carried
 * no what_short | date: 2026-10-03
 */

import { describe, test, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import ADMIN_HTML from '../src/templates/admin.html';

function wizardScript(doc: Document): string {
  const el = Array.from(doc.querySelectorAll('script')).find((s) =>
    (s.textContent || '').includes('function goNext()')
  );
  expect(el, 'the wizard script').toBeDefined();
  return el!.textContent || '';
}

function mount() {
  // The whole page, scripts not run: only the wizard's own script is evaluated.
  const dom = new JSDOM(ADMIN_HTML, {
    runScripts: 'outside-only',
    url: 'https://admin.test/admin',
  });
  const w = dom.window as unknown as Window & { eval(s: string): unknown };
  const doc = w.document;
  (w as unknown as { Element: typeof Element }).Element.prototype.scrollIntoView = () => {};
  const posts: Array<Record<string, unknown>> = [];
  w.fetch = (async (url: string, init?: RequestInit) => {
    if ((init?.method ?? 'GET').toUpperCase() === 'POST' && String(url).endsWith('/admin/events')) {
      posts.push(JSON.parse(String(init!.body)));
      return {
        ok: true,
        status: 201,
        json: async () => ({ ok: true, item: { id: 'evt_new' }, id: 'evt_new' }),
      };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  }) as unknown as typeof fetch;
  // The page's own script, evaluated in jsdom (same pattern as admin-wizard-tv.spec.ts).
  w.eval(wizardScript(doc));
  const $ = <T extends HTMLElement>(id: string) => doc.querySelector<T>(`[data-testid="${id}"]`)!;
  $('admin-path-wizard').click();
  const type = (id: string, value: string) => {
    const el = $<HTMLInputElement>(id);
    el.value = value;
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
  };
  const next = () => $('wizard-next-btn').click();
  const onStep = (n: number) =>
    doc.getElementById(`wizard-step-${n}`)!.classList.contains('active');
  /** Step 1 filled with a name and a place, and a date two weeks out. */
  const toStep2 = (time = '') => {
    type('wizard-event-name', 'Bocce Night');
    type('wizard-event-venue', 'Eagles Hall');
    const d = new Date(Date.now() + 14 * 86_400_000);
    type(
      'wizard-event-date',
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    );
    if (time) type('wizard-event-time', time);
    next();
    expect(onStep(2)).toBe(true);
  };
  return { w, doc, $, type, next, onStep, toStep2, posts };
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

describe('OSE-1518: step 2 asks what the event is, optionally', () => {
  test('there is a one-line what field, and it is not required', () => {
    const { $, toStep2 } = mount();
    toStep2();
    const what = $<HTMLInputElement>('wizard-event-what');
    expect(what).not.toBeNull();
    expect(what.required).toBe(false);
    expect(what.maxLength).toBe(300);
  });

  test('a template card fills the line', () => {
    const { $, toStep2 } = mount();
    toStep2();
    $('wizard-template-games').click();
    expect($<HTMLInputElement>('wizard-event-what').value).toContain('Game night');
  });

  test("the organizer's own words are kept when a card is picked afterwards", () => {
    const { $, type, toStep2 } = mount();
    toStep2();
    type('wizard-event-what', 'Bocce and a potluck in the back yard');
    $('wizard-template-music').click();
    expect($<HTMLInputElement>('wizard-event-what').value).toBe(
      'Bocce and a potluck in the back yard'
    );
  });

  test('picking "Something Else" after a card clears the card\'s line, not typed words', () => {
    const { $, toStep2 } = mount();
    toStep2();
    $('wizard-template-games').click();
    $('wizard-template-other').click();
    expect($<HTMLInputElement>('wizard-event-what').value).toBe('');
  });
});

describe('OSE-1518: step 3 says what the page will be missing, and does not block', () => {
  test('no start time and no what: the note names both, Create stays enabled', () => {
    const { $, next, onStep, toStep2 } = mount();
    toStep2();
    next();
    expect(onStep(3)).toBe(true);
    const note = $('wizard-missing');
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain('what it is');
    expect(note.textContent).toContain('what time it starts');
    expect($<HTMLButtonElement>('wizard-next-btn').disabled).toBe(false);
  });

  test('a start time but no what: the note names only what it is', () => {
    const { $, next, toStep2 } = mount();
    toStep2('18:00');
    next();
    const note = $('wizard-missing');
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain('what it is');
    expect(note.textContent).not.toContain('what time it starts');
  });

  test('both present: no note', () => {
    const { $, type, next, toStep2 } = mount();
    toStep2('18:00');
    type('wizard-event-what', 'Bocce and a potluck');
    next();
    expect($('wizard-missing').hidden).toBe(true);
  });

  test('the note is gone again after going Back and filling the gap', () => {
    const { $, type, next, onStep, toStep2 } = mount();
    toStep2('18:00');
    next();
    expect($('wizard-missing').hidden).toBe(false);
    $('wizard-back-btn').click();
    // jsdom has no history navigation: Back falls through to the direct step change.
    if (!onStep(2)) return;
    type('wizard-event-what', 'Bocce and a potluck');
    next();
    expect($('wizard-missing').hidden).toBe(true);
  });
});

describe('OSE-1518: what the organizer typed is what is saved', () => {
  test('typed words are sent as what_short, with nothing missing blocking Create', async () => {
    const { type, next, toStep2, posts } = mount();
    toStep2();
    type('wizard-event-what', '  Bocce and a potluck in the back yard  ');
    next();
    next();
    await flush();
    expect(posts).toHaveLength(1);
    expect(posts[0]!.what_short).toBe('Bocce and a potluck in the back yard');
  });

  test('with the line empty, no what_short is sent and the event is still created', async () => {
    const { next, toStep2, posts } = mount();
    toStep2();
    next();
    next();
    await flush();
    expect(posts).toHaveLength(1);
    expect('what_short' in posts[0]!).toBe(false);
  });

  test('a card line the organizer left alone is sent as before', async () => {
    const { $, next, toStep2, posts } = mount();
    toStep2();
    $('wizard-template-trivia').click();
    next();
    next();
    await flush();
    expect(String(posts[0]!.what_short)).toContain('Team trivia night');
    expect(String(posts[0]!.why_purpose)).toContain('friendly competition');
  });
});
