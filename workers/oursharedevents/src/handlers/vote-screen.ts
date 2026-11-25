// GET /api/v2/admin/events/:id/vote-screen — the host's vote-code screen
// (OSE-2226, OSE ADR-040 decisions 6 and 7).
//
// A full-screen page for a laptop, tablet or TV in the room that shows the
// event's vote code as a large QR and one line, "Scan to vote". Nothing else:
// no count, no list, no title, no other vote word. It is for an event or market
// with no OurWKRP room screen.
//
// HOST ONLY. The path sits under /api/v2/admin/* (Cloudflare Access at the
// edge), the router runs requireAdmin (a signed-out browser gets the sign-in
// page, as on the live view), and guardAdminObjectScope answers 404 for an
// event outside the caller's brands before this runs. The code's token is in
// this page and in the admin's Voting card, and in no public answer: the
// public display and display-config still carry no vote word (decision 7).
//
// It READS the vote code (lib/vote-code.ts readVoteCode) and never makes one.
// With no code in use it says so and points to the Voting card. With the
// voting switch off (lib/voting-switch.ts) it says voting is off and shows no
// code, since a scan would lead nowhere.
//
// A host who replaces a photographed code changes this screen too: the page
// loads itself again every minute while it is shown, so a retired code does
// not stay on the wall.
//
// The arrangement is the event's vote-screen layout (lib/layout-skins.ts,
// settings.layouts.vote_screen): the words above or below the code, or side by
// side on a wide TV. Colors are the design tokens from /ui.css only.

import { html, renderErrorPage } from './pages';
import { escapeHtml } from '../lib/html-escape.js';
import { readVoteCode } from '../lib/vote-code';
import { votingEnabled, type VotingSwitchEnv } from '../lib/voting-switch';
import { parseEventSettings, resolveLayout } from '../lib/event-settings';
import {
  LAYOUT_CLIENT_JS,
  LAYOUT_CSS,
  SURFACE_REGIONS,
  type SurfaceLayout,
} from '../lib/layout-skins';

export interface VoteScreenEnv extends VotingSwitchEnv {
  DB?: D1Database;
}

/** How often the screen reloads itself, so a replaced code reaches the wall. */
export const VOTE_SCREEN_RELOAD_SECONDS = 60;

/** The one line the screen shows next to the code. */
export const VOTE_SCREEN_LINE = 'Scan to vote';

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };

function fail(status: number, title: string, body: string): Response {
  const res = renderErrorPage(status, title, body, '/admin', 'Back to admin');
  for (const [k, v] of Object.entries(NO_STORE)) res.headers.set(k, v);
  return res;
}

// Tokens only (no raw hex). The QR sits on the white .qr-frame ground from
// /ui.css so it scans in either theme.
const STYLE = `
  html,body{height:100%}
  body{margin:0;font-family:var(--font,system-ui,sans-serif);background:var(--bg);color:var(--text)}
  .vs{min-height:100%;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2rem;padding:1.5rem;text-align:center}
  .vs[data-layout-columns="2"]{display:grid;place-content:center;justify-items:center;align-items:center}
  .vs h1{margin:0;font-size:clamp(2rem,7vw,5.5rem);line-height:1.1}
  .vs-code{margin:0;padding:clamp(12px,2vw,28px);line-height:0}
  .vs-code img{display:block;width:min(70vh,80vw);height:auto;max-width:100%;image-rendering:pixelated}
  .vs[data-layout-columns="2"] .vs-code img{width:min(70vh,42vw)}
  .vs-note{margin:0;font-size:1.25rem;color:var(--text-muted);max-width:32rem}
  .vs-note a{color:var(--accent-text,var(--accent));font-weight:600;display:inline-flex;align-items:center;min-height:48px}
`;

function shell(title: string, body: string, layout: SurfaceLayout | null, reload: boolean): string {
  const script = layout
    ? `<script>
${LAYOUT_CLIENT_JS}
(function () {
  var main = document.querySelector('[data-testid="vote-screen"]');
  window.OSE_applyLayout(main, ${JSON.stringify(layout)}, ${JSON.stringify(SURFACE_REGIONS.vote_screen)});
})();
</script>`
    : '';
  const again = reload
    ? `<script>
(function () {
  var every = ${VOTE_SCREEN_RELOAD_SECONDS} * 1000;
  setInterval(function () { if (!document.hidden) location.reload(); }, every);
})();
</script>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/ui.css">
<style>${STYLE}${LAYOUT_CSS}</style>
</head>
<body>
${body}
${script}${again}
</body>
</html>`;
}

/** The page for a code in use: the line and the QR, in the event's layout. */
export function voteScreenHtml(qr: string, layout: SurfaceLayout): string {
  const body = `<main class="vs" data-testid="vote-screen">
  <h1 data-region="line" data-testid="vote-screen-line">${VOTE_SCREEN_LINE}</h1>
  <figure class="qr-frame vs-code" data-region="code" data-testid="vote-screen-code">
    <img src="${escapeHtml(qr)}" alt="QR code to vote in this room" width="400" height="400" data-testid="vote-screen-qr">
  </figure>
</main>`;
  return shell(VOTE_SCREEN_LINE, body, layout, true);
}

function notReady(heading: string, note: string, testid: string, reload: boolean): string {
  const body = `<main class="vs" data-testid="vote-screen">
  <h1 data-testid="vote-screen-heading">${heading}</h1>
  <p class="vs-note" data-testid="${testid}">${note} <a href="/admin" data-testid="vote-screen-admin">Open admin</a></p>
</main>`;
  return shell(heading, body, null, reload);
}

export async function handleAdminVoteScreenPage(
  env: VoteScreenEnv,
  eventId: string,
  origin: string
): Promise<Response> {
  if (!env.DB) {
    return fail(503, "We're having trouble loading this event", 'Try again in a minute.');
  }
  if (!eventId || eventId.length > 128 || !/^[a-zA-Z0-9_\-]+$/.test(eventId)) {
    return fail(404, "We couldn't find that event", 'This vote screen link is invalid.');
  }
  let row: { id: string; settings_json: string | null } | null;
  try {
    row = await env.DB.prepare('SELECT id, settings_json FROM events WHERE id = ?')
      .bind(eventId)
      .first<{ id: string; settings_json: string | null }>();
  } catch {
    return fail(503, "We're having trouble loading this event", 'Try again in a minute.');
  }
  if (!row) {
    return fail(
      404,
      "We couldn't find that event",
      'This vote screen no longer points to an event.'
    );
  }

  let page: string;
  if (!votingEnabled(env)) {
    page = notReady(
      'Voting is off',
      'Voting is switched off on this site, so there is no code to show.',
      'vote-screen-off',
      false
    );
  } else {
    let code;
    try {
      code = await readVoteCode(env.DB, row.id, origin);
    } catch {
      return fail(503, "We're having trouble loading this event", 'Try again in a minute.');
    }
    if (!code || !code.qr) {
      // Reload too: once the host makes the code on the Voting card, the
      // screen shows it within a minute without anyone touching the TV.
      page = notReady(
        'No vote code yet',
        'Make the vote code on the Voting card for this event. This screen shows it within a minute.',
        'vote-screen-none',
        true
      );
    } else {
      page = voteScreenHtml(
        code.qr,
        resolveLayout(parseEventSettings(row.settings_json), 'vote_screen')
      );
    }
  }
  const res = html(page);
  for (const [k, v] of Object.entries(NO_STORE)) res.headers.set(k, v);
  return res;
}
