/**
 * /events — tapping ANYWHERE on a card's name/date opens the event's page, and
 * Back returns to the same filtered list.
 *
 * Dogfooding (2026-09-29, stg /events?when=next-month): tapping the event info
 * did nothing. The card is a stretched link (`.event-card-link`, absolute,
 * inset 0, z-index 1) with the info block layered ABOVE it (z-index 2) so the
 * text sits over the hit area — which meant the text swallowed the tap. Only
 * the card's padding and the Register button worked.
 *
 * Fix: the info block lets pointer events fall through to the link beneath
 * (`pointer-events: none`); the CTA (z-index 3) stays its own target. Back needs
 * no code: the filter lives in the URL (`?when=`), and the card is a plain
 * same-tab link, so history returns to the exact list.
 *
 * Layer: API (the served /events HTML). The tap itself was verified in a
 * browser with elementFromPoint on the card title → the card link.
 *
 * @born-red card tap | method: the pointer-events assertion fails against the
 * pre-fix stylesheet | date: 2026-09-29
 */
import { describe, test, expect } from 'vitest';
import { SELF } from 'cloudflare:test';
import { renderEventList } from '../src/lib/event-list';

function rule(css: string, selector: string): string {
  const i = css.indexOf(`${selector} {`);
  expect(i, selector).toBeGreaterThan(-1);
  return css.slice(i, css.indexOf('}', i));
}

describe('/events cards: the whole card opens the event page', () => {
  test('the info block never swallows a tap (falls through to the card link)', async () => {
    const html = await (await SELF.fetch('https://t.test/events?when=next-month')).text();
    expect(rule(html, '.event-card .event-info')).toMatch(/pointer-events:\s*none/);
    // The stretched link is the hit area; the CTA stays above everything.
    expect(rule(html, '.event-card-link')).toMatch(/inset:\s*0/);
    expect(rule(html, '.event-card .cta')).toMatch(/z-index:\s*3/);
  });

  test('the card link is a plain same-tab link to the event page (so Back returns to the list)', () => {
    const { html } = renderEventList([
      {
        id: 'evt_1',
        name: 'Bocce Night',
        startDateISO: '2026-10-24',
        venue: 'Hall',
        phase: 'pre_event',
      },
    ] as never);
    const link = html.match(/<a class="event-card-link"[^>]*>/)?.[0] ?? '';
    expect(link).toContain('href="/events/evt_1"');
    expect(link).not.toContain('target=');
  });
});
