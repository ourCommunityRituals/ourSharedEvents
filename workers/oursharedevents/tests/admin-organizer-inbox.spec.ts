/**
 * Organizer inbox (TRIANGLE next slice #3) — sponsors who have not answered, and
 * sponsors who declined, surfaced on the Event checklist card instead of only as
 * "Pending accept" / "Declined" badges inside the sponsors table.
 *
 * Same method as admin-event-status-phase-consistency.spec.ts: RUN the pure
 * `oseEventView` extracted from the served admin HTML (the one source every
 * display of the selected event goes through), then pin the wiring that feeds
 * it and renders its output.
 */
import { describe, expect, test } from 'vitest';
import ADMIN_HTML from '../src/templates/admin.html';

interface InboxItem {
  key: string;
  label: string;
  detail: string;
  action: string;
  href: string;
}
interface View {
  steps: { key: string; detail: string }[];
  next: { label: string; href: string } | null;
  inbox: InboxItem[];
}
type ViewFn = (e: Record<string, unknown>, facts?: Record<string, unknown>, now?: Date) => View;

function extractView(html: string): ViewFn {
  const begin = html.indexOf('// @ose-event-view:begin');
  const end = html.indexOf('// @ose-event-view:end');
  expect(begin).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(begin);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(`${html.slice(begin, end)}; return oseEventView;`)() as ViewFn;
}
let cached: ViewFn | null = null;
const view: ViewFn = (e, f, n) => (cached ??= extractView(ADMIN_HTML))(e, f, n);

const NOW = new Date('2026-10-01T12:00:00Z');
const published = {
  id: 'e1',
  status: 'active',
  phase: 'pre_event',
  phaseStatus: 'active',
  startDateISO: '2026-10-24',
  is_published: 1,
};
const base = { stats: { scans: 0 }, posters: 2 };

describe('organizer inbox | oseEventView', () => {
  test('no answers fact → empty inbox (older callers keep working)', () => {
    expect(view(published, { ...base, sponsors: 1 }, NOW).inbox).toEqual([]);
  });

  test('waiting sponsors are listed by name with a link to the sponsors card', () => {
    const v = view(
      published,
      {
        ...base,
        sponsors: 1,
        answers: { pending: ['Corner Bakery', 'Eagles Hall Bar'], declined: [] },
      },
      NOW
    );
    expect(v.inbox).toHaveLength(1);
    expect(v.inbox[0]).toMatchObject({
      key: 'sponsors-waiting',
      label: '2 sponsors have not answered',
      href: '#sponsors-card',
    });
    expect(v.inbox[0].detail).toContain('Corner Bakery, Eagles Hall Bar');
    expect(v.inbox[0].detail).toContain('Sponsor link');
    // The checklist step says it too.
    expect(v.steps.find((s) => s.key === 'get-word-out')!.detail).toContain('2 waiting to answer');
  });

  test('singular wording for one', () => {
    const v = view(
      published,
      { ...base, sponsors: 1, answers: { pending: ['Corner Bakery'], declined: ['Old Mill'] } },
      NOW
    );
    expect(v.inbox.map((i) => i.label)).toEqual([
      '1 sponsor has not answered',
      '1 sponsor declined',
    ]);
    expect(v.inbox[1].detail).toContain('not shown on the event');
  });

  test('Next says "waiting on sponsors" instead of "add a sponsor" when some are pending', () => {
    const pending = view(
      published,
      { ...base, sponsors: 0, answers: { pending: ['Corner Bakery'], declined: [] } },
      NOW
    );
    expect(pending.next).toEqual({
      label: 'Waiting on sponsors: send their link',
      href: '#sponsors-card',
    });
    const none = view(
      published,
      { ...base, sponsors: 0, answers: { pending: [], declined: [] } },
      NOW
    );
    expect(none.next?.label).toBe('Get the word out: add a sponsor');
  });

  test('an archived event has nothing left to chase', () => {
    const v = view(
      { ...published, status: 'archived' },
      { ...base, sponsors: 0, answers: { pending: ['A'], declined: ['B'] } },
      NOW
    );
    expect(v.inbox).toEqual([]);
  });
});

describe('organizer inbox | wiring in the served admin page', () => {
  test('the inbox section sits inside the checklist card, hidden until it has items', () => {
    const card = ADMIN_HTML.slice(
      ADMIN_HTML.indexOf('id="event-timeline-card"'),
      ADMIN_HTML.indexOf('</section>', ADMIN_HTML.indexOf('id="event-inbox"'))
    );
    expect(card).toMatch(/<section id="event-inbox" data-testid="event-inbox"[^>]*hidden>/);
    expect(card).toContain('Needs your attention');
    expect(card).toContain('data-testid="event-inbox-list"');
  });

  test('the sponsors fetch splits pending (null) from declined (0), active rows only', () => {
    expect(ADMIN_HTML).toContain(
      'pending: live.filter(function (s) { return s.sponsor_accepted == null; })'
    );
    expect(ADMIN_HTML).toMatch(
      /declined: live\.filter\(function \(s\) \{ return s\.sponsor_accepted != null && Number\(s\.sponsor_accepted\) === 0; \}\)/
    );
    expect(ADMIN_HTML).toContain(
      'oseEventView(e, { stats: stats, posters: posters, sponsors: sponsors, answers: answers })'
    );
  });

  test('sponsor names are escaped on render, and the action is a 44px control', () => {
    const at = ADMIN_HTML.indexOf('inboxList.innerHTML = view.inbox.map(');
    expect(at).toBeGreaterThan(-1);
    const render = ADMIN_HTML.slice(at, at + 700);
    expect(render).toContain('esc(it.label)');
    expect(render).toContain('esc(it.detail)');
    expect(render).toContain('class="copy-btn"');
    expect(render).not.toMatch(/\+ it\.(label|detail) \+/);
  });
});
