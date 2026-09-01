/**
 * PAGE TESTS - Level 2: Phase-2 clearance gate is EXERCISED, not bypassed (OSE-1004)
 *
 * The synthetic Phase-2 fixture (evt_forms_phase2, legal_clearance_tier=2) lets the
 * survey/email SUBMISSION E2E go green. This spec is the counterweight that keeps
 * "green != true" honest: it proves the compliance gate still refuses a Phase-1
 * event. If someone flipped test-event-001 to tier>=2 (bypassing the gate instead
 * of exercising it), the first assertion below turns RED.
 *
 * Named "Survey Form ... " / "Email Signup ..." so the T4c-phase2 grep
 * ("Survey Form|Email Signup") includes it and the T4c-phase1 grep-invert excludes it.
 *
 * API-level (request fixture) — the gate lives in router.ts before the handler, so a
 * minimal body still trips it: the 403 PHASE_REQUIRED fires on the Phase-1 event
 * regardless of body validity.
 */

import { test, expect } from '@playwright/test';

// evt_forms_phase1 = synthetic tier-1 event WITH the per-event flag override ON,
// so submission clears FORM_DISABLED and deterministically hits PHASE_REQUIRED —
// proving the tier gate without depending on staging's global flag state.
const PHASE1_EVENT_ID = process.env.PHASE1_EVENT_ID || 'evt_forms_phase1';
const PHASE2_EVENT_ID = process.env.PHASE2_EVENT_ID || 'evt_forms_phase2';

function bodyFor(formType: 'survey' | 'email-signup') {
  return formType === 'survey'
    ? { rating: 4 }
    : { email: `gate-${Date.now()}@example.com`, consent: true };
}

test.describe('Survey Form + Email Signup — Phase-2 gate is exercised (OSE-1004)', () => {
  for (const formType of ['survey', 'email-signup'] as const) {
    test(`Phase-1 event refuses ${formType} with 403 PHASE_REQUIRED`, async ({ request }) => {
      const res = await request.post(`/api/v2/events/${PHASE1_EVENT_ID}/forms/${formType}`, {
        data: bodyFor(formType),
        failOnStatusCode: false,
      });
      expect(
        res.status(),
        `${formType} on the Phase-1 event (${PHASE1_EVENT_ID}) must be clearance-gated — ` +
          `if this is not 403, the gate was bypassed (tier flipped) instead of exercised`
      ).toBe(403);
      const body = await res.json();
      expect(body.code).toBe('PHASE_REQUIRED');
    });

    test(`Phase-2 fixture is NOT phase-refused for ${formType}`, async ({ request }) => {
      const res = await request.post(`/api/v2/events/${PHASE2_EVENT_ID}/forms/${formType}`, {
        data: bodyFor(formType),
        failOnStatusCode: false,
      });
      // The whole point of the fixture: the Phase-2 event clears the gate. A non-403
      // (success) is expected; a 4xx for a DIFFERENT reason is a separate problem, but
      // it must NEVER be PHASE_REQUIRED here.
      if (res.status() === 403) {
        const body = await res.json();
        expect(
          body.code,
          `Phase-2 fixture (${PHASE2_EVENT_ID}) must not be PHASE_REQUIRED-gated`
        ).not.toBe('PHASE_REQUIRED');
      }
    });
  }
});
