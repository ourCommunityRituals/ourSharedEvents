/**
 * OSE-1243 — /events is server-rendered.
 *
 * This is the regression gate for the change, and it asserts the ABSENCE of
 * the old shape as well as the presence of the new one. Both halves matter: a
 * later edit that reintroduced a client fetch would still render cards on a
 * real browser and would pass any test that only looked for cards.
 *
 * It calls the handler with an empty env on purpose. The DataProvider falls
 * through to its fixture there, which is the populated state — so a single
 * response exercises the marker substitution, the count, and the card markup.
 */
import { describe, test, expect } from 'vitest';
import { handlePublicPage } from '../src/handlers/pages';

async function served(): Promise<string> {
  return (await handlePublicPage({} as never)).text();
}

describe('OSE-1243 | the served HTML is the truth', () => {
  test('the events are in the response, not fetched after it', async () => {
    const html = await served();
    expect(html).toContain('data-testid="public-event-card"');
    expect(html).toContain('data-testid="public-event-cta"');
  });

  // ─── The one that caught the bug ───────────────────────────────────────────
  //
  // The first cut of OSE-1243 read `dp.listEvents()` and rendered the rows
  // straight, skipping `enrichWithPhase`. Every testid was present, the card
  // markup was well-formed, the count said "1 upcoming event", and every
  // assertion above passed — while the card itself said nothing at all,
  // because the raw D1 row calls it `title` and the renderer reads `name`.
  //
  // Asserting that an element EXISTS is not the same as asserting it SAYS
  // something. These two are the difference.
  test('the card carries a real name, not an empty element', async () => {
    const name = (await served()).match(/<h3 data-testid="public-event-name">([\s\S]*?)<\/h3>/);
    expect(name?.[1]?.trim()).toBeTruthy();
  });

  test('the card carries real meta — a date, a venue, or both', async () => {
    const meta = (await served()).match(/data-testid="public-event-meta">([\s\S]*?)<\/p>/);
    expect(meta?.[1]?.trim()).toBeTruthy();
  });

  test('the card carries a resolved phase, so the CTA is the right one', async () => {
    // With no phase the card silently defaults to the Register CTA, which is
    // wrong for an event that already happened.
    const html = await served();
    expect(html).toMatch(/data-phase="(pre_event|event|post_event)"/);
    expect(html).not.toContain('data-phase=""');
  });

  test('the sr-only count is populated server-side', async () => {
    expect(await served()).toMatch(/data-testid="public-events-count"[^>]*>\d+ upcoming event/);
  });

  test('no injection marker survives into the response', async () => {
    const html = await served();
    expect(html).not.toContain('OCR_EVENT_LIST');
    expect(html).not.toContain('OCR_EVENT_COUNT');
  });

  test('the loading state is gone, because nothing loads after the response', async () => {
    expect(await served()).not.toContain('public-loading');
  });

  test('the page does not fetch its own list', async () => {
    // The sponsor banner still fetches (/sponsor-bundle) and is expected to.
    // What must not come back is the LIST fetch.
    expect(await served()).not.toContain("fetch('/api/v2/events')");
  });
});
