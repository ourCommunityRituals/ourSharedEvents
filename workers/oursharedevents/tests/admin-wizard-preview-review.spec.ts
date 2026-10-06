/**
 * OSE-1528 (first slice) — the create flow shows what you are making as you
 * make it, checks it before publish, and lets you fix a fact without starting
 * over.
 *
 *   1. A live preview of the event page header sits beside the form (below it on
 *      a phone). It is drawn in the browser from the fields, updates as the
 *      organizer types, works before anything is saved, and calls no endpoint
 *      at all (nothing is published, listed or sent while typing).
 *   2. Step 5 opens with a review: name, when, event type, where, map, codes.
 *      Missing core values use the server's own CORE_VALUES_MISSING sentence.
 *   3. Each row has Change, which goes back to the right field (the event is
 *      already saved, so this is an edit, not a second Create). Save puts one
 *      PUT and returns to the review.
 *   4. Publish with a core value missing says so and sends nothing.
 *
 * Runs the page's real scripts from the admin.html Text import in jsdom.
 *
 * @born-red OSE-1528 | method: ran against the pre-change template — there was
 * no preview, no review, no Change buttons and Publish went straight to the
 * server | date: 2026-10-04
 */

import { describe, test, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import ADMIN_HTML from '../src/templates/admin.html';

function scriptWith(doc: Document, marker: string): string {
  const el = Array.from(doc.querySelectorAll('script')).find((s) =>
    (s.textContent || '').includes(marker)
  );
  expect(el, `script containing ${marker}`).toBeDefined();
  return el!.textContent || '';
}

type Call = { url: string; method: string; body: unknown };

const CATALOG = {
  ok: true,
  categories: [
    {
      code: 'sports',
      name: 'Sports',
      types: [{ id: 'type_bocce', name: 'Bocce', uec_code: '12.01' }],
    },
  ],
};

function mount(opts: { putOk?: boolean } = {}) {
  const dom = new JSDOM(ADMIN_HTML, {
    runScripts: 'outside-only',
    url: 'https://admin.test/admin',
  });
  const w = dom.window as unknown as Window & { eval(s: string): unknown } & Record<
      string,
      unknown
    >;
  const doc = w.document;
  (w as unknown as { Element: typeof Element }).Element.prototype.scrollIntoView = () => {};
  const calls: Call[] = [];
  w.fetch = (async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (String(url).endsWith('/admin/event-types')) {
      return {
        ok: true,
        status: 200,
        json: async () => CATALOG,
        text: async () => JSON.stringify(CATALOG),
      };
    }
    if (method === 'POST' && String(url).endsWith('/admin/events')) {
      const b = { ok: true, id: 'evt_new', item: { id: 'evt_new' } };
      return { ok: true, status: 201, json: async () => b, text: async () => JSON.stringify(b) };
    }
    if (method === 'PUT') {
      const ok = opts.putOk !== false;
      const b = ok ? { ok: true } : { ok: false, error: 'Nope, that did not save' };
      return {
        ok,
        status: ok ? 200 : 400,
        json: async () => b,
        text: async () => JSON.stringify(b),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
      text: async () => '{"ok":true}',
    };
  }) as unknown as typeof fetch;
  // The page's scripts in page order: type picker, wizard, preview/review.
  w.eval(scriptWith(doc, 'OSE-1344 — ONE event-type picker'));
  w.eval(scriptWith(doc, 'function goNext()'));
  let previewSrc = '';
  try {
    previewSrc = scriptWith(doc, 'oseWizardPreview: the page you are making');
  } catch {
    /* pre-change template: no preview script */
  }
  if (previewSrc) w.eval(previewSrc);
  const goLive: Array<[string, string]> = [];
  w.goLiveFromDraft = (id: string, from: string) => {
    goLive.push([id, from]);
    return Promise.resolve({ ok: true, from, listedFrom: null });
  };
  const $ = <T extends HTMLElement>(id: string) => doc.querySelector<T>(`[data-testid="${id}"]`)!;
  $('admin-path-wizard').click();
  const fire = (el: Element, type: string) =>
    el.dispatchEvent(new w.Event(type, { bubbles: true }));
  const type = (id: string, value: string) => {
    const el = $<HTMLInputElement>(id);
    el.value = value;
    fire(el, 'input');
  };
  const next = () => $('wizard-next-btn').click();
  const onStep = (n: number) =>
    doc.getElementById(`wizard-step-${n}`)!.classList.contains('active');
  const flush = async () => {
    for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
  };
  const chooseType = async () => {
    await flush();
    const cat = $<HTMLSelectElement>('wizard-category');
    cat.value = 'sports';
    fire(cat, 'change');
    const t = $<HTMLSelectElement>('wizard-event-type');
    t.value = 'type_bocce';
    fire(t, 'change');
  };
  const txt = (id: string) => ($(id)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  return { w, doc, $, calls, goLive, fire, type, next, onStep, flush, chooseType, txt };
}

function isoDaysFromNow(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type M = ReturnType<typeof mount>;

/** Fill step 1, optionally the type, then Create; ends on step 5 with the event saved. */
async function toReview(m: M, o: { time?: string; withType?: boolean } = {}) {
  m.type('wizard-event-name', 'Bocce Night');
  m.type('wizard-event-venue', 'Eagles Hall');
  m.type('wizard-event-date', isoDaysFromNow(14));
  if (o.time) m.type('wizard-event-time', o.time);
  m.next();
  if (o.withType) await m.chooseType();
  m.next();
  m.next(); // Create Event
  await m.flush();
  expect(m.onStep(4), 'created, on step 4').toBe(true);
  m.next();
  expect(m.onStep(5), 'on step 5').toBe(true);
}

describe('OSE-1528: the live preview', () => {
  test('there is a preview beside the form, with an empty state before anything is typed', () => {
    const { $, txt } = mount();
    expect($('wizard-preview')).not.toBeNull();
    expect(txt('wizard-preview-title')).toBe('Your event name');
    expect($('wizard-preview-title').getAttribute('data-empty')).toBe('true');
    expect(txt('wizard-preview-where')).toContain('Add a place');
  });

  test('typing the name and the place updates the preview with no click', () => {
    const { type, txt } = mount();
    type('wizard-event-name', 'Thursday Trivia');
    type('wizard-event-venue', 'Rock Island Public House');
    expect(txt('wizard-preview-title')).toBe('Thursday Trivia');
    expect(txt('wizard-preview-where')).toContain('Rock Island Public House');
  });

  test('the when line is in the event zone, the way the public page says it', () => {
    const { type, $, fire, txt } = mount();
    type('wizard-event-date', '2026-10-24');
    type('wizard-event-time', '18:00');
    expect(txt('wizard-preview-when')).toBe('Saturday, October 24, 2026 · 6:00 PM CDT');
    const tz = $<HTMLSelectElement>('wizard-event-tz');
    tz.value = 'America/Los_Angeles';
    fire(tz, 'change');
    expect(txt('wizard-preview-when')).toBe('Saturday, October 24, 2026 · 6:00 PM PDT');
    type('wizard-event-date', '2027-01-16');
    tz.value = 'America/Chicago';
    fire(tz, 'change');
    expect(txt('wizard-preview-when')).toBe('Saturday, January 16, 2027 · 6:00 PM CST');
  });

  test('a date with no time names the zone, and a time with no date asks for a date', () => {
    const { type, txt } = mount();
    type('wizard-event-date', '2026-10-24');
    expect(txt('wizard-preview-when')).toBe('Saturday, October 24, 2026 · Central Time');
    type('wizard-event-date', '');
    type('wizard-event-time', '18:00');
    expect(txt('wizard-preview-when')).toContain('date');
    expect(txt('wizard-preview-when')).not.toContain('NaN');
  });

  test('typed text is drawn as text, never as markup', () => {
    const { type, $, doc } = mount();
    const evil = '<img src=x onerror="window.pwned=1"><script>window.pwned=2</script>';
    type('wizard-event-name', evil);
    type('wizard-event-venue', evil);
    type('wizard-event-what', evil);
    const card = $('wizard-preview');
    expect(card.querySelector('img, script')).toBeNull();
    expect($('wizard-preview-title').textContent).toBe(evil);
    expect(doc.defaultView!.hasOwnProperty('pwned')).toBe(false);
  });

  test('the category and type show as "Category > Type"', async () => {
    const m = mount();
    await m.chooseType();
    expect(m.txt('wizard-preview-type')).toBe('Sports > Bocce');
  });

  test('the what line shows, and a template card feeds it', () => {
    const { $, type, txt } = mount();
    type('wizard-event-what', 'Bocce and a potluck');
    expect(txt('wizard-preview-what')).toBe('Bocce and a potluck');
    type('wizard-event-what', '');
    $('wizard-template-games').click();
    expect(txt('wizard-preview-what')).toContain('Game night');
  });

  test('the map note follows the on-the-map choice', () => {
    const { $, txt } = mount();
    // A new event is off the map until the organizer says otherwise.
    expect(txt('wizard-preview-map')).toContain('Off the map');
    $('wizard-publish-yes').click();
    expect(txt('wizard-preview-map')).toContain('On the map');
    $('wizard-publish-no').click();
    expect(txt('wizard-preview-map')).toContain('Off the map');
  });

  test('the sponsor strip holds its place below the title and date, above the facts', () => {
    const { $ } = mount();
    const order = ['title', 'when', 'sponsors', 'what', 'where'].map((k) =>
      $(`wizard-preview-${k}`)
    );
    for (let i = 0; i < order.length - 1; i++) {
      const rel = order[i]!.compareDocumentPosition(order[i + 1]!);
      expect(rel & 4, `${i} precedes ${i + 1}`).toBeTruthy();
    }
  });

  test('typing sends no request at all: nothing is published, listed or saved', async () => {
    const m = mount();
    await m.flush();
    const before = m.calls.length;
    m.type('wizard-event-name', 'Thursday Trivia');
    m.type('wizard-event-venue', 'Eagles Hall');
    m.type('wizard-event-date', '2026-10-24');
    m.type('wizard-event-time', '18:00');
    m.type('wizard-event-what', 'x');
    m.$('wizard-publish-no').click();
    m.$('wizard-template-music').click();
    expect(m.calls.length).toBe(before);
    expect(m.calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  test('the preview script itself never calls fetch or beacons', () => {
    const doc = new JSDOM(ADMIN_HTML).window.document;
    const src = scriptWith(doc, 'oseWizardPreview: the page you are making');
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toMatch(/sendBeacon|XMLHttpRequest|WebSocket|EventSource/);
    expect(src).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });

  test('on a phone the preview can be folded away and brought back', () => {
    const { $ } = mount();
    const toggle = $<HTMLButtonElement>('wizard-preview-toggle');
    const body = $('wizard-preview-card');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(body.hidden).toBe(false);
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(body.hidden).toBe(true);
    toggle.click();
    expect(body.hidden).toBe(false);
  });

  test('the preview keeps working after the event is saved, in the same place', async () => {
    const m = mount();
    await toReview(m, { time: '18:30' });
    m.type('wizard-event-name', 'Renamed Night');
    expect(m.txt('wizard-preview-title')).toBe('Renamed Night');
  });
});

describe('OSE-1528: the review before publish', () => {
  test('it lists name, when, type, where, map and codes with their values', async () => {
    const m = mount();
    await toReview(m, { time: '18:30', withType: true });
    const row = (k: string) => m.txt(`wizard-review-row-${k}`);
    expect(row('title')).toContain('Bocce Night');
    expect(row('when')).toContain('6:30 PM');
    expect(row('type')).toContain('Sports > Bocce');
    expect(row('where')).toContain('Eagles Hall');
    expect(row('map')).toMatch(/off the map/i);
    expect(row('codes')).toMatch(/poster/i);
    expect(m.$('wizard-review-missing').hidden).toBe(true);
  });

  test('with no start time and no type it says exactly what the server says', async () => {
    const m = mount();
    await toReview(m);
    const note = m.$('wizard-review-missing');
    expect(note.hidden).toBe(false);
    expect(note.textContent).toBe(
      'Add a start time and an event type before this event goes further'
    );
    expect(m.$('wizard-review-row-when').getAttribute('data-missing')).toBe('true');
    expect(m.$('wizard-review-row-type').getAttribute('data-missing')).toBe('true');
    expect(m.$('wizard-review-row-title').getAttribute('data-missing')).toBeNull();
  });

  test('it lists only what is missing: a time but no type', async () => {
    const m = mount();
    await toReview(m, { time: '18:30' });
    expect(m.$('wizard-review-missing').textContent).toBe(
      'Add an event type before this event goes further'
    );
    expect(m.$('wizard-review-row-when').getAttribute('data-missing')).toBeNull();
    expect(m.$('wizard-review-row-type').getAttribute('data-missing')).toBe('true');
  });

  test('it lists only what is missing: a type but no time', async () => {
    const m = mount();
    await toReview(m, { withType: true });
    expect(m.$('wizard-review-missing').textContent).toBe(
      'Add a start time before this event goes further'
    );
    expect(m.$('wizard-review-row-type').getAttribute('data-missing')).toBeNull();
  });

  test('the review names the sign-up code only when sign-ups were chosen', async () => {
    const a = mount();
    await toReview(a, { time: '18:30', withType: true });
    expect(a.txt('wizard-review-row-codes')).toMatch(/sign-up/i);
    const b = mount();
    b.type('wizard-event-name', 'Bocce Night');
    b.type('wizard-event-venue', 'Eagles Hall');
    b.type('wizard-event-date', isoDaysFromNow(14));
    b.next();
    b.next();
    b.$('wizard-signup-none').click();
    b.next();
    await b.flush();
    b.next();
    expect(b.txt('wizard-review-row-codes')).not.toMatch(/sign-up/i);
  });

  test('Publish with a core value missing says why and sends nothing', async () => {
    const m = mount();
    await toReview(m);
    const before = m.calls.length;
    m.$('wizard-go-live-btn').click();
    await m.flush();
    expect(m.goLive).toEqual([]);
    expect(m.calls.length).toBe(before);
    expect(m.txt('wizard-go-live-msg')).toBe(
      'Add a start time and an event type before this event goes further'
    );
    expect(m.$('wizard-go-live-msg').className).toContain('error');
  });

  test('Publish with everything present goes through', async () => {
    const m = mount();
    await toReview(m, { time: '18:30', withType: true });
    m.$('wizard-go-live-btn').click();
    await m.flush();
    expect(m.goLive).toEqual([['evt_new', 'draft']]);
  });
});

describe('OSE-1528: Change goes back to the right field, and Save returns to the review', () => {
  test('Change on the time row opens step 1 on the time field, in edit mode', async () => {
    const m = mount();
    await toReview(m, { withType: true });
    m.$('wizard-review-change-when').click();
    expect(m.onStep(1)).toBe(true);
    expect(m.doc.activeElement).toBe(m.$('wizard-event-time'));
    expect(m.$('wizard-save-edit-btn').hidden).toBe(false);
    expect(m.$('wizard-cancel-edit-btn').hidden).toBe(false);
    expect(m.$('wizard-next-btn').hidden).toBe(true);
    expect(m.$('wizard-back-btn').hidden).toBe(true);
  });

  test('Change on the type row opens step 2 on the category', async () => {
    const m = mount();
    await toReview(m, { time: '18:30' });
    m.$('wizard-review-change-type').click();
    expect(m.onStep(2)).toBe(true);
    expect(m.doc.activeElement).toBe(m.$('wizard-category'));
  });

  test('Change on name and place opens step 1 on that field', async () => {
    const m = mount();
    await toReview(m, { time: '18:30', withType: true });
    m.$('wizard-review-change-title').click();
    expect(m.doc.activeElement).toBe(m.$('wizard-event-name'));
    m.$('wizard-cancel-edit-btn').click();
    m.$('wizard-review-change-where').click();
    expect(m.doc.activeElement).toBe(m.$('wizard-event-venue'));
  });

  test('the preview follows the edit as it is typed', async () => {
    const m = mount();
    await toReview(m, { withType: true });
    m.$('wizard-review-change-when').click();
    m.type('wizard-event-time', '19:15');
    expect(m.txt('wizard-preview-when')).toContain('7:15 PM');
  });

  test('Save sends one PUT with the fields, never a second Create, and returns to the review', async () => {
    const m = mount();
    await toReview(m, { withType: true });
    const posts = () =>
      m.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/admin/events')).length;
    expect(posts()).toBe(1);
    m.$('wizard-review-change-when').click();
    m.type('wizard-event-time', '19:15');
    m.$('wizard-save-edit-btn').click();
    await m.flush();
    const puts = m.calls.filter((c) => c.method === 'PUT');
    expect(puts).toHaveLength(1);
    expect(puts[0]!.url).toBe('/api/v2/admin/events/evt_new');
    const body = puts[0]!.body as Record<string, unknown>;
    expect(body.start_time).toBe('19:15');
    expect(body.timezone).toBe('America/Chicago');
    expect(body.title).toBe('Bocce Night');
    expect(body.location).toBe('Eagles Hall');
    expect(body.event_type_id).toBe('type_bocce');
    expect(posts()).toBe(1);
    expect(m.onStep(5)).toBe(true);
    expect(m.$('wizard-save-edit-btn').hidden).toBe(true);
    expect(m.$('wizard-review-missing').hidden).toBe(true);
    expect(m.txt('wizard-review-row-when')).toContain('7:15 PM');
  });

  test('fixing both missing values lets Publish through', async () => {
    const m = mount();
    await toReview(m);
    m.$('wizard-go-live-btn').click();
    await m.flush();
    expect(m.goLive).toEqual([]);
    m.$('wizard-review-change-when').click();
    m.type('wizard-event-time', '19:15');
    m.$('wizard-save-edit-btn').click();
    await m.flush();
    m.$('wizard-review-change-type').click();
    await m.chooseType();
    m.$('wizard-save-edit-btn').click();
    await m.flush();
    expect(m.onStep(5)).toBe(true);
    expect(m.$('wizard-review-missing').hidden).toBe(true);
    m.$('wizard-go-live-btn').click();
    await m.flush();
    expect(m.goLive).toEqual([['evt_new', 'draft']]);
  });

  test('a failed save says so, stays in edit mode and keeps what was typed', async () => {
    const m = mount({ putOk: false });
    await toReview(m, { withType: true });
    m.$('wizard-review-change-when').click();
    m.type('wizard-event-time', '19:15');
    m.$('wizard-save-edit-btn').click();
    await m.flush();
    expect(m.txt('wizard-msg')).toContain('Nope, that did not save');
    expect(m.onStep(1)).toBe(true);
    expect(m.$<HTMLInputElement>('wizard-event-time').value).toBe('19:15');
    expect(m.$('wizard-save-edit-btn').hidden).toBe(false);
  });

  test('Save on step 1 with the name emptied is refused with the same message as step 1', async () => {
    const m = mount();
    await toReview(m, { time: '18:30', withType: true });
    m.$('wizard-review-change-title').click();
    m.type('wizard-event-name', '');
    m.$('wizard-save-edit-btn').click();
    await m.flush();
    expect(m.calls.filter((c) => c.method === 'PUT')).toEqual([]);
    expect(m.txt('wizard-msg')).toBe('Add a name and a place to continue');
    expect(m.doc.activeElement).toBe(m.$('wizard-event-name'));
  });

  test('Back to review puts the old values back and sends nothing', async () => {
    const m = mount();
    await toReview(m, { time: '18:30', withType: true });
    const before = m.calls.length;
    m.$('wizard-review-change-when').click();
    m.type('wizard-event-time', '21:00');
    m.type('wizard-event-name', 'Something else');
    m.$('wizard-cancel-edit-btn').click();
    expect(m.onStep(5)).toBe(true);
    expect(m.$<HTMLInputElement>('wizard-event-time').value).toBe('18:30');
    expect(m.$<HTMLInputElement>('wizard-event-name').value).toBe('Bocce Night');
    expect(m.txt('wizard-preview-title')).toBe('Bocce Night');
    expect(m.calls.length).toBe(before);
  });

  test('Enter on step 1 in edit mode saves, it does not create again', async () => {
    const m = mount();
    await toReview(m, { time: '18:30', withType: true });
    m.$('wizard-review-change-title').click();
    m.type('wizard-event-name', 'Bocce Night 2');
    m.$('wizard-event-name').dispatchEvent(
      new m.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
    await m.flush();
    expect(
      m.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/admin/events'))
    ).toHaveLength(1);
    expect(m.calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
  });
});
