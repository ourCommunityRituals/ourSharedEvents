/**
 * Every page the worker serves has exactly one <h1> (AGENTS.md invariant 8;
 * OSE-2030, OSE ADR-028).
 *
 * The pages are not a list kept in this file. They come from
 * `tests/helpers/page-surfaces.ts`, which `page-surfaces-route-table.spec.ts`
 * holds equal to the route table, so a page added to the router is asked for
 * here without anyone remembering to add it.
 *
 * For each sample address the real router answers:
 *   - declared a page: the answer is an HTML document with exactly one <h1>;
 *   - declared not a page: the answer is not HTML. A page cannot hide there.
 *
 * One page, the briefing, draws its heading with a script; the served markup
 * has none, so it is checked in a browser (tests/playwright/a11y-profile.spec.ts)
 * and this spec holds the exception to that one page.
 *
 * Error pages count. An unknown event, code or sponsor answers a page, and a
 * visitor who lands on it needs its one heading as much as anywhere.
 *
 * This is the workers-pool layer. The staging layer is the one-<h1> assertion
 * on every route in tests/ui/smoke/tier1.spec.ts (T4d).
 *
 * Seen red (2026-11-13): turning the demo index title back into an <h2> fails
 * "/demo: exactly one <h1>"; declaring '/privacy' notPage fails "/privacy is
 * declared not a page but answered HTML".
 */
import { SELF } from 'cloudflare:test';
import { describe, test, expect } from 'vitest';
import { PAGE_SURFACES, LANGUAGE_PREFIX_SAMPLES } from './helpers/page-surfaces';

// The pool's admin key (vitest.workers.config.mts bindings); not a real key.
const ADMIN = { Authorization: 'Bearer test-admin-key-e2e-2026' };

/**
 * <h1> elements in the served markup. A heading written inside a script (the
 * admin page builds a print window from a string) is text, not an element, so
 * an <h1 that sits inside a <script> block is not counted. Nothing is stripped
 * from the document; each match is placed by position.
 */
function countH1(body: string): number {
  const lower = body.toLowerCase();
  let count = 0;
  for (const m of lower.matchAll(/<h1[\s>]/g)) {
    const at = m.index ?? 0;
    const inScript = lower.lastIndexOf('<script', at) > lower.lastIndexOf('</script', at);
    if (!inScript) count += 1;
  }
  return count;
}

async function ask(path: string, admin?: boolean): Promise<{ html: boolean; h1: number }> {
  const res = await SELF.fetch(`https://t.test${path}`, {
    redirect: 'manual',
    headers: { Accept: 'text/html', ...(admin ? ADMIN : {}) },
  });
  const type = res.headers.get('content-type') ?? '';
  return { html: type.includes('text/html'), h1: countH1(await res.text()) };
}

describe('every page the worker serves has exactly one <h1>', () => {
  for (const [shape, surface] of Object.entries(PAGE_SURFACES)) {
    for (const sample of surface.samples) {
      if (surface.h1 === 'in-browser') {
        test(`${sample}: a page that draws its heading in the browser`, async () => {
          const got = await ask(sample, surface.admin);
          expect(got.html, `${sample} (${shape}) did not answer HTML`).toBe(true);
          // If it starts serving its heading, it no longer needs the exception.
          expect(
            got.h1,
            `${sample} now serves an <h1>: drop h1: 'in-browser' so it is counted here`
          ).toBe(0);
        });
      } else if (surface.html) {
        test(`${sample}: exactly one <h1>`, async () => {
          const got = await ask(sample, surface.admin);
          expect(got.html, `${sample} (${shape}) is declared a page but did not answer HTML`).toBe(
            true
          );
          expect(got.h1, `${sample} must have exactly one <h1> (found ${got.h1})`).toBe(1);
        });
      } else {
        test(`${sample}: not a page`, async () => {
          const got = await ask(sample);
          expect(
            got.html,
            `${sample} (${shape}) is declared not a page but answered HTML. ` +
              'Declare it page(...) in tests/helpers/page-surfaces.ts so its <h1> is checked.'
          ).toBe(false);
        });
      }
    }
  }

  test('only the briefing draws its heading in the browser', () => {
    const drawn = Object.entries(PAGE_SURFACES)
      .filter(([, s]) => s.h1 === 'in-browser')
      .map(([shape]) => shape)
      .sort();
    expect(
      drawn,
      'A page that serves no <h1> and draws it with a script is an exception. ' +
        'Serve the heading in the markup instead of adding to this list.'
    ).toEqual(['/briefing', '/overview', '/summary']);
  });

  test('a heading written inside a script is not counted as an element', () => {
    expect(countH1('<h1>Title</h1><script>w("<h1>" + label + "</h1>")</script>')).toBe(1);
    expect(countH1('<h1>One</h1><script>x()</script><h1 class="b">Two</h1>')).toBe(2);
    expect(countH1('<h2>None</h2>')).toBe(0);
  });

  for (const sample of LANGUAGE_PREFIX_SAMPLES) {
    test(`${sample}: exactly one <h1>`, async () => {
      const got = await ask(sample);
      expect(got.html, `${sample} did not answer HTML`).toBe(true);
      expect(got.h1, `${sample} must have exactly one <h1> (found ${got.h1})`).toBe(1);
    });
  }
});
