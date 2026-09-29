import { describe, expect, test } from 'vitest';
import ADMIN_HTML from '../src/templates/admin.html';
import { VALID_TRANSITIONS, VALID_EVENT_STATES } from '../src/domain/event-state';

// L1 (CCR-PR567): the admin "Go live again" button on an ARCHIVED event was dead.
// goLiveFromDraft two-hopped every non-ready origin through `ready`, but
// VALID_TRANSITIONS says archived -> ready is INVALID (409) while archived ->
// active is a DIRECT edge.
//
// Dogfooding (2026-09-29): an organizer who went Live by accident needed two
// clicks through two panel states to get back to a draft, and nothing offered an
// Undo. The panel now routes EVERY target through one planner (`statusRoute`, a
// BFS over a client mirror of VALID_TRANSITIONS) so any status is one click and
// every change carries a one-click Undo. These tests RUN that planner, extracted
// from the served admin HTML, instead of pattern-matching its source.

type Route = (from: string, to: string) => string[] | null;

function extractPlanner(html: string): { edges: Record<string, string[]>; route: Route } {
  const edgesMatch = html.match(/var STATUS_EDGES = (\{[^;]*\});/);
  expect(edgesMatch, 'admin.html must carry the STATUS_EDGES mirror').not.toBeNull();
  const edges = JSON.parse(edgesMatch![1]) as Record<string, string[]>;
  const start = html.indexOf('function statusRoute(from, to) {');
  expect(start).toBeGreaterThan(-1);
  const end = html.indexOf('window.moveEventTo', start);
  const src = html.slice(start, end).replace(/\/\*\*[\s\S]*?\*\/\s*$/, '');
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const route = new Function('STATUS_EDGES', `${src}; return statusRoute;`)(edges) as Route;
  return { edges, route };
}

const { edges, route } = extractPlanner(ADMIN_HTML);

describe('admin status changes honour the state machine, one click each', () => {
  test('the client edge mirror IS the server state machine', () => {
    const server = Object.fromEntries(
      Object.entries(VALID_TRANSITIONS).map(([k, v]) => [k, [...v]])
    );
    expect(edges).toEqual(server);
  });

  test('L1 kept: archived goes Live directly, never via the invalid archived->ready edge', () => {
    expect(VALID_TRANSITIONS.archived).not.toContain('ready');
    expect(route('archived', 'active')).toEqual(['active']);
  });

  test('draft goes Live via ready (the one origin with no direct edge)', () => {
    expect(route('draft', 'active')).toEqual(['ready', 'active']);
  });

  test('an accidental Go live is one click back to draft (active -> ready -> draft)', () => {
    expect(route('active', 'draft')).toEqual(['ready', 'draft']);
  });

  test('every status reaches every other status, and every hop is a valid edge', () => {
    for (const from of VALID_EVENT_STATES) {
      for (const to of VALID_EVENT_STATES) {
        const r = route(from, to);
        expect(r, `${from} -> ${to}`).not.toBeNull();
        let at: string = from;
        for (const hop of r!) {
          expect((VALID_TRANSITIONS as Record<string, readonly string[]>)[at]).toContain(hop);
          at = hop;
        }
        expect(at).toBe(to);
        // Archived is a destination, never a stepping stone.
        expect(r!.slice(0, -1), `${from} -> ${to} passes through archived`).not.toContain(
          'archived'
        );
      }
    }
  });

  test('the panel and the wizard both go through the one router', () => {
    expect(ADMIN_HTML).toMatch(
      /window\.moveEventTo = async function \(id, to, knownFrom\)[\s\S]{0,900}statusRoute\(from, to\)[\s\S]{0,400}transition\(id, at, route\[i\]\)/
    );
    expect(ADMIN_HTML).toMatch(
      /window\.goLiveFromDraft = function \(id, knownFrom\) \{\s*return window\.moveEventTo\(id, 'active', knownFrom\);/
    );
    expect(ADMIN_HTML).toMatch(
      /changeEventStatus = async function[\s\S]{0,600}await window\.moveEventTo\(id, to\)/
    );
  });

  test('Live offers Back to draft as a first-class action', () => {
    expect(ADMIN_HTML).toContain(
      "active: [ { to: 'draft', label: 'Back to draft' }, { to: 'ready', label: 'Take offline' }, { to: 'archived', label: 'Archive' } ]"
    );
  });

  test('every successful change offers a one-click Undo back to where it was', () => {
    expect(ADMIN_HTML).toMatch(
      /undo\.setAttribute\('data-action', 'event-status'\);[\s\S]{0,200}undo\.setAttribute\('data-to', from\);[\s\S]{0,120}'event-status-undo'/
    );
  });

  test('the wizard offers Undo, back to draft, right after Go live now', () => {
    expect(ADMIN_HTML).toContain('data-testid="wizard-undo-live-btn"');
    expect(ADMIN_HTML).toMatch(
      /wizard-undo-live-btn'\)\.addEventListener[\s\S]{0,500}window\.moveEventTo\(wiz\.createdId, 'draft', wiz\.status \|\| 'active'\)/
    );
  });
});
