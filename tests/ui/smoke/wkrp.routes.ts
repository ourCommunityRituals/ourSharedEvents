import type { AppManifest } from './types';

/**
 * WKRP page surfaces — paths verified against src/handlers/pages.ts dispatch:
 *   /            → connect (redirects to /catalog when session cookie present)
 *   /catalog /create /dashboard /stats /import
 *   /dj/{id}/poster → qr-poster,  /dj/{id}(…) → live,  /contributor/{id} → profile
 *
 * dashboard/create are role-gated client-side: they render a loading view then
 * either the app or an access-denied view. The gate flag asserts the denied
 * path is humane (empty-state with an on-ramp once @ocr/ui partials land).
 */
export const wkrpManifest: AppManifest = {
  app: 'wkrp',
  minTap: 48,
  routes: [
    { path: '/', name: 'connect', anchor: 'body' },
    { path: '/catalog', name: 'catalog', anchor: 'body' },
    { path: '/create', name: 'create playlist', anchor: 'body', gate: true },
    {
      path: '/dashboard',
      name: 'dj dashboard',
      anchor: '[data-testid="loading-view"]',
      gate: true,
    },
    { path: '/stats', name: 'stats', anchor: 'body' },
    { path: '/import', name: 'import', anchor: 'body' },
    {
      path: '/dj/{id}',
      name: 'live set (public attribution)',
      anchor: 'body',
      fixtureEnv: 'SMOKE_DJ_ID',
    },
    {
      path: '/dj/{id}/poster',
      name: 'qr poster',
      anchor: 'body',
      fixtureEnv: 'SMOKE_DJ_ID',
      allowHScroll: true,
    },
    {
      path: '/contributor/{id}',
      name: 'contributor profile',
      anchor: 'body',
      fixtureEnv: 'SMOKE_CONTRIBUTOR_ID',
    },
  ],
};
