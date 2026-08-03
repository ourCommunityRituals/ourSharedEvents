import { describe, it, expect } from 'vitest';
import {
  tokens,
  primitives,
  semanticDark,
  semanticLight,
  structural,
  rootBlock,
  lightModeBlock,
  uecDisplay,
  uecScan,
  uecBlock,
} from '../src/tokens';
import { contrastRatio } from '../src/contrast';

// Resolved hex values for contrast checks — primitives are the source of truth
const P = primitives;

describe('token structure', () => {
  it('all required semantic names are present in the dark map', () => {
    const required = [
      '--bg',
      '--surface',
      '--surface-hover',
      '--border',
      '--text',
      '--text-muted',
      '--accent',
      '--accent-hover',
      '--live',
      '--danger',
      '--error',
    ];
    for (const t of required) expect(t in semanticDark, `missing ${t}`).toBe(true);
  });

  it('all required structural tokens are present', () => {
    const required = ['--radius', '--radius-sm', '--tap-min', '--font'];
    for (const t of required) expect(t in structural, `missing ${t}`).toBe(true);
  });

  it('legacy tokens object contains all semantic + structural keys', () => {
    for (const k of Object.keys(semanticDark)) expect(k in tokens).toBe(true);
    for (const k of Object.keys(structural)) expect(k in tokens).toBe(true);
  });

  it('tap target is 48px', () => {
    expect(structural['--tap-min']).toBe('48px');
  });
});

describe('palette identity (CARTO, Ember-free)', () => {
  it('accent is CARTO blue, not legacy amber', () => {
    expect(P['--ocr-blue-600']).toBe('#1785FB');
    expect(Object.values(P)).not.toContain('#D4954B');
  });

  it('live token is teal — not red or green (colorblind-safe)', () => {
    expect(P['--ocr-teal-400']).toBe('#00C4B4');
    expect(P['--ocr-teal-700']).toBe('#00796B');
  });

  it('error aliases danger — same primitive, different semantic name', () => {
    expect(semanticDark['--error']).toBe(semanticDark['--danger']);
    expect(semanticLight['--error']).toBe(semanticLight['--danger']);
  });

  it('surface-hover is between surface and border (navy-800)', () => {
    expect(P['--ocr-navy-800']).toBe('#223350');
  });

  it('danger is red and distinct from live (no red+green semantic pair)', () => {
    const liveDark = P['--ocr-teal-400'];
    const dangerDark = P['--ocr-red-500'];
    expect(liveDark).not.toBe(dangerDark);
    // Teal and red are not the same hue family
    expect(liveDark.startsWith('#00')).toBe(true); // teal
    expect(dangerDark.startsWith('#E0')).toBe(true); // red
  });
});

describe('WCAG AA contrast (4.5:1 minimum, dark mode)', () => {
  const bg = P['--ocr-navy-950']; // #0F1824
  const surf = P['--ocr-navy-900']; // #1A2740

  it('body text on bg >= 4.5:1', () => {
    expect(contrastRatio(P['--ocr-navy-100'], bg)).toBeGreaterThanOrEqual(4.5);
  });
  it('body text on surface >= 4.5:1', () => {
    expect(contrastRatio(P['--ocr-navy-100'], surf)).toBeGreaterThanOrEqual(4.5);
  });
  it('muted text on bg >= 4.5:1', () => {
    expect(contrastRatio(P['--ocr-navy-500'], bg)).toBeGreaterThanOrEqual(4.5);
  });
  it('accent on bg >= 4.5:1', () => {
    expect(contrastRatio(P['--ocr-blue-600'], bg)).toBeGreaterThanOrEqual(4.5);
  });
  it('live/teal on bg >= 4.5:1', () => {
    expect(contrastRatio(P['--ocr-teal-400'], bg)).toBeGreaterThanOrEqual(4.5);
  });
  it('danger on bg >= 4.5:1', () => {
    expect(contrastRatio(P['--ocr-red-500'], bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('WCAG AA contrast (4.5:1 minimum, light mode)', () => {
  const bg = P['--ocr-light-050']; // #F4F7FC

  it('body text on bg >= 4.5:1', () => {
    expect(contrastRatio(P['--ocr-dark-900'], bg)).toBeGreaterThanOrEqual(4.5);
  });
  it('muted text on bg >= 4.5:1', () => {
    expect(contrastRatio(P['--ocr-slate-600'], bg)).toBeGreaterThanOrEqual(4.5);
  });
  it('accent on bg >= 4.5:1', () => {
    expect(contrastRatio(P['--ocr-blue-700'], bg)).toBeGreaterThanOrEqual(4.5);
  });
  it('live/teal on bg >= 4.5:1', () => {
    expect(contrastRatio(P['--ocr-teal-700'], bg)).toBeGreaterThanOrEqual(4.5);
  });
  it('danger on bg >= 4.5:1', () => {
    expect(contrastRatio(P['--ocr-red-700'], bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('rootBlock output', () => {
  it('emits Tier 1 and Tier 2 :root blocks', () => {
    const css = rootBlock();
    expect(css).toContain('/* Tier 1 — primitives */');
    expect(css).toContain('/* Tier 2 — semantic (dark default) */');
    expect((css.match(/:root/g) ?? []).length).toBe(2);
  });

  it('lightModeBlock targets prefers-color-scheme by default', () => {
    expect(lightModeBlock()).toContain('@media (prefers-color-scheme: light)');
  });

  it('lightModeBlock accepts a custom selector for forced theme', () => {
    const block = lightModeBlock('[data-theme="light"]');
    expect(block).toContain('[data-theme="light"]');
    expect(block).not.toContain('@media');
  });
});

describe('uecBlock output', () => {
  it('emits exactly one :root block', () => {
    const css = uecBlock();
    expect((css.match(/:root/g) ?? []).length).toBe(1);
  });

  it('contains UEC v1.1 comment header', () => {
    expect(uecBlock()).toContain('UEC v1.1');
  });

  it('emits all 11 display palette vars', () => {
    const css = uecBlock();
    for (const key of Object.keys(uecDisplay)) {
      expect(css).toContain(key);
    }
  });

  it('emits all 11 scan palette vars', () => {
    const css = uecBlock();
    for (const key of Object.keys(uecScan)) {
      expect(css).toContain(key);
    }
  });

  it('does NOT wrap in prefers-color-scheme (theme-invariant)', () => {
    expect(uecBlock()).not.toContain('@media');
  });
});

describe('UEC scan palette — WCAG AA on white (4.5:1 minimum)', () => {
  const white = '#FFFFFF';

  // Scan colors are used as QR module fill on white QR background.
  // WCAG AA for normal text: 4.5:1. For large text / graphical objects: 3:1.
  // QR modules are graphical — targeting 3:1 minimum, documenting 4.5:1 where achieved.
  const scanColors: Array<[string, string]> = [
    ['enter-scan', uecScan['--uec-enter-scan']],
    ['live-scan', uecScan['--uec-live-scan']],
    ['sponsor-scan', uecScan['--uec-sponsor-scan']],
    ['archive-scan', uecScan['--uec-archive-scan']],
    ['help-scan', uecScan['--uec-help-scan']],
    ['feedback-scan', uecScan['--uec-feedback-scan']],
    ['utility-scan', uecScan['--uec-utility-scan']],
  ];

  for (const [name, hex] of scanColors) {
    it(`uec-${name} on white >= 4.5:1`, () => {
      expect(contrastRatio(hex, white)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe('UEC display palette — badge text contrast >= 3:1', () => {
  // UEC badges use the display color as background.
  // Light backgrounds (coral, amber) require dark text — dark text on these passes at 7:1+.
  // Dark backgrounds (green, navy, purple, pink, charcoal) use white text at 3:1+.
  // WCAG AA for large text / graphical badges: 3:1 minimum.
  const white = '#FFFFFF';
  const black = '#000000';

  const darkBackground: Array<[string, string]> = [
    ['enter (green)', uecDisplay['--uec-enter']], // white text >= 4.5:1
    ['sponsor (navy)', uecDisplay['--uec-sponsor']], // white text >= 10:1
    ['archive (purple)', uecDisplay['--uec-archive']], // white text >= 6:1
    ['help (pink)', uecDisplay['--uec-help']], // white text ~3.5:1
    ['utility (charcoal)', uecDisplay['--uec-utility']], // white text >= 7:1
  ];

  const lightBackground: Array<[string, string]> = [
    ['live (coral)', uecDisplay['--uec-live']], // dark text ~7:1 — NOT white
    ['feedback (amber)', uecDisplay['--uec-feedback']], // dark text ~7.5:1 — NOT white
  ];

  for (const [name, hex] of darkBackground) {
    it(`white text on uec-${name} >= 3:1`, () => {
      expect(contrastRatio(white, hex)).toBeGreaterThanOrEqual(3.0);
    });
  }

  for (const [name, hex] of lightBackground) {
    it(`dark text on uec-${name} >= 3:1 (light background — use black text)`, () => {
      expect(contrastRatio(black, hex)).toBeGreaterThanOrEqual(3.0);
    });
  }
});
