/**
 * Wizard step 4 — "Your TV screen" (2026-10-02). The light version of the TV
 * display card: screens on/off and one speed, with a demo that cycles through
 * the picked screens. Saves through the same PUT { settings } as the card.
 * Runs the section's real script from the admin.html Text import in jsdom with
 * a stubbed fetch and a hand-driven timer queue.
 */

import { describe, test, expect } from 'vitest';
import { JSDOM } from 'jsdom';
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

function mount(opts: { save?: Reply; reduceMotion?: boolean } = {}) {
  const dom = new JSDOM(`<!doctype html><body>${step4Markup(ADMIN_HTML)}</body>`, {
    runScripts: 'outside-only',
    url: 'https://admin.test/admin',
  });
  const w = dom.window as unknown as Window & { eval(s: string): unknown } & Record<
      string,
      unknown
    >;
  // Hand-driven timers: the demo's next tick runs only when the test says so.
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
  if (opts.reduceMotion) {
    w.matchMedia = ((q: string) => ({
      matches: q.includes('reduce'),
    })) as unknown as typeof matchMedia;
  }
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

describe('wizard TV section: the demo', () => {
  test('starts on this event, named, and cycles through the picked screens', () => {
    const { $, created, tick } = mount();
    created();
    expect($('wizard-tv-demo-title').textContent).toBe('Bocce Night');
    expect($('wizard-tv-demo-count').textContent).toContain('Screen 1 of 3');
    expect($('wizard-tv-demo-count').textContent).toContain('15 seconds on the TV');
    expect(tick()).toBe(3000); // 15 s shown 5x faster
    expect($('wizard-tv-demo-title').textContent).toBe('Coming up next');
    tick();
    expect($('wizard-tv-demo-title').textContent).toBe('Thanks to our sponsors');
    tick();
    expect($('wizard-tv-demo-title').textContent).toBe('Bocce Night');
  });

  test('the speed changes the demo pace and the label', () => {
    const { $, speed, change, created, tick } = mount();
    created();
    change(speed(30), true);
    expect($('wizard-tv-demo-count').textContent).toContain('30 seconds on the TV');
    expect(tick()).toBe(6000);
  });

  test('an unticked screen leaves the demo; one screen left means no rotation', () => {
    const { $, box, change, created, timers } = mount();
    created();
    change(box('upcoming'), false);
    expect($('wizard-tv-demo-count').textContent).toContain('of 2');
    change(box('sponsors'), false);
    expect($('wizard-tv-demo-count').textContent).toContain('Screen 1 of 1');
    expect($('wizard-tv-demo-count').textContent).not.toContain('faster');
    expect(timers.size).toBe(0);
  });

  test('Pause stops the demo and Play resumes it', () => {
    const { $, created, timers } = mount();
    created();
    expect(timers.size).toBe(1);
    $<HTMLButtonElement>('wizard-tv-demo-pause').click();
    expect(timers.size).toBe(0);
    expect($('wizard-tv-demo-pause').textContent).toBe('Play demo');
    expect($('wizard-tv-demo-pause').getAttribute('aria-pressed')).toBe('true');
    $<HTMLButtonElement>('wizard-tv-demo-pause').click();
    expect(timers.size).toBe(1);
  });

  test('reduced motion: the demo starts paused', () => {
    const { $, created, timers } = mount({ reduceMotion: true });
    created();
    expect(timers.size).toBe(0);
    expect($('wizard-tv-demo-pause').textContent).toBe('Play demo');
  });

  test('the demo stops when the wizard leaves step 4', () => {
    const { doc, $, created, tick } = mount();
    created();
    doc.getElementById('wizard-step-4')!.classList.remove('active');
    tick();
    expect($('wizard-tv-demo-title').textContent).toBe('Bocce Night');
  });

  test('the demo region is not announced on every change', () => {
    const { $ } = mount();
    expect($('wizard-tv-demo').getAttribute('aria-live')).toBe('off');
  });
});

describe('wizard TV section: saving', () => {
  test('nothing is saved until the organiser changes something', async () => {
    const { created, calls } = mount();
    created();
    await flush();
    expect(calls).toEqual([]);
  });

  test('a change saves the ticked screens in TV order, league kept last, and the speed', async () => {
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
      body: { settings: { displayPanes: ['event', 'sponsors', 'league'], displayDwellSeconds: 8 } },
    });
    expect($('wizard-tv-msg').textContent).toBe('Saved.');
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
    expect($('wizard-tv-demo-title').textContent).toBe('Second');
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
    expect(doc.querySelector('[data-testid="wizard-tv-demo-title"]')!.textContent).toBe(
      'Bocce Night'
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
          displayPanes: ['event', 'upcoming', 'sponsors', 'league'],
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
