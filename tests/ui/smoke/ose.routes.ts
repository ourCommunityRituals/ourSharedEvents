import type { AppManifest } from './types';

/**
 * OSE page surfaces — paths verified against workers/oursharedevents/src/router.ts.
 * Aliases (/tv /kiosk /screen → display; /events /schedule etc. → public) are
 * represented once by their canonical path; alias parity is a Tier-0 route test,
 * not worth browser minutes.
 *
 * anchors use data-testids present in the extracted templates.
 * sharedSheet stays false until OSE adopts /ui.css (extraction shipped the
 * pages byte-identical, CSS untouched).
 */
export const oseManifest: AppManifest = {
  app: 'ose',
  minTap: 44, // OSE-292 touch-target floor
  routes: [
    { path: '/', name: 'landing', anchor: 'header' },
    { path: '/public', name: 'public listing', anchor: '[data-testid="public-header"]' },
    {
      path: '/events/{id}',
      name: 'public event page (phase-driven)',
      anchor: 'main',
      fixtureEnv: 'SMOKE_EVENT_ID',
    },
    {
      path: '/admin',
      name: 'admin dashboard',
      anchor: 'main',
      auth: 'admin',
      gate: true,
      status: 200,
    },
    // Unauthenticated /admin serves the sign-in shell with 401 — that IS the gate.
    {
      path: '/admin',
      name: 'admin sign-in gate (no auth)',
      anchor: 'body',
      auth: 'none',
      gate: true,
      status: 401,
    },
    { path: '/display', name: 'display board', anchor: 'body' },
    { path: '/poster', name: 'poster', anchor: 'body', allowHScroll: true },
    { path: '/sharedReport', name: 'shared report shell', anchor: 'body' },
    { path: '/health', name: 'health', anchor: 'body' }, // JSON; status-only value
  ],
};
