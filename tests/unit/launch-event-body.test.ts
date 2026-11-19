/** OSE-2152 — the launch-smoke create body owes an event type past draft. */
import { describe, test, expect } from 'vitest';
import { launchEventBody } from '../e2e/helpers/launch-event-body';

const base = { isPublished: true, suffix: 'x', runId: 'r1' };

describe('launchEventBody', () => {
  test('an active body without an event type is refused', () => {
    expect(() => launchEventBody({ ...base, status: 'active' })).toThrow(/event_type_id/);
  });

  test('an active body carries the event type and a start time', () => {
    const body = launchEventBody({ ...base, status: 'active', eventTypeId: 'etr-rec-bocce' });
    expect(body.event_type_id).toBe('etr-rec-bocce');
    expect(body.start_time).toBe('18:00');
    expect(body.status).toBe('active');
  });

  test('a draft needs no event type', () => {
    const body = launchEventBody({ ...base, status: 'draft', isPublished: false });
    expect(body.status).toBe('draft');
    expect('event_type_id' in body).toBe(false);
  });
});
