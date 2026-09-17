import { describe, expect, test } from 'vitest';
import ADMIN_HTML from '../src/templates/admin.html';
import { VALID_TRANSITIONS } from '../src/domain/event-state';

// L1 (CCR-PR567): the admin "Go live again" button on an ARCHIVED event was dead.
// goLiveFromDraft two-hopped every non-ready origin through `ready`, but
// VALID_TRANSITIONS says archived -> ready is INVALID (409) while archived ->
// active is a DIRECT edge. Only `draft` genuinely needs the ready hop.
function goLiveFromDraftBody(html: string): string {
  const start = html.indexOf('goLiveFromDraft = async function');
  const end = html.indexOf('window.changeEventStatus', start);
  return html.slice(start, end === -1 ? start + 2000 : end);
}

describe('admin go-live transitions honour the state machine (L1)', () => {
  test('the state machine has a direct archived->active edge and NO archived->ready edge', () => {
    expect(VALID_TRANSITIONS.archived).toContain('active');
    expect(VALID_TRANSITIONS.archived).not.toContain('ready');
    expect(VALID_TRANSITIONS.draft).not.toContain('active'); // draft must hop via ready
  });

  test('goLiveFromDraft only takes the ready hop for draft; archived goes to active directly', () => {
    const fn = goLiveFromDraftBody(ADMIN_HTML);
    // The fix special-cases draft (the one origin with no direct edge to active),
    // NOT "anything but ready" — the old `from !== 'ready'` guard hopped archived
    // through the invalid archived->ready edge and 409'd.
    expect(fn, 'must special-case draft, not "anything but ready"').toMatch(/from === 'draft'/);
    expect(fn, "the old broken `from !== 'ready'` two-hop guard must be gone").not.toMatch(
      /from !== 'ready'/
    );
    // The go-live hop targets active from the ACTUAL current origin (direct edge
    // for archived), not a hardcoded ready->active.
    expect(fn, 'go-live must transition to active from the current origin').toMatch(
      /transition\([^)]*from[^)]*'active'/
    );
  });
});
