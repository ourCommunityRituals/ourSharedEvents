/**
 * OSE-1515 — a first-timer is never stuck on step 1 of the Create Event wizard
 * without knowing why.
 *
 *   1. Next stays enabled. Pressed with the name or the place empty, it says
 *      why, marks the empty field aria-invalid and moves focus to it. A disabled
 *      button is skipped by Tab and silent to a screen reader.
 *   2. A date that has passed is asked about once, then allowed (an organizer
 *      may be logging a past event).
 *   3. Enter in the name or place field acts as Next.
 *
 * Runs the wizard's real script from the admin.html Text import in jsdom.
 *
 * @born-red OSE-1515 | method: ran against the pre-change template — Next was
 * disabled with an empty field, no message or aria-invalid appeared, a 2020
 * date moved straight to step 2 and Enter did nothing | date: 2026-10-03
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
  w.eval(wizardScript(doc));
  const $ = <T extends HTMLElement>(id: string) => doc.querySelector<T>(`[data-testid="${id}"]`)!;
  $('admin-path-wizard').click();
  const type = (id: string, value: string) => {
    const el = $<HTMLInputElement>(id);
    el.value = value;
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
  };
  const enter = (id: string) =>
    $(id).dispatchEvent(
      new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
  const onStep = (n: number) =>
    doc.getElementById(`wizard-step-${n}`)!.classList.contains('active');
  return { w, doc, $, type, enter, onStep };
}

describe('OSE-2012: step 1 asks how people take part', () => {
  const choose = (m: ReturnType<typeof mount>, value: string) => {
    const el = m.$<HTMLSelectElement>('wizard-event-mode');
    el.value = value;
    el.dispatchEvent(new m.w.Event('change', { bubbles: true }));
  };

  test('the question is there, required, with the three choices and no meeting-link field', () => {
    const { $, doc } = mount();
    const mode = $<HTMLSelectElement>('wizard-event-mode');
    expect(mode.getAttribute('aria-required')).toBe('true');
    expect(Array.from(mode.options).map((o) => [o.value, o.textContent])).toEqual([
      ['in_person', 'In person'],
      ['online', 'Online'],
      ['both', 'Online and in person'],
    ]);
    // It starts on in person: the step has always asked for a place.
    expect(mode.value).toBe('in_person');
    expect(doc.querySelector(`label[for="${mode.id}"]`)?.textContent).toContain(
      'How do people take part?'
    );
    // No field in the whole admin asks for a meeting link: none is stored.
    const linkish = Array.from(doc.querySelectorAll('input, textarea, select'))
      .map((e) => `${e.id} ${e.getAttribute('name') ?? ''} ${e.getAttribute('placeholder') ?? ''}`)
      .filter((s) => /meeting|zoom|join[ _-]?(link|url)|stream/i.test(s));
    expect(linkish).toEqual([]);
  });

  test('online: the place goes away, is emptied, and is no longer needed', () => {
    const m = mount();
    m.type('wizard-event-name', 'Data class');
    m.type('wizard-event-venue', 'Eagles Hall');
    choose(m, 'online');
    const venue = m.$<HTMLInputElement>('wizard-event-venue');
    expect(m.doc.getElementById('wizard-event-venue-field')!.hidden).toBe(true);
    expect(venue.value).toBe('');
    expect(venue.required).toBe(false);
    expect(m.$('wizard-event-mode-note').hidden).toBe(false);
    // The map question goes too: an online event is never on the map or the list.
    expect(m.$('wizard-publish').hidden).toBe(true);
    m.$('wizard-next-btn').click();
    expect(m.onStep(2), 'an online event needs no place').toBe(true);
  });

  test('in person and both still need the place, and the message says so', () => {
    for (const mode of ['in_person', 'both']) {
      const m = mount();
      m.type('wizard-event-name', 'Bocce Night');
      choose(m, 'online');
      choose(m, mode);
      expect(m.doc.getElementById('wizard-event-venue-field')!.hidden, mode).toBe(false);
      expect(m.$('wizard-event-mode-note').hidden, mode).toBe(true);
      expect(m.$('wizard-publish').hidden, mode).toBe(false);
      m.$('wizard-next-btn').click();
      expect(m.onStep(1), mode).toBe(true);
      expect(m.$('wizard-msg').textContent, mode).toBe('Add a place to continue');
      expect(m.$('wizard-event-venue').getAttribute('aria-invalid'), mode).toBe('true');
    }
  });

  test('online with no name: only the name is asked for', () => {
    const m = mount();
    choose(m, 'online');
    m.$('wizard-next-btn').click();
    expect(m.onStep(1)).toBe(true);
    expect(m.$('wizard-msg').textContent).toBe('Add a name to continue');
  });
});

function isoDaysFromNow(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('OSE-1515: wizard step 1 says why Next is blocked', () => {
  test('Next is enabled on an empty step 1', () => {
    const { $, onStep } = mount();
    expect(onStep(1)).toBe(true);
    expect($<HTMLButtonElement>('wizard-next-btn').disabled).toBe(false);
  });

  test('Next with both fields empty: message, both marked invalid, focus on the name', () => {
    const { $, doc, onStep } = mount();
    $('wizard-next-btn').click();
    expect(onStep(1), 'stays on step 1').toBe(true);
    expect($('wizard-msg').textContent).toBe('Add a name and a place to continue');
    expect($('wizard-event-name').getAttribute('aria-invalid')).toBe('true');
    expect($('wizard-event-venue').getAttribute('aria-invalid')).toBe('true');
    expect(doc.activeElement).toBe($('wizard-event-name'));
  });

  test('Next with only the place empty: only the place is marked, and gets focus', () => {
    const { $, doc, type, onStep } = mount();
    type('wizard-event-name', 'Bocce Night');
    $('wizard-next-btn').click();
    expect(onStep(1)).toBe(true);
    expect($('wizard-event-name').hasAttribute('aria-invalid')).toBe(false);
    expect($('wizard-event-venue').getAttribute('aria-invalid')).toBe('true');
    expect(doc.activeElement).toBe($('wizard-event-venue'));
  });

  test('typing in a marked field clears its mark; filling both clears the message', () => {
    const { $, type } = mount();
    $('wizard-next-btn').click();
    type('wizard-event-name', 'Bocce Night');
    expect($('wizard-event-name').hasAttribute('aria-invalid')).toBe(false);
    expect($('wizard-event-venue').getAttribute('aria-invalid')).toBe('true');
    type('wizard-event-venue', 'Eagles Hall');
    expect($('wizard-event-venue').hasAttribute('aria-invalid')).toBe(false);
    expect($('wizard-msg').textContent).toBe('');
  });

  test('both filled: Next moves to step 2', () => {
    const { $, type, onStep } = mount();
    type('wizard-event-name', 'Bocce Night');
    type('wizard-event-venue', 'Eagles Hall');
    $('wizard-next-btn').click();
    expect(onStep(2)).toBe(true);
  });
});

describe('OSE-1515: a past date is asked about, then allowed', () => {
  test('first Next warns and stays; second Next continues', () => {
    const { $, type, onStep } = mount();
    type('wizard-event-name', 'Bocce Night');
    type('wizard-event-venue', 'Eagles Hall');
    type('wizard-event-date', '2020-05-01');
    $('wizard-next-btn').click();
    expect(onStep(1), 'stays on step 1 the first time').toBe(true);
    expect($('wizard-msg').textContent).toContain('That date has passed. Is that right?');
    $('wizard-next-btn').click();
    expect(onStep(2), 'the organizer may keep a past date').toBe(true);
  });

  test('changing to another past date asks again', () => {
    const { $, type, onStep } = mount();
    type('wizard-event-name', 'Bocce Night');
    type('wizard-event-venue', 'Eagles Hall');
    type('wizard-event-date', '2020-05-01');
    $('wizard-next-btn').click();
    type('wizard-event-date', '2019-05-01');
    $('wizard-next-btn').click();
    expect(onStep(1)).toBe(true);
    expect($('wizard-msg').textContent).toContain('That date has passed. Is that right?');
  });

  test('today and future dates never warn', () => {
    for (const days of [0, 30]) {
      const { $, type, onStep } = mount();
      type('wizard-event-name', 'Bocce Night');
      type('wizard-event-venue', 'Eagles Hall');
      type('wizard-event-date', isoDaysFromNow(days));
      $('wizard-next-btn').click();
      expect(onStep(2), `${days} days out`).toBe(true);
    }
  });
});

describe('OSE-1515: Enter acts as Next on step 1', () => {
  test('Enter in the name field with the place empty shows why', () => {
    const { $, type, enter, onStep } = mount();
    type('wizard-event-name', 'Bocce Night');
    enter('wizard-event-name');
    expect(onStep(1)).toBe(true);
    // OSE-2012: the message names what is missing.
    expect($('wizard-msg').textContent).toBe('Add a place to continue');
  });

  test('Enter in the place field with both filled moves to step 2', () => {
    const { type, enter, onStep } = mount();
    type('wizard-event-name', 'Bocce Night');
    type('wizard-event-venue', 'Eagles Hall');
    enter('wizard-event-venue');
    expect(onStep(2)).toBe(true);
  });
});
