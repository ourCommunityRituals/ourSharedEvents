/**
 * Every page address is behind a per-caller limit, or is on a written list with
 * a reason (OSE-1986).
 *
 * Workers pool, through the real router. The addresses are not kept here: they
 * come from `tests/helpers/page-surfaces.ts`, which
 * `page-surfaces-route-table.spec.ts` holds equal to the route table. So a page
 * added to the router is asked for here without anyone remembering to add it.
 *
 * HOW IT TELLS. Each address is asked for once from an address nobody else has
 * used. A limited route counts that caller, and the count is one new entry in
 * the limiter's store. No new entry: the route did not count the caller.
 *
 * Both directions fail:
 *   - an address that is not limited and not on the list (`UNLIMITED_PAGES`);
 *   - an address on the list that IS limited, so the list cannot go stale.
 *
 * Not covered: addresses under /api/ (their limit shows at each call site in
 * the router; no sample table exists for them yet) and admin pages, which the
 * admin guard answers before any page is built.
 */
// @born-red an unlimited page is caught | method: the publicPageLimited wrapper removed from the `/` block in router.ts; "/ is limited, or listed with a reason" failed for `/` and its five aliases | date: 2026-11-16
// @born-red a stale list entry is caught | method: with '/about' added to UNLIMITED_PAGES while the router limits it, "/about is limited, or listed with a reason" failed ("listed as unlimited, but the router limits it") | date: 2026-11-16
// @born-red a gap needs a ticket | method: the `gap` field blanked on '/health'; "every listed address says why, and a gap names its ticket" failed | date: 2026-11-16
// @born-red the probe can tell | method: `counted` made blind (it never reports a count); "the probe sees a limited and an unlimited address" failed, with every limited address below it | date: 2026-11-16
import { env, SELF } from 'cloudflare:test';
import { describe, test, expect } from 'vitest';
import { PAGE_SURFACES, LANGUAGE_PREFIX_SAMPLES } from './helpers/page-surfaces';
import { PREFIX_SAMPLE_LIMITED, UNLIMITED_PAGES } from './helpers/unlimited-pages';

const store = (): KVNamespace => (env as unknown as { RATE_LIMIT_KV: KVNamespace }).RATE_LIMIT_KV;

async function entries(): Promise<number> {
  let total = 0;
  let cursor: string | undefined;
  do {
    const page = await store().list({ limit: 1000, cursor });
    total += page.keys.length;
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return total;
}

let caller = 0;
/** Did the router count this caller for this address? */
async function counted(path: string): Promise<boolean> {
  caller += 1;
  const ip = `198.51.${100 + Math.floor(caller / 250)}.${(caller % 250) + 1}`;
  const before = await entries();
  const res = await SELF.fetch(`https://t.test${path}`, {
    redirect: 'manual',
    headers: { Accept: 'text/html', 'CF-Connecting-IP': ip },
  });
  await res.arrayBuffer();
  return (await entries()) > before;
}

describe('OSE-1986 | the probe', () => {
  test('the probe sees a limited and an unlimited address', async () => {
    // /sitemap.xml has been behind publicReadLimited since OSE-1247; /ui.css is
    // a file. If the probe cannot tell these apart, nothing below means anything.
    expect(await counted('/sitemap.xml')).toBe(true);
    expect(await counted('/ui.css')).toBe(false);
  });
});

describe('OSE-1986 | every page address is limited, or listed with a reason', () => {
  const pages = Object.entries(PAGE_SURFACES).filter(([, s]) => !s.admin);

  test('the page list is not empty, and the landing is on it', () => {
    expect(pages.length).toBeGreaterThan(40);
    expect(PAGE_SURFACES['/']).toBeDefined();
    expect(PAGE_SURFACES['/events']).toBeDefined();
  });

  for (const [shape, surface] of pages) {
    test(`${shape} is limited, or listed with a reason`, async () => {
      const listed = UNLIMITED_PAGES[shape];
      for (const sample of surface.samples) {
        const limited = await counted(sample);
        if (listed) {
          expect(
            limited,
            `${sample} (${shape}) is listed as unlimited, but the router limits it: remove it from UNLIMITED_PAGES`
          ).toBe(false);
        } else {
          expect(
            limited,
            `${sample} (${shape}) has no per-caller limit and is not in UNLIMITED_PAGES: wrap it (publicPageLimited) or list it with a reason`
          ).toBe(true);
        }
      }
    });
  }

  for (const sample of LANGUAGE_PREFIX_SAMPLES) {
    test(`${sample} (language prefix) is limited, or listed with a reason`, async () => {
      const decided = PREFIX_SAMPLE_LIMITED[sample];
      expect(decided, `${sample} is not decided in PREFIX_SAMPLE_LIMITED`).toBeDefined();
      expect(await counted(sample), sample).toBe(decided === true);
    });
  }

  test('the landing and the event list are not on the unlimited list', () => {
    for (const shape of ['/', '/home', '/welcome', '/landing', '/about', '/info', '/events']) {
      expect(UNLIMITED_PAGES[shape], shape).toBeUndefined();
    }
  });
});

describe('OSE-1986 | the written list', () => {
  test('every listed address is an address the router answers', () => {
    const unknown = Object.keys(UNLIMITED_PAGES).filter((shape) => !(shape in PAGE_SURFACES));
    expect(unknown, `not in PAGE_SURFACES: ${unknown.join(', ')}`).toEqual([]);
  });

  test('no admin page is on it: the admin guard is their control', () => {
    const admin = Object.keys(UNLIMITED_PAGES).filter((shape) => PAGE_SURFACES[shape]?.admin);
    expect(admin).toEqual([]);
  });

  test('every listed address says why, and a gap names its ticket', () => {
    const all = [
      ...Object.entries(UNLIMITED_PAGES),
      ...Object.entries(PREFIX_SAMPLE_LIMITED).filter(
        (e): e is [string, { why: string; gap?: string }] => typeof e[1] === 'object'
      ),
    ];
    for (const [shape, entry] of all) {
      expect(entry.why.trim().length, `${shape}: why`).toBeGreaterThan(20);
      if (/no per-caller limit today/.test(entry.why)) {
        expect(entry.gap ?? '', `${shape}: a gap names its ticket`).toMatch(/^OSE-\d+$/);
      } else {
        expect(entry.gap, `${shape}: not a gap, so no ticket`).toBeUndefined();
      }
    }
  });
});
