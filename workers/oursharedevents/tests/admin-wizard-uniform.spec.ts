/**
 * Create & Launch: one look for every step (2026-11-10).
 *
 * The front door and the five wizard steps share one card, one title scale,
 * one choice card, one info card, one primary button and one secondary
 * button, and on a phone the action bar is pinned to the bottom of the screen
 * so the next step is always one thumb-tap away (owner report from an
 * iPhone 16 Pro Max at 440px: Next sat below the fold and the rail showed
 * bare numbers).
 *
 * Reads the page's own <style> and script from the admin.html Text import, so
 * it runs in the node project with no worker.
 */

import { describe, test, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import ADMIN_HTML from '../src/templates/admin.html';

const CSS = (() => {
  const doc = new JSDOM(ADMIN_HTML).window.document;
  return Array.from(doc.querySelectorAll('style'))
    .map((s) => s.textContent || '')
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
})();

/** The sheet with every @media block removed: what applies at every width. */
function baseRules(css: string): string {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf('@media', i);
    if (at < 0) {
      out += css.slice(i);
      break;
    }
    out += css.slice(i, at);
    let j = css.indexOf('{', at) + 1;
    for (let depth = 1; depth > 0 && j < css.length; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
    }
    i = j;
  }
  return out;
}

/** Body of the @media block whose prelude matches `query` exactly. */
function mediaBody(css: string, query: string): string {
  const at = css.indexOf(`@media ${query}`);
  expect(at, `@media ${query}`).toBeGreaterThan(-1);
  let i = css.indexOf('{', at) + 1;
  const start = i;
  for (let depth = 1; depth > 0 && i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') depth--;
  }
  return css.slice(start, i - 1);
}

/** Every declaration block whose selector list names `selector` exactly. */
function blocks(css: string, selector: string): string[] {
  const out: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const sels = m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' '));
    if (sels.includes(selector)) out.push(m[2]);
  }
  return out;
}

function decl(css: string, selector: string, prop: string): string | undefined {
  let found: string | undefined;
  for (const body of blocks(css, selector)) {
    for (const d of body.split(';')) {
      const [k, ...v] = d.split(':');
      if (k && k.trim() === prop) found = v.join(':').trim();
    }
  }
  return found;
}

const px = (v: string | undefined): number => {
  if (!v) return NaN;
  const r = /^([\d.]+)(px|rem)$/.exec(v.trim());
  if (!r) return NaN;
  return r[2] === 'rem' ? Number(r[1]) * 16 : Number(r[1]);
};

const RAW_COLOUR = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/;

describe('one card for the front door and the wizard', () => {
  for (const sel of ['.launch-wizard', '.path-chooser']) {
    test(`${sel}: surface, 1px line, 12px radius, no shadow, no side accent`, () => {
      expect(decl(CSS, sel, 'background')).toBe('var(--surface)');
      expect(decl(CSS, sel, 'border')).toBe('1px solid var(--border)');
      expect(decl(CSS, sel, 'border-radius')).toBe('12px');
      expect(decl(CSS, sel, 'box-shadow')).toBeUndefined();
      expect(decl(CSS, sel, 'border-left')).toBeUndefined();
    });
    test(`${sel} h2: a real title in body colour, not muted`, () => {
      expect(decl(CSS, `${sel} h2`, 'color')).toBe('var(--text)');
      expect(decl(CSS, `${sel} h2`, 'font-weight')).toBe('700');
      expect(px(decl(CSS, `${sel} h2`, 'font-size'))).toBeGreaterThanOrEqual(22);
    });
  }

  test('every choice card wears the same edge, radius and height', () => {
    for (const sel of [
      '.path-option',
      '.wizard-template-card',
      '.wizard-signup-option',
      '.wizard-publish-option',
    ]) {
      expect(decl(CSS, sel, 'border'), sel).toBe('2px solid var(--border-strong)');
      expect(decl(CSS, sel, 'border-radius'), sel).toBe('12px');
      expect(px(decl(CSS, sel, 'min-height')), sel).toBeGreaterThanOrEqual(56);
    }
  });

  test('every info card wears the same edge and radius', () => {
    for (const sel of ['.wizard-link-card', '.wizard-tv', '.wizard-review', '.wizard-go-live']) {
      expect(decl(CSS, sel, 'border'), sel).toBe('1px solid var(--border-strong)');
      expect(decl(CSS, sel, 'border-radius'), sel).toBe('12px');
    }
  });
});

describe('one primary and one secondary button', () => {
  test('primary: accent fill, 56px, the biggest label in the step', () => {
    const sel = '.launch-wizard .create-btn';
    expect(decl(CSS, sel, 'background')).toBe('var(--accent)');
    expect(decl(CSS, sel, 'color')).toBe('var(--on-accent)');
    expect(px(decl(CSS, sel, 'min-height'))).toBeGreaterThanOrEqual(56);
    expect(px(decl(CSS, sel, 'font-size'))).toBe(18);
    expect(decl(CSS, sel, 'font-weight')).toBe('700');
  });

  test('secondary: 48px, 16px label in body colour, a visible edge', () => {
    for (const sel of ['.wizard-back-btn', '.wizard-skip-btn', '.wizard-copy-btn']) {
      expect(px(decl(CSS, sel, 'min-height')), sel).toBeGreaterThanOrEqual(48);
      expect(px(decl(CSS, sel, 'font-size')), sel).toBe(16);
      expect(decl(CSS, sel, 'color'), sel).toBe('var(--text)');
      expect(decl(CSS, sel, 'border'), sel).toBe('1px solid var(--border-strong)');
    }
  });

  test('a button the script hides with [hidden] stays hidden despite its display rule', () => {
    for (const sel of [
      '.launch-wizard .create-btn[hidden]',
      '.wizard-back-btn[hidden]',
      '.wizard-skip-btn[hidden]',
      '.wizard-copy-btn[hidden]',
    ]) {
      expect(decl(CSS, sel, 'display'), sel).toBe('none');
    }
  });

  test('the primary sits on the right of the action bar', () => {
    const base = baseRules(CSS);
    expect(decl(base, '.wizard-nav > .create-btn', 'order')).toBe('2');
    expect(decl(base, '.wizard-nav > .create-btn', 'margin-left')).toBe('auto');
  });

  test('wizard rules use colour tokens only', () => {
    for (const sel of [
      '.launch-wizard',
      '.path-chooser',
      '.path-option',
      '.launch-wizard .create-btn',
      '.wizard-back-btn',
      '.wizard-copy-btn',
      '.wizard-link-card',
      '.wizard-go-live',
    ]) {
      expect(blocks(CSS, sel).join(';'), sel).not.toMatch(RAW_COLOUR);
    }
  });
});

describe('the next step is always one tap away', () => {
  const phone = mediaBody(CSS, '(max-width: 639px)');

  test('the action bar is pinned to the bottom of the screen at every width', () => {
    const base = baseRules(CSS);
    expect(decl(base, '.wizard-nav', 'position')).toBe('sticky');
    expect(decl(base, '.wizard-nav', 'bottom')).toBe('0');
    expect(decl(base, '.wizard-nav', 'background')).toBe('var(--surface)');
    // No width un-pins it.
    expect(CSS).not.toMatch(/\.wizard-nav\s*\{[^}]*position:\s*(static|relative)/);
  });

  test('on a phone the bar clears the home indicator', () => {
    expect(decl(phone, '.wizard-nav', 'padding')).toContain('safe-area-inset-bottom');
  });

  test('buttons share the bar and the primary is the widest', () => {
    expect(decl(phone, '.wizard-nav > button', 'flex')).toBe('1 1 0');
    expect(decl(phone, '.wizard-nav > .create-btn', 'flex-grow')).toBe('2');
  });

  test('step names hide only below 400px, where a caption names the step', () => {
    expect(decl(phone, '.wizard-progress-step .step-label', 'display')).toBeUndefined();
    const narrow = mediaBody(CSS, '(max-width: 399px)');
    expect(decl(narrow, '.wizard-progress-step .step-label', 'display')).toBe('none');
  });
});

describe('the step caption names the step in words', () => {
  const doc = new JSDOM(ADMIN_HTML).window.document;

  test('it starts on step 1, named as the rail names it', () => {
    const caption = doc.querySelector('[data-testid="wizard-step-caption"]');
    expect(caption).not.toBeNull();
    const label = doc.querySelector('[data-testid="wizard-progress-1"] .step-label');
    expect(caption!.textContent).toBe(`Step 1 of 5: ${label!.textContent}`);
  });

  test('step names are sentence case', () => {
    const labels = Array.from(doc.querySelectorAll('.wizard-progress-step .step-label')).map(
      (el) => el.textContent
    );
    expect(labels).toEqual(['Basic info', 'Template', 'Sign-ups', 'Your links', 'Launch']);
  });

  test('the render pass rewrites it from the active rail step, with textContent', () => {
    const script = Array.from(doc.querySelectorAll('script'))
      .map((s) => s.textContent || '')
      .find((t) => t.includes('function updateUI()'));
    expect(script, 'wizard script').toBeDefined();
    const start = script!.indexOf('function updateUI()');
    const fn = script!.slice(start, script!.indexOf('function validate()', start));
    expect(fn.length).toBeGreaterThan(0);
    expect(fn).toContain("getElementById('wizard-step-caption')");
    expect(fn).toContain("'Step ' + wiz.step + ' of 5: '");
    expect(fn).not.toMatch(/caption\.innerHTML/);
  });
});

describe('every step asks its question as the largest text in the step', () => {
  test('question style is body colour, bold, larger than help text', () => {
    const q = '.wizard-step-help.wizard-question';
    expect(decl(CSS, q, 'color')).toBe('var(--text)');
    expect(decl(CSS, q, 'font-weight')).toBe('700');
    expect(px(decl(CSS, q, 'font-size'))).toBeGreaterThan(
      px(decl(CSS, '.wizard-step-help', 'font-size'))
    );
  });

  test('steps 2, 3 and 5 and the publish choice each carry a question', () => {
    const doc = new JSDOM(ADMIN_HTML).window.document;
    for (const id of ['wizard-step-1', 'wizard-step-2', 'wizard-step-3', 'wizard-step-5']) {
      expect(doc.querySelectorAll(`#${id} .wizard-question`).length, id).toBeGreaterThan(0);
    }
  });

  test('nothing in the flow is set below the 13px floor', () => {
    for (const sel of [
      '.wizard-step-help',
      '.wizard-card-title',
      '.wizard-card-desc',
      '.wizard-progress-step .step-label',
      '.path-option-desc',
      '.launch-wizard .create-form label',
      '.wizard-copy-btn',
      '.wizard-link-card .wizard-card-url',
    ]) {
      expect(px(decl(CSS, sel, 'font-size')), sel).toBeGreaterThanOrEqual(13);
    }
  });
});
