/**
 * The Return Rate card on the SharedReport page, when the rate is withheld.
 *
 * The API now withholds `return_rate.venue_pct` on its own (too few people
 * returned, or too few did not) while the section and its sample size are
 * published. The page must cope: a dash, and the one-line reason, never a bare
 * dash and never "null" or "NaN".
 *
 * Runs the real /sharedReport page (shared-report.html Text import) in jsdom in
 * signed-link mode, with a stubbed fetch.
 *
 * @born-red | method: "the rate alone is withheld" failed on the template
 *   before it looked up `return_rate.venue_pct` (the card showed a dash with no
 *   reason) | date: 2026-10-07
 */

import { describe, test, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import REPORT_HTML from '../src/templates/shared-report.html';

interface Reason {
  field: string;
  reason: string;
  detail?: string;
}

async function card(
  returnRate: unknown,
  reasons: Reason[]
): Promise<{ text: string; value: string; notes: Array<{ field: string | null; text: string }> }> {
  const dom = new JSDOM(REPORT_HTML, {
    url: 'https://ose.test/sharedReport?eventId=evt_1&token=t0ken',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      (w as unknown as { fetch: unknown }).fetch = async (url: string) => {
        const json = (status: number, body: unknown) =>
          new Response(JSON.stringify(body), {
            status,
            headers: { 'Content-Type': 'application/json' },
          });
        if (String(url).includes('/shared-report')) {
          return json(200, {
            ok: true,
            report: {
              event_id: 'evt_1',
              event_title: 'Bocce Night',
              event_start_date: '2026-09-26T23:00:00Z',
              unique_gatherings: 84,
              return_rate: returnRate,
              _meta: { materialized_at: null, suppression_reasons: reasons },
            },
          });
        }
        return json(401, { ok: false });
      };
    },
  });
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 40));
  const el = dom.window.document.querySelector('[data-testid="signed-link-return-rate"]');
  expect(el, 'the Return Rate card rendered').not.toBeNull();
  return {
    text: el!.textContent ?? '',
    value: el!.querySelector('dd')?.textContent ?? '',
    notes: [...el!.querySelectorAll('[data-testid="report-suppression-note"]')].map((n) => ({
      field: n.getAttribute('data-field'),
      text: n.textContent ?? '',
    })),
  };
}

const HIDDEN = 'Hidden to keep things anonymous — not enough data yet.';

describe('SharedReport page: the Return Rate card', () => {
  test('a published rate shows as a percentage, with no note', async () => {
    const c = await card({ venue_pct: 31.4, corridor_pct: 50, sample_size: 84 }, []);
    expect(c.value).toBe('31.4%');
    expect(c.notes).toEqual([]);
  });

  test('the whole section is withheld (too few people): a dash and the reason', async () => {
    const c = await card({ venue_pct: null, corridor_pct: null, sample_size: null }, [
      { field: 'return_rate', reason: 'below_min_sample_size' },
    ]);
    expect(c.value).toBe('—');
    expect(c.notes).toEqual([{ field: 'return_rate', text: HIDDEN }]);
  });

  test('the rate alone is withheld (sample published): a dash and the reason, not a bare dash', async () => {
    const c = await card({ venue_pct: null, corridor_pct: null, sample_size: 20 }, [
      {
        field: 'return_rate.venue_pct',
        reason: 'below_min_sample_size',
        detail: 'one side of this rate is a group of fewer than 5 people',
      },
      { field: 'return_rate.corridor_pct', reason: 'below_min_sample_size' },
    ]);
    expect(c.value).toBe('—');
    expect(c.notes).toEqual([{ field: 'return_rate.venue_pct', text: HIDDEN }]);
  });

  test('the note never repeats: section and rate both withheld shows one line', async () => {
    const c = await card({ venue_pct: null, corridor_pct: null, sample_size: null }, [
      { field: 'return_rate', reason: 'below_min_sample_size' },
      { field: 'return_rate.venue_pct', reason: 'below_min_sample_size' },
    ]);
    expect(c.notes).toHaveLength(1);
  });

  test.each([
    ['a null rate with no reason', { venue_pct: null, corridor_pct: null, sample_size: 20 }],
    ['a missing rate', { sample_size: 20 }],
    ['no return_rate at all (a local sponsor link)', undefined],
  ])('%s is a dash, never "null", "undefined" or "NaN"', async (_name, returnRate) => {
    const c = await card(returnRate, []);
    expect(c.value).toBe('—');
    expect(c.text).not.toMatch(/null|undefined|NaN/);
  });

  test('the withheld detail from the API is never printed on the page', async () => {
    const c = await card({ venue_pct: null, corridor_pct: null, sample_size: 20 }, [
      {
        field: 'return_rate.venue_pct',
        reason: 'below_min_sample_size',
        detail: 'one side of this rate is a group of fewer than 5 people',
      },
    ]);
    expect(c.text).not.toContain('one side of this rate');
  });
});
