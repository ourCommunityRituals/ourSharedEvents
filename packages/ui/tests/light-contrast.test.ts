import { describe, it, expect } from 'vitest';
import { primitives, semanticDark, semanticLight } from '../src/tokens';
import { componentStyles } from '../src/styles';
import { contrastRatio } from '../src/contrast';

// Light-theme contrast, measured the way the page renders it: every semantic
// role is resolved through its var(--ocr-*) primitive, and every pair is taken
// from where componentStyles actually puts it — cards and list rows on hover,
// ink on the accent fill, the edge of a form control. The older suites check
// text on --bg only, which is how these gaps went unseen.

type Theme = Record<string, string>;
const P = primitives as Record<string, string>;
const resolve = (theme: Theme, token: string): string => {
  const v = theme[token];
  const m = /^var\((--[\w-]+)\)$/.exec(v ?? '');
  const hex = m?.[1] ? P[m[1]] : v;
  if (!hex || !hex.startsWith('#')) throw new Error(`${token} does not resolve to a hex`);
  return hex;
};
const L = (t: string) => resolve(semanticLight, t);

/** The declaration block for a selector, e.g. rule('.btn-primary'). */
const rule = (sel: string): string => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|\\n|\\})${esc}\\{([^}]*)\\}`).exec(componentStyles);
  if (!m?.[1]) throw new Error(`no rule for ${sel}`);
  return m[1];
};

describe('light theme: text on every ground it lands on (>= 4.5:1)', () => {
  const grounds = ['--bg', '--surface', '--surface-hover'];
  const inks = ['--text', '--text-muted', '--accent', '--live', '--danger', '--warn', '--info', '--success'];
  for (const ink of inks) {
    for (const ground of grounds) {
      it(`${ink} on ${ground}`, () => {
        expect(contrastRatio(L(ink), L(ground))).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

describe('ink on the accent fill uses --on-accent, never a hard-coded colour', () => {
  const ACCENT_FILLS = ['.btn-primary', '.attr-btn', '.genre-filter-btn', '.profile-avatar', '.contributor-avatar'];
  for (const sel of ACCENT_FILLS) {
    it(`${sel} sets color:var(--on-accent)`, () => {
      const decl = rule(sel);
      expect(decl).toContain('background:var(--accent)');
      expect(decl).toContain('color:var(--on-accent)');
    });
  }

  it('--on-accent clears 4.5:1 on --accent and --accent-hover in both themes', () => {
    for (const theme of [semanticDark, semanticLight] as Theme[]) {
      const ink = resolve(theme, '--on-accent');
      expect(contrastRatio(ink, resolve(theme, '--accent'))).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(ink, resolve(theme, '--accent-hover'))).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('light theme: form-control edges (WCAG 1.4.11, >= 3:1)', () => {
  const CONTROLS = ['.input', '.search-bar', '.sort-select'];
  for (const sel of CONTROLS) {
    it(`${sel} is bordered with --border-strong`, () => {
      expect(rule(sel)).toContain('border:1px solid var(--border-strong)');
    });
  }

  for (const ground of ['--bg', '--surface', '--surface-hover']) {
    it(`--border-strong on ${ground}`, () => {
      expect(contrastRatio(L('--border-strong'), L(ground))).toBeGreaterThanOrEqual(3);
    });
  }
});

describe('the existing dark site is visually unchanged', () => {
  it('dark --border-strong is the same colour as dark --border', () => {
    expect(resolve(semanticDark, '--border-strong')).toBe(resolve(semanticDark, '--border'));
  });
  it('dark --surface-hover is still navy-800', () => {
    expect(semanticDark['--surface-hover']).toBe('var(--ocr-navy-800)');
  });
});
