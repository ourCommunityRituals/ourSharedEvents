/**
 * A11Y-5: Color contrast remediation
 *
 * Verifies that WCAG-failing colors (#868e96 3.07:1, #2f9e44 on green 3.01:1,
 * #94a3b8 on light bg 2.37:1) have been replaced with accessible alternatives.
 *
 * Contrast ratios on white (#fff):
 *   #868e96 → 3.32:1 FAIL  |  #6c757d → 4.68:1 PASS
 *   #2f9e44 → 3.45:1 FAIL  |  #155724 → 8.69:1 PASS
 *   #94a3b8 → 2.57:1 FAIL  |  #64748b → 4.76:1 PASS
 *   badge.archived: #868e96 on #f1f3f5 → 2.98:1 FAIL  |  #495057 → 7.33:1 PASS
 */

import { describe, test, expect } from 'vitest';
import { handleAdminPage, handlePosterPage, handleSharedReportPage } from '../src/handlers/pages';
import { handleFormPage } from '../src/handlers/form-pages';

// ─── Helpers ────────────────────────────────────────────────────────────────

function adminHtml(): Promise<string> {
  return handleAdminPage({} as never).text();
}
function reportHtml(): Promise<string> {
  return handleSharedReportPage({} as never).then((r) => r.text());
}
function posterHtml(): Promise<string> {
  return handlePosterPage({} as never).then((r) => r.text());
}
async function formHtml(type: string): Promise<string> {
  const req = new Request(`https://t.test/forms/evt1?type=${type}&event=Test`);
  return (await handleFormPage(req, {}, 'evt1')).text();
}

// ─── No failing colors ───────────────────────────────────────────────────────

describe('A11Y-5: #868e96 removed from all light-bg pages', () => {
  test('admin page has no #868e96', async () => {
    expect(await adminHtml()).not.toContain('#868e96');
  });

  test('shared report page has no #868e96', async () => {
    expect(await reportHtml()).not.toContain('#868e96');
  });

  test('poster page has no #868e96', async () => {
    expect(await posterHtml()).not.toContain('#868e96');
  });

  test('register form has no #868e96', async () => {
    expect(await formHtml('register')).not.toContain('#868e96');
  });

  test('email form has no #868e96', async () => {
    expect(await formHtml('email')).not.toContain('#868e96');
  });
});

describe('A11Y-5: #2f9e44 removed (was 3.45:1 on white, 3.01:1 on green bg)', () => {
  test('admin page has no #2f9e44', async () => {
    expect(await adminHtml()).not.toContain('#2f9e44');
  });

  test('shared report page has no #2f9e44', async () => {
    expect(await reportHtml()).not.toContain('#2f9e44');
  });

  test('register form has no #2f9e44', async () => {
    expect(await formHtml('register')).not.toContain('#2f9e44');
  });
});

describe('A11Y-5: #94a3b8 removed from light-bg pages', () => {
  test('poster page has no #94a3b8', async () => {
    expect(await posterHtml()).not.toContain('#94a3b8');
  });

  test('shared report page has no #94a3b8', async () => {
    expect(await reportHtml()).not.toContain('#94a3b8');
  });
});

// ─── Accessible replacements present ────────────────────────────────────────

describe('A11Y-5: #6c757d (4.68:1 on white) used for muted text', () => {
  test('admin page has #6c757d for muted text', async () => {
    expect(await adminHtml()).toContain('#6c757d');
  });

  // shared-report migrated muted text to var(--text-muted) (token-adherence
  // conversion). The contrast guarantee moved to the token layer, it did not
  // weaken — verify-contrast.mjs checks --text-muted across themes.
  test('shared report page routes muted text through var(--text-muted), not raw hex', async () => {
    const body = await reportHtml();
    expect(body).toContain('var(--text-muted)');
    expect(body).not.toContain('#6c757d');
  });

  // Forms moved onto /ui.css tokens (theme parity, 2026-09-29): the fixed
  // #6c757d was light-only — the forms never followed a dark theme.
  test('register form routes the privacy notice through var(--text-muted)', async () => {
    const body = await formHtml('register');
    expect(body).toMatch(/\.privacy-notice\s*\{[^}]*color:\s*var\(--text-muted\)/);
    expect(body).not.toContain('#6c757d');
  });

  test('email form routes its description text through var(--text-muted)', async () => {
    const body = await formHtml('email');
    expect(body).toMatch(/\.form-intro\s*\{[^}]*color:\s*var\(--text-muted\)/);
    expect(body).not.toContain('#6c757d');
  });
});

describe('A11Y-5: #155724 (8.69:1 on white, 7.59:1 on green bg) for success/badge-active', () => {
  test('admin page badges use #155724', async () => {
    expect(await adminHtml()).toContain('#155724');
  });

  test('shared report badges use #155724', async () => {
    expect(await reportHtml()).toContain('#155724');
  });

  test('register form success uses var(--success)', async () => {
    const body = await formHtml('register');
    expect(body).toMatch(/\.success h2\s*\{[^}]*color:\s*var\(--success\)/);
    expect(body).not.toContain('#155724');
  });
});

describe('A11Y-5: #495057 (7.33:1 on #f1f3f5) for archived badge text', () => {
  // admin's archived-badge TEXT migrated to var(--text-muted) in the
  // token-adherence priority conversion (#495057 → --text-muted). The badge bg +
  // the status hues remain raw pending the status/tier-token decision. The
  // contrast guarantee moved to the token layer (verify-contrast.mjs), it did not
  // weaken. Assert the token, not the old hex.
  test('admin archived badge text is tokenised (var(--text-muted))', async () => {
    const body = await adminHtml();
    expect(body).toContain('.badge.archived');
    expect(body).toContain('var(--text-muted)');
    expect(body).not.toContain('#495057');
  });

  // shared-report's .badge.archived migrated to var(--surface-hover)/var(--text-muted)
  // via the token overlay; the active/tier badge hues remain raw (no token yet).
  // Archived is tokenised, so assert the token, not the old hex. (Admin's archived
  // badge above is unchanged — that surface is not yet converted.)
  test('shared report archived badge is tokenised (var(--text-muted))', async () => {
    const body = await reportHtml();
    expect(body).toContain('.badge.archived');
    expect(body).toContain('var(--text-muted)');
    expect(body).not.toContain('#495057');
  });
});

describe('A11Y-5: #64748b (4.76:1 on white) for poster/admin hint text', () => {
  // Poster migrated to var(--text-muted) in the token-adherence conversion
  // (poster.html screen hex -> tokens). The A11Y-5 contrast guarantee did not
  // weaken — it moved from this one hardcoded hex to the token layer, where
  // --text-muted is contrast-verified across themes by
  // the hub @ocr/ui scripts/verify-contrast.mjs (pinned by .ocr-hub-ref). Admin still holds the raw hex until
  // it converts (BASELINE admin.html), so its assertion below is unchanged.
  test('poster page routes muted hint text through var(--text-muted), not raw hex', async () => {
    const body = await posterHtml();
    expect(body).toContain('var(--text-muted)');
    expect(body).not.toContain('#64748b');
  });

  test('admin page qr-hint uses #64748b', async () => {
    const body = await adminHtml();
    expect(body).toContain('.qr-hint');
    expect(body).toContain('#64748b');
  });
});
