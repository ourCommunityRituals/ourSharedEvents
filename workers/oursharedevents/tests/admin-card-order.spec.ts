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
 * Now there is one order: the intro, the totals, Your events (pick one), Create
 * Event, then the selected event's cards in the OSE-1238 build sequence, with the
 * two poster cards side by side and the dashboard (the results) last. The jump
 * bar and the intro both follow it, and this file fails if any of the three
 * drifts.
 *
 * Owner, same day: "When returning on an edit or draft flow, the create event
 * should be suppressed into a button option with the Your Events taking
 * precedence." So Your events sits above Create Event, and once the list shows
 * the host has events (or a saved selection says they are coming back to one)
 * the form folds into "+ Start a new event". A first visit keeps it open.
 *
 * Owner, later the same day, on the jump bar: "Dashboard, Links, Registration
 * (change it to Reg & Forms), Sponsors (as expandable card so if present already
 * or want to configure is possible, but does not take up too much screen space),
 * Poster, TV", to run through the whole page. So the selected event's cards now
 * follow that order (Poster art stays beside Posters), and Sponsors folds to its
 * title and a one-line summary until opened.
 */

import { describe, test, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import ADMIN_HTML from '../src/templates/admin.html';

const doc = new JSDOM(ADMIN_HTML).window.document;
const main = doc.querySelector('main#main-content') as HTMLElement;

/** The page's sections and cards, in the order a host works through them. */
const PAGE_ORDER = [
  'admin-intro',
  'portfolio-rollup',
  'events-section',
  'create-event-card',
  'admin-dashboard-card',
  'surface-cards',
  'forms-card',
  'sponsors-card',
  'poster-deployments-card',
  'poster-art-card',
  'tv-display-card',
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
    for (const id of PAGE_ORDER.slice(PAGE_ORDER.indexOf('admin-dashboard-card'))) {
      expect(isBefore(list, byTestId(id)), `${id} is below the event list`).toBe(true);
    }
  });

  test('the intro names the cards in the order they appear', () => {
    const text = (byTestId('admin-intro').textContent || '').toLowerCase();
    const words = ['dashboard', 'links', 'reg & forms', 'sponsors', 'posters', 'tv'];
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

  describe('Create Event folds into a button for a returning host', () => {
    function foldScript(): string {
      const t = Array.from(doc.querySelectorAll('script'))
        .map((el) => el.textContent || '')
        .find((x) => x.includes('window.oseCreateCard = {'));
      expect(t, 'the fold script').toBeDefined();
      return t!;
    }

    function cardDom(saved: string | null) {
      const card = byTestId('create-event-card');
      const dom = new JSDOM('<!doctype html><body>' + card.outerHTML + '</body>', {
        runScripts: 'outside-only',
        url: 'https://stg.oursharedevents.com/admin',
      });
      const w = dom.window as unknown as Window & {
        eval: (s: string) => void;
        oseCreateCard?: { returning: () => void };
      };
      if (saved) w.sessionStorage.setItem('ose_selected_event_id', saved);
      w.eval(foldScript());
      const q = (id: string) => w.document.querySelector(`[data-testid="${id}"]`) as HTMLElement;
      return {
        w,
        form: q('create-event-form'),
        btn: q('create-event-toggle'),
        note: q('create-event-collapsed-note'),
      };
    }

    test('a first visit (no events yet) keeps the form open and no button', () => {
      const { form, btn, note } = cardDom(null);
      expect(form.hidden).toBe(false);
      expect(btn.hidden).toBe(true);
      expect(note.hidden).toBe(true);
    });

    test('once the list has events the form folds into the button', () => {
      const { w, form, btn, note } = cardDom(null);
      w.oseCreateCard!.returning();
      expect(form.hidden).toBe(true);
      expect(btn.hidden).toBe(false);
      expect(btn.getAttribute('aria-expanded')).toBe('false');
      expect(btn.textContent?.trim()).toBe('+ Start a new event');
      expect(note.hidden).toBe(false);
    });

    test('coming back to a saved event folds it before the list loads', () => {
      const { form, btn } = cardDom('evt_saved');
      expect(form.hidden).toBe(true);
      expect(btn.hidden).toBe(false);
    });

    test('the button opens the form (start over), focuses the name, and closes it again', () => {
      const { w, form, btn } = cardDom(null);
      w.oseCreateCard!.returning();
      btn.click();
      expect(form.hidden).toBe(false);
      expect(btn.getAttribute('aria-expanded')).toBe('true');
      expect(w.document.activeElement?.id).toBe('create-title');
      btn.click();
      expect(form.hidden).toBe(true);
    });

    test('a later list refresh never closes a form the host opened', () => {
      const { w, form, btn } = cardDom(null);
      w.oseCreateCard!.returning();
      btn.click();
      w.oseCreateCard!.returning();
      expect(form.hidden).toBe(false);
    });

    test('the event list tells the card when it has events', () => {
      expect(ADMIN_HTML).toContain(
        'if (L.items.length && window.oseCreateCard) window.oseCreateCard.returning();'
      );
    });
  });

  test('the bar and the card both say "Reg & Forms"', () => {
    expect(byTestId('ecb-nav-forms').textContent?.trim()).toBe('Reg & Forms');
    expect(byTestId('forms-card').querySelector('.mcard-title')?.textContent?.trim()).toBe(
      'Reg & Forms'
    );
  });

  describe('Sponsors folds to one line until opened', () => {
    function sponsorScript(): string {
      const t = Array.from(doc.querySelectorAll('script'))
        .map((el) => el.textContent || '')
        .find((x) => x.includes('window.oseSponsorsCard = (function'));
      expect(t, 'the sponsors card script').toBeDefined();
      return t!;
    }

    function sponsorsDom(items: unknown[] | null) {
      const card = byTestId('sponsors-card');
      const dom = new JSDOM('<!doctype html><body>' + card.outerHTML + '</body>', {
        runScripts: 'outside-only',
        url: 'https://stg.oursharedevents.com/admin',
      });
      const w = dom.window as unknown as Window & {
        eval: (s: string) => void;
        fetch: unknown;
        _loadSponsorsForEvent: (id: string) => Promise<void>;
      };
      w.fetch = async (url: string) => ({
        json: async () =>
          String(url).includes('/api/v2/admin/sponsors')
            ? { ok: true, items: items || [] }
            : { ok: true, items: [] },
      });
      w.eval(sponsorScript());
      const q = (id: string) => w.document.querySelector(`[data-testid="${id}"]`) as HTMLElement;
      return {
        w,
        body: q('sponsors-card-body'),
        btn: q('sponsors-card-toggle'),
        sum: q('sponsors-summary'),
      };
    }

    const placed = {
      id: 's1',
      name: 'Bakery',
      tier: 'gold',
      is_active: 1,
      sponsor_accepted: 1,
      event_id: 'e1',
    };
    const asked = {
      id: 's2',
      name: 'Hardware',
      tier: 'silver',
      is_active: 1,
      event_id: 'e1',
      placement_source: 'sponsor_request',
      placement_active: 0,
      organizer_accepted: null,
    };

    test('it starts folded: the list is hidden and the button says Show', () => {
      const { body, btn, sum } = sponsorsDom(null);
      expect(body.hidden).toBe(true);
      expect(btn.textContent?.trim()).toBe('Show');
      expect(btn.getAttribute('aria-expanded')).toBe('false');
      expect(sum.textContent).toBe('Select an event to see its sponsors.');
    });

    test('the summary says how many sponsors the event has, and the card stays folded', async () => {
      const { w, body, sum } = sponsorsDom([placed]);
      await w._loadSponsorsForEvent('e1');
      expect(sum.textContent).toBe('1 sponsor.');
      expect(body.hidden).toBe(true);
    });

    test('no sponsors reads "None yet."', async () => {
      const { w, sum } = sponsorsDom([]);
      await w._loadSponsorsForEvent('e1');
      expect(sum.textContent).toBe('None yet.');
    });

    test('a sponsor asking to join opens the card so Approve is in view', async () => {
      const { w, body, sum } = sponsorsDom([placed, asked]);
      await w._loadSponsorsForEvent('e1');
      expect(sum.textContent).toBe('1 sponsor · 1 asked to join.');
      expect(body.hidden).toBe(false);
    });

    test('Show opens the list and Hide folds it again', () => {
      const { body, btn } = sponsorsDom(null);
      btn.click();
      expect(body.hidden).toBe(false);
      expect(btn.textContent?.trim()).toBe('Hide');
      btn.click();
      expect(body.hidden).toBe(true);
    });

    test('+ Add Sponsor opens the card before the form', () => {
      const { w, body } = sponsorsDom(null);
      (w.document.getElementById('add-spon-toggle') as HTMLElement).click();
      expect(body.hidden).toBe(false);
    });

    test('the jump bar opens the card when it jumps to Sponsors', () => {
      expect(ADMIN_HTML).toContain(
        "if (cls === 'sponsors-card' && window.oseSponsorsCard) window.oseSponsorsCard.open();"
      );
    });
  });
});
