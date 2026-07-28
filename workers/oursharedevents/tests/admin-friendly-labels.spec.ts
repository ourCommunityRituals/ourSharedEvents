/**
 * OSE-R-005 — the admin /admin HTML must surface friendly, plain-English
 * tier + phase labels and hide internal event IDs by default.
 *
 * Layer: API (vitest inspects the rendered HTML and locks the contract).
 *
 * Per OCR_STANDARD_perStoryTestPyramid: names share their shape byte-for-byte
 * with the matching Playwright FE spec at
 * tests/playwright/admin-friendly-labels.spec.ts.
 *
 * Format: `OSE-R-005 | API | <method + path> (<condition>) | <assertion>`.
 *
 * The audit (REFINEMENT-BACKLOG-2026-05-15.md OSE-R-005) found that the
 * admin dashboard leaked:
 *   - raw tier slugs to the header badge: "free" / "mid" / "enterprise"
 *   - raw phase strings: "Phase 1" .. "Phase 5"
 *   - internal event IDs (`evt_7f3a9b2c`-style) in a column called "ID"
 *   - the new event toast: "Event created — evt_7f3a9b2c"
 *   - regulatory-clearance jargon in upgrade locks: "Requires Phase 2..."
 *   - tier slug "mid" in upgrade locks, contradicting briefing.ts ("Pro").
 *
 * The fix introduced TIER_LABELS + PHASE_LABELS maps + friendlyTier() /
 * friendlyPhase() helpers. This spec locks each rename + the new toggle.
 */

import { describe, test, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

// /admin is content-negotiated (OSE-R-001): unauthed browser requests get
// the friendly sign-in HTML; authed requests get the dashboard. The
// dashboard HTML is what the OSE-R-005 audit applies to, so we must auth
// the request with the admin bearer that the test env honors. Matches the
// pattern in tests/admin-ui.spec.ts.
const ADMIN_KEY = 'test-admin-key-e2e-2026';

async function fetchAdminHtml(): Promise<string> {
  const res = await SELF.fetch('https://t.test/admin', {
    headers: { Authorization: `Bearer ${ADMIN_KEY}` },
  });
  expect(res.status).toBe(200);
  expect(res.headers.get('Content-Type') ?? '').toContain('text/html');
  return res.text();
}

describe('OSE-R-005 admin friendly labels — API layer', () => {
  test('OSE-R-005 | API | GET /admin (any visitor) | TIER_LABELS map embedded with Free / Pro / Enterprise plan strings', async () => {
    const html = await fetchAdminHtml();
    expect(html).toMatch(/TIER_LABELS\s*=\s*\{/);
    expect(html).toMatch(/free\s*:\s*['"]Free plan['"]/);
    // Source-of-truth alignment with briefing.ts: middle tier is "Pro", not
    // "Mid". A mismatch here causes contradictory naming across surfaces.
    expect(html).toMatch(/mid\s*:\s*['"]Pro plan['"]/);
    expect(html).toMatch(/enterprise\s*:\s*['"]Enterprise plan['"]/);
  });

  test('OSE-R-005 | API | GET /admin (any visitor) | PHASE_LABELS map embedded with plain-English event-type names', async () => {
    const html = await fetchAdminHtml();
    expect(html).toMatch(/PHASE_LABELS\s*=\s*\{/);
    // 1..5 mapped to the friendly labels the briefing.ts copy uses.
    expect(html).toMatch(/1\s*:\s*['"]Community events['"]/);
    expect(html).toMatch(/2\s*:\s*['"]Commerce events['"]/);
    expect(html).toMatch(/3\s*:\s*['"]Licensed activities['"]/);
    expect(html).toMatch(/4\s*:\s*['"]Health events['"]/);
    expect(html).toMatch(/5\s*:\s*['"]Youth events['"]/);
  });

  test('OSE-R-005 | API | GET /admin (any visitor) | friendlyTier and friendlyPhase helpers defined globally', async () => {
    const html = await fetchAdminHtml();
    expect(html).toMatch(/window\.friendlyTier\s*=\s*function/);
    expect(html).toMatch(/window\.friendlyPhase\s*=\s*function/);
  });

  test('OSE-R-005 | API | GET /admin (any visitor) | header phase badge initial text is the friendly label, not "Phase 1"', async () => {
    const html = await fetchAdminHtml();
    // The header badge used to render the raw "Phase 1" string. The audit
    // replaced it with the friendly label. Raw phase number preserved on
    // data-phase + title for admins / support tooling.
    expect(html).toContain('>Community events<');
    expect(html).toMatch(/id="phaseBadge"[^>]*data-phase="1"/);
    expect(html).toMatch(/id="phaseBadge"[^>]*title="Internal phase 1"/);
    // The raw "Phase 1" string must NOT appear as the visible badge text.
    // (It may still appear in CSS class names like `phase-badge phase-1` —
    // we forbid only the >Phase N< rendered-text shape.)
    expect(html).not.toMatch(/<span[^>]*id="phaseBadge"[^>]*>Phase 1<\/span>/);
  });

  test('OSE-R-005 | API | GET /admin (any visitor) | tier badge population uses friendlyTier instead of raw slug', async () => {
    const html = await fetchAdminHtml();
    // The pre-fix wiring was: badge.textContent = tier  — leaking the slug.
    // New wiring: badge.textContent = window.friendlyTier(tier).
    expect(html).toContain('badge.textContent = window.friendlyTier(tier)');
    // Raw slug preserved on data-tier so support tooling and tests can still
    // read it; just NOT in visible copy.
    expect(html).toMatch(/badge\.setAttribute\(['"]data-tier['"]/);
    // Forbidden: the pre-fix line that wrote the raw slug to textContent.
    expect(html).not.toMatch(/badge\.textContent\s*=\s*tier\s*;/);
  });

  test('OSE-R-005 | API | GET /admin (any visitor) | events table ID column carries .col-internal-id class so it is hidden by default', async () => {
    const html = await fetchAdminHtml();
    // The ID column header AND cells must carry the toggle class so the
    // CSS default-hide kicks in. data-testid="event-id" stays on the cell
    // so support tooling can still read the value via a query.
    expect(html).toMatch(/<th class="col-internal-id"[^>]*>ID<\/th>/);
    // Note: attribute order between class / data-label / data-testid is
    // template-author choice; OSE-294 added data-label="ID" for mobile
    // card-layout. Assert presence of all 3 attributes within one td tag
    // rather than a specific substring order.
    expect(html).toMatch(/<td[^>]*class="col-internal-id"[^>]*data-testid="event-id"[^>]*>/);
  });

  test('OSE-R-005 | API | GET /admin (any visitor) | "Show internal IDs" toggle is rendered and OFF by default', async () => {
    const html = await fetchAdminHtml();
    expect(html).toMatch(/data-testid="show-internal-ids-toggle"/);
    // Attribute order between `id` and `type` is template-author choice;
    // assert both attributes appear within the same opening tag.
    expect(html).toMatch(/<input[^>]*id="show-internal-ids"[^>]*>/);
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*data-testid="show-internal-ids-toggle"/);
    // CSS default rule must hide the column when the table does NOT have
    // the .show-internal-ids class.
    expect(html).toContain('table.events-table .col-internal-id { display: none; }');
    expect(html).toContain(
      'table.events-table.show-internal-ids .col-internal-id { display: table-cell; }'
    );
  });

  test('OSE-R-005 | API | GET /admin (any visitor) | events table phase cell renders the friendly label via friendlyPhase', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('window.friendlyPhase(safePhase)');
    // The raw "Phase ${safePhase}" template literal pattern must NOT appear
    // as the visible cell text anymore. (Still permitted in CSS class
    // template `phase-badge phase-${safePhase}` — that's a class hook.)
    expect(html).not.toMatch(/data-testid="event-phase"[^>]*>Phase \$\{safePhase\}</);
  });

  test('OSE-R-005 | API | GET /admin (any visitor) | events table header uses "Event type" not "Phase"', async () => {
    const html = await fetchAdminHtml();
    expect(html).toMatch(/<th[^>]*>Event type<\/th>/);
    expect(html).not.toContain('<th>Phase</th>');
  });

  test('OSE-R-005 | API | GET /admin (any visitor) | upgrade lock overlay uses friendly plan + event-type labels', async () => {
    const html = await fetchAdminHtml();
    // Tier-axis lock: "Upgrade to Pro plan to unlock" (was: "Upgrade to mid to unlock").
    expect(html).toContain('Upgrade to');
    expect(html).toContain('upgradeTierLabel');
    // Phase-axis lock: "Available for Commerce events" (was: "Requires Phase 2 regulatory clearance").
    expect(html).toContain('Available for ');
    expect(html).toContain('upgradePhaseLabel');
    // Forbidden raw strings.
    expect(html).not.toContain('Requires Phase ');
    expect(html).not.toContain("'Upgrade to ' + (t.upgradeTier || 'mid') + ' to unlock'");
  });

  test('OSE-R-005 | API | GET /admin (any visitor) | create-event success toast does NOT leak the internal event ID into visible text', async () => {
    const html = await fetchAdminHtml();
    // The pre-fix toast: "Event created — " + data.id. The audit
    // replaced it with plain "Event created." — the ID lives on a dataset
    // attribute so support engineers can grab it from DevTools.
    expect(html).toContain("msg.textContent = 'Event created.'");
    expect(html).toContain('msg.dataset.eventId = String(data.id)');
    // The exact pre-fix pattern must NOT appear in the bundled JS.
    expect(html).not.toMatch(/msg\.textContent\s*=\s*['"]Event created\s*\\u2014/);
  });
});
