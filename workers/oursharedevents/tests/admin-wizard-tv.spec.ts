/**
 * Wizard step 4 — "Your TV screen" (2026-10-02). The light version of the TV
 * display card: screens on/off and one speed, with a demo that cycles through
 * the picked screens. Saves through the same PUT { settings } as the card.
 * Runs the section's real script from the admin.html Text import in jsdom with
 * a stubbed fetch and a hand-driven timer queue.
 */

import { describe, test, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { DEFAULT_DISPLAY_PANES } from '../src/lib/event-settings';
import ADMIN_HTML from '../src/templates/admin.html';

const EVT = 'evt_wizard_tv';

function step4Markup(html: string): string {
  const start = html.indexOf('<div class="wizard-step" id="wizard-step-4"');
  const end = html.indexOf('<!-- Step 5', start);
  expect(start, 'wizard step 4 markup').toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

function scriptWith(html: string, marker: string): string {
  const doc = new JSDOM(html).window.document;
  const el = Array.from(doc.querySelectorAll('script')).find((s) =>
    (s.textContent || '').includes(marker)
  );
  expect(el, `script containing ${marker}`).toBeDefined();
  return el!.textContent || '';
}

type Reply = { status?: number; body?: unknown };

function mount(opts: { save?: Reply } = {}) {
  const dom = new JSDOM(`<!doctype html><body>${step4Markup(ADMIN_HTML)}</body>`, {
    runScripts: 'outside-only',
    url: 'https://admin.test/admin',
  });
  const w = dom.window as unknown as Window & { eval(s: string): unknown } & Record<
      string,
      unknown
    >;
  // Hand-driven timers: the optional demo's next tick runs only when the test says so.
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let nextId = 1;
  w.setTimeout = ((fn: () => void, ms: number) => {
    const id = nextId++;
    timers.set(id, { fn, ms });
    return id;
  }) as unknown as typeof setTimeout;
  w.clearTimeout = ((id: number) => {
    timers.delete(id);
  }) as unknown as typeof clearTimeout;
  const tick = () => {
    const [id, t] = [...timers.entries()][0] ?? [];
    if (!t) return undefined;
    timers.delete(id!);
    t.fn();
    return t.ms;
  };
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const save = opts.save ?? { body: { ok: true } };
  w.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: (init?.method ?? 'GET').toUpperCase(),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const status = save.status ?? 200;
    return { ok: status < 400, status, json: async () => save.body };
  }) as unknown as typeof fetch;
  w.eval(scriptWith(ADMIN_HTML, "'ose:wizard-created', function"));
  const doc = w.document;
  doc.getElementById('wizard-step-4')!.classList.add('active');
  const $ = <T extends HTMLElement>(id: string) => doc.querySelector<T>(`[data-testid="${id}"]`)!;
  const box = (pane: string) =>
    doc.querySelector<HTMLInputElement>(`[data-testid="wizard-tv-screen"][data-pane="${pane}"]`)!;
  const speed = (s: number) => doc.getElementById(`wizard-tv-speed-${s}`) as HTMLInputElement;
  const change = (el: HTMLInputElement, checked: boolean) => {
    el.checked = checked;
    el.dispatchEvent(new w.Event('change', { bubbles: true }));
  };
  const created = (id = EVT, title = 'Bocce Night') =>
    w.dispatchEvent(new w.CustomEvent('ose:wizard-created', { detail: { id, title } }));
  return { w, doc, $, box, speed, change, created, calls, timers, tick };
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

describe('wizard TV section: the one-line summary', () => {
  test('says what the TV will show, in order, and for how long', () => {
    const { $, created } = mount();
    created();
    expect($('wizard-tv-summary').textContent).toBe(
      'This event \u2192 Coming up next \u2192 Sponsors \u00b7 15 seconds each'
    );
  });

  test('follows the speed and the ticked screens', () => {
    const { $, box, speed, change, created } = mount();
    created();
    change(speed(30), true);
    change(box('upcoming'), false);
    expect($('wizard-tv-summary').textContent).toBe(
      'This event \u2192 Sponsors \u00b7 30 seconds each'
    );
  });

  test('one screen left stays on screen (nothing to rotate, like the TV)', () => {
    const { $, box, change, created } = mount();
    created();
    change(box('upcoming'), false);
    change(box('sponsors'), false);
    expect($('wizard-tv-summary').textContent).toBe('This event \u00b7 stays on screen');
  });

  test('nothing moves on its own: the demo is off until Show me', () => {
    const { $, created, timers } = mount();
    created();
    expect(timers.size).toBe(0);
    expect($('wizard-tv-demo').hidden).toBe(true);
    expect($('wizard-tv-demo-toggle').textContent).toBe('Show me');
  });

  test('Show me plays the demo 5x faster and says so; Stop ends it', () => {
    const { $, created, timers, tick } = mount();
    created();
    $<HTMLButtonElement>('wizard-tv-demo-toggle').click();
    expect($('wizard-tv-demo').hidden).toBe(false);
    expect($('wizard-tv-demo').textContent).toBe(
      'On the TV now: This event (screen 1 of 3) \u00b7 demo plays 5x faster'
    );
    expect(tick()).toBe(3000); // 15 s on the TV, 3 s in the demo
    expect($('wizard-tv-demo').textContent).toContain('Coming up next (screen 2 of 3)');
    $<HTMLButtonElement>('wizard-tv-demo-toggle').click();
    expect($('wizard-tv-demo').hidden).toBe(true);
    expect(timers.size).toBe(0);
  });

  test('leaving step 4 stops the demo at once, even with one screen', () => {
    const { w, $, box, change, created, timers } = mount();
    created();
    change(box('upcoming'), false);
    change(box('sponsors'), false);
    $<HTMLButtonElement>('wizard-tv-demo-toggle').click();
    expect($('wizard-tv-demo').hidden).toBe(false);
    w.dispatchEvent(new w.CustomEvent('ose:wizard-step', { detail: { step: 5 } }));
    expect($('wizard-tv-demo').hidden).toBe(true);
    expect($('wizard-tv-demo-toggle').textContent).toBe('Show me');
    expect(timers.size).toBe(0);
  });

  test('the demo stops when the wizard leaves step 4', () => {
    const { doc, $, created, tick, timers } = mount();
    created();
    $<HTMLButtonElement>('wizard-tv-demo-toggle').click();
    doc.getElementById('wizard-step-4')!.classList.remove('active');
    tick();
    expect($('wizard-tv-demo').hidden).toBe(true);
    expect(timers.size).toBe(0);
  });
});

describe('wizard TV section: saving', () => {
  test('one save at a time, and the last choice is what lands', async () => {
    const { w, box, speed, change, created, $ } = mount();
    const sent: unknown[] = [];
    const answers: Array<() => void> = [];
    w.fetch = ((_url: string, init?: RequestInit) => {
      sent.push(JSON.parse(String(init!.body)));
      return new Promise((resolve) => {
        answers.push(() => resolve({ ok: true, status: 200, json: async () => ({ ok: true }) }));
      });
    }) as unknown as typeof fetch;
    created();
    change(box('upcoming'), false); // save 1 starts
    change(box('sponsors'), false); // queued
    change(speed(30), true); // queued: coalesced with the line above
    await flush();
    expect(sent).toHaveLength(1);
    expect($('wizard-tv-msg').textContent).toBe('Saving\u2026');
    answers.shift()!();
    await flush();
    // The first answer does not claim "Saved." while a newer change waits.
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual({
      settings: { displayPanes: ['event', 'league', 'donate'], displayDwellSeconds: 30 },
    });
    expect($('wizard-tv-msg').textContent).toBe('Saving\u2026');
    answers.shift()!();
    await flush();
    expect(sent).toHaveLength(2);
    expect($('wizard-tv-msg').textContent).toBe('Saved.');
  });

  test('nothing is saved until the organiser changes something', async () => {
    const { created, calls } = mount();
    created();
    await flush();
    expect(calls).toEqual([]);
  });

  test('a change saves the ticked screens in TV order, then league and donate, and the speed', async () => {
    const { box, speed, change, created, calls, $ } = mount();
    created();
    change(box('upcoming'), false);
    await flush();
    change(speed(8), true);
    await flush();
    expect(calls.map((c) => c.url)).toEqual([
      `/api/v2/admin/events/${EVT}`,
      `/api/v2/admin/events/${EVT}`,
    ]);
    expect(calls[1]).toMatchObject({
      method: 'PUT',
      body: {
        settings: {
          displayPanes: ['event', 'sponsors', 'league', 'donate'],
          displayDwellSeconds: 8,
        },
      },
    });
    expect($('wizard-tv-msg').textContent).toBe('Saved.');
  });

  test('with every screen ticked, a save sends the default TV order', async () => {
    // The wizard must not switch off a screen it has no checkbox for: saving
    // through it once dropped `donate`, so an event with a donation link lost
    // that screen until the TV display card was saved again.
    const { speed, change, created, calls } = mount();
    created();
    change(speed(30), true);
    await flush();
    expect(calls[0].body).toEqual({
      settings: { displayPanes: [...DEFAULT_DISPLAY_PANES], displayDwellSeconds: 30 },
    });
  });

  test('the last screen cannot be switched off', async () => {
    const { box, change, created, calls, $ } = mount();
    created();
    change(box('upcoming'), false);
    change(box('sponsors'), false);
    await flush();
    const before = calls.length;
    change(box('event'), false);
    await flush();
    expect(box('event').checked).toBe(true);
    expect($('wizard-tv-msg').textContent).toBe('Keep at least one screen on.');
    expect(calls.length).toBe(before);
  });

  test("a server refusal shows the server's reason", async () => {
    const { speed, change, created, $ } = mount({
      save: {
        status: 400,
        body: { ok: false, error: 'settings.displayDwellSeconds is out of range' },
      },
    });
    created();
    change(speed(30), true);
    await flush();
    expect($('wizard-tv-msg').textContent).toBe(
      'Not saved: settings.displayDwellSeconds is out of range'
    );
  });

  test('a new event starts from the defaults', () => {
    const { box, speed, change, created, $ } = mount();
    created('evt-A', 'First');
    change(box('sponsors'), false);
    change(speed(30), true);
    created('evt-B', 'Second');
    expect(box('sponsors').checked).toBe(true);
    expect(speed(15).checked).toBe(true);
    expect($('wizard-tv-msg').textContent).toBe('');
    expect($('wizard-tv-summary').textContent).toContain('15 seconds each');
  });

  test('every control is labelled', () => {
    const doc = new JSDOM(step4Markup(ADMIN_HTML)).window.document;
    const inputs = doc.querySelectorAll('#wizard-tv input[id]');
    expect(inputs.length).toBe(6);
    for (const input of inputs) {
      expect(doc.querySelector(`label[for="${input.id}"]`), input.id).not.toBeNull();
    }
  });
});

describe('wizard step 4 controls are finger-sized', () => {
  test('Copy, Preview and Show me share a 44px-tall target', () => {
    const rule = /\.wizard-copy-btn \{([^}]*)\}/.exec(ADMIN_HTML)?.[1] ?? '';
    expect(rule).toContain('min-height: 44px');
    expect(rule).toContain('display: inline-flex');
  });
});

describe('wizard step 4 links point at the new event', () => {
  const loadLinks = scriptWith(ADMIN_HTML, 'async function loadLinks()');
  test('the poster and TV links carry ?event=', () => {
    expect(loadLinks).toContain("origin + '/poster?event=' + id");
    expect(loadLinks).toContain("origin + '/display?event=' + id");
    expect(loadLinks).not.toMatch(/origin \+ '\/(poster|display)'\)/);
  });
  test('the wizard tells the TV section which event was made', () => {
    expect(loadLinks).toContain("new CustomEvent('ose:wizard-created'");
  });
});

describe('the saved wizard is a loop: publish, go back, change, publish again', () => {
  test('step 5 Back returns to step 4, and publish / undo repeat as often as needed', async () => {
    const dom = new JSDOM(ADMIN_HTML, {
      runScripts: 'outside-only',
      url: 'https://admin.test/admin',
    });
    const w = dom.window as unknown as Window & { eval(s: string): unknown } & Record<
        string,
        unknown
      >;
    // jsdom has no layout; the wizard scrolls its panel into view.
    (w as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement.prototype.scrollIntoView =
      () => {};
    const puts: unknown[] = [];
    const gets: string[] = [];
    w.fetch = (async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'POST' && url === '/api/v2/admin/events') {
        const body = { ok: true, id: EVT };
        return {
          ok: true,
          status: 201,
          redirected: false,
          json: async () => body,
          text: async () => JSON.stringify(body),
        };
      }
      if (method === 'PUT') puts.push(JSON.parse(String(init!.body)));
      if (method === 'GET') gets.push(url);
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }) as unknown as typeof fetch;
    const moves: Array<[string, string]> = [];
    w.moveEventTo = async (_id: string, to: string, from: string) => {
      moves.push([from, to]);
      return { ok: true, from };
    };
    w.goLiveFromDraft = (id: string, from: string) =>
      (w.moveEventTo as (a: string, b: string, c: string) => unknown)(id, 'active', from);
    w.eval(scriptWith(ADMIN_HTML, 'Guided wizard logic'));
    w.eval(scriptWith(ADMIN_HTML, "'ose:wizard-created', function"));
    const doc = w.document;
    const byId = (id: string) => doc.getElementById(id) as HTMLElement;
    const active = () => doc.querySelector('.wizard-step.active')?.id;

    byId('admin-path-wizard').click();
    (byId('wizard-event-name') as HTMLInputElement).value = 'Bocce Night';
    (byId('wizard-event-venue') as HTMLInputElement).value = 'Eagles Hall';
    byId('wizard-event-name').dispatchEvent(new w.Event('input'));
    byId('wizard-next-btn').click();
    byId('wizard-next-btn').click();
    byId('wizard-next-btn').click();
    await flush();
    expect(doc.getElementById('wizard-msg')!.textContent).toBe('');
    expect(active()).toBe('wizard-step-4');
    expect(doc.querySelector('[data-testid="wizard-tv-summary"]')!.textContent).toContain(
      'This event'
    );

    // Previews: the real page and poster, admin-only, even as a draft. The
    // QR codes come from the admin bundle (the public one refuses drafts).
    const pv = doc.querySelector<HTMLAnchorElement>('[data-testid="wizard-preview-public"]')!;
    const pp = doc.querySelector<HTMLAnchorElement>('[data-testid="wizard-preview-poster"]')!;
    expect(pv.getAttribute('href')).toBe(`/api/v2/admin/events/${EVT}/preview`);
    expect(pp.getAttribute('href')).toBe(`/api/v2/admin/events/${EVT}/poster-preview`);
    expect(gets).toContain(`/api/v2/admin/events/${EVT}/poster-bundle`);
    expect(gets.some((u) => u.startsWith('/api/v2/events/'))).toBe(false);
    // Preview is a link, not a Copy button: clicking leaves its text alone.
    pv.addEventListener('click', (e) => e.preventDefault());
    pv.click();
    expect(pv.textContent).toBe('Preview');

    byId('wizard-next-btn').click();
    expect(active()).toBe('wizard-step-5');
    byId('wizard-go-live-btn').click();
    await flush();

    // Back to step 4 after publishing, change the TV, forward again.
    expect(byId('wizardBackBtn').hidden).toBe(false);
    byId('wizardBackBtn').click();
    expect(active()).toBe('wizard-step-4');
    expect(byId('wizardBackBtn').hidden).toBe(true);
    const slow = byId('wizard-tv-speed-30') as HTMLInputElement;
    slow.checked = true;
    slow.dispatchEvent(new w.Event('change', { bubbles: true }));
    await flush();
    expect(puts).toEqual([
      {
        settings: {
          displayPanes: ['event', 'upcoming', 'sponsors', 'league', 'donate'],
          displayDwellSeconds: 30,
        },
      },
    ]);
    byId('wizard-next-btn').click();
    expect(active()).toBe('wizard-step-5');

    // Undo and publish again, twice over.
    for (let i = 0; i < 2; i++) {
      byId('wizard-undo-live-btn').click();
      await flush();
      byId('wizard-go-live-btn').click();
      await flush();
    }
    expect(moves).toEqual([
      ['draft', 'active'],
      ['active', 'draft'],
      ['draft', 'active'],
      ['active', 'draft'],
      ['draft', 'active'],
    ]);
    expect(byId('wizard-go-live-btn').textContent).toContain('Published');
    w.close();
  });
});

describe('publish grace window: the organiser is told when it lists', () => {
  function mountRouter(reply: Record<string, unknown>) {
    const dom = new JSDOM(ADMIN_HTML, {
      runScripts: 'outside-only',
      url: 'https://admin.test/admin',
    });
    const w = dom.window as unknown as Window & { eval(s: string): unknown } & Record<
        string,
        unknown
      >;
    w.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => reply,
      text: async () => JSON.stringify(reply),
    })) as unknown as typeof fetch;
    w.eval(scriptWith(ADMIN_HTML, 'window.moveEventTo = async function'));
    return w as unknown as {
      moveEventTo(
        id: string,
        to: string,
        from: string
      ): Promise<{ ok: boolean; listedFrom: string | null }>;
      graceNote(listedFrom: string | null, listed?: boolean, byDefault?: boolean): string;
    };
  }

  test('Publish returns when the event goes on the map and list, and says it plainly', async () => {
    const at = new Date(Date.now() + 10 * 60_000).toISOString();
    const w = mountRouter({ ok: true, event: { id: EVT, status: 'active', listedFrom: at } });
    const r = await w.moveEventTo(EVT, 'active', 'ready');
    expect(r.ok).toBe(true);
    expect(r.listedFrom).toBe(at);
    const note = w.graceNote(r.listedFrom);
    expect(note).toContain('goes on the map and list at');
    expect(note).toContain('Undo before then and nobody else will have found it.');
  });

  test('no window (off, or already passed) → nothing extra to say', async () => {
    const w = mountRouter({ ok: true });
    expect(w.graceNote(null)).toBe('');
    expect(w.graceNote(new Date(Date.now() - 1000).toISOString())).toBe('');
    expect(w.graceNote('not a date')).toBe('');
  });

  test('an event kept off the map is never promised a listing', () => {
    const w = mountRouter({ ok: true });
    const soon = new Date(Date.now() + 10 * 60_000).toISOString();
    const note = w.graceNote(soon, false);
    expect(note).not.toContain('goes on the map');
    expect(note).toContain('stays off the map and list, as you chose');
    // PO 2026-10-07: a live event's page opens by link while it is off the map
    // (pages.ts). The note used to say "its public page stays closed to guests".
    expect(note).toContain('Your links and printed codes still open its page.');
    expect(note).not.toMatch(/closed/i);
    expect(w.graceNote(soon, true)).toContain('goes on the map and list at');
  });

  test('off because nobody turned it on (the default) is not described as a choice the organizer made', () => {
    const w = mountRouter({ ok: true });
    const soon = new Date(Date.now() + 10 * 60_000).toISOString();
    const note = w.graceNote(soon, false, true);
    expect(note).not.toContain('as you chose');
    expect(note).not.toContain('goes on the map');
    expect(note).toContain('not on the map or list');
    expect(note).toContain('Your links and printed codes still open its page.');
    expect(note).not.toMatch(/closed/i);
  });

  test('the wizard and the status panel both add the note to their Published message', () => {
    expect(ADMIN_HTML).toContain(
      "'Your event is published. The links on the previous step work now.' + (window.graceNote ? window.graceNote(r.listedFrom, wiz.published !== false, !wiz.publishedChosen) : '')"
    );
    expect(ADMIN_HTML).toContain(
      "'Published — the public page, poster and display are on.' + window.graceNote(result.listedFrom, Number(e.is_published) !== 0, Number(e.map_default) === 1)"
    );
  });
});
