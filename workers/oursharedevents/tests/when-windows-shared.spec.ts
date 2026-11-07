/**
 * OSE-1362 — a "Next 90 days" window, and ONE definition of the `when` windows
 * shared by /events and the landing "Happening near you" list + map.
 *
 *   - chip order on /events is the ticket's order, next-90 before Recently wrapped
 *   - next-90 = today .. today+90 in the EVENT's zone (day 0 / 90 in, day 91 out,
 *     wrapped out), with an injected `now`
 *   - chip, count line and empty copy agree for next-90
 *   - the landing's window pills are a subset of the same `when` values, carry
 *     the same labels, and tag each card with exactly the windows inWhenWindow /
 *     applyDiscoveryFilters put it in — one definition, not two that agree today
 *
 * Chips WRAP on phones (PR #681, OSE-1372), deliberately not a horizontal scroll:
 * a scrolled row put the active chip off-screen beside a count line naming it.
 *
 * @born-red OSE-1362 | method: next-90 is not a WHEN_OPTIONS value and landing emits its own "7 days / 30 days / 90 days" pills against origin/main's event-discovery.ts + landing-area.ts (stash-restored originals: 9 red of 10; the wrap lock is green on main) | date: 2026-09-29
 */
import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import {
  WHEN_OPTIONS,
  applyDiscoveryFilters,
  discoveryChipLabel,
  discoveryCountLabel,
  discoveryEmptyCopy,
  inWhenWindow,
  parseDiscoveryFilters,
  renderDiscoveryFilters,
} from '../src/lib/event-discovery';
import { DEFAULT_WINDOW, LANDING_WINDOWS, renderLandingArea } from '../src/lib/landing-area';

const NOW = new Date('2026-09-16T20:00:00Z'); // Wed Sep 16, 3pm Chicago
const ev = (
  id: string,
  date: string | null,
  phase = 'pre_event',
  timezone = 'America/Chicago'
) => ({
  id,
  name: id,
  venue: 'Eagles Hall',
  startDateISO: date,
  phase,
  timezone,
});

describe('OSE-1362 | chip order on /events', () => {
  test('every window still parses (shared links keep working); five are chips (OSE-1520)', () => {
    expect([...WHEN_OPTIONS]).toEqual([
      'all',
      'today',
      'weekend',
      'week',
      'month',
      'next-month',
      'next-90',
      'past',
    ]);
    const bar = renderDiscoveryFilters({ when: 'all', q: '' }, 0);
    const labels = [...bar.matchAll(/class="disc-chip[ "][^>]*>([^<]*)<\/a>/g)].map((m) => m[1]);
    expect(labels).toEqual([
      'Everything',
      'This weekend',
      'Next 7 days',
      'This month',
      'Recently wrapped',
    ]);
  });

  test('?when=next-90 is allowlisted', () => {
    expect(parseDiscoveryFilters(new URL('https://x/events?when=next-90')).when).toBe('next-90');
  });
});

describe('OSE-1362 | next-90 boundaries (event-local, injected now)', () => {
  const items = [
    ev('day0', '2026-09-16'),
    ev('day90', '2026-12-15'),
    ev('day91', '2026-12-16'),
    ev('yesterday', '2026-09-15'),
    ev('undated', null),
    ev('wrapped', '2026-09-20', 'post_event'),
    // 9pm Chicago on Dec 15 (day 90) is 03:00Z on Dec 16 (day 91 in UTC).
    ev('day90-evening', '2026-12-16T03:00:00.000Z'),
    // 03:00Z on Sep 17 is 10pm Sep 16 in Chicago — day 0, not day 1.
    ev('day0-evening', '2026-09-17T03:00:00.000Z'),
  ];
  const ids = (now = NOW) =>
    applyDiscoveryFilters(items, { when: 'next-90', q: '' }, now).map((e) => e.id);

  test('day 0 and day 90 in; day 91, past, undated and wrapped out', () => {
    expect(ids()).toEqual(['day0', 'day90', 'day90-evening', 'day0-evening']);
  });

  test('"today" is the event zone\'s day, not the Worker\'s UTC day', () => {
    // 11pm Chicago on Sep 16 is 04:00Z on Sep 17 — still Sep 16 for these events.
    expect(ids(new Date('2026-09-17T04:00:00Z'))).toEqual([
      'day0',
      'day90',
      'day90-evening',
      'day0-evening',
    ]);
  });

  test('chip, count line and empty copy agree', () => {
    const bar = renderDiscoveryFilters({ when: 'next-90', q: '' }, 0);
    expect(bar).toMatch(/data-testid="disc-when-next-90" aria-current="true">Next 90 days</);
    expect(bar).toContain('data-testid="disc-summary">0 events in the next 90 days<');
    expect(discoveryCountLabel('next-90', 1)).toBe('1 event in the next 90 days');
    expect(discoveryEmptyCopy({ when: 'next-90', q: '' })).toContain(
      'Nothing in the next 90 days yet.'
    );
  });
});

describe('OSE-1362 | landing and /events share one `when` definition', () => {
  test('landing windows are /events values, widest last and default', () => {
    for (const w of LANDING_WINDOWS) expect(WHEN_OPTIONS).toContain(w);
    expect(DEFAULT_WINDOW).toBe('next-90');
    expect(LANDING_WINDOWS[LANDING_WINDOWS.length - 1]).toBe(DEFAULT_WINDOW);
  });

  test('landing pills carry the /events chip labels, in order', () => {
    const html = renderLandingArea([ev('a', '2026-09-18')], { now: NOW.getTime() }).html;
    const fieldset = html.match(/data-testid="toggle-window">([^]*?)<\/fieldset>/)?.[1] ?? '';
    const pills = [
      ...fieldset.matchAll(/<label class="disc-chip" for="win-([a-z0-9-]+)">([^<]*)<\/label>/g),
    ];
    expect(pills.map((m) => m[1])).toEqual([...LANDING_WINDOWS]);
    expect(pills.map((m) => m[2])).toEqual(LANDING_WINDOWS.map((w) => discoveryChipLabel(w)));
    expect(html).toContain(`id="win-${DEFAULT_WINDOW}" class="toggle-radio" checked`);
  });

  test('every landing card is tagged with exactly the windows /events puts it in', () => {
    const items = [
      ev('d0', '2026-09-16'),
      ev('d5', '2026-09-21'),
      ev('d20', '2026-10-06'),
      ev('d90', '2026-12-15'),
      ev('d91', '2026-12-16'),
      ev('eve', '2026-12-16T03:00:00.000Z'),
      ev('live', '2026-09-14', 'event'),
      ev('undated', null),
    ];
    const html = renderLandingArea(items, { now: NOW.getTime() }).html;
    for (const e of items) {
      const cls =
        html
          .match(new RegExp(`class="([^"]*)" data-testid="area-card" data-event-id="${e.id}"`))?.[1]
          ?.split(' ') ?? [];
      for (const w of LANDING_WINDOWS) {
        const onEvents = applyDiscoveryFilters([e], { when: w, q: '' }, NOW).length === 1;
        expect(cls.includes(`when-${w}`), `${e.id} / ${w}`).toBe(onEvents);
        expect(inWhenWindow(e, w, NOW)).toBe(onEvents);
      }
    }
  });
});

describe('OSE-1362 | served surfaces', () => {
  beforeAll(async () => {
    const tenv = env as unknown as { DB: D1Database; TEST_MIGRATION_STATEMENTS: string };
    for (const stmt of JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[]) {
      try {
        await tenv.DB.prepare(stmt).run();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
        throw e;
      }
    }
  });

  test('/events?when=next-90 marks the chip and names the window', async () => {
    const html = await (await SELF.fetch('https://t.test/events?when=next-90')).text();
    expect(html).toMatch(/disc-when-next-90" aria-current="true">Next 90 days</);
    expect(html).toMatch(/data-testid="disc-summary">\d+ events? in the next 90 days</);
  });

  test('chips still wrap on phones (PR #681), not a horizontal scroll', async () => {
    const html = await (await SELF.fetch('https://t.test/events')).text();
    expect(html).toMatch(/\.disc-chips \{[^}]*flex-wrap: wrap/);
    expect(html).not.toMatch(/\.disc-chips \{[^}]*overflow-x: auto/);
  });
});
