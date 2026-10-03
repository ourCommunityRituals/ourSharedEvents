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
    expect($('wizard-msg').textContent).toBe('Add a name and a place to continue');
  });

  test('Enter in the place field with both filled moves to step 2', () => {
    const { type, enter, onStep } = mount();
    type('wizard-event-name', 'Bocce Night');
    type('wizard-event-venue', 'Eagles Hall');
    enter('wizard-event-venue');
    expect(onStep(2)).toBe(true);
  });
});
