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
 *
 * Three phase routes replace the single /events/{id} route (ose-client-ready
 * package, OSE-454): pre / live / post each have seeded fixture IDs so Tier-1
 * can assert the post-event recap render, not just status=200.
 */
export const oseManifest: AppManifest = {
  app: 'ose',
  minTap: 44, // OSE-292 touch-target floor
  routes: [
    { path: '/', name: 'landing', anchor: 'header' },
    { path: '/public', name: 'public listing', anchor: '[data-testid="public-header"]' },
    {
      path: '/events/{id}',
      name: 'event page — pre',
      anchor: 'main',
      fixtureEnv: 'SMOKE_EVENT_PRE',
    },
    {
      path: '/events/{id}',
      name: 'event page — live',
      anchor: 'main',
      fixtureEnv: 'SMOKE_EVENT_LIVE',
    },
    {
      path: '/events/{id}',
      name: 'event page — post',
      anchor: '[data-testid="event-main-post"]',
      fixtureEnv: 'SMOKE_EVENT_POST',
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
      edgeAuth: 'cf-access',
      gate: true,
      status: 401,
    },
    // Invariant #14 exemption: display board is a venue TV, not a mobile surface.
    // allowHScroll because the board may render a horizontal ticker; minTap: 0
    // because there are no tappable elements on the kiosk view.
    { path: '/display', name: 'display board', anchor: 'body', allowHScroll: true, minTap: 0 },
    { path: '/poster', name: 'poster', anchor: 'body', allowHScroll: true },
    { path: '/sharedReport', name: 'shared report shell', anchor: 'body' },
    { path: '/health', name: 'health', anchor: 'body' }, // JSON; status-only value
  ],
};
