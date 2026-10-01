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
  rotationConfig: (search: string) => {
    order: string[];
    dwellMs: number;
    fixedOrder: boolean;
    fixedDwell: boolean;
  };
  effectiveRotation: (
    url: { order: string[]; dwellMs: number; fixedOrder: boolean; fixedDwell: boolean },
    saved: unknown
  ) => { order: string[]; dwellMs: number };
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
    `${DISPLAY_HTML.slice(start, end)}; return { rotationConfig, effectiveRotation, createPaneRotation };`
  )();
}

const { rotationConfig, effectiveRotation, createPaneRotation } = extract();
const ALL = ['event', 'upcoming', 'sponsors', 'league'];

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
      order: ALL,
      dwellMs: 15000,
      fixedOrder: false,
      fixedDwell: false,
    });
  });

  test('?panes= picks and orders panes; unknown and repeated names are dropped', () => {
    expect(rotationConfig('?panes=sponsors,bogus,event,sponsors').order).toEqual([
      'sponsors',
      'event',
    ]);
  });

  test('?panes= with nothing valid falls back to every pane, never to none', () => {
    expect(rotationConfig('?panes=<script>').order).toEqual(ALL);
  });

  test('?dwell= is seconds, clamped to 5..120; junk reads as the default', () => {
    expect(rotationConfig('?dwell=30').dwellMs).toBe(30000);
    expect(rotationConfig('?dwell=1').dwellMs).toBe(5000);
    expect(rotationConfig('?dwell=9999').dwellMs).toBe(120000);
    expect(rotationConfig('?dwell=abc').dwellMs).toBe(15000);
    expect(rotationConfig('?dwell=-4').dwellMs).toBe(15000);
  });
});

describe('effectiveRotation: saved in /admin beats the default; the URL beats both', () => {
  const saved = { panes: ['league', 'event'], dwell_seconds: 30 };

  test('no URL params: the saved order and seconds are used', () => {
    expect(effectiveRotation(rotationConfig(''), saved)).toEqual({
      order: ['league', 'event'],
      dwellMs: 30000,
    });
  });

  test('URL params win, each on its own', () => {
    expect(effectiveRotation(rotationConfig('?panes=sponsors'), saved)).toEqual({
      order: ['sponsors'],
      dwellMs: 30000,
    });
    expect(effectiveRotation(rotationConfig('?dwell=10'), saved)).toEqual({
      order: ['league', 'event'],
      dwellMs: 10000,
    });
  });

  test('nothing saved, or junk saved, is the default', () => {
    expect(effectiveRotation(rotationConfig(''), null)).toEqual({ order: ALL, dwellMs: 15000 });
    expect(
      effectiveRotation(rotationConfig(''), { panes: ['<b>', 7], dwell_seconds: 'x' })
    ).toEqual({ order: ALL, dwellMs: 15000 });
    expect(effectiveRotation(rotationConfig(''), { dwell_seconds: 9999 }).dwellMs).toBe(120000);
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

interface DisplayConfig {
  ok: boolean;
  panes: string[];
  dwell_seconds: number;
  league: Array<{ kind: string; label: string; url: string; qr: string | null }>;
}
const DEFAULT_CONFIG: DisplayConfig = { ok: true, panes: ALL, dwell_seconds: 15, league: [] };
const QR = 'data:image/png;base64,iVBORw0KGgo=';

async function bootPage(
  search = '',
  {
    events = EVENTS,
    sponsors = SPONSOR_BUNDLE as unknown,
    config = DEFAULT_CONFIG as DisplayConfig,
    etag = '"c1"',
  } = {}
) {
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
  // Intervals are parked, but kept by period so a test can run one on demand.
  const intervals = new Map<number, Array<() => void>>();
  w.setInterval = ((f: () => void, ms: number) => {
    intervals.set(ms, [...(intervals.get(ms) ?? []), f]);
    return 0;
  }) as unknown as typeof setInterval;
  const server = {
    config,
    etag,
    configBodiesRead: 0,
    events,
    /** Sponsor bundle per event id; falls back to `sponsors` for any event. */
    bundles: {} as Record<string, unknown>,
    bundleFetches: [] as string[],
    impressions: [] as string[],
  };
  w.fetch = (async (url: string) => {
    const u = String(url);
    if (u.includes('/display-config')) {
      return {
        ok: true,
        status: 200,
        headers: new w.Headers({ ETag: server.etag }),
        json: async () => {
          server.configBodiesRead++;
          return server.config;
        },
      } as unknown as Response;
    }
    const m = /\/api\/v2\/events\/([^/]+)\/(sponsor-bundle|sponsors\/([^/]+)\/impression)/.exec(u);
    if (m && m[2] === 'sponsor-bundle') server.bundleFetches.push(m[1]);
    if (m && m[3]) server.impressions.push(`${m[1]}:${m[3]}`);
    const body =
      m && m[2] === 'sponsor-bundle'
        ? (server.bundles[m[1]] ?? sponsors)
        : m
          ? {}
          : { ok: true, items: server.events };
    return {
      ok: true,
      status: 200,
      headers: new w.Headers(),
      json: async () => body,
    } as unknown as Response;
  }) as typeof fetch;
  // The page's scripts, found by a parser (jsdom does not run them here) rather
  // than by a regex over the raw HTML, which CodeQL rightly flags.
  for (const el of new JSDOM(DISPLAY_HTML).window.document.querySelectorAll('script')) {
    w.eval(el.textContent || '');
  }
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
  const flush = async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  };
  /** Run the once-a-minute TV config check, as its interval would. */
  const recheckConfig = async () => {
    for (const f of intervals.get(60 * 1000) ?? []) f();
    await flush();
  };
  /** Run the five-minute events refresh, as its interval would. */
  const refreshEvents = async () => {
    for (const f of intervals.get(5 * 60 * 1000) ?? []) f();
    await flush();
  };
  return { doc, visible, key, tick, paneTimers, setHidden, server, recheckConfig, refreshEvents };
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

describe('display page: the order saved in /admin, league links, ETag re-checks', () => {
  const SAVED: DisplayConfig = {
    ok: true,
    panes: ['league', 'event'],
    dwell_seconds: 30,
    league: [
      { kind: 'schedule', label: 'Schedule', url: 'https://www.league.example/schedule', qr: QR },
      {
        kind: 'standings',
        label: 'Standings',
        url: 'https://docs.google.com/spreadsheets/d/abc/edit',
        qr: null,
      },
    ],
  };

  test('the saved order and seconds drive the board', async () => {
    const { visible, paneTimers, tick } = await bootPage('', { config: SAVED });
    // Events render first (default order, event pane); the saved config then
    // re-renders and keeps the event pane on screen rather than jumping.
    expect(visible()).toEqual(['event']);
    expect(paneTimers()[0][1].ms).toBe(30000);
    tick();
    expect(visible()).toEqual(['league']);
    tick();
    expect(visible()).toEqual(['event']);
  });

  test('league pane: label, scan-to-open QR, short link; no QR when there is none', async () => {
    const { doc } = await bootPage('', { config: SAVED });
    const items = doc.querySelectorAll('[data-testid="display-league-item"]');
    expect(items).toHaveLength(2);
    expect(
      [...doc.querySelectorAll('[data-testid="display-league-label"]')].map((e) => e.textContent)
    ).toEqual(['Schedule', 'Standings']);
    const qrs = doc.querySelectorAll('[data-testid="display-league-qr"]');
    expect(qrs).toHaveLength(1);
    expect(qrs[0].getAttribute('src')).toBe(QR);
    expect(doc.querySelector('[data-testid="display-league-url"]')?.textContent).toBe(
      'league.example/schedule'
    );
  });

  test('a QR that is not our PNG data URI never reaches an <img src>', async () => {
    const { doc } = await bootPage('', {
      config: {
        ...SAVED,
        league: [
          {
            kind: 'schedule',
            label: 'Schedule',
            url: 'https://l.example/',
            qr: 'javascript:alert(1)',
          },
        ],
      },
    });
    expect(doc.querySelector('[data-testid="display-league-qr"]')).toBeNull();
    expect(doc.querySelector('[data-testid="display-league-item"]')).not.toBeNull();
  });

  test('no league links: no league pane, and the default board is unchanged', async () => {
    const { doc } = await bootPage();
    expect(doc.querySelector('[data-testid="display-pane-league"]')).toBeNull();
    expect(doc.querySelectorAll('.pane-dots li')).toHaveLength(3);
  });

  test('the URL still overrides what was saved', async () => {
    const { paneTimers, doc } = await bootPage('?panes=event,upcoming&dwell=8', { config: SAVED });
    expect(paneTimers()[0][1].ms).toBe(8000);
    expect(doc.querySelector('[data-testid="display-pane-league"]')).toBeNull();
  });

  test('same ETag on the minute check: the body is not even read and nothing re-renders', async () => {
    const { doc, server, recheckConfig, tick, visible } = await bootPage('', { config: SAVED });
    tick();
    expect(visible()).toEqual(['league']);
    const panesEl = doc.querySelector('[data-testid="display-panes"]');
    const reads = server.configBodiesRead;
    await recheckConfig();
    expect(server.configBodiesRead).toBe(reads);
    expect(doc.querySelector('[data-testid="display-panes"]')).toBe(panesEl);
    expect(visible()).toEqual(['league']);
  });

  test('a new ETag (the organiser saved a change) re-renders with the new order', async () => {
    const { server, recheckConfig, paneTimers, doc } = await bootPage('', { config: SAVED });
    server.config = { ...SAVED, panes: ['event', 'upcoming'], dwell_seconds: 45 };
    server.etag = '"c2"';
    await recheckConfig();
    expect(paneTimers()[0][1].ms).toBe(45000);
    expect(doc.querySelector('[data-testid="display-pane-league"]')).toBeNull();
    expect(doc.querySelectorAll('.pane-dots li')).toHaveLength(2);
  });
});

describe('display page: sponsors follow the featured event across refreshes', () => {
  const bundle = (id: string, name: string) => ({
    ok: true,
    bundle: { surface_sponsors: { tvTop: [{ id, name }], tvSide: [{ id, name }] } },
  });

  test('a refresh of the same event does not reload sponsors or log impressions again', async () => {
    const { server, refreshEvents } = await bootPage();
    expect(server.bundleFetches).toEqual(['evt-1']);
    const logged = server.impressions.length;
    expect(logged).toBeGreaterThan(0);
    await refreshEvents();
    expect(server.bundleFetches).toEqual(['evt-1']);
    expect(server.impressions).toHaveLength(logged);
  });

  test('when the featured event changes, its sponsors replace the old ones everywhere', async () => {
    const { doc, server, refreshEvents } = await bootPage();
    server.bundles['evt-1'] = bundle('sp-old', 'Old Sponsor');
    server.bundles['evt-2'] = bundle('sp-new', 'New Sponsor');
    // evt-1 ended: the list now leads with evt-2.
    server.events = [EVENTS[1]];
    await refreshEvents();
    expect(server.bundleFetches).toEqual(['evt-1', 'evt-2']);
    const names = (testid: string) =>
      [...doc.querySelectorAll(`[data-testid="${testid}"]`)].map((e) => e.textContent);
    expect(names('display-wall-sponsor-name')).toEqual(['New Sponsor']);
    expect(names('display-sponsor-name')).toEqual(['New Sponsor']);
    expect(names('display-sponsor-sidebar-name')).toEqual(['New Sponsor']);
    expect(doc.body.textContent).not.toContain('Hall Bakery');
    // Impressions for the new event are logged once, against the new event.
    expect(server.impressions.filter((i) => i.startsWith('evt-2:'))).toEqual([
      'evt-2:sp-new',
      'evt-2:sp-new',
    ]);
  });

  test('the new event has no sponsors: the old ones are cleared, not left behind', async () => {
    const { doc, server, refreshEvents } = await bootPage();
    server.bundles['evt-2'] = { ok: true, bundle: { surface_sponsors: { tvTop: [], tvSide: [] } } };
    server.events = [EVENTS[1]];
    await refreshEvents();
    expect(doc.querySelector('[data-testid="display-pane-sponsors"]')).toBeNull();
    expect(doc.querySelector('[data-testid="display-sponsor-item"]')).toBeNull();
    expect(doc.querySelector('[data-testid="display-sponsor-rotate"]')).toBeNull();
  });
});
