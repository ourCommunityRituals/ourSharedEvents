/**
 * Admin Logs and Settings screens (first slice).
 *
 *   GET /api/v2/admin/screens/logs      → the Logs page (HTML)
 *   GET /api/v2/admin/screens/settings  → the Settings page (HTML)
 *   GET /api/v2/admin/settings          → the Settings data (JSON, read only)
 *
 * The pages live under /api/v2/admin on purpose: that prefix is already behind
 * the Cloudflare Access app, the admin rate limit and the object-scope guard
 * (the draft preview and live view pages follow the same rule). The router runs
 * requireAdmin before any of these handlers.
 *
 * The Logs page has no endpoint of its own. It reads
 * GET /api/v2/admin/audit-log?scope=brand, where the SERVER decides which rows a
 * brand owner may see; the page cannot widen that, only ask. Job results, security
 * events and cost that exist only in the log stream are shown as an honest
 * "not recorded yet", never estimated.
 *
 * Both pages are scripted by nonce'd inline scripts (script-src 'self' 'nonce-…'),
 * set no cookies, and are never cached or indexed.
 */

import { html } from './pages';
import { injectLegalFooter } from '../lib/legal-footer';
import { buildAdminSettings, type AdminSettingsEnv } from '../lib/admin-settings';
import type { Tier } from '../lib/feature-flags';
import LOGS_HTML from '../templates/admin-logs.html';
import SETTINGS_HTML from '../templates/admin-settings.html';

const PRIVATE_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
};

function privatePage(markup: string): Response {
  const res = html(injectLegalFooter(markup, 'admin'));
  for (const [k, v] of Object.entries(PRIVATE_HEADERS)) res.headers.set(k, v);
  return res;
}

export function handleAdminLogsPage(): Response {
  return privatePage(LOGS_HTML);
}

export function handleAdminSettingsPage(): Response {
  return privatePage(SETTINGS_HTML);
}

/** The plan is resolved by the caller (it lives in FORMS_DB with the flags). */
export function handleAdminSettings(tier: Tier, env: AdminSettingsEnv): Response {
  return Response.json(buildAdminSettings({ tier, env }), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
