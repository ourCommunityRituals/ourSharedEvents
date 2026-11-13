/**
 * The demo sites as the worker serves them: each page has exactly one <h1>,
 * it is the page title, and no heading below it skips a level (AGENTS.md
 * invariant 8, one <h1> per page).
 *
 * The demo sites are the permanent reference installation (ADR-007). Until
 * 2026-11-13 their titles were <h2> and no page had an <h1>; no gate looked.
 * This is the workers-pool layer: the real router answers, so a title that
 * loses its <h1>, or a wrapper that adds a second one, goes red here. The
 * staging layer is the demo cases in tests/ui/smoke/tier1.spec.ts (T4d).
 *
 * Born red: turn any title in src/handlers/demo.ts back into an <h2> and that
 * page's case fails on "exactly one <h1>".
 */

import { SELF } from 'cloudflare:test';
import { describe, test, expect } from 'vitest';
import { demoPaths } from '../src/lib/demo-registry';

interface Heading {
  level: number;
  text: string;
}

function headings(html: string): Heading[] {
  return Array.from(html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)).map((m) => ({
    level: Number(m[1]),
    text: m[2].replace(/<[^>]+>/g, '').trim(),
  }));
}

const PAGES: Array<{ path: string; status: number; title: string }> = [
  { path: '/demo', status: 200, title: 'The demo site' },
  { path: '/demo/free', status: 200, title: 'Demo — Free · Local' },
  { path: '/demo/mid', status: 200, title: 'Demo — Mid' },
  { path: '/demo/premium', status: 200, title: 'Demo — Premium · Enterprise' },
  { path: '/demo/no-such-site', status: 404, title: 'No such demo site' },
];

describe('demo sites: one <h1> per page, and it is the page title', () => {
  test('every published demo address is checked here', () => {
    const checked = PAGES.map((p) => p.path);
    for (const path of demoPaths()) expect(checked).toContain(path);
  });

  for (const page of PAGES) {
    test(`${page.path} has exactly one <h1>, the title, and no skipped level`, async () => {
      const res = await SELF.fetch(`https://t.test${page.path}`);
      expect(res.status).toBe(page.status);
      const found = headings(await res.text());

      const h1 = found.filter((h) => h.level === 1);
      expect(h1.length, `${page.path} must have exactly one <h1> (found ${h1.length})`).toBe(1);
      expect(h1[0].text).toBe(page.title);
      expect(found[0].level, `${page.path}: the first heading is the page title`).toBe(1);

      found.forEach((h, i) => {
        if (i > 0) {
          expect(
            h.level,
            `${page.path}: "${h.text}" jumps from h${found[i - 1].level} to h${h.level}`
          ).toBeLessThanOrEqual(found[i - 1].level + 1);
        }
      });
    });
  }
});
