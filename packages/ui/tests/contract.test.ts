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
