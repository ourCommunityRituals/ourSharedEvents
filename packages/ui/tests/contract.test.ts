import { describe, it, expect } from 'vitest';
import { checkTemplate } from '../src/contract';

describe('checkTemplate()', () => {
  it('flags a template that declares its own :root tokens', () => {
    const bigCss = '.rule' + 'x'.repeat(500) + '{color:red}';
    const legacy = `<!DOCTYPE html><html><head><style>
      :root { --bg:#0a0a0a; --accent:#1785FB; }
      ${bigCss}
    </style></head><body>...</body></html>`;
    const findings = checkTemplate('legacy.html', legacy);
    expect(findings.some((f) => f.issue === 'local-root-tokens')).toBe(true);
    expect(findings.some((f) => f.issue === 'large-inline-style')).toBe(true);
  });

  it('passes a template that links the shared stylesheet', () => {
    const migrated = `<!DOCTYPE html><html><head>
      <link rel="stylesheet" href="/ui.css">
    </head><body><main class="content"></main></body></html>`;
    expect(checkTemplate('migrated.html', migrated)).toHaveLength(0);
  });

  it('flags a page with no stylesheet at all', () => {
    const bare = `<!DOCTYPE html><html><head></head><body>hi</body></html>`;
    expect(
      checkTemplate('bare.html', bare).some((f) => f.issue === 'missing-shared-stylesheet')
    ).toBe(true);
  });
});

// OSE-1328 — the token-adherence keystone: raw hex bypasses the tokens, so a
// surface using it can't follow dark/light. Hex inside a var() fallback or a
// comment is fine. Born-red: raw-hex detection did not exist before this story.
describe('checkTemplate() — raw hex adherence', () => {
  const shell = (style: string) =>
    `<!DOCTYPE html><html><head><link rel="stylesheet" href="/ui.css"><style>${style}</style></head><body>x</body></html>`;

  it('flags a direct-value hex color and names it', () => {
    const hex = checkTemplate('t.html', shell('.card{background:#fff;color:#212529}')).find(
      (f) => f.issue === 'raw-hex-color'
    );
    expect(hex).toBeTruthy();
    expect(hex!.detail).toContain('#fff');
  });

  it('does NOT flag hex inside a var() token fallback', () => {
    const findings = checkTemplate(
      't.html',
      shell('.card{background:var(--surface, #1A2740);color:var(--text)}')
    );
    expect(findings.some((f) => f.issue === 'raw-hex-color')).toBe(false);
  });

  it('does NOT flag hex inside a CSS comment', () => {
    const findings = checkTemplate(
      't.html',
      shell('/* was #f8f9fa */ .card{background:var(--bg)}')
    );
    expect(findings.some((f) => f.issue === 'raw-hex-color')).toBe(false);
  });

  it('a token-only surface has zero raw-hex findings (theme-correct by construction)', () => {
    const findings = checkTemplate(
      't.html',
      shell('.card{background:var(--surface);border:1px solid var(--border);color:var(--text)}')
    );
    expect(findings.some((f) => f.issue === 'raw-hex-color')).toBe(false);
  });
});
