/**
 * OSE-310 Phase 1 — Poster Family foundation regression guard.
 *
 * Locks the architectural contract so future format-specific work
 * (DESIGN-7 tent4x6 + any future stickers/coasters/etc.) lands as
 * additive registry entries, not architectural lifts.
 *
 * Six preconditions asserted:
 *   1. Registry exists at `src/lib/poster-products.ts` and exports
 *      POSTER_PRODUCTS array with at least the `letter` entry
 *   2. Every path registered to `handlePosterPage` in router.ts has
 *      a corresponding entry in the POSTER_PRODUCTS registry (router
 *      and registry stay in sync — adding a new alias to one without
 *      the other is the drift class this catches)
 *   3. `posterProductForPath()` returns the expected format for each
 *      registered path
 *   4. `/poster` (default path) returns 200 with text/html AND
 *      `<body data-poster-format="letter">` — backwards compatible
 *      with the pre-OSE-310 response, plus the new attribute
 *   5. `/tabletop` (DESIGN-7 alias) returns 200 with
 *      `data-poster-format="tent4x6"` — proves the path-aliased
 *      lookup works even though tent4x6 has no @page CSS yet
 *   6. Phase 1 invariant: only `letter` carries `hasOwnPrintCss: true`
 *      (the other entries are registry slots awaiting their @page
 *      CSS in follow-on stories — this assertion prevents a Phase 1
 *      PR from silently shipping Phase 2 work without ceremony)
 *
 * Per OCR_STANDARD_perStoryTestPyramid:
 *   `OSE-310 | API | GET <path> (<condition>) | <assertion>`.
 */

import { describe, test, expect } from 'vitest';
import { SELF } from 'cloudflare:test';
import {
  POSTER_PRODUCTS,
  DEFAULT_POSTER_CODE,
  posterProductForPath,
  allPosterPaths,
} from '../src/lib/poster-products';

async function fetchPoster(path: string): Promise<{ status: number; html: string }> {
  const res = await SELF.fetch(`https://test.local${path}`);
  return { status: res.status, html: await res.text() };
}

describe('OSE-310 Phase 1 poster family foundation — regression guard', () => {
  test('OSE-310 | API | static | registry contains letter as the canonical default', () => {
    const letter = POSTER_PRODUCTS.find((p) => p.code === DEFAULT_POSTER_CODE);
    expect(letter, 'registry missing letter entry').toBeDefined();
    expect(letter!.paths).toContain('/poster');
    expect(letter!.hasOwnPrintCss).toBe(true);
    expect(letter!.pageWidthIn).toBe(8.5);
    expect(letter!.pageHeightIn).toBe(11);
  });

  test('OSE-310 | API | static | registry covers every path the router fans into handlePosterPage', () => {
    // The router (workers/oursharedevents/src/router.ts) fans these
    // paths into handlePosterPage. Every one of them MUST be
    // registered in POSTER_PRODUCTS so the data-poster-format
    // attribute can be derived deterministically.
    const routerPaths = ['/poster', '/posters', '/flyers', '/tabletop', '/tent', '/signage'];
    const registered = allPosterPaths();
    for (const p of routerPaths) {
      expect(registered, `router path ${p} not in POSTER_PRODUCTS registry`).toContain(p);
    }
  });

  test('OSE-310 | API | static | posterProductForPath returns expected format for each registered path', () => {
    expect(posterProductForPath('/poster').code).toBe('letter');
    expect(posterProductForPath('/posters').code).toBe('letter');
    expect(posterProductForPath('/tabletop').code).toBe('tent4x6');
    expect(posterProductForPath('/tent').code).toBe('tent4x6');
    expect(posterProductForPath('/flyers').code).toBe('flyer');
    expect(posterProductForPath('/signage').code).toBe('signage');
    // Unknown path falls back to letter.
    expect(posterProductForPath('/some-unknown-path').code).toBe('letter');
  });

  test('OSE-310 | API | GET /poster (any) | returns 200 + data-poster-format="letter" attribute on body (backwards compatible)', async () => {
    const { status, html } = await fetchPoster('/poster');
    expect(status).toBe(200);
    expect(html).toMatch(/<body[^>]*data-poster-format="letter"/);
    // Backwards-compat marker: the existing poster preview testids
    // are still present (this PR is foundation-only, no UI change).
    expect(html).toContain('data-testid="poster-event-picker"');
    expect(html).toContain('data-testid="poster-area"');
  });

  test('OSE-310 | API | GET /tabletop (DESIGN-7 alias) | returns 200 + data-poster-format="tent4x6" attribute', async () => {
    const { status, html } = await fetchPoster('/tabletop');
    expect(status).toBe(200);
    expect(html).toMatch(/<body[^>]*data-poster-format="tent4x6"/);
    // Phase 1: tent4x6 renders the letter HTML layout (no own CSS
    // yet). The data-attribute is what proves the registry is wired
    // — Phase 2 (DESIGN-7) will add the @page block targeting it.
  });

  test('OSE-310 | API | GET /flyers + /signage | each renders with its own data-poster-format code', async () => {
    const flyers = await fetchPoster('/flyers');
    expect(flyers.status).toBe(200);
    expect(flyers.html).toMatch(/<body[^>]*data-poster-format="flyer"/);

    const signage = await fetchPoster('/signage');
    expect(signage.status).toBe(200);
    expect(signage.html).toMatch(/<body[^>]*data-poster-format="signage"/);
  });

  test('OSE-310 | API | static | Phase 1 invariant — only letter has hasOwnPrintCss true', () => {
    // This assertion is a deliberate Phase 1 lock: any other format
    // gaining hasOwnPrintCss = true means a Phase 2+ visual change
    // has shipped. That should land in its own discipline-owned PR
    // (e.g., DESIGN-7 for tent4x6) — NOT silently inside a Phase 1
    // foundation PR. When DESIGN-7 ships, update this assertion to
    // include tent4x6, with the OCR-42-style "promoted via OSE-3xx
    // on YYYY-MM-DD" comment.
    const formatsWithOwnCss = POSTER_PRODUCTS.filter((p) => p.hasOwnPrintCss).map((p) => p.code);
    expect(formatsWithOwnCss).toEqual(['letter']);
  });
});
