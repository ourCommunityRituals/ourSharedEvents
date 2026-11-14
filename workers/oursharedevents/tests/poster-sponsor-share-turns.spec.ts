/**
 * OSE-1991 (owner 2026-11-12): the digital poster shows one sponsor at a time,
 * and how often each comes up follows its covenant share. The poster bundle
 * carries `sponsor_rotation`, the server's share-weighted sequence of sponsor
 * ids (Premium 7 / Anchor 3 / Local 1, the local floor and the caps held: the
 * same sequence the TV side rail plays); the page walks it. Size never changes
 * with the share (#25: money buys frequency, never size). Print shows every
 * sponsor at once and does not rotate.
 *
 * Layer: the served template, its script run in jsdom with the poster bundle
 * answered here. API half: poster-sponsor-rotation-share.spec.ts (workers pool).
 *
 * @born-red OSE-1991 | method: run against the parent commit's template (accb936f:
 * each sponsor in turn, sponsor_rotation ignored): the turns and rotation tests
 * went red; the same-element and print tests are guards for what must not
 * change and stayed green | date: 2026-11-12
 */
import { describe, test, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import POSTER_HTML from '../src/templates/poster.html';

const EVT = 'evt_turns_1991';
const ROTATE_MS = 5000;

type Sponsor = Record<string, unknown>;
const sp = (id: string, name: string, tier: string): Sponsor => ({ id, name, title: name, tier });
const A = sp('spA', 'Lakeside Credit Union', 'platinum');
const B = sp('spB', 'Sawyer Hardware', 'gold');
const C = sp('spC', 'Corner Bakery', 'bronze');

function body(sponsors: Sponsor[], rotation?: unknown) {
  return {
    ok: true,
    status: 200,
    eventId: EVT,
    event: {
      id: EVT,
      name: 'Harbor County Bocce',
      venue: 'Harbor Hall',
      startDateISO: '2026-11-21',
    },
    sponsors,
    ...(rotation === undefined ? {} : { sponsor_rotation: rotation }),
    slots: [],
    settings: { showQRSection: true },
  };
}

async function open(kind: 'digital' | 'print', b: Record<string, unknown>) {
  const intervals = new Map<number, Array<() => void>>();
  const dom = new JSDOM(POSTER_HTML, {
    url: `https://ose.test/events/${EVT}/poster?kind=${kind}`,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      const win = w as unknown as Record<string, unknown>;
      win.fetch = async (input: string) =>
        new Response(JSON.stringify(String(input).includes('/poster-bundle') ? b : { ok: false }), {
          status: String(input).includes('/poster-bundle') ? 200 : 404,
          headers: { 'Content-Type': 'application/json' },
        });
      // Reduced motion: a plain swap, no entrance, no scene.
      win.matchMedia = () => ({ matches: true });
      win.setInterval = (f: () => void, ms: number) => {
        intervals.set(ms, [...(intervals.get(ms) ?? []), f]);
        return 1;
      };
      win.clearInterval = () => {};
    },
  });
  const doc = dom.window.document;
  for (let i = 0; i < 80; i++) {
    const strip = doc.querySelector('[data-testid="poster-sponsor-strip"]');
    if (strip && strip.getAttribute('aria-busy') === 'false') break;
    await new Promise((r) => setTimeout(r, 25));
  }
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  const tick = () => (intervals.get(ROTATE_MS) ?? []).forEach((f) => f());
  return { doc, win: dom.window as unknown as Record<string, unknown>, tick };
}

const shown = (doc: Document) =>
  [...doc.querySelectorAll<HTMLElement>('[data-testid="poster-sponsor-item"]')]
    .filter((el) => el.style.display !== 'none')
    .map((el) => el.getAttribute('aria-label'));

describe('posterSponsorTurns: the share-weighted sequence as indexes into the drawn list', () => {
  test('follows the ids, one entry per turn; ids not on the poster are skipped', async () => {
    const { win } = await open('digital', body([A, B, C], []));
    const turns = win.posterSponsorTurns as (s: unknown, r: unknown) => number[];
    expect(turns([A, B, C], ['spB', 'spA', 'spA', 'ghost', 'spC'])).toEqual([1, 0, 0, 2]);
  });

  test('no usable sequence: each sponsor once, in the order drawn', async () => {
    const { win } = await open('digital', body([A, B, C], []));
    const turns = win.posterSponsorTurns as (s: unknown, r: unknown) => number[];
    expect(turns([A, B, C], undefined)).toEqual([0, 1, 2]);
    expect(turns([A, B, C], ['ghost'])).toEqual([0, 1, 2]);
    expect(turns([A, B, C], 'spA')).toEqual([0, 1, 2]);
    expect(turns([], ['spA'])).toEqual([]);
  });
});

describe('digital: one sponsor at a time, in the bundle’s turns', () => {
  test('a bigger share comes up more often', async () => {
    const rotation = ['spB', 'spA', 'spC', 'spA', 'spA', 'spB'];
    const { doc, tick } = await open('digital', body([A, B, C], rotation));
    const seen = [shown(doc)];
    for (let i = 0; i < rotation.length; i++) {
      tick();
      seen.push(shown(doc));
    }
    for (const s of seen) expect(s).toHaveLength(1);
    const names = { spA: A.title, spB: B.title, spC: C.title } as Record<string, unknown>;
    expect(seen.map((s) => s[0])).toEqual([...rotation, rotation[0]].map((id) => names[id]));
  });

  test('the same sponsor twice running keeps its place (no entrance replayed)', async () => {
    const { doc, tick } = await open('digital', body([A, B], ['spA', 'spA', 'spB']));
    const first = doc.querySelector<HTMLElement>('[data-testid="poster-sponsor-item"]')!;
    const effect = first.getAttribute('data-effect');
    first.setAttribute('data-effect', 'marker');
    tick();
    expect(shown(doc)).toEqual([A.title]);
    expect(first.getAttribute('data-effect')).toBe('marker');
    tick();
    expect(shown(doc)).toEqual([B.title]);
    expect(effect).toBe('rise');
  });

  test('every sponsor block is the same element whatever its share', async () => {
    const { doc } = await open('digital', body([A, B, C], ['spA', 'spA', 'spA', 'spB', 'spC']));
    for (const el of doc.querySelectorAll('[data-testid="poster-sponsor-item"]')) {
      expect(el.className).toBe('sponsor-panel-block');
    }
  });
});

describe('print: every sponsor at once, no rotation', () => {
  test('the sequence is ignored on paper', async () => {
    const { doc, tick } = await open('print', body([A, B, C], ['spA', 'spA', 'spB']));
    tick();
    expect(shown(doc)).toEqual([A.title, B.title, C.title]);
  });
});
