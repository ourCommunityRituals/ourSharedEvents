/**
 * The admin page reads top to bottom in one order (owner report 2026-10-10:
 * "the card flow jumps around").
 *
 * Before this, three things disagreed. The intro said "start with the event
 * list ... then dashboard, forms, poster, sponsors, and surfaces in order", but
 * the intro and the event list sat at the very bottom of the page, under the
 * cards they said were "below". The jump bar went Dashboard, Forms, Poster,
 * Sponsors, TV, Surfaces, while the cards went Sponsors, Registration, Posters,
 * TV, Poster art, Surfaces, Dashboard. So did the build sequence the owner set
 * on 2026-09-05 (OSE-1238): Create Event -> Sponsors -> Registration -> Posters
 * -> the links.
 *
 * Now there is one order: the intro, Create Event, the totals, Your events (pick
 * one), then the selected event's cards in the OSE-1238 build sequence, with the
 * two poster cards side by side and the dashboard (the results) last. The jump
 * bar and the intro both follow it, and this file fails if any of the three
 * drifts.
 */

import { describe, test, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import ADMIN_HTML from '../src/templates/admin.html';

const doc = new JSDOM(ADMIN_HTML).window.document;
const main = doc.querySelector('main#main-content') as HTMLElement;

/** The page's sections and cards, in the order a host works through them. */
const PAGE_ORDER = [
  'admin-intro',
  'create-event-card',
  'portfolio-rollup',
  'events-section',
  'sponsors-card',
  'forms-card',
  'poster-deployments-card',
  'poster-art-card',
  'tv-display-card',
  'surface-cards',
  'admin-dashboard-card',
];

function byTestId(id: string): Element {
  const el = doc.querySelector(`[data-testid="${id}"]`);
  expect(el, `[data-testid="${id}"] exists`).not.toBeNull();
  return el!;
}

function isBefore(a: Element, b: Element): boolean {
  // DOCUMENT_POSITION_FOLLOWING (4): b comes after a.
  return (a.compareDocumentPosition(b) & 4) !== 0;
}

describe('admin page order', () => {
  test('every section and card is inside <main>', () => {
    expect(main, 'main#main-content').not.toBeNull();
    for (const id of PAGE_ORDER) {
      expect(main.contains(byTestId(id)), `${id} inside <main>`).toBe(true);
    }
  });

  test('the sections and cards appear in the host’s order, top to bottom', () => {
    const els = PAGE_ORDER.map(byTestId);
    const actual = [...els]
      .sort((a, b) => (isBefore(a, b) ? -1 : 1))
      .map((el) => el.getAttribute('data-testid'));
    expect(actual).toEqual(PAGE_ORDER);
  });

  test('the selected-event jump bar lists its cards in the same order as the page', () => {
    const buttons = Array.from(doc.querySelectorAll('#event-context-bar .ecb-nav button'));
    expect(buttons.length).toBeGreaterThanOrEqual(5);
    const targets = buttons.map((b) => {
      const cls = b.getAttribute('data-target') || '';
      const card = doc.querySelector('.' + cls);
      expect(card, `jump target .${cls} exists`).not.toBeNull();
      return card!;
    });
    for (let i = 1; i < targets.length; i++) {
      const prev = buttons[i - 1].textContent?.trim();
      const cur = buttons[i].textContent?.trim();
      expect(
        isBefore(targets[i - 1], targets[i]),
        `"${prev}" card comes before "${cur}" card`
      ).toBe(true);
    }
  });

  test('the event list says the cards are below it, and they are', () => {
    const list = byTestId('events-section');
    expect(list.textContent || '').toMatch(/cards below/);
    for (const id of PAGE_ORDER.slice(PAGE_ORDER.indexOf('sponsors-card'))) {
      expect(isBefore(list, byTestId(id)), `${id} is below the event list`).toBe(true);
    }
  });

  test('the intro names the cards in the order they appear', () => {
    const text = (byTestId('admin-intro').textContent || '').toLowerCase();
    const words = ['sponsors', 'registration', 'posters', 'tv', 'links', 'dashboard'];
    let from = 0;
    for (const w of words) {
      const at = text.indexOf(w, from);
      expect(at, `intro names "${w}" after the one before it`).toBeGreaterThan(-1);
      from = at + w.length;
    }
  });

  test('a jump lands the card under the sticky bar, not beneath it', () => {
    const script = Array.from(doc.querySelectorAll('script'))
      .map((el) => el.textContent || '')
      .find((t) => t.includes('window.ecbJump = function'));
    expect(script, 'the jump script').toBeDefined();
    const dom = new JSDOM(
      '<div id="event-context-bar"></div><section class="tv-display-card"></section>',
      { runScripts: 'outside-only' }
    );
    const w = dom.window as unknown as Window & {
      ecbJump: (cls: string) => void;
      eval: (s: string) => void;
    };
    let scrolled = 0;
    w.Element.prototype.scrollIntoView = () => {
      scrolled++;
    };
    Object.defineProperty(w.HTMLElement.prototype, 'offsetHeight', { get: () => 120 });
    w.eval(script!);
    w.ecbJump('tv-display-card');
    const card = w.document.querySelector('.tv-display-card') as HTMLElement;
    expect(scrolled).toBe(1);
    expect(card.style.scrollMarginTop).toBe('136px');
  });
});
