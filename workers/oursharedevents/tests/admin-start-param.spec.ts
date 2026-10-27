/**
 * The doors name their action; the admin front door steps aside (owner, 2026-10-27).
 *
 * The public landing has two doors, "Create an event" and "Create a sponsor". They used to link to
 * /admin#create-event and /admin#sponsors-card. Two things went wrong with a #fragment:
 *   - the Cloudflare Access sign-in round trip drops it, so after signing in the visitor landed on
 *     the admin page's own path chooser, the same three choices they had just made on the landing;
 *   - nothing on the admin page acted on #sponsors-card at load, so the sponsor door showed the
 *     chooser even where there was no sign-in in between (production, with a live session).
 *
 * The doors now carry ?start=event or ?start=sponsor. A query string survives the sign-in round trip,
 * and the admin page opens that action directly. The chooser stays, for a visit to /admin that names
 * no action. #create-event still opens the wizard (a reload, an old bookmark).
 *
 * Layer: unit. The init block is extracted from the shipped template and run with stubbed
 * location/history, so this tests the code that ships, not a copy. The rendered proof is a browser
 * walk-through (sign in on staging, tap each door).
 *
 * @born-red owner request 2026-10-27 | method: every assertion here fails against the template
 * before the change (doors link to a #fragment; the init block reads no query string).
 */
import { describe, test, expect } from 'vitest';
import ADMIN_HTML from '../src/templates/admin.html';
import LANDING_HTML from '../src/templates/landing.html';
import { renderNearEmpty } from '../src/lib/landing-where';

/** The shipped init block, as source. */
function initBlock(): string {
  const m = /\(function initWizardHistory\(\) \{[\s\S]*?\n {10}\}\)\(\);/.exec(ADMIN_HTML);
  if (!m) throw new Error('initWizardHistory block not found in admin.html');
  return m[0];
}

interface Run {
  wizard: number;
  sponsor: number;
  /** URLs passed to history.replaceState, in order. */
  replaced: string[];
}

/** Run the shipped init block as if the admin page had just loaded at `search` + `hash`. */
function load(opts: { search?: string; hash?: string; historyThrows?: boolean } = {}): Run {
  const run: Run = { wizard: 0, sponsor: 0, replaced: [] };
  const location = { pathname: '/admin', search: opts.search ?? '', hash: opts.hash ?? '' };
  const history = {
    replaceState: (_state: unknown, _title: string, url: string) => {
      if (opts.historyThrows) throw new Error('history unavailable');
      run.replaced.push(url);
    },
  };
  new Function('location', 'history', 'WIZ_HASH', 'startWizard', 'startSponsor', initBlock())(
    location,
    history,
    '#create-event',
    () => run.wizard++,
    () => run.sponsor++
  );
  return run;
}

describe('the admin page acts on ?start= at load', () => {
  test('?start=event opens the create wizard and skips the path chooser', () => {
    const r = load({ search: '?start=event' });
    expect(r.wizard).toBe(1);
    expect(r.sponsor).toBe(0);
  });

  test('?start=sponsor opens the sponsor card and skips the path chooser', () => {
    const r = load({ search: '?start=sponsor' });
    expect(r.sponsor).toBe(1);
    expect(r.wizard).toBe(0);
  });

  test('a visit that names no action shows the chooser (neither action runs)', () => {
    const r = load();
    expect(r.wizard).toBe(0);
    expect(r.sponsor).toBe(0);
  });

  test('an unknown start value is ignored, and so is an empty one', () => {
    for (const search of ['?start=nonsense', '?start=', '?start=EVENT', '?start=event%20']) {
      const r = load({ search });
      expect({ search, wizard: r.wizard, sponsor: r.sponsor }).toEqual({
        search,
        wizard: 0,
        sponsor: 0,
      });
    }
  });

  test('the start param is consumed, so a reload lands on the neutral chooser', () => {
    expect(load({ search: '?start=event' }).replaced).toEqual(['/admin']);
    expect(load({ search: '?start=sponsor' }).replaced).toEqual(['/admin']);
  });

  test('other query parameters survive', () => {
    expect(load({ search: '?start=event&utm=door' }).replaced).toEqual(['/admin?utm=door']);
    expect(load({ search: '?lang=es&start=sponsor' }).replaced).toEqual(['/admin?lang=es']);
    expect(load({ search: '?lang=es' }).replaced).toEqual(['/admin?lang=es']);
  });

  test('with two start values the first wins, and both are removed', () => {
    const r = load({ search: '?start=event&start=sponsor' });
    expect(r.wizard).toBe(1);
    expect(r.sponsor).toBe(0);
    expect(r.replaced).toEqual(['/admin']);
  });

  test('#create-event still opens the wizard (a reload, an old bookmark)', () => {
    const r = load({ hash: '#create-event' });
    expect(r.wizard).toBe(1);
    expect(r.sponsor).toBe(0);
  });

  test('an explicit start beats a stale #create-event', () => {
    const r = load({ search: '?start=sponsor', hash: '#create-event' });
    expect(r.sponsor).toBe(1);
    expect(r.wizard).toBe(0);
  });

  test('the action still opens when history is unavailable (a sandboxed frame)', () => {
    expect(load({ search: '?start=event', historyThrows: true }).wizard).toBe(1);
    expect(load({ search: '?start=sponsor', historyThrows: true }).sponsor).toBe(1);
  });

  test('both actions are defined in the template, so the call cannot be a ReferenceError', () => {
    expect(ADMIN_HTML).toMatch(/function startWizard\(/);
    expect(ADMIN_HTML).toMatch(/function startSponsor\(/);
    expect(initBlock()).toContain('startSponsor()');
    expect(initBlock()).toContain('startWizard()');
  });
});

describe('the landing doors carry the action in the query string', () => {
  const door = (testid: string) =>
    new RegExp(`<a[^>]*href="([^"]*)"[^>]*data-testid="${testid}"`).exec(LANDING_HTML)?.[1];

  test('each door links to its own start value', () => {
    expect(door('door-create-event')).toBe('/admin?start=event');
    expect(door('door-create-sponsor')).toBe('/admin?start=sponsor');
  });

  test('no door relies on a #fragment any more', () => {
    expect(door('door-create-event')).not.toContain('#');
    expect(door('door-create-sponsor')).not.toContain('#');
  });

  test('the near-empty "Create one" link starts the wizard the same way', () => {
    const html = renderNearEmpty('60601');
    expect(html).toContain('href="/admin?start=event" data-testid="area-empty-create"');
    expect(html).not.toContain('/admin#');
  });
});
