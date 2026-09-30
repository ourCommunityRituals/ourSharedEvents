/**
 * Admin event lifecycle UI — the state machine finally has a driver.
 *
 * Measured 2026-09-16: both create paths (wizard + dashboard form) wrote
 * status='draft' and NO control in admin.html moved an event to ready/active.
 * The wizard said "ready to go" and handed out /events/:id links that the
 * public page 404s for drafts. This spec pins the three things that fix it:
 *
 *   1. a "Your events" front-door path that lands on the list;
 *   2. a status panel, hydrated from the one ose:event-selected event, whose
 *      actions are the state machine's edges and nothing else;
 *   3. a wizard Launch step that is honest ("saved as a draft") and offers
 *      Go live — routed through the SAME transition code as the panel.
 *
 * Plus the list's lifecycle filters + Only mine + Show more (cursor), all
 * dispatched through data-action (nonce CSP forbids inline handlers).
 *
 * Source-shape assertions on the served admin HTML, matching admin-ui.spec.ts.
 */

import { describe, test, expect } from 'vitest';
import { handleAdminPage } from '../src/handlers/pages';

function adminHtml(): Promise<string> {
  return handleAdminPage({} as never).text();
}

describe('front door — Your events path', () => {
  test('the chooser offers "Your events" as a third card', async () => {
    const html = await adminHtml();
    expect(html).toContain('data-testid="admin-path-events"');
    expect(html).toContain('Your events');
  });

  test('choosing it reveals the dashboard (drops chooser-active) and lands on the list', async () => {
    const html = await adminHtml();
    expect(html).toMatch(
      /function startMyEvents\(\)[\s\S]{0,400}classList\.remove\('chooser-active'\)/
    );
    expect(html).toMatch(
      /function startMyEvents\(\)[\s\S]{0,800}getElementById\('events-section'\)/
    );
    expect(html).toContain(
      "getElementById('admin-path-events').addEventListener('click', startMyEvents)"
    );
  });
});

describe('events list — lifecycle filters, only-mine, show more', () => {
  test('one chip per state plus All, dispatched via data-action', async () => {
    const html = await adminHtml();
    for (const st of ['all', 'draft', 'ready', 'active', 'archived']) {
      expect(html).toContain(`data-action="events-filter" data-status="${st}"`);
      expect(html).toContain(`data-testid="events-filter-${st}"`);
    }
    expect(html).toContain("'events-filter': function (el)");
    expect(html).toContain('window.setEventsFilter');
  });

  test('filters are applied SERVER-SIDE via the allowlisted query params, never by trimming a wider list', async () => {
    const html = await adminHtml();
    // The query is built from the per-request snapshot Q (the list labels its rows
    // with the query they were fetched for — CCR PR 700 label race).
    expect(html).toContain("qs.push('status=' + encodeURIComponent(Q.status))");
    expect(html).toContain("qs.push('sort=upcoming')");
    expect(html).toContain("qs.push('mine=1')");
    expect(html).toContain('data-testid="events-filter-mine"');
  });

  test('pagination is exposed: cursor from the envelope drives a Show more control', async () => {
    const html = await adminHtml();
    expect(html).toContain("qs.push('cursor=' + encodeURIComponent(L.cursor))");
    expect(html).toContain('data-action="events-load-more"');
    expect(html).toContain("'events-load-more': function ()");
    expect(html).toContain('window.loadMoreEvents');
  });

  test('the heading is "Your events", not the old brand-wide "All Events"', async () => {
    const html = await adminHtml();
    expect(html).toContain('id="events-heading">Your events</h2>');
    expect(html).not.toContain('<h2>All Events</h2>');
  });

  test('the row carries its status so a test can pick a draft', async () => {
    const html = await adminHtml();
    expect(html).toContain('data-status="${st}"');
  });

  test('draft rows expose an admin-only public-page preview link', async () => {
    const html = await adminHtml();
    expect(html).toContain('data-testid="event-preview-link"');
    expect(html).toContain("e.status === 'draft'");
    expect(html).toContain('href="/api/v2/admin/events/\' + safeId + \'/preview"');
  });
});

describe('status panel — the only lifecycle driver', () => {
  test('the panel exists, hidden until a row is selected, and hydrates from ose:event-selected', async () => {
    const html = await adminHtml();
    expect(html).toMatch(/id="event-status-card"[^>]*data-testid="event-status-card"[^>]*hidden/);
    expect(html).toContain('window.renderEventStatus(d.id)');
    expect(html).toContain("'event-status': function (el)");
  });

  test('its actions are exactly the state machine edges (domain/event-state VALID_TRANSITIONS)', async () => {
    const html = await adminHtml();
    // draft → ready | archived (+ "Go live" as the two-hop ready→active convenience)
    expect(html).toMatch(/draft: \[ \{ to: 'ready'[^\]]*\{ to: 'active'[^\]]*\{ to: 'archived'/);
    // ready → active | draft | archived
    expect(html).toMatch(/ready: \[ \{ to: 'active'[^\]]*\{ to: 'draft'[^\]]*\{ to: 'archived'/);
    // active → ready | archived, plus "Back to draft" as a ROUTED convenience
    // (dogfooding 2026-09-29: an accidental Go live must be one click to undo).
    // It is never a direct edge — moveEventTo walks active → ready (unverify-qr,
    // so qr_verified drops first) → draft; the server still 409s a direct jump.
    expect(html).toMatch(
      /active: \[ \{ to: 'draft', label: 'Back to draft' \}[^\]]*\{ to: 'ready'[^\]]*\{ to: 'archived'[^\]]*\]/
    );
    const { VALID_TRANSITIONS } = await import('../src/domain/event-state');
    expect(VALID_TRANSITIONS.active).not.toContain('draft');
    // archived → draft | active
    expect(html).toMatch(/archived: \[ \{ to: 'draft'[^\]]*\{ to: 'active'/);
  });

  test('ready↔active use the QR-verified endpoints; every other edge is PUT status', async () => {
    const html = await adminHtml();
    expect(html).toContain(
      "if (to === 'active' && from === 'ready') return postJson('/api/v2/admin/events/' + encodeURIComponent(id) + '/verify-qr', 'POST')"
    );
    expect(html).toContain(
      "if (to === 'ready' && from === 'active') return postJson('/api/v2/admin/events/' + encodeURIComponent(id) + '/unverify-qr', 'POST')"
    );
    expect(html).toContain("'PUT', { status: to })");
  });

  test('Go live from a draft is two honest hops (ready, then verify), shared by panel and wizard', async () => {
    const html = await adminHtml();
    // Go live routes through the one status planner (moveEventTo → statusRoute,
    // a BFS over the VALID_TRANSITIONS mirror): a DRAFT is two honest hops
    // (ready, then verify); ARCHIVED goes to active directly (CCR-PR567 L1).
    // admin-golive-transitions.spec.ts runs the planner and asserts the routes.
    expect(html).toContain('window.goLiveFromDraft = function (id, knownFrom)');
    expect(html).toMatch(
      /goLiveFromDraft[\s\S]{0,80}window\.moveEventTo\(id, 'active', knownFrom\)/
    );
  });

  test('plain-language status labels: Published, not "active" (and not "Live")', async () => {
    const html = await adminHtml();
    // OSE-1360 (2026-09-29): status `active` was "Live" while phase `event` was
    // ALSO "Live" on the same page, so an active event dated next month read
    // "Live". One word, one meaning: status active = "Published", phase event =
    // "Live now" (the public page's word). admin-event-status-phase-consistency
    // .spec.ts runs the label map; this pins the source shape.
    expect(html).toContain(
      "var STATUS = { draft: 'Draft', ready: 'Ready', active: 'Published', archived: 'Archived' };"
    );
    expect(html).not.toContain("active: 'Live'");
  });
});

describe('wizard Launch step — honest, and it actually launches', () => {
  test('the summary says saved-as-draft, never "ready to go"', async () => {
    const html = await adminHtml();
    expect(html).not.toContain('is ready to go');
    expect(html).toContain('is saved');
    expect(html).toContain("' as a draft.'");
  });

  test('step 5 carries a Go live control wired to goLiveFromDraft', async () => {
    const html = await adminHtml();
    expect(html).toContain('data-testid="wizard-go-live-btn"');
    expect(html).toContain("getElementById('wizard-go-live-btn').addEventListener('click'");
    expect(html).toMatch(
      /wizard-go-live-btn'\)\.addEventListener[\s\S]{0,900}window\.goLiveFromDraft\(wiz\.createdId, wiz\.status \|\| 'draft'\)/
    );
  });

  test('the step tells the organizer drafts expire so the list stays clean', async () => {
    const html = await adminHtml();
    expect(html).toMatch(/Drafts nobody touches for 30 days are archived automatically/);
  });
});

describe('event timeline — the chain at a glance', () => {
  test('the card exists, hidden until selection, and hydrates from ose:event-selected', async () => {
    const html = await adminHtml();
    expect(html).toMatch(
      /id="event-timeline-card"[^>]*data-testid="event-timeline-card"[^>]*hidden/
    );
    expect(html).toContain('<h3 class="mcard-title">Event checklist</h3>');
    expect(html).toContain('window.renderEventTimeline(d.id)');
  });

  test('five checklist steps in chain order, each with a data-state', async () => {
    const html = await adminHtml();
    const order = ['setup', 'live', 'get-word-out', 'scans', 'report'];
    let last = -1;
    for (const k of order) {
      const i = html.indexOf(`key: '${k}'`);
      expect(i, k).toBeGreaterThan(last);
      last = i;
    }
    expect(html).not.toContain("key: 'sponsors'");
    expect(html).not.toContain("label: 'Sponsors on'");
    expect(html).toContain(`data-testid="tl-' + s.key + '" data-state="' + s.state + '"`);
  });

  test('counts come from the k-floored stats endpoint and never render a sub-floor number', async () => {
    const html = await adminHtml();
    expect(html).toContain("fetch('/api/v2/admin/events/' + eid + '/stats')");
    expect(html).toContain("if (f.suppressed) return 'fewer than ' + (f.floor || 5)");
  });

  test('the "Get the word out" step folds sponsors in and counts ACCEPTED sponsors only', async () => {
    const html = await adminHtml();
    // sponsor_accepted: 1 accepted, 0 declined, null pending. Only accepted
    // (=== 1) renders on the public surfaces (ADR-019 strict consent), so the
    // timeline must not count a pending (null) sponsor as "on". `!== 0` wrongly
    // treated pending as on; accepted-only is the honest count.
    expect(html).toContain("label: 'Get the word out'");
    expect(html, 'timeline sponsor count must not treat pending (null) as on').not.toMatch(
      /s\.sponsor_accepted\s*!==\s*0/
    );
    expect(html, 'timeline "Get the word out" sponsor count must be accepted-only').toMatch(
      /Number\(s\.sponsor_accepted\)\s*===\s*1/
    );
  });

  test('published checklist copy never tells an already-published event to publish', async () => {
    const html = await adminHtml();
    // OSE-1360: copy moved into oseEventView and the verb is "Publish" (was
    // "Go live"); the behaviour is RUN in admin-event-status-phase-consistency.
    expect(html).toContain('active ? (Number(e.is_published) === 0');
    expect(html).toContain("'Public page, poster and display are on'");
    expect(html).toContain("st === 'ready' ? 'Marked ready. Press Publish above.'");
  });

  test('the next step is one link into the right card, in chain order', async () => {
    const html = await adminHtml();
    expect(html).toContain('data-testid="event-timeline-next"');
    // OSE-1360: the next step lives in oseEventView (same {status, phase} as
    // the badge). Order is RUN in admin-event-status-phase-consistency.spec.ts.
    expect(html).toMatch(/if \(st === 'draft'\) next = [\s\S]{0,80}#event-status-card/);
    expect(html).toMatch(/else if \(st === 'ready'\) next = [\s\S]{0,80}#event-status-card/);
    expect(html).toMatch(
      /else if \(active && !\(posters > 0\)\) next = [\s\S]{0,100}#poster-deployments-card/
    );
    expect(html).toMatch(/else if \(active && sponsors === 0\) next = [\s\S]{0,100}#sponsors-card/);
    expect(html).toMatch(/next = \{ label: 'Share the report', href: '#report-card' \}/);
    for (const id of [
      'event-status-card',
      'poster-deployments-card',
      'sponsors-card',
      'report-card',
      'surface-cards',
    ]) {
      expect(html, id).toContain(`id="${id}"`);
    }
  });

  test('a stale response never overwrites a newer selection', async () => {
    const html = await adminHtml();
    expect(html).toContain('var seq = ++window._oseTimelineSeq');
    expect(html).toContain('if (seq !== window._oseTimelineSeq) return;');
  });
});
