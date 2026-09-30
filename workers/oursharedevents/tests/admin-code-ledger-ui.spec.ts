/**
 * OSE-1420 — the admin cards are a truth surface (static, code-shape gate).
 *
 * The template must never BUILD a code URL on the client for the wizard, and
 * every card that shows a URL/QR must key it on the server's `live` flag,
 * fail-closed. These assertions read the template from disk; the behaviour is
 * proven in code-ledger.spec.ts (endpoints) and poster-multi-code-ui.spec.ts
 * (DOM).
 */

import { env } from 'cloudflare:test';
import { describe, test, expect } from 'vitest';

interface TestEnv {
  TEST_SOURCE_FILES_JSON: string;
}
function getAdminTemplate(): string {
  const sources: Record<string, string> = JSON.parse(
    (env as unknown as TestEnv).TEST_SOURCE_FILES_JSON
  );
  const entry = Object.entries(sources).find(([p]) =>
    p.replace(/\\/g, '/').endsWith('templates/admin.html')
  );
  if (!entry) throw new Error('admin.html not found in TEST_SOURCE_FILES_JSON');
  return entry[1];
}
const src = getAdminTemplate();

describe('admin | code ledger is the only source of wizard links (OSE-1420)', () => {
  test('wizard step 4 renders the ledger, not client-built URLs', () => {
    expect(src).toContain('id="wizard-codes"');
    expect(src).toContain('/code-ledger');
    expect(src).toContain('window.renderCodeLedger');
    // the old client-side URL construction is gone
    expect(src).not.toContain("setCardUrl('wizard-link-public'");
    expect(src).not.toContain("origin + '/events/' + id");
    expect(src).not.toContain('async function loadLinks()');
  });

  test('a wizard code card shows url/QR/Copy only when the server says live', () => {
    const start = src.indexOf('window.renderCodeLedger = function');
    const fn = src.slice(start, src.indexOf('async function loadWizardCodes', start));
    expect(fn).toContain("if (c.live === true && typeof c.url === 'string' && c.url)");
    expect(fn).toContain("indexOf('data:image/') === 0");
    expect(fn).toContain("'code-reason'");
    expect(fn).not.toContain('innerHTML');
  });

  test('publish renders the live codes on step 5 from the ledger; undo hides them', () => {
    expect(src).toContain('id="wizard-live-codes"');
    expect(src).toContain("loadWizardCodes('wizard-live-codes')");
    expect(src).not.toContain('The links on the previous step work now.');
  });

  test('poster deployment cards key the link, QR, Download and Print on pd.live (fail-closed)', () => {
    const start = src.indexOf('const renderPdCard = (pd) =>');
    const fn = src.slice(start, src.indexOf('window.loadPosterDeployments', start));
    expect(fn).toContain('const live = pd.live === true && !!scanUrl;');
    expect(fn).toContain("why.setAttribute('data-testid', 'pd-reason');");
    expect(fn).toContain('[data-action="pd-download"], [data-action="pd-print"]');
    expect(fn).toContain('const slotLive = s.live === true && !!text(s.url);');
  });

  test('poster codes rows show a reason instead of a link when not live', () => {
    expect(src).toContain('live: c.live === true,');
    expect(src).toContain("const link = row.live ? shortLink(row.code) : '';");
    expect(src).toContain("'poster-code-reason'");
  });

  test('surface cards drop the link and say "Switches on when you publish." for a non-live event', () => {
    const start = src.indexOf('window.scopeSurfaceCards = function');
    const fn = src.slice(start, src.indexOf('};', start));
    expect(fn).toContain("const gated = card.dataset.surface !== 'report' && !live;");
    expect(fn).toContain("'Switches on when you publish.'");
  });

  test('a status change re-reads every code card from the server', () => {
    const start = src.indexOf('window.changeEventStatus = async function');
    const fn = src.slice(start, start + 4000);
    expect(fn).toContain('window.loadPosterDeployments(id)');
    expect(fn).toContain('window.loadPosterCodes(id)');
    expect(fn).toContain('window.scopeSurfaceCards(id');
  });
});
