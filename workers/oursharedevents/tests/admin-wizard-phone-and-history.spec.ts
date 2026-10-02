/**
 * OSE-1314 + OSE-1315 — the Create & Launch wizard on a phone, and its way back.
 *
 * OSE-1314 (dogfooding, iPhone 16 Pro Max 440×956): the four event-type cards
 * rendered on ONE row, ~100px each, copy wrapping a word per line and the
 * selected card clipped past the panel edge. Cause: a bad merge had folded
 * `.wizard-template-grid` into the `.create-publish-label` flex rule, so the
 * grid never existed. Rule decided 2026-09-13: on phones every wizard card group
 * stacks one per row; side by side only from tablet width.
 *
 * OSE-1315: step 1 had no in-screen Back, and browser Back from the wizard
 * skipped the front door and landed on the Cloudflare Access callback (a forced
 * re-auth), because front door → wizard was a DOM swap with no history entry.
 *
 * Layer: API (vitest inspects the served admin HTML). The rendered proof is the
 * mobile-workability audit (OSE-1236) and a browser walk-through.
 *
 * @born-red OSE-1314 | method: the grid assertions fail against the pre-fix
 * template (no standalone .wizard-template-grid rule; it sits in a flex rule)
 * | date: 2026-09-29
 * @born-red OSE-1315 | method: the history + step-1 Back assertions fail
 * against the pre-fix template (no pushState, Back hidden on step 1)
 * | date: 2026-09-29
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { SELF } from 'cloudflare:test';

const ADMIN_KEY = 'test-admin-key-e2e-2026';
let html = '';

beforeAll(async () => {
  const res = await SELF.fetch('https://test.local/admin', {
    headers: { Authorization: `Bearer ${ADMIN_KEY}` },
  });
  expect(res.status).toBe(200);
  html = await res.text();
});

/** Every rule body whose selector list names `selector` (outside @media). */
function topLevelRulesFor(selector: string): string[] {
  const style = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map((m) => m[1])
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const out: string[] = [];
  let depth = 0;
  let sel = '';
  let body = '';
  for (const ch of style) {
    if (ch === '{') {
      depth += 1;
      if (depth === 1) body = '';
      else if (depth === 2) body = '';
      continue;
    }
    if (ch === '}') {
      if (depth === 1 && !sel.trim().startsWith('@')) {
        const names = sel.split(',').map((s) => s.trim());
        if (names.includes(selector)) out.push(body);
      }
      depth -= 1;
      if (depth === 0) sel = '';
      continue;
    }
    if (depth === 0) sel += ch;
    else body += ch;
  }
  return out;
}

describe('OSE-1314 — wizard choice cards stack one per row on phones', () => {
  test('the type grid is its own grid rule, not a flex row', () => {
    const rules = topLevelRulesFor('.wizard-template-grid');
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) {
      expect(r).toMatch(/display:\s*grid/);
      expect(r).not.toMatch(/display:\s*flex/);
    }
  });

  test('base (phone) layout is a single column for every wizard card group', () => {
    for (const sel of ['.wizard-template-grid', '.wizard-signup-grid', '.wizard-links-grid']) {
      const rules = topLevelRulesFor(sel);
      expect(rules.some((r) => /grid-template-columns:\s*1fr\s*;/.test(r))).toBe(true);
      // No phone-width auto-fit: two 160px columns fit a 440px panel, which is
      // exactly the side-by-side layout the story rules out.
      expect(rules.some((r) => /auto-fit/.test(r))).toBe(false);
    }
  });

  test('side by side only from tablet width up (mobile-first min-width)', () => {
    const m = html.match(
      /@media\s*\(min-width:\s*640px\)\s*\{\s*\.wizard-template-grid,\s*\.wizard-signup-grid,\s*\.wizard-links-grid\s*\{[^}]*auto-fit/
    );
    expect(m).not.toBeNull();
  });

  test('cards can shrink inside the panel and keep a 44px target', () => {
    const rules = topLevelRulesFor('.wizard-template-card');
    const card = rules.find((r) => /flex-direction:\s*column/.test(r)) ?? '';
    expect(card).toMatch(/min-width:\s*0/);
    expect(card).toMatch(/min-height:\s*44px/);
  });

  test('.create-publish-label keeps its own flex row (the merge is undone, not moved)', () => {
    const rules = topLevelRulesFor('.create-publish-label');
    expect(rules.some((r) => /display:\s*flex/.test(r))).toBe(true);
    expect(topLevelRulesFor('.create-publish-label').join('')).not.toMatch(/grid/);
  });
});

describe('OSE-1315 — step 1 has Back, and browser Back returns to the front door', () => {
  test('Back is shown on every pre-create step, step 1 included', () => {
    // Pre-create steps 1-3 (and, once saved, step 5 back to step 4).
    expect(html).toContain(
      'back.hidden = !((wiz.step <= 3 && !wiz.createdId) || (wiz.step === 5 && wiz.createdId));'
    );
    expect(html).not.toContain('back.hidden = !(wiz.step > 1 && wiz.step <= 3);');
    // Step 1's Back says where it goes.
    expect(html).toContain("back.textContent = wiz.step === 1 ? 'Back to start' : 'Back';");
  });

  test('opening the wizard and each pre-create step push a same-document entry', () => {
    expect(html).toContain("var WIZ_HASH = '#create-event';");
    expect(html).toMatch(/history\.pushState\(\s*\{ oseAdmin: 'wizard', step: step, depth:/);
    // startWizard pushes (unless it is replaying a popstate).
    expect(html).toMatch(
      /function startWizard\(ev, opts\)[\s\S]{0,300}pushWizardStep\(wiz\.step\)/
    );
  });

  test('the save replaces instead of pushing (Back never lands on a create step)', () => {
    expect(html).toMatch(/wiz\.step = 4;[\s\S]{0,200}replaceWizardStep\(4\)/);
  });

  test('popstate drives the wizard, and a non-wizard entry closes it to the front door', () => {
    expect(html).toContain("window.addEventListener('popstate'");
    expect(html).toContain('closeWizard({ fromHistory: true });');
  });

  test('the front door owns the URL on load (no stray #create-event, a state to pop to)', () => {
    expect(html).toMatch(
      /initWizardHistory[\s\S]{0,400}history\.replaceState\(\{ oseAdmin: 'chooser' \}/
    );
  });

  test('step-1 Back goes to the front door through the same close path as Escape', () => {
    expect(html).toMatch(
      /function goBack\(\)[\s\S]{0,600}if \(wiz\.step === 1\) \{\s*closeWizard\(\);/
    );
  });
});
