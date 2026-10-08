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

  test('JS generates one form row for all 4 types', async () => {
    const html = await fetchAdminHtml();
    // These are generated dynamically by loadForms() — verify the JS patterns
    expect(html).toContain("form-row-' + key");
    expect(html).toContain("form-count-' + key");
    expect(html).toContain("key: 'register'");
    expect(html).toContain("key: 'checkin'");
    expect(html).toContain("key: 'survey'");
    expect(html).toContain("key: 'email'");
  });

  test('toggle switch CSS and form row anatomy defined', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('.toggle');
    expect(html).toContain('.toggle .slider');
    expect(html).toContain('.form-row');
    expect(html).toContain('.form-row-actions');
  });

  test('toggleFormFlag function calls PUT event flag API', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('window.toggleFormFlag');
    expect(html).toContain('/api/v2/admin/events/');
    expect(html).toContain("method: 'PUT'");
  });

  test('JS generates one row with toggle data-testid patterns', async () => {
    const html = await fetchAdminHtml();
    // These are generated dynamically — verify the JS template patterns
    expect(html).toContain("form-row-' + key");
    expect(html).toContain("form-toggle-' + key");
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
    // Extract body, then strip <script> blocks — JS template strings may contain
    // style= as part of dynamically injected HTML snippets; those are not real
    // HTML attributes and should not trigger this guard.
    const bodyStart = html.indexOf('<body'); // the <body> tag carries a class now
    const bodyHtml = html.slice(bodyStart);
    const bodyNoScripts = bodyHtml.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    expect(bodyNoScripts).not.toMatch(/style="/);
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
// OSE-1328: forms-card uniform .card anatomy (card 2/6)
// ═══════════════════════════════════════════════════════════════════════════════

describe('OSE-1328: forms-card uniform anatomy', () => {
  test('forms-card adopts the uniform .card base + header/body anatomy', async () => {
    const html = await fetchAdminHtml();
    // .card = token-driven base from /ui.css; the forms-card class is kept so
    // the context-bar ecbJump target (querySelector('.forms-card')) still resolves.
    expect(html).toContain('class="card forms-card"');
    expect(html).toMatch(/class="mcard-head"[\s\S]*?class="mcard-title"/);
    expect(html).toContain('class="mcard-body"');
    expect(html).toContain('.mcard-head {');
    // No bespoke card chrome (shadow) left on the forms-card rule.
    expect(html).not.toMatch(/\.forms-card\s*\{[^}]*box-shadow/);
  });

  test('forms-card wiring preserved (panel id + loadForms + ecb jump target)', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('id="forms-panel"');
    expect(html).toContain('data-testid="forms-panel"');
    expect(html).toContain('window.loadForms');
    expect(html).toContain('data-target="forms-card"');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// OSE-1328: poster-deployments-card uniform anatomy (card 3, cluster — decouple)
// ═══════════════════════════════════════════════════════════════════════════════

describe('OSE-1328: poster-deployments-card uniform anatomy', () => {
  test('poster-deployments-card adopts .card + .mcard-* (no longer borrows .sponsors-card-header)', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('class="card poster-deployments-card"');
    // Its header uses the shared .mcard-head/.mcard-title, not the sponsors-card piggyback.
    expect(html).toMatch(
      /class="card poster-deployments-card"[\s\S]*?class="mcard-head"[\s\S]*?class="mcard-title">Posters/
    );
    // The three cluster cards now share ONE grouped padding:0 base rule (DRY —
    // slice 3 retired the per-card chrome); assert poster-deployments is in it.
    expect(html).toMatch(/\.poster-deployments-card[,{][\s\S]*?padding: 0/);
    // The add-spon-btn hover raw hex was routed to the token in the same change.
    expect(html).not.toContain('#3a56d4');
  });

  test('poster-deployments wiring preserved (panel + form ids + ecb jump target)', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('id="pd-panel"');
    expect(html).toContain('id="pd-form-wrap"');
    expect(html).toContain('data-testid="poster-deployments-panel"');
    expect(html).toContain('data-action="pd-toggle"');
    expect(html).toContain('data-target="poster-deployments-card"');
  });

  test('OSE-1357 poster deployments surface existing shortlink slots with QR codes', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('data-testid="pd-shortlink-slots"');
    expect(html).toContain('data-testid="pd-shortlink-slot"');
    expect(html).toContain('data-testid="pd-shortlink-qr"');
    expect(html).toContain('data-testid="pd-shortlink-url"');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// OSE-1328: sponsors + poster-art cluster — the .sponsors-card god-class retired
// ═══════════════════════════════════════════════════════════════════════════════

describe('OSE-1328: sponsors + poster-art cluster (god-class retired)', () => {
  test('sponsors-card adopts .card + .mcard-* (keeps .sponsors-card hook + testid)', async () => {
    const html = await fetchAdminHtml();
    // .card base + the sponsors-card class kept for ecbJump + the [data-testid] lookup (admin.html ~2717)
    expect(html).toContain('class="card sponsors-card"');
    expect(html).toMatch(
      /class="card sponsors-card"[\s\S]*?class="mcard-head"[\s\S]*?class="mcard-title">Sponsors/
    );
    expect(html).toContain('class="mcard-body"');
    // wiring preserved
    expect(html).toContain('id="spon-form-wrap"');
    expect(html).toContain('data-testid="sponsors-list"');
    expect(html).toContain('data-testid="add-sponsor-toggle"');
    expect(html).toContain('data-target="sponsors-card"');
  });

  test('poster-art-card adopts .card + .mcard-* and DROPS the sponsors-card piggyback', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('class="card poster-art-card"');
    expect(html).not.toContain('class="sponsors-card poster-art-card"'); // decoupled
    expect(html).toMatch(
      /class="card poster-art-card"[\s\S]*?class="mcard-head"[\s\S]*?class="mcard-title">Poster art/
    );
    // R4 (OSE-1319) hydration wiring preserved
    expect(html).toContain('id="pa-panel"');
    expect(html).toContain('id="pa-manage"');
    expect(html).toContain('data-testid="poster-art-file"');
  });

  test('the shared .sponsors-card-header rule + class are retired (god-class killed)', async () => {
    const html = await fetchAdminHtml();
    expect(html).not.toMatch(/\.sponsors-card-header\s*\{/); // CSS rule gone
    expect(html).not.toContain('class="sponsors-card-header"'); // no card borrows it
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// OSE-1328: dashboard-card uniform anatomy (card 4 — last management card)
// ═══════════════════════════════════════════════════════════════════════════════

describe('OSE-1328: dashboard-card uniform anatomy', () => {
  test('dashboard-card adopts .card + .mcard-* (title in header, stats+lifecycle in body)', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('class="card dashboard-card"');
    expect(html).toMatch(
      /class="card dashboard-card"[\s\S]*?class="mcard-head"[\s\S]*?class="mcard-title[^"]*"[^>]*>Event Dashboard/
    );
    expect(html).toContain('class="mcard-body"');
    // base rule adopts the anatomy (padding:0), no bespoke card chrome (shadow).
    expect(html).toMatch(/\.dashboard-card\s*\{[\s\S]*?padding: 0/);
    expect(html).not.toMatch(/\.dashboard-card\s*\{[^}]*box-shadow/);
  });

  test('dashboard-card wiring preserved (id + hidden + stat/phase testids + ecb target)', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('id="dashboard-card"');
    expect(html).toContain('data-testid="admin-dashboard-card"');
    expect(html).toContain('data-testid="admin-dashboard-title"');
    expect(html).toContain('data-testid="admin-stat-scans-num"');
    expect(html).toContain('data-testid="admin-phase-pre-fill"');
    expect(html).toContain('data-target="dashboard-card"'); // ecbJump target intact
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

describe('ADMIN-14 CSS: Surface card styles (OSE-1328 uniform anatomy)', () => {
  test('surface cards adopt the shipped .card base (no bespoke card chrome)', async () => {
    const html = await fetchAdminHtml();
    // OSE-1328 Decision 3: every surface-link card carries the uniform .card
    // class — var(--surface) bg + 1px var(--border) + var(--radius-sm) from
    // /ui.css — NOT a bespoke background/box-shadow/left-border block.
    expect(html).toContain('class="card surface-card poster"');
    expect(html).toContain('class="card surface-card display"');
    expect(html).toContain('class="card surface-card public"');
    expect(html).toContain('class="card surface-card report"');
    // The retired bespoke chrome is gone: no box-shadow / left-border on the
    // base surface-card rule (those now come from the token-driven .card).
    expect(html).not.toMatch(/\.surface-card\s*\{[^}]*box-shadow/);
    expect(html).not.toMatch(/\.surface-card\s*\{[^}]*border-left/);
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

  // OSE-221, carried forward into OSE-1328: the per-surface left-border accents
  // are RETIRED by Decision 3 (uniform card, no left-border), so the accent no
  // longer rides a raw hex that could drift. The anti-drift guarantee now holds
  // by construction — the surface link routes its accent through var(--accent),
  // and the Tailwind blue that once drifted in never reappears on a border.
  test('OSE-221/1328: per-surface raw-hex left-border accents retired (uniform card)', async () => {
    const html = await fetchAdminHtml();
    expect(html).not.toMatch(
      /\.surface-card\.(poster|display|public|report)\s*\{[^}]*border-left-color/
    );
    // The historical Tailwind drift value must never return on a border.
    expect(html).not.toMatch(/border-left-color:\s*#2563eb/);
  });
});

// OSE-262: warnings banner rendering for create-event response
// Surfaces non-fatal partial-success conditions (e.g., SHORTLINK_CREATE_FAILED)
// in the admin create-event form. The API contract (handleCreateEvent in
// events.ts, PR #170) returns `warnings: []` alongside `ok: true` on
// partial success; this UI is where those warnings become visible.
describe('OSE-262: create-event warnings banner', () => {
  test('admin HTML contains create-warnings container with proper data-testid + ARIA', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('id="create-warnings"');
    expect(html).toContain('data-testid="create-warnings"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="assertive"');
    // Container starts hidden until populated by the submit handler
    expect(html).toMatch(/id="create-warnings"[^>]*hidden/);
  });

  test('warning banner CSS classes defined', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('.create-warnings');
    expect(html).toContain('.warning-banner');
    expect(html).toContain('.warning-dismiss-btn');
    // Banner uses a distinct color from success (green) / error (red) — the amber
    // --warn token. It was a light-only #fef3c7/#d97706 pair (white-on-amber dismiss
    // button 3.2:1); theme parity (2026-09-29) routes it through the token.
    expect(html).toMatch(/\.warning-banner\s*\{[^}]*background:\s*var\(--surface\)/);
    expect(html).toMatch(/\.warning-banner\s*\{[^}]*border-left:[^}]*var\(--warn\)/);
  });

  test('submit handler reads data.warnings and renders per-code testids', async () => {
    const html = await fetchAdminHtml();
    // JS references the API contract field
    expect(html).toContain('data.warnings');
    // Renders banner with data-testid prefix scoped by warning code
    expect(html).toContain("'create-warning-' + (w.code || 'UNKNOWN')");
    // Provides a dismiss button that reloads the events table
    expect(html).toContain("'create-warning-dismiss'");
    expect(html).toContain('warning-dismiss-btn');
    // Auto-reload is suppressed when warnings present — only the dismiss
    // button click triggers reload. The branching logic must be in the JS.
    expect(html).toMatch(/Array\.isArray\(data\.warnings\)/);
  });

  test('warnings UI is independent of error UI (success + warnings is a real state)', async () => {
    const html = await fetchAdminHtml();
    // The submit handler must enter the success branch FIRST (res.ok && data.ok),
    // then check warnings inside it. A response with warnings is still a success.
    expect(html).toMatch(/if\s*\(\s*res\.ok\s*&&\s*data\.ok\s*\)/);
    // The error branch sets create-msg error and DOES NOT touch warnings;
    // warnings live entirely in the success path.
    expect(html).toContain("'create-msg error'");
    // Sanity: warnings reference + dismiss handler appear after the success
    // branch keyword in the JS handler (script execution order is left-to-right
    // in this single-file dump).
    expect(html.indexOf('warningsContainer.hidden = false')).toBeGreaterThan(
      html.indexOf('if (res.ok && data.ok)')
    );
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
    // OSE-1239: was `onclick="copyUrl(`. That assertion passed for as long as
    // the button was DEAD — a nonce CSP refuses inline handlers, so the
    // attribute rendered and never fired. The shape it asserted WAS the bug.
    // Now: the delegated dispatcher's contract, data-action + data-url.
    test(`copy-${s} button is wired through the CSP-safe dispatcher`, async () => {
      const html = await fetchAdminHtml();
      expect(html).toContain(`data-testid="copy-${s}"`);
      expect(html).toMatch(new RegExp(`data-testid="copy-${s}"[^>]*data-action="copy-url"`));
      expect(html).toMatch(new RegExp(`data-testid="copy-${s}"[^>]*data-url="`));
      expect(html, 'inline handlers are refused by the CSP').not.toMatch(
        new RegExp(`data-testid="copy-${s}"[^>]*onclick=`)
      );
    });
  }

  test('copy buttons render as <button> elements (not links)', async () => {
    const html = await fetchAdminHtml();
    // Strip <script> blocks before counting — JS template strings may contain
    // <button class="copy-btn"> snippets for dynamically injected content
    // (e.g. mint-link-btn, mint-copy-btn); only surface-card static buttons count.
    const htmlNoScripts = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    const copyBtns = htmlNoScripts.match(/<button[^>]*class="copy-btn"[^>]*>/g) ?? [];
    expect(copyBtns.length).toBe(9); // +1: pd-create-btn (OSE-636 poster deployment form); +3: poster codes Add / Save / Undo (OSE-1357 p2); +1: TV display Save
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
    // Was a light-only #d3f9d8/#155724 pair; now the --success token (both themes).
    expect(html).toMatch(/\.copy-btn\.copied\s*\{[^}]*color:\s*var\(--success\)/);
    expect(html).toMatch(/\.copy-btn\.copied\s*\{[^}]*border-color:\s*var\(--success\)/);
  });
});

// ── Layer 3: JS Logic — copyUrl function behavior ───────────────────────────

describe('ADMIN-15 JS: copyUrl function', () => {
  test('function defined and callable', async () => {
    const html = await fetchAdminHtml();
    // On window (OSE-1239) so the delegated dispatcher can resolve it.
    expect(html).toContain('window.copyUrl = function copyUrl(path, btn)');
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

  // OSE-1239: the paths moved from an inline call argument to data-url, which
  // the dispatcher reads at click time. Same four paths, a shape the CSP allows.
  test('each copy button carries the correct path in data-url', async () => {
    const html = await fetchAdminHtml();
    for (const [testid, path] of [
      ['copy-poster', '/poster'],
      ['copy-display', '/display'],
      ['copy-public', '/'],
      ['copy-report', '/sharedReport'],
    ] as const) {
      expect(html, `${testid} should carry data-url="${path}"`).toMatch(
        new RegExp(`data-testid="${testid}"[^>]*data-url="${path.replace('/', '\\/')}"`)
      );
    }
  });
});

// These two read the served page as text. They cannot tell whether the code
// runs: they passed for weeks while Generate Link threw "esc is not defined".
// What the panel draws is checked in admin-mint-report-link.spec.ts.
describe('OSE-1342: Shared Report mint link', () => {
  test('builds a browser-openable signed report URL from the minted token', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain("location.origin + '/sharedReport?eventId=' +");
    expect(html).toContain('encodeURIComponent(data.token)');
    expect(html).toContain('data-testid="mint-report-url"');
    expect(html).toContain('href="\' + esc(reportUrl) + \'"');
  });

  test('copies the generated report URL instead of only the bearer token', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain("var value = argOf(el, 'url') || argOf(el, 'token') || ''");
    expect(html).toContain('data-action="mint-copy" data-url="\' + esc(reportUrl) + \'"');
    expect(html).toContain('aria-label="Copy report link"');
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

  test('phase badge initial text content is the Phase 1 friendly label', async () => {
    const html = await fetchAdminHtml();
    // OSE-R-005 (2026-05-15): the raw "Phase 1" jargon string used to render
    // in the header. The audit replaced it with PHASE_LABELS[1] = "Community
    // events". The raw phase number is still available via title + data-phase
    // for admins/support who need it.
    expect(html).toContain('>Community events<');
    expect(html).toContain('data-phase="1"');
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

  test('loadForms updates phase badge textContent to the friendly phase label', async () => {
    const html = await fetchAdminHtml();
    // OSE-R-005: friendly label visible; raw phase number lives in title +
    // data-phase. window.friendlyPhase(p) maps 1..5 to PHASE_LABELS.
    expect(html).toContain('pb.textContent = window.friendlyPhase(p)');
    expect(html).toContain("pb.title = 'Internal phase ' + p");
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

  test('event row passes safePhase to selectEvent, fanned out to loadForms (OSE-667)', async () => {
    const html = await fetchAdminHtml();
    // OSE-667: the row selects via the single store; loadForms receives the
    // phase from the ose:event-selected event, not a direct imperative call.
    // OSE-1239: the row no longer calls selectEvent from an inline onclick —
    // the CSP refused that, so selection never happened at all. The id, name
    // and phase ride on data-* and the dispatcher passes them through.
    expect(html).toContain('data-action="event-select"');
    expect(html).toContain('data-event-id="${safeId}"');
    expect(html).toContain('data-event-phase="${safePhase}"');
    expect(html).toContain('window.loadForms(d.id, d.name, d.phase)');
  });

  test('event row carries data-phase attribute populated from safePhase', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain('data-phase="${safePhase}"');
  });

  test('events table header includes the friendly event-type column', async () => {
    const html = await fetchAdminHtml();
    // OSE-R-005/OSE-1344: "Phase" is an internal axis; the column is a
    // human event-type label on the event row.
    expect(html).toMatch(/<th[^>]*>Event type<\/th>/);
  });

  test('event type cell renders event_type_name with event_type_id fallback', async () => {
    const html = await fetchAdminHtml();
    expect(html).toContain("var typeLabel = e.event_type_name || e.event_type_id || '—';");
    expect(html).toContain('data-testid="event-type"');
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

  test('regulatory lock message uses the friendly "Available for <event type>" copy', async () => {
    const html = await fetchAdminHtml();
    // OSE-R-005: the lock overlay used to say "Requires Phase 2 regulatory
    // clearance" — internal compliance jargon. Replaced with the friendly
    // "Available for Commerce events" pattern keyed by PHASE_LABELS.
    // OSE-1361: now one section line, lower-case mid-sentence ("Survey and
    // Email List are available for Commerce events."), same friendly map.
    expect(html).toContain("' available for ' + ph");
    expect(html).toContain('o.phaseLabel(t.upgradePhase || 2)');
  });

  test('form row elements are keyed by form type via t.key', async () => {
    const html = await fetchAdminHtml();
    // JS builds: data-testid="form-row-' + key + '" with key = esc(t.key) (CodeQL: every value through esc)
    expect(html).toContain("form-row-' + key");
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

  test('payment tier lock is distinct from phase lock ("Upgrade to <plan>" vs "Available for <event type>")', async () => {
    const html = await fetchAdminHtml();
    // OSE-R-005: both lock messages still present, both still distinct —
    // but rephrased to plain English. The tier axis says "Upgrade to <plan>"
    // (was "Upgrade to mid"), the phase axis says "Available for <event type>"
    // (was "Requires Phase N regulatory clearance").
    // OSE-1361: both axes now feed the ONE section upsell line, still distinct.
    expect(html).toContain('Upgrade to');
    expect(html).toContain("' available for ' + ph");
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
