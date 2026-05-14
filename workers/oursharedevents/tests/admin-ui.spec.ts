/**
 * Admin UI Structure Tests
 *
 * Validates the admin page HTML output via SELF.fetch against miniflare.
 * Tests the frontend features added in ADMIN-2 (tier badge), ADMIN-5
 * (inline form config), and ADMIN-12 (CSS classes, zero inline styles).
 *
 * These are NOT browser tests — they verify the HTML template structure
 * returned by the Worker. For full browser interaction tests, use
 * the Playwright suite in tests/e2e/.
 */

import { SELF, env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';

const ADMIN_KEY = 'test-admin-key-e2e-2026';

function adminHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${ADMIN_KEY}` };
}

async function fetchAdminHtml(): Promise<string> {
  const res = await SELF.fetch('https://t.test/admin', {
    headers: adminHeaders(),
  });
  expect(res.status).toBe(200);
  expect(res.headers.get('Content-Type')).toContain('text/html');
  return res.text();
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN-2: Tier badge + gated UI
// ═══════════════════════════════════════════════════════════════════════════════

describe('ADMIN-2: Tier badge in admin header', () => {
  test('admin page returns 200 with HTML', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('OurSharedEvents');
  });

  test('tier badge element exists with data-testid', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('data-testid="tier-badge"');
    expect(html).toContain('id="tierBadge"');
    expect(html).toContain('class="tier-badge"');
  });

  test('tier badge CSS classes defined for all 3 tiers', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('.tier-badge.free');
    expect(html).toContain('.tier-badge.mid');
    expect(html).toContain('.tier-badge.enterprise');
  });

  test('JS fetches current tier and resolved flags on load', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('/api/v2/admin/flags/current-tier');
    expect(html).toContain('/api/v2/admin/flags/resolve');
    expect(html).toContain('window._resolvedFlags');
  });

  test('feature-locked CSS defined for gated elements', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('.feature-locked');
    expect(html).toContain('.lock-overlay');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN-5: Inline form config toggles
// ═══════════════════════════════════════════════════════════════════════════════

describe('ADMIN-5: Form config toggles', () => {
  test('loadForms function resolves per-event flags', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('/api/v2/admin/flags/resolve?eventId=');
  });

  test('JS generates form gate data-testids for all 4 types', async () => {
    const html = await fetchAdminHtml();
    // These are generated dynamically by loadForms() — verify the JS patterns
    expect(html).toContain("form-gate-' + t.key");
    expect(html).toContain("key: 'register'");
    expect(html).toContain("key: 'checkin'");
    expect(html).toContain("key: 'survey'");
    expect(html).toContain("key: 'email'");
  });

  test('toggle switch CSS and config section defined', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('.toggle');
    expect(html).toContain('.toggle .slider');
    expect(html).toContain('.config-section');
    expect(html).toContain('.form-config');
  });

  test('toggleFormFlag function calls PUT event flag API', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('window.toggleFormFlag');
    expect(html).toContain('/api/v2/admin/events/');
    expect(html).toContain("method: 'PUT'");
  });

  test('JS generates form config and toggle data-testid patterns', async () => {
    const html = await fetchAdminHtml();
    // These are generated dynamically — verify the JS template patterns
    expect(html).toContain("form-config-' + t.key");
    expect(html).toContain("form-toggle-' + t.key");
  });

  test('upgrade prompt shown for tier-gated forms', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('Upgrade to');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN-12: Zero inline styles
// ═══════════════════════════════════════════════════════════════════════════════

describe('ADMIN-12: No inline styles in admin HTML', () => {
  test('admin page contains zero style= attributes', async () => {
    const html = await fetchAdminHtml();
    // Extract just the body (exclude <style> block which contains CSS)
    const bodyStart = html.indexOf('<body>');
    const bodyHtml = html.slice(bodyStart);
    expect(bodyHtml).not.toMatch(/style="/);
  });

  test('utility CSS classes exist', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('.clickable-row');
    expect(html).toContain('.muted-sm');
    expect(html).toContain('.sr-only');
    expect(html).toContain('.flex-row');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN-13: Skeleton loaders + error states
// ═══════════════════════════════════════════════════════════════════════════════

describe('ADMIN-13: Skeleton loaders and error states', () => {
  test('skeleton shimmer animation defined in CSS', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('@keyframes shimmer');
    expect(html).toContain('.skeleton');
    expect(html).toContain('.skeleton-table');
    expect(html).toContain('.skeleton-row');
  });

  test('events container starts with skeleton loader', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('data-testid="skeleton-events"');
    expect(html).toContain('data-testid="events-container"');
  });

  test('forms panel shows skeleton when loading', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('data-testid="skeleton-forms"');
  });

  test('card-error CSS defined with retry button', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('.card-error');
    expect(html).toContain('.retry-btn');
    expect(html).toContain('.error-icon');
    expect(html).toContain('.error-msg');
  });

  test('events error state has retry button and data-testid', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('data-testid="events-error"');
    expect(html).toContain('location.reload()');
  });

  test('forms error state has retry button and data-testid', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('data-testid="forms-error"');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN-14: Surface link cards (poster, display, public, report)
// ═══════════════════════════════════════════════════════════════════════════════

// ── Layer 1: Structure — HTML template contains expected elements ────────────

describe('ADMIN-14 Structure: Surface cards in admin HTML', () => {
  test('surface-cards container present with data-testid', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('data-testid="surface-cards"');
  });

  const surfaces = [
    { key: 'poster', href: '/poster', title: 'Poster Page' },
    { key: 'display', href: '/display', title: 'TV Display' },
    { key: 'public', href: '/', title: 'Public Page' },
    { key: 'report', href: '/sharedReport', title: 'Shared Report' },
  ];

  for (const s of surfaces) {
    test(`${s.key} card has card, link, copy button, and QR hint`, async () => {
      const html = await fetchAdminHtml();
      expect(html).toContain(`data-testid="card-${s.key}"`);
      expect(html).toContain(`data-testid="link-${s.key}"`);
      expect(html).toContain(`href="${s.href}"`);
      expect(html).toContain(`data-testid="copy-${s.key}"`);
      expect(html).toContain(`QR-ready: ${s.href}`);
      expect(html).toContain(s.title);
    });
  }

  test('all links open in new tab (target="_blank")', async () => {
    const html = await fetchAdminHtml();
    // Each surface link <a> has target="_blank" — check by matching the full tag
    const linkTags = html.match(/<a[^>]*data-testid="link-\w+"[^>]*>/g) ?? [];
    expect(linkTags.length).toBe(4);
    for (const tag of linkTags) {
      expect(tag).toContain('target="_blank"');
    }
  });
});

// ── Layer 2: CSS — visual classes defined for card styling ───────────────────

describe('ADMIN-14 CSS: Surface card styles', () => {
  test('surface card base + per-surface border colors defined', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('.surface-card {');
    expect(html).toContain('.surface-card.poster');
    expect(html).toContain('.surface-card.display');
    expect(html).toContain('.surface-card.public');
    expect(html).toContain('.surface-card.report');
  });

  test('surface cards grid layout defined', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('.surface-cards {');
    expect(html).toMatch(/\.surface-cards\s*\{[^}]*grid/);
  });

  test('QR hint style defined', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('.qr-hint');
  });

  // OSE-221: Display surface card MUST use the platform-standard accent
  // (#4361ee, indigo) — not the Tailwind blue (#2563eb) that drifted in
  // earlier. The 7-surface color tokens need to stay consistent across
  // admin surfaces. If a future contributor reverts this to Tailwind blue,
  // this test fails the PR.
  test('OSE-221: surface-card.display uses platform-standard #4361ee accent (no Tailwind drift)', async () => {
    const html = await fetchAdminHtml();
    expect(html).toMatch(/\.surface-card\.display\s*\{[^}]*border-left-color:\s*#4361ee\b/);
    // Negative: the Tailwind drift value MUST NOT appear in the display rule
    expect(html).not.toMatch(/\.surface-card\.display\s*\{[^}]*border-left-color:\s*#2563eb\b/);
  });
});

// ── Layer 3: Integration — linked surfaces respond with 200 HTML ────────────

describe('ADMIN-14 Integration: Surface routes serve content', () => {
  const surfaceRoutes = [
    { path: '/poster', name: 'Poster' },
    { path: '/display', name: 'Display' },
    { path: '/', name: 'Landing/Public' },
  ];

  for (const route of surfaceRoutes) {
    test(`GET ${route.path} → 200 HTML (${route.name})`, async () => {
      const res = await SELF.fetch(`https://t.test${route.path}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('text/html');
      const html = await res.text();
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('OurSharedEvents');
    });
  }

  test('GET /sharedReport → gated by analytics.shared-report flag (200 or 403, never 404)', async () => {
    const res = await SELF.fetch('https://t.test/sharedReport');
    expect([200, 403]).toContain(res.status);
  });

  test('all ungated surfaces have data-testid on their header element', async () => {
    const paths = ['/poster', '/display'];
    for (const path of paths) {
      const res = await SELF.fetch(`https://t.test${path}`);
      const html = await res.text();
      expect(html).toMatch(/data-testid="(poster|display|report|landing|public)-header"/);
    }
  });
});

// ── Layer 4: Contract — admin card links match actual route paths ────────────

describe('ADMIN-14 Contract: Admin links match real routes', () => {
  test('every href in surface cards resolves to a live route (not 404)', async () => {
    const adminHtml = await fetchAdminHtml();
    const hrefs = ['/poster', '/display', '/'];
    for (const href of hrefs) {
      expect(adminHtml).toContain(`href="${href}"`);
      const res = await SELF.fetch(`https://t.test${href}`);
      expect(res.status).not.toBe(404);
    }
    // sharedReport link exists but is flag-gated (403 on free tier, not 404)
    expect(adminHtml).toContain('href="/sharedReport"');
    const reportRes = await SELF.fetch('https://t.test/sharedReport');
    expect(reportRes.status).not.toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN-15: Copy button feedback
// ═══════════════════════════════════════════════════════════════════════════════

// ── Layer 1: Structure — copy buttons present with correct wiring ────────────

describe('ADMIN-15 Structure: Copy buttons', () => {
  const surfaces = ['poster', 'display', 'public', 'report'];

  for (const s of surfaces) {
    test(`copy-${s} button has data-testid and onclick`, async () => {
      const html = await fetchAdminHtml();
      expect(html).toContain(`data-testid="copy-${s}"`);
      expect(html).toMatch(new RegExp(`data-testid="copy-${s}"[^>]*onclick="copyUrl\\(`));
    });
  }

  test('copy buttons render as <button> elements (not links)', async () => {
    const html = await fetchAdminHtml();
    const copyBtns = html.match(/<button[^>]*class="copy-btn"[^>]*>/g) ?? [];
    expect(copyBtns.length).toBe(4);
  });
});

// ── Layer 2: CSS — copy button states ────────────────────────────────────────

describe('ADMIN-15 CSS: Copy button visual states', () => {
  test('default copy-btn style defined', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('.copy-btn {');
    expect(html).toMatch(/\.copy-btn\s*\{[^}]*cursor:\s*pointer/);
  });

  test('hover state defined', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('.copy-btn:hover');
  });

  test('copied success state with green styling', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('.copy-btn.copied');
    expect(html).toMatch(/\.copy-btn\.copied\s*\{[^}]*#d3f9d8/);
    expect(html).toMatch(/\.copy-btn\.copied\s*\{[^}]*#155724/);
  });
});

// ── Layer 3: JS Logic — copyUrl function behavior ───────────────────────────

describe('ADMIN-15 JS: copyUrl function', () => {
  test('function defined and callable', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('function copyUrl(path, btn)');
  });

  test('builds full URL from location.origin + path', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('location.origin + path');
  });

  test('uses navigator.clipboard.writeText API', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('navigator.clipboard.writeText(url)');
  });

  test('shows "Copied!" text on success', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain("btn.textContent = 'Copied!'");
  });

  test('adds .copied class on success', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain("btn.classList.add('copied')");
  });

  test('reverts to "Copy URL" after 2000ms', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain("btn.textContent = 'Copy URL'");
    expect(html).toContain("btn.classList.remove('copied')");
    // setTimeout wraps the revert with a 2s delay
    expect(html).toContain('}, 2000)');
  });

  test('handles clipboard failure gracefully', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('.catch(');
    expect(html).toContain("btn.textContent = 'Failed'");
  });

  test('each copy button passes the correct path to copyUrl', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain("copyUrl('/poster'");
    expect(html).toContain("copyUrl('/display'");
    expect(html).toContain("copyUrl('/'");
    expect(html).toContain("copyUrl('/sharedReport'");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Auth gate: admin page requires auth
// ═══════════════════════════════════════════════════════════════════════════════

describe('Admin auth gate', () => {
  test('GET /admin without auth returns 401', async () => {
    const res = await SELF.fetch('https://t.test/admin');
    expect(res.status).toBe(401);
  });

  test('GET /admin with valid Bearer token returns 200', async () => {
    const res = await SELF.fetch('https://t.test/admin', {
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN-2: Phase badge (regulatory clearance tier) — OSE-73 / PR #146
// ═══════════════════════════════════════════════════════════════════════════════

describe('ADMIN-2: Phase badge element and initial state', () => {
  test('phase badge has id, data-testid, and default class phase-1', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('id="phaseBadge"');
    expect(html).toContain('data-testid="phase-badge"');
    expect(html).toContain('class="phase-badge phase-1"');
  });

  test('phase badge initial text content is "Phase 1"', async () => {
    const html = await fetchAdminHtml();
    // Static default rendered in the header <h1>
    expect(html).toContain('>Phase 1<');
  });

  test('phase badge base CSS class defined', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('.phase-badge {');
  });

  test('phase badge CSS defined for all 5 regulatory phases', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('.phase-badge.phase-1');
    expect(html).toContain('.phase-badge.phase-2');
    expect(html).toContain('.phase-badge.phase-3');
    expect(html).toContain('.phase-badge.phase-4');
    expect(html).toContain('.phase-badge.phase-5');
  });
});

// ── Phase badge JS wiring ─────────────────────────────────────────────────────

describe('ADMIN-2: Phase badge JS wiring in loadForms', () => {
  test('loadForms signature accepts legalPhase as third parameter', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('window.loadForms = async function(eventId, eventName, legalPhase)');
  });

  test('loadForms coerces legalPhase safely via Number() with fallback 1', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('Number(legalPhase) || 1');
  });

  test('loadForms p clamped to 1-5 range (prevents phase-badge class overflow)', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('Math.max(1, Math.min(5, Number(legalPhase) || 1))');
  });

  test('loadForms updates phase badge textContent to "Phase " + p', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain("pb.textContent = 'Phase ' + p");
  });

  test('loadForms updates phase badge CSS class to "phase-badge phase-N"', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain("pb.className = 'phase-badge phase-' + p");
  });

  test('loadForms preserves data-testid on the phase badge after dynamic update', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain("pb.dataset.testid = 'phase-badge'");
  });
});

// ── Events table phase column ─────────────────────────────────────────────────

describe('ADMIN-2: Events table phase column', () => {
  test('events JS reads legal_clearance_tier from each event row', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('e.legal_clearance_tier');
  });

  test('safePhase coerces legal_clearance_tier with numeric fallback to 1', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('Number(e.legal_clearance_tier) || 1');
  });

  test('safePhase clamped to 1-5 range (Math.max/Math.min prevents out-of-range CSS classes)', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('Math.max(1, Math.min(5, Number(e.legal_clearance_tier) || 1))');
  });

  test('event row passes safePhase to loadForms as third argument', async () => {
    const html = await fetchAdminHtml();
    // JS builds: loadForms('${safeId}', '${safeName...}', ${safePhase})
    expect(html).toContain("loadForms('${safeId}',");
    expect(html).toContain(', ${safePhase});');
  });

  test('event row carries data-phase attribute populated from safePhase', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('data-phase="${safePhase}"');
  });

  test('events table header includes Phase column', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('<th>Phase</th>');
  });

  test('phase cell has event-phase data-testid and phase-badge class template', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('data-testid="event-phase"');
    expect(html).toContain('class="phase-badge phase-${safePhase}"');
  });
});

// ── Two-axis tier × phase gate ────────────────────────────────────────────────

describe('ADMIN-2: Two-axis tier × phase gate in loadForms', () => {
  test('loadForms derives eventPhase from legalPhase with safe coercion', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('const eventPhase = Math.max(1, Math.min(5, Number(legalPhase) || 1))');
  });

  test('phaseEnabled computed from eventPhase against upgradePhase threshold', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('phaseEnabled');
    expect(html).toContain('t.upgradePhase || 1');
  });

  test('gate requires BOTH tier AND phase conditions (two-axis AND)', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('tierEnabled && phaseEnabled');
  });

  test('regulatory lock message contains "Requires Phase" text', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('Requires Phase');
  });

  test('form gate elements are keyed by form type via t.key', async () => {
    const html = await fetchAdminHtml();
    // JS builds: data-testid="form-gate-' + t.key + '"
    expect(html).toContain("form-gate-' + t.key");
  });

  test('form types comment documents both axes (upgradeTier and upgradePhase)', async () => {
    const html = await fetchAdminHtml();
    // // upgradeTier: payment tier required. upgradePhase: regulatory clearance tier required.
    expect(html).toContain('upgradeTier');
    expect(html).toContain('upgradePhase');
  });

  test('survey and email form types define upgradePhase: 2 (Phase 2 required for data-collection forms)', async () => {
    const html = await fetchAdminHtml();
    // Two occurrences of `upgradePhase: 2` — one each for survey and email types
    const hits = (html.match(/upgradePhase: 2/g) ?? []).length;
    expect(hits).toBe(2);
  });

  test('payment tier lock is distinct from phase lock ("Upgrade to" vs "Requires Phase")', async () => {
    const html = await fetchAdminHtml();
    // Both lock messages must be present — they cover different axes
    expect(html).toContain('Upgrade to');
    expect(html).toContain('Requires Phase');
  });
});

// ─── Backend: legal_clearance_tier in admin events API response ────────────────
//
// Verifies that the SELECT query in handleAdminListEvents projects
// legal_clearance_tier onto each row, and that non-default values round-trip
// through the API without coercion. Seeded via D1 directly to avoid
// depending on the create-event UI flow.

interface Admin2TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

describe('ADMIN-2 Backend: legal_clearance_tier field in admin events API', () => {
  const BRAND = 'admin2-lct-backend';

  beforeAll(async () => {
    const tenv = env as unknown as Admin2TestEnv;
    const db = tenv.DB;
    const stmts: string[] = JSON.parse(tenv.TEST_MIGRATION_STATEMENTS);
    for (const stmt of stmts) {
      try {
        await db.prepare(stmt).run();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('duplicate column name')) continue;
        throw e;
      }
    }
    // Clean slate for this brand
    await db.prepare('DELETE FROM events WHERE brand_id = ?').bind(BRAND).run();

    const now = new Date().toISOString();
    // Event with explicit non-default legal_clearance_tier = 3
    await db
      .prepare(
        `INSERT INTO events (id, brand_id, title, slug, status, legal_clearance_tier, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind('evt_lct_phase3', BRAND, 'LCT Phase 3 Event', 'lct-phase3', 'active', 3, now, now)
      .run();

    // Event relying on column DEFAULT (expects 1)
    await db
      .prepare(
        `INSERT INTO events (id, brand_id, title, slug, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind('evt_lct_default', BRAND, 'LCT Default Event', 'lct-default', 'active', now, now)
      .run();

    // Out-of-range: LCT=6 (above max CSS class phase-5 — clamping is UI-layer)
    await db
      .prepare(
        `INSERT INTO events (id, brand_id, title, slug, status, legal_clearance_tier, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind('evt_lct_oor', BRAND, 'LCT Out-of-Range Event', 'lct-oor', 'active', 6, now, now)
      .run();
  });

  test('GET /api/v2/admin/events includes legal_clearance_tier on every item', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/admin/events', {
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; items: Record<string, unknown>[] };
    expect(body.ok).toBe(true);
    // Every item must carry the field (not undefined / missing from SELECT)
    for (const item of body.items) {
      expect(item, `Event ${String(item.id)} is missing legal_clearance_tier`).toHaveProperty(
        'legal_clearance_tier'
      );
    }
  });

  test('seeded event with legal_clearance_tier=3 round-trips correctly', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/admin/events', {
      headers: adminHeaders(),
    });
    const body = (await res.json()) as { ok: boolean; items: Record<string, unknown>[] };
    const item = body.items.find((e) => e.id === 'evt_lct_phase3');
    expect(item).toBeDefined();
    expect(item!.legal_clearance_tier).toBe(3);
  });

  test('event without explicit tier returns default value of 1', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/admin/events', {
      headers: adminHeaders(),
    });
    const body = (await res.json()) as { ok: boolean; items: Record<string, unknown>[] };
    const item = body.items.find((e) => e.id === 'evt_lct_default');
    expect(item).toBeDefined();
    expect(item!.legal_clearance_tier).toBe(1);
  });

  test('L5 boundary: LCT=6 passes through API as raw value (clamping is UI-layer only)', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/admin/events', {
      headers: adminHeaders(),
    });
    const body = (await res.json()) as { ok: boolean; items: Record<string, unknown>[] };
    const item = body.items.find((e) => e.id === 'evt_lct_oor');
    expect(item).toBeDefined();
    // API returns the raw DB value — the UI template clamps it to 1-5
    expect(item!.legal_clearance_tier).toBe(6);
  });
});
