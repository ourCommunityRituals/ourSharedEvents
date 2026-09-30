/**
 * OSE-1360 — one {status, phase} source for every display of the selected event.
 *
 * Staging, an ACTIVE event dated in the future: the list badge said "Live", the
 * Event checklist said "Marked ready. Press Go live above." with Next "Go live",
 * the dashboard lifecycle said Preparation, and "People scanning" ticked green
 * next to "Scans null". Four readings of one event. Causes, all in admin.html:
 *   - changeEventStatus re-rendered the badge + panel but NOT the checklist, so
 *     the checklist kept the pre-change "ready" copy after Go live;
 *   - the dashboard derived its phase from a date it was never handed (the
 *     ose:event-selected detail carries id/name/legal tier, no date) and
 *     ignored status entirely;
 *   - a floored registration count ("fewer than 5", which includes 0) ticked
 *     "People scanning", and a 0 scan count formatted as "null";
 *   - status active and phase event were both called "Live".
 *
 * The fix routes every display through one pure function, `oseEventView`, and
 * gives the two axes different words: status active = "Published", phase event
 * = "Live now" (the public page's word). This spec RUNS that function,
 * extracted from the served admin HTML, over the four combos the ticket names.
 *
 * @born-red OSE-1360 | method: ran against origin/main admin.html (restored via tagged git stash) — the extraction marker is absent, the "Live" status label and the stale-checklist wiring fail | date: 2026-09-29
 */
import { describe, expect, test } from 'vitest';
import ADMIN_HTML from '../src/templates/admin.html';

interface Step {
  key: string;
  label: string;
  state: 'done' | 'now' | 'todo';
  detail: string;
}
interface View {
  status: string;
  statusLabel: string;
  phase: 'pre_event' | 'event' | 'post_event';
  phaseLabel: string;
  steps: Step[];
  next: { label: string; href: string } | null;
}
type ViewFn = (e: Record<string, unknown>, facts?: Record<string, unknown>, now?: Date) => View;

function extractView(html: string): ViewFn {
  const begin = html.indexOf('// @ose-event-view:begin');
  const end = html.indexOf('// @ose-event-view:end');
  expect(begin, 'admin.html must carry the oseEventView block').toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(begin);
  const src = html.slice(begin, end);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(`${src}; return oseEventView;`)() as ViewFn;
}

// Lazy, so each test reports on its own (a missing block fails the behaviour
// tests, not the whole file).
let cached: ViewFn | null = null;
const view: ViewFn = (e, f, n) => (cached ??= extractView(ADMIN_HTML))(e, f, n);
const NOW = new Date('2026-10-01T12:00:00Z');
const step = (v: View, key: string) => v.steps.find((s) => s.key === key)!;
const facts = {
  stats: {
    scans: 0,
    appearances: 0,
    registrations: { count: null, suppressed: true, floor: 5 },
    checkins: { count: null, suppressed: true, floor: 5 },
  },
  posters: 0,
  sponsors: 0,
};

describe('OSE-1360: the four combos read the same everywhere', () => {
  test('active + pre_event: Published, not Live now; next is getting the word out, never Go live', () => {
    const v = view(
      {
        id: 'e1',
        status: 'active',
        phase: 'pre_event',
        phaseStatus: 'active',
        startDateISO: '2026-10-24',
        is_published: 1,
      },
      facts,
      NOW
    );
    expect(v.statusLabel).toBe('Published');
    expect(v.phase).toBe('pre_event');
    expect(v.phaseLabel).toBe('Before the event');
    const s2 = step(v, 'live');
    expect(s2.state).toBe('done');
    expect(s2.label).toBe('Published');
    expect(s2.detail).not.toMatch(/Go live|Publish above|Marked ready/);
    expect(s2.detail).toContain('Before the event');
    expect(v.next!.label).toMatch(/^Get the word out/);
    expect(v.next!.label).not.toMatch(/Go live|Publish$|Mark ready/);
  });

  test('active + pre_event even with scans: still getting the word out (the event has not happened)', () => {
    const v = view(
      { status: 'active', phase: 'pre_event', phaseStatus: 'active' },
      { ...facts, stats: { ...facts.stats, scans: 12 }, posters: 2, sponsors: 1 },
      NOW
    );
    expect(v.next!.label).toMatch(/^Get the word out/);
  });

  test('active + event: Published, and the phase is "Live now"', () => {
    const v = view(
      { status: 'active', phase: 'event', phaseStatus: 'active', is_published: 1 },
      facts,
      NOW
    );
    expect(v.statusLabel).toBe('Published');
    expect(v.phase).toBe('event');
    expect(v.phaseLabel).toBe('Live now');
    expect(step(v, 'live').detail).toContain('Live now');
    expect(v.next!.label).not.toMatch(/Go live|Publish$/);
  });

  test('draft: pre_event; step 2 is todo and the next action is to mark ready or publish', () => {
    const v = view({ status: 'draft', phase: 'pre_event', phaseStatus: 'draft' }, facts, NOW);
    expect(v.statusLabel).toBe('Draft');
    expect(v.phase).toBe('pre_event');
    expect(step(v, 'live').state).toBe('todo');
    expect(step(v, 'live').detail).toBe('Still a draft. Publish when the details are right.');
    expect(v.next).toEqual({ label: 'Mark ready or publish', href: '#event-status-card' });
  });

  test('archived: post_event (status gates) even with a future date; next is the report', () => {
    const v = view({ status: 'archived', startDateISO: '2027-01-01' }, facts, NOW);
    expect(v.statusLabel).toBe('Archived');
    expect(v.phase).toBe('post_event');
    expect(step(v, 'live').label).toBe('Was published');
    expect(v.next!.label).toBe('Share the report');
  });

  test('ready: step 2 "now", and only here does the checklist ask to publish', () => {
    const v = view({ status: 'ready' }, facts, NOW);
    expect(step(v, 'live').state).toBe('now');
    expect(step(v, 'live').detail).toBe('Marked ready. Press Publish above.');
    expect(v.next!.label).toBe('Publish');
  });
});

describe('OSE-1360: phase follows status after an in-page status change', () => {
  test('a stale server phase (computed for draft) is not trusted once the row is active', () => {
    // Row loaded as a draft (server forced pre_event), then published in-page
    // for an event that already started: the dates decide, not the stale phase.
    const v = view(
      { status: 'active', phase: 'pre_event', phaseStatus: 'draft', startDateISO: '2026-09-30' },
      facts,
      NOW
    );
    expect(v.phase).toBe('event');
  });

  test('an active event with a future date is pre_event by the dates too', () => {
    const v = view({ status: 'active', startDateISO: '2026-10-24' }, facts, NOW);
    expect(v.phase).toBe('pre_event');
  });
});

describe('OSE-1360: a checklist step ticks only on a real condition', () => {
  test('0 scans + floored (<5) registrations: "People scanning" does NOT tick, and nothing says null', () => {
    const v = view({ status: 'active', phase: 'event', phaseStatus: 'active' }, facts, NOW);
    const s = step(v, 'scans');
    expect(s.state).not.toBe('done');
    expect(s.detail).not.toMatch(/null|undefined/);
    expect(s.detail).toContain('Scans 0');
    expect(s.detail).toContain('registered fewer than 5');
  });

  test('null/undefined counts never tick and never print', () => {
    for (const scans of [null, undefined, { count: null, suppressed: true, floor: 5 }]) {
      const v = view(
        { status: 'active', phase: 'event', phaseStatus: 'active' },
        { stats: { scans, registrations: null, checkins: undefined }, posters: 1, sponsors: 1 },
        NOW
      );
      const s = step(v, 'scans');
      expect(s.state, JSON.stringify(scans)).not.toBe('done');
      expect(s.detail).not.toMatch(/null|undefined/);
    }
  });

  test('a real exact scan count ticks it', () => {
    const v = view(
      { status: 'active', phase: 'event', phaseStatus: 'active' },
      { ...facts, stats: { ...facts.stats, scans: 3 } },
      NOW
    );
    expect(step(v, 'scans').state).toBe('done');
  });

  test('stats that failed to load say so and tick nothing', () => {
    const v = view(
      { status: 'active', phase: 'event', phaseStatus: 'active' },
      { stats: null },
      NOW
    );
    expect(step(v, 'scans').state).not.toBe('done');
    expect(step(v, 'scans').detail).toBe('Could not load counts');
  });
});

describe('OSE-1360: every display is wired to the one view', () => {
  test('badge labels come from the view (friendlyStatus delegates to oseEventView)', () => {
    expect(ADMIN_HTML).toMatch(
      /window\.friendlyStatus = function \(s\) \{\s*return oseEventView\(\{ status: s \|\| 'draft' \}\)\.statusLabel;/
    );
  });

  test('the checklist renders view.steps and view.next — no second derivation', () => {
    expect(ADMIN_HTML).toContain(
      'var view = oseEventView(e, { stats: stats, posters: posters, sponsors: sponsors, answers: answers });'
    );
    expect(ADMIN_HTML).toContain('ol.innerHTML = view.steps.map(');
    expect(ADMIN_HTML).toContain('var nextStep = view.next;');
  });

  test('a status change re-renders the checklist and dashboard, not just the badge', () => {
    expect(ADMIN_HTML).toMatch(
      /window\.renderEventStatus\(id\);\s*\/\/ OSE-1360[\s\S]{0,400}window\.renderEventTimeline\(id\);\s*if \(window\.EventDashboard\) window\.EventDashboard\.render\(\{ id: id \}\);\s*if \(window\.renderPreEventWindow\) window\.renderPreEventWindow\(id\);/
    );
  });

  test('the dashboard lifecycle reads the view phase from the list row, not a date guess', () => {
    expect(ADMIN_HTML).toContain('var phase = phaseFor(detail.id);');
    expect(ADMIN_HTML).toContain(
      "return e && window.oseEventView ? PHASE_CARD[window.oseEventView(e).phase] : 'pre-event';"
    );
    expect(ADMIN_HTML).toContain('data-testid="admin-phase-day-badge">Live now</span>');
  });

  test('the list records which status its server phase was computed for', () => {
    expect(ADMIN_HTML).toContain('e.phaseStatus = e.status;');
  });

  test('one word, one meaning: the status filter chip says Published; "Live" is not a status label', () => {
    expect(ADMIN_HTML).toContain('data-testid="events-filter-active">Published</button>');
    expect(ADMIN_HTML).not.toContain("active: 'Live'");
    expect(ADMIN_HTML).not.toContain('Press Go live above');
  });
});
