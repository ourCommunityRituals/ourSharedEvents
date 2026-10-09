/**
 * Pre-event countdown ("Starts in 5 hours") — the pure text and the browser
 * tick (OSE-474).
 *
 * The page-level wiring (pre-event only, inside the when line) is covered by
 * `event-countdown-page.spec.ts` in the workers pool. This node spec covers the
 * text at each boundary, day counting across DST in the event's zone, date-only
 * events, and the browser script: run with fake timers against a jsdom element,
 * it must say what the server says at the same instant, and say "Starting now"
 * rather than flip the page when the start arrives.
 *
 * @born-red method: run against main at be0ba4c, where src/lib/event-countdown.ts
 * does not exist — the import fails, so every test here is red.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  COUNTDOWN_CLIENT_SCRIPT,
  COUNTDOWN_MAX_DAYS,
  countdownText,
  renderEventCountdown,
  type CountdownRow,
} from '../src/lib/event-countdown';

const at = (iso: string) => new Date(iso);
const MIN = 60_000;
const HOUR = 60 * MIN;

// 18:00 Chicago (CDT) on Saturday 2026-10-24.
const TIMED: CountdownRow = {
  start_date: '2026-10-24',
  starts_at: '2026-10-24T23:00:00Z',
  timezone: 'America/Chicago',
};
const START = at(TIMED.starts_at as string).getTime();
const before = (ms: number) => new Date(START - ms);

describe('timed event: minutes, hours, days', () => {
  test('under a minute reads "Starting now"', () => {
    expect(countdownText(TIMED, before(59_999))).toBe('Starting now');
    expect(countdownText(TIMED, before(1))).toBe('Starting now');
  });

  test('minutes, singular and plural, rounded down', () => {
    expect(countdownText(TIMED, before(MIN))).toBe('Starts in 1 minute');
    expect(countdownText(TIMED, before(20 * MIN))).toBe('Starts in 20 minutes');
    expect(countdownText(TIMED, before(20 * MIN + 59_000))).toBe('Starts in 20 minutes');
    expect(countdownText(TIMED, before(HOUR - 1))).toBe('Starts in 59 minutes');
  });

  test('hours, singular and plural, rounded down, below 24', () => {
    expect(countdownText(TIMED, before(HOUR))).toBe('Starts in 1 hour');
    expect(countdownText(TIMED, before(5 * HOUR + 59 * MIN))).toBe('Starts in 5 hours');
    expect(countdownText(TIMED, before(24 * HOUR - 1))).toBe('Starts in 23 hours');
  });

  test('from 24 hours, whole calendar days in the event zone', () => {
    // 24h before 18:00 Saturday is 18:00 Friday in Chicago: one day.
    expect(countdownText(TIMED, before(24 * HOUR))).toBe('Starts tomorrow');
    // 47h before: 19:00 Thursday → Saturday, two calendar days.
    expect(countdownText(TIMED, before(47 * HOUR))).toBe('Starts in 2 days');
    // 23:30 Wednesday Chicago is already Thursday in UTC; the count is Chicago's: 3.
    expect(countdownText(TIMED, at('2026-10-22T04:30:00Z'))).toBe('Starts in 3 days');
  });

  test('at or after the start: no countdown', () => {
    expect(countdownText(TIMED, new Date(START))).toBeNull();
    expect(countdownText(TIMED, new Date(START + HOUR))).toBeNull();
  });

  test('more than COUNTDOWN_MAX_DAYS away: no countdown, the date line says enough', () => {
    expect(COUNTDOWN_MAX_DAYS).toBe(30);
    expect(countdownText(TIMED, at('2026-09-24T12:00:00Z'))).toBe('Starts in 30 days');
    expect(countdownText(TIMED, at('2026-09-23T12:00:00Z'))).toBeNull();
  });

  test('days are counted in the event zone, not UTC', () => {
    // 23:30 CDT Wednesday 2026-10-21 = 04:30Z Thursday; the start is Saturday 18:00 CDT
    // (23:00Z Saturday). Chicago calendar: 3 days. UTC calendar: 2.
    const now = at('2026-10-22T04:30:00Z');
    expect(countdownText({ ...TIMED, timezone: 'America/Chicago' }, now)).toBe('Starts in 3 days');
    expect(countdownText({ ...TIMED, timezone: 'UTC' }, now)).toBe('Starts in 2 days');
    // No usable zone: the date line falls back to UTC for a timed event, and so does this.
    expect(countdownText({ ...TIMED, timezone: 'Mars/Olympus' }, now)).toBe('Starts in 2 days');
  });
});

describe('DST: days are calendar days in the event zone', () => {
  // US DST ends Sunday 2026-11-01 02:00 CDT → 01:00 CST (a 25-hour day).
  test('across fall-back the count is calendar days, not elapsed / 24h', () => {
    // 00:30 CST Monday 2026-11-02 = 06:30Z.
    const row = {
      start_date: '2026-11-02',
      starts_at: '2026-11-02T06:30:00Z',
      timezone: 'America/Chicago',
    };
    // 23:30 CDT Saturday 2026-10-31 = 04:30Z Sunday: 26 elapsed hours, but Saturday to
    // Monday is 2 calendar days.
    expect(countdownText(row, at('2026-11-01T04:30:00Z'))).toBe('Starts in 2 days');
  });

  test('24h+ on the 25-hour day itself stays in hours, never "in 0 days"', () => {
    // 23:30 CST Sunday 2026-11-01 = 05:30Z Monday.
    const row = {
      start_date: '2026-11-01',
      starts_at: '2026-11-02T05:30:00Z',
      timezone: 'America/Chicago',
    };
    // 00:10 CDT Sunday = 05:10Z Sunday: 24h20m ahead, same local day.
    expect(countdownText(row, at('2026-11-01T05:10:00Z'))).toBe('Starts in 24 hours');
  });

  test('across spring-forward (a 23-hour day) the count is still calendar days', () => {
    // US DST starts Sunday 2026-03-08. Start 10:00 CDT Monday 2026-03-09 = 15:00Z.
    const row = {
      start_date: '2026-03-09',
      starts_at: '2026-03-09T15:00:00Z',
      timezone: 'America/Chicago',
    };
    // 11:00 CST Saturday 2026-03-07 = 17:00Z: 46 elapsed hours, 2 calendar days.
    expect(countdownText(row, at('2026-03-07T17:00:00Z'))).toBe('Starts in 2 days');
  });
});

describe('date-only event: days only, never hours', () => {
  const DATE_ONLY: CountdownRow = { start_date: '2026-10-24', timezone: 'America/Chicago' };

  test('the day before reads "Starts tomorrow", even an hour before local midnight', () => {
    // 23:00 CDT Friday 2026-10-23 = 04:00Z Saturday — already the 24th in UTC.
    expect(countdownText(DATE_ONLY, at('2026-10-24T04:00:00Z'))).toBe('Starts tomorrow');
    // 00:30 CDT Friday.
    expect(countdownText(DATE_ONLY, at('2026-10-23T05:30:00Z'))).toBe('Starts tomorrow');
  });

  test('several days out', () => {
    expect(countdownText(DATE_ONLY, at('2026-10-21T17:00:00Z'))).toBe('Starts in 3 days');
  });

  test('on the day or after: no countdown (the event is live or over)', () => {
    expect(countdownText(DATE_ONLY, at('2026-10-24T05:00:00Z'))).toBeNull();
    expect(countdownText(DATE_ONLY, at('2026-10-26T17:00:00Z'))).toBeNull();
  });

  test('across a DST change the day count does not slip', () => {
    const row = { start_date: '2026-11-02', timezone: 'America/Chicago' };
    // 23:30 CDT Saturday 2026-10-31 = 04:30Z Sunday.
    expect(countdownText(row, at('2026-11-01T04:30:00Z'))).toBe('Starts in 2 days');
  });

  test('no usable zone: the day is read in the platform home zone, like the phase', () => {
    // 21:00 CDT Friday = 02:00Z Saturday: tomorrow in Chicago, today in UTC.
    expect(
      countdownText({ start_date: '2026-10-24', timezone: null }, at('2026-10-24T02:00:00Z'))
    ).toBe('Starts tomorrow');
    expect(
      countdownText(
        { start_date: '2026-10-24', timezone: 'Mars/Olympus' },
        at('2026-10-24T02:00:00Z')
      )
    ).toBe('Starts tomorrow');
  });

  test('a stored timestamp counts by its leading date', () => {
    expect(
      countdownText(
        { start_date: '2026-10-24 18:00:00', timezone: 'America/Chicago' },
        at('2026-10-21T17:00:00Z')
      )
    ).toBe('Starts in 3 days');
  });

  test('an unreadable starts_at falls back to the date, as the phase does', () => {
    expect(
      countdownText(
        { start_date: '2026-10-24', starts_at: 'not-a-time', timezone: 'America/Chicago' },
        at('2026-10-21T17:00:00Z')
      )
    ).toBe('Starts in 3 days');
  });
});

describe('no date: no countdown', () => {
  test.each([
    [{ start_date: null, timezone: 'America/Chicago' }],
    [{ start_date: '', timezone: null }],
    [{ start_date: 'not-a-date', timezone: null }],
  ])('%o', (row) => {
    expect(countdownText(row as CountdownRow, at('2026-10-21T17:00:00Z'))).toBeNull();
  });
});

describe('renderEventCountdown', () => {
  test('the element carries the instant and zone, is not a live region, and escapes', () => {
    const { html, script } = renderEventCountdown(TIMED, 'n0nce', before(5 * HOUR));
    expect(html).toContain('data-testid="event-countdown"');
    expect(html).toContain('class="sub-line"');
    expect(html).toContain('aria-live="off"');
    expect(html).toContain('data-starts-at="2026-10-24T23:00:00.000Z"');
    expect(html).toContain('data-tz="America/Chicago"');
    expect(html).toContain('>Starts in 5 hours</small>');
    expect(script).toMatch(/^<script nonce="n0nce">/);
    expect(script).not.toMatch(/\bon[a-z]+=/i);
  });

  test('date-only carries the day, not an instant', () => {
    const { html } = renderEventCountdown(
      { start_date: '2026-10-24', timezone: 'America/Chicago' },
      'n',
      at('2026-10-21T17:00:00Z')
    );
    expect(html).toContain('data-start-day="2026-10-24"');
    expect(html).not.toContain('data-starts-at');
  });

  test('nothing at all when there is no countdown', () => {
    expect(renderEventCountdown(TIMED, 'n', new Date(START + MIN))).toEqual({
      html: '',
      script: '',
    });
  });
});

// ── The browser tick ────────────────────────────────────────────────────────

afterEach(() => {
  vi.useRealTimers();
});

/** Render the element at `now`, run the page script with fake timers, return the element. */
function runInBrowser(row: CountdownRow, now: Date): HTMLElement {
  vi.useFakeTimers({ now, toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout'] });
  const { html } = renderEventCountdown(row, 'n', now);
  const dom = new JSDOM(`<p data-testid="event-when">Saturday${html}</p>`);
  // The script reads only `document` from the page; Date, Intl and setInterval
  // are the (faked) globals.
  new Function('document', COUNTDOWN_CLIENT_SCRIPT)(dom.window.document);
  return dom.window.document.querySelector('[data-testid="event-countdown"]') as HTMLElement;
}

describe('browser tick', () => {
  test('ticks every minute and matches the server text at each instant', () => {
    const start = before(61 * MIN);
    const el = runInBrowser(TIMED, start);
    expect(el.textContent).toBe('Starts in 1 hour');
    for (let m = 1; m <= 60; m++) {
      vi.advanceTimersByTime(MIN);
      const expected = countdownText(TIMED, new Date(start.getTime() + m * MIN));
      expect(el.textContent, `after ${m} min`).toBe(expected);
    }
    expect(el.textContent).toBe('Starts in 1 minute');
  });

  test('at the start it says "Starting now" and stays; it does not reload or remove itself', () => {
    const el = runInBrowser(TIMED, before(2 * MIN));
    vi.advanceTimersByTime(2 * MIN);
    expect(el.textContent).toBe('Starting now');
    vi.advanceTimersByTime(3 * HOUR);
    expect(el.textContent).toBe('Starting now');
    expect(el.isConnected).toBe(true);
  });

  test('a page served earlier (cached) is corrected on load', () => {
    vi.useFakeTimers({ now: before(10 * HOUR), toFake: ['Date', 'setInterval', 'setTimeout'] });
    const { html } = renderEventCountdown(TIMED, 'n', before(10 * HOUR));
    vi.setSystemTime(before(3 * HOUR));
    const dom = new JSDOM(`<p>${html}</p>`);
    new Function('document', COUNTDOWN_CLIENT_SCRIPT)(dom.window.document);
    expect(dom.window.document.querySelector('small')?.textContent).toBe('Starts in 3 hours');
  });

  test.each([
    ['timed, days out', TIMED, '2026-10-22T04:30:00Z'],
    [
      'timed, fall-back 25h day',
      { start_date: '2026-11-01', starts_at: '2026-11-02T05:30:00Z', timezone: 'America/Chicago' },
      '2026-11-01T05:10:00Z',
    ],
    [
      'timed, across spring-forward',
      { start_date: '2026-03-09', starts_at: '2026-03-09T15:00:00Z', timezone: 'America/Chicago' },
      '2026-03-07T17:00:00Z',
    ],
    [
      'date-only, tomorrow late evening',
      { start_date: '2026-10-24', timezone: 'America/Chicago' },
      '2026-10-24T04:00:00Z',
    ],
    [
      'date-only, across fall-back',
      { start_date: '2026-11-02', timezone: 'America/Chicago' },
      '2026-11-01T04:30:00Z',
    ],
    [
      'date-only, Tokyo',
      { start_date: '2026-10-24', timezone: 'Asia/Tokyo' },
      '2026-10-22T16:00:00Z',
    ],
  ] as [string, CountdownRow, string][])(
    'browser text equals server text: %s',
    (_label, row, nowIso) => {
      const now = at(nowIso);
      const server = countdownText(row, now);
      expect(server).not.toBeNull();
      expect(runInBrowser(row, now).textContent).toBe(server);
    }
  );

  test('date-only: when the day arrives it says "Starts today", never hours', () => {
    const row = { start_date: '2026-10-24', timezone: 'America/Chicago' };
    // 23:58 CDT Friday.
    const el = runInBrowser(row, at('2026-10-24T04:58:00Z'));
    expect(el.textContent).toBe('Starts tomorrow');
    vi.advanceTimersByTime(3 * MIN);
    expect(el.textContent).toBe('Starts today');
  });
});
