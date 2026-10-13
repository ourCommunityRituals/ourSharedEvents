/**
 * OSE-1441 — the unscoped /poster picker paints only the event that is chosen.
 *
 * Switching A → B quickly sends two poster-bundle requests. If A's answer comes
 * back last, it must not paint A's codes and sponsors onto B's card (a printed
 * poster would carry the wrong event's codes), and it must not open the Print
 * gate (OSE-286) while B is still loading. The page script runs in jsdom over
 * the served template, with a fetch stub whose A answer is held back.
 *
 * @born-red OSE-1441 | method: spec written before the change and run against
 *   the base branch (no request token in loadPosterBundle) — red; green after
 *   | date: 2026-10-09
 */

import { describe, test, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import POSTER_HTML from '../src/templates/poster.html';

const QR = 'data:image/png;base64,iVBORw0KGgo=';
const A = { id: 'evt_a_1441', name: 'Alpha Trivia Night', venue: 'Alpha Hall' };
const B = { id: 'evt_b_1441', name: 'Beta Bocce League', venue: 'Beta Park' };

const slot = (kind: string, word: string, code: string) => ({
  kind,
  word,
  label: word,
  code,
  url: `https://ose.test/s/${code}`,
  qr: QR,
});
const BUNDLES: Record<string, unknown> = {
  [A.id]: {
    ok: true,
    status: 200,
    event: A,
    sponsors: [{ id: 'sp_a', name: 'Alpha Hardware', tier: 'primary' }],
    slots: [slot('public', 'EVENT', 'AaPub1'), slot('donation', 'DONATE', 'AaDon1')],
  },
  [B.id]: {
    ok: true,
    status: 200,
    event: B,
    sponsors: [{ id: 'sp_b', name: 'Beta Bakery', tier: 'primary' }],
    slots: [slot('public', 'EVENT', 'BbPub1')],
  },
};

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

function posterBody(html: string): string {
  const doc = new JSDOM(html).window.document;
  doc.querySelectorAll('script').forEach((s) => s.remove());
  return doc.body.innerHTML;
}
function posterScript(html: string): string {
  const doc = new JSDOM(html).window.document;
  const el = Array.from(doc.querySelectorAll('script')).find((s) =>
    (s.textContent || '').includes('async function loadPosterBundle')
  );
  expect(el).toBeDefined();
  return el!.textContent || '';
}

// Mount the picker (no ?event=). Bundles for ids in `held` wait until released.
async function mountPicker(held: string[]) {
  const dom = new JSDOM(`<!doctype html><body>${posterBody(POSTER_HTML)}</body>`, {
    runScripts: 'outside-only',
    url: 'https://ose.test/poster',
  });
  const w = dom.window as unknown as Window &
    Record<string, unknown> & { eval(s: string): unknown };
  const releases: Record<string, () => void> = {};
  w.fetch = (async (url: string) => {
    const reply = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    if (url === '/api/v2/events') return reply({ ok: true, items: [A, B] });
    const id = Object.keys(BUNDLES).find((k) => url === `/api/v2/events/${k}/poster-bundle`);
    if (!id) return { ok: false, status: 404, json: async () => ({ ok: false }) };
    if (held.includes(id)) {
      await new Promise<void>((r) => (releases[id] = r));
    }
    return reply(BUNDLES[id]);
  }) as unknown as typeof fetch;
  w.eval(posterScript(POSTER_HTML));
  await flush();
  const doc = w.document;
  const pick = async (index: number) => {
    const picker = doc.getElementById('event-picker') as HTMLSelectElement;
    picker.value = String(index);
    picker.dispatchEvent(new w.Event('change'));
    await flush();
  };
  const release = async (id: string) => {
    releases[id]!();
    await flush();
  };
  // JSDOM never loads images; settle them the way a browser would.
  const settleImages = async () => {
    doc
      .querySelectorAll('.qr-img, [data-testid="poster-sponsor-logo"]')
      .forEach((img) => img.dispatchEvent(new w.Event('load')));
    await flush();
  };
  const codes = () =>
    Array.from(doc.querySelectorAll('#poster-qr-slots [data-testid^="qr-slot-code-"]')).map(
      (el) => el.textContent
    );
  const sponsors = () =>
    Array.from(doc.querySelectorAll('[data-testid="poster-sponsor-name"]')).map(
      (el) => el.textContent
    );
  const printDisabled = () =>
    (doc.querySelector('[data-testid="poster-print"]') as HTMLButtonElement).disabled;
  return { doc, pick, release, settleImages, codes, sponsors, printDisabled };
}

describe('/poster picker | OSE-1441 a late answer for the previous event is dropped', () => {
  test('A delayed, B resolved, then A released: only B is on the poster', async () => {
    const p = await mountPicker([A.id]);
    // A is selected first and its bundle is still out.
    expect(p.doc.querySelector('[data-testid="poster-title"]')!.textContent).toBe(A.name);
    await p.pick(1);
    expect(p.doc.querySelector('[data-testid="poster-title"]')!.textContent).toBe(B.name);
    expect(p.codes()).toEqual(['https://ose.test/s/BbPub1']);
    expect(p.sponsors()).toEqual(['Beta Bakery']);

    await p.release(A.id);
    await p.settleImages();

    expect(p.doc.querySelector('[data-testid="poster-title"]')!.textContent).toBe(B.name);
    expect(p.codes()).toEqual(['https://ose.test/s/BbPub1']);
    expect(p.sponsors()).toEqual(['Beta Bakery']);
    expect(p.doc.body.innerHTML).not.toContain('AaPub1');
    expect(p.doc.body.innerHTML).not.toContain('AaDon1');
    expect(p.doc.body.innerHTML).not.toContain('Alpha Hardware');
    // B's codes have settled, so Print is ready for B.
    expect(p.printDisabled()).toBe(false);
  });

  test('A released while B is still loading: nothing of A is painted and Print stays shut', async () => {
    const p = await mountPicker([A.id, B.id]);
    await p.pick(1);
    // The switch cleared the poster before any answer came back.
    expect(p.codes()).toEqual([]);
    expect(p.doc.querySelectorAll('#poster-qr-slots .qr-loading')).toHaveLength(1);
    expect(p.sponsors()).toEqual([]);

    await p.release(A.id);
    await p.settleImages();
    expect(p.codes()).toEqual([]);
    expect(p.sponsors()).toEqual([]);
    expect(p.doc.querySelectorAll('#poster-qr-slots .qr-loading')).toHaveLength(1);
    // A's answer must not open the print gate for B's empty poster.
    expect(p.printDisabled()).toBe(true);

    await p.release(B.id);
    await p.settleImages();
    expect(p.codes()).toEqual(['https://ose.test/s/BbPub1']);
    expect(p.sponsors()).toEqual(['Beta Bakery']);
    expect(p.printDisabled()).toBe(false);
  });

  test('switching back to a poster that already loaded shows its own codes again', async () => {
    const p = await mountPicker([]);
    expect(p.codes()).toEqual(['https://ose.test/s/AaPub1', 'https://ose.test/s/AaDon1']);
    await p.pick(1);
    expect(p.codes()).toEqual(['https://ose.test/s/BbPub1']);
    await p.pick(0);
    await p.settleImages();
    expect(p.codes()).toEqual(['https://ose.test/s/AaPub1', 'https://ose.test/s/AaDon1']);
    expect(p.sponsors()).toEqual(['Alpha Hardware']);
    expect(p.printDisabled()).toBe(false);
  });
});
