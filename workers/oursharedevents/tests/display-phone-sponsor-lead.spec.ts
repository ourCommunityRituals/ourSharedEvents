/**
 * OSE-1991 (owner 2026-11-12): on a phone, the Display page's title and its
 * sponsor lead the screen. The sponsors pay for the platform, so the sponsor
 * block is prominent: its banner full width, its thumbnail and name, its short
 * text, one sponsor at a time. How often each comes up follows its covenant
 * share (tvSide, the server's share-weighted sequence: Premium 7 / Anchor 3 /
 * Local 1, local floor and caps held). The block is the same size for every
 * sponsor at every tier (#25). The side rail, which squeezed the title into a
 * narrow column on a phone, is not drawn there. A TV is unchanged.
 *
 * Layer: the served template, its script run in jsdom with the event list,
 * display config and sponsor bundle answered here. Browser half:
 * tests/playwright/display-phone-sponsor-lead.spec.ts.
 *
 * @born-red OSE-1991 | method: run against the parent commit's template (accb936f:
 * no lead block, side rail drawn on a phone): the four phone tests went red;
 * the tier-blind and TV tests are guards for what must not change and stayed
 * green | date: 2026-11-12
 */
import { describe, test, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import DISPLAY_HTML from '../src/templates/display.html';

const EVT = 'evt_display_1991';
const LEAD_TURN_MS = 6000;

type Sponsor = Record<string, unknown>;
const sponsor = (id: string, name: string, tier: string, extra: Sponsor = {}): Sponsor => ({
  id,
  name,
  title: name,
  tier,
  logo_url: null,
  has_header_image: true,
  header_text: `${name} supports the league.`,
  ...extra,
});
const A = sponsor('spA', 'Lakeside Credit Union', 'platinum');
const B = sponsor('spB', 'Sawyer Hardware', 'gold');
const C = sponsor('spC', 'Corner Bakery', 'bronze', { has_header_image: false, header_text: '' });
// A share-weighted sequence as the server sends it (order is the server's shuffle).
const TV_SIDE = [B, A, A, C, A, B];

async function boot(phone: boolean, tvSide: Sponsor[] = TV_SIDE) {
  const intervals = new Map<number, Array<() => void>>();
  const dom = new JSDOM(DISPLAY_HTML, {
    url: `https://ose.test/events/${EVT}/tv`,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      const win = w as unknown as Record<string, unknown>;
      win.matchMedia = (q: string) => ({
        matches: /max-width/.test(q) ? phone : false,
        addEventListener: () => {},
      });
      // Intervals are parked by period, so a test can run one on demand.
      win.setInterval = (f: () => void, ms: number) => {
        intervals.set(ms, [...(intervals.get(ms) ?? []), f]);
        return 0;
      };
      win.fetch = async (input: string) => {
        const u = String(input);
        const body = u.includes('/sponsor-bundle')
          ? {
              ok: true,
              bundle: {
                sponsors: [A, B, C],
                surface_sponsors: {
                  tvTop: [A, B, C],
                  tvSide,
                  posterTop: [A, B, C],
                  mobileBanner: [A, B, C],
                },
                rotation_config: { sponsorSlots: tvSide.length, rotationMs: 15000 },
              },
            }
          : u.includes('/display-config') || u.includes('/impression')
            ? { ok: false }
            : {
                ok: true,
                items: [
                  {
                    id: EVT,
                    name: 'Harbor County Bocce',
                    venue: 'Harbor Hall',
                    phase: 'pre_event',
                    startDateISO: '2026-11-21',
                    starts_at: '2026-11-21T23:00:00.000Z',
                    timezone: 'America/Chicago',
                  },
                ],
              };
        return new Response(JSON.stringify(body), {
          status: u.includes('/display-config') ? 404 : 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };
    },
  });
  const doc = dom.window.document;
  for (let i = 0; i < 80; i++) {
    if (
      doc.querySelector('[data-testid="display-featured-title"]') &&
      doc.querySelector(
        '[data-testid="display-sponsor-lead"], [data-testid="display-sponsor-banner"]'
      )
    )
      break;
    await new Promise((r) => setTimeout(r, 25));
  }
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  const tick = () => (intervals.get(LEAD_TURN_MS) ?? []).forEach((f) => f());
  return { doc, tick };
}

const blocks = (doc: Document) => [
  ...doc.querySelectorAll<HTMLElement>('[data-testid="display-sponsor-lead-item"]'),
];
const shown = (doc: Document) =>
  blocks(doc)
    .filter((b) => b.style.display !== 'none')
    .map((b) => b.getAttribute('aria-label'));

describe('phone: the title and one sponsor lead the screen', () => {
  test('one sponsor block under the title: banner through the proxy, thumbnail, name, text', async () => {
    const { doc } = await boot(true);
    const lead = doc.querySelector('[data-testid="display-sponsor-lead"]')!;
    expect(lead).not.toBeNull();
    expect(lead.className).toBe('sponsor-panel');
    expect(lead.querySelector('[data-testid="display-sponsor-lead-label"]')!.textContent).toBe(
      'Sponsored by'
    );
    // Below the title and date in the featured screen, as on a TV (PO rule).
    const card = doc.querySelector('[data-testid="display-featured-card"]')!;
    expect(card.compareDocumentPosition(lead) & 4).toBeTruthy();
    expect(blocks(doc)).toHaveLength(3);
    const a = blocks(doc)[0];
    expect(a.className).toBe('sponsor-panel-block');
    expect(
      a.querySelector('[data-testid="display-sponsor-lead-header"]')!.getAttribute('src')
    ).toBe('/api/v2/sponsors/spA/logo?slot=header');
    expect(a.querySelector('[data-testid="display-sponsor-lead-name"]')!.textContent).toBe(
      'Lakeside Credit Union'
    );
    expect(a.querySelector('[data-testid="display-sponsor-lead-text"]')!.textContent).toBe(
      'Lakeside Credit Union supports the league.'
    );
    // A sponsor with no banner and no text shows its thumbnail and name only.
    const c = blocks(doc)[2];
    expect(c.querySelector('[data-testid="display-sponsor-lead-header"]')).toBeNull();
    expect(c.querySelector('[data-testid="display-sponsor-lead-text"]')).toBeNull();
    // The TV strip is not drawn on a phone.
    expect(doc.querySelector('[data-testid="display-sponsor-banner"]')).toBeNull();
  });

  test('one sponsor at a time, in the turns of the share-weighted sequence (tvSide)', async () => {
    const { doc, tick } = await boot(true);
    const seen = [shown(doc)];
    for (let i = 0; i < TV_SIDE.length; i++) {
      tick();
      seen.push(shown(doc));
    }
    // Exactly one block shows at every turn.
    for (const s of seen) expect(s).toHaveLength(1);
    expect(seen.map((s) => s[0])).toEqual([...TV_SIDE, TV_SIDE[0]].map((s) => s.title as string));
  });

  test('the side rail is not drawn on a phone', async () => {
    const { doc } = await boot(true);
    expect(doc.querySelector('[data-testid="display-sponsor-sidebar"]')!.innerHTML).toBe('');
  });

  test('every block is the same element for every tier: no tier mark, no tier class', async () => {
    const { doc } = await boot(true);
    for (const b of blocks(doc)) {
      expect(b.hasAttribute('data-tier')).toBe(false);
      expect(b.className).toBe('sponsor-panel-block');
    }
  });

  test('a sequence naming no sponsor on screen falls back to each sponsor in turn', async () => {
    const { doc, tick } = await boot(true, [sponsor('ghost', 'Ghost', 'gold')]);
    const seen = [shown(doc)[0]];
    tick();
    seen.push(shown(doc)[0]);
    tick();
    seen.push(shown(doc)[0]);
    expect(seen).toEqual(['Lakeside Credit Union', 'Sawyer Hardware', 'Corner Bakery']);
  });
});

describe('TV: unchanged', () => {
  test('the strip shows every sponsor at once, the side rail rotates, no lead block', async () => {
    const { doc } = await boot(false);
    expect(doc.querySelector('[data-testid="display-sponsor-lead"]')).toBeNull();
    expect(doc.querySelectorAll('[data-testid="display-sponsor-item"]')).toHaveLength(3);
    expect(doc.querySelector('[data-testid="display-sponsor-sidebar"]')!.innerHTML).not.toBe('');
  });
});
