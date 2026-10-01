import { describe, expect, test } from 'vitest';
import { JSDOM } from 'jsdom';
import DISPLAY_HTML from '../src/templates/display.html';

// The TV display's pane rotation, ported from the GAS display's rotation
// engine (MVP-EVENT-TOOLKIT, startRotationEngine). These tests RUN the engine
// and the page script (jsdom, fake timers, stubbed fetch) instead of matching
// source text, so a broken cadence, a stuck pause or a pane that never hides
// goes red.

// ── The pure engine, extracted from the served template ──────────────────────

type Rotation = {
  start: (i?: number, paused?: boolean) => void;
  next: () => void;
  prev: () => void;
  togglePause: () => boolean;
  setHidden: (h: boolean) => void;
  stop: () => void;
  current: () => string;
  isPaused: () => boolean;
  size: () => number;
};

function extract(): {
  rotationConfig: (search: string) => { order: string[]; dwellMs: number };
  createPaneRotation: (
    panes: string[],
    dwellMs: number,
    onShow: (p: string, i: number, paused: boolean) => void,
    timers: { set: (f: () => void, ms: number) => number; clear: (id: number) => void }
  ) => Rotation;
} {
  const start = DISPLAY_HTML.indexOf('var PANE_TYPES =');
  const end = DISPLAY_HTML.indexOf('var ROTATION =');
  expect(start, 'display.html must carry the pane engine').toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(
    `${DISPLAY_HTML.slice(start, end)}; return { rotationConfig, createPaneRotation };`
  )();
}

const { rotationConfig, createPaneRotation } = extract();

function fakeTimers() {
  let nextId = 1;
  const pending = new Map<number, { f: () => void; ms: number }>();
  return {
    timers: {
      set: (f: () => void, ms: number) => {
        const id = nextId++;
        pending.set(id, { f, ms });
        return id;
      },
      clear: (id: number) => {
        pending.delete(id);
      },
    },
    pending,
    /** Fire the one pending timer (the engine never holds more than one). */
    fire() {
      expect(pending.size, 'exactly one pending timer').toBe(1);
      const [id, t] = [...pending.entries()][0];
      pending.delete(id);
      t.f();
    },
  };
}

describe('rotationConfig: the kiosk URL is the configuration', () => {
  test('defaults: every pane, 15 s each', () => {
    expect(rotationConfig('')).toEqual({
      order: ['event', 'upcoming', 'sponsors'],
      dwellMs: 15000,
    });
  });

  test('?panes= picks and orders panes; unknown and repeated names are dropped', () => {
    expect(rotationConfig('?panes=sponsors,bogus,event,sponsors').order).toEqual([
      'sponsors',
      'event',
    ]);
  });

  test('?panes= with nothing valid falls back to every pane, never to none', () => {
    expect(rotationConfig('?panes=<script>').order).toEqual(['event', 'upcoming', 'sponsors']);
  });

  test('?dwell= is seconds, clamped to 5..120; junk reads as the default', () => {
    expect(rotationConfig('?dwell=30').dwellMs).toBe(30000);
    expect(rotationConfig('?dwell=1').dwellMs).toBe(5000);
    expect(rotationConfig('?dwell=9999').dwellMs).toBe(120000);
    expect(rotationConfig('?dwell=abc').dwellMs).toBe(15000);
    expect(rotationConfig('?dwell=-4').dwellMs).toBe(15000);
  });
});

describe('createPaneRotation: cadence, pause, stepping', () => {
  function rig(panes = ['event', 'upcoming', 'sponsors']) {
    const ft = fakeTimers();
    const shown: Array<[string, number, boolean]> = [];
    const r = createPaneRotation(
      panes,
      15000,
      (p, i, paused) => shown.push([p, i, paused]),
      ft.timers
    );
    return { ft, shown, r };
  }

  test('cycles through every pane at the dwell time, then wraps', () => {
    const { ft, shown, r } = rig();
    r.start();
    expect(shown.at(-1)).toEqual(['event', 0, false]);
    expect([...ft.pending.values()][0].ms).toBe(15000);
    ft.fire();
    expect(shown.at(-1)?.[0]).toBe('upcoming');
    ft.fire();
    expect(shown.at(-1)?.[0]).toBe('sponsors');
    ft.fire();
    expect(shown.at(-1)?.[0]).toBe('event');
  });

  test('one pane: shown, but no timer at all', () => {
    const { ft, shown, r } = rig(['event']);
    r.start();
    expect(shown).toEqual([['event', 0, false]]);
    expect(ft.pending.size).toBe(0);
  });

  test('pause holds the current pane; resume restarts the timer', () => {
    const { ft, shown, r } = rig();
    r.start();
    expect(r.togglePause()).toBe(true);
    expect(ft.pending.size, 'a paused board must not advance').toBe(0);
    expect(shown.at(-1)).toEqual(['event', 0, true]);
    expect(r.togglePause()).toBe(false);
    expect(ft.pending.size).toBe(1);
    expect(shown.at(-1)).toEqual(['event', 0, false]);
  });

  test('arrow keys step both ways and wrap; stepping while paused stays paused', () => {
    const { ft, r } = rig();
    r.start();
    r.prev();
    expect(r.current()).toBe('sponsors');
    r.next();
    expect(r.current()).toBe('event');
    r.togglePause();
    r.next();
    expect(r.current()).toBe('upcoming');
    expect(r.isPaused()).toBe(true);
    expect(ft.pending.size).toBe(0);
  });

  test('a hidden tab stops the timer; visible again restarts it', () => {
    const { ft, r } = rig();
    r.start();
    r.setHidden(true);
    expect(ft.pending.size).toBe(0);
    r.setHidden(false);
    expect(ft.pending.size).toBe(1);
  });

  test('stop clears the timer (a re-render never leaves two rotations running)', () => {
    const { ft, r } = rig();
    r.start();
    r.stop();
    expect(ft.pending.size).toBe(0);
  });
});

// ── The page, run end to end in jsdom ────────────────────────────────────────

const EVENTS = [
  { id: 'evt-1', name: 'Bocce Night', venue: 'Eagles Hall', startDateISO: '2026-10-24' },
  { id: 'evt-2', name: 'Trivia <b>Tuesday</b>', venue: 'Open OutCry', startDateISO: '2026-10-27' },
];
const SPONSOR_BUNDLE = {
  ok: true,
  bundle: {
    surface_sponsors: {
      tvTop: [{ id: 'sp-1', name: 'Hall Bakery', logo_url: 'https://x.test/a.png', tier: 'title' }],
      tvSide: [
        { id: 'sp-1', name: 'Hall Bakery', logo_url: 'https://x.test/a.png', tier: 'title' },
        { id: 'sp-2', name: 'Corner "Hardware"', tier: 'community' },
      ],
    },
  },
};

async function bootPage(search = '', { events = EVENTS, sponsors = SPONSOR_BUNDLE } = {}) {
  const dom = new JSDOM(DISPLAY_HTML, {
    url: `https://stg.oursharedevents.com/display${search}`,
    runScripts: 'outside-only',
    // Without this jsdom reports document.hidden = true, and the engine
    // (correctly) never starts a timer on a hidden tab.
    pretendToBeVisual: true,
  });
  const w = dom.window as unknown as Window & typeof globalThis & { eval: (s: string) => void };
  const ft = fakeTimers();
  // Only the pane engine's timeouts are under test; intervals (clock, refresh,
  // side rail) are parked so nothing fires behind the test's back.
  w.setTimeout = ((f: () => void, ms: number) =>
    ft.timers.set(f, ms)) as unknown as typeof setTimeout;
  w.clearTimeout = ((id: number) => ft.timers.clear(id)) as unknown as typeof clearTimeout;
  w.setInterval = (() => 0) as unknown as typeof setInterval;
  w.fetch = (async (url: string) => {
    const body = String(url).includes('/sponsor-bundle')
      ? sponsors
      : String(url).includes('/impression')
        ? {}
        : { ok: true, items: events };
    return { json: async () => body } as Response;
  }) as typeof fetch;
  for (const m of DISPLAY_HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)) w.eval(m[1]);
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  const doc = w.document;
  const visible = () =>
    [...doc.querySelectorAll<HTMLElement>('[data-pane]')]
      .filter((el) => !el.hidden)
      .map((el) => el.getAttribute('data-pane'));
  const key = (k: string) => doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: k }));
  // The pane timer is the one whose dwell matches; the side rail's 600 ms fade
  // timeout is the only other setTimeout on the page and is not used here.
  const paneTimers = () => [...ft.pending.entries()].filter(([, t]) => t.ms >= 5000);
  const tick = () => {
    const due = paneTimers();
    expect(due.length, 'exactly one pending pane timer').toBe(1);
    ft.pending.delete(due[0][0]);
    due[0][1].f();
  };
  const setHidden = (h: boolean) => {
    Object.defineProperty(doc, 'hidden', { configurable: true, get: () => h });
    doc.dispatchEvent(new w.Event('visibilitychange'));
  };
  return { doc, visible, key, tick, paneTimers, setHidden };
}

describe('display page: panes on the real template', () => {
  test('boots on the featured event; exactly one pane is visible', async () => {
    const { doc, visible } = await bootPage();
    expect(visible()).toEqual(['event']);
    expect(doc.querySelector('[data-testid="display-featured-title"]')?.textContent).toBe(
      'Bocce Night'
    );
    expect(doc.querySelectorAll('.pane-dots li')).toHaveLength(3);
    expect(doc.querySelector('.pane-dots li[aria-current="true"]')).toBe(
      doc.querySelectorAll('.pane-dots li')[0]
    );
  });

  test('rotates event -> upcoming -> sponsors -> event', async () => {
    const { visible, tick } = await bootPage();
    tick();
    expect(visible()).toEqual(['upcoming']);
    tick();
    expect(visible()).toEqual(['sponsors']);
    tick();
    expect(visible()).toEqual(['event']);
  });

  test('sponsors pane: each sponsor once, through the proxy or the OSE default, tier-blind', async () => {
    const { doc } = await bootPage();
    const tiles = doc.querySelectorAll('[data-testid="display-wall-sponsor"]');
    expect(tiles, 'a sponsor in both TV slots is one tile').toHaveLength(2);
    const imgs = [...doc.querySelectorAll('[data-testid="display-wall-sponsor-logo"]')].map((i) =>
      i.getAttribute('src')
    );
    expect(imgs).toEqual(['/api/v2/sponsors/sp-1/logo', '/sponsor-default-logo.svg']);
    for (const t of tiles) expect(t.hasAttribute('data-tier')).toBe(false);
    expect(doc.querySelectorAll('[data-testid="display-wall-sponsor-name"]')[1].textContent).toBe(
      'Corner "Hardware"'
    );
  });

  test('event and sponsor text is escaped, never parsed as markup', async () => {
    const { doc } = await bootPage();
    const pane = doc.querySelector('[data-testid="display-pane-upcoming"]')!;
    expect(pane.querySelector('b')).toBeNull();
    expect(pane.textContent).toContain('Trivia <b>Tuesday</b>');
    expect(
      doc.querySelector('[data-testid="display-pane-sponsors"] img[alt="Corner \\"Hardware\\""]')
    ).not.toBeNull();
  });

  test('Space pauses (with a visible note) and resumes; arrows step', async () => {
    const { doc, visible, key, paneTimers } = await bootPage();
    key(' ');
    expect(paneTimers()).toHaveLength(0);
    expect(doc.querySelector<HTMLElement>('[data-testid="display-pane-paused"]')!.hidden).toBe(
      false
    );
    key('ArrowRight');
    expect(visible()).toEqual(['upcoming']);
    key('ArrowLeft');
    key('ArrowLeft');
    expect(visible()).toEqual(['sponsors']);
    key(' ');
    expect(paneTimers()).toHaveLength(1);
    expect(doc.querySelector<HTMLElement>('[data-testid="display-pane-paused"]')!.hidden).toBe(
      true
    );
  });

  test('?panes= and ?dwell= drive the board', async () => {
    const { visible, tick, paneTimers, doc } = await bootPage('?panes=sponsors,event&dwell=40');
    // Events load before sponsors, so the board opens on the event; when the
    // sponsors arrive the re-render keeps the pane on screen (no jump).
    expect(visible()).toEqual(['event']);
    expect(paneTimers()[0][1].ms).toBe(40000);
    tick();
    expect(visible()).toEqual(['sponsors']);
    tick();
    expect(visible()).toEqual(['event']);
    expect(doc.querySelector('[data-testid="display-pane-upcoming"]')).toBeNull();
    expect(doc.querySelectorAll('.pane-dots li')).toHaveLength(2);
  });

  test('a hidden tab holds the board; showing it again resumes', async () => {
    const { paneTimers, setHidden } = await bootPage();
    setHidden(true);
    expect(paneTimers()).toHaveLength(0);
    setHidden(false);
    expect(paneTimers()).toHaveLength(1);
  });

  test('?event= still features the requested event in the event pane', async () => {
    const { doc } = await bootPage('?event=evt-2');
    expect(doc.querySelector('[data-testid="display-featured-title"]')?.textContent).toBe(
      'Trivia <b>Tuesday</b>'
    );
  });

  test('one event and no sponsors: a single pane, no dots, no timer', async () => {
    const { doc, visible, paneTimers } = await bootPage('', {
      events: [EVENTS[0]],
      sponsors: { ok: true, bundle: { surface_sponsors: { tvTop: [], tvSide: [] } } },
    });
    expect(visible()).toEqual(['event']);
    expect(doc.querySelector('[data-testid="display-pane-dots"]')).toBeNull();
    expect(paneTimers()).toHaveLength(0);
  });

  test('panes live in an aria-live="off" region, so rotation is not read aloud every 15 s', async () => {
    const { doc } = await bootPage();
    expect(doc.querySelector('[data-testid="display-panes"]')?.getAttribute('aria-live')).toBe(
      'off'
    );
  });
});
