/**
 * OSE-1644 — the advanced create form says which core value is missing.
 *
 * An event cannot leave draft without a start time and an event type (409
 * CORE_VALUES_MISSING). The advanced form let an organizer create a draft with
 * neither and said nothing; the refusal arrived later, on the status panel,
 * where the values cannot be added. The form now asks once, at Create: it names
 * what is missing, marks the fields, and puts focus on the first. A second
 * press creates the draft as it is, because a draft still needs only a name.
 *
 * Runs the page's own function, taken from the admin.html Text import, in jsdom.
 */

import { describe, test, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import ADMIN_HTML from '../src/templates/admin.html';

type Check = (doc: Document) => boolean;

function mount() {
  const dom = new JSDOM(ADMIN_HTML, { url: 'https://admin.test/admin' });
  const doc = dom.window.document;
  const start = ADMIN_HTML.indexOf('window.oseCreateCoreCheck = function (doc) {');
  expect(start, 'admin.html must define window.oseCreateCoreCheck').toBeGreaterThan(-1);
  const end = ADMIN_HTML.indexOf('\n      };\n', start) + '\n      };'.length;
  const win: Record<string, unknown> = {};
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('window', ADMIN_HTML.slice(start, end))(win);
  const check = win.oseCreateCoreCheck as Check;
  const el = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;
  // The type select is filled from the catalog at run time; give it one option.
  const type = el<HTMLSelectElement>('create-event-type');
  const opt = doc.createElement('option');
  opt.value = 'type_bocce';
  opt.textContent = 'Bocce';
  type.appendChild(opt);
  type.value = '';
  const invalid = (id: string) => el(id).getAttribute('aria-invalid');
  const msg = () => (el('create-msg').textContent ?? '').replace(/\s+/g, ' ').trim();
  return { doc, check, el, type, invalid, msg };
}

describe('OSE-1644: the advanced form asks once about a missing core value', () => {
  test('nothing missing: it does not stop the Create and marks nothing', () => {
    const m = mount();
    m.el<HTMLInputElement>('create-date').value = '2026-11-14';
    m.el<HTMLInputElement>('create-time').value = '18:30';
    m.type.value = 'type_bocce';
    expect(m.check(m.doc)).toBe(false);
    for (const id of ['create-date', 'create-time', 'create-category', 'create-event-type']) {
      expect(m.invalid(id), id).toBeNull();
    }
  });

  test('time and type missing: it stops, names both, marks them and focuses the first', () => {
    const m = mount();
    m.el<HTMLInputElement>('create-date').value = '2026-11-14';
    expect(m.check(m.doc)).toBe(true);
    expect(m.msg()).toBe(
      'Add a start time and an event type before this event can be published. Press Create Event again to save it as a draft without them.'
    );
    expect(m.el('create-msg').className).toContain('error');
    expect(m.invalid('create-time')).toBe('true');
    expect(m.invalid('create-category')).toBe('true');
    // The date is there, so it is not marked.
    expect(m.invalid('create-date')).toBeNull();
    expect(m.doc.activeElement).toBe(m.el('create-time'));
  });

  test('no date either: the date is marked and takes the focus', () => {
    const m = mount();
    expect(m.check(m.doc)).toBe(true);
    expect(m.invalid('create-date')).toBe('true');
    expect(m.invalid('create-time')).toBe('true');
    expect(m.doc.activeElement).toBe(m.el('create-date'));
  });

  test('only the type missing: one value named, the wording is singular', () => {
    const m = mount();
    m.el<HTMLInputElement>('create-date').value = '2026-11-14';
    m.el<HTMLInputElement>('create-time').value = '18:30';
    expect(m.check(m.doc)).toBe(true);
    expect(m.msg()).toBe(
      'Add an event type before this event can be published. Press Create Event again to save it as a draft without it.'
    );
    expect(m.invalid('create-time')).toBeNull();
    expect(m.doc.activeElement).toBe(m.el('create-category'));
  });

  test('a second press with nothing changed creates the draft: asked once, never required', () => {
    const m = mount();
    expect(m.check(m.doc)).toBe(true);
    expect(m.check(m.doc)).toBe(false);
    expect(m.invalid('create-date')).toBeNull();
    expect(m.invalid('create-category')).toBeNull();
  });

  test('fixing one value and not the other asks again, about the one still missing', () => {
    const m = mount();
    m.el<HTMLInputElement>('create-date').value = '2026-11-14';
    expect(m.check(m.doc)).toBe(true);
    m.el<HTMLInputElement>('create-time').value = '18:30';
    expect(m.check(m.doc)).toBe(true);
    expect(m.msg()).toContain('Add an event type before');
    expect(m.invalid('create-time')).toBeNull();
  });

  test('the Create handler runs the check before it sends anything', () => {
    const handler = ADMIN_HTML.slice(
      ADMIN_HTML.indexOf("document.getElementById('create-event-form').addEventListener('submit'")
    );
    const call = handler.indexOf('if (window.oseCreateCoreCheck(document)) return;');
    const send = handler.indexOf("fetch('/api/v2/admin/events'");
    expect(call, 'the handler calls the check').toBeGreaterThan(-1);
    expect(call, 'and calls it before the request').toBeLessThan(send);
  });
});
