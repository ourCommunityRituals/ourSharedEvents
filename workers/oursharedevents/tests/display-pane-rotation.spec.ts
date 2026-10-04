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
// What rotates when nothing is saved and the URL names nothing. 'sponsor' (a whole
// screen per sponsor) is opt-in, so it is on the allowlist but not in here.
const ALL = ['event', 'upcoming', 'sponsors', 'league', 'donate'];

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

  test('OSE-1521: donate and sponsor are allowlisted panes; nothing else is', () => {
    expect(rotationConfig('?panes=sponsor,donate,bogus,tv').order).toEqual(['sponsor', 'donate']);
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
  event_page?: { url: string; qr: string | null };
  donate?: { label: string; url: string; qr: string | null } | null;
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
    seed = undefined as undefined | ((server: Record<string, any>) => void), // eslint-disable-line @typescript-eslint/no-explicit-any
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
    /** The list's consented sponsor title per event id (OSE-1522). */
    sponsorTitles: {} as Record<string, string>,
    /** Sponsor bundle per event id; falls back to `sponsors` for any event. */
    bundles: {} as Record<string, unknown>,
    bundleFetches: [] as string[],
    /** GET /api/v2/events/:id answers, for events not in the public list. */
    single: {} as Record<string, unknown>,
    /** Display config per event id; falls back to `config`. */
    configs: {} as Record<string, DisplayConfig>,
    /** Event ids whose display-config request never answers (in flight). */
    holdConfig: new Set<string>(),
    configFetches: 0,
    /** When true, GET /api/v2/events rejects (a network failure). */
    failEvents: false,
    /** When set, GET /api/v2/events answers with this HTTP status and a JSON error. */
    eventsStatus: 0,
    impressions: [] as string[],
  };
  w.fetch = (async (url: string) => {
    const u = String(url);
    if (u.includes('/display-config')) {
      const id = /\/events\/([^/]+)\/display-config/.exec(u)![1];
      server.configFetches++;
      if (server.holdConfig.has(id)) return new Promise<Response>(() => {});
      const cfg = server.configs[id] ?? server.config;
      return {
        ok: true,
        status: 200,
        headers: new w.Headers({ ETag: server.configs[id] ? `"${id}"` : server.etag }),
        json: async () => {
          server.configBodiesRead++;
          return cfg;
        },
      } as unknown as Response;
    }
    const single = /\/api\/v2\/events\/([^/?]+)$/.exec(u);
    if (single) {
      const item = server.single[single[1]];
      return {
        ok: !!item,
        status: item ? 200 : 403,
        headers: new w.Headers(),
        json: async () => (item ? { ok: true, item } : { ok: false }),
      } as unknown as Response;
    }
    const m = /\/api\/v2\/events\/([^/]+)\/(sponsor-bundle|sponsors\/([^/]+)\/impression)/.exec(u);
    if (m && m[2] === 'sponsor-bundle') server.bundleFetches.push(m[1]);
    if (m && m[3]) server.impressions.push(`${m[1]}:${m[3]}`);
    if (!m && server.failEvents) throw new TypeError('network down');
    if (!m && server.eventsStatus) {
      return {
        ok: false,
        status: server.eventsStatus,
        headers: new w.Headers(),
        json: async () => ({ ok: false, error: 'Too many requests' }),
      } as unknown as Response;
    }
    const body =
      m && m[2] === 'sponsor-bundle'
        ? (server.bundles[m[1]] ?? sponsors)
        : m
          ? {}
          : { ok: true, items: server.events, sponsor_titles: server.sponsorTitles };
    return {
      ok: true,
      status: 200,
      headers: new w.Headers(),
      json: async () => body,
    } as unknown as Response;
  }) as typeof fetch;
  if (seed) seed(server);
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

describe('display page: the right event and its own config (review fixes)', () => {
  const LEAGUE_CFG: DisplayConfig = {
    ok: true,
    panes: ['league', 'event'],
    dwell_seconds: 30,
    league: [{ kind: 'schedule', label: 'Schedule', url: 'https://old.example/s', qr: null }],
  };

  test('?event= for a live event missing from the public list is fetched by id and featured', async () => {
    const unlisted = { id: 'evt-9', name: 'Unlisted Bocce', startDateISO: '2026-11-01' };
    const { doc } = await bootPage('?event=evt-9', {
      seed: (server) => {
        server.single['evt-9'] = unlisted;
      },
    });
    expect(doc.querySelector('[data-testid="display-featured-title"]')?.textContent).toBe(
      'Unlisted Bocce'
    );
  });

  test('?event= for a draft (refused by id) keeps the existing fallback', async () => {
    const { doc } = await bootPage('?event=evt-draft');
    expect(doc.querySelector('[data-testid="display-featured-title"]')?.textContent).toBe(
      'Bocce Night'
    );
  });

  test("when the featured event changes, the old event's league links are not shown", async () => {
    const { doc, server, refreshEvents } = await bootPage('', { config: LEAGUE_CFG });
    expect(doc.querySelector('[data-testid="display-pane-league"]')).not.toBeNull();
    // The new event's own config is still in flight: the old one must not stand in.
    server.holdConfig.add('evt-2');
    server.events = [EVENTS[1]];
    await refreshEvents();
    expect(doc.querySelector('[data-testid="display-featured-title"]')?.textContent).toBe(
      'Trivia <b>Tuesday</b>'
    );
    expect(doc.querySelector('[data-testid="display-pane-league"]')).toBeNull();
    expect(doc.body.textContent).not.toContain('old.example');
  });

  test('a sponsor with only a compact logo shows it on the sponsors pane, not the default', async () => {
    const { doc } = await bootPage('', {
      sponsors: {
        ok: true,
        bundle: {
          surface_sponsors: {
            tvTop: [],
            tvSide: [{ id: 'sp-c', name: 'Compact Co', sidebar_logo_url: 'https://x.test/c.png' }],
          },
        },
      },
    });
    expect(
      doc.querySelector('[data-testid="display-wall-sponsor-logo"]')?.getAttribute('src')
    ).toBe('/api/v2/sponsors/sp-c/logo?slot=sidebar');
  });
});

describe('display page: an empty event list clears the previous event (review fix)', () => {
  test("no events left: sponsors and config are cleared and the old event isn't polled", async () => {
    const { doc, server, refreshEvents, recheckConfig, paneTimers } = await bootPage();
    expect(doc.querySelector('[data-testid="display-sponsor-item"]')).not.toBeNull();
    server.events = [];
    await refreshEvents();
    expect(doc.querySelector('[data-testid="display-main"]')?.textContent).toContain(
      'No upcoming events'
    );
    expect(doc.querySelector('[data-testid="display-sponsor-item"]')).toBeNull();
    expect(doc.querySelector('[data-testid="display-sponsor-rotate"]')).toBeNull();
    // The privacy line stays; there is no ticker left to carry the old event's name.
    expect(doc.querySelector('[data-testid="display-consent"]')?.textContent).toContain(
      'We count the room'
    );
    expect(paneTimers()).toHaveLength(0);
    const fetches = server.configFetches;
    await recheckConfig();
    expect(server.configFetches, 'no config check for an event that is gone').toBe(fetches);
  });
});

describe('display page: a failed refresh keeps the last good board (review fix)', () => {
  test('the board, its rotation and its sponsors stay; no error replaces them', async () => {
    const { doc, server, refreshEvents, paneTimers, visible } = await bootPage();
    server.failEvents = true;
    await refreshEvents();
    expect(visible()).toEqual(['event']);
    expect(doc.querySelector('[data-testid="display-featured-title"]')?.textContent).toBe(
      'Bocce Night'
    );
    expect(doc.querySelector('[data-testid="display-empty"]')).toBeNull();
    expect(doc.querySelector('[data-testid="display-sponsor-item"]')).not.toBeNull();
    expect(paneTimers()).toHaveLength(1);
  });

  test('a TV that never loaded anything shows the error', async () => {
    const { doc } = await bootPage('', {
      seed: (server) => {
        server.failEvents = true;
      },
    });
    expect(doc.querySelector('[data-testid="display-empty"]')?.textContent).toBe(
      'Could not load events.'
    );
  });
});

describe('display page: an HTTP error on refresh is a failure, not an empty list (review fix)', () => {
  test('a 429 keeps the board instead of showing "No upcoming events"', async () => {
    const { doc, server, refreshEvents, visible } = await bootPage();
    server.eventsStatus = 429;
    await refreshEvents();
    expect(visible()).toEqual(['event']);
    expect(doc.querySelector('[data-testid="display-main"]')?.textContent).not.toContain(
      'No upcoming events'
    );
    expect(doc.querySelector('[data-testid="display-sponsor-item"]')).not.toBeNull();
  });

  test('a 500 on the first load shows the error, not "No upcoming events"', async () => {
    const { doc } = await bootPage('', {
      seed: (server) => {
        server.eventsStatus = 500;
      },
    });
    expect(doc.querySelector('[data-testid="display-empty"]')?.textContent).toBe(
      'Could not load events.'
    );
  });
});

// ── OSE-1521: the board rebuilt for the room, plus the fundraiser screens ────
//
// The TV's rules, as tests: no clock, no ticker, no number of any kind (the
// display shows no counts), wrapped events never featured, the featured screen
// carries a QR and a short link, the sponsor sits by the title (below the title
// and date), and the two new screens (donate, one per sponsor) are tier-blind,
// escaped and only drawn when there is something to draw.
describe('display page: the canvas board (OSE-1521)', () => {
  const EVENT_CFG: DisplayConfig = {
    ...DEFAULT_CONFIG,
    event_page: { url: 'https://stg.oursharedevents.com/events/evt-1', qr: QR },
  };
  const WRAPPED = {
    id: 'evt-0',
    name: 'May Bocce',
    venue: 'Eagles Hall',
    startDateISO: '2026-05-02',
    phase: 'post_event',
  };

  test('no clock, no ticker, and nothing that keeps moving on its own', async () => {
    const { doc } = await bootPage();
    for (const id of ['display-clock', 'display-ticker', 'display-ticker-text']) {
      expect(doc.querySelector(`[data-testid="${id}"]`), id).toBeNull();
    }
    expect(DISPLAY_HTML).not.toMatch(/@keyframes/);
    expect(DISPLAY_HTML).not.toMatch(/animation\s*:/);
  });

  test('the clock is gone too (nothing wakes the page every 30 s)', async () => {
    const { doc } = await bootPage();
    expect(doc.getElementById('clock')).toBeNull();
    expect(DISPLAY_HTML).not.toContain('updateClock');
  });

  test('no number is shown for the sponsors either: the rotation counter is gone', async () => {
    const { doc } = await bootPage();
    expect(doc.querySelector('[data-testid="display-sponsor-counter"]')).toBeNull();
    expect(DISPLAY_HTML).not.toContain('sponsor-counter');
  });

  test('a wrapped event is never featured or listed as coming up', async () => {
    const { doc, visible, tick } = await bootPage('', { events: [WRAPPED, ...EVENTS] });
    expect(doc.querySelector('[data-testid="display-featured-title"]')?.textContent).toBe(
      'Bocce Night'
    );
    expect(doc.body.textContent).not.toContain('May Bocce');
    tick();
    expect(visible()).toEqual(['upcoming']);
    expect(doc.body.textContent).not.toContain('May Bocce');
  });

  test('only wrapped events left: the empty board, not an "Upcoming event" from May', async () => {
    const { doc } = await bootPage('', { events: [WRAPPED] });
    expect(doc.querySelector('[data-testid="display-main"]')?.textContent).toContain(
      'No upcoming events'
    );
    expect(doc.body.textContent).not.toContain('May Bocce');
  });

  test('a ?event= link to a wrapped event does not feature it', async () => {
    const { doc } = await bootPage('?event=evt-0', {
      events: EVENTS,
      seed: (server) => {
        server.single['evt-0'] = WRAPPED;
      },
    });
    expect(doc.querySelector('[data-testid="display-featured-title"]')?.textContent).toBe(
      'Bocce Night'
    );
    expect(doc.body.textContent).not.toContain('May Bocce');
  });

  test('the label says what the event is: happening now, or coming up', async () => {
    const a = await bootPage('', { events: [{ ...EVENTS[0], phase: 'event' }] });
    expect(a.doc.querySelector('[data-testid="display-featured-label"]')?.textContent).toBe(
      'Happening now'
    );
    const b = await bootPage('', { events: [{ ...EVENTS[1], phase: 'pre_event' }] });
    expect(b.doc.querySelector('[data-testid="display-featured-label"]')?.textContent).toBe(
      'Coming up'
    );
  });

  test('the featured screen carries a QR of the event page and its short link', async () => {
    const { doc } = await bootPage('', { config: EVENT_CFG });
    const img = doc.querySelector('[data-testid="display-featured-qr"]');
    expect(img?.getAttribute('src')).toBe(QR);
    expect(doc.querySelector('[data-testid="display-featured-link"]')?.textContent).toBe(
      'stg.oursharedevents.com/events/evt-1'
    );
  });

  test('a QR that is not our PNG data URI never reaches an <img src>; the link still shows', async () => {
    const { doc } = await bootPage('', {
      config: {
        ...EVENT_CFG,
        event_page: { url: EVENT_CFG.event_page!.url, qr: 'javascript:alert(1)' },
      },
    });
    expect(doc.querySelector('[data-testid="display-featured-qr"]')).toBeNull();
    expect(doc.querySelector('[data-testid="display-featured-link"]')).not.toBeNull();
  });

  test("another event's QR is never shown on this event's screen", async () => {
    const { doc, server, refreshEvents } = await bootPage('', { config: EVENT_CFG });
    server.holdConfig.add('evt-2');
    server.events = [EVENTS[1]];
    await refreshEvents();
    expect(doc.querySelector('[data-testid="display-featured-title"]')?.textContent).toBe(
      'Trivia <b>Tuesday</b>'
    );
    expect(doc.querySelector('[data-testid="display-featured-qr"]')).toBeNull();
    expect(doc.body.textContent).not.toContain('events/evt-1');
  });

  test('the sponsor sits by the title: below the title and date, above the QR, inside the featured screen', async () => {
    const { doc } = await bootPage('', { config: EVENT_CFG });
    const pane = doc.querySelector('[data-testid="display-pane-event"]')!;
    const order = [
      '[data-testid="display-featured-title"]',
      '[data-testid="display-featured-meta"]',
      '[data-testid="display-sponsor-banner"]',
      '[data-testid="display-featured-qr"]',
    ].map((sel) => {
      const el = pane.querySelector(sel);
      expect(el, sel).not.toBeNull();
      return el!;
    });
    for (let i = 1; i < order.length; i++) {
      expect(
        order[i - 1].compareDocumentPosition(order[i]) & 4,
        `${i} follows ${i - 1} in the document`
      ).toBeTruthy();
    }
    // One strip only (not a second copy outside the pane), by the sponsor's name.
    expect(doc.querySelectorAll('[data-testid="display-sponsor-banner"]')).toHaveLength(1);
    expect(doc.querySelector('[data-testid="display-sponsor-name"]')?.textContent).toBe(
      'Hall Bakery'
    );
  });

  test('a sponsor with a display title shows that title, not the business name', async () => {
    const { doc } = await bootPage('', {
      sponsors: {
        ok: true,
        bundle: {
          surface_sponsors: {
            tvTop: [{ id: 'sp-9', name: 'Hall Bakery LLC', title: 'The Hall Bakery' }],
            tvSide: [],
          },
        },
      },
    });
    expect(doc.querySelector('[data-testid="display-sponsor-name"]')?.textContent).toBe(
      'The Hall Bakery'
    );
  });

  test('exactly one <h1> and one privacy line', async () => {
    const { doc } = await bootPage();
    expect(doc.querySelectorAll('h1')).toHaveLength(1);
    expect(doc.querySelectorAll('[data-testid="display-consent"]')).toHaveLength(1);
  });

  test('CSP: no inline handler, no external script, no stylesheet other than /ui.css', () => {
    const dom = new JSDOM(DISPLAY_HTML);
    const d = dom.window.document;
    expect(d.querySelectorAll('script[src]')).toHaveLength(0);
    // A parser, not a regex over the source: the page script legitimately says "on…".
    const handlers = [...d.querySelectorAll('*')].flatMap((el) =>
      [...el.attributes].filter((a) => /^on/i.test(a.name)).map((a) => `${el.tagName}.${a.name}`)
    );
    expect(handlers).toEqual([]);
    const sheets = [...d.querySelectorAll('link[rel="stylesheet"]')].map((l) =>
      l.getAttribute('href')
    );
    expect(sheets).toEqual(['/ui.css']);
  });

  test('both themes come from tokens: no literal colour in the page style', () => {
    const styles = [...DISPLAY_HTML.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(
      (m) => m[1]
    );
    expect(styles.length).toBeGreaterThan(0);
    for (const css of styles) {
      expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(css).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/i);
    }
  });
});

describe('display page: the donate screen (OSE-1521)', () => {
  const DONATE_CFG: DisplayConfig = {
    ...DEFAULT_CONFIG,
    panes: ['event', 'donate'],
    donate: { label: 'Donate', url: 'https://www.givesomething.example/bocce-fund', qr: QR },
  };

  test('a saved donate link adds a screen: heading, scan-to-give QR, short link', async () => {
    const { doc, visible, tick } = await bootPage('', { config: DONATE_CFG });
    expect(doc.querySelector('[data-testid="display-pane-donate"]')).not.toBeNull();
    expect(doc.querySelector('[data-testid="display-donate-qr"]')?.getAttribute('src')).toBe(QR);
    expect(doc.querySelector('[data-testid="display-donate-link"]')?.textContent).toBe(
      'givesomething.example/bocce-fund'
    );
    expect(doc.querySelectorAll('.pane-dots li')).toHaveLength(2);
    tick();
    expect(visible()).toEqual(['donate']);
    tick();
    expect(visible()).toEqual(['event']);
  });

  test('no donate link: no donate screen, even when the order names it', async () => {
    const { doc } = await bootPage('', {
      config: { ...DEFAULT_CONFIG, panes: ['event', 'donate'], donate: null },
    });
    expect(doc.querySelector('[data-testid="display-pane-donate"]')).toBeNull();
  });

  test('the screen carries no amount, goal or progress: the display shows no counts', async () => {
    const { doc } = await bootPage('', { config: DONATE_CFG });
    const pane = doc.querySelector('[data-testid="display-pane-donate"]')!;
    expect(pane.textContent).not.toMatch(/raised|goal|progress|\$\s*\d|\d+\s*%/i);
    expect(pane.querySelector('[data-testid="display-donate-heading"]')?.textContent).not.toMatch(
      /\d/
    );
  });

  test('a QR that is not our PNG data URI never reaches an <img src>', async () => {
    const { doc } = await bootPage('', {
      config: { ...DONATE_CFG, donate: { ...DONATE_CFG.donate!, qr: 'javascript:alert(1)' } },
    });
    expect(doc.querySelector('[data-testid="display-donate-qr"]')).toBeNull();
    expect(doc.querySelector('[data-testid="display-donate-link"]')).not.toBeNull();
  });

  test('the link text is escaped, never parsed as markup', async () => {
    const { doc } = await bootPage('', {
      config: {
        ...DONATE_CFG,
        donate: {
          label: 'Donate',
          url: 'https://x.example/"><img src=x onerror=alert(1)>',
          qr: null,
        },
      },
    });
    const pane = doc.querySelector('[data-testid="display-pane-donate"]')!;
    expect(pane.querySelector('img[src="x"]')).toBeNull();
  });

  test("another event's donate link is not shown while this event's own config is on its way", async () => {
    const { doc, server, refreshEvents } = await bootPage('', { config: DONATE_CFG });
    server.holdConfig.add('evt-2');
    server.events = [EVENTS[1]];
    await refreshEvents();
    expect(doc.querySelector('[data-testid="display-pane-donate"]')).toBeNull();
    expect(doc.body.textContent).not.toContain('givesomething');
  });

  test('a new ETag with a changed donate link re-renders; the same ETag does not', async () => {
    const { doc, server, recheckConfig } = await bootPage('', { config: DONATE_CFG });
    const panes = doc.querySelector('[data-testid="display-panes"]');
    await recheckConfig();
    expect(doc.querySelector('[data-testid="display-panes"]')).toBe(panes);
    server.config = {
      ...DONATE_CFG,
      donate: { label: 'Donate', url: 'https://other.example/give', qr: QR },
    };
    server.etag = '"c2"';
    await recheckConfig();
    expect(doc.querySelector('[data-testid="display-donate-link"]')?.textContent).toBe(
      'other.example/give'
    );
  });

  test('?panes=donate on the kiosk URL shows it when a link is saved (the URL picks, the config supplies)', async () => {
    const { visible } = await bootPage('?panes=donate', { config: DONATE_CFG });
    expect(visible()).toEqual(['donate']);
  });
});

describe('display page: a whole screen per sponsor (OSE-1521)', () => {
  const HALL = {
    id: 'sp-1',
    name: 'Hall Bakery LLC',
    title: 'The Hall Bakery',
    logo_url: 'https://x.test/a.png',
    tier: 'title',
  };
  const SPONSORS = {
    ok: true,
    bundle: {
      surface_sponsors: {
        tvTop: [HALL],
        tvSide: [
          HALL,
          { id: 'sp-2', name: 'Corner "Hardware"', tier: 'community' },
          { id: 'sp-3', name: 'Third <i>Place</i>', tier: 'community' },
        ],
      },
    },
  };
  const SAVED: DisplayConfig = { ...DEFAULT_CONFIG, panes: ['event', 'sponsor'] };

  test('each consented sponsor gets one screen, once, in the rotation', async () => {
    const { doc, visible, tick } = await bootPage('', { config: SAVED, sponsors: SPONSORS });
    const screens = doc.querySelectorAll('[data-pane^="sponsor-"]');
    expect(screens, 'a sponsor in both TV slots is one screen').toHaveLength(3);
    expect(doc.querySelectorAll('.pane-dots li')).toHaveLength(4);
    expect(visible()).toEqual(['event']);
    tick();
    expect(visible()).toEqual(['sponsor-0']);
    tick();
    expect(visible()).toEqual(['sponsor-1']);
    tick();
    expect(visible()).toEqual(['sponsor-2']);
    tick();
    expect(visible()).toEqual(['event']);
  });

  test('the sponsor appears by its title, with its logo through the proxy or the OSE default', async () => {
    const { doc } = await bootPage('', { config: SAVED, sponsors: SPONSORS });
    const titles = [...doc.querySelectorAll('[data-testid="display-sponsor-screen-title"]')].map(
      (e) => e.textContent
    );
    expect(titles).toEqual(['The Hall Bakery', 'Corner "Hardware"', 'Third <i>Place</i>']);
    const logos = [...doc.querySelectorAll('[data-testid="display-sponsor-screen-logo"]')].map(
      (i) => i.getAttribute('src')
    );
    expect(logos).toEqual([
      '/api/v2/sponsors/sp-1/logo',
      '/sponsor-default-logo.svg',
      '/sponsor-default-logo.svg',
    ]);
  });

  test('tier-blind: every sponsor screen is the same markup, no tier anywhere', async () => {
    const { doc } = await bootPage('', { config: SAVED, sponsors: SPONSORS });
    const screens = [...doc.querySelectorAll('[data-pane^="sponsor-"]')];
    const shape = (el: Element) =>
      [...el.querySelectorAll('*')].map((n) => `${n.tagName}.${n.className}`).join('>');
    expect(new Set(screens.map(shape)).size, 'one shape for every sponsor').toBe(1);
    for (const el of screens) {
      expect(el.outerHTML).not.toMatch(/data-tier|platinum|gold|silver/i);
    }
    expect(DISPLAY_HTML).not.toMatch(/\[data-tier/);
  });

  test('sponsor text is escaped, never parsed as markup', async () => {
    const { doc } = await bootPage('', { config: SAVED, sponsors: SPONSORS });
    expect(doc.querySelector('[data-pane^="sponsor-"] i')).toBeNull();
    expect(
      doc.querySelector('[data-pane="sponsor-1"] img[alt="Corner \\"Hardware\\""]')
    ).not.toBeNull();
  });

  test('a screen shows no number: no "2 of 5", no count of sponsors', async () => {
    const { doc } = await bootPage('', { config: SAVED, sponsors: SPONSORS });
    for (const el of doc.querySelectorAll('[data-pane^="sponsor-"]')) {
      expect(el.textContent).not.toMatch(/\d\s*(\/|of)\s*\d/);
    }
  });

  test('no sponsors: no sponsor screens (nothing to draw is nothing in the rotation)', async () => {
    const { doc } = await bootPage('', {
      config: SAVED,
      sponsors: { ok: true, bundle: { surface_sponsors: { tvTop: [], tvSide: [] } } },
    });
    expect(doc.querySelector('[data-pane^="sponsor-"]')).toBeNull();
    expect(doc.querySelector('[data-testid="display-pane-dots"]')).toBeNull();
  });

  test('the default order does not add them (the sponsors wall already shows everyone)', async () => {
    const { doc } = await bootPage('', { sponsors: SPONSORS });
    expect(doc.querySelector('[data-pane^="sponsor-"]')).toBeNull();
    expect(doc.querySelector('[data-testid="display-pane-sponsors"]')).not.toBeNull();
  });

  test('?panes=sponsor on the kiosk URL asks for them', async () => {
    const { visible } = await bootPage('?panes=sponsor', { sponsors: SPONSORS });
    expect(visible()).toEqual(['sponsor-0']);
  });

  test('impressions are not logged again for a screen: each sponsor was counted once on load', async () => {
    const { server } = await bootPage('', { config: SAVED, sponsors: SPONSORS });
    const perSponsor = server.impressions.filter((i) => i.endsWith(':sp-2'));
    // sp-2 is in the side slot only: one impression, however many screens show it.
    expect(perSponsor).toHaveLength(1);
  });
});

describe('OSE-1522 | the TV shows the consented sponsor by an event title', () => {
  const lineOf = (doc: Document, pane: string) =>
    [...doc.querySelectorAll(`[data-testid="${pane}"]`)].map((el) => el.textContent);

  test('the featured event: "Supported by" its consented sponsor, from the list', async () => {
    const { doc } = await bootPage('', {
      seed: (server) => {
        server.sponsorTitles = { 'evt-1': 'Hall Bakery' };
      },
    });
    expect(lineOf(doc, 'display-featured-sponsor')).toEqual(['Supported by Hall Bakery']);
  });

  test('"Also coming up": each card carries its own sponsor, escaped like every other value', async () => {
    const { doc } = await bootPage('', {
      seed: (server) => {
        server.sponsorTitles = { 'evt-2': 'Corner <i>Hardware</i>' };
      },
    });
    const card = doc.querySelector('[data-testid="display-upcoming-card"]')!;
    expect(card.querySelector('[data-testid="display-upcoming-sponsor"]')?.textContent).toBe(
      'Supported by Corner <i>Hardware</i>'
    );
    expect(card.querySelector('i'), 'a sponsor title is never parsed as markup').toBeNull();
    // Only the event that has a consented sponsor shows one.
    expect(lineOf(doc, 'display-featured-sponsor')).toEqual([]);
  });

  test('no consented sponsor, no line (silence is not consent)', async () => {
    const { doc } = await bootPage();
    expect(doc.querySelector('[data-testid="display-featured-sponsor"]')).toBeNull();
    expect(doc.querySelector('[data-testid="display-upcoming-sponsor"]')).toBeNull();
  });

  test('a featured event that is not in the list (fetched by id) still shows its sponsors, from its bundle', async () => {
    const { doc } = await bootPage('?event=evt-9', {
      seed: (server) => {
        server.single['evt-9'] = { id: 'evt-9', name: 'By Id', venue: 'Elsewhere' };
      },
    });
    expect(doc.querySelector('[data-testid="display-featured-title"]')?.textContent).toBe('By Id');
    expect(lineOf(doc, 'display-featured-sponsor')).toEqual([
      'Supported by Hall Bakery, Corner "Hardware"',
    ]);
  });
});
