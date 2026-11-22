/**
 * The sponsor home's look, read in a real browser with the deployed /ui.css
 * (FE pass, part of OSE-1322; the vocabulary admin.html took in PR #1459).
 *
 *   tests/e2e/3-flows/sponsor-journey.spec.ts   T4b, Step 1c, on staging
 *
 * It returns what is wrong, one line each, so a red run names every miss at
 * once. Classes alone are not enough: a computed style proves the shared
 * stylesheet reached the page and its rule applies (an uppercase .brand label
 * and .section-title, a 44px link and buttons).
 *
 * The workers-pool layer of the same facts is the "FE pass" block in
 * workers/oursharedevents/tests/sponsor-home.spec.ts.
 */
import type { Page } from '@playwright/test';

/** The org floor for a touch target (AGENTS.md invariant 8). */
const MIN_TARGET_PX = 44;

export async function sponsorHomeLookProblems(page: Page, sponsorName: string): Promise<string[]> {
  return page.evaluate(
    ({ name, min }) => {
      const out: string[] = [];
      const upper = (el: Element | null) =>
        !!el && getComputedStyle(el).textTransform === 'uppercase';

      const h1s = document.querySelectorAll('h1');
      if (h1s.length !== 1) out.push(`expected one <h1>, found ${h1s.length}`);
      const h1 = document.querySelector('header.header h1');
      if (!h1) out.push('no <h1> inside header.header');
      else if ((h1.textContent || '').trim() !== name)
        out.push(`the <h1> reads "${(h1.textContent || '').trim()}", not the sponsor name`);

      const brand = document.querySelector('header.header .brand');
      if (!brand) out.push('no .brand label in the header');
      else if (!upper(brand)) out.push('.brand is not uppercase: /ui.css did not apply');

      const nav = document.querySelector('[data-testid="sponsor-home-nav-events"]');
      if (!nav || !nav.classList.contains('btn-link')) out.push('the header link is not .btn-link');
      else if (nav.getBoundingClientRect().height < min)
        out.push(`the header link is ${nav.getBoundingClientRect().height}px tall`);

      const stats = document.querySelectorAll('.stats-row .stat-card .stat-value');
      if (stats.length !== 3)
        out.push(`expected 3 .stat-value in .stats-row, found ${stats.length}`);

      const titles = document.querySelectorAll('main h2.section-title');
      if (titles.length === 0) out.push('no h2.section-title');
      titles.forEach((t) => {
        if (!upper(t)) out.push(`section title "${t.textContent}" is not uppercase`);
      });

      const cards = document.querySelectorAll('[data-testid="placement-card"]');
      if (cards.length === 0) out.push('no placement card');
      cards.forEach((c, i) => {
        if (!c.classList.contains('card') || !c.classList.contains('card--sectioned'))
          out.push(`placement card ${i} is not .card.card--sectioned`);
        if (!c.querySelector(':scope > .card-header > h3.card-title'))
          out.push(`placement card ${i} has no .card-header > h3.card-title`);
        if (!c.querySelector(':scope > .card-body'))
          out.push(`placement card ${i} has no .card-body`);
        if (parseFloat(getComputedStyle(c).borderLeftWidth) > 1.5)
          out.push(`placement card ${i} still has a thick left edge`);
        c.querySelectorAll('a, button').forEach((b) => {
          const r = b.getBoundingClientRect();
          if (r.height > 0 && r.height < min)
            out.push(`"${(b.textContent || '').trim()}" is ${r.height}px tall`);
        });
      });
      return out;
    },
    { name: sponsorName, min: MIN_TARGET_PX }
  );
}
