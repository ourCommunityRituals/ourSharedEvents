/**
 * Attendee discovery — /events answers a question instead of dumping a list.
 *
 *   - parse: `when` allowlisted (junk → upcoming), `q` capped + control-stripped
 *   - apply: today / weekend / week / month / past windows in the EVENT's zone;
 *     q matches name + venue only, case-insensitive; wrapped events only under past
 *   - render: GET form + chips with aria-current, q reflected once and escaped,
 *     empty copy names the question; the served /events page carries it all
 *     server-side with no client fetch
 */

import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import {
  parseDiscoveryFilters,
  applyDiscoveryFilters,
  renderDiscoveryFilters,
  discoveryEmptyCopy,
  Q_MAX_LEN,
} from '../src/lib/event-discovery';

const NOW = new Date('2026-09-16T20:00:00Z'); // Wed Sep 16, 3pm Chicago
const ev = (
  id: string,
  date: string | null,
  name = id,
  venue = 'Eagles Hall',
  phase = 'pre_event'
) => ({
  id,
  name,
  venue,
  startDateISO: date,
  phase,
  timezone: 'America/Chicago',
});

describe('parseDiscoveryFilters', () => {
  test('defaults and allowlist', () => {
    expect(parseDiscoveryFilters(new URL('https://x/events'))).toEqual({ when: 'all', q: '' });
    expect(parseDiscoveryFilters(new URL('https://x/events?when=weekend')).when).toBe('weekend');
    expect(parseDiscoveryFilters(new URL('https://x/events?when=DROP%20TABLE')).when).toBe('all');
  });
  test('q is trimmed, whitespace-collapsed, control-stripped, capped', () => {
    const f = parseDiscoveryFilters(
      new URL(`https://x/events?q=${encodeURIComponent('  tri\u0000via   night ')}`)
    );
    expect(f.q).toBe('tri via night');
    const long = 'a'.repeat(Q_MAX_LEN + 40);
    expect(parseDiscoveryFilters(new URL(`https://x/events?q=${long}`)).q.length).toBe(Q_MAX_LEN);
  });
});

describe('applyDiscoveryFilters', () => {
  const items = [
    ev('today', '2026-09-16', 'Trivia Night'),
    ev('fri', '2026-09-18', 'Bocce Friday', 'RIPH'),
    ev('sun', '2026-09-20', 'Sunday Jam'),
    ev('next-week', '2026-09-25', 'Art Walk'),
    ev('oct', '2026-10-03', 'Oktober Bocce'),
    ev('undated', null, 'TBD Thing'),
    ev('wrapped', '2026-09-10', 'Last Week Show', 'Eagles Hall', 'post_event'),
  ];
  const ids = (when: string, q = '') =>
    applyDiscoveryFilters(items, { when: when as never, q }, NOW).map((e) => e.id);

  test('all = everything the API lists, wrapped and undated included (the existing page contract)', () => {
    expect(ids('all')).toEqual(['today', 'fri', 'sun', 'next-week', 'oct', 'undated', 'wrapped']);
  });
  test('today', () => expect(ids('today')).toEqual(['today']));
  test('weekend = Fri–Sun of this week', () => expect(ids('weekend')).toEqual(['fri', 'sun']));
  test('week = next 7 days inclusive', () => expect(ids('week')).toEqual(['today', 'fri', 'sun']));
  test('month = same calendar month', () =>
    expect(ids('month')).toEqual(['today', 'fri', 'sun', 'next-week']));
  test('past = wrapped only', () => expect(ids('past')).toEqual(['wrapped']));
  test('q matches name or venue, case-insensitive, and composes with when', () => {
    expect(ids('all', 'bocce')).toEqual(['fri', 'oct']);
    expect(ids('all', 'riph')).toEqual(['fri']);
    expect(ids('month', 'bocce')).toEqual(['fri']);
    expect(ids('all', 'zzz')).toEqual([]);
  });
  test('"today" is the event\'s local day, not the Worker\'s UTC day', () => {
    // 11pm Chicago on the 16th is 04:00Z on the 17th — still "today" for a Sep 16 event.
    const late = new Date('2026-09-17T04:00:00Z');
    expect(applyDiscoveryFilters(items, { when: 'today', q: '' }, late).map((e) => e.id)).toEqual([
      'today',
    ]);
  });
});

describe('renderDiscoveryFilters', () => {
  test('GET form, one chip per option, active chip has aria-current, q reflected escaped once', () => {
    const bar = renderDiscoveryFilters({ when: 'weekend', q: '<b>x</b>' }, 2);
    expect(bar).toContain('method="get" action="/events" role="search"');
    expect(bar).toContain('data-testid="disc-when-weekend"');
    expect(bar).toMatch(/disc-when-weekend"[^>]*aria-current="true"/);
    expect(bar).not.toMatch(/disc-when-today"[^>]*aria-current/);
    expect(bar).toContain('value="&lt;b&gt;x&lt;/b&gt;"');
    expect(bar).not.toContain('<b>x</b>');
    expect(bar).toContain('data-testid="disc-clear"');
    expect(bar).toContain('2 matches for');
  });
  test('no Clear on the default view', () => {
    expect(renderDiscoveryFilters({ when: 'all', q: '' }, 5)).not.toContain('disc-clear');
  });
  test('empty copy names the question', () => {
    expect(discoveryEmptyCopy({ when: 'today', q: '' })).toContain('Nothing on today');
    expect(discoveryEmptyCopy({ when: 'all', q: '<x>' })).toContain('&lt;x&gt;');
  });
});

describe('GET /events carries the bar server-side', () => {
  beforeAll(async () => {
    const stmts: string[] = JSON.parse(
      (env as unknown as { TEST_MIGRATION_STATEMENTS: string }).TEST_MIGRATION_STATEMENTS
    );
    for (const stmt of stmts) {
      try {
        await (env as unknown as { DB: D1Database }).DB.prepare(stmt).run();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
        throw e;
      }
    }
  });
  test('default page has the search form and chips, no client fetch for the list', async () => {
    const res = await SELF.fetch('https://t.test/events');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('data-testid="disc-search"');
    expect(html).toContain('data-testid="disc-when-all"');
    expect(html).not.toContain('<!--OCR_EVENT_FILTERS-->');
    expect(html).not.toContain("fetch('/api/v2/events')");
  });
  test('a filtered URL is reflected in the bar and the chips keep q', async () => {
    const res = await SELF.fetch('https://t.test/events?when=weekend&q=trivia');
    const html = await res.text();
    expect(html).toMatch(/disc-when-weekend"[^>]*aria-current="true"/);
    expect(html).toContain('value="trivia"');
    expect(html).toContain('href="/events?when=today&amp;q=trivia"');
  });
  test('hostile q never lands unescaped', async () => {
    const res = await SELF.fetch('https://t.test/events?q=%3Cscript%3Ealert(1)%3C/script%3E');
    const html = await res.text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});
